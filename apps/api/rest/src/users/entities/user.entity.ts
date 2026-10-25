import { Address } from '#src/addresses/entities/address.entity.js';
import { CoreEntity } from '#src/common/entities/core.entity.js';
// import { Order } from '#src/orders/entities/order.entity.js';
import { Shop } from '#src/shops/entities/shop.entity.js';
import { Profile } from './profile.entity.js';

export class User extends CoreEntity {
  name: string;
  email: string;
  password?: string;
  profile?: Profile;
  shops?: Shop[];
  managed_shop?: Shop;
  is_active?: boolean = true;
  address?: Address[];
  permissions?: Permission[];
  // orders?: Order[];
  wallet?: any;
}

export class Permission extends CoreEntity {
  name?: string;
  guard_name?: string;
  pivot?: any;
}
