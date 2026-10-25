import { Module } from '@nestjs/common';
import { AuthModule } from '#src/auth/auth.module.js';
import { PaymentModule } from '#src/payment/payment.module.js';
import {
  DownloadInvoiceController,
  OrderExportController,
  OrderFilesController,
  OrdersController,
  OrderStatusController,
} from './orders.controller.js';
import { OrderStatusesService } from './order-statuses.service.js';
import { OrdersService } from './orders.service.js';

@Module({
  imports: [AuthModule, PaymentModule],
  controllers: [
    OrdersController,
    OrderStatusController,
    OrderFilesController,
    OrderExportController,
    DownloadInvoiceController,
  ],
  providers: [OrdersService, OrderStatusesService],
  exports: [OrdersService],
})
export class OrdersModule {}
