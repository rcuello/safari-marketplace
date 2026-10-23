/**
 * orders.repository.ts — lectura de órdenes (US-58).
 *
 * Padres e hijas viven en la misma tabla: el padre agrupa la compra y no
 * tiene tienda; cada hija es la parte de una tienda (`orders_padre_o_hija`).
 * Una lectura devuelve `OrderDetailRecord`: la orden con sus líneas, su
 * tienda (solo las hijas) y sus hijas, cada una con lo mismo.
 *
 * Solo lectura. Las escrituras (`POST /orders`, pago, `PUT`, `DELETE`) son de
 * US-59. El aislamiento por cliente lo decide la API: aquí `customerId` es
 * un filtro más.
 */

import type { Prisma } from '../../generated/prisma/client/client';
import { prisma } from '../client';
import {
  _toOrderProductRecord,
  _toOrderRecord,
  _toShopRecord,
  type OrderProductRecord,
  type OrderRecord,
  type ShopRecord,
} from '../records';
import { COUNT_PRODUCTS } from './shops.repository';

/** Orden con sus líneas (por `lineNo`), su tienda y sus hijas (por `id`). */
export interface OrderDetailRecord extends OrderRecord {
  lines: OrderProductRecord[];
  /** Con el `productsCount` de `toShopDto`. `null` en los padres. */
  shop: ShopRecord | null;
  /** Vacío en las hijas. */
  children: OrderDetailRecord[];
}

const LINES = { orderBy: { lineNo: 'asc' as const } } satisfies Prisma.Order$linesArgs;
const SHOP = { include: COUNT_PRODUCTS } satisfies Prisma.ShopDefaultArgs;

const ORDER_INCLUDE = {
  lines: LINES,
  shop: SHOP,
  children: { orderBy: { id: 'asc' as const }, include: { lines: LINES, shop: SHOP } },
} satisfies Prisma.OrderInclude;

type OrderWithDetail = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;
type OrderNode = Prisma.OrderGetPayload<{ include: { lines: typeof LINES; shop: typeof SHOP } }>;

function _toNode(row: OrderNode, children: OrderDetailRecord[]): OrderDetailRecord {
  return {
    ..._toOrderRecord(row),
    lines: row.lines.map(_toOrderProductRecord),
    shop: row.shop ? { ..._toShopRecord(row.shop), productsCount: row.shop._count.products } : null,
    children,
  };
}

function _toDetail(row: OrderWithDetail): OrderDetailRecord {
  return _toNode(
    row,
    row.children.map((child) => _toNode(child, []))
  );
}

export interface ListOrdersInput {
  /** Solo las órdenes de este cliente (aislamiento, lo fija la API). */
  customerId?: number;
  /** Las hijas de esta tienda. */
  shopId?: number;
  /** Coincidencia exacta, sobre padres e hijas. */
  trackingNumber?: string;
  /** 1-based. Default 1. */
  page?: number;
  /** Default 15, como el mock. */
  limit?: number;
}

/**
 * Paginado en `id DESC` (el orden del mock). Sin `shopId` ni
 * `trackingNumber`, solo padres: las hijas viajan dentro de su padre. Con
 * `shopId`, las hijas de esa tienda. Con `trackingNumber`, la orden exacta,
 * sea padre o hija. Los filtros se combinan con AND.
 */
export async function listOrders(
  input: ListOrdersInput = {}
): Promise<{ items: OrderDetailRecord[]; total: number }> {
  const page = Math.max(1, input.page ?? 1);
  const limit = input.limit ?? 15;
  const where: Prisma.OrderWhereInput = {
    ...(input.shopId === undefined && input.trackingNumber === undefined && { parentId: null }),
    ...(input.shopId !== undefined && { shopId: input.shopId }),
    ...(input.trackingNumber !== undefined && { trackingNumber: input.trackingNumber }),
    ...(input.customerId !== undefined && { customerId: input.customerId }),
  };
  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: ORDER_INCLUDE,
      orderBy: { id: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.order.count({ where }),
  ]);
  return { items: rows.map(_toDetail), total };
}

/**
 * Por id (number) o por `tracking_number` (string). `null` si no existe. No
 * mira de quién es: el chequeo de dueño lo hace la API, que responde 404.
 */
export async function findOrderByIdOrTracking(
  idOrTracking: number | string
): Promise<OrderDetailRecord | null> {
  const where: Prisma.OrderWhereUniqueInput =
    typeof idOrTracking === 'number' ? { id: idOrTracking } : { trackingNumber: idOrTracking };
  const row = await prisma.order.findUnique({ where, include: ORDER_INCLUDE });
  return row ? _toDetail(row) : null;
}
