# Exploration: US-28 — Escrituras del árbol de categorías

## 0. Scope reminder (binding, per "NO incluye")

Do NOT plan: `type`/`parent` as nested DTO objects beyond correcting the
declaration; moving products between categories; a real `products_count`
(stays `0`); changes to `getCategoryTree` unless CA-4 forces it (it does
not — see §3); any frontend change.

## 1. Line-reference audit — code wins over the document

| US citation | Verified against | Result |
|---|---|---|
| `categories.service.ts:185-187` (`create`) | Read file | **Accurate.** `create(createCategoryDto) { return this.categories[0]; }` at 185-187. |
| `categories.service.ts:244-246` (`update`) | Read file | **Accurate.** Matches exactly. |
| `categories.service.ts:248-250` (`remove`) | Read file | **Accurate.** Matches exactly. |
| `categories.service.ts:24-34` (Fuse/JSON block) | Read file | **Accurate.** `import Fuse…` (24) through `const fuse = new Fuse(...)` (34). |
| `categories.service.ts:160-179` (`toCategoryDto`) | Read file | **Accurate.** Function spans exactly 160-179. |
| `categories.service.ts:44-50` (`parseCategorySearch`) | Read file | **Accurate.** Function spans exactly 44-50. |
| `categories.repository.ts:181` (`getCategoryTree`) | `grep -n` | **Drifted.** Actual line is **191** (+10). |
| `categories.repository.ts:195` (`listCategories`) | `grep -n` | **Drifted.** Actual line is **205** (+10). |
| `categories.repository.ts:226` (`findCategoryByIdOrSlug`) | `grep -n` | **Drifted.** Actual line is **236** (+10). |
| `db/schema.sql:261-275` (`categories` table DDL) | `grep -n` | **Accurate.** `CREATE TABLE` at 261, CHECK constraint at 274, closing paren 275. |
| `db/schema.sql:258-259` (SET NULL / CHECK comment) | `grep -n` | **Off by one.** Actual lines are **257-258** (the "ON DELETE SET NULL…" / "El CHECK de abajo prohíbe…" pair). |
| `db/schema.sql:425-429` (`category_product`) | `grep -n` | **Accurate.** `CREATE TABLE IF NOT EXISTS category_product` at 425, closing at 428/429. |
| `category-form.tsx:222-235` (payload build) | Read file | **Approximately accurate, off by one at the edges.** `const input = {` actually starts at line **223** (222 is the `onSubmit` signature); the object literal closes at line **236**, not 235. |
| `category-form.tsx:236-239` (slug reuse decision) | Read file | **Drifted (~4 lines).** Line 236 is just `};` (end of the input object). The actual create/update branch is `if (!initialValues || !initialValues.translated_languages.includes(router.locale!)) {` spanning **237-240**; the slug-reuse spread (`...(initialValues?.slug && { slug: initialValues.slug })`) is at line **243**, inside the `createCategory({...})` call (241-244), not at 239 as the "Contexto" bullet claims. |
| `create-category.dto.ts:4-12` | Read file | **Accurate.** `export class CreateCategoryDto extends PickType(Category, [...]) {}` spans exactly 4-12. |
| `categories.controller.ts:22-54` (ADMIN_ONLY on the 3 writes) | Read file | **Accurate.** Comment+`create` decorator at 22-27, `update` decorator block ends at 48, `remove` decorator+method ends at 54 (class closes at 55). |
| `categories.integration.test.ts:29,77,103,110` (`198`/`10` asserts) | Read file | **All four accurate.** Line 29 `expect(total).toBe(198)`; line 77 `expect(visited.size).toBe(198)`; line 103 `expect(rootsOnly.total).toBe(10)`; line 110 `expect(flat.total).toBe(10)`. |

**Root cause of the repository drift**: commit `cc5d72e` ("Cierra las
incidencias que US-27b dejó arrastradas") inserted a 10-line TOCTOU comment
at `categories.repository.ts:96-105` (about `row.type === null` rows being
discarded from `_assembleTree`) after US-28's line references were written.
The offset is a clean +10 for all three functions — not random drift, a
single insertion. **Action for later phases: cite line numbers freshly at
apply time; do not trust `:181/:195/:226` from the US doc.**

## 2. What US-27a / US-27b actually built (must be reused, not re-invented)

Read: `packages/db/src/slug.ts`, `packages/db/src/domain-errors.ts`,
`packages/db/src/repositories/types.repository.ts`,
`packages/db/src/repositories/tags.repository.ts`,
`packages/db/src/repositories/manufacturers.repository.ts`,
`apps/api/rest/src/common/errors/domain-error.mapper.ts`,
`apps/api/rest/src/types/types.service.ts`,
`apps/api/rest/src/types/types.service.spec.ts`.

### Slug helper (`packages/db/src/slug.ts`)
- `normalizeSlug(text, aggregate)`: delegates to `SELECT slugify($1)` in
  Postgres (parametrized, never `$queryRawUnsafe`); throws `EmptySlugError`
  for blank/whitespace-only input or a result that normalizes to `''`.
- `generateSlug(source: {name, slug?}, findExistingWithPrefix, aggregate)`:
  explicit `slug` wins over `name`; resolves collisions with an in-memory
  numeric suffix search (`-2`, `-3`, …) bounded by `taken.size + 2` — never
  a query-per-attempt loop.
- The `ExistingSlugLookup` callback is built **per aggregate, inside its own
  repository** (e.g. `typeSlugs`, `tagSlugs`) — the table name never reaches
  shared code. **US-28 must add its own `categorySlugs: ExistingSlugLookup`
  in `categories.repository.ts`, not touch `slug.ts`.**

### Domain-error → HTTP mapping (closed set of 5 codes)
- `packages/db/src/domain-errors.ts` exports `EmptySlugError`,
  `InvalidReferenceError`, `RecordNotFoundError`, `DependentRowsError`,
  `SlugConflictError`, all extending `CatalogWriteError` (has `.code`,
  `.aggregate`), plus `translateCatalogWriteError(error, {aggregate, id?,
  uniqueField?})` which turns Prisma `P2002`→`SlugConflictError`,
  `P2003`→`InvalidReferenceError`, `P2025`→`RecordNotFoundError`. Anything
  else passes through unchanged (caller decides).
- `apps/api/rest/src/common/errors/domain-error.mapper.ts` exports
  `toWriteHttpException(error)`, the **single** place that turns those 5
  codes into `BadRequestException` (400, `EmptySlug`/`InvalidReference`),
  `NotFoundException` (404, `RecordNotFound`), `ConflictException` (409,
  `DependentRows`/`SlugConflict`), then falls back to a connection-failure
  check (503) and finally a literal 500 message. **US-28's service methods
  must end each write's `catch` with exactly `throw
  toWriteHttpException(error);` — no new branches, per CA-7 of
  `catalog-write-foundations`.**

### Repository write pattern (types/tags/manufacturers)
Common shape across all three (`types.repository.ts:83-182`,
`tags.repository.ts:121-213`, `manufacturers.repository.ts`):
1. `create*`: pre-validate cheap domain rules that Postgres cannot express
   (e.g. `tags.repository.ts:114-118 _assertValidTypeId` — integer shape
   only; existence is left to Postgres via P2003), call `generateSlug(...)`,
   then `prisma.<table>.create({data:{...}})` inside `try/catch` ending in
   `throw translateCatalogWriteError(error, {aggregate, uniqueField})`.
2. `update*`: slug is **never** touched (`UpdateXInput` omits `slug`
   entirely at the type level); if `name` is present, call
   `normalizeSlug(name, aggregate)` and discard the result — only for its
   `EmptySlugError` side effect (`types.repository.ts:110-125`); explicit
   `updatedAt: now()` for tables without a DB trigger (`types`, `tags`,
   `manufacturers` — **`categories` DOES have a trigger**, `db/schema.sql`
   comment at the `categories`/`products`/`shops`/`users`/`profiles` list —
   so `updateCategory` should **not** set `updatedAt` manually, unlike its
   three siblings).
3. `delete*`: `find-then-delete` (`prisma.<table>.findUnique` first, throw
   `RecordNotFoundError` if absent, snapshot the pre-delete row to return
   it), then either count+guard dependents first (`deleteType`, R-1 — 409
   `DependentRowsError`) or just delete (`deleteTag`/`deleteManufacturer`,
   relying on `ON DELETE CASCADE`/`SET NULL` to clean pivots/FKs). For
   `categories`, the epic's decision 7 already settled this: delete is
   **permitted**, children re-root via `parent_id … ON DELETE SET NULL`
   (`db/schema.sql:268`), no dependent-count guard needed — this matches
   the `tags`/`manufacturers` "just delete" shape, not `types`'s guarded
   shape.
4. All inputs are typed and built field-by-field with conditional spreads
   (`...(input.x !== undefined && {x: input.x})`) — **never** a body
   spread into Prisma (R-5 of the epic).

### Service pattern (`types.service.ts` as exemplar)
- `create`/`update`/`remove` each wrap the repository call in
  `try { … } catch (error) { throw toWriteHttpException(error); }`.
- `update`/`remove` guard `if (!Number.isInteger(id)) throw new
  NotFoundException(...)` **before** calling the repository (id `NaN` from
  a non-numeric `:id` param must not reach Prisma as `BigInt(NaN)`).
- DTOs are projected field-by-field into the repository's `CreateXInput`/
  `UpdateXInput`, never spread wholesale (mirrors R-5 at the service layer
  too).
- Reads (`getTypes`/`getTypeBySlug`) keep their OLD inline
  `isPrismaConnectionError`/`getUserFriendlyMessage` pattern — **not**
  migrated to `toWriteHttpException` (D-4 of the epic: reads are out of
  scope, only writes get the new mapper).

### Jest spec pattern (`types.service.spec.ts` as exemplar for US-28's new `categories.service.spec.ts`)
- `jest.mock('@safari/db', () => ({ ...jest.requireActual(...), createX:
  jest.fn(), updateX: jest.fn(), deleteX: jest.fn(), findXBySlug: jest.fn()
  }))` — keeps the 5 real domain-error classes and `toWriteHttpException`
  real; mocks only data access.
- Builds a `makeXRecord(overrides)` factory for a canonical record.
- Table of scenarios per method: success/projection, `id` NaN → 404 without
  calling the repo, each relevant domain error → its HTTP status, a raw
  Prisma connection error (`{code:'P1001'}`) → 503, an unclassified Prisma
  error (`{code:'P2011'}`) → 500 (never mistaken for a connection error —
  this is exactly the B1 regression the shared mapper was built to avoid).
- A final "contract" describe compares `Object.keys()` of create/update/
  remove results against the read projection, **in order**, never sorted.
  For categories this is the 16-key `toCategoryDto` shape.
- `/// <reference types="jest" />` header is required per-file (API
  `tsconfig.json` doesn't include jest globals).

## 3. CA-4 answered from the code — depth is NOT limited, no `getCategoryTree` change needed

`packages/db/src/repositories/categories.repository.ts:91-171`
(`_assembleTree`) is the single place that turns a **flat** `findMany()`
result (one query, `include: { type: true }`, no nested `include`) into the
tree. The mechanism:

- `descend(id, path)` (lines 122-142) recursively builds
  `children: (kids.get(id) ?? []).map((k) => descend(k, next))` with **no
  depth counter and no hardcoded level limit** — it stops only when
  `kids.get(id)` is empty (no more children in the loaded row set) or when
  a `path` cycle is detected (returns a truncated node instead of looping
  forever; this is a **correctness guard for corrupt data**, not a
  business-rule depth cap).
- `ascend(id, path)` (lines 144-158) is the mirror for the upward `parent`
  chain, same shape, same cycle guard.
- Both are memoized (`down`/`up` Maps) so the whole assembly is O(n) even
  though it is recursive per node.
- The header comment (lines 1-15) is explicit about *why* it was rewritten
  this way: an earlier version used `include: { children: { include:
  {...} } }` — a **fixed-depth join** — which silently dropped the seed's 6
  grandchildren (level-3 rows) because it only requested one level of
  `children`. `_assembleTree` was introduced specifically to remove that
  ceiling.
- `getCategoryTree`/`listCategories`/`findCategoryByIdOrSlug` (lines
  191-249) all call `_loadFlat()` + `_assembleTree()` — none of them slices
  by level.
- Service mappers (`categories.service.ts`) also recurse without a depth
  cap: `toDescendantDto` (130-149) calls
  `descendant.children.map(toDescendantDto)`; `toAncestorDto` (75-92) calls
  itself on `ancestor.parent`. Neither has a level parameter.

**Conclusion**: a level-4 category (child of one of the seed's 6
grandchildren, e.g. a new child of id `169`/`brown-eggs`) is architecturally
served correctly with **zero changes** to `getCategoryTree`,
`listCategories`, `findCategoryByIdOrSlug`, or the service's `toCategoryDto`
family. This is also what `openspec/specs/category-tree-api/spec.md`
("Árbol reconstruido a profundidad arbitraria (D-1)") already asserts and
what `categories.integration.test.ts:58-79` already exercises implicitly
(it asserts `maxDepth === 2` today only because that's the seed's real
depth, not because of a code-level cap).

This is a **static-analysis conclusion**, not an executed one — no
Postgres was queried in this exploration. **The implementation phase MUST
add an integration test that actually creates a category with `parent:
169` (or another real grandchild) and asserts it is served nested at
level 4** (per the US's own DoD line: "Evidencia de CA-4 (nivel 4 servido,
o 400 declarado) pegada"). Based on the mechanism above, the expected
empirical outcome is "level 4 works, no 400" — but CA-4 explicitly demands
this be *verified*, not *assumed*, so treat this section as a strong
prediction to confirm in `sdd-apply`/`sdd-verify`, not as closing the
criterion.

## 4. The cycle-guard problem

### What must be validated, and why none of it can be delegated to the DDL
- **Parent exists** — *could* be delegated to Postgres: `parent_id bigint
  REFERENCES categories(id)` will raise `P2003` on insert/update if the
  referenced row is absent, which `translateCatalogWriteError` already
  turns into `InvalidReferenceError` → 400, with **zero new code**. But see
  the type-match point below — if the repository needs to fetch the parent
  row anyway to check `type_id`, it may as well throw an explicit
  `InvalidReferenceError` itself rather than rely on the P2003 round-trip
  through Postgres, for a single consistent code path.
- **Same `type_id` as the parent** — **cannot** be delegated to the DDL
  (there is no CHECK or trigger for this in `db/schema.sql`; it is a pure
  application rule, explicitly called out in the epic as "regla de negocio,
  no del DDL", and in the US's own notes:
  `categories.service.ts:44-50`/`parseCategorySearch` is why — the shop
  filters the tree by `type.slug`, so a mismatched child would be invisible
  or misfiled). This MUST be pre-validated in the repository by fetching
  the parent row's `typeId` before the write.
- **No self-reference (`parent = id`)** — the DDL DOES have
  `categories_no_autoreferencia CHECK (parent_id IS DISTINCT FROM id)`
  (`db/schema.sql:274`), but **relying on Postgres to reject it is risky**:
  `translateCatalogWriteError` only recognizes Prisma codes `P2002`/`P2003`/
  `P2025`. A CHECK-constraint violation from Postgres does not map to any
  of those — it would flow through `translateCatalogWriteError` unchanged
  (the function returns the original `error` for any unrecognized `code`)
  and, from there, `toWriteHttpException`'s fallback chain (`mapDomainError`
  → connection check → literal 500) would turn it into an **HTTP 500**,
  violating decision 6 of the epic ("Nunca 500"). **This must be
  pre-validated in application code, not left to the CHECK.** This is only
  reachable on `updateCategory` (an `id` doesn't exist yet on create, so
  self-reference can't happen there).
- **No cycle (`parent` is a descendant of the category being updated)** —
  the schema comment at `db/schema.sql:257-258` says this explicitly: "El
  CHECK de abajo prohíbe la autorreferencia, pero NO un ciclo A→B→A: quien
  recorra el árbol necesita su propia guarda." Postgres has no mechanism
  for this at all. Must be a pure application-level ascending walk.

### House idiom for tree walks in this repository
The **read side** already has exactly this shape:
`_assembleTree`'s `ascend(id, path)` (categories.repository.ts:144-158)
walks a **pre-loaded, single-query** `Map<number, CategoryRecord>` upward,
using a `Set<number>` of visited ids to short-circuit a cycle instead of
recursing forever. This is the closest existing precedent for "walk
upward safely" in this codebase — but it operates on an already-loaded
flat snapshot (`_loadFlat()`, one `findMany()` for the whole table), not on
a targeted per-node round trip.

There is **no existing precedent for a targeted (non-full-table) ascending
walk** anywhere in `packages/db`. The write-side guard for
`createCategory`/`updateCategory` will be new code either way. Two shapes
are viable:

| Approach | Shape | Pros | Cons |
|---|---|---|---|
| **A. Iterative round-trips, capped** | Loop: `let cur = parentId; for (let hops = 0; hops < 32; hops++) { if (cur === id) throw cycle; const row = await prisma.category.findUnique({where:{id:cur}, select:{id:true, parentId:true}}); if(!row) break; cur = row.parentId; }` | Matches the US's own guidance verbatim ("recorrido ascendente… tope defensivo… 32 saltos"); trivial to read/test in isolation; real depth is 2 hops so it's 1-3 queries in practice, not 32; doesn't touch/duplicate the 198-row tree-read path. | N (small, capped) sequential round trips instead of one; no existing helper to reuse, so it's genuinely new code. |
| **B. Single flat query + in-memory walk** | Reuse the shape of `_loadFlat()` (or a lighter `findMany({select:{id,parentId}})` over the whole `categories` table) once, then walk the resulting `Map` in memory exactly like `ascend()` does. | One DB round trip; mirrors the existing `_assembleTree`/`ascend` idiom byte-for-byte; consistent with `category-tree-api`'s D-1 ("MUST bring N rows with a single findMany(), assemble in memory"). | Fetches all ~198 rows (cheap at this scale, but is over-fetching for a single boolean check) and doesn't reuse `_assembleTree` directly (it returns the wrong shape — `CategoryTreeNode`, not a raw parent-id map — so it would still be new code, just shaped differently). |

**Recommendation**: **Approach A** (iterative, capped round-trips). Rationale:
1. It is literally what the US's own "Notas para el agente ejecutor" section
   prescribes, and matches the verified real-world shallowness (2 hops)
   documented in `categories.repository.ts:1-14` and
   `db/schema.sql:249-258` — so the "cost" argument for Approach B
   (avoiding N round trips) does not apply here; N is at most 2-3 in
   practice, capped at 32 defensively.
2. It keeps the validation self-contained in the write path without
   depending on (or diverging from) the read-side's `_assembleTree`
   internals, which are `_`-prefixed (private) and not meant to be a
   public building block for validation.
3. It is trivially unit-testable with a mocked `prisma.category.findUnique`
   sequence, matching the jest-mock style already used for
   `types.service.spec.ts`.

This is a design-level decision, not a foregone conclusion — `sdd-design`
should ratify or override it explicitly (Approach B is not wrong, just a
worse fit for this codebase's stated real depth). Prisma's client (not raw
SQL) is unambiguously the house style for this: the only `$queryRaw` in the
whole package is `slug.ts`'s parametrized `SELECT slugify($1)`, justified
explicitly as "Postgres is already the source of truth for that one rule";
there is no precedent anywhere for a recursive CTE in application code, and
introducing one here would be inconsistent with `category-tree-api`'s own
D-1 decision to explicitly avoid recursive/nested query shapes in favor of
flat queries + in-memory assembly.

## 5. Test baseline

### `categories.integration.test.ts` today
- **Fully read-only**: header comment (lines 1-6) states this explicitly
  ("Solo lectura: no escribe ninguna fila, así que no necesita `afterAll`
  de limpieza"). Only cleanup today is `prisma.$disconnect()` in `afterAll`
  (line 17-19).
- Counts asserted: `198` at lines **29** and **77**; `10` at lines **103**
  and **110** (all four verified accurate against the current file, see
  §1). Also `83` (line 24, root count) and `53` (line 40, `daily-needs`
  vertical count) are asserted elsewhere in the file, though not cited by
  the US.
- **No sentinel-prefix pattern exists yet in this file** — it has never
  needed one. US-28 must introduce one to add write tests without breaking
  every existing count assertion.

### Sentinel/cleanup convention used by sibling US-27a/27b (`types.integration.test.ts`, confirmed pattern)
- A per-file sentinel prefix (`zz-types-` for types; by extension `zz-tags-`
  /`zz-manufacturers-` for the siblings) distinct across files so parallel
  US work doesn't collide (explicit comment: "distinto por archivo para que
  US-27b/28/29/30 no se pisen en paralelo").
- `cleanup()` is a `prisma.<table>.deleteMany({where:{slug:{startsWith:
  SENTINEL_PREFIX}}})`.
- `beforeAll(cleanup)` — guards against a previously aborted run leaving
  garbage.
- Cleanup is **folded into the existing `afterAll`** (not a second
  `afterAll`) — explicit comment warns that vitest's default
  `sequence.hooks: 'stack'` would run a second, separately-registered
  `afterAll` LIFO, against an already-disconnected client.
- Every `it` that creates a row deletes it itself when practical (decision
  13 of the epic: "cada test borra lo que crea"), on top of the blanket
  `afterAll` safety net.

**For `categories.integration.test.ts`, the natural sentinel is
`zz-categories-`.** Because this file's existing describes assert exact
counts (`198`, `83`, `10`, `53`) and vitest runs `describe` blocks in file
order by default, **new write-test describes must be appended after the
existing read-only describes**, and each write test must clean up its own
rows before the file ends (matching decision 13) so the counts stay valid
for any test that might re-run reads afterward and so the final `psql`
count in the DoD (`SELECT count(*) FROM categories` → 198) holds. The
depth-4 test in particular needs to attach a temporary sentinel category
under a **real, existing** grandchild (id `169` or `170`, both under
`163`/`daily-needs`) and must delete it in the same test (or in a scoped
`afterEach`) — it must NOT delete `169`/`170`/`163`/`124` themselves, since
those are seed data other tests depend on.

### Jest side (`apps/api/rest`)
- 8 spec files exist today, not the "4 suites / 65 tests" that
  `CLAUDE.md`'s testing section describes — that count predates US-27a/
  US-27b (both landed 2026-09-10, per `openspec/changes/archive/`). Current
  suites: `users.service.spec.ts`, `products.service.spec.ts`,
  `user-dto.mapper.spec.ts`, `shops.service.spec.ts`,
  `tags.service.spec.ts`, `manufacturers.service.spec.ts`,
  `types.service.spec.ts`, `domain-error.mapper.spec.ts`. **This is a
  documentation-drift risk to flag, not something this change should fix**
  (out of scope for US-28; belongs to whoever next touches `CLAUDE.md`'s
  testing section — the DoD's "`npx jest` verde con recuentos" line should
  report the *actual* current count, not silently repeat the stale "4/65").
- Best exemplar for the new `categories.service.spec.ts`: `types.service.
  spec.ts` (see §2) — closer to categories than `tags`/`manufacturers`
  because `types` also needs an `id`-NaN guard test shape reusable
  verbatim, and because `manufacturers`/`tags` don't have the
  parent/ancestor/descendant DTO complexity that `categories` has. The
  16-key contract test (`toCategoryDto`) should follow the same
  "`Object.keys()` in order, never sorted" style as `types.service.
  spec.ts:306-330`'s 9-key contract test.

## 6. Risks and unknowns

1. **CHECK-constraint violations are NOT in `translateCatalogWriteError`'s
   closed set.** Confirmed by reading `domain-errors.ts` in full: only
   `P2002`/`P2003`/`P2025` are handled. If `updateCategory` relies on
   Postgres to reject `parent_id = id` via the `categories_no_autoreferencia`
   CHECK instead of pre-validating it in code, the resulting error will not
   be recognized and will surface as an **HTTP 500**, breaking decision 6
   of the epic ("Nunca 500") and CA-2's own requirement of a declared 400.
   This is the single highest-risk implementation detail found in this
   exploration — self-reference and cycle MUST be pre-validated in
   application code, never left to the DDL.
2. **`updated_at` trigger already exists for `categories`** (unlike
   `types`/`tags`/`manufacturers`) — `db/schema.sql`'s trigger block covers
   `products`, `categories`, `shops`, `users`, `profiles`. If
   `updateCategory` copies the `updatedAt: now()` line verbatim from
   `updateType`/`updateTag`, it will still work (an explicit value simply
   overrides the trigger's `now()`), but it is unnecessary and inconsistent
   with why those three siblings needed it in the first place (their
   tables have no trigger). Worth a one-line note in the report rather than
   copy-pasting blindly.
3. **`translated_languages: ['en']` constant vs. the admin's create/update
   branch.** `category-form.tsx:237-240` (not 236-238 as cited — see §1)
   picks `createCategory` vs `updateCategory` based on
   `!initialValues.translated_languages.includes(router.locale!)`. Today
   the mock's categories presumably carry varied `translated_languages`
   arrays; once the API always emits the constant `['en']` (already true
   today for reads, unrelated to this US — see `categories.service.ts:169`
   in the existing `toCategoryDto`), any admin browsing in a locale other
   than `en` would see `initialValues.translated_languages.includes(locale)`
   evaluate `false` and would always go through `createCategory` instead of
   `updateCategory` when editing an existing category. **This is a
   pre-existing condition of the already-shipped read path, not something
   introduced by US-28** — the constant was already wired in
   `toCategoryDto` before this change. The US explicitly frames this as
   "the only UI check of this US and does NOT imply changing the frontend"
   — so the correct action is to smoke-test it manually in the browser (as
   the US instructs) and report the outcome, not to fix it if broken.
   Flagging it here so the implementer does not skip that manual check.
4. **DTO mismatch is real and already scoped correctly by the US.**
   `CreateCategoryDto` (`create-category.dto.ts:4-12`) is `PickType(Category,
   ['name','type','details','parent','icon','image','language'])`, and
   `Category` (`entities/category.entity.ts`) declares `parent?: Category`
   and `type?: Type` as **objects**. The admin actually sends `type_id`
   (number) and `parent` (number or `null`) (`category-form.tsx:234-235`).
   Confirmed: the DTO's declared shape does not match what is sent, exactly
   as the US states — correcting the DTO to declare `type_id`/`parent` as
   numeric is in scope (decision 15 of the epic); adding nested-object
   support is explicitly out of scope.
5. **`image`/`icon` persistence has no existing precedent in this
   codebase for jsonb + string-together on the same aggregate** — closest
   analogues are `tags.repository.ts` (`image?: Prisma.InputJsonValue`,
   nullable, "`image: null` se trata como ausente") and `manufacturers`
   (same shape). `icon` as a plain nullable string exists on `types` and
   `tags` already. No aggregate currently combines both `image` (jsonb) and
   `icon` (text) with a `parent_id` self-reference — categories is the
   first, but each individual piece has a precedent to copy.
6. **Integration test count drift is a real operational risk, not just
   style.** Because `categories.integration.test.ts` has never had a
   sentinel-cleanup convention, a first-time author who is not careful
   about ordering (creating write-test describes that run before the
   existing 198/83/10/53 assertions, or failing to clean up on a thrown
   assertion mid-test) will make the existing read-only suite red. The
   `beforeAll(cleanup)`-folded-into-existing-`afterAll` idiom from
   `types.integration.test.ts` must be replicated exactly, with a `try {
   cleanup() } finally { disconnect() }` in the single `afterAll`.
7. **CA-4's depth-4 test must attach under a real grandchild, not
   fabricate a new 3-level sentinel chain.** Building a full sentinel chain
   (root→child→grandchild→great-grandchild) is also valid and safer for
   isolation (it never risks perturbing seed rows `124`/`163`/`164`/`169`/
   `170`), and is arguably a better fit for the "each test borrows nothing
   from the seed" convention seen in `types`/`tags`/`manufacturers`
   integration tests, which never mutate seeded rows. Recommend building an
   entirely sentinel-owned depth-4 chain (four `zz-categories-` rows, one
   per level, all same `type_id`) rather than parenting onto seed id `169`,
   to avoid any risk to the seed-dependent counts in the same file.

## Approaches compared (summary — see §4 for the cycle guard, the only place with a genuine fork)

| Decision point | Options | Recommendation |
|---|---|---|
| Cycle guard implementation | (A) capped iterative round-trips vs (B) single flat query + in-memory walk | **A** — matches US guidance, matches verified real shallowness (2 hops), no reuse of private `_assembleTree` internals |
| Parent-exists validation | Rely on Postgres P2003 (already wired) vs explicit pre-fetch | Pre-fetch anyway (needed for type-match check), throw `InvalidReferenceError` explicitly for consistency; P2003 remains a correct backstop either way |
| Self-reference / cycle validation | Rely on DDL CHECK vs pre-validate in app code | **Must** pre-validate in app code — the DDL CHECK's violation is NOT in `translateCatalogWriteError`'s closed set and would surface as an unintended 500 |
| Delete re-rooting | Explicit re-root query vs rely on `ON DELETE SET NULL` | Rely on `ON DELETE SET NULL` (already decided in epic decision 7; no repository code needed for this specific behavior beyond the plain delete) |
| Response projection after write | Build `CategoryTreeNode` by hand vs re-fetch via `findCategoryByIdOrSlug` | Re-fetch (US's own explicit instruction, §"Notas para el agente ejecutor"); for `deleteCategory` this needs a decision on whether the response reflects the pre-delete snapshot (with its old children) or a re-fetch that will return `null` — **open question for sdd-design**, since the row no longer exists after deletion |

## Open question for sdd-design (not resolved here)

`deleteCategory`'s HTTP response needs the full 16-key `toCategoryDto`
shape (decision 3 of the epic: DELETE returns the deleted record with the
same projection as GET), but `findCategoryByIdOrSlug` — the function the US
says to reuse for building the response — will return `null` for an id
that no longer exists. Two ways to resolve, neither implemented or decided
here:
- Capture the full `CategoryTreeNode` (via `findCategoryByIdOrSlug`) or at
  least the flat `CategoryRecord` **before** issuing the delete, and project
  it with `toCategoryDto`/an equivalent, accepting that its `children`
  reflect the pre-delete state (now re-rooted in the DB, but not in the
  response).
- Only echo the flat `CategoryRecord` fields (like `deleteType`/`deleteTag`
  do, returning `_toXRecord(existing)`) and let the service project it
  through the **descendant/ancestor-shaped** `toCategoryDto` with best-effort
  `parent`/`type`/`children` (possibly empty/stale) — same effective
  outcome, different code path.

Both are viable; this exploration flags it rather than picking one, since
it is a design-time contract decision (what exactly comes back from
`DELETE`), not a discovery.

## Ready for Proposal

**Yes.** All line references have been checked (three real drifts found and
corrected: repository +10 lines from a US-27b comment insertion, schema
comment off-by-one, one form.tsx citation off by ~4 lines — all noted
above with corrected line numbers). CA-4 has a strong, code-grounded answer
(architecturally unlimited depth, empirical confirmation still owed to
`sdd-apply`/`sdd-verify` per the US's own "verified, not assumed" framing).
The cycle-guard design space has exactly one real fork (§4), with a
recommendation and rationale. The one item that should NOT be decided by
`sdd-propose`/`sdd-design` implicitly is the `deleteCategory` response
shape (see "Open question" above) — it should be an explicit decision line
in `design.md`.
