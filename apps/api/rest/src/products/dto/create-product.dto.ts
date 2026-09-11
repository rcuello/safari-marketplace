import { OmitType } from '@nestjs/swagger';
import { Product } from '../entities/product.entity';

/**
 * `manufacturer_id` es el único campo genuinamente ausente del `Product`
 * heredado (`type_id`/`shop_id` ya llegan vía `OmitType`, porque la entidad
 * los declara y la lista de exclusión no los nombra — hueco H2 de
 * `design.md`). Standalone, no vía `OmitType`: no hay `manufacturer_id` en
 * `Product` que excluir.
 *
 * Campos que este DTO ACEPTA pero `products.service.ts` DESCARTA en
 * silencio, campo a campo (`R29-6`, `CA-7` de `product-write-api`): no hay
 * columna que los respalde en `products` — `variations`, `variation_options`
 * (tablas de atributos, fuera de alcance), `author_id` (no existe en
 * `Product`, pero llega si el cliente lo manda igual), `digital_file`
 * (idéntico caso), `height`/`length`/`width` (columnas no modeladas por
 * `db/schema.sql`), `in_flash_sale` (constante `0` en la proyección de
 * lectura, `toProductDto:147`).
 */
export class CreateProductDto extends OmitType(Product, [
  'id',
  'slug',
  'created_at',
  'updated_at',
  'orders',
  'pivot',
  'shop',
  'categories',
  'tags',
  'type',
  'related_products',
  // 'variation_options',
  'translated_languages',
]) {
  categories: number[];
  tags: number[];
  manufacturer_id?: number;
}
