# Tasks: US-32 — Un solo reloj para `created_at` y `updated_at`

## Review Workload Forecast

| Área | Adds | Dels | Total | Base |
|---|---|---|---|---|
| DDL (`db/schema.sql:477-500`) | 11 | 24 | 35 | policy comment replaces function+5 triggers |
| Repos (4 files: imports, 7 `updatedAt: now()`, D-4 comment, 3 JSDoc) | ~24 | ~11 | 35 | categories 8, products 8, shops 16, users 3 |
| `clock.ts` header (D-5) | 21 | 7 | 28 | full CA-3 scope text |
| `README.md:37` pointer | 1 | 1 | 2 | one-line addition |
| Tests (4 integration files: 2 imports, 4 invariant tests, 3 comment rewrites, 1 D-4 test) | ~100 | ~41 | 141 | imports 12, invariant tests 72, comment rewrites 51, D-4 test 6 |
| **Total** | **~157** | **~84** | **~241** | budget 400 |

Arithmetic detail: DDL 24 removed / 11 added (D-1 exact text). Repos —
categories: import(+1) + `updatedAt`(+1) + JSDoc :502-504 rewrite(~3/~3) = 8;
products: 2×`updatedAt`(+2) + JSDoc :749-751 rewrite(~3/~3) = 8 (import
already present, no line); shops: import(+1) + 2×`updatedAt`(+2) + D-4
comment expansion (~2 old/~6 new = 8) + JSDoc :288-289 rewrite(~3/~2) = 16;
users: import(+1) + 2×`updatedAt`(+2) = 3. Tests — imports: 4 files ×
(afterEach in existing line + new `_setNowProvider` line) ≈ 3 each = 12;
invariant tests: 4 files × ~18-line block (types.integration.test.ts:92-116
pattern) = 72; comment rewrites: 3 files (categories/products/shops) × ~17
changed lines (long obsolete comment shrunk to 3-4 lines + describe title) =
51; D-4 `findOrCreateShopBySlug` test in `shops.integration.test.ts` ≈ 6.

This is above the proposal's original ~150-200 (D-6's 3 JSDoc rewrites and
the second import line per test file were found later, in design, and add
~40-50 lines the proposal didn't count) but still **~160 lines under the
400 budget**, and the change is one cohesive unit — DDL, repos and tests are
interdependent (tests go red without the repo changes; the repo changes are
meaningless without the DDL) so splitting into PRs would break atomicity
without reducing reviewer load. No split proposed.

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Full US-32 (DDL + repos + tests + docs) | single PR | Atomic; ~241 changed lines, ~160 under budget |

## Phase 1: DDL

- [x] 1.1 `db/schema.sql`: replace `:477-500` (banner + `tocar_updated_at()`
  `:480-486` + 5 `CREATE OR REPLACE TRIGGER` `:488-500`) with the D-1 policy
  comment (exact text in design.md D-1). Leave `:501-503` (blank lines +
  `COMMIT;`) untouched. Traces: `data-layer-clock-policy` Req "Reloj único
  por fila, sin trigger de base de datos" (CA-1).

## Phase 2: Rebuild + Re-introspection

- [x] 2.1 Run `just db-reset` (already invokes `just db-up`,
  `justfile:322-324` — one command, not two). Verify seed counts:
  `SELECT count(*) FROM categories` = 198, `WHERE parent_id IS NULL` = 83.
  Do not continue on a bad count; re-run `just db-reset`.
- [x] 2.2 `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal;` → must
  return 0 rows. Traces: Req scenario "No hay trigger `BEFORE UPDATE` sobre
  estas cinco tablas".
- [x] 2.3 Pre-pull safety: `git status --porcelain packages/db/prisma/schema.prisma`
  must be empty (commit/stash first if not); copy the file to the scratchpad
  as `schema.prisma.pre` (byte-for-byte reference for step 2.5's shortcut).
- [x] 2.4 `cd packages/db && npx prisma db pull`; capture the FULL
  `git diff packages/db/prisma/schema.prisma` (all 15 models, not only the
  5 touched by triggers).
- [x] 2.5 Classify the diff per design's cosmetic-vs-semantic table.
  **Cosmetic** (lost header `:1-28`, models back to `snake_case` without
  `@@map`, fields without `@map`, missing `previewFeatures` `:34`, re-added
  `url = env("DATABASE_URL")` in `datasource` `:37-39`, renamed relations,
  reordered blocks) → re-apply renames, or take the shortcut
  `git checkout -- packages/db/prisma/schema.prisma` (safe because of 2.3).
  **Semantic** (field type change, `@default(now())` disappearing or
  becoming `dbgenerated`, irrestorable `@@map`, new/missing model, new
  `@unique` on `User.email`) → **HARD STOP. Do not accept the file. Do not
  proceed to Phase 3. Report as blocker** — the falsifiable prediction
  ("empty/cosmetic diff") failed.
  **Result: 100% cosmetic.** Lost header block `:1-29`; column
  realignment/reordering from Prisma's own formatter across most models;
  two new informational `///` doc comments on models with expression
  indexes; `OtpCode`'s `@@index([phone], map: "otp_codes_phone_idx")` lost
  the explicit `map` because it now matches Prisma's own default index
  name (not a rename, same index). No field type changes, no lost
  `@default(now())`/`dbgenerated`, no model added/removed, no new
  `@unique` on `User.email`; `previewFeatures = ["partialIndexes"]` and all
  `@map`/`@@map` preserved; no `url` re-added to `datasource`. Took the
  `git checkout --` shortcut (safe per 2.3's clean pre-pull check).
- [x] 2.6 Paste the classified diff (or empty-diff confirmation) as
  evidence in the verify report.
- [x] 2.7 `just db-build` (prisma generate + tsup) so `@safari/db` is
  buildable/typecheckable for Phase 3-4 and `just db-check`.

## Phase 3: Repositories

- [x] 3.1 `categories.repository.ts`: add
  `import { now } from '../clock';` after `:18` (biome order: `../client` <
  `../clock` < `../domain-errors`).
- [x] 3.2 `categories.repository.ts` `updateCategory` (`:534`): add
  `updatedAt: now()` as last key of `data`, after `language` (`:543`),
  before `}` (`:544`). Traces: Req "Inventario exhaustivo de rutas de
  `UPDATE`".
- [x] 3.3 `categories.repository.ts`: rewrite JSDoc `:502-504` (D-6) — drop
  the trigger claim and the dangling `:490` cite; state `updatedAt: now()`
  from `clock.ts` (US-32).
- [x] 3.4 `shops.repository.ts`: add `import { now } from '../clock';`
  after `:8`.
- [x] 3.5 `shops.repository.ts` `updateShop` (`:302`): add
  `updatedAt: now()` after `settings` (`:312`), before `}` (`:313`).
- [x] 3.6 `shops.repository.ts` `setShopActive` (`:333`): one-liner
  `data: { isActive, updatedAt: now() },` at `:335`.
- [x] 3.7 `shops.repository.ts` `findOrCreateShopBySlug` (`:191-200`): do
  **NOT** add `updatedAt: now()` to `update: {}`; expand the comment at
  `:198` with the exact D-4 text naming the deliberate asymmetry. Traces:
  Req "Excepción de actualización vacía en `findOrCreateShopBySlug`".
- [x] 3.8 `shops.repository.ts`: rewrite JSDoc `:288-289` (D-6), keep
  `DD30-7` as history.
- [x] 3.9 `users.repository.ts`: add `import { now } from '../clock';`
  after `:15`.
- [x] 3.10 `users.repository.ts` `updateUserPasswordHash` (`:328`):
  one-liner `data: { passwordHash, updatedAt: now() },` at `:330`.
- [x] 3.11 `users.repository.ts` `setUserActive` (`:345`): one-liner
  `data: { isActive, updatedAt: now() },` at `:347`.
- [x] 3.12 `products.repository.ts` `upsertScrapedProduct` (`:381`, update
  branch `:396`): add `updatedAt: now()` as last key of `update:`, after the
  `tagIds` spread closes at `:405` (`}),`), before `}` at `:406`. Do NOT
  touch `scalars` (`:349-373`) or the `create:` branch (`:388-395`) — D-3.
- [x] 3.13 `products.repository.ts` `updateProduct` (`:817`): add
  `updatedAt: now()` as last key of `data`, after the `tagIds` spread closes
  at **`:856`** (`}),`) — **NOT `:855`**, which lands inside the nested
  `tags:` object and fails typecheck — before `}` at `:857`.
- [x] 3.14 `products.repository.ts`: rewrite JSDoc `:749-751` (D-6).

## Phase 4: Tests

- [x] 4.1 `categories.integration.test.ts` (imports `:14-26`): add
  `afterEach` to the existing `vitest` import; add
  `import { _setNowProvider } from '../clock';` after it.
- [x] 4.2 `categories.integration.test.ts`: add invariant test for
  `updateCategory`, copying the `types.integration.test.ts:92-116` pattern
  (sentinel create → `_setNowProvider(future)` → assert
  `updatedAt === future`, `updatedAt >= createdAt`, `createdAt < future`).
  Traces: Req "Invariante `updated_at >= created_at`" (CA-2) + "Reloj único
  por fila" (CA-1).
- [x] 4.3 `categories.integration.test.ts`: rewrite the describe title and
  comment at `:277-289` (+ note `:306-313`) to 3-4 lines per design table
  (describe becomes "updatedAt explícito", like `types:92`).
- [x] 4.4 `products.integration.test.ts` (imports `:9-27`): same two import
  additions as 4.1.
- [x] 4.5 `products.integration.test.ts`: add invariant test for
  `updateProduct` (reuse `SENTINEL_PREFIX` + `deleteProduct`), same pattern
  as 4.2.
- [x] 4.6 `products.integration.test.ts`: rewrite comment block `:518-539`
  (+ note `:557-561`) — move the ~150-450 ms measurement to past tense with
  a date; it justified US-32, it is not a current constraint.
- [x] 4.7 `shops.integration.test.ts` (imports `:7-23`): same two import
  additions as 4.1.
- [x] 4.8 `shops.integration.test.ts`: add invariant test for `updateShop`
  (`zz-tiendas-` sentinel + `prisma.shop.delete`), same pattern as 4.2.
- [x] 4.9 `shops.integration.test.ts`: add the `findOrCreateShopBySlug`
  test (D-4: call twice, assert `updatedAt` unchanged). **Placement is
  normative**: after the monotonía `describe` (closes `:415`) and **BEFORE**
  the tripwire at `:417-436` — the comment at `:424-428` mandates this;
  placing it at the end loses that block's seed-restitution net. Traces:
  Req "Excepción de actualización vacía en `findOrCreateShopBySlug`".
- [x] 4.10 `shops.integration.test.ts`: rewrite the describe title at
  `:373` and comment `:374-381`; re-cite or drop the
  `products.integration.test.ts:517-567` reference since that range shifts
  after task 4.6.
- [x] 4.11 `users.integration.test.ts` (imports `:17-30`): same two import
  additions as 4.1.
- [x] 4.12 `users.integration.test.ts`: add invariant test for
  `setUserActive`, with the required non-null narrowing guard
  (`setUserActive` returns `UserRecord | null`, `strict: true` —
  `expect(updated).not.toBeNull(); if (!updated) throw new Error(...)`
  before reading `.updatedAt`). Place in the writes `describe` (`:157`) or
  a new one right after — **never** against the 3 seeded users (`:1-15`;
  `setUserActive(3, false)` locks out the admin).
- [x] 4.13 (gate re-run, R-1) `products.integration.test.ts`: the scraper's
  `upsertScrapedProduct` update-branch `updatedAt: now()` (`:405`, task
  3.12) had no test — the existing `upsertScrapedProduct` describe asserted
  nothing about `updatedAt`, so deleting that line left all 208 tests
  green. Added a fixed-clock test in that `describe` (own `afterEach` +
  `_setNowProvider`, second upsert on an existing row via `sourceStore`/
  `sourceProductId`), same pattern as 4.2/4.5/4.8/4.12. Traces: Req
  "Inventario exhaustivo de rutas de `UPDATE`" (CA-2), scenario "Una ruta
  olvidada no la detecta el test del invariante".

## Phase 5: Documentation (CA-3)

- [x] 5.1 `packages/db/src/clock.ts`: rewrite header `:1-7` with the full
  D-5 text (scope: which columns `_setNowProvider` governs and which it
  does not). Traces: Req "Alcance documentado de `_setNowProvider`" (CA-3).
- [x] 5.2 `packages/db/README.md:37`: add the pointer to `clock.ts`'s
  scope note (README stays the index; `clock.ts` stays the single source
  of truth).
- [x] 5.3 (gate re-run, F-1) `products.repository.ts:880-882`
  (`deleteProduct` JSDoc): still named the removed trigger
  `products_updated_at` as the reason a `DELETE` can't diverge from a later
  `updated_at`. Planning gap — no task in this file covered it (excluded by
  name in design.md D-6 as "still true, vacuously", which missed that the
  MECHANISM clause, not just the conclusion, was false). Reworded to "Un
  `DELETE` no escribe `updated_at`" — the conclusion is unchanged, only the
  false trigger citation is dropped.

## Phase 7: Post-review corrections (gate re-run, 2026-09-15)

Fresh-context adversarial review after Phase 6 found two additional text
defects and reused F-1/R-1 above (already folded into Phase 4/5). Recorded
here for audit trail; no working behavior, DDL, `updatedAt: now()`
insertion, or `schema.prisma` was touched.

- [x] 7.1 (F-2) `shops.repository.ts:198-207` and
  `specs/data-layer-clock-policy/spec.md:84-92` both asserted that removing
  the trigger is what "first makes true" the `findOrCreateShopBySlug`
  comment's promise ("no se pisa nada si ya existe"). This is the premise
  the change's OWN D-4 finding (apply-progress.md) disproved: Prisma emits
  no `UPDATE` at all for `update: {}` on an existing row (verified with
  `log:['query']`), so the trigger never fired on this path either — the
  promise was already true before this change. Reworded both to cite the
  `log:['query']` observation and state the exemption exists to avoid
  mechanically applying "every update path sets `updatedAt`" to a call that
  performs no update. Requirement (`MUST NOT` advance `updated_at`) and its
  scenario kept unchanged — only the rationale sentence was false.
- [x] 7.2 (R-3) `tags.repository.ts:169` and
  `manufacturers.repository.ts:195-196`: reworded the "no tiene trigger
  `updated_at` (`db/schema.sql:480-500`)" comments — still literally true,
  but the implied contrast ("the others do") is now false post-D-1, and the
  cited range now points at the replacement policy comment
  (`db/schema.sql:477-487`). Comment-only; no behavior change to
  `types`/`tags`/`manufacturers` (non-goal).
- [x] 7.3 (R-5) `specs/data-layer-clock-policy/spec.md:52-57`: the seven
  call-site line anchors were pre-change numbers, stale after the `import
  { now }` insertions (task 3.1/3.4/3.9) shifted lines by 1-12. Refreshed
  to current: `products.repository.ts:381,818`,
  `categories.repository.ts:535`, `shops.repository.ts:314,346`,
  `users.repository.ts:329,346`.
- Noted, NOT fixed (explicitly out of scope for this change):
  `docs/product/33-.../34-esquema-capa-datos-contenido.md:238-241` still
  documents the removed triggers — belongs to US-34's planning doc, already
  self-flagged there ("Es la deriva que US-32 corrige"); editing another
  US's doc is out of scope. Prettier reflow of unrelated lines in
  `users.integration.test.ts` (~143, 154, 283, 297, 320) and
  `shops.integration.test.ts` (~288, 416) from `npm run build`/formatter
  side effects — reverting risks more churn than it saves.

## Phase 6: Verification

- [x] 6.1 `just db-check` (typecheck + vitest, requires `just db-up` from
  Phase 2) — paste real output.
- [x] 6.2 `cd apps/api/rest && npx jest` — paste real output (9 suites);
  radio de impacto cero esperado (mocks de `@safari/db`).
- [x] 6.3 `just build-api` — requires the API buildable; paste output.
- [x] 6.4 `just verify` — requires `just api-dev`/`shop-dev`/`admin-dev`
  running per `CLAUDE.md`; paste output.
- [x] 6.5 `psql` evidence: for each of the 5 tables (`products`,
  `categories`, `shops`, `users`, `profiles`), a row created-then-updated
  showing `created_at`/`updated_at` with `updated_at >= created_at`. For
  `profiles`, `updated_at = created_at` is the expected, declared-in-advance
  result (no update route exists — sub-decisión b).
- [x] 6.6 Update US-32 status and paste this evidence into
  `docs/product/32-deriva-reloj-updated-at-created-at.md`'s Definición de
  Done checklist.
