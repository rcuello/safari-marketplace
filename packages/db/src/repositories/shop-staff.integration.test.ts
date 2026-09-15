/**
 * Test de integración contra el Postgres real (docker-compose, puerto 5433).
 * `shop_staff` es un pivote puro user<->shop (US-41): sin repositorio de
 * funciones planas en esta capability (llega en US-42), así que la suite
 * consulta Prisma directo, mismo patrón que `permission_user` en
 * `users.integration.test.ts`.
 *
 * Tiendas centinela con prefijo `zz-tiendas-staff-` (empieza por
 * `zz-tiendas-`, así que el `beforeAll(cleanupSentinel)` de
 * `shops.integration.test.ts` también las barre si una corrida se aborta).
 * `ownerId: 3` (admin) en las tiendas centinela: `shops.owner_id` es
 * `ON DELETE RESTRICT`, así que si la tienda perteneciera al usuario
 * centinela el test de cascada de usuario fallaría por violación de FK en
 * vez de ejercitar la cascada. Usuarios en dominio
 * `@shop-staff-integration.test` (RFC 2606).
 */

import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../client';

const SHOP_SENTINEL_PREFIX = 'zz-tiendas-staff-';
const USER_DOMAIN = '@shop-staff-integration.test';

const cleanupShops = () =>
  prisma.shop.deleteMany({ where: { slug: { startsWith: SHOP_SENTINEL_PREFIX } } });
const cleanupUsers = () =>
  prisma.user.deleteMany({ where: { email: { endsWith: USER_DOMAIN } } });

beforeAll(async () => {
  await cleanupShops();
  await cleanupUsers();
});

afterAll(async () => {
  await cleanupShops();
  await cleanupUsers();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Test 1 — VA PRIMERO, antes de que cualquier otro `describe` cree filas
// propias: es la única forma de observar el seed determinista de US-41.
// ---------------------------------------------------------------------------
describe('seed determinista de shop_staff (CA-5)', () => {
  it('exactamente 3 filas, pares (2,1)/(2,2)/(3,1), ninguna con userId 1', async () => {
    const rows = await prisma.shopStaff.findMany({
      orderBy: [{ userId: 'asc' }, { shopId: 'asc' }],
    });
    expect(rows).toHaveLength(3);

    const pares = rows.map((r) => [Number(r.userId), Number(r.shopId)]);
    expect(pares).toEqual([
      [2, 1],
      [2, 2],
      [3, 1],
    ]);
    expect(rows.some((r) => Number(r.userId) === 1)).toBe(false);
  });
});

describe('idempotencia de la asignación staff<->tienda', () => {
  it('upsert({ update: {} }) dos veces sobre el mismo par no duplica ni lanza', async () => {
    const shop = await prisma.shop.create({
      data: {
        name: `${SHOP_SENTINEL_PREFIX}idempotencia`,
        slug: `${SHOP_SENTINEL_PREFIX}idempotencia`,
        ownerId: 3,
      },
    });
    const user = await prisma.user.create({
      data: {
        name: 'Staff idempotente',
        email: `idempotente${USER_DOMAIN}`,
        passwordHash: 'hash-de-prueba',
      },
    });

    const asignar = () =>
      prisma.shopStaff.upsert({
        where: { userId_shopId: { userId: user.id, shopId: shop.id } },
        create: { userId: user.id, shopId: shop.id },
        update: {},
      });

    await expect(asignar()).resolves.not.toThrow();
    await expect(asignar()).resolves.not.toThrow();

    const filas = await prisma.shopStaff.findMany({
      where: { userId: user.id, shopId: shop.id },
    });
    expect(filas).toHaveLength(1);
  });
});

describe('un usuario es staff de dos tiendas', () => {
  it('las dos filas del mismo userId coexisten sin que ningún unique lo impida', async () => {
    const [tiendaA, tiendaB] = await Promise.all([
      prisma.shop.create({
        data: {
          name: `${SHOP_SENTINEL_PREFIX}dos-a`,
          slug: `${SHOP_SENTINEL_PREFIX}dos-a`,
          ownerId: 3,
        },
      }),
      prisma.shop.create({
        data: {
          name: `${SHOP_SENTINEL_PREFIX}dos-b`,
          slug: `${SHOP_SENTINEL_PREFIX}dos-b`,
          ownerId: 3,
        },
      }),
    ]);
    const user = await prisma.user.create({
      data: {
        name: 'Staff de dos tiendas',
        email: `dos-tiendas${USER_DOMAIN}`,
        passwordHash: 'hash-de-prueba',
      },
    });

    await prisma.shopStaff.createMany({
      data: [
        { userId: user.id, shopId: tiendaA.id },
        { userId: user.id, shopId: tiendaB.id },
      ],
    });

    const filas = await prisma.shopStaff.findMany({ where: { userId: user.id } });
    expect(filas).toHaveLength(2);
    const idsEsperados = [Number(tiendaA.id), Number(tiendaB.id)].sort(
      (a, b) => a - b
    );
    expect(filas.map((f) => Number(f.shopId)).sort((a, b) => a - b)).toEqual(
      idsEsperados
    );
  });
});

describe('cascadas del pivote staff<->tienda', () => {
  it('borrar la tienda arrastra sus filas de staff y el usuario sigue existiendo', async () => {
    const shop = await prisma.shop.create({
      data: {
        name: `${SHOP_SENTINEL_PREFIX}cascada-tienda`,
        slug: `${SHOP_SENTINEL_PREFIX}cascada-tienda`,
        ownerId: 3,
      },
    });
    const user = await prisma.user.create({
      data: {
        name: 'Staff cascada tienda',
        email: `cascada-tienda${USER_DOMAIN}`,
        passwordHash: 'hash-de-prueba',
      },
    });
    await prisma.shopStaff.create({ data: { userId: user.id, shopId: shop.id } });

    await prisma.shop.delete({ where: { id: shop.id } });

    expect(
      await prisma.shopStaff.count({ where: { userId: user.id } })
    ).toBe(0);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
  });

  it('borrar el usuario arrastra sus filas de staff y la tienda sigue existiendo', async () => {
    const shop = await prisma.shop.create({
      data: {
        name: `${SHOP_SENTINEL_PREFIX}cascada-usuario`,
        slug: `${SHOP_SENTINEL_PREFIX}cascada-usuario`,
        ownerId: 3,
      },
    });
    const user = await prisma.user.create({
      data: {
        name: 'Staff cascada usuario',
        email: `cascada-usuario${USER_DOMAIN}`,
        passwordHash: 'hash-de-prueba',
      },
    });
    await prisma.shopStaff.create({ data: { userId: user.id, shopId: shop.id } });

    await prisma.user.delete({ where: { id: user.id } });

    expect(
      await prisma.shopStaff.count({ where: { shopId: shop.id } })
    ).toBe(0);
    expect(await prisma.shop.findUnique({ where: { id: shop.id } })).not.toBeNull();
  });
});

describe('shop_staff sin columna de rol, sin updated_at, sin trigger (CA-1, CA-3)', () => {
  it('information_schema.columns expone exactamente {user_id, shop_id, created_at}', async () => {
    const columnas = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'shop_staff'
    `;
    const nombres = columnas.map((c) => c.column_name).sort();
    expect(nombres).toEqual(['created_at', 'shop_id', 'user_id']);
  });

  it('pg_trigger no tiene ningún trigger BEFORE UPDATE sobre shop_staff', async () => {
    const triggers = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM pg_trigger
      WHERE NOT tgisinternal AND tgrelid = 'shop_staff'::regclass
    `;
    expect(Number(triggers[0].count)).toBe(0);
  });
});

// VA EL ÚLTIMO A PROPÓSITO, misma convención que el tripwire de
// `shops.integration.test.ts` (ver su comentario: un PR anterior lo dejó a
// media altura y no cubría los describe posteriores). vitest ejecuta los
// describe de un archivo en orden de declaración, así que solo desde el
// final cubre toda la batería. Al añadir un describe de escritura nuevo, va
// ANTES de este.
//
// NO asevera el total: la limpieza de este archivo es `afterAll`, así que
// las filas derivadas de las tiendas/usuarios centinela siguen vivas en este
// punto (medido: 6 = 3 del seed + 3 centinela). El invariante que SÍ se puede
// comprobar aquí, y el que de verdad importa, es que las 3 filas del seed
// sobrevivieron: los dos tests de cascada borran tiendas y usuarios, y si
// alguno apuntara por error a una fila SEMBRADA (shop 1/2, user 2/3) se
// llevaría el seed por delante y el fallo aparecería como un test 1 roto en
// la corrida SIGUIENTE, no en la que lo causó.
describe('tripwire: las escrituras de este archivo no tocan el seed', () => {
  it('los 3 pares sembrados siguen intactos', async () => {
    const sembrados = await prisma.shopStaff.findMany({
      where: { OR: [{ userId: 2 }, { userId: 3 }] },
      orderBy: [{ userId: 'asc' }, { shopId: 'asc' }],
    });
    expect(sembrados.map((r) => [Number(r.userId), Number(r.shopId)])).toEqual([
      [2, 1],
      [2, 2],
      [3, 1],
    ]);
  });
});
