import { PickType } from '@nestjs/swagger';
import { Attribute } from '../entities/attribute.entity.js';

/**
 * Lo que envía el admin (`attribute-form.tsx:64-97`): al crear, valores sin
 * `id`; al editar, `id: Number(id)`, que en un valor nuevo llega como `null`.
 */
export class CreateAttributeDto extends PickType(Attribute, [
  'name',
  'shop_id',
  'slug',
  'language',
]) {
  values: AttributeValueDto[];
}

export class AttributeValueDto {
  id?: number | null;
  value: string;
  meta?: string;
  language?: string;
}
