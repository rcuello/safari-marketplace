import { Module } from '@nestjs/common';
import {
  OwnershipTransferController,
  TransferShopOwnershipController,
} from './ownership-transfer.controller.js';
import { OwnershipTransferService } from './ownership-transfer.service.js';

@Module({
  controllers: [OwnershipTransferController, TransferShopOwnershipController],
  providers: [OwnershipTransferService],
})
export class OwnershipTransferModule {}
