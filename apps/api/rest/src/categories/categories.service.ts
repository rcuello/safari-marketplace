import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { plainToClass } from 'class-transformer';
import {
  findCategoryByIdOrSlug,
  getUserFriendlyMessage,
  isPrismaConnectionError,
  listCategories,
  type CategoryAncestor,
  type CategoryDescendant,
  type CategoryRecord,
  type CategoryTreeNode,
  type ListCategoriesInput,
  type TypeRecord,
} from '@safari/db';
import { CreateCategoryDto } from './dto/create-category.dto';
import { GetCategoriesDto } from './dto/get-categories.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { Category } from './entities/category.entity';
import Fuse from 'fuse.js';
import categoriesJson from '@db/categories.json';
import { paginate } from 'src/common/pagination/paginate';
import { parseSearch } from 'src/common/search/parse-search';

const categories = plainToClass(Category, categoriesJson);
const options = {
  keys: ['name', 'type.slug'],
  threshold: 0.3,
};
const fuse = new Fuse(categories, options);

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
  private categories: Category[] = categories;

  create(createCategoryDto: CreateCategoryDto) {
    return this.categories[0];
  }

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

  update(id: number, updateCategoryDto: UpdateCategoryDto) {
    return this.categories[0];
  }

  remove(id: number) {
    return `This action removes a #${id} category`;
  }
}
