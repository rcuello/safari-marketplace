/**
 * Test de integración contra el Postgres real (docker-compose, puerto
 * 5433, sembrado por `just db-up`: 10 types). Solo lectura.
 */

import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../client';
import { findTypeBySlug, listTypes } from './types.repository';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('listTypes', () => {
  it('lista los 10 types, id asc, JSON-safe', async () => {
    const rows = await listTypes();
    expect(rows).toHaveLength(10);
    const ids = rows.map((r) => r.id);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
    expect(() => JSON.stringify(rows)).not.toThrow();
  });

  it('filtra por name case-insensitive: "gad" → gadget', async () => {
    const rows = await listTypes({ name: 'gad' });
    expect(rows).toHaveLength(1);
    expect(rows[0].slug).toBe('gadget');
  });
});

describe('findTypeBySlug', () => {
  it('devuelve el type cuando el slug existe', async () => {
    const row = await findTypeBySlug('gadget');
    expect(row?.slug).toBe('gadget');
  });

  it('devuelve null cuando el slug no existe', async () => {
    expect(await findTypeBySlug('no-existe')).toBeNull();
  });
});
