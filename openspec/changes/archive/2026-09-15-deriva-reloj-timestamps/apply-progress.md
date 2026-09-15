# Apply Progress: US-32 — Un solo reloj para `created_at` y `updated_at`

**Change**: `deriva-reloj-timestamps`
**Mode**: Standard (strict_tdd: false)
**Status**: 45/45 tasks complete (42 original + 3 added by the gate re-run:
4.13, 5.3, and Phase 7's audit trail covering 7.1-7.3). Ready for
`sdd-verify`.

## Gate re-run (2026-09-15, second pass)

A fresh-context reviewer audited the implementation against the real code
and the live database and found 2 blocking text defects (F-1, F-2), 1 real
test gap (R-1), and 2 cheap-but-correct comment/anchor fixes (R-3, R-5). No
working behavior, DDL, the 7 `updatedAt: now()` insertions, or
`schema.prisma` were touched — see the point-by-point list below. Full
detail also recorded in `tasks.md` Phase 7.

| ID | File(s) | What changed |
|----|---------|--------------|
| F-1 | `packages/db/src/repositories/products.repository.ts:880-882` | `deleteProduct`'s JSDoc still named the removed trigger `products_updated_at`. Reworded to "Un `DELETE` no escribe `updated_at`" — same conclusion, false mechanism dropped. |
| F-2 | `packages/db/src/repositories/shops.repository.ts:198-207`, `specs/data-layer-clock-policy/spec.md:84-92` | Both claimed "retirar el trigger hace cierta la promesa por primera vez" — the change's own D-4 finding (Prisma emits no `UPDATE` for `update: {}` on an existing row) proves the promise was already true pre-change, since the trigger never fired on this path. Reworded both to cite the `log:['query']` observation; kept the `MUST NOT` requirement and its scenario unchanged. |
| R-1 | `packages/db/src/repositories/products.integration.test.ts` (new test in the `upsertScrapedProduct` describe) | The scraper's `updatedAt: now()` line (`products.repository.ts:405`) was unprotected — deleting it left all 208 tests green. Added a fixed-clock test (own `afterEach` + `_setNowProvider`), same pattern as the other four new invariant tests. Test count: 208 → **209**. |
| R-3 | `packages/db/src/repositories/tags.repository.ts:169`, `manufacturers.repository.ts:195-196` | "no tiene trigger `updated_at` (`db/schema.sql:480-500`)" implied a false contrast post-D-1 (no table has one now) and the cited range pointed at the replacement policy comment. Reworded; comment-only, no behavior change (respects the `types`/`tags`/`manufacturers` non-goal). |
| R-5 | `specs/data-layer-clock-policy/spec.md:52-57` | Seven call-site line anchors were pre-change numbers, stale by 1-12 lines after the `import { now }` insertions. Refreshed to current: `products.repository.ts:381,818`, `categories.repository.ts:535`, `shops.repository.ts:314,346`, `users.repository.ts:329,346`. |

**Noted, NOT fixed** (explicitly out of scope, per the coordinator's
instructions):
- `docs/product/33-.../34-esquema-capa-datos-contenido.md:238-241` still
  documents the removed triggers. It belongs to US-34's planning doc and is
  already self-flagged there ("Es la deriva que US-32 corrige") — editing
  another US's doc is out of scope for this change. **US-34's author should
  see this note before that US executes.**
- Prettier/formatter reflow of unrelated lines in
  `users.integration.test.ts` (~143, 154, 283, 297, 320) and
  `shops.integration.test.ts` (~288, 416), a side effect of `npm run
  build`/editor formatting during the original apply batch. Reverting risks
  more churn than it saves; left as-is.

### Re-verification after the fixes

```
cd packages/db && npm run typecheck && npm test
> @safari/db@0.1.0 typecheck
> tsc --noEmit
(clean, 0 errors)

> @safari/db@0.1.0 test
> vitest run
 Test Files  10 passed (10)
      Tests  209 passed (209)
   Start at  08:20:02
   Duration  37.83s
```

Typecheck clean; 209/209 tests pass (up from 208 — the new R-1 test). The
new test's `TEST_STORE` rows are cleaned by the file's existing
`beforeAll`/`afterAll`; confirmed via `psql`:
`products WHERE source_store = 'TestStore-integration'` → 0 rows,
`products` total → 1200 (unchanged).

Per the coordinator's instructions, `npx jest`, `just build-api`, and `just
verify` were NOT re-run for this pass — none of the F-1/F-2/R-1/R-3/R-5
edits touch the API, and the reviewer independently reproduced 285/285.

Phases 1-5 (DDL, rebuild/re-introspection, repositories, tests, docs) were
already implemented and marked `[x]` in `tasks.md` with inline evidence when
this apply batch started (no prior `apply-progress.md` existed, but the
working tree already carried the matching diff — verified file-by-file
against `design.md` below before proceeding). This batch independently
re-verified Phases 1-5 against the design's `file:line` anchors and executed
all of Phase 6 (verification), which was the only phase still `[ ]`.

## Phase 1-5 — Independent re-verification (not re-implemented; confirmed correct)

Verified via `git diff` against `design.md`'s exact specifications:

- `db/schema.sql:477-500` → D-1 policy comment, exact text match. Function
  `tocar_updated_at()` and all 5 triggers removed.
- `packages/db/src/repositories/products.repository.ts`: `updatedAt: now()`
  added at `upsertScrapedProduct` (update branch) and at `updateProduct`
  **after `:856`** (confirmed NOT at `:855`, which would land inside the
  nested `tags:` object). JSDoc `:749-751` rewritten (D-6).
- `packages/db/src/repositories/categories.repository.ts`: `import { now }
  from '../clock';` added after `:18`; `updatedAt: now()` added in
  `updateCategory`; JSDoc `:502-504` rewritten.
- `packages/db/src/repositories/shops.repository.ts`: import added after
  `:8`; `updatedAt: now()` in `updateShop` and `setShopActive`;
  `findOrCreateShopBySlug`'s `update: {}` **left untouched**, comment
  expanded with the D-4 asymmetry text; JSDoc `:288-289` rewritten (DD30-7
  kept as history).
- `packages/db/src/repositories/users.repository.ts`: import added after
  `:15`; `updatedAt: now()` in `updateUserPasswordHash` and `setUserActive`.
- `packages/db/src/clock.ts`: header rewritten with full D-5 scope text.
- `packages/db/README.md:37`: pointer added.
- All FOUR integration test files (`categories`, `products`, `shops`,
  `users`): `afterEach` added to the `vitest` import, `import {
  _setNowProvider } from '../clock';` added, one new invariant test per
  file following the `types.integration.test.ts:92-116` pattern, obsolete
  trigger-era comments rewritten. `users` test correctly narrows
  `setUserActive`'s `UserRecord | null` return before reading `.updatedAt`.
  `shops` test places the new `findOrCreateShopBySlug` `describe` AFTER the
  monotonía block and BEFORE the `:417-436` tripwire, per the normative
  placement in `tasks.md` 4.9.
- `packages/db/prisma/schema.prisma`: clean (`git status --porcelain`
  empty), confirming the `git checkout --` shortcut from Phase 2.5 was
  already applied. The scratchpad from the prior session still holds
  `schema.prisma.pre` and the raw `schema.prisma.diff` (399 lines) — spot
  read confirmed a 100% cosmetic diff (lost header `:1-29`, Prisma
  formatter realignment, no `@default(now())` loss, no type changes, no new
  `@unique`).

`git diff --stat` at the start of this batch: 11 files changed, 254
insertions(+), 110 deletions(-) — consistent with the ~241-line forecast
(single PR, no chaining needed, `400-line budget risk: Low`).

## Phase 6 — Verification (this batch)

### 6.1 `just db-check`

```
npm run typecheck
> @safari/db@0.1.0 typecheck
> tsc --noEmit

cd "$(pwd)" && npm test
> @safari/db@0.1.0 test
> vitest run

 Test Files  10 passed (10)
      Tests  208 passed (208)
   Start at  07:52:37
   Duration  22.64s
```

Typecheck clean (0 errors); the `users` null-narrowing guard compiles.
208/208 tests pass across 10 integration files (includes the 4 new
invariant tests + the D-4 test).

### 6.2 `cd apps/api/rest && npx jest`

```
PASS src/common/errors/domain-error.mapper.spec.ts
PASS src/users/user-dto.mapper.spec.ts
PASS src/types/types.service.spec.ts
PASS src/tags/tags.service.spec.ts
PASS src/manufacturers/manufacturers.service.spec.ts
PASS src/categories/categories.service.spec.ts
PASS src/shops/shops.service.spec.ts
PASS src/products/products.service.spec.ts
PASS src/users/users.service.spec.ts

Test Suites: 9 passed, 9 total
Tests:       285 passed, 285 total
Time:        68.022 s
```

Zero impact radius confirmed — all 9 suites mock `@safari/db`, unaffected by
the repository/DDL changes.

### 6.3 `just build-api`

```
yarn build
$ rimraf dist
$ nest build
Done in 59.63s.
```

Clean build, no TS errors.

### 6.4 `just verify`

Brought up all three services (API first, per `CLAUDE.md`'s SSR
requirement): `just api-dev` (port 9001), then `just shop-dev` (3003) and
`just admin-dev` (3002), confirmed each `✓ Ready` before proceeding.

```
OK   API    :9001/api/settings  200  5503B  39ms
OK   Shop   :3003/en  200  190788B  43699ms  cards:30
OK   Admin  :3002/en/login  200  72821B  7051ms  cards:1
```

All three services green with real content (product-cards counted). Dev
servers stopped after verification (`taskkill` on the listening PIDs for
9001/3003/3002); `safari-postgres` container left running (persistent
infra, not started by this session).

### 6.5 `psql` evidence — created-then-updated row per table

Seed counts re-confirmed intact before starting (state left by the prior
Phase 2 `db-reset`, container `safari-postgres` already "Up 9 hours
(healthy)" at the start of this batch):

```sql
SELECT count(*) FROM categories;                        -- 198
SELECT count(*) FROM categories WHERE parent_id IS NULL; -- 83
SELECT tgname FROM pg_trigger WHERE NOT tgisinternal;     -- 0 rows
```

Evidence rows were created via `@safari/db`'s built `dist/index.js` (the
same repository functions the app uses — `createCategory`/`updateCategory`,
`createShop`/`updateShop`, `createProduct`/`updateProduct`,
`createUser`/`setUserActive`, plus a nested `profile` create), with a
20 ms gap between create and update:

```
 id  |         created_at         |         updated_at         | ok
-----+----------------------------+----------------------------+----
 241 | 2026-09-15 13:00:10.006+00 | 2026-09-15 13:00:10.123+00 | t   (categories)
  31 | 2026-09-15 13:00:10.176+00 | 2026-09-15 13:00:10.22+00  | t   (shops)
1274 | 2026-09-15 13:00:10.259+00 | 2026-09-15 13:00:10.453+00 | t   (products)
  19 | 2026-09-15 13:00:10.505+00 | 2026-09-15 13:00:10.547+00 | t   (users)
```

```
 user_id | created_at                  | updated_at                  | equal_as_expected
      19 | 2026-09-15 13:00:10.505+00  | 2026-09-15 13:00:10.505+00  | t   (profiles)
```

`profiles`: `created_at = updated_at`, **as declared in advance** — no
`UPDATE` route exists for `profiles` (sub-decisión b), so the invariant
holds vacuously.

Evidence rows (`zz-verify-*` centinelas, ids 241/31/1274/19/32) were
deleted after capture; seed counts re-confirmed after cleanup: categories
198/83, shops 12, users 3, products 1200 — unchanged.

### 6.6 US-32 doc updated

`docs/product/32-deriva-reloj-updated-at-created-at.md`: `Status` line
updated to "Implementada y verificada (2026-09-15)"; all 5 items of the
Definición de Done checklist marked `[x]` with the evidence above pasted
inline (abridged) and a pointer to this file for the full command output.

## D-4 finding — CONFIRMED (design's open question resolved)

**Question**: does Prisma emit an actual `UPDATE` for `update: {}` in
`findOrCreateShopBySlug`'s upsert when the row already exists?

**Method**: `NODE_ENV=development` (activates `client.ts`'s
`log: ['query', 'error', 'warn']`), called `findOrCreateShopBySlug` twice
with the same slug against a fresh sentinel shop.

**First call** (row does not exist yet) — full `INSERT`:
```
SELECT "shops"."id" FROM "shops" WHERE (slug = $1 AND 1=1) OFFSET $2
INSERT INTO "shops" (...) VALUES (...) RETURNING "shops"."id"
SELECT ... FROM "shops" WHERE "id" = $1 LIMIT $2 OFFSET $3
COMMIT
```

**Second call** (row exists) — no `UPDATE` anywhere:
```
SELECT "shops"."id" FROM "shops" WHERE (slug = $1 AND 1=1) OFFSET $2
SELECT ... FROM "shops" WHERE ((slug = $1 AND 1=1) AND "id" IN ($2)) LIMIT $3 OFFSET $4
SELECT ... FROM "shops" WHERE "id" = $1 LIMIT $2 OFFSET $3
COMMIT
```

`updatedAt` identical across both calls: `2026-09-15T13:00:10.582Z` for
both `primero` and `segundo`.

**Finding**: Prisma's `upsert` with an empty `update: {}` object never
issues an `UPDATE` statement when the row already exists — it only re-reads
it. This means the D-4 hypothesis in `design.md` ("today the trigger bumps
`updated_at` on every scraper re-run") was **false even before this
change**: the trigger never fired on this path either, because no `UPDATE`
was ever sent to Postgres for it — a `BEFORE UPDATE` trigger only fires on
an actual `UPDATE` statement. So this change does not alter
`findOrCreateShopBySlug`'s runtime behavior at all; it only removes a
trigger that was dead code for this specific path (consistent with D-1's
finding that the `:494-496` comment's claim about `profiles` having "real"
`UPDATE`s was also wrong — no route exists there either). The D-4 test
passes for the reason design.md already flagged as acceptable either way:
it asserts an outcome (`updatedAt` unchanged), not a mechanism.

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `db/schema.sql` | Modified | Removed `tocar_updated_at()` + 5 triggers; D-1 policy comment |
| `packages/db/src/clock.ts` | Modified | D-5 header scope documentation |
| `packages/db/README.md` | Modified | Pointer to `clock.ts` scope note |
| `packages/db/src/repositories/categories.repository.ts` | Modified | `now` import, `updatedAt: now()`, JSDoc rewrite |
| `packages/db/src/repositories/products.repository.ts` | Modified | 2× `updatedAt: now()` (upsert + update), JSDoc rewrite; gate re-run F-1: `deleteProduct` JSDoc trigger reference dropped |
| `packages/db/src/repositories/shops.repository.ts` | Modified | `now` import, 2× `updatedAt: now()`, D-4 comment, JSDoc rewrite; gate re-run F-2: D-4 comment rationale corrected |
| `packages/db/src/repositories/users.repository.ts` | Modified | `now` import, 2× `updatedAt: now()` |
| `packages/db/src/repositories/tags.repository.ts` | Modified (gate re-run, R-3) | `updateTag` JSDoc: dropped false implied contrast, re-cited `db/schema.sql:477-487` |
| `packages/db/src/repositories/manufacturers.repository.ts` | Modified (gate re-run, R-3) | `updateManufacturer` JSDoc: same fix as `tags.repository.ts` |
| `packages/db/src/repositories/categories.integration.test.ts` | Modified | imports, invariant test, comment rewrite |
| `packages/db/src/repositories/products.integration.test.ts` | Modified | imports, invariant test, comment rewrite; gate re-run R-1: new `upsertScrapedProduct` fixed-clock test (208 → 209) |
| `packages/db/src/repositories/shops.integration.test.ts` | Modified | imports, invariant test, D-4 test, comment rewrite |
| `packages/db/src/repositories/users.integration.test.ts` | Modified | imports, invariant test with null narrowing |
| `packages/db/prisma/schema.prisma` | Verified unchanged | `git status --porcelain` empty; cosmetic-only diff from Phase 2 already resolved via `git checkout --` |
| `openspec/changes/deriva-reloj-timestamps/specs/data-layer-clock-policy/spec.md` | Modified (gate re-run, F-2 + R-5) | Corrected D-4 rationale sentence; refreshed 7 stale call-site line anchors |
| `docs/product/32-deriva-reloj-updated-at-created-at.md` | Modified (this batch) | Status + DoD checklist evidence |
| `openspec/changes/deriva-reloj-timestamps/tasks.md` | Modified (this batch + gate re-run) | Phase 6 marked `[x]`; tasks 4.13, 5.3, and Phase 7 (7.1-7.3) added and marked `[x]` |

## Deviations from Design

None in the original batch — implementation matched `design.md` exactly at
every verified `file:line` anchor, including both documented traps
(`updateProduct`'s `:856` insertion point,
`shops.integration.test.ts`'s `findOrCreateShopBySlug` placement before the
tripwire). The gate re-run's F-1/F-2/R-3 fixes are corrections to prose
that `design.md` itself did not fully anticipate (D-6's JSDoc inventory
missed `deleteProduct`'s trigger citation, and D-4's rationale text
predated the `log:['query']` confirmation it called for) — not deviations
from an instruction, but gaps the design left for the review to catch.

## Issues Found

The gate re-run surfaced real gaps that this document now records as
already fixed (see "Gate re-run" section above): two stale trigger/rationale
references (F-1, F-2) and one real test hole on the scraper's write path
(R-1). None of them indicated a working-behavior defect — `just db-check`,
`npx jest`, `just build-api`, and `just verify` were all green both before
and after. The D-4 open question is resolved: the trigger never fired on
`findOrCreateShopBySlug`'s empty-update path even before this change
(Prisma emits no `UPDATE` for `update: {}` on an existing row), so removing
the trigger is behaviorally inert there — a finding this pass corrected the
prose to reflect accurately in both `shops.repository.ts` and the delta
spec.

## Workload / PR Boundary

- Mode: single PR (per resolved `delivery_strategy`)
- Current work unit: Unit 1 — Full US-32 (DDL + repos + tests + docs)
- Boundary: this batch starts from Phase 6 (Phases 1-5 were already in the
  working tree), covers the gate re-run's F-1/F-2/R-1/R-3/R-5 corrections,
  and ends with all 45/45 tasks complete and re-verified
- Estimated review budget impact: original batch `git diff --stat` = 254
  insertions(+), 110 deletions(-) across 11 source files; the gate re-run
  adds a small, mostly-comment/prose delta on top (1 new test ~30 lines, 2
  JSDoc rewords, 1 DDL-free comment reword ×2 files, 1 spec.md correction +
  anchor refresh) — still well under the 400-line budget

## Status

45/45 tasks complete (42 original + 3 gate re-run: 4.13, 5.3, Phase 7).
Ready for `sdd-verify`.
