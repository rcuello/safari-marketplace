# Identity Schema Specification

## Purpose

Postgres no tiene tabla de identidad: `shops.owner_id` es `bigint` sin FK
y el login del mock acepta cualquier contraseña. Esta capability añade
`users`, `profiles`, `permissions`, `permission_user`,
`password_reset_tokens` y `otp_codes`, sembrados desde `users.json`, y
cierra la FK de `shops.owner_id`. El login sigue mock hasta US-22; nadie
consume recuperación/OTP hasta US-24.

## Requirements

### Requirement: Tablas núcleo de identidad con sus restricciones

El sistema MUST definir `users` (`password_hash text NOT NULL`,
`is_active boolean`, `email_verified_at timestamptz` nullable, sin columna
`email_verified` propia), `profiles` (1:1 con `users`), `permissions` (con
`guard_name`) y el pivote `permission_user`, en el estilo de comentarios
ya usado en `db/schema.sql`. `is_active` MUST convertirse del entero `1`
del mock a `boolean`. `wallet`, `address`, `last_order`, `shops[]` y
`shop_id` de `users.json` MUST NOT obtener columna en ninguna tabla.

#### Scenario: Las 4 tablas núcleo existen con sus columnas obligatorias
- GIVEN la base recreada con `just db-reset`
- WHEN se inspecciona el catálogo (`\d users`, `\d profiles`, `\d permissions`, `\d permission_user`)
- THEN `users` tiene `password_hash`/`is_active boolean`/`email_verified_at` y ninguna columna `wallet`/`address`/`last_order`/`shops`/`shop_id`/`email_verified`; `profiles` tiene `avatar`/`socials jsonb`; `permissions` tiene `guard_name`; `permission_user` tiene ambas FK reales

#### Scenario: is_active aterriza booleano, no entero
- GIVEN `users.json` con `is_active: 1` en los 3 usuarios
- WHEN se aplica el seed
- THEN las 3 filas de `users.is_active` son `true`

### Requirement: Unicidad de email case-insensitive vía índice funcional

El sistema MUST garantizar unicidad case-insensitive de `users.email` con
un índice único sobre `lower(email)` — NOT `citext`; la columna sigue
siendo `text`. Todo consumidor MUST comparar `lower(email) = lower($1)`.

#### Scenario: El índice rechaza el mismo email con distinto casing
- GIVEN `admin@demo.com` ya sembrado
- WHEN se intenta insertar `Admin@demo.com`
- THEN Postgres rechaza el INSERT por unicidad sobre `lower(email)`
- AND un `EXPLAIN` de `SELECT * FROM users WHERE email = $1` no usa `users_email_lower_idx` (consecuencia para US-21)

### Requirement: profiles se clave por user_id, ignorando el id del JSON

`profiles.user_id` MUST ser `PRIMARY KEY REFERENCES users(id)`.
`profile.id` del origen MUST NOT preservarse.

#### Scenario: Dos usuarios con el mismo profile.id de origen no colisionan
- GIVEN admin (id 3) y customer (id 2), ambos con `profile.id: 2`
- WHEN el seed inserta ambos perfiles
- THEN insertan sin violar PK: `profiles.user_id` (3 y 2) difiere y `profile.id` nunca se persiste

### Requirement: Catálogo de permisos y su pivote fiel al usuario real

`permissions` MUST tener 4 filas — `super_admin`(1), `customer`(2),
`store_owner`(3) del mock, más `staff`(4) nueva, sin usuario asignado —
con `guard_name = 'api'`. `permission_user` MUST reflejar la asignación
real: admin (id 3) → `super_admin`+`customer`+`store_owner`; store_owner
(id 1) → `customer`+`store_owner`; customer (id 2) → `customer`. El
generador MUST derivar `user_id` del `id` del usuario iterado, NEVER de
`permissions[].pivot.model_id`.

#### Scenario: Las filas de admin usan id 3, no el 6 del pivote corrupto
- GIVEN `admin@demo.com` (id 3) con `pivot.model_id = 6` en sus 3 permisos
- WHEN el seed puebla `permission_user`
- THEN las 3 filas de admin llevan `user_id = 3`; ninguna referencia un usuario 6 inexistente

#### Scenario: El total de filas y el catálogo cuadran con lo real
- GIVEN el seed sembrado
- WHEN se cuentan filas de `permission_user` y `permissions`
- THEN 6 y 4 respectivamente, sin ninguna fila que referencie `staff` (id 4)

### Requirement: Tablas de recuperación y OTP existen sin consumidor

El sistema MUST definir `password_reset_tokens` (`user_id` FK,
`expires_at`, marca de consumo) y `otp_codes` (`phone text` SIN FK a
`users` — única excepción al estilo FK-everywhere del archivo, justificada
en el comentario del DDL). Ambos comentarios MUST declarar sin consumidor
aún (US-24).

#### Scenario: Las tablas existen pero permanecen vacías tras el seed
- GIVEN la base recién creada con `just db-reset`
- WHEN se cuentan filas en `password_reset_tokens` y `otp_codes`
- THEN ambas devuelven 0, sin código de aplicación que las referencie

### Requirement: La FK de shops.owner_id cierra sin huérfanos

`shops.owner_id` MUST referenciar `users.id`. Tras `just db-reset` no debe
quedar tienda huérfana y el conteo MUST seguir en 12.

#### Scenario: Cero huérfanos, 12 tiendas
- GIVEN `just db-reset` aplicado de punta a punta
- WHEN se cuentan tiendas cuyo `owner_id` no existe en `users`
- THEN el resultado es 0 y `SELECT count(*) FROM shops` sigue en 12

### Requirement: El seed es determinista y respeta la FK al aplicar

Las tablas de identidad MUST insertarse antes que `shops`. Los 3 usuarios
MUST conservar ids 1, 2, 3 (`ON CONFLICT (id) DO NOTHING`) con perfil. El
hash bcrypt de `demodemo` MUST ser literal fijo en `generate-seed.mjs`
(regeneración en comentario), NEVER calculado en tiempo de generación.

#### Scenario: El seed completo aplica sin violaciones de integridad
- GIVEN una base vacía
- WHEN se aplica `db/seed.sql` de principio a fin
- THEN ninguna sentencia falla por violación de clave foránea

#### Scenario: 3 usuarios, 3 perfiles, un hash verificable
- GIVEN el seed aplicado
- WHEN se ejecuta `SELECT id, email FROM users ORDER BY id`
- THEN devuelve 1/`store_owner@demo.com`, 2/`customer@demo.com`, 3/`admin@demo.com`, cada uno con perfil y `password_hash` con prefijo `$2`, y `bcryptjs.compare('demodemo', hash)` = `true` en los tres

#### Scenario: Regenerar el seed dos veces produce el mismo archivo
- GIVEN `db/generate-seed.mjs` sin cambios entre dos corridas
- WHEN el generador se ejecuta dos veces seguidas
- THEN los dos `db/seed.sql` resultantes son byte a byte idénticos

### Requirement: Sin regresión del catálogo existente

`just db-check` MUST seguir en verde y los conteos de `products`,
`categories` y `shops` MUST permanecer sin cambios.

#### Scenario: Los conteos del catálogo no se mueven
- GIVEN `just db-reset` corrido tras añadir identidad y su seed
- WHEN corre `just db-check` y, aparte, `SELECT count(*)` manual sobre `products`/`categories`/`shops`
- THEN `just db-check` pasa (`shops.total = 12`, `items[0].id = 15`; ningún test cubre `owner_id` ni `1200`) y el conteo manual da `1200`/`198`/`12`

## Out of Scope

`packages/db`/Prisma (US-21) · `apps/api/rest` (US-22) · wallets,
direcciones, órdenes, reviews · `apps/README.md` (D-2, hand-off a US-22) ·
`services/scraper-worker/**` · frontends · `test_pipeline.py` (US-6,
ajeno) · consumir `password_reset_tokens`/`otp_codes` (US-24) · asignar
`staff` a un usuario (US-25).
