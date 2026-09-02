/**
 * Test de integración contra el Postgres real (docker-compose, puerto
 * 5433, sembrado por `just db-up`: 3 usuarios, 12 tiendas).
 *
 * Las escrituras (CA-4) operan EXCLUSIVAMENTE sobre un dominio centinela
 * (Decisión C, design.md) — nunca sobre los 3 usuarios sembrados:
 * `updateUserPasswordHash(3, …)` destruiría la credencial `demodemo` de
 * la que depende la DoD de US-22, y `setUserActive(3, false)` sin
 * restaurar deja el panel de admin inaccesible sin `just db-reset`.
 *
 * El casing mezclado que exigen CA-2/CA-4 va en la PARTE LOCAL del email
 * de prueba, nunca en el dominio: la columna `email` es `text` y
 * `endsWith` genera un `LIKE` case-sensitive, así que si el casing
 * viviera en el dominio la limpieza no encontraría su propia fila.
 */

import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../client';
import {
  createUser,
  DuplicateEmailError,
  findUserById,
  findUserCredentialsByEmail,
  findUserWithRelations,
  listUsers,
  setUserActive,
  updateUserPasswordHash,
} from './users.repository';

const TEST_DOMAIN = '@users-integration.test'; // RFC 2606: nunca será un usuario real

const cleanup = () =>
  prisma.user.deleteMany({ where: { email: { endsWith: TEST_DOMAIN } } });

beforeAll(cleanup); // corrida abortada previa
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('findUserCredentialsByEmail', () => {
  it('encuentra a admin@demo.com con casing mezclado (usa lower() en ambos lados)', async () => {
    const creds = await findUserCredentialsByEmail('ADMIN@Demo.com');
    expect(creds).not.toBeNull();
    expect(creds?.email).toBe('admin@demo.com');
    expect(creds?.isActive).toBe(true);
    expect(typeof creds?.passwordHash).toBe('string');
  });

  it('devuelve null si el email no existe', async () => {
    const creds = await findUserCredentialsByEmail('nadie@demo.com');
    expect(creds).toBeNull();
  });

  it('el mapeo a mano produce una fila JSON-safe con las 4 claves camelCase', async () => {
    const creds = await findUserCredentialsByEmail('admin@demo.com');
    expect(creds).not.toBeNull();
    expect(typeof creds?.id).toBe('number');
    expect(Object.keys(creds ?? {}).sort()).toEqual(
      ['email', 'id', 'isActive', 'passwordHash'].sort()
    );
    expect(() => JSON.stringify(creds)).not.toThrow();
  });
});

describe('findUserById', () => {
  it('el UserRecord público no expone el hash', async () => {
    const user = await findUserById(3); // admin@demo.com
    expect(user).not.toBeNull();
    expect(Object.keys(user ?? {})).not.toContain('passwordHash');
    expect(JSON.stringify(user)).not.toContain('$2'); // prefijo bcrypt
  });

  it('devuelve null si el id no existe', async () => {
    expect(await findUserById(999999)).toBeNull();
  });
});

describe('findUserWithRelations', () => {
  it('el usuario 1 trae perfil, sus 2 permisos y las 12 tiendas de las que es dueño', async () => {
    const user = await findUserWithRelations(1); // store_owner@demo.com
    expect(user).not.toBeNull();
    expect(user?.profile).not.toBeNull();
    expect(user?.permissions).toHaveLength(2);
    expect(user?.shops).toHaveLength(12);
    // Ninguna relación anidada filtra el hash — el prefijo bcrypt atrapa
    // la fuga que un Object.keys de primer nivel no vería (R-4).
    expect(JSON.stringify(user)).not.toContain('$2');
  });

  it('devuelve null si el id no existe', async () => {
    expect(await findUserWithRelations(999999)).toBeNull();
  });
});

describe('listUsers', () => {
  it('filtra por permissionName: solo admin tiene super_admin', async () => {
    const { items, total } = await listUsers({ permissionName: 'super_admin' });
    expect(total).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0]?.email).toBe('admin@demo.com');
    expect(JSON.stringify(items)).not.toContain('$2');
  });

  it('busca por texto en name o email', async () => {
    // Las dos ramas del OR se assertan por separado a proposito. 'admin'
    // solo coincide con el email (el usuario 3 se llama 'Jhon Doe'), asi
    // que sin el caso de abajo la rama `name` quedaria sin cobertura y se
    // podria borrar con la suite en verde.
    const byEmail = await listUsers({ text: 'admin' });
    expect(byEmail.items.some((u) => u.email === 'admin@demo.com')).toBe(true);

    const byName = await listUsers({ text: 'Jhon' });
    expect(byName.items.some((u) => u.email === 'admin@demo.com')).toBe(true);
  });

  it('sin filtro trae al menos los 3 usuarios sembrados', async () => {
    const { total } = await listUsers();
    expect(total).toBeGreaterThanOrEqual(3);
  });
});

describe('escrituras de identidad (CA-4) — dominio centinela, nunca los sembrados', () => {
  it('createUser crea usuario + perfil + permiso inicial', async () => {
    const email = `Create-User${TEST_DOMAIN}`;
    const user = await createUser({
      name: 'Usuario de prueba',
      email,
      passwordHash: 'hash-de-prueba',
      profile: { bio: 'bio de prueba' },
      permissionNames: ['customer'],
    });

    expect(user.email).toBe(email);
    expect(Object.keys(user)).not.toContain('passwordHash');

    const withRelations = await findUserWithRelations(user.id);
    expect(withRelations?.profile?.bio).toBe('bio de prueba');
    expect(withRelations?.permissions.map((p) => p.name)).toEqual(['customer']);
  });

  it('createUser repetido con otro casing del mismo email lanza DuplicateEmailError', async () => {
    const email = `Duplicate-User${TEST_DOMAIN}`;
    await createUser({
      name: 'Original',
      email,
      passwordHash: 'hash-original',
    });

    await expect(
      createUser({
        name: 'Duplicado',
        email: email.toUpperCase(),
        passwordHash: 'hash-duplicado',
      })
    ).rejects.toBeInstanceOf(DuplicateEmailError);
  });

  it('updateUserPasswordHash cambia el hash que ve findUserCredentialsByEmail', async () => {
    const email = `Password-User${TEST_DOMAIN}`;
    const user = await createUser({
      name: 'Cambia password',
      email,
      passwordHash: 'hash-viejo',
    });

    const updated = await updateUserPasswordHash(user.id, 'hash-nuevo');
    expect(updated).not.toBeNull();

    const creds = await findUserCredentialsByEmail(email);
    expect(creds?.passwordHash).toBe('hash-nuevo');
  });

  it('updateUserPasswordHash(999999, …) devuelve null (P2025)', async () => {
    expect(await updateUserPasswordHash(999999, 'x')).toBeNull();
  });

  it('setUserActive activa y desactiva', async () => {
    const email = `Active-User${TEST_DOMAIN}`;
    const user = await createUser({
      name: 'Activable',
      email,
      passwordHash: 'hash',
      isActive: true,
    });

    const deactivated = await setUserActive(user.id, false);
    expect(deactivated?.isActive).toBe(false);

    const reactivated = await setUserActive(user.id, true);
    expect(reactivated?.isActive).toBe(true);
  });

  it('setUserActive(999999, …) devuelve null (P2025)', async () => {
    expect(await setUserActive(999999, false)).toBeNull();
  });
});

// Nota: los conteos "antes/después" (users 3, shops 12, products 1200,
// categories 198) NO se assertan aquí — mientras este archivo corre, las
// filas del dominio centinela siguen vivas (la limpieza de `afterAll` no
// se ha ejecutado todavía). La prueba real de que la suite completa deja
// la base como la encontró es el `SELECT count(*)` externo antes/después
// de `just db-check` (ver apply-progress.md, evidencia de la Fase 6).
