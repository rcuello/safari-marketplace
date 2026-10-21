/**
 * Test de integración contra el Postgres real (sembrado por `just db-up`:
 * 8 motivos con las fechas del mock, 2023-11-12T10:58:58Z). US-48.
 *
 * Centinela `zz-rrea-` en el slug. Lecturas del seed ANTES que escrituras.
 */

import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { _setNowProvider } from '../clock';
import { prisma } from '../client';
import { EmptySlugError, RecordNotFoundError } from '../domain-errors';
import {
  createRefundReason,
  deleteRefundReason,
  findRefundReasonBySlug,
  listRefundReasons,
  updateRefundReason,
} from './refund-reasons.repository';

const SENTINEL_PREFIX = 'zz-rrea-';
const MOCK_DATE = new Date('2023-11-12T10:58:58.000Z');

const cleanup = () =>
  prisma.refundReason.deleteMany({ where: { slug: { startsWith: SENTINEL_PREFIX } } });

beforeAll(cleanup);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe('listRefundReasons — seed', () => {
  it('lista los 8, id asc, con las fechas del mock', async () => {
    const { items, total } = await listRefundReasons();
    expect(total).toBe(8);
    expect(items.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const r of items) {
      expect(r.createdAt.getTime()).toBe(MOCK_DATE.getTime());
      expect(r.updatedAt.getTime()).toBe(MOCK_DATE.getTime());
    }
  });

  it('filtra por nombre case-insensitive', async () => {
    const { items } = await listRefundReasons({ name: 'DAMAGED' });
    expect(items.map((r) => r.slug)).toContain('damaged-item');
  });
});

describe('findRefundReasonBySlug', () => {
  it('damaged-item es el id 3; null si no existe', async () => {
    expect((await findRefundReasonBySlug('damaged-item'))?.id).toBe(3);
    expect(await findRefundReasonBySlug('no-existe')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Escrituras — NO INSERTAR LECTURAS DEL SEED DEBAJO DE ESTA LÍNEA.
// ---------------------------------------------------------------------------

describe('createRefundReason', () => {
  it('sin slug lo deriva del nombre', async () => {
    const created = await createRefundReason({ name: `${SENTINEL_PREFIX}Producto Defectuoso` });
    expect(created.slug).toBe(`${SENTINEL_PREFIX}producto-defectuoso`);
    expect((await findRefundReasonBySlug(created.slug))?.id).toBe(created.id);
  });

  it('con slug explícito lo usa', async () => {
    const created = await createRefundReason({
      name: 'Otro motivo',
      slug: `${SENTINEL_PREFIX}explicito`,
    });
    expect(created.slug).toBe(`${SENTINEL_PREFIX}explicito`);
  });
});

describe('updateRefundReason / deleteRefundReason', () => {
  it('renombra sin tocar el slug y fija updatedAt desde clock.ts; luego borra', async () => {
    try {
      const created = await createRefundReason({ name: `${SENTINEL_PREFIX}Original` });
      const future = new Date(Date.now() + 60_000);
      _setNowProvider(() => future);

      const updated = await updateRefundReason(created.id, { name: `${SENTINEL_PREFIX}Renombrado` });
      expect(updated.name).toBe(`${SENTINEL_PREFIX}Renombrado`);
      expect(updated.slug).toBe(`${SENTINEL_PREFIX}original`);
      expect(updated.updatedAt.getTime()).toBe(future.getTime());

      expect((await deleteRefundReason(created.id)).id).toBe(created.id);
      expect(await findRefundReasonBySlug(created.slug)).toBeNull();
    } finally {
      _setNowProvider(() => new Date());
    }
  });

  it('nombre que normaliza a vacío ⇒ EmptySlugError; inexistentes ⇒ RecordNotFoundError', async () => {
    await expect(updateRefundReason(1, { name: '???' })).rejects.toBeInstanceOf(EmptySlugError);
    await expect(updateRefundReason(999_999, { name: 'x' })).rejects.toBeInstanceOf(
      RecordNotFoundError
    );
    await expect(deleteRefundReason(999_999)).rejects.toBeInstanceOf(RecordNotFoundError);
  });
});
