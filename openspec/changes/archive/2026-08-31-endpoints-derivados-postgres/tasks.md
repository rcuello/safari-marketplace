# Tasks: Endpoints derivados del catálogo desde Postgres (US-5)

## Review Workload Forecast

Código real, `seed.sql` EXCLUIDO (commit aparte, decisión ya tomada): 8 archivos de
`packages/db`/`apps/api/rest`/docs → **~395-410 líneas** (detalle: `design.md`, File Changes).

Decision needed before apply: No
Chained PRs recommended: No
400-line budget risk: Medium

PR único; `seed.sql` en commit aparte. Sin chaining, entrega ya decidida.

## Phase 1: Captura del ANTES (CA-4, primero)

- [x] 1.1 `just api-dev` (puerto **9001**, nunca 9000) sobre código intacto.
- [x] 1.2 `export SCRATCH=...`; `curl` de los 6 + `near-by-shop/40.7128/-74.0060` → `*.mock.json`.
- [x] 1.3 `curl -w '<-%{http_code}\n' .../near-by-shop/undefined/undefined` (hoy 200+6 fijas); apagar.

## Phase 2: Dato — seed enriquecido

- [x] 2.1 `generate-seed.mjs`: mapa `id→{ratings,total_reviews,sold_quantity}` de `popular-products.json` + `best-selling-products.json` (`total_sales`→`sold_quantity`; id 888 en ambos).
- [x] 2.2 Añadir `total_reviews` al INSERT `products` (`:228-233`); `num(r.X ?? p.X ?? 0)` en las tres.
- [x] 2.3 `node db/generate-seed.mjs` → regenera `seed.sql`; commit propio, excluido del review.
- [x] 2.4 `just db-reset` (ADVIERTE: destruye el volumen; recuperable con `just scrape`).
- [x] 2.5 `psql`: `ratings>0`=6, `sold_quantity>0`=7, `total_reviews>0`=6, `n`=1200; `shops`=12, `max(id)`=15, `categories`=198.

## Phase 3: `packages/db` — capacidades + tests

- [x] 3.1 `products.repository.ts`: `ListProductsInput` +`maxQuantity?`, `orderBy?:'id'|'ratings'|'soldQuantity'`, `applyStorefrontDefaults?` default `true`.
- [x] 3.2 `buildWhere`: `quantity:{lte:maxQuantity}`; default solo si `applyStorefrontDefaults!==false`.
- [x] 3.3 Orden tipado con desempate `id ASC` incorporado (ver tabla en design.md).
- [x] 3.4 `shops.repository.ts`: `ShopNearRecord`, `listShopsNear(lat,lng)` — descarta filas inválidas; **guard de no-finito→`[]` EN EL REPOSITORIO**; haversine R=6371, asc, empate `id ASC`.
- [x] 3.5 `index.ts`: exportar `listShopsNear`/`ShopNearRecord`.
- [x] 3.6 `products.integration.test.ts`: `orderBy` (ids esperados), `maxQuantity` (total 11), opt-out (total 1, id 454) + contraste default activo.
- [x] 3.7 `shops.integration.test.ts`: `listShopsNear` 2 orígenes (órdenes distintos, ≤6, sin ids `[7,9,11,12,14,15]`); `listShopsNear(NaN,NaN)`→`[]`; no-regresión `listShops`.
- [x] 3.8 `just db-build` (BLOQUEANTE: `dist/` gitignored, Nest vía `link:`).
- [x] 3.9 `just db-check` verde.

## Phase 4: Servicios de Nest

- [x] 4.1 `products.service.ts`: 4 métodos → async, usan `listProducts()` con las 3 opciones nuevas, proyectan `toProductDto`; retirar imports/`Fuse` huérfanos, conservar `productsJson`/`plainToClass` (stubs).
- [x] 4.2 `shops.service.ts`: `getNewShops` → `listShops({isActive:false})`, cero código nuevo.
- [x] 4.3 `getNearByShop(lat,lng)` → `listShopsNear` + `toNearShopDto` nuevo: 14 claves en orden exacto, `is_active:Number(bool)`, `distance` numérica; retirar `nearShopJson`/`Fuse` huérfanos, conservar `shopsJson` (create/update/`getStaffs`/dis-/approveShop).
- [x] 4.4 `just build-api` && `yarn test` en `apps/api/rest` (verde; ningún `just` lo corre).

## Phase 5: Evidencia y contratos

- [x] 5.1 `just api-dev`; repetir 1.2 → `*.pg.json`.
- [x] 5.2 `curl` extra: `?limit=3`, `?type_slug=grocery&limit=3`, `near-by-shop/4.711/-74.0721`, `.../undefined/undefined` y `.../abc/0` → 200 `[]`.
- [x] 5.3 Diff de key-sets mock vs pg con `node -e` (sin `.sort()`); solo deben aparecer S-1/S-2/S-3, B-1/B-2/B-3.
- [x] 5.4 `just verify` verde.
- [x] 5.5 `git grep -n "popular-products.json\|best-selling-products.json\|near-shop.json" -- apps/api` vacío.

## Phase 6: Cierre documental

- [x] 6.1 `5-endpoints-derivados-postgres.md`: `Status:` → Implementada, DoD con evidencia.
- [x] 6.2 `docs/product/1-catalogo-desde-postgres/README.md`: fila US-5 → Implementada.

Fuera de alcance: `getStaffs`, escrituras, tablas nuevas, DDL, árbol de categorías, frontend,
`CLAUDE.md`, `.claude/skills/`, `openspec-convention.md`, ~30 servicios mock.

**Nota `sdd-archive`** (no apply): deltas `## MODIFIED Out of Scope` en
`product-listing-api`/`flat-catalogs-api`, sin cubrir en `openspec-convention.md:65-74` —
aplicar a mano (precedente US-7).
