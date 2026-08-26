/**
 * Test de integración contra el Postgres real (docker-compose, puerto
 * 5433, sembrado por `just db-up`: 10 tags). Solo lectura.
 */

import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../client';
import { findTagBySlug, listTags } from './tags.repository';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('listTags', () => {
  it('lista los 10 tags, id desc (D), JSON-safe', async () => {
    const { items, total } = await listTags();
    expect(total).toBe(10);
    expect(items[0].id).toBe(62);
    expect(items[items.length - 1].id).toBe(53);
    expect(() => JSON.stringify(items)).not.toThrow();
  });

  it('filtra por typeSlug: "medicine" → 10, "grocery" → 0', async () => {
    expect((await listTags({ typeSlug: 'medicine' })).total).toBe(10);
    expect((await listTags({ typeSlug: 'grocery' })).total).toBe(0);
  });

  it('filtra por name case-insensitive: "baby" → 2', async () => {
    const { items, total } = await listTags({ name: 'baby' });
    expect(total).toBe(2);
    expect(items.map((r) => r.slug).sort()).toEqual(['baby-growth', 'baby-milk']);
  });
});

describe('findTagBySlug', () => {
  it('devuelve el tag cuando el slug existe', async () => {
    const row = await findTagBySlug('baby-milk');
    expect(row?.slug).toBe('baby-milk');
  });

  it('devuelve null cuando el slug no existe', async () => {
    expect(await findTagBySlug('no-existe')).toBeNull();
  });
});
