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
  type ListShopsInput,
  type ShopRecord,
} from '@safari/db';
import { CreateShopDto } from './dto/create-shop.dto';
import { UpdateShopDto } from './dto/update-shop.dto';
import { Shop } from './entities/shop.entity';
import shopsJson from '@db/shops.json';
import nearShopJson from '@db/near-shop.json';
import Fuse from 'fuse.js';
import { GetShopsDto, ShopPaginator } from './dto/get-shops.dto';
import { paginate } from 'src/common/pagination/paginate';
import { GetStaffsDto } from './dto/get-staffs.dto';
import { parseSearch } from 'src/common/search/parse-search';

const shops = plainToClass(Shop, shopsJson);
const nearShops = plainToClass(Shop, nearShopJson);
const options = {
  keys: ['name', 'type.slug', 'is_active'],
  threshold: 0.3,
};
const fuse = new Fuse(shops, options);

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

@Injectable()
export class ShopsService {
  private shops: Shop[] = shops;
  private nearShops: Shop[] = shops;

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

  getNewShops({ search, limit, page }: GetShopsDto) {
    if (!page) page = 1;

    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    let data: Shop[] = this.shops.filter(
      (shopItem) => Boolean(shopItem.is_active) === false,
    );

    if (search) {
      const parseSearchParams = search.split(';');
      for (const searchParam of parseSearchParams) {
        const [key, value] = searchParam.split(':');
        data = fuse.search(value)?.map(({ item }) => item);
      }
    }
    const results = data.slice(startIndex, endIndex);
    const url = `/new-shops?search=${search}&limit=${limit}`;

    return {
      data: results,
      ...paginate(data.length, page, limit, results.length, url),
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

  getNearByShop(lat: string, lng: string) {
    return nearShops;
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
