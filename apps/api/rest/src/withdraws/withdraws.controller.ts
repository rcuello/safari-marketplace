import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { WithdrawsService } from './withdraws.service.js';
import { CreateWithdrawDto } from './dto/create-withdraw.dto.js';
import { ApproveWithdrawDto } from './dto/approve-withdraw.dto.js';
import { GetWithdrawsDto, WithdrawPaginator } from './dto/get-withdraw.dto.js';
import { Withdraw } from './entities/withdraw.entity.js';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '#src/auth/decorators/current-user.decorator.js';
import {
  ADMIN_AND_OWNER,
  ADMIN_ONLY,
  Permissions,
} from '#src/auth/decorators/permissions.decorator.js';

@Permissions(...ADMIN_AND_OWNER)
@Controller('withdraws')
export class WithdrawsController {
  constructor(private readonly withdrawsService: WithdrawsService) {}

  @Post()
  createWithdraw(
    @Body() createWithdrawDto: CreateWithdrawDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<Withdraw> {
    return this.withdrawsService.create(createWithdrawDto, user);
  }

  @Get()
  async withdraws(
    @Query() query: GetWithdrawsDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<WithdrawPaginator> {
    return this.withdrawsService.getWithdraws(query, user);
  }

  @Get(':id')
  withdraw(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<Withdraw> {
    return this.withdrawsService.findOne(+id, user);
  }

  // Solo super admin (V-5): persistiendo, un dueño podría autoaprobarse.
  @Permissions(...ADMIN_ONLY)
  @Post(':id/approve')
  approveWithdraw(
    @Param('id') id: string,
    @Body() updateWithdrawDto: ApproveWithdrawDto,
  ): Promise<Withdraw> {
    return this.withdrawsService.approve(id, updateWithdrawDto);
  }

  @Delete(':id')
  deleteWithdraw(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<Withdraw> {
    return this.withdrawsService.remove(+id, user);
  }
}

/** La ruta que llama el admin (`API_ENDPOINTS.APPROVE_WITHDRAW`), con `{id, status}` en el body. */
@Permissions(...ADMIN_ONLY)
@Controller('approve-withdraw')
export class ApproveWithdrawController {
  constructor(private readonly withdrawsService: WithdrawsService) {}

  @Post()
  approveWithdraw(@Body() dto: ApproveWithdrawDto): Promise<Withdraw> {
    return this.withdrawsService.approve(dto.id, dto);
  }
}
