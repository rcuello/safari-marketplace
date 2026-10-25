import { PickType } from '@nestjs/swagger';
import { RefundPolicy } from '../entities/refund-policies.entity.js';

/** Lo que envía el admin (`refund-policy-form.tsx:124-140`). */
export class CreateRefundPolicyDto extends PickType(RefundPolicy, [
  'title',
  'status',
  'target',
  'slug',
  'description',
  'language',
  'shop_id',
]) {}
