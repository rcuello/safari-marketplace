# US-22 — Login, registro y `/me` reales con JWT

> `auth.service.ts` deja de ser un mock: la contraseña se verifica contra el
> hash de la base, el token es un JWT firmado de verdad y `/me` devuelve al
> usuario del token, no `users[0]`. El contrato HTTP no cambia.

**Épico:** [Épico 19](./README.md)
**Fecha:** 2026-08-31
**Status:** Listo para ejecución
**Depende de:** US-21
**LOC est.:** ~360

## Historia
**Como** usuario de la tienda o del admin, **quiero** que mi correo y mi
contraseña se validen de verdad y que la sesión sea mía, **para** que iniciar
sesión signifique algo más que escribir cualquier cosa en el formulario.

## Contexto

- Hoy `apps/api/rest/src/auth/auth.service.ts:41-62` hace
  un `if` sobre el email y devuelve `token: 'jwt token'`. **Cualquier
  contraseña entra.** `register()` empuja a un array en memoria. `me()`
  devuelve `users[0]` fijo, ignorando por completo el token.
- El contrato que los frontends consumen: `POST /api/token` y
  `POST /api/register` devuelven `{token, permissions[], role}`
  (`AuthResponse` en `create-auth.dto.ts`); el admin lee las tres claves
  (`apps/admin/rest/src/components/auth/login-form.tsx:47-48`),
  el shop solo las dos primeras.
- `GET /api/me` publica el usuario completo: `profile`, `permissions[]` con
  shape Laravel, `shops[]`, `wallet`, `address`, `last_order`.
- `apps/api/rest/package.json` no declara `@nestjs/jwt` ni ninguna librería de
  hashing. **`apps/api/rest` está fuera del workspace de yarn**: las
  dependencias nuevas se instalan con su propio `yarn install`.
- El enum `Permission` de `create-auth.dto.ts` usa `'Super admin'`,
  `'Store owner'`… mientras los dos frontends comparan contra `super_admin`,
  `store_owner`, `staff`, `customer`. Decisión 4 del épico: manda el snake_case.
- Precedente de migración mock → Postgres:
  `apps/api/rest/src/settings/settings.service.ts`,
  incluida la traducción camelCase → snake_case en el servicio.

## Scope

**Incluye:** `@nestjs/jwt` + `bcryptjs` como dependencias; la configuración del
módulo JWT desde el `.env`; `login`, `register`, `changePassword`, `logout` y
`me` contra `@safari/db`; la corrección del enum `Permission`; y la
documentación de la credencial demo en `apps/README.md`.

**NO incluye:** guards ni protección de rutas (US-23), recuperación de
contraseña ni OTP (US-24 — siguen siendo los stubs de hoy), social login
(decisión 11 del épico: stub declarado), los endpoints de `/api/users`
(US-25), refresh tokens, ni ningún cambio en shop o admin.

## Criterios de aceptación

### CA-1 — Login verificado contra la base
`POST /api/token` con `admin@demo.com` / `demodemo` devuelve un JWT firmado y
verificable, con los permisos y el rol que la base tiene para ese usuario.
Con contraseña incorrecta o email inexistente devuelve **401 con el mismo
mensaje genérico** en ambos casos (D-4 del épico: sin enumeración de cuentas).

### CA-2 — Un usuario inactivo no entra
Un usuario con `is_active = false` no obtiene token, aunque la contraseña sea
correcta.

### CA-3 — Registro persistente
`POST /api/register` crea el usuario en Postgres con su contraseña hasheada y
el permiso `customer`, y devuelve un token utilizable. Un email ya registrado
devuelve un error de negocio (409 o 400 declarado), no un 500 de Prisma.

### CA-4 — `/me` devuelve al titular del token
`GET /api/me` resuelve el usuario **desde el token** y publica el mismo shape
de hoy. `wallet`, `address` y `last_order` se emiten como `null`/`[]`
(decisión 13). Sin token o con token inválido: 401.

### CA-5 — Cambio de contraseña real
`POST /api/change-password` verifica la contraseña actual antes de reemplazar
el hash. Con la actual equivocada devuelve `success: false` con el shape
`CoreResponse` de hoy, no una excepción. Tras el cambio, la contraseña vieja
deja de servir y la nueva funciona.

### CA-6 — Contrato preservado y frontends vivos
Las claves y el casing de las respuestas no cambian. El login del admin
funciona en el navegador con la credencial demo y `hasAccess()` deja pasar al
dashboard; el perfil del shop renderiza sin romper (R-2 del épico).

## Escenarios Gherkin

```gherkin
Feature: Autenticacion real contra Postgres
  Scenario: CA-1 — credenciales validas
    Given la base sembrada con los 3 usuarios demo
    When se hace POST /api/token con admin@demo.com y demodemo
    Then la respuesta trae token, permissions y role
    And el token se verifica con el secreto configurado

  Scenario: CA-1 — sin enumeracion de cuentas
    When se hace POST /api/token con una contrasena incorrecta
    And se hace POST /api/token con un email que no existe
    Then ambas respuestas son 401 con el mismo mensaje

  Scenario: CA-4 — /me devuelve al titular del token
    Given un token emitido para customer@demo.com
    When se consulta GET /api/me con ese token
    Then el email devuelto es customer@demo.com
    And no es el primer usuario de la tabla

  Scenario: CA-5 — la contrasena vieja deja de servir
    Given una sesion iniciada
    When se cambia la contrasena correctamente
    And se intenta iniciar sesion con la contrasena anterior
    Then la respuesta es 401
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `apps/api/rest/package.json` | `@nestjs/jwt` + `bcryptjs` (+ tipos) |
| `apps/api/rest/src/auth/auth.module.ts` | registrar `JwtModule` con el secreto y la expiración del `.env` |
| `apps/api/rest/src/auth/auth.service.ts` | `login`, `register`, `changePassword`, `me` contra `@safari/db`; hashing y firma |
| `apps/api/rest/src/auth/dto/create-auth.dto.ts` | enum `Permission` a snake_case |
| `apps/api/rest/.env.template` | `JWT_SECRET` y `JWT_EXPIRES_IN` |
| `justfile` | incluir `JWT_SECRET` al generar el `.env` de la API en `just setup` |
| `apps/README.md` | documentar la credencial demo y las variables nuevas |

## Definición de Done

- [ ] `curl` pegado de `POST /api/token`: caso correcto (token + permissions +
      role), contraseña incorrecta (401) y email inexistente (401 con idéntico
      mensaje).
- [ ] Payload del JWT decodificado y pegado, mostrando `sub`, `email`,
      `permissions` y la expiración.
- [ ] `curl` pegado de `GET /api/me` con dos tokens distintos, demostrando que
      devuelve usuarios distintos.
- [ ] `curl` pegado de la secuencia de CA-5: cambio de contraseña, login con la
      vieja (401), login con la nueva (200).
- [ ] Comparación de key-sets de `/api/me` mock vs Postgres, con las
      divergencias declaradas una por una.
- [ ] `just build-api` limpio y `just verify` verde (los 3 frontends con
      contenido real).
- [ ] Login del admin verificado en el navegador con la credencial demo
      (captura o descripción del dashboard cargado) — CA-6.
- [ ] Status de esta US actualizado y fila del épico marcada.

## Notas para el agente ejecutor

- **`apps/api/rest` está fuera del workspace de yarn.** Las dependencias
  nuevas se instalan desde su propio directorio; no basta el `yarn install` de
  la raíz.
- **`bcryptjs`, no `bcrypt`** (decisión 6 del épico): el nativo exige node-gyp
  y las VS Build Tools, y el repo debe clonarse y correr en Windows sin
  toolchain de C++.
- `JWT_SECRET` **no** se commitea con un valor real: va en `.env.template` con
  un placeholder y lo genera `just setup`. Si falta, la API debe fallar al
  arrancar con un mensaje claro, no firmar con un default silencioso.
- Este servicio **no** protege nada todavía: sin los guards de US-23, `/me`
  valida el token pero el resto de la API sigue abierta. No adelantar el guard
  — es otra US y otra sesión.
- Los stubs que no toca esta US (`forgetPassword`, `resetPassword`,
  `verifyForgetPasswordToken`, OTP, `socialLogin`) **se quedan como están**,
  pero se les añade un comentario declarando que son stubs y en qué US se
  resuelven. Un stub silencioso que devuelve `success: true` es peor que uno
  declarado.
- `POST /api/logout` devuelve hoy `true` desde el controlador. Sin refresh
  tokens ni lista de revocación (decisión 9), sigue siendo correcto: el
  frontend borra la cookie. Declararlo en un comentario, no inventar una
  denylist de tokens.
- Preservar el shape Laravel de `permissions[]` en `/me` (con `guard_name` y
  `pivot`): es contrato, aunque el pivote se vea redundante.
