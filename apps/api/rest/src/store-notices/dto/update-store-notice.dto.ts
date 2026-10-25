import { PartialType } from '@nestjs/swagger';
import { CreateStoreNoticeDto } from './create-store-notice.dto.js';

export class UpdateStoreNoticeDto extends PartialType(CreateStoreNoticeDto) {}
