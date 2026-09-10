# Flat Catalogs API Specification

## Purpose

`GET /api/{types,tags,manufacturers,shops}` (listado, detalle por slug y
`/top-manufacturers`) leen sus tablas en Postgres vía `@safari/db` en vez de
`{types,tags,manufacturers,shops}.json`, preservando el contrato HTTP salvo
las divergencias documentadas. `categories` queda fuera (US-4b).

## Requirements

### Requirement: Envoltorio de respuesta por catálogo

`GET /api/types` MUST devolver un **array plano** (sin envoltorio de
paginación). `GET /api/tags`, `GET /api/manufacturers` y `GET /api/shops`
MUST devolver `{data, ...paginate(...)}` con `paginate()` local
(`apps/api/rest/src/common/pagination/paginate.ts`), NO `buildPaginator()`.

#### Scenario: `types` sin envoltorio
- GIVEN la base sembrada con `just db-up`
- WHEN pido `GET /api/types`
- THEN recibo un array de 10 elementos, sin claves `data`/`total`/`per_page`

#### Scenario: `tags`/`manufacturers`/`shops` con envoltorio de paginación
- GIVEN la base sembrada
- WHEN pido `GET /api/manufacturers?limit=30`
- THEN recibo `{data, current_page, last_page, per_page, total, ...}` con
  `per_page` como el string `"30"` (mismo patrón que `product-listing-api`,
  `limit` llega como string porque `ValidationPipe` no transforma)

### Requirement: Key-set snake_case por catálogo

Cada objeto MUST tener exactamente este número de claves: `types` 9,
`tags` 9, `manufacturers` 13, `shops` 16. Divergencias ratificadas (campo
huérfano sin columna → valor constante, NUNCA se inventa una columna):

| Catálogo | Campo | Valor | Ref. |
|---|---|---|---|
| manufacturers | `products_count` | `0` constante | V-1 |
| manufacturers | `socials` | `[]` constante | V-2 |
| manufacturers | `cover_image` | `null` constante | V-3 |
| manufacturers | `language` | `'en'` constante | V-10 |
| shops | `owner` | `null` constante (`owner_id` sí es real) | V-4 |
| shops | `orders_count` | `0` constante | V-5 |
| shops | `notifications` | `null` constante | V-6 |
| shops | `created_at`/`updated_at` | hora real de `db-up`, formato ISO de JS | V-7 |
| types | `promotional_sliders` | `null` constante | V-8 |
| types/tags/manufacturers | `translated_languages` | `["en"]` constante | V-9 |
| todos | `is_approved`/`is_active` | `Number(bool)` → `1`/`0` | V-11 |
| tags | `image` | `null` donde el mock emite `[]` (10/10 filas) | V-25 |

> V-25 se ratificó en `sdd-verify`, no en el diseño: el mock emite `image: []`
> en las 10 filas y la columna es NULL en las 10 de Postgres porque
> `db/generate-seed.mjs:212` normaliza a NULL cualquier `image` que llegue como
> array (`g.image && !Array.isArray(g.image) ? g.image : null`). Es un hecho del
> seed, no del mapper, y `db/` queda fuera del alcance de esta US. Sin impacto
> funcional detectado: el admin lee `image` con optional chaining
> (`apps/admin/rest/src/components/tag/tag-form.tsx:169-171`) y los componentes
> de tags de la tienda no lo leen.

#### Scenario: Key-set idéntico salvo divergencias declaradas
- GIVEN un `curl` de cada catálogo
- WHEN comparo `Object.keys(...)` con `node -e` contra la línea base del mock
- THEN el key-set coincide exactamente (9/9/13/16) y los únicos valores
  distintos son los de la tabla de divergencias

### Requirement: Filtro `search=name:<término>` (D-5)

`GET /api/{types,tags,manufacturers,shops}` MUST aceptar
`search=name:<término>` (`contains`, `insensitive`) vía el helper
`parse-search.ts`. Las 4 cajas de búsqueda del admin (`pages/{groups,tags,
manufacturers,shops}/index.tsx`) dependen de este filtro; sin él, migrar
rompe la búsqueda.

#### Scenario: Las 4 cajas de búsqueda del admin siguen filtrando
- GIVEN la base sembrada
- WHEN pido `GET /api/types?search=name:gadget`, luego el equivalente para
  `tags`, `manufacturers` y `shops`
- THEN cada respuesta trae solo filas cuyo `name` contiene el término,
  case-insensitive — la regresión que detectó la exploración no ocurre

### Requirement: `search=is_active:1` en shops (V-15)

`GET /api/shops` MUST aceptar `search=is_active:1` y traducirlo a un filtro
real (`isActive: true`), reemplazando el match difuso (`fuse`, threshold
0.3) del mock.

#### Scenario: `is_active` deja de ser difuso
- GIVEN la base sembrada (los 12 shops activos)
- WHEN pido `GET /api/shops?search=is_active:1`
- THEN recibo un filtro exacto por columna, no un ranking `fuse`; con el
  seed actual el resultado observable no cambia (12/12 activos)

### Requirement: `type` anidado en tags y manufacturers (D-6)

Cada tag/manufacturer MUST embeber `type: {id, name, slug, logo}` con
`logo: null` constante, resuelto en el servicio de Nest (un `listTypes()`
indexado por id, sin `include` de Prisma).

#### Scenario: `type` embebido con 4 claves
- GIVEN un tag con `type_id` válido
- WHEN pido `GET /api/tags`
- THEN cada fila trae `type: {id, name, slug, logo: null}`, sin claves extra

### Requirement: `GET /api/top-manufacturers`

El endpoint MUST devolver un array plano de manufacturers ordenados por
`id ASC`, recortado a `limit` (default 10), equivalente a
`manufacturers.slice(0, limit)` del mock.

#### Scenario: Mismos ids que el `slice` del mock
- GIVEN la base sembrada (14 manufacturers)
- WHEN pido `GET /api/top-manufacturers?limit=5`
- THEN recibo los 5 manufacturers de menor id, mismo orden que el mock

### Requirement: `shops.products_count` calculado (D-4)

`GET /api/shops` y `GET /api/shops/:slug` MUST calcular `products_count`
como `COUNT(products WHERE shop_id = X AND status='publish' AND
visibility='visibility_public')`, no una constante.

#### Scenario: Coincide con el mock en 8 de 9 shops
- GIVEN los 9 shops del mock original
- WHEN comparo `products_count` calculado contra el valor del mock
- THEN coinciden en 8/9; `makeup-shop` declara 81 en el mock y Postgres
  calcula 82 — inconsistencia del propio mock, declarada y NO reproducida

### Requirement: `manufacturers.products_count` constante `0` (V-1)

`GET /api/manufacturers` y `/manufacturers/:slug` MUST emitir
`products_count: 0` siempre: ningún producto sembrado tiene
`manufacturer_id` poblado, por lo que no hay valor real que calcular.

#### Scenario: Siempre cero
- GIVEN cualquier manufacturer del seed
- WHEN pido su detalle o listado
- THEN `products_count` es `0`

### Requirement: Delta de `shops` — 12 filas (CA-3)

`GET /api/shops` MUST devolver 12 filas donde el mock devolvía 9: los 9
`shops.json` originales más 3 reconstruidos desde el `shop` embebido en
productos con `shop_id` 12/14/15 (`noaw`, `tetetetet`, `launchidea`),
identificables por `description LIKE 'Reconstruido%'`.

#### Scenario: 9 slugs del mock + 3 reconstruidos
- GIVEN la base sembrada
- WHEN corro `docker exec -e PGPASSWORD=safari safari-postgres psql -h
  localhost -U safari -d safari_scraper -c "SELECT id, slug, description
  LIKE 'Reconstruido%' AS recon FROM shops ORDER BY id"`
- THEN veo 12 filas: 9 con `recon=false` cuyos slugs coinciden con el mock,
  y 3 con `recon=true` (`noaw`, `tetetetet`, `launchidea`)

### Requirement: Detalle por slug y 404 (V-16)

`GET /api/{types,tags,manufacturers,shops}/:slug` MUST resolver por slug
(`/tags/:param` **solo** por slug — D-8, la rama numérica que el mock
aceptaba pasa a 404 sin llamador conocido) y MUST responder 404
(`NotFoundException`) con `{"statusCode":404,...,"error":"Not Found"}`
cuando no hay match, reemplazando el 200 vacío del mock.

#### Scenario: Detalle igual al listado
- GIVEN un slug existente en cualquiera de los 4 catálogos
- WHEN pido su detalle
- THEN el objeto es idéntico al elemento correspondiente del listado

#### Scenario: 404 para slug inexistente
- GIVEN un slug que no existe
- WHEN pido su detalle
- THEN recibo 404 con el cuerpo por defecto de Nest, y el proceso sigue vivo

### Requirement: Errores de conexión a Postgres (D-3)

Si Prisma no puede conectar, cada listado MUST responder 503 con
`getUserFriendlyMessage()` (`isPrismaConnectionError`); cualquier otro error
no controlado MUST responder 500 con el mismo helper. El proceso Nest MUST
NOT crashear.

#### Scenario: Postgres caído
- GIVEN `just db-down`
- WHEN pido `GET /api/types`, `/tags`, `/manufacturers` o `/shops`
- THEN cada uno responde 503 con `{statusCode, message, error}` legibles

### Requirement: Divergencias del mock que NO se reproducen (V-12..V-14)

Los siguientes comportamientos son bugs del mock; el spec MUST declararlos
como aceptados, no reproducirlos:

| # | Bug del mock | Comportamiento en Postgres |
|---|---|---|
| V-12 | `search=type.slug:` en tags/manufacturers no filtraba nada (`fuse` no indexa esa clave) | Filtra de verdad |
| V-13 | `tags`: `total`/`count` = `tags.length` sin `slice`; `per_page` miente | `total` real, página real |
| V-14 | `shops` sin `limit` → `slice(NaN,NaN)` → `data: []` | `Number(limit) \|\| 30` → 12 filas |

#### Scenario: Bugs de paginación del mock no sobreviven
- GIVEN `GET /api/tags?limit=3`
- WHEN comparo contra el comportamiento documentado del mock
- THEN `total`/`per_page` reflejan la página real, no `tags.length`

## Verification per PR boundary

| PR | Catálogos | Evidencia mínima |
|---|---|---|
| #1 | `parse-search` + `types` | `curl :9001/api/types` — array de 10, key-set 9 |
| #2 | `tags` + `manufacturers` | `curl :9001/api/tags`, `/manufacturers`, `/top-manufacturers` — `type` anidado, `products_count:0` |
| #3 | `shops` + docs | `curl :9001/api/shops` — 12 filas + `psql` de la Requirement "Delta de shops" |

Cada PR MUST ejecutar `just db-build` (si tocó `packages/db`), `just
db-check` y `just verify` antes de considerarse cerrado.

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

## Out of Scope

`categories` (US-4b) · `authors`/`top-authors` · endpoints de escritura
del admin de `shops` (US-30) — `types` (US-27a) y `tags`/`manufacturers`
(US-27b) pasan a estar en alcance · `category_product` ·
`apps/shop/**`, `apps/admin/**` · `GET /staffs`, `POST /approve-shop`,
`POST /disapprove-shop` · `GET /new-shops` y
`GET /near-by-shop/:lat/:lng`: migrados a Postgres — ver
`derived-catalog-api` (US-5) · retrofit de `products.service.ts` al
helper de búsqueda compartido (D-7) · specs de jest para los 4 servicios
(D-10).
