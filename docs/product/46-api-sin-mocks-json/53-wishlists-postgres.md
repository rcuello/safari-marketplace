# US-53 — `wishlists` y `my-wishlists` desde Postgres

> Las 12 rutas de la lista de deseos dejan de servir `wishlists.json` y una
> porción fija de `products.json`. Pasan a un pivote `wishlists` usuario ↔
> producto, sembrado con los 10 productos del mock para `customer@demo.com`.
> El estado deja de ser global en memoria: cada usuario tiene la suya.

**Épico:** [Épico 46](./README.md)
**Fecha:** 2026-10-20
**Status:** Implementada (2026-10-22, rama `us-53-wishlists-postgres`)
**Depende de:** US-52 (secuencialidad de archivos compartidos, R-2 del épico; sin dependencia de datos)
**LOC est.:** ~1300

## Historia

**Como** cliente del shop, **quiero** que mis favoritos se guarden en la base
y sean solo míos, **para que** marcar un producto no lo marque para todos
los usuarios ni se pierda al reiniciar la API.

## Contexto (verificado en código, 2026-10-20)

Dos controladores, **sin `@Public` ni `@Permissions`**: basta un token
válido (guards globales en `app.module.ts:110-111`). Ninguno usa
`@CurrentUser`, así que hoy **nada es por usuario**.

`apps/api/rest/src/wishlists/wishlists.controller.ts` (`@Controller('wishlists')`, `:16`):

| Método y ruta | Hoy (`wishlists.service.ts`) |
|---|---|
| `GET /api/wishlists` (`:21`) | `wishlists.json` paginado: `limit=30` por defecto. Fuse con `keys:['answer']`, un campo que no existe, así que cualquier `search` devuelve `[]` (`:15-19,33-39`). Url fija `/wishlists?with=shop&orderBy=created_at&sortedBy=desc` (`:42`) |
| `GET /api/wishlists/:id` (`:26`) | `find(p => p.id === id)`. Las filas son productos, así que `:id` es un **id de producto** (`:49-51`) |
| `POST /api/wishlists` (`:32`) | `wishlist[0]` (el producto 945, forma Laravel) |
| `PUT /api/wishlists/:id` (`:38`) | `wishlist[0]` |
| `DELETE /api/wishlists/:id` (`:47`) | `wishlist[0]` |
| `POST /api/wishlists/toggle` (`:53`) | busca `body.product_id` en **`products.json`**, invierte `product.in_wishlist` en memoria y devuelve el **booleano desnudo**. El estado es global; un producto desconocido lanza TypeError → 500 (`:71-77`) |
| `GET /api/wishlists/in_wishlist/:product_id` (`:58`) | `product?.in_wishlist`: **cuerpo vacío** (`undefined`) hasta que alguien hace toggle, porque `products.json` no trae esa clave en ninguna de sus 1200 filas (`:65-69`) |

`apps/api/rest/src/wishlists/my-wishlists.controller.ts` (`@Controller('my-wishlists')`, `:16`):

| Método y ruta | Hoy (`my-wishlists.service.ts`) |
|---|---|
| `GET /api/my-wishlists` (`:21`) | **No lee `wishlists.json`**: devuelve `products.json.slice(1, 7)`, los productos 2..7 en forma de 20 claves. `limit=30`. Url fija `/my-wishlists?with=shop&orderBy=created_at&sortedBy=desc` (`:27-39`) |
| `GET /api/my-wishlists/:id` (`:26`) | `wishlists.json`, `find` por id |
| `POST /api/my-wishlists` (`:32`) | `wishlist[0]` |
| `PUT /api/my-wishlists/:id` (`:38`) | `wishlist[0]` |
| `DELETE /api/my-wishlists/:id` (`:47`) | `wishlist[0]` |

DTOs: `CreateWishlistDto = PickType(Wishlist, ['product_id'])`;
`GetWishlistDto` declara `orderBy`, `sortedBy` y `search`
(`wishlists/dto/*.ts`).

**El mock** (`wishlists.json`, medido con `node -e`):

- 10 filas que son **productos Laravel completos** (42 claves, más un
  `shop` de 12). No hay `user_id`, `product_id` ni pivote.
- Ids **945, 941, 755, 569, 400, 313, 155, 111, 110, 104** (id de producto
  DESC). Todos existen en el seed; sus tiendas (7, 7, 6, 6, 6, 6, 2, 2, 2,
  3) también.
- **No** son la fila de `products.json`: les faltan `type`,
  `sold_quantity`, `in_flash_sale` y `visibility`, y traen 25 claves sin
  columna (`description`, `gallery`, `author_id`, `rating_count`,
  `my_review`, `blocked_dates`…).

**Consumidores**. Solo el shop; el admin no tiene endpoint de wishlist.

- `framework/rest/client/index.ts:459-478`:
  - `all` → `GET /my-wishlists` con
    `with=shop&orderBy=created_at&sortedBy=desc`;
  - `toggle` → `POST /wishlists/toggle` con `{product_id, language?}`,
    tipado como `{in_wishlist}` pero hoy recibe un booleano desnudo;
  - `remove` → `DELETE /wishlists/{product.id}`;
  - `checkIsInWishlist` → `GET /wishlists/in_wishlist/:id`, tipado
    `boolean`.
- `framework/rest/wishlist.ts`:
  - `useToggleWishlist` (`:16-35`) ignora la respuesta y escribe
    `!inWishlist` en la caché;
  - `useInWishlist` (`:104-120`) hace `Boolean(data)`;
  - `useWishlist` es infinito sobre `current_page`/`last_page`.
- Componentes: `components/products/wishlist-products.tsx` y
  `products/details/favorite-button.tsx`.
- `GET /wishlists`, `GET /wishlists/:id`, `GET /my-wishlists/:id` y los
  `POST`/`PUT` de ambos controladores **no tienen consumidor** en ningún
  frontend (`grep` de `API_ENDPOINTS.WISHLIST`/`USERS_WISHLIST`).

**Precedentes**:

- `toProductDto` vive en `apps/api/rest/src/products/products.service.ts:122`
  como función local, **no exportada**. El precedente de mapper compartido
  es `apps/api/rest/src/users/user-dto.mapper.ts`.
- `ProductRecord` y `_toProductRecord` se exportan desde
  `packages/db/src/repositories/products.repository.ts:67,1009`.

## Línea base (D-2 del épico)

API recién arrancada (`toggle` muta la memoria, R-4). Token de
`customer@demo.com`.

```bash
API=http://localhost:9001/api
TOKEN=$(curl -s -X POST $API/token -H 'Content-Type: application/json' -d '{"email":"customer@demo.com","password":"demodemo"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
curl -s -H "Authorization: Bearer $TOKEN" "$API/my-wishlists?with=shop&orderBy=created_at&sortedBy=desc"   > base-my-wishlists.json
curl -s -H "Authorization: Bearer $TOKEN" "$API/wishlists"                                              > base-wishlists.json
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' -H "Authorization: Bearer $TOKEN" "$API/wishlists/in_wishlist/945"
```

Pegar el status y los bytes de `in_wishlist` (hoy 200 y 0 B).

## Tabla nueva

```
wishlists (
  user_id     bigint      NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  product_id  bigint      NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
)
+ índice en product_id
```

Es un pivote: patrón de `permission_user`/`product_tag` (`db/schema.sql`),
con `CASCADE` en ambas FK porque un favorito no sobrevive a su usuario ni a
su producto. Sin `updated_at`: la fila no se edita, se crea o se borra.

## Reglas del seed

- Bloque `wishlists` después de `products` y `users`.
- Las 10 filas son `user_id = 2` (`customer@demo.com`, el único cliente del
  seed). El mock no trae dueño: la elección se declara en el banner.
- `product_id` toma los ids de `wishlists.json` en el orden del archivo.
- `created_at` es determinista para que `ORDER BY created_at DESC`
  reproduzca el orden del archivo: la fila *i* (0 = 945) recibe
  `'2024-01-01T00:00:00Z'::timestamptz + (10 - i) * interval '1 minute'`.
- Validación previa: cada `product_id` existe en el conjunto de productos
  del generador, y no hay pares repetidos.
- **Conteo**: `wishlists` 10, todas del usuario 2.

## Rutas

Todas leen el usuario de `@CurrentUser()` (`user.sub`). Guards sin cambios
(R-6).

| Método y ruta | Después |
|---|---|
| `GET /my-wishlists` | Productos favoritos del usuario actual, **`created_at DESC, product_id DESC`**, cada uno proyectado con `toProductDto`. Defaults `page=1`, `limit=30`. Mismo `paginate()` y misma url fija. `orderBy`/`sortedBy`/`search` se ignoran |
| `GET /wishlists` | Igual que `GET /my-wishlists`, con su propia url fija `/wishlists?with=shop&orderBy=created_at&sortedBy=desc` |
| `GET /wishlists/:id` y `GET /my-wishlists/:id` | El producto `:id` proyectado si está en la lista del usuario; si no, 404 |
| `POST /wishlists` y `POST /my-wishlists` | Añade `body.product_id` a la lista del usuario (idempotente: `ON CONFLICT DO NOTHING`) y devuelve el producto proyectado (201). Producto inexistente → 404 |
| `PUT /wishlists/:id` y `PUT /my-wishlists/:id` | Añade el producto `:id` (idempotente, ignora el body) y devuelve el producto proyectado. Un `PUT` sobre un recurso identificado por id es un upsert; ningún frontend lo usa |
| `DELETE /wishlists/:id` y `DELETE /my-wishlists/:id` | Quita el producto `:id` de la lista del usuario y devuelve el producto proyectado. 404 si no estaba |
| `POST /wishlists/toggle` | Invierte la pertenencia de `body.product_id` **para el usuario actual** y devuelve el **booleano desnudo** con el estado nuevo (`true` = ahora está). Producto inexistente → 404 |
| `GET /wishlists/in_wishlist/:product_id` | `true` o `false` (booleano JSON) para el usuario actual |

Guarda de ids `Number.isSafeInteger(id) && id > 0` → 400 (US-31).

## Divergencias declaradas

| # | Dónde | Hoy | Después | Por qué |
|---|---|---|---|---|
| V-1 | `GET /my-wishlists` | productos 2..7 de `products.json` para cualquier usuario | los favoritos del usuario actual. `customer@demo.com` ve los 10 del mock; `admin` y `store_owner`, una lista vacía | D-1, aislamiento por usuario |
| V-2 | `GET /wishlists`, `/:id` | filas Laravel de 42 claves | contrato de 20 claves de `toProductDto` | D-5: el producto embebido no es histórico. Las 25 claves extra no tienen columna |
| V-3 | `toggle` | estado global en memoria; 500 con producto desconocido | por usuario y persistido; 404 | D-1 |
| V-4 | `in_wishlist/:id` | cuerpo vacío (0 B) hasta el primer toggle | `true`/`false` | D-1. `useInWishlist` hace `Boolean(data)`: mismo resultado en la UI para `false` |
| V-5 | `POST`/`PUT`/`DELETE` | `wishlist[0]` siempre | el producto afectado; 404 si no aplica | D-1 |
| V-6 | `search` en `GET /wishlists` | cualquier valor da `data: []` | se ignora | ningún frontend lo envía |

## Scope

**Incluye:**

- la tabla `wishlists` con su DDL, el bloque del generador y el seed;
- la re-introspección con el modelo `Wishlist` (inversas en `User` y
  `Product`);
- `wishlists.repository.ts` (`listWishlistProducts`,
  `isInWishlist`, `addToWishlist`, `removeFromWishlist`,
  `toggleWishlist`), que devuelve `ProductRecord` reutilizando el include y
  `_toProductRecord` de `products.repository.ts`, con su integration test;
- extraer `toProductDto` a un mapper compartido
  (`apps/api/rest/src/products/product-dto.mapper.ts`) que importan
  `products.service.ts` y los dos servicios de wishlist. Es un movimiento
  verbatim: `products.service.spec.ts` sigue en verde sin tocarse;
- los dos servicios reescritos sin los imports de `wishlists.json` y
  `products.json`, y sus specs.

**NO incluye:**

- emitir `in_wishlist` dentro de `/products` o `/products/:slug` (es
  contrato de productos);
- cambiar el tipo `{in_wishlist}` que el shop declara para el toggle;
- tocar `apps/shop`;
- cambiar guards;
- búsqueda de texto en la lista (V-6).

## Criterios de aceptación

### CA-1 — Seed

`wishlists` tiene 10 filas, todas `user_id = 2`, con 0 huérfanas.

`SELECT product_id FROM wishlists ORDER BY created_at DESC` devuelve 945,
941, 755, 569, 400, 313, 155, 111, 110, 104. Los conteos previos siguen
intactos.

### CA-2 — La lista del cliente

Con el token de `customer@demo.com`, `GET
/my-wishlists?with=shop&orderBy=created_at&sortedBy=desc` devuelve esos 10
productos en ese orden. Cada uno es **deep-equal** a las mismas claves de
`GET /products/<slug>`. El detalle es `{...toProductDto(detail),
related_products, …}` (`products.service.ts:315-316`), así que se comparan
las 20 claves del elemento de la wishlist contra esas mismas 20 claves del
detalle. Comprobarlo con `node -e` para al menos 945 y 104.

El paginador es el de la línea base salvo `total`/`count`/`lastItem` (6 →
10, V-1). La url fija es idéntica.

### CA-3 — Aislamiento

- Con el token de `admin@demo.com`, `GET /my-wishlists` da `total: 0`.
- Un `toggle` del admin sobre el 945 no cambia la lista del cliente.
- `in_wishlist/945` da `true` para el cliente y `false` para el admin.

### CA-4 — Escrituras

| Llamada (como cliente) | Resultado |
|---|---|
| `toggle` sobre el producto 2 | `true`; el siguiente `toggle`, `false` |
| `POST /my-wishlists {product_id: 3}` dos veces | 201 las dos veces, una sola fila |
| `DELETE /wishlists/3` | el producto; repetirlo da 404 |
| `toggle {product_id: 999999}` | 404 |
| `GET /wishlists/abc` | 400 |

Todo con Bearer y status exacto.

### CA-5 — Sin import huérfano y sin regresión

`grep -rn "wishlists.json\|products.json" apps/api/rest/src/wishlists` sale
vacío.

`just db-check`, `npx jest` (con `products.service.spec.ts` sin tocar),
`just build-api` y `just verify` en verde.

## Escenarios Gherkin

```gherkin
Feature: Lista de deseos por usuario
  Scenario: CA-2 — el cliente ve sus 10 favoritos sembrados
    Given el seed con 10 favoritos de customer@demo.com
    When el cliente pide GET /api/my-wishlists
    Then recibe los productos 945 a 104 en orden de created_at descendente
    And cada producto coincide con las 20 claves de toProductDto de GET /api/products/:slug

  Scenario: CA-3 — el toggle de un usuario no afecta a otro
    Given el admin sin favoritos
    When el admin hace toggle del producto 945
    Then in_wishlist/945 es true para el admin
    And la lista del cliente sigue teniendo 10 productos

  Scenario: CA-4 — el toggle devuelve el estado nuevo
    Given el producto 2 fuera de la lista del cliente
    When el cliente hace POST /api/wishlists/toggle con product_id 2
    Then la respuesta es true
    And un segundo toggle responde false
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---|---|
| `db/schema.sql` | pivote `wishlists` con su banner |
| `db/generate-seed.mjs` | bloque `wishlists` (10 filas, usuario 2, `created_at` determinista) |
| `db/seed.sql` | regenerado |
| `db/README.md` | modelo y dueño elegido del seed |
| `packages/db/prisma/schema.prisma` | modelo `Wishlist` + inversas |
| `packages/db/src/repositories/wishlists.repository.ts` | nuevo |
| `packages/db/src/repositories/wishlists.integration.test.ts` | nuevo |
| `packages/db/index.ts` | barrel |
| `packages/db/README.md` | repositorio nuevo |
| `apps/api/rest/src/products/product-dto.mapper.ts` | nuevo: `toProductDto` movido verbatim |
| `apps/api/rest/src/products/products.service.ts` | importa el mapper (sin cambio de comportamiento) |
| `apps/api/rest/src/wishlists/wishlists.service.ts` | reescrito |
| `apps/api/rest/src/wishlists/my-wishlists.service.ts` | reescrito |
| `apps/api/rest/src/wishlists/*.controller.ts` | `@CurrentUser()` en cada ruta |
| `apps/api/rest/src/wishlists/wishlists.service.spec.ts` y `my-wishlists.service.spec.ts` | nuevos |

No se crea `WishlistRecord`: el pivote no se expone, y las lecturas
devuelven `ProductRecord`.

## Definición de Done

Sigue el **Protocolo de ejecución** del README del épico. Lo específico:

- [x] Línea base pegada: los 2 cuerpos y el `in_wishlist` vacío (status y
  bytes).
- [x] `just db-reset` y `psql` con el conteo, el orden de CA-1 y 0
  huérfanas.
- [x] `prisma validate`, `migrate diff` en `EXIT=0` y `just db-build`.
- [x] CA-2: `node -e` con el deep-equal producto a producto contra las 20
  claves de `/products/:slug`.
- [x] CA-3 y CA-4: los `curl` con tokens de cliente y admin, status exacto.
- [x] CA-5: `grep` vacío y las 4 suites o comandos en verde con recuentos.
- [x] Status actualizado aquí y en el épico.

## Evidencia (2026-10-22)

**Dos commits**, como piden las notas: `fec13d4` mueve `toProductDto` tal
cual a `products/product-dto.mapper.ts` (refactor; products 59/59 sin tocar
su spec). El siguiente commit contiene la feature.

**Línea base**, con la API recién arrancada sobre `main` (`bf0feab`) y el
token del cliente:

```
in_wishlist/945: 200 0B
 5994 base-my-wishlists.json   (productos 2..7, 20 claves, total 6)
27294 base-wishlists.json      (945…104, 42 claves, total 10)
```

**Seed.** `just db-seed-generate` termina con `… · 10 coupons · 10
wishlists`. Con el producto 999999 inyectado en `wishlists.json` (y el JSON
restaurado, sin diff):

```
El mock viola 1 restriccion(es) del esquema:
  - wishlists: producto 999999 inexistente
EXIT=1
```

**CA-1** (`just db-reset` + `psql`): 10 filas, las 10 con `user_id = 2`, 0
huérfanas. `ORDER BY created_at DESC` da
`945,941,755,569,400,313,155,111,110,104`. Conteos previos intactos:
products 1200 · shops 12 · users 3 · coupons 10 · store_notices 3 ·
attributes 8 · faqs 19.

**Prisma.** `validate` correcto y `migrate diff --exit-code` con `EXIT=0`.
`just db-build` limpio.

**CA-2:** con el token del cliente, `GET /my-wishlists?with=shop&…` devuelve
`945,941,755,569,400,313,155,111,110,104`. Cada elemento tiene las mismas 20
claves, en el mismo orden, que la línea base. Los 10 son **deep-equal** a
esas 20 claves de `GET /products/<slug>`. Del paginador solo cambian `total
6→10`, `count 6→10` y `lastItem 5→9` (V-1); la url fija es idéntica.

**CA-3:**

| Llamada | Status | Cuerpo |
|---|---|---|
| `GET /my-wishlists` como admin | 200 | `total: 0` |
| `toggle {945}` como admin | 201 | `true` |
| `in_wishlist/945` admin / cliente | 200 / 200 | `true` / `true` |
| `GET /my-wishlists` como cliente | 200 | `total: 10`, sin cambios |
| `toggle {945}` como admin otra vez → `in_wishlist/945` admin | 201 → 200 | `false` → `false` |

**CA-4** (como cliente):

| Llamada | Status | Resultado |
|---|---|---|
| `toggle {2}` dos veces | 201 / 201 | `true` / `false` |
| `POST /my-wishlists {3}` dos veces | 201 / 201 | el producto 3 (`blueberries`); en `psql`, 1 fila |
| `DELETE /wishlists/3` dos veces | 200 / 404 | el producto / `No existe un registro de wishlists con id 3.` |
| `toggle {999999}` | 404 | |
| `GET /wishlists/abc` | 400 | `` `product_id` no admite `abc`. `` |
| `GET /wishlists/945` cliente · `GET /my-wishlists/945` admin | 200 · 404 | |
| `PUT /wishlists/104` | 200 | el producto (ya estaba: no-op) |
| Sin token | 401 | |

Al final, la lista del cliente vuelve a 10 filas y la del admin a 0.

**El booleano viaja como `text/html`, no como `application/json`.** La nota
de abajo suponía lo contrario. Nest envía un primitivo con `res.send` y el
`toggle` del mock hacía lo mismo. El shop usa axios, que lo parsea igual
(`"true"` → `true`). No se cambia (D-1).

**CA-5:**

- El `grep` no devuelve nada (`exit=1`).
- `just db-check`: 22 archivos y 325 tests (antes 21/318; +7).
- `npx jest`: 21 suites y 407 tests (antes 19/389; +18).
  `products.service.spec.ts` no se tocó.
- `just build-api`: `Done in 84.46s`.
- `just verify`: API `5503B`, Shop `cards:30`, Admin `cards:1`. La página
  `/wishlists` del shop responde 200.

**Fuera de alcance, para el reporte:** `UpdateWishlistDto` queda sin uso,
porque el `PUT` ignora el body. No se borró.

## Notas para el agente ejecutor

- **Mover `toProductDto` es un refactor, no un cambio de comportamiento.**
  Hacerlo en un commit propio antes del de la wishlist (regla 6 de
  `agent-behaviors`: no mezclar refactor y feature).
- El include de producto (con `type` y `shop`) ya está en
  `products.repository.ts`. Exportarlo o reutilizar `findMany` sobre
  `products` filtrado por la relación. No duplicar el `select`.
- **El cuerpo del toggle es un booleano desnudo**: `res.json(true)` sale
  como `true`. Con `return true` desde Nest el cuerpo es `true` y el
  content-type `application/json`; comprobarlo en el `curl`.
- `DELETE /wishlists/:id` usa **id de producto**, no un id de pivote (no lo
  hay). Así lo llama el shop.
