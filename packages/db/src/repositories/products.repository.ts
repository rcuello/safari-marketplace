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

  return {
    // El shop manda estos dos en TODAS las consultas de catálogo; son el
    // default para que un caller distraído no liste borradores.
    status: input.status ?? 'publish',
    visibility: input.visibility ?? 'visibility_public',
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
  };
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
      // Orden estable = paginación estable. El mock sirve los productos en
      // el orden del JSON, que coincide con id ascendente.
      orderBy: { id: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.product.count({ where }),
  ]);

  return { items: rows.map(_toProductRecord), total };
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
    ..._toProductRecord(row),
    relatedProducts: related.map(_toProductRecord),
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
    return _toProductRecord(row);
  } catch (error) {
    throw _translateCheckViolation(error);
  }
}

/** Borra un producto por procedencia. `null` si no existía. */
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
  await prisma.product.delete({ where: { id: row.id } });
  return _toProductRecord(row);
}

// ---------------------------------------------------------------------------
// Errores de dominio — traducen los CHECK constraints que Prisma no modela.
// ---------------------------------------------------------------------------

export class InvalidSalePriceError extends Error {
  readonly code = 'PRODUCT_INVALID_SALE_PRICE';
  constructor(salePrice: number, price: number) {
    super(
      `El precio rebajado (${salePrice}) debe ser menor que el de lista (${price}) — CHECK products_rebaja_valida.`
    );
    this.name = 'InvalidSalePriceError';
  }
}

export class MissingPriceError extends Error {
  readonly code = 'PRODUCT_MISSING_PRICE';
  constructor() {
    super(
      `Un producto 'simple' necesita precio — CHECK products_simple_con_precio.`
    );
    this.name = 'MissingPriceError';
  }
}

export class IncompleteProvenanceError extends Error {
  readonly code = 'PRODUCT_INCOMPLETE_PROVENANCE';
  constructor() {
    super(
      'source_store y source_product_id van juntos o ninguno — CHECK products_procedencia_completa.'
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

function _toProductRecord(row: ProductPayload): ProductRecord {
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
    categories: row.categories.map((link) => _toCategoryRecord(link.category)),
    tags: row.tags.map((link) => _toTagRecord(link.tag)),
  };
}
