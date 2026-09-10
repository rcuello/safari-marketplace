# Apply Progress: `escrituras-tags-manufacturers` (US-27b)

## Phase 1 — `tags` in `packages/db` (commit #1)

### Task record

| Task | Status | Notes |
|---|---|---|
| 1.1 | [x] | `tags.repository.ts`: added `CreateTagInput`/`UpdateTagInput` (`Partial<Omit<CreateTagInput,'slug'>>`), `tagSlugs: ExistingSlugLookup`, `createTag`, `updateTag`, `deleteTag`. Every write closes with `catch (error) { throw translateCatalogWriteError(error, {aggregate:'tags', id?, uniqueField:'slug'}); }`. |
| 1.2 | [x] | `packages/db/index.ts`: barrel-exports `createTag`, `updateTag`, `deleteTag`, `CreateTagInput`, `UpdateTagInput` added next to the existing `findTagBySlug`/`listTags`/`ListTagsInput` block. No rebase needed — no concurrent US touched the file. |
| 1.3 | [x] | `tags.integration.test.ts`: write `describe`s appended at the end of the file, after the existing read `describe`s, with the mandatory comment (DD-8.3) directly above the first write `describe`, warning against inserting read tests below it. Sentinel `zz-tags-`; cleanup folded into the existing `afterAll` in `try/finally`; `beforeAll(cleanup)` added. |
| 1.4 | [x] | `just db-build` clean, `just db-check` green — see pasted output below. |

### Deviations from the design's pinned interfaces

- **`_assertValidTypeId` helper.** The design's task 1.1 writes the `typeId`
  guard as inline pseudocode
  (`if (input.typeId != null && !Number.isInteger(input.typeId)) throw ...`).
  Since the exact same guard is needed verbatim in both `createTag` and
  `updateTag`, it was factored into a private `_assertValidTypeId` function
  local to the file, called from both. Behavior is byte-identical to two
  inlined copies of the pseudocode — same condition, same error class, same
  arguments. Not a design deviation in substance, just a DRY refactor within
  the same file.
- **Two extra `InvalidReferenceError` tests** (one under `createTag`, one
  under `updateTag`) beyond the single generic "malformed `typeId`" bullet in
  task 1.3. Rationale: the guard is shared code exercised from two call
  sites with different surrounding logic (create has no pre-existing row to
  leave intact; update must additionally prove the row stays untouched), so
  both paths are asserted. This is the main reason the test file landed at
  183 added lines instead of the ~165 the design's per-area estimate
  projected (see "Forecast vs actual" below).
- No other deviation. `slug` immutability, `updatedAt: now()`, absent-key
  spread semantics (B-4), and `deleteTag`'s find-then-delete-with-no-409
  shape all match the design and the `deleteScrapedProduct` precedent
  literally.

### Real command output — `just db-build`

```
$ just db-build
npm install

up to date, audited 325 packages in 4s
...
npm run build

> @safari/db@0.1.0 build
> prisma generate && tsup

Loaded Prisma config from prisma.config.ts.

Prisma schema loaded from prisma\schema.prisma.

✔ Generated Prisma Client (7.10.0) to .\generated\prisma\client in 496ms

CLI Building entry: index.ts
CLI Using tsconfig: tsconfig.json
CLI tsup v8.5.1
CLI Using tsup config: C:\DevOps\MyGitHub\safari-marketplace\packages\db\tsup.config.ts
CLI Target: node18
CLI Cleaning output folder
CJS Build start
CJS dist\index.js     141.96 KB
CJS dist\index.js.map 330.80 KB
CJS ⚡️ Build success in 146ms
DTS Build start
DTS ⚡️ Build success in 10963ms
DTS dist\index.d.ts 1.39 MB
```

### Real command output — `just db-check`

```
$ just db-check
npm run typecheck

> @safari/db@0.1.0 typecheck
> tsc --noEmit

cd "$(pwd)" && npm test

> @safari/db@0.1.0 test
> vitest run


 RUN  v4.1.11 C:/DevOps/MyGitHub/safari-marketplace/packages/db

(node:57840) DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead.
(Use `node --trace-deprecation ...` to show where the warning was created)

 Test Files  9 passed (9)
      Tests  121 passed (121)
   Start at  10:34:49
   Duration  8.15s (transform 9.24s, setup 0ms, import 23.48s, tests 10.95s, environment 2ms)
```

**Baseline was 9 files / 111 tests. New count: 9 files / 121 tests (+10 new
tests, file count unchanged as required).** `typecheck` (`tsc --noEmit`)
completed with no errors. `tags.integration.test.ts:18`'s `toBe(10)` and
`:19-20`'s `items[0].id === 62` / `items[items.length-1].id === 53` asserts
are part of that green run — untouched and unweakened.

### Post-run DB state (sanity, not part of the DoD gate)

```
$ docker exec safari-postgres psql -U safari -d safari_scraper \
    -c "SELECT count(*) FROM tags;" \
    -c "SELECT count(*) FROM product_tag;" \
    -c "SELECT tags_id_seq.last_value FROM tags_id_seq;"

 count
-------
    10
(1 row)

 count
-------
     0
(1 row)

 last_value
------------
         68
(1 row)
```

`tags` back to 10 rows, `product_tag` back to 0 rows — every sentinel test
cleaned up after itself. `tags_id_seq` advanced from 62 to 68 (six
create/delete round-trips in the new tests); this is expected sequence churn,
not row leakage, and does not affect any assert (the `listTags` id asserts
are filter-free reads of the 10 live rows, not sequence-position asserts).

### `git diff --stat` vs the ~330-line forecast

```
$ git diff --numstat -- packages/db/index.ts packages/db/src/repositories/tags.integration.test.ts packages/db/src/repositories/tags.repository.ts
12      2       packages/db/index.ts
183     4       packages/db/src/repositories/tags.integration.test.ts
163     0       packages/db/src/repositories/tags.repository.ts
```

Totals: **358 added / 6 deleted** (364 changed) vs the forecast's ~330 added
(commit #1 subtotal: ~150 repository + ~165 test + ~12 barrel = ~327).
Breakdown vs forecast:

| File | Forecast (added) | Actual (added) | Delta |
|---|---|---|---|
| `tags.repository.ts` | ~150 | 163 | +13 (header comment explaining the `types`-vs-`tags` FK/cascade difference, plus the `_assertValidTypeId` helper and its docstring) |
| `tags.integration.test.ts` | ~165 | 183 | +18 (the two malformed-`typeId` tests noted above as a deviation, plus the DD-8.3 warning comment) |
| `packages/db/index.ts` | ~12 | 12 | 0 |

~31 lines over the per-area estimate, within the design's own admitted slack
for commentary density (`types.repository.ts` template is comment-heavy);
no new files, no file outside the allowed list.

### Forbidden files — untouched

```
$ git diff --stat -- packages/db/src/slug.ts packages/db/src/domain-errors.ts apps/api/rest/src/common/errors/
(empty output)
```

Confirms `packages/db/src/slug.ts`, `packages/db/src/domain-errors.ts`, and
`apps/api/rest/src/common/errors/**` are byte-identical to `HEAD` — CA-7
intact.

### `git status` — full picture

```
On branch us-27b-escrituras-tags-manufacturers
Changes not staged for commit:
  modified:   docs/product/26-escrituras-catalogo-postgres/27b-escrituras-tags-manufacturers.md
  modified:   packages/db/index.ts
  modified:   packages/db/src/repositories/tags.integration.test.ts
  modified:   packages/db/src/repositories/tags.repository.ts

Untracked files:
  openspec/changes/escrituras-tags-manufacturers/
```

`docs/product/26-escrituras-catalogo-postgres/27b-escrituras-tags-manufacturers.md`
was already modified before this run started (pre-existing working-tree
state at session start, per the orchestrator's git status) — not touched by
this apply run. No other file outside the allowed list for commit #1 has a
diff.

## Phases 2-4

Untouched — `tasks.md` still shows `[ ]` for all of Phase 2, 3, and 4.
