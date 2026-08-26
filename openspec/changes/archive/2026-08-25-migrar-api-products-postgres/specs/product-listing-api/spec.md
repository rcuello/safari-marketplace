# Product Listing API Specification

## Purpose

`GET /api/products` lee `products` en Postgres vía `@safari/db` en vez de
`products.json`, preservando el contrato HTTP salvo divergencias documentadas.

## Requirements

### Requirement: Proyección de producto — 20 claves exactas

El endpoint MUST devolver, por producto, exactamente estas 20 claves
snake_case y en este orden: `id, name, slug, type, language,
translated_languages, product_type, shop, sale_price, max_price, min_price,
image, status, price, quantity, unit, sku, sold_quantity, in_flash_sale,
visibility`. `type` anida `{id, name, slug, logo, settings}`; `shop` anida
`{id, name, slug, logo}`.

Divergencias ratificadas (no son defectos):

| Campo | Valor | Alcance |
|---|---|---|
| `in_flash_sale` | `0` fijo (sin columna) | 1 fila (id 2: mock=1) |
| `type.logo` | `null` fijo | todas |
| `type` (name/settings embebidos) | desactualizado vs. `types.json` sembrado; type 11 además cambia `isHome` false→true (el shop lo lee) | types 6 y 11, 86 filas en total (55+31), **85 observables vía el endpoint** (54+31 — 1 fila de type 6 no es `publish`/`visibility_public`); ninguna en pág. 1 |
| precios (`*_price`) | redondeo `numeric(12,2)` | 8 filas |
| `image` | `null` en vez de `[]` | ids 1068, 1070 |

#### Scenario: Key-set idéntico al mock
- GIVEN la base sembrada con `just db-up`
- WHEN pido `GET /api/products?limit=30`
- THEN cada objeto de `data[]` tiene exactamente las 20 claves listadas

### Requirement: Envoltorio de paginación

El endpoint MUST usar el shape de `paginate()` local
(`apps/api/rest/src/common/pagination/paginate.ts`), NO `buildPaginator()`
de `@safari/db`, y MUST mantener `if (!page) page = 1; if (!limit) limit =
30;`. Después, `listProducts()` MUST recibir los valores numéricos
(`Number(page) || 1`, `Number(limit) || 30`); `paginate()` y la URL MUST
recibir los valores **crudos**, sin convertir — así `per_page` sale string
con `?limit=30` explícito y number con el default interno.

#### Scenario: `per_page` como string
- GIVEN `?limit=30` explícito en la query
- WHEN el endpoint responde
- THEN `per_page` es el string `"30"`, no el number `30`
- AND `listProducts()` recibió el number `30`, no el string

### Requirement: Búsqueda y filtros contra Postgres

El endpoint MUST parsear `search=key:value;key:value` (split por `;` y por
el primer `:`) y traducirlo a `ListProductsInput`:

| Token | Campo | Nota |
|---|---|---|
| `{type,categories,tags,manufacturer}.slug` | `{typeSlug,categorySlug,tagSlug,manufacturerSlug}` | |
| `name` | `name` | `contains`/`insensitive`, NO JSON |
| `shop_id` | `shopId` | ver divergencia abajo |
| `min_price`, `max_price` | `minPrice`, `maxPrice` | ver divergencia abajo |
| `status`, `visibility` | igual | default `publish`/`visibility_public` |
| `slug` | — | descartado |
| `author.slug` | — | no soportado, sin error |

`orderBy`, `sortedBy`, `searchJoin`, `date_range`, `language`, `with` MUST
aceptarse sin error y MUST ignorarse (sin ordenación ni relaciones extra).
El orden de `data[]` MAY diferir del ranking de `fuse.js` (R-2, aceptado):
R-2 licencia orden distinto, **no** cardinalidad distinta — ver divergencia
de cardinalidad abajo. Sin `search`, el orden MUST ser `id ASC`.

Divergencias de búsqueda ratificadas (no son defectos): cardinalidad de
`name` (fuse **20** vs. `contains` **17**, fuse matchea por fuzziness lo
que una subcadena no puede); `shop_id` + otro token (el mock **descarta
`shop_id` en silencio** al combinarlo con cualquier otro token — medido
`name:apple;shop_id:6` → mock **20** filas, idéntico a `name:apple` solo;
Postgres hace AND real y devuelve **12**); `min_price`/`max_price` (mock
**0** filas, Postgres rango real, medido `min_price:50` → 195 filas) —
**divergencia visible para el usuario**: el filtro de precio de la tienda
hoy vacía la grilla y dejará de hacerlo.

#### Scenario: Búsqueda por nombre desde Postgres, cardinalidad y orden aceptados
- GIVEN `?search=name:apple;status:publish;visibility:visibility_public`
- WHEN el endpoint procesa el request
- THEN los resultados vienen de `contains`/`insensitive`, `total` es 17 (no los 20 de fuse.js) y el orden puede diferir del de fuse.js; ninguno de los dos es regresión
- AND si además llega `orderBy=name&date_range=x`, responde 200 ignorándolos

#### Scenario: Filtros que el mock perdía o descartaba, aceptados
- GIVEN `?search=min_price:50;...` (0 filas en el mock) y `?search=name:apple;shop_id:6` (20 filas en el mock — `shop_id` descartado en silencio, idéntico a `name:apple` solo)
- WHEN Postgres los resuelve con rango y AND reales
- THEN `min_price:50` devuelve `price >= 50` (195 filas) y `name:apple;shop_id:6` devuelve la combinación real `name` AND `shop_id` (12 filas, menos que las 20 del mock porque ahora sí filtra por tienda); ninguno de los dos es regresión

### Requirement: La tienda no distingue el origen de datos

`just verify` MUST pasar: la home MUST renderizar 30 product cards, igual
que con el mock.

#### Scenario: Home sin cambios visibles
- GIVEN la API sirviendo desde Postgres
- WHEN corro `just verify`
- THEN los 3 servicios responden OK y la home cuenta 30 product-cards

### Requirement: Origen vivo — sin reinicio

Un `UPDATE` en Postgres (`just db-shell`) MUST reflejarse en la respuesta
sin reiniciar la API.

#### Scenario: UPDATE visible sin reiniciar
- GIVEN `UPDATE products SET name='CANARIO' WHERE id=<id>` en psql
- WHEN pido `?search=name:CANARIO;...` sin reiniciar la API
- THEN el producto sale con el nombre nuevo; revertir lo hace desaparecer

### Requirement: Errores de base controlados

Si Postgres no responde, el endpoint MUST responder 503 con cuerpo JSON de
`getUserFriendlyMessage()` (`isPrismaConnectionError` → 503). Cualquier
otro error MUST responder 500 con el mismo helper — en tensión literal con
D-2 ("errores de dominio a 400/404, nunca 500"), aceptada porque este path
de solo lectura no puede disparar violaciones de CHECK (única fuente de
esos 400/404); el 500 cubre solo lo inesperado, con mensaje legible. El
proceso Nest MUST NOT crashear.

#### Scenario: Postgres caído
- GIVEN `just db-down`
- WHEN pido `GET /api/products?limit=30`
- THEN recibo HTTP 503 con `{statusCode, message, error}` legibles
- AND `GET /api/types` sigue en 200 (el proceso sigue vivo)

## Out of Scope

- Detalle por slug (US-3); catálogos de apoyo (US-4).
- `popular-products`/`best-selling-products`: quedan en mock (Decision B).
- `category_product` (vacía por diseño del seed); `db/schema.sql`; frontend.
