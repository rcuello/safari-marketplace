import exportOrderJson from '@db/order-export.json';
import orderFilesJson from '@db/order-files.json';
import orderInvoiceJson from '@db/order-invoice.json';
import ordersJson from '@db/orders.json';
import paymentGatewayJson from '@db/payment-gateway.json';
import paymentIntentJson from '@db/payment-intent.json';
import setting from '@db/settings.json';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  findOrderByIdOrTracking,
  getUserFriendlyMessage,
  isPrismaConnectionError,
  listOrders,
  type ListOrdersInput,
  type OrderDetailRecord,
} from '@safari/db';
import { plainToClass } from 'class-transformer';
import { AuthService } from 'src/auth/auth.service';
import { ADMIN_OWNER_AND_STAFF } from 'src/auth/decorators/permissions.decorator';
import { CurrentUserPayload } from 'src/auth/decorators/current-user.decorator';
import { paginate } from 'src/common/pagination/paginate';
import { parseSearch } from 'src/common/search/parse-search';
import { PaymentIntent } from 'src/payment-intent/entries/payment-intent.entity';
import { PaymentGateWay } from 'src/payment-method/entities/payment-gateway.entity';
import { PaypalPaymentService } from 'src/payment/paypal-payment.service';
import { StripePaymentService } from 'src/payment/stripe-payment.service';
import { Setting } from 'src/settings/entities/setting.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { GetOrderFilesDto } from './dto/get-downloads.dto';
import { GetOrdersDto, OrderPaginator } from './dto/get-orders.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import {
  CheckoutVerificationDto,
  VerifiedCheckoutData,
} from './dto/verify-checkout.dto';
import {
  Order,
  OrderFiles,
  OrderStatusType,
  PaymentGatewayType,
  PaymentStatusType,
} from './entities/order.entity';
import { toOrderDto } from './order-dto.mapper';

// orders.json sigue cargado SOLO para las escrituras de US-59 (create,
// update, payment y los cambios de estado de stripePay/paypalPay), que aún
// operan sobre este array. Las lecturas (getOrders, getOrder,
// getOrderByTrackingNumber) van a Postgres desde US-58.
const orders = plainToClass(Order, ordersJson);
const paymentIntents = plainToClass(PaymentIntent, paymentIntentJson);
const paymentGateways = plainToClass(PaymentGateWay, paymentGatewayJson);
const orderFiles = plainToClass(OrderFiles, orderFilesJson);
const settings = plainToClass(Setting, setting);

const TRACKING_NUMBER = /^[0-9]{14}$/;

/** Admin, dueño o staff ven todas las órdenes; el resto, solo las suyas. */
function canSeeAllOrders(user: CurrentUserPayload): boolean {
  return ADMIN_OWNER_AND_STAFF.some((permission) => user.permissions.includes(permission));
}

/** Un id de la query; ausente ⇒ undefined; mal formado ⇒ null (no casa con nada). */
function toIdFilter(raw: unknown): number | null | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function readError(error: unknown): never {
  if (isPrismaConnectionError(error)) {
    throw new ServiceUnavailableException(getUserFriendlyMessage(error));
  }
  throw new InternalServerErrorException(getUserFriendlyMessage(error));
}

@Injectable()
export class OrdersService {
  private orders: Order[] = orders;
  private orderFiles: OrderFiles[] = orderFiles;
  private setting: Setting = { ...settings };

  constructor(
    private readonly authService: AuthService,
    private readonly stripeService: StripePaymentService,
    private readonly paypalService: PaypalPaymentService,
  ) {}
  async create(createOrderInput: CreateOrderDto): Promise<Order> {
    const order: Order = this.orders[0];
    const payment_gateway_type = createOrderInput.payment_gateway
      ? createOrderInput.payment_gateway
      : PaymentGatewayType.CASH_ON_DELIVERY;
    order.payment_gateway = payment_gateway_type;
    order.payment_intent = null;
    // set the order type and payment type

    switch (payment_gateway_type) {
      case PaymentGatewayType.CASH_ON_DELIVERY:
        order.order_status = OrderStatusType.PROCESSING;
        order.payment_status = PaymentStatusType.CASH_ON_DELIVERY;
        break;
      case PaymentGatewayType.CASH:
        order.order_status = OrderStatusType.PROCESSING;
        order.payment_status = PaymentStatusType.CASH;
        break;
      case PaymentGatewayType.FULL_WALLET_PAYMENT:
        order.order_status = OrderStatusType.COMPLETED;
        order.payment_status = PaymentStatusType.WALLET;
        break;
      default:
        order.order_status = OrderStatusType.PENDING;
        order.payment_status = PaymentStatusType.PENDING;
        break;
    }
    order.children = this.processChildrenOrder(order);
    try {
      if (
        [
          PaymentGatewayType.STRIPE,
          PaymentGatewayType.PAYPAL,
          PaymentGatewayType.RAZORPAY,
        ].includes(payment_gateway_type)
      ) {
        const paymentIntent = await this.processPaymentIntent(
          order,
          this.setting,
        );
        order.payment_intent = paymentIntent;
      }
      return order;
    } catch (error) {
      return order;
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
      throw new BadRequestException(`\`${param}\` no es un id ni un número de seguimiento.`);
    }
    return this.findVisibleOrder(id, user);
  }

  async getOrderByTrackingNumber(trackingNumber: string, user: CurrentUserPayload): Promise<Order> {
    return this.findVisibleOrder(String(trackingNumber), user);
  }

  /**
   * Inexistente u orden ajena para un usuario sin rol de tienda ⇒ 404 (V-4):
   * un 403 revelaría que la orden existe.
   */
  private async findVisibleOrder(idOrTracking: number | string, user: CurrentUserPayload): Promise<Order> {
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
   * `POST /orders/payment` sigue sobre el JSON hasta US-59: `stripePay` y
   * `paypalPay` mutan `this.orders[0]`. Misma búsqueda que tenía el mock (id
   * o tracking), fallback a la fila 0 incluido.
   */
  getMockOrderForPayment(idOrTracking: number): Order {
    return (
      this.orders.find(
        (o: Order) => o.id === Number(idOrTracking) || o.tracking_number === idOrTracking.toString(),
      ) ?? this.orders[0]
    );
  }

  update(id: number, updateOrderInput: UpdateOrderDto) {
    return this.orders[0];
  }

  remove(id: number) {
    return `This action removes a #${id} order`;
  }

  verifyCheckout(input: CheckoutVerificationDto): VerifiedCheckoutData {
    return {
      total_tax: 0,
      shipping_charge: 0,
      unavailable_products: [],
      wallet_currency: 0,
      wallet_amount: 0,
    };
  }

  async getOrderFileItems({ page, limit }: GetOrderFilesDto) {
    if (!page) page = 1;
    if (!limit) limit = 30;
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;

    const results = orderFiles.slice(startIndex, endIndex);

    const url = `/downloads?&limit=${limit}`;
    return {
      data: results,
      ...paginate(orderFiles.length, page, limit, results.length, url),
    };
  }

  async getDigitalFileDownloadUrl(digitalFileId: number) {
    const item: OrderFiles = this.orderFiles.find(
      (singleItem) => singleItem.digital_file_id === digitalFileId,
    );

    return item.file.url;
  }

  async exportOrder(shop_id: string) {
    return exportOrderJson.url;
  }

  async downloadInvoiceUrl(shop_id: string) {
    return orderInvoiceJson[0].url;
  }

  /**
   * helper methods from here
   */

  /**
   * this method will process children of Order Object
   * @param order
   * @returns Children[]
   */
  processChildrenOrder(order: Order) {
    return [...order.children].map((child) => {
      child.order_status = order.order_status;
      child.payment_status = order.payment_status;
      return child;
    });
  }
  /**
   * This action will return Payment Intent
   * @param order
   * @param setting
   */
  async processPaymentIntent(
    order: Order,
    setting: Setting,
  ): Promise<PaymentIntent> {
    const paymentIntent = paymentIntents.find(
      (intent: PaymentIntent) =>
        intent.tracking_number === order.tracking_number &&
        intent.payment_gateway.toString().toLowerCase() ===
          setting.options.paymentGateway.toString().toLowerCase(),
    );
    if (paymentIntent) {
      return paymentIntent;
    }
    const {
      id: payment_id,
      client_secret = null,
      redirect_url = null,
      customer = null,
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
    //   customer_id: customer,
    //   gateway_name: setting.options.paymentGateway,
    //   created_at: new Date(),
    //   updated_at: new Date(),
    // };
    // paymentGateways.push(paymentGateway);

    return paymentIntentInfo;
  }

  /**
   * Trailing method of ProcessPaymentIntent Method
   *
   * @param order
   * @param paymentGateway
   */
  async savePaymentIntent(order: Order, paymentGateway?: string): Promise<any> {
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

  /**
   *  Route {order/payment} Submit Payment intent here
   * @param order
   * @param orderPaymentDto
   */
  async stripePay(order: Order) {
    this.orders[0]['order_status'] = OrderStatusType.PROCESSING;
    this.orders[0]['payment_status'] = PaymentStatusType.SUCCESS;
    this.orders[0]['payment_intent'] = null;
  }

  async paypalPay(order: Order) {
    this.orders[0]['order_status'] = OrderStatusType.PROCESSING;
    this.orders[0]['payment_status'] = PaymentStatusType.SUCCESS;
    const { status } = await this.paypalService.verifyOrder(
      order.payment_intent.payment_intent_info.payment_id,
    );
    this.orders[0]['payment_intent'] = null;
    if (status === 'COMPLETED') {
      //console.log('payment Success');
    }
  }

  /**
   * This method will set order status and payment status
   * @param orderStatus
   * @param paymentStatus
   */
  changeOrderPaymentStatus(
    orderStatus: OrderStatusType,
    paymentStatus: PaymentStatusType,
  ) {
    this.orders[0]['order_status'] = orderStatus;
    this.orders[0]['payment_status'] = paymentStatus;
  }
}
