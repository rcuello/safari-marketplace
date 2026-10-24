/**
 * analytics.repository.ts — el dashboard del super admin, calculado (US-61).
 *
 * Solo lectura: no hay tabla de analytics, todo sale de `orders`, `shops`,
 * `users`, `products`, `reviews` y `category_product`. Las definiciones
 * M-1..M-12 son el contrato (`docs/product/46-api-sin-mocks-json/
 * 61-analytics-calculado.md`); aquí no se ajustan para acercarse al mock.
 *
 * Todo en UTC y con «ahora» = `now()` de `clock.ts` (el que el servicio
 * pasa), para que los tests fijen el reloj. Solo cuentan órdenes padre
 * (`parent_id IS NULL`): las hijas repiten el importe por tienda (US-58).
 *
 * `$queryRaw` y no `groupBy`/`aggregate` de Prisma: las ventanas de tiempo
 * de M-8 son `count(*) FILTER (WHERE ...)` sobre una sola pasada, y M-9
 * agrupa por mes UTC; ninguna de las dos se expresa con `groupBy`. Las
 * fronteras de cada ventana se calculan en JS y viajan como parámetros
 * (`${...}` del tagged template, nunca concatenación). Los importes salen
 * como texto del `numeric` y se convierten con `Number`: `3538.01`, no
 * `"3538.010"`. Los productos (low-stock y top-rated) sí van por Prisma con
 * `PRODUCT_INCLUDE`, para devolver el mismo `ProductRecord` que el catálogo.
 */

import { prisma } from '../client';
import { _id } from '../records';
import {
  _toProductRecord,
  PRODUCT_INCLUDE,
  type ProductRecord,
} from './products.repository';

const DAY_MS = 24 * 60 * 60 * 1000;
const COMPLETED = 'order-completed';

/** Conteo de órdenes padre por `order_status` (clave = el valor de la columna). */
export type OrderStatusCounts = Record<string, number>;

export interface DashboardAnalyticsRecord {
  /** M-1: Σ `total` de padres completadas hasta `now`. */
  totalRevenue: number;
  /** M-5: M-1 en el día calendario UTC de `now`. */
  todaysRevenue: number;
  /** M-3 */
  totalShops: number;
  /** M-4: dueños distintos. */
  totalVendors: number;
  /** M-6: padres hasta `now`. */
  totalOrders: number;
  /** M-7: clientes puros creados en `(now - 30d, now]`. */
  newCustomers: number;
  /** M-8: solo trae los estados con órdenes; el servicio rellena las 8 claves. */
  ordersByStatus: {
    today: OrderStatusCounts;
    weekly: OrderStatusCounts;
    monthly: OrderStatusCounts;
    yearly: OrderStatusCounts;
  };
  /** M-9: 12 importes, enero en `[0]`, del año UTC de `now`. */
  salesByMonth: number[];
}

/** Una fila de M-10. */
export interface CategoryProductCountRecord {
  categoryId: number;
  categoryName: string;
  shopName: string;
  productCount: number;
}

/** Una fila de M-12: el producto y sus agregados de `reviews`. */
export interface TopRatedProductRecord {
  product: ProductRecord;
  totalRating: number;
  ratingCount: number;
  /** `round(avg(rating), 2)` */
  actualRating: number;
}

export interface AnalyticsListInput {
  /** Default 10. */
  limit?: number;
  /** Filtra por la tienda del producto (M-11, M-12). */
  shopId?: number;
}

interface OrderStatusRow {
  order_status: string;
  total: number;
  today: number;
  weekly: number;
  monthly: number;
  yearly: number;
  revenue: string | null;
  todays_revenue: string | null;
}

const money = (value: string | null | undefined): number =>
  value == null ? 0 : Number(value);

/** M-1..M-9 sobre el instante `at`. */
export async function getDashboardAnalytics(
  at: Date
): Promise<DashboardAnalyticsRecord> {
  const y = at.getUTCFullYear();
  const nowTs = at.toISOString();
  const dayStart = new Date(
    Date.UTC(y, at.getUTCMonth(), at.getUTCDate())
  ).toISOString();
  const monthStart = new Date(Date.UTC(y, at.getUTCMonth(), 1)).toISOString();
  const yearStart = new Date(Date.UTC(y, 0, 1)).toISOString();
  const weekStart = new Date(at.getTime() - 7 * DAY_MS).toISOString();
  const customerStart = new Date(at.getTime() - 30 * DAY_MS).toISOString();

  const [statusRows, monthRows, shopRows, customerRows] = await Promise.all([
    prisma.$queryRaw<OrderStatusRow[]>`
      SELECT order_status,
             count(*)::int                                                       AS total,
             (count(*) FILTER (WHERE created_at >= ${dayStart}::timestamptz))::int   AS today,
             (count(*) FILTER (WHERE created_at >  ${weekStart}::timestamptz))::int  AS weekly,
             (count(*) FILTER (WHERE created_at >= ${monthStart}::timestamptz))::int AS monthly,
             (count(*) FILTER (WHERE created_at >= ${yearStart}::timestamptz))::int  AS yearly,
             sum(total)::text                                                    AS revenue,
             (sum(total) FILTER (WHERE created_at >= ${dayStart}::timestamptz))::text AS todays_revenue
        FROM orders
       WHERE parent_id IS NULL
         AND created_at <= ${nowTs}::timestamptz
       GROUP BY order_status
    `,
    prisma.$queryRaw<{ month: number; total: string }[]>`
      SELECT extract(month FROM created_at AT TIME ZONE 'UTC')::int AS month,
             sum(total)::text                                       AS total
        FROM orders
       WHERE parent_id IS NULL
         AND order_status = ${COMPLETED}
         AND created_at >= ${yearStart}::timestamptz
         AND created_at <= ${nowTs}::timestamptz
       GROUP BY 1
    `,
    prisma.$queryRaw<{ shops: number; vendors: number }[]>`
      SELECT count(*)::int AS shops, count(DISTINCT owner_id)::int AS vendors FROM shops
    `,
    prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count
        FROM users u
       WHERE u.created_at >  ${customerStart}::timestamptz
         AND u.created_at <= ${nowTs}::timestamptz
         AND EXISTS (SELECT 1 FROM permission_user pu JOIN permissions p ON p.id = pu.permission_id
                      WHERE pu.user_id = u.id AND p.name = 'customer')
         AND NOT EXISTS (SELECT 1 FROM permission_user pu JOIN permissions p ON p.id = pu.permission_id
                          WHERE pu.user_id = u.id AND p.name IN ('super_admin', 'store_owner'))
    `,
  ]);

  const ordersByStatus: DashboardAnalyticsRecord['ordersByStatus'] = {
    today: {},
    weekly: {},
    monthly: {},
    yearly: {},
  };
  for (const row of statusRows) {
    ordersByStatus.today[row.order_status] = row.today;
    ordersByStatus.weekly[row.order_status] = row.weekly;
    ordersByStatus.monthly[row.order_status] = row.monthly;
    ordersByStatus.yearly[row.order_status] = row.yearly;
  }
  const completed = statusRows.find((row) => row.order_status === COMPLETED);
  const salesByMonth = Array.from({ length: 12 }, () => 0);
  for (const row of monthRows) salesByMonth[row.month - 1] = money(row.total);

  return {
    totalRevenue: money(completed?.revenue),
    todaysRevenue: money(completed?.todays_revenue),
    totalShops: shopRows[0].shops,
    totalVendors: shopRows[0].vendors,
    totalOrders: statusRows.reduce((sum, row) => sum + row.total, 0),
    newCustomers: customerRows[0].count,
    ordersByStatus,
    salesByMonth,
  };
}

/** M-10: productos por (categoría, tienda), los más poblados primero. */
export async function listCategoryWiseProductCounts(
  input: AnalyticsListInput = {}
): Promise<CategoryProductCountRecord[]> {
  const limit = input.limit ?? 10;
  // `s.id` desempata la misma categoría en dos tiendas con el mismo conteo.
  const rows = await prisma.$queryRaw<
    {
      category_id: bigint;
      category_name: string;
      shop_name: string;
      product_count: number;
    }[]
  >`
    SELECT c.id AS category_id, c.name AS category_name, s.name AS shop_name,
           count(*)::int AS product_count
      FROM category_product cp
      JOIN products p   ON p.id = cp.product_id
      JOIN categories c ON c.id = cp.category_id
      JOIN shops s      ON s.id = p.shop_id
     GROUP BY c.id, c.name, s.id, s.name
     ORDER BY product_count DESC, c.id ASC, s.id ASC
     LIMIT ${limit}
  `;
  return rows.map((row) => ({
    categoryId: _id(row.category_id),
    categoryName: row.category_name,
    shopName: row.shop_name,
    productCount: row.product_count,
  }));
}

/** M-11: `quantity < 10` en `id ASC`. */
export async function listLowStockProducts(
  input: AnalyticsListInput = {}
): Promise<ProductRecord[]> {
  const rows = await prisma.product.findMany({
    where: {
      quantity: { lt: 10 },
      ...(input.shopId !== undefined && { shopId: input.shopId }),
    },
    orderBy: { id: 'asc' },
    take: input.limit ?? 10,
    include: PRODUCT_INCLUDE,
  });
  return rows
    .map(_toProductRecord)
    .filter((p): p is ProductRecord => p !== null);
}

/** M-12: productos con reviews, por media, número de reviews e id. */
export async function listTopRatedProducts(
  input: AnalyticsListInput = {}
): Promise<TopRatedProductRecord[]> {
  const limit = input.limit ?? 10;
  const shopId = input.shopId ?? null;
  const rows = await prisma.$queryRaw<
    {
      product_id: bigint;
      total_rating: number;
      rating_count: number;
      actual_rating: string;
    }[]
  >`
    SELECT r.product_id,
           sum(r.rating)::int                AS total_rating,
           count(*)::int                     AS rating_count,
           round(avg(r.rating), 2)::text     AS actual_rating
      FROM reviews r
      JOIN products p ON p.id = r.product_id
     WHERE ${shopId}::bigint IS NULL OR p.shop_id = ${shopId}::bigint
     GROUP BY r.product_id
     ORDER BY round(avg(r.rating), 2) DESC, count(*) DESC, r.product_id ASC
     LIMIT ${limit}
  `;
  if (rows.length === 0) return [];

  const products = await prisma.product.findMany({
    where: { id: { in: rows.map((row) => row.product_id) } },
    include: PRODUCT_INCLUDE,
  });
  const byId = new Map<number, ProductRecord>();
  for (const row of products) {
    const record = _toProductRecord(row);
    if (record) byId.set(record.id, record);
  }
  // Un producto borrado entre las dos consultas se descarta (como en `_toProductRecord`).
  return rows.flatMap((row) => {
    const product = byId.get(_id(row.product_id));
    return product
      ? [
          {
            product,
            totalRating: row.total_rating,
            ratingCount: row.rating_count,
            actualRating: Number(row.actual_rating),
          },
        ]
      : [];
  });
}
