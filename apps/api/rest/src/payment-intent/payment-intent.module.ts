import { Module } from '@nestjs/common';
import { PaymentIntentController } from './payment-intent.controller.js';
import { PaymentIntentService } from './payment-intent.service.js';

@Module({
  controllers: [PaymentIntentController],
  providers: [PaymentIntentService],
})
export class PaymentIntentModule {}
