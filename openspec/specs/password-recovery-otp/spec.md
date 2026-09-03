# Password Recovery Otp Specification

## Purpose

Seis métodos de `auth.service.ts` son stubs de respuesta fija:
`forgetPassword`, `verifyForgetPasswordToken`, `resetPassword`,
`sendOtpCode`, `verifyOtpCode`, `otpLogin`. Esta capability los reemplaza por
recuperación de contraseña y login OTP reales contra Postgres — generación,
hash, persistencia con vencimiento, consumo de un solo uso y purga de
`password_reset_tokens`/`otp_codes` — preservando byte a byte el contrato
HTTP del mock.

## Contrato por método (referencia de CA-6)

| Método | Shape | Divergencia vs. mock |
|---|---|---|
| `forgetPassword` | `CoreResponse` | Ninguna: `{success:true,...}` exista o no el email |
| `verifyForgetPasswordToken` | `CoreResponse` | `success` real; no consume |
| `resetPassword` | `CoreResponse` | `success` real; consume |
| `sendOtpCode` | `OtpResponse` | `id` real, `provider:'log'`, `phone_number` eco, `is_contact_exist` computado |
| `verifyOtpCode` | `CoreResponse` | `success` real; no consume |
| `otpLogin` | `AuthResponse` | mismo shape; `token` firmado real; `permissions`/`role` reales; consume |

## Requirements

### Requirement: Generación y persistencia hasheada del token de recuperación

`POST /api/forget-password` con email existente MUST generar un token en
claro (`crypto.randomBytes(32).toString('hex')`), hashearlo con `bcrypt` e
insertarlo en `password_reset_tokens` con `expires_at`, invalidando
(`consumed_at = now()`) los tokens vivos previos de ese usuario en la misma
operación (a lo sumo una fila viva por usuario). El valor en claro MUST NOT
persistirse ni devolverse, MUST NOT cruzar hacia `packages/db` en ningún
tipo de retorno salvo un tipo dedicado (`PasswordResetTokenSecret`) fuera de
`records.ts`, y `bcrypt.compare` MUST ejecutarse en el servicio de Nest,
nunca en `packages/db`. La respuesta MUST mantener el shape `CoreResponse`.

#### Scenario: Token generado, persistido y previo invalidado

- GIVEN `admin@demo.com` con un token vivo ya emitido
- WHEN se pide `forget-password` de nuevo para ese email
- THEN la fila anterior queda `consumed_at` no nulo, la nueva fila tiene `expires_at` futuro, y ambos valores en claro solo existen en el log

### Requirement: forget-password es indistinguible ante email inexistente

Con un email inexistente, `POST /api/forget-password` MUST devolver una
respuesta byte-idéntica a la de uno existente, MUST NOT insertar fila en
`password_reset_tokens`, y MUST NOT emitir log. Extiende D-4 del épico (sin
enumeración de cuentas) a este endpoint.

#### Scenario: Email inexistente y existente responden igual

- WHEN se pide `forget-password` para un email inexistente y luego para `admin@demo.com`
- THEN ambas respuestas son idénticas byte a byte
- AND solo la segunda persiste fila y emite log

### Requirement: Verificación de token no consume

`POST /api/verify-forget-password-token` MUST devolver `success:true` solo
si existe, para el `user_id` resuelto del `email`, un token cuyo hash
coincide (`bcrypt.compare`), no venció y no fue consumido; en cualquier otro
caso `success:false`. MUST NOT marcar el token consumido.

#### Scenario: Token vencido no verifica y es repetible

- GIVEN un token cuyo `expires_at` ya pasó
- WHEN se verifica dos veces con ese token
- THEN ambas respuestas traen `success:false`

### Requirement: Restablecer consume el token con UPDATE condicional

`POST /api/reset-password` MUST, con token válido, actualizar el hash de
contraseña (`bcrypt`, costo 10) y consumir el token mediante un UPDATE
condicional (`WHERE id = ? AND consumed_at IS NULL`) que reporta filas
afectadas; cero filas MUST tratarse como token inválido/consumido. Esta
forma MUST garantizar que, ante dos `reset-password` concurrentes con el
mismo token, como máximo uno tenga éxito. Tras el cambio, la contraseña
anterior MUST dejar de autenticar y la nueva MUST autenticar.

#### Scenario: Token de un solo uso

- GIVEN un token válido
- WHEN se restablece la contraseña con ese token y se reintenta con el mismo
- THEN el primer intento habilita la contraseña nueva (`POST /api/token` con la vieja → 401, con la nueva → `201 Created`, el default de `@Post` que ya devolvía `login()`) y el segundo devuelve `{success:false}`

### Requirement: Generación y persistencia del código OTP

`POST /api/send-otp-code` MUST generar un código de 6 dígitos
(`crypto.randomInt`), insertarlo en `otp_codes` (sin FK a `users`) con
`phone` y `expires_at`, y emitirlo al log. `OtpResponse` MUST llevar `id`
real (`String(otp_codes.id)`), `provider:'log'` constante, `phone_number`
eco literal del input, e `is_contact_exist` computado por
`findUserIdByProfileContact(phone) !== null`.

#### Scenario: Send OTP persiste y refleja el teléfono recibido

- WHEN se hace `POST /api/send-otp-code` con un teléfono
- THEN se inserta una fila con ese `phone` y `expires_at` futuro
- AND la respuesta trae `id` real, `provider:'log'`, `phone_number` igual al enviado

### Requirement: Verificación de OTP valida código y teléfono sin consumir

`POST /api/verify-otp-code` MUST devolver `success:true` solo si `otp_id`
corresponde a una fila con `phone` igual al `phone_number` recibido, código
coincidente, no vencida y no consumida; en cualquier otro caso, incluyendo
teléfono no coincidente, `success:false`. MUST NOT consumir el código.

#### Scenario: Código incorrecto no verifica ni emite token

- GIVEN un código OTP emitido para un teléfono
- WHEN se verifica con un código distinto
- THEN la respuesta trae `success:false` y no se emite ningún token

### Requirement: otp-login resuelve identidad por teléfono y emite JWT real

`POST /api/otp-login` MUST resolver el usuario solo por
`findUserIdByProfileContact(phone_number)`, MUST ignorar `name`/`email` del
body, y MUST NOT crear cuentas; cero o más de un perfil coincidente MUST
fallar como credenciales inválidas. Solo cuando el código verifica (mismas
reglas que `verify-otp-code`) y el teléfono resuelve a un único usuario,
MUST firmar un JWT real (`jwtService.signAsync({sub,email,permissions})`,
igual que `login()`) con `permissions[]`/`role` reales de ese usuario, y MUST
consumir el código con el mismo UPDATE condicional de `reset-password`;
reutilizarlo MUST fallar.

#### Scenario: Teléfono ambiguo falla, teléfono único emite JWT de un solo uso

- GIVEN un teléfono con dos perfiles y el teléfono `'12365141641631'` (único, `store_owner@demo.com`) con código vigente
- WHEN se hace `otp-login` con el teléfono ambiguo, y luego con el único y su código
- THEN el primero es `401`, el segundo trae un JWT decodificable con `sub`/`email`/`permissions` de `store_owner@demo.com`, y repetir el mismo código vuelve a dar `401`

### Requirement: TTL configurables con default embebido, sin bloqueo de arranque

`PASSWORD_RESET_TTL_MINUTES` (default 60) y `OTP_CODE_TTL_MINUTES` (default
10) MUST leerse de forma diferida y memoizada por `recovery-options.ts`. A
diferencia de `JWT_SECRET`, su ausencia MUST NOT impedir el arranque de la
API.

#### Scenario: Arranque sin las variables usa los defaults

- GIVEN un `.env` sin `PASSWORD_RESET_TTL_MINUTES` ni `OTP_CODE_TTL_MINUTES`
- WHEN arranca la API y se genera un token de recuperación
- THEN el proceso arranca y el token vence 60 minutos después de creado

### Requirement: Advertencia de "sin envío real" adjunta a cada secreto logueado

Cada emisión al log de un token o código en claro (`forget-password`,
`send-otp-code`) MUST ir acompañada, en la misma emisión, de una advertencia
explícita de que no hay envío real y de que es una implementación de
desarrollo.

#### Scenario: El log trae la advertencia junto al secreto

- WHEN se hace `forget-password` o `send-otp-code`
- THEN la línea de log del secreto está acompañada de la advertencia de "sin envío real"

### Requirement: Postura de errores — nunca lanzar, salvo otp-login

`forgetPassword`, `verifyForgetPasswordToken`, `resetPassword`,
`sendOtpCode` y `verifyOtpCode` MUST responder ante cualquier fallo de
dominio con `success:false` en el cuerpo y con el MISMO código de estado que
devolvía el stub del mock — **`201 Created`**, el default de Nest para
`@Post` — y MUST NOT lanzar excepción para esos casos. `otpLogin` MUST lanzar
`UnauthorizedException` con el mismo mensaje genérico de `login()` para toda
causa de fallo. Los fallos de infraestructura MUST seguir traduciéndose vía
`withPrismaErrorTranslation` (503/500) por encima de este requirement.

> **Corrección de `sdd-verify` (2026-09-03).** La redacción original de este
> requirement exigía «HTTP 200». Era un error de hecho: ninguna ruta de
> `auth.controller.ts` declara `@HttpCode`, ni antes de esta US ni
> después (el controlador está fuera de alcance por CA-6 y su diff está
> vacío), así que el default `201 Created` de `@Post` es y era el
> comportamiento observable. Promover «200» a `openspec/specs/` habría
> archivado un requisito falso. Lo que el requirement realmente exige —
> **no lanzar** ante fallo de dominio y devolver `success:false` — se
> mantiene intacto; solo se corrige el número.

#### Scenario: Fallo de dominio no lanza excepción

- WHEN se hace `verify-forget-password-token` con un token inexistente
- THEN la respuesta trae `{success:false}` con el mismo `201 Created` del
  stub, no un error 4xx/5xx

### Requirement: Purga de tokens y códigos vencidos o consumidos

El sistema MUST exponer una función de purga que elimine filas de
`password_reset_tokens` y `otp_codes` con `expires_at` pasado o
`consumed_at` no nulo, sin afectar filas vivas.

#### Scenario: La purga no toca filas vivas

- GIVEN una fila vencida, una consumida y una viva sin vencer
- WHEN se ejecuta la purga
- THEN solo la fila viva permanece

## Out of Scope

Proveedor real de correo o SMS · plantillas de mensaje · rate limiting
(enumeración/DoS conocido, deliberadamente no atendido, ver `proposal.md`) ·
social login (D-11 del épico) · cambios en `apps/shop`/`apps/admin` ·
`auth.controller.ts` y `create-auth.dto.ts` (contrato preservado) ·
`db/schema.sql`, `schema.prisma` (ya modelan las tablas) · `class-validator`
en los DTO de este módulo.
