/**
 * faqs.repository.ts — preguntas frecuentes, globales o de una tienda (US-47).
 *
 * Calco de `tags.repository.ts` con una regla propia: `faqType` e `issuedBy`
 * NO los elige quien escribe, se derivan de `shopId`. El admin solo envía
 * `{faq_title, faq_description, shop_id?}` (`faqs-form.tsx:90-109`) y el shop
 * filtra por `issued_by` con el nombre EXACTO de la tienda, así que dejarlos
 * libres permitiría una FAQ de tienda que su propia página no encuentra. Por
 * eso el CHECK `faqs_faq_type_check` nunca puede violarse desde aquí.
 *
 * `faqs.shop_id` es `ON DELETE CASCADE` y nada referencia a `faqs`:
 * `deleteFaq` no cuenta dependientes (precedente `deleteTag`).
 */

import type { Prisma } from '../../generated/prisma/client/client';
import { prisma } from '../client';
import { now } from '../clock';
import {
  InvalidReferenceError,
  RecordNotFoundError,
  translateCatalogWriteError,
} from '../domain-errors';
import { _toFaqRecord, type FaqRecord } from '../records';
import { type ExistingSlugLookup, generateSlug, normalizeSlug } from '../slug';

/** Emisor de todo contenido global: el único rol que pasa el guard de escritura. */
export const GLOBAL_CONTENT_ISSUER = 'Super Admin';

export interface ListFaqsInput {
  shopId?: number;
  /** `global` | `shop`, igualdad exacta. */
  faqType?: string;
  /** Igualdad exacta: el shop envía el nombre de la tienda tal cual. */
  issuedBy?: string;
  /** Búsqueda parcial por título, case-insensitive. */
  title?: string;
  /** 1-based. Default 1. */
  page?: number;
  /** Default 10, como el mock. */
  limit?: number;
}

/**
 * Listado paginado. `orderBy: { id: 'asc' }` preserva el orden del mock
 * (`faqs.json` va 1..19).
 */
export async function listFaqs(input: ListFaqsInput = {}): Promise<{
  items: FaqRecord[];
  total: number;
}> {
  const page = Math.max(1, input.page ?? 1);
  const limit = input.limit ?? 10;
  const where: Prisma.FaqWhereInput = {
    ...(input.shopId !== undefined && { shopId: input.shopId }),
    ...(input.faqType && { faqType: input.faqType }),
    ...(input.issuedBy && { issuedBy: input.issuedBy }),
    ...(input.title && {
      faqTitle: { contains: input.title, mode: 'insensitive' as const },
    }),
  };

  const [rows, total] = await Promise.all([
    prisma.faq.findMany({
      where,
      orderBy: { id: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.faq.count({ where }),
  ]);

  return { items: rows.map(_toFaqRecord), total };
}

/** Una FAQ por id. `null` si no existe. */
export async function findFaqById(id: number): Promise<FaqRecord | null> {
  const row = await prisma.faq.findUnique({ where: { id } });
  return row ? _toFaqRecord(row) : null;
}

// ---------------------------------------------------------------------------
// Escritura (admin)
// ---------------------------------------------------------------------------

const faqSlugs: ExistingSlugLookup = async (prefix) =>
  (
    await prisma.faq.findMany({
      where: { slug: { startsWith: prefix } },
      select: { slug: true },
    })
  ).map((r) => r.slug);

export interface CreateFaqInput {
  faqTitle: string;
  faqDescription: string;
  /** Con tienda ⇒ `faqType='shop'` e `issuedBy` = su nombre; sin ella, global. */
  shopId?: number | null;
  /** Autor (usuario del token). */
  userId?: number | null;
  /** Ausente ⇒ `DEFAULT 'es'`. */
  language?: string;
}

/** Título, descripción e idioma: el tipo y la tienda no cambian tras crear. */
export type UpdateFaqInput = Partial<
  Pick<CreateFaqInput, 'faqTitle' | 'faqDescription' | 'language'>
>;

/**
 * Resuelve el emisor desde la tienda. Una tienda inexistente o un id mal
 * formado da `InvalidReferenceError` (400) antes de escribir, en vez de un
 * P2003 que dejaría `issuedBy` sin resolver.
 */
export async function resolveContentIssuer(
  aggregate: string,
  shopId: number | null | undefined
): Promise<{
  type: 'global' | 'shop';
  issuedBy: string;
  shopId: number | null;
}> {
  if (shopId == null) {
    return { type: 'global', issuedBy: GLOBAL_CONTENT_ISSUER, shopId: null };
  }
  if (!Number.isSafeInteger(shopId) || shopId <= 0) {
    throw new InvalidReferenceError(aggregate, 'shop_id', shopId);
  }
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { name: true },
  });
  if (!shop) {
    throw new InvalidReferenceError(aggregate, 'shop_id', shopId);
  }
  return { type: 'shop', issuedBy: shop.name, shopId };
}

/** Crea una FAQ. El slug sale de `faqTitle` vía `generateSlug`. */
export async function createFaq(input: CreateFaqInput): Promise<FaqRecord> {
  const issuer = await resolveContentIssuer('faqs', input.shopId);
  const slug = await generateSlug({ name: input.faqTitle }, faqSlugs, 'faqs');

  try {
    const row = await prisma.faq.create({
      data: {
        faqTitle: input.faqTitle,
        slug,
        faqDescription: input.faqDescription,
        faqType: issuer.type,
        issuedBy: issuer.issuedBy,
        shopId: issuer.shopId,
        ...(input.userId != null && { userId: input.userId }),
        ...(input.language !== undefined && { language: input.language }),
      },
    });
    return _toFaqRecord(row);
  } catch (error) {
    throw translateCatalogWriteError(error, { aggregate: 'faqs' });
  }
}

/**
 * Actualiza una FAQ. El `slug` es inmutable (precedente `updateTag`); un
 * `faqTitle` que normaliza a slug vacío da `EmptySlugError`, igual que allí.
 * `updatedAt: now()` explícito: ninguna tabla tiene trigger (US-32).
 */
export async function updateFaq(
  id: number,
  input: UpdateFaqInput
): Promise<FaqRecord> {
  if (input.faqTitle !== undefined) {
    await normalizeSlug(input.faqTitle, 'faqs');
  }

  try {
    const row = await prisma.faq.update({
      where: { id },
      data: {
        ...(input.faqTitle !== undefined && { faqTitle: input.faqTitle }),
        ...(input.faqDescription !== undefined && {
          faqDescription: input.faqDescription,
        }),
        ...(input.language !== undefined && { language: input.language }),
        updatedAt: now(),
      },
    });
    return _toFaqRecord(row);
  } catch (error) {
    throw translateCatalogWriteError(error, { aggregate: 'faqs', id });
  }
}

/** Borra una FAQ y devuelve la fila borrada (find-then-delete, como `deleteTag`). */
export async function deleteFaq(id: number): Promise<FaqRecord> {
  const existing = await prisma.faq.findUnique({ where: { id } });
  if (!existing) {
    throw new RecordNotFoundError('faqs', id);
  }

  try {
    await prisma.faq.delete({ where: { id } });
    return _toFaqRecord(existing);
  } catch (error) {
    throw translateCatalogWriteError(error, { aggregate: 'faqs', id });
  }
}
