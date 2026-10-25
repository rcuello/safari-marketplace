import { Module } from '@nestjs/common';
import { RefundPoliciesController } from './refund-policies.controller.js';
import { RefundPoliciesService } from './refund-policies.service.js';

@Module({
  controllers: [RefundPoliciesController],
  providers: [RefundPoliciesService],
})
export class RefundPoliciesModule {}
