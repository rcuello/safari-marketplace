# Verification Report — Escrituras de productos con categorías y tags (US-29)

**Change**: `escrituras-productos-postgres`
**Rama**: `us-29-escrituras-productos-postgres` (7 commits sobre `main`, nada pusheado, árbol limpio)
**Modo**: Standard (`strict_tdd: false`)
**Store**: openspec-only (Engram NO conectado; ninguna herramienta de Engram invocada)
**Fecha**: 2026-09-11
**Auditor**: `sdd-verify` (ejecutor). No se modificó código, specs ni tasks; no se hizo commit.

> **Método.** Toda la evidencia de este reporte se **re-produjo de cero** en esta
> sesión: los tres gates se re-ejecutaron y su salida real está pegada abajo, y la
> batería HTTP se re-condujo contra la API viva (puerto 9001) con tokens reales,
> sin reutilizar ninguna salida de `apply-progress.md`. Cuando una afirmación
> descansa exclusivamente en la evidencia del batch de `sdd-apply` (y no pude
> reproducirla), se declara explícitamente.

---

## 1. Completeness

| Métrica | Valor |
|---|---|
| Tareas totales (`tasks.md`) | 39 |
| Tareas completas | 38 |
| Tareas incompletas | 1 — **5.9** (smoke visual del admin en navegador) |
| Tareas de implementación incompletas | **0** |
| Escenarios de spec totales (4 deltas) | 20 |
| Escenarios COMPLIANT | **20 / 20** |
| Escenarios FAILING / UNTESTED | 0 / 0 |

La única tarea abierta (5.9) es una verificación manual de UI, no una tarea de
implementación. Ningún archivo de `apps/admin` cambió en esta US (diff vacío).

---

## 2. Gates re-ejecutados por el auditor (salida real)

### 2.1 `just db-build` (bloqueante, `dist/` gitignored)

```text
EXIT db-build=0
CLI Using tsconfig: tsconfig.json
CLI tsup v8.5.1
CLI Target: node18
CLI Cleaning output folder
CJS Build start
CJS dist\index.js     162.95 KB
CJS dist\index.js.map 391.24 KB
CJS ⚡️ Build success in 61ms
DTS Build start
DTS ⚡️ Build success in 14186ms
DTS dist\index.d.ts 1.39 MB
```

### 2.2 `just db-check` (`rules.verify.test_command`) — ✅ PASADO

```text
> @safari/db@0.1.0 typecheck
> tsc --noEmit

> @safari/db@0.1.0 test
> vitest run

 RUN  v4.1.11 C:/DevOps/MyGitHub/safari-marketplace/packages/db

 Test Files  10 passed (10)
      Tests  186 passed (186)
   Start at  16:34:44
   Duration  24.93s (transform 873ms, setup 0ms, import 4.71s, tests 10.37s, environment 1ms)

EXIT=0
```

186/186 verde, reproducido de forma independiente. Coincide con el conteo
declarado en `apply-progress.md` (186 = 164 baseline + 7 de PR#1 + 15 de PR#2).

### 2.3 `cd apps/api/rest && npx jest` — ✅ PASADO

```text
PASS src/tags/tags.service.spec.ts (30.745 s)
PASS src/manufacturers/manufacturers.service.spec.ts (39.445 s)
PASS src/users/user-dto.mapper.spec.ts (39.527 s)
PASS src/categories/categories.service.spec.ts (40.075 s)
PASS src/types/types.service.spec.ts (40.36 s)
PASS src/common/errors/domain-error.mapper.spec.ts (40.792 s)
PASS src/shops/shops.service.spec.ts (41.109 s)
PASS src/products/products.service.spec.ts (42.67 s)
PASS src/users/users.service.spec.ts (44.45 s)

Test Suites: 9 passed, 9 total
Tests:       204 passed, 204 total
Snapshots:   0 total
Time:        53.575 s
EXIT=0
```

204/204 verde, reproducido. Confirma que el fix del defecto de
`manufacturer_id: null` (commit `20dddfb`) dejó la suite genuinamente en verde,
no solo reportada como tal.

### 2.4 `just build-api` — ✅ PASADO

```text
yarn build
$ rimraf dist
$ nest build
Done in 40.43s.
EXIT=0
```

Tras el build, se reverificó que los servicios que dejó arriba el orquestador
siguen respondiendo: `API settings: 200`, `Admin 3002: 200`.

### 2.5 Nota sobre `rules.verify.build_command: just build`

`openspec/config.yaml` declara `build_command: just build` (shop + admin). **No
se ejecutó**, por dos razones que constan en el propio repo y en el alcance de
esta US: (a) `just build` exige detener los `dev` (comparten `.next`) y el
orquestador dejó el admin corriendo en 3002 con instrucción explícita de no
matarlo; (b) esta US **no toca una sola línea de `apps/shop` ni de
`apps/admin`** (`git diff --stat main...HEAD -- apps/admin apps/shop` → vacío),
así que el build de frontends no puede regresar por este cambio. El gate
sustantivo del área tocada es `just build-api`, ejecutado y limpio. `just
verify` (los 3 servicios con contenido real) consta en la evidencia de PR#3 con
salida real y exit code 0; no se re-corrió por la misma razón de no perturbar
los procesos del orquestador.

---

## 3. Evidencia HTTP independiente producida por el auditor

Todo lo de esta sección se ejecutó **en esta sesión**, contra la API viva, con
tokens minteados por `POST /api/token`. Baseline de la base verificado **antes**
y **después**: `products 1200 · category_product 0 · product_tag 0 ·
categories 198 · tags 10 · shops 12 · users 3 · filas `zz-%` 0`.

### 3.1 CA-4 — 21 casos hostiles, **ninguno 500**

```text
1) sale_price >= price
{"statusCode":400,"message":"El precio rebajado (100) debe ser menor que el de lista (100) — CHECK products_rebaja_valida.","error":"Bad Request"} | STATUS:400
2) simple sin price
{"statusCode":400,"message":"Un producto 'simple' necesita precio — CHECK products_simple_con_precio.","error":"Bad Request"} | STATUS:400
3) product_type furniture
{"statusCode":400,"message":"`products.product_type (fuera de IN ('simple','variable'))` referencia un registro inexistente (`furniture`).","error":"Bad Request"} | STATUS:400
4) status archived
{"statusCode":400,"message":"`products.status (fuera de IN ('publish','draft'))` referencia un registro inexistente (`archived`).","error":"Bad Request"} | STATUS:400
5) type_id 999999          → 400  `products.desconocida` referencia un registro inexistente.
6) shop_id 999999          → 400  `products.desconocida` referencia un registro inexistente.
7) manufacturer_id 999999  → 400  `products.desconocida` referencia un registro inexistente.
8) categories [999999]     → 400  `products.categories[]` referencia un registro inexistente.
9) tags [999999]           → 400  `products.tags[]` referencia un registro inexistente.
10) type_id "abc"          → 400  `products.type_id` referencia un registro inexistente (`NaN`).
11) shop_id "abc"          → 400  `products.shop_id` referencia un registro inexistente (`NaN`).
12) manufacturer_id "abc"  → 400  `products.manufacturer_id` referencia un registro inexistente (`NaN`).
13) categories ["abc"]     → 400  `products.categories[]` referencia un registro inexistente (`abc`).
14) tags ["abc"]           → 400  `products.tags[]` referencia un registro inexistente (`abc`).
15) price "abc"            → 400  `products.price (no es un número finito)` … (`abc`).
16) price 1e300            → 400  `products.price (no es un número finito)` … (`1e+300`).
17) PUT /products/999999999    → 404  No existe un producto con id 999999999.
18) DELETE /products/999999999 → 404  No existe un producto con id 999999999.
19) PUT sin token     → 401  Token de autenticación ausente o inválido.
20) DELETE sin token  → 401  Token de autenticación ausente o inválido.
21) POST sin token    → 401  Token de autenticación ausente o inválido.
```

16× **400**, 2× **404**, 3× **401**. **Cero 500.** Esta batería extiende la de
`apply-progress.md` § 5.2 (14 casos) con 7 casos adicionales que allí no
estaban: ids de pivote no enteros (13, 14), `price` no finito y fuera del rango
`numeric(12,2)` (15, 16) y el 401 sobre `POST` (21). Ninguno degradó.

### 3.2 Campos fuera de alcance — aceptados, descartados, **no persistidos**

`POST` con `height`/`length`/`width`, `digital_file`, `author_id`,
`in_flash_sale: 1`, `variations`, `variation_options`, y además
`source_store`/`source_product_id`/`source_url`:

```text
STATUS:201
keys: 20
["id","name","slug","type","language","translated_languages","product_type","shop",
 "sale_price","max_price","min_price","image","status","price","quantity","unit",
 "sku","sold_quantity","in_flash_sale","visibility"]
in_flash_sale = 0 | id = 1478 | has related_products: false
```

```text
  id  |         slug         | source_store | source_product_id | source_url | scraped_at | price | min_price | max_price | in_stock | quantity | product_type | status
 1478 | zz-verify-oos-campos |              |                   |            |            | 33.50 |     33.50 |     33.50 | t        |        4 | simple       | publish
 category_product WHERE product_id=1478 → 1
 product_tag      WHERE product_id=1478 → 1
```

Los tres `source_*` quedan `NULL` aunque el cliente los envíe (la quinta regla,
`products_procedencia_completa`, se cumple **por construcción**: el tipo de
entrada no los declara). `min/max` derivados = `price` para `simple`;
`in_stock` derivado de `quantity > 0`. **Este escenario era el más delgado en
`apply-progress.md`** (§ 5.4 solo mostraba `variations`/`variation_options`);
queda cerrado aquí con evidencia directa.

### 3.3 Proyección de 20 claves contra el seed (`node -e`, sin `.sort()`)

```text
seed keys (apples, sin related_products): 20
write keys: 20
mismo array y mismo orden (sin sort): true
seed tiene related_products: true   ← la lectura de detalle sí lo trae
write has related_products: false   ← la escritura no
```

### 3.4 CA-1 / CA-2 / CA-3 sobre la fila 1478

```text
updated_at antes del PUT : 2026-09-11 21:30:26.518+00
PUT {"name":"… EDITADO","categories":[],"price":249.5} → 200
  keys: 20 | name: "… EDITADO" | slug: zz-verify-oos-campos  ← INVARIANTE
           | price: 249.5 | min: 249.5 | max: 249.5
pivotes tras el PUT: category_product 0  (vaciado: se envió [])
                     product_tag      1  (intacto: `tags` omitido)
updated_at después del PUT: 2026-09-11 21:31:36.927796+00   ← avanzó

PUT {"categories":[35]} → 200   (re-enlaza la categoría "cereal")
GET /api/products?search=categories.slug:cereal → 200  total:1  ids:1478
GET /api/products?search=name:zz-verify-oos     → 200  total:1  contiene 1478

DELETE /api/products/1478 → 200   snapshot con 20 claves, sin related_products
GET /api/products/zz-verify-oos-campos → 404
pivotes tras el DELETE: category_product 0 · product_tag 0
```

Los tres estados del pivote quedan probados sobre HTTP: **ausente** (tags
conserva su fila), **vacío** (categories cae a 0) y **con ids** (re-enlace y
filtro por categoría). El delta de `updated_at` (~70 s) supera por dos órdenes
de magnitud el desfase de reloj Node↔Postgres medido en el diagnóstico del
GATE de PR#1 (150-450 ms), así que la observación es válida pese a cruzar
relojes.

### 3.5 CA-6 — producto `variable` + `manufacturer_id: null` explícito

```text
POST {"product_type":"variable","min_price":15,"max_price":45,(sin price),
      "manufacturer_id":null,"quantity":0,"variations":[…],"variation_options":{…}}
→ 201  id:1482 | keys:20 | product_type: variable | price: null | min:15 | max:45

  id  | product_type | price | min_price | max_price | manufacturer_id | in_stock | quantity
 1482 | variable     |       |     15.00 |     45.00 |                 | f        |        0

comparación con 3 `variable` del seed:
 invictus                                           | variable |  | 70.00 | 80.00
 magnetic-designs-women-printed-fit-and-flare-dress | variable |  | 35.00 | 35.00
 mango-self-striped-a-line-dress                    | variable |  | 70.00 | 81.00
```

Indistinguible del patrón del seed. Y — punto clave para el ítem abierto #2 —
`manufacturer_id: null` explícito llega a la fila como **NULL**, no como `0` ni
como un 400: el fix de `20dddfb` está confirmado **end-to-end sobre HTTP**, no
solo por el unit test que lo descubrió.

### 3.6 CA-5 — lo que pude y lo que no pude reproducir

```text
super_admin (sub=3) edita un producto de la tienda 1 (owner_id=1, NO suya) → 200
customer (sin permiso de escritura) PUT                                    → 403 (guard)
sin token, POST/PUT/DELETE                                                 → 401 ×3
store_owner dueño, POST/PUT/DELETE sobre su propia tienda                  → 201/200/200
```

**No reproducible en esta sesión sin mutar la base**: el 403 de *dueño ajeno* y
el 403 de *staff*. Las 12 tiendas del seed comparten `owner_id = 1` y no existe
ningún usuario con permiso `staff`, así que no hay forma de ejercitar esas dos
ramas por HTTP sin insertar filas centinela. Mantuve la base intacta y las doy
por cubiertas por (a) la evidencia de `apply-progress.md` § 5.3 y (b) los unit
tests que re-corrí. Ver § 6 para el juicio sobre la fuerza de esa evidencia.

### 3.7 Herencia 1 — reproducida de forma independiente

```text
POST /api/categories {"name":"zz-verify-herencia1","type_id":1} (super_admin) → 201  id=889
POST /api/products   {"categories":[889], …}            (store_owner)         → 201  id=1483
psql: category_product WHERE category_id=889 → 1
DELETE /api/categories/889 (super_admin)                                      → 200
psql: category_product WHERE category_id=889 → 0     ← el escenario que cierra
psql: products WHERE id=1483                 → 1     ← el producto sobrevive
```

Categoría **centinela** creada por `POST /categories` (id 889), nunca una del
seed. Es la reproducción exacta de la evidencia de § 5.5 de `apply-progress.md`
(que usó la id 888), obtenida por un auditor distinto. Ambas filas centinela
fueron borradas.

### 3.8 Cierre de conteos tras la auditoría

```text
products 1200 · category_product 0 · product_tag 0 · categories 198
tags 10 · shops 12 · users 3 · products zz-% 0 · categories zz-% 0
```

Idénticos al baseline. Ninguna fila centinela de esta auditoría sobrevive.
(Los ids saltaron 1478 → 1482 → 1483 porque los `POST` rechazados consumen
`nextval` de la secuencia; es el comportamiento normal de Postgres y no deja
filas.)

---

## 4. Matriz de conformidad por escenario

### 4.1 `specs/product-write-api/spec.md` (14 escenarios)

| # | Requirement | Escenario | Evidencia verificada | Resultado |
|---|---|---|---|---|
| 1 | Creación con pivotes y visibilidad (CA-1) | el producto creado aparece filtrado por categoría | `products.integration.test.ts > createProduct — CA-1` (×2) · HTTP § 3.4 (filtro `categories.slug:cereal` y `name:` devuelven el centinela) · reinicio real de la API en `apply` § 5.1 y § 3.7 de PR#3 | ✅ COMPLIANT |
| 2 | Edición reemplaza pivotes / slug invariante (CA-2) | escalares cambian, slug invariante, pivotes según venga | `updateProduct — CA-2` (4 `it`: pivote ausente / vacío / con ids / slug invariante + `updatedAt` monótono) · HTTP § 3.4 | ✅ COMPLIANT |
| 3 | Edición — mover `shop_id` (CA-5) | exige propiedad de ambas tiendas | `products.service.spec.ts > CA-5 — PUT que mueve shop_id` (2 `it`: 403 sondeando ambos lados; 200 si ambos son del mismo dueño) · `apply` § 5.3 (403 + `psql`: el `shop_id` de la fila no cambió) | ✅ COMPLIANT |
| 4 | Borrado elimina fila y ambos pivotes (CA-3) | 20 claves, `GET` 404, pivotes en 0 | `deleteProduct — CA-3, snapshot pre-borrado` · HTTP § 3.4 | ✅ COMPLIANT |
| 5 | Las 5 reglas CHECK/`IN` (CA-4) | rebaja inválida y `simple` sin precio | `Las cinco guardas… > regla 1` y `regla 2` · HTTP § 3.1 casos 1-2 | ✅ COMPLIANT |
| 6 | Las 5 reglas CHECK/`IN` (CA-4) | `product_type`/`status` fuera de su `IN` | `regla 3`, `regla 4` · HTTP § 3.1 casos 3-4 | ✅ COMPLIANT |
| 7 | Frontera numérica y FK/pivotes (CA-4) | FK o pivote inexistente, o sin forma entera | `Las tres FK salientes…` (5 `it`) + `Frontera numérica…` (3 `it`) · HTTP § 3.1 casos 5-16 | ✅ COMPLIANT |
| 8 | Id inexistente en `PUT`/`DELETE` (CA-4) | ambas 404 | `404 en updateProduct/deleteProduct…` (2 `it`) · `products.service.spec.ts > guard de id, nivel A` (`it.each` `NaN`/`1.5`/`0`/`-1` ×2 rutas, con `not.toHaveBeenCalled()`) · HTTP § 3.1 casos 17-18 | ✅ COMPLIANT |
| 9 | Propiedad por tienda (CA-5) | dueño propio, dueño ajeno, `super_admin` | `CA-5 — matriz de roles` (`it.each` ×3 rutas ×4 roles; `super_admin` con aserción explícita de short-circuit) · `apply` § 5.3 · HTTP § 3.6 (200 propio, 200 `super_admin` sobre tienda ajena) | ✅ COMPLIANT |
| 10 | Propiedad por tienda (CA-5) | `staff` y sin token | `it.each(routes)` `staff … → 403` ×3 · `apply` § 5.3 (403 ×3 con usuario `staff` aislado) · HTTP § 3.6 (401 ×3 reproducido por mí) | ✅ COMPLIANT — ver WARNING-1 |
| 11 | Productos `variable` (CA-6) | creado y leído como el seed | `createProduct … crea un 'variable'` · HTTP + `psql` § 3.5 | ✅ COMPLIANT |
| 12 | Proyección de escritura (D29-7) | 20 claves, mismo orden, sin `related_products` | `products.service.spec.ts` (`EXPECTED_KEYS` en `create`/`update`/`remove`) · diff `node -e` sin `.sort()` § 3.3 | ✅ COMPLIANT |
| 13 | Campos fuera de alcance (D-2, R29-6) | se aceptan y se descartan | **HTTP + `psql` § 3.2** (reproducido por el auditor; en `apply` la cobertura era parcial) · lectura del código: input campo a campo, nunca `...body` | ✅ COMPLIANT |
| 14 | Sin mock huérfano ni regresión (CA-7) | 0 imports huérfanos, conteos intactos | `grep -n "@db/\|plainToClass" products.service.ts` → 0 líneas (exit 1) · `just db-check` 186/186 · conteos § 3.8 | ✅ COMPLIANT |

### 4.2 `specs/catalog-write-foundations/spec.md` (4 escenarios)

| # | Escenario | Evidencia verificada | Resultado |
|---|---|---|---|
| 15 | Cada uno de los 5 códigos mapea a su status | `domain-error.mapper.spec.ts` (PASS en mi corrida) — heredado de US-28, sin cambios | ✅ COMPLIANT |
| 16 | `types` solo ejercita tres códigos, pero los cinco están probados | ídem | ✅ COMPLIANT |
| 17 | Una violación de CHECK no pertenece al conjunto cerrado — lección para `products` | ídem + § 4.3 de este reporte | ✅ COMPLIANT |
| 18 | Las 5 expresiones CHECK/`IN` de `products` quedan pre-validadas (nuevo, US-29) | tabla § 5 + `products.service.spec.ts > mapeo de errores de dominio` (`it.each` 5 clases → 400/400/400/404/409) + HTTP § 3.1 | ✅ COMPLIANT |

### 4.3 `specs/category-tree-api/spec.md` (2 escenarios)

| # | Escenario | Evidencia verificada | Resultado |
|---|---|---|---|
| 19 | CA-3 — borrar una madre re-enraíza a sus hijas | heredado de US-28, sin cambios; `categories.integration.test.ts` PASS en `db-check` | ✅ COMPLIANT |
| 20 | CA-3 — los enlaces de producto desaparecen (cerrado por US-29) | `apply` § 5.5 **y reproducción independiente del auditor** § 3.7: 1 → 0 sobre categoría centinela, el producto sobrevive | ✅ COMPLIANT — **listo para que `sdd-archive` cambie `UNTESTED` → `COMPLIANT`** |

### 4.4 `specs/product-listing-api/spec.md`

Delta **sin requirements**: solo reemplaza la prosa de `## Out of Scope` para
declarar que `category_product` deja de estar vacía. La afirmación se verificó
observacionalmente: `GET /api/products?search=categories.slug:cereal` devolvió
el producto centinela recién enlazado, **sin ningún cambio de código en
`listProducts`** (`git diff` del repositorio no toca esa función). No hay
escenario que puntuar.

**Resumen de conformidad: 20/20 escenarios COMPLIANT. 0 FAILING, 0 UNTESTED.**

---

## 5. Herencia 2 — tabla de cobertura de las 5 guardas (verificada)

| # | Regla | DDL | Origen | Error de dominio | Verificación del auditor |
|---|---|---|---|---|---|
| 1 | `products_rebaja_valida` (`sale_price < price`) | `schema.sql:393-394` | **Heredada y adaptada** de `upsertScrapedProduct` (DD29-9 añade el disyunto `price != null`) | `InvalidSalePriceError` | `_assertPriceRules` leída: `salePrice != null && price != null && salePrice >= price` ✓ · integración ✓ · HTTP 400 ✓ |
| 2 | `products_simple_con_precio` | `:398-399` | **Nueva** | `MissingPriceError` | código ✓ · integración ✓ · HTTP 400 ✓ |
| 3 | `product_type IN ('simple','variable')` | `:335-336` | **Nueva** | `InvalidReferenceError` (DD29-2) | `_assertProductType` ✓ · integración ✓ · HTTP 400 ✓ |
| 4 | `status IN ('publish','draft')` | `:359-360` | **Nueva** | `InvalidReferenceError` (DD29-2) | `_assertStatus` ✓ · integración ✓ · HTTP 400 ✓ |
| 5 | `products_procedencia_completa` | `:403-404` | **Por construcción** | — (sin guarda de runtime) | `CreateProductInput`/`UpdateProductInput` no declaran `source_*` ✓ · **además, HTTP § 3.2**: enviándolos en el body la fila queda con los tres `NULL` ✓ |

**Cuenta exigida por la task 5.6: 1 heredada-adaptada / 3 nuevas / 1 por
construcción. Verificada exacta.** La regla 5 es la única sin test de runtime,
y el spec lo declara así de antemano — no es una laguna, es la consecuencia del
tipo de entrada. Las reglas 1 y 2 solo llegan a 400 gracias a DD29-1 (las tres
clases de error extienden `CatalogWriteError` con `code =
CATALOG_ERROR_CODES.InvalidReference`); verificado en el código y por el
`it.each` de mapeo de errores de dominio.

---

## 6. Ítems abiertos conocidos — juicio del auditor

### Ítem 1 — Task 5.9 (smoke del admin en navegador) sigue **PENDIENTE**

**Confirmado honesto, no fabricado.** `apply-progress.md` § 5.9 declara
explícitamente la ausencia de herramienta de navegador y no inventa evidencia.
La tarea está `[ ]` en `tasks.md` y `[ ]` en la DoD de la US.

**Riesgo residual: BAJO. NO bloquea la US.** Razones, verificadas en código:

1. `apps/admin` y `apps/shop` tienen **0 líneas cambiadas** en esta rama.
2. El redirect del admin es
   `` `${generateRedirectUrl}/${data?.slug}/edit` `` (`apps/admin/rest/src/data/product.ts:47-64`),
   es decir depende de una sola cosa del contrato: que la respuesta del `PUT`
   traiga `slug`.
3. Esa condición **está probada**: en § 3.4 el `PUT` devolvió las 20 claves con
   `slug: "zz-verify-oos-campos"` invariante pese a cambiar `name`, y el `GET`
   posterior reflejó los valores editados.

Lo único no verificado es el render del formulario tras el redirect, que es
puramente de UI y que esta US no pudo romper. Recomendación: que el
orquestador ejecute el smoke o **acepte formalmente el riesgo** dejando 5.9
registrada como deuda de verificación en el archivo; en ninguno de los dos
casos debería detener el archivado.

### Ítem 2 — El defecto de `manufacturer_id: null` (fix `20dddfb`)

**Confirmado correcto y cubierto.** Leí el código en `create()` y `update()`:
la distinción de tres vías (`undefined` → clave omitida · `null` → `null` ·
resto → `Number(...)`) está aplicada en **ambos** sitios. La capa de datos ya
aceptaba `null` (`manufacturerId?: number | null`,
`input.manufacturerId ?? null`), así que el fix es correctamente de una sola
capa: `packages/db` no cambió por él.

Cobertura: `products.service.spec.ts > manufacturer_id: null explícito llega
como null al repositorio, nunca Number(null)===0 (R29-7)` — pasa en mi corrida.
Y lo verifiqué **end-to-end**: § 3.5, la fila 1482 quedó con `manufacturer_id`
`NULL`. La rama de `update()` no tiene `it` propio (se documenta en
`apply-progress.md`); ver SUGGESTION-1.

**Valoración del proceso**: el hallazgo es un punto a favor del ciclo. El test
no se debilitó ni se borró, se paró el batch, se pidió autorización, el
coordinador re-derivó el hallazgo y lo autorizó, y la evidencia roja original
se conservó junto a la verde. El audit trail quedó completo.

### Ítem 3 — El falso verde de PR#1 y su corrección (`ea73914`)

**Confirmado honesto, y el test corregido es más estricto, no más laxo.** Leí
el test: `products.integration.test.ts:517-569` ahora hace
`create → PUT₁ → PUT₂` y compara `secondUpdate.updatedAt > firstUpdate.updatedAt`
con `toBeGreaterThan` **estricto** (antes era `toBeGreaterThanOrEqual` sobre
`create` vs `PUT`). El rationale (`createProduct` liga `created_at`/`updated_at`
client-side con el reloj de Node; `updateProduct` delega en el trigger
`products_updated_at` con el reloj de Postgres) es verificable en el código:
`updateProduct` no fija `updatedAt` en ningún punto de su `data`.

**Sigue probando CA-2**: CA-2 pide que «`updated_at` avanza (trigger del DDL)».
Comparar dos escrituras del trigger prueba exactamente eso y elimina la ventana
de reloj cruzado. Además lo corroboré por fuera del test, sobre HTTP (§ 3.4):
`updated_at` pasó de `21:30:26.518+00` a `21:31:36.927796+00` en un `PUT` real
— nótense los 3 decimales del valor escrito por Node en el `INSERT` frente a
los 6 del escrito por el trigger, que confirma independientemente el
diagnóstico de los dos relojes.

### Ítem 4 — Filas centinela creadas por `psql` para CA-5

**Conteos limpios: confirmado.** Verifiqué `shops = 12` y `users = 3` al inicio
y al final de mi propia sesión; la tienda centinela (`id 16`) y el usuario
`staff` (`id 354`) no existen.

**¿Debilita la evidencia de CA-5? No materialmente, con un matiz.** El código
de propiedad (`findShopOwnerById` → `shops.owner_id`) no sabe ni puede saber
cómo se creó la fila: un `owner_id = 2` insertado por `psql` ejercita
exactamente la misma rama que uno creado por `POST /shops` (endpoint que ni
siquiera existe todavía — es US-30). La alternativa era no probar CA-5 en
absoluto sobre HTTP, que habría sido peor. El matiz es que la evidencia de
*dueño ajeno* y *staff* es **irrepetible sobre los datos del seed**: yo no pude
reproducirla sin mutar la base, y quien audite esto en el futuro tampoco podrá.
Queda mitigado porque esas dos ramas sí están cubiertas por unit tests
deterministas (`it.each(routes)` ×3 rutas) que re-corrí en verde.

Mención aparte al mérito de la nota de proceso de `apply-progress.md`: el
primer intento asignó `staff` a `customer@demo.com` (sub=2), que era a la vez
el `owner_id` de la tienda centinela, y devolvió 200 en vez de 403. En lugar de
ocultarlo, se documentó, se aisló la identidad y se re-corrió. Ese 200 no era un
agujero de seguridad — pero sí revela algo real, ver WARNING-1.

---

## 7. Cumplimiento de alcance

`git diff --stat main...HEAD` — **20 archivos, 6 de código + 1 nuevo de
configuración de test**; el resto son artefactos de `openspec/` y `docs/product/`:

```text
 apps/api/rest/src/products/dto/create-product.dto.ts    |   17 +
 apps/api/rest/src/products/products.controller.ts       |   23 +-
 apps/api/rest/src/products/products.service.spec.ts     |  387 +++++
 apps/api/rest/src/products/products.service.ts          |  271 +++-
 packages/db/index.ts                                    |    7 +
 packages/db/src/repositories/products.integration.test.ts | 565 ++++++-
 packages/db/src/repositories/products.repository.ts     |  506 +++++-
 packages/db/src/repositories/shops.repository.ts        |   16 +-
 packages/db/vitest.config.ts                            |   16 +   ← NUEVO
```

| Comprobación exigida | Resultado |
|---|---|
| `slug.ts` (API y `packages/db`) sin cambios | ✅ no aparece en el diff |
| `domain-errors.ts` (API y `packages/db`) sin cambios | ✅ no aparece en el diff |
| `common/errors/` sin cambios | ✅ no aparece en el diff |
| `db/schema.sql` sin cambios | ✅ no aparece en el diff |
| `apps/shop` sin cambios | ✅ `git diff --stat main...HEAD -- apps/shop` vacío |
| `apps/admin` sin cambios | ✅ `git diff --stat main...HEAD -- apps/admin` vacío |
| Cuerpo de `upsertScrapedProduct` intacto | ✅ ver abajo |
| Sin DDL ni migración nueva | ✅ `git diff --name-status` no lista `schema.sql`, `*.prisma` ni ninguna `migration` |
| Archivos **nuevos** de código | ✅ exactamente uno: `packages/db/vitest.config.ts` |
| Campos fuera de alcance descartados y no persistidos | ✅ verificado por HTTP + `psql` (§ 3.2) |

**`upsertScrapedProduct` — verificación aritmética, no de confianza.** En `main`
la función ocupa las líneas **337-424** de `products.repository.ts`
(`deleteScrapedProduct` empieza en 425). Los hunks reales del diff son:

```text
@@ -22     +22,7   @@   (imports)
@@ -36,0   +43     @@   (imports)
@@ -441,0  +449,468 @@  (código nuevo: las 3 escrituras + guardas)
@@ -446,2  +921,10  @@  (clase InvalidSalePriceError)
@@ -450    +933,2   @@  · @@ -456,2 +940,2 @@  · @@ -460 +944,2 @@
@@ -466,2  +951,2   @@  · @@ -470 +955,2 @@   (clases de error, DD29-1)
```

Ningún hunk cae en el rango 337-424. **El cuerpo de `upsertScrapedProduct` no
tiene una sola línea tocada.** Lo mismo vale para `listProducts` (251-286),
`findProductBySlug` (287-336), `_translateCheckViolation` y `_toProductRecord`.

**Desviación de superficie — `packages/db/vitest.config.ts`.** Es superficie
nueva **no** listada en la tabla «Archivos a crear/modificar» de US-29.
Verifiqué que está **declarada como desviación en tres sitios independientes**
del registro: `design.md` (DD29-10 y la tabla de File Changes, «Superficie
nueva declarada»), `tasks.md` (task 1.10 y la decisión del usuario nº 3,
«ratificada explícitamente… declararla igualmente como desviación en el reporte
final») y `apply-progress.md` (§ Decisions Encountered / Deviations from
Design). La ratificación del usuario del 2026-09-11 consta. Su contenido (16
líneas, `fileParallelism: false`) es proporcionado al problema que resuelve
(conteos absolutos pinneados en `categories`/`shops` expuestos a filas
centinela de otro worker). **Desviación correctamente gobernada.**

---

## 8. Coherencia con el diseño

| Decisión | ¿Seguida? | Verificación |
|---|---|---|
| DD29-1 — las 3 clases de error con `code` del conjunto cerrado | ✅ | `InvalidSalePriceError`/`MissingPriceError`/`IncompleteProvenanceError` extienden `CatalogWriteError` con `CATALOG_ERROR_CODES.InvalidReference`; HTTP devuelve 400, no 500 (§ 3.1 casos 1-2) |
| DD29-2 — `product_type`/`status` fuera del `IN` → `InvalidReferenceError` | ✅ | `_assertProductType`/`_assertStatus` leídas; mensajes con el token discriminante al frente (§ 3.1 casos 3-4) |
| DD29-3 — frontera numérica, 2 niveles × 2 familias | ✅ | `_assertIntegerRef` (`Number.isSafeInteger`, sin `<= 0`), `_assertFiniteNumber` (incluye `|v| >= 1e10`), `_assertIntegerCount`; nivel A' en `findShopOwnerById`/`findProductShopId`. HTTP § 3.1 casos 10-16 |
| DD29-4 — propiedad, 404-antes-de-403, short-circuit de `super_admin` | ✅ | Orden leído en `update`/`remove`: guard de id → `findProductShopId` (404) → propiedad actual (403) → propiedad destino (403). Semántica de `null` idéntica a la tabla del design. Short-circuit asertado explícitamente en el unit test |
| DD29-5 — `deleteProduct` devuelve el snapshot pre-borrado | ✅ | `findUnique + PRODUCT_INCLUDE` antes del `delete`; § 3.4 devuelve 20 claves tras el borrado |
| DD29-6 — pivotes `deleteMany({}) + create([...])`, `uniq()`, sonda `count` normativa | ✅ | `_assertPivotIdsExist` con `prisma.category.count`/`prisma.tag.count`; el mensaje observado en HTTP (`products.categories[]`, sin `value`) es el de la sonda, no el de un `P2003` — cierra la pregunta empírica del design a favor de la sonda |
| DD29-7 — estado efectivo con `!== undefined`, nunca `??` | ✅ | `updateProduct` construye 8 `effectiveX` con `!== undefined`; derivaciones `simple`/`variable` en `_deriveProductPrices`; `inStock` de `quantity > 0` (§ 3.2: `in_stock=t` con `quantity 4`; § 3.5: `in_stock=f` con `quantity 0`) |
| DD29-8 — una sola operación con `include: PRODUCT_INCLUDE` | ✅ | Las 3 escrituras usan `PRODUCT_INCLUDE`; proyección de 20 claves verificada (§ 3.3) |
| DD29-9 — guarda 1 heredada **adaptada** (disyunto `price != null`) | ✅ | `_assertPriceRules` leída; § 3.5 confirma que un `variable` sin `price` no produce el 400 espurio |
| DD29-10 — `fileParallelism: false` | ✅ | `packages/db/vitest.config.ts` presente; los conteos pinneados de `categories`/`shops` (198/83/584/82/188/44) siguen verdes en mi corrida de `db-check` |

**Desviaciones de diseño detectadas: ninguna que rompa un spec.** Las tres
precisiones que `apply-progress.md` declara (guardas de `IN` sobre el input
crudo; `RecordNotFoundError` en la carrera de `updateProduct`; test de
`updatedAt` reformulado) son extensiones coherentes con el rationale del
design, no contradicciones — las verifiqué una por una en el código.

---

## 9. Issues

### CRITICAL — ninguno

Ningún gate falla, ningún escenario de spec queda `UNTESTED` o `FAILING`,
ninguna tarea de implementación queda sin marcar, ningún archivo protegido fue
tocado.

### WARNING

- **WARNING-1 — `staff` recibe 403 por *no ser dueño*, no por *ser staff*.** No
  existe ninguna regla explícita de rol que deniegue a `staff`: el 403 sale de
  la misma comparación `ownerId !== user.sub` que usa `store_owner`. Consecuencia
  observable: **un usuario con permiso `staff` que además sea `owner_id` de una
  tienda obtendría 200 sobre los productos de esa tienda.** El propio batch de
  `sdd-apply` tropezó con esto (asignó `staff` a un usuario que era `owner_id=2`
  y obtuvo 200). El spec lo cubre porque redacta el criterio como «`staff` MUST
  recibir 403 (**sin relación staff↔tienda**)» y la decisión 8 de la US declara
  que no hay relación staff↔tienda modelada — así que hoy es correcto por
  ausencia de datos, no por una guarda. **No bloquea US-29** (el modelo de datos
  aún no tiene esa relación), pero es una asunción que dejará de sostenerse en
  cuanto alguien modele staff↔tienda. Recomendación: que el épico lo recoja
  como nota de diseño para la US que introduzca esa relación.
- **WARNING-2 — `just build` (el `build_command` de `openspec/config.yaml`) no
  se ejecutó.** Justificado (cero líneas de frontend cambiadas, procesos del
  orquestador vivos), pero queda como gate formalmente no ejercitado en esta
  fase. El gate del área realmente tocada (`just build-api`) sí se ejecutó y
  está limpio.
- **WARNING-3 — Task 5.9 abierta.** Ver § 6, ítem 1. Riesgo residual bajo;
  requiere una decisión explícita del orquestador (ejecutarla o aceptarla) antes
  de archivar, no una corrección de código.

### SUGGESTION

- **SUGGESTION-1** — El `manufacturer_id: null` de `update()` está corregido
  pero no tiene `it` propio (solo lo tiene `create()`). Son dos sitios con el
  mismo patrón; un segundo `it` de tres líneas cerraría la simetría. No es una
  laguna de comportamiento (lo verifiqué por HTTP), sí de red de regresión.
- **SUGGESTION-2** — `packages/db/vitest.config.ts` emite un warning de Vite en
  cada corrida de `db-check`: *«ESM syntax in a file loaded as CommonJS
  (vitest.config.ts:1:1)»*. Es inocuo hoy, pero Vite anuncia que
  `configLoader: 'native'` será el default. Renombrar a `vitest.config.mjs` lo
  silenciaría. Fuera del alcance de esta US.
- **SUGGESTION-3** — `CLAUDE.md` sigue documentando «4 suites / 65 tests» para
  `apps/api/rest`; el número real es **9 suites / 204 tests**. `apply-progress.md`
  lo señala y correctamente no lo corrige (fuera de alcance). Vale la pena una
  US o un commit de mantenimiento.
- **SUGGESTION-4** — El lint de `biome` en `packages/db` sigue reportando
  errores de formato CRLF pre-existentes del checkout de Windows (27 de baseline,
  medidos con `git stash` por el batch de apply). Condición del entorno, no de
  esta US; ninguna receta de `just` la convierte en gate.

---

## 10. Veredicto

## **PASS WITH WARNINGS**

Los 20 escenarios de los cuatro specs delta están COMPLIANT con evidencia de
runtime, los tres gates del área tocada se re-ejecutaron en verde por el
auditor (`just db-check` 186/186 · `npx jest` 204/204 · `just build-api`
limpio), el alcance se respetó sin una sola incursión en los ocho caminos
protegidos, la única superficie nueva está ratificada y triplemente declarada,
y la base quedó restituida a su baseline exacto tras mi propia batería.

**US-29 puede archivarse.** La única condición previa es que el orquestador
resuelva la task 5.9: ejecutar el smoke visual del admin, o aceptarla
formalmente como deuda de verificación. No es un defecto ni un bloqueo técnico
— el contrato del que depende el redirect (`slug` en la respuesta del `PUT`)
está probado, y esta US no cambió una línea de `apps/admin`.

### Habilitaciones que `sdd-archive` puede ejecutar con confianza

1. **`openspec/specs/category-tree-api/spec.md`** — el escenario «CA-3 — los
   enlaces de producto desaparecen» puede pasar de
   `UNTESTED (verificación diferida a US-29)` a **COMPLIANT**: la evidencia
   existe por duplicado (batch de apply § 5.5 y reproducción independiente del
   auditor § 3.7), en ambos casos sobre una categoría centinela creada por
   `POST /categories`, nunca sobre una del seed.
2. **`openspec/specs/catalog-write-foundations/spec.md`** — el escenario nuevo
   de las 5 guardas de `products` entra con la cuenta verificada
   (1 heredada-adaptada / 3 nuevas / 1 por construcción).
3. **`openspec/specs/product-listing-api/spec.md`** — el reemplazo de la prosa
   de `## Out of Scope` es válido: `category_product` deja de estar vacía y
   `listProducts` la lee sin un solo cambio de código (verificado).
4. **`openspec/specs/product-write-api/spec.md`** — capability nueva, se
   fusiona completa.
