import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createShipping,
  deleteShipping,
  findShippingById,
  getUserFriendlyMessage,
  isPrismaConnectionError,
  listShippings,
  updateShipping,
  type ShippingRecord,
  type UpdateShippingInput,
} from '@safari/db';
import { parseSearch } from '#src/common/search/parse-search.js';
import { toWriteHttpException } from '#src/common/errors/domain-error.mapper.js';
import { CreateShippingDto } from './dto/create-shipping.dto.js';
import { GetShippingsDto } from './dto/get-shippings.dto.js';
import { UpdateShippingDto } from './dto/update-shipping.dto.js';
import { Shipping } from './entities/shipping.entity.js';

/** `ShippingRecord` → las 7 claves de `shippings.json`, en su orden. */
function toShippingDto(record: ShippingRecord): Shipping {
  return {
    id: record.id,
    name: record.name,
    amount: record.amount,
    is_global: record.isGlobal,
    type: record.type,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  } as unknown as Shipping;
}

function toBool(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  return value === true || value === 'true' || value === 1 || value === '1';
}

function toShippingInput(dto: UpdateShippingDto): UpdateShippingInput {
  return {
    ...(dto.name !== undefined && { name: dto.name }),
    ...(dto.amount !== undefined && { amount: Number(dto.amount) }),
    ...(dto.type !== undefined && { type: dto.type }),
    ...(dto.is_global !== undefined && { isGlobal: toBool(dto.is_global) }),
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
    throw new NotFoundException(`No existe una clase de envío con id ${id}.`);
  }
}

@Injectable()
export class ShippingsService {
  /** `type` fuera del CHECK o `amount` no numérico ⇒ 400 desde el repositorio. */
  async create(createShippingDto: CreateShippingDto): Promise<Shipping> {
    try {
      const record = await createShipping({
        ...toShippingInput(createShippingDto),
        name: createShippingDto.name,
        amount: Number(createShippingDto.amount),
        type: createShippingDto.type,
      });
      return toShippingDto(record);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /** ARRAY completo, sin paginar, como el mock; `search=name:X` filtra. */
  async getShippings({ search }: GetShippingsDto = {}): Promise<Shipping[]> {
    const tokens = parseSearch(search);
    try {
      return (await listShippings({ name: tokens.name })).map(toShippingDto);
    } catch (error) {
      readError(error);
    }
  }

  /** Por id; inexistente o id mal formado ⇒ 404 (V-2). */
  async findOne(id: number): Promise<Shipping> {
    assertId(id);
    let record: ShippingRecord | null;
    try {
      record = await findShippingById(id);
    } catch (error) {
      readError(error);
    }
    if (!record) {
      throw new NotFoundException(`No existe una clase de envío con id ${id}.`);
    }
    return toShippingDto(record);
  }

  async update(
    id: number,
    updateShippingDto: UpdateShippingDto,
  ): Promise<Shipping> {
    assertId(id);
    try {
      return toShippingDto(
        await updateShipping(id, toShippingInput(updateShippingDto)),
      );
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  async remove(id: number): Promise<Shipping> {
    assertId(id);
    try {
      return toShippingDto(await deleteShipping(id));
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }
}
