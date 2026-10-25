import { Attachment } from '#src/common/entities/attachment.entity.js';
import { CoreEntity } from '#src/common/entities/core.entity.js';
import { User } from './user.entity.js';

export class Profile extends CoreEntity {
  avatar?: Attachment;
  bio?: string;
  socials?: Social[];
  contact?: string;
  customer?: User;
}

export class Social {
  type: string;
  link: string;
}
