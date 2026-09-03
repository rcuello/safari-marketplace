import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { RefundPoliciesService } from './refund-policies.service';
import { CreateRefundPolicyDto } from './dto/create-refund-policy.dto';
import { GetRefundPolicyDto } from './dto/get-refund-policies.dto';
import { UpdateRefundPolicyDto } from './dto/update-refund-policy.dto';
import { Public } from 'src/auth/decorators/public.decorator';
import { ADMIN_ONLY, Permissions } from 'src/auth/decorators/permissions.decorator';

@Controller('refund-policies')
export class RefundPoliciesController {
  constructor(private refundPoliciesService: RefundPoliciesService) {}

  @Permissions(...ADMIN_ONLY)
  @Post()
  createRefund(@Body() createRefundPolicyDto: CreateRefundPolicyDto) {
    return this.refundPoliciesService.create(createRefundPolicyDto);
  }

  @Public()
  @Get()
  findAll(@Query() query: GetRefundPolicyDto) {
    return this.refundPoliciesService.findAllRefundPolicies(query);
  }

  @Public()
  @Get(':param')
  getRefund(
    @Param('param') param: string,
    @Query('language') language: string,
  ) {
    return this.refundPoliciesService.getRefundPolicy(param, language);
  }

  @Permissions(...ADMIN_ONLY)
  @Put(':id')
  update(
    @Param('id') id: string,
    @Param('language') language: string,
    @Body() updateRefundDto: UpdateRefundPolicyDto,
  ) {
    return this.refundPoliciesService.update(+id, updateRefundDto);
  }

  @Permissions(...ADMIN_ONLY)
  @Delete(':id')
  deleteRefund(@Param('id') id: string) {
    return this.refundPoliciesService.remove(+id);
  }
}
