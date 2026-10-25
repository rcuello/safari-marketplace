import { Module } from '@nestjs/common';
import { ShippingsService } from './shippings.service.js';
import { ShippingsController } from './shippings.controller.js';

@Module({
  controllers: [ShippingsController],
  providers: [ShippingsService],
})
export class ShippingsModule {}
