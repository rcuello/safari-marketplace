/**
 * Test de integración contra el Postgres real (sembrado por `just db-up`: 6
 * transferencias pending, ids 5-10, sin tienda). US-63.
 *
 * Escrituras: un dueño centinela `zz-transfer-owner` y las transferencias
 * que crean los casos, borradas en `afterAll` (antes que el usuario: las FK
 * de usuario son RESTRICT). `transferShopOwnership` cambia el dueño de la
 * tienda 2; el caso lo restaura a 1 y devuelve su `updated_at` como texto,
 * para no perder los microsegundos (precedente US-59).
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../client';
import { _setNowProvider } from '../clock';
import {
  InvalidFieldValueError,
  InvalidReferenceError,
  RecordNotFoundError,
} from '../domain-errors';
import {
  createOwnershipTransfer,
  deleteOwnershipTransfer,
  findOwnershipTransferByIdentifier,
  listOwnershipTransfers,
  SameOwnerError,
  transferShopOwnership,
  updateOwnershipTransfer,
} from './ownership-transfers.repository';

const SENTINEL = 'zz-transfer-';
const ADMIN = 3;
const JACK = 49;
const CUSTOMER = 2;
const SHOP = 2;
const SEED_OWNER = 1;
let sentinelId: number;
const createdIds: number[] = [];

function fixClock(iso: string): Date {
  const fixed = new Date(iso);
  _setNowProvider(() => fixed);
  return fixed;
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      name: `${SENTINEL}owner`,
      email: `${SENTINEL}owner@demo.com`,
      passwordHash: 'x',
    },
  });
  sentinelId = Number(user.id);
});

afterEach(() => {
  _setNowProvider(() => new Date());
});

afterAll(async () => {
  await prisma.ownershipTransfer.deleteMany({
    where: { id: { in: createdIds } },
  });
  await prisma.user.deleteMany({ where: { email: { startsWith: SENTINEL } } });
  await prisma.$disconnect();
});

describe('ownership_transfers — seed', () => {
  it('lista las 6 en created_at DESC, id DESC, con owners y balance_info verbatim', async () => {
    const mock = JSON.parse(
      readFileSync(
        join(
          __dirname,
          '../../../../apps/api/rest/src/db/pickbazar/ownership-transfer.json'
        ),
        'utf8'
      )
    ) as {
      id: number;
      transaction_identifier: string;
      balance_info: unknown;
    }[];
    const { items, total } = await listOwnershipTransfers();

    expect(total).toBe(6);
    expect(items.map((t) => t.id)).toEqual([10, 9, 8, 7, 6, 5]);
    expect(
      items.every(
        (t) =>
          t.createdById === ADMIN && t.shopId === null && t.status === 'pending'
      )
    ).toBe(true);
    expect(items.map((t) => t.previousOwnerId)).toEqual([
      48,
      ADMIN,
      53,
      ADMIN,
      ADMIN,
      ADMIN,
    ]);
    expect(items.map((t) => t.currentOwnerId)).toEqual([
      JACK,
      51,
      51,
      51,
      45,
      42,
    ]);
    for (const t of items) {
      const original = mock.find((m) => m.id === t.id);
      expect(t.transactionIdentifier).toBe(original?.transaction_identifier);
      expect(JSON.stringify(t.balanceInfo)).toBe(
        JSON.stringify(original?.balance_info)
      );
      expect(
        typeof (t.balanceInfo as { payment_info: unknown }).payment_info
      ).toBe('string');
    }
    expect(items[0].previousOwner).toMatchObject({
      id: 48,
      email: 'mack@gmail.com',
      isActive: true,
    });
    expect(items[0].currentOwner.email).toBe('jack@gmail.com');
  });

  it('identificador exacto, participante y un dueño ajeno a todas', async () => {
    expect(
      (
        await listOwnershipTransfers({
          transactionIdentifier: '2024-08-01-0002',
        })
      ).items.map((t) => t.id)
    ).toEqual([8]);
    expect(
      (await listOwnershipTransfers({ transactionIdentifier: '2024-08-01' }))
        .total
    ).toBe(0);
    expect(
      (await listOwnershipTransfers({ participantId: JACK })).items.map(
        (t) => t.id
      )
    ).toEqual([10]);
    expect(await listOwnershipTransfers({ participantId: sentinelId })).toEqual(
      { items: [], total: 0 }
    );
    expect(
      (await findOwnershipTransferByIdentifier('2024-08-03-0001'))?.id
    ).toBe(10);
    expect(
      await findOwnershipTransferByIdentifier('2099-01-01-0001')
    ).toBeNull();
  });
});

describe('ownership_transfers — solicitudes', () => {
  it('create: pending, dueño anterior = el de la tienda, identificadores -0001 y -0002 del día', async () => {
    fixClock('2030-05-05T12:00:00Z');
    const a = await createOwnershipTransfer({
      shopId: SHOP,
      currentOwnerId: JACK,
      createdById: ADMIN,
      message: 'zz',
    });
    const b = await createOwnershipTransfer({
      shopId: SHOP,
      currentOwnerId: JACK,
      createdById: ADMIN,
    });
    createdIds.push(a.id, b.id);
    expect([a.transactionIdentifier, b.transactionIdentifier]).toEqual([
      '2030-05-05-0001',
      '2030-05-05-0002',
    ]);
    expect(a).toMatchObject({
      status: 'pending',
      shopId: SHOP,
      previousOwnerId: SEED_OWNER,
      currentOwnerId: JACK,
      message: 'zz',
    });
    expect(b.message).toBeNull();
    expect(
      (await prisma.shop.findUniqueOrThrow({ where: { id: SHOP } })).ownerId
    ).toBe(BigInt(SEED_OWNER));
  });

  it('create: tienda o vendedor inexistentes ⇒ 400; vendedor = dueño ⇒ 409', async () => {
    await expect(
      createOwnershipTransfer({
        shopId: 999999,
        currentOwnerId: JACK,
        createdById: ADMIN,
      })
    ).rejects.toBeInstanceOf(InvalidReferenceError);
    await expect(
      createOwnershipTransfer({
        shopId: SHOP,
        currentOwnerId: 999999,
        createdById: ADMIN,
      })
    ).rejects.toBeInstanceOf(InvalidReferenceError);
    await expect(
      createOwnershipTransfer({
        shopId: SHOP,
        currentOwnerId: SEED_OWNER,
        createdById: ADMIN,
      })
    ).rejects.toBeInstanceOf(SameOwnerError);
  });

  it('update fija status y updated_at con el reloj; status fuera del CHECK ⇒ 400; delete borra', async () => {
    const created = await createOwnershipTransfer({
      shopId: SHOP,
      currentOwnerId: JACK,
      createdById: ADMIN,
    });
    createdIds.push(created.id);
    const fixed = fixClock('2031-01-01T00:00:00Z');
    const updated = await updateOwnershipTransfer(created.id, {
      status: 'rejected',
      message: 'no',
    });
    expect(updated).toMatchObject({ status: 'rejected', message: 'no' });
    expect(updated.updatedAt.toISOString()).toBe(fixed.toISOString());

    await expect(
      updateOwnershipTransfer(created.id, { status: 'Rejected' })
    ).rejects.toBeInstanceOf(InvalidFieldValueError);
    await expect(
      updateOwnershipTransfer(999999, { status: 'approved' })
    ).rejects.toBeInstanceOf(RecordNotFoundError);

    expect((await deleteOwnershipTransfer(created.id)).id).toBe(created.id);
    expect(
      await findOwnershipTransferByIdentifier(created.transactionIdentifier)
    ).toBeNull();
    await expect(deleteOwnershipTransfer(created.id)).rejects.toBeInstanceOf(
      RecordNotFoundError
    );
  });
});

describe('transferShopOwnership — CA-5', () => {
  it('cambia el dueño e inserta la fila approved; un fallo a mitad no deja cambios', async () => {
    const [{ updated_at: originalUpdatedAt }] = await prisma.$queryRaw<
      { updated_at: string }[]
    >`
      SELECT updated_at::text FROM shops WHERE id = ${SHOP}
    `;
    const before = await prisma.ownershipTransfer.count();

    // Vendedor sin store_owner: la validación corta la transacción.
    await expect(
      transferShopOwnership({
        shopId: SHOP,
        vendorId: CUSTOMER,
        createdById: ADMIN,
      })
    ).rejects.toBeInstanceOf(InvalidFieldValueError);
    await expect(
      transferShopOwnership({
        shopId: SHOP,
        vendorId: 999999,
        createdById: ADMIN,
      })
    ).rejects.toBeInstanceOf(InvalidReferenceError);
    await expect(
      transferShopOwnership({
        shopId: SHOP,
        vendorId: SEED_OWNER,
        createdById: ADMIN,
      })
    ).rejects.toBeInstanceOf(SameOwnerError);
    await expect(
      transferShopOwnership({
        shopId: 999999,
        vendorId: JACK,
        createdById: ADMIN,
      })
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    expect(await prisma.ownershipTransfer.count()).toBe(before);
    expect(
      (await prisma.shop.findUniqueOrThrow({ where: { id: SHOP } })).ownerId
    ).toBe(BigInt(SEED_OWNER));

    try {
      const result = await transferShopOwnership({
        shopId: SHOP,
        vendorId: JACK,
        createdById: ADMIN,
        message: 'zz',
      });
      createdIds.push(result.transfer.id);
      expect(result.shop).toMatchObject({ id: SHOP, ownerId: JACK });
      expect(result.owner).toMatchObject({ id: JACK, name: 'jack' });
      expect(result.transfer).toMatchObject({
        status: 'approved',
        shopId: SHOP,
        previousOwnerId: SEED_OWNER,
        currentOwnerId: JACK,
        createdById: ADMIN,
      });
      expect(
        (await prisma.shop.findUniqueOrThrow({ where: { id: SHOP } })).ownerId
      ).toBe(BigInt(JACK));
    } finally {
      await prisma.$executeRaw`
        UPDATE shops SET owner_id = ${SEED_OWNER}, updated_at = ${originalUpdatedAt}::timestamptz WHERE id = ${SHOP}
      `;
    }
  });
});
