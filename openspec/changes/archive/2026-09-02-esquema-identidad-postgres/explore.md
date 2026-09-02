# Exploration: US-20 — Esquema de identidad en Postgres

## Current State

### `db/schema.sql` — estilo y estructura a replicar

375 líneas, envuelto en `BEGIN; ... COMMIT;` (líneas 23 y 374). Orden de
secciones: funciones de slug (24-60) → `settings` (72-79) → `types` (89-100)
→ **`shops` (114-127)** → `categories` (144-158) → `manufacturers` (164-175)
→ `tags` (178-189) → `products` (207-296) → `category_product`/`product_tag`
(308-318) → índices (322-352) → trigger `updated_at` (358-371).

Estilo de comentario por tabla: un bloque `-- ----...` de 71 guiones, título
y 2-6 líneas de prosa explicando la decisión de modelado (no solo qué es la
tabla, sino *por qué* se modeló así) — ver `shops` líneas 103-113 como
ejemplo corto y `products` líneas 192-206 como ejemplo largo. El bloque
`category_product` (299-307) usa `====` en vez de `----` porque es una
sección "central" del diseño, igual que `products` (192) — el criterio no
está escrito en ningún sitio, es visual: tablas "normales" con `----`,
tablas que son la pieza central de una decisión de diseño con `====`.

PKs: siempre `bigserial PRIMARY KEY`. Timestamps: siempre
`created_at timestamptz NOT NULL DEFAULT now()` y `updated_at` igual, con
trigger `tocar_updated_at()` (358-364) enganchado solo a `products`,
`categories`, `shops` (366-371) — las tablas que el scraper/admin
actualizarían de verdad. Todo `CREATE TABLE` usa `IF NOT EXISTS`; todo índice
`CREATE INDEX IF NOT EXISTS`. CHECK constraints van al final del `CREATE
TABLE`, con nombre explícito en español (`products_rebaja_valida`,
`products_simple_con_precio`, `categories_no_autoreferencia`,
`products_procedencia_completa`). jsonb con default `'{}'::jsonb` o
`'[]'::jsonb` según semántica, nunca `NULL` salvo que el campo sea
opcional de verdad (`logo`, `cover_image`, `image`).

**`shops.owner_id` — línea exacta 119**: `owner_id bigint NOT NULL DEFAULT
1,` (sin `REFERENCES`). El comentario que lo explica está en las líneas
111-112: *"owner_id se queda sin clave foránea: el mock usaba 1 para todos y
la tabla `users` está fuera de alcance."* Ese comentario queda obsoleto en
cuanto exista `users` y debe reescribirse, no solo añadirse una FK al lado.

**`BEGIN/COMMIT` y la FK.** Todo el archivo es una sola transacción. Eso
significa que la nueva FK puede ir de dos formas sin romper el patrón
transaccional: (a) inline en el propio `CREATE TABLE shops` **si** `shops`
se reordena para ir después del bloque de identidad, o (b) como `ALTER TABLE
shops ADD CONSTRAINT ... FOREIGN KEY` al final del archivo, después de que
`users` ya exista — Postgres no exige que la tabla referenciada exista antes
del `CREATE TABLE` del referenciador dentro de la misma transacción, pero si
la FK se declara inline en `CREATE TABLE shops (...)`, `users` debe estar
creada ya en ese punto del script (mismo bloque `BEGIN`, basta con que el
`CREATE TABLE users` aparezca antes en el archivo). No hay riesgo de
"tabla no existe todavía" distinto entre las dos opciones mientras el orden
textual sea correcto — la única diferencia real es de legibilidad/estilo, no
de mecánica transaccional.

No existe ningún precedente de `ALTER TABLE ... ADD CONSTRAINT IF NOT
EXISTS` en el archivo (Postgres no soporta esa sintaxis para constraints).
El patrón idempotente que el archivo sí usa en otro lado para "no fallar en
la segunda corrida" es `IF NOT EXISTS` en `CREATE TABLE`/`CREATE INDEX`, y
`CREATE OR REPLACE` en funciones/triggers — ninguno de los dos aplica
directo a un `ADD CONSTRAINT`. Si el diseño opta por `ALTER TABLE`, la
idempotencia tendría que resolverse con un `DO $$ ... IF NOT EXISTS (SELECT
1 FROM pg_constraint ...) THEN ALTER TABLE ... END IF; $$` — más verboso que
el resto del archivo — o aceptar que, como el propio encabezado del archivo
ya declara (línea 18: *"OJO: por eso mismo NO aplica cambios a tablas que ya
existan"*), esta migración concreta exige `db-reset` de todos modos y no
necesita protegerse a sí misma con guardas adicionales.

**Extensiones.** `schema.sql` NO tiene ningún `CREATE EXTENSION`. La única
extensión que el proyecto usa (`pg_trgm`, para el índice trigram de
`products.name`, línea 344-345) se crea fuera del archivo, en
`justfile:278` (`just db-migrate`): `CREATE EXTENSION IF NOT EXISTS
pg_trgm;` antes de aplicar `schema.sql`. `unaccent` NO se usa como extensión
— el archivo define su propia función `unaccent_simple()` (38-45)
precisamente para no depender de ella. Confirmado contra el contenedor vivo
(`safari-postgres`, `postgres:16-alpine`, up 43h):

```
   name    | default_version | installed_version |            comment
-----------+-----------------+--------------------+---------------------------------------------
 unaccent  | 1.1             |                    | text search dictionary...
 citext    | 1.6             |                    | data type for case-insensitive strings
 pg_trgm   | 1.6             | 1.6                | text similarity...
```

**`citext` SÍ está disponible** en `postgres:16-alpine` (`default_version
1.6`, es un contrib module estándar que la imagen alpine incluye) — **no
instalada**, pero instalable con `CREATE EXTENSION citext;` exactamente
igual que `pg_trgm`. La afirmación de la US ("`citext` no está disponible")
es fácticamente incorrecta para esta imagen concreta; lo que sí es cierto es
que **hoy no se usa**, y adoptarla sería la primera extensión que el
proyecto activa dentro de `schema.sql` mismo (las demás activaciones viven
en `justfile`, fuera del DDL versionado). Ver Approaches/Open questions.

### `db/generate-seed.mjs` — orden de emisión y mecánica

Orden real de bloques emitidos (línea → bloque): 114 `settings` → 124
`types` → **140 `shops`** → 161 `categories` → 190 `manufacturers` → 206
`tags` → 239 `products` → 278 `category_product` (vacía a propósito) → 290
`setval` de secuencias. **`shops` se emite en la posición 3, antes que
`categories`/`products`.** R-3 exige que `users` (y sus tablas dependientes)
se inserten *antes* que `shops` — hoy no existe ningún bloque de usuarios,
así que la inserción no es "mover algo existente" sino "insertar un bloque
nuevo antes de la línea 140", lo cual es trivial: no hay reordenamiento de
bloques ya escritos, solo una inserción.

Helpers reutilizables ya existentes (35-46): `txt()` (escapa comillas
simples doblándolas), `num()`, `bool()` (`v ? 'true' : 'false'`, exactamente
el patrón que la US pide para convertir `is_active: 1` → `boolean`), `json()`
(serializa a `'...'::jsonb`), `arr()` (arrays Postgres `ARRAY[...]::text[]`),
`ts()` (`now()` si no hay valor). Todos son reutilizables tal cual para
`users`/`profiles`/`permissions`/`permission_user` sin escribir helpers
nuevos.

Recuperación de shops "huérfanos" (48-63): construye `idsDeShops` desde
`shops.json`, recorre los 1200 productos buscando `p.shop` con un `id` que
no esté en ese set, y los junta en `shopsTodos` (shops.json + recuperados)
con la bandera `_recuperado`. Es el único lugar del generador con lógica de
"reconstruir entidades desde otro JSON" — el análogo para identidad sería
mucho más simple: `users.json` ya trae los 3 usuarios completos, no hay
nada que reconstruir desde otra fuente.

**Ids y secuencias**: el generador SIEMPRE inserta ids explícitos (columna
`id` en cada `INSERT`, ver `types`/`shops`/`categories`/`products` líneas
128, 146, 168, 254) con `ON CONFLICT (id) DO NOTHING` (o `DO UPDATE` solo
para `settings`, fila única). Al final (290-299) adelanta las 6 secuencias
existentes con `SELECT setval(...)`. **Preservar los ids 1, 2, 3 de
`users.json` es el patrón por defecto del archivo, no una excepción**:
basta con incluir `users`/`profiles`/`permissions` en el mismo patrón
`INSERT ... (id, ...) VALUES ... ON CONFLICT (id) DO NOTHING` y añadir esas
tablas a la lista de `setval` (línea 297: hoy
`['types','shops','categories','manufacturers','tags','products']`,
`permission_user` no necesita `setval` por ser tabla puente sin PK propia,
`permissions` sí la necesita si se le da `id serial`).

**Validación previa (65-88).** El generador aborta con `process.exit(1)` si
detecta violaciones de CHECK/FK antes de escribir `seed.sql` — un patrón que
conviene replicar para identidad (p.ej. validar que ningún `permission.name`
del pivote referencie un id de `permissions` inexistente), aunque con solo 3
usuarios y ~3-4 permisos el riesgo de inconsistencia es bajo.

### `users.json` — forma real, verificada campo por campo

3 usuarios, **en este orden en el array**: `id 3` (admin@demo.com) primero,
`id 2` (customer@demo.com) segundo, `id 1` (store_owner@demo.com) tercero —
**no vienen en orden de id**. Esto es irrelevante para el DDL/seed en sí
(los ids se preservan explícitos, no por orden de inserción), pero es
relevante para cualquier futuro `.map()`/`[0]` ingenuo (nota: el propio
mock `auth.service.ts:154-156` hace `me() { return this.users[0]; }`, que
hoy siempre devuelve **admin**, no el usuario del token — bug ya conocido
del épico, fuera de esta US).

Campos por usuario, mapeo columna/jsonb/descartado:

| Campo JSON | Tipo real | Destino |
|---|---|---|
| `id` | number | `users.id` (preservado) |
| `name` | string | `users.name` |
| `email` | string | `users.email` (único, case-insensitive) |
| `email_verified_at` | string ISO o `null` | `users.email_verified_at timestamptz` |
| `email_verified` | boolean | **redundante con `email_verified_at`** (siempre `true` cuando `email_verified_at` no es null, `false`/`null` cuando sí lo es en los 3 casos) — no necesita columna propia, la US ya pide `email_verified_at` como la columna |
| `created_at`/`updated_at` | string ISO | `users.created_at`/`updated_at` |
| `is_active` | **number** (`1` en los 3) | `users.is_active boolean` — requiere `bool()` |
| `shop_id` | `null` en los 3 | descartado (no hay columna; el vínculo real es `shops.owner_id`, no al revés) |
| `profile` | objeto | tabla `profiles` |
| `permissions[]` | array de objetos Laravel | `permissions` + `permission_user` |
| `wallet` | objeto o `null` | **descartado** (decisión 13) |
| `shops[]` | array de shops completos, embebido SOLO en admin (id 3) y store_owner (id 1), **no** en customer | **descartado**: ya vive en `shops.json`/`shops` table; es dato redundante en el mock |
| `last_order` | objeto grande, solo en admin (id 3) | **descartado** (decisión 13, dominio transaccional) |
| `address[]` | array, presente en los 3 (vacío en store_owner) | **descartado** (decisión 13) |

**`profile` — colisión de id detectada.** `profile.id` en el JSON: usuario 3
(admin) trae `profile.id: 2`; usuario 2 (customer) trae `profile.id: 2`
**el mismo valor**; usuario 1 (store_owner) trae `profile.id: 1`. Es decir,
**dos usuarios distintos (2 y 3) reclaman el mismo `profile.id` en el mock**
— el dato de origen ya está corrupto en ese campo. Preservar `profile.id`
tal cual del JSON como PK de `profiles` colisionaría (violación de
`PRIMARY KEY` en el segundo INSERT). Ver Approaches — la salida natural es
que `profiles` NO preserve el `id` del JSON: use `user_id` como PK/FK 1:1
(`profiles.user_id bigint PRIMARY KEY REFERENCES users(id)`), ignorando el
campo `profile.id` de origen igual que ya se descarta `profile.customer_id`
(que tampoco coincide de forma consistente con el `id` del usuario dueño).

Campos de `profile` usados: `avatar` (objeto `{id, original, thumbnail}` →
jsonb), `bio` (texto o `null`), `socials` (siempre `null` en los 3 — jsonb
nullable), `contact` (string), `notifications` (siempre `null`),
`created_at`/`updated_at`. `customer_id` se descarta (redundante/inconsistente
con el user id real, ver arriba).

**`permissions[]` — shape Laravel exacto:**
```json
{
  "id": 1, "name": "super_admin", "guard_name": "api",
  "created_at": "...", "updated_at": "...",
  "pivot": { "model_id": 6, "permission_id": 1, "model_type": "Marvel\\Database\\Models\\User" }
}
```
Universo real de permisos que aparecen en los 3 usuarios: **solo 3**
(`super_admin` id 1, `customer` id 2, `store_owner` id 3) — **`staff`
NUNCA aparece en `users.json`**, ni como fila de `permissions` ni asociado a
ningún usuario. `guard_name` es siempre `"api"`.

Asignación real por usuario (no es "un permiso por usuario"):
- `admin@demo.com` (id 3): **3 permisos** — `super_admin`, `customer` Y
  `store_owner` a la vez.
- `customer@demo.com` (id 2): **1 permiso** — `customer`.
- `store_owner@demo.com` (id 1): **2 permisos** — `customer` y
  `store_owner`.

**`pivot.model_id` no siempre coincide con el id real del usuario dueño.**
Para el usuario 2 y el usuario 1, `pivot.model_id` coincide con su propio
`id` (2 y 1 respectivamente, verificado línea por línea). Para el **usuario
3** (admin), los 3 `pivot.model_id` valen **6**, no 3 — un residuo del mock
Laravel original (probablemente un id de usuario de un dataset más grande
del que Pickbazar recortó solo 3 filas). El generador **no puede** copiar
`pivot.model_id` tal cual a `permission_user.user_id`: debe usar el `id`
real del usuario que está iterando (el `id` del objeto raíz, no el del
pivote embebido), o la fila de admin quedaría con una FK a un usuario 6 que
no existe.

`pivot.model_type` es siempre el literal `"Marvel\\Database\\Models\\User"`
(el ORM Laravel de origen, polimórfico) — con una sola tabla de identidad
(`users`) en este esquema, ese campo es constante y no aporta información;
la US no pide una columna para él, y `permission_user` como pivote directo
`(user_id, permission_id)` no lo necesita para nada funcional. Si `/me`
necesita reproducir el shape completo del `pivot` Laravel byte a byte
(decisión 5 del épico), ese literal se puede fijar como constante en el
servicio de Nest (fuera de esta US) sin guardarlo en la base.

### Permisos: divergencia frontend vs `users.json`

`apps/admin/rest/src/utils/constants.ts:4-6` declara
`SUPER_ADMIN='super_admin'`, `STORE_OWNER='store_owner'`,
`STAFF='staff'`. `apps/shop/src/lib/constants/index.ts:10-11` declara
`SUPER_ADMIN='super_admin'`, `CUSTOMER='customer'`. **`users.json` ya trae
los 3 valores usados (`super_admin`, `store_owner`, `customer`) en
snake_case** — no hace falta traducir nada en el generador, la fidelidad ya
es 1:1. La única laguna es `staff`: el frontend lo espera como posible valor
de permiso pero ningún usuario del mock lo tiene asignado — la tabla
`permissions` puede (y probablemente debe) declarar la fila `staff` de
todos modos, sin usuario asociado, para que `permission_user` pueda
poblarse en el futuro (US-25) sin otro `db-reset`.

### `shops.integration.test.ts` — qué no debe romperse

Verificado el archivo completo (97 líneas): **ningún test lee ni asertea
`owner_id`**. Los asserts que sí importan: `total).toBe(12)` (líneas 19 y
93), `items[0].id).toBe(15)` (líneas 20 y 94, orden `id desc`), slugs
recuperados `noaw`/`launchidea`/`tetetetet` (línea 28), `productsCount` por
slug (35-37, 47), filtro por nombre (41), y todo el bloque
`listShopsNear` (61-95, usa las 6 tiendas con coordenadas 1-6, ninguna
relacionada con `owner_id`). **Añadir la FK `owner_id → users.id` no
puede romper ninguno de estos asserts** siempre que los 12 shops sigan
insertándose con éxito (lo cual exige que `users` con id 1 exista antes,
por R-3) — no hay ningún camino en el que la FK cambie el conteo o el id
máximo, salvo que la inserción de `shops` fallara por FK huérfana, y eso
ya está descartado (los 12 `owner_id` valen `1` en el mock, y el usuario 1
existe).

Otros tests de integración (`categories`, `manufacturers`, `products`,
`tags`, `types`) **no referencian identidad en absoluto** —
verificado con grep sobre los 6 archivos `*.integration.test.ts`: los
únicos conteos "mágicos" son `categories` (83 raíces, 198 total — línea
24 y 29), `manufacturers` (14, línea 18), `tags` (10, línea 18),
`products` (`toBeGreaterThan(1000)` línea 41, `toBe(1199)` con default
status/visibility línea 177 — **no 1200**: hay 1 draft que el filtro por
defecto excluye). **No existe ningún test que compare `products.total`
contra 1200 literal** — el número 1200 que cita la US es el total crudo del
JSON (`products.json.length`), no un valor que ningún test de
`packages/db` verifique directamente hoy; sí lo verifica el propio
`generate-seed.mjs` en su log de salida (línea 304-310) y lo puede
confirmar un `SELECT count(*) FROM products` manual. Ninguna de estas
tablas tiene relación con `users`/`profiles`/`permissions`, así que el
DDL de identidad no las toca en absoluto — el único punto de contacto real
con "no regresión" es `shops.owner_id`.

### El hash bcrypt — qué hay disponible hoy

Búsqueda de `bcryptjs`/`bcrypt` en todo el repo (`find -iname bcrypt*` +
`grep` sobre los `package.json` de `apps/api/rest` y `packages/db`):
**cero resultados**. Ninguna dependencia de hashing existe hoy en ningún
`node_modules` ni está declarada en ningún `package.json` del monorepo.
Esto confirma que, para producir el hash bcrypt de `demodemo` **una sola
vez** (decisión 8 del épico), el agente de apply necesitará una vía
puntual que no dependa de instalar nada permanente — el candidato natural
que la propia US sugiere (`npx bcryptjs demodemo 10`) es exactamente eso:
`npx` descarga el paquete a un caché temporal, lo ejecuta una vez y no dejar
rastro en ningún `package.json`. Alternativas equivalentes: un script
`node -e` con `require('bcryptjs')` tras un `npm install --no-save
bcryptjs` temporal, o cualquier generador bcrypt de confianza fuera del
repo. Ninguna de estas acciones se ejecuta en esta exploración (es trabajo
de apply); aquí solo se confirma que no hay atajo ya vendored.

### `just db-reset` — qué destruye exactamente

`justfile:310-312`:
```
db-reset:
    docker compose down -v
    just db-up
```
`docker compose down -v` **borra el volumen nombrado** `postgres-data`
(`docker-compose.yml:32-33`) — es decir, **toda fila de cualquier tabla,
incluidas las que el scraper haya escrito en `products` con `source_store`
no nulo** desde la última vez que se corrió `db-up`/`db-reset`. `just db-up`
(`justfile:258-274`) levanta el contenedor, espera a que
`pg_isready` responda, corre `just db-migrate` (`CREATE EXTENSION
pg_trgm` → aplica `schema.sql` → aplica `seed.sql`), y crea
`services/scraper-worker/.env` si no existe. El contenedor
`safari-postgres` está **up 43h, healthy** en este momento (confirmado con
`docker ps`) — el reset es autorizado por el dueño del repo (decisión 1 del
épico, 2026-08-31), pero cualquier producto que el scraper haya insertado
en esas 43h y no esté en `db/seed.sql` se pierde con el reset, sin manera
de recuperarlo (no hay backup automático).

### Breakage ya conocido, confirmado en vivo

Ejecuté `just db-test` (no destructivo: falla antes de escribir nada) y
reproduje el error exacto:
```
psycopg.errors.UndefinedTable: relation "productos" does not exist
LINE 1: DELETE FROM productos WHERE tienda IN ('Alkosto','Exito')
```
**Precisión sobre la causa real** (matiza lo que dice `CLAUDE.md`/US-6):
`services/scraper-worker/pipelines.py` (líneas 188-247) **ya escribe en
`products`/`shops`/`manufacturers`/`category_product`** — el pipeline de
producción está migrado. El archivo que sigue roto es
**`test_pipeline.py`** (no `pipelines.py`): sus asserts (líneas 83-163)
consultan la tabla legada `productos` con columnas legadas (`tienda`,
`categoria`, `nombre`, `precio`, `promocion`) que nunca existieron en
`db/schema.sql`. Es decir: el pipeline real probablemente funciona, pero su
único test automatizado (`just db-test`) quedó desactualizado — trabajo de
US-6, no de esta US. Confirmado que seguirá roto exactamente igual después
de aplicar el DDL de identidad (esta US no toca `services/scraper-worker`
en absoluto).

### Documentación desactualizada, fuera de esta US

`docs/product/19-autenticacion-autorizacion/22-login-jwt-postgres.md:122`
y `:153` referencian `apps/api/rest/.env.template`. El archivo real
(confirmado con `ls -a apps/api/rest/`) es **`.env.example`**
(`justfile:59`: `crear apps/api/rest/.env.example apps/api/rest/.env`). No
se toca aquí (US-20 no modifica US-22), se deja registrado para que el
agente de US-22 no pierda el hallazgo.

## Affected Areas

- `db/schema.sql` — 6 tablas nuevas (`users`, `profiles`, `permissions`,
  `permission_user`, `password_reset_tokens`, `otp_codes`) + FK en
  `shops.owner_id`; reescribir el comentario obsoleto de las líneas 111-112.
- `db/generate-seed.mjs` — nuevo bloque de emisión antes de la línea 140
  (`shops`), leyendo `users.json`; nuevas entradas en el `setval` final
  (línea 297).
- `db/seed.sql` — regenerado, artefacto.
- `db/README.md` — documentar el modelo de identidad y la credencial demo
  (hoy el archivo no menciona usuarios en absoluto).
- `apps/README.md` — la credencial demo `demodemo` debe documentarse ahí
  también según decisión 7 del épico (la US-20 no lo lista en "Archivos a
  crear/modificar" pero la decisión del épico sí lo exige; señalar la
  discrepancia al orquestador antes de proceder).
- `packages/db/src/repositories/shops.integration.test.ts` — no requiere
  cambios, pero es el gate que confirma que la FK no rompe nada; correr
  `just db-check` después del `db-reset` es obligatorio.
- **NO afectados por esta US** (confirmado, no solo asumido):
  `services/scraper-worker/*` (pipeline ya en `products`, su test roto es
  ajeno), `apps/api/rest/src/auth/*` (US-22), `packages/db/prisma/*`
  (US-21).

## Approaches

### A. Dónde vive el bloque de identidad y cómo se cierra la FK de `shops`

1. **Bloque de identidad completo ANTES de `shops`, con la FK inline en el
   propio `CREATE TABLE shops`.**
   - Pros: un solo `CREATE TABLE shops` (no dos sentencias separadas para
     la misma tabla); el lector ve la FK en el sitio natural, junto a la
     columna; coherente con cómo el archivo ya declara FKs normales
     (`categories.type_id`, `products.shop_id`, etc. — todas inline).
   - Cons: mueve el bloque `shops` de la posición 3 a la posición 4+ en el
     archivo, lo que también obliga a reordenar el comentario de cabecera
     y probablemente el bloque de `generate-seed.mjs` en paralelo (aunque
     el generador no depende del orden textual de `schema.sql`, solo del
     de sus propios INSERTs).
   - Effort: Bajo.

2. **Bloque de identidad DESPUÉS de `shops` (al final, junto a
   `category_product`/`product_tag`, o en su propia sección nueva), con la
   FK añadida vía `ALTER TABLE shops ADD CONSTRAINT ... FOREIGN KEY
   (owner_id) REFERENCES users(id)` al final del archivo.**
   - Pros: no reordena nada del catálogo existente; el diff contra
     `schema.sql` actual es puramente aditivo (todas las líneas 1-374 se
     conservan intactas, solo se insertan bloques nuevos); más fácil de
     revisar en un PR.
   - Cons: la columna `owner_id` queda declarada sin su FK visible en el
     mismo bloque — alguien que lea solo el `CREATE TABLE shops` no ve la
     restricción hasta que llega al `ALTER TABLE`, kilómetros más abajo;
     rompe la convención "toda FK va inline" que el archivo sostiene sin
     excepciones hoy.
   - Effort: Bajo (la mecánica es igual de simple, es una cuestión de
     legibilidad, no de dificultad).

3. **Bloque de identidad en su propia sección nueva justo después de
   `shops`, sin mover `shops` de sitio, con la FK vía `ALTER TABLE` justo
   después de crear `users` (no al final del archivo).**
   - Pros: intermedio entre 1 y 2 — la FK aparece cerca de donde se declara
     `users`, sin reordenar `shops`; el diff sigue siendo mayormente
     aditivo.
   - Cons: sigue partiendo la definición de `shops` en dos sitios del
     archivo (la tabla en su bloque original, la FK en el bloque de
     identidad) — cualquiera de las variantes con `ALTER TABLE` tiene este
     costo de legibilidad en algún grado.
   - Effort: Bajo.

Ninguna opción tiene riesgo técnico distinto (las tres pasan `db-reset`
igual de limpio); la diferencia es estilística/legibilidad, que es
precisamente lo que el diseño debe decidir mirando el criterio ya usado en
el archivo (FKs siempre inline, nunca `ALTER TABLE` — ningún precedente de
`ALTER TABLE ADD CONSTRAINT` existe hoy en `schema.sql`).

### B. Ids estables 1, 2, 3 para `users` + secuencia consistente

1. **Mismo patrón que el resto del archivo**: `INSERT INTO users (id, ...)
   VALUES (3, ...), (2, ...), (1, ...) ON CONFLICT (id) DO NOTHING;` +
   `SELECT setval('users_id_seq', GREATEST((SELECT COALESCE(max(id),1) FROM
   users), 1));` al final, junto a las demás secuencias.
   - Pros: cero código nuevo, es exactamente lo que ya hace el generador
     para `types`/`shops`/`categories`/`manufacturers`/`tags`/`products`;
     el orden de las filas en el `VALUES` (3, 2, 1 — el orden real de
     `users.json`) es irrelevante porque los ids van explícitos.
   - Cons: ninguno.
   - Effort: Bajo. **Es la única opción razonable dado el precedente.**

### C. Email case-insensitive: `citext` vs índice sobre `lower(email)` vs normalizar en escritura

1. **Índice único sobre `lower(email)`** (`CREATE UNIQUE INDEX ... ON users
   (lower(email))`), columna `email` sigue siendo `text` plano.
   - Pros: cero extensiones nuevas; el patrón de índice funcional ya existe
     en el archivo para búsqueda (`products_nombre_trgm_idx` usa
     `lower(name)`, línea 344-345) — hay precedente directo de
     `lower(columna)` en un índice; no cambia el tipo de la columna, así
     que cualquier `ORM`/librería que lea `email` como string plano
     funciona sin fricción.
   - Cons: el `UNIQUE` no está en la definición de la columna sino en un
     índice aparte — hay que acordarse de usar `WHERE lower(email) = ...`
     en cualquier lookup de login para que el índice se use (o Postgres
     puede no elegirlo si la query compara `email = ...` sin `lower()`);
     no impide insertar dos filas con distinto casing si alguien hace un
     `INSERT` directo sin pasar por el índice funcional primero — sí lo
     impide, en realidad (el índice único rechaza el segundo INSERT), pero
     el error que Postgres devuelve es menos obvio que un `UNIQUE`
     declarativo en la columna.
   - Effort: Bajo.

2. **Tipo `citext` para la columna `email`** (`email citext UNIQUE NOT
   NULL`), con `CREATE EXTENSION IF NOT EXISTS citext;` añadido al `just
   db-migrate` (mismo lugar donde ya se activa `pg_trgm`,
   `justfile:278`) o dentro del propio `schema.sql`.
   - Pros: semánticamente el más correcto — `email = 'Admin@demo.com'`
     compara case-insensitive de forma nativa en cualquier query, sin
     acordarse de envolver en `lower()`; el `UNIQUE` es declarativo en la
     columna, igual que el resto del archivo declara sus unicidades
     (`slug text NOT NULL UNIQUE`); **confirmado disponible** en
     `postgres:16-alpine` (ver Current State).
   - Cons: primera vez que el proyecto activa una extensión adicional
     (hasta ahora solo `pg_trgm`, y fuera del DDL versionado, en
     `justfile`); cualquier futura migración a un Postgres gestionado
     (RDS, Cloud SQL, etc.) necesita confirmar que `citext` esté en la
     lista de extensiones permitidas del proveedor (`pg_trgm` casi siempre
     lo está; `citext` también es muy común pero es una verificación
     adicional que antes no hacía falta); Prisma 7 (`packages/db`, fuera
     de esta US pero corriente abajo) no tiene un tipo nativo `Citext` en
     su schema — lo modelaría como `String` y perdería la garantía a nivel
     de tipo, aunque el `UNIQUE` de Postgres se sigue respetando igual.
   - Effort: Bajo-Medio (una línea de DDL más una activación de extensión).

3. **Normalizar a minúsculas en escritura** (`email text UNIQUE NOT NULL`
   + `CHECK (email = lower(email))`, o simplemente insertar siempre en
   minúsculas y dejar que el código de aplicación lo garantice).
   - Pros: cero extensiones, cero índices funcionales; el `UNIQUE` plano
     funciona tal cual.
   - Cons: es la opción menos robusta — depende de que **todo** código que
     inserte/actualice `email` (seed, futuro endpoint de registro en
     US-22, cualquier script de admin) recuerde normalizar; un
     `INSERT` directo con mayúsculas rompería la promesa sin que la base
     lo impida salvo por el CHECK explícito (que si se añade, resuelve el
     problema pero es funcionalmente equivalente a re-derivar la opción 1
     con más fricción en el código de aplicación en vez de en la base).
   - Effort: Bajo, pero desplaza el riesgo fuera de esta US (a US-22 y
     cualquier escritura futura).

La US ya inclina la decisión hacia una unión de 1 y 3 (dice: *"el unique de
`users.email` debe ser insensible a mayúsculas... un índice único sobre
`lower(email)` sí [está disponible]"*), pero **su premisa de que `citext` no
está disponible es incorrecta** para esta imagen concreta — el diseño debe
decidir con ese dato corregido, no con la premisa original de la US.

### D. Fidelidad del modelo de permisos

La decisión 5 del épico ya fija `permissions` + `permission_user`
reproduciendo `{name, guard_name, pivot}`. Lo que el explore añade,
verificado contra el dato real:

- `permission_user` necesita como mínimo `(user_id, permission_id)` como
  pivote — ambos como FK reales, a diferencia del mock donde
  `pivot.model_id` puede estar corrupto (caso admin/6, ver Current State).
  El generador debe usar el `id` real del usuario iterado, nunca
  `pivot.model_id` tal cual.
- `pivot.model_type` (constante `"Marvel\\Database\\Models\\User"`) no
  necesita persistirse: es un artefacto polimórfico de Laravel sin
  contraparte en este esquema (una sola tabla de identidad). Si `/me`
  necesita reproducirlo byte a byte (fuera de esta US), se puede
  hardcodear en el servicio de traducción de Nest.
- La tabla `permissions` debe incluir la fila `staff` aunque **ningún**
  usuario del mock la tenga asignada — es el 4° valor que ambos frontends
  esperan (`STAFF` en `apps/admin/rest/src/utils/constants.ts:6`) y sin la
  fila, un futuro `INSERT INTO permission_user` para un staff (US-25)
  necesitaría otro `db-reset` para poder referenciarla.

### E. Fuente del generador: leer `users.json` directo vs tabla de transformación

1. **Leer `users.json` directo**, igual que el resto del generador lee
   `shops.json`/`categories.json`/etc. sin capa intermedia.
   - Pros: consistente con el resto del archivo (cero tablas de mapeo para
     ninguna otra entidad); solo 3 usuarios, el volumen no justifica
     indirección.
   - Cons: ninguno relevante — el único campo que exige lógica no trivial
     (`pivot.model_id` corrupto para admin) se resuelve con una línea
     (`usar u.id`, no `permiso.pivot.model_id`), no con una tabla de
     transformación completa.
   - Effort: Bajo. **Único approach razonable** dado que ninguna otra
     entidad del generador usa una capa de transformación y el volumen de
     datos (3 usuarios) no la justifica.

## Recommendation

No corresponde fijar un ganador en esta fase (es trabajo de
`sdd-design`), pero el explore deja evidencia suficiente para que el
diseño resuelva rápido: (A) cualquiera de las 3 variantes es
mecánicamente segura, la diferencia es de legibilidad — dado que el
archivo no tiene NINGÚN precedente de `ALTER TABLE ADD CONSTRAINT`, la
opción 1 (bloque de identidad antes de `shops`, FK inline) es la que menos
se aparta del estilo ya establecido; (B) no tiene alternativa razonable,
es el patrón ya usado 6 veces en el mismo archivo; (C) la premisa de la US
sobre `citext` debe corregirse ante el usuario/diseño antes de decidir —
con el dato correcto, ambas opciones (índice sobre `lower(email)` o
`citext`) son viables y la elección es de gusto/consistencia con el resto
del stack, no de disponibilidad; (D) ya está fijada por el épico, el
explore solo añade el detalle de implementación (`user_id` real, no
`pivot.model_id`, y sembrar `staff` sin asignación); (E) sin alternativa
razonable.

## Risks

- **Premisa incorrecta de la US sobre `citext`.** Si el diseño avanza sin
  corregir esto ante el usuario, se descarta una opción válida basándose
  en un hecho falso. Bajo impacto técnico (la alternativa `lower(email)`
  funciona igual de bien), pero alto valor de señalarlo porque es
  precisamente el tipo de cosa que "el código gana sobre la memoria"
  existe para atrapar.
- **`profile.id` corrupto en el mock** (colisión 2=2 entre admin y
  customer). Si el diseño decide preservar `profile.id` del JSON en vez de
  usar `user_id` como PK/FK 1:1, el `INSERT` de la segunda fila de
  `profiles` fallaría por violación de `PRIMARY KEY` — debe decidirse
  explícitamente en diseño, no descubrirse en apply.
- **`pivot.model_id` corrupto para admin** (vale 6, no 3). Si el generador
  copia ese campo tal cual en vez de usar el id real del usuario iterado,
  `permission_user` para admin tendría `user_id = 6`, que no existe →
  violación de FK inmediata al aplicar el seed. Señalado explícitamente
  arriba para que apply no lo repita.
- **`apps/README.md` no está en la lista de "Archivos a crear/modificar"
  de la US-20**, pero la decisión 7 del épico exige documentar la
  credencial demo ahí. Vale la pena que el orquestador confirme con el
  usuario si `apps/README.md` entra en el scope de esta US o si el
  DoD de "credencial demo documentada" se satisface solo con
  `db/README.md` (que sí está listado) — no es una decisión que el
  explore deba tomar en silencio.
- **`db-reset` destruye cualquier fila que el scraper haya escrito** en
  las últimas 43h de uptime del contenedor. Ya autorizado por el dueño del
  repo (decisión 1), pero el agente de apply debe confirmar que no hay
  datos de scraping recientes que alguien quisiera conservar antes de
  correrlo (fuera del alcance de este explore verificarlo: no se hizo
  `SELECT` sobre `source_store IS NOT NULL` porque esta fase es de solo
  lectura de código, no de la base — el propio contrato de esta
  exploración permite consultas de solo lectura contra Postgres, así que
  esto SÍ podría verificarse en el proposal/design si se considera
  necesario).
- **`just db-test` seguirá roto después de esta US**, por una causa más
  precisa de lo que dice `CLAUDE.md` (el test, no el pipeline). Si el
  reporte final de esta US no aclara que la causa es `test_pipeline.py` y
  no `pipelines.py`, alguien podría intentar "arreglarlo" tocando el
  pipeline en producción, que no lo necesita.

## Ready for Proposal

Sí. Todos los puntos que la US y el épico dejaban abiertos tienen evidencia
concreta: la premisa de `citext` está corregida con datos verificados
contra el contenedor real; la corrupción de `profile.id` y de
`pivot.model_id` en `users.json` están documentadas con los valores
exactos; el orden de emisión del generador y el patrón de ids/secuencias
están mapeados línea por línea; no hay tests que dependan de `owner_id` ni
de un literal `1200`; y el breakage de `just db-test` está confirmado en
vivo con su causa raíz exacta. Las únicas piezas que quedan para
`sdd-design` (no bloquean, ya están enmarcadas como decisión explícita)
son: dónde exactamente vive el bloque de identidad en `schema.sql` (opción
A.1 recomendada por estilo), y `citext` vs `lower(email)` (ambas viables,
elección de consistencia).

## Open questions / decisions needed

1. **`citext` vs índice sobre `lower(email)`.** La US afirma que `citext`
   no está disponible; verificado que **sí lo está** en
   `postgres:16-alpine` (contrib module estándar, `default_version 1.6`).
   Recomendación: usar `lower(email)` como índice único de todos modos,
   por consistencia con el precedente ya existente en el archivo
   (`products_nombre_trgm_idx` ya usa `lower(name)`) y para no introducir
   la primera extensión activada dentro de `schema.sql` mismo — pero es
   una preferencia de estilo, no una necesidad técnica; el usuario puede
   preferir `citext` por semántica más limpia.
2. **Columnas del pivote `permission_user`.** El épico no especifica si
   además de `(user_id, permission_id)` hace falta algún timestamp
   (`created_at`) para que `/me` reproduzca el `pivot` de Laravel con
   fechas reales, o si esas fechas pueden derivarse/hardcodearse en el
   servicio de Nest (US-22). Recomendación: añadir `created_at
   timestamptz NOT NULL DEFAULT now()` al pivote — es gratis, sigue el
   patrón del resto del archivo, y deja la puerta abierta sin comprometer
   nada.
3. **`otp_codes` — ¿clave por teléfono sin FK a `users`, o por `user_id`?**
   El épico no lo fija. `users.json` no trae ningún campo de teléfono
   (solo `profile.contact`, un string libre sin validar). Recomendación:
   `user_id bigint NOT NULL REFERENCES users(id)` en vez de un teléfono
   suelto — es más consistente con el resto del esquema (todo lo demás
   referencia por FK real) y evita duplicar el número de teléfono como
   clave de negocio cuando ya existe un id estable.
4. **`password_reset_tokens` — ¿por `email` (estilo Laravel, tabla
   independiente sin FK) o por `user_id`?** Recomendación: `user_id
   bigint NOT NULL REFERENCES users(id)` por la misma razón que (3) — el
   estilo Laravel de indexar por email existe para permitir invalidar
   antes de que el usuario "exista" en algunos flujos, que no es el caso
   aquí (todos los usuarios ya existen en el seed).
5. **`apps/README.md` como archivo a modificar.** La decisión 7 del épico
   pide documentar `demodemo` en `apps/README.md`; la lista de "Archivos a
   crear/modificar" de la US-20 no lo incluye (solo `db/README.md`).
   Recomendación: confirmar con el usuario si se añade al scope de esta US
   o se documenta solo en `db/README.md` y se deja una nota para quien
   toque `apps/README.md` después.
6. **Deriva de documentación ya encontrada, no de esta US:**
   `docs/product/19-autenticacion-autorizacion/22-login-jwt-postgres.md`
   referencia `apps/api/rest/.env.template`; el archivo real es
   `.env.example` (`justfile:59`). No se corrige aquí (US-22 no está en
   ejecución), solo se deja registrado para que no se pierda.
