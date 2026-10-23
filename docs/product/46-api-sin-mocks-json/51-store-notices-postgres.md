# US-51 — `store-notices` desde Postgres (N:M + estado de lectura)

> Las 6 rutas de avisos de tienda dejan de servir JSON y se añade la ruta
> `POST /store-notices/read`, que el admin ya llama y hoy da 404. Es la
> primera US del épico que toca identidad: sus pivotes apuntan a `users` y
> `shops`, y crea el helper `resolverUsuarioPorEmail` que reutilizan las US
> siguientes.

**Épico:** [Épico 46](./README.md)
**Fecha:** 2026-10-20
**Status:** Implementada (2026-10-22, rama `us-51-store-notices`)
**Depende de:** [US-50](./50-attributes-postgres.md) (orden secuencial del
épico, R-2)
**LOC est.:** ~1900

## Historia

**Como** admin que publica avisos para vendedores y **como** dueño de tienda
que los recibe en la barra superior del panel, **quiero** que los avisos,
sus destinatarios y su estado de lectura vivan en Postgres, **para** que
marcar un aviso como leído persista y que cada usuario vea su propio estado.

## Contexto — verificado en código (2026-10-20)

Fuente previa: el análisis de
[US-34](../33-contenido-configuracion-postgres/34-esquema-capa-datos-contenido.md)
(remapeo por email, pivotes, ruta `/read` inexistente), re-verificado.

**Rutas.** `apps/api/rest/src/store-notices/store-notices.controller.ts`
declara `@Permissions(...ADMIN_AND_OWNER)` **a nivel de clase**
(`:22-23`):

- `POST /` (`:30`);
- `GET /` (`:35`);
- `GET /getUsersToNotify` (`:40-43`). **Ya está en Postgres** vía
  `UsersService.getUsersNotify` (`users/users.service.ts:86-91`); **no se
  toca**;
- `GET /:param` (`:45-51`);
- `PUT /:id` (`:53`);
- `DELETE /:id` (`:61`).

Son 6 rutas, de las que esta US migra 5 y **añade 1**.

**Qué hace hoy `store-notices.service.ts`:**

- `getStoreNotices`: `limit` por defecto **12**. `search` se parte en pares
  `clave:valor` (descartando `slug`) y se pasa a un Fuse `$and` con
  `keys:['notice']`. Así, cualquier clave que no sea `notice` (`users.id`,
  `shops.slug`, `shop_id`) devuelve `[]`. La url es
  `` `/store-notices?search=${search}&limit=${limit}` ``.
- `getStoreNotice`: busca por id numérico; 200 vacío si no existe.
- `create`/`update` devuelven `[0]`; `remove`, un string.

**Rutas que el frontend llama y la API no tiene:**

- `POST store-notices/read`
  (`apps/admin/rest/src/data/client/api-endpoints.ts:67`). El body es
  `{id, language?}` (`data/client/store-notice.ts:44-45`). Lo usa
  `useStoreNoticeRead` (`data/store-notice.ts:214-230`), que ignora la
  respuesta, desde `components/layouts/topbar/store-notice-bar.tsx:134`.
  **Esta US la crea.**
- `GET store-notices/getStoreNoticeType` (`api-endpoints.ts:68`) cae en
  `:param` y devuelve 200 vacío. **No se incluye**: se menciona en el
  reporte.

**Qué envía el frontend:**

- admin, barra superior (`store-notice-bar.tsx:36-41`): `limit=5`,
  `orderBy=updated_at`, `sortedBy=desc`, `language`.
- admin, `/store-notices` (`pages/store-notices/index.tsx:27-33`): `limit=20`,
  `page` y `notice`, que va dentro de `search=notice:…`.
- admin, `/[shop]/store-notices` (`pages/[shop]/store-notices/index.tsx:42-48`):
  `limit=15` y `shops=<slug>`, que `formatSearchParams` reescribe como
  `shops.slug:<slug>`.
- admin, filtro por usuario: `search=…;users.id:N`
  (`data/client/store-notice.ts:14-41`).
- shop (`apps/shop/src/framework/rest/client/index.ts:272-281`): `shop_id`
  como query y `search=shop_id:X;shops.slug:Y`. **Los clientes reciben 403**
  por el guard de clase (R-6 del épico): no se cambia.

**Forma del JSON** (`store-notices.json`, `node -e`):

- 3 filas en orden **id DESC**: 3, 2, 1.
- Claves en orden: `id, priority, notice, description, effective_from,
  expired_at, type, created_by, updated_by, created_at, updated_at,
  deleted_at, is_read, creator_role, creator, users, shops, read_status`.
- `priority` es `low`, `medium`, `high`. `type = 'all_vendor'` en las 3.
- `effective_from`/`expired_at` vienen como `"2023-03-15 18:00:00"`, sin
  `T` ni zona.
- **`created_by = 6`** en las 3 y `updated_by = 6` solo en la 2. El usuario 6
  es `admin@demo.com`, que en el seed es el **3**.
- `is_read: true` y `creator_role: "Super admin"` en las 3.
- `creator`: `{id:6, name:"admin", email, email_verified_at:null,
  created_at, updated_at, is_active:1, shop_id:null, permissions:[3 ×
  {id, name, guard_name, created_at, updated_at, pivot:{model_id,
  permission_id, model_type:"Marvel\\Database\\Models\\User"}}]}`.
- `users`: los usuarios 6 y 1, cada uno con `pivot:{store_notice_id,
  user_id}`.
- `shops: []`.
- `read_status`: los mismos 2 usuarios con `pivot.is_read` entero: 1 para el
  6, 0 para el 1.

**Serialización hoy.** `created_at`/`updated_at` de nivel superior salen con
3 decimales (`CoreEntity`). Los objetos anidados (`creator`, `users`,
`read_status`) **no** tienen `@Type` en la entidad
(`store-notices/entities/store-notice.entity.ts`), así que conservan los 6
decimales del JSON.

**Zona horaria.** La imagen `postgres:16-alpine` (`docker-compose.yml:13`)
corre en UTC. Verificar con `SHOW timezone`: los literales
`'2023-03-15 18:00:00'` del seed se interpretan en esa zona, y el servicio
los vuelve a formatear en UTC.

## Línea base (paso 2 del protocolo)

Con token de `admin@demo.com` (el viewer cuyo `is_read` es `true` en el
mock):

```bash
B=http://localhost:9001/api; H="Authorization: Bearer $TOKEN"
curl -s -H "$H" "$B/store-notices" > sn-default.json
curl -s -H "$H" "$B/store-notices?limit=5&orderBy=updated_at&sortedBy=desc&language=en" > sn-topbar.json
curl -s -H "$H" "$B/store-notices?limit=20&page=1&searchJoin=and&search=notice:Maintance" > sn-search.json
curl -s -H "$H" "$B/store-notices/2" > sn-2.json
curl -s -o /dev/null -w "%{http_code}\n" -H "$H" -X POST "$B/store-notices/read" -d '{"id":3}' -H "Content-Type: application/json"   # 404 hoy
```

## Tablas nuevas

| Tabla | Columnas | Restricciones |
|---|---|---|
| `store_notices` | `priority text NOT NULL`, `notice text NOT NULL`, `description text NULL`, `effective_from timestamptz NULL`, `expired_at timestamptz NOT NULL`, `type text NOT NULL`, `created_by bigint NOT NULL`, `updated_by bigint NULL`, timestamps | CHECK `priority IN ('high','medium','low')`; CHECK `type IN ('all_vendor','specific_vendor','all_shop','specific_shop')`; CHECK `effective_from IS NULL OR effective_from <= expired_at`; FK `created_by → users ON DELETE RESTRICT` (no se pierde el autor de un aviso que otros leen); FK `updated_by → users ON DELETE SET NULL`; índices |
| `store_notice_user` | `store_notice_id`, `user_id` | PK compuesta; las dos FK `ON DELETE CASCADE`; índice por `user_id` |
| `store_notice_shop` | `store_notice_id`, `shop_id` | PK compuesta; las dos FK `ON DELETE CASCADE`; índice por `shop_id` |
| `store_notice_read` | `store_notice_id`, `user_id`, `is_read boolean NOT NULL DEFAULT false`, `created_at` | PK compuesta; las dos FK `ON DELETE CASCADE` |

Los pivotes no llevan `updated_at` (precedente `permission_user`). Sin
triggers (D-7).

## Reglas del seed

1. **Helper nuevo `resolverUsuarioPorEmail(snapshot)`** en
   `db/generate-seed.mjs` (D-4 del épico).
   - Busca el email (case-insensitive) en los usuarios que el generador va a
     sembrar y devuelve **su id**.
   - En esta US **solo remapea**. Un email desconocido es error de
     generación, y el generador falla sin escribir `seed.sql`. Sembrar
     usuarios faltantes lo añade US-54 extendiendo este mismo helper.
   - Nunca copia el id del mock.
2. `store_notices`: 3 filas, ids preservados.
   - `created_by` y `updated_by` resueltos vía `creator.email`: 6 → 3.
     `updated_by` es 3 en la fila 2 y NULL en las demás.
   - `effective_from`/`expired_at` como literales del mock.
   - `created_at`/`updated_at` del mock vía `ts()` (D-3).
3. `store_notice_user`: 6 filas (`users[]` de cada aviso resuelto por email,
   así que los usuarios 3 y 1).
4. `store_notice_shop`: 0 filas.
5. `store_notice_read`: 6 filas, `is_read` con `bool()`: `true` para el 3 y
   `false` para el 1.
6. `setval` de `store_notices`.

Conteos esperados: 3 / 6 / 0 / 6 (3 leídos) y **0 filas con `created_by`
fuera de `users`**. Conteos previos intactos.

## Rutas — hoy → después

| Método y ruta | Guard (sin cambio) | Hoy | Después |
|---|---|---|---|
| `GET /store-notices` | ADMIN_AND_OWNER | Fuse `$and` sobre `notice`; otras claves dan `[]` | Filtros AND: `notice` (ILIKE), `users.id` (destinatario por pivote), `shops.slug` (tienda destinataria por pivote) y `shop_id` (ídem por id). Orden por defecto `id DESC`; `orderBy=updated_at&sortedBy=desc` sí se respeta (la barra superior lo pide). `limit` por defecto 12 |
| `GET /store-notices/:param` | ADMIN_AND_OWNER | por id; 200 vacío | por id; 404 |
| `GET /store-notices/getUsersToNotify` | ADMIN_AND_OWNER | Postgres | **sin cambio** |
| `POST /store-notices` | ADMIN_AND_OWNER | `[0]` | inserta con `created_by` = usuario del token. Destinatarios según `type`: `all_vendor` = todos los usuarios con permiso `store_owner` (en el seed, el 1 y el 3; coincide con el mock); `specific_vendor` = los ids de `received_by`; `all_shop` = todas las tiendas; `specific_shop` = las tiendas de `received_by`. Crea una fila de `store_notice_read` con `is_read=false` por cada usuario destinatario. Todo en una transacción. 400 si un id de `received_by` no existe |
| `PUT /store-notices/:id` | ADMIN_AND_OWNER | `[0]` | actualiza los campos y, si llegan `type`/`received_by`, reconcilia los pivotes. `updated_by` = usuario del token; `updatedAt: now()` |
| `DELETE /store-notices/:id` | ADMIN_AND_OWNER | string | borra (cascada a los pivotes) y devuelve la fila |
| `POST /store-notices/read` | ADMIN_AND_OWNER | **404** (no existe) | **nueva**: body `{id}`; upsert de `store_notice_read(id, usuario del token, is_read = true)`; devuelve el aviso proyectado para ese viewer. 404 si el aviso no existe |

**Proyección (D-1)**, en el orden de claves del mock:

- `effective_from`/`expired_at` se formatean en el servicio a `YYYY-MM-DD
  HH:mm:ss` UTC, para preservar el formato.
- `deleted_at: null` constante.
- `is_read`: `store_notice_read.is_read` del **viewer**, `false` si no tiene
  fila.
- `creator_role`: se deriva del permiso más alto del creador, con este
  mapeo: `super_admin` → `"Super admin"`, `store_owner` → `"Store owner"`,
  `staff` → `"Staff"`, `customer` → `"Customer"`.
- `creator`: se construye desde `users` + `permission_user` + `permissions`
  con las mismas claves, `is_active` como entero y `model_type` constante
  `"Marvel\\Database\\Models\\User"`.
- `users[]` y `read_status[]`: desde los pivotes, con su `pivot`.
- `shops[]`: desde `store_notice_shop`, con la forma de la tienda del
  contrato de `shops`.

## Divergencias declaradas

| # | Dónde | Hoy | Después | Por qué |
|---|---|---|---|---|
| V-1 | `created_by`, `updated_by`, `creator.id`, `users[].id`, `read_status[].id`, `pivot.user_id`/`model_id` | `6` | `3` | D-4: el 6 no existe; es `admin@demo.com` = 3 |
| V-2 | `creator.name` y `users[].name` del admin | `"admin"` | `"Jhon Doe"` | el nombre sale de `users` (seed), no del snapshot |
| V-3 | timestamps anidados (`creator`, `users[]`, `read_status[]`, `permissions[]`) | fechas de 2021-2023 con 6 decimales | `created_at`/`updated_at` reales de `users`/`permissions` (`now()` del `db-up`), con 3 decimales; `email_verified_at` del seed | se proyectan desde las tablas vivas; precedente `CLAUDE.md` |
| V-4 | `GET` con `search=users.id:N`, `shops.slug:X` o `shop_id:X` | `[]` | los avisos de ese destinatario | D-1: filtro real |
| V-5 | `is_read` de nivel superior | `true` para cualquier viewer | el estado del viewer (`false` para `store_owner@demo.com` en el seed) | D-1 |
| V-6 | `POST /store-notices/read` | 404 | 200 con el aviso | ruta que el admin ya llama |
| V-7 | `:param` inexistente / escrituras | 200 vacío / fila 0 | 404 / fila real | D-1 |

Las claves y valores de nivel superior que **no** están en V-1..V-7 deben
ser deep-equal a la línea base (para el viewer admin): `id`, `priority`,
`notice`, `description`, `effective_from`, `expired_at`, `type`,
`created_at`, `updated_at`, `deleted_at`, `is_read`, `creator_role` y
`shops`.

## Scope

**Incluye:**

- el DDL de las 4 tablas;
- el helper `resolverUsuarioPorEmail` (solo remapeo) y el bloque del
  generador;
- el seed regenerado;
- la re-introspección (`StoreNotice.creator`/`updater`/`users`/`shops`/
  `reads`, más las inversas en `User` y `Shop`);
- `StoreNoticeRecord`;
- el repositorio y su integration test;
- el barrel;
- el servicio de Nest sin import de JSON, con su spec;
- la ruta `POST /store-notices/read`;
- la documentación.

**NO incluye:**

- sembrar usuarios que falten (US-54);
- `GET getStoreNoticeType`;
- abrir la lectura a clientes del shop (R-6: guard intacto);
- tocar `getUsersToNotify` ni `UsersService`;
- notificaciones push o email;
- frontend.

## Criterios de aceptación

### CA-1 — Esquema

Las 4 tablas están en `db/schema.sql` según la tabla de arriba y no cambia
nada previo.

### CA-2 — Seed con identidad resuelta

- Conteos 3 / 6 / 0 / 6, y las 3 filas con `created_by = 3`.
- 0 huérfanas en las 6 FK nuevas.
- Una corrida del generador con un `creator.email` inexistente termina con
  código ≠ 0 y **no** sobrescribe `db/seed.sql` (se restaura el JSON
  después).

### CA-3 — Equivalencia acotada

Para el viewer admin, `GET /store-notices` y `GET /store-notices/2` son
deep-equal a la línea base **excluyendo solo** las claves de V-1..V-3.
`effective_from` y `expired_at` coinciden carácter a carácter. El
paginador coincide.

### CA-4 — Lectura por usuario

- Con token de `store_owner@demo.com`, `GET /store-notices/3` trae
  `is_read: false`.
- `POST /store-notices/read {id:3}` → 201 o 200, el status exacto que emita
  Nest para un `@Post` (documentarlo).
- El `GET` siguiente trae `is_read: true`, y el viewer admin no cambia.

### CA-5 — Escrituras

- Crear un aviso `specific_vendor` con `received_by:[1]` deja 1 fila en
  `store_notice_user` y 1 en `store_notice_read`.
- `received_by:[999]` da 400 sin filas sueltas.
- `PUT` fija `updated_by` y `updated_at`. `DELETE` borra en cascada.

### CA-6 — Sin import huérfano ni regresión

- `grep` sin imports de JSON en `store-notices/`.
- `GET /store-notices/getUsersToNotify` es byte a byte igual que antes.
- `just db-check`, `npx jest`, `just build-api` y `just verify` en verde.

## Escenarios Gherkin

```gherkin
Feature: Avisos de tienda desde Postgres
  Scenario: CA-2 — el creador es un usuario real
    Given store-notices.json declara created_by 6 y creator.email admin@demo.com
    When se aplica el seed
    Then las 3 filas de store_notices tienen created_by 3

  Scenario: CA-2 — un email desconocido detiene la generacion
    Given un aviso cuyo creator.email no existe en el seed
    When se ejecuta node db/generate-seed.mjs
    Then el proceso termina con codigo distinto de cero
    And db/seed.sql no se sobrescribe

  Scenario: CA-4 — marcar como leido es por usuario
    Given un token de store_owner@demo.com
    And el aviso 3 sin leer para ese usuario
    When POST /store-notices/read con id 3
    Then GET /store-notices/3 devuelve is_read true para ese usuario
    And para admin@demo.com is_read sigue siendo true

  Scenario: CA-3 — las fechas de vigencia conservan su formato
    When GET /store-notices/1
    Then effective_from vale "2023-03-15 18:00:00"
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---|---|
| `db/schema.sql` | 4 tablas |
| `db/generate-seed.mjs` | helper `resolverUsuarioPorEmail`; bloque de avisos + pivotes; validación |
| `db/seed.sql` | regenerado |
| `db/README.md` | modelo de avisos; regla de identidad por email (D-4) |
| `packages/db/prisma/schema.prisma` | 4 modelos + renombres de todos; inversas en `User`/`Shop` |
| `packages/db/src/records.ts` | `StoreNoticeRecord` (+ tipos de lectura con relaciones) |
| `packages/db/src/repositories/store-notices.repository.ts` (+ `.integration.test.ts`) | `listStoreNotices`, `findStoreNoticeById`, `createStoreNotice`, `updateStoreNotice`, `deleteStoreNotice`, `markStoreNoticeRead` |
| `packages/db/index.ts`, `packages/db/README.md` | exports y documentación |
| `apps/api/rest/src/store-notices/store-notices.service.ts` (+ `.spec.ts`) | Postgres; proyección por viewer |
| `apps/api/rest/src/store-notices/store-notices.controller.ts` | `@Post('read')` **antes** de las rutas con parámetro; `@CurrentUser` en lecturas y escrituras; el guard de clase no cambia |

## Definición de Done

Seguir el [Protocolo del épico](./README.md#protocolo-de-ejecución-de-una-us-de-este-épico)
y pegar:

- [x] Línea base (5 `curl`, el último con 404) con sus bytes.
- [x] Generador (corrida buena y corrida con email desconocido) y `just
      db-reset`.
- [x] `psql` con:
  - los conteos;
  - las 0 huérfanas;
  - `SELECT id, created_by, updated_by FROM store_notices`;
  - `SHOW timezone`;
  - los conteos previos.
- [x] `prisma validate` y `migrate diff` con `EXIT=0`; `just db-build`.
- [x] `just db-check` y `npx jest` con sus recuentos.
- [x] `just build-api` y `just verify`.
- [x] Deep-equal acotado de CA-3, con la lista de claves excluidas impresa.
- [x] Los `curl` de CA-4 y CA-5 con Bearer y status exacto.
- [x] `getUsersToNotify` antes y después.
- [x] `grep` sin imports de JSON.
- [x] Status de la US y fila del épico.

### Evidencia (2026-10-22)

**Línea base** (API mock recién arrancada, Bearer de `admin@demo.com`). Se
añadió `search=users.id:1` como «antes» de V-4:

```
sn-2.json            2359 B  id=2
sn-default.json      7348 B  ids=[3,2,1] total=3 per_page=12
sn-search.json       2692 B  ids=[3] total=1 per_page="20"
sn-topbar.json       7347 B  ids=[3,2,1] total=3 per_page="5"
sn-user1.json         333 B  ids=[] total=0 per_page=12
users-notify.json   17007 B  array len=3
POST /read: 404
```

**Generador:** la corrida buena da `… · 3 store_notices`. La corrida con
`creator.email = fantasma@demo.com` en el aviso 3 se detiene con
*store_notices 3.creator: email 'fantasma@demo.com' no casa con ningún
usuario del seed*, `EXIT=1`, y deja `seed.sql` intacto. El JSON se restauró
con `git checkout`.

**`psql` tras `just db-reset`:**

- `store_notices` 3 · `store_notice_user` 6 · `store_notice_shop` 0 ·
  `store_notice_read` 6, de las que 3 están leídas.
- 0 huérfanas en `created_by`, `updated_by` y los pivotes de usuario.
- `SHOW timezone` = `UTC`.

```
 id | created_by | updated_by |     effective_from     |       expired_at
  1 |          3 |            | 2023-03-15 18:00:00+00 | 2023-04-29 18:00:00+00
  2 |          3 |          3 | 2023-03-15 12:00:00+00 | 2023-03-30 12:00:00+00
  3 |          3 |            | 2023-03-15 18:00:00+00 | 2023-03-16 18:00:00+00
```

Lecturas: el usuario 3 tiene `t` en los 3 avisos y el usuario 1, `f`.
Conteos previos intactos: 8 attributes, 1 taxes, 8 refund_reasons, 19 faqs,
12 shops, 1200 products, 3 users y 6 permission_user.

**Prisma:** `prisma validate` dice *valid*. `migrate diff --exit-code` da
*No difference detected*, `EXIT=0`. Las relaciones quedan con nombre:
`StoreNotice.creator`/`updater`/`recipients`/`shops`/`reads`, y sus inversas
en `User` y `Shop`.

**Suites:**

| Comando | Antes (US-50) | Después |
|---|---|---|
| `just db-check` | 19 / 296 | **20 / 309** (+13) |
| `npx jest` | 17 / 348 | **18 / 364** (+16; 4 de ellos al confirmar los textos de `creator_role`) |

`just build-api` (`Done in 53.54s`) y `just verify` en verde: `API 5503B ·
Shop 190788B cards:30 · Admin 72821B`.

**CA-3** (deep-equal acotado, viewer admin). Claves excluidas:
`created_by, updated_by, creator, users, read_status`.

```
sn-default.json  ids antes=[3,2,1] despues=[3,2,1] | elementos deep-equal: true | orden de claves igual: true | paginador que difiere: ninguno
sn-topbar.json   ids antes=[3,2,1] despues=[3,2,1] | elementos deep-equal: true | orden de claves igual: true | paginador que difiere: ninguno
sn-search.json   ids antes=[3] despues=[3] | elementos deep-equal: true | orden de claves igual: true | paginador que difiere: ninguno
sn-2.json        deep-equal acotado: true | orden de claves: true
effective_from/expired_at antes: 2023-03-15 12:00:00 2023-03-30 12:00:00 | despues: 2023-03-15 12:00:00 2023-03-30 12:00:00
```

Dentro de los objetos anidados, el **conjunto y el orden de claves** de
`creator`, `users[0]` y `read_status[0]` son iguales, y `pivot.is_read` sigue
siendo entero.

**V-1..V-4:**

```
V-1 created_by/updated_by: 6 6 -> 3 3 | creator.id 6 -> 3 | users ids [6,1] -> [3,1]
V-2 creator.name: admin -> Jhon Doe
V-3 creator.created_at: 2023-03-16T09:37:20.000000Z -> 2026-10-23T00:33:56.878Z
V-4 users.id:1 antes 0 | despues 3 ids=[3,2,1]
```

**CA-4** (lectura por usuario):

| Paso | Resultado |
|---|---|
| `GET /store-notices/3` como `store_owner@demo.com` | `is_read: false` (el admin, `true`) |
| `POST /store-notices/read {id:3}` como dueño | **201** (Nest da 201 por defecto a un `@Post`). La respuesta trae `is_read: true` y `read_status` con los dos en `is_read: 1` |
| `GET /store-notices/3` de nuevo | dueño `true` · admin `true` (no cambió) |
| `POST /store-notices/read {id:999999}` | 404 |
| `GET /store-notices` como `customer@demo.com` | 403: R-6, el guard no cambia |

Después se devolvió la lectura (3, 1) a `false` por `psql`.

**CA-5** (Bearer de admin, payload con la forma del admin):

| Petición | Status | Resultado |
|---|---|---|
| `POST` `specific_vendor` con `received_by:[1]` | 201 | `created_by:3`, `effective_from:"2026-11-01 00:00:00"`, `users:[1]`, `read_status:[{user_id:1,is_read:0}]`. En `psql`, 1 fila en cada pivote |
| `POST` con `received_by:[999]` | 400 | `store_notices.received_by referencia un registro inexistente (999)`; filas 4 → 4 |
| `PUT` como `store_owner@demo.com` | 200 | `psql`: `updated_by = 1`, `updated_at > created_at` |
| `DELETE` | 200 | 0 filas de pivote restantes (cascada) |
| `GET /store-notices/999999` | 404 | (V-7) |

**CA-6:**

- `getUsersToNotify` mide 17007 B antes y después. No es byte a byte igual
  porque sus `created_at`/`updated_at` (de `users`, `profiles`,
  `permissions` y `shops`) toman el `now()` de cada `just db-reset`, y uno de
  `shops` lo mueve el test de integración de `shops`. Sin los campos `*_at`
  es **idéntico**. Esta US no toca esa ruta ni `UsersService`.
- El `grep` no devuelve nada (`exit=1`).
- `git diff db/schema.sql`: 75 inserciones y 0 eliminaciones.

**`creator_role` de los permisos que el mock no prueba: CONFIRMADO por el
dueño (2026-10-22).** Solo `"Super admin"` viene del mock. Los otros tres
textos los propuso esta US y quedan como decisión: `store_owner` →
`"Store owner"`, `staff` → `"Staff"` y `customer` → `"Customer"`, tomando
siempre el permiso más alto del creador (y `null` si no tiene ninguno). El
spec los cubre uno a uno.

**Fuera de alcance, para el reporte:** `GET
store-notices/getStoreNoticeType` sigue cayendo en `:param` y ahora da 404
(antes, 200 vacío).

## Notas para el agente ejecutor

- **El orden de las rutas importa**: `@Post('read')` no choca con
  `@Post()`, pero mantener las rutas literales antes que `:param` es la
  convención del archivo (`getUsersToNotify` ya va antes de `:param`).
- **El formato de `effective_from`** se arma con
  `toISOString().slice(0,19).replace('T',' ')` sobre el `Date` UTC. Sin
  librerías de fechas.
- **`creator_role`**: el mapeo no está documentado en ningún frontend.
  `"Super admin"` es el único valor que el mock prueba. Los demás
  (`"Store owner"`, `"Staff"`, `"Customer"`) los propuso esta US y el dueño
  los confirmó el 2026-10-22 (ver la evidencia).
- **`all_vendor` = usuarios con `store_owner`**: en el seed son el 1 y el 3,
  que es exactamente el `users[]` del mock tras el remapeo. Es la evidencia
  de que la regla es la correcta, no una coincidencia a ignorar.
- **El helper se reutiliza en US-54, 55, 56, 58 y 63**: dejarlo genérico
  (recibe un objeto con `email` y devuelve un id), con su contrato
  documentado en un comentario.
- **R-6**: el 403 del shop para clientes es real y queda igual. Si el
  agente lo considera un bug, va al reporte, no al código.
