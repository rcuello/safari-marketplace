import { PartialType } from '@nestjs/swagger';
import { CreateTagDto } from './create-tag.dto.js';

export class UpdateTagDto extends PartialType(CreateTagDto) {}
