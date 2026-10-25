import { SortOrder } from '#src/common/dto/generic-conditions.dto.js';
import { PaginationArgs } from '#src/common/dto/pagination-args.dto.js';
import { Paginator } from '#src/common/dto/paginator.dto.js';
import { Faq } from '#src/faqs/entities/faq.entity.js';

export class FaqPaginator extends Paginator<Faq> {
  data: Faq[];
}

export class GetFaqsDto extends PaginationArgs {
  orderBy?: QueryReviewsOrderByColumn;
  sortedBy?: SortOrder;
  search?: string;
  faq_type?: string;
  shop_id?: number;
  issued_by?: string;
}

export enum QueryReviewsOrderByColumn {
  CREATED_AT = 'CREATED_AT',
  UPDATED_AT = 'UPDATED_AT',
  FAQ_TITLE = 'FAQ_TITLE',
  FAQ_DESCRIPTION = 'FAQ_DESCRIPTION',
}
