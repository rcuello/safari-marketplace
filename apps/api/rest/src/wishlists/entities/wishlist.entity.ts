import { CoreEntity } from '#src/common/entities/core.entity.js';
import { Product } from '#src/products/entities/product.entity.js';
import { User } from '#src/users/entities/user.entity.js';

export class Wishlist extends CoreEntity {
  product: Product;
  product_id: string;
  user: User[];
  user_id: string;
}
