import { Module } from '@nestjs/common';
import { UsersService } from '#src/users/users.service.js';
import { StoreNoticesController } from './store-notices.controller.js';
import { StoreNoticesService } from './store-notices.service.js';

@Module({
  controllers: [StoreNoticesController],
  providers: [StoreNoticesService, UsersService],
})
export class StoreNoticesModule {}
