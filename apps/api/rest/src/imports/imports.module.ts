import { Module } from '@nestjs/common';
import { ImportsService } from './imports.service.js';
import { ImportsController } from './imports.controller.js';

@Module({
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
