# Archive Report: Página «hazte vendedor» desde Postgres (US-44, corte 2)

**Date**: 2026-09-18  
**Change**: `2026-09-15-become-seller-postgres` (change name; archive prefix `2026-09-18`)  
**US**: US-44 (Épico 40: Identidad extendida en Postgres)  
**Status**: Complete and Archived  
**Artifact Store Mode**: openspec  
**Verification Verdict**: PASS WITH FINDINGS — All findings were documentation defects already corrected in commit `16e67ca` before archive

## Executive Summary

One new OpenSpec capability has been successfully created, and two existing capabilities have been extended with new requirements to reflect the `become_seller` service layer now available:

1. **`become-seller-page-api`** (NEW) — 4 requirements specifying the two routes (`GET|POST /api/became-seller`, `@Public()`) reading and writing the `become_seller` singleton from Postgres with structural equivalence to the prior JSON literal and frozen HTTP contract.
2. **`extended-identity-data-layer`** (MODIFIED) — 1 requirement updated to export `getBecomeSeller()` and `updateBecomeSeller()` functions from the barrel, replacing a statement about US-44 being pending.
3. **`data-layer-clock-policy`** (MODIFIED + ADDED) — 1 requirement updated to describe the now-implemented `updateBecomeSeller()` binding to the clock policy (formerly hypothetical), and 1 new requirement documenting the test restoration pattern that prevents relay of mutated timestamps between integration test cases.

All 4 + 4 + 3 requirements across three specs have been verified PASS, all scenarios covered, and implementation tasks fully completed. Two implementation cutoffs were delivered:
- **Cut 1 (9 Sep)**: Data layer — repository, barrel, integration tests (`5af81ad`)
- **Cut 2 (18 Sep)**: Service layer — Nest service, unit tests, corrected documentation (`c6f5cf7` + `16e67ca`)

The verification report issued findings about three documentation misstatements; all three were corrected by the orchestrator in `16e67ca` before this archive phase.

## Specs Merged

| Domain | Requirements | Action | Details |
|--------|---|--------|---|
| `become-seller-page-api` (NEW) | 4 ADDED | **Created** | `GET|POST /api/became-seller` from Postgres, envoltorio recompuesto (2 claves top-level: `page_options`, `commissions`), contrato HTTP frozen, singleton guarantee (CA-3), no regression in size/routes/settings |
| `extended-identity-data-layer` | 1 MODIFIED | **Updated** | Barrel now exports `getBecomeSeller`, `updateBecomeSeller`, `UpdateBecomeSellerInput` (US-44 functions); `shop_staff` functions still pending US-42 |
| `data-layer-clock-policy` | 1 MODIFIED + 1 ADDED (2 total) | **Extended** | R7 rewritten: `updateBecomeSeller()` now realizes the clock binding (no longer hypothetical). R9 (NEW): Test restoration must happen per-`describe` in `afterEach` + `afterAll` safety net, with tripwire at EOF to catch unrestore drift |

### Requirement Count Verification

- **`become-seller-page-api`**: 4 requirements created (0 existing) ✅
- **`extended-identity-data-layer`**: 1 requirement modified (4 existing, unchanged) ✅
- **`data-layer-clock-policy`**:
  - **Before merge**: 8 requirements (6 pre-US-41, +2 from US-41 archive on profiles/shop_staff)
  - **After merge**: 9 requirements (+1 modified, +1 added) ✅
  - **Previous scenarios preserved**: All scenarios in all 8 pre-existing requirements survived intact ✅
  - **New scenarios added**: 3 scenarios for the modified R7 (become_seller), 4 scenarios for new R9 (restoration) ✅

### Out of Scope Prose Update

The `extended-identity-data-layer/spec.md` `## Out of Scope` block originally stated:
> "Repositorios de funciones planas de `shop_staff`/`become_seller` ... (US-42, US-44)"

After archive merge, it now states:
> "Repositorios de funciones planas de `shop_staff` ... (US-42) · ... (Nota: el repositorio de `become_seller` sí fue entregado, en US-44 corte 2; esta sección ya no lo lista.)"

This reflects that `become_seller` functions are now exported from the barrel (US-44 delivered), while `shop_staff` functions remain pending (US-42 not yet delivered).

## Validation

### Spec Contents Verified

**become-seller-page-api/spec.md** ✅ (NEW)
- 4 requirements in correct OpenSpec format:
  1. Lectura desde Postgres con equivalencia estructural (CA-1) — 3 scenarios
  2. Escritura real sobre el singleton (CA-2) — 2 scenarios
  3. El singleton nunca se duplica (CA-3) — 1 scenario
  4. Contrato HTTP y superficie de error congelados (CA-4) — 2 scenarios
- Total: 8 scenarios

**extended-identity-data-layer/spec.md** ✅ (MODIFIED)
- 1 requirement modified; 3 other requirements (types, records/mappers, db-check) remain intact
- Requirement 3 (Exportación por barrel): 4 scenarios
  - 2 scenarios from original version (types importable, no new repo functions — clarified to say `shop_staff` only)
  - 1 new scenario: `become_seller` functions importable
  - 1 new scenario: `shop_staff` functions not exported (clarifies US-42 is separate)

**data-layer-clock-policy/spec.md** ✅ (MODIFIED + ADDED)
- Requirements 1–6: Verified intact (Reloj único, Invariante, Inventario exhaustivo, Excepción `findOrCreateShopBySlug`, `profiles` binding, `_setNowProvider` scope)
- **Requirement 7** (MODIFIED): `become_seller` vincula su primera ruta — 3 scenarios (rewritten from hypothetical to realized fact)
- **Requirement 8** (unchanged): `shop_staff` excluida
- **Requirement 9** (NEW): Test restoration pattern — 4 scenarios
- Total: 6 (pre-existing, untouched) + 3 (modified R7) + 0 (R8 unchanged) + 4 (new R9) = 13 scenarios

### No Destructive Changes Detected

- No requirements were removed from any spec
- No scenarios were deleted or reordered in any append/modify
- All existing requirements of `data-layer-clock-policy` remain in their original positions and text
- All existing scenarios preserved verbatim
- `Out of Scope` prose updated to reflect completed work (accurate accounting of scope boundaries)

## Archive Contents

All artifacts from the change workflow have been moved to `openspec/changes/archive/2026-09-15-become-seller-postgres/`:

- ✅ `exploration.md` — pre-design research, "ruta pasada vs. presente", Nest patterns, integración con clock.ts (20 KB)
- ✅ `proposal.md` — scope (repository, service, tests), approach (two-cut delivery), acceptance criteria, three CAs, rollback plan, owner authorization (13 KB)
- ✅ `specs/become-seller-page-api/spec.md` — NEW full spec with 4 requirements (4 KB)
- ✅ `specs/extended-identity-data-layer/spec.md` — delta with 1 MODIFIED requirement for barrel export (US-44), merged into main spec (1 KB)
- ✅ `specs/data-layer-clock-policy/spec.md` — delta with 1 MODIFIED requirement + 1 ADDED requirement for test restoration (US-44), merged into main spec (3 KB)
- ✅ `design.md` — architecture decisions (D-1 through D-6), two-cut delivery strategy, service layer envelope recomposition, jest test strategy, scope declarations (27 KB)
- ✅ `tasks.md` — 7-phase breakdown (baseline, repository+barrel, integration, service, jest, evidence, corrections), all tasks marked `[x]` complete, 400-line budget risk acknowledged (13 KB)
- ✅ `apply-progress.md` — implementation log, two-cut delivery evidence (cut 1: `5af81ad`; cut 2: `c6f5cf7` + `16e67ca` corrections), code changes applied with line anchors (22 KB)
- ✅ `verify-report.md` — all 10 requirements verified PASS (4 from new `become-seller-page-api`, 1 modified from `extended-identity-data-layer`, 1 modified + 1 added from `data-layer-clock-policy`, 3 unchanged from `data-layer-clock-policy`), 21 scenarios verified, live curl evidence, jest/db-check/build-api/verify green, 3 documentation findings all corrected in `16e67ca` (27 KB)  
  **Status**: PASS WITH FINDINGS (F-1: spec described unrealizable mechanism; F-2: CA-1 stated only format cause, not value cause; F-3: psql output format mismatched prose — all corrected before archive)
- ✅ `archive-report.md` — this document

## Task Completion Gate

The executor verified that `openspec/changes/archive/2026-09-15-become-seller-postgres/tasks.md` (just moved) contained no unchecked implementation tasks before archiving. All 37 implementation tasks across 7 phases were marked complete (`[x]`):
- Phase 1 (Baseline measurement): 4 tasks complete
- Phase 2 (Repository + Barrel): 4 tasks complete
- Phase 3 (Integration Tests): 8 tasks complete
- Phase 4 (Service Nest): 5 tasks complete
- Phase 5 (Jest Tests): 7 tasks complete
- Phase 6 (Evidence & Regression): 6 tasks complete
- Phase 7 (Corrections): 3 tasks complete

**Total: 37/37 complete** ✅

## Verification Verdicts from Prior Phase

### From `verify-report.md` (2026-09-18)

**Verdict**: PASS WITH FINDINGS

**Requirement Verdicts** (by capability):

**become-seller-page-api** (4 requirements):
- R1 (Lectura desde Postgres con equivalencia estructural, CA-1) — PASS ✅
- R2 (Escritura real sobre el singleton, CA-2) — PASS ✅
- R3 (El singleton nunca se duplica, CA-3) — PASS ✅
- R4 (Contrato HTTP y superficie de error congelados, CA-4) — PASS ✅

**extended-identity-data-layer** (1 modified requirement):
- R3 (Exportación por el barrel del paquete — MODIFIED) — PASS ✅

**data-layer-clock-policy** (1 modified + 1 added = 2 new in this change):
- R7 (become_seller vincula — MODIFIED) — PASS ✅
- R9 (Test restoration per-afterEach + afterAll — ADDED) — PASS ✅

**Test Counts (Reproducible Evidence)**:
- `just db-check`: 12 test files / 228 tests / 228 passed ✅ (baseline from US-41: 12/228, corte 1 of US-44 contributed to reaching this count)
- `cd apps/api/rest && npx jest src/become-seller`: 1 file / 5 tests / all passed ✅ (new jest suite)
- `cd apps/api/rest && npx jest` complete: 10 suites / 290 tests / all passed ✅ (baseline 285, +5 from new suite)
- `just build-api`: success ✅
- `just verify`: 3 services green, `/api/settings` 5503 B (unchanged) ✅
- Shop SSR rendering `/become-seller`: 200 OK, both `jsonb` columns visible ✅

**Evidence Status**:
- **Reproducible**: All requirement checks, repository function retrieval from Prisma, barrel imports with `import type`, service envelope recomposition, jest mocking of `@safari/db`, test restoration behavior verified by inspection of `beforeAll`/`afterEach`/`afterAll` hooks, tripwire ordering, clock bindings in calls, singleton count verification
- **Hereditary** (from apply phase, not re-run per encargo): `just db-reset`, SSR pre-render on shop frontend. Mitigant: verification re-ran build-api, which exercises the GET route via next.js static generation

**Findings (All Corrected in `16e67ca`)**:
1. **F-1** (corrected): Delta spec for `data-layer-clock-policy` R9 described restoration "dentro del `afterAll` existente ... en un bloque `try/finally`", but the code correctly implements restoration per-`describe` in `afterEach` + `afterAll` safety net. Spec rewritten to match realized implementation. No CRITICAL issues.
2. **F-2** (corrected): CA-1 stated only the **format** cause of timestamp divergence (24 vs 27 characters); spec now documents **value** cause (seed.sql doesn't insert `created_at`/`updated_at`, they take `DEFAULT now()`) + format cause.
3. **F-3** (corrected): Prose of verification's DoD claimed psql comparison at "millisecond resolution" but showed raw output with `updated_at = created_at` comparing microseconds (crudo = f). Recaptured real output (crudo f, `date_trunc('milliseconds', ...) = t`) and documented why.

## SDD Cycle Closure

The change `2026-09-15-become-seller-postgres` has completed the full SDD lifecycle:

1. **Exploration** (sdd-explore): Ruta GET vs POST vs PUT vs PATCH, JSON recomposition pattern (envoltorio), clock binding for update function
2. **Proposal** (sdd-propose): One new capability (become-seller-page-api), two modified capabilities (barrel export, clock binding), scope (service + jest), three CAs, rollback plan, two-cut delivery, owner authorization
3. **Specification** (sdd-spec): 4 ADDED (become-seller-page-api) + 1 MODIFIED (extended-identity-data-layer barrel export) + 1 MODIFIED + 1 ADDED (data-layer-clock-policy clock binding + test restoration)
4. **Design** (sdd-design): D-1 repository structure, D-2 envelope recomposition in service, D-3 JSON byte parity scoping, D-4 type local in service for DTO mismatch, D-5 integration test determinism with afterEach+afterAll, D-6 literal methods in service (findOne, remove, update delegation)
5. **Tasks** (sdd-tasks): 7-phase breakdown, 400-line budget risk acknowledged, chained PRs recommended
6. **Apply** (sdd-apply): Two-cut implementation (cut 1: data layer 5af81ad; cut 2: service + corrections c6f5cf7 + 16e67ca), all tasks marked complete
7. **Verify** (sdd-verify): 10 requirements verified PASS (new + modified + added), 21 scenarios covered, 3 documentation findings, all findings corrected by orchestrator before archive
8. **Archive** (sdd-archive): Three specs created/updated, deltas merged to main, Out of Scope prose updated for accuracy, change folder archived to audit trail with ISO date prefix

## Deferred Work and Dependencies

### Open Dependencies (Blocking Other US)

**US-42 (Staff management)**: BLOCKED pending implementation of `shop_staff` repository functions and service layer. `shop_staff` table, Prisma model, `ShopStaffRecord` type, and seed now available (US-41); repository functions still pending.

**US-43 (`ownership-transfer` desde Postgres)**: aplazada a la Fase 3 por decision C del dueno (commit `9ac7b4c`). No la toca US-44; sin accion.

### Now Unblocked by This Archive

US-44 implementers can now rely on the three specs (`become-seller-page-api`, modified `extended-identity-data-layer`, modified `data-layer-clock-policy`) being the authoritative source. Down-stream changes that depend on the `become_seller` service layer can now read from these specs without awaiting further implementation.

## Compliance Summary

✅ **Spec merge completed**: 1 new domain created (become-seller-page-api, 4 requirements), 1 existing domain modified (extended-identity-data-layer, barrel export clarified), 1 existing domain extended (data-layer-clock-policy, clock binding realized + test restoration pattern), all requirements preserved, all original scenarios survived  
✅ **No destructive changes**: No requirements removed, no scenarios deleted from existing specs  
✅ **Out of Scope prose updated**: `extended-identity-data-layer` now accurately lists only `shop_staff` (US-42) as pending; notes that `become_seller` repository was delivered in US-44  
✅ **Archive folder verified**: All 9 artifacts present (exploration, proposal, specs, design, tasks, apply-progress, verify-report, archive-report)  
✅ **Task completion gate passed**: 37/37 tasks marked `[x]`, no stale unchecked implementation tasks  
✅ **Verification verdict acknowledged**: PASS WITH FINDINGS; all 3 findings corrected in `16e67ca` before archive; no CRITICAL issues  
✅ **Date-prefixed archive created**: `openspec/changes/archive/2026-09-15-become-seller-postgres/`  
✅ **Source folder removed**: `openspec/changes/2026-09-15-become-seller-postgres/` no longer exists  
✅ **Main specs updated**: `openspec/specs/become-seller-page-api/spec.md` (NEW), `openspec/specs/extended-identity-data-layer/spec.md` (MODIFIED barrel export), and `openspec/specs/data-layer-clock-policy/spec.md` (MODIFIED clock binding + ADDED test restoration) now contain merged authoritative requirements  
✅ **Corrected clock-policy requirement preserved**: The ADDED requirement in R9 describes the **correct** mechanism (afterEach per describe + afterAll safety net), not the originally speculated mechanism that `sdd-verify` found unimplementable

## Next Steps

1. **Immediate**: Authors of dependent US (US-42 for `shop_staff`) can now reference the merged specs for consistency.
2. **Spec maintenance**: Main specs now the authoritative source; delta artifacts remain in archive audit trail.
3. **Adjacent improvements noted but not actioned**: 
   - `become-seller.entity.ts` declares `missions` (incorrect plural) instead of `commissions`; service layer works around via local type + cast. Not touched per scope.
   - `db/schema.sql` lines for `become_seller` comment (clock-policy binding) shifted from `:479-484` (US-41) to new line numbers post-US-44 DDL insertion; no regression, but future specs that cite line numbers should re-verify.

---

**Generated by**: sdd-archive executor  
**Archive Date**: 2026-09-18 (change name date: 2026-09-15)  
**Mode**: openspec  
**Spec Merge Confirmation**:
- `become-seller-page-api` created (NEW, 4 requirements)
- `extended-identity-data-layer` modified (barrel export: 1 MODIFIED requirement)
- `data-layer-clock-policy` extended (clock binding realized + test restoration: 1 MODIFIED + 1 ADDED requirement)  
**Scenario Count**: All 6 pre-existing requirements of `data-layer-clock-policy` preserved with all 10 scenarios intact; modified R7 adds 3 new scenarios; added R9 adds 4 new scenarios; total post-merge scenarios 10 (original) + 3 (modified R7) + 4 (added R9) = 17 scenarios in data-layer-clock-policy alone.
**Out of Scope Update**: `extended-identity-data-layer` now lists only `shop_staff` (US-42) as pending repository; `become_seller` (US-44) removed from scope prose with explanatory note.
