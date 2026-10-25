import { CreatePaymentMethodDto } from './create-payment-method.dto.js';
import { PartialType } from '@nestjs/swagger';

export class UpdatePaymentMethodDto extends PartialType(
  CreatePaymentMethodDto,
) {}
