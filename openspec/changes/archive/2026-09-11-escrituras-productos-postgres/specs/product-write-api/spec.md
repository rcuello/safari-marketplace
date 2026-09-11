# Product Write API Specification

## Purpose

`POST`/`PUT`/`DELETE /api/products` dejan de devolver la fila 0 del mock y
escriben en `products` y sus dos pivotes (`category_product`,
`product_tag`) vía `@safari/db`, con las cinco expresiones CHECK/`IN` del
DDL pre-validadas en código, propiedad por tienda y la proyección de 20
claves de `toProductDto`. Capacidad nueva: las lecturas viven en
`product-listing-api`/`product-detail-api`, sin modificarse aquí.

## Requirements

### Requirement: Creación con pivotes y visibilidad en la tienda (CA-1)

`POST /products` MUST crear la fila y, si vienen, los enlaces en
`category_product`/`product_tag`, devolviendo las 20 claves de
`toProductDto` en el mismo orden que `GET /products/:slug`. Con
`status=publish` y `visibility=visibility_public`, el producto MUST
aparecer en `GET /products?search=name:…` y en `…=categories.slug:…` tras
reiniciar la API.

#### Scenario: CA-1 — el producto creado aparece filtrado por categoría
- GIVEN un token `store_owner` dueño de la tienda 9
- WHEN hace `POST /products` con `shop_id 9`, `categories: [<id laptop>]` y
  `status publish`
- THEN, tras reiniciar la API, el filtro por categoría lo incluye y
  `GET /products/<slug>` responde con 20 claves

### Requirement: Edición reemplaza pivotes bajo semántica explícita y conserva el slug (CA-2, D29-1, D29-5)

`PUT /products/:id` MUST actualizar los escalares enviados, dejar `slug`
intacto aunque cambie `name` y avanzar `updated_at`. Reemplazo de
`categories`/`tags`: **ausente** (`undefined`) = pivote no se toca;
**array vacío** = el set se vacía; con ids = reemplazo completo
(`deleteMany({}) + create([...])`). Un `PUT` que mueve `shop_id` MUST
exigir propiedad de la tienda **actual** y de la **destino**.

#### Scenario: CA-2 — escalares cambian, slug invariante, pivotes según venga
- GIVEN un producto `"laptop-x"` con 2 categorías y 1 tag
- WHEN `PUT /products/:id` cambia `name`, envía `categories: []` y omite `tags`
- THEN `slug` sigue `"laptop-x"`, `category_product` queda en 0 y
  `product_tag` conserva su fila

#### Scenario: CA-5 — mover `shop_id` exige propiedad de ambas tiendas
- GIVEN un `store_owner` dueño de la tienda 9 y su producto
- WHEN `PUT /products/:id` con `shop_id` de una tienda que no posee
- THEN la respuesta es 403 y el `shop_id` de la fila no cambia

### Requirement: Borrado elimina la fila y ambos pivotes (CA-3)

`DELETE /products/:id` MUST capturar el record antes de borrar (para
proyectarlo con 20 claves), eliminar la fila y sus enlaces en ambos
pivotes. Un `GET` posterior MUST responder 404.

#### Scenario: CA-3 — borrado con 20 claves y pivotes vaciados
- GIVEN un producto con enlaces en ambos pivotes
- WHEN `DELETE /products/:id`
- THEN la respuesta trae 20 claves, `GET` posterior es 404, y ambos
  pivotes quedan en 0 filas para ese producto

### Requirement: Las cinco reglas CHECK/`IN` se pre-validan, nunca 500 (CA-4, D29-3, D29-8)

El repositorio MUST rechazar con 400, antes del write: (1)
`sale_price >= price` (heredada de `upsertScrapedProduct`); (2)
`product_type=simple` sin `price` (guarda nueva); (3) `product_type` fuera
de `IN ('simple','variable')` (guarda nueva); (4) `status` fuera de
`IN ('publish','draft')` (guarda nueva). La quinta
(`products_procedencia_completa`) MUST cumplirse por construcción: el
input del admin no declara `source_*`.

#### Scenario: CA-4 — rebaja inválida y `simple` sin precio
- WHEN `POST /products` con `sale_price >= price`, y por separado con
  `product_type simple` sin `price`
- THEN ambas 400, ninguna fila se crea

#### Scenario: CA-4 — `product_type` o `status` fuera de su `IN`
- WHEN `POST /products` con `product_type "furniture"`, y por separado con
  `status "archived"`
- THEN ambas 400, nunca 500

### Requirement: Frontera numérica y existencia de las tres FK salientes y de los ids de pivote (CA-4, D29-4)

`type_id`, `shop_id`, `manufacturer_id` y cada id de `categories[]`/
`tags[]` MUST pasar por una guarda de entero antes de construir el input;
sin forma entera MUST responder 400 (nunca un `RangeError` de
`BigInt(NaN)` sin traducir). Un id entero pero inexistente MUST responder
400, incluido `manufacturer_id` (`SET NULL`, pero inexistente en la
escritura no es opcional silencioso).

#### Scenario: CA-4 — FK o pivote inexistente, o sin forma entera
- WHEN `POST /products` con `type_id 999999`, y por separado con
  `shop_id`/`manufacturer_id 999999`, `categories: [999999]`,
  `tags: [999999]`
- THEN las cinco 400
- AND repitiendo cada campo con `"abc"` en vez del id, las cinco siguen en
  400, nunca 500

### Requirement: Id inexistente en `PUT`/`DELETE` responde 404 (CA-4)

Un `id` sin fila correspondiente MUST responder 404 en `PUT` y `DELETE`,
antes de evaluar propiedad o CHECK.

#### Scenario: CA-4 — 404 en `PUT`/`DELETE` de un id inexistente
- WHEN `PUT /products/999999999` y `DELETE /products/999999999`
- THEN ambas 404

### Requirement: Propiedad por tienda — matriz de roles en las tres rutas (CA-5, D29-1)

`create` MUST validar el `shop_id` del body; `update`/`remove` MUST cargar
el producto primero (404 si no existe) y validar el `shop_id` **actual**.
`super_admin` MUST cortar en seco sin consultar `shops`. `staff` MUST
recibir 403 (sin relación staff↔tienda). Sin token MUST responder 401.

#### Scenario: CA-5 — dueño propio, dueño ajeno y `super_admin`
- GIVEN un `store_owner` dueño de la tienda 9, otro sin relación con ella,
  y un token `super_admin`
- WHEN cada uno hace `POST`/`PUT`/`DELETE` sobre un producto de la tienda 9
- THEN dueño propio y `super_admin` reciben 200 en las tres; el ajeno
  recibe 403 en las tres

#### Scenario: CA-5 — `staff` y sin token
- WHEN un token `staff`, y por separado ninguna autenticación, intentan
  `POST`/`PUT`/`DELETE`
- THEN `staff` recibe 403 (declarado) y el anónimo 401 en las tres

### Requirement: Productos `variable` — derivación de min/max, `variations` descartadas (CA-6, D29-6)

Para `simple`, `min_price`/`max_price` MUST igualar `price`. Para
`variable`, `price` MUST quedar `NULL` y `min_price`/`max_price` MUST
persistir lo que el admin ya calculó. `in_stock`, si no viene, MUST
derivarse de `quantity > 0`, o tomar el `DEFAULT true` sin `quantity`.
`variations`/`variation_options` MUST aceptarse y descartarse sin error.

#### Scenario: CA-6 — `variable` creado y leído como el seed
- GIVEN un payload `variable` sin `price`, con `min/max_price` y
  `variation_options.upsert` no vacío
- WHEN `POST /products`
- THEN se crea con `price NULL` y los `min/max` enviados, sin tabla de
  atributos nueva, y se lee indistinguible de los 58 `variable` del seed

### Requirement: Proyección de escritura — 20 claves, sin `related_products` (D29-7)

`create`/`update`/`delete` MUST devolver el `ProductRecord` con `type` y
`shop` incluidos en una sola operación (`PRODUCT_INCLUDE`); `delete` MUST
capturar el record antes de borrar. La respuesta MUST ser `toProductDto`
tal cual: 20 claves en el mismo orden que `GET /products/:slug`, sin
`related_products`.

#### Scenario: 20 claves en el mismo orden, sin `related_products`
- WHEN comparo `Object.keys()` de cualquier respuesta de escritura contra
  `GET /products/:slug`
- THEN las 20 claves y su orden coinciden, y `related_products` no aparece

### Requirement: Campos fuera de alcance se aceptan y se descartan (D-2, R29-6)

El input hacia `@safari/db` MUST construirse campo a campo, nunca
`...body`. `variations`/`variation_options`, `author_id`, `digital_file`,
`height`/`length`/`width`, `in_flash_sale` y `source_*` MUST aceptarse sin
error y descartarse; `in_flash_sale` MUST seguir emitiendo `0`.

#### Scenario: Campos sin columna se aceptan y se descartan
- WHEN `POST /products` con `height`, `digital_file`, `author_id`,
  `in_flash_sale: 1`
- THEN la fila se crea, ninguno persiste, y la respuesta emite
  `in_flash_sale: 0`

### Requirement: Sin mock huérfano ni regresión (CA-7)

`products.service.ts` MUST NOT importar `@db/products.json` ni usar
`plainToClass`. Tras la suite de integración con su propio centinela
(`zz-products-`), el conteo de la semilla (`1200`) y de ambos pivotes
MUST volver al valor previo a la corrida.

#### Scenario: CA-7 — sin imports huérfanos y conteos de la semilla intactos
- WHEN se busca `@db/`/`plainToClass` en `products.service.ts` y corre
  `just db-check`
- THEN no hay coincidencias, y `count(*) FROM products` vuelve a 1200 con
  la suite verde

## Out of Scope

`variations`/`variation_options` como tablas de atributos · `author_id`,
`digital_file`, `height`/`length`/`width` (sin columna) ·
`related_products` en la respuesta de escritura ·
`listProducts`/`parseProductSearch`/índices trigram (sin cambios) ·
`source_*`/`scraped_at` desde el admin · `whitelist`/`transform` del
`ValidationPipe` global · `slug.ts`, `domain-errors.ts`, `common/errors/`,
`db/schema.sql` · frontend (`apps/shop/**`, `apps/admin/**`).
