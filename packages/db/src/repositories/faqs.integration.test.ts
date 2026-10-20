/**
 * Test de integración contra el Postgres real (sembrado por `just db-up`:
 * 19 FAQ, 5 globales y 2 por cada tienda 1..7). Lectura y escritura (US-47).
 *
 * Las escrituras usan el centinela `zz-faqs-` en el título, que `generateSlug`
 * lleva al slug. Las lecturas van ANTES que las escrituras: asertan conteos
 * del seed y vitest corre los `describe` de un archivo en orden.
 */

import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { _setNowProvider } from '../clock';
import { prisma } from '../client';
import {
  EmptySlugError,
  InvalidReferenceError,
  RecordNotFoundError,
} from '../domain-errors';
import {
  GLOBAL_CONTENT_ISSUER,
  createFaq,
  deleteFaq,
  findFaqById,
  listFaqs,
  updateFaq,
} from './faqs.repository';

const SENTINEL_PREFIX = 'zz-faqs-';

const cleanup = () =>
  prisma.faq.deleteMany({ where: { slug: { startsWith: SENTINEL_PREFIX } } });

beforeAll(cleanup); // corrida abortada previa

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe('listFaqs — seed', () => {
  it('lista las 19, id asc, 10 por página por defecto, JSON-safe', async () => {
    const { items, total } = await listFaqs();
    expect(total).toBe(19);
    expect(items.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(() => JSON.stringify(items)).not.toThrow();
  });

  it('las 5 globales no tienen tienda y las emite el super admin', async () => {
    const { items, total } = await listFaqs({
      faqType: 'global',
      issuedBy: GLOBAL_CONTENT_ISSUER,
      limit: 100,
    });
    expect(total).toBe(5);
    expect(items.map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
    expect(items.every((r) => r.shopId === null)).toBe(true);
  });

  it('shop_id derivado de issued_by: la tienda 1 tiene las FAQ 6 y 7', async () => {
    const { items } = await listFaqs({
      shopId: 1,
      faqType: 'shop',
      issuedBy: 'Furniture Shop',
    });
    expect(items.map((r) => r.id)).toEqual([6, 7]);
  });

  it('issued_by es igualdad exacta, no parcial', async () => {
    expect((await listFaqs({ issuedBy: 'Furniture' })).total).toBe(0);
  });

  it('filtra por título case-insensitive', async () => {
    const { items } = await listFaqs({ title: 'DELIVERY PROCESS', limit: 100 });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((r) => /delivery process/i.test(r.faqTitle))).toBe(true);
  });
});

describe('findFaqById', () => {
  it('devuelve la FAQ 7 con su tienda', async () => {
    const row = await findFaqById(7);
    expect(row?.shopId).toBe(1);
    expect(row?.faqType).toBe('shop');
  });

  it('devuelve null si no existe', async () => {
    expect(await findFaqById(999_999)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Escrituras — NO INSERTAR LECTURAS DEL SEED DEBAJO DE ESTA LÍNEA.
// ---------------------------------------------------------------------------

describe('createFaq — tipo y emisor derivados de la tienda', () => {
  it('sin tienda: global, emitida por el super admin, con autor', async () => {
    const created = await createFaq({
      faqTitle: `${SENTINEL_PREFIX}Global Nueva`,
      faqDescription: 'cuerpo',
      userId: 3,
    });
    expect(created.slug).toBe(`${SENTINEL_PREFIX}global-nueva`);
    expect(created.faqType).toBe('global');
    expect(created.issuedBy).toBe(GLOBAL_CONTENT_ISSUER);
    expect(created.shopId).toBeNull();
    expect(created.userId).toBe(3);
    expect((await findFaqById(created.id))?.slug).toBe(created.slug);
  });

  it('con tienda: de tienda, emitida con el nombre de la tienda', async () => {
    const created = await createFaq({
      faqTitle: `${SENTINEL_PREFIX}De Tienda`,
      faqDescription: 'cuerpo',
      shopId: 2,
    });
    expect(created.faqType).toBe('shop');
    expect(created.shopId).toBe(2);
    const shop = await prisma.shop.findUnique({ where: { id: 2 } });
    expect(created.issuedBy).toBe(shop?.name);
  });

  it('tienda inexistente o id mal formado ⇒ InvalidReferenceError, sin escribir', async () => {
    for (const shopId of [999_999, Number.NaN, 1e21]) {
      await expect(
        createFaq({
          faqTitle: `${SENTINEL_PREFIX}Tienda Rota`,
          faqDescription: 'x',
          shopId,
        })
      ).rejects.toBeInstanceOf(InvalidReferenceError);
    }
    expect(
      await prisma.faq.count({ where: { slug: { startsWith: `${SENTINEL_PREFIX}tienda-rota` } } })
    ).toBe(0);
  });

  it('título repetido ⇒ slug con sufijo, no colisión', async () => {
    const a = await createFaq({ faqTitle: `${SENTINEL_PREFIX}Repetida`, faqDescription: 'x' });
    const b = await createFaq({ faqTitle: `${SENTINEL_PREFIX}Repetida`, faqDescription: 'x' });
    expect(b.slug).not.toBe(a.slug);
    expect(b.slug.startsWith(a.slug)).toBe(true);
  });
});

describe('updateFaq', () => {
  it('cambia título y descripción, no el slug, y fija updatedAt desde clock.ts', async () => {
    try {
      const created = await createFaq({
        faqTitle: `${SENTINEL_PREFIX}Original`,
        faqDescription: 'antes',
      });
      const future = new Date(Date.now() + 60_000);
      _setNowProvider(() => future);

      const updated = await updateFaq(created.id, {
        faqTitle: `${SENTINEL_PREFIX}Renombrada`,
        faqDescription: 'despues',
      });

      expect(updated.faqTitle).toBe(`${SENTINEL_PREFIX}Renombrada`);
      expect(updated.faqDescription).toBe('despues');
      expect(updated.slug).toBe(`${SENTINEL_PREFIX}original`);
      expect(updated.updatedAt.getTime()).toBe(future.getTime());
    } finally {
      _setNowProvider(() => new Date());
    }
  });

  it('título que normaliza a vacío ⇒ EmptySlugError', async () => {
    const created = await createFaq({ faqTitle: `${SENTINEL_PREFIX}Vacia`, faqDescription: 'x' });
    await expect(updateFaq(created.id, { faqTitle: '???' })).rejects.toBeInstanceOf(
      EmptySlugError
    );
  });

  it('id inexistente ⇒ RecordNotFoundError', async () => {
    await expect(updateFaq(999_999, { faqDescription: 'x' })).rejects.toBeInstanceOf(
      RecordNotFoundError
    );
  });
});

describe('deleteFaq', () => {
  it('borra y devuelve la fila borrada', async () => {
    const created = await createFaq({ faqTitle: `${SENTINEL_PREFIX}Borrar`, faqDescription: 'x' });
    const deleted = await deleteFaq(created.id);
    expect(deleted.id).toBe(created.id);
    expect(await findFaqById(created.id)).toBeNull();
  });

  it('id inexistente ⇒ RecordNotFoundError', async () => {
    await expect(deleteFaq(999_999)).rejects.toBeInstanceOf(RecordNotFoundError);
  });
});
