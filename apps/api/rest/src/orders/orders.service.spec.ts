/// <reference types="vitest/globals" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de Vitest.
 */
/**
 * Tests unitarios de `OrdersService`: lectura (US-58), escritura (US-59) y
 * descargas, export e invoice (US-60).
 * Solo se mockea el acceso a datos; las dependencias de pago se proveen
 * vacías salvo `verifyOrder` de PayPal, que es la pasarela. El cálculo de
 * precios es el real (`orders-pricing.ts`, con su propio spec).
 */
import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  createOrderWithChildren,
  deleteOrder,
  findCouponById,
  findFirstOrderFileByDigitalFileId,
  findOrderByIdOrTracking,
  findProductsForOrder,
  findShippingById,
  findTaxById,
  findUserById,
  getSettings,
  InsufficientStockError,
  listOrderFilesByCustomer,
  listOrders,
  markOrderPaid,
  RecordNotFoundError,
  setOrderStatus,
  type CouponRecord,
  type OrderFileRecord,
  type OrderDetailRecord,
  type ProductRecord,
  type ShopRecord,
} from '@safari/db';
import { AuthService } from '#src/auth/auth.service.js';
import { CurrentUserPayload } from '#src/auth/decorators/current-user.decorator.js';
import { PaypalPaymentService } from '#src/payment/paypal-payment.service.js';
import { StripePaymentService } from '#src/payment/stripe-payment.service.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { GetOrdersDto } from './dto/get-orders.dto.js';
import { UpdateOrderDto } from './dto/update-order.dto.js';
import { CheckoutVerificationDto } from './dto/verify-checkout.dto.js';
import { JwtService } from '@nestjs/jwt';
import { GetOrderFilesDto } from './dto/get-downloads.dto.js';
import { OrderFilesController } from './orders.controller.js';
import {
  ORDER_EXPORT_URL,
  ORDER_INVOICE_URL,
  OrdersService,
} from './orders.service.js';

vi.mock('@safari/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@safari/db')>()),
  listOrders: vi.fn(),
  findOrderByIdOrTracking: vi.fn(),
  findProductsForOrder: vi.fn(),
  findTaxById: vi.fn(),
  findShippingById: vi.fn(),
  getSettings: vi.fn(),
  findCouponById: vi.fn(),
  findUserById: vi.fn(),
  createOrderWithChildren: vi.fn(),
  setOrderStatus: vi.fn(),
  deleteOrder: vi.fn(),
  markOrderPaid: vi.fn(),
  listOrderFilesByCustomer: vi.fn(),
  findFirstOrderFileByDigitalFileId: vi.fn(),
}));

const listMock = vi.mocked(listOrders);
const findMock = vi.mocked(findOrderByIdOrTracking);

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

function makeOrder(
  overrides: Partial<OrderDetailRecord> = {},
): OrderDetailRecord {
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
        productSnapshot: {
          id: 206,
          name: 'Producto',
          translated_languages: ['en'],
          variation_options: [],
        },
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
  const child = makeOrder({
    id: 49,
    parentId: 48,
    shopId: 7,
    shop: SHOP,
    trackingNumber: '20240207303640',
  });
  return makeOrder({ children: [child] });
}

describe('OrdersService — lectura', () => {
  let service: OrdersService;

  beforeEach(async () => {
    vi.resetAllMocks();
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
      const order = (await service.getOrder(
        '48',
        ADMIN_USER,
      )) as unknown as Record<string, unknown>;
      expect(Object.keys(order).slice(-4)).toEqual([
        'created_at',
        'customer',
        'products',
        'children',
      ]);
      expect(order).not.toHaveProperty('shop');
      expect(order).toMatchObject({
        sales_tax: 0.044,
        total: 52.244,
        cancelled_amount: '0.00',
        coupon_id: null,
      });
      const child = (order.children as Record<string, unknown>[])[0];
      expect(Object.keys(child).slice(-3)).toEqual([
        'customer',
        'products',
        'shop',
      ]);
      expect(child).not.toHaveProperty('children');
      expect(Object.keys(child.shop as object)).toHaveLength(16);
      expect(child.shop).toMatchObject({
        id: 7,
        products_count: 4,
        orders_count: 0,
        owner: null,
      });
    });

    it('producto: el snapshot con pivot justo antes de variation_options y order_quantity string', async () => {
      findMock.mockResolvedValue(makeOrder());
      const order = (await service.getOrder('48', ADMIN_USER)) as unknown as {
        products: Record<string, unknown>[];
      };
      const product = order.products[0];
      expect(Object.keys(product)).toEqual([
        'id',
        'name',
        'translated_languages',
        'pivot',
        'variation_options',
      ]);
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
      expect(page.first_page_url).toContain(
        '/orders?search=undefined&limit=15&page=1',
      );
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
        Object.assign(
          new Error('Invalid `prisma.order.findMany()` invocation'),
          {
            name: 'PrismaClientKnownRequestError',
            code: 'ECONNREFUSED',
          },
        ),
      );
      await expect(
        service.getOrders({} as GetOrdersDto),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('detalle', () => {
    it(':id acepta un id o un tracking de 14 dígitos; otro formato ⇒ 400 sin consultar', async () => {
      findMock.mockResolvedValue(makeOrder());
      await service.getOrder('48', ADMIN_USER);
      await service.getOrder('20240207303639', ADMIN_USER);
      expect(findMock.mock.calls.map(([key]) => key)).toEqual([
        48,
        '20240207303639',
      ]);
      for (const bad of ['abc', '0', '1e21', '-3']) {
        await expect(service.getOrder(bad, ADMIN_USER)).rejects.toBeInstanceOf(
          BadRequestException,
        );
      }
      expect(findMock).toHaveBeenCalledTimes(2);
    });

    it('inexistente ⇒ 404', async () => {
      findMock.mockResolvedValue(null);
      await expect(
        service.getOrder('999999', ADMIN_USER),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.getOrderByTrackingNumber('20231105635099', ADMIN_USER),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('orden ajena ⇒ 404 para un cliente, 200 para el admin (V-4, R-5)', async () => {
      findMock.mockResolvedValue(makeOrder({ id: 41, customerId: 3 }));
      await expect(
        service.getOrder('41', CUSTOMER_USER),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.getOrderByTrackingNumber('20231105635099', CUSTOMER_USER),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect((await service.getOrder('41', ADMIN_USER)).id).toBe(41);
      findMock.mockResolvedValue(makeOrder());
      expect((await service.getOrder('48', CUSTOMER_USER)).id).toBe(48);
    });
  });
});

// ---------------------------------------------------------------------------
// Escritura (US-59)
// ---------------------------------------------------------------------------

const productsMock = vi.mocked(findProductsForOrder);
const taxMock = vi.mocked(findTaxById);
const shippingMock = vi.mocked(findShippingById);
const settingsMock = vi.mocked(getSettings);
const couponMock = vi.mocked(findCouponById);
const userMock = vi.mocked(findUserById);
const createMock = vi.mocked(createOrderWithChildren);
const statusMock = vi.mocked(setOrderStatus);
const deleteMock = vi.mocked(deleteOrder);
const paidMock = vi.mocked(markOrderPaid);

function makeProduct(
  id: number,
  shopId: number,
  overrides: Partial<ProductRecord> = {},
): ProductRecord {
  return {
    id,
    name: `Producto ${id}`,
    slug: `producto-${id}`,
    description: '',
    typeId: 1,
    shopId,
    manufacturerId: null,
    productType: 'simple',
    price: 2,
    salePrice: 1.6,
    minPrice: 2,
    maxPrice: 2,
    quantity: 16,
    inStock: true,
    soldQuantity: 2,
    sku: null,
    unit: '1 pc',
    status: 'publish',
    visibility: 'visibility_public',
    image: null,
    gallery: [],
    ratings: 0,
    totalReviews: 0,
    isTaxable: false,
    isDigital: false,
    isExternal: false,
    externalProductUrl: null,
    language: 'en',
    translatedLanguages: ['en'],
    sourceStore: null,
    sourceProductId: null,
    sourceUrl: null,
    scrapedAt: null,
    createdAt: CREATED,
    updatedAt: CREATED,
    type: {
      id: 1,
      name: 'T',
      slug: 't',
      icon: null,
      settings: {},
      banners: [],
      language: 'en',
      createdAt: CREATED,
      updatedAt: CREATED,
    },
    shop: { ...SHOP, id: shopId },
    manufacturer: null,
    categories: [],
    tags: [],
    ...overrides,
  };
}

const DIR = {
  zip: '40391',
  city: 'Winchester',
  state: 'KY',
  country: 'United States',
  street_address: '2148 Straford Park',
};

function makeCoupon(overrides: Partial<CouponRecord> = {}): CouponRecord {
  return {
    id: 9,
    code: 'ZZ',
    description: null,
    image: null,
    type: 'fixed',
    amount: 5,
    minimumCartAmount: 0,
    activeFrom: new Date('2020-01-01T00:00:00.000Z'),
    expireAt: new Date('2099-01-01T00:00:00.000Z'),
    target: false,
    isApprove: true,
    shopId: null,
    userId: null,
    language: 'en',
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  };
}

function orderDto(overrides: Partial<CreateOrderDto> = {}): CreateOrderDto {
  return {
    products: [
      { product_id: 1, order_quantity: 2, unit_price: 0.01, subtotal: 0.02 },
      { product_id: 21, order_quantity: 2, unit_price: 8, subtotal: 16 },
    ],
    amount: 19.2,
    sales_tax: 0.384,
    total: 69.584,
    payment_gateway: undefined,
    customer_contact: '+19999999999',
    customer_name: 'Customer',
    delivery_time: 'Express Delivery',
    shipping_address: DIR,
    billing_address: DIR,
    ...overrides,
  } as CreateOrderDto;
}

describe('OrdersService — escritura', () => {
  let service: OrdersService;
  const verifyOrder = vi.fn();

  beforeEach(async () => {
    vi.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: AuthService, useValue: {} },
        { provide: StripePaymentService, useValue: {} },
        { provide: PaypalPaymentService, useValue: { verifyOrder } },
      ],
    }).compile();
    service = moduleRef.get(OrdersService);
    settingsMock.mockResolvedValue({
      id: 1,
      options: {
        taxClass: '1',
        shippingClass: '1',
        freeShipping: false,
        freeShippingAmount: 0,
        paymentGateway: [],
      },
      language: 'en',
      createdAt: CREATED,
      updatedAt: CREATED,
    });
    taxMock.mockResolvedValue({
      id: 1,
      name: 'Global',
      rate: 2,
      isGlobal: true,
      country: null,
      state: null,
      zip: null,
      city: null,
      priority: null,
      onShipping: true,
      createdAt: CREATED,
      updatedAt: CREATED,
    });
    shippingMock.mockResolvedValue({
      id: 1,
      name: 'Global',
      amount: 50,
      isGlobal: true,
      type: 'fixed',
      createdAt: CREATED,
      updatedAt: CREATED,
    });
    productsMock.mockResolvedValue([
      makeProduct(1, 6),
      makeProduct(21, 4, { price: 9, salePrice: 8, minPrice: 9, maxPrice: 9 }),
    ]);
    createMock.mockResolvedValue(makeParentWithChild());
  });

  describe('verifyCheckout (V-1)', () => {
    it('calcula impuesto y envío con las 5 claves del contrato en su orden', async () => {
      const verified = await service.verifyCheckout({
        amount: 10,
        products: [
          { product_id: 1, order_quantity: 2, unit_price: 1.6, subtotal: 3.2 },
        ],
        shipping_address: DIR,
      } as CheckoutVerificationDto);
      expect(Object.keys(verified)).toEqual([
        'total_tax',
        'shipping_charge',
        'unavailable_products',
        'wallet_currency',
        'wallet_amount',
      ]);
      expect(verified).toEqual({
        total_tax: 0.064,
        shipping_charge: 50,
        unavailable_products: [],
        wallet_currency: 0,
        wallet_amount: 0,
      });
      expect(taxMock).toHaveBeenCalledWith(1);
      expect(shippingMock).toHaveBeenCalledWith(1);
    });

    it('sin dirección no hay envío; con stock corto, el producto sale en unavailable_products', async () => {
      const verified = await service.verifyCheckout({
        amount: 10,
        products: [
          {
            product_id: 1,
            order_quantity: 99,
            unit_price: 1.6,
            subtotal: 158.4,
          },
        ],
      } as CheckoutVerificationDto);
      expect(verified).toMatchObject({
        total_tax: 0,
        shipping_charge: 0,
        unavailable_products: [1],
      });
    });
  });

  describe('create (V-2)', () => {
    it('totales del servidor, una hija por tienda, snapshot del producto y estados de COD', async () => {
      userMock.mockResolvedValue({
        id: 2,
        name: 'Customer',
        email: 'customer@demo.com',
        isActive: true,
        emailVerifiedAt: null,
        createdAt: CREATED,
        updatedAt: CREATED,
      });
      const order = await service.create(orderDto(), 2);
      const input = createMock.mock.calls[0][0];
      expect(input).toMatchObject({
        customerId: 2,
        amount: '19.2',
        salesTax: '0.384',
        deliveryFee: '50',
        discount: '0',
        total: '69.584',
        couponId: null,
        paymentGateway: 'CASH_ON_DELIVERY',
        orderStatus: 'order-processing',
        paymentStatus: 'payment-cash-on-delivery',
        customerName: 'Customer',
      });
      expect(Object.keys(input.customerSnapshot as object)).toHaveLength(9);
      expect(
        input.lines.map((l) => [l.productId, l.unitPrice, l.subtotal]),
      ).toEqual([
        [1, '1.6', '3.2'],
        [21, '8', '16'],
      ]);
      expect(
        input.children.map((c) => [c.shopId, c.amount, c.lines.length]),
      ).toEqual([
        [6, '3.2', 1],
        [4, '16', 1],
      ]);
      const snapshot = input.lines[0].productSnapshot as Record<
        string,
        unknown
      >;
      expect(Object.keys(snapshot)).toHaveLength(44);
      expect(Object.keys(snapshot).slice(-2)).toEqual([
        'translated_languages',
        'variation_options',
      ]);
      expect(snapshot).toMatchObject({
        id: 1,
        quantity: 16,
        sold_quantity: 2,
        price: 2,
        sale_price: 1.6,
      });
      expect(Object.keys(order).slice(-2)).toEqual([
        'children',
        'payment_intent',
      ]);
      expect(order.payment_intent).toBeNull();
    });

    it('invitado: sin usuario, customer_id y snapshot nulos', async () => {
      await service.create(orderDto(), null);
      expect(createMock.mock.calls[0][0]).toMatchObject({
        customerId: null,
        customerSnapshot: null,
      });
      expect(userMock).not.toHaveBeenCalled();
    });

    it('cupón vigente descuenta; inexistente o vencido ⇒ 422 sin escribir', async () => {
      couponMock.mockResolvedValueOnce(makeCoupon());
      await service.create(orderDto({ coupon_id: 9 }), null);
      expect(createMock.mock.calls[0][0]).toMatchObject({
        couponId: 9,
        discount: '5',
        total: '64.584',
      });

      couponMock.mockResolvedValueOnce(
        makeCoupon({ expireAt: new Date('2021-01-01T00:00:00.000Z') }),
      );
      await expect(
        service.create(orderDto({ coupon_id: 9 }), null),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      couponMock.mockResolvedValueOnce(null);
      await expect(
        service.create(orderDto({ coupon_id: 77 }), null),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    it('stock insuficiente ⇒ 422 con la lista; carrera en la transacción ⇒ 409', async () => {
      const rejection = service.create(
        orderDto({
          products: [
            { product_id: 1, order_quantity: 99, unit_price: 1.6, subtotal: 1 },
          ],
        }),
        null,
      );
      await expect(rejection).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      await rejection.catch((error: UnprocessableEntityException) => {
        expect(error.getResponse()).toMatchObject({
          statusCode: 422,
          unavailable_products: [1],
        });
      });
      expect(createMock).not.toHaveBeenCalled();

      createMock.mockRejectedValueOnce(new InsufficientStockError(1));
      await expect(service.create(orderDto(), null)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('FULL_WALLET_PAYMENT ⇒ 422 (V-5); pasarela desconocida ⇒ 400; sin productos ⇒ 400', async () => {
      await expect(
        service.create(
          orderDto({
            payment_gateway: 'FULL_WALLET_PAYMENT',
          } as Partial<CreateOrderDto>),
          null,
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      await expect(
        service.create(
          orderDto({
            payment_gateway: 'ZZ',
          } as unknown as Partial<CreateOrderDto>),
          null,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create(orderDto({ products: [] }), null),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(createMock).not.toHaveBeenCalled();
    });

    it('STRIPE: estados pendientes y payment_intent del mock permanente (o null si la pasarela falla)', async () => {
      const order = await service.create(
        orderDto({ payment_gateway: 'STRIPE' } as Partial<CreateOrderDto>),
        null,
      );
      expect(createMock.mock.calls[0][0]).toMatchObject({
        orderStatus: 'order-pending',
        paymentStatus: 'payment-pending',
      });
      expect(order).toHaveProperty('payment_intent', null);
    });
  });

  describe('update / remove (V-7)', () => {
    it('update pasa order_status y payment_status al repositorio y devuelve la orden', async () => {
      statusMock.mockResolvedValue(makeParentWithChild());
      const order = await service.update(48, {
        order_status: 'order-completed',
      } as UpdateOrderDto);
      expect(statusMock).toHaveBeenCalledWith(48, {
        orderStatus: 'order-completed',
      });
      expect(order.id).toBe(48);
    });

    it('update sin estado o con id inválido ⇒ 400; inexistente ⇒ 404', async () => {
      await expect(
        service.update(48, {} as UpdateOrderDto),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.update(Number.NaN, {
          order_status: 'order-completed',
        } as UpdateOrderDto),
      ).rejects.toBeInstanceOf(BadRequestException);
      statusMock.mockRejectedValue(new RecordNotFoundError('orders', 999));
      await expect(
        service.update(999, {
          order_status: 'order-completed',
        } as UpdateOrderDto),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('remove devuelve el snapshot; inexistente ⇒ 404', async () => {
      deleteMock.mockResolvedValueOnce(makeParentWithChild());
      expect((await service.remove(48)).id).toBe(48);
      deleteMock.mockRejectedValueOnce(new RecordNotFoundError('orders', 999));
      await expect(service.remove(999)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('pay (V-8)', () => {
    it('STRIPE marca la orden pedida; inexistente ⇒ 404', async () => {
      findMock.mockResolvedValueOnce(
        makeOrder({
          paymentGateway: 'STRIPE',
          trackingNumber: '20261023000001',
        }),
      );
      await service.pay(20261023000001);
      expect(findMock).toHaveBeenCalledWith('20261023000001');
      expect(paidMock).toHaveBeenCalledWith('20261023000001');
      findMock.mockResolvedValueOnce(null);
      await expect(service.pay('00000000000000')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('PAYPAL sin intento en el mock ⇒ 422 sin marcar; con intento, verifica y marca', async () => {
      findMock.mockResolvedValueOnce(
        makeOrder({
          paymentGateway: 'PAYPAL',
          trackingNumber: '20261023000002',
        }),
      );
      await expect(service.pay('20261023000002')).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(paidMock).not.toHaveBeenCalled();

      findMock.mockResolvedValueOnce(
        makeOrder({ paymentGateway: 'PAYPAL', trackingNumber: '334983046149' }),
      );
      await service.pay('334983046149');
      expect(verifyOrder).toHaveBeenCalledTimes(1);
      expect(paidMock).toHaveBeenCalledWith('334983046149');
    });

    it('otras pasarelas: sin cambio', async () => {
      findMock.mockResolvedValueOnce(
        makeOrder({ paymentGateway: 'CASH_ON_DELIVERY' }),
      );
      await service.pay('20240207303639');
      expect(paidMock).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// Descargas, export e invoice (US-60)
// ---------------------------------------------------------------------------

const filesMock = vi.mocked(listOrderFilesByCustomer);
const firstFileMock = vi.mocked(findFirstOrderFileByDigitalFileId);

const FILE = {
  id: 42,
  attachment_id: 1512,
  url: 'https://pickbazarlaravel.s3.ap-southeast-1.amazonaws.com/1512/DOCUMENTATION.pdf',
  fileable_type: 'Marvel\\Database\\Models\\Product',
  fileable_id: 888,
  created_at: '2021-12-18T13:58:54.000000Z',
  updated_at: '2021-12-18T13:58:54.000000Z',
  fileable: { id: 888 },
};

function makeOrderFile(
  overrides: Partial<OrderFileRecord> = {},
): OrderFileRecord {
  return {
    id: 4,
    purchaseKey: 'abcdefghijklmnop',
    digitalFileId: 42,
    orderId: null,
    customerId: 2,
    file: FILE,
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  };
}

describe('OrdersService — descargas, export e invoice', () => {
  let service: OrdersService;
  let controller: OrderFilesController;

  beforeEach(async () => {
    vi.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [OrderFilesController],
      providers: [
        OrdersService,
        { provide: AuthService, useValue: {} },
        { provide: StripePaymentService, useValue: {} },
        { provide: PaypalPaymentService, useValue: {} },
        { provide: JwtService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(OrdersService);
    controller = moduleRef.get(OrderFilesController);
  });

  it('GET /downloads: las 8 claves del mock en orden, file tal cual, default limit 30 y url ?&limit=', async () => {
    filesMock.mockResolvedValue({ items: [makeOrderFile()], total: 1 });
    const page = await service.getOrderFileItems({} as GetOrderFilesDto, 2);
    expect(filesMock).toHaveBeenCalledWith(2, { page: 1, limit: 30 });
    expect(Object.keys(page.data[0])).toEqual([
      'id',
      'purchase_key',
      'digital_file_id',
      'order_id',
      'customer_id',
      'created_at',
      'updated_at',
      'file',
    ]);
    expect(page.data[0].file).toBe(FILE);
    expect(page.first_page_url).toContain('/downloads?&limit=30&page=1');
  });

  it('CA-3: el controlador pasa el sub del token, nunca un customer_id de la query', async () => {
    filesMock.mockResolvedValue({ items: [], total: 0 });
    const query = {
      limit: '10',
      customer_id: '2',
    } as unknown as GetOrderFilesDto;
    const page = await controller.getOrderFileItems(query, ADMIN_USER);
    expect(filesMock).toHaveBeenCalledWith(ADMIN_USER.sub, {
      page: 1,
      limit: 10,
    });
    expect(page).toMatchObject({ data: [], total: 0, per_page: '10' });
  });

  it('digital_file: la url del primer match del usuario como string; inexistente, ajeno o id inválido ⇒ 404', async () => {
    firstFileMock.mockResolvedValueOnce(makeOrderFile());
    expect(await controller.getDigitalFileDownloadUrl(42, CUSTOMER_USER)).toBe(
      FILE.url,
    );
    expect(firstFileMock).toHaveBeenCalledWith(42, CUSTOMER_USER.sub);

    firstFileMock.mockResolvedValueOnce(null);
    await expect(
      service.getDigitalFileDownloadUrl(999, 2),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.getDigitalFileDownloadUrl(1e21, 2),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(firstFileMock).toHaveBeenCalledTimes(2);
  });

  it('export e invoice devuelven las URLs constantes del mock permanente', async () => {
    expect(await service.exportOrder('1')).toBe(ORDER_EXPORT_URL);
    expect(await service.downloadInvoiceUrl('1')).toBe(ORDER_INVOICE_URL);
    expect(ORDER_EXPORT_URL).toBe(
      'https://pickbazarlaravel.s3.ap-southeast-1.amazonaws.com/100/orders.xlsx',
    );
    expect(ORDER_INVOICE_URL).toBe(
      'https://pickbazarlaravel.s3.ap-southeast-1.amazonaws.com/100/invoice-order.pdf',
    );
  });
});
