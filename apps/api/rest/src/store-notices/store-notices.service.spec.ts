/// <reference types="vitest/globals" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de Vitest.
 */
/**
 * Tests unitarios de `StoreNoticesService` (US-51). Mismo arnés que
 * `tags.service.spec.ts`: solo se mockea el acceso a datos.
 */
import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  createStoreNotice,
  deleteStoreNotice,
  findStoreNoticeById,
  InvalidReferenceError,
  listStoreNotices,
  markStoreNoticeRead,
  RecordNotFoundError,
  updateStoreNotice,
  type StoreNoticeDetailRecord,
  type UserRecord,
} from '@safari/db';
import { StoreNoticesService } from './store-notices.service';
import { CreateStoreNoticeDto } from './dto/create-store-notice.dto';
import { GetStoreNoticesDto } from './dto/get-store-notices.dto';

vi.mock('@safari/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@safari/db')>()),
  listStoreNotices: vi.fn(),
  findStoreNoticeById: vi.fn(),
  createStoreNotice: vi.fn(),
  updateStoreNotice: vi.fn(),
  deleteStoreNotice: vi.fn(),
  markStoreNoticeRead: vi.fn(),
}));

const listMock = vi.mocked(listStoreNotices);
const findMock = vi.mocked(findStoreNoticeById);
const createMock = vi.mocked(createStoreNotice);
const updateMock = vi.mocked(updateStoreNotice);
const deleteMock = vi.mocked(deleteStoreNotice);
const readMock = vi.mocked(markStoreNoticeRead);

const T = new Date('2026-10-22T00:00:00.000Z');

function user(id: number, name: string, email: string): UserRecord {
  return {
    id,
    name,
    email,
    isActive: true,
    emailVerifiedAt: null,
    createdAt: T,
    updatedAt: T,
  };
}

const ADMIN = user(3, 'Jhon Doe', 'admin@demo.com');
const OWNER = user(1, 'Store Owner', 'store_owner@demo.com');

function makeRecord(
  overrides: Partial<StoreNoticeDetailRecord> = {},
): StoreNoticeDetailRecord {
  return {
    id: 2,
    priority: 'medium',
    notice: 'Sorry for Delivery Delay !!!',
    description: 'd',
    effectiveFrom: new Date('2023-03-15T12:00:00.000Z'),
    expiredAt: new Date('2023-03-30T12:00:00.000Z'),
    type: 'all_vendor',
    createdBy: 3,
    updatedBy: 3,
    createdAt: new Date('2023-03-16T09:56:57.000Z'),
    updatedAt: new Date('2023-03-16T09:57:15.000Z'),
    creator: {
      ...ADMIN,
      permissions: [
        {
          id: 1,
          name: 'super_admin',
          guardName: 'api',
          createdAt: T,
          updatedAt: T,
        },
        {
          id: 3,
          name: 'store_owner',
          guardName: 'api',
          createdAt: T,
          updatedAt: T,
        },
      ],
    },
    recipients: [ADMIN, OWNER],
    shops: [],
    reads: [
      { user: ADMIN, isRead: true },
      { user: OWNER, isRead: false },
    ],
    ...overrides,
  };
}

function query(input: Record<string, unknown>): GetStoreNoticesDto {
  return input as unknown as GetStoreNoticesDto;
}

const MOCK_KEYS = [
  'id',
  'priority',
  'notice',
  'description',
  'effective_from',
  'expired_at',
  'type',
  'created_by',
  'updated_by',
  'created_at',
  'updated_at',
  'deleted_at',
  'is_read',
  'creator_role',
  'creator',
  'users',
  'shops',
  'read_status',
];

describe('StoreNoticesService', () => {
  let service: StoreNoticesService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new StoreNoticesService();
  });

  describe('proyección', () => {
    it('las 18 claves del mock en su orden, fechas de vigencia sin T ni zona', async () => {
      findMock.mockResolvedValue(makeRecord());
      const dto = (await service.getStoreNotice('2', 3)) as unknown as Record<
        string,
        unknown
      >;
      expect(Object.keys(dto)).toEqual(MOCK_KEYS);
      expect(dto.effective_from).toBe('2023-03-15 12:00:00');
      expect(dto.expired_at).toBe('2023-03-30 12:00:00');
      expect(dto.deleted_at).toBeNull();
      expect(dto.creator_role).toBe('Super admin');
    });

    it('is_read es el del viewer (V-5): true para el admin, false para el dueño', async () => {
      findMock.mockResolvedValue(makeRecord());
      expect((await service.getStoreNotice('2', 3)).is_read).toBe(true);
      expect((await service.getStoreNotice('2', 1)).is_read).toBe(false);
      expect((await service.getStoreNotice('2', 99)).is_read).toBe(false);
    });

    it('creator, users y read_status con la forma del mock: is_active y pivot.is_read enteros', async () => {
      findMock.mockResolvedValue(makeRecord());
      const dto = (await service.getStoreNotice('2', 3)) as unknown as {
        creator: {
          is_active: number;
          shop_id: null;
          permissions: { pivot: unknown }[];
        };
        users: { pivot: unknown }[];
        read_status: { pivot: unknown }[];
      };
      expect(dto.creator.is_active).toBe(1);
      expect(dto.creator.shop_id).toBeNull();
      expect(dto.creator.permissions[0].pivot).toEqual({
        model_id: 3,
        permission_id: 1,
        model_type: 'Marvel\\Database\\Models\\User',
      });
      expect(dto.users.map((u) => u.pivot)).toEqual([
        { store_notice_id: 2, user_id: 3 },
        { store_notice_id: 2, user_id: 1 },
      ]);
      expect(dto.read_status.map((u) => u.pivot)).toEqual([
        { store_notice_id: 2, user_id: 3, is_read: 1 },
        { store_notice_id: 2, user_id: 1, is_read: 0 },
      ]);
    });

    it.each([
      [['customer', 'store_owner'], 'Store owner'],
      [['customer', 'staff'], 'Staff'],
      [['customer'], 'Customer'],
      [['super_admin', 'customer', 'store_owner'], 'Super admin'],
      [[], null],
    ])(
      'creator_role toma el permiso más alto: %j ⇒ %j (textos confirmados el 2026-10-22)',
      async (names, expected) => {
        findMock.mockResolvedValue(
          makeRecord({
            creator: {
              ...OWNER,
              permissions: names.map((name, i) => ({
                id: i + 1,
                name,
                guardName: 'api',
                createdAt: T,
                updatedAt: T,
              })),
            },
          }),
        );
        expect((await service.getStoreNotice('2', 3)).creator_role).toBe(
          expected,
        );
      },
    );
  });

  describe('getStoreNotices', () => {
    it('traduce users.id, shops.slug, shop_id y notice a filtros (V-4)', async () => {
      listMock.mockResolvedValue({ items: [], total: 0 });
      await service.getStoreNotices(
        query({
          search: 'notice:Maint;users.id:1;shops.slug:bags-shop',
          shop_id: '7',
        }),
        3,
      );
      expect(listMock).toHaveBeenCalledWith({
        notice: 'Maint',
        userId: 1,
        shopId: 7,
        shopSlug: 'bags-shop',
        page: 1,
        limit: 12,
      });
    });

    it('respeta orderBy=updated_at&sortedBy=desc de la barra superior', async () => {
      listMock.mockResolvedValue({ items: [], total: 0 });
      await service.getStoreNotices(
        query({ limit: '5', orderBy: 'updated_at', sortedBy: 'desc' }),
        3,
      );
      expect(listMock.mock.calls[0][0]).toMatchObject({
        orderBy: 'updatedAt',
        sortedBy: 'desc',
        limit: 5,
      });
    });

    it('conserva per_page string y la url base del mock; id mal formado ⇒ página vacía', async () => {
      listMock.mockResolvedValue({ items: [makeRecord()], total: 1 });
      const page = await service.getStoreNotices(query({ limit: '5' }), 3);
      expect(page.per_page).toBe('5');
      expect(page.first_page_url).toBe(
        'http://localhost:5000/api/store-notices?search=undefined&limit=5&page=1',
      );
      listMock.mockClear();
      const empty = await service.getStoreNotices(
        query({ search: 'users.id:abc' }),
        3,
      );
      expect(empty.total).toBe(0);
      expect(listMock).not.toHaveBeenCalled();
    });
  });

  describe('escrituras', () => {
    it('create: autor del token, fechas parseadas y received_by numérico', async () => {
      createMock.mockResolvedValue(makeRecord());
      await service.create(
        {
          priority: 'high',
          notice: 'N',
          description: 'D',
          type: 'specific_vendor',
          effective_from: '2026-11-01T00:00:00.000Z',
          expired_at: '2026-12-01T00:00:00.000Z',
          received_by: ['1'],
        } as unknown as CreateStoreNoticeDto,
        3,
      );
      expect(createMock).toHaveBeenCalledWith({
        priority: 'high',
        notice: 'N',
        description: 'D',
        effectiveFrom: new Date('2026-11-01T00:00:00.000Z'),
        expiredAt: new Date('2026-12-01T00:00:00.000Z'),
        type: 'specific_vendor',
        receivedBy: [1],
        createdBy: 3,
      });
    });

    it('received_by inexistente ⇒ 400', async () => {
      createMock.mockRejectedValue(
        new InvalidReferenceError('store_notices', 'received_by', 999),
      );
      await expect(
        service.create(
          {
            priority: 'high',
            notice: 'N',
            type: 'specific_vendor',
            expired_at: '2026-12-01',
            received_by: [999],
          } as unknown as CreateStoreNoticeDto,
          3,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('update fija updatedBy con el usuario del token', async () => {
      updateMock.mockResolvedValue(makeRecord());
      await service.update(2, { notice: 'Editado' }, 3);
      expect(updateMock).toHaveBeenCalledWith(2, {
        notice: 'Editado',
        updatedBy: 3,
      });
    });

    it('markAsRead (V-6) proyecta para el lector; aviso inexistente o id inválido ⇒ 404', async () => {
      readMock.mockResolvedValueOnce(
        makeRecord({ reads: [{ user: OWNER, isRead: true }] }),
      );
      expect((await service.markAsRead(2, 1)).is_read).toBe(true);
      expect(readMock).toHaveBeenCalledWith(2, 1);
      readMock.mockRejectedValueOnce(
        new RecordNotFoundError('store_notices', 9),
      );
      await expect(service.markAsRead(9, 1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.markAsRead('abc', 1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('remove devuelve el aviso; id inválido ⇒ 404 sin tocar el driver', async () => {
      deleteMock.mockResolvedValue(makeRecord());
      expect((await service.remove(2, 3)).id).toBe(2);
      await expect(service.remove(0, 3)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(deleteMock).toHaveBeenCalledTimes(1);
    });
  });
});
