import { PickType } from '@nestjs/swagger';
import { TermsAndConditions } from '../entities/terms-and-conditions.entity.js';

/**
 * Lo que envía el admin (`terms-and-conditions-form.tsx:126-138`): `slug`
 * opcional y `shop_id`. `type`/`issued_by` los deriva el repositorio.
 */
export class CreateTermsAndConditionsDto extends PickType(TermsAndConditions, [
  'title',
  'description',
  'slug',
  'shop_id',
  'language',
]) {}
