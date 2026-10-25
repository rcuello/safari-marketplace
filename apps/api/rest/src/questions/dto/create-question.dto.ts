import { Question } from '../entities/question.entity.js';
import { OmitType } from '@nestjs/swagger';

export class CreateQuestionDto extends OmitType(Question, [
  'id',
  'product',
  'user',
  'created_at',
  'updated_at',
]) {}
