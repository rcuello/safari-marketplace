import { CoreEntity } from '#src/common/entities/core.entity.js';
import { User } from '#src/users/entities/user.entity.js';

export class Report extends CoreEntity {
  user_id?: number;
  user: User[];
  model_id: number;
  model_type: string;
  message: string;
}
