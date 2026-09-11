/// <reference types="jest" />
/*
 * La referencia de arriba es necesaria porque tsconfig.json fija
 * `types: ["node","express","multer"]` y deja fuera los globals de jest;
 * se limita a este archivo para no tocar la config del build.
 */
/**
 * Tests unitarios de las escrituras de `CategoriesService` (US-28):
 * `create`/`update`/`remove`.
 *
 * Mismo arnés que `types.service.spec.ts:1-88` / `tags.service.spec.ts:1-56`:
 * se mockea SOLO el acceso a datos (`createCategory`/`updateCategory`/
 * `deleteCategory`, y también `findCategoryByIdOrSlug`/`listCategories` —
 * necesarios para comparar el `Object.keys()` de las 3 escrituras contra el
 * de la lectura, CA-1) y se dejan REALES las 5 clases de error de dominio y
 * `toWriteHttpException` (vía `domain-error.mapper.ts`, tampoco mockeado),
 * para que la traducción a HTTP se pruebe de verdad.
 *
 * `categories` es el único agregado del catálogo con una referencia numérica
 * DOBLE en el body de escritura (`type_id` y `parent`, DD28-10) y con
 * semántica `Partial` real en `update` (un `parent` ausente no debe tocar el
 * padre actual; un `parent: null` explícito sí debe re-enraizar a la
 * categoría). Esa distinción `undefined` vs. `null` es el foco central de
 * este archivo — fue el hallazgo de mayor riesgo señalado para esta PR.
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
  createCategory,
  deleteCategory,
  DependentRowsError,
  EmptySlugError,
  findCategoryByIdOrSlug,
  InvalidReferenceError,
  listCategories,
  RecordNotFoundError,
  SlugConflictError,
  updateCategory,
  type CategoryAncestor,
  type CategoryDescendant,
  type CategoryTreeNode,
  type TypeRecord,
} from '@safari/db';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

jest.mock('@safari/db', () => ({
  // El barrel es seguro de cargar sin DATABASE_URL (cliente lazy vía Proxy);
  // se conservan reales las clases de error de dominio y solo se mockea el
  // acceso a datos.
  ...jest.requireActual<typeof import('@safari/db')>('@safari/db'),
  createCategory: jest.fn(),
  updateCategory: jest.fn(),
  deleteCategory: jest.fn(),
  findCategoryByIdOrSlug: jest.fn(),
  listCategories: jest.fn(),
}));

const createCategoryMock = jest.mocked(createCategory);
const updateCategoryMock = jest.mocked(updateCategory);
const deleteCategoryMock = jest.mocked(deleteCategory);
const findCategoryByIdOrSlugMock = jest.mocked(findCategoryByIdOrSlug);
const listCategoriesMock = jest.mocked(listCategories);

const NOW = new Date('2026-09-10T00:00:00Z');

function makeTypeRecord(overrides: Partial<TypeRecord> = {}): TypeRecord {
  return {
    id: 7,
    name: 'Daily needs',
    slug: 'daily-needs',
    icon: null,
    settings: {},
    banners: [],
    language: 'es',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** Madre embebida a UN nivel (design.md: "un `parent` de un nivel"). */
function makeAncestor(
  overrides: Partial<CategoryAncestor> = {},
): CategoryAncestor {
  return {
    id: 7,
    name: 'Groceries',
    slug: 'groceries',
    icon: null,
    details: null,
    image: null,
    parentId: null,
    typeId: 7,
    language: 'es',
    createdAt: NOW,
    updatedAt: NOW,
    parent: null,
    ...overrides,
  };
}

/** Hija embebida a UN nivel (design.md: "una `children` de un nivel"). */
function makeDescendant(
  overrides: Partial<CategoryDescendant> = {},
): CategoryDescendant {
  return {
    id: 826,
    name: 'Fresh Dairy',
    slug: 'fresh-dairy',
    icon: null,
    details: null,
    image: null,
    parentId: 124,
    typeId: 7,
    language: 'es',
    createdAt: NOW,
    updatedAt: NOW,
    parent: null,
    children: [],
    ...overrides,
  };
}

/**
 * Factory pedida por design.md: un `CategoryTreeNode` con `type` embebido,
 * un `parent` de un nivel y una `children` de un nivel — ejercita
 * `toCategoryDto`/`toAncestorDto`/`toDescendantDto`/`toParentEDto` completos
 * en cada escenario, no solo un nodo plano.
 */
function makeCategoryNode(
  overrides: Partial<CategoryTreeNode> = {},
): CategoryTreeNode {
  return {
    id: 124,
    name: 'Dairy',
    slug: 'dairy-2',
    icon: null,
    details: null,
    image: null,
    parentId: 7,
    typeId: 7,
    language: 'es',
    createdAt: NOW,
    updatedAt: NOW,
    type: makeTypeRecord(),
    parent: makeAncestor(),
    children: [makeDescendant()],
    ...overrides,
  };
}

/**
 * `ValidationPipe` corre sin `transform`; en runtime el body ya llegó tal
 * cual del cliente antes de tocar el servicio, pero este spec ejercita el
 * servicio directamente, así que construye el DTO a mano — mismo
 * cast-precedente que `types.service.spec.ts:81-83`/`tags.service.spec.ts:104-108`.
 */
function createDto(
  input: Partial<CreateCategoryDto> & Record<string, unknown>,
): CreateCategoryDto {
  return input as unknown as CreateCategoryDto;
}

function updateDto(
  input: Partial<UpdateCategoryDto> & Record<string, unknown>,
): UpdateCategoryDto {
  return input as unknown as UpdateCategoryDto;
}

describe('CategoriesService.create (US-28)', () => {
  let service: CategoriesService;

  beforeEach(() => {
    createCategoryMock.mockReset();
    service = new CategoriesService();
  });

  it('proyecta el DTO campo a campo: omite `slug`/`details`/`icon`/`image`/`parent`/`language` ausentes', async () => {
    createCategoryMock.mockResolvedValue(makeCategoryNode());

    await service.create(createDto({ name: 'Dairy', type_id: 7 }));

    expect(createCategoryMock).toHaveBeenCalledTimes(1);
    const calledWith = createCategoryMock.mock.calls[0][0];
    expect(calledWith).toEqual({ name: 'Dairy', typeId: 7 });
    expect('slug' in calledWith).toBe(false);
    expect('details' in calledWith).toBe(false);
    expect('icon' in calledWith).toBe(false);
    expect('image' in calledWith).toBe(false);
    expect('parentId' in calledWith).toBe(false);
    expect('language' in calledWith).toBe(false);
  });

  it('cuando los campos opcionales llegan, se proyectan al input del repositorio (`image` casteado, nunca `as any`)', async () => {
    createCategoryMock.mockResolvedValue(makeCategoryNode());
    const image = { id: 1, original: 'o', thumbnail: 't' };

    await service.create(
      createDto({
        name: 'Dairy',
        slug: 'dairy-custom',
        details: 'Detalle',
        icon: 'icon-x',
        image: image as never,
        parent: 7,
        language: 'es',
        type_id: 7,
      }),
    );

    expect(createCategoryMock).toHaveBeenCalledWith({
      name: 'Dairy',
      slug: 'dairy-custom',
      details: 'Detalle',
      icon: 'icon-x',
      image,
      parentId: 7,
      language: 'es',
      typeId: 7,
    });
  });

  it('`type_id` STRING (`"7"`, `ValidationPipe` sin `transform`) se coerciona a `typeId: 7` (DD28-10, réplica de W-2 de US-27b)', async () => {
    createCategoryMock.mockResolvedValue(makeCategoryNode());

    await service.create(
      createDto({ name: 'Dairy', type_id: '7' as never }),
    );

    expect(createCategoryMock).toHaveBeenCalledWith({
      name: 'Dairy',
      typeId: 7,
    });
  });

  it('`parent: null` se proyecta como `parentId: null` (raíz explícita), nunca `Number(null)` === 0 (DD28-10, la trampa de re-enraizado)', async () => {
    createCategoryMock.mockResolvedValue(makeCategoryNode());

    await service.create(
      createDto({ name: 'Dairy', type_id: 7, parent: null }),
    );

    expect(createCategoryMock).toHaveBeenCalledWith({
      name: 'Dairy',
      typeId: 7,
      parentId: null,
    });
  });

  it('`parent` STRING (`"825"`) se coerciona con `Number(...)` a `parentId: 825`', async () => {
    createCategoryMock.mockResolvedValue(makeCategoryNode());

    await service.create(
      createDto({ name: 'Dairy', type_id: 7, parent: '825' as never }),
    );

    expect(createCategoryMock).toHaveBeenCalledWith({
      name: 'Dairy',
      typeId: 7,
      parentId: 825,
    });
  });

  it('`type_id`/`parent` no numéricos (`"abc"`) se coercionan a `NaN` en el input — la guarda real (regla 1) vive en el repositorio, no aquí (Data Flow, design.md)', async () => {
    createCategoryMock.mockResolvedValue(makeCategoryNode());

    await service.create(
      createDto({
        name: 'Dairy',
        type_id: 'abc' as never,
        parent: 'abc' as never,
      }),
    );

    const calledWith = createCategoryMock.mock.calls[0][0];
    expect(calledWith.typeId).toBeNaN();
    expect(calledWith.parentId).toBeNaN();
  });

  it('EmptySlugError del repositorio → 400', async () => {
    createCategoryMock.mockRejectedValue(new EmptySlugError('categories', '!!!'));

    expect.assertions(2);
    try {
      await service.create(createDto({ name: '!!!', type_id: 7 }));
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
    }
  });

  it('InvalidReferenceError del repositorio (cualquiera de las 7 reglas de DD28-3) → 400', async () => {
    createCategoryMock.mockRejectedValue(
      new InvalidReferenceError('categories', 'parent_id', 99999),
    );

    expect.assertions(2);
    try {
      await service.create(
        createDto({ name: 'Dairy', type_id: 7, parent: 99999 }),
      );
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
    }
  });

  it('SlugConflictError del repositorio (carrera en `slug`, P2002) → 409', async () => {
    createCategoryMock.mockRejectedValue(
      new SlugConflictError('categories', 'dairy-2'),
    );

    expect.assertions(2);
    try {
      await service.create(createDto({ name: 'Dairy', type_id: 7 }));
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getStatus()).toBe(409);
    }
  });

  it('un fallo de conexión de Prisma ({code:"P1001"}) → 503', async () => {
    createCategoryMock.mockRejectedValue({
      name: 'PrismaClientKnownRequestError',
      code: 'P1001',
      message: "Can't reach database server at `localhost:5433`",
    });

    expect.assertions(2);
    try {
      await service.create(createDto({ name: 'Dairy', type_id: 7 }));
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getStatus()).toBe(503);
    }
  });

  it('un error de Prisma no clasificado ({code:"P2011"}) → 500, nunca 503 (B1)', async () => {
    createCategoryMock.mockRejectedValue({
      name: 'PrismaClientKnownRequestError',
      code: 'P2011',
      message: 'Null constraint violation on the fields: (`slug`)',
    });

    expect.assertions(2);
    try {
      await service.create(createDto({ name: 'Dairy', type_id: 7 }));
    } catch (error) {
      expect(error).toBeInstanceOf(InternalServerErrorException);
      expect((error as InternalServerErrorException).getStatus()).toBe(500);
    }
  });
});

describe('CategoriesService.update (US-28)', () => {
  let service: CategoriesService;

  beforeEach(() => {
    updateCategoryMock.mockReset();
    service = new CategoriesService();
  });

  it.each([
    ['NaN', NaN],
    ['cero', 0],
    ['negativo', -5],
    ['fuera del rango seguro de bigint (1e21)', 1e21],
  ])('id %s → 404 sin llamar al repositorio (`!Number.isSafeInteger(id) || id <= 0`)', async (_label, id) => {
    expect.assertions(3);
    try {
      await service.update(id, updateDto({ name: 'x' }));
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getStatus()).toBe(404);
      expect(updateCategoryMock).not.toHaveBeenCalled();
    }
  });

  it('`PUT {}` no envía `parent`/`type_id` al repositorio: un campo ausente NUNCA sobrescribe el valor actual (semántica `Partial`, DD28-10)', async () => {
    updateCategoryMock.mockResolvedValue(makeCategoryNode());

    await service.update(124, updateDto({}));

    expect(updateCategoryMock).toHaveBeenCalledWith(124, {});
  });

  it('`PUT {"name":...}` sin `parent` deja el input SIN `parentId`: renombrar no re-enraíza en silencio', async () => {
    updateCategoryMock.mockResolvedValue(makeCategoryNode());

    await service.update(124, updateDto({ name: 'Dairy Renombrada' }));

    expect(updateCategoryMock).toHaveBeenCalledWith(124, {
      name: 'Dairy Renombrada',
    });
  });

  it('`parent: null` explícito limpia el padre (`parentId: null`) — distinguible de "ausente"', async () => {
    updateCategoryMock.mockResolvedValue(makeCategoryNode());

    await service.update(124, updateDto({ parent: null }));

    expect(updateCategoryMock).toHaveBeenCalledWith(124, { parentId: null });
  });

  it('`parent` numérico o STRING se coerciona a `parentId: Number(...)`', async () => {
    updateCategoryMock.mockResolvedValue(makeCategoryNode());

    await service.update(124, updateDto({ parent: 825 }));
    expect(updateCategoryMock).toHaveBeenLastCalledWith(124, {
      parentId: 825,
    });

    await service.update(124, updateDto({ parent: '825' as never }));
    expect(updateCategoryMock).toHaveBeenLastCalledWith(124, {
      parentId: 825,
    });
  });

  it('`type_id` ausente no se envía; presente (STRING) se coerciona a `typeId`, cada spread es condicional POR SEPARADO de `parent` (DD28-10)', async () => {
    updateCategoryMock.mockResolvedValue(makeCategoryNode());

    await service.update(124, updateDto({ type_id: '9' as never }));
    expect(updateCategoryMock).toHaveBeenLastCalledWith(124, { typeId: 9 });

    // Ambos presentes a la vez: ninguno pisa al otro.
    await service.update(
      124,
      updateDto({ type_id: '9' as never, parent: null }),
    );
    expect(updateCategoryMock).toHaveBeenLastCalledWith(124, {
      typeId: 9,
      parentId: null,
    });
  });

  it('`type_id`/`parent` no numéricos (`"abc"`) se coercionan a `NaN` en el input de update — la guarda real vive en el repositorio', async () => {
    updateCategoryMock.mockResolvedValue(makeCategoryNode());

    await service.update(
      124,
      updateDto({ type_id: 'abc' as never, parent: 'abc' as never }),
    );

    const calledWith = updateCategoryMock.mock.calls[0][1];
    expect(calledWith.typeId).toBeNaN();
    expect(calledWith.parentId).toBeNaN();
  });

  it('`slug` NUNCA se proyecta al input de update (inmutable, `UpdateCategoryInput` lo omite a nivel de tipo), aunque llegue en el body', async () => {
    updateCategoryMock.mockResolvedValue(makeCategoryNode());

    await service.update(
      124,
      updateDto({ name: 'x', slug: 'intento-de-cambiar' as never }),
    );

    const calledWith = updateCategoryMock.mock.calls[0][1];
    expect('slug' in calledWith).toBe(false);
  });

  it('RecordNotFoundError del repositorio → 404', async () => {
    updateCategoryMock.mockRejectedValue(
      new RecordNotFoundError('categories', 99999),
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
    updateCategoryMock.mockRejectedValue(new EmptySlugError('categories', ''));

    expect.assertions(2);
    try {
      await service.update(124, updateDto({ name: '' }));
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
    }
  });

  it('InvalidReferenceError del repositorio (cualquiera de las 7 reglas) → 400', async () => {
    updateCategoryMock.mockRejectedValue(
      new InvalidReferenceError('categories', 'parent_id (ciclo)', 124),
    );

    expect.assertions(2);
    try {
      await service.update(124, updateDto({ parent: 826 }));
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
    }
  });

  it('un fallo de conexión de Prisma ({code:"P1001"}) → 503', async () => {
    updateCategoryMock.mockRejectedValue({
      name: 'PrismaClientKnownRequestError',
      code: 'P1001',
      message: "Can't reach database server at `localhost:5433`",
    });

    expect.assertions(2);
    try {
      await service.update(124, updateDto({ name: 'x' }));
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getStatus()).toBe(503);
    }
  });

  it('un error de Prisma no clasificado ({code:"P2011"}) → 500, nunca 503 (B1)', async () => {
    updateCategoryMock.mockRejectedValue({
      name: 'PrismaClientKnownRequestError',
      code: 'P2011',
      message: 'Null constraint violation on the fields: (`slug`)',
    });

    expect.assertions(2);
    try {
      await service.update(124, updateDto({ name: 'x' }));
    } catch (error) {
      expect(error).toBeInstanceOf(InternalServerErrorException);
      expect((error as InternalServerErrorException).getStatus()).toBe(500);
    }
  });
});

describe('CategoriesService.remove (US-28)', () => {
  let service: CategoriesService;

  beforeEach(() => {
    deleteCategoryMock.mockReset();
    findCategoryByIdOrSlugMock.mockReset();
    listCategoriesMock.mockReset();
    service = new CategoriesService();
  });

  it.each([
    ['NaN', NaN],
    ['cero', 0],
    ['negativo', -5],
    ['fuera del rango seguro de bigint (1e21)', 1e21],
  ])('id %s → 404 sin llamar al repositorio', async (_label, id) => {
    expect.assertions(3);
    try {
      await service.remove(id);
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getStatus()).toBe(404);
      expect(deleteCategoryMock).not.toHaveBeenCalled();
    }
  });

  it('RecordNotFoundError del repositorio → 404', async () => {
    deleteCategoryMock.mockRejectedValue(
      new RecordNotFoundError('categories', 99999),
    );

    expect.assertions(2);
    try {
      await service.remove(99999);
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getStatus()).toBe(404);
    }
  });

  it('un fallo de conexión de Prisma ({code:"P1001"}) → 503', async () => {
    deleteCategoryMock.mockRejectedValue({
      name: 'PrismaClientKnownRequestError',
      code: 'P1001',
      message: "Can't reach database server at `localhost:5433`",
    });

    expect.assertions(2);
    try {
      await service.remove(124);
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getStatus()).toBe(503);
    }
  });

  it('borrado exitoso devuelve la proyección de `toCategoryDto` del snapshot PRE-borrado tal cual, sin volver a consultar el árbol (DD28-2)', async () => {
    // `children[0]` conserva a propósito el `parent_id` de ANTES del borrado
    // (824, la propia madre que se está borrando) — es lo que el repositorio
    // (PR#1) ya prueba en vivo. Este test unitario prueba una cosa distinta:
    // que el servicio NO vuelve a llamar a `findCategoryByIdOrSlug`/
    // `listCategories` después del `deleteCategory`, y por lo tanto NUNCA
    // podría diluir o refrescar ese snapshot con el estado post-borrado.
    const preDeleteSnapshot = makeCategoryNode({
      id: 824,
      parent: null,
      children: [makeDescendant({ id: 826, parentId: 824 })],
    });
    deleteCategoryMock.mockResolvedValue(preDeleteSnapshot);

    const result = await service.remove(824);

    expect(result).toMatchObject({ id: 824, parent: null });
    expect(result.children).toHaveLength(1);
    expect(result.children[0]).toMatchObject({ id: 826, parent_id: 824 });
    expect(findCategoryByIdOrSlugMock).not.toHaveBeenCalled();
    expect(listCategoriesMock).not.toHaveBeenCalled();
  });
});

describe('Contrato de 16 claves — create/update/remove igual a getCategory, EN ORDEN (CA-1, CA-2, CA-3)', () => {
  let service: CategoriesService;

  beforeEach(() => {
    createCategoryMock.mockReset();
    updateCategoryMock.mockReset();
    deleteCategoryMock.mockReset();
    findCategoryByIdOrSlugMock.mockReset();
    service = new CategoriesService();
  });

  it('Object.keys() de las 3 escrituras es idéntico, EN ORDEN, al de `getCategory` — 16 claves, nunca `.sort()`', async () => {
    const node = makeCategoryNode();
    findCategoryByIdOrSlugMock.mockResolvedValue(node);
    createCategoryMock.mockResolvedValue(node);
    updateCategoryMock.mockResolvedValue(node);
    deleteCategoryMock.mockResolvedValue(node);

    const readResult = await service.getCategory('dairy-2', 'es');
    const createResult = await service.create(
      createDto({ name: 'Dairy', type_id: 7 }),
    );
    const updateResult = await service.update(
      124,
      updateDto({ name: 'Dairy' }),
    );
    const removeResult = await service.remove(124);

    const expectedKeys = Object.keys(readResult);
    expect(expectedKeys).toHaveLength(16);
    // Comparación de ORDEN exacto — nunca `.sort()` (jq no está instalado;
    // `node -e` fue el idiom usado en la evidencia manual de PR#2, esto es
    // el equivalente en jest con `toEqual` sobre el array de claves).
    expect(Object.keys(createResult)).toEqual(expectedKeys);
    expect(Object.keys(updateResult)).toEqual(expectedKeys);
    expect(Object.keys(removeResult)).toEqual(expectedKeys);
  });
});
