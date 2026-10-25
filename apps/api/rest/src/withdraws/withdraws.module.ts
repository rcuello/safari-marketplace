import { Module } from '@nestjs/common';
import { WithdrawsService } from './withdraws.service.js';
import {
  ApproveWithdrawController,
  WithdrawsController,
} from './withdraws.controller.js';

@Module({
  controllers: [WithdrawsController, ApproveWithdrawController],
  providers: [WithdrawsService],
})
export class WithdrawsModule {}
