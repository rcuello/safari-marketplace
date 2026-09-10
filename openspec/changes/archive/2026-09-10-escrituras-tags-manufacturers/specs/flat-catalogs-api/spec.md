# Delta for Flat Catalogs API

## ADDED Requirements

### Requirement: Escritura de `tags` y `manufacturers` reutiliza la proyección de lectura (CA-1)

`POST /api/tags` y `POST /api/manufacturers` MUST crear una fila y responder
con el mismo conjunto y orden de claves que `GET /api/{recurso}/{slug}` (9 y
13 claves), reutilizando `toTagDto`/`toManufacturerDto` sin mappers nuevos.
`DELETE` exitoso MUST devolver el registro borrado con idéntica proyección.
La fila creada MUST sobrevivir a un reinicio — cierra el bug de
`manufacturers.service.ts:171-178`, que hoy muta el array en memoria y
pierde el toggle de aprobación al reiniciar. Campos sin columna (`socials`,
`cover_image`) MUST aceptarse e ignorarse, emitiendo las constantes que ya
emite la lectura.

#### Scenario: CA-1 — la marca creada sobrevive al reinicio
- GIVEN un token `super_admin`
- WHEN `POST /api/manufacturers` con `name "Marca Prueba"`, y se reinicia la API
- THEN `GET /api/manufacturers/marca-prueba` responde 200 con 13 claves,
  igual `Object.keys()` que el `POST`

#### Scenario: CA-1 — el tag creado ignora campos sin columna
- GIVEN un token `super_admin`
- WHEN `POST /api/tags` con `socials` y `cover_image` además de `name`
- THEN la respuesta trae 9 claves, sin esos campos, y no hay error

### Requirement: Editar persiste, no cambia el slug y `updated_at` avanza en la columna (CA-2)

`PUT /api/tags/:id` y `PUT /api/manufacturers/:id` MUST actualizar los
campos con columna, dejar `slug` intacto aunque cambie `name`, y responder
con la misma proyección. `updated_at` MUST avanzar respecto al valor previo,
fijada explícitamente por el repositorio (ninguna tabla tiene trigger).
`is_approved` MUST seguir emitiéndose como `Number(record.isApproved)`, y
su toggle MUST sobrevivir a un reinicio de la API.

> **Nota (heredada de `types`).** `updated_at` es observable **en la
> columna**, no en el `curl`: ni `toTagDto` ni `toManufacturerDto` emiten
> timestamps. Evidencia por `psql`.

#### Scenario: CA-2 — el toggle de aprobación sobrevive al reinicio
- GIVEN una marca con `is_approved 1`
- WHEN `PUT /api/manufacturers/:id` con `is_approved false`, y se reinicia la API
- THEN `GET /api/manufacturers/{slug}` devuelve `is_approved 0`

#### Scenario: CA-2 — renombrar no cambia el slug
- GIVEN un tag con slug `"oferta-verano"`
- WHEN `PUT /api/tags/:id` con `name "Oferta de invierno"`
- THEN la respuesta trae `slug "oferta-verano"`, `name` nuevo, y
  `updated_at` en la columna es posterior al valor previo

### Requirement: Borrado desenlaza sin arrastrar y no requiere protección (CA-3)

`DELETE /api/tags/:id` y `DELETE /api/manufacturers/:id` MUST borrar la fila
sin verificar dependientes (a diferencia de `types`): ambos `type_id` son
`ON DELETE SET NULL` y `product_tag.tag_id` es `ON DELETE CASCADE`. Ningún
camino MUST borrar una fila de `products`; su conteo MUST permanecer sin
cambios. El `GET` posterior a un borrado MUST responder 404.

#### Scenario: CA-3 — borrar una marca no borra sus productos
- GIVEN una marca con productos asociados (vínculo preparado por `psql`; el
  seed no trae ninguno)
- WHEN `DELETE /api/manufacturers/:id`
- THEN la respuesta es 200, `count(*) FROM products` no cambia, y esos
  productos quedan con `manufacturer_id NULL`

#### Scenario: CA-3 — borrar un tag elimina sus enlaces `product_tag`
- GIVEN un tag con filas en `product_tag` (vínculo preparado por `psql`)
- WHEN `DELETE /api/tags/:id`
- THEN la respuesta es 200, `count(*) FROM product_tag WHERE tag_id = :id`
  es 0, y el `GET` posterior a `/api/tags/{slug}` es 404

### Requirement: Errores de dominio de `tags` y `manufacturers` nunca producen 500 (CA-4)

`PUT`/`DELETE` con id inexistente MUST responder 404. `POST`/`PUT` con
`name` vacío o que slugifica a vacío MUST responder 400 sin crear fila.
`POST`/`PUT` con `type_id` inexistente MUST responder 400
(`InvalidReference`) sin crear fila. Un slug que colisiona MUST resolverse
con el sufijo incremental de `catalog-write-foundations`, nunca un error.
Ningún caso MUST producir 500 ni log de stack.

#### Scenario: CA-4 — `type_id` inexistente
- WHEN se hace `POST /api/tags` con `type_id 99999`
- THEN la respuesta es 400
- AND no se crea ninguna fila

#### Scenario: CA-4 — id inexistente y colisión de slug
- GIVEN ningún manufacturer id `99999`, y un tag con slug `"oferta"`
- WHEN `PUT /api/manufacturers/99999` y `POST /api/tags name "Oferta"`
- THEN la primera responde 404 y la segunda 201 con `slug "oferta-2"`

### Requirement: Permisos de escritura de `tags` y `manufacturers` sin cambios (CA-5)

`POST`/`PUT`/`DELETE /api/tags` MUST seguir exigiendo `ADMIN_ONLY`; los
mismos verbos en `/api/manufacturers`, `ADMIN_OWNER_AND_STAFF`. Sin token →
401. Token `customer` → 403 en las 6 rutas. `store_owner` → 403/200.

#### Scenario: CA-5 — matriz de permisos
- GIVEN las 6 rutas
- WHEN sin token, con `customer`, con `store_owner`
- THEN `tags` 401/403/403, `manufacturers` 401/403/200

### Requirement: Sin mock huérfano ni regresión de lectura en `tags`/`manufacturers` (CA-6)

`tags.service.ts` y `manufacturers.service.ts` MUST NOT importar
`@db/*.json` ni `fuse.js`. El conteo de lectura (`tags` 10, `manufacturers`
14) MUST permanecer sin cambios tras correr la suite de tests.

#### Scenario: CA-6 — sin imports huérfanos
- GIVEN los dos servicios ya migrados
- WHEN se busca `fuse` o `@db/` en ambos archivos
- THEN no hay coincidencias

#### Scenario: CA-6 — el conteo de lectura no cambia
- GIVEN la suite con centinela propio por archivo (`zz-tags-`, `zz-manu-`)
- WHEN corre `just db-check`
- THEN `tags` sigue en 10, `manufacturers` en 14, suite verde

## MODIFIED Out of Scope (no-estándar — ver nota abajo)

> **Nota de convención.** `openspec-convention.md` no define un merge para
> prosa de cabecera (`Out of Scope`). Precedente aplicado 4 veces, 2 sobre
> esta capability (US-8, US-27a): `sdd-archive` reemplaza la lista a mano.

Reemplaza la lista completa de `## Out of Scope` de
`openspec/specs/flat-catalogs-api/spec.md`:

> `categories` (US-4b) · `authors`/`top-authors` · endpoints de escritura
> del admin de `shops` (US-30) — `types` (US-27a) y `tags`/`manufacturers`
> (US-27b) pasan a estar en alcance · `category_product` ·
> `apps/shop/**`, `apps/admin/**` · `GET /staffs`, `POST /approve-shop`,
> `POST /disapprove-shop` · `GET /new-shops` y
> `GET /near-by-shop/:lat/:lng`: migrados a Postgres — ver
> `derived-catalog-api` (US-5) · retrofit de `products.service.ts` al
> helper de búsqueda compartido (D-7) · specs de jest para los 4 servicios
> (D-10).

(Previously: parqueaba `tags`/`manufacturers` junto con `shops`. Al
implementar US-27b su escritura, ambos catálogos salen del bloque; solo
queda `shops` (US-30).)
