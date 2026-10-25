import { Injectable } from '@nestjs/common';
import { CreateAddressDto } from './dto/create-address.dto.js';
import { UpdateAddressDto } from './dto/update-address.dto.js';

@Injectable()
export class AddressesService {
  create(_createAddressDto: CreateAddressDto) {
    return 'This action adds a new address';
  }

  findAll() {
    return `This action returns all addresses`;
  }

  findOne(id: number) {
    return `This action returns a #${id} address`;
  }

  update(id: number, _updateAddressDto: UpdateAddressDto) {
    return `This action updates a #${id} address`;
  }

  remove(_id: number) {
    return [];
  }
}
