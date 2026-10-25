import { Injectable, NotFoundException } from '@nestjs/common';
import {
  createMessage,
  listMessages,
  markConversationSeen,
  type ConversationDetailRecord,
} from '@safari/db';
import { CurrentUserPayload } from '#src/auth/decorators/current-user.decorator.js';
import { paginate } from '#src/common/pagination/paginate.js';
import { toWriteHttpException } from '#src/common/errors/domain-error.mapper.js';
import {
  toConversationDto,
  toMessageDto,
  toViewer,
} from '#src/conversations/conversation-dto.mapper.js';
import {
  findVisibleConversation,
  readError,
  toConversationId,
} from '#src/conversations/conversations.service.js';
import { GetConversationsDto } from '#src/conversations/dto/get-conversations.dto.js';
import { CreateMessageDto } from './dto/create-message.dto.js';
import { Conversation } from '#src/conversations/entities/conversation.entity.js';
import { Message } from './entities/message.entity.js';

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
        readerId: user.sub,
      });
      return {
        data: items.map((m) => toMessageDto(m, user.sub)),
        ...paginate(total, page, limit, items.length, url),
      };
    } catch (error) {
      readError(error);
    }
  }

  /**
   * Marca la conversación como leída por quien llama (US-64) y la devuelve
   * proyectada, ya con `unseen: 0`. El admin ignora la respuesta. Ajena,
   * inexistente o id no numérico ⇒ 404, sin escribir nada.
   */
  async markSeen(
    param: string,
    user: CurrentUserPayload,
  ): Promise<Conversation> {
    const id = toConversationId(param);
    let record: ConversationDetailRecord | null;
    try {
      record = await markConversationSeen(id, toViewer(user));
    } catch (error) {
      readError(error);
    }
    if (!record) {
      throw new NotFoundException(`No existe una conversación con id ${id}.`);
    }
    return toConversationDto(record, user.sub);
  }
}
