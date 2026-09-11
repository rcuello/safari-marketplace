import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createCategory,
  deleteCategory,
  findCategoryByIdOrSlug,
  getUserFriendlyMessage,
  isPrismaConnectionError,
  listCategories,
  updateCategory,
  type CategoryAncestor,
  type CategoryDescendant,
  type CategoryRecord,
  type CategoryTreeNode,
  type ListCategoriesInput,
  type Prisma,
  type TypeRecord,
} from '@safari/db';
import { toWriteHttpException } from 'src/common/errors/domain-error.mapper';
import { CreateCategoryDto } from './dto/create-category.dto';
import { GetCategoriesDto } from './dto/get-categories.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { Category } from './entities/category.entity';
import { paginate } from 'src/common/pagination/paginate';
import { parseSearch } from 'src/common/search/parse-search';

/**
 * `search=key:value;key:value` → `ListCategoriesInput` de `@safari/db`
 * (Decisión G, design.md). `type.slug` es igualdad SQL exacta (reemplaza
 * el `fuse.js` difuso del mock, V-4); `name` se soporta a propósito, aunque
 * el "In Scope" del proposal solo nombre `type.slug`: el admin manda ese
 * token desde su caja de búsqueda hoy y funciona (difusamente) — dejarlo
 * sin traducir sería una regresión, no una divergencia declarable.
 */
function parseCategorySearch(search?: string): ListCategoriesInput {
  const tokens = parseSearch(search);
  const input: ListCategoriesInput = {};
  if (tokens['type.slug']) input.typeSlug = tokens['type.slug'];
  if (tokens.name) input.name = tokens.name;
  return input;
}

/**
 * `toEmbeddedType` — 10 claves, el mismo `type` embebido que sirve
 * `/api/types` de US-4a (duplicación aceptada, design.md Decisión F).
 */
function toEmbeddedType(record: TypeRecord) {
  return {
    id: record.id,
    name: record.name,
    language: record.language,
    translated_languages: ['en'], // constante: no hay columna (V-3)
    settings: record.settings,
    slug: record.slug,
    icon: record.icon,
    promotional_sliders: null, // constante: no hay columna (V-3)
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

/**
 * `toAncestorDto` — 14 claves: las de `toCategoryDto` menos `type` y
 * `children`; `parent` recursivo (cadena ascendente completa, D-2).
 */
function toAncestorDto(ancestor: CategoryAncestor) {
  return {
    id: ancestor.id,
    name: ancestor.name,
    slug: ancestor.slug,
    icon: ancestor.icon,
    image: ancestor.image,
    details: ancestor.details,
    language: ancestor.language,
    translated_languages: ['en'],
    parent: ancestor.parent ? toAncestorDto(ancestor.parent) : null,
    type_id: ancestor.typeId,
    created_at: ancestor.createdAt,
    updated_at: ancestor.updatedAt,
    deleted_at: null,
    parent_id: ancestor.parentId,
  };
}

/**
 * Forma **E** (Decisión C): el `parent` de un descendiente a profundidad
 * 1 en el mock — el literal de las 16 claves de `toCategoryDto` sobre un
 * `CategoryRecord` plano, con `parent`/`type`/`children` en `null`. El
 * mock emite el número escalar a profundidad 2 (incoherencia de eager
 * loading); reproducirla exige un contador de profundidad que D-1
 * prohíbe, así que se emite **E en todos los niveles** (V-6): la misma
 * categoría 169 pasa a tener un `parent` coherente en las dos posiciones
 * donde aparece (top-level y anidada).
 */
function toParentEDto(rec: CategoryRecord) {
  return {
    id: rec.id,
    name: rec.name,
    slug: rec.slug,
    icon: rec.icon,
    image: rec.image,
    details: rec.details,
    language: rec.language,
    translated_languages: ['en'],
    parent: null,
    type_id: rec.typeId,
    created_at: rec.createdAt,
    updated_at: rec.updatedAt,
    deleted_at: null,
    parent_id: rec.parentId,
    type: null,
    children: null,
  };
}

/**
 * `toDescendantDto` — 16 claves como `toCategoryDto`, pero SIN `type` y
 * con `products_count` (V-1: siempre 0, `category_product` vacía por
 * diseño). `parent` es la forma **E** de arriba.
 */
function toDescendantDto(descendant: CategoryDescendant) {
  return {
    id: descendant.id,
    name: descendant.name,
    slug: descendant.slug,
    icon: descendant.icon,
    image: descendant.image,
    details: descendant.details,
    language: descendant.language,
    translated_languages: ['en'],
    parent: descendant.parent ? toParentEDto(descendant.parent) : null,
    type_id: descendant.typeId,
    created_at: descendant.createdAt,
    updated_at: descendant.updatedAt,
    deleted_at: null,
    products_count: 0,
    parent_id: descendant.parentId,
    children: descendant.children.map(toDescendantDto),
  };
}

/**
 * `toCategoryDto` — 16 claves uniformes para TODOS los nodos top-level,
 * incluidas las 21 raíces de `gadget`/`medicine` que el mock sirve con
 * una variante de 13 claves (D-5/V-2, decidido por el usuario:
 * uniformidad sobre ramificar el mapper por `type_id`). El cast
 * `as unknown as Category` va aquí porque es la única de las cuatro
 * proyecciones cuyo tipo declarado es la entidad de Nest (precedente:
 * `toProductDto`, `products.service.ts`).
 */
function toCategoryDto(node: CategoryTreeNode): Category {
  return {
    id: node.id,
    name: node.name,
    slug: node.slug,
    icon: node.icon,
    image: node.image,
    details: node.details,
    language: node.language,
    translated_languages: ['en'],
    parent: node.parent ? toAncestorDto(node.parent) : null,
    type_id: node.typeId,
    created_at: node.createdAt,
    updated_at: node.updatedAt,
    deleted_at: null,
    parent_id: node.parentId,
    type: toEmbeddedType(node.type),
    children: node.children.map(toDescendantDto),
  } as unknown as Category;
}

@Injectable()
export class CategoriesService {
  async getCategories({ limit, page, search, parent }: GetCategoriesDto) {
    if (!page) page = 1;

    // El mock filtra raíces SOLO cuando el valor es exactamente el string
    // 'null' (categories.service.ts:39 previo). Todo lo demás -incluido
    // `undefined` (el default del DTO no se aplica: ValidationPipe no
    // transforma) y el 'all' que manda la tienda cuando
    // type.settings.layoutType === 'minimal'- devuelve la lista plana.
    const rootsOnly = parent === 'null';

    const input: ListCategoriesInput = {
      ...parseCategorySearch(search),
      rootsOnly,
      page: Number(page) || 1,
      limit: Number(limit) || 30,
    };

    try {
      const { items, total } = await listCategories(input);
      const data = items.map(toCategoryDto);
      const url = `/categories?search=${search}&limit=${limit}&parent=${parent}`;
      return {
        data,
        ...paginate(total, page, limit, data.length, url),
      };
    } catch (error) {
      if (isPrismaConnectionError(error)) {
        throw new ServiceUnavailableException(getUserFriendlyMessage(error));
      }
      throw new InternalServerErrorException(getUserFriendlyMessage(error));
    }
  }

  async getCategory(param: string, _language: string): Promise<Category> {
    let node: CategoryTreeNode | null;

    // El try envuelve SOLO la llamada al repositorio. El 404 de abajo queda
    // fuera a propósito: si se lanzara dentro, este catch lo convertiría en
    // un 500 (patrón de products.service.ts:213-230).
    try {
      node = await findCategoryByIdOrSlug(param);
    } catch (error) {
      if (isPrismaConnectionError(error)) {
        throw new ServiceUnavailableException(getUserFriendlyMessage(error));
      }
      throw new InternalServerErrorException(getUserFriendlyMessage(error));
    }

    if (!node) {
      throw new NotFoundException(`No existe una categoría \`${param}\`.`);
    }

    return toCategoryDto(node);
  }

  /**
   * Proyecta el DTO campo a campo en `CreateCategoryInput` (nunca spread del
   * body). `type_id`/`parent` se coercionan con `Number(...)` (DD28-10,
   * réplica de W-2 de US-27b, `tags.service.ts:118-124`): sin `transform`
   * (`main.ts:9`), `{"type_id":"9"}` llega como STRING y el repositorio lo
   * rechazaría con un 400 que culpa al campo equivocado. `parent === null`
   * se respeta tal cual (raíz); `Number(null)` sería `0`, por eso la rama
   * `=== null` es obligatoria.
   */
  async create(createCategoryDto: CreateCategoryDto): Promise<Category> {
    try {
      const node = await createCategory({
        name: createCategoryDto.name,
        ...(createCategoryDto.slug !== undefined && {
          slug: createCategoryDto.slug,
        }),
        ...(createCategoryDto.details !== undefined && {
          details: createCategoryDto.details,
        }),
        ...(createCategoryDto.icon !== undefined && {
          icon: createCategoryDto.icon,
        }),
        ...(createCategoryDto.image !== undefined && {
          image: createCategoryDto.image as unknown as Prisma.InputJsonValue,
        }),
        ...(createCategoryDto.parent !== undefined && {
          parentId:
            createCategoryDto.parent === null
              ? null
              : Number(createCategoryDto.parent),
        }),
        ...(createCategoryDto.language !== undefined && {
          language: createCategoryDto.language,
        }),
        typeId: Number(createCategoryDto.type_id),
      });
      return toCategoryDto(node);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /**
   * `+id` llega como `NaN` desde el controlador si `PUT /api/categories/abc`;
   * sin esta guarda, `BigInt(NaN)` revienta en 500 dentro del repositorio
   * (precedente exacto `types.service.ts:119-128`). Los dos spreads de
   * `type_id`/`parent` son **condicionales por separado** (DD28-10): así se
   * preserva la semántica `Partial` de `UpdateCategoryInput` — un campo
   * ausente en el body nunca sobrescribe el valor actual, y "no tocar el
   * type" queda distinguible de "ponerlo al valor actual" (DD28-5).
   *
   * `!Number.isSafeInteger(id) || id <= 0` (no solo `!Number.isInteger`) —
   * corrección de un `GATE: FAIL` posterior a PR#2: `PUT
   * /api/categories/1e21` con `+id` evaluando a `1e21` pasaba
   * `Number.isInteger` (no tiene parte decimal) y llegaba al repositorio, que
   * intentaba `BigInt`/coerción de un id fuera del rango de `bigint` de
   * Postgres y reventaba en HTTP 500 antes de que este guard pudiera
   * atajarlo. `id <= 0` está aquí porque ningún id real del catálogo es
   * `<= 0` (serial arrancando en 1): rechazarlo temprano con 404 evita un
   * round trip al repositorio para un id que nunca puede existir.
   */
  async update(
    id: number,
    updateCategoryDto: UpdateCategoryDto
  ): Promise<Category> {
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new NotFoundException(`No existe una categoría con id ${id}.`);
    }

    try {
      const node = await updateCategory(id, {
        ...(updateCategoryDto.name !== undefined && {
          name: updateCategoryDto.name,
        }),
        ...(updateCategoryDto.details !== undefined && {
          details: updateCategoryDto.details,
        }),
        ...(updateCategoryDto.icon !== undefined && {
          icon: updateCategoryDto.icon,
        }),
        ...(updateCategoryDto.image !== undefined && {
          image: updateCategoryDto.image as unknown as Prisma.InputJsonValue,
        }),
        ...(updateCategoryDto.parent !== undefined && {
          parentId:
            updateCategoryDto.parent === null
              ? null
              : Number(updateCategoryDto.parent),
        }),
        ...(updateCategoryDto.language !== undefined && {
          language: updateCategoryDto.language,
        }),
        ...(updateCategoryDto.type_id !== undefined && {
          typeId: Number(updateCategoryDto.type_id),
        }),
      });
      return toCategoryDto(node);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  async remove(id: number): Promise<Category> {
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new NotFoundException(`No existe una categoría con id ${id}.`);
    }

    try {
      const node = await deleteCategory(id);
      return toCategoryDto(node);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }
}
