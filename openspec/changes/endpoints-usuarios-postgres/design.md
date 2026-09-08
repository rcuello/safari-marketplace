# Design: Endpoints de usuarios y staff desde Postgres

> US-25, cierre del Épico 19. Entradas: `proposal.md` (A1–A13, vinculantes) y
> `exploration.md`. Toda cifra y ruta se verificó abriendo el archivo citado o con un
> comando de solo lectura. **No se editó código de producción.** Las correcciones de
> hecho respecto al encargo van marcadas **[C-n]**.

## Technical Approach

`UsersService` deja de mantener `this.users` en memoria (`users.service.ts:11,21`) y
pasa a llamar funciones planas de `@safari/db` (D-1). La traducción se concentra en
**un** mapper compartido (`toUserDto`/`toProfileDto`/`toPermissionDto`, extraídos de
`auth.service.ts:81-141`) y en **un** helper privado de listado que arma el envoltorio
Laravel con `buildPaginator` (`packages/db/src/pagination.ts:37-65`). El repositorio
suma dos funciones y ninguna regla de dominio; las guardas de auto-bloqueo y el string
`'super_admin'` viven en el servicio (A7/A8). Sin DDL: `db/schema.sql:494-498` ya previó
estas escrituras (el comentario del trigger `users_updated_at` cita "US-25
block-user/unblock-user").

Cortes de entrega (cada slice deja el repo compilando):

| Slice | Alcance | Gate propio |
|---|---|---|
| **PR#1** | `packages/db`: `_usersWhere` + `listUsersWithRelations` + `grantPermission` + `index.ts` + tests de integración | `just db-check` (typecheck + vitest) |
| **PR#2** | Refactor puro: `users/user-dto.mapper.ts` nuevo, `auth.service.ts` repuntado; cero cambio observable | `user-dto.mapper.spec.ts` nuevo (portante) + diff byte a byte de `curl /api/me` + `npx jest` + `just build-api` |
| **PR#3** | Feature: `users.service.ts` + `users.controller.ts` (partible en 3a lecturas / 3b escrituras) | `users.service.spec.ts` nuevo (portante) + `npx jest` + `just build-api` + los `curl` de la DoD |

**[C-1] `apps/api/rest` SÍ tiene suite jest y está verde.** Contra el "zero `*.spec.ts`"
del encargo: hay dos (`src/products/products.service.spec.ts`,
`src/shops/shops.service.spec.ts`) y `cd apps/api/rest && npx jest` devolvió
`2 passed, 33 tests` (ejecutado en esta sesión); `package.json` ya trae
`moduleNameMapper` (`@db/*`, `src/*`) y `transformIgnorePatterns` con `packages/db/dist`.
PR#2 y PR#3 pueden traer **tests nuevos** en un arnés que ya corre. Matiz: esas suites
**no importan `auth` ni `users`**, así que un `npx jest` verde sobre estas slices solo
prueba que no se rompió la compilación — el gate portante son los specs nuevos (ver
Testing). Ningún recipe de `just` lo envuelve (US-10, Épico 9).

## Architecture Decisions

### D-A. Mapper compartido: ruta, exports y aciclicidad

**Choice**: `apps/api/rest/src/users/user-dto.mapper.ts` con tres exports (firmas en
*Interfaces*; `toUserDto` es el renombre de `toMeDto`, `auth.service.ts:123`). Importa
`toShopDto` de `src/shops/shops.service` (`:45`) y el tipo `User` de
`src/users/entities/user.entity`.

| Opción | Tradeoff | Decisión |
|---|---|---|
| `src/users/user-dto.mapper.ts` (A3) | `auth` importa de `users/`… pero ya lo hace hoy (`auth.service.ts:47`) | **Elegida** |
| `src/common/mappers/user-dto.mapper.ts` | Neutral de nombre; crea carpeta para un archivo | Rechazada (no introducir estructura hasta la 2ª/3ª ocurrencia) |
| Importar directo de `auth.service.ts` | Acoplamiento mutuo `users→auth.service` | Rechazada (exploración §Approach 4) |

**Aciclicidad (`grep` de imports)**: el mapper no importa `auth.service`
ni `users.service`, y `shops.service.ts:1-25` no importa `users` ni `auth`. Cadena
resultante: `auth.service.ts` y `users.service.ts` → `user-dto.mapper.ts` →
`shops.service.ts`, sin retorno. El ciclo `auth↔users` que ya existe es **de módulo
Nest** (`users.controller.ts:17` importa el decorador de `auth/`), no de archivo.

**Efecto colateral aceptado**: `users.service.ts` carga transitivamente `shops.json`
vía el `plainToClass` de ámbito de módulo de `shops.service.ts:30` — ya ocurre en el
arranque (ambos módulos están en `app.module.ts`); coste cero adicional.

**Superficie exacta del refactor de PR#2** (`grep`): `toMeDto` tiene **un solo call
site**, `auth.service.ts:525` dentro de `me()` (`:521`); `otpLogin` usa
`findUserWithRelations` (`:424`) pero **no** los mappers. Al mover las tres funciones
quedan huérfanos 4 imports que PR#2 MUST borrar: `toShopDto` (`:48`, pasa al mapper),
`type PermissionRecord` (`:27`), `type ProfileRecord` (`:28`) y `type UserWithRelations`
(`:29`, solo usado en la firma de `toMeDto`, `:123`). `User` (`:47`) **se queda**:
lo usa `me(): Promise<User>`.

### D-B. `buildPaginator` con **triple camino** para `page`/`limit` — CRÍTICO

A5 se adopta, pero implementarla ingenuamente (números a los dos parámetros) **rompe el
contrato en 6 rutas**: `new ValidationPipe()` (`main.ts:9`) no transforma, así que
`?limit=20` llega como string `"20"` y el mock lo emite tal cual en `per_page`
(`paginate.ts:63`). El design de **US-2** revocó `buildPaginator` justamente por esto
(`archive/2026-08-25-migrar-api-products-postgres/design.md:2,20-45`, cita en `:38-39`:
*"tipa `limit: number` y normalizaría `per_page` a `30`: una divergencia de tipo"*). Los
**36 call sites en 24 archivos** que usan `paginate()` emiten hoy `per_page: "20"`.

**Choice**: tres caminos explícitos. El saneo numérico es **vinculante para TODA llamada
al repositorio de este módulo**, no solo para el helper de listados: todo valor de la
query que termine en `skip`/`take`/`where.id` MUST pasar por `Number(x) || <default>`
antes de cruzar a `@safari/db`. Aplica en el helper de listados, en `getUsersNotify`
(`limit`) y en los métodos con `id` (ver D-F).

| Destino | Valor | Por qué |
|---|---|---|
| Todo lo que entra a `@safari/db` (`listUsersWithRelations({page, limit})`, `getUsersNotify`, los `id`) | `Number(page) \|\| 1`, `Number(limit) \|\| 30`, `Number(id)` validado | Prisma lanza con `NaN`/string en `skip`/`take`/`where.id` → 500 (`derived-catalog-api/spec.md:136`, bug real encontrado durante el apply de US-5) |
| `buildPaginator({ page })` | **numérico** | el mock coerce con `+current_page` (`paginate.ts:58`); `buildPaginator` no coerce (`pagination.ts:54`), así que un `page` crudo emitiría `current_page: "2"` |
| `buildPaginator({ limit })` y `baseUrl` | **crudo** (`query.limit` tras `if (!limit) limit = 30`) | reproduce `per_page: "20"` string / `30` número, exactamente como el mock. Compila sin cast: `PaginationArgs.limit` está tipado `number` (`common/dto/pagination-args.dto.ts:4`) aunque en runtime sea string — la misma "mentira" que ya consume `paginate()` |

`baseUrl = \`${APP_URL}${url}\`` con `APP_URL = 'http://localhost:5000/api'`
(`src/common/constants.ts:1`), el literal del mock. Sin él, las 4 `*_page_url` salen
`null` (`pagination.ts:49`).

Equivalencia campo a campo, leída en ambas funciones: mismo **orden** de las 12 claves
(`data` primero) y misma fórmula en `total`, `count` (`data.length` = `results.length`),
`last_page`, `firstItem`, `lastItem`, `per_page` y las 4 URLs — incluida la rareza de
`prev_page_url` apuntando a la página actual (`paginate.ts:70-73` ≡ `pagination.ts:63`).
US-25 es el **primer consumidor** de `buildPaginator` en la API (`grep` → 0 resultados):
la equivalencia es análisis de código, no observación, y por eso PR#3 la vuelve
ejecutable con un test que compara ambas salidas (ver Testing).

**Caso lista vacía** (`my-staffs`/`all-staffs`, `total = 0`, `limit = 30`):
`last_page = 0`, `page` clampado a `0` (`pagination.ts:44`), `firstItem = -30`,
`lastItem = -1`, `first_page_url = …&page=1`, `last_page_url = …&page=0`,
`next/prev = null`. **Idéntico** al mock, misma corrección de rango
(`paginate.ts:16-20,47-48`), `firstItem` negativo incluido.

### D-C. `listUsersWithRelations`: un `include`, no N+1

**Choice**: función nueva junto a `listUsers`, con el `where` extraído a `_usersWhere`
(hoy inline en `users.repository.ts:191-201`) para que las dos listas no divergan. Reutiliza `USER_RELATIONS` (`:139-143`) y
`_toUserWithRelations` (`:161-172`) — un `findMany` + un `count`, cero N+1.
**Alternativa rechazada**: emitir `profile: null` en los ítems de lista; el admin
renderiza `profile?.avatar?.thumbnail` (`apps/admin/rest/src/components/user/user-list.tsx:102`)
y mapea `permissions` a chips (`:113-121`).

Coste: cada ítem embebe las tiendas del dueño (usuario 1 → las 12,
`users.integration.test.ts:86`, `db/seed.sql:97-109`). Paginar relaciones: fuera de
scope.

### D-D. `grantPermission`: idempotente y genérica

**Choice**: `grantPermission(userId, permissionName)` resuelve el permiso por nombre
(`permissions.name` es UNIQUE, `packages/db/prisma/schema.prisma:268`), verifica el
usuario y hace `upsert` sobre el pivote explícito `PermissionUser`
(`@@id([userId, permissionId])`, `packages/db/prisma/schema.prisma:286`) con
`update: {}` — idempotente y sin tocar `created_at` del pivote. Devuelve
`UserWithRelations | null`: lo que muta *es* una relación, así que el valor de retorno
de la escritura solo es autodescriptivo si la incluye. `null` = usuario inexistente,
igual convención que `setUserActive` (`:284-297`).

**Divergencia declarada respecto a A7 (premisa falsa del insumo)**: A7
(`proposal.md:70`) y el delta de `identity-data-layer` piden "el patrón `connect` de
`createUser`, idempotente". Ese patrón **no lo es**:
`permissions: { create: [{ permission: { connect: { name } } }] }`
(`users.repository.ts:240-246`) inserta una fila de pivote en cada llamada y la segunda
choca contra `@@id([userId, permissionId])` → `P2002`. Sirve en `createUser` porque el
usuario acaba de nacer y no puede tener pivotes previos; para un usuario existente hay
que sustituirlo por `upsert`. Se sustituye a propósito y se corrige la premisa en vez de
heredarla.

**Asimetría declarada con `POST /api/users`**, que sí hace una segunda lectura
(`createUser` devuelve `UserRecord`, `:228`, y la respuesta publica las 15 claves): esa
firma ya está embarcada y con consumidor (`auth.service.ts:196`), cambiarla es fuera de
scope; `grantPermission` es nueva y puede nacer con la forma correcta.

**`UnknownPermissionError` sale de la superficie pública**: no tiene requirement de
spec, y añadir superficie sin requirement rompe el contrato SDD. El permiso inexistente
se sigue detectando con un `Error` **no exportado** (ni del repositorio ni del barrel):
inalcanzable por HTTP —el único caller fija `'super_admin'`, sembrado en
`db/seed.sql:70-75`— y `withPrismaErrorTranslation` lo vuelve 500, lo correcto para un
error de programación. PR#1 lo cubre con un test de comportamiento, no de identidad de
clase; si `sdd-spec` lo especifica, exportarlo es una línea en `index.ts`.

Cero `$transaction`, como el resto del paquete (`users.repository.ts:222-223`).
**No verificado en ejecución**: `upsert` con `update: {}` sobre PK compuesta. Si el
adapter lo rechaza, el fallback es `create` + `catch P2002`, misma idempotencia. PR#1
lo resuelve con su test antes de que la API dependa de ello.

### D-E. `UsersService` sigue **sin dependencias de constructor**

`StoreNoticesModule` declara `providers: [StoreNoticesService, UsersService]`
(`store-notices.module.ts:8`) y **no** importa `UsersModule`: Nest instancia un segundo
`UsersService`. Como los repositorios de `@safari/db` son funciones planas importadas
(precedente `auth.service.ts:12-30`, `shops.service.ts:8-17`), la migración **no
necesita inyectar nada** y esa segunda instancia sigue resolviéndose.
**Restricción vinculante**: si `UsersService` recibiera un
`constructor(private readonly …)`, el arranque de Nest falla ("can't resolve
dependencies of UsersService") y hay que añadir `imports: [UsersModule]` en
`store-notices.module.ts` (`exports: [UsersService]` ya existe, `users.module.ts:24`).
Así A10 se cumple sin editar `store-notices/*`: `getUsersNotify` pasa a `async` y Nest
resuelve la promesa que devuelve el handler (`store-notices.controller.ts:40-43`).

### D-F. Guardas y códigos de estado: dónde se lanza cada uno

| Código | Caso | Dónde |
|---|---|---|
| **401** | Sin token (deny-by-default) o `@Permissions()` sin `request.user` (anti-enumeración) | `jwt-auth.guard.ts`; `permissions.guard.ts:39-45` |
| **403** | Token válido sin `super_admin` (any-of) | `permissions.guard.ts:52-53` |
| **404** | `GET/PUT /api/users/:id`, `block-user`, `unblock-user`, `make-admin` con id inexistente (`null` del repositorio) **y también con id no numérico** (ver abajo) | `UsersService`, `NotFoundException` |
| **409** | `@CurrentUser().sub === id` en `block-user`; objetivo con `super_admin` y `listUsers({permissionName:'super_admin'}).total <= 1`; `DuplicateEmailError` en `POST /users` | `UsersService`, `ConflictException` (precedente `auth.service.ts:204`) |
| **503 / 500** | Error de conexión / resto (`isPrismaConnectionError` + `getUserFriendlyMessage`) | `withPrismaErrorTranslation` privado, calcado de `auth.service.ts:533-542` |

**Id no numérico → 404, no 500** (misma clase de bug que el `limit` de D-B):
`users.controller.ts:36-38` pasa `+id`, así que `/api/users/abc` entrega `NaN` y
`prisma.user.findUnique({ where: { id: NaN } })` (`users.repository.ts:129`) lanza una
validación de Prisma que `withPrismaErrorTranslation` volvería **500**. Guarda
obligatoria en cada método que recibe id (`findOne`, `update`, `banUser`, `activeUser`,
`makeAdmin`): `if (!Number.isInteger(id)) throw new NotFoundException(...)`. Ver V-9.

Caveat de A7: `listUsers` no filtra `isActive` (`:191-201`), así que la regla se lee "el
único usuario **con** el permiso", no "el único activo" — conservadora a propósito.
`unblock-user` no lleva guardas (reactivar nunca deja el panel sin admin) pero **sí**
lee `findUserWithRelations` antes de escribir: necesita las relaciones para el DTO de 15
claves y el 404.

### D-G. `ProfilesController` y el bug documentado

`@Permissions(...ADMIN_ONLY)` de clase (`users.controller.ts:66`) cierra CA-5: las 3
rutas de `profiles` suman a las 117 de `authorization-guards-api` → 120. Los
`console.log` siguen stubs (`:70-78`). **Bug preexistente NO corregido**:
`DELETE /profiles/:id` llama `usersService.remove(id)` (`:80-83`) — promete borrar un
perfil y apunta a un método de usuarios. Inerte (A11: `remove()` sigue devolviendo su
string), pero documentado.

### D-H. `make-admin`: `@Body('user_id')` y el retardo de D-5

`@Param('user_id')` (`users.controller.ts:61`) es siempre `undefined`: la ruta no
declara ese path param y el admin lo manda en el body
(`apps/admin/rest/src/data/client/user.ts:56-58`;
`types/index.ts:442-444`). Se cambia a `@Body('user_id')`: no es cambio de contrato de
red. Ojo, `MakeAdminInput.user_id` es **string**: `makeAdmin` MUST hacer
`Number(user_id)` + la guarda de D-F antes de llamar al repositorio (misma clase de
bug que el `limit` de D-B).

```
Admin           Controller              UsersService            @safari/db            Postgres
  │ POST /api/users/make-admin {user_id:"2"}
  ├──────────────▶ JwtAuthGuard + PermissionsGuard (super_admin del JWT, 0 queries)
  │                    │ makeAdmin(@Body user_id)
  │                    ├──────────────────▶ grantPermission(2,'super_admin')
  │                    │                      ├── permission.findUnique({name})──▶ SELECT
  │                    │                      ├── user.findUnique({id})──────────▶ SELECT
  │                    │                      ├── permissionUser.upsert ─────────▶ INSERT … ON CONFLICT
  │                    │                      └── findUserWithRelations(2)───────▶ SELECT + relaciones
  │◀───── 200 toUserDto(record)  (permissions incluye ya super_admin)
  │
  │ GET /api/users con el token VIEJO del usuario 2 ──▶ 403
  │ (el permiso solo entra al JWT en el PRÓXIMO login — permissions.guard.ts:18-26)
```

El guard **no** consulta la base por diseño (D-5); no se añade lookup para disimular el
retardo. `make-admin` tampoco modifica `users.updated_at`: `permission_user` no tiene
columna `updated_at` ni trigger y la fila de `users` no se toca
(`db/schema.sql:173-178,487-500`).

## Data Flow

```
users.controller.ts ──▶ UsersService ──▶ @safari/db (funciones planas, camelCase)
  @Permissions          │  ├─ _listByPermission(query, url, permissionName?)
  @CurrentUser          │  │     ├─ listUsersWithRelations   ← _usersWhere + USER_RELATIONS
  @Body/@Param          │  │     ├─ items.map(toUserDto)     ← user-dto.mapper.ts (D-3)
                        │  │     └─ buildPaginator(baseUrl)  ← packages/db/src/pagination.ts
                        │  ├─ findUserWithRelations / setUserActive / grantPermission / createUser
                        │  └─ withPrismaErrorTranslation (503/500)
                        ▼
              user-dto.mapper.ts ──▶ toShopDto (shops.service.ts:45)
```

La traducción camelCase→snake_case ocurre **solo** en el mapper (D-3); el repositorio no
ve snake_case ni reglas de autorización y el servicio no ve Prisma (D-1).

## Mapeo por endpoint

`limit` = crudo tras `if (!limit) limit = 30`; `baseUrl` = `APP_URL + url`.

| Grupo | Repositorio | Mapper | `url` (mock, preservada) | `total` real |
|---|---|---|---|---|
| `GET /api/users` | `listUsersWithRelations({page,limit,text})` | `toUserDto` | `/users?limit=${limit}` (`users.service.ts:63`) | **3** |
| `GET /api/admin/list` | `+ permissionName:'super_admin'` | idem | `/admin/list?limit=${limit}` (`:128`) | **1** |
| `GET /api/vendors/list` | `+ 'store_owner'` | idem | `/vendors/list?limit=${limit}` (`:156`) | **2** |
| `GET /api/customers/list` | `+ 'customer'` | idem | `/customers/list?limit=${limit}` (`:184`) | **3** |
| `GET /api/my-staffs` | `+ 'staff'` (alias A2) | idem | `/my-staffs/list?limit=${limit}` (`:208`, `/list` que la ruta no tiene — rareza preservada) | **0** |
| `GET /api/all-staffs` | `+ 'staff'` | idem | `/all-staffs/list?limit=${limit}` (`:232`) | **0** |
| `GET /api/users/:id` | `findUserWithRelations(id)` | `toUserDto` | — (sin envoltorio) | 404 si no existe |
| `POST /api/users` | `createUser({…, permissionNames:['customer']})`, hash bcrypt coste 10 | `toUserDto` (2ª lectura) | — | 409 duplicado |
| `POST /api/users/block-user` | guardas + `findUserWithRelations(id)` → `setUserActive(id,false)` | `toUserDto({...record, ...updated})` | — | 409/404 |
| `POST /api/users/unblock-user` | `findUserWithRelations(id)` (404 + relaciones; **sin** guardas) → `setUserActive(id,true)` | `toUserDto({...record, ...updated})` | — | 404 |
| `POST /api/users/make-admin` | `grantPermission(id,'super_admin')` | `toUserDto` | — | 404 |
| `getUsersNotify` (store-notices) | `listUsersWithRelations({page: 1, limit: Number(limit) \|\| 30})` — **`limit` saneado** (D-B): sin envoltorio no hay triple camino y `?limit=5` crudo llegaría como `take: "5"` → 500 | `items.map(toUserDto)` | — (array plano) | 3 |
| `PUT /:id` / `DELETE /:id` / `profiles/*` | stubs A11 (`PUT` lee y devuelve sin persistir; `remove()` sigue devolviendo su string) | `toUserDto` solo en el `PUT` | — | 404 en el `PUT` |

`block-user`/`unblock-user` usan `{...record, ...updated}`: el trigger
`users_updated_at` (`db/schema.sql:497-498`) bombea `updated_at` y el `RETURNING` de
Prisma trae el valor post-trigger, así que los escalares salen de la escritura y las
relaciones de la lectura previa. `1/2/3/0/0` son hechos del seed
(`db/seed.sql:70-75,82-89`), **no** regresión de US-25; la US afirma 1/1/1.

## Divergencias declaradas (contrato)

| # | Divergencia | Estado |
|---|---|---|
| V-1 | `created_at`/`updated_at`: el seed no las inserta (toman `now()` del último `db-up`) y `Date.toJSON()` da 3 decimales donde Laravel trae 6 | Ya embarcada desde `/api/settings` |
| V-2 | **[C-2] El mock NO emite las mismas claves para los 3 usuarios**: `node -e` sobre `users.json` → user 3 = 15 claves, user 1 = 14 (sin `last_order`), user 2 = 13 (sin `shops` ni `last_order`, y con `address` en otra posición). `toUserDto` normaliza a las **15 claves en un solo orden** | Ya embarcada por `/me` (US-22, `auth.service.ts:123-141`); US-25 la extiende a `/users` y `/users/:id`. Aditiva (`shops: []`, `last_order: null`) |
| V-3 | `shops` sale de la base: usuario 1 → 12 tiendas (mock: 9); usuario 3 → **0** (mock: 9), porque las 12 tienen `owner_id = 1` (`db/seed.sql:97-109`) | Ya embarcada por `/me` |
| V-4 | Orden de filas: mock `[3,2,1]` (orden del JSON) → `orderBy: {id:'asc'}` `[1,2,3]` (`users.repository.ts:206`). `orderBy`/`sortedBy` del DTO se siguen ignorando | Aceptada; ningún CA ordena |
| V-5 | Búsqueda: `fuse` difuso con keys de producto (`users.service.ts:13-17`) → `contains`/`insensitive` sobre `name`/`email`; `search=name:x` se parsea con `parseSearch` y alimenta `text` | Aceptada (criterio de US-5 B-7) |
| V-6 | `?page=abc`: el mock emite `current_page: null` (`+'abc'` → `NaN`); aquí `Number(page) \|\| 1` → `current_page: 1` | Aceptada, precedente `archive/2026-08-26-categorias-arbol-postgres/design.md:467` |
| V-7 | `my-staffs` ≡ `all-staffs` (A2): sin tabla staff↔tienda, la única relación es `shops.owner_id` (`db/schema.sql:236`) | Declarada, no oculta |
| V-8 | `POST /api/users` ignora `address`/`profile`/`permission` del DTO (el enum emite `'Customer'`, que no existe en el catálogo — R-4) y concede `customer` fijo | Declarada (A12) |
| V-9 | Id no numérico (`/api/users/abc`): el mock devolvía `undefined` → 200 con cuerpo vacío (`users.service.ts:77`); ahora **404** (guarda `Number.isInteger`, D-F) | Aceptada: la alternativa es un 500 |
| V-10 | Bordes de `limit` por `Number(limit) \|\| 30` (precedente B-8, `derived-catalog-api/spec.md:136`): `?limit=0` aplica el default donde el mock devolvía `[]` (`slice(0,0)`) —también en `getUsersNotify`—; `?limit=-1` devuelve 1 fila desde el final (`take: -1`) donde el mock devolvía todas menos una. El envoltorio sigue emitiendo `per_page` crudo (`"0"`/`"-1"`), igual que el mock | Aceptada, ya embarcada en US-5; ningún borde produce 5xx |

## Interfaces / Contracts

```ts
// packages/db/src/repositories/users.repository.ts  (PR#1)
function _usersWhere(input: ListUsersInput): Prisma.UserWhereInput; // extraído de :191-201

export async function listUsersWithRelations(
  input: ListUsersInput = {},
): Promise<{ items: UserWithRelations[]; total: number }>;           // misma forma que listUsers

/**
 * Idempotente. `null` si el usuario no existe. Lanza un `Error` NO exportado si el
 * permiso no está en el catálogo (D-D: sin requirement de spec, sin superficie
 * pública; inalcanzable por HTTP porque el único caller fija 'super_admin').
 */
export async function grantPermission(
  userId: number,
  permissionName: string,
): Promise<UserWithRelations | null>;
```

`packages/db/index.ts` — **exactamente 2 exports nuevos** en el bloque de
`users.repository`, en el orden alfabético case-insensitive de biome (`:99-108`):
`grantPermission` tras `findUserWithRelations` y `listUsersWithRelations` tras
`listUsers`. Sin clases de error ni tipos nuevos (`ListUsersInput`/`UserWithRelations`
ya están, `:93-98`). Sin `db-build` (tsup → `dist/`) Nest no ve nada de esto.

```ts
// apps/api/rest/src/users/user-dto.mapper.ts  (PR#2, movidas verbatim)
export function toProfileDto(p: ProfileRecord);                       // ex auth.service.ts:81-93
export function toPermissionDto(p: PermissionRecord, userId: number); // ex :101-114
export function toUserDto(record: UserWithRelations): User;           // ex toMeDto, :123-141
```

## Testing Strategy

| Capa | Qué | Cómo |
|---|---|---|
| Integración (vitest, PR#1) | `grantPermission` (alta, idempotencia, `null` con id inexistente, rechazo con permiso fuera del catálogo), `listUsersWithRelations` (relaciones, filtro, paginación, no-fuga de hash), filtro `staff` = 0 | `users.integration.test.ts`, `just db-check` (requiere `db-up`) |
| Unitaria (jest, PR#2) — **gate portante de la slice** | `toUserDto` emite las 15 claves **en orden** desde un `UserWithRelations` de fixture; `toProfileDto`/`toPermissionDto` sintetizan `id`/`customer_id`/`pivot` | `src/users/user-dto.mapper.spec.ts`, sin base |
| Unitaria (jest, PR#3) | Envoltorio de `getUsers` **igual clave por clave y por tipo** a `{data, ...paginate(...)}` con `limit="20"` (⇒ `per_page: "20"`), `total=0` y clamp de `page`; 404 (id inexistente **y** no numérico) / 409 (auto-bloqueo, último `super_admin`); `getUsersNotify` con `?limit=5` recibe `take: 5`, no `"5"` | `src/users/users.service.spec.ts`, `new UsersService()` + `jest.mock('@safari/db')` con `requireActual` — arnés de `shops.service.spec.ts:21-38` y `:57` |
| Manual | Los 7 grupos con token admin; CA-4 (bloquear → login 401 → desbloquear → 200); CA-5 (sin token 401, `customer` 403, `/profiles` incluido); diff byte a byte de `/api/me` en PR#2; avatar y chips del panel (R-2) | `curl` pegado |

**Invariante vinculante de la suite de integración** (trampa real): dos aserciones
dependen de conteos exactos — `listUsers({permissionName:'super_admin'}).total === 1`
(`users.integration.test.ts:98-104`) y la nueva de `staff === 0`. La limpieza es
`afterAll` (`:33-40`), así que las filas centinela conviven con las lecturas: **ningún
test puede conceder `super_admin` ni `staff` a un usuario centinela**; los de
`grantPermission` usan `'store_owner'`, sin conteo exacto asociado. Resto de
convenciones: dominio `@users-integration.test` (`:31`), jamás tocar los 3 usuarios
sembrados, casing mezclado solo en la parte local del email (`endsWith` → `LIKE`
case-sensitive, `:11-14`) y `>=` en las aserciones sin filtro (`:118-121`).
`permission_user` es `ON DELETE CASCADE` (`db/schema.sql:174-175`): borrar el usuario
centinela limpia sus pivotes.

**`just verify` NO es evidencia de esta US**: `justfile:182-189` solo sondea
`/api/settings`, `/en` y `/en/login` — ninguna ruta de usuarios. Se corre para
comprobar que nada más se rompió, no como gate de los CA.

### D-2: el hash no puede salir

Garantía **estructural**: `UserRecord` no declara `passwordHash`
(`packages/db/src/records.ts:141-150`) y `_toUserRecord` es el choke point que nunca lo
copia (`:270-280`). `listUsersWithRelations` y `grantPermission` **deben** devolver a
través de `_toUserWithRelations` (`users.repository.ts:161-172`), nunca la fila cruda de
Prisma — es la única forma de introducir la fuga. `findUserCredentialsByEmail`
(`:104-121`) sigue siendo la única salida del hash. Verificación con la técnica
existente: `not.toContain('$2')` sobre `JSON.stringify` de los ítems **y** sus
relaciones anidadas (`:72,89,103`), más `Object.keys(...)` sin `passwordHash`.

**La aserción `$2` MUST anclarse a los usuarios sembrados** (hash bcrypt real
`$2y$…`), nunca a un centinela creado con `passwordHash: 'hash-de-prueba'`
(`users.integration.test.ts:130`): sobre ese, la aserción pasa aunque el hash se
estuviera filtrando. Por eso la no-fuga de `listUsersWithRelations` se prueba con
`{permissionName:'super_admin'}` (usuario 3) y con el usuario 1.

## Rollback

Sin DDL: `git checkout packages/db apps/api/rest` + `just db-build` + `just build-api`
devuelve el mock intacto. Parcial: revertir solo `apps/api/rest` deja las 2 funciones
nuevas inertes. **Residuo que git no deshace** — las escrituras reales:

```sql
UPDATE users SET is_active = true;
DELETE FROM permission_user
 WHERE NOT (user_id, permission_id) IN ((3,1),(3,2),(3,3),(2,2),(1,2),(1,3));
DELETE FROM users WHERE id > 3;
```

o `just db-reset` (restaura el seed exacto; destructivo, requiere confirmación previa).

## Open Questions

- [ ] `upsert` con `update: {}` sobre la PK compuesta de `PermissionUser` (D-D): no
      ejecutado. PR#1 lo confirma o cae al `create` + `catch P2002`.
- [ ] Equivalencia `buildPaginator` ≡ `paginate()` (D-B): análisis de código; el test de
      PR#3 la vuelve ejecutable.
- [ ] `chain_strategy` se decide en `sdd-tasks`; aquí se definen los seams, no la
      topología de git.
