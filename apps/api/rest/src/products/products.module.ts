import { Module } from '@nestjs/common';
import { ProductsService } from './products.service.js';
import {
  ProductsController,
  PopularProductsController,
  ProductsStockController,
  DraftProductsController,
  BestSellingProductsController,
} from './products.controller.js';

@Module({
  controllers: [
    ProductsController,
    PopularProductsController,
    BestSellingProductsController,
    ProductsStockController,
    DraftProductsController,
  ],
  providers: [ProductsService],
})
export class ProductsModule {}
