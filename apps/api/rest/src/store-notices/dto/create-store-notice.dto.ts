import { PickType } from '@nestjs/swagger';
import { StoreNotice } from '../entities/store-notices.entity.js';

export class CreateStoreNoticeDto extends PickType(StoreNotice, [
  'notice',
  'description',
  'expired_at',
  'effective_from',
  'priority',
  'type',
  'received_by',
]) {}
