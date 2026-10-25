import { Module } from '@nestjs/common';
import { AddressesService } from './addresses.service.js';
import { AddressesController } from './addresses.controller.js';

@Module({
  controllers: [AddressesController],
  providers: [AddressesService],
})
export class AddressesModule {}
