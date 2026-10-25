import { Injectable } from '@nestjs/common';
import { CreateRefundDto } from './dto/create-refund.dto.js';
import { UpdateRefundDto } from './dto/update-refund.dto.js';

@Injectable()
export class RefundsService {
  create(_createRefundDto: CreateRefundDto) {
    return 'This action adds a new refund';
  }

  findAll() {
    return {
      data: [],
    };
  }

  findOne(id: number) {
    return `This action returns a #${id} refund`;
  }

  update(id: number, _updateRefundDto: UpdateRefundDto) {
    return `This action updates a #${id} refund`;
  }

  remove(id: number) {
    return `This action removes a #${id} refund`;
  }
}
