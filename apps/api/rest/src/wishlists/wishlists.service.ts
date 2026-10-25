import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  addToWishlist,
  findWishlistProduct,
  getUserFriendlyMessage,
  isInWishlist,
  isPrismaConnectionError,
  listWishlistProducts,
  removeFromWishlist,
  toggleWishlist,
  type ProductRecord,
} from '@safari/db';
import { paginate } from '#src/common/pagination/paginate.js';
import { toWriteHttpException } from '#src/common/errors/domain-error.mapper.js';
import { Product } from '#src/products/entities/product.entity.js';
import { toProductDto } from '#src/products/product-dto.mapper.js';
import { CreateWishlistDto } from './dto/create-wishlists.dto.js';
import { GetWishlistDto } from './dto/get-wishlists.dto.js';

export const WISHLISTS_URL =
  '/wishlists?with=shop&orderBy=created_at&sortedBy=desc';

function readError(error: unknown): never {
  if (isPrismaConnectionError(error)) {
    throw new ServiceUnavailableException(getUserFriendlyMessage(error));
  }
  throw new InternalServerErrorException(getUserFriendlyMessage(error));
}

/** Guarda de id de US-31 antes de tocar el driver. Los ids son de producto. */
function toProductId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new BadRequestException(
      `\`product_id\` no admite \`${String(value)}\`.`,
    );
  }
  return id;
}

/**
 * Lista de deseos del usuario que llama (US-53). Antes era un estado global
 * en memoria; ahora cada usuario tiene la suya en el pivote `wishlists`. Las
 * filas se proyectan con `toProductDto`, el contrato de 20 claves de
 * `/products` (V-2). `my-wishlists` reutiliza este servicio con su url.
 */
@Injectable()
export class WishlistsService {
  /**
   * Defaults `page=1`/`limit=30` como el mock; `paginate()` recibe el
   * `limit` crudo. `orderBy`, `sortedBy` y `search` se ignoran (V-6): el
   * orden es siempre el más reciente primero.
   */
  async findAll(
    userId: number,
    { limit, page }: GetWishlistDto,
    url = WISHLISTS_URL,
  ) {
    if (!page) page = 1;
    if (!limit) limit = 30;
    try {
      const { items, total } = await listWishlistProducts(userId, {
        page: Number(page),
        limit: Number(limit),
      });
      return {
        data: items.map(toProductDto),
        ...paginate(total, page, limit, items.length, url),
      };
    } catch (error) {
      readError(error);
    }
  }

  /** El producto si está en la lista del usuario; si no, 404. */
  async findOne(userId: number, rawId: unknown): Promise<Product> {
    const productId = toProductId(rawId);
    let record: ProductRecord | null;
    try {
      record = await findWishlistProduct(userId, productId);
    } catch (error) {
      readError(error);
    }
    if (!record) {
      throw new NotFoundException(
        `El producto ${productId} no está en tu lista de deseos.`,
      );
    }
    return toProductDto(record);
  }

  /** Idempotente; `POST` y `PUT` lo usan. Producto inexistente ⇒ 404. */
  async add(userId: number, rawId: unknown): Promise<Product> {
    const productId = toProductId(rawId);
    try {
      return toProductDto(await addToWishlist(userId, productId));
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /** Quita el producto y lo devuelve; 404 si no estaba (V-5). */
  async remove(userId: number, rawId: unknown): Promise<Product> {
    const productId = toProductId(rawId);
    try {
      return toProductDto(await removeFromWishlist(userId, productId));
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /**
   * Devuelve el booleano DESNUDO con el estado nuevo, como el mock (el shop
   * ignora la respuesta y escribe `!inWishlist` en su caché). Por usuario y
   * persistido (V-3).
   */
  async toggle(
    userId: number,
    { product_id }: CreateWishlistDto,
  ): Promise<boolean> {
    const productId = toProductId(product_id);
    try {
      return await toggleWishlist(userId, productId);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /** `true`/`false` para el usuario que llama (V-4: antes, cuerpo vacío). */
  async isInWishlist(userId: number, rawId: unknown): Promise<boolean> {
    const productId = toProductId(rawId);
    try {
      return await isInWishlist(userId, productId);
    } catch (error) {
      readError(error);
    }
  }
}
