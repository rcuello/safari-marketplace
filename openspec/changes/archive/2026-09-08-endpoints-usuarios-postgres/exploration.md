# Exploration: Endpoints de usuarios y staff desde Postgres (US-25, Épico 19)

> Fuente: `docs/product/19-autenticacion-autorizacion/25-endpoints-usuarios-postgres.md`
> + `docs/product/19-autenticacion-autorizacion/README.md`. Precedentes leídos en
> profundidad: `openspec/changes/archive/2026-09-02-capa-datos-identidad` (US-21),
> `openspec/changes/archive/2026-09-03-guards-autorizacion-api` (US-23),
> `openspec/changes/archive/2026-09-03-recuperacion-password-otp` (US-24), y los
> specs mergeados `identity-data-layer`, `authorization-guards-api`, `auth-jwt-api`.
> Toda afirmación concreta de este documento fue verificada abriendo el archivo
> citado (`file:line`) o corriendo un comando de solo lectura (`grep`, `find`).
> No se corrió `just db-up`/`db-reset` ni se tocó código de producción.

## Current State

### 1. Los 7 grupos de controladores del mock (verificado, no de la US)

Todos en `apps/api/rest/src/users/users.controller.ts`, un solo módulo
`UsersModule` (`apps/api/rest/src/users/users.module.ts:1-24`):

| Grupo | Controller | Rutas | `@Permissions()` hoy |
|---|---|---|---|
| `users` | `UsersController` (`users.controller.ts:20-64`) | `POST /`, `GET /`, `GET /:id`, `PUT /:id`, `DELETE /:id`, `POST /unblock-user`, `POST /block-user`, `POST /make-admin` | `@Permissions(...ADMIN_ONLY)` ya aplicado (línea 20) |
| `profiles` | `ProfilesController` (`:66-84`) | `POST /`, `PUT /:id`, `DELETE /:id` | **Sin decorador** — hueco de CA-5 |
| `admin/list` | `AdminController` (`:86-95`) | `GET /` | `@Permissions(...ADMIN_ONLY)` ya aplicado |
| `vendors/list` | `VendorController` (`:97-106`) | `GET /` | `@Permissions(...ADMIN_ONLY)` ya aplicado |
| `my-staffs` | `MyStaffsController` (`:108-117`) | `GET /` | `@Permissions(...ADMIN_ONLY)` ya aplicado |
| `all-staffs` | `AllStaffsController` (`:118-127`) | `GET /` | `@Permissions(...ADMIN_ONLY)` ya aplicado |
| `customers/list` | `AllCustomerController` (`:129-138`) | `GET /` | `@Permissions(...ADMIN_ONLY)` ya aplicado |

**CA-5 no parte de cero**: US-23 ya anotó 6 de los 7 controladores con
`@Permissions(...ADMIN_ONLY)` (confirmado también en
`openspec/specs/authorization-guards-api/spec.md:121-134`, que cuenta
`/api/users` y todo `*/list` entre las 117 rutas "con permiso"). El único
grupo sin anotar es `ProfilesController` — su `@Post()`/`@Put(':id')` son
`console.log` stubs (`users.controller.ts:71-73,76-78`) y `@Delete(':id')`
delega en `usersService.remove(id)`, que en el mock es un borrado de
**usuario**, no de perfil (bug preexistente del mock, fuera del alcance de
"arreglar", pero si `profiles` pasa a exigir permiso de admin también hay que
decidirlo explícitamente en el proposal).

`users.service.ts:1-17` importa `users.json` vía `@db/users.json` y arma un
índice `fuse.js` (`keys: ['name','type.slug','categories.slug','status']` —
nótese que ninguna de esas keys aplica a un usuario; es codigo copiado del
servicio de productos, otro indicio de que la búsqueda de texto es un stub
mal adaptado). `create()` devuelve `this.users[0]` sin crear nada
(`:23-25`); `update()` igual (`:80-82`); `remove()` devuelve un string
(`:84-86`); `makeAdmin()` solo hace un `find`, no persiste nada (`:88-90`);
`banUser`/`activeUser` mutan el array en memoria, se pierden al reiniciar
(`:92-106`). `getMyStaffs` y `getAllStaffs` (`:192-238`) **siempre devuelven
`data: []`** salvo que `text` venga con contenido — no hay ninguna lógica de
filtrado por staff en el mock, ni siquiera fake: es literalmente lo que US-5
declaró imposible.

### 2. Import huérfano detectado (CA-6) — `getUsersNotify`

`UsersService.getUsersNotify` (`users.service.ts:71-74`) hace
`this.users.slice(0, limit)` y **no es uno de los 7 grupos de la US**. Lo
consume `StoreNoticesController.getAllUsers`
(`apps/api/rest/src/store-notices/store-notices.controller.ts:40-43`, ruta
`GET /store-notices/getUsersToNotify`), y `StoreNoticesModule` instancia su
propio `UsersService` como provider (`store-notices.module.ts:8`, NO importa
`UsersModule`). Si `UsersService` deja de mantener `this.users` en memoria
(al migrar a `@safari/db`), este método se rompe salvo que la US decida
mantenerlo con una lectura mínima a `listUsers()` sin permiso ni paginación
Laravel (es un stub de notificación, no uno de los 7 grupos con contrato
propio). **Se debe declarar en el proposal/reporte cuál de las dos rutas se
toma**: (a) reimplementar `getUsersNotify` con `listUsers()` recortado, o (b)
dejarlo devolviendo `[]`/lista fija documentando la regresión aceptada. No
tocar `StoreNoticesController`/`Module` en sí — están fuera del scope de
archivos de la US.

`payment-method.service.ts:150-157` tiene un comentario que **referencia**
`users.json`/`users[0]` como contexto histórico, pero ya NO importa
`UsersService` — usa `this.authService.me(3)` (resuelto en US-22). No es un
import huérfano real, solo un comentario desactualizado; no requiere cambios
de esta US.

### 3. Lo que US-21 ya entregó en `packages/db/src/repositories/users.repository.ts`

Funciones existentes (confirmadas leyendo el archivo completo):

- `findUserCredentialsByEmail(email)` — `$queryRaw` con `lower(email)`,
  única función que devuelve `passwordHash` (`:96-116`).
- `findUserById(id): UserRecord | null` (`:122-125`).
- `findUserWithRelations(id): UserWithRelations | null` — perfil, permisos
  (vía `permission.include`) y **tiendas de las que el usuario es dueño**
  (`shops: true` en `USER_RELATIONS`, `:133-163`). Esto es exactamente el
  shape que CA-3 pide para `GET /api/users/:id`.
- `listUsers({page, limit, text, permissionName})` → `{items, total}`
  (**no** el envoltorio Laravel — eso es responsabilidad del servicio de
  Nest con `buildPaginator`, `:186-215`). Filtra por `permissionName` (pivote
  `permission_user`) y busca `text` en `name`/`email` con `contains`
  insensitive. Ya cubre `admin/list`, `vendors/list`, `customers/list` y
  (parcialmente, ver §6) `all-staffs`.
- Escrituras: `createUser` (`:224-256`), `updateUserPasswordHash`
  (`:262-278`), `setUserActive` (`:284-297`) — exactamente 3, como documenta
  la cabecera del archivo (`:9-11`, "Escrituras (CA-4) — exactamente tres").

**Falta explícitamente para US-25** (no existe ninguna función así hoy, ni en
`users.repository.ts` ni en `packages/db/index.ts:93-108`, que es el barrel
completo del paquete):

- Una función de **concesión de permiso** (`grantPermission`/equivalente)
  para `make-admin`. La cabecera del archivo lo anticipa por su nombre:
  *"exactamente tres; `grantPermission` es de US-25"* (`:9-11`) — confirma
  que es un gap conocido, no un olvido.
- Ninguna lista "por rol" dedicada — hoy todo pasa por `listUsers` con
  `permissionName`, lo cual ya alcanza para `admin/list`/`vendors/list`/
  `customers/list`/`all-staffs`.
- Ninguna forma de scoping "staff de MI tienda" (ver §6, `my-staffs`).
- Ningún guard de auto-bloqueo ni de "último super_admin" (ver §7).

### 4. `buildPaginator` (`packages/db/src/pagination.ts:37-65`)

```ts
export function buildPaginator<T>(input: BuildPaginatorInput<T>): Paginator<T>
// input: { data: T[]; total: number; page: number; limit: number; baseUrl?: string }
// output: { data, total, current_page, count, last_page, firstItem, lastItem,
//           per_page, first_page_url, last_page_url, next_page_url, prev_page_url }
```

Reproduce **a propósito** la rareza del mock: `prev_page_url` apunta a la
página ACTUAL, no a la anterior (comentario `:5-7`). Si no se pasa `baseUrl`,
las `*_page_url` son `null` (única divergencia declarada respecto al mock,
que sí arma URLs). Ya usado por otras US del Épico 1 — US-25 debe consumirlo
tal cual, no reescribirlo (instrucción explícita de la US, `:144-145`).

### 5. `@Permissions()` / guards de US-23

- Decorador: `apps/api/rest/src/auth/decorators/permissions.decorator.ts`.
  `Permissions(...permissions: string[])` hace `SetMetadata('permissions',
  permissions)` (`:15-16`); semántica **any-of**. Constantes reutilizables:
  `ADMIN_ONLY = ['super_admin']`, `ADMIN_AND_OWNER = ['super_admin',
  'store_owner']`, `ADMIN_OWNER_AND_STAFF = ['super_admin', 'store_owner',
  'staff']` (`:19-22`). Es **capaz tanto de clase como de método** — el
  `Reflector.getAllAndOverride` de `PermissionsGuard` mira el handler primero
  y la clase después (`permissions.guard.ts:32-35`).
- Guard de permisos: `apps/api/rest/src/auth/guards/permissions.guard.ts`.
  Sin `@Permissions()`, un token válido basta (`:36`). Si hay requisito y no
  hay `request.user`, **401** (nunca 403, regla anti-enumeración, `:39-45`).
  Si hay usuario pero ningún permiso coincide, **403**
  (`INSUFFICIENT_PERMISSIONS_MESSAGE`, `:52-53`).
- Guard JWT global: `apps/api/rest/src/auth/guards/jwt-auth.guard.ts`. Deny
  by default; `@Public()` (`public.decorator.ts`) exime. Ambos guards están
  registrados como `APP_GUARD` (según el propio comentario de
  `jwt-auth.guard.ts:26-28`, activados en la Fase 3 de US-23).
- **Precedente copiable ya usado dentro del propio módulo de usuarios**:
  `users.controller.ts:17-20` (`@Permissions(...ADMIN_ONLY)` a nivel de
  clase) y `store-notices.controller.ts:17-22`
  (`@Permissions(...ADMIN_AND_OWNER)`). US-25 solo necesita replicar
  `@Permissions(...ADMIN_ONLY)` en `ProfilesController` para cerrar CA-5 al
  100%.
- Identidad del actor: `@CurrentUser()` (`current-user.decorator.ts:63-79`)
  devuelve `{sub, email, permissions, iat, exp}` del payload JWT — es lo que
  `make-admin` y el guard de auto-bloqueo (si se implementa) usarían para
  saber "quién soy" y "puedo actuar sobre mí mismo".

### 6. Esquema de identidad (`db/schema.sql:105-236`, `prisma/schema.prisma:233-289`)

- `users(id, name, email, password_hash, is_active, email_verified_at,
  created_at, updated_at)` — índice único `lower(email)` (`schema.sql:132`).
- `profiles(user_id PK/FK, avatar, bio, socials, contact, notifications, …)`
  — 1:1, PK es `user_id`, no un id propio (`:142-151`).
- `permissions(id, name UNIQUE, guard_name, …)` — **4 filas de catálogo**:
  `super_admin`(1), `customer`(2), `store_owner`(3), `staff`(4). `staff`
  existe pero **sin asignar** hasta esta US (`schema.sql:159-161`, confirmado
  también en `db/README.md:65`).
- `permission_user(user_id, permission_id)` — pivote puro, PK compuesta.
- `shops.owner_id bigint NOT NULL DEFAULT 1 REFERENCES users(id) ON DELETE
  RESTRICT` (`schema.sql:236`) — cada tienda tiene UN dueño, sin tabla de
  "staff asignado a una tienda".

**Seed real** (`db/seed.sql:50-89`), verificado línea por línea:

| user_id | email | permisos asignados |
|---|---|---|
| 1 | store_owner@demo.com | `customer`(2), `store_owner`(3) |
| 2 | customer@demo.com | `customer`(2) |
| 3 | admin@demo.com (nombre real: "Jhon Doe") | `super_admin`(1), `customer`(2), `store_owner`(3) |

Ningún usuario tiene el permiso `staff`(4).

**Discrepancia verificada entre la US y el seed real** (la US dice, en
`25-endpoints-usuarios-postgres.md:34-35`, que "`admin/list` devolverá 1,
`customers/list` 1, `vendors/list` 1"). Contando `permission_user` real:

- `admin/list` (`permissionName='super_admin'`) → **1** (solo user 3). ✅ coincide.
- `vendors/list` (`permissionName='store_owner'`) → **2** (users 1 y 3, el
  admin también tiene `store_owner`). ❌ la US dice 1.
- `customers/list` (`permissionName='customer'`) → **3** (los tres usuarios
  tienen `customer`). ❌ la US dice 1.
- `my-staffs`/`all-staffs` (`permissionName='staff'`) → **0**, no 1 (nadie
  tiene `staff` asignado).

Esto es exactamente el tipo de divergencia que la regla del repo ("el código
gana sobre la memoria") pide señalar en vez de heredar. **No es un bug de
implementación posible de US-25** — es un hecho de los datos sembrados en
US-20/US-21, anteriores a esta US. El reporte final de US-25 debe citar los
números reales (1/2/3/0/0), no los de la US, y aclarar por escrito que no es
regresión.

También confirma `db/README.md` que `findUserWithRelations(1)` trae **12
tiendas** (todas las que existen: 9 de `shops.json` + 3 reconstruidas de
productos, todas con `owner_id=1`) — verificado también por el test de
integración (`users.integration.test.ts:81-90`, "el usuario 1 trae perfil,
sus 2 permisos y las 12 tiendas de las que es dueño").

### 7. Traducción de casing (D-3) — precedente en `settings.service.ts` y `auth.service.ts`

`settings.service.ts:20-36`: mapeo campo a campo, manual, sin librería:
`row.createdAt → created_at`, etc. Patrón mínimo, repetido en cada servicio
migrado — no hay una utilidad de "snake-case-ify" genérica en el repo (es una
decisión de diseño explícita del Épico 1, no una omisión).

`auth.service.ts` es el precedente MÁS relevante porque ya resuelve
`UserWithRelations → shape público` para `/me` (US-22):

- `toProfileDto(p: ProfileRecord)` (`:81-93`) — sintetiza `id` y
  `customer_id` = `p.userId` (la tabla no tiene `id` propio).
- `toPermissionDto(p: PermissionRecord, userId: number)` (`:101-114`) —
  sintetiza el objeto `pivot` completo (`model_id`, `permission_id`,
  `model_type` fijo), porque `PermissionRecord` no modela la fila pivote.
- `toMeDto(record: UserWithRelations): User` (`:123-141`) — arma las 15
  claves de `/me`, incluidas `wallet: null`, `last_order: null`, `address:
  []` (D-13 del épico, sin tabla). `shops: record.shops.map(toShopDto)`
  reutiliza `toShopDto` de `shops.service.ts` (import cruzado,
  `auth.service.ts:48`).

### 8. `GET /api/me` y su relación con `GET /api/users/:id` — la oportunidad de reuso más grande

`findUserWithRelations(id)` (repositorio) es la MISMA función que ya
consume `AuthService.me()` (`auth.service.ts:521-526`) y `otpLogin`
(`:423-425`). El shape que produce (`UserWithRelations`: `UserRecord` +
`profile` + `permissions[]` + `shops[]`) es funcionalmente idéntico a lo que
CA-3 pide para `GET /api/users/:id` ("el usuario con su perfil, permisos y
tiendas"). La única diferencia visible es que `/me` añade tres campos
sintéticos sin tabla (`wallet`, `last_order`, `address`). **Verificado
directamente contra el JSON del mock**
(`apps/api/rest/src/db/pickbazar/users.json`, registro id 3, vía
`node -e`): las claves reales del objeto usuario son `id, name, email,
email_verified_at, created_at, updated_at, is_active, shop_id,
email_verified, profile, permissions, wallet, shops, last_order, address`
(`managed_shop` NO está presente, consistente con el comentario V-11 de
`auth.service.ts:121`). `UsersService.findOne(id)` (`users.service.ts:76-78`)
devuelve exactamente ese objeto sin transformación (`this.users.find(...)`,
y `this.users` es `plainToClass(User, usersJson)`, `users.service.ts:11`) —
es decir, **el `GET /api/users/:id` del mock hoy publica el MISMO shape de
15 claves que `/me`**, `wallet`/`shops`/`last_order`/`address` incluidos.
Esto confirma sin ambigüedad que `GET /api/users/:id` debe reutilizar
literalmente `toMeDto`/`toProfileDto`/`toPermissionDto` (extraídos a un
archivo neutral): no hay un shape "recortado" que preservar, el contrato
exige las mismas 15 claves, con `wallet`/`last_order`/`address` en
`null`/`[]` igual que `/me` desde US-22. Esto reduce LOC y riesgo de
divergencia de contrato de un solo golpe.

### 9. Test de integración precedente (`packages/db/src/repositories/users.integration.test.ts`)

Existe y corre bajo `just db-check` (vitest). Patrón:

- Dominio centinela `@users-integration.test` (`TEST_DOMAIN`, línea 31) —
  las escrituras de prueba NUNCA tocan los 3 usuarios sembrados; el casing
  mezclado de las pruebas va en la parte LOCAL del email, nunca en el
  dominio (`:11-14`, porque `endsWith` genera `LIKE` case-sensitive).
- `beforeAll`/`afterAll` limpian por `email: {endsWith: TEST_DOMAIN}`
  (`:33-40`).
- Cobertura actual: `findUserCredentialsByEmail` (casing, null,
  JSON-safety), `findUserById` (no expone hash), `findUserWithRelations`
  (relaciones + no-fuga de hash en anidados vía `JSON.stringify` sin `$2`),
  `listUsers` (filtro por permiso, texto, sin filtro), y las 3 escrituras.
  US-25 debe añadir aquí: cobertura de `grantPermission`/`make-admin`, del
  filtro de staff (0 resultados, dato real) y de cualquier guard de
  auto-bloqueo que se decida implementar.

## Affected Areas

- `apps/api/rest/src/users/users.service.ts` — reescritura completa: quitar
  `fuse.js`/`users.json`, migrar los métodos de los 7 grupos a `@safari/db`.
- `apps/api/rest/src/users/users.controller.ts` — anotar `ProfilesController`
  con `@Permissions(...ADMIN_ONLY)` (único grupo sin decorador hoy).
- `packages/db/src/repositories/users.repository.ts` — añadir
  `grantPermission` (o nombre equivalente) para `make-admin`; decidir la
  forma de `my-staffs` (ver Approaches).
- `packages/db/index.ts` — exportar la(s) función(es) nueva(s) del
  repositorio.
- `packages/db/src/repositories/users.integration.test.ts` — cobertura de lo
  anterior.
- `apps/api/rest/src/store-notices/store-notices.controller.ts` (SOLO
  lectura/decisión, no edición forzosa) — `getUsersNotify` es el import
  huérfano de CA-6; requiere una decisión explícita, no necesariamente una
  edición de ese archivo.
- NO se toca: `apps/api/rest/src/users/dto/*` (los DTOs actuales ya declaran
  los campos que necesita la migración: `CreateUserDto`, `UpdateUserDto`,
  `GetUsersDto`, `CreateProfileDto`, `UpdateProfileDto`, `AddStaffDto` — este
  último parece no estar referenciado por ningún controller actual, verificar
  antes de tocarlo pero probablemente queda muerto y fuera de esta US).

## Approaches

1. **Listas por rol vía `listUsers({ permissionName })` genérico (reusar
   US-21 tal cual)** — `admin/list`, `vendors/list`, `customers/list` y
   `all-staffs` llaman todos a la misma función del repositorio con distinto
   `permissionName`, y el servicio de Nest arma el envoltorio con
   `buildPaginator`.
   - Pros: cero código nuevo en el repositorio para 4 de los 5 listados;
     consistente con el patrón ya usado por products/shops/categories.
   - Cons: ninguno relevante — es el camino que la propia US-21 dejó
     preparado.
   - Effort: Low.

2. **`my-staffs` con scoping real por tienda** — requeriría una tabla
   `shop_staff` (o similar) que hoy **no existe** en `db/schema.sql`. La
   única relación tienda↔usuario es `shops.owner_id` (un dueño, no una lista
   de staff). Implementar esto exigiría DDL nuevo, fuera del scope de esta US
   (que no lista cambios de esquema entre sus archivos a tocar) y
   probablemente fuera del scope del épico completo (el DDL de identidad ya
   se cerró en US-20, Decisión 2 del épico: "un DDL, un reset").
   - Pros: semántica correcta ("staff de MI tienda" de verdad).
   - Cons: requiere schema change no autorizado por esta US; bloquea la
     ejecución hasta una decisión de producto.
   - Effort: High (y probablemente fuera de alcance).

3. **`my-staffs` como alias declarado de `all-staffs` (mismo filtro por
   `permissionName='staff'`, ignorando "de mi tienda")** — usa la MISMA
   función `listUsers({permissionName:'staff'})` para ambos endpoints, y se
   documenta explícitamente en el reporte que el scoping por tienda NO es
   expresable con el esquema actual (mismo patrón que la US ya usa para
   permitir declarar el guard de auto-bloqueo como no implementado).
   - Pros: cero riesgo, cero DDL, ambos endpoints devuelven datos reales (hoy
     0, correcto) en vez de un mock congelado en `[]`; consistente con CA-2
     que solo exige "filtran por el permiso correspondiente".
   - Cons: `my-staffs` y `all-staffs` quedan semánticamente idénticos —
     divergencia declarada, no oculta.
   - Effort: Low.

   **Recomendado: combinar 1 + 3.** Es la única combinación que cierra CA-2
   sin tocar el DDL y sin inventar alcance.

4. **Reusar `toMeDto`/`toProfileDto`/`toPermissionDto` de `auth.service.ts`
   para `GET /api/users/:id`** (extraerlos a un módulo compartido, p. ej.
   `src/users/user-detail.mapper.ts`, o importarlos directo de
   `auth.service.ts` si el acoplamiento cross-módulo se acepta) vs. escribir
   un segundo mapper en `users.service.ts`.
   - Pros: una sola fuente de verdad para "cómo se ve un usuario completo
     desde la API"; evita que las dos rutas (`/me` y `/users/:id`) diverjan
     con el tiempo; menos LOC (~40 líneas menos).
   - Cons: acoplamiento entre el módulo `auth` y el módulo `users` si se
     importa directo (hoy `auth.service.ts` ya importa DESDE `users`: `User`
     entity y, indirectamente via `shops.service`; el acoplamiento inverso es
     nuevo). Extraer a un tercer archivo compartido evita el acoplamiento
     mutuo a cambio de un archivo nuevo.
   - Effort: Low-Medium (depende de si se extrae o se importa directo).

   **Recomendado: extraer los 3 mappers a un archivo neutral** (ninguno de
   los dos módulos `auth`/`users` es dueño natural del otro) e importarlo
   desde ambos servicios. **Confirmado (§8, verificación contra
   `users.json` real): el reuso debe ser LITERAL, no un subconjunto** — el
   mock de `GET /api/users/:id` ya publica las mismas 15 claves que `/me`,
   `wallet`/`shops`/`last_order`/`address` incluidos.

5. **`make-admin`** — dos variantes:
   - 5a. **Repositorio agrega `grantPermission(userId, permissionName)`**
     genérica (connect idempotente sobre `permission_user`), y el servicio de
     Nest la llama con `'super_admin'` fijo. Reusa el patrón `connect` que ya
     usa `createUser` (`users.repository.ts:244-247`).
   - 5b. Función específica `promoteToAdmin(userId)` en el repositorio, sin
     parámetro de nombre de permiso.
   - Pros de 5a: reutilizable si en el futuro se necesita conceder otro
     permiso; sigue el patrón `connect` ya usado.
   - Cons de 5a: superficie ligeramente mayor de lo estrictamente necesario
     para "make-admin".
   - **Recomendado: 5a**, pero el SERVICIO de Nest (no el repositorio) debe
     ser quien fije el string `'super_admin'` y quien valide que el actor
     (`@CurrentUser()`) ya tiene `super_admin` — el repositorio no debe saber
     de reglas de autorización (ya las aplica `@Permissions(...ADMIN_ONLY)` a
     nivel de controlador, y D-5 del épico ya documenta que el guard NUNCA
     consulta la base).
   - Effort: Low.

6. **Guardas de auto-bloqueo ("no bloquearme a mí mismo", "no bloquear al
   último `super_admin`")** — la US permite explícitamente declarar esto NO
   implementado. Dos ubicaciones posibles si se decide implementar:
   - 6a. **En el repositorio** (`setUserActive` rechaza si `id` es el único
     `super_admin` activo restante) — requiere una consulta adicional
     (`count` de usuarios activos con `super_admin`) dentro de la misma
     función, acoplando una regla de negocio a la capa de datos (que hoy es
     puramente CRUD + queries, sin reglas de dominio — ver cabecera de
     `users.repository.ts`, que documenta el paquete como "funciones planas +
     records", sin lógica condicional de negocio salvo D-2/hash).
   - 6b. **En el servicio de Nest** (`UsersService.banUser` compara
     `@CurrentUser().sub` contra el `id` recibido para el caso "a mí mismo";
     para "último super_admin" necesita `listUsers({permissionName:
     'super_admin'})` y comparar `total` antes de desactivar). Es coherente
     con D-1 del épico ("los servicios de Nest consumen los repositorios; la
     API no importa Prisma directo") y con el patrón ya usado en
     `auth.service.ts` (reglas de negocio en el servicio, no en el
     repositorio).
   - Pros de 6b: no contamina el repositorio con reglas de aplicación; es
     coherente con dónde vive el resto de la lógica de negocio del épico
     (`auth.service.ts`, no `*.repository.ts`).
   - Cons de 6b: dos llamadas extra a la base en el path de `block-user`
     (`findUserById(id)` para saber si el target es `super_admin`, y
     `listUsers({permissionName:'super_admin'})` para contar cuántos quedan)
     — coste aceptable dado el volumen de datos (3 usuarios).
   - Cons de NO implementar: el riesgo textual de la propia US se concreta
     (un admin puede dejarse fuera del panel sin `just db-reset`); pero es una
     opción EXPLÍCITAMENTE autorizada por la US si se declara.
   - **Recomendado: implementar 6b** (costo bajo, 3 usuarios sembrados, y el
     riesgo de NO implementarlo es alto para un repo didáctico donde el
     "reset de emergencia" es justamente lo que se quiere evitar en una demo
     en vivo). Si se decide no implementar por presión de tiempo/LOC, debe
     quedar declarado en el proposal con la referencia a esta sección.

## Recommendation

Combinar: Approach 1 (listUsers genérico para admin/vendors/customers/
all-staffs) + Approach 3 (my-staffs como alias declarado de all-staffs,
documentando la limitación de esquema) + Approach 4 (extraer los mappers de
`auth.service.ts` a un archivo neutral y reusarlos para `GET /api/users/:id`)
+ Approach 5a (`grantPermission` genérico en el repositorio, regla de
autorización en el servicio) + Approach 6b (guardas de auto-bloqueo en el
servicio de Nest, no en el repositorio). Es la combinación de menor LOC y
menor riesgo que cierra los 6 CAs sin tocar DDL, sin inventar tablas, y sin
duplicar el mapper de `/me`.

Antes de escribir el proposal, verificar con un comando de solo lectura
(`grep -n "wallet\|managed_shop\|address" apps/api/rest/src/users/entities/user.entity.ts`
ya hecho arriba — la entidad SÍ declara esos campos) si el `GET
/api/users/:id` del mock efectivamente los serializaba en runtime (no solo en
el tipo TS) antes de decidir si el reuso de `toMeDto` debe ser literal o
recortado.

## Risks

- **CRÍTICO — divergencia de datos entre la US y el seed real** (§6): la US
  afirma que `admin/list`, `vendors/list` y `customers/list` devolverán 1 cada
  uno; el seed real da 1/2/3. Si el proposal o el DoD se redactan citando los
  números de la US sin verificar, el reporte de cierre quedará objetivamente
  falso apenas se corra un `curl`. Mitigación: citar los números reales
  (1/2/3/0/0) en el proposal y en el DoD, con la aclaración de que no es
  regresión de esta US sino un hecho de US-20/US-21.
- **Alto — `my-staffs` no es expresable con el esquema actual** (§6,
  Approach 2 descartado): si el proposal intenta implementar scoping real
  por tienda, se sale del scope de esta US (exige DDL) y probablemente del
  épico. Mitigación: declarar explícitamente el alias con `all-staffs`
  (Approach 3) en el proposal, no descubrirlo a mitad de `sdd-apply`.
- **Medio — import huérfano `getUsersNotify`** (§2): `store-notices` depende
  de un método de `UsersService` que no es uno de los 7 grupos. Si se migra
  `UsersService` sin decidir qué pasa con este método, `just build-api`
  puede compilar pero el endpoint `GET /store-notices/getUsersToNotify`
  queda silenciosamente roto (sin cobertura de test conocida). Mitigación:
  decisión explícita en el proposal (reimplementar con `listUsers()` recortado
  o declarar la regresión).
- **Medio — `ProfilesController` sin `@Permissions()`**: si el proposal solo
  migra los datos y no cierra este hueco, CA-5 ("todo el módulo exige permiso
  de administración") queda incompleto aunque los otros 6 controladores ya
  estén protegidos desde US-23.
- **Bajo — `make-admin` como escalada de privilegios**: el controlador ya
  exige `@Permissions(...ADMIN_ONLY)` a nivel de clase (cubre el endpoint),
  pero el servicio actual (`makeAdmin`) no valida nada ni persiste — la
  migración real debe además impedir auto-promoción de alguien que YA no
  tiene `super_admin` a otro sin `super_admin` (la nota de la US pide "no debe
  permitir que un usuario se promocione a sí mismo sin serlo ya" — interpretar
  esto: el actor debe YA tener `super_admin`, lo cual el guard ya garantiza al
  nivel de ruta; no hay escalada adicional posible salvo que el guard fallara).
- **Bajo — `AddStaffDto` está muerto**: verificado con
  `grep -rn "AddStaffDto" apps/api/rest/src` — el único resultado es su
  propia declaración (`add-staff.dto.ts:1`). Ningún controlador lo importa
  hoy. No forma parte de los 7 grupos de la US; no se toca.

## Ready for Proposal

**Sí.** El terreno está mapeado con evidencia `file:line` para las 9
preguntas del encargo, incluidas las dos que quedaban abiertas a mitad de
exploración (shape real de `GET /api/users/:id` en el mock, y vida de
`AddStaffDto`), ambas cerradas con verificación directa. Puntos que el
proposal DEBE resolver explícitamente (no delegar a `sdd-apply` sin decisión
previa): (a) alias `my-staffs` = `all-staffs`, con la limitación de esquema
declarada; (b) destino de `getUsersNotify`/`store-notices`; (c) si se
implementan las guardas de auto-bloqueo (recomendado: sí, costo bajo); (d)
confirmado que `GET /api/users/:id` debe reutilizar literalmente
`toMeDto`/`toProfileDto`/`toPermissionDto`, mismas 15 claves que `/me`.
