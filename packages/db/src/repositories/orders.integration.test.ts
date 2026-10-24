/**
 * Test de integración contra el Postgres real (sembrado por `just db-up`: 20
 * órdenes padre con 1 hija cada una, ids 5..49, y 76 líneas). US-58 y US-59.
 *
 * Las escrituras son centinelas: órdenes con `note` 'zz-orders-' (hechas con
 * `prisma` directo o con `createOrderWithChildren`), un cupón 'ZZ-ORDERS' y
 * una reseña 'zz-orders-review'. `afterAll` los borra y devuelve el stock de
 * los productos comprados, y su `updated_at`, al valor previo al test.
 */

import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../client';
import { _setNowProvider } from '../clock';
import {
  InvalidFieldValueError,
  RecordNotFoundError,
  SlugConflictError,
} from '../domain-errors';
import {
  type CreateOrderInput,
  createOrderWithChildren,
  deleteOrder,
  findOrderByIdOrTracking,
  findProductsForOrder,
  InsufficientStockError,
  listOrders,
  markOrderPaid,
  type OrderDetailRecord,
  type OrderLineInput,
  setOrderStatus,
} from './orders.repository';

const CUSTOMER = 2;
const ADMIN = 3;
const SENTINEL_NOTE = 'zz-orders-';

/** Las 43 claves del producto previas a `pivot`, más `variation_options` (orden del mock). */
const SNAPSHOT_KEYS = [
  'id',
  'name',
  'slug',
  'description',
  'type_id',
  'price',
  'shop_id',
  'sale_price',
  'language',
  'min_price',
  'max_price',
  'sku',
  'quantity',
  'sold_quantity',
  'in_stock',
  'is_taxable',
  'in_flash_sale',
  'shipping_class_id',
  'status',
  'product_type',
  'unit',
  'height',
  'width',
  'length',
  'image',
  'video',
  'gallery',
  'deleted_at',
  'created_at',
  'updated_at',
  'author_id',
  'manufacturer_id',
  'is_digital',
  'is_external',
  'external_product_url',
  'external_product_button_text',
  'blocked_dates',
  'ratings',
  'total_reviews',
  'rating_count',
  'my_review',
  'in_wishlist',
  'translated_languages',
  'variation_options',
];
const CUSTOMER_KEYS = [
  'id',
  'name',
  'email',
  'email_verified_at',
  'created_at',
  'updated_at',
  'is_active',
  'shop_id',
  'email_verified',
];

/** Productos de tiendas distintas que compran las escrituras (1: tienda 6; 21: tienda 4). */
const BOUGHT = [1, 21];
/** `updated_at` como texto: un `Date` de JS perdería los microsegundos del seed. */
let seededStock: {
  id: bigint;
  quantity: number;
  sold_quantity: number;
  updated_at: string;
}[] = [];

const cleanup = async () => {
  await prisma.review.deleteMany({ where: { comment: 'zz-orders-review' } });
  await prisma.order.deleteMany({ where: { note: SENTINEL_NOTE } });
  await prisma.coupon.deleteMany({ where: { code: 'ZZ-ORDERS' } });
};

beforeAll(async () => {
  await cleanup();
  seededStock = [];
  for (const id of BOUGHT) {
    seededStock.push(
      ...(await prisma.$queryRaw<typeof seededStock>`
        SELECT id, quantity, sold_quantity, updated_at::text AS updated_at FROM products WHERE id = ${id}
      `)
    );
  }
});

afterAll(async () => {
  try {
    await cleanup();
    for (const p of seededStock) {
      await prisma.$executeRaw`
        UPDATE products
           SET quantity = ${p.quantity}, sold_quantity = ${p.sold_quantity},
               updated_at = ${p.updated_at}::timestamptz
         WHERE id = ${p.id}
      `;
    }
  } finally {
    await prisma.$disconnect();
  }
});

describe('lecturas — seed', () => {
  it('sin filtros: solo padres, id DESC, cada uno con su hija embebida', async () => {
    const { items, total } = await listOrders({ limit: 20 });
    expect(total).toBe(20);
    expect(items.map((o) => o.id).slice(0, 3)).toEqual([48, 41, 39]);
    expect(items.every((o) => o.parentId === null && o.shop === null)).toBe(
      true
    );
    expect(
      items.every(
        (o) => o.children.length === 1 && o.children[0].parentId === o.id
      )
    ).toBe(true);
    expect(items[0].children[0]).toMatchObject({
      id: 49,
      shopId: items[0].children[0].shop?.id,
      children: [],
    });
    expect((await listOrders()).items).toHaveLength(15);
  });

  it('los snapshots y las direcciones conservan el orden de claves del mock (json, no jsonb)', async () => {
    const lines = await prisma.orderProduct.findMany();
    expect(lines).toHaveLength(76);
    for (const line of lines) {
      expect(Object.keys(line.productSnapshot as object)).toEqual(
        SNAPSHOT_KEYS
      );
    }
    const order48 = await findOrderByIdOrTracking(48);
    expect(Object.keys(order48?.customerSnapshot as object)).toEqual(
      CUSTOMER_KEYS
    );
    expect(Object.keys(order48?.shippingAddress as object)).toEqual([
      'zip',
      'city',
      'state',
      'country',
      'street_address',
    ]);
    expect(order48?.lines.map((l) => l.lineNo)).toEqual(
      order48?.lines.map((_, i) => i + 1)
    );
    expect((await findOrderByIdOrTracking(23))?.shippingAddress).toEqual([]);
  });

  it('dinero numeric sin escala: los 3 decimales sobreviven; cancelled_* en 0', async () => {
    const order = await prisma.order.findFirstOrThrow({
      where: { salesTax: 0.044 },
    });
    const record = await findOrderByIdOrTracking(Number(order.id));
    expect(record).toMatchObject({
      salesTax: 0.044,
      total: 52.244,
      cancelledAmount: 0,
      discount: 0,
    });
  });

  it('shopId: las hijas de la tienda, con su tienda y su products_count', async () => {
    const { items, total } = await listOrders({ shopId: 7, limit: 20 });
    expect(total).toBe(6);
    expect(
      items.every(
        (o) => o.parentId !== null && o.shopId === 7 && o.shop?.id === 7
      )
    ).toBe(true);
    expect(typeof items[0].shop?.productsCount).toBe('number');
  });

  it('trackingNumber exacto sobre padres e hijas; customerId aísla', async () => {
    expect(
      (await listOrders({ trackingNumber: '20240207303639' })).items.map(
        (o) => o.id
      )
    ).toEqual([48]);
    const child = await prisma.order.findUniqueOrThrow({ where: { id: 49 } });
    expect(
      (await listOrders({ trackingNumber: child.trackingNumber })).items.map(
        (o) => o.id
      )
    ).toEqual([49]);
    const mine = await listOrders({ customerId: CUSTOMER, limit: 50 });
    expect(mine.total).toBe(19);
    expect(mine.items.every((o) => o.customerId === CUSTOMER)).toBe(true);
    expect(
      (await listOrders({ customerId: ADMIN })).items.map((o) => o.id)
    ).toEqual([41]);
  });

  it('por id o por tracking; inexistente ⇒ null', async () => {
    const byTracking = await findOrderByIdOrTracking('20231105635099');
    expect(byTracking).toMatchObject({ id: 41, customerId: ADMIN });
    expect(byTracking?.customerSnapshot).toMatchObject({ id: 6 });
    expect(await findOrderByIdOrTracking(999_999)).toBeNull();
    expect(await findOrderByIdOrTracking('00000000000000')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Escrituras — NO INSERTAR LECTURAS DEL SEED DEBAJO DE ESTA LÍNEA.
// ---------------------------------------------------------------------------

describe('FK — centinelas', () => {
  it('borrar el cupón pone coupon_id a NULL; borrar la orden pone reviews.order_id a NULL', async () => {
    const coupon = await prisma.coupon.create({
      data: {
        code: 'ZZ-ORDERS',
        type: 'fixed',
        amount: 5,
        activeFrom: new Date('2026-01-01T00:00:00Z'),
        expireAt: new Date('2027-01-01T00:00:00Z'),
      },
    });
    const order = await prisma.order.create({
      data: {
        trackingNumber: '99999999999990',
        note: SENTINEL_NOTE,
        couponId: coupon.id,
        customerId: CUSTOMER,
        paymentGateway: 'CASH',
        orderStatus: 'order-pending',
        paymentStatus: 'payment-pending',
        lines: {
          create: {
            lineNo: 1,
            productId: 2,
            orderQuantity: 1,
            unitPrice: 1,
            subtotal: 1,
            productSnapshot: {},
          },
        },
      },
    });
    await prisma.coupon.delete({ where: { id: coupon.id } });
    expect(
      (await findOrderByIdOrTracking(Number(order.id)))?.couponId
    ).toBeNull();

    // Un producto sin reseña del cliente: si tuviera una sin orden, el SET NULL
    // chocaría con reviews_autor_producto_orden_key (user, product, COALESCE(order_id, 0)).
    const product = await prisma.product.findFirstOrThrow({
      where: { reviews: { none: { userId: CUSTOMER } } },
      select: { id: true, shopId: true },
    });
    const review = await prisma.review.create({
      data: {
        orderId: order.id,
        userId: CUSTOMER,
        productId: product.id,
        shopId: product.shopId,
        rating: 4,
        comment: 'zz-orders-review',
      },
    });
    await prisma.order.delete({ where: { id: order.id } });
    expect(
      (await prisma.review.findUniqueOrThrow({ where: { id: review.id } }))
        .orderId
    ).toBeNull();
    expect(
      await prisma.orderProduct.count({ where: { orderId: order.id } })
    ).toBe(0);
  });

  it('una reseña con una orden inexistente viola reviews_order_id_fkey', async () => {
    const product = await prisma.product.findUniqueOrThrow({
      where: { id: 2 },
      select: { shopId: true },
    });
    await expect(
      prisma.review.create({
        data: {
          orderId: 999_999,
          userId: CUSTOMER,
          productId: 2,
          shopId: product.shopId,
          rating: 4,
          comment: 'zz-orders-review',
        },
      })
    ).rejects.toMatchObject({ code: 'P2003' });
  });
});

// ---------------------------------------------------------------------------
// Escrituras del repositorio (US-59)
// ---------------------------------------------------------------------------

function line(
  productId: number,
  orderQuantity: number,
  unitPrice: string
): OrderLineInput {
  return {
    productId,
    variationOptionId: null,
    orderQuantity,
    unitPrice,
    subtotal: String(Number(unitPrice) * orderQuantity),
    productSnapshot: { id: productId, name: 'zz', variation_options: [] },
  };
}

function orderInput(
  lines: OrderLineInput[],
  children: CreateOrderInput['children']
): CreateOrderInput {
  return {
    customerId: CUSTOMER,
    customerSnapshot: { id: CUSTOMER, email: 'customer@demo.com' },
    customerContact: '+19999999999',
    customerName: 'Customer',
    amount: '19.2',
    salesTax: '0.384',
    deliveryFee: '50',
    discount: '0',
    total: '69.584',
    note: SENTINEL_NOTE,
    deliveryTime: 'Express Delivery',
    couponId: null,
    paymentGateway: 'CASH_ON_DELIVERY',
    orderStatus: 'order-processing',
    paymentStatus: 'payment-cash-on-delivery',
    shippingAddress: { zip: '40391', city: 'Winchester' },
    billingAddress: { zip: '40391', city: 'Winchester' },
    lines,
    children,
  };
}

const stockOf = async (id: number) =>
  prisma.product.findUniqueOrThrow({
    where: { id },
    select: { quantity: true, soldQuantity: true },
  });

describe('createOrderWithChildren', () => {
  it('crea padre + una hija por tienda + líneas, descuenta stock y numera con la fecha UTC', async () => {
    const [before1, before21] = [await stockOf(1), await stockOf(21)];
    const stamp = new Date('2026-10-23T15:00:00.000Z');
    let order: OrderDetailRecord;
    try {
      _setNowProvider(() => stamp);
      const l1 = line(1, 2, '1.6');
      const l21 = line(21, 2, '8');
      order = await createOrderWithChildren(
        orderInput(
          [l1, l21],
          [
            { shopId: 6, amount: '3.2', lines: [l1] },
            { shopId: 4, amount: '16', lines: [l21] },
          ]
        )
      );
    } finally {
      _setNowProvider(() => new Date());
    }
    expect(order.trackingNumber).toMatch(/^20261023[0-9]{6}$/);
    expect(order).toMatchObject({
      parentId: null,
      customerId: CUSTOMER,
      salesTax: 0.384,
      total: 69.584,
      paidTotal: 69.584,
    });
    expect(order.createdAt.getTime()).toBe(stamp.getTime());
    expect(
      order.lines.map((l) => [l.lineNo, l.productId, l.orderQuantity])
    ).toEqual([
      [1, 1, 2],
      [2, 21, 2],
    ]);
    expect(
      order.children.map((c) => [
        c.shopId,
        c.amount,
        c.total,
        c.salesTax,
        c.deliveryFee,
        c.orderStatus,
      ])
    ).toEqual([
      [6, 3.2, 3.2, 0, 0, 'order-processing'],
      [4, 16, 16, 0, 0, 'order-processing'],
    ]);
    expect(
      new Set([
        order.trackingNumber,
        ...order.children.map((c) => c.trackingNumber),
      ]).size
    ).toBe(3);
    expect(Object.keys(order.lines[0].productSnapshot as object)).toEqual([
      'id',
      'name',
      'variation_options',
    ]);
    expect(await stockOf(1)).toEqual({
      quantity: before1.quantity - 2,
      soldQuantity: before1.soldQuantity + 2,
    });
    expect(await stockOf(21)).toEqual({
      quantity: before21.quantity - 2,
      soldQuantity: before21.soldQuantity + 2,
    });
  });

  it('sin stock suficiente: InsufficientStockError y nada a medias (rollback)', async () => {
    const before = await stockOf(1);
    const orders = await prisma.order.count();
    const huge = line(1, before.quantity + 1, '1.6');
    await expect(
      createOrderWithChildren(
        orderInput([huge], [{ shopId: 6, amount: '1', lines: [huge] }])
      )
    ).rejects.toBeInstanceOf(InsufficientStockError);
    expect(await prisma.order.count()).toBe(orders);
    expect(await stockOf(1)).toEqual(before);
  });

  it('findProductsForOrder trae los vivos y omite los inexistentes', async () => {
    const found = await findProductsForOrder([1, 21, 999_999]);
    expect(found.map((p) => p.id).sort((a, b) => a - b)).toEqual([1, 21]);
    expect(found[0].shop).toBeDefined();
  });
});

describe('setOrderStatus / markOrderPaid / deleteOrder', () => {
  async function newOrder() {
    const l1 = line(1, 1, '1.6');
    const l21 = line(21, 1, '8');
    return createOrderWithChildren(
      orderInput(
        [l1, l21],
        [
          { shopId: 6, amount: '1.6', lines: [l1] },
          { shopId: 4, amount: '8', lines: [l21] },
        ]
      )
    );
  }

  it('en un padre arrastra a las hijas; en una hija, solo a ella; fija updatedAt', async () => {
    const order = await newOrder();
    const stamp = new Date(Date.now() + 60_000);
    try {
      _setNowProvider(() => stamp);
      const updated = await setOrderStatus(order.id, {
        orderStatus: 'order-completed',
      });
      expect(updated.orderStatus).toBe('order-completed');
      expect(updated.children.map((c) => c.orderStatus)).toEqual([
        'order-completed',
        'order-completed',
      ]);
      expect(updated.updatedAt.getTime()).toBe(stamp.getTime());
    } finally {
      _setNowProvider(() => new Date());
    }
    const child = await setOrderStatus(order.children[0].id, {
      orderStatus: 'order-cancelled',
    });
    expect(child.orderStatus).toBe('order-cancelled');
    const parent = await findOrderByIdOrTracking(order.id);
    expect(parent?.orderStatus).toBe('order-completed');
    expect(parent?.children.map((c) => c.orderStatus)).toEqual([
      'order-cancelled',
      'order-completed',
    ]);
  });

  it('estado fuera del enum ⇒ InvalidFieldValueError; inexistente ⇒ RecordNotFoundError', async () => {
    await expect(
      setOrderStatus(48, { orderStatus: 'order-zz' })
    ).rejects.toBeInstanceOf(InvalidFieldValueError);
    await expect(
      setOrderStatus(48, { paymentStatus: 'payment-zz' })
    ).rejects.toBeInstanceOf(InvalidFieldValueError);
    await expect(
      setOrderStatus(999_999, { orderStatus: 'order-completed' })
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(markOrderPaid('00000000000000')).rejects.toBeInstanceOf(
      RecordNotFoundError
    );
  });

  it('markOrderPaid marca la orden pedida y sus hijas, no la 48', async () => {
    const order48 = await findOrderByIdOrTracking(48);
    const order = await newOrder();
    const paid = await markOrderPaid(order.trackingNumber);
    expect(paid).toMatchObject({
      orderStatus: 'order-processing',
      paymentStatus: 'payment-success',
    });
    expect(
      paid.children.every((c) => c.paymentStatus === 'payment-success')
    ).toBe(true);
    expect((await findOrderByIdOrTracking(48))?.paymentStatus).toBe(
      order48?.paymentStatus
    );
  });

  it('deleteOrder: snapshot previo; hijas y líneas por CASCADE; reviews.order_id a NULL', async () => {
    const order = await newOrder();
    const product = await prisma.product.findFirstOrThrow({
      where: { reviews: { none: { userId: CUSTOMER } } },
      select: { id: true, shopId: true },
    });
    const review = await prisma.review.create({
      data: {
        orderId: order.children[0].id,
        userId: CUSTOMER,
        productId: product.id,
        shopId: product.shopId,
        rating: 5,
        comment: 'zz-orders-review',
      },
    });
    const deleted = await deleteOrder(order.id);
    expect(deleted).toMatchObject({
      id: order.id,
      trackingNumber: order.trackingNumber,
    });
    expect(deleted.children).toHaveLength(2);
    expect(await findOrderByIdOrTracking(order.id)).toBeNull();
    expect(await prisma.order.count({ where: { parentId: order.id } })).toBe(0);
    expect(
      await prisma.orderProduct.count({
        where: {
          orderId: { in: [order.id, ...order.children.map((c) => c.id)] },
        },
      })
    ).toBe(0);
    expect(
      (await prisma.review.findUniqueOrThrow({ where: { id: review.id } }))
        .orderId
    ).toBeNull();
    await expect(deleteOrder(order.id)).rejects.toBeInstanceOf(
      RecordNotFoundError
    );
  });

  it('deleteOrder: si el SET NULL chocaría con otra reseña sin orden ⇒ SlugConflictError y no borra nada', async () => {
    const order = await newOrder();
    const product = await prisma.product.findFirstOrThrow({
      where: { reviews: { none: { userId: CUSTOMER } } },
      select: { id: true, shopId: true },
    });
    const base = {
      userId: CUSTOMER,
      productId: product.id,
      shopId: product.shopId,
      rating: 4,
      comment: 'zz-orders-review',
    };
    await prisma.review.create({ data: base });
    await prisma.review.create({ data: { ...base, orderId: order.id } });
    await expect(deleteOrder(order.id)).rejects.toBeInstanceOf(
      SlugConflictError
    );
    expect(await findOrderByIdOrTracking(order.id)).not.toBeNull();
    expect(
      await prisma.review.count({
        where: { comment: 'zz-orders-review', productId: product.id },
      })
    ).toBe(2);
  });
});
