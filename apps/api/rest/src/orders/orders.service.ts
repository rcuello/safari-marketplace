import paymentGatewayJson from '#db/payment-gateway.json';
import paymentIntentJson from '#db/payment-intent.json';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
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
  getUserFriendlyMessage,
  isPrismaConnectionError,
  listOrderFilesByCustomer,
  listOrders,
  markOrderPaid,
  setOrderStatus,
  Decimal,
  type CouponRecord,
  type ListOrdersInput,
  type OrderDetailRecord,
  type OrderFileRecord,
  type OrderLineInput,
  type Prisma,
  type ProductRecord,
} from '@safari/db';
import { plainToClass } from 'class-transformer';
import { toWriteHttpException } from '#src/common/errors/domain-error.mapper.js';
import { AuthService } from '#src/auth/auth.service.js';
import { ADMIN_OWNER_AND_STAFF } from '#src/auth/decorators/permissions.decorator.js';
import { CurrentUserPayload } from '#src/auth/decorators/current-user.decorator.js';
import { paginate } from '#src/common/pagination/paginate.js';
import { parseSearch } from '#src/common/search/parse-search.js';
import { PaymentIntent } from '#src/payment-intent/entries/payment-intent.entity.js';
import { PaymentGateWay } from '#src/payment-method/entities/payment-gateway.entity.js';
import { PaypalPaymentService } from '#src/payment/paypal-payment.service.js';
import { StripePaymentService } from '#src/payment/stripe-payment.service.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { GetOrderFilesDto, OrderFilesPaginator } from './dto/get-downloads.dto.js';
import { GetOrdersDto, OrderPaginator } from './dto/get-orders.dto.js';
import { UpdateOrderDto } from './dto/update-order.dto.js';
import {
  CheckoutVerificationDto,
  VerifiedCheckoutData,
} from './dto/verify-checkout.dto.js';
import {
  Order,
  OrderFiles,
  OrderStatusType,
  PaymentGatewayType,
  PaymentStatusType,
} from './entities/order.entity.js';
import { toOrderDto } from './order-dto.mapper.js';
import {
  hasAddress,
  isCouponApplicable,
  priceOrder,
  type PricingInput,
} from './orders-pricing.js';
import { toReviewUserDto } from '#src/reviews/review-dto.mapper.js';

// payment-intent.json y payment-gateway.json son el mock permanente de la
// pasarela (decisión 2 del Épico 46): siguen aquí a propósito.
const paymentIntents = plainToClass(PaymentIntent, paymentIntentJson);
const _paymentGateways = plainToClass(PaymentGateWay, paymentGatewayJson);

const TRACKING_NUMBER = /^[0-9]{14}$/;

/** Admin, dueño o staff ven todas las órdenes; el resto, solo las suyas. */
function canSeeAllOrders(user: CurrentUserPayload): boolean {
  return ADMIN_OWNER_AND_STAFF.some((permission) =>
    user.permissions.includes(permission),
  );
}

/** Un id de la query; ausente ⇒ undefined; mal formado ⇒ null (no casa con nada). */
function toIdFilter(raw: unknown): number | null | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Pasarelas que piden un `payment_intent` a la pasarela (mock permanente). */
const INTENT_GATEWAYS: string[] = [
  PaymentGatewayType.STRIPE,
  PaymentGatewayType.PAYPAL,
  PaymentGatewayType.RAZORPAY,
];

/** Las 43 claves Laravel del producto de una línea, en el orden del mock de órdenes. */
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
] as const;

/**
 * El producto en el momento de la compra, con la forma de las líneas
 * sembradas: las 43 claves (`null` las que no tienen columna) más
 * `variation_options`. Se toma ANTES de descontar el stock, como en el mock.
 */
function toProductSnapshot(p: ProductRecord): Prisma.InputJsonValue {
  const known: Record<string, unknown> = {
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    type_id: p.typeId,
    price: p.price,
    shop_id: p.shopId,
    sale_price: p.salePrice,
    language: p.language,
    min_price: p.minPrice,
    max_price: p.maxPrice,
    sku: p.sku,
    quantity: p.quantity,
    sold_quantity: p.soldQuantity,
    in_stock: Number(p.inStock),
    is_taxable: Number(p.isTaxable),
    in_flash_sale: 0,
    status: p.status,
    product_type: p.productType,
    unit: p.unit,
    image: p.image,
    gallery: p.gallery,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
    manufacturer_id: p.manufacturer?.id ?? null,
    is_digital: Number(p.isDigital),
    is_external: Number(p.isExternal),
    external_product_url: p.externalProductUrl,
    ratings: p.ratings,
    total_reviews: p.totalReviews,
    in_wishlist: false,
    translated_languages: p.translatedLanguages,
  };
  const snapshot: Record<string, unknown> = {};
  for (const key of SNAPSHOT_KEYS) snapshot[key] = known[key] ?? null;
  snapshot.variation_options = [];
  return snapshot as Prisma.InputJsonValue;
}

/** Estados iniciales según la pasarela (el `switch` del mock, R-h). */
function initialStatuses(gateway: string): {
  orderStatus: string;
  paymentStatus: string;
} {
  switch (gateway) {
    case PaymentGatewayType.CASH_ON_DELIVERY:
      return {
        orderStatus: OrderStatusType.PROCESSING,
        paymentStatus: PaymentStatusType.CASH_ON_DELIVERY,
      };
    case PaymentGatewayType.CASH:
      return {
        orderStatus: OrderStatusType.PROCESSING,
        paymentStatus: PaymentStatusType.CASH,
      };
    default:
      return {
        orderStatus: OrderStatusType.PENDING,
        paymentStatus: PaymentStatusType.PENDING,
      };
  }
}

/** Un id de ruta: `abc`, `0` o `1e21` ⇒ 400 sin tocar la base (R-l). */
function assertOrderId(id: number): void {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new BadRequestException(`\`${id}\` no es un id de orden.`);
  }
}

function unprocessable(
  message: string,
  extra: Record<string, unknown> = {},
): UnprocessableEntityException {
  return new UnprocessableEntityException({
    statusCode: 422,
    message,
    error: 'Unprocessable Entity',
    ...extra,
  });
}

const money = (value: Decimal): string => value.toString();

/**
 * Mock permanente declarado (US-60): export e invoice devuelven las URLs S3
 * de la demo de Pickbazar. No se genera ningún Excel ni PDF; antes salían de
 * los JSON del mock y ahora son constantes, con el mismo valor.
 */
export const ORDER_EXPORT_URL =
  'https://pickbazarlaravel.s3.ap-southeast-1.amazonaws.com/100/orders.xlsx';
export const ORDER_INVOICE_URL =
  'https://pickbazarlaravel.s3.ap-southeast-1.amazonaws.com/100/invoice-order.pdf';

/**
 * `OrderFileRecord` → las 8 claves del mock de descargas, en su orden. `file`
 * sale tal cual de la columna `json`, con su orden de claves y sus fechas
 * de 6 decimales (V-3): no pasa por ningún objeto intermedio.
 */
function toOrderFileDto(record: OrderFileRecord): OrderFiles {
  return {
    id: record.id,
    purchase_key: record.purchaseKey,
    digital_file_id: record.digitalFileId,
    order_id: record.orderId,
    customer_id: record.customerId,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    file: record.file,
  } as unknown as OrderFiles;
}

function readError(error: unknown): never {
  if (isPrismaConnectionError(error)) {
    throw new ServiceUnavailableException(getUserFriendlyMessage(error));
  }
  throw new InternalServerErrorException(getUserFriendlyMessage(error));
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly authService: AuthService,
    private readonly stripeService: StripePaymentService,
    private readonly paypalService: PaypalPaymentService,
  ) {}
  /**
   * Carga lo que el cálculo necesita: los productos vivos del carrito, el
   * impuesto y el envío de `settings` (`taxClass`/`shippingClass` son
   * strings) y la configuración de envío gratis.
   */
  private async pricingContext(
    lines: CreateOrderDto['products'],
    shippingAddress: unknown,
  ): Promise<
    Omit<PricingInput, 'coupon'> & {
      productRows: ProductRecord[];
      options: Record<string, unknown>;
    }
  > {
    try {
      const ids = [
        ...new Set(
          (lines ?? [])
            .map((l) => Number(l.product_id))
            .filter(Number.isSafeInteger),
        ),
      ];
      const settings = await getSettings();
      const options = (settings?.options ?? {}) as Record<string, unknown>;
      const [productRows, tax, shipping] = await Promise.all([
        findProductsForOrder(ids),
        findTaxById(Number(options.taxClass)),
        findShippingById(Number(options.shippingClass)),
      ]);
      return {
        lines: lines ?? [],
        products: new Map(productRows.map((p) => [p.id, p])),
        productRows,
        tax,
        shipping,
        settings: {
          freeShipping: Boolean(options.freeShipping),
          freeShippingAmount: Number(options.freeShippingAmount) || 0,
        },
        hasShippingAddress: hasAddress(shippingAddress),
        options,
      };
    } catch (error) {
      readError(error);
    }
  }

  /**
   * `checkout/verify` (V-1): lee el body y calcula con R-a a R-d, las mismas
   * reglas que `POST /orders`. Sin cupón: el shop lo aplica después.
   */
  async verifyCheckout(
    input: CheckoutVerificationDto,
  ): Promise<VerifiedCheckoutData> {
    const context = await this.pricingContext(
      input?.products ?? [],
      input?.shipping_address,
    );
    const priced = priceOrder({ ...context, coupon: null });
    return {
      total_tax: priced.salesTax.toNumber(),
      shipping_charge: priced.deliveryFee.toNumber(),
      unavailable_products: priced.unavailable,
      wallet_currency: 0,
      wallet_amount: 0,
    };
  }

  /**
   * Cupón de R-e: `coupon_id` ausente o `null` (el shop manda `Number(undefined)`,
   * que viaja como `null`) ⇒ sin cupón. Inexistente o no aplicable ⇒ 422.
   */
  private async couponFor(
    rawId: unknown,
    amount: Decimal,
    shopIds: number[],
  ): Promise<CouponRecord | null> {
    if (rawId === undefined || rawId === null || rawId === '') return null;
    const id = Number(rawId);
    let coupon: CouponRecord | null = null;
    if (Number.isSafeInteger(id) && id > 0) {
      try {
        coupon = await findCouponById(id);
      } catch (error) {
        readError(error);
      }
    }
    if (
      !coupon ||
      !isCouponApplicable(coupon, { amount, shopIds, at: new Date() })
    ) {
      throw unprocessable('error-invalid-coupon', { coupon_id: rawId });
    }
    return coupon;
  }

  /** R-i: el usuario del token, en la forma de 9 claves del `customer` del mock. */
  private async customerFor(userId: number | null) {
    if (userId === null) return { customerId: null, customerSnapshot: null };
    let user;
    try {
      user = await findUserById(userId);
    } catch (error) {
      readError(error);
    }
    if (!user) return { customerId: null, customerSnapshot: null };
    const snapshot = JSON.parse(
      JSON.stringify(toReviewUserDto(user, { withEmailVerified: true })),
    );
    return {
      customerId: user.id,
      customerSnapshot: snapshot as Prisma.InputJsonValue,
    };
  }

  /**
   * `POST /orders` (V-2): crea el padre, una hija por tienda y sus líneas, y
   * descuenta el stock, en una transacción (R-g/R-k). Precios, impuesto,
   * envío, cupón y totales los calcula el servidor (R-b a R-f); las cifras
   * del cliente solo se comparan y, si difieren, se registra un `warn`.
   * `userId` es el `sub` de un Bearer válido, o `null` para el invitado.
   */
  async create(dto: CreateOrderDto, userId: number | null): Promise<Order> {
    const gateway = dto.payment_gateway ?? PaymentGatewayType.CASH_ON_DELIVERY;
    if (!(Object.values(PaymentGatewayType) as string[]).includes(gateway)) {
      throw new BadRequestException(
        `payment_gateway \`${gateway}\` no existe.`,
      );
    }
    if (gateway === PaymentGatewayType.FULL_WALLET_PAYMENT) {
      // V-5: los wallets siguen fuera del épico (decisión 4).
      throw unprocessable(
        'FULL_WALLET_PAYMENT no está disponible: no hay wallets.',
      );
    }
    if (!Array.isArray(dto.products) || dto.products.length === 0) {
      throw new BadRequestException('La orden no trae productos.');
    }

    const context = await this.pricingContext(
      dto.products,
      dto.shipping_address,
    );
    const withoutCoupon = priceOrder({ ...context, coupon: null });
    if (withoutCoupon.unavailable.length > 0) {
      throw unprocessable('Hay productos no disponibles.', {
        unavailable_products: withoutCoupon.unavailable,
      });
    }
    const shopIds = [...new Set(withoutCoupon.lines.map((l) => l.shopId))];
    const coupon = await this.couponFor(
      dto.coupon_id,
      withoutCoupon.amount,
      shopIds,
    );
    const priced = coupon ? priceOrder({ ...context, coupon }) : withoutCoupon;
    this.warnOnClientTotals(dto, priced);

    const rowsById = new Map(context.productRows.map((p) => [p.id, p]));
    const toLine = (l: (typeof priced.lines)[number]): OrderLineInput => ({
      productId: l.productId,
      variationOptionId: l.variationOptionId,
      orderQuantity: l.orderQuantity,
      unitPrice: money(l.unitPrice),
      subtotal: money(l.subtotal),
      productSnapshot: toProductSnapshot(rowsById.get(l.productId)),
    });
    const lines = priced.lines.map(toLine);
    const children = shopIds.map((shopId) => {
      const own = priced.lines.filter((l) => l.shopId === shopId);
      return {
        shopId,
        amount: money(
          own.reduce((sum, l) => sum.plus(l.subtotal), new Decimal(0)),
        ),
        lines: own.map(toLine),
      };
    });

    let record: OrderDetailRecord;
    try {
      record = await createOrderWithChildren({
        ...(await this.customerFor(userId)),
        customerContact: dto.customer_contact ?? null,
        customerName: dto.customer_name ?? null,
        amount: money(priced.amount),
        salesTax: money(priced.salesTax),
        deliveryFee: money(priced.deliveryFee),
        discount: money(priced.discount),
        total: money(priced.total),
        note: dto.note ?? null,
        deliveryTime: dto.delivery_time ?? null,
        ...(dto.language !== undefined && { language: dto.language }),
        couponId: coupon?.id ?? null,
        paymentGateway: gateway,
        ...initialStatuses(gateway),
        shippingAddress: hasAddress(dto.shipping_address)
          ? (dto.shipping_address as unknown as Prisma.InputJsonValue)
          : [],
        billingAddress: hasAddress(dto.billing_address)
          ? (dto.billing_address as unknown as Prisma.InputJsonValue)
          : [],
        lines,
        children,
      });
    } catch (error) {
      throw toWriteHttpException(error);
    }

    const order = toOrderDto(record);
    let paymentIntent: PaymentIntent | null = null;
    if (INTENT_GATEWAYS.includes(gateway)) {
      try {
        paymentIntent = await this.processPaymentIntent(
          order,
          context.options.paymentGateway,
        );
      } catch (error) {
        // Mismo criterio que el mock: si la pasarela falla, la orden queda
        // creada y sin payment_intent.
        this.logger.warn(
          `payment_intent de ${record.trackingNumber}: ${String(error)}`,
        );
      }
    }
    return { ...order, payment_intent: paymentIntent } as Order;
  }

  /** R-f: las cifras del cliente no mandan, pero un desfase queda registrado. */
  private warnOnClientTotals(
    dto: CreateOrderDto,
    priced: ReturnType<typeof priceOrder>,
  ): void {
    const pairs: [string, unknown, Decimal][] = [
      ['amount', dto.amount, priced.amount],
      ['sales_tax', dto.sales_tax, priced.salesTax],
      ['delivery_fee', dto.delivery_fee, priced.deliveryFee],
      ['discount', dto.discount, priced.discount],
      ['total', dto.total, priced.total],
      ['paid_total', dto.paid_total, priced.total],
    ];
    for (const [field, sent, computed] of pairs) {
      if (sent === undefined || sent === null) continue;
      if (!computed.equals(Number(sent))) {
        this.logger.warn(
          `${field}: el cliente mandó ${sent}, el servidor calculó ${computed.toString()}`,
        );
      }
    }
  }

  /**
   * Sin `shop_id` ni búsqueda, solo padres (con su hija embebida). `shop_id`
   * da las hijas de esa tienda (V-2) y `search=tracking_number:X` la orden
   * exacta (V-3). `customer_id` se obedece siempre: el controlador lo fija
   * al usuario del token cuando no tiene rol de tienda (V-1). Un id mal
   * formado no casa con nada.
   */
  async getOrders({
    limit,
    page,
    customer_id,
    search,
    shop_id,
  }: GetOrdersDto): Promise<OrderPaginator> {
    if (!page) page = 1;
    if (!limit) limit = 15;
    const url = `/orders?search=${search}&limit=${limit}`;

    const customerId = toIdFilter(customer_id);
    const shopId = toIdFilter(shop_id === 'undefined' ? undefined : shop_id);
    if (customerId === null || shopId === null) {
      return { data: [], ...paginate(0, page, limit, 0, url) };
    }
    const input: ListOrdersInput = {
      customerId,
      shopId,
      trackingNumber: parseSearch(search).tracking_number,
      page: Number(page) || 1,
      limit: Number(limit) || 15,
    };

    let result: { items: OrderDetailRecord[]; total: number };
    try {
      result = await listOrders(input);
    } catch (error) {
      readError(error);
    }
    const data = result.items.map(toOrderDto);
    return { data, ...paginate(result.total, page, limit, data.length, url) };
  }

  /**
   * `:id` es un id o un `tracking_number` de 14 dígitos (el shop pide el
   * detalle por tracking a través de esta ruta). Ningún id real tiene 14
   * dígitos (`bigserial`, hoy en 49); si algún día los tuviera, esta regla
   * lo leería como tracking. Otro formato ⇒ 400.
   */
  async getOrder(param: string, user: CurrentUserPayload): Promise<Order> {
    if (TRACKING_NUMBER.test(param)) {
      return this.findVisibleOrder(param, user);
    }
    const id = Number(param);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new BadRequestException(
        `\`${param}\` no es un id ni un número de seguimiento.`,
      );
    }
    return this.findVisibleOrder(id, user);
  }

  async getOrderByTrackingNumber(
    trackingNumber: string,
    user: CurrentUserPayload,
  ): Promise<Order> {
    return this.findVisibleOrder(String(trackingNumber), user);
  }

  /**
   * Inexistente u orden ajena para un usuario sin rol de tienda ⇒ 404 (V-4):
   * un 403 revelaría que la orden existe.
   */
  private async findVisibleOrder(
    idOrTracking: number | string,
    user: CurrentUserPayload,
  ): Promise<Order> {
    let record: OrderDetailRecord | null;
    try {
      record = await findOrderByIdOrTracking(idOrTracking);
    } catch (error) {
      readError(error);
    }
    if (!record || (!canSeeAllOrders(user) && record.customerId !== user.sub)) {
      throw new NotFoundException(`No existe la orden ${idOrTracking}.`);
    }
    return toOrderDto(record);
  }

  /**
   * R-l (V-7): `order_status` y/o `payment_status`, ya validados por el DTO
   * (V-9). En un padre se propaga a sus hijas. Devuelve la orden completa.
   */
  async update(id: number, dto: UpdateOrderDto): Promise<Order> {
    assertOrderId(id);
    if (dto.order_status === undefined && dto.payment_status === undefined) {
      throw new BadRequestException(
        'Nada que cambiar: falta order_status o payment_status.',
      );
    }
    try {
      return toOrderDto(
        await setOrderStatus(id, {
          ...(dto.order_status !== undefined && {
            orderStatus: dto.order_status,
          }),
          ...(dto.payment_status !== undefined && {
            paymentStatus: dto.payment_status,
          }),
        }),
      );
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /** R-m (V-7): devuelve el snapshot previo. No repone stock. */
  async remove(id: number): Promise<Order> {
    assertOrderId(id);
    try {
      return toOrderDto(await deleteOrder(id));
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /**
   * R-n (V-8): marca la orden pedida, y no la 48. `STRIPE` pasa a
   * `order-processing` + `payment-success` con sus hijas; `PAYPAL` antes
   * verifica con la pasarela el `payment_id` del intento (que vive en el mock
   * permanente `payment-intent.json`: no se persiste); sin intento, 422 y sin
   * cambios. Otras pasarelas: sin cambio.
   */
  async pay(trackingNumber: unknown): Promise<void> {
    let record: OrderDetailRecord | null;
    try {
      record = await findOrderByIdOrTracking(String(trackingNumber));
    } catch (error) {
      readError(error);
    }
    if (!record) {
      throw new NotFoundException(`No existe la orden ${trackingNumber}.`);
    }
    switch (record.paymentGateway) {
      case PaymentGatewayType.STRIPE:
        break;
      case PaymentGatewayType.PAYPAL: {
        const intent = paymentIntents.find(
          (i) => i.tracking_number === record.trackingNumber,
        );
        if (!intent) {
          throw unprocessable(
            'No hay un intento de pago de PayPal que verificar para esta orden.',
          );
        }
        await this.paypalService.verifyOrder(
          intent.payment_intent_info.payment_id,
        );
        break;
      }
      default:
        return;
    }
    try {
      await markOrderPaid(record.trackingNumber);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /**
   * Las descargas del usuario del token (V-1), también para el admin: es la
   * página «mis descargas» del shop. `orderBy`/`sortedBy` se ignoran, como
   * en el mock. La url conserva el literal `?&limit=`.
   */
  async getOrderFileItems(
    { page, limit }: GetOrderFilesDto,
    customerId: number,
  ): Promise<OrderFilesPaginator> {
    if (!page) page = 1;
    if (!limit) limit = 30;
    const url = `/downloads?&limit=${limit}`;

    let result: { items: OrderFileRecord[]; total: number };
    try {
      result = await listOrderFilesByCustomer(customerId, {
        page: Number(page) || 1,
        limit: Number(limit) || 30,
      });
    } catch (error) {
      readError(error);
    }
    const data = result.items.map(toOrderFileDto);
    return { data, ...paginate(result.total, page, limit, data.length, url) };
  }

  /**
   * URL del archivo como string desnudo: la primera descarga (por id) del
   * usuario del token con ese `digital_file_id`. Inexistente o ajena ⇒ 404
   * (V-2; el mock daba 500).
   */
  async getDigitalFileDownloadUrl(
    digitalFileId: number,
    customerId: number,
  ): Promise<string> {
    if (!Number.isSafeInteger(digitalFileId) || digitalFileId <= 0) {
      throw new NotFoundException(
        `No tienes una descarga con digital_file_id ${digitalFileId}.`,
      );
    }
    let record: OrderFileRecord | null;
    try {
      record = await findFirstOrderFileByDigitalFileId(
        digitalFileId,
        customerId,
      );
    } catch (error) {
      readError(error);
    }
    const url = (record?.file as { url?: unknown } | undefined)?.url;
    if (typeof url !== 'string') {
      throw new NotFoundException(
        `No tienes una descarga con digital_file_id ${digitalFileId}.`,
      );
    }
    return url;
  }

  async exportOrder(_shop_id: string) {
    return ORDER_EXPORT_URL;
  }

  async downloadInvoiceUrl(_shop_id: string) {
    return ORDER_INVOICE_URL;
  }

  /**
   * helper methods from here
   */

  /**
   * This action will return Payment Intent. Mock permanente de la pasarela
   * (decisión 2): `configuredGateway` es `settings.options.paymentGateway`,
   * hoy leído de Postgres (`getSettings()`) en vez del JSON del mock.
   * @param order
   * @param configuredGateway
   */
  async processPaymentIntent(
    order: Order,
    configuredGateway: unknown,
  ): Promise<PaymentIntent> {
    const paymentIntent = paymentIntents.find(
      (intent: PaymentIntent) =>
        intent.tracking_number === order.tracking_number &&
        intent.payment_gateway.toString().toLowerCase() ===
          String(configuredGateway).toLowerCase(),
    );
    if (paymentIntent) {
      return paymentIntent;
    }
    const {
      id: payment_id,
      client_secret = null,
      redirect_url = null,
      customer: _customer = null,
    } = await this.savePaymentIntent(order, order.payment_gateway);
    const is_redirect = redirect_url ? true : false;
    const paymentIntentInfo: PaymentIntent = {
      id: Number(Date.now()),
      order_id: order.id,
      tracking_number: order.tracking_number,
      payment_gateway: order.payment_gateway.toString().toLowerCase(),
      payment_intent_info: {
        client_secret,
        payment_id,
        redirect_url,
        is_redirect,
      },
    };

    /**
     * Commented below code will work for real database.
     * if you uncomment this for json will arise conflict.
     */

    // paymentIntents.push(paymentIntentInfo);
    // const paymentGateway: PaymentGateWay = {
    //   id: Number(Date.now()),
    //   user_id: this.authService.me().id,
    //   customer_id: _customer,
    //   gateway_name: setting.options.paymentGateway,
    //   created_at: new Date(),
    //   updated_at: new Date(),
    // };
    // _paymentGateways.push(paymentGateway);

    return paymentIntentInfo;
  }

  /**
   * Trailing method of ProcessPaymentIntent Method
   *
   * @param order
   * @param paymentGateway
   */
  async savePaymentIntent(
    order: Order,
    _paymentGateway?: string,
  ): Promise<any> {
    // Ripple no anticipado por US-22: `me()` deja de aceptar llamadas sin
    // contexto de token (D-8 del proposal). Este método no tiene un
    // request/token disponible (se llama servicio-a-servicio, no desde un
    // controller), así que se usa `order.customer_id`, el único id de
    // usuario ya disponible en este alcance — no se hilvana un token nuevo
    // a través de la cadena de llamadas, fuera del alcance de esta US.
    const me = await this.authService.me(order.customer_id);
    switch (order.payment_gateway) {
      case PaymentGatewayType.STRIPE:
        const paymentIntentParam =
          await this.stripeService.makePaymentIntentParam(order, me);
        return await this.stripeService.createPaymentIntent(paymentIntentParam);
      case PaymentGatewayType.PAYPAL:
        // here goes PayPal
        return this.paypalService.createPaymentIntent(order);
        break;

      default:
        //
        break;
    }
  }
}
