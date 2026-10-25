import { PickType } from '@nestjs/swagger';
import { Message } from '../entities/message.entity.js';

export class CreateMessageDto extends PickType(Message, ['body']) {}
