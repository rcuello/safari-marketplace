/**
 * Test de integración contra el Postgres real (sembrado por `just db-up`). US-61.
 *
 * El reloj se fija con `_setNowProvider` y se restaura en `afterEach`: ningún
 * caso depende de la fecha real. Las cifras de CA-2 salen de las 20 órdenes
 * padre del seed (`orders.json`), recalculadas con `psql` el 2026-10-23.
 *
 * Escrituras: usuarios (CA-3) y una categoría con 2 productos (CA-4) con el
 * centinela `zz-analytics-`, borrados en `afterAll`.
 */

import 'dotenv/config';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../client';
import { _setNowProvider, now } from '../clock';
import {
  getDashboardAnalytics,
  listCategoryWiseProductCounts,
  listLowStockProducts,
  listTopRatedProducts,
} from './analytics.repository';

const SENTINEL = 'zz-analytics-';
const DAY_MS = 24 * 60 * 60 * 1000;

function fixClock(iso: string): void {
  const fixed = new Date(iso);
  _setNowProvider(() => fixed);
}

afterEach(() => {
  _setNowProvider(() => new Date());
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: SENTINEL } } });
  await prisma.product.deleteMany({ where: { slug: { startsWith: SENTINEL } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: SENTINEL } } });
  await prisma.$disconnect();
});

describe('getDashboardAnalytics — CA-2 con reloj fijo', () => {
  it('2023-10-25T20:00:00Z: ingresos, conteos por ventana y ventas por mes del seed', async () => {
    fixClock('2023-10-25T20:00:00Z');
    const a = await getDashboardAnalytics(now());

    expect(a.totalOrders).toBe(16);
    expect(a.totalRevenue).toBe(3473.22);
    expect(a.todaysRevenue).toBe(2305.32);
    expect(a.totalShops).toBe(12);
    expect(a.totalVendors).toBe(1);

    const nonZero = (counts: Record<string, number>) =>
      Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));
    expect(nonZero(a.ordersByStatus.today)).toEqual({ 'order-completed': 6 });
    expect(nonZero(a.ordersByStatus.weekly)).toEqual({ 'order-completed': 6 });
    expect(nonZero(a.ordersByStatus.monthly)).toEqual({
      'order-pending': 1,
      'order-processing': 3,
      'order-completed': 7,
    });
    expect(nonZero(a.ordersByStatus.yearly)).toEqual({
      'order-pending': 1,
      'order-processing': 3,
      'order-completed': 12,
    });

    const sales = Array.from({ length: 12 }, () => 0);
    sales[3] = 984.3;
    sales[9] = 2488.92;
    expect(a.salesByMonth).toEqual(sales);
  });

  it('2026-10-20T12:00:00Z: año sin órdenes ⇒ ventanas vacías y 12 meses en 0', async () => {
    fixClock('2026-10-20T12:00:00Z');
    const a = await getDashboardAnalytics(now());

    expect(a.totalOrders).toBe(20);
    expect(a.todaysRevenue).toBe(0);
    for (const window of Object.values(a.ordersByStatus)) {
      expect(Object.values(window).every((n) => n === 0)).toBe(true);
    }
    expect(a.salesByMonth).toEqual(Array.from({ length: 12 }, () => 0));
  });
});

describe('getDashboardAnalytics — CA-3 newCustomers con centinelas', () => {
  // Lejos del `created_at` del seed (el `now()` del `db-reset`), que así no cuenta.
  const AT = '2031-01-15T12:00:00Z';

  beforeAll(async () => {
    const at = new Date(AT).getTime();
    const permissions = await prisma.permission.findMany();
    const idOf = (name: string) => {
      const permission = permissions.find((p) => p.name === name);
      if (!permission) throw new Error(`falta el permiso ${name}`);
      return permission.id;
    };
    const users: { tag: string; daysAgo: number; roles: string[] }[] = [
      { tag: 'dentro-1', daysAgo: 1, roles: ['customer'] },
      { tag: 'dentro-29', daysAgo: 29, roles: ['customer'] },
      { tag: 'fuera-31', daysAgo: 31, roles: ['customer'] },
      { tag: 'futuro', daysAgo: -1, roles: ['customer'] },
      { tag: 'dueno', daysAgo: 2, roles: ['customer', 'store_owner'] },
      { tag: 'admin', daysAgo: 2, roles: ['customer', 'super_admin'] },
    ];
    for (const u of users) {
      await prisma.user.create({
        data: {
          name: `${SENTINEL}${u.tag}`,
          email: `${SENTINEL}${u.tag}@demo.com`,
          passwordHash: 'x',
          createdAt: new Date(at - u.daysAgo * DAY_MS),
          permissions: { create: u.roles.map((name) => ({ permissionId: idOf(name) })) },
        },
      });
    }
  });

  it('solo cuentan los clientes puros creados en (now - 30d, now]', async () => {
    fixClock(AT);
    expect((await getDashboardAnalytics(now())).newCustomers).toBe(2);
  });
});

describe('listas — CA-4 sobre el seed', () => {
  it('low-stock: quantity < 10 en id ASC, con limit y filtro por tienda', async () => {
    expect((await listLowStockProducts()).map((p) => p.id)).toEqual([
      2, 190, 1014, 1015, 1017, 1018, 1021, 1022, 1023, 1024,
    ]);
    expect((await listLowStockProducts({ limit: 3 })).map((p) => p.id)).toEqual([2, 190, 1014]);
    const shop9 = await listLowStockProducts({ shopId: 9, limit: 50 });
    expect(shop9.map((p) => p.id)).toEqual([1014, 1015, 1017, 1018, 1021, 1022, 1023, 1024, 1028]);
    expect(shop9.every((p) => p.quantity < 10 && p.shop.id === 9)).toBe(true);
  });

  it('top-rated: orden por media, número e id; agregados iguales a los de reviews', async () => {
    const top = await listTopRatedProducts();
    expect(top.map((t) => t.product.id)).toEqual([4, 7, 8, 12, 16, 17, 19, 20, 21, 24]);

    const groups = await prisma.review.groupBy({
      by: ['productId'],
      where: { productId: { in: top.map((t) => BigInt(t.product.id)) } },
      _sum: { rating: true },
      _count: { _all: true },
      _avg: { rating: true },
    });
    for (const t of top) {
      const g = groups.find((row) => Number(row.productId) === t.product.id);
      expect(t.totalRating).toBe(g?._sum.rating);
      expect(t.ratingCount).toBe(g?._count._all);
      expect(t.actualRating).toBe(Math.round((g?._avg.rating ?? 0) * 100) / 100);
    }

    expect((await listTopRatedProducts({ limit: 3 })).map((t) => t.product.id)).toEqual([4, 7, 8]);
    const shopId = top[0].product.shopId;
    const byShop = await listTopRatedProducts({ shopId, limit: 50 });
    expect(byShop.length).toBeGreaterThan(0);
    expect(byShop.every((t) => t.product.shopId === shopId)).toBe(true);
  });

  it('category-wise: [] con el seed; una categoría centinela con 2 productos da product_count 2', async () => {
    expect(await prisma.categoryProduct.count()).toBe(0);
    expect(await listCategoryWiseProductCounts()).toEqual([]);

    const base = await prisma.product.findFirstOrThrow({ where: { id: 4 }, include: { shop: true } });
    const category = await prisma.category.create({
      data: { name: `${SENTINEL}cat`, slug: `${SENTINEL}cat`, typeId: base.typeId },
    });
    for (const n of [1, 2]) {
      await prisma.product.create({
        data: {
          name: `${SENTINEL}p${n}`,
          slug: `${SENTINEL}p${n}`,
          description: '',
          typeId: base.typeId,
          shopId: base.shopId,
          productType: 'simple',
          price: 10,
          quantity: 100,
          unit: '1 Pcs',
          categories: { create: { categoryId: category.id } },
        },
      });
    }

    expect(await listCategoryWiseProductCounts()).toEqual([
      {
        categoryId: Number(category.id),
        categoryName: `${SENTINEL}cat`,
        shopName: base.shop.name,
        productCount: 2,
      },
    ]);
    expect(await listCategoryWiseProductCounts({ limit: 0 })).toEqual([]);
  });
});
