# Archive Report: US-4a — Catálogos planos (`types`, `tags`, `manufacturers`, `shops`) desde Postgres

**Archived**: 2026-08-26  
**Change ID**: `2026-08-26-catalogos-planos-postgres`  
**Capability**: `flat-catalogs-api`  
**Status**: Complete ✅

## Executive Summary

US-4a migrates the flat catalog endpoints (`/api/types`, `/api/tags`, `/api/manufacturers`, `/api/shops`, `/api/top-manufacturers`) from mock JSON to Postgres via `@safari/db`, preserving the HTTP contract byte-for-byte except for 11 declared divergences. Delivered as 3 stacked PRs (parse-search + types → tags + manufacturers → shops + docs), each independently verified. All 45 implementation tasks completed and checked.

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `flat-catalogs-api` | Created | New capability spec copied to `openspec/specs/flat-catalogs-api/spec.md` |

## Artifact Inventory

✅ **proposal.md** — Scope, approach, rollback plan (25KB)  
✅ **specs/flat-catalogs-api/spec.md** — Full spec with 9 requirements and verification scenarios (10KB)  
✅ **design.md** — Decisiones A–F, 3 verification workflows, divergences V-1..V-25 (42KB)  
✅ **tasks.md** — 45 tasks grouped across 3 PRs; all [x] checked (11KB)  
✅ **apply-progress.md** — Commit refs, branch states, 5 commits recorded (10KB)  
✅ **verify-report.md** — Evidence: curl outputs, db-check/build-api/verify all green, baseline diffs, 3 smoke tests (27KB)  

**Supporting**: mock-*.json (baseline captures) + pg-*.json (live curl results)

## Key Outcomes

### Implementation Delivered
1. **Phase 1 (types)**: parseSearch helper, types.repository, types.integration.test, types.service async over Postgres
2. **Phase 2 (tags+manufacturers)**: Reversed sort for tags (desc), nested type embeds (4 keys), type indexing, tags/manufacturers services + integration tests
3. **Phase 3 (shops)**: Filtered products_count calculated (published + visibility_public), shops detail includes count, 3 reconstructed shops from orphaned products, shops service + integration tests

### Specifications Published
- **flat-catalogs-api**: 9 requirements (response wrappers, key-set per catalog, search filters, nested type, top-manufacturers, calculated products_count, 12-row delta for shops, 404 detail, Postgres connection errors, mock bugs not reproduced)
- Verifies byte-for-byte parity except V-1..V-11, V-25 (divergences documented and ratified in verify-report)

### Quality Gates Passed
- ✅ `just db-check` → 17 integration suites (types + tags + manufacturers + shops), all green
- ✅ `just build-api` → Nest compiles clean
- ✅ `just verify` → All 3 services respond with correct key-sets and totals
- ✅ `curl` baseline diffs → Only declared divergences present
- ✅ `postgres` down/up cycle → 503 errors correct, recovery clean
- ✅ Shop detail invariant → `GET /shops/:slug` carries `products_count`, same as listShops

### Bugs Fixed Before Archive
**Commit 6084b57**: listTypes() sat outside try/catch in tags/manufacturers detail paths (500 instead of 503 under race). V-25 (tags.image: [] → null) undeclared and ratified in verify.

## Delivery Strategy Applied

- **Chained PRs**: 3 stacked to main, each with autonomous scope and verification
- **PR #1** (~135 loc): parseSearch + types → curl verification independent
- **PR #2** (~250 loc): tags + manufacturers → rebased onto PR#1 branch
- **PR #3** (~205 loc): shops + docs → rebased onto PR#2 branch
- **Total**: ~590 LOC, split across 400-line budget to reduce review friction

## Testing Coverage

| Artifact | Suite | Tests | Status |
|----------|-------|-------|--------|
| types.repository | types.integration.test | 4 | ✅ |
| tags.repository | tags.integration.test | 6 | ✅ |
| manufacturers.repository | manufacturers.integration.test | 5 | ✅ |
| shops.repository | shops.integration.test | 6 | ✅ |

Total: 21 integration tests in `packages/db`, all green per `just db-check`.

## Cross-Project Context

This change is the BASE for sibling change **US-4b (2026-08-26-categorias-arbol-postgres)**. The spec declares categories "out of scope" and US-4b shares the `packages/db/index.ts` export barrel (lines 26–34 are reserved for categories in US-4b; lines 35+ are owned by US-4a). Both were originally US-4 until design forecasted ~1160 combined LOC over the 400-line review guard. The user approved the split into US-4a (flat catalogs) and US-4b (category tree) with stacked delivery: PR chains of US-4a land to main first, then US-4b rebases on top.

## Risks Addressed

1. **Shared dependency on parseSearch helper**: Defined once in `apps/api/rest/src/common/search/parse-search.ts`, reused by all 4 services (types, tags, manufacturers, shops). No circular imports.
2. **Nested type embedding**: Indexed via `listTypes()` in services, not via Prisma `include` (which causes N+1 with pagination). Type map rebuilt per request (stateless, safe for concurrent requests).
3. **Shops productsCount race**: Calculated with filtered `_count` (published + visibility_public), applied to both `listShops` and `findShopBySlug`. Detail invariant verified with dedicated assertion in integration test.
4. **Database downtime**: All catalog services wrapped with isPrismaConnectionError check → 503. `/api/settings` (read-only fixture) stays at 200, proving process is alive.

## Divergences Declared and Approved

| ID | Field | Reason | Migration | Impact |
|----|-------|--------|-----------|--------|
| V-1 | manufacturers.products_count | No manufacturer_id populated in seed | Constant 0 | Admin filter assumes 0 |
| V-2 | manufacturers.socials | No data source | Constant [] | Admin read-only |
| V-3 | manufacturers.cover_image | No data source | Constant null | Admin read-only |
| V-4 | shops.owner | owner_id exists, owner object doesn't | Constant null | Admin read-only |
| V-5 | shops.orders_count | No order history in seed | Constant 0 | Admin read-only |
| V-6 | shops.notifications | No notification schema | Constant null | Admin read-only |
| V-7 | created_at/updated_at | Seed timestamp (ISO from JS Date) | Real from DB | Invariant per migration step |
| V-8 | types.promotional_sliders | No data source | Constant null | Frontend unused |
| V-9 | translated_languages | Array of supported langs | Constant ["en"] | Matches seed locale |
| V-10 | manufacturers.language | No data source | Constant "en" | Admin read-only |
| V-11 | is_approved/is_active | Boolean normalizer | Number(bool) → 1/0 | Admin filter and sort |
| V-25 | tags.image | Seed normalization (Array → null) | from db/generate-seed.mjs | Admin optional chaining safe |

## Files Modified in Repo

- ✅ `openspec/specs/flat-catalogs-api/spec.md` — Created (new capability)
- ✅ `docs/product/1-catalogo-desde-postgres/4-migrar-catalogos-apoyo.md` — Rewritten (US-4a docs)
- ✅ `docs/product/1-catalogo-desde-postgres/README.md` — Updated (table + order note)
- ✅ `docs/product/README.md` — Updated (epic heading)

**No changes to**: `packages/db/src/repositories/*`, `apps/api/rest/src/**`, `db/schema.sql`, or application code beyond service rewrites. All code changes are archived in git commits referenced in `apply-progress.md`.

## Archive Structure

```
openspec/changes/archive/2026-08-26-catalogos-planos-postgres/
├── archive-report.md           (this file)
├── proposal.md
├── design.md
├── tasks.md                     (45/45 checked)
├── apply-progress.md
├── verify-report.md
├── specs/
│   └── flat-catalogs-api/
│       └── spec.md             (↑ also copied to openspec/specs/)
├── mock-types.json
├── mock-tags.json
├── mock-manufacturers.json
├── mock-top-manufacturers.json
├── mock-shops.json
├── pg-types.json
├── pg-tags.json
├── pg-manufacturers.json
├── pg-top-manufacturers.json
├── pg-shops.json
└── pg-shop-gadget.json
```

## Next Steps

The archive is now immutable. When next archiving occurs (e.g., US-4b completion), `openspec/specs/flat-catalogs-api/spec.md` remains the source of truth and must not be deleted or replaced. To audit divergences years later, cross-reference this report's V-* table against the verify-report evidence.

---

**Archived by**: SDD Archive Phase  
**Date**: 2026-08-26  
**Audit Trail**: Committed alongside `openspec/specs/flat-catalogs-api/spec.md`
