/**
 * taxes.repository.ts — clases de impuesto (US-49).
 *
 * Sin paginar: el admin de `/settings` pide `limit=999` y espera un ARRAY
 * para poblar el selector de clase, y el mock siempre devolvió el array
 * entero. `settings.options.taxClass` referencia el id como texto, sin FK.
 *
 * `taxes_rate_check` (rate ≥ 0) no existe para Prisma: se valida aquí con
 * `InvalidTaxValueError` (400), patrón de `InvalidSalePriceError`.
 */

import type { Prisma } from '../../generated/prisma/client/client';
import { prisma } from '../client';
import { now } from '../clock';
import {
  CATALOG_ERROR_CODES,
  CatalogWriteError,
  RecordNotFoundError,
  translateCatalogWriteError,
} from '../domain-errors';
import { _toTaxRecord, type TaxRecord } from '../records';

/** `rate` que no es un número finito ≥ 0 (CHECK `taxes_rate_check`). */
export class InvalidTaxValueError extends CatalogWriteError {
  readonly code = CATALOG_ERROR_CODES.InvalidReference;
  constructor(value: unknown) {
    super(
      `\`taxes.rate\` debe ser un número >= 0 (recibido \`${String(value)}\`) — CHECK taxes_rate_check.`,
      'taxes'
    );
    this.name = 'InvalidTaxValueError';
  }
}

export interface ListTaxesInput {
  /** Búsqueda parcial por nombre, case-insensitive. */
  name?: string;
}

/** Todas las clases, `id ASC` (el orden del mock). */
export async function listTaxes(input: ListTaxesInput = {}): Promise<TaxRecord[]> {
  const where: Prisma.TaxWhereInput = {
    ...(input.name && { name: { contains: input.name, mode: 'insensitive' as const } }),
  };
  const rows = await prisma.tax.findMany({ where, orderBy: { id: 'asc' } });
  return rows.map(_toTaxRecord);
}

/** Una clase por id. `null` si no existe. */
export async function findTaxById(id: number): Promise<TaxRecord | null> {
  const row = await prisma.tax.findUnique({ where: { id } });
  return row ? _toTaxRecord(row) : null;
}

export interface CreateTaxInput {
  name: string;
  rate: number;
  isGlobal?: boolean;
  country?: string | null;
  state?: string | null;
  zip?: string | null;
  city?: string | null;
  priority?: number | null;
  onShipping?: boolean;
}

export type UpdateTaxInput = Partial<CreateTaxInput>;

function _assertRate(rate: number | undefined): void {
  if (rate !== undefined && !(Number.isFinite(rate) && rate >= 0)) {
    throw new InvalidTaxValueError(rate);
  }
}

/** Campos opcionales compartidos por create/update: ausente ⇒ no se toca. */
function _optionalData(input: UpdateTaxInput) {
  return {
    ...(input.isGlobal !== undefined && { isGlobal: input.isGlobal }),
    ...(input.country !== undefined && { country: input.country }),
    ...(input.state !== undefined && { state: input.state }),
    ...(input.zip !== undefined && { zip: input.zip }),
    ...(input.city !== undefined && { city: input.city }),
    ...(input.priority !== undefined && { priority: input.priority }),
    ...(input.onShipping !== undefined && { onShipping: input.onShipping }),
  };
}

export async function createTax(input: CreateTaxInput): Promise<TaxRecord> {
  _assertRate(input.rate);
  try {
    const row = await prisma.tax.create({
      data: { name: input.name, rate: input.rate, ..._optionalData(input) },
    });
    return _toTaxRecord(row);
  } catch (error) {
    throw translateCatalogWriteError(error, { aggregate: 'taxes' });
  }
}

/** `updatedAt: now()` explícito: ninguna tabla tiene trigger (US-32). */
export async function updateTax(id: number, input: UpdateTaxInput): Promise<TaxRecord> {
  _assertRate(input.rate);
  try {
    const row = await prisma.tax.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.rate !== undefined && { rate: input.rate }),
        ..._optionalData(input),
        updatedAt: now(),
      },
    });
    return _toTaxRecord(row);
  } catch (error) {
    throw translateCatalogWriteError(error, { aggregate: 'taxes', id });
  }
}

/** Borra una clase y devuelve la fila borrada. Nada la referencia con FK. */
export async function deleteTax(id: number): Promise<TaxRecord> {
  const existing = await prisma.tax.findUnique({ where: { id } });
  if (!existing) {
    throw new RecordNotFoundError('taxes', id);
  }
  try {
    await prisma.tax.delete({ where: { id } });
    return _toTaxRecord(existing);
  } catch (error) {
    throw translateCatalogWriteError(error, { aggregate: 'taxes', id });
  }
}
