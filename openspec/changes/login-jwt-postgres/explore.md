# Exploration: US-22 — Login, registro y `/me` reales con JWT

## Current State

### El mock de auth, tal cual existe hoy

`apps/api/rest/src/auth/auth.service.ts` (leído completo, 161 líneas):

- `auth.service.ts:20-21` — coinciden EXACTAMENTE con lo que cita la US:
  `import usersJson from '@db/users.json'; const users = plainToClass(User, usersJson);`.
- `auth.service.ts:41-62` — coincide EXACTAMENTE: el método `login()` completo
  (líneas 41 a 62) hace un `if` sobre `loginInput.email` y devuelve
  `token: 'jwt token'` fijo; ninguna rama toca `loginInput.password`.
  Confirmado: **cualquier contraseña entra**.
- `register()` (líneas 26-40): genera `id: uuidv4()`, hace spread de
  `users[0]` + el input, y hace `this.users.push(user)` — un array en
  memoria del proceso Node, se pierde al reiniciar.
- `me()` (líneas 154-156): **no** es async, no toma parámetros, ignora
  cualquier token: `return this.users[0]`.
- `changePassword` (63-72), `forgetPassword` (73-82),
  `verifyForgetPasswordToken` (83-92), `resetPassword` (93-102),
  `socialLogin` (103-110), `otpLogin` (111-118), `verifyOtpCode` (119-125),
  `sendOtpCode` (126-136): todos son stubs que devuelven un
  `success: true`/`AuthResponse` fijo sin lógica real. `logout()` vive en el
  **controller**, no en el service (`auth.controller.ts:56-59`), y devuelve
  `true` sin cuerpo.

Métodos de `AuthService` (inventario completo, 10 públicos): `register`,
`login`, `changePassword`, `forgetPassword`, `verifyForgetPasswordToken`,
`resetPassword`, `socialLogin`, `otpLogin`, `verifyOtpCode`, `sendOtpCode`,
`me`. US-22 toca: `login`, `register`, `changePassword`, `me`. Quedan como
stubs **declarados con comentario** (no tocar su lógica): `forgetPassword`,
`resetPassword`, `verifyForgetPasswordToken`, `verifyOtpCode`, `sendOtpCode`,
`socialLogin`, `otpLogin`. `logout` vive en el controller y ya es correcto
tal cual (US no la toca, solo se documenta con un comentario).

Rutas HTTP reales (`auth.controller.ts:1-82`, todas bajo el prefijo global
`api` fijado en `main.ts:8`): `POST register`, `POST token`,
`POST social-login-token`, `POST otp-login`, `POST send-otp-code`,
`POST verify-otp-code`, `POST forget-password`, `POST reset-password`,
`POST change-password`, `POST logout`, `POST verify-forget-password-token`,
`GET me`, `POST add-points`, `POST contact-us`.

### El DTO y el enum `Permission`

`apps/api/rest/src/auth/dto/create-auth.dto.ts:5-10` declara (sin `export`)
`enum Permission { SUPER_ADMIN = 'Super admin', STORE_OWNER = 'Store owner',
STAFF = 'Staff', CUSTOMER = 'Customer' }`, usado solo en
`RegisterDto.permission` (línea 12).

**Corrección a R-4 del épico**: el epic dice que el enum "solo lo usa
`RegisterDto`" — es cierto para *este archivo*, pero existe una **segunda
declaración local e independiente**, con el mismo nombre y los mismos
valores viejos, en `apps/api/rest/src/users/dto/create-user.dto.ts:6-11`,
usada por `CreateUserDto.permission` (línea 19). Es un enum **distinto**
(no exportado, no compartido) — no hay colisión de compilación, pero si
US-22 corrige solo el de `create-auth.dto.ts`, el repo queda con dos enums
`Permission` con el mismo nombre y semántica divergente (uno snake_case,
otro con los valores viejos). `CreateUserDto` pertenece a `/api/users`
(US-25, explícitamente fuera de alcance de esta US) — coherente con "NO
incluye", pero vale declararlo para que US-25 sepa que hereda esa
divergencia y no la in­vente de nuevo.

`AuthResponse` (`create-auth.dto.ts:40-44`): `{ token: string; permissions:
string[]; role?: string }`. `CoreResponse extends CoreMutationOutput`
(`core-mutation-output.dto.ts:1-4`): `{ message: string; success: boolean }`.

`grep` de `'Super admin'|'Store owner'` en `apps/api/rest/src`,
`apps/admin/rest/src`, `apps/shop/src` (excluyendo `node_modules`/`dist`/
`.next`) solo encuentra las dos declaraciones de enum ya citadas — **ningún
consumidor compara contra los strings viejos**. El radio de impacto del
rename es tan chico como dice R-4.

### El contrato HTTP (derivado de DTOs + `users.json`, API no levantada)

`just check-ports` confirma los 3 puertos (9001/3003/3002) **libres** — no
hay servidor corriendo para curlear bytes reales; el contrato se derivó de
las DTOs + `users.json`.

- `POST /api/token` / `POST /api/register` → `AuthResponse`:
  `{ token, permissions: string[], role? }`.
- `GET /api/me` → el `User` completo (`apps/api/rest/src/users/entities/user.entity.ts:7-19`):
  `id, name, email, password?, profile?, shops?, managed_shop?, is_active?,
  address?, permissions?, wallet?`. `Permission` (líneas 21-25):
  `{ id, name?, guard_name?, pivot? }` — el shape "Laravel" que cita la US.
- `apps/api/rest/src/db/pickbazar/users.json` (1796 líneas): **3** usuarios
  — id 3 `admin@demo.com`, id 2 `customer@demo.com`, id 1
  `store_owner@demo.com` — `grep` de `"password"` en el archivo: **0
  resultados**, ninguno de los tres tiene el campo. El shape de
  `permissions[]` del usuario 3 (líneas 27-64) confirma exactamente
  `{id, name, guard_name, created_at, updated_at, pivot:{model_id,
  permission_id, model_type}}` con `model_type: "Marvel\\Database\\Models\\User"`.

### Consumidores del contrato (paths y líneas reales)

- `apps/admin/rest/src/components/auth/login-form.tsx:44-59`: en
  `onSuccess`, si `data?.token` existe, llama
  `hasAccess(allowedRoles, data?.permissions)` (línea 47) y si pasa,
  `setAuthCredentials(data?.token, data?.permissions, data?.role)` (línea
  48). Confirmado: lee las **tres** claves. `defaultValues` del formulario
  (líneas 28-31) ya trae `admin@demo.com` / `demodemo` precargados.
- `apps/shop/src/framework/rest/client/http-client.ts:170,174`: interceptor
  de request — `const token = Cookies.get(AUTH_TOKEN_KEY);` /
  `Authorization: \`Bearer ${token ? token : ''}\`` — coincide con la línea
  174 citada por el épico.
- `hasAccess` está definido **dos veces** (una por app, idéntico body):
  `apps/admin/rest/src/utils/auth-utils.ts:54-64` y
  `apps/shop/src/framework/rest/utils/auth-utils.ts:52-62`. Ambas
  implementaciones comparan contra `permissions: string[]`, **no** contra
  `role` — `role` se guarda en la cookie pero ningún `hasAccess()` lo lee.
  Esto es clave: el contrato que de verdad importa para dejar pasar al
  admin es el array `permissions[]`, no el campo `role`.
- Constantes de rol snake_case:
  `apps/admin/rest/src/utils/constants.ts:4-6` (`SUPER_ADMIN='super_admin'`,
  `STORE_OWNER='store_owner'`, `STAFF='staff'`) y
  `apps/shop/src/lib/constants/index.ts:10-11`
  (`SUPER_ADMIN='super_admin'`, `CUSTOMER='customer'`) — coincide con D-4.

### La capa de datos de identidad (`@safari/db`, entregada por US-21)

`packages/db/index.ts:77-92` — exporta EXACTAMENTE 7 funciones + 1 clase de
error para identidad: `createUser`, `DuplicateEmailError`, `findUserById`,
`findUserCredentialsByEmail`, `findUserWithRelations`, `listUsers`,
`setUserActive`, `updateUserPasswordHash`. Coincide con lo que reclamó
US-21 ("7 funciones planas").

Leído completo `packages/db/src/repositories/users.repository.ts` (308
líneas):

- **`findUserCredentialsByEmail(email): Promise<UserCredentials | null>`**
  (líneas 104-121) — la ÚNICA función que expone el hash:
  `{ id, email, passwordHash, isActive }`, vía `$queryRaw` con
  `lower(email) = lower($1)` (usa `users_email_lower_idx`). **Cubre CA-1 y
  CA-2 completos** (login + chequeo de `isActive`).
- **`findUserById(id): Promise<UserRecord | null>`** (128-132) — sin hash.
- **`findUserWithRelations(id): Promise<UserWithRelations | null>`**
  (150-159) — perfil + permisos (vía pivote) + tiendas propias. Es el que
  `/me` (CA-4) debe usar.
- **`createUser(input): Promise<UserRecord>`** (228-261) — crea usuario +
  perfil opcional + permisos por `connect` de nombre; traduce el `P2002`
  del índice único de expresión a `DuplicateEmailError` (líneas 250-260).
  **Cubre CA-3 completo**, incluida la traducción de duplicado sin 500.
- **`updateUserPasswordHash(id, passwordHash): Promise<UserRecord | null>`**
  (267-281) — **cubre CA-5 completo** (cambio de hash tras verificar la
  contraseña actual, que corre en el servicio de Nest).
- **`setUserActive`** (284-298) y **`listUsers`** (185-214) — no los
  necesita esta US (son de US-25), pero ya existen.

**Conclusión crítica, contraria a lo que el prompt de exploración anticipaba
como riesgo posible**: NO falta ninguna función de escritura/lectura en
`packages/db` para CA-1..CA-5. Los 5 operaciones que US-22 necesita
(verificar credenciales, chequear activo, crear usuario+permiso, leer con
relaciones para `/me`, actualizar hash) **ya existen**, con el naming y las
garantías (P2002→`DuplicateEmailError`, `isActive` en `UserCredentials`) que
CA-1/CA-2/CA-3/CA-5 piden textualmente. **No hay riesgo de "función
faltante en packages/db"** para el alcance de esta US.

`packages/db/src/records.ts:141-149` — `UserRecord` (público, SIN
`passwordHash`, por diseño — D-2 del épico, comentario en la cabecera del
archivo líneas 136-140). `PermissionRecord` (166-172):
`{ id, name, guardName, createdAt, updatedAt }` — **no** lleva `pivot`; el
`pivot` Laravel (`model_id`, `permission_id`, `model_type`) que CA-6/nota
final piden preservar en `/me` debe construirse en el **servicio de Nest**
(la capa de datos no lo modela — es un detalle de traducción D-3, no un
hueco de `packages/db`).

`packages/db/prisma/schema.prisma:233-289` — confirma columna a columna:
`User.passwordHash @map("password_hash")` (línea 237),
`User.isActive @map("is_active")` (238), `Permission.name` (268, `@unique`),
`Permission.guardName @map("guard_name")` (269), `PermissionUser` (278-289,
PK compuesta `userId+permissionId`, sin `updatedAt`).

`db/schema.sql:120-121`: `password_hash text NOT NULL -- bcrypt costo 10;
demo: \`demodemo\`` y `is_active boolean NOT NULL DEFAULT true`;
`users_email_lower_idx` en línea 132 (índice único de expresión
case-insensitive).

**El seed YA tiene un hash bcrypt real para `demodemo`** — esto es lo más
importante que el prompt de exploración pedía verificar y estaba en riesgo
de faltar: `db/generate-seed.mjs:62`:
`const HASH_DEMO = '$2b$10$j/.1t7ZmKUU4qHu8Elw3dO6N4udivEj1oxeVxA1m6HOnp7D4J761S';`,
generado una única vez fuera del repo (comando documentado en el comentario
de las líneas 57-58: `bcryptjs` costo 10). `db/seed.sql:50-54` inserta los 3
usuarios con ese mismo hash literal. **CA-1 es satisfacible tal cual está
sembrada la base hoy — no hace falta regenerar nada.**

`db/seed.sql:70-74` siembra 4 permisos snake_case:
`super_admin(1), customer(2), store_owner(3), staff(4)` — coincide con
Decisión 4. `db/seed.sql:82-89` asigna: admin(3)→{super_admin, customer,
store_owner}; customer(2)→{customer}; store_owner(1)→{customer,
store_owner}. **Nota de divergencia menor** (no un riesgo, solo una
observación para el DoD): el mock de hoy devuelve para `admin@demo.com`
`permissions: ['store_owner', 'super_admin']` (sin `'customer'`), pero la
base sembrada le asigna también `'customer'`. El array cambia de contenido
pero `hasAccess()` sigue funcionando igual (sigue conteniendo
`super_admin`); solo declararlo en el DoD como divergencia conocida, igual
que las de `/api/settings`.

`packages/db/src/repositories/users.integration.test.ts` (leído completo,
206 líneas) — confirma el estilo de casa: `TEST_DOMAIN =
'@users-integration.test'`, `beforeAll`/`afterAll` limpian por dominio
centinela, nunca tocan los 3 usuarios sembrados (comentario explícito:
tocar el id 3 rompería la credencial demo de la que depende el DoD de
US-22). Asertos incluyen `JSON.stringify(user)).not.toContain('$2')` para
probar que el hash nunca escapa, incluso en relaciones anidadas.

### El precedente Nest ↔ `@safari/db`

`apps/api/rest/src/settings/settings.service.ts` (leído completo, 61
líneas) — import directo `import { getSettings } from '@safari/db';`
(línea 1, sin módulo/provider dedicado para el cliente), traducción manual
camelCase→snake_case inline en el método (`findAll`, líneas 22-40), y un
`InternalServerErrorException` con mensaje explícito si la fila no existe
(líneas 24-31). Es el patrón EXACTO que US-22 debe replicar en
`auth.service.ts`.

`apps/api/rest/package.json` (leído completo): confirma **ausencia** de
`@nestjs/jwt`, `bcryptjs`, `passport*` (ni en `dependencies` ni
`devDependencies`). `@safari/db` está como `"link:../../../packages/db"`
(línea 31). Nest **9.0.11** (`@nestjs/common`/`core`/`platform-express`).
`@nestjs/config: ^2.2.0` YA está instalado y registrado
(`app.module.ts:50`, `ConfigModule.forRoot()`), pero el estilo real del
repo es leer `process.env.X` directo (`paypal-payment.service.ts:15-16`,
`stripe-payment.service.ts:202`, `main.ts:18`), no `ConfigService`
inyectado — ningún archivo de `apps/api/rest/src` usa `ConfigService`.
**Curiosidad no bloqueante**: `auth.service.ts:17` importa `uuid` (`v4 as
uuidv4`) pero `uuid` **no** está declarado en `package.json` (ni deps ni
devDeps) — existe en `node_modules` igual (probablemente arrastrado de
antes o instalado manualmente sin `--save`). Preexistente, no lo introduce
esta US; no lo toca tampoco.

**Corrección de nombre de archivo**: la US y la tabla "Archivos a crear/
modificar" citan `apps/api/rest/.env.template` — el archivo real que existe
hoy es `apps/api/rest/.env.example` (confirmado por `ls` y por
`justfile:59`: `crear apps/api/rest/.env.example apps/api/rest/.env`).
**No existe ningún `.env.template` en `apps/api/rest`.** El diseño/tareas
deben apuntar a `.env.example`, no inventar `.env.template`.

`apps/api/rest/.env.example` (leído completo, 23 líneas): no tiene
`JWT_SECRET` ni `JWT_EXPIRES_IN` hoy; sí tiene `DATABASE_URL` (añadido por
US-20/21). `app.module.ts:8,73` ya registra `AuthModule`;
`app.module.ts:50-54` usa `StripeModule.forRoot({ apiKey:
process.env.STRIPE_API_KEY, ... })` — es el precedente de un módulo que lee
`process.env` directo en su `.forRoot()` síncrono al import time, el mismo
patrón que `JwtModule.register({...})` (sin `registerAsync`) puede seguir
para leer `JWT_SECRET`/`JWT_EXPIRES_IN` y fallar rápido si falta.

`justfile:44-90` (recipe `env`, leída completa) — usa `crear
apps/api/rest/.env.example apps/api/rest/.env` (línea 59) y **ya tiene el
patrón exacto** para generar un secreto random cross-platform en Windows
Git Bash sin dependencias nuevas (líneas 62-66, para el `SECRET` del shop):
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
+ `sed -i`. La US-22 debe replicar este mismo bloque para `JWT_SECRET`
dentro de la recipe `env`, justo después del bloque del shop o del bloque
`DATABASE_URL` de la API (líneas 70-77).

`main.ts:1-22` (leído completo): `app.setGlobalPrefix('api')` (línea 8,
confirma que todas las rutas HTTP van bajo `/api/...`),
`app.useGlobalPipes(new ValidationPipe())` (línea 9, sin `whitelist`/
`transform` — las DTOs de auth hoy no llevan decoradores de
`class-validator`, fuera de alcance de esta US). No hay
`UnauthorizedException`/`ConflictException` usados hoy en ningún archivo de
`apps/api/rest/src` (grep sin resultados) — no hay un precedente propio de
manejo de errores HTTP de auth; usar las excepciones estándar de
`@nestjs/common` es la opción natural, sin inventar un formato propio.

`apps/README.md:94-102` — sección "4. Credenciales" ya existe y hoy dice
"La API es un **mock**: `login` ignora la contraseña y decide el rol por el
email", con una tabla de 3 filas. Es el lugar exacto a actualizar (no
crear una sección nueva) con la credencial real `demodemo` y la mención de
`JWT_SECRET`/`JWT_EXPIRES_IN`.

### El diseño más filoso: `/me` y `changePassword` sin guard

US-23 (guards) es la que introduce protección real; esta US NO puede
adelantar un guard global ni uno local "solo para probar". Pero **dos**
endpoints de esta misma US necesitan saber quién es el usuario actual sin
un guard:

- `GET /api/me` (CA-4): debe resolver el usuario **desde el token**.
- `POST /api/change-password` (CA-5): el body que YA envían los dos
  frontends es `{ oldPassword, newPassword }` — confirmado leyendo
  `apps/admin/rest/src/types/index.ts:1526-1529`
  (`ChangePasswordInput`) y
  `apps/shop/src/types/index.ts:748` + `change-password-form.tsx:26`
  (`ChangePasswordUserInput`): **ninguno de los dos manda el email o un
  identificador de usuario en el body.** El servicio no tiene forma de
  saber a quién cambiarle la contraseña salvo leyendo el token — el mismo
  problema exacto que `/me`, y el CA-5 lo exige tan silenciosamente como
  el CA-4 lo dice explícito. Esta es la pregunta de diseño más filosa de
  toda la US, más aguda incluso de lo que el propio texto de la US deja
  ver (solo menciona el problema para `/me`).

## Affected Areas

- `apps/api/rest/src/auth/auth.service.ts` — reemplazo real de `login`,
  `register`, `changePassword`, `me`; comentarios de stub declarado en el
  resto.
- `apps/api/rest/src/auth/auth.controller.ts` — probablemente sin cambios
  de firma (los `@Body()` ya calzan), salvo que `me`/`changePassword`
  necesiten un `@Req()` para leer el header `Authorization` (ver pregunta
  de diseño arriba).
- `apps/api/rest/src/auth/auth.module.ts` — registrar `JwtModule`.
- `apps/api/rest/src/auth/dto/create-auth.dto.ts` — enum `Permission` a
  snake_case (solo esta declaración; la de `create-user.dto.ts` queda
  igual, es de US-25).
- `apps/api/rest/package.json` — sumar `@nestjs/jwt`, `bcryptjs`, tipos.
- `apps/api/rest/.env.example` — sumar `JWT_SECRET`/`JWT_EXPIRES_IN`
  (**no** `.env.template`, que no existe).
- `justfile` (recipe `env`) — generar `JWT_SECRET` random, mismo patrón que
  el `SECRET` del shop.
- `apps/README.md` (sección "4. Credenciales") — actualizar la tabla y
  documentar las variables nuevas.
- `packages/db` — **ningún cambio necesario**; las 7 funciones ya cubren
  el alcance.

## Approaches

1. **`@nestjs/jwt` (`JwtService`) — la que pide la US**
   - Pros: es el wrapper oficial de Nest sobre `jsonwebtoken`, expone
     `sign()`/`verify()` directos sin exigir una estrategia Passport; deja
     el terreno limpio para que US-23 añada `passport-jwt` +
     `AuthGuard('jwt')` encima SI decide ese camino, o simplemente
     reutilice el mismo `JwtService.verify()` dentro de un
     `CanActivate` a mano — ninguna opción queda bloqueada.
   - Cons: ninguno relevante para Nest 9; es la integración más delgada
     posible.
   - Effort: Low.

2. **`jsonwebtoken` crudo (sin `@nestjs/jwt`)**
   - Pros: una dependencia menos indirecta.
   - Cons: pierde la integración de módulo/DI de Nest (inyectar el secreto
     vía `ConfigModule`, testear con `Test.createTestingModule`); US-23
     tendría que reinventar esa integración si más adelante quiere
     `passport-jwt` (que espera un `JwtService`-like o su propia
     estrategia) — puentea peor con el ecosistema Nest.
   - Effort: Low-Medium (misma lógica, peor encaje con DI).

3. **`@nestjs/passport` + `passport-jwt` ya en esta US**
   - Pros: es "la forma canónica" de proteger rutas en Nest a largo plazo.
   - Cons: **exactamente lo que la US prohíbe explícitamente** ("NO
     incluye guards ni protección de rutas — US-23"). Instalar
     `passport-jwt` sin usarlo para un guard sería una dependencia muerta
     hasta la próxima sesión; instalarlo y ya activar un guard sería
     invadir el scope de US-23. Se descarta para esta US.
   - Effort: N/A (fuera de alcance).

**Recomendación**: opción 1, `@nestjs/jwt` (`JwtService`), tal como pide la
US. Versión compatible con Nest 9: `@nestjs/jwt@^9` (misma serie mayor que
`@nestjs/common`/`core` ^9.0.11, evita drift de peer deps). `bcryptjs@^2`
(API síncrona `hashSync`/`compareSync` — coincide con el HASH_DEMO ya
generado con `bcryptjs` costo 10 vía `hashSync`) + `@types/bcryptjs` como
dev dependency (bcryptjs no trae tipos propios en su `package.json`
`main`, aunque versiones recientes sí — a confirmar en la fase de diseño
con el `package.json` real que se instale).

### Cómo resolver `/me` y `changePassword` sin guard (opciones honestas)

1. **Leer el header `Authorization` a mano en el controller** (`@Req()
   req: Request` → `req.headers.authorization`), decodificar con
   `JwtService.verify()` dentro del propio método del controller o
   delegando a un método del servicio que reciba el token crudo.
   - Pros: cero acoplamiento a Passport/guards; el controller sigue
     siendo un método público normal; US-23 puede después envolver esto
     en un guard sin tocar la firma del servicio (el servicio ya recibe
     "el payload ya decodificado" o "el token crudo", cualquiera de las
     dos sirve de base).
   - Cons: repite el parseo de "Bearer X" en dos sitios (`me`,
     `changePassword`) si no se extrae un helper.
   - Effort: Low.

2. **Un decorador de parámetro propio (`@CurrentUser()` o
   `@BearerToken()`) que lee el request y decodifica** — mismo resultado
   que la opción 1 pero con la extracción de "Bearer " + verify
   centralizada en un solo lugar, reutilizable por ambos métodos.
   - Pros: DRY, y es exactamente el tipo de pieza que US-23 reutilizaría
     dentro de su guard (mismo decorador, ahora alimentado por
     `request.user` que el guard habrá poblado).
   - Cons: una pieza más de código nueva (aunque pequeña) para una US que
     dice explícitamente "no adelantar el guard".
   - Effort: Low.

3. **Un guard local, aplicado SOLO a `me`/`changePassword` con
   `@UseGuards()` en esos dos métodos** (no global).
   - Pros: usa el vocabulario "guard" que ya sabe todo el mundo Nest.
   - Cons: es un guard real, y la nota del agente ejecutor dice
     explícitamente "no adelantar el guard — es otra US y otra sesión".
     Aunque sea local y no global, introduce la clase `CanActivate` que
     US-23 iba a crear como su entregable propio; sienta un precedente
     que puede pisarle el terreno a esa US. Es la opción más arriesgada
     de malinterpretar el "NO incluye".
   - Effort: Low, pero alto riesgo de invadir scope de US-23.

**Recomendación**: opción 1 o 2 (equivalentes en espíritu; 2 es la versión
DRY de 1), evitando la palabra/clase "guard" por completo en esta US. La
fase de diseño debe decidir entre ellas: 2 dado que hay DOS consumidores
(`me` y `changePassword`) — vale la pena el decorador compartido en vez de
repetir el parseo dos veces.

### Secreto ausente: fail-fast en bootstrap vs. en el primer login

- **Fail-fast en bootstrap** (dentro de `auth.module.ts`, al construir las
  opciones de `JwtModule.register({...})`, leyendo
  `process.env.JWT_SECRET` y lanzando si falta/vacío ANTES de que Nest
  termine de armar el módulo): coincide con el patrón ya usado por
  `StripeModule.forRoot({ apiKey: process.env.STRIPE_API_KEY })` (aunque
  Stripe no valida ahí — sería el primer caso que sí lo hace). Es lo que
  pide la nota del agente ejecutor: "la API debe fallar al arrancar con un
  mensaje claro, no firmar con un default silencioso".
- **Fail en el primer login**: más tarde detecta el problema (en
  producción real sería inaceptable — la API "parece" sana hasta que
  alguien intenta loguearse). Se descarta explícitamente por la nota del
  ejecutor.

**Recomendación**: fail-fast en bootstrap.

## Recommendation

`@nestjs/jwt` + `bcryptjs`, siguiendo el precedente de
`settings.service.ts` (import directo de `@safari/db`, traducción manual
camelCase→snake_case en el servicio). `/me` y `changePassword` resuelven el
usuario actual leyendo el header `Authorization` a mano (opción 2, un
decorador de parámetro compartido) — nunca un `CanActivate`/guard, ni
siquiera local. `JWT_SECRET` se valida al construir `JwtModule` en
`auth.module.ts` (fail-fast en bootstrap). Cero cambios en `packages/db`:
las 7 funciones ya cubren CA-1 a CA-5 sin faltantes.

## Risks

- **CRÍTICO: ninguno detectado.** Los dos candidatos que el prompt de
  exploración señalaba como posibles bloqueos — función faltante en
  `packages/db` y seed sin hash bcrypt — **no existen**: las 7 funciones
  cubren el alcance completo y el seed ya trae `HASH_DEMO` real para
  `demodemo`. Esto reduce el riesgo de la US frente a lo que el epic hacía
  temer.
- **MEDIO — pregunta de diseño abierta (no resuelta aquí, corresponde a
  `sdd-design`)**: cómo `me()` y `changePassword()` identifican al usuario
  actual sin guard. Ver sección de approaches arriba; recomendación dada,
  pero es una decisión de diseño real, no un hecho verificado en código
  existente (no hay precedente de esto en el repo hoy).
- **BAJO — nombre de archivo incorrecto en la US**: la tabla "Archivos a
  crear/modificar" dice `apps/api/rest/.env.template`; el archivo real es
  `.env.example`. Debe corregirse en `sdd-propose`/`sdd-tasks` para no
  crear un archivo nuevo por error.
- **BAJO — divergencia de contenido de `permissions[]` para
  `admin@demo.com`**: el mock hoy no incluye `'customer'` en el array del
  admin; la base sembrada sí. No rompe `hasAccess()` (sigue conteniendo
  `super_admin`), pero debe declararse en el DoD como divergencia conocida
  (mismo trato que las de `/api/settings`).
- **BAJO — segunda declaración del enum `Permission`** en
  `users/dto/create-user.dto.ts:6-11` (usado por `CreateUserDto`, propio
  de `/api/users`, US-25) queda con los valores viejos si esta US solo
  corrige `create-auth.dto.ts`. Consistente con el "NO incluye" de esta US,
  pero US-25 debe saber que hereda esa segunda declaración divergente.
- **BAJO — `uuid` usado sin declarar en `package.json`** de
  `apps/api/rest` (preexistente, no lo introduce ni lo toca esta US;
  mencionado por completitud, no requiere acción de esta US).

## Ready for Proposal

**Sí.** El alcance de CA-1 a CA-6 es completamente ejecutable con lo que
ya existe en `packages/db` y en la base sembrada — no hay ningún hallazgo
que obligue a tocar algo fuera del "NO incluye" de la US. La única
decisión que `sdd-propose`/`sdd-design` debe fijar explícitamente es el
mecanismo de lectura del token en `me`/`changePassword` sin guard (sección
de approaches arriba), y la corrección de nombre `.env.example` (no
`.env.template`) en la tabla de archivos.
