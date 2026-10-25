import { PartialType } from '@nestjs/swagger';
import { CreateManufacturerDto } from './create-manufacturer.dto.js';

export class UpdateManufacturerDto extends PartialType(CreateManufacturerDto) {}
