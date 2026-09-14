# Verification Report

**Change**: `guardas-id-fuera-de-rango-bigint` (US-31)
**Version**: N/A (change activo, sin versionar)
**Mode**: Standard (`strict_tdd: false`)
**Rama verificada**: `us-31-pr3-docs` @ `6a091e2` (árbol limpio al empezar)
**Fecha**: 2026-09-14

Todo lo que sigue es salida real ejecutada por esta fase. Cuando un dato
proviene de `apply-progress.md` y no se re-ejecutó, se dice explícitamente.

---

## Completeness

| Métrica | Valor |
|---|---|
| Tareas totales | 20 |
| Tareas completas | 20 |
| Tareas incompletas | 0 |

Reparto: Fase 1 (3), Fase 2 (5, incluida la obligatoria 2.1b), Fase 3 (6),
Fase 4 (4), Fase 5 (2). Ninguna tarea de implementación quedó sin marcar.

---

## Inventario de las 13 guardas (inspección estática)

`grep -rn "isSafeInteger\|isInteger" apps/api/rest/src/ packages/db/src/` filtrando specs/tests:

| # | Sitio | Predicado | `<= 0` |
|---|---|---|---|
| 1-2 | `types.service.ts:131,157` | `!Number.isSafeInteger(id) \|\| id <= 0` | sí |
| 3-4 | `tags.service.ts:175,206` | ídem | sí |
| 5-6 | `manufacturers.service.ts:223,260` | ídem | sí |
| 7-11 | `users.service.ts:105,125,156,181,228` | ídem | sí |
| 12 | `tags.repository.ts:127` | `!Number.isSafeInteger(typeId)` | **no** (D31-2) |
| 13 | `manufacturers.repository.ts:151` | ídem | **no** (D31-2) |

Único `!Number.isInteger` restante en producción dentro del área de la US:
`products.repository.ts:511` (`_assertIntegerCount` sobre `quantity`), fuera de
scope por el "NO incluye" de la US. `categories.repository.ts:248` usa
`Number.isInteger` en un lookup en memoria, también fuera de scope.

Colocación verificada por lectura (`users.service.ts:92-201`): las cinco guardas
corren **antes** de cualquier llamada al repositorio; en `makeAdmin` opera sobre
el `id` ya derivado de `Number(userId)`; en `banUser` corre **antes** del chequeo
de auto-bloqueo, así que ningún caso de la tabla puede colisionar con el 409.

---

## Build & Tests Execution

**`just db-build`**: ✅

```
✔ Generated Prisma Client (7.10.0) to .\generated\prisma\client in 156ms
CJS dist\index.js     165.27 KB
CJS ⚡️ Build success in 76ms
DTS ⚡️ Build success in 5163ms
DTS dist\index.d.ts 1.40 MB
```

**`just db-check`** (contenedor `safari-postgres` Up/healthy): ✅

```
> @safari/db@0.1.0 typecheck
> tsc --noEmit
  (sin salida — 0 errores)

> @safari/db@0.1.0 test
> vitest run
 RUN  v4.1.11 C:/DevOps/MyGitHub/safari-marketplace/packages/db

 Test Files  10 passed (10)
      Tests  203 passed (203)
   Duration  17.02s
```

**`cd apps/api/rest && npx jest`**: ✅

```
PASS src/categories/categories.service.spec.ts (20.654 s)
PASS src/types/types.service.spec.ts (22.567 s)
PASS src/manufacturers/manufacturers.service.spec.ts (22.896 s)
PASS src/shops/shops.service.spec.ts (22.967 s)
PASS src/common/errors/domain-error.mapper.spec.ts (23.155 s)
PASS src/tags/tags.service.spec.ts (23.155 s)
PASS src/products/products.service.spec.ts (23.611 s)
PASS src/users/user-dto.mapper.spec.ts (23.861 s)
PASS src/users/users.service.spec.ts (24.754 s)

Test Suites: 9 passed, 9 total
Tests:       274 passed, 274 total
Time:        30.704 s
```

Recuentos reproducidos de forma independiente: **203** (vitest) y **274** (jest),
idénticos a los de `apply-progress.md`.

**`just build-api`**: ✅

```
yarn build
$ rimraf dist
$ nest build
Done in 45.94s.
```

**`just verify`** (API + shop + admin levantados por esta fase): ✅

```
OK   API    :9001/api/settings  200  5503B  18ms
OK   Shop   :3003/en  200  190788B  582ms  cards:30
OK   Admin  :3002/en/login  200  72821B  46ms  cards:1
```

Los tres tamaños (`5503B` / `190788B` / `72821B`) coinciden **byte a byte** con
los de `apply-progress.md`: es la evidencia más directa de que el contrato
publicado no se movió (CA-3).

**Coverage**: ➖ no disponible (el repo no tiene umbral configurado;
`openspec/config.yaml` → `coverage_threshold: 0`).

---

## CA-1 — Ningún id fuera de rango produce 500

Ejecutado en vivo contra `just api-dev` (:9001) con Bearer de admin real:

```
$ curl -s -X POST http://localhost:9001/api/token -H "Content-Type: application/json" \
    -d '{"email":"admin@demo.com","password":"demodemo"}'
role: super_admin | permissions: ["super_admin","customer","store_owner"] | token len: 245
```

**Matriz completa: 11 rutas × 5 valores de CA-1 = 55 combinaciones.**
`apply` solo probó 3 de los 5 valores (33 combinaciones); `9223372036854775808`
y `1.5` nunca se habían ejercitado en vivo. Resultado: **55/55 → 404 exacto,
cero 500, cero 4xx genérico**.

```
PUT    /api/types         /1e21                 -> 404
DELETE /api/types         /1e21                 -> 404
PUT    /api/tags          /1e21                 -> 404
DELETE /api/tags          /1e21                 -> 404
PUT    /api/manufacturers /1e21                 -> 404
DELETE /api/manufacturers /1e21                 -> 404
GET    /api/users/1e21                      -> 404
PUT    /api/users/1e21                      -> 404
POST   /api/users/make-admin   user_id=1e21          -> 404
POST   /api/users/block-user   id=1e21               -> 404
POST   /api/users/unblock-user id=1e21               -> 404
---
PUT    /api/types         /9223372036854775808  -> 404
DELETE /api/types         /9223372036854775808  -> 404
PUT    /api/tags          /9223372036854775808  -> 404
DELETE /api/tags          /9223372036854775808  -> 404
PUT    /api/manufacturers /9223372036854775808  -> 404
DELETE /api/manufacturers /9223372036854775808  -> 404
GET    /api/users/9223372036854775808       -> 404
PUT    /api/users/9223372036854775808       -> 404
POST   /api/users/make-admin   user_id=9223372036854775808 -> 404
POST   /api/users/block-user   id=9223372036854775808 -> 404
POST   /api/users/unblock-user id=9223372036854775808 -> 404
---
PUT    /api/types         /-1                   -> 404
DELETE /api/types         /-1                   -> 404
PUT    /api/tags          /-1                   -> 404
DELETE /api/tags          /-1                   -> 404
PUT    /api/manufacturers /-1                   -> 404
DELETE /api/manufacturers /-1                   -> 404
GET    /api/users/-1                        -> 404
PUT    /api/users/-1                        -> 404
POST   /api/users/make-admin   user_id=-1            -> 404
POST   /api/users/block-user   id=-1                 -> 404
POST   /api/users/unblock-user id=-1                 -> 404
---
PUT    /api/types         /0                    -> 404
DELETE /api/types         /0                    -> 404
PUT    /api/tags          /0                    -> 404
DELETE /api/tags          /0                    -> 404
PUT    /api/manufacturers /0                    -> 404
DELETE /api/manufacturers /0                    -> 404
GET    /api/users/0                         -> 404
PUT    /api/users/0                         -> 404
POST   /api/users/make-admin   user_id=0             -> 404
POST   /api/users/block-user   id=0                  -> 404
POST   /api/users/unblock-user id=0                  -> 404
---
PUT    /api/types         /1.5                  -> 404
DELETE /api/types         /1.5                  -> 404
PUT    /api/tags          /1.5                  -> 404
DELETE /api/tags          /1.5                  -> 404
PUT    /api/manufacturers /1.5                  -> 404
DELETE /api/manufacturers /1.5                  -> 404
GET    /api/users/1.5                       -> 404
PUT    /api/users/1.5                       -> 404
POST   /api/users/make-admin   user_id=1.5           -> 404
POST   /api/users/block-user   id=1.5                -> 404
POST   /api/users/unblock-user id=1.5                -> 404
```

### El 404 es de la guarda, no del router ni del permiso (trampa de la DoD)

Discriminación a tres bandas, ejecutada en vivo:

```
=== CUERPOS (la guarda, con token) ===
DELETE /api/types/1e21          : {"statusCode":404,"message":"No existe un type con id 1e+21.","error":"Not Found"}
DELETE /api/tags/9223372036854775808 : {"statusCode":404,"message":"No existe un tag con id 9223372036854776000.","error":"Not Found"}
DELETE /api/manufacturers/1.5   : {"statusCode":404,"message":"No existe una marca con id 1.5.","error":"Not Found"}
GET    /api/users/1e21          : {"statusCode":404,"message":"El identificador de usuario no es válido.","error":"Not Found"}
POST   block-user id=-1         : {"statusCode":404,"message":"El identificador de usuario no es válido.","error":"Not Found"}
POST   make-admin user_id=1.5   : {"statusCode":404,"message":"El identificador de usuario no es válido.","error":"Not Found"}

=== TRAMPA DE PERMISOS: mismas rutas SIN token ===
DELETE /api/types/1e21  sin token : 401 {"statusCode":401,"message":"Token de autenticación ausente o inválido.","error":"Unauthorized"}
GET    /api/users/1e21  sin token : 401 {"statusCode":401,"message":"Token de autenticación ausente o inválido.","error":"Unauthorized"}

=== RUTA INEXISTENTE (404 del router, para contraste) ===
DELETE /api/no-existe/1e21        : 404 {"statusCode":404,"message":"Cannot DELETE /api/no-existe/1e21","error":"Not Found"}
```

Las tres familias de 4xx son textualmente distinguibles: mensaje de dominio
(guarda) vs `Token de autenticación ausente o inválido.` (401 sin token) vs
`Cannot DELETE …` (404 del router de Nest). Ninguna evidencia de CA-1 es un
falso positivo por permisos.

Los `curl` de `apply-progress.md` se auditaron uno a uno: **todos llevan
`-H "Authorization: Bearer $TOKEN"`**; no hay evidencia sin token que invalidar.

### `type_id` de body (parte final de CA-1) y asimetría D31-2

Se añadió un **control**: `type_id: 99999` (inexistente, dentro del rango
seguro). Si `-1`/`0` resuelven por la misma vía que él, la asimetría está
probada, no supuesta.

```
POST /api/tags           type_id=-1                   : 400 {"statusCode":400,"message":"`tags.desconocida` referencia un registro inexistente.","error":"Bad Request"}
POST /api/tags           type_id=0                    : 400 {"statusCode":400,"message":"`tags.desconocida` referencia un registro inexistente.","error":"Bad Request"}
POST /api/tags           type_id=99999                : 400 {"statusCode":400,"message":"`tags.desconocida` referencia un registro inexistente.","error":"Bad Request"}
POST /api/tags           type_id=1e21                 : 400 {"statusCode":400,"message":"`tags.type_id` referencia un registro inexistente (`1e+21`).","error":"Bad Request"}
POST /api/tags           type_id=9223372036854775808  : 400 {"statusCode":400,"message":"`tags.type_id` referencia un registro inexistente (`9223372036854776000`).","error":"Bad Request"}
POST /api/tags           type_id=1.5                  : 400 {"statusCode":400,"message":"`tags.type_id` referencia un registro inexistente (`1.5`).","error":"Bad Request"}
POST /api/manufacturers  type_id=-1                   : 400 {"statusCode":400,"message":"`manufacturers.desconocida` referencia un registro inexistente.","error":"Bad Request"}
POST /api/manufacturers  type_id=0                    : 400 {"statusCode":400,"message":"`manufacturers.desconocida` referencia un registro inexistente.","error":"Bad Request"}
POST /api/manufacturers  type_id=99999                : 400 {"statusCode":400,"message":"`manufacturers.desconocida` referencia un registro inexistente.","error":"Bad Request"}
POST /api/manufacturers  type_id=1e21                 : 400 {"statusCode":400,"message":"`manufacturers.type_id` referencia un registro inexistente (`1e+21`).","error":"Bad Request"}
POST /api/manufacturers  type_id=9223372036854775808  : 400 {"statusCode":400,"message":"`manufacturers.type_id` referencia un registro inexistente (`9223372036854776000`).","error":"Bad Request"}
POST /api/manufacturers  type_id=1.5                  : 400 {"statusCode":400,"message":"`manufacturers.type_id` referencia un registro inexistente (`1.5`).","error":"Bad Request"}
```

Lectura: `-1`, `0` y `99999` producen **el mismo cuerpo exacto** (campo
`desconocida`, sin interpolar valor) ⇒ los tres salen por `P2003` →
`InvalidReferenceError`. `1e21`, `9223372036854775808` y `1.5` producen el
campo real `type_id` **con el valor interpolado** ⇒ salen por
`_assertValidTypeId`. D31-2 queda probada en vivo, no solo por el status.

Sin filas parásitas:

```
$ docker exec safari-postgres psql -U safari -d safari_scraper -t -c "select 'tags:'||count(*) from tags where name like 'zz-verify%' union all ..."
 tags:0
 manufacturers:0
 types:0
```

**Veredicto CA-1: ✅ CUMPLE** (55/55 rutas × valores + 12/12 de `type_id`).

---

## CA-2 — El límite no se adelanta (valor corregido `123456789012345`)

Este era el punto que la spec afirmaba pero que nadie había ejercitado en vivo
con el valor nuevo. Ejecutado ahora en **todos** los agregados, no solo `types`:

```
$ node -e "console.log(Number.isSafeInteger(123456789012345), Number.MAX_SAFE_INTEGER)"
true 9007199254740991

DELETE /api/types         /123456789012345 : 404 {"statusCode":404,"message":"No existe un registro de `types` con id 123456789012345.","error":"Not Found"}
PUT    /api/types         /123456789012345 : 404 {"statusCode":404,"message":"No existe un registro de `types` con id 123456789012345.","error":"Not Found"}
DELETE /api/tags          /123456789012345 : 404 {"statusCode":404,"message":"No existe un registro de `tags` con id 123456789012345.","error":"Not Found"}
PUT    /api/tags          /123456789012345 : 404 {"statusCode":404,"message":"No existe un registro de `tags` con id 123456789012345.","error":"Not Found"}
DELETE /api/manufacturers /123456789012345 : 404 {"statusCode":404,"message":"No existe un registro de `manufacturers` con id 123456789012345.","error":"Not Found"}
PUT    /api/manufacturers /123456789012345 : 404 {"statusCode":404,"message":"No existe un registro de `manufacturers` con id 123456789012345.","error":"Not Found"}
GET    /api/users/123456789012345           : 404 {"statusCode":404,"message":"No existe un usuario con id 123456789012345.","error":"Not Found"}
PUT    /api/users/123456789012345           : 404 {"statusCode":404,"message":"No existe un usuario con id 123456789012345.","error":"Not Found"}
POST   block-user  id=123456789012345       : 404 {"statusCode":404,"message":"No existe un usuario con id 123456789012345.","error":"Not Found"}
POST   make-admin  user_id=123456789012345  : 404 {"statusCode":404,"message":"No existe un usuario con id 123456789012345.","error":"Not Found"}
```

El mensaje es el discriminador pedido y separa limpiamente las dos vías:

| Vía | Mensaje del catálogo | Mensaje de `users` |
|---|---|---|
| Guarda (id fuera de rango) | `` No existe un type con id 1e+21. `` | `El identificador de usuario no es válido.` |
| `RecordNotFoundError` (fila inexistente) | `` No existe un registro de `types` con id 123456789012345. `` | `No existe un usuario con id 123456789012345.` |

Los 10 casos devuelven el mensaje de **fila inexistente**, en los 4 agregados.
Ninguno devuelve 400. El corte está exactamente en `Number.isSafeInteger`.

**Veredicto CA-2: ✅ CUMPLE** — y con cobertura más ancha que la que pedía la
spec (la spec solo exigía `types`, `tags`/`manufacturers` y `users`; se probaron
los 10 endpoints que aceptan un id).

---

## CA-3 — Sin regresión de contrato

1. **Suites**: 274 jest + 203 vitest, todas verdes (salidas arriba). Ningún test
   preexistente se tuvo que ajustar: los `it` de `NaN` fueron *reemplazados* por
   `it.each` que los contienen como primer caso.
2. **`just verify`**: los tres tamaños de respuesta coinciden byte a byte con la
   evidencia previa.
3. **Round trip de escritura en vivo con id válido**, atravesando las guardas
   modificadas (`types.service.ts:131,157`):

```
GET /api/types           : 200
GET /api/users/3         : 200 claves: 15 | email: admin@demo.com | hash presente: false

POST   : {"id":22,"name":"zz-verify-us31-roundtrip","language":"es","translated_languages":["en"],"slug":"zz-verify-us31-roundtrip","banners":[],"promotional_sliders":null,"settings":{},"icon":null}
PUT  /api/types/22 : 200 {"id":22,"name":"zz-verify-us31-roundtrip-editado",...,"slug":"zz-verify-us31-roundtrip",...}
DELETE /api/types/22 : 200
GET    /api/types/22 tras borrar (limpieza confirmada): 404
```

`GET /api/users/3` mantiene las **15 claves** de `/me` y no filtra el hash
(`hash presente: false`). El round trip deja la base como estaba
(`select count(*) from types where name like 'zz-verify%'` → `0`).

**Veredicto CA-3: ✅ CUMPLE.**

---

## CA-4 — Red de regresión: prueba adversarial de las 13 guardas

La exigencia es "un caso que **falle** si alguien revierte a `Number.isInteger`".
No basta leer los tests: se revirtió el predicado de verdad, en tres tandas, y
se restauró con `git checkout` después de cada una.

### Tanda A — las 6 guardas de ruta del catálogo revertidas a `!Number.isInteger(id)`

```
Test Suites: 3 failed, 3 total
Tests:       18 failed, 61 passed, 79 total
```

18 fallos = 6 guardas × 3 casos discriminantes (`cero`, `negativo`, `1e21`). El
caso `NaN` pasa con ambos predicados, exactamente como predice DD31-D — por eso
no cuenta como testigo y por eso el recuento es 18 y no 24.

### Tanda B — las 5 guardas de `users` revertidas

```
Test Suites: 1 failed, 1 total
Tests:       15 failed, 29 passed, 44 total
```

15 fallos = 5 guardas × 3 casos. Cubre `findOne`, `update`, `banUser`,
`activeUser` y `makeAdmin` (este último con su tabla de **strings**
`'abc'`/`'0'`/`'-5'`/`'1e21'`, testigo `grantPermissionMock`).

### Tanda C — las 2 guardas de FK revertidas (el hueco que solo el orquestador no había cerrado)

```
prisma:error Invalid `prisma.manufacturer.create()` invocation
Invalid input value: invalid input syntax for type bigint: "1e+21"

FAIL  src/repositories/manufacturers.integration.test.ts > … typeId fuera del rango seguro de bigint (1e21) …
AssertionError: expected PrismaClientKnownRequestError{ …(7) } to be an instance of InvalidReferenceError
FAIL  src/repositories/tags.integration.test.ts > … typeId fuera del rango seguro de bigint (1e21) …
AssertionError: expected PrismaClientKnownRequestError{ …(7) } to be an instance of InvalidReferenceError

 Test Files  2 failed (2)
      Tests  2 failed | 39 passed (41)
```

El fallo reproduce literalmente el defecto que la US persigue
(`invalid input syntax for type bigint: "1e+21"`): sin la guarda el valor llega
al driver. Testigo real, no vacuo.

### Tanda D — el riesgo "Media" de la propuesta: añadir `<= 0` a la FK por inercia

```
$ sed -i '127s/!Number.isSafeInteger(typeId)/(!Number.isSafeInteger(typeId) || typeId <= 0)/' src/repositories/tags.repository.ts

FAIL  src/repositories/tags.integration.test.ts > … typeId negativo (-5) ⇒ InvalidReferenceError por P2003 (FK), NO por la guarda (US-31, D31-2)
AssertionError: expected '`tags.type_id` referencia un registro…' not to contain '-5'

Expected: "-5"
Received: "`tags.type_id` referencia un registro inexistente (`-5`)."

 Test Files  1 failed (1)
      Tests  1 failed | 19 passed (20)
```

El discriminador por mensaje de DD31-E funciona: si alguien "arregla" la
asimetría, el test se pone en rojo con un mensaje que explica por qué.

### Resumen de CA-4

| Guardas | Testigo | ¿Falla al revertir? | Evidencia |
|---|---|---|---|
| 6 de ruta del catálogo | `it.each` × `updateXMock`/`deleteXMock` | ✅ 18 rojos | Tanda A |
| 5 de `users` | `it.each` × `findUserWithRelationsMock`/`setUserActiveMock`/`grantPermissionMock` | ✅ 15 rojos | Tanda B |
| 2 de FK | `*.integration.test.ts` (vitest) | ✅ 2 rojos | Tanda C |
| asimetría D31-2 | `not.toContain('-5')` | ✅ 1 rojo | Tanda D |

**13/13 guardas con testigo probado en ejecución. Veredicto CA-4: ✅ CUMPLE.**

Árbol restaurado tras cada tanda: `git status --porcelain` sin resultados.

---

## Spec Compliance Matrix

### `flat-catalogs-api`

| Requirement | Scenario | Evidencia | Result |
|---|---|---|---|
| `types` nunca 500 | CA-4 — id inexistente (`99999`) | `types.service.spec.ts` (preexistente, verde) | ✅ COMPLIANT |
| `types` nunca 500 | CA-4 — nombre que slugifica a vacío | `types.service.spec.ts:145-149` | ✅ COMPLIANT |
| `types` nunca 500 | CA-4 — colisión de slug no es error | suite `types` + `tags.integration.test.ts` | ✅ COMPLIANT |
| `types` nunca 500 | CA-4 — id de ruta fuera del rango seguro | `it.each` (Tanda A) + 10 `curl` en vivo | ✅ COMPLIANT |
| `types` nunca 500 | CA-4 — el límite no se adelanta (`123456789012345`) | `curl` en vivo (2 rutas) | ⚠️ PARTIAL — sin test automatizado |
| `types` nunca 500 | CA-4 — antirregresión del predicado | Tanda A (6 rojos en `types`) | ✅ COMPLIANT |
| `tags`/`manufacturers` nunca 500 | CA-4 — `type_id` inexistente | `curl` `type_id=99999` + integration tests | ✅ COMPLIANT |
| `tags`/`manufacturers` nunca 500 | CA-4 — id inexistente y colisión de slug | suites preexistentes verdes | ✅ COMPLIANT |
| `tags`/`manufacturers` nunca 500 | CA-4 — id de ruta fuera del rango seguro | `it.each` (Tanda A) + 20 `curl` | ✅ COMPLIANT |
| `tags`/`manufacturers` nunca 500 | CA-4 — `type_id` fuera del rango seguro | 2 integration tests (Tanda C) + 6 `curl` | ✅ COMPLIANT |
| `tags`/`manufacturers` nunca 500 | CA-4 — `type_id` negativo/cero por FK, no por guarda | 2 integration tests (Tanda D) + `curl` con control `99999` | ✅ COMPLIANT |
| `tags`/`manufacturers` nunca 500 | CA-4 — el límite no se adelanta | `curl` en vivo (4 rutas) | ⚠️ PARTIAL — sin test automatizado |
| `tags`/`manufacturers` nunca 500 | CA-4 — antirregresión del predicado | Tanda A (12 rojos) | ✅ COMPLIANT |

### `user-management-api`

| Requirement | Scenario | Evidencia | Result |
|---|---|---|---|
| Detalle con 15 claves (CA-3) | Key-set idéntico a /me, 404 ante id inexistente, sin hash | `users.service.spec.ts` + `curl GET /api/users/3` (15 claves, sin hash) | ✅ COMPLIANT |
| Detalle con 15 claves (CA-3) | CA-3 — id de ruta fuera del rango seguro | `it.each` `findOne`/`update` (Tanda B) + 10 `curl` | ✅ COMPLIANT |
| Detalle con 15 claves (CA-3) | CA-3 — el límite no se adelanta | `curl` `GET`/`PUT /api/users/123456789012345` | ⚠️ PARTIAL — sin test automatizado |
| Detalle con 15 claves (CA-3) | CA-3 — antirregresión del predicado | Tanda B (6 rojos) | ✅ COMPLIANT |
| Bloqueo/promoción (CA-4) | Dos bloqueos seguidos + login 401 | `users.service.spec.ts` (preexistente, verde) | ✅ COMPLIANT |
| Bloqueo/promoción (CA-4) | Auto-bloqueo y último super_admin → 409 | `users.service.spec.ts` (preexistente, verde) | ✅ COMPLIANT |
| Bloqueo/promoción (CA-4) | make-admin concede el permiso, no antes del login | `users.service.spec.ts` (preexistente, verde) | ✅ COMPLIANT |
| Bloqueo/promoción (CA-4) | CA-4 — id de body fuera del rango seguro | `it.each` `banUser`/`activeUser`/`makeAdmin` (Tanda B) + 15 `curl` | ✅ COMPLIANT |
| Bloqueo/promoción (CA-4) | CA-4 — antirregresión del predicado | Tanda B (9 rojos) | ✅ COMPLIANT |

**Compliance summary: 19/22 COMPLIANT, 3/22 PARTIAL, 0 UNTESTED, 0 FAILING.**
Los 3 PARTIAL son el mismo escenario ("el límite no se adelanta") repetido en
los tres requirements: verificado en vivo, sin red automatizada (ver WARNING-1).

### Fusión al archivar — sin pérdida de escenarios

Comprobado programáticamente que los 4 bloques `MODIFIED` contienen íntegros los
escenarios que ya existen en las specs principales (regla de
`openspec-convention.md`: `MODIFIED` reemplaza el bloque completo):

```
flat-catalogs-api / `types`:                main 3 → delta 6 (conserva los 3, +3)
flat-catalogs-api / `tags` y `manufacturers`: main 2 → delta 7 (conserva los 2, +5)
user-management-api / Detalle (CA-3):       main 1 → delta 4 (conserva el 1, +3)
user-management-api / Bloqueo (CA-4):       main 3 → delta 5 (conserva los 3, +2)
```

Ningún escenario se perdería al fusionar.

---

## Coherence (Design)

| Decisión | ¿Respetada? | Evidencia |
|---|---|---|
| DD31-A — mensajes preservados por agregado | ✅ | Los 4 mensajes de la tabla aparecen literalmente en los `curl` en vivo |
| DD31-B — forma literal de los dos guards | ✅ | `grep` de las 13 guardas; FK sin `<= 0` |
| DD31-C — comentario largo en un sitio, resto referencia | ✅ | `users.service.ts:93-103` es el ancla; los otros 4 llevan 1 línea. Ver SUGGESTION-1 |
| DD31-C — corrección del cross-ref falso | ✅ | `grep -rn "users.service.ts:94" apps/api/rest/src/` → sin resultados |
| DD31-D — testigo `not.toHaveBeenCalled()` | ✅ | Presente en los 11 `it.each`; probado en Tandas A y B |
| DD31-E — testigo de FK en vitest, no en jest | ✅ | Tanda C: los 2 tests fallan en `packages/db`, donde el código corre de verdad |
| DD31-F — bloques verdes-independientes | ✅ | `db-check` y `jest` verdes por separado |
| DD31-G — enmienda quirúrgica sin renumerar CA | ✅ | CA-1..CA-4 intactos; sin CA-5 |
| D31-1 — cota en `2^53` | ✅ | `Number.isSafeInteger(123456789012345)` pasa; `9223372036854775808` no |
| D31-2 — asimetría ruta/FK | ✅ | Control `99999` idéntico a `-1`/`0` en vivo; Tanda D en rojo al romperla |
| D31-3 — no se tocan los traductores | ✅ | `git show --stat` de los 3 commits: ni `domain-errors.ts` ni `domain-error.mapper.ts` |
| D31-4 — ningún status cambia (404/404/400) | ✅ | 55 × 404 + 12 × 400, cero desviaciones |
| Prefijo real `/api/users/...` | ✅ | `users.controller.ts:25,54,59,70`; `@Body('id')` y `@Body('user_id')` confirmados |

---

## Issues Found

### CRITICAL
Ninguno.

### WARNING

**WARNING-1 — CA-2 no tiene red de regresión automatizada.**
`grep -rn "123456789012345\|9007199254740991"` sobre `apps/api/rest/src/` y
`packages/db/src/` → **sin resultados**. CA-2 ("el límite no se adelanta")
descansa exclusivamente en los `curl` de esta fase. Consecuencia concreta: si
alguien endureciera una guarda de más (p. ej. `id > 1_000_000 → 404`), las 477
pruebas automatizadas seguirían verdes y solo se detectaría en producción.
Es asimétrico frente a CA-4, que sí tiene 13 testigos. **No bloquea el
archivado** (CA-2 está verificado, y la US no exigía test para él), pero el
arreglo es barato: un `it` por agregado con un id grande-pero-seguro afirmando
que el mock del repositorio **sí** fue llamado. Recomendación: US de
seguimiento, o incluirlo si se reabre esta rama.

**WARNING-2 — cobertura automatizada parcial de los valores de CA-1.**
Las tablas `it.each` usan `NaN`/`0`/`-5`/`1e21`. Los otros dos valores que CA-1
nombra explícitamente —`9223372036854775808` y `1.5`— **no aparecen en ningún
test**: solo se verificaron en vivo (en esta fase; `apply` ni siquiera eso).
`1e21` y `NaN` cubren las dos ramas del predicado, así que la protección real es
suficiente y no hay hueco de comportamiento; el hueco es de trazabilidad entre
el GIVEN de los escenarios Gherkin y la tabla de casos. No bloquea.

### SUGGESTION

**SUGGESTION-1 — cross-ref inexacto en `users.service.ts:101`.**
El doc-comment cita `D31-A`; el identificador real es `DD31-A` (`design.md`);
`D31-1..4` son las decisiones de `proposal.md`. Es la tercera referencia
cruzada imprecisa que aparece en este ciclo (tras `users.service.ts:94,113,142`
y el ejemplo `1e16`). Un carácter; no confunde a nadie hoy, pero el patrón
sugiere revisar las citas de decisiones antes de cerrar.

**SUGGESTION-2 — `openspec/config.yaml` y `proposal.md` declaran "4 suites / 65
tests".** El estado real es 9 suites / 274 tests. Ya señalado en
`apply-progress.md`; sigue vigente y es dato que arrastrará la próxima US.
Fuera del scope congelado de esta US.

### Defectos corregidos por esta fase

**DEFECTO-1 (corregido) — el ejemplo falso `1e16` sobrevivía en el Gherkin de la
US.** El commit de gate `6a091e2` sustituyó `1e16` por `123456789012345` en CA-2,
la propuesta y los dos delta specs, pero **no en el bloque Gherkin que está 20
líneas más abajo en el mismo archivo**:
`docs/product/31-guardas-id-fuera-de-rango-bigint.md:114-117` seguía diciendo
`Given un id 10000000000000000 que no existe en la tabla`. Es exactamente el
valor que el propio documento declara inválido dos párrafos antes
(`Number.isSafeInteger(1e16) === false`), así que el archivo se contradecía a sí
mismo. Corregido a `123456789012345` con el `Then` explicitado
(`404 por fila inexistente`). Severidad: **WARNING** si se hubiera archivado así
(documento vivo y auto-contradictorio, no un registro histórico).

**DEFECTO-2 (corregido) — la DoD declaraba menos cobertura de la que CA-1 pide.**
La DoD marcaba `[x]` sobre "33 combinaciones" (3 valores × 11 rutas), pero CA-1
enumera **cinco** valores. `apply` nunca ejercitó `9223372036854775808` ni `1.5`
en vivo (la tarea 4.2 solo pedía tres, así que la tarea estaba mal dimensionada
respecto al CA que debía cerrar). Esta fase ejecutó las 55 combinaciones y
actualizó la DoD para que refleje CA-1 completo, señalando qué cubrió `apply` y
qué cubrió `verify`. Severidad: **WARNING** — no era un defecto de código, sino
una DoD que se cerraba sin cubrir su propio CA.

---

## Verdict

**PASS WITH WARNINGS**

Las 13 guardas están implementadas con el predicado correcto y la asimetría
D31-2 intacta; los cuatro CA se verificaron con ejecución real (55 `curl` de
CA-1, 10 de CA-2, 477 tests automatizados, 36 rojos provocados a propósito para
probar que la red de regresión no es vacua); los delta specs no pierden
escenarios al fusionar. Los dos WARNING son huecos de cobertura automatizada de
CA-2 y de trazabilidad de dos valores de CA-1, ninguno de comportamiento.
**Listo para `sdd-archive`.**
