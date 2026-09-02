# Design: Esquema de identidad en Postgres

> US-20, Épico 19. Insumos: `proposal.md` y `explore.md`. Formato:
> `archive/2026-08-31-endpoints-derivados-postgres/design.md` (US-5). Toda cifra, nombre de
> índice y acción de FK sale del archivo citado o de un `SELECT` de solo lectura contra
> `:5433`. Lo marcado **(cerrada)** lo fijó el dueño del repo: no se re-abre aquí.

## Technical Approach

Tres archivos, en este orden, y ni una línea de código de aplicación:

1. **DDL.** Un bloque de 6 tablas se **inserta** entre el `CREATE TABLE types` (cierra en `:100`)
   y el banner de `shops` (`:103`), dentro de la transacción única `BEGIN` (`:23`) / `COMMIT`
   (`:374`) — verificado. `shops.owner_id` gana su FK **inline** (D-8) y los dos comentarios que
   quedan falsos (`:13-15`, `:111-112`) se reescriben.
2. **Generador.** `db/generate-seed.mjs` lee `users.json`, valida antes de escribir y emite
   `users` → `profiles` → `permissions` → `permission_user` **antes** del bloque `shops`
   (hoy `:140`). El `setval` de `:297` gana dos tablas. Cero helpers nuevos.
3. **Doc.** `db/README.md` gana la sección de identidad con la credencial `demodemo`;
   `apps/README.md` queda **fuera** (D-2, hand-off a US-22).

Se regenera `db/seed.sql` y se adopta con **un solo `just db-reset`** (D-10).

**D-1..D-10 del proposal se aplican tal cual (cerradas)**: `lower(email)` sin `citext` ni
`CREATE EXTENSION` · solo `db/README.md` · `otp_codes` por teléfono sin FK · `profiles` con PK
`user_id` · `user_id` del usuario iterado · `created_at` en el pivote · tokens por `user_id` ·
identidad antes de `shops` con FK inline · `staff` sin asignar · `db-reset` con confirmación.

## Data Flow

    users.json ─┬→ validación previa (FK/PK/email/hash) ──exit(1)──✗
                └→ users → profiles → permissions → permission_user ─┐
                                                                     ├→ seed.sql
    settings/types ──────────────────────────────────────────────────┤   (orden = FK)
    shops (owner_id → users.id) → categories → … → products ─────────┘

    schema.sql (BEGIN … COMMIT) ──db-migrate ON_ERROR_STOP=1──→ Postgres 5433

El orden de emisión pasa a ser **significativo** (R-3 del épico).

## Architecture Decisions

### Decision A: el trigger `tocar_updated_at()` SÍ se engancha a `users` y `profiles`, NO a `permissions`

**Choice**: dos `CREATE OR REPLACE TRIGGER` tras `:371`, con la forma de los tres existentes.
`permissions` queda sin trigger; las otras tres tablas nuevas no tienen `updated_at`.

**Alternatives considered**: (a) ninguna tabla nueva con trigger — `users.updated_at` congelado
en el `now()` del `db-up` para siempre; (b) las tres con `updated_at`, `permissions` incluida.

**Rationale**: el archivo **no escribe** el criterio en ningún comentario (`:355-357` dice solo
"updated_at automático"): la frase del explore es una inferencia. Hay que leerlo del reparto,
verificado en la base viva: **7 tablas tienen `updated_at` y solo 3 tienen trigger**
(`products`, `categories`, `shops`); `settings`, `types`, `manufacturers` y `tags` no. Y el
criterio tampoco es "lo que el scraper escribe": `pipelines.py:186-197` inserta `shops` y
`manufacturers` con el mismo get-or-create (`ON CONFLICT (slug) DO NOTHING`, sin `UPDATE`) y
solo uno tiene trigger. Lo que distingue al trío es recibir **`UPDATE` de verdad**.

Por ese criterio `users` entra con evidencia dura: **US-25 CA-4** hace de
`block-user`/`unblock-user` escrituras reales sobre `is_active`. Sin el trigger, US-25 tendría
que tocar `updated_at` a mano en cada repositorio y el primero que lo olvide deja el dato
mintiendo. `profiles` entra igual (`PUT /api/users/:id` escribe bio/avatar/contact).
`permissions` **no**: 4 filas de catálogo estático, el perfil exacto de `types` y `tags`.

**Consequences**: el `INSERT` no se afecta (es `BEFORE UPDATE`) y el seed no cambia · US-21 no
necesita escribir `updatedAt` desde Prisma · nombres con el patrón `{tabla}_updated_at`.

### Decision B: `ON DELETE CASCADE` en las 3 FK hijas y `ON DELETE RESTRICT` en `shops.owner_id`

**Choice**: `profiles.user_id`, `permission_user.user_id`, `permission_user.permission_id` y
`password_reset_tokens.user_id` → `ON DELETE CASCADE`. `shops.owner_id` → `ON DELETE RESTRICT`.

**Alternatives considered**: el `NO ACTION` implícito (lo que el proposal dio por "sin
precedente"); `CASCADE` también en `shops.owner_id`; `SET NULL` en las hijas.

**Rationale**: **sí hay precedente, y es unánime** — las **11 FK de hoy declaran las 11 una
acción explícita**, verificado en `pg_constraint`: 6 `CASCADE` (`c`), 5 `SET NULL` (`n`), **cero**
`NO ACTION`. El estilo no es "no decidir el borrado", es decidirlo a la vista. La pregunta no es
*si* se declara, sino *cuál*.

| FK | Acción | Por qué |
|---|---|---|
| `profiles.user_id` | `CASCADE` | Un perfil sin usuario no es nada |
| `permission_user.user_id` / `.permission_id` | `CASCADE` | Pivote puro: calca `category_product`/`product_tag`, `CASCADE` por los dos lados |
| `password_reset_tokens.user_id` | `CASCADE` | Un token de un usuario borrado es basura explotable |
| `shops.owner_id` | **`RESTRICT`** | `CASCADE` aquí sería catastrófico: `products.shop_id` ya es `CASCADE`, así que borrar al usuario 1 arrastraría **las 12 tiendas y los 1200 productos**. `SET NULL` es imposible (columna `NOT NULL`) |

**Qué se rompe con y sin la acción**: hoy nada — el seed no borra ni una fila y ningún código
borra usuarios (US-25 bloquea con `is_active`). Se paga después: **sin** la declaración, un
`DELETE FROM users WHERE id = 2` falla con un error de FK opaco desde tres tablas y hay que
limpiar a mano; **con** ella, el usuario 2 se va limpio con perfil, permisos y tokens, y el
usuario 1 —dueño de las 12 tiendas— **no se puede borrar**. `RESTRICT` y no `NO ACTION` para que
el error salte en la sentencia. `ON UPDATE` no se declara: tampoco lo hacen las 11 existentes.

### Decision C: `DEFAULT 1` sobrevive en `shops.owner_id`, y ahora significa algo

**Choice**: la columna queda
`owner_id bigint NOT NULL DEFAULT 1 REFERENCES users(id) ON DELETE RESTRICT` y el comentario de
`:111-112` se reescribe entero.

**Alternatives considered**: quitar el `DEFAULT 1` ahora que hay tabla destino ("un default
inventado no debería sobrevivir a la FK").

**Rationale**: el default es **load-bearing y verificable**. `pipelines.py:187-190` crea los
retailers con `INSERT INTO shops (name, slug) VALUES (%s, slugify(%s))` — **no envía
`owner_id`**. Sin el `DEFAULT`, la primera corrida de cualquier spider violaría el `NOT NULL` y
rompería un pipeline que hoy funciona. Con la FK, el `1` deja de ser relleno y pasa a ser un
hecho: **`store_owner@demo.com`**. Verificado en la base viva que los **12** shops tienen
`owner_id = 1`: la FK cierra sin una sola fila huérfana.

**Consequences**: acoplamiento nuevo — **el usuario 1 tiene que existir siempre** o el scraper no
puede crear tiendas; lo protegen `RESTRICT` (B) y la validación (F).

Los dos comentarios falsos se reescriben, no se parchean: `:111-112` dice qué apunta a dónde, por
qué `RESTRICT` y por qué el default se queda, citando el scraper; `:13-15` saca `usuarios` del
"fuera de alcance deliberado" y declara el alcance nuevo — identidad para autenticación, sin
wallets, direcciones ni órdenes.

### Decision D: la forma exacta del DDL — banners, tipos, y dónde va cada índice

**Choice**: bloque insertado tras `:100`, en el idioma del archivo. `users` con banner `=====`
(pieza central de esta US, criterio visual de `products` `:192` y `category_product` `:299`);
las otras cinco con `-----`, y `permission_user` compartiendo el banner de `permissions` como
`product_tag` comparte el de `category_product` (`:314`).

```sql
CREATE TABLE IF NOT EXISTS users (
    id bigserial PRIMARY KEY,
    name text NOT NULL,
    email text NOT NULL,                 -- unicidad vía el índice funcional de abajo (D-1)
    password_hash text NOT NULL,         -- bcrypt coste 10; demo: `demodemo`
    is_active boolean NOT NULL DEFAULT true,
    email_verified_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));

CREATE TABLE IF NOT EXISTS profiles (
    user_id bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    avatar jsonb, bio text, socials jsonb, contact text, notifications jsonb,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS permissions (
    id bigserial PRIMARY KEY, name text NOT NULL UNIQUE,
    guard_name text NOT NULL DEFAULT 'api',
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS permission_user (
    user_id       bigint NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
    permission_id bigint NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, permission_id)
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token text NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
    consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS otp_codes (
    id bigserial PRIMARY KEY,
    phone text NOT NULL,            -- sin FK a users: ver el comentario del bloque (D-3)
    code text NOT NULL, expires_at timestamptz NOT NULL,
    consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
```

*(Compactado; en el archivo cada columna va en su línea alineada y cada tabla con sus 2-6 líneas
de prosa explicando la decisión, no la tabla.)*

**jsonb nullable, no `'{}'::jsonb`**: el archivo reserva el default `'{}'`/`'[]'` para lo que
siempre tiene contenido y deja `NULL` en lo genuinamente opcional (`logo`, `cover_image`,
`image`); `socials` y `notifications` son `null` en los **tres** usuarios. **Sin
`email_verified`**: redundante con `email_verified_at`, vale `true` solo en el usuario 3.

**Naming, verificado contra `pg_indexes` (26 índices reales, no un patrón supuesto)**:
`{tabla}_{descriptor}_idx` en los 10 escritos a mano; `_key` solo en el único índice único
escrito a mano (`products_procedencia_key`) y en los que Postgres genera por un `UNIQUE` inline
(`products_slug_key`…). Se conserva **`users_email_lower_idx`** como lo nombra D-1: `_idx` tiene
10 precedentes y el nombre no es contrato. `permissions_name_key` y
`password_reset_tokens_token_key` los generará Postgres solo, igual que los slugs.

**Dónde vive cada índice**: `users_email_lower_idx` **pegado a su tabla**, como
`products_procedencia_key` (`:294`), por ser restricción y no optimización. Los tres de consulta
—`permission_user_permiso_idx (permission_id)`, `password_reset_tokens_user_idx (user_id)`,
`otp_codes_phone_idx (phone)`— a la sección **"Índices"** tras `:352`: el inverso del pivote lo
pide US-25 CA-2 y los otros dos, US-24.

### Decision E: un solo literal bcrypt compartido por los 3 usuarios

**Choice**: una constante `HASH_DEMO` junto a los helpers, reutilizada en las tres filas.
Producida **una vez** en apply, fuera del repo:

```bash
cd "$(mktemp -d)" && npm install --no-save bcryptjs \
  && node -e "console.log(require('bcryptjs').hashSync('demodemo', 10))"
```

**Alternatives considered**: (a) tres literales distintos, uno por usuario; (b) hashear en
tiempo de generación con `bcryptjs` como dependencia del generador; (c) `npx bcryptjs demodemo 10`
tal como lo sugiere la US.

**Rationale**: (b) lo prohíbe la decisión 8 del épico y el motivo es mecánico, no estilístico:
**bcrypt embebe un salt aleatorio**, así que hashear en cada corrida produciría un `seed.sql`
distinto cada vez, sin que nada haya cambiado. El literal es estable **porque queda fijado**, no
porque sea reproducible: quien lo regenere obtendrá otra cadena que verifica igual de bien. Ese
es el determinismo que protege el chequeo de "regenerar dos veces da el mismo archivo".

(a) triplica el riesgo de pegar mal 60 caracteres sin ganar nada; que el hash compartido delate
la contraseña común es irrelevante con una credencial pública, y se declara en el comentario.
(c) se descarta como comando principal: `bcryptjs` **no documenta un binario CLI**, así que
`npx bcryptjs` puede resolver a otro paquete o fallar. El `cd "$(mktemp -d)"` no es cosmético:
**no existe `package.json` en la raíz** (verificado) y un `npm install` ahí crearía uno.

El comentario de la constante dice qué es, coste 10, el comando, y que regenerarlo da otra cadena
a propósito. `txt()` la escapa: el alfabeto de bcrypt no lleva comillas simples.

### Decision F: la validación previa del generador cubre identidad, y es la única defensa contra `model_id = 6`

**Choice**: extender el bloque de `:65-88` —que ya hace `process.exit(1)` antes de escribir
`seed.sql`— con cinco comprobaciones más, en el estilo de `problemas.push()`:

| Comprobación | Qué atrapa |
|---|---|
| todo `user_id` del pivote existe entre los usuarios emitidos | **R-1**: copiar `pivot.model_id` (**6** en admin) en vez del `id` iterado |
| todo `permission_id` del pivote existe en el catálogo | un permiso asignado que nadie declaró |
| el id de `staff` (4) no lo usa ya el mock | que `users.json` gane un cuarto permiso y colisione con D-9 |
| el `owner_id` de los 12 shops existe entre los usuarios | **la FK nueva**, como invariante del generador |
| emails únicos ignorando mayúsculas · `HASH_DEMO` empieza por `$2` | el índice de D-1 y un literal mal pegado |

**Rationale**: la emisión ya evita R-1 por construcción (`asignaciones` se arma con `u.id`, no
con `p.pivot.model_id`), pero eso es **una línea** que cualquiera puede "arreglar" creyendo que
el pivote es la fuente. La validación convierte ese error en `permission_user: user_id 6
inexistente` **antes** de escribir el archivo, en vez de en un `violates foreign key constraint`
a mitad del `db-reset`. La emisión lleva además el comentario de por qué se ignora
`pivot.model_id`: el defecto está en el dato de origen y sin nota alguien lo "restaura".

### Los 4 bloques del generador, insertados antes de `:140`

| Bloque | Columnas del `INSERT` | Helpers | `ON CONFLICT` |
|---|---|---|---|
| `users` | `id, name, email, password_hash, is_active, email_verified_at` | `txt`, `bool` | `(id) DO NOTHING` |
| `profiles` | `user_id, avatar, bio, socials, contact, notifications` | `json`, `txt` | `(user_id) DO NOTHING` |
| `permissions` | `id, name, guard_name` | `txt` | `(id) DO NOTHING` |
| `permission_user` | `user_id, permission_id` | ninguno (enteros) | `(user_id, permission_id) DO NOTHING` |

Cero helpers nuevos: `txt`/`bool`/`json` ya existen (`:36-41`); `num`, `arr` y `ts` no se usan.
Cada bloque abre con `bloque(...)` y 2-4 líneas de comentario, como los 6 existentes.

### Decisiones menores

| # | Tema | Decisión y evidencia |
|---|---|---|
| G | `created_at`/`updated_at` **no se emiten** | Ninguno de los 6 bloques existentes los emite: las filas toman el `now()` del `db-up`. Divergencia ya embarcada en `CLAUDE.md`; emitirlos solo aquí rompería la uniformidad |
| H | `email_verified_at` **sí**, con `txt()` **y no `ts()`** | Dato de negocio (2 de 3 sin verificar). `ts(null)` devuelve `now()` (`:46`): marcaría como verificadas las dos cuentas que no lo están. `ts()` hoy no lo llama nadie — verificado |
| I | `is_active` con `bool()` | El JSON trae el entero `1` en los tres; `bool()` (`:39`) hace exactamente esa conversión |
| J | `ON CONFLICT` por PK real | `users`/`permissions` → `(id)`, como los 6 bloques existentes; `profiles` → `(user_id)`; `permission_user` → `(user_id, permission_id)` |
| K | `setval` solo para `users` y `permissions` | `profiles` (PK prestada) y `permission_user` (compuesta) no tienen secuencia; las de US-24 van con **0 filas** y `GREATEST(…,1)` sería un no-op. `:297` pasa a `['types','users','permissions','shops','categories','manufacturers','tags','products']` |
| L | `pivot.model_type` no se persiste | Constante `"Marvel\\Database\\Models\\User"` sin contraparte. Si `/me` la necesita, se fija en el servicio de Nest (US-22) |
| M | Cabeceras de conteo | La línea del generador (`:106-107`) y su gemela en `db/README.md:26` ganan `· 3 usuarios · 4 permisos` |

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `db/schema.sql` | Modify | 6 tablas tras `:100` + `users_email_lower_idx`; FK inline en `owner_id` (`:119`); 3 índices tras `:352`; 2 triggers tras `:371`; reescritura de `:13-15` y `:111-112` |
| `db/generate-seed.mjs` | Modify | `leer('users')`, `HASH_DEMO`, catálogo de permisos + `asignaciones`, 5 validaciones en `:65-88`, 4 bloques antes de `:140`, `setval` `:297`, conteos |
| `db/seed.sql` | **Regenerado** | Artefacto (`db/README.md:9`). Diff aditivo: los INSERT del catálogo no se tocan |
| `db/README.md` | Modify | Sección `## Identidad: usuarios, perfiles y permisos` **entre** `## De dónde salen los datos` y `## Cómo se adapta el scraper` (es dato sembrado) + conteos de `:26`. Contenido: las 6 tablas y sus relaciones, la matriz de permisos, la credencial **`demodemo`**, por qué `lower(email)` obliga a `WHERE lower(email) = lower($1)`, por qué `otp_codes` no tiene FK, y que las dos tablas de US-24 no tienen consumidor |
| `justfile`, `docker-compose.yml` | **Sin cambios** | Ningún `CREATE EXTENSION` nuevo (D-1); `db-migrate` ya aplica ambos archivos con `ON_ERROR_STOP=1` |
| `apps/README.md`, `packages/db/**`, `apps/api/rest/**`, `services/scraper-worker/**` | **Sin cambios** | D-2 y el "NO incluye" |
| `docs/product/19-.../{20-….md, README.md}` | Modify | Status de la US y fila del épico |

## Interfaces / Contracts

Ninguno HTTP: no se toca `apps/api/rest`. Lo que se publica es **esquema**:

- **US-21**: el `prisma db pull` descubrirá las 6 tablas y añadirá al modelo `Shop` una relación
  que hoy no existe (`packages/db/prisma/schema.prisma:70` declara `ownerId BigInt @default(1)`
  **sin relación**, porque no había FK). Colateral esperado.
- **Matriz sembrada** (6 filas): `admin@demo.com` (3) → `super_admin` + `customer` +
  `store_owner`; `store_owner@demo.com` (1) → `customer` + `store_owner`; `customer@demo.com`
  (2) → `customer`. `staff` (4) existe sin asignar.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Generador | seed inaplicable · determinismo | Las 5 validaciones de F (`exit(1)` antes de escribir); dos corridas seguidas → `seed.sql` byte a byte idéntico |
| DDL | estructura y restricciones | `\d` de las 6 tablas + `pg_constraint`; un `INSERT` con `ADMIN@demo.com` en `BEGIN … ROLLBACK` debe fallar por unicidad |
| Integración | **no regresión del catálogo** | `just db-check` sin tocar ni un test: `shops.integration.test.ts:19-20,93-94` (`total = 12`, `items[0].id = 15`) es el gate. **Ningún** test lee `owner_id`. Los literales 1200 y 12 no los asserta nadie: van a mano |

Sin tests nuevos: `packages/db` no conoce identidad hasta US-21.

## Verification Plan

Orden obligatorio. `jq` no está instalado; PG en **5433**.

```bash
export SCRATCH=".../scratchpad"; PSQL="docker exec safari-postgres psql -U safari -d safari_scraper"

# 1. Generar y comprobar DETERMINISMO (Decision E) — antes de tocar la base
node db/generate-seed.mjs && cp db/seed.sql $SCRATCH/seed.run1.sql
node db/generate-seed.mjs && cmp db/seed.sql $SCRATCH/seed.run1.sql && echo "determinista"
git diff --stat db/seed.sql            # aditivo: solo bloques nuevos antes de shops

# 2. ⚠ CONFIRMAR CON EL DUEÑO INMEDIATAMENTE ANTES (D-10: borra el volumen).
#    El orquestador pide la confirmación; el ejecutor no la asume.
just db-reset 2>&1 | tee $SCRATCH/db-reset.log
grep -iE "error|violat" $SCRATCH/db-reset.log        # vacío  -> CA-5 (ON_ERROR_STOP=1)

# 3. CA-1 / CA-2 — estructura
$PSQL -c '\d users' -c '\d profiles' -c '\d permissions' -c '\d permission_user' \
      -c '\d password_reset_tokens' -c '\d otp_codes'
$PSQL -c "SELECT conname, conrelid::regclass tbl, confdeltype FROM pg_constraint
          WHERE contype='f' AND confrelid='users'::regclass;"     # 4 filas: c,c,c y shops=r
$PSQL -c "BEGIN; INSERT INTO users (name,email,password_hash) VALUES ('d','ADMIN@demo.com','x'); ROLLBACK;"
#   debe fallar: duplicate key ... "users_email_lower_idx"   -> D-1 verificado

# 4. CA-3 / CA-4 — datos
$PSQL -c "SELECT id, name, email, is_active, email_verified_at, left(password_hash,4) FROM users ORDER BY id;"
$PSQL -c "SELECT (SELECT count(*) FROM profiles) perf, (SELECT count(*) FROM permissions) perm,
                 (SELECT count(*) FROM permission_user) pivote,
                 (SELECT count(*) FROM shops s LEFT JOIN users u ON u.id=s.owner_id
                  WHERE u.id IS NULL) huerfanas;"                 # 3 | 4 | 6 | 0
$PSQL -c "SELECT u.id, u.email, p.name FROM permission_user pu
            JOIN users u ON u.id=pu.user_id JOIN permissions p ON p.id=pu.permission_id
          ORDER BY u.id, p.id;"                                   # la matriz de arriba

# 5. CA-4 — el hash verifica de verdad
$PSQL -tAc "SELECT id||' '||password_hash FROM users ORDER BY id;" > $SCRATCH/hashes.txt
cd "$(mktemp -d)" && npm install --no-save bcryptjs && node -e "
const b=require('bcryptjs'), fs=require('fs');
for (const l of fs.readFileSync(process.env.SCRATCH+'/hashes.txt','utf8').trim().split(/\r?\n/)) {
  const [id,h]=l.split(' '); console.log(id, h.slice(0,4), b.compareSync('demodemo', h)); }"
#   los 3: prefijo $2… y true

# 6. CA-6 — no regresión
just db-build          # solo si packages/db/dist/ no existe
just db-check          # verde
$PSQL -c "SELECT (SELECT count(*) FROM products), (SELECT count(*) FROM shops),
                 (SELECT max(id) FROM shops), (SELECT count(*) FROM categories);"  # 1200|12|15|198
```

Cierre documental: `db/README.md`, **Status** de US-20 y su fila en el README del épico.

## Migration / Rollout

Esquema y datos, sin fases ni feature flag. Nada consume las tablas nuevas hasta US-21.

**Rollback**: `git checkout db/schema.sql db/generate-seed.mjs db/seed.sql db/README.md` **+ otro
`just db-reset`**. El segundo reset no es opcional: el DDL es idempotente pero no borra lo ya
creado, así que sin él `users`, la FK y los triggers sobreviven al revert y la base queda
divergida del archivo.

## Risks

| Riesgo | Prob. | Mitigación |
|---|---|---|
| **R-1** `pivot.model_id = 6` → FK violada al sembrar | Media | D-5 + validación F: `exit(1)` antes de escribir |
| **R-2** `profile.id` colisiona (2 = 2) | Media | D-4: la PK es `user_id` |
| **R-3** `db-reset` borra el volumen | Media | D-10: confirmación **inmediatamente antes** del paso 2. Verificado `count(*) FROM products WHERE source_store IS NOT NULL` = **0** |
| **R-4** el seed regenerado mueve conteos que assertan los tests | Baja | Diff aditivo antes de `shops`; gate `just db-check` + paso 6 |
| **R-5** alguien "arregla" `pipelines.py` creyendo que esta US rompió `just db-test` | Media | Seguirá roto **igual**, y por `test_pipeline.py`: sus asserts consultan la tabla legada `productos` mientras `pipelines.py:188-247` ya escribe en `products`/`shops`/`manufacturers`. `CLAUDE.md` culpa al archivo equivocado. Es **US-6**: el reporte final debe decirlo así o alguien toca un pipeline que no necesita nada |
| **R-6** lookups `email = $1` sin `lower()` no usan el índice | Baja | Hand-off a US-21 (D-1) y nota en `db/README.md` |
| **R-7** quitar `DEFAULT 1` rompería el get-or-create de shops del scraper | Baja | C: el default se queda y el comentario nuevo dice por qué, citando `pipelines.py` |
| **R-8** `CASCADE` en `shops.owner_id` borraría 12 tiendas y 1200 productos en cadena | Baja | B: `RESTRICT`. `products.shop_id` ya es `CASCADE`: la cadena existe |
| **R-9** `HASH_DEMO` mal pegado (60 chars a mano) | Baja | Validación de prefijo `$2` (F) + `compareSync` en el paso 5 |

## Hand-off (no accionar aquí)

1. **US-21**: lookups por email como `WHERE lower(email) = lower($1)` (D-1, R-6).
2. **US-22**: documentar `demodemo` en `apps/README.md` (decisión 7 del épico, aplazada por D-2).
   Y `22-login-jwt-postgres.md:122,153` cita `.env.template`: el real es `.env.example`
   (`justfile:59`).
3. **US-25**: `staff` ya tiene fila (id 4) — asignarlo no necesita otro `db-reset`.

## Open Questions

Ninguna. Las dos que el proposal dejó abiertas quedan cerradas con evidencia del archivo y de la
base viva: **A** (trigger sí en `users`/`profiles`, no en `permissions`) y **B** (`CASCADE` en
las hijas, `RESTRICT` en `shops.owner_id`; 11 de 11 FK declaran acción explícita).
