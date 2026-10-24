/**
 * Test de integración contra el Postgres real (sembrado por `just db-up`:
 * 85 reseñas de los usuarios 2, 4 y 5, ids 85→1; 3 reportes del usuario 2
 * sobre las reseñas 1, 21 y 78). US-54.
 *
 * Las escrituras son del admin (3), que el seed deja sin reseñas ni
 * reportes; `beforeAll`/`afterAll` borran todo lo suyo.
 */

import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../client';
import { _setNowProvider } from '../clock';
import {
  InvalidFieldValueError,
  RecordNotFoundError,
  SlugConflictError,
} from '../domain-errors';
import {
  createReview,
  deleteReview,
  findReviewById,
  listReviews,
  updateReview,
} from './reviews.repository';

const ADMIN = 3;

const cleanup = async () => {
  await prisma.abusiveReport.deleteMany({ where: { userId: ADMIN } });
  await prisma.review.deleteMany({ where: { userId: ADMIN } });
};

beforeAll(cleanup);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe('listReviews / findReviewById — seed', () => {
  it('85 reseñas en id DESC, 30 por página por defecto', async () => {
    const { items, total } = await listReviews();
    expect(total).toBe(85);
    expect(items).toHaveLength(30);
    expect(items[0].id).toBe(85);
    expect(items[29].id).toBe(56);
  });

  it('filtra por producto, rating, tienda y type del producto, combinados con AND', async () => {
    expect(
      (await listReviews({ productId: 1 })).items.map((r) => r.id)
    ).toEqual([40, 21, 1]);
    const r5 = await listReviews({ rating: 5, limit: 100 });
    expect(r5.total).toBe(47);
    expect(r5.items.every((r) => r.rating === 5)).toBe(true);
    expect((await listReviews({ shopId: 6 })).total).toBe(49);
    const typed = await listReviews({ typeSlug: 'grocery', limit: 100 });
    expect(typed.items.every((r) => r.product.type.slug === 'grocery')).toBe(
      true
    );
    const combined = await listReviews({ productId: 1, rating: 5 });
    expect(
      combined.items.every((r) => r.productId === 1 && r.rating === 5)
    ).toBe(true);
  });

  it('el detalle trae autor, producto hidratado, fotos con su orden y el conteo de reportes', async () => {
    const r1 = await findReviewById(1);
    expect(r1?.user.email).toBe('customer@demo.com');
    expect(r1?.product.id).toBe(r1?.productId);
    expect(Object.keys((r1?.photos as object[])[0])).toEqual([
      'id',
      'original',
      'thumbnail',
    ]);
    expect(r1).toMatchObject({
      positiveFeedbacksCount: 5,
      negativeFeedbacksCount: 2,
      abusiveReportsCount: 1,
    });
    const r85 = await findReviewById(85);
    expect(r85?.user.email).toBe('customer2@demo.com');
    expect(r85?.abusiveReportsCount).toBe(0);
    expect(r85?.createdAt.toISOString()).toBe('2022-03-18T09:06:12.000Z');
    expect(await findReviewById(999_999)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Escrituras — NO INSERTAR LECTURAS DEL SEED DEBAJO DE ESTA LÍNEA.
// ---------------------------------------------------------------------------

describe('createReview', () => {
  it('crea con la tienda del producto; repetir usuario+producto sin orden ⇒ SlugConflictError', async () => {
    const product = await prisma.product.findUniqueOrThrow({
      where: { id: 2 },
      select: { shopId: true },
    });
    const shopId = Number(product.shopId);
    const created = await createReview({
      userId: ADMIN,
      productId: 2,
      shopId,
      rating: 4,
      comment: 'zz-review',
    });
    expect(created).toMatchObject({
      userId: ADMIN,
      productId: 2,
      rating: 4,
      photos: [],
      abusiveReportsCount: 0,
    });
    expect(created.user.id).toBe(ADMIN);
    await expect(
      createReview({
        userId: ADMIN,
        productId: 2,
        shopId,
        rating: 5,
        comment: 'zz-review-2',
      })
    ).rejects.toBeInstanceOf(SlugConflictError);
    // Con orden distinta sí se admite (una reseña por compra). Desde US-58
    // order_id tiene FK: la 41 es una orden sembrada del admin con el producto 2.
    const conOrden = await createReview({
      userId: ADMIN,
      productId: 2,
      shopId,
      rating: 5,
      comment: 'zz-review-3',
      orderId: 41,
    });
    expect(conOrden.orderId).toBe(41);
  });

  it('producto inexistente ⇒ RecordNotFoundError; tienda ajena o rating fuera de rango ⇒ InvalidFieldValueError', async () => {
    const base = { userId: ADMIN, comment: 'zz-review-mala' };
    await expect(
      createReview({ ...base, productId: 999_999, shopId: 1, rating: 3 })
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(
      createReview({ ...base, productId: 3, shopId: 999, rating: 3 })
    ).rejects.toBeInstanceOf(InvalidFieldValueError);
    for (const rating of [0, 6, 2.5]) {
      await expect(
        createReview({ ...base, productId: 3, shopId: 1, rating })
      ).rejects.toBeInstanceOf(InvalidFieldValueError);
    }
  });
});

describe('updateReview / deleteReview', () => {
  it('edita rating, comentario y fotos, y avanza updatedAt', async () => {
    try {
      const product = await prisma.product.findUniqueOrThrow({
        where: { id: 4 },
        select: { shopId: true },
      });
      const created = await createReview({
        userId: ADMIN,
        productId: 4,
        shopId: Number(product.shopId),
        rating: 2,
        comment: 'zz-review-editar',
      });
      const future = new Date(Date.now() + 60_000);
      _setNowProvider(() => future);
      const photos = [{ thumbnail: 't', original: 'o', id: 9 }];
      const updated = await updateReview(created.id, {
        rating: 5,
        comment: 'zz-editada',
        photos,
      });
      expect(updated).toMatchObject({ rating: 5, comment: 'zz-editada' });
      expect(Object.keys((updated.photos as object[])[0])).toEqual([
        'thumbnail',
        'original',
        'id',
      ]);
      expect(updated.updatedAt.getTime()).toBe(future.getTime());
      await expect(
        updateReview(created.id, { rating: 9 })
      ).rejects.toBeInstanceOf(InvalidFieldValueError);
      await expect(updateReview(999_999, { rating: 3 })).rejects.toBeInstanceOf(
        RecordNotFoundError
      );
    } finally {
      _setNowProvider(() => new Date());
    }
  });

  it('borra la reseña con sus reportes y la devuelve', async () => {
    const product = await prisma.product.findUniqueOrThrow({
      where: { id: 5 },
      select: { shopId: true },
    });
    const created = await createReview({
      userId: ADMIN,
      productId: 5,
      shopId: Number(product.shopId),
      rating: 1,
      comment: 'zz-review-borrar',
    });
    await prisma.abusiveReport.create({
      data: {
        userId: ADMIN,
        modelType: 'Review',
        modelId: created.id,
        message: 'zz',
      },
    });
    expect((await findReviewById(created.id))?.abusiveReportsCount).toBe(1);
    const deleted = await deleteReview(created.id);
    expect(deleted.comment).toBe('zz-review-borrar');
    expect(await findReviewById(created.id)).toBeNull();
    expect(
      await prisma.abusiveReport.count({
        where: { modelType: 'Review', modelId: created.id },
      })
    ).toBe(0);
    await expect(deleteReview(created.id)).rejects.toBeInstanceOf(
      RecordNotFoundError
    );
  });
});
