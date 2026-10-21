import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createTax,
  deleteTax,
  findTaxById,
  getUserFriendlyMessage,
  isPrismaConnectionError,
  listTaxes,
  updateTax,
  type TaxRecord,
  type UpdateTaxInput,
} from '@safari/db';
import { parseSearch } from 'src/common/search/parse-search';
import { toWriteHttpException } from 'src/common/errors/domain-error.mapper';
import { CreateTaxDto } from './dto/create-tax.dto';
import { GetTaxesDto } from './dto/get-taxes.dto';
import { UpdateTaxDto } from './dto/update-tax.dto';
import { Tax } from './entities/tax.entity';

/**
 * `TaxRecord` → las 12 claves de `taxes.json` en SU orden, que no es el de
 * la entidad: la geografía va antes que `rate` y `name` (US-49, CA-3). Se
 * escribe a mano a propósito; derivarlo del record rompería los bytes.
 */
function toTaxDto(record: TaxRecord): Tax {
  return {
    id: record.id,
    country: record.country,
    state: record.state,
    zip: record.zip,
    city: record.city,
    rate: record.rate,
    name: record.name,
    is_global: record.isGlobal,
    priority: record.priority,
    on_shipping: record.onShipping,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  } as unknown as Tax;
}

/** Sin `transform` en el `ValidationPipe`, un form-data podría traer `'true'`. */
function toBool(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  return value === true || value === 'true' || value === 1 || value === '1';
}

function toNullableNumber(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  return value === null || value === '' ? null : Number(value);
}

/** Proyecta el DTO campo a campo (nunca spread): ausente ⇒ no se toca. */
function toTaxInput(dto: UpdateTaxDto): UpdateTaxInput {
  const priority = toNullableNumber(dto.priority);
  return {
    ...(dto.name !== undefined && { name: dto.name }),
    ...(dto.rate !== undefined && { rate: Number(dto.rate) }),
    ...(dto.is_global !== undefined && { isGlobal: toBool(dto.is_global) }),
    ...(dto.country !== undefined && { country: dto.country }),
    ...(dto.state !== undefined && { state: dto.state }),
    ...(dto.zip !== undefined && { zip: dto.zip }),
    ...(dto.city !== undefined && { city: dto.city }),
    ...(priority !== undefined && { priority }),
    ...(dto.on_shipping !== undefined && { onShipping: toBool(dto.on_shipping) }),
  };
}

function readError(error: unknown): never {
  if (isPrismaConnectionError(error)) {
    throw new ServiceUnavailableException(getUserFriendlyMessage(error));
  }
  throw new InternalServerErrorException(getUserFriendlyMessage(error));
}

function assertId(id: number): void {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new NotFoundException(`No existe una clase de impuesto con id ${id}.`);
  }
}

@Injectable()
export class TaxesService {
  /**
   * `rate` ausente o no numérico llega como `NaN` y el repositorio lo rechaza
   * con 400 (`InvalidFieldValueError`) antes de tocar Postgres.
   */
  async create(createTaxDto: CreateTaxDto): Promise<Tax> {
    try {
      const input = toTaxInput(createTaxDto);
      const record = await createTax({
        ...input,
        name: createTaxDto.name,
        rate: Number(createTaxDto.rate),
      });
      return toTaxDto(record);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /**
   * ARRAY completo, sin paginar, como el mock: el admin de `/settings` pide
   * `limit=999` y espera un array. `search=name:X` (página `/taxes` del
   * admin) filtra de verdad (V-1); antes se ignoraba.
   */
  async findAll({ search }: GetTaxesDto = {}): Promise<Tax[]> {
    const tokens = parseSearch(search);
    try {
      return (await listTaxes({ name: tokens.name })).map(toTaxDto);
    } catch (error) {
      readError(error);
    }
  }

  /** Por id; inexistente o id mal formado ⇒ 404 (V-2). */
  async findOne(id: number): Promise<Tax> {
    assertId(id);
    let record: TaxRecord | null;
    try {
      record = await findTaxById(id);
    } catch (error) {
      readError(error);
    }
    if (!record) {
      throw new NotFoundException(`No existe una clase de impuesto con id ${id}.`);
    }
    return toTaxDto(record);
  }

  async update(id: number, updateTaxDto: UpdateTaxDto): Promise<Tax> {
    assertId(id);
    try {
      return toTaxDto(await updateTax(id, toTaxInput(updateTaxDto)));
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /** Devuelve la clase borrada (V-3: el mock devolvía un string). */
  async remove(id: number): Promise<Tax> {
    assertId(id);
    try {
      return toTaxDto(await deleteTax(id));
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }
}
