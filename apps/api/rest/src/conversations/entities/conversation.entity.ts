import { CoreEntity } from '#src/common/entities/core.entity.js';
import { Shop } from '#src/shops/entities/shop.entity.js';
import { User } from '#src/users/entities/user.entity.js';

export class LatestMessage extends CoreEntity {
  body: string;
  conversation_id: string;
  user_id: string;
}

export class Conversation extends CoreEntity {
  shop_id: number;
  unseen: boolean;
  user_id: string;
  user: User;
  shop: Shop;
  latest_message: LatestMessage;
}
