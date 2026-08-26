# Tasks: Catálogos planos (`types`, `tags`, `manufacturers`, `shops`) desde Postgres — US-4a

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | PR #1 ~135 · PR #2 ~250 · PR #3 ~205 (total ~590) |
| 400-line budget risk | Low per PR · High for the change as a whole |
| Chained PRs recommended | Yes |
| Suggested split | PR #1 (`parse-search` + `types`) → PR #2 (`tags` + `manufacturers`) → PR #3 (`shops` + docs) |
| Delivery strategy | chained PRs (resolved by user) |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|---|---|---|---|
| 1 | `parseSearch` helper + `types` end-to-end | PR 1 | base `main`; ~135 lines; independently curl-verifiable |
| 2 | `tags` + `manufacturers` end-to-end | PR 2 | base = PR 1 branch; ~250 lines; rebase if GitHub shows PR 1's diff |
| 3 | `shops` end-to-end + docs close-out | PR 3 | base = PR 2 branch; ~205 lines; last PR of the chain, lands on `main` once merged in order |

`packages/db/index.ts` line 66 is shared with sibling change `2026-08-26-categorias-arbol-postgres` (US-4b); this change is the base and US-4b rebases onto it — do not touch lines 26-34 (categories region).

## PR #1 — `parse-search` + `types` (~135 lines)

### Phase 1.1: Baseline
- [x] 1.1.1 `just db-up`; capture `curl -s http://localhost:9001/api/types > openspec/changes/2026-08-26-catalogos-planos-postgres/mock-types.json` BEFORE any edit (fallback: `node -e` over `apps/api/rest/src/db/pickbazar/types.json` per design.md Verification Plan §Paso 0)

### Phase 1.2: `packages/db`
- [x] 1.2.1 `packages/db/src/repositories/types.repository.ts`: add `import type { Prisma } from '../../generated/prisma/client/client';`, export `ListTypesInput { name?: string }`, change `listTypes()` to `listTypes(input: ListTypesInput = {})` with `where: { ...(input.name && { name: { contains: input.name, mode: 'insensitive' as const } }) }`
- [x] 1.2.2 `packages/db/index.ts` line 66: add `export type { ListTypesInput } from './src/repositories/types.repository';` next to the existing `listTypes`/`findTypeBySlug` export — do not touch lines 26-34
- [x] 1.2.3 Create `packages/db/src/repositories/types.integration.test.ts` (~35 lines, pattern of `products.integration.test.ts`): `listTypes()` → 10 rows JSON-safe id asc; `listTypes({name:'gad'})` → 1 row `gadget`; `findTypeBySlug('gadget')` hit; `findTypeBySlug('no-existe')` → `null`
- [x] 1.2.4 `cd packages/db && npm run typecheck && npm test` green

### Phase 1.3: Rebuild (blocking)
- [x] 1.3.1 `just db-build` — mandatory before touching `apps/api/rest`; `packages/db/dist/` is gitignored and consumed via `link:` (`apps/api/rest/package.json:31`)

### Phase 1.4: `apps/api/rest`
- [x] 1.4.1 Create `apps/api/rest/src/common/search/parse-search.ts`: `parseSearch(search?: string): Record<string,string>` per design.md Decisión A (~14 lines)
- [x] 1.4.2 `apps/api/rest/src/types/types.service.ts`: `getTypes` (line 22) → async over `listTypes({name})` via `parseSearch`, add module-level `toTypeDto` mapper (9 keys, `translated_languages:['en']`, `promotional_sliders:null`); `getTypeBySlug` (line 51) → async, `try` wraps only `findTypeBySlug(slug)`, 404 (`NotFoundException`) outside the try, 503/500 via `isPrismaConnectionError`/`getUserFriendlyMessage`. Keep `typesJson`/`fuse`/`plainToClass` (used by `create`/`update`)

### Phase 1.5: Verification
- [x] 1.5.1 `just db-check` green
- [x] 1.5.2 `just build-api` green (or restart `just api-dev`)
- [x] 1.5.3 `curl :9001/api/types` → 10-row array, 9 keys, no `data` wrapper; diff vs `mock-types.json` with `node -e` template from design.md — only V-8/V-9 divergences
- [x] 1.5.4 `curl :9001/api/types/gadget` → 200; `curl :9001/api/types/no-existe-xyz` → 404 `{statusCode,message,error}`

## PR #2 — `tags` + `manufacturers` (~250 lines)

### Phase 2.1: Baseline
- [x] 2.1.1 Capture `curl :9001/api/tags?limit=100`, `/manufacturers?limit=30`, `/top-manufacturers?limit=10` into `$CH/mock-*.json` BEFORE editing (API still serves these from mock after PR #1)

### Phase 2.2: `packages/db`
- [x] 2.2.1 `tags.repository.ts`: add `name?: string` to `ListTagsInput`, `contains`/`insensitive` filter, flip `orderBy: { id: 'asc' }` (line 31) → `{ id: 'desc' }` (Decisión D)
- [x] 2.2.2 `manufacturers.repository.ts`: add `name?: string` to `ListManufacturersInput`, `contains`/`insensitive` filter — `orderBy` stays `asc`
- [x] 2.2.3 Create `packages/db/src/repositories/tags.integration.test.ts` (~45 lines): `listTags()` → total 10, first id 62 / last id 53 (desc); `{typeSlug:'medicine'}` → 10; `{typeSlug:'grocery'}` → 0; `{name:'baby'}` → 2; `findTagBySlug` hit/`null`
- [x] 2.2.4 Create `packages/db/src/repositories/manufacturers.integration.test.ts` (~40 lines): `listManufacturers()` → total 14, id asc; `{typeSlug:'books'}` → 9; `{name:'publication'}` → 9; `{limit:10}` → 10 items matching `slice(0,10)`; `findManufacturerBySlug` hit/`null`
- [x] 2.2.5 `cd packages/db && npm run typecheck && npm test` green

### Phase 2.3: Rebuild (blocking)
- [x] 2.3.1 `just db-build`

### Phase 2.4: `apps/api/rest`
- [x] 2.4.1 `apps/api/rest/src/tags/tags.service.ts`: `findAll` (line 30) → async over `Promise.all([listTags(input), listTypes()])` + `parseSearch`, drop `console.log(value,'value')` (line 38) while rewriting the block, add `toTagDto` (9 keys incl. nested `type:{id,name,slug,logo:null}`); `findOne` (line 61) → async, **slug only** (D-8 — numeric branch now 404), try/404/503/500 pattern
- [x] 2.4.2 `apps/api/rest/src/manufacturers/manufacturers.service.ts`: `getManufactures` (line 32) → same `Promise.all` + `parseSearch` pattern, drop `console.log('search', search)` (line 43), add `toManufacturerDto` (13 keys incl. nested `type`, `products_count:0`, `socials:[]`, `cover_image:null`, `language:'en'`); `getTopManufactures` (line 59) unchanged signature but sourced from `listManufacturers`/`toManufacturerDto`, **ignores `search`** (V-20); `getManufacturesBySlug` (line 65) → async, try/404/503/500 pattern
- [x] 2.4.3 `packages/db/src/repositories/*` — verify `Map<number, TypeRecord>` built from `listTypes()` is used to resolve nested `type` in both mappers; `type: null` if `typeId` is `null` (V-23)

### Phase 2.5: Verification
- [x] 2.5.1 `just db-check` green (14 previous + 2 new suites)
- [x] 2.5.2 `just build-api` green
- [x] 2.5.3 `curl :9001/api/tags?limit=100`, `/manufacturers?limit=30`, `/top-manufacturers?limit=10` → diff vs mock baseline with `node -e` template; assert `total`/`count` real (V-13), `type` nested with 4 keys, `products_count:0`
- [x] 2.5.4 `curl :9001/api/tags/62` → 404 (V-21, mock returned 200)

## PR #3 — `shops` + documentation close-out (~205 lines)

### Phase 3.1: Baseline
- [ ] 3.1.1 Capture `curl :9001/api/shops?limit=30 > $CH/mock-shops.json` BEFORE editing (still mock after PR #2)

### Phase 3.2: `packages/db`
- [ ] 3.2.1 `shops.repository.ts`: add `name?: string` to `ListShopsInput`, `contains`/`insensitive` filter, flip `orderBy: { id: 'asc' }` (line 34) → `{ id: 'desc' }` (Decisión D)
- [ ] 3.2.2 `shops.repository.ts` `listShops`: add filtered `_count` (`PUBLISHED_PRODUCT` where `status:'publish', visibility:'visibility_public'`), spread `productsCount: row._count.products` into the returned record (Decisión E)
- [ ] 3.2.3 `shops.repository.ts` `findShopBySlug`: apply the **same** filtered `_count`/`include` so the detail also carries `productsCount` — without this, `/shops/:slug` silently drops to 15 keys (single easiest regression, own assertion required)
- [ ] 3.2.4 `packages/db/src/records.ts`: add `ShopRecord.productsCount?: number` (optional, keeps `findOrCreateShopBySlug` compiling)
- [ ] 3.2.5 Create `packages/db/src/repositories/shops.integration.test.ts` (~45 lines): `listShops()` → total 12, first id 15 (desc); 3 reconstructed rows present (`noaw`, `launchidea`, `tetetetet`); `productsCount` of `grocery-shop`=584, `makeup-shop`=82, `noaw`=188; `{name:'shop'}` → 7; `findShopBySlug('gadget').productsCount`=44; `findShopBySlug('no-existe')` → `null`
- [ ] 3.2.6 `cd packages/db && npm run typecheck && npm test` green

### Phase 3.3: Rebuild (blocking)
- [ ] 3.3.1 `just db-build`

### Phase 3.4: `apps/api/rest`
- [ ] 3.4.1 `apps/api/rest/src/shops/shops.service.ts`: **only** `getShops` (line 30) and `getShop` (line 97) migrate — async over `listShops`/`findShopBySlug` + `parseSearch` (`name`, `is_active:1` → `isActive:true`, V-15) + `toShopDto` (16 keys: `owner:null`, `orders_count:0`, `notifications:null`, `products_count: r.productsCount ?? 0`); try/404/503/500 pattern for `getShop`. `getNewShops`/`getStaffs`/`getNearByShop`/`approveShop`/`disapproveShop`/`update`/`remove`/`create` untouched — `shopsJson`/`nearShopJson`/`fuse`/`plainToClass` stay

### Phase 3.5: Verification
- [ ] 3.5.1 `just db-check` green (16 previous + 1 new suite)
- [ ] 3.5.2 `just build-api` green
- [ ] 3.5.3 `curl :9001/api/shops?limit=30` → 12 rows (mock: 9), diff vs baseline with `node -e` template — divergences limited to V-4/V-5/V-6/V-7 + 3 new rows + `makeup-shop` 81→82
- [ ] 3.5.4 `docker exec -e PGPASSWORD=safari safari-postgres psql -h localhost -U safari -d safari_scraper -c "SELECT id, slug, description LIKE 'Reconstruido%' AS recon FROM shops ORDER BY id DESC"` → 12 rows, ids 15/14/12 `recon=t`, rest `recon=f` (CA-3)
- [ ] 3.5.5 `curl :9001/api/shops/gadget` vs the same row in `pg-shops.json` → identical object, 16 keys, `products_count`=44
- [ ] 3.5.6 `just db-down`; `curl` on all 4 catalogs + `top-manufacturers` → 5x 503; `curl :9001/api/settings` → 200 (process alive); `just db-up`
- [ ] 3.5.7 `just verify`; `just shop-dev` (separate terminal) + `curl localhost:3003/en/shops` and `/en/shops/gadget` per design.md CA-4 checks

### Phase 3.6: Documentation close-out
- [ ] 3.6.1 Rewrite `docs/product/1-catalogo-desde-postgres/4-migrar-catalogos-apoyo.md` into US-4a: title, scope without `categories`, CAs, DoD with pasted evidence, **Status**, LOC, split note pointing to `./4b-categorias-arbol-postgres.md`
- [ ] 3.6.2 `docs/product/1-catalogo-desde-postgres/README.md` line 33 table: US-4a row (Implementada) + new US-4b row (pending); adjust "Orden sugerido" (line 35)
- [ ] 3.6.3 `docs/product/README.md` line 196: `→ US-2, US-3, US-4a, US-4b`

Out of scope (unchanged): `apps/shop/**`/`apps/admin/**` beyond the curl smoke checks above, `db/schema.sql`, `packages/db/prisma/schema.prisma`, all 4 controllers, `categories`/US-4b files, jest specs for the 4 services (D-10).
