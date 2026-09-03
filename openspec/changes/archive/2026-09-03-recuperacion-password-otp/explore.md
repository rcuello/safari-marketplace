# Exploración: US-24 — Recuperación de contraseña y OTP contra la base

## Current State

### 1. Los seis stubs, tal como están hoy

Todos viven en `apps/api/rest/src/auth/auth.service.ts`. Firmas y cuerpos
literales:

- `forgetPassword(forgetPasswordInput: ForgetPasswordDto): Promise<CoreResponse>`
  (`auth.service.ts:241-250`) — `console.log(forgetPasswordInput)`, devuelve
  `{ success: true, message: 'Password change successful' }`.
- `verifyForgetPasswordToken(verifyForgetPasswordTokenInput: VerifyForgetPasswordDto): Promise<CoreResponse>`
  (`auth.service.ts:255-264`) — mismo patrón, mismo mensaje fijo.
- `resetPassword(resetPasswordInput: ResetPasswordDto): Promise<CoreResponse>`
  (`auth.service.ts:269-278`) — mismo patrón, mismo mensaje fijo.
- `otpLogin(otpLoginDto: OtpLoginDto): Promise<AuthResponse>`
  (`auth.service.ts:294-301`) — devuelve
  `{ token: 'jwt token', permissions: ['super_admin', 'customer'], role: 'customer' }`
  (token literal, no firmado; permisos inventados).
- `verifyOtpCode(verifyOtpInput: VerifyOtpDto): Promise<CoreResponse>`
  (`auth.service.ts:306-312`) — devuelve `{ message: 'success', success: true }`.
- `sendOtpCode(otpInput: OtpDto): Promise<OtpResponse>`
  (`auth.service.ts:317-327`) — devuelve
  `{ message: 'success', success: true, id: '1', provider: 'google', phone_number: '+919494949494', is_contact_exist: true }`
  — el `phone_number` hardcodeado ignora el input.

Nota de discrepancia con el "Contexto" de la US: dice que los cuatro
métodos de recuperación "hacen `console.log` y devuelven `{success: true,
message: 'Password change successful'}`" en el rango `73-102`. Ese rango de
líneas es obsoleto (hoy son las líneas 241-278; el archivo creció con
`login`/`register`/`changePassword` de US-22 antes de esos stubs). El
contenido descrito sí es correcto, solo la numeración de línea decayó.
Verificado contra el archivo real, no contra la US.

Los seis endpoints ya están marcados `@Public()` en
`apps/api/rest/src/auth/auth.controller.ts:35-63,79-85` (`otp-login`,
`send-otp-code`, `verify-otp-code`, `forget-password`, `reset-password`,
`verify-forget-password-token`). Ver sección 3.

### 2. DTOs y tipos de respuesta (contrato baseline, CA-6)

`apps/api/rest/src/auth/dto/create-auth.dto.ts:31-72`:

```ts
export class ForgetPasswordDto { email: string; }
export class VerifyForgetPasswordDto { email: string; token: string; }
export class ResetPasswordDto { email: string; token: string; password: string; }
export class VerifyOtpDto { otp_id: string; code: string; phone_number: string; }
export class OtpDto { phone_number: string; }
export class OtpLoginDto {
  otp_id: string; code: string; phone_number: string;
  name?: string; email?: string;
}
export class OtpResponse {
  id: string; message: string; success: boolean;
  phone_number: string; provider: string; is_contact_exist: boolean;
}
export class CoreResponse extends CoreMutationOutput {} // { message: string; success: boolean }
export class AuthResponse { token: string; permissions: string[]; role?: string; }
```

`CoreMutationOutput` (`apps/api/rest/src/common/dto/core-mutation-output.dto.ts`):
`{ message: string; success: boolean }`, en ese orden de declaración. Ninguna
clase usa `class-validator` (no hay `@IsEmail`/`@IsString`, igual que el
resto de DTOs del módulo) — el body no se valida hoy más allá del tipado
TypeScript, que en runtime no protege nada.

Precedente de shape ya vigente en `changePassword` (`auth.service.ts:217-225`):
un fallo de dominio devuelve `CoreResponse` con `success: false` y NUNCA una
excepción — es el patrón que CA-3/CA-4 de esta US deben replicar (un token
vencido o inválido no es un 401/500, es `{success:false}` con 200).

### 3. Estado real del guard — ya resuelto por US-23

La nota final de la US pide "coordinar con `@Public()` de US-23 si esa US
ya está aplicada". **US-23 SÍ está aplicada y archivada**
(`openspec/changes/archive/2026-09-03-guards-autorizacion-api/`), y sus
artefactos confirman que las seis rutas de esta US ya llevan `@Public()`,
puestas ahí durante US-23 (no durante ninguna ejecución previa de US-24):

- `apps/api/rest/src/auth/auth.controller.ts:35-63,79-85` — decorador
  `@Public()` presente en `otp-login`, `send-otp-code`, `verify-otp-code`,
  `forget-password`, `reset-password`, `verify-forget-password-token`.
- `openspec/changes/archive/2026-09-03-guards-autorizacion-api/tasks.md:49` —
  tarea 2.1 marcada `[x]`: "`@Public()` en las 10 rutas de
  `auth.controller.ts` sin sesión (register, token, social-login-token,
  otp-login, send/verify-otp-code, forget/reset-password,
  verify-forget-password-token, contact-us)".
- `openspec/specs/authorization-guards-api/spec.md:54` — el bucket
  "Pública" (64 rutas) incluye explícitamente esas 10 rutas de `auth`.

Conclusión verificada: **no hay acción de coordinación pendiente**. Los seis
endpoints responderán sin exigir bearer token con el guard global activo. No
hace falta tocar `auth.controller.ts` para esto — sí seguirá habiendo que
tocarlo si el diseño final decide, por ejemplo, cambiar el status code de
alguna respuesta (ver sección 5), pero el decorador ya está.

`JwtAuthGuard` (`apps/api/rest/src/auth/guards/jwt-auth.guard.ts:42-61`) lee
`IS_PUBLIC_KEY` con `Reflector.getAllAndOverride` (handler antes que clase),
así que el decorador a nivel de método basta.

### 4. Las tablas — verificadas contra `db/schema.sql`, no contra la US

La afirmación de la US ("US-20 ya creó `password_reset_tokens` y
`otp_codes`") es correcta. DDL real (`db/schema.sql:181-212`):

```sql
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id            bigserial    PRIMARY KEY,
    user_id       bigint       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token         text         NOT NULL UNIQUE,
    expires_at    timestamptz  NOT NULL,
    consumed_at   timestamptz,
    created_at    timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS otp_codes (
    id            bigserial    PRIMARY KEY,
    phone         text         NOT NULL,
    code          text         NOT NULL,
    expires_at    timestamptz  NOT NULL,
    consumed_at   timestamptz,
    created_at    timestamptz  NOT NULL DEFAULT now()
);
```

Índices: `password_reset_tokens_user_idx ON password_reset_tokens (user_id)`
y `otp_codes_phone_idx ON otp_codes (phone)` (`db/schema.sql:473-474`).

Columnas presentes y suficientes para CA-1..CA-5: hay `expires_at`
(vencimiento) y `consumed_at` (marca de un solo uso, nullable = no
consumido). **No falta ninguna columna** para lo que pide la US. Dos
observaciones, no bloqueos:

- `password_reset_tokens.token` es `text NOT NULL UNIQUE` — un solo campo,
  sin columna separada de "hash" vs. "lookup key". Esto fuerza la decisión
  de diseño de la sección 5 (cómo buscar un token guardado hasheado).
- `otp_codes` NO tiene FK a `users` (a propósito, comentario en el schema:
  "se clave por teléfono en texto plano porque `POST /api/send-otp-code`
  recibe un teléfono, no un id, y no existe columna de teléfono en
  `users`/`profiles`"). Esto es relevante para la pregunta abierta de
  `otp-login` sin usuario existente (sección 5).

`packages/db/prisma/schema.prisma:293-319` **ya modela ambas tablas**
(`model PasswordResetToken`, `model OtpCode`), con el comentario explícito
"su repositorio llega en US-24 (no consumido por esta US)". No hace falta
`prisma db pull` ni tocar el `.prisma`: el modelo Prisma está listo, solo
falta el repositorio que lo consuma. Esto también significa que **no se
necesita `just db-reset`** para esta US — el esquema ya existe desde
US-20/21.

No existe hoy `packages/db/src/repositories/auth-tokens.repository.ts` ni
`auth-tokens.integration.test.ts` (confirmado por listado de directorio) —
son archivos nuevos, como dice la tabla "Archivos a crear/modificar" de la
US.

### 5. Precedente de US-22/US-23

**Hashing** (`auth.service.ts:9,170,212-215,227-230`): `bcryptjs` puro
(sin binding nativo), costo **10** literal en `bcrypt.hash(pw, 10)` — no hay
constante nombrada, el `10` está inline en cada call site. `register()` y
`changePassword()` lo usan igual. Coherente con Decisión 6 del épico
("`bcryptjs` — `bcrypt` nativo exige node-gyp y VS Build Tools, Windows sin
toolchain de C++").

**JWT** (`apps/api/rest/src/auth/jwt-options.ts:18-34`): `resolveJwtOptions()`
lee `JWT_SECRET` (falla rápido si falta/vacío, lanza `Error` con mensaje que
nombra la variable) y `JWT_EXPIRES_IN` (default `'7d'` si no está en el
`.env`, ya seteado a `7d` en `apps/api/rest/.env.example:27-28`). Firmado
vía `this.jwtService.signAsync({ sub, email, permissions })`
(`auth.service.ts:157-161`) — el payload NO lleva ningún campo relativo a
OTP; si `otp-login` reutiliza `jwtService.signAsync`, el payload debería
tener la misma forma que `login()` (`sub`, `email`, `permissions`), lo cual
exige resolver `permissions` para el usuario autenticado por OTP antes de
firmar. Memoización vía `let cached` a nivel de módulo — un solo secreto
para toda la app.

**Errores → HTTP** (`auth.service.ts:341-350`, método privado
`withPrismaErrorTranslation`): caída de conexión → 503
(`ServiceUnavailableException` + `getUserFriendlyMessage`); cualquier otro
error de Prisma → 500 (`InternalServerErrorException`). Errores de dominio
concretos se traducen a mano ANTES de esa envoltura (p. ej.
`DuplicateEmailError` → 409 en `register()`, `auth.service.ts:180-188`).
Precedente directo para un futuro `TokenNotFoundError`/`InvalidOtpError` si
el diseño decidiera lanzar en vez de devolver `success:false` (aunque D-4
del épico y el patrón de `changePassword` empujan más bien a "nunca
lanzar, siempre `{success:false}`" para estos seis endpoints, dado que son
públicos y ya reciben inputs no autenticados).

**`@Public()` / guard global**: ver sección 3 — ya resuelto, ninguna acción.

### 6. Patrón de repositorio en `packages/db`

Precedente elegido: `users.repository.ts` (identidad, mismo dominio) +
`products.repository.ts` (único otro consumidor real de `now()`).

- **Funciones planas por agregado**, no clases (`findUserById`,
  `createUser`, `updateUserPasswordHash`, `setUserActive`...). El
  repositorio de tokens debería seguir el mismo estilo:
  `createPasswordResetToken`, `findValidPasswordResetToken` (o similar),
  `consumePasswordResetToken`, y las tres equivalentes para `otp_codes`.
- **Records JSON-safe**: `_id()` convierte `bigint` (bigserial) → `number`;
  fechas quedan como `Date` (el consumidor las serializa). El repositorio
  nuevo necesita su propio `_toXRecord` o puede vivir sin `records.ts`
  compartido si el shape es interno de `auth-tokens.repository.ts` (como
  `UserCredentials`, que vive fuera de `records.ts` a propósito porque es
  "una forma que lleva el hash... fuera de la base" — mismo criterio
  aplicaría al valor plano del token/código antes de hashear, que NUNCA
  debería aparecer en un record público).
- **Errores de dominio como clases exportadas**: `DuplicateEmailError extends Error`
  con `readonly code = 'USER_DUPLICATE_EMAIL'` (`users.repository.ts:75-81`).
  Traducción de P2002/P2025 a mano con un helper `_isRecordNotFound`
  (`users.repository.ts:300-307`) — no hay uso de `isPrismaConstraintError`
  de `errors.ts` dentro de los repositorios; esa utilidad la consume la capa
  de Nest (`withPrismaErrorTranslation`), no `packages/db`.
- **Tests de integración** (`users.integration.test.ts`): contra el
  Postgres real de `just db-up` (puerto 5433), con `dotenv/config` al
  tope. Regla dura: las escrituras de prueba SOLO tocan un "dominio
  centinela" (`@users-integration.test`), NUNCA los 3 usuarios sembrados —
  para `auth-tokens` el equivalente es no tocar los `user_id` 1/2/3 al
  crear tokens/OTP de prueba, o limpiar explícitamente lo creado en
  `afterAll`. `beforeAll(cleanup)` también corre por si una corrida previa
  quedó abortada.
- **`src/clock.ts`** — API real, citada textual:
  ```ts
  let _nowProvider: () => Date = () => new Date();
  export function _setNowProvider(provider: () => Date): void {
    _nowProvider = provider;
  }
  export function now(): Date {
    return _nowProvider();
  }
  ```
  Único consumidor no-test hoy: `products.repository.ts:335`
  (`const scrapedAt = input.scrapedAt ?? now();`). Exportado desde
  `packages/db/index.ts:3` (`_setNowProvider`, `now`). Para probar
  vencimiento sin `setTimeout`: crear el token/código con `now()` internamente
  en el repositorio, y en el test llamar `_setNowProvider(() => new Date(<futuro>))`
  antes de verificar, restaurando el provider real en `afterAll`/`afterEach`
  (ningún test existente hoy lo usa — sería el primer consumidor real de
  `_setNowProvider` en el repo, todo lo demás en `now()` corre con el reloj
  real).

## Affected Areas

- `apps/api/rest/src/auth/auth.service.ts` — los seis métodos stub pasan a
  consumir el repositorio nuevo; import de `bcrypt` ya presente.
- `apps/api/rest/src/auth/auth.controller.ts` — sin cambios esperados (ya
  `@Public()` en los seis), salvo que el diseño decida cambiar algún status
  code, lo cual hoy Nest infiere automáticamente de las excepciones
  lanzadas.
- `apps/api/rest/src/auth/dto/create-auth.dto.ts` — contrato baseline, no
  se espera tocarlo (CA-6 exige preservarlo).
- `packages/db/src/repositories/auth-tokens.repository.ts` — nuevo.
- `packages/db/src/repositories/auth-tokens.integration.test.ts` — nuevo.
- `packages/db/index.ts` — nuevos exports (funciones + tipos del
  repositorio nuevo), siguiendo el bloque alfabético por archivo que ya
  usa para `users.repository.ts` (líneas 77-92).
- `packages/db/prisma/schema.prisma` — YA modela `PasswordResetToken` y
  `OtpCode` (líneas 293-319); no requiere cambios ni `db pull`.
- `db/schema.sql` — no requiere cambios; las tablas ya están completas para
  lo que pide esta US.
- `apps/README.md` — probablemente necesite una nota sobre cómo leer el
  token/código del log (paralela a la de `JWT_SECRET`/credencial demo que
  ya documentó US-22), dado que la DoD exige "curl pegado... token leído
  del log".

## Preguntas de diseño abiertas (NO resueltas aquí — para proposal/design)

1. **Cómo se busca un token hasheado.** `password_reset_tokens.token` es
   `text UNIQUE`, un solo campo. Si se hashea con `bcryptjs` (como pide la
   nota del agente ejecutor), el hash es salado y no-determinista: dos
   `bcrypt.hash(mismoToken)` producen strings distintos, así que
   `WHERE token = $1` nunca puede encontrar la fila rehasheando el token
   recibido en la URL. Opciones a decidir en proposal/design:
   - (a) Buscar por `user_id` (resuelto desde `email` del `VerifyForgetPasswordDto`)
     y `bcrypt.compare()` contra la fila (o filas) vigente(s) de ese
     usuario — evita escanear toda la tabla, usa el índice
     `password_reset_tokens_user_idx` ya existente.
   - (b) Guardar un hash NO salado (p. ej. sha256) que sí permite
     `WHERE token = sha256($1)` con igualdad exacta, aceptando que ya no
     es "el mismo bcryptjs de US-22" que pide la nota del agente ejecutor.
   - (c) Invalidar/reemplazar cualquier token previo del usuario al pedir
     uno nuevo, así (a) solo compara contra como máximo una fila viva.
   Cualquiera de estas es una decisión de diseño, no de esquema — la tabla
   ya soporta las tres sin migración.

2. **`otp-login` sin usuario existente.** La nota del agente ejecutor exige
   una decisión explícita, no un usuario fantasma. `otp_codes` no tiene FK a
   `users` (verificado, sección 4) — la tabla en sí no impide un teléfono
   sin dueño. `OtpLoginDto` trae `name`/`email` opcionales que el mock
   ignora. Falta decidir: si no existe usuario con ese teléfono, ¿error de
   negocio (`CoreResponse`/excepción con qué status) o creación de cuenta
   usando `name`/`email` si vienen? Y si se decide crear cuenta: ¿con qué
   contraseña (no hay campo password en el flujo OTP) y qué permiso
   (paralelo al `customer` fijo de `register()`, D-6 del épico)?

3. **Población real de `OtpResponse`.** `is_contact_exist`, `provider` y
   `phone_number` son hoy inventados (`true`, `'google'`,
   `'+919494949494'` fijo). `provider` no tiene tabla ni columna que lo
   respalde en ningún esquema — no hay proveedor real (D-12). Decidir si
   `provider` queda como constante declarada (p. ej. `'log'` o
   `'development'`, honesto sobre que no hay SMS real) y cómo se calcula
   `is_contact_exist` (¿existe algún usuario/profile con ese teléfono? — ya
   se vio que no hay columna de teléfono indexada en `users`/`profiles`,
   solo `profile.contact` de texto libre sin unicidad ni índice).

4. **Valores numéricos de expiración (TTL).** Ni la US ni el schema fijan
   un número. Precedente disponible: `JWT_EXPIRES_IN` vive en `.env` con
   default embebido en código (`jwt-options.ts:31`, `'7d'` si falta la
   var). Replicar ese patrón para
   `PASSWORD_RESET_TOKEN_TTL_MINUTES`/`OTP_CODE_TTL_MINUTES` (o nombres
   similares) es consistente con el estilo del repo, pero el valor mismo
   (¿15 min? ¿1 hora? ¿5 min para OTP?) no está decidido en ningún
   artefacto existente.

5. **Formato del log y advertencia de "no hay envío real".** La nota del
   agente ejecutor exige que el log lo diga "con todas las letras". No hay
   precedente de formato de log estructurado en el repo (no se encontró
   uso de un logger más allá de `console.log` puntual en los stubs
   actuales) — decidir el formato exacto del mensaje queda para
   design/tasks, no para esta exploración.

## Scope Boundaries (recordatorio vinculante)

**NO incluye** (US-24, sección Scope): proveedor de correo o SMS,
plantillas de mensaje, **rate limiting** (el hueco es evidente — un
`forget-password` o `send-otp-code` sin límite de intentos es un vector de
enumeración/DoS de bajo costo, pero NO se acciona en esta US, solo se
menciona), social login (D-11 del épico, ya resuelto como stub declarado en
US-22), ni cambios en shop o admin.

Adyacente-y-tentador detectado durante la exploración, explícitamente fuera:
- Añadir `class-validator` a los DTOs de este módulo (`@IsEmail`,
  `@Length`) — ningún DTO del módulo lo usa hoy; hacerlo solo para estos
  seis sería inconsistente y expande el scope de tasks.md.
- Tocar `RegisterDto`/`Permission` enum (`create-auth.dto.ts:9-17`) —
  deuda ya señalada por el propio código como "heredada de US-25", no de
  este cambio.
- Normalizar `console.log` a un logger real en toda la app — el stub actual
  y el resto del módulo usan `console.log`; introducir un logger
  estructurado solo para estos seis métodos sería una mejora adyacente, no
  parte del pedido.

## Recommendation

La exploración no encontró bloqueos de esquema ni de guard: **las tablas y
los modelos Prisma ya existen** (US-20/21), **los seis endpoints ya son
públicos** (US-23), y el patrón de repositorio/servicio/errores tiene
precedente directo y suficiente en `users.repository.ts` +
`auth.service.ts`. El trabajo real de esta US es:

1. Un repositorio nuevo en `packages/db` (`auth-tokens.repository.ts`) con
   funciones planas para crear/buscar/consumir tokens de reset y códigos
   OTP, usando `now()`/`_setNowProvider` para expiración.
2. Resolver las 5 preguntas de diseño abiertas arriba (particularmente la
   #1, que determina la forma de las funciones de búsqueda del
   repositorio) — candidato natural para `sdd-propose`/`sdd-design`.
3. Reemplazar los seis stubs de `auth.service.ts` por llamadas reales,
   preservando el shape `CoreResponse`/`OtpResponse`/`AuthResponse` (CA-6).
4. Tests de integración del repositorio nuevo siguiendo el patrón
   "dominio centinela" + `_setNowProvider` para vencimiento.

## Ready for Proposal

Sí. No hay ambigüedad de alcance ni bloqueo técnico — solo decisiones de
diseño acotadas (lookup del token hasheado, política de usuario fantasma en
OTP, valores de TTL, formato de log) que `sdd-propose`/`sdd-design` deben
resolver explícitamente antes de `sdd-tasks`. Recomendado avisar al
orquestador: la pregunta #1 (lookup de token hasheado) es la que más
condiciona la forma del repositorio — conviene resolverla primero, antes de
firmar el proposal, para no rehacer las funciones del repositorio a mitad
de `sdd-apply`.
