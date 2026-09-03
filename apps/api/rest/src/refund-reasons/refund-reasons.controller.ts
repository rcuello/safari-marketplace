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
import { RefundReasonsService } from './refund-reasons.service';
import { CreateRefundReasonDto } from './dto/create-refund-reasons.dto';
import { GetRefundReasonDto } from './dto/get-refund-reasons.dto';
import { UpdateRefundReasonDto } from './dto/update-refund-reasons.dto';
import { Public } from 'src/auth/decorators/public.decorator';
import { ADMIN_ONLY, Permissions } from 'src/auth/decorators/permissions.decorator';

@Controller('refund-reasons')
export class RefundReasonsController {
  constructor(private refundReasonsService: RefundReasonsService) {}

  @Permissions(...ADMIN_ONLY)
  @Post()
  createRefund(@Body() createRefundReasonDto: CreateRefundReasonDto) {
    return this.refundReasonsService.create(createRefundReasonDto);
  }

  @Public()
  @Get()
  findAll(@Query() query: GetRefundReasonDto) {
    return this.refundReasonsService.findAllRefundPolicies(query);
  }

  @Public()
  @Get(':param')
  getRefund(
    @Param('param') param: string,
    @Query('language') language: string,
  ) {
    return this.refundReasonsService.getRefundPolicy(param, language);
  }

  @Permissions(...ADMIN_ONLY)
  @Put(':id')
  update(
    @Param('id') id: string,
    @Param('language') language: string,
    @Body() updateRefundReasonDto: UpdateRefundReasonDto,
  ) {
    return this.refundReasonsService.update(+id, updateRefundReasonDto);
  }

  @Permissions(...ADMIN_ONLY)
  @Delete(':id')
  deleteRefund(@Param('id') id: string) {
    return this.refundReasonsService.remove(+id);
  }
}
