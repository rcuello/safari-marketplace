# US-66 — El staff de una tienda responde las preguntas de sus productos

> En US-55, responder una pregunta (`PUT /api/questions/:id`) solo lo pueden
> hacer un `super_admin` o el dueño de la tienda. El staff de la tienda recibe
> 403 porque `@safari/db` no exporta ninguna función que diga quién es staff
> de qué tienda. Esta US crea esa función y la usa en la autorización de
> responder.

**Épico:** ninguno (US standalone). Nace del «NO incluye» de
[US-55](./46-api-sin-mocks-json/55-questions-postgres.md).
**Fecha:** 2026-10-22
**Status:** Listo para ejecución
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
| 1 | Qué cuenta como «staff de la tienda» | **Tener una fila en `shop_staff` para esa tienda**, sin exigir el permiso `staff`. La fila es lo que dice de qué tienda es uno; el permiso es global, nadie lo tiene en el seed y la ruta no lleva `@Permissions`. Exigir los dos dejaría la función sin ningún caso real hasta que US-25 reparta el permiso | **Abierta: la confirma el dueño.** Efecto visible: `customer@demo.com` (usuario 2, solo `customer`) podrá responder las preguntas de las tiendas 1 y 2 |
| 2 | Productos y cupones | Fuera de esta US; se mencionan como candidatos a US aparte | **Abierta** |
| 3 | `DELETE /questions/:id` | El staff **no** borra preguntas ajenas: borrar sigue siendo del autor, del dueño o de `super_admin`. Responder y moderar no son lo mismo | Propuesta, sin código que la contradiga |

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

- [ ] La Decisión 1 confirmada por el dueño **antes** de tocar código, y
  anotada aquí.
- [ ] Línea base: `PUT /questions/47` con `customer@demo.com` da 403 hoy.
- [ ] CA-1 en el test de integración y `just db-build` limpio.
- [ ] CA-2 y CA-3 con `curl`, Bearer y status exacto, más el `answer` en
  `psql` tras cada 200.
- [ ] Reposo restaurado: respuestas originales de las preguntas 47 y 52, o
  `just db-reset`.
- [ ] CA-4: `just db-check`, `npx jest`, `just build-api` y `just verify` con
  recuentos.
- [ ] Status actualizado aquí y en el mapa de `docs/product/README.md`.

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
