import { Module } from '@nestjs/common';
import { TagsService } from './tags.service.js';
import { TagsController } from './tags.controller.js';

@Module({
  controllers: [TagsController],
  providers: [TagsService],
})
export class TagsModule {}
