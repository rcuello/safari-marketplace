import { Attachment } from '#src/common/entities/attachment.entity.js';
import { CoreEntity } from '#src/common/entities/core.entity.js';
import { Product } from '#src/products/entities/product.entity.js';
import { Type } from '#src/types/entities/type.entity.js';

export class Tag extends CoreEntity {
  name: string;
  slug: string;
  parent: number;
  details: string;
  image: Attachment;
  icon: string;
  type: Type;
  products: Product[];
  language: string;
  translated_languages: string[];
}
