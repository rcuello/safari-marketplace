/**
 * settings.repository.ts — configuración global de la tienda. Fila única
 * (CHECK settings_fila_unica garantiza id = 1). Es la PRIMERA llamada que
 * hace el shop en cada render.
 */

import { prisma } from '../client';
import { _toSettingRecord, type SettingRecord } from '../records';

/** La fila única de settings, o `null` si la base no está sembrada. */
export async function getSettings(): Promise<SettingRecord | null> {
  const row = await prisma.setting.findUnique({ where: { id: 1 } });
  return row ? _toSettingRecord(row) : null;
}
