# Tasks: Escrituras de `types` y las piezas compartidas (US-27a)

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~915 total (±100) — PR#1a ~245, PR#1b ~240, PR#2 ~410 |
| 400-line budget risk | High (total); PR#1a Low, PR#1b Low, PR#2 Medium (created files dominate: mapper 70 + mapper.spec 85 + service.spec 145; `types.service.ts` diff runs higher than the design's "~90 netas" because deleting `types.json`/`Fuse`/dead methods counts as deletions too) |
| Chained PRs recommended | Yes |
| Suggested split | PR#1a → PR#1b → PR#2 (confirms design boundary; PR#2 independently estimated ~80 lines above the design's ~330, still one cohesive, jest-provable unit — no further split needed) |
| Delivery strategy | ask-on-risk |
| Chain strategy | **stacked-to-main** — resuelto por el usuario 2026-09-09 (cadena de 3 slices, sin `size:exception`) |

```text
Decision needed before apply: RESOLVED (chained PRs, stacked-to-main)
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
```

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|---|---|---|---|
| 1 | `slug.ts` + `domain-errors.ts` + `slug.integration.test.ts` + barrel (slug/error exports) | PR#1a | `just db-check` alone, green; no write functions exist yet |
| 2 | `types.repository.ts` writes + `types.integration.test.ts` + barrel (write exports) | PR#1b | `just db-build` + `just db-check`; base = PR#1a branch |
| 3 | `common/errors/` + `types.service.ts` + `create-type.dto.ts` + `types.service.spec.ts` | PR#2 | `npx jest` + `just build-api` + `curl`; base = PR#1b branch |

## Phase 1: Foundation — slug helper + domain errors (`packages/db`, PR#1a)

- [x] 1.1 Create `packages/db/src/slug.ts`: `normalizeSlug(text, aggregate)` (`typeof/trim` guard → `EmptySlugError`, then `SELECT slugify($1)` tagged template, `''` → `EmptySlugError`) + `generateSlug(source, lookup, aggregate)` (in-memory first-gap over `lookup(prefix)`); export `SlugSource`/`ExistingSlugLookup`. No `if (aggregate === …)`. [CA-4, CA-7]
- [x] 1.2 Create `packages/db/src/domain-errors.ts`: `CATALOG_ERROR_CODES`, abstract `CatalogWriteError`, 5 classes (`EmptySlugError`, `InvalidReferenceError`, `RecordNotFoundError`, `DependentRowsError`, `SlugConflictError`) with `aggregate`/`field`/`id` as constructor params (no `types`-specific text), structural `isCatalogWriteError` guard (by `code`, not `instanceof`), `translateCatalogWriteError(error, {aggregate, id, uniqueField})` (P2002→SlugConflict, P2003→InvalidReference, P2025→RecordNotFound, else return error intact). Do not touch `packages/db/src/errors.ts`. [CA-4, CA-7]
- [x] 1.3 Modify `packages/db/index.ts`: barrel-export `normalizeSlug`, `generateSlug`, `SlugSource`, `ExistingSlugLookup`, `CATALOG_ERROR_CODES`, the 5 error classes, `isCatalogWriteError`, `translateCatalogWriteError`. [no CA — plumbing]
- [x] 1.4 Create `packages/db/src/slug.integration.test.ts`: tildes vs `SELECT slugify($1)` (`"Café & Té"`, `"Acción!"`, `"Niño Grande"`); explicit `slug` wins over `name`; `"!!!"` and `""`/`undefined` → `EmptySlugError`; `gadget`→`gadget-2`, then `gadget`+`gadget-2`→`gadget-3`. Inject `ExistingSlugLookup` **as an in-memory array only** — this file MUST NOT read or write the `types` table (B4). [CA-4, CA-7]
- [x] 1.5 Verify PR#1a standalone: `just db-up` (if not running) then `just db-check` green — closes PR#1a by itself.

## Phase 2: Repository writes (`packages/db`, PR#1b)

- [x] 2.1 Modify `packages/db/src/repositories/types.repository.ts`: add `CreateTypeInput`/`UpdateTypeInput` (`Omit<CreateTypeInput,'slug'>`), `typeSlugs: ExistingSlugLookup` call site (`findMany` + `startsWith`), `createType` (via `generateSlug`, omit `settings`/`banners`/`icon`/`language` when `undefined` — never `null`), `updateType` (calls `normalizeSlug` directly when `name !== undefined`, discards result, slug untouched, `updatedAt: now()` from `src/clock.ts`, `+id` `Number.isInteger` guard upstream in the service), `deleteType` (`findUnique` → `RecordNotFoundError`; `Promise.all([category.count, product.count])`; either >0 → `DependentRowsError`; else `prisma.type.delete`). Every write wraps `catch (error) { throw translateCatalogWriteError(error, {aggregate:'types', id, uniqueField:'slug'}); }`. [CA-1, CA-2, CA-3, CA-4]
- [x] 2.2 Modify `packages/db/index.ts`: barrel-export `createType`, `updateType`, `deleteType`, `CreateTypeInput`, `UpdateTypeInput`. [no CA — plumbing]
- [x] 2.3 Modify `packages/db/src/repositories/types.integration.test.ts`: sentinel `zz-types-` in `name`/`slug` (distinct prefix, not `zz-test-`); `cleanup = deleteMany({slug:{startsWith:'zz-types-'}})` in `beforeAll` and folded **inside** the existing `afterAll` (`:11-13`) in `try/finally`, before `$disconnect`; add `createType` persists+returns; `updateType` changes `name` not `slug`, `updatedAt` advances via `_setNowProvider` (restore in `afterEach`); `updateType({name:''})` → `EmptySlugError`, row intact; `deleteType(9)` → `DependentRowsError`, both counts intact; sentinel delete with no deps → row count -1; unknown id → `RecordNotFoundError`; closing `prisma.type.count()` === 10 (new assert, CA-6). [CA-1, CA-2, CA-3, CA-6]
- [x] 2.4 Verify PR#1b: `just db-build` (**BLOCKING** — `packages/db/dist` is gitignored, Nest consumes via `link:`; skipping verifies stale code) then `just db-check` green.

## Phase 3: API error mapping (`apps/api/rest/src/common/errors/`, PR#2)

- [ ] 3.1 Create `domain-error.mapper.ts`: `mapDomainError(error)` — closed table by `code` (400/400/404/409/409); `isConnectionFailure(error)` — **local/private**, keys on `name === 'PrismaClientInitializationError'` or `code ∈ {P1001,P1002,P1008,P1011,P1017,P2024}` or message patterns (`can't reach database server`/`connection refused`/`connection timeout`/`econnrefused`) — **must NOT** key on `PrismaClientKnownRequestError`; `toWriteHttpException(error)` = `mapDomainError` → `isConnectionFailure` (503, `getUserFriendlyMessage`) → else **500 with the literal fixed message** (`'Ocurrió un error inesperado. Por favor, contacta al administrador.'`, never call `getUserFriendlyMessage` here). Do not touch `packages/db/src/errors.ts`. [CA-4, CA-7]
- [ ] 3.2 Create `domain-error.mapper.spec.ts`: all 5 codes → correct status; 500 asserted with a **Prisma-shaped fixture** `{name:'PrismaClientKnownRequestError', code:'P2011'}` (plus a characterization assert that `isPrismaConnectionError` from `@safari/db` wrongly returns `true` for that same object); `{code:'P1001'}` and `{name:'PrismaClientInitializationError'}` → 503; `new Error('x')` → 500. No `jest.mock`, no `@prisma/client` import. [CA-4, CA-7]

## Phase 4: API service + DTO wiring (PR#2)

- [ ] 4.1 Modify `apps/api/rest/src/types/dto/create-type.dto.ts`: `PickType(Type, ['name','slug','icon','banners','promotional_sliders','settings','language'])` + override `name` with `@IsString() @IsNotEmpty()`. Do not touch `update-type.dto.ts`, `type.entity.ts`, `main.ts`. [CA-4]
- [ ] 4.2 Modify `apps/api/rest/src/types/types.service.ts`: `create`/`update`/`remove` project field-by-field into `CreateTypeInput`/`UpdateTypeInput` (never spread body), cast `settings`/`banners` at the boundary (`as unknown as Prisma.InputJsonValue`, never `as any`), `+id` `Number.isInteger` guard → `NotFoundException` before calling the repository, `catch (error) { throw toWriteHttpException(error); }`, return via existing `toTypeDto`. Remove `types.json` import, `Fuse`, `plainToClass`, `private types`, dead `findAll`/`findOne`. Keep `parseSearch`, `GetTypesDto`, `Type`. [CA-1, CA-2, CA-3, CA-4, CA-6]
- [ ] 4.3 Create `apps/api/rest/src/types/types.service.spec.ts`: `jest.mock('@safari/db', ...)` (arnés `products.service.spec.ts:36-43`) mocking `createType`/`updateType`/`deleteType`; assert repository input omits absent `settings`/`banners`, ignores `promotional_sliders`; `Object.keys()` of `create`/`update`/`remove` equal to `getTypeBySlug`'s (no `.sort()`); `EmptySlug`→400, `RecordNotFound`→404, `DependentRows`→409, `{code:'P1001'}`→503, `{code:'P2011'}`→500; non-integer `+id` → 404 without calling the repository. [CA-1, CA-2, CA-3, CA-4, CA-6]
- [ ] 4.4 Verify PR#2: `just db-build` (if `packages/db` changed since last build) then `cd apps/api/rest && npx jest` green, then `just build-api` clean. Confirm `grep -n "fuse\|@db/" apps/api/rest/src/types/types.service.ts` returns 0 lines.

## Phase 5: End-to-end DoD evidence (after PR#2 merges)

- [ ] 5.1 `just api-dev`; CA-1/CA-2: `POST /api/types` → `GET /api/types/:slug` (9 keys, diff via `node -e`, no `.sort()`; `jq` not installed) → restart the API → `GET` again → `PUT` (rename) → `GET` (slug unchanged) → `psql`: `SELECT id, slug, updated_at FROM types WHERE id=:id` before/after `PUT` shows `updated_at` advanced (response has no timestamps by contract).
- [ ] 5.2 CA-3: `curl DELETE /api/types/9` → 409 + `psql` counts of `products`/`categories` unchanged; `DELETE` of a session-created row with no deps → 200 + subsequent `GET` → 404.
- [ ] 5.3 CA-4: `PUT/DELETE /api/types/99999` → 404; `POST {}`, `POST {"name":""}`, `POST {"name":"!!!"}` → 400; `PUT {"name":""}` → 400 with `psql` showing the row intact; `POST {"name":"Gadget"}` (existing slug `gadget`) → 201 `slug:"gadget-2"`.
- [ ] 5.4 CA-5: no token → 401; `customer` token → 403; `store_owner` token → 403, on all three write routes (verification only, no code change — decorators already `ADMIN_ONLY`).
- [ ] 5.5 `just build-api` and `just verify` green (all 3 services return real content).
- [ ] 5.6 Cleanup non-sentinel row from 5.3: `DELETE FROM types WHERE id > 11;` then `SELECT count(*) FROM types;` = 10 (no `just db-reset`). Re-run `just db-check` to confirm the `toHaveLength(10)` baseline still holds.
