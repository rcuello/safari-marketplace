# Apply Progress: Esquema de identidad en Postgres (US-20)

**Modo:** Standard (strict_tdd: false). Lote único — sin apply-progress previo.
**Resultado:** 23/23 tareas completas. Las 5 fases están cerradas.

## Tareas completas (todas)

### Fase 1 — DDL `db/schema.sql`
- [x] 1.1 6 `CREATE TABLE` (`users`, `profiles`, `permissions`, `permission_user`,
      `password_reset_tokens`, `otp_codes`) insertadas tras el cierre de `types`.
- [x] 1.2 `CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email))`.
- [x] 1.3 FK inline `shops.owner_id bigint NOT NULL DEFAULT 1 REFERENCES users(id) ON DELETE RESTRICT`.
- [x] 1.4 3 índices de consulta: `permission_user_permiso_idx`, `password_reset_tokens_user_idx`,
      `otp_codes_phone_idx`.
- [x] 1.5 2 triggers `tocar_updated_at()` en `users`/`profiles` (no en `permissions`).
- [x] 1.6 Comentarios `:13-15` (alcance) y `:111-112` (FK de `shops.owner_id`) reescritos.

### Fase 2 — Generador `db/generate-seed.mjs`
- [x] 2.1 `HASH_DEMO` fijado como literal, producido fuera del repo; comando de
      regeneración documentado junto a la constante.
- [x] 2.2 `leer('users')`, catálogo `permissionsCatalogo` (4 filas) y matriz
      `asignaciones` derivada de `u.id` (nunca de `pivot.model_id`).
- [x] 2.3 5 comprobaciones añadidas a la validación previa (`user_id`/`permission_id`
      del pivote, id 4 libre para `staff`, `owner_id` de shops existe, emails
      únicos case-insensitive, prefijo `$2` de `HASH_DEMO`).
- [x] 2.4 4 bloques de emisión (`users`→`profiles`→`permissions`→`permission_user`)
      insertados antes del bloque `shops`, con `ON CONFLICT` por PK real.
- [x] 2.5 `setval` extendido a `users`/`permissions`; cabeceras de conteo actualizadas
      (comentario del archivo y `console.log` final).

### Fase 3 — Regeneración y determinismo
- [x] 3.1 Generador corrido 2 veces seguidas; `cmp` sin diferencias.
- [x] 3.2 `git diff --stat db/seed.sql` — diff aditivo, solo bloques nuevos antes de `shops`.

### Fase 4 — Aplicar y verificar
- [x] 4.1 GATE de confirmación satisfecho por autorización explícita del dueño en esta
      sesión (2026-09-02). Mitigante verificado antes de tocar nada:
      `SELECT count(*) FROM products WHERE source_store IS NOT NULL` = 0.
- [x] 4.2 `just db-reset` corrido de punta a punta, log sin errores ni violaciones reales.
- [x] 4.3 Estructura de las 6 tablas y `pg_constraint` verificados; el `INSERT` de
      `ADMIN@demo.com` en `BEGIN/ROLLBACK` falla por `users_email_lower_idx`.
- [x] 4.4 3 usuarios / 3 perfiles / 4 permisos / 6 filas de `permission_user` / 0
      tiendas huérfanas, y la matriz de asignación coincide exactamente.
- [x] 4.5 Los 3 hashes tienen prefijo `$2b$` y `bcryptjs.compareSync('demodemo', hash)`
      = `true` para los 3.
- [x] 4.6 `just db-check` verde (6 archivos / 57 tests, igual que la línea base) y
      conteos de catálogo sin cambio: 1200 productos / 12 shops (`max(id)=15`) / 198 categorías.

### Fase 5 — Documentación y cierre
- [x] 5.1 `db/README.md`: sección `## Identidad: usuarios, perfiles y permisos` añadida
      entre "De dónde salen los datos" y "Cómo se adapta el scraper"; conteo de `:26`
      actualizado con `3 usuarios · 4 permisos`.
- [x] 5.2 Hand-off documentado (no accionado): US-21 hereda el lookup
      `WHERE lower(email) = lower($1)` (D-1, R-6); US-22 documenta `demodemo` en
      `apps/README.md` (decisión 7 del épico, D-2) y corrige la cita a `.env.template`
      → `.env.example` en `22-login-jwt-postgres.md:122,153`.
- [x] 5.3 Confirmado y documentado: `just db-test` sigue roto por
      `services/scraper-worker/test_pipeline.py` (asserta contra la tabla legada
      `productos`), **no** por `pipelines.py` (ya migrado a `products`/`shops`/
      `manufacturers`). `CLAUDE.md` culpa al archivo equivocado. Es trabajo de US-6,
      no de esta US — no se tocó ningún archivo del scraper.
- [x] 5.4 `Status` de US-20 actualizado a `✅ Implementada` (precedente de
      `docs/product/1-catalogo-desde-postgres/`) y fila del épico marcada igual.

## Evidencia (Definición de Done)

### 1. `just db-reset` completo

Estado previo verificado (mitigante de R-3/D-10, antes de tocar nada):

```
$ docker exec safari-postgres psql -U safari -d safari_scraper -c "SELECT count(*) FROM products WHERE source_store IS NOT NULL;"
 count
-------
     0
(1 row)
```

Salida completa de `just db-reset`:

```
docker compose down -v
 Container safari-postgres  Stopping
 Container safari-postgres  Stopped
 Container safari-postgres  Removing
 Container safari-postgres  Removed
 Volume safari-marketplace_postgres-data  Removing
 Network safari-marketplace_default  Removing
 Network safari-marketplace_default  Removed
 Volume safari-marketplace_postgres-data  Removed
just db-up
 Network safari-marketplace_default  Creating
 Network safari-marketplace_default  Created
 Volume "safari-marketplace_postgres-data"  Creating
 Volume "safari-marketplace_postgres-data"  Created
 Container safari-postgres  Creating
 Container safari-postgres  Created
 Container safari-postgres  Starting
 Container safari-postgres  Started
esperando a Postgres. listo
docker compose exec -T postgres psql -U safari -d safari_scraper -v ON_ERROR_STOP=1 -q -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
docker compose exec -T postgres psql -U safari -d safari_scraper -v ON_ERROR_STOP=1 -q < db/schema.sql
docker compose exec -T postgres psql -U safari -d safari_scraper -v ON_ERROR_STOP=1 -q < db/seed.sql
 setval
--------
     11
(1 row)

 setval
--------
      3
(1 row)

 setval
--------
      4
(1 row)

 setval
--------
     15
(1 row)

 setval
--------
    212
(1 row)

 setval
--------
     19
(1 row)

 setval
--------
     62
(1 row)

 setval
--------
   1259
(1 row)

  * esquema y datos de referencia aplicados
```

Verificación de que el log no contiene errores ni violaciones reales (el único match
de "error" es el literal `ON_ERROR_STOP=1` de la propia invocación de `psql`):

```
$ grep -inE "error|violat" db-reset.log | grep -viE "ON_ERROR_STOP"
(sin salida — vacío)
```

CA-5 cumplido.

### 2. Estructura de las 6 tablas + `pg_constraint`

```
                                          Table "public.users"
      Column       |           Type           | Collation | Nullable |              Default
-------------------+--------------------------+-----------+----------+-----------------------------------
 id                | bigint                   |           | not null | nextval('users_id_seq'::regclass)
 name              | text                     |           | not null |
 email             | text                     |           | not null |
 password_hash     | text                     |           | not null |
 is_active         | boolean                  |           | not null | true
 email_verified_at | timestamp with time zone |           |          |
 created_at        | timestamp with time zone |           | not null | now()
 updated_at        | timestamp with time zone |           | not null | now()
Indexes:
    "users_pkey" PRIMARY KEY, btree (id)
    "users_email_lower_idx" UNIQUE, btree (lower(email))
Referenced by:
    TABLE "password_reset_tokens" CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    TABLE "permission_user" CONSTRAINT "permission_user_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    TABLE "profiles" CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    TABLE "shops" CONSTRAINT "shops_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT
Triggers:
    users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION tocar_updated_at()

                          Table "public.profiles"
    Column     |           Type           | Collation | Nullable | Default
---------------+--------------------------+-----------+----------+---------
 user_id       | bigint                   |           | not null |
 avatar        | jsonb                    |           |          |
 bio           | text                     |           |          |
 socials       | jsonb                    |           |          |
 contact       | text                     |           |          |
 notifications | jsonb                    |           |          |
 created_at    | timestamp with time zone |           | not null | now()
 updated_at    | timestamp with time zone |           | not null | now()
Indexes:
    "profiles_pkey" PRIMARY KEY, btree (user_id)
Foreign-key constraints:
    "profiles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
Triggers:
    profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION tocar_updated_at()

                                       Table "public.permissions"
   Column   |           Type           | Collation | Nullable |                 Default
------------+--------------------------+-----------+----------+-----------------------------------------
 id         | bigint                   |           | not null | nextval('permissions_id_seq'::regclass)
 name       | text                     |           | not null |
 guard_name | text                     |           | not null | 'api'::text
 created_at | timestamp with time zone |           | not null | now()
 updated_at | timestamp with time zone |           | not null | now()
Indexes:
    "permissions_pkey" PRIMARY KEY, btree (id)
    "permissions_name_key" UNIQUE CONSTRAINT, btree (name)
Referenced by:
    TABLE "permission_user" CONSTRAINT "permission_user_permission_id_fkey" FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE

                      Table "public.permission_user"
    Column     |           Type           | Collation | Nullable | Default
---------------+--------------------------+-----------+----------+---------
 user_id       | bigint                   |           | not null |
 permission_id | bigint                   |           | not null |
 created_at    | timestamp with time zone |           | not null | now()
Indexes:
    "permission_user_pkey" PRIMARY KEY, btree (user_id, permission_id)
    "permission_user_permiso_idx" btree (permission_id)
Foreign-key constraints:
    "permission_user_permission_id_fkey" FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
    "permission_user_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE

                                       Table "public.password_reset_tokens"
   Column    |           Type           | Collation | Nullable |                      Default
-------------+--------------------------+-----------+----------+---------------------------------------------------
 id          | bigint                   |           | not null | nextval('password_reset_tokens_id_seq'::regclass)
 user_id     | bigint                   |           | not null |
 token       | text                     |           | not null |
 expires_at  | timestamp with time zone |           | not null |
 consumed_at | timestamp with time zone |           |          |
 created_at  | timestamp with time zone |           | not null | now()
Indexes:
    "password_reset_tokens_pkey" PRIMARY KEY, btree (id)
    "password_reset_tokens_token_key" UNIQUE CONSTRAINT, btree (token)
    "password_reset_tokens_user_idx" btree (user_id)
Foreign-key constraints:
    "password_reset_tokens_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE

                                       Table "public.otp_codes"
   Column    |           Type           | Collation | Nullable |                Default
-------------+--------------------------+-----------+----------+---------------------------------------
 id          | bigint                   |           | not null | nextval('otp_codes_id_seq'::regclass)
 phone       | text                     |           | not null |
 code        | text                     |           | not null |
 expires_at  | timestamp with time zone |           | not null |
 consumed_at | timestamp with time zone |           |          |
 created_at  | timestamp with time zone |           | not null | now()
Indexes:
    "otp_codes_pkey" PRIMARY KEY, btree (id)
    "otp_codes_phone_idx" btree (phone)
```

`pg_constraint` sobre `users` (4 FK, como exige el diseño: 3 `c` + `shops`=`r`):

```
$ psql -c "SELECT conname, conrelid::regclass tbl, confdeltype FROM pg_constraint WHERE contype='f' AND confrelid='users'::regclass;"
              conname               |          tbl          | confdeltype
------------------------------------+-----------------------+-------------
 profiles_user_id_fkey              | profiles              | c
 permission_user_user_id_fkey       | permission_user       | c
 password_reset_tokens_user_id_fkey | password_reset_tokens | c
 shops_owner_id_fkey                | shops                 | r
(4 rows)
```

Rechazo del duplicado case-insensitive (D-1 verificado):

```
$ psql -c "BEGIN; INSERT INTO users (name,email,password_hash) VALUES ('d','ADMIN@demo.com','x'); ROLLBACK;"
ERROR:  duplicate key value violates unique constraint "users_email_lower_idx"
DETAIL:  Key (lower(email))=(admin@demo.com) already exists.
BEGIN
```

CA-1/CA-2 cumplidos.

### 3. Datos sembrados (CA-3 / CA-4)

```
$ psql -c "SELECT id, name, email, is_active, email_verified_at, left(password_hash,4) FROM users ORDER BY id;"
 id |    name     |        email         | is_active |   email_verified_at    | left
----+-------------+----------------------+-----------+------------------------+------
  1 | Store Owner | store_owner@demo.com | t         |                        | $2b$
  2 | Customer    | customer@demo.com    | t         |                        | $2b$
  3 | Jhon Doe    | admin@demo.com       | t         | 2023-11-12 10:59:14+00 | $2b$
(3 rows)

$ psql -c "SELECT (SELECT count(*) FROM profiles) perfiles, (SELECT count(*) FROM permissions) permisos,
                  (SELECT count(*) FROM permission_user) pivote,
                  (SELECT count(*) FROM shops s LEFT JOIN users u ON u.id=s.owner_id WHERE u.id IS NULL) huerfanas;"
 perfiles | permisos | pivote | huerfanas
----------+----------+--------+-----------
        3 |        4 |      6 |         0
(1 row)

$ psql -c "SELECT u.id, u.email, p.name FROM permission_user pu
             JOIN users u ON u.id=pu.user_id JOIN permissions p ON p.id=pu.permission_id
           ORDER BY u.id, p.id;"
 id |        email         |    name
----+----------------------+-------------
  1 | store_owner@demo.com | customer
  1 | store_owner@demo.com | store_owner
  2 | customer@demo.com    | customer
  3 | admin@demo.com       | super_admin
  3 | admin@demo.com       | customer
  3 | admin@demo.com       | store_owner
(6 rows)

$ psql -c "SELECT id, name, guard_name FROM permissions ORDER BY id;"
 id |    name     | guard_name
----+-------------+------------
  1 | super_admin | api
  2 | customer    | api
  3 | store_owner | api
  4 | staff       | api
(4 rows)

$ psql -c "SELECT count(*) FROM password_reset_tokens;" -c "SELECT count(*) FROM otp_codes;"
 count
-------
     0
(1 row)

 count
-------
     0
(1 row)
```

Coincide exactamente con la matriz esperada (admin=3 → super_admin+customer+store_owner;
store_owner=1 → customer+store_owner; customer=2 → customer), 3/4/6/0. `staff` (id 4)
existe sin asignar. `password_reset_tokens`/`otp_codes` vacías, sin consumidor (US-24).

### 4. Verificación del hash bcrypt (CA-4)

```
$ docker exec safari-postgres psql -U safari -d safari_scraper -tAc "SELECT id||' '||password_hash FROM users ORDER BY id;"
1 $2b$10$j/.1t7ZmKUU4qHu8Elw3dO6N4udivEj1oxeVxA1m6HOnp7D4J761S
2 $2b$10$j/.1t7ZmKUU4qHu8Elw3dO6N4udivEj1oxeVxA1m6HOnp7D4J761S
3 $2b$10$j/.1t7ZmKUU4qHu8Elw3dO6N4udivEj1oxeVxA1m6HOnp7D4J761S

$ node -e "const b=require('bcryptjs'), fs=require('fs');
for (const l of fs.readFileSync(process.env.SCRATCH+'/hashes.txt','utf8').trim().split(/\r?\n/)) {
  const [id,h]=l.split(' '); console.log(id, h.slice(0,4), b.compareSync('demodemo', h)); }"
1 $2b$ true
2 $2b$ true
3 $2b$ true
```

Los 3 usuarios: prefijo bcrypt `$2b$` y `compareSync('demodemo', hash) === true`.

### 5. `just db-check` (CA-6, no regresión)

```
$ just db-check
npm run typecheck
> @safari/db@0.1.0 typecheck
> tsc --noEmit

npm test
> @safari/db@0.1.0 test
> vitest run

 RUN  v4.1.11 C:/DevOps/MyGitHub/safari-marketplace/packages/db

 Test Files  6 passed (6)
      Tests  57 passed (57)
   Start at  10:35:43
   Duration  7.92s
```

6 archivos / 57 tests — igual que la línea base declarada (sin drop).

### 6. Conteos de catálogo (CA-6)

```
$ psql -c "SELECT (SELECT count(*) FROM products) productos, (SELECT count(*) FROM shops) shops,
                  (SELECT max(id) FROM shops) max_shop_id, (SELECT count(*) FROM categories) categorias;"
 productos | shops | max_shop_id | categorias
-----------+-------+-------------+------------
      1200 |    12 |          15 |        198
(1 row)
```

Idéntico a la línea base verificada (1200/12 con `max(id)=15`/198). Sin regresión.

### 7. Determinismo del generador

```
$ node db/generate-seed.mjs
db/seed.sql generado (588 KB)
  10 types · 12 shops (3 recuperados) · 198 categorías · 14 manufacturers · 10 tags · 1200 productos · 3 usuarios · 4 permisos
$ cp db/seed.sql seed.run1.sql
$ node db/generate-seed.mjs
db/seed.sql generado (588 KB)
  10 types · 12 shops (3 recuperados) · 198 categorías · 14 manufacturers · 10 tags · 1200 productos · 3 usuarios · 4 permisos
$ cmp db/seed.sql seed.run1.sql && echo "DETERMINISTA: sin diferencias"
DETERMINISTA: sin diferencias
```

### 8. `git status` / `git diff --stat` final

```
On branch main
Your branch is up to date with 'origin/main'.

Changes not staged for commit:
	modified:   db/README.md
	modified:   db/generate-seed.mjs
	modified:   db/schema.sql
	modified:   db/seed.sql
	modified:   docs/product/19-autenticacion-autorizacion/20-esquema-identidad-postgres.md
	modified:   docs/product/19-autenticacion-autorizacion/README.md

Untracked files:
	openspec/changes/esquema-identidad-postgres/

 db/README.md                                                          |  45 +++-
 db/generate-seed.mjs                                                  | 127 +++++++++-
 db/schema.sql                                                         | 141 +++++++++-
 db/seed.sql                                                           |  51 +++++-
 .../20-esquema-identidad-postgres.md                                  |  19 +-
 .../19-autenticacion-autorizacion/README.md                           |   2 +-
 6 files changed, 365 insertions(+), 20 deletions(-)
```

Todo el diff cae dentro del scope declarado por la propuesta. Nada bajo `packages/db`,
`apps/api/rest`, `apps/README.md` ni `services/scraper-worker/**` fue tocado.

## Desviaciones del diseño

Ninguna. Cada bloque del generador, cada tabla del DDL, el orden de emisión, las
acciones de FK, los triggers, el `setval` y la sección de `db/README.md` siguen
`design.md` al pie de la letra. El único elemento que el diseño dejaba como
"compactado" (el DDL completo con comentarios de 2-6 líneas por tabla) se expandió
en `db/schema.sql` siguiendo el estilo real del archivo (banners `=====`/`-----`,
alineación de columnas, prosa explicando decisiones y no la sintaxis).

## Problemas encontrados

Ninguno bloqueante. Dos notas de proceso, ninguna afecta el resultado:

1. El primer intento de verificar el hash con `bcryptjs` desde el directorio temporal
   falló porque `SCRATCH` no estaba `export`ado en la sub-shell del `node -e`; se
   corrigió exportando la variable antes de invocar Node.
2. Una edición de `db/generate-seed.mjs` con un bloque de contexto grande no encontró
   coincidencia por un problema de matching de la herramienta de edición (no del
   contenido); se resolvió acotando el `old_string` a una porción más pequeña y única.

## Hand-off (no accionado aquí)

1. **US-21**: todo lookup por email debe escribirse `WHERE lower(email) = lower($1)`
   (D-1, R-6) — un `email = $1` no usa `users_email_lower_idx`. Su CA-2 depende de esto.
2. **US-22**: documentar la credencial `demodemo` en `apps/README.md` (decisión 7 del
   épico, aplazada por D-2). Y corregir `22-login-jwt-postgres.md:122,153`, que cita
   `apps/api/rest/.env.template`; el archivo real es `.env.example` (`justfile:59`).
3. **US-25**: `staff` (id 4) ya existe en `permissions` sin asignar — asignarlo no
   requiere otro `db-reset`.

## `just db-test` — precisión requerida

`just db-test` (el test del pipeline del scraper) **sigue roto** después de esta US,
y **no** por el archivo que `CLAUDE.md` menciona. La causa exacta es
`services/scraper-worker/test_pipeline.py`: sus asserts consultan la tabla legada
`productos` (`SELECT ... FROM productos WHERE tienda=...`, verificado en el archivo).
`services/scraper-worker/pipelines.py` **ya está migrado** y escribe en
`products`/`shops`/`manufacturers`. Es trabajo de **US-6**, no de esta US. No se tocó
ningún archivo bajo `services/scraper-worker/` en este apply.

## Workload / PR Boundary

- Modo: single PR (forecast Medium, sin `size:exception` necesario).
- Unidad de trabajo actual: US-20 completa (23/23 tareas).
- Límite: este lote empieza desde cero (sin apply-progress previo) y termina con la
  US completa, evidencia pegada y documentación cerrada.
- Impacto en presupuesto de revisión: ~365 líneas netas en diff manual+generado,
  dentro del rango estimado (~260-300 manuales + ~90-130 generadas). Recomendación
  del propio `tasks.md`: dejar `db/seed.sql` en un commit aparte del resto (precedente
  US-5), ya que es artefacto regenerado y no se edita a mano. **No se ha creado ningún
  commit**: todo queda en el working tree para que el dueño del repo decida.
