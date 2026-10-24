/**
 * Test de integración contra el Postgres real (sembrado por `just db-up`:
 * 10 cupones del mock, ids 10→1, todos aprobados y vencidos; tienda 1 → 6,
 * tienda 2 → 2, tienda 3 → 2). US-52.
 *
 * Las escrituras usan el centinela `zz-coupon-` en el código. Los cupones
 * del seed no se modifican.
 */

import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Prisma } from '../../generated/prisma/client/client';
import { _setNowProvider } from '../clock';
import { prisma } from '../client';
import {
  InvalidFieldValueError,
  InvalidReferenceError,
  RecordNotFoundError,
  SlugConflictError,
} from '../domain-errors';
import {
  createCoupon,
  deleteCoupon,
  findCouponByCode,
  findCouponById,
  listCoupons,
  setCouponApproval,
  updateCoupon,
} from './coupons.repository';

const SENTINEL_PREFIX = 'zz-coupon-';
const ADMIN = 3;
const FROM = new Date('2026-01-01T00:00:00.000Z');
const TO = new Date('2030-01-01T00:00:00.000Z');

const cleanup = () => prisma.coupon.deleteMany({ where: { code: { startsWith: SENTINEL_PREFIX } } });

beforeAll(cleanup);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe('listCoupons / findCouponByCode — seed', () => {
  it('10 cupones en id DESC, paginados con limit 12 por defecto', async () => {
    const { items, total } = await listCoupons();
    expect(total).toBe(10);
    expect(items.map((c) => c.id)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    const page2 = await listCoupons({ page: 2, limit: 4 });
    expect(page2.items.map((c) => c.id)).toEqual([6, 5, 4, 3]);
  });

  it('filtra por tienda y por código, combinados con AND', async () => {
    expect((await listCoupons({ shopId: 1 })).items.map((c) => c.id)).toEqual([10, 7, 6, 3, 2, 1]);
    expect((await listCoupons({ code: 'bazar' })).items.map((c) => c.code)).toEqual([
      'BAZAR10',
      'BAZAR20',
      'BAZAR18',
    ]);
    expect((await listCoupons({ shopId: 2, code: 'BAZAR' })).items.map((c) => c.code)).toEqual([
      'BAZAR18',
    ]);
  });

  it('el record trae números, booleanos y la imagen con su orden de claves', async () => {
    const c = await findCouponByCode('4OFF');
    expect(c).toMatchObject({
      id: 10,
      type: 'fixed',
      amount: 4,
      minimumCartAmount: 160,
      target: true,
      isApprove: true,
      shopId: 1,
      userId: null,
      language: 'en',
    });
    expect(Object.keys(c?.image as object)).toEqual(['thumbnail', 'original', 'id']);
    // US-68: el seed desplaza +5 años las fechas del mock (2024-03-28 en coupons.json).
    expect(c?.expireAt.toISOString()).toBe('2029-03-28T05:46:42.000Z');
    expect(await findCouponByCode('4off')).toBeNull();
    expect(await findCouponById(999_999)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Escrituras — NO INSERTAR LECTURAS DEL SEED DEBAJO DE ESTA LÍNEA.
// ---------------------------------------------------------------------------

describe('createCoupon', () => {
  it('nace sin aprobar, con su tienda y su autor', async () => {
    const created = await createCoupon({
      code: `${SENTINEL_PREFIX}nuevo`,
      type: 'percentage',
      amount: 15,
      minimumCartAmount: 50,
      activeFrom: FROM,
      expireAt: TO,
      image: { thumbnail: 't', original: 'o', id: 1 },
      shopId: 2,
      userId: ADMIN,
    });
    expect(created).toMatchObject({ isApprove: false, target: false, shopId: 2, userId: ADMIN });
    expect(Object.keys(created.image as object)).toEqual(['thumbnail', 'original', 'id']);
  });

  it('código duplicado ⇒ SlugConflictError; tienda inexistente ⇒ InvalidReferenceError', async () => {
    const base = { type: 'fixed', amount: 1, activeFrom: FROM, expireAt: TO };
    await expect(createCoupon({ ...base, code: '4OFF' })).rejects.toBeInstanceOf(SlugConflictError);
    // US-67: el texto nombra el campo real, no un slug.
    await expect(createCoupon({ ...base, code: '4OFF' })).rejects.toThrow(
      'Ya existe un registro de `coupons` con el mismo valor en `code`.'
    );
    await expect(
      createCoupon({ ...base, code: `${SENTINEL_PREFIX}huerfano`, shopId: 999 })
    ).rejects.toBeInstanceOf(InvalidReferenceError);
  });

  it('type, importes o vigencia fuera de su CHECK ⇒ InvalidFieldValueError', async () => {
    const base = { code: `${SENTINEL_PREFIX}malo`, type: 'fixed', amount: 1, activeFrom: FROM, expireAt: TO };
    for (const bad of [
      { type: 'gift' },
      { amount: -1 },
      { amount: Number.NaN },
      { minimumCartAmount: -5 },
      { expireAt: FROM },
      { activeFrom: new Date('x') },
    ]) {
      await expect(createCoupon({ ...base, ...bad })).rejects.toBeInstanceOf(InvalidFieldValueError);
    }
    expect(await findCouponByCode(`${SENTINEL_PREFIX}malo`)).toBeNull();
  });
});

describe('updateCoupon / setCouponApproval / deleteCoupon', () => {
  it('actualiza campos, avanza updatedAt y valida la vigencia contra la fila', async () => {
    try {
      const created = await createCoupon({
        code: `${SENTINEL_PREFIX}editar`,
        type: 'fixed',
        amount: 5,
        activeFrom: FROM,
        expireAt: TO,
        shopId: 1,
      });
      const future = new Date(Date.now() + 60_000);
      _setNowProvider(() => future);

      // `image: null` llega así desde el DTO (precedente tags, DD-5): se ignora.
      const updated = await updateCoupon(created.id, {
        amount: 8,
        image: null as unknown as Prisma.InputJsonValue,
      });
      expect(updated.amount).toBe(8);
      expect(updated.shopId).toBe(1);
      expect(updated.updatedAt.getTime()).toBe(future.getTime());

      await expect(
        updateCoupon(created.id, { expireAt: new Date('2025-01-01T00:00:00Z') })
      ).rejects.toBeInstanceOf(InvalidFieldValueError);
      await expect(updateCoupon(created.id, { code: '5OFF' })).rejects.toBeInstanceOf(SlugConflictError);
    } finally {
      _setNowProvider(() => new Date());
    }
  });

  it('id inexistente ⇒ RecordNotFoundError en update, aprobación y borrado', async () => {
    await expect(updateCoupon(999_999, { amount: 1 })).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(setCouponApproval(999_999, true)).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(deleteCoupon(999_999)).rejects.toBeInstanceOf(RecordNotFoundError);
  });

  it('la aprobación persiste y el borrado devuelve la fila', async () => {
    const created = await createCoupon({
      code: `${SENTINEL_PREFIX}moderar`,
      type: 'free_shipping',
      amount: 0,
      activeFrom: FROM,
      expireAt: TO,
    });
    expect(created.shopId).toBeNull();
    expect((await setCouponApproval(created.id, true)).isApprove).toBe(true);
    expect((await findCouponById(created.id))?.isApprove).toBe(true);
    expect((await setCouponApproval(created.id, false)).isApprove).toBe(false);

    const deleted = await deleteCoupon(created.id);
    expect(deleted.code).toBe(`${SENTINEL_PREFIX}moderar`);
    expect(await findCouponById(created.id)).toBeNull();
  });
});
