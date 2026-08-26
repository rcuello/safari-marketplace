/**
 * Test de integración contra el Postgres real (docker-compose, puerto
 * 5433, sembrado por `just db-up`: 9 shops del mock + 3 reconstruidas
 * desde productos scrapeados = 12). Solo lectura.
 */

import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../client';
import { findShopBySlug, listShops } from './shops.repository';

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
