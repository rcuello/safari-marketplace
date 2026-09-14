# Delta for User Management Api

## MODIFIED Requirements

### Requirement: Detalle de usuario con las mismas 15 claves de /me (CA-3)

`GET /api/users/:id` MUST publicar las mismas 15 claves que `GET /api/me`
(mismo mapper), con `wallet`/`last_order` en `null` y `address` en `[]`
(D-13). Un `id` inexistente MUST devolver `404`, nunca `undefined` ni 500.
Ninguna respuesta del módulo (detalle o listados) MUST incluir el hash de
contraseña, en ningún nivel de anidamiento (D-2).

El `id` de ruta de `GET /api/users/:id` y `PUT /api/users/:id` (mismo guard
en `users.service.ts`, ambos leen vía `findUserWithRelations` antes de
responder) MUST rechazarse con 404 cuando `!Number.isSafeInteger(id) || id
<= 0`: cubre `NaN`, decimales, cero, negativos y valores por encima de
`Number.MAX_SAFE_INTEGER` (`1e21`, `9223372036854775808`). Un id dentro del
rango seguro que no exista (p. ej. `1e16`) MUST seguir respondiendo 404 por
fila inexistente, nunca 400: el corte está exactamente en
`Number.isSafeInteger`, no antes.
(Previously: exigía 404 para un id inexistente sin fijar el criterio de
validez del id; el guard usaba `!Number.isInteger(id)`, que deja pasar
`1e21` hasta el driver.)

#### Scenario: Key-set idéntico a /me, 404 ante id inexistente, sin hash
- WHEN se comparan las claves de `GET /api/users/:id` y `GET /api/me` del mismo usuario, y se consulta `GET /api/users/99999`
- THEN el key-set es idéntico, sin hash en ningún campo, y la segunda respuesta es `404`

#### Scenario: CA-3 — id de ruta fuera del rango seguro nunca produce 500
- GIVEN un id de ruta `1e21`, `9223372036854775808`, `-1`, `0` o `1.5`
- WHEN se hace `GET /api/users/:id` o `PUT /api/users/:id` con ese valor
- THEN la respuesta es 404 y nunca 500
- AND `findUserWithRelations` no se invoca

#### Scenario: CA-3 — el límite no se adelanta
- GIVEN un id `1e16` (dentro de `Number.MAX_SAFE_INTEGER`) que no existe
- WHEN se hace `GET /api/users/1e16` o `PUT /api/users/1e16`
- THEN la respuesta es 404 por fila inexistente, nunca 400

#### Scenario: CA-3 — antirregresión del predicado de rango
- GIVEN un id `1e21`, `0` o `-5` (el caso `NaN` no sirve de testigo: pasa
  con ambos predicados)
- WHEN el guard usa `Number.isSafeInteger(id) || id <= 0` en vez de
  `Number.isInteger(id)`
- THEN el test que fija este comportamiento MUST fallar si alguien revierte
  el guard al predicado anterior

### Requirement: Bloqueo, desbloqueo y promoción persisten, con guardas de auto-bloqueo (CA-4)

`block-user`/`unblock-user` MUST fijar `is_active` explícitamente
(`setUserActive`), MUST NOT invertir el valor actual — dos `block-user`
seguidos dejan al usuario bloqueado. Un `id` inexistente MUST devolver
`404`; un bloqueado MUST recibir `401` en `POST /api/token`. `block-user`
MUST devolver `409` si el actor se bloquea a sí mismo, o si el objetivo es
el único `super_admin` (conteo sin filtrar `isActive` — conservador por
diseño). `make-admin` MUST leer `user_id` del body (no de un path param
inexistente) y conceder `super_admin` vía `grantPermission`; el permiso
MUST NOT afectar al guard hasta el siguiente login del promovido (D-5).

El `id` de body en `POST /api/users/block-user` y `/api/users/unblock-user`
(`@Body('id')`), y el `user_id` de body en `POST /api/users/make-admin`
(`@Body('user_id')`), MUST rechazarse con 404 (antes de leer o escribir la
fila) cuando `!Number.isSafeInteger(id) || id <= 0`, mismo criterio que
CA-3: cubre `NaN`, decimales, cero, negativos y valores por encima de
`Number.MAX_SAFE_INTEGER`. Un id dentro del rango seguro que no exista MUST
seguir respondiendo 404 por fila inexistente, nunca 400.
(Previously: exigía 404 para un id inexistente sin fijar el criterio de
validez del id; los guards usaban `!Number.isInteger(id)`, que deja pasar
`1e21` hasta el driver.)

#### Scenario: Dos bloqueos seguidos no reactivan, y el bloqueo impide el login

- GIVEN un usuario activo con credenciales válidas
- WHEN se llama `block-user` dos veces seguidas y luego ese usuario intenta `POST /api/token`
- THEN queda `is_active: false` tras ambas llamadas y el login es `401`

#### Scenario: Un admin no puede bloquearse a sí mismo, ni al último super_admin

- GIVEN un admin autenticado, y por separado el único usuario `super_admin`
- WHEN cada uno intenta bloquearse a sí mismo o ser bloqueado
- THEN ambas respuestas son `409`

#### Scenario: make-admin concede el permiso, pero no antes del siguiente login

- GIVEN un usuario sin `super_admin` y un token suyo emitido antes de la promoción
- WHEN se llama `POST /api/users/make-admin` con `{ user_id }` en el body
- THEN `GET /api/users/:id` ya incluye `super_admin`, pero el token previo decodificado sigue sin él

#### Scenario: CA-4 — id de body fuera del rango seguro nunca produce 500
- GIVEN un id de body `1e21`, `9223372036854775808`, `-1`, `0` o `1.5`
- WHEN se hace `POST /api/users/block-user`, `POST /api/users/unblock-user`
  con `id` ese valor, o `POST /api/users/make-admin` con `user_id` ese valor
- THEN la respuesta es 404 y nunca 500

#### Scenario: CA-4 — antirregresión del predicado de rango
- GIVEN un id de body `1e21`, `0` o `-5` (el caso `NaN` no sirve de testigo:
  pasa con ambos predicados)
- WHEN el guard usa `Number.isSafeInteger(id) || id <= 0` en vez de
  `Number.isInteger(id)`
- THEN el test que fija este comportamiento MUST fallar si alguien revierte
  el guard al predicado anterior

