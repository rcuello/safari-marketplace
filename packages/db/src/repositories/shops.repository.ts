/**
 * shops.repository.ts — vendedores del marketplace. El seed trae los 12
 * del mock; los retailers scrapeados (Alkosto, Éxito...) los crea el
 * scraper en runtime vía `findOrCreateShopBySlug`.
 */

import type { Prisma } from '../../generated/prisma/client/client';
import { prisma } from '../client';
import { _toShopRecord, type ShopRecord } from '../records';

export interface ListShopsInput {
  /** Solo tiendas activas por defecto. */
  isActive?: boolean;
  /** 1-based. Default 1. */
  page?: number;
  /** Default 30, como el mock. */
  limit?: number;
}

/** Listado paginado. `{ items, total }` para `buildPaginator`. */
export async function listShops(input: ListShopsInput = {}): Promise<{
  items: ShopRecord[];
  total: number;
}> {
  const page = Math.max(1, input.page ?? 1);
  const limit = input.limit ?? 30;
  const where: Prisma.ShopWhereInput = {
    isActive: input.isActive ?? true,
  };

  const [rows, total] = await Promise.all([
    prisma.shop.findMany({
      where,
      orderBy: { id: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.shop.count({ where }),
  ]);

  return { items: rows.map(_toShopRecord), total };
}

/** Una tienda por slug. `null` si no existe. */
export async function findShopBySlug(slug: string): Promise<ShopRecord | null> {
  const row = await prisma.shop.findUnique({ where: { slug } });
  return row ? _toShopRecord(row) : null;
}

/**
 * Para el scraper: devuelve la tienda del retailer, creándola si es la
 * primera vez que se le ve. Idempotente por slug.
 */
export async function findOrCreateShopBySlug(input: {
  slug: string;
  name: string;
  description?: string | null;
}): Promise<ShopRecord> {
  const row = await prisma.shop.upsert({
    where: { slug: input.slug },
    create: {
      slug: input.slug,
      name: input.name,
      description: input.description ?? null,
    },
    // El upsert exige `update`; no se pisa nada si ya existe.
    update: {},
  });
  return _toShopRecord(row);
}
