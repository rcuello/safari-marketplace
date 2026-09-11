# US-31 — Guardas de id fuera del rango `bigint` (500 vivo en la API)

> `Number.isInteger(1e21)` es `true`. Los guards de id de `types`, `tags` y
> `manufacturers` lo dejan pasar, el valor llega al driver de Postgres y la API
> responde **500**. `categories` ya está corregido (US-28); falta el resto.

**Épico:** ninguno (US standalone)
**Fecha:** 2026-09-11
**Status:** Listo para ejecución
**Depende de:** ninguna (US-28 establece el precedente del arreglo)
**LOC est.:** ~120

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
  `apps/api/rest/src/manufacturers/manufacturers.service.ts:218` y `:254`.
- Reproducido en vivo: `PUT /api/types/1e21`, `PUT /api/tags/1e21`,
  `PUT /api/manufacturers/1e21` y `DELETE /api/types/1e21` → **500**.
  `PUT /api/categories/1e21` → 404 (ya corregido).
- **El precedente del arreglo ya existe**, embarcado en US-28:
  `apps/api/rest/src/categories/categories.service.ts:298` y `:336` usan
  `!Number.isSafeInteger(id) || id <= 0`; y en la capa de datos,
  `packages/db/src/repositories/categories.repository.ts:329`
  (`_assertIntegerRef`) usa `Number.isSafeInteger`. `MAX_SAFE_INTEGER` (2^53) es
  una cota conservadora y sólida por debajo del máximo de `bigint` (2^63).
- **Pendiente de verificar en refinamiento:** `shops.service.ts` no tiene ninguna
  guarda de este tipo (un `grep` de `Number.isInteger` no devuelve nada en ese
  archivo). Hay que determinar si está expuesto por otra vía o si no aplica.

## Scope

**Incluye:** alinear los seis guards de `types`/`tags`/`manufacturers` al
precedente `!Number.isSafeInteger(id) || id <= 0`; auditar `shops` y decidir;
revisar si algún otro repositorio de `packages/db` valida con `Number.isInteger`
y alinearlo; un test por agregado que fije el contrato.

**NO incluye:** cambiar `translateCatalogWriteError` ni el conjunto cerrado de
códigos de dominio (es contrato, CA-7 de US-27a); introducir un
`ExceptionFilter` global; tocar `categories` (ya corregido en US-28); cambios de
DDL; frontend.

## Criterios de aceptación

### CA-1 — Ningún id fuera de rango produce 500
Para cada uno de `types`, `tags`, `manufacturers` (y `shops` si el refinamiento
determina que aplica), tanto en `PUT /:id` como en `DELETE /:id`, los valores
`1e21`, `9223372036854775808`, `-1`, `0` y `1.5` devuelven **4xx** con cuerpo
útil. Ninguno devuelve 500.

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
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `apps/api/rest/src/types/types.service.ts` | guards `:126`, `:151` |
| `apps/api/rest/src/tags/tags.service.ts` | guards `:170`, `:200` |
| `apps/api/rest/src/manufacturers/manufacturers.service.ts` | guards `:218`, `:254` |
| `apps/api/rest/src/shops/shops.service.ts` | según refinamiento |
| `apps/api/rest/src/*/**.service.spec.ts` | un caso por agregado |

## Definición de Done

- [ ] `curl` pegados: los cinco valores de CA-1 contra los tres (o cuatro)
      agregados, con status y cuerpo. Cero 500.
- [ ] `curl` pegado del caso límite de CA-2.
- [ ] `just db-check`, `npx jest`, `just build-api`, `just verify` verdes con
      recuentos reales.
- [ ] Decisión sobre `shops` documentada en el reporte (aplica / no aplica y por
      qué).
- [ ] Status de esta US actualizado.

## Notas para el agente ejecutor

- El arreglo ya está escrito: copiar el patrón de `categories`, no inventar otro.
  Leer primero `apps/api/rest/src/categories/categories.service.ts:284-298` —
  el comentario de cabecera explica por qué `Number.isInteger` no basta.
- `id <= 0` forma parte del precedente. Confirmar que no rompe ninguna ruta que
  hoy acepte id 0 antes de aplicarlo en bloque.
- Este defecto lo encontró un gate adversarial probando entradas hostiles, no un
  test. Al cerrar, dejar la red de regresión (CA-4), que es lo que faltaba.
