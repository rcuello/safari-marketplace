import { OmitType } from '@nestjs/swagger';
import { PaymentMethod } from '../entities/payment-method.entity.js';

export class CreatePaymentMethodDto extends OmitType(PaymentMethod, [
  'id',
  'created_at',
  'updated_at',
]) {}
