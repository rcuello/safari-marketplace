/**
 * questions.repository.ts — preguntas sobre productos (US-55).
 *
 * Mismo agregado de lectura que las reseñas: cada lectura devuelve
 * `QuestionDetailRecord`, con el autor (`UserRecord`), el producto hidratado
 * (`ProductRecord`) y `abusiveReportsCount` (un `groupBy` por página, sin
 * N+1). La búsqueda por texto es `contains` + `insensitive` (ILIKE), que
 * usa `questions_question_ilike_trgm_idx`, trigram sobre la columna (US-69).
 *
 * El CHECK `length(question) > 0` no existe para Prisma: se valida aquí con
 * `InvalidFieldValueError`. Sin UNIQUE: un usuario puede preguntar varias
 * veces sobre el mismo producto.
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
  _toQuestionRecord,
  _toUserRecord,
  type QuestionRecord,
  type UserRecord,
} from '../records';
import { _countReports } from './abusive-reports.repository';
import {
  _toProductRecord,
  PRODUCT_INCLUDE,
  type ProductRecord,
} from './products.repository';

export interface QuestionDetailRecord extends QuestionRecord {
  user: UserRecord;
  product: ProductRecord;
  abusiveReportsCount: number;
}

const QUESTION_INCLUDE = {
  user: true,
  product: { include: PRODUCT_INCLUDE },
} satisfies Prisma.QuestionInclude;

type QuestionPayload = Prisma.QuestionGetPayload<{
  include: typeof QUESTION_INCLUDE;
}>;

/** Un producto que se está borrando en cascada descarta la fila (como `listProducts`). */
async function _toDetails(
  rows: QuestionPayload[]
): Promise<QuestionDetailRecord[]> {
  const counts = await _countReports(
    'Question',
    rows.map((r) => r.id)
  );
  const details: QuestionDetailRecord[] = [];
  for (const row of rows) {
    const product = _toProductRecord(row.product);
    if (!product) continue;
    const record = _toQuestionRecord(row);
    details.push({
      ...record,
      user: _toUserRecord(row.user),
      product,
      abusiveReportsCount: counts.get(record.id) ?? 0,
    });
  }
  return details;
}

async function _page(
  where: Prisma.QuestionWhereInput,
  orderBy: Prisma.QuestionOrderByWithRelationInput[],
  page: number,
  limit: number
): Promise<{ items: QuestionDetailRecord[]; total: number }> {
  const [rows, total] = await Promise.all([
    prisma.question.findMany({
      where,
      orderBy,
      include: QUESTION_INCLUDE,
      skip: (Math.max(1, page) - 1) * limit,
      take: limit,
    }),
    prisma.question.count({ where }),
  ]);
  return { items: await _toDetails(rows), total };
}

export interface ListQuestionsInput {
  productId?: number;
  shopId?: number;
  /** Texto parcial de la pregunta, case-insensitive. */
  question?: string;
  /** Slug del type del producto (`search=type.slug:<x>` del admin). */
  typeSlug?: string;
  page?: number;
  limit?: number;
}

/** Paginado en `id DESC` (`limit` 10 por defecto); filtros combinados con AND. */
export function listQuestions(
  input: ListQuestionsInput = {}
): Promise<{ items: QuestionDetailRecord[]; total: number }> {
  const where: Prisma.QuestionWhereInput = {
    ...(input.productId !== undefined && { productId: input.productId }),
    ...(input.shopId !== undefined && { shopId: input.shopId }),
    ...(input.question && {
      question: { contains: input.question, mode: 'insensitive' as const },
    }),
    ...(input.typeSlug && { product: { type: { slug: input.typeSlug } } }),
  };
  return _page(where, [{ id: 'desc' }], input.page ?? 1, input.limit ?? 10);
}

/** Las preguntas de un usuario, más recientes primero (`limit` 8 por defecto). */
export function listUserQuestions(
  userId: number,
  input: { page?: number; limit?: number } = {}
): Promise<{ items: QuestionDetailRecord[]; total: number }> {
  return _page(
    { userId },
    [{ createdAt: 'desc' }, { id: 'desc' }],
    input.page ?? 1,
    input.limit ?? 8
  );
}

export async function findQuestionById(
  id: number
): Promise<QuestionDetailRecord | null> {
  const row = await prisma.question.findUnique({
    where: { id },
    include: QUESTION_INCLUDE,
  });
  if (!row) return null;
  return (await _toDetails([row]))[0] ?? null;
}

function _assertText(field: 'question', value: string | undefined): void {
  if (value !== undefined && !(typeof value === 'string' && value.length > 0)) {
    throw new InvalidFieldValueError(
      'questions',
      field,
      value,
      'questions_question_check'
    );
  }
}

export interface CreateQuestionInput {
  userId: number;
  productId: number;
  shopId: number;
  question: string;
}

/**
 * Nace sin respuesta. El producto debe existir (404) y `shopId` debe ser SU
 * tienda (400), como en las reseñas.
 */
export async function createQuestion(
  input: CreateQuestionInput
): Promise<QuestionDetailRecord> {
  _assertText('question', input.question ?? '');
  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    select: { shopId: true },
  });
  if (!product) {
    throw new RecordNotFoundError('products', input.productId);
  }
  if (Number(product.shopId) !== input.shopId) {
    throw new InvalidFieldValueError(
      'questions',
      'shop_id',
      input.shopId,
      `tienda del producto ${input.productId}`
    );
  }
  try {
    const row = await prisma.question.create({
      data: {
        userId: input.userId,
        productId: input.productId,
        shopId: input.shopId,
        question: input.question,
        answer: null,
      },
      include: QUESTION_INCLUDE,
    });
    return (await _toDetails([row]))[0];
  } catch (error) {
    throw translateCatalogWriteError(error, { aggregate: 'questions' });
  }
}

async function _update(
  id: number,
  data: Prisma.QuestionUpdateInput
): Promise<QuestionDetailRecord> {
  try {
    const row = await prisma.question.update({
      where: { id },
      data: { ...data, updatedAt: now() },
      include: QUESTION_INCLUDE,
    });
    return (await _toDetails([row]))[0];
  } catch (error) {
    throw translateCatalogWriteError(error, { aggregate: 'questions', id });
  }
}

/** Responder (admin o dueño de la tienda). `question` solo cambia si llega. */
export async function answerQuestion(
  id: number,
  input: { answer: string | null; question?: string }
): Promise<QuestionDetailRecord> {
  _assertText('question', input.question);
  return _update(id, {
    answer: input.answer,
    ...(input.question !== undefined && { question: input.question }),
  });
}

/** El autor edita el texto de su pregunta; la respuesta no se toca. */
export async function updateQuestionText(
  id: number,
  question: string
): Promise<QuestionDetailRecord> {
  _assertText('question', question ?? '');
  return _update(id, { question });
}

/**
 * Borra la pregunta y la devuelve con su detalle. Sus reportes de abuso no
 * caen por FK (es polimórfica): se borran en la misma transacción, igual que
 * con las reseñas.
 */
export async function deleteQuestion(
  id: number
): Promise<QuestionDetailRecord> {
  const existing = await findQuestionById(id);
  if (!existing) {
    throw new RecordNotFoundError('questions', id);
  }
  try {
    await prisma.$transaction([
      prisma.abusiveReport.deleteMany({
        where: { modelType: 'Question', modelId: id },
      }),
      prisma.question.delete({ where: { id } }),
    ]);
    return existing;
  } catch (error) {
    throw translateCatalogWriteError(error, { aggregate: 'questions', id });
  }
}
