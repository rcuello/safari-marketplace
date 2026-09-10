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

## Phase 3 — `manufacturers` in `packages/db` (commit #3)

### Task record

| Task | Status | Notes |
|---|---|---|
| 3.1 | [x] | `manufacturers.repository.ts`: added `CreateManufacturerInput`/`UpdateManufacturerInput` (`Partial<Omit<CreateManufacturerInput,'slug'>>`), `manufacturerSlugs: ExistingSlugLookup`, `createManufacturer`, `updateManufacturer`, `deleteManufacturer`. **S-1 remedy applied from the start** (per this run's explicit instruction, ahead of the design's own `DD-3` "observe first" framing, since the remedy was already proven necessary and applied to `tags.repository.ts` in commit #1): every `translateCatalogWriteError` call site passes `{aggregate:'manufacturers'}` or `{aggregate:'manufacturers', id}` — **no `uniqueField`**. `isApproved` stays `boolean`-typed (no coercion in the repository, DD-6); `image?: Prisma.InputJsonValue` without `\| null` (DD-5); same `_assertValidTypeId` guard shape as `tags.repository.ts` (DD-2); `deleteManufacturer` is find-then-delete with no dependent count (D27b-3). `findOrCreateManufacturerBySlug` untouched — confirmed by diff (only new code added below it). |
| 3.2 | [x] | `packages/db/index.ts`: barrel-exports `createManufacturer`, `updateManufacturer`, `deleteManufacturer`, `CreateManufacturerInput`, `UpdateManufacturerInput` added next to the existing `findManufacturerBySlug`/`findOrCreateManufacturerBySlug`/`listManufacturers`/`ListManufacturersInput` block. No rebase needed — no concurrent US touched the file. |
| 3.3 | [x] | `manufacturers.integration.test.ts`: write `describe`s appended at the end of the file (no file-order trap here, confirmed empirically — see "Order-sensitivity finding" below). Sentinel `zz-manu-`; cleanup folded into the existing `afterAll` in `try/finally`; `beforeAll(cleanup)` added. Desenlace test links a sentinel manufacturer to a seeded product's `manufacturer_id`, deletes the manufacturer, and asserts row-scoped via `prisma.product.findUnique({ where: { id: seededProduct.id } })).manufacturerId === null` — never a global `product.count()` (B-2). |
| 3.4 | [x] | `just db-build` clean, `just db-check` green — see pasted output below. |

### Order-sensitivity finding (per the DoD's explicit request)

`manufacturers.integration.test.ts:18`'s `toBe(14)` is a plain global count —
insensitive to id ordering by construction. `:32-36`'s
`toHaveLength(10)`/`toEqual([1,2,...,10])` runs `listManufacturers({limit:10})`
under the table's `orderBy: { id: 'asc' }` (no filter): the assert is
**scoped to the first 10 ids of an ascending, unfiltered list**. The seeded
manufacturer ids measured today are `1..12, 18, 19` with
`manufacturers_id_seq.last_value = 20` — any sentinel this suite creates gets
an id ≥ 20 (confirmed after the run: sequence advanced to 32). An id ≥ 20
can never appear inside `limit:10` of an ascending order starting at id 1,
so **there is no analogous trap to `tags.integration.test.ts:19`'s
`orderBy: { id: 'desc' }` unfiltered `items[0].id === 62`** (where any live
sentinel — necessarily a higher id than 62 — would appear first). Conclusion:
placing the write `describe`s at the end of the file (done here, matching
the file's existing convention and `tags`'s pattern for consistency) is
sufficient; it was not load-bearing to correctness for `manufacturers` the
way it was for `tags`, but doing it anyway costs nothing and keeps the two
files structurally uniform for future readers.

### Deviations from the design's pinned interfaces

- **S-1 remedy applied proactively, not "observed first."** The design's
  `DD-3` frames the `uniqueField` omission as a remedy to apply *if* the
  misleading `P2003` message is observed empirically in this slice. This
  run's explicit instructions (informed by commit #1/#2's empirical finding,
  already reproduced and recorded in `tags.repository.ts`/`tags.service.ts`'s
  history) said to apply the remedy **from the start** for `manufacturers`
  too, since the underlying Prisma 7 + `@prisma/adapter-pg` behavior
  (`meta.field_name` not populated on P2003) is a property of the driver, not
  of the aggregate — it will reproduce identically here. Applied: all three
  `translateCatalogWriteError` call sites in `manufacturers.repository.ts`
  omit `uniqueField`. This is **not** an edit to `domain-errors.ts` (CA-7
  intact) — it is the call-site-only shape the design pre-authorized.
- **Bug found and fixed during 3.4's first `just db-check` run: raw-Prisma
  `bigint` vs `number` in the desenlace test.** The first run of the new
  suite failed 2 of 131 tests:
  - `desenlace: ...` failed with `AssertionError: expected 26n to be 26`
    because `prisma.product.findUnique(...)` returns the raw row, where
    `manufacturerId` is a Postgres `bigint` column and Prisma surfaces it as
    a JS `bigint` (`26n`), not a `number` — the repository's own
    `_toManufacturerRecord`/`_id()` conversion (`records.ts:37-40`) is what
    normally hides this, but the test queries `prisma.product` directly, not
    through a record mapper. Fixed by wrapping the raw field in `Number(...)`
    before the equality assert (`expect(Number(linked?.manufacturerId)).toBe(created.id)`).
    This is a **test bug, not an app bug**: `deleteManufacturer` and its
    `SET NULL` semantics were never in question, only the raw-row read in
    the test's own setup assertion.
  - `cierre de la suite ... vuelve a 14` failed with `expected 15 to be 14`
    — a **downstream symptom** of the same first failure: the desenlace
    test's assertion threw before it reached `deleteManufacturer(created.id)`
    two lines later, so that test's sentinel manufacturer was never deleted,
    leaving the count at 15 for the closing assert. No cleanup logic was
    weakened or bypassed to fix this — fixing the root cause (the `Number()`
    conversion) let the test run to completion and self-clean normally, and
    the closing assert was not touched.
  Both failures are pasted verbatim below, followed by the green re-run
  after the one-line fix. No existing assert (in this file, `tags`, or any
  other suite) was weakened, rewritten, or deleted to reach green.
- No other deviation. `slug` immutability, `updatedAt: now()`, absent-key
  spread semantics (B-4), and `deleteManufacturer`'s find-then-delete-with-
  no-409 shape all match the design and the `deleteTag`/`deleteScrapedProduct`
  precedent literally. `findOrCreateManufacturerBySlug` was not touched
  (confirmed: `git diff` shows only additions after its closing brace).

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

✔ Generated Prisma Client (7.10.0) to .\generated\prisma\client in 190ms

CLI Building entry: index.ts
CLI Using tsconfig: tsconfig.json
CLI tsup v8.5.1
CLI Using tsup config: C:\DevOps\MyGitHub\safari-marketplace\packages\db\tsup.config.ts
CLI Target: node18
CLI Cleaning output folder
CJS Build start
CJS dist\index.js     144.50 KB
CJS dist\index.js.map 339.38 KB
CJS ⚡️ Build success in 92ms
DTS Build start
DTS ⚡️ Build success in 8498ms
DTS dist\index.d.ts 1.39 MB
```

### Real command output — `just db-check`, first run (RED, test bug found)

```
$ just db-check
npm run typecheck

> @safari/db@0.1.0 typecheck
> tsc --noEmit

cd "$(pwd)" && npm test

> @safari/db@0.1.0 test
> vitest run


 RUN  v4.1.11 C:/DevOps/MyGitHub/safari-marketplace/packages/db

 ❯ src/repositories/manufacturers.integration.test.ts (16 tests | 2 failed) 1268ms
     × desenlace: borra la marca y `products.manufacturer_id` desenlaza por SET NULL — assert POR FILA, nunca un conteo global (B-2: ...) 95ms
     × ningún test de escritura dejó basura: prisma.manufacturer.count() vuelve a 14 11ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/repositories/manufacturers.integration.test.ts > deleteManufacturer — CA-3, sin conteo de dependientes (D27b-3) > desenlace: ...
AssertionError: expected 26n to be 26 // Object.is equality

- Expected:
26

+ Received:
26n

 ❯ src/repositories/manufacturers.integration.test.ts:225:7

 FAIL  src/repositories/manufacturers.integration.test.ts > cierre de la suite (CA-6) > ningún test de escritura dejó basura: prisma.manufacturer.count() vuelve a 14
AssertionError: expected 15 to be 14 // Object.is equality

- Expected
+ Received

- 14
+ 15

 ❯ src/repositories/manufacturers.integration.test.ts:245:47

 Test Files  1 failed | 8 passed (9)
      Tests  2 failed | 129 passed (131)
   Start at  11:10:13
   Duration  6.33s
```

Root cause diagnosed as a test-only `bigint`/`number` mismatch (see
Deviations above), fixed with a one-line `Number(...)` wrap — no assert
weakened, no cleanup skipped. `beforeAll(cleanup)` on the re-run removed the
one leftover sentinel row (id 15 at the time) from this failed attempt
automatically, as designed.

### Real command output — `just db-check`, re-run after the fix (GREEN)

```
$ just db-check
npm run typecheck

> @safari/db@0.1.0 typecheck
> tsc --noEmit

cd "$(pwd)" && npm test

> @safari/db@0.1.0 test
> vitest run


 RUN  v4.1.11 C:/DevOps/MyGitHub/safari-marketplace/packages/db

(node:52688) DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated ...

 Test Files  9 passed (9)
      Tests  131 passed (131)
   Start at  11:10:53
   Duration  5.38s (transform 1.86s, setup 0ms, import 7.36s, tests 11.22s, environment 1ms)
```

**Baseline (post-commit #2) was 9 files / 121 tests. New count: 9 files /
131 tests (+10 new tests, file count unchanged as required).** `typecheck`
(`tsc --noEmit`) completed with no errors both times.
`manufacturers.integration.test.ts:18`'s `toBe(14)` and `:32-36`'s
`toHaveLength(10)`/`ids === [1..10]` asserts are part of that green run —
untouched and unweakened. `tags.integration.test.ts`'s asserts (`:18`
`toBe(10)`, `:19-20` `items[0].id === 62`/`items[last].id === 53`) also
passed in the same run (file untouched by this commit).

### Post-run DB state (sanity, not part of the DoD gate)

```
$ docker exec safari-postgres psql -U safari -d safari_scraper \
    -c "SELECT count(*) FROM manufacturers;" \
    -c "SELECT count(*) FROM products WHERE manufacturer_id IS NOT NULL;" \
    -c "SELECT manufacturers_id_seq.last_value FROM manufacturers_id_seq;"

 count
-------
    14
(1 row)

 count
-------
     0
(1 row)

 last_value
------------
        32
(1 row)
```

`manufacturers` back to 14 rows, `products.manufacturer_id IS NOT NULL` back
to 0 — every sentinel test cleaned up after itself (including the failed
first attempt's leftover row, removed by `beforeAll(cleanup)` on the
re-run). `manufacturers_id_seq` advanced from 20 to 32 (create/delete
round-trips across both the failed and the green run); expected sequence
churn, not row leakage, and does not affect any assert (both `:18` and
`:32-36` read the 14 live rows / the first 10 seeded ids, not sequence
positions).

### `git diff --numstat` vs the ~332-line forecast (commit #3)

```
$ git diff --numstat -- packages/db/index.ts packages/db/src/repositories/manufacturers.integration.test.ts packages/db/src/repositories/manufacturers.repository.ts
8       1       packages/db/index.ts
204     4       packages/db/src/repositories/manufacturers.integration.test.ts
169     0       packages/db/src/repositories/manufacturers.repository.ts
```

Totals: **381 added / 5 deleted** (386 changed) vs the forecast's ~332
added (commit #3 subtotal: ~150 repository + ~170 test + ~12 barrel = ~332,
per design.md's per-area estimation table). Breakdown:

| File | Forecast (added) | Actual (added) | Delta |
|---|---|---|---|
| `manufacturers.repository.ts` | ~150 | 169 | +19 (header comment explaining the `types`-vs-`manufacturers` FK/`SET NULL` difference, the `_assertValidTypeId` helper with docstring, and the extra `isApproved` field vs `tags`'s `language`) |
| `manufacturers.integration.test.ts` | ~170 | 204 | +34 (the order-sensitivity explanation comment required by this run's DoD, the two malformed-`typeId` tests mirroring `tags`'s pattern, and the desenlace test's extra `Number(...)` bigint-safety comment added while fixing the test bug) |
| `packages/db/index.ts` | ~12 | 8 | −4 (fewer new type re-exports needed relative to `tags`, which also exports `ListTagsInput` inline in the same block already present) |

Net over forecast: **+49 lines** (~15% over), within the same commentary-
density slack observed for commit #1 (+31 over its ~327 forecast). No new
files, no file outside the allowed list.

### Forbidden files — untouched

```
$ git diff --stat HEAD -- packages/db/src/slug.ts packages/db/src/domain-errors.ts apps/api/rest/src/common/errors/
(empty output)
```

Confirms `packages/db/src/slug.ts`, `packages/db/src/domain-errors.ts`, and
`apps/api/rest/src/common/errors/**` are byte-identical to `HEAD` — CA-7
intact. `findOrCreateManufacturerBySlug` also confirmed untouched (diff
shows only additions after its function body, no changes within it).

### `git status` — full picture at the end of this run

```
On branch us-27b-escrituras-tags-manufacturers
Changes not staged for commit:
  modified:   packages/db/index.ts
  modified:   packages/db/src/repositories/manufacturers.integration.test.ts
  modified:   packages/db/src/repositories/manufacturers.repository.ts
```

No file outside this run's allowed list has a diff (`openspec/changes/
escrituras-tags-manufacturers/tasks.md` and this `apply-progress.md` file
itself will additionally show as modified once this write completes, both
explicitly in scope for this run).

## Phase 4 — `manufacturers` in the API + end-to-end DoD evidence (commit #4)

### Task record

| Task | Status | Notes |
|---|---|---|
| 4.1 | [x] | `create-manufacturer.dto.ts`: `OmitType(Manufacturer, ['id','created_at','updated_at','products_count','type','translated_languages'])` (N-9) + `@IsString() @IsNotEmpty() name` + `@IsOptional() @IsBoolean() is_approved?: boolean` (N-2/DD-6) + standalone `shop_id?: string`. `manufacturer.entity.ts` and `update-manufacturer.dto.ts` untouched. |
| 4.2 | [x] | `manufacturers.service.ts`: `create`/`update`/`remove` project field-by-field into `CreateManufacturerInput`/`UpdateManufacturerInput` via conditional spread (never spread the DTO); `is_approved` → `Boolean(...)` (DD-6); `type_id` → `Number(...)` unless `null` (DD-2); `socials`/`cover_image`/`language`/`shop_id` never projected (V-1/V-2/V-3); `+id` `Number.isInteger` guard → `NotFoundException` (DD-10); each of the 3 methods does a **sequential** `await createManufacturer/updateManufacturer/deleteManufacturer(...)` then `await listTypes()` then `toManufacturerDto(record, new Map(...))` (DD-7, verified by a call-order test in 4.3); `Number(record.isApproved)` in the mapper (`:53`, shifted from the old `:60` after removing the dead `plainToClass`/`Fuse` block) left **byte-identical**; `catch (error) { throw toWriteHttpException(error); }`. Removed `@db/manufacturers.json` import, `Fuse`, `plainToClass`, `private manufacturers` field and the old in-memory `create`/`update`/`remove` stubs (including the bug this US exists to close: `update()` used to mutate the in-memory array and lose the toggle on restart). `getManufactures`/`getTopManufactures`/`getManufacturesBySlug` untouched. |
| 4.3 | [x] | Created `manufacturers.service.spec.ts` (498 lines): `jest.mock('@safari/db', ...)` mocking `createManufacturer`/`updateManufacturer`/`deleteManufacturer`/`findManufacturerBySlug`/`listTypes`, keeping the 5 domain-error classes and `toWriteHttpException` real. Covers: field-by-field projection omitting absent keys and ignoring `socials`/`cover_image`/`language`/`shop_id`; explicit projection of all optional fields including `type_id: '9' → typeId: 9` and `is_approved: true → isApproved: true`; `type_id: null → typeId: null` (FK-clearing case, distinct from the malformed/absent cases); **unit-level B-4 proof** — the exact 5-key toggle payload (`{name, is_approved, type_id, language}`, `id` implicit in the method's own `id` param) asserted to produce an `updateManufacturer` call whose second argument `toEqual({name, isApproved, typeId})` **and** where `'description' in calledWith`/`'website' in calledWith`/`'image' in calledWith` are all `false`; `Boolean()` coercion of `is_approved` re-asserted with a second, independent test (`true`/`false` round trip via `toHaveBeenLastCalledWith`); sequential-`listTypes`-after-write via a call-order array (DD-7); the 5 domain-error classes → 400/404/409; `{code:'P1001'}`→503; `{code:'P2011'}`→500 (B-1); non-integer `+id`→404 without calling the repository; the CA-1 13-key `Object.keys()` contract between `create`/`update`/`remove` and `getManufacturesBySlug`, in order, no `.sort()`. No assertion touches `ValidationPipe` (N-1). `/// <reference types="jest" />` header. |
| 4.4 | [x] | `just db-build` → `npx jest` (8 suites / 135 tests, green on first try — no flake this time) → `just build-api` (clean) → `grep -n "fuse\|@db/" manufacturers.service.ts` → 0 lines. All real output pasted below. |
| 4.5 | [x] | Full `curl`+`psql` sequence against a real, twice-restarted API process (once between create and the toggle, once **mid-toggle-sequence** per the DoD's explicit ask). Central evidence: `is_approved:0` survives the restart, and `description`/`website`/`image` survive the exact 5-key toggle `PUT` (B-4 proof by `psql`, not inferred). All real output pasted below. |
| 4.6 | [x] | CA-3 setup executed with a **fresh probe pair** created via `POST` for this step (manufacturer id 40 `zz-manu-ca3`, tag id 252 `zz-tag-ca3` — not seeded rows), linked by `psql`, then deleted via `curl DELETE`. Closing counts confirmed: `products`=1200, `product_tag`=0, row 1's `manufacturer_id`=`NULL`. Labelled setup, not behavior (D27b-7). |
| 4.7 | [x] | Full CA-4 battery run: all 404/400 cases, the literal `type_id:99999` messages for both aggregates recorded, the collision scenario run literally as `spec.md:87-90` writes it (`oferta`→`oferta-2`, `medicure`→`medicure-2`), stack-trace check `grep -cE '^\s+at '` → 0 over the whole battery log. Cleanup by returned id (254, 255, 42), confirmed counts back to 10/14. |
| 4.8 | [x] | CA-5 permission matrix run with real tokens (`admin@demo.com`/`customer@demo.com`/`store_owner@demo.com`, all `demodemo`): 401×6 (no token), 403×6 (`customer`), 403×3 (`store_owner` on `tags`), and the **self-cleaning sentinel sequence** on `manufacturers` with `store_owner` (`POST`→201 id 43 `zz-manu-permisos` → `PUT`→200 → `DELETE`→200), confirmed `manufacturers` count back to 14. No seeded id touched with the `store_owner` token. `git diff` of both controllers confirmed empty. |
| 4.9 | [x] | `grep -n "fuse\|@db/"` on both services → 0 lines. `psql` closing counts with no test suite running: `tags`=10, `manufacturers`=14, `product_tag`=0, `products`=1200, `products.manufacturer_id IS NOT NULL`=0 — all match the required baseline exactly. |
| 4.10 | [x] | `git diff --stat packages/db/src/slug.ts packages/db/src/domain-errors.ts apps/api/rest/src/common/errors/` → empty. CA-7 intact. |
| 4.11 | [x] (build/verify only) | `just build-api` clean, `just verify` green with `shop-dev`/`admin-dev` brought up for this step and killed afterward. **Push to `main` NOT executed** — this run's explicit session instructions say "Do NOT commit, push or create branches"; left to the orchestrator/user. |

### Deviations from the design's pinned interfaces

- **None in substance for the service/DTO shape.** The 3 methods, the
  field-by-field projection, the two coercions (`Boolean()`/`Number()`),
  the sequential `listTypes()` (DD-7), the `+id` guard (DD-10), and the
  `image` boundary cast match `tags.service.ts` (this US's own commit #2
  template) and `manufacturers.service.ts`'s pinned read methods exactly.
  `manufacturers.service.spec.ts` landed at **498** lines against the
  design's own corrected anchor of "~330" for this file — the design's own
  estimate table already flagged this file as the likely overrun (same
  pattern as `tags.service.spec.ts` landing at 474 vs ~320 in commit #2),
  and it materialized again here: +168 over forecast, because the spec
  adds the **unit-level B-4 proof** (a dedicated test asserting the exact
  5-key toggle payload never projects `description`/`website`/`image`)
  that has no equivalent in `tags.service.spec.ts` (tags has no
  `is_approved`/toggle concept), plus the `type_id: null` FK-clearing case
  and a second independent `Boolean()` round-trip test.
- **`Number(record.isApproved)` line-number drift, not a behavior
  change.** The design's task 4.2 cites `manufacturers.service.ts:60` for
  this line; after removing the ~14 lines of dead `plainToClass`/`Fuse`/
  `manufacturers` array setup at the top of the file, the same line is now
  at `:53`. Confirmed byte-identical in content (`is_approved:
  Number(record.isApproved)`), only its position shifted — not a
  deviation in substance, just a consequence of the mandated removal of
  the JSON-mock scaffolding.
- **CA-3 setup used a fresh probe pair (manufacturer 40, tag 252), not the
  `oferta-verano`/`marca-prueba` ids named in the design's own procedure
  table.** By the time task 4.6 ran, the `marca-prueba` manufacturer
  created in 4.5 had already been deleted by that same task's own closing
  `DELETE` (self-cleaning, as required) and no longer existed to link.
  The design's task 4.6 anticipates this explicitly ("reuse ids from a
  fresh probe pair created for this step, not seeded rows") — this is the
  literal instruction, not a deviation from it. The design's illustrative
  procedure-table entry naming `:marca_prueba_id`/`:oferta_verano_id` is
  the same pattern applied to whichever ids the sequential run actually
  produces.
- **`just db-check` was NOT re-run in this slice.** `packages/db/` is
  untouched by commit #4 (confirmed by `git diff --stat -- packages/db/`
  returning empty), so there is no new integration-test surface to
  re-verify beyond what commits #1 and #3 already proved green
  (131/131 tests). Re-running it here would only reproduce the previously
  documented rare flake risk for no new signal; skipped to avoid
  manufacturing an unrelated red run in this commit's evidence.
- **Two extra jest tests beyond the design's literal task-4.3 list**: an
  explicit `type_id: null → typeId: null` projection test (the FK-clearing
  case, distinct from "absent" and from "malformed") and a second
  independent `Boolean()` round-trip test (`true`/`false` via
  `toHaveBeenLastCalledWith`) in addition to the coercion assertion
  embedded in the general field-projection test. Both are direct
  consequences of DD-2/DD-6's own stated cases; no test was weakened or
  removed to make room for them.
- **Pre-existing orphan process interfered with this run's own port
  check.** At the start of this slice, port 9001 was occupied by PID
  55924, a descendant of PID 18516 — one of the two orphan `nest start
  --watch` trees explicitly flagged in this run's prompt as
  "pre-existing... not bound to 9001" (as last observed in an earlier
  slice). Between that earlier observation and this run, that same watch
  loop had apparently rebuilt and re-bound to 9001. Since it blocked this
  run's own launch, the full tree (`18516` → `46616` → `55924`) was
  killed before proceeding — this is squarely within "kill anything
  blocking the port you need," not a destructive action on unrelated
  work. The *other* orphan tree (PID 600) and a third one found alongside
  it (PID 23212), neither bound to any port at any point during this run,
  were left untouched — confirmed still present and idle at the end of
  this run's own process cleanup (`Get-Process -Id 600,23212` succeeded,
  `netstat` showed no port bound to either). Reported as a risk below,
  not actioned further — out of this run's scope.
- No other deviation. `type_id` staying declared `string` on the entity
  (V-10, pre-existing inconsistency) is coerced in the service exactly as
  DD-2 specifies, not corrected.

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

✔ Generated Prisma Client (7.10.0) to .\generated\prisma\client in 170ms

CLI Building entry: index.ts
CLI Using tsconfig: tsconfig.json
CLI tsup v8.5.1
CLI Using tsup config: C:\DevOps\MyGitHub\safari-marketplace\packages\db\tsup.config.ts
CLI Target: node18
CLI Cleaning output folder
CJS Build start
CJS dist\index.js     144.50 KB
CJS dist\index.js.map 339.38 KB
CJS ⚡️ Build success in 226ms
DTS Build start
DTS ⚡️ Build success in 5952ms
DTS dist\index.d.ts 1.39 MB
```

### Real command output — `cd apps/api/rest && npx jest`

```
PASS src/tags/tags.service.spec.ts (18.164 s)
PASS src/types/types.service.spec.ts (19.094 s)
PASS src/common/errors/domain-error.mapper.spec.ts (19.284 s)
PASS src/users/user-dto.mapper.spec.ts (19.335 s)
PASS src/shops/shops.service.spec.ts (19.576 s)
PASS src/products/products.service.spec.ts (20.107 s)
PASS src/users/users.service.spec.ts (20.494 s)
PASS src/manufacturers/manufacturers.service.spec.ts (20.842 s)

Test Suites: 8 passed, 8 total
Tests:       135 passed, 135 total
Snapshots:   0 total
Time:        25.993 s
Ran all test suites.
```

Baseline was 7 suites / 112 tests. New: **8 suites / 135 tests** (+1 suite,
+23 tests) — matches the design's forecast of 8 suites, green on the
first run (no re-run needed for commit #4).

### Real command output — `just build-api`

```
$ just build-api
yarn build
yarn run v1.22.22
$ rimraf dist
$ nest build
(node:37296) [DEP0053] DeprecationWarning: The `util.isObject` API is deprecated. ...
Done in 26.12s.
```

Clean, no TypeScript errors.

### Real command output — `grep -n "fuse\|@db/" apps/api/rest/src/manufacturers/manufacturers.service.ts`

```
$ grep -n "fuse\|@db/" apps/api/rest/src/manufacturers/manufacturers.service.ts; echo "EXIT=$?"
EXIT=1
```

`EXIT=1` from `grep` means no match — 0 lines, as required.

### Real command output — port check and cleanup before launch (task 4.5 preamble)

```
$ netstat -ano | grep -E ":9001 |:3002 |:3003 " | grep LISTENING
  TCP    0.0.0.0:9001           0.0.0.0:0              LISTENING       55924
  TCP    [::]:9001              [::]:0                 LISTENING       55924
```

PID 55924 traced to a descendant of PID 18516 (one of the two orphan
`nest start --watch` trees flagged in this run's prompt as "not bound to
9001" as of an earlier slice — evidently it rebuilt and rebound since
then). Killed the whole tree:

```
$ taskkill /PID 18516 /T /F
SUCCESS: The process with PID 55924 (child process of PID 46616) has been terminated.
SUCCESS: The process with PID 46616 (child process of PID 18516) has been terminated.
SUCCESS: The process with PID 18516 (child process of PID 44144) has been terminated.
```

Port confirmed free before launch. See Deviations above.

### Real command output — `curl`/`psql` sequence (task 4.5, CA-1/CA-2 manufacturers)

Token obtained via `POST /api/token` with the seeded `admin@demo.com` /
`demodemo` credentials, role `super_admin`.

```
== POST /api/manufacturers ==
$ curl -X POST http://localhost:9001/api/manufacturers -H "Authorization: Bearer $TOKEN" \
    -d '{"name":"Marca Prueba","type_id":9,"is_approved":true,"description":"desc-sonda","website":"https://sonda.test","image":{"id":1,"original":"o","thumbnail":"t"},"socials":[{"icon":"x","url":"y"}],"cover_image":{"id":1},"language":"es"}'
{"id":39,"name":"Marca Prueba","slug":"marca-prueba","language":"en","translated_languages":["en"],
 "products_count":0,"is_approved":1,"description":"desc-sonda","website":"https://sonda.test",
 "socials":[],"image":{"id":1,"original":"o","thumbnail":"t"},"cover_image":null,
 "type":{"id":9,"name":"Gadget","slug":"gadget","logo":null}}
HTTP 201
```

`Object.keys()` via `node -e` (no `.sort()`): **13 keys exactly** —
`["id","name","slug","language","translated_languages","products_count","is_approved","description","website","socials","image","cover_image","type"]`.
`socials:[]`, `cover_image:null`, `is_approved:1` — matches the read
projection's constants (B-3-equivalent for manufacturers, V-1/V-2/V-3).

```
== GET /api/manufacturers/marca-prueba (before restart) ==
{"id":39, ... same 13 keys ...}
HTTP 200
```

**Real API restart #1** — full process tree killed (`yarn start:dev` →
`nest start --watch` → the node process bound to port 9001, via
`taskkill /PID 26008 /T /F`), confirmed port free, then `yarn start:dev`
relaunched and polled until `GET /api/manufacturers` answered 200 again
(6 tries):

```
== GET /api/manufacturers/marca-prueba (after restart) ==
{"id":39, ... same 13 keys ...}
HTTP 200
```

The row survives the restart — proof of a real Postgres write, not the
in-memory `this.manufacturers.find(...)` mutation the old stub did.

```
== psql BEFORE PUT ==
 id |     name     | is_approved | description |      website       |                    image                     |         updated_at
----+--------------+-------------+-------------+--------------------+----------------------------------------------+----------------------------
 39 | Marca Prueba | t           | desc-sonda  | https://sonda.test | {"id": 1, "original": "o", "thumbnail": "t"} | 2026-09-10 16:21:42.856+00

== PUT /api/manufacturers/39  {"name":"Marca Prueba","is_approved":false,"type_id":9,"language":"es"} ==
{"id":39,"name":"Marca Prueba","slug":"marca-prueba","language":"en","translated_languages":["en"],
 "products_count":0,"is_approved":0,"description":"desc-sonda","website":"https://sonda.test",
 "socials":[],"image":{"id":1,"original":"o","thumbnail":"t"},"cover_image":null,
 "type":{"id":9,"name":"Gadget","slug":"gadget","logo":null}}
HTTP 200

== psql AFTER PUT (B-4 proof) ==
 id |     name     | is_approved | description |      website       |                    image                     |         updated_at
----+--------------+-------------+-------------+--------------------+----------------------------------------------+----------------------------
 39 | Marca Prueba | f           | desc-sonda  | https://sonda.test | {"id": 1, "original": "o", "thumbnail": "t"} | 2026-09-10 16:23:01.769+00
```

**The central evidence of this US.** The `PUT` sent the exact 5-key
toggle body (`manufacturer-list.tsx:134-142`): `name`, `is_approved`,
`type_id`, `language` (`id` is the URL param). `description`, `website`
and `image` are **intact** in the column, not `NULL` — direct proof that
the service's conditional-spread projection (B-4) never turned "absent
from the DTO" into "explicit `null`" at the repository boundary.
`updated_at` advanced from `16:21:42.856+00` to `16:23:01.769+00`,
measured in the column via `psql`, never via `curl` (V-6 — the response
carries no timestamp keys).

**Real API restart #2 (mid-sequence)** — killed the full tree again
(`nest.js start --watch` chain, `taskkill /PID 49300 /T /F`), confirmed
port free, relaunched, polled until 200 (6 tries):

```
== GET /api/manufacturers/marca-prueba (after mid-sequence restart) ==
{"id":39,"name":"Marca Prueba","slug":"marca-prueba","language":"en","translated_languages":["en"],
 "products_count":0,"is_approved":0,"description":"desc-sonda","website":"https://sonda.test",
 "socials":[],"image":{"id":1,"original":"o","thumbnail":"t"},"cover_image":null,
 "type":{"id":9,"name":"Gadget","slug":"gadget","logo":null}}
HTTP 200
```

`is_approved:0` survived the restart — **this is the exact bug CA-2
exists to close** (the old `manufacturers.service.ts:171-178` mutated an
in-memory array and lost the toggle on every restart).

```
== DELETE /api/manufacturers/39 ==
{"id":39, ... same 13 keys, is_approved:0 ...}
HTTP 200

== GET /api/manufacturers/marca-prueba (after delete) ==
{"statusCode":404,"message":"No existe una marca con slug `marca-prueba`.","error":"Not Found"}
HTTP 404
```

Same 13 keys on the `DELETE` response as the create/read projection
(verified via `node -e`, `Object.keys()`, no `.sort()`). Sequence
self-cleaned via its own `DELETE`.

### Real command output — CA-3 setup (task 4.6, labelled setup not behavior)

Fresh probe pair created via `POST` for this step (not seeded rows):

```
== POST probe manufacturer ==
{"id":40,"name":"Zz Manu CA3","slug":"zz-manu-ca3", ...}  HTTP 201
== POST probe tag ==
{"id":252,"name":"Zz Tag CA3","slug":"zz-tag-ca3", ...}  HTTP 201

== psql setup: link product 1 to manufacturer 40, product 2 to tag 252 ==
$ docker exec safari-postgres psql -U safari -d safari_scraper \
    -c "UPDATE products SET manufacturer_id = 40 WHERE id = 1;" \
    -c "INSERT INTO product_tag (product_id, tag_id) VALUES (2, 252);"
UPDATE 1
INSERT 0 1

== sanity before delete ==
 count(products) = 1200 | count(product_tag) = 1 | products.manufacturer_id (id=1) = 40

== curl DELETE /api/manufacturers/40 == HTTP 200
== curl DELETE /api/tags/252 == HTTP 200

== psql closing counts (CA-3) ==
 count(products) = 1200
 products.manufacturer_id (id=1) = NULL   (SET NULL, no psql needed to restore)
 count(product_tag) = 0                    (CASCADE toward tags, no manual delete needed)
```

Matches the design's stated self-undo exactly: the `SET NULL`/`CASCADE`
restore the seeded state automatically once the probes are deleted.

### Real command output — CA-4 full battery (task 4.7)

```
== PUT /api/tags/99999 ==            {"statusCode":404,"message":"No existe un registro de `tags` con id 99999.", ...}  HTTP 404
== DELETE /api/tags/99999 ==         {"statusCode":404,"message":"No existe un registro de `tags` con id 99999.", ...}  HTTP 404
== PUT /api/manufacturers/99999 ==   {"statusCode":404,"message":"No existe un registro de `manufacturers` con id 99999.", ...}  HTTP 404
== DELETE /api/manufacturers/99999 =={"statusCode":404,"message":"No existe un registro de `manufacturers` con id 99999.", ...}  HTTP 404
== PUT /api/tags/abc (NaN) ==        {"statusCode":404,"message":"No existe un tag con id NaN.", ...}  HTTP 404

== POST /api/tags {} ==              {"statusCode":400,"message":["name should not be empty","name must be a string"], ...}  HTTP 400
== POST /api/manufacturers {} ==     {"statusCode":400,"message":["name should not be empty","name must be a string"], ...}  HTTP 400
== POST /api/tags {"name":""} ==     {"statusCode":400,"message":["name should not be empty"], ...}  HTTP 400
== POST /api/manufacturers {"name":""} == {"statusCode":400,"message":["name should not be empty"], ...}  HTTP 400
== POST /api/tags {"name":"!!!"} ==  {"statusCode":400,"message":"El texto `!!!` de `tags` normaliza a un slug vacío.", ...}  HTTP 400
== POST /api/manufacturers {"name":"!!!"} == {"statusCode":400,"message":"El texto `!!!` de `manufacturers` normaliza a un slug vacío.", ...}  HTTP 400

== PUT /api/tags/53 {"name":""} ==   {"statusCode":400,"message":["name should not be empty"], ...}  HTTP 400
   psql after: id=53, name="Infant Formula" — row intact, unchanged
== PUT /api/manufacturers/1 {"name":""} == {"statusCode":400,"message":["name should not be empty"], ...}  HTTP 400
   psql after: id=1, name="Too cool publication" — row intact, unchanged

== POST /api/tags {"name":"X","type_id":99999} ==
   {"statusCode":400,"message":"`tags.desconocida` referencia un registro inexistente.","error":"Bad Request"}  HTTP 400
   (message differs from the one recorded in task 2.5's evidence —
    `` `tags.slug` referencia un registro inexistente. `` — because commit
    #2 (`d6cf840`) applied the S-1 remedy to `tags.repository.ts` AFTER
    that evidence was captured, in the same commit; this is the CURRENT,
    post-remedy literal message, re-verified here since packages/db/ was
    not touched in this run)
== POST /api/manufacturers {"name":"X","type_id":99999} ==
   {"statusCode":400,"message":"`manufacturers.desconocida` referencia un registro inexistente.","error":"Bad Request"}  HTTP 400
   psql: SELECT count(*) FROM manufacturers WHERE name='X' → 0 (no row created)

== collision, literally as spec.md:87-90 writes it ==
POST /api/tags {"name":"Oferta"}   (1st) → 201 id=254 slug="oferta"
POST /api/tags {"name":"Oferta"}   (2nd) → 201 id=255 slug="oferta-2"
POST /api/manufacturers {"name":"Medicure"} (seeded `medicure` id 18 exists) → 201 id=42 slug="medicure-2"

== stack-trace check (N-5) ==
$ grep -cE '^\s+at ' api-dev-4.log
0
```

Cleanup by returned id, never `id > N`:

```
$ docker exec safari-postgres psql -U safari -d safari_scraper \
    -c "DELETE FROM tags WHERE id IN (254, 255);" \
    -c "DELETE FROM manufacturers WHERE id = 42;"
DELETE 2
DELETE 1

$ docker exec safari-postgres psql -U safari -d safari_scraper -c "SELECT count(*) FROM tags;" -c "SELECT count(*) FROM manufacturers;"
 count = 10
 count = 14
```

### Real command output — CA-5 permission matrix (task 4.8)

Tokens obtained via `POST /api/token` for `admin@demo.com` (super_admin,
reused from 4.5), `customer@demo.com`, `store_owner@demo.com`, all
`demodemo`.

```
== 401: no token, 6 routes ==
POST /api/tags: 401 | PUT /api/tags/1: 401 | DELETE /api/tags/1: 401
POST /api/manufacturers: 401 | PUT /api/manufacturers/1: 401 | DELETE /api/manufacturers/1: 401

== 403: customer, 6 routes ==
POST /api/tags: 403 | PUT /api/tags/1: 403 | DELETE /api/tags/1: 403
POST /api/manufacturers: 403 | PUT /api/manufacturers/1: 403 | DELETE /api/manufacturers/1: 403

== 403: store_owner on tags, 3 routes (ADMIN_ONLY) ==
POST /api/tags: 403 | PUT /api/tags/1: 403 | DELETE /api/tags/1: 403

== store_owner on manufacturers — self-cleaning sentinel sequence ==
POST /api/manufacturers {"name":"Zz Manu Permisos","description":"sonda-permisos"}
  → {"id":43,"name":"Zz Manu Permisos","slug":"zz-manu-permisos", ...}  HTTP 201
PUT /api/manufacturers/43 {"name":"Zz Manu Permisos","description":"sonda-permisos-editada"}
  → {"id":43, ..., "description":"sonda-permisos-editada", ...}  HTTP 200
DELETE /api/manufacturers/43
  → {"id":43, ...}  HTTP 200

$ docker exec safari-postgres psql -U safari -d safari_scraper -c "SELECT count(*) FROM manufacturers;"
 count = 14
```

No seeded id was ever touched with the `store_owner` token — only id 43,
created and destroyed by this same sequence.

```
$ git diff --stat -- apps/api/rest/src/tags/tags.controller.ts apps/api/rest/src/manufacturers/manufacturers.controller.ts
(empty output)
```

### Real command output — CA-6 and CA-7 (tasks 4.9, 4.10)

```
$ grep -n "fuse\|@db/" apps/api/rest/src/tags/tags.service.ts apps/api/rest/src/manufacturers/manufacturers.service.ts; echo "EXIT=$?"
EXIT=1

$ docker exec safari-postgres psql -U safari -d safari_scraper \
    -c "SELECT count(*) FROM tags;" -c "SELECT count(*) FROM manufacturers;" \
    -c "SELECT count(*) FROM product_tag;" -c "SELECT count(*) FROM products;" \
    -c "SELECT count(*) FROM products WHERE manufacturer_id IS NOT NULL;"
 tags = 10 | manufacturers = 14 | product_tag = 0 | products = 1200 | products.manufacturer_id IS NOT NULL = 0
```

All five counts match the measured-today baseline in design.md's
*Procedimiento de evidencia* exactly — no residue from any probe in this
run's entire evidence sequence.

```
$ git diff --stat packages/db/src/slug.ts packages/db/src/domain-errors.ts apps/api/rest/src/common/errors/; echo "EXIT=$?"
EXIT=0
(empty output)
```

CA-7 confirmed intact.

### Real command output — `just verify` (task 4.11)

`shop-dev` and `admin-dev` brought up for this step only (both up within
6 seconds of launch), then `just verify` run with all three services live:

```
$ just verify
OK   API    :9001/api/settings  200  5503B  11ms
OK   Shop   :3003/en  200  190788B  519ms  cards:30
OK   Admin  :3002/en/login  200  72821B  45ms  cards:1
```

All three green. `shop-dev`/`admin-dev`/`api-dev` process trees fully
killed immediately after (see *Process cleanup* below) — this run does
not leave any dev server running as a side effect of gathering this
evidence.

### `git diff --numstat` vs the ~495-line forecast (commit #4)

```
$ git diff --numstat -- apps/api/rest/src/manufacturers/dto/create-manufacturer.dto.ts apps/api/rest/src/manufacturers/manufacturers.service.ts
39      6       apps/api/rest/src/manufacturers/dto/create-manufacturer.dto.ts
109     31      apps/api/rest/src/manufacturers/manufacturers.service.ts
$ wc -l apps/api/rest/src/manufacturers/manufacturers.service.spec.ts
498
```

Totals: **39 + 109 + 498 = 646 added**, 37 deleted (683 changed) vs the
design's forecast for commit #4 of ~495 added (+~25 deleted). Breakdown:

| File | Forecast (added) | Actual (added) | Delta |
|---|---|---|---|
| `create-manufacturer.dto.ts` | ~30 | 39 | +9 (header comment explaining the `OmitType`/`PickType` divergence vs `create-tag.dto.ts` and the `N-9` timestamp omission) |
| `manufacturers.service.ts` | ~135 | 109 | −26 (the field-by-field projection reuses the exact `tags.service.ts` shape with 2 extra coercion branches, but the header docblock is more compact than the design's own per-area slack budgeted) |
| `manufacturers.service.spec.ts` | ~330 | 498 | +168 (the dedicated B-4 unit proof on the exact toggle payload, the `type_id: null` case, and a second independent `Boolean()` round-trip test — none of which exist in `tags.service.spec.ts`'s template since `tags` has no `is_approved`/toggle concept) |

Net over forecast: **+151 lines** (~30% over), concentrated almost
entirely in the jest spec — same pattern as every other commit in this
delivery (commit #1 +31, commit #2 +124, commit #3 +49), and consistent
with the design's own repeated warning that the `*.service.spec.ts` files
are the most under-forecast material, always in the lowest-review-cost
direction (test code, not production code).

### Forbidden files — untouched

```
$ git diff --stat -- packages/db/src/slug.ts packages/db/src/domain-errors.ts apps/api/rest/src/common/errors/
(empty output)
$ git diff --stat -- packages/db/
(empty output)
$ git diff --stat -- apps/api/rest/src/manufacturers/entities/manufacturer.entity.ts apps/api/rest/src/manufacturers/dto/update-manufacturer.dto.ts apps/api/rest/src/manufacturers/manufacturers.controller.ts apps/api/rest/src/tags/tags.controller.ts apps/api/rest/src/tags/tags.service.ts apps/api/rest/src/tags/dto/create-tag.dto.ts apps/api/rest/src/main.ts db/schema.sql db/seed.sql
(empty output)
$ git diff --stat -- apps/shop apps/admin docs/product openspec/changes/escrituras-tags-manufacturers/state.yaml openspec/changes/escrituras-tags-manufacturers/proposal.md openspec/changes/escrituras-tags-manufacturers/specs openspec/changes/escrituras-tags-manufacturers/design.md
(empty output)
```

Confirms CA-7 intact and the full "unchanged" list from design.md's *File
Changes* table holds: `packages/db/**` (all three commits' worth,
untouched this run), the tags controller/service/DTO from commit #2, the
manufacturers entity/update-dto/controller, `main.ts`, `db/schema.sql`,
`db/seed.sql`, `apps/shop/**`, `apps/admin/**`, and every fixed-plan SDD
artifact (`state.yaml`, `proposal.md`, `specs/`, `design.md`).

### `git status` — full picture at the end of this run

```
$ git status --porcelain
 M apps/api/rest/src/manufacturers/dto/create-manufacturer.dto.ts
 M apps/api/rest/src/manufacturers/manufacturers.service.ts
?? apps/api/rest/src/manufacturers/manufacturers.service.spec.ts
```

Exactly the 3 files this slice's task list allowed, plus (once this write
completes) `tasks.md` and `apply-progress.md`. No other file has a diff.
Three scratch log files (`admin-dev-4.log`, `api-dev-4.log`,
`shop-dev-4.log`) were created at the repo root during this run purely to
capture `curl`/`grep` evidence in real time — they were **deleted before
this final `git status`** and never appear in it; nothing was ever staged
or committed.

### Process cleanup

Every process tree launched by this run was killed by its end:

- `yarn start:dev` → `nest start --watch` → node (port 9001): launched
  three times across this run (restart #1, restart #2, and the final
  relaunch used through 4.6-4.11), killed each time via `taskkill /PID
  <top-of-tree> /T /F`, confirmed by `netstat` showing the port free
  before each next action.
- `yarn dev:rest` (shop, port 3003) and `yarn dev` (admin, port 3002):
  launched once for task 4.11's `just verify`, killed immediately after
  via `taskkill /PID <yarn.js pid> /T /F` on each of the three chains
  (api/shop/admin).
- Final check: `netstat -ano | grep -E ":9001 |:3002 |:3003 " | grep
  LISTENING` → empty output. All three target ports confirmed free.
- **Not touched, per this run's explicit scope**: the two pre-existing
  orphan trees at PIDs 600 and 23212 (neither bound to any port at any
  point observed in this run) — see Deviations above. PID 18516's tree
  *was* killed, because by the time this run started it had rebound to
  port 9001 and was blocking this run's own launch; it was not one of
  "this run's own processes" in the sense of being started here, but it
  had to be cleared to proceed, and clearing a process that is actively
  occupying a port this run needs is squarely inside the DoD's "check the
  port before launching" instruction, not a destructive action against
  unrelated work.

### Final DB state (closing counts, all target ports free, `just db-check` idle)

```
tags                 10   (unchanged from commit #1's baseline)
manufacturers         14   (unchanged from commit #3's baseline)
product_tag            0
products             1200
products.manufacturer_id IS NOT NULL   0
```

No residue from any probe created across this entire 4-commit delivery.
