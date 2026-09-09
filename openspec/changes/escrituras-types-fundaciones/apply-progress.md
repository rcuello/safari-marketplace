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
