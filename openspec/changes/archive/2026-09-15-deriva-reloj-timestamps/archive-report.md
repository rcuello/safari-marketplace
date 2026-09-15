# Archive Report: Un solo reloj para `created_at` y `updated_at` (US-32)

**Date**: 2026-09-15  
**Change**: `deriva-reloj-timestamps`  
**Status**: Complete and Archived  
**Artifact Store Mode**: openspec  
**Verification Verdict**: PASS WITH WARNINGS

## Executive Summary

Six new requirements have been successfully added to the main OpenSpec specifications in a new domain (`data-layer-clock-policy`), and one requirement has been modified in an existing domain (`category-tree-api`) to reflect the architecture decision to move timestamp control from database triggers to the application layer. The policy declares a single clock source per row for `created_at` and `updated_at` across five tables (`products`, `categories`, `shops`, `users`, `profiles`) and establishes the binding rule for future tables. All implementation tasks were completed and verified in prior phases. The verification report was issued with warnings about test coverage for one update route and outdated DoD metrics, but no CRITICAL issues. Archive proceeds with owner authorization.

## Specs Merged

| Domain | Requirement(s) | Action | Details |
|--------|---|--------|---|
| `data-layer-clock-policy` (NEW) | 6 ADDED requirements | **Created** | Single-clock policy for 5 tables, documenting clock scope, invariant, exhaustive update inventory, exemption for `findOrCreateShopBySlug`, future table binding rule, and `_setNowProvider` scope |
| `category-tree-api` | Edición y reenraizado sin ciclos, slug inmutable (CA-2) | **MODIFIED** | Updated requirement text to reflect clock moved from trigger to `updatedAt: now()` in repository layer; both original scenarios preserved |

### Requirement Count Verification

- **Before merge**: `category-tree-api/spec.md` contained 18 requirements
- **After merge**: `category-tree-api/spec.md` contains 18 requirements ✅
- **New domain created**: `data-layer-clock-policy/spec.md` with 6 new requirements ✅

### Scenario Preservation in MODIFIED Requirement

The CA-2 requirement in `category-tree-api` originally contained two scenarios:
1. "renombrar no cambia el slug" (rename preserves slug)
2. "mover una categoría a otra madre válida" (move category to valid parent)

Both scenarios have been preserved byte-identical in the merged spec. The only change is to the requirement prose:
- **Removed**: "la columna la fija un trigger de base de datos, no el repositorio, así que su verificación MUST comparar por monotonía contra el reloj de la base, nunca por igualdad contra un reloj fijado en el test"
- **Added**: "la columna la fija el repositorio (`updatedAt: now()` desde `packages/db/src/clock.ts`), no un trigger de base de datos, así que su verificación MUST comparar por monotonía o por igualdad contra el reloj de aplicación fijado en el test, nunca contra el reloj del servidor de Postgres"

The delta's `(Previously: ...)` scaffolding parenthetical has been excluded from the main spec per OpenSpec convention (audit trail belongs in delta, not published spec).

## Validation

### Spec Contents Verified

**data-layer-clock-policy/spec.md** ✅ (NEW)
- 6 requirements in correct OpenSpec format:
  1. Reloj único por fila, sin trigger de base de datos — 2 scenarios
  2. Invariante `updated_at >= created_at` — 1 scenario
  3. Inventario exhaustivo de rutas de `UPDATE` — 2 scenarios
  4. Excepción de actualización vacía en `findOrCreateShopBySlug` — 1 scenario
  5. `profiles` vincula su primera ruta de update futura a esta política — 2 scenarios
  6. Alcance documentado de `_setNowProvider` — 2 scenarios

**category-tree-api/spec.md** ✅
- Line 198: `### Requirement: Edición y reenraizado sin ciclos, slug inmutable (CA-2)` correctly updated
- Prose reflects clock policy move: `updatedAt: now()` from `packages/db/src/clock.ts`, allowing both monotonía and fixed-clock test verification
- Line 208: Scenario 1 preserved: "renombrar no cambia el slug"
- Line 214: Scenario 2 preserved: "mover una categoría a otra madre válida"
- Next requirement (CA-3, line 220) starts correctly and unmodified

### No Destructive Changes Detected

- No requirements were removed from any spec
- No scenarios were deleted or reordered
- All existing requirements in `category-tree-api` remain in their original positions
- The main spec now reflects the implemented architecture (clock in Node, not triggers)

## Archive Contents

All artifacts from the change workflow have been moved to `openspec/changes/archive/2026-09-15-deriva-reloj-timestamps/`:

- ✅ `exploration.md` — pre-design research and domain analysis (20 KB)
- ✅ `proposal.md` — scope, approach, rollback plan, CA listing (10 KB)
- ✅ `specs/data-layer-clock-policy/spec.md` — NEW full spec with 6 requirements (7 KB)
- ✅ `specs/category-tree-api/spec.md` — delta with 1 MODIFIED requirement (2 KB)
- ✅ `design.md` — architecture decisions (D-1 through D-6), key discovery D-4, cross-references to clock.ts, test strategy (26 KB)
- ✅ `tasks.md` — 7-phase breakdown (DDL, re-introspection, repos, tests, docs, verification, post-review corrections), all tasks marked `[x]` complete (15 KB)
- ✅ `apply-progress.md` — implementation log, code changes applied with line anchors, gate re-run findings (F-1, F-2, R-1, R-3, R-5) (18 KB)
- ✅ `verify-report.md` — all 7 requirements verified PASS, 12 scenarios covered (10 runtime + 1 prospective + 1 reasoning), live psql evidence, test counts (209/209 on db-check, 285/285 on jest), archive gate conditions (31 KB)  
  **Status**: PASS WITH WARNINGS (W-1: `updateUserPasswordHash` lacks `updatedAt` test; W-2: DoD metrics frozen at pre-gate-rerun state; W-3: forecast underestimated by ~75%)
- ✅ `archive-report.md` — this document

## Task Completion Gate

The executor verified that `openspec/changes/deriva-reloj-timestamps/tasks.md` (moved to archive) contained no unchecked implementation tasks before archiving. All 47 implementation tasks across 7 phases were marked complete (`[x]`):
- Phase 1 (DDL): 1 task complete
- Phase 2 (Rebuild/Re-introspection): 7 tasks complete
- Phase 3 (Repositories): 14 tasks complete (7 call sites, 3 JSDoc rewrites, 1 import per file × 4)
- Phase 4 (Tests): 13 tasks complete (4 integration files, 4 invariant tests, 1 D-4 test, 1 gate re-run test, comment rewrites)
- Phase 5 (Documentation): 2 tasks complete (clock.ts header, README pointer)
- Phase 7 (Post-review corrections): 3 tasks complete (F-1, F-2, R-1, R-3, R-5 noted but not re-executed in Phase 6, recorded in apply-progress)

## Verification Summaries from Prior Phases

### From `verify-report.md` (2026-09-15)

**Verdict**: PASS WITH WARNINGS

**Requirement Verdicts**:
- R1 (Single clock, no trigger) — PASS ✅
- R2 (Invariant `updated_at >= created_at`) — PASS ✅
- R3 (Exhaustive UPDATE inventory) — PASS with W-1 ⚠️
- R4 (Exception: `findOrCreateShopBySlug` empty update) — PASS ✅
- R5 (`profiles` binds future updates) — PASS ✅
- R6 (`_setNowProvider` scope documented) — PASS ✅
- R7 (CA-2 `updated_at` advances on edit, clock from repo) — PASS ✅

**Test Counts (Reproducible Evidence)**:
- `just db-check`: 10 test files / 209 tests / 209 passed ✅
- `cd apps/api/rest && npx jest`: 9 suites / 285 tests / all passed ✅

**Evidence Status**:
- **Reproducible**: All requirement checks, DB schema verification (0 triggers), 5-table invariant proof (1416 rows, 0 violations), psql evidence of single-clock behavior, `db-check` test run, jest API test run
- **Hereditary** (from apply phase, not re-run per encargo): `just build-api` and `just verify` command output (low risk per impact analysis: zero API radio change, 285/285 regression baseline)

**Warnings**:
1. **W-1**: `updateUserPasswordHash` (users.repository.ts:329) lacks specific test protecting its `updatedAt`. The test suite mocks the function but only checks hash and null state, not timestamp advance. Deleting the `updatedAt: now()` line would leave 209/209 green — same class of hole that R-1 fixed for the scraper's upsert, yet unprotected here.
2. **W-2**: DoD metrics in `docs/product/32-deriva-reloj-updated-at-created-at.md` frozen at pre-gate-rerun state: "208/208 tests" (real: 209/209) and "11 archivos" (real: 14 files), contradicting repo rule to close DoD with real output.
3. **W-3**: Forecast of ~241 changed lines underestimated — actual: 472 lines (code: 422 lines, ~75% from tests and gate-rerun corrections). High forecast error on text-heavy changes.

## SDD Cycle Closure

The change `deriva-reloj-timestamps` has completed the full SDD lifecycle:

1. **Exploration** (sdd-explore): Clock source options, trigger drift analysis (±676 ms variable), Node.js vs. Postgres trade-offs
2. **Proposal** (sdd-propose): Scope (5 tables, 6 retailers scraper), approach (move clock to Node), rollback plan
3. **Specification** (sdd-spec): 6 ADDED requirements (data-layer-clock-policy, new domain) + 1 MODIFIED requirement (CA-2 prose update)
4. **Design** (sdd-design): Architecture decisions D-1–D-6, key discovery D-4 (`findOrCreateShopBySlug` no-op UPDATE), test strategy, cross-references to clock.ts and db/schema.sql binding rules
5. **Tasks** (sdd-tasks): 7-phase breakdown, ~241-line forecast (actual: 472), delivery as single atomic unit
6. **Apply** (sdd-apply): Single PR, DDL changes, 7 call sites + `updatedAt: now()`, 4 integration test files, gate re-run, corrections
7. **Verify** (sdd-verify): 7/7 requirements pass, 12 scenarios covered, live evidence, PASS WITH WARNINGS verdict
8. **Archive** (sdd-archive): New spec created, MODIFIED requirement merged, specs synced to main, change folder archived to audit trail with ISO date

## Inherited Deferred Work

The following items remain open as deferred work documented in `verify-report.md`:

1. **W-1 closure recommendation** (low-effort): Add ~15-line test pattern to `users.integration.test.ts` mirroring the 4-file invariant test for `updateUserPasswordHash`, protecting its `updatedAt` via fixed-clock assertion.

2. **W-2 correction required before merge** per owner authorization: Update two lines in `docs/product/32-deriva-reloj-updated-at-created-at.md` to reflect real counts: 209 tests (not 208) and 14 files (not 11).

3. **S-3 cross-reference** (US-34's obligation): `docs/product/33-contenido-configuracion-postgres/34-esquema-capa-datos-contenido.md:238-241` documents triggers that US-32 removed. Author of US-34 (US-32's successor) should review this before implementing the 8 new entity tables that inherit the single-clock policy from `db/schema.sql:477-487`.

4. **S-1 hygiene** (post-work): `packages/db/dist/` is stale vs. source (comment-only edits in F-1, F-2, R-3). Next `just build-api` or `just verify` run should include `just db-build` first.

## Compliance Summary

✅ **Spec merge completed**: 1 new domain created, 1 existing requirement modified, all requirements preserved, both CA-2 scenarios intact  
✅ **No destructive changes**: All existing requirements remain, no scenarios deleted  
✅ **Archive folder verified**: All 8 artifacts present (exploration, proposal, specs, design, tasks, apply-progress, verify-report)  
✅ **Task completion gate passed**: 47/47 tasks marked `[x]`, no stale unchecked implementation tasks  
✅ **Verification verdict acknowledged**: PASS WITH WARNINGS per verify-report; owner authorized archive with noted deferred work  
✅ **Date-prefixed archive created**: `openspec/changes/archive/2026-09-15-deriva-reloj-timestamps/`  
✅ **Source folder removed**: `openspec/changes/deriva-reloj-timestamps/` no longer exists  

## Next Steps

1. **Before merging PR**: W-2 must be corrected (2-line edit to US-32 DoD in `docs/product/`).
2. **After merge**: Recommend W-1 closure (15-line test addition) as quick-follow improvement.
3. **For US-34 author**: Review S-3 cross-reference in `docs/product/34-esquema-capa-datos-contenido.md` before implementing the 8 new tables.
4. **Spec maintenance**: `openspec/specs/data-layer-clock-policy/spec.md` and `openspec/specs/category-tree-api/spec.md` now contain the merged authoritative requirements for future changes.

---

**Generated by**: sdd-archive executor  
**Archive Date**: 2026-09-15  
**Mode**: openspec  
**Spec Merge Confirmation**: data-layer-clock-policy created (NEW); category-tree-api CA-2 MODIFIED (18→18 requirements preserved)  
**Scenario Verification**: Both CA-2 scenarios preserved verbatim in merged requirement
