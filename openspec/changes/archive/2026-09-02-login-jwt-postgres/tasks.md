# Tasks: Login, registro y `/me` reales con JWT

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~416 a mano + ~90-110 generadas (`yarn.lock`) |
| 400-line budget risk | High |
| Chained PRs recommended | No |
| Suggested split | PR único (`size:exception` ya aprobada) |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Cambio completo (deps + código + docs/env) | PR único | `size:exception` registrada; excedente es sobre todo `yarn.lock`. Sin PRs encadenados. |

## Prerequisites

- `just db-up` con la base sembrada (`demodemo`, `db/seed.sql:50-54`).
- `just db-build` si `packages/db/dist/` no existe.
- `yarn install` **dentro de `apps/api/rest`** (fuera del yarn workspace).

## Phase 1: Dependencias y entorno

- [x] 1.1 `apps/api/rest/package.json`: `@nestjs/jwt@^9`, `bcryptjs@^2`, dev-dep `@types/bcryptjs` **pinneada a `^2.4.6`** (sin pin resuelve `3.0.0`, stub deprecado).
- [x] 1.2 `yarn install` **desde `apps/api/rest`** (no desde la raíz); verificar `yarn.lock` de ese directorio.
- [x] 1.3 `.env.example`: `JWT_SECRET=` (placeholder) y `JWT_EXPIRES_IN=7d`. No crear `.env.template`.
- [x] 1.4 `justfile` recipe `env`: bloque que genera `JWT_SECRET` calcando `SECRET` del shop (`:62-66`, mismo `if ! grep -q`) + `JWT_EXPIRES_IN=7d`.
- [x] 1.5 El `.env` local ya existente de `apps/api/rest` no se regenera con `just setup`: documentar cómo agregarle ambas variables a mano.

## Phase 2: Config JWT (archivos nuevos)

- [x] 2.1 Crear `auth/jwt-options.ts`: `resolveJwtOptions()` memoizada, único lector de `JWT_SECRET`/`JWT_EXPIRES_IN`, `throw` si falta/vacío (Decisión B).
- [x] 2.2 `auth.module.ts`: `JwtModule.registerAsync({ useFactory: resolveJwtOptions })` (Decisión A); el fail-fast ocurre al instanciar el provider.
- [x] 2.3 Crear `auth/current-user.decorator.ts`: `CurrentUserPayload`, `@CurrentUser()` vía `createParamDecorator`, `JwtService` diferido y memoizado (nunca al importar el archivo), `INVALID_TOKEN_MESSAGE`, cero `CanActivate` (Decisión C).

## Phase 3: DTOs y export puntual

- [x] 3.1 `auth/dto/create-auth.dto.ts`: enum `Permission` a snake_case (Decisión I); no tocar el enum de `users/dto/create-user.dto.ts` (US-25).
- [x] 3.2 `shops/shops.service.ts:42`: `export` a `toShopDto` + comentario de una línea (D-9). No mover ni renombrar.

## Phase 4: `auth.service.ts` — métodos reales

- [x] 4.1 `login`: guarda R-5 (email/password vacíos) → 401; mala/inexistente/`isActive=false` → mismo 401 (`INVALID_CREDENTIALS_MESSAGE`); `bcryptjs.compare`; `deriveRole` (Decisión F); `jwt.signAsync({sub,email,permissions})`.
- [x] 4.2 `register`: `createUser({...,permissionNames:['customer']})`, ignora `RegisterDto.permission` (D-6); `DuplicateEmailError`→409; emite `role` (V-20).
- [x] 4.3 `changePassword(input, userEmail)`: +1 parámetro; actual incorrecta → `CoreResponse{success:false}` sin excepción; correcta → hash + `updateUserPasswordHash`.
- [x] 4.4 `me(userId)`: `findUserWithRelations` + `toMeDto`/`toProfileDto`/`toPermissionDto`, 15 claves (Decisión E); `shops` vía `toShopDto` (3.2); `wallet`/`last_order`/`shop_id` null, `address` `[]`.
- [x] 4.5 Envolver los 4 métodos: Postgres caído → `ServiceUnavailableException`, otro error Prisma → `InternalServerErrorException` (reusar `isPrismaConnectionError`/`getUserFriendlyMessage`, `shops.service.ts`).
- [x] 4.6 Comentario de stub (Decisión J) en los 6 stubs de password/OTP y en `socialLogin` (variante D-11); cuerpos intactos.
- [x] 4.7 Quitar imports muertos: `uuid`, `plainToClass`, `@db/users.json`.

## Phase 5: `auth.controller.ts`

- [x] 5.1 `@CurrentUser()` en `me`, `change-password` y `add-points` (D-8/V-15: ripple obligatorio).
- [x] 5.2 Comentario de la Decisión J sobre `logout` (`:56-59`), cuerpo intacto.

## Phase 6: Guarda de alcance

- [x] 6.1 `grep -rn "CanActivate\|@UseGuards" apps/api/rest/src` → cero coincidencias nuevas; pegar salida vacía.

## Phase 7: Evidencia — un ítem por checkbox de la DoD de US-22

- [x] 7.1 (DoD1/CA-1) Tres `curl -i POST /api/token`: correcto (200), password mala (401), email inexistente (401) — comparar los dos 401 byte a byte.
- [x] 7.2 (DoD2) `node -e` decodificando el JWT: `sub`, `email`, `permissions`, `iat`, `exp`.
- [x] 7.3 (CA-2) Secuencia SQL del design (desactivar `customer@demo.com` → `curl` 401 → **restaurar** + `SELECT`). Nunca id 3.
- [x] 7.4 (CA-3) `curl POST /api/register` con `permission:'super_admin'` → verificar en `db-shell` solo `customer`; repetir mismo email → 409.
- [x] 7.5 (DoD3/CA-4) Dos `curl GET /api/me` con tokens de `admin@demo.com` y `customer@demo.com` → `email` distinto.
- [x] 7.6 (DoD4/CA-5) Secuencia: cambio OK → login viejo (401) → login nuevo (200); actual equivocada → `{success:false}` sin excepción.
- [x] 7.7 (DoD5/CA-6) `node -e` comparando `Object.keys()` de `/me` real vs `users.json` (`jq` no instalado); declarar V-7..V-20 una por una.
- [x] 7.8 (DoD6) `just build-api` limpio, pegar salida.
- [x] 7.9 (DoD6) `just verify` verde, pegar salida.
- [ ] 7.10 (DoD7/CA-6, R-2 épico) Login del admin en navegador con `demodemo`; dashboard accesible, perfil del shop renderiza. **BLOQUEADO**: el agente ejecutor no tiene herramienta de navegador (instrucción explícita del orquestador de NO intentarlo). Pendiente para el orquestador/usuario.

## Phase 8: Documentación y cierre

- [x] 8.1 `apps/README.md` "4. Credenciales" (`:94-102`): credencial real `demodemo`, las dos variables nuevas, corregir que `vendor@demo.com` no existe (V-13).
- [x] 8.2 (DoD8) `Status` en `22-login-jwt-postgres.md` + fila US-22 en `19-autenticacion-autorizacion/README.md:58`.
