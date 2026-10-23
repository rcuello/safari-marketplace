import {
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  getDashboardAnalytics,
  getUserFriendlyMessage,
  isPrismaConnectionError,
  listCategoryWiseProductCounts,
  listLowStockProducts,
  listTopRatedProducts,
  now,
  type AnalyticsListInput,
  type OrderStatusCounts,
  type ProductRecord,
  type TypeRecord,
} from '@safari/db';
import { parseSearch } from 'src/common/search/parse-search';
import { Product } from 'src/products/entities/product.entity';
import { toShopDto } from 'src/shops/shops.service';
import { GetAnalyticsListDto } from './dto/get-analytics-list.dto';

/**
 * Clave del dashboard → valor de `orders.order_status` (M-8), en el orden
 * de `analytics.json`. Las 8 claves salen siempre, con 0 si no hay órdenes.
 */
export const STATUS_KEYS = {
  pending: 'order-pending',
  processing: 'order-processing',
  complete: 'order-completed',
  cancelled: 'order-cancelled',
  refunded: 'order-refunded',
  failed: 'order-failed',
  localFacility: 'order-at-local-facility',
  outForDelivery: 'order-out-for-delivery',
} as const;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DEFAULT_LIMIT = 10;

type StatusCountsDto = Record<keyof typeof STATUS_KEYS, number>;

/** Las 12 claves de `analytics.json`, en su orden. */
export interface AnalyticsDto {
  totalRevenue: number;
  totalRefunds: number;
  totalShops: number;
  totalVendors: number;
  todaysRevenue: number;
  totalOrders: number;
  newCustomers: number;
  todayTotalOrderByStatus: StatusCountsDto;
  weeklyTotalOrderByStatus: StatusCountsDto;
  monthlyTotalOrderByStatus: StatusCountsDto;
  yearlyTotalOrderByStatus: StatusCountsDto;
  totalYearSaleByMonth: { total: number; month: string }[];
}

export interface CategoryWiseProductDto {
  category_id: number;
  category_name: string;
  shop_name: string;
  product_count: number;
}

/** Las 15 claves de `top-rate-product.json`, en su orden. */
export interface TopRateProductDto {
  id: number;
  name: string;
  slug: string;
  regular_price: number | null;
  sale_price: number | null;
  min_price: number | null;
  max_price: number | null;
  product_type: string;
  description: string;
  type_id: number;
  type_slug: string;
  total_rating: number;
  rating_count: number;
  actual_rating: number;
  image: unknown;
}

/** Las 13 primeras claves de `toShopDto`, las que embebe `low-stock-products.json`. */
const LOW_STOCK_SHOP_KEYS = [
  'id', 'owner_id', 'name', 'slug', 'description', 'cover_image', 'logo',
  'is_active', 'address', 'settings', 'notifications', 'created_at', 'updated_at',
];

function byStatus(counts: OrderStatusCounts): StatusCountsDto {
  const out = {} as StatusCountsDto;
  for (const [key, status] of Object.entries(STATUS_KEYS)) {
    out[key as keyof typeof STATUS_KEYS] = counts[status] ?? 0;
  }
  return out;
}

/** `limit` y `search=shop_id:N`; lo que no sea un entero positivo se ignora. */
function toListInput({ limit, search }: GetAnalyticsListDto): AnalyticsListInput {
  const positive = (value: string | undefined): number | undefined => {
    const n = Number(value);
    return Number.isSafeInteger(n) && n > 0 ? n : undefined;
  };
  const shopId = positive(parseSearch(search).shop_id);
  return { limit: positive(limit) ?? DEFAULT_LIMIT, ...(shopId !== undefined && { shopId }) };
}

/**
 * El `type` de `low-stock-products.json` (10 claves). `promotional_sliders`
 * sale `[]`, el tipo del mock, y no el `null` de `toTypeDto`; como allí,
 * `translated_languages` es constante.
 */
function toLowStockTypeDto(type: TypeRecord) {
  return {
    id: type.id,
    name: type.name,
    settings: type.settings,
    slug: type.slug,
    language: type.language,
    icon: type.icon,
    promotional_sliders: [],
    created_at: type.createdAt,
    updated_at: type.updatedAt,
    translated_languages: ['en'],
  };
}

/**
 * Las 45 claves de `low-stock-products.json`, en su orden. Los booleanos
 * salen `0/1` como en el mock; las claves sin columna, con su neutro.
 */
export function toLowStockProductDto(p: ProductRecord): Product {
  const shop = toShopDto(p.shop) as unknown as Record<string, unknown>;
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    type_id: p.typeId,
    price: p.price,
    shop_id: p.shopId,
    sale_price: p.salePrice,
    language: p.language,
    min_price: p.minPrice,
    max_price: p.maxPrice,
    sku: p.sku,
    quantity: p.quantity,
    sold_quantity: p.soldQuantity,
    in_stock: Number(p.inStock),
    is_taxable: Number(p.isTaxable),
    in_flash_sale: 0,
    shipping_class_id: null,
    status: p.status,
    product_type: p.productType,
    unit: p.unit,
    height: null,
    width: null,
    length: null,
    image: p.image,
    video: [],
    gallery: p.gallery,
    deleted_at: null,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
    author_id: null,
    manufacturer_id: p.manufacturerId,
    is_digital: Number(p.isDigital),
    is_external: Number(p.isExternal),
    external_product_url: p.externalProductUrl,
    external_product_button_text: null,
    blocked_dates: [],
    ratings: p.ratings,
    total_reviews: p.totalReviews,
    rating_count: [],
    my_review: null,
    in_wishlist: false,
    translated_languages: p.translatedLanguages,
    type: toLowStockTypeDto(p.type),
    shop: Object.fromEntries(LOW_STOCK_SHOP_KEYS.map((key) => [key, shop[key]])),
  } as unknown as Product;
}

/** El try envuelve solo la E/S: conexión caída ⇒ 503; cualquier otro fallo ⇒ 500. */
async function read<T>(io: () => Promise<T>): Promise<T> {
  try {
    return await io();
  } catch (error) {
    if (isPrismaConnectionError(error)) {
      throw new ServiceUnavailableException(getUserFriendlyMessage(error));
    }
    throw new InternalServerErrorException(getUserFriendlyMessage(error));
  }
}

/**
 * Dashboard del super admin calculado desde Postgres (US-61). Las
 * definiciones M-1..M-12 viven en `analytics.repository.ts`; aquí solo se
 * proyecta la forma de los 4 JSON del mock.
 */
@Injectable()
export class AnalyticsService {
  async findAll(): Promise<AnalyticsDto> {
    const a = await read(() => getDashboardAnalytics(now()));
    return {
      totalRevenue: a.totalRevenue,
      // M-2: no hay tabla de reembolsos (`refunds` es stub).
      totalRefunds: 0,
      totalShops: a.totalShops,
      totalVendors: a.totalVendors,
      todaysRevenue: a.todaysRevenue,
      totalOrders: a.totalOrders,
      newCustomers: a.newCustomers,
      todayTotalOrderByStatus: byStatus(a.ordersByStatus.today),
      weeklyTotalOrderByStatus: byStatus(a.ordersByStatus.weekly),
      monthlyTotalOrderByStatus: byStatus(a.ordersByStatus.monthly),
      yearlyTotalOrderByStatus: byStatus(a.ordersByStatus.yearly),
      totalYearSaleByMonth: a.salesByMonth.map((total, i) => ({ total, month: MONTHS[i] })),
    };
  }

  async findAllCategoryWiseProduct(query: GetAnalyticsListDto): Promise<CategoryWiseProductDto[]> {
    const rows = await read(() => listCategoryWiseProductCounts(toListInput(query)));
    return rows.map((row) => ({
      category_id: row.categoryId,
      category_name: row.categoryName,
      shop_name: row.shopName,
      product_count: row.productCount,
    }));
  }

  async findAllLowStockProducts(query: GetAnalyticsListDto): Promise<Product[]> {
    const rows = await read(() => listLowStockProducts(toListInput(query)));
    return rows.map(toLowStockProductDto);
  }

  async findAllTopRateProduct(query: GetAnalyticsListDto): Promise<TopRateProductDto[]> {
    const rows = await read(() => listTopRatedProducts(toListInput(query)));
    return rows.map(({ product: p, totalRating, ratingCount, actualRating }) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      regular_price: p.price,
      sale_price: p.salePrice,
      min_price: p.minPrice,
      max_price: p.maxPrice,
      product_type: p.productType,
      description: p.description,
      type_id: p.typeId,
      type_slug: p.type.slug,
      total_rating: totalRating,
      rating_count: ratingCount,
      actual_rating: actualRating,
      image: p.image,
    }));
  }
}
