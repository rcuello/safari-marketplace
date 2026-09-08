# Proposal: Endpoints de usuarios y staff desde Postgres

> US-25, cierre del Épico 19. Base: `exploration.md` de esta carpeta. Toda cifra y
> ruta de archivo de este documento se verificó abriendo el archivo citado.

## Intent

Los 7 grupos de `users.controller.ts` leen 3 usuarios de `users.json` con un índice
`fuse.js` cuyas keys son de productos (`users.service.ts:13-17`). `create()`
devuelve `this.users[0]` (`:23-25`), `makeAdmin()` no persiste (`:88-90`),
`banUser`/`activeUser` invierten un booleano en memoria (`:92-106`) y
`getMyStaffs`/`getAllStaffs` devuelven `data: []` salvo que llegue `text`
(`:192-238`). Esta US los pasa a `@safari/db` con escrituras reales y cierra el
último hueco de `@Permissions()`.

## Scope

### In Scope

- Los 6 listados (`users`, `admin/list`, `vendors/list`, `customers/list`,
  `my-staffs`, `all-staffs`) desde Postgres, con el envoltorio Laravel intacto.
- `GET /api/users/:id` con perfil, permisos y tiendas; 404 si el id no existe.
- Escrituras reales: `block-user`, `unblock-user`, `make-admin`, `POST /api/users`.
- `@Permissions(...ADMIN_ONLY)` en `ProfilesController` (único grupo sin decorador,
  `users.controller.ts:66`).
- Extracción de los 3 mappers de `auth.service.ts` a un archivo neutral y su reuso.
- `grantPermission` + `listUsersWithRelations` en `users.repository.ts`, con tests.

### Out of Scope (vinculante — "NO incluye" de la US)

- Perfiles más allá de la tabla `profiles`: los stubs `console.log` de
  `ProfilesController` (`users.controller.ts:70-78`) siguen siendo stubs.
- Wallets, direcciones, órdenes (`wallet`/`address`/`last_order` siguen `null`/`[]`,
  D-13), `ownership-transfer`, `become-seller` y cualquier frontend.
- `getStaffs` (`shops.service.ts:174-188`) y una tabla `shop_staff`: no hay DDL aquí.
- `dto/*` (incluye el enum `Permission` con valores viejos, `create-user.dto.ts:6-11`,
  R-4) y `AddStaffDto`, que sigue muerto.

## Capabilities

### New Capabilities

- `user-management-api`: los 7 grupos de administración de usuarios servidos desde
  Postgres — listados por permiso con paginación Laravel, detalle con relaciones,
  bloqueo/desbloqueo/promoción persistentes, guardas de auto-bloqueo y exigencia de
  `super_admin` en todo el módulo.

### Modified Capabilities

- `identity-data-layer`: pasa de 5 lecturas + 3 escrituras a 6 lecturas + 4. Añade
  `listUsersWithRelations` (mismo `where` que `listUsers`, extraído a un helper) y
  `grantPermission`. El requirement "Escrituras — exactamente tres"
  (`users.repository.ts:217`) se **amplía a cuatro**; D-2 (el hash sale de una sola
  función) no cambia.
- `authorization-guards-api`: el requirement de "las 117 rutas con permiso" **suma
  las 3 rutas de `profiles`** (`POST /`, `PUT /:id`, `DELETE /:id`) → 120.
- `auth-jwt-api`: **no cambia de requisito.** `/me` y `otpLogin` pasan a importar los
  mappers del archivo neutral; misma salida, refactor sin cambio observable.

## Approach — decisiones cerradas

| # | Decisión | Fundamento |
|---|---|---|
| **A1** | Los 5 listados por rol usan `listUsers`/`listUsersWithRelations` con `permissionName` distinto, vía **un helper privado** en `UsersService`; 5 wrappers de 3 líneas. | Evita 5 métodos casi idénticos (~70 LOC menos) y una sola fuente de divergencia. |
| **A2** | **Los ítems de lista llevan relaciones.** El admin renderiza `profile?.avatar?.thumbnail` (`apps/admin/rest/src/components/user/user-list.tsx:99-102`) y mapea `permissions` a chips (`:113-121`). Por eso se añade `listUsersWithRelations` (un `include`, no N+1) en vez de emitir `profile: null`. | La exploración solo analizó `/users/:id`; sin esto la tabla del admin pierde avatar y roles (R-2 del épico). |
| **A3** | **Un solo mapper** en `apps/api/rest/src/users/user-dto.mapper.ts` (`toUserDto`, `toProfileDto`, `toPermissionDto`, extraídos de `auth.service.ts:75-141`) sirve a `/me`, los 6 listados, `/users/:id` y `getUsersNotify`. Las 15 claves son idénticas: verificado contra `users.json` (exploración §8). | Archivo neutral: ni `auth` ni `users` es dueño del otro. Elimina el riesgo de que `/me` y `/users/:id` diverjan. |
| **A4** | **`my-staffs` es alias declarado de `all-staffs`** (`permissionName: 'staff'`), conservando cada uno su `url` propia (`/my-staffs/list?limit=` vs `/all-staffs/list?limit=`, `users.service.ts:208,232`). | La única relación usuario↔tienda es `shops.owner_id` (`db/schema.sql:236`), un dueño por tienda. El scoping real exige DDL nuevo, cerrado por la Decisión 2 del épico ("un DDL, un reset"). Limitación declarada, no oculta. |
| **A5** | `buildPaginator` de `@safari/db` (`packages/db/src/pagination.ts:37-65`) **pasando siempre `baseUrl = ${APP_URL}${url}`**. | Instrucción explícita de la US (`:144-145`). **Corrección factual:** las US del Épico 1 NO lo usan — `products/shops/categories.service.ts` usan el `paginate()` local (`products.service.ts:183`, `shops.service.ts:131`); `buildPaginator` tiene 0 consumidores en la API. Sin `baseUrl` las 4 claves `*_page_url` salen `null` donde el mock emite strings: **romper el contrato**. Con `baseUrl` la salida es idéntica clave por clave y en el mismo orden. |
| **A6** | **`make-admin` lee `@Body('user_id')`, no `@Param`.** Hoy el handler declara `@Param('user_id')` en una ruta sin ese path param (`users.controller.ts:61`): siempre `undefined`. El admin lo envía en el **body** (`apps/admin/rest/src/types/index.ts:442-444`, `data/client/user.ts:56-58`). | No es cambio de contrato de red: es leer el campo que el cliente ya manda. Sin esto el endpoint es inimplementable. |
| **A7** | `grantPermission(userId, permissionName)` **genérico e idempotente** en el repositorio (patrón `connect` de `createUser`, `users.repository.ts:244-247`); el servicio de Nest fija `'super_admin'`. El repositorio no conoce reglas de autorización. | D-1 y coherencia con el resto del paquete (funciones planas, sin lógica de dominio). |
| **A8** | **Guardas de auto-bloqueo SÍ, en el servicio de Nest** (no en el repositorio): (1) `@CurrentUser().sub === id` → **409**; (2) el objetivo tiene `super_admin` y `listUsers({permissionName:'super_admin'}).total === 1` → **409**. Precedente de 409: `auth.service.ts:204`. | La US lo pide y permite declinarlo; con 3 usuarios el coste son 2 consultas. `listUsers` no filtra `isActive` (`:190-201`): la regla se lee como "único usuario con el permiso" — conservadora, nunca deja el panel sin admin. |
| **A9** | **`make-admin` no surte efecto hasta el siguiente login** (D-5: el guard resuelve permisos del token). Se documenta en el comentario del método y en el reporte. **No** se añaden consultas a la base en el guard. | Instrucción explícita de la US (`:140-143`) y de `authorization-guards-api`. |
| **A10** | `getUsersNotify` **se reimplementa** sobre `listUsersWithRelations({page:1, limit})` + `toUserDto`, misma firma y array plano. `store-notices/*` **no se edita**: Nest resuelve la promesa que devuelve el handler (`store-notices.controller.ts:40-43`). | Es el import huérfano de CA-6 (`store-notices.module.ts:8` provee su propia instancia de `UsersService`). Declararlo roto sería una regresión silenciosa sin cobertura de test. |
| **A11** | `PUT /api/users/:id` y los `DELETE` (users y profiles) **son stubs declarados sin array en memoria**: el `PUT` lee y devuelve el usuario pedido (404 si no existe) sin persistir; `remove()` mantiene su string (`users.service.ts:84-86`). | No existe `updateUser` en `@safari/db` y crearlo entra en el "NO incluye" de perfiles; borrar choca con `shops.owner_id ON DELETE RESTRICT`. Ningún CA los cubre. El bug preexistente de `DELETE /profiles/:id` (borra un usuario) **no se arregla**: se documenta. |
| **A12** | `POST /api/users` crea con `createUser` (hash `bcryptjs` coste 10, Decisión 6) y permiso fijo `customer`; `address`, `profile` y `permission` del DTO se ignoran (declarado). `DuplicateEmailError` → 409. | Hoy devuelve `this.users[0]`: sin el array, cambiar es obligatorio. El enum del DTO emite `'Customer'`, que no existe en el catálogo (R-4), y `dto/*` está fuera del scope. |
| **A13** | `block-user`/`unblock-user` dejan de **invertir** el flag: `setUserActive(id, false/true)` explícito e idempotente; 404 si el id no existe. | El toggle actual (`:92-106`) hace que dos "block" seguidos reactiven al usuario. |

## Cifras reales de las listas (CRÍTICO — no heredar las de la US)

La US afirma en `25-endpoints-usuarios-postgres.md:34-35` que `admin/list`,
`vendors/list` y `customers/list` devuelven 1 cada una. **Recontado aquí** sobre
`db/seed.sql:82-89` (`permission_user` = `(3,1),(3,2),(3,3),(2,2),(1,2),(1,3)`;
catálogo de `permissions` en `:70-75`):

| Endpoint | `permissionName` | `total` real | La US decía |
|---|---|---|---|
| `admin/list` | `super_admin` | **1** (user 3) | 1 ✅ |
| `vendors/list` | `store_owner` | **2** (users 1 y 3) | 1 ❌ |
| `customers/list` | `customer` | **3** (users 1, 2 y 3) | 1 ❌ |
| `my-staffs` / `all-staffs` | `staff` | **0** (nadie lo tiene) | 1 ❌ |

Son un hecho del seed de US-20/US-21, **no una regresión de US-25**. Specs, tareas y
reporte de cierre MUST citar 1/2/3/0/0. Con 0 filas, `buildPaginator` emite
`current_page: 0`, `last_page: 0`, `lastItem: -1` — idéntico al `paginate()` del mock
con `total = 0` (misma corrección de rango, `pagination.ts:42-47` vs
`paginate.ts:16-20`).

## Affected Areas

| Área | Impacto | Cambio |
|---|---|---|
| `apps/api/rest/src/users/users.service.ts` | Modified | Reescritura: fuera `fuse.js`/`users.json`; helper de listados + 7 grupos sobre `@safari/db` |
| `apps/api/rest/src/users/user-dto.mapper.ts` | New | Los 3 mappers extraídos de `auth.service.ts:75-141` |
| `apps/api/rest/src/auth/auth.service.ts` | Modified | Borra los 3 mappers e importa del nuevo archivo |
| `apps/api/rest/src/users/users.controller.ts` | Modified | `@Permissions` en `ProfilesController`; `@Body('user_id')`; `@CurrentUser()` en `block-user` |
| `packages/db/src/repositories/users.repository.ts` | Modified | `_usersWhere` + `listUsersWithRelations` + `grantPermission` |
| `packages/db/index.ts` | Modified | 2 exports nuevos |
| `packages/db/src/repositories/users.integration.test.ts` | Modified | Cobertura de lo anterior + filtro `staff` = 0 |

## Risks

| Riesgo | Sev. | Mitigación |
|---|---|---|
| Heredar las cifras de la US (1/1/1) deja el reporte de cierre objetivamente falso al primer `curl` | **CRÍTICO** | Tabla de cifras reales arriba; la DoD cita 1/2/3/0/0 |
| `buildPaginator` sin `baseUrl` → 4 claves `null`: contrato roto en 6 rutas | **Alto** | A5; la DoD compara key-sets **y valores** de `*_page_url` |
| Listados sin relaciones rompen avatar y chips de rol del admin | Alto | A2 (`listUsersWithRelations`); verificación visual, no solo `curl` (R-2 del épico) |
| `getUsersNotify` compila y queda roto en runtime, sin test | Medio | A10 |
| `my-staffs` se intenta con scoping real → exige DDL y sale del épico | Medio | A4, declarado antes de `sdd-apply` |
| Un admin se bloquea a sí mismo o al último `super_admin` → panel inaccesible sin `db-reset` | Medio | A8 (409 + test de integración) |
| `make-admin` "no funciona" (el permiso no aparece hasta el siguiente login) | Bajo | A9: documentado como comportamiento intencionado |
| `created_at`/`updated_at` divergen (el seed no los inserta; `Date.toJSON()` da 3 decimales, Laravel 6) | Bajo | Divergencia ya embarcada desde `/api/settings`; se declara, no se corrige |

## Rollback Plan

1. **Código**: `git checkout packages/db apps/api/rest` + `just db-build` +
   `just build-api`. **No hay DDL**: ni `db/schema.sql` ni `schema.prisma` cambian,
   así que **no hay migración que deshacer ni `db-reset` obligatorio**. El mock
   `users.json`/`fuse.js` vuelve intacto.
2. **Datos que `git` no deshace** (único caveat): las escrituras reales sobreviven —
   `users.is_active` cambiado por `block-user`, filas nuevas en `permission_user` por
   `make-admin`, usuarios creados por `POST /api/users`. Limpieza dirigida:
   `UPDATE users SET is_active = true;`
   `DELETE FROM permission_user WHERE NOT (user_id, permission_id) IN ((3,1),(3,2),(3,3),(2,2),(1,2),(1,3));`
   `DELETE FROM users WHERE id > 3;` — o `just db-reset`, que restaura el seed exacto.
3. **Rollback parcial**: si solo falla la API, revertir `apps/api/rest` y dejar
   `packages/db`; las 2 funciones nuevas quedan inertes (nadie las consume).

## Estimación y entrega

| Área | Líneas aprox. (add+del) |
|---|---|
| `users.service.ts` (~237 borradas + ~200 nuevas, con el helper de A1) | ~437 |
| `users.repository.ts` + `index.ts` + tests de integración | ~195 |
| `user-dto.mapper.ts` (nuevo) + `auth.service.ts` (~68 borradas) | ~155 |
| `users.controller.ts` | ~10 |
| **Total** | **~700 (±80)** |

La US estimaba ~420: no contempla la extracción del mapper, el refactor de
`auth.service.ts` ni la suite de integración que su propia tabla de archivos exige.

- `Decision needed before apply: Yes`
- `Chained PRs recommended: Yes`
- `400-line budget risk: High`

Cadena recomendada de **3 PRs** con corte por seam (precedente US-24):
**PR#1 `packages/db`** (~195 líneas; verificación autónoma `just db-check`; rollback
trivial, sin consumidores) → **PR#2 refactor puro del mapper** (~155; `just build-api`
+ `GET /api/me` byte a byte idéntico; separa refactor de feature) → **PR#3 migración
de `users.service`/`users.controller`** (~447; los `curl` de la DoD). Si PR#3 excede
las 400 al abrirlo, partir en **3a lecturas** (6 listados + detalle, ~270) y
**3b escrituras** (block/unblock/make-admin/create + guardas, ~180).
`sdd-tasks` emite el forecast autoritativo.

## Dependencies

- US-21 mergeada (`listUsers`, `findUserWithRelations`, `setUserActive`, `createUser`).
- US-23 mergeada (`@Permissions`, `PermissionsGuard`, `@CurrentUser`).
- `just db-up` + `just db-build` antes de cualquier verificación.

## Success Criteria (1:1 con la DoD de la US)

- [ ] `curl` pegado de los 7 grupos con token de admin: datos de la base y envoltorio
      de paginación intacto (incluidas las 4 `*_page_url` con string, no `null`).
- [ ] Comparación de key-sets mock vs Postgres para `GET /api/users` y
      `GET /api/users/:id`, con las divergencias declaradas (`created_at`/`updated_at`).
- [ ] `curl` de CA-4: bloquear → login **401** → desbloquear → login **200**.
- [ ] `curl` de CA-5: sin token **401**, token `customer` **403**, incluido `/profiles`.
- [ ] `curl` de las guardas de A8: auto-bloqueo **409** y último `super_admin` **409**.
- [ ] `just db-check` verde con los tests nuevos, recuento pegado.
- [ ] `just build-api` limpio y `just verify` verde.
- [ ] Nota en el reporte con las cifras reales **1/2/3/0/0** y la aclaración de que no
      es regresión; mención de `become-seller`/`ownership-transfer` intactos y del
      bug preexistente de `DELETE /profiles/:id`.
- [ ] Tarea de cierre **documental** (no código): revisar el "NO incluye" de
      `docs/product/1-catalogo-desde-postgres/5-endpoints-derivados-postgres.md:52-53`
      — la tabla de usuarios ya existe, pero `getStaffs` lee `shop.staffs` por tienda
      (`shops.service.ts:174-181`) y **esa** relación sigue sin tabla: queda diferido
      con la razón corregida, no "no existe tabla de usuarios".
- [ ] Status de US-25 actualizado, fila del épico marcada y **Épico 19 cerrado**.
