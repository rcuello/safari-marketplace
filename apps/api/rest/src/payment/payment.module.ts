import { Module } from '@nestjs/common';
import { AuthModule } from '#src/auth/auth.module.js';
import { PaypalPaymentService } from './paypal-payment.service.js';
import { StripePaymentService } from './stripe-payment.service.js';

@Module({
  imports: [AuthModule],
  providers: [StripePaymentService, PaypalPaymentService],
  exports: [StripePaymentService, PaypalPaymentService],
})
export class PaymentModule {}
