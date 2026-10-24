import { Module } from '@nestjs/common';
import { WithdrawsService } from './withdraws.service';
import {
  ApproveWithdrawController,
  WithdrawsController,
} from './withdraws.controller';

@Module({
  controllers: [WithdrawsController, ApproveWithdrawController],
  providers: [WithdrawsService],
})
export class WithdrawsModule {}
