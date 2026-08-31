/**
 * Test de integración contra el Postgres real (docker-compose, puerto
 * 5433, sembrado por `just db-up`: 1200 productos, 198 categorías).
 *
 * Escribe UNA fila de prueba (procedencia 'TestStore') y la borra al
 * final; el resto es solo lectura.
 */

import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

// Limpieza de ENTRADA, no solo de salida: una corrida abortada (Ctrl-C,
// EADDRINUSE, timeout) deja filas de prueba vivas y la siguiente pasada
// cuenta 12 donde asserta 11. Con esto los conteos absolutos dejan de
// depender de que la corrida anterior terminara bien.
beforeAll(async () => {
  await prisma.product.deleteMany({ where: { sourceStore: TEST_STORE } });
});

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

// ---------------------------------------------------------------------------
// US-5: orderBy tipado (desempate id asc), maxQuantity, opt-out del default
// de vitrina. Cifras exactas verificadas contra el seed enriquecido
// (design.md, "Resultados esperados"). Colocado ANTES de los bloques que
// crean fixtures vía upsertScrapedProduct (US-2 más abajo): esos fixtures
// quedan con quantity 0 por defecto y contaminarían el total === 11 de
// maxQuantity si se contaran productos de prueba con stock bajo.
// ---------------------------------------------------------------------------
describe('listProducts — orderBy (US-5)', () => {
  it("orderBy: 'ratings' → ids en el orden del ranking curado, desempate id asc", async () => {
    const { items } = await listProducts({ orderBy: 'ratings', limit: 10 });
    expect(items.map((p) => p.id)).toEqual([4, 1, 3, 2, 5, 25, 6, 7, 8, 9]);
    // Monotonía: nunca sube.
    for (let i = 1; i < items.length; i++) {
      expect(items[i].ratings).toBeLessThanOrEqual(items[i - 1].ratings);
    }
  });

  it("orderBy: 'soldQuantity' → ids en el orden del ranking curado, desempate id asc", async () => {
    const { items } = await listProducts({ orderBy: 'soldQuantity', limit: 5 });
    expect(items.map((p) => p.id)).toEqual([888, 1, 2, 883, 887]);
    for (let i = 1; i < items.length; i++) {
      expect(items[i].soldQuantity).toBeLessThanOrEqual(items[i - 1].soldQuantity);
    }
  });

  it('orderBy ausente sigue siendo id asc (no-regresión)', async () => {
    const { items } = await listProducts({ limit: 3 });
    expect(items.map((p) => p.id)).toEqual([1, 2, 3]);
  });
});

describe('listProducts — maxQuantity (US-5)', () => {
  it('maxQuantity:9 con applyStorefrontDefaults:false → total 11, todo item con quantity <= 9', async () => {
    const { items, total } = await listProducts({
      maxQuantity: 9,
      applyStorefrontDefaults: false,
      limit: 30,
    });
    expect(total).toBe(11);
    expect(items.map((p) => p.id).sort((a, b) => a - b)).toEqual([
      2, 190, 1014, 1015, 1017, 1018, 1021, 1022, 1023, 1024, 1028,
    ]);
    for (const p of items) expect(p.quantity).toBeLessThanOrEqual(9);
  });
});

describe('listProducts — applyStorefrontDefaults opt-out (US-5 Decision C)', () => {
  it('opt-out + status:draft → total 1, id 454 (el default seguiría ocultándolo)', async () => {
    const { items, total } = await listProducts({
      applyStorefrontDefaults: false,
      status: 'draft',
    });
    expect(total).toBe(1);
    expect(items[0].id).toBe(454);
  });

  it('contraste: el opt-out es la ÚNICA diferencia — sin él, el borrador no se cuenta', async () => {
    // OJO: la aserción tiene que DISCRIMINAR. Comprobar que la rama con
    // status:'draft' devuelve la fila 454 con visibility_public pasa
    // igual esté vivo o muerto el default (el único borrador del seed YA
    // es visibility_public), así que no probaría nada. Lo que sí falla si
    // el default se debilita es la DIFERENCIA entre las dos ramas: al
    // desactivarlo aparece exactamente esa fila de más.
    const conDefault = await listProducts({});
    const sinDefault = await listProducts({ applyStorefrontDefaults: false });

    expect(sinDefault.total).toBe(conDefault.total + 1);
    expect(conDefault.total).toBe(1199);
  });
});

// ---------------------------------------------------------------------------
// Filtros de US-2 (migración de /api/products): shopId, manufacturerSlug,
// tagSlug. El seed no vincula ningún producto a manufacturer/tag
// (`manufacturer_id`/`product_tag` vacíos — ver db/generate-seed.mjs), así
// que para manufacturerSlug/tagSlug hace falta una fixture: un slug "LIBRE"
// (del seed, sin productos) debe dar total 0, y el slug de la fixture debe
// dar total 1. Son dos slugs DISTINTOS, no la misma consulta con dos
// resultados esperados.
// ---------------------------------------------------------------------------
describe('listProducts — filtros adicionales de US-2', () => {
  it('filtra por shopId: todo item devuelto pertenece a ese shop', async () => {
    const [sample] = (await listProducts({ limit: 1 })).items;
    const { items, total } = await listProducts({ shopId: sample.shopId });
    expect(total).toBeGreaterThan(0);
    for (const p of items) expect(p.shopId).toBe(sample.shopId);
  });

  describe('manufacturerSlug / tagSlug — slug LIBRE (0) vs slug de la fixture (1)', () => {
    let manufacturerLibreSlug: string;
    let manufacturerFix: { id: number; slug: string };
    let tagLibreSlug: string;
    let tagFix: { id: number; slug: string };

    beforeAll(async () => {
      const [mLibreRow, mFixRow] = await prisma.manufacturer.findMany({
        orderBy: { id: 'asc' },
        take: 2,
      });
      const [tLibreRow, tFixRow] = await prisma.tag.findMany({
        orderBy: { id: 'asc' },
        take: 2,
      });
      manufacturerLibreSlug = mLibreRow.slug;
      manufacturerFix = { id: Number(mFixRow.id), slug: mFixRow.slug };
      tagLibreSlug = tLibreRow.slug;
      tagFix = { id: Number(tFixRow.id), slug: tFixRow.slug };

      const gadget = await findTypeBySlug('gadget');
      const [shopSample] = (await listProducts({ limit: 1 })).items;
      if (!gadget) throw new Error('type gadget no existe en el seed');

      // Una sola fixture con manufacturer Y tag a la vez; price > 0 y
      // salePrice < price para no chocar con products_rebaja_valida.
      await upsertScrapedProduct({
        sourceStore: TEST_STORE,
        sourceProductId: 'sku-us2-manufacturer-tag',
        name: 'Producto con manufacturer y tag (US-2)',
        slug: 'producto-us2-manufacturer-tag-test',
        typeId: gadget.id,
        shopId: shopSample.shopId,
        manufacturerId: manufacturerFix.id,
        tagIds: [tagFix.id],
        price: 100,
        salePrice: 80,
      });
    });

    it('manufacturerSlug: slug LIBRE → total 0, slug de la fixture → total 1', async () => {
      const libre = await listProducts({
        manufacturerSlug: manufacturerLibreSlug,
      });
      expect(libre.total).toBe(0);

      const fix = await listProducts({
        manufacturerSlug: manufacturerFix.slug,
      });
      expect(fix.total).toBe(1);
      expect(fix.items[0].sourceStore).toBe(TEST_STORE);
    });

    it('tagSlug: slug LIBRE → total 0, slug de la fixture → total 1', async () => {
      const libre = await listProducts({ tagSlug: tagLibreSlug });
      expect(libre.total).toBe(0);

      const fix = await listProducts({ tagSlug: tagFix.slug });
      expect(fix.total).toBe(1);
    });
  });
});

describe('findProductBySlug', () => {
  it('trae el detalle con relaciones y related del mismo type, INCLUYENDO el propio producto (D-1)', async () => {
    const [sample] = (await listProducts({ limit: 1 })).items;
    const detail = await findProductBySlug(sample.slug);
    expect(detail).not.toBeNull();
    expect(detail?.id).toBe(sample.id);
    expect(detail?.shop.id).toBe(sample.shopId);
    const ids = detail?.relatedProducts.map((r) => r.id) ?? [];
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThanOrEqual(20);
    expect(ids).toContain(sample.id); // D-1: auto-inclusión
    expect([...ids].sort((a, b) => a - b)).toEqual(ids); // orden ascendente
    for (const rel of detail?.relatedProducts ?? []) {
      expect(rel.type.slug).toBe(sample.type.slug);
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
