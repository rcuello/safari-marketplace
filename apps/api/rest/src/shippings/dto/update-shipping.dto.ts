import { PartialType } from '@nestjs/swagger';
import { CreateShippingDto } from './create-shipping.dto.js';

export class UpdateShippingDto extends PartialType(CreateShippingDto) {}
