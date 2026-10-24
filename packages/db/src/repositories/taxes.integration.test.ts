/**
 * Test de integración contra el Postgres real (sembrado por `just db-up`:
 * 1 clase "Global", id 1, rate 2, con las fechas del mock). US-49.
 *
 * Las escrituras usan el centinela `zz-tax-` en `name` (la tabla no tiene
 * slug). Lecturas del seed ANTES que escrituras.
 */

import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../client';
import { _setNowProvider } from '../clock';
import { InvalidFieldValueError, RecordNotFoundError } from '../domain-errors';
import {
  createTax,
  deleteTax,
  findTaxById,
  listTaxes,
  updateTax,
} from './taxes.repository';

const SENTINEL_PREFIX = 'zz-tax-';

const cleanup = () =>
  prisma.tax.deleteMany({ where: { name: { startsWith: SENTINEL_PREFIX } } });

beforeAll(cleanup);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe('listTaxes / findTaxById — seed', () => {
  it('una clase Global con id 1, rate 2 como número y las fechas del mock', async () => {
    const taxes = await listTaxes();
    expect(taxes).toHaveLength(1);
    expect(taxes[0]).toMatchObject({
      id: 1,
      name: 'Global',
      rate: 2,
      isGlobal: true,
      onShipping: true,
      country: null,
      priority: null,
    });
    expect(taxes[0].createdAt.toISOString()).toBe('2021-03-25T13:26:57.000Z');
    expect(taxes[0].updatedAt.toISOString()).toBe('2021-03-25T16:07:18.000Z');
  });

  it('filtra por nombre case-insensitive; findTaxById null si no existe', async () => {
    expect(await listTaxes({ name: 'glob' })).toHaveLength(1);
    expect(await listTaxes({ name: 'no-existe' })).toHaveLength(0);
    expect((await findTaxById(1))?.name).toBe('Global');
    expect(await findTaxById(999_999)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Escrituras — NO INSERTAR LECTURAS DEL SEED DEBAJO DE ESTA LÍNEA.
// ---------------------------------------------------------------------------

describe('createTax / updateTax / deleteTax', () => {
  it('crea con rate decimal, actualiza fijando updatedAt y borra', async () => {
    try {
      const created = await createTax({
        name: `${SENTINEL_PREFIX}IVA`,
        rate: 19.5,
        isGlobal: false,
        country: 'CO',
        onShipping: false,
      });
      expect(created).toMatchObject({
        rate: 19.5,
        isGlobal: false,
        country: 'CO',
        onShipping: false,
      });

      const future = new Date(Date.now() + 60_000);
      _setNowProvider(() => future);
      const updated = await updateTax(created.id, { rate: 5 });
      expect(updated.rate).toBe(5);
      expect(updated.country).toBe('CO');
      expect(updated.updatedAt.getTime()).toBe(future.getTime());

      expect((await deleteTax(created.id)).id).toBe(created.id);
      expect(await findTaxById(created.id)).toBeNull();
    } finally {
      _setNowProvider(() => new Date());
    }
  });

  it('rate negativo, NaN o infinito ⇒ InvalidFieldValueError, sin escribir', async () => {
    for (const rate of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        createTax({ name: `${SENTINEL_PREFIX}Malo`, rate })
      ).rejects.toBeInstanceOf(InvalidFieldValueError);
    }
    await expect(updateTax(1, { rate: -3 })).rejects.toBeInstanceOf(
      InvalidFieldValueError
    );
    expect(
      await prisma.tax.count({ where: { name: `${SENTINEL_PREFIX}Malo` } })
    ).toBe(0);
  });

  it('ids inexistentes ⇒ RecordNotFoundError', async () => {
    await expect(updateTax(999_999, { name: 'x' })).rejects.toBeInstanceOf(
      RecordNotFoundError
    );
    await expect(deleteTax(999_999)).rejects.toBeInstanceOf(
      RecordNotFoundError
    );
  });
});
