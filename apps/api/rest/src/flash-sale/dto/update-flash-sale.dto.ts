import { PartialType } from '@nestjs/swagger';
import { CreateFlashSaleDto } from './create-flash-sale.dto.js';

export class UpdateFlashSaleDto extends PartialType(CreateFlashSaleDto) {}
