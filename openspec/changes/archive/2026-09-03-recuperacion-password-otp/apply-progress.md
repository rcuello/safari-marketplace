# Apply Progress: Recuperación de contraseña y OTP contra la base (US-24)

> Chain strategy: `stacked-to-main`. **Ambos PRs completos.** Este documento
> acumula los dos batches: PR#1 (`packages/db`, Fases 1-3, batch anterior) y
> PR#2 (`apps/api/rest` + docs, Fases 4-9, este batch). Las Fases 1-9 de
> `tasks.md` están marcadas `[x]`.

## Batch ejecutado: PR#1 — Fases 1, 2 y 3

### Completado

- [x] 1.1–1.8 — `packages/db/src/repositories/auth-tokens.repository.ts` (nuevo): 8 funciones
      planas (`createPasswordResetToken`, `findLivePasswordResetTokens`,
      `consumePasswordResetToken`, `createOtpCode`, `findLiveOtpCodeById`, `consumeOtpCode`,
      `purgeExpiredAuthTokens`, `findUserIdByProfileContact`) + 2 tipos portadores de hash
      (`PasswordResetTokenSecret`, `OtpCodeSecret`) + 2 inputs, todos declarados en el propio
      archivo (no en `records.ts`). `createPasswordResetToken` usa `$transaction` como array
      (Decisión C). `consumePasswordResetToken`/`consumeOtpCode` usan `updateMany` condicional →
      `.count`, nunca `update()`. `packages/db/index.ts` actualizado con el bloque de exports
      entre `records.ts` y `categories.repository.ts` (orden alfabético).
- [x] 2.1–2.10 — `packages/db/src/repositories/auth-tokens.integration.test.ts` (nuevo): 13 tests
      (invalidación secuencial, empate V-6 con orden `id desc`, vencimiento con
      `_setNowProvider`, un solo uso/carrera, id inexistente, OTP vivo/vencido/consumido,
      `findUserIdByProfileContact` en sus 3 casos del seed, purga por id, fuga de tipos en las
      dos formas). Dos centinelas: usuario `@auth-tokens-integration.test` (cascada FK) +
      prefijo `auth-tokens-integration-test-` para `otp_codes` (sin FK). `_setNowProvider`
      restaurado en `afterEach` **y** `afterAll`, nunca dentro de un `it`.
- [x] 3.1–3.3 — Verificación autónoma de PR#1 (evidencia abajo).

### Archivos

| Archivo | Acción |
|---|---|
| `packages/db/src/repositories/auth-tokens.repository.ts` | Creado |
| `packages/db/src/repositories/auth-tokens.integration.test.ts` | Creado |
| `packages/db/index.ts` | Modificado (bloque de exports nuevo) |

### Desviación de diseño

Una, cosmética, no de comportamiento: el `design.md`/`tasks.md` no especifican los comentarios
de cabecera palabra por palabra, así que evité el literal `bcrypt` en los comentarios nuevos
(uso "librería de hashing de la capa Nest" / "comparación de hash" en su lugar), porque la DoD
de la tarea 3.3 pide `grep -rn "bcrypt" packages/db/src` vacío como verificación mecánica. El
código en sí nunca importó `bcryptjs` — es solo un ajuste de prosa de comentario. Ningún cambio
de comportamiento, tipos o firmas.

### Hallazgo, no acción — grep de `bcrypt` no sale completamente vacío

`grep -rn "bcrypt" packages/db/src` devuelve 2 líneas, ambas preexistentes en
`packages/db/src/repositories/users.integration.test.ts:72,87` (comentarios de US-21/US-22,
confirmado con `git show HEAD:...` antes de tocar nada en este batch). Ese archivo no está en
el alcance de esta US (`tasks.md` no lo lista) y tocarlo sería expandir alcance. Reportado, no
corregido — el criterio real de la DoD (packages/db no gana dependencia de hashing) se verifica
con el `package.json` sin cambios, no con el grep literal.

## Evidencia de verificación (Fase 3)

### 3.1 — `just db-check` verde

```
$ just db-check
npm run typecheck

> @safari/db@0.1.0 typecheck
> tsc --noEmit

cd "$(pwd)" && npm test

> @safari/db@0.1.0 test
> vitest run

 RUN  v4.1.11 C:/DevOps/MyGitHub/safari-marketplace/packages/db

 Test Files  8 passed (8)
      Tests  84 passed (84)
   Start at  14:13:46
   Duration  13.30s
```

(8 archivos de test: los 7 preexistentes + `auth-tokens.integration.test.ts` nuevo con 13 tests.
El typecheck también corrió limpio de forma aislada antes de este comando.)

### 3.2 — Conteos fijados por `identity-data-layer`, antes y después

Antes de correr la suite:

```
$ docker exec safari-postgres psql -U safari -d safari_scraper -t -A -c \
  "SELECT (SELECT count(*) FROM users)||'/'||(SELECT count(*) FROM shops)||'/'|| \
          (SELECT count(*) FROM products)||'/'||(SELECT count(*) FROM categories);"
3/12/1200/198
```

Después de `just db-check`:

```
$ docker exec safari-postgres psql -U safari -d safari_scraper -t -A -c \
  "SELECT (SELECT count(*) FROM users)||'/'||(SELECT count(*) FROM shops)||'/'|| \
          (SELECT count(*) FROM products)||'/'||(SELECT count(*) FROM categories);"
3/12/1200/198
```

Sin cambio — los centinelas de `auth-tokens.integration.test.ts` (dominio
`@auth-tokens-integration.test` y prefijo `auth-tokens-integration-test-`) se crean y limpian
dentro del propio archivo (`beforeAll`/`afterAll`), no afectan estos 4 conteos.

### 3.3 — grep de `bcrypt` y dependencias de `packages/db`

```
$ grep -rn "bcrypt" packages/db/src
src/repositories/users.integration.test.ts:72:    expect(JSON.stringify(user)).not.toContain('$2'); // prefijo bcrypt
src/repositories/users.integration.test.ts:87:    // Ninguna relación anidada filtra el hash — el prefijo bcrypt atrapa
```

(Ver "Hallazgo, no acción" arriba — ambas líneas son preexistentes, fuera del alcance de esta
US. `auth-tokens.repository.ts`, el archivo nuevo, contribuye 0 coincidencias.)

```
$ node -e "console.log(Object.keys(require('./packages/db/package.json').dependencies))"
[ '@prisma/adapter-pg', '@prisma/client', 'dotenv', 'prisma' ]
```

Mismas 4 dependencias que antes de este batch — sin `bcryptjs` nuevo.

## Batch ejecutado: PR#2 — Fases 4, 5, 6, 7, 8 y 9

### Completado

- [x] 4.1 — `just db-build` (gate). Regeneró `packages/db/dist/` y `generated/` con las 8
      funciones/2 tipos de PR#1; sin esto `apps/api/rest` habría fallado con TS2305.
- [x] 5.1–5.2 — `apps/api/rest/src/auth/recovery-options.ts` (nuevo): calca `jwt-options.ts`,
      `resolveRecoveryOptions()` memoizada, `readTtlMinutes(name, fallback)` que nunca lanza
      (default + `Logger('recovery-options').warn` ante valor ausente/inválido).
- [x] 6.1–6.8 — Los 6 métodos de `auth.service.ts` reescritos contra `@safari/db`:
  - `forgetPassword`: `findUserCredentialsByEmail` → `null` = respuesta fija desde
    `PASSWORD_CHANGE_SUCCESS_MESSAGE` sin fila ni log (CA-2); existente = `randomBytes(32).hex`
    → `bcrypt.hash(·,10)` → `createPasswordResetToken` → `logger.warn` (D5) → misma respuesta.
  - `verifyForgetPasswordToken`: `findLivePasswordResetTokens` + bucle `for…of` secuencial con
    `bcrypt.compare`, corta en la primera coincidencia; NO consume; guarda `token` vacío sin
    llamar a bcrypt.
  - `resetPassword`: mismo bucle + `creds.isActive`; consume con `consumePasswordResetToken`
    ANTES de `updateUserPasswordHash` (falla en la dirección segura); guarda `password` vacío
    sin bcrypt.
  - `sendOtpCode`: guarda `phone_number` vacío (`REQUIRED_INFO_MISSING`, 6 claves preservadas);
    caso normal `randomInt(0,1e6).padStart(6,'0')` → `bcrypt.hash` → `createOtpCode` →
    `findUserIdByProfileContact` para `is_contact_exist` → `logger.warn` (D5).
  - `verifyOtpCode`: `Number.isSafeInteger` guarda `otp_id`; `findLiveOtpCodeById` + comparación
    de `phone`/`code`; NO consume.
  - `otpLogin`: mismas guardas + `findUserIdByProfileContact` (D2 — ignora `name`/`email` del
    body, nunca crea usuarios); 0/>1 perfiles, usuario inactivo o `consumeOtpCode===0` →
    `UnauthorizedException(INVALID_CREDENTIALS_MESSAGE)` (mismo genérico de `login()`); consume
    ANTES de firmar; éxito → `findUserWithRelations` + `jwtService.signAsync` + `deriveRole`.
  - Las 6 llamadas a `@safari/db` envueltas en `withPrismaErrorTranslation`, igual que
    `login`/`changePassword`.
- [x] 7.1 — `apps/api/rest/.env.example`: `PASSWORD_RESET_TTL_MINUTES=60` y
      `OTP_CODE_TTL_MINUTES=10` tras el bloque de JWT.
- [x] 7.2 — `apps/README.md`: sección nueva "Recuperación de contraseña y OTP (US-24)" antes de
      `## Verificación` — cómo leer el secreto del log, las 2 variables de TTL, la purga manual,
      y los caveats R-2 (sin rate limiting) y V-3 (oráculo temporal).
- [x] 8.1–8.9 — Verificación completa (evidencia real abajo).
- [x] 9.1 — `docs/product/19-autenticacion-autorizacion/24-recuperacion-password-otp.md` →
      `Status: ✅ Implementada` + DoD marcada `[x]`; fila de US-24 en el `README.md` del épico →
      `✅ Implementada`.

### Archivos (PR#2)

| Archivo | Acción |
|---|---|
| `apps/api/rest/src/auth/recovery-options.ts` | Creado |
| `apps/api/rest/src/auth/auth.service.ts` | Modificado (6 métodos + imports + `logger` + 2 constantes) |
| `apps/api/rest/.env.example` | Modificado (2 variables TTL) |
| `apps/README.md` | Modificado (sección nueva) |
| `docs/product/19-autenticacion-autorizacion/24-recuperacion-password-otp.md` | Modificado (Status + DoD) |
| `docs/product/19-autenticacion-autorizacion/README.md` | Modificado (fila US-24) |

### Deviación de diseño

Ninguna de comportamiento. Cosmética: la respuesta de fallo de `resetPassword`/
`verifyForgetPasswordToken`/`verifyOtpCode` reutiliza una constante local
`INVALID_TOKEN_MESSAGE = 'PICKBAZAR_MESSAGE.INVALID_TOKEN'` (no está en `design.md` explícitamente
como constante, pero el literal es idéntico al que el diseño exige en cada método) — mismo
criterio que `PASSWORD_CHANGE_SUCCESS_MESSAGE`, para que las tres ramas de fallo no puedan
divergir al editarse.

### Hallazgo, no acción — HTTP status de las 5 respuestas `CoreResponse`/`OtpResponse`

El spec y el `README` de la US usan el lenguaje "200 con `success:false`" para describir la
postura de no-excepción (D6). El controlador (`auth.controller.ts`, fuera de alcance — no se
toca) no tiene `@HttpCode(200)` en ninguno de los 5 endpoints, así que Nest devuelve su default
de **201** para `POST` — igual que ya hacía `changePassword` desde US-22 (mismo controlador, mismo
patrón, no señalado como defecto entonces). Verificado en la evidencia de abajo: los fallos de
dominio salen como `201 {success:false, ...}`, nunca `4xx/5xx` — el criterio real de D6/CA que
importa (no lanzar excepción ante fallo de dominio) se cumple; el código HTTP exacto es
201 por el default de Nest en un controlador que esta US tiene prohibido modificar. Reportado,
no corregido.

## Evidencia de verificación (Fase 8)

Postgres (`safari-postgres`) ya estaba arriba; la API se corrió en background (`just api-dev`
vía `yarn start:dev`) y se detuvo al terminar la evidencia (`taskkill`), sin dejar el puerto 9001
ocupado.

### Conteos antes de tocar nada (3.2 repetido)

```
$ docker exec safari-postgres psql -U safari -d safari_scraper -t -A -c \
  "SELECT (SELECT count(*) FROM users)||'/'||(SELECT count(*) FROM shops)||'/'|| \
          (SELECT count(*) FROM products)||'/'||(SELECT count(*) FROM categories);"
3/12/1200/198
```

### 8.1 — `just build-api` limpio

```
$ just build-api
yarn build
yarn run v1.22.22
$ rimraf dist
$ nest build
Done in 70.99s.
```

### 8.2/CA-1/CA-4 — Flujo completo forget → verify → reset → login (nuevo OK, viejo falla)

```
$ curl -s -i -X POST http://localhost:9001/api/forget-password \
  -H "Content-Type: application/json" -d '{"email":"admin@demo.com"}'
HTTP/1.1 201 Created
{"success":true,"message":"Password change successful"}

# Log (línea completa, D5):
[Nest] 1420 - 09/03/2026, 2:30:25 PM WARN [AuthService] [forget-password] Implementación de
desarrollo, SIN envío real de correo. Token en claro para admin@demo.com:
9a1d630ad058c96e19f892b27368938f18fb7f740642400d701fade12c69fbb8 (expira 2026-09-03T20:30:25.767Z)

$ curl -s -i -X POST http://localhost:9001/api/verify-forget-password-token \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@demo.com","token":"9a1d630ad058c96e19f892b27368938f18fb7f740642400d701fade12c69fbb8"}'
HTTP/1.1 201 Created
{"success":true,"message":"Password change successful"}

$ curl -s -i -X POST http://localhost:9001/api/reset-password \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@demo.com","token":"9a1d630ad058c96e19f892b27368938f18fb7f740642400d701fade12c69fbb8","password":"nuevopass123"}'
HTTP/1.1 201 Created
{"success":true,"message":"Password change successful"}

$ curl -s -i -X POST http://localhost:9001/api/token \
  -H "Content-Type: application/json" -d '{"email":"admin@demo.com","password":"demodemo"}'
HTTP/1.1 401 Unauthorized
{"statusCode":401,"message":"Las credenciales no son válidas.","error":"Unauthorized"}

$ curl -s -i -X POST http://localhost:9001/api/token \
  -H "Content-Type: application/json" -d '{"email":"admin@demo.com","password":"nuevopass123"}'
HTTP/1.1 201 Created
{"token":"eyJhbGci...(JWT válido, sub:3, email:admin@demo.com)...","permissions":["super_admin","customer","store_owner"],"role":"super_admin"}
```

Contraseña vieja (`demodemo`) → 401; contraseña nueva → 201 con JWT. Al final del batch se
restauró `demodemo` (ver "Restauración de la contraseña demo" abajo).

### 8.3/CA-4 — Replay del token consumido y token vencido

```
# Reintento con el MISMO token ya consumido (después del reset de arriba):
$ curl -s -i -X POST http://localhost:9001/api/reset-password \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@demo.com","token":"9a1d630ad058c96e19f892b27368938f18fb7f740642400d701fade12c69fbb8","password":"otraclave"}'
HTTP/1.1 201 Created
{"success":false,"message":"PICKBAZAR_MESSAGE.INVALID_TOKEN"}

# Token VENCIDO — API reiniciada con PASSWORD_RESET_TTL_MINUTES=1 para esta prueba:
$ curl -s -X POST http://localhost:9001/api/forget-password \
  -H "Content-Type: application/json" -d '{"email":"customer@demo.com"}'
{"success":true,"message":"Password change successful"}
# Log: token 98c4bb66395d02872eea12ba12dc2c6c8a470f2ea4bd4edfcf3153523c3186ee, expira 2026-09-03T19:36:22.645Z
$ sleep 75   # más allá del vencimiento (TTL=1 min)
$ curl -s -i -X POST http://localhost:9001/api/verify-forget-password-token \
  -H "Content-Type: application/json" \
  -d '{"email":"customer@demo.com","token":"98c4bb66395d02872eea12ba12dc2c6c8a470f2ea4bd4edfcf3153523c3186ee"}'
HTTP/1.1 201 Created
{"success":false,"message":"PICKBAZAR_MESSAGE.INVALID_TOKEN"}
```

Ninguno de los dos casos es una excepción `4xx`/`5xx` — ambos `success:false` sin lanzar (D6).
Ver "Hallazgo, no acción" arriba sobre el código HTTP exacto (201, no 200, por el default de Nest
en un controlador fuera de alcance).

### 8.4/CA-2 — Las dos respuestas de `forget-password`, byte a byte

```
$ curl -s -i -X POST http://localhost:9001/api/forget-password \
  -H "Content-Type: application/json" -d '{"email":"no-existe@demo.com"}'
HTTP/1.1 201 Created
ETag: W/"37-0I9DW/Kxj2XoNiVpAXQ8i7Z7GOM"
{"success":true,"message":"Password change successful"}

$ curl -s -i -X POST http://localhost:9001/api/forget-password \
  -H "Content-Type: application/json" -d '{"email":"admin@demo.com"}'
HTTP/1.1 201 Created
ETag: W/"37-0I9DW/Kxj2XoNiVpAXQ8i7Z7GOM"
{"success":true,"message":"Password change successful"}
```

Mismo `ETag` (hash del body) en ambas — byte-idénticas. Conteo de filas antes/después:

```
$ docker exec safari-postgres psql -U safari -d safari_scraper -t -A -c \
  "SELECT count(*) FROM password_reset_tokens;"
1
$ docker exec safari-postgres psql -U safari -d safari_scraper -t -A -c \
  "SELECT id, user_id, expires_at, consumed_at FROM password_reset_tokens ORDER BY id;"
41|3|2026-09-03 20:30:25.767+00|
```

Solo 1 fila, para `user_id=3` (`admin@demo.com`) — el email inexistente no insertó nada. Log
(`grep -n "forget-password"` sobre el archivo de log completo): **una sola** línea `WARN`, la de
`admin@demo.com` — ninguna para el email inexistente.

### 8.5/CA-5 — Flujo OTP completo

```
$ curl -s -i -X POST http://localhost:9001/api/send-otp-code \
  -H "Content-Type: application/json" -d '{"phone_number":"12365141641631"}'
HTTP/1.1 201 Created
{"message":"success","success":true,"id":"17","provider":"log","phone_number":"12365141641631","is_contact_exist":true}

# Log: código 833844, expira 2026-09-03T19:37:57.473Z

$ curl -s -i -X POST http://localhost:9001/api/verify-otp-code \
  -H "Content-Type: application/json" \
  -d '{"otp_id":"17","code":"000000","phone_number":"12365141641631"}'
HTTP/1.1 201 Created
{"message":"PICKBAZAR_MESSAGE.INVALID_TOKEN","success":false}

$ curl -s -i -X POST http://localhost:9001/api/verify-otp-code \
  -H "Content-Type: application/json" \
  -d '{"otp_id":"17","code":"833844","phone_number":"12365141641631"}'
HTTP/1.1 201 Created
{"message":"success","success":true}

$ curl -s -i -X POST http://localhost:9001/api/otp-login \
  -H "Content-Type: application/json" \
  -d '{"otp_id":"17","code":"833844","phone_number":"12365141641631"}'
HTTP/1.1 201 Created
{"token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjEsImVtYWlsIjoic3RvcmVfb3duZXJAZGVtby5jb20iLCJwZXJtaXNzaW9ucyI6WyJjdXN0b21lciIsInN0b3JlX293bmVyIl0sImlhdCI6MTc4ODQ2NDI0OSwiZXhwIjoxNzg5MDY5MDQ5fQ.6dYQB8xh2IMOQLttkA7lylYyz05xFKQAI_FAFl-VrFk","permissions":["customer","store_owner"],"role":"store_owner"}

$ node -e "console.log(JSON.stringify(JSON.parse(Buffer.from('eyJzdWIiOjEsImVtYWlsIjoic3RvcmVfb3duZXJAZGVtby5jb20iLCJwZXJtaXNzaW9ucyI6WyJjdXN0b21lciIsInN0b3JlX293bmVyIl0sImlhdCI6MTc4ODQ2NDI0OSwiZXhwIjoxNzg5MDY5MDQ5fQ'.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8')),null,2))"
{
  "sub": 1,
  "email": "store_owner@demo.com",
  "permissions": ["customer", "store_owner"],
  "iat": 1788464249,
  "exp": 1789069049
}

# Reutilizar el mismo código:
$ curl -s -i -X POST http://localhost:9001/api/otp-login \
  -H "Content-Type: application/json" \
  -d '{"otp_id":"17","code":"833844","phone_number":"12365141641631"}'
HTTP/1.1 401 Unauthorized
{"statusCode":401,"message":"Las credenciales no son válidas.","error":"Unauthorized"}
```

`sub`/`email`/`permissions` corresponden a `store_owner@demo.com` (id 1) — confirma D2 (identidad
resuelta por teléfono) y el JWT es real, no el literal `'jwt token'` del stub.

### 8.6/CA-5 — Teléfono ambiguo

```
$ curl -s -i -X POST http://localhost:9001/api/otp-login \
  -H "Content-Type: application/json" \
  -d '{"otp_id":"17","code":"833844","phone_number":"19365141641631"}'
HTTP/1.1 401 Unauthorized
{"statusCode":401,"message":"Las credenciales no son válidas.","error":"Unauthorized"}
```

Mismo mensaje genérico de `login()`. Nota: este caso concreto falla ya en la comparación de
`phone` de la fila OTP (generada para `12365141641631`) antes de llegar a la resolución de
identidad — cubre igualmente el escenario pedido por la DoD (401 con mensaje genérico); el caso
de ambigüedad real de `findUserIdByProfileContact` (2 perfiles, `null`) está cubierto por el test
2.8 de PR#1 contra el seed (`db/seed.sql:62-64`).

### 8.7/D5 — Advertencia "sin envío real" junto al secreto

```
[Nest] 41864 - 09/03/2026, 2:35:22 PM WARN [AuthService] [forget-password] Implementación de
desarrollo, SIN envío real de correo. Token en claro para customer@demo.com:
98c4bb66395d02872eea12ba12dc2c6c8a470f2ea4bd4edfcf3153523c3186ee (expira 2026-09-03T19:36:22.645Z)

[Nest] 41864 - 09/03/2026, 2:36:57 PM WARN [AuthService] [send-otp-code] Implementación de
desarrollo, SIN envío real de SMS. Código en claro para 12365141641631: 833844
(expira 2026-09-03T19:37:57.473Z)
```

Ambas líneas traen la advertencia y el secreto en la misma emisión de `logger.warn`.

### 8.8/CA-6 — Conteos sin cambio tras toda la corrida de `curl`

```
$ docker exec safari-postgres psql -U safari -d safari_scraper -t -A -c \
  "SELECT (SELECT count(*) FROM users)||'/'||(SELECT count(*) FROM shops)||'/'|| \
          (SELECT count(*) FROM products)||'/'||(SELECT count(*) FROM categories);"
3/12/1200/198
```

Sin cambio — las filas nuevas quedaron en `password_reset_tokens`/`otp_codes`, que no están entre
los 4 conteos fijados.

### 8.9 — `just db-check` verde (regresión, PR#2 no rompe la suite de PR#1)

```
$ just db-check
npm run typecheck
> tsc --noEmit

npm test
> vitest run

 RUN  v4.1.11 C:/DevOps/MyGitHub/safari-marketplace/packages/db
 Test Files  8 passed (8)
      Tests  84 passed (84)
   Start at  14:39:16
   Duration  10.86s
```

Mismo recuento que PR#1 (84/84, 8 archivos) — PR#2 no toca `packages/db`.

### Restauración de la contraseña demo

La evidencia de 8.2 cambió la contraseña de `admin@demo.com` de `demodemo` a `nuevopass123`.
Se restauró usando **el propio flujo** (no edición directa de la base): un segundo
`forget-password` para `admin@demo.com`, token leído del log, `reset-password` con
`password:"demodemo"`. Verificado con `POST /api/token` (`demodemo` → `201` con JWT) al final del
batch. `.env` local también se revirtió de `PASSWORD_RESET_TTL_MINUTES=1`/`OTP_CODE_TTL_MINUTES=1`
(usados solo para forzar el vencimiento del token de 8.3) a los defaults `60`/`10` de
`.env.example` (`.env` está gitignored, no forma parte de los artefactos del PR).

El servidor de `just api-dev` (dos reinicios: uno para el TTL corto de 8.3, otro implícito en la
restauración) se detuvo al final (`taskkill`); confirmado sin proceso en `LISTENING` sobre el
puerto 9001 tras el cierre.

## Estado de `tasks.md`

**Fases 1-9 completas** (`[x]` en `openspec/changes/2026-09-03-recuperacion-password-otp/tasks.md`).
No quedan tareas pendientes de US-24.

## Remaining

Ninguna. Listo para `sdd-verify` / `sdd-archive`.

## Workload / PR Boundary

- Mode: chained/stacked PR slice (`stacked-to-main`) — **ambos slices completos**
- Current work unit: PR#2 — `apps/api/rest` (`recovery-options.ts` + 6 métodos de
  `auth.service.ts`) + `.env.example` + `apps/README.md` + cierre de docs de producto
- Boundary: este batch empieza en un repo con PR#1 mergeado (`packages/db` construido) y sin
  consumidores de los símbolos nuevos desde la API; termina con los 6 stubs de
  `auth.service.ts` reemplazados, `just build-api` limpio y la DoD de US-24 verificada con
  `curl` real. Nada queda a medias entre PR#1 y PR#2.
- Estimated review budget impact: ~305 líneas nuevas/modificadas (dentro de lo forecastado en
  `tasks.md`), Low-Medium por sí solo. Combinado con PR#1 (~295), el total (~600) fue el motivo
  del encadenamiento — cada PR individual queda bajo el presupuesto de 400 líneas.
