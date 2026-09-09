/**
 * Test de integración contra el Postgres real (docker-compose, puerto
 * 5433, sembrado por `just db-up`: 10 types).
 *
 * Las escrituras (CA-1, CA-2, CA-3) operan sobre un centinela `zz-types-`
 * en `name`/`slug` — prefijo distinto de `zz-test-` (design.md, B4/N5) y
 * distinto por archivo para que US-27b/28/29/30 no se pisen en paralelo.
 * `cleanup` corre en `beforeAll` (corrida abortada previa) y se PLIEGA
 * dentro del `afterAll` que ya existía (no se agrega un segundo `afterAll`:
 * `sequence.hooks: 'stack'` es el default de vitest y correría LIFO sobre
 * un cliente ya desconectado si se registrara aparte).
 */

import 'dotenv/config';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { _setNowProvider } from '../clock';
import { prisma } from '../client';
import { DependentRowsError, EmptySlugError, RecordNotFoundError } from '../domain-errors';
import { createType, deleteType, findTypeBySlug, listTypes, updateType } from './types.repository';

const SENTINEL_PREFIX = 'zz-types-';

const cleanup = () =>
  prisma.type.deleteMany({ where: { slug: { startsWith: SENTINEL_PREFIX } } });

beforeAll(cleanup); // corrida abortada previa

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
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

describe('createType — CA-1, centinela zz-types-', () => {
  it('persiste y devuelve el registro; sobrevive a una relectura por slug', async () => {
    const created = await createType({
      name: `${SENTINEL_PREFIX}Vertical Prueba`,
      slug: `${SENTINEL_PREFIX}vertical-prueba`,
    });

    expect(created.slug).toBe(`${SENTINEL_PREFIX}vertical-prueba`);
    expect(created.name).toBe(`${SENTINEL_PREFIX}Vertical Prueba`);

    const reread = await findTypeBySlug(created.slug);
    expect(reread).not.toBeNull();
    expect(reread?.id).toBe(created.id);

    await deleteType(created.id);
  });

  it('omite settings/banners/icon ausentes: aplican los DEFAULT de la tabla', async () => {
    const created = await createType({ name: `${SENTINEL_PREFIX}Sin Extras` });

    expect(created.icon).toBeNull();
    expect(created.settings).toEqual({});
    expect(created.banners).toEqual([]);
    expect(created.language).toBe('es');

    await deleteType(created.id);
  });
});

describe('updateType — CA-2, slug inmutable, updatedAt explícito', () => {
  afterEach(() => {
    _setNowProvider(() => new Date());
  });

  it('cambia name, NO el slug, y updatedAt avanza (medido con _setNowProvider)', async () => {
    const created = await createType({
      name: `${SENTINEL_PREFIX}Original`,
      slug: `${SENTINEL_PREFIX}original`,
    });

    const future = new Date(Date.now() + 60_000);
    _setNowProvider(() => future);

    const updated = await updateType(created.id, {
      name: `${SENTINEL_PREFIX}Renombrado`,
    });

    expect(updated.name).toBe(`${SENTINEL_PREFIX}Renombrado`);
    expect(updated.slug).toBe(`${SENTINEL_PREFIX}original`);
    expect(updated.updatedAt.getTime()).toBe(future.getTime());
    expect(updated.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());

    await deleteType(created.id);
  });

  it('name vacío ⇒ EmptySlugError y la fila queda intacta', async () => {
    const created = await createType({
      name: `${SENTINEL_PREFIX}Intacto`,
      slug: `${SENTINEL_PREFIX}intacto`,
    });

    await expect(updateType(created.id, { name: '' })).rejects.toBeInstanceOf(
      EmptySlugError
    );

    const reread = await findTypeBySlug(`${SENTINEL_PREFIX}intacto`);
    expect(reread?.name).toBe(`${SENTINEL_PREFIX}Intacto`);

    await deleteType(created.id);
  });

  it('id inexistente ⇒ RecordNotFoundError', async () => {
    await expect(
      updateType(999999, { name: `${SENTINEL_PREFIX}Fantasma` })
    ).rejects.toBeInstanceOf(RecordNotFoundError);
  });
});

describe('deleteType — CA-3, R-1 (dos conteos antes de borrar)', () => {
  it('gadget (id 9) tiene dependientes ⇒ DependentRowsError, conteos intactos', async () => {
    const [categoriesBefore, productsBefore] = await Promise.all([
      prisma.category.count({ where: { typeId: 9 } }),
      prisma.product.count({ where: { typeId: 9 } }),
    ]);
    expect(categoriesBefore).toBeGreaterThan(0);
    expect(productsBefore).toBeGreaterThan(0);

    await expect(deleteType(9)).rejects.toBeInstanceOf(DependentRowsError);

    const [categoriesAfter, productsAfter] = await Promise.all([
      prisma.category.count({ where: { typeId: 9 } }),
      prisma.product.count({ where: { typeId: 9 } }),
    ]);
    expect(categoriesAfter).toBe(categoriesBefore);
    expect(productsAfter).toBe(productsBefore);
  });

  it('un centinela sin dependientes se borra: -1 fila, y devuelve la proyección borrada', async () => {
    const created = await createType({
      name: `${SENTINEL_PREFIX}Borrable`,
      slug: `${SENTINEL_PREFIX}borrable`,
    });

    const before = await listTypes();
    const deleted = await deleteType(created.id);
    expect(deleted.id).toBe(created.id);
    expect(deleted.slug).toBe(`${SENTINEL_PREFIX}borrable`);

    const after = await listTypes();
    expect(after).toHaveLength(before.length - 1);
    expect(await findTypeBySlug(`${SENTINEL_PREFIX}borrable`)).toBeNull();
  });

  it('id inexistente ⇒ RecordNotFoundError', async () => {
    await expect(deleteType(999999)).rejects.toBeInstanceOf(RecordNotFoundError);
  });
});

describe('cierre de la suite (CA-6)', () => {
  it('ningún test de escritura dejó basura: prisma.type.count() vuelve a 10', async () => {
    expect(await prisma.type.count()).toBe(10);
  });
});
