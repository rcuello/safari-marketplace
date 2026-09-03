# Auth Jwt Api Specification

## Purpose

`auth.service.ts` es hoy un mock: `login()` acepta cualquier contraseña,
`register()` empuja a un array en memoria que se pierde al reiniciar, y
`me()` siempre devuelve el mismo usuario fijo, ignorando el token. Esta
capability entrega autenticación real de la API REST: login verificado
contra el hash bcrypt de Postgres (vía `@safari/db`, entregado por US-21),
JWT firmado y verificable, registro persistente con permiso `customer`
fijo, cambio de contraseña real y `/me` resuelto desde el payload del
token — preservando byte a byte el contrato HTTP heredado de
Laravel/Pickbazar que ya consumen shop y admin.

## Requirements

### Requirement: Login verificado emite un JWT firmado

El sistema MUST, en `POST /api/token` con credenciales válidas, verificar
la contraseña contra el hash bcrypt almacenado y devolver
`{token, permissions[], role}`. El `token` MUST ser un JWT firmado con el
secreto configurado, verificable con la librería de JWT usando ese mismo
secreto, y su payload decodificado MUST incluir `sub` (id numérico),
`email`, `permissions[]`, `iat` y `exp`.

#### Scenario: Login correcto con la credencial demo

- GIVEN la base sembrada con `admin@demo.com` / `demodemo`
- WHEN se hace `POST /api/token` con esas credenciales
- THEN la respuesta trae `token`, `permissions[]` y `role`
- AND el token decodificado trae `sub`, `email`, `permissions`, `iat`, `exp`, verificable con el `JWT_SECRET` configurado

### Requirement: Ninguna respuesta 401 permite enumerar cuentas

El sistema MUST devolver `401 Unauthorized` con exactamente el mismo
mensaje de error, byte a byte, en los tres casos que no producen token:
contraseña incorrecta, email inexistente, y usuario con `is_active =
false` aunque la contraseña sea correcta. Diferenciar el mensaje del
usuario inactivo del resto de los 401 sería en sí mismo una forma de
enumeración de cuentas, así que extiende D-4 del épico a los tres casos.

#### Scenario: Contraseña mala y email inexistente son indistinguibles

- WHEN se hace `POST /api/token` con la contraseña incorrecta de un usuario existente
- AND se hace `POST /api/token` con un email que no existe en la base
- THEN ambas respuestas son 401 con el mismo status y el mismo cuerpo de mensaje, comparados byte a byte

#### Scenario: Usuario inactivo con contraseña correcta tampoco entra

- GIVEN un usuario con `is_active = false` y su contraseña correcta conocida
- WHEN se hace `POST /api/token` con esa contraseña
- THEN la respuesta es 401 con el mismo cuerpo de mensaje que el escenario anterior

### Requirement: Registro persistente con permiso fijo

El sistema MUST, en `POST /api/register`, crear la fila del usuario en
Postgres con la contraseña hasheada con bcrypt y asignarle ÚNICAMENTE el
permiso `customer`. El sistema MUST NOT leer `RegisterDto.permission` del
body para decidir el permiso otorgado (guardia anti-escalación, D-6), y
MUST devolver un token usable equivalente al de login. Un email ya
registrado MUST devolver `409 Conflict` traducido de `DuplicateEmailError`,
y MUST NOT propagar un error 500 de Prisma.

#### Scenario: Registro exitoso persiste y no escala privilegios

- GIVEN un email no usado y un body con `permission: 'super_admin'`
- WHEN se hace `POST /api/register`
- THEN la fila creada en Postgres tiene únicamente el permiso `customer`
- AND la respuesta trae un `token` que funciona en `GET /api/me`

#### Scenario: Email duplicado devuelve 409, no 500

- GIVEN un email ya registrado
- WHEN se hace `POST /api/register` con ese mismo email
- THEN la respuesta es `409 Conflict`, nunca un 500

### Requirement: /me resuelve al titular del token, no una fila fija

El sistema MUST, en `GET /api/me`, identificar al usuario a partir del
`sub` del bearer token verificado. El sistema MUST NOT devolver una fila
fija independiente del token que llega. Dos tokens de dos usuarios
distintos MUST devolver dos usuarios distintos. Un request sin header
`Authorization`, con token malformado, expirado, o con firma inválida MUST
devolver 401.

#### Scenario: Dos tokens devuelven dos usuarios

- GIVEN un token de `admin@demo.com` y un token de `customer@demo.com`
- WHEN se hace `GET /api/me` con cada uno
- THEN el `email` de cada respuesta corresponde al titular de su propio token

#### Scenario: Token roto no entra

- WHEN se hace `GET /api/me` sin header `Authorization`, con un JWT expirado, o con uno firmado con otro secreto
- THEN cada uno de los tres casos devuelve 401

### Requirement: El key-set de /me se preserva con las divergencias declaradas

El sistema MUST publicar en `GET /api/me` las mismas 15 claves de hoy
(`id, name, email, email_verified_at, created_at, updated_at, is_active,
shop_id, email_verified, profile, permissions, wallet, shops, last_order,
address`), sin agregar ni quitar ninguna. `permissions[]` MUST llevar el
shape Laravel `{id, name, guard_name, created_at, updated_at,
pivot:{model_id, permission_id, model_type}}`. `profile` MUST incluir
`profile.id` y `profile.customer_id`, ambos sintetizados como el id del
usuario. `is_active` MUST emitirse como number (`0`/`1`), no boolean.
`wallet` y `last_order` MUST emitirse `null`; `address` MUST emitirse `[]`.
`role` MUST seguir presente en `POST /api/token` y `POST /api/register`,
derivado por precedencia `super_admin > store_owner > staff > customer`
sobre `permissions[]`, aunque ningún `hasAccess()` de los frontends lo lea.

#### Scenario: El key-set completo no cambia

- GIVEN una respuesta de `GET /api/me` contra Postgres
- WHEN se comparan sus claves de primer nivel contra las 15 del mock (`users.json`)
- THEN el conjunto de claves es idéntico, y toda divergencia de valor está documentada en la tabla de divergencias del proposal

#### Scenario: role se deriva por precedencia

- GIVEN un usuario con `permissions: ['customer', 'store_owner']`
- WHEN inicia sesión
- THEN `role` es `'store_owner'`, no `'customer'`

### Requirement: Cambio de contraseña verifica la actual antes de reemplazar

El sistema MUST, en `POST /api/change-password`, verificar la contraseña
actual contra el hash antes de reemplazarla. Si la actual no coincide, el
sistema MUST devolver el shape `CoreResponse` `{message, success: false}`
con status 200, y MUST NOT lanzar una excepción. Tras un cambio exitoso, la
contraseña anterior MUST dejar de autenticar (401 en `POST /api/token`) y
la nueva MUST autenticar correctamente.

#### Scenario: Contraseña actual equivocada no lanza excepción

- GIVEN una sesión con un token válido
- WHEN se hace `POST /api/change-password` con la contraseña actual equivocada
- THEN la respuesta es `{success: false}` con el shape `CoreResponse`, sin error 500

#### Scenario: La contraseña vieja deja de servir tras el cambio

- GIVEN un cambio de contraseña exitoso
- WHEN se intenta `POST /api/token` con la contraseña anterior y luego con la nueva
- THEN el primer intento es 401 y el segundo es 200 con token

### Requirement: JWT_SECRET falla rápido, nunca firma con un default silencioso

El sistema MUST validar en el arranque de la API que `JWT_SECRET` esté
definido y no vacío. Si falta o está vacío, el proceso MUST fallar al
arrancar con un mensaje de error claro identificando la variable faltante,
y MUST NOT levantar el servidor firmando tokens con un secreto por
defecto.

#### Scenario: Arranque sin JWT_SECRET falla con mensaje claro

- GIVEN un `.env` sin la variable `JWT_SECRET` (o con valor vacío)
- WHEN se ejecuta `just api-dev`
- THEN el proceso termina con un error que nombra `JWT_SECRET`, y no queda un servidor escuchando

### Requirement: Los stubs declarados no cambian su comportamiento observable

De los 7 stubs originales, esta US-24 convierte 6 en mecanismo real
(`forgetPassword`, `resetPassword`, `verifyForgetPasswordToken`,
`verifyOtpCode`, `sendOtpCode`, `otpLogin` — capability
`password-recovery-otp`). Solo `socialLogin` MUST seguir devolviendo
exactamente la misma respuesta fija que devuelve hoy, byte a byte (D-11 del
épico: social login real queda fuera de alcance). `POST /api/logout` MUST
seguir devolviendo `true` sin invalidar ni revocar ningún token (D-9: sin
refresh tokens ni denylist).

(Previously: los 7 stubs — incluyendo los 6 de recuperación/OTP — debían
devolver la misma respuesta fija byte a byte; US-24 los reemplaza por
comportamiento real y estrecha este requirement a `socialLogin` únicamente.)

#### Scenario: socialLogin sigue siendo un stub declarado

- GIVEN el único stub restante, `socialLogin`
- WHEN se invoca su endpoint con cualquier body
- THEN la respuesta es byte-idéntica a la que devuelve el mock de hoy

#### Scenario: Logout no revoca nada

- GIVEN un token válido recién emitido
- WHEN se hace `POST /api/logout` y luego se reintenta ese mismo token en `GET /api/me`
- THEN `logout` devuelve `true` y el token sigue siendo válido en `/me`

### Requirement: Ningún guard se introduce en este cambio

El sistema MUST NOT incluir, en ningún archivo tocado por este cambio,
ninguna clase que implemente `CanActivate` ni ningún uso del decorador
`@UseGuards` — ni siquiera acotado a una sola ruta. La protección de rutas
es responsabilidad de US-23, no de este cambio.

#### Scenario: grep no encuentra guards nuevos

- GIVEN el diff completo de este cambio
- WHEN se ejecuta `grep -rn "CanActivate\|@UseGuards" apps/api/rest/src`
- THEN no hay ninguna coincidencia introducida por este cambio

### Requirement: add-points exige token

El sistema MUST exigir un bearer token válido en `POST /api/add-points`,
devolviendo 401 si no se provee, como consecuencia obligatoria de que
`me()` deja de aceptar llamadas sin contexto de token (D-8, ripple
aprobado).

#### Scenario: add-points sin token es 401

- WHEN se hace `POST /api/add-points` sin header `Authorization`
- THEN la respuesta es 401

## Out of Scope

Guards, `CanActivate`, `@UseGuards`, `@Public()` (US-23) · recuperación de
contraseña y OTP (US-24) · social login real (D-11: stub declarado) ·
endpoints de `/api/users` (US-25) · refresh tokens y denylist (D-9) ·
cualquier cambio en shop o admin · `packages/db`, `db/schema.sql`,
`db/generate-seed.mjs`, `db/seed.sql` · tests automatizados
(`auth.service.spec.ts`): la evidencia de esta US es por `curl`, no jest.
