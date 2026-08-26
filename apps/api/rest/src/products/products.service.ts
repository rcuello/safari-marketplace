import {
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { plainToClass } from 'class-transformer';
import {
  getUserFriendlyMessage,
  isPrismaConnectionError,
  listProducts,
  type ListProductsInput,
  type ProductRecord,
} from '@safari/db';
import { CreateProductDto } from './dto/create-product.dto';
import { GetProductsDto, ProductPaginator } from './dto/get-products.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Product } from './entities/product.entity';
import { paginate } from 'src/common/pagination/paginate';
import productsJson from '@db/products.json';
import popularProductsJson from '@db/popular-products.json';
import bestSellingProductsJson from '@db/best-selling-products.json';
import Fuse from 'fuse.js';
import { GetPopularProductsDto } from './dto/get-popular-products.dto';
import { GetBestSellingProductsDto } from './dto/get-best-selling-products.dto';

const products = plainToClass(Product, productsJson);
const popularProducts = plainToClass(Product, popularProductsJson);
const bestSellingProducts = plainToClass(Product, bestSellingProductsJson);

const options = {
  keys: [
    'name',
    'type.slug',
    'categories.slug',
    'status',
    'shop_id',
    'author.slug',
    'tags',
    'manufacturer.slug',
    'visibility',
  ],
  threshold: 0.3,
};
const fuse = new Fuse(products, options);

/**
 * `value` → number solo si es finito; si no (`'abc'`, `''`, `undefined`),
 * `undefined` — el token se ignora en vez de colar un `NaN` hasta Prisma
 * (regresión V-3: `Number('abc')` es `NaN`, que pasa el `!== undefined` de
 * `buildWhere` y hace que Prisma lance, convirtiéndose en un 500).
 *
 * Replica el comportamiento de facto del mock: `parseInt('abc', 10)` daba
 * `NaN`, `if (exactFilters.shop_id)` era falsy y el filtro se descartaba en
 * silencio mientras el request seguía respondiendo 200. Aquí no hay 400:
 * el contrato a preservar (CA-1) es que el mock respondía 200.
 */
function parseFiniteNumber(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * `search=key:value;key:value` → `ListProductsInput` de `@safari/db`.
 *
 * Trocea igual que hacía el mock (`split(';')`, luego el primer `:`); no
 * "mejora" el parseo. `slug` se descarta explícitamente (igual que el
 * mock); `author.slug` y cualquier clave desconocida se ignoran sin error
 * — no hay columna ni campo que las soporte.
 */
function parseProductSearch(search?: string): ListProductsInput {
  const input: ListProductsInput = {};
  if (!search) return input;

  for (const token of search.split(';')) {
    const [key, value] = token.split(':');
    switch (key) {
      case 'type.slug':
        input.typeSlug = value;
        break;
      case 'categories.slug':
        input.categorySlug = value;
        break;
      case 'tags.slug':
        input.tagSlug = value;
        break;
      case 'manufacturer.slug':
        input.manufacturerSlug = value;
        break;
      case 'name':
        input.name = value;
        break;
      case 'shop_id': {
        const shopId = parseFiniteNumber(value);
        if (shopId !== undefined) input.shopId = shopId;
        break;
      }
      case 'min_price': {
        const minPrice = parseFiniteNumber(value);
        if (minPrice !== undefined) input.minPrice = minPrice;
        break;
      }
      case 'max_price': {
        const maxPrice = parseFiniteNumber(value);
        if (maxPrice !== undefined) input.maxPrice = maxPrice;
        break;
      }
      case 'status':
        input.status = value;
        break;
      case 'visibility':
        input.visibility = value;
        break;
      default:
        // 'slug' descartado a propósito; el resto (author.slug, orderBy...)
        // se ignora sin romper el request.
        break;
    }
  }

  return input;
}

/**
 * `ProductRecord` (camelCase, `@safari/db`) → proyección de 20 claves
 * snake_case que ya publicaba `products.json`. `type.logo` e
 * `in_flash_sale` son constantes: no hay columna que los respalde
 * (divergencias documentadas en `design.md`). Se castea a `Product`, igual
 * que `settings.service.ts:39` — la entidad declara campos que este
 * listado no emite.
 */
function toProductDto(record: ProductRecord): Product {
  return {
    id: record.id,
    name: record.name,
    slug: record.slug,
    type: {
      id: record.type.id,
      name: record.type.name,
      slug: record.type.slug,
      logo: null,
      settings: record.type.settings,
    },
    language: record.language,
    translated_languages: record.translatedLanguages,
    product_type: record.productType,
    shop: {
      id: record.shop.id,
      name: record.shop.name,
      slug: record.shop.slug,
      logo: record.shop.logo,
    },
    sale_price: record.salePrice,
    max_price: record.maxPrice,
    min_price: record.minPrice,
    image: record.image,
    status: record.status,
    price: record.price,
    quantity: record.quantity,
    unit: record.unit,
    sku: record.sku,
    sold_quantity: record.soldQuantity,
    in_flash_sale: 0,
    visibility: record.visibility,
  } as unknown as Product;
}

@Injectable()
export class ProductsService {
  private products: any = products;
  private popularProducts: any = popularProducts;
  private bestSellingProducts: any = bestSellingProducts;

  create(createProductDto: CreateProductDto) {
    return this.products[0];
  }

  async getProducts({
    limit,
    page,
    search,
  }: GetProductsDto): Promise<ProductPaginator> {
    if (!page) page = 1;
    if (!limit) limit = 30;

    const input: ListProductsInput = {
      ...parseProductSearch(search),
      // listProducts() exige números (Prisma usa page/limit en skip/take);
      // page/limit siguen crudos (sin convertir) para paginate() y la URL
      // más abajo — ver Decision A / MUST-KEEP en design.md.
      page: Number(page) || 1,
      limit: Number(limit) || 30,
    };

    try {
      const { items, total } = await listProducts(input);
      const data = items.map(toProductDto);
      const url = `/products?search=${search}&limit=${limit}`;
      return {
        data,
        ...paginate(total, page, limit, data.length, url),
      };
    } catch (error) {
      if (isPrismaConnectionError(error)) {
        throw new ServiceUnavailableException(getUserFriendlyMessage(error));
      }
      throw new InternalServerErrorException(getUserFriendlyMessage(error));
    }
  }

  getProductBySlug(slug: string): Product {
    const product = this.products.find((p) => p.slug === slug);
    const related_products = this.products
      .filter((p) => p.type.slug === product.type.slug)
      .slice(0, 20);
    return {
      ...product,
      related_products,
    };
  }

  getPopularProducts({ limit, type_slug }: GetPopularProductsDto): Product[] {
    let data: any = this.popularProducts;
    if (type_slug) {
      data = fuse.search(type_slug)?.map(({ item }) => item);
    }
    return data?.slice(0, limit);
  }
  getBestSellingProducts({
    limit,
    type_slug,
  }: GetBestSellingProductsDto): Product[] {
    let data: any = this.bestSellingProducts;
    if (type_slug) {
      data = fuse.search(type_slug)?.map(({ item }) => item);
    }
    return data?.slice(0, limit);
  }

  getProductsStock({ limit, page, search }: GetProductsDto): ProductPaginator {
    if (!page) page = 1;
    if (!limit) limit = 30;
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    let data: Product[] = this.products.filter((item) => item.quantity <= 9);

    if (search) {
      const parseSearchParams = search.split(';');
      const searchText: any = [];
      for (const searchParam of parseSearchParams) {
        const [key, value] = searchParam.split(':');
        // TODO: Temp Solution
        if (key !== 'slug') {
          searchText.push({
            [key]: value,
          });
        }
      }

      data = fuse
        .search({
          $and: searchText,
        })
        ?.map(({ item }) => item);
    }

    const results = data.slice(startIndex, endIndex);
    const url = `/products-stock?search=${search}&limit=${limit}`;
    return {
      data: results,
      ...paginate(data.length, page, limit, results.length, url),
    };
  }

  getDraftProducts({ limit, page, search }: GetProductsDto): ProductPaginator {
    if (!page) page = 1;
    if (!limit) limit = 30;
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    let data: Product[] = this.products.filter(
      (item) => item.status === 'draft',
    );

    if (search) {
      const parseSearchParams = search.split(';');
      const searchText: any = [];
      for (const searchParam of parseSearchParams) {
        const [key, value] = searchParam.split(':');
        // TODO: Temp Solution
        if (key !== 'slug') {
          searchText.push({
            [key]: value,
          });
        }
      }

      data = fuse
        .search({
          $and: searchText,
        })
        ?.map(({ item }) => item);
    }

    const results = data.slice(startIndex, endIndex);
    const url = `/draft-products?search=${search}&limit=${limit}`;
    return {
      data: results,
      ...paginate(data.length, page, limit, results.length, url),
    };
  }

  update(id: number, updateProductDto: UpdateProductDto) {
    return this.products[0];
  }

  remove(id: number) {
    return `This action removes a #${id} product`;
  }
}
