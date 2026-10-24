/**
 * order-files.repository.ts — descargas digitales de un cliente (US-60).
 *
 * Solo lectura, y siempre de UN cliente: la API pasa el `sub` del token, y
 * aquí no hay forma de listar las descargas de todos. `digital_file_id` no es
 * único (el mock repite el 42 en cuatro filas): la descarga toma la primera
 * por `id`, como hacía el `find` del mock.
 */

import { prisma } from '../client';
import { _toOrderFileRecord, type OrderFileRecord } from '../records';

export interface ListOrderFilesInput {
  /** 1-based. Default 1. */
  page?: number;
  /** Default 30, como el mock. */
  limit?: number;
}

/** Las descargas del cliente, paginadas en `id ASC` (el orden del mock). */
export async function listOrderFilesByCustomer(
  customerId: number,
  input: ListOrderFilesInput = {}
): Promise<{ items: OrderFileRecord[]; total: number }> {
  const page = Math.max(1, input.page ?? 1);
  const limit = input.limit ?? 30;
  const where = { customerId };
  const [rows, total] = await Promise.all([
    prisma.orderFile.findMany({
      where,
      orderBy: { id: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.orderFile.count({ where }),
  ]);
  return { items: rows.map(_toOrderFileRecord), total };
}

/** La primera descarga (por `id`) del cliente con ese `digital_file_id`, o `null`. */
export async function findFirstOrderFileByDigitalFileId(
  digitalFileId: number,
  customerId: number
): Promise<OrderFileRecord | null> {
  const row = await prisma.orderFile.findFirst({
    where: { digitalFileId, customerId },
    orderBy: { id: 'asc' },
  });
  return row ? _toOrderFileRecord(row) : null;
}
