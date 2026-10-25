import { Module } from '@nestjs/common';
import {
  ApproveTermsAndConditionController,
  DisapproveTermsAndConditionController,
  TermsAndConditionsController,
} from './terms-and-conditions.controller.js';
import { TermsAndConditionsService } from './terms-and-conditions.service.js';

@Module({
  controllers: [
    TermsAndConditionsController,
    DisapproveTermsAndConditionController,
    ApproveTermsAndConditionController,
  ],
  providers: [TermsAndConditionsService],
})
export class TermsAndConditionsModule {}
