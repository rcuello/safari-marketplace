/**
 * domain-errors.ts — el contrato dominio → HTTP de las escrituras de
 * catálogo, como un conjunto cerrado de 5 códigos (spec
 * `catalog-write-foundations`). Genérico por construcción (D27-13): ninguna
 * clase lleva texto de un agregado en particular — `aggregate`/`field`/`id`
 * son parámetros de constructor, no literales. Integrar `tags`/`manufacturers`
 * (US-27b) o cualquier otro agregado MUST limitarse a un call site nuevo en
 * SU repositorio; `git diff` de este archivo MUST quedar vacío (CA-7).
 *
 * `src/errors.ts` (242 líneas de helpers de Prisma consumidos por 8 archivos)
 * NO se toca — D27-3. `isPrismaConstraintError` agrupa P2002/P2003/P2025 en
 * un solo booleano y no puede discriminarlos, así que este archivo trae su
 * propio traductor, `translateCatalogWriteError`, que sí discrimina.
 */

export const CATALOG_ERROR_CODES = {
  EmptySlug: 'CATALOG_EMPTY_SLUG',
  InvalidReference: 'CATALOG_INVALID_REFERENCE',
  RecordNotFound: 'CATALOG_RECORD_NOT_FOUND',
  DependentRows: 'CATALOG_DEPENDENT_ROWS',
  SlugConflict: 'CATALOG_SLUG_CONFLICT',
} as const;

export type CatalogErrorCode =
  (typeof CATALOG_ERROR_CODES)[keyof typeof CATALOG_ERROR_CODES];

const CATALOG_ERROR_CODE_VALUES: readonly string[] =
  Object.values(CATALOG_ERROR_CODES);

export abstract class CatalogWriteError extends Error {
  abstract readonly code: CatalogErrorCode;
  readonly aggregate: string;

  constructor(message: string, aggregate: string) {
    super(message);
    this.aggregate = aggregate;
  }
}

/** El `name` (o `slug` explícito) normaliza a una cadena vacía. */
export class EmptySlugError extends CatalogWriteError {
  readonly code = CATALOG_ERROR_CODES.EmptySlug;
  constructor(aggregate: string, source: string) {
    super(
      `El texto \`${source}\` de \`${aggregate}\` normaliza a un slug vacío.`,
      aggregate
    );
    this.name = 'EmptySlugError';
  }
}

/** Una referencia a otro agregado no existe (FK saliente, P2003). */
export class InvalidReferenceError extends CatalogWriteError {
  readonly code = CATALOG_ERROR_CODES.InvalidReference;
  constructor(
    aggregate: string,
    field: string,
    value?: string | number | null
  ) {
    super(
      value != null
        ? `\`${aggregate}.${field}\` referencia un registro inexistente (\`${value}\`).`
        : `\`${aggregate}.${field}\` referencia un registro inexistente.`,
      aggregate
    );
    this.name = 'InvalidReferenceError';
  }
}

/** El registro que se quiere actualizar/borrar no existe (P2025). */
export class RecordNotFoundError extends CatalogWriteError {
  readonly code = CATALOG_ERROR_CODES.RecordNotFound;
  constructor(aggregate: string, id: number | string) {
    super(`No existe un registro de \`${aggregate}\` con id ${id}.`, aggregate);
    this.name = 'RecordNotFoundError';
  }
}

/** El borrado dejaría filas huérfanas en tablas dependientes. */
export class DependentRowsError extends CatalogWriteError {
  readonly code = CATALOG_ERROR_CODES.DependentRows;
  constructor(aggregate: string, counts: Record<string, number>) {
    const detail = Object.entries(counts)
      .map(([table, count]) => `${count} ${table}`)
      .join(', ');
    super(
      `No se puede borrar este registro de \`${aggregate}\`: tiene filas dependientes (${detail}).`,
      aggregate
    );
    this.name = 'DependentRowsError';
  }
}

/** El slug calculado ya existe (P2002 — solo alcanzable por carrera). */
export class SlugConflictError extends CatalogWriteError {
  readonly code = CATALOG_ERROR_CODES.SlugConflict;
  constructor(aggregate: string, slug: string) {
    super(
      `Ya existe un registro de \`${aggregate}\` con el slug \`${slug}\`.`,
      aggregate
    );
    this.name = 'SlugConflictError';
  }
}

/**
 * Guard ESTRUCTURAL por `code`, no `instanceof`: el paquete se consume por
 * `link:` contra `dist/`, y un mock del barrel (o dos copias del build) puede
 * producir identidades de clase distintas para lo que semánticamente es el
 * mismo error. Comparar por `code` sobrevive a eso.
 */
export function isCatalogWriteError(error: unknown): error is CatalogWriteError {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && CATALOG_ERROR_CODE_VALUES.includes(code);
}

interface PrismaLikeError {
  code?: string;
  meta?: Record<string, unknown>;
}

function _asPrismaLikeError(error: unknown): PrismaLikeError | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  return error as PrismaLikeError;
}

/**
 * Único lugar que conoce códigos de Prisma para las escrituras de catálogo
 * (Decisión 3 del design). `P2002` → `SlugConflictError`, `P2003` →
 * `InvalidReferenceError`, `P2025` → `RecordNotFoundError`. Cualquier otra
 * cosa vuelve intacta — mismo contrato que `_translateCheckViolation`
 * (`products.repository.ts:454-466`): el llamador es quien lanza.
 */
export function translateCatalogWriteError(
  error: unknown,
  context: { aggregate: string; id?: number | string; uniqueField?: string }
): unknown {
  const prismaError = _asPrismaLikeError(error);
  if (!prismaError) return error;

  if (prismaError.code === 'P2002') {
    const target = prismaError.meta?.target;
    const field = Array.isArray(target)
      ? target.join(', ')
      : (context.uniqueField ?? 'slug');
    return new SlugConflictError(context.aggregate, field);
  }

  if (prismaError.code === 'P2003') {
    const field =
      (prismaError.meta?.field_name as string | undefined) ??
      context.uniqueField ??
      'desconocida';
    return new InvalidReferenceError(context.aggregate, field);
  }

  if (prismaError.code === 'P2025') {
    return new RecordNotFoundError(context.aggregate, context.id ?? 'desconocido');
  }

  return error;
}
