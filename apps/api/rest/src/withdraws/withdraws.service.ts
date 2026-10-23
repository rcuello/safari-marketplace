import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createWithdraw,
  deleteWithdraw,
  findShopOwnerById,
  findWithdrawById,
  getUserFriendlyMessage,
  isPrismaConnectionError,
  listWithdraws,
  updateWithdrawStatus,
  type WithdrawDetailRecord,
} from '@safari/db';
import { CurrentUserPayload } from 'src/auth/decorators/current-user.decorator';
import { toWriteHttpException } from 'src/common/errors/domain-error.mapper';
import { paginate } from 'src/common/pagination/paginate';
import { parseSearch } from 'src/common/search/parse-search';
import { toShopDto } from 'src/shops/shops.service';
import { CreateWithdrawDto } from './dto/create-withdraw.dto';
import { ApproveWithdrawDto } from './dto/approve-withdraw.dto';
import { GetWithdrawsDto, WithdrawPaginator } from './dto/get-withdraw.dto';
import { Withdraw } from './entities/withdraw.entity';

/** Las 13 primeras claves de `toShopDto`: el snapshot `shop` de `withdraws.json`. */
const SHOP_SNAPSHOT_KEYS = [
  'id', 'owner_id', 'name', 'slug', 'description', 'cover_image', 'logo',
  'is_active', 'address', 'settings', 'notifications', 'created_at', 'updated_at',
];

/**
 * `WithdrawDetailRecord` → las 11 claves de `withdraws.json`, en su orden.
 * `deleted_at` es constante: se borra de verdad (D-6).
 */
function toWithdrawDto(record: WithdrawDetailRecord): Withdraw {
  const shop = toShopDto(record.shop) as unknown as Record<string, unknown>;
  return {
    id: record.id,
    shop_id: record.shopId,
    amount: record.amount,
    payment_method: record.paymentMethod,
    status: record.status,
    details: record.details,
    note: record.note,
    deleted_at: null,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    shop: Object.fromEntries(SHOP_SNAPSHOT_KEYS.map((key) => [key, shop[key]])),
  } as unknown as Withdraw;
}

function readError(error: unknown): never {
  if (isPrismaConnectionError(error)) {
    throw new ServiceUnavailableException(getUserFriendlyMessage(error));
  }
  throw new InternalServerErrorException(getUserFriendlyMessage(error));
}

const isAdmin = (user: CurrentUserPayload): boolean => user.permissions.includes('super_admin');

/** Un id de ruta o de body que no es entero positivo no existe: 404 sin tocar la base. */
function toId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new NotFoundException(`No existe un retiro con id ${String(value)}.`);
  }
  return id;
}

/** `shop_id` llega como string (sin `transform`): inválido ⇒ 400, no lista vacía (US-31). */
function toShopId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new BadRequestException(`\`${String(value)}\` no es un shop_id.`);
  }
  return id;
}

@Injectable()
export class WithdrawsService {
  /**
   * Retiros de una tienda (US-62). El super admin ve todo; el dueño, solo
   * los de sus tiendas, así que un `shop_id` ajeno le da `data: []`. El
   * `shop_id` de la query gana al de `search`. La url y `paginate()`
   * conservan el `limit` crudo del mock.
   */
  async getWithdraws(
    { limit, page, status, shop_id, search }: GetWithdrawsDto,
    user: CurrentUserPayload,
  ): Promise<WithdrawPaginator> {
    if (!page) page = 1;
    const rawShopId = shop_id ?? parseSearch(search).shop_id;
    const size = Number(limit);
    const input = {
      ...(rawShopId !== undefined && { shopId: toShopId(rawShopId) }),
      ...(!isAdmin(user) && { ownerId: user.sub }),
      ...(status && { status }),
      page: Number(page) || 1,
      limit: Number.isSafeInteger(size) && size > 0 ? size : 10,
    };

    let result: { items: WithdrawDetailRecord[]; total: number };
    try {
      result = await listWithdraws(input);
    } catch (error) {
      readError(error);
    }
    const data = result.items.map(toWithdrawDto);
    const url = `/withdraws?limit=${limit}`;
    return { data, ...paginate(result.total, page, limit, data.length, url) };
  }

  /** Inexistente, o de una tienda ajena para el dueño ⇒ 404. */
  async findOne(id: number, user: CurrentUserPayload): Promise<Withdraw> {
    const record = await this.findVisible(toId(id), user);
    return toWithdrawDto(record);
  }

  /** Nace `pending`. El dueño solo pide para una tienda suya (403). */
  async create(dto: CreateWithdrawDto, user: CurrentUserPayload): Promise<Withdraw> {
    const shopId = toShopId(dto.shop_id);
    if (!dto.payment_method) {
      throw new BadRequestException('payment_method es obligatorio.');
    }
    await this.assertOwnsShop(shopId, user);
    try {
      return toWithdrawDto(
        await createWithdraw({
          shopId,
          amount: Number(dto.amount),
          paymentMethod: String(dto.payment_method),
          details: dto.details ?? null,
          note: dto.note ?? null,
        }),
      );
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /** Solo super admin (el guard lo exige). Status fuera del CHECK ⇒ 400; inexistente ⇒ 404. */
  async approve(id: unknown, dto: ApproveWithdrawDto): Promise<Withdraw> {
    const withdrawId = toId(id);
    try {
      return toWithdrawDto(await updateWithdrawStatus(withdrawId, String(dto.status)));
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /**
   * El dueño solo borra retiros `pending` de sus tiendas: ajeno o en otro
   * estado ⇒ 403 (la US lo pide así, aunque `GET /:id` oculte el ajeno con
   * 404). El super admin, cualquiera. Inexistente ⇒ 404.
   */
  async remove(id: number, user: CurrentUserPayload): Promise<Withdraw> {
    const withdrawId = toId(id);
    if (!isAdmin(user)) {
      let record: WithdrawDetailRecord | null;
      try {
        record = await findWithdrawById(withdrawId);
      } catch (error) {
        readError(error);
      }
      if (!record) {
        throw new NotFoundException(`No existe un retiro con id ${withdrawId}.`);
      }
      if (record.shop.ownerId !== user.sub) {
        throw new ForbiddenException(`No tienes permisos sobre la tienda ${record.shopId}.`);
      }
      if (record.status !== 'pending') {
        throw new ForbiddenException(`Solo puedes borrar retiros pending; el ${withdrawId} está ${record.status}.`);
      }
    }
    try {
      return toWithdrawDto(await deleteWithdraw(withdrawId));
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  private async findVisible(id: number, user: CurrentUserPayload): Promise<WithdrawDetailRecord> {
    let record: WithdrawDetailRecord | null;
    try {
      record = await findWithdrawById(id);
    } catch (error) {
      readError(error);
    }
    if (!record || (!isAdmin(user) && record.shop.ownerId !== user.sub)) {
      throw new NotFoundException(`No existe un retiro con id ${id}.`);
    }
    return record;
  }

  /**
   * Propiedad por tienda (precedente `coupons.service.ts`): el super admin
   * pasa sin consultar. Una tienda inexistente no es 403: se deja pasar para
   * que el repositorio dé el 400.
   */
  private async assertOwnsShop(shopId: number, user: CurrentUserPayload): Promise<void> {
    if (isAdmin(user)) return;
    let ownerId: number | null;
    try {
      ownerId = await findShopOwnerById(shopId);
    } catch (error) {
      readError(error);
    }
    if (ownerId !== null && ownerId !== user.sub) {
      throw new ForbiddenException(`No tienes permisos sobre la tienda ${shopId}.`);
    }
  }
}
