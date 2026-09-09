# Apply Progress — US-27a (`escrituras-types-fundaciones`)

## Slice: PR#1a — Phase 1 (tasks 1.1-1.5)

**Branch**: `us-27a/pr1a-fundaciones` (uncommitted — orchestrator owns git ops)
**Mode**: Standard (strict_tdd: false)

### Tasks completed

- [x] **1.1** `packages/db/src/slug.ts` created. `normalizeSlug(text, aggregate)`:
  runtime guard `typeof text !== 'string' || text.trim() === ''` → `EmptySlugError`
  **before** any query, then `SELECT slugify(${text})` as a tagged template
  (never `$queryRawUnsafe`), empty result → `EmptySlugError`. `generateSlug(source,
  lookup, aggregate)`: resolves base from `source.slug` (trimmed, non-empty) else
  `source.name`, calls `normalizeSlug`, fetches existing slugs once via the
  injected `lookup(prefix)`, then picks the first free candidate in memory
  (`base`, `base-2`, `base-3`, …) bounded by `taken.size + 2`. No
  `if (aggregate === …)` anywhere — `aggregate` is only used as a message label.
  Exports `SlugSource` / `ExistingSlugLookup`.
- [x] **1.2** `packages/db/src/domain-errors.ts` created. `CATALOG_ERROR_CODES`
  (5 `CATALOG_*` codes), abstract `CatalogWriteError` (message + `aggregate`
  constructor params), the 5 concrete classes
  (`EmptySlugError`, `InvalidReferenceError`, `RecordNotFoundError`,
  `DependentRowsError`, `SlugConflictError`) — none hardcodes `types` or any
  other aggregate name; `aggregate`/`field`/`id`/`counts`/`slug` are all
  constructor parameters. `isCatalogWriteError` is a **structural** guard on
  `code` (not `instanceof`). `translateCatalogWriteError(error, {aggregate, id,
  uniqueField})` maps P2002→`SlugConflictError` (field from `meta.target` else
  `uniqueField`), P2003→`InvalidReferenceError` (field from `meta.field_name`
  else `uniqueField`), P2025→`RecordNotFoundError`, and returns the error intact
  otherwise — same shape as `_translateCheckViolation`. Did **not** touch
  `packages/db/src/errors.ts`.
- [x] **1.3** `packages/db/index.ts` modified — barrel-exports added for
  `CATALOG_ERROR_CODES`, `CatalogErrorCode` (type), `CatalogWriteError`,
  `DependentRowsError`, `EmptySlugError`, `InvalidReferenceError`,
  `isCatalogWriteError`, `RecordNotFoundError`, `SlugConflictError`,
  `translateCatalogWriteError` (placed right after `_setNowProvider`/`now`,
  alphabetically before `errors.ts` exports), and `generateSlug`,
  `normalizeSlug`, `SlugSource` (type), `ExistingSlugLookup` (type) (placed at
  the end, after `users.repository`, alphabetically last among `src/` root
  files). Pure plumbing — no logic changed.
- [x] **1.4** `packages/db/src/slug.integration.test.ts` created. Covers:
  `"Café & Té"`, `"Acción!"`, `"Niño Grande"` compared byte-for-byte against a
  direct `SELECT slugify($1)` call; explicit `slug` beats `name`; a
  no-collision case; `"!!!"` → `EmptySlugError`; `""` → `EmptySlugError`;
  `undefined` (cast to bypass the TS type, simulating the API's non-strict
  boundary) → `EmptySlugError`; `gadget` → `gadget-2`; `gadget` + `gadget-2` →
  `gadget-3`; and a guard that `EmptySlugError` short-circuits before the
  lookup is ever called. **All collision cases inject `ExistingSlugLookup` as
  an in-memory array/closure** — this file never reads or writes the `types`
  table (confirmed: the only `prisma.type.*` calls in `packages/db/src` remain
  `types.repository.ts:24,30`, both reads). `afterAll` calls
  `prisma.$disconnect()`, matching the read-only precedent in
  `types.integration.test.ts`.
- [x] **1.5** Verified with `just db-check` (Postgres was already `Up (healthy)`
  — `just db-up` was skipped per the environment note). Green. See full output
  below.

### Files changed

| File | Action | Lines (per `git diff --stat`, intent-to-add) |
|---|---|---|
| `packages/db/src/slug.ts` | Created | 97 |
| `packages/db/src/domain-errors.ts` | Created | 163 |
| `packages/db/src/slug.integration.test.ts` | Created | 113 |
| `packages/db/index.ts` | Modified | 14 (insertions only) |
| `openspec/changes/escrituras-types-fundaciones/tasks.md` | Modified | ticked 1.1-1.5 `[x]` |
| `openspec/changes/escrituras-types-fundaciones/apply-progress.md` | Created | this file |

### `just db-check` — real output

```
$ just db-check
npm run typecheck

> @safari/db@0.1.0 typecheck
> tsc --noEmit

cd "$(pwd)" && npm test

> @safari/db@0.1.0 test
> vitest run


 RUN  v4.1.11 C:/DevOps/MyGitHub/safari-marketplace/packages/db

(node:10432) DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead.
(Use `node --trace-deprecation ...` to show where the warning was created)

 Test Files  9 passed (9)
      Tests  102 passed (102)
   Start at  15:44:26
   Duration  6.43s (transform 2.60s, setup 0ms, import 10.72s, tests 11.02s, environment 2ms)
```

**Counts**: baseline 8 files / 91 tests → **9 files / 102 tests** (+1 file,
+11 tests — `slug.integration.test.ts`). Typecheck clean. No pre-existing test
(including `types.integration.test.ts:18`'s `toHaveLength(10)`) went red.

### Actual vs. forecast changed lines

`git diff --stat` (untracked files staged with `git add -N` only to compute the
count, then unstaged again — nothing committed):

```
 packages/db/index.ts                     |  14 +++
 packages/db/src/domain-errors.ts         | 163 +++++++++++++++++++++++++++++++
 packages/db/src/slug.integration.test.ts | 113 +++++++++++++++++++++++
 packages/db/src/slug.ts                  |  97 ++++++++++++++++++
 4 files changed, 387 insertions(+)
```

**387 changed lines vs. the ~245 forecast — about 58% over.** Breakdown vs. the
design's `File Changes` table estimates: `slug.ts` 97 vs ~65, `domain-errors.ts`
163 vs ~95, `slug.integration.test.ts` 113 vs ~75, barrel 14 vs (part of a
combined ~16 estimate shared with Phase 2). The overage is concentrated in
Spanish-language JSDoc/comment blocks that explain the *why* behind each
decision (mirroring the density already present in `products.repository.ts`,
`users.repository.ts`, `errors.ts`) and in test cases beyond the minimum
(no-collision case, lookup-not-called-on-empty-slug case) that make the domain
contract explicit. No structural scope was added beyond tasks 1.1-1.4 — same
5 error classes, same 2 slug functions, same barrel entries the design
pinned. Flagging this as a deviation from the estimate, not from the design's
required content.

### Deviations from design

- **None in behavior/signatures.** All exported signatures match the pinned
  `Interfaces / Contracts` block in `design.md` literally (`normalizeSlug`,
  `generateSlug`, `SlugSource`, `ExistingSlugLookup`, `CATALOG_ERROR_CODES`,
  `CatalogWriteError`, the 5 error classes, `isCatalogWriteError`,
  `translateCatalogWriteError`).
- **`translateCatalogWriteError`'s P2002/P2003 field resolution** is an
  implementation detail the design describes only loosely ("`meta.field_name`
  cuando P2003 lo trae"). For P2002 the design does not specify where the
  conflicting field name comes from since the call site (`types.repository.ts`,
  out of scope for this slice) only ever passes `context.uniqueField`, not the
  actual attempted slug value. Implemented as: prefer Prisma's own
  `meta.target` (array of column names) when present, otherwise fall back to
  `context.uniqueField`. This keeps the single-source-of-Prisma-codes property
  (D27-7/B7) without inventing a new parameter not in the pinned interface.
  Flagging in case `sdd-verify` or the PR#1b author expects a different
  fallback order.
- **Line-count overage** (see above) — reported, not silently absorbed into a
  terser implementation, because the density matches the file's own
  `follow_existing_patterns` precedent.

### Issues found

None. Postgres was already up and healthy; no `db-up`/`db-reset` was run.

### Remaining tasks

- [ ] 2.1-2.4 (Phase 2, PR#1b) — `types.repository.ts` writes, barrel exports
  for `createType`/`updateType`/`deleteType`, `types.integration.test.ts`
  sentinel writes. Explicitly out of scope for this run.
- [ ] 3.x-5.x (Phases 3-5, PR#2 and DoD) — API error mapping, service/DTO
  wiring, end-to-end evidence. Explicitly out of scope for this run.

### Workload / PR boundary

- Mode: stacked-to-main chained PR slice (slice 1 of 3)
- Current work unit: Unit 1 — `slug.ts` + `domain-errors.ts` +
  `slug.integration.test.ts` + barrel (slug/error exports only)
- Boundary: starts from a clean `packages/db` (no write functions exist yet)
  and ends with `just db-check` green, standalone, with zero coupling to
  `types.repository.ts` writes (Phase 2) or the API (Phase 3-4). Rollback:
  reverting this slice's 4 files leaves the read-only `packages/db` exactly as
  it was before this run — the barrel additions are purely additive exports.
- Estimated review budget impact: 387 changed lines against the 400-line
  budget and the ~245 forecast for this specific slice — over the sub-slice
  forecast but still under the global 400-line guard for a single PR, and
  fully self-contained/independently mergeable per the design's PR#1a
  definition.

## Slice: PR#1b — Phase 2 (tasks 2.1-2.4)

**Branch**: `us-27a/pr1b-repositorio` (uncommitted — orchestrator owns git ops)
**Mode**: Standard (strict_tdd: false)
**Consumes, does not modify**: `packages/db/src/slug.ts`,
`packages/db/src/domain-errors.ts`, `packages/db/src/slug.integration.test.ts`
(confirmed unchanged by this slice — see `git diff --stat` below, none of the
three appear).

### Tasks completed

- [x] **2.1** `packages/db/src/repositories/types.repository.ts` modified.
  Added `CreateTypeInput` (`name`, `slug?`, `icon?`, `settings?:
  Prisma.InputJsonValue`, `banners?: Prisma.InputJsonValue`, `language?`) and
  `UpdateTypeInput = Omit<CreateTypeInput, 'slug'>` exactly as pinned in
  `design.md`'s *Interfaces/Contracts*. Added the `typeSlugs:
  ExistingSlugLookup` call site (`findMany` + `startsWith`, 5 lines, matches
  the design's literal snippet). `createType` calls `generateSlug({name,
  slug}, typeSlugs, 'types')`, then `prisma.type.create` with a conditional
  spread that omits `icon`/`settings`/`banners`/`language` when `undefined`
  (never `null` — jsonb NOT NULL columns need the key absent, not `null`, to
  hit their `DEFAULT`). `updateType(id, input)` calls `normalizeSlug(name,
  'types')` directly (imported alongside `generateSlug`) when `input.name !==
  undefined`, discarding the return value purely for its `EmptySlugError`
  side effect (B2); the `prisma.type.update` conditional-spreads every
  optional field and always sets `updatedAt: now()` from `src/clock.ts`; the
  `slug` key is never present in `data`. `deleteType(id)` does
  `findUnique` → `RecordNotFoundError(‘types’, id)` if null, then
  `Promise.all([prisma.category.count({where:{typeId:id}}),
  prisma.product.count({where:{typeId:id}})])`; either > 0 throws
  `DependentRowsError('types', {categories, products})`; otherwise
  `prisma.type.delete` and the pre-read record is returned. All three writes
  wrap their Prisma call in `catch (error) { throw
  translateCatalogWriteError(error, {aggregate:'types', id, uniqueField:
  'slug'}); }` (id omitted for `createType`, since there is none yet before
  the row exists). The `+id`/`Number.isInteger` guard stays in the service
  layer (Phase 4), as the design specifies — not duplicated here.
- [x] **2.2** `packages/db/index.ts` modified — barrel now exports
  `createType`, `deleteType`, `updateType` and the types `CreateTypeInput`,
  `UpdateTypeInput` alongside the pre-existing `ListTypesInput`,
  `findTypeBySlug`, `listTypes`. Pure plumbing, no logic changed.
- [x] **2.3** `packages/db/src/repositories/types.integration.test.ts`
  modified. Sentinel prefix `zz-types-` (distinct from slice 1's read-only
  file and from `zz-test-`) applied to both `name` and `slug` of every
  created row. `cleanup = prisma.type.deleteMany({where:{slug:{startsWith:
  'zz-types-'}}})` runs in `beforeAll` (abandoned-run safety net) and is
  folded **inside** the pre-existing `afterAll` (originally lines 11-13) in a
  `try/finally` around `$disconnect` — no second `afterAll` was added, per
  the LIFO-hook warning in the design. New coverage: `createType` persists
  and is re-readable by `findTypeBySlug` (+ a second case asserting the
  jsonb/icon/language defaults apply when omitted); `updateType` renames
  without touching `slug` and `updatedAt` advances, measured with
  `_setNowProvider` set to a future `Date` and restored to
  `() => new Date()` in `afterEach`; `updateType({name:''})` rejects with
  `EmptySlugError` and a re-read confirms the row's `name` is untouched;
  `updateType`/`deleteType` on id `999999` reject with `RecordNotFoundError`;
  `deleteType(9)` (the `gadget` fixture) rejects with `DependentRowsError`
  and `category`/`product` counts for `typeId: 9` are asserted identical
  before and after; a sentinel with no dependents deletes cleanly (`listTypes()`
  length drops by exactly 1, and the deleted slug 404s via `findTypeBySlug`
  afterward). Closing assert (CA-6, new): `expect(await
  prisma.type.count()).toBe(10)` in a final `describe`, which only passes
  because every prior test deletes what it created (verified: `psql`
  independently confirms 10 rows after the full `just db-check` run — see
  below).
- [x] **2.4** `just db-build` run first (BLOCKING, per the design's rollout
  step 2 — `packages/db/dist` is gitignored and Nest consumes it via `link:`)
  — succeeded, see output below. Then `just db-check` — green, see output
  below.

### Files changed

| File | Action | Lines (per `git diff --stat`) |
|---|---|---|
| `packages/db/src/repositories/types.repository.ts` | Modified | +150 |
| `packages/db/src/repositories/types.integration.test.ts` | Modified | +153 / -6 |
| `packages/db/index.ts` | Modified | +11 / -3 |
| `openspec/changes/escrituras-types-fundaciones/tasks.md` | Modified | ticked 2.1-2.4 `[x]` |
| `openspec/changes/escrituras-types-fundaciones/apply-progress.md` | Modified | this section appended |

### `just db-build` — real output

```
$ just db-build
npm install

up to date, audited 325 packages in 6s
...
npm run build

> @safari/db@0.1.0 build
> prisma generate && tsup

Loaded Prisma config from prisma.config.ts.

Prisma schema loaded from prisma\schema.prisma.

✔ Generated Prisma Client (7.10.0) to .\generated\prisma\client in 279ms

CLI Building entry: index.ts
CLI Using tsconfig: tsconfig.json
CLI tsup v8.5.1
CLI Using tsup config: C:\DevOps\MyGitHub\safari-marketplace\packages\db\tsup.config.ts
CLI Target: node18
CLI Cleaning output folder
CJS Build start
CJS dist\index.js     139.56 KB
CJS dist\index.js.map 322.06 KB
CJS ⚡️ Build success in 130ms
DTS Build start
DTS ⚡️ Build success in 11270ms
DTS dist\index.d.ts 1.38 MB
```

### `just db-check` — real output

```
$ just db-check
npm run typecheck

> @safari/db@0.1.0 typecheck
> tsc --noEmit

cd "$(pwd)" && npm test

> @safari/db@0.1.0 test
> vitest run


 RUN  v4.1.11 C:/DevOps/MyGitHub/safari-marketplace/packages/db

(node:14300) DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead.
(Use `node --trace-deprecation ...` to show where the warning was created)

 Test Files  9 passed (9)
      Tests  111 passed (111)
   Start at  15:52:16
   Duration  11.06s (transform 3.53s, setup 0ms, import 14.94s, tests 13.11s, environment 3ms)
```

**Counts**: baseline entering this slice **9 files / 102 tests** →
**9 files / 111 tests** (+0 files — no new file was created this slice, only
`types.repository.ts`/`types.integration.test.ts`/`index.ts` modified;
+9 tests: 2 `createType`, 3 `updateType`, 3 `deleteType`, 1 closing
`prisma.type.count()` assert). Typecheck clean.
`types.integration.test.ts:18`'s pre-existing `toHaveLength(10)` stayed green
throughout — cleanup runs correctly per-test.

Independent `psql` confirmation after the full `just db-check` run:

```
$ docker exec safari-postgres psql -U safari -d safari_scraper -c "SELECT count(*) FROM types;"
 count
-------
    10
(1 row)
```

### Actual vs. forecast changed lines

`git diff --stat` for the three files this slice may touch:

```
 packages/db/index.ts                                        |  14 +-
 packages/db/src/repositories/types.integration.test.ts       | 153 ++++++++++++++++++++-
 packages/db/src/repositories/types.repository.ts              | 150 ++++++++++++++++++++
 3 files changed, 311 insertions(+), 6 deletions(-)
```

**317 changed lines (311 insertions + 6 deletions) vs. the ~240 forecast in
`tasks.md`'s Review Workload Forecast — about 32% over.** Same pattern as
slice 1: the overage is concentrated in Spanish JSDoc/comment blocks
explaining the *why* (R-1 dependent-count rationale, the jsonb-omission
trap, the slug-immutability precedent) and in test cases beyond the required
minimum (a second `createType` case for the jsonb/icon/language defaults; a
`RecordNotFoundError` case for both `updateType` and `deleteType`). No
structural scope was added beyond tasks 2.1-2.4 — same 3 functions, same 2
input types, same barrel entries the design pinned. `slug.ts`,
`domain-errors.ts`, and `slug.integration.test.ts` do not appear in this
diff, confirming they were not touched.

### Observation on the P2002 field-fallback question (flagged by slice 1)

Slice 1 flagged that `translateCatalogWriteError`'s P2002 handling (prefer
`meta.target` from Prisma, fall back to `context.uniqueField`) was an
implementation choice not literally pinned by the design, and asked this
slice — the first real call site — to confirm the behavior.

**What I observed:** all three `types.repository.ts` writes now pass
`uniqueField: 'slug'` to `translateCatalogWriteError`, so the fallback branch
is exercised any time Prisma's `P2002` error does *not* carry a `meta.target`
array — which, per Prisma's own error shape, is the common case for a
single-column unique violation on Postgres (Prisma populates `meta.target`
from the constraint name, not always reliably array-shaped across driver
adapters). I did **not** get to observe this end-to-end against a live P2002,
because — as `design.md`'s Decision 1 explicitly states — the only
real path to a `types` slug collision is the concurrent-`POST` race, which
"no es alcanzable de forma determinista por HTTP" and is therefore not
something a synchronous integration test can trigger deterministically
(two `generateSlug` calls would need to compute the same candidate and race
each other into the same `INSERT`). I did not attempt to force this with a
raw duplicate-slug `prisma.type.create` bypassing `generateSlug`, since that
would test `translateCatalogWriteError` itself (slice 1's file, out of scope
here) rather than the `types` call site. **Net: the fallback to
`uniqueField: 'slug'` is wired correctly and is the only field name that
could ever be reported for a `types` slug conflict (there is exactly one
unique constraint on the table), but it remains unverified by an executed
P2002 test in this slice** — consistent with the design's own acceptance
that this path isn't deterministically testable. Flagging for `sdd-verify`:
if full coverage of the P2002 branch is required, it would need either (a) a
unit test of `translateCatalogWriteError` directly with a synthetic
Prisma-shaped error (that test lives in slice 1's closed file, so out of
reach here) or (b) an accepted gap, documented as such.

### Deviations from design

- **None in behavior/signatures.** `createType`, `updateType`, `deleteType`
  match the pinned signatures in `design.md`'s *Interfaces/Contracts*
  (`createType(input: CreateTypeInput): Promise<TypeRecord>`,
  `updateType(id: number, input: UpdateTypeInput): Promise<TypeRecord>`,
  `deleteType(id: number): Promise<TypeRecord>`). `CreateTypeInput`/
  `UpdateTypeInput` match field-for-field.
- **`icon` treatment corrected mid-implementation.** My first draft wrote
  `icon: input.icon ?? null` unconditionally in `createType`, which is safe
  for a nullable column but contradicts the design's explicit "mismo
  tratamiento para `icon` (nullable, se omite si no llega)" in Decision 5.
  Fixed to the same conditional-spread pattern used for `settings`/`banners`
  before running any tests against it — no behavioral difference observed
  (a nullable column with no `@default` ends up `NULL` either way), but the
  omission form is what the design pins, so kept it literal. Noting this as
  a self-caught deviation-in-drafting, not a shipped one.
- **`translateCatalogWriteError` call sites always pass `uniqueField:
  'slug'`,** including in `updateType`/`deleteType` where a slug-uniqueness
  violation cannot realistically originate (the slug is never written by
  either). The task description's generic template
  (`{aggregate:'types', id, uniqueField:'slug'}`) reads as one shape shared
  across all three writes, so all three pass it uniformly for consistency
  and forward-safety, even though `uniqueField` only matters on the P2002
  branch that only `createType` can trigger. Flagging in case a stricter
  reading expected `uniqueField` omitted for `updateType`/`deleteType`.
- **Line-count overage** (see above) — reported, not silently absorbed.

### Issues found

None. Postgres remained `Up (healthy)` throughout; no `db-up`/`db-reset`/
`docker compose` command was run, per the environment note.

### Remaining tasks

- [ ] 3.x-5.x (Phases 3-5, PR#2 and DoD) — API error mapping, service/DTO
  wiring, end-to-end evidence. Explicitly out of scope for this run.

### Workload / PR boundary

- Mode: stacked-to-main chained PR slice (slice 2 of 3)
- Current work unit: Unit 2 — `types.repository.ts` writes +
  `types.integration.test.ts` sentinel writes + barrel (write exports only)
- Boundary: starts from the PR#1a branch (`slug.ts`/`domain-errors.ts`/barrel
  already merged, no write functions existed) and ends with `just db-build`
  + `just db-check` green, standalone. Rollback: reverting this slice's 3
  files returns `packages/db` to PR#1a's read-only state — `slug.ts`,
  `domain-errors.ts`, and `slug.integration.test.ts` are untouched, so US-27b's
  CA-7 dependency on those files staying closed is preserved.
- Estimated review budget impact: 317 changed lines against the 400-line
  budget and the ~240 forecast for this specific slice — about 32% over the
  sub-slice forecast, still well under the global 400-line guard for a
  single PR, and independently verifiable via `just db-build` + `just
  db-check` per the design's PR#1b definition.
