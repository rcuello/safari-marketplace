import { Module } from '@nestjs/common';
import { UsersService } from './users.service.js';
import {
  AdminController,
  AllCustomerController,
  AllStaffsController,
  MyStaffsController,
  ProfilesController,
  UsersController,
  VendorController,
} from './users.controller.js';

@Module({
  controllers: [
    UsersController,
    ProfilesController,
    AdminController,
    VendorController,
    MyStaffsController,
    AllStaffsController,
    AllCustomerController,
  ],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
