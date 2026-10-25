import { CoreEntity } from '#src/common/entities/core.entity.js';

export class Attachment extends CoreEntity {
  thumbnail?: string;
  original?: string;
}
