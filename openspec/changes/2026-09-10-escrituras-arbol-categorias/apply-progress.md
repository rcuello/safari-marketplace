# Apply Progress: Escrituras del árbol de categorías (US-28)

## Batch 2 — PR#2 (`apps/api/rest`), branch `us-28-pr2-api-categorias`

**Mode**: Standard (strict_tdd: false)
**Base**: `us-28-pr1-db-categorias` (3 commits, gate-approved, `just db-check`
161/161). Rama nueva `us-28-pr2-api-categorias` creada **encima** de esa rama
(`stacked-to-main`), nunca de `main`.
**Scope**: Phase 3 + Phase 4 de `tasks.md` únicamente. Phase 5
(`categories.service.spec.ts`) y Phase 6 quedan explícitamente fuera — son
PR#3, bajo una decisión de producto pendiente, y esta corrida no las tocó.

### Completed Tasks

- [x] 3.1 `apps/api/rest/src/categories/dto/create-category.dto.ts`: quitados
      `'type'`/`'parent'` del `PickType`; añadidos `type_id: number`,
      `parent?: number | null`, `slug?: string` standalone. Sin efecto de
      runtime (`main.ts:9` sin `transform`/`whitelist`). `category.entity.ts`
      no tocado.
- [x] 3.2 `categories.service.ts` — `create(createCategoryDto)` migrado:
      proyección campo a campo a `CreateCategoryInput`, `typeId:
      Number(createCategoryDto.type_id)`, spread condicional de `parent`
      (`=== null ? null : Number(...)`, solo si `!== undefined`),
      `createCategory(input)` → `toCategoryDto(node)`, `catch { throw
      toWriteHttpException(error) }`.
- [x] 3.3 `update(id, updateCategoryDto)` migrado: guarda
      `!Number.isInteger(id)` → `NotFoundException` antes del repositorio
      (precedente `types.service.ts:126-128`); **ambos** spreads de
      `type_id`/`parent` condicionales por separado (DD28-10) — un campo
      ausente en el body nunca sobreescribe el valor actual.
- [x] 3.4 `remove(id)` migrado: misma guarda de id entero, `deleteCategory(id)`
      → `toCategoryDto(node)`, mismo `catch`.
- [x] 3.5 Eliminados de `categories.service.ts`: `import Fuse from 'fuse.js'`,
      `import categoriesJson from '@db/categories.json'`, `import {
      plainToClass } from 'class-transformer'`, las constantes de módulo
      `categories`/`options`/`fuse`, y el campo `private categories:
      Category[]`. `getCategories`/`getCategory`/`toCategoryDto`/
      `parseCategorySearch` **intactos** (no se tocó ni una línea de esas
      funciones).
- [x] 4.1 `just db-build` → `just build-api` limpio → `grep -n
      "fuse\|@db/" categories.service.ts` → **1 coincidencia**, no 0 (ver
      "Issues Found": es una mención en prosa dentro del docstring de
      `parseCategorySearch`, preexistente, en una función que 3.5
      explícitamente prohíbe tocar).
- [x] 4.2 Secuencia completa `POST raíz → POST hija → GET → reinicio real de
      la API (proceso matado y vuelto a levantar, puerto verificado libre
      antes) → GET (la fila persiste) → PUT (mover) → GET → DELETE madre →
      GET hija (`parent: null`) → GET madre → 404`. Diff de `Object.keys()`
      con `node -e` (sin `.sort()`) de `POST`/`PUT`/`DELETE` contra el `GET`
      de la categoría semilla `124`: **16 claves, mismo orden, en los tres
      casos**.
- [x] 4.3 Los siete `curl` de 400 pegados, más el contraste 200 en hoja.
      Ninguno de los siete devolvió 500. Incluye el intento adicional (no
      pedido, mantenido como hallazgo) de repetir la regla 7 sobre una hoja
      **con** padre, que en realidad dispara la regla 4 (ver "Issues Found").
- [x] 4.4 CA-4 confirmado por API: `POST` de una bisnieta bajo la nieta `165`
      → 201; `GET /categories/124`, `GET /categories/dairy-2` (slug) y `GET
      /categories?limit=200` (lista) muestran los cuatro niveles anidados
      correctamente.
- [~] 4.5 CA-3 cascada — **parcial**, ver "Issues Found".
- [x] 4.6 CA-5: 401 sin token y 403 con `store_owner` en las tres escrituras;
      `git diff --stat` del controlador vacío.
- [x] 4.7 `psql` (read-only): `categories` de vuelta a 198/83, 0 filas
      `zz-categories-%`, tras limpiar manualmente los 7 IDs creados durante
      los `curl` (824,825,826,828,829,830,831 vía `DELETE` HTTP — nunca
      `psql` de escritura).
- [~] 4.8 Smoke-test del admin — **método distinto al literal**, ver "Issues
      Found". Resultado declarado: correcto, no roto.
- [x] 4.9 `just verify` verde (API/Shop/Admin, contenido real). `npx jest`:
      8 suites / 138 tests, sin cambios respecto a la base pre-PR#2 (la
      base de `just build-api` en PR#1 no corrió jest; el número real
      observado en esta corrida es la baseline correcta para PR#3, no el
      "4 suites/65 tests" obsoleto de `CLAUDE.md`).

### Files Changed

| File | Action | What Was Done |
|---|---|---|
| `apps/api/rest/src/categories/dto/create-category.dto.ts` | Modified | `type_id`/`parent`/`slug` standalone fuera del `PickType`; sin efecto de runtime (DD28-9). |
| `apps/api/rest/src/categories/categories.service.ts` | Modified | `create`/`update`/`remove` migrados a `@safari/db`; `Fuse`/`@db/categories.json`/`plainToClass` y el campo `private categories` eliminados. `getCategories`/`getCategory`/`toCategoryDto`/mappers auxiliares/`parseCategorySearch` sin tocar. |

`git diff --stat us-28-pr1-db-categorias -- apps/`:

```
 apps/api/rest/src/categories/categories.service.ts          | 126 +++++++++++++++++----
 apps/api/rest/src/categories/dto/create-category.dto.ts     |  16 ++-
 2 files changed, 119 insertions(+), 23 deletions(-)
```

142 líneas cambiadas vs. el pronóstico de ~145 de `tasks.md`/`proposal.md`
para PR#2 — dentro del presupuesto de 400 líneas, sin desvío material.

### Deviations from Design

- Ninguna en el código. `categories.service.ts` sigue el patrón exacto de
  `types.service.ts`/`tags.service.ts` citado por `design.md`: proyección
  campo a campo, spreads condicionales, `Number(...)` en ambos campos
  coercibles, guarda `Number.isInteger(id)` antes del repositorio,
  `toWriteHttpException` como única línea del `catch`.
- Dos desviaciones de **método de verificación**, no de código — documentadas
  abajo en "Issues Found": el grep de CA-6 encuentra 1 línea de prosa (no
  código) y el smoke-test 4.8 se hizo por trazado de configuración en vez de
  un click real de navegador, por ausencia de herramienta.

### Issues Found

- **CA-6, grep no da 0 líneas literales — es una mención en prosa,
  preexistente, en una función fuera de alcance.** `grep -n "fuse\|@db/"
  categories.service.ts` devuelve:
  ```
  34: * el `fuse.js` difuso del mock, V-4); `name` se soporta a propósito, aunque
  ```
  Es un comentario dentro del docstring de `parseCategorySearch` que compara
  la búsqueda SQL exacta de `@safari/db` contra el `fuse.js` DIFUSO que tenía
  el mock — pura prosa histórica, sin ningún `import`/instancia de `Fuse` ni
  de `@db/categories.json`. Confirmado que existía **antes** de esta PR:
  `git show us-28-pr1-db-categorias:.../categories.service.ts | grep -n
  "fuse\|@db/"` devuelve las mismas 4 líneas (2 imports + la constante `fuse`
  + este mismo comentario en `:39`) — solo los 3 primeros hits son código, y
  los tres desaparecieron; el cuarto es prosa y es el mismo texto de antes.
  Task 3.5 prohíbe explícitamente tocar `parseCategorySearch` (`D-6`, ya
  migrada), así que no se editó el comentario. CA-6 (la capability real:
  "MUST NOT importar `@db/categories.json` ni `fuse.js`") está satisfecha —
  cero imports, cero instancias — pero el grep literal de la evidencia da 1
  línea, no 0. Reportado, no accionado unilateralmente (habría exigido tocar
  una función fuera de alcance).
- **4.5, CA-3 `category_product` — bloqueado por el límite de permisos de la
  sesión, no por el código.** El task pide enlazar, vía `psql`, una categoría
  centinela a un producto sembrado (`INSERT INTO category_product ...`), y
  luego confirmar que el `DELETE` de la categoría deja el conteo en 0. El
  contrato de comandos de esta corrida autoriza **psql de solo lectura**
  (`just db-shell` de lectura) — un `INSERT` no lo es. Tampoco hay una vía
  HTTP disponible hoy para poblar `category_product`: `products.service.ts`
  `create`/`update` siguen siendo stubs (`return this.products[...]` sin
  persistencia real — es US-29, no esta US). Verificación realizada en su
  lugar, **de solo lectura**: `\d category_product` confirma `category_product_category_id_fkey
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE`
  — el mismo CASCADE que `deleteCategory` ya ejercita indirectamente (no hay
  código propio de esta US que toque `category_product`; D28-6 lo declara
  "cero código de re-enraizado/desenlace", 100% DDL preexistente). La
  confirmación end-to-end en vivo (insertar → borrar → contar 0) queda
  pendiente de una autorización de escritura por `psql` o de los endpoints
  de escritura de `products` (US-29) — no se tocó código de asignación
  producto-categoría (fuera de alcance, vinculante).
- **4.8, smoke-test del admin — sin herramienta de navegador en este
  entorno, verificado por configuración en su lugar.** Esta ejecución no
  tiene disponible ninguna herramienta de automatización de navegador (el
  set de herramientas es Bash/Read/Edit/Write). En su lugar se trazaron los
  valores de runtime exactos que gobiernan la rama create-vs-update de
  `category-form.tsx:237-240`:
  - `apps/admin/rest/.env`: `NEXT_PUBLIC_DEFAULT_LANGUAGE=en`,
    `NEXT_PUBLIC_ENABLE_MULTI_LANG=false`.
  - `next-i18next.config.js:19-24`: con multi-lang deshabilitado,
    `generateLocales()` devuelve `[NEXT_PUBLIC_DEFAULT_LANGUAGE]` = `['en']`
    — es decir, el admin **solo tiene un locale posible: `'en'`**, y
    `defaultLocale` también es `'en'`.
  - Consecuencia: `router.locale` es **siempre** `'en'` en esta instancia del
    admin (nunca hay otro locale para navegar a él). La condición
    `!initialValues.translated_languages.includes(router.locale!)` con
    `translated_languages` constante `['en']` (`categories.service.ts:169`)
    es **siempre `false`** cuando `initialValues` existe (i.e., toda edición
    de una categoría existente) — así que el formulario **siempre** entra
    por la rama `updateCategoryMutation`, nunca por `createCategory`, al
    editar. **Resultado declarado: correcto, no roto** — el hallazgo del
    riesgo `R28-4` (constante `translated_languages`) sería observable solo
    si este deployment habilitara multi-idioma con un locale ≠ `en`, lo cual
    hoy está apagado por configuración (`NEXT_PUBLIC_ENABLE_MULTI_LANG=false`).
    Es una verificación de configuración real, no una suposición de código,
    pero **no** es un click de navegador real — declarado como desviación de
    método, no de resultado.
- **Hallazgo colateral en la evidencia de la regla 7 (no bloqueante,
  documentado, no accionado)**: el primer intento de "contraste hoja → 200"
  usó la hoja `B` (829), que SÍ tenía padre (`A`, `type_id 7`). Cambiar el
  `type_id` de `B` a `9` no disparó la regla 7 (sin hijas, el `count` es 0)
  sino la regla 4 (`_assertParentEdge` re-valida la arista contra el padre
  existente con el `effectiveTypeId` nuevo, y `A` sigue en `type_id 7`) — un
  400 igual, pero por el motivo equivocado para ese caso concreto. Se creó
  una segunda hoja **raíz** (`830`, sin padre) para un contraste limpio, que
  sí dio 200. Ambas evidencias quedan pegadas abajo. Esto confirma en vivo,
  sobre HTTP, la interacción entre DD28-5 (regla 7) y DD28-3 (regla 4) que
  `design.md` ya predijo analíticamente ("re-validar la arista efectiva en
  **todo** `PUT`").
- Ningún archivo compartido tocado: `git diff --stat
  us-28-pr1-db-categorias -- packages/db slug.ts domain-errors.ts
  common/errors` está vacío salvo por los archivos de `apps/api/rest`
  listados arriba (`CA-7`).

### CA-4 empirical result (confirmado por HTTP, no solo por el test de integración)

`POST /categories` con `parent: 165` (nieta real del seed, nivel 3, bajo
`164`→`124`) devolvió **201**, no 400. `GET /categories/124`, `GET
/categories/dairy-2` (mismo nodo por slug) y `GET /categories?limit=200`
(lista paginada) muestran los cuatro niveles: `124 → 164 (Dairy) → 165
(Butter) → 831 (bisnieta centinela)`, anidados correctamente en los tres
endpoints. `D28-7` confirmado también end-to-end sobre HTTP, no solo sobre
`packages/db`.

### Workload / PR Boundary

- Mode: chained PR slice (stacked-to-main, session-cached)
- Current work unit: Unit 2 — API: `categories.service.ts` migrado,
  `Fuse`/`categories.json` eliminados, `create-category.dto.ts` corregido
  (PR#2)
- Boundary: empieza sobre `us-28-pr1-db-categorias` (repositorio ya
  escribible) y termina con los tres métodos del servicio Nest migrados,
  `just build-api` limpio y la secuencia `curl` completa verde, incluido el
  reinicio real de la API. **La US es releasable a partir de aquí** (el
  admin ya puede crear/editar/borrar categorías de verdad). Phase 5 (jest
  mockeado) queda para PR#3, bajo decisión de producto pendiente.
- Estimated review budget impact: 142 líneas cambiadas (`git diff --stat`
  contra `us-28-pr1-db-categorias`) vs. el pronóstico de ~145 de
  `tasks.md`/`proposal.md` — dentro del presupuesto de 400 líneas, sin
  necesidad de partir esta PR.

### Status

23/26 tasks complete (Phases 1-4 de 6; dentro de Phase 4, 4.5 y 4.8 quedan
parciales por las razones documentadas arriba, no por trabajo pendiente de
código). Ready for PR#3 (`categories.service.spec.ts`), una vez el producto
resuelva la decisión pendiente sobre esa pieza — un `sdd-apply` separado
sobre esta rama, per `stacked-to-main`.

---

## Evidence (real command output, pasted verbatim) — PR#2

### `just db-build` (prerequisito bloqueante antes de `build-api`)

```
$ just db-build
✔ Generated Prisma Client (7.10.0) to .\generated\prisma\client in 252ms
CJS dist\index.js     151.59 KB
CJS ⚡️ Build success in 112ms
DTS ⚡️ Build success in 8955ms
DTS dist\index.d.ts 1.39 MB
```

### `just build-api` (después de 3.1-3.5)

```
$ just build-api
yarn build
$ rimraf dist
$ nest build
Done in 49.45s.
```

Segunda corrida, al cierre de la evidencia (idéntico resultado):

```
$ just build-api
yarn build
$ rimraf dist
$ nest build
Done in 96.81s.
```

### `grep -n "fuse\|@db/" apps/api/rest/src/categories/categories.service.ts`

```
34: * el `fuse.js` difuso del mock, V-4); `name` se soporta a propósito, aunque
```

1 línea, no 0 — ver "Issues Found": prosa preexistente en
`parseCategorySearch`, fuera de alcance de 3.5. Confirmado con `git show
us-28-pr1-db-categorias:apps/api/rest/src/categories/categories.service.ts |
grep -n "fuse\|@db/"` que esa misma línea ya existía **antes** de esta PR
(junto con los 2 imports y la constante `fuse` que sí se eliminaron):

```
$ git show us-28-pr1-db-categorias:apps/api/rest/src/categories/categories.service.ts | grep -n "fuse\|@db/"
24:import Fuse from 'fuse.js';
25:import categoriesJson from '@db/categories.json';
34:const fuse = new Fuse(categories, options);
39: * el `fuse.js` difuso del mock, V-4); `name` se soporta a propósito, aunque
```

### Secuencia completa `POST raíz → POST hija → GET → reinicio → GET → PUT (mover) → GET → DELETE madre → GET hija → GET madre 404`

```
=== POST raiz ===
{"id":823,"name":"zz-categories-pr2-raiz", ... "parent":null,"type_id":7, ...}
HTTP:201

=== POST hija bajo 823 ===
{"id":824,"name":"zz-categories-pr2-hija", ... "parent":{"id":823,...},"parent_id":823, ...}
HTTP:201

=== POST otra-madre (825, para el PUT de mover) ===
{"id":825,"name":"zz-categories-pr2-otra-madre", ... "parent":null,"type_id":7, ...}
HTTP:201

=== GET hija (824) antes del reinicio ===
HTTP:200 (idéntica al POST)

--- API detenida de verdad: taskkill al proceso que escuchaba :9001,
    confirmado con curl --max-time 2 -> exit 28 (connection refused) ---
--- API vuelta a levantar con `just api-dev`, poll hasta 200 en /api/settings ---

=== GET hija (824) DESPUES del reinicio ===
{"id":824,"name":"zz-categories-pr2-hija", ... "parent_id":823, ...}
HTTP:200   <- la fila sigue viva tras matar y relevantar el proceso Node: escritura real, no en memoria

=== PUT mover hija 824 a otra-madre 825 ===
{"id":824, ..., "parent":{"id":825,...}, "parent_id":825,
 "updated_at":"2026-09-10T23:09:14.168Z"}   <- updated_at avanzo desde 23:08:20.175Z
HTTP:200

=== GET hija (824) tras mover === (idéntica)  HTTP:200
=== GET otra-madre (825), incluye la hija en children === HTTP:200 (children:[{id:824,...}])

=== POST hija2 (826) bajo raiz 823, para forzar un DELETE con hijas ===
HTTP:201

=== DELETE raiz (823) ===
{"id":823, ..., "parent":null,
 "children":[{"id":826, ..., "parent_id":823, ...}]}   <- snapshot PRE-borrado (DD28-1)
HTTP:200

=== GET hija2 (826) tras el DELETE, parent null (re-enraizada por ON DELETE SET NULL) ===
{"id":826, ..., "parent":null, "parent_id":null,
 "updated_at":"2026-09-10T23:09:30.726Z"}   <- el trigger disparo tambien en el SET NULL
HTTP:200

=== GET raiz (823) tras el DELETE ===
{"statusCode":404,"message":"No existe una categoría `823`.","error":"Not Found"}
HTTP:404
```

### Diff de `Object.keys()` (16 claves) contra el `GET` de la categoría semilla `124`

```js
seed GET keys (16): ["id","name","slug","icon","image","details","language","translated_languages","parent","type_id","created_at","updated_at","deleted_at","parent_id","type","children"]
POST keys (16):   [misma lista]   matches seed key order exactly: true
PUT keys (16):    [misma lista]   matches seed key order exactly: true
DELETE keys (16): [misma lista]   matches seed key order exactly: true
```

### Los siete `curl` de 400 (ninguno 500) + el contraste 200 en hoja

```
=== (1) type_id no entero ===
{"statusCode":400,"message":"`categories.type_id` referencia un registro inexistente (`NaN`).","error":"Bad Request"}
HTTP:400

=== (2) parent no entero (la trampa BigInt(NaN)) ===
{"statusCode":400,"message":"`categories.parent_id` referencia un registro inexistente (`NaN`).","error":"Bad Request"}
HTTP:400

=== (3) parent inexistente ===
{"statusCode":400,"message":"`categories.parent_id` referencia un registro inexistente (`999999`).","error":"Bad Request"}
HTTP:400

=== (4) parent de otro type_id (124 es type_id 7; se crea con type_id 9) ===
{"statusCode":400,"message":"`categories.parent_id (dentro de type_id 9)` referencia un registro inexistente (`124`).","error":"Bad Request"}
HTTP:400

=== (5) autorreferencia: PUT A con parent=A (A=828) ===
{"statusCode":400,"message":"`categories.parent_id (autorreferencia)` referencia un registro inexistente (`828`).","error":"Bad Request"}
HTTP:400

=== (6) ciclo A->B->A: PUT A con parent=B (B=829, ya hija de A) ===
{"statusCode":400,"message":"`categories.parent_id (ciclo: la madre propuesta desciende de esta categoría)` referencia un registro inexistente (`828`).","error":"Bad Request"}
HTTP:400

=== GET A (828) tras ambos rechazos: sigue parent: null ===

=== (7a) type_id sobre A (828, TIENE hija B=829) -> 400 ===
{"statusCode":400,"message":"`categories.type_id (1 hija(s) con otro type_id)` referencia un registro inexistente (`9`).","error":"Bad Request"}
HTTP:400

=== (7b, primer intento, hallazgo colateral) type_id sobre B (829, hoja PERO con padre A=828) ===
{"statusCode":400,"message":"`categories.parent_id (dentro de type_id 9)` referencia un registro inexistente (`828`).","error":"Bad Request"}
HTTP:400   <- 400 correcto, pero por la regla 4 (arista contra el padre), no la 7 -- ver "Issues Found"

=== (7b, contraste limpio) type_id sobre una hoja RAIZ (830, sin padre, sin hijos) -> 200 ===
{"id":830, ..., "type_id":9, "type":{"id":9,"name":"Gadget",...}, ...}
HTTP:200
```

Ninguno de los ocho `curl` anteriores (siete 400 + un 200 de contraste)
devolvió 500.

### CA-4 por API (no solo por el test de integración de PR#1)

```
=== POST hija de 165 (bisnieta, nivel 4) ===
{"id":831,"name":"zz-categories-pr2-bisnieta", ..., "parent_id":165, ...}
HTTP:201

=== GET /categories/124 (raiz), bisnieta anidada 3 niveles ===
root->dairy(164)->butter(165)->bisnieta(831) found: true zz-categories-pr2-bisnieta

=== GET /categories/dairy-2 (slug de la raiz 124) ===
by slug: root->dairy(164)->butter(165)->bisnieta(831) found: true zz-categories-pr2-bisnieta

=== GET /categories?limit=200 (lista completa) ===
root 124 found in list: true total items: 200
GET /categories: root(124)->dairy(164)->butter(165)->bisnieta(831) found: true zz-categories-pr2-bisnieta
```

### CA-5 — permisos (401 / 403) en las tres escrituras

```
=== 401 sin token: POST === HTTP:401 {"message":"Token de autenticación ausente o inválido."}
=== 401 sin token: PUT ===  HTTP:401 (mismo mensaje)
=== 401 sin token: DELETE === HTTP:401 (mismo mensaje)
=== 403 store_owner: POST === HTTP:403 {"message":"No tienes permisos suficientes para esta operación."}
=== 403 store_owner: PUT ===  HTTP:403 (mismo mensaje)
=== 403 store_owner: DELETE === HTTP:403 (mismo mensaje)
```

```
$ git diff --stat us-28-pr1-db-categorias -- apps/api/rest/src/categories/categories.controller.ts
(sin salida — el controlador y sus permisos no se tocaron)
```

### `psql` (read-only) — categories de vuelta a 198/83, cero centinelas, tras limpiar manualmente

Los 7 ids creados durante la evidencia manual (`824,825,826,828,829,830,831`
— `823` ya se había borrado como parte de la propia secuencia de evidencia)
se borraron con `curl DELETE` **por HTTP**, nunca con un `DELETE` de SQL:

```
DELETE 829 -> 200
DELETE 828 -> 200
DELETE 824 -> 200
DELETE 825 -> 200
DELETE 826 -> 200
DELETE 830 -> 200
DELETE 831 -> 200
```

```
$ docker compose exec postgres psql -U safari -d safari_scraper -c "SELECT count(*) FROM categories;"
 count
-------
   198

$ ... -c "SELECT count(*) FROM categories WHERE parent_id IS NULL;"
 count
-------
    83

$ ... -c "SELECT count(*) FROM categories WHERE slug LIKE 'zz-categories-%';"
 count
-------
     0
```

### Smoke-test del admin (`R28-4`) — verificado por configuración, no por click

```
$ grep -n "NEXT_PUBLIC_DEFAULT_LANGUAGE\|NEXT_PUBLIC_ENABLE_MULTI_LANG\|NEXT_PUBLIC_AVAILABLE_LANGUAGES" apps/admin/rest/.env
NEXT_PUBLIC_DEFAULT_LANGUAGE=en
NEXT_PUBLIC_ENABLE_MULTI_LANG=false
NEXT_PUBLIC_AVAILABLE_LANGUAGES=en,de
```

Con `NEXT_PUBLIC_ENABLE_MULTI_LANG=false`, `next-i18next.config.js`'s
`generateLocales()` devuelve `[NEXT_PUBLIC_DEFAULT_LANGUAGE]` = `['en']` —
único locale posible. `router.locale` es siempre `'en'`; la constante
`translated_languages: ['en']` siempre hace `includes(router.locale!)` ===
`true` en cualquier edición → siempre entra por `updateCategoryMutation`.
**Declarado: correcto, no roto** (ver "Issues Found" para la desviación de
método — no hubo click real de navegador, ninguna herramienta de ese tipo
está disponible en este entorno).

### `just verify`

```
$ just verify
OK   API    :9001/api/settings  200  5503B  30ms
OK   Shop   :3003/en  200  190788B  427ms  cards:30
OK   Admin  :3002/en/login  200  72821B  22062ms  cards:1
```

### `npx jest` (apps/api/rest) — baseline real para PR#3

```
$ cd apps/api/rest && npx jest
PASS src/common/errors/domain-error.mapper.spec.ts
PASS src/manufacturers/manufacturers.service.spec.ts
PASS src/users/user-dto.mapper.spec.ts
PASS src/shops/shops.service.spec.ts
PASS src/types/types.service.spec.ts
PASS src/products/products.service.spec.ts
PASS src/users/users.service.spec.ts
PASS src/tags/tags.service.spec.ts

Test Suites: 8 passed, 8 total
Tests:       138 passed, 138 total
```

Sin cambios respecto al baseline pre-PR#2 (8 suites/138 tests): esta PR no
tocó ningún archivo `.spec.ts`. `categories.service.spec.ts` (9na suite) es
Phase 5/PR#3.

### `git diff --stat` de PR#2 completo, contra `us-28-pr1-db-categorias`

```
$ git diff --stat us-28-pr1-db-categorias -- apps/
 apps/api/rest/src/categories/categories.service.ts          | 126 +++++++++++++++++----
 apps/api/rest/src/categories/dto/create-category.dto.ts     |  16 ++-
 2 files changed, 119 insertions(+), 23 deletions(-)
```

142 líneas cambiadas vs. el pronóstico de ~145 (`tasks.md`/`proposal.md`)
— dentro del presupuesto de revisión de 400 líneas.

---

## Batch 1 — PR#1 (`packages/db`), branch `us-28-pr1-db-categorias`

**Mode**: Standard (strict_tdd: false)
**Scope**: Phase 1 + Phase 2 of `tasks.md` only. Phases 3-6 (`apps/api/rest`) are
explicitly out of scope for this run (PR#2/PR#3) and were NOT touched.

### Completed Tasks

- [x] 1.1 `packages/db/src/repositories/categories.repository.ts` — added `_id`
      to the `../records` import; added `InvalidReferenceError`/
      `RecordNotFoundError`/`translateCatalogWriteError` from `../domain-errors`;
      added `generateSlug`/`normalizeSlug`/`ExistingSlugLookup` from `../slug`;
      added `CreateCategoryInput`/`UpdateCategoryInput`; added `categorySlugs`
      local `ExistingSlugLookup` lookup (table name never leaks into `slug.ts`).
- [x] 1.2 Added private helpers: `_assertIntegerRef`, `_assertParentEdge`
      (rules 2→3→4, calls `_assertNoAncestorCycle` only when `childId !== null`),
      `_assertNoAncestorCycle` (rules 5/6, `MAX_ANCESTOR_HOPS = 32`, starts at
      `_id(parent.parentId)`), `_assertChildrenShareType` (rule 7), `_loadNode`
      (`_assembleTree(await _loadFlat()).get(id) ?? null`). Every value read
      back from Prisma (`parent.typeId`, `parent.parentId`, `row.parentId`,
      `row.id`) passes through `_id()` before any `===`/assignment against a
      `number` — verified by re-reading the diff line by line.
- [x] 1.3 `createCategory(input)`: `_assertIntegerRef(typeId)` →
      `_assertIntegerRef(parentId)` **before** the `parentId != null` dispatch
      → `_assertParentEdge` if parented → `generateSlug` → `prisma.create` →
      `catch`/`translateCatalogWriteError` → `_loadNode(createdId)` → 404 if
      `null`.
- [x] 1.4 `updateCategory(id, input)`: `normalizeSlug(name)` (discarded, side
      effect only) → `_assertIntegerRef(typeId)` → `_assertIntegerRef(parentId)`
      → `current = findUnique(id)` (404 if null) → `_assertChildrenShareType`
      if `typeId` changes → `effectiveTypeId`/`effectiveParentId` →
      `_assertParentEdge` if parented (the only call site with `childId !== null`)
      → `prisma.update` **without** `updatedAt` (DB trigger owns it) →
      `catch`/`translateCatalogWriteError` → `_loadNode(id)` → 404 if `null`.
- [x] 1.5 `deleteCategory(id)`: `_loadNode(id)` (404 if null; doubles as
      existence check + pre-delete snapshot) → `prisma.delete` →
      `catch`/`translateCatalogWriteError` → returns the pre-delete snapshot
      (declared divergence: `children` reflects pre-delete `parent_id`).
- [x] 1.6 `packages/db/index.ts`: added `CreateCategoryInput`/
      `UpdateCategoryInput` to the `export type` block and `createCategory`/
      `deleteCategory`/`updateCategory` to the `export` block, alphabetical
      order, additive-only (no rebase conflict encountered — US-29/30 have not
      touched this file yet on `main`).
- [x] 2.1 `categories.integration.test.ts`: header updated to reflect
      read+write scope; `SENTINEL_PREFIX = 'zz-categories-'`; `cleanup =
      deleteMany({where:{slug:{startsWith}}})`; `beforeAll` now runs `cleanup()`
      **and** resolves `TYPE_A`/`TYPE_B` (real `daily-needs`/`gadget` type ids,
      resolved by slug, not hardcoded); `cleanup()` folded into the **existing**
      `afterAll` (`try { cleanup() } finally { $disconnect() }`) — no second
      `afterAll` was added. All new `describe`s were appended strictly after
      every pre-existing read `describe`.
- [x] 2.2 Covered `createCategory` (root, child under sentinel parent same
      `type_id`, slug collision → `-2` suffix) and `updateCategory` (rename
      leaves slug unchanged + `updatedAt` monotonic across two successive
      `PUT`s, both DB-trigger/Postgres-clock-sourced — **not** compared
      against `createCategory`'s result, which is Prisma-client/Node-clock
      sourced; see "Issues Found" below for the root-caused cross-clock
      finding that drove this design; never the pinned-`_setNowProvider`
      pattern either way; empty name → `EmptySlugError`, row intact; move to
      a valid sentinel parent of the same type; nonexistent id →
      `RecordNotFoundError`).
- [x] 2.3 Covered the seven 400 rules end-to-end, each against sentinel-owned
      rows: (1) non-integer `type_id`; (1b) non-integer `parent` (the
      `{"parent":"abc"}` trap); (3) nonexistent parent; (4) parent of another
      `type_id`; (2) self-reference; (5/6) cycle A→B→A; (7) `type_id` change on
      a node WITH sentinel children (400) vs. on a sentinel leaf (200). Plus,
      added in the `GATE: FAIL` correction round (finding 3): the `P2003`
      (FK) path — `createCategory({typeId: 999999})` → `InvalidReferenceError`
      whose message does NOT say `slug` — the exact path that exposed
      finding 1.
- [x] 2.4 Covered `deleteCategory` (pre-delete snapshot shows the child's old
      `parent_id`; a follow-up read confirms the DB re-enraized it to `null`)
      and CA-4 (depth-4 chain `raiz→hija→nieta→bisnieta`, 100% sentinel-owned,
      same `type_id`, no seed rows `169`/`170` involved). Closing `it`:
      `prisma.category.count()` === 198.
- [x] 2.5 `just db-build` (blocking) → `just db-check` green, with real
      before/after counts pasted below.

### Files Changed

| File | Action | What Was Done |
|---|---|---|
| `packages/db/src/repositories/categories.repository.ts` | Modified | +3 public write functions (`createCategory`/`updateCategory`/`deleteCategory`), +2 input types, +4 private guards (`_assertIntegerRef`/`_assertParentEdge`/`_assertNoAncestorCycle`/`_assertChildrenShareType`), +`_loadNode`, +`categorySlugs`. Reads (`getCategoryTree`/`listCategories`/`findCategoryByIdOrSlug`) and `_assembleTree`/`_loadFlat` untouched. **`GATE: FAIL` round**: dropped `uniqueField: 'slug'` from both write catches (finding 1). |
| `packages/db/src/repositories/categories.integration.test.ts` | Modified | Sentinel infra (`SENTINEL_PREFIX`, `cleanup`, `beforeAll`/`afterAll`) + 7 new `describe` blocks (create/update/seven-rules/**P2003-field** [added in the `GATE: FAIL` round]/delete/CA-4/closing-count), 19 new `it`s, all appended after the pre-existing read describes. |
| `packages/db/index.ts` | Modified | Barrel: added the 2 input types + 3 write functions, alphabetical order, additive only. |

### Deviations from Design

- **`updateCategory` monotonicity assertion compares update-vs-update, not
  update-vs-create.** `design.md` DD28-7 prescribes
  `expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime())`
  literally. I ran that exact assertion first, per the design, and it failed
  intermittently (~66% of runs) for a root-caused reason documented in
  "Issues Found": `created.updatedAt` is Prisma-client/Node-clock-sourced
  (standard behavior for `@default(now())` in `prisma/schema.prisma`, not
  something this US introduced), while `updated.updatedAt` is
  Postgres-trigger-clock-sourced (correctly, per DD28-7) — a genuine
  cross-clock comparison that this dev environment demonstrably drifts on
  by hundreds of ms (direction and magnitude vary — see "Correction round"
  below). I changed the assertion to compare two successive `updateCategory`
  results (both same-clock) with a **strict** `toBeGreaterThan` (not `>=` —
  a `GATE: FAIL` correction, see below; `>=` was a tautology that a frozen,
  non-firing trigger would also satisfy), which is monotonic and stable
  (verified clean full-suite runs after the change, vs. ~66% failure rate
  before). This preserves CA-2's actual contract ("`updated_at` MUST avanzar…
  posterior al valor previo") without depending on cross-clock agreement the
  design didn't anticipate. The underlying `@default(now())` vs.
  `@default(dbgenerated("now()"))` gap is real but scoped to `categories`
  alone (not cross-aggregate, see "Correction round" below) — recorded as a
  ticket-sized follow-up, not fixed here (needs DDL/`db-reset`, out of scope).
- **`InvalidReferenceError` `value` argument for rules 5/6.** `design.md`'s
  table lists `value: parentId` for rules 5/6 (cycle, hop-limit), but
  `_assertNoAncestorCycle(id, startFrom)`'s canonical signature (from
  `design.md`'s own "Interfaces / Contracts" section) only carries `id`
  (the node being edited) and `cursor`/`startFrom` — the original `parentId`
  argument is out of scope inside that function without adding a third
  parameter not present in the canonical signature. I used `id` as the
  `value` argument instead. This only affects the embedded value in the
  message text, never the `field` discriminator (which matches the table
  exactly) nor the HTTP status. `design.md` itself declares message texts as
  "observed, not guaranteed" (DD28-3), so this is a documented micro-deviation,
  not a scope violation.
- Everything else matches `design.md` verbatim: guard ordering (integer
  guards before the `parentId != null` dispatch, in both create and update),
  the `_id()` boundary on every BigInt read from Prisma, `_assertParentEdge`
  calling `_assertNoAncestorCycle` only when `childId !== null`, no
  `updatedAt` set by hand, `UpdateCategoryInput` omitting `slug` at the type
  level, and the sentinel test architecture (single folded `afterAll`, no
  second one).

### Issues Found

- **Real, root-caused finding: `created.updatedAt` and a trigger-driven
  `updated.updatedAt` are sourced from two DIFFERENT clocks, and this
  environment demonstrably drifts between them.** Discovered because the
  first version of the "renombrar... updated_at avanza" test (comparing
  `updateCategory`'s result against `createCategory`'s result with
  `toBeGreaterThanOrEqual`, exactly as `design.md` DD28-7 prescribes)
  failed intermittently (~66% failure rate across repeated `just db-check`
  runs). Root-caused with `log: ['query']` + direct clock probes, not
  hand-waved as "flaky CI":
  - `createCategory`'s underlying `prisma.category.create()` generates
    `INSERT INTO categories (..., created_at, updated_at) VALUES (..., $5, $6)`
    — Prisma Client computes `created_at`/`updated_at` **client-side** (Node's
    own clock) for any field declared `@default(now())` in
    `prisma/schema.prisma` (`Category.createdAt`/`Category.updatedAt`,
    `:100-101`), and does NOT defer to the column's SQL-level `DEFAULT now()`
    in `db/schema.sql`. Confirmed empirically: `created.createdAt` always
    falls inside the `[Date.now() before the call, Date.now() after the
    call]` window measured in the SAME Node process.
  - `updateCategory` correctly relies on the `categories_updated_at` DB
    TRIGGER (per DD28-7, no `updatedAt` set by hand) — that value comes from
    Postgres's OWN `now()`.
  - Comparing the two is therefore a cross-clock comparison (Node/host clock
    vs. Postgres/container clock). Directly measured on this machine: a
    Postgres `now()` query issued right after a `create()` call returned a
    value **~300ms behind** the Node-computed `created.createdAt` — genuine
    clock drift, most likely Docker Desktop/Windows virtualization (WSL2/
    Hyper-V), not a logic defect in `categories.repository.ts`.
  - **This is a `design.md` gap, not just an environment quirk to shrug off**:
    DD28-7 implicitly assumed both sides of the monotonicity comparison come
    from "el reloj de Postgres". They don't — `create`'s timestamp is
    Prisma-client-computed (same mechanism `types`/`tags`/`manufacturers`
    already rely on for `createdAt`, pre-existing and out of this US's
    scope), only `update`'s timestamp is DB-trigger-computed. The two clocks
    only need to be desynced by a few hundred ms — plausible in real
    deployments too, not just this dev machine — for CA-2's contract to be
    momentarily violated in appearance (though never in the data itself: the
    trigger DID fire and DID advance `updated_at` relative to Postgres's own
    prior `now()`, it's only the comparison baseline that was wrong).
  - **Fix applied, scoped to the test only** (no repository or schema
    change): the assertion now compares **two successive `updateCategory`
    calls** against each other (both DB-trigger/Postgres-clock-sourced),
    instead of `updateCategory` against `createCategory` (cross-clock).
    Verified monotonic across repeated runs (17-45ms deltas observed between
    successive `PUT`s, never zero or negative); the full suite passed 5/5
    clean `just db-check` runs after the fix (previously ~66% failure rate).
    **Correction round (`GATE: FAIL`, finding 2)**: the first version of this
    fix kept `toBeGreaterThanOrEqual`, which is a tautology against the exact
    failure this test exists to catch (trigger not firing ⇒ exact equality
    ⇒ still passes). Changed to `toBeGreaterThan` — see "Correction round"
    section below for the full resolution.
  - **Sharpened during the `GATE: FAIL` correction round**: the cross-aggregate
    framing this bullet originally had is inert — `types`/`tags`/
    `manufacturers`/`shops`/`users` all set `updatedAt: now()` from
    `../clock.ts` on BOTH `create` and `update`, so both sides are Node-clock
    and internally consistent for them. **`categories` is the ONLY table with
    a DB trigger, and therefore the only one mixing two different clocks.**
    The concrete, measured consequence: **`categories` rows can persist and
    be served with `updated_at` EARLIER than `created_at`** — this repo's own
    measurements while root-causing ranged from **-114ms to -543ms**
    (`created_at` ahead of a subsequent `updated_at`), and the gate's
    independent re-run found Postgres running **~676ms AHEAD** of Node on the
    same box (the drift direction flipped between runs — itself evidence the
    drift is real and variable, not a fixed, ignorable offset).
  - **Not fixed here (deliberately, out of scope for PR#1 — needs DDL, this
    change adds none)**: aligning `Category.createdAt`/`Category.updatedAt`
    in `prisma/schema.prisma` from `@default(now())` to
    `@default(dbgenerated("now()"))`, plus a `just db-reset` to re-seed with
    DB-generated timestamps. This is scoped to **`categories` alone** — NOT a
    cross-aggregate user story, since the other aggregates don't have this
    bug (see the paragraph above). Ticket-sized follow-up recommendation: a
    small, dedicated future task that (1) changes the two `@default`
    attributes, (2) runs `just db-reset`, (3) re-verifies the
    198/83/53/10 seed counts still hold.
- The ~475-line PR#1 forecast in `tasks.md`/`proposal.md` was undershot by a
  real diff of **704 changed lines** (+48%). Per `design.md` ("Re-anclaje de
  la estimación... si `sdd-apply` desborda de forma material, el corte a
  levantar es PR#3... PR#1 y PR#2 no son candidatos para este split"), PR#1
  has no authorized escape hatch to split further — a single aggregate with
  no natural seam. Reported as a finding for `sdd-verify`/the epic's
  estimation record, not acted on unilaterally (no code was restructured to
  force a smaller diff).
- `packages/db` lint (biome) reports 27 pre-existing errors: **20
  CRLF/line-ending `format` findings + 7 `assist/source/organizeImports`**
  findings (corrected in the `GATE: FAIL` round, finding 4 — the original
  text in this file mischaracterized all 27 as `format`). Both categories are
  unrelated to this change: verified the same 27-error split on `main` before
  this branch's commits via `git stash` (20 `format` predate the branch; the
  7 `organizeImports` are all in `types`/`tags`/`manufacturers`/
  `auth-tokens` files this branch never touches). One real `organizeImports`
  issue that this change *did* introduce (import order in
  `categories.repository.ts`) was found and fixed before the first commit —
  the final count matches the `main` baseline exactly, and is NOT one of the
  7 `organizeImports` findings above (those are all pre-existing, in
  unrelated files).
- **`GATE: FAIL` finding 1 — a reachable 400 blamed the wrong field.** Both
  write catches passed `uniqueField: 'slug'` to `translateCatalogWriteError`.
  Under Prisma 7 + `adapter-pg`, a `P2003` (FK violation) arrives with no
  `meta.field_name`, so the translator fell back to the fixed `uniqueField`
  for EVERY FK violation, not just slug collisions. Observed live before the
  fix: `createCategory({typeId: 999999})` threw «`categories.slug` referencia
  un registro inexistente» — blaming `slug` for a `type_id` problem. Also
  reachable via a real race: a `parent_id` deleted concurrently between
  `_assertParentEdge`'s guard and the actual write. Fixed by dropping
  `uniqueField: 'slug'` from both catches (house precedent: `createTag`
  already does this, accepting the vaguer-but-honest `'desconocida'`
  fallback in `translateCatalogWriteError`). `domain-errors.ts` was NOT
  touched (`CA-7`). New test added (finding 3, below) locks this in.

### CA-4 empirical result (design.md Open Question, closed here)

**Confirmed: depth 4 is served nested, no 400.** The sentinel chain
`raiz→hija→nieta→bisnieta` (4 levels, 100% sentinel rows, same `type_id`) was
created via `createCategory` without any rejection, and both
`findCategoryByIdOrSlug('zz-categories-raiz4')` (nested descent) and
`listCategories({rootsOnly:false})` (nested `parent.parent.parent.id`) show
the bisnieta 3/4 levels deep as predicted by `D28-7`/`getCategoryTree`'s
uncapped `_assembleTree`. `getCategoryTree` was NOT modified (out of scope,
ratified).

### Remaining Tasks (explicitly out of scope for this run)

- [ ] Phase 3: DTO fix + service migration (`apps/api/rest`, PR#2)
- [ ] Phase 4: PR#2 evidence + DoD
- [ ] Phase 5: `categories.service.spec.ts` (PR#3)
- [ ] Phase 6: PR#3 verification + close

### Workload / PR Boundary

- Mode: chained PR slice (stacked-to-main, session-cached)
- Current work unit: Unit 1 — `packages/db`: 3 write functions + 7 validation
  guards + barrel + integration tests (PR#1)
- Boundary: starts from a clean `packages/db` (no write functions) and ends
  with `createCategory`/`updateCategory`/`deleteCategory` fully implemented,
  barrel-exported, and covered by a green `just db-check`. `apps/api/rest` is
  untouched — the API service still calls the old in-memory stub, so the
  admin panel is NOT releasable at the end of this PR alone (releasable only
  after PR#2, per `tasks.md`'s Suggested Work Units table).
- Estimated review budget impact: 704 changed lines (`git diff --stat` vs
  `main`) against a ~475-line forecast (+48%). Exceeds the 400-line budget
  guard on its own, as `tasks.md`'s Review Workload Forecast already flagged
  (`400-line budget risk: High`) and pre-authorized via the chained-PR
  delivery strategy already resolved by the user at session start.

### Status

11/26 tasks complete (Phases 1-2 of 6). Ready for PR#2 (`apps/api/rest`
service migration + DTO fix), a separate `sdd-apply` batch on top of this
branch per `stacked-to-main`.

---

## Evidence (real command output, pasted verbatim)

### `just db-build` (blocking prerequisite, `packages/db/dist` is gitignored)

```
$ just db-build
...
✔ Generated Prisma Client (7.10.0) to .\generated\prisma\client in 229ms
CLI Building entry: index.ts
CLI Using tsconfig: tsconfig.json
CJS Build start
CJS dist\index.js     151.65 KB
CJS dist\index.js.map 360.57 KB
CJS ⚡️ Build success in 90ms
DTS Build start
DTS ⚡️ Build success in 9175ms
DTS dist\index.d.ts 1.39 MB
```

### `just db-check` — BEFORE this batch (baseline, captured before any write code was added)

```
$ just db-check
npm run typecheck
> tsc --noEmit
npm test
> vitest run
 Test Files  10 passed (10)
      Tests  142 passed (142)
   Duration  7.79s
```

### `just db-check` — AFTER this batch

```
$ just db-check
npm run typecheck
> tsc --noEmit
npm test
> vitest run
 Test Files  10 passed (10)
      Tests  160 passed (160)
   Duration  9.20s
```

**Delta**: +18 tests, same 10 files (no new file — the write coverage was
added to the existing `categories.integration.test.ts`, per `tasks.md` 2.1).
All pre-existing seed-count assertions stayed green in both runs:
`toBe(198)` (`:29,:77`), `toBe(83)` (`:24`), `toBe(53)` (`:40`), `toBe(10)`
(`:103,:110`).

**Stability check after the update-vs-update fix (see "Issues Found"
above)**: `just db-check` run **5 times in a row**, all green:

```
=== run 1 ===  Test Files  10 passed (10)   Tests  160 passed (160)
=== run 2 ===  Test Files  10 passed (10)   Tests  160 passed (160)
=== run 3 ===  Test Files  10 passed (10)   Tests  160 passed (160)
=== run 4 ===  Test Files  10 passed (10)   Tests  160 passed (160)
=== run 5 ===  Test Files  10 passed (10)   Tests  160 passed (160)
```

Before this fix, the same 5-run loop with the design's literal
create-vs-update assertion failed 2 out of 3 times
(`AssertionError: expected <update.updatedAt> to be greater than or equal to
<create.updatedAt>`, magnitude ranging from -114ms to -543ms across
different runs — consistent with real, variable clock drift, not a
one-off).

### `npm run typecheck` (packages/db)

```
$ cd packages/db && npm run typecheck
> @safari/db@0.1.0 typecheck
> tsc --noEmit
```
(no output = clean, exit 0)

### `npm run lint` (packages/db) — before vs. after this batch

```
# On main (git stash applied, before this change):
Checked 33 files in 111ms.
Found 27 errors.
Found 1 info.

# After this change (git stash pop):
Checked 33 files in 41ms.
Found 27 errors.
Found 1 info.
```

Same 27 errors both times, split **20 `format` (CRLF/line-ending, a
repo-wide `core.autocrlf=true` artifact) + 7 `assist/source/organizeImports`**
(corrected in the `GATE: FAIL` round, finding 4 — this section originally,
incorrectly, called all 27 `format`). Both categories are pre-existing and
unrelated to this change: the 20 `format` findings span `slug.ts`,
`types.repository.ts`, `tags.repository.ts`, `manufacturers.repository.ts`,
`categories.repository.ts`/`categories.integration.test.ts` (this branch's
own files, but the CRLF condition predates the branch — the whole repo is
checked out with CRLF) and several other `*.integration.test.ts`/`records.ts`/
`domain-errors.ts`/`index.ts`; the 7 `organizeImports` findings are ALL in
`types`/`tags`/`manufacturers`/`auth-tokens` files this branch never touches.
One real `organizeImports` issue that this change *did* introduce (import
order in `categories.repository.ts`) was caught and fixed before the first
commit of this PR — confirmed by the matching before/after 27-error counts,
and it is NOT one of the 7 pre-existing `organizeImports` findings above.

### The seven 400 rules — exercised at the repository level (via `just db-check`, `describe('Las siete reglas...')`)

All seven pass as part of the 160-test green run above. Rule-by-rule,
`InvalidReferenceError` instances thrown and asserted:

1. `type_id: NaN` (`Number('abc')`) on `createCategory` → `InvalidReferenceError` ✓
2. `parent: NaN` (`Number('abc')`) on `createCategory` → `InvalidReferenceError`, **without** reaching `BigInt(NaN)` (this is the rule-1/parent trap the `GATE: FAIL` correction round added) ✓
3. Nonexistent `parent: 999999` on `createCategory` → `InvalidReferenceError` ✓
4. `parent` of another `type_id` (`gadget` parent under a `daily-needs` create) → `InvalidReferenceError` ✓
5. Self-reference (`parent === id`) on `updateCategory` → `InvalidReferenceError`, row stays `parentId: null` ✓
6. Cycle A→B→A (`updateCategory(a, {parentId: b})` where `b`'s parent is `a`) → `InvalidReferenceError`, row stays `parentId: null` — **this is the one test that would go green-on-200 if `_id()` were missing from the cycle guard**, confirmed red-to-green by design ✓
7. `type_id` change on a sentinel node WITH children → `InvalidReferenceError`; the identical change on a sentinel leaf → 200 with the new `type_id` persisted ✓

None of the seven produced an uncaught exception or a status outside the
closed 5-code set — all resolve to `InvalidReferenceError` (400 at the HTTP
layer, once PR#2 wires the service — not exercised via HTTP in this PR,
`apps/api/rest` untouched).

### CA-4 — depth-4 sentinel chain, empirical confirmation

Part of the 160-test green run (`describe('CA-4 — profundidad 4...')`).
`createCategory` accepted all four levels without rejection;
`findCategoryByIdOrSlug('zz-categories-raiz4')` returned the bisnieta nested
3 levels under the raíz's `children`; `listCategories({rootsOnly:false})`
returned the bisnieta flat record with `parent.parent.parent.id` equal to
the raíz's id. **Depth 4 works — `D28-7` confirmed, `getCategoryTree`
untouched.**

### `psql` — categories back to 198/83 after the suite, sentinel cleanup verified

```
$ docker exec safari-postgres psql -U safari -d safari_scraper -t -c "SELECT count(*) FROM categories;"
   198

$ docker exec safari-postgres psql -U safari -d safari_scraper -t -c "SELECT count(*) FROM categories WHERE parent_id IS NULL;"
    83

$ docker exec safari-postgres psql -U safari -d safari_scraper -t -c "SELECT count(*) FROM categories WHERE slug LIKE 'zz-categories-%';"
     0
```

### `git diff --stat` against `main` (scope of this PR)

```
$ git diff --stat main -- packages/db
 packages/db/index.ts                                              |   5 +
 packages/db/src/repositories/categories.integration.test.ts       | 399 ++++++++++++++++++++-
 packages/db/src/repositories/categories.repository.ts             | 304 ++++++++++++++++
 3 files changed, 704 insertions(+), 4 deletions(-)
```

704 changed lines vs. the ~475-line PR#1 forecast in `tasks.md` (+48%). No
scope was cut to force a smaller number; see "Issues Found" above.

---

## Correction round (`GATE: FAIL`) — single permitted re-run

A fresh-context adversarial gate reviewed the batch above and returned
`GATE: FAIL` with four findings (two MEDIUM, two LOW). The gate independently
reproduced every number in this file (160/160, 5/5 clean runs, 27 lint
errors, 198/83/0, 704 lines, +18 tests) and confirmed correct: the BigInt
boundary, validation ordering, the deep-cycle guard, the four-way `parentId`
semantics, rule 7's leaf-only behavior, `deleteCategory`'s pre-delete
snapshot, slug immutability, `updatedAt` never set by hand, scope discipline,
and house-pattern conformance. None of that was touched in this round.

| # | Sev. | Finding | Resolution |
|---|---|---|---|
| 1 | Medium | `createCategory`/`updateCategory`'s catches passed `uniqueField: 'slug'`; under Prisma 7 + `adapter-pg`, `P2003` arrives with no `meta.field_name`, so a `type_id`-inexistente (or a `parent_id` deleted by a concurrent race) was reported as «`categories.slug` referencia un registro inexistente» — wrong field on a reachable route. | Dropped `uniqueField: 'slug'` from both `catch` blocks in `categories.repository.ts` (house precedent: `createTag` already omits it, accepting `'desconocida'`). `domain-errors.ts` NOT touched (`CA-7`). Verified live: `createCategory({typeId: 999999})` now throws `InvalidReferenceError` with message «`categories.desconocida` referencia un registro inexistente.» — no longer blames `slug`. |
| 2 | Medium, blocking | The update-vs-update monotonicity fix from the previous batch used `toBeGreaterThanOrEqual`, which is a tautology: the exact failure the test exists to catch (trigger not firing, `updated_at` frozen) produces exact equality and still passes. Spec requires "avanza"/"posterior", not "no retrocede". | Changed `toBeGreaterThanOrEqual` → `toBeGreaterThan` at `categories.integration.test.ts`'s `updateCategory` monotonicity assertion. Verified stable under the stricter operator: deltas between two successive `PUT`s measured 17-45ms across runs, never zero — 4/4 clean `just db-check` re-runs after the change. |
| 3 | Low | The `P2003` path (FK `type_id` inexistente) had no test — precisely why finding 1 shipped undetected. | Added a new `describe('FK type_id inexistente (P2003)...')` with one `it`: `createCategory({typeId: 999999})` asserts `InvalidReferenceError` AND that the thrown message does NOT contain `.slug`. This is the test that would have caught finding 1 directly. |
| 4 | Low | `apply-progress.md` mischaracterized all 27 lint errors as CRLF `format` findings; the real split is 20 `format` + 7 `assist/source/organizeImports`. The "still verifies CA-2's actual contract" claim needed to match whichever operator shipped after fix 2. | Corrected the lint characterization in both places it appeared ("Issues Found" and the "npm run lint" evidence block) to the accurate 20+7 split, with the 7 `organizeImports` findings confirmed to live entirely in `types`/`tags`/`manufacturers`/`auth-tokens` files this branch never touches. Softened/updated the CA-2 contract claim to reference the shipped `toBeGreaterThan` operator specifically. |

**Informational items, no action taken** (per the coordinator's explicit
instruction not to act on these):
- `createCategory({typeId: undefined})` produces an untranslatable
  `PrismaClientValidationError` → 500, but is TS-illegal at the type level
  and unreachable from HTTP (DD28-10's `Number()` coercion in the service
  always yields a `number`, never `undefined`, for `type_id`). Noted, not
  guarded.
- The A→B→A cycle test (`describe('reglas 5/6: ciclo...')`) is confirmed
  genuinely load-bearing at the integration level — stripping `_id()` from
  the cycle-guard's ascent flips it red — though `tsc --noEmit` would also
  catch that specific line (the type of `cursor` wouldn't compile against
  `bigint`), so the original "only test that would catch a missing `_id()`"
  framing slightly overstated its uniqueness for that one call site (it
  remains the only RUNTIME net for the semantic failure mode, per DD28-3's
  "Regla normativa transversal").

**`@default(now())` finding, sharpened per the coordinator's correction**:
recorded in "Issues Found" and "Deviations from Design" above — the
cross-aggregate framing was inert (`types`/`tags`/`manufacturers`/`shops`/
`users` are internally consistent, both sides Node-clock via `../clock.ts`);
`categories` is the only table with a DB trigger and therefore the only one
mixing clocks; the concrete consequence is that `categories` rows CAN persist
and be served with `updated_at` earlier than `created_at` (measured: -114ms
to -543ms on this run, and the gate's independent re-run found the drift
had flipped to Postgres ~676ms AHEAD of Node — confirming the drift is real
and variable). Recorded as a `categories`-scoped ticket-sized follow-up
(NOT a cross-aggregate US), not implemented here (needs DDL/`db-reset`, this
change adds none).

### Re-run evidence after the four fixes

**`just db-build && just db-check`** (expect 161/161 after finding 3's new test):

```
$ just db-build
CLI Building entry: index.ts
CJS dist\index.js     151.59 KB
CJS ⚡️ Build success in 77ms
DTS ⚡️ Build success in 5541ms
DTS dist\index.d.ts 1.39 MB

$ just db-check
npm run typecheck
> tsc --noEmit
npm test
> vitest run
 Test Files  10 passed (10)
      Tests  161 passed (161)
   Duration  7.43s
```

Re-ran `just db-check` **4 more times** to confirm stability under the
stricter `toBeGreaterThan` operator (finding 2) — all clean:

```
=== run 1 ===  Test Files  10 passed (10)   Tests  161 passed (161)
=== run 2 ===  Test Files  10 passed (10)   Tests  161 passed (161)
=== run 3 ===  Test Files  10 passed (10)   Tests  161 passed (161)
=== run 4 ===  Test Files  10 passed (10)   Tests  161 passed (161)
```

**`npm run typecheck`** (packages/db, after all four fixes):

```
$ cd packages/db && npm run typecheck
> @safari/db@0.1.0 typecheck
> tsc --noEmit
```
(no output = clean, exit 0)

**`psql`** — categories back to 198/83, zero sentinel leftovers, after the
re-run:

```
$ docker exec safari-postgres psql -U safari -d safari_scraper -t -c "SELECT count(*) FROM categories;"
   198

$ docker exec safari-postgres psql -U safari -d safari_scraper -t -c "SELECT count(*) FROM categories WHERE parent_id IS NULL;"
    83

$ docker exec safari-postgres psql -U safari -d safari_scraper -t -c "SELECT count(*) FROM categories WHERE slug LIKE 'zz-%';"
     0
```

**`npm run lint`** (packages/db, after all four fixes) — unchanged from
before the correction round:

```
Checked 33 files in ~50ms.
Found 27 errors.
Found 1 info.
```

Confirmed split: 20 `format` + 7 `assist/source/organizeImports`, all
pre-existing, none introduced by this round (verified via
`npx biome check . --max-diagnostics=200` grouped by finding type).

**`git diff --stat main -- packages/db`** (final, after the correction round):

```
$ git diff --stat main -- packages/db
 packages/db/index.ts                                              |   5 +
 packages/db/src/repositories/categories.integration.test.ts       | 439 ++++++++++++++++++++-
 packages/db/src/repositories/categories.repository.ts             | 317 +++++++++++++++
 3 files changed, 757 insertions(+), 4 deletions(-)
```

761 changed lines (additions + deletions, up from 708 pre-correction — the
round added a `describe`/`it` for finding 3, explanatory comments for
findings 1-2, and the `updated_at` assertion rewrite for finding 2), vs. the
~475-line PR#1 forecast (+60%). Consistent with the epic's known
estimation-drift pattern; not acted on unilaterally (see "Issues Found").
