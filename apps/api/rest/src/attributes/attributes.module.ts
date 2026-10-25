import { Module } from '@nestjs/common';
import { AttributesService } from './attributes.service.js';
import { AttributesController } from './attributes.controller.js';

@Module({
  controllers: [AttributesController],
  providers: [AttributesService],
})
export class AttributesModule {}
