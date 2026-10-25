import { Controller, Get, Query } from '@nestjs/common';
import { GetPaymentIntentDto } from './dto/get-payment-intent.dto.js';
import { PaymentIntentService } from './payment-intent.service.js';

@Controller('payment-intent')
export class PaymentIntentController {
  constructor(private readonly paymentIntentService: PaymentIntentService) {}
  @Get()
  async getPaymentIntent(@Query() query: GetPaymentIntentDto) {
    console.log('payment_intent', 'payment_intent');
    return this.paymentIntentService.getPaymentIntent(query);
  }
}
