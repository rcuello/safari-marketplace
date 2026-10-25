import { PickType } from '@nestjs/swagger';
import { CreateAddressDto } from '#src/addresses/dto/create-address.dto.js';
import { User } from '../entities/user.entity.js';
import { CreateProfileDto } from './create-profile.dto.js';

enum Permission {
  SUPER_ADMIN = 'Super admin',
  STORE_OWNER = 'Store owner',
  STAFF = 'Staff',
  CUSTOMER = 'Customer',
}
export class CreateUserDto extends PickType(User, [
  'name',
  'email',
  'password',
]) {
  address: CreateAddressDto[];
  profile: CreateProfileDto;
  permission: Permission = Permission.CUSTOMER;
}
