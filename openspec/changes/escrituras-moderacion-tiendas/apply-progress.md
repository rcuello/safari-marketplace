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
