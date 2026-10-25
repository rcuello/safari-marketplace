/// <reference types="vitest/globals" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de Vitest;
 * se limita a este archivo para no tocar la config del build.
 */
/**
 * Tests unitarios de `AnalyticsService` (US-61): la forma de los 4 JSON del
 * mock, el mapeo de estados, el parseo de `limit`/`search` y los errores
 * (503/500). Se mockea solo el acceso a datos de `@safari/db`; los valores
 * con reloj fijo los prueba `analytics.integration.test.ts`.
 */
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  getDashboardAnalytics,
  listCategoryWiseProductCounts,
  listLowStockProducts,
  listTopRatedProducts,
  type DashboardAnalyticsRecord,
  type ProductRecord,
} from '@safari/db';
import { AnalyticsService, STATUS_KEYS } from './analytics.service.js';

vi.mock('@safari/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@safari/db')>()),
  getDashboardAnalytics: vi.fn(),
  listCategoryWiseProductCounts: vi.fn(),
  listLowStockProducts: vi.fn(),
  listTopRatedProducts: vi.fn(),
}));

const dashboardMock = vi.mocked(getDashboardAnalytics);
const categoryMock = vi.mocked(listCategoryWiseProductCounts);
const lowStockMock = vi.mocked(listLowStockProducts);
const topRatedMock = vi.mocked(listTopRatedProducts);

const NOW = new Date('2026-10-23T00:00:00Z');

function mock<T>(file: string): T {
  return JSON.parse(
    readFileSync(join(__dirname, '../db/pickbazar', file), 'utf8'),
  ) as T;
}

function makeProductRecord(
  overrides: Partial<ProductRecord> = {},
): ProductRecord {
  return {
    id: 2,
    name: 'Producto 2',
    slug: 'producto-2',
    description: 'desc',
    typeId: 1,
    shopId: 6,
    manufacturerId: 11,
    productType: 'simple',
    price: 10,
    salePrice: 8,
    minPrice: 10,
    maxPrice: 10,
    quantity: 8,
    inStock: true,
    soldQuantity: 0,
    sku: '123',
    unit: '1 Pcs',
    status: 'publish',
    visibility: 'visibility_public',
    image: { id: 1 },
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
      icon: 'FruitsVegetable',
      settings: {},
      banners: [],
      language: 'en',
      createdAt: NOW,
      updatedAt: NOW,
    },
    shop: {
      id: 6,
      name: 'Shop 6',
      slug: 'shop-6',
      description: null,
      ownerId: 1,
      isActive: true,
      logo: null,
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

const DASHBOARD: DashboardAnalyticsRecord = {
  totalRevenue: 3473.22,
  todaysRevenue: 2305.32,
  totalShops: 12,
  totalVendors: 1,
  totalOrders: 16,
  newCustomers: 3,
  ordersByStatus: {
    today: { 'order-completed': 6 },
    weekly: { 'order-completed': 6 },
    monthly: {
      'order-pending': 1,
      'order-processing': 3,
      'order-completed': 7,
    },
    yearly: {
      'order-at-local-facility': 2,
      'order-out-for-delivery': 1,
      'order-refunded': 4,
    },
  },
  salesByMonth: [0, 0, 0, 984.3, 0, 0, 0, 0, 0, 2488.92, 0, 0],
};

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new AnalyticsService();
  });

  it('analytics: las 12 claves, las 8 de cada estado y los 12 meses en el orden del mock', async () => {
    dashboardMock.mockResolvedValue(DASHBOARD);
    const base = mock<Record<string, unknown>>('analytics.json');
    const result = await service.findAll();

    expect(Object.keys(result)).toEqual(Object.keys(base));
    expect(Object.keys(result.todayTotalOrderByStatus)).toEqual(
      Object.keys(base.todayTotalOrderByStatus as object),
    );
    expect(result.totalYearSaleByMonth.map((m) => m.month)).toEqual(
      (base.totalYearSaleByMonth as { month: string }[]).map((m) => m.month),
    );
    expect(result.totalYearSaleByMonth[9]).toEqual({
      total: 2488.92,
      month: 'October',
    });
    expect(result.totalRefunds).toBe(0);
    expect(result.monthlyTotalOrderByStatus).toEqual({
      pending: 1,
      processing: 3,
      complete: 7,
      cancelled: 0,
      refunded: 0,
      failed: 0,
      localFacility: 0,
      outForDelivery: 0,
    });
    expect(dashboardMock).toHaveBeenCalledWith(expect.any(Date));
  });

  it('mapeo de estados: localFacility, outForDelivery y refunded salen de su order_status', async () => {
    dashboardMock.mockResolvedValue(DASHBOARD);
    const { yearlyTotalOrderByStatus } = await service.findAll();
    expect(yearlyTotalOrderByStatus).toMatchObject({
      localFacility: 2,
      outForDelivery: 1,
      refunded: 4,
      complete: 0,
    });
    expect(Object.values(STATUS_KEYS)).toHaveLength(8);
  });

  it('low-stock: las 45 claves en orden, type con 10 y shop con 13, booleanos 0/1', async () => {
    lowStockMock.mockResolvedValue([makeProductRecord()]);
    const base = mock<Record<string, Record<string, unknown>>[]>(
      'low-stock-products.json',
    )[0];
    const [dto] = (await service.findAllLowStockProducts(
      {},
    )) as unknown as Record<string, Record<string, unknown>>[];

    expect(Object.keys(dto)).toEqual(Object.keys(base));
    expect(Object.keys(dto.type)).toEqual(Object.keys(base.type));
    expect(Object.keys(dto.shop)).toEqual(Object.keys(base.shop));
    expect(dto).toMatchObject({
      in_stock: 1,
      is_taxable: 0,
      manufacturer_id: 11,
      video: [],
      my_review: null,
    });
    expect(dto.type.promotional_sliders).toEqual([]);
    expect(dto.shop.is_active).toBe(1);
  });

  it('top-rated: las 15 claves en orden; regular_price es price y type_slug el del type', async () => {
    topRatedMock.mockResolvedValue([
      {
        product: makeProductRecord({ id: 4 }),
        totalRating: 15,
        ratingCount: 3,
        actualRating: 5,
      },
    ]);
    const base = mock<Record<string, unknown>[]>('top-rate-product.json')[0];
    const [dto] = await service.findAllTopRateProduct({});

    expect(Object.keys(dto)).toEqual(Object.keys(base));
    expect(dto).toMatchObject({
      id: 4,
      regular_price: 10,
      type_slug: 'grocery',
      total_rating: 15,
      rating_count: 3,
      actual_rating: 5,
    });
  });

  it('category-wise: las 4 claves del mock', async () => {
    categoryMock.mockResolvedValue([
      {
        categoryId: 7,
        categoryName: 'Snacks',
        shopName: 'Grocery Shop',
        productCount: 2,
      },
    ]);
    const base = mock<Record<string, unknown>[]>(
      'category-wise-product.json',
    )[0];
    const [dto] = await service.findAllCategoryWiseProduct({});

    expect(Object.keys(dto)).toEqual(Object.keys(base));
    expect(dto).toEqual({
      category_id: 7,
      category_name: 'Snacks',
      shop_name: 'Grocery Shop',
      product_count: 2,
    });
  });

  it('limit y search=shop_id:N; lo inválido cae al default o se ignora', async () => {
    lowStockMock.mockResolvedValue([]);
    topRatedMock.mockResolvedValue([]);
    categoryMock.mockResolvedValue([]);

    await service.findAllLowStockProducts({ limit: '3', search: 'shop_id:9' });
    expect(lowStockMock).toHaveBeenLastCalledWith({ limit: 3, shopId: 9 });
    await service.findAllTopRateProduct({
      limit: 'abc',
      search: 'shop_id:x;name:y',
    });
    expect(topRatedMock).toHaveBeenLastCalledWith({ limit: 10 });
    await service.findAllCategoryWiseProduct({ limit: '0' });
    expect(categoryMock).toHaveBeenLastCalledWith({ limit: 10 });
    await service.findAllLowStockProducts({
      limit: '-2',
      search: 'shop_id:1e21',
    });
    expect(lowStockMock).toHaveBeenLastCalledWith({ limit: 10 });
  });

  it('un fallo de conexión de Prisma ({code:"P1001"}) → 503; otro error → 500', async () => {
    dashboardMock.mockRejectedValue({
      name: 'PrismaClientKnownRequestError',
      code: 'P1001',
      message: "Can't reach database server at `localhost:5433`",
    });
    await expect(service.findAll()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    lowStockMock.mockRejectedValue({
      name: 'PrismaClientValidationError',
      code: 'P2011',
      message: 'Null constraint violation',
    });
    await expect(service.findAllLowStockProducts({})).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    topRatedMock.mockRejectedValue(new Error('boom'));
    await expect(service.findAllTopRateProduct({})).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
