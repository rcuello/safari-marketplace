import { Module } from '@nestjs/common';
import { RefundsService } from './refunds.service.js';
import { RefundsController } from './refunds.controller.js';

@Module({
  controllers: [RefundsController],
  providers: [RefundsService],
})
export class RefundsModule {}
