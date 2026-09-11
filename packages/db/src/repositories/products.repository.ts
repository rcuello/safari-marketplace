/**
 * products.repository.ts — el agregado central del catálogo.
 *
 * Dos consumidores con necesidades distintas:
 *   · la tienda LEE: listado con los filtros que el frontend manda de
 *     verdad (`type.slug`, `categories.slug`, `name`, rango de precio...)
 *     y detalle por slug con relaciones + related_products.
 *   · el scraper ESCRIBE: upsert idempotente por la clave natural
 *     (source_store, source_product_id) — el índice único parcial
 *     products_procedencia_key.
 *
 * Los CHECK constraints de la tabla (products_rebaja_valida,
 * products_simple_con_precio, products_procedencia_completa) no existen
 * para Prisma: aquí se validan ANTES de escribir y, como backstop, la
 * violación que llegue de Postgres se traduce a un error de dominio
 * legible (`_translateCheckViolation`).
 */

import type { Prisma } from '../../generated/prisma/client/client';
import { prisma } from '../client';
import { now } from '../clock';
import {
  CATALOG_ERROR_CODES,
  CatalogWriteError,
  InvalidReferenceError,
  RecordNotFoundError,
  translateCatalogWriteError,
} from '../domain-errors';
import {
  _dec,
  _id,
  _toCategoryRecord,
  _toManufacturerRecord,
  _toShopRecord,
  _toTagRecord,
  _toTypeRecord,
  type CategoryRecord,
  type ManufacturerRecord,
  type ShopRecord,
  type TagRecord,
  type TypeRecord,
} from '../records';
import { type ExistingSlugLookup, generateSlug, normalizeSlug } from '../slug';

// ---------------------------------------------------------------------------
// Include compartido — todo listado/detalle carga las mismas relaciones,
// porque el frontend de Pickbazar espera el producto "hidratado" (type,
// shop, categories, tags, manufacturer embebidos).
// ---------------------------------------------------------------------------

const PRODUCT_INCLUDE = {
  type: true,
  shop: true,
  manufacturer: true,
  categories: { include: { category: true } },
  tags: { include: { tag: true } },
} satisfies Prisma.ProductInclude;

type ProductPayload = Prisma.ProductGetPayload<{
  include: typeof PRODUCT_INCLUDE;
}>;

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface ProductRecord {
  id: number;
  name: string;
  slug: string;
  description: string;
  typeId: number;
  shopId: number;
  manufacturerId: number | null;
  productType: string;
  price: number | null;
  salePrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  quantity: number;
  inStock: boolean;
  soldQuantity: number;
  sku: string | null;
  unit: string;
  status: string;
  visibility: string;
  image: Prisma.JsonValue | null;
  gallery: Prisma.JsonValue;
  ratings: number;
  totalReviews: number;
  isTaxable: boolean;
  isDigital: boolean;
  isExternal: boolean;
  externalProductUrl: string | null;
  language: string;
  translatedLanguages: string[];
  sourceStore: string | null;
  sourceProductId: string | null;
  sourceUrl: string | null;
  scrapedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  type: TypeRecord;
  shop: ShopRecord;
  manufacturer: ManufacturerRecord | null;
  categories: CategoryRecord[];
  tags: TagRecord[];
}

export interface ProductDetail extends ProductRecord {
  /** Productos del mismo type (incluye el propio; ver D-1 en findProductBySlug). */
  relatedProducts: ProductRecord[];
}

/**
 * Filtros del listado. Espejo de lo que formatSearchParams() del shop
 * serializa (`type.slug:gadget;categories.slug:laptop;...`). `status` y
 * `visibility` tienen los defaults que el frontend manda SIEMPRE.
 */
export interface ListProductsInput {
  typeSlug?: string;
  categorySlug?: string;
  shopId?: number;
  /** Búsqueda parcial por nombre, case-insensitive (índice trgm). */
  name?: string;
  minPrice?: number;
  maxPrice?: number;
  manufacturerSlug?: string;
  tagSlug?: string;
  status?: string;
  visibility?: string;
  /** `where: quantity: { lte: … }` — vistas de inventario (products-stock). */
  maxQuantity?: number;
  /**
   * Criterio de orden. Ausente/`'id'` → `id asc` (hoy). `'ratings'` /
   * `'soldQuantity'` → desc por esa columna con desempate `id asc`
   * INCORPORADO: 1194/1200 filas empatan en `ratings = 0.00`, sin el
   * desempate la cola del top-N no es determinista (US-5 Decision B).
   */
  orderBy?: 'id' | 'ratings' | 'soldQuantity';
  /**
   * Default `true`: aplica `status`/`visibility` de vitrina como hoy. En
   * `false`, esos dos filtros solo se aplican si el llamador los envía
   * explícitamente — para vistas de admin/inventario que el mock tampoco
   * filtraba (US-5 Decision C). No debilita el default para nadie más.
   */
  applyStorefrontDefaults?: boolean;
  /** 1-based. Default 1. */
  page?: number;
  /** Default 30, como el mock. */
  limit?: number;
}

export interface UpsertScrapedProductInput {
  // Identidad del scraper — la clave del upsert.
  sourceStore: string;
  sourceProductId: string;
  sourceUrl?: string | null;
  scrapedAt?: Date;

  name: string;
  slug: string;
  description?: string;
  typeId: number;
  shopId: number;
  manufacturerId?: number | null;
  /** Obligatorio: los scrapeados son 'simple' y el CHECK exige precio. */
  price: number;
  salePrice?: number | null;
  quantity?: number;
  inStock?: boolean;
  sku?: string | null;
  unit?: string;
  image?: Prisma.InputJsonValue;
  gallery?: Prisma.InputJsonValue;
  /** Reemplaza el set completo de categorías del producto. */
  categoryIds?: number[];
  /** Reemplaza el set completo de tags del producto. */
  tagIds?: number[];
}

export const DEFAULT_PAGE_SIZE = 30;

// ---------------------------------------------------------------------------
// Lectura (tienda)
// ---------------------------------------------------------------------------

function buildWhere(input: ListProductsInput): Prisma.ProductWhereInput {
  const priceFilter: Prisma.DecimalFilter<'Product'> = {};
  if (input.minPrice !== undefined) priceFilter.gte = input.minPrice;
  if (input.maxPrice !== undefined) priceFilter.lte = input.maxPrice;

  // El shop manda status/visibility en TODAS las consultas de catálogo; son
  // el default para que un caller distraído no liste borradores. Con
  // `applyStorefrontDefaults: false` (vistas de admin/inventario, US-5
  // Decision C) esos dos filtros SOLO se aplican si el llamador los envía.
  const applyDefaults = input.applyStorefrontDefaults !== false;

  return {
    ...(applyDefaults
      ? {
          status: input.status ?? 'publish',
          visibility: input.visibility ?? 'visibility_public',
        }
      : {
          ...(input.status !== undefined && { status: input.status }),
          ...(input.visibility !== undefined && {
            visibility: input.visibility,
          }),
        }),
    ...(input.typeSlug && { type: { slug: input.typeSlug } }),
    ...(input.categorySlug && {
      categories: { some: { category: { slug: input.categorySlug } } },
    }),
    ...(input.shopId !== undefined && { shopId: input.shopId }),
    ...(input.name && {
      name: { contains: input.name, mode: 'insensitive' as const },
    }),
    ...(input.manufacturerSlug && {
      manufacturer: { slug: input.manufacturerSlug },
    }),
    ...(input.tagSlug && { tags: { some: { tag: { slug: input.tagSlug } } } }),
    // Rango sobre `price` (respaldado por products_precio_idx). Un producto
    // 'variable' (price NULL) no matchea el rango — igual que en SQL.
    ...((input.minPrice !== undefined || input.maxPrice !== undefined) && {
      price: priceFilter,
    }),
    ...(input.maxQuantity !== undefined && {
      quantity: { lte: input.maxQuantity },
    }),
  };
}

/**
 * Traduce `ListProductsInput.orderBy` al `orderBy` de Prisma, con el
 * desempate `id asc` INCORPORADO (US-5 Decision B) — no se delega al
 * llamador porque se olvida.
 */
function buildOrderBy(
  orderBy: ListProductsInput['orderBy']
): Prisma.ProductOrderByWithRelationInput | Prisma.ProductOrderByWithRelationInput[] {
  switch (orderBy) {
    case 'ratings':
      return [{ ratings: 'desc' }, { id: 'asc' }];
    case 'soldQuantity':
      return [{ soldQuantity: 'desc' }, { id: 'asc' }];
    case 'id':
    default:
      return { id: 'asc' };
  }
}

/**
 * Listado paginado por offset. Devuelve `{ items, total }`; el envoltorio
 * del mock (`{ data, total, current_page, ... }`) se arma con
 * `buildPaginator` de `src/pagination.ts`.
 */
export async function listProducts(input: ListProductsInput = {}): Promise<{
  items: ProductRecord[];
  total: number;
}> {
  const page = Math.max(1, input.page ?? 1);
  const limit = input.limit ?? DEFAULT_PAGE_SIZE;
  const where = buildWhere(input);

  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: PRODUCT_INCLUDE,
      // Orden estable = paginación estable. Default: el mock sirve los
      // productos en el orden del JSON, que coincide con id ascendente.
      // `orderBy: 'ratings'|'soldQuantity'` trae su propio desempate `id asc`
      // (buildOrderBy, US-5 Decision B).
      orderBy: buildOrderBy(input.orderBy),
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.product.count({ where }),
  ]);

  // `total` sale del `count` y NO se corrige si `_toProductRecord` descarta
  // una fila rota (ver el mapper): la fila está en cascada de borrado y la
  // siguiente petición ya no la cuenta. Un `count` transitorio de más vale
  // menos que un 500 en el SSR de la tienda.
  return { items: rows.map(_toProductRecord).filter(_isPresent), total };
}

/**
 * Detalle por slug, con relaciones cargadas y `relatedProducts` (mismo
 * type, hasta `relatedLimit`, SIN filtrar por `status`/`visibility` y sin
 * excluir el propio producto — ver D-1 en el `where` de abajo).
 * `null` si no existe.
 */
export async function findProductBySlug(
  slug: string,
  relatedLimit = 20
): Promise<ProductDetail | null> {
  const row = await prisma.product.findUnique({
    where: { slug },
    include: PRODUCT_INCLUDE,
  });
  if (!row) return null;
  // Lectura rota (`type`/`shop` en cascada de borrado, ver el mapper): el
  // producto está dejando de existir — `null` (404) es la respuesta honesta.
  const record = _toProductRecord(row);
  if (!record) return null;

  const related = await prisma.product.findMany({
    // D-1 (US-3, ratificada): paridad byte a byte con el mock, que hacía
    // `products.filter(p => p.type.slug === product.type.slug).slice(0,20)`.
    // NO es un bug ni un olvido: el filtro por `status`/`visibility` y la
    // exclusión del propio producto (`id: { not: row.id }`) se ELIMINARON a
    // propósito. Ver openspec/specs/product-detail-api/spec.md antes de
    // "arreglarlo".
    where: { typeId: row.typeId },
    include: PRODUCT_INCLUDE,
    orderBy: { id: 'asc' },
    take: relatedLimit,
  });

  return {
    ...record,
    relatedProducts: related.map(_toProductRecord).filter(_isPresent),
  };
}

// ---------------------------------------------------------------------------
// Escritura (scraper)
// ---------------------------------------------------------------------------

/**
 * Upsert idempotente por procedencia `(sourceStore, sourceProductId)` —
 * la clave natural del scraper (índice único parcial
 * products_procedencia_key). Mismo producto scrapeado dos veces = misma
 * fila actualizada.
 *
 * Valida los CHECK de la tabla antes de tocar la base:
 *   · salePrice < price (products_rebaja_valida) → InvalidSalePriceError
 *   · price > 0 presente (products_simple_con_precio, los scrapeados son
 *     'simple') → el tipo ya lo exige (price: number)
 *   · procedencia completa (products_procedencia_completa) → el tipo ya
 *     la exige (sourceStore y sourceProductId son obligatorios)
 */
export async function upsertScrapedProduct(
  input: UpsertScrapedProductInput
): Promise<ProductRecord> {
  if (input.salePrice != null && input.salePrice >= input.price) {
    throw new InvalidSalePriceError(input.salePrice, input.price);
  }

  const scrapedAt = input.scrapedAt ?? now();

  const scalars = {
    name: input.name,
    description: input.description ?? '',
    typeId: input.typeId,
    shopId: input.shopId,
    manufacturerId: input.manufacturerId ?? null,
    productType: 'simple',
    price: input.price,
    salePrice: input.salePrice ?? null,
    // Para un 'simple' los tres precios valen lo mismo (ver db/schema.sql).
    minPrice: input.price,
    maxPrice: input.price,
    quantity: input.quantity ?? 0,
    inStock: input.inStock ?? true,
    sku: input.sku ?? null,
    unit: input.unit ?? '1 pc',
    ...(input.image !== undefined && { image: input.image }),
    ...(input.gallery !== undefined && { gallery: input.gallery }),
    sourceUrl: input.sourceUrl ?? null,
    scrapedAt,
  };

  const categoryLinks = (input.categoryIds ?? []).map((categoryId) => ({
    categoryId,
  }));
  const tagLinks = (input.tagIds ?? []).map((tagId) => ({ tagId }));

  try {
    const row = await prisma.product.upsert({
      where: {
        sourceStore_sourceProductId: {
          sourceStore: input.sourceStore,
          sourceProductId: input.sourceProductId,
        },
      },
      create: {
        ...scalars,
        slug: input.slug,
        sourceStore: input.sourceStore,
        sourceProductId: input.sourceProductId,
        categories: { create: categoryLinks },
        tags: { create: tagLinks },
      },
      update: {
        ...scalars,
        // El slug NO se toca en update: es la URL pública del producto.
        // Los sets de categorías/tags se reemplazan completos solo si vienen.
        ...(input.categoryIds !== undefined && {
          categories: { deleteMany: {}, create: categoryLinks },
        }),
        ...(input.tagIds !== undefined && {
          tags: { deleteMany: {}, create: tagLinks },
        }),
      },
      include: PRODUCT_INCLUDE,
    });
    const record = _toProductRecord(row);
    if (!record) {
      // La fila se escribió (las FKs existían al insertar) pero `type` o
      // `shop` desaparecieron antes de que el include los leyera: la fila
      // está en cascada de borrado. Es, literalmente, una referencia a un
      // registro que ya no existe — el error de dominio existente lo dice
      // sin inventar uno nuevo.
      throw new InvalidReferenceError(
        'products',
        row.type === null ? 'type_id' : 'shop_id'
      );
    }
    return record;
  } catch (error) {
    throw _translateCheckViolation(error);
  }
}

/**
 * Borra un producto por procedencia. `null` si no existía — o si su `type`/
 * `shop` ya están en cascada de borrado (ver el mapper): en ese caso Postgres
 * se lleva la fila solo y aquí no hay nada que borrar ni que devolver.
 */
export async function deleteScrapedProduct(
  sourceStore: string,
  sourceProductId: string
): Promise<ProductRecord | null> {
  const row = await prisma.product.findUnique({
    where: {
      sourceStore_sourceProductId: { sourceStore, sourceProductId },
    },
    include: PRODUCT_INCLUDE,
  });
  if (!row) return null;
  const record = _toProductRecord(row);
  if (!record) return null;
  await prisma.product.delete({ where: { id: row.id } });
  return record;
}

// ---------------------------------------------------------------------------
// Escritura (admin) — CA-1, CA-2, CA-3 de `product-write-api` (US-29). Único
// agregado del catálogo con pivotes propios (`category_product`/`product_tag`)
// y con propiedad por tienda (la propiedad se valida en el servicio de Nest,
// D29-1 — este repositorio no conoce "usuario actual").
// ---------------------------------------------------------------------------

/**
 * Call site de `ExistingSlugLookup` (mismo patrón que `categorySlugs` en
 * `categories.repository.ts`): el nombre de tabla nunca llega a `slug.ts`.
 */
const productSlugs: ExistingSlugLookup = async (prefix) =>
  (
    await prisma.product.findMany({
      where: { slug: { startsWith: prefix } },
      select: { slug: true },
    })
  ).map((r) => r.slug);

/** `[...new Set(ids)]` — evita el `P2002` espurio de un pivote con ids repetidos (DD29-6). */
function uniq<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/**
 * B1 (DD29-3). Forma entera de las 3 FK salientes (`type_id`, `shop_id`,
 * `manufacturer_id`) y de cada id de `categoryIds[]`/`tagIds[]`.
 * `Number.isSafeInteger` (no `isInteger`): un valor como `1e21` es entero
 * pero excede el rango de un `bigint` de Postgres y el driver lanza sin
 * `.code` reconocible — 500 en vez de 400 (precedente
 * `categories.repository.ts:305-317`). Reescrita local a propósito (`CA-7`
 * prohíbe una pieza compartida nueva): la de `categories` es
 * module-private y hardcodea su agregado. Sin `<= 0`: un id no positivo es
 * representable como `bigint` y ya resuelve en 400 vía `P2003`/la sonda de
 * existencia (mismo rationale que `categories.repository.ts:319-326`).
 */
function _assertIntegerRef(value: number | null | undefined, field: string): void {
  if (value != null && !Number.isSafeInteger(value)) {
    throw new InvalidReferenceError('products', field, value);
  }
}

/**
 * B2 (DD29-3). `price`/`salePrice`/`minPrice`/`maxPrice`: forma finita y
 * dentro del rango de `numeric(12,2)` (`|v| >= 1e10` → 400). Sin la mitad
 * del rango, `{"price": 1e300}` produce un `numeric field overflow` de
 * Postgres sin `.code` → 500 — misma familia de defecto que
 * `Number.isSafeInteger` cierra para los ids. Re-expresa el CRITERIO de
 * `parseFiniteNumber` (`products.service.ts`); esa función NO se reutiliza
 * ni se ensancha (su contrato es descartar en silencio para el query-string,
 * lo opuesto del 400 que hace falta aquí).
 */
function _assertFiniteNumber(value: number | null | undefined, field: string): void {
  if (value == null) return;
  if (!Number.isFinite(value) || Math.abs(value) >= 1e10) {
    throw new InvalidReferenceError('products', `${field} (no es un número finito)`, value);
  }
}

/** B3 (DD29-3). `quantity`: forma entera. */
function _assertIntegerCount(value: number | undefined, field: string): void {
  if (value === undefined) return;
  if (!Number.isInteger(value)) {
    throw new InvalidReferenceError('products', `${field} (no es un entero)`, value);
  }
}

const PRODUCT_TYPES = ['simple', 'variable'];
const PRODUCT_STATUSES = ['publish', 'draft'];

/**
 * `product_type IN ('simple','variable')` (DD29-2/DD29-8): el conjunto
 * cerrado de 5 códigos no nombra "valor fuera de un IN", así que se
 * generaliza `InvalidReferenceError` a "argumento inválido" — precedente
 * literal `DD28-3` en `categories`. `undefined` (campo ausente, el
 * `DEFAULT 'simple'` de la columna aplica) no se valida: el default siempre
 * es válido.
 */
function _assertProductType(value: string | undefined): void {
  if (value !== undefined && !PRODUCT_TYPES.includes(value)) {
    throw new InvalidReferenceError(
      'products',
      `product_type (fuera de IN ('simple','variable'))`,
      value
    );
  }
}

/** `status IN ('publish','draft')` (DD29-2). Mismo criterio que `_assertProductType`. */
function _assertStatus(value: string | undefined): void {
  if (value !== undefined && !PRODUCT_STATUSES.includes(value)) {
    throw new InvalidReferenceError(
      'products',
      `status (fuera de IN ('publish','draft'))`,
      value
    );
  }
}

/**
 * `products_rebaja_valida` heredada y ADAPTADA (DD29-9): el `disyunto
 * price != null` es obligatorio porque, a diferencia de
 * `upsertScrapedProduct` (donde `price: number` es obligatorio), aquí un
 * `variable` legítimamente tiene `price === null` y `salePrice >= null`
 * coerciona a `salePrice >= 0`, dando un 400 espurio. `products_simple_con_precio`
 * es nueva: un `simple` sin `price` es inválido.
 */
function _assertPriceRules(
  productType: string,
  price: number | null,
  salePrice: number | null
): void {
  if (salePrice != null && price != null && salePrice >= price) {
    throw new InvalidSalePriceError(salePrice, price);
  }
  if (productType === 'simple' && price === null) {
    throw new MissingPriceError();
  }
}

/**
 * Sonda de existencia de los ids de pivote, NORMATIVA (DD29-6): no se deja
 * al `P2003` de un `create` anidado porque no está verificado que Prisma 7 +
 * `adapter-pg` lo emita para la fila pivote — si no lo hiciera, el 400 que
 * `spec/product-write-api/spec.md` exige para `categories: [999999]` se
 * incumpliría con un 500 descubierto en producción. Una consulta `count` por
 * tabla, no una por id.
 */
async function _assertPivotIdsExist(
  categoryIds?: number[],
  tagIds?: number[]
): Promise<void> {
  if (categoryIds !== undefined) {
    const ids = uniq(categoryIds);
    const found = await prisma.category.count({ where: { id: { in: ids } } });
    if (found !== ids.length) {
      throw new InvalidReferenceError('products', 'categories[]');
    }
  }
  if (tagIds !== undefined) {
    const ids = uniq(tagIds);
    const found = await prisma.tag.count({ where: { id: { in: ids } } });
    if (found !== ids.length) {
      throw new InvalidReferenceError('products', 'tags[]');
    }
  }
}

/**
 * Derivación de `price`/`minPrice`/`maxPrice` sobre el tipo EFECTIVO
 * (DD29-7). `simple`: los tres valen `price`, derivados, nunca leídos del
 * input — así una conversión `variable`→`simple` no arrastra un
 * `min_price` desalineado que ninguna guarda vería. `variable`: `price`
 * queda `NULL` y se persisten los `min`/`max` que el admin ya calculó.
 */
function _deriveProductPrices(
  productType: string,
  effective: { price: number | null; minPrice: number | null; maxPrice: number | null }
): { price: number | null; minPrice: number | null; maxPrice: number | null } {
  if (productType === 'simple') {
    return { price: effective.price, minPrice: effective.price, maxPrice: effective.price };
  }
  return { price: null, minPrice: effective.minPrice, maxPrice: effective.maxPrice };
}

export interface CreateProductInput {
  name: string;
  slug?: string | null;
  description?: string;
  typeId: number;
  shopId: number;
  manufacturerId?: number | null;
  productType?: string;
  price?: number | null;
  salePrice?: number | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  quantity?: number;
  inStock?: boolean;
  sku?: string | null;
  unit?: string;
  status?: string;
  visibility?: string;
  image?: Prisma.InputJsonValue;
  gallery?: Prisma.InputJsonValue;
  isTaxable?: boolean;
  isDigital?: boolean;
  isExternal?: boolean;
  externalProductUrl?: string | null;
  language?: string;
  categoryIds?: number[];
  tagIds?: number[];
}

/** `slug` inmutable por tipo (CA-2); `shopId` SÍ mutable (decisión de producto). */
export type UpdateProductInput = Partial<Omit<CreateProductInput, 'slug'>>;

/** Crea un producto del admin, con pivotes y las 5 guardas de DD29-2/DD29-3 pre-validadas. */
export async function createProduct(input: CreateProductInput): Promise<ProductRecord> {
  _assertIntegerRef(input.typeId, 'type_id');
  _assertIntegerRef(input.shopId, 'shop_id');
  _assertIntegerRef(input.manufacturerId, 'manufacturer_id');
  for (const categoryId of input.categoryIds ?? []) {
    _assertIntegerRef(categoryId, 'categories[]');
  }
  for (const tagId of input.tagIds ?? []) {
    _assertIntegerRef(tagId, 'tags[]');
  }

  _assertFiniteNumber(input.price, 'price');
  _assertFiniteNumber(input.salePrice, 'sale_price');
  _assertFiniteNumber(input.minPrice, 'min_price');
  _assertFiniteNumber(input.maxPrice, 'max_price');
  _assertIntegerCount(input.quantity, 'quantity');

  _assertProductType(input.productType);
  _assertStatus(input.status);

  const productType = input.productType ?? 'simple';
  const status = input.status ?? 'publish';
  const price = input.price ?? null;
  const salePrice = input.salePrice ?? null;

  _assertPriceRules(productType, price, salePrice);

  await _assertPivotIdsExist(input.categoryIds, input.tagIds);

  const derivedPrices = _deriveProductPrices(productType, {
    price,
    minPrice: input.minPrice ?? null,
    maxPrice: input.maxPrice ?? null,
  });
  const inStock =
    input.inStock !== undefined
      ? input.inStock
      : input.quantity !== undefined
        ? input.quantity > 0
        : undefined;

  const slug = await generateSlug(
    { name: input.name, slug: input.slug },
    productSlugs,
    'products'
  );

  const categoryLinks = uniq(input.categoryIds ?? []).map((categoryId) => ({ categoryId }));
  const tagLinks = uniq(input.tagIds ?? []).map((tagId) => ({ tagId }));

  try {
    const row = await prisma.product.create({
      data: {
        name: input.name,
        slug,
        description: input.description ?? '',
        typeId: input.typeId,
        shopId: input.shopId,
        manufacturerId: input.manufacturerId ?? null,
        productType,
        price: derivedPrices.price,
        salePrice,
        minPrice: derivedPrices.minPrice,
        maxPrice: derivedPrices.maxPrice,
        ...(input.quantity !== undefined && { quantity: input.quantity }),
        ...(inStock !== undefined && { inStock }),
        sku: input.sku ?? null,
        unit: input.unit ?? '1 pc',
        status,
        visibility: input.visibility ?? 'visibility_public',
        ...(input.image != null && { image: input.image }),
        ...(input.gallery != null && { gallery: input.gallery }),
        isTaxable: input.isTaxable ?? false,
        isDigital: input.isDigital ?? false,
        isExternal: input.isExternal ?? false,
        externalProductUrl: input.externalProductUrl ?? null,
        language: input.language ?? 'es',
        categories: { create: categoryLinks },
        tags: { create: tagLinks },
      },
      include: PRODUCT_INCLUDE,
    });
    const record = _toProductRecord(row);
    if (!record) {
      throw new InvalidReferenceError(
        'products',
        row.type === null ? 'type_id' : 'shop_id'
      );
    }
    return record;
  } catch (error) {
    throw _translateCheckViolation(
      translateCatalogWriteError(error, { aggregate: 'products' })
    );
  }
}

/**
 * Actualiza un producto: escalares, pivotes y (si el body mueve `shop_id`)
 * la fila cambia de tienda — la propiedad de ambos lados la valida el
 * servicio de Nest (D29-1), no este repositorio. `slug` es inmutable a
 * nivel de tipo; si llega `name` se valida con `normalizeSlug` descartando
 * el resultado (solo su efecto lateral `EmptySlugError`). `updatedAt` NO se
 * fija a mano: el trigger `products_updated_at` lo hace con el reloj de
 * Postgres.
 */
export async function updateProduct(
  id: number,
  input: UpdateProductInput
): Promise<ProductRecord> {
  const current = await prisma.product.findUnique({ where: { id }, include: PRODUCT_INCLUDE });
  if (!current) {
    throw new RecordNotFoundError('products', id);
  }

  if (input.name !== undefined) {
    await normalizeSlug(input.name, 'products');
  }

  const effectiveTypeId = input.typeId !== undefined ? input.typeId : _id(current.typeId);
  const effectiveShopId = input.shopId !== undefined ? input.shopId : _id(current.shopId);
  const effectiveManufacturerId =
    input.manufacturerId !== undefined ? input.manufacturerId : _id(current.manufacturerId);
  const effectiveProductType =
    input.productType !== undefined ? input.productType : current.productType;
  const effectivePrice = input.price !== undefined ? input.price : _dec(current.price);
  const effectiveSalePrice =
    input.salePrice !== undefined ? input.salePrice : _dec(current.salePrice);
  const effectiveMinPrice =
    input.minPrice !== undefined ? input.minPrice : _dec(current.minPrice);
  const effectiveMaxPrice =
    input.maxPrice !== undefined ? input.maxPrice : _dec(current.maxPrice);
  const effectiveQuantity =
    input.quantity !== undefined ? input.quantity : current.quantity;

  _assertIntegerRef(effectiveTypeId, 'type_id');
  _assertIntegerRef(effectiveShopId, 'shop_id');
  _assertIntegerRef(effectiveManufacturerId, 'manufacturer_id');
  for (const categoryId of input.categoryIds ?? []) {
    _assertIntegerRef(categoryId, 'categories[]');
  }
  for (const tagId of input.tagIds ?? []) {
    _assertIntegerRef(tagId, 'tags[]');
  }

  _assertFiniteNumber(effectivePrice, 'price');
  _assertFiniteNumber(effectiveSalePrice, 'sale_price');
  _assertFiniteNumber(effectiveMinPrice, 'min_price');
  _assertFiniteNumber(effectiveMaxPrice, 'max_price');
  _assertIntegerCount(effectiveQuantity, 'quantity');

  _assertProductType(input.productType);
  _assertStatus(input.status);
  _assertPriceRules(effectiveProductType, effectivePrice, effectiveSalePrice);

  await _assertPivotIdsExist(input.categoryIds, input.tagIds);

  const derivedPrices = _deriveProductPrices(effectiveProductType, {
    price: effectivePrice,
    minPrice: effectiveMinPrice,
    maxPrice: effectiveMaxPrice,
  });
  const effectiveInStock =
    input.inStock !== undefined
      ? input.inStock
      : input.quantity !== undefined
        ? input.quantity > 0
        : undefined;

  try {
    const row = await prisma.product.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.typeId !== undefined && { typeId: input.typeId }),
        ...(input.shopId !== undefined && { shopId: input.shopId }),
        ...(input.manufacturerId !== undefined && { manufacturerId: input.manufacturerId }),
        ...(input.productType !== undefined && { productType: input.productType }),
        price: derivedPrices.price,
        ...(input.salePrice !== undefined && { salePrice: input.salePrice }),
        minPrice: derivedPrices.minPrice,
        maxPrice: derivedPrices.maxPrice,
        ...(input.quantity !== undefined && { quantity: input.quantity }),
        ...(effectiveInStock !== undefined && { inStock: effectiveInStock }),
        ...(input.sku !== undefined && { sku: input.sku }),
        ...(input.unit !== undefined && { unit: input.unit }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.visibility !== undefined && { visibility: input.visibility }),
        ...(input.image != null && { image: input.image }),
        ...(input.gallery != null && { gallery: input.gallery }),
        ...(input.isTaxable !== undefined && { isTaxable: input.isTaxable }),
        ...(input.isDigital !== undefined && { isDigital: input.isDigital }),
        ...(input.isExternal !== undefined && { isExternal: input.isExternal }),
        ...(input.externalProductUrl !== undefined && {
          externalProductUrl: input.externalProductUrl,
        }),
        ...(input.language !== undefined && { language: input.language }),
        ...(input.categoryIds !== undefined && {
          categories: {
            deleteMany: {},
            create: uniq(input.categoryIds).map((categoryId) => ({ categoryId })),
          },
        }),
        ...(input.tagIds !== undefined && {
          tags: {
            deleteMany: {},
            create: uniq(input.tagIds).map((tagId) => ({ tagId })),
          },
        }),
      },
      include: PRODUCT_INCLUDE,
    });
    const record = _toProductRecord(row);
    if (!record) {
      // La fila se está borrando sola entre esta lectura y el write (FK
      // NOT NULL + CASCADE): 404 es la respuesta honesta (DD29-5, mismo
      // razonamiento que deleteProduct).
      throw new RecordNotFoundError('products', id);
    }
    return record;
  } catch (error) {
    throw _translateCheckViolation(
      translateCatalogWriteError(error, { aggregate: 'products', id })
    );
  }
}

/**
 * Borra un producto del admin. `findUnique + PRODUCT_INCLUDE` corre ANTES
 * del `DELETE`: es a la vez la comprobación de existencia y el snapshot
 * PRE-borrado que se devuelve (DD29-5, precedente `DD28-1`). Un `DELETE` no
 * dispara el trigger `products_updated_at`, así que no hay ningún valor
 * posterior con el que divergir.
 */
export async function deleteProduct(id: number): Promise<ProductRecord> {
  const row = await prisma.product.findUnique({ where: { id }, include: PRODUCT_INCLUDE });
  if (!row) {
    throw new RecordNotFoundError('products', id);
  }
  const snapshot = _toProductRecord(row);
  if (!snapshot) {
    throw new RecordNotFoundError('products', id);
  }

  try {
    await prisma.product.delete({ where: { id } });
  } catch (error) {
    throw _translateCheckViolation(
      translateCatalogWriteError(error, { aggregate: 'products', id })
    );
  }

  return snapshot;
}

/**
 * `shopId` actual de un producto, para la propiedad por tienda de
 * `update`/`remove` (D29-1, DD29-4). `null` si el producto no existe o si
 * `id` no tiene forma entera segura. NUNCA lanza.
 */
export async function findProductShopId(id: number): Promise<number | null> {
  if (!Number.isSafeInteger(id)) return null;
  const row = await prisma.product.findUnique({
    where: { id },
    select: { shopId: true },
  });
  return row ? _id(row.shopId) : null;
}

// ---------------------------------------------------------------------------
// Errores de dominio — traducen los CHECK constraints que Prisma no modela.
// ---------------------------------------------------------------------------

/**
 * Las tres extienden `CatalogWriteError` (no `Error` a secas) con
 * `code = CATALOG_ERROR_CODES.InvalidReference` — DD29-1. Sin esto,
 * `isCatalogWriteError` (guard estructural por `code` contra los 5 valores
 * cerrados) no las reconoce, `mapDomainError` devuelve `null` y
 * `toWriteHttpException` degrada a HTTP 500 en vez de 400. Mismos mensajes,
 * mismo `name`, mismo `instanceof`; `upsertScrapedProduct` no se toca.
 */
export class InvalidSalePriceError extends CatalogWriteError {
  readonly code = CATALOG_ERROR_CODES.InvalidReference;
  constructor(salePrice: number, price: number) {
    super(
      `El precio rebajado (${salePrice}) debe ser menor que el de lista (${price}) — CHECK products_rebaja_valida.`,
      'products'
    );
    this.name = 'InvalidSalePriceError';
  }
}

export class MissingPriceError extends CatalogWriteError {
  readonly code = CATALOG_ERROR_CODES.InvalidReference;
  constructor() {
    super(
      `Un producto 'simple' necesita precio — CHECK products_simple_con_precio.`,
      'products'
    );
    this.name = 'MissingPriceError';
  }
}

export class IncompleteProvenanceError extends CatalogWriteError {
  readonly code = CATALOG_ERROR_CODES.InvalidReference;
  constructor() {
    super(
      'source_store y source_product_id van juntos o ninguno — CHECK products_procedencia_completa.',
      'products'
    );
    this.name = 'IncompleteProvenanceError';
  }
}

/**
 * Backstop: si a pesar de la validación previa Postgres rechaza la fila,
 * el mensaje trae el nombre del constraint. Se traduce al error de dominio;
 * cualquier otro error se re-lanza tal cual.
 */
export function _translateCheckViolation(error: unknown): unknown {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('products_rebaja_valida')) {
    return new InvalidSalePriceError(Number.NaN, Number.NaN);
  }
  if (message.includes('products_simple_con_precio')) {
    return new MissingPriceError();
  }
  if (message.includes('products_procedencia_completa')) {
    return new IncompleteProvenanceError();
  }
  return error;
}

// ---------------------------------------------------------------------------
// Mapper interno
// ---------------------------------------------------------------------------

/** Type guard para `.filter()` sobre el resultado nullable del mapper. */
function _isPresent<T>(value: T | null): value is T {
  return value !== null;
}

/**
 * Exportado SOLO para el test de unidad (`products.repository.test.ts`), no
 * por el barrel: sigue siendo interno del paquete (prefijo `_`, misma
 * convención que los `_to*Record` de `records.ts`). Sin ese test, las guardas
 * de null de abajo son invisibles para `tsc` —Prisma tipa las relaciones como
 * no nulas— y un refactor podría borrarlas como código muerto sin que nada
 * se ponga rojo (hallazgo RV-1 de `sdd-verify` en US-27b).
 *
 * Devuelve `null` cuando `type` o `shop` llegan NULL: son FKs `NOT NULL` con
 * `ON DELETE CASCADE` (`db/schema.sql:331-332`), así que un NULL ahí no es un
 * dato opcional sino una lectura rota — el agregado se borró entre la
 * consulta principal y la del include (mismo mecanismo que `categories`/
 * `tags`, abajo) y Postgres está borrando este producto en cascada. No hay
 * default sensato para un `shop`, y lanzar solo cambiaría el texto del 500;
 * descartar la fila es lo que la cascada va a hacer un instante después. Es
 * exactamente la ventana que abre `deleteShop` (US-30).
 */
export function _toProductRecord(row: ProductPayload): ProductRecord | null {
  if (row.type === null || row.shop === null) return null;
  return {
    id: _id(row.id),
    name: row.name,
    slug: row.slug,
    description: row.description,
    typeId: _id(row.typeId),
    shopId: _id(row.shopId),
    manufacturerId: _id(row.manufacturerId),
    productType: row.productType,
    price: _dec(row.price),
    salePrice: _dec(row.salePrice),
    minPrice: _dec(row.minPrice),
    maxPrice: _dec(row.maxPrice),
    quantity: row.quantity,
    inStock: row.inStock,
    soldQuantity: row.soldQuantity,
    sku: row.sku,
    unit: row.unit,
    status: row.status,
    visibility: row.visibility,
    image: row.image,
    gallery: row.gallery,
    ratings: _dec(row.ratings),
    totalReviews: row.totalReviews,
    isTaxable: row.isTaxable,
    isDigital: row.isDigital,
    isExternal: row.isExternal,
    externalProductUrl: row.externalProductUrl,
    language: row.language,
    translatedLanguages: row.translatedLanguages,
    sourceStore: row.sourceStore,
    sourceProductId: row.sourceProductId,
    sourceUrl: row.sourceUrl,
    scrapedAt: row.scrapedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    type: _toTypeRecord(row.type),
    shop: _toShopRecord(row.shop),
    manufacturer: row.manufacturer
      ? _toManufacturerRecord(row.manufacturer)
      : null,
    // `link.category`/`link.tag` pueden llegar NULL aunque la fila pivote
    // exista: Prisma resuelve el include anidado en dos consultas, así que si
    // el agregado se borra entre ambas, el enlace queda sin destino. La guarda
    // de `manufacturer` (arriba) ya lo contemplaba; estas dos no, y el
    // resultado era un `TypeError: Cannot read properties of null` reproducible
    // al 8,3 % (hallazgo C-1 de `sdd-verify` en US-27b) — y un 500 real al
    // borrar un tag mientras la tienda hace SSR de `/api/products`. Aquí SÍ se
    // descarta solo el enlace, no el producto: ambos pivotes son `ON DELETE
    // CASCADE` hacia el tag/categoría, no hacia el producto (`schema.sql:427,
    // 433`), así que el producto sobrevive y solo pierde esa relación.
    categories: row.categories
      .filter((link) => link.category !== null)
      .map((link) => _toCategoryRecord(link.category)),
    tags: row.tags
      .filter((link) => link.tag !== null)
      .map((link) => _toTagRecord(link.tag)),
  };
}
