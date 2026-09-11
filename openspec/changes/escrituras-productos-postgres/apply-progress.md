# Apply Progress: Escrituras de productos con categorías y tags (US-29)

> Mode: Standard (strict_tdd: false). Chain strategy: stacked-to-main, 4-PR
> chain. Este documento cubre **PR#1 (Phase 1, tasks 1.1–1.12)**, **PR#2
> (Phase 2, tasks 2.1–2.5)**, **PR#3 (Phase 3, tasks 3.1–3.7 — capa API, US
> releasable aquí)** y **PR#4 (Phase 4, tasks 4.1–4.5 — unit tests de la
> capa API, con un GATE abierto — ver abajo)** — cuarto batch de
> `sdd-apply`, fusionado sobre el documento de PR#1/PR#2/PR#3 (Merge
> Protocol: ninguna tarea previa se pierde).

## GATE ABIERTO — PR#4 descubre un defecto genuino en `products.service.ts` (PR#3), fuera de alcance de este batch

**No se corrigió.** El alcance de este batch está limitado por contrato a
`products.service.spec.ts`; el defecto vive en `products.service.ts`
(archivo de PR#3, prohibido tocar aquí). Se documenta con evidencia real,
tal como exige el protocolo ("un defecto real encontrado en esta etapa es
información valiosa, no un obstáculo") — el test NO se debilitó, NO se
borró, NO se marcó `.skip`.

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

El mismo patrón (`!== undefined` sin distinguir `null`) está DUPLICADO en
`update()` (`:487-488`) — no se escribió un segundo test rojo para no
duplicar la misma evidencia, pero el defecto es idéntico ahí.

### Por qué no se corrigió aquí

El contrato de este batch (recibido del orquestador) es explícito: *"Touch
ONLY `products.service.spec.ts`... Do NOT modify the service, controller,
DTO... If a test reveals a genuine defect in PR#3's service code, STOP and
report it rather than fixing it here or weakening the test."* `git status
--short` tras este batch confirma que solo `products.service.spec.ts` (+
`tasks.md`) cambiaron.

### Corrección propuesta (NO aplicada, fuera de alcance)

En ambos sitios (`:188-189` de `create()`, `:487-488` de `update()`):

```ts
...(createProductDto.manufacturer_id !== undefined && {
  manufacturerId:
    createProductDto.manufacturer_id === null
      ? null
      : Number(createProductDto.manufacturer_id),
}),
```

2 líneas por sitio, 4 líneas en total. Requiere autorización explícita del
orquestador/mantenedor para tocar `products.service.ts` (fuera del alcance
autorizado de PR#4) — no se decide unilateralmente aquí.

### Impacto en la Definición de Done de este batch

`cd apps/api/rest && npx jest`: **203/204 en verde, 1 en rojo** — el rojo es
el hallazgo de arriba, no un flake ni un test mal escrito. Ver evidencia
completa en § Verification Evidence (PR#4) abajo.

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
      404); `manufacturer_id: null` explícito → **hallazgo real**, ver §
      GATE ABIERTO arriba.
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
- [ ] 4.5 — Verificación: **NO verde**. `npx jest` → 9 suites (1 failed, 8
      passed), 204 tests (1 failed, 203 passed). El fallo es el hallazgo de
      § GATE ABIERTO — no un defecto de este archivo. El archivo no
      desborda el forecast (~650 líneas): +387 líneas reales
      (`git diff --stat`). Ver evidencia completa abajo.

### Deviations from Design (PR#4)

Ninguna decisión de diseño se contradijo. El único desvío es el hallazgo ya
descrito (§ GATE ABIERTO) — no es un desvío de diseño sino un defecto de
implementación de PR#3 que el design (`R29-7`) ya anticipaba como riesgo y
que este batch confirma empíricamente.

### Files Changed (PR#4)

| File | Action | Δ líneas (`git diff --stat`) | Qué se hizo |
|---|---|---|---|
| `apps/api/rest/src/products/products.service.spec.ts` | Modified | +387 / -0 | 6 `describe` nuevos (`create`, guard de id de `update`/`remove`, matriz de roles CA-5 ×3 rutas, `PUT` que mueve `shop_id`, mapeo de errores de dominio), imports ampliados, helpers `makeUser`/`makeCreateDto`/`makeUpdateDto`. Los 20 `it` de lectura preexistentes, intactos |
| **Total** | | **+387** | Bajo el techo forecast de PR#4 (~650) |

### Issues Found (PR#4)

Uno, no bloqueante para ESTE batch pero sí para el cierre verde de la DoD:
ver § GATE ABIERTO arriba (defecto genuino en `products.service.ts`,
`manufacturer_id: null` → `Number(null) === 0`).

### Verification Evidence (real output) — PR#4

#### `cd apps/api/rest && npx jest products.service.spec.ts` (solo el archivo tocado)

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

#### `cd apps/api/rest && npx jest` (suite completa, las 9)

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

**Conteo real reportado, no el "4 suites / 65 tests" obsoleto de
`CLAUDE.md`** (sin corregir ese archivo — fuera de alcance): son **9
suites / 204 tests**, de los cuales 203 pasan y 1 falla por el hallazgo
documentado arriba.

### Workload / PR Boundary (PR#4)

- Mode: chained PR slice (`stacked-to-main`, 4-PR chain).
- Current work unit: **Unit 4 — `products.service.spec.ts`** (tasks
  4.1–4.5).
- Boundary: empieza sobre PR#3 ya aplicado (`npx jest` 173/173 verde).
  Termina en 203/204 — **NO verde** — por el hallazgo de § GATE ABIERTO,
  que requiere una decisión del orquestador/mantenedor (autorizar tocar
  `products.service.ts` fuera del alcance de este batch, o dejar el rojo
  documentado a la espera de un fix dedicado) antes de que Phase 5 (cierre
  de la DoD) pueda declarar la suite verde.
- Estimated review budget impact: +387 líneas (`git diff --stat`, 1
  archivo), bajo el techo forecast de PR#4 (~650).

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

- [ ] 4.5 — Verificación de PR#4: bloqueada por el GATE ABIERTO (defecto
      genuino en `products.service.ts`, fuera de alcance de PR#4 — ver
      arriba). Requiere decisión del orquestador/mantenedor.
- [ ] 5.1–5.10 — Cierre de la DoD (evidencia, todo PR). **No debería
      arrancar** hasta resolver el GATE ABIERTO de PR#4: `just verify` y la
      secuencia de `curl` de la Fase 5 pueden reproducir el mismo defecto de
      `manufacturer_id: null` si algún escenario lo ejercita.

## Status

28/33 tasks complete (Phase 1 + Phase 2 + Phase 3 completas; Phase 4 con
4.1–4.4 completas y **4.5 bloqueada por un GATE ABIERTO** — un defecto
genuino descubierto en `products.service.ts`, PR#3, fuera del alcance
autorizado de `products.service.spec.ts`). `just db-check` verde de forma
reproducible tanto al cierre de PR#1 (171/171, 3 corridas) como al cierre de
PR#2 (186/186, 3 corridas); PR#3 cierra con `just build-api` limpio,
`npx jest` sin regresión (173/173), secuencia HTTP real completa con token
`store_owner` (login real, sin fabricar), diff de 20 claves confirmado y
`just verify` verde (API+shop+admin), evidencia real pegada en sus
respectivas secciones. PR#4 añade 387 líneas de tests nuevos a
`products.service.spec.ts` (dentro del forecast ~650); `npx jest` corre
**203/204 en verde, 1 en rojo** — el rojo prueba, con evidencia real, que
`manufacturer_id: null` explícito se convierte en `Number(null) === 0` en
`create()`/`update()` de `products.service.ts` en vez de preservarse como
`null` (`R29-7`). El test NO se debilitó ni se borró; el fix (2 líneas por
sitio) NO se aplicó porque está fuera del alcance autorizado de este batch.
**US-29 sigue siendo releasable desde PR#3** (Phase 3 es el corte
"releasable aquí" del roll-up de `tasks.md`) — este hallazgo es sobre un
caso de borde (`manufacturer_id: null` explícito) que no bloquea el camino
feliz ya verificado con `curl` real en PR#3. Bloqueado para: (a) cerrar
formalmente Phase 4 (4.5) y (b) arrancar Phase 5, en espera de que el
orquestador decida si autoriza el fix de 4 líneas en `products.service.ts`
o si se abre un defecto/US dedicado.
