# User Management Api Specification

## Purpose

Los 7 grupos de `users.controller.ts` leían 3 usuarios fijos de
`users.json` sin persistir. Esta capability los sirve desde Postgres
(`@safari/db`), cierra el hueco de `@Permissions()` en `profiles`, y añade
guardas de auto-bloqueo.

## Requirements

### Requirement: Listado paginado de usuarios desde la base (CA-1)

`GET /api/users` MUST devolver usuarios de Postgres con el envoltorio
Laravel de `buildPaginator`, invocado siempre con `baseUrl`. Con `baseUrl`,
`first_page_url` y `last_page_url` MUST ser strings; `next_page_url` y
`prev_page_url` son strings solo cuando existe página siguiente y `null`
en caso contrario, exactamente como el mock
(`apps/api/rest/src/common/pagination/paginate.ts:66-73`) — con el seed de
3 usuarios hay una sola página, así que ambas son `null`. Cuando
`next_page_url` no es `null`, `prev_page_url` apunta a la página ACTUAL,
no a la anterior: rareza del mock reproducida a propósito. `text` MUST
filtrar por nombre o email insensible a mayúsculas.

#### Scenario: Listado trae usuarios reales con envoltorio completo

- GIVEN un token `super_admin`
- WHEN se consulta `GET /api/users`
- THEN trae los 3 usuarios sembrados
- AND `first_page_url` y `last_page_url` son strings
- AND `next_page_url` y `prev_page_url` son `null` (una sola página)
- AND `per_page` es la string cruda de la query, no un number

### Requirement: Listas por rol filtran por permiso, con las cifras reales del seed (CA-2)

`admin/list`, `vendors/list`, `customers/list`, `my-staffs` y `all-staffs`
MUST filtrar por permiso vía `listUsersWithRelations`; cada ítem MUST
incluir `profile` y `permissions[]` (avatar y chips de rol en el admin).
Cifras reales del seed:

| Endpoint | permiso | `total` |
|---|---|---|
| `admin/list` | `super_admin` | 1 |
| `vendors/list` | `store_owner` | 2 |
| `customers/list` | `customer` | 3 |
| `my-staffs` / `all-staffs` | `staff` | 0 |

Con `total = 0`, `current_page: 0, last_page: 0, lastItem: -1`. `my-staffs`
MUST ser alias declarado de `all-staffs` (mismo filtro `staff` — el esquema
solo modela `shops.owner_id`, sin relación staff↔tienda), con `url` propia.

#### Scenario: Las cinco listas devuelven las cifras reales, no las de la US

- GIVEN el seed sin modificar
- WHEN se consultan los cinco endpoints con token `super_admin`
- THEN los `total` son 1, 2, 3, 0 y 0, y ningún ítem omite `profile`/`permissions`, cada uno con su propia `url`

### Requirement: Detalle de usuario con las mismas 15 claves de /me (CA-3)

`GET /api/users/:id` MUST publicar las mismas 15 claves que `GET /api/me`
(mismo mapper), con `wallet`/`last_order` en `null` y `address` en `[]`
(D-13). Un `id` inexistente MUST devolver `404`, nunca `undefined` ni 500.
Ninguna respuesta del módulo (detalle o listados) MUST incluir el hash de
contraseña, en ningún nivel de anidamiento (D-2).

#### Scenario: Key-set idéntico a /me, 404 ante id inexistente, sin hash

- WHEN se comparan las claves de `GET /api/users/:id` y `GET /api/me` del mismo usuario, y se consulta `GET /api/users/99999`
- THEN el key-set es idéntico, sin hash en ningún campo, y la segunda respuesta es `404`

### Requirement: Bloqueo, desbloqueo y promoción persisten, con guardas de auto-bloqueo (CA-4)

`block-user`/`unblock-user` MUST fijar `is_active` explícitamente
(`setUserActive`), MUST NOT invertir el valor actual — dos `block-user`
seguidos dejan al usuario bloqueado. Un `id` inexistente MUST devolver
`404`; un bloqueado MUST recibir `401` en `POST /api/token`. `block-user`
MUST devolver `409` si el actor se bloquea a sí mismo, o si el objetivo es
el único `super_admin` (conteo sin filtrar `isActive` — conservador por
diseño). `make-admin` MUST leer `user_id` del body (no de un path param
inexistente) y conceder `super_admin` vía `grantPermission`; el permiso
MUST NOT afectar al guard hasta el siguiente login del promovido (D-5).

#### Scenario: Dos bloqueos seguidos no reactivan, y el bloqueo impide el login

- GIVEN un usuario activo con credenciales válidas
- WHEN se llama `block-user` dos veces seguidas y luego ese usuario intenta `POST /api/token`
- THEN queda `is_active: false` tras ambas llamadas y el login es `401`

#### Scenario: Un admin no puede bloquearse a sí mismo, ni al último super_admin

- GIVEN un admin autenticado, y por separado el único usuario `super_admin`
- WHEN cada uno intenta bloquearse a sí mismo o ser bloqueado
- THEN ambas respuestas son `409`

#### Scenario: make-admin concede el permiso, pero no antes del siguiente login

- GIVEN un usuario sin `super_admin` y un token suyo emitido antes de la promoción
- WHEN se llama `POST /api/make-admin` con `{ user_id }` en el body
- THEN `GET /api/users/:id` ya incluye `super_admin`, pero el token previo decodificado sigue sin él

### Requirement: Creación real; actualización y borrado siguen siendo stubs declarados

`POST /api/users` MUST crear el usuario (`createUser`, bcrypt costo 10) con
permiso `customer` fijo, ignorando `permission`/`profile`/`address` del
DTO; email duplicado MUST devolver `409`, nunca 500. `PUT /api/users/:id`
MUST devolver el usuario pedido sin persistir cambios (404 si no existe).
`DELETE /api/users/:id` y los tres métodos de `ProfilesController` MUST
mantener su comportamiento de stub actual, incluido el bug preexistente de
`DELETE /api/profiles/:id` (borra un usuario, no un perfil) — declarado, no
corregido.

#### Scenario: Crear un usuario persiste y un email duplicado es 409

- WHEN se llama `POST /api/users` con un email nuevo, y luego con ese mismo email
- THEN el primero persiste con permiso `customer` y el segundo devuelve `409`

#### Scenario: PUT no persiste el cambio solicitado

- WHEN se llama `PUT /api/users/:id` con datos distintos a los actuales
- THEN una consulta posterior a `GET /api/users/:id` sigue mostrando los datos originales

### Requirement: Todo el módulo exige permiso de administración (CA-5)

Los 7 grupos — incluido `ProfilesController`, único sin `@Permissions()`
antes — MUST exigir un permiso administrativo. Sin token, `401`; con
`customer`, `403`.

#### Scenario: Un cliente no lista usuarios ni escribe perfiles

- GIVEN un token `customer`
- WHEN consulta `GET /api/users` y llama `POST /api/profiles`
- THEN ambas respuestas son `403`

### Requirement: Contratos preservados byte a byte, sin mock huérfano (CA-6)

Las claves y el casing publicados MUST permanecer idénticos al mock (API
snake_case, `@safari/db` camelCase, traducción en el servicio de Nest).
`created_at`/`updated_at` MUST declararse divergencia ya embarcada, no
regresión. `getUsersNotify` (consumido por `store-notices`) MUST conservar
firma y array plano, reimplementado sobre la capa de datos.

#### Scenario: getUsersNotify sigue sirviendo a store-notices

- WHEN se llama `GET /api/store-notices/getUsersToNotify`
- THEN la respuesta es un array plano de usuarios, misma forma que antes

## Out of Scope

`create`/`update`/`delete` de perfiles más allá de `profiles` (US-20) ·
wallets, direcciones, órdenes reales · `ownership-transfer`,
`become-seller` · `getStaffs` con scoping real (sin DDL) · `dto/*`
(`AddStaffDto`, muerto) · frontend · corregir `DELETE /api/profiles/:id`.
