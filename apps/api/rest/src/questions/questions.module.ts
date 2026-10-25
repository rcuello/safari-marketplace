import { Module } from '@nestjs/common';
import { MyQuestionsController } from './my-questions.controller.js';
import { MyQuestionsService } from './my-questions.service.js';
import { QuestionController } from './questions.controller.js';
import { QuestionService } from './questions.service.js';

@Module({
  controllers: [QuestionController, MyQuestionsController],
  providers: [QuestionService, MyQuestionsService],
})
export class QuestionModule {}
