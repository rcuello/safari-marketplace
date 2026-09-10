/**
 * domain-error.mapper.ts — el único punto donde la API traduce un error de
 * dominio de catálogo (`packages/db/src/domain-errors.ts`) a un
 * `HttpException`. Genérico por construcción (D27-13, spec
 * `catalog-write-foundations`): integrar un agregado nuevo (`tags`,
 * `manufacturers`, `categories`, `products`, `shops`) MUST limitarse a un
 * `catch (error) { throw toWriteHttpException(error); }` en SU servicio;
 * `git diff` de este archivo MUST quedar vacío (CA-7). Nunca
 * `if (aggregate === …)` aquí.
 */

import {
  BadRequestException,
  ConflictException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CATALOG_ERROR_CODES,
  getUserFriendlyMessage,
  isCatalogWriteError,
} from '@safari/db';

/**
 * Mensaje literal y fijo del 500 — NUNCA `getUserFriendlyMessage` aquí (ver
 * `toWriteHttpException`). Mismo texto que la rama `default` de
 * `getUserFriendlyMessage` (`packages/db/src/errors.ts:240`), pero escrito
 * como literal para no depender de ese helper en la rama que precisamente
 * lo evita.
 */
const UNEXPECTED_ERROR_MESSAGE =
  'Ocurrió un error inesperado. Por favor, contacta al administrador.';

/**
 * Códigos que sí ameritan 503. Dos familias:
 *
 * 1. Códigos de conexión/arranque de Prisma (`P1xxx`, `P2024`).
 * 2. Códigos de socket del driver (`ECONNREFUSED`, …). Con Prisma 7 +
 *    `@prisma/adapter-pg`, una base caída NO llega como `P1001`: llega como
 *    `{ name: 'PrismaClientKnownRequestError', code: 'ECONNREFUSED',
 *    message: 'Invalid `prisma.$queryRaw()` invocation:' }`. El código del
 *    driver viaja en `code`, y el `message` no contiene ninguno de los
 *    patrones de abajo, así que sin esta segunda familia la rama 503 queda
 *    MUERTA y un fallo de conexión cae al 500 literal. Hallazgo C-1 de
 *    `sdd-verify`, observado apagando el contenedor de verdad — no inferido.
 *
 * Deliberadamente NO incluye `PrismaClientKnownRequestError` por `name`: ese
 * es el defecto B1 que este mapeador evita, y es lo que mantiene P2011 (y
 * cualquier otro error de escritura no traducido) en el 500.
 */
const CONNECTION_FAILURE_CODES: ReadonlySet<string> = new Set([
  'P1001',
  'P1002',
  'P1008',
  'P1011',
  'P1017',
  'P2024',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
]);

const CONNECTION_FAILURE_MESSAGE_PATTERNS: readonly string[] = [
  "can't reach database server",
  'connection refused',
  'connection timeout',
  'econnrefused',
];

/**
 * Tabla cerrada `code → status` de los 5 códigos de catálogo (spec
 * `catalog-write-foundations`): `EmptySlug`/`InvalidReference` → 400,
 * `RecordNotFound` → 404, `DependentRows`/`SlugConflict` → 409. `null` si
 * `error` no es un `CatalogWriteError` (guard estructural por `code`, no
 * `instanceof` — sobrevive a mocks del barrel y builds duplicados).
 */
export function mapDomainError(error: unknown): HttpException | null {
  if (!isCatalogWriteError(error)) return null;

  switch (error.code) {
    case CATALOG_ERROR_CODES.EmptySlug:
    case CATALOG_ERROR_CODES.InvalidReference:
      return new BadRequestException(error.message);
    case CATALOG_ERROR_CODES.RecordNotFound:
      return new NotFoundException(error.message);
    case CATALOG_ERROR_CODES.DependentRows:
    case CATALOG_ERROR_CODES.SlugConflict:
      return new ConflictException(error.message);
    default:
      // Inalcanzable mientras `CATALOG_ERROR_CODES` tenga exactamente estos
      // 5 valores — el guard `isCatalogWriteError` ya lo garantiza.
      return null;
  }
}

/**
 * Predicado LOCAL y PRIVADO de este mapeador — corrección de B1 del gate.
 * `isPrismaConnectionError` (`packages/db/src/errors.ts:54-68`) devuelve
 * `true` para CUALQUIER `PrismaClientKnownRequestError`, lo que incluye
 * P2002/P2003/P2011/P2025: reusarlo aquí etiquetaría un `NOT NULL` violado
 * (P2011) como "no se puede conectar a la base de datos". Este predicado
 * NUNCA mira `PrismaClientKnownRequestError` por nombre.
 */
function isConnectionFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const name = (error as { name?: unknown }).name;
  if (name === 'PrismaClientInitializationError') return true;

  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && CONNECTION_FAILURE_CODES.has(code)) {
    return true;
  }

  const message = (error as { message?: unknown }).message;
  if (typeof message === 'string') {
    const lowerMessage = message.toLowerCase();
    return CONNECTION_FAILURE_MESSAGE_PATTERNS.some((pattern) =>
      lowerMessage.includes(pattern),
    );
  }

  return false;
}

/**
 * Punto único de traducción de las escrituras de catálogo — una línea
 * idéntica en los cinco agregados: `catch (error) { throw
 * toWriteHttpException(error); }`. Orden de la cadena (design.md, Decisión
 * 3, corrección B1):
 *
 * 1. `mapDomainError` — conjunto cerrado por `code` → 400/404/409.
 * 2. `isConnectionFailure` — 503 con `getUserFriendlyMessage` (que ahí sí
 *    clasifica bien, porque el error YA se confirmó de conexión).
 * 3. Cualquier otra cosa, P2002/P2011 de Prisma incluidos → 500 con el
 *    mensaje LITERAL fijo. NUNCA `getUserFriendlyMessage` en esta rama: esa
 *    función pasa por `parsePrismaError` → `isPrismaConnectionError`
 *    (`errors.ts:132`), que para un P2011 devolvería "No se puede conectar a
 *    la base de datos en localhost:5432" — el mismo defecto que este
 *    mapeador existe para esquivar.
 */
export function toWriteHttpException(error: unknown): HttpException {
  const domainException = mapDomainError(error);
  if (domainException) return domainException;

  if (isConnectionFailure(error)) {
    return new ServiceUnavailableException(getUserFriendlyMessage(error));
  }

  return new InternalServerErrorException(UNEXPECTED_ERROR_MESSAGE);
}
