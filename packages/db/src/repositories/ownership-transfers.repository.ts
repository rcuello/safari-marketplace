/**
 * ownership-transfers.repository.ts — transferencias de propiedad de tienda (US-63).
 *
 * Dos escrituras distintas:
 *   · la SOLICITUD (`createOwnershipTransfer`): nace `pending` y no toca
 *     `shops`. Aprobarla por `updateOwnershipTransfer` tampoco: no hay flujo
 *     de aprobación con efecto (NO incluye de la US).
 *   · la TRANSFERENCIA (`transferShopOwnership`): en una transacción cambia
 *     `shops.owner_id` e inserta la fila `approved`. Es la única escritura del
 *     repo sobre `owner_id`; `updateShop` lo sigue excluyendo (DD30-2).
 *
 * `transaction_identifier` es `YYYY-MM-DD-NNNN` (día UTC de `now()`,
 * secuencial por día). Se calcula dentro de la transacción y, si otra se
 * adelanta con el mismo número, el UNIQUE da P2002 y se reintenta entera.
 *
 * Los CHECK de la tabla no existen para Prisma: `status` se valida aquí
 * (`InvalidFieldValueError`, 400) y los owners distintos dan
 * `SameOwnerError` (409). Quién ve qué es regla de la API: llega como el
 * filtro `participantId`.
 */

import type { Prisma } from '../../generated/prisma/client/client';
import { prisma } from '../client';
import { now } from '../clock';
import {
  CATALOG_ERROR_CODES,
  CatalogWriteError,
  InvalidFieldValueError,
  InvalidReferenceError,
  RecordNotFoundError,
  translateCatalogWriteError,
} from '../domain-errors';
import {
  _id,
  _toOwnershipTransferRecord,
  _toProfileRecord,
  _toShopRecord,
  _toUserRecord,
  type OwnershipTransferRecord,
  type ProfileRecord,
  type ShopRecord,
  type UserRecord,
} from '../records';

/** El CHECK `ownership_transfers_status_check`, en minúscula (el vocabulario del admin). */
export const OWNERSHIP_TRANSFER_STATUSES = [
  'pending',
  'processing',
  'approved',
  'rejected',
] as const;

const IDENTIFIER_ATTEMPTS = 5;

/** El vendedor ya es el dueño de la tienda. Reutiliza el código del 409. */
export class SameOwnerError extends CatalogWriteError {
  readonly code = CATALOG_ERROR_CODES.SlugConflict;
  constructor(shopId: number, ownerId: number) {
    super(
      `El usuario ${ownerId} ya es el dueño de la tienda ${shopId}.`,
      'ownership_transfers'
    );
    this.name = 'SameOwnerError';
  }
}

export interface OwnershipTransferOwnerRecord extends UserRecord {
  profile: ProfileRecord | null;
}

export interface OwnershipTransferDetailRecord extends OwnershipTransferRecord {
  previousOwner: OwnershipTransferOwnerRecord;
  currentOwner: OwnershipTransferOwnerRecord;
}

export interface ListOwnershipTransfersInput {
  /** Exacto. */
  transactionIdentifier?: string;
  shopId?: number;
  /** Solo las filas donde este usuario es el dueño anterior o el nuevo. */
  participantId?: number;
  /** 1-based. Default 1. */
  page?: number;
  /** Default 10. */
  limit?: number;
}

export interface CreateOwnershipTransferInput {
  shopId: number;
  /** El vendedor que recibiría la tienda. */
  currentOwnerId: number;
  createdById: number;
  message?: string | null;
}

export interface UpdateOwnershipTransferInput {
  status?: string;
  message?: string | null;
}

export interface TransferShopOwnershipInput {
  shopId: number;
  vendorId: number;
  createdById: number;
  message?: string | null;
}

export interface ShopTransferResult {
  /** La tienda ya con su dueño nuevo. */
  shop: ShopRecord;
  owner: UserRecord;
  transfer: OwnershipTransferRecord;
}

const DETAIL_INCLUDE = {
  previousOwner: { include: { profile: true } },
  currentOwner: { include: { profile: true } },
} satisfies Prisma.OwnershipTransferInclude;

type TransferWithOwners = Prisma.OwnershipTransferGetPayload<{
  include: typeof DETAIL_INCLUDE;
}>;
type Tx = Prisma.TransactionClient;

function _toOwner(
  row: TransferWithOwners['previousOwner']
): OwnershipTransferOwnerRecord {
  return {
    ..._toUserRecord(row),
    profile: row.profile ? _toProfileRecord(row.profile) : null,
  };
}

function _toDetail(row: TransferWithOwners): OwnershipTransferDetailRecord {
  return {
    ..._toOwnershipTransferRecord(row),
    previousOwner: _toOwner(row.previousOwner),
    currentOwner: _toOwner(row.currentOwner),
  };
}

function _translate(error: unknown, id?: number): unknown {
  return translateCatalogWriteError(error, {
    aggregate: 'ownership_transfers',
    id,
    uniqueField: 'transaction_identifier',
  });
}

function _assertStatus(status: string): void {
  if (!(OWNERSHIP_TRANSFER_STATUSES as readonly string[]).includes(status)) {
    throw new InvalidFieldValueError(
      'ownership_transfers',
      'status',
      status,
      'ownership_transfers_status_check'
    );
  }
}

/** El siguiente `YYYY-MM-DD-NNNN` del día UTC de `now()`. */
async function _nextIdentifier(tx: Tx): Promise<string> {
  const day = now().toISOString().slice(0, 10);
  const last = await tx.ownershipTransfer.findFirst({
    where: { transactionIdentifier: { startsWith: `${day}-` } },
    orderBy: { transactionIdentifier: 'desc' },
    select: { transactionIdentifier: true },
  });
  const next = last ? Number(last.transactionIdentifier.slice(11)) + 1 : 1;
  if (!Number.isSafeInteger(next) || next > 9999) {
    throw new Error(`No quedan transaction_identifier libres para ${day}.`);
  }
  return `${day}-${String(next).padStart(4, '0')}`;
}

/** Bloquea la fila de la tienda y devuelve su dueño; `null` si no existe. */
async function _lockShopOwner(tx: Tx, shopId: number): Promise<number | null> {
  const rows = await tx.$queryRaw<{ owner_id: bigint }[]>`
    SELECT owner_id FROM shops WHERE id = ${shopId} FOR UPDATE
  `;
  return rows[0] ? _id(rows[0].owner_id) : null;
}

/** Reintenta la transacción entera si otra se adelantó con el mismo identificador (P2002). */
async function _withFreeIdentifier<T>(
  work: (tx: Tx) => Promise<T>
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(work);
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code !== 'P2002' || attempt >= IDENTIFIER_ATTEMPTS) throw error;
    }
  }
}

/** Paginado en `created_at DESC, id DESC`. Los filtros se combinan con AND. */
export async function listOwnershipTransfers(
  input: ListOwnershipTransfersInput = {}
): Promise<{ items: OwnershipTransferDetailRecord[]; total: number }> {
  const page = Math.max(1, input.page ?? 1);
  const limit = input.limit ?? 10;
  const where: Prisma.OwnershipTransferWhereInput = {
    ...(input.transactionIdentifier !== undefined && {
      transactionIdentifier: input.transactionIdentifier,
    }),
    ...(input.shopId !== undefined && { shopId: input.shopId }),
    ...(input.participantId !== undefined && {
      OR: [
        { previousOwnerId: input.participantId },
        { currentOwnerId: input.participantId },
      ],
    }),
  };
  const [rows, total] = await Promise.all([
    prisma.ownershipTransfer.findMany({
      where,
      include: DETAIL_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.ownershipTransfer.count({ where }),
  ]);
  return { items: rows.map(_toDetail), total };
}

export async function findOwnershipTransferByIdentifier(
  transactionIdentifier: string
): Promise<OwnershipTransferDetailRecord | null> {
  const row = await prisma.ownershipTransfer.findUnique({
    where: { transactionIdentifier },
    include: DETAIL_INCLUDE,
  });
  return row ? _toDetail(row) : null;
}

/**
 * Solicitud `pending` para pasar la tienda a `currentOwnerId`. El dueño
 * anterior es el actual de la tienda, leído en la misma transacción. No
 * toca `shops`. Tienda inexistente o vendedor inexistente ⇒ 400; el
 * vendedor ya es el dueño ⇒ 409.
 */
export async function createOwnershipTransfer(
  input: CreateOwnershipTransferInput
): Promise<OwnershipTransferDetailRecord> {
  try {
    return await _withFreeIdentifier(async (tx) => {
      const ownerId = await _lockShopOwner(tx, input.shopId);
      if (ownerId === null)
        throw new InvalidReferenceError(
          'ownership_transfers',
          'shop_id',
          input.shopId
        );
      if (ownerId === input.currentOwnerId)
        throw new SameOwnerError(input.shopId, ownerId);
      const row = await tx.ownershipTransfer.create({
        data: {
          transactionIdentifier: await _nextIdentifier(tx),
          shopId: input.shopId,
          previousOwnerId: ownerId,
          currentOwnerId: input.currentOwnerId,
          createdById: input.createdById,
          message: input.message ?? null,
        },
        include: DETAIL_INCLUDE,
      });
      return _toDetail(row);
    });
  } catch (error) {
    throw _translate(error);
  }
}

/** Cambia `status` y/o `message`; fija `updatedAt: now()` (US-32). No toca `shops`. */
export async function updateOwnershipTransfer(
  id: number,
  input: UpdateOwnershipTransferInput
): Promise<OwnershipTransferDetailRecord> {
  if (input.status !== undefined) _assertStatus(input.status);
  try {
    const row = await prisma.ownershipTransfer.update({
      where: { id },
      data: {
        ...(input.status !== undefined && { status: input.status }),
        ...(input.message !== undefined && { message: input.message }),
        updatedAt: now(),
      },
      include: DETAIL_INCLUDE,
    });
    return _toDetail(row);
  } catch (error) {
    throw _translate(error, id);
  }
}

/** Borra y devuelve la fila borrada. Nada referencia a `ownership_transfers`. */
export async function deleteOwnershipTransfer(
  id: number
): Promise<OwnershipTransferDetailRecord> {
  try {
    return _toDetail(
      await prisma.ownershipTransfer.delete({
        where: { id },
        include: DETAIL_INCLUDE,
      })
    );
  } catch (error) {
    throw _translate(error, id);
  }
}

/**
 * Pasa la tienda a `vendorId` en UNA transacción: bloquea la tienda, valida
 * al vendedor (existe y tiene `store_owner`), cambia `shops.owner_id` e
 * inserta la transferencia `approved`. Cualquier fallo deja `shops` y
 * `ownership_transfers` como estaban.
 *
 * Tienda inexistente ⇒ `RecordNotFoundError` (404); vendedor inexistente o
 * sin `store_owner` ⇒ 400; el vendedor ya es el dueño ⇒ `SameOwnerError` (409).
 */
export async function transferShopOwnership(
  input: TransferShopOwnershipInput
): Promise<ShopTransferResult> {
  try {
    return await _withFreeIdentifier(async (tx) => {
      const ownerId = await _lockShopOwner(tx, input.shopId);
      if (ownerId === null)
        throw new RecordNotFoundError('shops', input.shopId);

      const vendor = await tx.user.findUnique({
        where: { id: input.vendorId },
        include: { permissions: { include: { permission: true } } },
      });
      if (!vendor)
        throw new InvalidReferenceError(
          'ownership_transfers',
          'vendor_id',
          input.vendorId
        );
      if (
        !vendor.permissions.some(
          (link) => link.permission.name === 'store_owner'
        )
      ) {
        throw new InvalidFieldValueError(
          'ownership_transfers',
          'vendor_id',
          input.vendorId,
          'store_owner'
        );
      }
      if (ownerId === input.vendorId)
        throw new SameOwnerError(input.shopId, ownerId);

      const shop = await tx.shop.update({
        where: { id: input.shopId },
        data: { ownerId: input.vendorId, updatedAt: now() },
      });
      const transfer = await tx.ownershipTransfer.create({
        data: {
          transactionIdentifier: await _nextIdentifier(tx),
          shopId: input.shopId,
          previousOwnerId: ownerId,
          currentOwnerId: input.vendorId,
          createdById: input.createdById,
          message: input.message ?? null,
          status: 'approved',
        },
      });
      return {
        shop: _toShopRecord(shop),
        owner: _toUserRecord(vendor),
        transfer: _toOwnershipTransferRecord(transfer),
      };
    });
  } catch (error) {
    throw _translate(error);
  }
}
