# US-5 — Endpoints derivados del catálogo desde Postgres

> Los 6 métodos de `products` y `shops` que siguen sirviendo JSON del mock
> pasan a Postgres. Incluye sembrar los datos de ranking que hoy no existen
> en la base y sin los cuales "popular" y "más vendido" no tienen por dónde
> ordenar.

**Épico:** [Épico 1](./README.md)
**Fecha:** 2026-08-31
**Status:** ✅ Implementada
**Depende de:** US-2, US-4a
**LOC est.:** ~250

## Historia
**Como** usuario de la tienda, **quiero** que los carruseles de destacados,
las vistas de inventario y el buscador de tiendas cercanas salgan de la misma
base que el resto del catálogo, **para** que dejen de mostrar un JSON
congelado de 2021 que no cambia aunque la base cambie.

## Contexto

- La migración del Épico 1 (US-2/3/4a/4b) dejó `products` y `shops`
  **híbridos**: sus listados y detalles salen de Postgres, pero 7 métodos
  siguen leyendo `@db/*.json`. Verificado en runtime:
  `/api/popular-products` devuelve 10 filas con 10 `created_at` **distintos**
  de 2021 (firma del mock), mientras `/api/categories` devuelve un único
  `created_at` (el `now()` del último `db-up`).
- **El bloqueante real no es el código, son los datos**: en `products` hay
  `ratings > 0` en **0** filas y `sold_quantity > 0` en **2** de 1200. No hay
  criterio por el que ordenar "popular" ni "más vendido".
- La causa está localizada: `products.json` —fuente del seed— no trae
  `ratings` ni `orders_count`. Pero `popular-products.json` y
  `best-selling-products.json` **sí** los traen (`orders_count`, `ratings`,
  `total_reviews`, `total_sales`) para 15 ids concretos: `4,1,3,5,888,972,
  973,976,2,25` y `888,892,887,883,946`.
- `db/generate-seed.mjs` (281 líneas) ya lee los JSON del mock y emite
  `seed.sql`; enriquecer los productos con esos campos es una extensión suya,
  no un mecanismo nuevo.
- Las columnas destino **ya existen** en `db/schema.sql`: `ratings
  numeric(3,2)`, `total_reviews integer`, `sold_quantity integer`. **No hace
  falta tocar el DDL.**
- `shops.settings->'location'` trae `lat`/`lng` reales en **6 de 12** tiendas,
  así que `near-shop` es migrable sin datos nuevos.

## Scope
**Incluye:** enriquecer `generate-seed.mjs` para que los productos tomen
`ratings`/`total_reviews`/`sold_quantity` de los dos JSON de ranking y
regenerar `db/seed.sql`; ampliar `packages/db` con lo que falta (criterio de
orden en `listProducts`, filtro por `quantity`, orden en `listShops`, consulta
geo para tiendas cercanas) con sus tests de integración; y migrar los 6
métodos a la capa de datos.
**NO incluye:** `getStaffs` (no existe tabla de usuarios/staff — es dominio
transaccional, de otro épico), escrituras reales (`create`/`update`/`remove`
siguen siendo stubs del mock en toda la API), tablas nuevas, cambios al DDL,
el árbol de categorías, el frontend, ni los servicios que hoy son 100% mock.

## Criterios de aceptación

### CA-1 — Destacados con datos reales de ranking
`GET /api/popular-products` y `GET /api/best-selling-products` salen de
Postgres, ordenados por el criterio que fije el design, y devuelven productos
cuyo ranking viene del seed enriquecido (no ceros).

### CA-2 — Inventario desde la base
`GET /api/products-stock` devuelve los productos con stock bajo y
`GET /api/draft-products` los borradores, ambos desde Postgres. La base ya
tiene 11 filas con `quantity <= 9` y 1 con `status = 'draft'` para probarlo.

### CA-3 — Tiendas desde la base
`GET /api/new-shops` y `GET /api/near-shop?lat=&lng=` salen de Postgres;
el segundo usa `settings->'location'` e ignora las tiendas sin coordenadas.

### CA-4 — Contratos HTTP preservados
La forma de cada respuesta (claves, `snake_case`, envoltorio de paginación)
no cambia. Se acepta la divergencia ya embarcada de `created_at`/`updated_at`
documentada en `CLAUDE.md`.

### CA-5 — Sin regresión y sin mock huérfano
`just db-check` verde tras regenerar el seed (`just db-reset`), y los imports
de JSON que queden sin uso en `products.service.ts`/`shops.service.ts` se
eliminan. Los que sostienen `getStaffs` y los stubs de escritura se quedan,
declarados.

## Escenarios Gherkin
```gherkin
Feature: Endpoints derivados servidos desde Postgres
  Scenario: CA-1 — los destacados dejan de venir del JSON
    Given la base sembrada con el seed enriquecido
    When se consulta GET /api/popular-products
    Then todas las filas comparten el mismo created_at del ultimo db-up
    And ninguna trae la fecha de 2021 del mock

  Scenario: CA-3 — tienda sin coordenadas
    Given una tienda cuyo settings->'location' esta vacio
    When se consulta GET /api/near-shop con lat y lng
    Then esa tienda no aparece en el resultado y la consulta no falla
```

## Archivos a crear / modificar
| Archivo | Cambio |
|---------|--------|
| `db/generate-seed.mjs` | fusionar el ranking de `popular-products.json` y `best-selling-products.json` en las filas de `products` |
| `db/seed.sql` | regenerado (artefacto, no se edita a mano) |
| `packages/db/src/repositories/products.repository.ts` | criterio de orden + filtro por `quantity` en `listProducts` |
| `packages/db/src/repositories/shops.repository.ts` | criterio de orden + consulta por cercanía sobre `settings->'location'` |
| `packages/db/src/repositories/*.integration.test.ts` | cobertura de lo anterior |
| `apps/api/rest/src/products/products.service.ts` | migrar 4 métodos; quitar los JSON que queden sin uso |
| `apps/api/rest/src/shops/shops.service.ts` | migrar 2 métodos; idem |

## Definición de Done
- [x] `just db-reset` con el seed regenerado, y `SELECT count(*) FILTER (WHERE ratings > 0)` pegado mostrando filas con ranking real.

  ```
  $ docker exec safari-postgres psql -U safari -d safari_scraper -c \
    "SELECT count(*) FILTER (WHERE ratings>0) r, count(*) FILTER (WHERE sold_quantity>0) sq,
            count(*) FILTER (WHERE total_reviews>0) tr, count(*) n FROM products;"
   r | sq | tr |  n
  ---+----+----+------
   6 |  7 |  6 | 1200
  (1 row)

  $ docker exec safari-postgres psql -U safari -d safari_scraper -c \
    "SELECT (SELECT count(*) FROM shops), (SELECT max(id) FROM shops), (SELECT count(*) FROM categories);"
   count | max | count
  -------+-----+-------
      12 |  15 |   198
  (1 row)
  ```

- [x] `curl` de los 6 endpoints con salida real pegada, mostrando el `created_at` uniforme de la base y no las fechas de 2021.

  ```
  $ curl -s http://localhost:9001/api/popular-products | node -e "..." # ids
  [4, 1, 3, 2, 5, 25, 6, 7, 8, 9]

  $ curl -s http://localhost:9001/api/best-selling-products | node -e "..." # ids
  [888, 1, 2, 883, 887]

  $ curl -s http://localhost:9001/api/products-stock | node -e "..." # total, ids
  total: 11, ids: [2, 190, 1014, 1015, 1017, 1018, 1021, 1022, 1023, 1024, 1028]

  $ curl -s http://localhost:9001/api/draft-products | node -e "..." # total, ids
  total: 1, ids: [454]

  $ curl -s http://localhost:9001/api/new-shops | node -e "..." # total
  total: 0, data: []

  $ curl -s http://localhost:9001/api/near-by-shop/40.7128/-74.0060 | node -e "..."
  count: 6, ids: [5, 1, 6, 2, 4, 3]   # created_at: "2026-08-31T18:48:34.006Z" (uniforme, último db-up)

  $ curl -s -w ' <- %{http_code}\n' http://localhost:9001/api/near-by-shop/undefined/undefined
  [] <- 200

  $ curl -s -w ' <- %{http_code}\n' http://localhost:9001/api/near-by-shop/abc/0
  [] <- 200
  ```

  Todos los ids coinciden exactamente con las "Resultados esperados" de `design.md`.

- [x] `just db-check` verde (incluye los tests nuevos de `packages/db`).

  ```
  $ just db-check
  ...
   Test Files  6 passed (6)
        Tests  57 passed (57)
  ```

  `just build-api && (cd apps/api/rest && yarn test)` también verdes (0 errores
  de compilación; 20/20 tests preexistentes de `products.service.spec.ts`,
  sin tocar — no cubre los 4 endpoints migrados).

- [x] Comparación antes/después de la forma de cada respuesta (CA-4).

  Diff de key-sets (mock vs Postgres), sin `.sort()` — el orden es contrato:

  | Endpoint | Divergencia |
  |---|---|
  | `popular-products` / `best-selling-products` | S-1: 46 claves (mock) → 20 claves (`toProductDto`) |
  | `products-stock` / `draft-products` | Ninguna — mismo key-set, mismo orden |
  | `new-shops` | Ninguna — ambos `{data: [], total: 0}` |
  | `near-by-shop` | Ninguna — 14 claves idénticas, mismo orden (S-3: `created_at`/`updated_at` con `now()` del `db-up`) |

  `/api/settings` (no tocado por esta US) sigue en 5503 bytes, precedente que
  se reconfirmó durante la corrida.

- [x] Status de esta US actualizado y fila del épico marcada.

## Notas para el agente ejecutor
- **Dos bugs del mock se CORRIGEN, no se preservan — DECIDIDO por el dueño del
  repo (2026-08-31)**. Es un cambio de comportamiento deliberado y debe
  declararse como tal en el design, no colarse como efecto de la migración:
  1. `getNearByShop` (`shops.service.ts`) hoy es literalmente
     `return nearShops;` — ignora `lat` y `lng` y devuelve una lista fija de 6
     tiendas. Pasa a filtrar y ordenar por cercanía real con
     `settings->'location'`. La ruta real es `/api/near-by-shop/:lat/:lng`
     (path params), no una query string.
  2. `type_slug` en `getPopularProducts`/`getBestSellingProducts` hoy descarta
     el ranking curado y hace búsqueda difusa sobre el catálogo entero. Pasa a
     filtrar DENTRO del conjunto rankeado.
- **Sin radio en `near-by-shop` — DECIDIDO por el dueño del repo
  (2026-08-31)**: devuelve TODAS las tiendas con coordenadas, ordenadas por
  distancia ascendente. Contexto que motivó la decisión: los `distance` del
  mock (5–21 km) están **inventados** — las 6 tiendas con coordenadas están en
  Nueva Jersey, Illinois, Nueva Zelanda, Londres, Nueva York y Washington, y
  Kearny y Ramarama distan 14.187 km entre sí. Con haversine real la tarjeta
  mostrará hasta `14193.57km Away`. Se acepta: el dato raro viene del seed, no
  de la implementación, y un radio dejaría el carrusel vacío desde casi
  cualquier punto. La forma del contrato (14 claves, `distance` numérica) se
  preserva; solo cambian las magnitudes.
- **Criterio de ranking — DECIDIDO por el dueño del repo (2026-08-31), no
  re-abrir**: `popular-products` ordena por **`ratings` desc** y
  `best-selling-products` por **`sold_quantity` desc**. Son dos criterios
  distintos y ambas columnas ya existen; es la lectura natural de los nombres
  de los endpoints. `products` no tiene `orders_count` ni `total_sales`: el
  design debe declarar explícitamente a qué columna se mapea cada campo del
  mock al enriquecer el seed, y qué pasa con los empates (con solo 15 filas
  rankeadas, el desempate determina el orden visible).
- **Regenerar el seed obliga a `just db-reset`**, no a `db-migrate`: el DDL es
  idempotente pero no actualiza filas existentes.
- `shops.integration.test.ts` asserta `toBe(12)` y `items[0].id === 15`; el
  seed enriquecido no debe alterar el conteo ni los ids de shops. Verificarlo
  antes de dar por buena la regeneración.
- El precedente de estilo para la capa de datos y la traducción camelCase →
  snake_case está en las US-2/3/4a ya archivadas en `openspec/changes/archive/`.
