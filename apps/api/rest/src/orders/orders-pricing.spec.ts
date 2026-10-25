/// <reference types="vitest/globals" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de Vitest.
 */
/**
 * Tests del cálculo de checkout (US-59): un caso por regla, R-a a R-f, sin
 * base ni Nest.
 */
import { Decimal } from '@safari/db';
import {
  hasAddress,
  isCouponApplicable,
  priceOrder,
  type CouponCandidate,
  type PricingInput,
  type PricingProduct,
} from './orders-pricing.js';

function product(overrides: Partial<PricingProduct> = {}): PricingProduct {
  return {
    id: 1,
    shopId: 6,
    status: 'publish',
    inStock: true,
    quantity: 16,
    price: 2,
    salePrice: 1.6,
    minPrice: 2,
    maxPrice: 2,
    ...overrides,
  };
}

function input(overrides: Partial<PricingInput> = {}): PricingInput {
  const products = [
    product(),
    product({
      id: 21,
      shopId: 4,
      price: 9,
      salePrice: 8,
      minPrice: 9,
      maxPrice: 9,
    }),
  ];
  return {
    lines: [{ product_id: 1, order_quantity: 2 }],
    products: new Map(products.map((p) => [p.id, p])),
    tax: { rate: 2 },
    shipping: { type: 'fixed', amount: 50 },
    settings: { freeShipping: false, freeShippingAmount: 0 },
    coupon: null,
    hasShippingAddress: true,
    ...overrides,
  };
}

const str = (d: Decimal) => d.toString();

describe('priceOrder', () => {
  it('R-a: inexistente, sin publicar, sin stock o con stock corto ⇒ no disponible y fuera del amount', () => {
    const products = new Map<number, PricingProduct>([
      [1, product()],
      [2, product({ id: 2, status: 'draft' })],
      [3, product({ id: 3, inStock: false })],
      [4, product({ id: 4, quantity: 1 })],
    ]);
    const result = priceOrder(
      input({
        products,
        lines: [
          { product_id: 1, order_quantity: 1 },
          { product_id: 2, order_quantity: 1 },
          { product_id: 3, order_quantity: 1 },
          { product_id: 4, order_quantity: 2 },
          { product_id: 999, order_quantity: 1 },
        ],
      }),
    );
    expect(result.unavailable).toEqual([2, 3, 4, 999]);
    expect(result.lines.map((l) => l.productId)).toEqual([1]);
    expect(str(result.amount)).toBe('1.6');
  });

  it('R-b: el precio lo decide el servidor (sale_price ?? price); la variación solo dentro de [min, max]', () => {
    const simple = priceOrder(
      input({
        lines: [{ product_id: 1, order_quantity: 2, unit_price: 0.01 }],
      }),
    );
    expect(simple.lines[0]).toMatchObject({ orderQuantity: 2 });
    expect([
      str(simple.lines[0].unitPrice),
      str(simple.lines[0].subtotal),
    ]).toEqual(['1.6', '3.2']);

    const noSale = priceOrder(
      input({ products: new Map([[1, product({ salePrice: null })]]) }),
    );
    expect(str(noSale.lines[0].unitPrice)).toBe('2');

    const variable = new Map([
      [5, product({ id: 5, minPrice: 10, maxPrice: 20 })],
    ]);
    const ok = priceOrder(
      input({
        products: variable,
        lines: [
          {
            product_id: 5,
            order_quantity: 1,
            unit_price: 15,
            variation_option_id: 311,
          },
        ],
      }),
    );
    expect(ok.lines[0]).toMatchObject({ variationOptionId: 311 });
    expect(str(ok.lines[0].unitPrice)).toBe('15');
    const out = priceOrder(
      input({
        products: variable,
        lines: [
          {
            product_id: 5,
            order_quantity: 1,
            unit_price: 25,
            variation_option_id: 311,
          },
        ],
      }),
    );
    expect(out.unavailable).toEqual([5]);
  });

  it('R-c: impuesto = amount × rate / 100, exacto, sin redondear y sin aplicarlo al envío', () => {
    const products = new Map([
      [7, product({ id: 7, salePrice: null, price: 2.2 })],
    ]);
    const result = priceOrder(
      input({ products, lines: [{ product_id: 7, order_quantity: 1 }] }),
    );
    expect(str(result.salesTax)).toBe('0.044');
    expect(str(priceOrder(input({ tax: null })).salesTax)).toBe('0');
  });

  it('R-d: envío fijo, por porcentaje, gratis por umbral, sin dirección o con cupón free_shipping', () => {
    expect(str(priceOrder(input()).deliveryFee)).toBe('50');
    expect(
      str(priceOrder(input({ hasShippingAddress: false })).deliveryFee),
    ).toBe('0');
    expect(
      str(
        priceOrder(input({ shipping: { type: 'percentage', amount: 10 } }))
          .deliveryFee,
      ),
    ).toBe('0.32');
    expect(
      str(
        priceOrder(input({ shipping: { type: 'free', amount: 50 } }))
          .deliveryFee,
      ),
    ).toBe('0');
    expect(str(priceOrder(input({ shipping: null })).deliveryFee)).toBe('0');
    expect(
      str(
        priceOrder(
          input({ settings: { freeShipping: true, freeShippingAmount: 3 } }),
        ).deliveryFee,
      ),
    ).toBe('0');
    expect(
      str(
        priceOrder(
          input({ settings: { freeShipping: true, freeShippingAmount: 100 } }),
        ).deliveryFee,
      ),
    ).toBe('50');
    const free = priceOrder(
      input({ coupon: { type: 'free_shipping', amount: 0 } }),
    );
    expect([str(free.deliveryFee), str(free.discount)]).toEqual(['0', '0']);
  });

  it('R-e: descuento fijo (tope en el amount) y por porcentaje', () => {
    expect(
      str(priceOrder(input({ coupon: { type: 'fixed', amount: 1 } })).discount),
    ).toBe('1');
    expect(
      str(
        priceOrder(input({ coupon: { type: 'fixed', amount: 100 } })).discount,
      ),
    ).toBe('3.2');
    expect(
      str(
        priceOrder(input({ coupon: { type: 'percentage', amount: 25 } }))
          .discount,
      ),
    ).toBe('0.8');
  });

  it('R-f: total = amount + sales_tax + delivery_fee − discount, con dos tiendas', () => {
    const result = priceOrder(
      input({
        lines: [
          { product_id: 1, order_quantity: 2 },
          { product_id: 21, order_quantity: 2 },
        ],
        coupon: { type: 'fixed', amount: 5 },
      }),
    );
    expect(result.lines.map((l) => [l.productId, l.shopId])).toEqual([
      [1, 6],
      [21, 4],
    ]);
    expect([
      str(result.amount),
      str(result.salesTax),
      str(result.deliveryFee),
      str(result.discount),
      str(result.total),
    ]).toEqual(['19.2', '0.384', '50', '5', '64.584']);
  });
});

describe('isCouponApplicable (R-e)', () => {
  const at = new Date('2026-10-23T12:00:00.000Z');
  const coupon: CouponCandidate = {
    type: 'fixed',
    amount: 5,
    isApprove: true,
    activeFrom: new Date('2026-01-01T00:00:00.000Z'),
    expireAt: new Date('2027-01-01T00:00:00.000Z'),
    minimumCartAmount: 10,
    shopId: null,
  };
  const ctx = { amount: new Decimal(20), shopIds: [6], at };

  it('aprobado, vigente, sobre el mínimo y sin tienda ⇒ aplica', () => {
    expect(isCouponApplicable(coupon, ctx)).toBe(true);
  });

  it('sin aprobar, vencido, aún no vigente, bajo el mínimo o de otra tienda ⇒ no aplica', () => {
    expect(isCouponApplicable({ ...coupon, isApprove: false }, ctx)).toBe(
      false,
    );
    expect(isCouponApplicable({ ...coupon, expireAt: at }, ctx)).toBe(false);
    expect(
      isCouponApplicable(
        { ...coupon, activeFrom: new Date('2026-12-01T00:00:00.000Z') },
        ctx,
      ),
    ).toBe(false);
    expect(
      isCouponApplicable(coupon, { ...ctx, amount: new Decimal(9.99) }),
    ).toBe(false);
    expect(isCouponApplicable({ ...coupon, shopId: 4 }, ctx)).toBe(false);
    expect(isCouponApplicable({ ...coupon, shopId: 6 }, ctx)).toBe(true);
  });
});

describe('hasAddress (R-d)', () => {
  it('[], {}, null y ausente cuentan como pedido digital', () => {
    expect([
      hasAddress([]),
      hasAddress({}),
      hasAddress(null),
      hasAddress(undefined),
    ]).toEqual([false, false, false, false]);
    expect(hasAddress({ zip: '40391' })).toBe(true);
  });
});
