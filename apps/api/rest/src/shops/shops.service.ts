import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { plainToClass } from 'class-transformer';
import {
  findShopBySlug,
  getUserFriendlyMessage,
  isPrismaConnectionError,
  listShops,
  listShopsNear,
  type ListShopsInput,
  type ShopNearRecord,
  type ShopRecord,
} from '@safari/db';
import { CreateShopDto } from './dto/create-shop.dto';
import { UpdateShopDto } from './dto/update-shop.dto';
import { Shop } from './entities/shop.entity';
import shopsJson from '@db/shops.json';
import { GetShopsDto, ShopPaginator } from './dto/get-shops.dto';
import { paginate } from 'src/common/pagination/paginate';
import { GetStaffsDto } from './dto/get-staffs.dto';
import { parseSearch } from 'src/common/search/parse-search';

// Solo sostiene create()/update()/getStaffs()/dis-/approveShop() — el
// listado y los 2 endpoints derivados (new-shops, near-by-shop) ya salen de
// Postgres vía listShops()/listShopsNear() (US-5).
const shops = plainToClass(Shop, shopsJson);

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
function toShopDto(record: ShopRecord): Shop {
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
  private shops: Shop[] = shops;

  create(createShopDto: CreateShopDto) {
    return this.shops[0];
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

  getStaffs({ shop_id, limit, page }: GetStaffsDto) {
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    let staffs: Shop['staffs'] = [];
    if (shop_id) {
      staffs = this.shops.find((p) => p.id === Number(shop_id))?.staffs ?? [];
    }
    const results = staffs?.slice(startIndex, endIndex);
    const url = `/staffs?limit=${limit}`;

    return {
      data: results,
      ...paginate(staffs?.length, page, limit, results?.length, url),
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

  update(id: number, updateShopDto: UpdateShopDto) {
    return this.shops[0];
  }

  approve(id: number) {
    return `This action removes a #${id} shop`;
  }

  remove(id: number) {
    return `This action removes a #${id} shop`;
  }

  disapproveShop(id: number) {
    const shop = this.shops.find((s) => s.id === Number(id));
    shop.is_active = false;

    return shop;
  }

  approveShop(id: number) {
    const shop = this.shops.find((s) => s.id === Number(id));
    shop.is_active = true;

    return shop;
  }
}
