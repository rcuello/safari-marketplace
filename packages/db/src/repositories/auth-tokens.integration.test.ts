/**
 * Test de integración contra el Postgres real (docker-compose, puerto
 * 5433, sembrado por `just db-up`).
 *
 * Dos centinelas, ninguno toca filas sembradas (Decisión H, design.md):
 *   · Un usuario `createUser` en dominio `@auth-tokens-integration.test`
 *     (RFC 2606). Sus `password_reset_tokens` caen por `ON DELETE
 *     CASCADE` (`db/schema.sql:189`) — limpiarlo alcanza con
 *     `prisma.user.deleteMany({email: {endsWith: TEST_DOMAIN}})`.
 *   · Un prefijo de teléfono centinela para `otp_codes` (sin FK):
 *     `prisma.otpCode.deleteMany({phone: {startsWith: OTP_TEST_PREFIX}})`.
 *
 * `_setNowProvider` (`src/clock.ts`) es el reloj mockeable del paquete;
 * este archivo es su primer consumidor real. Se restaura en `afterEach`
 * (corre aunque el `it` reviente a mitad) Y en `afterAll` (cubre un
 * fallo del propio `afterEach`) — nunca dentro de un `it`. Un provider
 * que se filtre contamina el resto de `just db-check`.
 *
 * Los conteos de `identity-data-layer` (3 users / 12 shops / 1200
 * products / 198 categories) no cambian: el usuario centinela vive solo
 * durante este archivo y las tablas de tokens no están entre los
 * conteos fijados.
 */

import 'dotenv/config';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { _setNowProvider } from '../clock';
import { prisma } from '../client';
import { createUser } from './users.repository';
import {
  consumeOtpCode,
  consumePasswordResetToken,
  createOtpCode,
  createPasswordResetToken,
  findLiveOtpCodeById,
  findLivePasswordResetTokens,
  findUserIdByProfileContact,
  purgeExpiredAuthTokens,
} from './auth-tokens.repository';

const TEST_DOMAIN = '@auth-tokens-integration.test'; // RFC 2606
const OTP_TEST_PREFIX = 'auth-tokens-integration-test-';
const REAL_NOW = () => new Date();

const cleanup = async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_DOMAIN } } });
  await prisma.otpCode.deleteMany({
    where: { phone: { startsWith: OTP_TEST_PREFIX } },
  });
};

beforeAll(cleanup); // corrida abortada previa

afterEach(() => {
  _setNowProvider(REAL_NOW); // restaura aunque el `it` falle a mitad
});

afterAll(async () => {
  _setNowProvider(REAL_NOW); // cubre un fallo del propio afterEach
  await cleanup();
  await prisma.$disconnect();
});

/** Usuario centinela nuevo, uno por test que necesite aislar su fila. */
async function createSentinelUser(label: string) {
  return createUser({
    name: `Auth Tokens ${label}`,
    email: `${label}${TEST_DOMAIN}`,
    passwordHash: 'hash-de-prueba',
  });
}

describe('createPasswordResetToken / findLivePasswordResetTokens', () => {
  it('invalida el token previo del mismo usuario en llamadas secuenciales', async () => {
    const user = await createSentinelUser('invalidate');
    const first = await createPasswordResetToken({
      userId: user.id,
      tokenHash: 'hash-1',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const second = await createPasswordResetToken({
      userId: user.id,
      tokenHash: 'hash-2',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const live = await findLivePasswordResetTokens(user.id);
    expect(live).toHaveLength(1);
    expect(live[0]?.id).toBe(second.id);
    expect(live[0]?.tokenHash).toBe('hash-2');

    const firstRow = await prisma.passwordResetToken.findUnique({
      where: { id: first.id },
    });
    expect(firstRow?.consumedAt).not.toBeNull();
  });

  it('con dos filas vivas para el mismo usuario, devuelve las 2, la de id mayor primero (V-6)', async () => {
    const user = await createSentinelUser('tie');
    // Insertadas a mano (no vía createPasswordResetToken) para simular el
    // empate de V-6: dos forget-password concurrentes que ninguno ve la
    // fila del otro antes de comprometer su updateMany.
    const rowA = await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token: 'hash-tie-a',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    const rowB = await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token: 'hash-tie-b',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const live = await findLivePasswordResetTokens(user.id);
    expect(live).toHaveLength(2);
    expect(live[0]?.id).toBe(Number(rowB.id));
    expect(live[1]?.id).toBe(Number(rowA.id));
  });

  it('vencimiento: con el reloj adelantado devuelve [], al restaurar vuelve a devolver 1', async () => {
    const user = await createSentinelUser('expiry');
    const ttlMinutes = 10;
    const createdAtReal = new Date();
    _setNowProvider(() => createdAtReal);
    await createPasswordResetToken({
      userId: user.id,
      tokenHash: 'hash-expiry',
      expiresAt: new Date(createdAtReal.getTime() + ttlMinutes * 60 * 1000),
    });

    expect(await findLivePasswordResetTokens(user.id)).toHaveLength(1);

    _setNowProvider(
      () => new Date(createdAtReal.getTime() + (ttlMinutes + 1) * 60 * 1000)
    );
    expect(await findLivePasswordResetTokens(user.id)).toEqual([]);

    _setNowProvider(REAL_NOW);
    expect(await findLivePasswordResetTokens(user.id)).toHaveLength(1);
  });
});

describe('consumePasswordResetToken', () => {
  it('un solo uso: consume -> 1, repetido -> 0; id inexistente -> 0', async () => {
    const user = await createSentinelUser('consume');
    const token = await createPasswordResetToken({
      userId: user.id,
      tokenHash: 'hash-consume',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    expect(await consumePasswordResetToken(token.id)).toBe(1);
    expect(await consumePasswordResetToken(token.id)).toBe(0);
    expect(await consumePasswordResetToken(999999)).toBe(0);
  });
});

describe('createOtpCode / findLiveOtpCodeById / consumeOtpCode', () => {
  it('vivo, vencido y consumido', async () => {
    const phone = `${OTP_TEST_PREFIX}live-expiry-consumed`;
    const createdAtReal = new Date();
    const ttlMinutes = 10;

    _setNowProvider(() => createdAtReal);
    const otp = await createOtpCode({
      phone,
      codeHash: 'hash-otp',
      expiresAt: new Date(createdAtReal.getTime() + ttlMinutes * 60 * 1000),
    });

    const live = await findLiveOtpCodeById(otp.id);
    expect(live).not.toBeNull();
    expect(live?.codeHash).toBe('hash-otp');

    _setNowProvider(
      () => new Date(createdAtReal.getTime() + (ttlMinutes + 1) * 60 * 1000)
    );
    expect(await findLiveOtpCodeById(otp.id)).toBeNull();

    _setNowProvider(() => createdAtReal);
    expect(await consumeOtpCode(otp.id)).toBe(1);
    expect(await findLiveOtpCodeById(otp.id)).toBeNull();
  });
});

describe('findUserIdByProfileContact', () => {
  it("'12365141641631' (único, store_owner@demo.com, id 1) -> 1", async () => {
    expect(await findUserIdByProfileContact('12365141641631')).toBe(1);
  });

  it("'19365141641631' (dos perfiles, ids 3 y 2) -> null", async () => {
    expect(await findUserIdByProfileContact('19365141641631')).toBeNull();
  });

  it("'nadie' (ningún perfil) -> null", async () => {
    expect(await findUserIdByProfileContact('nadie')).toBeNull();
  });
});

describe('purgeExpiredAuthTokens', () => {
  it('borra vencido y consumido, deja vivo (assert por id, nunca por conteo absoluto)', async () => {
    const user = await createSentinelUser('purge');
    const nowInstant = new Date();

    const expired = await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token: 'hash-purge-expired',
        expiresAt: new Date(nowInstant.getTime() - 60 * 1000),
      },
    });
    const consumed = await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token: 'hash-purge-consumed',
        expiresAt: new Date(nowInstant.getTime() + 60 * 60 * 1000),
        consumedAt: nowInstant,
      },
    });
    const live = await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token: 'hash-purge-live',
        expiresAt: new Date(nowInstant.getTime() + 60 * 60 * 1000),
      },
    });

    const otpPhone = `${OTP_TEST_PREFIX}purge`;
    const otpExpired = await prisma.otpCode.create({
      data: {
        phone: otpPhone,
        code: 'hash-otp-expired',
        expiresAt: new Date(nowInstant.getTime() - 60 * 1000),
      },
    });
    const otpLive = await prisma.otpCode.create({
      data: {
        phone: otpPhone,
        code: 'hash-otp-live',
        expiresAt: new Date(nowInstant.getTime() + 60 * 60 * 1000),
      },
    });

    const result = await purgeExpiredAuthTokens();
    expect(result.passwordResetTokens).toBeGreaterThanOrEqual(2);
    expect(result.otpCodes).toBeGreaterThanOrEqual(1);

    expect(
      await prisma.passwordResetToken.findUnique({ where: { id: expired.id } })
    ).toBeNull();
    expect(
      await prisma.passwordResetToken.findUnique({ where: { id: consumed.id } })
    ).toBeNull();
    expect(
      await prisma.passwordResetToken.findUnique({ where: { id: live.id } })
    ).not.toBeNull();

    expect(
      await prisma.otpCode.findUnique({ where: { id: otpExpired.id } })
    ).toBeNull();
    expect(
      await prisma.otpCode.findUnique({ where: { id: otpLive.id } })
    ).not.toBeNull();
  });
});

describe('fuga de tipos', () => {
  it('PasswordResetTokenSecret expone exactamente 5 claves; tokenHash es el valor pasado', async () => {
    const user = await createSentinelUser('shape-token');
    const secret = await createPasswordResetToken({
      userId: user.id,
      tokenHash: 'hash-shape-check',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    expect(Object.keys(secret).sort()).toEqual(
      ['consumedAt', 'expiresAt', 'id', 'tokenHash', 'userId'].sort()
    );
    expect(secret.tokenHash).toBe('hash-shape-check');
  });

  it('OtpCodeSecret expone exactamente 5 claves; codeHash es el valor pasado', async () => {
    const phone = `${OTP_TEST_PREFIX}shape-code`;
    const secret = await createOtpCode({
      phone,
      codeHash: 'hash-otp-shape-check',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    expect(Object.keys(secret).sort()).toEqual(
      ['codeHash', 'consumedAt', 'expiresAt', 'id', 'phone'].sort()
    );
    expect(secret.codeHash).toBe('hash-otp-shape-check');
  });
});
