import type {
  ConversationDetailRecord,
  ConversationViewer,
  MessageDetailRecord,
  MessageRecord,
} from '@safari/db';
import { CurrentUserPayload } from 'src/auth/decorators/current-user.decorator';
import { toShopDto } from 'src/shops/shops.service';
import { Message } from 'src/messages/entities/message.entity';
import { Conversation } from './entities/conversation.entity';

/** Visibilidad (US-56): super_admin ve todo; el resto, lo suyo y lo de sus tiendas. */
export function toViewer(user: CurrentUserPayload): ConversationViewer {
  return { userId: user.sub, seeAll: user.permissions.includes('super_admin') };
}

/**
 * `unseen` para quien consulta (US-64; reemplaza la regla provisional de
 * US-56). `0` si no hay mensajes, si el último es suyo o si lo leyó: su
 * `lastSeenAt` es igual o posterior al `created_at` del último mensaje. `1`
 * en cualquier otro caso. Las dos marcas salen de `now()` de `clock.ts`.
 */
function unseen(record: ConversationDetailRecord, viewerId: number): number {
  const latest = record.latestMessage;
  if (!latest || latest.userId === viewerId) return 0;
  if (record.lastSeenAt && latest.createdAt.getTime() <= record.lastSeenAt.getTime()) return 0;
  return 1;
}

/**
 * Forma de `conversations.json` sin `__typename` (V-3): ids como STRING,
 * igual que el mock y los tipos del admin; `unseen` como número; `shop` con
 * `toShopDto` (V-6); `latest_message` calculado (V-1, V-2), ids string.
 */
export function toConversationDto(record: ConversationDetailRecord, viewerId: number): Conversation {
  const latest = record.latestMessage;
  return {
    user_id: String(record.userId),
    id: String(record.id),
    shop_id: String(record.shopId),
    unseen: unseen(record, viewerId),
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    shop: toShopDto(record.shop),
    user: {
      id: String(record.user.id),
      name: record.user.name,
      email: record.user.email,
      profile: null,
      address: [],
      wallet: null,
      is_active: record.user.isActive,
    },
    latest_message: latest && {
      body: latest.body,
      conversation_id: String(latest.conversationId),
      created_at: latest.createdAt,
      updated_at: latest.updatedAt,
      user_id: String(latest.userId),
      id: String(latest.id),
    },
  } as unknown as Conversation;
}

/** El `latest_message` embebido en `messages.json` lleva ids NÚMERO. */
function toEmbeddedMessage(m: MessageRecord) {
  return {
    id: m.id,
    conversation_id: m.conversationId,
    user_id: m.userId,
    body: m.body,
    created_at: m.createdAt,
    updated_at: m.updatedAt,
  };
}

/**
 * Forma de `messages.json`: ids NÚMERO y la conversación embebida con su
 * propio orden de claves y su `user` en la forma mínima de Laravel.
 */
export function toMessageDto(record: MessageDetailRecord, viewerId: number): Message {
  const c = record.conversation;
  return {
    id: record.id,
    conversation_id: record.conversationId,
    user_id: record.userId,
    body: record.body,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    conversation: {
      id: c.id,
      user_id: c.userId,
      shop_id: c.shopId,
      created_at: c.createdAt,
      updated_at: c.updatedAt,
      latest_message: c.latestMessage && toEmbeddedMessage(c.latestMessage),
      unseen: unseen(c, viewerId),
      shop: toShopDto(c.shop),
      user: {
        id: c.user.id,
        name: c.user.name,
        email: c.user.email,
        email_verified_at: c.user.emailVerifiedAt,
        created_at: c.user.createdAt,
        updated_at: c.user.updatedAt,
        is_active: c.user.isActive ? 1 : 0,
        shop_id: null,
        profile: null,
      },
    },
  } as unknown as Message;
}
