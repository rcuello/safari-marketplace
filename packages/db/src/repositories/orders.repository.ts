/**
 * orders.repository.ts — órdenes: lectura (US-58) y escritura (US-59).
 *
 * Padres e hijas viven en la misma tabla: el padre agrupa la compra y no
 * tiene tienda; cada hija es la parte de una tienda (`orders_padre_o_hija`).
 * Una lectura devuelve `OrderDetailRecord`: la orden con sus líneas, su
 * tienda (solo las hijas) y sus hijas, cada una con lo mismo.
 *
 * El aislamiento por cliente y el cálculo del checkout (precios, impuesto,
 * envío, cupón) los decide la API: aquí `customerId` es un filtro más y las
 * escrituras reciben las cifras ya calculadas. Lo que sí vive aquí es la
 * integridad: la orden, sus hijas, sus líneas y el descuento de stock van en
 * una sola transacción.
 */

import type { Prisma } from '../../generated/prisma/client/client';
import { prisma } from '../client';
import { now } from '../clock';
import {
  CATALOG_ERROR_CODES,
  CatalogWriteError,
  InvalidFieldValueError,
  RecordNotFoundError,
  translateCatalogWriteError,
} from '../domain-errors';
import {
  _toOrderProductRecord,
  _toOrderRecord,
  _toShopRecord,
  type OrderProductRecord,
  type OrderRecord,
  type ShopRecord,
} from '../records';
import {
  _toProductRecord,
  PRODUCT_INCLUDE,
  type ProductRecord,
} from './products.repository';
import { COUNT_PRODUCTS } from './shops.repository';

/** Orden con sus líneas (por `lineNo`), su tienda y sus hijas (por `id`). */
export interface OrderDetailRecord extends OrderRecord {
  lines: OrderProductRecord[];
  /** Con el `productsCount` de `toShopDto`. `null` en los padres. */
  shop: ShopRecord | null;
  /** Vacío en las hijas. */
  children: OrderDetailRecord[];
}

const LINES = {
  orderBy: { lineNo: 'asc' as const },
} satisfies Prisma.Order$linesArgs;
const SHOP = { include: COUNT_PRODUCTS } satisfies Prisma.ShopDefaultArgs;

const ORDER_INCLUDE = {
  lines: LINES,
  shop: SHOP,
  children: {
    orderBy: { id: 'asc' as const },
    include: { lines: LINES, shop: SHOP },
  },
} satisfies Prisma.OrderInclude;

type OrderWithDetail = Prisma.OrderGetPayload<{
  include: typeof ORDER_INCLUDE;
}>;
type OrderNode = Prisma.OrderGetPayload<{
  include: { lines: typeof LINES; shop: typeof SHOP };
}>;

function _toNode(
  row: OrderNode,
  children: OrderDetailRecord[]
): OrderDetailRecord {
  return {
    ..._toOrderRecord(row),
    lines: row.lines.map(_toOrderProductRecord),
    shop: row.shop
      ? { ..._toShopRecord(row.shop), productsCount: row.shop._count.products }
      : null,
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
    ...(input.shopId === undefined &&
      input.trackingNumber === undefined && { parentId: null }),
    ...(input.shopId !== undefined && { shopId: input.shopId }),
    ...(input.trackingNumber !== undefined && {
      trackingNumber: input.trackingNumber,
    }),
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
    typeof idOrTracking === 'number'
      ? { id: idOrTracking }
      : { trackingNumber: idOrTracking };
  const row = await prisma.order.findUnique({ where, include: ORDER_INCLUDE });
  return row ? _toDetail(row) : null;
}

// ---------------------------------------------------------------------------
// Escritura (US-59)
// ---------------------------------------------------------------------------

/** Enums de la API (`orders/entities/order.entity.ts`); son los CHECK de `orders`. */
export const ORDER_STATUSES = [
  'order-pending',
  'order-processing',
  'order-completed',
  'order-cancelled',
  'order-refunded',
  'order-failed',
  'order-at-local-facility',
  'order-out-for-delivery',
] as const;
export const PAYMENT_STATUSES = [
  'payment-pending',
  'payment-processing',
  'payment-success',
  'payment-failed',
  'payment-reversal',
  'payment-cash-on-delivery',
  'payment-cash',
  'payment-wallet',
  'payment-awaiting-for-approval',
] as const;

/**
 * El stock de un producto no alcanzó al descontar: otra compra se adelantó
 * entre la verificación y la escritura. Reutiliza el código del 409.
 */
export class InsufficientStockError extends CatalogWriteError {
  readonly code = CATALOG_ERROR_CODES.SlugConflict;
  readonly productId: number;
  constructor(productId: number) {
    super(`El producto ${productId} ya no tiene stock suficiente.`, 'orders');
    this.name = 'InsufficientStockError';
    this.productId = productId;
  }
}

/** Productos vivos de un carrito, por id. Los inexistentes no vienen. */
export async function findProductsForOrder(
  ids: number[]
): Promise<ProductRecord[]> {
  const rows = await prisma.product.findMany({
    where: { id: { in: ids } },
    include: PRODUCT_INCLUDE,
  });
  return rows
    .map(_toProductRecord)
    .filter((r): r is ProductRecord => r !== null);
}

/** Dinero en texto decimal (`"0.044"`): llega exacto a `numeric`, sin pasar por float. */
type Money = string;

export interface OrderLineInput {
  productId: number;
  variationOptionId: number | null;
  orderQuantity: number;
  unitPrice: Money;
  subtotal: Money;
  /** El producto en el momento de la compra (forma del mock, sin `pivot`). */
  productSnapshot: Prisma.InputJsonValue;
}

export interface CreateOrderChildInput {
  shopId: number;
  amount: Money;
  lines: OrderLineInput[];
}

export interface CreateOrderInput {
  customerId: number | null;
  customerSnapshot: Prisma.InputJsonValue | null;
  customerContact: string | null;
  customerName: string | null;
  amount: Money;
  salesTax: Money;
  deliveryFee: Money;
  discount: Money;
  total: Money;
  note: string | null;
  deliveryTime: string | null;
  language?: string;
  couponId: number | null;
  paymentGateway: string;
  orderStatus: string;
  paymentStatus: string;
  shippingAddress: Prisma.InputJsonValue | null;
  billingAddress: Prisma.InputJsonValue | null;
  /** Las líneas del padre; cada hija repite las suyas, como el mock. */
  lines: OrderLineInput[];
  children: CreateOrderChildInput[];
}

const TRACKING_ATTEMPTS = 5;

/** `YYYYMMDD` (UTC) + 6 dígitos aleatorios, distintos dentro del lote. */
function _trackingCandidates(count: number, at: Date): string[] {
  const day = at.toISOString().slice(0, 10).replace(/-/g, '');
  const out = new Set<string>();
  while (out.size < count) {
    out.add(
      day + String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')
    );
  }
  return [...out];
}

/** Números de seguimiento libres para el padre y sus hijas; tras 5 choques, error (500). */
async function _freeTrackingNumbers(
  tx: Prisma.TransactionClient,
  count: number,
  at: Date
): Promise<string[]> {
  for (let attempt = 0; attempt < TRACKING_ATTEMPTS; attempt++) {
    const candidates = _trackingCandidates(count, at);
    const taken = await tx.order.count({
      where: { trackingNumber: { in: candidates } },
    });
    if (taken === 0) return candidates;
  }
  throw new Error(
    `No se encontró un tracking_number libre tras ${TRACKING_ATTEMPTS} intentos.`
  );
}

function _lineData(line: OrderLineInput, lineNo: number, at: Date) {
  return {
    lineNo,
    productId: line.productId,
    variationOptionId: line.variationOptionId,
    orderQuantity: line.orderQuantity,
    unitPrice: line.unitPrice,
    subtotal: line.subtotal,
    productSnapshot: line.productSnapshot,
    createdAt: at,
    updatedAt: at,
  };
}

/**
 * Crea el padre, una hija por tienda y sus líneas, y descuenta el stock, en
 * una transacción. Cada producto baja `quantity` y sube `sold_quantity` con
 * un `UPDATE … WHERE quantity >= n`: si otra compra se adelantó y no queda
 * stock, `InsufficientStockError` y rollback. Las hijas llevan los mismos
 * datos de cliente, direcciones, estados y pasarela que el padre, con
 * impuesto, envío y descuento en 0 y `total = amount`.
 */
export async function createOrderWithChildren(
  input: CreateOrderInput
): Promise<OrderDetailRecord> {
  const at = now();
  const shared = {
    customerId: input.customerId,
    customerSnapshot: input.customerSnapshot ?? undefined,
    customerContact: input.customerContact,
    customerName: input.customerName,
    note: input.note,
    deliveryTime: input.deliveryTime,
    ...(input.language !== undefined && { language: input.language }),
    paymentGateway: input.paymentGateway,
    orderStatus: input.orderStatus,
    paymentStatus: input.paymentStatus,
    shippingAddress: input.shippingAddress ?? undefined,
    billingAddress: input.billingAddress ?? undefined,
    createdAt: at,
    updatedAt: at,
  };

  const stock = new Map<number, number>();
  for (const line of input.lines) {
    stock.set(
      line.productId,
      (stock.get(line.productId) ?? 0) + line.orderQuantity
    );
  }

  let parentId: bigint;
  try {
    parentId = await prisma.$transaction(async (tx) => {
      const [parentTracking, ...childTracking] = await _freeTrackingNumbers(
        tx,
        input.children.length + 1,
        at
      );
      const parent = await tx.order.create({
        data: {
          ...shared,
          trackingNumber: parentTracking,
          amount: input.amount,
          salesTax: input.salesTax,
          deliveryFee: input.deliveryFee,
          discount: input.discount,
          total: input.total,
          paidTotal: input.total,
          couponId: input.couponId,
          lines: { create: input.lines.map((l, i) => _lineData(l, i + 1, at)) },
        },
        select: { id: true },
      });
      for (const [i, child] of input.children.entries()) {
        await tx.order.create({
          data: {
            ...shared,
            trackingNumber: childTracking[i],
            parentId: parent.id,
            shopId: child.shopId,
            amount: child.amount,
            total: child.amount,
            paidTotal: child.amount,
            lines: {
              create: child.lines.map((l, j) => _lineData(l, j + 1, at)),
            },
          },
        });
      }
      for (const [productId, quantity] of stock) {
        const { count } = await tx.product.updateMany({
          where: { id: productId, quantity: { gte: quantity } },
          data: {
            quantity: { decrement: quantity },
            soldQuantity: { increment: quantity },
            updatedAt: at,
          },
        });
        if (count === 0) throw new InsufficientStockError(productId);
      }
      return parent.id;
    });
  } catch (error) {
    throw translateCatalogWriteError(error, { aggregate: 'orders' });
  }
  return _toDetail(
    await prisma.order.findUniqueOrThrow({
      where: { id: parentId },
      include: ORDER_INCLUDE,
    })
  );
}

function _assertStatuses(input: {
  orderStatus?: string;
  paymentStatus?: string;
}): void {
  if (
    input.orderStatus !== undefined &&
    !(ORDER_STATUSES as readonly string[]).includes(input.orderStatus)
  ) {
    throw new InvalidFieldValueError(
      'orders',
      'order_status',
      input.orderStatus,
      'orders_order_status_check'
    );
  }
  if (
    input.paymentStatus !== undefined &&
    !(PAYMENT_STATUSES as readonly string[]).includes(input.paymentStatus)
  ) {
    throw new InvalidFieldValueError(
      'orders',
      'payment_status',
      input.paymentStatus,
      'orders_payment_status_check'
    );
  }
}

/**
 * Cambia `order_status` y/o `payment_status`. En un padre, el cambio se
 * propaga a sus hijas (la semántica de `processChildrenOrder`); en una hija,
 * solo a ella. Fija `updatedAt: now()`. Inexistente: `RecordNotFoundError`.
 *
 * No se llama `updateOrderStatus`: en el barrel ese nombre ya es del
 * catálogo de estados (`order-statuses.repository.ts`, US-57).
 */
export async function setOrderStatus(
  id: number,
  input: { orderStatus?: string; paymentStatus?: string }
): Promise<OrderDetailRecord> {
  _assertStatuses(input);
  const data = {
    ...(input.orderStatus !== undefined && { orderStatus: input.orderStatus }),
    ...(input.paymentStatus !== undefined && {
      paymentStatus: input.paymentStatus,
    }),
    updatedAt: now(),
  };
  try {
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.update({
        where: { id },
        data,
        select: { parentId: true },
      });
      if (order.parentId === null) {
        await tx.order.updateMany({ where: { parentId: id }, data });
      }
    });
  } catch (error) {
    throw translateCatalogWriteError(error, { aggregate: 'orders', id });
  }
  return _toDetail(
    await prisma.order.findUniqueOrThrow({
      where: { id },
      include: ORDER_INCLUDE,
    })
  );
}

/**
 * Pago confirmado (`STRIPE`/`PAYPAL`): `order-processing` + `payment-success`
 * en la orden y sus hijas. Inexistente: `RecordNotFoundError`.
 */
export async function markOrderPaid(
  trackingNumber: string
): Promise<OrderDetailRecord> {
  const order = await prisma.order.findUnique({
    where: { trackingNumber },
    select: { id: true },
  });
  if (!order) throw new RecordNotFoundError('orders', trackingNumber);
  return setOrderStatus(Number(order.id), {
    orderStatus: 'order-processing',
    paymentStatus: 'payment-success',
  });
}

/**
 * Borra la orden y devuelve su snapshot previo (precedente `deleteTag`). Las
 * hijas y las líneas caen por CASCADE y `reviews.order_id` pasa a NULL. No
 * repone stock.
 *
 * Si el autor de una reseña de esta orden ya tiene otra reseña del mismo
 * producto sin orden, el SET NULL choca con `reviews_autor_producto_orden_key`
 * (US-58) y el borrado no se hace: `SlugConflictError` (409), sin borrar
 * ninguna reseña.
 */
export async function deleteOrder(id: number): Promise<OrderDetailRecord> {
  const existing = await prisma.order.findUnique({
    where: { id },
    include: ORDER_INCLUDE,
  });
  if (!existing) throw new RecordNotFoundError('orders', id);
  try {
    await prisma.order.delete({ where: { id } });
  } catch (error) {
    throw translateCatalogWriteError(error, {
      aggregate: 'reviews',
      id,
      uniqueField: 'user_id, product_id, order_id',
    });
  }
  return _toDetail(existing);
}
