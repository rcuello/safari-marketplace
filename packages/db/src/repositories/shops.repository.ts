/**
 * shops.repository.ts — vendedores del marketplace. El seed trae los 12
 * del mock; los retailers scrapeados (Alkosto, Éxito...) los crea el
 * scraper en runtime vía `findOrCreateShopBySlug`.
 */

import type { Prisma } from '../../generated/prisma/client/client';
import { prisma } from '../client';
import { translateCatalogWriteError } from '../domain-errors';
import { _id, _toShopRecord, type ShopRecord } from '../records';
import { type ExistingSlugLookup, generateSlug, normalizeSlug } from '../slug';

export interface ListShopsInput {
  /** Solo tiendas activas por defecto. */
  isActive?: boolean;
  /** Búsqueda parcial por nombre, case-insensitive. */
  name?: string;
  /** 1-based. Default 1. */
  page?: number;
  /** Default 30, como el mock. */
  limit?: number;
}

/**
 * Mismos filtros que el listado público de la tienda (Decisión E,
 * design.md): `products_count` cuenta SOLO lo publicado y visible.
 */
const PUBLISHED_PRODUCT: Prisma.ProductWhereInput = {
  status: 'publish',
  visibility: 'visibility_public',
};
const COUNT_PRODUCTS = {
  _count: { select: { products: { where: PUBLISHED_PRODUCT } } },
} satisfies Prisma.ShopInclude;

/** Listado paginado. `{ items, total }` para `buildPaginator`. */
export async function listShops(input: ListShopsInput = {}): Promise<{
  items: ShopRecord[];
  total: number;
}> {
  const page = Math.max(1, input.page ?? 1);
  const limit = input.limit ?? 30;
  const where: Prisma.ShopWhereInput = {
    isActive: input.isActive ?? true,
    ...(input.name && { name: { contains: input.name, mode: 'insensitive' as const } }),
  };

  const [rows, total] = await Promise.all([
    prisma.shop.findMany({
      where,
      include: COUNT_PRODUCTS,
      // Preserva el orden del mock (Decisión D, design.md): las tiendas
      // scrapeadas (ids altos) quedan al frente, no al final.
      orderBy: { id: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.shop.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      ..._toShopRecord(row),
      productsCount: row._count.products,
    })),
    total,
  };
}

/**
 * Una tienda por slug. `null` si no existe. Trae el mismo `productsCount`
 * filtrado que `listShops` — sin esto, `/shops/:slug` emitiría
 * `products_count: undefined` y `JSON.stringify` borraría la clave (16 → 15
 * claves, rotura de contrato — ver Decisión E, design.md).
 */
export async function findShopBySlug(slug: string): Promise<ShopRecord | null> {
  const row = await prisma.shop.findUnique({
    where: { slug },
    include: COUNT_PRODUCTS,
  });
  if (!row) return null;
  return { ..._toShopRecord(row), productsCount: row._count.products };
}

export interface ShopNearRecord extends ShopRecord {
  /** Distancia haversine en km, R = 6371 (US-5 Decision D). */
  distanceKm: number;
}

/**
 * `lat`/`lng` numéricos y finitos de `settings.location`, o `null` si la
 * tienda no tiene coordenadas válidas (sin la clave, `location: []`, o
 * valores no numéricos). Se descarta sin lanzar — no todas las tiendas
 * traen `settings->'location'` poblado (US-5 Decision D).
 */
function _parseLocation(
  settings: Prisma.JsonValue
): { lat: number; lng: number } | null {
  if (
    !settings ||
    typeof settings !== 'object' ||
    Array.isArray(settings)
  ) {
    return null;
  }
  const location = (settings as Record<string, unknown>).location;
  if (
    !location ||
    typeof location !== 'object' ||
    Array.isArray(location)
  ) {
    return null;
  }
  const { lat, lng } = location as Record<string, unknown>;
  return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)
    ? { lat, lng }
    : null;
}

const EARTH_RADIUS_KM = 6371;

/** Distancia haversine entre dos puntos, en km. */
function _haversineKm(
  origin: { lat: number; lng: number },
  target: { lat: number; lng: number }
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(target.lat - origin.lat);
  const dLng = toRad(target.lng - origin.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(origin.lat)) * Math.cos(toRad(target.lat)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/**
 * Tiendas activas con coordenadas válidas, ordenadas ascendente por
 * distancia real (haversine) al origen. Sin radio ni paginación (US-5
 * Decision D, decisión cerrada del dueño del repo): devuelve TODAS las que
 * califiquen, máx. 6 de 12 hoy. `lat`/`lng` no finitos → `[]`, NUNCA lanza
 * (el guard vive AQUÍ, en el repositorio, para que sea testeable sin pasar
 * por el servicio de Nest — B-4).
 */
export async function listShopsNear(
  lat: number,
  lng: number
): Promise<ShopNearRecord[]> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];

  const origin = { lat, lng };
  const rows = await prisma.shop.findMany({ where: { isActive: true } });

  const withDistance: ShopNearRecord[] = [];
  for (const row of rows) {
    const point = _parseLocation(row.settings);
    if (!point) continue;
    withDistance.push({
      ..._toShopRecord(row),
      distanceKm: _haversineKm(origin, point),
    });
  }

  withDistance.sort((a, b) => a.distanceKm - b.distanceKm || a.id - b.id);
  return withDistance;
}

/**
 * `ownerId` de una tienda por id, para la propiedad por tienda de
 * `products` (D29-1, US-29). `null` si no existe **o** si `id` no es
 * entero seguro positivo (DD29-3, nivel A'): sin esta guarda,
 * `{"shop_id":"abc"}` → `Number('abc')` → `NaN` → `BigInt(NaN)` en el
 * `findUnique` lanzaría un `RangeError` sin `.code`, invisible para los
 * traductores → 500. NUNCA lanza.
 */
export async function findShopOwnerById(id: number): Promise<number | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const row = await prisma.shop.findUnique({ where: { id }, select: { ownerId: true } });
  return row ? _id(row.ownerId) : null;
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

// ---------------------------------------------------------------------------
// Escritura (admin) — CA-1, CA-2, CA-3 de `shop-write-api` (US-30). Cero
// CHECK y cero `IN` en `shops` (db/schema.sql:231-244, DD30-10): el `catch`
// de las tres funciones es una sola llamada a `translateCatalogWriteError`,
// sin guarda de dominio propia.
// ---------------------------------------------------------------------------

/**
 * Call site de `ExistingSlugLookup` (mismo patrón que `productSlugs`/
 * `categorySlugs`): el nombre de tabla nunca llega a `slug.ts`.
 */
const shopSlugs: ExistingSlugLookup = async (prefix) =>
  (
    await prisma.shop.findMany({
      where: { slug: { startsWith: prefix } },
      select: { slug: true },
    })
  ).map((r) => r.slug);

/**
 * `slug` no existe en ningún input (DD30-2): la inmutabilidad de CA-2 es
 * estructural, no un `Omit`. `ownerId` sale siempre del token (D30-3) e
 * `isActive` se fija explícito por rol al crear (D30-6) — ninguno de los
 * dos se apoya en el `DEFAULT` del DDL.
 */
export interface CreateShopInput {
  name: string;
  ownerId: number;
  isActive: boolean;
  description?: string | null;
  logo?: Prisma.InputJsonValue;
  coverImage?: Prisma.InputJsonValue;
  address?: Prisma.InputJsonValue;
  settings?: Prisma.InputJsonValue;
}

/**
 * `ownerId`/`isActive` excluidos del update por seguridad (DD30-2): si
 * `isActive` fuera editable aquí, un `store_owner` se auto-aprobaría por
 * `PUT /shops/:propio`, esquivando `approve-shop` (`ADMIN_ONLY`).
 */
export type UpdateShopInput = Partial<Omit<CreateShopInput, 'ownerId' | 'isActive'>>;

/**
 * Crea una tienda del admin. `ownerId`/`isActive` llegan tal cual del
 * servicio (el rol se decide ahí, D30-6); `slug` se deriva de `name`
 * (`generateSlug` ya rechaza `''`/no-string vía `normalizeSlug`, DD30-9).
 * Recalcula `productsCount` con el mismo `include: COUNT_PRODUCTS` que las
 * lecturas (DD30-5) — para una tienda nueva siempre da `0`, no por un
 * fallback.
 */
export async function createShop(input: CreateShopInput): Promise<ShopRecord> {
  const slug = await generateSlug({ name: input.name }, shopSlugs, 'shops');

  try {
    const row = await prisma.shop.create({
      data: {
        name: input.name,
        slug,
        ownerId: input.ownerId,
        isActive: input.isActive,
        ...(input.description !== undefined && {
          description: input.description ?? null,
        }),
        ...(input.logo != null && { logo: input.logo }),
        ...(input.coverImage != null && { coverImage: input.coverImage }),
        ...(input.address !== undefined && { address: input.address }),
        ...(input.settings !== undefined && { settings: input.settings }),
      },
      include: COUNT_PRODUCTS,
    });
    return { ..._toShopRecord(row), productsCount: row._count.products };
  } catch (error) {
    throw translateCatalogWriteError(error, { aggregate: 'shops' });
  }
}

/**
 * Edita una tienda. `slug` no existe en `UpdateShopInput`: nunca cambia
 * (CA-2). Si llega `name`, `normalizeSlug` corre solo por su efecto
 * lateral (`EmptySlugError` → 400 ante `''`/no-string, DD30-9) — el
 * resultado se descarta, el slug de la fila no se toca. `settings`/
 * `address` son REPLACE completo cuando vienen (D30-1/D30-4); `logo`/
 * `coverImage` con `!= null` (un `null` explícito es no-op, DD30-2).
 * `updatedAt` no se fija a mano: lo hace el trigger `shops_updated_at`
 * con el reloj de Postgres (DD30-7). Sin guarda numérica propia: la
 * precondición documentada es `id` entero seguro positivo, garantizada
 * por el llamador (mismo contrato que `updateProduct`).
 */
export async function updateShop(
  id: number,
  input: UpdateShopInput
): Promise<ShopRecord> {
  if (input.name !== undefined) {
    await normalizeSlug(input.name, 'shops');
  }

  try {
    const row = await prisma.shop.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && {
          description: input.description,
        }),
        ...(input.logo != null && { logo: input.logo }),
        ...(input.coverImage != null && { coverImage: input.coverImage }),
        ...(input.address !== undefined && { address: input.address }),
        ...(input.settings !== undefined && { settings: input.settings }),
      },
      include: COUNT_PRODUCTS,
    });
    return { ..._toShopRecord(row), productsCount: row._count.products };
  } catch (error) {
    throw translateCatalogWriteError(error, { aggregate: 'shops', id });
  }
}

/**
 * Aprueba (`true`) o desactiva (`false`) una tienda — **una** función para
 * las dos rutas de moderación (D30-1/DD30-1): la asimetría vive en el
 * servicio (`approveShop`/`disapproveShop` delegando en `_setActive`), no
 * aquí. Sin guarda numérica propia: la lleva el servicio (DD30-3).
 */
export async function setShopActive(
  id: number,
  isActive: boolean
): Promise<ShopRecord> {
  try {
    const row = await prisma.shop.update({
      where: { id },
      data: { isActive },
      include: COUNT_PRODUCTS,
    });
    return { ..._toShopRecord(row), productsCount: row._count.products };
  } catch (error) {
    throw translateCatalogWriteError(error, { aggregate: 'shops', id });
  }
}
