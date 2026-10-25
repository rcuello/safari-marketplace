import { Module } from '@nestjs/common';
import { NewslettersController } from './newsletters.controller.js';
import { NewslettersService } from './newsletters.service.js';

@Module({
  controllers: [NewslettersController],
  providers: [NewslettersService],
})
export class NewslettersModule {}
