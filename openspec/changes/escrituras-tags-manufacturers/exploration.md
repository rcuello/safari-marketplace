# Exploration: Escrituras de `tags` y `manufacturers` (US-27b)

> Re-verificación contra código real (2026-09-10) de los hallazgos de
> `tags`/`manufacturers` retenidos en la exploración archivada de US-27a
> (`openspec/changes/archive/2026-09-10-escrituras-types-fundaciones/exploration.md`).
> No se re-derivan: se confirman línea a línea y se añade lo que solo
> US-27b puede ejercitar (FK real, borrado sin cascada, DTOs de `tags`).

## Current State

### 1. Los stubs de `tags`/`manufacturers` — SIN DRIFT, línea a línea

`apps/api/rest/src/tags/tags.service.ts` (138 líneas hoy):
- `create()` L67-72: `{ id: this.tags.length + 1, ...createTagDto }` — no persiste. Coincide con la US (`:67-72`).
- `update()` L131-133: `return this.tags[0]`. Coincide (`:131-133`).
- `remove()` L135-137: `return \`This action removes a #${id} tag\`;`. Coincide (`:135-137`).
- Import `@db/tags.json` L22, `Fuse` importado L24 e instanciado L33 (sin uso funcional). Coincide.
- `toTagDto` (L43-61): **9 claves exactas y en este orden** — `id, name, language, translated_languages, slug, details, image, icon, type`. `type` se resuelve contra `Map<number, TypeRecord>` construido desde `listTypes()` (L96, L127) — igual que predice el D-6 del épico.

`apps/api/rest/src/manufacturers/manufacturers.service.ts` (183 líneas hoy):
- `create()` L76-78: `return this.manufacturers[0]`. Coincide (`:76-78`).
- `update()` L171-178: `manufacturer.is_approved = updateManufacturesDto.is_approved ?? true; return manufacturer;` — **muta el array en memoria**, confirmado literal. Coincide (`:171-178`).
- `remove()` L180-182: `return \`This action removes a #${id} product\`;` — el "sic" de la US es correcto, dice "product" no "manufacturer". Coincide (`:180-182`).
- Import `@db/manufacturers.json` L8, `Fuse` importado L10 e instanciado L38. Coincide.
- `toManufacturerDto` (L48-70): **13 claves exactas y en este orden** — `id, name, slug, language, translated_languages, products_count, is_approved, description, website, socials, image, cover_image, type`. `is_approved: Number(record.isApproved)` en **L60 exacta**. `products_count: 0`, `socials: []`, `cover_image: null`, `language: 'en'` son constantes (sin columna que las respalde para `socials`/`cover_image`).

**Veredicto de drift: ninguno.** Los cambios que US-27a sí introdujo (`slug.ts`, `domain-errors.ts`, el mapper de errores, `types.repository.ts`/`types.service.ts`) no tocaron ni un byte de `tags`/`manufacturers` — confirmado que ambos archivos importan `@safari/db` solo para lecturas (`findTagBySlug`, `listTags`, `listTypes`, `isPrismaConnectionError`, `getUserFriendlyMessage`, y sus equivalentes de manufacturers), cero símbolos de escritura.

### 2. Las piezas compartidas, leídas como consumidor — CA-7 es alcanzable con solo call-sites

Firmas reales verificadas en código (no en el design, en el archivo):

```ts
// packages/db/src/slug.ts
export interface SlugSource { name: string; slug?: string | null }
export type ExistingSlugLookup = (prefix: string) => Promise<string[]>;
export async function normalizeSlug(text: string, aggregate: string): Promise<string>;
export async function generateSlug(source: SlugSource, findExistingWithPrefix: ExistingSlugLookup, aggregate: string): Promise<string>;

// packages/db/src/domain-errors.ts
export const CATALOG_ERROR_CODES = { EmptySlug, InvalidReference, RecordNotFound, DependentRows, SlugConflict } as const;
export abstract class CatalogWriteError extends Error { abstract readonly code; readonly aggregate: string; }
export class EmptySlugError(aggregate, source)
export class InvalidReferenceError(aggregate, field, value?)
export class RecordNotFoundError(aggregate, id)
export class DependentRowsError(aggregate, counts: Record<string, number>)
export class SlugConflictError(aggregate, slug)
export function isCatalogWriteError(error): error is CatalogWriteError   // guard estructural por `code`
export function translateCatalogWriteError(error, { aggregate, id?, uniqueField? }): unknown

// apps/api/rest/src/common/errors/domain-error.mapper.ts
export function mapDomainError(error): HttpException | null;   // switch por code, 400/404/409
export function toWriteHttpException(error): HttpException;    // + 503 (isConnectionFailure local) + 500 literal
```

Ninguno de los tres archivos contiene un literal `'types'`, `'tags'` ni `if (aggregate === …)` — confirmado por lectura completa (no solo grep de la palabra). `translateCatalogWriteError` recibe `{aggregate, id, uniqueField}` por **parámetro**, así que `tags.repository.ts`/`manufacturers.repository.ts` solo necesitan:

```ts
const tagSlugs: ExistingSlugLookup = async (prefix) =>
  (await prisma.tag.findMany({ where: { slug: { startsWith: prefix } }, select: { slug: true } })).map(r => r.slug);
// ... generateSlug({...}, tagSlugs, 'tags') / translateCatalogWriteError(e, { aggregate: 'tags', id, uniqueField: 'slug' })
```

exactamente el patrón que `types.repository.ts` ya demuestra (L58-64, L83-108, L119-147, L158-182). El servicio de Nest replica `catch (error) { throw toWriteHttpException(error); }` sin más.

**Verdicto: CA-7 es genuinamente alcanzable con call-sites únicamente.** No encontré ningún punto donde `tags`/`manufacturers` fuercen una edición de los tres archivos compartidos. El único candidato a "casi forzar" una edición es la resolución del campo en `InvalidReferenceError` para P2003 (ver punto 3) — pero **no** requiere tocar el archivo compartido: el defecto (si lo hay) vive en la calidad del mensaje, no en la necesidad de una rama por agregado.

### 3. `InvalidReference` (P2003) — el camino que `types` nunca pudo ejercitar

`tags.type_id` (`db/schema.sql:302`) y `manufacturers.type_id` (`:288`) son FK reales `REFERENCES types(id) ON DELETE SET NULL` — confirmado línea por línea:
```
288:    type_id      bigint       REFERENCES types(id) ON DELETE SET NULL,   -- manufacturers
302:    type_id     bigint       REFERENCES types(id) ON DELETE SET NULL,    -- tags
```
`types` no tiene FK saliente, así que `translateCatalogWriteError`'s rama P2003 nunca corrió contra un error real de Postgres — solo estaba probada con un fixture unitario (`domain-error.mapper.spec.ts`, y de hecho ni siquiera ahí: ese spec prueba los 5 **códigos de dominio ya traducidos**, no la traducción P2003 → dominio en sí). US-27b, con `POST /tags {"type_id": 99999}`, es el **primer productor real** de este camino sobre HTTP.

**Hallazgo heredado y confirmado (no derivado por mí): `verify-report.md` de US-27a ya documentó esto como `S-1`** (líneas 203-210 del archivo): la rama P2003 de `translateCatalogWriteError` (`domain-errors.ts:150-156`) lee `prismaError.meta?.field_name` y, si Prisma no lo trae, cae a `context.uniqueField` — que **semánticamente es el campo único (`slug`), no el campo de la FK (`type_id`)**. Si ese fallback dispara, el mensaje del 400 saldría como `` `tags.slug` referencia un registro inexistente `` en vez de `` `tags.type_id` referencia un registro inexistente ``. `apply-progress.md` (líneas 133-143) confirma que esta resolución de campo es "una implementación que el design describe solo vagamente" y que el call site real de P2002 (`types.repository.ts`) nunca pasó el valor real, solo `uniqueField`.

**Lo que US-27b puede probar por primera vez que US-27a no pudo:**
- Si el Prisma real (7 + `@prisma/adapter-pg`) sí trae `meta.field_name` con el nombre limpio de la columna (`"type_id"`) o con el nombre del constraint (`"tags_type_id_fkey"` o similar) — esto es una pregunta **empírica**, no deducible por lectura de código (confirmé por grep en `node_modules/@prisma/client/runtime/*.js` que el shape de metadata no es legible desde el bundle minificado). No se puede verificar sin escribir contra la base (violaría la restricción read-only de esta exploración), así que queda como el primer punto de verificación en `sdd-apply`/`sdd-verify`: `POST /api/tags {"type_id": 99999}` y observar el mensaje real.
- Si el fallback dispara y el mensaje sale engañoso, **no bloquea CA-4** (sigue siendo 400, no 500) ni CA-7 (no exige tocar el archivo compartido — el call site puede pasar un `uniqueField` distinto, pero no hay un parámetro para "el campo de la FK que se espera violar" porque eso solo se sabe si Prisma lo informa). Es un defecto de calidad de mensaje, no de contrato.

### 4. Borrados NO cascadean — confirmado en el DDL y con datos reales de la base sembrada

```
288:    type_id      bigint       REFERENCES types(id) ON DELETE SET NULL,   -- manufacturers.type_id
302:    type_id     bigint       REFERENCES types(id) ON DELETE SET NULL,    -- tags.type_id
333:    manufacturer_id   bigint  REFERENCES manufacturers(id) ON DELETE SET NULL,  -- products.manufacturer_id
425:CREATE TABLE IF NOT EXISTS category_product ( ... ON DELETE CASCADE ... )  -- no aplica a tags/manufacturers
431:CREATE TABLE IF NOT EXISTS product_tag ( product_id ... ON DELETE CASCADE, tag_id ... REFERENCES tags(id) ON DELETE CASCADE )
```
`product_tag.tag_id` es `ON DELETE CASCADE` hacia `tags`, no hacia `products` — o sea, borrar un `tag` sí hace que Postgres borre automáticamente las filas de `product_tag` que lo referencian (no hace falta que el repositorio las borre a mano); borrar un `product` también cascadea sobre `product_tag`, pero eso es irrelevante aquí. En ningún caso un producto se borra. Confirmado: **ningún borrado protegido (409) hace falta en esta US**, a diferencia de `types`.

**Conteos reales medidos contra la base sembrada (`safari-postgres`, healthy, 5433) — importante para la DoD:**
```
manufacturers: 14 filas
tags: 10 filas
types: 10 filas
products.manufacturer_id IS NOT NULL: 0
product_tag (total de filas): 0
products.type_id IS NOT NULL: 1200 (todas)
```
**Hallazgo no anticipado por la US ni por el épico:** el seed **no vincula ningún producto a ninguna marca ni a ningún tag** (`manufacturer_id` es `NULL` en las 1200 filas y `product_tag` está vacía — coherente con `category_product` vacía "a propósito" que ya documenta `db/README.md`, pero el épico no lo dice explícitamente para `manufacturer_id`/`product_tag`). Consecuencia directa para la DoD de CA-3 ("Given una marca con productos asociados"): **ese escenario no se puede demostrar contra el seed tal cual está** — hace falta vincular manualmente un producto a una marca (y un producto a un tag) por `psql` antes de la evidencia de `DELETE`, ya que `products`/`product_tag` no son escritura de esta US (son US-29). Esto no bloquea la US, pero el agente de `sdd-apply` necesita saberlo de antemano para no perder tiempo buscando una marca "con productos" que no existe en el seed, y para que el reporte declare el `UPDATE`/`INSERT` manual de preparación como parte de la evidencia, no como un efecto de la US.

### 5. `findOrCreateManufacturerBySlug` — confirmado que no se toca, y un hallazgo adyacente

`manufacturers.repository.ts` (71 líneas hoy): `listManufacturers` (L21-42), `findManufacturerBySlug` (L45-50), `findOrCreateManufacturerBySlug` (L56-71) — un `prisma.manufacturer.upsert({ where: { slug }, create: {...}, update: {} })`. Coexiste en el mismo archivo con las lecturas; los nuevos `createManufacturer`/`updateManufacturer`/`deleteManufacturer` se añadirían como funciones nuevas en el mismo archivo, igual que `types.repository.ts` demuestra (lecturas L34-48, escrituras L58-182, mismo archivo, sin conflicto).

**Hallazgo adyacente (no accionable, fuera de alcance):** `findOrCreateManufacturerBySlug` **no tiene ningún call site en TypeScript hoy** — confirmado con grep sobre `apps/api/rest/src`, `apps/admin/rest/src`, `packages/db/src` y el barrel: el único lugar que lo menciona además de su propia definición es el `export` de `packages/db/index.ts:71`. `upsertScrapedProduct` (`products.repository.ts`) recibe `manufacturerId` ya resuelto como número, no llama a este helper. Como el scraper migró a Python + `psycopg` (no consume `@safari/db`, per `CLAUDE.md`), esta función es hoy código muerto en términos de ejecución real, a pesar de que su comentario de cabecera dice "destino natural del campo `marca` del scraper, que las crea en runtime". No lo toca esta US (fuera de scope explícito), pero es una desviación de hecho respecto a lo que el comentario del archivo afirma — vale la pena mencionarlo en el reporte de `sdd-apply`, no accionarlo.

### 6. Payloads del admin — confirmados sin drift

`manufacturer-list.tsx:134-142` (toggle de aprobación), líneas verificadas:
```ts
updateManufacturer({
  id: record?.id,
  name: record?.name,
  is_approved: !is_approved,
  type_id: record?.type.id,
  language: locale,
});
```
Confirma la US **literalmente**: NO es un patch parcial, envía `{id, name, is_approved, type_id, language}` tomado del propio `record`. `updateManufacturer` no necesita partial update.

`tag-form.tsx` (`onSubmit`, ~L162-190): `language, name, slug, details, image{thumbnail,original,id}, icon, type_id` (`type_id: values.type?.id`). Confirmado.

`manufacturer-form.tsx` (`onSubmit`, ~L184-220): `language, name, slug, description, is_approved, website, socials[]{icon,url}, image{...}, cover_image{...}, type_id` (`type_id: type?.id!`), más `shop_id` solo en create (L228/235). Confirmado.

DTOs:
- `create-manufacturer.dto.ts` (`OmitType(Manufacturer, ['id','cover_image','description','image','name','products_count','slug','socials','type','type_id','website','translated_languages']) + shop_id?: string`) — confirmado que omite `name`, `description`, `website`, `image`, `type_id`, `socials`, `cover_image`, exactamente como cita la US.
- `create-tag.dto.ts` (`PickType(Tag, ['name','type','details','image','icon','language'])`) — declara `type` (objeto `Type`), no `type_id`. **Hallazgo de diseño no anticipado por la tabla "Archivos a crear/modificar" de la US:** `Tag` entity (`tag.entity.ts`) **no tiene una propiedad `type_id`** en absoluto (solo `type: Type`) — a diferencia de `Manufacturer` entity, que sí declara `type_id?: string` (aunque tipado como `string`, no `number`, otra inconsistencia menor y preexistente). Para que `CreateTagDto` "declare `type_id`" (como pide la US) hay dos caminos, y ninguno es gratis:
  1. Añadir `type_id` a `tag.entity.ts` y luego `PickType` sobre él — toca un archivo que la tabla de la US no lista.
  2. Declarar `type_id` como propiedad standalone en `CreateTagDto` (fuera del `PickType`), igual que `CreateManufacturerDto` ya hace con `shop_id?: string` (línea 18) — no toca la entidad, es el patrón de menor fricción y ya tiene precedente en el propio archivo hermano.
  Recomiendo la opción 2 para `sdd-design`; se menciona aquí porque es el tipo de detalle que si no se anticipa, un agente de apply podría "resolverlo" tocando `tag.entity.ts` sin que esté declarado como archivo a modificar.

### 7. Columnas y ausencias — confirmadas contra el DDL

```
281-292 manufacturers: id, name, slug UNIQUE, description, website, image jsonb,
         type_id → types(id) ON DELETE SET NULL, is_approved boolean NOT NULL DEFAULT true,
         created_at, updated_at.  Sin `socials` ni `cover_image`.
295-306 tags: id, name, slug UNIQUE, details, icon, image jsonb,
         type_id → types(id) ON DELETE SET NULL, language DEFAULT 'es',
         created_at, updated_at.
```
Sin trigger de `updated_at` en ninguna de las dos (`schema.sql:480-500` solo cubre `products, categories, shops, users, profiles`) — confirmado leyendo el bloque completo de triggers, ni `tags` ni `manufacturers` aparecen. Repositorio debe fijar `updatedAt: now()` a mano en `update*`, igual que `updateType` (L119-147, `updatedAt: now()` en L136).

### 8. Tests — baselines medidos en este entorno, no asumidos

```
just db-check        → 9 test files, 111 tests, todos passed (coincide con archive-report.md)
cd apps/api/rest && npx jest → 6 suites, 92 tests, todos passed (coincide con archive-report.md)
```
Asserts de conteo verificados **en el código, no por grep de `toBe(`**:
```
tags.integration.test.ts:18   expect(total).toBe(10);
tags.integration.test.ts:25   expect((await listTags({ typeSlug: 'medicine' })).total).toBe(10);
manufacturers.integration.test.ts:18  expect(total).toBe(14);
manufacturers.integration.test.ts:34  expect(items).toHaveLength(10);   // limit:10
```
Ambos existen y en la forma que la US asume — sin el error que la exploración de US-27a cometió con `types` (buscar solo `toBe(` y no encontrar el `toHaveLength` correspondiente). Aquí **sí** hay `toBe(10)`/`toBe(14)` literales, doble red de seguridad.

### 9. La resolución del `type` embebido (D-6) — confirmada, reutilizable sin cambios

`toTagDto` (L47): `const type = record.typeId !== null ? typesById.get(record.typeId) : undefined;` — `typesById` es un `Map` construido en cada método de lectura (`findAll`/`findOne`) a partir de `listTypes()`. `toManufacturerDto` (L52) hace lo idéntico. Las respuestas de escritura (`createTag`/`updateTag`/`deleteTag`, `createManufacturer`/`updateManufacturer`/`deleteManufacturer`) solo necesitan llamar a `listTypes()` una vez más (o reutilizar la llamada si el servicio ya la hace) y pasar el mismo `Map` a `toTagDto`/`toManufacturerDto` sobre el `Record` que devuelva el repositorio — sin mapper nuevo, exactamente como predice D-6.

## Affected Areas

- `packages/db/src/repositories/tags.repository.ts` (53 líneas hoy) — añadir `createTag`/`updateTag`/`deleteTag` + `CreateTagInput`/`UpdateTagInput` + `tagSlugs: ExistingSlugLookup`, siguiendo `types.repository.ts` como plantilla exacta.
- `packages/db/src/repositories/manufacturers.repository.ts` (71 líneas hoy) — añadir `createManufacturer`/`updateManufacturer`/`deleteManufacturer`, sin tocar `findOrCreateManufacturerBySlug`.
- `packages/db/src/repositories/{tags,manufacturers}.integration.test.ts` — nuevos, con centinela propio por archivo (p. ej. `zz-tags-`/`zz-manu-`, nunca uno compartido — regla explícita heredada de US-27a).
- `packages/db/index.ts` — barrel: 6 funciones + 4 tipos de input nuevos. Único archivo compartido entre US-27b/28/29/30 (advertencia ya en la US: rebasar si corren en paralelo).
- `apps/api/rest/src/tags/tags.service.ts` — migrar `create`/`update`/`remove`; quitar `@db/tags.json`, `Fuse`, `plainToClass` de esa parte del archivo (el resto del servicio, lecturas, no cambia).
- `apps/api/rest/src/manufacturers/manufacturers.service.ts` — migrar `create`/`update`/`remove`; quitar `@db/manufacturers.json`, `Fuse`, `plainToClass`.
- `apps/api/rest/src/tags/dto/create-tag.dto.ts` — declarar `type_id` en vez de `type`; requiere decidir el camino del punto 6 (recomendado: propiedad standalone, sin tocar `tag.entity.ts`).
- `apps/api/rest/src/manufacturers/dto/create-manufacturer.dto.ts` — dejar de omitir `name`, `description`, `website`, `image`, `type_id`, `socials`, `cover_image`.
- `apps/api/rest/src/{tags,manufacturers}/*.service.spec.ts` — nuevos, jest mockeando `@safari/db`, plantilla `types.service.spec.ts` (331 líneas reales, no las ~145 estimadas por el design de US-27a).
- **NO afectados** (consumidos tal cual, `git diff` debe quedar vacío): `packages/db/src/slug.ts`, `packages/db/src/domain-errors.ts`, `apps/api/rest/src/common/errors/domain-error.mapper.ts`.
- **NO afectados** (fuera de scope declarado): `tag.entity.ts` (salvo que `sdd-design` elija el camino 1 del punto 6, que no recomiendo), `manufacturer.entity.ts`, `tags.controller.ts`, `manufacturers.controller.ts`, `apps/shop/**`, `apps/admin/**`, `db/schema.sql`.

## Approaches

No hay una decisión arquitectónica abierta aquí — a diferencia de US-27a, US-27b no introduce piezas nuevas, así que no hay opciones que comparar en la capa de diseño de fondo. Las únicas dos decisiones de forma quedan para `sdd-design`:

1. **`create-tag.dto.ts`: `type_id` como propiedad standalone vs. añadirlo a `tag.entity.ts`**
   - Standalone (precedente `shop_id` en `create-manufacturer.dto.ts`): Pros: cero archivos fuera de la tabla de scope, cero riesgo de romper otro consumidor de `Tag` entity (usada también por `Product`, `products.service.ts`). Cons: ninguno relevante.
   - Añadir a la entidad: Pros: más "correcto" semánticamente (la entidad refleja la columna real). Cons: toca un archivo no declarado en el scope de la US, y `Tag` se usa en más lugares (potencial de romper Swagger docs de otros endpoints que la reusan).
   - Effort: Low en ambos casos; standalone es estrictamente más seguro.

2. **Orden de entrega — un PR por agregado o uno solo**
   - US-27a se entregó en 3 PRs encadenados (`slug+errors`, `types.repository writes`, `API layer`) porque necesitaba construir las piezas compartidas primero. US-27b no las construye, pero cubre **dos** agregados — el patrón natural es un PR por agregado (`tags` primero, `manufacturers` después) más un PR final de limpieza de DTOs, replicando la estructura de tres capas que ya funcionó.
   - Effort: la decisión es de `sdd-tasks`, no de diseño; se menciona aquí porque el volumen (ver Risks) hace probable que `ask-on-risk` dispare la pregunta.

## Recommendation

Proceder directo a `sdd-propose` sin puntos de diseño abiertos que bloqueen: US-27b es un ejercicio de replicar un patrón ya probado en producción (`types`), no de inventar uno nuevo. El único punto que `sdd-design` debe fijar explícitamente (para que `sdd-apply` no im-provise) es la forma de `type_id` en `CreateTagDto` (punto 6 / Approach 1) — recomiendo la propiedad standalone.

## Risks

- **Volumen — señal de partición, no solo de sobre-estimación (medio-alto).** US-27a estimó ~500 (LOC del US), `sdd-tasks` pronosticó ~915, y aterrizó en **1462** (+60% sobre el pronóstico, +192% sobre la estimación del US). Esa cifra cubrió **un** agregado (`types`) más las **dos piezas compartidas** completas. US-27b no construye piezas compartidas, pero cubre **dos** agregados. Descomponiendo la cifra real de US-27a: el repositorio+test de escritura de `types` solo (sin fundaciones) fue ~317 líneas (PR#1b real); la capa de servicio+DTO+spec de `types` sola (sin el mapper de errores ni su spec, ~336 líneas de esas 758) fue ~422 líneas (PR#2 real, descontado el mapper). Proyectando ×2 agregados: ~634 (repos+tests) + ~844 (servicios+specs) ≈ **~1480 líneas reales**, muy por encima de la estimación de ~825 del épico y del umbral de ~900 que la propia regla del épico marca como señal de partir. **Recomendación operativa para `sdd-tasks`:** planificar de entrada una cadena de 2-3 PRs (uno por agregado, como mínimo) bajo `delivery_strategy: ask-on-risk`, en vez de descubrir el sobrecosto a mitad de `sdd-apply` como pasó en US-27a.
- **Mensaje de `InvalidReferenceError` en la rama P2003 puede ser engañoso (bajo, heredado, no bloqueante).** Confirmado en el punto 3: si el error real de Prisma no trae `meta.field_name` limpio, el mensaje cae al fallback `context.uniqueField` (`slug`), dando un 400 con mensaje semánticamente incorrecto (dice `tags.slug` cuando el problema es `type_id`). No bloquea CA-4 (sigue siendo 400) ni CA-7 (no exige tocar el archivo compartido). Debe verificarse empíricamente en `sdd-apply`/`sdd-verify` con un `POST /api/tags {"type_id": 99999}` real, porque no es deducible por lectura de código ni verificable sin escribir contra Postgres (se dejó fuera de esta exploración read-only a propósito).
- **CA-3 no se puede demostrar contra el seed tal cual está (bajo, operativo).** `products.manufacturer_id` es `NULL` en las 1200 filas sembradas y `product_tag` está vacía — no existe hoy "una marca con productos asociados" ni "un tag con productos enlazados" para ejercitar el escenario Gherkin de CA-3 sin una preparación manual por `psql` (`UPDATE products SET manufacturer_id = :id WHERE id = :probe` / `INSERT INTO product_tag VALUES (...)`), ya que crear esos vínculos vía API es scope de US-29 (products). Debe declararse explícitamente en la DoD como paso de preparación, no como comportamiento de la US.
- **`create-tag.dto.ts` no puede "declarar `type_id`" sin decidir dónde vive el campo (bajo, de diseño).** `Tag` entity no tiene `type_id`; forzar `PickType` a incluirlo exige tocar `tag.entity.ts`, que la tabla de scope de la US no lista. Ver Approach 1 — recomendación: propiedad standalone, mismo patrón que `shop_id` en `CreateManufacturerDto`.
- **`findOrCreateManufacturerBySlug` es código muerto en TypeScript hoy (informativo, no accionable).** Confirmado sin call sites reales fuera de su propio export — el scraper (Python + psycopg) no lo invoca. No afecta el scope de esta US, pero conviene que el reporte final lo mencione para que un futuro épico no asuma que "ya está enchufado".

## Ready for Proposal

Sí. Cero drift material contra los hallazgos retenidos de US-27a; las piezas compartidas se leyeron como consumidor real y **CA-7 es alcanzable con call-sites únicamente** (ningún caso encontrado que fuerce editar `slug.ts`, `domain-errors.ts` o `domain-error.mapper.ts`); el único hueco de diseño (forma de `type_id` en `CreateTagDto`) tiene una recomendación concreta y de bajo riesgo. El hallazgo de mayor peso para el orquestador es el de volumen: llevar a `sdd-propose`/`sdd-tasks` la proyección de ~1480 líneas reales (vs. ~825 estimadas) y decidir de entrada una cadena de PRs por agregado, en vez de repetir el patrón de US-27a de descubrirlo a mitad de camino.
