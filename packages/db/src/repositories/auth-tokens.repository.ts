/**
 * auth-tokens.repository.ts — recuperación de contraseña y OTP (Épico 19,
 * US-24). Ocho funciones planas sobre `password_reset_tokens` y
 * `otp_codes`; ninguna de las dos tablas tiene FK hacia la otra
 * (`otp_codes` tampoco la tiene hacia `users`).
 *
 * Frontera D-2 del épico, mismo criterio que `UserCredentials`
 * (`users.repository.ts:9-11,32-38`): `PasswordResetTokenSecret` y
 * `OtpCodeSecret` llevan el hash (`tokenHash`/`codeHash`) y viven AQUÍ, no
 * en `records.ts`. El valor en claro nunca entra a este paquete: el
 * caller (`auth.service.ts`, PR#2) genera el secreto, lo hashea con la
 * librería de hashing de la capa Nest y solo pasa el hash ya calculado.
 * Este archivo no importa ningún módulo de hashing — `packages/db` no
 * gana dependencias nuevas (`package.json` sigue con las mismas 4).
 *
 * V-4 (design.md): este archivo estrena `$transaction` en el paquete —
 * `createPasswordResetToken` invalida el token vivo previo del usuario y
 * crea el nuevo en la misma transacción, como ARRAY (no nested write: el
 * orden relativo `updateMany`/`create` en un nested write no está
 * documentado, y una propiedad de seguridad no puede apostar a eso).
 *
 * `consumePasswordResetToken`/`consumeOtpCode` usan `updateMany` con un
 * `WHERE id = ? AND consumed_at IS NULL` condicional y devuelven el
 * `count` de `Prisma.BatchPayload` — nunca `update()`, que señaliza "ya
 * consumido" lanzando P2025 en vez de reportar 0 filas afectadas
 * (Decisión C, design.md). El `count` es lo que garantiza que, ante dos
 * peticiones concurrentes con el mismo token/código, como máximo una
 * gane la carrera.
 */

import { prisma } from '../client';
import { now } from '../clock';
import { _id } from '../records';

// ---------------------------------------------------------------------------
// Tipos — NO en records.ts (ver cabecera del archivo)
// ---------------------------------------------------------------------------

/** La ÚNICA forma que lleva el hash del token de recuperación fuera de la base. */
export interface PasswordResetTokenSecret {
  id: number;
  userId: number;
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

/** La ÚNICA forma que lleva el hash del código OTP fuera de la base. */
export interface OtpCodeSecret {
  id: number;
  phone: string;
  codeHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface CreatePasswordResetTokenInput {
  userId: number;
  /** Ya hasheado — hashear es responsabilidad de la API (US-24, PR#2). */
  tokenHash: string;
  expiresAt: Date;
}

export interface CreateOtpCodeInput {
  phone: string;
  /** Ya hasheado — hashear es responsabilidad de la API (US-24, PR#2). */
  codeHash: string;
  expiresAt: Date;
}

// ---------------------------------------------------------------------------
// Mappers internos — fila cruda de Prisma (columna `token`/`code`) -> secret
// ---------------------------------------------------------------------------

interface PasswordResetTokenRow {
  id: bigint;
  userId: bigint;
  token: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

function _toPasswordResetTokenSecret(
  row: PasswordResetTokenRow
): PasswordResetTokenSecret {
  return {
    id: _id(row.id),
    userId: _id(row.userId),
    tokenHash: row.token,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
  };
}

interface OtpCodeRow {
  id: bigint;
  phone: string;
  code: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

function _toOtpCodeSecret(row: OtpCodeRow): OtpCodeSecret {
  return {
    id: _id(row.id),
    phone: row.phone,
    codeHash: row.code,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
  };
}

// ---------------------------------------------------------------------------
// password_reset_tokens
// ---------------------------------------------------------------------------

/**
 * Invalida (`consumed_at = now()`) los tokens vivos previos del usuario y
 * crea el nuevo, en una sola transacción (array — Decisión C). Bajo READ
 * COMMITTED esto atomiza UNA petición, no serializa dos concurrentes del
 * mismo usuario: ver V-6 en design.md. El consumidor está escrito para
 * `N >= 0` filas vivas (`findLivePasswordResetTokens`), no para "a lo
 * sumo una".
 */
export async function createPasswordResetToken(
  input: CreatePasswordResetTokenInput
): Promise<PasswordResetTokenSecret> {
  const nowInstant = now();
  const [, created] = await prisma.$transaction([
    prisma.passwordResetToken.updateMany({
      where: { userId: input.userId, consumedAt: null },
      data: { consumedAt: nowInstant },
    }),
    prisma.passwordResetToken.create({
      data: {
        userId: input.userId,
        token: input.tokenHash,
        expiresAt: input.expiresAt,
      },
    }),
  ]);
  return _toPasswordResetTokenSecret(created);
}

/**
 * Filas vivas y no vencidas del usuario, de la más nueva a la más vieja
 * (`orderBy: {id: 'desc'}`). Devuelve `N >= 0`: el caller (Decisión D,
 * `auth.service.ts`) recorre con `for…of` y corta en la primera
 * coincidencia de comparación de hash.
 */
export async function findLivePasswordResetTokens(
  userId: number
): Promise<PasswordResetTokenSecret[]> {
  const rows = await prisma.passwordResetToken.findMany({
    where: { userId, consumedAt: null, expiresAt: { gt: now() } },
    orderBy: { id: 'desc' },
  });
  return rows.map(_toPasswordResetTokenSecret);
}

/**
 * Consume el token con un UPDATE condicional (`WHERE id = ? AND
 * consumed_at IS NULL`). Devuelve las filas afectadas: `1` si consumió,
 * `0` si ya estaba consumido, vencido (el vencimiento no forma parte del
 * WHERE a propósito: un token vencido también debe poder "consumirse
 * como fallido" sin lanzar) o el id no existe.
 */
export async function consumePasswordResetToken(id: number): Promise<number> {
  const { count } = await prisma.passwordResetToken.updateMany({
    where: { id, consumedAt: null },
    data: { consumedAt: now() },
  });
  return count;
}

// ---------------------------------------------------------------------------
// otp_codes
// ---------------------------------------------------------------------------

export async function createOtpCode(
  input: CreateOtpCodeInput
): Promise<OtpCodeSecret> {
  const row = await prisma.otpCode.create({
    data: {
      phone: input.phone,
      code: input.codeHash,
      expiresAt: input.expiresAt,
    },
  });
  return _toOtpCodeSecret(row);
}

/** El código vivo (no vencido, no consumido) con ese id, o `null`. */
export async function findLiveOtpCodeById(
  id: number
): Promise<OtpCodeSecret | null> {
  const row = await prisma.otpCode.findFirst({
    where: { id, consumedAt: null, expiresAt: { gt: now() } },
  });
  return row ? _toOtpCodeSecret(row) : null;
}

/** Mismo patrón `updateMany`/`count` que `consumePasswordResetToken`. */
export async function consumeOtpCode(id: number): Promise<number> {
  const { count } = await prisma.otpCode.updateMany({
    where: { id, consumedAt: null },
    data: { consumedAt: now() },
  });
  return count;
}

// ---------------------------------------------------------------------------
// Purga — mantenimiento manual, sin scheduler (fuera de alcance de US-24)
// ---------------------------------------------------------------------------

/**
 * Elimina las filas vencidas o consumidas de las dos tablas. No afecta
 * filas vivas. Sin scheduler: se invoca a mano (ver `apps/README.md`,
 * PR#2).
 */
export async function purgeExpiredAuthTokens(): Promise<{
  passwordResetTokens: number;
  otpCodes: number;
}> {
  const nowInstant = now();
  const [passwordResetTokens, otpCodes] = await Promise.all([
    prisma.passwordResetToken.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: nowInstant } }, { consumedAt: { not: null } }],
      },
    }),
    prisma.otpCode.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: nowInstant } }, { consumedAt: { not: null } }],
      },
    }),
  ]);
  return {
    passwordResetTokens: passwordResetTokens.count,
    otpCodes: otpCodes.count,
  };
}

// ---------------------------------------------------------------------------
// Resolución de identidad por contacto (otp-login, D2)
// ---------------------------------------------------------------------------

/**
 * Resuelve el `userId` cuyo `profiles.contact` coincide EXACTAMENTE con
 * `contact`. `take: 2` responde "¿exactamente uno?" sin escanear el
 * resto de la tabla (`profiles.contact` no tiene índice — crearlo
 * tocaría `db/schema.sql`, fuera de alcance). `null` si no hay ninguno o
 * si hay más de uno (teléfono ambiguo, `otp-login` MUST fallar).
 */
export async function findUserIdByProfileContact(
  contact: string
): Promise<number | null> {
  const rows = await prisma.profile.findMany({
    where: { contact },
    select: { userId: true },
    take: 2,
  });
  if (rows.length !== 1) return null;
  return _id(rows[0].userId);
}
