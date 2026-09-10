import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { OmitType } from '@nestjs/swagger';
import { Manufacturer } from '../entities/manufacturer.entity';

/**
 * `OmitType` sobre la entidad (design.md, DD-9): a diferencia de
 * `create-tag.dto.ts` (que usa `PickType`), aquí se parte de la lista
 * negativa porque la US deja de omitir `name`, `description`, `website`,
 * `image`, `type_id`, `socials`, `cover_image` y `slug` — todos campos
 * reales que el admin envía (`manufacturer-form.tsx:184-218`). Sigue
 * omitiendo `id`, `products_count`, `type` y `translated_languages` (sin
 * columna o resueltos por el servicio) y AÑADE `created_at`/`updated_at`
 * a la lista (N-9): `Manufacturer extends CoreEntity` y sin este añadido
 * el schema Swagger del body documentaría dos timestamps que fija el
 * servidor.
 *
 * `name` sobreescribe el campo heredado con `@IsString() @IsNotEmpty()`
 * (capa 1, mismo criterio que `create-tag.dto.ts`/`create-type.dto.ts`):
 * `ValidationPipe` corre sin `whitelist` (`main.ts:9`) pero SÍ ejecuta los
 * validadores de los campos declarados, así que `POST {}` y
 * `POST {"name":""}` responden 400 antes de tocar el servicio.
 *
 * `is_approved` añade `@IsOptional() @IsBoolean()` (DD-6/N-2): sin
 * `transform` en `ValidationPipe`, `Boolean("false") === true` — una
 * cadena colaría un `true` en silencio. `@IsOptional()` es obligatorio:
 * el campo es legítimamente omitible (`DEFAULT true`); sin él,
 * `POST {"name":"X"}` fallaría y rompería CA-1.
 *
 * `shop_id` se conserva standalone: sin columna, se acepta y se ignora
 * (V-3) — `manufacturer-form.tsx` solo lo envía en create.
 */
export class CreateManufacturerDto extends OmitType(Manufacturer, [
  'id',
  'created_at',
  'updated_at',
  'products_count',
  'type',
  'translated_languages',
]) {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsBoolean()
  is_approved?: boolean;

  shop_id?: string;
}
