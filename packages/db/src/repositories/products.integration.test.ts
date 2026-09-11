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
import { InvalidReferenceError, RecordNotFoundError } from '../domain-errors';
import { buildPaginator } from '../pagination';
import { getCategoryTree } from './categories.repository';
import {
  createProduct,
  deleteProduct,
  findProductBySlug,
  findProductShopId,
  InvalidSalePriceError,
  listProducts,
  MissingPriceError,
  updateProduct,
  upsertScrapedProduct,
} from './products.repository';
import { getSettings } from './settings.repository';
import { findTypeBySlug } from './types.repository';

const TEST_STORE = 'TestStore-integration';

// Centinela de las escrituras del admin (US-29, DD29-10): prefijo de slug
// propio, nunca `sourceStore` — `source_store` es NULL en todo producto del
// admin, así que `TEST_STORE` no alcanza estas filas.
const SENTINEL_PREFIX = 'zz-products-';

// Fixtures resueltas contra filas SEMBRADAS (nunca creadas por esta suite),
// mismo patrón que `manufacturerFix`/`tagFix` más abajo (US-2): un type, un
// shop y dos categorías/tags existentes del seed para los describes de
// escritura.
let SENTINEL_TYPE_ID: number;
let SENTINEL_SHOP_ID: number;
let SENTINEL_CATEGORY_A: number;
let SENTINEL_CATEGORY_B: number;
let SENTINEL_TAG_A: number;
let SENTINEL_TAG_B: number;

// Limpieza de ENTRADA, no solo de salida: una corrida abortada (Ctrl-C,
// EADDRINUSE, timeout) deja filas de prueba vivas y la siguiente pasada
// cuenta 12 donde asserta 11. Con esto los conteos absolutos dejan de
// depender de que la corrida anterior terminara bien. Se pliega aquí,
// dentro del `beforeAll` EXISTENTE, la limpieza del centinela de US-29
// (DD29-10): un segundo `beforeAll`/`afterAll` no tiene ningún riesgo de
// orden, pero un cleanup repartido en dos hooks sí duplica lógica sin
// necesidad.
beforeAll(async () => {
  await prisma.product.deleteMany({ where: { sourceStore: TEST_STORE } });
  await prisma.product.deleteMany({
    where: { slug: { startsWith: SENTINEL_PREFIX } },
  });

  const gadget = await findTypeBySlug('gadget');
  if (!gadget) throw new Error('type gadget no existe en el seed');
  const shopRow = await prisma.shop.findFirstOrThrow({ orderBy: { id: 'asc' } });
  const [categoryA, categoryB] = await prisma.category.findMany({
    orderBy: { id: 'asc' },
    take: 2,
  });
  const [tagA, tagB] = await prisma.tag.findMany({ orderBy: { id: 'asc' }, take: 2 });

  SENTINEL_TYPE_ID = gadget.id;
  SENTINEL_SHOP_ID = Number(shopRow.id);
  SENTINEL_CATEGORY_A = Number(categoryA.id);
  SENTINEL_CATEGORY_B = Number(categoryB.id);
  SENTINEL_TAG_A = Number(tagA.id);
  SENTINEL_TAG_B = Number(tagB.id);
});

afterAll(async () => {
  await prisma.product.deleteMany({ where: { sourceStore: TEST_STORE } });
  await prisma.product.deleteMany({
    where: { slug: { startsWith: SENTINEL_PREFIX } },
  });
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

// ---------------------------------------------------------------------------
// Escrituras del admin (US-29) — centinela `zz-products-`, describes AL
// FINAL: vitest ejecuta los describe en orden de archivo, y estas filas no
// deben contaminar ningún conteo absoluto afirmado arriba. Cada `it` borra
// lo que crea, además de la red del `beforeAll`/`afterAll` de arriba
// (DD29-10). Camino feliz solamente — la batería hostil (5 guardas, 3 FK +
// 2 pivotes inexistentes, no-enteros/no-finitos, 404) vive en PR#2.
// ---------------------------------------------------------------------------

describe('createProduct — CA-1, centinela zz-products-', () => {
  it("crea un 'simple': min/max derivados = price, sin pivotes", async () => {
    const created = await createProduct({
      name: `${SENTINEL_PREFIX}simple`,
      slug: `${SENTINEL_PREFIX}simple`,
      typeId: SENTINEL_TYPE_ID,
      shopId: SENTINEL_SHOP_ID,
      price: 100,
    });

    expect(created.productType).toBe('simple');
    expect(created.price).toBe(100);
    expect(created.minPrice).toBe(100);
    expect(created.maxPrice).toBe(100);
    expect(created.categories).toEqual([]);
    expect(created.tags).toEqual([]);
    expect(created.type.id).toBe(SENTINEL_TYPE_ID);
    expect(created.shop.id).toBe(SENTINEL_SHOP_ID);

    const reread = await findProductBySlug(created.slug);
    expect(reread?.id).toBe(created.id);

    await deleteProduct(created.id);
  });

  it("crea un 'variable': price NULL, min/max del input, pivotes con ids", async () => {
    const created = await createProduct({
      name: `${SENTINEL_PREFIX}variable`,
      slug: `${SENTINEL_PREFIX}variable`,
      typeId: SENTINEL_TYPE_ID,
      shopId: SENTINEL_SHOP_ID,
      productType: 'variable',
      minPrice: 50,
      maxPrice: 150,
      categoryIds: [SENTINEL_CATEGORY_A],
      tagIds: [SENTINEL_TAG_A],
    });

    expect(created.productType).toBe('variable');
    expect(created.price).toBeNull();
    expect(created.minPrice).toBe(50);
    expect(created.maxPrice).toBe(150);
    expect(created.categories.map((c) => c.id)).toEqual([SENTINEL_CATEGORY_A]);
    expect(created.tags.map((t) => t.id)).toEqual([SENTINEL_TAG_A]);

    await deleteProduct(created.id);
  });
});

describe('updateProduct — CA-2, pivotes en los 3 estados, slug invariante', () => {
  it('pivote ausente (undefined) no se toca', async () => {
    const created = await createProduct({
      name: `${SENTINEL_PREFIX}pivote-ausente`,
      slug: `${SENTINEL_PREFIX}pivote-ausente`,
      typeId: SENTINEL_TYPE_ID,
      shopId: SENTINEL_SHOP_ID,
      price: 10,
      categoryIds: [SENTINEL_CATEGORY_A],
      tagIds: [SENTINEL_TAG_A],
    });

    const updated = await updateProduct(created.id, {
      name: `${SENTINEL_PREFIX}Pivote Ausente`,
    });
    expect(updated.categories.map((c) => c.id)).toEqual([SENTINEL_CATEGORY_A]);
    expect(updated.tags.map((t) => t.id)).toEqual([SENTINEL_TAG_A]);
    expect(updated.slug).toBe(created.slug);

    await deleteProduct(created.id);
  });

  it('pivote vacío ([]) vacía el set', async () => {
    const created = await createProduct({
      name: `${SENTINEL_PREFIX}pivote-vacio`,
      slug: `${SENTINEL_PREFIX}pivote-vacio`,
      typeId: SENTINEL_TYPE_ID,
      shopId: SENTINEL_SHOP_ID,
      price: 10,
      categoryIds: [SENTINEL_CATEGORY_A],
      tagIds: [SENTINEL_TAG_A],
    });

    const updated = await updateProduct(created.id, { categoryIds: [], tagIds: [] });
    expect(updated.categories).toEqual([]);
    expect(updated.tags).toEqual([]);

    await deleteProduct(created.id);
  });

  it('pivote con ids reemplaza el set completo', async () => {
    const created = await createProduct({
      name: `${SENTINEL_PREFIX}pivote-reemplazo`,
      slug: `${SENTINEL_PREFIX}pivote-reemplazo`,
      typeId: SENTINEL_TYPE_ID,
      shopId: SENTINEL_SHOP_ID,
      price: 10,
      categoryIds: [SENTINEL_CATEGORY_A],
      tagIds: [SENTINEL_TAG_A],
    });

    const updated = await updateProduct(created.id, {
      categoryIds: [SENTINEL_CATEGORY_B],
      tagIds: [SENTINEL_TAG_B],
    });
    expect(updated.categories.map((c) => c.id)).toEqual([SENTINEL_CATEGORY_B]);
    expect(updated.tags.map((t) => t.id)).toEqual([SENTINEL_TAG_B]);

    await deleteProduct(created.id);
  });

  it('name cambia, slug invariante, updatedAt monótono entre dos PUT sucesivos (nunca create-vs-update — relojes distintos)', async () => {
    // Comparación UPDATE-vs-UPDATE, NUNCA create-vs-update — mismo rationale
    // corregido que `categories.integration.test.ts` (US-28, updateCategory
    // — CA-2): `createProduct` escribe `created_at`/`updated_at` como
    // parámetros ligados en el INSERT (columna `@default(now())` sin
    // `@updatedAt`, resuelta CLIENT-SIDE por el driver adapter — confirmado
    // con `log:['query']` y un script de diagnóstico ad hoc), es decir con
    // el reloj de NODE. `updateProduct` en cambio SIEMPRE delega en el
    // trigger `products_updated_at`, con el reloj de POSTGRES (el
    // contenedor). Medido en este entorno con un probe de round-trip
    // ajustado (`clock_timestamp()` bracket con `Date.now()`, RTT de 4-8ms):
    // Node y Postgres NO comparten reloj — divergen ~150-450ms, la
    // divergencia además DERIVA en vivo (no es un offset fijo), y no hay
    // garantía de signo. Comparar `created.updatedAt` (reloj de Node) contra
    // `updated.updatedAt` (reloj de Postgres) mezcla dos relojes
    // independientes: cuando la deriva cae del lado equivocado en la
    // ventana entre las dos llamadas, la resta puede dar NEGATIVA sin que
    // la aplicación haya hecho nada mal — el defecto real estaba en el test,
    // no en `updateProduct` (verificado: `just db-check` con este mismo
    // fix, corrido en verde repetidamente; ver `apply-progress.md`). Dos
    // `PUT` sucesivos SÍ usan el mismo reloj (el trigger, las dos veces) y
    // son monótonos de forma fiable — precedente idéntico en
    // `categories.integration.test.ts:277-319`.
    const created = await createProduct({
      name: `${SENTINEL_PREFIX}Original`,
      slug: `${SENTINEL_PREFIX}slug-invariante`,
      typeId: SENTINEL_TYPE_ID,
      shopId: SENTINEL_SHOP_ID,
      price: 10,
    });

    const firstUpdate = await updateProduct(created.id, {
      name: `${SENTINEL_PREFIX}Renombrado`,
    });
    expect(firstUpdate.name).toBe(`${SENTINEL_PREFIX}Renombrado`);
    expect(firstUpdate.slug).toBe(`${SENTINEL_PREFIX}slug-invariante`);

    const secondUpdate = await updateProduct(created.id, {
      name: `${SENTINEL_PREFIX}Renombrado Otra Vez`,
    });
    expect(secondUpdate.slug).toBe(`${SENTINEL_PREFIX}slug-invariante`);
    // `toBeGreaterThan` estricto (no `toBeGreaterThanOrEqual`): mismo reloj
    // las dos veces (el trigger), así que una igualdad exacta SÍ sería
    // sospechosa — sería el trigger sin disparar. Precedente idéntico:
    // `categories.integration.test.ts:306-316`.
    expect(secondUpdate.updatedAt.getTime()).toBeGreaterThan(
      firstUpdate.updatedAt.getTime()
    );

    await deleteProduct(created.id);
  });
});

describe('deleteProduct — CA-3, snapshot pre-borrado', () => {
  it('borra y devuelve el snapshot pre-borrado; los pivotes constan; un GET posterior es null', async () => {
    const created = await createProduct({
      name: `${SENTINEL_PREFIX}borrar`,
      slug: `${SENTINEL_PREFIX}borrar`,
      typeId: SENTINEL_TYPE_ID,
      shopId: SENTINEL_SHOP_ID,
      price: 10,
      categoryIds: [SENTINEL_CATEGORY_A],
    });

    expect(await findProductShopId(created.id)).toBe(SENTINEL_SHOP_ID);

    const snapshot = await deleteProduct(created.id);
    expect(snapshot.id).toBe(created.id);
    expect(snapshot.categories.map((c) => c.id)).toEqual([SENTINEL_CATEGORY_A]);

    expect(await findProductBySlug(created.slug)).toBeNull();
    expect(await findProductShopId(created.id)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Batería hostil de integración (US-29, PR#2) — centinela `zz-products-`,
// misma red de limpieza del `beforeAll`/`afterAll` de arriba. Prueba CA-4
// («nunca 500»): las 5 guardas CHECK/IN, las 3 FK + 2 pivotes inexistentes,
// la frontera numérica (no enteros / no finitos) y los 404 de
// `updateProduct`/`deleteProduct`. Todo vía el repositorio (no HTTP): un 500
// aquí se manifiesta como una excepción NO instancia de las clases de
// dominio (`RangeError`, `TypeError`, un `PrismaClientKnownRequestError` sin
// traducir, etc.) — por eso cada aserción es `toBeInstanceOf`, nunca
// `.rejects.toThrow()` a secas.
// ---------------------------------------------------------------------------

describe('Las cinco guardas CHECK/IN — 400, nunca 500 (Herencia 2, DD29-1/DD29-2/DD29-9)', () => {
  it('regla 1: sale_price >= price → InvalidSalePriceError (heredada y adaptada, DD29-9)', async () => {
    await expect(
      createProduct({
        name: `${SENTINEL_PREFIX}rebaja-invalida`,
        slug: `${SENTINEL_PREFIX}rebaja-invalida`,
        typeId: SENTINEL_TYPE_ID,
        shopId: SENTINEL_SHOP_ID,
        price: 50,
        salePrice: 60,
      })
    ).rejects.toBeInstanceOf(InvalidSalePriceError);
  });

  it("regla 2: product_type 'simple' sin price → MissingPriceError (nueva)", async () => {
    await expect(
      createProduct({
        name: `${SENTINEL_PREFIX}simple-sin-precio`,
        slug: `${SENTINEL_PREFIX}simple-sin-precio`,
        typeId: SENTINEL_TYPE_ID,
        shopId: SENTINEL_SHOP_ID,
        productType: 'simple',
      })
    ).rejects.toBeInstanceOf(MissingPriceError);
  });

  it("regla 3: product_type fuera de IN ('simple','variable') → InvalidReferenceError (nueva, DD29-2)", async () => {
    await expect(
      createProduct({
        name: `${SENTINEL_PREFIX}type-invalido`,
        slug: `${SENTINEL_PREFIX}type-invalido`,
        typeId: SENTINEL_TYPE_ID,
        shopId: SENTINEL_SHOP_ID,
        price: 10,
        productType: 'furniture',
      })
    ).rejects.toBeInstanceOf(InvalidReferenceError);
  });

  it("regla 4: status fuera de IN ('publish','draft') → InvalidReferenceError (nueva, DD29-2)", async () => {
    await expect(
      createProduct({
        name: `${SENTINEL_PREFIX}status-invalido`,
        slug: `${SENTINEL_PREFIX}status-invalido`,
        typeId: SENTINEL_TYPE_ID,
        shopId: SENTINEL_SHOP_ID,
        price: 10,
        status: 'archived',
      })
    ).rejects.toBeInstanceOf(InvalidReferenceError);
  });

  // regla 5 (products_procedencia_completa): SIN test de runtime, a propósito
  // (design.md, tabla de las cinco guardas, fila 5). `CreateProductInput` no
  // declara `sourceStore`/`sourceProductId` en absoluto — el input del admin
  // no tiene forma de expresar la violación. `num_nonnulls(source_store,
  // source_product_id)` es SIEMPRE 0 para estas filas, nunca ∈ (0,2):
  // inalcanzable por construcción del tipo, no por una guarda de código que
  // pudiera tener un bug. Documentado aquí en vez de simulado.
});

describe('Las tres FK salientes y los dos pivotes inexistentes → InvalidReferenceError, nunca 500 (DD29-4, DD29-6)', () => {
  it('type_id inexistente → InvalidReferenceError vía P2003/translateCatalogWriteError', async () => {
    await expect(
      createProduct({
        name: `${SENTINEL_PREFIX}fk-type-fantasma`,
        slug: `${SENTINEL_PREFIX}fk-type-fantasma`,
        typeId: 999999,
        shopId: SENTINEL_SHOP_ID,
        price: 10,
      })
    ).rejects.toBeInstanceOf(InvalidReferenceError);
  });

  it('shop_id inexistente → InvalidReferenceError vía P2003/translateCatalogWriteError', async () => {
    await expect(
      createProduct({
        name: `${SENTINEL_PREFIX}fk-shop-fantasma`,
        slug: `${SENTINEL_PREFIX}fk-shop-fantasma`,
        typeId: SENTINEL_TYPE_ID,
        shopId: 999999,
        price: 10,
      })
    ).rejects.toBeInstanceOf(InvalidReferenceError);
  });

  it('manufacturer_id inexistente → InvalidReferenceError vía P2003 (SET NULL en el DDL, pero inexistente en la escritura NO es opcional silencioso)', async () => {
    await expect(
      createProduct({
        name: `${SENTINEL_PREFIX}fk-manufacturer-fantasma`,
        slug: `${SENTINEL_PREFIX}fk-manufacturer-fantasma`,
        typeId: SENTINEL_TYPE_ID,
        shopId: SENTINEL_SHOP_ID,
        manufacturerId: 999999,
        price: 10,
      })
    ).rejects.toBeInstanceOf(InvalidReferenceError);
  });

  it('categoryIds con id inexistente → InvalidReferenceError vía la sonda _assertPivotIdsExist, NO vía P2003 (pregunta empírica de DD29-6, cerrada)', async () => {
    let error: unknown;
    try {
      await createProduct({
        name: `${SENTINEL_PREFIX}pivote-categoria-fantasma`,
        slug: `${SENTINEL_PREFIX}pivote-categoria-fantasma`,
        typeId: SENTINEL_TYPE_ID,
        shopId: SENTINEL_SHOP_ID,
        price: 10,
        categoryIds: [999999],
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(InvalidReferenceError);
    // La sonda `count` (DD29-6) lanza `InvalidReferenceError('products',
    // 'categories[]')` SIN un tercer argumento `value` — el mensaje es el
    // literal exacto de abajo. Un P2003 traducido por
    // `translateCatalogWriteError` llevaría en cambio `meta.field_name` (si
    // Prisma 7 + adapter-pg lo emite para una fila pivote — lo que este
    // design marcaba como no verificado) o el `'desconocida'` genérico de
    // respaldo; ninguno de los dos produce este literal. El mensaje
    // observado confirma que la sonda es la que disparó, no el `catch` del
    // `create` anidado — cierra la pregunta empírica de DD29-6.
    expect((error as Error).message).toBe(
      '`products.categories[]` referencia un registro inexistente.'
    );
    // Nada se creó: la sonda corre ANTES de `generateSlug`/`prisma.create`.
    expect(
      await findProductBySlug(`${SENTINEL_PREFIX}pivote-categoria-fantasma`)
    ).toBeNull();
  });

  it('tagIds con id inexistente → InvalidReferenceError vía la sonda _assertPivotIdsExist, NO vía P2003', async () => {
    let error: unknown;
    try {
      await createProduct({
        name: `${SENTINEL_PREFIX}pivote-tag-fantasma`,
        slug: `${SENTINEL_PREFIX}pivote-tag-fantasma`,
        typeId: SENTINEL_TYPE_ID,
        shopId: SENTINEL_SHOP_ID,
        price: 10,
        tagIds: [999999],
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(InvalidReferenceError);
    expect((error as Error).message).toBe(
      '`products.tags[]` referencia un registro inexistente.'
    );
    expect(
      await findProductBySlug(`${SENTINEL_PREFIX}pivote-tag-fantasma`)
    ).toBeNull();
  });
});

describe('Frontera numérica: no-enteros y no-finitos → InvalidReferenceError, nunca 500/RangeError sin traducir (DD29-3)', () => {
  it('type_id/shop_id/manufacturer_id y ids de pivote no enteros ("abc", 1e21) → InvalidReferenceError', async () => {
    await expect(
      createProduct({
        name: `${SENTINEL_PREFIX}type-abc`,
        slug: `${SENTINEL_PREFIX}type-abc`,
        typeId: Number('abc'),
        shopId: SENTINEL_SHOP_ID,
        price: 10,
      })
    ).rejects.toBeInstanceOf(InvalidReferenceError);

    await expect(
      createProduct({
        name: `${SENTINEL_PREFIX}shop-1e21`,
        slug: `${SENTINEL_PREFIX}shop-1e21`,
        typeId: SENTINEL_TYPE_ID,
        shopId: 1e21,
        price: 10,
      })
    ).rejects.toBeInstanceOf(InvalidReferenceError);

    await expect(
      createProduct({
        name: `${SENTINEL_PREFIX}manufacturer-abc`,
        slug: `${SENTINEL_PREFIX}manufacturer-abc`,
        typeId: SENTINEL_TYPE_ID,
        shopId: SENTINEL_SHOP_ID,
        manufacturerId: Number('abc'),
        price: 10,
      })
    ).rejects.toBeInstanceOf(InvalidReferenceError);

    await expect(
      createProduct({
        name: `${SENTINEL_PREFIX}categoria-1e21`,
        slug: `${SENTINEL_PREFIX}categoria-1e21`,
        typeId: SENTINEL_TYPE_ID,
        shopId: SENTINEL_SHOP_ID,
        price: 10,
        categoryIds: [1e21],
      })
    ).rejects.toBeInstanceOf(InvalidReferenceError);

    await expect(
      createProduct({
        name: `${SENTINEL_PREFIX}tag-abc`,
        slug: `${SENTINEL_PREFIX}tag-abc`,
        typeId: SENTINEL_TYPE_ID,
        shopId: SENTINEL_SHOP_ID,
        price: 10,
        tagIds: [Number('abc')],
      })
    ).rejects.toBeInstanceOf(InvalidReferenceError);
  });

  it('price/sale_price/min_price/max_price no finitos ("abc", NaN, 1e300 fuera de numeric(12,2)) → InvalidReferenceError', async () => {
    await expect(
      createProduct({
        name: `${SENTINEL_PREFIX}price-abc`,
        slug: `${SENTINEL_PREFIX}price-abc`,
        typeId: SENTINEL_TYPE_ID,
        shopId: SENTINEL_SHOP_ID,
        price: Number('abc'),
      })
    ).rejects.toBeInstanceOf(InvalidReferenceError);

    await expect(
      createProduct({
        name: `${SENTINEL_PREFIX}saleprice-nan`,
        slug: `${SENTINEL_PREFIX}saleprice-nan`,
        typeId: SENTINEL_TYPE_ID,
        shopId: SENTINEL_SHOP_ID,
        price: 100,
        salePrice: Number.NaN,
      })
    ).rejects.toBeInstanceOf(InvalidReferenceError);

    await expect(
      createProduct({
        name: `${SENTINEL_PREFIX}minprice-1e300`,
        slug: `${SENTINEL_PREFIX}minprice-1e300`,
        typeId: SENTINEL_TYPE_ID,
        shopId: SENTINEL_SHOP_ID,
        productType: 'variable',
        minPrice: 1e300,
        maxPrice: 200,
      })
    ).rejects.toBeInstanceOf(InvalidReferenceError);

    await expect(
      createProduct({
        name: `${SENTINEL_PREFIX}maxprice-1e300`,
        slug: `${SENTINEL_PREFIX}maxprice-1e300`,
        typeId: SENTINEL_TYPE_ID,
        shopId: SENTINEL_SHOP_ID,
        productType: 'variable',
        minPrice: 50,
        maxPrice: 1e300,
      })
    ).rejects.toBeInstanceOf(InvalidReferenceError);
  });

  it('quantity no entero (1.5) → InvalidReferenceError', async () => {
    await expect(
      createProduct({
        name: `${SENTINEL_PREFIX}quantity-decimal`,
        slug: `${SENTINEL_PREFIX}quantity-decimal`,
        typeId: SENTINEL_TYPE_ID,
        shopId: SENTINEL_SHOP_ID,
        price: 10,
        quantity: 1.5,
      })
    ).rejects.toBeInstanceOf(InvalidReferenceError);
  });
});

describe('404 en updateProduct/deleteProduct con id inexistente, y duplicados de pivote sin P2002 espurio (DD29-6, Herencia 2)', () => {
  it('updateProduct(999999999, …) → RecordNotFoundError', async () => {
    await expect(
      updateProduct(999999999, { name: `${SENTINEL_PREFIX}fantasma` })
    ).rejects.toBeInstanceOf(RecordNotFoundError);
  });

  it('deleteProduct(999999999) → RecordNotFoundError', async () => {
    await expect(deleteProduct(999999999)).rejects.toBeInstanceOf(RecordNotFoundError);
  });

  it('categoryIds/tagIds con ids duplicados no producen un P2002 espurio (uniq(), DD29-6)', async () => {
    const created = await createProduct({
      name: `${SENTINEL_PREFIX}pivote-duplicado`,
      slug: `${SENTINEL_PREFIX}pivote-duplicado`,
      typeId: SENTINEL_TYPE_ID,
      shopId: SENTINEL_SHOP_ID,
      price: 10,
      categoryIds: [SENTINEL_CATEGORY_A, SENTINEL_CATEGORY_A],
      tagIds: [SENTINEL_TAG_A, SENTINEL_TAG_A],
    });

    expect(created.categories.map((c) => c.id)).toEqual([SENTINEL_CATEGORY_A]);
    expect(created.tags.map((t) => t.id)).toEqual([SENTINEL_TAG_A]);

    const updated = await updateProduct(created.id, {
      categoryIds: [SENTINEL_CATEGORY_A, SENTINEL_CATEGORY_B, SENTINEL_CATEGORY_B],
    });
    expect(updated.categories.map((c) => c.id).sort((a, b) => a - b)).toEqual(
      [SENTINEL_CATEGORY_A, SENTINEL_CATEGORY_B].sort((a, b) => a - b)
    );

    await deleteProduct(created.id);
  });
});
