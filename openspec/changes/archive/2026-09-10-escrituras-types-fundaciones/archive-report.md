# Archive Report — `escrituras-types-fundaciones` (US-27a)

**Archived**: 2026-09-10  
**Verify Report Date**: 2026-09-09 (PR#1a/PR#1b/PR#2: commits `530e713`/`3c59b0d`/`829f510`)  
**C-1 Remediation**: 2026-09-10 (commit `4304bc5`, verified by orchestrator)  
**Mode**: openspec-only

---

## Specs Merged into `openspec/specs/`

### 1. `flat-catalogs-api/spec.md` — UPDATED

**Action**: Appended 6 new ADDED Requirements (CA-1..CA-6, 12 scenarios) + updated `## Out of Scope` prose.

**New Requirements Added**:
- R1: Escritura de `types` reutiliza la proyección de lectura (CA-1, CA-2)
- R2: Borrado de `types` es protegido por dependientes (CA-3)
- R3: Errores de dominio de `types` nunca producen 500 (CA-4)
- R4: Permisos de escritura de `types` sin cambios (CA-5)
- R5: Sin mock huérfano ni regresión de lectura en `types` (CA-6)
- R6: *(Subsumed by CW1-CW6 from `catalog-write-foundations`, reference preserved)*

**Out of Scope Update** (prose replacement, applied by hand — see note below):
- **Removed**: "endpoints de escritura del admin (`POST`/`PUT`/`DELETE` de los 4 catálogos)"
- **Added**: "endpoints de escritura del admin de `tags`/`manufacturers` (US-27b) y `shops` (US-30) — `types` pasa a estar en alcance (US-27a)"
- **Preservation check**: All 9 other items in the Out of Scope list were verified to survive unchanged:
  - `categories` (US-4b) ✓
  - `authors`/`top-authors` ✓
  - `category_product` ✓
  - `apps/shop/**`, `apps/admin/**` ✓
  - `GET /staffs`, `POST /approve-shop`, `POST /disapprove-shop` ✓
  - `GET /new-shops` and `GET /near-by-shop/:lat/:lng` ✓
  - retrofit de `products.service.ts` (D-7) ✓
  - specs de jest para los 4 servicios (D-10) ✓

> **Note on Out of Scope merge**: `openspec-convention.md` only defines delta sections for `## ADDED/MODIFIED/REMOVED/RENAMED Requirements`, not for header prose like `Out of Scope`. This pattern (replacing the entire list by hand with guidance in a `## MODIFIED Out of Scope (no-estándar)` block) has precedent three times in this repo:
> - `archive/2026-08-31-categorizacion-slugs-catalogo/specs/scraper-product-ingestion/spec.md` (US-7)
> - `archive/2026-08-31-endpoints-derivados-postgres/specs/flat-catalogs-api/spec.md` (US-8)
> - This change (US-27a)
> 
> Guidance from design and apply phases was explicit: verify all unrelated items before accepting the replacement. Verified: ✓

### 2. `catalog-write-foundations/spec.md` — NEW CAPABILITY

**Action**: Created as a complete specification (not a delta with `## ADDED Requirements`).

**Structure**: Follows the repo's only existing precedent for a new capability: `archive/2026-09-02-capa-datos-identidad/specs/identity-data-layer/spec.md`.

**Content**: 6 Requirements (CW1-CW6, 11 scenarios) covering:
- CW1: Slug generation from `slug` or `name` (CA-7)
- CW2: Collision resolution with incremental numeric suffix (CA-4, CA-7)
- CW3: Empty slug is a domain error (CA-4, CA-7)
- CW4: Slug immutable after creation (CA-2, CA-7)
- CW5: Closed set of 5 error codes mapped to HTTP status (CA-4, CA-7)
- CW6: Pieces ready for consumption without reopening the files (CA-7)

**Rationale**: These pieces are shared foundations that US-27b (tags/manufacturers), US-28 (categories), US-29 (products), and US-30 (shops) depend on but cannot edit (per CA-7). Defining them as a separate capability makes the dependency explicit and the "no edits" constraint enforceable.

---

## Gate Evidence

### Test Gates Re-executed by Orchestrator (C-1 Fix)

| Gate | Baseline (before fix) | After Fix | EXIT |
|---|---|---|---|
| `just db-check` | 9 files / 111 tests | 9 files / 111 tests | **0** |
| `npx jest` (apps/api/rest) | 6 suites / 91 tests | 6 suites / **92 tests** (+1: C-1 test) | **0** |
| `just build-api` | — | clean, `Done in 43.91s` | **0** |

**Original baseline** (before any work started, per explore phase):
- `just db-check`: 8 files / 91 tests
- `npx jest`: 4 suites / 65 tests

**Line-of-work gains**:
- PR#1a (Slice 1): +1 file (`slug.integration.test.ts`), +11 tests
- PR#1b (Slice 2): +0 files, +9 tests
- PR#2 (Slice 3): +2 files (`domain-error.mapper.spec.ts`, `types.service.spec.ts`), +26 tests

---

## Critical Issue C-1: Remediation and Verification

### Issue Description (from `verify-report.md`)

The 503 branch of `toWriteHttpException` (the fix for gate design correction B1) did not fire against a real Postgres connection failure. When Postgres was stopped (`docker compose stop postgres`), the three write routes returned **500** instead of 503, while the read route (using the old chain) correctly returned 503. Root cause: Prisma 7 + `@prisma/adapter-pg` emits connection failures as `{name:'PrismaClientKnownRequestError', code:'ECONNREFUSED', message:'...'}`, and the `isConnectionFailure` predicate only checked:
1. `name === 'PrismaClientInitializationError'` — ✗
2. `code` in `{P1001, P1002, P1008, P1011, P1017, P2024}` — ✗ (ECONNREFUSED not included)
3. `message` pattern matching — ✗ (patterns checked against message, not code)

The test passed because its fixture `{code:'P1001', message:"Can't reach database server"}` didn't match reality.

### Root Cause

Per B1 gate feedback: `packages/db/src/errors.ts:62` implements `isPrismaConnectionError` to mark **any** `PrismaClientKnownRequestError` as a connection failure (over-503), creating false positives for domain errors like P2011. The new `isConnectionFailure` in the mapper was designed to avoid that trap by **not** keying on the `name`, but the implementation was incomplete — it didn't account for socket-level driver codes.

### Fix Applied (Commit `4304bc5`)

**File**: `apps/api/rest/src/common/errors/domain-error.mapper.ts`

1. **`CONNECTION_FAILURE_CODES`**: Expanded to cover **two families**:
   - Prisma initialization/server codes: `P1001`, `P1002`, `P1008`, `P1011`, `P1017`, `P2024` (unchanged)
   - **Socket driver codes** (new): `ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `EHOSTUNREACH`

2. **`isConnectionFailure` predicate**: No change in logic — still checks `name`, `code`, and `message` patterns. The socket codes are now in the `CONNECTION_FAILURE_CODES` set.

3. **Test fixture in `domain-error.mapper.spec.ts`**: Replaced the synthetic fixture with the **real form captured by stopping Postgres**:
   ```javascript
   {
     name: 'PrismaClientKnownRequestError',
     code: 'ECONNREFUSED',
     message: '\nInvalid `prisma.$queryRaw()` invocation:\n\n\n'
   }
   ```

### Verification Evidence (Runtime, not Fixture)

**Scenario: Postgres down**
```
docker compose stop postgres
→ POST /api/types, PUT /api/types/35, DELETE /api/types/35: 503 ✓
→ GET /api/types (old chain): 503 ✓
docker compose start postgres && wait healthy
→ GET: 200 ✓
→ POST: 201 ✓
→ 404/400/409 still correct ✓
```

### B1 Regression Tripwire (Still Passing)

The spec's B1 correction states: "the 500 branch is reserved for errors that are not translations and not connection failures."  A `PrismaClientKnownRequestError` with code P2011 (NULL constraint violation) must return 500 with the literal message, not 503.

The test asserts this with a characterization check:
```javascript
const prismaShaped = {name:'PrismaClientKnownRequestError', code:'P2011'};
expect(isPrismaConnectionError(prismaShaped)).toBe(true);  // OLD helper IS wrong
expect(toWriteHttpException(prismaShaped)).toBeInstanceOf(InternalServerErrorException);  // NEW mapper is correct
```

The test passes: the old helper incorrectly returns `true`, but the new mapper correctly returns 500 — B1 is preserved.

### State After C-1 Fix

- **C-1 status**: RESOLVED AND RE-VERIFIED
- **Impact**: The mapper is inherited by US-27b/28/29/30 without edits (CA-7). C-1's fix was the last window to correct it; deferring it would have multiplied the defect across five aggregates.
- **Governance signal**: The decision to fix (not accept as divergence) was taken by the user with full knowledge of the cost and was recorded in this report for transparency.

---

## Delivery Commits

**Chain strategy**: stacked-to-main, 3 slices.

| Slice | Commit | PR | Content |
|---|---|---|---|
| 1 | `530e713` | #1a | `slug.ts`, `domain-errors.ts`, `slug.integration.test.ts`, barrel exports (slug/errors) |
| 2 | `3c59b0d` | #1b | `types.repository.ts` writes, `types.integration.test.ts`, barrel exports (write functions) |
| 3 | `829f510` | #2 | `domain-error.mapper.ts`, `domain-error.mapper.spec.ts`, `types.service.ts`, `create-type.dto.ts`, `types.service.spec.ts` |
| Hotfix | `4304bc5` | — | C-1 remediation (`CONNECTION_FAILURE_CODES`, fixture in mapper.spec) |

**Merge order**: `530e713` → `3c59b0d` (base) → `829f510` (base) → main. Commit `4304bc5` applied after `829f510` as an independent hotfix, cherry-picked into apply output.

---

## Volume Forecast vs. Actual

| Metric | Forecast | Actual | Variance |
|---|---|---|---|
| Total LOC (US est.) | ~500 | 1462 | +192% (gross) |
| Forecast by `tasks.md` | ~915 | 1462 | +60% |
| PR#1a | ~245 | 387 | +58% |
| PR#1b | ~240 | 317 | +32% |
| PR#2 | ~410 | 758 | +85% |

**Analysis**: The US forecast was conservative; `sdd-tasks` was more accurate but still low. Overages in all three slices are concentrated in:
- Spanish JSDoc/comments explaining *why* (B1 fix rationale, D27-13 closed-file contract, R-5 field-by-field projection rule)
- Test coverage above minimum (extra collision cases, borrowed fixture blocks for CA-1 key-set comparison)

The pattern is consistent across all slices and matches repo precedents (`products.repository.ts`, `users.repository.ts`). No structural scope was added beyond the design's pinned symbols.

**Signal for backlog**: US-27b is estimated at ~825 LOC and will likely overrun similarly. The epic should recalibrate estimates before refining US-27b/28/29/30.

---

## Divergences Preserved in Production

The following documented divergences from the original mock survive into production, as accepted:

1. **`promotional_sliders` field**: Accepted and ignored (no column in schema). POST with the field produces 201; response emits `promotional_sliders: null` (constant). Nothing persists.

2. **`icon` cannot be cleared via undefined**: `PUT {"icon": undefined}` leaves the icon untouched (Prisma treats undefined as "omit key"). But `PUT {"icon": null}` does clear it (200, column → NULL). The limitation is in the frontend form (`group-form.tsx`), not the API. Verified at runtime.

3. **`manufacturers.type_id` and `tags.type_id` silently set to NULL**: `db/schema.sql:288, :302` define `ON DELETE SET NULL` for these foreign keys (unlike `categories`/`products` which are `CASCADE`). A successful `DELETE /api/types/:id` (200) updates related manufacturers/tags without reporting the update. Declarative behavior, not a regression.

4. **`deleteType` TOCTOU window**: No transactional guarantee. A product inserted between the `count` query and the `delete` could theoretically escape deletion. Accepted as low-risk for an ADMIN_ONLY route; SELECT...FOR UPDATE was declined to avoid inheritance constraints for US-27b/28/29/30.

5. **`created_at`/`updated_at` discrepancy**: Timestamps use 3 decimals in responses (JS `.toJSON()` format) vs. 6 in the original mock JSON from Laravel. Both are ISO 8601 and sortable; no functional impact observed. The seed doesn't populate timestamps per-row (rows take `now()` from `db-up` time).

6. **`icon` field message over-generalization (S-2 from verify)**: The design stated "`icon` cannot be cleared via PUT", but more precisely: "cannot be cleared via undefined (which is what the form sends), but can be cleared via explicit `null`". Verified at runtime; design conclusion (don't touch frontend) stands; message is slightly imprecise but behavioral interpretation is correct.

7. **Two fallback chains in `types.service.ts`**: Reads use `isPrismaConnectionError` (old, over-503), writes use `toWriteHttpException` (new, fixed). These are adjacent to each other in the file. This is the declared boundary (D-4 scope), not scope creep, but the asymmetry is now visually obvious. A future maintainer might mistake it for an inconsistency rather than a deliberate scope boundary.

---

## Not Verified (Carried Forward Honestly)

The following were documented in the verify report as untestable or unexercised by the implementation phase:

1. **`SlugConflict` (409 via P2002) over HTTP**: Only achievable via concurrent `POST` race; deterministic reproduction impossible. Tested only at the mapper level (unitarily, all 5 codes map correctly). `InvalidReference` (400 via P2003) similarly untestable via HTTP in `types` (first real producer is `tags.type_id` in US-27b).

2. **`deleteType` TOCTOU race**: No attempted reproduction of the window where a product is inserted between count and delete.

3. **Malformed JSON payloads**: `PUT` with `{"banners": <invalid JSON>}` or `{"settings": <invalid JSON>}` not tested; depends on Prisma behavior.

4. **Real admin UI walkthrough**: `just verify` confirms the admin loads with live content, but no human UI walkthrough creating/editing/deleting a vertical from the browser. (Out of scope per epic decision 14: no frontend changes.)

5. **Coverage measurement**: `coverage_command` is empty in `openspec/config.yaml`. No coverage % reported.

6. **Biome linter**: `npm run lint` (biome) not run separately; `just db-check` covers typecheck + vitest only.

7. **`just db-test` (scraper)**: Still broken by US-6 (table `productos` missing); not re-run.

---

## Governance Items for the Repo Owner

### 1. `.claude/skills/sdd-propose/SKILL.md` Ceiling Mismatch

The skill pins a 1450-word ceiling on proposal artifacts, justified as "the ceiling of archived precedents (measured: 839 and 1431)". Measurement shows those are the **two oldest** archived changes. Across all 13 archived proposals, the range is 839–3511 words with a median near 1900. The two closest precedents (US-25: 2142, US-23: 2286) far exceed the rule's stated ceiling.

**This proposal**: 1876 words (within the rule as stated, but exceeded twice in the repo already).

**Recommendation**: Recalibrate the skill's ceiling rule to reflect current repo patterns, or remove the ceiling in favor of a "completeness over brevity" principle (already the stated precedent for `design.md`).

### 2. `openspec-convention.md` Missing Section Definitions

The convention formally defines delta sections only for `## ADDED/MODIFIED/REMOVED/RENAMED Requirements`. It does **not** define a merge mechanism for header prose like `## Out of Scope` or `## Purpose`.

This change (and US-7 and US-8 before it) worked around this gap with a non-standard `## MODIFIED Out of Scope (no-estándar)` block, applied by hand during archive.

**Recommendation**: Formalize these sections in `openspec-convention.md`, or document the hand-merge precedent as an accepted pattern.

---

## Next Steps Unblocked

With US-27a archived:

- **US-27b** (tags/manufacturers write), **US-28** (categories write), **US-29** (products write), **US-30** (shops write) are now unblocked and can **run in parallel** — they share only the barrel (`packages/db/index.ts`) and can rebase onto each other if needed.
- All four depend solely on US-27a's closed foundations (slug helper, 5 error classes, error mapper).
- Per CA-7, none of them need to edit the foundation files — only add their own call sites.

---

## Audit Trail

All artifacts preserved in this archive:
- ✓ `proposal.md`
- ✓ `specs/flat-catalogs-api/spec.md` (delta)
- ✓ `specs/catalog-write-foundations/spec.md` (delta, new capability)
- ✓ `design.md`
- ✓ `tasks.md` (all 20 tasks marked `[x]`)
- ✓ `apply-progress.md` (full 3-slice transcript)
- ✓ `verify-report.md` (with C-1 remediation addendum)
- ✓ `state.yaml` (DAG and decisions)

No changes to `docs/product/26-escrituras-catalogo-postgres/**` (per archive phase instructions; status update handled by orchestrator in separate commit).

---

## Summary

**Change**: `escrituras-types-fundaciones` (US-27a)  
**Status**: ✅ ARCHIVED  
**Specs Merged**: 1 existing (flat-catalogs-api) updated, 1 new (catalog-write-foundations) created  
**Delivery**: 3 chained PRs (stacked-to-main), 4 commits (3 implementation + 1 C-1 hotfix)  
**Gates**: All passing (9/111 db tests, 6/92 jest suites, clean build)  
**Volume**: 1462 LOC (+60% over forecast, +192% over initial US estimate)  
**Criticality**: C-1 (socket codes in connection failure detector) remediated and re-verified at runtime

The four dependent user stories (`tags`/`manufacturers`, `categories`, `products`, `shops`) now have stable foundations to build on. The closed-file contract (CA-7) is preserved in all merge outputs.

---

**Archive prepared by**: sdd-archive executor  
**Date**: 2026-09-10  
**Verification**: verify-report.md (2026-09-09) + orchestrator C-1 remediation (2026-09-10)
