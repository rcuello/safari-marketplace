# Apply Progress: Endpoints de usuarios y staff desde Postgres (US-25)

> Cadena `stacked-to-main` (PR1 `packages/db` → PR2 mapper → PR3 servicio).
> Este documento acumula el progreso de PR1 y PR2. Fases 3-4 quedan
> intactas (`- [ ]`), pendientes de sesiones futuras.

---

## PR1 — `packages/db` (rama `pr1/db-users-relations`, base `main`)

## Alcance ejecutado

Fase 1 completa, tareas 1.1 a 1.9, todas marcadas `[x]` en `tasks.md`.

## Archivos tocados

| Archivo | Acción | Qué |
|---|---|---|
| `packages/db/src/repositories/users.repository.ts` | Modificado | `_usersWhere` extraída (compartida por `listUsers`/`listUsersWithRelations`); `listUsersWithRelations` nueva; `grantPermission` nueva; clase `UnknownPermissionError` nueva (no exportada) |
| `packages/db/index.ts` | Modificado | 2 exports nuevos en orden alfabético case-insensitive: `grantPermission` (tras `findUserWithRelations`) y `listUsersWithRelations` (tras `listUsers`). `UnknownPermissionError` deliberadamente fuera |
| `packages/db/src/repositories/users.integration.test.ts` | Modificado | +7 tests: 3 para `listUsersWithRelations` (relaciones incluidas + filtro, shops de user 1, `staff` total 0) y 4 para `grantPermission` (alta, idempotencia sin fila duplicada, permiso inexistente como error de dominio, `null` con usuario inexistente) |

`packages/db/src/records.ts` — NO tocado; no hizo falta (los tipos de retorno ya existían: `ListUsersInput`, `UserWithRelations`).

Diff real (`git diff --stat -- packages/db`): `3 files changed, 190 insertions(+), 11 deletions(-)` — 201 líneas cambiadas, dentro del presupuesto ~195 LOC estimado en `tasks.md`/`design.md`.

## La open question de diseño — RESUELTA

**Pregunta**: ¿`prisma.permissionUser.upsert({ where: { userId_permissionId: {...} }, update: {} })` funciona sobre la PK compuesta `@@id([userId, permissionId])` (`packages/db/prisma/schema.prisma:286`)?

**Resolución empírica**: SÍ funciona. Se implementó directamente con `upsert` (sin necesidad del fallback `create` + `catch P2002`) y se ejecutó contra Postgres real vía `just db-check`. Evidencia:

- El test "conceder un permiso ya poseído es idempotente" llama `grantPermission(user.id, 'store_owner')` dos veces seguidas contra la base real y pasa sin excepción.
- La aserción `prisma.permissionUser.findMany({ where: { userId: BigInt(user.id) } })` devuelve exactamente **1** fila tras las dos llamadas — cero duplicados.
- El conteo de tests subió de 84 (baseline) a **91** (baseline + 7 nuevos), todos verdes, incluida esta prueba.
- No se activó el fallback `create` + `catch P2002`; el código final usa `upsert` puro (ver `users.repository.ts`, función `grantPermission`).

**Rama tomada**: `upsert({ update: {} })`. Fallback documentado pero no necesario.

## Divergencias respecto al design

Ninguna. Implementación fiel a D-C (`listUsersWithRelations`, un `include`, sin N+1) y D-D (`grantPermission` idempotente vía `upsert`, `UnknownPermissionError` no exportada ni del archivo ni del barrel, sin reglas de autorización — D-1). Se corrigió la premisa falsa de A7 tal como el design ya lo indicaba: NO se usó el patrón `create`/`connect` de `createUser` (no idempotente para un usuario existente), sino `upsert` sobre la PK compuesta.

## Invariantes de test respetados

- Ningún test de esta sesión concede `super_admin` ni `staff` a un usuario `@users-integration.test`. Los tests de `listUsersWithRelations` que filtran por `super_admin`/`staff` solo LEEN (no escriben) sobre los usuarios sembrados 1/2/3.
- Los tests de `grantPermission` usan `store_owner` sobre usuarios centinela nuevos (`Grant-Permission@…`, `Grant-Idempotent@…`, `Grant-Unknown@…`), nunca sobre los 3 usuarios sembrados.
- Casing mezclado solo en la parte local del email (dominio `@users-integration.test` intacto).
- La aserción `not.toContain('$2')` en `listUsersWithRelations` se ancla al usuario 3 (`admin@demo.com`, hash `$2y$…` real sembrado), no a un centinela con `passwordHash: 'hash-de-prueba'`.
- Cleanup sigue siendo `afterAll` sobre `email: { endsWith: TEST_DOMAIN } }`; `permission_user` es `ON DELETE CASCADE` (`db/schema.sql:174-175`), así que los pivotes de los centinelas de `grantPermission` se limpian solos al borrar el usuario.
- Ningún test de esta sesión tocó los usuarios sembrados 1, 2 o 3.

## Evidencia de cierre (real, no "debería funcionar")

### `just db-check` (típecheck + vitest)

```
npm run typecheck
> @safari/db@0.1.0 typecheck
> tsc --noEmit

cd "$(pwd)" && npm test
> @safari/db@0.1.0 test
> vitest run

 RUN  v4.1.11 C:/DevOps/MyGitHub/safari-marketplace/packages/db

 Test Files  8 passed (8)
      Tests  91 passed (91)
   Start at  12:09:34
   Duration  7.83s
```

91/91 verdes, 8 archivos de test — sube desde el baseline de 84 (+7 tests nuevos de esta sesión). Typecheck limpio.

### `just db-build` (prisma generate + tsup)

```
npm run build
> @safari/db@0.1.0 build
> prisma generate && tsup

✔ Generated Prisma Client (7.10.0) to .\generated\prisma\client in 508ms
CLI Building entry: index.ts
CJS dist\index.js     132.38 KB
CJS dist\index.js.map 301.52 KB
CJS ⚡️ Build success in 121ms
DTS ⚡️ Build success in 7013ms
DTS dist\index.d.ts 1.38 MB
```

Verificación adicional de superficie pública en el build real:

```
$ node -e "const db=require('./dist/index.js'); console.log('grantPermission' in db, 'listUsersWithRelations' in db, 'UnknownPermissionError' in db);"
true true false
```

Confirma: los 2 exports nuevos llegan a `dist/`, disponibles para que PR3 los consuma vía `link:`; `UnknownPermissionError` NO se filtra a la superficie pública.

### Lint (biome) — nota, no gate de esta US

`npm run lint` en `packages/db` reporta 17 errores / 1 info, todos de `format`
(diferencias de fin de línea CRLF/LF). **Pre-existentes**: se confirmó
haciendo `git stash` (revirtiendo los 3 archivos de esta sesión) y corriendo
`npm run lint` de nuevo sobre el baseline — mismos 17 errores / 1 info, en
archivos que esta sesión ni siquiera tocó (`products.repository.ts`,
`shops.repository.ts`, `categories.repository.ts`, etc.). No es una
regresión de PR1; `just db-check` (el gate real de esta US, `openspec/config.yaml`
`testing.test_command`) no incluye lint. No se tocó por estar fuera de scope.

## Riesgos / notas para PR2 y PR3

- PR3 depende de que `packages/db/dist/` tenga los 2 exports nuevos — confirmado arriba.
- `grantPermission` NO exporta `UnknownPermissionError`; el consumidor de PR3 (`make-admin`) nunca podrá capturarlo por tipo — solo lo verá como un 500 vía `withPrismaErrorTranslation`, tal como el design (D-D) decidió a propósito.
- Ningún cambio de DDL; `db/schema.sql` intacto.
- `apps/` no fue tocado en absoluto en esta sesión (scope binding respetado).

## Estado (PR1)

9/9 tareas de Fase 1 completas.

---

## PR2 — extracción del mapper, refactor puro (rama `pr2/extract-user-mapper`, base `pr1/db-users-relations`)

### Alcance ejecutado

Fase 2 completa, tareas 2.1 a 2.6, todas marcadas `[x]` en `tasks.md`. Cero
cambio observable en `/api/me` (evidencia abajo).

### Archivos tocados

| Archivo | Acción | Qué |
|---|---|---|
| `apps/api/rest/src/users/user-dto.mapper.ts` | Creado | `toProfileDto`, `toPermissionDto`, `toUserDto` (ex `toMeDto`) movidas verbatim desde `auth.service.ts:81-141`, según D-A del design |
| `apps/api/rest/src/users/user-dto.mapper.spec.ts` | Creado | Gate portante de la slice: 15 claves en orden desde un fixture `UserWithRelations`; `wallet`/`last_order` `null`, `address` `[]`; `profile: null` sin perfil; `toProfileDto` sintetiza `id`/`customer_id`; `toPermissionDto` sintetiza `pivot` |
| `apps/api/rest/src/auth/auth.service.ts` | Modificado | Repuntado a `import { toUserDto } from 'src/users/user-dto.mapper'`; borrados los 3 mappers movidos y los 4 imports huérfanos (`toShopDto`, `type PermissionRecord`, `type ProfileRecord`, `type UserWithRelations`); `User` (`:44`) se mantiene — sigue en uso en `me(): Promise<User>` (`:450`); único call site de `toUserDto` sigue siendo dentro de `me()` |

### Divergencias respecto al design

Una, de compilación, no de comportamiento: `toProfileDto`/`toPermissionDto`
necesitaron una anotación de retorno explícita (`Record<string, unknown>`),
ausente en la firma del design (`Interfaces / Contracts`, sin tipo de
retorno). Al exportarlas desde un archivo nuevo, `tsc --declaration` (activo
en `apps/api/rest/tsconfig.json`) exige un tipo nombrable para la
declaración pública; el tipo inferido referenciaba `runtime.JsonValue` de
`@prisma/client`, no portable fuera de `@safari/db` (`TS2742`). Cuando
vivían como funciones privadas de `auth.service.ts`, TS no necesitaba emitir
esa declaración porque no eran exportadas. Es una anotación de tipos en
tiempo de compilación — el objeto que se construye y se serializa en
runtime es idéntico, confirmado por el diff byte a byte de abajo.

Ninguna otra divergencia: D-A del design (ruta `src/users/user-dto.mapper.ts`,
dependencia de `toShopDto` vía `shops.service.ts` sin ciclo) se siguió tal
cual.

### Evidencia de cierre (real, no "debería funcionar")

#### Diff byte a byte de `/api/me` (antes/después del refactor)

Login con `admin@demo.com`/`demodemo` (`POST /api/token`), luego
`GET /api/me` con el token, ANTES de tocar código y DESPUÉS del refactor +
`just build-api` + reinicio de la API:

```
KEYS_EQUAL_AND_SAME_ORDER: true
before keys: [ 'id','name','email','email_verified_at','created_at','updated_at',
  'is_active','shop_id','email_verified','profile','permissions','wallet',
  'shops','last_order','address' ]
after  keys: [ idéntico ]
DEEP_EQUAL_IGNORING_TIMESTAMPS: true
before raw length: 1345 after raw length: 1345
```

Mismo key-set, mismo orden, mismo tamaño de payload en bytes (1345 antes y
después — no hubo `db-up` entre medias, así que ni siquiera los timestamps
cambiaron). Cero cambio observable confirmado, no solo "debería".

#### `cd apps/api/rest && npx jest`

```
PASS src/users/user-dto.mapper.spec.ts
PASS src/shops/shops.service.spec.ts
PASS src/products/products.service.spec.ts

Test Suites: 3 passed, 3 total
Tests:       38 passed, 38 total
Snapshots:   0 total
Time:        23.268 s
```

38/38 verdes — sube desde el baseline de 33 (+5 tests nuevos del mapper).
Las 33 suites previas (`shops`/`products`) no importan `auth`/`users`; su
verde solo prueba que no se rompió compilación/importación. El gate
portante real de esta slice es `user-dto.mapper.spec.ts`.

#### `just build-api`

```
yarn build
$ rimraf dist
$ nest build
Done in 32.33s.
```

Compila limpio, 0 errores (tras la anotación de retorno explícita de la
divergencia de arriba).

### Riesgos / notas para PR3

- PR3 (`users.service.ts`/`users.controller.ts`) puede importar `toUserDto`
  desde `apps/api/rest/src/users/user-dto.mapper.ts` sin ciclo — `auth` y
  `users` ya no compiten por la propiedad del mapper.
- El patrón de anotación explícita (`Record<string, unknown>`) puede
  repetirse si PR3 exporta más funciones que construyan objetos con campos
  `Prisma.JsonValue` sin tipar — vale la pena revisarlo si `tsc --declaration`
  vuelve a fallar con `TS2742`.
- La API quedó DETENIDA al cierre de esta sesión (el proceso de
  `just api-dev` lanzado para las pruebas de antes/después se mató con
  `taskkill` tras confirmar el diff).

## Estado (PR2)

6/6 tareas de Fase 2 completas. Fases 3 y 4 quedan pendientes (`[ ]` en
`tasks.md`), sin iniciar. Listo para `sdd-verify` de PR2 o para continuar
con PR3.

---

## PR3 — migración de `users.service.ts`/`users.controller.ts` (rama `pr3/users-postgres`, base `pr2/extract-user-mapper`)

### Alcance ejecutado

Fase 3 completa, tareas 3.1 a 3.17, todas marcadas `[x]` en `tasks.md`.
Fase 4 (evidencia/cierre) queda intacta (`[ ]`), fuera del alcance de esta
sesión (la orden explícita fue "PR3 ONLY").

### Archivos tocados

| Archivo | Acción | Qué |
|---|---|---|
| `apps/api/rest/src/users/users.service.ts` | Reescrito | Deja de leer `users.json`/`fuse.js` (`this.users` eliminado); las 13 tareas de negocio pasan a `@safari/db` (`listUsersWithRelations`, `findUserWithRelations`, `setUserActive`, `listUsers`, `grantPermission`, `createUser`) + `buildPaginator` + `toUserDto`. Sigue sin constructor (D-E). |
| `apps/api/rest/src/users/users.controller.ts` | Modificado | `banUser` (block-user) gana `@CurrentUser()`; `makeAdmin` pasa de `@Param('user_id')` a `@Body('user_id')` (D-H); `ProfilesController` gana `@Permissions(...ADMIN_ONLY)` de clase (D-G/CA-5). Resto de rutas sin cambios de firma HTTP. |
| `apps/api/rest/src/users/users.service.spec.ts` | Creado | Gate portante de la slice (task 3.14): 27 tests nuevos — envoltorio de `getUsers` clave por clave y por TIPO contra `paginate()` real (`per_page` string "20"); `total=0` clamp (`current_page`/`last_page` 0, `lastItem` -1); alias `my-staffs`≡`all-staffs` con `url` propia; filtros de permiso de las 3 listas restantes; `getUsersNotify` con `take` numérico (D-B guarda #2); 404 en `findOne`/`update`/`block-user` con id inexistente y no numérico; 409 en auto-bloqueo y en el único `super_admin` (con contraejemplo de >1 admin); `make-admin` convierte string→number y 404 si no existe; `create` con permiso `customer` fijo, 409 en email duplicado, 503/500 en errores de conexión/genéricos; `update`/`remove` como stubs declarados. |

### Divergencias respecto al design

Ninguna de fondo. Una nota de implementación: `_listByPermission` recibe
`url` como el PREFIJO de ruta (`/users`, `/admin/list`, etc.) y arma
`${url}?limit=${limit}` internamente — el design no fija literalmente la
forma del segundo parámetro del helper, pero el resultado final coincide
byte a byte con la tabla de `url` por endpoint del design (`/my-staffs/list?limit=`,
`/all-staffs/list?limit=`, etc., cada uno con su propia string).

### Riesgo de presupuesto de revisión (Review Workload Guard) — reportado, no accionado

`git diff --stat` sobre `users.service.ts`+`users.controller.ts`: **281
inserciones / 191 borrados = 472 líneas**; sumando el `users.service.spec.ts`
nuevo (493 líneas) el total de PR3 ronda **965 líneas**, muy por encima del
presupuesto de 400 y del estimado `~447 LOC` de `tasks.md`/`design.md`. El
`tasks.md` (task 3.17) preveía un fallback 3a (lecturas)/3b (escrituras) si
esto ocurría, pero el prompt de esta sesión asignó explícitamente "PR3
ONLY" como una única unidad de trabajo dentro de la cadena `stacked-to-main`
ya resuelta (`Delivery strategy: ask-on-risk`, ya decidido antes de esta
sesión) — no se partió retroactivamente. Se documenta como riesgo para que
`sdd-verify`/la revisión humana lo tenga en cuenta; la mayor parte del
exceso es el propio test suite (493 de las ~965 líneas), no lógica de
negocio adicional.

### Incidente de entorno durante el apply (no atribuible al código de esta US)

A mitad de sesión, todas las peticiones HTTP a la API (incluidas rutas
públicas y sin relación con `users`, p. ej. `/api/types`, `/api/settings`,
`/api/token`) empezaron a colgarse indefinidamente con 0 bytes de
respuesta y 0% CPU en el proceso Node — sin relación con el código de PR3
(reproducía incluso en rutas de otros módulos ya migrados). Diagnóstico:
`wsl -l -v` mostró la distro `docker-desktop` en estado `Stopped` — el
backend de Docker Desktop se había caído (posible causa: el propio `docker
ps` de diagnóstico quedó colgado varios minutos, señal de que el daemon ya
estaba degradado). Recuperación: se reinició Docker Desktop
(`Stop-Process` de sus procesos + relanzamiento), se corrió `just db-up`
(recrea el contenedor y reaplica `schema.sql`/`seed.sql` — mismos datos de
seed, sin cambios de esquema) y se re-verificó `just db-check` (91/91,
verde) antes de continuar con la evidencia de `curl`. No se tocó ningún
archivo de `packages/db` ni configuración de Docker; el `docker-compose.yml`
sigue igual. Mencionado por transparencia, no por ser un hallazgo de esta
US.

### Evidencia de cierre (real, no "debería funcionar")

#### `cd apps/api/rest && npx jest`

```
PASS src/users/user-dto.mapper.spec.ts
PASS src/shops/shops.service.spec.ts
PASS src/products/products.service.spec.ts
PASS src/users/users.service.spec.ts

Test Suites: 4 passed, 4 total
Tests:       65 passed, 65 total
Snapshots:   0 total
Time:        67.249 s
```

65/65 verdes — sube desde el baseline de 38 (+27 tests nuevos de
`users.service.spec.ts`).

#### `just db-check` (antes y después del incidente de Docker)

Antes del incidente (mismo contenedor de sesiones previas):

```
Test Files  8 passed (8)
     Tests  91 passed (91)
```

Después de recrear el contenedor (`just db-up` + reseed):

```
Test Files  8 passed (8)
     Tests  91 passed (91)
  Duration  4.21s
```

91/91 en ambos casos — PR3 no toca `packages/db`, así que el conteo se
mantiene idéntico al baseline de PR1.

#### `just build-api`

```
yarn build
$ rimraf dist
$ nest build
Done in 49.80s.
```

Compila limpio, 0 errores.

#### Evidencia `curl` (API real, Postgres real, contenedor recreado tras el incidente)

Login admin (`admin@demo.com`/`demodemo`) y token de 245 caracteres
obtenido. `GET /api/users` sin `limit` explícito: `total=3, current_page=1,
per_page=30 (number, default sin query)`. Con `?limit=20` explícito:
`per_page="20"` (string) y `current_page=1` (number) — el triple camino de
D-B confirmado en vivo, no solo por unit test.

Los 5 listados por rol, cifras reales del seed:

```
admin/list      => HTTP 200  total=1 current_page=1 last_page=1 lastItem=0  url=.../admin/list?limit=30&page=1
vendors/list    => HTTP 200  total=2 current_page=1 last_page=1 lastItem=1  url=.../vendors/list?limit=30&page=1
customers/list  => HTTP 200  total=3 current_page=1 last_page=1 lastItem=2  url=.../customers/list?limit=30&page=1
my-staffs       => HTTP 200  total=0 current_page=0 last_page=0 lastItem=-1 url=.../my-staffs/list?limit=30&page=1
all-staffs      => HTTP 200  total=0 current_page=0 last_page=0 lastItem=-1 url=.../all-staffs/list?limit=30&page=1
```

`GET /api/users/3`: HTTP 200, 15 claves exactas (`id, name, email,
email_verified_at, created_at, updated_at, is_active, shop_id,
email_verified, profile, permissions, wallet, shops, last_order,
address`), `wallet: null`, `last_order: null`, `address: []`.

```
GET /api/users/99999 => HTTP 404 {"message":"No existe un usuario con id 99999."}
GET /api/users/abc   => HTTP 404 {"message":"No existe un usuario con id NaN."}
GET /api/users (sin token)            => HTTP 401 {"message":"Token de autenticación ausente o inválido."}
GET /api/users (token customer)       => HTTP 403 {"message":"No tienes permisos suficientes para esta operación."}
POST /api/profiles (token customer)   => HTTP 403 {"message":"No tienes permisos suficientes para esta operación."}
POST /api/users/block-user {id:3} (admin se bloquea a sí mismo) => HTTP 409 {"message":"No puedes bloquearte a ti mismo."}
```

Secuencia CA-4 completa sobre `customer@demo.com` (id 2), nunca el admin:

```
1) block-user {id:2}   => HTTP 201, is_active=0
2) POST /api/token (customer, bloqueado) => HTTP 401 "Las credenciales no son válidas."
3) block-user {id:2} otra vez           => HTTP 201, is_active=0 (NO se invierte, sigue bloqueado)
4) unblock-user {id:2}                  => HTTP 201, is_active=1
5) POST /api/token (customer)           => HTTP 201, token válido emitido
GET /api/users/2 (verificación final)   => HTTP 200, is_active=1  (dejado desbloqueado y funcionando)
```

Puerto 9001 liberado al cierre (`just check-ports` → `libre 9001`), proceso
de `just api-dev` terminado con `taskkill`.

## Estado (PR3)

17/17 tareas de Fase 3 completas. Fase 4 (Definición de Done, cierre de
US-25/Épico 19) queda pendiente (`[ ]` en `tasks.md`), fuera del alcance
"PR3 ONLY" de esta sesión.
