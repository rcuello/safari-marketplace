/**
 * Test de integración contra el Postgres real (docker-compose, puerto
 * 5433, sembrado por `just db-up`: 9 shops del mock + 3 reconstruidas
 * desde productos scrapeados = 12). Solo lectura.
 */

import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../client';
import { findShopBySlug, listShops, listShopsNear } from './shops.repository';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('listShops', () => {
  it('lista las 12 tiendas, id desc (D), JSON-safe', async () => {
    const { items, total } = await listShops();
    expect(total).toBe(12);
    expect(items[0].id).toBe(15);
    expect(() => JSON.stringify(items)).not.toThrow();
  });

  it('incluye las 3 filas reconstruidas (CA-3)', async () => {
    const { items } = await listShops();
    const slugs = items.map((r) => r.slug);
    expect(slugs).toEqual(
      expect.arrayContaining(['noaw', 'launchidea', 'tetetetet'])
    );
  });

  it('productsCount filtrado por publish/visibility_public (Decisión E)', async () => {
    const { items } = await listShops();
    const bySlug = Object.fromEntries(items.map((r) => [r.slug, r]));
    expect(bySlug['grocery-shop'].productsCount).toBe(584);
    expect(bySlug['makeup-shop'].productsCount).toBe(82);
    expect(bySlug.noaw.productsCount).toBe(188);
  });

  it('filtra por name case-insensitive "shop" → 7', async () => {
    expect((await listShops({ name: 'shop' })).total).toBe(7);
  });
});

describe('findShopBySlug', () => {
  it('trae el mismo productsCount filtrado que el listado (Decisión E)', async () => {
    const row = await findShopBySlug('gadget');
    expect(row?.productsCount).toBe(44);
  });

  it('devuelve null cuando el slug no existe', async () => {
    expect(await findShopBySlug('no-existe')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// US-5: listShopsNear — haversine real sobre las 6 tiendas con coordenadas
// válidas (ids 1..6); las 6 restantes (7,9,11,12,14,15) no tienen lat/lng
// numéricos (location:[] o sin la clave) y se descartan sin lanzar.
// ---------------------------------------------------------------------------
describe('listShopsNear (US-5)', () => {
  const SIN_COORDENADAS = [7, 9, 11, 12, 14, 15];

  it('dos orígenes distintos dan órdenes de ids distintos, ≤6 filas, sin ids sin coordenadas', async () => {
    const desdeNY = await listShopsNear(40.7128, -74.006);
    const desdeBogota = await listShopsNear(4.711, -74.0721);

    expect(desdeNY.length).toBeLessThanOrEqual(6);
    expect(desdeBogota.length).toBeLessThanOrEqual(6);

    for (const shop of [...desdeNY, ...desdeBogota]) {
      expect(SIN_COORDENADAS).not.toContain(shop.id);
      expect(Number.isFinite(shop.distanceKm)).toBe(true);
    }

    // Orden ascendente por distancia en ambos.
    for (const arr of [desdeNY, desdeBogota]) {
      for (let i = 1; i < arr.length; i++) {
        expect(arr[i].distanceKm).toBeGreaterThanOrEqual(arr[i - 1].distanceKm);
      }
    }

    // Orígenes lejanos entre sí → órdenes de ids distintos (B-1: cercanía real).
    expect(desdeNY.map((s) => s.id)).not.toEqual(desdeBogota.map((s) => s.id));
  });

  it('lat/lng no finitos (NaN) → [] sin lanzar (B-4, guard en el repositorio)', async () => {
    expect(await listShopsNear(Number.NaN, Number.NaN)).toEqual([]);
  });

  it('no-regresión: listShops sigue en total 12, items[0].id === 15', async () => {
    const { items, total } = await listShops();
    expect(total).toBe(12);
    expect(items[0].id).toBe(15);
  });
});
