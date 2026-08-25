/**
 * types.repository.ts — las "verticales" del marketplace (grocery,
 * gadget, books...). Controlan el layout del home; son 10 filas, no se
 * paginan.
 */

import { prisma } from '../client';
import { _toTypeRecord, type TypeRecord } from '../records';

/** Todos los types, en el orden de inserción (id asc, como el mock). */
export async function listTypes(): Promise<TypeRecord[]> {
  const rows = await prisma.type.findMany({ orderBy: { id: 'asc' } });
  return rows.map(_toTypeRecord);
}

/** Un type por slug (`/{locale}/{type.slug}`). `null` si no existe. */
export async function findTypeBySlug(slug: string): Promise<TypeRecord | null> {
  const row = await prisma.type.findUnique({ where: { slug } });
  return row ? _toTypeRecord(row) : null;
}
