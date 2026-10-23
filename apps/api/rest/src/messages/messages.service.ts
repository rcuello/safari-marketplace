import { Injectable } from '@nestjs/common';
import { createMessage, listMessages } from '@safari/db';
import { CurrentUserPayload } from 'src/auth/decorators/current-user.decorator';
import { paginate } from 'src/common/pagination/paginate';
import { toWriteHttpException } from 'src/common/errors/domain-error.mapper';
import { toMessageDto } from 'src/conversations/conversation-dto.mapper';
import {
  findVisibleConversation,
  readError,
} from 'src/conversations/conversations.service';
import { GetConversationsDto } from 'src/conversations/dto/get-conversations.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { Message } from './entities/message.entity';

/**
 * Mensajes de una conversación (US-56). Antes las dos rutas ignoraban el id
 * y devolvían el mock entero. La conversación debe ser visible para quien
 * llama; si no, 404.
 */
@Injectable()
export class MessagesService {
  /** Inserta y sube el `updated_at` de la conversación. Cuerpo vacío ⇒ 400. */
  async createMessage(
    param: string,
    dto: CreateMessageDto,
    user: CurrentUserPayload,
  ): Promise<Message> {
    const conversation = await findVisibleConversation(param, user);
    try {
      const record = await createMessage({
        conversationId: conversation.id,
        userId: user.sub,
        body: dto.body,
      });
      return toMessageDto(record, user.sub);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /**
   * Solo los de `:param`, `id DESC`, CON paginador (V-11): el admin usa
   * `useInfiniteQuery` sobre `current_page`/`last_page`. `limit` 15.
   */
  async getMessages(
    param: string,
    { limit, page }: GetConversationsDto,
    user: CurrentUserPayload,
  ) {
    const conversation = await findVisibleConversation(param, user);
    if (!page) page = 1;
    if (!limit) limit = 15;
    const url = `/messages/conversations/${conversation.id}?limit=${limit}`;
    try {
      const { items, total } = await listMessages(conversation.id, {
        page: Number(page),
        limit: Number(limit),
      });
      return {
        data: items.map((m) => toMessageDto(m, user.sub)),
        ...paginate(total, page, limit, items.length, url),
      };
    } catch (error) {
      readError(error);
    }
  }
}
