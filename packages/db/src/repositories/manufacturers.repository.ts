/**
 * manufacturers.repository.ts — marcas. Destino natural del campo `marca`
 * del scraper, que las crea en runtime vía `findOrCreateManufacturerBySlug`.
 *
 * Las escrituras (`createManufacturer`/`updateManufacturer`/
 * `deleteManufacturer`) replican el patrón de `tags.repository.ts`
 * (design.md, US-27b) con las mismas dos diferencias reales frente a
 * `types`: `type_id` es una FK saliente de verdad (`db/schema.sql:288`,
 * `ON DELETE SET NULL`), así que `InvalidReferenceError` es alcanzable por
 * HTTP; y `deleteManufacturer` NO cuenta dependientes —
 * `products.manufacturer_id` es `ON DELETE SET NULL` (`:333`), Postgres
 * desenlaza los productos solos, ninguno se borra. Único error de borrado:
 * `RecordNotFoundError` (precedente `deleteScrapedProduct`,
 * `products.repository.ts:400-413`). `findOrCreateManufacturerBySlug` NO se
 * toca.
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
import { _toManufacturerRecord, type ManufacturerRecord } from '../records';

export interface ListManufacturersInput {
  typeSlug?: string;
  /** Búsqueda parcial por nombre, case-insensitive. */
  name?: string;
  /** 1-based. Default 1. */
  page?: number;
  /** Default 30, como el mock. */
  limit?: number;
}

/** Listado paginado. `{ items, total }` para `buildPaginator`. */
export async function listManufacturers(
  input: ListManufacturersInput = {}
): Promise<{ items: ManufacturerRecord[]; total: number }> {
  const page = Math.max(1, input.page ?? 1);
  const limit = input.limit ?? 30;
  const where: Prisma.ManufacturerWhereInput = {
    ...(input.typeSlug && { type: { slug: input.typeSlug } }),
    ...(input.name && { name: { contains: input.name, mode: 'insensitive' as const } }),
  };

  const [rows, total] = await Promise.all([
    prisma.manufacturer.findMany({
      where,
      orderBy: { id: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.manufacturer.count({ where }),
  ]);

  return { items: rows.map(_toManufacturerRecord), total };
}

/** Una marca por slug. `null` si no existe. */
export async function findManufacturerBySlug(
  slug: string
): Promise<ManufacturerRecord | null> {
  const row = await prisma.manufacturer.findUnique({ where: { slug } });
  return row ? _toManufacturerRecord(row) : null;
}

/**
 * Para el scraper: devuelve la marca, creándola si no existe.
 * Idempotente por slug.
 */
export async function findOrCreateManufacturerBySlug(input: {
  slug: string;
  name: string;
  typeId?: number | null;
}): Promise<ManufacturerRecord> {
  const row = await prisma.manufacturer.upsert({
    where: { slug: input.slug },
    create: {
      slug: input.slug,
      name: input.name,
      typeId: input.typeId ?? null,
    },
    update: {},
  });
  return _toManufacturerRecord(row);
}

// ---------------------------------------------------------------------------
// Escritura (admin) — CA-1, CA-2, CA-3
// ---------------------------------------------------------------------------

/**
 * Call site de `ExistingSlugLookup` (design.md, DD-1): la tabla nunca llega
 * al SQL compartido, `generateSlug` solo recibe esta función.
 */
const manufacturerSlugs: ExistingSlugLookup = async (prefix) =>
  (
    await prisma.manufacturer.findMany({
      where: { slug: { startsWith: prefix } },
      select: { slug: true },
    })
  ).map((r) => r.slug);

export interface CreateManufacturerInput {
  name: string;
  /** Si llega no vacío, es la fuente del slug; si no, se deriva de `name`. */
  slug?: string | null;
  description?: string | null;
  website?: string | null;
  /** `jsonb` nullable; sin `| null` — `image: null` se trata como ausente (DD-5). */
  image?: Prisma.InputJsonValue;
  /** FK a `types`; `null` limpia la referencia. */
  typeId?: number | null;
  /** Ausente ⇒ `DEFAULT true`. */
  isApproved?: boolean;
}

/**
 * `Partial<>` de todo salvo `slug` (inmutable en update, DD-1): TODO campo
 * del update es opcional, y una clave ausente del input MUST NOT llegar al
 * `data` de Prisma (B-4) — el spread condicional de abajo es el mecanismo.
 */
export type UpdateManufacturerInput = Partial<
  Omit<CreateManufacturerInput, 'slug'>
>;

/**
 * Guarda de dominio compartida por `createManufacturer`/`updateManufacturer`
 * (DD-2): un `type_id` mal formado (`"abc"`, `NaN`, no entero) da 400 con el
 * campo correcto SIN tocar Postgres. `null` es legal (limpia la FK);
 * `undefined` ni siquiera llega aquí porque el spread condicional lo filtra
 * antes.
 */
function _assertValidTypeId(typeId: number | null | undefined): void {
  if (typeId != null && !Number.isInteger(typeId)) {
    throw new InvalidReferenceError('manufacturers', 'type_id', typeId);
  }
}

/** Crea una marca. El slug lo calcula `generateSlug` (precedente `createType`). */
export async function createManufacturer(
  input: CreateManufacturerInput
): Promise<ManufacturerRecord> {
  _assertValidTypeId(input.typeId);

  const slug = await generateSlug(
    { name: input.name, slug: input.slug },
    manufacturerSlugs,
    'manufacturers'
  );

  try {
    const row = await prisma.manufacturer.create({
      data: {
        name: input.name,
        slug,
        ...(input.description !== undefined && { description: input.description }),
        ...(input.website !== undefined && { website: input.website }),
        ...(input.image != null && { image: input.image }),
        ...(input.typeId !== undefined && { typeId: input.typeId }),
        ...(input.isApproved !== undefined && { isApproved: input.isApproved }),
      },
    });
    return _toManufacturerRecord(row);
  } catch (error) {
    throw translateCatalogWriteError(error, {
      aggregate: 'manufacturers',
    });
  }
}

/**
 * Actualiza una marca. El `slug` NUNCA se toca (precedente
 * `products.repository.ts:382`). Cuando `input.name` llega, se valida con
 * `normalizeSlug` y se descarta el resultado — solo por su efecto lateral
 * `EmptySlugError` (precedente `updateType`, `types.repository.ts:110-125`):
 * `manufacturers.name` es `text NOT NULL` donde `''` es legal para Postgres,
 * así que sin esta guarda la fila quedaría silenciosamente corrupta.
 * `updatedAt: now()` se fija explícito — `manufacturers` no tiene trigger
 * `updated_at` (`db/schema.sql:480-500`).
 */
export async function updateManufacturer(
  id: number,
  input: UpdateManufacturerInput
): Promise<ManufacturerRecord> {
  if (input.name !== undefined) {
    await normalizeSlug(input.name, 'manufacturers');
  }
  _assertValidTypeId(input.typeId);

  try {
    const row = await prisma.manufacturer.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.website !== undefined && { website: input.website }),
        ...(input.image != null && { image: input.image }),
        ...(input.typeId !== undefined && { typeId: input.typeId }),
        ...(input.isApproved !== undefined && { isApproved: input.isApproved }),
        updatedAt: now(),
      },
    });
    return _toManufacturerRecord(row);
  } catch (error) {
    throw translateCatalogWriteError(error, {
      aggregate: 'manufacturers',
      id,
    });
  }
}

/**
 * Borra una marca. A diferencia de `deleteType` (R-1, cuenta dependientes),
 * `products.manufacturer_id` es `ON DELETE SET NULL` (`db/schema.sql:333`):
 * Postgres desenlaza los productos solos, el repositorio NO los toca y
 * ningún producto se borra. No hay 409 en ninguna ruta de esta US (D27b-3).
 * `find-then-delete`, precedente `deleteScrapedProduct`
 * (`products.repository.ts:400-413`).
 */
export async function deleteManufacturer(id: number): Promise<ManufacturerRecord> {
  const existing = await prisma.manufacturer.findUnique({ where: { id } });
  if (!existing) {
    throw new RecordNotFoundError('manufacturers', id);
  }

  try {
    await prisma.manufacturer.delete({ where: { id } });
    return _toManufacturerRecord(existing);
  } catch (error) {
    throw translateCatalogWriteError(error, {
      aggregate: 'manufacturers',
      id,
    });
  }
}
