# Exploration: Migrar `/api/products` (listado) a Postgres vía `@safari/db`

> US-2 del Épico 1 (`docs/product/1-catalogo-desde-postgres/2-migrar-api-products-postgres.md`).
> Fase: sdd-explore. Solo lectura de código — ningún archivo de producción fue modificado.

## Current State

### 1. Contrato actual del endpoint (mock)

`apps/api/rest/src/products/products.controller.ts:28-31` expone
`GET /api/products` → `ProductsService.getProducts(query: GetProductsDto)`.

`GetProductsDto` (`apps/api/rest/src/products/dto/get-products.dto.ts:10-17`)
extiende `PaginationArgs` (`first`, `limit=15` por defecto, `page=1`,
`apps/api/rest/src/common/dto/pagination-args.dto.ts:1-6`) y declara además:
`orderBy?`, `sortedBy?`, `searchJoin?`, `search?`, `date_range?`, `language?`.
**Ninguno de `orderBy`, `sortedBy`, `searchJoin`, `date_range`, `language` se
usa hoy dentro de `getProducts()`** (`products.service.ts:45-83`) — son
aceptados por el DTO/Swagger pero silenciosamente ignorados. Es un quirk del
mock a documentar, no a replicar por analogía (nada obliga a implementar
`orderBy`/`sortedBy` en US-2; ver Gaps).

Lógica real de `getProducts()` (`products.service.ts:45-83`):
- `page` default 1, `limit` default 30 (el default de `PaginationArgs` es 15,
  pero se sobreescribe aquí a 30 con `if (!limit) limit = 30`).
- `search` es una cadena `"key:value;key:value"` que se parte por `;` y luego
  por `:` (primer índice). Si `key === 'shop_id'` va a `exactFilters` (con
  `parseInt`); si `key === 'slug'` se descarta; el resto va a `fuzzyFilters`
  como objetos `{ [key]: value }`.
- Si hay `exactFilters.shop_id`, filtra `data` en memoria por
  `product.shop.id === shop_id`.
- Si hay `fuzzyFilters`, **reemplaza `data` completo** con
  `fuse.search({ $and: fuzzyFilters })` — el `fuse` es una instancia GLOBAL
  construida sobre `products` (todo el catálogo, `products.service.ts:33`),
  no sobre el `data` ya filtrado por `shop_id`. **Bug preexistente**: si se
  combinan `shop_id` con otro filtro fuzzy, el filtro de `shop_id` se pierde
  silenciosamente (el segundo `data = fuse.search(...)` lo sobreescribe). No
  se replica en Postgres — el repositorio ya hace AND real de todos los
  filtros (ver más abajo); documentado como divergencia aceptable de
  comportamiento, no de contrato de shape.
- `fuse` se construye con `keys: ['name', 'type.slug', 'categories.slug',
  'status', 'shop_id', 'author.slug', 'tags', 'manufacturer.slug',
  'visibility']` y `threshold: 0.3` (`products.service.ts:19-33`).
- Paginación: `data.slice(startIndex, endIndex)` + `paginate(...)`.

Envoltorio de paginación — `paginate()` (`apps/api/rest/src/common/pagination/paginate.ts:56-75`),
usa `PaginatorInfo` (`apps/api/rest/src/common/dto/paginator-info.dto.ts:1-14`).
Claves exactas emitidas junto a `data`: `total`, `current_page`, `count`,
`last_page`, `firstItem`, `lastItem`, `per_page`, `first_page_url`,
`last_page_url`, `next_page_url`, `prev_page_url`. Nota real (no legible como
bug pero SÍ contrato a preservar): `prev_page_url` usa la MISMA fórmula que
`next_page_url` (`current_page` en vez de `current_page - 1`,
`paginate.ts:66-73`) — apunta a la página actual, no a la anterior. `url` se
arma como `` `${APP_URL}${url}&page=N}` `` con `APP_URL =
'http://localhost:5000/api'` HARDCODEADO (`apps/api/rest/src/common/constants.ts:1`),
que ya NO coincide con el puerto real de la API (9001, por Zscaler en el
9000). Esto es un defecto preexistente e independiente de esta migración —
se documenta como observación, no se corrige aquí (fuera de scope).

`Product` entity: `apps/api/rest/src/products/entities/product.entity.ts:21-58`.
Nota clave: **NO existe campo `author`** en la entidad (ni en el mock ni en
Postgres) — ver Gaps.

### 2. Uso real desde la tienda

`apps/shop/src/framework/rest/client/index.ts:112-142` (`products.all`) es la
fuente de verdad citada por la US. Construye la request así:
```
GET /products?searchJoin=and&with=type;author&limit=<n>&...params
    &search=<formatSearchParams(...)>
```
`formatSearchParams` (`apps/shop/src/framework/rest/client/http-client.ts:236-245`)
filtra valores falsy y serializa `key:value` unido por `;`, con la regla:
si `key` ∈ `['type','categories','tags','author','manufacturer','shops']` →
emite `key.slug:value` en vez de `key:value`.

Los campos que `client.products.all` puede enviar en `search=` son
(`ProductQueryOptions`, `apps/shop/src/types/index.ts:98-116`): `type`,
`categories`, `name`, `shop_id`, `author`, `manufacturer`, `min_price`,
`max_price`, `tags`, más `status:'publish'` y `visibility:'visibility_public'`
**hardcodeados y SIEMPRE presentes** (`client/index.ts:139-140`) — todas las
consultas de catálogo de la tienda excluyen borradores y productos no
públicos por defecto.

`formatProductsArgs` (`apps/shop/src/framework/rest/utils/format-products-args.ts:3-26`,
usado por `apps/shop/src/framework/rest/product.ts:26-32`) traduce alias del
UI antes de llegar al cliente: `price → min_price`, `searchType → type`,
`searchQuery|text → name`. Estos tres nunca llegan crudos al backend.

Ejemplo real de request por defecto (home, `just verify`/CA-1):
`GET /api/products?limit=30&searchJoin=and&with=type;author&search=status:publish;visibility:visibility_public`
Con filtro por tipo (páginas de categoría de producto,
`apps/shop/src/framework/rest/home-pages.ssr.ts:79-89`): se añade
`type: pageType` a las variables (`type.slug:<pageType>` en `search=`).

**`author` nunca se envía en la práctica** para este catálogo (electrónica):
es un campo heredado de Pickbazar (demo "book"); no hay UI de safari-shop que
lo setee fuera de esa demo. Se inventaría como filtro no soportado (ver Gaps)
pero de bajísimo riesgo real.

### 3. Precedente — `/api/settings` (único endpoint ya en Postgres)

`apps/api/rest/src/settings/settings.service.ts:1-60`:
- Import directo de la función del repositorio: `import { getSettings } from
  '@safari/db'` (barrel del paquete, no `@prisma/client`).
- Traducción camelCase → snake_case manual en el `return` (`id, options,
  language, created_at: row.createdAt, updated_at: row.updatedAt`).
- Manejo de error: SOLO cubre el caso "fila no existe" (`if (!row) throw new
  InternalServerErrorException('...')`, mensaje claro en español). **NO
  captura errores de conexión a Postgres** (p. ej. `PrismaClientInitializationError`
  cuando `just db-down`) — no hay try/catch alrededor de `getSettings()`.
- `SettingsController` (`apps/api/rest/src/settings/settings.controller.ts`)
  no añade manejo de errores propio.
- No hay ningún `ExceptionFilter` global registrado en
  `apps/api/rest/src/main.ts:1-20` ni en `app.module.ts` (confirmado por
  búsqueda: cero archivos `*filter*`/`*exception*` en `src/`). Nest usa su
  filtro base por defecto: una excepción no capturada (incluida una excepción
  async de Prisma) se traduce a `500 {"statusCode":500,"message":"Internal
  server error"} ` sin crashear el proceso — pero el mensaje es genérico, NO
  "legible" en el sentido de CA-5 (que pide un cuerpo JSON claro). El
  precedente de settings, tal cual, **no cumple completamente CA-5**: cubre
  el caso "base sembrada mal" con mensaje claro, pero no el caso "Postgres
  apagado" con un mensaje específico — ver Gaps / Approaches.

### 4. Capa de datos — estado real (packages/db)

`packages/db/src/repositories/products.repository.ts`:
- `ListProductsInput` (líneas 112-128) ya cubre: `typeSlug`, `categorySlug`,
  `shopId`, `name` (contains/insensitive), `minPrice`, `maxPrice`,
  `manufacturerSlug`, `tagSlug`, `status`, `visibility`, `page`, `limit`
  (default 30, `DEFAULT_PAGE_SIZE`, línea 158).
- `buildWhere()` (líneas 164-192): aplica `status ?? 'publish'` y
  `visibility ?? 'visibility_public'` SIEMPRE (coincide con lo que el shop
  manda siempre) y hace AND real de todos los filtros presentes — a
  diferencia del mock, que puede perder el filtro `shop_id` al combinarlo con
  otros (bug ya descrito).
- `listProducts()` (líneas 199-221): pagina por offset (`skip/take`), ordena
  `id: 'asc'` (mismo orden que el mock, que sirve el JSON tal cual y coincide
  con id ascendente), y usa `Promise.all([findMany, count])`. Devuelve
  `{ items: ProductRecord[], total }` — SIN el envoltorio de paginación (eso
  lo arma el caller con `buildPaginator`).
- Comentario de cabecera (líneas 1-17) confirma que `ListProductsInput` es
  "espejo de lo que `formatSearchParams()` del shop serializa" — el
  repositorio fue diseñado explícitamente contra el contrato real de la
  tienda, no contra el mock.
- Ya existe manejo de errores de dominio para ESCRITURA (`InvalidSalePriceError`,
  `MissingPriceError`, `IncompleteProvenanceError`, líneas 363-410) — son del
  lado del scraper (upsert), no aplican al listado de lectura de US-2.

`packages/db/src/pagination.ts` — `buildPaginator()` (líneas 37-65)
**reproduce EXACTAMENTE** el shape de `paginate.ts` del mock, incluida la
rareza de `prev_page_url` (comentario explícito en cabecera, líneas 1-11: "se
copia tal cual para no cambiar el contrato"). Única divergencia documentada:
`first_page_url`/etc. son `null` si no se pasa `baseUrl` (el mock siempre
arma una URL con `APP_URL` hardcodeado). **Esta pieza ya está lista y
alineada con D-1/D-2 y el precedente de settings** — no requiere cambios
para US-2.

`packages/db/src/records.ts` (líneas 1-217): frontera de serialización.
`_id()` convierte `BigInt → number`, `_dec()` convierte `Decimal → number`.
`ProductRecord` (en `products.repository.ts:59-100`) ya es 100% JSON-safe
(fechas quedan `Date`, se serializan a ISO en el borde HTTP de Nest). No hay
`_toProductRecord` en `records.ts` — vive dentro de `products.repository.ts`
(líneas 416-461) porque el include (`PRODUCT_INCLUDE`) es propio de ese
repositorio.

`packages/db/src/errors.ts` (líneas 1-243): utilidades genéricas
`isPrismaError`, `isPrismaConnectionError`, `isPrismaTimeoutError`,
`isPrismaConstraintError`, `parsePrismaError`, `getUserFriendlyMessage`.
**Existen y están exportadas pero NINGÚN consumidor las usa todavía**
(ni `settings.service.ts` ni ningún repositorio las importa) — son la pieza
que falta enganchar para cumplir CA-5 de forma "legible" de verdad.

`packages/db/src/health.ts` (líneas 1-33): `pingDatabase()` hace `SELECT 1`
con timeout y devuelve `{ ok, latencyMs, error? }` sin lanzar — pensado para
un endpoint `/health`, no para el path de listado. No es el mecanismo a usar
dentro de `getProducts()` (sería una llamada extra); el patrón correcto para
CA-5 es capturar la excepción real de Prisma en el `try/catch` del servicio
y traducirla con `getUserFriendlyMessage`/`parsePrismaError`.

`packages/db/src/client.ts` (líneas 1-45): `prisma` es un Proxy de
inicialización perezosa — falla rápido con mensaje claro SOLO si falta
`DATABASE_URL` (no si Postgres está apagado con la URL presente; en ese caso
la excepción es de Prisma en tiempo de query, capturable por `errors.ts`).

### 5. Lista de gaps (mock vs. repositorio/schema)

| Param/comportamiento del mock | ¿Lo cubre `ListProductsInput` hoy? | Nota |
|---|---|---|
| `name` (contains/insensitive) | Sí (`name`, trgm) | Ya cubierto y probado en integración |
| `type.slug` | Sí (`typeSlug`) | Probado en integración |
| `categories.slug` | Sí (`categorySlug`) | **Siempre 0 resultados**: `category_product` vacía por diseño (README del épico, confirmado en `db/schema.sql:293-304`). Esperado, no es bug de esta US. |
| `shop_id` | Sí (`shopId`) | Repositorio hace AND real; el mock lo pierde al combinar con fuzzy filters (bug del mock, no se replica) |
| `manufacturer.slug` | Sí (`manufacturerSlug`) | Sin test de integración todavía |
| `tags.slug` | Sí (`tagSlug`, singular) | El shop manda un solo valor por filtro (`tags` es un string, no array, en `ProductQueryOptions`); coincide con `tagSlug` singular del repo. Sin test de integración todavía |
| `min_price` / `max_price` | Sí (`minPrice`/`maxPrice`) | Probado en integración |
| `status` / `visibility` | Sí (con default) | Cubierto |
| `author.slug` | **No** — no existe `author` en `db/schema.sql`, en `Product.entity.ts` ni en el repositorio (búsqueda global sin resultados) | La tienda real (safari-shop, catálogo de electrónica) nunca lo envía — es un campo heredado de la demo "book" de Pickbazar. Se documenta como NO soportado; fuera de scope de US-2 (no hay columna que consultar) |
| `orderBy` / `sortedBy` | No — el mock tampoco los implementa (aceptados por el DTO, ignorados por `getProducts()`) | No hay obligación de implementarlos en US-2: el mock no los soporta hoy, así que no hay contrato de comportamiento que preservar, solo de shape (el campo puede seguir aceptándose y ser ignorado) |
| `searchJoin` | El shop siempre manda `'and'`; el mock lo ignora (siempre hace `$and`) | Repositorio ya hace AND real de todos los filtros — coincide de facto |
| `date_range` | No usado por `getProducts()` en el mock tampoco | Sin acción |
| `language` | Aceptado por el DTO, no usado por `getProducts()` | Sin acción — el catálogo no tiene variantes por idioma en el seed actual |
| Orden de resultados con `fuzzyFilters` (ranking de Fuse.js) | No aplica — Postgres usa `ORDER BY id ASC` siempre | Aceptado por R-2 del épico: contrato de shape se preserva, el ranking no |

### 6. Camino de errores

Hoy (mock): cualquier excepción no capturada en un controller/service de Nest
cae en el filtro de excepciones base de Nest → `500` con cuerpo JSON genérico
(`{"statusCode":500,"message":"Internal server error"}`), sin crash del
proceso (confirmado: no hay `ExceptionFilter` custom en `apps/api/rest/src`,
ver búsqueda arriba). Esto significa que el CA-5 ("error HTTP controlado, no
un crash del proceso Nest") se cumpliría de forma MÍNIMA incluso sin tocar
nada — pero el mensaje sería genérico, no "legible" en el sentido de
"cuerpo JSON claro" que pide la CA. El patrón correcto, siguiendo D-2 y las
utilidades ya existentes en `@safari/db`, es: capturar la excepción real de
Prisma en el propio `ProductsService` (`try/catch` alrededor de la llamada a
`listProducts`), usar `isPrismaConnectionError`/`getUserFriendlyMessage` de
`@safari/db` para detectar el caso "Postgres caído", y lanzar una
`ServiceUnavailableException` (503, más semánticamente correcta que 500 para
"la base no responde") con el mensaje amigable. Ningún otro tipo de error de
Prisma (constraint, etc.) aplica al PATH DE LECTURA de listado — solo importa
para escritura, fuera de scope de US-2 (el `create`/`update`/`remove` del
controller de products quedan como stubs del mock, US-2 no los toca).

### 7. Arnés de verificación

- `just db-up` — levanta Postgres 16 en Docker (puerto 5433), aplica
  `db/schema.sql` vía `just db-migrate` (idempotente), siembra con
  `db/seed.sql` (`justfile:258-273`).
- `just db-build` (`justfile:317-322`, `working-directory: packages/db`) —
  `npm install && npm run build` (Prisma generate + tsup → `dist/`).
  **Obligatorio tras clonar**: `packages/db/dist` está gitignored.
- `just db-check` (`justfile:324-329`) — `npm run typecheck && npm test`
  dentro de `packages/db`; requiere `just db-up` antes. Es el único gate de
  test verde del repo hoy (`openspec/config.yaml` lo confirma como
  `testing.test_command`).
- `just verify` (`justfile:168-199`) — golpea `API :9001 /api/settings`,
  `Shop :3003 /en`, `Admin :3002 /en/login`; cuenta ocurrencias de
  `product-card` en el HTML de la respuesta del shop. La home del shop en
  `/en` llama a `client.products.all` vía `home-pages.ssr.ts` (SSR), así que
  `just verify` **ejercita indirectamente** el endpoint migrado (aunque no
  golpea `/api/products` directo — solo `/api/settings` en la lista de
  targets).
- `just db-shell` (`justfile:290-291`) — psql interactivo, usado por el
  patrón CA-4 (UPDATE manual + curl + revert, precedente commit `41f4e7d`).
- Enlace del paquete: `apps/api/rest/package.json:31` declara
  `"@safari/db": "link:../../../packages/db"` — `apps/api/rest` está FUERA
  del workspace de yarn raíz (confirmado por `CLAUDE.md`), así que requiere
  su propio `yarn install` tras enlazar/actualizar `packages/db`.

### 8. Comparación de enfoques para la capa de servicio

**Opción A — Traducción inline en `ProductsService`** (patrón exacto de
`settings.service.ts`):
- El servicio importa `listProducts` de `@safari/db`, llama con los filtros
  parseados del `search=` (reutilizando el parseo `key:value;key:value` ya
  existente, adaptado para leer `type.slug`→`typeSlug`, etc.), arma
  `{ data, ...buildPaginator(...) }` con traducción camelCase→snake_case
  producto por producto en el mismo método.
- Pros: mismo patrón que el único precedente ya aceptado (`settings`);
  cero archivos nuevos; fácil de revisar contra CA-1 byte a byte.
- Contras: la traducción de `ProductRecord` (camelCase, ~35 campos incluidas
  relaciones anidadas `type`/`shop`/`manufacturer`/`categories`/`tags`) es
  bastante más grande que la de `Setting` (5 campos planos) — el método
  puede crecer y mezclar parseo de query + traducción de shape.
- Effort: Medium.

**Opción B — Mapper module dedicado** (`products/product.mapper.ts` o
similar, con una función pura `toProductDto(record: ProductRecord): Product`
+ un parser de `search=` separado):
- El servicio queda delgado: parsea filtros → llama al repositorio → pasa el
  resultado al mapper → arma el paginador.
- Pros: la traducción de shape (35 campos, relaciones anidadas) queda
  testeable de forma aislada sin levantar Postgres; más fácil de reutilizar
  en US-3 (detalle por slug), que necesita el MISMO mapper de `Product` +
  `related_products`.
- Contras: introduce un archivo nuevo que el precedente de settings no tiene
  (settings es demasiado chico para justificarlo); más superficie a revisar
  en una US de ~300 LOC estimadas.
- Effort: Medium (similar a A, pero mejor organizado para lo que viene en
  US-3, que la propia US-2 no debe implementar pero sí puede facilitar).

**Recomendación**: Opción B, pero con el mapper viviendo dentro de
`products.service.ts` como funciones privadas (no un archivo nuevo todavía)
si el volumen real de código lo permite dentro del LOC estimado (~300); si al
implementar se ve que el mapper + parser superan ~80-100 líneas, separarlo a
un archivo (`products/products.mapper.ts`) queda como decisión de diseño
(sdd-design), no de esta exploración. La razón para inclinarse hacia mapper
aislado (aunque sea en el mismo archivo) es que US-3 (detalle por slug)
depende de US-2 y reutilizará la misma traducción `ProductRecord → Product`
— extraerla como función nombrada (no bloque inline) reduce duplicación
futura sin añadir un archivo que hoy no se justifica.

## Affected Areas

- `apps/api/rest/src/products/products.service.ts` — reemplazar
  `getProducts()` (mock+fuse) por `listProducts()` de `@safari/db` +
  traducción camelCase→snake_case + `buildPaginator`. Los otros métodos
  (`getProductBySlug`, `getPopularProducts`, `getBestSellingProducts`,
  `getProductsStock`, `getDraftProducts`, `create/update/remove`) NO son
  parte de esta US (US-3 para detalle; popular/best-selling quedan
  inventariados sin decidir; stock/draft/create/update/remove no
  mencionados por la US, se dejan intactos).
- `apps/api/rest/src/products/products.controller.ts` — no requiere cambios
  de shape (ya delega en el servicio); posible ajuste menor de manejo de
  excepciones si se decide un filtro local (no obligatorio, ver Approaches).
- `packages/db/src/repositories/products.repository.ts` — `ListProductsInput`
  ya cubre todos los filtros reales de la tienda salvo `author` (no existe
  en el schema, no accionable). No requiere ampliación de filtros para
  cumplir el "Incluye" de la US.
- `packages/db/src/repositories/products.integration.test.ts` — tiene
  cobertura para `typeSlug`, precio, `name`, paginación; falta cobertura
  explícita de `shopId`, `manufacturerSlug`, `tagSlug` combinados (gap menor,
  no bloqueante — el filtro ya funciona, solo falta el test).
- `apps/api/rest/src/common/pagination/paginate.ts` — sirve de referencia de
  contrato, no se toca (el equivalente en `@safari/db` ya replica su shape).
- `packages/db/src/errors.ts` — candidatas `isPrismaConnectionError` /
  `getUserFriendlyMessage` a importar desde `products.service.ts` para CA-5;
  no requiere cambios en el archivo mismo.

## Approaches

1. **Traducción inline (patrón settings, Opción A arriba)** — método único
   en `ProductsService` que parsea `search=`, llama a `listProducts`, arma
   el paginador y traduce camelCase→snake_case en el mismo bloque.
   - Pros: paridad de patrón exacta con el único precedente aceptado; menor
     superficie de revisión.
   - Cons: método largo (~35 campos de traducción + parseo de filtros);
     nada reutilizable para US-3 sin copiar/pegar.
   - Effort: Medium.

2. **Mapper/parser como funciones nombradas dentro del mismo servicio
   (Opción B, recomendada)** — separar `parseProductSearch(search: string):
   ListProductsInput` y `toProductDto(record: ProductRecord): Product` como
   funciones puras testeables, sin crear un archivo nuevo todavía.
   - Pros: reutilizable literal por US-3 (mismo mapper de detalle);
     testeable sin necesidad de mockear Nest; mantiene el LOC dentro de lo
     estimado sin archivo adicional.
   - Cons: ligera desviación de "un método = un endpoint" que tiene
     settings; requiere que sdd-design decida si el mapper merece archivo
     propio cuando llegue US-3.
   - Effort: Medium.

## Recommendation

Opción 2 (mapper como funciones nombradas dentro de `products.service.ts`,
sin archivo nuevo en esta US). Sigue D-1 (el servicio consume el
repositorio, nunca `@prisma/client` directo) y D-2 (el servicio traduce
camelCase→snake_case, igual que settings), y dobla como preparación directa
para US-3 sin expandir el scope de esta US-2 (no se toca `getProductBySlug`
ni se crea el archivo del mapper todavía — esa decisión se documenta como
abierta para sdd-design, no se resuelve aquí).

Para CA-5, envolver la llamada a `listProducts` en un `try/catch` que use
`isPrismaConnectionError`/`getUserFriendlyMessage` de `@safari/db` y lance
`ServiceUnavailableException` (503) con el mensaje amigable — el precedente
de settings NO cubre este caso hoy (solo cubre "fila ausente"), así que no
basta con copiarlo tal cual.

## Risks

- **R-1 (del épico, confirmado)**: el shape de paginación debe reproducirse
  exacto o rompe el scroll infinito de la tienda. Mitigado: `buildPaginator`
  de `@safari/db` ya replica el shape byte a byte, incluida la rareza de
  `prev_page_url`. Verificar igual con curl antes/después en la fase de
  verify (no se ejecutó en esta exploración, es evidencia de DoD).
- **R-2 (del épico, confirmado)**: el orden de resultados con `fuzzyFilters`
  vía Fuse.js no se puede replicar con `contains/insensitive` de Postgres.
  Aceptado por el épico — documentar en el reporte final, no perseguir
  paridad de ranking.
- **Gap CA-5 no cubierto por el precedente**: `settings.service.ts` no
  captura errores de conexión a Postgres; replicarlo tal cual dejaría CA-5
  cumplido solo de forma mínima (500 genérico del filtro base de Nest, no un
  "cuerpo JSON claro"). Hay que enganchar explícitamente
  `isPrismaConnectionError`/`getUserFriendlyMessage` de `errors.ts`, que hoy
  existen pero no tienen ningún consumidor.
- **`category_product` vacía por diseño**: cualquier request con
  `categories.slug` devolverá 0 resultados tanto en el mock como en
  Postgres — comportamiento esperado, no un defecto a introducir ni a
  arreglar en esta US (confirmado en `db/schema.sql:293-304` y en el README
  del épico).
- **`APP_URL` hardcodeado a `localhost:5000`** (`apps/api/rest/src/common/constants.ts:1`)
  ya no coincide con el puerto real (9001); es un defecto preexistente
  independiente de esta migración. Se menciona como observación — NO se
  corrige en US-2 (fuera de su scope; no está en el "Incluye").
- **Bug de combinación `shop_id` + fuzzy filters en el mock**: el
  comportamiento de Postgres (AND real) diverge del mock (pierde `shop_id`).
  Es una mejora de facto, pero técnicamente un cambio de comportamiento no
  cubierto por ningún CA explícito — vale la pena mencionarlo en el reporte
  de verify si algún CA lo llegara a ejercitar (no parece ser el caso: la
  tienda nunca combina `shop_id` con otros filtros en el mismo request hoy).

## Observaciones fuera de scope (NO accionar en esta US)

- `APP_URL` hardcodeado con puerto incorrecto (`common/constants.ts:1`).
- El mock ignora `orderBy`/`sortedBy`/`date_range`/`language` en
  `getProducts()` — no hay contrato de comportamiento que preservar, pero
  tampoco se implementan en US-2.
- `popular-products` / `best-selling-products` siguen en JSON estático
  (`GetPopularProductsDto`/`GetBestSellingProductsDto`, `products.service.ts:96-112`)
  — explícitamente UNDECIDED por la US ("inventariarlos y decidir en el
  design"); quedan inventariados aquí, no decididos.
- Cobertura de integración faltante para `shopId`/`manufacturerSlug`/`tagSlug`
  combinados en `products.integration.test.ts` — el filtro ya funciona en el
  repositorio, solo falta el test explícito.
- `products-stock`, `draft-products`, `create`/`update`/`remove` de
  `ProductsController` quedan intactos en el mock — no mencionados por la US.

## Ready for Proposal

**Sí.** El contrato actual, el precedente de settings, la capa de datos y el
arnés de verificación están completamente inventariados con cita de
archivo:línea. La única decisión de diseño abierta (mapper inline vs. archivo
separado, y el destino final de popular/best-selling) queda explícitamente
para `sdd-design`, tal como pide la US ("decidir en el design"). El
orquestador puede avanzar a `sdd-propose` con este documento como insumo.
