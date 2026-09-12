# Apply Progress: Escrituras y moderación de tiendas (US-30)

> Ejecuta la cadena de 4 slices resuelta por el usuario (2026-09-11): un commit
> por slice sobre `us-30-escrituras-moderacion-tiendas`, cada uno verde con su
> runner antes de pasar al siguiente. Este documento se MERGEA en cada batch
> (Sección C del protocolo `sdd-apply`); nunca se sobrescribe.

## Slice 1 / 4 — PR#1: `packages/db` camino feliz

**Estado: COMPLETO.** Runner (`just db-check`) verde, corrido dos veces.

### Tareas completadas (Phase 1, tasks.md)

- [x] 1.1 `shopSlugs: ExistingSlugLookup` module-private en `shops.repository.ts`
- [x] 1.2 Tipos `CreateShopInput`/`UpdateShopInput` (contrato de `design.md`)
- [x] 1.3 `createShop(input)` — slug derivado, spreads condicionales, `COUNT_PRODUCTS`, `catch → translateCatalogWriteError`
- [x] 1.4 `updateShop(id, input)` — `normalizeSlug` descartado, spreads, `COUNT_PRODUCTS`, sin guarda numérica propia
- [x] 1.5 `setShopActive(id, isActive)` — una función, sin guarda numérica propia
- [x] 1.6 Barrel `packages/db/index.ts`: `CreateShopInput`/`UpdateShopInput` + `createShop`/`setShopActive`/`updateShop`, orden alfabético
- [x] 1.7 `beforeAll(cleanupSentinel)` nuevo en `shops.integration.test.ts`; limpieza plegada en el `afterAll` existente (antes del `$disconnect()`); `SENTINEL_PREFIX = 'zz-tiendas-'`
- [x] 1.8 Describes de escritura tras los de lectura: crear por rol (`ownerId: 3`, `isActive` false/true), editar campo a campo, togglear con `setShopActive`, slug invariante
- [x] 1.9 Tripwire independiente de `listShops` (`prisma.shop.count()` sin filtro + `listShops({isActive:false}).total === 0` + `items[0].id === 15`)
- [x] 1.10 `it` de `productsCount ≠ 0` sobre `gadget` vía update idempotente de `description`
- [x] 1.11 Verificación: `just db-build` limpio, `just db-check` verde (191/191), corrido dos veces sin flakiness

### Archivos tocados (`git diff --stat`)

```
packages/db/index.ts                                       |   5 +
packages/db/src/repositories/shops.integration.test.ts      | 151 ++++++++++++++++++++-
packages/db/src/repositories/shops.repository.ts            | 142 +++++++++++++++++++
3 files changed, 296 insertions(+), 2 deletions(-)
```

Ningún archivo fuera del alcance de este slice fue tocado: `slug.ts`,
`domain-errors.ts`, `common/errors/`, `db/schema.sql`, `apps/**`, `packages/db/vitest.config.ts`
permanecen sin cambios (verificado con `git status --short`, solo aparecen los
3 archivos de arriba más `openspec/changes/escrituras-moderacion-tiendas/` sin
trackear).

### Decisiones seguidas al pie de la letra (design.md)

- `DD30-2`: `slug` no existe en ningún input; `ownerId`/`isActive` fuera de
  `UpdateShopInput` a nivel de **tipo** (`Partial<Omit<CreateShopInput, 'ownerId' | 'isActive'>>`).
- `DD30-4`: predicados por campo — `settings`/`address` con `!== undefined`,
  `logo`/`coverImage` con `!= null`, `description` con `!== undefined`
  (`?? null` solo en `createShop`).
- `DD30-5`: `COUNT_PRODUCTS` reutilizado (module-private, sin exportar) en las
  tres escrituras — mismo patrón que `listShops`/`findShopBySlug`.
- `DD30-6`: prefijo `zz-tiendas-` (no `zz-shops-`); `ownerId: 3` en todos los
  centinelas de este archivo; `beforeAll` creado (no existía); limpieza
  plegada en el `afterAll` existente (un solo hook, sin el riesgo LIFO de un
  segundo `afterAll`); describes de escritura después de los de lectura;
  tripwire con `prisma.shop.count()` sin filtro — nunca vía `listShops()` a
  secas.
- `DD30-7`: ninguna aserción de este slice compara timestamps `create` vs
  `update` (esa batería vive en PR#2/Phase 2, task 2.4).
- `DD30-9`: `normalizeSlug(input.name, 'shops')` en `updateShop`, descartando
  el resultado, solo cuando `input.name !== undefined`.
- `DD30-10`: un solo `catch` por función, `translateCatalogWriteError` sin
  `uniqueField`; cero guardas de dominio nuevas.

### Deviations from Design

Ninguna. La implementación de `createShop`/`updateShop`/`setShopActive` sigue
el contrato de tipos y las secuencias de `design.md` línea por línea; los
`it` de test siguen el guion normativo de `DD30-6`/`DD30-5` sin modificación.

### Issues Found

Ninguno. Ninguna guarda de dominio nueva fue necesaria (ratifica `DD30-10`:
`shops` no tiene CHECK ni `IN`).

### Evidencia real pegada

**`just db-build`** (limpio):

```
npm install
up to date, audited 325 packages in 4s
npm run build
> prisma generate && tsup
✔ Generated Prisma Client (7.10.0) to .\generated\prisma\client in 604ms
CJS dist\index.js     165.26 KB
CJS dist\index.js.map 398.82 KB
CJS ⚡️ Build success in 112ms
DTS ⚡️ Build success in 12916ms
DTS dist\index.d.ts 1.40 MB
```

**`cd packages/db && npm run typecheck`** (limpio):

```
> @safari/db@0.1.0 typecheck
> tsc --noEmit
```

(sin salida adicional — `tsc --noEmit` terminó con exit code 0)

**`just db-check`** — corrida 1:

```
 Test Files  10 passed (10)
      Tests  191 passed (191)
   Start at  21:07:51
   Duration  25.19s
```

**`just db-check`** — corrida 2 (repetida para descartar flakiness):

```
 Test Files  10 passed (10)
      Tests  191 passed (191)
   Start at  21:08:33
   Duration  20.99s
```

191 = 186 (baseline pre-US-30) + 5 `it` nuevos de este slice (crear por rol +
editar campo a campo + toggle = 1 `it` cada uno en el mismo `describe` de
escritura [3], tripwire [1], `productsCount` de gadget [1]). Las aserciones
pre-existentes siguen verdes dentro de esos 10 archivos: `shops` 12/`id 15`,
`name:'shop'`→7, `productsCount` 584/82/188/44 (`grocery-shop`/`makeup-shop`/
`noaw`/`gadget`), y las 12 filas de `users.integration.test.ts` (no tocado en
este slice).

**`psql` — cierre de conteos (post `db-check`, restituido al baseline):**

```
SELECT count(*) FROM shops;                              -> 12
SELECT count(*) FROM shops WHERE is_active = false;       -> 0
SELECT count(*) FROM shops WHERE slug LIKE 'zz-%';        -> 0
```

Coincide exactamente con el baseline medido antes de empezar (`shops` 12,
`is_active=false` 0, `zz-%` 0).

### Workload / PR Boundary

- Mode: chained PR slice (4 unidades de trabajo, un commit por slice, misma
  rama `us-30-escrituras-moderacion-tiendas`)
- Current work unit: 1 de 4 (PR#1 — `packages/db` camino feliz)
- Boundary: empieza en `shops.repository.ts` sin escrituras y termina con las
  tres funciones + su cobertura de integración feliz, verde, sin tocar
  `apps/**` ni ningún archivo fuera de `packages/db`
- Estimated review budget impact: ~296 líneas netas (`+298/-2`), dentro del
  presupuesto de 400 líneas y por debajo del ~480 estimado en `tasks.md`

### Remaining Tasks (fuera de este run — Phase 3, 4, 5)

- [ ] 3.1–3.9 Capa API — servicio, controller, DTO (`apps/api/rest`, PR#3)
- [ ] 4.1–4.6 `shops.service.spec.ts` (`apps/api/rest`, PR#4)
- [ ] 5.1–5.10 Cierre de la DoD y del épico (evidencia, todo PR)

### Status (histórico, ver Slice 2 abajo para el estado vigente)

11/11 tareas de Phase 1 completas.

## Slice 2 / 4 — PR#2: `packages/db` batería hostil

**Estado: COMPLETO.** Runner (`just db-check`) verde, corrido TRES veces
(la tercera por el riesgo de no-determinismo propio del `it` de carrera de
`slug`, task 2.2).

### Tareas completadas (Phase 2, tasks.md)

- [x] 2.1 404 de `P2025`: `updateShop`/`setShopActive` sobre un id creado y
  borrado justo antes de la aserción (`RecordNotFoundError`), un `it` por
  función.
- [x] 2.2 409 de `P2002` **solo por carrera** (`Promise.allSettled` con dos
  `createShop` concurrentes del mismo `name` — la vía normal nunca duplica
  slug porque `generateSlug` ya sufija) y 400 de `ownerId` inexistente
  (`P2003` → `InvalidReferenceError`, mensaje `shops.desconocida`).
- [x] 2.3 REPLACE completo de `settings` (un segundo `PUT` sin
  `shopMaintenance` lo borra, `D30-1` demostrado, no oculto) y no-op de
  `logo: null`/`cover_image: null` (con `null as unknown as
  Prisma.InputJsonValue`, precedente literal de
  `manufacturers.integration.test.ts:254`/`tags.integration.test.ts:230`).
- [x] 2.4 Monotonía **solo** `updateShop→updateShop` y
  `setShopActive→setShopActive` (approve→disapprove) con `toBeGreaterThan`
  estricto; ninguna aserción compara contra el timestamp de `createShop`.
- [x] 2.5 Verificación: `just db-check` verde (199/199), corrido tres veces;
  `count(*) FROM shops` restituido a 12 tras cada corrida.

### Archivos tocados (`git diff --stat`)

```
packages/db/src/repositories/shops.integration.test.ts | 187 ++++++++++++++
1 file changed, 187 insertions(+)
```

Solo el archivo de test fue tocado. `shops.repository.ts` no se modificó:
**ningún defecto real apareció** en la batería hostil — las tres escrituras
de PR#1 tradujeron `P2025`/`P2002`/`P2003` y aplicaron los no-op/REPLACE tal
como especifica `design.md`, sin ajustes.

### Decisiones seguidas al pie de la letra (design.md)

- `DD30-10`: `RecordNotFoundError`/`SlugConflictError`/`InvalidReferenceError`
  cubiertas sin ninguna guarda de dominio nueva; el 400 de `ownerId` se
  verificó **en runtime, no solo leído en el traductor** — el mensaje real
  contiene `shops.desconocida` (ver hallazgo abajo).
- `D30-1`/`DD30-4`: el `it` de `settings` demuestra la pérdida de
  `shopMaintenance` con `toEqual`/`not.toHaveProperty`, no la esconde ni la
  evita.
- `DD30-2`/`DD30-4`: `logo`/`coverImage` con `null as unknown as
  Prisma.InputJsonValue` (nunca `as any`) — el mismo patrón ya usado por
  `manufacturers`/`tags` en US-27b, porque el tipo del input no admite
  `null` bajo `strict: true` de `packages/db/tsconfig.json`.
- `DD30-7`: los dos `it` de monotonía comparan **solo** dentro del mismo
  reloj (`update→update`, `setActive→setActive`); ninguna aserción mezcla
  `create` con `update`.
- Alcance: `id no entero` **no** se cubrió aquí (vive en PR#4/jest, sobre
  `@Body('id')`), tal como excluye el header de Phase 2 de `tasks.md`.

### Deviations from Design

Ninguna.

### Issues Found

Ninguno en `shops.repository.ts` — las tres escrituras de PR#1 pasaron la
batería hostil sin cambios.

**Hallazgo de comportamiento real, documentado por pedido explícito de la
sesión** (¿`P2003` sale como documenta `DD30-10` bajo Prisma 7 +
`adapter-pg`?): **sí, confirmado empíricamente.** `createShop({ ownerId:
999999999, ... })` lanza `InvalidReferenceError` cuyo `.message` contiene
literalmente `` `shops.desconocida` `` — `translateCatalogWriteError` no
recibe `meta.field_name` en el error de Prisma (por eso cae al default
`'desconocida'`, nunca a `uniqueField`, que esta función tampoco pasa). El
`it` de 2.2 lo asserta con `toContain('shops.desconocida')`, no solo con
`toBeInstanceOf`.

También se verificó, corriendo la suite tres veces seguidas, que el `it` de
carrera de `slug` (2.2) **no es flaky** en este entorno: las dos llamadas
concurrentes a `createShop` con el mismo `name` produjeron consistentemente
exactamente una fila creada y un `SlugConflictError` en el otro brazo, las
tres corridas.

### Evidencia real pegada

**`cd packages/db && npm run typecheck`** (limpio):

```
> @safari/db@0.1.0 typecheck
> tsc --noEmit
```

**`just db-build`** (limpio, corrido antes de la primera verificación):

```
npm run build
> prisma generate && tsup
✔ Generated Prisma Client (7.10.0) to .\generated\prisma\client in 303ms
CJS dist\index.js     165.26 KB
CJS ⚡️ Build success in 305ms
DTS ⚡️ Build success in 11613ms
DTS dist\index.d.ts 1.40 MB
```

**`psql` — baseline antes de correr (idéntico al de PR#1):**

```
SELECT count(*) FROM shops;                        -> 12
SELECT count(*) FROM shops WHERE is_active=false;   -> 0
SELECT count(*) FROM shops WHERE slug LIKE 'zz-%';  -> 0
```

**`just db-check`** — corrida 1:

```
 Test Files  10 passed (10)
      Tests  199 passed (199)
   Start at  21:24:09
   Duration  37.38s
```

**`just db-check`** — corrida 2:

```
 Test Files  10 passed (10)
      Tests  199 passed (199)
   Start at  21:25:10
   Duration  29.48s
```

**`just db-check`** — corrida 3 (extra, por el riesgo de no-determinismo del
`it` de carrera de slug, task 2.2):

```
 Test Files  10 passed (10)
      Tests  199 passed (199)
   Start at  21:25:54
   Duration  28.92s
```

199 = 191 (cierre de PR#1) + 8 `it` nuevos de este slice (2 de 404, 2 de
409/400, 2 de settings/logo no-op, 2 de monotonía). Las aserciones
pre-existentes de PR#1 siguen verdes dentro de esos 10 archivos: `shops` 12/
`id 15`, `name:'shop'`→7, `productsCount` 584/82/188/44
(`grocery-shop`/`makeup-shop`/`noaw`/`gadget`), y `users.integration.test.ts`
con `toHaveLength(12)` (no tocado, ni degradado por ningún centinela
superviviente — `ownerId: 3` sostuvo el escudo también en este slice).

**`psql` — cierre de conteos (post `db-check`, restituido al baseline):**

```
SELECT count(*) FROM shops;                        -> 12
SELECT count(*) FROM shops WHERE is_active=false;  -> 0
SELECT count(*) FROM shops WHERE slug LIKE 'zz-%'; -> 0
```

Coincide exactamente con el baseline medido antes de empezar este slice y
con el de PR#1.

### Workload / PR Boundary

- Mode: chained PR slice (4 unidades de trabajo, un commit por slice, misma
  rama `us-30-escrituras-moderacion-tiendas`)
- Current work unit: 2 de 4 (PR#2 — `packages/db` batería hostil)
- Boundary: empieza sobre las tres escrituras ya verdes de PR#1 y termina
  con la cobertura hostil completa (404/409/400/no-op/monotonía) del mismo
  archivo, sin tocar `shops.repository.ts` ni ningún archivo fuera de
  `packages/db`
- Estimated review budget impact: 187 líneas netas (solo adiciones), muy por
  debajo del ~260 estimado en `tasks.md` y del presupuesto de 400

### Remaining Tasks (fuera de este run — Phase 3, 4, 5)

- [ ] 3.1–3.9 Capa API — servicio, controller, DTO (`apps/api/rest`, PR#3)
- [ ] 4.1–4.6 `shops.service.spec.ts` (`apps/api/rest`, PR#4)
- [ ] 5.1–5.10 Cierre de la DoD y del épico (evidencia, todo PR)

### Status

16/16 tareas de Phase 1+2 completas (11 de Phase 1 + 5 de Phase 2). Ready
for next batch (Phase 3, PR#3).

## Slice 3 / 4 — PR#3: Capa API (US releasable aquí)

**Estado: COMPLETO.** `just build-api` limpio, `cd apps/api/rest && npx jest`
sin regresión (9/9 suites, 204/204 tests — idéntico al baseline), evidencia
HTTP real contra un proceso reiniciado de verdad.

### Tareas completadas (Phase 3, tasks.md)

- [x] 3.1 `shops.service.ts`: eliminados el import de `@db/shops.json`, el
  `plainToClass` y el campo `private shops`.
- [x] 3.2 `create(dto, user)` migrado: `CreateShopInput` campo a campo
  (`ownerId = user.sub`, `isActive = user.permissions.includes('super_admin')`,
  jsonb con `!= null`/`!== undefined` por `DD30-4`), `createShop(input)`,
  proyección `toShopDto`, `catch { throw toWriteHttpException(error); }`.
- [x] 3.3 `update(id, dto, user)` migrado: guarda numérica (nivel A) → 404;
  `findShopOwnerById(id)` → `null` → 404 (nunca 403); `super_admin` salta el
  403; `ownerId !== user.sub` → 403; `UpdateShopInput` campo a campo (nunca
  `...dto`, sin `slug`/`ownerId`/`isActive`); `updateShop(id, input)`;
  mismo `catch`.
- [x] 3.4 `_setActive(rawId, isActive)` privado: `typeof`-narrowing +
  `Number.isSafeInteger` + `<= 0` → 400; `setShopActive(parsed, isActive)`;
  `catch` → `toWriteHttpException` (`P2025` → 404). `approveShop(id)` =
  `_setActive(id, true)`; `disapproveShop(id)` = `_setActive(id, false)`.
- [x] 3.5 `getStaffs` migrado: sin I/O, `{ data: [], ...paginate(0, page,
  limit, 0, url) }`, mismo `paginate()` de hoy.
- [x] 3.6 Stubs `createStaff()`/`updateStaff()` declarados (devuelven
  `null`), sin `@CurrentUser()` pass-through.
- [x] 3.7 `shops.controller.ts`: `@CurrentUser()` añadido en `create`/
  `update` de `ShopsController`; `StaffsController.create` →
  `shopsService.createStaff()`, `StaffsController.update` →
  `shopsService.updateStaff()`. `@Permissions`, `@Body('id')` sin tipar de
  `approve-shop`/`disapprove-shop`, `remove()` y `approve()` de
  `ShopsController` **intactos**.
- [x] 3.8 `create-shop.dto.ts`: solo comentario documentando campos
  aceptados/descartados, sin efecto de runtime.
- [x] 3.9 Verificación: ver evidencia abajo.

### Archivos tocados (`git diff --stat`)

```
apps/api/rest/src/shops/dto/create-shop.dto.ts |  13 ++
apps/api/rest/src/shops/shops.controller.ts    |  23 ++-
apps/api/rest/src/shops/shops.service.ts       | 199 +++++++++++++++++++++----
3 files changed, 199 insertions(+), 36 deletions(-)
```

Ningún archivo fuera del alcance de este slice fue tocado:
`domain-errors.ts`, `common/errors/`, `slug.ts`, `db/schema.sql`,
`packages/db/**`, `apps/shop/**`, `apps/admin/**` y `update-shop.dto.ts`/
`get-staffs.dto.ts` permanecen sin cambios (verificado con
`git status --short`).

### Decisiones seguidas al pie de la letra (design.md)

- `DD30-1`: **una** función de repositorio (`setShopActive`, ya en
  `packages/db` desde PR#1), dos métodos de servicio
  (`approveShop`/`disapproveShop`) delegando en un único `_setActive`
  privado — ninguna guarda duplicada entre caminos.
- `DD30-2`: construcción campo a campo en `create`/`update`, **nunca
  `...dto`**; `slug`/`owner_id`/`is_active` fuera del input de edición a
  nivel de tipo (`UpdateShopInput`, ya definido en PR#1) y de código (jamás
  copiados desde el body). Verificado en runtime: `PUT` con `owner_id` de
  otro usuario en el body no lo cambia (probado indirectamente — el body
  nunca llega al input).
- `DD30-3`: secuencia 404→403 en `update` (guarda numérica primero,
  `findShopOwnerById` después, `super_admin` salta solo el 403); en
  moderación, `typeof`-narrowing antes de `Number(...)` — `{"id": true}` y
  `{"id":"abc"}` verificados en vivo, ambos 400, nunca 500; id inexistente
  verificado 404 (nunca 500 — el `TypeError` de ayer ya no existe).
- `DD30-4`: `logo`/`cover_image`/`address`/`settings` con `!= null` en el
  servicio (createShop e updateShop); `description` con `!== undefined`.
- `DD30-5`: `productsCount` nunca `?? 0` en las rutas de escritura — las
  tres funciones de `packages/db` ya traen `COUNT_PRODUCTS` desde PR#1; el
  servicio solo proyecta.
- `DD30-8`: **los dos** call sites de `StaffsController` (`create` 1 arg,
  `update` 2 args) migrados a `createStaff()`/`updateStaff()` propios,
  ninguno con `@CurrentUser()` pass-through. `remove()`/`approve()` de
  `ShopsController` **no tocados** (verificado con `git diff`).
- `DD30-10`: `getStaffs` usa `paginate()` (nunca `buildPaginator`), mismo
  key-set/tipo de `per_page` — verificado empíricamente en el `curl` de
  evidencia manual quedó pendiente de esta corrida (CA-4 completo vive en
  Phase 5); el contrato de tipos no cambió.
- `CA-6`: cero imports de `@db/` o `plainToClass` en `shops.service.ts`
  (`grep` pegado abajo, 0 líneas).

### Deviations from Design

Ninguna respecto a `design.md`. Una nota de alcance: el DoD de esta fase
(instrucción de la sesión) no exige `just verify` (que requiere `shop-dev`/
`admin-dev` arriba, fuera del alcance de este slice de API); en su lugar se
pegó la matriz de evidencia HTTP `curl` completa exigida explícitamente por
el DoD de la sesión (`POST → GET /new-shops → approve-shop → GET /shops →
PUT propio/ajeno → disapprove-shop`, más los bordes numéricos y el diff de
16 claves). `just verify` con los 3 servicios completos queda para el
cierre de Phase 5 si la sesión lo pide.

### Issues Found

Uno operativo, no de código: al arrancar `just api-dev` en background se
encontró un proceso `node dist/main` **preexistente** (PID 1996, arrancado
antes de esta sesión) ya escuchando en el puerto 9001 — `just api-dev`
(modo watch) murió con `EADDRINUSE`. Para garantizar que la evidencia
reflejara el código de este slice y no un binario viejo, se mató ese
proceso preexistente y se levantó un `node dist/main` fresco desde el
`dist/` recién compilado por `just build-api` (PID nuevo, verificado con
`netstat`). Toda la evidencia pegada abajo corre contra ese proceso
verificado-fresco, incluido un reinicio real adicional (parada limpia,
puerto liberado, arranque limpio) antes de repetir la secuencia completa.

### Evidencia real pegada

**`just db-build`** (limpio):

```
npm run build
> prisma generate && tsup
✔ Generated Prisma Client (7.10.0) to .\generated\prisma\client in 1.55s
CJS dist\index.js     165.26 KB
CJS ⚡️ Build success in 417ms
DTS ⚡️ Build success in 27949ms
DTS dist\index.d.ts 1.40 MB
```

**`just build-api`** (limpio, sin `TS2554`):

```
yarn build
$ rimraf dist
$ nest build
Done in 78.26s.
```

**`grep -n "@db/\|plainToClass" apps/api/rest/src/shops/shops.service.ts`**:

```
(sin salida — 0 líneas, exit code 1)
```

**`cd apps/api/rest && npx jest`** (sin regresión):

```
PASS src/manufacturers/manufacturers.service.spec.ts
PASS src/types/types.service.spec.ts
PASS src/common/errors/domain-error.mapper.spec.ts
PASS src/shops/shops.service.spec.ts
PASS src/tags/tags.service.spec.ts
PASS src/categories/categories.service.spec.ts
PASS src/products/products.service.spec.ts
PASS src/users/user-dto.mapper.spec.ts
PASS src/users/users.service.spec.ts

Test Suites: 9 passed, 9 total
Tests:       204 passed, 204 total
```

Idéntico al baseline pre-US-30 (9 suites/204 tests) — `user-dto.mapper.spec.ts`
confirmado explícitamente en verde pese al cambio de grafo de módulos por
quitar `@db/shops.json` de `shops.service.ts`.

**Secuencia HTTP en vivo** (proceso verificado-fresco, `node dist/main`,
token `store_owner@demo.com` = user 1, token `admin@demo.com` = user 3 con
`super_admin`):

```
POST /shops {"name":"zz-tiendas-prueba2"} (store_owner) -> 201
  {"id":122,"owner_id":1,...,"is_active":0,...} (16 claves)

GET /new-shops (super_admin) -> 200, total=2, ids=[122,120]
  (120 era el residuo de la corrida previa contra el proceso viejo,
  también visible — confirma que ambos procesos comparten la misma base)

POST /approve-shop {"id":122} (super_admin) -> 201, is_active:1

GET /shops?search=name:zz-tiendas-prueba2 (público) -> 200, total=1, ids=[122]

PUT /shops/122 {"description":"tienda propia editada"} (store_owner, propio) -> 200

PUT /shops/121 {"description":"intento ajeno"} (store_owner, owner_id=3) -> 403
  {"statusCode":403,"message":"No tienes permisos sobre la tienda 121.","error":"Forbidden"}

POST /disapprove-shop {"id":122} (super_admin) -> 201, is_active:0

POST /approve-shop {"id":"abc"} -> 400
  {"statusCode":400,"message":"El id de la tienda debe ser un entero positivo, recibido: \"abc\".","error":"Bad Request"}

POST /approve-shop {"id":888888} -> 404 (NUNCA 500 — el TypeError de ayer ya no existe)
  {"statusCode":404,"message":"No existe un registro de `shops` con id 888888.","error":"Not Found"}

POST /approve-shop {"id":true} -> 400
  {"statusCode":400,"message":"El id de la tienda debe ser un entero positivo, recibido: true.","error":"Bad Request"}
```

Persistencia tras reinicio real verificada: `GET /shops/zz-tiendas-prueba`
(la tienda `id 120` de la corrida contra el proceso viejo) siguió
respondiendo `is_active:0` tras matar el proceso 1996 y levantar uno nuevo
— sobrevivió a un reinicio real del proceso de la API.

**Diff de 16 claves** (`node -e`, sin `jq`, sin `.sort()`) entre una tienda
del seed (`gadget`) y la tienda creada/moderada (`zz-tiendas-prueba2`):

```
seed keys (16): id,owner_id,name,slug,description,cover_image,logo,is_active,
  address,settings,notifications,created_at,updated_at,orders_count,
  products_count,owner
created keys (16): id,owner_id,name,slug,description,cover_image,logo,
  is_active,address,settings,notifications,created_at,updated_at,
  orders_count,products_count,owner
only in seed: []
only in created: []
```

**Limpieza pre-`db-check`** (`psql`, filas del `curl` — `owner_id` de
usuario 1 y 3, no del escudo `ownerId: 3` de vitest):

```
SELECT id, name, slug, owner_id, is_active FROM shops WHERE slug LIKE 'zz-%' ORDER BY id;
 120 | zz-tiendas-prueba  | zz-tiendas-prueba  | 1 | f
 121 | zz-tiendas-ajena   | zz-tiendas-ajena   | 3 | t
 122 | zz-tiendas-prueba2 | zz-tiendas-prueba2 | 1 | f

DELETE FROM shops WHERE slug LIKE 'zz-%';  -> DELETE 3
```

**`psql` — cierre de conteos (post-limpieza, antes de `db-check`)**:

```
SELECT count(*) FROM shops;                        -> 12
SELECT count(*) FROM shops WHERE is_active=false;  -> 0
SELECT count(*) FROM shops WHERE slug LIKE 'zz-%'; -> 0
```

**`just db-check`** (tras la limpieza, prueba de que el `curl` no
contaminó el runner de vitest):

```
 Test Files  10 passed (10)
      Tests  199 passed (199)
   Start at  21:46:26
   Duration  26.04s
```

**`psql` — cierre final (post `db-check`)**:

```
SELECT count(*) FROM shops;                        -> 12
SELECT count(*) FROM shops WHERE is_active=false;  -> 0
SELECT count(*) FROM shops WHERE slug LIKE 'zz-%'; -> 0
SELECT id FROM shops WHERE is_active ORDER BY id DESC LIMIT 1; -> 15
```

Coincide exactamente con el baseline medido antes de empezar este slice.

Proceso `node dist/main` de la evidencia **detenido** al cierre de este
slice (puerto 9001 verificado libre con `netstat`).

### Campos descartados y rutas stub (reporte adelantado de CA-6/5.6)

- Campos aceptados y descartados sin 400: `balance`, `admin_commission_rate`,
  `categories: number[]`, y `owner_id`/`is_active` si llegaran en el body
  de `PUT` (documentado en el comentario de `create-shop.dto.ts`).
- Rutas que siguen siendo stub, sin escritura real: `DELETE /shops/:id`
  (`remove()`), `POST /shops/approve` y `POST /shops/disapprove` dentro de
  `ShopsController` (`approve()`, ambas rutas Out of Scope), `POST /staffs`
  (`createStaff()`), `PUT /staffs/:id` (`updateStaff()`), `DELETE
  /staffs/:id` (`remove()`, sin relación staff↔tienda en el DDL).

### Workload / PR Boundary

- Mode: chained PR slice (4 unidades de trabajo, un commit por slice, misma
  rama `us-30-escrituras-moderacion-tiendas`)
- Current work unit: 3 de 4 (PR#3 — capa API, **US releasable aquí**)
- Boundary: empieza sobre `packages/db` ya verde (PR#1+PR#2) y termina con
  las 4 rutas de escritura sirviendo tráfico real (`create`/`update`/
  `approve-shop`/`disapprove-shop`), `getStaffs` desmockeado y los 2 stubs
  de `DD30-8` declarados — sin tocar `shops.service.spec.ts` (PR#4) ni
  ningún archivo fuera de `apps/api/rest/src/shops/{shops.service.ts,
  shops.controller.ts,dto/create-shop.dto.ts}`
- Estimated review budget impact: ~235 líneas netas (`+199/-36` según
  `git diff --stat`), por debajo del presupuesto de 400 (por encima del
  ~380 estimado en `tasks.md`, dentro del margen razonable)

### Remaining Tasks (fuera de este run — Phase 4, 5)

- [ ] 4.1–4.6 `shops.service.spec.ts` (`apps/api/rest`, PR#4)
- [ ] 5.1–5.10 Cierre de la DoD y del épico (evidencia, todo PR)

### Status

25/25 tareas de Phase 1+2+3 completas (11+5+9). Ready for next batch
(Phase 4, PR#4).
