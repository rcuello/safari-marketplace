/// <reference types="vitest/globals" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de Vitest;
 * se limita a este archivo para no tocar la config del build.
 */
/**
 * Tests unitarios de `OwnershipTransferService` (US-63): forma del mock,
 * visibilidad por participante, búsqueda, url del paginador (V-7),
 * escrituras y `transfer-shop-ownership`. Se mockea solo el acceso a datos;
 * las clases de error de dominio y `toWriteHttpException` son reales.
 */
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createOwnershipTransfer,
  deleteOwnershipTransfer,
  findOwnershipTransferByIdentifier,
  InvalidFieldValueError,
  listOwnershipTransfers,
  RecordNotFoundError,
  SameOwnerError,
  transferShopOwnership,
  updateOwnershipTransfer,
  type OwnershipTransferDetailRecord,
  type OwnershipTransferOwnerRecord,
} from '@safari/db';
import { CurrentUserPayload } from '#src/auth/decorators/current-user.decorator.js';
import { CreateOwnershipTransferDto } from './dto/create-ownership-transfer.dto.js';
import { GetOwnershipTransferDto } from './dto/get-ownership-transfer.dto.js';
import { TransferShopOwnershipDto } from './dto/transfer-shop-ownership.dto.js';
import { OwnershipTransferService } from './ownership-transfer.service.js';

vi.mock('@safari/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@safari/db')>()),
  listOwnershipTransfers: vi.fn(),
  findOwnershipTransferByIdentifier: vi.fn(),
  createOwnershipTransfer: vi.fn(),
  updateOwnershipTransfer: vi.fn(),
  deleteOwnershipTransfer: vi.fn(),
  transferShopOwnership: vi.fn(),
}));

const listMock = vi.mocked(listOwnershipTransfers);
const findMock = vi.mocked(findOwnershipTransferByIdentifier);
const createMock = vi.mocked(createOwnershipTransfer);
const updateMock = vi.mocked(updateOwnershipTransfer);
const deleteMock = vi.mocked(deleteOwnershipTransfer);
const transferMock = vi.mocked(transferShopOwnership);

const NOW = new Date('2026-10-23T00:00:00Z');
const user = (sub: number, permissions: string[]): CurrentUserPayload => ({
  sub,
  email: `u${sub}@demo.com`,
  permissions,
  iat: 0,
  exp: 0,
});
const ADMIN = user(3, ['super_admin', 'store_owner', 'customer']);
const JACK = user(49, ['customer', 'store_owner']);
const BALANCE = {
  id: 24,
  shop_id: 22,
  current_balance: 0,
  payment_info: '{"name":"1313"}',
};

function makeOwner(
  id: number,
  overrides: Partial<OwnershipTransferOwnerRecord> = {},
): OwnershipTransferOwnerRecord {
  return {
    id,
    name: `user ${id}`,
    email: `u${id}@gmail.com`,
    isActive: true,
    emailVerifiedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    profile: null,
    ...overrides,
  };
}

function makeTransfer(
  overrides: Partial<OwnershipTransferDetailRecord> = {},
): OwnershipTransferDetailRecord {
  return {
    id: 10,
    transactionIdentifier: '2024-08-03-0001',
    shopId: null,
    previousOwnerId: 48,
    currentOwnerId: 49,
    createdById: 3,
    message: null,
    status: 'pending',
    orderInfo: null,
    balanceInfo: BALANCE,
    refundInfo: null,
    withdrawalInfo: null,
    createdAt: NOW,
    updatedAt: NOW,
    previousOwner: makeOwner(48),
    currentOwner: makeOwner(49),
    ...overrides,
  };
}

describe('OwnershipTransferService', () => {
  let service: OwnershipTransferService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new OwnershipTransferService();
  });

  it('lista: las 11 claves y las 10 de cada owner en el orden del mock; balance_info tal cual; url corregida', async () => {
    listMock.mockResolvedValue({ items: [makeTransfer()], total: 1 });
    const mock = JSON.parse(
      readFileSync(
        join(import.meta.dirname, '../db/pickbazar/ownership-transfer.json'),
        'utf8',
      ),
    ) as Record<string, Record<string, unknown>>[];
    const page = await service.findAll(
      { limit: '10', page: '1' } as unknown as GetOwnershipTransferDto,
      ADMIN,
    );
    const row = page.data[0] as unknown as Record<
      string,
      Record<string, unknown>
    >;

    expect(Object.keys(row)).toEqual(Object.keys(mock[0]));
    expect(Object.keys(row.previous_owner)).toEqual(
      Object.keys(mock[0].previous_owner),
    );
    expect(row.previous_owner).toMatchObject({
      is_active: 1,
      shop_id: null,
      email_verified: false,
      profile: null,
    });
    expect(row.balance_info).toBe(BALANCE);
    expect(row.created_by).toBe(3);
    expect(page.per_page).toBe('10');
    expect(page.first_page_url).toContain(
      '/ownership-transfer?search=undefined&limit=10&page=1',
    );
    expect(listMock).toHaveBeenCalledWith({ page: 1, limit: 10 });
  });

  it('búsqueda exacta por transaction_identifier, shop_id y visibilidad del dueño; shop_id inválido ⇒ 400', async () => {
    listMock.mockResolvedValue({ items: [], total: 0 });
    await service.findAll(
      {
        search: 'transaction_identifier:2024-08-01-0002',
        shop_id: '2',
      } as GetOwnershipTransferDto,
      JACK,
    );
    expect(listMock).toHaveBeenLastCalledWith({
      transactionIdentifier: '2024-08-01-0002',
      shopId: 2,
      participantId: 49,
      page: 1,
      limit: 10,
    });
    await expect(
      service.findAll({ shop_id: 'x' } as GetOwnershipTransferDto, ADMIN),
    ).rejects.toBeInstanceOf(BadRequestException);
    listMock.mockRejectedValue({
      name: 'PrismaClientKnownRequestError',
      code: 'P1001',
      message: "Can't reach database server at `localhost:5433`",
    });
    await expect(
      service.findAll({} as GetOwnershipTransferDto, ADMIN),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('detalle: participante o admin lo ven; ajeno o inexistente ⇒ 404', async () => {
    findMock.mockResolvedValue(makeTransfer());
    expect(
      (await service.getOwnershipTransfer('2024-08-03-0001', JACK)).id,
    ).toBe(10);
    expect(
      (await service.getOwnershipTransfer('2024-08-03-0001', ADMIN)).id,
    ).toBe(10);
    await expect(
      service.getOwnershipTransfer(
        '2024-08-03-0001',
        user(51, ['store_owner']),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    findMock.mockResolvedValue(null);
    await expect(
      service.getOwnershipTransfer('x', ADMIN),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('POST: proyecta shop_id, vendor_id y created_by del token; ids inválidos ⇒ 400; mismo dueño ⇒ 409', async () => {
    createMock.mockResolvedValueOnce(makeTransfer({ id: 11 }));
    await service.create(
      {
        shop_id: '2',
        vendor_id: '49',
        message: 'm',
      } as CreateOwnershipTransferDto,
      ADMIN,
    );
    expect(createMock).toHaveBeenCalledWith({
      shopId: 2,
      currentOwnerId: 49,
      createdById: 3,
      message: 'm',
    });

    await expect(
      service.create({ shop_id: '2' } as CreateOwnershipTransferDto, ADMIN),
    ).rejects.toBeInstanceOf(BadRequestException);
    createMock.mockRejectedValueOnce(new SameOwnerError(2, 1));
    await expect(
      service.create(
        { shop_id: '2', vendor_id: '1' } as CreateOwnershipTransferDto,
        ADMIN,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('PUT/DELETE: status fuera del CHECK ⇒ 400; inexistente o id inválido ⇒ 404', async () => {
    updateMock.mockResolvedValueOnce(makeTransfer({ status: 'rejected' }));
    expect((await service.update('10', { status: 'rejected' })).status).toBe(
      'rejected',
    );
    expect(updateMock).toHaveBeenCalledWith(10, { status: 'rejected' });

    updateMock.mockRejectedValueOnce(
      new InvalidFieldValueError(
        'ownership_transfers',
        'status',
        'Rejected',
        'ownership_transfers_status_check',
      ),
    );
    await expect(
      service.update('10', { status: 'Rejected' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.update('abc', { status: 'approved' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    deleteMock.mockRejectedValueOnce(
      new RecordNotFoundError('ownership_transfers', 999),
    );
    await expect(service.remove('999')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(updateMock).toHaveBeenCalledTimes(2);
  });

  it('transfer-shop-ownership: la tienda con owner {id, name, email}; los errores del repositorio se traducen', async () => {
    transferMock.mockResolvedValueOnce({
      shop: {
        id: 2,
        name: 'Clothing Shop',
        slug: 'clothing-shop',
        description: null,
        ownerId: 49,
        isActive: true,
        logo: null,
        coverImage: null,
        address: {},
        settings: {},
        createdAt: NOW,
        updatedAt: NOW,
      },
      owner: {
        id: 49,
        name: 'jack',
        email: 'jack@gmail.com',
        isActive: true,
        emailVerifiedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
      transfer: makeTransfer({ id: 23, status: 'approved', shopId: 2 }),
    });
    const shop = (await service.transferShopOwnership(
      {
        shop_id: '2',
        vendor_id: '49',
        message: 'm',
      } as TransferShopOwnershipDto,
      ADMIN,
    )) as unknown as Record<string, unknown>;
    expect(transferMock).toHaveBeenCalledWith({
      shopId: 2,
      vendorId: 49,
      createdById: 3,
      message: 'm',
    });
    expect(shop).toMatchObject({
      id: 2,
      owner_id: 49,
      owner: { id: 49, name: 'jack', email: 'jack@gmail.com' },
    });
    expect(Object.keys(shop)).toHaveLength(16);

    transferMock.mockRejectedValueOnce(new RecordNotFoundError('shops', 999));
    await expect(
      service.transferShopOwnership(
        { shop_id: '999', vendor_id: '49' } as TransferShopOwnershipDto,
        ADMIN,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    transferMock.mockRejectedValueOnce(new SameOwnerError(2, 1));
    await expect(
      service.transferShopOwnership(
        { shop_id: '2', vendor_id: '1' } as TransferShopOwnershipDto,
        ADMIN,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.transferShopOwnership(
        { shop_id: '2', vendor_id: 'abc' } as TransferShopOwnershipDto,
        ADMIN,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transferMock).toHaveBeenCalledTimes(3);
  });
});
