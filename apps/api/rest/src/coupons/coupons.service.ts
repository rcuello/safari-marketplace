import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createCoupon,
  deleteCoupon,
  findCouponByCode,
  findCouponById,
  findShopOwnerById,
  getUserFriendlyMessage,
  isPrismaConnectionError,
  isShopStaff,
  listCoupons,
  now,
  setCouponApproval,
  updateCoupon,
  type CouponRecord,
  type Prisma,
  type UpdateCouponInput,
} from '@safari/db';
import { CurrentUserPayload } from 'src/auth/decorators/current-user.decorator';
import { paginate } from 'src/common/pagination/paginate';
import { parseSearch } from 'src/common/search/parse-search';
import { toWriteHttpException } from 'src/common/errors/domain-error.mapper';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { GetCouponsDto } from './dto/get-coupons.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { VerifyCouponInput } from './dto/verify-coupon.dto';
import { Coupon } from './entities/coupon.entity';

/** La única clave de error de cupón que el shop sabe traducir (`common.json`). */
export const INVALID_COUPON_MESSAGE = 'error-invalid-coupon';

/** Vigente ⇔ `active_from <= now() < expire_at`, con el reloj de `clock.ts`. */
function isInForce(record: CouponRecord): boolean {
  const t = now().getTime();
  return record.activeFrom.getTime() <= t && t < record.expireAt.getTime();
}

/**
 * `CouponRecord` → la forma del mock de cupones, con sus 16 claves en su
 * orden (US-52, D-1). `is_valid` se calcula en cada lectura (V-1);
 * `target`/`is_approve` salen como `1`/`0`, igual que el mock;
 * `translated_languages` es constante (D-6). Sin timestamps: el mock no los trae.
 */
export function toCouponDto(record: CouponRecord): Coupon {
  return {
    id: record.id,
    code: record.code,
    language: record.language,
    description: record.description,
    image: record.image,
    type: record.type,
    amount: record.amount,
    minimum_cart_amount: record.minimumCartAmount,
    active_from: record.activeFrom.toISOString(),
    expire_at: record.expireAt.toISOString(),
    is_valid: isInForce(record),
    target: record.target ? 1 : 0,
    is_approve: record.isApprove ? 1 : 0,
    translated_languages: ['en'],
    shop_id: record.shopId,
    user_id: record.userId,
  } as unknown as Coupon;
}

function readError(error: unknown): never {
  if (isPrismaConnectionError(error)) {
    throw new ServiceUnavailableException(getUserFriendlyMessage(error));
  }
  throw new InternalServerErrorException(getUserFriendlyMessage(error));
}

function assertId(id: number): void {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new NotFoundException(`No existe un cupón con id ${id}.`);
  }
}

/**
 * Campos del `CreateCouponDto` proyectados uno a uno: nunca `...dto`. Un
 * importe o una fecha mal formados llegan como NaN / Invalid Date y el
 * repositorio los rechaza con 400.
 */
function toCouponInput(dto: UpdateCouponDto): UpdateCouponInput {
  return {
    ...(dto.code !== undefined && { code: dto.code }),
    ...(dto.type !== undefined && { type: dto.type }),
    ...(dto.description !== undefined && { description: dto.description }),
    ...(dto.image !== undefined && {
      image: dto.image as unknown as Prisma.InputJsonValue,
    }),
    ...(dto.amount !== undefined && { amount: Number(dto.amount) }),
    ...(dto.minimum_cart_amount !== undefined && {
      minimumCartAmount: Number(dto.minimum_cart_amount),
    }),
    ...(dto.active_from !== undefined && { activeFrom: new Date(dto.active_from) }),
    ...(dto.expire_at !== undefined && { expireAt: new Date(dto.expire_at) }),
    ...(dto.target !== undefined && { target: Boolean(dto.target) }),
    ...(dto.language !== undefined && { language: dto.language }),
  };
}

@Injectable()
export class CouponsService {
  /**
   * Propiedad por tienda (DD29-4, precedente `products.service.ts`):
   * `super_admin` pasa sin consultar. Un cupón global (`shopId null`) es solo
   * suyo. Para el resto, la tienda debe ser del usuario o tenerlo como staff
   * (fila en `shop_staff`, US-66 Ampliación; se consulta solo si no es
   * dueño); una tienda inexistente NO es 403: se deja pasar para que el
   * repositorio dé el 400.
   */
  private async assertCanManage(shopId: number | null, user: CurrentUserPayload): Promise<void> {
    if (user.permissions.includes('super_admin')) return;
    if (shopId === null) {
      throw new ForbiddenException('Solo un super_admin gestiona cupones globales.');
    }
    const ownerId = await findShopOwnerById(shopId);
    if (ownerId !== null && ownerId !== user.sub && !(await isShopStaff(user.sub, shopId))) {
      throw new ForbiddenException(`No tienes permisos sobre la tienda ${shopId}.`);
    }
  }

  /** Busca el cupón para el chequeo de propiedad; inexistente ⇒ 404. */
  private async findForWrite(id: number): Promise<CouponRecord> {
    let record: CouponRecord | null;
    try {
      record = await findCouponById(id);
    } catch (error) {
      readError(error);
    }
    if (!record) {
      throw new NotFoundException(`No existe un cupón con id ${id}.`);
    }
    return record;
  }

  /**
   * `shop_id` no está en `CreateCouponDto`, pero el admin lo envía
   * (`coupon-form.tsx`) y el `ValidationPipe` no hace whitelist: se lee del
   * body de forma explícita. Nace sin aprobar; el autor es quien llama.
   */
  async create(dto: CreateCouponDto, user: CurrentUserPayload): Promise<Coupon> {
    const rawShopId = (dto as CreateCouponDto & { shop_id?: unknown }).shop_id;
    let shopId: number | null = null;
    if (rawShopId !== undefined && rawShopId !== null && rawShopId !== '') {
      shopId = Number(rawShopId);
      if (!Number.isSafeInteger(shopId) || shopId <= 0) {
        throw new BadRequestException(`\`shop_id\` no admite \`${String(rawShopId)}\`.`);
      }
    }
    await this.assertCanManage(shopId, user);

    const input = toCouponInput(dto);
    try {
      const record = await createCoupon({
        ...input,
        code: dto.code,
        type: dto.type,
        amount: Number(dto.amount),
        activeFrom: new Date(dto.active_from),
        expireAt: new Date(dto.expire_at),
        shopId,
        userId: user.sub,
      });
      return toCouponDto(record);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /**
   * Lista paginada en `id DESC` (ignora `orderBy`, como el mock). `shop_id` y
   * `search=code:<texto>` se combinan con AND (V-4). Defaults `page=1`,
   * `limit=12`; `paginate()` recibe el `limit` crudo, así `per_page` sigue
   * saliendo como string cuando llega por query, y la url es la del mock.
   */
  async getCoupons({ search, limit, page, shop_id }: GetCouponsDto) {
    if (!page) page = 1;
    if (!limit) limit = 12;
    const url = `/coupons?search=${search}&limit=${limit}`;
    const pageNumber = Number(page);
    const limitNumber = Number(limit);

    let shopId: number | undefined;
    if (shop_id !== undefined && (shop_id as unknown) !== '') {
      shopId = Number(shop_id);
      if (!Number.isSafeInteger(shopId) || shopId <= 0) {
        return { data: [], ...paginate(0, page, limit, 0, url) };
      }
    }

    try {
      const { items, total } = await listCoupons({
        shopId,
        code: parseSearch(search).code,
        page: pageNumber,
        limit: limitNumber,
      });
      return {
        data: items.map(toCouponDto),
        ...paginate(total, page, limit, items.length, url),
      };
    } catch (error) {
      readError(error);
    }
  }

  /** Por código exacto, como el mock; inexistente ⇒ 404 (V-5). */
  async getCoupon(param: string): Promise<Coupon> {
    let record: CouponRecord | null;
    try {
      record = await findCouponByCode(param);
    } catch (error) {
      readError(error);
    }
    if (!record) {
      throw new NotFoundException(`No existe un cupón con código \`${param}\`.`);
    }
    return toCouponDto(record);
  }

  /** `shop_id` no cambia tras crear. Propiedad sobre la tienda de la fila. */
  async update(id: number, dto: UpdateCouponDto, user: CurrentUserPayload): Promise<Coupon> {
    assertId(id);
    if (!user.permissions.includes('super_admin')) {
      await this.assertCanManage((await this.findForWrite(id)).shopId, user);
    }
    try {
      return toCouponDto(await updateCoupon(id, toCouponInput(dto)));
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /** Devuelve el cupón borrado (V-6: el mock daba un string). */
  async remove(id: number, user: CurrentUserPayload): Promise<Coupon> {
    assertId(id);
    if (!user.permissions.includes('super_admin')) {
      await this.assertCanManage((await this.findForWrite(id)).shopId, user);
    }
    try {
      return toCouponDto(await deleteCoupon(id));
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /**
   * Verificación real del checkout (V-3). Válido ⇔ existe, está aprobado,
   * vigente y `sub_total >= minimum_cart_amount`. `sub_total` ausente o no
   * numérico cuenta como 0. Si falla, 200 con `is_valid: false` y la clave de
   * traducción que el shop pinta; sin `coupon`.
   */
  async verifyCoupon({ code, sub_total }: VerifyCouponInput) {
    let record: CouponRecord | null = null;
    if (typeof code === 'string' && code !== '') {
      try {
        record = await findCouponByCode(code);
      } catch (error) {
        readError(error);
      }
    }
    const subTotal = Number(sub_total);
    const valid =
      record !== null &&
      record.isApprove &&
      isInForce(record) &&
      (Number.isFinite(subTotal) ? subTotal : 0) >= record.minimumCartAmount;
    if (!valid) {
      return { is_valid: false, message: INVALID_COUPON_MESSAGE };
    }
    return { is_valid: true, coupon: toCouponDto(record) };
  }

  /** Persiste la moderación (V-7: `is_approve` sale `1`/`0`, como la lista). */
  async setApproval(id: unknown, isApprove: boolean): Promise<Coupon> {
    const couponId = Number(id);
    assertId(couponId);
    try {
      return toCouponDto(await setCouponApproval(couponId, isApprove));
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }
}
