import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CreateOrderStatusDto } from './dto/create-order-status.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { GetOrderFilesDto, OrderFilesPaginator } from './dto/get-downloads.dto';
import { GetOrderStatusesDto } from './dto/get-order-statuses.dto';
import { GetOrdersDto, OrderPaginator } from './dto/get-orders.dto';
import { OrderPaymentDto } from './dto/order-payment.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { CheckoutVerificationDto } from './dto/verify-checkout.dto';
import { Order } from './entities/order.entity';
import { OrdersService } from './orders.service';
import { Public } from 'src/auth/decorators/public.decorator';
import {
  ADMIN_AND_OWNER,
  ADMIN_ONLY,
  ADMIN_OWNER_AND_STAFF,
  Permissions,
} from 'src/auth/decorators/permissions.decorator';
import {
  CurrentUser,
  CurrentUserPayload,
} from 'src/auth/decorators/current-user.decorator';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  // D-10 (proposal.md): el checkout de invitado (`guestCheckout: true`) es un
  // flujo vivo del shop; crear tu propio pedido no expone datos de terceros.
  @Public()
  @Post()
  async create(@Body() createOrderDto: CreateOrderDto): Promise<Order> {
    return this.ordersService.create(createOrderDto);
  }

  @Get()
  async getOrders(
    @Query() query: GetOrdersDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<OrderPaginator> {
    const isAdminLevel = ADMIN_OWNER_AND_STAFF.some((permission) =>
      user.permissions.includes(permission),
    );
    // D-8 (design.md, Decisión G): un cliente solo puede pedir SUS pedidos.
    // `customer_id` es opcional en GetOrdersDto y hoy el borde no lo
    // controlaba. Con permiso admin/owner/staff se respeta el query tal cual.
    return this.ordersService.getOrders(
      isAdminLevel ? query : { ...query, customer_id: user.sub },
    );
  }

  @Get(':id')
  getOrderById(@Param('id') id: number) {
    return this.ordersService.getOrderByIdOrTrackingNumber(Number(id));
  }

  @Get('tracking-number/:tracking_id')
  getOrderByTrackingNumber(@Param('tracking_id') tracking_id: number) {
    return this.ordersService.getOrderByIdOrTrackingNumber(tracking_id);
  }

  @Permissions(...ADMIN_OWNER_AND_STAFF)
  @Put(':id')
  update(@Param('id') id: string, @Body() updateOrderDto: UpdateOrderDto) {
    return this.ordersService.update(+id, updateOrderDto);
  }

  @Permissions(...ADMIN_OWNER_AND_STAFF)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.ordersService.remove(+id);
  }

  // D-10 (proposal.md): mismo motivo que POST /orders.
  @Public()
  @Post('checkout/verify')
  verifyCheckout(@Query() query: CheckoutVerificationDto) {
    return this.ordersService.verifyCheckout(query);
  }
  @Post('/payment')
  @HttpCode(200)
  async submitPayment(@Body() orderPaymentDto: OrderPaymentDto): Promise<void> {
    const { tracking_number } = orderPaymentDto;
    const order: Order = await this.ordersService.getOrderByIdOrTrackingNumber(
      tracking_number,
    );
    switch (order.payment_gateway.toString().toLowerCase()) {
      case 'stripe':
        this.ordersService.stripePay(order);
        break;
      case 'paypal':
        this.ordersService.paypalPay(order);
        break;
      default:
        break;
    }
    this.ordersService.processChildrenOrder(order);
  }
}

@Controller('order-status')
export class OrderStatusController {
  constructor(private readonly ordersService: OrdersService) {}

  @Permissions(...ADMIN_ONLY)
  @Post()
  create(@Body() createOrderStatusDto: CreateOrderStatusDto) {
    return this.ordersService.createOrderStatus(createOrderStatusDto);
  }

  @Public()
  @Get()
  findAll(@Query() query: GetOrderStatusesDto) {
    return this.ordersService.getOrderStatuses(query);
  }

  @Public()
  @Get(':param')
  findOne(@Param('param') param: string, @Query('language') language: string) {
    return this.ordersService.getOrderStatus(param, language);
  }

  @Permissions(...ADMIN_ONLY)
  @Put(':id')
  update(@Param('id') id: string, @Body() updateOrderDto: UpdateOrderDto) {
    return this.ordersService.update(+id, updateOrderDto);
  }

  @Permissions(...ADMIN_ONLY)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.ordersService.remove(+id);
  }
}

@Controller('downloads')
export class OrderFilesController {
  constructor(private ordersService: OrdersService) {}

  @Get()
  async getOrderFileItems(
    @Query() query: GetOrderFilesDto,
  ): Promise<OrderFilesPaginator> {
    return this.ordersService.getOrderFileItems(query);
  }

  @Post('digital_file')
  async getDigitalFileDownloadUrl(
    @Body('digital_file_id', ParseIntPipe) digitalFileId: number,
  ) {
    return this.ordersService.getDigitalFileDownloadUrl(digitalFileId);
  }
}

// Facturas (design.md, Decisión B): ADMIN_AND_OWNER.
@Permissions(...ADMIN_AND_OWNER)
@Controller('export-order-url')
export class OrderExportController {
  constructor(private ordersService: OrdersService) {}

  @Get()
  async orderExport(@Query('shop_id') shop_id: string) {
    return this.ordersService.exportOrder(shop_id);
  }
}

@Permissions(...ADMIN_AND_OWNER)
@Controller('download-invoice-url')
export class DownloadInvoiceController {
  constructor(private ordersService: OrdersService) {}

  @Post()
  async downloadInvoiceUrl(@Body('shop_id') shop_id: string) {
    return this.ordersService.downloadInvoiceUrl(shop_id);
  }
}
