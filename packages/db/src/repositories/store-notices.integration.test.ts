/**
 * Test de integración contra el Postgres real (sembrado por `just db-up`:
 * 3 avisos del admin, id 3 en el seed, dirigidos a los usuarios 3 y 1; el 3
 * los leyó y el 1 no). US-51.
 *
 * Las escrituras usan el centinela `zz-notice-` en el texto del aviso. La
 * prueba de lectura sobre el aviso 3 del seed se deshace en `afterAll`
 * (otras corridas asertan que el usuario 1 no lo leyó).
 */

import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { _setNowProvider } from '../clock';
import { prisma } from '../client';
import {
  InvalidFieldValueError,
  InvalidReferenceError,
  RecordNotFoundError,
} from '../domain-errors';
import {
  createStoreNotice,
  deleteStoreNotice,
  findStoreNoticeById,
  listStoreNotices,
  markStoreNoticeRead,
  updateStoreNotice,
} from './store-notices.repository';

const SENTINEL_PREFIX = 'zz-notice-';
const ADMIN = 3;
const OWNER = 1;
const CUSTOMER = 2;
const FUTURE = new Date('2030-01-01T00:00:00.000Z');

const cleanup = () =>
  prisma.storeNotice.deleteMany({ where: { notice: { startsWith: SENTINEL_PREFIX } } });

beforeAll(cleanup);

afterAll(async () => {
  try {
    await cleanup();
    await prisma.storeNoticeRead.update({
      where: { storeNoticeId_userId: { storeNoticeId: 3, userId: OWNER } },
      data: { isRead: false },
    });
  } finally {
    await prisma.$disconnect();
  }
});

describe('listStoreNotices / findStoreNoticeById — seed', () => {
  it('3 avisos en id DESC, todos del admin (6 del mock resuelto a 3)', async () => {
    const { items, total } = await listStoreNotices();
    expect(total).toBe(3);
    expect(items.map((n) => n.id)).toEqual([3, 2, 1]);
    expect(items.every((n) => n.createdBy === ADMIN && n.creator.email === 'admin@demo.com')).toBe(
      true
    );
    expect(items.map((n) => n.updatedBy)).toEqual([null, ADMIN, null]);
  });

  it('el detalle trae creador con permisos, destinatarios y lecturas en orden fijo', async () => {
    const notice = await findStoreNoticeById(2);
    expect(notice?.creator.permissions.map((p) => p.name)).toEqual([
      'super_admin',
      'customer',
      'store_owner',
    ]);
    expect(notice?.recipients.map((u) => u.id)).toEqual([ADMIN, OWNER]);
    expect(notice?.reads.map((r) => [r.user.id, r.isRead])).toEqual([
      [ADMIN, true],
      [OWNER, false],
    ]);
    expect(notice?.shops).toEqual([]);
    expect(notice?.effectiveFrom?.toISOString()).toBe('2023-03-15T12:00:00.000Z');
    expect(await findStoreNoticeById(999_999)).toBeNull();
  });

  it('filtra por texto, por destinatario y por tienda', async () => {
    expect((await listStoreNotices({ notice: 'DELIVERY' })).items.map((n) => n.id)).toEqual([2]);
    expect((await listStoreNotices({ userId: OWNER })).total).toBe(3);
    expect((await listStoreNotices({ userId: CUSTOMER })).total).toBe(0);
    expect((await listStoreNotices({ shopSlug: 'furniture-shop' })).total).toBe(0);
  });

  it('respeta orderBy=updatedAt con desempate por id', async () => {
    const { items } = await listStoreNotices({ orderBy: 'updatedAt', sortedBy: 'desc' });
    const stamps = items.map((n) => n.updatedAt.getTime());
    expect(stamps).toEqual([...stamps].sort((a, b) => b - a));
  });
});

// ---------------------------------------------------------------------------
// Escrituras — NO INSERTAR LECTURAS DEL SEED DEBAJO DE ESTA LÍNEA.
// ---------------------------------------------------------------------------

describe('createStoreNotice — destinatarios según type', () => {
  it('specific_vendor con [1] deja 1 destinatario y 1 lectura sin leer', async () => {
    const created = await createStoreNotice({
      priority: 'high',
      notice: `${SENTINEL_PREFIX}especifico`,
      expiredAt: FUTURE,
      type: 'specific_vendor',
      receivedBy: [OWNER],
      createdBy: ADMIN,
    });
    expect(created.recipients.map((u) => u.id)).toEqual([OWNER]);
    expect(created.reads.map((r) => [r.user.id, r.isRead])).toEqual([[OWNER, false]]);
    expect(created.creator.id).toBe(ADMIN);
  });

  it('all_vendor va a todos los store_owner (1 y 3 en el seed)', async () => {
    const created = await createStoreNotice({
      priority: 'low',
      notice: `${SENTINEL_PREFIX}todos`,
      expiredAt: FUTURE,
      type: 'all_vendor',
      createdBy: ADMIN,
    });
    expect(created.recipients.map((u) => u.id)).toEqual([ADMIN, OWNER]);
  });

  it('specific_shop va a las tiendas y no crea lecturas', async () => {
    const created = await createStoreNotice({
      priority: 'medium',
      notice: `${SENTINEL_PREFIX}tienda`,
      expiredAt: FUTURE,
      type: 'specific_shop',
      receivedBy: [2, 1],
      createdBy: ADMIN,
    });
    expect(created.shops.map((s) => s.id)).toEqual([1, 2]);
    expect(created.reads).toEqual([]);
    expect((await listStoreNotices({ shopId: 2 })).items.map((n) => n.id)).toEqual([created.id]);
  });

  it('un id de received_by inexistente ⇒ InvalidReferenceError sin filas sueltas', async () => {
    const before = await prisma.storeNotice.count();
    await expect(
      createStoreNotice({
        priority: 'high',
        notice: `${SENTINEL_PREFIX}huerfano`,
        expiredAt: FUTURE,
        type: 'specific_vendor',
        receivedBy: [999],
        createdBy: ADMIN,
      })
    ).rejects.toBeInstanceOf(InvalidReferenceError);
    expect(await prisma.storeNotice.count()).toBe(before);
  });

  it('priority, type o vigencia fuera de su CHECK ⇒ InvalidFieldValueError', async () => {
    const base = {
      notice: `${SENTINEL_PREFIX}malo`,
      expiredAt: FUTURE,
      createdBy: ADMIN,
    };
    await expect(
      createStoreNotice({ ...base, priority: 'urgent', type: 'all_vendor' })
    ).rejects.toBeInstanceOf(InvalidFieldValueError);
    await expect(
      createStoreNotice({ ...base, priority: 'high', type: 'everyone' })
    ).rejects.toBeInstanceOf(InvalidFieldValueError);
    await expect(
      createStoreNotice({
        ...base,
        priority: 'high',
        type: 'all_vendor',
        effectiveFrom: new Date('2031-01-01T00:00:00Z'),
      })
    ).rejects.toBeInstanceOf(InvalidFieldValueError);
  });
});

describe('updateStoreNotice', () => {
  it('reconcilia destinatarios, conserva la lectura de quien sigue y fija updatedBy/updatedAt', async () => {
    try {
      const created = await createStoreNotice({
        priority: 'high',
        notice: `${SENTINEL_PREFIX}editar`,
        expiredAt: FUTURE,
        type: 'specific_vendor',
        receivedBy: [OWNER, CUSTOMER],
        createdBy: ADMIN,
      });
      await markStoreNoticeRead(created.id, OWNER);
      const future = new Date(Date.now() + 60_000);
      _setNowProvider(() => future);

      const updated = await updateStoreNotice(created.id, {
        notice: `${SENTINEL_PREFIX}editado`,
        receivedBy: [OWNER, ADMIN],
        updatedBy: ADMIN,
      });
      expect(updated.notice).toBe(`${SENTINEL_PREFIX}editado`);
      expect(updated.recipients.map((u) => u.id)).toEqual([ADMIN, OWNER]);
      expect(updated.reads.map((r) => [r.user.id, r.isRead])).toEqual([
        [ADMIN, false],
        [OWNER, true],
      ]);
      expect(updated.updatedBy).toBe(ADMIN);
      expect(updated.updatedAt.getTime()).toBe(future.getTime());
    } finally {
      _setNowProvider(() => new Date());
    }
  });

  it('id inexistente ⇒ RecordNotFoundError', async () => {
    await expect(updateStoreNotice(999_999, { notice: 'x', updatedBy: ADMIN })).rejects.toBeInstanceOf(
      RecordNotFoundError
    );
  });
});

describe('markStoreNoticeRead / deleteStoreNotice', () => {
  it('la lectura es por usuario: el 1 lee el aviso 3 y el admin no cambia', async () => {
    const read = await markStoreNoticeRead(3, OWNER);
    expect(read.reads.map((r) => [r.user.id, r.isRead])).toEqual([
      [ADMIN, true],
      [OWNER, true],
    ]);
    await expect(markStoreNoticeRead(999_999, OWNER)).rejects.toBeInstanceOf(RecordNotFoundError);
  });

  it('borra en cascada y devuelve el aviso con su detalle', async () => {
    const created = await createStoreNotice({
      priority: 'low',
      notice: `${SENTINEL_PREFIX}borrar`,
      expiredAt: FUTURE,
      type: 'all_vendor',
      createdBy: ADMIN,
    });
    const deleted = await deleteStoreNotice(created.id);
    expect(deleted.recipients).toHaveLength(2);
    expect(await prisma.storeNoticeUser.count({ where: { storeNoticeId: created.id } })).toBe(0);
    expect(await prisma.storeNoticeRead.count({ where: { storeNoticeId: created.id } })).toBe(0);
    await expect(deleteStoreNotice(created.id)).rejects.toBeInstanceOf(RecordNotFoundError);
  });
});
