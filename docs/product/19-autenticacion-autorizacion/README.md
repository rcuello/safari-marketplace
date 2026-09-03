# Épico 19 — Autenticación y autorización desde Postgres

> `apps/api/rest/src/auth/auth.service.ts` es hoy un mock completo: `login()`
> no valida contraseña, devuelve el string literal `'jwt token'`, y ninguna de
> las 249 rutas de la API está protegida. Este épico crea el dominio de
> identidad en la base, lo sirve vía `@safari/db` y cierra el círculo con
> guards reales, sin cambiar el contrato HTTP que los dos frontends ya
> consumen.

**Fecha:** 2026-08-31
**Status:** Refinado

## Contexto verificado

- **El mock**: `apps/api/rest/src/auth/auth.service.ts:20-21`
  carga `users.json` a un array en memoria.
  `apps/api/rest/src/auth/auth.service.ts:41-62` hace un
  `if` sobre el email y devuelve `token: 'jwt token'` — **cualquier contraseña
  entra**. `register()` empuja al array (se pierde al reiniciar). `me()`
  devuelve `users[0]` fijo, ignorando el token. `changePassword`,
  `forgetPassword`, `resetPassword`, `verifyOtpCode` y `sendOtpCode` son stubs
  que siempre devuelven `success: true`.
- **No hay tabla de usuarios**: `db/schema.sql:13-15`
  declara órdenes, usuarios, carritos, reviews y pagos *fuera de alcance
  deliberado*. `packages/db` no tiene `users.repository.ts` ni modelo `User`.
- **No hay ni un guard**: `grep -rn "CanActivate|AuthGuard|passport|JwtService|bcrypt"`
  sobre `apps/api/rest/src` devuelve **0 resultados** en 249 rutas HTTP
  repartidas en 44 módulos. `apps/api/rest/package.json` no declara
  `@nestjs/jwt`, `passport` ni ninguna librería de hashing.
- **El token sí viaja**: el shop lo adjunta en cada request
  (`apps/shop/src/framework/rest/client/http-client.ts:174`,
  `Authorization: Bearer <token>`) y guarda `{token, permissions}` en la cookie
  `AUTH_CRED`. El admin usa la misma utilidad con un tercer argumento
  (`setAuthCredentials(token, permissions, role)`,
  `apps/admin/rest/src/components/auth/login-form.tsx:48`).
  Nadie lo valida del lado del servidor: hoy es decorativo.
- **Los roles son snake_case en ambos frontends**: `super_admin`,
  `store_owner`, `staff`, `customer` (`apps/admin/rest/src/utils/constants.ts:4-7`
  y `apps/shop/src/lib/constants/index.ts:10-11`). El enum `Permission` del DTO
  de la API usa otros valores (`'Super admin'`, `'Store owner'`) — divergencia
  del mock que este épico resuelve a favor del snake_case, que es lo que
  `hasAccess()` compara de verdad.
- **Los datos de partida**: `users.json` trae **3** usuarios —
  `store_owner@demo.com` (id 1), `customer@demo.com` (id 2), `admin@demo.com`
  (id 3)— y **ninguno tiene campo `password`**. `shops.json` trae 9 tiendas,
  todas con `owner_id = 1`, y la base sembrada termina con 12 (3 las recupera
  `db/generate-seed.mjs` de los JSON de productos). El id 1 existe entre los
  usuarios, así que la FK `shops.owner_id → users.id` es viable.
- **`shops.owner_id` ya existe** (`db/schema.sql:118`)
  como `bigint NOT NULL DEFAULT 1` **sin FK**, porque no había a quién apuntar.

## Subdivisión en sub-historias

| US | Título | Releasable solo | Depende de | LOC est. | Status |
|----|--------|-----------------|------------|----------|--------|
| [US-20](./20-esquema-identidad-postgres.md) | Esquema de identidad en Postgres | Sí | ninguna | ~380 | ✅ Implementada |
| [US-21](./21-capa-datos-identidad.md) | Capa de datos de identidad en `@safari/db` | Sí | US-20 | ~450 | ✅ Implementada |
| [US-22](./22-login-jwt-postgres.md) | Login, registro y `/me` reales con JWT | Sí | US-21 | ~360 | ✅ Implementada |
| [US-23](./23-guards-autorizacion-api.md) | Autorización: guard global y permisos por ruta | Sí | US-22 | ~400 | ✅ Implementada |
| [US-24](./24-recuperacion-password-otp.md) | Recuperación de contraseña y OTP contra la base | Sí | US-22 | ~300 | Listo para ejecución |
| [US-25](./25-endpoints-usuarios-postgres.md) | Endpoints de usuarios y staff desde Postgres | Sí | US-21, US-23 | ~420 | Listo para ejecución |

**Orden sugerido:** US-20 → US-21 → US-22 → (US-23 ∥ US-24) → US-25.
US-23 y US-24 no comparten archivos (guards y decoradores nuevos vs.
`auth.service.ts` + repositorio de tokens), pero **US-25 rebasea sobre el
decorador `@Permissions()` que introduce US-23**: no arrancarla antes.

## Refinamiento — Decisiones tomadas

| # | Tema | Decisión |
|---|------|----------|
| 1 | `just db-reset` | **Autorizado por el dueño del repo (2026-08-31)**: el proyecto no está en producción. El DDL es idempotente y no altera tablas existentes, así que adoptar el esquema de identidad exige recrear la base. |
| 2 | Todo el DDL de identidad va en US-20 | Incluidas las tablas de tokens de recuperación y OTP, que solo se usan en US-24. Partirlo obligaría a un segundo `db-reset` a mitad del épico. Un DDL, un reset. |
| 3 | Contrato HTTP | Se preserva: `POST /api/token` sigue devolviendo `{token, permissions[], role}` y `GET /api/me` el mismo shape que hoy. Regla 4 de `docs/product/README.md`. |
| 4 | Valores de permisos | `snake_case` (`super_admin`, `store_owner`, `staff`, `customer`), que es lo que `hasAccess()` compara en los dos frontends. El enum `Permission` del DTO se corrige para emitir esos valores. |
| 5 | Modelo de permisos | Tabla `permissions` + pivote `permission_user`, reproduciendo el shape Laravel (`name`, `guard_name`, `pivot`) que `/me` ya publica. Fidelidad al contrato por encima de elegancia del modelo. |
| 6 | Hashing | **`bcryptjs`** (JavaScript puro). `bcrypt` nativo exige node-gyp y las VS Build Tools; el equipo trabaja en Windows y el repo debe clonarse y correr sin toolchain de C++. Coste 10. |
| 7 | Contraseña demo | `demodemo` para los 3 usuarios sembrados, documentada en `apps/README.md`. Sin esto, el equipo pierde el acceso al admin en cuanto el login valide de verdad. |
| 8 | Hash en el seed | `db/seed.sql` es SQL estático: el hash va **precomputado como literal** en `db/generate-seed.mjs`, con el comando para regenerarlo en un comentario. El generador no gana dependencias. |
| 9 | JWT | Firmado con `JWT_SECRET` del `.env`, expiración 7 días, payload `{sub, email, permissions}`. **Sin refresh tokens**: ninguno de los dos frontends los usa — guardan un único token en cookie. |
| 10 | Postura del guard | **Deny by default**: guard JWT global + `@Public()` explícito en lo que hoy es público. Es la práctica correcta y el repo es didáctico. El riesgo se gestiona en R-1. |
| 11 | Social login | **Fuera de alcance.** `POST /api/social-login-token` sigue siendo un stub declarado: requiere credenciales de proveedores OAuth externos, que son una decisión de infraestructura, no de este épico. |
| 12 | Envío de correo y SMS | Fuera de alcance. Los tokens de recuperación y los códigos OTP se persisten y se emiten **al log del servidor**; integrar un proveedor real es otro épico. |
| 13 | `wallet`, `address`, `last_order` en `/me` | No tienen tabla y este épico no las crea (dominio transaccional). Se emiten como `null`/`[]`. Riesgo verificable en R-2. |

## Visión técnica compartida

### Decisiones de Diseño (D-N)

- **D-1:** Los servicios de Nest consumen los repositorios de `@safari/db`;
  la API no importa `@prisma/client` directo (hereda la D-1 del Épico 1).
- **D-2:** El hash de la contraseña **nunca sale del repositorio**. El
  `UserRecord` público no lleva `passwordHash`; solo lo devuelve una función
  dedicada (`findUserCredentialsByEmail`) que consume exclusivamente el login.
- **D-3:** La traducción camelCase (capa de datos) → snake_case (API) vive en
  los servicios de Nest, igual que en `settings.service.ts`.
- **D-4:** Un fallo de autenticación devuelve **401 con mensaje genérico**, sin
  distinguir "usuario no existe" de "contraseña incorrecta" (evita enumeración
  de cuentas). Falta de permisos es **403**.
- **D-5:** El guard resuelve los permisos **desde el token**, sin ir a la base
  en cada request. El coste: revocar un permiso no surte efecto hasta que el
  token expira. Aceptado y documentado.

### Riesgos (R-N)

- **R-1 (alto):** un guard global sin `@Public()` en un endpoint de catálogo
  rompe el SSR de la tienda entera — el shop llama `/api/settings`,
  `/api/products`, `/api/types` y `/api/categories` **sin token** en cada
  render. Mitigación: US-23 inventaria las rutas públicas antes de activar el
  guard, y su DoD exige `just verify` contando product-cards reales.
- **R-2 (medio):** `/me` publica hoy `wallet`, `address` y `last_order` con
  datos del mock. Al salir de Postgres quedan en `null`/`[]` y algún
  componente puede romper al desestructurar. Mitigación: US-22 verifica el
  perfil renderizado en shop y admin, no solo el `curl`.
- **R-3 (medio):** la FK `shops.owner_id → users.id` obliga a que los 3
  usuarios se siembren **antes** que las 12 tiendas y con sus ids originales
  (1, 2, 3). `generate-seed.mjs` emite hoy las tiendas sin esa precondición:
  el orden de los bloques del seed pasa a ser significativo.
- **R-4 (bajo):** el enum `Permission` del DTO cambia de valores. Está
  declarado en `create-auth.dto.ts` y solo lo usa `RegisterDto`; verificar que
  ningún consumidor compare contra las cadenas viejas (`'Super admin'`).
- **R-5 (bajo):** hoy cualquier contraseña entra. Tras US-22, cualquier
  credencial que el equipo tuviera memorizada deja de funcionar: la única
  válida es la sembrada (decisión 7).

## Notas globales para los agentes

- Arrancar siempre con la base sembrada (`just db-up`) y `packages/db`
  construido (`just db-build` si `dist/` no existe).
- Tras US-20, **toda** verificación del épico parte de `just db-reset`: el DDL
  idempotente no adopta tablas nuevas sobre una base ya creada.
- El precedente de estilo para repositorio + servicio + traducción de casing
  está en las US-2/3/4a/4b/5, archivadas en `openspec/changes/archive/`.
- Ninguna US de este épico toca el frontend. Si una verificación exige cambiar
  shop o admin, es señal de que el contrato se rompió: parar y preguntar.
- Este épico **no** implementa órdenes, wallets, direcciones ni reviews aunque
  `/me` las mencione. Lo que el "NO incluye" excluye no se implementa.
