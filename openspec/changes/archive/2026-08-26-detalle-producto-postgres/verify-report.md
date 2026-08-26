# Verification Report: Detalle de producto y relacionados desde Postgres (US-3)

> Validación adversarial e independiente del change `detalle-producto-postgres`.
> Toda la salida de comandos de este documento fue observada por el agente
> verificador en esta sesión; nada se copió de `apply-progress.md`.
> Nada se corrigió: `sdd-verify` reporta, no implementa.

| Campo | Valor |
|---|---|
| Change | `detalle-producto-postgres` |
| Artifact store mode | `openspec` (Engram NO conectado) |
| Modo de verificación | Full spec-driven (proposal + spec + design + tasks presentes) |
| Strict TDD | `false` → no se cargó `strict-tdd-verify.md` |
| Estado del árbol | Sin commit. 6 archivos modificados + `openspec/changes/detalle-producto-postgres/` sin trackear |
| Volumen | +189 / -26 = **215 líneas** (budget 400: OK) |
| Veredicto | **PASS WITH FINDINGS** |

---

## 1. Completitud de tasks

| Fase | Tasks | Marcadas `[x]` | Verificadas por inspección | Observación |
|---|---|---|---|---|
| 1 Baseline | 2 | 2 | 2 | `mock-apples.json` existe (28 297 bytes, derivado por vía 2) |
| 2 `packages/db` | 4 | 4 | 4 | 2.2 **parcial** → ver H-2 |
| 3 Rebuild | 1 | 1 | 1 | `dist/index.js` (08:38) posterior a la fuente (08:36) y contiene el comentario D-1 |
| 4 Servicio Nest | 2 | 2 | 2 | conforme a Decisiones B y C |
| 5 Tests jest | 10 | 10 | 10 | 7 tests nuevos, todos verdes |
| 6 E2E CA-1..CA-3 | 4 | 4 | 4 | reproducidos de cero |
| 7 E2E CA-4 | 1 | 1 | 1 | reproducido de cero |
| 8 Cierre documental | 2 | 2 | 2 | 8.1 con justificación **falsa** → ver H-1 |
| **Total** | **26** | **26** | **26** | 0 tasks bloqueadas, 0 tasks sin evidencia |

**Ninguna task quedó sin marcar.** No hay CRITICAL por incompletitud.

---

## 2. Evidencia de ejecución (salida real de esta sesión)

### 2.1 `packages/db` — typecheck + vitest

```
$ cd C:/DevOps/MyGitHub/safari-marketplace/packages/db && npm run typecheck && npm test
> @safari/db@0.1.0 typecheck
> tsc --noEmit
(sin salida — 0 errores)

> @safari/db@0.1.0 test
> vitest run
 RUN  v4.1.11 C:/DevOps/MyGitHub/safari-marketplace/packages/db
 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  09:07:43
   Duration  6.92s
```

Coincide con el cross-check del orquestador: **14/14**.

### 2.2 `just db-check` — CONTRADICE al apply y al brief de la sesión

```
$ cd /c/DevOps/MyGitHub/safari-marketplace && just db-check
npm run typecheck
> @safari/db@0.1.0 typecheck
> tsc --noEmit
cd "$(pwd)" && npm test
> @safari/db@0.1.0 test
> vitest run
 RUN  v4.1.11 C:/DevOps/MyGitHub/safari-marketplace/packages/db
 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  09:26:22
   Duration  3.23s
EXIT=0
```

Ejecutado desde `/c/DevOps/...` — **la unidad en minúscula, el caso exacto que
supuestamente falla**. Está VERDE. Ver H-1.

### 2.3 `apps/api/rest` — jest

```
$ cd C:/DevOps/MyGitHub/safari-marketplace/apps/api/rest && npx jest
PASS src/products/products.service.spec.ts (92.218 s)
  ProductsService.getProducts (Postgres vía @safari/db, US-2)
    ... 13 tests ✓
  ProductsService.getProductBySlug (Postgres vía @safari/db, US-3)
    √ emite exactamente las 21 claves del detalle (20 del listado + related_products), en orden (1 ms)
    √ cada relacionado trae las 20 claves del listado y ningún related_products propio (1 ms)
    √ pasa el slug crudo al repositorio (1 ms)
    √ relatedProducts: [] → related_products: [] y sigue con las 21 claves (1 ms)
    √ slug inexistente (null) → NotFoundException 404 con el slug en el mensaje, no envuelto por el catch (D-5) (1 ms)
    √ error de conexión de Prisma → 503 con mensaje amigable (1 ms)
    √ cualquier otro error → 500 con mensaje amigable, sin crashear el proceso (2 ms)

Test Suites: 1 passed, 1 total
Tests:       20 passed, 20 total
Time:        97.091 s
```

Coincide con el cross-check del orquestador: **20/20**.

### 2.4 `just build-api` — hueco del apply, cerrado aquí

La Phase 6.1 declaró innecesario el build de producción (usó `api-dev` en watch).
Se ejecutó en esta verificación:

```
$ just build-api
yarn build
$ rimraf dist
$ nest build
Done in 124.34s.
EXIT=0
```

El compilador de producción (`tsc` vía `nest build`) acepta el servicio nuevo.

### 2.5 Cobertura

`coverage_threshold: 0` y `coverage_command: ""` en `openspec/config.yaml`.
**NO VERIFICADO por configuración**, no por omisión.

### 2.6 `just build` (shop + admin)

**NO EJECUTADO.** Motivo declarado: el propio `design.md` (nota de CA-4)
argumenta que un build de producción **enmascararía** la evidencia de CA-4 al
prerenderizar la página con ISR. Ejecutarlo habría añadido ~10 min sin aportar
señal sobre esta US, que no toca `apps/shop/**`. No se infiere un pass de ello.

---

## 3. Matriz de conformidad con el spec

Cada escenario del delta spec, contra evidencia observada en esta sesión.

| Requirement / Scenario | CA | Estado | Evidencia observada |
|---|---|---|---|
| **R1** Detalle por slug desde Postgres — *Paridad de contrato para `apples`* | CA-1 | **COMPLIANT** | §4.1 (diff `node -e` en vivo + diff profundo de valores + byte-identidad) + jest tests 1, 2, 4 |
| **R1** — *La página de producto de la tienda renderiza en 200* | CA-4 | **COMPLIANT** | §4.4 (shop 200, `<title>Pickbazar \| Apples</title>`, `pageProps.product` con 21 claves) |
| **R2** Regla de relacionados D-1 — *El producto se incluye a sí mismo, sin filtro de status* | CA-3 | **COMPLIANT** *(con matiz, ver H-3)* | §4.3 (`self incluido: true` en vivo) + vitest `findProductBySlug` con `toContain(sample.id)` + prueba SQL de que la aserción tiene dientes |
| **R3** 404 de dominio — *Slug inexistente* | CA-2 | **COMPLIANT** | §4.2 (`HTTP/1.1 404`, cuerpo Nest, `/api/types` sigue en 200) + jest test 5 |
| **R4** Errores de conexión D-5 — *Postgres caído* | (sin CA) | **COMPLIANT** | §4.5 — **escenario que el apply NUNCA ejecutó**; verificado aquí en runtime con la base parada y restaurada |

Ningún escenario queda `UNTESTED` ni `FAILING`.

---

## 4. Verificación E2E reproducida de cero

> **Nota de entorno (H-6):** el brief afirmaba que la API estaba detenida. No lo
> estaba: había un árbol `nest start --watch` huérfano (PIDs 13788→10044→41992,
> creado a las 08:53:32) escuchando en 9001. Se terminó ese árbol y se levantó una
> instancia propia (PID 26308) para que la evidencia fuera independiente. Ambos
> servidores levantados aquí quedaron detenidos al cerrar la verificación.

### 4.1 CA-1 — paridad de contrato

```
$ curl -s "http://localhost:9001/api/products/apples" > $SP/verify-pg-apples.json
$ node -e "...diff..."
raiz: 21 -> 21 | mismo orden: true
faltan: [] | sobran: []
related n: 20 | ids pg: 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20
             ids mock: 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20
items con shape malo: 0
CA-3 self incluido: true
byte-identico a pg-apples.json comiteado: true | bytes: 19722 19722
```

**La respuesta viva es byte-idéntica al `pg-apples.json` comiteado.** La evidencia
del apply es reproducible, no reconstruida.

**Verificación adicional que el design NO pedía — diff PROFUNDO de valores.**
El `node -e` del `design.md` sólo compara nombres/orden de claves e ids de related;
no compara los VALORES de los 20 campos. Se hizo el diff recursivo completo:

```
--- DIFERENCIAS DE VALOR EN EL OBJETO RAIZ (0) ---
--- DIFERENCIAS DE VALOR EN related_products (1) ---
related[1].in_flash_sale : mock=1  pg=0
```

El objeto raíz es **100 % idéntico valor a valor**. La única divergencia en todo
el payload es `in_flash_sale`, heredada de US-2 y ya declarada en
`design.md` ("Divergencia heredada del listado, NO regresion: in_flash_sale
siempre 0"). **CA-1 es más fuerte de lo que su propia evidencia documentaba.**

### 4.2 CA-2 — 404 de dominio

```
$ curl -i -s http://localhost:9001/api/products/no-existe-xyz | head -1
HTTP/1.1 404 Not Found
$ curl -s http://localhost:9001/api/products/no-existe-xyz
{"statusCode":404,"message":"No existe un producto con slug `no-existe-xyz`.","error":"Not Found"}
$ curl -s -o /dev/null -w 'types=%{http_code}\n'    http://localhost:9001/api/types
types=200
$ curl -s -o /dev/null -w 'products=%{http_code}\n' "http://localhost:9001/api/products?limit=5"
products=200
```

Casos límite adicionales, todos correctos:

```
GET /api/products/Apples                      -> 404   (slug case-sensitive)
GET /api/products/<slug de 500 caracteres>    -> 404   (sin crash)
GET /api/products                             -> 200   (la ruta ':slug' no captura el listado)
GET /api/products/apples?language=en&with=... -> 200   (query heredada ignorada, como antes)
```

### 4.3 CA-3 — regla D-1 observable

```
$ node -e "...self..."
CA-3 self incluido: true
```

**Prueba de que la aserción de D-3 tiene dientes (empírica, no razonada).**
El `where` ANTERIOR y el NUEVO, ejecutados como SQL contra la base real para
`type_id = 1`, `id = 1` (`apples`):

```
-- WHERE ANTERIOR (id <> 1 AND status='publish' AND visibility='visibility_public')
2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,181
-- WHERE NUEVO ({ typeId })
1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20
```

`expect(ids).toContain(sample.id)` **fallaría** contra el código pre-cambio. Y
`sample` es determinista: `listProducts` ordena `orderBy: { id: 'asc' }`
(`products.repository.ts:213`), así que `items[0]` es siempre id 1.

**Paridad de la regla extendida a TODO el catálogo, no sólo a `apples`.**
Se comparó, para los 1200 productos, el `related` del mock
(`mock.filter(p => p.type.slug === x.type.slug).slice(0,20)`) contra el de Postgres
(primeros 20 ids ascendentes del mismo `type_id`):

```
mock products: 1200 | pg products: 1200
slugs del mock sin fila en PG: 0
slugs con related DIFERENTE (mock vs PG): 0
tamano por type (type_id:count): [["4",15],["11",31],["9",44],["6",55],["5",64],
                                  ["8",67],["2",72],["3",81],["7",335],["1",436]]
```

**0 divergencias en 1200 slugs.** La equivalencia "orden del JSON == id ascendente"
que asume el código se sostiene en todo el catálogo.

**Edge case — type con menos de 20 productos** (`bags`, `type_id = 4`, 15 filas):

```
$ curl -s http://localhost:9001/api/products/armani-leather-purse
claves raiz: 21 | id: 102 | type: bags
related n: 15 | ids: 102,103,104,105,106,107,108,109,112,115,123,125,127,129,131
self incluido: true
mock related n: 15 | ids: 102,103,104,105,106,107,108,109,112,115,123,125,127,129,131
paridad ids: true
```

**Edge case — producto FUERA de los 20 primeros de su type** (`signature-salmon`,
id 181, type `grocery`):

```
id: 181 slug: signature-salmon type: grocery
related n: 20 ids: 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20
SELF INCLUIDO: false
```

Comportamiento **correcto** (idéntico al mock) pero **contradice la letra del
requirement** del spec. Ver H-3.

**Consecuencia latente de `draft` — confirmada como no observable:**

```
$ SELECT id, slug, type_id, status FROM products WHERE status <> 'publish' OR visibility <> 'visibility_public';
454|arlo-bedside-table|6|draft|visibility_public
$ -- primeros 20 ids del type 6
412,413,414,415,416,417,418,419,420,421,422,423,424,425,426,427,428,429,430,431
```

Exactamente lo que declara el spec: una sola fila `draft`, fuera de rango.
Además, el detalle directo de ese `draft` responde 200 — pero el mock hacía lo
mismo (`this.products.find(...)` sin filtro de status), así que **es paridad, no
regresión**:

```
detalle draft arlo-bedside-table = 200
el mock tambien lo tenia (status/visibility): draft/visibility_public
```

### 4.4 CA-4 — página de producto de la tienda

```
$ curl -s -o $SP/shop-apples.html -w 'HTTP=%{http_code} bytes=%{size_download}\n' \
    http://localhost:3003/en/products/apples
HTTP=200 bytes=110320
$ grep -c 'Apples' $SP/shop-apples.html
1
$ grep -o '<title>[^<]*</title>' $SP/shop-apples.html
<title>Pickbazar | Apples</title>
$ grep -c 'This page could not be found' $SP/shop-apples.html
0
```

Payload SSR de `__NEXT_DATA__` (**precisión sobre el cross-check del
orquestador**: el producto NO está en `dehydratedState` — ahí sólo va la query
`/settings` — sino en `pageProps.product`; el dato es el mismo, la ubicación no):

```
pageProps keys: ["product","_nextI18Next","dehydratedState"]
product.name: Apples slug: apples id: 1
claves: 21 ["id","name","slug","type","language","translated_languages","product_type",
            "shop","sale_price","max_price","min_price","image","status","price",
            "quantity","unit","sku","sold_quantity","in_flash_sale","visibility",
            "related_products"]
related n: 20
related ids: 1,...,20 | self: true
```

Comportamiento de la tienda con el 404 nuevo (no lo pedía ninguna CA):

```
shop /en/products/no-existe-xyz          = 404
shop /en/products/armani-leather-purse   = 200
```

### 4.5 D-5 — Postgres caído → 503 (escenario NO ejecutado por el apply)

```
$ docker compose stop postgres
 Container safari-postgres  Stopped

$ curl -s -i http://localhost:9001/api/products/apples | head -1
HTTP/1.1 503 Service Unavailable
$ curl -s http://localhost:9001/api/products/apples
{"statusCode":503,"message":"No se puede conectar con el servicio. Por favor, intenta más tarde.","error":"Service Unavailable"}
$ curl -s http://localhost:9001/api/products/no-existe-xyz
{"statusCode":503,"message":"No se puede conectar con el servicio. Por favor, intenta más tarde.","error":"Service Unavailable"}
$ curl -s "http://localhost:9001/api/products?limit=2"
{"statusCode":503,"message":"No se puede conectar con el servicio. Por favor, intenta más tarde.","error":"Service Unavailable"}

$ docker compose start postgres
 Container safari-postgres  Started
postgres listo (poll=1)

$ curl -s http://localhost:9001/api/products/no-existe-xyz
{"statusCode":404,"message":"No existe un producto con slug `no-existe-xyz`.","error":"Not Found"}
$ curl -s -o /dev/null -w 'detalle apples = %{http_code}\n'  http://localhost:9001/api/products/apples
detalle apples = 200
$ curl -s -o /dev/null -w 'listado = %{http_code}\n' "http://localhost:9001/api/products?limit=2"
listado = 200
```

Se cumplen las dos mitades del escenario: 503 con la base caída, **y** 404 con la
base viva pese a compartir el mismo `try/catch`. La base quedó restaurada
(`safari-postgres Up (healthy)`), sin borrar el volumen.

---

## 5. Coherencia con el design (D-1..D-6, Decisiones A/B/C)

| Decisión | Lo que exige | Estado | Verificación |
|---|---|---|---|
| **D-1 / Decisión A** — `where = { typeId }` | borrar `id:{not}`, `status`, `visibility`; conservar `orderBy id asc` y `take relatedLimit`; comentario que cite D-1 | **CONFORME** | `products.repository.ts:236-248`. `where: { typeId: row.typeId }`, comentario D-1 presente con el texto del design, `orderBy: { id: 'asc' }`, `take: relatedLimit` |
| **D-2** — sin parámetros nuevos | firma pública intacta; barrel sin tocar | **CONFORME** | `findProductBySlug(slug: string, relatedLimit = 20)` sin cambios; `packages/db/index.ts` no aparece en `git status` |
| **`relatedLimit` default 20** | 20 en todas partes | **CONFORME** | `grep -rn relatedLimit` → 3 apariciones: JSDoc:225, firma `= 20` (:229), `take:` (:247). Único llamador (Nest) no lo pasa → default 20 |
| **D-3** — la aserción de exclusión se BORRA, no se relaja | `expect(rel.id).not.toBe(sample.id)` eliminada; aserciones nuevas con dientes | **CONFORME** | El diff **elimina** la línea. Las nuevas: `toContain(sample.id)` (**tiene dientes**, probado en §4.3), orden ascendente, `length<=20`, `type.slug`. El `it` de slug inexistente no se tocó |
| **D-4** — 404 de dominio | `NotFoundException`, cuerpo default de Nest, mensaje en español, sin `ExceptionFilter` | **CONFORME** | `grep -rn "ExceptionFilter\|useGlobalFilters" apps/api/rest/src` → **0 resultados**. Cuerpo real verificado en §4.2 |
| **D-5 / Decisión B** — el `throw` FUERA del `try` | el `catch` no puede convertir el 404 en 500 | **CONFORME — verificado en el código y en runtime** | `products.service.ts:213-238`: el `try` envuelve **exclusivamente** `detail = await findProductBySlug(slug)`; el `catch` sólo tiene las dos ramas 503/500; el `if (!detail) throw new NotFoundException(...)` está **después** del bloque, sin `instanceof HttpException` en el catch. Refrendado por §4.5 y por el jest test `not.toBeInstanceOf(InternalServerErrorException)` |
| **D-6 / Decisión C** — `related_products` es la clave 21 sólo del raíz | `toProductDto` intacto; relacionados sin `related_products` propio; sin `products.mapper.ts` | **CONFORME** | `toProductDto` no aparece en el diff; su literal de 20 claves **no incluye** `relatedProducts`, así que el spread no lo filtra por accidente. `ls apps/api/rest/src/products/` → no existe `products.mapper.ts`. En vivo: `items con shape malo: 0` |

**Cero desviaciones de diseño en el código.** Las tres desviaciones que
`apply-progress.md` declara son de procedimiento (`just db-check` sustituido,
`build-api` diferido, `pg-apples.json` extra), no de arquitectura — y dos de ellas
quedan cerradas por esta verificación (§2.2 y §2.4).

---

## 6. Disciplina de alcance

```
$ git status --porcelain
 M apps/api/rest/src/products/products.service.spec.ts
 M apps/api/rest/src/products/products.service.ts
 M docs/product/1-catalogo-desde-postgres/3-detalle-producto-postgres.md
 M docs/product/1-catalogo-desde-postgres/README.md
 M packages/db/src/repositories/products.integration.test.ts
 M packages/db/src/repositories/products.repository.ts
?? openspec/changes/detalle-producto-postgres/

$ git diff --numstat
129  0  apps/api/rest/src/products/products.service.spec.ts
 25  8  apps/api/rest/src/products/products.service.ts
 20  6  docs/product/1-catalogo-desde-postgres/3-detalle-producto-postgres.md
  1  1  docs/product/1-catalogo-desde-postgres/README.md
  6  4  packages/db/src/repositories/products.integration.test.ts
  8  7  packages/db/src/repositories/products.repository.ts
```

- **Cero cambios en `apps/shop/**`.** El "NO incluye" de la US se respetó.
- Cero cambios en `products.controller.ts`, `packages/db/index.ts`, `db/schema.sql`,
  `db/seed.sql`, `justfile`, `docker-compose.yml`, `services/scraper-worker/**`.
- Los 6 archivos modificados están todos en la tabla *File Changes* del design.
- `pg-apples.json` es el único artefacto fuera de esa tabla; es evidencia (salida
  del `curl` de la task 6.2), no código, y el apply lo declaró.
- 215 líneas frente a las ~150 pronosticadas (+43 %). Sigue holgadamente bajo el
  budget de 400; no se justifica trocear.

---

## 7. Superficie de regresión (US-2, `toProductDto()` compartido)

`GET /api/products` comparte el mapper con el detalle. Verificado en vivo:

```
listing total: 1199 | data n: 20 | claves item[0]: 20
mismas claves listado vs related: true
mismos VALORES listado vs related (apples): true
mismas claves listado vs raiz del detalle: true
mismos VALORES listado vs raiz del detalle: true
claves de paginacion: ["data","total","current_page","count","last_page","firstItem",
                       "lastItem","per_page","first_page_url","last_page_url",
                       "next_page_url","prev_page_url"]
```

El mismo producto, servido por tres caminos distintos (listado, raíz del detalle,
elemento de `related_products`), es **idéntico valor a valor**.

**¿Bastan los 13 tests jest previos?** Para el mapper compartido, **sí**: cubren el
key-set exacto, el anidamiento `type`/`shop`, las constantes y la traducción
camelCase→snake_case. Y la mitigación R-2 funciona de verdad: ambos `describe`
comparten `EXPECTED_KEYS` en el mismo archivo, así que un cambio en la proyección
del listado revienta también los tests del detalle. **Lo que NO cubren** es que
nada de esto corre en CI — no existe gate repo-wide (US-10, Épico 9). Hoy la red
depende de que alguien ejecute `just db-check` y `npx jest` a mano. Eso es una
deuda del repo, no de esta US.

---

## 8. Issues

### CRITICAL

Ninguno.

### WARNING

#### H-1 — La justificación del DoD sobre `just db-check` es FALSA: el comando está VERDE

- **Dónde:** `docs/product/1-catalogo-desde-postgres/3-detalle-producto-postgres.md:80-85`
- **Qué afirma:** marca `[x]` "Salida real de `just db-check` en verde" acompañado
  de *"**Desviación conocida de esta máquina**: `just db-check` da falso-rojo por el
  casing de la unidad del cwd en Windows"* y sustituye la evidencia por
  `cd packages/db && npm run typecheck && npm test`.
- **Realidad observada:** `just db-check` ejecutado desde `/c/DevOps/...`
  (unidad en **minúscula**, el caso que supuestamente falla) →
  `Tests 14 passed (14)`, `EXIT=0`. Salida completa en §2.2.
- **Causa raíz:** el bug **ya estaba corregido en HEAD**. El commit `083d8e9`
  ("Normaliza el cwd en db-check para que vitest encuentre las suites", el commit
  inmediatamente anterior a este change) cambió `justfile:333` de `npm test` a
  `cd "$(pwd)" && npm test`.
- **Propagación de la premisa obsoleta:** `openspec/config.yaml` (comentarios de
  `testing` y de `rules.verify`), `design.md` §Verification Plan,
  `tasks.md:39`, `apply-progress.md` §Desviaciones, y el brief de esta sesión.
  Ninguno de los cinco lo re-verificó contra el `justfile` real.
- **Impacto:** el código está intacto y la evidencia sustituta es equivalente. El
  daño es documental: una DoD cerrada con una excusa en lugar de con la salida que
  pedía, y una creencia falsa que se propagará a US-4 y siguientes.
- **Acción sugerida (del usuario, no del equipo):** reescribir ese ítem de la DoD
  con la salida verde real, y purgar la nota del `config.yaml` y de la memoria
  `vitest-falla-con-unidad-en-minuscula` (marcarla como resuelta por `083d8e9`).

#### H-2 — JSDoc obsoleto sobrevivió al cambio: `findProductBySlug` sigue diciendo "visibles"

- **Dónde:** `packages/db/src/repositories/products.repository.ts:223-226`

  ```ts
  /**
   * Detalle por slug, con relaciones cargadas y `relatedProducts` (mismo
   * type, visibles, hasta `relatedLimit`). `null` si no existe.
   */
  ```

- **Esperado vs. real:** la task 2.2 actualizó **sólo** el comentario de
  `ProductDetail.relatedProducts` (línea 103). El JSDoc de la propia función quedó
  intacto y ahora afirma lo contrario del código: tras borrar `status` y
  `visibility` del `where`, `relatedProducts` **no** está filtrado por visibilidad.
- **Verificación:** `grep -rn "excluyendo el propio\|visibles, hasta"` sobre
  `packages/db/src`, `db/`, `apps/api/rest/src` y `CLAUDE.md` → **1 único
  resultado**, esta línea.
- **Por qué importa:** es literalmente el riesgo **R-1** del proposal
  ("D-2 degrada el repositorio a una regla peor y una US futura la reintroduce sin
  darse cuenta"). El comentario D-1 de 6 líneas que sí se añadió está 18 líneas más
  abajo; quien lea sólo el JSDoc de la firma recibe la información equivocada.
- **Corrección de una línea, no accionada aquí** (`sdd-verify` no implementa).

#### H-3 — El requirement del spec sobre-afirma la auto-inclusión: 1005 de 1200 productos (83,75 %) NO se incluyen a sí mismos

- **Dónde:** `openspec/changes/detalle-producto-postgres/specs/product-detail-api/spec.md:35-37`
- **Texto normativo:** *"`findProductBySlug()` **MUST** resolver `related_products`
  con: mismo `type_id`, `ORDER BY id ASC`, `LIMIT 20`, **incluyendo el producto
  consultado**"*.
- **Contraejemplo real:** `GET /api/products/signature-salmon` (id 181, type
  `grocery`) → `related_products` = ids `1..20`, **self NO incluido** (§4.3).
  Leído como un MUST absoluto, este producto lo viola.
- **Alcance del problema:** medido sobre el catálogo completo, **1005 de 1200
  slugs** (83,75 %) caen en el caso sin auto-inclusión. Sólo 195 (= Σ min(20,
  tamaño del type)) se auto-incluyen.
- **El código NO está mal.** La paridad con el mock es exacta para los 1200 slugs
  (0 divergencias, §4.3). El mock hace exactamente lo mismo.
- **Lo que sí está mal es la prosa:** la tabla de consecuencias y el escenario
  Gherkin **sí** acotan correctamente ("*si su id está entre los 20 primeros de su
  type*"), pero la frase normativa —la que un lector futuro citará— no lleva esa
  condición.
- **Por qué importa ahora:** esta frase se fusiona tal cual en
  `openspec/specs/product-detail-api/spec.md` al archivar. Es el documento que
  leerá quien evalúe un futuro reporte de "bug". Conviene corregirla **antes** de
  `sdd-archive`, p. ej.: *"…LIMIT 20 — lo que implica que el producto consultado
  aparece en su propio `related_products` **si y sólo si** su id está entre los 20
  primeros de su type"*.

### SUGGESTION

#### H-4 — El comentario D-1 apunta a un archivo que todavía no existe

`products.repository.ts:243` dice *"Ver `openspec/specs/product-detail-api/spec.md`
antes de 'arreglarlo'"*. Hoy `openspec/specs/` sólo contiene `product-listing-api/`;
la ruta sólo se resuelve después de `sdd-archive`. Mientras el change no se archive
—y no lo está, ni siquiera commiteado— el puntero anti-regresión más importante del
cambio es una referencia colgante. Es autoresoluble al archivar; sólo hay que
asegurarse de que el archive se ejecute.

#### H-5 — El 404 refleja la entrada del usuario sin sanear ni acotar

```
$ curl -s 'http://localhost:9001/api/products/%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E'
{"statusCode":404,"message":"No existe un producto con slug `<img src=x onerror=alert(1)>`.","error":"Not Found"}
$ curl -s 'http://localhost:9001/api/products/a%22b%60c'
{"statusCode":404,"message":"No existe un producto con slug `a\"b`c`.","error":"Not Found"}
```

`Content-Type: application/json; charset=utf-8` y las comillas van JSON-escapadas,
así que **no hay XSS ni inyección de JSON** para un consumidor correcto: riesgo
real bajo. Pero es una superficie reflejada sin límite de longitud (un slug de 500
caracteres se devuelve entero). Si algún cliente llegara a renderizar `message`
como HTML, se convierte en vector. Como D-4 declara que este 404 "**establece el
patrón que copiarán US-4 y siguientes**", vale la pena decidir ahora si el mensaje
debe truncar/omitir el eco del slug. **No es un blocker de esta US.**

#### H-6 — El proceso de la API del orquestador seguía vivo, contradiciendo el brief

El brief de la sesión afirmaba *"The API (9001) and the shop (3003) are STOPPED"*.
Al levantar la API se detectó un árbol `nest start --watch` huérfano
(13788 → 10044 → 41992, creado a las 08:53:32) ocupando el 9001. Se terminó y se
levantó una instancia propia para garantizar la independencia de la evidencia.
Nota de higiene: un dev server huérfano que sigue sirviendo `dist/main` puede hacer
que una verificación posterior "pase" contra código viejo sin que nadie lo note.

#### H-7 — Volumen real 215 líneas frente a las ~150 pronosticadas (+43 %)

`tasks.md` estimó ~150; el diff real es +189/-26 = 215. La desviación viene del
bloque jest (129 añadidas frente a ~80 previstas) y de la DoD documental (20 frente
a ~10). Sigue muy por debajo del budget de 400 y no cambia la estrategia de entrega
(PR único). Se anota sólo para calibrar futuros forecasts.

---

## 9. Reconciliación con el cross-check del orquestador

| Comprobación del orquestador | Mi resultado | ¿Coincide? |
|---|---|---|
| `packages/db`: typecheck limpio, `14 passed (14)` | idéntico | Sí |
| `apps/api/rest`: jest `20 passed, 20 total` | idéntico | Sí |
| CA-1: `21 -> 21`, orden `true`, `faltan/sobran []`, ids `1..20`, 0 malformados | idéntico | Sí |
| CA-2: `HTTP/1.1 404` + cuerpo Nest; `/api/types` 200 después | idéntico | Sí |
| CA-3: `self incluido: true` | idéntico | Sí |
| CA-4: 200, `<title>Pickbazar \| Apples`, `product.name: Apples`, 20 related | idéntico **en el dato** | Sí, con una precisión |
| Respuesta viva byte-idéntica a `pg-apples.json` | confirmado (`Buffer.compare === 0`, 19 722 bytes) | Sí |

**Precisión sobre CA-4 (no es una contradicción, es una localización):** el
orquestador situó el producto "en el payload de `__NEXT_DATA__`". Es cierto en
sentido amplio, pero conviene precisarlo para quien reproduzca: en
`dehydratedState.queries` sólo hay **una** query (`/settings`); el producto viaja
en `props.pageProps.product`. Buscarlo en la caché de react-query devuelve
`undefined` y puede leerse como un fallo que no existe.

**Única contradicción de fondo con el material recibido:** el brief afirmaba que
`just db-check` es *"reproducibly RED here"*. **No lo es** (§2.2, H-1). Y el brief
afirmaba que la API estaba detenida; **no lo estaba** (H-6).

---

## 10. Comprobaciones NO realizadas (declaradas, no inferidas)

| Comprobación | Motivo |
|---|---|
| `just build` (shop + admin) | El design argumenta que un build de producción enmascara CA-4 (ISR prerenderizado). Esta US no toca `apps/shop/**`. NO EJECUTADO — no se infiere pass |
| Cobertura de código | `coverage_command: ""`, `coverage_threshold: 0` en `openspec/config.yaml` |
| `just verify` (los 3 servicios) | Requiere además el admin (3002), que no forma parte de esta US y no estaba levantado |
| `just db-test` (scraper) | Roto de base en el repo (tabla `productos` inexistente, US-6). Ajeno a este change |
| Linter (`biome`) sobre los archivos tocados | No está en `rules.verify`; `npm run typecheck` sí se ejecutó y está limpio |

---

## Veredicto: **PASS WITH FINDINGS**

### Matriz por criterio de aceptación

| CA | Descripción | Evidencia | Estado |
|---|---|---|---|
| **CA-1** | Detalle por slug con paridad de contrato | `curl` en vivo + diff de claves + **diff profundo de valores (raíz 100 % idéntica)** + byte-identidad con la evidencia comiteada + jest tests 1/2/4 (20/20) | **PASS — evidencia más fuerte de lo exigido** |
| **CA-2** | 404 de dominio | `HTTP/1.1 404` + cuerpo Nest en español + proceso vivo + 4 casos límite + jest test 5 | **PASS** |
| **CA-3** | Relacionados desde la base (regla D-1) | `self incluido: true` en vivo + vitest 14/14 con aserción **probada con dientes** vía SQL + **paridad de la regla en los 1200 slugs** + 2 edge cases | **PASS** — el texto del requirement necesita un ajuste (H-3), la implementación no |
| **CA-4** | Página `/products/{slug}` navegable | Shop 200, `<title>Pickbazar \| Apples</title>`, `pageProps.product` con 21 claves y 20 related, 0 coincidencias de "This page could not be found", 404 limpio para slug inexistente | **PASS** |
| *(D-5, sin CA)* | 503/500 sin tragarse el 404 | `docker compose stop postgres` → 503 real; base restaurada → 404 real. **Escenario que el apply nunca ejecutó** | **PASS** |

**Por qué PASS y no PASS a secas:** las cuatro CA y los cuatro requirements del
spec están cubiertos por evidencia de runtime que observé personalmente, y el
código no se desvía del design en ningún punto. Los tres WARNING son de
**documentación**: una DoD cerrada con una justificación falsa (H-1), un JSDoc que
afirma lo contrario del código (H-2) y un requirement cuya frase normativa
sobre-afirma respecto de su propio escenario (H-3). Ninguno bloquea, los tres
deberían corregirse antes de `sdd-archive` — H-3 en particular, porque esa frase
se fusiona tal cual en `openspec/specs/` y es la que gobernará la interpretación
futura de la divergencia D-1.

**Listo para `sdd-archive`** una vez atendidos H-1, H-2 y H-3 (o aceptados
explícitamente por el usuario). El árbol de trabajo sigue **sin commitear**, como
pedía la regla de la sesión.

### Estado del entorno al cerrar

| Recurso | Estado |
|---|---|
| Postgres (5433) | `safari-postgres Up (healthy)` — parado y restaurado durante §4.5, volumen intacto |
| API (9001) | **Detenida.** Se terminó el proceso huérfano del orquestador y también la instancia propia |
| Shop (3003) | **Detenida.** Instancia propia terminada |
| `apps/api/rest/dist/` | Reconstruido por `just build-api` (§2.4) |
| Working tree | Sin cambios respecto al inicio de la verificación: los mismos 6 archivos modificados |
