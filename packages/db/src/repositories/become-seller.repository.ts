/**
 * become-seller.repository.ts — fila única de la página "vender con
 * nosotros" (CHECK `become_seller_fila_unica` garantiza id = 1). Calco de
 * `settings.repository.ts` (singleton hermano) para la lectura; la
 * escritura es la PRIMERA ruta de update de esta tabla (US-44).
 */

import type { Prisma } from '../../generated/prisma/client/client';
import { prisma } from '../client';
import { now } from '../clock';
import { _toBecomeSellerRecord, type BecomeSellerRecord } from '../records';

/** La fila única de become_seller, o `null` si la base no está sembrada. */
export async function getBecomeSeller(): Promise<BecomeSellerRecord | null> {
  const row = await prisma.becomeSeller.findUnique({ where: { id: 1 } });
  return row ? _toBecomeSellerRecord(row) : null;
}

/** Columnas actualizables. Todas opcionales: un body parcial no borra nada. */
export interface UpdateBecomeSellerInput {
  /** Objeto INTERNO de 24 claves, no el envoltorio (db/schema.sql:479-482). */
  pageOptions?: Prisma.InputJsonValue;
  commissions?: Prisma.InputJsonValue;
  language?: string;
}

/**
 * Actualiza la fila fija (id = 1). NUNCA crea: la CHECK
 * `become_seller_fila_unica` garantiza que existe una y solo una (CA-3).
 * `null` si la base no está sembrada (P2025), misma convención que
 * `setUserActive` (users.repository.ts:341-355).
 */
export async function updateBecomeSeller(
  input: UpdateBecomeSellerInput
): Promise<BecomeSellerRecord | null> {
  try {
    const row = await prisma.becomeSeller.update({
      where: { id: 1 },
      data: {
        ...(input.pageOptions !== undefined && {
          pageOptions: input.pageOptions,
        }),
        ...(input.commissions !== undefined && {
          commissions: input.commissions,
        }),
        ...(input.language !== undefined && { language: input.language }),
        updatedAt: now(),
      },
    });
    return _toBecomeSellerRecord(row);
  } catch (error) {
    if (_isRecordNotFound(error)) return null;
    throw error;
  }
}

function _isRecordNotFound(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: string }).code === 'P2025'
  );
}
