/**
 * categories.repository.ts — taxonomía de navegación por adyacencia.
 *
 * 198 categorías en TRES niveles: 83 raíces + 109 hijas + 6 NIETAS
 * (165-168 bajo 164, y 169,170 bajo 163; 163/164 bajo la raíz 124,
 * todo en type_id 7 = daily-needs). Profundidad máxima 2 saltos, 0
 * bisnietos — verificado con WITH RECURSIVE contra la base real.
 *
 * El comentario anterior decía "2 niveles reales" y ese error se
 * materializó en un `include` de un solo nivel que borraba esas 6
 * filas del payload. Por eso el árbol NO se arma con `include`: se
 * arma con _assembleTree() sobre una findMany() plana, que no tiene
 * ninguna constante de profundidad. Si mañana hay un 4º nivel, esto
 * sigue funcionando y ningún comentario se vuelve mentira.
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

/** Hacia arriba. Sin `children` y sin `type`: no puede volver a bajar. */
export interface CategoryAncestor extends CategoryRecord {
  parent: CategoryAncestor | null;
}

/**
 * Hacia abajo. `parent` es la madre INMEDIATA y PLANA (un CategoryRecord,
 * que no tiene `parent` ni `children`): la recursión solo baja.
 */
export interface CategoryDescendant extends CategoryRecord {
  parent: CategoryRecord | null;
  children: CategoryDescendant[];
}

/** El nodo que el endpoint publica: cadena completa arriba, subárbol abajo. */
export interface CategoryTreeNode extends CategoryRecord {
  type: TypeRecord;
  parent: CategoryAncestor | null;
  children: CategoryDescendant[];
}

export interface ListCategoriesInput {
  typeSlug?: string;
  /** Búsqueda parcial por nombre, case-insensitive (Decisión G). */
  name?: string;
  /**
   * `true` (default): solo raíces en el top level, cada una con su
   * subárbol. `false`: los 198 nodos planos en el top level, cada uno
   * con su propio subárbol (Decisión D — semántica de `parent=all`).
   */
  rootsOnly?: boolean;
  /** 1-based. Default 1. */
  page?: number;
  /** Default 30, como el mock. */
  limit?: number;
}

const CATEGORY_INCLUDE = {
  type: true,
} satisfies Prisma.CategoryInclude;

type CategoryPayload = Prisma.CategoryGetPayload<{
  include: typeof CATEGORY_INCLUDE;
}>;

// ---------------------------------------------------------------------------
// Ensamblador — puro, síncrono, sin `prisma`: se prueba sin base (Decisión A)
// ---------------------------------------------------------------------------

/**
 * `recs.get(rec.parentId)` — la madre PLANA (un CategoryRecord, sin
 * `parent` ni `children` propios), que es lo que la Decisión C necesita
 * para armar la forma `E` del `parent` de un descendiente.
 */
function _immediate(
  rec: CategoryRecord,
  recs: Map<number, CategoryRecord>
): CategoryRecord | null {
  return rec.parentId === null ? null : (recs.get(rec.parentId) ?? null);
}

function _assembleTree(rows: CategoryPayload[]): Map<number, CategoryTreeNode> {
  // 1. índices planos.
  const recs = new Map<number, CategoryRecord>();
  const types = new Map<number, TypeRecord>();
  const kids = new Map<number, number[]>(); // parentId -> ids (id asc)
  for (const row of rows) {
    const rec = _toCategoryRecord(row);
    recs.set(rec.id, rec);
    types.set(rec.id, _toTypeRecord(row.type));
    if (rec.parentId !== null) {
      const bucket = kids.get(rec.parentId);
      if (bucket) bucket.push(rec.id);
      else kids.set(rec.parentId, [rec.id]);
    }
  }

  // 2. memos: cada subárbol y cada cadena se construyen UNA sola vez, así
  //    que el coste total es O(n) aunque la recursión sea por nodo.
  const down = new Map<number, CategoryDescendant>();
  const up = new Map<number, CategoryAncestor | null>();

  const descend = (id: number, path: Set<number>): CategoryDescendant => {
    const memo = down.get(id);
    if (memo) return memo;
    const rec = recs.get(id);
    if (!rec) throw new Error(`categoría ${id} ausente del set cargado`);
    // Guarda de ciclo: el DDL solo prohíbe la autorreferencia
    // (`categories_no_autoreferencia`), NO un ciclo A->B->A. Sin esta
    // guarda una fila corrupta reventaría el proceso Nest con un stack
    // overflow en vez de devolver un árbol truncado.
    if (path.has(id)) {
      return { ...rec, parent: _immediate(rec, recs), children: [] };
    }
    const next = new Set(path).add(id);
    const node: CategoryDescendant = {
      ...rec,
      parent: _immediate(rec, recs),
      children: (kids.get(id) ?? []).map((k) => descend(k, next)),
    };
    down.set(id, node);
    return node;
  };

  const ascend = (id: number, path: Set<number>): CategoryAncestor | null => {
    if (up.has(id)) return up.get(id) ?? null;
    const rec = recs.get(id);
    if (!rec) return null;
    if (path.has(id)) {
      up.set(id, { ...rec, parent: null });
      return up.get(id) ?? null;
    }
    const next = new Set(path).add(id);
    const parentAncestor =
      rec.parentId === null ? null : ascend(rec.parentId, next);
    const node: CategoryAncestor = { ...rec, parent: parentAncestor };
    up.set(id, node);
    return node;
  };

  const nodes = new Map<number, CategoryTreeNode>();
  for (const id of recs.keys()) {
    const rec = recs.get(id);
    if (!rec) continue;
    const type = types.get(id);
    if (!type) continue;
    const parent = rec.parentId === null ? null : ascend(rec.parentId, new Set());
    const children = (kids.get(id) ?? []).map((k) => descend(k, new Set([id])));
    nodes.set(id, { ...rec, type, parent, children });
  }
  return nodes;
}

async function _loadFlat(
  where: Prisma.CategoryWhereInput = {}
): Promise<CategoryPayload[]> {
  return prisma.category.findMany({
    where,
    include: CATEGORY_INCLUDE, // = { type: true }, sin include anidado
    orderBy: { id: 'asc' },
  });
}

// ---------------------------------------------------------------------------
// Funciones públicas
// ---------------------------------------------------------------------------

/**
 * Árbol completo: solo raíces (`parentId: null`), cada una con su
 * subárbol. Con 198 categorías no hace falta paginar el árbol.
 */
export async function getCategoryTree(
  typeSlug?: string
): Promise<CategoryTreeNode[]> {
  const rows = await _loadFlat(typeSlug ? { type: { slug: typeSlug } } : {});
  const nodes = _assembleTree(rows);
  return [...nodes.values()].filter((n) => n.parentId === null);
}

/**
 * Listado paginado. `rootsOnly` decide qué nodos van al top level
 * (Decisión D); el subárbol y la cadena ascendente de cada nodo son
 * idénticos en los dos modos, porque el set completo ya está cargado y
 * ensamblado antes de decidir el top level.
 */
export async function listCategories(input: ListCategoriesInput = {}): Promise<{
  items: CategoryTreeNode[];
  total: number;
}> {
  const page = Math.max(1, input.page ?? 1);
  const limit = input.limit ?? 30;
  const rootsOnly = input.rootsOnly ?? true;
  const where: Prisma.CategoryWhereInput = {
    ...(input.typeSlug && { type: { slug: input.typeSlug } }),
    ...(input.name && {
      name: { contains: input.name, mode: 'insensitive' as const },
    }),
  };

  const rows = await _loadFlat(where);
  const nodes = _assembleTree(rows);
  const top = rootsOnly
    ? [...nodes.values()].filter((n) => n.parentId === null)
    : [...nodes.values()];

  const total = top.length;
  const items = top.slice((page - 1) * limit, page * limit);
  return { items, total };
}

/**
 * Detalle por id O por slug, con la MISMA forma que un elemento del
 * listado. Reproduce la precedencia del mock
 * (`p.id === Number(param) || p.slug === param`,
 * categories.service.ts:58-60): el id gana. `null` si no existe.
 */
export async function findCategoryByIdOrSlug(
  param: string
): Promise<CategoryTreeNode | null> {
  const nodes = _assembleTree(await _loadFlat());
  const asId = Number(param);
  if (Number.isInteger(asId)) {
    const byId = nodes.get(asId);
    if (byId) return byId;
  }
  for (const node of nodes.values()) {
    if (node.slug === param) return node;
  }
  return null;
}
