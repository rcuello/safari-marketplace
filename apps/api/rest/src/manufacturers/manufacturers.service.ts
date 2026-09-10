import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Manufacturer } from './entities/manufacturer.entity';
import {
  createManufacturer,
  deleteManufacturer,
  findManufacturerBySlug,
  getUserFriendlyMessage,
  isPrismaConnectionError,
  listManufacturers,
  listTypes,
  updateManufacturer,
  type ListManufacturersInput,
  type ManufacturerRecord,
  type Prisma,
  type TypeRecord,
} from '@safari/db';
import { toWriteHttpException } from '../common/errors/domain-error.mapper';
import { GetTopManufacturersDto } from './dto/get-top-manufacturers.dto';
import {
  GetManufacturersDto,
  ManufacturerPaginator,
} from './dto/get-manufactures.dto';
import { paginate } from '../common/pagination/paginate';
import { CreateManufacturerDto } from './dto/create-manufacturer.dto';
import { UpdateManufacturerDto } from './dto/update-manufacturer.dto';
import { parseSearch } from '../common/search/parse-search';

/**
 * `ManufacturerRecord` (camelCase, `@safari/db`) → proyección de 13 claves
 * snake_case que ya publicaba `manufacturers.json`. `products_count`,
 * `socials`, `cover_image` y `language` son constantes: no hay columna que
 * los respalde (V-1/V-2/V-3/V-10). `type` es el `TypeRecord` resuelto en
 * memoria (Decisión F, design.md). Se castea a `Manufacturer`, igual que
 * `toProductDto` — la entidad declara campos que este listado no emite.
 */
function toManufacturerDto(
  record: ManufacturerRecord,
  typesById: Map<number, TypeRecord>
): Manufacturer {
  const type = record.typeId !== null ? typesById.get(record.typeId) : undefined;
  return {
    id: record.id,
    name: record.name,
    slug: record.slug,
    language: 'en',
    translated_languages: ['en'],
    products_count: 0,
    is_approved: Number(record.isApproved),
    description: record.description,
    website: record.website,
    socials: [],
    image: record.image,
    cover_image: null,
    type: type
      ? { id: type.id, name: type.name, slug: type.slug, logo: null }
      : null,
  } as unknown as Manufacturer;
}

@Injectable()
export class ManufacturersService {
  async getManufactures({
    limit,
    page,
    search,
  }: GetManufacturersDto): Promise<ManufacturerPaginator> {
    if (!page) page = 1;
    if (!limit) limit = 30;

    const tokens = parseSearch(search);
    const input: ListManufacturersInput = {
      name: tokens.name,
      typeSlug: tokens['type.slug'],
      page: Number(page) || 1,
      limit: Number(limit) || 30,
    };

    let result: { items: ManufacturerRecord[]; total: number };
    let types: TypeRecord[];
    try {
      [result, types] = await Promise.all([
        listManufacturers(input),
        listTypes(),
      ]);
    } catch (error) {
      if (isPrismaConnectionError(error)) {
        throw new ServiceUnavailableException(getUserFriendlyMessage(error));
      }
      throw new InternalServerErrorException(getUserFriendlyMessage(error));
    }

    const typesById = new Map(types.map((t) => [t.id, t]));
    const data = result.items.map((r) => toManufacturerDto(r, typesById));
    const url = `/manufacturers?search=${search}&limit=${limit}`;
    return {
      data,
      ...paginate(result.total, page, limit, data.length, url),
    };
  }

  /** V-20: ignora `search` a propósito, igual que el mock (solo usa `limit`). */
  async getTopManufactures({
    limit,
  }: GetTopManufacturersDto): Promise<Manufacturer[]> {
    // `ValidationPipe` no transforma: `limit` llega string. `slice(0, limit)`
    // del mock lo coercía en silencio; Prisma exige un `number` real en
    // `take` — mismo criterio que `parseFiniteNumber` en products.service.ts.
    const take = Number(limit) || 10;

    let result: { items: ManufacturerRecord[]; total: number };
    let types: TypeRecord[];
    try {
      [result, types] = await Promise.all([
        listManufacturers({ limit: take }),
        listTypes(),
      ]);
    } catch (error) {
      if (isPrismaConnectionError(error)) {
        throw new ServiceUnavailableException(getUserFriendlyMessage(error));
      }
      throw new InternalServerErrorException(getUserFriendlyMessage(error));
    }

    const typesById = new Map(types.map((t) => [t.id, t]));
    return result.items.map((r) => toManufacturerDto(r, typesById));
  }

  async getManufacturesBySlug(slug: string): Promise<Manufacturer> {
    let record: ManufacturerRecord | null;

    let types: TypeRecord[];

    // El try envuelve SOLO las llamadas de I/O. El 404 queda fuera a
    // propósito: dentro, este catch lo convertiría en un 500.
    try {
      record = await findManufacturerBySlug(slug);
      types = await listTypes();
    } catch (error) {
      if (isPrismaConnectionError(error)) {
        throw new ServiceUnavailableException(getUserFriendlyMessage(error));
      }
      throw new InternalServerErrorException(getUserFriendlyMessage(error));
    }

    if (!record) {
      throw new NotFoundException(`No existe una marca con slug \`${slug}\`.`);
    }

    const typesById = new Map(types.map((t) => [t.id, t]));
    return toManufacturerDto(record, typesById);
  }

  /**
   * Proyecta el DTO campo a campo en `CreateManufacturerInput` (B-4:
   * nunca spread del DTO, nunca ausente → `null`). `is_approved` se
   * coerciona a `Boolean(...)` (DD-6) — el repositorio solo conoce
   * `boolean`; `undefined` NO se coerciona a `false`: se omite y la
   * columna aplica `DEFAULT true`. `type_id` se coerciona a `Number(...)`
   * (DD-2) porque `Manufacturer.type_id` está declarado `?: string` en la
   * entidad (`manufacturer.entity.ts:16`, inconsistencia preexistente,
   * V-10, no corregida aquí). `image` se castea en la frontera (`as
   * unknown as Prisma.InputJsonValue`, nunca `as any`). `socials`,
   * `cover_image`, `language` y `shop_id` NUNCA se proyectan (V-1/V-2/V-3
   * — sin columna).
   *
   * `type` se resuelve con un `listTypes()` SECUENCIAL, después de la
   * escritura (design.md, DD-7): nunca `Promise.all`.
   */
  async create(createManufactureDto: CreateManufacturerDto): Promise<Manufacturer> {
    try {
      const record = await createManufacturer({
        name: createManufactureDto.name,
        ...(createManufactureDto.slug !== undefined && {
          slug: createManufactureDto.slug,
        }),
        ...(createManufactureDto.description !== undefined && {
          description: createManufactureDto.description,
        }),
        ...(createManufactureDto.website !== undefined && {
          website: createManufactureDto.website,
        }),
        ...(createManufactureDto.image !== undefined && {
          image: createManufactureDto.image as unknown as Prisma.InputJsonValue,
        }),
        ...(createManufactureDto.type_id !== undefined && {
          typeId:
            createManufactureDto.type_id === null
              ? null
              : Number(createManufactureDto.type_id),
        }),
        ...(createManufactureDto.is_approved !== undefined && {
          isApproved: Boolean(createManufactureDto.is_approved),
        }),
      });
      const types = await listTypes();
      return toManufacturerDto(record, new Map(types.map((t) => [t.id, t])));
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /**
   * `+id` llega como `NaN` desde el controlador si `PUT /api/manufacturers/abc`
   * (`manufacturers.controller.ts:58`); sin esta guarda, `BigInt(NaN)`
   * revienta en 500 dentro del repositorio (design.md, DD-10). El `slug`
   * del DTO se ignora siempre: es inmutable (`UpdateManufacturerInput` ni
   * siquiera lo declara).
   */
  async update(
    id: number,
    updateManufacturesDto: UpdateManufacturerDto
  ): Promise<Manufacturer> {
    if (!Number.isInteger(id)) {
      throw new NotFoundException(`No existe una marca con id ${id}.`);
    }

    try {
      const record = await updateManufacturer(id, {
        ...(updateManufacturesDto.name !== undefined && {
          name: updateManufacturesDto.name,
        }),
        ...(updateManufacturesDto.description !== undefined && {
          description: updateManufacturesDto.description,
        }),
        ...(updateManufacturesDto.website !== undefined && {
          website: updateManufacturesDto.website,
        }),
        ...(updateManufacturesDto.image !== undefined && {
          image: updateManufacturesDto.image as unknown as Prisma.InputJsonValue,
        }),
        ...(updateManufacturesDto.type_id !== undefined && {
          typeId:
            updateManufacturesDto.type_id === null
              ? null
              : Number(updateManufacturesDto.type_id),
        }),
        ...(updateManufacturesDto.is_approved !== undefined && {
          isApproved: Boolean(updateManufacturesDto.is_approved),
        }),
      });
      const types = await listTypes();
      return toManufacturerDto(record, new Map(types.map((t) => [t.id, t])));
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  async remove(id: number): Promise<Manufacturer> {
    if (!Number.isInteger(id)) {
      throw new NotFoundException(`No existe una marca con id ${id}.`);
    }

    try {
      const record = await deleteManufacturer(id);
      const types = await listTypes();
      return toManufacturerDto(record, new Map(types.map((t) => [t.id, t])));
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }
}
