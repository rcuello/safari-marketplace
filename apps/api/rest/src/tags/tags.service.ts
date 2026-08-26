import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { paginate } from 'src/common/pagination/paginate';
import {
  findTagBySlug,
  getUserFriendlyMessage,
  isPrismaConnectionError,
  listTags,
  listTypes,
  type ListTagsInput,
  type TagRecord,
  type TypeRecord,
} from '@safari/db';
import { CreateTagDto } from './dto/create-tag.dto';
import { GetTagsDto, TagPaginator } from './dto/get-tags.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
import { Tag } from './entities/tag.entity';
import tagsJson from '@db/tags.json';
import { plainToClass } from 'class-transformer';
import Fuse from 'fuse.js';
import { parseSearch } from 'src/common/search/parse-search';

const tags = plainToClass(Tag, tagsJson);

const options = {
  keys: ['name'],
  threshold: 0.3,
};
const fuse = new Fuse(tags, options);

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
  private tags: Tag[] = tags;

  create(createTagDto: CreateTagDto) {
    return {
      id: this.tags.length + 1,
      ...createTagDto,
    };
  }

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

  update(id: number, updateTagDto: UpdateTagDto) {
    return this.tags[0];
  }

  remove(id: number) {
    return `This action removes a #${id} tag`;
  }
}
