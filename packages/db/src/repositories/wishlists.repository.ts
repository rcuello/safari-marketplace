/**
 * wishlists.repository.ts — lista de deseos por usuario (US-53).
 *
 * El pivote `wishlists` (usuario ↔ producto) no se expone: las lecturas
 * devuelven `ProductRecord`, hidratado con el mismo include y el mismo mapper
 * que `products.repository.ts`, para que la API proyecte el contrato de
 * productos sin duplicarlo.
 *
 * Producto inexistente ⇒ `RecordNotFoundError('products', id)`. Quitar un
 * producto que no estaba en la lista ⇒ `RecordNotFoundError('wishlists', id)`.
 */

import { prisma } from '../client';
import { RecordNotFoundError } from '../domain-errors';
import { _toProductRecord, PRODUCT_INCLUDE, type ProductRecord } from './products.repository';

export interface ListWishlistProductsInput {
  page?: number;
  limit?: number;
}

/**
 * Productos de la lista del usuario, más recientes primero (`created_at
 * DESC`, desempate `product_id DESC`). Una fila cuyo producto se está
 * borrando en cascada se descarta, igual que en `listProducts`.
 */
export async function listWishlistProducts(
  userId: number,
  input: ListWishlistProductsInput = {}
): Promise<{ items: ProductRecord[]; total: number }> {
  const page = Math.max(1, input.page ?? 1);
  const limit = input.limit ?? 30;
  const where = { userId };
  const [rows, total] = await Promise.all([
    prisma.wishlist.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { productId: 'desc' }],
      include: { product: { include: PRODUCT_INCLUDE } },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.wishlist.count({ where }),
  ]);
  const items = rows
    .map((row) => _toProductRecord(row.product))
    .filter((record): record is ProductRecord => record !== null);
  return { items, total };
}

export async function isInWishlist(userId: number, productId: number): Promise<boolean> {
  const row = await prisma.wishlist.findUnique({
    where: { userId_productId: { userId, productId } },
    select: { productId: true },
  });
  return row !== null;
}

/** El producto si está en la lista del usuario; `null` si no. */
export async function findWishlistProduct(
  userId: number,
  productId: number
): Promise<ProductRecord | null> {
  const row = await prisma.wishlist.findUnique({
    where: { userId_productId: { userId, productId } },
    include: { product: { include: PRODUCT_INCLUDE } },
  });
  return row ? _toProductRecord(row.product) : null;
}

async function _findProduct(productId: number): Promise<ProductRecord> {
  const row = await prisma.product.findUnique({ where: { id: productId }, include: PRODUCT_INCLUDE });
  const record = row ? _toProductRecord(row) : null;
  if (!record) {
    throw new RecordNotFoundError('products', productId);
  }
  return record;
}

/** Idempotente: añadir un producto que ya estaba no falla ni duplica. */
export async function addToWishlist(userId: number, productId: number): Promise<ProductRecord> {
  const product = await _findProduct(productId);
  await prisma.wishlist.createMany({ data: [{ userId, productId }], skipDuplicates: true });
  return product;
}

/** Quita el producto y lo devuelve. */
export async function removeFromWishlist(
  userId: number,
  productId: number
): Promise<ProductRecord> {
  const product = await _findProduct(productId);
  const { count } = await prisma.wishlist.deleteMany({ where: { userId, productId } });
  if (count === 0) {
    throw new RecordNotFoundError('wishlists', productId);
  }
  return product;
}

/**
 * Invierte la pertenencia y devuelve el estado nuevo (`true` = ahora está).
 * Si dos toggles chocan, el `skipDuplicates` hace que el segundo también
 * deje el producto dentro en vez de fallar.
 */
export async function toggleWishlist(userId: number, productId: number): Promise<boolean> {
  await _findProduct(productId);
  const { count } = await prisma.wishlist.deleteMany({ where: { userId, productId } });
  if (count > 0) return false;
  await prisma.wishlist.createMany({ data: [{ userId, productId }], skipDuplicates: true });
  return true;
}
