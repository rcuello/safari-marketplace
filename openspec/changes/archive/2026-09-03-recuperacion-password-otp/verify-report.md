# Verification Report — 2026-09-03-recuperacion-password-otp (US-24)

**Change**: `2026-09-03-recuperacion-password-otp`
**Capability**: `password-recovery-otp` (11 requirements) + delta MODIFIED sobre `auth-jwt-api`
**Modo**: Standard (`strict_tdd: false`) · `artifact_store_mode: openspec` · `require_evidence: true`
**Fecha de verificación**: 2026-09-03
**Verificador**: `sdd-verify` (ejecución independiente; NO se copió ninguna cifra de `apply-progress.md`)

---

## 0. Cuestión prioritaria — HTTP 200 vs. 201: RESUELTA

**Veredicto: la implementación es CORRECTA; el SPEC estaba mal escrito y se corrigió.**

El spec exigía que los cinco métodos que devuelven `CoreResponse`/`OtpResponse`
respondieran «HTTP 200 con `success:false`». El estado real es **`201 Created`**.
Tres pruebas independientes:

1. **No existe `@HttpCode` en el controlador, ni antes ni ahora.**

```text
$ git show HEAD:apps/api/rest/src/auth/auth.controller.ts | grep -c HttpCode
0
$ git diff HEAD -- apps/api/rest/src/auth/auth.controller.ts
(salida vacía — el controlador no se tocó en este change)
```

El import de `@nestjs/common` en HEAD es exactamente
`import { Controller, Get, Post, Body } from '@nestjs/common';` — `HttpCode` ni
siquiera está importado. Las **13** rutas `@Post` del controlador (más 1 `@Get`)
toman por tanto el default de Nest, `201 Created`.

2. **`main.ts` no reescribe el status.** Solo `setGlobalPrefix('api')`,
   `ValidationPipe` y Swagger; ningún interceptor ni filtro global que altere
   códigos de estado.

3. **Comprobación en vivo** (servidor arrancado con `just api-dev` en el 9001):

```text
$ curl -s -D - -X POST http://localhost:9001/api/forget-password -d '{"email":"admin@demo.com"}'
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8
Content-Length: 55
```

Como el controlador es idéntico byte a byte al de HEAD y era el único punto donde
podía declararse el código de estado, **201 es también lo que devolvían los seis
stubs ANTES de este change**. CA-6 (contrato HTTP preservado byte a byte) exige
justamente 201; devolver 200 habría sido la regresión.

**Corrección aplicada** en
`openspec/changes/2026-09-03-recuperacion-password-otp/specs/password-recovery-otp/spec.md`:

- Requirement «Postura de errores — nunca lanzar, salvo otp-login»: «MUST responder
  HTTP 200 con `success:false`» → «MUST responder … con `success:false` en el cuerpo
  y con el MISMO código de estado que devolvía el stub del mock — **`201 Created`**,
  el default de Nest para `@Post`». Se añadió una nota de corrección fechada
  explicando por qué. **El requisito real se mantiene intacto: los fallos de dominio
  MUST NOT lanzar excepción.**
- Su scenario: «la respuesta es `200` con `{success:false}`» → «trae `{success:false}`
  con el mismo `201 Created` del stub, no un error 4xx/5xx».
- Scenario «Token de un solo uso» (línea 84): «(`token` viejo → 401, nuevo → 200)» →
  «(`POST /api/token` con la vieja → 401, con la nueva → `201 Created`…)». También era
  un 200 factualmente incorrecto: `login()` ya devolvía 201 desde US-22.

**Otras apariciones de «200» (reportadas, NO reescritas)** — son artefactos de
planificación que no se promueven a `openspec/specs/` al archivar, por lo que no
contaminan la fuente de verdad; se dejan como registro histórico de lo que se planeó:

| Archivo | Líneas | Texto |
|---|---|---|
| `design.md` | 33, 39, 43, 44, 48, 58 | Diagrama ASCII de flujo: `→ 200 {success:true,…}`, `→ 200 {success:false, INVALID_TOKEN}`, etc. |
| `proposal.md` | 135 | «`CoreResponse`/`OtpResponse` responden **HTTP 200 con `success:false`**» |
| `proposal.md` | 214 | «ambos `{success:false}` con **200**, no excepción» |

`specs/auth-jwt-api/spec.md` y el documento de US-24 no contienen ninguna
afirmación de «200». `apply-progress.md` ya reportaba el hallazgo con honestidad
(líneas 190-194, 286): no lo ocultó.

---

## 1. Completeness

| Métrica | Valor |
|---|---|
| Tareas totales | 44 |
| Tareas completas `[x]` | 44 |
| Tareas incompletas | 0 |

Las 9 fases de `tasks.md` están marcadas. Verificación por muestreo de las que se
pueden comprobar mecánicamente: 1.1-1.8 (8 funciones + 4 tipos existen y se exportan),
2.1-2.10 (12 `it()` en la suite nueva), 5.1-5.2 (`recovery-options.ts` existe con la
forma descrita), 6.1-6.8 (los 6 métodos reescritos), 7.1-7.2 (`.env.example` y
`apps/README.md`), 9.1 (docs). Ninguna tarea marcada resultó falsa.

---

## 2. Build & Tests — salida REAL

### 2.1 `just db-check` (test_command de `rules.verify`)

```text
$ just db-check
npm run typecheck

> @safari/db@0.1.0 typecheck
> tsc --noEmit

cd "$(pwd)" && npm test

> @safari/db@0.1.0 test
> vitest run


 RUN  v4.1.11 C:/DevOps/MyGitHub/safari-marketplace/packages/db

(node:43796) DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead.
(Use `node --trace-deprecation ...` to show where the warning was created)

 Test Files  8 passed (8)
      Tests  84 passed (84)
   Start at  14:47:00
   Duration  10.00s (transform 9.63s, setup 0ms, import 28.94s, tests 10.46s, environment 3ms)
```

✅ **84/84 en 8 archivos**, typecheck limpio. Coincide con lo que reportó el apply.

Los 12 tests nuevos de `auth-tokens.integration.test.ts`:

```text
describe('createPasswordResetToken / findLivePasswordResetTokens')
  it('invalida el token previo del mismo usuario en llamadas secuenciales')
  it('con dos filas vivas para el mismo usuario, devuelve las 2, la de id mayor primero (V-6)')
  it('vencimiento: con el reloj adelantado devuelve [], al restaurar vuelve a devolver 1')
describe('consumePasswordResetToken')
  it('un solo uso: consume -> 1, repetido -> 0; id inexistente -> 0')
describe('createOtpCode / findLiveOtpCodeById / consumeOtpCode')
  it('vivo, vencido y consumido')
describe('findUserIdByProfileContact')
  it("'12365141641631' (único, store_owner@demo.com, id 1) -> 1")
  it("'19365141641631' (dos perfiles, ids 3 y 2) -> null")
  it("'nadie' (ningún perfil) -> null")
describe('purgeExpiredAuthTokens')
  it('borra vencido y consumido, deja vivo (assert por id, nunca por conteo absoluto)')
describe('fuga de tipos')
  it('PasswordResetTokenSecret expone exactamente 5 claves; tokenHash es el valor pasado')
  it('OtpCodeSecret expone exactamente 5 claves; codeHash es el valor pasado')
```

### 2.2 `just build-api`

```text
$ just build-api
yarn build
yarn run v1.22.22
$ rimraf dist
$ nest build
(node:45304) [DEP0053] DeprecationWarning: The `util.isObject` API is deprecated. Please use `arg !== null && typeof arg === "object"` instead.
(Use `node --trace-deprecation ...` to show where the warning was created)
Done in 122.61s.
```

✅ Limpio (0 errores de TypeScript).

### 2.3 `just build` (build_command de `rules.verify`) — NO ejecutado

`rules.verify.build_command` es `just build` (Next.js de shop + admin). **No se
ejecutó a propósito**: este change no toca ni una línea de `apps/shop` ni de
`apps/admin` (probado en §5), y el justfile advierte que `just build` colisiona con
los `dev` que comparten `.next`. El build relevante al área tocada es `just build-api`,
que sí se ejecutó y está pegado arriba. **Dimensión omitida, declarada.**

### 2.4 Coverage

➖ No disponible: `coverage_command: ""` en `openspec/config.yaml`,
`coverage_threshold: 0`. Nada que comprobar.

### 2.5 `npm run lint` (biome) — fuera del gate, ejecutado igualmente

```text
Checked 29 files in 320ms. No fixes applied.
Found 17 errors.
```

16 de los 17 son errores `format` por CRLF, presentes en archivos **no tocados**
por este change (`src/records.ts`, `products.repository.ts`, `users.repository.ts`,
`shops.repository.ts`, todos los `*.integration.test.ts` previos…): ruido preexistente
de Windows, no una regresión. El **único hallazgo nuevo** es cosmético:

```text
src\repositories\auth-tokens.integration.test.ts:26:1 assist/source/organizeImports  FIXABLE
  × Sort these imports.
  i Safe fix: Organize imports and exports (Biome)
```

`npm run lint` NO forma parte de `just db-check` (que es typecheck + vitest), así que
no rompe ningún gate. Ver WARNING-1.

---

## 3. Evidencia de ejecución en vivo (los `curl` de la DoD, reproducidos)

Servidor arrancado con `just api-dev` en background (puerto **9001** — el 9000 lo
ocupa Zscaler), log capturado en el scratchpad, y **apagado limpiamente al terminar**
(ver §3.9). Todas las respuestas de abajo son salida real de esta sesión de verify,
no copias del apply.

### 3.0 Estado inicial

```text
users 3 | shops 12 | products 1200 | categories 198
password_reset_tokens 0 | otp_codes 0

Arranque: [Nest] LOG [NestApplication] Nest application successfully started
          Application is running on: http://[::1]:9001/api
$ curl -s -o /dev/null -w "%{http_code}" http://localhost:9001/api/settings
200
```

### 3.1 (CA-2) Las dos respuestas de `forget-password`, byte-idénticas

```text
--- count password_reset_tokens ANTES: 0

=== A) forget-password EMAIL INEXISTENTE ===
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8
Content-Length: 55
body: {"success":true,"message":"Password change successful"}
--- count password_reset_tokens tras inexistente: 0

=== B) forget-password admin@demo.com ===
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8
Content-Length: 55
body: {"success":true,"message":"Password change successful"}
--- count password_reset_tokens DESPUES: 1

=== cmp byte a byte ===
IDENTICOS (cmp exit 0)
=== md5 ===
eb7badb72b8dbe96d9da7b29a2055416 *ca2-nonexistent.body
eb7badb72b8dbe96d9da7b29a2055416 *ca2-existing.body
```

Y el log, desde una marca tomada justo antes de las dos llamadas — **una sola línea**,
la del email que sí existe:

```text
=== conteo de lineas 'forget-password' en el log desde la marca ===
1
[Nest] 2796  - 09/03/2026, 2:51:47 PM    WARN [AuthService] [forget-password] Implementación de desarrollo, SIN envío real de correo. Token en claro para admin@demo.com: 19c2aded2d949155483db265b2af238d2c28ef15afe991258f3310ee3b56df06 (expira 2026-09-03T20:51:47.022Z)
```

Mismo status, mismo `Content-Type`, mismo `Content-Length` (55), mismo md5, `cmp`
con exit 0. El inexistente no insertó fila (0 → 0) ni emitió log.

### 3.2 (CA-3/CA-6) `verify-forget-password-token` no consume y no lanza

```text
=== 1) token INEXISTENTE ===
{"success":false,"message":"PICKBAZAR_MESSAGE.INVALID_TOKEN"}
HTTP 201
=== 2) token VALIDO (1a vez) ===
{"success":true,"message":"Password change successful"}
HTTP 201
=== 3) verify repetido (NO consume) ===
{"success":true,"message":"Password change successful"}
HTTP 201
=== consumed_at tras los 2 verify ===
 id | user_id | consumed_at |         expires_at
----+---------+-------------+----------------------------
 64 |       3 |             | 2026-09-03 20:51:47.022+00
(1 row)
```

`expires_at` = 20:51:47Z contra una emisión a las 14:51:47 local (= 19:51:47Z):
**exactamente +60 minutos**, el TTL configurado.

### 3.3 (CA-1/CA-4) Flujo completo: reset, login con la nueva, 401 con la vieja, replay

```text
=== 4) reset-password (token valido) ===
{"success":true,"message":"Password change successful"}
HTTP 201

=== 5) login con la contrasena NUEVA ===
HTTP 201
permissions= ["super_admin","customer","store_owner"] | role= super_admin | jwt.len= 245

=== 6) login con la contrasena VIEJA (debe 401) ===
{"statusCode":401,"message":"Las credenciales no son válidas.","error":"Unauthorized"}
HTTP 401

=== 7) REPLAY: reset-password con el MISMO token ya consumido ===
{"success":false,"message":"PICKBAZAR_MESSAGE.INVALID_TOKEN"}
HTTP 201

=== 8) verify del token ya consumido ===
{"success":false,"message":"PICKBAZAR_MESSAGE.INVALID_TOKEN"}
HTTP 201

=== fila tras el consumo ===
 id | user_id | consumido
----+---------+-----------
 64 |       3 | t
(1 row)
```

### 3.4 (CA-1) Reemitir invalida el token vivo anterior

```text
=== 9) forget-password -> T1 ===   {"success":true,"message":"Password change successful"}
=== 10) forget-password -> T2 ===  {"success":true,"message":"Password change successful"}

[Nest] 2796 - 2:53:09 PM WARN [AuthService] [forget-password] … Token en claro para admin@demo.com: ec265e5e2db4562102866824cd16f620257489521d1eb93464bf75e5dbb529b1 (expira 2026-09-03T20:53:09.524Z)
[Nest] 2796 - 2:53:11 PM WARN [AuthService] [forget-password] … Token en claro para admin@demo.com: ac07d0c87ca179afae2e4b286158d02965bbde2c7a22ddeff79d77fe40545b2a (expira 2026-09-03T20:53:10.993Z)

 id | user_id | consumido |         expires_at
----+---------+-----------+----------------------------
 64 |       3 | t         | 2026-09-03 20:51:47.022+00
 65 |       3 | t         | 2026-09-03 20:53:09.524+00   <- T1, invalidado por la emisión de T2
 66 |       3 | f         | 2026-09-03 20:53:10.993+00   <- T2, el único vivo

=== 11a) verify T1 (invalidado) ===
{"success":false,"message":"PICKBAZAR_MESSAGE.INVALID_TOKEN"} | HTTP 201
=== 11b) verify T2 (vivo) ===
{"success":true,"message":"Password change successful"} | HTTP 201
```

### 3.5 (CA-4) Token VENCIDO: no verifica, es repetible, no lanza, no cambia nada

Vencimiento forzado moviendo `expires_at` de **la fila 66 solamente** (dato de prueba
creado en esta sesión; no se tocó ningún dato sembrado, y `just db-reset` no se usó):

```text
=== 12) update password_reset_tokens set expires_at = now() - interval '1 hour' where id = 66 ===
 id |          expires_at
----+-------------------------------
 66 | 2026-09-03 18:53:31.578304+00
UPDATE 1

=== 12a) verify T2 vencido (1a vez) ===
{"success":false,"message":"PICKBAZAR_MESSAGE.INVALID_TOKEN"} | HTTP 201
=== 12b) verify T2 vencido (2a vez, repetible) ===
{"success":false,"message":"PICKBAZAR_MESSAGE.INVALID_TOKEN"} | HTTP 201
=== 12c) reset-password con T2 vencido ===
{"success":false,"message":"PICKBAZAR_MESSAGE.INVALID_TOKEN"} | HTTP 201
=== 12d) la contrasena NO cambio ===
login con nuevaclave123      -> HTTP 201
login con noDeberiaAplicar1  -> HTTP 401
```

Ni el replay del token consumido (§3.3 paso 7) ni el token vencido produjeron una
excepción 4xx/5xx: los tres devolvieron `201` con `{success:false}`.

### 3.6 (CA-5) Flujo OTP completo

```text
=== 14) send-otp-code 12365141641631 (teléfono único) ===
{"message":"success","success":true,"id":"26","provider":"log","phone_number":"12365141641631","is_contact_exist":true} | HTTP 201
=== 14b) send-otp-code 00000000000000 (sin perfil) ===
{"message":"success","success":true,"id":"27","provider":"log","phone_number":"00000000000000","is_contact_exist":false} | HTTP 201
=== 14c) send-otp-code 19365141641631 (teléfono ambiguo) ===
{"message":"success","success":true,"id":"28","provider":"log","phone_number":"19365141641631","is_contact_exist":false} | HTTP 201

=== log ===
[Nest] 2796 - 2:54:14 PM WARN [AuthService] [send-otp-code] Implementación de desarrollo, SIN envío real de SMS. Código en claro para 12365141641631: 957759 (expira 2026-09-03T20:04:14.349Z)
[Nest] 2796 - 2:54:14 PM WARN [AuthService] [send-otp-code] Implementación de desarrollo, SIN envío real de SMS. Código en claro para 00000000000000: 702576 (expira 2026-09-03T20:04:14.707Z)
[Nest] 2796 - 2:54:15 PM WARN [AuthService] [send-otp-code] Implementación de desarrollo, SIN envío real de SMS. Código en claro para 19365141641631: 376601 (expira 2026-09-03T20:04:15.337Z)

=== filas otp_codes (el código va HASHEADO, nunca en claro) ===
 id |     phone      | code_prefix | code_len |         expires_at         | consumed_at
----+----------------+-------------+----------+----------------------------+-------------
 26 | 12365141641631 | $2a$10$     |       60 | 2026-09-03 20:04:14.349+00 |
 27 | 00000000000000 | $2a$10$     |       60 | 2026-09-03 20:04:14.707+00 |
 28 | 19365141641631 | $2a$10$     |       60 | 2026-09-03 20:04:15.337+00 |
```

`expires_at` a las 20:04:14Z sobre una emisión a las 14:54:14 local (= 19:54:14Z):
**+10 minutos exactos**. El `id` de la respuesta (`"26"`) es el id real de la fila.

```text
=== 15a) verify-otp-code CORRECTO ===
{"message":"success","success":true} | HTTP 201
=== 15b) verify-otp-code CODIGO INCORRECTO ===
{"message":"PICKBAZAR_MESSAGE.INVALID_TOKEN","success":false} | HTTP 201
=== 15c) verify-otp-code TELEFONO que no coincide ===
{"message":"PICKBAZAR_MESSAGE.INVALID_TOKEN","success":false} | HTTP 201
=== 15d) verify repetido (NO consume) ===
{"message":"success","success":true} | HTTP 201
=== consumed_at de la fila 26 ===
id=26 consumed_at is null -> true
```

**(CA-5) Teléfono ambiguo `'19365141641631'` → 401**, con el mismo mensaje genérico
de `login()`, y **sin quemar el código** (falla antes de consumir):

```text
=== 16) otp-login con 19365141641631 (id 28, código correcto) ===
{"statusCode":401,"message":"Las credenciales no son válidas.","error":"Unauthorized"} | HTTP 401
=== 16b) ===
id=28 consumed_at is null -> true
```

Los dos perfiles que lo hacen ambiguo:

```text
 user_id |    contact     |        email
---------+----------------+----------------------
       1 | 12365141641631 | store_owner@demo.com
       2 | 19365141641631 | customer@demo.com
       3 | 19365141641631 | admin@demo.com
```

**`otp-login` con el teléfono único → JWT real** (se mandaron `name` y `email` basura
en el body a propósito, para probar que se ignoran):

```text
=== 17) otp-login {"otp_id":"26","code":"957759","phone_number":"12365141641631","name":"IGNORADO","email":"atacante@evil.com"} ===
HTTP 201
{"token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjEsImVtYWlsIjoic3RvcmVfb3duZXJAZGVtby5jb20iLCJwZXJtaXNzaW9ucyI6WyJjdXN0b21lciIsInN0b3JlX293bmVyIl0sImlhdCI6MTc4ODQ2NTI5NiwiZXhwIjoxNzg5MDcwMDk2fQ.yBjNuHPavpFs4jFteblJ8i1Xkj-Mz0AII1ROiME-6kU","permissions":["customer","store_owner"],"role":"store_owner"}

=== 17b) JWT decodificado ===
header : {"alg":"HS256","typ":"JWT"}
payload: {"sub":1,"email":"store_owner@demo.com","permissions":["customer","store_owner"],"iat":1788465296,"exp":1789070096}
exp    : 2026-09-10T19:54:56.000Z
respuesta.permissions: ["customer","store_owner"] | role: store_owner

=== 17c) el JWT emitido sirve de verdad en /api/me ===
me.id= 1 | me.email= store_owner@demo.com
```

`email` en el JWT = `store_owner@demo.com`, **no** el `atacante@evil.com` del body:
la identidad salió del teléfono, como exige D2. `exp` a 7 días = `JWT_EXPIRES_IN=7d`.

**Reuso del mismo código → 401** (un solo uso):

```text
=== 18) otp-login repitiendo otp_id=26 / code=957759 ===
{"statusCode":401,"message":"Las credenciales no son válidas.","error":"Unauthorized"} | HTTP 401
=== 18b) ===
id=26 consumido -> true
=== 18c) verify-otp-code del código ya consumido ===
{"message":"PICKBAZAR_MESSAGE.INVALID_TOKEN","success":false} | HTTP 201
```

### 3.7 Delta `auth-jwt-api`: `socialLogin` sigue stub, `logout` sigue sin revocar

```text
=== 19) social-login-token ===
{"token":"jwt token","permissions":["super_admin","customer"],"role":"customer"} | HTTP 201

=== 19b) código del stub en HEAD vs. ahora ===
  async socialLogin(socialLoginDto: SocialLoginDto): Promise<AuthResponse> {
    console.log(socialLoginDto);
    return {
      token: 'jwt token',
      permissions: ['super_admin', 'customer'],
      role: 'customer',
    };
  }
--- actual ---
  async socialLogin(socialLoginDto: SocialLoginDto): Promise<AuthResponse> {
    console.log(socialLoginDto);
    return {
      token: 'jwt token',
      permissions: ['super_admin', 'customer'],
      role: 'customer',
    };
  }

=== 20) logout no revoca: login -> logout -> /me con el MISMO token ===
true | logout HTTP 201
/me tras logout -> HTTP 200
```

Bloque de código idéntico carácter a carácter entre HEAD y el árbol de trabajo, y
respuesta fija idéntica. `logout` devuelve `true` y el token sigue sirviendo en `/me`.

### 3.8 (CA-6) Postura de errores en los casos borde restantes

```text
=== 21) send-otp-code con phone_number vacío ===
{"message":"PICKBAZAR_MESSAGE.REQUIRED_INFO_MISSING","success":false,"id":"","provider":"log","phone_number":"","is_contact_exist":false} | HTTP 201
=== 22) verify-forget-password-token con body vacío {} ===
{"success":false,"message":"PICKBAZAR_MESSAGE.INVALID_TOKEN"} | HTTP 201
=== 23) reset-password con body vacío {} ===
{"success":false,"message":"PICKBAZAR_MESSAGE.INVALID_TOKEN"} | HTTP 201
=== 24) verify-otp-code con otp_id no numérico ===
{"message":"PICKBAZAR_MESSAGE.INVALID_TOKEN","success":false} | HTTP 201
```

Cero excepciones 4xx/5xx en los cinco métodos `CoreResponse`/`OtpResponse`.

### 3.9 Apagado limpio del servidor

```text
$ netstat -ano | grep ":9001.*LISTENING"  -> PID 2796
$ taskkill //PID 2796 //T //F
SUCCESS: The process with PID 2796 (child process of PID 44868) has been terminated.
$ netstat -ano | grep ":9001.*LISTENING"
(libre)
$ curl -s -m 5 -o /dev/null -w "%{http_code}" http://localhost:9001/api/settings
000  (sin respuesta: servidor apagado)
$ tasklist //FI "PID eq 44868"
INFO: No tasks are running which match the specified criteria.
```

El proceso `just api-dev` y su árbol (incluido el watcher de `nest --watch`) están
terminados. No quedó nada escuchando en el 9001.

---

## 4. TTL configurables (Requirement 8) — evidencia de runtime

El `.env` real trae `PASSWORD_RESET_TTL_MINUTES=60` y `OTP_CODE_TTL_MINUTES=10`, así
que los `curl` de §3 ejercitan los valores configurados, no los defaults. Para probar
el scenario «arranque sin las variables usa los defaults» se ejecutó el módulo
compilado directamente:

```text
$ ls dist/auth/recovery-options.js
dist/auth/recovery-options.js

=== A) SIN las variables -> defaults 60/10, sin throw ===
env PASSWORD_RESET_TTL_MINUTES = undefined
env OTP_CODE_TTL_MINUTES        = undefined
resolveRecoveryOptions() -> {"passwordResetTtlMinutes":60,"otpCodeTtlMinutes":10}
memoizada (misma referencia) -> true

=== B) valores MALFORMADOS -> warn + default, sin throw ===
[Nest] 21704 - 3:00:11 PM WARN [recovery-options] PASSWORD_RESET_TTL_MINUTES="10min" no es un entero de minutos válido; se usa 60.
[Nest] 21704 - 3:00:11 PM WARN [recovery-options] OTP_CODE_TTL_MINUTES="-5" no es un entero de minutos válido; se usa 10.
resolveRecoveryOptions() -> {"passwordResetTtlMinutes":60,"otpCodeTtlMinutes":10}

=== C) valores VALIDOS -> se respetan ===
resolveRecoveryOptions() -> {"passwordResetTtlMinutes":15,"otpCodeTtlMinutes":3}

=== D) los únicos call sites están DENTRO de handlers, no en tope de módulo ===
src/auth/auth.service.ts:46:import { resolveRecoveryOptions } from './recovery-options';
src/auth/auth.service.ts:276:    const { passwordResetTtlMinutes } = resolveRecoveryOptions();   <- forgetPassword
src/auth/auth.service.ts:490:    const { otpCodeTtlMinutes } = resolveRecoveryOptions();         <- sendOtpCode
```

Lectura diferida y memoizada confirmada; ausencia o malformación de las variables
produce `warn` + default y nunca `throw`, así que no puede bloquear el arranque.
El arranque real de §3.0 (con las variables presentes) también fue exitoso.

---

## 5. Purga (Requirement 11) — evidencia de runtime

Además del test de vitest, se ejecutó la purga en vivo contra `dist/` de `@safari/db`
(sirvió también para limpiar las filas que generó esta verificación):

```text
=== filas ANTES de purgar ===
 id |  t  | consumido | vencido
----+-----+-----------+---------
 26 | otp | t         | f
 27 | otp | f         | f
 28 | otp | f         | f
 64 | prt | t         | f
 65 | prt | t         | f
 66 | prt | t         | t
 67 | prt | t         | f
(7 rows)

=== purgeExpiredAuthTokens() ===
borradas -> {"passwordResetTokens":4,"otpCodes":1}

=== filas DESPUES ===
 id |  t  | consumido | vencido
----+-----+-----------+---------
 27 | otp | f         | f
 28 | otp | f         | f
(2 rows)
```

Borró las 4 filas de `password_reset_tokens` (consumidas/vencidas) y la única
`otp_codes` consumida; **dejó intactas las 2 filas vivas**. Assert por id, coherente
con el test.

---

## 6. Conteos sembrados 3/12/1200/198

`just db-check` no ejercita `orders` (esa tabla no existe en `db/schema.sql`); los
cuatro conteos fijados por `identity-data-layer:186` son `users` 3, `shops` 12,
`products` 1200, `categories` 198.

| Momento | users | shops | products | categories |
|---|---|---|---|---|
| Antes de `just db-check` | 3 | 12 | 1200 | 198 |
| Después de `just db-check` | 3 | 12 | 1200 | 198 |
| Después de TODA la corrida de `curl` + purga | 3 | 12 | 1200 | 198 |

✅ **Sin cambio.** `profiles` (3) y `permissions` (4) tampoco cambiaron.
Estado final de las tablas de esta US: `password_reset_tokens` 0,
`otp_codes` 2 (dos códigos vivos de §3.6 que vencen solos a los 10 min).

### 6.1 Restauración de la credencial demo (obligatoria)

La verificación cambió la contraseña de `admin@demo.com` a `nuevaclave123` para
probar CA-4. **Se restauró a `demodemo` usando el propio flujo de reset, NO una
edición directa de la base** y **sin `just db-reset`** (prohibido):

```text
=== 13) forget-password -> T3 ===
{"success":true,"message":"Password change successful"}
T3=1fa09c5852eadfc5f98ca884b9e1664d3c46d45716e48accf5daa4773239a238   (leído del log)

=== 13a) reset-password de vuelta a 'demodemo' ===
{"success":true,"message":"Password change successful"} | HTTP 201

=== 13b) login con la credencial demo ORIGINAL ===
demodemo      -> HTTP 201
nuevaclave123 -> HTTP 401
```

Nota informativa: el `password_hash` almacenado de `admin@demo.com` es ahora
`$2a$10$…` (bcryptjs) en vez del literal `$2b$10$j/.1t7…` de `db/seed.sql:51`. Es
inevitable al restaurar por el flujo de reset (salt aleatorio) y es la única vía
permitida. La **credencial funcional** (`demodemo`) quedó idéntica y verificada por
login. `customer@demo.com` ya estaba en `$2a$` antes de esta sesión (deriva de una
corrida previa, no introducida aquí). `just db-up` restauraría el literal si algún
día hiciera falta.

---

## 7. Trazabilidad — `password-recovery-otp` (11 requirements)

| # | Requirement | Veredicto | Evidencia |
|---|---|---|---|
| 1 | Generación y persistencia hasheada del token de recuperación | ✅ **MET** | §3.1 (fila insertada 0→1), §3.4 (fila 65 queda `consumido=t` al emitir T2; T2 con `expires_at` futuro; T1 deja de verificar y T2 verifica), §3.2 (`expires_at` = +60 min exactos). El claro solo existe en el log (§3.1/§3.4) y el hash en base es `$2a$10$…` len 60 (§3.6, análogo). `$transaction([updateMany, create])` como array en `auth-tokens.repository.ts:129-141`. Tipos `PasswordResetTokenSecret`/`OtpCodeSecret` declarados en `auth-tokens.repository.ts:40-55`, **no** en `records.ts` (grep vacío, §8). `bcrypt` solo en `auth.service.ts` (§8). Tests: `invalida el token previo…`, `fuga de tipos…` (84/84 verdes). |
| 2 | `forget-password` es indistinguible ante email inexistente | ✅ **MET** | §3.1: `cmp` exit 0, md5 idéntico, mismo `201` y `Content-Length: 55`; conteo 0→0 en el inexistente y 0→1 en el existente; **1 sola** línea de log desde la marca. |
| 3 | Verificación de token no consume | ✅ **MET** | §3.2 (verify ×2 → `success:true` ×2 con `consumed_at` NULL en la fila 64), §3.5 (token vencido: verify ×2 → `success:false` ×2 — el scenario literal), §3.4 (T1 invalidado → `success:false`). |
| 4 | Restablecer consume el token con UPDATE condicional | ✅ **MET** | §3.3: reset → `success:true`; replay del mismo token → `201 {success:false}`; fila 64 `consumido=t`; contraseña vieja → 401, nueva → 201. UPDATE condicional `updateMany({where:{id, consumedAt:null}}).count` en `auth-tokens.repository.ts:168-174` (nunca `update()`), consumo ANTES del cambio de hash (`auth.service.ts:360-372`). Test `un solo uso: consume -> 1, repetido -> 0; id inexistente -> 0` verde. *Nota*: la exclusión mutua ante dos peticiones **realmente concurrentes** se apoya en la atomicidad del UPDATE condicional y en el `count`; se probó de forma secuencial (1→0), no con una carrera real. Es la garantía estándar del patrón, no una laguna de implementación. |
| 5 | Generación y persistencia del código OTP | ✅ **MET** | §3.6: tres filas con el `phone` recibido y `expires_at` +10 min; `id` de la respuesta = id real de la fila (`"26"`); `provider:"log"` constante; `phone_number` eco literal (incl. `00000000000000`); `is_contact_exist` = `true` para el teléfono único y `false` para el inexistente y para el ambiguo — exactamente `findUserIdByProfileContact(phone) !== null`, como prescribe el requirement (ver SUGGESTION-1). Código de 6 dígitos con `padStart` (`auth.service.ts:493`), guardado hasheado (`$2a$10$`, len 60). |
| 6 | Verificación de OTP valida código y teléfono sin consumir | ✅ **MET** | §3.6 pasos 15a-15d: correcto → `success:true`; código distinto → `success:false` **y ningún token emitido** (el scenario literal); teléfono no coincidente → `success:false`; repetición → `success:true` con `consumed_at` NULL. §3.6 18c: código ya consumido → `success:false`. |
| 7 | `otp-login` resuelve identidad por teléfono y emite JWT real | ✅ **MET** | §3.6 pasos 16-18: ambiguo `'19365141641631'` → **401** con el mensaje genérico y sin consumir; único `'12365141641631'` → **201** con JWT decodificado `{"sub":1,"email":"store_owner@demo.com","permissions":["customer","store_owner"]}` y `role:"store_owner"`; `name`/`email` basura del body ignorados; el JWT funciona en `/api/me` (id 1); reuso del mismo código → **401** con la fila 26 consumida. Consumo antes de firmar (`auth.service.ts:430-436`). Tests `findUserIdByProfileContact` (3) verdes. |
| 8 | TTL configurables con default embebido, sin bloqueo de arranque | ✅ **MET** | §4: sin variables → `{60,10}` y memoizado; malformadas → `warn` + default sin `throw`; válidas → se respetan; los únicos call sites están dentro de `forgetPassword`/`sendOtpCode` (líneas 276 y 490), ninguno en tope de módulo, así que el arranque no puede fallar por ellas. §3.2/§3.6 confirman el vencimiento a +60 y +10 min. |
| 9 | Advertencia de "sin envío real" adjunta a cada secreto logueado | ✅ **MET** | §3.1 y §3.4 (`[forget-password] Implementación de desarrollo, SIN envío real de correo. Token en claro para …`) y §3.6 (`[send-otp-code] … SIN envío real de SMS. Código en claro para …`). Advertencia y secreto en **la misma línea** (una sola llamada `logger.warn`, `auth.service.ts:286-289` y `506-509`). |
| 10 | Postura de errores — nunca lanzar, salvo `otp-login` | ✅ **MET** *(con el spec corregido — §0)* | §3.2, §3.3 (7 y 8), §3.5, §3.8: los cinco métodos devuelven `201` + `{success:false}` en 10 casos de fallo distintos (token inexistente, vacío, invalidado, vencido, consumido; código incorrecto, teléfono no coincidente, `otp_id` no numérico, `phone_number` vacío, body `{}`), **cero excepciones 4xx/5xx**. `otpLogin` lanza `UnauthorizedException` con `"Las credenciales no son válidas."` — el mismo literal de `login()` (§3.3 paso 6 vs. §3.6 pasos 16/18). `withPrismaErrorTranslation` envuelve **las 15** llamadas a `@safari/db` de los 6 métodos (recuento verificado: 15 invocaciones dentro de los 6 cuerpos, 20 envolturas en el archivo completo contando `login`/`register`/`changePassword`/`me`). |
| 11 | Purga de tokens y códigos vencidos o consumidos | ✅ **MET** | §5: `purgeExpiredAuthTokens()` en vivo borró 4 + 1 filas vencidas/consumidas y dejó las 2 vivas intactas. Test `borra vencido y consumido, deja vivo (assert por id…)` verde. |

**Resumen de cumplimiento: 11/11 MET, 0 PARTIAL, 0 NOT MET.**

## 7.1 Trazabilidad — delta MODIFIED de `auth-jwt-api`

| Elemento | Veredicto | Evidencia |
|---|---|---|
| Requirement estrechado a `socialLogin` (los otros 6 stubs pasan a mecanismo real) | ✅ **MET** | Los 6 métodos son reales (§3.1-§3.6); el delta refleja el hecho. |
| Scenario: `socialLogin` sigue siendo un stub declarado | ✅ **MET** | §3.7: bloque de código **idéntico carácter a carácter** entre `git show HEAD:` y el árbol actual; respuesta en vivo `{"token":"jwt token","permissions":["super_admin","customer"],"role":"customer"}`, la fija de siempre. |
| Scenario: Logout no revoca nada | ✅ **MET** | §3.7: `POST /api/logout` → `true`; el mismo JWT sigue devolviendo `200` en `GET /api/me` después. El método `logout()` vive en el controlador, que no se tocó. |
| Nota de alcance: `identity-data-layer` no cambia; sin dependencia nueva de hashing | ✅ **MET** | §8: `packages/db/package.json` con las mismas 4 dependencias; ninguna de sus 7 funciones públicas cambió de firma (el diff de `packages/db/index.ts` solo **añade** un bloque de exports). |

---

## 8. Verificación de las afirmaciones del apply que son fáciles de exagerar

| Afirmación | Veredicto | Evidencia |
|---|---|---|
| No hay `@ts-ignore` / `as any` en el diff | ✅ **Cierta** | `git diff HEAD \| grep -nE "ts-ignore\|ts-expect-error\|as any\|@ts-nocheck"` → exit 1 (0 coincidencias). Mismo grep sobre los 3 archivos nuevos → exit 1. *Matiz honesto*: `auth.service.ts` sí contiene `matchedId as number` (línea 361) y `as unknown as User` (línea 140) — **ambos preexistentes o no-`any`**: el segundo viene de US-22 (fuera del diff de esta US) y el primero es un `as number` sobre una variable ya probada no-`undefined`, no una supresión de tipo. Ningún `as any`. |
| `packages/db/package.json` no declara dependencia de hashing | ✅ **Cierta** | `dependencies`: `@prisma/adapter-pg`, `@prisma/client`, `dotenv`, `prisma` — las mismas 4. `devDependencies`: biome, tsup, typescript, vitest. Sin `bcrypt`/`bcryptjs`/`argon2`. `git status` no lista `packages/db/package.json` como modificado. |
| `grep -rn "bcrypt" packages/db/src` vacío | ⚠️ **Matizada, ya reportada por el apply** | Devuelve 2 líneas, ambas **preexistentes** en `users.integration.test.ts:72,87` (comentarios de US-21/US-22, archivo fuera de alcance). El criterio real de la DoD (no ganar dependencia de hashing) se cumple vía `package.json`. El apply lo reportó en su sección "Hallazgo, no acción". |
| `auth.controller.ts` intacto | ✅ **Cierta** | No aparece en `git status`; `git diff HEAD -- …/auth.controller.ts` vacío. |
| `dto/create-auth.dto.ts` intacto | ✅ **Cierta** | No aparece en `git status`. |
| `db/schema.sql` y `db/seed.sql` intactos | ✅ **Cierta** | No aparecen en `git status`. |
| `packages/db/prisma/schema.prisma` intacto | ✅ **Cierta** | No aparece en `git status`. |
| `apps/shop` y `apps/admin` intactos | ✅ **Cierta** | `git status --porcelain` completo lista solo 6 modificados (`apps/README.md`, `apps/api/rest/.env.example`, `apps/api/rest/src/auth/auth.service.ts`, los 2 docs de producto, `packages/db/index.ts`) y 4 sin seguimiento (`recovery-options.ts`, la carpeta del change, y los 2 de `auth-tokens.*`). Ni un archivo de `apps/shop`/`apps/admin`. |
| El claro nunca cruza a `packages/db` | ✅ **Cierta** | Las 4 entradas del repositorio solo aceptan `tokenHash`/`codeHash` ya calculados (`auth-tokens.repository.ts:57-69`); los tipos de salida exponen `tokenHash`/`codeHash`, nunca el claro (test `fuga de tipos` verde). `grep -rn "bcrypt" apps/api/rest/src` → **solo `auth.service.ts`**. Los tipos NO están en `records.ts` (grep vacío). |
| El claro nunca aparece en un body HTTP | ✅ **Cierta** | `forget-password` devuelve solo `{success,message}` (§3.1); `send-otp-code` devuelve `{message,success,id,provider,phone_number,is_contact_exist}` — **sin el código** (§3.6). Los secretos solo aparecen en el log del proceso. |
| Status de US-24 y fila del épico actualizados en el formato de US-22/US-23 | ✅ **Cierta** | `**Status:** ✅ Implementada` en `24-recuperacion-password-otp.md:9`, idéntico a `22-login-jwt-postgres.md:9` y `23-guards-autorizacion-api.md:10`. Fila del épico: `… \| ~300 \| ✅ Implementada \|`, misma forma que las de US-20…US-23. Los 6 checkboxes de la DoD pasaron a `[x]`. |
| `apps/README.md` documenta log, TTL, purga y caveats R-2/V-3 | ✅ **Cierta** | Sección nueva de 49 líneas antes de `## Verificación`, con las 4 subsecciones exigidas por la tarea 7.2. |
| `.env.example` con las 2 variables tras el bloque JWT | ✅ **Cierta** | `PASSWORD_RESET_TTL_MINUTES=60` y `OTP_CODE_TTL_MINUTES=10` al final, tras `JWT_EXPIRES_IN=7d`. |

---

## 9. Coherencia con `design.md`

| Decisión | ¿Seguida? | Nota |
|---|---|---|
| C — `$transaction` como **array**, nunca nested write | ✅ Sí | `auth-tokens.repository.ts:129-141`. |
| C — `updateMany` + `count`, nunca `update()` (evita P2025) | ✅ Sí | `:168-174` y `:204-210`; probado 1→0 en vitest y por replay en vivo. |
| D — bucle `for…of` secuencial con corte a la primera coincidencia, nunca `Promise.all` | ✅ Sí | `auth.service.ts:317-321` y `:350-355`. |
| D2 — identidad SOLO por teléfono; `name`/`email` ignorados; nunca crea cuentas | ✅ Sí | Probado en vivo (§3.6 paso 17, con body hostil). |
| D5 — advertencia en la MISMA emisión que el secreto | ✅ Sí | Una sola llamada `logger.warn` por secreto (§3.1, §3.6). |
| D6 — `otpLogin` lanza; los otros cinco no lanzan | ✅ Sí | §3.8 (10 fallos de dominio sin excepción) y §3.6 (401 en `otp-login`). |
| E — `role` derivado por precedencia | ✅ Sí | `super_admin` para admin, `store_owner` para el usuario 1 (§3.3, §3.6). |
| F — `recovery-options.ts` memoizado, lectura diferida, nunca `throw` | ✅ Sí | §4. |
| V-3 — oráculo temporal de `forget-password` declarado, no mitigado | ✅ Sí | Documentado en `apps/README.md`; no se intentó nivelar la latencia. |
| V-5 — `padStart(6,'0')` preserva ceros a la izquierda | ✅ Sí | `auth.service.ts:493` (`randomInt(0,1e6)`, no `randomInt(1e5,1e6)`). |
| V-6 — el consumidor tolera N≥0 filas vivas | ✅ Sí | `findLivePasswordResetTokens` devuelve array; test dedicado verde. |
| Desviación cosmética declarada por el apply (evitar el literal `bcrypt` en comentarios de `packages/db`) | ✅ Aceptable | No cambia comportamiento, tipos ni firmas. |

---

## 10. Issues

### CRITICAL
Ninguno.

### WARNING

- **WARNING-1 — `npm run lint` (biome) marca `organizeImports` en el test nuevo.**
  `src/repositories/auth-tokens.integration.test.ts:26` — «Sort these imports»
  (FIXABLE, safe fix). Es el único hallazgo de lint atribuible a este change; los
  otros 16 son errores de `format` por CRLF preexistentes en archivos no tocados.
  **No bloquea**: `just db-check` (el gate configurado) es typecheck + vitest y no
  incluye lint. No se corrigió porque este agente no modifica código de
  implementación. Coste de arreglo: `npm run format` en `packages/db` — que también
  reformatearía los 16 archivos preexistentes, así que conviene hacerlo en un commit
  de estilo aparte, no dentro de US-24.

- **WARNING-2 — `rules.verify.build_command` (`just build`) no se ejecutó.**
  Es el build de Next.js de shop + admin, y este change no toca ninguno de los dos
  (probado en §8). El build del área tocada (`just build-api`) sí corrió y está
  limpio. Dimensión omitida a conciencia, no un fallo encontrado.

- **WARNING-3 — el `password_hash` de `admin@demo.com` ya no es el literal del seed.**
  La restauración de la credencial se hizo por el flujo de reset (única vía
  permitida: `just db-reset` está prohibido y una edición directa también), y bcrypt
  genera salt aleatorio. La **credencial funcional `demodemo` está intacta y
  verificada por login** (§6.1). Solo importa si algún día alguien compara el hash
  con `db/seed.sql:51`; `just db-up` lo restauraría.

### SUGGESTION

- **SUGGESTION-1 — semántica de `is_contact_exist` con teléfono ambiguo.**
  `send-otp-code` con `'19365141641631'` devuelve `is_contact_exist:false` aunque
  **dos** perfiles tengan ese contacto (§3.6). Es exactamente lo que el requirement
  prescribe (`findUserIdByProfileContact(phone) !== null`, que devuelve `null` para
  N≠1), así que la implementación es correcta; pero la clave se llama
  «exist», no «resuelve a un único usuario». Coherente con que `otp-login` fallaría
  igual, y probablemente lo deseable. Se anota para que quede en el registro, no como
  defecto a corregir en esta US.

- **SUGGESTION-2 — la exclusión mutua concurrente no se probó con una carrera real.**
  Requirement 4 dice «ante dos `reset-password` concurrentes … como máximo uno tenga
  éxito». Se probó la semántica secuencial (consume→1, repetir→0) y el mecanismo es
  el UPDATE condicional atómico estándar. Un test de dos peticiones simultáneas sería
  la prueba directa; no es imprescindible y añadiría flakiness.

- **SUGGESTION-3 — `design.md:33-58` y `proposal.md:135,214` siguen diciendo «200».**
  No se reescribieron (§0): son artefactos de planificación que no se promueven a
  `openspec/specs/` al archivar. Si se prefiere un registro totalmente coherente, el
  cambio es de una línea en cada punto.

---

## 11. Veredicto

### ✅ PASS WITH WARNINGS

Las 11 requirements de `password-recovery-otp` y las 3 del delta de `auth-jwt-api`
están MET con evidencia de ejecución real reproducida de forma independiente:
`just db-check` 84/84 verde, `just build-api` limpio, los flujos de recuperación y
OTP ejercitados de punta a punta contra Postgres, JWT decodificado y validado en
`/api/me`, purga en vivo, conteos sembrados 3/12/1200/198 sin cambio y credencial
demo restaurada por el propio flujo de reset. Las 44 tareas están completas y ninguna
resultó falsa al muestrearla.

Los tres WARNING son de higiene (un `organizeImports` fixable, un build no aplicable
al área tocada y el hash re-generado de la credencial demo), no de comportamiento.
La única discrepancia real entre spec e implementación —el «HTTP 200»— se resolvió a
favor de la implementación y **el spec quedó corregido antes de archivar**, que era
justamente el riesgo a evitar.

**Listo para `sdd-archive`.**

---

## 12. Cambios hechos por este agente de verify

| Archivo | Cambio |
|---|---|
| `openspec/changes/2026-09-03-recuperacion-password-otp/specs/password-recovery-otp/spec.md` | Corrección `200` → `201 Created` en el Requirement «Postura de errores», su scenario y el scenario «Token de un solo uso», + nota de corrección fechada. El requisito de fondo (no lanzar) intacto. |
| `openspec/changes/2026-09-03-recuperacion-password-otp/verify-report.md` | Este documento. |

Ningún código de implementación fue modificado. `just db-reset` no se ejecutó.
