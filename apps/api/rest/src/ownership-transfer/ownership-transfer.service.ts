import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createOwnershipTransfer,
  deleteOwnershipTransfer,
  findOwnershipTransferByIdentifier,
  getUserFriendlyMessage,
  isPrismaConnectionError,
  listOwnershipTransfers,
  transferShopOwnership,
  updateOwnershipTransfer,
  type OwnershipTransferDetailRecord,
  type OwnershipTransferOwnerRecord,
} from '@safari/db';
import { CurrentUserPayload } from 'src/auth/decorators/current-user.decorator';
import { toWriteHttpException } from 'src/common/errors/domain-error.mapper';
import { paginate } from 'src/common/pagination/paginate';
import { parseSearch } from 'src/common/search/parse-search';
import { toShopDto } from 'src/shops/shops.service';
import { Shop } from 'src/shops/entities/shop.entity';
import { toProfileDto } from 'src/users/user-dto.mapper';
import { CreateOwnershipTransferDto } from './dto/create-ownership-transfer.dto';
import { GetOwnershipTransferDto, RefundPolicyPaginator } from './dto/get-ownership-transfer.dto';
import { TransferShopOwnershipDto } from './dto/transfer-shop-ownership.dto';
import { UpdateOwnershipTransferDto } from './dto/update-ownership-transfer.dto';
import { OwnershipTransfer } from './entities/ownership-transfer.entity';

/** Las 10 claves de los owners de `ownership-transfer.json`, en su orden. */
function toOwnerDto(u: OwnershipTransferOwnerRecord): Record<string, unknown> {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    email_verified_at: u.emailVerifiedAt,
    created_at: u.createdAt,
    updated_at: u.updatedAt,
    is_active: Number(u.isActive),
    shop_id: null,
    email_verified: u.emailVerifiedAt !== null,
    profile: u.profile ? toProfileDto(u.profile) : null,
  };
}

/**
 * Las 11 claves de `ownership-transfer.json`, en su orden. Sin
 * `created_at`/`updated_at` ni `shop`: el mock no los trae (D-3).
 * `balance_info` sale tal cual de la columna `json`.
 */
function toTransferDto(t: OwnershipTransferDetailRecord): OwnershipTransfer {
  return {
    id: t.id,
    transaction_identifier: t.transactionIdentifier,
    previous_owner: toOwnerDto(t.previousOwner),
    current_owner: toOwnerDto(t.currentOwner),
    message: t.message,
    created_by: t.createdById,
    status: t.status,
    order_info: t.orderInfo,
    balance_info: t.balanceInfo,
    refund_info: t.refundInfo,
    withdrawal_info: t.withdrawalInfo,
  } as unknown as OwnershipTransfer;
}

function readError(error: unknown): never {
  if (isPrismaConnectionError(error)) {
    throw new ServiceUnavailableException(getUserFriendlyMessage(error));
  }
  throw new InternalServerErrorException(getUserFriendlyMessage(error));
}

const isAdmin = (user: CurrentUserPayload): boolean => user.permissions.includes('super_admin');

/** Un id de ruta que no es entero positivo no existe: 404 sin tocar la base. */
function toRouteId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new NotFoundException(`No existe una transferencia con id ${String(value)}.`);
  }
  return id;
}

/** `shop_id`/`vendor_id` de query o body: inválido ⇒ 400 (US-31). */
function toBodyId(field: string, value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new BadRequestException(`\`${String(value)}\` no es un ${field}.`);
  }
  return id;
}

@Injectable()
export class OwnershipTransferService {
  /**
   * Lista (US-63). El super admin ve todo; el dueño, solo las filas donde es
   * el dueño anterior o el nuevo. La url apunta a este recurso (V-7: el mock
   * tenía la de refund-policies); `paginate()` recibe el `limit` crudo.
   */
  async findAll(
    { search, limit, page, shop_id }: GetOwnershipTransferDto,
    user: CurrentUserPayload,
  ): Promise<RefundPolicyPaginator> {
    if (!page) page = 1;
    if (!limit) limit = 10;
    const { transaction_identifier } = parseSearch(search);
    const size = Number(limit);
    const input = {
      ...(transaction_identifier !== undefined && { transactionIdentifier: transaction_identifier }),
      ...(shop_id !== undefined && { shopId: toBodyId('shop_id', shop_id) }),
      ...(!isAdmin(user) && { participantId: user.sub }),
      page: Number(page) || 1,
      limit: Number.isSafeInteger(size) && size > 0 ? size : 10,
    };

    let result: { items: OwnershipTransferDetailRecord[]; total: number };
    try {
      result = await listOwnershipTransfers(input);
    } catch (error) {
      readError(error);
    }
    const data = result.items.map(toTransferDto);
    const url = `/ownership-transfer?search=${search}&limit=${limit}`;
    return { data, ...paginate(result.total, page, limit, data.length, url) };
  }

  /** Por `transaction_identifier`, como lo pide el admin. Inexistente o ajeno para el dueño ⇒ 404. */
  async getOwnershipTransfer(identifier: string, user: CurrentUserPayload): Promise<OwnershipTransfer> {
    let record: OwnershipTransferDetailRecord | null;
    try {
      record = await findOwnershipTransferByIdentifier(identifier);
    } catch (error) {
      readError(error);
    }
    const visible =
      record && (isAdmin(user) || record.previousOwnerId === user.sub || record.currentOwnerId === user.sub);
    if (!visible) {
      throw new NotFoundException(`No existe una transferencia ${identifier}.`);
    }
    return toTransferDto(record);
  }

  /** Solicitud `pending` (solo super admin, lo exige el guard). No toca la tienda. */
  async create(dto: CreateOwnershipTransferDto, user: CurrentUserPayload): Promise<OwnershipTransfer> {
    const input = {
      shopId: toBodyId('shop_id', dto.shop_id),
      currentOwnerId: toBodyId('vendor_id', dto.vendor_id),
      createdById: user.sub,
      message: dto.message ?? null,
    };
    try {
      return toTransferDto(await createOwnershipTransfer(input));
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /** Cambia `status`/`message` (solo super admin). Status fuera del CHECK ⇒ 400; inexistente ⇒ 404. */
  async update(id: unknown, dto: UpdateOwnershipTransferDto): Promise<OwnershipTransfer> {
    const transferId = toRouteId(id);
    try {
      return toTransferDto(
        await updateOwnershipTransfer(transferId, {
          ...(dto.status !== undefined && { status: String(dto.status) }),
          ...(dto.message !== undefined && { message: dto.message }),
        }),
      );
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  async remove(id: unknown): Promise<OwnershipTransfer> {
    const transferId = toRouteId(id);
    try {
      return toTransferDto(await deleteOwnershipTransfer(transferId));
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /**
   * Pasa la tienda al vendedor y registra la transferencia `approved`, en una
   * transacción. Devuelve la tienda con `owner` = el dueño nuevo, que es lo
   * que lee el toast del admin.
   */
  async transferShopOwnership(dto: TransferShopOwnershipDto, user: CurrentUserPayload): Promise<Shop> {
    const input = {
      shopId: toBodyId('shop_id', dto.shop_id),
      vendorId: toBodyId('vendor_id', dto.vendor_id),
      createdById: user.sub,
      message: dto.message ?? null,
    };
    try {
      const { shop, owner } = await transferShopOwnership(input);
      return {
        ...toShopDto(shop),
        owner: { id: owner.id, name: owner.name, email: owner.email },
      } as unknown as Shop;
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }
}
