import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Manufacturer } from './entities/manufacturer.entity';
import manufacturersJson from '@db/manufacturers.json';
import { plainToClass } from 'class-transformer';
import Fuse from 'fuse.js';
import {
  findManufacturerBySlug,
  getUserFriendlyMessage,
  isPrismaConnectionError,
  listManufacturers,
  listTypes,
  type ListManufacturersInput,
  type ManufacturerRecord,
  type TypeRecord,
} from '@safari/db';
import { GetTopManufacturersDto } from './dto/get-top-manufacturers.dto';
import {
  GetManufacturersDto,
  ManufacturerPaginator,
} from './dto/get-manufactures.dto';
import { paginate } from '../common/pagination/paginate';
import { CreateManufacturerDto } from './dto/create-manufacturer.dto';
import { UpdateManufacturerDto } from './dto/update-manufacturer.dto';
import { parseSearch } from '../common/search/parse-search';

const manufacturers = plainToClass(Manufacturer, manufacturersJson);

const options = {
  keys: ['name'],
  threshold: 0.3,
};

const fuse = new Fuse(manufacturers, options);

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
  private manufacturers: Manufacturer[] = manufacturers;

  create(createManufactureDto: CreateManufacturerDto) {
    return this.manufacturers[0];
  }

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

  update(id: number, updateManufacturesDto: UpdateManufacturerDto) {
    const manufacturer = this.manufacturers.find((p) => p.id === Number(id));

    // Update author
    manufacturer.is_approved = updateManufacturesDto.is_approved ?? true;

    return manufacturer;
  }

  remove(id: number) {
    return `This action removes a #${id} product`;
  }
}
