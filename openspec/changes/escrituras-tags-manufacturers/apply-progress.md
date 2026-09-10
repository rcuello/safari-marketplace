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

## Phase 2 — `tags` in the API (commit #2)

### Task record

| Task | Status | Notes |
|---|---|---|
| 2.1 | [x] | `create-tag.dto.ts`: `PickType(Tag, ['name','slug','details','image','icon','language'])` + standalone `type_id?: number` (D27b-1) + `@IsString() @IsNotEmpty() name: string`. `tag.entity.ts` and `update-tag.dto.ts` untouched. |
| 2.2 | [x] | `tags.service.ts`: `create`/`update`/`remove` project field-by-field into `CreateTagInput`/`UpdateTagInput` via conditional spread (never spread the DTO); `+id` `Number.isInteger` guard → `NotFoundException` before calling the repository (DD-10); each of the 3 methods does a **sequential** `await createTag/updateTag/deleteTag(...)` then `await listTypes()` then `toTagDto(record, new Map(...))` (DD-7 — verified `Promise.all` is NOT used, confirmed by a call-order test in 2.3); `catch (error) { throw toWriteHttpException(error); }`. Removed `@db/tags.json` import, `Fuse`, `plainToClass`, `private tags` field and the old in-memory `create`/`update`/`remove` stubs. `findAll`/`findOne` untouched. |
| 2.3 | [x] | Created `tags.service.spec.ts` (474 lines): `jest.mock('@safari/db', ...)` mocking `createTag`/`updateTag`/`deleteTag`/`findTagBySlug`/`listTypes`, keeping the 5 domain-error classes and `toWriteHttpException` real. Covers: field-by-field projection omitting absent keys and ignoring `socials`/`cover_image`; explicit projection of all optional fields including the `image` boundary cast; sequential-`listTypes`-after-write via a call-order array (DD-7 proof); the 5 domain-error classes → 400/404/409 (`EmptySlugError`/`InvalidReferenceError`→400, `RecordNotFoundError`→404, `SlugConflictError`/`DependentRowsError`→409); `{code:'P1001'}`→503; `{code:'P2011'}`→500 (B-1); non-integer `+id`→404 without calling the repository (create has no id guard by design, only update/remove); the CA-1 9-key `Object.keys()` contract between `create`/`update`/`remove` and `findOne`, in order, no `.sort()`. No assertion touches `ValidationPipe` (N-1). `/// <reference types="jest" />` header. |
| 2.4 | [x] | `just db-build` → `npx jest` (7 suites / 112 tests, green) → `just build-api` (clean) → `grep -n "fuse\|@db/" tags.service.ts` → 0 lines. All real output pasted below. |
| 2.5 | [x] | Full `curl`+`psql` sequence against a real, restarted API process. All real output pasted below. `tags` count confirmed back to 10 after the sequence's own `DELETE`. |

### Deviations from the design's pinned interfaces

- **None in substance.** The 3 methods, the field-by-field projection, the
  sequential `listTypes()` (DD-7), the `+id` guard (DD-10), and the
  `image` boundary cast match `types.service.ts:96-161` and design.md's
  pinned signatures exactly. `tags.service.spec.ts` landed at **474**
  lines against the design's own corrected anchor of "~320, NOT the ~145
  the US-27a design under-predicted" — the design's own estimate table
  already flagged this file as the likely overrun, and it materialized:
  474 vs the ~320 forecast (+154), because the spec adds explicit
  call-order proofs for DD-7 (two extra tests, one per `create`/`update`)
  and separate tests for each of the 5 domain-error classes (the template
  in `types.service.spec.ts` only exercises `EmptySlugError`,
  `P1001`, and `P2011` in its `create` describe, and `DependentRowsError`/
  `RecordNotFoundError` only in `remove`; `tags.service.spec.ts` exercises
  all 5 inside `create` alone, plus `RecordNotFoundError`/`EmptySlugError`/
  `InvalidReferenceError` again inside `update`, because `type_id` as a
  real FK is new to this US and CA-4's `InvalidReference` path did not
  exist for `types`).
- **`InvalidReference` message is empirically misleading, exactly as DD-3
  predicted (S-1 reproduced) — no code changed.** `POST /api/tags
  {"name":"X","type_id":99999}` returned the literal message
  `` `tags.slug` referencia un registro inexistente. `` — naming `slug`
  instead of the actually-violated `type_id`, because Prisma 7 +
  `@prisma/adapter-pg` does not populate `meta.field_name` on this P2003
  and `translateCatalogWriteError` falls back to `context.uniqueField`
  (`domain-errors.ts:150-156`). The design's pre-authorized remedy (omit
  `uniqueField` from this call site's `context` in `tags.repository.ts`)
  was **not applied**: that file belongs to commit #1, already committed
  (`684eef4`), and this run's file list forbids touching
  `packages/db/**`. Per the task's explicit instruction ("if you conclude
  the remedy is needed, STOP and report rather than editing it in this
  slice"), this is reported as a finding for the orchestrator/user to
  decide on, not actioned here. No row was created by the failed `POST`
  (verified: `SELECT count(*) FROM tags WHERE name = 'X'` → 0).
- **Orphaned `nest start --watch` processes found already running at
  session start**, on top of the one occupying port 9001 (which was
  killed before launch per the DoD's port-check requirement). Two
  additional `nest start --watch` trees (not bound to 9001) were found
  running, predating this session — the same failure mode the design
  warned about from US-27a's verify. They were **not started by this run**
  and are outside this run's edit/process scope, so they were left alone;
  reported as a risk below. The chain this run started (`yarn start:dev`
  → `nest start --watch` → the two node processes bound to 9001) was
  fully killed at the end — confirmed by `netstat` showing port 9001
  free after task 2.5.
- **`just db-check` flake reproduced exactly as warned.** Re-run once
  after commit #2's own changes (unrelated to `packages/db`, which this
  run did not touch) to sanity-check the environment: first run failed 1
  of 121 (`products.integration.test.ts > listProducts > busca por nombre
  parcial case-insensitive`, `TypeError: Cannot read properties of null
  (reading 'id')` inside `_toTagRecord`, a cross-file race between a
  concurrently-running write-test's tag delete and this read test, per
  design.md's own documented parallelism risk since `packages/db` has no
  `vitest.config.*`); the immediate re-run passed 9/9 files, 121/121
  tests. Both outcomes are pasted below, honestly, per the run's
  instructions. Not a regression from this commit's work (no
  `packages/db` files changed in this run).

### Real command output — `just db-build`

```
$ just db-build
npm install

up to date, audited 325 packages in 3s
...
npm run build

> @safari/db@0.1.0 build
> prisma generate && tsup

Loaded Prisma config from prisma.config.ts.
Prisma schema loaded from prisma\schema.prisma.

✔ Generated Prisma Client (7.10.0) to .\generated\prisma\client in 294ms

CLI Building entry: index.ts
CLI Using tsconfig: tsconfig.json
CLI tsup v8.5.1
CLI Target: node18
CLI Cleaning output folder
CJS Build start
CJS dist\index.js     141.96 KB
CJS dist\index.js.map 330.80 KB
CJS ⚡️ Build success in 306ms
DTS Build start
DTS ⚡️ Build success in 11032ms
DTS dist\index.d.ts 1.39 MB
```

### Real command output — `cd apps/api/rest && npx jest`

```
PASS src/users/user-dto.mapper.spec.ts
PASS src/common/errors/domain-error.mapper.spec.ts
PASS src/types/types.service.spec.ts
PASS src/shops/shops.service.spec.ts
PASS src/users/users.service.spec.ts
PASS src/tags/tags.service.spec.ts
PASS src/products/products.service.spec.ts

Test Suites: 7 passed, 7 total
Tests:       112 passed, 112 total
Snapshots:   0 total
Time:        31.723 s, estimated 46 s
Ran all test suites.
```

Baseline was 6 suites / 92 tests. New: **7 suites / 112 tests** (+1 suite,
+20 tests) — matches the design's forecast exactly.

### Real command output — `just build-api`

```
$ just build-api
yarn build
yarn run v1.22.22
$ rimraf dist
$ nest build
(node:46256) [DEP0053] DeprecationWarning: The `util.isObject` API is deprecated. ...
Done in 50.73s.
```

Clean, no TypeScript errors.

### Real command output — `grep -n "fuse\|@db/" apps/api/rest/src/tags/tags.service.ts`

```
$ grep -n "fuse\|@db/" apps/api/rest/src/tags/tags.service.ts; echo "EXIT=$?"
EXIT=1
```

`EXIT=1` from `grep` means no match — 0 lines, as required.

### Real command output — `curl`/`psql` sequence (task 2.5)

Token obtained via `POST /api/token` with the seeded `admin@demo.com` /
`demodemo` credentials (`db/seed.sql:47-51`), role `super_admin`.

```
== POST /api/tags ==
$ curl -X POST http://localhost:9001/api/tags -H "Authorization: Bearer $TOKEN" \
    -d '{"name":"Oferta Verano","type_id":9,"socials":[{"icon":"x","url":"y"}],"cover_image":{"id":1}}'
{"id":201,"name":"Oferta Verano","language":"es","translated_languages":["en"],
 "slug":"oferta-verano","details":null,"image":null,"icon":null,
 "type":{"id":9,"name":"Gadget","slug":"gadget","logo":null}}
HTTP 201
```

`Object.keys()` via `node -e` (no `.sort()`): 9 keys exactly —
`['id','name','language','translated_languages','slug','details','image','icon','type']`.
No `socials`/`cover_image` in the response (B-3).

```
== GET /api/tags/oferta-verano (before restart) ==
{"id":201, ... same 9 keys ...}
HTTP 200
```

**Real API restart** — full process tree killed (`yarn start:dev` →
`nest start --watch` → the two node processes bound to port 9001),
`netstat` confirmed port 9001 free, then `yarn start:dev` relaunched and
polled until `GET /api/tags/oferta-verano` answered 200 again (2 tries,
~4s):

```
== GET /api/tags/oferta-verano (after restart) ==
{"id":201,"name":"Oferta Verano", ... same 9 keys ...}
HTTP 200
```

The row survives the restart — proof this is a real Postgres write, not
the in-memory mutation the old stub did.

```
== psql BEFORE PUT ==
 id  |     name      |     slug      |         updated_at
-----+---------------+---------------+----------------------------
 201 | Oferta Verano | oferta-verano | 2026-09-10 15:50:20.083+00

== PUT /api/tags/201  {"name":"Oferta de Invierno","slug":"intento-de-cambiar"} ==
{"id":201,"name":"Oferta de Invierno","language":"es","translated_languages":["en"],
 "slug":"oferta-verano","details":null,"image":null,"icon":null,
 "type":{"id":9,"name":"Gadget","slug":"gadget","logo":null}}
HTTP 200

== psql AFTER PUT ==
 id  |        name        |     slug      |         updated_at
-----+--------------------+---------------+----------------------------
 201 | Oferta de Invierno | oferta-verano | 2026-09-10 15:51:57.526+00
```

`slug` stayed `oferta-verano` despite the attempted `"slug":
"intento-de-cambiar"` in the body (immutable, DD-1). `updated_at` advanced
from `15:50:20.083+00` to `15:51:57.526+00` — measured in the column via
`psql`, never via `curl` (V-6, per the response having no timestamp keys).

```
== POST /api/tags {"name":"X","type_id":99999} ==
{"statusCode":400,"message":"`tags.slug` referencia un registro inexistente.","error":"Bad Request"}
HTTP 400
```

**Literal message, recorded as required (DD-3):**
`` `tags.slug` referencia un registro inexistente. `` — this reproduces
`S-1` from US-27a's verify: the field named is `slug`, not the actually
violated `type_id`, because Prisma 7 + `@prisma/adapter-pg` does not
populate `meta.field_name` for this P2003 and the mapper falls back to
`context.uniqueField`. No fix applied in this run — see Deviations above.
Confirmed no row was created: `SELECT count(*) FROM tags WHERE name = 'X'`
→ `0`.

```
== DELETE /api/tags/201 ==
{"id":201,"name":"Oferta de Invierno","language":"es","translated_languages":["en"],
 "slug":"oferta-verano","details":null,"image":null,"icon":null,
 "type":{"id":9,"name":"Gadget","slug":"gadget","logo":null}}
HTTP 200
```

Same 9 keys as the create/read projection (verified via `node -e`,
`Object.keys()`, no `.sort()`).

```
== GET /api/tags/oferta-verano (after delete) ==
{"statusCode":404,"message":"No existe un tag con slug `oferta-verano`.","error":"Not Found"}
HTTP 404
```

**Log stack-trace check (N-5):** `grep -cE '^\s+at ' api-dev-2.log` → `0`
across the whole sequence, including the `P2003` probe (Prisma's own
`prisma:error` code-frame line is present, but it carries no JS stack
frame — same discriminator precedent as US-27a).

**Cleanup verification:**

```
$ docker exec safari-postgres psql -U safari -d safari_scraper -c "SELECT count(*) FROM tags;"
 count
-------
    10
```

`tags` back to 10 rows — the sequence self-cleaned via its own `DELETE`,
no manual cleanup needed.

**Process cleanup:** the full `yarn start:dev` → `nest start --watch` →
node process tree started for this task was killed at the end (`Stop-Process`
by PID chain); `netstat -ano | grep ":9001" | grep LISTENING` returned
empty afterward.

### `git diff --numstat` vs the ~467-line forecast (commit #2)

```
$ git diff --numstat -- apps/api/rest/src/tags/dto/create-tag.dto.ts apps/api/rest/src/tags/tags.service.ts
25      2       apps/api/rest/src/tags/dto/create-tag.dto.ts
92      24      apps/api/rest/src/tags/tags.service.ts
$ wc -l apps/api/rest/src/tags/tags.service.spec.ts
474
```

Totals: **25 + 92 + 474 = 591 added**, 26 deleted (617 changed) vs the
design's forecast for commit #2 of ~467 added (+~20 deleted). Breakdown:

| File | Forecast (added) | Actual (added) | Delta |
|---|---|---|---|
| `create-tag.dto.ts` | ~22 | 25 | +3 (header comment explaining `type` → `type_id` and the `slug` addition) |
| `tags.service.ts` | ~125 | 92 | −33 (the design's per-area estimate for `tags` included some slack that `manufacturers` needs more of — no `is_approved`/`type_id` coercion branches on this aggregate) |
| `tags.service.spec.ts` | ~320 | 474 | +154 (5 domain-error classes tested individually in `create`, re-tested relevant subset in `update`; 2 explicit DD-7 call-order proofs; see Deviations) |

Net over forecast: **+124 lines** (~27% over), concentrated entirely in
the jest spec — the design's own risk note already flagged this file as
the most likely to exceed its estimate, same as it did for `types` in
US-27a (331 real vs ~145 predicted). Lowest-review-cost material per the
design's own framing.

### Forbidden files — untouched

```
$ git diff --stat HEAD -- packages/db/src/slug.ts packages/db/src/domain-errors.ts apps/api/rest/src/common/errors/
(empty output)
$ git diff --stat HEAD -- packages/db/
(empty output)
```

Confirms CA-7 intact: `packages/db/src/slug.ts`, `domain-errors.ts`,
`apps/api/rest/src/common/errors/**`, and **all of `packages/db/`**
(already committed in commit #1, untouched by this run) are
byte-identical to `HEAD`.

### `just db-check` — sanity re-verification (not part of this commit's DoD gate, `packages/db` untouched)

First run (flake, matches the documented risk):

```
Test Files  1 failed | 8 passed (9)
     Tests  1 failed | 120 passed (121)
FAIL  src/repositories/products.integration.test.ts > listProducts > busca por nombre parcial case-insensitive
TypeError: Cannot read properties of null (reading 'id')
 ❯ _toTagRecord src/records.ts:252:17
 ❯ _toProductRecord src/repositories/products.repository.ts:515:20
 ❯ listProducts src/repositories/products.repository.ts:273:24
 ❯ src/repositories/products.integration.test.ts:75:23
```

Immediate re-run (green):

```
Test Files  9 passed (9)
     Tests  121 passed (121)
```

Both outcomes reported honestly per this run's instructions. Not a
regression: this run did not modify any file under `packages/db/`.

### `git status` — full picture at the end of this run

```
On branch us-27b-escrituras-tags-manufacturers
Changes not staged for commit:
  modified:   apps/api/rest/src/tags/dto/create-tag.dto.ts
  modified:   apps/api/rest/src/tags/tags.service.ts
  modified:   openspec/changes/escrituras-tags-manufacturers/tasks.md

Untracked files:
  apps/api/rest/src/tags/tags.service.spec.ts
```

No file outside this run's allowed list has a diff. `apply-progress.md`
itself will show as modified once this write completes.

## Phases 3-4

Untouched — `tasks.md` still shows `[ ]` for all of Phase 3 and Phase 4.
