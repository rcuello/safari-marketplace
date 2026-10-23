import { CoreEntity } from 'src/common/entities/core.entity';
import { Shop } from 'src/shops/entities/shop.entity';
import { User } from 'src/users/entities/user.entity';

export enum StoreNoticePriorityType {
  High = 'high',
  Medium = 'medium',
  Low = 'low',
}

export class StoreNotice extends CoreEntity {
  priority: StoreNoticePriorityType;
  notice: string;
  description?: string;
  effective_from?: string;
  expired_at: string;
  type?: string;
  is_read?: boolean;
  shops?: Shop[];
  users?: User[];
  received_by?: string;
  created_by: string;
  updated_by?: string;
  expire_at: string;
  deleted_at?: string;
  creator?: any;
  /** Permiso más alto del creador, en texto (`"Super admin"`). */
  creator_role?: string;
  /** Estado de lectura de cada destinatario, con `pivot.is_read` entero. */
  read_status?: User[];
  translated_languages: string[];
}
