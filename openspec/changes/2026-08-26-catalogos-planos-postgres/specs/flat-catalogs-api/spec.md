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

## Out of Scope

`categories` (US-4b) · `authors`/`top-authors` · endpoints de escritura del
admin (`POST`/`PUT`/`DELETE` de los 4 catálogos) · `category_product` ·
`apps/shop/**`, `apps/admin/**` · `GET /staffs`, `POST /approve-shop`,
`POST /disapprove-shop`, `GET /new-shops`, `GET /near-by-shop/:lat/:lng` ·
retrofit de `products.service.ts` al helper de búsqueda compartido (D-7) ·
specs de jest para los 4 servicios (D-10).
