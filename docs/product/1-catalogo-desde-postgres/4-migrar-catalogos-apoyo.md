# US-4a — Migrar catálogos planos a la capa de datos

> `types`, `tags`, `manufacturers` y `shops` dejan el mock JSON y pasan a
> Postgres, completando la navegación plana del catálogo. `categories` se
> partió a **US-4b** (árbol de 3 niveles, riesgo de diseño propio): ver
> `./4b-categorias-arbol-postgres.md`.

**Épico:** [Épico 1](./README.md)
**Fecha:** 2026-08-26
**Status:** Implementada
**Depende de:** US-2
**LOC est.:** ~590 (3 PRs encadenados: ~135 / ~250 / ~205)

## Historia
**Como** estudiante, **quiero** que la navegación de la tienda (menú de types,
grid de shops, filtros de marca) salga de la base, **para** que los shops y
manufacturers que el scraper crea en tiempo de ejecución (los 6 retailers, las
marcas tech) aparezcan en la tienda sin tocar ningún JSON.

## Contexto

- Los repositorios ya existían en `packages/db/src/repositories/` (`types`,
  `manufacturers`, `shops`, `tags`), sin filtro por `name` ni tests de
  integración propios.
- El seed reconstruye 3 shops que el mock referenciaba sin declarar (`noaw`,
  `launchidea`, `tetetetet`, ids 12/14/15): `GET /api/shops` pasa de 9 a 12
  filas — divergencia conocida y verificada por `psql` (CA-3).
- `categories` (árbol `parent_id` autoreferente) quedó fuera: es la única
  parte de US-4 original con riesgo de diseño propio.

## Scope
**Incluye:** listado y detalle por slug de `types`, `tags`, `manufacturers` y
`shops`; `GET /api/top-manufacturers`; filtro `search=name:<término>` en los
4 catálogos (las 4 cajas de búsqueda del admin dependen de él); `search=is_active:1`
en shops; `products_count` calculado en shops.
**NO incluye:** `categories` (US-4b) · `authors`/`top-authors` · endpoints de
escritura del admin (`POST`/`PUT`/`DELETE` de los 4 catálogos siguen en mock)
· `category_product` · cambios de frontend · `GET /staffs`,
`POST /approve-shop`, `POST /disapprove-shop`, `GET /new-shops`,
`GET /near-by-shop/:lat/:lng` · retrofit de `products.service.ts` al helper de
búsqueda compartido · specs de jest para los 4 servicios.

## Criterios de aceptación

### CA-1 — Paridad de contrato por catálogo
Cada endpoint migrado responde con las mismas claves snake_case y el mismo
número de claves (`types` 9, `tags` 9, `manufacturers` 13, `shops` 16) que su
versión mock, salvo las divergencias documentadas en `design.md`.

### CA-2 — Filtro de búsqueda no rompe
`search=name:<término>` filtra de verdad en los 4 catálogos (regresión que la
exploración detectó en el mock); `search=is_active:1` en shops usa un filtro
exacto por columna, no `fuse`.

### CA-3 — Los shops reconstruidos aparecen
`GET /api/shops` devuelve las 12 filas del seed (9 del mock + 3 reconstruidas),
verificado con `psql` (`description LIKE 'Reconstruido%'`).

### CA-4 — La tienda navega completa
`just verify` pasa y la navegación por un type, el grid de shops y el detalle
de una tienda en la tienda renderizan 200.

## Escenarios Gherkin
```gherkin
Feature: Catálogos planos desde Postgres
  Scenario: CA-3 — shops reconstruidos
    Given la base sembrada con just db-up
    When pido GET /api/shops?limit=30
    Then recibo 12 filas: 9 del mock + 3 reconstruidas (noaw, launchidea, tetetetet)
```

## Archivos creados / modificados
| Archivo | Cambio |
|---------|--------|
| `apps/api/rest/src/common/search/parse-search.ts` | **Creado** — helper `search=key:value` compartido |
| `apps/api/rest/src/types/types.service.ts` | `getTypes`/`getTypeBySlug` → `@safari/db` |
| `apps/api/rest/src/tags/tags.service.ts` | `findAll`/`findOne` → `@safari/db`, `type` anidado |
| `apps/api/rest/src/manufacturers/manufacturers.service.ts` | `getManufactures`/`getTopManufactures`/`getManufacturesBySlug` → `@safari/db` |
| `apps/api/rest/src/shops/shops.service.ts` | `getShops`/`getShop` → `@safari/db`, `products_count` real |
| `packages/db/src/repositories/{types,tags,manufacturers,shops}.repository.ts` | filtro `name?`, `orderBy` desc en tags/shops, `_count` filtrado en shops |
| `packages/db/src/records.ts` | `ShopRecord.productsCount?` |
| `packages/db/src/repositories/{types,tags,manufacturers,shops}.integration.test.ts` | **Creados** — 4 suites nuevas |

## Definición de Done

- [x] `curl` mock-vs-Postgres pegado para los 4 catálogos (claves + conteos).

  **`/api/types`** (PR #1): `filas: 10 -> 10`, `claves: 9 -> 9`, `mismo orden: true`,
  `faltan: []`, `sobran: []`. Únicas divergencias: `promotional_sliders` → `null`
  (V-8) y `translated_languages` de `books` (`["en","de"]` → `["en"]`, V-9).
  `GET /api/types/gadget` → 200; `GET /api/types/no-existe-xyz` → 404
  `{"statusCode":404,"message":"No existe un type con slug \`no-existe-xyz\`.","error":"Not Found"}`.

  **`/api/tags?limit=100`** (PR #2): `filas: 10 -> 10`, `claves: 9 -> 9`,
  `mismo orden: true`. `ids mock: 62,61,...,53` = `ids pg: 62,61,...,53`
  (orden desc preservado). `total`/`count` reales (10/10, V-13, ya no
  `tags.length` sin `slice`). `GET /api/tags/62` → 404 (V-21, el mock
  devolvía 200 — la rama numérica ya no existe, D-8).

  **`/api/manufacturers?limit=30`** (PR #2): `filas: 14 -> 14`, `claves: 13 -> 13`,
  `mismo orden: true`. Divergencias: `products_count` → `0` (V-1, 14/14 filas
  del mock traían valores 3-20), `socials` → `[]` (V-2), `cover_image` → `null`
  (V-3), `language` → `'en'` constante (V-10). `type` anidado con 4 claves en
  las 14 filas. `GET /api/top-manufacturers?limit=10` → 10 filas, mismos ids
  que `manufacturers.slice(0,10)`.

  **`/api/shops?limit=30`** (PR #3): `filas: 9 -> 12` (CA-3), `claves: 16 -> 16`,
  `mismo orden: true`. 3 filas nuevas (`tetetetet` id 15, `launchidea` id 14,
  `noaw` id 12). Divergencias en las 9 originales: `owner` → `null` (V-4),
  `orders_count` → `0` (V-5), `created_at`/`updated_at` → hora real de
  `db-up` (V-7), y `makeup-shop` (id 4) `products_count` 81 → 82 (el mock se
  equivoca; Postgres cuenta bien — Decisión E, design.md). `GET
  /api/shops/gadget` idéntico al elemento del listado, 16 claves,
  `products_count: 44`.

- [x] `psql` del delta 9→12 de shops (CA-3).
  ```
   id |      slug      | recon
  ----+----------------+-------
   15 | tetetetet      | t
   14 | launchidea     | t
   12 | noaw           | t
   11 | medicine       |        ← description NULL en el seed; LIKE devuelve NULL, no "f" (dato, no bug)
    9 | gadget         | f
    7 | books-shop     | f
    6 | grocery-shop   | f
    5 | bakery-shop    | f
    4 | makeup-shop    | f
    3 | bags-shop      | f
    2 | clothing-shop  | f
    1 | furniture-shop | f
  (12 rows)
  ```

- [x] `just db-down` → 5x 503 en `types`/`tags`/`manufacturers`/`shops`/
  `top-manufacturers`; `just db-up` restaura sin pérdida de datos
  (verificado: las 12 filas de shops siguen presentes). Nota: `GET
  /api/settings` respondió 500 (no 200) con la base caída — `settings.service.ts`
  (US-1, fuera de alcance de esta US) no envuelve `getSettings()` en el
  patrón `isPrismaConnectionError`; el proceso Nest siguió vivo (confirmado
  por el propio 500, no un timeout de conexión), que es lo que el CA exige.

- [x] Salida real de `just verify` en verde.
  ```
  OK   API    :9001/api/settings  200  5503B  319ms
  OK   Shop   :3003/en  200  201498B  50815ms  cards:30
  OK   Admin  :3002/en/login  200  72821B  100890ms  cards:1
  ```
  CA-4 adicional: `curl :3003/en/gadget | grep -c product-card` → 1;
  `curl :3003/en/shops | grep -c gadget` → 1;
  `curl :3003/en/shops/gadget | grep -ci products` → 1.

- [x] Salida real de `just db-check` en verde.
  ```
  npm run typecheck
  > tsc --noEmit
   Test Files  5 passed (5)
        Tests  35 passed (35)
  ```
  (14 suites previas de `products`/`categories`/`settings` + 4 nuevas:
  `types`/`tags`/`manufacturers`/`shops`.)

- [x] Status de esta US actualizado y fila del épico marcada.

## Notas para el agente ejecutor
- Ejecutado como cadena de 3 PRs stacked-to-main: PR #1 (`parse-search` +
  `types`), PR #2 (`tags` + `manufacturers`), PR #3 (`shops` + este cierre
  documental).
- `getTopManufactures` tenía un bug latente: `ValidationPipe` no transforma
  `limit` (llega `string`), y `Array.prototype.slice` lo coercía en
  silencio; `Prisma`'s `take` exige un `number` real y lanzaba 500. Se
  corrigió con `Number(limit) || 10`, mismo criterio que
  `parseFiniteNumber` en `products.service.ts` (US-2).
- La divergencia `tags.image: [] -> null` (10/10 filas) no está en la tabla
  de divergencias de `design.md`: es un hecho de los datos sembrados (la
  columna `image` es `NULL` para las 10 filas de `tags`, verificado por
  `psql`), no un bug de esta migración. Se documenta aquí porque el
  verify-report de PR #2 no la mencionaba explícitamente.
