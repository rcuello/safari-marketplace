/**
 * Test de integración contra el Postgres real (docker-compose, puerto
 * 5433, sembrado por `just db-up`: 14 manufacturers). Solo lectura.
 */

import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../client';
import { findManufacturerBySlug, listManufacturers } from './manufacturers.repository';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('listManufacturers', () => {
  it('lista los 14 manufacturers, id asc, JSON-safe', async () => {
    const { items, total } = await listManufacturers();
    expect(total).toBe(14);
    const ids = items.map((r) => r.id);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
    expect(() => JSON.stringify(items)).not.toThrow();
  });

  it('filtra por typeSlug "books" → 9', async () => {
    expect((await listManufacturers({ typeSlug: 'books' })).total).toBe(9);
  });

  it('filtra por name case-insensitive "publication" → 9', async () => {
    expect((await listManufacturers({ name: 'publication' })).total).toBe(9);
  });

  it('limit:10 → 10 items, ids = slice(0,10) del orden asc (D-9)', async () => {
    const { items } = await listManufacturers({ limit: 10 });
    expect(items).toHaveLength(10);
    expect(items.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('findManufacturerBySlug', () => {
  it('devuelve la marca cuando el slug existe', async () => {
    const [sample] = (await listManufacturers({ limit: 1 })).items;
    const row = await findManufacturerBySlug(sample.slug);
    expect(row?.slug).toBe(sample.slug);
  });

  it('devuelve null cuando el slug no existe', async () => {
    expect(await findManufacturerBySlug('no-existe')).toBeNull();
  });
});
