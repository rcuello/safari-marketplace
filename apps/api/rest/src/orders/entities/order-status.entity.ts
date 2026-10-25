import { CoreEntity } from '#src/common/entities/core.entity.js';

export class OrderStatus extends CoreEntity {
  name: string;
  color: string;
  serial: number;
  slug: string;
  language: string;
  translated_languages: string[];
}
