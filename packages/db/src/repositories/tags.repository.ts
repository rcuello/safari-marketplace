/**
 * tags.repository.ts — etiquetas de productos.
 */

import type { Prisma } from '../../generated/prisma/client/client';
import { prisma } from '../client';
import { _toTagRecord, type TagRecord } from '../records';

export interface ListTagsInput {
  typeSlug?: string;
  /** 1-based. Default 1. */
  page?: number;
  /** Default 30, como el mock. */
  limit?: number;
}

/** Listado paginado. `{ items, total }` para `buildPaginator`. */
export async function listTags(input: ListTagsInput = {}): Promise<{
  items: TagRecord[];
  total: number;
}> {
  const page = Math.max(1, input.page ?? 1);
  const limit = input.limit ?? 30;
  const where: Prisma.TagWhereInput = {
    ...(input.typeSlug && { type: { slug: input.typeSlug } }),
  };

  const [rows, total] = await Promise.all([
    prisma.tag.findMany({
      where,
      orderBy: { id: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.tag.count({ where }),
  ]);

  return { items: rows.map(_toTagRecord), total };
}

/** Un tag por slug. `null` si no existe. */
export async function findTagBySlug(slug: string): Promise<TagRecord | null> {
  const row = await prisma.tag.findUnique({ where: { slug } });
  return row ? _toTagRecord(row) : null;
}
