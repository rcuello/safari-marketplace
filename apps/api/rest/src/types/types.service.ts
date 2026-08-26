import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { plainToClass } from 'class-transformer';
import {
  findTypeBySlug,
  getUserFriendlyMessage,
  isPrismaConnectionError,
  listTypes,
  type TypeRecord,
} from '@safari/db';
import { CreateTypeDto } from './dto/create-type.dto';
import { UpdateTypeDto } from './dto/update-type.dto';
import { Type } from './entities/type.entity';

import typesJson from '@db/types.json';
import Fuse from 'fuse.js';
import { parseSearch } from 'src/common/search/parse-search';
import { GetTypesDto } from './dto/get-types.dto';

const types = plainToClass(Type, typesJson);
const options = {
  keys: ['name'],
  threshold: 0.3,
};
const fuse = new Fuse(types, options);

/**
 * `TypeRecord` (camelCase, `@safari/db`) → proyección de 9 claves
 * snake_case que ya publicaba `types.json`. `promotional_sliders` y
 * `translated_languages` son constantes: no hay columna que los respalde
 * (V-8/V-9, documentadas en design.md). Se castea a `Type`, igual que
 * `toProductDto` (`products.service.ts:167`) — la entidad declara campos
 * que este listado no emite (`image`).
 */
function toTypeDto(record: TypeRecord): Type {
  return {
    id: record.id,
    name: record.name,
    language: record.language,
    translated_languages: ['en'],
    slug: record.slug,
    banners: record.banners,
    promotional_sliders: null,
    settings: record.settings,
    icon: record.icon,
  } as unknown as Type;
}

@Injectable()
export class TypesService {
  private types: Type[] = types;

  async getTypes({ search }: GetTypesDto): Promise<Type[]> {
    const { name } = parseSearch(search);

    try {
      const rows = await listTypes({ name });
      return rows.map(toTypeDto);
    } catch (error) {
      if (isPrismaConnectionError(error)) {
        throw new ServiceUnavailableException(getUserFriendlyMessage(error));
      }
      throw new InternalServerErrorException(getUserFriendlyMessage(error));
    }
  }

  async getTypeBySlug(slug: string): Promise<Type> {
    let record: TypeRecord | null;

    // El try envuelve SOLO la llamada de I/O. El 404 queda fuera a
    // propósito: dentro, este catch lo convertiría en un 500.
    try {
      record = await findTypeBySlug(slug);
    } catch (error) {
      if (isPrismaConnectionError(error)) {
        throw new ServiceUnavailableException(getUserFriendlyMessage(error));
      }
      throw new InternalServerErrorException(getUserFriendlyMessage(error));
    }

    if (!record) {
      throw new NotFoundException(`No existe un type con slug \`${slug}\`.`);
    }

    return toTypeDto(record);
  }

  create(createTypeDto: CreateTypeDto) {
    return this.types[0];
  }

  findAll() {
    return `This action returns all types`;
  }

  findOne(id: number) {
    return `This action returns a #${id} type`;
  }

  update(id: number, updateTypeDto: UpdateTypeDto) {
    return this.types[0];
  }

  remove(id: number) {
    return `This action removes a #${id} type`;
  }
}
