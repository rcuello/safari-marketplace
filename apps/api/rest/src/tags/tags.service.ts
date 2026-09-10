import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { paginate } from 'src/common/pagination/paginate';
import {
  createTag,
  deleteTag,
  findTagBySlug,
  getUserFriendlyMessage,
  isPrismaConnectionError,
  listTags,
  listTypes,
  updateTag,
  type ListTagsInput,
  type Prisma,
  type TagRecord,
  type TypeRecord,
} from '@safari/db';
import { toWriteHttpException } from 'src/common/errors/domain-error.mapper';
import { CreateTagDto } from './dto/create-tag.dto';
import { GetTagsDto, TagPaginator } from './dto/get-tags.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
import { Tag } from './entities/tag.entity';
import { parseSearch } from 'src/common/search/parse-search';

/**
 * `TagRecord` (camelCase, `@safari/db`) → proyección de 9 claves
 * snake_case que ya publicaba `tags.json`. `type` es el `TypeRecord`
 * resuelto en memoria (Decisión F, design.md): `null` si `typeId` es
 * `null` (V-23), nunca un objeto a medias. Se castea a `Tag`, igual que
 * `toProductDto` — la entidad declara campos que este listado no emite
 * (`parent`, `products`).
 */
function toTagDto(
  record: TagRecord,
  typesById: Map<number, TypeRecord>
): Tag {
  const type = record.typeId !== null ? typesById.get(record.typeId) : undefined;
  return {
    id: record.id,
    name: record.name,
    language: record.language,
    translated_languages: ['en'],
    slug: record.slug,
    details: record.details,
    image: record.image,
    icon: record.icon,
    type: type
      ? { id: type.id, name: type.name, slug: type.slug, logo: null }
      : null,
  } as unknown as Tag;
}

@Injectable()
export class TagsService {
  async findAll({ page, limit, search }: GetTagsDto): Promise<TagPaginator> {
    if (!page) page = 1;

    const tokens = parseSearch(search);
    const input: ListTagsInput = {
      name: tokens.name,
      typeSlug: tokens['type.slug'],
      page: Number(page) || 1,
      limit: Number(limit) || 30,
    };

    let result: { items: TagRecord[]; total: number };
    let types: TypeRecord[];
    try {
      [result, types] = await Promise.all([listTags(input), listTypes()]);
    } catch (error) {
      if (isPrismaConnectionError(error)) {
        throw new ServiceUnavailableException(getUserFriendlyMessage(error));
      }
      throw new InternalServerErrorException(getUserFriendlyMessage(error));
    }

    const typesById = new Map(types.map((t) => [t.id, t]));
    const data = result.items.map((r) => toTagDto(r, typesById));
    const url = `/tags?limit=${limit}`;
    return {
      data,
      ...paginate(result.total, page, limit, data.length, url),
    };
  }

  async findOne(param: string, language?: string): Promise<Tag> {
    let record: TagRecord | null;

    // El try envuelve SOLO las llamadas de I/O (mismo criterio que
    // findAll()). El 404 queda fuera a propósito: dentro, este catch lo
    // convertiría en un 500. D-8: solo por slug — la rama numérica del
    // mock (`id === Number(param)`) pasa a 404.
    let types: TypeRecord[];
    try {
      record = await findTagBySlug(param);
      types = await listTypes();
    } catch (error) {
      if (isPrismaConnectionError(error)) {
        throw new ServiceUnavailableException(getUserFriendlyMessage(error));
      }
      throw new InternalServerErrorException(getUserFriendlyMessage(error));
    }

    if (!record) {
      throw new NotFoundException(`No existe un tag con slug \`${param}\`.`);
    }

    const typesById = new Map(types.map((t) => [t.id, t]));
    return toTagDto(record, typesById);
  }

  /**
   * Proyecta el DTO campo a campo en `CreateTagInput` (B-4: nunca spread
   * del DTO, nunca ausente → `null`). `type_id` viaja tal cual (ya es
   * `number | undefined` en el DTO, sin coerción — a diferencia de
   * `manufacturers`, `tag.entity.ts` no declara `type_id` como `string`).
   * `image` se castea en la frontera (`as unknown as
   * Prisma.InputJsonValue`, nunca `as any` — design.md, DD-1): `Prisma`
   * viaja type-only desde el barrel.
   *
   * `type` se resuelve con un `listTypes()` SECUENCIAL, después de la
   * escritura (design.md, DD-7): nunca `Promise.all` — en paralelo, si la
   * escritura rechaza con un error de dominio y `listTypes()` rechaza por
   * conexión, `Promise.all` propaga el primero que rechace y un 400
   * determinista podría salir como 503.
   */
  async create(createTagDto: CreateTagDto): Promise<Tag> {
    try {
      const record = await createTag({
        name: createTagDto.name,
        ...(createTagDto.slug !== undefined && { slug: createTagDto.slug }),
        ...(createTagDto.details !== undefined && {
          details: createTagDto.details,
        }),
        ...(createTagDto.icon !== undefined && { icon: createTagDto.icon }),
        ...(createTagDto.image !== undefined && {
          image: createTagDto.image as unknown as Prisma.InputJsonValue,
        }),
        ...(createTagDto.type_id !== undefined && {
          typeId: createTagDto.type_id,
        }),
        ...(createTagDto.language !== undefined && {
          language: createTagDto.language,
        }),
      });
      const types = await listTypes();
      return toTagDto(record, new Map(types.map((t) => [t.id, t])));
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /**
   * `+id` llega como `NaN` desde el controlador si `PUT /api/tags/abc`
   * (`tags.controller.ts:43`); sin esta guarda, `BigInt(NaN)` revienta en
   * 500 dentro del repositorio (design.md, DD-10 — precedente exacto
   * `users.service.ts:94,113,142`). El `slug` del DTO se ignora siempre: es
   * inmutable (`UpdateTagInput` ni siquiera lo declara).
   */
  async update(id: number, updateTagDto: UpdateTagDto): Promise<Tag> {
    if (!Number.isInteger(id)) {
      throw new NotFoundException(`No existe un tag con id ${id}.`);
    }

    try {
      const record = await updateTag(id, {
        ...(updateTagDto.name !== undefined && { name: updateTagDto.name }),
        ...(updateTagDto.details !== undefined && {
          details: updateTagDto.details,
        }),
        ...(updateTagDto.icon !== undefined && { icon: updateTagDto.icon }),
        ...(updateTagDto.image !== undefined && {
          image: updateTagDto.image as unknown as Prisma.InputJsonValue,
        }),
        ...(updateTagDto.type_id !== undefined && {
          typeId: updateTagDto.type_id,
        }),
        ...(updateTagDto.language !== undefined && {
          language: updateTagDto.language,
        }),
      });
      const types = await listTypes();
      return toTagDto(record, new Map(types.map((t) => [t.id, t])));
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  async remove(id: number): Promise<Tag> {
    if (!Number.isInteger(id)) {
      throw new NotFoundException(`No existe un tag con id ${id}.`);
    }

    try {
      const record = await deleteTag(id);
      const types = await listTypes();
      return toTagDto(record, new Map(types.map((t) => [t.id, t])));
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }
}
