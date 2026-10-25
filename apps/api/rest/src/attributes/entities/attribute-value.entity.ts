import { CoreEntity } from '#src/common/entities/core.entity.js';
import { Attribute } from './attribute.entity.js';

export class AttributeValue extends CoreEntity {
  shop_id: number;
  value: string;
  meta?: string;
  attribute: Attribute;
}
