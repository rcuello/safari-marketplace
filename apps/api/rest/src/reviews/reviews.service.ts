import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createReview,
  deleteReview,
  findReviewById,
  getUserFriendlyMessage,
  isPrismaConnectionError,
  listReviews,
  updateReview,
  type Prisma,
  type ReviewDetailRecord,
} from '@safari/db';
import { CurrentUserPayload } from '#src/auth/decorators/current-user.decorator.js';
import { paginate } from '#src/common/pagination/paginate.js';
import { parseSearch } from '#src/common/search/parse-search.js';
import { toWriteHttpException } from '#src/common/errors/domain-error.mapper.js';
import { CreateReviewDto } from './dto/create-review.dto.js';
import { GetReviewsDto } from './dto/get-reviews.dto.js';
import { UpdateReviewDto } from './dto/update-review.dto.js';
import { Review } from './entities/review.entity.js';
import { toReviewDto } from './review-dto.mapper.js';

function readError(error: unknown): never {
  if (isPrismaConnectionError(error)) {
    throw new ServiceUnavailableException(getUserFriendlyMessage(error));
  }
  throw new InternalServerErrorException(getUserFriendlyMessage(error));
}

function assertId(id: number): void {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new NotFoundException(`No existe una reseña con id ${id}.`);
  }
}

/** Entero positivo seguro, o `null` si no lo es. */
function parsePositiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Campo numérico del body: ausente/null ⇒ null; inválido ⇒ 400. */
function optionalBodyId(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = parsePositiveInt(value);
  if (n === null)
    throw new BadRequestException(
      `\`${field}\` no admite \`${String(value)}\`.`,
    );
  return n;
}

@Injectable()
export class ReviewService {
  /**
   * Filtros reales combinados con AND (V-1): `product_id` del query y
   * `rating:N`, `shop_id:N` y `type.slug:<x>` desde `search`. Las demás
   * claves se ignoran. Un número no válido devuelve la lista vacía (como el
   * mock con un `product_id` que no casa). Orden `id DESC`, defaults
   * `page=1`/`limit=30`; `paginate()` recibe el `limit` crudo y la url es la
   * del mock.
   */
  async findAllReviews({ limit, page, search, product_id }: GetReviewsDto) {
    if (!page) page = 1;
    if (!limit) limit = 30;
    const url = `/reviews?search=${search}&limit=${limit}`;
    const tokens = parseSearch(search);
    const empty = () => ({ data: [], ...paginate(0, page, limit, 0, url) });

    const numeric: Record<
      'productId' | 'shopId' | 'rating',
      number | undefined
    > = {
      productId: undefined,
      shopId: undefined,
      rating: undefined,
    };
    for (const [key, raw] of [
      ['productId', product_id],
      ['shopId', tokens.shop_id],
      ['rating', tokens.rating],
    ] as const) {
      if (raw === undefined || raw === '') continue;
      const n = parsePositiveInt(raw);
      if (n === null) return empty();
      numeric[key] = n;
    }

    try {
      const { items, total } = await listReviews({
        ...numeric,
        typeSlug: tokens['type.slug'] || undefined,
        page: Number(page),
        limit: Number(limit),
      });
      return {
        data: items.map(toReviewDto),
        ...paginate(total, page, limit, items.length, url),
      };
    } catch (error) {
      readError(error);
    }
  }

  /** DTO o 404 (V-8). */
  async findReview(id: number): Promise<Review> {
    assertId(id);
    return toReviewDto(await this.findOrFail(id));
  }

  /**
   * El autor es quien llama. 404 si el producto no existe; 400 si `shop_id`
   * no es su tienda o `rating` está fuera de 1..5; 409 si ya reseñó ese
   * producto con esa orden.
   */
  async create(
    dto: CreateReviewDto,
    user: CurrentUserPayload,
  ): Promise<Review> {
    const productId = optionalBodyId(dto.product_id, 'product_id');
    const shopId = optionalBodyId(dto.shop_id, 'shop_id');
    if (productId === null)
      throw new BadRequestException('`product_id` es obligatorio.');
    if (shopId === null)
      throw new BadRequestException('`shop_id` es obligatorio.');
    // Fuera del try: `toWriteHttpException` convertiría este 400 en un 500.
    const orderId = optionalBodyId(dto.order_id, 'order_id');
    const variationOptionId = optionalBodyId(
      dto.variation_option_id,
      'variation_option_id',
    );
    try {
      const record = await createReview({
        userId: user.sub,
        productId,
        shopId,
        rating: Number(dto.rating),
        comment: dto.comment,
        ...(dto.photos !== undefined && {
          photos: dto.photos as unknown as Prisma.InputJsonValue[],
        }),
        orderId,
        variationOptionId,
      });
      return toReviewDto(record);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /** Solo el autor o un `super_admin` (403). Edita `rating`, `comment` y `photos`. */
  async update(
    id: number,
    dto: UpdateReviewDto,
    user: CurrentUserPayload,
  ): Promise<Review> {
    assertId(id);
    this.assertCanModify(await this.findOrFail(id), user);
    try {
      const record = await updateReview(id, {
        ...(dto.rating !== undefined && { rating: Number(dto.rating) }),
        ...(dto.comment !== undefined && { comment: dto.comment }),
        ...(dto.photos !== undefined && {
          photos: dto.photos as unknown as Prisma.InputJsonValue[],
        }),
      });
      return toReviewDto(record);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /** Solo el autor o un `super_admin`. Devuelve la reseña borrada (V-5). */
  async delete(id: number, user: CurrentUserPayload): Promise<Review> {
    assertId(id);
    this.assertCanModify(await this.findOrFail(id), user);
    try {
      return toReviewDto(await deleteReview(id));
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  private assertCanModify(
    record: ReviewDetailRecord,
    user: CurrentUserPayload,
  ): void {
    if (
      record.userId !== user.sub &&
      !user.permissions.includes('super_admin')
    ) {
      throw new ForbiddenException(
        'Solo el autor puede modificar esta reseña.',
      );
    }
  }

  private async findOrFail(id: number): Promise<ReviewDetailRecord> {
    let record: ReviewDetailRecord | null;
    try {
      record = await findReviewById(id);
    } catch (error) {
      readError(error);
    }
    if (!record) {
      throw new NotFoundException(`No existe una reseña con id ${id}.`);
    }
    return record;
  }
}
