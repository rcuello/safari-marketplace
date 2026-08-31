# Verification Report

**Change**: `2026-08-31-endpoints-derivados-postgres` (US-5, Épico 1)
**Version**: 3 specs — `derived-catalog-api` (nueva) + deltas `product-listing-api` / `flat-catalogs-api`
**Mode**: Standard (`strict_tdd: false`)
**Fecha de verificación**: 2026-08-31
**Store**: openspec-only (Engram no conectado)

> Todo lo pegado abajo es salida REAL ejecutada durante esta verificación
> (`rules.verify.require_evidence: true`), no copiada de `apply-progress.md`.
> Donde la evidencia procede de otra sesión y no pude reproducirla, se dice.

---

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 28 |
| Tasks complete | 28 |
| Tasks incomplete | 0 |
| Tareas `[x]` con cambio real verificado en `git diff` | 26 |
| Tareas `[x]` NO reproducibles hoy | 2 (1.2, 1.3 — captura del ANTES en scratchpad de otra sesión) |
| Tareas `[x]` con enunciado impreciso | 1 (5.5 — ver SUGGESTION 3) |

Las 28 casillas corresponden a cambios reales. `git status --porcelain` devuelve
exactamente los 10 archivos modificados + los 2 untracked previstos:

```text
 M apps/api/rest/src/products/products.service.ts
 M apps/api/rest/src/shops/shops.service.ts
 M db/generate-seed.mjs
 M db/seed.sql
 M docs/product/1-catalogo-desde-postgres/README.md
 M packages/db/index.ts
 M packages/db/src/repositories/products.integration.test.ts
 M packages/db/src/repositories/products.repository.ts
 M packages/db/src/repositories/shops.integration.test.ts
 M packages/db/src/repositories/shops.repository.ts
?? docs/product/1-catalogo-desde-postgres/5-endpoints-derivados-postgres.md
?? openspec/changes/2026-08-31-endpoints-derivados-postgres/
```

**Scope: limpio.** Intactos (ausentes del `status`): `services/scraper-worker/`,
`db/schema.sql`, `packages/db/prisma/schema.prisma`, `apps/shop/**`,
`apps/admin/**`, `apps/api/graphql/**`, `CLAUDE.md`, `.claude/**`,
`openspec/specs/**`, controladores, DTOs y los ~30 servicios mock. `getStaffs`
sigue en pie (`shops.controller.ts:68`, `shops.service.ts:171`) y `shopsJson` /
`productsJson` se conservan para los stubs, como declara el design.

**Volumen de review** (excluyendo `db/seed.sql`, commit aparte por decisión previa):

```text
$ git diff --numstat
107  92  apps/api/rest/src/products/products.service.ts
 79  27  apps/api/rest/src/shops/shops.service.ts
 35   6  db/generate-seed.mjs
1206 1201 db/seed.sql            <- artefacto, excluido
  2   1  docs/product/1-catalogo-desde-postgres/README.md
  5   1  packages/db/index.ts
 80   0  packages/db/src/repositories/products.integration.test.ts
 60   7  packages/db/src/repositories/products.repository.ts
 43   1  packages/db/src/repositories/shops.integration.test.ts
 83   0  packages/db/src/repositories/shops.repository.ts
```

**629 líneas**, no las 618 que declara `apply-progress.md` (ver SUGGESTION 2).
57% por encima del presupuesto nominal de 400, ya aceptado por el dueño como PR único.

---

## Build & Tests Execution

### `just db-check` — ✅ Passed (57/57)

```text
$ just db-check
> @safari/db@0.1.0 typecheck
> tsc --noEmit

> @safari/db@0.1.0 test
> vitest run

 RUN  v4.1.11 C:/DevOps/MyGitHub/safari-marketplace/packages/db

 Test Files  6 passed (6)
      Tests  57 passed (57)
   Start at  14:40:42
   Duration  6.02s
```

Confirmado en una tercera corrida (`57 passed`, 5.09s). **Pero la PRIMERA
corrida de esta sesión falló** — ver WARNING 1:

```text
 FAIL  src/repositories/shops.integration.test.ts > listShops > lista las 12 tiendas, id desc (D), JSON-safe
Error: Test timed out in 5000ms.
 Test Files  1 failed | 5 passed (6)
      Tests  1 failed | 56 passed (57)
```

### Typecheck de la API — ✅ Passed

No se corrió `just build-api` para no colisionar con el `nest start --watch`
vivo en el 9001; se usó el equivalente sin emisión:

```text
$ cd apps/api/rest && npx tsc -p tsconfig.build.json --noEmit
exit=0
```

### `yarn test` (jest, `apps/api/rest`) — ✅ Passed (20/20)

```text
Test Suites: 1 passed, 1 total
Tests:       20 passed, 20 total
Time:        125.186 s
```

Los 20 son de US-2/US-3 (`getProducts`, `getProductBySlug`). **Ninguno toca los
6 endpoints de esta US.**

### `just verify` — ✅ Passed

```text
$ just verify
OK   API    :9001/api/settings  200  5503B  29ms
OK   Shop   :3003/en  200  190788B  1049ms  cards:30
OK   Admin  :3002/en/login  200  72821B  504ms  cards:1
```

`/api/settings` sigue en **5503 bytes** — el precedente de contrato de
`CLAUDE.md` se reconfirma tras esta US.

**Coverage**: ➖ no configurado (`coverage_threshold: 0`).

---

## Estado de la base (antes y después de la verificación)

```text
$ docker exec safari-postgres psql -U safari -d safari_scraper -c "..."
 r | sq | tr |  n   | scraped
---+----+----+------+---------
 6 |  7 |  6 | 1200 |       0

 shops | maxshop | cats | manus
-------+---------+------+-------
    12 |      15 |  198 |    14
```

La base quedó **exactamente como se encontró**. Las escrituras de esta sesión
fueron solo las fixtures de los tests de integración, que su propio
`beforeAll`/`afterAll` limpia (`sourceStore = 'TestStore-integration'`;
`scraped = 0` lo confirma).

---

## Spec Compliance Matrix — `derived-catalog-api` (nueva)

| # | Requirement (MUST) | Escenario | Evidencia | Result |
|---|---|---|---|---|
| R-1 | Ranking real con desempate estable | popular `4,1,3,2,5,25,6,7,8,9`; best-selling `888,1,2,883,887` | `products.integration.test.ts > listProducts — orderBy (US-5)` (3 tests) **+** `curl` | ✅ COMPLIANT |
| R-2 | Sin regresión en `shops`/`categories` | `shops` 12 / `items[0].id === 15` / `categories` 198 | `shops.integration.test.ts > no-regresión` **+** `categories.integration.test.ts:29,77` | ✅ COMPLIANT |
| R-3 | `type_slug` filtra DENTRO del ranking (B-2) | ≤3 filas del type, mismo orden de ranking | `curl` en 5 types (sin test automatizado) | ⚠️ PARTIAL |
| R-4 | Inventario sin el default de vitrina | stock `total 11`; draft `total 1` id 454 | `products.integration.test.ts > maxQuantity` **+** `> applyStorefrontDefaults opt-out` (2 tests) **+** `curl` | ✅ COMPLIANT |
| R-5 | `new-shops` — cero es el resultado correcto | `{data: [], total: 0}` | `curl` (sin test automatizado de `isActive:false`) | ⚠️ PARTIAL |
| R-6a | Cercanía real, sin radio — orden + 14 claves | 2 orígenes, órdenes distintos, 14 claves en orden | `shops.integration.test.ts > listShopsNear` (orden/≤6/ids) **+** `curl` (las 14 claves y su ORDEN solo por `curl`) | ⚠️ PARTIAL |
| R-6b | `lat`/`lng` no finitos → 200 `[]` (B-4) | `undefined/undefined`, `abc/0` | `shops.integration.test.ts > NaN → []` **+** `curl -w %{http_code}` | ✅ COMPLIANT |
| R-7 | **Errores de conexión a Postgres → 503 / 500** | `just db-down` → los 6 responden 503, proceso vivo | **ningún test en el repo**; sonda efímera de esta verificación (12/12) — el escenario HTTP con Postgres caído NO se ejecutó | ⚠️ PARTIAL (ver CRITICAL 1) |

**Compliance**: 4/8 escenarios con test automatizado verde · 3/8 parciales
(comportamiento probado en runtime por `curl`, sin test de regresión) · 1/8
parcial sin artefacto permanente (R-7).

### Evidencia de R-1, R-3, R-4, R-5, R-6 (ejecutada hoy)

```text
$ API=http://localhost:9001/api
popular       [4,1,3,2,5,25,6,7,8,9]
best-selling  [888,1,2,883,887]
stock total 11 [2,190,1014,1015,1017,1018,1021,1022,1023,1024,1028] per_page= 30
draft total 1 [454] per_page= 30
new-shops total 0 data [] per_page= 10
near NY   [5,1,6,2,4,3]  2.25 | 8.6 | 326.8 | 1301.42 | 5564.46 | 14192.05
near BOG  [6,5,1,2,4,3]  3813.63 | 4005.31 | 4008.16 | 4229.52 | 8485.28 | 12175.66
near keys(14) id,owner_id,name,slug,description,cover_image,logo,is_active,
              address,settings,notifications,created_at,updated_at,distance
near is_active ["number:1","number:1","number:1","number:1","number:1","number:1"]
popular keys(n) 20
created_at near distinct ["2026-08-31T18:48:34.006Z"]
```

**Todos los ids coinciden exactamente** con la tabla "Resultados esperados" del
`design.md` y con la evidencia pegada en la DoD de la US. `distance` es
**numérica**, `is_active` es **`Number(bool)`**, las 14 claves están en el orden
prometido y `created_at` es uniforme (el `now()` del último `db-up`, S-3).

R-3, con 5 types distintos (no solo `grocery`, que era ambiguo porque su top-3
coincide con el top-3 global):

```text
popular?type_slug=grocery&limit=3   -> [4,1,3]            types ["grocery"]
popular?type_slug=bags&limit=5      -> [102,103,104,105,106]  types ["bags"]
popular?type_slug=books&limit=5     -> [883,884,885,886,887]  types ["books"]
popular?type_slug=furniture&limit=5 -> [412,413,414,415,416]  types ["furniture"]
popular?type_slug=clothing&limit=5  -> [110,111,113,114,116]  types ["clothing"]
```

Ninguna fila de otro type: el filtro es **exacto** (ya no `fuse` difuso) y el
orden dentro del grupo respeta `ratings desc, id asc` (todos empatan en `0.00`,
por eso salen por `id asc`). B-2 confirmado.

R-6b:

```text
$ curl -s -w ' <- %{http_code}\n' $API/near-by-shop/undefined/undefined
[] <- 200
$ curl -s -w ' <- %{http_code}\n' $API/near-by-shop/abc/0
[] <- 200
```

El bloqueante que el auditor del design corrigió (400 → 200 `[]`) está vivo en
el código: `/shops` no se rompe en cada carga.

### Contratos de forma (CA-4) verificados hoy

```text
popular      keys == las 20 claves de US-2, EN ORDEN? true
best-selling keys == las 20 claves de US-2, EN ORDEN? true
stock.data   keys == las 20 claves de US-2, EN ORDEN? true
draft.data   keys == las 20 claves de US-2, EN ORDEN? true

envelope stock/new-shops: data,total,current_page,count,last_page,firstItem,
                          lastItem,per_page,first_page_url,last_page_url,
                          next_page_url,prev_page_url
```

`per_page` conserva su tipo crudo (número `30` sin `?limit`, string `"0"` /
`"abc"` con `?limit=`), tal como exige la Decision A de US-2.

### Verificación independiente del test "contraste" (bloqueante corregido)

El encargo pedía comprobar que la aserción nueva **falla** si el default se
debilita. Lo probé por **mutación**, no por razonamiento: cambié
`input.applyStorefrontDefaults !== false` por `=== true` en
`products.repository.ts`, corrí el archivo de tests, y restauré el fichero desde
una copia (el repo quedó idéntico: `git diff --numstat` sigue en `60 7`).

```text
 FAIL  products.integration.test.ts > listProducts — applyStorefrontDefaults opt-out (US-5 Decision C)
       > contraste: el opt-out es la ÚNICA diferencia — sin él, el borrador no se cuenta
AssertionError: expected 1200 to be 1201 // Object.is equality
- Expected  1201
+ Received  1200
 Tests  1 failed | 19 passed (20)
```

**El mutante muere, y lo mata exactamente ese test.** La corrección del
gatekeeper es real: la aserción discrimina. (Dato colateral: es el ÚNICO test
que el mutante mata — los demás no cubren el default de vitrina.)

---

## Spec Compliance — deltas `product-listing-api` y `flat-catalogs-api`

Ambos son deltas de **prosa** (`## MODIFIED Out of Scope`), sección no estándar
en `openspec-convention.md:65-74`, con precedente ya aplicado en el archive de
US-7. No hay código que verificar; lo que sí verifiqué es que **el ancla existe
y el texto "Previously" es literalmente el actual**, para que `sdd-archive` pueda
aplicar el reemplazo:

```text
$ awk '/## Out of Scope/,0' openspec/specs/product-listing-api/spec.md
## Out of Scope

- Detalle por slug (US-3); catálogos de apoyo (US-4).
- `popular-products`/`best-selling-products`: quedan en mock (Decision B).   <- coincide
- `category_product` (vacía por diseño del seed); `db/schema.sql`; frontend.
```

```text
$ (flat-catalogs-api) ... `GET /staffs`, `POST /approve-shop`,
`POST /disapprove-shop`, `GET /new-shops`, `GET /near-by-shop/:lat/:lng` ·   <- coincide
```

| Delta | Estado | Nota |
|---|---|---|
| `product-listing-api` § Out of Scope | ✅ Aplicable | Ancla exacta presente; la exclusión que retira es efectivamente falsa hoy (los dos endpoints ya salen de Postgres) |
| `flat-catalogs-api` § Out of Scope | ✅ Aplicable | Ídem; solo `getStaffs`/`approve`/`disapprove` siguen fuera, y así están en el código |

`derived-catalog-api` usa `## Requirements` (no `## ADDED Requirements`) — es el
**precedente del repo** para capabilities nuevas (5 de 7 specs archivadas lo
hacen así). No es un defecto.

---

## Criterios de Aceptación de la US (CA-1..CA-5)

| CA | Veredicto | Evidencia |
|----|-----------|-----------|
| **CA-1** Destacados con ranking real | ✅ Satisfecho | `popular` y `best-selling` salen de Postgres con los ids del ranking sembrado; tests de `orderBy` verdes + `curl`. **Matiz**: el Gherkin de la US ("todas las filas comparten el mismo `created_at`… ninguna trae la fecha de 2021") **no es literalmente verificable**: `toProductDto` no emite `created_at` (S-1, 46→20 claves). Se cumple *a fortiori* (la clave desapareció), no como está redactado — ver SUGGESTION 4 |
| **CA-2** Inventario desde la base | ✅ Satisfecho | `products-stock` total 11 con los 11 ids esperados; `draft-products` total 1 (id 454); tests `maxQuantity` y opt-out verdes |
| **CA-3** Tiendas desde la base | ✅ Satisfecho | `new-shops` total 0 (12/12 activas, resultado correcto); `near-by-shop` usa `settings->'location'` y descarta las 6 sin coordenadas sin fallar (6 filas de 12). La US escribe la ruta como `near-shop?lat=&lng=`; la real es `/near-by-shop/:lat/:lng` — el design ya corrigió la premisa |
| **CA-4** Contratos preservados | ✅ Satisfecho **con divergencias declaradas** | 20 claves en orden en los 4 de products; 14 en orden en `near-by-shop`; envoltorio de paginación idéntico; `per_page` con su tipo crudo. Divergencias: S-1..S-4 y B-1..B-7 declaradas en la spec; **B-8 NO está en la spec** — ver WARNING 2 |
| **CA-5** Sin regresión y sin mock huérfano | ✅ Satisfecho | `just db-check` 57/57; `Fuse` eliminado de los dos servicios (`git grep` vacío); `popularProductsJson`/`bestSellingProductsJson`/`nearShopJson` fuera; `productsJson`/`shopsJson` se quedan y están declarados en comentario |

### Definición de Done — punto por punto

| DoD | Estado | Comprobación mía |
|---|---|---|
| `db-reset` + `SELECT count(*) FILTER (ratings>0)` pegado | ✅ Real | Re-ejecutado: `6 \| 7 \| 6 \| 1200` y `12 \| 15 \| 198`, idénticos a lo pegado |
| `curl` de los 6 con salida real | ✅ Real | Re-ejecutados los 6 + los 2 bordes: **todos los ids y el `created_at` `2026-08-31T18:48:34.006Z` coinciden byte a byte con lo pegado en la US** |
| `just db-check` verde | ✅ Real | Reproducido 2 de 3 veces (ver WARNING 1) |
| `build-api` + `yarn test` 20/20 | ✅ Real | `tsc --noEmit` exit 0; jest 20/20 reproducido |
| Comparación antes/después de forma (CA-4) | ⚠️ No reproducible | La captura del ANTES vive en un scratchpad de otra sesión y el código del mock ya no está en el árbol. Validé el DESPUÉS contra `near-shop.json` (14 claves, orden) y contra las 20 claves canónicas de `products.service.spec.ts`; **no es el mismo diff** |
| Status de la US + fila del épico | ✅ Real | `5-…md` `Status: ✅ Implementada`; `README.md` fila US-5 añadida y "Orden sugerido" actualizado |

---

## Coherence (Design)

| Decisión | ¿Seguida? | Notas |
|---|---|---|
| A — ranking dentro del INSERT | ✅ Sí | `generate-seed.mjs`: `Map` poblado popular→best-selling, `num(r.X ?? p.X ?? 0)` en las tres columnas; `total_reviews` añadido a la lista de columnas |
| A — el seed solo toca `products` | ✅ Sí | Verificado por mí: filtrando las tuplas, el diff de `seed.sql` deja **6 líneas** no-tupla, todas del bloque `products` (comentario + lista de columnas). `settings`/`shops`/`categories`/`types` byte-idénticos |
| B — `orderBy` tipado con desempate `id asc` incorporado | ✅ Sí | `buildOrderBy()` devuelve `[{ratings:'desc'},{id:'asc'}]` / `[{soldQuantity:'desc'},{id:'asc'}]`; unión cerrada de 3 valores, sin string libre |
| C — `applyStorefrontDefaults` opt-out, default no se debilita | ✅ Sí | `input.applyStorefrontDefaults !== false`; probado por mutación (arriba) |
| D — haversine en JS, sin radio, guard en el repositorio | ✅ Sí | `R = 6371`, `findMany({where:{isActive:true}})` sin `include`, `_parseLocation` exige `typeof === 'number'` **y** `Number.isFinite`, guard de no-finito en la primera línea de `listShopsNear` |
| E — `toNearShopDto` propio de 14 claves | ✅ Sí | 14 claves en el orden exacto; `notifications: null` constante; `distance` number |
| F/G/H/H2/I/J — menores | ✅ Sí | `toProductDto` en los 4; `typeSlug` dentro del ranking; defaults 10/5; `shop_id` sigue muerto; `getNewShops` reutiliza `isActive`; `try` solo alrededor del repositorio, 503/500 |
| Diff forecast ~395-410 líneas | ⚠️ Desviado | Real 629. Declarado por el implementador (como 618) y aceptado como PR único |
| `docs/.../5-…md` listado como *Modify* | ⚠️ Impreciso | Es **nuevo** (untracked). Confirmado; irrelevante para el código, relevante si `sdd-archive` compara |

---

## Auditoría de honestidad de la evidencia de `apply-progress.md`

| Afirmación | Veredicto |
|---|---|
| "psql counts match design exactly (`6\|7\|6\|1200`, `12\|15\|198`)" | ✅ Cierta — reproducida |
| "`just db-check` green (57/57)" | ✅ Cierta — reproducida (con la flakiness de arranque en frío, WARNING 1) |
| "`yarn test` green (20/20, unrelated to the 6 migrated endpoints)" | ✅ Cierta, **y honesta al declarar que no cubre los 6** |
| "`just verify` green" | ✅ Cierta — reproducida |
| "key-set diff shows only the declared S-1 divergence" | ⚠️ No reproducible por mí (el ANTES no existe ya); consistente con lo que sí pude medir |
| "`git grep` on `apps/api/rest` clean (only a doc-comment)" | ✅ Cierta **tal como está escrita en apply-progress** — pero la tarea 5.5 dice `-- apps/api` y ahí NO está limpio (SUGGESTION 3) |
| "618 changed lines" | ⚠️ Desfasada: son **629**. El delta de 11 es coherente con las líneas que añadió la corrección del gatekeeper *después* de medir. No es inflado — es lo contrario, subestima |
| Tabla B-8 (`limit` 0/abc/-1/1e9) | ✅ **Cierta y reproducida**, ver abajo |
| Revisor: "haversine reimplementada, delta 0.000000 km" | ➖ No re-verificada (no repetí la contra-fórmula); las distancias sí son plausibles y el orden cambia con el origen |
| "el diff de `seed.sql` toca solo el bloque `products`" | ✅ Cierta — reproducida por mí |
| "El test contraste no podía fallar / la corrección discrimina" | ✅ Cierta — **probada por mutación**, no por lectura |

### B-8 verificado (los 4 bordes × los 4 endpoints migrados)

```text
popular-products?limit=0    -> 10 filas [4,1,3]..[9]         (mock: [])
best-selling?limit=0        -> 5 filas  [888,1,2]..[887]     (mock: [])
products-stock?limit=0      -> count=11 total=11 per_page="0"  last_page=null
draft-products?limit=0      -> count=1  total=1  per_page="0"  last_page=null

popular-products?limit=abc  -> 10 filas                      (mock: [])
best-selling?limit=abc      -> 5 filas                       (mock: [])
products-stock?limit=abc    -> count=11 per_page="abc" last_page=null
draft-products?limit=abc    -> count=1  per_page="abc" last_page=null

popular-products?limit=-1   -> 1 fila  [1259]                (mock: 9 filas)
best-selling?limit=-1       -> 1 fila  [464]
products-stock?limit=-1     -> count=1 total=11 per_page="-1" last_page=-11
draft-products?limit=-1     -> count=1 total=1  per_page="-1" last_page=-1

popular-products?limit=1e9  -> 1199 filas                    (mock: 10 filas)
best-selling?limit=1e9      -> 1199 filas                    (mock: 5 filas)
products-stock?limit=1e9    -> count=11 per_page="1e9" last_page=1
draft-products?limit=1e9    -> count=1  per_page="1e9" last_page=1
```

La tabla de `apply-progress.md` es **correcta**, y esta corrida la amplía a los 4
endpoints. Dos hallazgos que la tabla no recogía y que conviene declarar:

- `last_page` sale **`null`** (`Math.ceil(n/0) = Infinity` → `null` en JSON) con
  `?limit=0` y `?limit=abc`. El mock producía el mismo `null` (mismo `paginate`);
  lo que cambia es el `count` (11/1 ahora, 0 antes).
- `last_page: -11` con `?limit=-1`: consecuencia directa del `limit` sin clamp.

Ningún borde devuelve 5xx. Son rarezas de contrato, no caídas.

---

## Issues Found

### CRITICAL

1. **La Requirement "Errores de conexión a Postgres" de `derived-catalog-api` es
   un MUST sin test en el repositorio.** El arnés existe
   (`products.service.spec.ts` mockea `@safari/db` y prueba 503/500 para
   `getProducts`), pero los 6 métodos nuevos replican el `try/catch` a mano sin
   cobertura, y el escenario del Gherkin (`just db-down` → los 6 responden 503 y
   el proceso sigue vivo) **nunca se ejecutó**.

   Lo cerré parcialmente: escribí una **sonda efímera** con ese mismo arnés
   (mock de `listProducts`/`listShops`/`listShopsNear`, helpers de error reales),
   la corrí y la borré. El repo quedó limpio (`git status` sin cambios extra).

   ```text
   $ npx jest zz-us5-probe
   PASS src/zz-us5-probe.spec.ts (30.396 s)
     US-5 · MUST "Errores de conexión a Postgres" — los 6 endpoints
       √ popular-products: error de conexión → 503
       √ popular-products: cualquier otro error → 500
       √ best-selling-products: error de conexión → 503
       √ best-selling-products: cualquier otro error → 500
       √ products-stock: error de conexión → 503
       √ products-stock: cualquier otro error → 500
       √ draft-products: error de conexión → 503
       √ draft-products: cualquier otro error → 500
       √ new-shops: error de conexión → 503
       √ new-shops: cualquier otro error → 500
       √ near-by-shop: error de conexión → 503
       √ near-by-shop: cualquier otro error → 500

   Tests: 12 passed, 12 total
   ```

   **Conclusión honesta**: el mapeo 503/500 de los 6 endpoints **es correcto** —
   está probado en runtime, no supuesto. Lo que falta es (a) el **artefacto
   permanente** que impida la regresión, y (b) la mitad HTTP del escenario ("el
   proceso Nest MUST NOT crashear"), que sigue **sin ejecutar**. Por eso R-7
   queda ⚠️ PARTIAL y no ✅. Coste de cerrarlo del todo: ~110 líneas de spec
   (el archivo que borré) o ~30 si solo se cubren los 4 de products.

### WARNING

1. **`just db-check` es inestable en arranque en frío en esta máquina.** La
   primera corrida de la sesión falló con `Test timed out in 5000ms` en
   `listShops > lista las 12 tiendas` (el primer test que abre conexión). Las dos
   siguientes: verde en 6.02s y 5.09s. **No lo introdujo US-5** — el test que
   falla es de US-4a y el fallo es el `testTimeout` por defecto de vitest contra
   el arranque de Prisma/pg. Impacto: quien corra `db-check` como gate tras un
   rato de inactividad puede ver un rojo espurio. Fix natural (fuera de esta US):
   subir `testTimeout` en la config de vitest.

2. **B-8 no está en la spec, solo en `apply-progress.md`.** La sección
   "Divergencias declaradas" de `derived-catalog-api/spec.md` lista B-1..B-7 y
   S-1..S-4, pero **no B-8** (los bordes de `?limit=`), que se descubrió después
   del design. `apply-progress.md` **no se archiva como spec**: si `sdd-archive`
   promueve la spec tal cual, la divergencia se pierde y el siguiente lector verá
   un contrato que dice menos de lo que el código hace. **Acción antes de
   archivar**: añadir B-8 a la tabla de la spec (4 filas + la nota de
   `last_page: null` / `last_page: -11`).

3. **`limit` sin clamp en el repositorio** (`products.repository.ts`): `page`
   tiene `Math.max(1, …)` y `limit` no. Confirmo lo declarado por el revisor:
   **no lo introdujo US-5** — `/api/products?limit=-1` (US-2, ya embarcado) hace
   lo mismo. Es la causa raíz de dos de las cuatro filas de B-8. Declarado y no
   accionado, correctamente: el fix toca `product-listing-api` y cabe en su
   propio cambio.

4. **Sin cobertura automatizada para R-3, R-5 y el key-set de `toNearShopDto`.**
   Las tres se comportan bien hoy (probado por `curl`), pero nada impide una
   regresión silenciosa: no hay `shops.service.spec.ts`, y el orden de las 14
   claves —que la spec declara contrato explícito— solo lo protege un `curl`
   manual. El design ya lo excluyó ("Unit: ninguno nuevo"); lo dejo declarado
   como deuda, no como fallo de la entrega.

### SUGGESTION

1. La captura del **ANTES** (tareas 1.2/1.3) vivía en un scratchpad de sesión y
   ya no existe. La comparación mock↔pg de la DoD **no es re-verificable**. Para
   futuras US de migración: guardar los `*.mock.json` dentro de la carpeta del
   change (o comprimidos junto al reporte) en vez de en `/tmp`.

2. `apply-progress.md` declara **618 líneas**; hoy son **629**. El desfase es
   inocuo (la corrección del gatekeeper añadió líneas después de medir), pero el
   número que verá el reviewer debería actualizarse.

3. La tarea **5.5** dice que `git grep … -- apps/api` queda **vacío**. No lo está:
   ```text
   apps/api/graphql/src/shops/shops.service.ts:8:import nearShopsJson from './near-shop.json';
   apps/api/rest/src/shops/shops.service.ts:65: * `near-shop.json` (US-5 Decision E) — NO reutiliza …
   ```
   El primer hit es la variante **GraphQL** (fuera de scope, no usada por el
   stack REST) y el segundo es prosa de un JSDoc. `apply-graph` ya lo reformuló
   correctamente como `apps/api/rest`. Solo el enunciado de la tarea es impreciso.

4. El Gherkin **CA-1** de la US ("todas las filas comparten el mismo `created_at`
   … ninguna trae la fecha de 2021") **no es literalmente comprobable**:
   `toProductDto` no emite `created_at` (divergencia S-1, 46→20 claves). Se
   cumple *a fortiori*, y la DoD es honesta (solo pega `created_at` para
   `near-by-shop`, donde sí existe), pero la redacción del bullet de la DoD
   ("mostrando el `created_at` uniforme de la base") promete más de lo que la
   evidencia enseña para los 4 endpoints de products. Ajustar la redacción, no
   el código.

5. `db-test` / `db-count` del scraper siguen rojos (US-8): confirmado como
   **esperado**, no regresión de esta US. `services/scraper-worker/` no aparece
   en el diff.

---

## Verdict

**PASS WITH WARNINGS**

Los 6 endpoints salen realmente de Postgres, con los ids, claves, orden y
envoltorios que la spec y el design predijeron —verificado con `curl` real, no
con lectura de código—, sin tocar nada fuera de scope y sin regresión
(`db-check` 57/57, jest 20/20, `just verify` verde, `/api/settings` en 5503 B).
El bloqueante que corrigió el gatekeeper resiste una prueba de mutación: el test
"contraste" mata al mutante. No es `PASS` limpio porque un **MUST de la spec
(errores de conexión) no tiene ningún test en el repositorio** —su
comportamiento sí quedó probado en runtime durante esta verificación, con una
sonda que después borré— y porque **B-8 vive solo en `apply-progress.md`**, que
no se archiva: hay que subirla a la spec antes de `sdd-archive` o el contrato
archivado dirá menos de lo que el código hace.

---

## Notas de entorno (para el orquestador)

- **`just api-dev` NO estaba corriendo** al empezar esta fase (el 9001 no
  escuchaba; 3002 y 3003 sí). La levanté yo para poder ejecutar la evidencia
  HTTP y **la dejé corriendo** en el 9001 (PID escuchando confirmado,
  `/api/settings` → 200). Nunca se usó el 9000.
- La base quedó **intacta**: `1200 products / 0 scraped / 12 shops / 198
  categories / 14 manufacturers`, confirmado con `SELECT` al cerrar.
- El árbol de trabajo quedó **idéntico** al que recibí: la sonda de jest se
  borró y el fichero mutado se restauró desde copia (`git diff --numstat` de
  `products.repository.ts` sigue en `60 7`).
