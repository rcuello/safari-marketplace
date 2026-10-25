import { AttributeValue } from '#src/attributes/entities/attribute-value.entity.js';
import { Category } from '#src/categories/entities/category.entity.js';
import { Attachment } from '#src/common/entities/attachment.entity.js';
import { CoreEntity } from '#src/common/entities/core.entity.js';
import { Order } from '#src/orders/entities/order.entity.js';
import { Shop } from '#src/shops/entities/shop.entity.js';
import { Tag } from '#src/tags/entities/tag.entity.js';
import { Type } from '#src/types/entities/type.entity.js';
import { Review } from '../../reviews/entities/review.entity.js';

enum ProductStatus {
  PUBLISH = 'publish',
  DRAFT = 'draft',
}

enum ProductType {
  SIMPLE = 'simple',
  VARIABLE = 'variable',
}

export class Product extends CoreEntity {
  name: string;
  slug: string;
  type: Type;
  type_id: number;
  product_type: ProductType;
  categories: Category[];
  tags?: Tag[];
  variations?: AttributeValue[];
  variation_options?: Variation[];
  pivot?: OrderProductPivot;
  orders?: Order[];
  shop: Shop;
  shop_id: number;
  related_products?: Product[];
  description: string;
  in_stock: boolean;
  is_taxable: boolean;
  sale_price?: number;
  max_price?: number;
  min_price?: number;
  sku?: string;
  gallery?: Attachment[];
  image?: Attachment;
  status: ProductStatus;
  height?: string;
  length?: string;
  width?: string;
  price?: number;
  quantity: number;
  unit: string;
  ratings: number;
  in_wishlist: boolean;
  my_review?: Review[];
  language?: string;
  translated_languages?: string[];
  visibility?: string;
}

export class OrderProductPivot {
  variation_option_id?: number;
  order_quantity: number;
  unit_price: number;
  subtotal: number;
}

export class Variation {
  id: number;
  title: string;
  price: number;
  sku: string;
  is_disable: boolean;
  sale_price?: number;
  quantity: number;
  options: VariationOption[];
}

export class VariationOption {
  name: string;
  value: string;
}

export class File extends CoreEntity {
  attachment_id: number;
  url: string;
  fileable_id: number;
}
