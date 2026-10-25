import { PickType } from '@nestjs/swagger';
import { Feedback } from '../entities/feedback.entity.js';

export class CreateFeedBackDto extends PickType(Feedback, [
  'model_id',
  'model_type',
  'positive',
  'negative',
]) {}
