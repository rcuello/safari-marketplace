import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  STORE_NOTICE_SORTABLE,
  createStoreNotice,
  deleteStoreNotice,
  findStoreNoticeById,
  getUserFriendlyMessage,
  isPrismaConnectionError,
  listStoreNotices,
  markStoreNoticeRead,
  updateStoreNotice,
  type ListStoreNoticesInput,
  type StoreNoticeDetailRecord,
  type StoreNoticeSortField,
  type UpdateStoreNoticeInput,
  type UserRecord,
} from '@safari/db';
import { paginate } from 'src/common/pagination/paginate';
import { parseSearch } from 'src/common/search/parse-search';
import { toWriteHttpException } from 'src/common/errors/domain-error.mapper';
import { toShopDto } from 'src/shops/shops.service';
import { CreateStoreNoticeDto } from './dto/create-store-notice.dto';
import {
  GetStoreNoticesDto,
  StoreNoticePaginator,
} from './dto/get-store-notices.dto';
import { UpdateStoreNoticeDto } from './dto/update-store-notice.dto';
import { StoreNotice } from './entities/store-notices.entity';

/** Literal del contrato heredado de Laravel (`creator.permissions[].pivot`). */
const USER_MODEL_TYPE = 'Marvel\\Database\\Models\\User';

/**
 * Rol que se muestra del creador: su permiso más alto. El mock solo prueba
 * `"Super admin"`. Los textos de los otros tres los propuso US-51 y el dueño
 * los confirmó el 2026-10-22: no son un hueco por rellenar.
 */
const ROLE_LABELS: [string, string][] = [
  ['super_admin', 'Super admin'],
  ['store_owner', 'Store owner'],
  ['staff', 'Staff'],
  ['customer', 'Customer'],
];

/** `?orderBy=` del admin (`updated_at`, o el enum en mayúsculas) → campo del repositorio. */
const SORT_ALIASES: Record<string, StoreNoticeSortField> = {
  updated_at: 'updatedAt',
  created_at: 'createdAt',
  notice: 'notice',
  priority: 'priority',
  type: 'type',
  expired_at: 'expiredAt',
  expire_at: 'expiredAt',
};

/**
 * `effective_from`/`expired_at` salen como el mock: `YYYY-MM-DD HH:mm:ss`, sin
 * `T` ni zona. La base corre en UTC y el seed los sembró como literales UTC.
 */
function formatNoticeDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 19).replace('T', ' ') : null;
}

/** Usuario embebido con las claves del mock: `is_active` entero y `shop_id` null. */
function toEmbeddedUser(user: UserRecord) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    email_verified_at: user.emailVerifiedAt,
    created_at: user.createdAt,
    updated_at: user.updatedAt,
    is_active: Number(user.isActive),
    shop_id: null,
  };
}

/**
 * `StoreNoticeDetailRecord` → las 18 claves de `store-notices.json`, en su
 * orden, para el usuario `viewerId`: `is_read` es SU lectura (V-5), no un
 * valor global. `deleted_at` es constante `null` (no hay soft delete).
 */
function toStoreNoticeDto(record: StoreNoticeDetailRecord, viewerId: number): StoreNotice {
  const creatorPermissions = new Set(record.creator.permissions.map((p) => p.name));
  const creatorRole = ROLE_LABELS.find(([name]) => creatorPermissions.has(name))?.[1] ?? null;
  return {
    id: record.id,
    priority: record.priority,
    notice: record.notice,
    description: record.description,
    effective_from: formatNoticeDate(record.effectiveFrom),
    expired_at: formatNoticeDate(record.expiredAt),
    type: record.type,
    created_by: record.createdBy,
    updated_by: record.updatedBy,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    deleted_at: null,
    is_read: record.reads.find((r) => r.user.id === viewerId)?.isRead ?? false,
    creator_role: creatorRole,
    creator: {
      ...toEmbeddedUser(record.creator),
      permissions: record.creator.permissions.map((p) => ({
        id: p.id,
        name: p.name,
        guard_name: p.guardName,
        created_at: p.createdAt,
        updated_at: p.updatedAt,
        pivot: {
          model_id: record.creator.id,
          permission_id: p.id,
          model_type: USER_MODEL_TYPE,
        },
      })),
    },
    users: record.recipients.map((u) => ({
      ...toEmbeddedUser(u),
      pivot: { store_notice_id: record.id, user_id: u.id },
    })),
    shops: record.shops.map(toShopDto),
    read_status: record.reads.map((r) => ({
      ...toEmbeddedUser(r.user),
      pivot: { store_notice_id: record.id, user_id: r.user.id, is_read: Number(r.isRead) },
    })),
  } as unknown as StoreNotice;
}

/** Un id de la query o de un token de `search`; mal formado ⇒ null (no casa con nada). */
function toIdFilter(raw: unknown): number | null | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function toDate(raw: unknown): Date | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  return new Date(String(raw));
}

function readError(error: unknown): never {
  if (isPrismaConnectionError(error)) {
    throw new ServiceUnavailableException(getUserFriendlyMessage(error));
  }
  throw new InternalServerErrorException(getUserFriendlyMessage(error));
}

function assertId(id: number): void {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new NotFoundException(`No existe un aviso con id ${id}.`);
  }
}

@Injectable()
export class StoreNoticesService {
  /**
   * El autor es el usuario del token. Los destinatarios los decide el `type`
   * (ver `store-notices.repository.ts`); un id de `received_by` inexistente
   * da 400 sin dejar filas.
   */
  async create(dto: CreateStoreNoticeDto, userId: number): Promise<StoreNotice> {
    try {
      const record = await createStoreNotice({
        priority: dto.priority,
        notice: dto.notice,
        description: dto.description ?? null,
        effectiveFrom: toDate(dto.effective_from) ?? null,
        expiredAt: toDate(dto.expired_at) ?? new Date(Number.NaN),
        type: dto.type,
        receivedBy: (dto.received_by as unknown as unknown[] | undefined)?.map(Number),
        createdBy: userId,
      });
      return toStoreNoticeDto(record, userId);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /**
   * Filtros reales con AND (V-4): `notice` (texto), `users.id` (destinatario),
   * `shops.slug` y `shop_id` (tienda destinataria). El mock los pasaba a Fuse
   * sobre `notice` y cualquier otra clave daba `[]`. `orderBy=updated_at`,
   * que pide la barra superior del admin, sí se respeta.
   */
  async getStoreNotices(
    { search, limit, page, orderBy, sortedBy, shop_id }: GetStoreNoticesDto,
    viewerId: number,
  ): Promise<StoreNoticePaginator> {
    if (!page) page = 1;
    if (!limit) limit = 12;
    const url = `/store-notices?search=${search}&limit=${limit}`;

    const tokens = parseSearch(search);
    const userId = toIdFilter(tokens['users.id']);
    const shopId = toIdFilter(tokens.shop_id ?? shop_id);
    if (userId === null || shopId === null) {
      return { data: [], ...paginate(0, page, limit, 0, url) };
    }

    const sortField = orderBy ? SORT_ALIASES[String(orderBy).toLowerCase()] : undefined;
    const input: ListStoreNoticesInput = {
      notice: tokens.notice,
      userId,
      shopId,
      shopSlug: tokens['shops.slug'],
      ...(sortField &&
        (STORE_NOTICE_SORTABLE as readonly string[]).includes(sortField) && {
          orderBy: sortField,
          sortedBy: String(sortedBy).toLowerCase() === 'asc' ? 'asc' : 'desc',
        }),
      page: Number(page) || 1,
      limit: Number(limit) || 12,
    };

    let result: { items: StoreNoticeDetailRecord[]; total: number };
    try {
      result = await listStoreNotices(input);
    } catch (error) {
      readError(error);
    }

    const data = result.items.map((r) => toStoreNoticeDto(r, viewerId));
    return { data, ...paginate(result.total, page, limit, data.length, url) };
  }

  /** Por id, como el mock; inexistente o id mal formado ⇒ 404 (V-7). */
  async getStoreNotice(param: string, viewerId: number): Promise<StoreNotice> {
    const id = Number(param);
    assertId(id);
    let record: StoreNoticeDetailRecord | null;
    try {
      record = await findStoreNoticeById(id);
    } catch (error) {
      readError(error);
    }
    if (!record) {
      throw new NotFoundException(`No existe un aviso con id ${param}.`);
    }
    return toStoreNoticeDto(record, viewerId);
  }

  /** `updated_by` = usuario del token; `type`/`received_by` recalculan los pivotes. */
  async update(id: number, dto: UpdateStoreNoticeDto, userId: number): Promise<StoreNotice> {
    assertId(id);
    const effectiveFrom = toDate(dto.effective_from);
    const expiredAt = toDate(dto.expired_at);
    const input: UpdateStoreNoticeInput = {
      ...(dto.priority !== undefined && { priority: dto.priority }),
      ...(dto.notice !== undefined && { notice: dto.notice }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(effectiveFrom !== undefined && { effectiveFrom }),
      ...(expiredAt != null && { expiredAt }),
      ...(dto.type !== undefined && { type: dto.type }),
      ...(dto.received_by !== undefined && {
        receivedBy: (dto.received_by as unknown as unknown[]).map(Number),
      }),
      updatedBy: userId,
    };
    try {
      return toStoreNoticeDto(await updateStoreNotice(id, input), userId);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /** Devuelve el aviso borrado (V-7: el mock devolvía un string). */
  async remove(id: number, userId: number): Promise<StoreNotice> {
    assertId(id);
    try {
      return toStoreNoticeDto(await deleteStoreNotice(id), userId);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /**
   * `POST /store-notices/read` (V-6): la ruta que el admin ya llamaba y daba
   * 404. Marca el aviso como leído para el usuario del token y lo devuelve
   * proyectado para él.
   */
  async markAsRead(id: unknown, userId: number): Promise<StoreNotice> {
    const noticeId = Number(id);
    assertId(noticeId);
    try {
      return toStoreNoticeDto(await markStoreNoticeRead(noticeId, userId), userId);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }
}
