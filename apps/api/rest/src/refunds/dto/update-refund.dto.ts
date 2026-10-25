import { PartialType } from '@nestjs/swagger';
import { CreateRefundDto } from './create-refund.dto.js';

export class UpdateRefundDto extends PartialType(CreateRefundDto) {}
