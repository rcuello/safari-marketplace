# Proposal: Esquema de identidad en Postgres

> **US-20**, Épico 19. Insumo: `explore.md` (esta carpeta). Precedente de estilo:
> `archive/2026-08-31-endpoints-derivados-postgres/`. Las decisiones **(cerrada)** las fijó el
> dueño del repo tras leer la exploración: no se re-abren en `sdd-design`.

## Intent

No existe tabla de usuarios: `db/schema.sql:13-15` excluye identidad *a propósito*,
`shops.owner_id` es `bigint NOT NULL DEFAULT 1` **sin FK** (`:119`, con el comentario de
`:111-112` declarando `users` fuera de alcance) y el login del mock acepta cualquier contraseña.
Esta US levanta la exclusión **solo para identidad**: 6 tablas, los 3 usuarios demo con hash
bcrypt real y la FK de tiendas cerrada. Todo el DDL del épico entra aquí para gastar **un solo
`db-reset`** (decisión 2 del épico). El login sigue mock hasta US-22.

## Scope

### In Scope

| Archivo | Cambio |
|---|---|
| `db/schema.sql` | 6 tablas (`users`, `profiles`, `permissions`, `permission_user`, `password_reset_tokens`, `otp_codes`) + índice `users_email_lower_idx` + FK `shops.owner_id → users.id` **inline**; reescribir el comentario obsoleto `:111-112` y el "fuera de alcance" de `:13-15` |
| `db/generate-seed.mjs` | leer `users.json` y emitir `users`/`profiles`/`permissions`/`permission_user` **antes** del bloque `shops` (hoy línea 140); añadir `users` y `permissions` al `setval` (línea 297) |
| `db/seed.sql` | regenerado (artefacto, nunca a mano) |
| `db/README.md` | modelo de identidad + credencial demo `demodemo` |

### Out of Scope (vinculante — "NO incluye" de la US)

`packages/db` y Prisma (US-21) · cualquier archivo bajo `apps/api/rest` (US-22) · tablas de
wallets, direcciones, órdenes o reviews aunque `users.json` las traiga · **`apps/README.md`**
(D-2) · `services/scraper-worker/**` · frontends.

**Adyacentes detectadas y NO accionadas**: `auth.service.ts:154-156` (`me()` devuelve
`users[0]`, siempre admin) · el enum `Permission` del DTO con valores `'Super admin'` ·
`test_pipeline.py` roto (R-5).

## Capabilities

### New Capabilities

- `identity-schema`: dominio de identidad en Postgres (usuarios, perfiles, permisos, pivote,
  tokens de recuperación, códigos OTP) y su seed determinista desde `users.json`.

### Modified Capabilities

- None. `flat-catalogs-api` (V-4: `owner` se emite `null`, `owner_id` sí es real) y
  `derived-catalog-api` (`spec.md:90`) siguen siendo ciertas: la FK no altera ningún contrato.

## Approach — decisiones cerradas

| # | Tema | Decisión |
|---|---|---|
| **D-1** | Email case-insensitive | `email text` + `CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email))`. **No `citext`**: consistencia con el precedente del archivo (`products_nombre_trgm_idx` ya indexa `lower(name)`) y no introducir el primer `CREATE EXTENSION` en el DDL versionado (las extensiones se activan en `justfile:278`). **Corrección fáctica**: la US afirma que `citext` no está disponible; el explore verificó que **sí** lo está en `postgres:16-alpine` (`default_version 1.6`) — la decisión es de estilo, no de disponibilidad; el paréntesis de la US no debe citarse como verdad. **Consecuencia**: todo lookup por email debe escribirse `WHERE lower(email) = lower($1)` o el índice no se usa. La hereda **US-21** y de ella depende su CA-2. |
| **D-2** | Alcance documental | Solo `db/README.md`. `apps/README.md` fuera, aunque la decisión 7 del épico lo mencione: la tabla de archivos de US-20 no lo lista y la credencial no hace nada hasta que US-22 valide el login. **Hand-off a US-22** (su tabla ya lo incluye) para no perder la decisión 7. |
| **D-3** | `otp_codes` | Clave por **teléfono en texto plano, sin FK a `users`**: US-24 CA-5 habla de un código "asociado al teléfono", `POST /api/send-otp-code` recibe un teléfono (no un id) y no existe columna de teléfono en `users`/`profiles` (solo `profile.contact`, string libre). El comentario del DDL **debe** justificar por qué esta tabla se aparta del estilo FK-everywhere. |
| **D-4** | `profiles` 1:1 | `user_id bigint PRIMARY KEY REFERENCES users(id)`, ignorando `profile.id`: los usuarios 2 y 3 declaran **ambos** `profile.id: 2`. `profile.customer_id` también se descarta (inconsistente con el id real del dueño). |
| **D-5** | `permission_user.user_id` | Del `id` real del usuario iterado, **nunca** de `permissions[].pivot.model_id`: el de admin vale `6`, que no es un usuario real y violaría la FK. `pivot.model_type` no se persiste (constante Laravel sin contraparte aquí). |
| **D-6** | Pivote con fecha | `permission_user` lleva `created_at timestamptz NOT NULL DEFAULT now()` además de `(user_id, permission_id)`: gratis, sigue el estilo del archivo y deja a US-22 la puerta abierta a publicar un `pivot` con fechas reales. |
| **D-7** | `password_reset_tokens` | Por `user_id bigint NOT NULL REFERENCES users(id)`, no por email al estilo Laravel: todos los usuarios existen ya en el seed, no hay flujo de pre-existencia. D-4 del épico (sin enumeración de cuentas) no se afecta: un email inexistente no persiste nada. |
| **D-8** | Ubicación del bloque y la FK | Identidad **antes** de `shops` en `schema.sql`, FK **inline** en `CREATE TABLE shops`. El archivo no tiene **ningún** precedente de `ALTER TABLE ADD CONSTRAINT` (verificado) y el seed emite `shops` en 3ª posición (`generate-seed.mjs:140`): es una **inserción pura**, no un reordenamiento. |
| **D-9** | `staff` | Fila de `permissions` **sin asignación** en `permission_user`: no aparece en `users.json`, pero la decisión 4 del épico fija el universo en 4 valores porque es lo que compara `hasAccess()` en ambos frontends. Así US-25 lo asigna sin otro `db-reset`. |
| **D-10** | `just db-reset` | Autorizado (decisión 1 del épico, 2026-08-31), pero con **confirmación previa explícita**: el contenedor lleva ~43h arriba y el reset borra el volumen. Verificado en la base viva: `count(*) FROM products WHERE source_store IS NOT NULL` = **0**, hoy no hay nada del scraper que perder. |

## Modelo de datos (altitud de propuesta, no el DDL)

PK `bigserial` y `created_at`/`updated_at timestamptz NOT NULL DEFAULT now()` en el estilo del
archivo, salvo donde se indique.

| Tabla | Columnas y restricciones |
|---|---|
| `users` | `id`, `name text NOT NULL`, `email text NOT NULL` (único vía D-1), `password_hash text NOT NULL`, `is_active boolean NOT NULL DEFAULT true`, `email_verified_at timestamptz NULL`, timestamps. **Sin `email_verified`**: redundante con `email_verified_at` en los 3 usuarios. `shop_id`, `wallet`, `address`, `last_order`, `shops[]` descartados (decisión 13) |
| `profiles` | `user_id` PK+FK (D-4), `avatar jsonb NULL`, `bio text NULL`, `socials jsonb NULL`, `contact text NULL`, `notifications jsonb NULL`, timestamps |
| `permissions` | `id`, `name text NOT NULL UNIQUE`, `guard_name text NOT NULL DEFAULT 'api'`, timestamps |
| `permission_user` | `PRIMARY KEY (user_id, permission_id)`, ambas FK reales, `created_at` (D-6) |
| `password_reset_tokens` | `id`, `user_id` FK (D-7), `token text NOT NULL UNIQUE`, `expires_at timestamptz NOT NULL`, `consumed_at timestamptz NULL`, `created_at`. El comentario declara que **nadie la usa hasta US-24** |
| `otp_codes` | `id`, `phone text NOT NULL` (sin FK, D-3), `code text NOT NULL`, `expires_at timestamptz NOT NULL`, `consumed_at timestamptz NULL`, `created_at`, índice por `phone`. Igual: sin consumidor hasta US-24 |

`is_active` llega como entero `1` y aterriza en `boolean` con el helper `bool()` existente
(`generate-seed.mjs:35-46`); `avatar`/`socials`/`notifications` con `json()`. Sin helpers nuevos.

## Seed

**Hash bcrypt**: literal precomputado como constante en `generate-seed.mjs`, con el comando de
regeneración en un comentario (decisión 8 del épico). **Nunca** hashear en tiempo de generación:
el seed dejaría de ser determinista y cada regeneración produciría un diff espurio. Hoy **no
existe** `bcryptjs` ni `bcrypt` en ningún `package.json` ni `node_modules` del monorepo
(verificado): el literal se produce **una vez** en apply con una invocación puntual —
`npx bcryptjs demodemo 10`, o `npm install --no-save bcryptjs` + `node -e` — sin añadir
dependencia al generador. Los salts de bcrypt son aleatorios: el literal es estable solo porque
queda **fijado**, no porque sea reproducible.

**Permisos** (`guard_name = 'api'`, constante verificada): `1 super_admin`, `2 customer`,
`3 store_owner` (ids del mock) y `4 staff` (id nuevo, D-9). Asignaciones reales — **no es un
permiso por usuario**: `admin@demo.com` (id 3) → `super_admin` + `customer` + `store_owner`;
`store_owner@demo.com` (id 1) → `customer` + `store_owner`; `customer@demo.com` (id 2) →
`customer`. Total **6 filas**. Ids de usuario preservados (1, 2, 3) con el patrón ya usado 6
veces: `INSERT ... (id, ...) ON CONFLICT (id) DO NOTHING` + `setval`. `profiles`,
`permission_user`, `password_reset_tokens` y `otp_codes` no entran al `setval` (sin secuencia
propia o sin filas sembradas).

## Risks

| Riesgo | Prob. | Mitigación |
|---|---|---|
| **R-1**: copiar `pivot.model_id` → `user_id = 6` inexistente, violación de FK al sembrar | Media | D-5 + validación previa en el generador (patrón `generate-seed.mjs:65-88`) antes de escribir `seed.sql` |
| **R-2**: preservar `profile.id` → colisión de PK (2 = 2) | Media | D-4 |
| **R-3**: `db-reset` borra el volumen (`docker compose down -v`) | Media | D-10: autorizado + confirmación previa; 0 filas del scraper hoy |
| **R-4**: el seed regenerado altera conteos que assertan los tests | Baja | Solo se **añaden** bloques antes de `shops`; los INSERT del catálogo no se tocan. Gate: `just db-check` |
| **R-5**: alguien "arregla" `pipelines.py` creyendo que esta US rompió `just db-test` | Media | Seguirá roto **por `test_pipeline.py`**, que consulta la tabla legada `productos`; `pipelines.py` ya está migrado a `products`. El reporte final **debe** decirlo así (US-6, no esta US) |
| **R-6**: lookups `email = $1` sin `lower()` no usan el índice | Baja | Hand-off a US-21 (D-1) |

## Rollback Plan

`git checkout db/schema.sql db/generate-seed.mjs db/seed.sql db/README.md` + **otro
`just db-reset`**: el DDL es idempotente pero no deshace tablas ya creadas, así que sin ese
segundo reset `users` y la FK sobreviven al revert. No hay base de producción, ni migraciones
incrementales, ni código de aplicación que deshacer (`packages/db` y `apps/api/rest` no se
tocan): nada consume las tablas nuevas, y dejarlas huérfanas es inofensivo.

## Dependencies

`just db-up` · `just db-reset` tras regenerar el seed · `just db-build` si
`packages/db/dist/` no existe (lo exige `just db-check`) · una vía puntual de bcrypt.

## Success Criteria (1:1 con la DoD de la US)

- [ ] **CA-1/CA-2** `just db-reset` completo con la salida pegada; `\d` de las 6 tablas y del
      índice único.
- [ ] **CA-3/CA-4** `SELECT` pegado con 3 usuarios de ids 1/2/3, 3 perfiles, las **6** filas de
      `permission_user`, y `SELECT count(*) FROM shops s LEFT JOIN users u ON u.id = s.owner_id
      WHERE u.id IS NULL` = **0**.
- [ ] **CA-4** `bcryptjs.compare('demodemo', hash)` = `true` para los 3 hashes, con prefijo
      `$2` verificado.
- [ ] **CA-5** el log del `db-reset` sin ninguna violación de clave foránea.
- [ ] **CA-6** `just db-check` verde — cubre por test `shops.total = 12` e `items[0].id = 15`
      (`shops.integration.test.ts:19-20,93-94`; **ningún** test asserta `owner_id`),
      `categories` 198, `manufacturers` 14, `tags` 10, `products > 1000` y `1199` con filtros
      por defecto. **Los literales 1200 productos y 12 shops no los verifica ningún test**:
      exigen `SELECT count(*)` a mano, pegado aparte.
- [ ] `db/README.md` con el modelo y la credencial · status de US-20 y fila del épico.

## Hand-off (no accionar aquí)

1. **US-21**: lookups por email como `WHERE lower(email) = lower($1)` (D-1).
2. **US-22**: documentar `demodemo` en `apps/README.md` (decisión 7 del épico, D-2).
3. **US-22**: `22-login-jwt-postgres.md:122,153` cita `apps/api/rest/.env.template`; el archivo
   real es `.env.example` (`justfile:59`).

## Open Questions

No bloqueantes, a fijar en `sdd-design`: (1) ¿engancha el trigger `tocar_updated_at()` a
`users`/`profiles`? El criterio del archivo es "tablas que se actualizan de verdad" y US-25
actualizará usuarios — recomendación **sí**. (2) `ON DELETE CASCADE` en las FK hijas
(`profiles`, `permission_user`, `password_reset_tokens`): recomendado, sin precedente en el
archivo.
