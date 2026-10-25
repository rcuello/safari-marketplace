import { PartialType } from '@nestjs/swagger';
import { CreateRefundPolicyDto } from './create-refund-policy.dto.js';

export class UpdateRefundPolicyDto extends PartialType(CreateRefundPolicyDto) {}
