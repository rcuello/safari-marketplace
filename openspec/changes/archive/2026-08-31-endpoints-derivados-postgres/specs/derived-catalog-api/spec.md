# Derived Catalog API Specification

## Purpose

Seis endpoints que leían `@db/*.json` (destacados, inventario, tiendas
nuevas y cercanas) pasan a Postgres vía `@safari/db`, sobre un seed con el
ranking (`ratings`, `total_reviews`, `sold_quantity`) que `products.json` no
traía. Cubre `popular-products`, `best-selling-products`, `products-stock`,
`draft-products`, `new-shops` y `near-by-shop/:lat/:lng`.

## Requirements

### Requirement: Ranking real con desempate estable

`popular-products` MUST ordenar por `ratings DESC, id ASC` y
`best-selling-products` por `sold_quantity DESC, id ASC`, cada uno como
array plano con las 20 claves de `product-listing-api` (S-1: ya no las 46
del mock). Default de `limit` (ausente): **10** popular, **5**
best-selling. El desempate `id ASC` es obligatorio: 1194/1200 filas quedan
empatadas en `ratings = 0.00`, sin el cual la cola del top-N no es
determinista.

#### Scenario: Popular y best-selling ordenan con desempate estable
- GIVEN el seed enriquecido (`just db-reset` tras regenerar `db/seed.sql`)
- WHEN pido `GET /api/popular-products` y `GET /api/best-selling-products`
- THEN recibo `4,1,3,2,5,25,6,7,8,9` (6 con `ratings>0`, 4 empatados en
  `0.00` por `id ASC`) y `888,1,2,883,887` (`888` con `sold_quantity=4`;
  `1`/`2` con `2`; `883`/`887` con `1`, ganando el desempate)

### Requirement: Sin regresión en `shops`/`categories`

El seed enriquecido MUST NOT alterar el conteo ni los ids de `shops`/
`categories`: solo modifica el INSERT de `products`.

#### Scenario: Conteos estables tras el seed enriquecido
- GIVEN el seed regenerado (`just db-reset`)
- WHEN consulto `shops`/`categories` en Postgres
- THEN `shops` sigue en `12` (`listShops().items[0].id === 15`) y
  `categories` en `198`

### Requirement: `type_slug` filtra dentro del ranking

`?type_slug=` en popular/best-selling MUST filtrar el conjunto YA ordenado
por el ranking, no descartarlo para una búsqueda difusa sobre todo el
catálogo (B-2).

#### Scenario: `type_slug` no rompe el ranking
- GIVEN el seed enriquecido
- WHEN pido `GET /api/popular-products?type_slug=grocery&limit=3`
- THEN recibo hasta 3 filas de ese `type.slug`, en el mismo orden de ranking

### Requirement: Inventario sin el default de vitrina

`products-stock` (`quantity <= 9`) y `draft-products` (`status='draft'`)
MUST NOT aplicar el default `status='publish'`/`visibility='visibility_
public'` del listado principal: son vistas de admin y el mock tampoco lo
aplicaba ahí. Ambos MUST devolver `{data, ...paginate(...)}` con
`paginate()` local, `page`/`limit` crudos.

#### Scenario: Stock bajo y el único borrador, sin filtrar por status
- GIVEN el seed enriquecido (el borrador `454` tiene `quantity=30`, por eso
  NO cae en `products-stock` hoy; `status='draft'` nunca es `'publish'`)
- WHEN pido `GET /api/products-stock` y `GET /api/draft-products`
- THEN el primero da `total: 11` (ids `2,190,1014,1015,1017,1018,1021,1022,
  1023,1024,1028`) y el segundo `total: 1` (id `454`) — si el default de
  vitrina siguiera activo, ningún borrador podría aparecer nunca

### Requirement: `new-shops` — cero es el resultado correcto

`new-shops` MUST filtrar por `is_active = false` reutilizando
`ListShopsInput.isActive` (sin código nuevo). Con las 12 tiendas activas
del seed, `total: 0` es el resultado esperado.

#### Scenario: Ninguna tienda inactiva en el seed actual
- GIVEN el seed sembrado (12/12 activas)
- WHEN pido `GET /api/new-shops`
- THEN recibo `{data: [], total: 0, ...}` — correcto, no un error

### Requirement: Cercanía real, sin radio

`GET /api/near-by-shop/:lat/:lng` MUST calcular haversine entre el origen y
cada tienda con `settings.location.{lat,lng}` numéricos/finitos, y
devolver el array ascendente por distancia, **sin límite de radio** (B-1).
Tiendas sin coordenadas válidas (sin `lat`/`lng`, `location: []`, o clave
ausente) MUST descartarse sin lanzar (máx. 6 de 12 califican). `lat`/`lng`
no finitos — incluye `/near-by-shop/undefined/undefined`, que la tienda
dispara en cada carga sin guard `enabled` — MUST responder 200 con `[]`, no
400 (B-4): el mock también daba 200. Cada elemento MUST tener exactamente
14 claves en este orden:
`id, owner_id, name, slug, description, cover_image, logo, is_active,
address, settings, notifications, created_at, updated_at, distance`, con
`distance` **numérica** e `is_active` como `Number(bool)`.

#### Scenario: Orden por cercanía real y key-set de 14 claves
- GIVEN el seed sembrado (6 tiendas con coordenadas válidas)
- WHEN pido `GET /api/near-by-shop/40.7128/-74.0060` y luego
  `GET /api/near-by-shop/4.711/-74.0721`
- THEN ambas respuestas tienen ≤6 filas con `distance` ascendente, órdenes
  de ids distintos entre sí, y cada fila con exactamente las 14 claves
  listadas, `distance` numérica

#### Scenario: Sin coordenadas válidas o `lat`/`lng` no finitos
- GIVEN tiendas cuyo `settings.location` carece de `lat`/`lng` numéricos, es
  `[]`, o no existe la clave
- WHEN pido `GET /api/near-by-shop/40.7128/-74.0060` (omite esas tiendas
  sin fallar) y luego `GET /api/near-by-shop/undefined/undefined` o
  `.../abc/0`
- THEN el segundo caso responde HTTP 200 con `[]`, nunca 400 ni 500

### Requirement: Errores de conexión a Postgres

Si Prisma no puede conectar (`isPrismaConnectionError`), los 6 endpoints
MUST responder 503 con `getUserFriendlyMessage()`; cualquier otro error no
controlado MUST responder 500 con el mismo helper (patrón de
`product-listing-api`). El proceso Nest MUST NOT crashear.

#### Scenario: Postgres caído
- GIVEN `just db-down`
- WHEN pido cualquiera de los 6 endpoints
- THEN cada uno responde 503 con `{statusCode, message, error}` legibles y
  el proceso sigue vivo

## Divergencias declaradas

**De comportamiento** (deliberadas; evidencia completa en `design.md`):

| # | Cambio | Verificable hoy |
|---|---|---|
| B-1 | `near-by-shop` deja de ignorar `lat`/`lng` (6 filas fijas) | Sí — 2 orígenes |
| B-2 | `type_slug` filtra dentro del ranking, no vía `fuse` global | Sí |
| B-3 | Ids en popular/best-selling ya no son la lista curada (4/10 traían `ratings: 0`) | Sí — vs. mock |
| B-4 | `lat`/`lng` no finitos → `[]` con 200, no 400 | Sí |
| B-5 | `search` es AND sobre el filtro base, no reemplazo (`fuse $and` del mock) | Sí |
| B-6 | `near-by-shop` filtra `isActive: true`; el mock no miraba actividad | No observable (12/12) |
| B-7 | `new-shops?search=` pasa de `fuse` difuso a filtro exacto por `name` | No observable (`total: 0`) |
| B-8 | **Bordes de `limit`**: el mock hacía `slice(0, limit)`; ahora el valor se sanea con `Number(limit) \|\| <default>` antes de llegar a `take`. `?limit=0` y `?limit=abc` devuelven el default (10/5/30) donde el mock devolvía `[]`; `?limit=-1` devuelve 1 fila desde el final (Prisma interpreta `take: -1`) donde el mock devolvía todas menos una; `?limit=1e9` devuelve todo el conjunto donde el mock devolvía el tamaño curado. En los paginados, `?limit=0` emite además `per_page: "0"` con `last_page: null`, y `?limit=-1` emite `last_page: -11`. **Ningún borde produce 5xx** — el saneo existe porque pasar el string crudo a Prisma daba **500** (bug real encontrado y corregido durante el apply). Verificado sobre los 4 endpoints migrados × 4 bordes | Observable |

**De forma**: **S-1** 46→20 claves · **S-2** `in_flash_sale` constante `0`,
ya embarcada · **S-3** `created_at`/`updated_at` (solo `near-by-shop`) con
`now()` de `db-up`, precedente `/api/settings` · **S-4** `distance` del
mock no era km reales; el orden se preserva, la magnitud pasa a haversine
real (aceptado).

## Out of Scope

`getStaffs` · escrituras reales (stubs del mock) · `db/schema.sql`/
`schema.prisma` · árbol de categorías · `apps/shop/**`, `apps/admin/**` ·
`shop_id` en popular/best-selling (muerto, sigue muerto) · los ~30
servicios 100% mock.
