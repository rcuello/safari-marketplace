/**
 * Test de integración contra el Postgres real (sembrado por `just db-up`: 20
 * órdenes padre con 1 hija cada una, ids 5..49, y 76 líneas). US-58.
 *
 * Las escrituras son centinelas hechos con `prisma` directo (el repositorio
 * es solo lectura hasta US-59): órdenes con `note` 'zz-orders-', un cupón
 * 'ZZ-ORDERS' y una reseña 'zz-orders-review'. `afterAll` los borra.
 */

import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../client';
import { findOrderByIdOrTracking, listOrders } from './orders.repository';

const CUSTOMER = 2;
const ADMIN = 3;
const SENTINEL_NOTE = 'zz-orders-';

/** Las 43 claves del producto previas a `pivot`, más `variation_options` (orden del mock). */
const SNAPSHOT_KEYS = [
  'id', 'name', 'slug', 'description', 'type_id', 'price', 'shop_id', 'sale_price', 'language',
  'min_price', 'max_price', 'sku', 'quantity', 'sold_quantity', 'in_stock', 'is_taxable',
  'in_flash_sale', 'shipping_class_id', 'status', 'product_type', 'unit', 'height', 'width', 'length',
  'image', 'video', 'gallery', 'deleted_at', 'created_at', 'updated_at', 'author_id',
  'manufacturer_id', 'is_digital', 'is_external', 'external_product_url',
  'external_product_button_text', 'blocked_dates', 'ratings', 'total_reviews', 'rating_count',
  'my_review', 'in_wishlist', 'translated_languages', 'variation_options',
];
const CUSTOMER_KEYS = [
  'id', 'name', 'email', 'email_verified_at', 'created_at', 'updated_at', 'is_active', 'shop_id',
  'email_verified',
];

const cleanup = async () => {
  await prisma.review.deleteMany({ where: { comment: 'zz-orders-review' } });
  await prisma.order.deleteMany({ where: { note: SENTINEL_NOTE } });
  await prisma.coupon.deleteMany({ where: { code: 'ZZ-ORDERS' } });
};

beforeAll(cleanup);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe('lecturas — seed', () => {
  it('sin filtros: solo padres, id DESC, cada uno con su hija embebida', async () => {
    const { items, total } = await listOrders({ limit: 20 });
    expect(total).toBe(20);
    expect(items.map((o) => o.id).slice(0, 3)).toEqual([48, 41, 39]);
    expect(items.every((o) => o.parentId === null && o.shop === null)).toBe(true);
    expect(items.every((o) => o.children.length === 1 && o.children[0].parentId === o.id)).toBe(true);
    expect(items[0].children[0]).toMatchObject({ id: 49, shopId: items[0].children[0].shop?.id, children: [] });
    expect((await listOrders()).items).toHaveLength(15);
  });

  it('los snapshots y las direcciones conservan el orden de claves del mock (json, no jsonb)', async () => {
    const lines = await prisma.orderProduct.findMany();
    expect(lines).toHaveLength(76);
    for (const line of lines) {
      expect(Object.keys(line.productSnapshot as object)).toEqual(SNAPSHOT_KEYS);
    }
    const order48 = await findOrderByIdOrTracking(48);
    expect(Object.keys(order48?.customerSnapshot as object)).toEqual(CUSTOMER_KEYS);
    expect(Object.keys(order48?.shippingAddress as object)).toEqual(['zip', 'city', 'state', 'country', 'street_address']);
    expect(order48?.lines.map((l) => l.lineNo)).toEqual(order48?.lines.map((_, i) => i + 1));
    expect((await findOrderByIdOrTracking(23))?.shippingAddress).toEqual([]);
  });

  it('dinero numeric sin escala: los 3 decimales sobreviven; cancelled_* en 0', async () => {
    const order = await prisma.order.findFirstOrThrow({ where: { salesTax: 0.044 } });
    const record = await findOrderByIdOrTracking(Number(order.id));
    expect(record).toMatchObject({ salesTax: 0.044, total: 52.244, cancelledAmount: 0, discount: 0 });
  });

  it('shopId: las hijas de la tienda, con su tienda y su products_count', async () => {
    const { items, total } = await listOrders({ shopId: 7, limit: 20 });
    expect(total).toBe(6);
    expect(items.every((o) => o.parentId !== null && o.shopId === 7 && o.shop?.id === 7)).toBe(true);
    expect(typeof items[0].shop?.productsCount).toBe('number');
  });

  it('trackingNumber exacto sobre padres e hijas; customerId aísla', async () => {
    expect((await listOrders({ trackingNumber: '20240207303639' })).items.map((o) => o.id)).toEqual([48]);
    const child = await prisma.order.findUniqueOrThrow({ where: { id: 49 } });
    expect((await listOrders({ trackingNumber: child.trackingNumber })).items.map((o) => o.id)).toEqual([49]);
    const mine = await listOrders({ customerId: CUSTOMER, limit: 50 });
    expect(mine.total).toBe(19);
    expect(mine.items.every((o) => o.customerId === CUSTOMER)).toBe(true);
    expect((await listOrders({ customerId: ADMIN })).items.map((o) => o.id)).toEqual([41]);
  });

  it('por id o por tracking; inexistente ⇒ null', async () => {
    const byTracking = await findOrderByIdOrTracking('20231105635099');
    expect(byTracking).toMatchObject({ id: 41, customerId: ADMIN });
    expect((byTracking?.customerSnapshot as { id: number }).id).toBe(6);
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
          create: { lineNo: 1, productId: 2, orderQuantity: 1, unitPrice: 1, subtotal: 1, productSnapshot: {} },
        },
      },
    });
    await prisma.coupon.delete({ where: { id: coupon.id } });
    expect((await findOrderByIdOrTracking(Number(order.id)))?.couponId).toBeNull();

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
    expect((await prisma.review.findUniqueOrThrow({ where: { id: review.id } })).orderId).toBeNull();
    expect(await prisma.orderProduct.count({ where: { orderId: order.id } })).toBe(0);
  });

  it('una reseña con una orden inexistente viola reviews_order_id_fkey', async () => {
    const product = await prisma.product.findUniqueOrThrow({ where: { id: 2 }, select: { shopId: true } });
    await expect(
      prisma.review.create({
        data: { orderId: 999_999, userId: CUSTOMER, productId: 2, shopId: product.shopId, rating: 4, comment: 'zz-orders-review' },
      })
    ).rejects.toMatchObject({ code: 'P2003' });
  });
});
