/**
 * Test de integración contra el Postgres real (docker-compose, puerto
 * 5433, sembrado por `just db-up`: 1200 productos, 198 categorías).
 *
 * Escribe UNA fila de prueba (procedencia 'TestStore') y la borra al
 * final; el resto es solo lectura.
 */

import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../client';
import { buildPaginator } from '../pagination';
import { getCategoryTree } from './categories.repository';
import {
  findProductBySlug,
  InvalidSalePriceError,
  listProducts,
  upsertScrapedProduct,
} from './products.repository';
import { getSettings } from './settings.repository';
import { findTypeBySlug } from './types.repository';

const TEST_STORE = 'TestStore-integration';

afterAll(async () => {
  await prisma.product.deleteMany({ where: { sourceStore: TEST_STORE } });
  await prisma.$disconnect();
});

describe('listProducts', () => {
  it('lista con defaults del shop (publish/public, 30 por página)', async () => {
    const { items, total } = await listProducts();
    expect(total).toBeGreaterThan(1000);
    expect(items).toHaveLength(30);
    for (const p of items) {
      expect(p.status).toBe('publish');
      expect(p.visibility).toBe('visibility_public');
      // Relaciones hidratadas y Decimals ya convertidos.
      expect(p.type.slug).toBeTruthy();
      expect(p.shop.name).toBeTruthy();
      if (p.price !== null) expect(typeof p.price).toBe('number');
    }
    // Todo el record debe ser JSON-safe (ni BigInt ni Decimal sueltos).
    expect(() => JSON.stringify(items)).not.toThrow();
  });

  it('filtra por type.slug', async () => {
    const { items, total } = await listProducts({ typeSlug: 'gadget' });
    expect(total).toBeGreaterThan(0);
    for (const p of items) expect(p.type.slug).toBe('gadget');
  });

  it('filtra por rango de precio', async () => {
    const { items, total } = await listProducts({
      minPrice: 50,
      maxPrice: 100,
    });
    expect(total).toBeGreaterThan(0);
    for (const p of items) {
      expect(p.price).not.toBeNull();
      expect(p.price as number).toBeGreaterThanOrEqual(50);
      expect(p.price as number).toBeLessThanOrEqual(100);
    }
  });

  it('busca por nombre parcial case-insensitive', async () => {
    const [sample] = (await listProducts({ limit: 1 })).items;
    const needle = sample.name.slice(0, 4).toUpperCase();
    const { items, total } = await listProducts({ name: needle });
    expect(total).toBeGreaterThan(0);
    for (const p of items) {
      expect(p.name.toLowerCase()).toContain(needle.toLowerCase());
    }
  });

  it('la paginación cuadra: última página = total - (lastPage-1)*30', async () => {
    const { total } = await listProducts();
    const lastPage = Math.ceil(total / 30);
    const { items } = await listProducts({ page: lastPage });
    expect(items).toHaveLength(total - (lastPage - 1) * 30);

    // Páginas distintas no comparten productos.
    const page1 = await listProducts({ page: 1 });
    const page2 = await listProducts({ page: 2 });
    const ids1 = new Set(page1.items.map((p) => p.id));
    for (const p of page2.items) expect(ids1.has(p.id)).toBe(false);

    // Y el envoltorio del mock sale con la misma aritmética.
    const wrapper = buildPaginator({
      data: page2.items,
      total,
      page: 2,
      limit: 30,
    });
    expect(wrapper.current_page).toBe(2);
    expect(wrapper.last_page).toBe(lastPage);
    expect(wrapper.count).toBe(30);
  });
});

describe('findProductBySlug', () => {
  it('trae el detalle con relaciones y related del mismo type', async () => {
    const [sample] = (await listProducts({ limit: 1 })).items;
    const detail = await findProductBySlug(sample.slug);
    expect(detail).not.toBeNull();
    expect(detail?.id).toBe(sample.id);
    expect(detail?.shop.id).toBe(sample.shopId);
    expect(detail?.relatedProducts.length).toBeGreaterThan(0);
    expect(detail?.relatedProducts.length).toBeLessThanOrEqual(20);
    for (const rel of detail?.relatedProducts ?? []) {
      expect(rel.type.slug).toBe(sample.type.slug);
      expect(rel.id).not.toBe(sample.id);
    }
  });

  it('devuelve null para un slug inexistente', async () => {
    expect(await findProductBySlug('no-existe-ni-existira')).toBeNull();
  });
});

describe('upsertScrapedProduct', () => {
  it('crea por procedencia y el segundo upsert actualiza la misma fila', async () => {
    const gadget = await findTypeBySlug('gadget');
    const [shopSample] = (await listProducts({ limit: 1 })).items;
    expect(gadget).not.toBeNull();
    if (!gadget) return;

    const base = {
      sourceStore: TEST_STORE,
      sourceProductId: 'sku-001',
      sourceUrl: 'https://example.test/p/sku-001',
      name: 'Producto de integración',
      slug: 'producto-de-integracion-test',
      typeId: gadget.id,
      shopId: shopSample.shopId,
      price: 100,
    };

    const created = await upsertScrapedProduct(base);
    expect(created.sourceStore).toBe(TEST_STORE);
    expect(created.price).toBe(100);
    expect(created.minPrice).toBe(100);

    const updated = await upsertScrapedProduct({
      ...base,
      price: 90,
      salePrice: 80,
    });
    expect(updated.id).toBe(created.id); // misma fila, no duplicado
    expect(updated.price).toBe(90);
    expect(updated.salePrice).toBe(80);
  });

  it('rechaza sale_price >= price (CHECK products_rebaja_valida)', async () => {
    const gadget = await findTypeBySlug('gadget');
    const [shopSample] = (await listProducts({ limit: 1 })).items;
    if (!gadget) return;
    await expect(
      upsertScrapedProduct({
        sourceStore: TEST_STORE,
        sourceProductId: 'sku-002',
        name: 'Rebaja inválida',
        slug: 'rebaja-invalida-test',
        typeId: gadget.id,
        shopId: shopSample.shopId,
        price: 50,
        salePrice: 60,
      })
    ).rejects.toBeInstanceOf(InvalidSalePriceError);
  });
});

describe('lecturas auxiliares', () => {
  it('el árbol de categorías tiene raíces con hijas', async () => {
    const tree = await getCategoryTree();
    expect(tree.length).toBeGreaterThan(50); // 83 raíces en el seed
    for (const root of tree) expect(root.parentId).toBeNull();
    expect(tree.some((root) => root.children.length > 0)).toBe(true);
  });

  it('settings devuelve la fila única', async () => {
    const settings = await getSettings();
    expect(settings?.id).toBe(1);
    expect(settings?.options).toBeTruthy();
  });
});
