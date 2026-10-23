import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createOrderStatus,
  deleteOrderStatus,
  findOrderStatusBySlug,
  getUserFriendlyMessage,
  isPrismaConnectionError,
  listOrderStatuses,
  updateOrderStatus,
  type ListOrderStatusesInput,
  type OrderStatusRecord,
  type OrderStatusSortField,
} from '@safari/db';
import { toWriteHttpException } from 'src/common/errors/domain-error.mapper';
import { paginate } from 'src/common/pagination/paginate';
import { parseSearch } from 'src/common/search/parse-search';
import {
  CreateOrderStatusDto,
  UpdateOrderStatusDto,
} from './dto/create-order-status.dto';
import {
  GetOrderStatusesDto,
  OrderStatusPaginator,
} from './dto/get-order-statuses.dto';
import { OrderStatus } from './entities/order-status.entity';

/** Enum `orderBy` del DTO (en mayúsculas o no) → campo del repositorio. */
const SORT_ALIASES: Record<string, OrderStatusSortField> = {
  name: 'name',
  serial: 'serial',
  created_at: 'createdAt',
  updated_at: 'updatedAt',
};

/**
 * `OrderStatusRecord` → las 9 claves del mock de estados, en su orden.
 * `translated_languages` es constante: no hay traducciones.
 */
function toOrderStatusDto(record: OrderStatusRecord): OrderStatus {
  return {
    id: record.id,
    name: record.name,
    slug: record.slug,
    serial: record.serial,
    color: record.color,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    language: record.language,
    translated_languages: ['en'],
  };
}

function readError(error: unknown): never {
  if (isPrismaConnectionError(error)) {
    throw new ServiceUnavailableException(getUserFriendlyMessage(error));
  }
  throw new InternalServerErrorException(getUserFriendlyMessage(error));
}

/** Guarda de id de ruta (US-31): `abc`, `1e21` o `0` ⇒ 404 sin tocar la base. */
function assertId(id: number): void {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new NotFoundException(`No existe un estado de pedido con id ${id}.`);
  }
}

/** `serial` llega como string si el cliente lo manda así (sin `transform`). */
function toSerial(raw: unknown): number | undefined {
  return raw === undefined ? undefined : Number(raw);
}

/**
 * El catálogo de estados, separado de `OrdersService` (US-57): compartirlo
 * hacía que `PUT`/`DELETE /order-status/:id` actuaran sobre órdenes.
 */
@Injectable()
export class OrderStatusesService {
  /**
   * `search=name:<texto>` o texto libre filtra por subcadena (V-4); `slug:`
   * se ignora como en el mock. La url conserva el literal `search=undefined`.
   */
  async findAll({
    limit,
    page,
    search,
    orderBy,
    sortedBy,
  }: GetOrderStatusesDto): Promise<OrderStatusPaginator> {
    if (!page) page = 1;
    if (!limit) limit = 30;
    const url = `/order-status?search=${search}&limit=${limit}`;

    const freeText = search && !search.includes(':') ? search : undefined;
    const sortField = orderBy ? SORT_ALIASES[String(orderBy).toLowerCase()] : undefined;
    const input: ListOrderStatusesInput = {
      name: parseSearch(search).name ?? freeText,
      ...(sortField && {
        orderBy: sortField,
        sortedBy: String(sortedBy).toLowerCase() === 'desc' ? 'desc' : 'asc',
      }),
      page: Number(page) || 1,
      limit: Number(limit) || 30,
    };

    let result: { items: OrderStatusRecord[]; total: number };
    try {
      result = await listOrderStatuses(input);
    } catch (error) {
      readError(error);
    }

    const data = result.items.map(toOrderStatusDto);
    return { data, ...paginate(result.total, page, limit, data.length, url) };
  }

  /** Por slug; `language` se ignora como en el mock. Inexistente ⇒ 404 (V-3). */
  async findOne(slug: string): Promise<OrderStatus> {
    let record: OrderStatusRecord | null;
    try {
      record = await findOrderStatusBySlug(slug);
    } catch (error) {
      readError(error);
    }
    if (!record) {
      throw new NotFoundException(`No existe un estado de pedido con slug \`${slug}\`.`);
    }
    return toOrderStatusDto(record);
  }

  async create(dto: CreateOrderStatusDto): Promise<OrderStatus> {
    try {
      const record = await createOrderStatus({
        name: dto.name,
        color: dto.color,
        serial: toSerial(dto.serial),
        ...(dto.language !== undefined && { language: dto.language }),
      });
      return toOrderStatusDto(record);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /** Si llega `name`, el repositorio regenera el slug (CA-3). */
  async update(id: number, dto: UpdateOrderStatusDto): Promise<OrderStatus> {
    assertId(id);
    try {
      const record = await updateOrderStatus(id, {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.color !== undefined && { color: dto.color }),
        ...(dto.serial !== undefined && { serial: toSerial(dto.serial) }),
        ...(dto.language !== undefined && { language: dto.language }),
      });
      return toOrderStatusDto(record);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /** Devuelve el estado borrado (V-2: el mock devolvía un string de orden). */
  async remove(id: number): Promise<OrderStatus> {
    assertId(id);
    try {
      return toOrderStatusDto(await deleteOrderStatus(id));
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }
}
