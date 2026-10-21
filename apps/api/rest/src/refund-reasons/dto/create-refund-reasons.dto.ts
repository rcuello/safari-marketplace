import { PickType } from '@nestjs/swagger';
import { RefundReason } from '../entities/refund-reasons.entity';

/** Lo que envía el admin (`refund-reason-form.tsx`): `{name, slug, language}`. */
export class CreateRefundReasonDto extends PickType(RefundReason, [
  'name',
  'slug',
  'language',
]) {}
