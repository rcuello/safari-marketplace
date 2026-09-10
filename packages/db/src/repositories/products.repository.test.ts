/**
 * Test de UNIDAD de `_toProductRecord` — sin base, sin carrera (hallazgo
 * RV-1 de `sdd-verify` en US-27b). Las guardas de null que fija son
 * invisibles para `tsc`: Prisma tipa `row.type`, `row.shop`, `link.tag` y
 * `link.category` como no nulos, así que sin este archivo un refactor podría
 * borrarlas como código muerto y el gate volvería a fallar al 8-20 % (C-1).
 *
 * La fixture se construye a mano con la forma EXACTA del payload de Prisma
 * (`include: PRODUCT_INCLUDE`): `bigint` en los ids y `Prisma.Decimal` en
 * los precios, tipada contra el propio parámetro del mapper para que
 * `tsc --noEmit` la valide. Se rompe a propósito con `as unknown as` (nunca
 * `as any`): el TIPO no admite el `null` que el runtime sí produce cuando el
 * agregado se borra entre la consulta principal y la del include.
 *
 * NO importa `dotenv/config` ni toca `prisma`: el cliente es lazy vía Proxy
 * (`client.ts:35-45`) y este archivo nunca accede a él. Por eso no es
 * `.integration.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { Prisma } from '../../generated/prisma/client/client';
import { _toProductRecord } from './products.repository';

type ProductPayload = Parameters<typeof _toProductRecord>[0];
type TypeRow = ProductPayload['type'];
type ShopRow = ProductPayload['shop'];
type TagLink = ProductPayload['tags'][number];
type CategoryLink = ProductPayload['categories'][number];

const NOW = new Date('2026-09-10T00:00:00Z');

const TYPE: TypeRow = {
  id: 9n,
  name: 'Gadget',
  slug: 'gadget',
  icon: null,
  settings: {},
  banners: [],
  language: 'en',
  createdAt: NOW,
  updatedAt: NOW,
};

const SHOP: ShopRow = {
  id: 1n,
  name: 'Tienda',
  slug: 'tienda',
  description: null,
  ownerId: 1n,
  isActive: true,
  logo: null,
  coverImage: null,
  address: {},
  settings: {},
  createdAt: NOW,
  updatedAt: NOW,
};

const TAG_LINK: TagLink = {
  productId: 100n,
  tagId: 53n,
  tag: {
    id: 53n,
    name: 'Baby Milk',
    slug: 'baby-milk',
    details: null,
    icon: null,
    image: null,
    typeId: 9n,
    language: 'es',
    createdAt: NOW,
    updatedAt: NOW,
  },
};

const CATEGORY_LINK: CategoryLink = {
  productId: 100n,
  categoryId: 1n,
  category: {
    id: 1n,
    name: 'Fruits',
    slug: 'fruits',
    icon: null,
    details: null,
    image: null,
    parentId: null,
    typeId: 9n,
    language: 'es',
    createdAt: NOW,
    updatedAt: NOW,
  },
};

function makeRow(overrides: Partial<ProductPayload> = {}): ProductPayload {
  return {
    id: 100n,
    name: 'Producto',
    slug: 'producto',
    description: '',
    typeId: 9n,
    shopId: 1n,
    manufacturerId: null,
    productType: 'simple',
    price: new Prisma.Decimal('100.00'),
    salePrice: new Prisma.Decimal('80.00'),
    minPrice: new Prisma.Decimal('100.00'),
    maxPrice: new Prisma.Decimal('100.00'),
    quantity: 5,
    inStock: true,
    soldQuantity: 0,
    sku: null,
    unit: '1 pc',
    status: 'publish',
    visibility: 'visibility_public',
    image: null,
    gallery: [],
    ratings: new Prisma.Decimal('0.00'),
    totalReviews: 0,
    isTaxable: false,
    isDigital: false,
    isExternal: false,
    externalProductUrl: null,
    language: 'es',
    translatedLanguages: ['es'],
    sourceStore: null,
    sourceProductId: null,
    sourceUrl: null,
    scrapedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    type: TYPE,
    shop: SHOP,
    manufacturer: null,
    categories: [CATEGORY_LINK],
    tags: [TAG_LINK],
    ...overrides,
  };
}

describe('_toProductRecord — fila sana', () => {
  it('mapea bigint → number, Decimal → number y las 5 relaciones; JSON-safe', () => {
    const record = _toProductRecord(makeRow());

    expect(record).not.toBeNull();
    expect(record?.id).toBe(100);
    expect(record?.typeId).toBe(9);
    expect(record?.price).toBe(100);
    expect(record?.salePrice).toBe(80);
    expect(record?.ratings).toBe(0);
    expect(record?.type.slug).toBe('gadget');
    expect(record?.shop.id).toBe(1);
    // `manufacturer` NULL es un DATO (FK nullable), no una lectura rota: el
    // producto se conserva. Contraste con `type`/`shop` más abajo.
    expect(record?.manufacturer).toBeNull();
    expect(record?.categories.map((c) => c.slug)).toEqual(['fruits']);
    expect(record?.tags.map((t) => t.slug)).toEqual(['baby-milk']);
    expect(() => JSON.stringify(record)).not.toThrow();
  });
});

describe('_toProductRecord — pivote sin destino (C-1, US-27b): se descarta el ENLACE, no el producto', () => {
  it('`link.tag === null` → `tags` sin ese enlace, el resto del producto intacto', () => {
    const tornLink = { ...TAG_LINK, tagId: 999n, tag: null } as unknown as TagLink;
    const record = _toProductRecord(makeRow({ tags: [TAG_LINK, tornLink] }));

    expect(record).not.toBeNull();
    expect(record?.tags.map((t) => t.id)).toEqual([53]);
    expect(record?.id).toBe(100);
  });

  it('`link.category === null` → `categories` sin ese enlace, el resto intacto', () => {
    const tornLink = {
      ...CATEGORY_LINK,
      categoryId: 999n,
      category: null,
    } as unknown as CategoryLink;
    const record = _toProductRecord(makeRow({ categories: [tornLink, CATEGORY_LINK] }));

    expect(record).not.toBeNull();
    expect(record?.categories.map((c) => c.id)).toEqual([1]);
    expect(record?.tags).toHaveLength(1);
  });
});

describe('_toProductRecord — FK NOT NULL sin destino (RV-2, US-27b): se descarta el PRODUCTO', () => {
  it('`row.type === null` → `null`, nunca `TypeError`', () => {
    const row = makeRow({ type: null as unknown as TypeRow });

    expect(() => _toProductRecord(row)).not.toThrow();
    expect(_toProductRecord(row)).toBeNull();
  });

  it('`row.shop === null` → `null`, nunca `TypeError` (la ventana que abre `deleteShop`, US-30)', () => {
    const row = makeRow({ shop: null as unknown as ShopRow });

    expect(() => _toProductRecord(row)).not.toThrow();
    expect(_toProductRecord(row)).toBeNull();
  });
});
