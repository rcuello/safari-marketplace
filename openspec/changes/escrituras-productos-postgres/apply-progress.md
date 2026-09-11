# Apply Progress: Escrituras de productos con categorías y tags (US-29)

> Mode: Standard (strict_tdd: false). Chain strategy: stacked-to-main, 4-PR
> chain. Este documento cubre exclusivamente **PR#1 (Phase 1, tasks 1.1–1.12)**
> — primer batch de `sdd-apply`. No existía `apply-progress.md` previo.

## Branch / workspace

- Branch de trabajo: `us-29-escrituras-productos-postgres` (ya creado y
  checked out por el orquestador antes de este run).
- Postgres `safari-postgres`: up y healthy, puerto 5433, sin `just db-reset`.
- Ningún archivo fuera de `packages/db` fue tocado en este batch (Phase 1 es
  `packages/db` only, per alcance).

## Completed Tasks (Phase 1 / PR#1)

- [x] 1.1 — `InvalidSalePriceError`/`MissingPriceError`/`IncompleteProvenanceError`
      ahora extienden `CatalogWriteError` con
      `code = CATALOG_ERROR_CODES.InvalidReference` y `super(mensaje, 'products')`.
      `upsertScrapedProduct` sin tocar.
- [x] 1.2 — `productSlugs` local; `_assertIntegerRef` (B1), `_assertFiniteNumber`
      (B2, incluye el borde `numeric(12,2)`), `_assertIntegerCount` (B3),
      `_assertProductType`/`_assertStatus`, `_assertPriceRules` con el disyunto
      `price != null` (DD29-9).
- [x] 1.3 — `_assertPivotIdsExist(categoryIds?, tagIds?)`: sonda `count`
      normativa por tabla, no delega en `P2003`.
- [x] 1.4 — `createProduct(input)` con el orden normativo completo (frontera
      numérica → guardas de dominio → sonda de pivotes → derivaciones DD29-7 →
      `generateSlug` → `prisma.product.create` con `include: PRODUCT_INCLUDE` →
      `catch` con el orden `translateCatalogWriteError` → `_translateCheckViolation`).
- [x] 1.5 — `updateProduct(id, input)` con `current` (404), `normalizeSlug`
      descartado, estado efectivo `!== undefined` (nunca `??`), pivotes con
      spread condicional `deleteMany+create`, `updatedAt` sin fijar a mano.
- [x] 1.6 — `deleteProduct(id)` con snapshot pre-borrado.
- [x] 1.7 — `findProductShopId(id)` en `products.repository.ts`.
- [x] 1.8 — `findShopOwnerById(id)` en `shops.repository.ts`.
- [x] 1.9 — Barrel `packages/db/index.ts` actualizado (2 tipos + 5 funciones,
      orden alfabético).
- [x] 1.10 — `packages/db/vitest.config.ts` creado con `fileParallelism: false`.
- [x] 1.11 — `products.integration.test.ts`: centinela `zz-products-` plegado
      en el `beforeAll`/`afterAll` existentes; 7 tests nuevos de camino feliz
      (create simple, create variable, 3 estados de pivote, slug invariante +
      `updatedAt` monótono, delete con snapshot) al final del archivo.
- [x] 1.12 — `just db-build` + `just db-check` verdes (evidencia abajo).

## Files Changed

| File | Action | Δ líneas (`git diff --stat`) | Qué se hizo |
|---|---|---|---|
| `packages/db/src/repositories/products.repository.ts` | Modified | +506 / -10 | 3 escrituras (`createProduct`/`updateProduct`/`deleteProduct`), `findProductShopId`, guardas `_assert*`, `_assertPivotIdsExist`, `_deriveProductPrices`, `uniq`, `productSlugs`; DD29-1 sobre las 3 clases de error. `upsertScrapedProduct`, `listProducts`, `findProductBySlug`, `_toProductRecord`, `PRODUCT_INCLUDE` intactos |
| `packages/db/src/repositories/shops.repository.ts` | Modified | +16 / -1 | `findShopOwnerById(id)` |
| `packages/db/index.ts` | Modified | +7 / -0 | `CreateProductInput`/`UpdateProductInput` + 5 funciones |
| `packages/db/src/repositories/products.integration.test.ts` | Modified | +215 / -1 | Centinela `zz-products-` en hooks existentes + 7 `it` de camino feliz al final |
| `packages/db/vitest.config.ts` | **Created** | 16 | `test: { fileParallelism: false }` (DD29-10) |
| **Total** | | **~748** | Bajo el techo forecast de PR#1 (~863) |

## Decisions Encountered / Deviations from Design

Ninguna decisión del design se contradijo. Dos precisiones tomadas durante la
implementación, ambas dentro de lo que el design autoriza pero no deletreaba
línea a línea:

1. **`_assertProductType`/`_assertStatus` corren sobre el input CRUDO
   (`input.productType`/`input.status`), no sobre el valor ya defaulteado.**
   El contrato del design (`function _assertProductType(value: string |
   undefined): void`) acepta `undefined` — igual que `_assertIntegerRef` no
   valida `null`/`undefined` — porque el `DEFAULT` de la columna (`'simple'`/
   `'publish'`) es siempre válido por construcción; validar el default sería
   trabajo redundante. La derivación con `??` a un default ocurre DESPUÉS,
   solo para construir `productType`/`status` efectivos que sí usan
   `_assertPriceRules` y la escritura.
2. **`updateProduct`, cuando `_toProductRecord` del propio `update` devuelve
   `null`** (carrera: `type`/`shop` cayeron en cascada entre el `findUnique`
   inicial y el `update`), lanza `RecordNotFoundError` — no
   `InvalidReferenceError` como hace `createProduct` en el mismo caso. Mismo
   razonamiento que DD29-5 aplica a `deleteProduct`: la fila se está borrando
   sola, no es una referencia que nunca existió. El design no cubre
   explícitamente esta rama de `updateProduct` (solo la de `create`/`delete`);
   se extendió el rationale de DD29-5 por analogía, no se inventó una regla
   nueva.

**Declarada explícitamente (ya prevista por el propio design, DD29-10):**
`packages/db/vitest.config.ts` es superficie NO listada en la tabla «Archivos
a crear/modificar» original de US-29, ratificada en alcance por el usuario el
2026-09-11 (task 1.10). Sin este archivo, `shops.integration.test.ts`
(`productsCount` `toBe(584)`/`toBe(82)`/`toBe(188)`/`toBe(44)`) y
`categories.integration.test.ts` (`toBe(198)`/`toBe(83)`) quedarían expuestos
a un flake por fila centinela de otro worker de vitest corriendo en paralelo.

## Issues Found

Ninguno bloqueante. Una nota de entorno, no de código:

- `cd packages/db && npm run lint` (biome) reporta errores de **formato**
  (CRLF vs. el `lineEnding: "lf"` de `biome.json`) en la práctica totalidad de
  archivos del paquete — **medido en un archivo NO tocado por esta US**
  (`categories.repository.ts`) antes y después de este batch, con el mismo
  resultado. Es una condición pre-existente del checkout de Windows
  (`git config core.autocrlf` = `true` en esta máquina), no algo introducido
  por esta implementación. Verificado con `git stash` (aislando mis 4 archivos
  modificados): **27 errores de baseline sin mis cambios, 28 con ellos**; la
  única diferencia real (no CRLF) era un `noUnusedVariables` que corregí
  (`effectiveStatus` sin usar en `updateProduct`) y un `organizeImports` en mi
  propio bloque de imports nuevo, también corregido. El único lint real
  restante en `products.repository.ts` (`lint/complexity/noUselessSwitchCase`
  en `buildOrderBy:247`, `case 'id': default:`) es código preexistente que
  esta US no toca (confirmado con `git diff` — la función no aparece en el
  diff). No se ejecutó `npm run format`/`biome check --write .` porque
  reformatear CRLF→LF de TODO el paquete excede el alcance de esta US y
  produciría un diff masivo en archivos no relacionados.
  `npm run typecheck` SÍ está limpio (`tsc --noEmit`, sin salida).

## Verification Evidence (real output)

### `just db-build`

```
npm run build
> @safari/db@0.1.0 build
> prisma generate && tsup
✔ Generated Prisma Client (7.10.0) to .\generated\prisma\client in 501ms
CLI Building entry: index.ts
CJS Build start
CJS dist\index.js     163.03 KB
CJS dist\index.js.map 391.38 KB
CJS ⚡️ Build success in 175ms
DTS Build start
DTS ⚡️ Build success in 14084ms
DTS dist\index.d.ts 1.39 MB
```

### `cd packages/db && npm run typecheck`

```
> @safari/db@0.1.0 typecheck
> tsc --noEmit
```
(sin salida — limpio)

### `just db-check`

```
npm run typecheck
> @safari/db@0.1.0 typecheck
> tsc --noEmit

npm test
> @safari/db@0.1.0 test
> vitest run

 Test Files  10 passed (10)
      Tests  171 passed (171)
   Start at  14:37:51
   Duration  18.87s
```

164 tests baseline → 171 tests (7 nuevos: 2 create + 4 update + 1 delete de
`createProduct`/`updateProduct`/`deleteProduct`). Los conteos pinneados
existentes se verificaron corriendo `vitest run --reporter=verbose` y
grepeando los `it` de:

- `categories.integration.test.ts`: `rootsOnly true (default) → 83 raíces` ✓,
  `rootsOnly false → 198 nodos planos (D-4)` ✓, `cierre de la suite (R28-2):
  ningún test de escritura dejó basura: prisma.category.count() vuelve a 198` ✓.
- `shops.integration.test.ts`: `productsCount filtrado por publish/visibility_public
  (Decisión E)` ✓ (asserta `grocery-shop` 584, `makeup-shop` 82, `noaw` 188) y
  `findShopBySlug > trae el mismo productsCount filtrado que el listado` ✓
  (asserta `gadget` 44).

### `psql` — conteos antes/durante/después (Postgres real, `safari-postgres`)

Antes de tocar código (medido por el orquestador, re-verificado por mí antes
de `just db-check`):

```
$ docker exec safari-postgres psql -U safari -d safari_scraper -t \
    -c "SELECT count(*) FROM products;" \
    -c "SELECT count(*) FROM category_product;" \
    -c "SELECT count(*) FROM product_tag;" \
    -c "SELECT count(*) FROM categories;" \
    -c "SELECT count(*) FROM tags;" \
    -c "SELECT count(*) FROM shops;"
  1200
     0
     0
   198
    10
    12
```

Después de `just db-check` (suite completa, incluidas las 7 escrituras
nuevas + cleanup):

```
$ docker exec safari-postgres psql -U safari -d safari_scraper -t \
    -c "SELECT count(*) FROM products;" \
    -c "SELECT count(*) FROM category_product;" \
    -c "SELECT count(*) FROM product_tag;" \
    -c "SELECT count(*) FROM categories;" \
    -c "SELECT count(*) FROM shops;"
  1200
     0
     0
   198
    12
```

Conteos restituidos exactamente al valor medido antes de empezar — ningún
producto/categoría/pivote centinela quedó vivo.

## Workload / PR Boundary

- Mode: chained PR slice (`stacked-to-main`, 4-PR chain, resuelto por el
  usuario el 2026-09-11).
- Current work unit: **Unit 1 — `packages/db` camino feliz** (tasks 1.1–1.12).
- Boundary: empieza en `main` (vía la rama `us-29-escrituras-productos-postgres`),
  termina en `just db-check` verde con los conteos del seed restituidos. No
  incluye la batería hostil de integración (Phase 2 / PR#2), ni la capa API
  (Phase 3 / PR#3), ni `products.service.spec.ts` (Phase 4 / PR#4).
- Estimated review budget impact: ~748 líneas cambiadas (`git diff --stat` +
  16 líneas del archivo nuevo), bajo el techo forecast de PR#1 (~863) del
  roll-up de `tasks.md`.

## Remaining Tasks (fuera de este batch)

- [ ] 2.1–2.5 — Batería hostil de integración (PR#2).
- [ ] 3.1–3.7 — Capa API: servicio, controller, DTO (PR#3, US releasable).
- [ ] 4.1–4.5 — `products.service.spec.ts` (PR#4).
- [ ] 5.1–5.10 — Cierre de la DoD (evidencia, todo PR).

## Status

12/33 tasks complete (Phase 1 completa). Ready for next batch (Phase 2 / PR#2)
o para que el orquestador decida el siguiente slice.
