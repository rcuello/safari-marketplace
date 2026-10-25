import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service.js';
import {
  AnalyticsController,
  CategoryWiseProductController,
  LowStockProductsController,
  TopRateProductController,
} from './analytics.controller.js';

@Module({
  controllers: [
    AnalyticsController,
    CategoryWiseProductController,
    LowStockProductsController,
    TopRateProductController,
  ],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
