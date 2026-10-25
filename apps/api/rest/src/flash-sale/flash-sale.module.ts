import { Module } from '@nestjs/common';
import {
  FlashSaleController,
  ProductsByFlashSaleController,
} from './flash-sale.controller.js';
import { FlashSaleService } from './flash-sale.service.js';

@Module({
  controllers: [FlashSaleController, ProductsByFlashSaleController],
  providers: [FlashSaleService],
})
export class FlashSaleModule {}
