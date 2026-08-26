/**
 * manufacturers.repository.ts — marcas. Destino natural del campo `marca`
 * del scraper, que las crea en runtime vía `findOrCreateManufacturerBySlug`.
 */

import type { Prisma } from '../../generated/prisma/client/client';
import { prisma } from '../client';
import { _toManufacturerRecord, type ManufacturerRecord } from '../records';

export interface ListManufacturersInput {
  typeSlug?: string;
  /** Búsqueda parcial por nombre, case-insensitive. */
  name?: string;
  /** 1-based. Default 1. */
  page?: number;
  /** Default 30, como el mock. */
  limit?: number;
}

/** Listado paginado. `{ items, total }` para `buildPaginator`. */
export async function listManufacturers(
  input: ListManufacturersInput = {}
): Promise<{ items: ManufacturerRecord[]; total: number }> {
  const page = Math.max(1, input.page ?? 1);
  const limit = input.limit ?? 30;
  const where: Prisma.ManufacturerWhereInput = {
    ...(input.typeSlug && { type: { slug: input.typeSlug } }),
    ...(input.name && { name: { contains: input.name, mode: 'insensitive' as const } }),
  };

  const [rows, total] = await Promise.all([
    prisma.manufacturer.findMany({
      where,
      orderBy: { id: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.manufacturer.count({ where }),
  ]);

  return { items: rows.map(_toManufacturerRecord), total };
}

/** Una marca por slug. `null` si no existe. */
export async function findManufacturerBySlug(
  slug: string
): Promise<ManufacturerRecord | null> {
  const row = await prisma.manufacturer.findUnique({ where: { slug } });
  return row ? _toManufacturerRecord(row) : null;
}

/**
 * Para el scraper: devuelve la marca, creándola si no existe.
 * Idempotente por slug.
 */
export async function findOrCreateManufacturerBySlug(input: {
  slug: string;
  name: string;
  typeId?: number | null;
}): Promise<ManufacturerRecord> {
  const row = await prisma.manufacturer.upsert({
    where: { slug: input.slug },
    create: {
      slug: input.slug,
      name: input.name,
      typeId: input.typeId ?? null,
    },
    update: {},
  });
  return _toManufacturerRecord(row);
}
