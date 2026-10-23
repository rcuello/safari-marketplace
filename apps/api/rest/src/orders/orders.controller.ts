import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  CreateOrderStatusDto,
  UpdateOrderStatusDto,
} from './dto/create-order-status.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { GetOrderFilesDto, OrderFilesPaginator } from './dto/get-downloads.dto';
import { GetOrderStatusesDto } from './dto/get-order-statuses.dto';
import { GetOrdersDto, OrderPaginator } from './dto/get-orders.dto';
import { OrderPaymentDto } from './dto/order-payment.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { CheckoutVerificationDto } from './dto/verify-checkout.dto';
import { Order } from './entities/order.entity';
import { OrderStatusesService } from './order-statuses.service';
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
  constructor(
    private readonly ordersService: OrdersService,
    private readonly jwtService: JwtService,
  ) {}

  // D-10 (proposal.md): el checkout de invitado (`guestCheckout: true`) es un
  // flujo vivo del shop; crear tu propio pedido no expone datos de terceros.
  // R-i (US-59): `@Public` no decodifica el token, así que se verifica aquí.
  // Sin Bearer, o con uno inválido, la orden es de invitado: un token vencido
  // no debe romper el checkout (mismo criterio que `JwtAuthGuard`).
  @Public()
  @Post()
  async create(
    @Body() createOrderDto: CreateOrderDto,
    @Headers('authorization') authorization?: string,
  ): Promise<Order> {
    return this.ordersService.create(createOrderDto, this.optionalUserId(authorization));
  }

  private optionalUserId(authorization: string | undefined): number | null {
    const [scheme, token] = (authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) return null;
    try {
      return this.jwtService.verify<CurrentUserPayload>(token).sub;
    } catch {
      return null;
    }
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
  getOrderById(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.ordersService.getOrder(id, user);
  }

  @Get('tracking-number/:tracking_id')
  getOrderByTrackingNumber(
    @Param('tracking_id') tracking_id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.ordersService.getOrderByTrackingNumber(tracking_id, user);
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
  verifyCheckout(@Body() input: CheckoutVerificationDto) {
    return this.ordersService.verifyCheckout(input);
  }
  @Post('/payment')
  @HttpCode(200)
  async submitPayment(@Body() orderPaymentDto: OrderPaymentDto): Promise<void> {
    await this.ordersService.pay(orderPaymentDto.tracking_number);
  }
}

@Controller('order-status')
export class OrderStatusController {
  constructor(private readonly orderStatusesService: OrderStatusesService) {}

  @Permissions(...ADMIN_ONLY)
  @Post()
  create(@Body() createOrderStatusDto: CreateOrderStatusDto) {
    return this.orderStatusesService.create(createOrderStatusDto);
  }

  @Public()
  @Get()
  findAll(@Query() query: GetOrderStatusesDto) {
    return this.orderStatusesService.findAll(query);
  }

  @Public()
  @Get(':param')
  findOne(@Param('param') param: string) {
    return this.orderStatusesService.findOne(param);
  }

  @Permissions(...ADMIN_ONLY)
  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() updateOrderStatusDto: UpdateOrderStatusDto,
  ) {
    return this.orderStatusesService.update(+id, updateOrderStatusDto);
  }

  @Permissions(...ADMIN_ONLY)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.orderStatusesService.remove(+id);
  }
}

@Controller('downloads')
export class OrderFilesController {
  constructor(private ordersService: OrdersService) {}

  // US-60: siempre del usuario del token, nunca de un customer_id de la query.
  @Get()
  async getOrderFileItems(
    @Query() query: GetOrderFilesDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<OrderFilesPaginator> {
    return this.ordersService.getOrderFileItems(query, user.sub);
  }

  @Post('digital_file')
  async getDigitalFileDownloadUrl(
    @Body('digital_file_id', ParseIntPipe) digitalFileId: number,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.ordersService.getDigitalFileDownloadUrl(digitalFileId, user.sub);
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
