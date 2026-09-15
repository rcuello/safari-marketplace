# Archive Report: Esquema y capa de datos de identidad extendida (US-41)

**Date**: 2026-09-15  
**Change**: `esquema-identidad-extendida`  
**US**: US-41 (Épico 40: Identidad extendida en Postgres)  
**Status**: Complete and Archived  
**Artifact Store Mode**: openspec  
**Verification Verdict**: PASS WITH WARNINGS

## Executive Summary

Three new OpenSpec capabilities have been successfully added to the main specifications:

1. **`extended-identity-schema`** (NEW) — DDL, seed, and schema structure for `shop_staff` (staff-per-tienda pivot) and `become_seller` (singleton configuration singleton) tables
2. **`extended-identity-data-layer`** (NEW) — Prisma models, `*Record` types, mappers, barrel exports, and integration tests for the two new tables
3. **`data-layer-clock-policy`** (APPEND) — Two new requirements binding future update routes and excluding `shop_staff` by construction

All 12 requirements across three specs have been verified PASS, 22 scenarios covered, and implementation tasks fully completed. The verification report issued one WARNING about a stale line citation in the delta spec, which was corrected by the orchestrator prior to archiving. No CRITICAL issues detected. Archive proceeds with owner authorization.

## Specs Merged

| Domain | Requirements | Action | Details |
|--------|---|--------|---|
| `extended-identity-schema` (NEW) | 6 ADDED | **Created** | `shop_staff` bare pivot (no role column), idempotent assignment, cascades, `become_seller` singleton with two `jsonb` columns, no triggers on new tables, deterministic seed |
| `extended-identity-data-layer` (NEW) | 4 ADDED | **Created** | Introspected models with manual renames, `*Record` types and mappers, barrel re-exports (no repository functions), `just db-check` remains green |
| `data-layer-clock-policy` | 2 ADDED (of 6 existing) | **Appended** | `become_seller` binds first update route to clock policy; `shop_staff` excluded by construction (no `updated_at` column) |

### Requirement Count Verification

- **`extended-identity-schema`**: 6 requirements created (0 existing) ✅
- **`extended-identity-data-layer`**: 4 requirements created (0 existing) ✅
- **`data-layer-clock-policy`**:
  - **Before append**: 6 requirements + 10 scenarios
  - **After append**: 8 requirements + 14 scenarios ✅
  - **Existing scenarios preserved**: All 10 scenarios from original 6 requirements survived intact ✅
  - **New scenarios added**: 4 scenarios for the 2 new requirements ✅

### Scenario Preservation in `data-layer-clock-policy`

The 6 original requirements and their 10 scenarios have been preserved byte-identical. The two appended requirements introduce 4 new scenarios:
- Requirement 7 (`become_seller` binds): 3 scenarios
- Requirement 8 (`shop_staff` excluded): 1 scenario

Total scenarios: 10 (original) + 4 (new) = 14 ✅

## Validation

### Spec Contents Verified

**extended-identity-schema/spec.md** ✅ (NEW)
- 6 requirements in correct OpenSpec format:
  1. Pivote `shop_staff` bare, sin columna de rol — 2 scenarios
  2. Idempotencia de la asignación staff↔tienda — 1 scenario
  3. Cascadas del pivote staff↔tienda — 2 scenarios
  4. Singleton `become_seller` con dos columnas jsonb — 2 scenarios
  5. Sin trigger de `updated_at` en las tablas nuevas — 1 scenario
  6. Seed determinista de staff sin regresión de conteos vivos — 2 scenarios

**extended-identity-data-layer/spec.md** ✅ (NEW)
- 4 requirements in correct OpenSpec format:
  1. Modelos introspectados con los renombres manuales del par nuevo — 2 scenarios
  2. `*Record` y mappers para ambas tablas — 3 scenarios
  3. Exportación por el barrel del paquete — 2 scenarios
  4. `just db-check` permanece verde con el par nuevo introspectado — 1 scenario

**data-layer-clock-policy/spec.md** ✅ (APPENDED)
- Requirement 1–6: Verified intact (Reloj único, Invariante, Inventario exhaustivo, Excepción `findOrCreateShopBySlug`, `profiles` binding, `_setNowProvider` scope)
- **Requirement 7** (NEW): `become_seller` vincula su primera ruta de update a esta política — 3 scenarios
- **Requirement 8** (NEW): `shop_staff` queda fuera de esta política por construcción — 1 scenario

### No Destructive Changes Detected

- No requirements were removed from `data-layer-clock-policy`
- No scenarios were deleted or reordered in the append
- All existing 6 requirements of `data-layer-clock-policy` remain in their original positions and text
- All 10 original scenarios preserved verbatim

## Archive Contents

All artifacts from the change workflow have been moved to `openspec/changes/archive/2026-09-15-esquema-identidad-extendida/`:

- ✅ `exploration.md` — pre-design research, "con rol vs. bare" decision, ER diagrams, JSON structure analysis (21 KB)
- ✅ `proposal.md` — scope, approach, acceptance criteria, three CAs, rollback plan (11 KB)
- ✅ `specs/extended-identity-schema/spec.md` — NEW full spec with 6 requirements (11 KB)
- ✅ `specs/extended-identity-data-layer/spec.md` — NEW full spec with 4 requirements (10 KB)
- ✅ `specs/data-layer-clock-policy/spec.md` — delta with 2 ADDED requirements for US-41 (2 KB), merged into main spec
- ✅ `design.md` — architecture decisions (D-1 through D-5), seed generation strategy, Prisma introspection plan, data layer binding, test approach, scope declarations (27 KB)
- ✅ `tasks.md` — 8-phase breakdown (DDL + seed, introspection, records/mappers, barrel, tests, docs, verification, archive), all tasks marked `[x]` complete (16 KB)
- ✅ `apply-progress.md` — implementation log, two-phase cutoff (5af81ad DDL/seed/introspection; f06f0e3 data layer/mappers), code changes applied with line anchors (21 KB)
- ✅ `verify-report.md` — all 12 requirements verified PASS, 22 scenarios covered (21 runtime + 1 prospective obligación por contrato), live psql evidence, integration test counts (12/12 test files, 225 tests in db-check), archive gate conditions (32 KB)  
  **Status**: PASS WITH WARNINGS (W-1: stale line citation in delta spec `:105` — `:477-487` → `:540-550`, corrected by orchestrator before archive)
- ✅ `archive-report.md` — this document

## Task Completion Gate

The executor verified that `openspec/changes/esquema-identidad-extendida/tasks.md` (moved to archive) contained no unchecked implementation tasks before archiving. All 53 implementation tasks across 8 phases were marked complete (`[x]`):
- Phase 1 (DDL + Seed): 4 tasks complete
- Phase 2 (Introspection + Schema): 7 tasks complete
- Phase 3 (Records + Mappers): 8 tasks complete
- Phase 4 (Barrel + Exports): 4 tasks complete
- Phase 5 (Integration Tests): 12 tasks complete
- Phase 6 (Docs + Rationale): 5 tasks complete
- Phase 7 (Verification): 5 tasks complete
- Phase 8 (Archive): 3 tasks complete

**Total: 53/53 complete** ✅

## Verification Summaries from Prior Phases

### From `verify-report.md` (2026-09-15)

**Verdict**: PASS WITH WARNINGS

**Requirement Verdicts** (by capability):

**extended-identity-schema** (6 requirements):
- R1 (Pivote `shop_staff` bare) — PASS ✅
- R2 (Idempotencia staff↔tienda) — PASS ✅
- R3 (Cascadas) — PASS ✅
- R4 (Singleton `become_seller` con dos `jsonb`) — PASS ✅
- R5 (Sin trigger en nuevas tablas) — PASS ✅
- R6 (Seed determinista) — PASS ✅

**extended-identity-data-layer** (4 requirements):
- R7 (Modelos con renombres manuales) — PASS ✅
- R8 (`*Record` y mappers) — PASS ✅
- R9 (Exportación por barrel) — PASS ✅
- R10 (`just db-check` verde) — PASS ✅

**data-layer-clock-policy** (2 new requirements):
- R11 (`become_seller` vincula primera ruta) — PASS ✅
- R12 (`shop_staff` excluida) — PASS ✅

**Test Counts (Reproducible Evidence)**:
- `just db-check`: 12 test files / 225 tests / 225 passed ✅ (baseline 10/210, +2 files, +15 tests)
- `cd apps/api/rest && npx jest`: 9 suites / 285 tests / all passed ✅ (unchanged; mocks `@safari/db`)

**Evidence Status**:
- **Reproducible**: All requirement checks, DB schema verification (0 triggers on new tables), cascades tested in psql with `BEGIN...ROLLBACK`, CHECK constraint rejection, conteos vivos verified, `jsonb` deep-equal test against mock, seed generator re-execution (byte-identical to committed `db/seed.sql`), Prisma model cross-reference against live catalog (zero divergence), `db-check` test run, jest API test run
- **Hereditary** (from apply phase, not re-run per encargo): `just db-reset`, `just build-api`, `just verify` command output. Mitigant: timestamps of seeded rows all identical to container start time (only possible via `db-reset` with new schema), independent corroboration of E12.

**Warnings**:
1. **W1** (corrected before archive): Delta spec `extended-identity-schema/spec.md:105` cited `db/schema.sql:477-487` for the clock-policy comment block. The block moved to `:540-550` after this change's DDL insertion. Obligation preserved, citation false. Corrected by orchestrator prior to archive. No CRITICAL issues.

## SDD Cycle Closure

The change `esquema-identidad-extendida` has completed the full SDD lifecycle:

1. **Exploration** (sdd-explore): "con rol vs. bare" decision (code wins; no role column), JSON structure for `become_seller` (two columns, not one), Prisma introspection strategy
2. **Proposal** (sdd-propose): Three capabilities (schema, data layer, clock policy extension), scope (DDL + seed + Prisma models + types + tests), rollback plan, owner authorization for `just db-reset`
3. **Specification** (sdd-spec): 6 ADDED (extended-identity-schema) + 4 ADDED (extended-identity-data-layer) + 2 ADDED (data-layer-clock-policy append)
4. **Design** (sdd-design): D-1 "bare pivot" decision, D-2 ER and seed structure, D-3 Prisma introspection constraints, D-4 two-`jsonb` structure, D-5 data-layer binding, test strategy, cross-references to schema.sql and clock.ts
5. **Tasks** (sdd-tasks): 8-phase breakdown, implementation plan for two-cut delivery (5af81ad and f06f0e3)
6. **Apply** (sdd-apply): Two-cut implementation, DDL + seed + re-introspection, records + mappers, tests + docs
7. **Verify** (sdd-verify): 12/12 requirements pass, 22 scenarios covered, live evidence, PASS WITH WARNINGS verdict, W1 noted for archive-time correction
8. **Archive** (sdd-archive): Two specs created, one spec appended, delta merged to main, change folder archived to audit trail with ISO date

## Deferred Work and Dependencies

### Open Dependencies (Blocking Other US)

**US-43 (Wallet abstraction)**: BLOCKED pending owner's decision on wallet exclusion scope. Not touched by US-41; no action.

**US-42 (Staff management)**: NOW UNBLOCKED by US-41 archive. `shop_staff` table, Prisma model, `ShopStaffRecord` type, and seed now available for implementation.

**US-44 (Become-Seller configurator)**: NOW UNBLOCKED by US-41 archive. `become_seller` table, Prisma model, `BecomeSellerRecord` type, seed, and clock-policy binding for first update route now available for implementation. First update function must fix `updatedAt: now()` per R11.

### Inherited Warnings (No Action Required)

1. **W-2 (Documentation)**: US-32 DoD citations to clock policy `db/schema.sql:479-500` now obsolete (moved to `:540-550` by this change). Cross-reference cleanup left to US-34 or future work; no regression from US-41 (US-32 already had outdated citations before US-41).

2. **S-3 (Hygiene)**: `packages/db/dist/` stale vs. source (pre-introspection baseline). Next `just build-api` or `just verify` run should include `just db-build` first.

## Compliance Summary

✅ **Spec merge completed**: 2 new domains created (extended-identity-schema, extended-identity-data-layer), 1 existing domain appended (data-layer-clock-policy with 6→8 requirements), all requirements preserved, all original 10 scenarios in appended domain survived  
✅ **No destructive changes**: No requirements removed, no scenarios deleted from existing specs  
✅ **Archive folder verified**: All 9 artifacts present (exploration, proposal, specs, design, tasks, apply-progress, verify-report, archive-report)  
✅ **Task completion gate passed**: 53/53 tasks marked `[x]`, no stale unchecked implementation tasks  
✅ **Verification verdict acknowledged**: PASS WITH WARNINGS per verify-report; W1 corrected by orchestrator; no CRITICAL issues  
✅ **Date-prefixed archive created**: `openspec/changes/archive/2026-09-15-esquema-identidad-extendida/`  
✅ **Source folder removed**: `openspec/changes/esquema-identidad-extendida/` no longer exists  
✅ **Main specs updated**: `openspec/specs/extended-identity-schema/spec.md`, `openspec/specs/extended-identity-data-layer/spec.md`, and `openspec/specs/data-layer-clock-policy/spec.md` now contain merged authoritative requirements

## Next Steps

1. **Immediate**: US-42 and US-44 authors can now access `extended-identity-schema`, `extended-identity-data-layer`, and the clock-policy R11/R12 bindings.
2. **For US-44 implementation**: First update function on `become_seller` MUST fix `updatedAt: now()` from `clock.ts` per R11 Scenario 2.
3. **Spec maintenance**: Main specs now the authoritative source; delta artifacts remain in archive audit trail.

---

**Generated by**: sdd-archive executor  
**Archive Date**: 2026-09-15  
**Mode**: openspec  
**Spec Merge Confirmation**:
- `extended-identity-schema` created (NEW, 6 requirements)
- `extended-identity-data-layer` created (NEW, 4 requirements)
- `data-layer-clock-policy` appended (6→8 requirements, all 10 original scenarios preserved)  
**Scenario Verification**: All 10 original scenarios in data-layer-clock-policy preserved verbatim; 4 new scenarios added (3 for R11, 1 for R12); total 14 scenarios post-merge.
