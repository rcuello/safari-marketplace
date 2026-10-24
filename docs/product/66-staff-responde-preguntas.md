# US-66 — El staff de una tienda responde las preguntas de sus productos

> En US-55, responder una pregunta (`PUT /api/questions/:id`) solo lo pueden
> hacer un `super_admin` o el dueño de la tienda. El staff de la tienda recibe
> 403 porque `@safari/db` no exporta ninguna función que diga quién es staff
> de qué tienda. Esta US crea esa función y la usa en la autorización de
> responder.

**Épico:** ninguno (US standalone). Nace del «NO incluye» de
[US-55](./46-api-sin-mocks-json/55-questions-postgres.md).
**Fecha:** 2026-10-22
**Status:** ✅ Completada (2026-10-23)
**Depende de:** US-55 (crea `questions`, `answerQuestion` y la autorización
que esta US amplía). No toca DDL, pero sí el barrel `packages/db/index.ts`,
que comparte con el Épico 46. Por eso **no va en paralelo** con ninguna US de
ese épico (R-2).
**LOC est.:** ~250

## Historia

**Como** empleado (staff) de una tienda, **quiero** responder desde el admin
las preguntas que los clientes hacen sobre los productos de esa tienda,
**para** que el dueño no tenga que contestarlas todas en persona.

## Contexto — verificado en código (2026-10-22)

**La tabla ya existe y está sembrada** (US-41):

- `db/schema.sql:462-467`: `shop_staff (user_id, shop_id, created_at)`, un
  pivote puro con PK `(user_id, shop_id)` y las dos FK en CASCADE. El índice
  inverso es `shop_staff_tienda_idx` (`:954`). No hay columna de rol.
- `db/generate-seed.mjs:107-111` (`staffAsignaciones`) siembra tres filas:
  usuario 2 en las tiendas 1 y 2, y usuario 3 en la tienda 1. El usuario 1
  queda fuera a propósito, porque ya es dueño de las 12 tiendas.

**Nadie la lee todavía:**

- En `packages/db/src/repositories/` no hay repositorio que consulte
  `shop_staff`. Solo la toca su test de integración
  (`shop-staff.integration.test.ts:1-6`), que dice que el repositorio «llega
  en US-42». US-42 (`docs/product/40-identidad-extendida-postgres/42-staffs-postgres.md`)
  sigue en «Listo para ejecución».
- `packages/db/index.ts:51` exporta solo el tipo `ShopStaffRecord`, sin
  ninguna función.

**El permiso `staff` existe, pero nadie lo tiene:**

- El catálogo de permisos (`db/generate-seed.mjs:79-89`) incluye `staff`
  (id 4) «sin asignar hasta que US-25 la reparta». En la base no hay ninguna
  fila de `permission_user` con `staff`. Los permisos del seed son: 1
  `customer`+`store_owner`; 2, 4 y 5 `customer`; 3
  `customer`+`store_owner`+`super_admin`.
- `apps/api/rest/src/auth/decorators/permissions.decorator.ts:22` define
  `ADMIN_OWNER_AND_STAFF = ['super_admin','store_owner','staff']`, y
  `auth/auth.service.ts:66` ordena los roles como `super_admin > store_owner >
  staff > customer`.

**La autorización de hoy** (`apps/api/rest/src/questions/questions.service.ts`):

- `update` (responder, `:133-149`) y `delete` (`:151-163`) usan el método
  privado `isAdminOrShopOwner` (`:165-175`). `super_admin` pasa sin
  consultar; para el resto, `findShopOwnerById(record.shopId) === user.sub`.
- `questions.controller.ts:48` (`@Put`) y `:58` (`@Delete`) **no llevan
  `@Permissions`**: basta un token válido. La decisión de quién responde vive
  entera en el servicio.

**Datos para la evidencia** (seed en reposo): las preguntas por tienda son
tienda 1 → 5 (ids 47-51), tienda 2 → 4 (52-55), tienda 5 → 3 (66-68) y tienda
6 → 39 (1-39). La pregunta 68, que usó la evidencia de US-55, es de la tienda
5, donde el usuario 2 no es staff.

**Hallazgo, fuera de alcance:** la propiedad por tienda de productos
(`products.service.ts:118`, DD29-4) y de cupones (`coupons.service.ts:116-125`,
`assertCanManage`) tiene el mismo hueco. Su guard admite el permiso `staff`
(`ADMIN_OWNER_AND_STAFF`), pero el servicio solo compara con el dueño, así que
un staff de verdad recibe 403. Esta US no los toca: ver Decisión 2.

## Decisiones

| # | Tema | Propuesta | Estado |
|---|---|---|---|
| 1 | Qué cuenta como «staff de la tienda» | **Tener una fila en `shop_staff` para esa tienda**, sin exigir el permiso `staff`. La fila es lo que dice de qué tienda es uno; el permiso es global, nadie lo tiene en el seed y la ruta no lleva `@Permissions`. Exigir los dos dejaría la función sin ningún caso real hasta que US-25 reparta el permiso | **Confirmada por el dueño (2026-10-23): solo la fila.** Efecto visible: `customer@demo.com` (usuario 2, solo `customer`) responde las preguntas de las tiendas 1 y 2 |
| 2 | Productos y cupones | Fuera de esta US; se mencionan como candidatos a US aparte | **Cerrada a petición del dueño (ver Ampliación)** |
| 3 | `DELETE /questions/:id` | El staff **no** borra preguntas ajenas: borrar sigue siendo del autor, del dueño o de `super_admin`. Responder y moderar no son lo mismo | Aplicada: `delete` no consulta `shop_staff` |

## Scope

**Incluye:**

- una función de solo lectura en `@safari/db` que diga si un usuario es staff
  de una tienda (por ejemplo `isShopStaff(userId, shopId): Promise<boolean>`),
  con su test de integración y exportada en el barrel;
- usarla en la autorización de `PUT /questions/:id` (responder), además del
  dueño y de `super_admin`;
- actualizar los specs de `questions.service.spec.ts` y el mensaje del 403 si
  deja de decir «solo el dueño».

**NO incluye:**

- el repositorio completo de staff (`/staffs`, `/my-staffs`, `/all-staffs`):
  es US-42;
- repartir el permiso `staff` en el seed (US-25);
- ampliar al staff la propiedad de productos y cupones (Decisión 2);
- que el staff borre preguntas (Decisión 3);
- `my-questions`, que sigue siendo solo del autor;
- cambiar decoradores de autorización (R-6 del Épico 46);
- tocar frontends o el DDL.

## Criterios de aceptación

### CA-1 — La función de pertenencia

Contra el seed en reposo:

| Llamada | Resultado |
|---|---|
| usuario 2, tienda 1 | `true` |
| usuario 2, tienda 2 | `true` |
| usuario 3, tienda 1 | `true` |
| usuario 2, tienda 5 | `false` |
| usuario 1, tienda 1 (dueño, sin fila) | `false`: ser dueño no es ser staff |
| ids inexistentes o no válidos | `false`, sin lanzar |

### CA-2 — El staff responde

| Llamada `PUT /questions/:id {answer}` | Status |
|---|---|
| `customer@demo.com` (staff de la tienda 1) sobre la pregunta 47 | **200**; el `GET` siguiente trae el nuevo `answer` y `updated_at` posterior |
| ídem sobre la pregunta 52 (tienda 2) | **200** |
| ídem sobre la pregunta 68 (tienda 5, no es staff) | **403** |
| `customer2@demo.com` (sin fila en `shop_staff`) sobre la 47 | **403** |
| `store_owner@demo.com` (dueño) y `admin@demo.com` sobre la 47 | **200**, igual que hoy |

Si el dueño cambia la Decisión 1 y pide también el permiso `staff`, la tabla
se rehace con un usuario centinela que tenga los dos, y se borra al final.

### CA-3 — Borrar no cambia

`DELETE /questions/47` con `customer@demo.com` da **403**, porque no es el
autor ni el dueño y no es `super_admin` (Decisión 3). El autor, el dueño y
`super_admin` siguen pudiendo borrar como en US-55.

> **Corrección al ejecutar (2026-10-23):** la pregunta 47 **es** del usuario
> 2. De hecho, todas las preguntas de las tiendas 1 y 2 (47-55) las hizo
> `customer@demo.com`, así que como autor puede borrar la 47 (200, regla de
> US-55). El otro staff sembrado (usuario 3) es `super_admin` y pasa igual.
> CA-3 se demuestra con una **pregunta centinela de `customer2@demo.com`**
> sobre el producto 412 (tienda 1). `customer@demo.com` intenta borrarla y
> recibe 403, y su autor la borra con 200. La Decisión 3 no cambia.

### CA-4 — Sin regresión

- `just db-check`, `npx jest`, `just build-api` y `just verify` en verde, con
  los recuentos.
- `/api/settings` sigue en 5503 B.
- Las respuestas de prueba se revierten al terminar, o se corre `just
  db-reset`.

## Escenarios Gherkin

```gherkin
Feature: El staff de la tienda responde preguntas
  Scenario: CA-2 — el staff responde una pregunta de su tienda
    Given customer@demo.com con fila en shop_staff para la tienda 1
    When hace PUT /api/questions/47 con un answer nuevo
    Then la respuesta es 200
    And GET /api/questions/47 devuelve ese answer

  Scenario: CA-2 — el staff no responde en una tienda ajena
    Given customer@demo.com sin fila en shop_staff para la tienda 5
    When hace PUT /api/questions/68 con un answer
    Then la respuesta es 403

  Scenario: CA-3 — el staff no borra preguntas
    Given customer@demo.com staff de la tienda 1
    When hace DELETE /api/questions/47
    Then la respuesta es 403
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `packages/db/src/repositories/` | la función de pertenencia, en un archivo `shop-staff.repository.ts` nuevo o dentro de `shops.repository.ts` (que ya tiene `findShopOwnerById`) |
| `packages/db/src/repositories/shop-staff.integration.test.ts` | los casos de CA-1 |
| `packages/db/index.ts`, `packages/db/README.md` | barrel y documentación |
| `apps/api/rest/src/questions/questions.service.ts` | responder admite al staff |
| `apps/api/rest/src/questions/questions.service.spec.ts` | casos nuevos |

## Definición de Done

- [x] La Decisión 1 confirmada por el dueño **antes** de tocar código, y
  anotada aquí.
- [x] Línea base: `PUT /questions/47` con `customer@demo.com` da 403 hoy.
- [x] CA-1 en el test de integración y `just db-build` limpio.
- [x] CA-2 y CA-3 con `curl`, Bearer y status exacto, más el `answer` en
  `psql` tras cada 200.
- [x] Reposo restaurado: respuestas originales de las preguntas 47 y 52, o
  `just db-reset`.
- [x] CA-4: `just db-check`, `npx jest`, `just build-api` y `just verify` con
  recuentos.
- [x] Status actualizado aquí y en el mapa de `docs/product/README.md`.

## Evidencia (2026-10-23)

**Implementación:**

- `isShopStaff(userId, shopId)` vive en `shops.repository.ts`, junto a
  `findShopOwnerById`. Es un `count` sobre `shop_staff` y devuelve `false`
  con ids no válidos. Se exporta en el barrel y está en el README de
  `packages/db`.
- `QuestionService.update` sigue este orden: `super_admin` → dueño →
  `isShopStaff`, solo si no es dueño. El 403 dice ahora «Solo el dueño o el
  staff de la tienda pueden responder esta pregunta.».
- `delete` no cambia.

**Línea base** (antes del cambio):

```
PUT /api/questions/47 (customer@demo.com)
{"statusCode":403,"message":"Solo el dueño de la tienda puede responder esta pregunta.","error":"Forbidden"}
HTTP 403
```

**CA-1** — `npx vitest run src/repositories/shop-staff.integration.test.ts --reporter=verbose`:

```
✓ isShopStaff (US-66, CA-1) > usuario 2, tienda 1 ⇒ true
✓ isShopStaff (US-66, CA-1) > usuario 2, tienda 2 ⇒ true
✓ isShopStaff (US-66, CA-1) > usuario 3, tienda 1 ⇒ true
✓ isShopStaff (US-66, CA-1) > usuario 2, tienda 5 ⇒ false
✓ isShopStaff (US-66, CA-1) > usuario 1, tienda 1 ⇒ false
✓ isShopStaff (US-66, CA-1) > usuario 999999, tienda 1 ⇒ false
✓ isShopStaff (US-66, CA-1) > usuario 2, tienda 999999 ⇒ false
✓ isShopStaff (US-66, CA-1) > ids no válidos ⇒ false sin lanzar
✓ tripwire: las escrituras de este archivo no tocan el seed > los 3 pares sembrados siguen intactos
      Tests  17 passed (17)
```

`just db-build`: `DTS ⚡️ Build success`.

**CA-2** — `PUT /api/questions/:id {answer}` con Bearer:

```
customer     PUT 47  → 200  {"id":47,"user_id":2,"shop_id":1,"product_id":412,...,"answer":"Staff US-66 (47)",...
GET /api/questions/47 → {"id":47,"answer":"Staff US-66 (47)","updated_at":"2026-10-24T00:28:34.331Z"}
customer     PUT 52  → 200  {"id":52,"user_id":2,"shop_id":2,"product_id":110,...,"answer":"Staff US-66 (52)",...
customer     PUT 68  → 403  {"statusCode":403,"message":"Solo el dueño o el staff de la tienda pueden responder esta pregunta.","error":"Forbidden"}
customer2    PUT 47  → 403  {"statusCode":403,"message":"Solo el dueño o el staff de la tienda pueden responder esta pregunta.","error":"Forbidden"}
store_owner  PUT 47  → 200  {"id":47,...,"answer":"Dueño US-66 (47)",...
admin        PUT 47  → 200  {"id":47,...,"answer":"Admin US-66 (47)",...
```

`psql` después de las escrituras (la 68 sigue intacta y la 47 conserva la
última respuesta, la de `admin`):

```
 id | shop_id |             answer              |         updated_at
----+---------+---------------------------------+----------------------------
 47 |       1 | Admin US-66 (47)                | 2026-10-24 00:28:37.096+00
 52 |       2 | Staff US-66 (52)                | 2026-10-24 00:28:35.158+00
 68 |       5 | its sweet as it contains suger. | 2022-03-18 10:20:42+00
```

**CA-3**, con la centinela de la corrección de arriba:

```
POST /api/questions (customer2@demo.com) {"question":"Centinela US-66","product_id":412,"shop_id":1}
→ {"id":73,"user_id":4,"shop_id":1,"product_id":412,"question":"Centinela US-66","answer":null,...
customer     DELETE 73  → 403  {"statusCode":403,"message":"No puedes borrar esta pregunta.","error":"Forbidden"}
customer2    DELETE 73  → 200  {"id":73,"user_id":4,"shop_id":1,...
select count(*) from questions where question='Centinela US-66' → 0
```

**Incidente durante la evidencia:** el script de CA-3 ejecutó por error un
`DELETE /questions/47` con `customer@demo.com`, que es el autor. La API lo
borró, como manda US-55. El reposo se restauró con `just db-reset`:

```
 id | shop_id | user_id |             answer              |       updated_at
----+---------+---------+---------------------------------+------------------------
 47 |       1 |       2 | Any color of your choice.       | 2022-03-18 10:41:58+00
 52 |       2 |       2 | yes it is available.            | 2022-03-18 10:43:39+00
 68 |       5 |       2 | its sweet as it contains suger. | 2022-03-18 10:20:42+00
select count(*) from questions → 68
```

**CA-4**, tras el `db-reset`:

```
just db-check                         →  Test Files  32 passed (32) / Tests  410 passed (410)
npx jest                              →  Test Suites: 34 passed, 34 total / Tests: 542 passed, 542 total
npx tsc --noEmit -p tsconfig.json     →  EXIT=0
just build-api                        →  Done in 19.52s. EXIT=0
just verify
OK   API    :9001/api/settings  200  5503B  573ms
OK   Shop   :3003/en  200  190788B  386ms  cards:30
OK   Admin  :3002/en/login  200  72821B  1063ms  cards:1
```

`questions.service.spec.ts` tiene 4 casos nuevos:

- el staff responde y se le consulta solo cuando no es dueño;
- sin fila de staff da 403, con el mensaje nuevo;
- una consulta de staff sin conexión da 503;
- el staff no borra y ni siquiera se consulta `shop_staff`.

Además, los casos de dueño y `super_admin` comprueban que no se consulta
`shop_staff`.

**Fuera de alcance (Decisión 2), luego cerrado en la Ampliación de abajo:** `products.service.ts:118` y
`coupons.service.ts` (`assertCanManage`) tienen el mismo hueco. Su guard
admite `staff`, pero el servicio solo compara con el dueño. Son candidatos a
una US aparte que reutilice `isShopStaff`.

## Notas para el agente ejecutor

- **Que la función sea mínima, no un repositorio de staff.** US-42 hará el
  CRUD de `/staffs`; esta US solo necesita una consulta de pertenencia. Si
  US-42 ya está implementada cuando se ejecute esta, se reutiliza lo suyo.
- **Mantener el orden de las comprobaciones:** primero `super_admin` (sin
  consultar), después el dueño (`findShopOwnerById`) y, solo si no lo es, la
  fila de `shop_staff`. Así el caso común no hace una consulta de más.
- **No mover la lógica a un guard.** La ruta no lleva `@Permissions` y la
  autorización depende de la tienda de la pregunta, que solo conoce el
  servicio.
- Mencionar en el reporte el hallazgo de productos y cupones (Decisión 2).

## Ampliación: productos y cupones (2026-10-23)

El dueño pidió cerrar la Decisión 2 **en esta misma rama**, sin esperar a
una US aparte: las rutas de escritura de productos y cupones llevan el guard
`@Permissions(...ADMIN_OWNER_AND_STAFF)`, pero el servicio solo comparaba con
el dueño, así que un staff real recibía 403. Se reutiliza `isShopStaff` tal
cual (sin tocar `packages/db`, el DDL, el seed, los frontends ni `questions`).

**Qué cambió:**

- `apps/api/rest/src/products/products.service.ts`: `create`, `update` y
  `remove` admiten al staff de la tienda. Orden: `super_admin` (sin
  consultar) → dueño (`findShopOwnerById`) → staff (`isShopStaff`, solo si
  no es dueño). Mover un producto (`PUT` con `shop_id` distinto) exige poder
  gestionar **ambas** tiendas, cada lado por su cuenta (dueño o staff). La
  semántica de tienda inexistente no cambia: `findShopOwnerById → null` deja
  pasar sin consultar `shop_staff` para que el repositorio dé el 400 (P2003).
- `apps/api/rest/src/coupons/coupons.service.ts`: `assertCanManage` admite
  al staff con el mismo orden. Los cupones globales (`shop_id null`) siguen
  siendo solo de `super_admin`, y el staff no llega a consultar nada en ese
  caso.
- Specs: `products.service.spec.ts` (+16 casos: staff de la tienda pasa en
  las 3 rutas y se le consulta tras el dueño; staff de otra tienda 403 sin
  escribir; dueño y `super_admin` no consultan `shop_staff`; tienda
  inexistente no consulta; mover exige ambas tiendas, con el caso mixto dueño
  de la actual + staff de la destino) y `coupons.service.spec.ts` (+6 casos,
  incluido el cupón global para el staff). La matriz CA-5 de productos
  ahora fija `isShopStaff → false` por defecto y asegura que el caso «staff
  sin relación» sí consulta `shop_staff` antes del 403.

**Decisiones tomadas al ejecutar:**

- No se creó un helper compartido: son cinco sitios con el mismo `if` de
  tres condiciones y dos semánticas distintas (tienda inexistente pasa en
  `create`/destino, no aplica en actual/`remove`); un helper habría tenido
  que parametrizar eso. Se repitió el patrón, como permite la consigna.
- Los errores de lectura de `isShopStaff` **no** se envuelven con
  `readError`: en estos dos servicios `findShopOwnerById` tampoco lo está
  (a diferencia de `questions`), y envolver solo la mitad habría sido
  inconsistente. Un fallo de conexión en ese tramo sigue saliendo como 500,
  igual que hoy con el dueño. Candidato a homogeneizar aparte.
- Los decoradores/guards no se tocan (R-6 del Épico 46).

**Nota del guard:** el permiso `staff` sigue sin repartirse en el seed
(US-25). Por eso `customer@demo.com` (usuario 2, con fila en `shop_staff`
para las tiendas 1 y 2) **sigue recibiendo 403 desde el guard**, antes de
llegar al servicio; el caso positivo se demuestra con un usuario centinela
creado por SQL con el permiso `staff` (id 4) y fila en `shop_staff` para la
tienda 1, borrado al terminar.

**Evidencia:**

`npx jest` (apps/api/rest), `npx tsc --noEmit -p tsconfig.json` y `just db-check`:

```
Test Suites: 34 passed, 34 total
Tests:       564 passed, 564 total        (542 en US-66 + 22 de esta Ampliación)
EXIT=0

npx tsc --noEmit -p tsconfig.json → EXIT=0

just db-check → Test Files 32 passed (32) / Tests 410 passed (410) / EXIT=0
```

Reposo medido antes de empezar: `users 11 | permission_user 20 | shop_staff 3 |
products 1200 | coupons 10`. Centinela (SQL): usuario 86
`centinela@us66-staff.test`, `password_hash` copiado del usuario 2, permisos
`{customer,staff}`, fila `shop_staff (86, 1)`.

`curl` con Bearer (la API levantada de cero con `just api-dev`; cuerpos en
archivos JSON con `--data-binary`):

```
== Guard: customer@demo.com (fila en shop_staff 1 y 2, SIN permiso staff) ==
customer POST /products (tienda 1)                         → 403  {"statusCode":403,"message":"No tienes permisos suficientes para esta operación.","error":"Forbidden"}
customer POST /coupons (tienda 1)                          → 403  {"statusCode":403,"message":"No tienes permisos suficientes para esta operación.","error":"Forbidden"}

== Productos: centinela (permiso staff + fila shop_staff tienda 1) ==
centinela POST /products (tienda 1)                        → 201  {"id":1277,"name":"Centinela US-66b tienda 1",...
centinela PUT /products/1277 {name} (tienda 1)             → 200  {"id":1277,"name":"Centinela US-66b tienda 1 (editado por staff)",...
centinela PUT /products/1277 {shop_id:5} (mover a tienda 5) → 403  {"statusCode":403,"message":"No tienes permisos sobre la tienda 5.","error":"Forbidden"}
centinela POST /products (tienda 5)                        → 403  {"statusCode":403,"message":"No tienes permisos sobre la tienda 5.","error":"Forbidden"}
admin POST /products (tienda 5) — recurso centinela ajeno → 201  {"id":1278,"name":"Centinela US-66b tienda 5",...
centinela PUT /products/1278 {name} (tienda 5)             → 403  {"statusCode":403,"message":"No tienes permisos sobre la tienda 5.","error":"Forbidden"}
centinela DELETE /products/1278 (tienda 5)                 → 403  {"statusCode":403,"message":"No tienes permisos sobre la tienda 5.","error":"Forbidden"}
centinela DELETE /products/1277 (tienda 1)                 → 200  {"id":1277,"name":"Centinela US-66b tienda 1 (editado por staff)",...
admin DELETE /products/1278 (limpieza)                     → 200  {"id":1278,...

== Cupones: centinela ==
centinela POST /coupons (tienda 1)                         → 201  {"id":17,"code":"US66B-STAFF-1",...,"amount":5,...
centinela PUT /coupons/17 {amount:7} (tienda 1)            → 200  {"id":17,"code":"US66B-STAFF-1",...,"amount":7,...
centinela POST /coupons (tienda 5)                         → 403  {"statusCode":403,"message":"No tienes permisos sobre la tienda 5.","error":"Forbidden"}
admin POST /coupons (tienda 5) — recurso centinela ajeno → 201  {"id":18,"code":"US66B-STAFF-5",...
centinela PUT /coupons/18 {amount:7} (tienda 5)            → 403  {"statusCode":403,"message":"No tienes permisos sobre la tienda 5.","error":"Forbidden"}
centinela DELETE /coupons/18 (tienda 5)                    → 403  {"statusCode":403,"message":"No tienes permisos sobre la tienda 5.","error":"Forbidden"}
centinela DELETE /coupons/17 (tienda 1)                    → 200  {"id":17,"code":"US66B-STAFF-1",...,"amount":7,...
admin DELETE /coupons/18 (limpieza)                        → 200  {"id":18,"code":"US66B-STAFF-5",...
```

Limpieza (`DELETE FROM users WHERE email LIKE '%@us66-staff.test'`; las FK
en CASCADE se llevan `permission_user` y `shop_staff`) y reposo verificado:

```
 users | permission_user | shop_staff | products | coupons
-------+-----------------+------------+----------+---------
    11 |              20 |          3 |     1200 |      10
productos_centinela 0 | cupones_centinela 0 | filas_staff_centinela 0
```

Solo avanzaron las secuencias de `products` y `coupons` (ids 1277-1278 y
17-18 consumidos), no las filas. No hizo falta `just db-reset`.

Build y humo, con la ampliación incluida (los corrió el agente principal):

```
just build-api  →  Done in 29.41s.
just verify
OK   API    :9001/api/settings  200  5503B  576ms
OK   Shop   :3003/en  200  190788B  798ms  cards:30
OK   Admin  :3002/en/login  200  72821B  46809ms  cards:1
```
