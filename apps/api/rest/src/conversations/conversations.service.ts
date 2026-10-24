import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CONVERSATION_SORTABLE,
  findConversationById,
  findOrCreateConversation,
  getUserFriendlyMessage,
  isPrismaConnectionError,
  listConversations,
  type ConversationDetailRecord,
  type ConversationSortField,
} from '@safari/db';
import { CurrentUserPayload } from 'src/auth/decorators/current-user.decorator';
import { paginate } from 'src/common/pagination/paginate';
import { toWriteHttpException } from 'src/common/errors/domain-error.mapper';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { GetConversationsDto } from './dto/get-conversations.dto';
import { Conversation } from './entities/conversation.entity';
import { toConversationDto, toViewer } from './conversation-dto.mapper';

export function readError(error: unknown): never {
  if (isPrismaConnectionError(error)) {
    throw new ServiceUnavailableException(getUserFriendlyMessage(error));
  }
  throw new InternalServerErrorException(getUserFriendlyMessage(error));
}

/** Id de conversación o 404 (un id no numérico tampoco existe). */
export function toConversationId(param: unknown): number {
  const id = Number(param);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new NotFoundException(
      `No existe una conversación con id ${String(param)}.`,
    );
  }
  return id;
}

/**
 * Busca la conversación visible para quien llama; ajena o inexistente ⇒ 404
 * (V-10). Lo usan este servicio y el de mensajes.
 */
export async function findVisibleConversation(
  param: unknown,
  user: CurrentUserPayload,
): Promise<ConversationDetailRecord> {
  const id = toConversationId(param);
  let record: ConversationDetailRecord | null;
  try {
    record = await findConversationById(id, toViewer(user));
  } catch (error) {
    readError(error);
  }
  if (!record) {
    throw new NotFoundException(`No existe una conversación con id ${id}.`);
  }
  return record;
}

@Injectable()
export class ConversationsService {
  /**
   * Una conversación por (usuario, tienda): devuelve la existente o la crea
   * (V-12). El admin manda también `via`, que se ignora. Tienda inexistente
   * ⇒ 400 por `InvalidReferenceError`.
   */
  async create(
    dto: CreateConversationDto,
    user: CurrentUserPayload,
  ): Promise<Conversation> {
    const shopId = Number(dto.shop_id);
    if (!Number.isSafeInteger(shopId) || shopId <= 0) {
      throw new BadRequestException(
        `\`shop_id\` no admite \`${String(dto.shop_id)}\`.`,
      );
    }
    try {
      return toConversationDto(
        await findOrCreateConversation(user.sub, shopId),
        user.sub,
      );
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /**
   * Paginador real con `limit` 15 por defecto (V-8). Respeta
   * `orderBy=updated_at&sortedBy=desc` del admin (V-9); sin `orderBy`, `id
   * ASC`. `search` es texto libre sobre el nombre de la tienda (el admin lo
   * manda sin `clave:`; si llega con clave, se usa el valor).
   */
  async getAllConversations(
    { page, limit, search, orderBy, sortedBy }: GetConversationsDto,
    user: CurrentUserPayload,
  ) {
    if (!page) page = 1;
    if (!limit) limit = 15;
    const url = `/conversations?limit=${limit}`;
    const sortField = (CONVERSATION_SORTABLE as readonly string[]).includes(
      orderBy ?? '',
    )
      ? (orderBy as ConversationSortField)
      : undefined;
    const text = search?.includes(':')
      ? search.slice(search.indexOf(':') + 1)
      : search;
    try {
      const { items, total } = await listConversations({
        viewer: toViewer(user),
        shopName: text?.trim() || undefined,
        orderBy: sortField,
        sortedBy: String(sortedBy).toLowerCase() === 'desc' ? 'desc' : 'asc',
        page: Number(page),
        limit: Number(limit),
      });
      return {
        data: items.map((c) => toConversationDto(c, user.sub)),
        ...paginate(total, page, limit, items.length, url),
      };
    } catch (error) {
      readError(error);
    }
  }

  /** Por `id` (V-10), no por `latest_message.conversation_id`. */
  async getConversation(
    param: string,
    user: CurrentUserPayload,
  ): Promise<Conversation> {
    return toConversationDto(
      await findVisibleConversation(param, user),
      user.sub,
    );
  }
}
