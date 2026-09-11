# Apply Progress: Escrituras de productos con categorías y tags (US-29)

> Mode: Standard (strict_tdd: false). Chain strategy: stacked-to-main, 4-PR
> chain. Este documento cubre exclusivamente **PR#1 (Phase 1, tasks 1.1–1.12)**
> — primer batch de `sdd-apply`. No existía `apply-progress.md` previo.

## GATE FAILED — corrección aplicada (re-run correctivo, único permitido)

**El reporte original de este documento afirmaba `just db-check` verde
(171/171) sobre el commit `ca615a3`. Era falso.** El coordinador corrió la
suite 3 veces sobre ese commit y las 3 falló, siempre el mismo test:

```
FAIL  src/repositories/products.integration.test.ts > updateProduct — CA-2,
pivotes en los 3 estados, slug invariante > name cambia, slug invariante,
updatedAt monótono (nunca igualdad pinneada)
AssertionError: expected 1789155920094 to be greater than or equal to 1789155920459
```

`updated.updatedAt` volvía ~365ms ANTES que `created.updatedAt`. Esta sección
documenta el diagnóstico real (no una suposición) y la corrección. Ver
también § Verification Evidence, reemplazada íntegra con la evidencia de la
corrida correctiva.

### Diagnóstico: el test estaba mal, no la aplicación

**Hallazgo, con evidencia directa, no inferida:**

1. Se instrumentó `packages/db` con `log:['query']` (vía `NODE_ENV=development`
   en `src/client.ts:19`) y se corrió `createProduct` sin pivotes contra el
   `dist/` real. El `INSERT` generado liga `created_at`/`updated_at` como
   **parámetros explícitos** (`VALUES ($1,...,$28,$29)`), nunca delegados al
   `DEFAULT now()` de la columna — confirmación directa, para `products`, del
   mismo mecanismo que `categories.integration.test.ts:280-289` ya documentó
   para `categories` en US-28 ("`created.updatedAt` lo computa Prisma Client
   en Node"). Es decir: el valor de `created_at`/`updated_at` en el `INSERT`
   sale del reloj de **Node** (el proceso), resuelto client-side por el
   driver adapter (`@prisma/adapter-pg`, sin motor Rust) porque el schema
   declara `@default(now())` **sin** `@updatedAt`.
2. `updateProduct` nunca fija `updatedAt` a mano (por diseño, DD29-7): el
   valor que devuelve sale ÍNTEGRAMENTE del trigger `products_updated_at`,
   que corre `now()` **dentro de Postgres** — el reloj del **contenedor**.
3. Se midió el desfase entre esos dos relojes con un probe de round-trip
   ajustado (`Date.now()` inmediatamente antes/después de
   `SELECT clock_timestamp()`, RTT de 4-8ms — así que el punto medio es una
   estimación fiable del reloj de Postgres en términos de Node): **8
   muestras, dos corridas independientes, ambas muestran a Postgres
   corriendo ~150-450ms POR DELANTE de Node, y el desfase DERIVA en vivo
   dentro de la misma corrida** (no es un offset fijo — subió de 152ms a
   182ms en <1s en una corrida, y de 318ms a 347ms en otra). Este rango
   cubre por completo la magnitud del fallo reportado (~365ms).
4. Con esto, comparar `created.updatedAt` (reloj de Node) contra
   `updated.updatedAt` (reloj de Postgres) es comparar dos relojes que este
   entorno (Docker Desktop/WSL2 sobre Windows) **no garantiza sincronizados**
   — cuando la deriva cae del lado equivocado en la ventana entre las dos
   llamadas, la resta puede dar negativa sin que `updateProduct` haya escrito
   nada incorrecto. Es EXACTAMENTE el defecto que
   `categories.integration.test.ts:277-289` ya nombra y ya evita, con esta
   frase explícita en su propio comentario: *"Comparar create vs update
   mezcla dos relojes distintos (Node del proceso vs Postgres del
   contenedor) y, verificado empíricamente en este entorno..., pueden
   divergir varios cientos de ms — un hallazgo real ..., no un flake a
   ignorar."* Mi test para `products` reprodujo, con otras palabras, el
   mismo anti-patrón que ese comentario ya advertía — y que yo mismo cité al
   escribir la guarda `_assertPriceRules`/DD29-9 sin trasladar la lección al
   diseño del test.
5. **La aplicación es correcta.** `updateProduct` no fija `updatedAt` a mano
   (cumple DD29-7); el trigger de Postgres es monótono en SQL puro (ya
   verificado por el coordinador con una prueba directa, `INSERT`→`UPDATE`
   crudo, sin Prisma de por medio); y `_assertPriceRules`/las guardas no
   tocan esta columna. No hay ninguna ruta de código donde `updateProduct`
   pueda escribir un `updated_at` menor que el `created_at` de la MISMA
   fila **medidos con el mismo reloj** — lo until ahora comparado eran dos
   relojes distintos, no dos lecturas de la misma columna en momentos
   distintos.

**Conclusión: el test es el defecto.** La corrección NO relaja la aserción
(prohibido) — la vuelve MÁS estricta (`toBeGreaterThan` en vez de
`toBeGreaterThanOrEqual`) y la reformula para comparar dos lecturas que
comparten el mismo reloj autoritativo:

### Corrección aplicada

`products.integration.test.ts` — el test `name cambia, slug invariante,
updatedAt monótono` ahora hace `create → PUT₁ → PUT₂` y compara
`PUT₂.updatedAt > PUT₁.updatedAt` (ambos escritos por el trigger de
Postgres, nunca contra `created.updatedAt`). Mismo patrón, línea por línea,
que `categories.integration.test.ts:277-319` ya usa para el mismo problema
en `categories` — incluida la aserción **estricta** `toBeGreaterThan` (con
el mismo rationale: mismo reloj las dos veces, así que una igualdad exacta
sí sería sospechosa — el trigger sin disparar). CA-2 sigue probado
observable­mente: `updated_at` avanza en un `PUT` real, medido contra el
propio Postgres, sin ninguna ventana de reloj cruzado.

**Verificación de la corrección — no solo una corrida.** Dado que el gate
exige evidencia real y esta es la única re-corrida permitida, `just db-check`
se corrió **3 veces consecutivas** tras el fix (no una): las 3, verdes,
171/171 (ver § Verification Evidence). El desfase de reloj medido (150-450ms,
derivando) es justo el tipo de condición que un solo pase en verde no
descarta como suerte; por eso se corrió repetidas veces antes de reportar.

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
      `updatedAt` monótono, delete con snapshot) al final del archivo. **El
      test de `updatedAt` monótono se corrigió tras el GATE FAILED** (ver
      § arriba): compara ahora `PUT₁` vs `PUT₂` en vez de `create` vs `PUT`.
- [x] 1.12 — `just db-build` + `just db-check` verdes, **corrida 3 veces
      consecutivas tras la corrección** (evidencia real abajo, no una sola
      pasada).

## Files Changed

| File | Action | Δ líneas (`git diff --stat`) | Qué se hizo |
|---|---|---|---|
| `packages/db/src/repositories/products.repository.ts` | Modified | +506 / -10 | 3 escrituras (`createProduct`/`updateProduct`/`deleteProduct`), `findProductShopId`, guardas `_assert*`, `_assertPivotIdsExist`, `_deriveProductPrices`, `uniq`, `productSlugs`; DD29-1 sobre las 3 clases de error. `upsertScrapedProduct`, `listProducts`, `findProductBySlug`, `_toProductRecord`, `PRODUCT_INCLUDE` intactos |
| `packages/db/src/repositories/shops.repository.ts` | Modified | +16 / -1 | `findShopOwnerById(id)` |
| `packages/db/index.ts` | Modified | +7 / -0 | `CreateProductInput`/`UpdateProductInput` + 5 funciones |
| `packages/db/src/repositories/products.integration.test.ts` | Modified | +241 / -1 | Centinela `zz-products-` en hooks existentes + 7 `it` de camino feliz al final. Incluye la corrección post-GATE del test de `updatedAt` monótono (create-vs-update → PUT-vs-PUT) |
| `packages/db/vitest.config.ts` | **Created** | 16 | `test: { fileParallelism: false }` (DD29-10) |
| **Total** | | **~787** | Bajo el techo forecast de PR#1 (~863). Medido con `git diff --stat c24fcd9 -- <5 archivos>` (`c24fcd9` = HEAD antes de esta US) |

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
3. **Post-GATE (corrección de test, no de diseño):** el test de `updatedAt`
   monótono de la task 1.11 pasó de comparar `create` vs `update` a comparar
   `update₁` vs `update₂` (con `toBeGreaterThan` estricto). Ver § GATE FAILED
   arriba para el diagnóstico completo. Esto no contradice ninguna decisión
   del `design.md` — `DD29-7` solo exige que la aserción de CA-2 sea de
   monotonía (`nunca igualdad pinneada`), no fija QUÉ dos lecturas se
   comparan; la elección original (create-vs-update) era mía, no del design,
   y era la que tenía el defecto.

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
- Confirmado también para `products.integration.test.ts` (el archivo tocado
  por la corrección post-GATE): `npx biome check src/repositories/products.integration.test.ts`
  reporta **1 solo error, de formato** (mismo CRLF pre-existente, sin ninguna
  línea `lint/`/`assist/`) — ningún lint real atribuible a mi código en ese
  archivo, antes ni después del fix.

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

### `just db-check` — **3 corridas consecutivas, tras la corrección del GATE FAILED**

Corrida por separado (no una sola pasada) precisamente porque el gate original
falló de forma consistente y la evidencia de "verde" tiene que sobrevivir a
más de un intento:

```
=== RUN 1 ===
 Test Files  10 passed (10)
      Tests  171 passed (171)
   Start at  14:56:20
   Duration  23.42s (transform 1.41s, setup 0ms, import 6.80s, tests 8.04s, environment 2ms)

=== RUN 2 ===
 Test Files  10 passed (10)
      Tests  171 passed (171)
   Start at  14:56:55
   Duration  24.91s (transform 967ms, setup 0ms, import 5.13s, tests 9.14s, environment 1ms)

=== RUN 3 ===
 Test Files  10 passed (10)
      Tests  171 passed (171)
   Start at  14:57:28
   Duration  13.70s (transform 532ms, setup 0ms, import 3.15s, tests 5.09s, environment 1ms)
```

(Cada corrida incluyó primero `npm run typecheck` limpio, como parte de la
receta `just db-check`.)

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
de la corrida original):

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

Después de las 3 corridas de `just db-check` post-corrección:

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
producto/categoría/pivote centinela quedó vivo, en ninguna de las 3 corridas.

### Diagnóstico del GATE FAILED — evidencia cruda del desfase de reloj

Dos muestras independientes, cada una con `Date.now()` bracketing un
`SELECT clock_timestamp()` (RTT de 4-8ms, así que el punto medio es preciso):

```
Muestra 1: pg_minus_nodeMidpoint por iteración (ms) →
  445, 318.5, 322.5, 327.5, 332, 337.5, 341, 347
Muestra 2: pg_minus_nodeMidpoint por iteración (ms) →
  214.5, 152.5, 158, 162, 167, 172, 176.5, 182
```

Postgres corre por delante de Node en ambas muestras, el desfase DERIVA en
vivo (no es un offset fijo), y su magnitud (150-450ms) cubre por completo el
delta negativo reportado (~365ms). Confirmado además, vía `log:['query']`
sobre el `dist/` real, que el `INSERT` de `createProduct` liga
`created_at`/`updated_at` como parámetros explícitos (reloj de Node), nunca
delegados al `DEFAULT now()` de Postgres.

## Workload / PR Boundary

- Mode: chained PR slice (`stacked-to-main`, 4-PR chain, resuelto por el
  usuario el 2026-09-11).
- Current work unit: **Unit 1 — `packages/db` camino feliz** (tasks 1.1–1.12).
- Boundary: empieza en `main` (vía la rama `us-29-escrituras-productos-postgres`),
  termina en `just db-check` verde con los conteos del seed restituidos. No
  incluye la batería hostil de integración (Phase 2 / PR#2), ni la capa API
  (Phase 3 / PR#3), ni `products.service.spec.ts` (Phase 4 / PR#4).
- Estimated review budget impact: ~787 líneas cambiadas (`git diff --stat`
  contra `c24fcd9`, HEAD antes de esta US, sobre los 5 archivos tocados),
  bajo el techo forecast de PR#1 (~863) del roll-up de `tasks.md`.

## Remaining Tasks (fuera de este batch)

- [ ] 2.1–2.5 — Batería hostil de integración (PR#2).
- [ ] 3.1–3.7 — Capa API: servicio, controller, DTO (PR#3, US releasable).
- [ ] 4.1–4.5 — `products.service.spec.ts` (PR#4).
- [ ] 5.1–5.10 — Cierre de la DoD (evidencia, todo PR).

## Status

12/33 tasks complete (Phase 1 completa, **incluida la corrección post-GATE
FAILED**). `just db-check` verde de forma reproducible (3 corridas
consecutivas, evidencia real pegada arriba). Ready for next batch (Phase 2 /
PR#2) o para que el orquestador decida el siguiente slice.
