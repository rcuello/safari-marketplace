/// <reference types="jest" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de jest;
 * se limita a este archivo para no tocar la config del build.
 */
/**
 * Tests unitarios de las escrituras de `TypesService` (US-27a):
 * `create`/`update`/`remove`.
 *
 * Mismo arnés que `products.service.spec.ts:36-43`: se mockea SOLO el
 * acceso a datos (`createType`/`updateType`/`deleteType`, y también
 * `findTypeBySlug` — necesario para poder llamar a `getTypeBySlug` sin
 * tocar Postgres y comparar el `Object.keys()` de las 3 escrituras contra
 * el de la lectura, CA-1) y se dejan REALES las 5 clases de error de
 * dominio y `toWriteHttpException` (vía `domain-error.mapper.ts`, tampoco
 * mockeado), para que la traducción a HTTP se pruebe de verdad.
 */
import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createType,
  DependentRowsError,
  deleteType,
  EmptySlugError,
  findTypeBySlug,
  RecordNotFoundError,
  updateType,
  type TypeRecord,
} from '@safari/db';
import { TypesService } from './types.service';
import { CreateTypeDto } from './dto/create-type.dto';
import { UpdateTypeDto } from './dto/update-type.dto';

jest.mock('@safari/db', () => ({
  // El barrel es seguro de cargar sin DATABASE_URL (cliente lazy vía Proxy);
  // se conservan reales las clases de error de dominio y solo se mockea el
  // acceso a datos.
  ...jest.requireActual<typeof import('@safari/db')>('@safari/db'),
  createType: jest.fn(),
  updateType: jest.fn(),
  deleteType: jest.fn(),
  findTypeBySlug: jest.fn(),
}));

const createTypeMock = jest.mocked(createType);
const updateTypeMock = jest.mocked(updateType);
const deleteTypeMock = jest.mocked(deleteType);
const findTypeBySlugMock = jest.mocked(findTypeBySlug);

const NOW = new Date('2026-09-09T00:00:00Z');

function makeTypeRecord(overrides: Partial<TypeRecord> = {}): TypeRecord {
  return {
    id: 12,
    name: 'Vertical Prueba',
    slug: 'vertical-prueba',
    icon: null,
    settings: {},
    banners: [],
    language: 'es',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/**
 * `ValidationPipe` corre sin `transform`; en runtime el body ya llegó
 * validado por los decoradores del DTO antes de tocar el servicio, pero
 * este spec ejercita el servicio directamente, así que construye el DTO a
 * mano — mismo cast-precedente que `rawQuery` en
 * `products.service.spec.ts:54-58`.
 */
function createDto(input: Partial<CreateTypeDto>): CreateTypeDto {
  return input as unknown as CreateTypeDto;
}

function updateDto(input: Partial<UpdateTypeDto>): UpdateTypeDto {
  return input as unknown as UpdateTypeDto;
}

describe('TypesService.create (US-27a)', () => {
  let service: TypesService;

  beforeEach(() => {
    createTypeMock.mockReset();
    service = new TypesService();
  });

  it('proyecta el DTO campo a campo: omite `settings`/`banners` ausentes e ignora `promotional_sliders` (R-5)', async () => {
    createTypeMock.mockResolvedValue(makeTypeRecord());

    await service.create(
      createDto({
        name: 'Vertical Prueba',
        promotional_sliders: [{ id: 1 } as never],
      }),
    );

    expect(createTypeMock).toHaveBeenCalledTimes(1);
    const calledWith = createTypeMock.mock.calls[0][0];
    expect(calledWith).toEqual({ name: 'Vertical Prueba' });
    expect('settings' in calledWith).toBe(false);
    expect('banners' in calledWith).toBe(false);
    expect('promotional_sliders' in calledWith).toBe(false);
  });

  it('cuando `settings`/`banners` llegan, se castean al input del repositorio (nunca `as any`)', async () => {
    createTypeMock.mockResolvedValue(makeTypeRecord());
    const settings = { isHome: true, layoutType: 'classic', productCard: 'neon' };
    const banners = [{ id: 1, image: {} }] as never;

    await service.create(
      createDto({ name: 'Vertical Prueba', settings: settings as never, banners }),
    );

    expect(createTypeMock).toHaveBeenCalledWith({
      name: 'Vertical Prueba',
      settings,
      banners,
    });
  });

  it('un `slug` explícito del DTO se proyecta al input del repositorio', async () => {
    createTypeMock.mockResolvedValue(makeTypeRecord());

    await service.create(
      createDto({ name: 'Vertical X', slug: 'vertical-custom' }),
    );

    expect(createTypeMock).toHaveBeenCalledWith({
      name: 'Vertical X',
      slug: 'vertical-custom',
    });
  });

  it('EmptySlugError del repositorio → 400', async () => {
    createTypeMock.mockRejectedValue(new EmptySlugError('types', '!!!'));

    expect.assertions(2);
    try {
      await service.create(createDto({ name: '!!!' }));
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
    }
  });

  it('un fallo de conexión de Prisma ({code:"P1001"}) → 503', async () => {
    createTypeMock.mockRejectedValue({
      name: 'PrismaClientKnownRequestError',
      code: 'P1001',
      message: "Can't reach database server at `localhost:5433`",
    });

    expect.assertions(2);
    try {
      await service.create(createDto({ name: 'Vertical Prueba' }));
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getStatus()).toBe(503);
    }
  });

  it('un error de Prisma no clasificado ({code:"P2011"}) → 500, nunca 503 (B1)', async () => {
    createTypeMock.mockRejectedValue({
      name: 'PrismaClientKnownRequestError',
      code: 'P2011',
      message: 'Null constraint violation on the fields: (`slug`)',
    });

    expect.assertions(2);
    try {
      await service.create(createDto({ name: 'Vertical Prueba' }));
    } catch (error) {
      expect(error).toBeInstanceOf(InternalServerErrorException);
      expect((error as InternalServerErrorException).getStatus()).toBe(500);
    }
  });
});

describe('TypesService.update (US-27a)', () => {
  let service: TypesService;

  beforeEach(() => {
    updateTypeMock.mockReset();
    service = new TypesService();
  });

  it('id no entero → 404 sin llamar al repositorio (design.md, Decisión 6)', async () => {
    expect.assertions(3);
    try {
      await service.update(NaN, updateDto({ name: 'x' }));
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getStatus()).toBe(404);
      expect(updateTypeMock).not.toHaveBeenCalled();
    }
  });

  it('proyecta el DTO campo a campo, sin `slug` (inmutable)', async () => {
    updateTypeMock.mockResolvedValue(makeTypeRecord({ name: 'Renombrada' }));

    await service.update(12, updateDto({ name: 'Renombrada', slug: 'ignorado' as never }));

    expect(updateTypeMock).toHaveBeenCalledWith(12, { name: 'Renombrada' });
  });

  it('RecordNotFoundError del repositorio → 404', async () => {
    updateTypeMock.mockRejectedValue(new RecordNotFoundError('types', 99999));

    expect.assertions(2);
    try {
      await service.update(99999, updateDto({ name: 'x' }));
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getStatus()).toBe(404);
    }
  });

  it('EmptySlugError del repositorio (`name` vacío) → 400', async () => {
    updateTypeMock.mockRejectedValue(new EmptySlugError('types', ''));

    expect.assertions(2);
    try {
      await service.update(12, updateDto({ name: '' }));
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
    }
  });
});

describe('TypesService.remove (US-27a)', () => {
  let service: TypesService;

  beforeEach(() => {
    deleteTypeMock.mockReset();
    service = new TypesService();
  });

  it('id no entero → 404 sin llamar al repositorio', async () => {
    expect.assertions(3);
    try {
      await service.remove(NaN);
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getStatus()).toBe(404);
      expect(deleteTypeMock).not.toHaveBeenCalled();
    }
  });

  it('DependentRowsError del repositorio → 409', async () => {
    deleteTypeMock.mockRejectedValue(
      new DependentRowsError('types', { categories: 10, products: 44 }),
    );

    expect.assertions(2);
    try {
      await service.remove(9);
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getStatus()).toBe(409);
    }
  });

  it('RecordNotFoundError del repositorio → 404', async () => {
    deleteTypeMock.mockRejectedValue(new RecordNotFoundError('types', 99999));

    expect.assertions(2);
    try {
      await service.remove(99999);
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getStatus()).toBe(404);
    }
  });

  it('borrado exitoso devuelve la proyección de `toTypeDto`', async () => {
    deleteTypeMock.mockResolvedValue(makeTypeRecord());

    const result = await service.remove(12);

    expect(result).toMatchObject({ id: 12, slug: 'vertical-prueba' });
  });
});

describe('Contrato de 9 claves — create/update/remove igual a getTypeBySlug (CA-1)', () => {
  let service: TypesService;

  beforeEach(() => {
    createTypeMock.mockReset();
    updateTypeMock.mockReset();
    deleteTypeMock.mockReset();
    findTypeBySlugMock.mockReset();
    service = new TypesService();
  });

  it('Object.keys() de las 3 escrituras es idéntico, EN ORDEN, al de la lectura', async () => {
    const record = makeTypeRecord();
    findTypeBySlugMock.mockResolvedValue(record);
    createTypeMock.mockResolvedValue(record);
    updateTypeMock.mockResolvedValue(record);
    deleteTypeMock.mockResolvedValue(record);

    const readResult = await service.getTypeBySlug('vertical-prueba');
    const createResult = await service.create(
      createDto({ name: 'Vertical Prueba' }),
    );
    const updateResult = await service.update(
      12,
      updateDto({ name: 'Vertical Prueba' }),
    );
    const removeResult = await service.remove(12);

    const expectedKeys = Object.keys(readResult);
    expect(expectedKeys).toHaveLength(9);
    // Comparación de ORDEN exacto — nunca `.sort()` (nota del run: el orden
    // es parte del contrato).
    expect(Object.keys(createResult)).toEqual(expectedKeys);
    expect(Object.keys(updateResult)).toEqual(expectedKeys);
    expect(Object.keys(removeResult)).toEqual(expectedKeys);
  });
});
