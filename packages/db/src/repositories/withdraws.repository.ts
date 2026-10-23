/**
 * withdraws.repository.ts — solicitudes de retiro de las tiendas (US-62).
 *
 * Un retiro es de una tienda; quién puede verlo o pedirlo (super admin todo,
 * dueño solo lo de sus tiendas) es regla de la API, que aquí llega como el
 * filtro `ownerId`. No hay balance: aprobar solo cambia `status`.
 *
 * Los CHECK de la tabla (`amount > 0` y el vocabulario de `status`) no
 * existen para Prisma: se validan aquí con `InvalidFieldValueError` (400). Un
 * `shop_id` inexistente llega como P2003 y sale `InvalidReferenceError` (400).
 */

import type { Prisma } from '../../generated/prisma/client/client';
import { prisma } from '../client';
import { now } from '../clock';
import { InvalidFieldValueError, translateCatalogWriteError } from '../domain-errors';
import {
  _toShopRecord,
  _toWithdrawRecord,
  type ShopRecord,
  type WithdrawRecord,
} from '../records';

/** El CHECK `withdraws_status_check`, en minúscula (el vocabulario del admin). */
export const WITHDRAW_STATUSES = ['pending', 'approved', 'on_hold', 'rejected', 'processing'] as const;

/** `numeric(12,2)`: 10 dígitos enteros. */
const MAX_AMOUNT = 1e10;

/** El retiro con su tienda, que la API embebe como snapshot. */
export interface WithdrawDetailRecord extends WithdrawRecord {
  shop: ShopRecord;
}

export interface ListWithdrawsInput {
  shopId?: number;
  /** Solo los retiros de tiendas de este dueño. */
  ownerId?: number;
  status?: string;
  /** 1-based. Default 1. */
  page?: number;
  /** Default 10. */
  limit?: number;
}

export interface CreateWithdrawInput {
  shopId: number;
  amount: number;
  paymentMethod: string;
  details?: string | null;
  note?: string | null;
}

type WithdrawWithShop = Prisma.WithdrawGetPayload<{ include: { shop: true } }>;

function _toDetail(row: WithdrawWithShop): WithdrawDetailRecord {
  return { ..._toWithdrawRecord(row), shop: _toShopRecord(row.shop) };
}

function _translate(error: unknown, id?: number): unknown {
  return translateCatalogWriteError(error, { aggregate: 'withdraws', id, uniqueField: 'shop_id' });
}

/** Paginado en `id DESC` (el orden del mock). Los filtros se combinan con AND. */
export async function listWithdraws(
  input: ListWithdrawsInput = {}
): Promise<{ items: WithdrawDetailRecord[]; total: number }> {
  const page = Math.max(1, input.page ?? 1);
  const limit = input.limit ?? 10;
  const where: Prisma.WithdrawWhereInput = {
    ...(input.shopId !== undefined && { shopId: input.shopId }),
    ...(input.ownerId !== undefined && { shop: { ownerId: input.ownerId } }),
    ...(input.status !== undefined && { status: input.status }),
  };
  const [rows, total] = await Promise.all([
    prisma.withdraw.findMany({
      where,
      include: { shop: true },
      orderBy: { id: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.withdraw.count({ where }),
  ]);
  return { items: rows.map(_toDetail), total };
}

export async function findWithdrawById(id: number): Promise<WithdrawDetailRecord | null> {
  const row = await prisma.withdraw.findUnique({ where: { id }, include: { shop: true } });
  return row ? _toDetail(row) : null;
}

/** Nace `pending` (el default del DDL): el status del que lo pide no cuenta. */
export async function createWithdraw(input: CreateWithdrawInput): Promise<WithdrawDetailRecord> {
  if (!(Number.isFinite(input.amount) && input.amount > 0 && input.amount < MAX_AMOUNT)) {
    throw new InvalidFieldValueError('withdraws', 'amount', input.amount, 'withdraws_amount_check');
  }
  try {
    const row = await prisma.withdraw.create({
      data: {
        shopId: input.shopId,
        amount: input.amount,
        paymentMethod: input.paymentMethod,
        details: input.details ?? null,
        note: input.note ?? null,
      },
      include: { shop: true },
    });
    return _toDetail(row);
  } catch (error) {
    throw _translate(error);
  }
}

/** Cambia el estado. `updatedAt: now()` explícito (US-32). Inexistente ⇒ `RecordNotFoundError`. */
export async function updateWithdrawStatus(id: number, status: string): Promise<WithdrawDetailRecord> {
  if (!(WITHDRAW_STATUSES as readonly string[]).includes(status)) {
    throw new InvalidFieldValueError('withdraws', 'status', status, 'withdraws_status_check');
  }
  try {
    const row = await prisma.withdraw.update({
      where: { id },
      data: { status, updatedAt: now() },
      include: { shop: true },
    });
    return _toDetail(row);
  } catch (error) {
    throw _translate(error, id);
  }
}

/** Borra de verdad y devuelve la fila borrada. Nada referencia a `withdraws`. */
export async function deleteWithdraw(id: number): Promise<WithdrawDetailRecord> {
  try {
    return _toDetail(await prisma.withdraw.delete({ where: { id }, include: { shop: true } }));
  } catch (error) {
    throw _translate(error, id);
  }
}
