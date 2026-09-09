/**
 * slug.ts — generación de slug en servidor, genérica por firma (D27-13).
 *
 * Ningún agregado se nombra aquí: `normalizeSlug`/`generateSlug` reciben el
 * texto a normalizar y una función de búsqueda (`ExistingSlugLookup`) que
 * el propio repositorio del agregado construye contra SU tabla. El nombre
 * de tabla nunca llega al SQL — la inyección es imposible por construcción,
 * no por escapado (ver design.md, Decisión 2).
 *
 * La normalización delega en `SELECT slugify($1)` (Decisión 1, Opción B):
 * Postgres ya es la fuente de verdad de esa regla (`db/schema.sql:39-61`) y
 * portarla a TypeScript abriría una segunda fuente de verdad que nadie
 * recordaría sincronizar. El texto viaja como parámetro `$1` del tagged
 * template, nunca concatenado — `$queryRawUnsafe` está prohibido en este
 * paquete (precedente: `users.repository.ts:116`).
 */

import { prisma } from './client';
import { EmptySlugError } from './domain-errors';

/** Forma mínima que `generateSlug` necesita del payload del agregado. */
export interface SlugSource {
  name: string;
  slug?: string | null;
}

/**
 * Trae todos los slugs de la tabla del agregado que empiezan por `prefix`.
 * El call site vive en el repositorio del agregado (p. ej.
 * `types.repository.ts`), nunca aquí — ver Decisión 2 del design.
 */
export type ExistingSlugLookup = (prefix: string) => Promise<string[]>;

/**
 * Normaliza `text` con la misma regla que `slugify()` de Postgres.
 *
 * Guarda de runtime ANTES de cualquier consulta: aunque el tipo diga
 * `string`, el tsconfig de la API (`apps/api/rest/tsconfig.json`) no activa
 * `strict`, así que `undefined`/`null` cruzan la frontera sin que el
 * compilador lo note — sin esta guarda, `SELECT slugify(NULL)` fallaría
 * como error de parámetro de Prisma, no como error de dominio.
 */
export async function normalizeSlug(
  text: string,
  aggregate: string
): Promise<string> {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new EmptySlugError(aggregate, text);
  }

  const rows = await prisma.$queryRaw<{ slugify: string }[]>`
    SELECT slugify(${text})
  `;
  const slug = rows[0]?.slugify ?? '';
  if (slug === '') {
    throw new EmptySlugError(aggregate, text);
  }
  return slug;
}

/**
 * Resuelve el slug de un recurso nuevo: prioridad al `slug` explícito del
 * cliente si llega no vacío, si no se deriva de `name`; luego resuelve
 * colisión con un sufijo numérico incremental (`-2`, `-3`, …).
 *
 * Una sola consulta contra la tabla del agregado (`findExistingWithPrefix`)
 * trae todos los slugs con el prefijo calculado; el primer hueco se busca
 * en memoria, acotado por `taken.size + 2` — nunca un bucle de queries.
 * Dos `POST` concurrentes con el mismo nombre pueden calcular el mismo
 * candidato: el diseño tolera esa carrera y la traduce a `SlugConflict`
 * (409) en el `catch` del repositorio, no la previene aquí.
 */
export async function generateSlug(
  source: SlugSource,
  findExistingWithPrefix: ExistingSlugLookup,
  aggregate: string
): Promise<string> {
  const explicitSlug =
    typeof source.slug === 'string' && source.slug.trim() !== ''
      ? source.slug
      : undefined;
  const base = await normalizeSlug(explicitSlug ?? source.name, aggregate);

  const existing = await findExistingWithPrefix(base);
  const taken = new Set(existing);
  if (!taken.has(base)) return base;

  const maxAttempt = taken.size + 2;
  for (let suffix = 2; suffix <= maxAttempt; suffix++) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  // Inalcanzable en la práctica (pigeonhole: entre `base` y `base-(taken.size+1)`
  // hay taken.size + 1 candidatos para taken.size slugs ocupados). Si algún día
  // se alcanza, el repositorio lo verá como P2002 y lo traducirá a SlugConflict.
  return `${base}-${maxAttempt + 1}`;
}
