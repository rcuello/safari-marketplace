# Tasks: Endpoints de usuarios y staff desde Postgres (US-25)

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | PR1 ~195, PR2 ~155, PR3 ~447 → **~797 total** |
| 400-line budget risk | High (per-slice: PR1 Low, PR2 Low, PR3 High) |
| Chained PRs recommended | Yes |
| Suggested split | PR1 `packages/db` → PR2 mapper refactor → PR3 feature (fallback: 3a reads ~270 / 3b writes ~180) |
| Delivery strategy | ask-on-risk (already resolved this session) |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

**Nota de divergencia**: la suma de filas de la propia tabla del `proposal.md`
(437+195+155+10) da **797**, no los "~700 (±80)" que el resumen declara;
coincide con la suma de `design.md` (195+155+447=797), ~17 por encima del
rango. No cambia la topología ya decidida, pero refuerza a PR3 como candidato
real a partirse en 3a/3b si el diff se confirma grande al abrirlo.

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|---|---|---|---|
| 1 | `packages/db`: 2 funciones + 2 exports + tests de integración | PR1, base `main` | Autónomo; gate `just db-check`; sin consumidores hasta PR3 |
| 2 | Extraer mapper de `auth.service.ts`, cero cambio observable | PR2, base = rama de PR1 | Gate: spec nuevo + diff byte a byte de `/api/me` |
| 3 | Migrar `users.service.ts` + `users.controller.ts` | PR3, base = rama de PR2 | Requiere `just db-build` tras PR1; gate: spec nuevo + `curl` de la DoD |

## Phase 1: PR1 — `packages/db` (~195 LOC) — gate `just db-check`

- [x] 1.1 Resolver la open question de diseño ANTES de lo demás: probar `prisma.permissionUser.upsert({update:{}})` sobre la PK compuesta (`schema.prisma:286`); si falla, usar `create` + `catch P2002` con la misma idempotencia.
- [x] 1.2 Extraer `_usersWhere(input)` del `where` inline de `listUsers` (`users.repository.ts:191-201`), reusado por `listUsers` y la nueva función.
- [x] 1.3 Añadir `listUsersWithRelations(input)`: mismo filtro que `listUsers` vía `_usersWhere`, `include: USER_RELATIONS` (`:139-143`), map con `_toUserWithRelations` (`:161-172`); devuelve `{items, total}`, un `findMany`+`count`, sin N+1.
- [x] 1.4 Añadir `grantPermission(userId, permissionName)`: resuelve el permiso por nombre, valida el usuario, aplica 1.1; devuelve `UserWithRelations | null` (null = usuario inexistente); permiso fuera de catálogo lanza `Error` NO exportado (`UnknownPermissionError`), nunca el error crudo de Prisma.
- [x] 1.5 Barrel `packages/db/index.ts`: exactamente 2 exports nuevos, orden alfabético — `grantPermission` tras `findUserWithRelations`, `listUsersWithRelations` tras `listUsers`. NO exportar `UnknownPermissionError`.
- [x] 1.6 Tests en `users.integration.test.ts`: relaciones incluidas sin N+1, filtro por permiso, `staff` total 0; `grantPermission` alta + idempotencia (sin fila duplicada) + rechazo de permiso inexistente como error de dominio; no-fuga de hash anclada a usuarios sembrados (hash `$2y$…`), nunca a un centinela.
- [x] 1.7 Invariante de test (recordatorio ejecutable): ningún test concede `super_admin` ni `staff` a un usuario `@users-integration.test`; los de `grantPermission` usan `store_owner`; casing mezclado solo en la parte local del email.
- [x] 1.8 `just db-up` + `just db-check`; pegar salida real (typecheck + vitest) como evidencia.
- [x] 1.9 `just db-build` (tsup → `dist/`) — obligatorio antes de que PR3 pueda consumir los exports vía `link:`.

## Phase 2: PR2 — extracción del mapper, refactor puro (~155 LOC) — gate `user-dto.mapper.spec.ts` + diff byte a byte de `/api/me`

- [ ] 2.1 Crear `apps/api/rest/src/users/user-dto.mapper.ts` con `toProfileDto` (ex `auth.service.ts:81-93`), `toPermissionDto` (ex `:101-114`), `toUserDto` (ex `toMeDto`, `:123-141`) — movidas verbatim.
- [ ] 2.2 Repuntar `auth.service.ts` a importar las tres funciones; único call site de `toUserDto` es `:525` dentro de `me()` — mismo comportamiento.
- [ ] 2.3 Borrar los 4 imports huérfanos en `auth.service.ts`: `toShopDto` (`:48`), `type PermissionRecord` (`:27`), `type ProfileRecord` (`:28`), `type UserWithRelations` (`:29`). Mantener `User` (`:47`, usado en `:521`).
- [ ] 2.4 Escribir `apps/api/rest/src/users/user-dto.mapper.spec.ts`: `toUserDto` emite las 15 claves en orden desde un fixture `UserWithRelations`; `toProfileDto`/`toPermissionDto` sintetizan `id`/`customer_id`/`pivot`.
- [ ] 2.5 `cd apps/api/rest && npx jest`; confirmar que las 33 pruebas previas siguen verdes junto al spec nuevo.
- [ ] 2.6 `just build-api`; `curl GET /api/me` antes/después y comparar byte a byte (o tamaño) para probar cero cambio observable.

## Phase 3: PR3 — migración de `users.service.ts`/`users.controller.ts` (~447 LOC; fallback 3a/3b) — gate `users.service.spec.ts` + `npx jest` + `curl`

- [ ] 3.1 Quitar el import de `users.json` y el índice `fuse.js` de `users.service.ts` (`:1-17`).
- [ ] 3.2 Helper privado `_listByPermission(query, url, permissionName?)`: llama `listUsersWithRelations` + `buildPaginator(baseUrl)` (D-B); base de los 5 wrappers de 3 líneas (A1).
- [ ] 3.3 D-B guarda #1: `Number(page)||1` y `Number(limit)||30` numéricos hacia el repositorio y hacia `buildPaginator({page})`; `limit` crudo (string) + `baseUrl` hacia `buildPaginator({limit, baseUrl})`.
- [ ] 3.4 Implementar `GET /api/users`, `admin/list`, `vendors/list`, `customers/list`, `my-staffs`, `all-staffs` sobre el helper con `permissionName` `super_admin`/`store_owner`/`customer`/`staff` (x2); `my-staffs`/`all-staffs` conservan cada uno su propia `url`.
- [ ] 3.5 Implementar `GET /api/users/:id` (`findOne`) vía `findUserWithRelations` + `toUserDto`; `404` si `null`.
- [ ] 3.6 D-B guarda #3: en `findOne`/`update`/`banUser`/`activeUser`/`makeAdmin`, `if (!Number.isInteger(id)) throw new NotFoundException(...)` antes de llamar al repositorio (hoy `+id` en `users.controller.ts:36-38` produce `NaN` → 500).
- [ ] 3.7 `block-user`/`unblock-user` vía `setUserActive(id, bool explícito)`, sin invertir; `block-user` `409` si `@CurrentUser().sub === id` o si el objetivo es el único `super_admin` (`listUsers({permissionName:'super_admin'}).total<=1`); `unblock-user` sin guardas pero lee `findUserWithRelations` antes (404 + relaciones).
- [ ] 3.8 Añadir `@CurrentUser()` a la ruta/servicio de `block-user` para soportar la guarda de auto-bloqueo.
- [ ] 3.9 `make-admin`: cambiar `users.controller.ts:61` de `@Param('user_id')` a `@Body('user_id')`; el servicio hace `Number(user_id)` + guarda `Number.isInteger` (D-B guarda #4; `MakeAdminInput.user_id` es string) y llama `grantPermission(id,'super_admin')`; comentar que el permiso no aplica al guard hasta el siguiente login (D-5, sin lookup nuevo).
- [ ] 3.10 `POST /api/users` (create) vía `createUser` (bcrypt costo 10) + `permissionNames:['customer']`; ignorar `address`/`profile`/`permission` del DTO; `DuplicateEmailError` → `409`.
- [ ] 3.11 `PUT /api/users/:id` stub: leer y devolver vía `findUserWithRelations` (404 si `null`), sin persistir.
- [ ] 3.12 `@Permissions(...ADMIN_ONLY)` de clase en `ProfilesController` (`users.controller.ts:66`); dejar los `console.log` y el bug de `DELETE /profiles/:id` intactos.
- [ ] 3.13 Reimplementar `getUsersNotify` sobre `listUsersWithRelations({page:1, limit: Number(limit)||30})` (D-B guarda #2) + `toUserDto`, mismo array plano; confirmar que `UsersService` sigue sin dependencias de constructor (D-E) para que la segunda instancia de `StoreNoticesModule` siga resolviendo.
- [ ] 3.14 Escribir `users.service.spec.ts` (`new UsersService()` + `jest.mock('@safari/db')` con `requireActual`, arnés de `shops.service.spec.ts:21-38,57`): envoltorio de `getUsers` igual clave por clave y **por tipo** a `{data,...paginate()}` con `limit="20"` (`per_page:"20"`), `total=0` clamp; `404` en id inexistente y no numérico; `409` en auto-bloqueo/último admin; `getUsersNotify` con `?limit=5` recibe `take:5`, no `"5"`.
- [ ] 3.15 `cd apps/api/rest && npx jest`; pegar el conteo de pruebas pasadas.
- [ ] 3.16 `just build-api`; pegar salida limpia.
- [ ] 3.17 Fallback documentado (sin acción salvo que el diff real lo exija): si PR3 supera 400 líneas al abrirse, partir en 3a lecturas (~270: 6 listados + detalle) y 3b escrituras (~180: block/unblock/make-admin/create + guardas).

## Phase 4: Evidencia y cierre (Definición de Done)

- [ ] 4.1 `curl` de los 7 grupos con token `super_admin`; pegar salida con datos reales y envoltorio de paginación intacto (4 `*_page_url` como strings).
- [ ] 4.2 Diff de key-sets mock vs Postgres para `GET /api/users` y `GET /api/users/:id` con `node -e` (jq no disponible en Git Bash); declarar divergencia `created_at`/`updated_at`.
- [ ] 4.3 `curl` CA-4: bloquear → login `401` → desbloquear → login `200`.
- [ ] 4.4 `curl` CA-5: sin token `401`, token `customer` `403` (incluido `/profiles`).
- [ ] 4.5 `curl` de las guardas A8: auto-bloqueo `409`, último `super_admin` `409`.
- [ ] 4.6 `just db-check` verde; pegar el recuento.
- [ ] 4.7 `just build-api` limpio (evidencia final) y `just verify` verde (solo liveness, no prueba ningún CA).
- [ ] 4.8 Nota en el reporte: cifras reales de las listas **1/2/3/0/0** (no el 1/1/1 de la US) — hecho del seed de US-20/21, no regresión.
- [ ] 4.9 Tarea documental: corregir en `docs/product/1-catalogo-desde-postgres/5-endpoints-derivados-postgres.md:52-53` la razón por la que `getStaffs` sigue diferido — ya no es "no existe tabla de usuarios" (existe), sino que falta la relación staff↔tienda (`shops.service.ts:174-181`).
- [ ] 4.10 Actualizar el status de US-25, la fila del épico, y cerrar **Épico 19**.
