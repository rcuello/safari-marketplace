/// <reference types="jest" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de jest.
 */
/**
 * Tests unitarios de `CouponsService` (US-52). Mismo arnés que
 * `attributes.service.spec.ts`: solo se mockea el acceso a datos. El reloj
 * es el real de `@safari/db` y se fija con `_setNowProvider`.
 */
import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  _setNowProvider,
  createCoupon,
  deleteCoupon,
  findCouponByCode,
  findCouponById,
  findShopOwnerById,
  isShopStaff,
  listCoupons,
  RecordNotFoundError,
  setCouponApproval,
  SlugConflictError,
  updateCoupon,
  type CouponRecord,
} from '@safari/db';
import { CurrentUserPayload } from 'src/auth/decorators/current-user.decorator';
import { CouponsService, INVALID_COUPON_MESSAGE } from './coupons.service';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { GetCouponsDto } from './dto/get-coupons.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { VerifyCouponInput } from './dto/verify-coupon.dto';

jest.mock('@safari/db', () => ({
  ...jest.requireActual<typeof import('@safari/db')>('@safari/db'),
  listCoupons: jest.fn(),
  findCouponByCode: jest.fn(),
  findCouponById: jest.fn(),
  createCoupon: jest.fn(),
  updateCoupon: jest.fn(),
  deleteCoupon: jest.fn(),
  setCouponApproval: jest.fn(),
  findShopOwnerById: jest.fn(),
  isShopStaff: jest.fn(),
}));

const listMock = jest.mocked(listCoupons);
const findByCodeMock = jest.mocked(findCouponByCode);
const findByIdMock = jest.mocked(findCouponById);
const createMock = jest.mocked(createCoupon);
const updateMock = jest.mocked(updateCoupon);
const deleteMock = jest.mocked(deleteCoupon);
const approvalMock = jest.mocked(setCouponApproval);
const ownerMock = jest.mocked(findShopOwnerById);
const staffMock = jest.mocked(isShopStaff);

const NOW = new Date('2026-10-22T12:00:00.000Z');
const OWNER = 1;
const STAFF = 2;

const ADMIN_USER: CurrentUserPayload = {
  sub: 3,
  email: 'admin@demo.com',
  permissions: ['super_admin', 'customer', 'store_owner'],
  iat: 0,
  exp: 0,
};
const OWNER_USER: CurrentUserPayload = {
  sub: OWNER,
  email: 'store_owner@demo.com',
  permissions: ['customer', 'store_owner'],
  iat: 0,
  exp: 0,
};
/** Staff de la tienda 1 por fila en `shop_staff` (US-66, Ampliación). */
const STAFF_USER: CurrentUserPayload = {
  sub: STAFF,
  email: 'customer@demo.com',
  permissions: ['customer', 'staff'],
  iat: 0,
  exp: 0,
};

function makeRecord(overrides: Partial<CouponRecord> = {}): CouponRecord {
  return {
    id: 10,
    code: '4OFF',
    description: null,
    image: { thumbnail: 't.jpg', original: 'o.png', id: 924 },
    type: 'fixed',
    amount: 4,
    minimumCartAmount: 160,
    activeFrom: new Date('2021-03-28T05:46:42.000Z'),
    expireAt: new Date('2024-03-28T05:46:42.000Z'),
    target: true,
    isApprove: true,
    shopId: 1,
    userId: null,
    language: 'en',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** Vigente respecto de NOW. */
const IN_FORCE = {
  activeFrom: new Date('2026-01-01T00:00:00.000Z'),
  expireAt: new Date('2027-01-01T00:00:00.000Z'),
};

describe('CouponsService', () => {
  let service: CouponsService;

  beforeEach(() => {
    jest.resetAllMocks();
    _setNowProvider(() => NOW);
    service = new CouponsService();
  });

  afterAll(() => _setNowProvider(() => new Date()));

  describe('DTO', () => {
    it('emite las 16 claves del mock en su orden, con 1/0 y la imagen tal cual', async () => {
      findByCodeMock.mockResolvedValue(makeRecord());
      expect(JSON.stringify(await service.getCoupon('4OFF'))).toBe(
        '{"id":10,"code":"4OFF","language":"en","description":null,' +
          '"image":{"thumbnail":"t.jpg","original":"o.png","id":924},"type":"fixed",' +
          '"amount":4,"minimum_cart_amount":160,"active_from":"2021-03-28T05:46:42.000Z",' +
          '"expire_at":"2024-03-28T05:46:42.000Z","is_valid":false,"target":1,"is_approve":1,' +
          '"translated_languages":["en"],"shop_id":1,"user_id":null}',
      );
    });

    it('is_valid sale de la vigencia con el reloj: true dentro, false en el borde de expire_at', async () => {
      findByCodeMock.mockResolvedValue(makeRecord(IN_FORCE));
      expect((await service.getCoupon('X')).is_valid).toBe(true);
      _setNowProvider(() => IN_FORCE.expireAt);
      expect((await service.getCoupon('X')).is_valid).toBe(false);
      _setNowProvider(() => IN_FORCE.activeFrom);
      expect((await service.getCoupon('X')).is_valid).toBe(true);
    });
  });

  describe('getCoupons', () => {
    it('defaults page=1/limit=12 y la url del mock con search=undefined', async () => {
      listMock.mockResolvedValue({ items: [makeRecord()], total: 1 });
      const result = await service.getCoupons({} as GetCouponsDto);
      expect(listMock).toHaveBeenCalledWith({
        shopId: undefined,
        code: undefined,
        page: 1,
        limit: 12,
      });
      expect(result.per_page).toBe(12);
      expect(result.first_page_url).toBe(
        'http://localhost:5000/api/coupons?search=undefined&limit=12&page=1',
      );
    });

    it('combina shop_id y code con AND y deja per_page como llegó por query', async () => {
      listMock.mockResolvedValue({ items: [], total: 0 });
      const result = await service.getCoupons({
        shop_id: '2',
        search: 'code:BAZAR',
        limit: '20',
      } as unknown as GetCouponsDto);
      expect(listMock).toHaveBeenCalledWith({
        shopId: 2,
        code: 'BAZAR',
        page: 1,
        limit: 20,
      });
      expect(result.per_page).toBe('20');
    });

    it('un shop_id no numérico devuelve la lista vacía sin consultar', async () => {
      const result = await service.getCoupons({
        shop_id: 'abc',
      } as unknown as GetCouponsDto);
      expect(listMock).not.toHaveBeenCalled();
      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('un fallo de conexión es 503', async () => {
      listMock.mockRejectedValue(
        Object.assign(new Error('down'), {
          name: 'PrismaClientInitializationError',
        }),
      );
      await expect(
        service.getCoupons({} as GetCouponsDto),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  it('getCoupon con un código desconocido es 404', async () => {
    findByCodeMock.mockResolvedValue(null);
    await expect(service.getCoupon('NOEXISTE')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  describe('verifyCoupon', () => {
    const INVALID = { is_valid: false, message: INVALID_COUPON_MESSAGE };

    it.each<[string, Partial<CouponRecord> | null, unknown]>([
      ['código inexistente', null, 10],
      ['vencido (4OFF del seed)', {}, 500],
      ['vigente con mínimo 160 y sub_total 100', { ...IN_FORCE }, 100],
      [
        'vigente pero no aprobado',
        { ...IN_FORCE, isApprove: false, minimumCartAmount: 0 },
        500,
      ],
      ['sub_total ausente cuenta como 0', { ...IN_FORCE }, undefined],
      ['sub_total no numérico cuenta como 0', { ...IN_FORCE }, 'mucho'],
    ])('%s ⇒ is_valid false sin coupon', async (_caso, overrides, subTotal) => {
      findByCodeMock.mockResolvedValue(
        overrides ? makeRecord(overrides) : null,
      );
      expect(
        await service.verifyCoupon({
          code: 'X',
          sub_total: subTotal as number,
        }),
      ).toEqual(INVALID);
    });

    it('vigente, aprobado y con sub_total suficiente ⇒ is_valid true con el DTO', async () => {
      findByCodeMock.mockResolvedValue(makeRecord(IN_FORCE));
      const result = await service.verifyCoupon({
        code: '4OFF',
        sub_total: 160,
      });
      expect(result.is_valid).toBe(true);
      expect(result).toMatchObject({
        coupon: { id: 10, is_valid: true, is_approve: 1 },
      });
    });

    it('sin code no consulta la base', async () => {
      expect(await service.verifyCoupon({} as VerifyCouponInput)).toEqual(
        INVALID,
      );
      expect(findByCodeMock).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    const DTO = {
      code: 'zz-coupon-a',
      type: 'fixed',
      amount: '5',
      minimum_cart_amount: 0,
      active_from: '2026-01-01T00:00:00.000Z',
      expire_at: '2027-01-01T00:00:00.000Z',
      shop_id: 1,
    } as unknown as CreateCouponDto;

    it('el dueño crea en su tienda: autor = token, importes y fechas convertidos', async () => {
      ownerMock.mockResolvedValue(OWNER);
      createMock.mockResolvedValue(makeRecord({ isApprove: false }));
      const result = await service.create(DTO, OWNER_USER);
      expect(createMock).toHaveBeenCalledWith({
        code: 'zz-coupon-a',
        type: 'fixed',
        amount: 5,
        minimumCartAmount: 0,
        activeFrom: new Date('2026-01-01T00:00:00.000Z'),
        expireAt: new Date('2027-01-01T00:00:00.000Z'),
        shopId: 1,
        userId: OWNER,
      });
      expect(result.is_approve).toBe(0);
    });

    it('tienda ajena ⇒ 403 sin escribir', async () => {
      ownerMock.mockResolvedValue(99);
      await expect(service.create(DTO, OWNER_USER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(createMock).not.toHaveBeenCalled();
    });

    it('cupón global: 403 para el dueño, permitido al super_admin sin consultar tiendas', async () => {
      const global = {
        ...DTO,
        shop_id: undefined,
      } as unknown as CreateCouponDto;
      await expect(service.create(global, OWNER_USER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      createMock.mockResolvedValue(makeRecord({ shopId: null }));
      await service.create(global, ADMIN_USER);
      expect(ownerMock).not.toHaveBeenCalled();
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ shopId: null, userId: 3 }),
      );
    });

    it('shop_id no numérico ⇒ 400; código duplicado ⇒ 409', async () => {
      await expect(
        service.create(
          { ...DTO, shop_id: 'x' } as unknown as CreateCouponDto,
          ADMIN_USER,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      createMock.mockRejectedValue(new SlugConflictError('coupons', 'code'));
      await expect(service.create(DTO, ADMIN_USER)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('update / remove', () => {
    it('el dueño edita un cupón de su tienda: sin shop_id en el input', async () => {
      findByIdMock.mockResolvedValue(makeRecord());
      ownerMock.mockResolvedValue(OWNER);
      updateMock.mockResolvedValue(makeRecord({ amount: 8 }));
      const result = await service.update(
        10,
        { amount: 8, shop_id: 2 } as unknown as UpdateCouponDto,
        OWNER_USER,
      );
      expect(updateMock).toHaveBeenCalledWith(10, { amount: 8 });
      expect(result.amount).toBe(8);
    });

    it('cupón de otra tienda o global ⇒ 403; inexistente ⇒ 404', async () => {
      findByIdMock.mockResolvedValue(makeRecord({ shopId: 2 }));
      ownerMock.mockResolvedValue(99);
      await expect(service.remove(10, OWNER_USER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      findByIdMock.mockResolvedValue(makeRecord({ shopId: null }));
      await expect(service.update(10, {}, OWNER_USER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      findByIdMock.mockResolvedValue(null);
      await expect(service.remove(10, OWNER_USER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(deleteMock).not.toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();
    });

    it('super_admin no consulta la fila; el 404 llega del repositorio', async () => {
      deleteMock.mockRejectedValue(new RecordNotFoundError('coupons', 10));
      await expect(service.remove(10, ADMIN_USER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(findByIdMock).not.toHaveBeenCalled();
      await expect(
        service.remove(Number.NaN, ADMIN_USER),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('remove devuelve el DTO borrado', async () => {
      deleteMock.mockResolvedValue(makeRecord());
      expect((await service.remove(10, ADMIN_USER)).code).toBe('4OFF');
    });
  });

  /**
   * US-66 (Ampliación, Decisión 2 cerrada): `assertCanManage` admite al staff
   * de la tienda (fila en `shop_staff`), consultado solo si no es dueño.
   * `jest.resetAllMocks()` deja `isShopStaff` en `undefined` (falsy) para el
   * resto de casos, que siguen significando «sin fila».
   */
  describe('staff de la tienda (US-66, Ampliación)', () => {
    const DTO = {
      code: 'zz-coupon-staff',
      type: 'fixed',
      amount: '5',
      active_from: '2026-01-01T00:00:00.000Z',
      expire_at: '2027-01-01T00:00:00.000Z',
      shop_id: 1,
    } as unknown as CreateCouponDto;

    it('crea en su tienda: dueño consultado primero, luego shop_staff con (sub, shop_id)', async () => {
      ownerMock.mockResolvedValue(OWNER);
      staffMock.mockResolvedValue(true);
      createMock.mockResolvedValue(makeRecord({ isApprove: false }));
      await service.create(DTO, STAFF_USER);
      expect(ownerMock).toHaveBeenCalledWith(1);
      expect(staffMock).toHaveBeenCalledWith(STAFF, 1);
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ shopId: 1, userId: STAFF }),
      );
    });

    it('staff de OTRA tienda ⇒ 403 sin escribir', async () => {
      ownerMock.mockResolvedValue(OWNER);
      staffMock.mockResolvedValue(false);
      await expect(
        service.create(
          { ...DTO, shop_id: 5 } as unknown as CreateCouponDto,
          STAFF_USER,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(staffMock).toHaveBeenCalledWith(STAFF, 5);
      expect(createMock).not.toHaveBeenCalled();
    });

    it('cupón global ⇒ 403 para el staff sin consultar tiendas ni shop_staff', async () => {
      await expect(
        service.create(
          { ...DTO, shop_id: undefined } as unknown as CreateCouponDto,
          STAFF_USER,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(ownerMock).not.toHaveBeenCalled();
      expect(staffMock).not.toHaveBeenCalled();
    });

    it('edita y borra un cupón de su tienda; de otra tienda ⇒ 403', async () => {
      findByIdMock.mockResolvedValue(makeRecord({ shopId: 1 }));
      ownerMock.mockResolvedValue(OWNER);
      staffMock.mockImplementation(async (_userId, shopId) => shopId === 1);
      updateMock.mockResolvedValue(makeRecord({ amount: 8 }));
      deleteMock.mockResolvedValue(makeRecord());
      expect((await service.update(10, { amount: 8 }, STAFF_USER)).amount).toBe(
        8,
      );
      expect((await service.remove(10, STAFF_USER)).code).toBe('4OFF');

      findByIdMock.mockResolvedValue(makeRecord({ shopId: 2 }));
      await expect(
        service.update(10, { amount: 9 }, STAFF_USER),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.remove(10, STAFF_USER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(staffMock).toHaveBeenCalledWith(STAFF, 2);
      expect(updateMock).toHaveBeenCalledTimes(1);
      expect(deleteMock).toHaveBeenCalledTimes(1);
    });

    it('el dueño y el super_admin no consultan shop_staff', async () => {
      ownerMock.mockResolvedValue(OWNER);
      createMock.mockResolvedValue(makeRecord());
      await service.create(DTO, OWNER_USER);
      await service.create(DTO, ADMIN_USER);
      expect(ownerMock).toHaveBeenCalledTimes(1);
      expect(staffMock).not.toHaveBeenCalled();
    });

    it('tienda inexistente (dueño null) pasa al repositorio sin consultar shop_staff', async () => {
      ownerMock.mockResolvedValue(null);
      createMock.mockResolvedValue(makeRecord({ shopId: 777 }));
      await service.create(
        { ...DTO, shop_id: 777 } as unknown as CreateCouponDto,
        STAFF_USER,
      );
      expect(staffMock).not.toHaveBeenCalled();
      expect(createMock).toHaveBeenCalled();
    });
  });

  describe('setApproval', () => {
    it('persiste y emite is_approve como 1/0', async () => {
      approvalMock.mockResolvedValue(makeRecord({ isApprove: false }));
      expect((await service.setApproval('10', false)).is_approve).toBe(0);
      expect(approvalMock).toHaveBeenCalledWith(10, false);
    });

    it('id no numérico o inexistente ⇒ 404', async () => {
      await expect(service.setApproval('abc', true)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      approvalMock.mockRejectedValue(new RecordNotFoundError('coupons', 999));
      await expect(service.setApproval(999, true)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
