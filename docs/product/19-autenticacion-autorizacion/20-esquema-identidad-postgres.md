# US-20 — Esquema de identidad en Postgres

> Crear en `db/schema.sql` el dominio de identidad completo —usuarios,
> perfiles, permisos, tokens de recuperación y códigos OTP— y sembrarlo con
> los 3 usuarios demo del mock, con contraseña hasheada. Todo el DDL del
> épico va aquí: un solo `db-reset`.

**Épico:** [Épico 19](./README.md)
**Fecha:** 2026-08-31
**Status:** ✅ Implementada
**Depende de:** ninguna
**LOC est.:** ~380

## Historia
**Como** desarrollador del monorepo, **quiero** que los usuarios existan como
filas en Postgres y no como un array en memoria, **para** que el login pueda
dejar de ser un `if` sobre el email y las tiendas puedan apuntar a un dueño
real.

## Contexto

- `db/schema.sql:13-15` excluye usuarios *a
  propósito*: "Fuera de alcance deliberado: órdenes, usuarios, carritos,
  reviews y pagos". Esta US levanta esa exclusión **solo para identidad**; el
  resto del dominio transaccional sigue fuera.
- `users.json` trae 3 usuarios: `store_owner@demo.com` (id 1),
  `customer@demo.com` (id 2), `admin@demo.com` (id 3). Cada uno con `profile`
  (avatar jsonb, bio, socials, contact, notifications), `permissions[]` (shape
  Laravel con `guard_name` y `pivot`), `is_active`, `email_verified_at`.
  **Ninguno tiene campo `password`**: la credencial hay que inventarla.
- `shops.owner_id` existe hoy como `bigint NOT NULL DEFAULT 1` **sin FK**
  (`db/schema.sql:118`) porque no había tabla
  destino. Las 9 tiendas de `shops.json` tienen todas `owner_id = 1`, y el
  usuario 1 es `store_owner@demo.com`: la FK cierra sin datos huérfanos.
- La base sembrada termina con **12** tiendas: 3 las recupera
  `db/generate-seed.mjs` desde los JSON de productos (líneas 54-65). Esas
  también quedan bajo la FK.
- El DDL es idempotente (`IF NOT EXISTS`) y **no altera tablas existentes**:
  añadir la FK a `shops` exige recrear la base. `just db-reset` está
  **autorizado por el dueño del repo (2026-08-31)**.

## Scope

**Incluye:** el DDL de `users`, `profiles`, `permissions`, `permission_user`,
`password_reset_tokens` y `otp_codes`; la FK `shops.owner_id → users.id`; la
extensión de `db/generate-seed.mjs` para emitir esas tablas desde `users.json`
con el hash de contraseña precomputado; el `db/seed.sql` regenerado; y la
documentación del modelo en `db/README.md`.

**NO incluye:** la capa Prisma (`packages/db` — es US-21), ningún cambio en
`apps/api/rest`, ni tablas de wallets, direcciones, órdenes o reviews aunque
`users.json` las mencione.

## Criterios de aceptación

### CA-1 — Tablas de identidad creadas
`db/schema.sql` define `users` (con `password_hash`, `email` único,
`is_active`, `email_verified_at`), `profiles` (1:1 con `users`, avatar y
socials en `jsonb`), `permissions` (con `guard_name`) y el pivote
`permission_user`. Comentadas en el mismo estilo del resto del archivo.

### CA-2 — Tablas de recuperación y OTP creadas
`password_reset_tokens` y `otp_codes` existen con su token/código, el
identificador del titular, `expires_at` y la marca de consumo. No las usa
nadie todavía (es US-24), y eso se declara en el comentario del DDL.

### CA-3 — La FK de tiendas cierra
`shops.owner_id` referencia `users.id`. Tras `just db-reset` no hay tiendas
huérfanas y el conteo sigue siendo 12.

### CA-4 — Seed con los 3 usuarios y credencial usable
`db/seed.sql` inserta los 3 usuarios conservando sus ids originales (1, 2, 3),
su perfil y sus permisos en `snake_case` (`super_admin`, `store_owner`,
`staff`, `customer`). Los tres comparten la contraseña `demodemo`, guardada
como hash bcrypt. El hash va **literal** en `generate-seed.mjs` con el comando
para regenerarlo en un comentario: el generador no gana dependencias.

### CA-5 — El orden del seed respeta la FK
Los usuarios se insertan **antes** que las tiendas. `just db-reset` corre
limpio de principio a fin sin violaciones de integridad.

### CA-6 — Sin regresión del catálogo
`just db-check` sigue verde y los conteos del catálogo no cambian: 1200
productos, 12 shops (`max(id) = 15`), 198 categorías.

## Escenarios Gherkin

```gherkin
Feature: Esquema de identidad en Postgres
  Scenario: CA-3 — la FK de tiendas cierra
    Given la base recreada con just db-reset
    When se cuentan las tiendas cuyo owner_id no existe en users
    Then el resultado es cero
    And el total de tiendas sigue siendo 12

  Scenario: CA-4 — la credencial demo es verificable
    Given el seed aplicado
    When se lee el password_hash de admin@demo.com
    Then empieza por el prefijo de bcrypt
    And bcryptjs.compare('demodemo', hash) devuelve true

  Scenario: CA-5 — el orden del seed respeta la FK
    Given una base vacia
    When se aplica db/seed.sql completo
    Then ninguna sentencia falla por violacion de clave foranea
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `db/schema.sql` | 6 tablas nuevas + FK en `shops.owner_id`; comentarios en el estilo del archivo |
| `db/generate-seed.mjs` | leer `users.json` y emitir usuarios, perfiles, permisos y el pivote, antes del bloque de shops |
| `db/seed.sql` | regenerado (artefacto, no se edita a mano) |
| `db/README.md` | documentar el modelo de identidad y la credencial demo |

## Definición de Done

- [x] `just db-reset` completo sin errores, con la salida pegada.
- [x] `SELECT` pegado mostrando: 3 usuarios con sus ids originales, 3 perfiles,
      las filas de `permission_user`, y **0** tiendas con `owner_id` huérfano.
- [x] Verificación del hash pegada: `bcryptjs.compare('demodemo', hash)` = `true`
      para los 3 usuarios.
- [x] `just db-check` verde (los tests del catálogo no se tocan pero deben
      seguir pasando tras regenerar el seed).
- [x] Conteos del catálogo pegados: 1200 productos, 12 shops, 198 categorías.
- [x] `db/README.md` actualizado con el modelo y la credencial demo.
- [x] Status de esta US actualizado y fila del épico marcada.

Evidencia completa (salidas de comandos pegadas) en
`openspec/changes/esquema-identidad-postgres/apply-progress.md`.

## Notas para el agente ejecutor

- **`shops.integration.test.ts` asserta `toBe(12)` y `items[0].id === 15`.**
  Añadir la FK no debe alterar el conteo ni los ids. Verificarlo antes de dar
  por buena la regeneración del seed.
- El hash de `demodemo` se genera **una vez** y se pega como constante. Sugerencia
  de comentario en el generador: `// npx bcryptjs demodemo 10` o el snippet de
  Node equivalente. Nunca hashear en tiempo de generación: el seed dejaría de
  ser determinista y cada regeneración produciría un diff espurio.
- Los permisos van en `snake_case`. Es lo que `hasAccess()` compara en los dos
  frontends (`apps/admin/rest/src/utils/constants.ts:4-7`); el enum de la API
  usa otros valores y se corrige en US-22, no aquí.
- `users.json` trae `is_active: 1` (entero) y `email_verified: true`. La
  columna es `boolean`: la conversión se hace en el generador, como ya hace
  `bool()` para el resto de las tablas.
- No inventar columnas para `wallet`, `address` ni `last_order`. Decisión 13
  del épico: se emiten como `null`/`[]` desde la API.
- El unique de `users.email` debe ser insensible a mayúsculas o el login
  aceptará `Admin@demo.com` como cuenta distinta. Decidirlo explícitamente en
  el DDL (`citext` no está disponible; un índice único sobre `lower(email)` sí).
