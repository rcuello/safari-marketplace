# Archive Report: US-6 — Pipeline upsert en `products` con procedencia

**Archived**: 2026-08-28  
**Change ID**: `2026-08-28-pipeline-upsert-products`  
**Capability**: `scraper-product-ingestion`  
**Status**: Complete ✅

## Executive Summary

US-6 implements idempotent upsert in the PostgreSQL `products` table for items scraped from 6 Colombian retailers. The pipeline identifies rows by `(source_store, source_product_id)`, handles get-or-create for shops and manufacturers, validates prices and sale prices, and fails fast if the base taxonomy is missing. Reprocessing the same item updates rather than duplicates. All 23 implementation tasks completed, verified with synthetic and independent pipelines, and 9 requirements satisfied with execution evidence. `just db-check` passes green (48/48 tests); no regression on seed rows (1200 maintained).

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `scraper-product-ingestion` | Created | New capability spec copied to `openspec/specs/scraper-product-ingestion/spec.md` |

## Artifact Inventory

✅ **proposal.md** — Scope, approach, rollback plan (12KB)  
✅ **specs/scraper-product-ingestion/spec.md** — Full spec with 9 requirements and 11 scenarios (4KB)  
✅ **design.md** — Decisiones A–G, helpers, constraints, divergences D-1..D-6 (33KB)  
✅ **tasks.md** — 23 tasks (4 phases) grouped; all [x] checked (4KB)  
✅ **apply-progress.md** — Implementation log, gate verification, Phase 3 evidence, corrections (14KB)  
✅ **verify-report.md** — Full verification, 12-item independent pipeline, CA-1..CA-5 evidenced, three warnings (21KB)  

## Key Outcomes

### Implementation Delivered

1. **PostgresPipeline refactoring**: Single-threaded idempotent upsert via `ON CONFLICT (source_store, source_product_id) WHERE source_store IS NOT NULL DO UPDATE`
2. **Fail-fast on missing taxonomy**: `open_spider` resolves `type_id` by slug; raises `ValueError` with remediation if absent
3. **Precondition validation**: Items without name, url, or valid price (≤0) discarded before persistence with log and counter
4. **Saneo de promoción**: Sale prices >= list price set to NULL (distinct counter: `promociones_descartadas`)
5. **Get-or-create cacheado**: Shops and manufacturers fetched/inserted once per spider run; reused across items
6. **Constraint error capture**: All psycopg errors logged, counted as `fallidos`, corrida continues
7. **Visibility**: Inserted/updated rows queryable via SQL and HTTP endpoints without schema changes

### Specifications Published

- **scraper-product-ingestion**: 9 requirements (idempotent upsert · stable unique slug · cached get-or-create · discount insufficient items · sanitize incoherent promotion · capture unanticipated violations · fail-fast on missing type · visibility in storefront · no regression on seed)
- 11 scenarios, all COMPLIANT with execution evidence
- Declares scope boundaries: categories (US-7), test infrastructure (US-8), spiders, normalization (D-5)

### Quality Gates Passed

- ✅ `just db-check` → 48/48 tests pass (6 integration suites: types, tags, manufacturers, shops, products)
- ✅ `just build-api` → Nest compiles clean
- ✅ Synthetic pipeline (8 items apply + 4 new in verify) → Stats match spec (insertados 6, actualizados 1, fallidos 5, promociones_descartadas 1)
- ✅ Independent verification against real Postgres → 12-item run with overflow error and subsequent success
- ✅ Database baseline restored (0 scraper rows, 1200 seed, 12 shops, 14 manufacturers) before and after verify
- ✅ HTTP CA-5: Products filtered by `manufacturer.slug:acme` return 5 rows with correct prices; detail GET 200

### Bug Fixes and Corrections Applied

Three corrections from independent reviewer (apply-progress.md §Revisión independiente):

1. **Moved FK resolution inside try/catch**: get-or-create for shops/manufacturers now catches psycopg.Error, not escaped
2. **Hardened parse_calificacion**: Added `is_finite()` guard before `quantize()` to handle NaN
3. **Clearer error fallback**: RuntimeError with legible message if SELECT respaldo fails (3-retry logic)

No behavioral changes; re-execution identical output.

## Testing Coverage

| Artifact | Suite | Scenarios | Status |
|----------|-------|-----------|--------|
| Pipeline (apply phase) | Synthetic 8-item run | a–h (UX variants) | ✅ |
| Pipeline (verify phase) | Independent 12-item run | a–l (including i=no-name, j=no-brand, k=overflow, l=post-overflow success) | ✅ |
| Database integration | `just db-check` | 48 tests across 6 suites | ✅ |
| Specification scenarios | Matrix CA-1..CA-5 | 14 scenarios in spec | ✅ COMPLIANT |

## Divergences Declared and Approved

| ID | Decision | Reason | Scope | Impact |
|----|----------|--------|-------|--------|
| D-1 | `type_id` resolved once, fail-fast | Catalog not inventoried by scraper; base taxonomy required | UX-6 | Early error vs item-by-item fallback |
| D-2 | Sale price >= list: nullified, not item drop | Scraper lacks retry/escalation path; preserve good data | UX-6 | Promotion counter tracks separately from `fallidos` |
| D-3 | Price <= 0 discarded | Prevents `price = 0` (false "free") contaminating range filters | UX-6 | Precondition check in Python, backstop in Postgres |
| D-4 | Slug derived once in DB, not updated | Ensures stable identity across re-scrapes | UX-6 | Query index survives repo run |
| D-5 | `normalizar_enlace` **preserves query string** | Known risk: volatile params → duplicate rows in real scrapers | UX-6 | Elevated to repo owner; NOT fixed in this US. CA-1 may break with real data. |
| D-6 | `source_store IS NOT NULL` in conflict key WHERE clause | Seed rows (`source_store IS NULL`) protected by design | UX-6 | ON CONFLICT reaches only scraper rows |

**D-5 flagged as systemic risk**: Query string stability necessary for idempotence but depends on upstream `normalizar_enlace` logic not addressed here.

## Warnings from Verification

Three non-blocking warnings recorded in verify-report.md:

- **W-1**: Fail-fast tested with slug stub (`gadget-inexistente`), not table-missing scenario. `UndefinedTable` error surface is raw; message suppression OK for this US but noted.
- **W-2**: Apply phrase «items after each batch succeeded» was not demonstrable by its own 8-item output (descartes at end). Now proven by verify's (k)→(l) pair.
- **W-3**: `_resolver_referencia` may throw `RuntimeError` (rare path: fila deleted between INSERT and SELECT), outside try/catch. Corrected in revision #1. Probability negligible; ruidoso not silencioso.

## Systemic Findings

**Hallazgo sistémico — no es de esta US**:
- `packages/db/src/repositories/shops.integration.test.ts:17-19` asserts `toBe(12)` and `manufacturers.integration.test.ts:18` asserts `toBe(14)`
- **Any real spider run inserts rows into `shops` and `manufacturers`, causing these tests to fail**
- `products` tests use `toBeGreaterThan`, so survive; catalog tests do not
- Root cause: Tests assume virgin seed state; scraper violates that assumption
- **Decision needed**: US-8 (test infrastructure) or US-10 (full CI gate) must either a) isolate spider runs from test DB, b) dynamic assertions, or c) manual reconciliation
- **Status expected, NOT regression**: `just db-test` and `just db-count` remain red (US-8), as designed

## Files Modified in Repo

Only three files touched, exactly as specified:

```
M  services/scraper-worker/pipelines.py        (+223/-52, final 308 lines)
M  docs/product/5-scraper-catalogo-compartido/6-pipeline-upsert-products.md (+72/-5, Status → Implementada)
M  docs/product/5-scraper-catalogo-compartido/README.md (+5/-5, Status column added, US-6 marked ✅)
```

**Intactos per scope "NO incluye"**: `test_pipeline.py`, `justfile`, all 6 spiders, `items.py`, `db/schema.sql`, `db/seed.sql`, `packages/db`, `apps/**`, `normalizar_enlace` (byte-identical to HEAD).

## Archive Structure

```
openspec/changes/archive/2026-08-28-pipeline-upsert-products/
├── archive-report.md           (this file)
├── proposal.md
├── design.md
├── tasks.md                     (23/23 checked)
├── apply-progress.md            (+ 4 corrections post-review)
├── verify-report.md             (+ independent 12-item verification)
└── specs/
    └── scraper-product-ingestion/
        └── spec.md              (↑ also copied to openspec/specs/)
```

All supporting scripts, JSON baseline captures, and synthetic test data from apply and verify live in session scratchpads (not persisted to repo).

## Cross-Change Context

This change is **independent in scope** (no sibling US like 4a/4b). However:

- **Prerequisite**: US-4a (flat catalogs) and US-4b (category tree) must land first so that product listing/detail endpoints exist and can serve scraped rows
- **Successor dependency**: US-7 (category tagging) depends on this pipeline running; US-8 (test infrastructure) must address the `shops`/`manufacturers` test assertion fragility
- **Shared schemas**: `services/scraper-worker/pipelines.py` is scraper-only; no overlaps with packages/db other than contract (products table)

## Risks Addressed

1. **Idempotence without duplicates**: `ON CONFLICT (source_store, source_product_id) WHERE source_store IS NOT NULL` ensures second identical item updates, not inserts. Verified with (a)+(b) → one row with second price.
2. **Slug collision**: Different shops can have same product name. Slug derivation includes shop → `producto-test-a-alkosto` vs `producto-test-a-falabella` coexist. Same shop homonyms collide in unique constraint → fallidos (expected, documented).
3. **Get-or-create race**: Caching by corrida prevents duplicate shops/manufacturers across items. Verified: 6 items from Alkosto/ACME → 1 shop, 1 manufacturer.
4. **Seed mutation**: `WHERE source_store IS NOT NULL` in conflict key ensures seed rows (`source_store IS NULL`, 1200 rows) never touched. Verified before/after: 1200 rows preserved.
5. **Incomplete data handling**: Items missing price/name/url discarded before touching DB; log + counter track them. 5 discards in 12-item run without aborting corrida.
6. **Out-of-range values**: Postgres constraint errors caught, logged with constraint name map, counted as fallidos. Numeric overflow tested; item (l) after error inserted successfully.

## Delivery Strategy

- **Single PR** (~240-330 LOC): Under 400-line review budget; unified scope
- **Not chained**: Unlike US-4a (3 stacked PRs), this change has cohesive scope: all code in one file, no phased dependencies
- **Verification in depth**: Apply + independent verify with synthetic data ensures all scenarios exercised

## Closure Checklist

- [x] 23/23 implementation tasks completed and checked
- [x] All 9 requirements satisfied with execution evidence
- [x] All 5 CA (acceptance criteria) evidenced (SQL + HTTP)
- [x] Database regression gate passes (48/48)
- [x] Seed baseline preserved (1200 rows pre/post)
- [x] Docs updated: Status + Epic table
- [x] Specifications promoted to main specs
- [x] Three corrections from review applied and re-verified
- [x] Divergences D-1..D-6 and warnings W-1..W-3 documented

## Next Steps

1. **Merge**: PR with 3-file diff ready for main branch
2. **Archive immutable**: `openspec/specs/scraper-product-ingestion/spec.md` is now source of truth; any future divergence from pipeline behavior must be spec-first
3. **Upstream work required**:
   - US-7 (categorization): Dependency chain → scraper must run to populate categories
   - US-8 (test infrastructure): Must address `shops.integration.test` / `manufacturers.integration.test` assertion fragility
   - D-5 (query string normalization): Elevated to repo owner; revisit if real scraper data shows duplicates
4. **Known limitation**: `just db-test` and `just db-count` remain red (expected per US-8 design)

---

**Archived by**: SDD Archive Phase  
**Date**: 2026-08-28  
**Audit Trail**: This report + `openspec/specs/scraper-product-ingestion/spec.md` (promoted to main specs)
