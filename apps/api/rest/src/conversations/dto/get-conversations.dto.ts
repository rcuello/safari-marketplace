import { SortOrder } from '#src/common/dto/generic-conditions.dto.js';
import { PaginationArgs } from '#src/common/dto/pagination-args.dto.js';
import { Paginator } from '#src/common/dto/paginator.dto.js';
import { Conversation } from '../entities/conversation.entity.js';

export class ConversationPaginator extends Paginator<Conversation> {
  data: Conversation[];
}

export class GetConversationsDto extends PaginationArgs {
  orderBy?: string;
  sortedBy?: SortOrder;
  search?: string;
  language?: string;
}
