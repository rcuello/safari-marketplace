import { PartialType } from '@nestjs/swagger';
import { CreateAttributeDto } from './create-attribute.dto.js';

export class UpdateAttributeDto extends PartialType(CreateAttributeDto) {}
