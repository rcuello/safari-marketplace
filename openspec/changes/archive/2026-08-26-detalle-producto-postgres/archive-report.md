# Archive Report — detalle-producto-postgres

**Change**: `detalle-producto-postgres` (US-3, Épico 1)  
**Archived**: 2026-08-26  
**Final Verdict**: **PASS WITH FINDINGS** (0 CRITICAL, 3 WARNING, 4 SUGGESTION)

---

## Executive Summary

The implementation of `GET /api/products/:slug` with related products from Postgres has been completed, verified, and archived. All four acceptance criteria (CA-1 through CA-4) and all spec requirements have been confirmed with real command output. The HTTP contract is preserved exactly: 21-key projection (20 from listing + `related_products`), snake_case order, related-products behavior reflecting the ratified divergence (D-1), domain 404 handling, and error resilience (D-5).

Three warning-level issues identified during verification (H-1, H-2, H-3) were addressed and corrected before archiving. All 26 implementation tasks are marked complete (`[x]`).

---

## Change Archived

**From**: `openspec/changes/detalle-producto-postgres/`  
**To**: `openspec/changes/archive/2026-08-26-detalle-producto-postgres/`  
**Spec Synced**: `openspec/specs/product-detail-api/spec.md` (NEW)

### Verification Evidence

| Aspect | Result |
|--------|--------|
| Task Completion Gate | ✅ All 26 implementation tasks `[x]` complete, 0 unchecked |
| Final Verdict | **PASS WITH FINDINGS** (0 CRITICAL, 3 WARNING fixed, 4 SUGGESTION carried forward) |
| CA-1: Contract parity | ✅ Confirmed — 21 keys (20 + related_products), exact order, byte-identical to evidence |
| CA-2: 404 domain error | ✅ Confirmed — 404 with Nest default body, Spanish message, process stays up |
| CA-3: Related products rule (D-1) | ✅ Confirmed — self-included when within top 20 by id (195/1200, 16.25%), no status/visibility filters |
| CA-4: Shop page render | ✅ Confirmed — 200, `<title>Pickbazar \| Apples</title>`, `pageProps.product` with 21 keys and 20 related |
| D-5: Connection errors | ✅ Confirmed — 503 on Postgres unavailable, 404 persists when base recovers (not swallowed by catch) |
| Tests | ✅ `packages/db`: typecheck clean, `14 passed (14)` vitest; `apps/api/rest`: `20 passed, 20 total` jest (13 existing + 7 new) |
| Diff scope | ✅ 189 insertions / 26 deletions across 6 files (within 400-line budget) |
| Scope compliance | ✅ No changes to `apps/shop/**`, schema, seed, or scraper; all 6 touched files documented in design |

---

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `product-detail-api` | **Created** | Full new spec with 4 requirements (Detail by slug, Related-Products Rule D-1 with divergence table, Domain 404, Connection Errors) + ratified divergence + 8 Gherkin scenarios |

### Key Additions to Spec

1. **Detail by Slug**: 21-key projection (20 from `product-listing-api` + `related_products`), reuses `toProductDto()` mapper, same camelCase→snake_case translation.
2. **Related-Products Rule (D-1, Divergence Ratified)**:
   - Same `type_id`, `ORDER BY id ASC`, `LIMIT 20`
   - **Without self-exclusion** and **without status/visibility filters** (deliberate, user-approved divergence from prior in-code behavior)
   - Self-inclusion occurs only if product id falls within top 20 of its type: **195/1200 products (16.25%)**
   - Consequences table: self-inclusion (conditional), draft-exposure (latent, not observable with current seed)
3. **404 Domain Error**: `NotFoundException` with Nest default body, Spanish message, does not crash process.
4. **Connection Error Handling**: 503 on Prisma connection failure, 500 on other uncontrolled errors; `try/catch` does not swallow 404.

---

## Archive Contents ✅

Preserved at `openspec/changes/archive/2026-08-26-detalle-producto-postgres/`:

- `proposal.md` ✅ (scope, approach, 6 design decisions D-1..D-6, dependencies, rollback plan)
- `exploration.md` ✅ (key findings: `findProductBySlug()` pre-existed, mock self-includes and no-filters rule, shape identical)
- `design.md` ✅ (4 architectural decisions A/B/C and Decisions D-1..D-6, verification plan, phase-by-phase implementation sequence)
- `specs/product-detail-api/spec.md` ✅ (4 requirements + ratified divergence + 8 Gherkin scenarios + out-of-scope)
- `tasks.md` ✅ (8 phases, 26/26 tasks complete: baseline, packages/db, rebuild, Nest service, jest tests, E2E CA-1..CA-4, documentation, post-verify corrections H-1/H-2/H-3)
- `verify-report.md` ✅ (comprehensive evidence: 14/14 vitest, 20/20 jest, curl E2E, SQL parity check across 1200 products, hallazgos H-1..H-7)
- `apply-progress.md` ✅ (work log, all 26 tasks executed in sequence, real command output, 8 phases closed)
- `state.yaml` ✅ (DAG state with phase progression and archive marker)
- `mock-apples.json` ✅ (baseline from mock, captured via fallback before code changes)
- `pg-apples.json` ✅ (live response from Postgres API, byte-identical to evidenced response)
- `archive-report.md` ✅ (this file)

---

## Verification Findings

### Task Completion

All 26 implementation tasks marked `[x]` — no unchecked items. No CRITICAL blocker by task incompleteness.

### Warning-Level Issues (Addressed Before Archive)

#### H-1 — DoD Closure with False Justification (FIXED)

- **Issue**: `docs/product/1-catalogo-desde-postgres/3-detalle-producto-postgres.md:80-85` marked `just db-check` as evidence with note "falso-rojo por el casing de la unidad del cwd en Windows". 
- **Reality**: `just db-check` runs **GREEN** (`Tests 14 passed (14)`, EXIT=0) even from lowercase-drive cwd `/c/DevOps/...` — the bug was already fixed by commit `083d8e9` (justfile normalizes cwd).
- **Action Taken**: DoD rewritten with actual green output; premise purged from `exploration.md`, `proposal.md`, `design.md`, `apply-progress.md`.
- **Status**: ✅ FIXED (prosa, no código afectado).

#### H-2 — JSDoc Obsolete After Code Change (FIXED)

- **Issue**: `packages/db/src/repositories/products.repository.ts:225-226` JSDoc still said "(mismo type, visibles, hasta `relatedLimit`)" after removing `status`/`visibility` filters.
- **Action Taken**: JSDoc updated to remove "visibles" reference; matches code semantics.
- **Status**: ✅ FIXED (1-line change).

#### H-3 — Requirement Over-Affirms Auto-Inclusion (FIXED)

- **Issue**: `specs/product-detail-api/spec.md:35-37` said as MUST absolute: "incluyendo el producto consultado". Reality: 1005/1200 slugs (83.75%) do NOT self-include (id must be within top 20 of type).
- **Action Taken**: Requirement reworded to "sin excluir el producto consultado" with measured condition: self-inclusion occurs "if and only if its id falls among the first 20 of its type (195/1200, 16.25%)". Divergence table and Gherkin scenario already had correct conditions.
- **Status**: ✅ FIXED (critical for archive — this exact wording fuses into main specs and governs future interpretation of D-1).

### Suggestion-Level Items (Carried Forward)

#### H-4 — Hanging Reference in Comment

- **Where**: `products.repository.ts:243` cites `openspec/specs/product-detail-api/spec.md` before archive creates it.
- **Impact**: Low — resolves after archive (spec now exists).
- **Action**: None needed; auto-resolved by this archive.

#### H-5 — Unescaped Slug Echo in 404 Message

- **Where**: 404 message reflects raw user slug without truncation/sanitization.
- **Impact**: Low (JSON-escaped, no XSS) but sets pattern for US-4 and future.
- **Recommendation**: Decide whether future 404 messages should truncate user input.

#### H-6 — Stale Process State in Environment

- **Where**: Brief claimed API stopped; orphan `nest start --watch` process occupied port 9001.
- **Impact**: Corrected during verify; does not affect archive.
- **Lesson**: Hygiene — dev servers can mask stale code if not cleaned up.

#### H-7 — Volume Overrun vs. Forecast

- **Forecast**: ~150 lines.
- **Actual**: +189/-26 = 215 lines (+43%).
- **Impact**: Still within 400-line budget; no strategy change.
- **Lesson**: Jest block larger than estimated (+129 vs. ~80); calibrate jest-heavy forecasts.

---

## Coherence with Design (D-1..D-6, Decisions A/B/C)

| Decision | Requirement | Code State | Verification |
|---|---|---|---|
| **D-1 / Decision A** — `where = { typeId }` | Remove `id:{not}`, `status`, `visibility`; keep `orderBy id asc`, `take relatedLimit`; comment citing D-1 | ✅ **CONFORME** | `products.repository.ts:236-248`. Tested: SQL before/after, `toContain(sample.id)` has teeth (§4.3 verify-report) |
| **D-2** — No new public params | Barrel/signature untouched | ✅ **CONFORME** | `findProductBySlug(slug, relatedLimit = 20)`; barrel unchanged |
| **D-3** — Assertion of exclusion deleted | `expect(rel.id).not.toBe(sample.id)` removed; new assertions added with proof | ✅ **CONFORME** | Line deleted; replaced with `toContain(sample.id)`, order asc, length≤20, type.slug match |
| **D-4** — Domain 404 | `NotFoundException`, default Nest body, Spanish message | ✅ **CONFORME** | Verified `curl -i` → 404, message in Spanish, process stays up |
| **D-5 / Decision B** — Throw outside try | `if (!detail) throw` placed after try/catch, not inside | ✅ **CONFORME** | Code inspection + runtime: 404 persists with base down; NOT swallowed |
| **D-6 / Decision C** — `related_products` only at root | `toProductDto` unchanged; related items have 20 keys, no nesting | ✅ **CONFORME** | Verified: root 21 keys, each related 20 keys, 0 items with bad shape |

**Zero design deviations in code. All three warning-level document issues fixed before archive.**

---

## Scope Discipline

```
6 files modified (all documented in design):
- apps/api/rest/src/products/products.service.spec.ts (+129 lines, -0)
- apps/api/rest/src/products/products.service.ts (+25 lines, -8)
- docs/product/1-catalogo-desde-postgres/3-detalle-producto-postgres.md (+20 lines, -6)
- docs/product/1-catalogo-desde-postgres/README.md (+1 line, -1)
- packages/db/src/repositories/products.integration.test.ts (+6 lines, -4)
- packages/db/src/repositories/products.repository.ts (+8 lines, -7)

ZERO changes in:
- apps/shop/** (10-line scope boundary respected)
- db/schema.sql, db/seed.sql (no DDL changes)
- docker-compose.yml, justfile (no infra changes)
- services/scraper-worker/** (no scraper integration)
- packages/db/index.ts (barrel unchanged)
```

---

## Regression Surface (Shared with US-2)

`toProductDto()` mapper is reused from listing (`US-2`) for detail root and all related items. Coverage verification:

```
listing total: 1199 | data n: 20 | claves: 20
detalle raiz: 21 (20 + related_products)
detalle related[0..19]: 20 each, 0 with related_products

mismas claves listado vs related: true
mismos VALORES listado vs raiz (id 1): true
```

**Mapper safety**: 13 existing jest tests for listing + 7 new tests for detail = 20/20 green. Both suites share `EXPECTED_KEYS` constant in same file → a key-set change breaks both.

---

## Accepted and Documented Divergences

The single major divergence (D-1) is documented and ratified:

| Divergence | Detail | Status |
|---|---|---|
| **D-1: Self-Inclusion & No Filters** | Related products include the queried product if its id is in the top 20 of its type; no `status`/`visibility` filters | ✅ **Deliberate, user-approved, documented with measured incidence (195/1200 = 16.25%)** |
| **D-1 Consequence A** | Product appears in its own `related_products` | ✅ Observable only for 16.25% of products; 83.75% do not self-include |
| **D-1 Consequence B** | Draft/non-public rows may appear in `related_products` | ✅ Latent but not observable: unique draft (id 454) is outside top 20 of its type |

**Divergence revertible**: If a future US prioritizes UX correctness over contract parity, re-adding `status`/`visibility` filters and the self-exclusion is a 3-line change with test update in `integration.test.ts`.

---

## Final Gate Evidence

### Package Tests (Definición de Done)

```
$ cd packages/db && npm run typecheck && npm test
> @safari/db@0.1.0 typecheck
> tsc --noEmit
(sin salida — 0 errores)

> @safari/db@0.1.0 test
> vitest run
 RUN  v4.1.11 C:/DevOps/MyGitHub/safari-marketplace/packages/db
 Test Files  1 passed (1)
      Tests  14 passed (14)
EXIT=0
```

### API Tests (Definición de Done)

```
$ cd apps/api/rest && npx jest
PASS src/products/products.service.spec.ts
  ProductsService.getProducts (Postgres vía @safari/db, US-2)
    ... 13 tests ✓
  ProductsService.getProductBySlug (Postgres vía @safari/db, US-3)
    √ emite exactamente las 21 claves... 
    √ cada relacionado trae 20 claves...
    √ pasa el slug crudo...
    √ relatedProducts: [] → related_products: []...
    √ slug inexistente → NotFoundException 404...
    √ error de conexión → 503...
    √ otro error → 500...

Test Suites: 1 passed, 1 total
Tests:       20 passed, 20 total
```

### E2E Verification (All CA Closed)

- **CA-1**: 21 keys, byte-identical to `pg-apples.json`, diff clean
- **CA-2**: 404 with Spanish message, `/api/types` still 200
- **CA-3**: `self incluido: true` for id 1 (type 1); SQL proof of `toContain(sample.id)` assertion; 1200-slug parity confirmed
- **CA-4**: Shop returns 200, renders title and product name, 20 related items with 21-key detail

---

## Working Tree State

**No commits performed** (per session rule). Changes remain uncommitted:

- 6 files modified across packages/db, apps/api/rest, docs/product
- `openspec/changes/detalle-producto-postgres/` moved to archive (now `openspec/changes/archive/2026-08-26-detalle-producto-postgres/`)
- New main spec created: `openspec/specs/product-detail-api/spec.md`
- User responsible for `git add` + `git commit` before merge

---

## Source of Truth Updated

Main specs now contain the behavior specification for `/api/products/:slug` detail endpoint:

**`openspec/specs/product-detail-api/spec.md`** (NEW)
- 4 Requirements (Detail by Slug, Related-Products Rule with D-1 divergence, Domain 404, Connection Errors)
- 8 Gherkin Scenarios (Given/When/Then per requirement)
- 1 Documented Divergence (D-1, ratified, with measured incidence and reversion path)
- Out-of-Scope boundary (reviews, wishlist, listings, US-4 catalogs, frontend, global filters)

This spec is the source of truth for:
- `/api/products/:slug` contract (21 keys, nested structure, pagination of related)
- Related-products rule behavior and its ratified divergence from prior in-code semantics
- Error handling expectations (404 domain, 503 connection, 500 other)
- Downstream reuse constraints (related items do not nest `related_products`)

**Cross-reference to Sibling Spec**: The detail capability reuses the listing's 20-key projection by reference (`product-listing-api`). No modification made to the listing spec; sibling relationship is implicit in the shared `toProductDto()` mapper and noted in `Out of Scope` section.

---

## SDD Cycle Complete

✅ **Proposed** → ✅ **Explored** → ✅ **Designed** → ✅ **Specified** → ✅ **Tasked** → ✅ **Applied** → ✅ **Verified** (PASS WITH FINDINGS, 3 warnings fixed, 4 suggestions carried) → ✅ **Archived**

The change is fully planned, implemented, verified, and now read-only in the audit trail. Ready for the next change (US-4: product catalogs, or follow-up items H-5/H-6/H-7).

---

## Risks Carrying Forward

1. **H-5 (Pattern for future)**: 404 messages echo raw user slug. Decide pattern before US-4.
2. **Mapper not independently tested (same as US-2 V-4)**: `toProductDto` has manual verification only. US-4 may inherit same constraint.
3. **Draft-exposure consequence (D-1, latent)**: Not observable today but documented. Monitor if seed changes.
4. **Self-inclusion edge case (D-1, conditional)**: 83.75% of products do not self-include — ensure UI/docs clarify if the feature is discovered by end-users.

---

**Archived by**: sdd-archive (executor)  
**Date**: 2026-08-26  
**Artifact Store Mode**: openspec  
**Skill Resolution**: paths-injected (SKILL.md paths received from orchestrator)
