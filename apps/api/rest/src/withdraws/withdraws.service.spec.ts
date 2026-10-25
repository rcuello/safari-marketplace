/// <reference types="vitest/globals" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de Vitest;
 * se limita a este archivo para no tocar la config del build.
 */
/**
 * Tests unitarios de `WithdrawsService` (US-62): forma del mock,
 * visibilidad por dueño, filtros, propiedad al escribir y traducción de
 * errores. Se mockea solo el acceso a datos; las clases de error de dominio
 * y `toWriteHttpException` son reales.
 */
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createWithdraw,
  deleteWithdraw,
  findShopOwnerById,
  findWithdrawById,
  InvalidFieldValueError,
  listWithdraws,
  RecordNotFoundError,
  updateWithdrawStatus,
  type WithdrawDetailRecord,
} from '@safari/db';
import { CurrentUserPayload } from 'src/auth/decorators/current-user.decorator';
import { ApproveWithdrawDto } from './dto/approve-withdraw.dto';
import { CreateWithdrawDto } from './dto/create-withdraw.dto';
import { GetWithdrawsDto } from './dto/get-withdraw.dto';
import { WithdrawsService } from './withdraws.service';

vi.mock('@safari/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@safari/db')>()),
  listWithdraws: vi.fn(),
  findWithdrawById: vi.fn(),
  createWithdraw: vi.fn(),
  updateWithdrawStatus: vi.fn(),
  deleteWithdraw: vi.fn(),
  findShopOwnerById: vi.fn(),
}));

const listMock = vi.mocked(listWithdraws);
const findMock = vi.mocked(findWithdrawById);
const createMock = vi.mocked(createWithdraw);
const updateMock = vi.mocked(updateWithdrawStatus);
const deleteMock = vi.mocked(deleteWithdraw);
const ownerMock = vi.mocked(findShopOwnerById);

const NOW = new Date('2026-10-23T00:00:00Z');
const user = (sub: number, permissions: string[]): CurrentUserPayload => ({
  sub,
  email: `u${sub}@demo.com`,
  permissions,
  iat: 0,
  exp: 0,
});
const ADMIN = user(3, ['super_admin', 'store_owner', 'customer']);
const OWNER = user(1, ['store_owner', 'customer']);

function makeWithdraw(
  overrides: Partial<WithdrawDetailRecord> = {},
): WithdrawDetailRecord {
  return {
    id: 2,
    shopId: 3,
    amount: 10,
    paymentMethod: 'cash',
    status: 'pending',
    details: 'iojiojio',
    note: 'joijo',
    createdAt: NOW,
    updatedAt: NOW,
    shop: {
      id: 3,
      name: 'Bags Shop',
      slug: 'bags-shop',
      description: null,
      ownerId: 1,
      isActive: true,
      logo: null,
      coverImage: null,
      address: {},
      settings: {},
      createdAt: NOW,
      updatedAt: NOW,
    },
    ...overrides,
  };
}

describe('WithdrawsService', () => {
  let service: WithdrawsService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new WithdrawsService();
  });

  describe('lista', () => {
    it('las 11 claves y las 13 del shop en el orden del mock; amount numérico, deleted_at null', async () => {
      listMock.mockResolvedValue({ items: [makeWithdraw()], total: 1 });
      const mock = JSON.parse(
        readFileSync(join(__dirname, '../db/pickbazar/withdraws.json'), 'utf8'),
      ) as Record<string, Record<string, unknown>>[];
      const page = await service.getWithdraws(
        { limit: '10', page: '1' } as unknown as GetWithdrawsDto,
        ADMIN,
      );
      const row = page.data[0] as unknown as Record<
        string,
        Record<string, unknown>
      >;

      expect(Object.keys(row)).toEqual(Object.keys(mock[0]));
      expect(Object.keys(row.shop)).toEqual(Object.keys(mock[0].shop));
      expect(row).toMatchObject({
        amount: 10,
        deleted_at: null,
        status: 'pending',
      });
      expect(row.shop.is_active).toBe(1);
      expect(page.per_page).toBe('10');
      expect(page.first_page_url).toContain('/withdraws?limit=10&page=1');
      expect(listMock).toHaveBeenCalledWith({ page: 1, limit: 10 });
    });

    it('el dueño solo ve sus tiendas; el shop_id de la query gana al de search; sin limit ⇒ 10', async () => {
      listMock.mockResolvedValue({ items: [], total: 0 });
      await service.getWithdraws(
        {
          shop_id: '3',
          search: 'shop_id:9',
          status: 'pending',
        } as GetWithdrawsDto,
        OWNER,
      );
      expect(listMock).toHaveBeenLastCalledWith({
        shopId: 3,
        ownerId: 1,
        status: 'pending',
        page: 1,
        limit: 10,
      });

      const page = await service.getWithdraws(
        { search: 'shop_id:9' } as GetWithdrawsDto,
        ADMIN,
      );
      expect(listMock).toHaveBeenLastCalledWith({
        shopId: 9,
        page: 1,
        limit: 10,
      });
      expect(page.per_page).toBe(10);
      expect(page.first_page_url).toContain(
        '/withdraws?limit=undefined&page=1',
      );
    });

    it('shop_id inválido ⇒ 400 sin tocar la base; conexión caída ⇒ 503', async () => {
      await expect(
        service.getWithdraws({ shop_id: 'abc' } as GetWithdrawsDto, ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(listMock).not.toHaveBeenCalled();

      listMock.mockRejectedValue({
        name: 'PrismaClientKnownRequestError',
        code: 'P1001',
        message: "Can't reach database server at `localhost:5433`",
      });
      await expect(
        service.getWithdraws({} as GetWithdrawsDto, ADMIN),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  it('GET /:id: el admin ve cualquiera; el dueño, ajeno o inexistente ⇒ 404; id inválido ⇒ 404', async () => {
    findMock.mockResolvedValue(
      makeWithdraw({ shop: { ...makeWithdraw().shop, ownerId: 9 } }),
    );
    expect((await service.findOne(2, ADMIN)).id).toBe(2);
    await expect(service.findOne(2, OWNER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    findMock.mockResolvedValue(null);
    await expect(service.findOne(2, ADMIN)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.findOne(Number.NaN, ADMIN)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(findMock).toHaveBeenCalledTimes(3);
  });

  describe('POST /withdraws', () => {
    const dto = (over: Record<string, unknown> = {}) =>
      ({
        amount: '15.5',
        shop_id: '3',
        payment_method: 'cash',
        ...over,
      }) as unknown as CreateWithdrawDto;

    it('crea con los campos proyectados; el status del body no viaja', async () => {
      ownerMock.mockResolvedValue(1);
      createMock.mockResolvedValue(makeWithdraw({ amount: 15.5 }));
      await service.create(dto({ status: 'approved', note: 'n' }), OWNER);
      expect(createMock).toHaveBeenCalledWith({
        shopId: 3,
        amount: 15.5,
        paymentMethod: 'cash',
        details: null,
        note: 'n',
      });
    });

    it('tienda ajena ⇒ 403; shop_id inválido o sin payment_method ⇒ 400; el admin no consulta dueño', async () => {
      ownerMock.mockResolvedValue(9);
      await expect(service.create(dto(), OWNER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        service.create(dto({ shop_id: 'x' }), OWNER),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create(dto({ payment_method: '' }), OWNER),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(createMock).not.toHaveBeenCalled();

      createMock.mockRejectedValue(
        new InvalidFieldValueError(
          'withdraws',
          'amount',
          0,
          'withdraws_amount_check',
        ),
      );
      await expect(
        service.create(dto({ amount: 0 }), ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(ownerMock).toHaveBeenCalledTimes(1);
    });
  });

  it('aprobar: id del body o de la ruta; status fuera del CHECK ⇒ 400; inexistente o id inválido ⇒ 404', async () => {
    updateMock.mockResolvedValueOnce(makeWithdraw({ status: 'on_hold' }));
    const approved = await service.approve('2', {
      id: 2,
      status: 'on_hold',
    } as unknown as ApproveWithdrawDto);
    expect(approved.status).toBe('on_hold');
    expect(updateMock).toHaveBeenCalledWith(2, 'on_hold');

    updateMock.mockRejectedValueOnce(
      new InvalidFieldValueError(
        'withdraws',
        'status',
        'Approved',
        'withdraws_status_check',
      ),
    );
    await expect(
      service.approve('2', {
        status: 'Approved',
      } as unknown as ApproveWithdrawDto),
    ).rejects.toBeInstanceOf(BadRequestException);
    updateMock.mockRejectedValueOnce(new RecordNotFoundError('withdraws', 999));
    await expect(
      service.approve('999', {
        status: 'approved',
      } as unknown as ApproveWithdrawDto),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.approve(undefined, {
        status: 'approved',
      } as unknown as ApproveWithdrawDto),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(updateMock).toHaveBeenCalledTimes(3);
  });

  it('DELETE: el dueño borra su pending; ajeno o no pending ⇒ 403; inexistente ⇒ 404; el admin borra cualquiera', async () => {
    deleteMock.mockResolvedValue(makeWithdraw());
    findMock.mockResolvedValueOnce(makeWithdraw());
    expect((await service.remove(2, OWNER)).id).toBe(2);

    findMock.mockResolvedValueOnce(
      makeWithdraw({ shop: { ...makeWithdraw().shop, ownerId: 9 } }),
    );
    await expect(service.remove(2, OWNER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    findMock.mockResolvedValueOnce(makeWithdraw({ status: 'approved' }));
    await expect(service.remove(2, OWNER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    findMock.mockResolvedValueOnce(null);
    await expect(service.remove(2, OWNER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(deleteMock).toHaveBeenCalledTimes(1);

    await service.remove(1, ADMIN);
    expect(deleteMock).toHaveBeenLastCalledWith(1);
    expect(findMock).toHaveBeenCalledTimes(4);
  });
});
