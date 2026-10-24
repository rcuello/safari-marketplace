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

import { OwnershipTransferService } from './ownership-transfer.service';
import { CreateOwnershipTransferDto } from './dto/create-ownership-transfer.dto';
import {
  GetOwnershipTransferDto,
  RefundPolicyPaginator,
} from './dto/get-ownership-transfer.dto';
import { TransferShopOwnershipDto } from './dto/transfer-shop-ownership.dto';
import { UpdateOwnershipTransferDto } from './dto/update-ownership-transfer.dto';
import { OwnershipTransfer } from './entities/ownership-transfer.entity';
import { Shop } from 'src/shops/entities/shop.entity';
import {
  CurrentUser,
  CurrentUserPayload,
} from 'src/auth/decorators/current-user.decorator';
import {
  ADMIN_AND_OWNER,
  ADMIN_ONLY,
  Permissions,
} from 'src/auth/decorators/permissions.decorator';

@Permissions(...ADMIN_AND_OWNER)
@Controller('ownership-transfer')
export class OwnershipTransferController {
  constructor(private ownershipTransferService: OwnershipTransferService) {}

  // Las escrituras son solo de super admin (V-5): persistiendo, un dueño
  // podría reasignarse tiendas.
  @Permissions(...ADMIN_ONLY)
  @Post()
  createOwnershipTransfer(
    @Body() createOwnershipTransferDto: CreateOwnershipTransferDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<OwnershipTransfer> {
    return this.ownershipTransferService.create(
      createOwnershipTransferDto,
      user,
    );
  }

  @Get()
  findAll(
    @Query() query: GetOwnershipTransferDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<RefundPolicyPaginator> {
    return this.ownershipTransferService.findAll(query, user);
  }

  /** `param` es el `transaction_identifier`, como lo llama el admin. */
  @Get(':param')
  getOwnershipTransfer(
    @Param('param') param: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<OwnershipTransfer> {
    return this.ownershipTransferService.getOwnershipTransfer(param, user);
  }

  @Permissions(...ADMIN_ONLY)
  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() updateOwnershipTransferDto: UpdateOwnershipTransferDto,
  ): Promise<OwnershipTransfer> {
    return this.ownershipTransferService.update(id, updateOwnershipTransferDto);
  }

  @Permissions(...ADMIN_ONLY)
  @Delete(':id')
  deleteOwnershipTransfer(@Param('id') id: string): Promise<OwnershipTransfer> {
    return this.ownershipTransferService.remove(id);
  }
}

/** La ruta que llama el modal de transferencia del admin (`transferShopOwnership`). */
@Permissions(...ADMIN_ONLY)
@Controller('transfer-shop-ownership')
export class TransferShopOwnershipController {
  constructor(private ownershipTransferService: OwnershipTransferService) {}

  @Post()
  transferShopOwnership(
    @Body() dto: TransferShopOwnershipDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<Shop> {
    return this.ownershipTransferService.transferShopOwnership(dto, user);
  }
}
