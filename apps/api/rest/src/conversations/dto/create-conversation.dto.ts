import { PickType } from '@nestjs/swagger';
import { Conversation } from '../entities/conversation.entity.js';

export class CreateConversationDto extends PickType(Conversation, [
  'shop_id',
]) {}
