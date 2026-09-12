import { PickType } from '@nestjs/swagger';
import { Shop } from '../entities/shop.entity';

/**
 * `ShopsService.create`/`update` (US-30) construyen `CreateShopInput`/
 * `UpdateShopInput` campo a campo desde este DTO — nunca `...dto`
 * (`R30-7`). `main.ts:9` registra `ValidationPipe` sin `whitelist` ni
 * `transform`: esta clase NO filtra nada en runtime, solo documenta en
 * Swagger. Campos aceptados y persistidos: `name`, `description`,
 * `address`, `settings`, `logo`, `cover_image`. `owner_id`/`is_active`
 * NUNCA se leen del body aunque llegaran (`DD30-2`): `owner_id` sale del
 * token y `is_active` se decide por rol, para que un `PUT` no pueda
 * auto-aprobar la tienda esquivando `approve-shop`. `balance` y
 * `categories: number[]` se aceptan y se descartan sin 400 — sin columna
 * que los respalde (Out of Scope del spec).
 */
export class CreateShopDto extends PickType(Shop, [
  'name',
  'address',
  'description',
  'cover_image',
  'logo',
  'settings',
  'balance',
]) {
  categories: number[];
}

export class ApproveShopDto {
  id: number;
  admin_commission_rate: number;
}
