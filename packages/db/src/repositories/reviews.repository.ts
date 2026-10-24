/**
 * reviews.repository.ts — reseñas de producto (US-54).
 *
 * Cada lectura devuelve `ReviewDetailRecord`: la fila más su autor
 * (`UserRecord`), su producto hidratado (`ProductRecord`, mismo include y
 * mapper que `products.repository.ts`) y `abusiveReportsCount`. El conteo
 * sale de UN `groupBy` sobre `abusive_reports` por página (es polimórfica,
 * no hay relación para `_count`), nunca de una consulta por reseña.
 *
 * Los CHECK (`rating` 1..5, `photos` array) no existen para Prisma: se
 * validan aquí con `InvalidFieldValueError`. El único de expresión
 * `reviews_autor_producto_orden_key` (una reseña por usuario, producto y
 * orden) llega como `P2002` → `SlugConflictError` (409).
 */

import type { Prisma } from '../../generated/prisma/client/client';
import { prisma } from '../client';
import { now } from '../clock';
import {
  InvalidFieldValueError,
  RecordNotFoundError,
  translateCatalogWriteError,
} from '../domain-errors';
import {
  _toReviewRecord,
  _toUserRecord,
  type ReviewRecord,
  type UserRecord,
} from '../records';
import { _countReports } from './abusive-reports.repository';
import {
  _toProductRecord,
  PRODUCT_INCLUDE,
  type ProductRecord,
} from './products.repository';

export interface ReviewDetailRecord extends ReviewRecord {
  user: UserRecord;
  product: ProductRecord;
  abusiveReportsCount: number;
}

const REVIEW_INCLUDE = {
  user: true,
  product: { include: PRODUCT_INCLUDE },
} satisfies Prisma.ReviewInclude;

type ReviewPayload = Prisma.ReviewGetPayload<{
  include: typeof REVIEW_INCLUDE;
}>;

/** Un producto que se está borrando en cascada descarta la fila (como `listProducts`). */
async function _toDetails(
  rows: ReviewPayload[]
): Promise<ReviewDetailRecord[]> {
  const counts = await _countReports(
    'Review',
    rows.map((r) => r.id)
  );
  const details: ReviewDetailRecord[] = [];
  for (const row of rows) {
    const product = _toProductRecord(row.product);
    if (!product) continue;
    const record = _toReviewRecord(row);
    details.push({
      ...record,
      user: _toUserRecord(row.user),
      product,
      abusiveReportsCount: counts.get(record.id) ?? 0,
    });
  }
  return details;
}

export interface ListReviewsInput {
  productId?: number;
  shopId?: number;
  rating?: number;
  /** Slug del type del producto (`search=type.slug:<x>` del admin). */
  typeSlug?: string;
  page?: number;
  limit?: number;
}

/** Paginado en `id DESC`; los filtros se combinan con AND. */
export async function listReviews(
  input: ListReviewsInput = {}
): Promise<{ items: ReviewDetailRecord[]; total: number }> {
  const page = Math.max(1, input.page ?? 1);
  const limit = input.limit ?? 30;
  const where: Prisma.ReviewWhereInput = {
    ...(input.productId !== undefined && { productId: input.productId }),
    ...(input.shopId !== undefined && { shopId: input.shopId }),
    ...(input.rating !== undefined && { rating: input.rating }),
    ...(input.typeSlug && { product: { type: { slug: input.typeSlug } } }),
  };
  const [rows, total] = await Promise.all([
    prisma.review.findMany({
      where,
      orderBy: { id: 'desc' },
      include: REVIEW_INCLUDE,
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.review.count({ where }),
  ]);
  return { items: await _toDetails(rows), total };
}

export async function findReviewById(
  id: number
): Promise<ReviewDetailRecord | null> {
  const row = await prisma.review.findUnique({
    where: { id },
    include: REVIEW_INCLUDE,
  });
  if (!row) return null;
  return (await _toDetails([row]))[0] ?? null;
}

export interface CreateReviewInput {
  userId: number;
  productId: number;
  shopId: number;
  rating: number;
  comment: string;
  photos?: Prisma.InputJsonValue[];
  orderId?: number | null;
  variationOptionId?: number | null;
}

export type UpdateReviewInput = Partial<
  Pick<CreateReviewInput, 'rating' | 'comment' | 'photos'>
>;

function _assertValues(input: UpdateReviewInput): void {
  if (
    input.rating !== undefined &&
    !(Number.isInteger(input.rating) && input.rating >= 1 && input.rating <= 5)
  ) {
    throw new InvalidFieldValueError(
      'reviews',
      'rating',
      input.rating,
      'reviews_rating_check'
    );
  }
  if (input.photos !== undefined && !Array.isArray(input.photos)) {
    throw new InvalidFieldValueError(
      'reviews',
      'photos',
      'no-array',
      'reviews_photos_check'
    );
  }
}

function _translate(error: unknown, id?: number): unknown {
  return translateCatalogWriteError(error, {
    aggregate: 'reviews',
    id,
    uniqueField: 'user_id, product_id, order_id',
  });
}

/**
 * El producto debe existir (404) y `shopId` debe ser SU tienda (400): una
 * reseña cuenta para la tienda que vende el producto, no para la que diga el
 * body.
 */
export async function createReview(
  input: CreateReviewInput
): Promise<ReviewDetailRecord> {
  _assertValues(input);
  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    select: { shopId: true },
  });
  if (!product) {
    throw new RecordNotFoundError('products', input.productId);
  }
  if (Number(product.shopId) !== input.shopId) {
    throw new InvalidFieldValueError(
      'reviews',
      'shop_id',
      input.shopId,
      `tienda del producto ${input.productId}`
    );
  }
  try {
    const row = await prisma.review.create({
      data: {
        userId: input.userId,
        productId: input.productId,
        shopId: input.shopId,
        rating: input.rating,
        comment: input.comment,
        photos: input.photos ?? [],
        orderId: input.orderId ?? null,
        variationOptionId: input.variationOptionId ?? null,
      },
      include: REVIEW_INCLUDE,
    });
    return (await _toDetails([row]))[0];
  } catch (error) {
    throw _translate(error);
  }
}

/** Solo `rating`, `comment` y `photos`; fija `updatedAt: now()` (US-32). */
export async function updateReview(
  id: number,
  input: UpdateReviewInput
): Promise<ReviewDetailRecord> {
  _assertValues(input);
  try {
    const row = await prisma.review.update({
      where: { id },
      data: {
        ...(input.rating !== undefined && { rating: input.rating }),
        ...(input.comment !== undefined && { comment: input.comment }),
        ...(input.photos !== undefined && { photos: input.photos }),
        updatedAt: now(),
      },
      include: REVIEW_INCLUDE,
    });
    return (await _toDetails([row]))[0];
  } catch (error) {
    throw _translate(error, id);
  }
}

/**
 * Borra la reseña y la devuelve con su detalle. Sus reportes de abuso no
 * caen por FK (es polimórfica): se borran en la misma transacción.
 */
export async function deleteReview(id: number): Promise<ReviewDetailRecord> {
  const existing = await findReviewById(id);
  if (!existing) {
    throw new RecordNotFoundError('reviews', id);
  }
  try {
    await prisma.$transaction([
      prisma.abusiveReport.deleteMany({
        where: { modelType: 'Review', modelId: id },
      }),
      prisma.review.delete({ where: { id } }),
    ]);
    return existing;
  } catch (error) {
    throw _translate(error, id);
  }
}
