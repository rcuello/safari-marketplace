import { PickType } from '@nestjs/swagger';
import { FlashSale } from '../entities/flash-sale.entity.js';

export class CreateFlashSaleDto extends PickType(FlashSale, [
  'title',
  'description',
  'end_date',
  'start_date',
  'type',
  'sale_builder',
  'products',
]) {}
