/**
 * Test de integración contra el Postgres real (sembrado por `just db-up`:
 * 5 políticas, 1 vendor y 4 customer, las 5 approved). US-48.
 *
 * Centinela `zz-rpol-` en el slug. Lecturas del seed ANTES que escrituras.
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
  createRefundPolicy,
  deleteRefundPolicy,
  findRefundPolicyBySlug,
  listRefundPolicies,
  updateRefundPolicy,
} from './refund-policies.repository';

const SENTINEL_PREFIX = 'zz-rpol-';

const cleanup = () =>
  prisma.refundPolicy.deleteMany({ where: { slug: { startsWith: SENTINEL_PREFIX } } });

beforeAll(cleanup);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe('listRefundPolicies — seed', () => {
  it('lista las 5, id asc, JSON-safe', async () => {
    const { items, total } = await listRefundPolicies();
    expect(total).toBe(5);
    expect(items.map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
    expect(() => JSON.stringify(items)).not.toThrow();
  });

  it('target:customer + status:approved → las 4 de cliente', async () => {
    const { items, total } = await listRefundPolicies({ target: 'customer', status: 'approved' });
    expect(total).toBe(4);
    expect(items.map((r) => r.id)).toEqual([2, 3, 4, 5]);
  });

  it('target:vendor → solo el id 1; status:pending → 0', async () => {
    expect((await listRefundPolicies({ target: 'vendor' })).items.map((r) => r.id)).toEqual([1]);
    expect((await listRefundPolicies({ status: 'pending' })).total).toBe(0);
  });
});

describe('findRefundPolicyBySlug', () => {
  it('devuelve customer-return-policy (id 2); null si no existe', async () => {
    expect((await findRefundPolicyBySlug('customer-return-policy'))?.id).toBe(2);
    expect(await findRefundPolicyBySlug('no-existe')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Escrituras — NO INSERTAR LECTURAS DEL SEED DEBAJO DE ESTA LÍNEA.
// ---------------------------------------------------------------------------

describe('createRefundPolicy', () => {
  it('usa el slug recibido y queda pending por defecto', async () => {
    const created = await createRefundPolicy({
      title: 'Politica X',
      slug: `${SENTINEL_PREFIX}explicita`,
      target: 'customer',
      description: 'cuerpo',
    });
    expect(created.slug).toBe(`${SENTINEL_PREFIX}explicita`);
    expect(created.status).toBe('pending');
    expect((await findRefundPolicyBySlug(created.slug))?.id).toBe(created.id);
  });

  it('target o status fuera del CHECK ⇒ InvalidFieldValueError, sin escribir', async () => {
    await expect(
      createRefundPolicy({ title: `${SENTINEL_PREFIX}Mala`, target: 'admin' })
    ).rejects.toBeInstanceOf(InvalidFieldValueError);
    await expect(
      createRefundPolicy({ title: `${SENTINEL_PREFIX}Mala`, target: 'vendor', status: 'rejected' })
    ).rejects.toBeInstanceOf(InvalidFieldValueError);
    expect(await findRefundPolicyBySlug(`${SENTINEL_PREFIX}mala`)).toBeNull();
  });

  it('shop_id inexistente o mal formado ⇒ InvalidReferenceError', async () => {
    for (const shopId of [999_999, Number.NaN]) {
      await expect(
        createRefundPolicy({ title: `${SENTINEL_PREFIX}Tienda`, target: 'vendor', shopId })
      ).rejects.toBeInstanceOf(InvalidReferenceError);
    }
  });
});

describe('updateRefundPolicy / deleteRefundPolicy', () => {
  it('actualiza target/status/título sin tocar el slug y fija updatedAt', async () => {
    try {
      const created = await createRefundPolicy({
        title: `${SENTINEL_PREFIX}Original`,
        target: 'vendor',
      });
      const future = new Date(Date.now() + 60_000);
      _setNowProvider(() => future);

      const updated = await updateRefundPolicy(created.id, {
        title: `${SENTINEL_PREFIX}Editada`,
        target: 'customer',
        status: 'approved',
      });
      expect(updated).toMatchObject({
        title: `${SENTINEL_PREFIX}Editada`,
        slug: `${SENTINEL_PREFIX}original`,
        target: 'customer',
        status: 'approved',
      });
      expect(updated.updatedAt.getTime()).toBe(future.getTime());

      const deleted = await deleteRefundPolicy(created.id);
      expect(deleted.id).toBe(created.id);
      expect(await findRefundPolicyBySlug(created.slug)).toBeNull();
    } finally {
      _setNowProvider(() => new Date());
    }
  });

  it('status inválido en update ⇒ 400 de dominio; ids inexistentes ⇒ RecordNotFoundError', async () => {
    await expect(updateRefundPolicy(1, { status: 'x' })).rejects.toBeInstanceOf(
      InvalidFieldValueError
    );
    await expect(updateRefundPolicy(999_999, { title: 'x' })).rejects.toBeInstanceOf(
      RecordNotFoundError
    );
    await expect(deleteRefundPolicy(999_999)).rejects.toBeInstanceOf(RecordNotFoundError);
  });
});
