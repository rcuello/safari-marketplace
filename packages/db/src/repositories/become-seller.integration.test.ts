/**
 * Test de integración contra el Postgres real (docker-compose, puerto 5433).
 * `become_seller` es la fila única de la página "vender con nosotros"
 * (US-41): US-44 agrega el repositorio de funciones planas
 * (`getBecomeSeller`/`updateBecomeSeller`) que faltaba; el resto de la
 * suite sigue consultando Prisma directo, mismo patrón que `settings`
 * (singleton hermano) en el resto del paquete.
 *
 * Los `describe` de escritura (`updateBecomeSeller`) restauran
 * `pageOptions`/`commissions`/`language`/`updatedAt` al valor tomado en el
 * `beforeAll` vía `_restoreSeedRow` — llamada tanto desde el propio
 * `afterEach` de cada `describe` de escritura (deja la fila en reposo ANTES
 * de que corra el tripwire, que vive más abajo en el mismo archivo) como
 * desde el `afterAll` YA EXISTENTE dos líneas más abajo, dentro de un
 * `try/finally` (red de seguridad si una corrida aborta a mitad de un `it`,
 * antes de llegar a su propio `afterEach`). Sigue habiendo UN SOLO hook
 * `afterAll` en el archivo — NO un segundo: el default
 * `sequence.hooks: 'stack'` de vitest los correría LIFO sobre un cliente ya
 * desconectado (precedente `auth-tokens.integration.test.ts:9-11`).
 */

import 'dotenv/config';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Prisma } from '../../generated/prisma/client/client';
import { prisma } from '../client';
import { _setNowProvider } from '../clock';
import { _toBecomeSellerRecord } from '../records';
import {
  getBecomeSeller,
  updateBecomeSeller,
} from './become-seller.repository';

let originalPageOptions: Prisma.InputJsonValue;
let originalCommissions: Prisma.InputJsonValue;
let originalLanguage: string;
let originalUpdatedAt: Date;

beforeAll(async () => {
  const row = await prisma.becomeSeller.findUniqueOrThrow({ where: { id: 1 } });
  originalPageOptions = row.pageOptions as Prisma.InputJsonValue;
  originalCommissions = row.commissions as Prisma.InputJsonValue;
  originalLanguage = row.language;
  originalUpdatedAt = row.updatedAt;
});

/** Repone la fila al snapshot del `beforeAll`. Ver comentario de cabecera. */
async function _restoreSeedRow(): Promise<void> {
  await prisma.becomeSeller.update({
    where: { id: 1 },
    data: {
      pageOptions: originalPageOptions,
      commissions: originalCommissions,
      language: originalLanguage,
      updatedAt: originalUpdatedAt,
    },
  });
}

afterAll(async () => {
  try {
    await _restoreSeedRow();
  } finally {
    await prisma.$disconnect();
  }
});

describe('singleton de become_seller', () => {
  it('hay exactamente una fila, con id = 1', async () => {
    expect(await prisma.becomeSeller.count()).toBe(1);
    const row = await prisma.becomeSeller.findUniqueOrThrow({
      where: { id: 1 },
    });
    expect(row.id).toBe(1);
  });
});

describe('CHECK become_seller_fila_unica', () => {
  it('insertar una segunda fila (id 2) es rechazado por la CHECK, no por la PK', async () => {
    await expect(
      prisma.$executeRaw`INSERT INTO become_seller (id, page_options, commissions) VALUES (2, '{}'::jsonb, '[]'::jsonb)`
    ).rejects.toThrow(/become_seller_fila_unica/);
  });
});

describe('las dos columnas jsonb conservan ambas colecciones sin fusionarlas (CA-2)', () => {
  it('pageOptions tiene 24 claves (incl. defaultCommissionRate) y commissions un array de 2, sin anidarse', async () => {
    const row = await prisma.becomeSeller.findUniqueOrThrow({
      where: { id: 1 },
    });

    const pageOptions = row.pageOptions as Record<string, unknown>;
    const commissions = row.commissions as unknown[];

    const claves = Object.keys(pageOptions);
    expect(claves).toHaveLength(24);
    expect(claves).toContain('defaultCommissionRate');
    expect(Array.isArray(commissions)).toBe(true);
    expect(commissions).toHaveLength(2);

    // Ninguna anidada dentro de la otra: page_options no tiene una clave
    // `commissions` propia, y el array de commissions no lleva page_options.
    expect(pageOptions).not.toHaveProperty('commissions');
    expect(pageOptions).not.toHaveProperty('page_options');
  });
});

describe('getBecomeSeller devuelve la fila (US-44, D-1)', () => {
  it('id === 1, pageOptions con 24 claves, commissions de longitud 2, language === "en"', async () => {
    const record = await getBecomeSeller();
    if (!record)
      throw new Error('become_seller sin fila (deriva previa a esta suite)');

    expect(record.id).toBe(1);
    const pageOptions = record.pageOptions as Record<string, unknown>;
    const commissions = record.commissions as unknown[];
    expect(Object.keys(pageOptions)).toHaveLength(24);
    expect(commissions).toHaveLength(2);
    expect(record.language).toBe('en');
  });
});

describe('updateBecomeSeller persiste y fija el reloj (US-44, D-1)', () => {
  afterEach(async () => {
    _setNowProvider(() => new Date());
    await _restoreSeedRow();
  });

  it('fija updatedAt con el reloj mockeado, después de createdAt, y la relectura lo confirma', async () => {
    const fija = new Date(Date.now() + 60_000);
    _setNowProvider(() => fija);

    const updated = await updateBecomeSeller({
      pageOptions: originalPageOptions,
      commissions: originalCommissions,
      language: originalLanguage,
    });
    if (!updated)
      throw new Error('become_seller sin fila (deriva previa a esta suite)');

    expect(updated.updatedAt.getTime()).toBe(fija.getTime());
    expect(updated.updatedAt.getTime()).toBeGreaterThan(
      updated.createdAt.getTime()
    );

    const reread = await getBecomeSeller();
    expect(reread?.updatedAt.getTime()).toBe(fija.getTime());
  });
});

describe('updateBecomeSeller no crea una segunda fila (CA-3, US-44)', () => {
  afterEach(async () => {
    _setNowProvider(() => new Date());
    await _restoreSeedRow();
  });

  it('prisma.becomeSeller.count() sigue en 1 tras el update', async () => {
    const updated = await updateBecomeSeller({ language: originalLanguage });
    if (!updated)
      throw new Error('become_seller sin fila (deriva previa a esta suite)');

    expect(await prisma.becomeSeller.count()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tripwire de estado de reposo (D-5, data-layer-clock-policy). US-44 crea la
// PRIMERA ruta de update de esta tabla; antes de esta US, este describe
// afirmaba "no existe ruta de update" — hoy sí existe, y este describe deja
// de significar eso. Pasa a ser un CENTINELA: el seed y el `afterEach` de
// cada `describe` de escritura (arriba) dejan la fila en reposo
// (`updatedAt === createdAt`) para cuando este describe corre — el `afterAll`
// NO sirve para eso, porque dispara al final del archivo, ya pasado este
// describe; si está en rojo, una corrida anterior de
// `updateBecomeSeller` abortó a mitad de escritura sin restaurar. Reparación
// manual (`just db-shell`): `UPDATE become_seller SET updated_at =
// created_at;`. VA DESPUÉS de los `describe` de escritura a propósito:
// vitest ejecuta los `describe` de un archivo en orden de declaración
// (convención citada en `shops.integration.test.ts:472-476`), así que solo
// desde el final cubre toda la batería. Al añadir un `describe` de escritura
// nuevo, va ANTES de este.
// ---------------------------------------------------------------------------
describe('reloj en reposo: updatedAt === createdAt (data-layer-clock-policy, tripwire)', () => {
  it('la fila queda en reposo tras las escrituras de la suite (afterEach)', async () => {
    const row = await prisma.becomeSeller.findUniqueOrThrow({
      where: { id: 1 },
    });
    expect(row.updatedAt.getTime()).toBe(row.createdAt.getTime());
  });
});

describe('sin trigger BEFORE UPDATE (CA-3)', () => {
  it('pg_trigger no tiene ningún trigger propio sobre become_seller', async () => {
    const triggers = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM pg_trigger
      WHERE NOT tgisinternal AND tgrelid = 'become_seller'::regclass
    `;
    expect(Number(triggers[0].count)).toBe(0);
  });
});

describe('_toBecomeSellerRecord (mapper, extended-identity-data-layer)', () => {
  it('pageOptions y commissions cruzan como valores sueltos, ninguno anidado en el otro', async () => {
    const row = await prisma.becomeSeller.findUniqueOrThrow({
      where: { id: 1 },
    });
    const record = _toBecomeSellerRecord(row);

    expect(record.id).toBe(1);
    const pageOptions = record.pageOptions as Record<string, unknown>;
    const commissions = record.commissions as unknown[];
    expect(Object.keys(pageOptions)).toHaveLength(24);
    expect(commissions).toHaveLength(2);
    expect(pageOptions).not.toHaveProperty('commissions');
    expect(() => JSON.stringify(record)).not.toThrow();
  });
});
