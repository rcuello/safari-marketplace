import { Module } from '@nestjs/common';
import { AuthModule } from '#src/auth/auth.module.js';
import { PaymentModule } from '#src/payment/payment.module.js';
import { SettingsModule } from '#src/settings/settings.module.js';
import {
  PaymentMethodController,
  SavePaymentMethodController,
  SetDefaultCartController,
} from './payment-method.controller.js';
import { PaymentMethodService } from './payment-method.service.js';

@Module({
  imports: [AuthModule, PaymentModule, SettingsModule],
  controllers: [
    PaymentMethodController,
    SetDefaultCartController,
    SavePaymentMethodController,
  ],
  providers: [PaymentMethodService],
})
export class PaymentMethodModule {}
