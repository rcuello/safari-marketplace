import { Module } from '@nestjs/common';
import { CouponsService } from './coupons.service.js';
import {
  ApproveCouponController,
  CouponsController,
  DisapproveCouponController,
} from './coupons.controller.js';

@Module({
  controllers: [
    CouponsController,
    ApproveCouponController,
    DisapproveCouponController,
  ],
  providers: [CouponsService],
})
export class CouponsModule {}
