/**
 * terms-and-conditions.repository.ts — términos y condiciones (US-47).
 *
 * Misma forma que `faqs.repository.ts` (tipo y emisor derivados de la tienda,
 * vía `resolveContentIssuer`) más la cola de moderación: `setTermsApproval`
 * persiste lo que el mock mutaba en memoria. A diferencia de las FAQ, el
 * admin SÍ puede mandar el `slug` (`terms-and-conditions-form.tsx:126-138`).
 */

import type { Prisma } from '../../generated/prisma/client/client';
import { prisma } from '../client';
import { now } from '../clock';
import {
  RecordNotFoundError,
  translateCatalogWriteError,
} from '../domain-errors';
import {
  _toTermsAndConditionsRecord,
  type TermsAndConditionsRecord,
} from '../records';
import { type ExistingSlugLookup, generateSlug, normalizeSlug } from '../slug';
import { resolveContentIssuer } from './faqs.repository';

export interface ListTermsAndConditionsInput {
  shopId?: number;
  /** `global` | `shop`, igualdad exacta. */
  type?: string;
  /** Igualdad exacta. */
  issuedBy?: string;
  /** Búsqueda parcial por título, case-insensitive. */
  title?: string;
  isApproved?: boolean;
  /** 1-based. Default 1. */
  page?: number;
  /** Default 10, como el mock. */
  limit?: number;
}

/**
 * Listado paginado. `id ASC` da 8..12 tras la deduplicación del seed, que es
 * el prefijo del orden del archivo que servía el mock (8,9,10,11,12,1..5).
 */
export async function listTermsAndConditions(
  input: ListTermsAndConditionsInput = {}
): Promise<{ items: TermsAndConditionsRecord[]; total: number }> {
  const page = Math.max(1, input.page ?? 1);
  const limit = input.limit ?? 10;
  const where: Prisma.TermsAndConditionsWhereInput = {
    ...(input.shopId !== undefined && { shopId: input.shopId }),
    ...(input.type && { type: input.type }),
    ...(input.issuedBy && { issuedBy: input.issuedBy }),
    ...(input.title && {
      title: { contains: input.title, mode: 'insensitive' as const },
    }),
    ...(input.isApproved !== undefined && { isApproved: input.isApproved }),
  };

  const [rows, total] = await Promise.all([
    prisma.termsAndConditions.findMany({
      where,
      orderBy: { id: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.termsAndConditions.count({ where }),
  ]);

  return { items: rows.map(_toTermsAndConditionsRecord), total };
}

/** Un término por slug. `null` si no existe. */
export async function findTermsAndConditionsBySlug(
  slug: string
): Promise<TermsAndConditionsRecord | null> {
  const row = await prisma.termsAndConditions.findUnique({ where: { slug } });
  return row ? _toTermsAndConditionsRecord(row) : null;
}

// ---------------------------------------------------------------------------
// Escritura (admin)
// ---------------------------------------------------------------------------

const termsSlugs: ExistingSlugLookup = async (prefix) =>
  (
    await prisma.termsAndConditions.findMany({
      where: { slug: { startsWith: prefix } },
      select: { slug: true },
    })
  ).map((r) => r.slug);

export interface CreateTermsAndConditionsInput {
  title: string;
  description: string;
  /** Si llega no vacío, es la fuente del slug; si no, se deriva de `title`. */
  slug?: string | null;
  shopId?: number | null;
  userId?: number | null;
  /** Default `true`: solo el super_admin pasa el guard de escritura. */
  isApproved?: boolean;
  language?: string;
}

export type UpdateTermsAndConditionsInput = Partial<
  Pick<CreateTermsAndConditionsInput, 'title' | 'description' | 'language'>
>;

export async function createTermsAndConditions(
  input: CreateTermsAndConditionsInput
): Promise<TermsAndConditionsRecord> {
  const issuer = await resolveContentIssuer(
    'terms_and_conditions',
    input.shopId
  );
  const slug = await generateSlug(
    { name: input.title, slug: input.slug },
    termsSlugs,
    'terms_and_conditions'
  );

  try {
    const row = await prisma.termsAndConditions.create({
      data: {
        title: input.title,
        slug,
        description: input.description,
        type: issuer.type,
        issuedBy: issuer.issuedBy,
        isApproved: input.isApproved ?? true,
        shopId: issuer.shopId,
        ...(input.userId != null && { userId: input.userId }),
        ...(input.language !== undefined && { language: input.language }),
      },
    });
    return _toTermsAndConditionsRecord(row);
  } catch (error) {
    throw translateCatalogWriteError(error, {
      aggregate: 'terms_and_conditions',
    });
  }
}

/** El `slug` es inmutable; `updatedAt: now()` explícito (US-32). */
export async function updateTermsAndConditions(
  id: number,
  input: UpdateTermsAndConditionsInput
): Promise<TermsAndConditionsRecord> {
  if (input.title !== undefined) {
    await normalizeSlug(input.title, 'terms_and_conditions');
  }

  try {
    const row = await prisma.termsAndConditions.update({
      where: { id },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.description !== undefined && {
          description: input.description,
        }),
        ...(input.language !== undefined && { language: input.language }),
        updatedAt: now(),
      },
    });
    return _toTermsAndConditionsRecord(row);
  } catch (error) {
    throw translateCatalogWriteError(error, {
      aggregate: 'terms_and_conditions',
      id,
    });
  }
}

/** Aprueba o retira la aprobación. Inexistente ⇒ `RecordNotFoundError` (P2025). */
export async function setTermsApproval(
  id: number,
  isApproved: boolean
): Promise<TermsAndConditionsRecord> {
  try {
    const row = await prisma.termsAndConditions.update({
      where: { id },
      data: { isApproved, updatedAt: now() },
    });
    return _toTermsAndConditionsRecord(row);
  } catch (error) {
    throw translateCatalogWriteError(error, {
      aggregate: 'terms_and_conditions',
      id,
    });
  }
}

/** Borra un término y devuelve la fila borrada. */
export async function deleteTermsAndConditions(
  id: number
): Promise<TermsAndConditionsRecord> {
  const existing = await prisma.termsAndConditions.findUnique({
    where: { id },
  });
  if (!existing) {
    throw new RecordNotFoundError('terms_and_conditions', id);
  }

  try {
    await prisma.termsAndConditions.delete({ where: { id } });
    return _toTermsAndConditionsRecord(existing);
  } catch (error) {
    throw translateCatalogWriteError(error, {
      aggregate: 'terms_and_conditions',
      id,
    });
  }
}
