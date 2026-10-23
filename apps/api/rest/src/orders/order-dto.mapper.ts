import type { OrderDetailRecord, OrderProductRecord } from '@safari/db';
import { toShopDto } from 'src/shops/shops.service';
import { Order } from './entities/order.entity';

/**
 * Línea → el producto del mock: el snapshot con `pivot` reinsertado justo
 * antes de `variation_options`, que es donde lo traía `orders.json`.
 * `order_quantity` sale como string, igual que en el mock.
 */
function toOrderProductDto(line: OrderProductRecord) {
  const { variation_options, ...product } = line.productSnapshot as Record<string, unknown>;
  return {
    ...product,
    pivot: {
      order_id: line.orderId,
      product_id: line.productId,
      order_quantity: String(line.orderQuantity),
      unit_price: line.unitPrice,
      subtotal: line.subtotal,
      variation_option_id: line.variationOptionId,
      created_at: line.createdAt,
      updated_at: line.updatedAt,
    },
    variation_options,
  };
}

/**
 * `OrderDetailRecord` → las claves de `orders.json`, en su orden (US-58).
 * Padre: termina en `children`, sin `shop` ni `wallet_point` (V-6). Hija:
 * termina en `shop`, proyectada con `toShopDto` (V-7/V-8), sin `children`.
 * `customer` es el snapshot de la compra, verbatim. `cancelled_*` salen como
 * string con 2 decimales, como en el mock.
 */
export function toOrderDto(record: OrderDetailRecord): Order {
  const isChild = record.parentId !== null;
  return {
    id: record.id,
    tracking_number: record.trackingNumber,
    customer_id: record.customerId,
    customer_contact: record.customerContact,
    customer_name: record.customerName,
    amount: record.amount,
    sales_tax: record.salesTax,
    paid_total: record.paidTotal,
    total: record.total,
    note: record.note,
    cancelled_amount: record.cancelledAmount.toFixed(2),
    cancelled_tax: record.cancelledTax.toFixed(2),
    cancelled_delivery_fee: record.cancelledDeliveryFee.toFixed(2),
    language: record.language,
    coupon_id: record.couponId,
    parent_id: record.parentId,
    shop_id: record.shopId,
    discount: record.discount,
    payment_gateway: record.paymentGateway,
    altered_payment_gateway: record.alteredPaymentGateway,
    shipping_address: record.shippingAddress,
    billing_address: record.billingAddress,
    logistics_provider: record.logisticsProvider,
    delivery_fee: record.deliveryFee,
    delivery_time: record.deliveryTime,
    order_status: record.orderStatus,
    payment_status: record.paymentStatus,
    created_at: record.createdAt,
    customer: record.customerSnapshot,
    products: record.lines.map(toOrderProductDto),
    ...(isChild
      ? { shop: record.shop ? toShopDto(record.shop) : null }
      : { children: record.children.map(toOrderDto) }),
  } as unknown as Order;
}
