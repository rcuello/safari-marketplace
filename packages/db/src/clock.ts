/**
 * Reloj mockeable para los repos de `@safari/db`. `now()` es la fuente única
 * de "ahora" en la capa de data-access (p. ej. `scrapedAt` en el upsert del
 * scraper).
 *
 * Mockeable en tests vía `_setNowProvider`.
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
