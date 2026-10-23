/**
 * Test de integración contra el Postgres real (sembrado por `just db-up`: 10
 * descargas, ids 1-10, todas de customer@demo.com y sin orden). US-60.
 *
 * Solo lectura: no escribe nada.
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../client';
import { findFirstOrderFileByDigitalFileId, listOrderFilesByCustomer } from './order-files.repository';

const CUSTOMER = 2;
const ADMIN = 3;

afterAll(async () => {
  await prisma.$disconnect();
});

describe('order_files — seed', () => {
  it('lista las 10 del cliente en id ASC, paginadas; otro usuario no ve ninguna', async () => {
    const { items, total } = await listOrderFilesByCustomer(CUSTOMER);
    expect(total).toBe(10);
    expect(items.map((f) => f.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(items.every((f) => f.customerId === CUSTOMER && f.orderId === null)).toBe(true);
    const page2 = await listOrderFilesByCustomer(CUSTOMER, { page: 2, limit: 4 });
    expect(page2.items.map((f) => f.id)).toEqual([5, 6, 7, 8]);
    expect(await listOrderFilesByCustomer(ADMIN)).toEqual({ items: [], total: 0 });
  });

  it('file conserva verbatim el texto del mock (json, no jsonb): mismas claves, mismo orden', async () => {
    const mock = JSON.parse(
      readFileSync(join(__dirname, '../../../../apps/api/rest/src/db/pickbazar/order-files.json'), 'utf8')
    ) as { id: number; file: unknown }[];
    const { items } = await listOrderFilesByCustomer(CUSTOMER);
    for (const record of items) {
      const original = mock.find((m) => m.id === record.id);
      expect(JSON.stringify(record.file)).toBe(JSON.stringify(original?.file));
    }
  });

  it('digital_file_id repetido: la primera por id del cliente; inexistente o ajeno ⇒ null', async () => {
    expect((await findFirstOrderFileByDigitalFileId(42, CUSTOMER))?.id).toBe(4);
    expect((await findFirstOrderFileByDigitalFileId(2, CUSTOMER))?.id).toBe(2);
    expect(await findFirstOrderFileByDigitalFileId(999, CUSTOMER)).toBeNull();
    expect(await findFirstOrderFileByDigitalFileId(42, ADMIN)).toBeNull();
  });
});
