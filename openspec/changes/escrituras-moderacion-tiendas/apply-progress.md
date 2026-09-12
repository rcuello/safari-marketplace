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

### Remaining Tasks (fuera de este run — Phase 2, 3, 4, 5)

- [ ] 2.1–2.5 Batería hostil de integración (`packages/db`, PR#2)
- [ ] 3.1–3.9 Capa API — servicio, controller, DTO (`apps/api/rest`, PR#3)
- [ ] 4.1–4.6 `shops.service.spec.ts` (`apps/api/rest`, PR#4)
- [ ] 5.1–5.10 Cierre de la DoD y del épico (evidencia, todo PR)

### Status

11/11 tareas de Phase 1 completas. Ready for next batch (Phase 2, PR#2).
