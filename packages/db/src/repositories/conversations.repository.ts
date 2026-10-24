/**
 * conversations.repository.ts — mensajería usuario ↔ tienda (US-56).
 *
 * Un solo agregado: la conversación y sus mensajes. Las lecturas devuelven
 * `ConversationDetailRecord`, con el usuario, la tienda y el último mensaje.
 * `latestMessage` sale de UNA consulta `DISTINCT ON (conversation_id)` sobre
 * los ids de la página (`messages_conversacion_idx` la sirve), no de una por
 * conversación. Se descartó el `include` con `take: 1` porque Prisma trae
 * todos los mensajes de la página y recorta en memoria.
 *
 * Visibilidad (`ConversationViewer`): con `seeAll` (super_admin) se ve todo;
 * si no, las conversaciones propias (`userId`) y las de las tiendas que el
 * usuario posee (`shops.owner_id`). La decide la API; aquí es un filtro.
 *
 * `unseen` no vive aquí: depende de quién consulta y lo calcula la API. Lo
 * que sí sale de aquí es `lastSeenAt`, la última lectura de ese lector
 * (`conversation_reads`, US-64), también en una sola consulta por página.
 */

import { Prisma } from '../../generated/prisma/client/client';
import { prisma } from '../client';
import { now } from '../clock';
import {
  InvalidFieldValueError,
  RecordNotFoundError,
  translateCatalogWriteError,
} from '../domain-errors';
import {
  _toConversationRecord,
  _toMessageRecord,
  _toShopRecord,
  _toUserRecord,
  type ConversationRecord,
  type MessageRecord,
  type ShopRecord,
  type UserRecord,
} from '../records';

export interface ConversationViewer {
  userId: number;
  /** `true` para super_admin: ve todas las conversaciones. */
  seeAll: boolean;
}

export interface ConversationDetailRecord extends ConversationRecord {
  user: UserRecord;
  shop: ShopRecord;
  /** `null` si la conversación no tiene mensajes. */
  latestMessage: MessageRecord | null;
  /**
   * Última lectura de quien consulta (US-64). `null` si nunca la marcó o si
   * la consulta no tiene lector.
   */
  lastSeenAt: Date | null;
}

export interface MessageDetailRecord extends MessageRecord {
  conversation: ConversationDetailRecord;
}

/** Columnas por las que el admin puede ordenar (`orderBy=updated_at`). */
export const CONVERSATION_SORTABLE = ['id', 'created_at', 'updated_at'] as const;
export type ConversationSortField = (typeof CONVERSATION_SORTABLE)[number];

const SORT_COLUMN: Record<ConversationSortField, 'id' | 'createdAt' | 'updatedAt'> = {
  id: 'id',
  created_at: 'createdAt',
  updated_at: 'updatedAt',
};

const CONVERSATION_INCLUDE = { user: true, shop: true } satisfies Prisma.ConversationInclude;

type ConversationPayload = Prisma.ConversationGetPayload<{ include: typeof CONVERSATION_INCLUDE }>;

function _visibleWhere(viewer?: ConversationViewer): Prisma.ConversationWhereInput {
  if (!viewer || viewer.seeAll) return {};
  return { OR: [{ userId: viewer.userId }, { shop: { ownerId: viewer.userId } }] };
}

interface LatestRow {
  id: bigint;
  conversation_id: bigint;
  user_id: bigint;
  body: string;
  created_at: Date;
  updated_at: Date;
}

/** Último mensaje de cada conversación, en una sola consulta. */
async function _latestMessages(ids: bigint[]): Promise<Map<number, MessageRecord>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.$queryRaw<LatestRow[]>`
    SELECT DISTINCT ON (conversation_id)
           id, conversation_id, user_id, body, created_at, updated_at
      FROM messages
     WHERE conversation_id IN (${Prisma.join(ids)})
     ORDER BY conversation_id, created_at DESC, id DESC`;
  return new Map(
    rows.map((r) => [
      Number(r.conversation_id),
      _toMessageRecord({
        id: r.id,
        conversationId: r.conversation_id,
        userId: r.user_id,
        body: r.body,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }),
    ])
  );
}

/** Última lectura de `readerId` en cada conversación, en una sola consulta. */
async function _lastSeen(ids: bigint[], readerId?: number): Promise<Map<number, Date>> {
  if (ids.length === 0 || readerId === undefined) return new Map();
  const rows = await prisma.conversationRead.findMany({
    where: { userId: readerId, conversationId: { in: ids } },
  });
  return new Map(rows.map((r) => [Number(r.conversationId), r.lastSeenAt]));
}

async function _toDetails(rows: ConversationPayload[], readerId?: number): Promise<ConversationDetailRecord[]> {
  const ids = rows.map((r) => r.id);
  const [latest, seen] = await Promise.all([_latestMessages(ids), _lastSeen(ids, readerId)]);
  return rows.map((row) => {
    const record = _toConversationRecord(row);
    return {
      ...record,
      user: _toUserRecord(row.user),
      shop: _toShopRecord(row.shop),
      latestMessage: latest.get(record.id) ?? null,
      lastSeenAt: seen.get(record.id) ?? null,
    };
  });
}

/** Una conversación por `where`, con la lectura de `readerId`; `null` si no está. */
async function _findDetail(
  where: Prisma.ConversationWhereInput,
  readerId?: number
): Promise<ConversationDetailRecord | null> {
  const row = await prisma.conversation.findFirst({ where, include: CONVERSATION_INCLUDE });
  if (!row) return null;
  return (await _toDetails([row], readerId))[0];
}

export interface ListConversationsInput {
  viewer?: ConversationViewer;
  /** Texto parcial del nombre de la tienda, case-insensitive. */
  shopName?: string;
  orderBy?: ConversationSortField;
  sortedBy?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

/** Paginado; sin `orderBy`, `id ASC`. Desempate siempre por `id`. */
export async function listConversations(
  input: ListConversationsInput = {}
): Promise<{ items: ConversationDetailRecord[]; total: number }> {
  const page = Math.max(1, input.page ?? 1);
  const limit = input.limit ?? 15;
  // AND explícito: la visibilidad usa `shop` dentro de un OR y la búsqueda
  // también filtra por `shop`; con un spread una pisaría a la otra.
  const where: Prisma.ConversationWhereInput = {
    AND: [
      _visibleWhere(input.viewer),
      input.shopName ? { shop: { name: { contains: input.shopName, mode: 'insensitive' } } } : {},
    ],
  };
  const direction = input.sortedBy ?? 'asc';
  const orderBy: Prisma.ConversationOrderByWithRelationInput[] = input.orderBy
    ? [{ [SORT_COLUMN[input.orderBy]]: direction }, { id: direction }]
    : [{ id: 'asc' }];
  const [rows, total] = await Promise.all([
    prisma.conversation.findMany({
      where,
      orderBy,
      include: CONVERSATION_INCLUDE,
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.conversation.count({ where }),
  ]);
  return { items: await _toDetails(rows, input.viewer?.userId), total };
}

/** La conversación si existe y es visible para `viewer`; si no, `null`. */
export async function findConversationById(
  id: number,
  viewer?: ConversationViewer
): Promise<ConversationDetailRecord | null> {
  return _findDetail({ id, ..._visibleWhere(viewer) }, viewer?.userId);
}

/**
 * Marca la conversación como leída por `viewer` (US-64): upsert de
 * `last_seen_at = now()`, así que repetirla solo mueve la marca. Devuelve la
 * conversación con esa lectura, o `null` si no existe o no es visible para
 * él, sin escribir nada.
 */
export async function markConversationSeen(
  id: number,
  viewer: ConversationViewer
): Promise<ConversationDetailRecord | null> {
  const row = await prisma.conversation.findFirst({
    where: { id, ..._visibleWhere(viewer) },
    include: CONVERSATION_INCLUDE,
  });
  if (!row) return null;
  const stamp = now();
  await prisma.conversationRead.upsert({
    where: { conversationId_userId: { conversationId: id, userId: viewer.userId } },
    create: { conversationId: id, userId: viewer.userId, lastSeenAt: stamp },
    update: { lastSeenAt: stamp },
  });
  return (await _toDetails([row], viewer.userId))[0];
}

/**
 * Una conversación por (usuario, tienda): devuelve la existente o la crea.
 * Una tienda inexistente da `InvalidReferenceError` (`shop_id`).
 */
export async function findOrCreateConversation(
  userId: number,
  shopId: number
): Promise<ConversationDetailRecord> {
  try {
    const row = await prisma.conversation.upsert({
      where: { userId_shopId: { userId, shopId } },
      create: { userId, shopId },
      update: {},
      include: CONVERSATION_INCLUDE,
    });
    return (await _toDetails([row]))[0];
  } catch (error) {
    throw translateCatalogWriteError(error, { aggregate: 'conversations', uniqueField: 'shop_id' });
  }
}

/**
 * Mensajes de una conversación, `id DESC`, con la conversación embebida. La
 * visibilidad la comprueba la API antes; `readerId` solo trae su lectura.
 */
export async function listMessages(
  conversationId: number,
  input: { page?: number; limit?: number; readerId?: number } = {}
): Promise<{ items: MessageDetailRecord[]; total: number }> {
  const page = Math.max(1, input.page ?? 1);
  const limit = input.limit ?? 15;
  const conversation = await _findDetail({ id: conversationId }, input.readerId);
  if (!conversation) {
    throw new RecordNotFoundError('conversations', conversationId);
  }
  const where = { conversationId };
  const [rows, total] = await Promise.all([
    prisma.message.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
    prisma.message.count({ where }),
  ]);
  return { items: rows.map((row) => ({ ..._toMessageRecord(row), conversation })), total };
}

/**
 * Inserta el mensaje y fija `conversations.updated_at = now()` en la misma
 * transacción, para que la conversación suba al ordenar por `updated_at`. Es
 * la única escritura sobre `conversations` además del alta.
 */
export async function createMessage(input: {
  conversationId: number;
  userId: number;
  body: string;
}): Promise<MessageDetailRecord> {
  if (typeof input.body !== 'string' || input.body.trim().length === 0) {
    throw new InvalidFieldValueError('messages', 'body', input.body ?? '', 'messages_body_check');
  }
  const stamp = now();
  try {
    const [, row] = await prisma.$transaction([
      prisma.conversation.update({ where: { id: input.conversationId }, data: { updatedAt: stamp } }),
      prisma.message.create({
        data: {
          conversationId: input.conversationId,
          userId: input.userId,
          body: input.body,
          createdAt: stamp,
          updatedAt: stamp,
        },
      }),
    ]);
    // El lector es el autor: su propio mensaje nunca cuenta como sin leer.
    const conversation = await _findDetail({ id: input.conversationId }, input.userId);
    if (!conversation) throw new RecordNotFoundError('conversations', input.conversationId);
    return { ..._toMessageRecord(row), conversation };
  } catch (error) {
    throw translateCatalogWriteError(error, { aggregate: 'conversations', id: input.conversationId });
  }
}
