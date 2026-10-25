import { PickType } from '@nestjs/swagger';
import { Faq } from '../entities/faq.entity.js';

/**
 * Lo que envía el admin (`faqs-form.tsx:90-109`). `faq_type` e `issued_by`
 * NO: los deriva el repositorio de `shop_id`.
 */
export class CreateFaqDto extends PickType(Faq, [
  'faq_title',
  'faq_description',
  'shop_id',
  'language',
]) {}
