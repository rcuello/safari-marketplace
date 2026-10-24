import { Module } from '@nestjs/common';
import { MessageSeenController, MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

@Module({
  controllers: [MessagesController, MessageSeenController],
  providers: [MessagesService],
})
export class MessagesModule {}
