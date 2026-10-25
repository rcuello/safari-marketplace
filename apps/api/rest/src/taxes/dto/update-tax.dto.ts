import { PartialType } from '@nestjs/swagger';
import { CreateTaxDto } from './create-tax.dto.js';

export class UpdateTaxDto extends PartialType(CreateTaxDto) {}
