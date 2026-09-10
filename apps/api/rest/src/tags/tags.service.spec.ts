/// <reference types="jest" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de jest;
 * se limita a este archivo para no tocar la config del build.
 */
/**
 * Tests unitarios de las escrituras de `TagsService` (US-27b):
 * `create`/`update`/`remove`.
 *
 * Mismo arnés que `types.service.spec.ts:1-88` / `products.service.spec.ts:36-43`:
 * se mockea SOLO el acceso a datos (`createTag`/`updateTag`/`deleteTag`,
 * `findTagBySlug` — necesario para comparar el `Object.keys()` de las 3
 * escrituras contra el de la lectura, CA-1 — y `listTypes`, que las
 * escrituras necesitan para resolver el `type` embebido, design.md DD-7) y
 * se dejan REALES las 5 clases de error de dominio y `toWriteHttpException`
 * (vía `domain-error.mapper.ts`, tampoco mockeado), para que la traducción a
 * HTTP se pruebe de verdad.
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
  createTag,
  deleteTag,
  DependentRowsError,
  EmptySlugError,
  findTagBySlug,
  InvalidReferenceError,
  listTypes,
  RecordNotFoundError,
  SlugConflictError,
  updateTag,
  type TagRecord,
  type TypeRecord,
} from '@safari/db';
import { TagsService } from './tags.service';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';

jest.mock('@safari/db', () => ({
  // El barrel es seguro de cargar sin DATABASE_URL (cliente lazy vía Proxy);
  // se conservan reales las clases de error de dominio y solo se mockea el
  // acceso a datos.
  ...jest.requireActual<typeof import('@safari/db')>('@safari/db'),
  createTag: jest.fn(),
  updateTag: jest.fn(),
  deleteTag: jest.fn(),
  findTagBySlug: jest.fn(),
  listTypes: jest.fn(),
}));

const createTagMock = jest.mocked(createTag);
const updateTagMock = jest.mocked(updateTag);
const deleteTagMock = jest.mocked(deleteTag);
const findTagBySlugMock = jest.mocked(findTagBySlug);
const listTypesMock = jest.mocked(listTypes);

const NOW = new Date('2026-09-10T00:00:00Z');

function makeTagRecord(overrides: Partial<TagRecord> = {}): TagRecord {
  return {
    id: 63,
    name: 'Oferta Verano',
    slug: 'oferta-verano',
    details: null,
    icon: null,
    image: null,
    typeId: null,
    language: 'es',
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
 * claves sin columna (`socials`, `cover_image`) que sobreviven hasta el
 * servicio (`main.ts:9`, decisión 5 del épico). Este cast reproduce esa
 * realidad para poder ejercer el servicio directamente con un payload que
 * incluye esas claves fantasma.
 */
function createDto(
  input: Partial<CreateTagDto> & Record<string, unknown>,
): CreateTagDto {
  return input as unknown as CreateTagDto;
}

function updateDto(
  input: Partial<UpdateTagDto> & Record<string, unknown>,
): UpdateTagDto {
  return input as unknown as UpdateTagDto;
}

beforeEach(() => {
  listTypesMock.mockReset();
  listTypesMock.mockResolvedValue([]);
});

describe('TagsService.create (US-27b)', () => {
  let service: TagsService;

  beforeEach(() => {
    createTagMock.mockReset();
    service = new TagsService();
  });

  it('proyecta el DTO campo a campo: omite `details`/`icon`/`image`/`type_id`/`language` ausentes e ignora `socials`/`cover_image` (B-4)', async () => {
    createTagMock.mockResolvedValue(makeTagRecord());

    await service.create(
      createDto({
        name: 'Oferta Verano',
        socials: [{ icon: 'x', url: 'y' }],
        cover_image: { id: 1 },
      } as never),
    );

    expect(createTagMock).toHaveBeenCalledTimes(1);
    const calledWith = createTagMock.mock.calls[0][0];
    expect(calledWith).toEqual({ name: 'Oferta Verano' });
    expect('socials' in calledWith).toBe(false);
    expect('cover_image' in calledWith).toBe(false);
    expect('details' in calledWith).toBe(false);
    expect('icon' in calledWith).toBe(false);
    expect('image' in calledWith).toBe(false);
    expect('typeId' in calledWith).toBe(false);
    expect('language' in calledWith).toBe(false);
  });

  it('cuando los campos opcionales llegan, se proyectan al input del repositorio (`type_id` → `typeId`, `image` casteado, nunca `as any`)', async () => {
    createTagMock.mockResolvedValue(makeTagRecord());
    const image = { id: 1, original: 'o', thumbnail: 't' };

    await service.create(
      createDto({
        name: 'Oferta Verano',
        slug: 'oferta-personalizada',
        details: 'Detalle',
        icon: 'icon-x',
        image: image as never,
        type_id: 9,
        language: 'es',
      }),
    );

    expect(createTagMock).toHaveBeenCalledWith({
      name: 'Oferta Verano',
      slug: 'oferta-personalizada',
      details: 'Detalle',
      icon: 'icon-x',
      image,
      typeId: 9,
      language: 'es',
    });
  });

  it('resuelve `type` con UN `listTypes()` secuencial, después de la escritura (design.md DD-7, nunca `Promise.all`)', async () => {
    const callOrder: string[] = [];
    createTagMock.mockImplementation(async () => {
      callOrder.push('createTag');
      return makeTagRecord({ typeId: 9 });
    });
    listTypesMock.mockImplementation(async () => {
      callOrder.push('listTypes');
      return [makeTypeRecord({ id: 9 })];
    });

    const result = await service.create(createDto({ name: 'Oferta Verano' }));

    expect(callOrder).toEqual(['createTag', 'listTypes']);
    expect(createTagMock).toHaveBeenCalledTimes(1);
    expect(listTypesMock).toHaveBeenCalledTimes(1);
    expect(result.type).toEqual({
      id: 9,
      name: 'Tecnología',
      slug: 'tecnologia',
      logo: null,
    });
  });

  it('EmptySlugError del repositorio → 400', async () => {
    createTagMock.mockRejectedValue(new EmptySlugError('tags', '!!!'));

    expect.assertions(2);
    try {
      await service.create(createDto({ name: '!!!' }));
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
    }
  });

  it('InvalidReferenceError del repositorio (`type_id` malformado o inexistente) → 400', async () => {
    createTagMock.mockRejectedValue(
      new InvalidReferenceError('tags', 'type_id', 99999),
    );

    expect.assertions(2);
    try {
      await service.create(createDto({ name: 'X', type_id: 99999 }));
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
    }
  });

  it('RecordNotFoundError del repositorio → 404', async () => {
    createTagMock.mockRejectedValue(new RecordNotFoundError('tags', 99999));

    expect.assertions(2);
    try {
      await service.create(createDto({ name: 'X' }));
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getStatus()).toBe(404);
    }
  });

  it('SlugConflictError del repositorio → 409', async () => {
    createTagMock.mockRejectedValue(new SlugConflictError('tags', 'oferta'));

    expect.assertions(2);
    try {
      await service.create(createDto({ name: 'Oferta' }));
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getStatus()).toBe(409);
    }
  });

  it('DependentRowsError del repositorio → 409', async () => {
    createTagMock.mockRejectedValue(
      new DependentRowsError('tags', { product_tag: 3 }),
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
    createTagMock.mockRejectedValue({
      name: 'PrismaClientKnownRequestError',
      code: 'P1001',
      message: "Can't reach database server at `localhost:5433`",
    });

    expect.assertions(2);
    try {
      await service.create(createDto({ name: 'Oferta Verano' }));
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getStatus()).toBe(503);
    }
  });

  it('un error de Prisma no clasificado ({code:"P2011"}) → 500, nunca 503 (B1)', async () => {
    createTagMock.mockRejectedValue({
      name: 'PrismaClientKnownRequestError',
      code: 'P2011',
      message: 'Null constraint violation on the fields: (`slug`)',
    });

    expect.assertions(2);
    try {
      await service.create(createDto({ name: 'Oferta Verano' }));
    } catch (error) {
      expect(error).toBeInstanceOf(InternalServerErrorException);
      expect((error as InternalServerErrorException).getStatus()).toBe(500);
    }
  });
});

describe('TagsService.update (US-27b)', () => {
  let service: TagsService;

  beforeEach(() => {
    updateTagMock.mockReset();
    service = new TagsService();
  });

  it('id no entero → 404 sin llamar al repositorio (design.md DD-10)', async () => {
    expect.assertions(3);
    try {
      await service.update(NaN, updateDto({ name: 'x' }));
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getStatus()).toBe(404);
      expect(updateTagMock).not.toHaveBeenCalled();
    }
  });

  it('proyecta el DTO campo a campo, sin `slug` (inmutable) ni `socials`/`cover_image`', async () => {
    updateTagMock.mockResolvedValue(makeTagRecord({ name: 'Oferta de Invierno' }));

    await service.update(
      63,
      updateDto({
        name: 'Oferta de Invierno',
        slug: 'intento-de-cambiar' as never,
        socials: [{ icon: 'x', url: 'y' }],
        cover_image: { id: 1 },
      } as never),
    );

    expect(updateTagMock).toHaveBeenCalledTimes(1);
    const [calledId, calledWith] = updateTagMock.mock.calls[0];
    expect(calledId).toBe(63);
    expect(calledWith).toEqual({ name: 'Oferta de Invierno' });
    expect('slug' in calledWith).toBe(false);
    expect('socials' in calledWith).toBe(false);
    expect('cover_image' in calledWith).toBe(false);
  });

  it('resuelve `type` con UN `listTypes()` secuencial, después de la escritura', async () => {
    const callOrder: string[] = [];
    updateTagMock.mockImplementation(async () => {
      callOrder.push('updateTag');
      return makeTagRecord();
    });
    listTypesMock.mockImplementation(async () => {
      callOrder.push('listTypes');
      return [];
    });

    await service.update(63, updateDto({ name: 'Oferta de Invierno' }));

    expect(callOrder).toEqual(['updateTag', 'listTypes']);
  });

  it('RecordNotFoundError del repositorio → 404', async () => {
    updateTagMock.mockRejectedValue(new RecordNotFoundError('tags', 99999));

    expect.assertions(2);
    try {
      await service.update(99999, updateDto({ name: 'x' }));
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getStatus()).toBe(404);
    }
  });

  it('EmptySlugError del repositorio (`name` vacío) → 400', async () => {
    updateTagMock.mockRejectedValue(new EmptySlugError('tags', ''));

    expect.assertions(2);
    try {
      await service.update(63, updateDto({ name: '' }));
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
    }
  });

  it('InvalidReferenceError del repositorio (`type_id` inexistente) → 400', async () => {
    updateTagMock.mockRejectedValue(
      new InvalidReferenceError('tags', 'type_id', 99999),
    );

    expect.assertions(2);
    try {
      await service.update(63, updateDto({ type_id: 99999 }));
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
    }
  });
});

describe('TagsService.remove (US-27b)', () => {
  let service: TagsService;

  beforeEach(() => {
    deleteTagMock.mockReset();
    service = new TagsService();
  });

  it('id no entero → 404 sin llamar al repositorio', async () => {
    expect.assertions(3);
    try {
      await service.remove(NaN);
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getStatus()).toBe(404);
      expect(deleteTagMock).not.toHaveBeenCalled();
    }
  });

  it('RecordNotFoundError del repositorio → 404', async () => {
    deleteTagMock.mockRejectedValue(new RecordNotFoundError('tags', 99999));

    expect.assertions(2);
    try {
      await service.remove(99999);
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getStatus()).toBe(404);
    }
  });

  it('borrado exitoso devuelve la proyección de `toTagDto`', async () => {
    deleteTagMock.mockResolvedValue(makeTagRecord());

    const result = await service.remove(63);

    expect(result).toMatchObject({ id: 63, slug: 'oferta-verano' });
  });
});

describe('Contrato de 9 claves — create/update/remove igual a findOne (CA-1)', () => {
  let service: TagsService;

  beforeEach(() => {
    createTagMock.mockReset();
    updateTagMock.mockReset();
    deleteTagMock.mockReset();
    findTagBySlugMock.mockReset();
    listTypesMock.mockReset();
    listTypesMock.mockResolvedValue([]);
    service = new TagsService();
  });

  it('Object.keys() de las 3 escrituras es idéntico, EN ORDEN, al de la lectura', async () => {
    const record = makeTagRecord();
    findTagBySlugMock.mockResolvedValue(record);
    createTagMock.mockResolvedValue(record);
    updateTagMock.mockResolvedValue(record);
    deleteTagMock.mockResolvedValue(record);

    const readResult = await service.findOne('oferta-verano');
    const createResult = await service.create(
      createDto({ name: 'Oferta Verano' }),
    );
    const updateResult = await service.update(
      63,
      updateDto({ name: 'Oferta Verano' }),
    );
    const removeResult = await service.remove(63);

    const expectedKeys = Object.keys(readResult);
    expect(expectedKeys).toHaveLength(9);
    // Comparación de ORDEN exacto — nunca `.sort()` (jq no está instalado,
    // design.md nota sobre `node -e`, aquí equivalente con `toEqual`).
    expect(Object.keys(createResult)).toEqual(expectedKeys);
    expect(Object.keys(updateResult)).toEqual(expectedKeys);
    expect(Object.keys(removeResult)).toEqual(expectedKeys);
  });
});
