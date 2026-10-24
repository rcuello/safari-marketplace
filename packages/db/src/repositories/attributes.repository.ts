/**
 * attributes.repository.ts — atributos de producto y sus valores (US-50).
 *
 * Primer agregado padre-hijo del Épico 46. Dos órdenes distintos que el
 * contrato fija: atributos `id DESC` (el del mock), valores `id ASC` dentro
 * de cada padre. Por eso todo `include` de `values` lleva su `orderBy`
 * explícito, y `_toAttributeRecord` no reordena.
 *
 * Escrituras:
 *   · `createAttribute` es UN nested write (padre + valores), que Prisma ya
 *     ejecuta en una sola transacción: una tienda inexistente (P2003) no deja
 *     valores sueltos.
 *   · `updateAttribute` RECONCILIA los valores con el body del admin, en un
 *     `$transaction` de array (precedente `auth-tokens.repository.ts`): un id
 *     del atributo se actualiza, uno nulo/ausente/no entero es nuevo, y uno
 *     que el body no trae se borra. Un id que pertenece a OTRO atributo da 400,
 *     no se reasigna en silencio.
 *
 * Los slugs se calculan ANTES de la transacción con el `generateSlug` del
 * paquete y un lookup en memoria (los del atributo más los ya asignados en el
 * mismo lote): mismo esquema de sufijos, sin uno nuevo. Dos escrituras
 * concurrentes pueden calcular el mismo slug; el UNIQUE lo convierte en
 * P2002 → `SlugConflictError` (409), como en el resto del paquete.
 */

import type { Prisma } from '../../generated/prisma/client/client';
import { prisma } from '../client';
import { now } from '../clock';
import {
  InvalidReferenceError,
  RecordNotFoundError,
  translateCatalogWriteError,
} from '../domain-errors';
import { _toAttributeRecord, type AttributeRecord } from '../records';
import { type ExistingSlugLookup, generateSlug, normalizeSlug } from '../slug';

/** Los valores siempre en `id ASC` dentro de su atributo. */
const WITH_VALUES = { values: { orderBy: { id: 'asc' as const } } };

export interface ListAttributesInput {
  shopId?: number;
  /** Búsqueda parcial por nombre, case-insensitive. */
  name?: string;
}

/** Todos los atributos, sin paginar (el admin espera un array), `id DESC`. */
export async function listAttributes(
  input: ListAttributesInput = {}
): Promise<AttributeRecord[]> {
  const where: Prisma.AttributeWhereInput = {
    ...(input.shopId !== undefined && { shopId: input.shopId }),
    ...(input.name && {
      name: { contains: input.name, mode: 'insensitive' as const },
    }),
  };
  const rows = await prisma.attribute.findMany({
    where,
    orderBy: { id: 'desc' },
    include: WITH_VALUES,
  });
  return rows.map(_toAttributeRecord);
}

/**
 * Por id si `param` es un entero seguro positivo, si no por slug (el mock
 * aceptaba los dos: `p.id === Number(param) || p.slug === param`).
 */
export async function findAttributeByIdOrSlug(
  param: string
): Promise<AttributeRecord | null> {
  const asId = Number(param);
  const row =
    Number.isSafeInteger(asId) && asId > 0
      ? await prisma.attribute.findUnique({
          where: { id: asId },
          include: WITH_VALUES,
        })
      : await prisma.attribute.findUnique({
          where: { slug: param },
          include: WITH_VALUES,
        });
  return row ? _toAttributeRecord(row) : null;
}

// ---------------------------------------------------------------------------
// Escritura (admin)
// ---------------------------------------------------------------------------

export interface AttributeValueInput {
  /** Del atributo ⇒ se actualiza; null/ausente/no entero ⇒ valor nuevo. */
  id?: number | null;
  value: string;
  meta?: string | null;
  language?: string;
}

export interface CreateAttributeInput {
  name: string;
  shopId: number;
  /** Si llega no vacío, es la fuente del slug; si no, se deriva de `name`. */
  slug?: string | null;
  language?: string;
  values?: AttributeValueInput[];
}

/** El `slug` y la tienda no cambian tras crear. `values` ausente ⇒ no se tocan. */
export interface UpdateAttributeInput {
  name?: string;
  language?: string;
  values?: AttributeValueInput[];
}

const attributeSlugs: ExistingSlugLookup = async (prefix) =>
  (
    await prisma.attribute.findMany({
      where: { slug: { startsWith: prefix } },
      select: { slug: true },
    })
  ).map((r) => r.slug);

/** Un id del body que identifica un valor existente (entero seguro positivo). */
function _existingId(raw: unknown): number | null {
  const id = typeof raw === 'number' ? raw : Number.NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Slugs para los valores nuevos, únicos dentro del atributo: `generateSlug`
 * contra un lookup en memoria que crece con cada asignación del lote.
 */
async function _slugsForNewValues(
  values: AttributeValueInput[],
  takenSlugs: string[]
): Promise<string[]> {
  const taken = new Set(takenSlugs);
  const lookup: ExistingSlugLookup = async (prefix) =>
    [...taken].filter((s) => s.startsWith(prefix));
  const slugs: string[] = [];
  for (const v of values) {
    const slug = await generateSlug(
      { name: v.value },
      lookup,
      'attribute_values'
    );
    taken.add(slug);
    slugs.push(slug);
  }
  return slugs;
}

function _assertShopId(shopId: number): void {
  if (!Number.isSafeInteger(shopId) || shopId <= 0) {
    throw new InvalidReferenceError('attributes', 'shop_id', shopId);
  }
}

/** Crea atributo + valores en un solo nested write (atómico). */
export async function createAttribute(
  input: CreateAttributeInput
): Promise<AttributeRecord> {
  _assertShopId(input.shopId);
  const values = input.values ?? [];
  const slug = await generateSlug(
    { name: input.name, slug: input.slug },
    attributeSlugs,
    'attributes'
  );
  const valueSlugs = await _slugsForNewValues(values, []);

  try {
    const row = await prisma.attribute.create({
      data: {
        name: input.name,
        slug,
        shopId: input.shopId,
        ...(input.language !== undefined && { language: input.language }),
        values: {
          create: values.map((v, i) => ({
            value: v.value,
            slug: valueSlugs[i],
            meta: v.meta ?? null,
            ...(v.language !== undefined && { language: v.language }),
          })),
        },
      },
      include: WITH_VALUES,
    });
    return _toAttributeRecord(row);
  } catch (error) {
    // En un nested write el adaptador no trae `meta.field_name` en el P2003,
    // y el traductor caería en `attributes.desconocida`. La única FK que
    // puede fallar aquí es `shop_id` (la de los valores apunta al padre que se
    // está creando), así que se nombra solo para ese código: un P2002 sigue
    // diciendo `slug`.
    const isForeignKey = (error as { code?: unknown })?.code === 'P2003';
    throw translateCatalogWriteError(error, {
      aggregate: 'attributes',
      ...(isForeignKey && { uniqueField: 'shop_id' }),
    });
  }
}

/**
 * Actualiza el atributo y reconcilia sus valores (ver cabecera). Todo en un
 * `$transaction` de array: o se aplican todas las operaciones o ninguna.
 */
export async function updateAttribute(
  id: number,
  input: UpdateAttributeInput
): Promise<AttributeRecord> {
  if (input.name !== undefined) {
    await normalizeSlug(input.name, 'attributes');
  }

  const existing = await prisma.attribute.findUnique({
    where: { id },
    include: WITH_VALUES,
  });
  if (!existing) {
    throw new RecordNotFoundError('attributes', id);
  }

  const stamp = now();
  const operations: Prisma.PrismaPromise<unknown>[] = [];

  if (input.values !== undefined) {
    const ownIds = new Set(existing.values.map((v) => Number(v.id)));
    const kept: { id: number; input: AttributeValueInput }[] = [];
    const added: AttributeValueInput[] = [];
    for (const v of input.values) {
      const valueId = _existingId(v.id);
      if (valueId === null) {
        added.push(v);
      } else if (ownIds.has(valueId)) {
        kept.push({ id: valueId, input: v });
      } else {
        throw new InvalidReferenceError('attribute_values', 'id', valueId);
      }
    }
    for (const k of kept) {
      await normalizeSlug(k.input.value, 'attribute_values');
    }

    const keptIds = kept.map((k) => k.id);
    const survivingSlugs = existing.values
      .filter((v) => keptIds.includes(Number(v.id)))
      .map((v) => v.slug);
    const addedSlugs = await _slugsForNewValues(added, survivingSlugs);

    operations.push(
      prisma.attributeValue.deleteMany({
        where: { attributeId: id, id: { notIn: keptIds } },
      }),
      ...kept.map((k) =>
        prisma.attributeValue.update({
          where: { id: k.id },
          data: {
            value: k.input.value,
            meta: k.input.meta ?? null,
            ...(k.input.language !== undefined && {
              language: k.input.language,
            }),
            updatedAt: stamp,
          },
        })
      ),
      ...added.map((v, i) =>
        prisma.attributeValue.create({
          data: {
            attributeId: id,
            value: v.value,
            slug: addedSlugs[i],
            meta: v.meta ?? null,
            ...(v.language !== undefined && { language: v.language }),
          },
        })
      )
    );
  }

  operations.push(
    prisma.attribute.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.language !== undefined && { language: input.language }),
        updatedAt: stamp,
      },
    })
  );

  try {
    await prisma.$transaction(operations);
  } catch (error) {
    throw translateCatalogWriteError(error, { aggregate: 'attributes', id });
  }

  const row = await prisma.attribute.findUnique({
    where: { id },
    include: WITH_VALUES,
  });
  if (!row) {
    throw new RecordNotFoundError('attributes', id);
  }
  return _toAttributeRecord(row);
}

/** Borra el atributo (sus valores caen por CASCADE) y lo devuelve con ellos. */
export async function deleteAttribute(id: number): Promise<AttributeRecord> {
  const existing = await prisma.attribute.findUnique({
    where: { id },
    include: WITH_VALUES,
  });
  if (!existing) {
    throw new RecordNotFoundError('attributes', id);
  }

  try {
    await prisma.attribute.delete({ where: { id } });
    return _toAttributeRecord(existing);
  } catch (error) {
    throw translateCatalogWriteError(error, { aggregate: 'attributes', id });
  }
}
