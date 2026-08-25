/**
 * categories.repository.ts — taxonomía de navegación (jerarquía de 2
 * niveles por adyacencia: 83 raíces, 115 hijas en el seed).
 *
 * El frontend consume las categorías como árbol (raíces con `children`)
 * filtrado por la vertical (`type.slug`).
 */

import type { Prisma } from '../../generated/prisma/client/client';
import { prisma } from '../client';
import {
  _toCategoryRecord,
  _toTypeRecord,
  type CategoryRecord,
  type TypeRecord,
} from '../records';

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface CategoryWithChildren extends CategoryRecord {
  type: TypeRecord;
  children: CategoryRecord[];
}

export interface ListCategoriesInput {
  typeSlug?: string;
  /** 1-based. Default 1. */
  page?: number;
  /** Default 30, como el mock. */
  limit?: number;
}

const CATEGORY_INCLUDE = {
  type: true,
  children: { orderBy: { id: 'asc' as const } },
} satisfies Prisma.CategoryInclude;

type CategoryPayload = Prisma.CategoryGetPayload<{
  include: typeof CATEGORY_INCLUDE;
}>;

function _toCategoryWithChildren(row: CategoryPayload): CategoryWithChildren {
  return {
    ..._toCategoryRecord(row),
    type: _toTypeRecord(row.type),
    children: row.children.map(_toCategoryRecord),
  };
}

// ---------------------------------------------------------------------------
// Funciones
// ---------------------------------------------------------------------------

/**
 * Árbol completo: solo raíces (`parentId: null`), cada una con sus hijas.
 * Con 198 categorías no hace falta paginar el árbol.
 */
export async function getCategoryTree(
  typeSlug?: string
): Promise<CategoryWithChildren[]> {
  const rows = await prisma.category.findMany({
    where: {
      parentId: null,
      ...(typeSlug && { type: { slug: typeSlug } }),
    },
    include: CATEGORY_INCLUDE,
    orderBy: { id: 'asc' },
  });
  return rows.map(_toCategoryWithChildren);
}

/**
 * Listado paginado de RAÍCES (con hijas embebidas), que es lo que el
 * endpoint /categories del mock devuelve. `{ items, total }`; el
 * envoltorio se arma con `buildPaginator`.
 */
export async function listCategories(input: ListCategoriesInput = {}): Promise<{
  items: CategoryWithChildren[];
  total: number;
}> {
  const page = Math.max(1, input.page ?? 1);
  const limit = input.limit ?? 30;
  const where: Prisma.CategoryWhereInput = {
    parentId: null,
    ...(input.typeSlug && { type: { slug: input.typeSlug } }),
  };

  const [rows, total] = await Promise.all([
    prisma.category.findMany({
      where,
      include: CATEGORY_INCLUDE,
      orderBy: { id: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.category.count({ where }),
  ]);

  return { items: rows.map(_toCategoryWithChildren), total };
}

/** Detalle por slug (raíz o hija), con type e hijas. `null` si no existe. */
export async function findCategoryBySlug(
  slug: string
): Promise<CategoryWithChildren | null> {
  const row = await prisma.category.findUnique({
    where: { slug },
    include: CATEGORY_INCLUDE,
  });
  return row ? _toCategoryWithChildren(row) : null;
}
