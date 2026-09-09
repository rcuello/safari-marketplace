# Delta for Flat Catalogs API

## ADDED Requirements

### Requirement: Escritura de `types` reutiliza la proyección de lectura (CA-1, CA-2)

`POST /api/types` MUST crear una fila y responder con **el mismo conjunto y
orden de claves** que `GET /api/types/{slug}` (9 claves), reutilizando el
mapper existente. `PUT /api/types/:id` MUST actualizar los campos con
columna y responder con la misma proyección; la columna `updated_at` MUST
avanzar respecto al valor previo tras cada actualización exitosa. `DELETE
/api/types/:id` exitoso MUST devolver el registro borrado con idéntica
proyección. La fila creada MUST sobrevivir a un reinicio del proceso de la
API (persistencia real, no mutación en memoria).

> **Nota de contrato (corrección del orquestador, 2026-09-09).** El avance de
> `updated_at` es observable **en la columna**, no en la respuesta HTTP:
> `toTypeDto` (`apps/api/rest/src/types/types.service.ts:39-51`) emite 9
> claves sin timestamps, y el key-set de 9 está fijado por
> `openspec/specs/flat-catalogs-api/spec.md`. Emitir `updated_at` en la
> respuesta añadiría una décima clave y rompería la propia CA-1 de esta
> Requirement. La evidencia de este MUST se toma por `psql`, no por `curl`.

#### Scenario: CA-1 — la vertical creada sobrevive al reinicio
- GIVEN un token `super_admin`
- WHEN se hace `POST /api/types` con `name "Vertical Prueba"`
- AND se reinicia la API
- THEN `GET /api/types/vertical-prueba` responde 200 con 9 claves
- AND el `Object.keys()` de la respuesta del `POST` coincide con el del `GET`

#### Scenario: CA-2 — renombrar persiste y no cambia el slug
- GIVEN un type con slug `vertical-prueba`
- WHEN se hace `PUT /api/types/:id` con `name "Vertical Renombrada"`
- THEN la respuesta trae `slug "vertical-prueba"` y `name "Vertical Renombrada"`
- AND la respuesta sigue teniendo 9 claves (sin `updated_at`)
- AND `SELECT updated_at FROM types WHERE id = :id` es posterior al valor previo

### Requirement: Borrado de `types` es protegido por dependientes (CA-3)

`DELETE /api/types/:id` MUST responder **409** cuando la vertical tiene
categorías o productos asociados, y el conteo de ambas tablas MUST
permanecer sin cambios. MUST responder **200** con la proyección de 9
claves cuando no hay dependientes, y el `GET` posterior a ese borrado MUST
responder 404.

#### Scenario: CA-3 — borrar una vertical con productos está protegido
- GIVEN el type `gadget` con productos y categorías en la base
- WHEN se hace `DELETE /api/types/9`
- THEN la respuesta es 409
- AND `SELECT count(*) FROM products WHERE type_id = 9` no cambia
- AND `SELECT count(*) FROM categories WHERE type_id = 9` no cambia

#### Scenario: CA-3 — borrar una vertical sin dependientes se permite
- GIVEN un type creado en la sesión, sin categorías ni productos
- WHEN se hace `DELETE /api/types/:id`
- THEN la respuesta es 200 con la proyección de 9 claves
- AND el `GET` posterior es 404

### Requirement: Errores de dominio de `types` nunca producen 500 (CA-4)

`PUT`/`DELETE /api/types/:id` con un id inexistente MUST responder 404.
`POST`/`PUT /api/types` con un `name` vacío o que slugifica a cadena vacía
MUST responder 400, sin crear fila. Un slug que colisiona con uno existente
MUST resolverse con el sufijo incremental de `catalog-write-foundations`
(NUNCA un error). Ningún caso de esta Requirement MUST producir un 500 ni
un log de stack.

#### Scenario: CA-4 — id inexistente
- GIVEN ningún type con id `99999`
- WHEN se hace `PUT /api/types/99999` o `DELETE /api/types/99999`
- THEN la respuesta es 404, sin stack trace en el log

#### Scenario: CA-4 — nombre que slugifica a vacío
- WHEN se hace `POST /api/types` con `name "!!!"`
- THEN la respuesta es 400
- AND no se crea ninguna fila en `types`

#### Scenario: CA-4 — colisión de slug no es un error
- GIVEN un type con slug `gadget`
- WHEN se hace `POST /api/types` con `name "Gadget"`
- THEN la respuesta es 201 con `slug "gadget-2"`

### Requirement: Permisos de escritura de `types` sin cambios (CA-5)

`POST`/`PUT`/`DELETE /api/types` MUST seguir exigiendo `ADMIN_ONLY`: sin
token responde 401; token `customer` responde 403; token `store_owner`
responde 403. Los decoradores existentes de `types.controller.ts` MUST
permanecer intactos.

#### Scenario: CA-5 — matriz de permisos
- GIVEN las tres rutas de escritura de `types`
- WHEN se llaman sin token, con token `customer` y con token `store_owner`
- THEN las respuestas son 401, 403 y 403 respectivamente

### Requirement: Sin mock huérfano ni regresión de lectura en `types` (CA-6)

`types.service.ts` MUST NOT importar `@db/types.json` ni `fuse.js`; los
métodos muertos `findAll`/`findOne` MUST eliminarse. El conteo de lectura
de `types` (10 filas del seed) MUST permanecer sin cambios tras correr la
suite de tests, y esa suite MUST incluir un assert de conteo total que hoy
no existe.

#### Scenario: CA-6 — sin imports huérfanos
- GIVEN `apps/api/rest/src/types/types.service.ts` ya migrado
- WHEN se busca `fuse` o `@db/` en el archivo
- THEN no hay coincidencias, y `findAll`/`findOne` no existen

#### Scenario: CA-6 — el conteo de lectura no cambia
- GIVEN la suite de integración de `types` con el nuevo assert de conteo
- WHEN corre `just db-check`
- THEN el conteo de `types` sigue en 10 y la suite completa pasa en verde

## MODIFIED Out of Scope (no-estándar — ver nota abajo)

> **Nota de convención.** `openspec-convention.md` solo define secciones de
> delta para `## ADDED/MODIFIED/REMOVED/RENAMED Requirements`; no define un
> mecanismo de merge para prosa de cabecera (`Out of Scope`). Precedente ya
> aplicado en este repo dos veces:
> `archive/2026-08-31-categorizacion-slugs-catalogo/specs/
> scraper-product-ingestion/spec.md` (US-7) y
> `archive/2026-08-31-endpoints-derivados-postgres/specs/
> flat-catalogs-api/spec.md` (US-8), donde `sdd-archive` aplicó el
> reemplazo íntegro a mano y lo registró en el archive report. Este delta
> sigue el mismo patrón.

Reemplaza la lista completa de `## Out of Scope` de
`openspec/specs/flat-catalogs-api/spec.md`:

> `categories` (US-4b) · `authors`/`top-authors` · endpoints de escritura
> del admin de `tags`/`manufacturers` (US-27b) y `shops` (US-30) — `types`
> pasa a estar en alcance (US-27a) · `category_product` ·
> `apps/shop/**`, `apps/admin/**` · `GET /staffs`, `POST /approve-shop`,
> `POST /disapprove-shop` · `GET /new-shops` y
> `GET /near-by-shop/:lat/:lng`: migrados a Postgres — ver
> `derived-catalog-api` (US-5) · retrofit de `products.service.ts` al
> helper de búsqueda compartido (D-7) · specs de jest para los 4 servicios
> (D-10).

(Previously: la lista excluía como bloque único "endpoints de escritura del
admin (`POST`/`PUT`/`DELETE` de los 4 catálogos)" — `types`, `tags`,
`manufacturers` y `shops` juntos. Ahora que US-27a implementa la escritura
de `types`, ese catálogo sale del bloque; solo quedan parqueados `tags` y
`manufacturers` (US-27b) y `shops` (US-30).)
