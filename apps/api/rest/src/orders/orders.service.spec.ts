/// <reference types="jest" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de jest.
 */
/**
 * Tests unitarios de la lectura de `OrdersService` (US-58). Solo se mockea el
 * acceso a datos; las dependencias de pago no se usan en la lectura y se
 * proveen vacías.
 */
import 'reflect-metadata';
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  findOrderByIdOrTracking,
  listOrders,
  type OrderDetailRecord,
  type ShopRecord,
} from '@safari/db';
import { AuthService } from 'src/auth/auth.service';
import { CurrentUserPayload } from 'src/auth/decorators/current-user.decorator';
import { PaypalPaymentService } from 'src/payment/paypal-payment.service';
import { StripePaymentService } from 'src/payment/stripe-payment.service';
import { GetOrdersDto } from './dto/get-orders.dto';
import { OrdersService } from './orders.service';

jest.mock('@safari/db', () => ({
  ...jest.requireActual<typeof import('@safari/db')>('@safari/db'),
  listOrders: jest.fn(),
  findOrderByIdOrTracking: jest.fn(),
}));

const listMock = jest.mocked(listOrders);
const findMock = jest.mocked(findOrderByIdOrTracking);

const ADMIN_USER: CurrentUserPayload = {
  sub: 3,
  email: 'admin@demo.com',
  permissions: ['super_admin', 'customer', 'store_owner'],
  iat: 0,
  exp: 0,
};
const CUSTOMER_USER: CurrentUserPayload = {
  sub: 2,
  email: 'customer@demo.com',
  permissions: ['customer'],
  iat: 0,
  exp: 0,
};

const CREATED = new Date('2024-02-07T01:08:37.000Z');

const SHOP: ShopRecord = {
  id: 7,
  name: 'Tienda',
  slug: 'tienda',
  description: null,
  ownerId: 1,
  isActive: true,
  logo: null,
  coverImage: null,
  address: {},
  settings: {},
  createdAt: CREATED,
  updatedAt: CREATED,
  productsCount: 4,
};

function makeOrder(overrides: Partial<OrderDetailRecord> = {}): OrderDetailRecord {
  return {
    id: 48,
    trackingNumber: '20240207303639',
    parentId: null,
    customerId: 2,
    customerContact: '19365141641631',
    customerName: 'Customer',
    customerSnapshot: { id: 2, name: 'Customer' },
    shopId: null,
    amount: 50,
    salesTax: 0.044,
    paidTotal: 52.244,
    total: 52.244,
    discount: 0,
    deliveryFee: 2.2,
    cancelledAmount: 0,
    cancelledTax: 0,
    cancelledDeliveryFee: 0,
    note: null,
    alteredPaymentGateway: null,
    logisticsProvider: null,
    deliveryTime: 'Express Delivery',
    language: 'en',
    couponId: null,
    paymentGateway: 'CASH_ON_DELIVERY',
    orderStatus: 'order-pending',
    paymentStatus: 'payment-cash-on-delivery',
    shippingAddress: [],
    billingAddress: [],
    createdAt: CREATED,
    updatedAt: CREATED,
    lines: [
      {
        orderId: 48,
        lineNo: 1,
        productId: 206,
        variationOptionId: null,
        orderQuantity: 2,
        unitPrice: 3.5,
        subtotal: 7,
        productSnapshot: { id: 206, name: 'Producto', translated_languages: ['en'], variation_options: [] },
        createdAt: CREATED,
        updatedAt: CREATED,
      },
    ],
    shop: null,
    children: [],
    ...overrides,
  };
}

function makeParentWithChild(): OrderDetailRecord {
  const child = makeOrder({ id: 49, parentId: 48, shopId: 7, shop: SHOP, trackingNumber: '20240207303640' });
  return makeOrder({ children: [child] });
}

describe('OrdersService — lectura', () => {
  let service: OrdersService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: AuthService, useValue: {} },
        { provide: StripePaymentService, useValue: {} },
        { provide: PaypalPaymentService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(OrdersService);
  });

  describe('forma (D-1)', () => {
    it('padre: claves del mock en orden, terminando en children; dinero y cancelled_* como el mock', async () => {
      findMock.mockResolvedValue(makeParentWithChild());
      const order = (await service.getOrder('48', ADMIN_USER)) as unknown as Record<string, unknown>;
      expect(Object.keys(order).slice(-4)).toEqual(['created_at', 'customer', 'products', 'children']);
      expect(order).not.toHaveProperty('shop');
      expect(order).toMatchObject({ sales_tax: 0.044, total: 52.244, cancelled_amount: '0.00', coupon_id: null });
      const child = (order.children as Record<string, unknown>[])[0];
      expect(Object.keys(child).slice(-3)).toEqual(['customer', 'products', 'shop']);
      expect(child).not.toHaveProperty('children');
      expect(Object.keys(child.shop as object)).toHaveLength(16);
      expect(child.shop).toMatchObject({ id: 7, products_count: 4, orders_count: 0, owner: null });
    });

    it('producto: el snapshot con pivot justo antes de variation_options y order_quantity string', async () => {
      findMock.mockResolvedValue(makeOrder());
      const order = (await service.getOrder('48', ADMIN_USER)) as unknown as { products: Record<string, unknown>[] };
      const product = order.products[0];
      expect(Object.keys(product)).toEqual(['id', 'name', 'translated_languages', 'pivot', 'variation_options']);
      expect(product.pivot).toEqual({
        order_id: 48,
        product_id: 206,
        order_quantity: '2',
        unit_price: 3.5,
        subtotal: 7,
        variation_option_id: null,
        created_at: CREATED,
        updated_at: CREATED,
      });
    });
  });

  describe('getOrders', () => {
    it('sin filtros: defaults del mock y la url con search=undefined', async () => {
      listMock.mockResolvedValue({ items: [makeOrder()], total: 1 });
      const page = await service.getOrders({} as GetOrdersDto);
      expect(listMock).toHaveBeenCalledWith({
        customerId: undefined,
        shopId: undefined,
        trackingNumber: undefined,
        page: 1,
        limit: 15,
      });
      expect(page.first_page_url).toContain('/orders?search=undefined&limit=15&page=1');
    });

    it('obedece customer_id, shop_id y search=tracking_number:X; per_page queda string', async () => {
      listMock.mockResolvedValue({ items: [], total: 0 });
      const page = await service.getOrders({
        customer_id: 2,
        shop_id: '7',
        search: 'tracking_number:20240207303639',
        limit: '20',
      } as unknown as GetOrdersDto);
      expect(listMock).toHaveBeenCalledWith({
        customerId: 2,
        shopId: 7,
        trackingNumber: '20240207303639',
        page: 1,
        limit: 20,
      });
      expect(page.per_page).toBe('20');
    });

    it('shop_id "undefined" (lo manda el admin) se ignora; un id mal formado da lista vacía sin consultar', async () => {
      listMock.mockResolvedValue({ items: [], total: 0 });
      await service.getOrders({ shop_id: 'undefined' } as GetOrdersDto);
      expect(listMock.mock.calls[0][0]).toMatchObject({ shopId: undefined });
      const empty = await service.getOrders({ shop_id: 'abc' } as GetOrdersDto);
      expect(empty).toMatchObject({ data: [], total: 0 });
      expect(listMock).toHaveBeenCalledTimes(1);
    });

    it('base caída ⇒ 503', async () => {
      listMock.mockRejectedValue(
        Object.assign(new Error('Invalid `prisma.order.findMany()` invocation'), {
          name: 'PrismaClientKnownRequestError',
          code: 'ECONNREFUSED',
        })
      );
      await expect(service.getOrders({} as GetOrdersDto)).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('detalle', () => {
    it(':id acepta un id o un tracking de 14 dígitos; otro formato ⇒ 400 sin consultar', async () => {
      findMock.mockResolvedValue(makeOrder());
      await service.getOrder('48', ADMIN_USER);
      await service.getOrder('20240207303639', ADMIN_USER);
      expect(findMock.mock.calls.map(([key]) => key)).toEqual([48, '20240207303639']);
      for (const bad of ['abc', '0', '1e21', '-3']) {
        await expect(service.getOrder(bad, ADMIN_USER)).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(findMock).toHaveBeenCalledTimes(2);
    });

    it('inexistente ⇒ 404', async () => {
      findMock.mockResolvedValue(null);
      await expect(service.getOrder('999999', ADMIN_USER)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.getOrderByTrackingNumber('20231105635099', ADMIN_USER)).rejects.toBeInstanceOf(
        NotFoundException
      );
    });

    it('orden ajena ⇒ 404 para un cliente, 200 para el admin (V-4, R-5)', async () => {
      findMock.mockResolvedValue(makeOrder({ id: 41, customerId: 3 }));
      await expect(service.getOrder('41', CUSTOMER_USER)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.getOrderByTrackingNumber('20231105635099', CUSTOMER_USER)).rejects.toBeInstanceOf(
        NotFoundException
      );
      expect((await service.getOrder('41', ADMIN_USER)).id).toBe(41);
      findMock.mockResolvedValue(makeOrder());
      expect((await service.getOrder('48', CUSTOMER_USER)).id).toBe(48);
    });
  });
});
