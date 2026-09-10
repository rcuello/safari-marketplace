/**
 * tags.repository.ts — etiquetas de productos.
 *
 * Las escrituras (`createTag`/`updateTag`/`deleteTag`) replican el patrón de
 * `types.repository.ts:58-182` (design.md, US-27b) con dos diferencias reales:
 * `type_id` es una FK saliente de verdad (`db/schema.sql:302`, `ON DELETE
 * SET NULL`), así que `InvalidReferenceError` sí es alcanzable por HTTP; y
 * `deleteTag` NO cuenta dependientes — `product_tag.tag_id` es `ON DELETE
 * CASCADE` hacia `tags` (`:433`), Postgres se lleva las filas pivote solas.
 * Único error de borrado: `RecordNotFoundError` (precedente
 * `deleteScrapedProduct`, `products.repository.ts:400-413`).
 */

import type { Prisma } from '../../generated/prisma/client/client';
import { prisma } from '../client';
import { now } from '../clock';
import {
  InvalidReferenceError,
  RecordNotFoundError,
  translateCatalogWriteError,
} from '../domain-errors';
import { generateSlug, normalizeSlug, type ExistingSlugLookup } from '../slug';
import { _toTagRecord, type TagRecord } from '../records';

export interface ListTagsInput {
  typeSlug?: string;
  /** Búsqueda parcial por nombre, case-insensitive. */
  name?: string;
  /** 1-based. Default 1. */
  page?: number;
  /** Default 30, como el mock. */
  limit?: number;
}

/**
 * Listado paginado. `{ items, total }` para `buildPaginator`.
 *
 * `orderBy: { id: 'desc' }` preserva el orden del mock (`62,61,...,53`) —
 * Decisión D en design.md: los tags scrapeados quedan al frente.
 */
export async function listTags(input: ListTagsInput = {}): Promise<{
  items: TagRecord[];
  total: number;
}> {
  const page = Math.max(1, input.page ?? 1);
  const limit = input.limit ?? 30;
  const where: Prisma.TagWhereInput = {
    ...(input.typeSlug && { type: { slug: input.typeSlug } }),
    ...(input.name && { name: { contains: input.name, mode: 'insensitive' as const } }),
  };

  const [rows, total] = await Promise.all([
    prisma.tag.findMany({
      where,
      orderBy: { id: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.tag.count({ where }),
  ]);

  return { items: rows.map(_toTagRecord), total };
}

/** Un tag por slug. `null` si no existe. */
export async function findTagBySlug(slug: string): Promise<TagRecord | null> {
  const row = await prisma.tag.findUnique({ where: { slug } });
  return row ? _toTagRecord(row) : null;
}

// ---------------------------------------------------------------------------
// Escritura (admin) — CA-1, CA-2, CA-3
// ---------------------------------------------------------------------------

/**
 * Call site de `ExistingSlugLookup` (design.md, DD-1): la tabla nunca llega
 * al SQL compartido, `generateSlug` solo recibe esta función.
 */
const tagSlugs: ExistingSlugLookup = async (prefix) =>
  (
    await prisma.tag.findMany({
      where: { slug: { startsWith: prefix } },
      select: { slug: true },
    })
  ).map((r) => r.slug);

export interface CreateTagInput {
  name: string;
  /** Si llega no vacío, es la fuente del slug; si no, se deriva de `name`. */
  slug?: string | null;
  details?: string | null;
  icon?: string | null;
  /** `jsonb` nullable; sin `| null` — `image: null` se trata como ausente (DD-5). */
  image?: Prisma.InputJsonValue;
  /** FK a `types`; `null` limpia la referencia. */
  typeId?: number | null;
  /** Ausente ⇒ `DEFAULT 'es'`. */
  language?: string;
}

/**
 * `Partial<>` de todo salvo `slug` (inmutable en update, DD-1): TODO campo
 * del update es opcional, y una clave ausente del input MUST NOT llegar al
 * `data` de Prisma (B-4) — el spread condicional de abajo es el mecanismo.
 */
export type UpdateTagInput = Partial<Omit<CreateTagInput, 'slug'>>;

/**
 * Guarda de dominio compartida por `createTag`/`updateTag` (DD-2): un
 * `type_id` mal formado (`"abc"`, `NaN`, no entero) da 400 con el campo
 * correcto SIN tocar Postgres. `null` es legal (limpia la FK); `undefined`
 * ni siquiera llega aquí porque el spread condicional lo filtra antes.
 */
function _assertValidTypeId(typeId: number | null | undefined): void {
  if (typeId != null && !Number.isInteger(typeId)) {
    throw new InvalidReferenceError('tags', 'type_id', typeId);
  }
}

/** Crea un tag. El slug lo calcula `generateSlug` (precedente `createType`). */
export async function createTag(input: CreateTagInput): Promise<TagRecord> {
  _assertValidTypeId(input.typeId);

  const slug = await generateSlug(
    { name: input.name, slug: input.slug },
    tagSlugs,
    'tags'
  );

  try {
    const row = await prisma.tag.create({
      data: {
        name: input.name,
        slug,
        ...(input.details !== undefined && { details: input.details }),
        ...(input.icon !== undefined && { icon: input.icon }),
        ...(input.image != null && { image: input.image }),
        ...(input.typeId !== undefined && { typeId: input.typeId }),
        ...(input.language !== undefined && { language: input.language }),
      },
    });
    return _toTagRecord(row);
  } catch (error) {
    throw translateCatalogWriteError(error, {
      aggregate: 'tags',
    });
  }
}

/**
 * Actualiza un tag. El `slug` NUNCA se toca (precedente
 * `products.repository.ts:382`). Cuando `input.name` llega, se valida con
 * `normalizeSlug` y se descarta el resultado — solo por su efecto lateral
 * `EmptySlugError` (precedente `updateType`, `types.repository.ts:110-125`):
 * `tags.name` es `text NOT NULL` donde `''` es legal para Postgres, así que
 * sin esta guarda la fila quedaría silenciosamente corrupta. `updatedAt: now()`
 * se fija explícito — `tags` no tiene trigger `updated_at` (`db/schema.sql:480-500`).
 */
export async function updateTag(
  id: number,
  input: UpdateTagInput
): Promise<TagRecord> {
  if (input.name !== undefined) {
    await normalizeSlug(input.name, 'tags');
  }
  _assertValidTypeId(input.typeId);

  try {
    const row = await prisma.tag.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.details !== undefined && { details: input.details }),
        ...(input.icon !== undefined && { icon: input.icon }),
        ...(input.image != null && { image: input.image }),
        ...(input.typeId !== undefined && { typeId: input.typeId }),
        ...(input.language !== undefined && { language: input.language }),
        updatedAt: now(),
      },
    });
    return _toTagRecord(row);
  } catch (error) {
    throw translateCatalogWriteError(error, {
      aggregate: 'tags',
      id,
    });
  }
}

/**
 * Borra un tag. A diferencia de `deleteType` (R-1, cuenta dependientes),
 * `product_tag.tag_id` es `ON DELETE CASCADE` hacia `tags`
 * (`db/schema.sql:433`): Postgres se lleva las filas pivote solas, el
 * repositorio NO las toca. No hay 409 en ninguna ruta de esta US (D27b-3).
 * `find-then-delete`, precedente `deleteScrapedProduct`
 * (`products.repository.ts:400-413`).
 */
export async function deleteTag(id: number): Promise<TagRecord> {
  const existing = await prisma.tag.findUnique({ where: { id } });
  if (!existing) {
    throw new RecordNotFoundError('tags', id);
  }

  try {
    await prisma.tag.delete({ where: { id } });
    return _toTagRecord(existing);
  } catch (error) {
    throw translateCatalogWriteError(error, {
      aggregate: 'tags',
      id,
    });
  }
}
