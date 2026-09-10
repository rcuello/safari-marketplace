import { PickType } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { Tag } from '../entities/tag.entity';

/**
 * `PickType` sobre la entidad (precedente `create-type.dto.ts:18-26`).
 * `type` sale del `PickType` y se reemplaza por `type_id` standalone
 * (`D27b-1`, cerrada): el admin manda el id de la FK, no el objeto
 * embebido que solo la lectura resuelve. `slug` se añade al `PickType`
 * porque la decisión 4 del épico es vinculante sobre el slug que el
 * cliente envíe si lo envía (design.md, DD-9), y `tag-form.tsx` lo manda.
 *
 * `name` sobreescribe el campo heredado con `@IsString() @IsNotEmpty()`
 * (design.md, DD-9, capa 1): `ValidationPipe` corre sin `whitelist`
 * (`main.ts:9`, decisión 5 del épico) pero SÍ ejecuta los validadores de
 * los campos declarados, así que `POST {}` y `POST {"name":""}` responden
 * 400 antes de tocar el servicio. `UpdateTagDto` hereda esto vía
 * `PartialType` sin tocarse: `name` ausente sigue siendo un no-op legal en
 * `PUT`, y `name: ""` sigue validando a 400.
 */
export class CreateTagDto extends PickType(Tag, [
  'name',
  'slug',
  'details',
  'image',
  'icon',
  'language',
]) {
  @IsString()
  @IsNotEmpty()
  name: string;

  type_id?: number;
}
