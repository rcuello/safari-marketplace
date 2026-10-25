import { PaginationArgs } from '#src/common/dto/pagination-args.dto.js';
import { Paginator } from '#src/common/dto/paginator.dto.js';
import { Withdraw } from '../entities/withdraw.entity.js';

export class WithdrawPaginator extends Paginator<Withdraw> {
  data: Withdraw[];
}

export class GetWithdrawsDto extends PaginationArgs {
  orderBy?: string;
  sortedBy?: string;
  status?: string;
  /** Llega como string: no hay `transform` en el `ValidationPipe`. */
  shop_id?: string;
  /** Solo se entiende `shop_id:N`; el `shop_id` de la query gana. */
  search?: string;
}
