import type { ProductRecord } from '@safari/db';
import { Product } from './entities/product.entity.js';

/**
 * `ProductRecord` (camelCase, `@safari/db`) → proyección de 20 claves
 * snake_case que ya publicaba `products.json`. `type.logo` e
 * `in_flash_sale` son constantes: no hay columna que los respalde
 * (divergencias documentadas en `design.md`). Se castea a `Product`, igual
 * que `settings.service.ts:39` — la entidad declara campos que este
 * listado no emite.
 */
export function toProductDto(record: ProductRecord): Product {
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
