import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createProduct,
  deleteProduct,
  findProductBySlug,
  findProductShopId,
  findShopOwnerById,
  getUserFriendlyMessage,
  isPrismaConnectionError,
  listProducts,
  updateProduct,
  type CreateProductInput,
  type ListProductsInput,
  type Prisma,
  type ProductDetail,
  type ProductRecord,
  type UpdateProductInput,
} from '@safari/db';
import { toWriteHttpException } from 'src/common/errors/domain-error.mapper';
import {
  CurrentUserPayload,
} from 'src/auth/decorators/current-user.decorator';
import { CreateProductDto } from './dto/create-product.dto';
import { GetProductsDto, ProductPaginator } from './dto/get-products.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Product } from './entities/product.entity';
import { paginate } from 'src/common/pagination/paginate';
import { GetPopularProductsDto } from './dto/get-popular-products.dto';
import { GetBestSellingProductsDto } from './dto/get-best-selling-products.dto';

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
  /**
   * Propiedad por tienda (DD29-4): `super_admin` corta en seco sin
   * consultar `shops`; `store_owner`/`staff` deben ser dueños de `shopId`.
   * `findShopOwnerById(shopId) === null` (tienda inexistente) NO es 403: se
   * deja pasar para que el repositorio produzca el 400 vía `P2003` — mismo
   * desenlace que si hubiera sido `super_admin` (nunca sondeó).
   */
  async create(
    createProductDto: CreateProductDto,
    user: CurrentUserPayload,
  ): Promise<Product> {
    const shopId = Number(createProductDto.shop_id);

    if (!user.permissions.includes('super_admin')) {
      const ownerId = await findShopOwnerById(shopId);
      if (ownerId !== null && ownerId !== user.sub) {
        throw new ForbiddenException(
          `No tienes permisos sobre la tienda ${shopId}.`,
        );
      }
    }

    // Campo a campo (R29-6): nunca `...createProductDto` — el body trae
    // `variation_options`, `author_id`, `digital_file`, etc. sin columna.
    const input: CreateProductInput = {
      name: createProductDto.name,
      typeId: Number(createProductDto.type_id),
      shopId,
      ...(createProductDto.manufacturer_id !== undefined && {
        manufacturerId: Number(createProductDto.manufacturer_id),
      }),
      ...(createProductDto.description !== undefined && {
        description: createProductDto.description,
      }),
      ...(createProductDto.product_type !== undefined && {
        productType: createProductDto.product_type,
      }),
      ...(createProductDto.price !== undefined && {
        price: createProductDto.price,
      }),
      ...(createProductDto.sale_price !== undefined && {
        salePrice: createProductDto.sale_price,
      }),
      ...(createProductDto.min_price !== undefined && {
        minPrice: createProductDto.min_price,
      }),
      ...(createProductDto.max_price !== undefined && {
        maxPrice: createProductDto.max_price,
      }),
      ...(createProductDto.quantity !== undefined && {
        quantity: createProductDto.quantity,
      }),
      ...(createProductDto.in_stock !== undefined && {
        inStock: createProductDto.in_stock,
      }),
      ...(createProductDto.sku !== undefined && { sku: createProductDto.sku }),
      ...(createProductDto.unit !== undefined && {
        unit: createProductDto.unit,
      }),
      ...(createProductDto.status !== undefined && {
        status: createProductDto.status,
      }),
      ...(createProductDto.visibility !== undefined && {
        visibility: createProductDto.visibility,
      }),
      ...(createProductDto.image !== undefined && {
        image: createProductDto.image as unknown as Prisma.InputJsonValue,
      }),
      ...(createProductDto.gallery !== undefined && {
        gallery: createProductDto.gallery as unknown as Prisma.InputJsonValue,
      }),
      ...(createProductDto.is_taxable !== undefined && {
        isTaxable: createProductDto.is_taxable,
      }),
      ...(createProductDto.language !== undefined && {
        language: createProductDto.language,
      }),
      ...(Array.isArray(createProductDto.categories) && {
        categoryIds: createProductDto.categories,
      }),
      ...(Array.isArray(createProductDto.tags) && {
        tagIds: createProductDto.tags,
      }),
    };

    try {
      const record = await createProduct(input);
      return toProductDto(record);
    } catch (error) {
      throw toWriteHttpException(error);
    }
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

  async getProductBySlug(slug: string): Promise<Product> {
    let detail: ProductDetail | null;

    // El try envuelve SOLO la llamada al repositorio (mismo criterio que
    // getProducts(), líneas 194-207). El 404 de abajo queda fuera a
    // propósito: si se lanzara dentro, este catch lo convertiría en un 500.
    try {
      detail = await findProductBySlug(slug);
    } catch (error) {
      if (isPrismaConnectionError(error)) {
        throw new ServiceUnavailableException(getUserFriendlyMessage(error));
      }
      throw new InternalServerErrorException(getUserFriendlyMessage(error));
    }

    if (!detail) {
      throw new NotFoundException(`No existe un producto con slug \`${slug}\`.`);
    }

    return {
      ...toProductDto(detail),
      related_products: detail.relatedProducts.map(toProductDto),
    } as unknown as Product;
  }

  /**
   * `type_slug` filtra DENTRO del ranking ya ordenado por `ratings desc`
   * (B-2), no vía búsqueda difusa sobre todo el catálogo. Default `limit`
   * ausente: 10 (Decision H). `type_slug` vacío/ausente → `undefined`, sin
   * filtro.
   */
  async getPopularProducts({
    limit,
    type_slug,
  }: GetPopularProductsDto): Promise<Product[]> {
    try {
      const { items } = await listProducts({
        orderBy: 'ratings',
        typeSlug: type_slug,
        // El query param llega como string (sin ValidationPipe transform,
        // igual que page/limit en getProducts()); Prisma exige `take`
        // numérico. `Number('abc') || 10` cae al default, igual que el
        // resto del archivo.
        limit: Number(limit) || 10,
      });
      return items.map(toProductDto);
    } catch (error) {
      if (isPrismaConnectionError(error)) {
        throw new ServiceUnavailableException(getUserFriendlyMessage(error));
      }
      throw new InternalServerErrorException(getUserFriendlyMessage(error));
    }
  }

  /** Idéntico criterio que popular, orden `soldQuantity desc`, default 5. */
  async getBestSellingProducts({
    limit,
    type_slug,
  }: GetBestSellingProductsDto): Promise<Product[]> {
    try {
      const { items } = await listProducts({
        orderBy: 'soldQuantity',
        typeSlug: type_slug,
        limit: Number(limit) || 5,
      });
      return items.map(toProductDto);
    } catch (error) {
      if (isPrismaConnectionError(error)) {
        throw new ServiceUnavailableException(getUserFriendlyMessage(error));
      }
      throw new InternalServerErrorException(getUserFriendlyMessage(error));
    }
  }

  /**
   * Vista de inventario (`quantity <= 9`), sin el default `publish`/
   * `visibility_public` del listado principal (Decision C): el mock tampoco
   * lo aplicaba aquí. `search` se combina con AND sobre `maxQuantity` (B-5),
   * no reemplaza el filtro base como hacía el `fuse.search($and)` del mock.
   */
  async getProductsStock({
    limit,
    page,
    search,
  }: GetProductsDto): Promise<ProductPaginator> {
    if (!page) page = 1;
    if (!limit) limit = 30;

    const input: ListProductsInput = {
      ...parseProductSearch(search),
      applyStorefrontDefaults: false,
      maxQuantity: 9,
      page: Number(page) || 1,
      limit: Number(limit) || 30,
    };

    try {
      const { items, total } = await listProducts(input);
      const data = items.map(toProductDto);
      const url = `/products-stock?search=${search}&limit=${limit}`;
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

  /**
   * Borradores (`status = 'draft'`), mismo criterio sin default de vitrina
   * (Decision C). `status: 'draft'` va DESPUÉS del spread de
   * `parseProductSearch` a propósito: es el filtro base, no negociable —
   * un `search=status:publish` no debe hacerlo desaparecer (B-5).
   */
  async getDraftProducts({
    limit,
    page,
    search,
  }: GetProductsDto): Promise<ProductPaginator> {
    if (!page) page = 1;
    if (!limit) limit = 30;

    const input: ListProductsInput = {
      ...parseProductSearch(search),
      applyStorefrontDefaults: false,
      status: 'draft',
      page: Number(page) || 1,
      limit: Number(limit) || 30,
    };

    try {
      const { items, total } = await listProducts(input);
      const data = items.map(toProductDto);
      const url = `/draft-products?search=${search}&limit=${limit}`;
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

  /**
   * 404 antes que 403 (DD29-4): la propiedad se evalúa sobre el `shop_id`
   * **actual** de la fila, que exige tenerla primero. Mover `shop_id`
   * (`D29-1` ratificada: es mutable) exige propiedad de AMBAS tiendas — la
   * actual primero, la destino después.
   */
  async update(
    id: number,
    updateProductDto: UpdateProductDto,
    user: CurrentUserPayload,
  ): Promise<Product> {
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new NotFoundException(`No existe un producto con id ${id}.`);
    }

    const currentShopId = await findProductShopId(id);
    if (currentShopId === null) {
      throw new NotFoundException(`No existe un producto con id ${id}.`);
    }

    if (!user.permissions.includes('super_admin')) {
      const currentOwnerId = await findShopOwnerById(currentShopId);
      if (currentOwnerId !== user.sub) {
        throw new ForbiddenException(
          `No tienes permisos sobre la tienda ${currentShopId}.`,
        );
      }

      if (updateProductDto.shop_id !== undefined) {
        const destinationShopId = Number(updateProductDto.shop_id);
        if (destinationShopId !== currentShopId) {
          const destinationOwnerId = await findShopOwnerById(destinationShopId);
          if (destinationOwnerId !== null && destinationOwnerId !== user.sub) {
            throw new ForbiddenException(
              `No tienes permisos sobre la tienda ${destinationShopId}.`,
            );
          }
        }
      }
    }

    const input: UpdateProductInput = {
      ...(updateProductDto.name !== undefined && {
        name: updateProductDto.name,
      }),
      ...(updateProductDto.type_id !== undefined && {
        typeId: Number(updateProductDto.type_id),
      }),
      ...(updateProductDto.shop_id !== undefined && {
        shopId: Number(updateProductDto.shop_id),
      }),
      ...(updateProductDto.manufacturer_id !== undefined && {
        manufacturerId: Number(updateProductDto.manufacturer_id),
      }),
      ...(updateProductDto.description !== undefined && {
        description: updateProductDto.description,
      }),
      ...(updateProductDto.product_type !== undefined && {
        productType: updateProductDto.product_type,
      }),
      ...(updateProductDto.price !== undefined && {
        price: updateProductDto.price,
      }),
      ...(updateProductDto.sale_price !== undefined && {
        salePrice: updateProductDto.sale_price,
      }),
      ...(updateProductDto.min_price !== undefined && {
        minPrice: updateProductDto.min_price,
      }),
      ...(updateProductDto.max_price !== undefined && {
        maxPrice: updateProductDto.max_price,
      }),
      ...(updateProductDto.quantity !== undefined && {
        quantity: updateProductDto.quantity,
      }),
      ...(updateProductDto.in_stock !== undefined && {
        inStock: updateProductDto.in_stock,
      }),
      ...(updateProductDto.sku !== undefined && { sku: updateProductDto.sku }),
      ...(updateProductDto.unit !== undefined && {
        unit: updateProductDto.unit,
      }),
      ...(updateProductDto.status !== undefined && {
        status: updateProductDto.status,
      }),
      ...(updateProductDto.visibility !== undefined && {
        visibility: updateProductDto.visibility,
      }),
      ...(updateProductDto.image !== undefined && {
        image: updateProductDto.image as unknown as Prisma.InputJsonValue,
      }),
      ...(updateProductDto.gallery !== undefined && {
        gallery: updateProductDto.gallery as unknown as Prisma.InputJsonValue,
      }),
      ...(updateProductDto.is_taxable !== undefined && {
        isTaxable: updateProductDto.is_taxable,
      }),
      ...(updateProductDto.language !== undefined && {
        language: updateProductDto.language,
      }),
      ...(Array.isArray(updateProductDto.categories) && {
        categoryIds: updateProductDto.categories,
      }),
      ...(Array.isArray(updateProductDto.tags) && {
        tagIds: updateProductDto.tags,
      }),
    };

    try {
      const record = await updateProduct(id, input);
      return toProductDto(record);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }

  /** Mismo guard de id y de propiedad que `update`, sin el lado del destino. */
  async remove(id: number, user: CurrentUserPayload): Promise<Product> {
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new NotFoundException(`No existe un producto con id ${id}.`);
    }

    const currentShopId = await findProductShopId(id);
    if (currentShopId === null) {
      throw new NotFoundException(`No existe un producto con id ${id}.`);
    }

    if (!user.permissions.includes('super_admin')) {
      const ownerId = await findShopOwnerById(currentShopId);
      if (ownerId !== user.sub) {
        throw new ForbiddenException(
          `No tienes permisos sobre la tienda ${currentShopId}.`,
        );
      }
    }

    try {
      const record = await deleteProduct(id);
      return toProductDto(record);
    } catch (error) {
      throw toWriteHttpException(error);
    }
  }
}
