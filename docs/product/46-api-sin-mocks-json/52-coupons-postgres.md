# US-52 — `coupons` y su verificación desde Postgres

> Las 9 rutas de cupones (CRUD, verificación y moderación) dejan de servir
> `coupons.json` y pasan a una tabla `coupons` sembrada con sus 10 registros.
> `is_valid` deja de ser un literal: se calcula desde la vigencia. `POST
> /coupons/verify` deja de aprobar cualquier código.

**Épico:** [Épico 46](./README.md)
**Fecha:** 2026-10-20
**Status:** Listo para ejecución
**Depende de:** US-51 (secuencialidad de archivos compartidos, R-2 del épico; sin dependencia de datos)
**LOC est.:** ~1500

## Historia

**Como** cliente del shop y como dueño de tienda en el admin, **quiero** que
los cupones existan en la base con su vigencia y su aprobación reales, **para
que** el checkout aplique solo cupones válidos y la moderación del admin
persista entre reinicios de la API.

## Contexto (verificado en código, 2026-10-20)

Rutas en `apps/api/rest/src/coupons/coupons.controller.ts`. Hay tres
controladores en un archivo: `coupons` (`:22`), `disapprove-coupon` (`:78`)
y `approve-coupon` (`:89`).

| Método y ruta | Guard | Hoy (`coupons.service.ts`) |
|---|---|---|
| `POST /api/coupons` | `ADMIN_OWNER_AND_STAFF` (`:26`) | devuelve `coupons[0]` (id 10, `4OFF`) sin leer el body (`:22-24`) |
| `GET /api/coupons` | `@Public` (`:33`) | `page=1`, **`limit=12`** por defecto (`:26-28`). `shop_id` filtra, pero `search` **sobrescribe** ese filtro porque Fuse busca sobre el conjunto entero (`keys:['code']`, `threshold 0.1`, `:12-16,40-58`). Paginado en memoria; la url es `/coupons?search=${search}&limit=${limit}` (`:61`) |
| `GET /api/coupons/:param` | `@Public` (`:39`) | `find(p => p.code === param)`: **por código, no por id** (`:68-70`). Si no existe, 200 con cuerpo vacío |
| `GET /api/coupons/:id/verify` | `@Public` (`:48`) | **Roto**: lee `@Param('param')` en una ruta `:id`, así que llega `undefined` y la respuesta es un 200 vacío (`:50-51`) |
| `POST /api/coupons/verify` | `@Public` (`:55`) | **Literal**: para cualquier `code` devuelve `{is_valid:true, coupon:{id:9, code:<eco>, …}}` (`:80-104`) |
| `PUT /api/coupons/:id` | `ADMIN_OWNER_AND_STAFF` (`:61`) | `coupons[0]` |
| `DELETE /api/coupons/:id` | `ADMIN_OWNER_AND_STAFF` (`:70`) | la cadena `This action removes a #id coupon` |
| `POST /api/approve-coupon` | `ADMIN_ONLY` (`:88`) | `find` por `body.id`, **muta en memoria** `is_approve = true` (de número a booleano) y lo devuelve. Un id desconocido lanza TypeError → 500 (`:105-109`) |
| `POST /api/disapprove-coupon` | `ADMIN_ONLY` (`:77`) | igual, con `false` (`:111-115`) |

**El mock** (`apps/api/rest/src/db/pickbazar/coupons.json`, medido con
`node -e`):

- 10 filas, ids 10→1 (**id DESC**), códigos únicos (`4OFF`, `5OFF`, `OFF6`,
  `BAZAR10`, `BAZAR20`, `BAZAR18`, `HELLO15`, `EID12`, `FOO`, `EID2`).
- Orden de claves de cada fila: `id, code, language, description, image,
  type, amount, minimum_cart_amount, active_from, expire_at, is_valid,
  target, is_approve, translated_languages, shop_id, user_id`. **No hay
  `created_at`/`updated_at`.**
- `type` vale `fixed` en 9 filas y `percentage` en una (id 4, `HELLO15`). La
  entidad admite además `free_shipping` (`entities/coupon.entity.ts:4-9`).
- `amount` y `minimum_cart_amount` son números enteros (160 en el id 10, 100
  en el 4, 0 en el resto).
- `target` vale `1` en el id 10 y `0` en el resto; `is_approve` vale `1` en
  las 10 (enteros, no booleanos). `description` y `user_id` son `null` en
  las 10.
- `shop_id ∈ {1, 2, 3}`: las tres tiendas existen en el seed.
- `image` es `{id, original, thumbnail}` en 8 filas y `{thumbnail, original,
  id}` en los ids 10 y 4. El admin crea con ese segundo orden
  (`apps/admin/rest/src/components/coupon/coupon-form.tsx:134-138`).
- `active_from`/`expire_at` son ISO con 3 decimales (`.000Z`). **Todos los
  `expire_at` ya pasaron** (2024-03-28 … 2025-05-26; hoy es 2026-10-20),
  pero `is_valid: true` en las 10.

**Consumidores** (verificados):

- **Shop**:
  - `framework/rest/client/index.ts:325-333`: `coupons.all` → `GET
    /coupons` y `coupons.verify` → `POST /coupons/verify`.
  - `framework/rest/coupon.ts` (`useCoupons`) y `coupon.ssr.ts` (prefetch
    anónimo).
  - `pages/offers.tsx:24-27` pide `limit=20` y **filtra en cliente**
    `Boolean(is_approve) && Boolean(is_valid)`.
  - `pages/shops/[slug]/offers.tsx:37-42` pide por `shop_id`, con el mismo
    filtro.
  - `framework/rest/settings.ts:78-100` (`useVerifyCoupon`): si `!is_valid`,
    pinta `t('common:' + data.message)`; siempre llama
    `applyCoupon(data?.coupon)`.
  - Cuerpo enviado: `{code, sub_total, item}`
    (`components/checkout/coupon.tsx:62-66`, tipo `VerifyCouponInputType` en
    `types/index.ts:509-513`).
  - La única clave de traducción de error que existe es
    `error-invalid-coupon` (`public/locales/en/common.json:201`).
- **Admin**:
  - `data/client/coupon.ts`: `get({code})` → `GET /coupons/{code}`;
    `paginated` envía `searchJoin=and` y `search=code:<texto>`;
    `approve`/`disapprove` envían `{id}`.
  - `pages/coupons/index.tsx:25-31` pide `limit=20`,
    `orderBy=created_at&sortedBy=desc` y `code`.
  - `components/coupon/coupon-list.tsx:233-242` pinta `is_approve` como
    booleano.
  - `components/checkout/coupon.tsx:40-43` verifica con `sub_total`.
- **Órdenes**: `create-order.dto.ts` acepta `coupon_id`, pero la FK
  `orders.coupon_id → coupons` **no es de esta US** (la pone US-58).

**Precedentes**:

- Propiedad por tienda: `products.service.ts:161-180` (DD29-4).
  `super_admin` pasa sin consultar; `store_owner`/`staff` deben ser dueños
  del `shop_id` (`findShopOwnerById`).
- `remove` devuelve el DTO borrado: `tags.service.ts:205-213`.

## Línea base (D-2 del épico)

Con `just db-up` y `just api-dev` **recién arrancada** (`approve-coupon`
muta la memoria, R-4). Tokens con `POST /api/token`. Cuerpos guardados en el
scratchpad.

```bash
API=http://localhost:9001/api
curl -s "$API/coupons?limit=20"                                   > base-coupons-shop.json
curl -s "$API/coupons?shop_id=1"                                  > base-coupons-shop1.json
curl -s "$API/coupons?searchJoin=and&search=code:BAZAR&limit=20&orderBy=created_at&sortedBy=desc" > base-coupons-admin-search.json
curl -s "$API/coupons/4OFF"                                       > base-coupon-4off.json
curl -s -X POST "$API/coupons/verify" -H 'Content-Type: application/json' -d '{"code":"NOEXISTE","sub_total":10,"item":[]}' > base-verify.json
```

## Tabla nueva

| Columna | Tipo y restricción | Origen / nota |
|---|---|---|
| `id` | `bigserial PRIMARY KEY` | id del mock |
| `code` | `text NOT NULL UNIQUE` | lookup de `GET /:param` |
| `description` | `text NULL` | |
| `image` | `json NULL` | Attachment (`{id, original, thumbnail}`). **`json`, no `jsonb`** (D-5 del épico): `jsonb` reordena las claves y los ids 10 y 4 traen `{thumbnail, original, id}` |
| `type` | `text NOT NULL CHECK (type IN ('fixed','percentage','free_shipping'))` | enum de la entidad |
| `amount` | `numeric NOT NULL CHECK (amount >= 0)` | `_dec()` → número |
| `minimum_cart_amount` | `numeric NOT NULL DEFAULT 0 CHECK (minimum_cart_amount >= 0)` | |
| `active_from` | `timestamptz NOT NULL` | |
| `expire_at` | `timestamptz NOT NULL`, `CHECK (expire_at > active_from)` | |
| `target` | `boolean NOT NULL DEFAULT false` | se emite `0/1` |
| `is_approve` | `boolean NOT NULL DEFAULT false` | se emite `0/1` |
| `shop_id` | `bigint NULL REFERENCES shops(id) ON DELETE CASCADE` + índice | Un cupón de tienda no tiene sentido sin su tienda, el mismo criterio que `products.shop_id`. `NULL` = cupón global creado por un `super_admin` |
| `user_id` | `bigint NULL REFERENCES users(id) ON DELETE SET NULL` + índice | El autor se puede borrar sin arrastrar el cupón |
| `language` | `text NOT NULL DEFAULT 'es'` | el seed copia `'en'` |
| `created_at` / `updated_at` | `timestamptz NOT NULL DEFAULT now()` | **no se emiten** (el mock no las trae) |

Sin trigger (D-7). `is_valid` y `translated_languages` **no son columnas**:
se calculan en el servicio.

## Reglas del seed

- Bloque `coupons` en `db/generate-seed.mjs`, **después** de `shops` y
  `users`. Ids preservados y `ON CONFLICT DO NOTHING`.
- Validación previa (falla con mensaje):
  - `shop_id` contra el conjunto final de shops;
  - `code` único;
  - `type` dentro del CHECK;
  - `expire_at > active_from`.
- `target` e `is_approve` llegan como entero y se convierten con `bool()`.
  `image` va con `json()`. `active_from`/`expire_at` se copian tal cual.
- `setval('coupons_id_seq', …)` en el bloque de secuencias.
- **Conteos**: `coupons` 10 (9 `fixed` + 1 `percentage`; 10 con
  `is_approve`; 1 con `target`). Por tienda: shop 1 → 6 (ids 10, 7, 6, 3, 2,
  1), shop 2 → 2 (9, 5), shop 3 → 2 (8, 4).

## Rutas

| Método y ruta | Guard (no cambia, R-6) | Después |
|---|---|---|
| `GET /coupons` | Public | Lista en **id DESC** (ignora `orderBy`, como hoy). Filtros reales, todos los que lleguen se combinan con AND: `shop_id`, `code` desde `search=code:<texto>` (ILIKE `%texto%`, sin distinguir mayúsculas). Defaults `page=1`, `limit=12`. Mismo `paginate()` y misma url |
| `GET /coupons/:param` | Public | Por `code`; 404 si no existe |
| `GET /coupons/:id/verify` | Public | **Corregida**: lee `:id`, lo trata como código (es la búsqueda que el autor invocaba) y responde lo mismo que `GET /coupons/:param`. No tiene consumidor |
| `POST /coupons/verify` | Public | Real. Cuerpo `{code, sub_total?, item?}`. Respuesta `{is_valid:true, coupon:<dto>}` si el cupón existe, `is_approve`, está vigente (`active_from <= now() < expire_at`) y `sub_total >= minimum_cart_amount`. Si falla cualquier condición: `{is_valid:false, message:'error-invalid-coupon'}`, HTTP 200, **sin** clave `coupon`. `sub_total` ausente o no numérico cuenta como 0 |
| `POST /coupons` | ADMIN_OWNER_AND_STAFF | Inserta y devuelve el DTO (201). `shop_id` del body con chequeo de propiedad (DD29-4); `is_approve` nace en `false`; `user_id` = `user.sub`. Código duplicado → 409 |
| `PUT /coupons/:id` | ADMIN_OWNER_AND_STAFF | Actualiza los campos del `CreateCouponDto` proyectados uno a uno, más `updatedAt: now()`. Propiedad por tienda. 404/409 |
| `DELETE /coupons/:id` | ADMIN_OWNER_AND_STAFF | Borra y devuelve el DTO borrado. Propiedad por tienda. 404 |
| `POST /approve-coupon` | ADMIN_ONLY | Persiste `is_approve = true` y devuelve el DTO. 404 si no existe |
| `POST /disapprove-coupon` | ADMIN_ONLY | Persiste `false` y devuelve el DTO. 404 si no existe |

El DTO (`toCouponDto`) emite las 16 claves del mock **en su orden**:

- `is_valid` se calcula en cada lectura con `now()` de `clock.ts`;
- `target` e `is_approve` salen como `1`/`0`;
- `translated_languages` es la constante `['en']`;
- `amount` y `minimum_cart_amount` salen como número (`_dec`);
- `active_from`/`expire_at` salen en ISO (`toISOString()`).

## Divergencias declaradas

| # | Dónde | Hoy | Después | Por qué |
|---|---|---|---|---|
| V-1 | `is_valid` en todo DTO | `true` literal en las 10 | `false` en las 10 (todas vencidas) | D-1: vigencia real. **Efecto visible**: `/offers` y `/shops/[slug]/offers` filtran en cliente por `is_valid` y quedan vacías con el seed tal cual. Renovar las fechas del seed **no** es de esta US (decisión 6: los registros son los del mock) |
| V-2 | — | — | — | **Retirada (2026-10-20).** Era el reordenamiento de `image` por `jsonb`. Con la columna en `json` el orden se preserva y deja de haber divergencia. El número se conserva para no renumerar |
| V-3 | `POST /coupons/verify` | cualquier código es válido y devuelve el cupón 9 con forma propia (12 claves, `deleted_at`, timestamps) | valida de verdad; `coupon` usa el DTO de lista (16 claves) | D-1 |
| V-4 | `GET /coupons` con `search` | `search` descarta `shop_id`; Fuse con umbral 0.1 | `shop_id` AND `code` ILIKE | D-1, filtro real |
| V-5 | Id o código desconocido | 200 vacío (`GET`) o 500 (`approve`) | 404 | precedente `tags` |
| V-6 | Escrituras | `POST`/`PUT` devuelven `[0]`; `DELETE` devuelve una cadena | fila real / DTO borrado | D-1 |
| V-7 | `approve`/`disapprove` | `is_approve` booleano tras mutar | `1`/`0`, igual que la lista | coherencia del contrato |
| V-8 | `GET /coupons/:id/verify` | 200 vacío siempre | igual que `GET /:param` | ruta corregida, sin consumidor |

## Scope

**Incluye:**

- la tabla `coupons` con su DDL, el bloque del generador y el seed
  regenerado;
- la re-introspección con el modelo `Coupon`;
- `CouponRecord` y su mapper;
- `coupons.repository.ts` (`listCoupons`, `findCouponByCode`,
  `findCouponById`, `createCoupon`, `updateCoupon`, `deleteCoupon`,
  `setCouponApproval`) con su integration test;
- `coupons.service.ts` reescrito sin el import del JSON, con su spec de
  Jest.

**NO incluye:**

- la FK `orders.coupon_id` (US-58) y aplicar el descuento en la orden
  (US-59);
- validar que los `item` del carrito pertenezcan a la tienda del cupón;
- renovar las fechas del seed;
- cambiar guards (R-6);
- tocar `apps/shop` o `apps/admin`;
- `settings.options.enableCoupons`, ya migrado;
- `translated_languages` como columna (D-6).

## Criterios de aceptación

### CA-1 — Seed y esquema

`just db-reset` deja `coupons` con 10 filas, el reparto por tienda de las
Reglas del seed y 0 huérfanas en `shop_id`/`user_id`. Los conteos previos
siguen intactos (R-3).

### CA-2 — Equivalencia de forma de la lista

`GET /coupons?limit=20` después de migrar, comparado con
`base-coupons-shop.json` con `node -e`, es deep-equal salvo V-1 (`is_valid`
en las 10). El orden de claves de `image` en los ids 10 y 4 se compara
también: con `json` debe salir idéntico. El paginador es idéntico, incluido `per_page:"20"`.
Lo mismo para `GET /coupons/4OFF` frente a `base-coupon-4off.json`.

### CA-3 — Filtros reales

- `GET /coupons?shop_id=1` devuelve los 6 de la tienda 1 en id DESC
  (`total: 6`).
- `GET /coupons?search=code:BAZAR` devuelve exactamente BAZAR10, BAZAR20 y
  BAZAR18.
- `shop_id=2&search=code:BAZAR` devuelve solo BAZAR18.

### CA-4 — Verificación real

`POST /coupons/verify`:

| Caso | Resultado esperado |
|---|---|
| código inexistente | `{is_valid:false, message:'error-invalid-coupon'}` |
| `4OFF` del seed (vencido) | `is_valid:false` |
| cupón vigente, aprobado, `sub_total` suficiente | `is_valid:true` con el DTO |
| cupón vigente con `minimum_cart_amount` 160 y `sub_total` 100 | `is_valid:false` |
| cupón vigente no aprobado | `is_valid:false` |

Los casos de vigencia se prueban con `_setNowProvider` en el spec y con un
cupón centinela `zz-coupon-*` creado vía `POST` en el `curl`.

### CA-5 — Escrituras y moderación persisten

- `POST /coupons` como `store_owner` sobre su tienda → 201 con
  `is_approve: 0`. Sobre una tienda ajena → 403. Con código duplicado → 409.
- `approve-coupon` → `is_approve: 1`, y un `GET /coupons/:code` posterior
  (tras **reiniciar la API**) lo sigue mostrando.
- `PUT` cambia `amount` y avanza `updated_at` en la base.
- `DELETE` devuelve el DTO y el `GET` siguiente da 404.

### CA-6 — Sin import huérfano y sin regresión

`grep -n "coupons.json" apps/api/rest/src -r` no devuelve nada.

`just db-check`, `npx jest`, `just build-api` y `just verify` en verde, con
recuentos pegados. `/api/settings` sigue en 5503 B.

## Escenarios Gherkin

```gherkin
Feature: Cupones desde Postgres
  Scenario: CA-2 — la lista conserva su forma
    Given la base recreada con los 10 cupones del mock
    When GET /api/coupons?limit=20
    Then el cuerpo es deep-equal a la linea base salvo is_valid e image de los ids 10 y 4
    And per_page vale "20"

  Scenario: CA-4 — un cupon vencido no se aplica
    Given el cupon 4OFF con expire_at 2024-03-28
    When POST /api/coupons/verify con code 4OFF y sub_total 500
    Then is_valid es false y message es "error-invalid-coupon"

  Scenario: CA-4 — el minimo del carrito se respeta
    Given un cupon vigente y aprobado con minimum_cart_amount 160
    When se verifica con sub_total 100
    Then is_valid es false

  Scenario: CA-5 — la aprobacion sobrevive a un reinicio
    Given el cupon zz-coupon-a creado por el store_owner con is_approve 0
    When el admin hace POST /api/approve-coupon con su id
    And se reinicia la API
    Then GET /api/coupons/zz-coupon-a devuelve is_approve 1
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---|---|
| `db/schema.sql` | tabla `coupons` con su banner; **sin tocar** sentencias previas |
| `db/generate-seed.mjs` | lectura de `coupons.json`, validación, bloque, `setval` y conteos |
| `db/seed.sql` | regenerado |
| `db/README.md` | sección de cupones: vigencia calculada y seed vencido (V-1) |
| `packages/db/prisma/schema.prisma` | modelo `Coupon` por `db pull` + renombres; inversas en `Shop`/`User`; CHECK en la cabecera |
| `packages/db/src/records.ts` | `CouponRecord` + `_toCouponRecord` |
| `packages/db/src/repositories/coupons.repository.ts` | nuevo |
| `packages/db/src/repositories/coupons.integration.test.ts` | nuevo |
| `packages/db/index.ts` | barrel |
| `packages/db/README.md` | records y repositorio nuevos |
| `apps/api/rest/src/coupons/coupons.service.ts` | reescrito contra `@safari/db` |
| `apps/api/rest/src/coupons/coupons.controller.ts` | `:id/verify` lee `:id`; `@CurrentUser` en las escrituras |
| `apps/api/rest/src/coupons/coupons.service.spec.ts` | nuevo |

## Definición de Done

Sigue el **Protocolo de ejecución** del README del épico. Lo específico:

- [ ] Línea base: los 5 cuerpos capturados con la API recién arrancada; se
  pega la lista de archivos con sus bytes.
- [ ] `just db-seed-generate` con los conteos nuevos en consola, más el
  fallo pegado de una corrida con un `shop_id` inexistente inyectado (y el
  JSON restaurado).
- [ ] `just db-reset` y `psql` con: `count(*)` = 10; el reparto por
  `shop_id`; 0 huérfanas por FK; conteos previos intactos.
- [ ] `npx prisma validate` + `migrate diff --exit-code` en `EXIT=0`, y
  `just db-build` limpio.
- [ ] CA-2: salida de `node -e` con el deep-equal y la lista exacta de
  claves excluidas (solo V-1).
- [ ] CA-3, CA-4 y CA-5: los `curl` con Bearer, el status exacto y el cuerpo
  relevante, incluido el `GET` posterior al reinicio.
- [ ] CA-6: `grep` vacío; `just db-check`, `npx jest`, `just build-api` y
  `just verify` con recuentos.
- [ ] Status actualizado aquí y en la tabla del épico.

## Notas para el agente ejecutor

- **El orden de las rutas importa.** `GET :param` está declarado antes que
  `GET :id/verify`, pero tienen distinto número de segmentos y no chocan. No
  reordenar.
- **`is_valid` se calcula con `now()` de `packages/db/src/clock.ts`**, no
  con `new Date()`: así el spec puede fijar el reloj con `_setNowProvider`.
- **V-1 merece una línea en el reporte final.** Con el seed del mock la
  página de ofertas del shop queda vacía. Es correcto, pero visible: el
  dueño puede querer otra US que renueve fechas.
- `CreateCouponDto` no declara `shop_id` y el `ValidationPipe` no hace
  whitelist. El admin lo envía igual (`coupon-form.tsx:150`). Leerlo del
  body de forma explícita y validarlo con `Number.isSafeInteger`.
- Un cupón global (`shop_id NULL`) solo lo puede crear o editar un
  `super_admin`.
- Para el chequeo de propiedad, reutilizar `findShopOwnerById` del barrel.
  No escribir otro.
