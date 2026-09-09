/**
 * slug.integration.test.ts — prueba `normalizeSlug`/`generateSlug` contra
 * el Postgres real (docker-compose, puerto 5433), pero SOLO para
 * `SELECT slugify($1)`. Los casos de colisión inyectan `ExistingSlugLookup`
 * como un array EN MEMORIA — este archivo NO lee ni escribe la tabla
 * `types` (gate finding B4): `packages/db` no tiene `vitest.config.*`, así
 * que los archivos corren en paralelo, y `types.integration.test.ts:18`
 * asserta `toHaveLength(10)` sobre `listTypes()` sin filtro — cualquier
 * escritura ajena en `types` lo volvería intermitente.
 */

import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from './client';
import { EmptySlugError } from './domain-errors';
import { generateSlug, normalizeSlug } from './slug';

const AGGREGATE = 'slug-fixture'; // solo etiqueta de mensaje; nunca toca una tabla real

afterAll(async () => {
  await prisma.$disconnect();
});

/** El mismo cómputo, pero llamado directo contra Postgres para comparar. */
async function slugifyDirect(text: string): Promise<string> {
  const rows = await prisma.$queryRaw<{ slugify: string }[]>`
    SELECT slugify(${text})
  `;
  return rows[0]?.slugify ?? '';
}

describe('normalizeSlug', () => {
  it.each(['Café & Té', 'Acción!', 'Niño Grande'])(
    'normaliza "%s" idéntico a SELECT slugify($1)',
    async (text) => {
      const [expected, actual] = await Promise.all([
        slugifyDirect(text),
        normalizeSlug(text, AGGREGATE),
      ]);
      expect(actual).toBe(expected);
      expect(actual).not.toBe('');
    }
  );

  it('"!!!" normaliza a vacío y lanza EmptySlugError', async () => {
    await expect(normalizeSlug('!!!', AGGREGATE)).rejects.toBeInstanceOf(
      EmptySlugError
    );
  });

  it('"" lanza EmptySlugError sin ir a la base', async () => {
    await expect(normalizeSlug('', AGGREGATE)).rejects.toBeInstanceOf(
      EmptySlugError
    );
  });

  it('undefined (input no tipado en runtime) lanza EmptySlugError sin ir a la base', async () => {
    // El tsconfig de la API no activa `strict`: un `undefined` puede cruzar
    // la frontera con el tipo diciendo `string`. La guarda de runtime debe
    // atraparlo antes de cualquier query.
    await expect(
      normalizeSlug(undefined as unknown as string, AGGREGATE)
    ).rejects.toBeInstanceOf(EmptySlugError);
  });
});

describe('generateSlug', () => {
  const noCollision = async () => [] as string[];

  it('un `slug` explícito del cliente gana sobre `name`', async () => {
    const result = await generateSlug(
      { name: 'Vertical X', slug: 'vertical-custom' },
      noCollision,
      AGGREGATE
    );
    expect(result).toBe('vertical-custom');
  });

  it('sin colisión, devuelve el slug normalizado tal cual', async () => {
    const result = await generateSlug(
      { name: 'Gadget Nuevo' },
      noCollision,
      AGGREGATE
    );
    expect(result).toBe('gadget-nuevo');
  });

  it('primera colisión produce el sufijo -2 (lookup en memoria, sin tocar `types`)', async () => {
    const lookup = async (prefix: string) =>
      ['gadget'].filter((slug) => slug.startsWith(prefix));
    const result = await generateSlug({ name: 'Gadget' }, lookup, AGGREGATE);
    expect(result).toBe('gadget-2');
  });

  it('colisiones sucesivas incrementan el sufijo (gadget + gadget-2 -> gadget-3)', async () => {
    const lookup = async (prefix: string) =>
      ['gadget', 'gadget-2'].filter((slug) => slug.startsWith(prefix));
    const result = await generateSlug({ name: 'Gadget' }, lookup, AGGREGATE);
    expect(result).toBe('gadget-3');
  });

  it('name vacío lanza EmptySlugError antes de invocar el lookup', async () => {
    let lookupCalled = false;
    const lookup = async () => {
      lookupCalled = true;
      return [];
    };
    await expect(
      generateSlug({ name: '!!!' }, lookup, AGGREGATE)
    ).rejects.toBeInstanceOf(EmptySlugError);
    expect(lookupCalled).toBe(false);
  });
});
