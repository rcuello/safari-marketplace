/**
 * refund-policies.repository.ts — políticas de reembolso (US-48).
 *
 * Calco de `tags.repository.ts`. Los dos CHECK de la tabla
 * (`refund_policies_target_check`, `refund_policies_status_check`) no existen
 * para Prisma: se validan aquí antes de escribir con `InvalidFieldValueError`
 * (`domain-errors.ts`), que `toWriteHttpException` traduce a 400.
 */

import type { Prisma } from '../../generated/prisma/client/client';
import { prisma } from '../client';
import { now } from '../clock';
import {
  InvalidFieldValueError,
  InvalidReferenceError,
  RecordNotFoundError,
  translateCatalogWriteError,
} from '../domain-errors';
import { generateSlug, normalizeSlug, type ExistingSlugLookup } from '../slug';
import { _toRefundPolicyRecord, type RefundPolicyRecord } from '../records';

export const REFUND_POLICY_TARGETS = ['vendor', 'customer'] as const;
export const REFUND_POLICY_STATUSES = ['approved', 'pending'] as const;

export interface ListRefundPoliciesInput {
  /** `vendor` | `customer`, igualdad exacta. */
  target?: string;
  /** `approved` | `pending`, igualdad exacta. */
  status?: string;
  /** Búsqueda parcial por título, case-insensitive. */
  title?: string;
  shopId?: number;
  /** 1-based. Default 1. */
  page?: number;
  /** Default 10, como el mock. */
  limit?: number;
}

/** Listado paginado, `id ASC` (el orden del mock). */
export async function listRefundPolicies(
  input: ListRefundPoliciesInput = {}
): Promise<{ items: RefundPolicyRecord[]; total: number }> {
  const page = Math.max(1, input.page ?? 1);
  const limit = input.limit ?? 10;
  const where: Prisma.RefundPolicyWhereInput = {
    ...(input.target && { target: input.target }),
    ...(input.status && { status: input.status }),
    ...(input.title && {
      title: { contains: input.title, mode: 'insensitive' as const },
    }),
    ...(input.shopId !== undefined && { shopId: input.shopId }),
  };

  const [rows, total] = await Promise.all([
    prisma.refundPolicy.findMany({
      where,
      orderBy: { id: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.refundPolicy.count({ where }),
  ]);

  return { items: rows.map(_toRefundPolicyRecord), total };
}

/** Una política por slug. `null` si no existe. */
export async function findRefundPolicyBySlug(
  slug: string
): Promise<RefundPolicyRecord | null> {
  const row = await prisma.refundPolicy.findUnique({ where: { slug } });
  return row ? _toRefundPolicyRecord(row) : null;
}

// ---------------------------------------------------------------------------
// Escritura (admin)
// ---------------------------------------------------------------------------

const refundPolicySlugs: ExistingSlugLookup = async (prefix) =>
  (
    await prisma.refundPolicy.findMany({
      where: { slug: { startsWith: prefix } },
      select: { slug: true },
    })
  ).map((r) => r.slug);

export interface CreateRefundPolicyInput {
  title: string;
  target: string;
  /** Ausente ⇒ `DEFAULT 'pending'`. */
  status?: string;
  /** Si llega no vacío, es la fuente del slug; si no, se deriva de `title`. */
  slug?: string | null;
  description?: string | null;
  shopId?: number | null;
  language?: string;
}

/** El `slug` es inmutable tras crear (precedente `updateTag`). */
export type UpdateRefundPolicyInput = Partial<Omit<CreateRefundPolicyInput, 'slug'>>;

function _assertValues(input: { target?: string; status?: string; shopId?: number | null }): void {
  if (
    input.target !== undefined &&
    !(REFUND_POLICY_TARGETS as readonly string[]).includes(input.target)
  ) {
    throw new InvalidFieldValueError(
      'refund_policies',
      'target',
      input.target,
      'refund_policies_target_check'
    );
  }
  if (
    input.status !== undefined &&
    !(REFUND_POLICY_STATUSES as readonly string[]).includes(input.status)
  ) {
    throw new InvalidFieldValueError(
      'refund_policies',
      'status',
      input.status,
      'refund_policies_status_check'
    );
  }
  if (input.shopId != null && (!Number.isSafeInteger(input.shopId) || input.shopId <= 0)) {
    throw new InvalidReferenceError('refund_policies', 'shop_id', input.shopId);
  }
}

export async function createRefundPolicy(
  input: CreateRefundPolicyInput
): Promise<RefundPolicyRecord> {
  _assertValues(input);
  const slug = await generateSlug(
    { name: input.title, slug: input.slug },
    refundPolicySlugs,
    'refund_policies'
  );

  try {
    const row = await prisma.refundPolicy.create({
      data: {
        title: input.title,
        slug,
        target: input.target,
        ...(input.status !== undefined && { status: input.status }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.shopId != null && { shopId: input.shopId }),
        ...(input.language !== undefined && { language: input.language }),
      },
    });
    return _toRefundPolicyRecord(row);
  } catch (error) {
    throw translateCatalogWriteError(error, { aggregate: 'refund_policies' });
  }
}

/** `updatedAt: now()` explícito: ninguna tabla tiene trigger (US-32). */
export async function updateRefundPolicy(
  id: number,
  input: UpdateRefundPolicyInput
): Promise<RefundPolicyRecord> {
  if (input.title !== undefined) {
    await normalizeSlug(input.title, 'refund_policies');
  }
  _assertValues(input);

  try {
    const row = await prisma.refundPolicy.update({
      where: { id },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.target !== undefined && { target: input.target }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.shopId !== undefined && { shopId: input.shopId }),
        ...(input.language !== undefined && { language: input.language }),
        updatedAt: now(),
      },
    });
    return _toRefundPolicyRecord(row);
  } catch (error) {
    throw translateCatalogWriteError(error, { aggregate: 'refund_policies', id });
  }
}

/** Borra una política y devuelve la fila borrada. Nada la referencia. */
export async function deleteRefundPolicy(id: number): Promise<RefundPolicyRecord> {
  const existing = await prisma.refundPolicy.findUnique({ where: { id } });
  if (!existing) {
    throw new RecordNotFoundError('refund_policies', id);
  }

  try {
    await prisma.refundPolicy.delete({ where: { id } });
    return _toRefundPolicyRecord(existing);
  } catch (error) {
    throw translateCatalogWriteError(error, { aggregate: 'refund_policies', id });
  }
}
