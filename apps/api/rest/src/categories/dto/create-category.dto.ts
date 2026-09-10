import { PickType } from '@nestjs/swagger';
import { Category } from '../entities/category.entity';

/**
 * `'type'` y `'parent'` salen del `PickType` porque `Category`
 * (`entities/category.entity.ts:9,14`) los declara como objetos y el admin
 * manda números (`category-form.tsx:234-235`). `type_id`/`parent`/`slug` se
 * declaran standalone, sin efecto de runtime: `main.ts:9` registra
 * `ValidationPipe` sin `transform` ni `whitelist` (DD28-9, design.md). No se
 * añade soporte de objetos anidados (fuera de alcance, vinculante).
 */
export class CreateCategoryDto extends PickType(Category, [
  'name',
  'details',
  'icon',
  'image',
  'language',
]) {
  type_id: number;
  parent?: number | null;
  slug?: string;
}
