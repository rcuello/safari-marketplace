# Apply Progress: US-41 — Esquema y capa de datos de identidad extendida

## Delivery decision

`ask-on-risk` → owner resolved: **split into two commits directly on `main`**
(no PRs in this repo's history). **This batch is Slice 1 only**: Phase 1
(DDL), Phase 2 (seed generator), Phase 3 (rebuild + counts), Phase 4
(re-introspección), Phase 6 (citation maintenance), Phase 7 tests 1-11 (schema
tests). Slice 2 (`records.ts` + mappers + barrel, Phase 7 tests 12-13, Phase
8 full verification) is explicitly NOT started — left `[ ]` in `tasks.md`.

No commit/branch/push was made; everything is in the working tree per the
orchestrator's instruction (git handled between slices by the orchestrator).

## Completed tasks (Slice 1)

- [x] Phase 1: 1.1, 1.2 — DDL for `shop_staff` and `become_seller` inserted
  between `db/schema.sql:435` and `:438`; index inserted after `:474` (now
  shifted; final policy comment block is `540-550`, `COMMIT;` at `553`).
- [x] Phase 2: 2.1-2.6 — all 6 changes to `db/generate-seed.mjs`
  (`becomeSeller` read, `staffAsignaciones` literal, 4 validations,
  `become_seller` emission with the two-level `page_options.page_options`
  unwrap, `shop_staff` emission after the `shops` block, summary line
  updates).
- [x] Phase 3: 3.1-3.5 — `just db-seed-generate`, `just db-reset` (owner-
  authorized 2026-09-15), all counts verified via `psql`.
- [x] Phase 4: 4.1-4.8 — `.pre` backup taken, `prisma db pull` run, diff
  classified (cosmetic/expected, no STOP), re-applied against `.pre` +
  hand-written `ShopStaff`/`BecomeSeller` models + 2 back-relations,
  `just db-build` green.
- [x] Phase 6: 6.1, 6.2 — citations in `manufacturers.repository.ts:196` and
  `tags.repository.ts:170` updated from `db/schema.sql:477-487` to the new
  `:540-550`.
- [x] Phase 7: 7.1-7.7, 7.9-7.14, 7.16 (partial, test 9 only) — both new
  integration test files created, 12 new tests (7 in `shop-staff`, 5 in
  `become-seller`), all passing under `just db-check`.

## Deliberately NOT started (Slice 2 — left `[ ]` in tasks.md)

- Phase 5 (`packages/db/src/records.ts` interfaces/mappers, `index.ts`
  barrel).
- Phase 7 task 7.8 (test 12, mapper `_toShopStaffRecord`) and 7.15 (test 13,
  mapper `_toBecomeSellerRecord`) — both depend on Phase 5.
- Phase 8 (full verification: `just db-check` final count, `npx jest`,
  `just build-api`, `just verify`, `db/README.md` subsection, DoD evidence
  paste).

## Evidence

### Phase 2 — generator run (no validation errors)

```
$ just db-seed-generate
node db/generate-seed.mjs
db/seed.sql generado (601 KB)
  10 types · 12 shops (3 recuperados) · 198 categorías · 14 manufacturers · 10 tags · 1200 productos · 3 usuarios · 4 permisos · 1 become_seller · 3 shop_staff
```

Verified `db/seed.sql` emits `become_seller` from
`becomeSeller.page_options.page_options` (24 keys, no fossilized
`created_at`/`updated_at` from the mock's outer wrapper) and `shop_staff`
after the `shops` INSERT block (FK ordering respected).

### Phase 3 — `just db-reset` + counts

```
$ just db-reset
docker compose down -v
 Container safari-postgres  Removed
 Volume safari-marketplace_postgres-data  Removed
just db-up
 Container safari-postgres  Started
esperando a Postgres. listo
... psql schema.sql (ON_ERROR_STOP=1) ...
... psql seed.sql (ON_ERROR_STOP=1) ...
  * esquema y datos de referencia aplicados
```

```sql
       tabla       | count
-------------------+-------
 categories        |   198
 categories_raices |    83
 shops             |    12
 users             |     3
 products          |  1200
 shop_staff        |     3
 become_seller     |     1
(7 rows)
```

```sql
 user_id | shop_id
---------+---------
       2 |       1
       2 |       2
       3 |       1
(3 rows)

-- count(*) FROM shop_staff WHERE user_id = 1
 count
-------
     0

-- id, jsonb_array_length(commissions) FROM become_seller
 id | jsonb_array_length
----+--------------------
  1 |                  2

-- count(*) FROM pg_trigger WHERE NOT tgisinternal
 count
-------
     0
```

All counts match the design's expected values exactly. No STOP triggered.

### Phase 4 — re-introspection classification

`git status --porcelain packages/db/prisma/schema.prisma` was empty before
the pull; `.pre` copy taken to
`<scratchpad>/schema.prisma.pre` before running `npx prisma db pull`.

`prisma db pull` introspected **17 models** (15 existing + `shop_staff` +
`become_seller`) and self-enriched `@map`/`@@map` from the previous file for
all 15 existing models (Prisma's own `db pull` behavior when the previous
schema is present, not something this batch had to reapply by hand). Full
raw diff of the pull (`git diff` before re-applying) showed, besides the 2
new models:

- Header comment (`:1-29`) and the "Identidad (US-20/US-21)" banner
  (`:225-231`) dropped — **cosmetic**.
- Column alignment/whitespace realignment and field reordering (relations
  moved after scalars) across most of the 15 existing models — **cosmetic**
  (no `@map`/`@@map` lost; Prisma reapplied them itself).
- `Shop.owner` relation lost the explicit `onDelete: Restrict` annotation —
  verified this is **cosmetic**, not semantic: `pg_constraint` still shows
  `confdeltype = 'r'` (RESTRICT) for `shops_owner_id_fkey` in the live
  database; Prisma omits `onDelete: Restrict` on introspection because it
  matches Prisma's own default action for a required relation.
- `otp_codes_phone_idx` lost its explicit `map: "otp_codes_phone_idx"` —
  **cosmetic**: the index name in Postgres is unchanged, Prisma omits the
  `map` when it matches its own default naming convention.
- `Shop` gained `shop_staff shop_staff[]` and `User` gained
  `shop_staff shop_staff[]` back-relations (initially snake_case, since the
  new models weren't yet manually renamed at pull time) — **expected in this
  change** per CA-4.
- No field type changed on any of the 15 existing models, no `@@map`/`@map`
  irrecoverably lost, no new `@unique` on `User.email`,
  `products_procedencia_key` still a partial index (`where: raw(...)`).

**Verdict: cosmetic + expected only. No STOP.**

Procedure followed: restored `schema.prisma` from the `.pre` copy (not the
raw pull), then hand-added the two back-relations (`staff ShopStaff[]` on
`Shop`, `staffShops ShopStaff[]` on `User`) and the two new models
(`ShopStaff`, `BecomeSeller`) with their exact `@map`/`@@map` from the
design. This produced a minimal, auditable diff instead of re-typing 15
models' renames onto the fresh pull output.

Final `git diff packages/db/prisma/schema.prisma` (32 lines):

```diff
@@ -81,8 +81,9 @@ model Shop {
   createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
   updatedAt   DateTime @default(now()) @map("updated_at") @db.Timestamptz(6)

-  owner    User      @relation(fields: [ownerId], references: [id], onDelete: Restrict, onUpdate: NoAction)
+  owner    User        @relation(fields: [ownerId], references: [id], onDelete: Restrict, onUpdate: NoAction)
   products Product[]
+  staff    ShopStaff[]

   @@map("shops")
 }
@@ -244,6 +245,7 @@ model User {
   permissions         PermissionUser[]
   passwordResetTokens PasswordResetToken[]
   shops               Shop[]
+  staffShops          ShopStaff[]

   @@map("users")
 }
@@ -317,3 +319,31 @@ model OtpCode {
   @@index([phone], map: "otp_codes_phone_idx")
   @@map("otp_codes")
 }
+
+// =====================================================================
+// Identidad extendida (US-41)
+// =====================================================================
+
+model ShopStaff {
+  userId    BigInt   @map("user_id")
+  shopId    BigInt   @map("shop_id")
+  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
+
+  shop Shop @relation(fields: [shopId], references: [id], onDelete: Cascade, onUpdate: NoAction)
+  user User @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: NoAction)
+
+  @@id([userId, shopId])
+  @@index([shopId], map: "shop_staff_tienda_idx")
+  @@map("shop_staff")
+}
+
+model BecomeSeller {
+  id          Int      @id @default(1) @db.SmallInt
+  pageOptions Json     @map("page_options")
+  commissions Json
+  language    String   @default("es")
+  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
+  updatedAt   DateTime @default(now()) @map("updated_at") @db.Timestamptz(6)
+
+  @@map("become_seller")
+}
```

`just db-build` output:

```
npm run build
> @safari/db@0.1.0 build
> prisma generate && tsup
✔ Generated Prisma Client (7.10.0) to .\generated\prisma\client in 468ms
CLI Building entry: index.ts
CJS dist\index.js     173.92 KB
DTS dist\index.d.ts   1.55 MB
DTS ⚡️ Build success in 18633ms
```

`prisma.shopStaff` / `prisma.becomeSeller` confirmed present in the
generated client (`generated/prisma/client/models/ShopStaff.ts`,
`.../BecomeSeller.ts`).

### Phase 6 — citation maintenance

Actual final line of the "reloj único" policy comment is `540-550` (shifted
from the design's `:477-487` reference by the DDL insertion in Phase 1).
Both citations updated to `db/schema.sql:540-550`:

- `packages/db/src/repositories/manufacturers.repository.ts:196`
- `packages/db/src/repositories/tags.repository.ts:170`

(Note: these files live under `packages/db/src/repositories/`, not
`apps/api/rest/src/{manufacturers,tags}/` as the task text's path shorthand
suggested — verified against the actual repo layout before editing.)

### Phase 7 — tests

Created:

- `packages/db/src/repositories/shop-staff.integration.test.ts` (7 tests:
  seed determinista, idempotencia, un usuario/dos tiendas, cascada de
  tienda, cascada de usuario, sin rol/updated_at, sin trigger)
- `packages/db/src/repositories/become-seller.integration.test.ts` (5 tests:
  singleton, CHECK de fila única, dos columnas jsonb sin fusionar, reloj
  `updatedAt === createdAt`, sin trigger)

Both follow the sentinel/fixture conventions from `shops.integration.test.ts`
and `users.integration.test.ts`: shop slug prefix `zz-tiendas-staff-` (swept
by `shops.integration.test.ts`'s own `beforeAll(cleanupSentinel)` on a
`startsWith('zz-tiendas-')` match), user domain
`@shop-staff-integration.test`, `ownerId: 3` on every sentinel shop (never
the sentinel user, since `shops.owner_id` is `ON DELETE RESTRICT`).

`just db-check` (full output):

```
npm run typecheck
> tsc --noEmit
(no errors)

npm test
> vitest run
 Test Files  12 passed (12)
      Tests  222 passed (222)
   Start at  12:52:03
   Duration  44.80s
```

Baseline was 10 files / 210 tests; now 12 files / 222 tests (+12, matching
the 7 + 5 new tests). Post-test count re-verification confirms sentinel
cleanup left no residue:

```sql
       tabla       | count
-------------------+-------
 categories        |   198
 shops             |    12
 users             |     3
 products          |  1200
 shop_staff        |     3
 become_seller     |     1
```

Test 12/13 (mappers) were NOT written — they import `_toShopStaffRecord`/
`_toBecomeSellerRecord` from `../records`, which Phase 5 (slice 2) has not
created yet.

## Files changed (Slice 1)

| File | Action | Lines |
|---|---|---|
| `db/schema.sql` | Modified | +63 |
| `db/generate-seed.mjs` | Modified | +54/-6 |
| `db/seed.sql` | Regenerated | +22 (via `just db-seed-generate`, not hand-edited) |
| `packages/db/prisma/schema.prisma` | Modified | +32 |
| `packages/db/src/repositories/manufacturers.repository.ts` | Modified | 1 line (comment) |
| `packages/db/src/repositories/tags.repository.ts` | Modified | 1 line (comment) |
| `packages/db/src/repositories/shop-staff.integration.test.ts` | Created | 209 |
| `packages/db/src/repositories/become-seller.integration.test.ts` | Created | 71 |

`git diff --stat` (tracked files only): 6 files changed, 169 insertions(+),
6 deletions(-). Plus 280 lines across the 2 new untracked test files.
Estimated total slice-1 diff: ~449 lines (well within a single reviewable
PR/commit boundary, consistent with the tasks.md forecast's Unit 1 scope).

## Deviations from design

None substantive. Two minor clarifications only:

1. Phase 6's task text pointed at
   `apps/api/rest/src/{manufacturers,tags}/*.repository.ts`; the actual
   files live at `packages/db/src/repositories/*.repository.ts`. Verified
   against the real repo layout before editing — same file content/line
   numbers the design cited, just a different directory than the task
   shorthand implied.
2. The re-introspection procedure restored `schema.prisma` from the `.pre`
   backup and hand-added only the 2 new models + 2 back-relations, rather
   than re-typing all 15 existing models' renames onto the freshly pulled
   file. This produces an identical end state with a much smaller, more
   auditable diff (32 lines vs. the ~140 the raw pull would have touched)
   and was permitted by the design's "re-aplicar contra la copia .pre"
   instruction, which does not mandate starting from the raw pull output.

## Issues found

None. All Phase 1-4, 6, and 7 (tests 1-11) verification gates passed on the
first attempt; no STOP was triggered at any checkpoint.

## Status

Slice 1: 7/7 phases's assigned tasks complete (Phases 1, 2, 3, 4, 6 fully;
Phase 7 tests 1-11 done, tests 12-13 correctly deferred to slice 2). Slice 2
(Phase 5, Phase 7 tests 12-13, Phase 8) intentionally not started. Ready for
the orchestrator to commit slice 1 and then dispatch slice 2.
