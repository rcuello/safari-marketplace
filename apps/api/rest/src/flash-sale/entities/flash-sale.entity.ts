import { Attachment } from '#src/common/entities/attachment.entity.js';
import { CoreEntity } from '#src/common/entities/core.entity.js';
import { Product } from '#src/products/entities/product.entity.js';

export class FlashSale extends CoreEntity {
  title: string;
  slug: string;
  description: string;
  start_date: string;
  end_date: string;
  image?: Attachment;
  cover_image?: Attachment;
  type: string;
  rate: string;
  sale_status: boolean;
  sale_builder: any;
  language: string;
  translated_languages: string[];
  products: Product[];
  deleted_at?: string;
}
