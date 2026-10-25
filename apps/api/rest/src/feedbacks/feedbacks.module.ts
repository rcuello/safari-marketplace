import { Module } from '@nestjs/common';
import { FeedbackController } from './feedbacks.controller.js';
import { FeedbackService } from './feedbacks.service.js';

@Module({
  controllers: [FeedbackController],
  providers: [FeedbackService],
})
export class FeedbackModule {}
