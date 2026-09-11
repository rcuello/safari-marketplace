# Apply Progress: Escrituras de productos con categorías y tags (US-29)

> Mode: Standard (strict_tdd: false). Chain strategy: stacked-to-main, 4-PR
> chain. Este documento cubre **PR#1 (Phase 1, tasks 1.1–1.12)**, **PR#2
> (Phase 2, tasks 2.1–2.5)**, **PR#3 (Phase 3, tasks 3.1–3.7 — capa API, US
> releasable aquí)**, **PR#4 (Phase 4, tasks 4.1–4.5 — unit tests de la capa
> API)**, **el fix de PR#3 autorizado tras el hallazgo de PR#4** (mismo
> commit range, `us-29-escrituras-productos-postgres`, sin cruzar a otra
> rama) y **Phase 5 (tasks 5.1–5.10 — cierre de evidencia de la DoD, quinto
> batch de `sdd-apply`)**, fusionado sobre el documento de PR#1/PR#2/PR#3/PR#4
> (Merge Protocol: ninguna tarea previa se pierde).

## Phase 5 — Cierre de la Definición de Done (evidencia, quinto batch)

**Alcance: solo evidencia, ningún archivo de código tocado.** `git status
--short` tras este batch muestra únicamente `tasks.md`,
`apply-progress.md` y los dos artefactos de `docs/product/` autorizados por
la DoD (`29-escrituras-productos-postgres.md`, `README.md` del épico 26).
Ningún archivo de `apps/api/rest/src` ni de `packages/db/src` cambia en
este batch.

### Estado de partida (verificado antes de tocar nada)

Rama `us-29-escrituras-productos-postgres` en `20dddfb`, árbol limpio,
`safari-postgres` `Up (healthy)`. Conteos baseline (idénticos a los que
PR#1-4 ya habían restituido):

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

El puerto 9001 tenía un proceso `node.exe` stale de una corrida anterior
(igual que documentó PR#3): matado antes de arrancar `just api-dev`, para
garantizar que todo `curl` de este batch corriera contra el código real de
HEAD, no contra un watcher viejo. `just db-build` se corrió primero
(bloqueante, `dist/` gitignored).

### Identidades usadas

- `store_owner@demo.com` (sub=1): dueño de las 12 tiendas del seed (`owner_id=1`
  en las 12 filas de `shops`) — login real vía `/api/token`, reutilizado tal
  cual del patrón de PR#3.
- `admin@demo.com` (sub=3): único usuario con permiso `super_admin` en el
  seed (`permission_user`: `super_admin`, `customer`, `store_owner`).
- **Tienda ajena centinela**: las 12 tiendas del seed comparten **el mismo**
  `owner_id=1` — no existe una tienda de otro dueño en los datos de partida.
  Se insertó una fila `shops` centinela (`zz-products-foreign-shop`, id 16,
  `owner_id=2`, vía `psql` directo — no hay `POST /shops` en el alcance de
  esta US, esa escritura es de US-30) para tener un `shop_id` genuinamente
  ajeno al `store_owner` de prueba. Borrada al cierre (`DELETE FROM shops
  WHERE id=16`).
- **Rol `staff`**: el seed no tiene ningún usuario con el permiso `staff`
  asignado (`permission_user` solo tiene `super_admin`/`customer`/
  `store_owner` en 3 filas). Se creó un usuario centinela aislado
  (`zz-staff-sentinel@demo.com`, mismo hash de contraseña que el resto del
  seed, **sin ninguna tienda propia**) con **solo** el permiso `staff`, para
  evitar cualquier colisión de `sub` con un `owner_id` real. Borrado al
  cierre (`DELETE FROM permission_user ...` + `DELETE FROM users WHERE
  id=354`).
  - **Nota de proceso, declarada por transparencia**: el primer intento de
    este batch asignó `staff` directamente a `customer@demo.com` (sub=2) —
    el mismo `id` que se había usado como `owner_id` de la tienda ajena
    centinela. Eso hizo que el `PUT`/`DELETE` de "staff" devolvieran **200**
    en vez de 403, porque el chequeo de propiedad comparaba correctamente
    `sub(2) === owner_id(2)` — no era un fallo de la guarda, era una
    colisión de identidades en el propio dato de prueba. Se revirtió esa
    asignación, se creó el usuario aislado de arriba y se re-corrió la
    matriz completa con resultado correcto (ver § 5.3). Se documenta aquí
    para que quede claro que el 200 inicial no fue un hallazgo de seguridad
    real.

### 5.1 — CA-1/CA-2/CA-3: secuencia completa con token `store_owner`

Producto centinela `zz-products-5.1 evidencia DoD` (`shop_id=1`, `type_id=1`,
`categories=[35]` "cereal", `tags=[62]` "shake"):

```
POST /api/products  → 201
{"id":1467,"name":"zz-products-5.1 evidencia DoD",
 "slug":"zz-products-5-1-evidencia-dod", ... 20 claves, sin related_products}

GET /api/products/zz-products-5-1-evidencia-dod (antes del reinicio) → 200

[reinicio real: taskkill del proceso + `PORT=9001 yarn start:dev`,
 esperado el primer 200 de /api/settings antes de continuar]

GET /api/settings (post-reinicio) → 200  (confirma la API real arriba)

GET /api/products?search=categories.slug:cereal (post-reinicio)
→ 200  count:1  found sentinel: true   (CA-1: sobrevive al reinicio,
                                         filtrado por categoría real)

GET /api/products/zz-products-5-1-evidencia-dod (post-reinicio) → 200

PUT /api/products/1467  {"name":"...editado","price":249.5}
→ 200  {"name":"zz-products-5.1 evidencia DoD editado",
        "slug":"zz-products-5-1-evidencia-dod"  ← INVARIANTE,
        "price":249.5,"max_price":249.5,"min_price":249.5, ... 20 claves}

GET /api/products/zz-products-5-1-evidencia-dod → 200
  name: "...editado" | slug: invariante | price: 249.5

psql: category_product WHERE product_id=1467 → 1  (intacto, PUT no envió `categories`)
      product_tag      WHERE product_id=1467 → 1  (intacto, PUT no envió `tags`)

DELETE /api/products/1467 → 200
  {"id":1467, ... 20 claves, snapshot pre-borrado}

GET /api/products/zz-products-5-1-evidencia-dod → 404
  {"statusCode":404,"message":"No existe un producto con slug
   `zz-products-5-1-evidencia-dod`.","error":"Not Found"}

psql: category_product WHERE product_id=1467 → 0
      product_tag      WHERE product_id=1467 → 0
```

**Diff de `Object.keys()` — 20 claves, mismo orden, sin `related_products`**
(segundo producto centinela `zz-products-keydiff`, comparado contra
`GET /api/products/apples` del seed, `node -e` sin `.sort()`, `jq` no
instalado):

```
seed keys (apples, related_products excluido): 20
  ["id","name","slug","type","language","translated_languages","product_type",
   "shop","sale_price","max_price","min_price","image","status","price",
   "quantity","unit","sku","sold_quantity","in_flash_sale","visibility"]
write keys (POST /api/products): 20  (mismo array, mismo orden)
same order, no .sort(): true
write has related_products: false
```

Ambos productos centinela de esta sección (`1467` borrado por la secuencia,
y el de key-diff) se limpiaron por `DELETE /api/products/:id` real. **Nota
de higiene declarada**: un primer intento de crear el producto de key-diff
falló por una ruta de archivo temporal incorrecta (`/tmp` no resuelve en
Windows/Git Bash para `node -e`) y dejó un producto huérfano (`id 1468`,
slug `zz-products-keydiff`) antes de que el segundo intento (con ruta
corregida al scratchpad) creara el `id 1469` con slug `-2`. Ambos se
detectaron con `SELECT id, slug FROM products WHERE slug LIKE
'zz-products-%'` y se borraron por HTTP real (`DELETE /api/products/1468` y
`/1469`); `SELECT count(*) FROM products` volvió a **1200** antes de seguir
con 5.2.

### 5.2 — CA-4: los 14 casos, ninguno 500

```
1) 400 rebaja inválida (sale_price >= price):
   {"statusCode":400,"message":"El precio rebajado (100) debe ser menor
    que el de lista (100) — CHECK products_rebaja_valida.","error":"Bad Request"}

2) 400 'simple' sin price:
   {"statusCode":400,"message":"Un producto 'simple' necesita precio —
    CHECK products_simple_con_precio.","error":"Bad Request"}

3) 400 product_type fuera de IN ('bundle'):
   {"statusCode":400,"message":"`products.product_type (fuera de IN
    ('simple','variable'))` referencia un registro inexistente
    (`bundle`).","error":"Bad Request"}

4) 400 status fuera de IN ('archived'):
   {"statusCode":400,"message":"`products.status (fuera de IN
    ('publish','draft'))` referencia un registro inexistente
    (`archived`).","error":"Bad Request"}

5) 400 type_id inexistente (999999):
   {"statusCode":400,"message":"`products.desconocida` referencia un
    registro inexistente.","error":"Bad Request"}

6) 400 shop_id inexistente (999999):
   {"statusCode":400,"message":"`products.desconocida` referencia un
    registro inexistente.","error":"Bad Request"}

7) 400 manufacturer_id inexistente (999999):
   {"statusCode":400,"message":"`products.desconocida` referencia un
    registro inexistente.","error":"Bad Request"}

8) 400 categoría inexistente (categories:[999999]):
   {"statusCode":400,"message":"`products.categories[]` referencia un
    registro inexistente.","error":"Bad Request"}

9) 400 tag inexistente (tags:[999999]):
   {"statusCode":400,"message":"`products.tags[]` referencia un registro
    inexistente.","error":"Bad Request"}

10) 400 type_id no entero ("abc"):
    {"statusCode":400,"message":"`products.type_id` referencia un
     registro inexistente (`NaN`).","error":"Bad Request"}

11) 400 shop_id no entero ("abc"):
    {"statusCode":400,"message":"`products.shop_id` referencia un
     registro inexistente (`NaN`).","error":"Bad Request"}

12) 400 manufacturer_id no entero ("abc"):
    {"statusCode":400,"message":"`products.manufacturer_id` referencia un
     registro inexistente (`NaN`).","error":"Bad Request"}

13) 404 PUT id inexistente (999999999):
    {"statusCode":404,"message":"No existe un producto con id
     999999999.","error":"Not Found"}

14) 404 DELETE id inexistente (999999999):
    {"statusCode":404,"message":"No existe un producto con id
     999999999.","error":"Not Found"}
```

Los 14, verificados con `-w "\nSTATUS:%{http_code}\n"` en el `curl` real:
9× **400**, 2× **404**, ninguno **500**. Cierre: `SELECT count(*) FROM
products` = **1200** y `SELECT count(*) FROM products WHERE slug LIKE
'zz-products-%'` = **0** tras los 12 intentos de escritura fallidos (ningún
`400`/`404` dejó fila).

### 5.3 — CA-5: matriz de roles completa sobre HTTP

```
403 dueño ajeno — POST shop_id=16 (store_owner, sub=1, no es owner_id=2 de la 16):
  {"statusCode":403,"message":"No tienes permisos sobre la tienda
   16.","error":"Forbidden"}

403 dueño ajeno — PUT sobre producto de la tienda 16 (creado antes por
super_admin, id 1473/1474):
  {"statusCode":403,"message":"No tienes permisos sobre la tienda
   16.","error":"Forbidden"}

403 dueño ajeno — DELETE sobre el mismo producto:
  {"statusCode":403,"message":"No tienes permisos sobre la tienda
   16.","error":"Forbidden"}

403 PUT que mueve shop_id propio (1) → ajeno (16):
  {"statusCode":403,"message":"No tienes permisos sobre la tienda
   16.","error":"Forbidden"}
  psql tras el intento: shop_id del producto 1475 sigue en 1 (sin mutación)

200 dueño propio — POST en shop_id=1 (store_owner sobre su propia tienda):
  201 {"id":1475,"name":"zz-products-ca5-ownshop", ... "shop":{"id":1,...}}

200 super_admin — PUT sobre el producto de la tienda 16 (cualquiera):
  200 {"id":1474,"name":"super admin edited", ... "shop":{"id":16,...}}

403 staff (usuario centinela aislado, sin tienda propia) — POST en shop_id=1:
  {"statusCode":403,"message":"No tienes permisos sobre la tienda
   1.","error":"Forbidden"}

403 staff — PUT sobre el producto de la tienda 16:
  {"statusCode":403,"message":"No tienes permisos sobre la tienda
   16.","error":"Forbidden"}

403 staff — DELETE sobre el mismo producto:
  {"statusCode":403,"message":"No tienes permisos sobre la tienda
   16.","error":"Forbidden"}

401 sin token — PUT:
  {"statusCode":401,"message":"Token de autenticación ausente o
   inválido.","error":"Unauthorized"}

401 sin token — DELETE:
  {"statusCode":401,"message":"Token de autenticación ausente o
   inválido.","error":"Unauthorized"}
```

Los 5 roles (`store_owner` dueño, `store_owner` ajeno, `super_admin`,
`staff`, sin token) cubiertos en las 3 rutas donde aplica, más el caso
dedicado del `PUT` que mueve `shop_id` (ambos lados de la propiedad, DD29-4).
Limpieza: productos centinela `1474`/`1475` borrados por HTTP real
(`DELETE` con `super_admin`/`store_owner` respectivamente); `SELECT id, slug
FROM products WHERE slug LIKE 'zz-products-%'` = vacío antes de seguir.

### 5.4 — CA-6: producto `variable`

```
POST /api/products {"product_type":"variable","min_price":15,"max_price":45,
  (sin "price"), "variations":[...], "variation_options":{"upsert":[...],"delete":[]}}
→ 201 {"id":1476,"product_type":"variable","price":null,
       "min_price":15,"max_price":45, ... 20 claves}

GET /api/products/zz-products-ca6-variable → 200
  product_type: variable | price: null | min_price: 15 | max_price: 45

psql — comparación con 3 variables reales del seed:
  invictus                                            | price ''  | min 70.00 | max 80.00
  magnetic-designs-women-printed-fit-and-flare-dress  | price ''  | min 35.00 | max 35.00
  mango-self-striped-a-line-dress                     | price ''  | min 70.00 | max 81.00
```

Mismo patrón que los 58 `variable` del seed: `price` vacío/`NULL`,
`min_price`/`max_price` poblados. `variations`/`variation_options` del body
**no aparecen** en la respuesta (20 claves exactas, sin rastro de esos
campos) — descartados en silencio tal como declara `R29-6`/el `design.md`.
Limpieza: `DELETE /api/products/1476` → 200, confirmado.

### 5.5 — Herencia 1 (US-28): cierre del escenario `UNTESTED`

```
POST /api/categories {"name":"zz-products-herencia1-categoria","type_id":1}
  (super_admin, NUNCA una categoría del seed)
→ 201 {"id":888,"slug":"zz-products-herencia1-categoria", ...}

POST /api/products {"categories":[888], ...} (store_owner, shop propio)
→ 201 {"id":1477,"name":"zz-products-herencia1-producto", ...}

psql: category_product WHERE category_id=888 → 1   (el enlace existe)

DELETE /api/categories/888 (super_admin)
→ 200 {"id":888, ...}

psql: category_product WHERE category_id=888 → 0   ← el escenario que
                                                        cierra Herencia 1

Cierre: DELETE /api/products/1477 → 200
psql: SELECT count(*) FROM categories → 198   (restituido)
      SELECT count(*) FROM products  → 1200   (restituido)
```

**El escenario `UNTESTED (verificación diferida a US-29)` de
`openspec/specs/category-tree-api/spec.md` (CA-3 — «los enlaces de producto
desaparecen») queda cerrado con evidencia real: 1 fila antes del `DELETE` de
la categoría, 0 después.** La edición del propio archivo de spec (pasar el
escenario de `UNTESTED` a `COMPLIANT`) se deja a `sdd-archive`, por
instrucción explícita del orquestador — este batch produce la evidencia, no
edita `openspec/specs/`.

### 5.6 — Herencia 2 (US-28): tabla de cobertura de las 5 guardas

Ya construida y verificada empíricamente en PR#2 (ver § PR#2 más abajo en
este mismo documento); se reproduce aquí como cierre formal de la DoD:

| # | Regla | DDL | Origen | Error de dominio | Test (PR#2) |
|---|---|---|---|---|---|
| 1 | `products_rebaja_valida` (`sale_price < price`) | `schema.sql:393-394` | **Heredada y adaptada** de `upsertScrapedProduct` (DD29-9 añade el disyunto `price != null`) | `InvalidSalePriceError` | `regla 1: sale_price >= price → InvalidSalePriceError` |
| 2 | `products_simple_con_precio` | `:398-399` | **Nueva** | `MissingPriceError` | `regla 2: product_type 'simple' sin price → MissingPriceError` |
| 3 | `product_type IN ('simple','variable')` | `:335-336` | **Nueva** | `InvalidReferenceError` (DD29-2) | `regla 3: product_type fuera de IN (…) → InvalidReferenceError` |
| 4 | `status IN ('publish','draft')` | `:359-360` | **Nueva** | `InvalidReferenceError` (DD29-2) | `regla 4: status fuera de IN (…) → InvalidReferenceError` |
| 5 | `products_procedencia_completa` | `:403-404` | **Por construcción**: el input del admin no declara `source_*` ⇒ `num_nonnulls = 0 ∈ (0,2)` siempre falso | — (sin guarda de runtime) | **Sin test** — documentado en el `describe`, no simulado |

1 heredada-adaptada / 3 nuevas / 1 por construcción sin guarda de runtime,
tal como exige la task 5.6. Su incorporación formal al escenario de
`openspec/specs/catalog-write-foundations/spec.md` («Una violación de CHECK
no pertenece al conjunto cerrado — lección para `products` (US-29)») queda,
igual que en 5.5, para `sdd-archive`.

### 5.7 — Sin mock huérfano ni regresión en archivos protegidos

```
$ grep -n "@db/\|plainToClass" apps/api/rest/src/products/products.service.ts
(sin salida — 0 líneas, exit code 1 de grep)

$ git diff --stat main...HEAD -- apps/api/rest/src/common/slug.ts \
    apps/api/rest/src/common/domain-errors.ts packages/db/src/domain-errors.ts \
    packages/db/src/slug.ts apps/api/rest/src/common/errors/ db/schema.sql \
    apps/shop apps/admin
(sin salida — cero cambios en los 8 caminos protegidos)
```

**`upsertScrapedProduct` sin tocar en su cuerpo**: `git diff --unified=0
main...HEAD -- packages/db/src/repositories/products.repository.ts` muestra
sus hunks reales —

```
@@ -22 +22,7 @@ import { now } from '../clock';
@@ -36,0 +43 @@ import {
@@ -441,0 +449,468 @@ export async function deleteScrapedProduct(
@@ -446,2 +921,10 @@ export async function deleteScrapedProduct(
@@ -450 +933,2 @@ export class InvalidSalePriceError extends Error {
@@ -456,2 +940,2 @@ export class InvalidSalePriceError extends Error {
@@ -460 +944,2 @@ export class MissingPriceError extends Error {
@@ -466,2 +951,2 @@ export class MissingPriceError extends Error {
@@ -470 +955,2 @@ export class IncompleteProvenanceError extends Error {
```

— el hunk grande (`+449,468` líneas) se inserta **entre** el final de
`upsertScrapedProduct` y el inicio de `deleteScrapedProduct` (código
enteramente nuevo, las 3 escrituras + guardas), y los hunks pequeños de más
abajo tocan solo los `super(...)` de las 3 clases de error (DD29-1). Ninguna
línea dentro del cuerpo de `upsertScrapedProduct` (que termina antes de la
línea 441 del archivo viejo) aparece en un hunk.

### 5.8 — Cierre de conteos vía `psql`

```
$ docker exec safari-postgres psql -U safari -d safari_scraper -t \
    -c "SELECT count(*) FROM products;" \
    -c "SELECT count(*) FROM category_product;" \
    -c "SELECT count(*) FROM product_tag;" \
    -c "SELECT count(*) FROM categories;" \
    -c "SELECT count(*) FROM tags;" \
    -c "SELECT count(*) FROM shops;" \
    -c "SELECT count(*) FROM users;"
  1200
     0
     0
   198
    10
    12
     3
```

Idéntico al baseline medido antes de arrancar Phase 5. Además de los
productos/categoría centinela (todos borrados por HTTP real, ver 5.1-5.5),
esta corrida creó y borró por `psql` directo: la tienda ajena centinela
(`id 16`, `DELETE FROM shops WHERE id=16`) y el usuario `staff` aislado
(`id 354`, `DELETE FROM permission_user ...` + `DELETE FROM users WHERE
id=354`) — ambos confirmados fuera de la base en el conteo final (`shops` =
12, `users` = 3, idénticos al arranque).

### 5.9 — Smoke-test en el navegador: **PENDIENTE (orquestador)**

Este batch de `sdd-apply` no tiene acceso a una herramienta de navegador —
no hay ningún MCP ni tool de automatización de UI disponible en este
entorno de ejecución. **No se fabricó evidencia.** Se deja explícitamente
pendiente para que el orquestador (u otro batch con acceso a un navegador)
verifique: tras un `PUT /api/products/:id` real desde el formulario del
admin, `apps/admin/rest` redirige a `/products/{slug}/edit` y los campos
editados aparecen guardados. La API real que el admin consumiría ya está
verificada end-to-end por HTTP en 5.1 (`PUT` con `name`/`price` nuevos,
`slug` invariante, `GET` posterior refleja los cambios) — lo único que
falta cerrar es el **routing del frontend tras la mutación**, que es
puramente de UI y no cambia el contrato ya probado.

### Cierre de identidades y filas de prueba (Phase 5)

Todo lo creado en este batch fuera de la API (vía `psql` directo, porque no
había ruta HTTP en el alcance de esta US para crearlo) se borró antes de
cerrar:

| Fila centinela | Creada para | Borrada con |
|---|---|---|
| `shops.id=16` (`zz-products-foreign-shop`, `owner_id=2`) | Tener un `shop_id` genuinamente ajeno al `store_owner` de prueba (CA-5) | `DELETE FROM shops WHERE id=16` |
| `users.id=354` (`zz-staff-sentinel@demo.com`) | Un token `staff` real sin colisión de `sub` con ningún `owner_id` (CA-5) | `DELETE FROM permission_user ...` + `DELETE FROM users WHERE id=354` |

### Verificación de aislamiento del proceso API

`just api-dev` corrió sobre el puerto 9001 durante todo Phase 5 (reiniciado
una vez, a mitad de la secuencia 5.1, para probar la persistencia real tras
reinicio). Detenido (`taskkill`) al cierre de este batch — `netstat` final
confirma que no queda ningún `LISTENING` en 9001/3003/3002.

### Workload / PR Boundary (Phase 5)

- Mode: evidencia de cierre de DoD, no una PR de código — no cuenta contra
  el presupuesto de revisión de 400 líneas (cero líneas de `apps/api/rest/src`
  ni `packages/db/src` tocadas).
- Current work unit: **Phase 5 — cierre completo de la Definición de Done**
  (tasks 5.1-5.10).
- Boundary: empieza sobre PR#4 + su fix ya aplicados (204/204 `npx jest`
  verde, `just build-api` limpio). Cierra con las 10 tareas de Phase 5
  evidenciadas — 9 con evidencia real pegada, 1 (`5.9`, smoke de navegador)
  declarada `PENDIENTE (orquestador)` sin fabricar evidencia.
- Estimated review budget impact: 0 líneas de código (solo
  `docs/product/26-escrituras-catalogo-postgres/{README,29-...}.md`,
  `tasks.md` y este documento).

## GATE RESUELTO — PR#4 descubrió un defecto genuino en `products.service.ts` (PR#3); autorizado y corregido en un commit separado

**Estado final: corregido, en verde, evidencia real pegada abajo.** Este
defecto se descubrió DENTRO del alcance autorizado de PR#4
(`products.service.spec.ts`, un test escrito exactamente como pedía `R29-7`)
pero vivía en `products.service.ts` (archivo de PR#3, fuera del alcance de
ese batch). Se documentó sin corregir, se pidió autorización, el
coordinador **verificó el hallazgo de forma independiente** y **autorizó
explícitamente el fix** con la siguiente motivación textual: *"el fix es
INSIDE US-29's scope. La US posee `products.service.ts`, el defecto está en
código que esta US introdujo, y el registro de riesgos del propio diseño
exige este comportamiento. La división PR#3/PR#4 es una convención interna
de la cadena para el tamaño de revisión, no una frontera de contrato — no
justifica enviar un camino conocido como roto."* Queda registrado como
hallazgo permanente del audit trail (visible para `sdd-verify`/
`sdd-archive`), no como una nota borrada tras corregirse.

### El hallazgo

`R29-7` (design.md) es explícito: *"`manufacturer_id` como opcional
silencioso... `null` explícito SÍ es válido, probado aparte."* Es decir: un
cliente que manda `{"manufacturer_id": null}` para decir "sin fabricante"
(`SET NULL`, columna nullable) debe ver ese `null` preservado hasta el
repositorio.

`products.service.ts` migrado en PR#3 hace, tanto en `create()` (`:188-189`)
como en `update()` (`:487-488`):

```ts
...(createProductDto.manufacturer_id !== undefined && {
  manufacturerId: Number(createProductDto.manufacturer_id),
}),
```

`null !== undefined` es `true`, así que la rama SÍ corre — pero
`Number(null) === 0`, no `null`. El resultado: un `manufacturer_id: null`
explícito del cliente se convierte en `manufacturerId: 0` camino al
repositorio, una referencia a un fabricante que no existe. En vez de
crear/actualizar el producto con `manufacturer_id` limpio (`NULL` en la
fila), el repositorio recibe un id que va a fallar la sonda de FK
(`_assertIntegerRef`/`P2003`) — o, peor, si algún día existiera un
fabricante con id `0`, enlazaría el producto al fabricante equivocado en
silencio. Ninguno de los dos desenlaces es el que pide `R29-7`.

### Evidencia real — test en rojo, escrito para probar el contrato CORRECTO

Test añadido en `products.service.spec.ts` (`describe('ProductsService.create
...')`, `it('manufacturer_id: null explícito llega como null al
repositorio, nunca Number(null)===0 (R29-7)')`):

```
● ProductsService.create (Postgres vía @safari/db, US-29) › manufacturer_id: null explícito llega como null al repositorio, nunca Number(null)===0 (R29-7)

  expect(received).toBeNull()

  Received: 0

  > 766 |     expect(input.manufacturerId).toBeNull();
        |                                  ^
```

El mismo patrón (`!== undefined` sin distinguir `null`) estaba DUPLICADO en
`update()` (`:487-488`) — no se escribió un segundo test rojo para no
duplicar la misma evidencia, pero el defecto era idéntico ahí. **Se
verificó que ningún otro campo nullable construido campo a campo sufre el
mismo patrón**: `manufacturer_id` es el único campo, de los tres con
`Number(...)`, que además es legítimamente nullable en
`CreateProductInput`/`UpdateProductInput` (`manufacturerId?: number |
null`). `type_id`/`shop_id` también usan `Number(...)`, pero son
`typeId: number`/`shopId: number` — no nullable —, así que un `null`
explícito ahí cae correctamente al 400 vía `P2003` (el comportamiento que
la propia tabla de `DD29-4` ya documenta como deseado, no un defecto). El
resto de campos opcionales (`price`, `sale_price`, `min_price`, `max_price`,
`quantity`, `sku`, etc.) se pasan SIN `Number(...)` — sus tipos ya aceptan
`number | null`/`string | null` directamente, así que un `null` explícito
llega intacto sin pasar por ninguna coerción. Conclusión: el defecto es
exactamente el que `R29-7` nombraba, en exactamente los dos sitios
(`create`/`update`), y en ningún otro campo.

### Autorización y verificación independiente del coordinador

El coordinador re-derivó el hallazgo de forma independiente antes de
autorizar (evaluación directa: `null !== undefined` → `true`, `Number(null)`
→ `0`) y confirmó que la capa de datos (`packages/db`) YA acepta el valor
correcto sin cambios: `CreateProductInput.manufacturerId?: number | null`
(`products.repository.ts:7`), `UpdateProductInput` igual (`:620`),
`createProduct` normaliza con `input.manufacturerId ?? null` (`:705`), y
`updateProduct` discrimina por `!== undefined` (`:824`). Es decir: pasar
`null` tal cual es exactamente el contrato que la capa de datos ya espera —
**el fix es puramente de `products.service.ts`, cero cambios en
`packages/db`.**

Ruling explícito de scope del coordinador: *"fixing this is INSIDE US-29's
scope... the PR#3/PR#4 split is an internal chain convention for review
sizing, not a contract boundary — it does not justify shipping a
known-broken path."*

### Corrección aplicada (autorizada, commit separado — "(US-29, PR#3 fix)")

En ambos sitios (`products.service.ts:188-189` de `create()`,
`:487-488`→`:496-502` tras el primer parche, de `update()`), la misma
distinción de tres vías que ya usa el resto del archivo para `!== undefined`
(DD29-7 a nivel de servicio, paralela a la del repositorio): **ausente
(`undefined`) = clave omitida · `null` explícito = `null` · cualquier otra
cosa = `Number(...)`**:

```ts
...(createProductDto.manufacturer_id !== undefined && {
  manufacturerId:
    createProductDto.manufacturer_id === null
      ? null
      : Number(createProductDto.manufacturer_id),
}),
```

(Idéntico en `update()`, sobre `updateProductDto.manufacturer_id`.) 2 líneas
añadidas por sitio (comentario + rama ternaria), 4 líneas netas en total.
Ningún otro campo, método, DTO, controller ni archivo de `packages/db`
tocado — `git diff --stat` de este fix confirma un único archivo,
`products.service.ts`, +16/-2.

### ¿La evidencia HTTP real de PR#3 habría atrapado esto?

**No.** La secuencia de `curl` de la task 3.7 (`POST` → `GET` → reinicio →
`GET` por categoría → `PUT` → `GET` → `DELETE` → `GET 404`) nunca envía
`manufacturer_id: null` explícito — el producto centinela de esa secuencia
ni siquiera declara `manufacturer_id` (queda `undefined`, la rama que SÍ
funcionaba bien desde PR#3). Un smoke test de camino feliz no tiene motivo
para probar el caso de borde "limpiar un campo opcional-y-nullable
mandando `null`"; es precisamente el tipo de caso que un smoke test manual
no cubre por construcción y que un test unitario dirigido, como los de
PR#4, sí. Esto es, textualmente, el argumento de por qué PR#4 existe como
fase separada en la cadena — no una casualidad de esta corrida.

### Verificación real tras el fix

`cd apps/api/rest && npx jest` (suite completa, las 9):

```
PASS src/common/errors/domain-error.mapper.spec.ts (24.652 s)
PASS src/tags/tags.service.spec.ts (32.477 s)
PASS src/users/user-dto.mapper.spec.ts (37.81 s)
PASS src/categories/categories.service.spec.ts (39.638 s)
PASS src/types/types.service.spec.ts (41.408 s)
PASS src/shops/shops.service.spec.ts (45.574 s)
PASS src/users/users.service.spec.ts (49.483 s)
PASS src/manufacturers/manufacturers.service.spec.ts (49.658 s)
PASS src/products/products.service.spec.ts (50.476 s)

Test Suites: 9 passed, 9 total
Tests:       204 passed, 204 total
Snapshots:   0 total
Time:        63.644 s
```

`just build-api` tras el fix:

```
yarn build
$ rimraf dist
$ nest build
Done in 80.63s.
```

Limpio — sin errores de `tsc`/Nest. **Genuinamente verde**, no reportado sin
pegar la salida real.

## PR#4 — Unit tests de la capa API (Phase 4, tasks 4.1–4.5)

**Alcance respetado.** Único archivo tocado:
`apps/api/rest/src/products/products.service.spec.ts` (+387 líneas,
`git diff --stat`). `git status --short` confirma que ni
`products.service.ts`, ni `products.controller.ts`, ni
`create-product.dto.ts`, ni ningún archivo de `packages/db` aparecen en el
diff de este batch.

### Completed Tasks (Phase 4 / PR#4)

- [x] 4.1 — `jest.mock('@safari/db', ...)` ampliado con `createProduct`,
      `updateProduct`, `deleteProduct`, `findProductShopId`,
      `findShopOwnerById` (los 5, como `jest.fn()`); las clases de error
      (`InvalidSalePriceError`, `MissingPriceError`, `InvalidReferenceError`,
      `RecordNotFoundError`, `SlugConflictError`) y `CATALOG_ERROR_CODES`
      siguen REALES vía el `jest.requireActual` ya existente (nunca se
      mockearon). `toWriteHttpException` es real por construcción: viene de
      `domain-error.mapper`, no de `@safari/db`. Los 20 `it` de lectura
      preexistentes: intactos, verificados corriendo en verde en la misma
      corrida.
- [x] 4.2 — `create`/`update`/`remove`: proyección de 20 claves (mismo
      `EXPECTED_KEYS` que ya usaban los tests de lectura, mismo orden, sin
      `related_products`); `Number()` de `type_id`/`shop_id`/
      `manufacturer_id` probado con las 3 FK como string; guard de id
      (`NaN`/`1.5`/`0`/`-1`) → 404 en `update`/`remove` **sin** llamar a
      `findProductShopId` (aserción `not.toHaveBeenCalled()`, no solo el
      404); `manufacturer_id: null` explícito → **hallazgo real, corregido**,
      ver § GATE RESUELTO arriba.
- [x] 4.3 — Matriz de roles de CA-5 en las 3 rutas (`create`/`update`/
      `remove`) vía `it.each`: `store_owner` dueño → 200; `store_owner`
      ajeno → 403; `super_admin` → 200 **con aserción explícita**
      `findShopOwnerByIdMock` NO llamado (short-circuit probado, no
      inferido del 200); `staff` ajeno → 403. Caso "sin token → 401":
      DECLARADO en un comentario, no un `it` — lo produce `JwtAuthGuard`
      (US-23) antes de que `ProductsService` exista en la cadena; un test
      que invocara el guard probaría el guard, no este archivo. `PUT` que
      mueve `shop_id` a tienda ajena: describe dedicado con 2 `it`
      (403 sondeando AMBOS lados vía `findShopOwnerByIdMock.mockImplementation`
      que responde distinto por `shopId`, y 200 cuando ambos lados son del
      mismo dueño).
- [x] 4.4 — Las 5 clases de dominio → su status HTTP vía `toWriteHttpException`
      REAL, con `it.each`: `InvalidSalePriceError`/`MissingPriceError` → 400
      (asertado EXPLÍCITAMENTE, no solo "no es 500" — este es el punto donde
      DD29-1 paga: antes de esa decisión estas dos clases no llevaban `code`
      y `toWriteHttpException` degradaba a 500), `InvalidReferenceError` →
      400, `RecordNotFoundError` → 404, `SlugConflictError` → 409.
- [x] 4.5 — Verificación: en la corrida ORIGINAL de PR#4, **NO verde** (9
      suites, 1 failed/8 passed; 204 tests, 1 failed/203 passed — el fallo
      era el hallazgo de § GATE RESUELTO, no un defecto de este archivo).
      Tras el fix autorizado de `products.service.ts` (commit separado,
      "(US-29, PR#3 fix)"), **re-verificado en verde real**: 9 suites / 204
      tests, todos pasando; `just build-api` limpio. El archivo de tests no
      desbordó el forecast (~650 líneas): +387 líneas reales
      (`git diff --stat`). Ver ambas evidencias (roja original, verde final)
      abajo y en § GATE RESUELTO.

### Deviations from Design (PR#4)

Ninguna decisión de diseño se contradijo. El único desvío es el hallazgo ya
descrito (§ GATE RESUELTO) — no es un desvío de diseño sino un defecto de
implementación de PR#3 que el design (`R29-7`) ya anticipaba como riesgo,
que este batch confirmó empíricamente y que el mismo batch, ya autorizado,
corrigió.

### Files Changed (PR#4)

| File | Action | Δ líneas (`git diff --stat`) | Qué se hizo |
|---|---|---|---|
| `apps/api/rest/src/products/products.service.spec.ts` | Modified | +387 / -0 | 6 `describe` nuevos (`create`, guard de id de `update`/`remove`, matriz de roles CA-5 ×3 rutas, `PUT` que mueve `shop_id`, mapeo de errores de dominio), imports ampliados, helpers `makeUser`/`makeCreateDto`/`makeUpdateDto`. Los 20 `it` de lectura preexistentes, intactos |
| **Total** | | **+387** | Bajo el techo forecast de PR#4 (~650) |

### Issues Found (PR#4)

Uno, encontrado y **ya corregido** dentro de este mismo batch (autorizado
por el coordinador): ver § GATE RESUELTO arriba (defecto genuino en
`products.service.ts`, `manufacturer_id: null` → `Number(null) === 0` en
`create()`/`update()`).

### Verification Evidence (real output) — PR#4

> Las dos corridas de abajo son intencionalmente ANTES/DESPUÉS del fix
> (auditoría completa, no se sobreescribe la evidencia roja original).

#### ANTES del fix — `cd apps/api/rest && npx jest products.service.spec.ts` (solo el archivo tocado)

```
Test Suites: 1 failed, 1 total
Tests:       1 failed, 58 passed, 59 total
Snapshots:   0 total
Time:        78.903 s
```

Único fallo:

```
● ProductsService.create (Postgres vía @safari/db, US-29) › manufacturer_id: null explícito llega como null al repositorio, nunca Number(null)===0 (R29-7)

  expect(received).toBeNull()

  Received: 0

  > 766 |     expect(input.manufacturerId).toBeNull();
```

#### ANTES del fix — `cd apps/api/rest && npx jest` (suite completa, las 9)

```
PASS src/common/errors/domain-error.mapper.spec.ts (34.048 s)
PASS src/users/user-dto.mapper.spec.ts (34.29 s)
PASS src/tags/tags.service.spec.ts (34.125 s)
FAIL src/products/products.service.spec.ts (35.336 s)
  ● ProductsService.create (Postgres vía @safari/db, US-29) › manufacturer_id: null explícito llega como null al repositorio, nunca Number(null)===0 (R29-7)
    expect(received).toBeNull()
    Received: 0
PASS src/categories/categories.service.spec.ts (35.688 s)
PASS src/types/types.service.spec.ts (35.959 s)
PASS src/shops/shops.service.spec.ts (35.998 s)
PASS src/manufacturers/manufacturers.service.spec.ts (36.577 s)
PASS src/users/users.service.spec.ts (37.417 s)

Test Suites: 1 failed, 8 passed, 9 total
Tests:       1 failed, 203 passed, 204 total
Snapshots:   0 total
Time:        43.48 s, estimated 75 s
```

**Conteo real reportado en su momento, no el "4 suites / 65 tests" obsoleto
de `CLAUDE.md`** (sin corregir ese archivo — fuera de alcance): 9 suites /
204 tests, de los cuales 203 pasaban y 1 fallaba por el hallazgo
documentado arriba.

#### DESPUÉS del fix autorizado — ver § GATE RESUELTO para la salida completa (verde real, 9/9 suites, 204/204 tests, `just build-api` limpio).

### Workload / PR Boundary (PR#4)

- Mode: chained PR slice (`stacked-to-main`, 4-PR chain).
- Current work unit: **Unit 4 — `products.service.spec.ts`** (tasks
  4.1–4.5), más el fix autorizado de `products.service.ts` que cierra el
  hallazgo de esa misma unidad.
- Boundary: empieza sobre PR#3 ya aplicado (`npx jest` 173/173 verde).
  Pasó por 203/204 — no verde — mientras el hallazgo de § GATE RESUELTO
  esperaba autorización; **cierra en 204/204 verde real** tras el fix
  autorizado por el coordinador (commit separado, "(US-29, PR#3 fix)"),
  con `just build-api` limpio confirmado después del fix. Phase 5 (cierre
  de la DoD) queda desbloqueada.
- Estimated review budget impact: +387 líneas en `products.service.spec.ts`
  (`git diff --stat`, bajo el techo forecast de PR#4 ~650) + 16/-2 líneas
  en `products.service.ts` (el fix autorizado, commit separado — no cuenta
  contra el presupuesto de PR#4, es la corrección de un defecto de PR#3).

## PR#3 — Capa API: servicio, controller, DTO (Phase 3, tasks 3.1–3.7)

**Alcance respetado.** Solo los 3 archivos autorizados:
`products.service.ts`, `products.controller.ts`,
`dto/create-product.dto.ts`. `git status --short` tras el batch muestra
exactamente esos 3 + `tasks.md`; ninguno de la lista prohibida
(`slug.ts`, `domain-errors.ts`, `common/errors/`, `db/schema.sql`,
`apps/shop`, `apps/admin`, el cuerpo de `upsertScrapedProduct`,
`products.service.spec.ts`) aparece en el diff.

### Completed Tasks (Phase 3 / PR#3)

- [x] 3.1 — `create-product.dto.ts`: `manufacturer_id?: number` standalone
      (único campo genuinamente ausente — `type_id`/`shop_id` ya llegaban
      vía `OmitType`, hueco H2 del design) + comentario documentando los
      campos aceptados-y-descartados.
- [x] 3.2 — `create(dto, user)` migrado: `shopId = Number(dto.shop_id)` →
      short-circuit de `super_admin` → `findShopOwnerById(shopId)` (403 si
      `≠ sub`, `null` deja pasar al 400 del repositorio) →
      `CreateProductInput` campo a campo (`Number()` en las 3 FK,
      `Array.isArray()` para `categories`/`tags`, **nunca `...body`**) →
      `createProduct(input)` → `toProductDto` → `catch { throw
      toWriteHttpException(error); }`.
- [x] 3.3 — `update(id, dto, user)` migrado: guard de id
      (`!Number.isSafeInteger(id) || id<=0` → 404) → `findProductShopId(id)`
      (`null` → 404) → propiedad de la tienda **actual** (403 si `≠ sub`,
      salvo `super_admin`) → si el body mueve `shop_id`, propiedad también
      del **destino** (`findShopOwnerById` del nuevo shopId; `null` deja
      pasar, `≠ sub` → 403) → `UpdateProductInput` campo a campo →
      `updateProduct(id, input)` → proyección → mismo `catch`. Orden
      verificado: 404 antes que 403, tienda actual antes que destino.
- [x] 3.4 — `remove(id, user)` migrado: mismo guard de id (404), mismo
      `findProductShopId` (404), propiedad sobre la actual (403, sin lado de
      destino), `deleteProduct(id)`, proyección del snapshot, mismo `catch`.
- [x] 3.5 — Eliminados de `products.service.ts`: `import productsJson from
      '@db/products.json'`, `import { plainToClass } from
      'class-transformer'` y el campo `private products: any = products`.
      `listProducts`/`findProductBySlug`/`toProductDto`/`parseProductSearch`
      intactos (confirmado por `git diff`: no aparecen en el rango
      modificado).
- [x] 3.6 — `products.controller.ts`: `@CurrentUser() user: CurrentUserPayload`
      añadido a las 3 rutas de escritura (`createProduct`, `update`,
      `remove`), pasado como segundo/tercer argumento al servicio.
      `@Permissions(...ADMIN_OWNER_AND_STAFF)` intacto en las 3 — no se tocó
      ningún decorador de permisos.
- [x] 3.7 — Verificación completa (ver § Verification Evidence abajo):
      `just db-build` → `just build-api` limpio → `grep` de `@db/`/
      `plainToClass` → 0 líneas → `just api-dev` real (reiniciado una vez a
      mitad de secuencia) → secuencia `curl` completa con token
      `store_owner` real (login vía `/api/token`) → diff de `Object.keys()`
      contra el seed (`apples`) → `just verify` verde (API + shop + admin
      arriba, los 3 `OK`).

### Campos descartados en silencio (declarados, `R29-6`)

Construidos **campo a campo**, nunca `...body`: `variations`,
`variation_options`, `author_id`, `digital_file`, `height`/`length`/`width`,
`in_flash_sale` (la lectura sigue emitiendo la constante `0`, sin cambios).
Tampoco se mapean `isDigital`/`isExternal`/`externalProductUrl` de
`CreateProductInput`/`UpdateProductInput`: `Product` (la entidad de Nest) no
los declara, así que el DTO nunca los recibe del body — quedan a los
defaults del repositorio (`false`/`false`/`null` en `create`, sin tocar en
`update`). No están entre las 20 claves de `toProductDto`, así que esta
omisión no es observable desde la respuesta de escritura.

### Deviations from Design (PR#3)

Ninguna. Un matiz no deletreado línea a línea por el design, dentro de lo
que autoriza:

- El design menciona `Number(...)` explícitamente solo para las 3 FK
  (`type_id`/`shop_id`/`manufacturer_id`). Los campos numéricos puros
  (`price`, `sale_price`, `min_price`, `max_price`, `quantity`) se pasan
  **sin coerción** — si el cliente manda un string no numérico (`"abc"`),
  `_assertFiniteNumber`/`_assertIntegerCount` del repositorio lo detectan
  igual (`Number.isFinite('abc')` es `false` sin intentar coercionar, nunca
  `true` por accidente) y responden 400, no 500. No se necesitaba `Number()`
  ahí para cerrar `CA-4`.
- Los ids dentro de `categories[]`/`tags[]` se pasan tal cual llegan del
  body (solo `Array.isArray()` como filtro de inclusión), sin `.map(Number)`
  elemento a elemento — la task 3.2 solo pide `Number()` "en las 3 FK" y
  `Array.isArray()` para los arrays; la frontera numérica de cada id
  individual la sigue cerrando `_assertIntegerRef` del repositorio (PR#1),
  que ya trata un string no entero como 400.

### Files Changed (PR#3)

| File | Action | Δ líneas (`git diff --stat`) | Qué se hizo |
|---|---|---|---|
| `apps/api/rest/src/products/products.service.ts` | Modified | +257 / -20 | `create`/`update`/`remove` migrados de Postgres via `@safari/db`; propiedad por tienda (DD29-4); fuera `@db/products.json`, `plainToClass`, `private products` |
| `apps/api/rest/src/products/products.controller.ts` | Modified | +19 / -4 | `@CurrentUser()` en las 3 rutas de escritura; `@Permissions` intacto |
| `apps/api/rest/src/products/dto/create-product.dto.ts` | Modified | +17 / -1 | `manufacturer_id?: number` standalone + comentario de campos aceptados/descartados |
| **Total** | | **+293 / -25** (277 inserciones + 20 eliminaciones netas por `git diff --stat`, contando ambos lados) | Por encima del ~210 forecast de PR#3 de `tasks.md`, dentro del margen de redondeo (~287) del roll-up total de la US; no dispara una nueva decisión de partición — el chain de 4 PRs ya estaba resuelto por el usuario |

### Issues Found (PR#3)

Ninguno bloqueante.

- Puerto 9001 ya estaba ocupado por un proceso `node.exe` (PID 60352) de una
  corrida anterior al arrancar este batch — matado y reiniciado para
  garantizar que el `curl` corriera contra el `dist`/código fuente de ESTE
  batch, no contra un watcher stale. Idéntica precaución tomada para el
  "reinicio de la API" que exige la secuencia de la task 3.7 (matado de
  nuevo, relanzado, esperado el `200` real antes de continuar).
- `just verify` exige los 3 servicios arriba (API + shop + admin, ninguno
  opcional en el script); se levantaron `shop-dev`/`admin-dev` solo para
  esa verificación puntual y se detuvieron inmediatamente después —no
  quedan procesos de frontend corriendo al cierre de este batch.

### Verification Evidence (real output) — PR#3

#### `just db-build`

```
npm run build
> @safari/db@0.1.0 build
> prisma generate && tsup
✔ Generated Prisma Client (7.10.0) to .\generated\prisma\client in 288ms
CJS Build start
CJS dist\index.js     162.95 KB
CJS dist\index.js.map 391.24 KB
CJS ⚡️ Build success in 109ms
DTS Build start
DTS ⚡️ Build success in 13941ms
DTS dist\index.d.ts 1.39 MB
```

#### `just build-api`

```
yarn build
$ rimraf dist
$ nest build
Done in 91.08s.
```

Limpio — sin errores de `tsc`/Nest.

#### `grep -n "@db/\|plainToClass" apps/api/rest/src/products/products.service.ts`

```
(sin salida — 0 líneas, exit code 1 de grep)
```

#### `cd apps/api/rest && npx jest` — sin regresión

```
Test Suites: 9 passed, 9 total
Tests:       173 passed, 173 total
Snapshots:   0 total
Time:        73.316 s
```

173/173 — idéntico al baseline pre-US-29 declarado por el orquestador (9
suites / 173 tests). Los 20 `it` de lectura de `products.service.spec.ts`
sobreviven sin tocar ese archivo (confirmado: no aparece en `git status`).

#### Secuencia HTTP real (token `store_owner` real, login vía `/api/token`)

Login:

```
POST /api/token {"email":"store_owner@demo.com","password":"demodemo"}
→ 200 {"token":"eyJ...","permissions":["customer","store_owner"],"role":"store_owner"}
```

Secuencia completa (ids reales, no simulados):

```
POST /api/products  (shop_id 1, type_id 1, categories:[1], tags:[62], status publish)
→ 201  {"id":1465,"name":"zz-products-us29 evidencia PR3",
        "slug":"zz-products-us29-evidencia-pr3", ... 20 claves, sin related_products}

GET /api/products/zz-products-us29-evidencia-pr3
→ 200  (con related_products — endpoint de lectura, no de escritura)

[reinicio real de la API: taskkill del proceso anterior + `just api-dev` de nuevo,
 esperado el primer 200 de /api/settings antes de continuar]

GET /api/products?search=categories.slug:fruits-vegetables
→ 200  total:1, found sentinel product: true   (CA-1: sobrevive al reinicio)

GET /api/products/zz-products-us29-evidencia-pr3   (post-reinicio)
→ 200

PUT /api/products/1465  {"name":"...editado","categories":[],"price":249.5}
→ 200  {"name":"zz-products-us29 evidencia PR3 editado",
        "slug":"zz-products-us29-evidencia-pr3"  ← INVARIANTE,
        "price":249.5, "max_price":249.5, "min_price":249.5, ... 20 claves}

psql: category_product WHERE product_id=1465 → 0   (vaciado, se envió [])
      product_tag      WHERE product_id=1465 → 1   (intacto, se omitió `tags`)

GET /api/products/zz-products-us29-evidencia-pr3
→ 200  name: "...editado" | slug: invariante | price: 249.5

DELETE /api/products/1465
→ 200  {"id":1465, ... 20 claves, snapshot pre-borrado}

GET /api/products/zz-products-us29-evidencia-pr3
→ 404  {"statusCode":404,"message":"No existe un producto con slug
        `zz-products-us29-evidencia-pr3`.","error":"Not Found"}
```

CA-1/CA-2/CA-3 verificados con evidencia real: creación con pivotes visible
tras reinicio, edición con slug invariante y pivotes en los 3 estados
(vacío/omitido probados; el estado "con ids" ya lo cubre PR#1/PR#2 vía
integración), borrado con snapshot de 20 claves + 404 posterior.

#### Diff de `Object.keys()` — 20 claves, mismo orden, sin `related_products`

```
seed keys (apples, related_products excluido): 20
  ["id","name","slug","type","language","translated_languages","product_type",
   "shop","sale_price","max_price","min_price","image","status","price",
   "quantity","unit","sku","sold_quantity","in_flash_sale","visibility"]
write keys (POST /api/products): 20  (mismo array, mismo orden)
same order, no .sort(): true
write has related_products: false
```

(Comparación hecha con `node -e`, sin `jq` — no instalado en esta máquina —
y sin `.sort()` en ninguno de los dos arrays, tal como exige la task 3.7.)

#### `just verify`

```
OK   API    :9001/api/settings  200  5503B  55ms
OK   Shop   :3003/en  200  190788B  1200ms  cards:30
OK   Admin  :3002/en/login  200  72821B  114ms  cards:1
```

Exit code 0.

#### `psql` — conteos de cierre (Postgres real, `safari-postgres`)

Antes de este batch (re-verificado, idéntico a PR#2):

```
products=1200  category_product=0  product_tag=0  categories=198  tags=10  shops=12
```

Después de crear/editar/borrar los 2 productos centinela (`1465`, `1466`)
por HTTP real:

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

Idénticos a los medidos antes de empezar — ambos productos centinela
(`1465` `zz-products-us29-evidencia-pr3`, `1466` `zz-products-us29-keys`)
borrados por `DELETE /api/products/:id` real, ningún residuo en ningún
pivote.

### Workload / PR Boundary (PR#3)

- Mode: chained PR slice (`stacked-to-main`, 4-PR chain).
- Current work unit: **Unit 3 — API: servicio + controller + DTO. US
  releasable aquí** (tasks 3.1–3.7).
- Boundary: empieza sobre PR#2 ya aplicado (`just db-check` 186/186 verde),
  termina en `just build-api` limpio + `npx jest` sin regresión (173/173) +
  secuencia HTTP real completa + `just verify` verde + conteos restituidos.
  No incluye `products.service.spec.ts` (Phase 4 / PR#4) ni el cierre formal
  de la DoD (Phase 5).
- Estimated review budget impact: +293/-25 líneas (`git diff --stat`, 3
  archivos), por encima del ~210 puntual de PR#3 pero dentro del margen de
  redondeo (~287) que el propio roll-up de `tasks.md` reserva para el total
  de la US; no requiere una nueva decisión de partición.

## PR#2 — Batería hostil de integración (Phase 2, tasks 2.1–2.5)

**Alcance respetado: solo tests.** Único archivo tocado en este batch:
`packages/db/src/repositories/products.integration.test.ts` (+323 líneas,
`git diff --stat`). Ningún guard de `products.repository.ts` resultó
defectuoso — no hizo falta tocar el repositorio; PR#1 ya cerraba las 5
guardas, las 3 FK, la sonda de pivotes y la frontera numérica exactamente
como el design las especifica. Cero archivos fuera de `packages/db` tocados;
`slug.ts`, `domain-errors.ts`, `common/errors/`, `db/schema.sql` intactos
(confirmado con `git status --short`, ver abajo).

### Completed Tasks (Phase 2 / PR#2)

- [x] 2.1 — Las 5 guardas CHECK/`IN`, 4 con test de runtime (`sale_price >=
      price` → `InvalidSalePriceError`; `simple` sin `price` →
      `MissingPriceError`; `product_type` fuera de `IN` →
      `InvalidReferenceError`; `status` fuera de `IN` →
      `InvalidReferenceError`) + 1 documentada como inalcanzable por
      construcción (`products_procedencia_completa`, sin test — el input del
      admin no declara `source_*`).
- [x] 2.2 — Las 3 FK salientes (`type_id`/`shop_id`/`manufacturer_id`)
      inexistentes → `InvalidReferenceError` vía `P2003`/
      `translateCatalogWriteError`; los 2 pivotes (`categoryIds`/`tagIds`)
      con un id inexistente → `InvalidReferenceError` vía
      `_assertPivotIdsExist`, confirmado por el TEXTO EXACTO del mensaje
      (ver § Hallazgo empírico abajo — cierra la pregunta abierta de DD29-6).
- [x] 2.3 — Frontera numérica: `type_id`/`shop_id`/`manufacturer_id`/ids de
      pivote no enteros (`Number('abc')`, `1e21`) → `InvalidReferenceError`;
      `price`/`sale_price`/`min_price`/`max_price` no finitos (`NaN`,
      `1e300`) → `InvalidReferenceError`; `quantity` no entero (`1.5`) →
      `InvalidReferenceError`. Ninguno produjo 500/`RangeError` sin traducir.
- [x] 2.4 — 404: `updateProduct(999999999, …)` y `deleteProduct(999999999)` →
      `RecordNotFoundError`. Duplicados en `categoryIds`/`tagIds` (mismo id
      repetido, en `create` y en `update`) no producen un `P2002` espurio
      (`uniq()` los deduplica antes del `create`/`deleteMany+create`).
- [x] 2.5 — `just db-build` + `npm run typecheck` limpios; `just db-check`
      verde **3 corridas consecutivas** (186/186 cada una); conteos de
      cierre restituidos vía `psql` (ver evidencia abajo).

### Hallazgo empírico — la sonda `_assertPivotIdsExist` es la que dispara, NO un `P2003` de `create` anidado

El design (DD29-6) dejaba explícitamente sin verificar si un `create`
anidado de Prisma 7 + `adapter-pg` para la fila pivote emite `P2003` bajo
Prisma 7 + `adapter-pg`, y por eso promovía la sonda `count` a normativa en
vez de apostar por ese camino. Los tests 2.2 de `categoryIds`/`tagIds`
inexistentes lo confirman con evidencia directa (no inferida): el mensaje
observado en ambos casos es el literal EXACTO que produce
`_assertPivotIdsExist` sin un tercer argumento `value` —

```
`products.categories[]` referencia un registro inexistente.
`products.tags[]` referencia un registro inexistente.
```

— y no el que produciría `translateCatalogWriteError` desde un `P2003` (que
llevaría `meta.field_name` del driver, si Prisma lo emitiera para una fila
pivote, o el `'desconocida'` genérico de respaldo si no lo emitiera; ninguno
de los dos coincide con este literal). Además, ambos tests confirman que
`findProductBySlug` del slug candidato devuelve `null` tras el rechazo: la
sonda corre ANTES de `generateSlug`/`prisma.product.create`, así que ni
siquiera se intentó la escritura — no hay ninguna ventana donde el `P2003`
pudiera haber disparado primero. **Conclusión: la sonda `count` de DD29-6 es
la que efectivamente protege el 400 del spec, no una red de respaldo
redundante** — la pregunta empírica queda cerrada a favor de la elección de
diseño (mantener la sonda normativa, no confiar en `P2003`).

### Tabla de cobertura de las 5 guardas (Herencia 2) — 1 heredada-adaptada / 3 nuevas / 1 por construcción

| # | Regla | DDL | Origen | Error de dominio | Test (PR#2) |
|---|---|---|---|---|---|
| 1 | `products_rebaja_valida` (`sale_price < price`) | `schema.sql:393-394` | **Heredada y adaptada** de `upsertScrapedProduct` (DD29-9 añade el disyunto `price != null`) | `InvalidSalePriceError` | `regla 1: sale_price >= price → InvalidSalePriceError` |
| 2 | `products_simple_con_precio` | `:398-399` | **Nueva** | `MissingPriceError` | `regla 2: product_type 'simple' sin price → MissingPriceError` |
| 3 | `product_type IN ('simple','variable')` | `:335-336` | **Nueva** | `InvalidReferenceError` (DD29-2) | `regla 3: product_type fuera de IN (…) → InvalidReferenceError` |
| 4 | `status IN ('publish','draft')` | `:359-360` | **Nueva** | `InvalidReferenceError` (DD29-2) | `regla 4: status fuera de IN (…) → InvalidReferenceError` |
| 5 | `products_procedencia_completa` | `:403-404` | **Por construcción**: el input del admin no declara `source_*` ⇒ `num_nonnulls = 0 ∈ (0,2)` siempre falso | — (sin guarda de runtime) | **Sin test** — documentado en el `describe`, no simulado |

### Divergencias / Deviations from Design (PR#2)

Ninguna. No se tocó `products.repository.ts`: todas las guardas, sondas y
traducciones de error que PR#1 implementó se comportaron exactamente como
`design.md` las especifica — cero defectos encontrados en la batería
hostil. Único hallazgo es el empírico de DD29-6 (arriba), que **confirma**
la elección de diseño en vez de contradecirla.

### Files Changed (PR#2)

| File | Action | Δ líneas (`git diff --stat`) | Qué se hizo |
|---|---|---|---|
| `packages/db/src/repositories/products.integration.test.ts` | Modified | +323 / -0 | 15 `it` nuevos en 4 `describe` (5 guardas CHECK/IN, 3 FK + 2 pivotes inexistentes, frontera numérica no-entera/no-finita, 404 + dedup de pivotes), todos sobre filas centinela `zz-products-`, usando la red de limpieza `beforeAll`/`afterAll` ya existente de PR#1. Imports añadidos: `InvalidReferenceError`/`RecordNotFoundError` de `../domain-errors`, `MissingPriceError` de `./products.repository` |
| **Total** | | **+323** | Bajo el techo forecast de PR#2 (~330) |

### Issues Found (PR#2)

Ninguno bloqueante.

- `npx biome check src/repositories/products.integration.test.ts`: **1 solo
  error, de formato** (mismo CRLF pre-existente que PR#1 ya documentó —
  `git config core.autocrlf=true` en este checkout de Windows), sin ninguna
  línea `lint/`/`assist/` real atribuible a este batch.
- `git status --short` tras el batch: un único archivo modificado
  (`packages/db/src/repositories/products.integration.test.ts`) — ninguna
  superficie fuera de `packages/db` tocada, ningún archivo de la lista
  prohibida (`slug.ts`, `domain-errors.ts`, `common/errors/`,
  `db/schema.sql`, `apps/**`) aparece en el diff.

### Verification Evidence (real output) — PR#2

#### `just db-build`

```
npm run build
> @safari/db@0.1.0 build
> prisma generate && tsup
✔ Generated Prisma Client (7.10.0) to .\generated\prisma\client in 565ms
CJS Build start
CJS dist\index.js     162.95 KB
CJS dist\index.js.map 391.24 KB
CJS ⚡️ Build success in 141ms
DTS Build start
DTS ⚡️ Build success in 9915ms
DTS dist\index.d.ts 1.39 MB
```

#### `cd packages/db && npm run typecheck`

```
> @safari/db@0.1.0 typecheck
> tsc --noEmit
```
(sin salida — limpio)

#### `just db-check` — 3 corridas consecutivas

```
=== RUN 1 ===
 Test Files  10 passed (10)
      Tests  186 passed (186)
   Start at  15:08:16
   Duration  19.12s (transform 843ms, setup 0ms, import 3.98s, tests 6.11s, environment 1ms)

=== RUN 2 ===
 Test Files  10 passed (10)
      Tests  186 passed (186)
   Start at  15:08:50
   Duration  18.10s (transform 788ms, setup 0ms, import 3.55s, tests 6.25s, environment 1ms)

=== RUN 3 ===
 Test Files  10 passed (10)
      Tests  186 passed (186)
   Start at  15:09:20
   Duration  17.28s (transform 735ms, setup 0ms, import 3.49s, tests 5.89s, environment 1ms)
```

186 = 171 (baseline post-PR#1) + 15 nuevos `it` de la batería hostil de
`products`. Conteos pinneados existentes reverificados con
`vitest run --reporter=verbose`, grepeando los `it`:

- `categories.integration.test.ts`: `rootsOnly true (default) → 83 raíces` ✓,
  `rootsOnly false → 198 nodos planos (D-4)` ✓, `cierre de la suite (R28-2):
  ningún test de escritura dejó basura: prisma.category.count() vuelve a 198` ✓.
- `shops.integration.test.ts`: `productsCount filtrado por publish/
  visibility_public (Decisión E)` ✓, `findShopBySlug > trae el mismo
  productsCount filtrado que el listado (Decisión E)` ✓.

#### `psql` — conteos de cierre (Postgres real, `safari-postgres`)

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

Idénticos a los medidos por el orquestador antes de arrancar este batch —
ningún producto/pivote centinela quedó vivo tras las 3 corridas.

### Workload / PR Boundary (PR#2)

- Mode: chained PR slice (`stacked-to-main`, 4-PR chain).
- Current work unit: **Unit 2 — `packages/db` batería hostil de
  integración** (tasks 2.1–2.5).
- Boundary: empieza sobre PR#1 ya aplicado (`just db-check` 171/171 verde),
  termina en `just db-check` verde (186/186) con los conteos del seed
  restituidos. No incluye la capa API (Phase 3 / PR#3) ni
  `products.service.spec.ts` (Phase 4 / PR#4).
- Estimated review budget impact: +323 líneas (`git diff --stat`), bajo el
  techo forecast de PR#2 (~330) del roll-up de `tasks.md`.

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

- [ ] 5.9 — Smoke-test en el navegador. **PENDIENTE (orquestador)**: este
      batch de `sdd-apply` no dispone de una herramienta de navegador; no
      se fabricó evidencia. El resto de Phase 5 (5.1-5.8, 5.10) está
      cerrado con evidencia real — ver § Phase 5 arriba.

## Status

39/40 tasks complete (Phase 1 + Phase 2 + Phase 3 + Phase 4 + Phase 5
completas salvo 5.9, **incluido el fix autorizado del defecto de
`manufacturer_id: null`** descubierto por PR#4 en código de PR#3 — ver §
GATE RESUELTO). `just db-check` verde de forma reproducible tanto al cierre
de PR#1 (171/171, 3 corridas) como al cierre de PR#2 (186/186, 3 corridas);
PR#3 cierra con `just build-api` limpio, `npx jest` sin regresión (173/173),
secuencia HTTP real completa con token `store_owner` (login real, sin
fabricar), diff de 20 claves confirmado y `just verify` verde
(API+shop+admin), evidencia real pegada en sus respectivas secciones. PR#4
añade 387 líneas de tests nuevos a `products.service.spec.ts` (dentro del
forecast ~650); su primera corrida (`npx jest`, 203/204 en verde, 1 en rojo)
probó, con evidencia real, que `manufacturer_id: null` explícito se
convertía en `Number(null) === 0` en `create()`/`update()` de
`products.service.ts` en vez de preservarse como `null` (`R29-7`). El test
NO se debilitó ni se borró — se detuvo el batch y se reportó el hallazgo;
el coordinador lo verificó de forma independiente, falló explícitamente que
está DENTRO del alcance de US-29 (la partición PR#3/PR#4 es una convención
de tamaño de revisión, no una frontera de contrato) y autorizó el fix.
Aplicado en un commit separado ("US-29, PR#3 fix"), 16/-2 líneas en
`products.service.ts`, cero cambios en `packages/db` (la capa de datos ya
aceptaba `null` sin modificarse). Re-verificado: `npx jest` **204/204 en
verde real**, `just build-api` limpio.

**Phase 5 (cierre de la DoD) completa salvo 5.9.** Las 9 tareas restantes
(5.1-5.8, 5.10) tienen evidencia real pegada: la secuencia completa
`POST/GET/reinicio/GET-por-categoría/PUT/GET/DELETE/GET-404` con token
`store_owner` real y diff de 20 claves contra el seed (5.1); los 14 casos
de `CA-4`, ninguno 500 (5.2); la matriz de 5 roles de `CA-5` sobre HTTP real,
incluida la tienda ajena centinela y el usuario `staff` aislado creados y
borrados por `psql` directo (5.3); un producto `variable` creado y leído
como los 58 del seed (5.4); el cierre de Herencia 1 de US-28 — el escenario
`UNTESTED` de `category-tree-api` (`category_product` → 0 tras borrar la
categoría centinela) — con evidencia `psql` real (5.5); la tabla de
cobertura de las 5 guardas de Herencia 2 (5.6); `grep`/`git diff --stat`
confirmando cero mock huérfano y cero cambios en los 8 caminos protegidos,
incluido el cuerpo de `upsertScrapedProduct` (5.7); el cierre de conteos
`psql` idéntico al baseline (5.8); y el Status de la US + la fila del épico
actualizados (5.10). La única tarea NO cerrada es **5.9** (smoke visual del
admin tras un `PUT`): declarada explícitamente `PENDIENTE (orquestador)` sin
fabricar evidencia, porque este batch no tiene acceso a un navegador.
Todos los conteos de Postgres (`products`=1200, `category_product`=0,
`product_tag`=0, `categories`=198, `tags`=10, `shops`=12, `users`=3) quedaron
restituidos al baseline medido antes de Phase 5. **US-29 sigue siendo
releasable desde PR#3** (Phase 3 es el corte "releasable aquí" del roll-up
de `tasks.md`); Phase 5 cierra la evidencia formal de la DoD. Ready for
`sdd-verify`/`sdd-archive`, con la única salvedad de 5.9 a resolver por el
orquestador.
