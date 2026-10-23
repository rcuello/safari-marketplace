/**
 * Test de integración contra el Postgres real (sembrado por `just db-up`: 10
 * estados, ids 1-10, con el 7 «Delivered» en el serial 11). US-57.
 *
 * Las escrituras crean filas nuevas (id > 10) y `afterAll` las borra; los 10
 * sembrados no se tocan.
 */

import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { _setNowProvider } from '../clock';
import { prisma } from '../client';
import {
  EmptySlugError,
  InvalidFieldValueError,
  RecordNotFoundError,
  SlugConflictError,
} from '../domain-errors';
import {
  createOrderStatus,
  deleteOrderStatus,
  findOrderStatusBySlug,
  listOrderStatuses,
  updateOrderStatus,
} from './order-statuses.repository';

const cleanup = () => prisma.orderStatus.deleteMany({ where: { id: { gt: 10 } } });

beforeAll(cleanup);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe('lecturas — seed', () => {
  it('sin orderBy, serial ASC: 1-6, 8, 9, 10 y el 7 al final', async () => {
    const { items, total } = await listOrderStatuses();
    expect(total).toBe(10);
    expect(items.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6, 8, 9, 10, 7]);
    expect(items[9]).toMatchObject({ slug: 'delivered', serial: 11, color: '#d87b64', language: 'en' });
    expect(items[0].updatedAt.toISOString()).toBe('2021-03-08T21:34:04.000Z');
  });

  it('pagina, filtra por nombre y respeta orderBy/sortedBy', async () => {
    expect((await listOrderStatuses({ page: 2, limit: 5 })).items.map((s) => s.id)).toEqual([6, 8, 9, 10, 7]);
    const found = await listOrderStatuses({ name: 'order' });
    expect(found.items.map((s) => s.slug)).toEqual(['order-received', 'order-processing', 'order-dispatched']);
    const byName = await listOrderStatuses({ orderBy: 'name', sortedBy: 'desc', limit: 2 });
    expect(byName.items.map((s) => s.name)).toEqual(['Shipment Refused by Consignee', 'Ready To Dispatch']);
  });

  it('por slug; inexistente ⇒ null', async () => {
    expect((await findOrderStatusBySlug('delivered'))?.id).toBe(7);
    expect(await findOrderStatusBySlug('no-existe')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Escrituras — NO INSERTAR LECTURAS DEL SEED DEBAJO DE ESTA LÍNEA.
// ---------------------------------------------------------------------------

describe('escrituras', () => {
  it('crea con slug generado, renombra regenerando el slug y borra con snapshot', async () => {
    const created = await createOrderStatus({ name: 'ZZ Estado', color: '#112233', serial: 90 });
    expect(created).toMatchObject({ slug: 'zz-estado', serial: 90, language: 'es' });

    const stamp = new Date(Date.now() + 60_000);
    try {
      _setNowProvider(() => stamp);
      const renamed = await updateOrderStatus(created.id, { name: 'ZZ Editado' });
      expect(renamed).toMatchObject({ name: 'ZZ Editado', slug: 'zz-editado', serial: 90 });
      expect(renamed.updatedAt.getTime()).toBe(stamp.getTime());
    } finally {
      _setNowProvider(() => new Date());
    }

    expect((await updateOrderStatus(created.id, { name: 'ZZ Editado' })).slug).toBe('zz-editado');
    expect((await updateOrderStatus(created.id, { color: '#abcdef' })).slug).toBe('zz-editado');

    const deleted = await deleteOrderStatus(created.id);
    expect(deleted).toMatchObject({ id: created.id, slug: 'zz-editado', color: '#abcdef' });
    expect(await findOrderStatusBySlug('zz-editado')).toBeNull();
  });

  it('un nombre ya usado recibe sufijo, tanto al crear como al renombrar', async () => {
    const twin = await createOrderStatus({ name: 'Delivered', color: '#112233', serial: 91 });
    expect(twin.slug).toBe('delivered-2');
    const other = await createOrderStatus({ name: 'ZZ Otro', color: '#112233', serial: 92 });
    expect((await updateOrderStatus(other.id, { name: 'Delivered' })).slug).toBe('delivered-3');
  });

  it('serial repetido ⇒ SlugConflictError; CHECK de serial y color ⇒ InvalidFieldValueError', async () => {
    await expect(createOrderStatus({ name: 'ZZ Dup', color: '#112233', serial: 1 })).rejects.toBeInstanceOf(
      SlugConflictError
    );
    await expect(createOrderStatus({ name: 'ZZ Cero', color: '#112233', serial: 0 })).rejects.toBeInstanceOf(
      InvalidFieldValueError
    );
    await expect(createOrderStatus({ name: 'ZZ Color', color: 'rojo', serial: 93 })).rejects.toBeInstanceOf(
      InvalidFieldValueError
    );
    await expect(updateOrderStatus(1, { serial: 1.5 })).rejects.toBeInstanceOf(InvalidFieldValueError);
    await expect(createOrderStatus({ name: '  ', color: '#112233', serial: 94 })).rejects.toBeInstanceOf(
      EmptySlugError
    );
  });

  it('id inexistente ⇒ RecordNotFoundError en update y delete', async () => {
    await expect(updateOrderStatus(999_999, { name: 'x' })).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(deleteOrderStatus(999_999)).rejects.toBeInstanceOf(RecordNotFoundError);
  });
});
