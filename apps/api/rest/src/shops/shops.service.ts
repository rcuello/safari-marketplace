import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createShop,
  findShopBySlug,
  findShopOwnerById,
  getUserFriendlyMessage,
  isPrismaConnectionError,
  listShops,
  listShopsNear,
  setShopActive,
  updateShop,
  type CreateShopInput,
  type ListShopsInput,
  type Prisma,
  type ShopNearRecord,
  type ShopRecord,
  type UpdateShopInput,
} from '@safari/db';
import { toWriteHttpException } from 'src/common/errors/domain-error.mapper';
import { CurrentUserPayload } from 'src/auth/decorators/current-user.decorator';
import { CreateShopDto } from './dto/create-shop.dto';
import { UpdateShopDto } from './dto/update-shop.dto';
import { Shop } from './entities/shop.entity';
import { GetShopsDto, ShopPaginator } from './dto/get-shops.dto';
import { paginate } from 'src/common/pagination/paginate';
import { GetStaffsDto } from './dto/get-staffs.dto';
import { parseSearch } from 'src/common/search/parse-search';

/**
 * `ShopRecord` (camelCase, `@safari/db`) → proyección de 16 claves
 * snake_case que ya publicaba `shops.json`. `owner`, `orders_count` y
 * `notifications` son constantes: no hay columna que los respalde
 * (V-4/V-5/V-6). `products_count` es el `productsCount` filtrado que ya
 * calculó el repositorio (Decisión E, design.md) — `?? 0` para
 * `findOrCreateShopBySlug` (scraper), que no lo calcula. Se castea a
 * `Shop`, igual que `toProductDto` — la entidad declara campos que este
 * listado no emite (`staffs`, `balance`, `distance`, `lat`, `lng`).
 */
// Exportada para `auth.service.ts` (D-9 del proposal de US-22): `/me`
// traduce `UserWithRelations.shops` con esta misma función en vez de
// duplicar el shape de tienda.
export function toShopDto(record: ShopRecord): Shop {
  return {
    id: record.id,
    owner_id: record.ownerId,
    name: record.name,
    slug: record.slug,
    description: record.description,
    cover_image: record.coverImage,
    logo: record.logo,
    is_active: Number(record.isActive),
    address: record.address,
    settings: record.settings,
    notifications: null,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    orders_count: 0,
    products_count: record.productsCount ?? 0,
    owner: null,
  } as unknown as Shop;
}

/**
 * `ShopNearRecord` → proyección de las 14 claves EN ORDEN de
 * `near-shop.json` (US-5 Decision E) — NO reutiliza `toShopDto`: le faltan
 * `orders_count`/`products_count`/`owner` y trae `distance`, obligatoria
 * (`near-shop.tsx:38-41` la renderiza). `distance` se emite **number**
 * (`record.distanceKm`), no el `string` que declara la entidad: el
 * frontend hace `.toFixed(2)`.
 */
function toNearShopDto(record: ShopNearRecord): Shop {
  return {
    id: record.id,
    owner_id: record.ownerId,
    name: record.name,
    slug: record.slug,
    description: record.description,
    cover_image: record.coverImage,
    logo: record.logo,
    is_active: Number(record.isActive),
    address: record.address,
    settings: record.settings,
    notifications: null,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    distance: record.distanceKm,
  } as unknown as Shop;
}

@Injectable()
export class ShopsService {
  /**
   * `owner_id` SIEMPRE del token (`user.sub`, D30-3), nunca del body.
   * `is_active` explícito por rol (D30-6): `store_owner` entra a la cola de
   * moderación (`false`); `super_admin` nace activa (`true`) — ninguno de
   * los dos se apoya en el `DEFAULT true` del DDL. Input campo a campo
   * (`R30-7`): nunca `...createShopDto`. `logo`/`cover_image`/`address`/
   * `settings` con `!= null` (DD30-4): un `null` explícito es un no-op
   * declarado, no un valor a persistir.
   */
  async create(
    createShopDto: CreateShopDto,
    user: CurrentUserPayload,
  ): Promise<Shop> {
    const input: CreateShopInput = {
      name: createShopDto.name,
      ownerId: user.sub,
      isActive: user.permissions.includes('super_admin'),
      ...(createShopDto.description !== undefined && {
        description: createShopDto.description,
      }),
      ...(createShopDto.logo != null && {
        logo: createShopDto.logo as unknown as Prisma.InputJsonValue,
      }),
      ...(createShopDto.cover_image != null && {
        coverImage: createShopDto.cover_image as unknown as Prisma.InputJsonValue,
      }),
      ...(createShopDto.address != null && {
        address: createShopDto.address as unknown as Prisma.InputJsonValue,
      }),
      ...(createShopDto.settings != null && {
        settings: createShopDto.settings as unknown as Prisma.InputJsonValue,
      }),
    };

    try {
      const record = await createShop(input);
      return toShopDto(record);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  async getShops({ search, limit, page }: GetShopsDto): Promise<ShopPaginator> {
    if (!page) page = 1;

    const tokens = parseSearch(search);
    const input: ListShopsInput = {
      name: tokens.name,
      // V-15: search=is_active:1 → filtro exacto por columna, reemplaza el
      // fuse difuso del mock. Ausente → el repositorio aplica su default
      // (isActive: true), igual que hoy.
      ...(tokens.is_active !== undefined && {
        isActive: tokens.is_active === '1',
      }),
      page: Number(page) || 1,
      limit: Number(limit) || 30,
    };

    let result: { items: ShopRecord[]; total: number };
    try {
      result = await listShops(input);
    } catch (error) {
      if (isPrismaConnectionError(error)) {
        throw new ServiceUnavailableException(getUserFriendlyMessage(error));
      }
      throw new InternalServerErrorException(getUserFriendlyMessage(error));
    }

    const data = result.items.map(toShopDto);
    const url = `/shops?search=${search}&limit=${limit}`;
    return {
      data,
      ...paginate(result.total, page, limit, data.length, url),
    };
  }

  /**
   * Calca `getShops` (I): reutiliza `ListShopsInput.isActive`, cero código
   * nuevo en el repositorio. `isActive: false` es el filtro base, fijo — el
   * search solo aporta `name` (B-7: filtro exacto, ya no `fuse` difuso
   * sobre `name`/`type.slug`/`is_active`).
   */
  async getNewShops({
    search,
    limit,
    page,
  }: GetShopsDto): Promise<ShopPaginator> {
    if (!page) page = 1;

    const tokens = parseSearch(search);
    const input: ListShopsInput = {
      name: tokens.name,
      isActive: false,
      page: Number(page) || 1,
      limit: Number(limit) || 30,
    };

    let result: { items: ShopRecord[]; total: number };
    try {
      result = await listShops(input);
    } catch (error) {
      if (isPrismaConnectionError(error)) {
        throw new ServiceUnavailableException(getUserFriendlyMessage(error));
      }
      throw new InternalServerErrorException(getUserFriendlyMessage(error));
    }

    const data = result.items.map(toShopDto);
    const url = `/new-shops?search=${search}&limit=${limit}`;
    return {
      data,
      ...paginate(result.total, page, limit, data.length, url),
    };
  }

  /**
   * `D30-10`/CA-4: sin relación staff↔tienda en el DDL (Out of Scope del
   * spec) — ya no lee `shops.json`, mismo `paginate()` de hoy (nunca
   * `buildPaginator`), mismo key-set y mismo tipo de `per_page` (el
   * `limit` crudo, sin coerción).
   */
  getStaffs({ limit, page }: GetStaffsDto) {
    const url = `/staffs?limit=${limit}`;

    return {
      data: [],
      ...paginate(0, page, limit, 0, url),
    };
  }

  async getShop(slug: string): Promise<Shop> {
    let record: ShopRecord | null;

    // El try envuelve SOLO la llamada de I/O. El 404 queda fuera a
    // propósito: dentro, este catch lo convertiría en un 500.
    try {
      record = await findShopBySlug(slug);
    } catch (error) {
      if (isPrismaConnectionError(error)) {
        throw new ServiceUnavailableException(getUserFriendlyMessage(error));
      }
      throw new InternalServerErrorException(getUserFriendlyMessage(error));
    }

    if (!record) {
      throw new NotFoundException(`No existe una tienda con slug \`${slug}\`.`);
    }

    return toShopDto(record);
  }

  /**
   * Cercanía real por haversine (B-1: ya no ignora `lat`/`lng` devolviendo
   * 6 tiendas fijas). `Number('undefined')`/`Number('abc')` → `NaN`; el
   * guard vive en `listShopsNear` (repositorio) y responde `[]` con 200,
   * no 400 (B-4) — la tienda dispara esta ruta con `undefined/undefined`
   * en cada carga de `/shops` sin guard `enabled`.
   */
  async getNearByShop(lat: string, lng: string): Promise<Shop[]> {
    try {
      const items = await listShopsNear(Number(lat), Number(lng));
      return items.map(toNearShopDto);
    } catch (error) {
      if (isPrismaConnectionError(error)) {
        throw new ServiceUnavailableException(getUserFriendlyMessage(error));
      }
      throw new InternalServerErrorException(getUserFriendlyMessage(error));
    }
  }

  /**
   * Nivel A primero, siempre (`DD30-3`): la guarda numérica es lo que evita
   * que un `"abc"` llegue a `BigInt(NaN)` (500). `findShopOwnerById(id) ===
   * null` tras esa guarda solo puede significar «la tienda no existe» → 404
   * (nunca 403) — el paso 1 ya eliminó la otra causa de `null`.
   * `super_admin` salta el 403 pero nunca el 404 (un rol no cambia el
   * status de una misma petición). Input campo a campo (`R30-7`): nunca
   * `...updateShopDto`; excluye `slug`/`owner_id`/`is_active` (`DD30-2`) —
   * si el `PUT` los aceptara, un `store_owner` se auto-aprobaría esquivando
   * `approve-shop` (`ADMIN_ONLY`).
   */
  async update(
    id: number,
    updateShopDto: UpdateShopDto,
    user: CurrentUserPayload,
  ): Promise<Shop> {
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new NotFoundException(`No existe una tienda con id ${id}.`);
    }

    const ownerId = await findShopOwnerById(id);
    if (ownerId === null) {
      throw new NotFoundException(`No existe una tienda con id ${id}.`);
    }

    if (!user.permissions.includes('super_admin') && ownerId !== user.sub) {
      throw new ForbiddenException(
        `No tienes permisos sobre la tienda ${id}.`,
      );
    }

    const input: UpdateShopInput = {
      ...(updateShopDto.name !== undefined && { name: updateShopDto.name }),
      ...(updateShopDto.description !== undefined && {
        description: updateShopDto.description,
      }),
      ...(updateShopDto.logo != null && {
        logo: updateShopDto.logo as unknown as Prisma.InputJsonValue,
      }),
      ...(updateShopDto.cover_image != null && {
        coverImage: updateShopDto.cover_image as unknown as Prisma.InputJsonValue,
      }),
      ...(updateShopDto.address != null && {
        address: updateShopDto.address as unknown as Prisma.InputJsonValue,
      }),
      ...(updateShopDto.settings != null && {
        settings: updateShopDto.settings as unknown as Prisma.InputJsonValue,
      }),
    };

    try {
      const record = await updateShop(id, input);
      return toShopDto(record);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  approve(id: number) {
    return `This action removes a #${id} shop`;
  }

  remove(id: number) {
    return `This action removes a #${id} shop`;
  }

  /**
   * Stubs declarados (`DD30-8`): `POST /staffs`/`PUT /staffs/:id` reusaban
   * `create()`/`update()` con la aridad de ayer; al migrarlas a
   * `(dto, user)` dejaban de compilar (`TS2554`). Pasarles `@CurrentUser()`
   * crearía/editaría una tienda real desde una ruta sin relación
   * staff↔tienda en el DDL (Out of Scope del spec) — inaceptable. Se
   * preserva el comportamiento de stub (no escriben nada); el cuerpo
   * byte-a-byte de la fila 0 del mock es irreproducible una vez que
   * `shops.json` sale del servicio (CA-6), y ningún consumidor lo lee
   * (`useAddStaffMutation`, `apps/admin/rest/src/data/staff.ts:37-38`, con
   * `onSuccess: () => {}` sin parámetro).
   */
  createStaff(): null {
    return null;
  }

  /** Idéntico criterio que `createStaff()` — ver `DD30-8`. */
  updateStaff(): null {
    return null;
  }

  /**
   * Frontera numérica y semántica de `@Body('id')` sin tipar (`DD30-3`):
   * `typeof` estrecha ANTES de `Number(...)`, así que `{"id": true}`
   * (`Number(true) === 1`) o `{"id": null}`/`{"id": []}`/`{"id": {}}` nunca
   * llegan a evaluarse como número — sin el estrechamiento, `{"id": true}`
   * moderaría la tienda 1. `Number.isSafeInteger` (nunca `Number.isInteger`,
   * que deja pasar `1e21` hasta el driver) y `<= 0` cierran `{"id": 0}`/
   * `{"id": ""}`. Fuera de esa guarda, `setShopActive` no lleva ninguna
   * propia (`DD30-1`); su `P2025` se traduce a 404 vía
   * `toWriteHttpException`.
   */
  private async _setActive(rawId: unknown, isActive: boolean): Promise<Shop> {
    const parsed =
      typeof rawId === 'number' || typeof rawId === 'string'
        ? Number(rawId)
        : Number.NaN;

    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new BadRequestException(
        `El id de la tienda debe ser un entero positivo, recibido: ${JSON.stringify(rawId)}.`,
      );
    }

    try {
      const record = await setShopActive(parsed, isActive);
      return toShopDto(record);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  disapproveShop(id: unknown): Promise<Shop> {
    return this._setActive(id, false);
  }

  approveShop(id: unknown): Promise<Shop> {
    return this._setActive(id, true);
  }
}
