import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  CurrentUser,
  CurrentUserPayload,
} from '#src/auth/decorators/current-user.decorator.js';
import { ConversationsService } from './conversations.service.js';
import { CreateConversationDto } from './dto/create-conversation.dto.js';
import { GetConversationsDto } from './dto/get-conversations.dto.js';

// La visibilidad depende de quién llama (US-56): todas las rutas leen
// @CurrentUser. Los decoradores de autorización no cambian (R-6).
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  createConversation(
    @Body() createConversationDto: CreateConversationDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.conversationsService.create(createConversationDto, user);
  }

  @Get()
  getConversations(
    @Query() query: GetConversationsDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.conversationsService.getAllConversations(query, user);
  }

  @Get(':param')
  getConversation(
    @Param('param') param: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.conversationsService.getConversation(param, user);
  }
}
