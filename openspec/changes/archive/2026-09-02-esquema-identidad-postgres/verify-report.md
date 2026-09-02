# Verification Report: Esquema de identidad en Postgres (US-20)

> Pase de validación **adversarial** con contexto fresco. El objetivo era
> falsificar las afirmaciones de `apply-progress.md`, no confirmarlas. Toda la
> evidencia de abajo se re-derivó de cero: ningún dato se cita del
> apply-progress. `just build` **no se ejecutó** — justificación en § Build.

| Campo | Valor |
|---|---|
| Change | `esquema-identidad-postgres` |
| US | US-20, Épico 19 |
| Modo | Standard (`strict_tdd: false`) — módulo `strict-tdd-verify.md` NO cargado |
| Artifact store | `openspec` (Engram no conectado; ningún `mem_*` invocado) |
| Artefactos presentes | `explore.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/identity-schema/spec.md`, `apply-progress.md` → **verificación completa** (las 3 dimensiones) |
| `skill_resolution` | `none` (`.atl/skill-registry.md` no existe — confirmado: `ls .atl` → `No such file or directory`) |
| **Veredicto** | **PASS** |

---

## 0. Discrepancia con el brief del orquestador (lo más importante de este reporte)

El brief describe la spec como **«12 requirements / 15 scenarios»**. El archivo
real tiene **8 requirements y 12 scenarios**:

```
$ grep -c "^### Requirement:" spec.md   →  8
$ grep -c "^#### Scenario:" spec.md     →  12
```

Es una discrepancia **de contabilidad en el brief**, no un defecto del cambio:
`spec.md` es internamente consistente y todos sus requirements/scenarios están
cubiertos. Se señala porque la instrucción pedía reportar cualquier desacuerdo
con los datos del orquestador como el punto principal.

**Todos los demás resultados del orquestador se reprodujeron y coincidieron
exactamente.** Ninguno más divergió.

---

## 1. Completeness — tareas

`23/23` marcadas, `0` sin marcar:

```
$ grep -c '^- \[x\]' tasks.md   → 23
$ grep -c '^- \[ \]' tasks.md   → 0
```

Cada claim se verificó contra el archivo, no contra el checkbox:

| Tarea | Claim | Verificado en | Verdicto |
|---|---|---|---|
| 1.1 | 6 `CREATE TABLE` tras el cierre de `types` | `db/schema.sql:104-212` (bloque `users`…`otp_codes`); `types` cierra en `:101`, banner de `shops` en `:215` | ✅ real |
| 1.2 | `users_email_lower_idx` | `db/schema.sql:132`; `pg_indexes` lo confirma en vivo | ✅ real |
| 1.3 | FK inline + `DEFAULT 1` conservado | `db/schema.sql:236` — `owner_id bigint NOT NULL DEFAULT 1 REFERENCES users(id) ON DELETE RESTRICT` | ✅ real |
| 1.4 | 3 índices de consulta | `db/schema.sql:472-474`, en la sección "Índices" | ✅ real |
| 1.5 | 2 triggers en `users`/`profiles`, ninguno en `permissions` | `db/schema.sql:497-500`; `pg_trigger` en vivo devuelve exactamente 5 triggers no internos | ✅ real |
| 1.6 | Comentarios de alcance y de `owner_id` reescritos | `db/schema.sql:13-16` y `:223-229` | ✅ real |
| 2.1 | `HASH_DEMO` literal + comando de regeneración | `db/generate-seed.mjs:49-62` | ✅ real |
| 2.2 | `leer('users')`, catálogo de 4, matriz de `u.id` | `:34`, `:69-74`, `:79-81` | ✅ real |
| 2.3 | 5 comprobaciones nuevas | `:119-140` — probadas por mutación (§ 4) | ✅ real |
| 2.4 | 4 bloques pre-`shops`, `ON CONFLICT` por PK real | `:200-258`; bloque `shops` arranca en `:260` | ✅ real |
| 2.5 | `setval` + cabeceras de conteo | `:417` (`users`, `permissions` insertados en posición 2 y 3), `:165-167`, `:425-431` | ✅ real |
| 3.1 | determinismo | reproducido, § 5 | ✅ real |
| 3.2 | diff aditivo | reproducido, § 6 | ✅ real |
| 4.1-4.6 | aplicación y verificación | reproducidos de cero, § 2-§ 8 | ✅ real |
| 5.1 | sección de identidad en `db/README.md` | `db/README.md:42-83`, entre "De dónde salen los datos" y "Cómo se adapta el scraper" | ✅ real |
| 5.2-5.3 | hand-offs y precisión de `just db-test` | reproducidos, § 10 | ✅ real |
| 5.4 | `Status` + fila del épico | § 9 | ✅ real |

---

## 2. Estructura del DDL — lectura completa de `db/schema.sql`

**Ubicación y transacción.** `BEGIN;` en `:24`, `COMMIT;` en `:503`. El bloque de
identidad ocupa `:104-212`, es decir **antes** del banner de `shops` (`:215`) y
de su `CREATE TABLE` (`:231`), y **dentro** de la transacción única. Correcto.

**Columnas y tipos en vivo** (`information_schema.columns`, 36 filas sobre las 6
tablas). Coinciden columna a columna con el DDL del `design.md` § Decision D:

```
 users | id bigint NOT NULL nextval('users_id_seq') | name text NOT NULL | email text NOT NULL
       | password_hash text NOT NULL | is_active boolean NOT NULL DEFAULT true
       | email_verified_at timestamptz NULL | created_at/updated_at timestamptz NOT NULL now()
 profiles | user_id bigint NOT NULL (PK) | avatar jsonb | bio text | socials jsonb
          | contact text | notifications jsonb | created_at/updated_at
 permissions | id bigint (bigserial) | name text NOT NULL | guard_name text NOT NULL 'api'::text
             | created_at/updated_at
 permission_user | user_id bigint NOT NULL | permission_id bigint NOT NULL | created_at
 password_reset_tokens | id | user_id bigint NOT NULL | token text NOT NULL
                       | expires_at timestamptz NOT NULL | consumed_at NULL | created_at
 otp_codes | id | phone text NOT NULL | code text NOT NULL
           | expires_at timestamptz NOT NULL | consumed_at NULL | created_at
```

**Ausencias exigidas.** `users` no tiene ninguna columna `wallet`, `address`,
`last_order`, `shops`, `shop_id` ni `email_verified` — y `users.json` **sí** trae
las cinco primeras y el booleano `email_verified` (verificado leyendo el JSON,
§ 7). Ninguna aterrizó.

**`shops.owner_id` conserva el `DEFAULT 1`** (load-bearing):

```
$ psql -c "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name='shops' AND column_name='owner_id';"
 column_name | data_type | is_nullable | column_default
-------------+-----------+-------------+----------------
 owner_id    | bigint    | NO          | 1
```

Y el `INSERT` del scraper —`pipelines.py:188`, `INSERT INTO shops (name, slug)
VALUES (%s, slugify(%s))`, sin `owner_id`— sigue funcionando (probado, § 3).

**Comentario obsoleto reescrito, no parcheado.** `db/schema.sql:223-229` ya no
dice que `owner_id` no tiene FK; declara a qué apunta, por qué `RESTRICT`, y por
qué el default se queda citando `pipelines.py:187-190`. El comentario de alcance
`:13-16` también se reescribió: identidad **entra**, y wallets/direcciones/
órdenes/carritos/reviews siguen fuera.

**Triggers `updated_at`** — `pg_trigger` en vivo, sin internos:

```
        tgname         |  tgrelid
-----------------------+------------
 users_updated_at      | users
 profiles_updated_at   | profiles
 shops_updated_at      | shops
 categories_updated_at | categories
 products_updated_at   | products
(5 rows)
```

Exactamente los 2 nuevos exigidos por Decision A, y **`permissions` sin
trigger**. Consecuencia asumida por diseño: `permissions.updated_at` queda
congelado en el `now()` del `db-up`. Es la decisión escrita, no un olvido.

**`otp_codes` sin FK, con la desviación justificada.** `pg_constraint` devuelve
5 FK apuntando a `users`/`permissions` y ninguna desde `otp_codes`. El
comentario `db/schema.sql:200-203` justifica la excepción (endpoint por
teléfono; no hay columna de teléfono única en `users`/`profiles`).

**Declaración de "sin consumidor todavía (US-24)"** — presente en las cabeceras
de las dos tablas: `db/schema.sql:182` (`password_reset_tokens`) y `:198`
(`otp_codes`). CA-2 lo exige explícitamente.

**Idempotencia.** Las 6 tablas usan `CREATE TABLE IF NOT EXISTS`, los 4 índices
`CREATE ... INDEX IF NOT EXISTS`, los triggers `CREATE OR REPLACE TRIGGER`
(soportado: el contenedor es `PostgreSQL 16.9`).

---

## 3. Acciones de FK — verificadas por comportamiento, no solo por catálogo

```
$ psql -c "SELECT conname, conrelid::regclass tbl, confrelid::regclass ref, confdeltype FROM pg_constraint WHERE contype='f' AND confrelid IN ('users'::regclass,'permissions'::regclass) ORDER BY 2,1;"
              conname               |          tbl          |     ref     | confdeltype
------------------------------------+-----------------------+-------------+-------------
 profiles_user_id_fkey              | profiles              | users       | c
 permission_user_permission_id_fkey | permission_user       | permissions | c
 permission_user_user_id_fkey       | permission_user       | users       | c
 password_reset_tokens_user_id_fkey | password_reset_tokens | users       | c
 shops_owner_id_fkey                | shops                 | users       | r
(5 rows)
```

Los 4 `CASCADE` (`c`) y el `RESTRICT` (`r`) de Decision B, más el segundo lado
del pivote (`permission_id → permissions`, `c`) que la consulta del `design.md`
—filtrada solo por `confrelid='users'`— no mostraba. Coincide.

Además, ejercitado de verdad en una base desechable (§ 6):

```
-- la FK muerde:
BEGIN; INSERT INTO shops (name,slug,owner_id) VALUES ('x','x-slug',99);
ERROR:  insert or update on table "shops" violates foreign key constraint "shops_owner_id_fkey"
DETAIL:  Key (owner_id)=(99) is not present in table "users".

-- DEFAULT 1: el get-or-create del scraper sigue vivo (R-7/Decision C):
BEGIN; INSERT INTO shops (name,slug) VALUES ('Alkosto Test','alkosto-test');
INSERT 0 1
 owner_id
----------
        1

-- RESTRICT protege al usuario 1, dueño de las 12 tiendas (R-8):
BEGIN; DELETE FROM users WHERE id=1;
ERROR:  update or delete on table "users" violates foreign key constraint "shops_owner_id_fkey" on table "shops"
DETAIL:  Key (id)=(1) is still referenced from table "shops".

-- CASCADE limpia al usuario 2 con su perfil y su pivote:
BEGIN; DELETE FROM users WHERE id=2; SELECT count(*) FROM profiles, count(*) FROM permission_user;
 profiles | pivote
----------+--------
        2 |      5
ROLLBACK
```

**Índices** (`pg_indexes`, 12 sobre las 6 tablas): `users_email_lower_idx`
(`UNIQUE`, `btree (lower(email))`), `permission_user_permiso_idx
(permission_id)`, `password_reset_tokens_user_idx (user_id)`,
`otp_codes_phone_idx (phone)`, más los `_pkey` y los `_key` que Postgres genera
por los `UNIQUE` inline (`permissions_name_key`,
`password_reset_tokens_token_key`) — exactamente el reparto de nombres que
predijo Decision D.

---

## 4. `db/generate-seed.mjs` — lectura completa y prueba por mutación

| Punto exigido | Hallazgo |
|---|---|
| Hash literal pinneado, con comentario de regeneración | `:49-62`. `HASH_DEMO = '$2b$10$j/.1t7…'`. El comentario dice qué es, coste 10, el comando `cd "$(mktemp -d)" && npm install --no-save bcryptjs && node -e …`, y que regenerarlo da otra cadena a propósito |
| Nada se hashea en tiempo de generación | No hay `import`/`require` de `bcrypt*` en el archivo. Confirmado además a nivel de repo: `grep -rl '"bcrypt' --include=package.json .` → **sin salida** |
| `permission_user.user_id` del usuario iterado | `:79-81`: `users.flatMap((u) => (u.permissions ?? []).map((p) => ({ user_id: u.id, permission_id: p.id })))`. **`p.pivot.model_id` no aparece en el archivo** salvo en comentarios que explican por qué se ignora (`:76-78`, `:250-251`) |
| `profile.id` ignorado | `:226-236` emite `(u.id, avatar, bio, socials, contact, notifications)` — `u.profile.id` nunca se lee |
| `email_verified_at` con `txt()`, no `ts()` | `:214`: `${txt(u.email_verified_at)}`. `ts()` (`:47`, que devuelve `now()` ante `null`) **no lo llama nadie** en el archivo — verificado |
| `setval` con las tablas correctas | `:417`: `['types','users','permissions','shops','categories','manufacturers','tags','products']`. Correctamente **excluidas** `profiles` (PK prestada, sin secuencia), `permission_user` (PK compuesta, sin secuencia) y `password_reset_tokens`/`otp_codes` (0 filas: `GREATEST(…,1)` sería no-op) |
| Guarda previa efectiva | Probada por mutación, abajo |

### Prueba por mutación de la validación previa (Decision F)

Se copió el generador al scratchpad con las rutas rebasadas y la salida
redirigida (**ningún archivo del proyecto se modificó**), y se introdujeron tres
mutantes. Resultado — los tres abortan con `exit(1)` **antes** de escribir:

```
===== base =====
db/seed.sql generado (588 KB)
exit=0  file_written=YES

===== mut1: user_id: u.id  →  user_id: p.pivot.model_id  (la trampa R-1) =====
El mock viola 3 restriccion(es) del esquema:
  - permission_user: user_id 6 inexistente
  - permission_user: user_id 6 inexistente
  - permission_user: user_id 6 inexistente
exit=1  file_written=NO

===== mut2: se borra store_owner(3) del catálogo de permisos =====
El mock viola 2 restriccion(es) del esquema:
  - permission_user: permission_id 3 inexistente
  - permission_user: permission_id 3 inexistente
exit=1  file_written=NO

===== mut3: HASH_DEMO = 'notahash' =====
El mock viola 1 restriccion(es) del esquema:
  - HASH_DEMO no parece un hash bcrypt (prefijo esperado '$2')
exit=1  file_written=NO
```

`file_written=NO` es el punto: la guarda corta **antes** del `writeFileSync`, no
después. Decision F cumple lo que promete.

---

## 5. Determinismo y ausencia de edición a mano de `db/seed.sql`

Dos corridas seguidas, más una comparación contra el estado del working tree que
dejó el apply:

```
$ cp db/seed.sql $S/seed.orig.sql
$ node db/generate-seed.mjs && cp db/seed.sql $S/seed.r1.sql
$ node db/generate-seed.mjs && cp db/seed.sql $S/seed.r2.sql
$ cmp $S/seed.r1.sql $S/seed.r2.sql   && echo OK
R1==R2 OK
$ cmp $S/seed.orig.sql $S/seed.r2.sql && echo OK
COMMITTED-TREE-STATE == REGENERATED (no hand edits) OK
```

La segunda comparación es la que el orquestador no hizo: prueba que
`db/seed.sql` en el working tree es **exactamente** lo que emite el generador, o
sea que **no se editó a mano** (artefacto, según `db/README.md:9`). Y tras las
dos regeneraciones el `git status` no se movió (§ 6).

---

## 6. Alcance del diff

```
$ git status --porcelain
 M db/README.md
 M db/generate-seed.mjs
 M db/schema.sql
 M db/seed.sql
 M docs/product/19-autenticacion-autorizacion/20-esquema-identidad-postgres.md
 M docs/product/19-autenticacion-autorizacion/README.md
?? openspec/changes/esquema-identidad-postgres/

$ git diff --stat
 db/README.md          |  45 ++++++-
 db/generate-seed.mjs  | 127 ++++++++++++++++++-
 db/schema.sql         | 141 ++++++++++++++++++++-
 db/seed.sql           |  51 +++++++-
 …/20-esquema-identidad-postgres.md | 19 +--
 …/19-autenticacion-autorizacion/README.md | 2 +-
 6 files changed, 365 insertions(+), 20 deletions(-)
```

Coincide con el orquestador: 6 archivos, 365/20.

**Disciplina de "Out of Scope" — verificada por ausencia:**

```
$ git diff --stat -- packages/db apps services justfile docker-compose.yml apps/README.md
(sin salida)
```

`apps/README.md` **no** se tocó (D-2 lo deja en US-22) · nada bajo `packages/db`
· nada bajo `apps/api/rest` · nada bajo `services/scraper-worker/**` ·
`justfile` y `docker-compose.yml` intactos (ningún `CREATE EXTENSION` nuevo).

**El diff de `db/seed.sql` es puramente aditivo y los bloques nuevos preceden a
`shops`:** el único cambio no-aditivo es la línea de cabecera de conteo
(`… 1200 productos` → `… 1200 productos · 3 usuarios · 4 permisos`), 1 borrado.
Los 4 bloques `users`/`profiles`/`permissions`/`permission_user` se insertan en
`@@ -43,2 +43,49 @@`, **antes** del bloque `shops`, y los 2 `setval` nuevos
(`users_id_seq`, `permissions_id_seq`) entre `types` y `shops`. Ni un `INSERT`
del catálogo existente se modificó.

### Aplicación desde vacío, sin usar `db-reset`

Para reproducir el scenario "el seed completo aplica sin violaciones de
integridad" **sin tocar** `safari_scraper`, se creó una base desechable dentro
del mismo contenedor, se le aplicó `schema.sql` + `seed.sql` con
`ON_ERROR_STOP=1`, y se destruyó:

```
$ psql -d postgres -c "CREATE DATABASE verify_us20_scratch;"
CREATE DATABASE
$ psql -d verify_us20_scratch -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
$ psql -d verify_us20_scratch -v ON_ERROR_STOP=1 -q < db/schema.sql   → schema exit=0
$ psql -d verify_us20_scratch -v ON_ERROR_STOP=1 -q < db/seed.sql     → seed   exit=0
$ grep -inE "error|violat" scratch.schema.log scratch.seed.log
(vacio: ni un error ni una violacion)

$ psql -d verify_us20_scratch -c "SELECT …"
 users | profiles | perms | pivote | shops | max_shop | products | cats | huerfanas
-------+----------+-------+--------+-------+----------+----------+------+-----------
     3 |        3 |     4 |      6 |    12 |       15 |     1200 |  198 |         0

$ psql -d postgres -c "DROP DATABASE verify_us20_scratch;"
DROP DATABASE
$ psql -d postgres -tAc "SELECT datname FROM pg_database ORDER BY 1;"
postgres
safari_scraper
template0
template1
```

`safari_scraper` quedó intacta (3 usuarios / 1200 productos / 12 shops después
del ejercicio). **No se ejecutó `just db-reset` ni `just db-migrate`.** Este es
el único paso que no fue SQL de solo lectura; se aisló en una base propia y se
revirtió por completo.

---

## 7. Datos — matriz de compliance por scenario (12 scenarios)

Evidencia base (`safari_scraper`, estado post-apply):

```
$ psql -c "SELECT (SELECT count(*) FROM users) users, (SELECT count(*) FROM profiles) profiles,
   (SELECT count(*) FROM permissions) permissions, (SELECT count(*) FROM permission_user) pivote,
   (SELECT count(*) FROM password_reset_tokens) prt, (SELECT count(*) FROM otp_codes) otp,
   (SELECT count(*) FROM shops s LEFT JOIN users u ON u.id=s.owner_id WHERE u.id IS NULL) huerfanas,
   (SELECT count(*) FROM products) products, (SELECT count(*) FROM shops) shops,
   (SELECT max(id) FROM shops) max_shop, (SELECT count(*) FROM categories) categories;"
 users | profiles | permissions | pivote | prt | otp | huerfanas | products | shops | max_shop | categories
-------+----------+-------------+--------+-----+-----+-----------+----------+-------+----------+------------
     3 |        3 |           4 |      6 |   0 |   0 |         0 |     1200 |    12 |       15 |        198

$ psql -c "SELECT id, name, email, is_active, email_verified_at, left(password_hash,4) FROM users ORDER BY id;"
 id |    name     |        email         | is_active |   email_verified_at    | left
----+-------------+----------------------+-----------+------------------------+------
  1 | Store Owner | store_owner@demo.com | t         |                        | $2b$
  2 | Customer    | customer@demo.com    | t         |                        | $2b$
  3 | Jhon Doe    | admin@demo.com       | t         | 2023-11-12 10:59:14+00 | $2b$

$ psql -c "SELECT u.id, u.email, string_agg(p.name,',' ORDER BY p.id) FROM permission_user pu
   JOIN users u ON u.id=pu.user_id JOIN permissions p ON p.id=pu.permission_id GROUP BY 1,2 ORDER BY 1;"
 id |        email         |             permisos
----+----------------------+----------------------------------
  1 | store_owner@demo.com | customer,store_owner
  2 | customer@demo.com    | customer
  3 | admin@demo.com       | super_admin,customer,store_owner

$ psql -c "SELECT p.id, p.name, count(pu.user_id) asignados FROM permissions p
   LEFT JOIN permission_user pu ON pu.permission_id=p.id GROUP BY 1,2 ORDER BY 1;"
 id |    name     | asignados
----+-------------+-----------
  1 | super_admin |         1
  2 | customer    |         3
  3 | store_owner |         2
  4 | staff       |         0

$ psql -c "SELECT owner_id, count(*) FROM shops GROUP BY owner_id;"
 owner_id | count
----------+-------
        1 |    12
```

Datos de origen leídos directamente de `apps/api/rest/src/db/pickbazar/users.json`:

```
id=3 email=admin@demo.com       is_active=1 email_verified=true  email_verified_at="2023-11-12T10:59:14.000000Z" profile.id=2 perms=[[1,super_admin,6],[2,customer,6],[3,store_owner,6]]
id=2 email=customer@demo.com    is_active=1 email_verified=false email_verified_at=null                          profile.id=2 perms=[[2,customer,2]]
id=1 email=store_owner@demo.com is_active=1 email_verified=false email_verified_at=null                          profile.id=1 perms=[[2,customer,1],[3,store_owner,1]]
total users: 3   (ningún usuario con id 4 → el id de `staff` está libre)
```

| # | Requirement / Scenario | Verdicto | Evidencia |
|---|---|---|---|
| R1 | Tablas núcleo de identidad con sus restricciones | **satisfecho** | § 2 |
| R1-S1 | Las 4 tablas núcleo existen con sus columnas obligatorias | **satisfecho** | `information_schema.columns` (36 filas): `users` con `password_hash`/`is_active boolean`/`email_verified_at`, sin `wallet`/`address`/`last_order`/`shops`/`shop_id`/`email_verified`; `profiles` con `avatar jsonb` y `socials jsonb`; `permissions` con `guard_name`; `permission_user` con las 2 FK reales (`pg_constraint`) |
| R1-S2 | `is_active` aterriza booleano, no entero | **satisfecho** | `users.is_active` es `boolean` y las 3 filas son `t`, con el origen en `is_active: 1` (entero) en los tres. La conversión es `bool()` en `generate-seed.mjs:214` |
| R2 | Unicidad de email case-insensitive vía índice funcional | **satisfecho** | Abajo |
| R2-S1 | El índice rechaza el mismo email con distinto casing **y** `email = $1` no lo usa | **satisfecho** | `BEGIN; INSERT INTO users (name,email,password_hash) VALUES ('dup','ADMIN@demo.com','x');` → `ERROR: duplicate key value violates unique constraint "users_email_lower_idx" / DETAIL: Key (lower(email))=(admin@demo.com) already exists.` La columna sigue siendo `text` (no `citext`) y no hay `CREATE EXTENSION` nuevo. Segunda mitad del scenario: ver el bloque `EXPLAIN` de abajo |
| R3 | `profiles` se clave por `user_id`, ignorando el id del JSON | **satisfecho** | `profiles_pkey` es `UNIQUE btree (user_id)`; no existe columna `id` en `profiles` |
| R3-S1 | Dos usuarios con el mismo `profile.id` de origen no colisionan | **satisfecho** | La colisión es real en el origen (admin id 3 y customer id 2 declaran **ambos** `profile.id = 2`) y el seed inserta las 3 filas sin violar PK: `profiles.user_id` = 1, 2, 3 |
| R4 | Catálogo de permisos y su pivote fiel al usuario real | **satisfecho** | Abajo |
| R4-S1 | Las filas de admin usan id 3, no el 6 del pivote corrupto | **satisfecho** | `pivot.model_id = 6` en los 3 permisos de admin (leído del JSON) y las 3 filas del pivote llevan `user_id = 3`. `SELECT count(*) FROM permission_user WHERE user_id NOT IN (1,2,3)` = 0 por construcción de la FK. Reforzado por la mutación `mut1` (§ 4) |
| R4-S2 | El total de filas y el catálogo cuadran con lo real | **satisfecho** | `permission_user` = 6, `permissions` = 4, `staff`(4) con **0 asignados**, las 4 con `guard_name = 'api'` |
| R5 | Tablas de recuperación y OTP existen sin consumidor | **satisfecho** | Abajo |
| R5-S1 | Las tablas existen pero permanecen vacías tras el seed | **satisfecho** | `password_reset_tokens` = 0, `otp_codes` = 0. `otp_codes` sin FK (0 FK en `pg_constraint`) con la desviación justificada en `db/schema.sql:200-203`; ambas cabeceras declaran "sin consumidor todavía (llega en US-24)" (`:182`, `:198`) |
| R6 | La FK de `shops.owner_id` cierra sin huérfanos | **satisfecho** | Abajo |
| R6-S1 | Cero huérfanos, 12 tiendas | **satisfecho** | `huerfanas = 0`, `shops = 12`, y los 12 con `owner_id = 1`. `shops_owner_id_fkey` existe con `confdeltype = 'r'` |
| R7 | El seed es determinista y respeta la FK al aplicar | **satisfecho** | Abajo |
| R7-S1 | El seed completo aplica sin violaciones de integridad | **satisfecho** | Aplicado de punta a punta sobre una base **vacía** creada al efecto, `ON_ERROR_STOP=1`, exit 0 y `grep -inE "error\|violat"` vacío (§ 6) |
| R7-S2 | 3 usuarios, 3 perfiles, un hash verificable | **satisfecho** | Ids 1/`store_owner@demo.com`, 2/`customer@demo.com`, 3/`admin@demo.com`, 3 perfiles, prefijo `$2b$` en los tres y `compareSync('demodemo', hash) = true` en los tres (§ 8) |
| R7-S3 | Regenerar el seed dos veces produce el mismo archivo | **satisfecho** | `cmp` limpio; y además idéntico al estado del working tree (§ 5) |
| R8 | Sin regresión del catálogo existente | **satisfecho** | Abajo |
| R8-S1 | Los conteos del catálogo no se mueven | **satisfecho** | `just db-check` verde (6 archivos / 57 tests) + `products` 1200, `categories` 198, `shops` 12 con `max(id) = 15` (§ 8) |

**Segunda mitad de R2-S1** — el scenario exige demostrar que `email = $1` **no**
usa el índice (la consecuencia que hereda US-21). Reproducido con `EXPLAIN`, y
forzando el planner para descartar que sea un artefacto de coste sobre 3 filas:

```
$ EXPLAIN SELECT * FROM users WHERE email = 'admin@demo.com';
 Seq Scan on users  (cost=0.00..16.50 rows=3 width=129)
   Filter: (email = 'admin@demo.com'::text)

$ EXPLAIN SELECT * FROM users WHERE lower(email) = lower('admin@demo.com');
 Index Scan using users_email_lower_idx on users  (cost=0.15..8.17 rows=1 width=129)
   Index Cond: (lower(email) = 'admin@demo.com'::text)

$ SET enable_seqscan=off; EXPLAIN SELECT * FROM users WHERE email = 'admin@demo.com';
 Seq Scan on users  (cost=10000000000.00..10000000016.50 rows=3 width=129)
   Filter: (email = 'admin@demo.com'::text)
```

Con `enable_seqscan=off` el planner **sigue** eligiendo el seq scan: el índice es
literalmente inutilizable para ese predicado. R-6 confirmado como riesgo real, no
teórico, y el hand-off a US-21 queda justificado con datos.

---

## 8. Evidencia de ejecución

### Tests (`test_command` de `openspec/config.yaml`)

```
$ just db-check
npm run typecheck
> @safari/db@0.1.0 typecheck
> tsc --noEmit

cd "$(pwd)" && npm test
> @safari/db@0.1.0 test
> vitest run

 RUN  v4.1.11 C:/DevOps/MyGitHub/safari-marketplace/packages/db
(node:31404) DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated …

 Test Files  6 passed (6)
      Tests  57 passed (57)
   Start at  10:48:47
   Duration  5.56s
```

Exit 0. **6 archivos / 57 tests**, sin caída respecto a la línea base. El
`DeprecationWarning` de `pg` es preexistente y ajeno a esta US.

Nota de matiz sobre `design.md` § Testing Strategy: la afirmación "**Ningún**
test lee `owner_id`" es correcta para los tests, pero la capa de datos **sí** lo
expone (`packages/db/src/records.ts:77,167` mapean `ownerId`). No hay regresión
porque los 12 valores siguen siendo `1` y `db-check` está verde; se anota solo
para que US-21 sepa que el campo ya viaja.

### Hash bcrypt (desde un directorio desechable fuera del repo)

```
$ psql -tAc "SELECT id||' '||password_hash FROM users ORDER BY id;"
1 $2b$10$j/.1t7ZmKUU4qHu8Elw3dO6N4udivEj1oxeVxA1m6HOnp7D4J761S
2 $2b$10$j/.1t7ZmKUU4qHu8Elw3dO6N4udivEj1oxeVxA1m6HOnp7D4J761S
3 $2b$10$j/.1t7ZmKUU4qHu8Elw3dO6N4udivEj1oxeVxA1m6HOnp7D4J761S

$ T=$(mktemp -d) && cd "$T" && npm install --no-save bcryptjs && node -e "…"
id=1 prefix=$2b$ demodemo=true wrongpass=false empty=false
id=2 prefix=$2b$ demodemo=true wrongpass=false empty=false
id=3 prefix=$2b$ demodemo=true wrongpass=false empty=false
```

Se añadieron los dos casos negativos que el plan no pedía (`demodemo1` y cadena
vacía) para descartar un hash degenerado que aceptara cualquier cosa: ambos
`false`. Y el hash de la base coincide byte a byte con el `HASH_DEMO` de
`db/generate-seed.mjs:62`.

### Build

```
build_command: "just build"   →  NO EJECUTADO, deliberadamente
```

`just build` compila los frontends Next.js (`apps/shop` + `apps/admin/rest`) y
**no toca nada de lo que cambia esta US**: el diff se limita a `db/` y a dos
docs. Ejecutarlo habría exigido detener los `dev` (comparten `.next`, ver
`CLAUDE.md`) sin aportar señal. El gate de compilación relevante **sí** corrió:
el `tsc --noEmit` de `just db-check`, verde. No se marca como "skipped" sin
explicación: se declara inaplicable con motivo.

---

## 9. Documentación

**`db/README.md`** (`:42-83`, entre "De dónde salen los datos" y "Cómo se adapta
el scraper", tal como pedía `design.md` § File Changes): documenta las 6 tablas y
sus relaciones, la matriz de permisos completa con ids, la credencial
**`demodemo`** y dónde vive el literal, por qué `lower(email)` y no `citext` con
la consecuencia `WHERE lower(email) = lower($1)`, por qué `otp_codes` no tiene FK,
y que ninguna de las 6 tablas tiene consumidor todavía. La línea de conteo `:26`
pasó a `… 1200 productos · 3 usuarios · 4 permisos`.

**Precisión de los conteos del README, re-verificada contra la base viva:**
`10 types · 12 shops · 198 categorías · 14 manufacturers · 10 tags · 1200
productos · 3 usuarios · 4 permisos`. Los cinco que se pudieron contrastar
(`shops` 12, `categories` 198, `products` 1200, `users` 3, `permissions` 4) son
exactos. La afirmación de `:32-33` sobre los tres shops reconstruidos (12, 14, 15)
sigue vigente: `max(shops.id) = 15`.

**US y épico:**

```
-**Status:** Listo para ejecución
+**Status:** ✅ Implementada          (20-esquema-identidad-postgres.md:10)

-| [US-20](./20-…) | … | ~380 | Listo para ejecución |
+| [US-20](./20-…) | … | ~380 | ✅ Implementada |     (README.md:56)
```

Los 7 ítems de la Definición de Done pasaron de `[ ]` a `[x]` y se añadió el
puntero a `apply-progress.md` como sede de la evidencia.

---

## 10. Notas de arrastre — verificadas, no citadas

**1. `just db-test` sigue roto por `test_pipeline.py`, no por `pipelines.py`.**
Confirmado leyendo ambos archivos (**sin ejecutar `just db-test`**, que escribe
en la base):

```
$ grep -nE "productos" services/scraper-worker/test_pipeline.py
83:  c.execute("DELETE FROM productos WHERE tienda IN ('Alkosto','Exito')")
95:  "SELECT precio, categoria, nombre FROM productos "
106: "SELECT count(*) FROM productos WHERE tienda='Alkosto' AND product_id='12345'"
109/120/123/132/156/160/163: … FROM productos …

$ grep -nE "INSERT INTO|FROM " services/scraper-worker/pipelines.py
187: "SELECT id FROM shops WHERE slug = slugify(%s)",
188: "INSERT INTO shops (name, slug) VALUES (%s, slugify(%s)) "
193/194: … manufacturers …
200: INSERT INTO products (
232: "SELECT slug, id FROM categories WHERE type_id = %s AND slug = ANY(%s)"
239/247: … category_product …
```

`test_pipeline.py` asserta **9 veces** contra la tabla legada `productos` (con
sus columnas legadas `tienda`, `precio`, `promocion`, `categoria`);
`pipelines.py` **ya está migrado** a `products`/`shops`/`manufacturers`/
`category_product`. `CLAUDE.md` culpa al archivo equivocado en **dos** sitios:

- `CLAUDE.md:48` — «OJO: HOY ROTO — el pipeline escribe en la tabla `productos`»
- `CLAUDE.md:90` — «PENDIENTE: `pipelines.py` aún upserta en la tabla `productos`»

Ambas afirmaciones son falsas hoy. Es trabajo de **US-6**; esta US no tocó ni un
archivo bajo `services/scraper-worker/`. **Riesgo vivo (R-5):** quien lea
`CLAUDE.md` "arreglará" un pipeline que no necesita nada.

*Nota colateral:* `pipelines.py:188` es exactamente el `INSERT INTO shops (name,
slug)` sin `owner_id` que hace load-bearing al `DEFAULT 1` — la premisa de
Decision C queda confirmada en el archivo, no solo en el design.

**2. Hand-off a US-21 — el `lower(email)`.** Vigente y ahora con evidencia dura
del planner (§ 7): `WHERE email = $1` no usa `users_email_lower_idx` ni con
`enable_seqscan=off`. Todo lookup por email debe escribirse `WHERE lower(email) =
lower($1)`. Documentado en `db/schema.sql:127-131` y `db/README.md:70-76`.

**3. Hand-off a US-22 — `demodemo` en `apps/README.md`.** Vigente:
`apps/README.md` no se modificó (`git diff --stat` sin salida para esa ruta),
tal como manda D-2.

**4. Deriva documental de US-22 — `.env.template` vs `.env.example`.**
Confirmada:

```
$ grep -n "env.template\|env.example" docs/product/19-autenticacion-autorizacion/22-login-jwt-postgres.md
122:| `apps/api/rest/.env.template` | `JWT_SECRET` y `JWT_EXPIRES_IN` |
153:- `JWT_SECRET` **no** se commitea con un valor real: va en `.env.template` con

$ grep -n "env.example" justfile
59:    crear apps/api/rest/.env.example    apps/api/rest/.env

$ ls -a apps/api/rest/ | grep -i env
.env
.env.example
```

`22-login-jwt-postgres.md:122,153` cita un archivo que no existe. El real es
`apps/api/rest/.env.example` (`justfile:59`). Ojo al matiz: `apps/shop` y
`apps/admin/rest` **sí** usan `.env.template` (`justfile:57-58`); la excepción es
la API. Corregir en US-22, no aquí.

**5. Hand-off a US-25 — `staff`.** Vigente: `permissions` id 4 = `staff`,
`guard_name = 'api'`, **0 asignados**. Asignarlo no requiere otro `db-reset`.

---

## 11. Design coherence

| Decisión | Estado | Nota |
|---|---|---|
| A — trigger en `users`/`profiles`, no en `permissions` | ✅ coherente | `pg_trigger`: 5 triggers, los 2 nuevos donde toca |
| B — 4 `CASCADE` + `RESTRICT` en `shops.owner_id` | ✅ coherente | `pg_constraint` + los 4 ensayos de borrado/inserción de § 3 |
| C — `DEFAULT 1` sobrevive y el comentario se reescribe | ✅ coherente | `column_default = 1`; `INSERT` sin `owner_id` → `owner_id = 1`; `db/schema.sql:223-229` |
| D — forma del DDL, banners, tipos, ubicación de índices | ✅ coherente | Banner `=====` en `users`, `-----` en las otras cinco, `permission_user` compartiendo el de `permissions` (`:171-172`); `users_email_lower_idx` pegado a su tabla, los 3 de consulta en la sección "Índices" |
| E — un solo literal bcrypt compartido | ✅ coherente | `HASH_DEMO` en `:62`, reutilizado en las 3 filas; cero dependencias nuevas |
| F — 5 validaciones previas | ✅ coherente | `:119-140`; efectividad probada por mutación |
| G — `created_at`/`updated_at` no se emiten | ✅ coherente | Ningún bloque los emite; las filas toman el `now()` del `db-up` |
| H — `email_verified_at` con `txt()`, nunca `ts()` | ✅ coherente | `:214`; `email_verified_at` **no nulo solo** en el usuario 3 — la trampa de `ts()` (que devuelve `now()` ante `null`) se evitó |
| I — `is_active` con `bool()` | ✅ coherente | 3 filas en `true` desde el entero `1` |
| J — `ON CONFLICT` por PK real | ✅ coherente | `(id)`, `(user_id)`, `(id)`, `(user_id, permission_id)` |
| K — `setval` solo para `users` y `permissions` | ✅ coherente | `:417` |
| L — `pivot.model_type` no se persiste | ✅ coherente | No aparece en el generador ni en el DDL |
| M — cabeceras de conteo | ✅ coherente | `db/seed.sql:11`, `db/generate-seed.mjs:165-167`, `db/README.md:26` |

**Desviaciones del diseño: ninguna.** La única diferencia respecto al `design.md`
es la expansión del DDL que el propio design marcaba como "compactado", hecha en
el estilo real del archivo — lo cual es lo que el design pedía.

---

## 12. Issues

**CRITICAL: ninguno.**

**WARNING: ninguno.**

**SUGGESTION (2, cosméticas, ninguna acción exigida por esta US):**

1. `db/README.md:44` dice que «`users.json` … siembra 6 tablas» y a continuación
   aclara que dos están vacías. Estrictamente `users.json` **siembra 4** tablas y
   el DDL **crea 6**. El paréntesis inmediato desambigua, así que no engaña; una
   redacción como "crea 6 tablas y siembra 4" sería más exacta.
2. `design.md` § Testing Strategy afirma «Ningún test lee `owner_id`» — cierto
   para los tests, pero `packages/db/src/records.ts:77,167` **sí** mapea
   `ownerId`. Sin impacto (los 12 valores siguen en `1`, `db-check` verde); vale
   como aviso para US-21.

---

## 13. Definición de Done de US-20 — veredicto explícito

| # | Ítem de la DoD | Verdicto | Dónde |
|---|---|---|---|
| 1 | `just db-reset` completo sin errores, con la salida pegada | **cerrado** | Salida pegada en `apply-progress.md` § 1. Re-derivación independiente sin `db-reset`: `schema.sql`+`seed.sql` aplicados a una base vacía con `ON_ERROR_STOP=1`, exit 0, `grep error\|violat` vacío (§ 6) |
| 2 | `SELECT` con 3 usuarios (ids originales), 3 perfiles, `permission_user`, 0 huérfanas | **cerrado** | § 7 — 3/3/6/0, ids 1-2-3, matriz exacta |
| 3 | Verificación del hash: `compare('demodemo', hash)` = `true` x3 | **cerrado** | § 8 — `true` x3, `false` en los dos casos negativos |
| 4 | `just db-check` verde | **cerrado** | § 8 — exit 0, 6 archivos / 57 tests |
| 5 | Conteos del catálogo: 1200 / 12 / 198 | **cerrado** | § 7 — 1200 / 12 (`max(id)=15`) / 198 |
| 6 | `db/README.md` con el modelo y la credencial demo | **cerrado** | § 9 |
| 7 | `Status` de la US actualizado y fila del épico marcada | **cerrado** | § 9 |

| CA | Verdicto | Evidencia |
|---|---|---|
| CA-1 — Tablas de identidad creadas | **satisfecho** | § 2, § 7 (R1) |
| CA-2 — Tablas de recuperación y OTP creadas, con la nota de "nadie las usa" en el DDL | **satisfecho** | § 2, § 7 (R5); `db/schema.sql:182,198` |
| CA-3 — La FK de tiendas cierra | **satisfecho** | § 3, § 7 (R6) — 0 huérfanas, 12 tiendas |
| CA-4 — Seed con los 3 usuarios y credencial usable | **satisfecho** | § 7, § 8 — ids 1/2/3, permisos en `snake_case`, `demodemo` verificable, hash literal sin dependencias nuevas |
| CA-5 — El orden del seed respeta la FK | **satisfecho** | § 6 — bloques de identidad antes de `shops`, aplicación desde vacío sin una sola violación |
| CA-6 — Sin regresión del catálogo | **satisfecho** | § 8 — `db-check` 57/57, 1200/12/198 |

**Los 3 escenarios Gherkin de la US** (CA-3 la FK cierra · CA-4 la credencial es
verificable · CA-5 el orden respeta la FK) están los tres satisfechos con salida
real, ninguno queda como `unverified`.

**La Definición de Done de US-20 está cerrada.** No se encontró ningún defecto.
Ni un `unverified`: los 12 scenarios de la spec y los 6 CA se pudieron verificar
con evidencia de ejecución. El único desacuerdo con el material de entrada es el
recuento de requirements/scenarios del brief (§ 0), que no afecta al resultado.

---

## 14. Veredicto final

**PASS**

- Completeness: 23/23 tareas, todas con respaldo real en los archivos.
- Correctness: 8/8 requirements y 12/12 scenarios satisfechos.
- Coherence: 13/13 decisiones de diseño coherentes; cero desviaciones.
- Runtime evidence: `just db-check` verde (57 tests), aplicación del seed desde
  vacío sin violaciones, prueba por mutación de la guarda del generador,
  determinismo `cmp`-limpio, `compareSync` positivo y negativo, y 4 ensayos de
  comportamiento de FK.
- `build_command` (`just build`) inaplicable a este cambio y no ejecutado, con
  justificación (§ 8).
- Ningún archivo del proyecto se modificó durante esta verificación
  (`git status --porcelain` idéntico antes y después) y `safari_scraper` quedó en
  su estado post-apply.
- Listo para el gate de archive, a criterio del dueño del repo (sigue todo en el
  working tree, sin commits).
