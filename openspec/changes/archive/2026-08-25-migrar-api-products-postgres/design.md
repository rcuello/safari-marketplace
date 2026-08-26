# Design: Migrar `/api/products` (listado) a Postgres vía `@safari/db`

> US-2, Épico 1. Insumos: `proposal.md`, `exploration.md` (misma carpeta).
> Toda afirmación concreta está verificada abriendo el archivo citado.

## Technical Approach

`ProductsService.getProducts()` pasa de filtrar `products.json` en memoria con
`fuse.js` (`apps/api/rest/src/products/products.service.ts:45-83`) a: parsear
`search=key:value;…` → `ListProductsInput`, llamar `listProducts()` de
`@safari/db` (`packages/db/index.ts:53`), mapear cada `ProductRecord` a la
proyección de 20 claves del mock y envolver con el `paginate()` que ya usa el
archivo. D-1 se respeta (cero `@prisma/client` en la API); D-2 se respeta (la
traducción camelCase→snake_case vive en el servicio de Nest, igual que
`settings.service.ts:33-39`). Ningún archivo nuevo, ningún cambio de esquema.

## Architecture Decisions

### Decision A: envoltorio de paginación con `paginate()` local, NO `buildPaginator`

**Choice**: seguir usando `paginate()` de
`apps/api/rest/src/common/pagination/paginate.ts:4-75`.
**Alternatives**: `buildPaginator()` de `packages/db/src/pagination.ts:37-65`
(lo que recomendaba el punto 4 del proposal).
**Rationale — revocación con evidencia**: `new ValidationPipe()`
(`main.ts:9`) NO transforma. Verificado en el código instalado
(`apps/api/rest/node_modules/@nestjs/common/pipes/validation.pipe.js:86-91`):
`validatorOptions` queda en `{forbidUnknownValues:false}`, `length === 1`, luego
`shouldTransformToPlain` es `false` y el pipe devuelve `value` — el objeto crudo
de la query. Por tanto `limit` llega como **string** `"30"`, y `paginate()`
lo emite tal cual en `per_page`. Reproducido:

```
per_page: "30"   (con ?limit=30 en la query)
per_page: 30     (sin limit: products.service.ts:47 asigna el número 30)
```

`buildPaginator` tipa `limit: number` y normalizaría `per_page` a `30`: una
divergencia de tipo, justo lo que CA-1 prohíbe ("mismos tipos"). Forzarlo con
un cast sería suprimir un tipo para maquillar el contrato. `paginate()` además
ya está importado (`products.service.ts:7`) y lo siguen usando
`getProductsStock`/`getDraftProducts` (líneas 145 y 182), así que reutilizarlo
deja el tramo de paginación con **cero diff** — es la mitigación por
construcción de R-1. `buildPaginator` no se toca ni se deprecia.

### Decision B (cierra `open_decisions.popular-best-selling`): quedan en mock

**Choice**: `popular-products` y `best-selling-products` NO migran en US-2.
**Rationale — evidencia verificada, no ratificada por confianza**: los dos JSON
suman 15 filas (`popular-products.json` = 10, `best-selling-products.json` = 5)
y **las 15 tienen `sold_quantity: 0`** → la base no guarda ninguna señal de
ranking que reproduzca esas listas. Además emiten un shape de **46 claves**
(`description`, `gallery`, `blocked_dates`, `orders_count`, `my_review`,
`author_id`…) que no es el de 20 claves del listado, y ni siquiera coincide
entre sí (mismo tamaño, distinto orden; `visibility` no está en ninguno de los
dos). Migrarlos exige un mapper distinto y una regla de ranking inventada:
fuera del "Incluye" de US-2. **Consecuencia vinculante**: los imports
`productsJson`/`popularProductsJson`/`bestSellingProductsJson` y la instancia
`fuse` (`products.service.ts:8-33`) **permanecen** — los usan
`getPopularProducts`/`getBestSellingProducts` (líneas 96-112) y
`getProductsStock`/`getDraftProducts`.

### Decision C (cierra `open_decisions.mapper-file-split`): sin archivo nuevo

**Choice**: `parseProductSearch()` y `toProductDto()` como funciones privadas
nombradas a nivel de módulo en `products.service.ts`. **Ratifica** la
recomendación. **Rationale**: la proyección real es un literal de 20 claves con
dos objetos anidados chicos (~35 LOC), no los 35 campos que temía la
exploración. Un archivo nuevo hoy tendría un único consumidor. `toProductDto`
queda `export`able en US-3 (detalle por slug) sin mover nada.

### Decision D: CA-5 con `try/catch` local, sin `ExceptionFilter` global

**Choice**: envolver **solo** la llamada `await listProducts(input)`;
`isPrismaConnectionError(error)` → `ServiceUnavailableException(getUserFriendlyMessage(error))`
(503); cualquier otro error → `InternalServerErrorException(getUserFriendlyMessage(error))`.
Ambos helpers salen del barrel (`packages/db/index.ts:5-13`); hoy no tienen
ningún consumidor. **Alternatives**: filtro global (cambiaría el error de los
~40 endpoints que siguen en mock); `pingDatabase()` previo
(`packages/db/src/health.ts`) = una consulta extra por request. **Rationale**:
503 es semánticamente correcto para "la base no responde" y el cuerpo que
produce Nest es legible:
`{"statusCode":503,"message":"No se puede conectar con el servicio. Por favor, intenta más tarde.","error":"Service Unavailable"}`
(`packages/db/src/errors.ts:229-241`). El precedente de settings NO cubre este
caso, así que copiarlo tal cual dejaba CA-5 a medias.
**Tensión declarada con D-2** ("los errores de dominio se traducen a 400/404,
nunca a 500"): la rama `else` sí termina en 500. D-2 habla de violaciones de
CHECK constraints, que solo ocurren al ESCRIBIR; este es un path de lectura
que no puede dispararlas, así que el 500 cubre únicamente lo genuinamente
inesperado — y lo hace con un mensaje legible, no con el "Internal server
error" pelado del filtro base de Nest.

## Data Flow

    GET /api/products?limit=30&search=status:publish;visibility:visibility_public
        │
        ▼  ProductsController.getProducts (sin cambios, products.controller.ts:28-31)
    ProductsService.getProducts(query)            ← pasa a ser async
        │  parseProductSearch(search) ─────────→ ListProductsInput
        ▼
    listProducts(input)  @safari/db  ──→ Prisma ──→ Postgres :5433
        │  { items: ProductRecord[], total }
        ▼  items.map(toProductDto)   ← 20 claves snake_case
    { data, ...paginate(total, page, limit, data.length, url) }

## Interfaces / Contracts

### Proyección de salida — las 20 claves, en este orden

Orden verificado idéntico en 1200/1200 filas de `products.json`. El orden se
preserva porque `target: es2017` (`apps/api/rest/tsconfig.json`) no define
campos de clase, así que hoy el orden lo fija el JSON de origen.

| # | Clave (API) | Origen en `ProductRecord` | Tipo emitido |
|---|---|---|---|
| 1 | `id` | `r.id` (`_id`: BigInt→number) | number |
| 2 | `name` | `r.name` | string |
| 3 | `slug` | `r.slug` | string |
| 4 | `type` | objeto anidado, ver abajo | object |
| 5 | `language` | `r.language` | string |
| 6 | `translated_languages` | `r.translatedLanguages` (`text[]`) | string[] |
| 7 | `product_type` | `r.productType` | string |
| 8 | `shop` | objeto anidado, ver abajo | object |
| 9 | `sale_price` | `r.salePrice` (`_dec`: Decimal→number) | number \| null |
| 10 | `max_price` | `r.maxPrice` (`_dec`) | number \| null |
| 11 | `min_price` | `r.minPrice` (`_dec`) | number \| null |
| 12 | `image` | `r.image` (jsonb tal cual) | object \| null |
| 13 | `status` | `r.status` | string |
| 14 | `price` | `r.price` (`_dec`) | number \| null |
| 15 | `quantity` | `r.quantity` | number |
| 16 | `unit` | `r.unit` | string |
| 17 | `sku` | `r.sku` | string \| null |
| 18 | `sold_quantity` | `r.soldQuantity` | number |
| 19 | `in_flash_sale` | **constante `0`** (no hay columna) | number |
| 20 | `visibility` | `r.visibility` | string |

`_id`/`_dec` (`packages/db/src/records.ts:35-46`) ya dejan el record JSON-safe:
no llegan `BigInt` ni `Decimal` al borde HTTP. `numeric(12,2)` → `2` y `1.6`,
exactamente como el mock.

**Anidado `type`** (mock: siempre `["id","name","slug","logo","settings"]`):
`{ id: r.type.id, name: r.type.name, slug: r.type.slug, logo: null, settings: r.type.settings }`.
`logo` es constante `null` — verificado `null` en 1200/1200; `types.icon` no es
lo mismo y no se emite. `TypeRecord` (`records.ts:60-70`) aporta además
`icon/banners/language/createdAt/updatedAt`: **no se copian**.

**Anidado `shop`** (mock: siempre `["id","name","slug","logo"]`):
`{ id: r.shop.id, name: r.shop.name, slug: r.shop.slug, logo: r.shop.logo }`.
`ShopRecord` (`records.ts:72-85`) aporta 8 campos más que **no se copian**.

El tipo declarado del mapper es `Product`; como en `settings.service.ts:39`,
el literal se devuelve con un cast al tipo de la entidad (la entidad declara
campos que el mock no emite).

### Parseo `search` → `ListProductsInput`

Se conserva el troceo del mock literal (`products.service.ts:52-57`):
`search.split(';')` y luego `const [key, value] = tok.split(':')` (se queda con
el primer segmento; no se "mejora"). Serializador de origen verificado en
`apps/shop/src/framework/rest/client/http-client.ts:236-245` y los campos que
la tienda manda en `client/index.ts:112-142`.

| Token del `search` | Campo de `ListProductsInput` | Nota |
|---|---|---|
| `type.slug:v` | `typeSlug` | |
| `categories.slug:v` | `categorySlug` | siempre 0 resultados: `category_product` sin INSERT en `db/seed.sql` |
| `tags.slug:v` | `tagSlug` | 0 resultados con el seed: `product_tag` sin INSERT |
| `manufacturer.slug:v` | `manufacturerSlug` | 0 resultados con el seed: el INSERT de `products` no incluye `manufacturer_id` (`db/generate-seed.mjs:228-247`) |
| `name:v` | `name` | `contains` + `insensitive` (`products.repository.ts:179-181`) |
| `shop_id:v` | `shopId` vía `parseFiniteNumber(v)` — `Number.isFinite`, si no es finito el token se ignora (fix V-3, post-verify) | Postgres hace AND real; el mock **descarta** este filtro en silencio al combinarlo (divergencia 9) |
| `min_price:v` / `max_price:v` | `minPrice` / `maxPrice` vía `parseFiniteNumber(v)` (fix V-3, post-verify) | el mock devuelve 0 filas para estos tokens (divergencia 10) |
| `status:v` / `visibility:v` | `status` / `visibility` | default `publish`/`visibility_public` en `buildWhere` (`products.repository.ts:172-173`) |
| `slug:v` | — | descartado, igual que el mock (`products.service.ts:61`) |
| `author.slug:v` | — | **no soportado**: no existe columna ni campo. La tienda de electrónica no lo envía |
| clave desconocida | — | ignorada |

Query params aceptados e **ignorados** (el mock hace lo mismo hoy): `orderBy`,
`sortedBy`, `searchJoin`, `date_range` y `language`, los cinco declarados en
`get-products.dto.ts:10-17`. `with` (la tienda manda `with=type;author`,
`client/index.ts:127`) **no está declarado en el DTO**: sobrevive solo porque
`ValidationPipe` corre sin `whitelist` y devuelve el objeto de query intacto.
No se declara ni se implementa. No se implementa ordenación: `listProducts`
ordena `id: 'asc'` (`products.repository.ts:213`), que es el orden del JSON del
mock (verificado: el archivo está en id ascendente).

### `page` / `limit` — reglas obligatorias

**MUST-KEEP**: las dos primeras líneas del método se conservan **literales**
(`products.service.ts:46-47`):

```ts
if (!page) page = 1;
if (!limit) limit = 30;
```

Sin ellas, una request sin `limit` produce `per_page: undefined` y
`last_page: NaN` — el envoltorio se rompe y el scroll infinito con él (R-1).

Después de esa asignación, los dos valores circulan por **dos caminos
distintos** y eso es deliberado:

| Destino | Valor | Por qué |
|---|---|---|
| `listProducts({ page, limit })` | **numérico**: `Number(page) \|\| 1` y `Number(limit) \|\| 30` | Prisma exige números en `skip`/`take` |
| `paginate(...)` y la plantilla de URL | **crudo, sin convertir** | es lo que reproduce `per_page: "30"` (string) y `per_page: 30` (número) según venga o no en la query — ver Decision A |

El `|| 1` / `|| 30` no es cosmético: un `?page=abc` da `Number('abc') = NaN`,
y un `NaN` en `skip` hace que Prisma lance, lo que el `try/catch` convertiría
en un 500. Con el fallback, `listProducts` recibe la página 1. El envoltorio,
en cambio, sigue emitiendo lo que emite el mock hoy para ese caso
(`current_page: null`, porque `+'abc'` es `NaN` y `JSON.stringify` lo serializa
como `null`). Única diferencia residual en ese caso patológico: el mock
devuelve `data: []` y Postgres devuelve la página 1. Ningún cliente manda eso;
no se añade una rama para cubrirlo.

La plantilla de URL se copia carácter a carácter, incluido el artefacto
`search=undefined`:

```ts
const url = `/products?search=${search}&limit=${limit}`;
// sin search →  http://localhost:5000/api/products?search=undefined&limit=30&page=1
```

`APP_URL` sigue hardcodeado a `:5000` (`common/constants.ts:1`) — defecto
preexistente, explícitamente fuera de scope.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/api/rest/src/products/products.service.ts` | Modify | `getProducts()` async sobre `listProducts` + `parseProductSearch()` + `toProductDto()` + `try/catch`. Resto del archivo intacto |
| `packages/db/src/repositories/products.integration.test.ts` | Modify | 3 tests nuevos (abajo) |
| `packages/db/src/repositories/products.repository.ts` | Sin cambios | `ListProductsInput` ya cubre todo filtro real |
| `apps/api/rest/src/products/products.controller.ts` | Sin cambios | ya `async`/`Promise<ProductPaginator>` |
| `docs/product/1-catalogo-desde-postgres/2-migrar-api-products-postgres.md` | Modify | punto 5 de la DoD: campo **Status** |
| `docs/product/1-catalogo-desde-postgres/README.md` | Modify | punto 5 de la DoD: fila de US-2 en la tabla |

## Divergencias aceptadas (declarar en verify-report)

| # | Divergencia | Alcance | Motivo |
|---|---|---|---|
| 1 | `in_flash_sale` siempre `0` | **1 fila: id 2, que está en la página 1** (`in_flash_sale: 1` en el mock) | no hay columna; añadirla = cambiar `db/schema.sql` |
| 2 | `image: []` → `null` | ids 1068 y 1070 | `generate-seed.mjs:243` guarda `NULL` cuando el mock traía `[]` |
| 3 | El objeto `type` embebido está **desactualizado en el mock** respecto de `types.json` (que es lo que se sembró) | **types 6 y 11 · 86 filas en total (55 + 31), 85 observables vía el endpoint (54 + 31) · ninguna en la página 1** | ver detalle abajo |
| 4 | `min_price`/`max_price` redondeados a 2 decimales | 8 filas (p. ej. id 647: `1.5899999999999999` → `1.59`) | `numeric(12,2)` |
| 5 | `total` 1200 → 1199 **solo sin `search`** | request que la tienda nunca hace | `buildWhere` aplica `publish`/`visibility_public` siempre; el mock sin search filtra 1 borrador. Con el `search` real de la tienda ambos dan **1199** |
| 6 | Orden de claves dentro de `image`/`shop.logo`/`type.settings` | jsonb no preserva orden | comparar con `jq -S` (key-set + valores), no bytes crudos |
| 7 | Ranking de resultados de búsqueda | R-2 del épico, ya aceptado | `contains` no rankea como fuse.js |
| 8 | **Cardinalidad** de la búsqueda por nombre: fuse **20** vs. `contains` **17** | `search=name:apple;status:publish;visibility:visibility_public` | ver detalle abajo — R-2 **no** cubre esto |
| 9 | `shop_id` combinado con otro filtro: el mock **descarta `shop_id` en silencio** (devuelve lo mismo que el otro filtro solo), Postgres hace AND real | cualquier request que combine `shop_id:v` con otro token | ver detalle abajo (arrastrado de `exploration.md:386-391`) |
| 10 | `min_price`/`max_price`: mock **0** resultados, Postgres rango real | el filtro de precio de la tienda SÍ los envía | ver detalle abajo |

### Detalle de la divergencia 3 — `type` embebido obsoleto

Comparación campo a campo de `products.json[].type` contra `types.json`:
**86 filas divergentes en total, en dos verticales** (ninguna cae en la
página 1, que solo trae types 1 y 3). De esas 86, **85 son observables a
través del endpoint** (`status='publish' AND visibility='visibility_public'`):
type 6 aporta 54 de sus 55 (la fila que falta es el id 454, `status:
draft`, y por tanto nunca sale en una respuesta real del listado), type 11
aporta sus 31 completas. Verificado:

```sql
SELECT t.id AS type_id, count(*) AS total,
       count(*) FILTER (WHERE p.status='publish' AND p.visibility='visibility_public') AS observable
FROM products p JOIN types t ON t.id = p.type_id
WHERE t.id IN (6,11) GROUP BY t.id ORDER BY t.id;
-- type_id | total | observable
--       6 |    55 |         54
--      11 |    31 |         31

SELECT p.id, p.status, p.visibility FROM products p
WHERE p.type_id IN (6,11) AND NOT (p.status='publish' AND p.visibility='visibility_public');
-- id 454 | draft | visibility_public
```

| type | filas | embebido en `products.json` | `types.json` = lo sembrado |
|---|---|---|---|
| 6 | 55 | `name:"Test"`, settings `{isHome:false, productCard:"krypton", layoutType:"standard"}` + 7 claves de arrays vacíos | `name:"Furniture"`, settings `{isHome:false, layoutType:"modern", productCard:"krypton"}` |
| 11 | 31 | `name:"Medicine"`, settings `{isHome:`**`true`**`, productCard:"helium", layoutType:"modern"}` + 7 claves de arrays vacíos | `name:"Medicine"`, settings `{isHome:`**`false`**`, productCard:"xenon", layoutType:"classic"}` |

Para el type 11 los tres valores de `settings` cambian: **`isHome` false→true,
`productCard` xenon→helium, `layoutType` classic→modern**. El flip de `isHome`
es relevante porque el shop lo lee. No es accionable en US-2: el seed sale de
`types.json` (`db/generate-seed.mjs:126-136`) y corregirlo sería tocar datos
fuera de scope. Se declara y se deja.

### Detalle de la divergencia 8 — cardinalidad de la búsqueda

R-2 del épico licencia un **orden** distinto; **no** licencia un conteo
distinto, así que va declarado aparte. Con la query real de la tienda
`name:apple;status:publish;visibility:visibility_public`:

```
fuse.js  -> 20 filas
contains -> 17 filas   (subconjunto estricto: no hay ninguna fila que solo tenga contains)
solo en fuse: 513 "Maple & Pecan Plait", 635 "Maple & Pecan Plait", 517 "Bon Appetit Cheese Croissant"
```

El `threshold: 0.3` de fuse (`products.service.ts:31`) acepta coincidencias
aproximadas que una subcadena no puede producir. **17 es el resultado
correcto**, no una regresión: el implementador NO debe "arreglarlo" ni
ensanchar el filtro para llegar a 20.

### Detalle de las divergencias 9 y 10 — filtros que el mock pierde

Ambas son casos en que Postgres hace lo que el contrato promete y el mock no.
Se declaran para que no se lean como regresiones:

- **9 — `shop_id` + otro filtro**: el mock aplica `shop_id` por
  `exactFilters` (`products.service.ts:65-67`), que sí filtra correctamente
  contra `product.shop.id` (`data = data.filter(p => p.shop.id ===
  exactFilters.shop_id)`) — el mecanismo NO falla ahí. El problema está
  justo después: si además hay algún token que caiga en `fuzzyFilters`
  (que es el caso de cualquier búsqueda real, p. ej. `name:apple`), el
  bloque `if (fuzzyFilters.length) { data = fuse.search(...) }`
  (líneas 69-75) **reasigna `data` desde cero**, corriendo `fuse.search()`
  sobre el índice completo de `products` (no sobre el `data` ya filtrado
  por shop) — así que el filtrado por `shop_id` se descarta en silencio, y
  el resultado final es exactamente el mismo que si `shop_id` nunca se
  hubiera enviado. Medido y reproducido contra el mock real (stash +
  restore del código original, no solo lectura del fuente):

  ```
  name:apple;shop_id:6  -> mock 20   (= name:apple solo, shop_id se pierde)
  shop_id:6 solo        -> mock 584  (shop_id SÍ funciona sin otro token)
  name:apple solo       -> mock 20
  name:apple;shop_id:6  -> Postgres 12   (AND real: name AND shop_id)
  ```

  El cambio user-visible es **20 → 12** (Postgres es más restrictivo, no
  menos: además de `name`, ahora también exige `shop_id`), no "0 → 12"
  como decía una versión anterior de este documento — esa cifra estaba
  mal. `shop_id` a solas sí funciona en ambos (584 en el mock, y el mismo
  filtro real en Postgres).
- **10 — `min_price`/`max_price`**: `fuse` no tiene esas claves en su
  configuración (`products.service.ts:20-30`), así que el token cae en
  `fuzzyFilters` y no matchea nada. Medido: `min_price:50` → **0 filas en el
  mock** vs. **195** en Postgres (`publish`/`public`, `price >= 50`). La UI de
  precio de la tienda sí envía el token (`price → min_price` en
  `format-products-args.ts:3-26`), así que esta divergencia es **visible para
  el usuario**: un filtro que hoy vacía la grilla pasará a devolver
  resultados.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Integration (`packages/db`) | `shopId` | solo seed: `listProducts({ shopId })` con un shop existente → `total > 0` y **todo** item con ese `shopId` |
| Integration | `manufacturerSlug` | dos aserciones sobre **slugs distintos**, ver abajo |
| Integration | `tagSlug` | dos aserciones sobre **slugs distintos**, ver abajo |
| E2E manual | CA-1..CA-5 | `curl` + `jq` + `just verify` (abajo) |

**`manufacturerSlug` — dos slugs, dos expectativas.** Sea `M_LIBRE` un
manufacturer del seed al que **ningún** producto apunta (el INSERT de
`products` no escribe `manufacturer_id`, así que sirve cualquiera) y `M_FIX`
otro manufacturer del seed, elegido como el que se enlaza a la fixture:

1. `listProducts({ manufacturerSlug: M_LIBRE.slug })` → `total === 0`.
   Documenta que la relación viene vacía del seed.
2. Se crea la fixture con `upsertScrapedProduct({ …, manufacturerId: M_FIX.id })`
   y entonces `listProducts({ manufacturerSlug: M_FIX.slug })` → `total === 1`
   y `items[0].sourceStore === TEST_STORE`. Prueba que el filtro discrimina de
   verdad.

`M_LIBRE.slug !== M_FIX.slug`: **son consultas a slugs distintos**, no la misma
consulta con dos resultados esperados.

**`tagSlug` — misma estructura.** `T_LIBRE` = tag del seed sin productos
(`product_tag` no se siembra) → `total === 0`; `T_FIX` = tag enlazado a la
fixture vía `upsertScrapedProduct({ …, tagIds: [T_FIX.id] })` → `total === 1`.

La fixture debe quedar listable: `upsertScrapedProduct` no escribe
`status`/`visibility`, así que toma los defaults del DDL
(`publish`/`visibility_public`, `db/schema.sql`), y necesita `price > 0` con
`salePrice < price` para no chocar con `products_rebaja_valida`. Puede ser una
sola fixture con `manufacturerId` **y** `tagIds` a la vez, siempre que las
consultas de los pasos 1 usen `M_LIBRE`/`T_LIBRE`.

Las fixtures reutilizan el `afterAll` ya existente
(`products.integration.test.ts:25-28`, borra por `sourceStore = 'TestStore-integration'`).
No se añaden tests unitarios: `apps/api/rest` no tiene runner con specs.
`strict_tdd: false`; el gate es `just db-check`.

## Verification Plan (satisface la DoD literalmente)

Prerrequisitos: `just db-up`, `just db-build`, `yarn install` en
`apps/api/rest`, `just build-api` o `just api-dev`.
`just verify` solo golpea `/api/settings` y cuenta `product-card` del SSR del
shop: la evidencia con `curl` directo es **obligatoria**.

```bash
Q='limit=30&searchJoin=and&with=type;author&search=status:publish;visibility:visibility_public'
# CA-1 — capturar ANTES del cambio (mock) y DESPUÉS (Postgres)
curl -s "http://localhost:9001/api/products?$Q" > mock.json     # antes
curl -s "http://localhost:9001/api/products?$Q" > pg.json       # después
diff <(jq -S 'del(.data)' mock.json) <(jq -S 'del(.data)' pg.json)   # envoltorio: 0 diff, per_page "30", total 1199
diff <(jq -S '[.data[]|keys]|unique' mock.json) <(jq -S '[.data[]|keys]|unique' pg.json)  # key-set: 0 diff
diff <(jq '[.data[].id]' mock.json) <(jq '[.data[].id]' pg.json)      # ids 1..30: 0 diff
diff <(jq -S . mock.json) <(jq -S . pg.json)                          # único diff esperado: id 2, in_flash_sale 1→0

# CA-2 — OJO: .total es 17 contra Postgres y 20 contra el mock. Es lo ESPERADO
# (divergencia 8: fuse.js matchea "Maple & Pecan Plait" x2 y "Bon Appetit Cheese
# Croissant", que no contienen la subcadena "apple"). NO es una regresión y NO
# se debe ensanchar el filtro para llegar a 20.
curl -s "http://localhost:9001/api/products?limit=30&search=name:apple;status:publish;visibility:visibility_public" | jq '.total, [.data[].name]'

# CA-3
just verify        # 3 servicios OK, cards:30

# CA-4 (sin reiniciar la API)
just db-shell   # UPDATE products SET name='CANARIO' WHERE id=1;
curl -s "http://localhost:9001/api/products?limit=5&search=name:CANARIO;status:publish;visibility:visibility_public" | jq '.total, .data[0].id, .data[0].name'
just db-shell   # UPDATE products SET name='Apples' WHERE id=1;

# CA-5
just db-down
curl -s -o body.json -w '%{http_code}\n' "http://localhost:9001/api/products?$Q"   # 503
cat body.json                                                                       # statusCode/message/error
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:9001/api/types            # 200 → el proceso Nest sigue vivo
just db-up

# Gate
just db-check
```

**Cierre documental (punto 5 de la DoD de la US, no es un comando)**: marcar
`docs/product/1-catalogo-desde-postgres/2-migrar-api-products-postgres.md`
como completada (campo **Status**, hoy "Listo para ejecución") y marcar la fila
de US-2 en la tabla de sub-historias de
`docs/product/1-catalogo-desde-postgres/README.md`. La US no se cierra sin
esos dos edits, y las 10 divergencias de la tabla de arriba van declaradas en
el `verify-report.md`.

## Migration / Rollout

No requiere migración de datos ni feature flag. Rollback: `git revert` del
commit + `just build-api`; los imports del mock nunca se quitaron, así que el
revert no reinstala nada (ver `proposal.md`).

## Open Questions

Ninguna bloqueante. Las dos `open_decisions` del `state.yaml` quedan cerradas
en las decisiones B y C.
