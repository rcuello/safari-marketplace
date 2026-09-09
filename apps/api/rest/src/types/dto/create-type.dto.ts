import { PickType } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { Type } from '../entities/type.entity';

/**
 * `PickType` sobre la entidad (precedente `create-tag.dto.ts:4-11`).
 * `promotional_sliders` se declara y se ignora (no hay columna,
 * `schema.sql:90-101`): documenta que la API lo ACEPTA, no lo rechaza.
 *
 * `name` sobreescribe el campo heredado con `@IsString() @IsNotEmpty()`
 * (design.md, Decisión 7, capa 1): `ValidationPipe` corre sin `whitelist`
 * (`main.ts:9`, decisión 5 del épico) pero SÍ ejecuta los validadores de los
 * campos declarados, así que `POST {}` y `POST {"name":""}` responden 400
 * antes de tocar el servicio. `UpdateTypeDto` hereda esto vía `PartialType`
 * sin tocarse: `name` ausente sigue siendo un no-op legal en `PUT`, y
 * `name: ""` sigue validando a 400.
 */
export class CreateTypeDto extends PickType(Type, [
  'name',
  'slug',
  'icon',
  'banners',
  'promotional_sliders',
  'settings',
  'language',
]) {
  @IsString()
  @IsNotEmpty()
  name: string;
}
