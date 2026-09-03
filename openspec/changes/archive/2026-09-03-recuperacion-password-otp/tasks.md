# Tasks: Recuperación de contraseña y OTP contra la base (US-24)

> Precedente de forma: `archive/2026-09-03-guards-autorizacion-api/tasks.md` y
> `archive/2026-09-02-login-jwt-postgres/tasks.md`. Entrega en **2 PRs
> encadenados** (`chain_strategy: stacked-to-main`), seam idéntico al de
> `design.md`: PR#1 = `packages/db` → `main`; PR#2 = `apps/api/rest` + docs →
> rama de PR#1 → `main`.

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~600 total — PR#1 ~295, PR#2 ~305 |
| 400-line budget risk | High combinado; Low-Medium por PR individual |
| Chained PRs recommended | Yes |
| Suggested split | PR#1 (`packages/db`) → PR#2 (`apps/api/rest`, base = rama de PR#1) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

```text
Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
```

### Suggested Work Units

| PR | Goal | ~Líneas | Base | Cierra con |
|---|---|---|---|---|
| 1 | `auth-tokens.repository.ts` (8 funciones + 2 tipos) + su suite de integración + exports de `index.ts` | ~295 | `main` | `just db-check` verde, recuento pegado |
| 2 | `recovery-options.ts` + los 6 métodos de `auth.service.ts` + `.env.example` + `apps/README.md` | ~305 | rama de PR#1 | `just build-api` limpio + los `curl` de la DoD |

Nota sobre la cifra del proposal (~585): se ajusta a ~600 por el tamaño real
de la sección nueva de `apps/README.md` (log, 2 variables, purga manual, R-2,
V-3 — más contenido que un `.env.example` de 2 líneas por sí solo). El corte
por paquete y el orden PR#1 → PR#2 no cambian.

## Phase 1: PR#1 — `packages/db`, repositorio (Fundación)

- [x] 1.1 Crear `packages/db/src/repositories/auth-tokens.repository.ts`: tipos `PasswordResetTokenSecret` (`id,userId,tokenHash,expiresAt,consumedAt`), `OtpCodeSecret` (`id,phone,codeHash,expiresAt,consumedAt`), `CreatePasswordResetTokenInput`, `CreateOtpCodeInput` — declarados en este archivo, no en `records.ts` (mismo criterio que `UserCredentials`).
- [x] 1.2 En el mismo archivo, `createPasswordResetToken(input)`: `$transaction([passwordResetToken.updateMany({where:{userId,consumedAt:null},data:{consumedAt:now()}}), passwordResetToken.create({...})])` como array (Decisión C) — nunca nested write, nunca statements sueltos.
- [x] 1.3 `findLivePasswordResetTokens(userId)`: `findMany({where:{userId,consumedAt:null,expiresAt:{gt:now()}},orderBy:{id:'desc'}})` — devuelve N≥0, la más nueva primero.
- [x] 1.4 `consumePasswordResetToken(id)`: `updateMany({where:{id,consumedAt:null},data:{consumedAt:now()}}).count` — nunca `update` (evita P2025).
- [x] 1.5 `createOtpCode(input)`, `findLiveOtpCodeById(id)` (`findFirst` con mismo filtro de vigencia), `consumeOtpCode(id)` (mismo patrón `updateMany`/`count` que 1.4).
- [x] 1.6 `purgeExpiredAuthTokens()`: dos `deleteMany` (uno por tabla) con `OR:[{expiresAt:{lt:now()}},{consumedAt:{not:null}}]`; devuelve `{passwordResetTokens,otpCodes}`.
- [x] 1.7 `findUserIdByProfileContact(contact)`: `profile.findMany({where:{contact},select:{userId:true},take:2})`; `null` si `length !== 1`; usar `_id()` de `records.ts` para el `bigint→number`.
- [x] 1.8 `packages/db/index.ts`: bloque de exports nuevo entre las líneas 28 y 29 (`auth-tokens` < `categories`, orden alfabético) — `export type {PasswordResetTokenSecret,OtpCodeSecret,CreatePasswordResetTokenInput,CreateOtpCodeInput}` + `export {createPasswordResetToken,findLivePasswordResetTokens,consumePasswordResetToken,createOtpCode,findLiveOtpCodeById,consumeOtpCode,purgeExpiredAuthTokens,findUserIdByProfileContact}`.

## Phase 2: PR#1 — Suite de integración

- [x] 2.1 Crear `packages/db/src/repositories/auth-tokens.integration.test.ts` con `import 'dotenv/config'` y estructura de `users.integration.test.ts`; usuario centinela en dominio `@auth-tokens-integration.test` (limpieza por `deleteMany({email:{endsWith:TEST_DOMAIN}})`, cascada en tokens) + prefijo centinela para `otp_codes` (sin FK, limpieza por `startsWith`).
- [x] 2.2 `beforeAll(cleanup)` + `afterEach(_setNowProvider(REAL_NOW))` + `afterAll(_setNowProvider(REAL_NOW) + cleanup + $disconnect)` — restauración del reloj nunca dentro de un `it`.
- [x] 2.3 Test: `createPasswordResetToken` invalida el token previo del mismo usuario en llamadas secuenciales; `findLivePasswordResetTokens` devuelve 1 fila (la nueva).
- [x] 2.4 Test: con dos filas vivas insertadas a mano para el mismo usuario, `findLivePasswordResetTokens` devuelve las 2, la de `id` mayor primero (contrato del bucle de `auth.service.ts`, V-6).
- [x] 2.5 Test: vencimiento — con el reloj en `+TTL+1min`, `findLivePasswordResetTokens` devuelve `[]`; al restaurar el reloj, vuelve a devolver 1.
- [x] 2.6 Test: un solo uso/carrera — `consumePasswordResetToken(id)` → `1`, repetido → `0`; `consumePasswordResetToken(999999)` → `0`.
- [x] 2.7 Test: OTP vivo/vencido/consumido — `findLiveOtpCodeById` devuelve la fila; `null` con reloj adelantado; `null` tras `consumeOtpCode`.
- [x] 2.8 Test: `findUserIdByProfileContact('12365141641631')` → `1`; `('19365141641631')` → `null` (2 perfiles, seed `db/seed.sql:62-64`); `('nadie')` → `null`.
- [x] 2.9 Test: `purgeExpiredAuthTokens()` — tras purgar, los ids vencido y consumido ya no existen y el id vivo sí (assert por id, nunca por conteo absoluto).
- [x] 2.10 Test: fuga de tipos — `Object.keys(secret)` = las 5 claves esperadas; `tokenHash`/`codeHash` es el valor pasado, nunca el claro.

## Phase 3: Verificación PR#1 (cierre autónomo, antes de mergear)

- [x] 3.1 `just db-check` verde — pegar recuento de tests.
- [x] 3.2 `SELECT count(*)` sobre `users`, `profiles`, `products`, `orders` (o los 4 conteos fijados por `identity-data-layer`: 3/12/1200/198) antes y después de la corrida — confirmar sin cambio.
- [x] 3.3 `grep -rn "bcrypt" packages/db/src` → vacío salvo 2 líneas preexistentes de `users.integration.test.ts` (US-21, fuera de esta US, no tocadas); confirmar que `packages/db/package.json:27-32` sigue con las mismas 4 dependencias (sin `bcryptjs` nuevo).

## Phase 4: PR#2 — Prerrequisito de build (GATE, primera tarea)

- [x] 4.1 `just db-build` (tras mergear PR#1) — regenera `packages/db/dist/` y `generated/` (gitignored); sin esto `apps/api/rest` falla con TS2305 al importar los símbolos de la Fase 1.

## Phase 5: PR#2 — `recovery-options.ts` (nuevo)

- [x] 5.1 Crear `apps/api/rest/src/auth/recovery-options.ts` calcando `jwt-options.ts:16-34`: interfaz `RecoveryOptions{passwordResetTtlMinutes,otpCodeTtlMinutes}`, `resolveRecoveryOptions()` memoizada con `let cached`.
- [x] 5.2 `readTtlMinutes(name,fallback)`: `process.env[name]` vacío/`undefined` → `fallback`; `Number(raw)` no entero seguro o `<=0` → `Logger('recovery-options').warn(...)` + `fallback` — nunca `throw` (lectura diferida, arranque no debe fallar por un TTL malformado).

## Phase 6: PR#2 — `auth.service.ts`, los seis métodos

- [x] 6.1 Import nuevo: `Logger` desde `@nestjs/common` (ya importado el módulo); `private readonly logger = new Logger(AuthService.name)`; import de `resolveRecoveryOptions` y de los 8 símbolos de `@safari/db` de la Fase 1.
- [x] 6.2 `forgetPassword(dto)`: `findUserCredentialsByEmail(email)` → `null` = `{success:true,message:'Password change successful'}` desde constante `PASSWORD_CHANGE_SUCCESS_MESSAGE`, sin fila ni log (CA-2); usuario existente = `randomBytes(32).hex` → `bcrypt.hash(·,10)` → `createPasswordResetToken({userId,tokenHash,expiresAt:now+ttl})` → `logger.warn` (formato D5, token en claro + advertencia) → misma respuesta literal.
- [x] 6.3 `verifyForgetPasswordToken(dto)`: `findUserCredentialsByEmail` + `findLivePasswordResetTokens(userId)`; `for…of` secuencial con `await bcrypt.compare(token,row.tokenHash)`, corta en la primera coincidencia; sin coincidencia (incluido N=0) = `{success:false,message:'PICKBAZAR_MESSAGE.INVALID_TOKEN'}`; guarda: `token` vacío = fallo sin llamar a bcrypt. NO consume.
- [x] 6.4 `resetPassword(dto)`: mismo bucle de 6.3 + chequeo `creds.isActive`; primera coincidencia → `consumePasswordResetToken(id)` → `count===0` = `{success:false,INVALID_TOKEN}`; `count===1` → `updateUserPasswordHash(userId, bcrypt.hash(password,10))` → `success:true`. Consume ANTES de cambiar el hash (falla en dirección segura). Guarda: `password` vacío = fallo sin bcrypt.
- [x] 6.5 `sendOtpCode(dto)`: guarda `phone_number` vacío → `{message:'success'→'PICKBAZAR_MESSAGE.REQUIRED_INFO_MISSING',success:false,id:'',provider:'log',phone_number:'',is_contact_exist:false}`; caso normal: `randomInt(0,1e6)` + `padStart(6,'0')` → `bcrypt.hash(·,10)` → `createOtpCode({phone,codeHash,expiresAt:now+ttl})` → `findUserIdByProfileContact(phone)!==null` → `logger.warn` (D5) → `{message:'success',success:true,id:String(row.id),provider:'log',phone_number:<eco>,is_contact_exist}`.
- [x] 6.6 `verifyOtpCode(dto)`: `Number(otp_id)` validado con `Number.isSafeInteger(·) && >0` (si no, fallo sin tocar DB); `findLiveOtpCodeById(id)`; `null` | `phone≠phone_number` | `code` vacío | `bcrypt.compare` falso = `{message:'PICKBAZAR_MESSAGE.INVALID_TOKEN',success:false}`; éxito = `{message:'success',success:true}`. NO consume.
- [x] 6.7 `otpLogin(dto)`: mismas validaciones de 6.6 + `findUserIdByProfileContact(phone_number)`; 0/>1 perfiles, usuario inactivo, o `consumeOtpCode(id)===0` → `throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE)` (mismo mensaje genérico de `login()`); consume ANTES de firmar; éxito → `findUserWithRelations` + `jwtService.signAsync({sub,email,permissions})` + `deriveRole(permissions)` → `{token,permissions,role}`. `name`/`email` del DTO se ignoran (comentario explícito, D2).
- [x] 6.8 Envolver cada llamada a `@safari/db` de los 6 métodos con `withPrismaErrorTranslation` (503 caída de Postgres / 500 otro error Prisma), igual que `login`/`changePassword`.

## Phase 7: PR#2 — Config y documentación

- [x] 7.1 `apps/api/rest/.env.example`: agregar `PASSWORD_RESET_TTL_MINUTES=60` y `OTP_CODE_TTL_MINUTES=10` tras el bloque de JWT (`:27-28`).
- [x] 7.2 `apps/README.md`: sección nueva antes de `## Verificación` (`:187`) — cómo leer el secreto del log (formato exacto de D5), las 2 variables de TTL y sus defaults, la purga manual (`purgeExpiredAuthTokens`, sin scheduler), y los caveats declarados R-2 (sin rate limiting) y V-3 (oráculo temporal de `forget-password`).

## Phase 8: Verificación PR#2 — evidencia 1:1 con la DoD de US-24

- [x] 8.1 `just build-api` limpio, salida pegada.
- [x] 8.2 (CA-1/CA-4) `curl` del flujo completo: `forget-password` (email existente) → token leído del log → `verify-forget-password-token` (200 success:true) → `reset-password` → `token` (login) con la contraseña nueva (200) y con la vieja (401), ambos pegados.
- [x] 8.3 (CA-4) `curl` del reintento con el mismo token ya consumido → `{success:false}` 200; y con un token vencido (ajustar `PASSWORD_RESET_TTL_MINUTES` o esperar) → `{success:false}` 200 — ninguno de los dos como excepción 4xx/5xx.
- [x] 8.4 (CA-2) Dos `curl` a `forget-password` pegados uno junto al otro: email inexistente vs. `admin@demo.com` — byte-idénticos; más `SELECT count(*) FROM password_reset_tokens` antes/después mostrando que solo el segundo insertó fila, y ausencia de log en el primero.
- [x] 8.5 (CA-5) Flujo OTP completo: `send-otp-code` (pegar `id` real, `provider:'log'`, `phone_number` eco, `is_contact_exist`) → `verify-otp-code` con código correcto (200 success:true) y con uno incorrecto (200 success:false) → `otp-login` con `'12365141641631'` y su código → JWT decodificado (`node -e`, `sub`/`email`/`permissions` de `store_owner@demo.com`) → reutilizar el mismo código → 401.
- [x] 8.6 (CA-5) `curl` de `otp-login` con el teléfono ambiguo `'19365141641631'` → 401 con el mismo mensaje genérico de `login()`.
- [x] 8.7 (D5) Salida real de log pegada mostrando la advertencia de "sin envío real" en la misma línea/bloque que el secreto, para `forget-password` y `send-otp-code`.
- [x] 8.8 (CA-6) Conteos 3/12/1200/198 sin cambio tras toda la corrida de `curl` (repetir el `SELECT` de 3.2 después de 8.2-8.6).
- [x] 8.9 `just db-check` verde con recuento pegado (regresión: PR#2 no rompe la suite de PR#1).

## Phase 9: Cierre

- [x] 9.1 Actualizar `Status` en `docs/product/19-autenticacion-autorizacion/24-recuperacion-password-otp.md` y la fila de US-24 en `docs/product/19-autenticacion-autorizacion/README.md`.
