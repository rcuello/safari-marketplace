import { PartialType } from '@nestjs/swagger';
import { CreateRefundReasonDto } from './create-refund-reasons.dto.js';

export class UpdateRefundReasonDto extends PartialType(CreateRefundReasonDto) {}
