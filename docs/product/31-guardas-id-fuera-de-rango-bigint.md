# US-31 — Guardas de id fuera del rango `bigint` (500 vivo en la API)

> `Number.isInteger(1e21)` es `true`. Los guards de id de `types`, `tags`,
> `manufacturers` y `users`, y las dos guardas de FK (`type_id`) de
> `packages/db`, lo dejan pasar, el valor llega al driver de Postgres y la API
> responde **500**. `categories` (US-28) y `shops` (US-30) ya están
> corregidos; falta el resto.

**Épico:** ninguno (US standalone)
**Fecha:** 2026-09-11
**Status:** Implementada
**Depende de:** ninguna (US-28 establece el precedente del arreglo)
**LOC est.:** ~230

## Historia
**Como** consumidor de la API, **quiero** que un id numérico malformado o
desmesurado devuelva un 4xx con cuerpo útil, **para** que un cliente con un bug
de serialización no reciba un 500 opaco ni ensucie los logs del servidor con
errores del driver.

## Contexto

- Hallazgo de un gate adversarial durante US-28 (2026-09-10/11). **Es un defecto
  vivo en código ya mergeado en `main`**, no una regresión de US-28.
- `Number.isInteger(1e21)` y `Number.isInteger(9223372036854775808)` son `true`:
  no tienen parte decimal. Pero exceden `Number.MAX_SAFE_INTEGER` (2^53) y el
  rango de un `bigint` de Postgres (2^63-1). El valor atraviesa la guarda, llega
  a Prisma y el driver lanza `invalid input syntax for type bigint: "1e+21"` o
  `Value out of range for the type`, que no mapea a ningún código del conjunto
  cerrado de `translateCatalogWriteError` y degrada al 500 literal del mapper.
- Guards afectados, todos con `!Number.isInteger(id)`:
  `apps/api/rest/src/types/types.service.ts:126` y `:151`;
  `apps/api/rest/src/tags/tags.service.ts:170` y `:200`;
  `apps/api/rest/src/manufacturers/manufacturers.service.ts:218` y `:254`;
  `apps/api/rest/src/users/users.service.ts:94,113,142,165,211`
  (`findOne`, `update`, `makeAdmin`, `banUser`, `activeUser`). Más dos
  guardas de FK con el mismo defecto de fondo (`!Number.isInteger(typeId)`,
  sin `<= 0` por diseño — D31-2):
  `packages/db/src/repositories/tags.repository.ts:115` y
  `manufacturers.repository.ts:139` (`_assertValidTypeId`).
- Reproducido en vivo: `PUT /api/types/1e21`, `PUT /api/tags/1e21`,
  `PUT /api/manufacturers/1e21` y `DELETE /api/types/1e21` → **500**.
  `PUT /api/categories/1e21` → 404 (ya corregido).
- **El precedente del arreglo ya existe**, embarcado en US-28:
  `apps/api/rest/src/categories/categories.service.ts:298` y `:336` usan
  `!Number.isSafeInteger(id) || id <= 0`; y en la capa de datos,
  `packages/db/src/repositories/categories.repository.ts:329`
  (`_assertIntegerRef`) usa `Number.isSafeInteger`. `MAX_SAFE_INTEGER` (2^53) es
  una cota conservadora y sólida por debajo del máximo de `bigint` (2^63).
- **Decisión sobre `shops`, resuelta: no aplica.** US-30 ya corrigió sus dos
  guardas de id (`shops.service.ts:285,373`) con el mismo patrón
  (`!Number.isSafeInteger(id) || id <= 0`) antes de que arrancara esta US.
  No hay trabajo pendiente en ese módulo.

## Scope

**Incluye:** alinear los seis guards de `types`/`tags`/`manufacturers` y los
cinco de `users` al precedente `!Number.isSafeInteger(id) || id <= 0`;
alinear las dos guardas de FK (`type_id`) de `tags`/`manufacturers` en
`packages/db` a `!Number.isSafeInteger(typeId)`, **sin** `<= 0` (D31-2); un
test por guarda (13 en total) que fije el contrato.

**NO incluye:** cambiar `translateCatalogWriteError` ni el conjunto cerrado de
códigos de dominio (es contrato, CA-7 de US-27a); introducir un
`ExceptionFilter` global; tocar `categories` (US-28) ni `shops` (US-30), ya
corregidos; `products.repository.ts:511` (`_assertIntegerCount` sobre
`quantity`, columna `integer` — otra familia de overflow) ni
`categories.repository.ts:248` (lookup en un `Map` en memoria, no llega al
driver); cambios de DDL; frontend.

## Criterios de aceptación

### CA-1 — Ningún id fuera de rango produce 500
Para cada uno de `types`, `tags`, `manufacturers` (`PUT /:id`, `DELETE /:id`) y
`users` (`GET /api/users/:id`, `PUT /api/users/:id`,
`POST /api/users/make-admin`, `POST /api/users/block-user`,
`POST /api/users/unblock-user`), los valores `1e21`, `9223372036854775808`,
`-1`, `0` y `1.5` devuelven **4xx** con cuerpo útil. Ninguno devuelve 500.
Además, el `type_id` de body en `POST`/`PUT /api/tags` y `/api/manufacturers`
con esos mismos valores fuera de rango también devuelve 400, nunca 500.

### CA-2 — El límite queda fijado donde corresponde
`1e16` (dentro de `MAX_SAFE_INTEGER`) sigue comportándose como hoy: 404 si no
existe la fila, no 400. El corte está en `Number.isSafeInteger`, no antes.

### CA-3 — Sin regresión de contrato
Los códigos de estado y los cuerpos de las rutas existentes no cambian para
entradas válidas. `just db-check`, `npx jest` en `apps/api/rest`,
`just build-api` y `just verify` verdes, con recuentos.

### CA-4 — Red de regresión
Un test por agregado afectado que falle si alguien revierte el guard a
`Number.isInteger`. No vale una aserción que pase con el comportamiento roto.

## Escenarios Gherkin

```gherkin
Feature: Guardas de id fuera del rango bigint
  Scenario: CA-1 — id en notacion exponencial
    Given la API levantada
    When se hace PUT /api/types/1e21 con un cuerpo valido
    Then la respuesta es 4xx
    And no es 500

  Scenario: CA-2 — el limite no se adelanta
    Given un id 10000000000000000 que no existe en la tabla
    When se hace DELETE /api/tags/10000000000000000
    Then la respuesta es 404 y no 400

  Scenario: CA-1 — id de users en notacion exponencial
    Given la API levantada y un Bearer de admin
    When se hace GET /api/users/1e21 o POST /api/users/block-user con id 1e21
    Then la respuesta es 404
    And no es 500
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `apps/api/rest/src/types/types.service.ts` | guards `:126`, `:151` |
| `apps/api/rest/src/tags/tags.service.ts` | guards `:170`, `:200` |
| `apps/api/rest/src/manufacturers/manufacturers.service.ts` | guards `:218`, `:254` |
| `apps/api/rest/src/users/users.service.ts` | guards `:94,113,142,165,211` |
| `packages/db/src/repositories/tags.repository.ts` | `_assertValidTypeId` (`:115`), sin `<= 0` |
| `packages/db/src/repositories/manufacturers.repository.ts` | `_assertValidTypeId` (`:139`), sin `<= 0` |
| `apps/api/rest/src/{types,tags,manufacturers}/*.service.spec.ts` | `it.each` de 4 casos por guard |
| `apps/api/rest/src/users/users.service.spec.ts` | `it.each` de 4 casos por guard (5) |
| `packages/db/src/repositories/{tags,manufacturers}.integration.test.ts` | +2 tests de FK c/u (`1e21` y `-5`/`P2003`) |

## Definición de Done

- [x] `curl` con Bearer admin real (nunca sin token) pegados: `1e21`/`0`/`-1`
      contra las 11 rutas de `types`/`tags`/`manufacturers`/`users` → 404
      exacto en las 33 combinaciones, cero 500. `type_id` de `tags`/
      `manufacturers` con `-1`/`0`/`1e21` → 400 vía `P2003`/guarda, cero 500.
      Evidencia completa en `openspec/changes/guardas-id-fuera-de-rango-bigint/apply-progress.md`
      (Fase 4).
- [x] `curl` pegado del caso límite de CA-2 (`DELETE /api/types/123456789012345`
      → 404 por fila inexistente, nunca 400; ver hallazgo sobre el ejemplo
      `1e16` en `apply-progress.md`, Fase 4 — `1e16` en realidad excede
      `Number.MAX_SAFE_INTEGER` y lo atrapa la propia guarda, no la búsqueda
      de fila).
- [x] `just db-build` (`packages/db`), `just db-check` (203 tests, 10
      archivos), `cd apps/api/rest && npx jest` (274 tests, 9 suites),
      `just build-api` y `just verify` (API/Shop/Admin los tres `OK`) verdes,
      recuentos reales pegados en `apply-progress.md`.
- [x] Decisión sobre `shops`: **no aplica** — US-30 ya corrigió sus guardas
      (`shops.service.ts:285,373`) antes de que arrancara esta US.
- [x] Status de esta US actualizado a `Implementada`.

## Notas para el agente ejecutor

- El arreglo ya está escrito: copiar el patrón de `categories`, no inventar otro.
  Leer primero `apps/api/rest/src/categories/categories.service.ts:284-298` —
  el comentario de cabecera explica por qué `Number.isInteger` no basta.
- `id <= 0` forma parte del precedente. Confirmar que no rompe ninguna ruta que
  hoy acepte id 0 antes de aplicarlo en bloque.
- Este defecto lo encontró un gate adversarial probando entradas hostiles, no un
  test. Al cerrar, dejar la red de regresión (CA-4), que es lo que faltaba.
