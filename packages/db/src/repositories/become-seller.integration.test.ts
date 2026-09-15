/**
 * Test de integración contra el Postgres real (docker-compose, puerto 5433).
 * `become_seller` es la fila única de la página "vender con nosotros"
 * (US-41): sin repositorio de funciones planas en esta capability (llega en
 * US-44), así que la suite consulta Prisma directo, mismo patrón que
 * `settings` (singleton hermano) en el resto del paquete.
 *
 * Solo lectura salvo el test de la CHECK (test 8), que intenta un INSERT
 * destinado a fallar: no deja fila viva que limpiar.
 */

import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../client';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('singleton de become_seller', () => {
  it('hay exactamente una fila, con id = 1', async () => {
    expect(await prisma.becomeSeller.count()).toBe(1);
    const row = await prisma.becomeSeller.findUniqueOrThrow({ where: { id: 1 } });
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
    const row = await prisma.becomeSeller.findUniqueOrThrow({ where: { id: 1 } });

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

describe('reloj sin ruta de update: updatedAt === createdAt (data-layer-clock-policy)', () => {
  it('la fila sembrada no tiene aún ninguna función que la actualice', async () => {
    const row = await prisma.becomeSeller.findUniqueOrThrow({ where: { id: 1 } });
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
