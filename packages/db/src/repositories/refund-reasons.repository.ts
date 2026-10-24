/**
 * refund-reasons.repository.ts — motivos de reembolso (US-48).
 *
 * El agregado más plano del épico: nombre, slug e idioma. Calco de
 * `tags.repository.ts` sin FK. Los timestamps forman parte del contrato
 * (`refund-reasons.json` los emite), por eso `updateRefundReason` fija
 * `updatedAt` con `now()` de `clock.ts` (US-32).
 */

import type { Prisma } from '../../generated/prisma/client/client';
import { prisma } from '../client';
import { now } from '../clock';
import {
  RecordNotFoundError,
  translateCatalogWriteError,
} from '../domain-errors';
import { _toRefundReasonRecord, type RefundReasonRecord } from '../records';
import { type ExistingSlugLookup, generateSlug, normalizeSlug } from '../slug';

export interface ListRefundReasonsInput {
  /** Búsqueda parcial por nombre, case-insensitive. */
  name?: string;
  /** 1-based. Default 1. */
  page?: number;
  /** Default 10, como el mock. */
  limit?: number;
}

/** Listado paginado, `id ASC` (el orden del mock). */
export async function listRefundReasons(
  input: ListRefundReasonsInput = {}
): Promise<{ items: RefundReasonRecord[]; total: number }> {
  const page = Math.max(1, input.page ?? 1);
  const limit = input.limit ?? 10;
  const where: Prisma.RefundReasonWhereInput = {
    ...(input.name && {
      name: { contains: input.name, mode: 'insensitive' as const },
    }),
  };

  const [rows, total] = await Promise.all([
    prisma.refundReason.findMany({
      where,
      orderBy: { id: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.refundReason.count({ where }),
  ]);

  return { items: rows.map(_toRefundReasonRecord), total };
}

/** Un motivo por slug. `null` si no existe. */
export async function findRefundReasonBySlug(
  slug: string
): Promise<RefundReasonRecord | null> {
  const row = await prisma.refundReason.findUnique({ where: { slug } });
  return row ? _toRefundReasonRecord(row) : null;
}

// ---------------------------------------------------------------------------
// Escritura (admin)
// ---------------------------------------------------------------------------

const refundReasonSlugs: ExistingSlugLookup = async (prefix) =>
  (
    await prisma.refundReason.findMany({
      where: { slug: { startsWith: prefix } },
      select: { slug: true },
    })
  ).map((r) => r.slug);

export interface CreateRefundReasonInput {
  name: string;
  /** Si llega no vacío, es la fuente del slug; si no, se deriva de `name`. */
  slug?: string | null;
  language?: string;
}

/** El `slug` es inmutable tras crear. */
export type UpdateRefundReasonInput = Partial<
  Omit<CreateRefundReasonInput, 'slug'>
>;

export async function createRefundReason(
  input: CreateRefundReasonInput
): Promise<RefundReasonRecord> {
  const slug = await generateSlug(
    { name: input.name, slug: input.slug },
    refundReasonSlugs,
    'refund_reasons'
  );

  try {
    const row = await prisma.refundReason.create({
      data: {
        name: input.name,
        slug,
        ...(input.language !== undefined && { language: input.language }),
      },
    });
    return _toRefundReasonRecord(row);
  } catch (error) {
    throw translateCatalogWriteError(error, { aggregate: 'refund_reasons' });
  }
}

export async function updateRefundReason(
  id: number,
  input: UpdateRefundReasonInput
): Promise<RefundReasonRecord> {
  if (input.name !== undefined) {
    await normalizeSlug(input.name, 'refund_reasons');
  }

  try {
    const row = await prisma.refundReason.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.language !== undefined && { language: input.language }),
        updatedAt: now(),
      },
    });
    return _toRefundReasonRecord(row);
  } catch (error) {
    throw translateCatalogWriteError(error, {
      aggregate: 'refund_reasons',
      id,
    });
  }
}

/** Borra un motivo y devuelve la fila borrada. Nada lo referencia. */
export async function deleteRefundReason(
  id: number
): Promise<RefundReasonRecord> {
  const existing = await prisma.refundReason.findUnique({ where: { id } });
  if (!existing) {
    throw new RecordNotFoundError('refund_reasons', id);
  }

  try {
    await prisma.refundReason.delete({ where: { id } });
    return _toRefundReasonRecord(existing);
  } catch (error) {
    throw translateCatalogWriteError(error, {
      aggregate: 'refund_reasons',
      id,
    });
  }
}
