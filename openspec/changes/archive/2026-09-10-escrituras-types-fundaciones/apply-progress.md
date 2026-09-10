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

## Slice: PR#2 — Phases 3, 4, 5 (tasks 3.1-5.6) — final slice

**Branch**: `us-27a/pr2-api` (uncommitted — orchestrator owns git ops)
**Mode**: Standard (strict_tdd: false)
**Consumes, does not modify**: `packages/db/src/slug.ts`,
`packages/db/src/domain-errors.ts`, `apps/api/rest/src/common/errors/`
(newly created — closed to future edits per CA-7),
`apps/api/rest/src/types/dto/update-type.dto.ts`,
`apps/api/rest/src/types/entities/type.entity.ts`,
`apps/api/rest/src/types/types.controller.ts`, `apps/api/rest/src/main.ts`
(confirmed unchanged — see `git status`/`git diff --stat` below, none of
them appear as modified).

### Tasks completed

- [x] **3.1** `apps/api/rest/src/common/errors/domain-error.mapper.ts`
  created. `mapDomainError(error)`: guard-narrows with `isCatalogWriteError`
  (imported from `@safari/db`, structural by `code`) and switches on the 5
  `CATALOG_ERROR_CODES` to `BadRequestException` (`EmptySlug`,
  `InvalidReference`), `NotFoundException` (`RecordNotFound`), or
  `ConflictException` (`DependentRows`, `SlugConflict`); returns `null` for
  anything else, letting the chain continue. `isConnectionFailure(error)` —
  **local, unexported, private to this module** (B1 fix): `name ===
  'PrismaClientInitializationError'`, OR `code` in the 6-code
  `CONNECTION_FAILURE_CODES` set (`P1001/P1002/P1008/P1011/P1017/P2024`), OR
  the lowercased `message` contains one of the 4 patterns
  (`can't reach database server`/`connection refused`/`connection
  timeout`/`econnrefused`). **Never checks `name ===
  'PrismaClientKnownRequestError'`** — verified by reading `errors.ts:54-68`
  before writing this function; that is exactly the line this predicate
  deliberately does NOT replicate. `toWriteHttpException(error)` chains:
  `mapDomainError` → `isConnectionFailure` (503,
  `getUserFriendlyMessage(error)` — safe here because the error is already
  confirmed to be a connection failure) → else `InternalServerErrorException`
  with the literal fixed string `'Ocurrió un error inesperado. Por favor,
  contacta al administrador.'` (never calling `getUserFriendlyMessage` in
  this branch, per B1's second-order trap). Did **not** touch
  `packages/db/src/errors.ts`.
- [x] **3.2** `apps/api/rest/src/common/errors/domain-error.mapper.spec.ts`
  created. Covers: each of the 5 `CatalogWriteError` subclasses (constructed
  for real, imported from `@safari/db`, no mocking) through `mapDomainError`
  → correct status (400/400/404/409/409); a non-catalog `Error` →
  `mapDomainError` returns `null`; `toWriteHttpException` with a domain
  error still resolves correctly; `{name:'PrismaClientKnownRequestError',
  code:'P1001', message:"Can't reach database server..."}` → 503;
  `{name:'PrismaClientInitializationError', message:"..."}` → 503; the B1
  regression tripwire — `{name:'PrismaClientKnownRequestError',
  code:'P2011', message:'Null constraint violation...'}` → **characterization
  assert** `expect(isPrismaConnectionError(prismaShapedError)).toBe(true)`
  (the OLD helper from `@safari/db` IS wrong about this object) immediately
  followed by `expect(toWriteHttpException(prismaShapedError)).toBeInstanceOf
  (InternalServerErrorException)` with status 500 and the literal message
  (the NEW mapper does NOT inherit that defect); `new Error('x')` → 500 with
  the same literal message. No `jest.mock`, no `@prisma/client` import — the
  barrel loads for real (`prisma` client stays an unused lazy Proxy, per
  `client.ts:39-45`, so no `DATABASE_URL` is needed for this spec).
- [x] **4.1** `apps/api/rest/src/types/dto/create-type.dto.ts` modified.
  `CreateTypeDto extends PickType(Type, ['name','slug','icon','banners',
  'promotional_sliders','settings','language'])` (precedent
  `create-tag.dto.ts:4-11`) with `name` overridden by `@IsString()
  @IsNotEmpty()` from `class-validator` (already a dependency,
  `package.json:36`, 0.13.2 — first real usage of these decorators in the
  repo, confirmed by grep before writing). Did not touch
  `update-type.dto.ts` (inherits via `PartialType`), `type.entity.ts`, or
  `main.ts`.
- [x] **4.2** `apps/api/rest/src/types/types.service.ts` modified.
  Imports: added `createType`, `deleteType`, `updateType`, `type Prisma`
  from `@safari/db`, and `toWriteHttpException` from the new
  `common/errors/domain-error.mapper`; removed `plainToClass` (from
  `class-transformer`), the `typesJson`/`Fuse` imports, and the module-level
  `types`/`options`/`fuse` constants. Removed `private types: Type[] =
  types;`, and the dead `findAll()`/`findOne(id)` stubs (confirmed unused by
  `types.controller.ts:18-51`, which only calls `create`, `getTypes`,
  `getTypeBySlug`, `update`, `remove`). `create()`: projects
  `createTypeDto` field-by-field into the shape `createType` expects — a
  mandatory `name`, then 4 conditional spreads (`slug`, `icon`, `settings`
  cast `as unknown as Prisma.InputJsonValue`, `banners` cast the same way,
  `language`) that omit the key entirely when the DTO field is `undefined`
  (R-5: never spreads `createTypeDto` itself). `update(id, updateTypeDto)`:
  `Number.isInteger(id)` guard first (`+id` from the controller can be
  `NaN` on a non-numeric `:id` param) → `NotFoundException` before any
  repository call; then the same conditional-spread projection into
  `UpdateTypeInput` (no `slug` field — it isn't part of that type).
  `remove(id)`: same integer guard, then `deleteType(id)`. All three wrap
  their repository call in `catch (error) { throw
  toWriteHttpException(error); }` and return `toTypeDto(record)` — the
  **same** function `getTypes`/`getTypeBySlug` already use, untouched.
  `parseSearch`, `GetTypesDto`, and the `Type` entity import are kept, as
  the design requires.
- [x] **4.3** `apps/api/rest/src/types/types.service.spec.ts` created.
  Harness: `jest.mock('@safari/db', () => ({...jest.requireActual(...),
  createType: jest.fn(), updateType: jest.fn(), deleteType: jest.fn(),
  findTypeBySlug: jest.fn()}))` — exact shape of
  `products.service.spec.ts:36-43`, with `findTypeBySlug` added (beyond the
  task's literal 3-function list) so the CA-1 key-set assertion could call
  `getTypeBySlug` without touching a real Postgres connection; every other
  export (the 5 `CatalogWriteError` classes, `isCatalogWriteError`,
  `getUserFriendlyMessage`, etc.) stays real via `jest.requireActual`.
  Covers: `create` omits `settings`/`banners` from the repository input
  when absent from the DTO and always drops `promotional_sliders` (asserted
  both by `toEqual` on the full call args and by `'key' in calledWith`
  checks); `create` casts `settings`/`banners` through when present;
  `create` forwards an explicit `slug`; `EmptySlugError` → 400 (`create`),
  400 (`update`); `RecordNotFoundError` → 404 (`update`, `remove`);
  `DependentRowsError` → 409 (`remove`); a `{code:'P1001'}`-shaped rejection
  → 503 (`create`); a `{code:'P2011'}`-shaped rejection → 500, not 503,
  reproducing the B1 tripwire at the service layer too (`create`);
  non-integer `id` (`NaN`) → 404 **without calling** `updateType`/
  `deleteType` (asserted via `.not.toHaveBeenCalled()`); a dedicated
  `describe` block builds one shared `TypeRecord` fixture, mocks
  `findTypeBySlug`/`createType`/`updateType`/`deleteType` to all resolve it,
  calls all four methods, and asserts `Object.keys()` of the three write
  results `.toEqual()` (no `.sort()`) the 9-key, ordered array from
  `getTypeBySlug`'s result.
- [x] **4.4** Verified. `packages/db` was not touched by this slice (see
  `git status` above — only `apps/api/rest` files and one new directory are
  dirty), so `just db-build` was **not** re-run (no reason to believe
  `dist` was stale; the environment note also confirms it was already
  rebuilt after slice 2). `cd apps/api/rest && npx jest` → green: **6
  suites / 91 tests** (baseline 4/65 → +2 suites — the two new spec files —
  +26 tests). `just build-api` → clean (`nest build`, `Done in Ns`, no
  errors). `grep -n "fuse\|@db/" apps/api/rest/src/types/types.service.ts`
  → 0 lines (confirmed by exit code 1 / no match). Full output pasted below.

### Files changed (this slice)

| File | Action | Lines (per `git diff --stat`) |
|---|---|---|
| `apps/api/rest/src/common/errors/domain-error.mapper.ts` | Created | 138 |
| `apps/api/rest/src/common/errors/domain-error.mapper.spec.ts` | Created | 159 |
| `apps/api/rest/src/types/dto/create-type.dto.ts` | Modified | +30 / -1 |
| `apps/api/rest/src/types/types.service.ts` | Modified | +85 / -14 |
| `apps/api/rest/src/types/types.service.spec.ts` | Created | 331 |
| `openspec/changes/escrituras-types-fundaciones/tasks.md` | Modified | ticked 3.1-5.6 `[x]` |
| `openspec/changes/escrituras-types-fundaciones/apply-progress.md` | Modified | this section appended |

### `npx jest` — real output

```
$ cd apps/api/rest && npx jest
PASS src/users/user-dto.mapper.spec.ts (17.17 s)
PASS src/shops/shops.service.spec.ts (17.18 s)
PASS src/common/errors/domain-error.mapper.spec.ts (17.898 s)
PASS src/products/products.service.spec.ts (17.947 s)
PASS src/types/types.service.spec.ts (17.989 s)
PASS src/users/users.service.spec.ts (18.105 s)

Test Suites: 6 passed, 6 total
Tests:       91 passed, 91 total
Snapshots:   0 total
Time:        26.442 s, estimated 44 s
Ran all test suites.
```

**Counts**: baseline **4 suites / 65 tests** → **6 suites / 91 tests**
(+2 suites: `domain-error.mapper.spec.ts`, `types.service.spec.ts`; +26
tests: 6 in the mapper spec's error-mapping table + 5 in its
`toWriteHttpException` fallback-chain block, 15 in the service spec across
`create`/`update`/`remove`/the CA-1 key-set block — see the two spec files
for the exact per-`it` breakdown).

### `just build-api` — real output

```
$ just build-api
yarn build
yarn run v1.22.22
$ rimraf dist
$ nest build
(node:53368) [DEP0053] DeprecationWarning: The `util.isObject` API is deprecated. Please use `arg !== null && typeof arg === "object"` instead.
(Use `node --trace-deprecation ...` to show where the warning was created)
Done in 44.25s.
```

### `grep -n "fuse\|@db/" apps/api/rest/src/types/types.service.ts` — real output

```
$ grep -n "fuse\|@db/" apps/api/rest/src/types/types.service.ts
$ echo "exit=$?"
exit=1
```

0 matches (grep's own exit code of 1 confirms "no lines matched" — the
correct outcome for CA-6).

### Actual vs. forecast changed lines

`git diff --stat` for the 4 files this slice may touch (2 created, 2
modified; the 2 spec files were `git add -N`'d only to compute the count,
then unstaged again — nothing committed):

```
 .../src/common/errors/domain-error.mapper.spec.ts  | 159 ++++++++++
 .../rest/src/common/errors/domain-error.mapper.ts  | 138 +++++++++
 apps/api/rest/src/types/dto/create-type.dto.ts     |  31 +-
 apps/api/rest/src/types/types.service.spec.ts      | 331 +++++++++++++++++++++
 apps/api/rest/src/types/types.service.ts           |  99 ++++--
 5 files changed, 733 insertions(+), 25 deletions(-)
```

**758 changed lines (733 insertions + 25 deletions) vs. the ~410 forecast
in `tasks.md`'s Review Workload Forecast — about 85% over.** This is the
largest overage of the three slices (58% for PR#1a, 32% for PR#1b, 85%
here), concentrated in the same pattern the design's own forecast called
out ahead of time (`tasks.md:8`: "el mapper 70 + mapper.spec 85 +
service.spec 145" as the expected drivers) plus: (a) dense Spanish JSDoc
blocks on every exported function tying each decision back to its design.md
citation (B1's fix, the D27-13 closed-file contract, the R-5 no-spread
rule), matching the density precedent in `products.repository.ts`/
`errors.ts`; (b) `types.service.spec.ts` covers more cases than the task's
minimum list (an explicit-slug-forwarding case, a settings/banners-present
case in addition to the omitted case, a dedicated borrowed-`TypeRecord`
fixture block for the CA-1 key-set comparison) because the CA-1 evidence
(9 keys, exact order) needed its own isolated `describe` to avoid coupling
mock state across the `create`/`update`/`remove` suites. No structural
scope was added beyond tasks 3.1-4.3: same 2 exported functions in the
mapper, same 3 service methods, same 1 DTO. This is now the third
consecutive slice to run meaningfully over its sub-forecast while staying
under a sane single-PR ceiling in isolation; flagging for `sdd-verify` and
for whoever plans US-27b's forecast, since the pattern (JSDoc density +
above-minimum test coverage) is now established across all 3 slices of
this change, not a one-off.

### Phase 5 — End-to-end DoD evidence

Orphan process found and killed before starting: a `node.exe` (PID 55108)
was already `LISTENING` on port 9001 before this slice touched anything —
confirmed via `tasklist` and a `curl` that returned old-shape data. Killed
with `taskkill /F /PID 55108` before starting a fresh `just api-dev`, per
the run's explicit warning about an orphan from a prior session.

**Tokens minted by real login** (`POST /api/token`), not fabricated —
demo credentials from `db/seed.sql:47-53` (all three share `demodemo`):

```
$ curl -s -X POST http://localhost:9001/api/token -H "Content-Type: application/json" -d '{"email":"admin@demo.com","password":"demodemo"}'
{"token":"eyJhbGci...","permissions":["super_admin","customer","store_owner"],"role":"super_admin"}
```
(`customer@demo.com` → `permissions:["customer"]`; `store_owner@demo.com` →
`permissions:["customer","store_owner"]` — minted the same way.)

**5.1 — CA-1/CA-2, `POST` → `GET` → restart → `GET` → `PUT` → `GET`, `psql` for `updated_at`:**

```
$ curl -s -X POST http://localhost:9001/api/types -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"name":"Vertical Prueba"}'
{"id":22,"name":"Vertical Prueba","language":"es","translated_languages":["en"],"slug":"vertical-prueba","banners":[],"promotional_sliders":null,"settings":{},"icon":null}

$ curl -s http://localhost:9001/api/types/vertical-prueba
{"id":22,"name":"Vertical Prueba","language":"es","translated_languages":["en"],"slug":"vertical-prueba","banners":[],"promotional_sliders":null,"settings":{},"icon":null}

$ node -e "... compare Object.keys(post) vs Object.keys(get) ..."
POST keys: ["id","name","language","translated_languages","slug","banners","promotional_sliders","settings","icon"]
GET  keys: ["id","name","language","translated_languages","slug","banners","promotional_sliders","settings","icon"]
keys equal (order): true
```

Restart performed for real — killed the `nest start --watch` process
listening on 9001 (`taskkill /F /PID <pid>`, confirmed no listener with
`netstat`), then ran `just api-dev` again and polled until `curl
localhost:9001/api/types` returned 200 (3 tries, ~6s):

```
$ curl -s http://localhost:9001/api/types/vertical-prueba   # AFTER restart
{"id":22,"name":"Vertical Prueba","language":"es","translated_languages":["en"],"slug":"vertical-prueba","banners":[],"promotional_sliders":null,"settings":{},"icon":null}
equal after restart: true
```

`PUT` (rename) + `psql` before/after:

```
$ docker exec safari-postgres psql -U safari -d safari_scraper -c "SELECT id, slug, updated_at FROM types WHERE id=22;"   # BEFORE
 id |      slug       |         updated_at
----+-----------------+----------------------------
 22 | vertical-prueba | 2026-09-09 21:05:37.996+00

$ curl -s -X PUT http://localhost:9001/api/types/22 -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"name":"Vertical Renombrada"}'
{"id":22,"name":"Vertical Renombrada","language":"es","translated_languages":["en"],"slug":"vertical-prueba","banners":[],"promotional_sliders":null,"settings":{},"icon":null}

$ docker exec safari-postgres psql -U safari -d safari_scraper -c "SELECT id, slug, name, updated_at FROM types WHERE id=22;"   # AFTER
 id |      slug       |        name          |         updated_at
----+-----------------+----------------------+----------------------------
 22 | vertical-prueba | Vertical Renombrada  | 2026-09-09 21:06:51.999+00
```

`updated_at` advanced (`21:05:37.996` → `21:06:51.999`); `slug` unchanged;
response still 9 keys, no `updated_at` in the body (contract preserved).

**5.2 — CA-3, `DELETE` with dependents (409) and without (200 → 404):**

```
$ docker exec safari-postgres psql -c "SELECT count(*) FROM products WHERE type_id=9;"   # 44
$ docker exec safari-postgres psql -c "SELECT count(*) FROM categories WHERE type_id=9;" # 10

$ curl -s -X DELETE http://localhost:9001/api/types/9 -H "Authorization: Bearer $ADMIN_TOKEN"
status=409
{"statusCode":409,"message":"No se puede borrar este registro de `types`: tiene filas dependientes (10 categories, 44 products).","error":"Conflict"}

$ docker exec safari-postgres psql -c "SELECT count(*) FROM products WHERE type_id=9;"   # 44 (unchanged)
$ docker exec safari-postgres psql -c "SELECT count(*) FROM categories WHERE type_id=9;" # 10 (unchanged)

$ curl -s -X DELETE http://localhost:9001/api/types/22 -H "Authorization: Bearer $ADMIN_TOKEN"
status=200
{"id":22,"name":"Vertical Renombrada","language":"es","translated_languages":["en"],"slug":"vertical-prueba","banners":[],"promotional_sliders":null,"settings":{},"icon":null}
DELETE keys: ["id","name","language","translated_languages","slug","banners","promotional_sliders","settings","icon"]

$ curl -s -o /dev/null -w "status=%{http_code}\n" http://localhost:9001/api/types/vertical-prueba
status=404
```

**5.3 — CA-4, id inexistente / `name` vacío o `!!!` / colisión de slug:**

```
$ curl -s -X PUT http://localhost:9001/api/types/99999 ... -d '{"name":"x"}'
status=404  {"statusCode":404,"message":"No existe un registro de `types` con id 99999.","error":"Not Found"}

$ curl -s -X DELETE http://localhost:9001/api/types/99999 ...
status=404  {"statusCode":404,"message":"No existe un registro de `types` con id 99999.","error":"Not Found"}

$ curl -s -X POST http://localhost:9001/api/types ... -d '{}'
status=400  {"statusCode":400,"message":["name should not be empty","name must be a string"],"error":"Bad Request"}

$ curl -s -X POST http://localhost:9001/api/types ... -d '{"name":""}'
status=400  {"statusCode":400,"message":["name should not be empty"],"error":"Bad Request"}

$ curl -s -X POST http://localhost:9001/api/types ... -d '{"name":"!!!"}'
status=400  {"statusCode":400,"message":"El texto `!!!` de `types` normaliza a un slug vacío.","error":"Bad Request"}

$ docker exec safari-postgres psql -c "SELECT count(*) FROM types;"   # 10 — none of the above created a row

$ curl -s -X PUT http://localhost:9001/api/types/1 ... -d '{"name":""}'
status=400  {"statusCode":400,"message":["name should not be empty"],"error":"Bad Request"}
$ docker exec safari-postgres psql -c "SELECT id, name, slug FROM types WHERE id=1;"
 1 | Grocery | grocery    -- intact

$ curl -s -X POST http://localhost:9001/api/types ... -d '{"name":"Gadget"}'
status=201  {"id":23,"name":"Gadget","language":"es","translated_languages":["en"],"slug":"gadget-2","banners":[],"promotional_sliders":null,"settings":{},"icon":null}
$ docker exec safari-postgres psql -c "SELECT count(*) FROM types;"   # 11
```

**5.4 — CA-5, matriz de permisos en las 3 rutas de escritura:**

```
POST /api/types:    no token=401  customer=403  store_owner=403
PUT  /api/types/1:  no token=401  customer=403  store_owner=403
DELETE /api/types/1: no token=401 customer=403  store_owner=403
$ docker exec safari-postgres psql -c "SELECT id, name FROM types WHERE id=1;"
 1 | Grocery   -- untouched by any of the 9 rejected attempts
```

**5.5 — `just build-api` + `just verify`:**

`just build-api` output already shown under 4.4. Brought up `just
shop-dev` and `just admin-dev` in background (neither was running — netstat
confirmed) specifically to run `just verify`:

```
$ just verify
OK   API    :9001/api/settings  200  5503B  29ms
OK   Shop   :3003/en  200  190944B  644ms  cards:30
OK   Admin  :3002/en/login  200  72821B  11550ms  cards:1
```

All 3 services green with real content (30 product cards on the shop, 1 on
the admin login page).

**5.6 — Cleanup (by id, no `db-reset`):**

The `PUT`-then-`DELETE` sequence in 5.1/5.2 already removed row 22
(`Vertical Renombrada`) as part of the DoD evidence itself, so only the
CA-4 collision row was left over:

```
$ docker exec safari-postgres psql -c "SELECT id, name, slug FROM types WHERE id > 11 ORDER BY id;"
 23 | Gadget | gadget-2

$ docker exec safari-postgres psql -c "DELETE FROM types WHERE id > 11;"
DELETE 1
$ docker exec safari-postgres psql -c "SELECT count(*) FROM types;"
 10

$ just db-check
 Test Files  9 passed (9)
      Tests  111 passed (111)
```

`toHaveLength(10)` baseline confirmed still green after cleanup.

**Processes started and stopped during this slice** — all confirmed killed
before the run ended: the orphan on 9001 (pre-existing, killed first), then
my own `just api-dev` (started once, killed for the mid-DoD restart,
restarted, killed again at the end), `just shop-dev` (3003), `just
admin-dev` (3002). Final `netstat -ano | grep -E ":9001|:3002|:3003"`
returned no `LISTENING` lines.

### Deviations from design

- **First `POST /api/types` created id 22, not the documented id 12.** The
  environment note's "first row you create gets id 12" assumed the
  sequence was still at 11 (`db-up`'s `setval`). By the time this slice ran,
  the sequence had already advanced past 12 — most likely from earlier
  ad-hoc verification in this same live database across the session
  history (`just db-up`/`db-reset` were never run in this slice, so the
  sequence's prior state came from before this run started). This does not
  affect any assertion: no test or `curl` in this slice's evidence depends
  on a specific numeric id, only on the *count* of rows (10 → 11 → 10) and
  on slugs/names. Flagging as an environment-state deviation, not a code
  deviation.
- **`types.service.spec.ts` mocks `findTypeBySlug` in addition to the
  task's literal `createType`/`updateType`/`deleteType` list.** Needed so
  the CA-1 "Object.keys() of create/update/remove equals getTypeBySlug's"
  assertion could call `getTypeBySlug` without a real Postgres connection.
  This is additive to the harness, not a change to the service under test.
- **`toWriteHttpException`'s 500 branch message is a private literal
  constant (`UNEXPECTED_ERROR_MESSAGE`), not a call to
  `getUserFriendlyMessage`,** exactly as pinned by B1 — noting this
  explicitly because it is the one place in the file that looks like it
  "should" call the shared helper (every other error-mapping file in the
  repo does) and deliberately does not.
- **Line-count overage** (see above) — reported, not silently absorbed.
- **`sdd-verify` reminder (adjacent, not actioned):** the design's own
  Decision 3 flags that the 32 `isPrismaConnectionError` call sites in the
  read paths (`getTypes`/`getTypeBySlug` included, right above the new
  write methods in this very file) share the same over-503 defect that
  `isConnectionFailure` was written to avoid. Not touched — out of scope
  per D-4 and the epic boundary — but now there are two different
  fallback chains living in the same file (`getTypes`/`getTypeBySlug` use
  the old one; `create`/`update`/`remove` use the new one), which a future
  reader could mistake for an inconsistency rather than a deliberate scope
  boundary. Mentioning per the "adjacent improvement, not actioned" rule.

### Issues found

None. Postgres remained `Up (healthy)` throughout; `just db-up`/
`just db-reset`/`docker compose` were never run, per the environment note.
The pre-existing orphan on port 9001 was identified and killed (see Phase 5
notes above) before this slice started its own instance.

### Remaining tasks

None — all of tasks 1.1 through 5.6 are now `[x]` in `tasks.md`.

### Workload / PR boundary

- Mode: stacked-to-main chained PR slice (slice 3 of 3 — final)
- Current work unit: Unit 3 — `common/errors/` + `types.service.ts` +
  `create-type.dto.ts` + `types.service.spec.ts`, plus the full Phase 5
  end-to-end DoD evidence
- Boundary: starts from the PR#1b branch (`createType`/`updateType`/
  `deleteType` already merged in `packages/db`) and ends with `npx jest`
  green (6/91), `just build-api` clean, the CA-6 grep at 0 lines, and the
  complete Phase 5 evidence sequence (including the actual API restart and
  the by-id cleanup). Rollback: reverting this slice's 5 files returns
  `apps/api/rest/src/types` to its stub state (`create`/`update`/`remove`
  return hardcoded/string values) without touching `packages/db` at all —
  the barrel exports from slices 1-2 stay unused but present, so a partial
  rollback of just this slice is safe.
- Estimated review budget impact: 758 changed lines against the 400-line
  budget and the ~410 forecast for this specific slice — the largest
  overage of the three slices (85% over), still delivered as one cohesive,
  independently-mergeable, fully-tested unit per the design's PR#2
  definition. This closes the change: no further slices remain.
