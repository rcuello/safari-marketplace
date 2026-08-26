# Verification Report — migrar-api-products-postgres

**Change**: `migrar-api-products-postgres` (US-2, Épico 1)
**Spec**: `openspec/changes/migrar-api-products-postgres/specs/product-listing-api/spec.md`
**Mode**: Standard (`strict_tdd: false`)
**Fecha de verificación**: 2026-08-25
**Veredicto**: **PASS WITH WARNINGS** (PASS-WITH-CONCERNS)

> Toda la evidencia de este reporte fue **re-ejecutada por la fase de verify**.
> Donde no se pudo re-ejecutar algo, se dice explícitamente. Ningún número se
> copió de `apply-progress.md`; de hecho, la re-medición **corrige** uno de
> ellos (ver Hallazgo V-2).

> **Nota de integridad de la evidencia (interrupción de entorno).** A mitad de
> la verificación, los tres servidores de desarrollo que había dejado la fase
> apply (API :9001, shop :3003, admin :3002) fueron dados de baja al limpiarse
> sus tareas de fondo. **La interrupción no costó ninguna evidencia**: esta fase
> nunca observó un fallo de `curl` atribuible al corte — todas las mediciones de
> la primera pasada se tomaron contra un proceso vivo (PID **27700**) y
> devolvieron 200 con payload real. Aun así, **toda la evidencia de runtime se
> volvió a ejecutar de cero** sobre un proceso nuevo levantado por esta fase
> (PID **32672**, arrancado con `just api-dev` y esperado con polling de `curl`
> hasta 200 real, ~25 s), más shop y admin relevantados y pre-calentados por
> esta fase. **Los resultados reprodujeron de forma idéntica**, hasta el byte
> (29076 B en la captura de CA-1) y hasta el conteo por campo del censo de 1199
> filas. Ningún número de este reporte depende del proceso que se cayó.

---

## Resumen ejecutivo

La migración de `GET /api/products` a Postgres cumple los cinco criterios de
aceptación de US-2 y todos los requisitos del spec, verificados con salida real
de comandos. El contrato HTTP se preserva: **20 claves exactas en el orden del
mock, `per_page` string `"30"`, total 1199, ids 1..30**, y en un censo completo
de las **1199 filas** las únicas diferencias contra `products.json` son las
divergencias ya ratificadas en el design.

Se abren cuatro reservas, ninguna bloqueante pero todas materiales:

1. **`just db-check` — el gate declarado en `openspec/config.yaml` — falla de
   forma reproducible en esta máquina** (3/3 intentos). Se demostró que es
   **pre-existente y ajeno al cambio**. Con `npm test` directo pasa 14/14 (5/5
   intentos).
2. **La divergencia #9 estaba mal medida en `design.md` y `apply-progress.md`**:
   el mock NO devuelve 0 filas para `name:apple;shop_id:6`, devuelve **20**.
3. **Cinco divergencias de comportamiento no documentadas**, dos de ellas
   devuelven **HTTP 500** donde el mock respondía 200.
4. **Cero cobertura automatizada del código nuevo de la API.** Los 3 tests
   añadidos viven en `packages/db` y ejercitan el repositorio (que ya existía),
   no el mapper ni el parser ni el manejo de errores introducidos en US-2.

---

## Completeness

| Métrica | Valor |
|---|---|
| Tasks totales | 24 |
| Tasks completas | 24 |
| Tasks incompletas | 0 |
| Archivos tocados | 4 (los cuatro permitidos) |
| Líneas cambiadas | 229 (+) / 46 (−) — dentro del presupuesto de 400 |

---

## 1. Cumplimiento de alcance (scope)

```
$ git status --porcelain
 M apps/api/rest/src/products/products.service.ts
 M docs/product/1-catalogo-desde-postgres/2-migrar-api-products-postgres.md
 M docs/product/1-catalogo-desde-postgres/README.md
 M packages/db/src/repositories/products.integration.test.ts
?? openspec/changes/migrar-api-products-postgres/

$ git diff --stat
 apps/api/rest/src/products/products.service.ts     | 169 +++++++++++++++++----
 .../2-migrar-api-products-postgres.md              |  12 +-
 docs/product/1-catalogo-desde-postgres/README.md   |  12 +-
 .../src/repositories/products.integration.test.ts  |  82 +++++++++-
 4 files changed, 229 insertions(+), 46 deletions(-)
```

| Prohibición del "NO incluye" | ¿Respetada? | Evidencia |
|---|---|---|
| `db/schema.sql` | ✅ Sí | no aparece en el diff |
| Frontend (`apps/shop`, `apps/admin`) | ✅ Sí | no aparecen en el diff |
| Detalle por slug (US-3) | ✅ Sí | `getProductBySlug` intacto; sigue en mock |
| Catálogos de apoyo (US-4) | ✅ Sí | `/api/types`, `/api/categories` intactos |
| `popular-products` / `best-selling-products` | ✅ Sí | siguen en mock (Decision B) |
| `category_product` | ✅ Sí | sin INSERT ni consulta añadida |
| `packages/db/src/repositories/products.repository.ts` | ✅ Sin cambios | no aparece en el diff, como preveía el design |

El único añadido no listado son los artefactos SDD (`openspec/changes/...`),
que son salida del propio pipeline.

**Verificación de D-1 (cero Prisma en la API) y de la Decision A:**

```
$ grep -rn "@prisma/client" apps/api/rest/src/
  (ninguna ocurrencia en src/)
$ grep -rn "buildPaginator" apps/api/rest/src/
  (ninguna ocurrencia)
$ grep -n "from 'src/common/pagination/paginate'" apps/api/rest/src/products/products.service.ts
18:import { paginate } from 'src/common/pagination/paginate';
$ node -e "...package.json..."
dep @safari/db = link:../../../packages/db
```

---

## 2. Build & Tests

### 2.1 Gate de tests (`just db-check`) — **FALLA de forma reproducible**

```
$ just db-check
npm run typecheck
> tsc --noEmit          (sin errores)
npm test
> vitest run
 RUN  v4.1.11 c:/DevOps/MyGitHub/safari-marketplace/packages/db

 ❯ src/repositories/products.integration.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/repositories/products.integration.test.ts
Error: Vitest failed to find the current suite. One of the following is possible:
- "vitest" is imported directly without running "vitest" command
- "vitest" is imported inside "globalSetup" ...
 ❯ src/repositories/products.integration.test.ts:25:1

 Test Files  1 failed (1)
      Tests  no tests
error: recipe `db-check` failed on line 329 with exit code 1
```

Reproducido **3 de 3 veces**. El error apunta a la línea 25, que es el
`afterAll` de nivel de módulo — código **pre-existente, no tocado por este
cambio**. Es un fallo de *colección* (ningún cuerpo de test llega a correr).

**El mismo comando ejecutado a mano desde bash pasa:**

```
$ cd packages/db && npm run typecheck && npm test
> tsc --noEmit
 RUN  v4.1.11 C:/DevOps/MyGitHub/safari-marketplace/packages/db
 Test Files  1 passed (1)
      Tests  14 passed (14)
   Duration  3.17s
```

Reproducido **5 de 5 veces** (14/14 tests: 11 previos + 3 nuevos).

**Prueba de que el fallo NO lo causa este cambio.** Se restauró temporalmente
la versión de `HEAD` del archivo de tests (sin los 3 tests nuevos) y se volvió
a correr el gate:

```
$ git show HEAD:packages/db/src/repositories/products.integration.test.ts > packages/db/src/repositories/products.integration.test.ts
$ just db-check
 FAIL  src/repositories/products.integration.test.ts
Error: Vitest failed to find the current suite. ...
 ❯ src/repositories/products.integration.test.ts:25:1
 Test Files  1 failed (1)
error: recipe `db-check` failed on line 329 with exit code 1
```

**Falla igual sin los tests nuevos** → defecto pre-existente del entorno.
El archivo fue restaurado de inmediato y re-verificado:

```
$ git status --porcelain
 M apps/api/rest/src/products/products.service.ts
 M docs/product/1-catalogo-desde-postgres/2-migrar-api-products-postgres.md
 M docs/product/1-catalogo-desde-postgres/README.md
 M packages/db/src/repositories/products.integration.test.ts
$ cd packages/db && npm run typecheck && npm test
      Tests  14 passed (14)
```

**Causa probable (no confirmada, no se intentó arreglar):** el banner de vitest
muestra `c:/DevOps/...` (minúscula) bajo `just` y `C:/DevOps/...` (mayúscula)
bajo bash. `just` aplica `[working-directory: 'packages/db']` (justfile:326) y
el cwd resultante lleva la letra de unidad en minúscula; vitest 4 resuelve
entonces dos instancias distintas del módulo `vitest`, que es exactamente lo
que produce "failed to find the current suite". Intentos de reproducirlo desde
bash con `cd "c:/..."` o `--root "c:/..."` **no** lo reproducen: bash y vitest
normalizan la ruta a mayúscula. El disparador es el spawn de `just`.

> **Nota de honestidad:** el orquestador reportó haber corrido `just db-check`
> independientemente con resultado verde, y `apply-progress.md` también lo
> reporta verde. Esta fase lo corrió 3 veces y falló las 3. La discrepancia
> queda registrada sin resolver: el fallo es reproducible dentro de esta
> sesión pero aparentemente no entre sesiones. **No es atribuible al cambio.**

**Consecuencia para la DoD:** el punto 3 ("Salida real de `just db-check` en
verde") **no es reproducible hoy vía `just`**. Sí lo es vía `npm test`, con
14/14. Ver disputa de la DoD en la sección 7.

### 2.2 Typecheck de la API

```
$ cd apps/api/rest && npx tsc --noEmit -p tsconfig.json
tsc --noEmit exit=0
```

### 2.3 Build

```
$ just build-api
yarn build → rimraf dist → nest build
Done in 103.54s.
exit=0

$ curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:9001/api/products?limit=5"
200
```

**`just build` (el `build_command` de `openspec/config.yaml`) NO se ejecutó**, y
esto es una desviación declarada, no un olvido:

- `just build` = `build-shop` + `build-admin` (justfile:133). **No compila ni un
  solo archivo tocado por este cambio** (los cambios están en `apps/api/rest` y
  `packages/db`).
- El justfile y `CLAUDE.md` advierten que exige detener los `dev` porque
  comparten `.next`; correrlo habría destruido los servidores de dev de los que
  depende la evidencia de CA-3 y la sesión de trabajo del usuario.
- El build que **sí** compila el código cambiado es `just build-api`, ejecutado
  arriba con éxito, más los dos `tsc --noEmit`.

---

## 3. Matriz de cumplimiento del spec

Los escenarios del spec **no tienen tests automatizados que los cubran**; se
verifican con evidencia de ejecución real, que es lo que `openspec/config.yaml`
declara vinculante (`rules.verify.require_evidence: true`, `layers.e2e: false`,
"La evidencia de cierre es la salida REAL de los comandos"). Por eso el estado
es ✅ COMPLIANT (manual) y no ❌ UNTESTED — pero ver el Hallazgo V-4.

| # | Requirement | Scenario | Evidencia | Resultado |
|---|---|---|---|---|
| R-1 | Proyección — 20 claves exactas | Key-set idéntico al mock | §4.1 censo de 1199 filas | ✅ COMPLIANT |
| R-2 | Envoltorio de paginación | `per_page` como string | §4.2 | ✅ COMPLIANT |
| R-3 | Búsqueda y filtros contra Postgres | Búsqueda por nombre, cardinalidad y orden | §4.3 / §5 #8 | ✅ COMPLIANT |
| R-3 | idem | Filtros que el mock perdía | §5 #9 y #10 | ⚠️ PARTIAL — el comportamiento es correcto, pero la **cifra del mock en #9 estaba mal** (V-2) |
| R-4 | La tienda no distingue el origen | Home sin cambios visibles | §4.4 `just verify` | ✅ COMPLIANT |
| R-5 | Origen vivo — sin reinicio | UPDATE visible sin reiniciar | §4.5 | ✅ COMPLIANT |
| R-6 | Errores de base controlados | Postgres caído | §4.6 | ✅ COMPLIANT |

**Resumen**: 6/7 escenarios ✅ COMPLIANT, 1 ⚠️ PARTIAL (documental, no funcional).

---

## 4. Evidencia por criterio de aceptación

Estado del entorno al iniciar: `safari-postgres` Up (healthy) en :5433, 1200
productos, `id 1 = Apples`, 0 filas con `source_store`, 0 filas `CANARIO`.

Cada bloque de evidencia se ejecutó **dos veces**: primera pasada contra el
proceso heredado (PID 27700) y **segunda pasada completa** contra el proceso
levantado por esta fase (PID 32672), tras la caída de entorno descrita arriba.
Salvo que se indique lo contrario, **las dos pasadas dieron el mismo
resultado**; los bloques que se muestran son los de la segunda pasada o son
idénticos en ambas.

### 4.1 CA-1 — Paridad de contrato

`mock.json` (la captura de baseline de la fase apply) **ya no existe** en el
repo, así que **no se pudo re-usar la comparación de apply**. En su lugar se
reconstruyó la línea base de forma independiente y más fuerte: se comparó la
respuesta viva contra el **archivo fuente del mock**
(`apps/api/rest/src/db/pickbazar/products.json`, 1200 filas), proyectado a las
20 claves. Esto es reproducible por cualquiera y no depende de un artefacto
volátil.

**Envoltorio y forma:**

```
$ Q='limit=30&searchJoin=and&with=type;author&search=status:publish;visibility:visibility_public'
$ curl -s "http://localhost:9001/api/products?$Q" -o pg.json
http=200 bytes=29076

WRAPPER: {"total":1199,"current_page":1,"count":30,"last_page":40,"firstItem":0,
"lastItem":29,"per_page":"30",
"first_page_url":"http://localhost:5000/api/products?search=status:publish;visibility:visibility_public&limit=30&page=1",
"last_page_url":"...&page=40","next_page_url":"...&page=2","prev_page_url":"...&page=1"}
data.length: 30
per_page typeof: string "30"
total: 1199 typeof number
distinct key orders: 1
keys: ["id","name","slug","type","language","translated_languages","product_type",
"shop","sale_price","max_price","min_price","image","status","price","quantity",
"unit","sku","sold_quantity","in_flash_sale","visibility"]
ids: [1,2,3,...,30]
type keys: ["id","name","slug","logo","settings"]
shop keys: ["id","name","slug","logo"]
```

20 claves exactas, **un solo orden de claves** en las 30 filas, idéntico al del
spec. `type` y `shop` con sus 5 y 4 claves.

**Auditoría del mock de origen (1200 filas) — confirma cada premisa del design:**

```
total mock rows: 1200
type.logo distinct: ["null"]                       ← el `logo: null` constante es fiel
rows whose top-level key order != canonical: 0     ← el orden de 20 claves se cumple en 1200/1200
in_flash_sale=1 rows: [ 2 ]                        ← divergencia #1: exactamente 1 fila
image===[] rows: [ 1068, 1070 ]                    ← divergencia #2: exactamente 2 filas
non-publish/non-public rows: [ {id:454, status:'draft'} ]  ← divergencia #5: 1200→1199
```

**Censo completo de las 1199 filas** (no solo la página 1):

```
$ curl -s "http://localhost:9001/api/products?limit=1500&search=status:publish;visibility:visibility_public"
rows returned: 1199  total: 1199
rows with any diff: 95   ids not in mock: 0   rows with wrong key order: 0
diffs per field: {"in_flash_sale":1,"type":85,"max_price":8,"min_price":8,"image":2}
== in_flash_sale (1) ==   2      mock=1 pg=0
== type (85) ==           412    mock name="Test"      pg name="Furniture"
== max_price (8) ==       647    mock=1.5899999999999999 pg=1.59
== min_price (8) ==       684    mock=4.6899999999999995 pg=4.69
== image (2) ==           1068   mock=[] pg=null
                          1070   mock=[] pg=null
mock ids absent from pg: 454(draft)
```

**Página 1: una sola diferencia, id 2 `in_flash_sale` 1→0** — exactamente la
divergencia #1 predicha. Confirmado por separado que la página 1 solo trae
`type` 1 y 3, por lo que la divergencia #3 nunca se ve ahí.

**Corrección menor al design:** el design dice que la divergencia #3 (`type`
embebido) afecta **86 filas** (55 de type 6 + 31 de type 11). En el **archivo
del mock** son en efecto 86, pero una de ellas es el borrador id 454, que
Postgres filtra. La divergencia **observable en la respuesta es de 85 filas**.
No es un defecto; es un matiz de conteo.

```
mock rows by type.id: {"1":436,"2":72,"3":81,"4":15,"5":64,"6":55,"7":335,"8":67,"9":44,"11":31}
type 6: 55   type 11: 31   sum: 86
id 454 -> type.id 6, status draft
page1 types: [1,3]
```

✅ **CA-1 verificado.**

### 4.2 CA-1b / R-2 — `per_page` string vs number y el split crudo/numérico

```
?limit=30 explícito → per_page "30"  (string), data=30, total=1199
sin limit           → per_page 30    (number), count=30, total=1199
?limit=abc          → per_page "abc" (crudo a paginate), data=30  ← listProducts recibió el number 30
?page=abc           → current_page null (crudo), data=30          ← listProducts recibió la página 1
```

Las dos últimas líneas son la prueba conductual de que `paginate()`/URL reciben
el valor **crudo** y `listProducts()` el **numérico con fallback**, tal como
exige el spec. `paginate()` local se conserva y `buildPaginator` no se usa.

✅ **R-2 verificado.**

### 4.3 CA-2 — Búsqueda por nombre contra Postgres

```
$ curl "…?limit=30&search=name:apple;status:publish;visibility:visibility_public"
PG  -> total=17
ids/names: 1:Apples, 219:Nims Apple Crisp, 372:Nongmo Simple Apple,
374:Tropicana Apple, 522:First Street Apple Pie…, 523:Jessie Lord…,
524:Signature Kitchens 11 inch Apple Pie, 709:First Street Apple Pie…,
710:Jessie Lord…, 711:Signature Kitchens 11″ Apple Pie, 821:Fresh Apples 2lbs,
822:Organic Green Apples, 823:Fresh Red Apples, 828:Red Prince Apples,
830:Fresh Fruit Apples, 1077:Apples, 1135:Nims Apple Crisp
```

`total: 17`, en orden `id ASC`, desde `contains`/`insensitive`. **No** se
ensanchó el filtro para alcanzar los 20 de fuse.

Parámetros aceptados e ignorados (`orderBy`, `sortedBy`, `date_range`,
`language`, `searchJoin`, `with`):

```
$ curl "…?limit=30&orderBy=name&sortedBy=desc&date_range=x&language=en&searchJoin=and&with=type;author&search=name:apple;…"
http=200
total 17  ids [1,219,372,374,522]  (id ASC ⇒ orderBy ignorado)
```

`author.slug`, clave desconocida y `slug` descartados sin error:

```
$ curl "…?limit=5&search=author.slug:foo;pepito:bar;slug:apples;status:publish;visibility:visibility_public"
total 1199  ids [1,2,3,4,5]
```

Orden `id ASC` estricto verificado sobre las **1199** filas:

```
id ASC estricto: true   primero 1   ultimo 1259
```

✅ **CA-2 verificado.**

### 4.4 CA-3 — La tienda no distingue el origen

**Primera pasada** (servidores heredados, PIDs 39176/39184 confirmados
escuchando justo antes de correr el comando):

```
$ just verify
OK   API    :9001/api/settings  200  5503B  104ms
OK   Shop   :3003/en  200  212886B  1451ms  cards:30
OK   Admin  :3002/en/login  200  72821B  746ms  cards:1
```

**Segunda pasada**, tras la caída de entorno y tras los dos ciclos
`db-down`/`db-up`. Shop y admin **relevantados por esta fase**
(`just shop-dev`, `just admin-dev`), con la ruta SSR pre-calentada por polling
de `curl` antes de medir (se evitó así el timeout de compilación en frío que
reportó apply):

```
$ curl … :3003/en → 200 ; curl … :3002/en/login → 200   (pre-warm)
$ just verify
OK   API    :9001/api/settings  200  5503B  49ms
OK   Shop   :3003/en  200  212886B  1028ms  cards:30
OK   Admin  :3002/en/login  200  72821B  203ms  cards:1
```

Mismo tamaño de payload (212886 B) y **cards:30** en ambas pasadas, la segunda
ya contra la base recreada. CA-3 está **verificado de forma independiente por
esta fase**, no heredado de apply.

✅ **CA-3 verificado.**

### 4.5 CA-4 — Origen vivo, sin reiniciar la API

```
=== antes ===
total CANARIO antes: 0
=== UPDATE ===
$ docker exec -i safari-postgres psql -U safari -d safari_scraper -c "UPDATE products SET name='CANARIO' WHERE id=1;"
UPDATE 1
=== curl SIN reiniciar la API ===
total: 1   id: 1   name: CANARIO
=== REVERT ===
$ docker exec -i safari-postgres psql -U safari -d safari_scraper -c "UPDATE products SET name='Apples' WHERE id=1;"
UPDATE 1
total CANARIO tras revert: 0
id 1 name: Apples
```

✅ **CA-4 verificado.** Revertido.

### 4.6 CA-5 — Errores de base controlados

```
$ just db-down
 Container safari-postgres  Stopped / Removing / Removed
 Network safari-marketplace_default  Removing / Removed

$ curl -s -o body.json -w 'http_code=%{http_code}\n' "http://localhost:9001/api/products?$Q"
http_code=503

$ cat body.json
{"statusCode":503,"message":"No se puede conectar con el servicio. Por favor, intenta más tarde.","error":"Service Unavailable"}

=== segunda peticion (no se degrada) ===
http_code=503

=== proceso Nest vivo ===
/api/types            http_code=200
/api/popular-products http_code=200

=== PID sigue escuchando en 9001 ===
  TCP    0.0.0.0:9001    0.0.0.0:0    LISTENING    32672     ← mismo PID de antes de db-down
```

Restauración y recuperación **sin reiniciar Nest**:

```
$ just db-up
  * esquema y datos de referencia aplicados

$ docker ps
safari-postgres Up 9 seconds (healthy) 0.0.0.0:5433->5432/tcp

$ psql -c "select 'products='||count(*) from products;
           select 'id1='||name from products where id=1;
           select 'scraped='||count(*) from products where source_store is not null;
           select 'canario='||count(*) from products where name='CANARIO';"
 products=1200
 id1=Apples
 scraped=0
 canario=0

$ curl "…?limit=30&…search=status:publish;visibility:visibility_public"
total=1199  per_page="30"  ids0..4=[1,2,3,4,5]  name0=Apples

  TCP    0.0.0.0:9001    LISTENING    32672   ← el mismo proceso, nunca reiniciado
```

Este ciclo `db-down` → 503 → `db-up` → 200 se ejecutó **dos veces** (una por
cada proceso de API, PID 27700 y PID 32672), con resultado idéntico las dos
veces, incluido el cuerpo JSON del 503 palabra por palabra.

✅ **CA-5 verificado.** **Entorno dejado UP y healthy, en estado limpio.**

---

## 5. Divergencias de comportamiento — LA SALIDA MÁS IMPORTANTE DE ESTE REPORTE

Ningún CA cubre estas tres. Si no quedan escritas aquí, se descubrirán más
adelante como si fueran bugs. **Todas fueron re-medidas por esta fase**: el
lado Postgres contra la API viva, y el lado mock reproduciendo `fuse.js` con la
misma configuración (`threshold: 0.3`, mismas `keys`) y el mismo algoritmo de
filtrado que tenía `products.service.ts` antes del cambio.

### #8 — Cardinalidad de la búsqueda por nombre: fuse 20 vs `contains` 17

Query: `search=name:apple;status:publish;visibility:visibility_public`

```
MOCK (fuse.js reproducido) -> total=20
 ids: 1,1077,219,1135,374,821,823,828,830,372,822,513,635,517,711,522,709,524,523,710

PG (API viva)              -> total=17
 ids: 1,219,372,374,522,523,524,709,710,711,821,822,823,828,830,1077,1135
```

**Postgres es un subconjunto estricto del mock.** Las 3 filas de más en fuse:

| id | Nombre | Por qué matchea en fuse |
|---|---|---|
| 513 | Maple & Pecan Plait | fuzziness (`threshold: 0.3`), no contiene "apple" |
| 635 | Maple & Pecan Plait | idem |
| 517 | Bon Appetit Cheese Croissant | idem |

Ninguna contiene la subcadena "apple". **17 es el resultado correcto**; no es
una regresión y no debe "arreglarse" ensanchando el filtro. R-2 del épico
licencia un **orden** distinto, no una **cardinalidad** distinta — por eso va
declarada aparte.

### #9 — `shop_id` combinado con otro filtro — ⚠️ **la cifra del design era incorrecta**

Query: `search=name:apple;shop_id:6`

```
MOCK (fuse.js reproducido) -> total=20     ← el design y apply-progress dicen 0. ES 20.
PG (API viva)              -> total=12     (AND real)
 ids: 1,219,372,374,709,710,711,821,822,823,828,830 — TODOS con shop=6
```

`design.md` (divergencia #9) y `apply-progress.md` (Phase 5.1) afirman "el mock
daba 0 filas". **Es falso.** El razonamiento del design sobre el *mecanismo* es
correcto —`shop_id` se resuelve por `exactFilters` y el bloque de `fuzzyFilters`
**sobrescribe `data` entero** dos líneas después, descartando el filtro de
shop— pero la consecuencia no es "0 filas", es **"las 20 filas de `name:apple`,
sin filtrar por shop"**. El mock no vaciaba la grilla: devolvía resultados de
**todas** las tiendas cuando el usuario pedía una sola.

Esto **agrava** la divergencia en vez de suavizarla: el cambio de
comportamiento visible es *20 productos de cualquier tienda* → *12 productos de
la tienda 6*. Sigue siendo Postgres el que hace lo correcto, pero la magnitud
del cambio percibido es mayor que la documentada. Ver Hallazgo V-2.

**`shop_id` a solas sí coincide exactamente en ambos** (esto sí confirma el design):

```
MOCK search=shop_id:6 -> total=584
PG   search=shop_id:6 -> total=584   ✅ idéntico
```

### #10 — `min_price` / `max_price`: **divergencia visible para el usuario**

```
MOCK search=min_price:50;status:publish;visibility:visibility_public -> total=0
PG   search=min_price:50;status:publish;visibility:visibility_public -> total=195
     (page1=30, precio mínimo observado en la página = 50)

PG   search=max_price:5;status:publish;visibility:visibility_public  -> total=554
```

Confirmado: **195 filas**, exactamente lo que predijo el design. `fuse` no tiene
`min_price`/`max_price` en sus `keys`, así que el token caía en `fuzzyFilters` y
no matcheaba nada.

**Impacto de producto:** la UI del filtro de precio de la tienda **sí** envía
este token (`price → min_price`). Hoy ese filtro **vacía la grilla**; a partir
de este cambio **empezará a devolver resultados reales**. Es una mejora, pero es
un cambio de comportamiento visible que puede leerse como "algo cambió en la
tienda" si no está anunciado. **Es el ítem de este reporte que debe llegar a
quien comunique el release.**

### Divergencias del contrato de datos (re-verificadas, todas ratificadas)

| # | Divergencia | Alcance declarado | Alcance **medido aquí** | ¿Coincide? |
|---|---|---|---|---|
| 1 | `in_flash_sale` siempre `0` | 1 fila (id 2, página 1) | 1 fila (id 2) | ✅ |
| 2 | `image: []` → `null` | ids 1068, 1070 | ids 1068, 1070 | ✅ |
| 3 | `type` embebido obsoleto | 86 filas (types 6+11) | **85 filas** en la respuesta | ⚠️ matiz: la 86ª es el borrador id 454, que PG filtra |
| 4 | Precios redondeados a `numeric(12,2)` | 8 filas | 8 filas en `min_price` y 8 en `max_price` | ✅ |
| 5 | `total` 1200 → 1199 sin `search` | 1 borrador | id 454 (`status: draft`) | ✅ |
| 6 | Orden de claves dentro de jsonb | — | 0 diffs con comparación sort-deep | ✅ |
| 7 | Ranking de búsqueda ≠ fuse | R-2 | orden `id ASC` estricto en 1199/1199 | ✅ |

---

## 6. Divergencias **NO documentadas** encontradas en esta fase

Medidas contra la API viva y contra la reproducción fiel del mock. Ninguna está
en `design.md` ni en `apply-progress.md`.

| Query | Mock | Postgres | Severidad |
|---|---|---|---|
| `search=shop_id:abc` | **200**, total 1200 | **500** Internal Server Error | ⚠️ WARNING |
| `search=min_price:abc` | **200**, total 0 | **500** Internal Server Error | ⚠️ WARNING |
| `search=name:` (valor vacío) | 200, total **0** | 200, total **1199** | 💡 SUGGESTION |
| `?limit=0` | 200, total 1200, count **0** | 200, total 1199, count **30** | 💡 SUGGESTION |
| `?limit=-5` | 200, count **1195** | 200, count **5** | 💡 SUGGESTION |

```
$ curl "…?limit=5&search=shop_id:abc"
500 {"statusCode":500,"message":"Ocurrió un error inesperado. Por favor, contacta al administrador.","error":"Internal Server Error"}

$ curl "…?limit=5&search=min_price:abc"
500 {"statusCode":500,"message":"Ocurrió un error inesperado. Por favor, contacta al administrador.","error":"Internal Server Error"}
```

**Causa (inspección, no corregida):** `parseProductSearch` hace
`input.shopId = Number(value)` y `input.minPrice = Number(value)` sin validar.
`Number('abc')` es `NaN`; `buildWhere` (`products.repository.ts:178`) comprueba
`!== undefined`, así que el `NaN` llega a Prisma, que lanza, y el `catch` lo
convierte en 500. El design previó el fallback `|| 1` / `|| 30` para
`page`/`limit` **pero no para los tokens numéricos del `search`**.

Esto entra además en tensión con D-2 ("errores de dominio a 400/404, nunca
500"): un parámetro de query malformado es un error del cliente (400), no del
servidor (500). El design justificó el 500 argumentando que "este path de solo
lectura no puede disparar violaciones de CHECK" — cierto, pero **sí puede
disparar un 500 por entrada malformada**, que es justo lo que D-2 quiere evitar.

**Riesgo práctico: bajo.** El cliente REST de la tienda envía `shop_id` desde un
id real y los precios desde un slider numérico. Pero el endpoint es público y un
500 no observable es peor que un 400. **Reportado, no corregido**, según las
instrucciones de esta fase.

---

## 7. CA / DoD — confirmación o disputa de lo que marcó apply

### Criterios de aceptación de US-2

| CA | Enunciado | Veredicto de verify |
|---|---|---|
| CA-1 | Paridad de contrato en el listado | ✅ **CONFIRMADO** — censo de 1199 filas, solo divergencias ratificadas; 20 claves, mismo orden, mismos tipos, ids 1..30 |
| CA-2 | Búsqueda por nombre contra la base | ✅ **CONFIRMADO** — `contains`/`insensitive`, total 17 |
| CA-3 | La tienda no distingue el origen | ✅ **CONFIRMADO** — `just verify`, cards:30 |
| CA-4 | Verificación de origen real | ✅ **CONFIRMADO** — UPDATE + curl + revert, sin reiniciar |
| CA-5 | Errores de base legibles | ✅ **CONFIRMADO** — 503 con JSON legible, proceso vivo (PID 27700) |

### Definición de Done — los cinco checkboxes que apply marcó `[x]`

| # | Ítem de la DoD | Veredicto |
|---|---|---|
| 1 | Salida real de `curl` antes (mock) y después (Postgres) con el diff de claves | ⚠️ **CONFIRMADO CON REPARO.** La evidencia existe en `apply-progress.md`, pero el artefacto `mock.json` **ya no está en el repo**, así que el "antes" **no es reproducible**. Verify lo sustituyó por una línea base más fuerte y sí reproducible (comparación contra `products.json`, 1199 filas), que **confirma la conclusión** de apply |
| 2 | Salida real de `just verify` (3 servicios OK, cards:30) | ✅ **CONFIRMADO** — re-ejecutado por verify, verde a la primera |
| 3 | Salida real de `just db-check` **en verde** | ❌ **DISPUTADO.** Verify no logró ponerlo en verde vía `just`: 3/3 fallos reproducibles. Sí en verde vía `npm test` (14/14, 5/5). Demostrado **pre-existente y ajeno al cambio**. El checkbox se sostiene solo si se lee como "los tests de `packages/db` pasan"; **no** se sostiene como "el comando `just db-check` sale en verde en esta máquina" |
| 4 | Evidencia del CA-4 (UPDATE + curl + revert) | ✅ **CONFIRMADO** — re-ejecutado por verify |
| 5 | Status de la US actualizado y fila del épico marcada | ✅ **CONFIRMADO** — verificado en `git diff`: Status → "Implementada", columna Status añadida al README del épico, US-2 → "✅ Implementada", épico → "En ejecución" |

---

## 8. Coherencia con el design

| Decisión | ¿Seguida? | Notas |
|---|---|---|
| A — `paginate()` local, no `buildPaginator` | ✅ Sí | `buildPaginator` sin ocurrencias en `apps/api/rest/src/`; `per_page: "30"` string confirmado |
| B — popular/best-selling quedan en mock | ✅ Sí | imports `productsJson`/`popularProductsJson`/`bestSellingProductsJson` y `new Fuse` preservados (líneas 19-21, 26-28, 44); endpoints verificados en §9 |
| C — sin archivo nuevo; funciones privadas | ✅ Sí | `parseProductSearch` y `toProductDto` a nivel de módulo en `products.service.ts` |
| D — try/catch local, sin ExceptionFilter global | ✅ Sí | 503/500 confirmados; los ~40 endpoints en mock no cambiaron de comportamiento de error |
| D-1 — cero `@prisma/client` en la API | ✅ Sí | 0 ocurrencias en `apps/api/rest/src/` |
| D-2 — errores de dominio a 400/404, nunca 500 | ⚠️ Tensión ampliada | El design declaró la tensión para lo "genuinamente inesperado"; en la práctica un token numérico malformado también cae en 500 (§6) |
| MUST-KEEP `if (!page)…/if (!limit)…` | ✅ Sí | literal en el código; comportamiento confirmado con `?page=abc` / `?limit=abc` |
| Plantilla de URL copiada carácter a carácter | ✅ Sí | `http://localhost:5000/api/products?search=…&limit=30&page=1` (el `:5000` hardcodeado es preexistente y fuera de scope) |

---

## 9. Regresión — lo que se quedó en mock

Todos los endpoints que el módulo sigue sirviendo desde `fuse`/`productsJson`
responden correctamente **después** del cambio:

```
200 47735B  /api/popular-products?limit=10&language=en      → array len=10, 46 claves por item
200 15836B  /api/best-selling-products?limit=10&language=en → array len=5,  46 claves por item
200  1405B  /api/draft-products?limit=5&language=en         → paginator total=1  per_page="5"
200  5466B  /api/products-stock?limit=5&language=en         → paginator total=11 per_page="5"
200 19722B  /api/products/apples                            → objeto, 21 claves, name=Apples (detalle: US-3, sigue en mock)
200 12493B  /api/types?language=en                          → OK (US-4, sigue en mock)
200 12166B  /api/categories?limit=5&language=en             → OK (US-4, sigue en mock)
```

Notas:

- `popular-products` = 10 filas y `best-selling-products` = 5 filas con **46
  claves**, exactamente lo que Decision B midió para justificar dejarlos en
  mock. La decisión se sostiene con evidencia re-verificada.
- `draft-products` devuelve `total=1`: es el borrador id 454, la misma fila que
  explica la divergencia #5. Coherente.
- `/api/products/apples` sigue emitiendo 21 claves (shape del detalle del mock),
  distinto de las 20 del listado. Correcto: es alcance de US-3.

**Sin regresiones detectadas.**

---

## 10. Hallazgos

### CRITICAL

Ninguno.

### WARNING

- **V-1 — `just db-check`, el gate declarado del proyecto, falla de forma
  reproducible vía `just` (3/3) y pasa vía `npm test` (5/5).** Demostrado
  **pre-existente**: falla igual con la versión de `HEAD` del archivo de tests.
  Sospecha: el cwd con letra de unidad en minúscula que produce el spawn de
  `just` con `[working-directory: 'packages/db']` hace que vitest 4 cargue dos
  instancias del módulo `vitest`. **No es de US-2 y no debe bloquearla**, pero
  significa que hoy el repo **no tiene un gate de tests invocable por `just`**.
  Es del dueño del `justfile`, no de esta US.
- **V-2 — La divergencia #9 está mal medida en `design.md` y en
  `apply-progress.md`.** Ambos afirman que el mock devolvía **0** filas para
  `name:apple;shop_id:6`; la reproducción fiel del mock devuelve **20**. El
  mecanismo descrito era correcto, la cifra no. `apply-progress.md` la propagó
  sin re-medir el lado mock (solo midió el lado Postgres). El cambio de
  comportamiento real es **20 productos de todas las tiendas → 12 de la tienda
  6**, no "0 → 12".
- **V-3 — Dos entradas malformadas producen HTTP 500 donde el mock daba 200**
  (`search=shop_id:abc`, `search=min_price:abc`). `Number(value)` sin validar
  deja pasar `NaN` a Prisma. Debería ser un 400 o ignorarse. **No corregido**
  por instrucción de esta fase. Riesgo práctico bajo (el frontend no envía
  valores no numéricos), riesgo de operación medio (500 en endpoint público).
- **V-4 — Cero cobertura automatizada del código nuevo de la API.** Los 3 tests
  añadidos están en `packages/db/src/repositories/products.integration.test.ts`
  y ejercitan `listProducts({shopId})`, `{manufacturerSlug}` y `{tagSlug}` — es
  decir, el **repositorio, que ya existía antes de US-2**. `parseProductSearch`,
  `toProductDto`, el split crudo-vs-numérico y el mapeo 503/500 —todo lo que
  este cambio realmente introduce— **no tienen ni un test**. El contrato de 20
  claves solo está protegido por la ejecución manual de este reporte. Esto
  importa especialmente porque **US-3 y US-4 van a reutilizar `toProductDto`**.

### SUGGESTION

- **V-5 — `mock.json`, la línea base del "antes", no quedó versionada ni
  archivada.** Es irrepetible sin revertir el servicio. Para US-3/US-4:
  guardar la captura del mock dentro de `openspec/changes/{change}/` antes de
  tocar código, o (mejor) derivar la línea base del JSON fuente, como hizo esta
  fase.
- **V-6 — Divergencia #3: 86 filas en el archivo, 85 en la respuesta.** El
  borrador id 454 es type 6 y Postgres lo filtra. Ajustar la cifra al archivar
  el spec.
- **V-7 — El test de `shopId` solo comprueba la primera página.**
  `listProducts({shopId})` devuelve 584 filas para el shop del seed, pero el
  test itera únicamente los 30 ítems de la página 1; no prueba que ninguna fila
  de otro shop aparezca en las páginas 2..20. Pasa por la razón correcta, pero
  cubre menos de lo que su nombre sugiere.
- **V-8 — Casos patológicos de paginación divergen** (`limit=0`, `limit=-5`,
  `name:` vacío). Ningún cliente los envía. No accionar; dejar constancia.

---

## 11. Riesgos que se arrastran a US-3 / US-4

1. **`toProductDto` se reutilizará sin red de seguridad** (V-4). US-3 lo va a
   exportar para el detalle por slug. Cualquier cambio en el mapper romperá el
   listado de forma silenciosa. **Recomendación: US-3 debería abrir con un test
   de contrato del key-set de 20 claves**, o el repo debería aceptar
   explícitamente que ese contrato se verifica a mano en cada change.
2. **No hay gate de tests ejecutable por `just`** (V-1). Mientras siga así, cada
   fase de verify tiene que descubrir el workaround por su cuenta.
3. **El detalle por slug emite 21 claves, el listado 20.** US-3 tendrá que
   decidir si unifica o mantiene dos proyecciones; `toProductDto` tal como está
   **no** sirve para el detalle sin ampliarlo.
4. **El patrón `Number(value)` sin validar** (V-3) se copiará a los parsers de
   US-3/US-4 si no se corrige antes. Vale la pena resolverlo en un change
   pequeño e independiente, no dentro de US-3.
5. **La divergencia #10 es visible para el usuario final.** Debe anunciarse
   antes de que alguien reporte "el filtro de precio cambió" como incidencia.

---

## 12. Estado del entorno al cerrar

| Ítem | Estado |
|---|---|
| `safari-postgres` | ✅ **Up (healthy)**, :5433 — dejado arriba a propósito |
| Filas en `products` | ✅ **1200** |
| `id 1` | ✅ **`Apples`** |
| Filas con `source_store` (fixtures de test) | ✅ **0** — sin residuos del vitest |
| Filas `CANARIO` | ✅ **0** — el UPDATE de CA-4 quedó revertido |
| API :9001 | ✅ 200, PID **32672** (levantada por esta fase; la heredada 27700 se cayó a mitad de sesión) |
| Shop :3003 | ✅ 200, `cards:30` (relevantado por esta fase) |
| Admin :3002 | ✅ 200 (relevantado por esta fase) |
| Working tree | ✅ los mismos 4 archivos modificados que al empezar |
| Código de producción | ✅ **sin modificar por esta fase** |
| Commits / push | ✅ **ninguno** |

Los tres servidores de desarrollo quedan corriendo. El único artefacto
temporal que esta fase escribió dentro del repo fue la restauración transitoria
del archivo de tests para el experimento de §2.1, **revertida y verificada** en
el mismo paso.

Sustitución de herramienta declarada: `jq` no está instalado en este Git Bash;
todas las comparaciones se hicieron con `node -e` (sort-deep recursivo +
`JSON.stringify`), con la misma semántica que `jq -S`. No se relajó ningún
criterio.

---

## Veredicto

### **PASS WITH WARNINGS**

**Motivo:** los cinco criterios de aceptación de US-2 y los seis requisitos del
spec se cumplen, verificados con salida real re-ejecutada por esta fase,
incluido un censo completo de las 1199 filas que no deja el contrato apoyado
solo en la página 1. El alcance se respetó estrictamente (4 archivos, ninguna
prohibición del "NO incluye" violada) y no hay regresiones en lo que quedó en
mock.

**No es un PASS limpio** por cuatro razones, ninguna de las cuales invalida la
implementación:

1. El gate declarado del proyecto (`just db-check`) **no se pudo poner en verde
   por la vía oficial** — pero se demostró que el fallo es pre-existente y
   ajeno al cambio, y los 14 tests pasan por la vía directa.
2. Una divergencia documentada (**#9**) tenía **la cifra del mock equivocada** en
   design y en apply; este reporte la corrige (0 → 20).
3. Aparecieron **dos respuestas 500 no documentadas** ante entradas malformadas,
   donde el mock respondía 200.
4. El código realmente nuevo de esta US **no tiene ni un test automatizado**, y
   US-3/US-4 van a construir encima de él.

**Recomendación:** apto para archivar y avanzar a US-3, **a condición de** que
(a) las divergencias #8, #9 (con la cifra corregida) y #10 se propaguen al spec
principal al archivar, (b) V-3 se registre como ítem de backlog y (c) el equipo
decida conscientemente si acepta seguir sin cobertura del mapper antes de que
US-3 lo reutilice.
