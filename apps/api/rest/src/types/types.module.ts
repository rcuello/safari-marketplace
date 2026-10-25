import { Module } from '@nestjs/common';
import { TypesService } from './types.service.js';
import { TypesController } from './types.controller.js';

@Module({
  controllers: [TypesController],
  providers: [TypesService],
})
export class TypesModule {}
