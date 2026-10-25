import { Module } from '@nestjs/common';
import { TaxesService } from './taxes.service.js';
import { TaxesController } from './taxes.controller.js';

@Module({
  controllers: [TaxesController],
  providers: [TaxesService],
})
export class TaxesModule {}
