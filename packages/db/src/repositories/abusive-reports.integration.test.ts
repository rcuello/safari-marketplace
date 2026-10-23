/**
 * Test de integración contra el Postgres real (sembrado por `just db-up`:
 * 3 reportes de customer@demo.com, id 2, sobre las reseñas 1, 21 y 78). US-54;
 * los reportes de preguntas, US-55.
 *
 * Las escrituras son del admin (3), sin reportes en el seed; se borran en
 * `beforeAll`/`afterAll`.
 */

import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { _setNowProvider } from '../clock';
import { prisma } from '../client';
import {
  InvalidFieldValueError,
  RecordNotFoundError,
  SlugConflictError,
} from '../domain-errors';
import {
  createAbusiveReport,
  deleteAbusiveReport,
  findAbusiveReportById,
  listAbusiveReports,
  listAbusiveReportsByUser,
  updateAbusiveReport,
} from './abusive-reports.repository';

const CUSTOMER = 2;
const ADMIN = 3;

const cleanup = () => prisma.abusiveReport.deleteMany({ where: { userId: ADMIN } });

beforeAll(cleanup);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe('lecturas — seed', () => {
  it('todos en id DESC, con el autor y el nombre corto del modelo', async () => {
    const all = await listAbusiveReports();
    expect(all.map((r) => r.id)).toEqual([3, 2, 1]);
    expect(all.map((r) => r.modelId)).toEqual([1, 21, 78]);
    expect(all.every((r) => r.modelType === 'Review' && r.user.email === 'customer@demo.com')).toBe(true);
    expect(all[0].createdAt.toISOString()).toBe('2022-07-26T04:35:51.000Z');
  });

  it('por usuario, created_at DESC; un usuario sin reportes recibe []', async () => {
    expect((await listAbusiveReportsByUser(CUSTOMER)).map((r) => r.id)).toEqual([3, 2, 1]);
    expect(await listAbusiveReportsByUser(ADMIN)).toEqual([]);
    expect((await findAbusiveReportById(2))?.message).toBe('this is abusive reports');
    expect(await findAbusiveReportById(999_999)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Escrituras — NO INSERTAR LECTURAS DEL SEED DEBAJO DE ESTA LÍNEA.
// ---------------------------------------------------------------------------

describe('createAbusiveReport', () => {
  it('reporta una reseña; repetirlo ⇒ SlugConflictError', async () => {
    const created = await createAbusiveReport({
      userId: ADMIN,
      modelType: 'Review',
      modelId: 85,
      message: 'zz-report',
    });
    expect(created).toMatchObject({ userId: ADMIN, modelType: 'Review', modelId: 85 });
    expect(created.user.id).toBe(ADMIN);
    await expect(
      createAbusiveReport({ userId: ADMIN, modelType: 'Review', modelId: 85, message: 'otra vez' })
    ).rejects.toBeInstanceOf(SlugConflictError);
  });

  it('objeto inexistente ⇒ RecordNotFoundError; tipo desconocido o mensaje vacío ⇒ InvalidFieldValueError', async () => {
    const base = { userId: ADMIN, message: 'zz' };
    for (const modelType of ['Review', 'Question']) {
      await expect(
        createAbusiveReport({ ...base, modelType, modelId: 999_999 })
      ).rejects.toBeInstanceOf(RecordNotFoundError);
    }
    await expect(
      createAbusiveReport({ ...base, modelType: 'Product', modelId: 1 })
    ).rejects.toBeInstanceOf(InvalidFieldValueError);
    await expect(
      createAbusiveReport({ ...base, modelType: 'Review', modelId: 84, message: '' })
    ).rejects.toBeInstanceOf(InvalidFieldValueError);
  });

  it('reporta una pregunta existente (US-55)', async () => {
    const created = await createAbusiveReport({
      userId: ADMIN,
      modelType: 'Question',
      modelId: 68,
      message: 'zz-report-question',
    });
    expect(created).toMatchObject({ modelType: 'Question', modelId: 68 });
  });
});

describe('updateAbusiveReport / deleteAbusiveReport', () => {
  it('edita el mensaje con updatedAt, borra y devuelve la fila', async () => {
    try {
      const created = await createAbusiveReport({
        userId: ADMIN,
        modelType: 'Review',
        modelId: 84,
        message: 'zz-report-editar',
      });
      const future = new Date(Date.now() + 60_000);
      _setNowProvider(() => future);
      const updated = await updateAbusiveReport(created.id, { message: 'zz-editado' });
      expect(updated.message).toBe('zz-editado');
      expect(updated.updatedAt.getTime()).toBe(future.getTime());
      await expect(updateAbusiveReport(created.id, { message: '' })).rejects.toBeInstanceOf(
        InvalidFieldValueError
      );

      expect((await deleteAbusiveReport(created.id)).message).toBe('zz-editado');
      await expect(deleteAbusiveReport(created.id)).rejects.toBeInstanceOf(RecordNotFoundError);
      await expect(updateAbusiveReport(999_999, { message: 'x' })).rejects.toBeInstanceOf(
        RecordNotFoundError
      );
    } finally {
      _setNowProvider(() => new Date());
    }
  });
});
