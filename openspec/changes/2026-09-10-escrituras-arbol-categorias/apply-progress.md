# Apply Progress: Escrituras del árbol de categorías (US-28)

## Batch 1 — PR#1 (`packages/db`), branch `us-28-pr1-db-categorias`

**Mode**: Standard (strict_tdd: false)
**Scope**: Phase 1 + Phase 2 of `tasks.md` only. Phases 3-6 (`apps/api/rest`) are
explicitly out of scope for this run (PR#2/PR#3) and were NOT touched.

### Completed Tasks

- [x] 1.1 `packages/db/src/repositories/categories.repository.ts` — added `_id`
      to the `../records` import; added `InvalidReferenceError`/
      `RecordNotFoundError`/`translateCatalogWriteError` from `../domain-errors`;
      added `generateSlug`/`normalizeSlug`/`ExistingSlugLookup` from `../slug`;
      added `CreateCategoryInput`/`UpdateCategoryInput`; added `categorySlugs`
      local `ExistingSlugLookup` lookup (table name never leaks into `slug.ts`).
- [x] 1.2 Added private helpers: `_assertIntegerRef`, `_assertParentEdge`
      (rules 2→3→4, calls `_assertNoAncestorCycle` only when `childId !== null`),
      `_assertNoAncestorCycle` (rules 5/6, `MAX_ANCESTOR_HOPS = 32`, starts at
      `_id(parent.parentId)`), `_assertChildrenShareType` (rule 7), `_loadNode`
      (`_assembleTree(await _loadFlat()).get(id) ?? null`). Every value read
      back from Prisma (`parent.typeId`, `parent.parentId`, `row.parentId`,
      `row.id`) passes through `_id()` before any `===`/assignment against a
      `number` — verified by re-reading the diff line by line.
- [x] 1.3 `createCategory(input)`: `_assertIntegerRef(typeId)` →
      `_assertIntegerRef(parentId)` **before** the `parentId != null` dispatch
      → `_assertParentEdge` if parented → `generateSlug` → `prisma.create` →
      `catch`/`translateCatalogWriteError` → `_loadNode(createdId)` → 404 if
      `null`.
- [x] 1.4 `updateCategory(id, input)`: `normalizeSlug(name)` (discarded, side
      effect only) → `_assertIntegerRef(typeId)` → `_assertIntegerRef(parentId)`
      → `current = findUnique(id)` (404 if null) → `_assertChildrenShareType`
      if `typeId` changes → `effectiveTypeId`/`effectiveParentId` →
      `_assertParentEdge` if parented (the only call site with `childId !== null`)
      → `prisma.update` **without** `updatedAt` (DB trigger owns it) →
      `catch`/`translateCatalogWriteError` → `_loadNode(id)` → 404 if `null`.
- [x] 1.5 `deleteCategory(id)`: `_loadNode(id)` (404 if null; doubles as
      existence check + pre-delete snapshot) → `prisma.delete` →
      `catch`/`translateCatalogWriteError` → returns the pre-delete snapshot
      (declared divergence: `children` reflects pre-delete `parent_id`).
- [x] 1.6 `packages/db/index.ts`: added `CreateCategoryInput`/
      `UpdateCategoryInput` to the `export type` block and `createCategory`/
      `deleteCategory`/`updateCategory` to the `export` block, alphabetical
      order, additive-only (no rebase conflict encountered — US-29/30 have not
      touched this file yet on `main`).
- [x] 2.1 `categories.integration.test.ts`: header updated to reflect
      read+write scope; `SENTINEL_PREFIX = 'zz-categories-'`; `cleanup =
      deleteMany({where:{slug:{startsWith}}})`; `beforeAll` now runs `cleanup()`
      **and** resolves `TYPE_A`/`TYPE_B` (real `daily-needs`/`gadget` type ids,
      resolved by slug, not hardcoded); `cleanup()` folded into the **existing**
      `afterAll` (`try { cleanup() } finally { $disconnect() }`) — no second
      `afterAll` was added. All new `describe`s were appended strictly after
      every pre-existing read `describe`.
- [x] 2.2 Covered `createCategory` (root, child under sentinel parent same
      `type_id`, slug collision → `-2` suffix) and `updateCategory` (rename
      leaves slug unchanged + `updatedAt` monotonic across two successive
      `PUT`s, both DB-trigger/Postgres-clock-sourced — **not** compared
      against `createCategory`'s result, which is Prisma-client/Node-clock
      sourced; see "Issues Found" below for the root-caused cross-clock
      finding that drove this design; never the pinned-`_setNowProvider`
      pattern either way; empty name → `EmptySlugError`, row intact; move to
      a valid sentinel parent of the same type; nonexistent id →
      `RecordNotFoundError`).
- [x] 2.3 Covered the seven 400 rules end-to-end, each against sentinel-owned
      rows: (1) non-integer `type_id`; (1b) non-integer `parent` (the
      `{"parent":"abc"}` trap); (3) nonexistent parent; (4) parent of another
      `type_id`; (2) self-reference; (5/6) cycle A→B→A; (7) `type_id` change on
      a node WITH sentinel children (400) vs. on a sentinel leaf (200).
- [x] 2.4 Covered `deleteCategory` (pre-delete snapshot shows the child's old
      `parent_id`; a follow-up read confirms the DB re-enraized it to `null`)
      and CA-4 (depth-4 chain `raiz→hija→nieta→bisnieta`, 100% sentinel-owned,
      same `type_id`, no seed rows `169`/`170` involved). Closing `it`:
      `prisma.category.count()` === 198.
- [x] 2.5 `just db-build` (blocking) → `just db-check` green, with real
      before/after counts pasted below.

### Files Changed

| File | Action | What Was Done |
|---|---|---|
| `packages/db/src/repositories/categories.repository.ts` | Modified | +3 public write functions (`createCategory`/`updateCategory`/`deleteCategory`), +2 input types, +4 private guards (`_assertIntegerRef`/`_assertParentEdge`/`_assertNoAncestorCycle`/`_assertChildrenShareType`), +`_loadNode`, +`categorySlugs`. Reads (`getCategoryTree`/`listCategories`/`findCategoryByIdOrSlug`) and `_assembleTree`/`_loadFlat` untouched. |
| `packages/db/src/repositories/categories.integration.test.ts` | Modified | Sentinel infra (`SENTINEL_PREFIX`, `cleanup`, `beforeAll`/`afterAll`) + 6 new `describe` blocks (create/update/seven-rules/delete/CA-4/closing-count), 18 new `it`s, all appended after the pre-existing read describes. |
| `packages/db/index.ts` | Modified | Barrel: added the 2 input types + 3 write functions, alphabetical order, additive only. |

### Deviations from Design

- **`updateCategory` monotonicity assertion compares update-vs-update, not
  update-vs-create.** `design.md` DD28-7 prescribes
  `expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime())`
  literally. I ran that exact assertion first, per the design, and it failed
  intermittently (~66% of runs) for a root-caused reason documented in
  "Issues Found": `created.updatedAt` is Prisma-client/Node-clock-sourced
  (standard behavior for `@default(now())` in `prisma/schema.prisma`, not
  something this US introduced), while `updated.updatedAt` is
  Postgres-trigger-clock-sourced (correctly, per DD28-7) — a genuine
  cross-clock comparison that this dev environment demonstrably drifts on
  by hundreds of ms. I changed the assertion to compare two successive
  `updateCategory` results (both same-clock), which is monotonic and stable
  (verified 5/5 clean full-suite runs after the change, vs. failures in 2/3
  before). This preserves CA-2's actual contract ("advances relative to the
  previous value on any successful PUT") without depending on cross-clock
  agreement the design didn't anticipate. Flagged for `sdd-verify`/`design.md`
  to decide whether the underlying `@default(now())` vs.
  `@default(dbgenerated("now()"))` question is worth closing at the schema
  level in a future US.
- **`InvalidReferenceError` `value` argument for rules 5/6.** `design.md`'s
  table lists `value: parentId` for rules 5/6 (cycle, hop-limit), but
  `_assertNoAncestorCycle(id, startFrom)`'s canonical signature (from
  `design.md`'s own "Interfaces / Contracts" section) only carries `id`
  (the node being edited) and `cursor`/`startFrom` — the original `parentId`
  argument is out of scope inside that function without adding a third
  parameter not present in the canonical signature. I used `id` as the
  `value` argument instead. This only affects the embedded value in the
  message text, never the `field` discriminator (which matches the table
  exactly) nor the HTTP status. `design.md` itself declares message texts as
  "observed, not guaranteed" (DD28-3), so this is a documented micro-deviation,
  not a scope violation.
- Everything else matches `design.md` verbatim: guard ordering (integer
  guards before the `parentId != null` dispatch, in both create and update),
  the `_id()` boundary on every BigInt read from Prisma, `_assertParentEdge`
  calling `_assertNoAncestorCycle` only when `childId !== null`, no
  `updatedAt` set by hand, `UpdateCategoryInput` omitting `slug` at the type
  level, and the sentinel test architecture (single folded `afterAll`, no
  second one).

### Issues Found

- **Real, root-caused finding: `created.updatedAt` and a trigger-driven
  `updated.updatedAt` are sourced from two DIFFERENT clocks, and this
  environment demonstrably drifts between them.** Discovered because the
  first version of the "renombrar... updated_at avanza" test (comparing
  `updateCategory`'s result against `createCategory`'s result with
  `toBeGreaterThanOrEqual`, exactly as `design.md` DD28-7 prescribes)
  failed intermittently (~66% failure rate across repeated `just db-check`
  runs). Root-caused with `log: ['query']` + direct clock probes, not
  hand-waved as "flaky CI":
  - `createCategory`'s underlying `prisma.category.create()` generates
    `INSERT INTO categories (..., created_at, updated_at) VALUES (..., $5, $6)`
    — Prisma Client computes `created_at`/`updated_at` **client-side** (Node's
    own clock) for any field declared `@default(now())` in
    `prisma/schema.prisma` (`Category.createdAt`/`Category.updatedAt`,
    `:100-101`), and does NOT defer to the column's SQL-level `DEFAULT now()`
    in `db/schema.sql`. Confirmed empirically: `created.createdAt` always
    falls inside the `[Date.now() before the call, Date.now() after the
    call]` window measured in the SAME Node process.
  - `updateCategory` correctly relies on the `categories_updated_at` DB
    TRIGGER (per DD28-7, no `updatedAt` set by hand) — that value comes from
    Postgres's OWN `now()`.
  - Comparing the two is therefore a cross-clock comparison (Node/host clock
    vs. Postgres/container clock). Directly measured on this machine: a
    Postgres `now()` query issued right after a `create()` call returned a
    value **~300ms behind** the Node-computed `created.createdAt` — genuine
    clock drift, most likely Docker Desktop/Windows virtualization (WSL2/
    Hyper-V), not a logic defect in `categories.repository.ts`.
  - **This is a `design.md` gap, not just an environment quirk to shrug off**:
    DD28-7 implicitly assumed both sides of the monotonicity comparison come
    from "el reloj de Postgres". They don't — `create`'s timestamp is
    Prisma-client-computed (same mechanism `types`/`tags`/`manufacturers`
    already rely on for `createdAt`, pre-existing and out of this US's
    scope), only `update`'s timestamp is DB-trigger-computed. The two clocks
    only need to be desynced by a few hundred ms — plausible in real
    deployments too, not just this dev machine — for CA-2's contract to be
    momentarily violated in appearance (though never in the data itself: the
    trigger DID fire and DID advance `updated_at` relative to Postgres's own
    prior `now()`, it's only the comparison baseline that was wrong).
  - **Fix applied, scoped to the test only** (no repository or schema
    change): the assertion now compares **two successive `updateCategory`
    calls** against each other (both DB-trigger/Postgres-clock-sourced),
    instead of `updateCategory` against `createCategory` (cross-clock).
    Verified monotonic and small (17-24ms) across 5 repeated runs; the full
    suite passed 5/5 clean `just db-check` runs after the fix (previously
    ~66% failure rate). This still verifies CA-2's actual contract ("`updated_at`
    MUST avanzar respecto al valor previo tras cualquier `PUT` exitoso") — it
    just anchors "el valor previo" to a same-clock reading instead of a
    cross-clock one.
  - **Not fixed (deliberately, out of scope for PR#1)**: the underlying
    architectural gap — `prisma/schema.prisma`'s `@default(now())` vs.
    `@default(dbgenerated("now()"))` for `createdAt`/`updatedAt` — is a
    cross-aggregate decision (affects `types`/`tags`/`manufacturers`/`shops`/
    `users` identically) that no task in `tasks.md` authorizes touching, and
    `schema.prisma` is documented as introspection-derived, not
    hand-authored. Flagged here for `sdd-verify`/a future US to decide
    whether it's worth closing at the schema level; it is currently latent
    (not exercised) for every other aggregate because their own
    `updateX`/tests use the SAME client-side clock on both sides via
    `../clock.ts`'s `now()`/`_setNowProvider`.
- The ~475-line PR#1 forecast in `tasks.md`/`proposal.md` was undershot by a
  real diff of **704 changed lines** (+48%). Per `design.md` ("Re-anclaje de
  la estimación... si `sdd-apply` desborda de forma material, el corte a
  levantar es PR#3... PR#1 y PR#2 no son candidatos para este split"), PR#1
  has no authorized escape hatch to split further — a single aggregate with
  no natural seam. Reported as a finding for `sdd-verify`/the epic's
  estimation record, not acted on unilaterally (no code was restructured to
  force a smaller diff).
- `packages/db` lint (biome) reports 27 pre-existing errors, all
  CRLF/line-ending `format` findings unrelated to this change (verified: same
  27-error count on `main` before this branch's commits, via `git stash`).
  One real `organizeImports` issue that this change *did* introduce (import
  order in `categories.repository.ts`) was found and fixed before commit — the
  final count matches the `main` baseline exactly.

### CA-4 empirical result (design.md Open Question, closed here)

**Confirmed: depth 4 is served nested, no 400.** The sentinel chain
`raiz→hija→nieta→bisnieta` (4 levels, 100% sentinel rows, same `type_id`) was
created via `createCategory` without any rejection, and both
`findCategoryByIdOrSlug('zz-categories-raiz4')` (nested descent) and
`listCategories({rootsOnly:false})` (nested `parent.parent.parent.id`) show
the bisnieta 3/4 levels deep as predicted by `D28-7`/`getCategoryTree`'s
uncapped `_assembleTree`. `getCategoryTree` was NOT modified (out of scope,
ratified).

### Remaining Tasks (explicitly out of scope for this run)

- [ ] Phase 3: DTO fix + service migration (`apps/api/rest`, PR#2)
- [ ] Phase 4: PR#2 evidence + DoD
- [ ] Phase 5: `categories.service.spec.ts` (PR#3)
- [ ] Phase 6: PR#3 verification + close

### Workload / PR Boundary

- Mode: chained PR slice (stacked-to-main, session-cached)
- Current work unit: Unit 1 — `packages/db`: 3 write functions + 7 validation
  guards + barrel + integration tests (PR#1)
- Boundary: starts from a clean `packages/db` (no write functions) and ends
  with `createCategory`/`updateCategory`/`deleteCategory` fully implemented,
  barrel-exported, and covered by a green `just db-check`. `apps/api/rest` is
  untouched — the API service still calls the old in-memory stub, so the
  admin panel is NOT releasable at the end of this PR alone (releasable only
  after PR#2, per `tasks.md`'s Suggested Work Units table).
- Estimated review budget impact: 704 changed lines (`git diff --stat` vs
  `main`) against a ~475-line forecast (+48%). Exceeds the 400-line budget
  guard on its own, as `tasks.md`'s Review Workload Forecast already flagged
  (`400-line budget risk: High`) and pre-authorized via the chained-PR
  delivery strategy already resolved by the user at session start.

### Status

11/26 tasks complete (Phases 1-2 of 6). Ready for PR#2 (`apps/api/rest`
service migration + DTO fix), a separate `sdd-apply` batch on top of this
branch per `stacked-to-main`.

---

## Evidence (real command output, pasted verbatim)

### `just db-build` (blocking prerequisite, `packages/db/dist` is gitignored)

```
$ just db-build
...
✔ Generated Prisma Client (7.10.0) to .\generated\prisma\client in 229ms
CLI Building entry: index.ts
CLI Using tsconfig: tsconfig.json
CJS Build start
CJS dist\index.js     151.65 KB
CJS dist\index.js.map 360.57 KB
CJS ⚡️ Build success in 90ms
DTS Build start
DTS ⚡️ Build success in 9175ms
DTS dist\index.d.ts 1.39 MB
```

### `just db-check` — BEFORE this batch (baseline, captured before any write code was added)

```
$ just db-check
npm run typecheck
> tsc --noEmit
npm test
> vitest run
 Test Files  10 passed (10)
      Tests  142 passed (142)
   Duration  7.79s
```

### `just db-check` — AFTER this batch

```
$ just db-check
npm run typecheck
> tsc --noEmit
npm test
> vitest run
 Test Files  10 passed (10)
      Tests  160 passed (160)
   Duration  9.20s
```

**Delta**: +18 tests, same 10 files (no new file — the write coverage was
added to the existing `categories.integration.test.ts`, per `tasks.md` 2.1).
All pre-existing seed-count assertions stayed green in both runs:
`toBe(198)` (`:29,:77`), `toBe(83)` (`:24`), `toBe(53)` (`:40`), `toBe(10)`
(`:103,:110`).

**Stability check after the update-vs-update fix (see "Issues Found"
above)**: `just db-check` run **5 times in a row**, all green:

```
=== run 1 ===  Test Files  10 passed (10)   Tests  160 passed (160)
=== run 2 ===  Test Files  10 passed (10)   Tests  160 passed (160)
=== run 3 ===  Test Files  10 passed (10)   Tests  160 passed (160)
=== run 4 ===  Test Files  10 passed (10)   Tests  160 passed (160)
=== run 5 ===  Test Files  10 passed (10)   Tests  160 passed (160)
```

Before this fix, the same 5-run loop with the design's literal
create-vs-update assertion failed 2 out of 3 times
(`AssertionError: expected <update.updatedAt> to be greater than or equal to
<create.updatedAt>`, magnitude ranging from -114ms to -543ms across
different runs — consistent with real, variable clock drift, not a
one-off).

### `npm run typecheck` (packages/db)

```
$ cd packages/db && npm run typecheck
> @safari/db@0.1.0 typecheck
> tsc --noEmit
```
(no output = clean, exit 0)

### `npm run lint` (packages/db) — before vs. after this batch

```
# On main (git stash applied, before this change):
Checked 33 files in 111ms.
Found 27 errors.
Found 1 info.

# After this change (git stash pop):
Checked 33 files in 41ms.
Found 27 errors.
Found 1 info.
```

Same 27 errors, all pre-existing CRLF `format` findings across unrelated
files (`slug.ts`, `types.repository.ts`, `tags.repository.ts`,
`manufacturers.repository.ts`, several `*.integration.test.ts`), a
repo-wide `core.autocrlf=true` artifact, not introduced by this change. One
real `organizeImports` finding that this change *did* introduce (import
order in `categories.repository.ts`) was caught and fixed before this final
run — confirmed by the matching before/after counts.

### The seven 400 rules — exercised at the repository level (via `just db-check`, `describe('Las siete reglas...')`)

All seven pass as part of the 160-test green run above. Rule-by-rule,
`InvalidReferenceError` instances thrown and asserted:

1. `type_id: NaN` (`Number('abc')`) on `createCategory` → `InvalidReferenceError` ✓
2. `parent: NaN` (`Number('abc')`) on `createCategory` → `InvalidReferenceError`, **without** reaching `BigInt(NaN)` (this is the rule-1/parent trap the `GATE: FAIL` correction round added) ✓
3. Nonexistent `parent: 999999` on `createCategory` → `InvalidReferenceError` ✓
4. `parent` of another `type_id` (`gadget` parent under a `daily-needs` create) → `InvalidReferenceError` ✓
5. Self-reference (`parent === id`) on `updateCategory` → `InvalidReferenceError`, row stays `parentId: null` ✓
6. Cycle A→B→A (`updateCategory(a, {parentId: b})` where `b`'s parent is `a`) → `InvalidReferenceError`, row stays `parentId: null` — **this is the one test that would go green-on-200 if `_id()` were missing from the cycle guard**, confirmed red-to-green by design ✓
7. `type_id` change on a sentinel node WITH children → `InvalidReferenceError`; the identical change on a sentinel leaf → 200 with the new `type_id` persisted ✓

None of the seven produced an uncaught exception or a status outside the
closed 5-code set — all resolve to `InvalidReferenceError` (400 at the HTTP
layer, once PR#2 wires the service — not exercised via HTTP in this PR,
`apps/api/rest` untouched).

### CA-4 — depth-4 sentinel chain, empirical confirmation

Part of the 160-test green run (`describe('CA-4 — profundidad 4...')`).
`createCategory` accepted all four levels without rejection;
`findCategoryByIdOrSlug('zz-categories-raiz4')` returned the bisnieta nested
3 levels under the raíz's `children`; `listCategories({rootsOnly:false})`
returned the bisnieta flat record with `parent.parent.parent.id` equal to
the raíz's id. **Depth 4 works — `D28-7` confirmed, `getCategoryTree`
untouched.**

### `psql` — categories back to 198/83 after the suite, sentinel cleanup verified

```
$ docker exec safari-postgres psql -U safari -d safari_scraper -t -c "SELECT count(*) FROM categories;"
   198

$ docker exec safari-postgres psql -U safari -d safari_scraper -t -c "SELECT count(*) FROM categories WHERE parent_id IS NULL;"
    83

$ docker exec safari-postgres psql -U safari -d safari_scraper -t -c "SELECT count(*) FROM categories WHERE slug LIKE 'zz-categories-%';"
     0
```

### `git diff --stat` against `main` (scope of this PR)

```
$ git diff --stat main -- packages/db
 packages/db/index.ts                                              |   5 +
 packages/db/src/repositories/categories.integration.test.ts       | 399 ++++++++++++++++++++-
 packages/db/src/repositories/categories.repository.ts             | 304 ++++++++++++++++
 3 files changed, 704 insertions(+), 4 deletions(-)
```

704 changed lines vs. the ~475-line PR#1 forecast in `tasks.md` (+48%). No
scope was cut to force a smaller number; see "Issues Found" above.
