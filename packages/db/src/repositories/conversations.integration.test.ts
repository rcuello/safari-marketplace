/**
 * Test de integración contra el Postgres real (sembrado por `just db-up`:
 * conversaciones 1 (admin ↔ tienda 7, 5 mensajes) y 6 (admin ↔ tienda 2,
 * sin mensajes); las 12 tiendas son del usuario 1). US-56.
 *
 * Las escrituras crean conversaciones y mensajes nuevos (ids > 6 y > 5) y
 * tocan el `updated_at` de la conversación 1: `afterAll` lo devuelve todo al
 * estado sembrado. Las lecturas de US-64 escriben en `conversation_reads`,
 * que el seed deja vacía y la limpieza vacía otra vez.
 */

import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../client';
import { _setNowProvider } from '../clock';
import {
  InvalidFieldValueError,
  InvalidReferenceError,
  RecordNotFoundError,
} from '../domain-errors';
import {
  createMessage,
  findConversationById,
  findOrCreateConversation,
  listConversations,
  listMessages,
  markConversationSeen,
} from './conversations.repository';

const OWNER = 1;
const CUSTOMER = 2;
const ADMIN = 3;
const SEEDED_UPDATED_AT = new Date('2023-03-11T03:17:23.000Z');

const cleanup = async () => {
  await prisma.conversationRead.deleteMany({});
  await prisma.message.deleteMany({ where: { id: { gt: 5 } } });
  await prisma.conversation.deleteMany({ where: { id: { notIn: [1, 6] } } });
  await prisma.conversation.update({
    where: { id: 1 },
    data: { updatedAt: SEEDED_UPDATED_AT },
  });
};

beforeAll(cleanup);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe('lecturas — seed', () => {
  it('sin orderBy, id ASC; latestMessage calculado (5 en la 1, null en la 6)', async () => {
    const { items, total } = await listConversations();
    expect(total).toBe(2);
    expect(items.map((c) => c.id)).toEqual([1, 6]);
    expect(items[0]).toMatchObject({ userId: ADMIN, shopId: 7 });
    expect(items[0].latestMessage).toMatchObject({
      id: 5,
      body: 'New test',
      userId: ADMIN,
    });
    expect(items[1].latestMessage).toBeNull();
    expect(items[0].user.email).toBe('admin@demo.com');
    expect(items[0].shop.id).toBe(7);
  });

  it('respeta orderBy=updated_at desc y filtra por nombre de tienda', async () => {
    const byUpdated = await listConversations({
      orderBy: 'updated_at',
      sortedBy: 'desc',
    });
    expect(byUpdated.items.map((c) => c.id)).toEqual([6, 1]);
    const shop7 = await prisma.shop.findUniqueOrThrow({
      where: { id: 7 },
      select: { name: true },
    });
    const found = await listConversations({
      shopName: shop7.name.slice(0, 4).toLowerCase(),
    });
    expect(found.items.map((c) => c.id)).toContain(1);
  });

  it('visibilidad: super_admin todo, el dueño de las tiendas todo, un cliente nada', async () => {
    expect(
      (await listConversations({ viewer: { userId: ADMIN, seeAll: true } }))
        .total
    ).toBe(2);
    expect(
      (await listConversations({ viewer: { userId: OWNER, seeAll: false } }))
        .total
    ).toBe(2);
    expect(
      (await listConversations({ viewer: { userId: CUSTOMER, seeAll: false } }))
        .total
    ).toBe(0);
    expect(
      await findConversationById(1, { userId: CUSTOMER, seeAll: false })
    ).toBeNull();
    expect(
      (await findConversationById(1, { userId: ADMIN, seeAll: false }))?.id
    ).toBe(1);
    expect(await findConversationById(999)).toBeNull();
  });

  it('mensajes de una conversación en id DESC, paginados, con la conversación embebida', async () => {
    const { items, total } = await listMessages(1);
    expect(total).toBe(5);
    expect(items.map((m) => m.id)).toEqual([5, 4, 3, 2, 1]);
    expect(items.map((m) => m.userId)).toEqual([3, 1, 3, 3, 3]);
    expect(items[0].conversation.shopId).toBe(7);
    expect(
      (await listMessages(1, { page: 2, limit: 2 })).items.map((m) => m.id)
    ).toEqual([3, 2]);
    expect(await listMessages(6)).toMatchObject({ items: [], total: 0 });
    await expect(listMessages(999)).rejects.toBeInstanceOf(RecordNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// Escrituras — NO INSERTAR LECTURAS DEL SEED DEBAJO DE ESTA LÍNEA.
// ---------------------------------------------------------------------------

describe('findOrCreateConversation', () => {
  it('reutiliza la del par existente y crea una nueva para otro par', async () => {
    expect((await findOrCreateConversation(ADMIN, 7)).id).toBe(1);
    expect(await prisma.conversation.count()).toBe(2);
    const created = await findOrCreateConversation(CUSTOMER, 1);
    expect(created).toMatchObject({
      userId: CUSTOMER,
      shopId: 1,
      latestMessage: null,
    });
    expect((await findOrCreateConversation(CUSTOMER, 1)).id).toBe(created.id);
  });

  it('tienda inexistente ⇒ InvalidReferenceError', async () => {
    await expect(
      findOrCreateConversation(CUSTOMER, 999_999)
    ).rejects.toBeInstanceOf(InvalidReferenceError);
  });
});

describe('createMessage', () => {
  it('inserta, pasa a ser el último y sube el updated_at de la conversación', async () => {
    const stamp = new Date(Date.now() + 60_000);
    try {
      _setNowProvider(() => stamp);
      const message = await createMessage({
        conversationId: 1,
        userId: ADMIN,
        body: 'zz-msg',
      });
      expect(message).toMatchObject({
        conversationId: 1,
        userId: ADMIN,
        body: 'zz-msg',
      });
      expect(message.createdAt.getTime()).toBe(stamp.getTime());
      expect(message.conversation.updatedAt.getTime()).toBe(stamp.getTime());
      expect(message.conversation.latestMessage?.id).toBe(message.id);
      expect((await listMessages(1)).items[0].id).toBe(message.id);
    } finally {
      _setNowProvider(() => new Date());
    }
  });

  it('cuerpo vacío ⇒ InvalidFieldValueError; conversación inexistente ⇒ RecordNotFoundError', async () => {
    await expect(
      createMessage({ conversationId: 1, userId: ADMIN, body: '   ' })
    ).rejects.toBeInstanceOf(InvalidFieldValueError);
    await expect(
      createMessage({ conversationId: 999, userId: ADMIN, body: 'x' })
    ).rejects.toBeInstanceOf(RecordNotFoundError);
  });
});

describe('markConversationSeen — US-64', () => {
  const OWNER_VIEW = { userId: OWNER, seeAll: false };

  // Los bloques de arriba dejan una conversación y un mensaje nuevos hasta el `afterAll`.
  beforeAll(cleanup);

  it('el seed no trae lecturas: lastSeenAt null en lista, detalle y mensajes', async () => {
    expect(await prisma.conversationRead.count()).toBe(0);
    const { items } = await listConversations({ viewer: OWNER_VIEW });
    expect(items.map((c) => c.lastSeenAt)).toEqual([null, null]);
    expect((await findConversationById(1, OWNER_VIEW))?.lastSeenAt).toBeNull();
    expect(
      (await listMessages(1, { readerId: OWNER })).items[0].conversation
        .lastSeenAt
    ).toBeNull();
  });

  it('upsert de last_seen_at con el reloj: repetir mueve la marca, no duplica la fila', async () => {
    const first = new Date('2030-01-01T00:00:00.000Z');
    const second = new Date('2030-01-02T00:00:00.000Z');
    try {
      _setNowProvider(() => first);
      expect(
        (await markConversationSeen(1, OWNER_VIEW))?.lastSeenAt?.toISOString()
      ).toBe(first.toISOString());
      _setNowProvider(() => second);
      const again = await markConversationSeen(1, OWNER_VIEW);
      expect(again?.lastSeenAt?.toISOString()).toBe(second.toISOString());
      expect(again?.latestMessage?.id).toBe(5);
    } finally {
      _setNowProvider(() => new Date());
    }
    const rows = await prisma.conversationRead.findMany();
    expect(
      rows.map((r) => [Number(r.conversationId), Number(r.userId)])
    ).toEqual([[1, OWNER]]);

    // Cada lector ve solo su marca, en las tres lecturas.
    expect(
      (await listConversations({ viewer: OWNER_VIEW })).items.map(
        (c) => c.lastSeenAt?.toISOString() ?? null
      )
    ).toEqual([second.toISOString(), null]);
    expect(
      (await findConversationById(1, { userId: ADMIN, seeAll: true }))
        ?.lastSeenAt
    ).toBeNull();
    expect(
      (
        await listMessages(1, { readerId: OWNER })
      ).items[0].conversation.lastSeenAt?.toISOString()
    ).toBe(second.toISOString());
  });

  it('ajena o inexistente ⇒ null y no escribe nada', async () => {
    await prisma.conversationRead.deleteMany({});
    expect(
      await markConversationSeen(1, { userId: CUSTOMER, seeAll: false })
    ).toBeNull();
    expect(
      await markConversationSeen(999, { userId: ADMIN, seeAll: true })
    ).toBeNull();
    expect(await prisma.conversationRead.count()).toBe(0);
  });
});
