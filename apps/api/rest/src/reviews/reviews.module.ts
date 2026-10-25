import { Module } from '@nestjs/common';
import { AbusiveReportsController } from './reports.controller.js';
import { AbusiveReportService } from './reports.service.js';
import { ReviewController } from './reviews.controller.js';
import { ReviewService } from './reviews.service.js';

@Module({
  controllers: [ReviewController, AbusiveReportsController],
  providers: [ReviewService, AbusiveReportService],
})
export class ReviewModule {}
