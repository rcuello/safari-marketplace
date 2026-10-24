/**
 * store-notices.repository.ts — avisos de tienda y su estado de lectura (US-51).
 *
 * Un aviso va dirigido según su `type`:
 *   · all_vendor      → todos los usuarios con permiso `store_owner`;
 *   · specific_vendor → los usuarios de `receivedBy`;
 *   · all_shop        → todas las tiendas;
 *   · specific_shop   → las tiendas de `receivedBy`.
 * Cada usuario destinatario recibe una fila de `store_notice_read` con
 * `is_read = false`; el `is_read` que emite la API es el del usuario que
 * consulta, nunca uno global.
 *
 * Los CHECK de la tabla (`priority`, `type`, vigencia) y los ids de
 * `receivedBy` se validan ANTES de escribir. Crear es un único nested write
 * (atómico); editar reconcilia los pivotes en un `$transaction` de array, y
 * conserva el estado de lectura de quien sigue siendo destinatario.
 */

import type { Prisma } from '../../generated/prisma/client/client';
import { prisma } from '../client';
import { now } from '../clock';
import {
  InvalidFieldValueError,
  InvalidReferenceError,
  RecordNotFoundError,
  translateCatalogWriteError,
} from '../domain-errors';
import {
  _toPermissionRecord,
  _toShopRecord,
  _toStoreNoticeRecord,
  _toUserRecord,
  type StoreNoticeDetailRecord,
} from '../records';

export const STORE_NOTICE_PRIORITIES = ['high', 'medium', 'low'] as const;
export const STORE_NOTICE_TYPES = [
  'all_vendor',
  'specific_vendor',
  'all_shop',
  'specific_shop',
] as const;

/** Columnas por las que el listado puede ordenar (la barra superior pide `updatedAt`). */
export const STORE_NOTICE_SORTABLE = [
  'createdAt',
  'updatedAt',
  'notice',
  'priority',
  'type',
  'expiredAt',
] as const;
export type StoreNoticeSortField = (typeof STORE_NOTICE_SORTABLE)[number];

const DETAIL = {
  creator: {
    include: {
      permissions: {
        include: { permission: true },
        orderBy: { permissionId: 'asc' as const },
      },
    },
  },
  recipients: { include: { user: true }, orderBy: { userId: 'desc' as const } },
  shops: { include: { shop: true }, orderBy: { shopId: 'asc' as const } },
  reads: { include: { user: true }, orderBy: { userId: 'desc' as const } },
} satisfies Prisma.StoreNoticeInclude;

type StoreNoticeWithDetail = Prisma.StoreNoticeGetPayload<{
  include: typeof DETAIL;
}>;

function _toDetail(row: StoreNoticeWithDetail): StoreNoticeDetailRecord {
  return {
    ..._toStoreNoticeRecord(row),
    creator: {
      ..._toUserRecord(row.creator),
      permissions: row.creator.permissions.map((p) =>
        _toPermissionRecord(p.permission)
      ),
    },
    recipients: row.recipients.map((r) => _toUserRecord(r.user)),
    shops: row.shops.map((s) => _toShopRecord(s.shop)),
    reads: row.reads.map((r) => ({
      user: _toUserRecord(r.user),
      isRead: r.isRead,
    })),
  };
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

export interface ListStoreNoticesInput {
  /** Búsqueda parcial por el texto del aviso, case-insensitive. */
  notice?: string;
  /** Avisos dirigidos a este usuario. */
  userId?: number;
  /** Avisos dirigidos a la tienda con este slug. */
  shopSlug?: string;
  /** Avisos dirigidos a la tienda con este id. */
  shopId?: number;
  /** Default `id DESC`, el orden del mock. */
  orderBy?: StoreNoticeSortField;
  sortedBy?: 'asc' | 'desc';
  /** 1-based. Default 1. */
  page?: number;
  /** Default 12, como el mock. */
  limit?: number;
}

export async function listStoreNotices(
  input: ListStoreNoticesInput = {}
): Promise<{ items: StoreNoticeDetailRecord[]; total: number }> {
  const page = Math.max(1, input.page ?? 1);
  const limit = input.limit ?? 12;
  const shopFilter =
    input.shopId !== undefined || input.shopSlug
      ? {
          shops: {
            some: {
              ...(input.shopId !== undefined && { shopId: input.shopId }),
              ...(input.shopSlug && { shop: { slug: input.shopSlug } }),
            },
          },
        }
      : {};
  const where: Prisma.StoreNoticeWhereInput = {
    ...(input.notice && {
      notice: { contains: input.notice, mode: 'insensitive' as const },
    }),
    ...(input.userId !== undefined && {
      recipients: { some: { userId: input.userId } },
    }),
    ...shopFilter,
  };
  const orderBy: Prisma.StoreNoticeOrderByWithRelationInput[] = input.orderBy
    ? [{ [input.orderBy]: input.sortedBy ?? 'desc' }, { id: 'desc' }]
    : [{ id: 'desc' }];

  const [rows, total] = await Promise.all([
    prisma.storeNotice.findMany({
      where,
      orderBy,
      include: DETAIL,
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.storeNotice.count({ where }),
  ]);
  return { items: rows.map(_toDetail), total };
}

/** Un aviso por id con todo su detalle. `null` si no existe. */
export async function findStoreNoticeById(
  id: number
): Promise<StoreNoticeDetailRecord | null> {
  const row = await prisma.storeNotice.findUnique({
    where: { id },
    include: DETAIL,
  });
  return row ? _toDetail(row) : null;
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

export interface CreateStoreNoticeInput {
  priority: string;
  notice: string;
  description?: string | null;
  effectiveFrom?: Date | null;
  expiredAt: Date;
  type: string;
  /** Ids de usuario (`*_vendor`) o de tienda (`*_shop`); se ignora en `all_*`. */
  receivedBy?: number[];
  /** Autor: el usuario del token. */
  createdBy: number;
}

export interface UpdateStoreNoticeInput {
  priority?: string;
  notice?: string;
  description?: string | null;
  effectiveFrom?: Date | null;
  expiredAt?: Date;
  type?: string;
  /** Si llega `type` o `receivedBy`, los destinatarios se recalculan. */
  receivedBy?: number[];
  /** Último editor: el usuario del token. */
  updatedBy: number;
}

function _assertValues(input: {
  priority?: string;
  type?: string;
  effectiveFrom?: Date | null;
  expiredAt?: Date;
}): void {
  if (
    input.priority !== undefined &&
    !(STORE_NOTICE_PRIORITIES as readonly string[]).includes(input.priority)
  ) {
    throw new InvalidFieldValueError(
      'store_notices',
      'priority',
      input.priority,
      'store_notices_priority_check'
    );
  }
  if (
    input.type !== undefined &&
    !(STORE_NOTICE_TYPES as readonly string[]).includes(input.type)
  ) {
    throw new InvalidFieldValueError(
      'store_notices',
      'type',
      input.type,
      'store_notices_type_check'
    );
  }
  for (const [field, value] of [
    ['effective_from', input.effectiveFrom],
    ['expired_at', input.expiredAt],
  ] as const) {
    if (value != null && Number.isNaN(value.getTime())) {
      throw new InvalidFieldValueError(
        'store_notices',
        field,
        'fecha inválida',
        'timestamptz'
      );
    }
  }
}

function _assertVigencia(
  effectiveFrom: Date | null | undefined,
  expiredAt: Date
): void {
  if (effectiveFrom != null && effectiveFrom.getTime() > expiredAt.getTime()) {
    throw new InvalidFieldValueError(
      'store_notices',
      'effective_from',
      effectiveFrom.toISOString(),
      'store_notices_vigencia_valida'
    );
  }
}

/** Ids de `receivedBy` como enteros seguros, sin repetidos. */
function _ids(receivedBy: number[] | undefined): number[] {
  const ids = [...new Set(receivedBy ?? [])];
  for (const id of ids) {
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new InvalidReferenceError('store_notices', 'received_by', id);
    }
  }
  return ids;
}

/** Destinatarios según el `type` (ver cabecera). Un id inexistente da 400. */
async function _resolveRecipients(
  type: string,
  receivedBy: number[] | undefined
): Promise<{ userIds: number[]; shopIds: number[] }> {
  if (type === 'all_vendor') {
    const owners = await prisma.user.findMany({
      where: { permissions: { some: { permission: { name: 'store_owner' } } } },
      select: { id: true },
    });
    return { userIds: owners.map((u) => Number(u.id)), shopIds: [] };
  }
  if (type === 'all_shop') {
    const shops = await prisma.shop.findMany({ select: { id: true } });
    return { userIds: [], shopIds: shops.map((s) => Number(s.id)) };
  }

  const ids = _ids(receivedBy);
  const found =
    type === 'specific_vendor'
      ? await prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true },
        })
      : await prisma.shop.findMany({
          where: { id: { in: ids } },
          select: { id: true },
        });
  const existing = new Set(found.map((r) => Number(r.id)));
  const missing = ids.find((id) => !existing.has(id));
  if (missing !== undefined) {
    throw new InvalidReferenceError('store_notices', 'received_by', missing);
  }
  return type === 'specific_vendor'
    ? { userIds: ids, shopIds: [] }
    : { userIds: [], shopIds: ids };
}

export async function createStoreNotice(
  input: CreateStoreNoticeInput
): Promise<StoreNoticeDetailRecord> {
  _assertValues(input);
  _assertVigencia(input.effectiveFrom, input.expiredAt);
  const { userIds, shopIds } = await _resolveRecipients(
    input.type,
    input.receivedBy
  );

  try {
    const row = await prisma.storeNotice.create({
      data: {
        priority: input.priority,
        notice: input.notice,
        description: input.description ?? null,
        effectiveFrom: input.effectiveFrom ?? null,
        expiredAt: input.expiredAt,
        type: input.type,
        createdBy: input.createdBy,
        recipients: { create: userIds.map((userId) => ({ userId })) },
        shops: { create: shopIds.map((shopId) => ({ shopId })) },
        reads: { create: userIds.map((userId) => ({ userId, isRead: false })) },
      },
      include: DETAIL,
    });
    return _toDetail(row);
  } catch (error) {
    throw translateCatalogWriteError(error, { aggregate: 'store_notices' });
  }
}

export async function updateStoreNotice(
  id: number,
  input: UpdateStoreNoticeInput
): Promise<StoreNoticeDetailRecord> {
  _assertValues(input);
  const existing = await prisma.storeNotice.findUnique({
    where: { id },
    include: { recipients: true, reads: true },
  });
  if (!existing) {
    throw new RecordNotFoundError('store_notices', id);
  }
  _assertVigencia(
    input.effectiveFrom !== undefined
      ? input.effectiveFrom
      : existing.effectiveFrom,
    input.expiredAt ?? existing.expiredAt
  );

  const operations: Prisma.PrismaPromise<unknown>[] = [];
  if (input.type !== undefined || input.receivedBy !== undefined) {
    const type = input.type ?? existing.type;
    const { userIds, shopIds } = await _resolveRecipients(
      type,
      input.receivedBy
    );
    const alreadyRead = new Set(
      existing.reads
        .filter((r) => userIds.includes(Number(r.userId)))
        .map((r) => Number(r.userId))
    );
    operations.push(
      prisma.storeNoticeUser.deleteMany({ where: { storeNoticeId: id } }),
      prisma.storeNoticeShop.deleteMany({ where: { storeNoticeId: id } }),
      prisma.storeNoticeRead.deleteMany({
        where: { storeNoticeId: id, userId: { notIn: [...alreadyRead] } },
      }),
      prisma.storeNoticeUser.createMany({
        data: userIds.map((userId) => ({ storeNoticeId: id, userId })),
      }),
      prisma.storeNoticeShop.createMany({
        data: shopIds.map((shopId) => ({ storeNoticeId: id, shopId })),
      }),
      prisma.storeNoticeRead.createMany({
        data: userIds
          .filter((userId) => !alreadyRead.has(userId))
          .map((userId) => ({ storeNoticeId: id, userId, isRead: false })),
      })
    );
  }
  operations.push(
    prisma.storeNotice.update({
      where: { id },
      data: {
        ...(input.priority !== undefined && { priority: input.priority }),
        ...(input.notice !== undefined && { notice: input.notice }),
        ...(input.description !== undefined && {
          description: input.description,
        }),
        ...(input.effectiveFrom !== undefined && {
          effectiveFrom: input.effectiveFrom,
        }),
        ...(input.expiredAt !== undefined && { expiredAt: input.expiredAt }),
        ...(input.type !== undefined && { type: input.type }),
        updatedBy: input.updatedBy,
        updatedAt: now(),
      },
    })
  );

  try {
    await prisma.$transaction(operations);
  } catch (error) {
    throw translateCatalogWriteError(error, { aggregate: 'store_notices', id });
  }
  const row = await findStoreNoticeById(id);
  if (!row) {
    throw new RecordNotFoundError('store_notices', id);
  }
  return row;
}

/** Borra el aviso (los pivotes caen por CASCADE) y lo devuelve con su detalle. */
export async function deleteStoreNotice(
  id: number
): Promise<StoreNoticeDetailRecord> {
  const existing = await findStoreNoticeById(id);
  if (!existing) {
    throw new RecordNotFoundError('store_notices', id);
  }
  try {
    await prisma.storeNotice.delete({ where: { id } });
    return existing;
  } catch (error) {
    throw translateCatalogWriteError(error, { aggregate: 'store_notices', id });
  }
}

/**
 * Marca el aviso como leído para `userId` (upsert: un admin que no era
 * destinatario también puede leerlo). Aviso inexistente ⇒ `RecordNotFoundError`.
 */
export async function markStoreNoticeRead(
  id: number,
  userId: number
): Promise<StoreNoticeDetailRecord> {
  const exists = await prisma.storeNotice.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!exists) {
    throw new RecordNotFoundError('store_notices', id);
  }
  try {
    await prisma.storeNoticeRead.upsert({
      where: { storeNoticeId_userId: { storeNoticeId: id, userId } },
      create: { storeNoticeId: id, userId, isRead: true },
      update: { isRead: true },
    });
  } catch (error) {
    throw translateCatalogWriteError(error, {
      aggregate: 'store_notice_read',
      id,
    });
  }
  const row = await findStoreNoticeById(id);
  if (!row) {
    throw new RecordNotFoundError('store_notices', id);
  }
  return row;
}
