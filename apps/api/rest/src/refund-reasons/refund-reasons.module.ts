import { Module } from '@nestjs/common';
import { RefundReasonsController } from './refund-reasons.controller.js';
import { RefundReasonsService } from './refund-reasons.service.js';

@Module({
  controllers: [RefundReasonsController],
  providers: [RefundReasonsService],
})
export class RefundReasonModule {}
