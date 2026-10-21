/**
 * Test de integración contra el Postgres real (sembrado por `just db-up`:
 * 1 clase "Global", id 1, amount 50, type fixed, con las fechas del mock).
 * US-49. Centinela `zz-ship-` en `name`. Lecturas del seed ANTES que
 * escrituras.
 */

import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { _setNowProvider } from '../clock';
import { prisma } from '../client';
import { RecordNotFoundError } from '../domain-errors';
import {
  InvalidShippingValueError,
  createShipping,
  deleteShipping,
  findShippingById,
  listShippings,
  updateShipping,
} from './shippings.repository';

const SENTINEL_PREFIX = 'zz-ship-';

const cleanup = () =>
  prisma.shipping.deleteMany({ where: { name: { startsWith: SENTINEL_PREFIX } } });

beforeAll(cleanup);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe('listShippings / findShippingById — seed', () => {
  it('una clase Global con id 1, amount 50 como número y las fechas del mock', async () => {
    const shippings = await listShippings();
    expect(shippings).toHaveLength(1);
    expect(shippings[0]).toMatchObject({
      id: 1,
      name: 'Global',
      amount: 50,
      isGlobal: true,
      type: 'fixed',
    });
    expect(shippings[0].createdAt.toISOString()).toBe('2021-03-25T13:27:49.000Z');
  });

  it('filtra por nombre; null si el id no existe', async () => {
    expect(await listShippings({ name: 'GLOBAL' })).toHaveLength(1);
    expect(await listShippings({ name: 'no-existe' })).toHaveLength(0);
    expect(await findShippingById(999_999)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Escrituras — NO INSERTAR LECTURAS DEL SEED DEBAJO DE ESTA LÍNEA.
// ---------------------------------------------------------------------------

describe('createShipping / updateShipping / deleteShipping', () => {
  it('crea, actualiza fijando updatedAt y borra', async () => {
    try {
      const created = await createShipping({
        name: `${SENTINEL_PREFIX}Express`,
        amount: 12.5,
        type: 'percentage',
        isGlobal: false,
      });
      expect(created).toMatchObject({ amount: 12.5, type: 'percentage', isGlobal: false });

      const future = new Date(Date.now() + 60_000);
      _setNowProvider(() => future);
      const updated = await updateShipping(created.id, { type: 'free', amount: 0 });
      expect(updated).toMatchObject({ type: 'free', amount: 0 });
      expect(updated.updatedAt.getTime()).toBe(future.getTime());

      expect((await deleteShipping(created.id)).id).toBe(created.id);
      expect(await findShippingById(created.id)).toBeNull();
    } finally {
      _setNowProvider(() => new Date());
    }
  });

  it('type fuera del CHECK o amount negativo ⇒ InvalidShippingValueError, sin escribir', async () => {
    await expect(
      createShipping({ name: `${SENTINEL_PREFIX}Malo`, amount: 1, type: 'gratis' })
    ).rejects.toBeInstanceOf(InvalidShippingValueError);
    await expect(
      createShipping({ name: `${SENTINEL_PREFIX}Malo`, amount: -1, type: 'fixed' })
    ).rejects.toBeInstanceOf(InvalidShippingValueError);
    await expect(updateShipping(1, { type: 'x' })).rejects.toBeInstanceOf(
      InvalidShippingValueError
    );
    expect(await prisma.shipping.count({ where: { name: `${SENTINEL_PREFIX}Malo` } })).toBe(0);
  });

  it('ids inexistentes ⇒ RecordNotFoundError', async () => {
    await expect(updateShipping(999_999, { name: 'x' })).rejects.toBeInstanceOf(
      RecordNotFoundError
    );
    await expect(deleteShipping(999_999)).rejects.toBeInstanceOf(RecordNotFoundError);
  });
});
