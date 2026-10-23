/**
 * order-statuses.repository.ts — catálogo de estados de pedido (US-57).
 *
 * No es el vocabulario de `orders.order_status` (enum `OrderStatusType` de la
 * API): no hay FK entre las dos tablas, así que borrar un estado no tiene
 * dependientes que contar.
 *
 * `slug` y `serial` son UNIQUE: un `P2002` llega como `SlugConflictError`
 * (409). Las CHECK de `serial > 0` y del color `#rrggbb` no existen para
 * Prisma: se validan aquí con `InvalidFieldValueError` (400).
 *
 * A diferencia de `tags`, el slug NO es inmutable: si el update trae `name`,
 * se recalcula (decisión del dueño en US-57, CA-3).
 */

import type { Prisma } from '../../generated/prisma/client/client';
import { prisma } from '../client';
import { now } from '../clock';
import {
  InvalidFieldValueError,
  RecordNotFoundError,
  translateCatalogWriteError,
} from '../domain-errors';
import { _toOrderStatusRecord, type OrderStatusRecord } from '../records';
import { generateSlug, type ExistingSlugLookup } from '../slug';

/** Columnas por las que el listado puede ordenar (enum `orderBy` del DTO). */
export const ORDER_STATUS_SORTABLE = ['name', 'serial', 'createdAt', 'updatedAt'] as const;
export type OrderStatusSortField = (typeof ORDER_STATUS_SORTABLE)[number];

const COLOR_HEX = /^#[0-9a-fA-F]{6}$/;

export interface ListOrderStatusesInput {
  /** Búsqueda parcial por nombre, case-insensitive. */
  name?: string;
  orderBy?: OrderStatusSortField;
  sortedBy?: 'asc' | 'desc';
  /** 1-based. Default 1. */
  page?: number;
  /** Default 30, como el mock. */
  limit?: number;
}

/**
 * Paginado. Sin `orderBy`, `serial ASC`: es el orden del mock (el 7
 * «Delivered» va al final con el serial 11). Desempate siempre por `id ASC`.
 */
export async function listOrderStatuses(
  input: ListOrderStatusesInput = {}
): Promise<{ items: OrderStatusRecord[]; total: number }> {
  const page = Math.max(1, input.page ?? 1);
  const limit = input.limit ?? 30;
  const where: Prisma.OrderStatusWhereInput = {
    ...(input.name && { name: { contains: input.name, mode: 'insensitive' as const } }),
  };
  const orderBy: Prisma.OrderStatusOrderByWithRelationInput[] = [
    { [input.orderBy ?? 'serial']: input.sortedBy ?? 'asc' },
    { id: 'asc' },
  ];
  const [rows, total] = await Promise.all([
    prisma.orderStatus.findMany({ where, orderBy, skip: (page - 1) * limit, take: limit }),
    prisma.orderStatus.count({ where }),
  ]);
  return { items: rows.map(_toOrderStatusRecord), total };
}

/** Un estado por slug. `null` si no existe. */
export async function findOrderStatusBySlug(slug: string): Promise<OrderStatusRecord | null> {
  const row = await prisma.orderStatus.findUnique({ where: { slug } });
  return row ? _toOrderStatusRecord(row) : null;
}

/** Slugs con el prefijo, sin contar la fila `exceptId` (la que se renombra). */
const orderStatusSlugs =
  (exceptId?: number): ExistingSlugLookup =>
  async (prefix) =>
    (
      await prisma.orderStatus.findMany({
        where: {
          slug: { startsWith: prefix },
          ...(exceptId !== undefined && { id: { not: exceptId } }),
        },
        select: { slug: true },
      })
    ).map((r) => r.slug);

export interface CreateOrderStatusInput {
  name: string;
  color: string;
  serial: number;
  /** Ausente ⇒ `DEFAULT 'es'`. */
  language?: string;
}

export type UpdateOrderStatusInput = Partial<CreateOrderStatusInput>;

function _assertValues(input: UpdateOrderStatusInput): void {
  if (input.serial !== undefined && !(Number.isSafeInteger(input.serial) && input.serial > 0)) {
    throw new InvalidFieldValueError('order_statuses', 'serial', input.serial, 'order_statuses_serial_check');
  }
  if (input.color !== undefined && !(typeof input.color === 'string' && COLOR_HEX.test(input.color))) {
    throw new InvalidFieldValueError('order_statuses', 'color', input.color, 'order_statuses_color_check');
  }
}

/** Crea un estado. El slug sale de `name` vía `generateSlug`. */
export async function createOrderStatus(input: CreateOrderStatusInput): Promise<OrderStatusRecord> {
  _assertValues({ serial: input.serial ?? Number.NaN, color: input.color ?? '' });
  const slug = await generateSlug({ name: input.name }, orderStatusSlugs(), 'order_statuses');

  try {
    const row = await prisma.orderStatus.create({
      data: {
        name: input.name,
        slug,
        serial: input.serial,
        color: input.color,
        ...(input.language !== undefined && { language: input.language }),
      },
    });
    return _toOrderStatusRecord(row);
  } catch (error) {
    throw translateCatalogWriteError(error, { aggregate: 'order_statuses' });
  }
}

/**
 * Actualiza un estado. Si llega `name`, el slug se recalcula sin contar la
 * propia fila: renombrar al mismo nombre conserva el slug. Una clave ausente
 * del input no llega al `data` de Prisma. `updatedAt: now()` explícito
 * (reloj único, US-32).
 */
export async function updateOrderStatus(
  id: number,
  input: UpdateOrderStatusInput
): Promise<OrderStatusRecord> {
  _assertValues(input);
  const slug =
    input.name !== undefined
      ? await generateSlug({ name: input.name }, orderStatusSlugs(id), 'order_statuses')
      : undefined;

  try {
    const row = await prisma.orderStatus.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name, slug }),
        ...(input.serial !== undefined && { serial: input.serial }),
        ...(input.color !== undefined && { color: input.color }),
        ...(input.language !== undefined && { language: input.language }),
        updatedAt: now(),
      },
    });
    return _toOrderStatusRecord(row);
  } catch (error) {
    throw translateCatalogWriteError(error, { aggregate: 'order_statuses', id });
  }
}

/** Borra un estado y devuelve su snapshot previo (precedente `deleteTag`). */
export async function deleteOrderStatus(id: number): Promise<OrderStatusRecord> {
  const existing = await prisma.orderStatus.findUnique({ where: { id } });
  if (!existing) {
    throw new RecordNotFoundError('order_statuses', id);
  }

  try {
    await prisma.orderStatus.delete({ where: { id } });
    return _toOrderStatusRecord(existing);
  } catch (error) {
    throw translateCatalogWriteError(error, { aggregate: 'order_statuses', id });
  }
}
