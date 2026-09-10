/**
 * Test de integración contra el Postgres real (docker-compose, puerto
 * 5433, sembrado por `just db-up`: 14 manufacturers). Lectura y escritura
 * (CA-1, CA-2, CA-3 — US-27b).
 *
 * Las escrituras operan sobre un centinela `zz-manu-` en `name`/`slug` —
 * prefijo distinto de otros archivos de este mismo paquete (`zz-types-`,
 * `zz-tags-`) para que las suites no se limpien la basura mutuamente: no
 * hay `vitest.config.*` en `packages/db`, así que los archivos corren en
 * paralelo (design.md, DD-8.1). `cleanup` corre en `beforeAll` (corrida
 * abortada previa) y se PLIEGA dentro del `afterAll` que ya existía — no se
 * agrega un segundo `afterAll`: `sequence.hooks: 'stack'` es el default de
 * vitest y correría LIFO sobre un cliente ya desconectado si se registrara
 * aparte. A diferencia de `tags.integration.test.ts`, `listManufacturers`
 * ordena `asc` y el assert de `:32-36` está acotado a `limit:10` sobre los
 * ids sembrados 1..10, así que no hay trampa de orden por centinela — las
 * escrituras se agregan igual al final del archivo, siguiendo la misma
 * convención.
 */

import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Prisma } from '../../generated/prisma/client/client';
import { _setNowProvider } from '../clock';
import { prisma } from '../client';
import { EmptySlugError, InvalidReferenceError, RecordNotFoundError } from '../domain-errors';
import {
  createManufacturer,
  deleteManufacturer,
  findManufacturerBySlug,
  listManufacturers,
  updateManufacturer,
} from './manufacturers.repository';

const SENTINEL_PREFIX = 'zz-manu-';

const cleanup = () =>
  prisma.manufacturer.deleteMany({ where: { slug: { startsWith: SENTINEL_PREFIX } } });

beforeAll(cleanup); // corrida abortada previa

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
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

// ---------------------------------------------------------------------------
// Escrituras (CA-1, CA-2, CA-3, CA-6 — US-27b). Sin trampa de orden aquí: a
// diferencia de `tags.integration.test.ts`, `listManufacturers` ordena `asc`
// y el assert de `:32-36` está acotado a `limit:10` sobre los ids sembrados
// 1..10 — un centinela con id ≥ 20 (secuencia sembrada en 20) nunca entra en
// ese slice. Se agregan al final igualmente, siguiendo la misma convención.
// ---------------------------------------------------------------------------

describe('createManufacturer — CA-1, centinela zz-manu-', () => {
  it('persiste y devuelve el registro; sobrevive a una relectura por slug', async () => {
    const created = await createManufacturer({
      name: `${SENTINEL_PREFIX}Marca Verano`,
      slug: `${SENTINEL_PREFIX}marca-verano`,
      typeId: 9,
      isApproved: true,
    });

    expect(created.slug).toBe(`${SENTINEL_PREFIX}marca-verano`);
    expect(created.name).toBe(`${SENTINEL_PREFIX}Marca Verano`);
    expect(created.typeId).toBe(9);
    expect(created.isApproved).toBe(true);

    const reread = await findManufacturerBySlug(created.slug);
    expect(reread).not.toBeNull();
    expect(reread?.id).toBe(created.id);

    await deleteManufacturer(created.id);
  });

  it('typeId mal formado (no entero) ⇒ InvalidReferenceError, sin tocar Postgres', async () => {
    await expect(
      createManufacturer({
        name: `${SENTINEL_PREFIX}Type Invalido`,
        typeId: Number.NaN,
      })
    ).rejects.toBeInstanceOf(InvalidReferenceError);

    expect(await findManufacturerBySlug(`${SENTINEL_PREFIX}type-invalido`)).toBeNull();
  });
});

describe('updateManufacturer — CA-2, slug inmutable, updatedAt explícito', () => {
  it('cambia name, NO el slug, y updatedAt avanza (medido con _setNowProvider)', async () => {
    try {
      const created = await createManufacturer({
        name: `${SENTINEL_PREFIX}Original`,
        slug: `${SENTINEL_PREFIX}original`,
      });

      const future = new Date(Date.now() + 60_000);
      _setNowProvider(() => future);

      const updated = await updateManufacturer(created.id, {
        name: `${SENTINEL_PREFIX}Renombrada`,
      });

      expect(updated.name).toBe(`${SENTINEL_PREFIX}Renombrada`);
      expect(updated.slug).toBe(`${SENTINEL_PREFIX}original`);
      expect(updated.updatedAt.getTime()).toBe(future.getTime());
      expect(updated.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());

      await deleteManufacturer(created.id);
    } finally {
      _setNowProvider(() => new Date());
    }
  });

  it('name vacío ⇒ EmptySlugError y la fila queda intacta', async () => {
    const created = await createManufacturer({
      name: `${SENTINEL_PREFIX}Intacta`,
      slug: `${SENTINEL_PREFIX}intacta`,
    });

    await expect(updateManufacturer(created.id, { name: '' })).rejects.toBeInstanceOf(
      EmptySlugError
    );

    const reread = await findManufacturerBySlug(`${SENTINEL_PREFIX}intacta`);
    expect(reread?.name).toBe(`${SENTINEL_PREFIX}Intacta`);

    await deleteManufacturer(created.id);
  });

  it('id inexistente ⇒ RecordNotFoundError', async () => {
    await expect(
      updateManufacturer(999999, { name: `${SENTINEL_PREFIX}Fantasma` })
    ).rejects.toBeInstanceOf(RecordNotFoundError);
  });

  it('typeId mal formado (no entero) ⇒ InvalidReferenceError, la fila queda intacta', async () => {
    const created = await createManufacturer({
      name: `${SENTINEL_PREFIX}Type Update Invalido`,
      slug: `${SENTINEL_PREFIX}type-update-invalido`,
    });

    await expect(
      updateManufacturer(created.id, { typeId: Number.NaN })
    ).rejects.toBeInstanceOf(InvalidReferenceError);

    const reread = await findManufacturerBySlug(`${SENTINEL_PREFIX}type-update-invalido`);
    expect(reread?.typeId).toBeNull();

    await deleteManufacturer(created.id);
  });
});

describe('deleteManufacturer — CA-3, sin conteo de dependientes (D27b-3)', () => {
  it('id inexistente ⇒ RecordNotFoundError', async () => {
    await expect(deleteManufacturer(999999)).rejects.toBeInstanceOf(RecordNotFoundError);
  });

  it('un centinela se borra: -1 fila, y devuelve la proyección borrada', async () => {
    const created = await createManufacturer({
      name: `${SENTINEL_PREFIX}Borrable`,
      slug: `${SENTINEL_PREFIX}borrable`,
    });

    const deleted = await deleteManufacturer(created.id);
    expect(deleted.id).toBe(created.id);
    expect(deleted.slug).toBe(`${SENTINEL_PREFIX}borrable`);

    expect(await findManufacturerBySlug(`${SENTINEL_PREFIX}borrable`)).toBeNull();
  });

  it('desenlace: borra la marca y `products.manufacturer_id` desenlaza por SET NULL — assert POR FILA, nunca un conteo global (B-2: la fixture de products.integration.test.ts:198-237 mantiene viva otra fila mientras esa suite corre)', async () => {
    const created = await createManufacturer({
      name: `${SENTINEL_PREFIX}Desenlace`,
      slug: `${SENTINEL_PREFIX}desenlace`,
    });

    const [seededProduct] = await prisma.product.findMany({
      orderBy: { id: 'asc' },
      take: 1,
    });
    await prisma.product.update({
      where: { id: seededProduct.id },
      data: { manufacturerId: created.id },
    });
    const linked = await prisma.product.findUnique({ where: { id: seededProduct.id } });
    // `manufacturerId` es `bigint` en la fila cruda de Prisma (bigserial, sin
    // pasar por `_toManufacturerRecord`/`_id`, precedente `records.ts:37-40`);
    // `created.id` ya es `number` — comparar por `Number(...)`.
    expect(Number(linked?.manufacturerId)).toBe(created.id);

    await deleteManufacturer(created.id);

    const probe = await prisma.product.findUnique({ where: { id: seededProduct.id } });
    expect(probe?.manufacturerId).toBeNull();

    // Restaura el estado sembrado si el borrado no lo hubiera hecho ya
    // (defensa en profundidad — SET NULL ya lo garantiza).
    if (probe?.manufacturerId != null) {
      await prisma.product.update({
        where: { id: seededProduct.id },
        data: { manufacturerId: null },
      });
    }
  });
});

describe('image: null se trata como ausente (DD-5) — RV-1 de US-27b', () => {
  // Misma frontera que en `tags.integration.test.ts`: el tipo del input NO
  // admite `null`, pero `manufacturers.service.ts` castea el `image` del DTO
  // con `as unknown as Prisma.InputJsonValue` y un cliente puede mandar
  // `"image": null`. El cast reproduce esa entrada real (nunca `as any`).
  // Sin el `!= null` de los spreads del repositorio, Prisma rechazaría el
  // `null` crudo sobre un `Json?` y, de colar, el toggle de aprobación del
  // admin borraría la imagen en cada clic (W-1). Asserts POR FILA.
  const NULL_IMAGE = null as unknown as Prisma.InputJsonValue;
  const IMAGE = {
    id: 7,
    original: 'https://cdn.test/zz-manu.png',
    thumbnail: 'https://cdn.test/zz-manu-thumb.png',
  };
  const OTHER_IMAGE = { ...IMAGE, id: 8, original: 'https://cdn.test/zz-manu-2.png' };

  it('createManufacturer con image: null persiste sin error y la columna queda NULL', async () => {
    const created = await createManufacturer({
      name: `${SENTINEL_PREFIX}Sin Imagen`,
      slug: `${SENTINEL_PREFIX}sin-imagen`,
      image: NULL_IMAGE,
    });

    expect(created.image).toBeNull();
    const reread = await findManufacturerBySlug(created.slug);
    expect(reread?.image).toBeNull();

    await deleteManufacturer(created.id);
  });

  it('updateManufacturer con image: null NO borra la imagen almacenada; otros campos del mismo PUT sí se aplican', async () => {
    const created = await createManufacturer({
      name: `${SENTINEL_PREFIX}Con Imagen`,
      slug: `${SENTINEL_PREFIX}con-imagen`,
      image: IMAGE,
    });
    expect(created.image).toEqual(IMAGE);

    const updated = await updateManufacturer(created.id, {
      isApproved: false,
      image: NULL_IMAGE,
    });
    expect(updated.isApproved).toBe(false);
    expect(updated.image).toEqual(IMAGE);

    const reread = await findManufacturerBySlug(created.slug);
    expect(reread?.image).toEqual(IMAGE);

    await deleteManufacturer(created.id);
  });

  it('contraste: updateManufacturer con una imagen NUEVA sí la reemplaza — el assert anterior discrimina `null` de un valor', async () => {
    const created = await createManufacturer({
      name: `${SENTINEL_PREFIX}Imagen Reemplazable`,
      slug: `${SENTINEL_PREFIX}imagen-reemplazable`,
      image: IMAGE,
    });

    const updated = await updateManufacturer(created.id, { image: OTHER_IMAGE });
    expect(updated.image).toEqual(OTHER_IMAGE);

    const reread = await findManufacturerBySlug(created.slug);
    expect(reread?.image).toEqual(OTHER_IMAGE);

    await deleteManufacturer(created.id);
  });
});

describe('cierre de la suite (CA-6)', () => {
  it('ningún test de escritura dejó basura: prisma.manufacturer.count() vuelve a 14', async () => {
    expect(await prisma.manufacturer.count()).toBe(14);
  });
});
