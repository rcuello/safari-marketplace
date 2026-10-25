import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  CurrentUser,
  CurrentUserPayload,
} from '#src/auth/decorators/current-user.decorator.js';
import { GetConversationsDto } from '#src/conversations/dto/get-conversations.dto.js';
import { CreateMessageDto } from './dto/create-message.dto.js';
import { MessagesService } from './messages.service.js';

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

/**
 * `POST /messages/seen/:id` (US-64): el admin marca leída una CONVERSACIÓN.
 * Manda el id desnudo como cuerpo (`1`); se ignora y cuenta el de la ruta.
 * `main.ts` monta un parser JSON no estricto solo para esta ruta, porque el
 * estricto rechaza un primitivo con 400 antes de llegar aquí.
 */
@Controller('messages/seen')
export class MessageSeenController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post(':id')
  markSeen(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.messagesService.markSeen(id, user);
  }
}
