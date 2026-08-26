# US-3 — Detalle de producto y relacionados desde Postgres

> La página de producto de la tienda (`/products/{slug}`) se alimenta de la
> base: detalle por slug y productos relacionados salen de `products` en
> Postgres.

**Épico:** [Épico 1](./README.md)
**Fecha:** 2026-08-25
**Status:** Implementada
**Depende de:** US-2
**LOC est.:** ~200

## Historia
**Como** estudiante que sigue el flujo de un dato, **quiero** que el detalle
de producto salga de Postgres, **para** que un producto scrapeado sea
navegable en la tienda con su propia URL, no solo visible en el listado.

## Contexto

- La app identifica productos por `slug` (la URL es `/products/{slug}`) y el
  esquema lo garantiza único global (`db/schema.sql`, función `slugify()`).
- El endpoint de detalle del mock devuelve el producto con sus objetos
  embebidos (`shop`, `type`, etc. — inventariar el shape exacto con `curl`
  antes de diseñar) y la tienda pide además productos relacionados.

## Scope
**Incluye:** el endpoint de detalle por slug que la tienda consume y el de
relacionados (si es endpoint separado o parámetro del mismo — verificar en el
cliente REST de la tienda). 404 controlado para slug inexistente.
**NO incluye:** reviews/questions/wishlist del producto (fuera del esquema del
catálogo), listado (US-2), catálogos de apoyo (US-4), cambios de frontend.

## Criterios de aceptación

### CA-1 — Detalle por slug con paridad de contrato
`GET` del detalle de un slug del seed responde 200 con las mismas claves
snake_case y los mismos objetos embebidos que el mock para ese producto.

### CA-2 — 404 de dominio
Un slug inexistente responde 404 con cuerpo JSON controlado (no 500, no crash),
traducido desde el error de dominio del repositorio.

### CA-3 — Relacionados desde la base
Los productos relacionados salen de una consulta a Postgres (misma regla de
relación que use el mock — p. ej. mismo type — documentada en el design).

### CA-4 — Página de producto navegable
La página `/products/{slug}` de la tienda renderiza 200 para un producto del
seed, con la API corriendo contra Postgres.

## Escenarios Gherkin
```gherkin
Feature: Detalle de producto desde Postgres
  Scenario: CA-2 — slug inexistente
    Given la API arrancada contra la base sembrada
    When pido el detalle del slug "no-existe-xyz"
    Then recibo 404 con un cuerpo JSON de error controlado
```

## Archivos a crear / modificar
| Archivo | Cambio |
|---------|--------|
| `apps/api/rest/src/products/products.service.ts` | detalle por slug + relacionados vía `@safari/db` |
| `packages/db/src/repositories/products.repository.ts` | `findBySlug` + relacionados, si faltan |
| `packages/db/src/repositories/products.integration.test.ts` | casos de slug existente/inexistente |

## Definición de Done
- [x] Salida real de `curl` del detalle (mock vs Postgres) pegada para el mismo slug.
  Diff `node -e` (ver `apply-progress.md`, CA-1): raíz `21 -> 21`, mismo orden `true`,
  `faltan: []`, `sobran: []`, `related n: 20` con los mismos ids `1..20` en ambos lados,
  `items con shape malo: 0`.
- [x] Salida real del `curl` 404 pegada.
  `curl -i http://localhost:9001/api/products/no-existe-xyz` → `HTTP/1.1 404 Not Found`,
  body `{"statusCode":404,"message":"No existe un producto con slug \`no-existe-xyz\`.","error":"Not Found"}`;
  `GET /api/types` sigue en `200` después (proceso vivo).
- [x] Captura o `curl` de `/products/{slug}` de la tienda en 200.
  `curl -s -w '%{http_code}' http://localhost:3003/en/products/apples` → `200`,
  HTML contiene `Apples` (`grep -c 'Apples'` → 1). Verificado en modo `just shop-dev`
  (ISR corre por request; ver design.md, nota CA-4).
- [x] Salida real de `just db-check` en verde.
  ```
  npm run typecheck
  > tsc --noEmit
   Test Files  1 passed (1)
        Tests  14 passed (14)
  ```
  (EXIT=0. El gate corre limpio: la receta ya normaliza el cwd con
  `cd "$(pwd)"` desde el commit `083d8e9`, así que el fallo de casing de
  Windows descrito en US-2 no aplica aquí.)
- [x] Status de esta US actualizado y fila del épico marcada.

## Notas para el agente ejecutor
- Inventariar primero con `curl` el shape real del detalle del mock: los
  objetos embebidos (shop/type/gallery) definen cuántos `include` necesita la
  consulta Prisma.
- BigInt de Prisma no serializa a JSON directo: verificar cómo lo resolvió
  `/api/settings` y seguir el mismo patrón.
