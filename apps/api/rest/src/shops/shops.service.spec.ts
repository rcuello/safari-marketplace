/// <reference types="jest" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de jest;
 * se limita a este archivo para no tocar la config del build.
 */
/**
 * Tests unitarios del mapeo de errores de base en los 2 endpoints de shops
 * migrados en US-5 (`getNewShops`, `getNearByShop`).
 *
 * Cierra el MUST "Errores de conexión a Postgres" de la spec
 * `derived-catalog-api` para el lado de shops: ambos métodos replican el
 * mismo `try/catch` a mano que los de products, así que sin esto una
 * regresión del mapeo 503/500 pasaba inadvertida.
 *
 * Mismo arnés que `products.service.spec.ts`: se mockea SOLO el acceso a
 * datos (`listShops` / `listShopsNear`) y se dejan REALES
 * `isPrismaConnectionError` / `getUserFriendlyMessage` (jest.requireActual),
 * para que la clasificación del error se pruebe de verdad y sin base.
 */
import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createShop,
  findShopOwnerById,
  InvalidReferenceError,
  listShops,
  listShopsNear,
  RecordNotFoundError,
  setShopActive,
  SlugConflictError,
  updateShop,
  type ShopRecord,
} from '@safari/db';
import { ShopsService, toShopDto } from './shops.service';
import { GetShopsDto } from './dto/get-shops.dto';
import { GetStaffsDto } from './dto/get-staffs.dto';
import { CreateShopDto } from './dto/create-shop.dto';
import { UpdateShopDto } from './dto/update-shop.dto';
import type { CurrentUserPayload } from 'src/auth/decorators/current-user.decorator';

jest.mock('@safari/db', () => ({
  // El barrel es seguro de cargar sin DATABASE_URL (cliente lazy vía Proxy);
  // se conservan reales las clases de error de dominio y `toWriteHttpException`
  // (via `domain-error.mapper.ts`, tampoco mockeado) — solo se mockea el
  // acceso a datos de las 4 escrituras de US-30 (PR#4, task 4.1).
  ...jest.requireActual<typeof import('@safari/db')>('@safari/db'),
  listShops: jest.fn(),
  listShopsNear: jest.fn(),
  createShop: jest.fn(),
  updateShop: jest.fn(),
  setShopActive: jest.fn(),
  findShopOwnerById: jest.fn(),
}));

const listShopsMock = jest.mocked(listShops);
const listShopsNearMock = jest.mocked(listShopsNear);
const createShopMock = jest.mocked(createShop);
const updateShopMock = jest.mocked(updateShop);
const setShopActiveMock = jest.mocked(setShopActive);
const findShopOwnerByIdMock = jest.mocked(findShopOwnerById);

const WRITE_NOW = new Date('2026-09-11T00:00:00Z');

function makeShopRecord(overrides: Partial<ShopRecord> = {}): ShopRecord {
  return {
    id: 20,
    name: 'Tienda Prueba',
    slug: 'tienda-prueba',
    description: null,
    ownerId: 1,
    isActive: false,
    logo: null,
    coverImage: null,
    address: {},
    settings: {},
    createdAt: WRITE_NOW,
    updatedAt: WRITE_NOW,
    productsCount: 0,
    ...overrides,
  };
}

function makeUser(overrides: Partial<CurrentUserPayload> = {}): CurrentUserPayload {
  return {
    sub: 1,
    email: 'store-owner@demo.com',
    permissions: ['store_owner'],
    iat: 0,
    exp: 0,
    ...overrides,
  };
}

function superAdmin(): CurrentUserPayload {
  return makeUser({
    sub: 3,
    email: 'admin@demo.com',
    permissions: ['super_admin'],
  });
}

/**
 * `ValidationPipe` corre sin `whitelist` (`main.ts:9`): en runtime el body
 * puede traer claves sin columna (`owner_id`, `is_active`, `slug`, `balance`,
 * `categories`) que sobreviven hasta el servicio. Mismo cast-precedente que
 * `manufacturers.service.spec.ts:106-116`.
 */
function createDto(
  input: Partial<CreateShopDto> & Record<string, unknown>,
): CreateShopDto {
  return input as unknown as CreateShopDto;
}

function updateDto(
  input: Partial<UpdateShopDto> & Record<string, unknown>,
): UpdateShopDto {
  return input as unknown as UpdateShopDto;
}

/**
 * `ValidationPipe` corre sin `transform`: en runtime los query params llegan
 * como strings crudos aunque el DTO declare números. Mismo cast-precedente
 * que usa `products.service.spec.ts`.
 */
function rawQuery(
  query: Record<string, string | number | undefined>,
): GetShopsDto {
  return query as unknown as GetShopsDto;
}

describe('endpoints derivados de shops — mapeo de errores de base (US-5)', () => {
  let service: ShopsService;

  beforeEach(() => {
    listShopsMock.mockReset();
    listShopsNearMock.mockReset();
    service = new ShopsService();
  });

  const connectionError = () => {
    const error = new Error("Can't reach database server at `localhost:5433`");
    error.name = 'PrismaClientInitializationError';
    return error;
  };

  describe('getNewShops', () => {
    it('error de conexión → 503 con mensaje amigable', async () => {
      listShopsMock.mockRejectedValue(connectionError());

      expect.assertions(3);
      try {
        await service.getNewShops(rawQuery({ limit: '10', page: '1' }));
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceUnavailableException);
        expect((error as ServiceUnavailableException).getStatus()).toBe(503);
        expect((error as ServiceUnavailableException).message).toBe(
          'No se puede conectar con el servicio. Por favor, intenta más tarde.',
        );
      }
    });

    it('cualquier otro error → 500, sin crashear el proceso', async () => {
      listShopsMock.mockRejectedValue(new Error('boom inesperado'));

      expect.assertions(3);
      try {
        await service.getNewShops(rawQuery({ limit: '10', page: '1' }));
      } catch (error) {
        expect(error).toBeInstanceOf(InternalServerErrorException);
        expect((error as InternalServerErrorException).getStatus()).toBe(500);
        expect((error as InternalServerErrorException).message).toBe(
          'Ocurrió un error inesperado. Por favor, contacta al administrador.',
        );
      }
    });
  });

  describe('getNearByShop', () => {
    it('error de conexión → 503 con mensaje amigable', async () => {
      listShopsNearMock.mockRejectedValue(connectionError());

      expect.assertions(3);
      try {
        await service.getNearByShop('40.7128', '-74.0060');
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceUnavailableException);
        expect((error as ServiceUnavailableException).getStatus()).toBe(503);
        expect((error as ServiceUnavailableException).message).toBe(
          'No se puede conectar con el servicio. Por favor, intenta más tarde.',
        );
      }
    });

    it('cualquier otro error → 500, sin crashear el proceso', async () => {
      listShopsNearMock.mockRejectedValue(new Error('boom inesperado'));

      expect.assertions(3);
      try {
        await service.getNearByShop('40.7128', '-74.0060');
      } catch (error) {
        expect(error).toBeInstanceOf(InternalServerErrorException);
        expect((error as InternalServerErrorException).getStatus()).toBe(500);
        expect((error as InternalServerErrorException).message).toBe(
          'Ocurrió un error inesperado. Por favor, contacta al administrador.',
        );
      }
    });

    // Guarda de B-4: `lat`/`lng` no finitos NO deben propagarse como error.
    // La tienda dispara `/near-by-shop/undefined/undefined` en cada carga de
    // `/shops` (useQuery sin `enabled`), así que un 4xx/5xx aquí rompería la
    // página entera. El guard real vive en el repositorio; esto asegura que
    // el servicio no lo estropea al traducir.
    it('lat/lng no finitos: devuelve lo que dé el repositorio, sin lanzar', async () => {
      listShopsNearMock.mockResolvedValue([]);

      await expect(
        service.getNearByShop('undefined', 'undefined'),
      ).resolves.toEqual([]);
      expect(listShopsNearMock).toHaveBeenCalledWith(NaN, NaN);
    });
  });
});

/**
 * Tests unitarios de las escrituras de `ShopsService` (US-30, PR#4):
 * `create`/`update`/`approveShop`/`disapproveShop`/`createStaff`/
 * `updateStaff`/`getStaffs`.
 *
 * Mismo arnés que `manufacturers.service.spec.ts`: se mockea SOLO el acceso a
 * datos (`createShop`/`updateShop`/`setShopActive`/`findShopOwnerById`) y se
 * dejan REALES las clases de error de dominio y `toWriteHttpException`
 * (`domain-error.mapper.ts`, tampoco mockeado), para que la traducción a HTTP
 * se pruebe de verdad.
 */
describe('ShopsService.create (US-30)', () => {
  let service: ShopsService;

  beforeEach(() => {
    createShopMock.mockReset();
    service = new ShopsService();
  });

  it('ownerId sale SIEMPRE de user.sub, nunca del body — un `owner_id` inyectado en el body se ignora (D30-3)', async () => {
    createShopMock.mockResolvedValue(makeShopRecord({ ownerId: 1 }));

    await service.create(
      createDto({ name: 'Tienda Prueba', owner_id: 999 } as never),
      makeUser({ sub: 1 }),
    );

    expect(createShopMock).toHaveBeenCalledTimes(1);
    const input = createShopMock.mock.calls[0][0];
    expect(input.ownerId).toBe(1);
    expect('owner_id' in input).toBe(false);
  });

  it('`is_active` por rol: store_owner → false (cola de moderación), super_admin → true (D30-6)', async () => {
    createShopMock.mockResolvedValue(makeShopRecord({ isActive: false }));
    await service.create(
      createDto({ name: 'Tienda Prueba' }),
      makeUser({ sub: 1, permissions: ['store_owner'] }),
    );
    expect(createShopMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ isActive: false }),
    );

    createShopMock.mockResolvedValue(makeShopRecord({ isActive: true }));
    await service.create(createDto({ name: 'Tienda Admin' }), superAdmin());
    expect(createShopMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ isActive: true }),
    );
  });

  it('proyecta `CreateShopInput` campo a campo (nunca `...dto`), ignora `balance`/`categories`', async () => {
    createShopMock.mockResolvedValue(makeShopRecord());

    await service.create(
      createDto({
        name: 'Tienda Prueba',
        description: 'desc-sonda',
        logo: { id: 1 } as never,
        cover_image: { id: 2 } as never,
        address: { city: 'x' } as never,
        settings: { location: {} } as never,
        balance: { total: 1 } as never,
        categories: [1, 2] as never,
      } as never),
      makeUser({ sub: 1, permissions: ['store_owner'] }),
    );

    const input = createShopMock.mock.calls[0][0];
    expect(input).toEqual({
      name: 'Tienda Prueba',
      ownerId: 1,
      isActive: false,
      description: 'desc-sonda',
      logo: { id: 1 },
      coverImage: { id: 2 },
      address: { city: 'x' },
      settings: { location: {} },
    });
    expect('balance' in input).toBe(false);
    expect('categories' in input).toBe(false);
  });

  it('proyección de 16 claves, mismo orden que `toShopDto` (contrato de la lectura)', async () => {
    const record = makeShopRecord();
    createShopMock.mockResolvedValue(record);

    const result = await service.create(
      createDto({ name: 'Tienda Prueba' }),
      makeUser(),
    );

    const expectedKeys = Object.keys(toShopDto(record));
    expect(expectedKeys).toHaveLength(16);
    expect(Object.keys(result)).toEqual(expectedKeys);
  });

  it('RecordNotFoundError del repositorio → 404 (vía `toWriteHttpException`)', async () => {
    createShopMock.mockRejectedValue(new RecordNotFoundError('shops', 99999));

    expect.assertions(2);
    try {
      await service.create(createDto({ name: 'x' }), makeUser());
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getStatus()).toBe(404);
    }
  });

  it('InvalidReferenceError del repositorio (`owner_id` inexistente, P2003) → 400', async () => {
    createShopMock.mockRejectedValue(
      new InvalidReferenceError('shops', 'ownerId', 999999),
    );

    expect.assertions(2);
    try {
      await service.create(createDto({ name: 'x' }), makeUser());
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
    }
  });

  it('SlugConflictError del repositorio (P2002, solo por carrera) → 409', async () => {
    createShopMock.mockRejectedValue(new SlugConflictError('shops', 'tienda'));

    expect.assertions(2);
    try {
      await service.create(createDto({ name: 'Tienda' }), makeUser());
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getStatus()).toBe(409);
    }
  });
});

describe('ShopsService.update (US-30)', () => {
  let service: ShopsService;

  beforeEach(() => {
    updateShopMock.mockReset();
    findShopOwnerByIdMock.mockReset();
    service = new ShopsService();
  });

  it('id no entero (`NaN`) → 404 sin llamar a `findShopOwnerById` ni a `updateShop` (guarda numérica primero, DD30-3)', async () => {
    expect.assertions(4);
    try {
      await service.update(Number.NaN, updateDto({ name: 'x' }), makeUser());
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getStatus()).toBe(404);
      expect(findShopOwnerByIdMock).not.toHaveBeenCalled();
      expect(updateShopMock).not.toHaveBeenCalled();
    }
  });

  it('id `<= 0` (`0`, negativo) → 404 sin llamar al repositorio', async () => {
    expect.assertions(6);
    for (const id of [0, -5]) {
      try {
        await service.update(id, updateDto({ name: 'x' }), makeUser());
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect((error as NotFoundException).getStatus()).toBe(404);
        expect(updateShopMock).not.toHaveBeenCalled();
      }
    }
  });

  it('tienda inexistente (`findShopOwnerById` → `null`) → 404, NUNCA 403 — ni siquiera para `super_admin` (404 antes que 403, DD30-3)', async () => {
    findShopOwnerByIdMock.mockResolvedValue(null);

    expect.assertions(2);
    try {
      await service.update(99999, updateDto({ name: 'x' }), superAdmin());
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getStatus()).toBe(404);
    }
  });

  it('`store_owner` que NO es el dueño → 403, `updateShop` nunca se llama', async () => {
    findShopOwnerByIdMock.mockResolvedValue(9);

    expect.assertions(3);
    try {
      await service.update(
        20,
        updateDto({ name: 'x' }),
        makeUser({ sub: 1, permissions: ['store_owner'] }),
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getStatus()).toBe(403);
      expect(updateShopMock).not.toHaveBeenCalled();
    }
  });

  it('`store_owner` dueño de la tienda → 200', async () => {
    findShopOwnerByIdMock.mockResolvedValue(1);
    updateShopMock.mockResolvedValue(makeShopRecord({ ownerId: 1 }));

    const result = await service.update(
      20,
      updateDto({ name: 'x' }),
      makeUser({ sub: 1, permissions: ['store_owner'] }),
    );

    expect(result.owner_id).toBe(1);
    expect(updateShopMock).toHaveBeenCalledTimes(1);
  });

  it('`super_admin` edita una tienda ajena → 200, salta el 403 (nunca el 404)', async () => {
    findShopOwnerByIdMock.mockResolvedValue(9);
    updateShopMock.mockResolvedValue(makeShopRecord({ ownerId: 9 }));

    const result = await service.update(20, updateDto({ name: 'x' }), superAdmin());

    expect(result.owner_id).toBe(9);
    expect(updateShopMock).toHaveBeenCalledTimes(1);
  });

  it('proyecta `UpdateShopInput` campo a campo, ignora `balance`/`categories`, NUNCA envía `slug` (inmutable, DD30-2)', async () => {
    findShopOwnerByIdMock.mockResolvedValue(1);
    updateShopMock.mockResolvedValue(makeShopRecord({ ownerId: 1 }));

    await service.update(
      20,
      updateDto({
        name: 'Renombrada',
        description: 'nueva desc',
        logo: { id: 1 } as never,
        cover_image: { id: 2 } as never,
        address: { city: 'x' } as never,
        settings: { location: { lat: 1, lng: 2 } } as never,
        slug: 'intento-de-cambiar' as never,
        balance: { total: 100 } as never,
        categories: [1, 2] as never,
      } as never),
      makeUser({ sub: 1, permissions: ['store_owner'] }),
    );

    const [, input] = updateShopMock.mock.calls[0];
    expect(input).toEqual({
      name: 'Renombrada',
      description: 'nueva desc',
      logo: { id: 1 },
      coverImage: { id: 2 },
      address: { city: 'x' },
      settings: { location: { lat: 1, lng: 2 } },
    });
    expect('slug' in input).toBe(false);
    expect('balance' in input).toBe(false);
    expect('categories' in input).toBe(false);
  });

  /**
   * DD30-2 — el test de seguridad que importa: `main.ts:9` registra
   * `ValidationPipe` sin `whitelist`, así que el DTO no filtra nada en
   * runtime; la ÚNICA defensa es que `update()` construye `UpdateShopInput`
   * campo a campo y JAMÁS lee `is_active`/`owner_id` del body. Un
   * `store_owner` que intente auto-aprobarse con `PUT {"is_active": true}`
   * (o `1`, coerción laxa) NUNCA debe ver esa clave en lo que recibe
   * `updateShop` — si `ADMIN_ONLY` de `approve-shop` fuera esquivable, esta
   * es la línea que lo impediría.
   */
  it.each([
    ['true', true],
    ['1 (coerción laxa)', 1],
  ])(
    'DD30-2: un `PUT` de `store_owner` con `is_active: %s` en el body NUNCA llega al input de `updateShop`',
    async (_label, isActiveValue) => {
      findShopOwnerByIdMock.mockResolvedValue(1);
      updateShopMock.mockResolvedValue(makeShopRecord({ ownerId: 1 }));

      await service.update(
        20,
        updateDto({
          name: 'Tienda propia',
          is_active: isActiveValue,
          owner_id: 999,
        } as never),
        makeUser({ sub: 1, permissions: ['store_owner'] }),
      );

      expect(updateShopMock).toHaveBeenCalledTimes(1);
      const [, input] = updateShopMock.mock.calls[0];
      expect('isActive' in input).toBe(false);
      expect('ownerId' in input).toBe(false);
      expect(input).toEqual({ name: 'Tienda propia' });
    },
  );

  it('RecordNotFoundError del repositorio → 404', async () => {
    findShopOwnerByIdMock.mockResolvedValue(1);
    updateShopMock.mockRejectedValue(new RecordNotFoundError('shops', 20));

    expect.assertions(2);
    try {
      await service.update(20, updateDto({ name: 'x' }), makeUser({ sub: 1 }));
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getStatus()).toBe(404);
    }
  });

  it('InvalidReferenceError del repositorio → 400', async () => {
    findShopOwnerByIdMock.mockResolvedValue(1);
    updateShopMock.mockRejectedValue(
      new InvalidReferenceError('shops', 'ownerId', 999999),
    );

    expect.assertions(2);
    try {
      await service.update(20, updateDto({ name: 'x' }), makeUser({ sub: 1 }));
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
    }
  });

  it('SlugConflictError del repositorio → 409', async () => {
    findShopOwnerByIdMock.mockResolvedValue(1);
    updateShopMock.mockRejectedValue(new SlugConflictError('shops', 'tienda'));

    expect.assertions(2);
    try {
      await service.update(20, updateDto({ name: 'x' }), makeUser({ sub: 1 }));
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getStatus()).toBe(409);
    }
  });
});

/**
 * Frontera numérica y semántica de `@Body('id')` sin tipar (DD30-3): este es
 * el caso "id no entero" del carry-forward de PR#2 (NO se cubrió en
 * `packages/db` — su precondición documentada es un id ya entero). Se ejerce
 * directamente sobre `approveShop`/`disapproveShop`, que reciben el `rawId`
 * tal cual llega del `@Body('id')` sin tipar del controller.
 */
describe('ShopsService.approveShop / disapproveShop — frontera numérica de `@Body(\'id\')` (DD30-3)', () => {
  let service: ShopsService;

  beforeEach(() => {
    setShopActiveMock.mockReset();
    service = new ShopsService();
  });

  it.each([
    ['"abc" (sin forma entera)', 'abc'],
    ['0', 0],
    ['negativo (-1)', -1],
    ['null', null],
    ['[] (array)', []],
    ['{} (objeto)', {}],
    ['1e21 (fuera de MAX_SAFE_INTEGER)', 1e21],
  ])('approveShop(%s) → 400, `setShopActive` NUNCA se llama', async (_label, rawId) => {
    expect.assertions(3);
    try {
      await service.approveShop(rawId);
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
      expect(setShopActiveMock).not.toHaveBeenCalled();
    }
  });

  it('approveShop(`true`) → 400, NUNCA modera la tienda 1 (`Number(true) === 1` sin el `typeof`-narrow previo)', async () => {
    expect.assertions(3);
    try {
      await service.approveShop(true);
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
      expect(setShopActiveMock).not.toHaveBeenCalled();
    }
  });

  it('disapproveShop(`true`) → 400, mismo `typeof`-narrow que `approveShop`', async () => {
    expect.assertions(3);
    try {
      await service.disapproveShop(true);
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
      expect(setShopActiveMock).not.toHaveBeenCalled();
    }
  });

  it('id inexistente → 404 (`P2025` traducido vía `toWriteHttpException`), NUNCA 500', async () => {
    setShopActiveMock.mockRejectedValue(new RecordNotFoundError('shops', 888888));

    expect.assertions(2);
    try {
      await service.disapproveShop(888888);
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getStatus()).toBe(404);
    }
  });

  it('approveShop(id válido) → 200, `is_active: true` persistido', async () => {
    setShopActiveMock.mockResolvedValue(makeShopRecord({ isActive: true }));

    const result = await service.approveShop(20);

    expect(setShopActiveMock).toHaveBeenCalledWith(20, true);
    expect(result.is_active).toBe(1);
  });

  it('disapproveShop(id válido) → 200, `is_active: false` persistido', async () => {
    setShopActiveMock.mockResolvedValue(makeShopRecord({ isActive: false }));

    const result = await service.disapproveShop(20);

    expect(setShopActiveMock).toHaveBeenCalledWith(20, false);
    expect(result.is_active).toBe(0);
  });

  it('approveShop("20") — id como string numérico válido (forma real de `@Body(\'id\')`) → 200', async () => {
    setShopActiveMock.mockResolvedValue(makeShopRecord({ isActive: true }));

    await service.approveShop('20');

    expect(setShopActiveMock).toHaveBeenCalledWith(20, true);
  });
});

/**
 * Stubs de `DD30-8`: `createStaff()`/`updateStaff()` preservan el
 * comportamiento de stub de ayer (devuelven `null`, sin `@CurrentUser()`
 * pass-through) — NINGUNA de las dos rutas de `StaffsController` crea ni
 * edita una tienda real, porque no hay relación staff↔tienda en el DDL.
 */
describe('ShopsService.createStaff / updateStaff — stubs preservados (DD30-8)', () => {
  let service: ShopsService;

  beforeEach(() => {
    createShopMock.mockReset();
    updateShopMock.mockReset();
    service = new ShopsService();
  });

  it('createStaff() devuelve `null` y no crea una tienda', () => {
    expect(service.createStaff()).toBeNull();
    expect(createShopMock).not.toHaveBeenCalled();
  });

  it('updateStaff() devuelve `null` y no edita una tienda', () => {
    expect(service.updateStaff()).toBeNull();
    expect(updateShopMock).not.toHaveBeenCalled();
  });
});

/**
 * CA-4 — `getStaffs` ya no lee `shops.json` (migrado en PR#3) pero MUST
 * preservar exactamente el mismo key-set y el mismo tipo de `per_page`
 * (pass-through del `limit` crudo, sin coerción) que el contrato de ayer.
 */
describe('ShopsService.getStaffs — mismo contrato tras desmockear (CA-4)', () => {
  it('key-set idéntico (`data: []` + `paginate()`, nunca `buildPaginator`) y `per_page` sin coerción', () => {
    const service = new ShopsService();

    const result = service.getStaffs({
      limit: '15',
      page: '1',
    } as unknown as GetStaffsDto);

    expect(Object.keys(result)).toEqual([
      'data',
      'total',
      'current_page',
      'count',
      'last_page',
      'firstItem',
      'lastItem',
      'per_page',
      'first_page_url',
      'last_page_url',
      'next_page_url',
      'prev_page_url',
    ]);
    expect(result.data).toEqual([]);
    // `per_page` es el `limit` crudo pasado tal cual — sin `Number(...)`
    // (design.md CA-4): si llega string, sale string.
    expect(result.per_page).toBe('15');
    expect(typeof result.per_page).toBe('string');
  });
});
