/**
 * shippings.repository.ts — clases de envío (US-49).
 *
 * Gemelo de `taxes.repository.ts`: sin paginar (el admin espera un array) y
 * con el id 1 referenciado como texto desde `settings.options.shippingClass`.
 * Los dos CHECK (`shippings_amount_check`, `shippings_type_check`) se validan
 * aquí con `InvalidFieldValueError` (400).
 */

import type { Prisma } from '../../generated/prisma/client/client';
import { prisma } from '../client';
import { now } from '../clock';
import {
  InvalidFieldValueError,
  RecordNotFoundError,
  translateCatalogWriteError,
} from '../domain-errors';
import { _toShippingRecord, type ShippingRecord } from '../records';

/** Valores de `ShippingType` (`shippings/entities/shipping.entity.ts`). */
export const SHIPPING_TYPES = ['fixed', 'percentage', 'free'] as const;

export interface ListShippingsInput {
  /** Búsqueda parcial por nombre, case-insensitive. */
  name?: string;
}

/** Todas las clases, `id ASC` (el orden del mock). */
export async function listShippings(
  input: ListShippingsInput = {}
): Promise<ShippingRecord[]> {
  const where: Prisma.ShippingWhereInput = {
    ...(input.name && {
      name: { contains: input.name, mode: 'insensitive' as const },
    }),
  };
  const rows = await prisma.shipping.findMany({
    where,
    orderBy: { id: 'asc' },
  });
  return rows.map(_toShippingRecord);
}

/** Una clase por id. `null` si no existe. */
export async function findShippingById(
  id: number
): Promise<ShippingRecord | null> {
  const row = await prisma.shipping.findUnique({ where: { id } });
  return row ? _toShippingRecord(row) : null;
}

export interface CreateShippingInput {
  name: string;
  amount: number;
  type: string;
  isGlobal?: boolean;
}

export type UpdateShippingInput = Partial<CreateShippingInput>;

function _assertValues(input: UpdateShippingInput): void {
  if (
    input.amount !== undefined &&
    !(Number.isFinite(input.amount) && input.amount >= 0)
  ) {
    throw new InvalidFieldValueError(
      'shippings',
      'amount',
      input.amount,
      'shippings_amount_check'
    );
  }
  if (
    input.type !== undefined &&
    !(SHIPPING_TYPES as readonly string[]).includes(input.type)
  ) {
    throw new InvalidFieldValueError(
      'shippings',
      'type',
      input.type,
      'shippings_type_check'
    );
  }
}

export async function createShipping(
  input: CreateShippingInput
): Promise<ShippingRecord> {
  _assertValues(input);
  try {
    const row = await prisma.shipping.create({
      data: {
        name: input.name,
        amount: input.amount,
        type: input.type,
        ...(input.isGlobal !== undefined && { isGlobal: input.isGlobal }),
      },
    });
    return _toShippingRecord(row);
  } catch (error) {
    throw translateCatalogWriteError(error, { aggregate: 'shippings' });
  }
}

/** `updatedAt: now()` explícito (US-32). */
export async function updateShipping(
  id: number,
  input: UpdateShippingInput
): Promise<ShippingRecord> {
  _assertValues(input);
  try {
    const row = await prisma.shipping.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.amount !== undefined && { amount: input.amount }),
        ...(input.type !== undefined && { type: input.type }),
        ...(input.isGlobal !== undefined && { isGlobal: input.isGlobal }),
        updatedAt: now(),
      },
    });
    return _toShippingRecord(row);
  } catch (error) {
    throw translateCatalogWriteError(error, { aggregate: 'shippings', id });
  }
}

/** Borra una clase y devuelve la fila borrada. */
export async function deleteShipping(id: number): Promise<ShippingRecord> {
  const existing = await prisma.shipping.findUnique({ where: { id } });
  if (!existing) {
    throw new RecordNotFoundError('shippings', id);
  }
  try {
    await prisma.shipping.delete({ where: { id } });
    return _toShippingRecord(existing);
  } catch (error) {
    throw translateCatalogWriteError(error, { aggregate: 'shippings', id });
  }
}
