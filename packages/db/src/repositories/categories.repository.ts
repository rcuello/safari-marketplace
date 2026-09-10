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
  InvalidReferenceError,
  RecordNotFoundError,
  translateCatalogWriteError,
} from '../domain-errors';
import {
  _id,
  _toCategoryRecord,
  _toTypeRecord,
  type CategoryRecord,
  type TypeRecord,
} from '../records';
import { type ExistingSlugLookup, generateSlug, normalizeSlug } from '../slug';

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
    // `row.type` puede llegar NULL aunque `categories.type_id` sea `NOT NULL`:
    // Prisma resuelve el include en dos consultas, y si el type se borra entre
    // ambas (`ON DELETE CASCADE`, `db/schema.sql:269`) esta categoría ya está
    // en cascada de borrado. Se descarta la fila ENTERA —no solo su `type`—
    // para que tampoco reaparezca como hija o madre de otro nodo vía `kids`/
    // `recs`. Hoy solo alcanzable por el TOCTOU de `deleteType` (cuenta
    // dependientes y responde 409), pero es la misma forma que reventó en
    // `products` (C-1, US-27b). Invisible para `tsc`: Prisma tipa la relación
    // como no nula.
    if (row.type === null) continue;
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

// ---------------------------------------------------------------------------
// Escritura (admin) — CA-1, CA-2, CA-3. Único agregado jerárquico del
// catálogo: cuatro reglas de la arista madre→hija que el DDL no puede
// expresar (design.md, DD28-3) se validan aquí, en código, antes del write.
// ---------------------------------------------------------------------------

/**
 * Call site de `ExistingSlugLookup` (design.md DD28-8): la tabla nunca llega
 * al SQL compartido, `generateSlug` solo recibe esta función.
 */
const categorySlugs: ExistingSlugLookup = async (prefix) =>
  (
    await prisma.category.findMany({
      where: { slug: { startsWith: prefix } },
      select: { slug: true },
    })
  ).map((r) => r.slug);

export interface CreateCategoryInput {
  name: string;
  /** Si llega no vacío, es la fuente del slug; si no, se deriva de `name`. */
  slug?: string | null;
  details?: string | null;
  /** el admin manda `''` cuando no elige icono. */
  icon?: string | null;
  /** `jsonb`; `null` se trata como ausente (DD-5, US-27b). */
  image?: Prisma.InputJsonValue;
  /** `null` = raíz. */
  parentId?: number | null;
  /** NOT NULL en el DDL. */
  typeId: number;
  /** Ausente ⇒ `DEFAULT 'es'`. */
  language?: string;
}

/** `slug` inmutable por tipo (CA-2); `typeId` SÍ mutable (DD28-5). */
export type UpdateCategoryInput = Partial<Omit<CreateCategoryInput, 'slug'>>;

const MAX_ANCESTOR_HOPS = 32;

/**
 * Regla 1 de DD28-3: forma entera de `type_id` y de `parent`. MUST correr
 * ANTES del dispatch `parentId != null` en create/update — `NaN != null` es
 * `true`, así que sin este orden `{"parent":"abc"}` llegaría a
 * `_assertParentEdge(NaN, …)` y de ahí a `BigInt(NaN)` (RangeError sin
 * `.code`, HTTP 500 — ver design.md, Data Flow).
 */
function _assertIntegerRef(value: number | null | undefined, field: string): void {
  if (value != null && !Number.isInteger(value)) {
    throw new InvalidReferenceError('categories', field, value);
  }
}

/**
 * Reglas 2 (autorreferencia) → 3 (existe) → 4 (mismo `type_id`), en ese
 * orden. Al final, solo cuando `childId !== null` (es decir, únicamente
 * desde `updateCategory`), dispara la guarda de ciclo (reglas 5/6)
 * arrancando en `_id(parent.parentId)` — la madre ya está en la mano, así
 * que no hace falta un segundo round trip (DD28-4).
 */
async function _assertParentEdge(
  parentId: number,
  effectiveTypeId: number,
  childId: number | null
): Promise<void> {
  if (childId !== null && parentId === childId) {
    throw new InvalidReferenceError(
      'categories',
      'parent_id (autorreferencia)',
      childId
    );
  }

  const parent = await prisma.category.findUnique({
    where: { id: parentId },
    select: { id: true, parentId: true, typeId: true },
  });
  if (!parent) {
    throw new InvalidReferenceError('categories', 'parent_id', parentId);
  }
  if (_id(parent.typeId) !== effectiveTypeId) {
    throw new InvalidReferenceError(
      'categories',
      `parent_id (dentro de type_id ${effectiveTypeId})`,
      parentId
    );
  }

  if (childId !== null) {
    await _assertNoAncestorCycle(childId, _id(parent.parentId));
  }
}

/**
 * Reglas 5/6 de DD28-3: ascenso iterativo desde `startFrom` (=
 * `_id(parent.parentId)`, ya sondeado por `_assertParentEdge`), tope
 * defensivo de 32 saltos. **`_id()` en cada valor leído de Prisma es
 * obligatorio**: sin él, `cursor === id` es `bigint === number`, siempre
 * `false`, y la guarda de ciclo nunca dispara (design.md, DD28-3 "Regla
 * normativa transversal" — el único test que atrapa ese fallo es el A→B→A
 * de integración, ningún test de tipos lo delata).
 */
async function _assertNoAncestorCycle(
  id: number,
  startFrom: number | null
): Promise<void> {
  let cursor: number | null = startFrom;
  for (let hops = 0; hops < MAX_ANCESTOR_HOPS; hops++) {
    if (cursor === null) return; // se alcanzó la raíz: sin ciclo
    if (cursor === id) {
      throw new InvalidReferenceError(
        'categories',
        'parent_id (ciclo: la madre propuesta desciende de esta categoría)',
        id
      );
    }
    const row = await prisma.category.findUnique({
      where: { id: cursor },
      select: { id: true, parentId: true },
    });
    if (!row) return; // ancestro desaparecido: cadena rota, sin ciclo posible
    cursor = _id(row.parentId); // OBLIGATORIO: row.parentId es bigint
  }
  throw new InvalidReferenceError(
    'categories',
    'parent_id (cadena de ancestros supera 32 saltos)',
    id
  );
}

/**
 * Regla 7 de DD28-5: cambiar el `type_id` de un nodo con hijas de otro
 * `type_id` (tras el cambio) queda prohibido. Consecuencia observable
 * declarada: en un nodo CON hijas, cualquier cambio de type da 400 siempre;
 * `type_id` solo es mutable de hecho en una categoría hoja.
 */
async function _assertChildrenShareType(id: number, typeId: number): Promise<void> {
  const mismatched = await prisma.category.count({
    where: { parentId: id, typeId: { not: typeId } },
  });
  if (mismatched > 0) {
    throw new InvalidReferenceError(
      'categories',
      `type_id (${mismatched} hija(s) con otro type_id)`,
      typeId
    );
  }
}

/**
 * Re-fetch tras escribir (DD28-2): `_assembleTree(_loadFlat())` completo,
 * nunca `findCategoryByIdOrSlug` — esa función cae al barrido por slug si
 * el id ya no existe, ambigüedad innecesaria en una ruta que solo conoce
 * ids. `null` si la fila desapareció entre el write y el re-fetch (carrera
 * declarada, DD28-2).
 */
async function _loadNode(id: number): Promise<CategoryTreeNode | null> {
  return _assembleTree(await _loadFlat()).get(id) ?? null;
}

/** Crea una categoría raíz o hija. El slug lo calcula `generateSlug` (DD28-8). */
export async function createCategory(
  input: CreateCategoryInput
): Promise<CategoryTreeNode> {
  _assertIntegerRef(input.typeId, 'type_id');
  _assertIntegerRef(input.parentId, 'parent_id');

  if (input.parentId != null) {
    await _assertParentEdge(input.parentId, input.typeId, null);
  }

  const slug = await generateSlug(
    { name: input.name, slug: input.slug },
    categorySlugs,
    'categories'
  );

  let createdId: number;
  try {
    const row = await prisma.category.create({
      data: {
        name: input.name,
        slug,
        typeId: input.typeId,
        ...(input.details !== undefined && { details: input.details }),
        ...(input.icon !== undefined && { icon: input.icon }),
        ...(input.image != null && { image: input.image }),
        ...(input.parentId !== undefined && { parentId: input.parentId }),
        ...(input.language !== undefined && { language: input.language }),
      },
      select: { id: true },
    });
    createdId = _id(row.id);
  } catch (error) {
    // Sin `uniqueField: 'slug'` a propósito (gate corrective, finding 1):
    // bajo Prisma 7 + adapter-pg, un `P2003` llega sin `meta.field_name`, y
    // `translateCatalogWriteError` cae al `uniqueField` del contexto para
    // CUALQUIER violación de FK — no solo la de `slug`. Con
    // `uniqueField: 'slug'` fijo, un `type_id` inexistente (o un `parent_id`
    // borrado por una carrera entre la guarda y el write) se reportaba como
    // «categories.slug referencia un registro inexistente», culpando al
    // campo equivocado. Precedente de la casa: `createTag`
    // (`tags.repository.ts:143-147`) omite `uniqueField` a propósito y
    // acepta el `'desconocida'` más vago pero honesto de
    // `translateCatalogWriteError` (`domain-errors.ts:150-156`).
    throw translateCatalogWriteError(error, {
      aggregate: 'categories',
    });
  }

  const node = await _loadNode(createdId);
  if (!node) {
    throw new RecordNotFoundError('categories', createdId);
  }
  return node;
}

/**
 * Actualiza una categoría: campos, madre y/o type. El `slug` es inmutable a
 * nivel de tipo (`UpdateCategoryInput` lo omite); si llega `name`, se valida
 * con `normalizeSlug` y se descarta el resultado — solo por su efecto
 * lateral `EmptySlugError` (DD28-8, precedente `updateType`). `updatedAt`
 * NO se fija a mano: el trigger `categories_updated_at`
 * (`db/schema.sql:490`) lo hace con el reloj de Postgres (DD28-7).
 */
export async function updateCategory(
  id: number,
  input: UpdateCategoryInput
): Promise<CategoryTreeNode> {
  if (input.name !== undefined) {
    await normalizeSlug(input.name, 'categories');
  }
  _assertIntegerRef(input.typeId, 'type_id');
  _assertIntegerRef(input.parentId, 'parent_id');

  const current = await prisma.category.findUnique({ where: { id } });
  if (!current) {
    throw new RecordNotFoundError('categories', id);
  }

  if (input.typeId !== undefined && input.typeId !== _id(current.typeId)) {
    await _assertChildrenShareType(id, input.typeId);
  }

  const effectiveTypeId = input.typeId ?? _id(current.typeId);
  const effectiveParentId =
    input.parentId !== undefined ? input.parentId : _id(current.parentId);

  if (effectiveParentId !== null) {
    await _assertParentEdge(effectiveParentId, effectiveTypeId, id);
  }

  try {
    await prisma.category.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.details !== undefined && { details: input.details }),
        ...(input.icon !== undefined && { icon: input.icon }),
        ...(input.image != null && { image: input.image }),
        ...(input.parentId !== undefined && { parentId: input.parentId }),
        ...(input.typeId !== undefined && { typeId: input.typeId }),
        ...(input.language !== undefined && { language: input.language }),
      },
    });
  } catch (error) {
    // Ver el comentario equivalente en `createCategory`: sin `uniqueField`
    // fijo (gate corrective, finding 1) — un `P2003` (madre borrada por una
    // carrera entre la guarda y el write, o `type_id` inexistente) ya no se
    // atribuye a `slug`.
    throw translateCatalogWriteError(error, {
      aggregate: 'categories',
      id,
    });
  }

  const node = await _loadNode(id);
  if (!node) {
    throw new RecordNotFoundError('categories', id);
  }
  return node;
}

/**
 * Borra una categoría. `_loadNode` corre ANTES del `DELETE`: es a la vez la
 * comprobación de existencia del `find-then-delete` y el snapshot que se
 * devuelve (DD28-1). `ON DELETE SET NULL` re-enraíza a las hijas en la base
 * y `category_product` se desenlaza en CASCADE — cero código de
 * re-enraizado (D28-6). **Divergencia declarada**: `children` en la
 * respuesta refleja el árbol PRE-borrado (`parent_id` antiguo); el admin
 * ignora el body del `DELETE`.
 */
export async function deleteCategory(id: number): Promise<CategoryTreeNode> {
  const snapshot = await _loadNode(id);
  if (!snapshot) {
    throw new RecordNotFoundError('categories', id);
  }

  try {
    await prisma.category.delete({ where: { id } });
  } catch (error) {
    throw translateCatalogWriteError(error, {
      aggregate: 'categories',
      id,
    });
  }

  return snapshot;
}
