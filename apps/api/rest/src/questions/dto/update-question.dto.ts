import { PartialType } from '@nestjs/swagger';
import { CreateQuestionDto } from './create-question.dto.js';

export class UpdateQuestionDto extends PartialType(CreateQuestionDto) {}
