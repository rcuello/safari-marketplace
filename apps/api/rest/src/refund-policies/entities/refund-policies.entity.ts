import { CoreEntity } from '#src/common/entities/core.entity.js';
import { Refund } from '#src/refunds/entities/refund.entity.js';
import { Shop } from '#src/shops/entities/shop.entity.js';

export class RefundPolicy extends CoreEntity {
  title: string;
  slug: string;
  target: string;
  status: string;
  description?: string;
  language: string;
  shop_id?: string;
  shop?: Shop;
  refunds?: Refund[];
  translated_languages: Array<string>;
  deleted_at?: string;
}
