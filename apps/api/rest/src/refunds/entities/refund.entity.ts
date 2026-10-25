import { CoreEntity } from '#src/common/entities/core.entity.js';
import { Order } from '#src/orders/entities/order.entity.js';
import { Shop } from '#src/shops/entities/shop.entity.js';
import { User } from '#src/users/entities/user.entity.js';

export enum RefundStatus {
  APPROVED = 'Approved',
  PENDING = 'Pending',
  REJECTED = 'Rejected',
  PROCESSING = 'Processing',
}

export class Refund extends CoreEntity {
  amount: string;
  status: RefundStatus;
  shop: Shop;
  order: Order;
  customer: User;
}
