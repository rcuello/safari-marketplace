# Shop Write API Specification

## Purpose

`POST`/`PUT /api/shops` dejan de devolver la fila 0 del mock (`create`) o un
no-op (`update`), y `POST /approve-shop`/`disapprove-shop` dejan de mutar un
array en memoria que el reinicio de la API borra. Las cuatro rutas escriben
en `shops` vía `@safari/db`: `owner_id` del token, `is_active` por rol al
crear, propiedad en la edición, jsonb con REPLACE completo, y el corte del
500 de un id inexistente. `GET /staffs` se desmockea sin cambiar su
contrato. Capacidad nueva: las lecturas de `shops` viven en
`flat-catalogs-api`/`derived-catalog-api`, sin tocarse aquí salvo lo que sus
propios deltas declaren.

## Requirements

### Requirement: Creación con `owner_id` del token e `is_active` por rol (CA-1, D30-6)

`POST /shops` MUST fijar `owner_id` al `sub` del token, nunca a un valor del
body. `is_active` al crear MUST fijarse explícito según el rol del token,
sin depender del `DEFAULT true` del DDL: `store_owner` → `false` (entra a la
cola de moderación); `super_admin` → `true`. La fila creada MUST responder
con las 16 claves de `toShopDto`, `products_count: 0`, y MUST sobrevivir a
un reinicio real del proceso de la API.

#### Scenario: CA-1 — un `store_owner` crea una tienda que entra a la cola
- GIVEN un token `store_owner` (sub 1)
- WHEN hace `POST /shops` con `name "Tienda Prueba"`
- THEN la respuesta trae `owner_id 1`, `is_active 0` y 16 claves
- AND `GET /new-shops` la incluye y `GET /shops` no
- AND tras reiniciar la API, `GET /new-shops` sigue incluyéndola

#### Scenario: CA-1 — un `super_admin` crea una tienda ya activa
- GIVEN un token `super_admin`
- WHEN hace `POST /shops` con `name "Tienda Admin"`
- THEN la respuesta trae `is_active 1` y aparece en `GET /shops`

### Requirement: Edición con propiedad, slug inmutable y REPLACE completo de jsonb (CA-2, D30-1, D30-2, D30-3)

`PUT /shops/:id` MUST actualizar `name`, `description`, `address` y
`settings`; `slug` MUST permanecer intacto aunque cambie `name`. Un
`store_owner` que no sea el `owner_id` de la fila MUST recibir 403; un
`super_admin` MUST recibir 200 sin restricción de propiedad. `owner_id`
MUST NOT formar parte del input de edición, ni siquiera como campo
ignorado: si el body lo trae, se descarta en silencio, igual que
`balance`/`categories[]`.

`settings` MUST reemplazarse por completo (REPLACE, nunca merge) cuando el
campo viene en el body, con spread condicional
(`...(input.settings !== undefined && { settings: input.settings })`). Esta
Requirement declara la pérdida conocida: un `PUT` de `super_admin` sobre una
tienda con `settings.shopMaintenance` poblado MUST vaciar ese sub-campo si
el body no lo trae, porque el formulario del admin no monta ese bloque para
ese rol (`shouldUnregister: true`). Es una propiedad aceptada del
comportamiento nuevo, ratificada por el dueño del repo — no una regresión a
corregir en esta US.

`logo`/`cover_image` MUST seguir el precedente de `image`/`gallery` de
`products`: spread condicional con `!= null` (nunca `!== undefined`); un
`PUT` con `logo: null` explícito MUST ser un no-op declarado.

#### Scenario: CA-2 — edición persiste, slug invariante, propiedad respetada
- GIVEN una tienda con `settings.location` vacío y su `store_owner` dueño
- WHEN el dueño hace `PUT /shops/:id` con `name`, `description`, `logo`,
  `cover_image`, `address` y `settings.location` nuevos
- THEN la respuesta trae `slug` sin cambios, los campos actualizados, y
  `GET /near-by-shop/:lat/:lng` incluye la tienda tras la escritura

#### Scenario: CA-2 — un dueño no edita tiendas ajenas
- GIVEN un token `store_owner` cuyo `sub` no es el `owner_id` de la tienda 9
- WHEN hace `PUT /shops/9`
- THEN la respuesta es 403 y la fila no cambia
- AND el mismo `PUT` con token `super_admin` responde 200

#### Scenario: CA-2 — REPLACE de `settings` borra un sub-campo no reenviado
- GIVEN una tienda con `settings.shopMaintenance` poblado
- WHEN un `super_admin` hace `PUT /shops/:id` con `settings` sin
  `shopMaintenance` (el formulario no monta ese bloque para su rol)
- THEN la fila resultante en `psql` MUST NOT conservar `shopMaintenance` —
  la pérdida es observable y declarada, no oculta

#### Scenario: CA-2 — `logo: null` es un no-op y `owner_id` del body se ignora
- GIVEN una tienda propia con `logo` poblado
- WHEN su dueño hace `PUT /shops/:id` con `logo: null` y `owner_id` de otro
  usuario en el mismo body
- THEN la respuesta es 200, la columna `logo` no cambia y `owner_id` tampoco

### Requirement: `products_count` recalculado en toda escritura (D30-4)

Las tres funciones de escritura (`createShop`, `updateShop`,
`setShopActive`) MUST recalcular `products_count` con el mismo
`include: COUNT_PRODUCTS` que usan las lecturas (`listShops`,
`findShopBySlug`), nunca depender de un `?? 0` en la proyección. La
respuesta de un `PUT`/`approve-shop`/`disapprove-shop` sobre una tienda con
productos publicados MUST emitir el mismo `products_count` que
`GET /shops/:slug` para esa tienda, nunca `0` por defecto.

#### Scenario: `products_count` de un `PUT` coincide con el del `GET`
- GIVEN una tienda con productos publicados (`products_count` real ≠ 0 en
  `GET /shops/:slug`)
- WHEN se hace `PUT /shops/:id` cambiando solo `name`
- THEN la respuesta del `PUT` trae el mismo `products_count` que el `GET`
  posterior, nunca `0`

### Requirement: Aprobar y desactivar persisten y corrigen el 500 a 404 (CA-3, D30-5)

`POST /approve-shop {id}` MUST fijar `is_active = true`; `POST
/disapprove-shop {id}` MUST fijarlo en `false`. Ambos MUST responder con las
16 claves de `toShopDto`, MUST ser visibles en `GET /shops`/`GET /new-shops`
y MUST sobrevivir a un reinicio real de la API. Un `id` inexistente MUST
responder **404** (corrección de comportamiento intencional: hoy responde
500 por un `TypeError` sin `try/catch`). Un `id` sin forma entera (p. ej.
`{"id":"abc"}`) MUST responder 400, nunca 500 — el valor MUST pasar por
`Number.isSafeInteger` antes de llegar a `@safari/db`.
`admin_commission_rate` MUST aceptarse e ignorarse sin error.

#### Scenario: CA-3 — aprobar y desactivar sobreviven al reinicio
- GIVEN una tienda `"tienda-prueba"` inactiva
- WHEN un `super_admin` hace `POST /approve-shop` con su id
- AND se reinicia la API
- THEN `GET /shops/tienda-prueba` responde `is_active 1`
- AND `POST /disapprove-shop` con el mismo id la devuelve a `is_active 0`,
  también sobreviviente al reinicio

#### Scenario: CA-3 — id inexistente 404, id sin forma entera 400, nunca 500
- WHEN se hace `POST /approve-shop {"id": 99999}` (ningún shop con ese id)
- AND se hace `POST /disapprove-shop {"id": "abc"}`
- THEN la primera responde 404 y la segunda 400 — ninguna 500

### Requirement: `GET /staffs` sin JSON, mismo contrato (CA-4, D30-10)

`GET /staffs?shop_id=N` MUST dejar de leer `shops.json` y MUST seguir
respondiendo `{ data: [], ...paginate(page, limit, ...) }` con el mismo
helper `paginate()` que usa hoy (nunca `buildPaginator()`), preservando
exactamente el mismo key-set y el mismo tipo de `per_page` (string, sin
coerción) que el contrato actual. `POST`/`PUT`/`DELETE /staffs` MUST
mantener su comportamiento de stub sin cambios.

#### Scenario: CA-4 — mismo key-set y tipo de `per_page` antes y después
- GIVEN la migración de `getStaffs` ya aplicada
- WHEN se compara `GET /staffs?shop_id=9` antes y después con `node -e`
- THEN el key-set es idéntico y `per_page` sigue siendo el mismo tipo
  (string), con `data: []`

### Requirement: Permisos — matriz de roles con el 403 de `staff` por guard (CA-5, D30-9)

`POST`/`PUT /shops` MUST responder 401 sin token, 403 para `customer`, 403
para `staff`, y 200 para `store_owner` (propio) y `super_admin` — con
ownership exigida en el `PUT`. `approve-shop`/`disapprove-shop` MUST
responder 403 para cualquier rol que no sea `super_admin`, incluido
`store_owner`. El 403 de `staff` en `POST`/`PUT` sale del **guard**
(`ADMIN_AND_OWNER` no incluye `staff`): a diferencia de `products`
(`ADMIN_OWNER_AND_STAFF` sí admite a `staff`, cuyo 403 depende de que no
tenga tienda propia), en `shops` es garantía directa del decorador, sin
comprobación adicional en el servicio.

#### Scenario: CA-5 — matriz completa de `POST`/`PUT /shops`
- WHEN se llama `POST`/`PUT /shops` sin token, con `customer`, con `staff`,
  con `store_owner` propio y con `super_admin`
- THEN las respuestas son 401, 403, 403, 200 y 200 respectivamente

#### Scenario: CA-5 — `approve-shop`/`disapprove-shop` solo para `super_admin`
- WHEN un `store_owner` hace `POST /approve-shop`
- THEN la respuesta es 403

### Requirement: Cero guardas de dominio nuevas (D30-9)

`shops` MUST consumir el conjunto cerrado de errores de dominio existente
sin ampliarlo: `db/schema.sql` no declara ningún CHECK ni `IN` sobre
`shops`, así que solo `P2002` (slug duplicado → 409), `P2003` (`owner_id`
inexistente → 400) y `P2025` (fila inexistente → 404) son alcanzables. El
`git diff` de `domain-errors.ts` y `common/errors/` MUST quedar vacío.

#### Scenario: Las tres guardas alcanzables cubren el 100% de `shops`
- GIVEN un slug duplicado, un `owner_id` inexistente y un id inexistente en
  `update`/`approve`/`disapprove`
- WHEN cada escritura se ejecuta
- THEN las respuestas son 409, 400 y 404 respectivamente, sin ningún código
  de error nuevo en `domain-errors.ts`

### Requirement: Sin mock huérfano ni regresión (CA-6)

`shops.service.ts` MUST NOT importar `@db/shops.json` ni usar
`plainToClass`. Tras correr `just db-check`, `count(*) FROM shops` MUST
volver a **12** e `items[0].id` MUST seguir siendo **15** (orden `desc`).

#### Scenario: CA-6 — sin imports huérfanos y conteo de la semilla intacto
- WHEN se busca `@db/`/`plainToClass` en `shops.service.ts` y corre
  `just db-check`
- THEN no hay coincidencias, `count(*) FROM shops` vuelve a 12 y
  `items[0].id` es 15

## Out of Scope

`DELETE /shops/:id` (sin consumidor en el admin; arrastraría los productos
de la tienda vía `ON DELETE CASCADE`; sigue respondiendo el string del
scaffold) · `POST /shops/approve` y `POST /shops/disapprove` dentro de
`ShopsController` (rutas con `@Param('id')` no ligable, publicadas sin
consumidor, se dejan tal cual) · `POST /staffs`, `PUT /staffs/:id`, `DELETE
/staffs/:id` (sin relación staff↔tienda en el DDL) · `balance`,
`admin_commission_rate` y `categories: number[]` (sin columna; se aceptan
donde ya existan en el DTO y se descartan al escribir, sin 400 por campo
desconocido) · `transfer-shop-ownership`/`ownership-transfer` (módulo
aparte, mock) · `findOrCreateShopBySlug` del scraper (sin tocar) ·
`apps/shop/**`, `apps/admin/**` (frontend) · `db/schema.sql` (DDL).
