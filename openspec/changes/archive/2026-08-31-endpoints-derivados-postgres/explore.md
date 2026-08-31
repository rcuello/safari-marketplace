# Exploration: US-5 — Endpoints derivados del catálogo desde Postgres

## Current State

### Los 6 métodos, contrato verificado con la API viva (mock, puerto 9001)

**1. `ProductsService.getPopularProducts({ limit, type_slug })`**
(`apps/api/rest/src/products/products.service.ts:238-244`, ruta
`GET /api/popular-products`, controller `PopularProductsController`)
- Sin `type_slug`: devuelve un **array plano** (no paginado) de
  `popular-products.json` recortado a `limit` (`limit` ausente → 10, el
  tamaño completo del JSON). Verificado: `curl .../popular-products` → 10
  items; `?limit=3` → 3 items `[4,1,3]`.
- Con `type_slug`: **ignora por completo `popularProducts`** y hace
  `fuse.search(type_slug)` sobre el `Fuse` construido con el catálogo
  COMPLETO (`products`, no `popularProducts`). Verificado:
  `?type_slug=grocery&limit=3` → `[1,2,3]` (orden de `products.json`, NO
  las curadas `[4,1,3,...]`). Es decir: **hoy, filtrar por type_slug rompe
  el propósito de "popular"** — devuelve productos cualesquiera de ese type,
  no los rankeados. Esto es un comportamiento existente, no introducido por
  esta US; hay que decidir en diseño si se preserva (bug-compatible) o se
  corrige (filtrar los rankeados por `type.slug`).
- `shop_id` está declarado en `GetPopularProductsDto` pero **no se usa en
  ninguna rama del método** — parámetro muerto ya en el mock.
- Cada item trae 40+ claves (el shape completo de `products.json`
  enriquecido con `orders_count`, `ratings`, `total_reviews`,
  `rating_count`, `type`, `shop` anidados completos) — NO la proyección de
  20 claves que usa `getProducts()`. Preservar esto tal cual sería costoso;
  ver Approaches.

**2. `ProductsService.getBestSellingProducts({ limit, type_slug })`**
(líneas 245-254, ruta `GET /api/best-selling-products`) — mismo patrón
exacto que (1) pero sobre `bestSellingProducts` (5 ids:
`888,892,887,883,946`). Mismo bug de `type_slug` (fuse sobre el catálogo
completo). Verificado `?type_slug=books&limit=3` → `[883,884,885]` (NO
`[888,892,887]`).

**3. `ProductsService.getProductsStock({ limit, page, search })`**
(líneas 256-289, ruta `GET /api/products-stock`) — **paginado**
(`ProductPaginator`: `data/total/current_page/count/last_page/...`).
Filtra `this.products` (TODOS los status/visibility, sin el default que sí
aplica `listProducts()`) por `quantity <= 9`. Verificado: `total: 11`,
`data` en orden ascendente de id `[2, 190, 1014, ...]`. Con `search`
trocea `key:value;...` e invoca `fuse.search({$and:[...]})` sobre el
catálogo completo (no solo el subconjunto de stock bajo) — comportamiento
ya cuestionable en el mock, no se toca su semántica de búsqueda, solo el
origen del dato base.
- **Ninguno de los 11 productos con `quantity<=9` es el draft** (`id 454`,
  `quantity 30`) — verificado en Postgres. Coincidencia útil: reusar
  `listProducts()` (que por defecto fuerza `status:'publish',
  visibility:'visibility_public'`) da HOY el mismo resultado que el mock
  (que no filtra por status), pero diverge semánticamente: un futuro
  producto con `quantity<=9` y `status:'draft'` o visibilidad no pública
  desaparecería en silencio de este endpoint con `listProducts()`, cosa que
  el mock no hacía. Señalarlo en diseño.

**4. `ProductsService.getDraftProducts({ limit, page, search })`**
(líneas 291-326, ruta `GET /api/draft-products`) — mismo shape paginado.
Filtra `status === 'draft'`, mismo patrón de `search`. Verificado:
`total: 1`, `data: [{id: 454, status: 'draft'}]`. `ListProductsInput` YA
admite `status`, así que `listProducts({status:'draft'})` sirve esto hoy
sin tocar el repositorio (confirmado, coincide con el hecho ya verificado
por el orquestador) — mismo caveat de visibility-default que (3), pero
también coincide byte a byte hoy (el único draft es `visibility_public`).

**5. `ShopsService.getNewShops({ search, limit, page })`**
(`apps/api/rest/src/shops/shops.service.ts:109-132`, ruta
`GET /api/new-shops`) — paginado. Filtra
`Boolean(shopItem.is_active) === false` sobre `this.shops` (de
`shops.json`). **Verificado en runtime: `total: 0`, `data: []`** — los 9
shops de `shops.json` tienen TODOS `is_active: 1`; no existe ningún shop
"nuevo" (inactivo) en el mock. `db/generate-seed.mjs:152` también fuerza
`is_active` a `true` por defecto para los recuperados, y la base real
confirma: **las 12 filas de `shops` tienen `is_active = true`** (verificado
con `SELECT id, is_active FROM shops`). Migrar con
`listShops({isActive:false})` (el filtro YA existe en `ListShopsInput`,
default `?? true`) preserva el contrato byte a byte: seguirá devolviendo
`total:0` hasta que exista algún shop inactivo. No hay bug que corregir ni
dato que enriquecer aquí — solo cablear el filtro existente.

**6. `ShopsService.getNearByShop(lat, lng)`**
(línea 171-173) — **la ruta real NO es `/api/near-shop`** (eso da **404**,
confirmado) sino
`@Controller('near-by-shop') GET /api/near-by-shop/:lat/:lng` (params de
ruta, no query string) — `apps/api/rest/src/shops/shops.controller.ts:108-116`.
El método **ignora `lat`/`lng` por completo**: `return nearShops;` donde
`nearShops` es la const de módulo (`plainToClass(Shop, nearShopJson)`,
línea 28) — **NO** la propiedad de instancia `this.nearShops` (línea 69,
asignada a `shops`, el catálogo completo de tiendas — ese campo es código
muerto, nunca leído). Verificado: `curl .../near-by-shop/40.7/-74.0` y
`curl .../near-by-shop/0/0` devolverían el mismo array — no hay filtro real
por distancia, solo se sirven las 6 tiendas fijas de `near-shop.json`
(ids `2,6,1,5,4,3`, en ese orden arbitrario, exactamente los 6 shops que sí
tienen `settings.location.lat/lng` reales — confirmado en Postgres:
mismos 6 ids, mismas coordenadas). El CA-3 de la US ("ignora las tiendas
sin coordenadas") describe la intención correcta, pero implementarla
literalmente (filtrar + ordenar por distancia real) sería una MEJORA de
comportamiento, no una migración byte-compatible del mock actual (que ni
filtra ni ordena por distancia: solo sirve una lista fija). Esto es una
decisión de diseño explícita a tomar, no algo que el explore deba resolver.

## Affected Areas

- `apps/api/rest/src/products/products.service.ts` — migrar
  `getPopularProducts`, `getBestSellingProducts`, `getProductsStock`,
  `getDraftProducts`; imports `popularProductsJson`, `bestSellingProductsJson`
  quedan huérfanos; `Fuse`/`fuse`/`options` quedan huérfanos SI ninguno de
  los 4 métodos migrados conserva el fallback de búsqueda difusa (ver
  Approaches). `productsJson`/`products` **NO** se tocan: los sostienen
  `create()`/`update()` (stubs de escritura, fuera de alcance).
- `apps/api/rest/src/shops/shops.service.ts` — migrar `getNewShops`,
  `getNearByShop`; import `nearShopJson` y la const `nearShops` quedan
  huérfanos; la propiedad `private nearShops: Shop[] = shops` (línea 69) es
  código YA muerto hoy (nunca leída) — se puede retirar junto con la
  migración. `Fuse`/`fuse`/`options` quedan huérfanos si `getNewShops`
  deja de necesitar el fallback difuso de `search` (su `search` hoy solo
  se usa para dsparar `fuse.search(value)` sin `$and`, un patrón más simple
  que products). `shopsJson`/`shops` **NO** se tocan: los sostienen
  `create()`, `update()`, `getStaffs()`, `disapproveShop()`, `approveShop()`.
- `apps/api/rest/src/products/products.controller.ts`,
  `shops.controller.ts` — sin cambios de firma esperados (mismas rutas,
  mismos DTOs); confirmar que `NearByShopController` sigue usando
  `:lat/:lng` como params de ruta.
- `packages/db/src/repositories/products.repository.ts` — `ListProductsInput`
  necesita: (a) un criterio de orden parametrizable (hoy `orderBy: {id:'asc'}`
  fijo) para servir "popular" (¿por `ratings`?) y "más vendido" (¿por
  `soldQuantity`?) con criterios DISTINTOS — el propio doc de la US señala
  que si no se distinguen, ambos endpoints ordenarían igual; (b) un filtro
  `maxQuantity` (o similar) para `getProductsStock`; status/visibility YA
  soportados para `getDraftProducts`.
- `packages/db/src/repositories/shops.repository.ts` — `ListShopsInput.isActive`
  YA sirve `getNewShops` sin cambios. `getNearByShop` necesita una función
  nueva (p.ej. `listShopsNear(lat, lng)`) que: filtre
  `settings->'location'` no vacío (6 de 12 shops lo tienen — confirmado en
  Postgres: shops 1-6 con lat/lng, shops 7/9/11 con `[]`, shops 12/14/15
  sin la clave `location`), calcule distancia (haversine) y ordene. Con
  solo 12 filas totales, es razonable traer las candidatas con Prisma
  (`where: settings no nulo`) y hacer el cálculo/orden en JS, sin
  necesidad de raw SQL/PostGIS — coherente con que el resto del paquete no
  usa `$queryRaw`.
- `db/generate-seed.mjs` — el INSERT de `products` (líneas 228-247) hoy
  emite `ratings` desde `p.ratings ?? 0` (que en `products.json` no existe
  → siempre 0) y **NO emite `total_reviews`** en absoluto (la columna
  existe en el schema pero el INSERT no la lista). Hay que: (a) agregar
  `total_reviews` a la lista de columnas/valores; (b) antes de emitir cada
  fila, buscar el id en un mapa `id → {ratings, total_reviews,
  sold_quantity-o-lo-que-se-decida}` construido a partir de
  `popular-products.json` (10 ids) y `best-selling-products.json` (5 ids,
  sin solape con los de popular) y usar esos valores en vez de los
  defaults del producto base. `orders_count` (popular) y `total_sales`
  (best-selling) **no tienen columna destino** — la US ya lo marca como
  decisión de diseño pendiente (candidato natural: `sold_quantity`), no
  resuelta aquí.
- `packages/db/src/repositories/products.integration.test.ts`,
  `shops.integration.test.ts` — cobertura nueva para el orden/filtro
  agregados; los tests EXISTENTES no assertan nada sobre ratings/reviews/
  sold_quantity, así que enriquecer esas columnas no los rompe. El seed
  regenerado SÍ debe seguir dando `shops.total === 12` e
  `items[0].id === 15` (US-2 lo advierte) — verificado que el cambio
  propuesto toca solo el INSERT de `products`, no el de `shops`.

## Approaches

1. **Reproyección completa (bug-compatible) — replicar el shape gigante
   de `popular-products.json`/`best-selling-products.json` desde
   `ProductRecord`, incluyendo `type`/`shop` anidados completos y
   preservando el bug de `type_slug` (fuzzy sobre todo el catálogo).**
   - Pros: fidelidad total al contrato HTTP actual, cero riesgo de romper
     un consumidor del frontend que dependa de alguna de esas 40+ claves.
   - Cons: mucho mapeo nuevo (un `toPopularProductDto` con shape distinto
     al `toProductDto` de 20 claves ya existente); perpetúa un bug conocido;
     esfuerzo no trivial para un shape que el propio repo probablemente no
     necesita completo (el frontend de un carrusel de destacados rara vez
     consume 40 claves).
   - Effort: Alto.

2. **Reproyección con el shape de 20 claves (`toProductDto` existente),
   ordenado por el criterio de ranking, corrigiendo el bug de `type_slug`
   (filtra sobre el subconjunto rankeado, no todo el catálogo).**
   - Pros: reusa el mapper y el patrón ya establecido por US-2/3 (mismo
     `toProductDto`); consistente con "el listado publica 20 claves"; el
     bug de `type_slug` se corrige de forma acotada y documentable.
   - Cons: es una divergencia de contrato respecto al mock actual (que
     devuelve 40+ claves) — requiere declarar la divergencia (como ya se
     hizo con `created_at`/`updated_at` en US-2/3) y verificar que el
     frontend de la tienda no dependa de una clave fuera de las 20.
   - Effort: Medio.

3. **Híbrido: nueva función en el repositorio (`listPopularProducts`,
   `listBestSellingProducts`) que ordene por el criterio de ranking y
   filtre por `typeSlug`/`shopId` reutilizando `ListProductsInput`, con el
   servicio proyectando a través de `toProductDto` (Approach 2) pero
   documentando explícitamente en el design.md la divergencia de shape
   (20 claves vs 40+) como MUST-DECIDE, análogo a las decisiones D-N ya
   documentadas en US-2/3.**
   - Pros: mismo criterio de diseño usado en toda la Épica 1 (declarar
     divergencias explícitamente, CA-4 la acepta "donde el dato lo
     permita"); evita construir infraestructura nueva de mapeo.
   - Cons: ninguno adicional a (2); es (2) con la extensión de
     repositorio nombrada explícitamente.
   - Effort: Medio.

## Recommendation

Approach 3. Es la continuación directa del patrón que dejaron US-2/3/4a:
un mapper de 20 claves ya probado y con tests, extender
`ListProductsInput`/el repositorio con funciones u opciones de orden
nombradas (no un `orderBy` de string libre — mantiene el estilo tipado del
resto del paquete), y declarar en `design.md` la divergencia de shape
(popular/best-selling pasan de 40+ claves a 20) igual que se declaró la de
`created_at`/`updated_at`. El bug de `type_slug` se corrige (filtra sobre
el ranking, no todo el catálogo) porque perpetuarlo no tiene valor y el CA-1
de la US ya pide "ordenados por el criterio que fije el design" — implica
diseño nuevo, no preservación bug-a-bug.

Para `getNearByShop`: no hay forma de preservar bug-a-bug (ignorar
lat/lng) Y cumplir CA-3 ("ignora las tiendas sin coordenadas") a la vez —
son contradictorios. Recomiendo implementar el filtro+orden real
(Approach único viable): traer con Prisma las tiendas cuyo
`settings->'location'` tenga `lat`/`lng` numéricos, calcular haversine en
JS y ordenar ascendente por distancia. Con 12 filas totales el costo es
irrelevante. Esto es una mejora de comportamiento respecto al mock, debe
declararse explícitamente en el proposal/design (no es "preservar
contrato", es "corregir el contrato roto") y decidir si acepta `limit`
opcional (el mock no pagina esta ruta).

## Risks

- **Contrato de shape para popular/best-selling.** Si el frontend de la
  tienda (`apps/shop`) lee alguna de las 20+ claves que NO están en el
  listado de 20 (p.ej. `description`, `gallery`, `rating_count`,
  `orders_count`), el Approach 3 rompería esa página. Falta verificar
  contra el código de `apps/shop` qué claves consume el carrusel de
  destacados antes de fijar el design — **fuera del alcance de esta
  exploración** (la US excluye el frontend), pero debe ser una nota para
  design.md, no un supuesto.
- **`orders_count`/`total_sales` sin columna destino.** La US ya lo marca
  como decisión pendiente. Mapear ambos a `sold_quantity` (candidato
  natural del doc) colisiona conceptualmente si "popular" y "más vendido"
  necesitan criterios DISTINTOS de orden — con una sola columna disponible
  para ambos, el diseño tendrá que usar `ratings` para popular y
  `sold_quantity` para best-selling (o alguna combinación), documentado
  explícitamente.
- **`getProductsStock`/`getDraftProducts` con el default de
  `status`/`visibility` de `listProducts()`.** Hoy coincide byte a byte
  (ningún caso de solape en los datos actuales), pero semánticamente el
  mock no aplicaba ese filtro. Si el design reusa `listProducts()` tal
  cual sin un modo "sin default", una regresión futura (nuevo producto
  draft con bajo stock) quedaría oculta en `products-stock` sin que
  ningún test lo capture hoy. Vale la pena que `products.repository.ts`
  exponga una forma explícita de pedir "todos los status" para estos dos
  casos.
- **`getNearByShop` cambia de comportamiento observable** (de "6 fijas
  ignorando parámetros" a "las que estén cerca, filtradas y ordenadas").
  Cualquier snapshot/test de frontend que dependa del orden fijo actual
  (`2,6,1,5,4,3`) se rompería — otra vez, fuera del alcance de verificar
  aquí (no tocar frontend), pero debe declararse como cambio de
  comportamiento intencional en el proposal.
- **`apps/api/rest` sí tiene un `*.spec.ts` de Jest**
  (`products/products.service.spec.ts`, cubre `getProducts`/
  `getProductBySlug` de US-2/3) — corrige la afirmación de `CLAUDE.md`
  ("declara jest pero no tiene ningún `*.spec.ts`"), que está desactualizada
  en ese punto. Ese archivo **no** corre en ningún comando `just` (`just
  db-check` solo cubre `packages/db`); si esta US migra métodos nuevos en
  `products.service.ts`, no hay gate automatizado en `just` que corra este
  jest — verificarlo manualmente (`yarn test` dentro de
  `apps/api/rest`) debe añadirse a la Definición de Done si se tocan/crean
  specs ahí.
- **Regenerar el seed exige `just db-reset`** (confirmado: el DDL es
  `IF NOT EXISTS`, no altera filas). El agente de apply debe recordar
  este paso o los datos de ranking nunca llegarán a la base local.

## Ready for Proposal

Sí. Los 6 métodos están mapeados con su contrato real (uno de ellos, CA-3/
`getNearByShop`, con una contradicción explícita entre "preservar el mock"
y "cumplir el CA" que el proposal/design debe resolver con una decisión
declarada, no en silencio). La única pieza que el orquestador debe
confirmar con el usuario antes de proceder a specs/design es la decisión
de shape para popular/best-selling (Approach 2/3, 20 claves) y el mapeo de
`orders_count`/`total_sales` a columnas existentes — ambas ya están
enmarcadas como "decisión de diseño pendiente" en la propia US, así que
puede resolverse en `sdd-design` sin bloquear el avance.
