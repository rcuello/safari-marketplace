/**
 * Test de integración contra el Postgres real (sembrado por `just db-up`:
 * 8 atributos, ids 11,10,9,8,6,5,4,3, con 27 valores). US-50.
 *
 * Las escrituras usan el centinela `zz-attr-` en el nombre (y por tanto en el
 * slug). La prueba de colisión de slug crea un «Color» sin centinela: su id se
 * apunta en `createdIds` y se borra en `afterAll`. Lecturas del seed ANTES
 * que escrituras.
 */

import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { _setNowProvider } from '../clock';
import { prisma } from '../client';
import {
  EmptySlugError,
  InvalidReferenceError,
  RecordNotFoundError,
} from '../domain-errors';
import {
  createAttribute,
  deleteAttribute,
  findAttributeByIdOrSlug,
  listAttributes,
  updateAttribute,
} from './attributes.repository';

const SENTINEL_PREFIX = 'zz-attr-';
const createdIds: number[] = [];

const cleanup = async () => {
  await prisma.attribute.deleteMany({
    where: {
      OR: [{ slug: { startsWith: SENTINEL_PREFIX } }, { id: { in: createdIds } }],
    },
  });
};

beforeAll(cleanup);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe('listAttributes — seed', () => {
  it('8 atributos en id DESC, 27 valores en id ASC dentro de cada padre', async () => {
    const attributes = await listAttributes();
    expect(attributes.map((a) => a.id)).toEqual([11, 10, 9, 8, 6, 5, 4, 3]);
    expect(attributes.reduce((n, a) => n + a.values.length, 0)).toBe(27);
    for (const a of attributes) {
      const ids = a.values.map((v) => v.id);
      expect(ids).toEqual([...ids].sort((x, y) => x - y));
      expect(a.values.every((v) => v.attributeId === a.id)).toBe(true);
    }
  });

  it('filtra por tienda: la 11 tiene los atributos 10 y 9', async () => {
    expect((await listAttributes({ shopId: 11 })).map((a) => a.id)).toEqual([10, 9]);
  });

  it('filtra por nombre case-insensitive: "color" → 10, 8 y 3', async () => {
    expect((await listAttributes({ name: 'COLOR' })).map((a) => a.id)).toEqual([10, 8, 3]);
  });
});

describe('findAttributeByIdOrSlug', () => {
  it('por id y por slug con mayúsculas; null si no existe', async () => {
    expect((await findAttributeByIdOrSlug('5'))?.slug).toBe('language');
    expect((await findAttributeByIdOrSlug('color-OMG'))?.id).toBe(10);
    expect(await findAttributeByIdOrSlug('999999')).toBeNull();
    expect(await findAttributeByIdOrSlug('no-existe')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Escrituras — NO INSERTAR LECTURAS DEL SEED DEBAJO DE ESTA LÍNEA.
// ---------------------------------------------------------------------------

describe('createAttribute', () => {
  it('crea padre y valores juntos, con slugs generados y valores en id ASC', async () => {
    const created = await createAttribute({
      name: `${SENTINEL_PREFIX}Material`,
      shopId: 2,
      values: [{ value: 'Madera' }, { value: 'Metal', meta: '#999' }],
    });
    expect(created.slug).toBe(`${SENTINEL_PREFIX}material`);
    expect(created.shopId).toBe(2);
    expect(created.values.map((v) => [v.value, v.slug, v.meta])).toEqual([
      ['Madera', 'madera', null],
      ['Metal', 'metal', '#999'],
    ]);
  });

  it('dos valores con el mismo texto reciben sufijo dentro del atributo', async () => {
    const created = await createAttribute({
      name: `${SENTINEL_PREFIX}Repetidos`,
      shopId: 2,
      values: [{ value: 'Rojo' }, { value: 'Rojo' }],
    });
    expect(created.values.map((v) => v.slug)).toEqual(['rojo', 'rojo-2']);
  });

  it('un nombre que ya existe ("Color") recibe sufijo con el esquema de generateSlug', async () => {
    const created = await createAttribute({ name: 'Color', shopId: 2, values: [] });
    createdIds.push(created.id);
    expect(created.slug).toBe('color-2');
  });

  it('tienda inexistente ⇒ InvalidReferenceError sin dejar padre ni valores', async () => {
    const beforeAttrs = await prisma.attribute.count();
    const beforeValues = await prisma.attributeValue.count();
    const failure = createAttribute({
      name: `${SENTINEL_PREFIX}Huerfano`,
      shopId: 999_999,
      values: [{ value: 'A' }, { value: 'B' }],
    });
    await expect(failure).rejects.toBeInstanceOf(InvalidReferenceError);
    await expect(failure).rejects.toThrow('`attributes.shop_id`');
    await expect(
      createAttribute({ name: `${SENTINEL_PREFIX}Huerfano`, shopId: Number.NaN })
    ).rejects.toBeInstanceOf(InvalidReferenceError);
    expect(await prisma.attribute.count()).toBe(beforeAttrs);
    expect(await prisma.attributeValue.count()).toBe(beforeValues);
  });
});

describe('updateAttribute — reconciliación', () => {
  it('A editado, B omitido, C intacto y D nuevo ⇒ quedan A, C y D', async () => {
    try {
      const created = await createAttribute({
        name: `${SENTINEL_PREFIX}Reconciliar`,
        shopId: 2,
        values: [{ value: 'A' }, { value: 'B' }, { value: 'C' }],
      });
      const [a, , c] = created.values;
      const future = new Date(Date.now() + 60_000);
      _setNowProvider(() => future);

      const updated = await updateAttribute(created.id, {
        name: `${SENTINEL_PREFIX}Reconciliado`,
        values: [
          { id: a.id, value: 'A editado', meta: 'm' },
          { id: c.id, value: 'C' },
          { id: null, value: 'D' },
        ],
      });

      expect(updated.name).toBe(`${SENTINEL_PREFIX}Reconciliado`);
      expect(updated.slug).toBe(`${SENTINEL_PREFIX}reconciliar`);
      expect(updated.values.map((v) => [v.value, v.slug])).toEqual([
        ['A editado', 'a'],
        ['C', 'c'],
        ['D', 'd'],
      ]);
      expect(updated.values[0].id).toBe(a.id);
      expect(updated.values[0].meta).toBe('m');
      expect(updated.updatedAt.getTime()).toBe(future.getTime());
      expect(updated.values[0].updatedAt.getTime()).toBe(future.getTime());
    } finally {
      _setNowProvider(() => new Date());
    }
  });

  it('un id de OTRO atributo ⇒ InvalidReferenceError y nada cambia', async () => {
    const created = await createAttribute({
      name: `${SENTINEL_PREFIX}Ajeno`,
      shopId: 2,
      values: [{ value: 'X' }],
    });
    await expect(
      updateAttribute(created.id, { values: [{ id: 8, value: 'robado' }] })
    ).rejects.toBeInstanceOf(InvalidReferenceError);
    const after = await findAttributeByIdOrSlug(String(created.id));
    expect(after?.values.map((v) => v.value)).toEqual(['X']);
    const intact = await prisma.attributeValue.findUnique({ where: { id: 8 } });
    expect([intact?.attributeId, intact?.value]).toEqual([3n, 'Red']);
  });

  it('sin `values` en el body no toca los valores; nombre vacío ⇒ EmptySlugError', async () => {
    const created = await createAttribute({
      name: `${SENTINEL_PREFIX}SoloNombre`,
      shopId: 2,
      values: [{ value: 'Uno' }],
    });
    const updated = await updateAttribute(created.id, { name: `${SENTINEL_PREFIX}Renombrado` });
    expect(updated.values.map((v) => v.value)).toEqual(['Uno']);
    await expect(updateAttribute(created.id, { name: '???' })).rejects.toBeInstanceOf(
      EmptySlugError
    );
  });

  it('id inexistente ⇒ RecordNotFoundError', async () => {
    await expect(updateAttribute(999_999, { name: 'x' })).rejects.toBeInstanceOf(
      RecordNotFoundError
    );
  });
});

describe('deleteAttribute', () => {
  it('borra en cascada y devuelve el atributo con sus valores', async () => {
    const created = await createAttribute({
      name: `${SENTINEL_PREFIX}Borrar`,
      shopId: 2,
      values: [{ value: 'P' }, { value: 'Q' }],
    });
    const deleted = await deleteAttribute(created.id);
    expect(deleted.values).toHaveLength(2);
    expect(await prisma.attributeValue.count({ where: { attributeId: created.id } })).toBe(0);
    await expect(deleteAttribute(created.id)).rejects.toBeInstanceOf(RecordNotFoundError);
  });
});
