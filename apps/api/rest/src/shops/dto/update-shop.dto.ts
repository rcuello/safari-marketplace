import { PartialType } from '@nestjs/swagger';
import { CreateShopDto } from './create-shop.dto.js';

export class UpdateShopDto extends PartialType(CreateShopDto) {}
