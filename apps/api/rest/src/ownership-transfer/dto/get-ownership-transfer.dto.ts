import { SortOrder } from 'src/common/dto/generic-conditions.dto';
import { PaginationArgs } from 'src/common/dto/pagination-args.dto';
import { Paginator } from 'src/common/dto/paginator.dto';
import { OwnershipTransfer } from '../entities/ownership-transfer.entity';

export class RefundPolicyPaginator extends Paginator<OwnershipTransfer> {
  data: OwnershipTransfer[];
}

export class GetOwnershipTransferDto extends PaginationArgs {
  orderBy?: QueryReviewsOrderByColumn;
  sortedBy?: SortOrder;
  /** Solo se entiende `transaction_identifier:X` (exacto). */
  search?: string;
  /** Llega como string: no hay `transform` en el `ValidationPipe`. */
  shop_id?: string;
}

export enum QueryReviewsOrderByColumn {
  CREATED_AT = 'CREATED_AT',
  UPDATED_AT = 'UPDATED_AT',
  TITLE = 'TITLE',
  DESCRIPTION = 'DESCRIPTION',
}
