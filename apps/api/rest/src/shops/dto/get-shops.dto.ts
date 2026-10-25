import { PaginationArgs } from '#src/common/dto/pagination-args.dto.js';

import { Paginator } from '#src/common/dto/paginator.dto.js';
import { Shop } from '../entities/shop.entity.js';

export class ShopPaginator extends Paginator<Shop> {
  data: Shop[];
}

export class GetShopsDto extends PaginationArgs {
  orderBy?: string;
  search?: string;
  sortedBy?: string;
  is_active?: boolean;
}
