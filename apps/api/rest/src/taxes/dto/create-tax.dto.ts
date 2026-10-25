import { OmitType } from '@nestjs/swagger';
import { Tax } from '../entities/tax.entity.js';

export class CreateTaxDto extends OmitType(Tax, [
  'id',
  'created_at',
  'updated_at',
]) {}
