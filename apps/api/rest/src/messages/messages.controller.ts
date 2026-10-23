import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  CurrentUser,
  CurrentUserPayload,
} from 'src/auth/decorators/current-user.decorator';
import { GetConversationsDto } from 'src/conversations/dto/get-conversations.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { MessagesService } from './messages.service';

// `:id`/`:param` son la conversación (US-56): antes se ignoraban.
@Controller('messages/conversations')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post(':id')
  createMessage(
    @Param('id') id: string,
    @Body() createMessageDto: CreateMessageDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.messagesService.createMessage(id, createMessageDto, user);
  }

  @Get(':param')
  getMessages(
    @Param('param') param: string,
    @Query() query: GetConversationsDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.messagesService.getMessages(param, query, user);
  }
}
