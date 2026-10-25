import { SortOrder } from '#src/common/dto/generic-conditions.dto.js';
import { PaginationArgs } from '#src/common/dto/pagination-args.dto.js';
import { Paginator } from '#src/common/dto/paginator.dto.js';

import { OrderStatus } from '../entities/order-status.entity.js';

export class OrderStatusPaginator extends Paginator<OrderStatus> {
  data: OrderStatus[];
}

export class GetOrderStatusesDto extends PaginationArgs {
  orderBy?: QueryOrderStatusesOrderByColumn;
  sortedBy?: SortOrder;
  search?: string;
  language?: string;
}

export enum QueryOrderStatusesOrderByColumn {
  CREATED_AT = 'CREATED_AT',
  NAME = 'NAME',
  UPDATED_AT = 'UPDATED_AT',
  SERIAL = 'SERIAL',
}
