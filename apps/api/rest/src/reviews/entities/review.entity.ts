import { CoreEntity } from '#src/common/entities/core.entity.js';
import { Order } from '#src/orders/entities/order.entity.js';
import { Shop } from '#src/shops/entities/shop.entity.js';
import { User } from '#src/users/entities/user.entity.js';
import { Product } from '#src/products/entities/product.entity.js';
import { Attachment } from '#src/common/entities/attachment.entity.js';
import { Report } from './reports.entity.js';
import { Feedback } from '#src/feedbacks/entities/feedback.entity.js';

export class Review extends CoreEntity {
  rating: number;
  name: string;
  comment: string;
  shop: Shop;
  order: Order;
  customer: User;
  photos: Attachment[];
  user: User;
  product: Product;
  feedbacks: Feedback[];
  my_feedback: Feedback;
  positive_feedbacks_count: number;
  negative_feedbacks_count: number;
  user_id: number;
  product_id: number;
  abusive_reports: Report[];
  shop_id: string;
  variation_option_id: string;
  abusive_reports_count?: number;
}
