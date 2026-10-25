import { Module } from '@nestjs/common';
import { ManufacturersService } from './manufacturers.service.js';
import {
  ManufacturersController,
  TopManufacturersController,
} from './manufacturers.controller.js';

@Module({
  controllers: [ManufacturersController, TopManufacturersController],
  providers: [ManufacturersService],
})
export class ManufacturersModule {}
