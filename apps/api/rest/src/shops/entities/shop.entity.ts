import { UserAddress } from '#src/addresses/entities/address.entity.js';
import { Attachment } from '#src/common/entities/attachment.entity.js';
import { CoreEntity } from '#src/common/entities/core.entity.js';
import {
  Location,
  ShopSocials,
} from '#src/settings/entities/setting.entity.js';
import { User } from '#src/users/entities/user.entity.js';

export class Shop extends CoreEntity {
  owner_id: number;
  owner: User;
  staffs?: User[];
  is_active: boolean;
  orders_count: number;
  products_count: number;
  balance?: Balance;
  name: string;
  slug: string;
  description?: string;
  cover_image: Attachment;
  logo?: Attachment;
  address: UserAddress;
  settings?: ShopSettings;
  distance?: string;
  lat?: string;
  lng?: string;
}

export class Balance {
  id: number;
  admin_commission_rate: number;
  shop: Shop;
  total_earnings: number;
  withdrawn_amount: number;
  current_balance: number;
  payment_info: PaymentInfo;
}

export class PaymentInfo {
  account: string;
  name: string;
  email: string;
  bank: string;
}

export class ShopSettings {
  socials: ShopSocials[];
  contact: string;
  location: Location;
  website: string;
}
