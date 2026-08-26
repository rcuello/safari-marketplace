/**
 * types.repository.ts — las "verticales" del marketplace (grocery,
 * gadget, books...). Controlan el layout del home; son 10 filas, no se
 * paginan.
 */

import type { Prisma } from '../../generated/prisma/client/client';
import { prisma } from '../client';
import { _toTypeRecord, type TypeRecord } from '../records';

/** Filtro de la caja de búsqueda del admin (`pages/groups/index.tsx`). */
export interface ListTypesInput {
  /** Búsqueda parcial por nombre, case-insensitive. */
  name?: string;
}

/** Todos los types, en el orden de inserción (id asc, como el mock). */
export async function listTypes(
  input: ListTypesInput = {}
): Promise<TypeRecord[]> {
  const where: Prisma.TypeWhereInput = {
    ...(input.name && { name: { contains: input.name, mode: 'insensitive' as const } }),
  };
  const rows = await prisma.type.findMany({ where, orderBy: { id: 'asc' } });
  return rows.map(_toTypeRecord);
}

/** Un type por slug (`/{locale}/{type.slug}`). `null` si no existe. */
export async function findTypeBySlug(slug: string): Promise<TypeRecord | null> {
  const row = await prisma.type.findUnique({ where: { slug } });
  return row ? _toTypeRecord(row) : null;
}
