/**
 * `search=key:value;key:value` → mapa plano de tokens.
 *
 * Trocea igual que el mock (`split(';')`, luego el primer `:`); no "mejora"
 * el parseo. Cada servicio decide qué claves entiende: lo que no reconoce
 * se ignora sin error, igual que hoy. Última repetición de una clave gana,
 * que es lo que hacía el mock de shops/manufacturers (reasignaba `data`
 * dentro del bucle: `shops.service.ts:38-43`, `manufacturers.service.ts:44-49`).
 */
export function parseSearch(search?: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  if (!search) return tokens;
  for (const token of search.split(';')) {
    const [key, value] = token.split(':');
    if (key && value !== undefined) tokens[key] = value;
  }
  return tokens;
}
