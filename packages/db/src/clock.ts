/**
 * Reloj mockeable para los repos de `@safari/db`. `now()` es la fuente única
 * de "ahora" en la capa de data-access.
 *
 * ALCANCE (US-32 CA-3) — qué gobierna `_setNowProvider`:
 *   · `updated_at` de types, tags, manufacturers, products, categories,
 *     shops y users: lo fija cada `update`/`upsert` de repositorio.
 *   · `consumedAt` de password_reset_tokens/otp_codes
 *     (`auth-tokens.repository.ts:171,207`) y `scrapedAt` de products
 *     (`products.repository.ts:351`).
 *   · `profiles` no tiene hoy ruta de `UPDATE`; la PRIMERA que se cree debe
 *     fijar `updatedAt: now()` igual que las demás.
 *
 * Qué NO gobierna: `created_at` de NINGUNA tabla. La resuelve el
 * `@default(now())` de `schema.prisma` (reloj de Node, ligado como parámetro
 * del INSERT); ningún repositorio la fija a mano. No-goal deliberado, no
 * descuido: ambas columnas ya salen del MISMO reloj, así que el invariante
 * `updated_at >= created_at` se cumple sin hacer `created_at` mockeable. Con
 * `_setNowProvider(fija)`, un `create` + `update` devuelve `createdAt` real y
 * `updatedAt` = fija.
 */

let _nowProvider: () => Date = () => new Date();

/** SOLO PARA TESTS — reemplaza el provider de `now()`. */
export function _setNowProvider(provider: () => Date): void {
  _nowProvider = provider;
}

/** Instante actual. Mockeable vía `_setNowProvider`. */
export function now(): Date {
  return _nowProvider();
}
