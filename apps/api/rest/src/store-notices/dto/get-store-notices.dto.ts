import { SortOrder } from '#src/common/dto/generic-conditions.dto.js';
import { PaginationArgs } from '#src/common/dto/pagination-args.dto.js';
import { Paginator } from '#src/common/dto/paginator.dto.js';
import { StoreNotice } from '../entities/store-notices.entity.js';

export class StoreNoticePaginator extends Paginator<StoreNotice> {
  data: StoreNotice[];
}

export class GetStoreNoticesDto extends PaginationArgs {
  orderBy?: QueryStoreNoticesOrderByColumn;
  sortedBy?: SortOrder;
  search?: string;
  language?: string;
  /** El shop lo manda como query además de dentro de `search`. */
  shop_id?: string;
}

export enum QueryStoreNoticesOrderByColumn {
  NOTICE = 'NOTICE',
  DESCRIPTION = 'DESCRIPTION',
  TYPE = 'TYPE',
  PRIORITY = 'PRIORITY',
  EXPIRE_AT = 'EXPIRE_AT',
}
