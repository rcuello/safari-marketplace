import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { CouponsService } from './coupons.service';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { GetCouponsDto } from './dto/get-coupons.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { Public } from 'src/auth/decorators/public.decorator';
import {
  ADMIN_ONLY,
  ADMIN_OWNER_AND_STAFF,
  Permissions,
} from 'src/auth/decorators/permissions.decorator';

@Controller('coupons')
export class CouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  @Permissions(...ADMIN_OWNER_AND_STAFF)
  @Post()
  createCoupon(@Body() createCouponDto: CreateCouponDto) {
    return this.couponsService.create(createCouponDto);
  }

  // La lista ya se prefetchea anónima en coupon.ssr.ts (cierre del usuario, proposal.md).
  @Public()
  @Get()
  getCoupons(@Query() query: GetCouponsDto) {
    return this.couponsService.getCoupons(query);
  }

  @Public()
  @Get(':param')
  getCoupon(
    @Param('param') param: string,
    @Query('language') language: string,
  ) {
    return this.couponsService.getCoupon(param, language);
  }

  @Public()
  @Get(':id/verify')
  verify(@Param('param') param: string, @Query('language') language: string) {
    return this.couponsService.getCoupon(param, language);
  }

  // `verify` corre en el carrito de invitado (cierre del usuario, proposal.md).
  @Public()
  @Post('verify')
  verifyCoupon(@Body('code') code: string) {
    return this.couponsService.verifyCoupon(code);
  }

  @Permissions(...ADMIN_OWNER_AND_STAFF)
  @Put(':id')
  updateCoupon(
    @Param('id') id: string,
    @Body() updateCouponDto: UpdateCouponDto,
  ) {
    return this.couponsService.update(+id, updateCouponDto);
  }

  @Permissions(...ADMIN_OWNER_AND_STAFF)
  @Delete(':id')
  deleteCoupon(@Param('id') id: string) {
    return this.couponsService.remove(+id);
  }
}

@Permissions(...ADMIN_ONLY)
@Controller('disapprove-coupon')
export class DisapproveCouponController {
  constructor(private couponsService: CouponsService) {}

  @Post()
  async disapproveCoupon(@Body('id') id) {
    return this.couponsService.disapproveCoupon(id);
  }
}

@Permissions(...ADMIN_ONLY)
@Controller('approve-coupon')
export class ApproveCouponController {
  constructor(private couponsService: CouponsService) {}

  @Post()
  async approveCoupon(@Body('id') id) {
    return this.couponsService.approveCoupon(id);
  }
}
