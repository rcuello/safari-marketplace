import { Module } from '@nestjs/common';
import { ShopsService } from './shops.service.js';
import {
  ApproveShopController,
  DisapproveShopController,
  ShopsController,
  StaffsController,
  NearByShopController,
  NewShopsController,
} from './shops.controller.js';

@Module({
  controllers: [
    ShopsController,
    StaffsController,
    DisapproveShopController,
    ApproveShopController,
    NearByShopController,
    NewShopsController,
  ],
  providers: [ShopsService],
})
export class ShopsModule {}
