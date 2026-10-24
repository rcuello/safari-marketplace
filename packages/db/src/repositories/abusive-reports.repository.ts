/**
 * abusive-reports.repository.ts — reportes de abuso (US-54).
 *
 * Polimórfica: `(modelType, modelId)` apunta a una reseña o (desde US-55) a
 * una pregunta, sin FK. `assertReportableExists` valida el objeto antes de
 * escribir. Un reporte por usuario y objeto: el `P2002` del UNIQUE llega
 * como `SlugConflictError` (409).
 *
 * Las lecturas traen el autor (`UserRecord`).
 */

import type { Prisma } from '../../generated/prisma/client/client';
import { prisma } from '../client';
import { now } from '../clock';
import {
  InvalidFieldValueError,
  RecordNotFoundError,
  translateCatalogWriteError,
} from '../domain-errors';
import {
  _toAbusiveReportRecord,
  _toUserRecord,
  type AbusiveReportRecord,
  type UserRecord,
} from '../records';

/** Valores del CHECK `abusive_reports_model_type_check`. */
export const REPORTABLE_MODEL_TYPES = ['Review', 'Question'] as const;

export interface AbusiveReportDetailRecord extends AbusiveReportRecord {
  user: UserRecord;
}

const REPORT_INCLUDE = { user: true } satisfies Prisma.AbusiveReportInclude;

type ReportPayload = Prisma.AbusiveReportGetPayload<{ include: typeof REPORT_INCLUDE }>;

function _toDetail(row: ReportPayload): AbusiveReportDetailRecord {
  return { ..._toAbusiveReportRecord(row), user: _toUserRecord(row.user) };
}

/** Todos los reportes, `id DESC` (moderación del admin). */
export async function listAbusiveReports(): Promise<AbusiveReportDetailRecord[]> {
  const rows = await prisma.abusiveReport.findMany({
    orderBy: { id: 'desc' },
    include: REPORT_INCLUDE,
  });
  return rows.map(_toDetail);
}

/** Los reportes de un usuario, más recientes primero (`/my-reports`). */
export async function listAbusiveReportsByUser(userId: number): Promise<AbusiveReportDetailRecord[]> {
  const rows = await prisma.abusiveReport.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: REPORT_INCLUDE,
  });
  return rows.map(_toDetail);
}

export async function findAbusiveReportById(id: number): Promise<AbusiveReportDetailRecord | null> {
  const row = await prisma.abusiveReport.findUnique({ where: { id }, include: REPORT_INCLUDE });
  return row ? _toDetail(row) : null;
}

/**
 * Reportes por objeto, en UNA consulta (la tabla es polimórfica y no hay
 * relación para `_count`). Interno del paquete: lo usan los repositorios de
 * reseñas y preguntas para su `abusiveReportsCount`.
 */
export async function _countReports(
  modelType: (typeof REPORTABLE_MODEL_TYPES)[number],
  ids: bigint[]
): Promise<Map<number, number>> {
  if (ids.length === 0) return new Map();
  const groups = await prisma.abusiveReport.groupBy({
    by: ['modelId'],
    where: { modelType, modelId: { in: ids } },
    _count: { _all: true },
  });
  return new Map(groups.map((g) => [Number(g.modelId), g._count._all]));
}

/** El objeto reportado debe existir: una reseña (US-54) o una pregunta (US-55). */
export async function assertReportableExists(modelType: string, modelId: number): Promise<void> {
  switch (modelType) {
    case 'Review': {
      const review = await prisma.review.findUnique({ where: { id: modelId }, select: { id: true } });
      if (!review) throw new RecordNotFoundError('reviews', modelId);
      return;
    }
    case 'Question': {
      const question = await prisma.question.findUnique({ where: { id: modelId }, select: { id: true } });
      if (!question) throw new RecordNotFoundError('questions', modelId);
      return;
    }
    default:
      throw new InvalidFieldValueError(
        'abusive_reports',
        'model_type',
        modelType,
        'abusive_reports_model_type_check'
      );
  }
}

function _assertMessage(message: string | undefined): void {
  if (message !== undefined && !(typeof message === 'string' && message.length > 0)) {
    throw new InvalidFieldValueError(
      'abusive_reports',
      'message',
      message,
      'abusive_reports_message_check'
    );
  }
}

function _translate(error: unknown, id?: number): unknown {
  return translateCatalogWriteError(error, {
    aggregate: 'abusive_reports',
    id,
    uniqueField: 'user_id, model_type, model_id',
  });
}

export interface CreateAbusiveReportInput {
  userId: number;
  /** Nombre corto: 'Review' | 'Question'. */
  modelType: string;
  modelId: number;
  message: string;
}

export async function createAbusiveReport(
  input: CreateAbusiveReportInput
): Promise<AbusiveReportDetailRecord> {
  _assertMessage(input.message ?? '');
  await assertReportableExists(input.modelType, input.modelId);
  try {
    const row = await prisma.abusiveReport.create({
      data: {
        userId: input.userId,
        modelType: input.modelType,
        modelId: input.modelId,
        message: input.message,
      },
      include: REPORT_INCLUDE,
    });
    return _toDetail(row);
  } catch (error) {
    throw _translate(error);
  }
}

/** Solo el mensaje; fija `updatedAt: now()` (US-32). */
export async function updateAbusiveReport(
  id: number,
  input: { message?: string }
): Promise<AbusiveReportDetailRecord> {
  _assertMessage(input.message);
  try {
    const row = await prisma.abusiveReport.update({
      where: { id },
      data: {
        ...(input.message !== undefined && { message: input.message }),
        updatedAt: now(),
      },
      include: REPORT_INCLUDE,
    });
    return _toDetail(row);
  } catch (error) {
    throw _translate(error, id);
  }
}

export async function deleteAbusiveReport(id: number): Promise<AbusiveReportDetailRecord> {
  try {
    return _toDetail(await prisma.abusiveReport.delete({ where: { id }, include: REPORT_INCLUDE }));
  } catch (error) {
    throw _translate(error, id);
  }
}

/**
 * Rechazar (US-65): borra TODOS los reportes de un objeto y deja el objeto
 * intacto; es lo opuesto de «aceptar», que borra la reseña con sus
 * reportes. Devuelve cuántos borró (0 si no tenía: idempotente). El objeto
 * debe existir; si no, `RecordNotFoundError` sin borrar nada. Como la fila
 * desaparece, el UNIQUE deja volver a reportarlo (DD-2).
 */
export async function rejectAbusiveReports(modelType: string, modelId: number): Promise<number> {
  await assertReportableExists(modelType, modelId);
  const { count } = await prisma.abusiveReport.deleteMany({ where: { modelType, modelId } });
  return count;
}
