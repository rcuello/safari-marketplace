# Proposal: Login, registro y `/me` reales con JWT

> **US-22**, Épico 19. Insumo: `explore.md` (esta carpeta). Precedente de estilo:
> `archive/2026-09-02-capa-datos-identidad/`. Las decisiones **(cerradas)** las fijó el dueño
> del repo tras leer la exploración: no se re-abren en `sdd-design`.

## Intent

`auth.service.ts` es un mock completo: `login()` (`:41-62`) hace un `if` sobre el email, imprime
el body por consola (`:42`) y devuelve `token: 'jwt token'` — **cualquier contraseña entra**;
`register()` (`:26-40`) hace `this.users.push()` sobre un array en memoria que se pierde al
reiniciar; `me()` (`:154-156`) devuelve `this.users[0]`, o sea siempre `admin@demo.com`,
ignorando el token. El token viaja en cada request (`http-client.ts:174` del shop, `:28` del
admin) y **nadie lo valida**. US-21 ya dejó las 7 funciones de identidad en `@safari/db`: esta US
las conecta y `packages/db` no cambia.

## Scope

### In Scope

| Archivo | Cambio |
|---|---|
| `apps/api/rest/package.json` + `yarn.lock` | `@nestjs/jwt@^9`, `bcryptjs@^2`, `@types/bcryptjs` (dev). **Fuera del workspace: `yarn install` propio** |
| `apps/api/rest/src/auth/auth.module.ts` | `JwtModule.register({...})` leyendo `process.env` + validación fail-fast del secreto |
| `apps/api/rest/src/auth/current-user.decorator.ts` | **nuevo**: decorador de parámetro `@CurrentUser()` (D-1) |
| `apps/api/rest/src/auth/auth.service.ts` | `login`, `register`, `changePassword`, `me` contra `@safari/db`; traducción camelCase→snake_case; comentarios de stub declarado |
| `apps/api/rest/src/auth/auth.controller.ts` | `@CurrentUser()` en `me`, `change-password` y `add-points` (D-8); comentario en `logout` |
| `apps/api/rest/src/shops/shops.service.ts` | **solo** añadir `export` a `toShopDto` (~2 líneas, D-9). Ripple aprobado fuera de la tabla de la US |
| `apps/api/rest/src/auth/dto/create-auth.dto.ts` | enum `Permission` a snake_case (D-4 del épico) |
| `apps/api/rest/.env.example` | `JWT_SECRET=` (placeholder) y `JWT_EXPIRES_IN=7d`. **No existe `.env.template`** — `justfile:59` copia `.env.example` |
| `justfile` (recipe `env`) | generar `JWT_SECRET` random calcando el bloque `SECRET` del shop (`justfile:62-66`) |
| `apps/README.md` (sección "4. Credenciales", `:94-102`) | credencial `demodemo` y las dos variables nuevas |

### Out of Scope (vinculante — "NO incluye" de la US)

Guards, `CanActivate`, `@UseGuards`, `@Public()` — **ni siquiera locales** (US-23) · recuperación
de contraseña y OTP (US-24) · social login (D-11: stub declarado) · endpoints de `/api/users`
(US-25) · refresh tokens y denylist (D-9) · **cualquier** cambio en shop o admin · `packages/db`,
`db/schema.sql`, `db/generate-seed.mjs`, `db/seed.sql` · `auth.service.spec.ts` (hay precedente
jest real —`products.service.spec.ts` 628 líneas, `shops.service.spec.ts` 143— pero la DoD pide
evidencia por `curl` y sumarlo son ~200 líneas más de presupuesto).

**Adyacentes detectadas y NO accionadas**: el **segundo** enum `Permission`, independiente, en
`users/dto/create-user.dto.ts:6-11` conserva los valores viejos (`'Super admin'`) — es de
`/api/users`: **deuda heredada declarada para US-25** · `uuid` se importa en `auth.service.ts:17`
sin estar en `package.json` (preexistente; la US deja de importarlo y se disuelve solo) ·
`CLAUDE.md` afirma que `apps/api/rest` no tiene ningún `*.spec.ts`: hoy tiene dos.

## Capabilities

### New Capabilities

- `auth-jwt-api`: autenticación real de la API REST — login verificado contra el hash de
  Postgres, JWT firmado, registro persistente, cambio de contraseña y `/me` resuelto desde el
  token, preservando el contrato HTTP heredado de Laravel.

### Modified Capabilities

- None. `identity-data-layer` no cambia: esta US **consume** sus 7 funciones sin alterar ninguna
  firma.

## Approach — decisiones cerradas

**D-1 — Un decorador de parámetro compartido, nunca un guard.** `GET /api/me` (CA-4) y
`POST /api/change-password` (CA-5) resuelven el usuario actual con **un solo** `@CurrentUser()`
que extrae el bearer del header `Authorization`, lo verifica con `JwtService` y devuelve el
payload; token ausente o inválido → **401**. CA-5 lo exige tan silenciosamente como CA-4 lo dice:
el body que ambos frontends ya envían es `{oldPassword, newPassword}`, **sin email ni id**
(`admin/rest/src/types/index.ts:1526-1529`, `shop/src/types/index.ts:748`). Dos consumidores →
DRY gana; y US-23 reutiliza el mismo decorador dentro de su guard (alimentado por `request.user`)
sin tocar firmas de servicio. Cero clases `CanActivate`.

**D-2 — Email duplicado en registro → 409 `ConflictException`**, traducido del
`DuplicateEmailError` que `@safari/db` ya lanza (`users.repository.ts:250-260`). Resuelve el
"409 o 400 declarado" de CA-3 a favor de 409. Sin precedente propio de errores HTTP de auth en el
repo: excepciones estándar de `@nestjs/common`, sin formato inventado.

**D-3 — `JWT_EXPIRES_IN=7d` y `JWT_SECRET` validado en bootstrap.** 7 días porque no hay refresh
tokens (D-9) y un TTL corto forzaría re-login a media sesión en un monorepo didáctico. El secreto
se lee con `process.env.JWT_SECRET` al construir `JwtModule.register({...})` —estilo real del
repo: ningún archivo de `apps/api/rest/src` usa `ConfigService`; precedente
`StripeModule.forRoot({ apiKey: process.env.STRIPE_API_KEY })`, `app.module.ts:50-54`— y si falta
o está vacío la API **falla al arrancar con mensaje claro**, nunca con un default silencioso.

**D-4 — Payload: `{ sub, email, permissions }`** (`sub` = id numérico) + `iat`/`exp` de la firma.
Es literalmente D-9 del épico y lo que la DoD exige decodificar. `permissions` viaja en el token
para que el guard de US-23 (D-5 del épico) autorice sin ir a la base. **`role` NO va en el
payload**: es derivable.

**D-5 — `role` se deriva por precedencia** `super_admin > store_owner > staff > customer` sobre
`permissions[]`. Reproduce **exactamente** el mock para los 3 sembrados (admin→`super_admin`,
store_owner→`store_owner`, customer→`customer`). Se emite porque el admin lo guarda
(`login-form.tsx:48`), pero **ningún `hasAccess()` lo lee**: ambas copias
(`admin/rest/src/utils/auth-utils.ts:54-64`, `shop/.../auth-utils.ts:52-62`) comparan
`permissions[]`. Ese array es el contrato que de verdad abre el dashboard.

**D-6 — El registro concede siempre `customer`** e **ignora** `RegisterDto.permission`
(`create-auth.dto.ts:12`): aceptar un permiso del body es escalada de privilegios. El campo se
mantiene en el DTO (contrato) con el enum ya corregido a snake_case.

**D-7 — La divergencia de `permissions[]` de `admin@demo.com` se acepta y se declara.** No se
toca el seed; `hasAccess()` pasa porque `super_admin` sigue presente.

## Contrato: endpoint por endpoint

| Endpoint | Hoy | Después |
|---|---|---|
| `POST /api/token` | `if` sobre email, token literal | `findUserCredentialsByEmail` + `bcryptjs.compare`; `isActive=false` → 401 (CA-2); credencial mala **o** email inexistente → **401 con mensaje idéntico** (D-4 del épico) |
| `POST /api/register` | `push` a array en memoria | `createUser` con hash costo 10 + permiso `customer`; devuelve token usable; duplicado → 409 |
| `POST /api/change-password` | `success: true` fijo | verifica la actual; mal → `CoreResponse {success:false}` (**no** excepción, CA-5); bien → `updateUserPasswordHash` |
| `GET /api/me` | `users[0]` | `findUserWithRelations(payload.sub)`; sin token/inválido → 401 |
| `POST /api/logout` | `return true` (`auth.controller.ts:56-59`) | **sin cambios**. Sin refresh ni revocación (D-9) el frontend borra la cookie: solo se añade un comentario. No se inventa denylist |

## Divergencias declaradas (lo que muerde en `verify`)

El key-set de `/me` hoy son 15 claves (`users.json`, usuario 3):
`id,name,email,email_verified_at,created_at,updated_at,is_active,shop_id,email_verified,profile,permissions,wallet,shops,last_order,address`.
Se preserva **entero**; divergen valores y tipos:

| # | Divergencia | Tratamiento |
|---|---|---|
| 1 | `POST /api/token` de `admin@demo.com`: mock `['store_owner','super_admin']` → base `['super_admin','customer','store_owner']` | D-7. Cambia contenido y orden; `hasAccess()` intacto |
| 2 | `POST /api/register`: mock devolvía `['super_admin','customer']` (bug: super_admin a cualquiera) → `['customer']` | D-6 |
| 3 | `permissions[].pivot` no existe en `PermissionRecord` (`records.ts:166-172`) | Se **sintetiza en el servicio** (D-3 del épico): `{model_id: userId, permission_id, model_type:'Marvel\\Database\\Models\\User'}`. `model_id` pasa de 6 (Laravel) al id real |
| 4 | `permissions[].created_at/updated_at` | Reales del pivote/catálogo; fechas del último `db-up`, no las del mock |
| 5 | `profile.id` y `profile.customer_id` no existen en `ProfileRecord` (`db/schema.sql`: la PK es `user_id`, US-20 D-4) | Se sintetizan ambas = `userId`. Clave preservada porque `shop/src/pages/profile.tsx:26` hace `me.profile?.id!` |
| 6 | `shops[]`: admin pasa de **9** (mock) a **0**; `store_owner@demo.com` de 0 a **12** — las 12 tiendas tienen `owner_id=1` | Es el dato correcto de la base. Se traduce con `toShopDto`, exportada de `shops.service.ts` (D-9, aprobada) |
| 7 | `wallet: null`, `last_order: null`, `address: []` | D-13. Verificado seguro: `sidebar.tsx:32-40` y `authorized-menu.tsx:61` usan `?? 0`; `maintenance/layout.tsx:147` cortocircuita con `&&` |
| 8 | `is_active`: mock emite `1` (número Laravel) → Postgres `true` (boolean) | Se emite `Number(isActive)`, calcando `toShopDto` (`shops.service.ts:52`) |
| 9 | `email_verified` no tiene columna (redundante, `db/schema.sql:112-114`) | Se deriva: `emailVerifiedAt !== null`. Sin consumidores en los frontends |
| 10 | `shop_id` no tiene columna | `null`. Sin consumidores |
| 11 | `managed_shop` **hoy no lo emite el mock** (ausente en `users.json`) | Sigue ausente. El admin lo lee siempre con `?.` (20+ sitios) |
| 12 | `created_at/updated_at`: `now()` del último `db-up` y 3 decimales, no los 6 de Laravel | Misma divergencia ya embarcada por `/api/settings` |
| 13 | `vendor@demo.com` (documentado en `apps/README.md:101`) no existe en la base | 401. Se corrige la tabla del README |
| 14 | Toda contraseña memorizada deja de servir (R-5 del épico) | `demodemo` es la única válida; se documenta |
| 15 | `POST /api/add-points` pasa de devolver `users[0]` **sin token** a exigir token → **401** sin él | D-8 (aprobada). Ripple obligatorio: la firma de `me()` cambia y el endpoint no compilaría. El admin ya manda `Authorization: Bearer` en todo request |

## Stubs declarados (comentario, cero cambio de comportamiento)

`forgetPassword`, `verifyForgetPasswordToken`, `resetPassword`, `verifyOtpCode`, `sendOtpCode`,
`otpLogin` → comentario "stub; lo resuelve **US-24**". `socialLogin` → "stub declarado por
**D-11** del épico (requiere credenciales OAuth externas)". Los cuerpos no se tocan: un stub
silencioso que devuelve `success: true` es peor que uno declarado.

## Risks

| Riesgo | Sev. | Mitigación |
|---|---|---|
| **R-1**: `/me` publica 15 claves y solo 7 salen del record; una sintetizada mal rompe el perfil del shop o el dashboard del admin | **Media** | La tabla de divergencias es el checklist; la DoD exige comparar key-sets clave por clave **y** abrir el navegador (R-2 del épico), no solo `curl` |
| **R-2**: alguien "termina el trabajo" y añade un guard local para probar `/me` | **Media** | D-1 lo prohíbe explícitamente; `sdd-verify` debe fallar la US si aparece `CanActivate`/`@UseGuards` |
| **R-3**: `yarn install` en `apps/api/rest` (fuera del workspace) desincroniza `yarn.lock` o arrastra ~100 líneas de lock por `jsonwebtoken` (hoy ausente del lock) | **Media** | Instalar **solo** desde ese directorio, con versiones fijadas; revisar el diff del lock aparte del código |
| **R-4**: el presupuesto de 400 líneas se supera contando `yarn.lock` (ver estimación) | **Media** | Corte en dos PRs propuesto abajo |
| **R-5**: `LoginDto` es `PartialType` — `email`/`password` son opcionales; un body vacío llega a `bcrypt.compare(undefined)` | Baja | Guardas explícitas → mismo 401 genérico. `ValidationPipe` está sin `whitelist` (`main.ts:9`) y los DTO de auth no tienen decoradores: fuera de alcance arreglarlo |
| **R-6**: la base caída convierte el login en un 500 opaco | Baja | Reusar `isPrismaConnectionError`/`getUserFriendlyMessage`, ya exportados y usados por `shops.service.ts` |
| **R-7**: `JWT_SECRET` rotado invalida todas las cookies vivas | Baja | Esperado; se documenta en `apps/README.md` |

## Rollback Plan

1. **Código**: `git checkout apps/api/rest apps/README.md justfile` + `just build-api`. Restaura
   el mock íntegro (el login vuelve a aceptar cualquier contraseña).
2. **Dependencias**: el `git checkout` de `package.json` + `yarn.lock` basta para el repo, pero
   `node_modules` local queda con `@nestjs/jwt`/`bcryptjs`: correr `yarn install` **desde
   `apps/api/rest`** para volver al árbol exacto. No afecta a otro paquete (fuera del workspace).
3. **`.env`**: `JWT_SECRET`/`JWT_EXPIRES_IN` quedan huérfanas en el `.env` local (no versionado).
   Son inertes con el mock; borrarlas es cosmético.
4. **Datos — el único rollback que git no deshace**: los usuarios creados por el
   `POST /api/register` **real** persisten en Postgres tras revertir el código, a diferencia del
   array en memoria de hoy. Tratamiento: `just db-reset` devuelve la base a los 3 usuarios
   sembrados (autorizado por D-1 del épico: no hay producción); para conservar el catálogo,
   borrar por email los usuarios de prueba —las 4 FK hijas son `CASCADE`, salvo `shops.owner_id`
   que es `RESTRICT`.

## Estimación de líneas (additions + deletions)

| Archivo | Líneas |
|---|---|
| `auth.service.ts` (≈54 borradas + ≈210 nuevas: 4 métodos, traducción de 15 claves, pivote, precedencia de rol, comentarios de stub) | ~265 |
| `current-user.decorator.ts` (nuevo) | ~45 |
| `auth.module.ts` | ~22 |
| `auth.controller.ts` | ~15 |
| `apps/README.md` | ~14 |
| `justfile` | ~8 |
| `create-auth.dto.ts` | ~8 |
| `.env.example` | ~4 |
| `package.json` | ~3 |
| `shops.service.ts` (exportar `toShopDto` — OQ-2 **aprobada**) | ~2 |
| **Subtotal código escrito a mano** | **~386** |
| `yarn.lock` (generado: `jsonwebtoken`, `jws`, `jwa`, `ecdsa-sig-formatter`, ~9 `lodash.*`, `bcryptjs`, tipos) | **~90-110** |
| **Total** | **~475-500** |

**El total supera el presupuesto de 400 líneas**; el código a mano (~386) no. La US estimaba
~360, coherente con el subtotal.

**Decisión de entrega (usuario, 2026-09-02): UN solo PR con `size:exception` registrada.**
La excedencia es **íntegramente** `apps/api/rest/yarn.lock`, artefacto generado por
`yarn install` y no código revisable línea por línea. La US se declara releasable sola y no se
parte. Queda descartado el corte en dos PRs encadenados que se contemplaba aquí
(**PR#1** deps + `JwtModule` + `login`/`register`; **PR#2** `@CurrentUser()` + `/me` +
`change-password` + docs): `sdd-tasks` NO debe planificar PRs encadenados.
`delivery_strategy` de la sesión: `single-pr` + `size:exception` de alcance lock-only.

## Dependencies

`just db-up` con la base sembrada (el hash real de `demodemo` ya está en `db/seed.sql:50-54`) ·
`just db-build` si `packages/db/dist/` no existe · `yarn install` **dentro de `apps/api/rest`**.

## Open Questions — RESUELTAS (usuario, 2026-09-02)

Las dos cruzaban la tabla de archivos de la US y ambas quedaron **aprobadas** como ripples
declarados. `sdd-spec`, `sdd-design`, `sdd-tasks` y `sdd-apply` las heredan cerradas; no se
vuelven a abrir.

1. **D-8 (ex OQ-1) — `POST /api/add-points` recibe el mismo `@CurrentUser()`. APROBADO.**
   `auth.controller.ts:71-74` llama hoy a `authService.me()` y no está en la tabla de archivos de
   la US. Al pasar `me()` a recibir el payload del token, ese endpoint **deja de compilar**: es un
   ripple obligatorio, no una mejora oportunista. Se le da el mismo decorador y se declara la
   divergencia colateral: **antes devolvía `users[0]` sin token; ahora exige token → 401 sin él.**
   El flujo real sobrevive porque el admin ya manda `Authorization: Bearer` en todo request
   (`admin/rest/src/data/client/http-client.ts:28`). Esta divergencia se suma a la tabla de
   divergencias declaradas y al key-set comparison de CA-6.
2. **D-9 (ex OQ-2) — exportar `toShopDto` y reusarla. APROBADO.**
   `findUserWithRelations` devuelve `ShopRecord[]` en camelCase; la traducción a la forma Laravel
   ya existe como función privada del módulo de tiendas (`toShopDto`, `shops.service.ts:42-62`).
   Se **exporta** (~2 líneas en `shops.service.ts`) y `auth.service.ts` la importa, en vez de
   duplicar ~28 líneas. Una sola definición del shape de tienda evita que `/me` y `/api/shops`
   diverjan con el tiempo. Es el cambio más pequeño posible fuera de la tabla de la US.
   Nota heredada de US-5 (Decisión E, comentario en `shops.service.ts:65`): `near-shop.json` NO
   reutiliza `toShopDto`; ese caso sigue igual y no se toca.

Nada queda abierto: las 4 decisiones de negocio están cerradas (D-1, D-2, D-3, D-7), las 2
anteriores también, la entrega es un PR único con `size:exception` lock-only, y `packages/db` no
necesita ni una función nueva.

## Success Criteria (1:1 con la DoD de la US)

- [ ] **CA-1** `curl` pegado: login correcto (`token`+`permissions`+`role`), contraseña mala
      (401) y email inexistente (401 **con mensaje idéntico**, comparados uno junto al otro).
- [ ] **CA-1/D-4** payload del JWT decodificado y pegado con `sub`, `email`, `permissions`, `exp`.
- [ ] **CA-2** `curl` de un usuario con `is_active=false` → sin token.
- [ ] **CA-3** registro persistente (fila en Postgres, permiso `customer`, token usable) y email
      repetido → **409**, no 500.
- [ ] **CA-4** `curl` de `/me` con **dos** tokens distintos devolviendo usuarios distintos.
- [ ] **CA-5** secuencia pegada: cambio OK → login con la vieja (401) → login con la nueva (200);
      y contraseña actual equivocada → `{success:false}` sin excepción.
- [ ] **CA-6** comparación de key-sets mock vs Postgres con las **15 divergencias** de la tabla
      declaradas una por una; `just build-api` limpio; `just verify` verde; login del admin
      verificado en el navegador con `demodemo` y perfil del shop renderizado (R-2 del épico).
- [ ] `apps/README.md` actualizado · status de US-22 y fila del épico marcadas.
