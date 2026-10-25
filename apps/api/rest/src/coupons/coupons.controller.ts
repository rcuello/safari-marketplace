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
import { CouponsService } from './coupons.service.js';
import { CreateCouponDto } from './dto/create-coupon.dto.js';
import { GetCouponsDto } from './dto/get-coupons.dto.js';
import { UpdateCouponDto } from './dto/update-coupon.dto.js';
import { VerifyCouponInput } from './dto/verify-coupon.dto.js';
import { Public } from '#src/auth/decorators/public.decorator.js';
import {
  ADMIN_ONLY,
  ADMIN_OWNER_AND_STAFF,
  Permissions,
} from '#src/auth/decorators/permissions.decorator.js';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '#src/auth/decorators/current-user.decorator.js';

@Controller('coupons')
export class CouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  // Las escrituras llevan @CurrentUser: propiedad por tienda (DD29-4, US-52).
  @Permissions(...ADMIN_OWNER_AND_STAFF)
  @Post()
  createCoupon(
    @Body() createCouponDto: CreateCouponDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.couponsService.create(createCouponDto, user);
  }

  // La lista ya se prefetchea anónima en coupon.ssr.ts (cierre del usuario, proposal.md).
  @Public()
  @Get()
  getCoupons(@Query() query: GetCouponsDto) {
    return this.couponsService.getCoupons(query);
  }

  @Public()
  @Get(':param')
  getCoupon(@Param('param') param: string) {
    return this.couponsService.getCoupon(param);
  }

  // Leía `@Param('param')` en una ruta `:id` y siempre llegaba `undefined`
  // (V-8). El `:id` es el código: misma búsqueda que `GET :param`.
  @Public()
  @Get(':id/verify')
  verify(@Param('id') id: string) {
    return this.couponsService.getCoupon(id);
  }

  // `verify` corre en el carrito de invitado (cierre del usuario, proposal.md).
  @Public()
  @Post('verify')
  verifyCoupon(@Body() verifyCouponInput: VerifyCouponInput) {
    return this.couponsService.verifyCoupon(verifyCouponInput);
  }

  @Permissions(...ADMIN_OWNER_AND_STAFF)
  @Put(':id')
  updateCoupon(
    @Param('id') id: string,
    @Body() updateCouponDto: UpdateCouponDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.couponsService.update(+id, updateCouponDto, user);
  }

  @Permissions(...ADMIN_OWNER_AND_STAFF)
  @Delete(':id')
  deleteCoupon(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.couponsService.remove(+id, user);
  }
}

@Permissions(...ADMIN_ONLY)
@Controller('disapprove-coupon')
export class DisapproveCouponController {
  constructor(private couponsService: CouponsService) {}

  @Post()
  async disapproveCoupon(@Body('id') id: unknown) {
    return this.couponsService.setApproval(id, false);
  }
}

@Permissions(...ADMIN_ONLY)
@Controller('approve-coupon')
export class ApproveCouponController {
  constructor(private couponsService: CouponsService) {}

  @Post()
  async approveCoupon(@Body('id') id: unknown) {
    return this.couponsService.setApproval(id, true);
  }
}
