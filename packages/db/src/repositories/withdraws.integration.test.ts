/**
 * Test de integración contra el Postgres real (sembrado por `just db-up`: 2
 * retiros de la tienda 3, ids 1 y 2). US-62.
 *
 * Escrituras con el centinela `zz-withdraws-`: un dueño con su tienda y los
 * retiros creados en el test. La tienda se borra antes que el usuario
 * (`shops.owner_id` es RESTRICT) y se lleva sus retiros (CASCADE). Ninguna
 * fila sembrada se modifica.
 */

import 'dotenv/config';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../client';
import { _setNowProvider } from '../clock';
import {
  InvalidFieldValueError,
  InvalidReferenceError,
  RecordNotFoundError,
} from '../domain-errors';
import {
  createWithdraw,
  deleteWithdraw,
  findWithdrawById,
  listWithdraws,
  updateWithdrawStatus,
} from './withdraws.repository';

const SENTINEL = 'zz-withdraws-';
const SEED_OWNER = 1;
let ownerId: number;
let shopId: number;

beforeAll(async () => {
  const owner = await prisma.user.create({
    data: {
      name: `${SENTINEL}owner`,
      email: `${SENTINEL}owner@demo.com`,
      passwordHash: 'x',
    },
  });
  ownerId = Number(owner.id);
  const shop = await prisma.shop.create({
    data: {
      name: `${SENTINEL}shop`,
      slug: `${SENTINEL}shop`,
      ownerId: owner.id,
    },
  });
  shopId = Number(shop.id);
});

afterEach(() => {
  _setNowProvider(() => new Date());
});

afterAll(async () => {
  await prisma.shop.deleteMany({ where: { slug: { startsWith: SENTINEL } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: SENTINEL } } });
  await prisma.$disconnect();
});

describe('withdraws — seed y filtros', () => {
  it('lista las 2 sembradas en id DESC con su tienda y los valores del mock', async () => {
    const { items, total } = await listWithdraws({ shopId: 3 });
    expect(total).toBe(2);
    expect(items.map((w) => w.id)).toEqual([2, 1]);
    expect(items[0]).toMatchObject({
      shopId: 3,
      amount: 10,
      paymentMethod: 'cash',
      status: 'pending',
    });
    expect(items[1]).toMatchObject({
      amount: 300,
      paymentMethod: 'Bkash',
      status: 'approved',
    });
    expect(items[1].createdAt.toISOString()).toBe('2023-11-06T17:49:43.000Z');
    expect(items[1].updatedAt.toISOString()).toBe('2023-11-06T17:51:11.000Z');
    expect(items.every((w) => w.shop.id === 3)).toBe(true);
  });

  it('status y ownerId filtran; un dueño sin retiros no ve los de otro', async () => {
    expect(
      (await listWithdraws({ status: 'pending', shopId: 3 })).items.map(
        (w) => w.id
      )
    ).toEqual([2]);
    expect(
      (await listWithdraws({ ownerId: SEED_OWNER, shopId: 3 })).total
    ).toBe(2);
    expect(await listWithdraws({ ownerId, shopId: 3 })).toEqual({
      items: [],
      total: 0,
    });
    expect((await listWithdraws({ ownerId })).total).toBe(0);
  });
});

describe('withdraws — escrituras', () => {
  it('create nace pending; update cambia status y fija updated_at con el reloj; delete borra', async () => {
    const created = await createWithdraw({
      shopId,
      amount: 25.5,
      paymentMethod: 'cash',
      note: `${SENTINEL}nota`,
    });
    expect(created).toMatchObject({
      shopId,
      amount: 25.5,
      status: 'pending',
      details: null,
      note: `${SENTINEL}nota`,
    });
    expect((await listWithdraws({ ownerId })).items.map((w) => w.id)).toEqual([
      created.id,
    ]);

    const fixed = new Date('2030-01-01T00:00:00.000Z');
    _setNowProvider(() => fixed);
    const updated = await updateWithdrawStatus(created.id, 'on_hold');
    expect(updated.status).toBe('on_hold');
    expect(updated.updatedAt.toISOString()).toBe(fixed.toISOString());

    expect((await deleteWithdraw(created.id)).id).toBe(created.id);
    expect(await findWithdrawById(created.id)).toBeNull();
  });

  it('valida amount, status, tienda inexistente e id inexistente', async () => {
    for (const amount of [0, -1, Number.NaN, 1e10]) {
      await expect(
        createWithdraw({ shopId, amount, paymentMethod: 'cash' })
      ).rejects.toBeInstanceOf(InvalidFieldValueError);
    }
    await expect(
      createWithdraw({ shopId: 999999, amount: 1, paymentMethod: 'cash' })
    ).rejects.toBeInstanceOf(InvalidReferenceError);
    await expect(updateWithdrawStatus(2, 'Approved')).rejects.toBeInstanceOf(
      InvalidFieldValueError
    );
    await expect(
      updateWithdrawStatus(999999, 'approved')
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(deleteWithdraw(999999)).rejects.toBeInstanceOf(
      RecordNotFoundError
    );
    expect((await findWithdrawById(2))?.status).toBe('pending');
  });
});
