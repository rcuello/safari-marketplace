/**
 * shops.repository.ts — vendedores del marketplace. El seed trae los 12
 * del mock; los retailers scrapeados (Alkosto, Éxito...) los crea el
 * scraper en runtime vía `findOrCreateShopBySlug`.
 */

import type { Prisma } from '../../generated/prisma/client/client';
import { prisma } from '../client';
import { _toShopRecord, type ShopRecord } from '../records';

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
