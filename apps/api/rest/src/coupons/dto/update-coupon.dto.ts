import { PartialType } from '@nestjs/swagger';
import { CreateCouponDto } from './create-coupon.dto.js';

export class UpdateCouponDto extends PartialType(CreateCouponDto) {}
