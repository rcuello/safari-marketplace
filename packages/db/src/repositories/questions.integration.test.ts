/**
 * Test de integración contra el Postgres real (sembrado por `just db-up`:
 * 68 preguntas, ids 68→1; usuario 2 → 54 y usuario 4 → 14; el producto 1
 * tiene 6, tres de ellas sobre «apple»). US-55.
 *
 * Las escrituras son del admin (3), sin preguntas en el seed; se borran en
 * `beforeAll`/`afterAll`. Las preguntas del seed no se modifican.
 */

import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../client';
import { _setNowProvider } from '../clock';
import { InvalidFieldValueError, RecordNotFoundError } from '../domain-errors';
import {
  answerQuestion,
  createQuestion,
  deleteQuestion,
  findQuestionById,
  listQuestions,
  listUserQuestions,
  updateQuestionText,
} from './questions.repository';

const CUSTOMER = 2;
const ADMIN = 3;
const CUSTOMER2 = 4;

const cleanup = async () => {
  await prisma.abusiveReport.deleteMany({ where: { userId: ADMIN } });
  await prisma.question.deleteMany({ where: { userId: ADMIN } });
};

beforeAll(cleanup);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe('listQuestions / listUserQuestions / findQuestionById — seed', () => {
  it('68 preguntas en id DESC, 10 por página por defecto', async () => {
    const { items, total } = await listQuestions();
    expect(total).toBe(68);
    expect(items.map((q) => q.id)).toEqual([
      68, 67, 66, 65, 64, 63, 62, 61, 60, 59,
    ]);
  });

  it('filtra por producto, texto (sin distinguir mayúsculas), tienda y type', async () => {
    expect(
      (await listQuestions({ productId: 1 })).items.map((q) => q.id)
    ).toEqual([34, 33, 32, 31, 26, 2]);
    expect(
      (await listQuestions({ productId: 1, question: 'APPLE' })).items.map(
        (q) => q.id
      )
    ).toEqual([34, 31, 26]);
    expect((await listQuestions({ shopId: 6 })).total).toBe(39);
    const typed = await listQuestions({ typeSlug: 'grocery', limit: 100 });
    expect(typed.items.every((q) => q.product.type.slug === 'grocery')).toBe(
      true
    );
  });

  it('por usuario, created_at DESC con 8 por página', async () => {
    const mine = await listUserQuestions(CUSTOMER);
    expect(mine.total).toBe(54);
    expect(mine.items).toHaveLength(8);
    const stamps = mine.items.map((q) => q.createdAt.getTime());
    expect(stamps).toEqual([...stamps].sort((a, b) => b - a));
    expect((await listUserQuestions(CUSTOMER2)).total).toBe(14);
    expect((await listUserQuestions(ADMIN)).total).toBe(0);
  });

  it('el detalle trae autor, producto hidratado y contadores; desconocida ⇒ null', async () => {
    const q68 = await findQuestionById(68);
    expect(q68?.user.email).toBe('customer@demo.com');
    expect(q68?.product.id).toBe(q68?.productId);
    expect(q68).toMatchObject({
      abusiveReportsCount: 0,
      positiveFeedbacksCount: 0,
    });
    expect(q68?.createdAt.toISOString()).toBe('2022-03-18T10:19:46.000Z');
    expect(q68?.updatedAt.toISOString()).toBe('2022-03-18T10:20:42.000Z');
    expect(await findQuestionById(999_999)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Escrituras — NO INSERTAR LECTURAS DEL SEED DEBAJO DE ESTA LÍNEA.
// ---------------------------------------------------------------------------

async function shopOf(productId: number): Promise<number> {
  const p = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { shopId: true },
  });
  return Number(p.shopId);
}

describe('createQuestion', () => {
  it('nace sin respuesta; dos preguntas del mismo usuario sobre el mismo producto son válidas', async () => {
    const shopId = await shopOf(2);
    const a = await createQuestion({
      userId: ADMIN,
      productId: 2,
      shopId,
      question: 'zz-q-1',
    });
    const b = await createQuestion({
      userId: ADMIN,
      productId: 2,
      shopId,
      question: 'zz-q-2',
    });
    expect(a).toMatchObject({
      answer: null,
      userId: ADMIN,
      abusiveReportsCount: 0,
    });
    expect(b.id).not.toBe(a.id);
  });

  it('producto inexistente ⇒ RecordNotFoundError; tienda ajena o texto vacío ⇒ InvalidFieldValueError', async () => {
    await expect(
      createQuestion({
        userId: ADMIN,
        productId: 999_999,
        shopId: 1,
        question: 'zz',
      })
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(
      createQuestion({
        userId: ADMIN,
        productId: 2,
        shopId: 999,
        question: 'zz',
      })
    ).rejects.toBeInstanceOf(InvalidFieldValueError);
    await expect(
      createQuestion({
        userId: ADMIN,
        productId: 2,
        shopId: await shopOf(2),
        question: '',
      })
    ).rejects.toBeInstanceOf(InvalidFieldValueError);
  });
});

describe('answerQuestion / updateQuestionText / deleteQuestion', () => {
  it('responder persiste answer y avanza updatedAt; editar el texto no toca la respuesta', async () => {
    try {
      const q = await createQuestion({
        userId: ADMIN,
        productId: 3,
        shopId: await shopOf(3),
        question: 'zz-q-responder',
      });
      const future = new Date(Date.now() + 60_000);
      _setNowProvider(() => future);
      const answered = await answerQuestion(q.id, { answer: 'zz-respuesta' });
      expect(answered).toMatchObject({
        answer: 'zz-respuesta',
        question: 'zz-q-responder',
      });
      expect(answered.updatedAt.getTime()).toBe(future.getTime());

      const edited = await updateQuestionText(q.id, 'zz-q-editada');
      expect(edited).toMatchObject({
        question: 'zz-q-editada',
        answer: 'zz-respuesta',
      });
      await expect(updateQuestionText(q.id, '')).rejects.toBeInstanceOf(
        InvalidFieldValueError
      );
      await expect(
        answerQuestion(999_999, { answer: 'x' })
      ).rejects.toBeInstanceOf(RecordNotFoundError);
    } finally {
      _setNowProvider(() => new Date());
    }
  });

  it('borra la pregunta con sus reportes y la devuelve', async () => {
    const q = await createQuestion({
      userId: ADMIN,
      productId: 4,
      shopId: await shopOf(4),
      question: 'zz-q-borrar',
    });
    await prisma.abusiveReport.create({
      data: {
        userId: ADMIN,
        modelType: 'Question',
        modelId: q.id,
        message: 'zz',
      },
    });
    expect((await findQuestionById(q.id))?.abusiveReportsCount).toBe(1);
    expect((await deleteQuestion(q.id)).question).toBe('zz-q-borrar');
    expect(await findQuestionById(q.id)).toBeNull();
    expect(
      await prisma.abusiveReport.count({
        where: { modelType: 'Question', modelId: q.id },
      })
    ).toBe(0);
    await expect(deleteQuestion(q.id)).rejects.toBeInstanceOf(
      RecordNotFoundError
    );
  });
});
