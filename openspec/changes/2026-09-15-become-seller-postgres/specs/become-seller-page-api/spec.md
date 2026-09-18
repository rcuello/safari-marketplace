# Become Seller Page API Specification

## Purpose

Las 2 rutas de «hazte vendedor» (`POST|GET /api/became-seller`, pasado,
`@Public()`) dejan de servir el literal
`apps/api/rest/src/db/pickbazar/become-seller.json` y leen/escriben el
singleton `become_seller` (US-41) vía `@safari/db`. El servicio recompone
el envoltorio `{id, page_options, language, created_at, updated_at}` con
`commissions` como clave hermana. Contrato HTTP congelado: mismas rutas,
mismo verbo de escritura, mismo `@Public()` sin guard.

## Requirements

### Requirement: Lectura desde Postgres con equivalencia estructural (CA-1)

`GET /api/became-seller` MUST leer el singleton `become_seller` vía
`getBecomeSeller()` (`@safari/db`), no el JSON estático. El servicio MUST
recomponer el envoltorio tal como manda el comentario de
`db/schema.sql:479-484`: `{ page_options: { id, page_options, language,
created_at, updated_at }, commissions }`, con `commissions` como clave
hermana de `page_options`, no anidada.

El deep-equal del cuerpo MUST cubrir: las 2 claves top-level
(`page_options`, `commissions`), las 3 claves no-timestamp del envoltorio
(`id`, `page_options`, `language`), el objeto interno de 24 claves de
`page_options`, y `commissions` completo (array de 2 tiers).
`created_at`/`updated_at` **del envoltorio** MUST quedar EXCLUIDOS de ese
deep-equal y declararse aparte como divergencia acotada, con causa doble
— no solo de formato:
- **Valor**: `db/seed.sql:33` inserta `become_seller` sin `created_at`/
  `updated_at` explícitos — ambas toman su `DEFAULT now()` (fecha del
  último `just db-up`), no la del mock (`2024-06-06T10:30:48.000000Z`).
- **Formato**: `Date.toJSON()` da 24 caracteres (`.000Z`, 3 decimales)
  donde el mock da 27 (`.000000Z`, 6 decimales).

La evidencia de bytes (11 458 B mock vs 11 452 B Postgres, −6 B = 3
caracteres × 2 campos) MUST mantenerse, acotando el diff de formato. El
orden de claves dentro de los `jsonb` MUST NOT formar parte del contrato
— Postgres no lo preserva. Esta requirement MUST NOT exigir formatear a
mano los timestamps, forzar el orden de claves al serializar, ni congelar
las fechas del mock en la base — decisión del dueño.

#### Scenario: Paridad estructural del payload, excluidos los timestamps del envoltorio

- GIVEN el singleton sembrado desde `become-seller.json`
- WHEN pido `GET /api/became-seller`
- THEN el JSON parseado del cuerpo es profundamente igual al que servía el
  JSON estático en las 2 claves top-level, las 3 claves no-timestamp del
  envoltorio, el objeto interno de 24 claves y `commissions` completo
- AND `created_at`/`updated_at` del envoltorio quedan excluidos de esa
  comparación

#### Scenario: La divergencia de los timestamps del envoltorio es de valor, no solo de formato

- GIVEN que `db/seed.sql:33` no inserta `created_at`/`updated_at` para
  `become_seller`
- WHEN se comparan esos 2 campos del envoltorio servido contra el mock
- THEN el valor difiere (`DEFAULT now()` del último `db-up`, no la fecha
  del mock) y el formato difiere (`.000Z` de 24 caracteres vs `.000000Z`
  de 27), con la evidencia de bytes 11 458 B vs 11 452 B intacta

#### Scenario: El reordenado de claves jsonb no rompe el contrato

- GIVEN que Postgres no preserva el orden original de claves de un objeto
  `jsonb`
- WHEN se compara el cuerpo servido con el mock
- THEN la comparación se hace con `JSON.parse` + igualdad profunda, no con
  una comparación cruda de bytes o de string

### Requirement: Escritura real sobre el singleton (CA-2)

`POST /api/became-seller` (`create()`, `become-seller.controller.ts:
13-16`) MUST persistir en `become_seller` vía `updateBecomeSeller()`, no el
no-op en memoria actual. El body (`{ language?, page_options, commissions
}`, `apps/admin/rest/src/types/index.ts:2242-2246`) MUST mapear 1:1 a las
columnas. `updatedAt` MUST fijarse con `now()` de `clock.ts` (US-32). El
`GET` siguiente MUST reflejar el cambio; el `POST` MUST responder el mismo
envoltorio que el `GET`.

#### Scenario: Editar el banner persiste

- GIVEN el singleton en base
- WHEN `POST` cambia el título del banner dentro de `page_options`
- THEN el `GET` siguiente devuelve el título cambiado y `updated_at`
  posterior a su valor previo

#### Scenario: El cliente admin real ya es compatible sin cambiar de verbo

- GIVEN que `becomeSellerClient.update` hace `POST` al mismo endpoint
  (`apps/admin/rest/src/data/client/become-seller.ts:19-23`)
- WHEN esa llamada llega al controller
- THEN `create()` delega en `updateBecomeSeller()` sin exigir una ruta o
  verbo nuevos

### Requirement: El singleton nunca se duplica (CA-3)

Ninguna función de escritura MUST usar `create`/`upsert` contra
`become_seller`; `updateBecomeSeller()` MUST usar solo
`update({ where: { id: 1 }, ... })`. La CHECK `become_seller_fila_unica`
(`db/schema.sql:485-493`) sigue siendo la garantía estructural; el
repositorio MUST NOT crear una fila nueva bajo ninguna condición.

#### Scenario: Un update no crea segunda fila

- GIVEN la única fila `id = 1`
- WHEN se llama `updateBecomeSeller(input)` con cualquier body válido
- THEN sigue existiendo una sola fila y la CHECK nunca se ejercita

### Requirement: Contrato HTTP y superficie de error congelados

El endpoint MUST seguir siendo `POST|GET /api/became-seller` (pasado,
`become-seller.controller.ts:9`), `@Public()` a nivel de clase (`:8`), sin
guard de admin ni verbo o ruta nuevos.
`apps/api/rest/src/common/errors/domain-error.mapper.ts` MUST NOT
modificarse: ninguno de sus 5 códigos cerrados (`EmptySlug`,
`InvalidReference`, `RecordNotFound`, `DependentRows`, `SlugConflict`,
`:96-113`) es alcanzable desde un `update` sin slug, FK entrante ni borrado.

#### Scenario: `git diff` vacío en `domain-error.mapper.ts`

- GIVEN el diff completo de este change
- WHEN se inspecciona `domain-error.mapper.ts`
- THEN no tiene ninguna línea modificada

#### Scenario: La ruta sigue en pasado, pública y sin guard

- GIVEN el controller tras este change
- WHEN se inspecciona su decorador de clase y sus dos rutas
- THEN sigue siendo `@Public()` sobre `@Controller('became-seller')`, sin
  ningún guard de admin agregado

### Requirement: Sin regresión medible (CA-4)

`just db-check`, `npx jest` (`apps/api/rest`), `just build-api` y
`just verify` MUST cerrar en verde con recuentos pegados. `/api/settings`
MUST seguir en 5503 B (`body.length`). `git diff --stat` MUST mostrar
`domain-error.mapper.ts` y `settings/` intactos.

#### Scenario: Evidencia de cierre completa

- GIVEN el change aplicado
- WHEN se corre la batería completa (`db-check`, `jest`, `build-api`,
  `verify`)
- THEN los cuatro comandos terminan en verde con conteo pegado, y
  `/api/settings` mide 5503 B

## Out of Scope

Rediseño de contenido de la página · frontends de shop/admin (solo enlazan
a la ruta) · `staffs` (US-42) · `ownership-transfer` (US-43, aplazada) ·
`withdraws` · tocar `settings` o `domain-error.mapper.ts` · reconstrucción
de timestamps a 6 decimales o forzado de orden de claves `jsonb` al
serializar (decisión del dueño, `proposal.md` decisión **c**).
