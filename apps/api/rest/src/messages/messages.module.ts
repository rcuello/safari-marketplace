import { Module } from '@nestjs/common';
import {
  MessageSeenController,
  MessagesController,
} from './messages.controller.js';
import { MessagesService } from './messages.service.js';

@Module({
  controllers: [MessagesController, MessageSeenController],
  providers: [MessagesService],
})
export class MessagesModule {}
