/**
 * orders-pricing.ts — el cálculo del checkout (US-59, R-a a R-f), puro: sin
 * base, sin reloj y sin Nest. `checkout/verify` y `POST /orders` lo llaman
 * igual, así que lo que el shop ve al verificar es lo que luego se cobra.
 *
 * El dinero se calcula con `Decimal` (la aritmética de `numeric`): `2.2 ×
 * 0.02` da `0.044` exacto, como en el mock, y no `0.044000000000000004`.
 */
import { Decimal } from '@safari/db';

export interface PricingLine {
  product_id: number;
  order_quantity: number;
  unit_price?: number;
  variation_option_id?: number | null;
}

/** Lo que el cálculo necesita de la fila viva de `products`. */
export interface PricingProduct {
  id: number;
  shopId: number;
  status: string;
  inStock: boolean;
  quantity: number;
  price: number | null;
  salePrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
}

/** Cupón ya validado (R-e): solo su tipo y su importe. */
export interface PricingCoupon {
  type: string;
  amount: number;
}

export interface PricingInput {
  lines: PricingLine[];
  products: Map<number, PricingProduct>;
  /** Fila de `taxes` de `settings.taxClass`; `null` si no hay. */
  tax: { rate: number } | null;
  /** Fila de `shippings` de `settings.shippingClass`; `null` si no hay. */
  shipping: { type: string; amount: number } | null;
  settings: { freeShipping: boolean; freeShippingAmount: number };
  coupon: PricingCoupon | null;
  hasShippingAddress: boolean;
}

export interface PricedLine {
  productId: number;
  shopId: number;
  variationOptionId: number | null;
  orderQuantity: number;
  unitPrice: Decimal;
  subtotal: Decimal;
}

export interface PricingResult {
  lines: PricedLine[];
  amount: Decimal;
  salesTax: Decimal;
  deliveryFee: Decimal;
  discount: Decimal;
  total: Decimal;
  /** `product_id` de las líneas no disponibles (R-a/R-b), sin repetir. */
  unavailable: number[];
}

/** Lo que R-e mira de un cupón de `coupons` (US-52). */
export interface CouponCandidate extends PricingCoupon {
  isApprove: boolean;
  activeFrom: Date;
  expireAt: Date;
  minimumCartAmount: number;
  shopId: number | null;
}

/**
 * R-e: aprobado, vigente en `at` (`active_from <= at < expire_at`, la regla
 * del `is_valid` de US-52), `amount >= minimum_cart_amount` y, si el cupón es
 * de una tienda, alguna línea de esa tienda.
 */
export function isCouponApplicable(
  coupon: CouponCandidate,
  { amount, shopIds, at }: { amount: Decimal; shopIds: number[]; at: Date }
): boolean {
  const t = at.getTime();
  return (
    coupon.isApprove &&
    coupon.activeFrom.getTime() <= t &&
    t < coupon.expireAt.getTime() &&
    amount.gte(coupon.minimumCartAmount) &&
    (coupon.shopId === null || shopIds.includes(coupon.shopId))
  );
}

/** `[]`, `{}`, `null` o ausente ⇒ pedido digital, sin envío (R-d). */
export function hasAddress(address: unknown): boolean {
  if (address === null || address === undefined) return false;
  if (Array.isArray(address)) return address.length > 0;
  if (typeof address === 'object') return Object.keys(address).length > 0;
  return false;
}

/**
 * R-a/R-b: precio de una línea, o `null` si no está disponible. `simple` usa
 * `sale_price ?? price` de la fila viva e ignora el del cliente; una línea con
 * variación acepta el del cliente solo dentro de `[min_price, max_price]`.
 */
function unitPriceOf(line: PricingLine, product: PricingProduct | undefined): Decimal | null {
  const quantity = Number(line.order_quantity);
  if (
    !product ||
    product.status !== 'publish' ||
    !product.inStock ||
    !Number.isSafeInteger(quantity) ||
    quantity <= 0 ||
    product.quantity < quantity
  ) {
    return null;
  }
  if (line.variation_option_id != null) {
    const price = Number(line.unit_price);
    if (!Number.isFinite(price) || product.minPrice === null || product.maxPrice === null) return null;
    return price >= product.minPrice && price <= product.maxPrice ? new Decimal(price) : null;
  }
  const price = product.salePrice ?? product.price;
  return price === null ? null : new Decimal(price);
}

/** R-d: envío. 0 sin dirección, con envío gratis por umbral o con cupón `free_shipping`. */
function deliveryFeeOf(amount: Decimal, input: PricingInput): Decimal {
  const zero = new Decimal(0);
  if (!input.hasShippingAddress) return zero;
  if (input.settings.freeShipping && amount.gte(input.settings.freeShippingAmount)) return zero;
  if (input.coupon?.type === 'free_shipping') return zero;
  if (!input.shipping) return zero;
  switch (input.shipping.type) {
    case 'fixed':
      return new Decimal(input.shipping.amount);
    case 'percentage':
      return amount.times(input.shipping.amount).dividedBy(100);
    default:
      return zero;
  }
}

/** R-e: descuento. `fixed` no pasa del `amount`; `free_shipping` va por el envío. */
function discountOf(amount: Decimal, coupon: PricingCoupon | null): Decimal {
  if (!coupon) return new Decimal(0);
  switch (coupon.type) {
    case 'fixed':
      return Decimal.min(new Decimal(coupon.amount), amount);
    case 'percentage':
      return amount.times(coupon.amount).dividedBy(100);
    default:
      return new Decimal(0);
  }
}

/**
 * R-a a R-f. Las líneas no disponibles quedan fuera del `amount` y van a
 * `unavailable`; quien llama decide si eso es un 422 (`POST /orders`) o solo
 * información (`verify`). El impuesto es `amount × rate / 100`, sin redondear
 * y sin aplicarlo al envío (R-c: así sale en las 20 órdenes del mock, aunque
 * el impuesto diga `on_shipping`).
 */
export function priceOrder(input: PricingInput): PricingResult {
  const lines: PricedLine[] = [];
  const unavailable = new Set<number>();
  for (const line of input.lines) {
    const product = input.products.get(Number(line.product_id));
    const unitPrice = unitPriceOf(line, product);
    if (!product || unitPrice === null) {
      unavailable.add(Number(line.product_id));
      continue;
    }
    const orderQuantity = Number(line.order_quantity);
    lines.push({
      productId: product.id,
      shopId: product.shopId,
      variationOptionId: line.variation_option_id ?? null,
      orderQuantity,
      unitPrice,
      subtotal: unitPrice.times(orderQuantity),
    });
  }

  const amount = lines.reduce((sum, l) => sum.plus(l.subtotal), new Decimal(0));
  const salesTax = input.tax ? amount.times(input.tax.rate).dividedBy(100) : new Decimal(0);
  const deliveryFee = deliveryFeeOf(amount, input);
  const discount = discountOf(amount, input.coupon);
  const total = amount.plus(salesTax).plus(deliveryFee).minus(discount);
  return { lines, amount, salesTax, deliveryFee, discount, total, unavailable: [...unavailable] };
}
