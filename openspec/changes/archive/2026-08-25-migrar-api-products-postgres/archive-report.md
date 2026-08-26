# Archive Report — migrar-api-products-postgres

**Change**: `migrar-api-products-postgres` (US-2, Épico 1)  
**Archived**: 2026-08-25  
**Final Verdict**: **PASS WITH WARNINGS**

---

## Executive Summary

The migration of `GET /api/products` from mock (`products.json`) to PostgreSQL via `@safari/db` has been completed, verified, and archived. All five criteria of acceptance and all spec requirements have been confirmed with real command output. The HTTP contract is preserved exactly: 20-key projection, snake_case order, paginator shape, and all documented divergences ratified. Two follow-up issues were fixed and re-verified after the initial verification phase.

**Two open defects remain open and must be tracked separately:**
1. **V-4 (open)**: Zero automated coverage of `toProductDto`, `parseProductSearch`, and error mapping — the new code in this change has only manual verification via curl and full-page Census.
2. **V-1 (unreproduced)**: `just db-check` fails reproducibly (3/3) in sdd-verify environment, hypothesis: cwd casing difference causing vitest to load two module instances. Orchestrator independently ran it 3 times green. Pre-existing defect, not caused by US-2.

---

## Change Archived

**From**: `openspec/changes/migrar-api-products-postgres/`  
**To**: `openspec/changes/archive/2026-08-25-migrar-api-products-postgres/`  
**Spec Synced**: `openspec/specs/product-listing-api/spec.md` (NEW)

### Verification Evidence

| Aspect | Result |
|--------|--------|
| Task Completion Gate | ✅ All 24 implementation tasks `[x]` complete, 0 unchecked |
| Final Verdict | ⚠️ **PASS WITH WARNINGS** (not PASS, per verify-report) |
| CA-1: Contract parity | ✅ Confirmed — 20 keys, snake_case, order identical, 1199-row census |
| CA-2: Name search | ✅ Confirmed — `contains`/`insensitive`, total 17 (not 20 fuzz) |
| CA-3: Store independence | ✅ Confirmed — `just verify`, 30 cards rendered |
| CA-4: Live origin | ✅ Confirmed — UPDATE + curl + revert, no restart needed |
| CA-5: Error handling | ✅ Confirmed — 503 with legible JSON, process stays up |
| Tests | ⚠️ `npm test`: 14/14 green; `just db-check`: 3/3 failed (pre-existing) |
| Diff scope | ✅ 251 insertions / 46 deletions across 4 files (within 400-line budget) |
| Scope compliance | ✅ No schema changes, no frontend, no `popular`/`best-selling`, no prohibited areas |

---

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `product-listing-api` | **Created** | Full new spec with 6 requirements (Projection, Pagination Wrapper, Search & Filters, Store Independence, Live Origin, Error Handling) + 7 documented divergences ratified |

### Key Additions to Spec

1. **Projection**: 20 keys, snake_case, exact order, nested `type` and `shop` objects
2. **Pagination**: `paginate()` local wrapper, raw `per_page` string, numeric values to `listProducts()`
3. **Search Parser**: `;` + first `:` split, 8 supported tokens (name, shopId, minPrice, maxPrice, status, visibility, typeSlug, manufacturerSlug, categorySlug, tagSlug), others ignored
4. **Divergences Documented**:
   - `in_flash_sale`: always 0 (no column in schema)
   - `type.logo`: always null
   - `type` embedded: 85 rows differ from types.json (type 6, type 11; one type-6 row is draft `status`, not observable)
   - Prices: 8 rows rounded to `numeric(12,2)`
   - `image`: 2 rows null instead of `[]`
5. **Search Behavior Divergences**:
   - Name search: fuzz 20 rows vs. `contains` 17 (fuzz matches substring-less via threshold)
   - `shop_id` + another token: mock 20 (shop discarded), Postgres 12 (true AND)
   - `min_price`/`max_price`: mock 0, Postgres real range (195+ rows visible to user)
6. **Error Handling**: 503 on connection error (Prisma), 500 on other errors, no crash

---

## Archive Contents ✅

Preserved at `openspec/changes/archive/2026-08-25-migrar-api-products-postgres/`:

- `proposal.md` ✅ (scope, approach, dependencies, rollback plan)
- `exploration.md` ✅ (baseline, open questions, design questions)
- `design.md` ✅ (technical approach, architecture decisions A/B/C/D, data flow, divergence rationale)
- `specs/product-listing-api/spec.md` ✅ (6 requirements + scenarios + out-of-scope)
- `tasks.md` ✅ (24/24 tasks complete: preconditions, implementation, tests, verification, divergences, documentation, follow-up)
- `verify-report.md` ✅ (comprehensive evidence: curl, census, CA-by-CA verification, hallazgos V-1 to V-8)
- `apply-progress.md` ✅ (work log, code changes, test results, follow-up batch 2 with V-2 and V-3 fixes)
- `state.yaml` ✅ (DAG state, timestamps, phase progression)
- `archive-report.md` ✅ (this file)

---

## Follow-Up Fixes Post-Verify (Authorized Reopen)

### V-3 (CLOSED) — Malformed Numeric Search Tokens → 500

**Issue**: `search=shop_id:abc`, `search=min_price:abc`, `search=max_price:abc` returned HTTP 500 (regression not caught by initial verify).

**Root Cause**: `Number('abc')` = NaN; `buildWhere` checks `!== undefined` (not `isFinite`); Prisma throws; caught as 500.

**Fix Applied**: `parseFiniteNumber()` / `Number.isFinite()` in `products.service.ts`. Malformed values now ignored (filter discarded), not passed as NaN.

**Verification**: 
- `shop_id:abc` → 200 total:1199 (same as no filter)
- `min_price:abc` → 200 total:1199 (same as no filter)
- `shop_id:6` (valid) → 200 total:584 (unaffected)
- `min_price:50` (valid) → 200 total:195 (unaffected)

**Evidence**: curl output in `apply-progress.md` batch 2, re-verified by orchestrator.

### V-2 (CLOSED) — Divergence #9 Mock Figure Wrong

**Issue**: `design.md` and `apply-progress.md` stated mock returned **0 rows** for `search=name:apple;shop_id:6`. Reality: **20 rows**.

**Root Cause**: Apply measured only Postgres side (12 rows) and inferred mock was 0 from the description (shop_id discarded silently). Did not re-measure mock with fuse.js.

**Correction Applied**: Updated all mentions across:
- `design.md` (divergence table, search parser section, scenario detail)
- `specs/product-listing-api/spec.md` (requirement table, scenario)
- `tasks.md` (Phase 5.1)
- `apply-progress.md` (batch 2 notes)

**Correct Divergence #9**: Mock **20 rows** (shop_id:6 discarded, all shops) → Postgres **12 rows** (true AND: name AND shop_id:6).

**V-2 Corollary (Divergence #3 Clarification)**: 86 rows total with type mismatch in mock, but only **85 observable via endpoint** (id 454 is `draft` status, Postgres filters). Noted in spec.

---

## Two Open Items Requiring Separate Tracking

### V-4 — Zero Automated Coverage of New API Code ⚠️ WARNING

**Functions without tests**:
- `parseProductSearch(search)` — parser; splits by `;` and first `:`, maps 8 tokens
- `toProductDto(record)` — mapper; 20-key literal projection, nested objects, 2 constants
- Error mapping `isPrismaConnectionError()` check and 503/500 branching

**Automated Coverage**:
- 3 integration tests added to `packages/db/src/repositories/products.integration.test.ts` — but they exercise `listProducts()` with `{shopId}`, `{manufacturerSlug}`, `{tagSlug}`. This is pre-existing repository code, not the new parser/mapper.
- No unit tests; `apps/api/rest` has jest declared but zero `*.spec.ts` files.

**Why Not Added**: Per Design Decision C, `parseProductSearch` and `toProductDto` are private module functions. Extracting them to export would require restructuring not authorized by US-2. Tests are module-private, not feasible.

**Manual Verification**: Contract protected by full-page Census (1199 rows), curl search scenarios, error curl tests in `verify-report.md` §4–6.

**Forward Risk**: US-3 will export `toProductDto` for detail-by-slug endpoint. The 20-key projection will be reused without an automated safety net. **Recommendation**: US-3 should open with a contract test of the key-set, or the team must accept that the mapper is hand-verified.

### V-1 — `just db-check` Flakey (Pre-Existing, Unreproduced) ⚠️ WARNING

**Observed in sdd-verify**: `just db-check` failed **3/3 times** with "vitest failed to find the current suite" at line 25 (`afterAll` module level), no tests collected.

**Observed by Orchestrator**: Same test command run **3 times independently, all green** (14/14 tests).

**Hypothesis (Not Confirmed)**: `just` spawns with `[working-directory: 'packages/db']` and produces cwd `c:/DevOps/...` (lowercase drive letter). `vitest 4` resolves two module instances of the `vitest` package → "failed to find the current suite". Direct bash run normalizes to `C:/...` (uppercase) and vitest loads one instance.

**Proof It's Not US-2**: Temporarily restored `HEAD` version of test file (without the 3 new tests) and re-ran `just db-check` → **failed the same way**. Tests were not the trigger.

**How To Reproduce**: `just db-check` from Windows Git Bash in this repo (this is the trigger, not the change).

**How To Work Around**: `cd packages/db && npm test` (5/5 green, 14/14).

**Status**: Not this change's defect; not blocked by this. Record as pre-existing environment flake pending investigation by repo maintainers. Do not hold US-2 archive.

---

## Accepted and Documented Divergences

These are correct behavior, not defects. Documented in spec for downstream users (US-3, US-4, frontend):

| # | Divergence | Mock | Postgres | Status |
|---|---|---|---|---|
| #1 | `in_flash_sale` always 0 | 1 row = 1 | 0 (no column) | ✅ Ratified, accepted |
| #2 | `image: null` not `[]` | 2 rows = `[]` | `null` | ✅ Ratified, accepted |
| #3 | `type` embedded (obsolete) | 86 rows | 85 observable (id 454 draft) | ✅ Ratified (matiz: draft filtered), accepted |
| #4 | Price rounding to `numeric(12,2)` | 8 rows | 8 rows | ✅ Ratified, accepted |
| #5 | `total` 1200 → 1199 (draft excluded) | 1200 | 1199 | ✅ Ratified, accepted |
| #6 | Key-order consistency | 1200 identical | 1199 identical | ✅ Ratified, accepted |
| #7 | Order `id ASC` vs. fuse ranking | ranking order | id ASC | ✅ Ratified (R-2 licenses order change), accepted |
| #8 | Name search fuzz 20 vs. substring 17 | fuse 20 | `contains` 17 | ✅ Ratified (fuzz matches non-substrings), accepted |
| #9 | `shop_id` + filter (corrected) | **20** (shop discarded) | **12** (true AND) | ✅ Ratified (V-2 fixed figure), accepted, **visible to user** |
| #10 | `min_price`/`max_price` real range | **0** (not in fuse keys) | **195** (real range) | ✅ Ratified, accepted, **visible to user** (price filter now works) |

**Impact Summary**: Divergences #8–#10 are search cardinality/visibility differences. #9 and #10 are **user-visible** — the product listing will change row count when filtered by price or by name + shop. **#10 is the most material**: the price filter in the shop UI will stop returning empty and will show 195 real results. Must be communicated before release.

---

## Review & Verification Workload

| Metric | Value |
|--------|-------|
| Changed lines | 251 (+) / 46 (−) = 297 total |
| 400-line budget | ✅ Within (Medium risk → Low realized) |
| Files touched | 4 (allowed) |
| Chained PRs needed | No |
| Delivery strategy | ask-on-risk → single PR approved |

---

## Source of Truth Updated

Main specs now contain the behavior specification for `/api/products` listado:

**`openspec/specs/product-listing-api/spec.md`** (NEW)
- 6 Requirements (Projection, Pagination, Search, Store Independence, Live Origin, Error Handling)
- 7 Scenarios (Given/When/Then per requirement)
- 10 Documented Divergences with Rationale
- Out-of-Scope boundary (US-3 detail, US-4 catalogs, schema, frontend)

This spec is the source of truth for:
- `/api/products` contract (20 keys, order, types, pagination wrapper)
- Accepted search token behavior and divergences
- Error handling expectations
- Downstream reuse constraints (e.g., US-3's `toProductDto` export)

---

## SDD Cycle Complete

✅ **Proposed** → ✅ **Explored** → ✅ **Designed** → ✅ **Specified** → ✅ **Tasked** → ✅ **Applied** → ✅ **Verified** (PASS WITH WARNINGS) → ✅ **Archived**

The change is fully planned, implemented, verified, and now read-only in the audit trail. Ready for the next change (US-3: product detail by slug, or risk backlog item to resolve V-3 pattern across the API).

---

## Risks Carrying Forward

1. **Mapper reuse without tests (V-4)**: US-3 will export `toProductDto`. Before code review, decide: add unit test suite for mapper/parser, or accept hand-verification as the gate.
2. **Price filter visible change (#10)**: Announce that product grid will show real results for price filters; users may perceive this as a bug fix or unexpected change.
3. **`just db-check` flake (V-1)**: Do not rely on `just db-check` in CI/automation until Windows cwd casing issue is diagnosed. Use `npm test` as workaround.

---

**Archived by**: sdd-archive (executor)  
**Date**: 2026-08-25  
**Skill Resolution**: paths-injected (SKILL.md paths received from orchestrator)
