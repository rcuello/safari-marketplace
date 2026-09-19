# Apply Progress: become-seller-contrato-tipos (US-45)

**Mode**: Standard (`strict_tdd: false`). **Delivery**: single-pr,
`size:exception` granted by the project owner. **Branch**:
`us-45-become-seller-contrato-tipos` (created off `main`, not committed —
left in the working tree for the owner to review/commit).

No prior apply batch existed; this is the first (and only) batch. All 32
tasks across 7 phases are complete.

## Completed Tasks

All tasks in `tasks.md` are marked `[x]` (Fase 0 through Fase 6, 32/32).

## Files Changed

| File | Action | What Was Done |
|---|---|---|
| `apps/api/rest/src/become-seller/entities/become-seller.entity.ts` | Modified | Full rewrite: 13 classes (7 new, 4 modified, 1 unchanged shape, 1 rewritten). Removed the orphaned `class-transformer` import. `CommissionItem` interface → class (`id: number`, `max_balance: string`, no `CoreEntity`). `BecomeSellerOptions` grew 12 → 24 keys. New `BecomeSellerEnvelope extends CoreEntity`. `BecomeSeller` no longer extends `CoreEntity`; top level is exactly `page_options`/`commissions`. Single `@ApiProperty({ type: String, nullable: true })` on `BecomeSellerGuidelineItem.link` (D-7). All new classes carry the `BecomeSeller` prefix (D-9, avoids the `Banner` collision with `types/entities/type.entity.ts:16`). |
| `apps/api/rest/src/become-seller/dto/create-become-seller.dto.ts` | Modified | Replaced `OmitType(BecomeSeller, …)` with a hand-written class: `{ language?, page_options: BecomeSellerOptions, commissions: CommissionItem[] }`, importing both classes from the entity. |
| `apps/api/rest/src/become-seller/become-seller.service.ts` | Modified | Removed `BecomeSellerWriteBody` and both `as unknown as`. Added 3 module-level type guards (`_isBecomeSellerOptions`, `_isCommissionList`, `_isJsonPayload` — the gatekeeper's 2-guard collapse for writes, not the design's original 4). `create()` reads `dto.page_options`/`dto.commissions`/`dto.language` directly from the typed DTO; the conditional spread uses `_isJsonPayload` to narrow before calling `updateBecomeSeller`. `_toEnvelope()` adds a read guard (`InternalServerErrorException`, same class as the missing-row guard) and returns its literal with **zero casts**. Rewrote the `:12-23` docblock to describe the `jsonb` boundary without repeating the forbidden phrase. |
| `apps/api/rest/src/become-seller/become-seller.service.spec.ts` | Modified | Removed `createDto()` and the `as never as` casts; `create()` tests now build fixtures from `@db/become-seller.json` (D-11, compiles without cast). Added the D-10 net: `KeyDrift`/`AssertSameKeys` types + 4 `const` assertions (`_topLevelKeys`, `_envelopeKeys`, `_optionKeys`, `_dtoKeys`), plus an `it()` pinning the 24 real key names via `Object.keys(...)`. `makeRecord()` unchanged (D-11). |
| `apps/api/rest/src/become-seller/dto/update-become-seller.dto.ts` | Unchanged | Confirmed it compiles (`PartialType(CreateBecomeSellerDto)` needed zero edits). |
| `openspec/changes/become-seller-contrato-tipos/tasks.md` | Modified | All 32 tasks marked `[x]`. |
| `openspec/changes/become-seller-contrato-tipos/apply-progress.md` | Created | This file. |
| `openspec/changes/become-seller-contrato-tipos/state.yaml` | Modified | `apply` block updated (see below). |
| `docs/product/45-entidad-become-seller-desalineada.md` | Modified | `Status: Implementada`, real LOC added, DoD checklist all `[x]`. |

## Deviations from Design

- **Guard count**: 3 guards, not the design's original 4 — the gatekeeper's
  collapse (both write guards fused into one `_isJsonPayload`) was already
  recorded in `state.yaml`/`design.md`'s gatekeeper section and `tasks.md`
  3.2; implemented as specified there, not as the earlier design.md draft.
- **D-7 contingency not needed**: the `@ApiProperty({ type: String,
  nullable: true })` decorator worked as expected after `just build-api` —
  `/docs-json` shows `link: { type: "string", nullable: true }`. The
  documented fallback (retract the decorator) was not exercised.
- **CA-1 grep discrepancy (found during apply, not anticipated by
  design/tasks)**: `grep -rn missions apps/api/rest/src/become-seller/`
  (the literal command in both `spec.md`'s R1 scenario and the US's DoD)
  can **never** return empty once the code correctly uses `commissions`,
  because `missions` is a substring of `commissions`
  (**com**+**missions**). This is not a defect introduced by this change —
  it is a property of the two words. Verified with a word-boundary grep
  instead (`grep -rnw missions apps/api/rest/src/become-seller/` → empty,
  confirmed no field is literally named `missions`). Flagging this
  explicitly rather than silently reinterpreting the DoD's command; see the
  Evidence section below for both grep outputs side by side.

## Runtime Delta — Mandatory Disclosure (owner-accepted, not silently shipped)

> **CORRECTED in the corrective batch below** (an independent gatekeeper
> found this version over-broad and incomplete — see "Corrective Batch —
> Defect 2" for the finding). The text in this section is the FINAL,
> accurate version; the original first-batch wording it replaces is quoted
> verbatim in the corrective-batch section for the audit trail.

Per the design (D-8): the write and read guards each cross the `jsonb`
boundary with a real runtime shape check instead of a type escape. Their
effect on malformed input is **two separate deltas**, in opposite
directions, relative to the code on `main` before this whole US:

1. **Write path (`create()`)** — before this US, the DTO was blindly
   forwarded to Prisma via `as unknown as`, with no shape check at all:
   - `page_options: null` (or `commissions: null`) reached Prisma as a
     literal JSON `null`, which the Prisma client **rejects** for a `Json`
     column write (it expects the `Prisma.JsonNull` sentinel, not a raw
     `null`) → `500 Internal Server Error`.
   - Any other wrong-shaped-but-valid `Prisma.InputJsonValue` (e.g.
     `page_options: "texto"`, or — the defect this corrective batch fixes —
     `commissions` sent as a plain object) is **not** rejected by Prisma:
     it is a legal JSON scalar/object and gets persisted as-is → **201
     with a silently corrupted row**, not a 500.

   After this change, both write guards (`_isBecomeSellerOptions`,
   `_isCommissionList`) check the **container kind** of each field —
   object-and-not-array / array, respectively — which is the same
   condition the read path enforces, and nothing beyond it. A `null`, a
   string, or a value of the wrong kind for either field now fails the
   guard and its key is **silently omitted** from the
   `updateBecomeSeller` call instead of reaching Prisma: the row keeps
   whatever it already had for that field, and the `POST` still answers
   **201** (no new 4xx, no `class-validator`).

   Net effect, stated precisely: the `null`-500 is gone, and a value of
   the wrong *kind* can no longer be written for either field — which is
   exactly what closes the permanent-500 asymmetry, because a row can now
   only be written in a shape the read path accepts. It does **not**
   follow that the row can no longer be corrupted on write. The guards do
   not inspect the 24 keys, so `page_options: {}` or `{"foo":"bar"}`, and
   `commissions: []` or `[1,2,3]`, still pass the guard, persist, and read
   back as **200 with a structurally valid but semantically empty body**.
   Closing that gap needs runtime validation of the 24 keys, which the
   US's "NO incluye" forbids (candidate sibling US, alongside
   `settings.service.ts:39`).

   > Precision correction applied by the orchestrator after `sdd-verify`,
   > before archiving. The wording it replaces claimed the write guards
   > "require the exact runtime shape" and that "a malformed value can no
   > longer silently corrupt the row on write, for either field". Both
   > were over-broad: they are true for the wrong *kind* of value, false
   > for a right-kind-but-empty one (`{}`, `[]`). The owner ratified this
   > disclosure on condition that it is accurate, so the claim is narrowed
   > here rather than left to the reader to discover from the code.

2. **Read path (`_toEnvelope()`)** — the opposite direction, and the one
   the first apply batch under-disclosed. Before this US, `_toEnvelope()`
   had no shape check either (`as unknown as BecomeSeller` on the return
   literal): a row already holding a wrong-shaped `page_options`/
   `commissions` (however it got there) rendered as **200 with garbage**
   on every `GET`. After this change, `_toEnvelope()` throws
   `InternalServerErrorException` (`'La fila de become_seller tiene
   page_options/commissions con forma inesperada.'`) for the same
   wrong-shaped row — **500 instead of 200-with-garbage**, and, absent a
   manual `UPDATE`, permanently on every subsequent `GET`/`POST` until the
   row is fixed by hand. No such row exists in this environment today (the
   live row was verified byte-identical to the mock throughout this US,
   before and after every write performed in this batch and the
   corrective one), so this direction is a disclosed behavioral change for
   a hypothetical already-corrupted row, not something exercised against
   real data here.

This was flagged to the owner as part of the chain parameters and
**accepted with mandatory disclosure**: neither direction is a
validated/ratified product decision, only documented side effects of
closing the `jsonb` type-safety gap. No alternative that preserves the old
`500`-on-`null` behavior without reintroducing a type escape was found (3
lighter escapes were already ruled out at design time — see D-8 in
`design.md`); no alternative to the read-side 500 was sought, since
failing loudly on a corrupted row is preferable to serving it silently.

## Issues Found

None beyond the CA-1 grep discrepancy above (not a code defect, a DoD
wording issue).

## Evidence

### Fase 0 — Baseline ("antes")

```
$ curl -s -o /dev/null -w "size_download=%{size_download}\n" http://localhost:9001/api/became-seller
size_download=11452

$ curl -s http://localhost:9001/docs-json | wc -c
170326
```

`/docs-json` before (`node -e`, no `jq`):
```
post body props: [ 'id', 'page_options', 'language', 'missions' ] required: [ 'id', 'page_options', 'language', 'missions' ]
post 201 top props: [ 'page_options', 'language', 'missions', 'id', 'created_at', 'updated_at' ]
get 200 top props: [ 'page_options', 'language', 'missions', 'id', 'created_at', 'updated_at' ]
BecomeSellerOptions props (12): [ 'banner','sellingStepsTitle','sellingStepsDescription','sellingStepsItem','purposeTitle','purposeDescription','purposeItems','commissionTitle','commissionDescription','faqTitle','faqDescription','faqItems' ]
banner: {"$ref":"#/components/schemas/Attachment"}
Attachment props: [ 'thumbnail', 'original', 'id', 'created_at', 'updated_at' ] required: [ 'id', 'created_at', 'updated_at' ]
BecomeSeller.missions: {"type":"array","items":{"type":"object"}}
```

Baseline gates (measured this session, before any edit):
- `npx jest` (`apps/api/rest`): **10 suites / 290 tests**, green (179.4s).
- `just db-check`: **12 files / 228 tests**, green (measured after edits —
  identical to `exploration.md`'s baseline; see below).
- API and Postgres (`safari-postgres`) were already up from a prior
  session.

### Fase 5.1 — `/docs-json` after (API restarted post-`build-api`, see below)

```
POST requestBody props: [ 'language', 'page_options', 'commissions' ] required: [ 'page_options', 'commissions' ]
inner page_options props count: 24
inner page_options props: [ 'defaultCommissionRate','defaultCommissionDetails','banner','sellingStepsTitle','sellingStepsDescription','sellingStepsItem','userStoryTitle','userStoryDescription','purposeTitle','purposeDescription','purposeItems','commissionTitle','commissionDescription','isMultiCommissionRate','dashboard','guidelineTitle','guidelineDescription','guidelineItems','faqTitle','faqDescription','faqItems','contact','sellerOpportunity','userStories' ]
POST 201 top props: [ 'page_options', 'commissions' ]
201 page_options (envelope) props: [ 'page_options', 'language', 'id', 'created_at', 'updated_at' ]
GET 200 top props: [ 'page_options', 'commissions' ]
200 page_options (envelope) props: [ 'page_options', 'language', 'id', 'created_at', 'updated_at' ]
banner props (9): [ 'newsTickerTitle','newsTickerURL','title','description','button1Name','button1Link','button2Name','button2Link','image' ]
banner ref name is NOT Attachment: #/components/schemas/BecomeSellerBanner
CommissionItem.max_balance: {"type":"string"}
guidelineItem.link: {"type":"string","nullable":true}
--- collateral D-9 check ---
global Banner props (4): [ 'id', 'title', 'description', 'image' ]
Type.banners still $ref Banner: {"type":"array","items":{"$ref":"#/components/schemas/Banner"}}
```

Every CA-2 assertion holds; the D-9 collateral check confirms `Banner`
(the pre-existing global schema) and `Type.banners`' `$ref` are untouched.

**How freshness of `/docs-json` was guaranteed**: a stale `yarn start:dev`
process (PID from an earlier session) was still listening on `:9001`
serving code compiled before this change. It was killed
(`taskkill //F //PID <pid>`), `just build-api` was run to green
(`nest build`, 141.58s — the only place the Swagger CLI plugin runs), and
the API was restarted fresh with `just api-dev`. Only after the fresh
process logged `Nest application successfully started` was `/docs-json`
captured. This guarantees the captured document reflects the rebuilt
entity/DTO, not the stale in-memory metadata from the prior process.

### Fase 5.2 — Closing greps

```
$ grep -n "as unknown as\|as any\|ts-ignore\|ts-expect-error" apps/api/rest/src/become-seller/become-seller.service.ts
(empty — exit 1)

$ grep -rn missions apps/api/rest/src/become-seller/
apps/api/rest/src/become-seller/become-seller.service.spec.ts:50:    commissions: [{ level: 'bronze' }, { level: 'silver' }],
apps/api/rest/src/become-seller/become-seller.service.spec.ts:67:    commissions: becomeSellerJson.commissions,
... (all matches are legitimate occurrences of the word "commissions",
     which contains "missions" as a substring — see the "Deviations"
     section above)

$ grep -rnw missions apps/api/rest/src/become-seller/
(empty — exit 1: no standalone field literally named "missions")
```

### Fase 5.3 — CA-3 red/green (DTO sabotage: `commissions` → `missions`)

Red (real `tsc` output via `ts-jest`, no `isolatedModules`):
```
src/become-seller/become-seller.service.spec.ts:67:5 - error TS2322: Type '{ language: string; page_options: {...}; commissions: {...}[]; }' is not assignable to type 'CreateBecomeSellerDto'.
  Object literal may only specify known properties, but 'commissions' does not exist in type 'CreateBecomeSellerDto'. Did you mean to write 'missions'?

src/become-seller/become-seller.service.spec.ts:88:7 - error TS2322: Type 'true' is not assignable to type 'KeyDrift<CreateBecomeSellerDto, "commissions" | "language" | "page_options">'.

src/become-seller/become-seller.service.spec.ts:185:24 - error TS2551: Property 'commissions' does not exist on type 'CreateBecomeSellerDto'. Did you mean 'missions'?
src/become-seller/become-seller.service.spec.ts:222:24 - error TS2551: Property 'commissions' does not exist on type 'CreateBecomeSellerDto'. Did you mean 'missions'?

Test Suites: 1 failed, 1 total
```

Restored, green:
```
PASS src/become-seller/become-seller.service.spec.ts (15.637 s)
  BecomeSellerService — red de tipos del contrato interno (CA-3 / D-10)
    √ las 24 claves del objeto interno siguen presentes en el dato real, en el orden declarado
    √ las aserciones de tipo `AssertSameKeys` compilan en verde
  BecomeSellerService.findAll (US-44/US-45)
    √ recompone el envoltorio (D-2) ...
    √ `getBecomeSeller` resolviendo `null` → 500
  BecomeSellerService.create (US-44, D-4)
    √ delega en `updateBecomeSeller` con las 3 claves tal cual ...
    √ `updateBecomeSeller` resolviendo `null` → 500
    √ sin `language` en el body, el input NO lleva esa clave ...

Test Suites: 1 passed, 1 total
Tests:       7 passed, 7 total
```

### Fase 5.4 — `GET` after, `deepStrictEqual`

```
$ curl -s -o /dev/null -w "size_download=%{size_download}\n" http://localhost:9001/api/became-seller
size_download=11452

$ node -e '... assert.deepStrictEqual(stripTimestamps(antes), stripTimestamps(despues)) ...'
deepStrictEqual OK (excluyendo created_at/updated_at del envoltorio)
antes  created_at/updated_at: 2026-09-15T17:41:00.858Z 2026-09-15T17:41:00.858Z
despues created_at/updated_at: 2026-09-15T17:41:00.858Z 2026-09-15T17:41:00.858Z
```

(Timestamps happened to be identical in this run because no write had
occurred between the two `GET`s at that point — the 5.4 capture ran
before the 5.5 `POST`.)

### Fase 5.5 — `POST` with the admin's real body, restore

```
$ curl -s -X POST http://localhost:9001/api/became-seller -H "Content-Type: application/json" --data-binary @post-body.json -w "HTTP %{http_code}\n"
HTTP 201
top keys: [ 'page_options', 'commissions' ]
page_options keys: [ 'id', 'page_options', 'language', 'created_at', 'updated_at' ]
updated_at: 2026-09-18T17:27:33.863Z

$ node -e '... assert.deepStrictEqual(postResponse, subsequentGet) ...'
GET posterior al POST refleja exactamente la respuesta del POST: OK
```

Restoration (`psql`, US-44 CA-2 pattern — dumped the row with
`row_to_json` before the `POST`, restored with an `UPDATE ... WHERE id=1`
using the exact original `page_options`/`commissions`/`language`/
`created_at`/`updated_at`):

```
$ docker exec safari-postgres psql -U safari -d safari_scraper -f /tmp/restore2.sql
UPDATE 1

$ curl -s -o /dev/null -w "size_download=%{size_download}\n" http://localhost:9001/api/became-seller
size_download=11452

$ node -e '... assert.deepStrictEqual(antes, despues_restaurado) ...'
Fila restaurada: deepStrictEqual completo (incluidos timestamps) === OK
```

### Fase 5.6 — `npx jest` (final, post-restoration)

```
Test Suites: 10 passed, 10 total
Tests:       292 passed, 292 total
Time:        105.131 s
```

292 ≥ 291 required (290 baseline + 2 new: the `Object.keys` runtime pin
and the `AssertSameKeys` smoke `it()`).

### Fase 5.7 — `just build-api`

```
yarn build
$ rimraf dist
$ nest build
Done in 141.58s.
[exited with code 0]
```

### Fase 5.8 — `just verify`

```
OK   API    :9001/api/settings  200  5503B  18ms
OK   Shop   :3003/en  200  190788B  3975ms  cards:30
OK   Admin  :3002/en/login  200  72821B  5795ms  cards:1
```

### Fase 5.9 — `just db-check`

```
Test Files  12 passed (12)
     Tests  228 passed (228)
[exited with code 0]
```

Identical to the base (12 files / 228 tests) — `packages/db` was never
touched.

### Fase 5.10 — `git diff --stat`

```
 .../become-seller/become-seller.service.spec.ts    | 145 ++++++++++++++-------
 .../src/become-seller/become-seller.service.ts     |  59 ++++++---
 .../become-seller/dto/create-become-seller.dto.ts  |  20 ++-
 .../become-seller/entities/become-seller.entity.ts | 143 +++++++++++++++-----
 4 files changed, 266 insertions(+), 101 deletions(-)
```

`git status --short` confirms no file outside
`apps/api/rest/src/become-seller/` was touched (plus the untracked
`openspec/changes/become-seller-contrato-tipos/` artifacts and the
`docs/product/` US update).

**Real LOC (first batch): 367** (266 insertions + 101 deletions), vs. the
gatekeeper's forecast of ~375-395 — under budget at the time. **Superseded
by the corrective batch below: final real LOC is 423** (322 insertions +
101 deletions) — see "Corrective Batch — Re-verification Evidence" for the
updated `git diff --stat` and the honest over-400 disclosure.

## Adjacent Debt — Mentioned, Not Actioned (per the US's binding scope)

- `settings.service.ts:39` — same `as unknown as Setting` pattern; a
  sibling US candidate, not touched here.
- `common/entities/attachment.entity.ts` — still missing `file_name`;
  `BecomeSellerImage` duplicates the "attachment" shape locally instead of
  reconciling with it (D-6, cost declared in `design.md`).
- `apps/shop/src/types/index.ts:1232-1237` — still uses the singular
  `commission`, a third spelling of the same concept.
- `apps/admin/rest/src/types/index.ts:2123,2196` — `max_balance: number`
  and `thumbnail: string`, both contradicted by the real persisted data
  (this US follows the "the data wins" rule and does not touch the admin).
- No `class-validator` validators were added to the DTO/entity, per the
  US's explicit "NO incluye" — not evaluated as necessary beyond that
  scope decision.

## Status (first batch, superseded)

32/32 tasks complete. All gates green at the time. **Superseded**: an
independent gatekeeper reviewed this batch and returned PASS WITH
CONCERNS — one real defect (guard asymmetry, a regression) plus two
documentation inaccuracies. See the corrective batch below, which is the
final state of this change.

---

# Corrective Batch (second and final apply batch)

Triggered by an independent gatekeeper review of the first batch above.
Same branch (`us-45-become-seller-contrato-tipos`), same working tree, no
commit, no push. Verdict on the first batch: **PASS WITH CONCERNS** — the
implementation was otherwise faithful and its evidence re-derived
correctly (the gatekeeper independently re-ran `npx jest`: 10 suites/292
tests, and reproduced the CA-3 red output with real `tsc` on scratchpad
copies).

## Defect 1 (must fix) — write/read guard asymmetry bricked a public endpoint

**Finding**: `create()` gated both fields with a single `_isJsonPayload`
guard that accepted **any** non-null object OR array for **either** field,
while `_toEnvelope()` gated them with field-specific guards
(`_isBecomeSellerOptions`: object, not array; `_isCommissionList`: array).
Consequence: `POST /api/became-seller {"commissions": {"a": 1}}` passed
the lax write guard and got persisted; every subsequent `GET` then hit
`_isCommissionList({a:1}) === false` in `_toEnvelope()` → `500`,
**permanently**, until someone fixed the row by hand. Symmetrically,
`page_options: []` passed the write guard and was rejected on every read
after that. The route is `@Public()`, `ValidationPipe` runs with no
options, and the DTO has no validators, so nothing in the request pipeline
stops such a body — and the shop SSRs off this endpoint
(`apps/shop/src/pages/become-seller/index.tsx`), so the blast radius is a
storefront page that stops rendering. This is a regression this change
introduced (before this US, the same request corrupted the row silently
but the endpoint kept answering `200`), not pre-existing debt. The
asymmetry traces back to an earlier reviewer's "collapse 4 guards into 3"
suggestion, passed through unmodified into the write path without
reproducing the read path's field-specific strictness.

**Fix**: `create()` now calls `_isBecomeSellerOptions(page_options)` and
`_isCommissionList(commissions)` directly — the exact same guards
`_toEnvelope()` uses, so a row can only ever be written in a shape the
read path accepts. `_isJsonPayload` is gone (unused after the fix).

**The compile problem this raised, and how it was solved without any type
escape**: the guards' predicates originally narrowed to the entity classes
(`BecomeSellerOptions`, `CommissionItem[]`), and the design (D-8) already
established that a class is not assignable to `Prisma.InputJsonValue` in
either direction (no string index signature). Verified this was still true
before writing any real code, on a scratchpad mock of the actual
`Prisma.InputJsonValue` union (copied verbatim from
`node_modules/@prisma/client/runtime/client.d.ts`) plus faithful stand-ins
for the real classes — assigning the class-narrowed value directly to an
`InputJsonValue`-typed parameter failed exactly as D-8 predicted. The fix:
widen each guard's predicate to an **intersection** of the entity class
and the matching `Prisma.InputJson{Object,Array}` type —
`value is BecomeSellerOptions & Prisma.InputJsonObject` and
`value is CommissionItem[] & Prisma.InputJsonArray`. Proven on the same
scratchpad mock, both directions: passing the narrowed value to a
`Prisma.InputJsonValue`-typed parameter compiles, AND assigning it back
into a `BecomeSellerOptions`/`CommissionItem[]`-typed field (the
`_toEnvelope()` literal) also compiles — with zero casts. Then applied to
the real file and confirmed against the real `@safari/db` types with
`npx tsc --noEmit -p tsconfig.json` (clean, no output).

```ts
function _isBecomeSellerOptions(
  value: unknown,
): value is BecomeSellerOptions & Prisma.InputJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function _isCommissionList(
  value: unknown,
): value is CommissionItem[] & Prisma.InputJsonArray {
  return Array.isArray(value);
}
```

Both `create()` and `_toEnvelope()` now call these two functions and only
these two — there is no separate "write" predicate to drift out of sync
with the "read" one again.

**Test added** (`become-seller.service.spec.ts`, inside the `.create()`
describe block — this is a behavior change and needed a test, in scope
since the spec file is one of the five allowed files):

```ts
function malformedDto(patch: Record<string, unknown>): CreateBecomeSellerDto {
  const raw = JSON.parse(JSON.stringify({ ...realCreateDto(), ...patch }));
  return raw;
}

it('`commissions` como objeto (no array) NO se reenvía a `updateBecomeSeller` — antes provocaba un 500 permanente en la siguiente lectura', async () => {
  updateBecomeSellerMock.mockResolvedValue(makeRecord());
  const dto = malformedDto({ commissions: { a: 1 } });
  await service.create(dto);
  const calledWith = updateBecomeSellerMock.mock.calls[0][0];
  expect('commissions' in calledWith).toBe(false);
  expect(calledWith).toEqual({ pageOptions: dto.page_options, language: dto.language });
});

it('`page_options` como array (no objeto) NO se reenvía a `updateBecomeSeller`', async () => {
  updateBecomeSellerMock.mockResolvedValue(makeRecord());
  const dto = malformedDto({ page_options: [1, 2, 3] });
  await service.create(dto);
  const calledWith = updateBecomeSellerMock.mock.calls[0][0];
  expect('pageOptions' in calledWith).toBe(false);
  expect(calledWith).toEqual({ commissions: dto.commissions, language: dto.language });
});
```

`malformedDto()` uses `JSON.parse(JSON.stringify(...))`, not a type cast:
it simulates what a real malicious/malformed `POST` body actually is at
runtime (parsed JSON with no compile-time type guarantees — the route is
`@Public()` with no validators), rather than forcing the DTO's static type
with `as`/`any`. This keeps the whole-module grep in Re-verification below
clean.

**Live exploit demonstration** (in addition to the unit test, against the
running API on the rebuilt code):

```
$ node -e '<build a body with commissions: {"exploit":"not-an-array"}, real page_options/language>' > exploit-body.json
$ curl -s -X POST http://localhost:9001/api/became-seller -H "Content-Type: application/json" --data-binary @exploit-body.json -w "POST HTTP %{http_code}\n"
POST HTTP 201
$ curl -s -o /dev/null -w "GET after exploit-POST -> %{http_code}\n" http://localhost:9001/api/became-seller
GET after exploit-POST -> 200
commissions after exploit POST (should be untouched, still an array): true 2
```

Before the fix this second `GET` would have been the start of a permanent
`500` loop. `updated_at` advanced (the valid `page_options`/`language`
fields were still written), so the row was restored via `psql` afterward
(same `row_to_json`-before / `UPDATE`-after pattern as the first batch;
verified `deepStrictEqual` complete, including timestamps, against the
`antes.json` baseline captured in Fase 0 of the first batch).

## Defect 2 (must fix) — runtime-delta disclosure was over-broad and incomplete

**Finding**: the first batch's disclosure (`apply-progress.md`, the
"Runtime Delta" section) said a non-object/non-array `page_options`
"reached Prisma, which threw → 500" — true for `null`, **false** for a
scalar like `page_options: "texto"`, which `Prisma.InputJsonValue` accepts
as a valid string variant: that previously returned **201 with a silently
corrupted row**, not a 500. The disclosure also only covered the write
path; the read guard in `_toEnvelope()` is a second, opposite-direction
delta (a row already corrupted now 500s on read where it previously
rendered 200-with-garbage) that went undisclosed.

**Fix**: the "Runtime Delta — Mandatory Disclosure" section above (in the
first-batch part of this file) has been rewritten in place to split the
write-path delta into its two distinct cases (`null` → previously 500, now
dropped/201; scalar/wrong-shape → previously 201-with-corruption, now
dropped/201) and to add the read-path delta (corrupted row → previously
200-with-garbage, now 500). The original (inaccurate) wording it replaces,
for the audit trail:

> "Per the design (D-8) and the gatekeeper's note in `state.yaml`: the
> write guard (`_isJsonPayload`) **removes an existing 500**. Before this
> change, a `POST` with `page_options: null` (or a non-object/non-array
> value) was reinterpreted with `as unknown as` and reached Prisma, which
> threw → `500 Internal Server Error`. After this change, the same
> malformed `page_options` fails `_isJsonPayload` and its key is
> **silently omitted** from the `updateBecomeSeller` input — the `POST`
> now answers **201** (no new 4xx, no `class-validator`). [...]"

## Defect 3 (wording fix) — `satisfies` rationale was factually wrong

**Finding**: the D-10 test-net comment in `become-seller.service.spec.ts`
said `satisfies` was unavailable because of `typescript ^4.7.4`. Checked:
`apps/api/rest/node_modules/.bin/tsc --version` reports **4.9.5**, which
does have `satisfies` (landed in 4.9). The DECISION not to use it is
unchanged and correct — `package.json` declares the range `^4.7.4`, which
permits installing any `4.7.x` (no `satisfies`), so the net must not
depend on a feature the declared range doesn't guarantee — but the stated
REASON was wrong (implied unavailability today, not "the declared range
allows an older install"). Fixed the comment in place:

```
* `AssertSameKeys` deriva las claves del JSON real ... sin
* `satisfies`. No es que el compilador instalado hoy carezca de él (el
* binario resuelto es `typescript@4.9.5`, que sí lo trae); es que
* `apps/api/rest/package.json` declara el rango `^4.7.4`, que permite
* instalar cualquier `4.7.x` sin `satisfies` (llegó en 4.9), así que la red
* no puede depender de una versión más nueva que la que el rango declarado
* garantiza.
```

Did not switch to `satisfies` — only corrected the stated reasoning.
`grep -rn "4\.7\.4\|satisfies" openspec/changes/become-seller-contrato-tipos/apply-progress.md`
confirmed empty (the wrong reasoning was never written into this file in
the first place — only into the spec comment).

## Flagged, not acted — the US doc's DoD prose edit

The first batch appended a caveat to `docs/product/45-entidad-become-seller-desalineada.md`'s
Definition of Done (the `missions`-substring note, next to the `grep`
checkbox), not just checked boxes / updated the Status line. That is an
edit to acceptance-criterion prose in a product doc the owner owns, not
just a status update. Calling it out explicitly here, again, per the
coordinator's instruction, so the owner can accept or revert it
deliberately: the caveat itself is accurate (the reviewer independently
confirmed with `grep -rnP '(?<!com)missions'` that no field is named
`missions`), and it has been left in place, but it was not the executor's
call to make unilaterally on an owner-owned artifact.

## Re-verification Evidence

**Whole-module grep** (not just the service — every file under
`become-seller/`):
```
$ grep -rn "as unknown as\|as any\|ts-ignore\|ts-expect-error\|: any" apps/api/rest/src/become-seller/
(empty — exit 1)
```

**`npx tsc --noEmit -p tsconfig.json`** (whole API project, real types,
after the guard fix): clean, no output, exit 0.

**`cd apps/api/rest && npx jest`** (final run, after the Defect 3 comment
fix too):
```
Test Suites: 10 passed, 10 total
Tests:       294 passed, 294 total
Time:        71.082 s
```
294 ≥ 291 required. Up from the first batch's 292 — the two new
`create()` tests for Defect 1 (`commissions` as object, `page_options` as
array, both asserted NOT forwarded to `updateBecomeSeller`).

**`just build-api`**:
```
$ nest build
Done in 131.39s.
[exited with code 0]
```

**Live HTTP re-check, on the CURRENT code**: the `yarn start:dev` process
serving `/docs-json`/`GET` for the first batch was killed
(`taskkill //F //PID <pid>`) and restarted fresh with `just api-dev`
*after* this corrective `just build-api` finished, exactly like the first
batch's procedure — only after the fresh process logged `Nest application
successfully started` were the checks below run, so they reflect the
current (guard-fixed) code, not a stale process. (The coordinator noted
the API was found down at some point between batches — it is confirmed up
and freshly rebuilt now.)

```
$ curl -s -o /dev/null -w "size_download=%{size_download}\n" http://localhost:9001/api/became-seller
size_download=11452
$ node -e '... assert.deepStrictEqual(stripTimestamps(antes), stripTimestamps(despues)) ...'
deepStrictEqual OK (excluyendo created_at/updated_at del envoltorio) -- lote correctivo
```

Re-captured in this batch: the live `GET` deep-equal above, the live
exploit `POST`/restore under Defect 1, `npx jest`, `just build-api`, the
whole-module grep, and `just verify`. **Carried forward, not
re-captured**: the `/docs-json` CA-2 shape evidence (`requestBody`
props/`required`, the 24 inner props, `banner` 9 props, `max_balance`
`type:"string"`, `link.nullable`, the D-9 `Banner`/`Type.banners`
collateral check) — none of that depends on the entity/DTO shapes, which
this corrective batch did not touch (only `become-seller.service.ts` and
`become-seller.service.spec.ts` changed), so the first batch's `/docs-json`
evidence still describes the current code correctly. Not re-derived
because there is nothing in this batch's diff that could change it.

**`just verify`**:
```
OK   API    :9001/api/settings  200  5503B  82ms
OK   Shop   :3003/en  200  190788B  3085ms  cards:30
OK   Admin  :3002/en/login  200  72821B  1322ms  cards:1
```

**`git diff --stat`** (still scoped to `apps/api/rest/src/become-seller/`
only — confirmed with `git status --short`):
```
 .../become-seller/become-seller.service.spec.ts    | 193 ++++++++++++++++-----
 .../src/become-seller/become-seller.service.ts     |  67 ++++---
 .../become-seller/dto/create-become-seller.dto.ts  |  20 ++-
 .../become-seller/entities/become-seller.entity.ts | 143 +++++++++++----
 4 files changed, 322 insertions(+), 101 deletions(-)
```

**Honest over-budget disclosure**: **423 changed lines** (322 insertions +
101 deletions), up from the first batch's 367 and now **past the 400-line
review budget** (by 23 lines). Per the coordinator's explicit instruction
and the owner's `size:exception`, this is reported honestly and was
**not** compressed or split — the increase is almost entirely the two new
regression tests plus the widened guard comment explaining the asymmetry
bug, all of which the fix and its evidence require.

## Corrective Batch — Tasks

Not part of the original 32-task plan (the defect was found by review
after all 32 were complete); tracked here instead of renumbering
`tasks.md`:

- [x] C.1 Fix the write/read guard asymmetry (Defect 1) without any type
      escape; remove `_isJsonPayload`.
- [x] C.2 Add a `create()`-path unit test proving the fix (non-array
      `commissions`, array `page_options` — neither forwarded).
- [x] C.3 Live HTTP exploit demonstration + `psql` restoration.
- [x] C.4 Correct the runtime-delta disclosure (Defect 2), in place, with
      the original wording preserved for the audit trail.
- [x] C.5 Correct the `satisfies`/TypeScript-version wording (Defect 3).
- [x] C.6 Flag (not act on) the US DoD prose edit.
- [x] C.7 Re-verify: whole-module grep, `tsc --noEmit`, `npx jest`,
      `just build-api`, live `GET` deep-equal, `just verify`,
      `git diff --stat`.
- [x] C.8 Update `apply-progress.md` (merge, this section), `state.yaml`
      (`apply` block), and the US doc's LOC figure.

## Status (final)

40/40 tasks complete (32 original + 8 corrective). All gates green.
`git diff --stat`: 423 lines (over the 400 budget, disclosed, not
compressed per `size:exception`). Ready for `sdd-verify`.
