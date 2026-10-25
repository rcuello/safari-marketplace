import { PartialType } from '@nestjs/swagger';
import { CreateFeedBackDto } from './create-feedback.dto.js';

export class UpdateFeedBackDto extends PartialType(CreateFeedBackDto) {}
