# Design: Endpoints derivados del catálogo desde Postgres

> US-5, Épico 1. Insumos: `proposal.md`, `explore.md`. Formato:
> `archive/2026-08-25-migrar-api-products-postgres/design.md` (US-2). Toda cifra, columna y
> clave sale del archivo citado o de un `SELECT` de solo lectura contra :5433. Lo marcado
> **(cerrada)** lo fijó el dueño del repo el 2026-08-31.

## Technical Approach

Dos capas, en este orden:

1. **Dato.** `db/generate-seed.mjs` fusiona el ranking curado de los dos JSON en `products` y
   añade `total_reviews` al INSERT. Se regenera `db/seed.sql` y se aplica con `just db-reset`
   (el DDL es `IF NOT EXISTS`: no actualiza filas).
2. **Código.** `packages/db` gana tres capacidades aditivas (`orderBy` tipado, `maxQuantity`,
   `listShopsNear`) y un interruptor para no heredar el default de vitrina. Los 6 métodos las
   llaman y proyectan con `toProductDto` (existente) o `toNearShopDto` (nuevo).

Sin DDL, sin archivos ni rutas nuevas, cero `$queryRaw`.

## Data Flow

    generate-seed.mjs ─(2 JSON de ranking)→ seed.sql ─db-reset→ Postgres
    popular-products → ProductsService → listProducts({orderBy:'ratings'}) ┤
    products-stock ──→                 → listProducts({maxQuantity:9,…})   ┤
    near-by-shop/… ──→ ShopsService ──→ listShopsNear(lat,lng) ─ haversine ┘
                    └→ toProductDto (20) | toNearShopDto (14) → HTTP

## Architecture Decisions

### Decision A: el ranking se enriquece DENTRO del INSERT, no en un UPDATE posterior

**Choice**: añadir `total_reviews` al INSERT de `products` (`generate-seed.mjs:228-233`) y
resolver los tres valores de ranking desde un mapa `id → {ratings, total_reviews,
sold_quantity}`.

**Alternatives considered**: dejar el INSERT como hoy y añadir un `UPDATE products AS p SET …
FROM (VALUES …) AS v(…)` con solo las 15 filas rankeadas — patrón que **ya existe en este
archivo** (`:178-186`, jerarquía de categorías). El diff bajaría de ~1200 líneas a ~25.

**Rationale**: el UPDATE optimiza el diff de un artefacto generado a costa de partir la
definición de una fila en dos sentencias. El generador se declara "también la documentación de
la procedencia de cada fila" (`:6`) y `db/README.md:9,20` marca `seed.sql` como generado: el
revisor lee el script, no su salida. El two-step de categorías existe por **necesidad** (la FK
autorreferencial exige la madre antes que la hija), no por diff.

**Consecuencia — por qué cambian las 1200 tuplas**: `ratings` y `sold_quantity` **ya están** en
la lista de columnas (`:229-232`) y solos darían ~15 líneas. El churn lo fuerza
**`total_reviews`**: al añadirlo, las 1200 tuplas ganan un término y **cambian textualmente**,
incluidas las 1185 de valor idéntico (`0`). Y el precio entero: **`total_reviews` no tiene
lector en US-5** (`toProductDto` no lo emite; el orden usa `ratings`/`soldQuantity`). Se
siembra porque el dato y la columna existen y dejarla vacía obligaría a regenerar el seed
cuando llegue el consumidor. Riesgo R-1, ya resuelto por la entrega.

### Decision B: `orderBy` tipado con desempate por `id ASC` incorporado (cerrada + añadido de diseño)

**Choice**: `orderBy?: 'id' | 'ratings' | 'soldQuantity'`, con el desempate **dentro** del
repositorio, no en el llamador:

| valor | `orderBy` de Prisma |
|---|---|
| ausente / `'id'` | `{ id: 'asc' }` (hoy, `products.repository.ts:213`) |
| `'ratings'` / `'soldQuantity'` | `[{ ratings: 'desc' }, { id: 'asc' }]` / `[{ soldQuantity: 'desc' }, { id: 'asc' }]` |

**Alternatives considered**: string libre (`orderBy: string` + `sortedBy`, lo que declara
`get-products.dto.ts` y hoy se ignora) — rechazado: admite valores no validados que Prisma
convertiría en excepción → 500. Delegar el desempate al llamador — se olvida.

**Rationale**: **1194 de 1200 filas quedan empatadas en `ratings = 0.00`**. Sin desempate, la
cola del top-10 varía entre ejecuciones y la paginación deja de ser estable. `id ASC` es el
criterio estable que ya usa el listado.

### Decision C: `applyStorefrontDefaults` — opt-out explícito, el default no se debilita

**Choice**: `applyStorefrontDefaults?: boolean` (default `true`). En `true`, `buildWhere` se
comporta como hoy (`products.repository.ts:172-173`); en `false`, `status`/`visibility` se
aplican **solo si el llamador los envía**.

**Alternatives considered**: (a) `status: string | null` con `null` = "sin filtro" —
rechazado: `null` vs `undefined` es una distinción frágil que un llamador invierte; (b)
sentinela `'*'` — rechazado, string mágico.

**Rationale**: `getProductsStock`/`getDraftProducts` son vistas de **inventario/admin** y el
mock no filtra por `status`/`visibility` en ninguna (`products.service.ts:261`, `:296-298`).
Hoy coincide por casualidad: el único borrador, **id 454, tiene `quantity = 30`** y no cae en
`quantity <= 9`. Un futuro borrador con stock bajo desaparecería en silencio del inventario. El
flag invierte la carga sin tocar a los llamadores existentes.

Usos: stock → `{ applyStorefrontDefaults: false, maxQuantity: 9 }`; draft → `{ …false,
status: 'draft' }`. `popular`/`best-selling` **conservan** el default: son vitrina.

### Decision D: haversine en JS sobre 6 filas, no SQL ni PostGIS

**Choice**: `listShopsNear(lat, lng)` hace `prisma.shop.findMany({ where: { isActive: true } })`
(12 filas, sin `include`), descarta en JS las que no tengan `settings.location.lat`/`.lng`
**numéricos y finitos**, calcula haversine con `R = 6371` km y ordena ascendente por distancia.

**Sin radio (cerrada)**: devuelve **todas** las que tengan coordenadas válidas, no las de un
umbral. Las 6 geocodificadas están repartidas por el mundo (NJ, Illinois, NZ, Londres, NY, DC):
cualquier radio razonable vaciaría el carrusel desde casi cualquier origen. El dueño acepta que
la tarjeta muestre hasta `14193.57km Away` — el dato raro viene del seed (S-4).

**Alternatives considered**: (a) PostGIS — rechazado: extensión nueva, toca
`docker-compose.yml` y el DDL; (b) haversine en SQL con `$queryRaw` — **ningún repositorio del
paquete usa `$queryRaw`** y perdería `_toShopRecord`; (c) filtrar en SQL por
`settings->'location'` no vacío — los shops **1..6** tienen `lat`/`lng` numéricos, los
**7, 9, 11** guardan `location: []` (**array** JSON, no objeto) y los **12, 14, 15** no tienen
la clave; expresar esos dos vacíos en un `JsonFilter` es más frágil que un
`typeof === 'number'` en JS. `isActive: true` no cambia nada hoy (12/12) pero es **B-6**.

**Rationale**: 12 filas, 6 candidatas. Traerlas enteras cuesta nada y queda testeable sin SQL
crudo.

**Casos borde**: tienda sin `location`, con `location: []` o con `lat`/`lng` no numéricos →
**se descarta**, no lanza (CA-3 y el Gherkin) · `lat`/`lng` no finito → **`[]` con 200**, ver
B-4 · un solo segmento (`/near-by-shop/40.7`) → 404 del router: `@Get(':lat/:lng')`
(`shops.controller.ts:112`) exige dos, y la tienda nunca lo produce · empate → `id ASC`.

### Decision E: `toNearShopDto` propio de 14 claves — `toShopDto` NO se reutiliza

**Choice**: mapper nuevo en `shops.service.ts` con las 14 claves de `near-shop.json` en su
orden exacto (key-set idéntico en las 6 filas).

**Rationale**: `near-shop.json` **no es** el key-set de `shops.json` (16 claves): le faltan
`orders_count`, `products_count` y `owner`, y añade `distance`. `toShopDto` emitiría 3 claves
de más y ninguna `distance` — **obligatoria**: la renderiza
`components/ui/cards/near-shop.tsx:38-41`. Colateral: sin `products_count`, `listShopsNear` no
necesita el `include` de conteo (`shops.repository.ts:30-32`).

### Decisiones menores (ratifican el proposal)

| # | Tema | Decisión y evidencia |
|---|---|---|
| F | Proyección | `toProductDto` (20 claves, `products.service.ts:134-168`) en los 4 endpoints; cubre las 11 de la tarjeta (`helium.tsx:26-40`) |
| G | `type_slug` **(cerrada)** | `listProducts({ typeSlug, orderBy })` filtra DENTRO del ranking, sin `fuse` (`:240-242`, `:250-252`) |
| H | `limit` por defecto | El mock hace `slice(0, undefined)` → lista completa. Se reproduce: **10** popular, **5** best-selling. `page` no es parámetro aquí |
| H2 | `shop_id` sigue muerto | Declarado en los dos DTO y el mock **no lo usa en ninguna rama**; la migración **tampoco lo cablea** (sería un cambio no decidido) |
| I | `new-shops` es solo cableado | `ListShopsInput.isActive` ya existe (`shops.repository.ts:11-20`): cero código nuevo. `getNewShops` calca `getShops` con `isActive: false` y solo `name` (B-7) |
| J | Errores | US-2 Decision D: `try` solo alrededor del repositorio; conexión → 503, resto → 500 |

## Mapeo campo a campo del enriquecimiento del seed

Fuentes: 10 y 5 filas, **46 claves cada una pero con key-sets distintos** — popular trae
`orders_count` donde best-selling trae `total_sales`.

| Campo del mock | Presente en | Columna destino | Decisión |
|---|---|---|---|
| `ratings` | popular (`5, 4.67, 4.67, 1.67, 0, 0, 0, 0, 3.33, 1`) | `ratings numeric(3,2)` | se siembra |
| `total_reviews` | popular (`3,3,3,3,0,0,0,0,3,1`) | `total_reviews integer` | se siembra; **falta en el INSERT** |
| `total_sales` | **solo** best-selling (`4,1,1,1,1`) | `sold_quantity integer` | se siembra |
| `orders_count` | **solo** popular (`6,4,4,4,4,4,4,4,2,2`) | **ninguna** | **se descarta** (ver abajo) |
| `rating_count` | ambos (histogramas) | ninguna | se descarta; `toProductDto` no lo emite |
| `sold_quantity` del JSON de ranking | ambos, **`0` en las 15** | — | **no se usa**: la columna la llena `total_sales` |

**Por qué se descarta `orders_count`**: no hay columna y crearla sería tocar `db/schema.sql`
(fuera de scope). Dato clave para B-3: el orden del array de `popular-products.json`
(`4,1,3,5,888,972,973,976,2,25`) **coincide exactamente** con `orders_count` descendente
(`6,4,4,4,4,4,4,4,2,2`) — el criterio real de la lista curada era `orders_count`, no `ratings`.
Al descartarlo, la lista visible se reordena por fuerza.

**Fusión por campo, no por fila**: el **id 888 está en los dos JSON**. Primero popular
(`ratings`, `total_reviews`), luego best-selling (`sold_quantity` ← `total_sales`): 888 queda
`{ratings: 0, total_reviews: 0, sold_quantity: 4}`.

**No rankeados (1185 de 1200)**: sin cambio semántico. `ratings` y `total_reviews` → `0`
(`products.json` **no trae** ninguna de las dos claves); `sold_quantity`, el suyo. **Los ids 1
y 2 traen `sold_quantity: 2`** y no están en best-selling: lo conservan y compiten en el top-5.

Emisión: un `Map` poblado en ese orden y, en el `.map()` de products
(`const r = ranking.get(p.id) ?? {}`), las **tres columnas con la misma forma**
`num(r.X ?? p.X ?? 0)`. El `p.X` de `ratings`/`total_reviews` es inocuo hoy pero evita una
asimetría que el siguiente lector leería como intencional.

## Consultas concretas

Equivalente SQL de lo que emite Prisma; tipos verificados en `db/schema.sql:233-254`.

```sql
-- popular (limit 10). best-selling: ORDER BY sold_quantity DESC, id ASC (limit 5)
SELECT p.* FROM products p
WHERE p.status = 'publish' AND p.visibility = 'visibility_public'
  -- ?type_slug=grocery →  AND p.type_id = (SELECT id FROM types WHERE slug = 'grocery')
ORDER BY p.ratings DESC, p.id ASC LIMIT 10 OFFSET 0;

-- products-stock y draft-products (sin default de vitrina; el mock tampoco lo aplica)
SELECT p.* FROM products p WHERE p.quantity <= 9    ORDER BY p.id ASC LIMIT 30 OFFSET 0;
SELECT p.* FROM products p WHERE p.status = 'draft' ORDER BY p.id ASC LIMIT 30 OFFSET 0;

-- new-shops
SELECT s.* FROM shops s WHERE s.is_active = false ORDER BY s.id DESC LIMIT 30 OFFSET 0;

-- near-by-shop: solo el filtro barato; la distancia se calcula en JS (Decision D)
SELECT s.* FROM shops s WHERE s.is_active = true;
```

Resultados esperados tras el enriquecimiento:

| Endpoint | Resultado |
|---|---|
| `popular-products` | `[4,1,3,2,5,25,6,7,8,9]` — los 6 con `ratings > 0` (`5.00, 4.67, 4.67, 3.33, 1.67, 1.00`; 1 antes que 3 por `id ASC`) + 4 empatados en `0.00` |
| `best-selling-products` | `[888,1,2,883,887]` — `888`=4; `1` y `2`=2 (de `products.json`); `883`/`887`=1 (empate con `892`/`946`, resuelto por `id ASC`) |
| `products-stock` | `total: 11`, ids `2,190,1014,1015,1017,1018,1021,1022,1023,1024,1028` |
| `draft-products` | `total: 1`, id `454` · `new-shops`: `total: 0`, `data: []` (12/12 activas) |
| `near-by-shop/:lat/:lng` | ≤ 6 filas (solo shops 1..6 tienen coordenadas), orden según origen |

## Interfaces / Contracts

### `ListProductsInput` — delta (`packages/db/src/repositories/products.repository.ts:112-128`)

```ts
  maxQuantity?: number;                              // where: quantity: { lte: … }
  orderBy?: 'id' | 'ratings' | 'soldQuantity';       // desempate id ASC incluido (Decision B)
  applyStorefrontDefaults?: boolean;                 // default true (Decision C)
```

`maxQuantity` usa su propia clave del `where`, sin colisionar con `priceFilter`. Los tres son
**opcionales**: ningún llamador actual cambia.

### `listShopsNear` — nueva en `shops.repository.ts`, exportada por `packages/db/index.ts`

```ts
export interface ShopNearRecord extends ShopRecord { /** km, haversine R=6371. */ distanceKm: number; }
export async function listShopsNear(lat: number, lng: number): Promise<ShopNearRecord[]>;
```

Array plano ascendente por `distanceKm`; `[]` si `lat`/`lng` no son finitos. Sin paginación (el
mock no la tiene) ni `productsCount` (Decision E).

### `toNearShopDto` — las 14 claves, en este orden

Orden y key-set verificados idénticos en las 6 filas de `near-shop.json`.

```
1 id · 2 owner_id · 3 name · 4 slug · 5 description · 6 cover_image · 7 logo ·
8 is_active · 9 address · 10 settings · 11 notifications · 12 created_at ·
13 updated_at · 14 distance
```

Del 1 al 10, copia directa del `ShopRecord` en camelCase, salvo **`is_active`** →
`Number(record.isActive)`: el mock emite `1`, no `true` (como `toShopDto`, `:54`).
**`notifications`** es la constante `null` (sin columna); `created_at`/`updated_at`, del record
(S-3). **`distance`** → `record.distanceKm`, **number**: la entidad declara `distance?: string`
(`shop.entity.ts:22`) pero el frontend hace `.toFixed(2)`, así que se emite number con
`as unknown as Shop`.

### Forma de cada respuesta

| Endpoint | Envoltorio | Notas |
|---|---|---|
| `GET /api/{popular,best-selling}-products` | **array plano** de 20 claves | `Promise<Product[]>` ya declarado (`products.controller.ts:53` y `:61`) |
| `GET /api/products-stock` | `{ data, ...paginate(total, page, limit, data.length, url) }` | `url = '/products-stock?search=${search}&limit=${limit}'` literal. **MUST-KEEP** `if (!page) page = 1; if (!limit) limit = 30;` y `page`/`limit` **crudos** hacia `paginate` (US-2 Decision A: si no, `per_page` deja de ser el string `"30"`) |
| `GET /api/draft-products` | idem | `url = '/draft-products?...'` |
| `GET /api/new-shops` | idem | Calca `getShops` (`:75-107`): solo `if (!page) page = 1`, **sin** default de `limit` |
| `GET /api/near-by-shop/:lat/:lng` | **array plano**, 14 claves | |

## Divergencias declaradas

**De comportamiento** (deliberadas):

| # | Cambio | Evidencia |
|---|---|---|
| B-1 | `near-by-shop` deja de devolver 6 tiendas fijas ignorando los parámetros (`return nearShops;`, `shops.service.ts:171-173`): filtra y ordena por cercanía real | (cerrada) |
| B-2 | `type_slug` filtra dentro del ranking, no vía `fuse` sobre todo el catálogo | (cerrada) |
| B-3 | **Los ids visibles dejan de ser la lista curada** (ver "Resultados esperados") | 4 de los 10 curados (`888,972,973,976`) traen `ratings: 0` y caen; el criterio real del mock era `orders_count`, sin columna |
| B-4 | `lat`/`lng` no finitos → **`[]` con HTTP 200**, no 400: el mock también respondía 200 | **La tienda dispara esta ruta con `undefined`**: `pages/shops/index.tsx:25-28` y `search.tsx:26-31` llaman `useGetSearchNearShops({lat: query?.lat?.toString(), …})` en cada render, `shop.ts:88-92` es un `useQuery` **sin guard `enabled`** y `client/index.ts:258-259` arma `/near-by-shop/undefined/undefined` — **dos segmentos que matchean la ruta**, así que no hay 404 que salve el caso y un 400 rompería `/shops` en cada carga. Y `[]` ya lo maneja el consumidor (`search.tsx:45`: `if (!data?.length)` → "No Shops Nearby Found" + fallback) |
| B-5 | En `products-stock`/`draft-products` el `search` se **combina con AND** sobre el filtro base; el mock **reemplazaba** `data` con `fuse.search({$and})` sobre todo el catálogo, perdiendo `quantity <= 9` / `status = 'draft'` | `products.service.ts:276-281`, `:313-317`. Como la divergencia 9 de US-2 |
| B-6 | `near-by-shop` filtra `isActive: true`; el mock servía sus 6 sin mirar actividad | Inobservable hoy (12/12 activas); mañana una tienda desactivada no saldría en el carrusel, que es lo correcto |
| B-7 | `new-shops?search=` pasa de `fuse` difuso sobre `name`/`type.slug`/`is_active` (`shops.service.ts:29-33`, `:122`) a filtro exacto por **`name`** | Inobservable hoy (`total: 0`), real con una tienda inactiva. Criterio de V-15 en `getShops` |

**De forma**:

- **S-1** popular/best-selling pasan de **46 claves** por fila a las **20** de `toProductDto`
  (criterio de US-2/4a: se declara, no se compensa) · **S-2** `in_flash_sale` sigue siendo la
  constante `0` (`products.service.ts:165`), ya embarcada en US-2 · **S-3**
  `created_at`/`updated_at` con el `now()` del último `db-up` y 3 decimales en vez de 6,
  aceptada por CA-4 y el precedente de `/api/settings`; `toProductDto` no las emite y
  `toShopDto` (new-shops) sí, pero da 0 filas → solo observable en `near-by-shop`.
- **S-4 (corrige una premisa del proposal)** los `distance` del mock **no son kilómetros
  reales**. El orden ascendente sí, pero los valores no salen de ningún origen: el mock sitúa
  el shop 1 (Kearny, NJ) a `10.46` y el shop 3 (Ramarama, NZ) a `20.89` del mismo punto, cuando
  la distancia **entre ellos** es de **14 187 km**. Haversine no "restaura" esos valores: los
  sustituye por magnitudes verdaderas de miles de km (aceptado con "sin radio"). Borde:
  `distance === 0` es *falsy* y `near-shop.tsx:38` oculta la insignia; no se añade rama.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `db/generate-seed.mjs` | Modify | mapa de ranking + `total_reviews` en el INSERT (~25 líneas) |
| `db/seed.sql` | **Regenerado** | artefacto (`db/README.md:9,20`); commit aparte |
| `packages/db/.../products.repository.ts` | Modify | 3 campos en `ListProductsInput`, opt-out en `buildWhere`, `orderBy` |
| `packages/db/.../shops.repository.ts` | Modify | `listShopsNear`, `ShopNearRecord`, haversine, guard `NaN` |
| `packages/db/index.ts` | Modify | exportarlos |
| `packages/db/.../{products,shops}.integration.test.ts` | Modify | orden, `maxQuantity`, opt-out, cercanía, `NaN`, sin coordenadas |
| `apps/api/rest/src/products/products.service.ts` | Modify | 4 métodos → `async` + limpieza (tabla siguiente) |
| `apps/api/rest/src/shops/shops.service.ts` | Modify | 2 métodos → `async`, `toNearShopDto`, limpieza |
| `*.controller.ts`, `db/schema.sql`, `prisma/schema.prisma` | **Sin cambios** | mismas rutas y DTOs, los 6 handlers ya son `async`; las 3 columnas ya existen |
| `docs/product/1-catalogo-desde-postgres/{5-…md, README.md}` | Modify | status de la US y fila del épico |

### Imports del mock: qué se va y qué se queda

| Símbolo | Destino | Motivo |
|---|---|---|
| `popularProductsJson`, `bestSellingProductsJson` + `const`/propiedades | **fuera** | sin consumidor |
| `Fuse`, `options`, `fuse` en **products** | **fuera** | migrados los 4, no queda rama que llame `fuse.search` (`:241`, `:251`, `:276`, `:313`) |
| `nearShopJson`, `const nearShops`, `private nearShops` (`:69`) | **fuera** | último uso `getNearByShop` (`:172`); la propiedad ya es código muerto |
| `Fuse`, `options`, `fuse` en **shops** | **fuera** | único uso: `getNewShops` (`:122`) |
| `productsJson`, `const products`, `this.products` | **se quedan** | stubs `create()` (`:177`), `update()` (`:329`) |
| `shopsJson`, `const shops`, `this.shops` | **se quedan** | `create()`, `update()`, **`getStaffs()`** (`:139`), `disapproveShop()` (`:188`), `approveShop()` (`:195`) |
| `plainToClass` | **se queda** | construye ambos |

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Integration (`packages/db`) | `orderBy` | los dos criterios → los ids de "Resultados esperados"; monotonía y, con empate, `id[i] < id[i+1]` |
| Integration | `maxQuantity` | `{ maxQuantity:9, applyStorefrontDefaults:false }` → `total === 11`, todo item con `quantity <= 9` |
| Integration | opt-out del default | `{ applyStorefrontDefaults:false, status:'draft' }` → `total === 1`, id `454`. Contraste que prueba que el default sigue vivo: `{ status:'draft' }` solo también filtra `visibility_public` |
| Integration | `listShopsNear` | dos orígenes (`40.7128,-74.0060` y `4.711,-74.0721`) → **órdenes distintos**; `length <= 6`; ningún id en `[7,9,11,12,14,15]`; `distanceKm` finito y no decreciente |
| Integration | `listShopsNear(NaN, NaN)` | → `[]` sin lanzar. El guard vive en el **repositorio**, no en el servicio, para que B-4 sea testeable en `just db-check` |
| Integration | no-regresión | los tests de `listShops` (`total === 12`, `items[0].id === 15`, `productsCount` 584/82/188/44) siguen verdes |
| Unit (`apps/api/rest`) | ninguno nuevo | `products.service.spec.ts` **existe** (contradice `CLAUDE.md`, que no se toca) y **ningún `just` lo corre**: a mano |
| E2E manual | CA-1..CA-5 | `curl` de los 6 + `just verify` |

Sin fixtures nuevas: todo es lectura del seed.

## Verification Plan

`jq` **no está instalado**: los diffs van con `node -e`, y por eso `SCRATCH` se **exporta**
(node lo lee de `process.env`). API **9001** (Zscaler ocupa el 9000), PG **5433**.

```bash
export SCRATCH=/tmp/us5; mkdir -p $SCRATCH
API=http://localhost:9001/api; NEAR=near-by-shop/40.7128/-74.0060
EPS="popular-products best-selling-products products-stock draft-products new-shops"
PSQL="docker exec safari-postgres psql -U safari -d safari_scraper -c"

# 0. ANTES (mock). PRIMER PASO, con `just api-dev` sobre el codigo SIN tocar: migrado ya no
#    se recupera. Apagar la API al terminar.
for e in $EPS; do curl -s "$API/$e" > "$SCRATCH/$e.mock.json"; done
curl -s "$API/$NEAR" > $SCRATCH/near.mock.json
curl -s -w ' <- %{http_code}\n' "$API/near-by-shop/undefined/undefined"   # hoy: 200 + 6 filas

# 1. Dato — db-reset OBLIGATORIO (db-migrate es IF NOT EXISTS: no actualiza filas)
node db/generate-seed.mjs && just db-reset   # ⚠ DESTRUYE el volumen: se pierde lo scrapeado
$PSQL "SELECT count(*) FILTER (WHERE ratings>0) r, count(*) FILTER (WHERE sold_quantity>0) sq,
              count(*) FILTER (WHERE total_reviews>0) tr, count(*) n FROM products;"  # 6|7|6|1200
$PSQL "SELECT (SELECT count(*) FROM shops), (SELECT max(id) FROM shops),
              (SELECT count(*) FROM categories);"   # R-2: 12 | 15 | 198
#    `max(id)` es proxy DEBIL de `items[0].id === 15` (depende tambien de isActive y del
#    orderBy id desc); basta porque el seed no toca shops. La real: `just db-check`.

# 2. Código
just db-build            # OBLIGATORIO: dist/ gitignored, Nest lo consume vía link: (US-3)
just db-check
just build-api && (cd apps/api/rest && yarn test)   # ese spec no lo corre ningún `just`

# 3. Contratos (just api-dev): contrastar con "Resultados esperados"
for e in $EPS; do curl -s "$API/$e" > "$SCRATCH/$e.pg.json"; done
curl -s "$API/$NEAR" > $SCRATCH/near.pg.json
curl -s "$API/popular-products?limit=3"                                   # 3 filas
curl -s "$API/popular-products?type_slug=grocery&limit=3"                 # B-2
curl -s "$API/near-by-shop/4.711/-74.0721"                                # orden ≠ $NEAR
curl -s -w ' <- %{http_code}\n' "$API/near-by-shop/undefined/undefined"   # B-4: [] 200
curl -s -w ' <- %{http_code}\n' "$API/near-by-shop/abc/0"                 # B-4: [] 200

# 4. Key-sets mock vs pg (CA-4). SIN .sort(): el ORDEN es contrato (toNearShopDto promete
#    14 claves en el orden de near-shop.json). Incluye los anidados type/shop.
node -e "
const fs=require('fs'), d=process.env.SCRATCH, arr=x=>Array.isArray(x)?x:x.data,
      k=f=>{const a=arr(JSON.parse(fs.readFileSync(d+'/'+f)));if(!a.length)return '(vacio)';
            const o=a[0], n=x=>x&&typeof x==='object'?'{'+Object.keys(x)+'}':'';
            return Object.keys(o).join(',')+' | type'+n(o.type)+' shop'+n(o.shop)};
for(const e of process.argv.slice(1)) console.log(e,'\n mock:',k(e+'.mock.json'),'\n pg  :',k(e+'.pg.json'));
" popular-products best-selling-products products-stock draft-products new-shops near
# esperado: solo S-1 (46→20) en popular/best-selling; idéntico y en el MISMO orden en el resto

# 5. Cierre
just verify
git grep -n "popular-products.json\|best-selling-products.json\|near-shop.json" -- apps/api  # vacío
```

Cierre documental (no es comando): **Status** de la US + su fila en el README del épico.

## Migration / Rollout

Datos, no esquema; sin feature flag ni fases. Rollback: `git revert` + `just db-build &&
just build-api`; revertir el commit del seed **no deshace la base local**, hace falta otro
`just db-reset`. Sin él la base conserva el ranking sin lector: inofensivo.

## Open Questions

Ninguna: las cinco decisiones del dueño (ranking, desempate, los dos bugs, sin radio, entrega)
quedan arriba con su consecuencia.
