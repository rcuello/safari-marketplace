import { Module } from '@nestjs/common';
import {
  OwnershipTransferController,
  TransferShopOwnershipController,
} from './ownership-transfer.controller';
import { OwnershipTransferService } from './ownership-transfer.service';

@Module({
  controllers: [OwnershipTransferController, TransferShopOwnershipController],
  providers: [OwnershipTransferService],
})
export class OwnershipTransferModule {}
