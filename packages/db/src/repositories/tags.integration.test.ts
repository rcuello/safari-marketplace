/**
 * Test de integración contra el Postgres real (docker-compose, puerto
 * 5433, sembrado por `just db-up`: 10 tags). Lectura y escritura (CA-1,
 * CA-2, CA-3 — US-27b).
 *
 * Las escrituras operan sobre un centinela `zz-tags-` en `name`/`slug` —
 * prefijo distinto de otros archivos de este mismo paquete (`zz-types-`,
 * `zz-manu-`) para que las suites no se limpien la basura mutuamente: no
 * hay `vitest.config.*` en `packages/db`, así que los archivos corren en
 * paralelo (design.md, DD-8.1). `cleanup` corre en `beforeAll` (corrida
 * abortada previa) y se PLIEGA dentro del `afterAll` que ya existía — no se
 * agrega un segundo `afterAll`: `sequence.hooks: 'stack'` es el default de
 * vitest y correría LIFO sobre un cliente ya desconectado si se registrara
 * aparte.
 */

import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Prisma } from '../../generated/prisma/client/client';
import { _setNowProvider } from '../clock';
import { prisma } from '../client';
import { EmptySlugError, InvalidReferenceError, RecordNotFoundError } from '../domain-errors';
import { createTag, deleteTag, findTagBySlug, listTags, updateTag } from './tags.repository';

const SENTINEL_PREFIX = 'zz-tags-';

const cleanup = () =>
  prisma.tag.deleteMany({ where: { slug: { startsWith: SENTINEL_PREFIX } } });

beforeAll(cleanup); // corrida abortada previa

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
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

// ---------------------------------------------------------------------------
// Escrituras (CA-1, CA-2, CA-3, CA-6 — US-27b). NO INSERTAR TESTS DE LECTURA
// DEBAJO DE ESTA LÍNEA: `listTags` (arriba, `:19-20`) asserta
// `items[0].id === 62` sobre un `orderBy: { id: 'desc' }` SIN filtro. Vitest
// corre los tests de un archivo en orden de declaración; cualquier tag
// centinela vivo (id > 62) mientras corre ese assert lo pone rojo. El orden
// de los `describe` de abajo —después de las lecturas— es la garantía
// (design.md, DD-8.3).
// ---------------------------------------------------------------------------

describe('createTag — CA-1, centinela zz-tags-', () => {
  it('persiste y devuelve el registro; sobrevive a una relectura por slug', async () => {
    const created = await createTag({
      name: `${SENTINEL_PREFIX}Oferta Verano`,
      slug: `${SENTINEL_PREFIX}oferta-verano`,
      typeId: 9,
    });

    expect(created.slug).toBe(`${SENTINEL_PREFIX}oferta-verano`);
    expect(created.name).toBe(`${SENTINEL_PREFIX}Oferta Verano`);
    expect(created.typeId).toBe(9);

    const reread = await findTagBySlug(created.slug);
    expect(reread).not.toBeNull();
    expect(reread?.id).toBe(created.id);

    await deleteTag(created.id);
  });

  it('typeId mal formado (no entero) ⇒ InvalidReferenceError, sin tocar Postgres', async () => {
    await expect(
      createTag({
        name: `${SENTINEL_PREFIX}Type Invalido`,
        typeId: Number.NaN,
      })
    ).rejects.toBeInstanceOf(InvalidReferenceError);

    expect(await findTagBySlug(`${SENTINEL_PREFIX}type-invalido`)).toBeNull();
  });
});

describe('updateTag — CA-2, slug inmutable, updatedAt explícito', () => {
  it('cambia name, NO el slug, y updatedAt avanza (medido con _setNowProvider)', async () => {
    try {
      const created = await createTag({
        name: `${SENTINEL_PREFIX}Original`,
        slug: `${SENTINEL_PREFIX}original`,
      });

      const future = new Date(Date.now() + 60_000);
      _setNowProvider(() => future);

      const updated = await updateTag(created.id, {
        name: `${SENTINEL_PREFIX}Renombrado`,
      });

      expect(updated.name).toBe(`${SENTINEL_PREFIX}Renombrado`);
      expect(updated.slug).toBe(`${SENTINEL_PREFIX}original`);
      expect(updated.updatedAt.getTime()).toBe(future.getTime());
      expect(updated.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());

      await deleteTag(created.id);
    } finally {
      _setNowProvider(() => new Date());
    }
  });

  it('name vacío ⇒ EmptySlugError y la fila queda intacta', async () => {
    const created = await createTag({
      name: `${SENTINEL_PREFIX}Intacto`,
      slug: `${SENTINEL_PREFIX}intacto`,
    });

    await expect(updateTag(created.id, { name: '' })).rejects.toBeInstanceOf(
      EmptySlugError
    );

    const reread = await findTagBySlug(`${SENTINEL_PREFIX}intacto`);
    expect(reread?.name).toBe(`${SENTINEL_PREFIX}Intacto`);

    await deleteTag(created.id);
  });

  it('id inexistente ⇒ RecordNotFoundError', async () => {
    await expect(
      updateTag(999999, { name: `${SENTINEL_PREFIX}Fantasma` })
    ).rejects.toBeInstanceOf(RecordNotFoundError);
  });

  it('typeId mal formado (no entero) ⇒ InvalidReferenceError, la fila queda intacta', async () => {
    const created = await createTag({
      name: `${SENTINEL_PREFIX}Type Update Invalido`,
      slug: `${SENTINEL_PREFIX}type-update-invalido`,
    });

    await expect(
      updateTag(created.id, { typeId: Number.NaN })
    ).rejects.toBeInstanceOf(InvalidReferenceError);

    const reread = await findTagBySlug(`${SENTINEL_PREFIX}type-update-invalido`);
    expect(reread?.typeId).toBeNull();

    await deleteTag(created.id);
  });
});

describe('deleteTag — CA-3, sin conteo de dependientes (D27b-3)', () => {
  it('id inexistente ⇒ RecordNotFoundError', async () => {
    await expect(deleteTag(999999)).rejects.toBeInstanceOf(RecordNotFoundError);
  });

  it('un centinela se borra: -1 fila, y devuelve la proyección borrada', async () => {
    const created = await createTag({
      name: `${SENTINEL_PREFIX}Borrable`,
      slug: `${SENTINEL_PREFIX}borrable`,
    });

    const deleted = await deleteTag(created.id);
    expect(deleted.id).toBe(created.id);
    expect(deleted.slug).toBe(`${SENTINEL_PREFIX}borrable`);

    expect(await findTagBySlug(`${SENTINEL_PREFIX}borrable`)).toBeNull();
  });

  it('desenlace: borra el tag y `product_tag` desenlaza por CASCADE — assert POR FILA, nunca un conteo global (B-2: la fixture de products.integration.test.ts:198-237 mantiene viva product_tag mientras esa suite corre)', async () => {
    const created = await createTag({
      name: `${SENTINEL_PREFIX}Desenlace`,
      slug: `${SENTINEL_PREFIX}desenlace`,
    });

    const [seededProduct] = await prisma.product.findMany({
      orderBy: { id: 'asc' },
      take: 1,
    });
    await prisma.productTag.create({
      data: { productId: seededProduct.id, tagId: created.id },
    });
    expect(
      await prisma.productTag.count({ where: { tagId: created.id } })
    ).toBe(1);

    await deleteTag(created.id);

    expect(
      await prisma.productTag.count({ where: { tagId: created.id } })
    ).toBe(0);
  });
});

describe('image: null se trata como ausente (DD-5) — RV-1 de US-27b', () => {
  // `CreateTagInput.image`/`UpdateTagInput.image` NO admiten `null` en el
  // tipo, pero el runtime sí lo recibe: `tags.service.ts` castea el `image`
  // del DTO con `as unknown as Prisma.InputJsonValue` y cualquier cliente
  // puede mandar `"image": null`. El mismo cast reproduce aquí esa entrada
  // real (nunca `as any`). Sin el `!= null` de los spreads del repositorio,
  // Prisma rechazaría el `null` crudo sobre un `Json?` (exige
  // `Prisma.DbNull`/`JsonNull`) y, de colar, cada PUT del admin borraría la
  // imagen almacenada (W-1). Asserts POR FILA, nunca conteos globales.
  const NULL_IMAGE = null as unknown as Prisma.InputJsonValue;
  const IMAGE = {
    id: 7,
    original: 'https://cdn.test/zz-tags.png',
    thumbnail: 'https://cdn.test/zz-tags-thumb.png',
  };
  const OTHER_IMAGE = { ...IMAGE, id: 8, original: 'https://cdn.test/zz-tags-2.png' };

  it('createTag con image: null persiste sin error y la columna queda NULL', async () => {
    const created = await createTag({
      name: `${SENTINEL_PREFIX}Sin Imagen`,
      slug: `${SENTINEL_PREFIX}sin-imagen`,
      image: NULL_IMAGE,
    });

    expect(created.image).toBeNull();
    const reread = await findTagBySlug(created.slug);
    expect(reread?.image).toBeNull();

    await deleteTag(created.id);
  });

  it('updateTag con image: null NO borra la imagen almacenada; otros campos del mismo PUT sí se aplican', async () => {
    const created = await createTag({
      name: `${SENTINEL_PREFIX}Con Imagen`,
      slug: `${SENTINEL_PREFIX}con-imagen`,
      image: IMAGE,
    });
    expect(created.image).toEqual(IMAGE);

    const updated = await updateTag(created.id, {
      name: `${SENTINEL_PREFIX}Con Imagen Renombrado`,
      image: NULL_IMAGE,
    });
    expect(updated.name).toBe(`${SENTINEL_PREFIX}Con Imagen Renombrado`);
    expect(updated.image).toEqual(IMAGE);

    const reread = await findTagBySlug(created.slug);
    expect(reread?.image).toEqual(IMAGE);

    await deleteTag(created.id);
  });

  it('contraste: updateTag con una imagen NUEVA sí la reemplaza — el assert anterior discrimina `null` de un valor', async () => {
    const created = await createTag({
      name: `${SENTINEL_PREFIX}Imagen Reemplazable`,
      slug: `${SENTINEL_PREFIX}imagen-reemplazable`,
      image: IMAGE,
    });

    const updated = await updateTag(created.id, { image: OTHER_IMAGE });
    expect(updated.image).toEqual(OTHER_IMAGE);

    const reread = await findTagBySlug(created.slug);
    expect(reread?.image).toEqual(OTHER_IMAGE);

    await deleteTag(created.id);
  });
});

describe('cierre de la suite (CA-6)', () => {
  it('ningún test de escritura dejó basura: prisma.tag.count() vuelve a 10', async () => {
    expect(await prisma.tag.count()).toBe(10);
  });
});
