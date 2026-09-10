/// <reference types="jest" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de jest;
 * se limita a este archivo para no tocar la config del build.
 */
/**
 * Tests unitarios de las escrituras de `ManufacturersService` (US-27b):
 * `create`/`update`/`remove`.
 *
 * Mismo arnés que `tags.service.spec.ts:1-19` / `types.service.spec.ts:1-88`:
 * se mockea SOLO el acceso a datos (`createManufacturer`/`updateManufacturer`/
 * `deleteManufacturer`, `findManufacturerBySlug` — necesario para comparar el
 * `Object.keys()` de las 3 escrituras contra el de la lectura, CA-1 — y
 * `listTypes`, que las escrituras necesitan para resolver el `type` embebido,
 * design.md DD-7) y se dejan REALES las 5 clases de error de dominio y
 * `toWriteHttpException` (vía `domain-error.mapper.ts`, tampoco mockeado),
 * para que la traducción a HTTP se pruebe de verdad.
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
  createManufacturer,
  deleteManufacturer,
  DependentRowsError,
  EmptySlugError,
  findManufacturerBySlug,
  InvalidReferenceError,
  listTypes,
  RecordNotFoundError,
  SlugConflictError,
  updateManufacturer,
  type ManufacturerRecord,
  type TypeRecord,
} from '@safari/db';
import { ManufacturersService } from './manufacturers.service';
import { CreateManufacturerDto } from './dto/create-manufacturer.dto';
import { UpdateManufacturerDto } from './dto/update-manufacturer.dto';

jest.mock('@safari/db', () => ({
  // El barrel es seguro de cargar sin DATABASE_URL (cliente lazy vía Proxy);
  // se conservan reales las clases de error de dominio y solo se mockea el
  // acceso a datos.
  ...jest.requireActual<typeof import('@safari/db')>('@safari/db'),
  createManufacturer: jest.fn(),
  updateManufacturer: jest.fn(),
  deleteManufacturer: jest.fn(),
  findManufacturerBySlug: jest.fn(),
  listTypes: jest.fn(),
}));

const createManufacturerMock = jest.mocked(createManufacturer);
const updateManufacturerMock = jest.mocked(updateManufacturer);
const deleteManufacturerMock = jest.mocked(deleteManufacturer);
const findManufacturerBySlugMock = jest.mocked(findManufacturerBySlug);
const listTypesMock = jest.mocked(listTypes);

const NOW = new Date('2026-09-10T00:00:00Z');

function makeManufacturerRecord(
  overrides: Partial<ManufacturerRecord> = {},
): ManufacturerRecord {
  return {
    id: 20,
    name: 'Marca Prueba',
    slug: 'marca-prueba',
    description: null,
    website: null,
    image: null,
    typeId: null,
    isApproved: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeTypeRecord(overrides: Partial<TypeRecord> = {}): TypeRecord {
  return {
    id: 9,
    name: 'Tecnología',
    slug: 'tecnologia',
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
 * `ValidationPipe` corre sin `whitelist`; en runtime el body puede traer
 * claves sin columna (`socials`, `cover_image`, `language`, `shop_id`) que
 * sobreviven hasta el servicio (`main.ts:9`, decisión 5 del épico). Este
 * cast reproduce esa realidad para poder ejercer el servicio directamente
 * con un payload que incluye esas claves fantasma.
 */
function createDto(
  input: Partial<CreateManufacturerDto> & Record<string, unknown>,
): CreateManufacturerDto {
  return input as unknown as CreateManufacturerDto;
}

function updateDto(
  input: Partial<UpdateManufacturerDto> & Record<string, unknown>,
): UpdateManufacturerDto {
  return input as unknown as UpdateManufacturerDto;
}

beforeEach(() => {
  listTypesMock.mockReset();
  listTypesMock.mockResolvedValue([]);
});

describe('ManufacturersService.create (US-27b)', () => {
  let service: ManufacturersService;

  beforeEach(() => {
    createManufacturerMock.mockReset();
    service = new ManufacturersService();
  });

  it('proyecta el DTO campo a campo: omite `description`/`website`/`image`/`type_id`/`is_approved` ausentes e ignora `socials`/`cover_image`/`language`/`shop_id` (B-4, V-1/V-2/V-3)', async () => {
    createManufacturerMock.mockResolvedValue(makeManufacturerRecord());

    await service.create(
      createDto({
        name: 'Marca Prueba',
        socials: [{ icon: 'x', url: 'y' }],
        cover_image: { id: 1 },
        language: 'es',
        shop_id: '1',
      } as never),
    );

    expect(createManufacturerMock).toHaveBeenCalledTimes(1);
    const calledWith = createManufacturerMock.mock.calls[0][0];
    expect(calledWith).toEqual({ name: 'Marca Prueba' });
    expect('socials' in calledWith).toBe(false);
    expect('cover_image' in calledWith).toBe(false);
    expect('language' in calledWith).toBe(false);
    expect('shop_id' in calledWith).toBe(false);
    expect('description' in calledWith).toBe(false);
    expect('website' in calledWith).toBe(false);
    expect('image' in calledWith).toBe(false);
    expect('typeId' in calledWith).toBe(false);
    expect('isApproved' in calledWith).toBe(false);
  });

  it('cuando los campos opcionales llegan, se proyectan al input del repositorio (`type_id` → `typeId: Number(...)`, `is_approved` → `isApproved: Boolean(...)`, `image` casteado, nunca `as any`)', async () => {
    createManufacturerMock.mockResolvedValue(makeManufacturerRecord());
    const image = { id: 1, original: 'o', thumbnail: 't' };

    await service.create(
      createDto({
        name: 'Marca Prueba',
        slug: 'marca-personalizada',
        description: 'desc-sonda',
        website: 'https://sonda.test',
        image: image as never,
        type_id: '9' as never,
        is_approved: true,
      }),
    );

    expect(createManufacturerMock).toHaveBeenCalledWith({
      name: 'Marca Prueba',
      slug: 'marca-personalizada',
      description: 'desc-sonda',
      website: 'https://sonda.test',
      image,
      typeId: 9,
      isApproved: true,
    });
  });

  it('`type_id: null` se proyecta como `typeId: null` (limpia la FK), nunca `NaN`', async () => {
    createManufacturerMock.mockResolvedValue(makeManufacturerRecord());

    await service.create(createDto({ name: 'Marca Prueba', type_id: null as never }));

    expect(createManufacturerMock).toHaveBeenCalledWith({
      name: 'Marca Prueba',
      typeId: null,
    });
  });

  it('resuelve `type` con UN `listTypes()` secuencial, después de la escritura (design.md DD-7, nunca `Promise.all`)', async () => {
    const callOrder: string[] = [];
    createManufacturerMock.mockImplementation(async () => {
      callOrder.push('createManufacturer');
      return makeManufacturerRecord({ typeId: 9 });
    });
    listTypesMock.mockImplementation(async () => {
      callOrder.push('listTypes');
      return [makeTypeRecord({ id: 9 })];
    });

    const result = await service.create(createDto({ name: 'Marca Prueba' }));

    expect(callOrder).toEqual(['createManufacturer', 'listTypes']);
    expect(createManufacturerMock).toHaveBeenCalledTimes(1);
    expect(listTypesMock).toHaveBeenCalledTimes(1);
    expect(result.type).toEqual({
      id: 9,
      name: 'Tecnología',
      slug: 'tecnologia',
      logo: null,
    });
  });

  it('EmptySlugError del repositorio → 400', async () => {
    createManufacturerMock.mockRejectedValue(
      new EmptySlugError('manufacturers', '!!!'),
    );

    expect.assertions(2);
    try {
      await service.create(createDto({ name: '!!!' }));
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
    }
  });

  it('InvalidReferenceError del repositorio (`type_id` malformado o inexistente) → 400', async () => {
    createManufacturerMock.mockRejectedValue(
      new InvalidReferenceError('manufacturers', 'type_id', 99999),
    );

    expect.assertions(2);
    try {
      await service.create(createDto({ name: 'X', type_id: '99999' as never }));
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
    }
  });

  it('RecordNotFoundError del repositorio → 404', async () => {
    createManufacturerMock.mockRejectedValue(
      new RecordNotFoundError('manufacturers', 99999),
    );

    expect.assertions(2);
    try {
      await service.create(createDto({ name: 'X' }));
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getStatus()).toBe(404);
    }
  });

  it('SlugConflictError del repositorio → 409', async () => {
    createManufacturerMock.mockRejectedValue(
      new SlugConflictError('manufacturers', 'medicure'),
    );

    expect.assertions(2);
    try {
      await service.create(createDto({ name: 'Medicure' }));
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getStatus()).toBe(409);
    }
  });

  it('DependentRowsError del repositorio → 409', async () => {
    createManufacturerMock.mockRejectedValue(
      new DependentRowsError('manufacturers', { products: 3 }),
    );

    expect.assertions(2);
    try {
      await service.create(createDto({ name: 'X' }));
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getStatus()).toBe(409);
    }
  });

  it('un fallo de conexión de Prisma ({code:"P1001"}) → 503', async () => {
    createManufacturerMock.mockRejectedValue({
      name: 'PrismaClientKnownRequestError',
      code: 'P1001',
      message: "Can't reach database server at `localhost:5433`",
    });

    expect.assertions(2);
    try {
      await service.create(createDto({ name: 'Marca Prueba' }));
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getStatus()).toBe(503);
    }
  });

  it('un error de Prisma no clasificado ({code:"P2011"}) → 500, nunca 503 (B1)', async () => {
    createManufacturerMock.mockRejectedValue({
      name: 'PrismaClientKnownRequestError',
      code: 'P2011',
      message: 'Null constraint violation on the fields: (`slug`)',
    });

    expect.assertions(2);
    try {
      await service.create(createDto({ name: 'Marca Prueba' }));
    } catch (error) {
      expect(error).toBeInstanceOf(InternalServerErrorException);
      expect((error as InternalServerErrorException).getStatus()).toBe(500);
    }
  });
});

describe('ManufacturersService.update (US-27b)', () => {
  let service: ManufacturersService;

  beforeEach(() => {
    updateManufacturerMock.mockReset();
    service = new ManufacturersService();
  });

  it('id no entero → 404 sin llamar al repositorio (design.md DD-10)', async () => {
    expect.assertions(3);
    try {
      await service.update(NaN, updateDto({ name: 'x' }));
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getStatus()).toBe(404);
      expect(updateManufacturerMock).not.toHaveBeenCalled();
    }
  });

  it('proyecta el DTO campo a campo, sin `slug` (inmutable) ni `socials`/`cover_image`/`language`/`shop_id`', async () => {
    updateManufacturerMock.mockResolvedValue(
      makeManufacturerRecord({ name: 'Marca Prueba Renombrada' }),
    );

    await service.update(
      20,
      updateDto({
        name: 'Marca Prueba Renombrada',
        slug: 'intento-de-cambiar' as never,
        socials: [{ icon: 'x', url: 'y' }],
        cover_image: { id: 1 },
        language: 'es',
        shop_id: '1',
      } as never),
    );

    expect(updateManufacturerMock).toHaveBeenCalledTimes(1);
    const [calledId, calledWith] = updateManufacturerMock.mock.calls[0];
    expect(calledId).toBe(20);
    expect(calledWith).toEqual({ name: 'Marca Prueba Renombrada' });
    expect('slug' in calledWith).toBe(false);
    expect('socials' in calledWith).toBe(false);
    expect('cover_image' in calledWith).toBe(false);
    expect('language' in calledWith).toBe(false);
    expect('shop_id' in calledWith).toBe(false);
  });

  /**
   * Prueba unitaria de B-4 sobre el payload EXACTO del toggle de aprobación
   * (`manufacturer-list.tsx:134-142`, design.md DD-1/DD-9): 5 claves, ninguna
   * de las cuales es `description`/`website`/`image`. El input que llega al
   * repositorio mockeado MUST omitir esas 3 claves por completo — no
   * `undefined`, AUSENTES — probando que el servicio nunca proyecta "ausente
   * del DTO" como `null`/`undefined` explícito.
   */
  it('B-4: el payload de 5 claves del toggle de aprobación omite `description`/`website`/`image` del input al repositorio (nunca las proyecta)', async () => {
    updateManufacturerMock.mockResolvedValue(
      makeManufacturerRecord({ isApproved: false }),
    );

    await service.update(
      20,
      updateDto({
        name: 'Marca Prueba',
        is_approved: false,
        type_id: '9' as never,
        language: 'es',
      } as never),
    );

    expect(updateManufacturerMock).toHaveBeenCalledTimes(1);
    const [, calledWith] = updateManufacturerMock.mock.calls[0];
    expect(calledWith).toEqual({
      name: 'Marca Prueba',
      isApproved: false,
      typeId: 9,
    });
    expect('description' in calledWith).toBe(false);
    expect('website' in calledWith).toBe(false);
    expect('image' in calledWith).toBe(false);
  });

  it('`is_approved` se coerciona con `Boolean(...)` (DD-6) — `true`/`false` reales', async () => {
    updateManufacturerMock.mockResolvedValue(makeManufacturerRecord());

    await service.update(20, updateDto({ is_approved: true }));
    expect(updateManufacturerMock).toHaveBeenLastCalledWith(20, {
      isApproved: true,
    });

    await service.update(20, updateDto({ is_approved: false }));
    expect(updateManufacturerMock).toHaveBeenLastCalledWith(20, {
      isApproved: false,
    });
  });

  it('resuelve `type` con UN `listTypes()` secuencial, después de la escritura', async () => {
    const callOrder: string[] = [];
    updateManufacturerMock.mockImplementation(async () => {
      callOrder.push('updateManufacturer');
      return makeManufacturerRecord();
    });
    listTypesMock.mockImplementation(async () => {
      callOrder.push('listTypes');
      return [];
    });

    await service.update(20, updateDto({ name: 'Marca Prueba' }));

    expect(callOrder).toEqual(['updateManufacturer', 'listTypes']);
  });

  it('RecordNotFoundError del repositorio → 404', async () => {
    updateManufacturerMock.mockRejectedValue(
      new RecordNotFoundError('manufacturers', 99999),
    );

    expect.assertions(2);
    try {
      await service.update(99999, updateDto({ name: 'x' }));
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getStatus()).toBe(404);
    }
  });

  it('EmptySlugError del repositorio (`name` vacío) → 400', async () => {
    updateManufacturerMock.mockRejectedValue(new EmptySlugError('manufacturers', ''));

    expect.assertions(2);
    try {
      await service.update(20, updateDto({ name: '' }));
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
    }
  });

  it('InvalidReferenceError del repositorio (`type_id` inexistente) → 400', async () => {
    updateManufacturerMock.mockRejectedValue(
      new InvalidReferenceError('manufacturers', 'type_id', 99999),
    );

    expect.assertions(2);
    try {
      await service.update(20, updateDto({ type_id: '99999' as never }));
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
    }
  });
});

describe('ManufacturersService.remove (US-27b)', () => {
  let service: ManufacturersService;

  beforeEach(() => {
    deleteManufacturerMock.mockReset();
    service = new ManufacturersService();
  });

  it('id no entero → 404 sin llamar al repositorio', async () => {
    expect.assertions(3);
    try {
      await service.remove(NaN);
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getStatus()).toBe(404);
      expect(deleteManufacturerMock).not.toHaveBeenCalled();
    }
  });

  it('RecordNotFoundError del repositorio → 404', async () => {
    deleteManufacturerMock.mockRejectedValue(
      new RecordNotFoundError('manufacturers', 99999),
    );

    expect.assertions(2);
    try {
      await service.remove(99999);
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getStatus()).toBe(404);
    }
  });

  it('borrado exitoso devuelve la proyección de `toManufacturerDto`', async () => {
    deleteManufacturerMock.mockResolvedValue(makeManufacturerRecord());

    const result = await service.remove(20);

    expect(result).toMatchObject({ id: 20, slug: 'marca-prueba' });
  });
});

describe('Contrato de 13 claves — create/update/remove igual a getManufacturesBySlug (CA-1)', () => {
  let service: ManufacturersService;

  beforeEach(() => {
    createManufacturerMock.mockReset();
    updateManufacturerMock.mockReset();
    deleteManufacturerMock.mockReset();
    findManufacturerBySlugMock.mockReset();
    listTypesMock.mockReset();
    listTypesMock.mockResolvedValue([]);
    service = new ManufacturersService();
  });

  it('Object.keys() de las 3 escrituras es idéntico, EN ORDEN, al de la lectura', async () => {
    const record = makeManufacturerRecord();
    findManufacturerBySlugMock.mockResolvedValue(record);
    createManufacturerMock.mockResolvedValue(record);
    updateManufacturerMock.mockResolvedValue(record);
    deleteManufacturerMock.mockResolvedValue(record);

    const readResult = await service.getManufacturesBySlug('marca-prueba');
    const createResult = await service.create(createDto({ name: 'Marca Prueba' }));
    const updateResult = await service.update(20, updateDto({ name: 'Marca Prueba' }));
    const removeResult = await service.remove(20);

    const expectedKeys = Object.keys(readResult);
    expect(expectedKeys).toHaveLength(13);
    // Comparación de ORDEN exacto — nunca `.sort()` (jq no está instalado,
    // design.md nota sobre `node -e`, aquí equivalente con `toEqual`).
    expect(Object.keys(createResult)).toEqual(expectedKeys);
    expect(Object.keys(updateResult)).toEqual(expectedKeys);
    expect(Object.keys(removeResult)).toEqual(expectedKeys);
  });
});
