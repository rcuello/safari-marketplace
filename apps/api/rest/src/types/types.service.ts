import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createType,
  deleteType,
  findTypeBySlug,
  getUserFriendlyMessage,
  isPrismaConnectionError,
  listTypes,
  updateType,
  type Prisma,
  type TypeRecord,
} from '@safari/db';
import { toWriteHttpException } from 'src/common/errors/domain-error.mapper';
import { CreateTypeDto } from './dto/create-type.dto';
import { UpdateTypeDto } from './dto/update-type.dto';
import { Type } from './entities/type.entity';

import { parseSearch } from 'src/common/search/parse-search';
import { GetTypesDto } from './dto/get-types.dto';

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

  /**
   * Proyecta el DTO campo a campo en `CreateTypeInput` (R-5: nunca spread
   * del body). `settings`/`banners` se castean en la frontera
   * (`as unknown as Prisma.InputJsonValue`, nunca `as any` — design.md,
   * Decisión 5): `TypeSettings`/`Banner[]` son clases sin index signature
   * implícita. El spread condicional evita mandar `undefined` como `null`:
   * el repositorio ya distingue "ausente" (aplica el `DEFAULT` jsonb) de
   * "presente" — mandar la clave con valor `undefined` de todos modos deja
   * que `createType` la vea como ausente, pero se omite aquí también para
   * que el input que le llega al repositorio no incluya claves fantasma.
   */
  async create(createTypeDto: CreateTypeDto): Promise<Type> {
    try {
      const record = await createType({
        name: createTypeDto.name,
        ...(createTypeDto.slug !== undefined && { slug: createTypeDto.slug }),
        ...(createTypeDto.icon !== undefined && { icon: createTypeDto.icon }),
        ...(createTypeDto.settings !== undefined && {
          settings: createTypeDto.settings as unknown as Prisma.InputJsonValue,
        }),
        ...(createTypeDto.banners !== undefined && {
          banners: createTypeDto.banners as unknown as Prisma.InputJsonValue,
        }),
        ...(createTypeDto.language !== undefined && {
          language: createTypeDto.language,
        }),
      });
      return toTypeDto(record);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /**
   * `+id` llega como `NaN` desde el controlador si `PUT /api/types/abc`
   * (`types.controller.ts:43`); sin esta guarda, `BigInt(NaN)` revienta en
   * 500 dentro del repositorio (design.md, Decisión 6 — precedente exacto
   * `users.service.ts:94,113,142`). El slug del DTO se ignora siempre: es
   * inmutable (`UpdateTypeInput` ni siquiera lo declara).
   */
  async update(id: number, updateTypeDto: UpdateTypeDto): Promise<Type> {
    if (!Number.isInteger(id)) {
      throw new NotFoundException(`No existe un type con id ${id}.`);
    }

    try {
      const record = await updateType(id, {
        ...(updateTypeDto.name !== undefined && { name: updateTypeDto.name }),
        ...(updateTypeDto.icon !== undefined && { icon: updateTypeDto.icon }),
        ...(updateTypeDto.settings !== undefined && {
          settings: updateTypeDto.settings as unknown as Prisma.InputJsonValue,
        }),
        ...(updateTypeDto.banners !== undefined && {
          banners: updateTypeDto.banners as unknown as Prisma.InputJsonValue,
        }),
        ...(updateTypeDto.language !== undefined && {
          language: updateTypeDto.language,
        }),
      });
      return toTypeDto(record);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  async remove(id: number): Promise<Type> {
    if (!Number.isInteger(id)) {
      throw new NotFoundException(`No existe un type con id ${id}.`);
    }

    try {
      const record = await deleteType(id);
      return toTypeDto(record);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }
}
