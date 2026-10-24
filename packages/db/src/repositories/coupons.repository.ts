/**
 * coupons.repository.ts — cupones de descuento (US-52).
 *
 * Un cupón es de una tienda (`shopId`) o global (`null`, solo super_admin; esa
 * regla es de la API). `is_valid` no se guarda: depende del reloj y lo calcula
 * el consumidor con `now()` de `clock.ts`.
 *
 * Los CHECK de la tabla (`type`, `amount`, `minimum_cart_amount` y la
 * vigencia `expire_at > active_from`) no existen para Prisma: se validan aquí
 * con `InvalidFieldValueError` (400). `code` es UNIQUE: el `P2002` llega como
 * `SlugConflictError` (409).
 */

import type { Prisma } from '../../generated/prisma/client/client';
import { prisma } from '../client';
import { now } from '../clock';
import {
  InvalidFieldValueError,
  RecordNotFoundError,
  translateCatalogWriteError,
} from '../domain-errors';
import { _toCouponRecord, type CouponRecord } from '../records';

export const COUPON_TYPES = ['fixed', 'percentage', 'free_shipping'] as const;

export interface ListCouponsInput {
  shopId?: number;
  /** Búsqueda parcial por código, case-insensitive. */
  code?: string;
  page?: number;
  limit?: number;
}

/** Paginado en `id DESC` (el orden del mock). Los filtros se combinan con AND. */
export async function listCoupons(
  input: ListCouponsInput = {}
): Promise<{ items: CouponRecord[]; total: number }> {
  const page = Math.max(1, input.page ?? 1);
  const limit = input.limit ?? 12;
  const where: Prisma.CouponWhereInput = {
    ...(input.shopId !== undefined && { shopId: input.shopId }),
    ...(input.code && {
      code: { contains: input.code, mode: 'insensitive' as const },
    }),
  };
  const [rows, total] = await Promise.all([
    prisma.coupon.findMany({
      where,
      orderBy: { id: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.coupon.count({ where }),
  ]);
  return { items: rows.map(_toCouponRecord), total };
}

/** Por código exacto (distingue mayúsculas, como el mock). `null` si no existe. */
export async function findCouponByCode(
  code: string
): Promise<CouponRecord | null> {
  const row = await prisma.coupon.findUnique({ where: { code } });
  return row ? _toCouponRecord(row) : null;
}

export async function findCouponById(id: number): Promise<CouponRecord | null> {
  const row = await prisma.coupon.findUnique({ where: { id } });
  return row ? _toCouponRecord(row) : null;
}

export interface CreateCouponInput {
  code: string;
  type: string;
  amount: number;
  activeFrom: Date;
  expireAt: Date;
  description?: string | null;
  /** `json` nullable; `image: null` se trata como ausente (DD-5, precedente tags). */
  image?: Prisma.InputJsonValue;
  minimumCartAmount?: number;
  target?: boolean;
  language?: string;
  shopId?: number | null;
  userId?: number | null;
}

/** `shopId` y `userId` no cambian tras crear; la aprobación va por `setCouponApproval`. */
export type UpdateCouponInput = Partial<
  Omit<CreateCouponInput, 'shopId' | 'userId'>
>;

function _assertValues(input: UpdateCouponInput): void {
  if (
    input.type !== undefined &&
    !(COUPON_TYPES as readonly string[]).includes(input.type)
  ) {
    throw new InvalidFieldValueError(
      'coupons',
      'type',
      input.type,
      'coupons_type_check'
    );
  }
  for (const [field, value, constraint] of [
    ['amount', input.amount, 'coupons_amount_check'],
    [
      'minimum_cart_amount',
      input.minimumCartAmount,
      'coupons_minimum_cart_amount_check',
    ],
  ] as const) {
    if (value !== undefined && !(Number.isFinite(value) && value >= 0)) {
      throw new InvalidFieldValueError('coupons', field, value, constraint);
    }
  }
  for (const [field, value] of [
    ['active_from', input.activeFrom],
    ['expire_at', input.expireAt],
  ] as const) {
    if (value !== undefined && Number.isNaN(value.getTime())) {
      throw new InvalidFieldValueError(
        'coupons',
        field,
        'fecha inválida',
        'timestamptz'
      );
    }
  }
}

function _assertVigencia(activeFrom: Date, expireAt: Date): void {
  if (expireAt.getTime() <= activeFrom.getTime()) {
    throw new InvalidFieldValueError(
      'coupons',
      'expire_at',
      expireAt.toISOString(),
      'coupons_vigencia_valida'
    );
  }
}

/** El P2003 solo puede venir de `shop_id`: `user_id` sale del token. */
function _translate(error: unknown, id?: number): unknown {
  const code = (error as { code?: unknown } | null)?.code;
  return translateCatalogWriteError(error, {
    aggregate: 'coupons',
    id,
    uniqueField: code === 'P2003' ? 'shop_id' : 'code',
  });
}

/** Campos opcionales compartidos por create/update: ausente ⇒ no se toca. */
function _optionalData(input: UpdateCouponInput) {
  return {
    ...(input.description !== undefined && { description: input.description }),
    ...(input.image != null && { image: input.image }),
    ...(input.minimumCartAmount !== undefined && {
      minimumCartAmount: input.minimumCartAmount,
    }),
    ...(input.target !== undefined && { target: input.target }),
    ...(input.language !== undefined && { language: input.language }),
  };
}

/** Nace sin aprobar (`is_approve` false, el default del DDL). */
export async function createCoupon(
  input: CreateCouponInput
): Promise<CouponRecord> {
  _assertValues(input);
  _assertVigencia(input.activeFrom, input.expireAt);
  try {
    const row = await prisma.coupon.create({
      data: {
        code: input.code,
        type: input.type,
        amount: input.amount,
        activeFrom: input.activeFrom,
        expireAt: input.expireAt,
        shopId: input.shopId ?? null,
        userId: input.userId ?? null,
        ..._optionalData(input),
      },
    });
    return _toCouponRecord(row);
  } catch (error) {
    throw _translate(error);
  }
}

/** La vigencia se valida contra la fila: basta con que cambie una de las dos fechas. */
export async function updateCoupon(
  id: number,
  input: UpdateCouponInput
): Promise<CouponRecord> {
  _assertValues(input);
  const existing = await prisma.coupon.findUnique({ where: { id } });
  if (!existing) {
    throw new RecordNotFoundError('coupons', id);
  }
  _assertVigencia(
    input.activeFrom ?? existing.activeFrom,
    input.expireAt ?? existing.expireAt
  );
  try {
    const row = await prisma.coupon.update({
      where: { id },
      data: {
        ...(input.code !== undefined && { code: input.code }),
        ...(input.type !== undefined && { type: input.type }),
        ...(input.amount !== undefined && { amount: input.amount }),
        ...(input.activeFrom !== undefined && { activeFrom: input.activeFrom }),
        ...(input.expireAt !== undefined && { expireAt: input.expireAt }),
        ..._optionalData(input),
        updatedAt: now(),
      },
    });
    return _toCouponRecord(row);
  } catch (error) {
    throw _translate(error, id);
  }
}

/** Moderación del admin. `updatedAt: now()` explícito (US-32). */
export async function setCouponApproval(
  id: number,
  isApprove: boolean
): Promise<CouponRecord> {
  try {
    const row = await prisma.coupon.update({
      where: { id },
      data: { isApprove, updatedAt: now() },
    });
    return _toCouponRecord(row);
  } catch (error) {
    throw _translate(error, id);
  }
}

/** Borra un cupón y devuelve la fila borrada. Nada lo referencia con FK todavía (US-58). */
export async function deleteCoupon(id: number): Promise<CouponRecord> {
  try {
    return _toCouponRecord(await prisma.coupon.delete({ where: { id } }));
  } catch (error) {
    throw _translate(error, id);
  }
}
