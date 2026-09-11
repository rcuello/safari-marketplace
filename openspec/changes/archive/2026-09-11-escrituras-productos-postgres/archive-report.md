# Archive Report — Escrituras de productos con categorías y tags (US-29)

**Archived**: 2026-09-11  
**Artifact Store**: openspec  
**Change**: `escrituras-productos-postgres` (archived to `openspec/changes/archive/2026-09-11-escrituras-productos-postgres/`)

## Executive Summary

US-29 implements write operations (`POST`/`PUT`/`DELETE /api/products`) for products with category and tag pivots, pre-validated CHECK constraints in code, shop ownership validation, and a consistent 20-key projection. Four delta specs were successfully merged into main specs:

1. **`product-write-api/spec.md`** (NEW) — Full spec for write capability
2. **`category-tree-api/spec.md`** (MODIFIED) — CA-3 scenario: `UNTESTED` → `COMPLIANT`
3. **`product-listing-api/spec.md`** (MODIFIED) — Out of Scope section updated
4. **`catalog-write-foundations/spec.md`** (MODIFIED) — Added scenario documenting five CHECK rules pre-validation

Verification verdict: **PASS WITH WARNINGS** — archivable per orchestrator instruction.

## Spec Merges Performed

### 1. Product Write API (`product-write-api/spec.md`)

**Action**: NEW spec created at `openspec/specs/product-write-api/spec.md`

**Content**: Full specification covering 14 requirements:
- CA-1: Creation with pivots and visibility
- CA-2: Edit with semantic on pivots, slug immutable
- CA-3: Delete with snapshot capture, cascading deletes
- CA-4: Five CHECK/`IN` rules pre-validated (rebaja, simple-price, product_type `IN`, status `IN`)
- CA-4: Numeric frontier and FK/pivot existence
- CA-4: 404 on non-existent IDs in PUT/DELETE
- CA-5: Shop ownership matrix across three routes
- CA-6: Variable product derivation (min/max, null price)
- D29-7: Projection of 20 keys without `related_products`
- D-2/R29-6: Out-of-scope fields accepted and discarded
- CA-7: No orphaned mock, seed counts preserved

### 2. Category Tree API (`category-tree-api/spec.md`)

**Action**: MODIFIED requirement "Borrado re-enraíza a las hijas y devuelve el snapshot pre-borrado (CA-3)"

**Change**: The scenario **"CA-3 — los enlaces de producto desaparecen"** transitioned from:
- **Before**: `UNTESTED (verificación diferida a US-29)` — no route existed to populate `category_product`
- **After**: `COMPLIANT, cerrado por US-29` — evidence confirmed over sentinel category (never seeded) linked to product created via `createProduct()`, DELETE verified 0 rows in `category_product`, product survives

**Rationale**: US-29 implemented the first HTTP write route capable of populating `category_product` via `POST /products`. Verify report § 3.7 provides independent reproducible evidence: sentinel category `id 889` linked to sentinel product `id 1483` (slug prefix `zz-products-`), post-DELETE `category_product` count 0, product row 1483 intact.

### 3. Product Listing API (`product-listing-api/spec.md`)

**Action**: MODIFIED `## Out of Scope` section (prose only, no requirement changes)

**Change**: Replaced the bullet point:
- **Before**: `` `category_product` (vacía por diseño del seed); `db/schema.sql`; frontend. ``
- **After**: `` `category_product`: deja de estar vacía por diseño del seed — `product-write-api` (US-29) es la primera ruta capaz de poblarla, y `listProducts` la lee sin cambios de código, como ya hacía; `db/schema.sql`; frontend. ``

**Rationale**: Declarative update; `listProducts` read behavior unchanged (verified in verify report § 3.4 curl demonstrating filter by `categories.slug:cereal` returns newly-linked product).

### 4. Catalog Write Foundations (`catalog-write-foundations/spec.md`)

**Action**: MODIFIED requirement "Contrato dominio → HTTP es un conjunto cerrado de 5 códigos (CA-4, CA-7)"

**Change**: Added new scenario **"Las cinco expresiones CHECK/`IN` de `products` quedan pre-validadas — cobertura confirmada (CA-7, US-29)"**

**Content**: Documents that the five `products` rules are covered:
- 1 inherited-as-is: `products_rebaja_valida` (from `upsertScrapedProduct`, adapted with `price != null` disjunct per DD29-9)
- 3 new guards: `products_simple_con_precio`, `IN` of `product_type`, `IN` of `status`
- 1 by construction: `products_procedencia_completa` (input type never declares `source_*`)

**Verification**: Verify report § 5 provides mapping table of all five rules to their code guards (5 `it` cases), integration tests (all green), and HTTP evidence (§ 3.1 cases 1-16 show no 500 errors, only 400/404/401 as specified).

## Compliance Checklist

### Task Completion Gate (Skill Requirement)

- [x] All 39 tasks reviewed; 38 marked `[x]`, 1 intentional-pending (`5.9 — smoke visual del admin`)
- [x] No unchecked implementation tasks; 5.9 is UI verification (non-blocking per orchestrator and verify verdict)
- [x] Verify report verdict: **PASS WITH WARNINGS** — archivable per orchestrator instruction (§ 6, ítem 1, verify § 10)

### Spec Merge Compliance

- [x] Product Write API: NEW spec created with full content (14 requirements, 20 scenarios)
- [x] Category Tree API: CA-3 scenario updated from UNTESTED → COMPLIANT with evidence reference
- [x] Product Listing API: Out of Scope section rewritten (prose only, no requirement changes)
- [x] Catalog Write Foundations: New scenario added documenting five CHECK expressions
- [x] All four delta specs successfully merged; no requirements removed or lost

### Archive Integrity

- [x] Change folder moved to `openspec/changes/archive/2026-09-11-escrituras-productos-postgres/`
- [x] Archive contains all artifacts: `proposal.md`, `specs/`, `design.md`, `tasks.md`, `verify-report.md`
- [x] No modifications to other archived changes
- [x] No destructive deltas identified (all changes additive or corrective)

## Known Outstanding Items

### Ítem 1: Task 5.9 — Smoke-test del admin (PENDING, non-blocking)

**Status**: Unchecked in tasks.md, marked `[ ] 5.9 Smoke-test en el navegador declarado (sin tocar el frontend)`.

**Scope**: Admin UI redirect after `PUT /products/:id` — verify that the form lands on `/products/{slug}/edit` with saved values.

**Risk Residual**: LOW (verify § 6, ítem 1):
- Zero lines changed in `apps/admin` or `apps/shop` (git diff clean)
- Redirect depends solely on `slug` in PUT response, which is invariant
- Scenario CA-2 verifies `slug` presence and immutability over HTTP (§ 3.4)

**Resolution**: Orchestrator to execute smoke or formally accept as verification debt. **Does NOT block archiving** (per verify verdict § 10).

### Ítem 2: Default 403 for `staff` without explicit model (WARNING-1, design assumption)

**Observed**: `staff` token receives 403, not due to an explicit staff↔shop relation rule, but because the role is not the shop's `owner_id`.

**Current State**: Correct today (no staff↔shop relation modeled per decision 8 of US-29 design).

**Future Risk**: This assumption expires when a staff↔shop relation is introduced. The guard will need refactoring to distinguish "not owner" (current 403) from "staff but not authorized" (future 403).

**Mitigation**: Recorded in verify report § 6 as WARNING-1; recommended for epic-level design note on the auth/ownership model.

### Ítem 3: vitest.config.ts — new surface (declared deviation)

**File**: `packages/db/vitest.config.ts` (16 lines, `fileParallelism: false`)

**Discovery**: Not listed in US-29's «Archivos a crear/modificar» table, but declared as **surface deviation** in three independent locations:
- `design.md` (DD29-10, File Changes table)
- `tasks.md` (task 1.10, user decision 3 on 2026-09-11)
- `apply-progress.md` (Decisions Encountered / Deviations)

**Purpose**: Resolves pre-existing latent flake in `shops.integration.test.ts` (absolute `productsCount` assertions racing live rows with other workers).

**Verification**: Verify re-ran `just db-check` 186/186 with pinned counts (198/83/584/82/188/44) passing — confirms the config solves the race without regressing shared test state.

### Ítem 4: Real defect found and fixed mid-cycle (`manufacturer_id: null` coercion)

**Discovery**: PR#4's unit test (demanded by R29-7) caught `Number(null) === 0` in `products.service.ts:create()`.

**Fix**: Commit `20dddfb` adds three-way distinction (`undefined` → omitted · `null` → null · rest → `Number(...)`).

**Audit Trail**: The error, authorization, and re-run are documented in apply-progress.md; the test remains red-green recorded; fix is end-to-end verified in verify § 3.5 (row 1482 has `manufacturer_id NULL`, not `0`).

**Lesson**: Process worked as designed — the test did not weaken or disappear.

## Coverage Summary (from verify-report.md)

### Gates Re-run by Auditor

- ✅ `just db-build` — tsup dist build successful
- ✅ `just db-check` — 186/186 tests pass (vitest integration + typecheck)
- ✅ `npx jest` (apps/api/rest) — 204/204 tests pass across 9 suites
- ✅ `just build-api` — NestJS compile clean
- ⚠️ `just build` — Not re-run (cero líneas de frontend cambiadas; WARNING-2)

### Scenario Compliance

All 20 scenarios across four delta specs: **20/20 COMPLIANT**

| Spec | Scenarios | Status |
|------|-----------|--------|
| `product-write-api` | 14 | ✅ COMPLIANT (CA-1 through CA-7) |
| `catalog-write-foundations` | 4 | ✅ COMPLIANT (closed-set mapping, new CHECK lesson) |
| `category-tree-api` (CA-3 update) | 2 | ✅ COMPLIANT (inheritance from US-28 + new scenario) |
| `product-listing-api` (prose) | 0 | N/A (no requirement changes) |

### Database Integrity

- Baseline → Execution → Restoration:
  - `products`: 1200 → (test run) → 1200
  - `category_product`: 0 → (test run) → 0
  - `product_tag`: 0 → (test run) → 0
  - `categories`: 198 → (test run) → 198
  - `tags`: 10 intact
  - `shops`: 12 intact
  - `users`: 3 intact
  - All sentinel rows (prefixes `zz-*`) deleted post-test

### Five CHECK Rules Coverage (Herencia 2)

| Rule | Expression | Guardianship | Verification |
|------|-----------|--------------|--------------|
| 1 | `products_rebaja_valida` | Inherited-adapted (DD29-9 adds `price != null`) | Code + integration + HTTP 400 ✅ |
| 2 | `products_simple_con_precio` | New guard | Code + integration + HTTP 400 ✅ |
| 3 | `product_type IN ('simple','variable')` | New guard | Code + integration + HTTP 400 ✅ |
| 4 | `status IN ('publish','draft')` | New guard | Code + integration + HTTP 400 ✅ |
| 5 | `products_procedencia_completa` | By construction (type excludes `source_*`) | HTTP + psql (NULL persisted) ✅ |

**Count**: 1 inherited-adapted / 3 new / 1 by construction. **Exact match to task 5.6 requirement.**

## No Modifications to Protected Files

```bash
git diff --stat main...HEAD -- \
  slug.ts domain-errors.ts common/errors/ \
  db/schema.sql \
  apps/shop apps/admin \
  upsertScrapedProduct
```

✅ Empty diff on all protected boundaries.

## Files Archived

The complete change folder now resides at:
```
openspec/changes/archive/2026-09-11-escrituras-productos-postgres/
├── proposal.md
├── specs/
│   ├── product-write-api/spec.md
│   ├── category-tree-api/spec.md
│   ├── product-listing-api/spec.md
│   └── catalog-write-foundations/spec.md
├── design.md
├── tasks.md (38/39 marked complete; 5.9 intentional-pending)
├── apply-progress.md
├── verify-report.md
└── exploration.md
```

## Archive Verdict

**Status**: SUCCESS

All four delta specs merged into main specs per `openspec-convention.md`. Change folder archived with complete audit trail. Task completion gate passed (no unchecked implementation tasks; 5.9 is UI verification, non-blocking per orchestrator and verify verdict).

The SDD cycle for `escrituras-productos-postgres` is complete. Ready for the next change.

---

**Archived by**: sdd-archive (executor)  
**Archive Date**: 2026-09-11  
**Artifact Store Mode**: openspec  
**Next Phase**: None — cycle complete. Ready for `us-30-escrituras-tiendas-postgres` or other queued change.
