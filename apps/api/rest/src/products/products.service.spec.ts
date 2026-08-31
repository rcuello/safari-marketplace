/// <reference types="jest" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de jest;
 * se limita a este archivo para no tocar la config del build.
 */
/**
 * Tests unitarios de `ProductsService.getProducts()` (US-2, deuda V-4).
 *
 * Estrategia: los helpers `parseProductSearch` / `parseFiniteNumber` /
 * `toProductDto` son privados del módulo por diseño (Decision C del design
 * archivado de US-2) y NO se exportan: se prueban a través de la superficie
 * pública, mockeando SOLO `listProducts` de `@safari/db` y asertando (a) lo
 * que recibe el repositorio mockeado y (b) lo que devuelve `getProducts()`.
 * `isPrismaConnectionError` / `getUserFriendlyMessage` se dejan REALES
 * (jest.requireActual) para que el mapeo de errores 503/500 se pruebe
 * contra la clasificación verdadera, sin base de datos.
 */
import 'reflect-metadata';
import {
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  findProductBySlug,
  listProducts,
  type ListProductsInput,
  type ProductDetail,
  type ProductRecord,
} from '@safari/db';
import { ProductsService } from './products.service';
import { GetProductsDto } from './dto/get-products.dto';
import { Product } from './entities/product.entity';

jest.mock('@safari/db', () => ({
  // El barrel es seguro de cargar sin DATABASE_URL (cliente lazy vía Proxy);
  // se conservan los helpers de errores reales y solo se mockea el acceso a
  // datos.
  ...jest.requireActual<typeof import('@safari/db')>('@safari/db'),
  listProducts: jest.fn(),
  findProductBySlug: jest.fn(),
}));

const listProductsMock = jest.mocked(listProducts);
const findProductBySlugMock = jest.mocked(findProductBySlug);

/**
 * `ValidationPipe` corre sin `transform` (Decision A del design de US-2):
 * en runtime los query params llegan como strings crudos aunque el DTO
 * declare números. Este cast reproduce esa realidad — mismo patrón
 * `as unknown as` que usa el propio servicio en `toProductDto()`.
 */
function rawQuery(
  query: Record<string, string | number | undefined>,
): GetProductsDto {
  return query as unknown as GetProductsDto;
}

/**
 * Proyección de 20 claves que publica el listado (spec
 * `openspec/specs/product-listing-api/spec.md`). La entidad `Product`
 * declara campos que el listado no emite, así que se asierta contra esta
 * forma — mismo cast-precedente que `products.service.ts` /
 * `settings.service.ts:39`.
 */
interface ProductListItemDto {
  id: number;
  name: string;
  slug: string;
  type: {
    id: number;
    name: string;
    slug: string;
    logo: null;
    settings: unknown;
  };
  language: string;
  translated_languages: string[];
  product_type: string;
  shop: { id: number; name: string; slug: string; logo: unknown };
  sale_price: number | null;
  max_price: number | null;
  min_price: number | null;
  image: unknown;
  status: string;
  price: number | null;
  quantity: number;
  unit: string;
  sku: string | null;
  sold_quantity: number;
  in_flash_sale: number;
  visibility: string;
}

function asDto(product: Product): ProductListItemDto {
  return product as unknown as ProductListItemDto;
}

/** Las 20 claves exactas, en el orden del mock (tabla del design de US-2). */
const EXPECTED_KEYS = [
  'id',
  'name',
  'slug',
  'type',
  'language',
  'translated_languages',
  'product_type',
  'shop',
  'sale_price',
  'max_price',
  'min_price',
  'image',
  'status',
  'price',
  'quantity',
  'unit',
  'sku',
  'sold_quantity',
  'in_flash_sale',
  'visibility',
];

/** Las 21 claves del detalle: las 20 del listado + `related_products` al final. */
const EXPECTED_DETAIL_KEYS = [...EXPECTED_KEYS, 'related_products'];

const NOW = new Date('2026-08-25T00:00:00Z');

/** `ProductRecord` completo y realista (camelCase, como sale de @safari/db). */
function makeProductRecord(
  overrides: Partial<ProductRecord> = {},
): ProductRecord {
  return {
    id: 1,
    name: 'Apples',
    slug: 'apples',
    description: 'Fruta fresca del seed',
    typeId: 1,
    shopId: 6,
    manufacturerId: null,
    productType: 'simple',
    price: 2,
    salePrice: 1.6,
    minPrice: 2,
    maxPrice: 2,
    quantity: 20,
    inStock: true,
    soldQuantity: 10,
    sku: 'SKU-APPLES-1',
    unit: '1lb',
    status: 'publish',
    visibility: 'visibility_public',
    image: {
      id: 1,
      original: 'https://cdn.example/apples.jpg',
      thumbnail: 'https://cdn.example/conversions/apples-thumbnail.jpg',
    },
    gallery: [],
    ratings: 0,
    totalReviews: 0,
    isTaxable: false,
    isDigital: false,
    isExternal: false,
    externalProductUrl: null,
    language: 'en',
    translatedLanguages: ['en'],
    sourceStore: null,
    sourceProductId: null,
    sourceUrl: null,
    scrapedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    type: {
      id: 1,
      name: 'Grocery',
      slug: 'grocery',
      // `icon` poblado a propósito: prueba que `type.logo` NO sale de aquí.
      icon: 'FruitsVegetable',
      settings: { isHome: true, layoutType: 'classic', productCard: 'neon' },
      banners: [],
      language: 'en',
      createdAt: NOW,
      updatedAt: NOW,
    },
    shop: {
      id: 6,
      name: 'Grocery Shop',
      slug: 'grocery-shop',
      description: null,
      ownerId: 1,
      isActive: true,
      logo: {
        id: 935,
        original: 'https://cdn.example/logo.png',
        thumbnail: 'https://cdn.example/conversions/logo-thumbnail.jpg',
      },
      coverImage: null,
      address: {},
      settings: {},
      createdAt: NOW,
      updatedAt: NOW,
    },
    manufacturer: null,
    categories: [],
    tags: [],
    ...overrides,
  };
}

/** `ProductDetail` = `ProductRecord` + `relatedProducts` (US-3). */
function makeProductDetail(
  overrides: Partial<ProductDetail> = {},
): ProductDetail {
  return {
    ...makeProductRecord(),
    relatedProducts: [],
    ...overrides,
  };
}

describe('ProductsService.getProducts (Postgres vía @safari/db, US-2)', () => {
  let service: ProductsService;

  beforeEach(() => {
    listProductsMock.mockReset();
    listProductsMock.mockResolvedValue({
      items: [makeProductRecord()],
      total: 1,
    });
    service = new ProductsService();
  });

  describe('proyección de producto — contrato de 20 claves', () => {
    it('emite exactamente las 20 claves snake_case del mock, en su orden', async () => {
      const result = await service.getProducts(rawQuery({}));

      expect(result.data).toHaveLength(1);
      // Set Y orden exactos — ni una clave más, ni una menos.
      expect(Object.keys(result.data[0])).toEqual(EXPECTED_KEYS);
    });

    it('anida type {id,name,slug,logo,settings} y shop {id,name,slug,logo}', async () => {
      const result = await service.getProducts(rawQuery({}));
      const dto = asDto(result.data[0]);

      expect(Object.keys(dto.type)).toEqual([
        'id',
        'name',
        'slug',
        'logo',
        'settings',
      ]);
      expect(Object.keys(dto.shop)).toEqual(['id', 'name', 'slug', 'logo']);
    });

    it('emite in_flash_sale=0 y type.logo=null constantes (sin columna que los respalde)', async () => {
      const result = await service.getProducts(rawQuery({}));
      const dto = asDto(result.data[0]);

      expect(dto.in_flash_sale).toBe(0);
      // Constante null aunque el record traiga `type.icon` poblado.
      expect(dto.type.logo).toBeNull();
    });

    it('traduce camelCase del record a snake_case del contrato', async () => {
      const record = makeProductRecord();
      const result = await service.getProducts(rawQuery({}));
      const dto = asDto(result.data[0]);

      expect(dto.translated_languages).toEqual(record.translatedLanguages);
      expect(dto.product_type).toBe(record.productType);
      expect(dto.sale_price).toBe(record.salePrice);
      expect(dto.max_price).toBe(record.maxPrice);
      expect(dto.min_price).toBe(record.minPrice);
      expect(dto.sold_quantity).toBe(record.soldQuantity);
      expect(dto.shop.logo).toEqual(record.shop.logo);
      expect(dto.type.settings).toEqual(record.type.settings);
      expect(result.total).toBe(1);
    });
  });

  describe('per_page — preservación de tipo (Decision A)', () => {
    it('con ?limit=30 explícito: per_page es el STRING "30" y listProducts recibe el NUMBER 30', async () => {
      listProductsMock.mockResolvedValue({
        items: [makeProductRecord()],
        total: 1199,
      });

      // ValidationPipe no transforma: limit/page llegan como strings.
      const result = await service.getProducts(
        rawQuery({ limit: '30', page: '1' }),
      );

      expect(typeof result.per_page).toBe('string');
      expect(result.per_page).toBe('30');
      // El repositorio, en cambio, recibe números (skip/take de Prisma).
      expect(listProductsMock).toHaveBeenCalledTimes(1);
      expect(listProductsMock).toHaveBeenCalledWith({ page: 1, limit: 30 });
    });

    it('sin limit: per_page es el NUMBER 30 (default interno del servicio)', async () => {
      const result = await service.getProducts(rawQuery({}));

      expect(typeof result.per_page).toBe('number');
      expect(result.per_page).toBe(30);
      expect(listProductsMock).toHaveBeenCalledWith({ page: 1, limit: 30 });
    });
  });

  describe('parseo de search → ListProductsInput', () => {
    it('traduce los 10 tokens soportados a sus campos camelCase', async () => {
      const search = [
        'type.slug:gadget',
        'categories.slug:laptop',
        'tags.slug:oferta',
        'manufacturer.slug:apple-inc',
        'name:apple',
        'shop_id:6',
        'min_price:10',
        'max_price:99',
        'status:publish',
        'visibility:visibility_public',
      ].join(';');

      await service.getProducts(rawQuery({ search }));

      const expected: ListProductsInput = {
        typeSlug: 'gadget',
        categorySlug: 'laptop',
        tagSlug: 'oferta',
        manufacturerSlug: 'apple-inc',
        name: 'apple',
        shopId: 6,
        minPrice: 10,
        maxPrice: 99,
        status: 'publish',
        visibility: 'visibility_public',
        page: 1,
        limit: 30,
      };
      // Igualdad exacta del objeto: prueba también que no se cuelan claves.
      expect(listProductsMock).toHaveBeenCalledWith(expected);
    });

    it('descarta slug y ignora claves desconocidas (author.slug, orderBy, sortedBy) sin error', async () => {
      const search =
        'name:apple;slug:apples;author.slug:jane;orderBy:name;sortedBy:asc';

      await service.getProducts(rawQuery({ search }));

      // Solo sobrevive `name`; ningún token desconocido genera clave ni error.
      expect(listProductsMock).toHaveBeenCalledWith({
        name: 'apple',
        page: 1,
        limit: 30,
      });
    });

    it('sin search: llama al repositorio solo con la paginación', async () => {
      await service.getProducts(rawQuery({}));

      expect(listProductsMock).toHaveBeenCalledWith({ page: 1, limit: 30 });
    });
  });

  describe('tokens numéricos malformados — regresión V-3', () => {
    it('ignora shop_id/min_price/max_price no numéricos y el request sigue en 200 (antes: 500)', async () => {
      const search =
        'shop_id:abc;min_price:abc;max_price:abc;status:publish;visibility:visibility_public';

      // No lanza: el filtro malformado simplemente no se aplica.
      const result = await service.getProducts(rawQuery({ search }));

      expect(result.data).toHaveLength(1);
      // Ni shopId, ni minPrice, ni maxPrice — y ningún NaN camino a Prisma.
      expect(listProductsMock).toHaveBeenCalledWith({
        status: 'publish',
        visibility: 'visibility_public',
        page: 1,
        limit: 30,
      });
    });

    it('los mismos tokens con valores numéricos válidos SÍ se aplican', async () => {
      await service.getProducts(
        rawQuery({ search: 'shop_id:6;min_price:50;max_price:100' }),
      );

      expect(listProductsMock).toHaveBeenCalledWith({
        shopId: 6,
        minPrice: 50,
        maxPrice: 100,
        page: 1,
        limit: 30,
      });
    });
  });

  describe('mapeo de errores de base (CA-5, Decision D)', () => {
    it('error de conexión de Prisma → 503 con mensaje amigable', async () => {
      // Error con la forma real de PrismaClientInitializationError; lo
      // clasifica el isPrismaConnectionError REAL (sin mockear).
      const connectionError = new Error(
        "Can't reach database server at `localhost:5433`",
      );
      connectionError.name = 'PrismaClientInitializationError';
      listProductsMock.mockRejectedValue(connectionError);

      expect.assertions(3);
      try {
        await service.getProducts(rawQuery({ limit: '30' }));
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceUnavailableException);
        const http = error as ServiceUnavailableException;
        expect(http.getStatus()).toBe(503);
        expect(http.message).toBe(
          'No se puede conectar con el servicio. Por favor, intenta más tarde.',
        );
      }
    });

    it('cualquier otro error → 500 con mensaje amigable, sin crashear el proceso', async () => {
      listProductsMock.mockRejectedValue(new Error('boom inesperado'));

      expect.assertions(3);
      try {
        await service.getProducts(rawQuery({ limit: '30' }));
      } catch (error) {
        expect(error).toBeInstanceOf(InternalServerErrorException);
        const http = error as InternalServerErrorException;
        expect(http.getStatus()).toBe(500);
        expect(http.message).toBe(
          'Ocurrió un error inesperado. Por favor, contacta al administrador.',
        );
      }
    });
  });
});

describe('ProductsService.getProductBySlug (Postgres vía @safari/db, US-3)', () => {
  let service: ProductsService;

  beforeEach(() => {
    findProductBySlugMock.mockReset();
    service = new ProductsService();
  });

  it('emite exactamente las 21 claves del detalle (20 del listado + related_products), en orden', async () => {
    findProductBySlugMock.mockResolvedValue(
      makeProductDetail({ relatedProducts: [makeProductRecord()] }),
    );

    const result = await service.getProductBySlug('apples');

    expect(Object.keys(result)).toEqual(EXPECTED_DETAIL_KEYS);
  });

  it('cada relacionado trae las 20 claves del listado y ningún related_products propio', async () => {
    findProductBySlugMock.mockResolvedValue(
      makeProductDetail({
        relatedProducts: [makeProductRecord({ id: 2, slug: 'oranges' })],
      }),
    );

    const result = await service.getProductBySlug('apples');
    const related = (result as unknown as { related_products: unknown[] })
      .related_products;

    expect(related).toHaveLength(1);
    expect(Object.keys(related[0] as object)).toEqual(EXPECTED_KEYS);
    expect('related_products' in (related[0] as object)).toBe(false);
  });

  it('pasa el slug crudo al repositorio', async () => {
    findProductBySlugMock.mockResolvedValue(makeProductDetail());

    await service.getProductBySlug('apples');

    expect(findProductBySlugMock).toHaveBeenCalledWith('apples');
    expect(findProductBySlugMock).toHaveBeenCalledTimes(1);
  });

  it('relatedProducts: [] → related_products: [] y sigue con las 21 claves', async () => {
    findProductBySlugMock.mockResolvedValue(
      makeProductDetail({ relatedProducts: [] }),
    );

    const result = await service.getProductBySlug('apples');

    expect(Object.keys(result)).toEqual(EXPECTED_DETAIL_KEYS);
    expect(
      (result as unknown as { related_products: unknown[] }).related_products,
    ).toEqual([]);
  });

  it('slug inexistente (null) → NotFoundException 404 con el slug en el mensaje, no envuelto por el catch (D-5)', async () => {
    findProductBySlugMock.mockResolvedValue(null);

    expect.assertions(4);
    try {
      await service.getProductBySlug('no-existe-xyz');
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      const http = error as NotFoundException;
      expect(http.getStatus()).toBe(404);
      expect(http.message).toContain('no-existe-xyz');
      expect(error).not.toBeInstanceOf(InternalServerErrorException);
    }
  });

  it('error de conexión de Prisma → 503 con mensaje amigable', async () => {
    // Error con la forma real de PrismaClientInitializationError; lo
    // clasifica el isPrismaConnectionError REAL (sin mockear).
    const connectionError = new Error(
      "Can't reach database server at `localhost:5433`",
    );
    connectionError.name = 'PrismaClientInitializationError';
    findProductBySlugMock.mockRejectedValue(connectionError);

    expect.assertions(3);
    try {
      await service.getProductBySlug('apples');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      const http = error as ServiceUnavailableException;
      expect(http.getStatus()).toBe(503);
      expect(http.message).toBe(
        'No se puede conectar con el servicio. Por favor, intenta más tarde.',
      );
    }
  });

  it('cualquier otro error → 500 con mensaje amigable, sin crashear el proceso', async () => {
    findProductBySlugMock.mockRejectedValue(new Error('boom inesperado'));

    expect.assertions(3);
    try {
      await service.getProductBySlug('apples');
    } catch (error) {
      expect(error).toBeInstanceOf(InternalServerErrorException);
      const http = error as InternalServerErrorException;
      expect(http.getStatus()).toBe(500);
      expect(http.message).toBe(
        'Ocurrió un error inesperado. Por favor, contacta al administrador.',
      );
    }
  });
});

/**
 * Mapeo de errores de base en los 4 endpoints derivados migrados en US-5.
 *
 * Cierra el MUST "Errores de conexión a Postgres" de la spec
 * `derived-catalog-api`, que hasta ahora solo tenía cobertura efímera: los
 * cuatro métodos replican el mismo `try/catch` a mano, así que sin esto una
 * regresión del mapeo 503/500 en cualquiera de ellos pasaba inadvertida.
 * Mismo arnés que los tests de `getProducts`: `listProducts` mockeado y
 * `isPrismaConnectionError` REAL.
 */
describe('endpoints derivados — mapeo de errores de base (US-5)', () => {
  let service: ProductsService;

  beforeEach(() => {
    listProductsMock.mockReset();
    service = new ProductsService();
  });

  const connectionError = () => {
    const error = new Error("Can't reach database server at `localhost:5433`");
    error.name = 'PrismaClientInitializationError';
    return error;
  };

  // Cada entrada invoca el método por su superficie pública real; los DTO
  // llegan como strings crudos porque `ValidationPipe` corre sin `transform`.
  const casos: ReadonlyArray<[string, (s: ProductsService) => Promise<unknown>]> =
    [
      [
        'getPopularProducts',
        (s) => s.getPopularProducts({ limit: '10' } as never),
      ],
      [
        'getBestSellingProducts',
        (s) => s.getBestSellingProducts({ limit: '5' } as never),
      ],
      [
        'getProductsStock',
        (s) => s.getProductsStock(rawQuery({ limit: '30', page: '1' })),
      ],
      [
        'getDraftProducts',
        (s) => s.getDraftProducts(rawQuery({ limit: '30', page: '1' })),
      ],
    ];

  it.each(casos)('%s: error de conexión → 503', async (_nombre, invocar) => {
    listProductsMock.mockRejectedValue(connectionError());

    expect.assertions(3);
    try {
      await invocar(service);
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getStatus()).toBe(503);
      expect((error as ServiceUnavailableException).message).toBe(
        'No se puede conectar con el servicio. Por favor, intenta más tarde.',
      );
    }
  });

  it.each(casos)(
    '%s: cualquier otro error → 500, sin crashear el proceso',
    async (_nombre, invocar) => {
      listProductsMock.mockRejectedValue(new Error('boom inesperado'));

      expect.assertions(3);
      try {
        await invocar(service);
      } catch (error) {
        expect(error).toBeInstanceOf(InternalServerErrorException);
        expect((error as InternalServerErrorException).getStatus()).toBe(500);
        expect((error as InternalServerErrorException).message).toBe(
          'Ocurrió un error inesperado. Por favor, contacta al administrador.',
        );
      }
    },
  );
});
