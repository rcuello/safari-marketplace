# Design: Login, registro y `/me` reales con JWT

> US-22, Épico 19. Insumos: `proposal.md` (D-1..D-9 **cerradas**, no se re-abren),
> `specs/auth-jwt-api/spec.md` (10 requisitos) y `explore.md`. Formato:
> `archive/2026-09-02-capa-datos-identidad/design.md`. Entrega: **un PR** con
> `size:exception` (`delivery_strategy: single-pr`); `sdd-tasks` NO planifica PRs
> encadenados. Todo `path:line` citado abajo se leyó en esta sesión; los cuatro
> comportamientos de librería que el diseño apuesta (constructor de `JwtService`,
> orden de carga de `.env`, teardown de Nest, `bcryptjs` contra `$2b$`) se
> **verificaron empíricamente**, no se infirieron.

## Technical Approach

Ocho archivos de código en este orden: `package.json` (3 dependencias) → **`auth/jwt-options.ts`**
(nuevo: el único lector de `JWT_SECRET`, Decisión B) → `auth.module.ts`
(`JwtModule.registerAsync`, Decisión A) → **`auth/current-user.decorator.ts`** (nuevo:
`createParamDecorator`, cero `CanActivate`, Decisión C) → `auth.service.ts` (4 métodos reales +
traducción de las 15 claves + 7 stubs comentados) → `auth.controller.ts` → `shops.service.ts`
(`export` de `toShopDto`) → `create-auth.dto.ts` (enum a snake_case). Y tres de
documentación/entorno: `.env.example`, `justfile` (recipe `env`), `apps/README.md`.
`packages/db` no cambia: las 7 funciones de US-21 cubren CA-1..CA-5 tal cual.

## Hallazgo bloqueante: cuándo se carga `.env`

Es lo primero que hay que entender o el diseño "correcto" no funciona.

`apps/api/rest` **no usa `dotenv` directamente**: el único que carga `.env` es
`ConfigModule.forRoot()` (`app.module.ts:50`), y lo hace de forma **síncrona dentro de
`forRoot()`** (`node_modules/@nestjs/config/dist/config.module.js:62-82`:
`loadEnvFile(options)` → `assignVariablesToProcess(config)`; versión instalada 2.3.4). Pero
`forRoot()` se evalúa al construir el argumento del `@Module`, y los `require` de los módulos
hijos ocurren **antes**. Evidencia en el JS ya compilado del repo:

    dist/app.module.js:17  const auth_module_1 = require("./auth/auth.module");
    dist/app.module.js:62  config_1.ConfigModule.forRoot(),

Consecuencia: **cualquier `process.env.X` leído al evaluar `auth/auth.module.ts` es `undefined`
aunque esté en `.env`.** El precedente que cita D-3 (`StripeModule.forRoot({ apiKey:
process.env.STRIPE_API_KEY })`, `app.module.ts:51-54`) funciona por una razón que no se traslada:
está en el **mismo array literal**, después de `ConfigModule.forRoot()`. `DATABASE_URL` funciona
por otra razón distinta: Prisma la resuelve de forma diferida, en la primera consulta.

Por eso `JwtModule.register({ secret: process.env.JWT_SECRET })` está descartado: no solo daría
un fail-fast falso, es que **firmaría con `undefined`** si nadie validara. La lectura tiene que
ser diferida al ciclo de instanciación de Nest (Decisión A) o al primer request (Decisión C).

## Data Flow

    POST /api/token ─→ AuthService.login(LoginDto)
      guarda R-5 (email/password vacíos) ────────────────→ 401 INVALID_CREDENTIALS
      findUserCredentialsByEmail(email)  → null ─────────→ 401 INVALID_CREDENTIALS
      bcryptjs.compare(pw, passwordHash) → false ────────→ 401 INVALID_CREDENTIALS
      creds.isActive === false ──────────────────────────→ 401 INVALID_CREDENTIALS
      findUserWithRelations(creds.id) → permissions[]
        └→ jwt.signAsync({sub, email, permissions})  ← resolveJwtOptions()
             └→ { token, permissions, role: deriveRole(permissions) }

    GET /api/me ─→ @CurrentUser() ── header Authorization: Bearer <t>
                     └→ new JwtService(resolveJwtOptions()).verify(t)   [mismo secreto]
                          ├ falla → 401 INVALID_TOKEN
                          └ payload → controller → AuthService.me(payload.sub)
                               └→ findUserWithRelations(sub) → toMeDto (15 claves)
                                    └→ toShopDto (importada de shops.service.ts, D-9)

    POST /api/change-password ─→ @CurrentUser() → me.email
      findUserCredentialsByEmail(email) → compare(oldPassword) 
        ├ false → 200 { success: false, message: 'PICKBAZAR_MESSAGE.OLD_PASSWORD_INCORRECT' }
        └ true  → hash(newPassword, 10) → updateUserPasswordHash(id, hash) → success: true

## Architecture Decisions

### Decisión A: `JwtModule.registerAsync`, y el fail-fast vive en el `useFactory`

**Choice**: `JwtModule.registerAsync({ useFactory: resolveJwtOptions })`. El `throw` por
`JWT_SECRET` ausente/vacío ocurre cuando Nest instancia el provider de opciones, dentro de
`NestFactory.create`.

**Alternatives considered**: `register({ secret: process.env.JWT_SECRET })` con `throw` inline
(el hallazgo de arriba lo invalida: lee `undefined` siempre) · validar en `main.ts` antes de
`NestFactory.create` (`.env` tampoco está cargado ahí; obligaría a un segundo `dotenv`, fuera
del patrón) · `AuthModule.forRoot()` llamado desde `app.module.ts` (ese archivo **no** está en
la tabla de la US).

**Rationale**: es el único punto que corre *después* de que `.env` esté en `process.env` y
*antes* de que el servidor escuche. Que el proceso muera con mensaje legible está verificado en
el código instalado, no supuesto: `nest-factory.js:106` envuelve la instanciación en
`ExceptionsZone.asyncRun(..., teardown)`; `exceptions-zone.js` hace
`this.exceptionHandler.handle(e)` y luego `teardown`, que con `abortOnError = true`
(`nest-factory.js:30`; `main.ts:7` no pasa `abortOnError: false`) es
`DEFAULT_TEARDOWN = () => process.exit(1)`; `exception-handler.js` loguea `exception.message` +
`stack` con el Logger de Nest. Mensaje legible, código de salida 1, ningún servidor escuchando.

### Decisión B: un archivo nuevo cuyo único trabajo es leer el secreto una vez

**Choice**: `apps/api/rest/src/auth/jwt-options.ts` exporta
`resolveJwtOptions(): JwtModuleOptions`, memoizada. La consumen `auth.module.ts` (firma) y
`current-user.decorator.ts` (verificación).

**Alternatives considered**: poner la función en `current-user.decorator.ts` y que el módulo la
importe de ahí (ahorra un archivo; deja al módulo importando su configuración de un decorador —
mal para US-23, que necesita lo mismo) · exportarla desde `auth.module.ts` (crea un ciclo real
`auth.module → auth.controller → current-user.decorator → auth.module`; en CJS el decorador
vería `exports` a medio inicializar) · desde `auth.service.ts` (sin ciclo, pero mete
`@safari/db` y `shops.json` en el grafo del decorador y mezcla configuración con dominio).

**Rationale**: "exactamente un lugar lee el secreto" es un requisito, y hay **dos** consumidores
hoy y un tercero mañana (el guard de US-23). Es un archivo de ~30 líneas que evita la única
forma de romper la simetría firma/verificación: dos lecturas distintas de `process.env`.
**Cuesta un archivo que no está en la tabla del proposal** — se declara abajo en la estimación.

### Decisión C: `@CurrentUser()` construye su propio `JwtService`, porque no puede inyectarlo

**Choice**: `createParamDecorator` con un `JwtService` de ámbito de módulo, creado **de forma
diferida** en el primer request: `new JwtService(resolveJwtOptions())`, memoizado.

**Alternatives considered**:

| Opción | Por qué no |
|---|---|
| Inyectar `JwtService` en el decorador | Imposible: la factory de `createParamDecorator` la invoca `RouteParamsFactory` con `(data, ctx)`; no pasa por el contenedor de DI. No es una preferencia, es la restricción del framework |
| `new JwtService(...)` en el ámbito del módulo, **no** diferido | Leería `JWT_SECRET` al importar el decorador → `undefined` (hallazgo de arriba) |
| Decorador `@BearerToken()` que solo extrae el string, y verificar dentro de `AuthService` (que **sí** puede inyectar `JwtService`) | Técnicamente lo más limpio, pero **D-1 está cerrada**: "lo verifica con `JwtService` y devuelve el payload". Además obligaría a que cada método del servicio repita el `verify` |
| Sacar el `verify` a un helper que reciba el token y el secreto | Es lo que hace `jwt-options.ts` + el decorador; un helper extra sería una capa sin consumidor |

**Rationale**: que `new JwtService({...})` sea legal está verificado contra el paquete publicado
(`npm pack @nestjs/jwt@9.0.0`, esta sesión): `dist/jwt.service.d.ts` declara
`constructor(options?: JwtModuleOptions)` y `dist/jwt.service.js` decora ese parámetro con
`@Optional() @Inject(JWT_MODULE_OPTIONS)` — funciona con DI *y* a mano. Y usa el mismo secreto
que la firma porque `getSecretKey` cae en `this.options.secret` (`dist/jwt.service.js`,
`getSecretKey`/`mergeJwtOptions`) y las opciones son **el mismo objeto memoizado**.

Que un `throw` dentro de la factory de un param-decorator produzca un 401 y no un 500 también
está verificado: `node_modules/@nestjs/core/router/router-proxy.js` envuelve **todo** el handler
(la resolución de parámetros incluida, `router-execution-context.js:40-41`) en un `try/catch` que
delega en `exceptionsHandler.next(e, host)`.

### Decisión D: semántica de errores — 3 excepciones estándar y un `CoreResponse`

No hay filtro de excepciones propio y `main.ts:9` usa un `ValidationPipe` pelado: lo que sale al
cable es el `createBody` de `@nestjs/common` (`exceptions/http.exception.js:101-109`), es decir
`{statusCode, message, error}`.

| Caso | Excepción | Cuerpo en el cable |
|---|---|---|
| Contraseña mala · email inexistente · `is_active = false` | `UnauthorizedException(INVALID_CREDENTIALS_MESSAGE)` | `{"statusCode":401,"message":"Las credenciales no son válidas.","error":"Unauthorized"}` |
| Body sin `email` o sin `password` (R-5) | igual, guarda explícita | idéntico byte a byte al anterior |
| Registro con email repetido | `ConflictException(error.message)` sobre `DuplicateEmailError` | `{"statusCode":409,"message":"Ya existe un usuario con el email X.","error":"Conflict"}` |
| Token ausente / malformado / expirado / firmado con otro secreto / `sub` que ya no existe | `UnauthorizedException(INVALID_TOKEN_MESSAGE)` | `{"statusCode":401,"message":"Token de autenticación ausente o inválido.","error":"Unauthorized"}` |
| Contraseña actual equivocada | **ninguna** | `200 {"message":"PICKBAZAR_MESSAGE.OLD_PASSWORD_INCORRECT","success":false}` |
| Base caída | `ServiceUnavailableException(getUserFriendlyMessage(e))` | 503, calcando `shops.service.ts:118-121` |
| Otro error de Prisma | `InternalServerErrorException(getUserFriendlyMessage(e))` | 500, mismo precedente |

Un solo constante por mensaje: `INVALID_CREDENTIALS_MESSAGE` en `auth.service.ts` (3 usos),
`INVALID_TOKEN_MESSAGE` en `current-user.decorator.ts` (2 usos). Ninguno se cruza de archivo →
cero imports nuevos. Mensajes en español, como el precedente `settings.service.ts:28-30`.

La guarda de R-5 no es cosmética: se probó `bcryptjs@2.4.3` y
`compareSync(undefined, hash)` **lanza** `Error: Illegal arguments: undefined, string` — sin la
guarda, un `POST /api/token` con body vacío sería un **500**, no un 401. (`LoginDto` es
`PartialType`, `create-auth.dto.ts:15-17`: ambos campos son opcionales. No se le añaden
decoradores de `class-validator`: la US no lo cubre y el pipe global no tiene `whitelist`.)

`PICKBAZAR_MESSAGE.OLD_PASSWORD_INCORRECT` no es inventado: es la clave que la tienda ya
traduce (`apps/shop/public/locales/en/common.json:431` → "Old password is incorrect") y el
formulario la pasa por `t()` (`change-password-form.tsx`: `error={t(errors.oldPassword?.message!)}`,
alimentado por `useChangePassword` → `setFormError({oldPassword: data?.message})`,
`framework/rest/user.ts:420-427`). Un mensaje en español ahí saldría en pantalla sin traducir.

**Tolerancia de los frontends al 401 (nuevo, hay que declararlo)**: ambos interceptores tratan
*cualquier* 401 como "sesión caducada" — el admin borra la cookie y hace `Router.reload()`
(`admin/rest/src/data/client/http-client.ts:32-47`); la tienda, `Router.replace(Routes.home)`
(`shop/.../http-client.ts:198-207`). Como el mock nunca devolvía 401, no se veía. Efecto con
contraseña **mala**: el admin recarga la pantalla de login sin mensaje inline
(`login-form.tsx:58` tiene `onError: () => {}`) y la tienda vuelve al home. Con la contraseña
correcta el flujo es normal. No se toca ningún frontend: se declara para que `sdd-verify` no lo
reporte como bug.

### Decisión E: la traducción de `/me`, clave por clave

`me(userId)` = `findUserWithRelations(userId)` + `toMeDto`. Las 15 claves de `users.json`
(usuario 3), en orden, ni una más ni una menos:

| Clave | Origen | Nota |
|---|---|---|
| `id` | `record.id` | |
| `name` | `record.name` | |
| `email` | `record.email` | |
| `email_verified_at` | `record.emailVerifiedAt` | `Date` o `null`; 3 decimales (V-12) |
| `created_at` | `record.createdAt` | V-12: `now()` del último `db-up` |
| `updated_at` | `record.updatedAt` | ídem |
| `is_active` | `Number(record.isActive)` | V-8, calca `shops.service.ts:52` |
| `shop_id` | `null` **constante** | V-10: no hay columna |
| `email_verified` | `record.emailVerifiedAt !== null` | V-9: derivada |
| `profile` | `toProfileDto(record.profile)` o `null` | ver abajo |
| `permissions` | `record.permissions.map(toPermissionDto)` | ver abajo |
| `wallet` | `null` **constante** | V-7 (D-13) |
| `shops` | `record.shops.map(toShopDto)` | D-9; import directo |
| `last_order` | `null` **constante** | V-7. El mock del usuario 3 traía un pedido **completo** (id 48, 6 productos): la clave sobrevive, el valor no |
| `address` | `[]` **constante** | V-7. El mock traía 2 direcciones |

`toProfileDto(p)` → `{ id: p.userId, avatar, bio, socials, contact, notifications, customer_id: p.userId, created_at, updated_at }`. `id` y `customer_id` **sintetizadas** (V-5: la PK real es
`user_id`, `db/schema.sql:135-139`); en el mock ambas valían `2` para el usuario `3` — cambia el
valor, no la clave, que `shop/src/pages/profile.tsx:26` lee como `me.profile?.id!`.

`toPermissionDto(p, userId)` → `{ id, name, guard_name: p.guardName, created_at, updated_at,
pivot: { model_id: userId, permission_id: p.id, model_type: 'Marvel\\Database\\Models\\User' } }`.
V-3: `PermissionRecord` (`records.ts:166-172`) no modela `pivot`; se sintetiza aquí (D-3 del
épico). `model_id` pasa de `6` (Laravel) al id real.

`managed_shop` **no se emite** (V-11: hoy tampoco lo emite el mock).

### Decisión F: `deriveRole`, función de módulo en `auth.service.ts`

```ts
const ROLE_PRECEDENCE = ['super_admin', 'store_owner', 'staff', 'customer'] as const;

function deriveRole(permissions: string[]): string {
  return ROLE_PRECEDENCE.find((r) => permissions.includes(r)) ?? 'customer';
}
```

**Fallback `'customer'`** cuando no hay ninguno de los cuatro: calca la rama `else` del mock
(`auth.service.ts:55-61`) y mantiene la clave presente en `AuthResponse` (el admin la guarda en
cookie, `login-form.tsx:48`). Es decorativa: ningún `hasAccess()` la lee (D-5). Vive junto a
`login`/`register`, sus dos únicos consumidores; `/me` no la emite (no está entre las 15 claves).

### Decisión G: `toShopDto` se importa como función libre, sin tocar módulos de Nest

**Choice**: `import { toShopDto } from 'src/shops/shops.service';` en `auth.service.ts`. El único
cambio en `shops.service.ts` es la palabra `export` en la línea 42 (+ un comentario de una línea
que dice quién más la usa).

**Riesgo de ciclo — comprobado, no lo hay**: `shops.service.ts:1-25` no importa nada de `auth/`;
`shops.module.ts` no importa `AuthModule` ni al revés (`auth.module.ts:1-10`). El grafo nuevo es
una arista única `auth.service → shops.service`. Y **no** hace falta `imports: [ShopsModule]`:
`toShopDto` es una función libre, no un provider. Efecto colateral aceptado: importarla evalúa el
`plainToClass(Shop, shopsJson)` de `shops.service.ts:30`, que ya se evalúa hoy en el arranque
(`ShopsModule` está en `app.module.ts:65`).

**Divergencia nueva**: `findUserWithRelations` construye sus `shops` con `_toShopRecord`, que no
calcula `productsCount` (opcional, `records.ts:88-93`), así que `toShopDto` aplica su `?? 0` y
**`/me` publica `shops[].products_count: 0`** para todas las tiendas.

### Decisión H: `bcryptjs` con API de promesas y costo 10

**Choice**: `await compare(...)` / `await hash(pw, 10)` (sin callback, `bcryptjs@2` devuelve
promesa). Costo **10**, el del seed.

**Alternatives considered**: `compareSync`/`hashSync` — más cortas, pero bloquean el event loop
~60-100 ms por login en el mismo proceso que hace SSR para las dos apps.

**Rationale y verificación empírica** (probeta aparte, `bcryptjs@2.4.3`, esta sesión):
`compareSync('demodemo', HASH_DEMO)` → `true` y la variante de promesa también → **el `$2b$` del
seed se verifica sin problema** (`db/generate-seed.mjs:62`, `db/seed.sql:50-54`). Los hashes
nuevos que emite `bcryptjs@2` llevan prefijo **`$2a$10$`** en vez de `$2b$` — divergencia
cosmética: ambos se verifican con la misma librería.

`@types/bcryptjs` se pina a **`^2.4.6`**: la última publicada (`3.0.0`) está *deprecated* como
stub ("bcryptjs provides its own type definitions") y apunta a `bcryptjs@3`, que no es el que
instala esta US. Sin el pin, `yarn add -D @types/bcryptjs` traería el stub y el build quedaría
sin tipos.

### Decisión I: el enum `Permission` y el registro

`create-auth.dto.ts:5-10` pasa a `SUPER_ADMIN = 'super_admin'`, `STORE_OWNER = 'store_owner'`,
`STAFF = 'staff'`, `CUSTOMER = 'customer'` (claves intactas, sigue sin `export`). Confirmado en
la exploración: el `grep` de `'Super admin'|'Store owner'` en las tres apps solo encuentra las
dos declaraciones de enum — **ningún consumidor compara contra los strings viejos**. El segundo
enum (`users/dto/create-user.dto.ts:6-11`) no se toca: es de US-25.

`register` llama `createUser({ name, email, passwordHash, permissionNames: ['customer'] })` e
**ignora** `RegisterDto.permission` (D-6). No crea `profile` (no hay datos que poner): el mock
hacía spread de `users[0]` y por eso devolvía el perfil del admin. Divergencia nueva: los
usuarios registrados tienen `profile: null` en `/me`; la tienda lo tolera (`me.profile?.id!`).

### Decisión J: los 7 stubs y `logout` — una sola forma de comentario

Se pega **exactamente** esta línea encima de cada método, sin tocar el cuerpo:

```ts
// Stub declarado: lo resuelve US-24 (recuperación de contraseña / OTP). La
// respuesta fija de abajo no cambia — un stub silencioso es peor que uno
// declarado.
```

Aplica a `forgetPassword`, `verifyForgetPasswordToken`, `resetPassword`, `verifyOtpCode`,
`sendOtpCode`, `otpLogin`. En `socialLogin`, misma forma con la otra causa:

```ts
// Stub declarado por D-11 del épico: requiere credenciales OAuth externas. La
// respuesta fija de abajo no cambia.
```

Y en `auth.controller.ts:56-59` (`logout`, cuerpo intacto):

```ts
// D-9: sin refresh tokens ni denylist. El JWT sigue siendo válido hasta su
// `exp`; la sesión se cierra porque el frontend borra la cookie. Revocar
// exigiría estado servidor que esta US no introduce.
```

## File Changes

| Archivo | Acción | Descripción |
|---|---|---|
| `apps/api/rest/package.json` + `yarn.lock` | Modify | `@nestjs/jwt@^9`, `bcryptjs@^2`, `@types/bcryptjs@^2.4.6`. `yarn install` **desde ese directorio** (fuera del workspace) |
| `apps/api/rest/src/auth/jwt-options.ts` | **Create** | `resolveJwtOptions()` memoizada; único lector de `JWT_SECRET`/`JWT_EXPIRES_IN` (Decisión B) |
| `apps/api/rest/src/auth/current-user.decorator.ts` | **Create** | `@CurrentUser()` + `CurrentUserPayload` + `INVALID_TOKEN_MESSAGE` (Decisión C) |
| `apps/api/rest/src/auth/auth.module.ts` | Modify | `JwtModule.registerAsync({ useFactory: resolveJwtOptions })` (Decisión A) |
| `apps/api/rest/src/auth/auth.service.ts` | Modify | 4 métodos reales + `deriveRole` + `toMeDto`/`toProfileDto`/`toPermissionDto` + 7 comentarios de stub; deja de importar `uuid`, `plainToClass` y `@db/users.json` |
| `apps/api/rest/src/auth/auth.controller.ts` | Modify | `@CurrentUser()` en `me`, `change-password` y `add-points` (D-8); comentario en `logout` |
| `apps/api/rest/src/auth/dto/create-auth.dto.ts` | Modify | enum `Permission` a snake_case (Decisión I) |
| `apps/api/rest/src/shops/shops.service.ts` | Modify | `export` en `toShopDto` (línea 42) + comentario (D-9) |
| `apps/api/rest/.env.example` | Modify | `JWT_SECRET=` y `JWT_EXPIRES_IN=7d` |
| `justfile` (recipe `env`) | Modify | genera `JWT_SECRET` calcando el bloque `SECRET` del shop (`justfile:62-66`), con el mismo `if ! grep -q` para no pisar un `.env` existente |
| `apps/README.md` (`:94-102`) | Modify | credencial `demodemo`, borrar `vendor@demo.com` (V-13), documentar las 2 variables y R-7 (rotar el secreto invalida las cookies vivas) |

## Interfaces / Contracts

```ts
// auth/jwt-options.ts — el único lugar que lee el secreto
export function resolveJwtOptions(): JwtModuleOptions;   // memoizada; lanza si falta/vacío

// auth/current-user.decorator.ts
export interface CurrentUserPayload {
  sub: number; email: string; permissions: string[]; iat: number; exp: number;
}
export const CurrentUser: () => ParameterDecorator;      // devuelve el payload, NO carga el usuario

// auth/auth.service.ts — firmas que cambian
login(loginInput: LoginDto): Promise<AuthResponse>;                    // igual, comportamiento real
register(createUserInput: RegisterDto): Promise<AuthResponse>;         // igual
changePassword(input: ChangePasswordDto, userEmail: string): Promise<CoreResponse>;  // +1 param
me(userId: number): Promise<User>;                                     // era me(): User
```

El decorador **no** consulta la base: cargar el usuario ahí duplicaría la consulta de `/me` y
añadiría una inútil en `change-password`, que solo necesita el email. Los métodos del servicio
reciben **primitivas**, no el payload: el servicio no depende del decorador y US-23 puede
alimentarlos desde `request.user` sin tocar firmas.

En `auth.controller.ts`: `me(@CurrentUser() user: CurrentUserPayload)` → `this.authService.me(user.sub)`;
`changePassword(@Body() dto, @CurrentUser() user)` → `changePassword(dto, user.email)`;
`addWalletPoints(@Body() dto: any, @CurrentUser() user)` → `me(user.sub)` (V-15: exige token; no
suma puntos, igual que hoy).

## Divergencias nuevas (se suman a las 15 del proposal)

| # | Divergencia | Tratamiento |
|---|---|---|
| V-16 | `shops[].products_count` sale `0` en `/me` (`_toShopRecord` no calcula `productsCount`) | Declarada; `/api/shops` sigue trayendo el conteo real |
| V-17 | Los usuarios registrados tienen `profile: null` (el mock heredaba el perfil del admin) | Declarada; `?.` en la tienda |
| V-18 | Hashes nuevos con prefijo `$2a$` (el seed usa `$2b$`) | Cosmética; ambos se verifican |
| V-19 | Un 401 hace que el admin recargue la pantalla de login y que la tienda vuelva al home, sin mensaje inline | Declarada; arreglarlo es tocar frontends (fuera de alcance) |
| V-20 | `POST /api/register` **gana** la clave `role` (el mock solo devolvía `token`+`permissions`, `auth.service.ts:36-39`) | Lo **exige** el spec ("`role` MUST seguir presente en `token` y `register`"); es adición mandatada, no accidente. `role: 'customer'` siempre, por D-6 |

Nota adyacente **no accionada**: el comentario de `db/generate-seed.mjs:54-55` ("no hay bcryptjs
en ningún package.json del monorepo, y así se queda") queda obsoleto. `db/` está fuera de
alcance; se menciona, no se edita.

## Camino de evidencia para CA-2 (usuario inactivo)

Los 3 usuarios sembrados tienen `is_active = true` (`db/seed.sql:51-53`) y `setUserActive` existe
en `@safari/db` pero **no está expuesta por HTTP** (es US-25). No se añade endpoint ni recipe de
`just`: la evidencia se produce con un `UPDATE` directo y se revierte. Se usa
`customer@demo.com` (id 2), **nunca** el id 3, del que depende el resto de la DoD.

```bash
# 1) desactivar
docker compose exec -T postgres psql -U safari -d safari_scraper -v ON_ERROR_STOP=1 \
  -c "UPDATE users SET is_active = false WHERE email = 'customer@demo.com';" \
  -c "SELECT id, email, is_active FROM users WHERE email = 'customer@demo.com';"

# 2) el 401 de CA-2, con la contraseña CORRECTA, pegado junto al de contraseña mala
curl -s -i -X POST http://localhost:9001/api/token \
  -H 'Content-Type: application/json' \
  -d '{"email":"customer@demo.com","password":"demodemo"}'

# 3) restaurar — OBLIGATORIO, la credencial demo debe seguir sirviendo
docker compose exec -T postgres psql -U safari -d safari_scraper -v ON_ERROR_STOP=1 \
  -c "UPDATE users SET is_active = true WHERE email = 'customer@demo.com';" \
  -c "SELECT id, email, is_active FROM users WHERE email = 'customer@demo.com';"
```

El `SELECT` de cierre **es parte de la evidencia**: sin él no hay prueba de que la base quedó
como estaba. Efecto colateral inevitable: el trigger `users_updated_at` mueve `updated_at` del
usuario 2 dos veces (ya cubierto por V-12). `just db-shell` sirve igual si se prefiere
interactivo; se usa `exec -T` porque así es citable en el reporte (`justfile:290-291` y
`:277-281` son el precedente de ambas formas).

## Testing Strategy

No hay tests automatizados en esta US (`auth.service.spec.ts` está fuera de alcance): la
evidencia es salida real pegada.

| Capa | Qué se prueba | Cómo |
|---|---|---|
| Build | Firmas nuevas | `just build-api` limpio |
| Contrato | CA-1, CA-3, CA-4, CA-5 y los 3 casos de 401 | `curl -i`, cuerpos pegados uno junto a otro |
| Payload | `sub`/`email`/`permissions`/`iat`/`exp` | `node -e` decodificando el 2º segmento del JWT (`jq` no está instalado en esta máquina) |
| Key-set | Las 15 claves de `/me` | `node -e` comparando `Object.keys()` contra `users.json`, no a ojo |
| Arranque | Fail-fast de `JWT_SECRET` | comentar la variable en `.env`, `just api-dev`, pegar error y código de salida |
| Estado | CA-2 y su reversión | el bloque SQL de arriba |
| Navegador | R-2 del épico | login del admin con `demodemo` + perfil de la tienda renderizado |
| Regresión | El resto de la API sigue viva | `just verify` verde |

## Traceability

| Requisito del spec | Elemento de diseño |
|---|---|
| Login verificado emite un JWT firmado | Decisión A (opciones), D-4 del payload, `login` en el Data Flow |
| Ninguna respuesta 401 permite enumerar | Decisión D: `INVALID_CREDENTIALS_MESSAGE`, un constante, 4 ramas (incluida la guarda R-5) |
| Registro persistente con permiso fijo | Decisión I: `permissionNames: ['customer']`, `permission` del body ignorado; 409 vía `ConflictException` |
| `/me` resuelve al titular del token | Decisión C (`@CurrentUser()` → `sub`) + `me(userId)` con `findUserWithRelations` |
| Key-set de `/me` preservado | Decisión E (tabla de 15 filas) + Decisión F (`role` en `token`/`register`) |
| Cambio de contraseña verifica la actual | Decisión D (fila del `CoreResponse`) + `changePassword(dto, userEmail)` |
| `JWT_SECRET` falla rápido | Decisión A (`registerAsync` + `process.exit(1)` verificado) y Decisión B (validación en un solo sitio) |
| Los stubs no cambian su comportamiento | Decisión J: solo comentarios; cuerpos intactos, `logout` incluido |
| Ningún guard se introduce | Decisión C: `createParamDecorator`; la tabla de alternativas rechaza `CanActivate` explícitamente. Ningún archivo de la tabla de cambios contiene `@UseGuards` |
| `add-points` exige token | `auth.controller.ts`: `addWalletPoints(@Body() dto, @CurrentUser() user)` (D-8, V-15) |

## Estimación de líneas — revisada

| Concepto | Proposal | Diseño |
|---|---|---|
| `jwt-options.ts` (**nuevo**, Decisión B) | — | **~30** |
| `current-user.decorator.ts` | ~45 | ~45 |
| Resto del código a mano (7 archivos) | ~341 | ~341 |
| **Subtotal a mano** | ~386 | **~416** |
| `yarn.lock` (generado) | ~90-110 | ~90-110 |
| **Total** | ~475-500 | **~505-525** |

**Cambio material, se declara**: el archivo de la Decisión B suma ~30 líneas y el código escrito
a mano pasa de ~386 a **~416**, o sea ~16 líneas **por encima** del presupuesto de 400 por sí
solo. La `size:exception` que el usuario aprobó sigue en pie y el grueso de la excedencia sigue
siendo `yarn.lock`, pero ya no es *íntegramente* lock: conviene que el PR lo diga. Sigue siendo
un PR único; `sdd-tasks` no debe partirlo.

`@nestjs/jwt@9.0.0` fija `jsonwebtoken@8.5.1` (verificado con `npm view`), que arrastra `jws`,
`jwa`, `ecdsa-sig-formatter`, `ms`, `semver`, `safe-buffer` y **8 paquetes `lodash.*`** — la
estimación de ~90-110 líneas de lock del proposal es realista.

## Open Questions

Ninguna. Las 9 decisiones del proposal se heredan cerradas; las 10 de este diseño (A-J) resuelven
lo mecánico y las cuatro apuestas de librería quedaron verificadas contra el paquete instalado o
publicado, no supuestas.
