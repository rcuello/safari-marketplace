import { Module } from '@nestjs/common';
import { BecomeSellerController } from './become-seller.controller.js';
import { BecomeSellerService } from './become-seller.service.js';

@Module({
  controllers: [BecomeSellerController],
  providers: [BecomeSellerService],
  exports: [BecomeSellerService],
})
export class BecomeSellerModule {}
