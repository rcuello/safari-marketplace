/**
 * Test de integración contra el Postgres real (sembrado por `just db-up`:
 * 5 términos, ids 8..12, deduplicados por slug desde 10 filas del mock).
 * Lectura, escritura y moderación (US-47).
 *
 * Centinela `zz-terms-` en el slug. La moderación del seed (id 10) se
 * restaura en `afterAll`: otras corridas asertan `is_approved = true` en las 5.
 */

import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../client';
import { _setNowProvider } from '../clock';
import { InvalidReferenceError, RecordNotFoundError } from '../domain-errors';
import {
  createTermsAndConditions,
  deleteTermsAndConditions,
  findTermsAndConditionsBySlug,
  listTermsAndConditions,
  setTermsApproval,
  updateTermsAndConditions,
} from './terms-and-conditions.repository';

const SENTINEL_PREFIX = 'zz-terms-';

const cleanup = () =>
  prisma.termsAndConditions.deleteMany({
    where: { slug: { startsWith: SENTINEL_PREFIX } },
  });

beforeAll(cleanup);

afterAll(async () => {
  try {
    await cleanup();
    await prisma.termsAndConditions.update({
      where: { id: 10 },
      data: { isApproved: true },
    });
  } finally {
    await prisma.$disconnect();
  }
});

describe('listTermsAndConditions — seed', () => {
  it('lista los 5 deduplicados, ids 8..12 en orden, todos aprobados', async () => {
    const { items, total } = await listTermsAndConditions();
    expect(total).toBe(5);
    expect(items.map((r) => r.id)).toEqual([8, 9, 10, 11, 12]);
    expect(items.every((r) => r.isApproved)).toBe(true);
  });

  it('los filtros del shop /terms devuelven los 5 globales', async () => {
    const { total } = await listTermsAndConditions({
      type: 'global',
      issuedBy: 'Super Admin',
      isApproved: true,
      limit: 100,
    });
    expect(total).toBe(5);
  });

  it('is_approved=false devuelve 0 tras el seed', async () => {
    expect((await listTermsAndConditions({ isApproved: false })).total).toBe(0);
  });

  it('shop_id sin términos de tienda devuelve 0', async () => {
    expect((await listTermsAndConditions({ shopId: 1 })).total).toBe(0);
  });
});

describe('findTermsAndConditionsBySlug', () => {
  it('privacy-policy conserva el id 10 (primera aparición en el archivo)', async () => {
    expect((await findTermsAndConditionsBySlug('privacy-policy'))?.id).toBe(10);
  });

  it('null si no existe', async () => {
    expect(await findTermsAndConditionsBySlug('no-existe')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Escrituras — NO INSERTAR LECTURAS DEL SEED DEBAJO DE ESTA LÍNEA.
// ---------------------------------------------------------------------------

describe('setTermsApproval', () => {
  it('persiste la desaprobación y la vuelve a aprobar', async () => {
    expect((await setTermsApproval(10, false)).isApproved).toBe(false);
    const pendientes = await listTermsAndConditions({ isApproved: false });
    expect(pendientes.items.map((r) => r.id)).toEqual([10]);
    expect((await setTermsApproval(10, true)).isApproved).toBe(true);
  });

  it('id inexistente ⇒ RecordNotFoundError', async () => {
    await expect(setTermsApproval(999_999, true)).rejects.toBeInstanceOf(
      RecordNotFoundError
    );
  });
});

describe('createTermsAndConditions', () => {
  it('usa el slug recibido, aprobado por defecto, global sin tienda', async () => {
    const created = await createTermsAndConditions({
      title: 'Cualquier titulo',
      description: 'x',
      slug: `${SENTINEL_PREFIX}explicito`,
    });
    expect(created.slug).toBe(`${SENTINEL_PREFIX}explicito`);
    expect(created.isApproved).toBe(true);
    expect(created.type).toBe('global');
    expect(created.issuedBy).toBe('Super Admin');
  });

  it('sin slug lo deriva del título; con tienda es de tienda', async () => {
    const created = await createTermsAndConditions({
      title: `${SENTINEL_PREFIX}De Tienda`,
      description: 'x',
      shopId: 3,
    });
    expect(created.slug).toBe(`${SENTINEL_PREFIX}de-tienda`);
    expect(created.type).toBe('shop');
    expect(created.shopId).toBe(3);
  });

  it('tienda inexistente ⇒ InvalidReferenceError', async () => {
    await expect(
      createTermsAndConditions({
        title: `${SENTINEL_PREFIX}Rota`,
        description: 'x',
        shopId: 999_999,
      })
    ).rejects.toBeInstanceOf(InvalidReferenceError);
  });
});

describe('updateTermsAndConditions / deleteTermsAndConditions', () => {
  it('actualiza título sin tocar el slug y fija updatedAt; luego borra', async () => {
    try {
      const created = await createTermsAndConditions({
        title: `${SENTINEL_PREFIX}Original`,
        description: 'antes',
      });
      const future = new Date(Date.now() + 60_000);
      _setNowProvider(() => future);

      const updated = await updateTermsAndConditions(created.id, {
        title: `${SENTINEL_PREFIX}Renombrado`,
      });
      expect(updated.title).toBe(`${SENTINEL_PREFIX}Renombrado`);
      expect(updated.slug).toBe(`${SENTINEL_PREFIX}original`);
      expect(updated.updatedAt.getTime()).toBe(future.getTime());

      const deleted = await deleteTermsAndConditions(created.id);
      expect(deleted.id).toBe(created.id);
      expect(await findTermsAndConditionsBySlug(created.slug)).toBeNull();
    } finally {
      _setNowProvider(() => new Date());
    }
  });

  it('ids inexistentes ⇒ RecordNotFoundError', async () => {
    await expect(
      updateTermsAndConditions(999_999, { title: 'x' })
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(deleteTermsAndConditions(999_999)).rejects.toBeInstanceOf(
      RecordNotFoundError
    );
  });
});
