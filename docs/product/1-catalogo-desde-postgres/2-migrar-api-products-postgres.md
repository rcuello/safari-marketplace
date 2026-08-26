# US-2 — Migrar /api/products a la capa de datos

> El listado de productos (el endpoint más consultado por la tienda) deja de
> salir del JSON del mock y pasa a consultarse en Postgres vía `@safari/db`,
> preservando el contrato HTTP.

**Épico:** [Épico 1](./README.md)
**Fecha:** 2026-08-25
**Status:** Implementada
**Depende de:** ninguna
**LOC est.:** ~300

## Historia
**Como** estudiante que explora el monorepo, **quiero** que `/api/products`
consulte la misma tabla `products` que llena el scraper, **para** que la
tienda muestre datos vivos de la base y no una copia estática, y el flujo
scraper → base → tienda quede demostrable de punta a punta.

## Contexto

- Hoy `apps/api/rest/src/products/` sirve `src/db/pickbazar/products.json`
  (1200 productos) con filtrado/búsqueda en memoria (`fuse.js`).
- `packages/db/src/repositories/products.repository.ts` ya existe y tiene el
  único test de integración del repo (`products.integration.test.ts`).
- El seed (`db/seed.sql`) contiene exactamente esos 1200 productos con los
  mismos ids, así que la comparación mock-vs-base es directa.
- Los filtros que el frontend envía de verdad están inventariados en
  `apps/shop/src/framework/rest/client/index.ts` (referencia citada por la
  cabecera de `db/schema.sql`); el diseño debe partir de esa lista, no de
  suposiciones.

## Scope
**Incluye:** el endpoint de listado `/api/products` (paginación, búsqueda por
nombre, y los filtros que el cliente REST de la tienda envía y el esquema
puede responder). Ampliar `products.repository.ts` si le falta algún filtro.
**NO incluye:** el detalle por slug ni relacionados (US-3), los demás
catálogos (US-4), popular-products/best-selling u otros endpoints derivados
(inventariarlos y decidir en el design si entran o quedan en mock),
`category_product` (vacía por diseño del seed), cambios de frontend, cambios
a `db/schema.sql`.

## Criterios de aceptación

### CA-1 — Paridad de contrato en el listado
`GET /api/products?limit=30` responde 200 con el mismo shape de paginación
que el mock (mismas claves snake_case, mismos tipos). Los mismos 30 productos
de la primera página del mock aparecen con los mismos ids.

### CA-2 — Búsqueda por nombre contra la base
La búsqueda que la tienda usa (`?name=...` o el parámetro real que envíe el
cliente REST) devuelve resultados desde Postgres usando `contains/insensitive`
(cubierto por `products_nombre_trgm_idx`), no desde el JSON.

### CA-3 — La tienda no distingue el origen
`just verify` pasa: la home renderiza con 30 product cards, igual que antes de
la migración.

### CA-4 — Verificación de origen real
Con un `UPDATE` manual a un producto en psql (`just db-shell`), el cambio se
refleja en la respuesta del endpoint sin reiniciar la API. Se revierte después
(patrón del commit `41f4e7d`).

### CA-5 — Errores de base legibles
Con Postgres apagado (`just db-down`), el endpoint responde un error HTTP
controlado (5xx con cuerpo JSON claro), no un crash del proceso Nest.

## Escenarios Gherkin
```gherkin
Feature: Listado de productos desde Postgres
  Scenario: CA-1 — paridad de contrato
    Given la base sembrada con just db-up y la API arrancada
    When pido GET /api/products con los parámetros por defecto de la tienda
    Then recibo 200 con el mismo shape de paginación que el mock
    And los ids de la primera página coinciden con los del mock

  Scenario: CA-4 — origen real
    Given un producto con nombre conocido
    When ejecuto UPDATE products SET name = 'CANARIO' WHERE id = <id> en psql
    Then GET /api/products?name=CANARIO lo devuelve sin reiniciar la API
```

## Archivos a crear / modificar
| Archivo | Cambio |
|---------|--------|
| `apps/api/rest/src/products/products.service.ts` | consulta a `@safari/db` + traducción camelCase→snake_case |
| `packages/db/src/repositories/products.repository.ts` | filtros faltantes, si los hay |
| `packages/db/src/repositories/products.integration.test.ts` | cobertura de los filtros nuevos |

## Definición de Done
- [x] Salida real de `curl` del endpoint antes (mock) y después (Postgres) pegada, con el diff de claves comentado. Ver `apply-progress.md` del change `migrar-api-products-postgres`.
- [x] Salida real de `just verify` (los 3 servicios OK, cards:30).
- [x] Salida real de `just db-check` en verde.
- [x] Evidencia del CA-4 (UPDATE + curl + revert) pegada.
- [x] Status de esta US actualizado y fila del épico marcada.

## Notas para el agente ejecutor
- Leer primero el servicio actual completo: `fuse.js` y los query params que
  realmente maneja definen el contrato a preservar.
- `packages/db/dist` está gitignored: correr `just db-build` tras clonar.
- El orden de resultados de búsqueda puede diferir del de fuse.js (R-2 del
  épico); documentarlo en el reporte, no perseguir paridad de ranking.
