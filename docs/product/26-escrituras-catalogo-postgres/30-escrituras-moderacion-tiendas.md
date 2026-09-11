# US-30 — Escrituras y moderación de tiendas

> `POST/PUT /shops` y la cola de aprobación (`approve-shop`/
> `disapprove-shop`) pasan a Postgres: la tienda creada pertenece al usuario
> del token y su activación persiste. Cierra el épico dejando `shops.json`
> fuera de la API y declarando qué rutas de tiendas siguen siendo stubs y
> por qué.

**Épico:** [Épico 26](./README.md)
**Fecha:** 2026-09-09
**Status:** Listo para ejecución
**Depende de:** US-27a
**LOC est.:** ~1550 (original ~400, recalibrado por el sesgo medido del épico —
desglose por componente y aritmética en [«Sesgo de estimación medido»](./README.md))

## Historia
**Como** administrador, **quiero** que aprobar o desactivar una tienda desde
el panel tenga efecto real y sobreviva al reinicio, **para** que la cola de
"tiendas inactivas" sea una herramienta de moderación y no una animación.

## Contexto

- `shops.service.ts:97-99` (`create` → `this.shops[0]`), `:230-232`
  (`update`), `:234-236` (`approve` → string), `:238-240` (`remove` →
  string), `:242-254` (`disapproveShop`/`approveShop` **mutan el array del
  mock**: el cambio se pierde al reiniciar). `:174-188` `getStaffs` lee
  `shops[].staffs` del JSON; `shops.json` trae `staffs: []` en las 9
  tiendas, así que devuelve siempre un paginador vacío. El import
  (`:21`) y el comentario `:27-30` declaran que el JSON solo sostiene eso.
- Controlador (`shops.controller.ts`): `POST /shops`, `PUT /shops/:id`,
  `DELETE /shops/:id` con `ADMIN_AND_OWNER` (`:28-56`);
  `POST /shops/approve` y `POST /shops/disapprove` (`:58-69`) con un
  `@Param('id')` que **no puede ligarse** (la ruta no tiene `:id`) y que
  llaman ambos a `approve()`: rutas del scaffold sin consumidor;
  `StaffsController` (`:72-101`) cuyo `POST /staffs` llama a
  `shopsService.create` con un `CreateShopDto`; `POST /disapprove-shop` y
  `POST /approve-shop` con `@Body('id')` y `ADMIN_ONLY` (`:103-123`), que
  son los que el admin usa (`data/client/shop.ts` `approve`/`disapprove`).
- El admin envía en create/update: `name`, `description`, `cover_image`,
  `logo`, `address`, `settings` (con `location`, `socials`,
  `shopMaintenance`) y `balance`
  (`components/shop/shop-form.tsx:191-215`); en approve,
  `{ id, admin_commission_rate }` (`ApproveShopInput`); en disapprove,
  `{ id }`. `CreateShopDto` (`create-shop.dto.ts:4-14`) además declara
  `categories: number[]`.
- DDL: `db/schema.sql:231-244`. `owner_id bigint NOT NULL DEFAULT 1
  REFERENCES users(id) ON DELETE RESTRICT` (`:236`), `is_active boolean
  NOT NULL DEFAULT true` (`:237`), `address`/`settings` `jsonb NOT NULL
  DEFAULT '{}'`. Sin columna para `balance`, `admin_commission_rate` ni
  categorías de tienda. `products.shop_id … ON DELETE CASCADE` (`:332`).
- Lecturas: `toShopDto` (`shops.service.ts:45-64`, 16 claves, `owner: null`
  y `orders_count: 0` constantes, `products_count` calculado);
  `getNewShops` lista `isActive: false` (`:141-172`) y alimenta la página
  "Inactive shops" del admin (`site.settings.ts:129-133`,
  `pages/new-shops.tsx`); `listShopsNear` usa `settings->'location'`
  (US-5). `ShopRecord.ownerId` ya existe (`:48`).
- El admin **no tiene borrado de tiendas**: `data/shop.ts` no exporta
  ningún `useDeleteShopMutation` y no existe `shop-delete-view.tsx`
  (verificado por grep en `components/`).
- `@CurrentUser()` disponible (`auth/decorators/current-user.decorator.ts`);
  el `sub` es `users.id`.
- Tests con conteo: `shops.integration.test.ts:19,93` (`toBe(12)`),
  `items[0].id === 15`.

## Scope

**Incluye:** `createShop`/`updateShop`/`setShopActive` en `@safari/db` con
tests; `POST /shops` con `owner_id` del token e `is_active` según rol
(nota 1); `PUT /shops/:id` con propiedad (D-5); `POST /approve-shop` y
`POST /disapprove-shop` persistiendo `is_active` y respondiendo con
`toShopDto`; `GET /staffs` sin JSON conservando la lista vacía (decisión
11); eliminación de `shops.json` del servicio; corrección de `CreateShopDto`.

**NO incluye:** `DELETE /shops/:id` (sin consumidor y arrastraría los
productos; decisión 7 — sigue stub declarado); `POST /shops/approve` y
`POST /shops/disapprove` (rutas del scaffold sin consumidor; se dejan tal
cual y se declaran, no se borran: son rutas publicadas); `POST /staffs`,
`PUT /staffs/:id`, `DELETE /staffs/:id` (sin relación staff↔tienda;
DDL diferido); `balance`, `admin_commission_rate`, `categories[]` (sin
columna, decisión 5); `transfer-shop-ownership`/`ownership-transfer`
(módulo aparte, mock); frontend.

## Criterios de aceptación

### CA-1 — Crear una tienda del usuario del token
`POST /shops` crea la fila con `owner_id = sub`. Si el token es
`store_owner`, la tienda nace **inactiva** (`is_active = false`) y aparece
en `GET /new-shops`; si es `super_admin`, nace activa y aparece en
`GET /shops`. Respuesta con las 16 claves de `toShopDto`, `products_count:
0`. Persiste tras reiniciar la API.

### CA-2 — Editar con propiedad
`PUT /shops/:id` actualiza `name`, `description`, `logo`, `cover_image`,
`address` y `settings` (jsonb completo, incluida `location`); `slug` no
cambia. Un `store_owner` que no es el `owner_id` → 403; `super_admin` →
200. Una tienda activa cuyo `settings.location` reciba coordenadas aparece
en `GET /near-by-shop/:lat/:lng`.

### CA-3 — Aprobar y desactivar persisten
`POST /approve-shop {id}` pone `is_active = true`; `POST /disapprove-shop
{id}` lo pone en `false`. El efecto es visible en `GET /shops` /
`GET /new-shops` y sobrevive al reinicio. Ambos responden la tienda con 16
claves. Id inexistente → 404. `admin_commission_rate` se ignora y se
declara.

### CA-4 — `staffs` sin JSON, mismo comportamiento
`GET /staffs?shop_id=N` sigue devolviendo el paginador vacío (mismo
key-set que hoy), ya sin leer `shops.json`. `POST/PUT/DELETE /staffs`
siguen respondiendo lo que hoy, declarados como stubs pendientes de DDL.

### CA-5 — Permisos
`POST/PUT /shops`: 401 sin token, 403 `customer`/`staff`, 200
`store_owner`/`super_admin` (con propiedad en `PUT`).
`approve-shop`/`disapprove-shop`: 403 para todo lo que no sea
`super_admin`.

### CA-6 — Sin mock huérfano ni regresión
`shops.service.ts` no importa `shops.json` ni `plainToClass`. `just
db-check` (`toBe(12)`, `id 15`), `npx jest` (incluido
`shops.service.spec.ts`), `just build-api`, `just verify` verdes;
`SELECT count(*) FROM shops` = 12 tras los tests.

## Escenarios Gherkin

```gherkin
Feature: Escrituras y moderacion de tiendas
  Scenario: CA-1 — la tienda de un dueño nace en la cola de aprobacion
    Given un token store_owner (sub 1)
    When se hace POST /shops con name "Tienda Prueba"
    Then la respuesta trae owner_id 1 e is_active 0
    And GET /new-shops incluye "tienda-prueba"
    And GET /shops no la incluye

  Scenario: CA-3 — aprobar persiste
    Given la tienda "tienda-prueba" inactiva
    When un super_admin hace POST /approve-shop con su id
    And se reinicia la API
    Then GET /shops/tienda-prueba devuelve is_active 1

  Scenario: CA-2 — un dueño no edita tiendas ajenas
    Given un token store_owner cuyo sub no es el owner_id de la tienda 9
    When se hace PUT /shops/9
    Then la respuesta es 403
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `packages/db/src/repositories/shops.repository.ts` | `createShop`/`updateShop`/`setShopActive`; inputs explícitos |
| `packages/db/src/repositories/shops.integration.test.ts` | escrituras con centinela; conteo 12 intacto |
| `packages/db/index.ts` | exportar |
| `apps/api/rest/src/shops/shops.service.ts` | migrar `create`/`update`/`approveShop`/`disapproveShop`; `getStaffs` sin JSON; quitar `shops.json`/`plainToClass`; declarar stubs restantes en comentario |
| `apps/api/rest/src/shops/shops.controller.ts` | pasar `@CurrentUser()` a `create`/`update` |
| `apps/api/rest/src/shops/dto/create-shop.dto.ts` | quitar `balance`/`categories` del DTO o marcarlos como ignorados; documentar |
| `apps/api/rest/src/shops/shops.service.spec.ts` | casos de escritura, propiedad, is_active por rol |

## Definición de Done

- [ ] Secuencia con `store_owner`: `POST → GET /new-shops → reinicio →
      approve-shop (super_admin) → GET /shops → PUT (propio, 200) → PUT
      (ajeno, 403) → disapprove-shop → GET /new-shops` pegada; key-set de
      16 claves comparado con una tienda del seed.
- [ ] `curl` de CA-2 pegado: tienda con `settings.location` nueva aparece
      en `GET /near-by-shop/:lat/:lng`.
- [ ] `curl` de CA-4 pegado: `GET /staffs?shop_id=9` antes y después con el
      mismo key-set.
- [ ] `curl` de CA-5 pegado: 401, 403 `customer`, 403 `staff`, 403
      `store_owner` en `approve-shop`.
- [ ] `grep -n "@db/\|plainToClass" shops.service.ts` → 0 líneas.
- [ ] `psql` pegado: conteo de `shops` = 12 tras los tests.
- [ ] `just db-check`, `npx jest`, `just build-api`, `just verify` verdes,
      con recuentos.
- [ ] Reporte con la lista de rutas de tiendas que siguen stub y su motivo
      (`DELETE /shops/:id`, `shops/approve`, `shops/disapprove`,
      `staffs` ×3) y los campos ignorados (`balance`,
      `admin_commission_rate`, `categories`).
- [ ] Status de esta US actualizado, fila del épico marcada y **épico
      cerrado** si US-28 y US-29 ya están implementadas.

## Notas para el agente ejecutor

1. **`is_active` al crear, por rol — DECIDIDO en esta US**: `store_owner`
   → `false` (entra en la cola que el admin ya tiene: página "Inactive
   shops" + `approve-shop-view.tsx`); `super_admin` → `true`. El DDL tiene
   `DEFAULT true` (`schema.sql:237`); el repositorio lo fija explícito. Es
   la semántica de moderación que la UI existente presupone; si el dueño
   del repo prefiere que todas nazcan activas, es un cambio de una línea y
   se declara.
2. `owner_id` sale **siempre** del token, nunca del body: un `store_owner`
   no puede crear tiendas a nombre de otro. `super_admin` tampoco (no hay
   selector de dueño en el formulario); si algún día hace falta, es otra
   US.
3. El scraper crea tiendas con `INSERT INTO shops (name, slug)` sin
   `owner_id` (`pipelines.py:188`, comentario `schema.sql:223-229`); el
   `DEFAULT 1` existe para él. `createShop` del admin no debe depender de
   ese default.
4. `approve-shop`/`disapprove-shop` reciben `id` por `@Body('id')` y llega
   como el tipo que el admin mande (number). El mock hacía
   `Number(id)`; mantener la coerción y responder 404 si no existe, nunca
   `undefined` (hoy, con un id inexistente, `shop.is_active = false` lanza
   `TypeError` → 500, `shops.service.ts:243-244`). Es una corrección de
   comportamiento y se declara.
5. `getStaffs` sin JSON: devolver `{ data: [], ...paginate(0, page, limit,
   0, url) }` con el mismo `paginate()` que hoy para no cambiar el key-set
   ni el tipo de `per_page` (R-7). No migrar a `buildPaginator` aquí.
6. `toShopDto` emite `owner: null` (V-4). El `POST` podría ya rellenarlo
   con el usuario del token, pero eso cambiaría el contrato del listado
   respecto al detalle: **no**. Se mantiene `null` y se menciona como
   mejora adyacente.
7. `shops.integration.test.ts` asserta `items[0].id === 15` con orden
   `desc`: una tienda de prueba creada y no borrada rompería ese test.
   Limpieza por slug centinela en `beforeAll`/`afterAll`.
