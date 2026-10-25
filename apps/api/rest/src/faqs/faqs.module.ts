import { Module } from '@nestjs/common';
import { FaqsController } from './faqs.controller.js';
import { FaqsService } from './faqs.service.js';

@Module({
  controllers: [FaqsController],
  providers: [FaqsService],
})
export class FaqsModule {}
