import { SortOrder } from '#src/common/dto/generic-conditions.dto.js';
import { PaginationArgs } from '#src/common/dto/pagination-args.dto.js';
import { Paginator } from '#src/common/dto/paginator.dto.js';

import { Coupon } from '../entities/coupon.entity.js';

export class CouponPaginator extends Paginator<Coupon> {
  data: Coupon[];
}

export class GetCouponsDto extends PaginationArgs {
  orderBy?: QueryCouponsOrderByColumn;
  sortedBy?: SortOrder;
  search?: string;
  shop_id?: number;
  language?: string;
}

export enum QueryCouponsOrderByColumn {
  CREATED_AT = 'created_at',
  EXPIRE_AT = 'expire_at',
  ID = 'id',
  CODE = 'code',
  AMOUNT = 'amount',
  NAME = 'title',
  DESCRIPTION = 'description',
  MINIMUM_CART_AMOUNT = 'minimum_cart_amount',
  IS_APPROVE = 'is_approve',
  TYPE = 'type',
}
