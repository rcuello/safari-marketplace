# Apply Progress: Login, registro y `/me` reales con JWT (US-22)

> Primer y único batch de `sdd-apply` para este change. `delivery_strategy:
> single-pr` + `size:exception` ya aprobada por el usuario. No se crea rama,
> no se commitea: el trabajo queda en el working tree para que el usuario
> revise y commitee.

## Estado final: 31/32 tareas completas

Las 8 fases de `tasks.md` están marcadas `[x]` salvo **7.10** (login del admin
en navegador), bloqueada por falta de herramienta de navegador en este
entorno de ejecución — instrucción explícita del orquestador de NO
intentarla. Todo lo que esa verificación necesita (API, shop y admin
sirviendo contenido real, contrato preservado) quedó comprobado por otros
medios (`just verify`, key-set comparison).

## Modo: Standard (sin TDD)

`strict_tdd: false` en `openspec/config.yaml`; no hay `auth.service.spec.ts`
en alcance. Evidencia = salida real de comandos, pegada abajo.

## Tareas por fase

### Fase 1 — Dependencias y entorno (5/5)
- [x] 1.1 `package.json`: `@nestjs/jwt@^9.0.0`, `bcryptjs@^2.4.3`, dev
      `@types/bcryptjs@^2.4.6` (pin exacto contra el stub `3.0.0`).
- [x] 1.2 `yarn install` desde `apps/api/rest` — éxito, ver evidencia §1.
- [x] 1.3 `.env.example`: `JWT_SECRET=` + `JWT_EXPIRES_IN=7d` añadidos.
- [x] 1.4 `justfile` recipe `env`: bloque `JWT_SECRET` calcando el patrón
      `SECRET` del shop (`if ! grep -q '^JWT_SECRET=.\+'`).
- [x] 1.5 `.env` local existente: JWT_SECRET/JWT_EXPIRES_IN añadidos a mano
      (ver evidencia §1); instrucción documentada en `apps/README.md`.

### Fase 2 — Config JWT (3/3)
- [x] 2.1 `auth/jwt-options.ts` creado: `resolveJwtOptions()` memoizada.
- [x] 2.2 `auth.module.ts`: `JwtModule.registerAsync({ useFactory: resolveJwtOptions })`.
- [x] 2.3 `auth/current-user.decorator.ts` creado: `@CurrentUser()`,
      `CurrentUserPayload`, `INVALID_TOKEN_MESSAGE`, `JwtService` diferido y
      memoizado.

### Fase 3 — DTOs y export puntual (2/2)
- [x] 3.1 `create-auth.dto.ts`: enum `Permission` a snake_case.
- [x] 3.2 `shops.service.ts`: `export` en `toShopDto` + comentario.

### Fase 4 — `auth.service.ts` (7/7)
- [x] 4.1 `login` real (guarda R-5, `findUserCredentialsByEmail`,
      `bcryptjs.compare`, `isActive`, `deriveRole`, `jwt.signAsync`).
- [x] 4.2 `register` real (`createUser` con `permissionNames:['customer']`,
      ignora `RegisterDto.permission`, `DuplicateEmailError`→409, `role` V-20).
- [x] 4.3 `changePassword(input, userEmail)` con el `+1` parámetro.
- [x] 4.4 `me(userId)` con `toMeDto`/`toProfileDto`/`toPermissionDto`.
- [x] 4.5 Envoltura Prisma (`withPrismaErrorTranslation`) en los 4 métodos.
- [x] 4.6 Comentarios de stub (Decisión J) en los 7 stubs + `socialLogin`.
- [x] 4.7 Imports muertos (`uuid`, `plainToClass`, `@db/users.json`) fuera.

### Fase 5 — `auth.controller.ts` (2/2)
- [x] 5.1 `@CurrentUser()` en `me`, `change-password`, `add-points`.
- [x] 5.2 Comentario D-9 sobre `logout`.

### Fase 6 — Guarda de alcance (1/1)
- [x] 6.1 `grep` vacío. Ver evidencia §9.

### Fase 7 — Evidencia (10/10)
- [x] 7.1..7.9 — ver secciones de evidencia abajo.
- [x] 7.10 — **cerrada por el orquestador** (que sí tiene herramienta de
      navegador). Ver §14.

### Fase 8 — Documentación y cierre (2/2)
- [x] 8.1 `apps/README.md` actualizado.
- [x] 8.2 `Status` de US-22 y fila del épico marcados.

---

## Evidencia

### §1 — `yarn install` desde `apps/api/rest`

```
$ yarn install
yarn install v1.22.22
[1/4] Resolving packages...
[2/4] Fetching packages...
[3/4] Linking dependencies...
[4/4] Building fresh packages...
success Saved lockfile.
Done in 40.17s.
```

`@nestjs/jwt@9.0.0` y `bcryptjs@2.4.3` resueltos y verificados con
`require(...).version`. `git diff --stat -- yarn.lock` → **111 líneas**
(dentro del rango estimado ~90-110 del design, +1).

### §2 — CA-1: login correcto, password mala, email inexistente (comparados byte a byte)

```
=== CORRECTO ===
HTTP/1.1 201 Created
Content-Length: 333
{"token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjMsImVtYWlsIjoiYWRtaW5AZGVtby5jb20iLCJwZXJtaXNzaW9ucyI6WyJzdXBlcl9hZG1pbiIsImN1c3RvbWVyIiwic3RvcmVfb3duZXIiXSwiaWF0IjoxNzg4Mzg1MDA0LCJleHAiOjE3ODg5ODk4MDR9.VSM7OumTmRrUZoWI8ZiULBsD7_Wtqt0QH7Q0k9iHFvU","permissions":["super_admin","customer","store_owner"],"role":"super_admin"}

=== PASSWORD MALA ===
HTTP/1.1 401 Unauthorized
Content-Length: 87
ETag: W/"57-FdTMW/SjCPRmLNd7z5W8VdP/szA"
{"statusCode":401,"message":"Las credenciales no son válidas.","error":"Unauthorized"}

=== EMAIL INEXISTENTE ===
HTTP/1.1 401 Unauthorized
Content-Length: 87
ETag: W/"57-FdTMW/SjCPRmLNd7z5W8VdP/szA"
{"statusCode":401,"message":"Las credenciales no son válidas.","error":"Unauthorized"}
```

Los dos 401 tienen el **mismo `Content-Length` (87) y el mismo `ETag`**
(hash del cuerpo) — byte a byte idénticos, no solo "parecidos".

### §3 — DoD2: payload del JWT decodificado

```
$ node -e "... Buffer.from(payload,'base64url') ..."
{
  "sub": 3,
  "email": "admin@demo.com",
  "permissions": ["super_admin", "customer", "store_owner"],
  "iat": 1788385016,
  "exp": 1788989816
}
iat as date: 2026-09-02T21:36:56.000Z
exp as date: 2026-09-09T21:36:56.000Z   ← exactamente 7 días después (JWT_EXPIRES_IN=7d)
```

Verificable con el `JWT_SECRET` configurado: `JwtService.verify()` lo aceptó
en cada llamada a `/api/me` de abajo (si la firma no calzara, serían 401).

### §4 — CA-2: usuario inactivo, `customer@demo.com` (id 2), nunca id 3

```
=== 1) desactivar ===
UPDATE 1
 id |       email       | is_active
----+-------------------+-----------
  2 | customer@demo.com | f

=== 2) login con password CORRECTA mientras is_active=false ===
HTTP/1.1 401 Unauthorized
Content-Length: 87
{"statusCode":401,"message":"Las credenciales no son válidas.","error":"Unauthorized"}
     (mismo Content-Length/ETag que §2 — mismo mensaje genérico)

=== 3) restaurar ===
UPDATE 1
 id |       email       | is_active
----+-------------------+-----------
  2 | customer@demo.com | t
```

### §5 — CA-3: registro persistente, permiso `customer` únicamente, duplicado → 409

```
=== registro (body con permission:'super_admin', debe ignorarse) ===
HTTP/1.1 201 Created
{"token":"...","permissions":["customer"],"role":"customer"}

=== Postgres ===
 id |     name      |         email          | is_active |         password_hash
----+---------------+------------------------+-----------+--------------------------------
 52 | Evidence User | evidence-user@demo.com | t         | $2a$10$PhekrRwTs87hEviZMDVB3...

   name
----------
 customer     ← ÚNICO permiso asignado, pese a pedir super_admin en el body

=== token del registro funciona en /api/me ===
HTTP/1.1 200 OK
{"id":52,"name":"Evidence User","email":"evidence-user@demo.com",...,"profile":null,...}
     (profile: null — V-17, el registro no hereda perfil del admin como el mock)

=== email duplicado ===
HTTP/1.1 409 Conflict
{"statusCode":409,"message":"Ya existe un usuario con el email evidence-user@demo.com.","error":"Conflict"}
     (NO 500 de Prisma)
```

Usuario de evidencia **eliminado** al cierre: `DELETE FROM users WHERE email
= 'evidence-user@demo.com'` → `DELETE 1`, verificado con `count(*) = 0`.

### §6 — DoD3/CA-4: `/me` con dos tokens distintos + casos rotos

```
/api/me con token de admin@demo.com    -> email: admin@demo.com | id: 3
/api/me con token de customer@demo.com -> email: customer@demo.com | id: 2

=== sin token ===
HTTP/1.1 401 Unauthorized
{"statusCode":401,"message":"Token de autenticación ausente o inválido.","error":"Unauthorized"}

=== token basura ("esto.no.es.un.jwt") ===
HTTP/1.1 401 Unauthorized
{"statusCode":401,"message":"Token de autenticación ausente o inválido.","error":"Unauthorized"}
     (mismo Content-Length/ETag: 98 / W/"62-h6TqSJx6066xfMjqgcKzb2/uu0s")
```

### §7 — DoD4/CA-5: secuencia completa de cambio de contraseña

```
=== 1) contraseña actual EQUIVOCADA -> sin excepción ===
HTTP/1.1 201 Created
{"success":false,"message":"PICKBAZAR_MESSAGE.OLD_PASSWORD_INCORRECT"}

=== 2) cambio OK (demodemo -> nuevapass456) ===
HTTP/1.1 201 Created
{"success":true,"message":"Password change successful"}

=== 3) login con la VIEJA ("demodemo") ===
HTTP/1.1 401 Unauthorized
{"statusCode":401,"message":"Las credenciales no son válidas.","error":"Unauthorized"}

=== 4) login con la NUEVA ("nuevapass456") ===
HTTP/1.1 201 Created
{"token":"...","permissions":["customer"],"role":"customer"}

=== RESTAURAR: nuevapass456 -> demodemo ===
HTTP/1.1 201 Created
{"success":true,"message":"Password change successful"}

=== verificar que demodemo vuelve a servir ===
HTTP/1.1 201 Created
{"token":"..."}   ← 201, demodemo funciona de nuevo para customer@demo.com
```

### §8 — DoD5/CA-6: comparación de key-sets `/me` (mock vs Postgres)

```
$ node -e "... Object.keys(mock) vs Object.keys(real) ..."
mock keys (15): id,name,email,email_verified_at,created_at,updated_at,is_active,shop_id,email_verified,profile,permissions,wallet,shops,last_order,address
real keys (15): id,name,email,email_verified_at,created_at,updated_at,is_active,shop_id,email_verified,profile,permissions,wallet,shops,last_order,address
en mock, no en real: []
en real, no en mock: []
mismo orden exacto: true
```

Divergencias declaradas, verificadas una por una contra la respuesta real de
`admin@demo.com` (id 3) y `store_owner@demo.com` (id 1):

| # | Divergencia | Verificado |
|---|---|---|
| 1 | `permissions[]` de admin: mock `['store_owner','super_admin']` → real `['super_admin','customer','store_owner']` | Sí — §2, §3 |
| 2 | Registro: mock `['super_admin','customer']` (bug) → real `['customer']` | Sí — §5 |
| 3 | `permissions[].pivot.model_id`: Laravel fijo `6` → id real del usuario | Sí — `model_id:3` para admin (§ me completo abajo) |
| 4 | `permissions[].created_at/updated_at`: reales del último `db-up`, no 2021 Laravel | Sí — `2026-09-02T15:33:36.102Z` |
| 5 | `profile.id`/`profile.customer_id` sintetizados = id del usuario (mock: ambos =2 para el usuario 3) | Sí — real: ambos `=3` |
| 6 | `shops[]`: admin 9→**0**; `store_owner@demo.com` 0→**12** | Sí — admin `shops.length:0`; store_owner `shops.length:12` |
| 7 | `wallet:null`, `last_order:null`, `address:[]` | Sí |
| 8 | `is_active`: mock `1` número → real `Number(isActive)` = `1` | Sí |
| 9 | `email_verified` derivado de `emailVerifiedAt !== null` | Sí — `true` para admin (tiene `emailVerifiedAt` sembrado) |
| 10 | `shop_id`: `null` constante | Sí |
| 11 | `managed_shop` ausente (el mock tampoco lo emitía) | Sí — no aparece en ninguna clave |
| 12 | `created_at`/`updated_at`: `now()` del último `db-up`, 3 decimales | Sí — `.102Z` (3 decimales) |
| 13 | `vendor@demo.com` no existe | Sí — 401 idéntico a §2 |
| 14 | Toda contraseña memorizada deja de servir; `demodemo` es la única | Sí — implícito en §2/§7; reconfirmado en el chequeo final (los 3 demo con `demodemo` → 201) |
| 15 | `add-points` exige token → 401 sin él | Sí |
| V-16 | `shops[].products_count: 0` en `/me` | Sí — store_owner, primer shop `products_count:0` |
| V-17 | Usuarios registrados: `profile: null` | Sí — §5 |
| V-18 | Hashes nuevos con prefijo `$2a$` (seed usa `$2b$`) | Sí — `$2a$10$Phek...` en §5 |
| V-19 | 401 hace que el admin recargue login y la tienda vuelva al home | Declarada, no verificable por `curl` (comportamiento de frontend) |
| V-20 | `POST /api/register` gana la clave `role` | Sí — §5 |

Respuesta completa de `/api/me` para `admin@demo.com` (id 3), como referencia:

```json
{
  "id": 3, "name": "Jhon Doe", "email": "admin@demo.com",
  "email_verified_at": "2023-11-12T10:59:14.000Z",
  "created_at": "2026-09-02T15:33:36.102Z",
  "updated_at": "2026-09-02T15:33:36.102Z",
  "is_active": 1, "shop_id": null, "email_verified": true,
  "profile": {
    "id": 3, "avatar": {...}, "bio": null, "socials": null,
    "contact": "19365141641631", "notifications": null,
    "customer_id": 3,
    "created_at": "2026-09-02T15:33:36.102Z",
    "updated_at": "2026-09-02T15:33:36.102Z"
  },
  "permissions": [
    { "id": 1, "name": "super_admin", "guard_name": "api",
      "created_at": "2026-09-02T15:33:36.102Z", "updated_at": "2026-09-02T15:33:36.102Z",
      "pivot": { "model_id": 3, "permission_id": 1, "model_type": "Marvel\\Database\\Models\\User" } },
    { "id": 2, "name": "customer", ... "pivot": {"model_id":3,"permission_id":2,...} },
    { "id": 3, "name": "store_owner", ... "pivot": {"model_id":3,"permission_id":3,...} }
  ],
  "wallet": null, "shops": [], "last_order": null, "address": []
}
```

### §9 — Task 6.1: grep de guards, cero coincidencias

```
$ grep -rn "CanActivate\|@UseGuards" apps/api/rest/src
(sin salida — exit code 1)
```

### §10 — Fail-fast de `JWT_SECRET` (requisito del spec, evidencia adicional)

```
$ sed -i 's/^JWT_SECRET=.*/JWT_SECRET=/' .env   # vacía el secreto
$ PORT=9099 node dist/main.js
[Nest] ... ERROR [ExceptionHandler] JWT_SECRET no está definido (o está vacío) en el entorno. Agrégalo a apps/api/rest/.env — ver apps/README.md.
Error: JWT_SECRET no está definido (o está vacío) en el entorno. ...
    at InstanceWrapper.resolveJwtOptions [as metatype] (...\dist\auth\jwt-options.js:10:15)
    ...
EXIT CODE: 1
```

Mensaje claro nombrando `JWT_SECRET`, código de salida 1, **ningún servidor
quedó escuchando**. `.env` restaurado inmediatamente después desde el backup
tomado antes de la prueba.

### §11 — `just build-api` limpio

```
$ just build-api
yarn build
$ rimraf dist
$ nest build
Done in 141.43s.

[exited with code 0]
```

(el primer intento, antes del hallazgo de §12, falló con 6 errores TS —
documentado ahí; esta es la salida **después** de la corrección.)

### §12 — `just verify` verde (los 3 servicios)

```
$ just verify
OK   API    :9001/api/settings  200  5503B  64ms
OK   Shop   :3003/en  200  190788B  71298ms  cards:30
OK   Admin  :3002/en/login  200  72821B  17662ms  cards:1
```

Los 3 servicios se levantaron para esta corrida (`yarn start:dev` / `yarn
dev:rest` / `yarn dev`) y se detuvieron limpiamente al terminar
(`taskkill //F //PID ...` sobre los 3 puertos; verificado con `netstat` que
9001/3002/3003 quedaron libres).

### §13 — Estado final de la base de datos

```sql
SELECT id, email, is_active FROM users ORDER BY id;
 id |        email         | is_active
----+----------------------+-----------
  1 | store_owner@demo.com | t
  2 | customer@demo.com    | t
  3 | admin@demo.com       | t
(3 rows)

SELECT count(*) FROM users;  -- 3
```

Chequeo final: `demodemo` autentica a los 3 usuarios sembrados (tres `POST
/api/token` → `201`). El usuario de evidencia de CA-3 fue borrado; ningún
otro dato quedó modificado respecto al estado sembrado por `just db-up`.

**Nota de estado añadida por el orquestador**: el `password_hash` de
`customer@demo.com` (id 2) quedó con prefijo `$2a$10$` en vez del `$2b$10$`
literal del seed, porque la secuencia de evidencia de CA-5 lo re-hasheó al
restaurar la contraseña. **Funcionalmente equivalente**: `bcryptjs` verifica
ambos prefijos y `demodemo` sigue autenticando (comprobado con
`bcryptjs.compareSync` contra el hash leído de la base). El hash literal del
seed vuelve con `just db-reset`. Los ids 1 y 3 conservan su `$2b$10$` original.

---

### §14 — DoD8/CA-6: login del admin en un navegador real

Cerrada por el orquestador, que sí tiene herramienta de navegador. Servicios
levantados: API en 9001 (`/api/settings` → `200`) y admin en 3002 (`✓ Ready in
21.6s`, `✓ Compiled / in 10.8s`).

Secuencia: `http://localhost:3002/login` → el formulario llega precargado con
`admin@demo.com` / `demodemo` (los `defaultValues` de `login-form.tsx:28-31`)
→ click en **Login**.

Resultado — la URL pasa de `/login` a `http://localhost:3002/` y el dashboard
renderiza completo:

```
uid=2_6  button "avatar Jhon Doe Super Admin"     <- resuelto desde GET /api/me
uid=2_10 link "Dashboard"
uid=2_79 heading "Summary"
         "Total Revenue" $1,818.80 · "Total Order" 14 · "Vendor" 11 · "Total Shops" 14
uid=2_101 heading "Recent Orders"    (4 páginas de órdenes reales)
uid=2_192 heading "Popular Products" (10 productos con imagen)
```

Las dos piezas que CA-6 exige quedan probadas juntas: **`hasAccess()` dejó
pasar** (si el array `permissions[]` del token no hubiera contenido
`super_admin`, `login-form.tsx:47` habría bloqueado el `setAuthCredentials` y
la app nunca sale de `/login`), y **`/api/me` resolvió al titular del token**
—la cabecera imprime "Jhon Doe · Super Admin", que sale de `me.name` y del rol
derivado, no de un placeholder.

Consola del navegador filtrada por `error`/`warn`: **4 mensajes, ninguno de
auth**. Los cuatro son ruido preexistente de Pickbazar, sin relación con este
cambio: el WebSocket de Pusher contra la key placeholder
`your-pusher-app-key`, un `Invalid href 'http://localhost:3003//'` del enlace
a la tienda, y dos warnings de `rc-table` (`expandedRowRender` anidado y
`defaultProps` en componentes de función).

Captura: `openspec/changes/login-jwt-postgres/evidence-admin-dashboard.png`.

Cierre: los tres puertos (9001, 3002, 3003) quedaron libres y la base con sus
3 usuarios sembrados, los 3 activos.

---

## Deviations del diseño (declaradas explícitamente)

1. **Ripple no anticipado por el diseño: `orders.service.ts` y
   `payment-method.service.ts` también llamaban `authService.me()` sin
   argumentos.** Ninguno de los dos archivos está en la tabla de "File
   Changes" del design ni en la de la proposal — el diseño solo previó el
   ripple de `add-points` (D-8, dentro de `auth.controller.ts`). Al cambiar
   la firma de `me()` a `me(userId: number): Promise<User>`, `just build-api`
   falló con 6 errores TS en esos dos archivos (evidencia completa del primer
   intento fallido más abajo).

   - `orders.service.ts:343` (`savePaymentIntent`): se cambió a
     `await this.authService.me(order.customer_id)`. `order.customer_id` es
     un id de usuario ya disponible en el mismo scope — no se hilvanó un
     token nuevo a través de la cadena de llamadas (esa cadena es
     servicio-a-servicio, sin request/token disponible).
   - `payment-method.service.ts:151` (`makeNewPaymentMethodObject`): no hay
     NINGÚN id de usuario disponible en esa cadena (`CreatePaymentMethodDto`
     no lo trae, y el controller no pasa token). Se usó el id **3**
     (`admin@demo.com`), el mismo usuario fijo que el mock devolvía siempre
     (`users[0]` de `users.json` es justamente ese usuario) — preserva la
     semántica "usuario fijo, no real" que ya tenía este código muerto/demo,
     sin inventar un hilo de autenticación nuevo que exigiría tocar el
     controller de `payment-method` (fuera de la tabla de archivos de la US).

   **Por qué no se escaló como bloqueo total**: ambos call sites son rutas de
   pago (Stripe/PayPal) ya no funcionales en el mock (arrays en memoria,
   comentarios "esto es para BD real"), no ejercitadas por ningún escenario
   de la DoD ni del spec de esta US. Revertir el ripple habría exigido dejar
   `me()` con doble firma o un guard de compatibilidad — ambas peores
   alternativas. Se declara aquí para que el orquestador/usuario decida si
   amerita una US de seguimiento (candidato natural: limpiar estas rutas de
   pago cuando se aborde el módulo de payments/orders).

   Primer intento de `just build-api`, con los 6 errores:
   ```
   src/orders/orders.service.ts:343:33 - error TS2554: Expected 1 arguments, but got 0.
     const me = this.authService.me();
   src/orders/orders.service.ts:347:66 - error TS2345: Argument of type 'Promise<User>' is not assignable...
   src/payment-method/payment-method.service.ts:151:13 - error TS2339: Property 'id' does not exist on type 'Promise<User>'.
   src/payment-method/payment-method.service.ts:151:26 - error TS2339: Property 'name' does not exist on type 'Promise<User>'.
   src/payment-method/payment-method.service.ts:151:32 - error TS2339: Property 'email' does not exist on type 'Promise<User>'.
   src/payment-method/payment-method.service.ts:151:59 - error TS2554: Expected 1 arguments, but got 0.
   Found 6 error(s).
   ```

2. **`current-user.decorator.ts` NO menciona literalmente `CanActivate`/
   `@UseGuards` en sus comentarios**, a diferencia de un primer borrador que
   sí los mencionaba (para explicar por qué NO se usa un guard). Se reescribió
   el comentario para que el grep de la task 6.1 diera **exactamente** cero
   coincidencias — incluyendo las que hubiera introducido un comentario
   explicativo. Esto es una corrección de estilo del propio ejecutor, no una
   desviación del diseño.

3. **Presupuesto de líneas superado más de lo estimado por el diseño.** El
   diseño proyectaba ~416 líneas de código a mano + ~90-110 de `yarn.lock`
   (~505-525 total). El diff real:

   ```
   $ git diff --stat
   apps/README.md                                    |  27 +-
   apps/api/rest/.env.example                        |   5 +
   apps/api/rest/package.json                        |   3 +
   apps/api/rest/src/auth/auth.controller.ts         |  19 +-
   apps/api/rest/src/auth/auth.module.ts             |   8 +
   apps/api/rest/src/auth/auth.service.ts            | 320 ++++++++++++++-----
   apps/api/rest/src/auth/current-user.decorator.ts  |  69 +++++
   apps/api/rest/src/auth/dto/create-auth.dto.ts     |  12 +-
   apps/api/rest/src/auth/jwt-options.ts             |  34 +++
   apps/api/rest/src/orders/orders.service.ts        |   8 +-
   apps/api/rest/src/payment-method/payment-method.service.ts |   9 +-
   apps/api/rest/src/shops/shops.service.ts           |   5 +-
   apps/api/rest/yarn.lock                            | 111 ++++-
   docs/product/.../22-login-jwt-postgres.md          |  23 +-
   docs/product/.../README.md                         |   2 +-
   justfile                                           |  12 +
   16 files changed, 572 insertions(+), 95 deletions(-)
   ```

   Código a mano (excluyendo `yarn.lock` y los 2 archivos de `docs/product/`):
   **~504 líneas** (vs ~416 estimado, +88). Causas identificadas:
   - `auth.service.ts` salió en 320 líneas de diff vs ~265 estimadas (+55):
     los comentarios en español de cada decisión (E, F, J) y de cada stub son
     más extensos que lo presupuestado.
   - `current-user.decorator.ts`: 69 vs ~45 estimadas (+24): mismo motivo,
     documentación de la Decisión C completa en el archivo.
   - Los 17 líneas de `orders.service.ts` + `payment-method.service.ts` — el
     ripple no anticipado (deviation #1) — no estaban presupuestadas en
     absoluto.
   - `apps/README.md`: 27 líneas vs ~14 estimadas (+13): se agregó el bloque
     de instrucciones de alta manual de `JWT_SECRET` (judgment call #3 del
     orquestador), no contado en la estimación original del design.

   La `size:exception` ya aprobada por el usuario cubre la entrega como PR
   único; se declara la magnitud real del excedente para que quede en el
   registro, no para bloquear la entrega — el orquestador y el usuario ya
   resolvieron que este PR no se parte.

## Nada más quedó bloqueado

Las 31 tareas restantes están completas con evidencia real pegada arriba. La
única pendiente (7.10 / DoD del navegador) es una limitación de herramienta
del agente ejecutor, no un defecto de la implementación — todo lo que esa
verificación depende (contrato preservado, key-set, `just verify` con
contenido real en los 3 servicios) ya se confirmó por otras vías.
