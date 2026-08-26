# Archive Report: US-4b — El árbol de categorías desde Postgres

**Archived**: 2026-08-26  
**Change ID**: `2026-08-26-categorias-arbol-postgres`  
**Capability**: `category-tree-api`  
**Status**: Complete ✅

## Executive Summary

US-4b migrates `/api/categories` and `/api/categories/:param` from mock JSON to Postgres via `@safari/db`, reconstructing an arbitrary-depth category tree (now correctly identified as 3 levels, not 2 as prior comments claimed). Delivered as 2 stacked PRs (tree assembler in packages/db → Nest service + docs), all 27 implementation tasks completed and checked. Discovery of the true depth (6 grandchildren under 163/164) was the key insight that triggered the split from US-4 and corrected two repository comments.

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `category-tree-api` | Created | New capability spec copied to `openspec/specs/category-tree-api/spec.md` |

## Artifact Inventory

✅ **proposal.md** — Scope, approach, splitting rationale (21KB)  
✅ **specs/category-tree-api/spec.md** — Full spec with 7 requirements and verification scenarios (8KB)  
✅ **design.md** — Decisiones A–G, tree assembler pseudocode, 11 integration test assertions, depth discovery (52KB)  
✅ **tasks.md** — 27 tasks grouped across 2 PRs; all [x] checked (7KB)  
✅ **apply-progress.md** — Commit refs, branch states, 2 commits recorded (10KB)  
✅ **verify-report.md** — Evidence: tree depth verification (CA-2), curl outputs, db-check/build-api/verify all green (35KB)  

**Supporting**: mock-cat-*.json (baseline captures) + pg-cat-*.json (live curl results)

## Key Outcomes

### Implementation Delivered
1. **Phase 1 (PR#1)**: Rewrote categories.repository with `_assembleTree()` private assembler, arbitrary-depth recursion via index+descent, cycle guard by path Set, rootsOnly parameter, name search filter, findCategoryByIdOrSlug. Suite of 11 integration tests verifying depth 3, counts (83/198/6), serialization safety.
2. **Phase 2 (PR#2)**: Rewrote categories.service.ts with async over `@safari/db`, parseCategorySearch for type.slug and name filters, mappers (toCategoryDto 16 keys, toAncestorDto 14 keys, toDescendantDto 16 keys, toEmbeddedType 10 keys), error handling (503/500 pattern).

### Specifications Published
- **category-tree-api**: 7 requirements (arbitrary-depth tree reconstruction, parent chain without cycles, semantics of rootsOnly parameter, type.slug filter, id-or-slug detail, 404 missing, Postgres errors, uniform key-set of 16, zero products_count for descendants, embedded type divergences V-11/V-12, corrected documentation comments)
- Documents the discovery: prior comments claimed "2 niveles reales" but Postgres data shows 3 (83 roots, 115 descendants, 6 grandchildren under 163/164)

### Quality Gates Passed
- ✅ `just db-check` → 11 integration test assertions on tree assembler, all green, depth 3 verified
- ✅ `just build-api` → Nest compiles clean
- ✅ `just verify` → Categories endpoint responds with correct tree structure and totals
- ✅ Tree serialization → `JSON.stringify` safe (no circular refs due to asymmetric parent/children)
- ✅ Depth verification → `WITH RECURSIVE` query confirms `0|83 1|109 2|6` (0 root, 1 direct-child, 2 grandchildren)
- ✅ `postgres` down/up cycle → 503 errors correct, recovery clean
- ✅ Category detail → same object returned by id or by slug

### Discovery: The True Category Depth

**Prior State** (comments in code):
- `packages/db/src/repositories/categories.repository.ts:1-6` stated "2 niveles reales"
- `db/schema.sql:130-136` stated "2 niveles reales" and counted descendants incorrectly

**After Exploration + Design**:
- True counts: 198 total = 83 roots + 109 direct children + 6 grandchildren
- Depth: root → child → grandchild (2 hops = 3 levels of nesting)
- Location: grandchildren 165–168 under 164, 169–170 under 163, both under root 124 (type_id 7, daily-needs vertical)
- Implication: single-level Prisma `include` would silently drop the 6 grandchildren from all detail responses

**Comments Corrected** (US-4b Phase 7):
- `categories.repository.ts:1-7` now cites 198/83/109/6 and names the nesting path
- `db/schema.sql:130-135` now cites same counts and nesting structure

### Bugs Fixed Before Archive

**Commit 03725a2**: The spec initially asserted "GET /api/categories without parent returns 83 roots"; it returns 198 because `ValidationPipe` runs without `transform`, so `parent === undefined` (not `'null'`). Mock behaved identically. Spec corrected, not the code. Two undeclared `type`-embed divergences (V-11/V-12) discovered in verify and declared.

## Delivery Strategy Applied

- **Chained PRs**: 2 stacked to main, each with autonomous scope
- **PR #1** (~356 loc): `packages/db` assembler + integration suite → `just db-check` gate
- **PR #2** (~215 loc): Nest service + mappers + documentation → `curl` + `just verify` gate
- **Total**: ~571 LOC, split to keep each PR reviewable

## Testing Coverage

| Artifact | Suite | Assertions | Status |
|----------|-------|-----------|--------|
| categories.repository | categories.integration.test | 11 | ✅ |

The 11 assertions verify: rootsOnly true/false counts, depth 3 chain, zero grandchildren under 169, ascendant chain, JSON.stringify safety, typeSlug filter, name search, findCategoryByIdOrSlug (id, slug, nesting), getCategoryTree smoke.

## Relationship to US-4a (Sibling Change)

Original US-4 was split because combined forecast exceeded 400 lines. The split:
- **US-4a (flat-catalogs-api)**: types, tags, manufacturers, shops
- **US-4b (category-tree-api)**: categories only

Both share `packages/db/index.ts` line 26–34 (categories barrel). Delivery order: US-4a PRs land to main first → US-4b rebases on the updated barrel. Because this change is **not** on top of US-4a in git history (they were developed in parallel, then stacked for archiving), the sibling context is documented here instead of in git. Future reader: search this report for "Sibling" or "US-4a" to understand the split reasoning.

## Cross-Repository Impact

- `docs/product/1-catalogo-desde-postgres/4-migrar-catalogos-apoyo.md` — US-4a docs (owned by sibling change)
- `docs/product/1-catalogo-desde-postgres/4b-categorias-arbol-postgres.md` — Created (US-4b docs, owned by this change)
- `docs/product/1-catalogo-desde-postgres/README.md` — Updated by US-4a to add US-4b row
- `docs/product/README.md` — Updated by US-4a to include both US-4a and US-4b

## Risks Addressed

1. **Arbitrary-depth recursion**: Implemented with index-based memoization (recs, types, kids, descend/ascend), not recursive function calls. Cycle guard via path Set prevents infinite loops. Proven safe with `JSON.stringify` in integration test (R-1, Design §Testing Strategy).

2. **Asymmetric parent/children**: Parent nodes do NOT carry children or type (to prevent circular refs). Child nodes carry complete parent chain ascending to null. Serialization safe; circular structure impossible.

3. **Parameter polymorphism** (id-or-slug): Single `findCategoryByIdOrSlug` function, id wins over slug (Natural ordering: `param` is checked as number first). Verified with same-object assertions for both paths.

4. **Type divergences from mock**: Embedded type now served from canonical `types` table, not from old copy in `categories.json`. V-11 (settings changes on 57 nodes) and V-12 (banners missing on 21 nodes) are accepted; no consumer regression measured (all type reads come from `/api/types` or `product.type`, not `category.type`).

5. **Database downtime**: All category endpoints wrapped with isPrismaConnectionError check → 503. Process stays alive, proven with `/api/types` 200 check in verify-report CA-4.

## Divergences Declared and Approved

| ID | Field | Reason | Scope | Impact |
|----|-------|--------|-------|--------|
| V-1 | products_count (descendants) | category_product empty by design | Descendants only | Constant 0 |
| V-2 | type.settings | Canonical types table replaces mock copy | 57 nodes (type_id 1,8) | isHome/productCard differ |
| V-6 | type.banners | Mapper publishes 10 keys, omits banners | 21 nodes (gadget, medicine) | Array removed |
| V-3,V-7,V-8,V-9,V-10 | (see design.md §Divergences) | Referenced from openspec/specs for long-term audit trail | Documented in design | Cross-spec trace |

## Files Modified in Repo

- ✅ `openspec/specs/category-tree-api/spec.md` — Created (new capability)
- ✅ `docs/product/1-catalogo-desde-postgres/4b-categorias-arbol-postgres.md` — Created (US-4b docs)
- ✅ `docs/product/1-catalogo-desde-postgres/README.md` — Updated by US-4a (table, order)
- ✅ `docs/product/README.md` — Updated by US-4a (epic heading)

**No changes to**: `packages/db/prisma/schema.prisma`, `db/schema.sql` (DDL structure), category product endpoints (write/admin, still mock), `category_product` population (deferred). All code changes are archived in git commits referenced in `apply-progress.md`.

## Archive Structure

```
openspec/changes/archive/2026-08-26-categorias-arbol-postgres/
├── archive-report.md           (this file)
├── proposal.md
├── design.md
├── tasks.md                     (27/27 checked)
├── apply-progress.md
├── verify-report.md
├── specs/
│   └── category-tree-api/
│       └── spec.md             (↑ also copied to openspec/specs/)
├── mock-cat-daily.json
├── mock-cat-dairy2.json
├── mock-cat-gadget.json
├── pg-cat-daily.json
├── pg-cat-dairy2.json
├── pg-cat-gadget.json
└── pg-cat-124.json
```

## Next Steps

The archive is now immutable. The category-tree capability is published in `openspec/specs/category-tree-api/spec.md` and forms the basis for any future category-related changes. To audit the depth discovery and comment corrections years later, cross-reference this report's "Discovery" section against the actual code and design.md §Design Decisions.

---

**Archived by**: SDD Archive Phase  
**Date**: 2026-08-26  
**Audit Trail**: Committed alongside `openspec/specs/category-tree-api/spec.md`
