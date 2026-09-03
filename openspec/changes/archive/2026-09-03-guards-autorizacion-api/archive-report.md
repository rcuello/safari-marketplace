# Archive Report: `guards-autorizacion-api` (US-23, Épico 19)

**Change**: `guards-autorizacion-api`
**US**: 23 (Épico 19 — Autenticación y autorización)
**Archive date**: 2026-09-03
**Artifact store**: `openspec` (filesystem; no Engram)
**Skill resolution**: `paths-injected` (orchestrator provided exact skill paths)

---

## Verdict

**PASS WITH DOCUMENTED FINDINGS**

The Definition of Done (DoD) of US-23 is CLOSED: all 40 implementation tasks are complete with real evidence. The implementation correctly activates a global JWT authentication guard (`deny-by-default`) and applies role-based authorization (`@Public()` / `@Permissions()` decorators) to all 250 API routes across 45 controllers. Verification confirms:
- All 6 criteria of acceptance (CA-1 through CA-6) are met
- 9 of 11 spec scenarios verified in runtime; 2 (R4.2, R4.3) verified by source inspection (structurally unobservable due to service limitations, declared in spec)
- Zero critical findings; 8 medium/low/informational findings documented and resolved or declared out of scope

**Key outcome**: The API enforces authentication and authorization at the global level. Anonymous routes remain public (64 routes for catalog/reference content). Authenticated routes require a valid JWT. Role-gated routes (`@Permissions()`) further restrict access by permission set. No regression in contract (HTTP response bodies and sizes unchanged).

---

## Task Completion Gate

✅ **PASS**: All 40 implementation tasks are marked `[x]` in `tasks.md`. Breakdown:
- **Phase 1 (Infrastructure)**: 7/7 tasks complete — guards, decorators, route auditor created and verified inert (no `APP_GUARD` registered)
- **Phase 2 (Route annotation)**: 14/14 tasks complete — 250 routes classified into 4 buckets (67 public, 117 permission-gated, 63 authenticated, 3 special)
- **Phase 3 (Activation)**: 5/5 tasks complete — `APP_GUARD` registered, JwtModule exported, customer ownership filter applied to `GET /orders`, documentation updated
- **Phase 4 (Verification)**: 14/14 tasks complete — all curl cases, auditor tests, build clean, browser navigation completed

`apply-progress.md` and `verify-report.md` provide full traceability for every task.

---

## Specs Promoted and Integrated

| Domain | Action | Details |
|--------|--------|---------|
| `authorization-guards-api` | **CREATED** (new capability) | Full spec promoted from change artifact; 6 requirements / 11 scenarios |

### authorization-guards-api Promotion

Copied `openspec/changes/archive/2026-09-03-guards-autorizacion-api/specs/authorization-guards-api/spec.md` → `openspec/specs/authorization-guards-api/spec.md`. This is a NEW capability (no merge needed); it defines the global authentication and authorization behavior built on top of the JWT issued by `auth-jwt-api` (US-22):

**Requirements (6)**:
1. Guard global deny-by-default, permisos resueltos solo del token
2. Las 250 rutas se clasifican en cuatro buckets verificables
3. El catálogo y el contenido de referencia permanecen públicos
4. Orders/refunds — invitado en la creación, propiedad forzada en el listado (partial: boundary only, not end-to-end)
5. Las rutas de administración exigen el permiso equivalente
6. El guard se activa sin regresión de contrato

**Scenarios (11)**: Covering public route access, protected route 401 rejection, permission-insufficient 403 response, guard-database non-coupling, route inventory auditing, anonymous catalog navigation, guest checkout, customer order ownership boundary behavior, admin route access control, and contract preservation (byte count, service startup, verification suite).

`openspec/specs/` now holds **12 capabilities** (was 11, as of US-22).

---

## Implementation Summary

### Delivered

- **`apps/api/rest/src/auth/decorators/public.decorator.ts`** (new): `@Public()` marker and `IS_PUBLIC_KEY` symbol
- **`apps/api/rest/src/auth/decorators/permissions.decorator.ts`** (new): `@Permissions()` marker and `PERMISSIONS_KEY` symbol; permission sets `ADMIN_ONLY`, `ADMIN_AND_OWNER`, `ADMIN_OWNER_AND_STAFF`
- **`apps/api/rest/src/auth/decorators/current-user.decorator.ts`** (moved from `auth/`): `@CurrentUser()` decorator, `AuthenticatedRequest` type; maintains D-3 fallback (bearer token extraction if `request.user` unavailable)
- **`apps/api/rest/src/auth/guards/jwt-auth.guard.ts`** (new): Global `CanActivate` guard; checks `@Public()` via `Reflector.getAllAndOverride()`; validates JWT bearer token (401 on absence/invalid scheme/invalid signature/expiration)
- **`apps/api/rest/src/auth/guards/permissions.guard.ts`** (new): Validates `request.user.permissions` against required set (403 if insufficient; 401 if `request.user` absent — anti-fuga rule); includes cost docblock (CA-5): revoking a permission does not affect already-issued tokens until `JWT_EXPIRES_IN` expiration
- **`apps/api/rest/scripts/route-audit.mjs`** (new): Node.js parser that audits controller decorators; mode table (print all routes with classifications) or `--check` (assert inventory against `EXPECTED_PUBLIC`, `EXPECTED_PERM`, `EXPECTED_SPECIAL_COUNT`, `EXPECTED_TOTAL`); bidirectional validation and attribution invariant
- **`apps/api/rest/scripts/route-audit.test.mjs`** (new after verification): Mutation test harness for `route-audit.mjs`; 6 test cases covering normal tree, missing public, extra public, missing permission bucket, H-2 (non-adjacent `@Public()`), and attribution failure
- **`apps/api/rest/src/auth/auth.module.ts`** (updated): `exports: [AuthService, JwtModule]` (Decision A: `AppModule` instantiates `APP_GUARD` providers and resolves `JwtService` via export)
- **`apps/api/rest/src/app.module.ts`** (updated): `providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: PermissionsGuard }]` in that order (authentication before authorization)
- **`apps/api/rest/src/orders/orders.controller.ts`** (updated): `GET /orders` adds `@CurrentUser()` parameter; calculates `isAdminLevel` and overwrites `customer_id` with `user.sub` if not admin (D-8 boundary enforcement)
- **`apps/api/rest/src/refunds/refunds.controller.ts`** (updated): Remains authenticated; comment documenting that property filter cannot be wired today (US-25)
- **45 controllers modified** (annotations only): Added `@Public()` and/or `@Permissions()` decorators to 250 routes, leaving 63 authenticated routes unannotated (deny-by-default)
- **`apps/README.md`** (updated): New "Autorización (US-23)" section with authorization stance, curl examples (3 cases), route auditor usage, and 4 caveats (R-2 guest checkout, R-6 webhook unsigned callbacks, `/docs` open, D-8 orders/refunds boundary-only)
- **`docs/product/19-autenticacion-autorizacion/23-guards-autorizacion-api.md`** (updated): Status → `✅ Implementada`, DoD checkboxes marked
- **`docs/product/19-autenticacion-autorizacion/README.md`** (updated): US-23 row marked `✅ Implementada`

### Scope Preserved

Verified zero changes to `apps/shop/`, `apps/admin/`, `db/seed.sql`, or any endpoint write logic. The only behavioral change across 250 annotated routes is the D-8 filter in `orders.controller.ts` `GET /orders`.

---

## Criteria of Acceptance (CA-1 through CA-6)

| CA | Criterion | Verdict | Evidence |
|----|-----------|---------|----------|
| **CA-1** | Inventario explícito antes del guard (auditor verifies 67 public, 117 permission, 63 auth, 3 special = 250 total) | ✅ PASS | `node scripts/route-audit.mjs --check` exit 0; corroborated against Nest RouterExplorer (250 registered handlers); auditor bidirectionality proven by mutation test (adds/removes public routes detected) |
| **CA-2** | Deny by default (401 / 403 split) | ✅ PASS | `GET /api/settings` 200 (public), `GET /api/users` without token 401, with customer token 403, with admin token 200; all 6 variants of 401 tested (absent header, wrong scheme, empty bearer, invalid signature, bad token, expired) |
| **CA-3** | Shop remains public and navigable | ✅ PASS | `just verify` green (product-cards:30); SSR of 5 routes without token shows 200s and zero `Unauthorized` strings; 30 browser network requests (orchestrator) all succeeded (zero 401/403) |
| **CA-4** | Admin routes require permission | ✅ PASS | 4 routes × 2 tokens: `GET /api/users`, `GET /api/admin/list`, `GET /api/vendors/list`, `GET /api/customers/list` all return 403 for customer, 200 for admin |
| **CA-5** | Permisos salen solo del token (no database access in guards) | ✅ PASS | `grep @safari/db \| @prisma/client` in guards → 0; docblock cost declaration present (`permissions.guard.ts:19-27`); any-of check on `request.user.permissions` only |
| **CA-6** | Sin regresión de contrato | ✅ PASS | `just build-api` exit 0; `just verify` exit 0 with identical byte counts (5503); `/api/me` no regression (verified by US-22 test suite); `GET /api/settings` same content pre/post activation |

---

## Verification Findings

`sdd-verify` phase yielded **PASS WITH WARNINGS**: 6 criteria met, 8 findings (none critical, none blocking archive).

### Findings Summary

| # | Finding | Severity | Status | Details |
|---|---------|----------|--------|---------|
| **H-1** | Auditor `--check` gap: bucket `perm` not asserted | **MEDIUM** | **✅ CLOSED** | Initially: `--check` only diffed public set; mutation showed missing `@Permissions()` went undetected. **After verification**: `route-audit.mjs` hardened to assert `EXPECTED_PERM`, `EXPECTED_SPECIAL_COUNT`, `EXPECTED_TOTAL` — now 2-way bidirectional on all buckets (§H-1/H-2 in apply-progress). Test harness added (`route-audit.test.mjs`). Exit code 1 on H-1 mutation. |
| **H-2** | Docblock promises "no false positive" but `@Public()` non-adjacent to HTTP decorator passes undetected | **MEDIUM** | **✅ CLOSED** | Initially: parser looked only at line immediately above HTTP decorator; non-adjacent `@Public()` was invisible to auditor but effective in runtime. **After verification**: `decoratorBlockAbove()` walks entire decorator block (balance parens for multiline), position-independent; attribution invariant added (any `@Public(` / `@Permissions(` must be attributed to class or handler or test fails). Test case H-2 in harness (non-adjacent `@Public()` now detected). Exit code 0 (not 1) because attribution succeeds — the auditor no longer claims "falso verde." |
| **H-3** | Discrepancy: task 4.9 marked `[x]` in `tasks.md` but `apply-progress.md` listed it as `[ ]` and "39/40 completo" | LOW | **CLOSED** | Reconciled by the orchestrator before archiving: `Remaining Tasks` now reads "Ninguna", and the `Status` section carries an explicit reconciliation note (final state **40/40**). The session-2 header and summary keep their original "13/14 · 4.9 pendiente" wording **on purpose** — `apply-progress.md` is a per-session log, not a live summary — and the note at the top of the file points forward to §CA-3. The US's own DoD checkbox was ticked with the same evidence. |
| **H-4** | Evidence capture `evidence-anon-storefront.png` showed the newsletter modal covering the storefront and did not accredit a single product-card | LOW | **CLOSED** | The capture was **retaken** by the orchestrator before archiving. The archived image shows the anonymous product grid — Apples `$1.60` (down from `$2.00`), Baby Spinach `$0.60`, Blueberries `$3.00`, Brussels Sprout −40% — with the category sidebar and a header reading "Join" / "Become a Seller", which is the visual proof that no session is active. The decisive evidence remains the network trace (30 requests, all 200/304, zero 401/403); the image now corroborates it instead of contradicting it. Both are recorded in §CA-3 of `apply-progress.md`. |
| **H-5** | 250 handlers but 249 unique endpoints (duplicate `PUT /api/notify-logs/:id` preexisting) | LOW | NOTED | Not introduced by US-23; both PUT handlers in `auth` bucket (same authorization). No divergence risk. Factual precision: "250 handlers, 249 endpoints." |
| **H-6** | Scenarios R4.2 / R4.3 (customer order ownership / admin query override) unobservable in runtime | LOW | DECLARED BY SPEC | `OrdersService.getOrders` ignores `customer_id` parameter (service limitation). Controller filter (D-8) is present and correct (verified by inspection). Spec explicitly says "boundary fix, not end-to-end"; no overclaim. Awaits US-25 (service implementation). |
| **H-7** | Data Flow diagram (design.md:290) shows `PermissionsGuard` reading `IS_PUBLIC_KEY`; implementation does not | LOW | NOTED | Diagram inaccurate (safe behavior: guard never mixes `@Public()` + `@Permissions()` in same route). No routes violate both decorators (0 found). Design intent preserved. |
| **H-8** | IDOR residual: `GET /orders/:id` and tracking-number lookup (auth but no ownership check) | INFORMATIONAL | OUT OF SCOPE | Improvement over pre-guard (was anon). Spec did not require it. Input for US-25. Correctly scoped. |

**Reconciliation**: H-1 and H-2 findings were resolved after `sdd-verify` completed, with orchestrator approval. The enhancements to `route-audit.mjs` and new test harness (`route-audit.test.mjs`) are documented in §H-1/H-2 of `apply-progress.md` with full evidence. This archive report reflects the **final state**: both findings are CLOSED.

---

## Archive Contents

✅ **Complete**: All artifacts from the change lifecycle are present in the archive:
- `proposal.md` — Change scope, approach, constraints
- `explore.md` — Context and discovery (optional, present)
- `design.md` — Architecture decisions (7 Decision IDs), Data Flow diagram, task layout
- `tasks.md` — 40/40 implementation tasks, all checked
- `apply-progress.md` — Two apply sessions (Phases 1–2, then Phases 3–4); full evidence pegado (commands, curl output, build logs)
- `verify-report.md` — Adversarial verification (6 CA met, 8 findings documented, PASS WITH WARNINGS)
- `specs/authorization-guards-api/spec.md` — Full spec (6 requirements, 11 scenarios)
- `evidence-anon-storefront.png` — Browser screenshot (CA-3, orchestrator-provided)

**Archive move verification**:
- Source folder `openspec/changes/guards-autorizacion-api/` removed ✓
- Archive folder `openspec/changes/archive/2026-09-03-guards-autorizacion-api/` contains all artifacts ✓
- Path reference `openspec/changes/guards-autorizacion-api/evidence-anon-storefront.png` → `openspec/changes/archive/2026-09-03-guards-autorizacion-api/evidence-anon-storefront.png` updated in `apply-progress.md` ✓
- Main spec promoted to `openspec/specs/authorization-guards-api/spec.md` ✓

---

## Source of Truth Updated

The `openspec/specs/` directory now includes the authorization guards specification:
- **Before**: 11 domain specs (identity-schema, identity-data-layer, auth-jwt-api, product-listing-api, product-detail-api, etc.)
- **After**: 12 domain specs (+authorization-guards-api)

Future changes to authorization behavior will merge deltas into `openspec/specs/authorization-guards-api/spec.md`.

---

## SDD Cycle Complete

The change `guards-autorizacion-api` has been fully planned, designed, implemented across 40 tasks, verified against 6 acceptance criteria (9 of 11 spec scenarios tested), and archived. Implementation is production-ready. Findings H-1 through H-4 are **resolved**; H-5 through H-8 are declared and out of scope for this US (H-8 — the residual IDOR on `GET /orders/:id` and the tracking-number lookup — is input for US-25).

Ready for the next change.
