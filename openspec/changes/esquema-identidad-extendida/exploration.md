# Exploration: US-41 — Esquema y capa de datos de identidad extendida

## Current State

- `db/schema.sql:1-490` es el DDL vigente. No existe hoy ninguna tabla para
  staff↔tienda ni para `become-seller`; la exclusión de `db/schema.sql:13-16`
  ("wallets, direcciones, órdenes, carritos y reviews") NO cubre estos dos
  dominios y no hace falta levantarla (confirmado: `shops` no tiene columna
  `balance`, es un objeto anidado del mock).
- `ShopsService.getStaffs` devuelve `{ data: [], ...paginate(0, page, limit,
  0, url) }` (`apps/api/rest/src/shops/shops.service.ts:220-226`);
  `createStaff()`/`updateStaff()` devuelven `null`
  (`apps/api/rest/src/shops/shops.service.ts:359-366`). `UsersService.
  getMyStaffs`/`getAllStaffs` hoy son alias que filtran por el permiso global
  `staff` (`apps/api/rest/src/users/users.service.ts:261-273`), no por una
  relación por tienda — es el hueco que US-42 cierra sobre el pivote de esta
  US.
- `apps/api/rest/src/become-seller/become-seller.service.ts:8,12,18-20` sirve
  `become-seller.json` completo vía `plainToClass` sin filtrar campos: la
  respuesta HTTP real incluye **ambas** claves top-level del JSON,
  `page_options` y `commissions` (verificado empíricamente, ver más abajo).
- La base Postgres del `docker-compose.yml` está arriba (`safari-postgres`,
  puerto 5433) y `just db-check` (equivalente a `cd packages/db && npm test`)
  corre hoy en **10 archivos / 210 tests, todos en verde** (ejecutado en esta
  exploración: `Test Files 10 passed (10)`, `Tests 210 passed (210)`), la
  línea base exacta que CA-5 exige no bajar.

## Affected Areas

- `db/schema.sql` — añadir DDL de las 2 tablas nuevas + índices de FK,
  después del bloque de identidad (`:104-213`) o junto a `shops` (`:215-244`).
- `db/seed.sql` (generado) y `db/generate-seed.mjs` — nuevo bloque de emisión
  para ambas tablas, siguiendo el patrón de `settings` (`:173-180`) y de
  `permission_user`/`asignaciones` (`:64-81`, `:247-259`) para el seed
  inventado del pivote.
- `packages/db/prisma/schema.prisma` — 2 modelos nuevos vía `prisma db pull`
  + renombres manuales; **hay que revisar el diff de los 15 modelos
  existentes**, no solo los 2 nuevos (`packages/db/README.md:97-104`).
- `packages/db/src/records.ts` — 2 `*Record` + mappers `_to*Record` nuevos,
  siguiendo el patrón de `SettingRecord`/`_toSettingRecord`
  (`packages/db/src/records.ts:55-61,178-186`).
- `packages/db/index.ts` — exportar los 2 tipos `*Record` nuevos (NO
  funciones de repositorio: esas llegan con US-42/US-44, fuera de alcance
  aquí).
- `packages/db/src/repositories/*.integration.test.ts` — 2 archivos de test
  de esquema (FKs, CHECK, cascadas, conteos), consultando Prisma directo
  (`prisma.permissionUser.findMany(...)`,
  `packages/db/src/repositories/users.integration.test.ts:355-358`, es el
  precedente de cómo un test de esquema consulta un pivote sin pasar por un
  repositorio).
- `db/README.md` — documentar el modelo nuevo (sección "Identidad" ya
  existente, `db/README.md:42-83`).

## Hallazgos centrales (evidencia, no intuición)

### 1. Precedente `permission_user` — confirma el patrón para el pivote de staff

`db/schema.sql:171-178`:
```sql
CREATE TABLE IF NOT EXISTS permission_user (
    user_id         bigint       NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
    permission_id   bigint       NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    created_at      timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, permission_id)
);
```
PK compuesta, ambas FK `ON DELETE CASCADE`, **solo `created_at`** (sin
`updated_at`: una fila de pivote puro no se actualiza, se crea o se borra).
El índice inverso vive aparte: `permission_user_permiso_idx` (`:472`). El
mismo patrón lo siguen `category_product` (`:425-429`) y `product_tag`
(`:431-435`), ninguno de los tres con `updated_at`.

En `packages/db`, el precedente de escritura idempotente es
`grantPermission` (`packages/db/src/repositories/users.repository.ts:367-
388`): `prisma.permissionUser.upsert({ where: { userId_permissionId: {...}
}, create: {...}, update: {} })` — exactamente lo que CA-2 de US-42 pide
("la asignación repetida MUST ser idempotente"). **Recomendación: el pivote
de staff copia esta forma sin desviarse** — PK compuesta `(user_id,
shop_id)`, ambas FK `ON DELETE CASCADE`, solo `created_at`, índice inverso
sobre `shop_id` (US-41) y sobre `user_id` si `my-staffs` termina filtrando
por usuario (queda para US-42 decidir, no bloquea el DDL).

### 2. El pivote de staff va BARE — sin columna de rol

Evidencia cruzada de 4 fuentes independientes, todas apuntando a lo mismo:

- **Contrato de lectura real**: `GetStaffsDto` solo declara
  `page/limit/orderBy/sortedBy/shop_id`
  (`apps/api/rest/src/shops/dto/get-staffs.dto.ts:3-7`) y `StaffsController.
  getStaffs` devuelve `UserPaginator`
  (`apps/api/rest/src/shops/shops.controller.ts:108-111`), es decir,
  **usuarios**, no filas de pivote con metadata. `UserPaginator.data: User[]`
  (`apps/api/rest/src/users/dto/get-users.dto.ts:7-9`).
- **Contrato de escritura real**: el admin envía `AddStaffInput = { email,
  password, name, shop_id }`
  (`apps/admin/rest/src/types/index.ts:1562-1567`) — sin rol. El formulario
  (`apps/admin/rest/src/components/shop/staff-form.tsx:16-20,56-63`) pide
  nombre/email/password y arma `shop_id` desde la URL; **crea un usuario
  nuevo y lo asigna**, no selecciona uno existente ni un rol.
- **UI de listado**: `StaffList` (`apps/admin/rest/src/components/shop/
  staff-list.tsx:54-104`) solo pinta columnas `name`, `email`, `is_active`,
  `actions` — cero campo de rol.
- **El mock no trae rol tampoco**: `users.json` trae un campo `shop_id`
  (siempre `null` en los 3 usuarios reales, verificado con `node -e`) y un
  campo `shops` que en realidad es la lista de tiendas que el usuario
  **posee** (`owner_id`), no de las que es staff — ningún campo de rol por
  tienda.

`users` (`db/schema.sql:116-125`) **NO tiene columna `shop_id`**: el mock
declara una relación 1:1 opcional (Laravel) que este esquema nunca adoptó;
la decisión D-2 del épico (N:M con pivote) ya la reemplaza a propósito, y el
`shop_id` del mock quedando siempre `null` es consistente con "staff sin
asignar hasta ahora" — no hay dato real que se pierda.

**Recomendación: pivote bare `(user_id, shop_id, created_at)`**, sin columna
de rol. Añadir una columna especulativa que ningún consumidor real pide
viola la regla de simplicidad del repo y no la piden ni CA-1/CA-2 de US-42
ni ningún componente de UI.

### 3. El singleton de `become-seller` — el JSON NO es un solo objeto, son dos colecciones

`apps/api/rest/src/db/pickbazar/become-seller.json` tiene **dos claves
top-level**, verificado con `node -e`:
```
top keys: [ 'page_options', 'commissions' ]
page_options keys: [ 'id', 'page_options', 'language', 'created_at', 'updated_at' ]
commissions: [ {...9 campos, incluido image...}, ... ]   // ARRAY
```
`data.page_options` en sí mismo **ya tiene la forma exacta de una fila de
`settings`** (`id`, contenido anidado, `language`, `created_at`,
`updated_at` — comparar con `db/schema.sql:73-80`). `data.commissions` es
una lista independiente de tiers de comisión (array de objetos), un
concepto distinto, hermano del anterior, no anidado dentro de él.

**Discrepancia con la prosa de la US/épica**: US-41 CA-2 y US-44 (`docs/
product/40-identidad-extendida-postgres/41-esquema-identidad-extendida.md:
62-65`, `44-become-seller-postgres.md:23-26`) describen el JSON como "un
único objeto con `page_options`" y proponen una sola columna `page_options
jsonb`. El código dice otra cosa: hay una segunda colección (`commissions`)
que el contrato HTTP real expone y que CA-1 de US-44 exige preservar byte a
byte. Verificado que el `GET` real (`becomeSellerService.findAll()` →
`plainToClass(BecomeSeller, becomeSellerJson)`,
`apps/api/rest/src/become-seller/become-seller.service.ts:8,18-20`) sirve
el objeto completo sin filtrar props (`class-transformer` sin
`excludeExtraneousValues` copia toda clave del plano): reproducido con
`node -e` — `JSON.stringify(plainToClass(...))` es **byte-idéntico** al
`JSON.stringify` del JSON crudo (11.456 caracteres, sin el pretty-print del
archivo en disco que mide 14.115 B).

**Recomendación**: tabla `become_seller` de una sola fila (mismo patrón que
`settings`: `id smallint PK DEFAULT 1` + CHECK de fila única), pero con
**dos columnas jsonb**, no una: `page_options jsonb` (el contenido anidado
real, `data.page_options.page_options`) y `commissions jsonb` (el array
completo), más `language text DEFAULT 'es'` (mismo default que `settings`,
`db/schema.sql:76`), `created_at`/`updated_at`. El servicio de US-44
reconstruye la forma exacta del JSON original componiendo `{ page_options:
{ id: row.id, page_options: row.page_options, language: row.language,
created_at: row.created_at, updated_at: row.updated_at }, commissions:
row.commissions }`. Alternativa descartada: una sola columna `page_options
jsonb` que envuelva `{page_options, commissions}` enteros — funciona
también, pero el nombre de columna mentiría sobre su contenido y complica
el mapper. Cualquiera de las dos opciones sigue siendo **una tabla**, dentro
de lo autorizado; lo que NO cabe sin pedir autorización nueva es una tercera
tabla para `commissions` como colección propia (fuera del alcance de "2
tablas, 1 reset").

Esto es una decisión que la propuesta debe declarar explícitamente citando
esta evidencia — el criterio del repo es que el código gana sobre la prosa
del backlog cuando divergen.

### 4. Seeding

`db/generate-seed.mjs` sigue un patrón fijo por tabla: `bloque(...)` (banner
de comentario) → `INSERT ... VALUES` con los literales `txt/num/bool/json`
(`:36-47`) → validación previa en el array `problemas` (`:101-140`, aborta
si el mock viola una restricción). El singleton `settings` se emite así en
`:173-180`; el `become_seller` nuevo debe copiar exactamente esa forma con
`leer('become-seller')` (mismo helper, `:23`) y **dos** literales `json(...)`
(uno por columna).

Para el pivote de staff **no hay mock** (`getStaffs` devuelve `[]` siempre,
confirmado arriba). El precedente para un seed inventado y validado es
`permissionsCatalogo` + `asignaciones` (`:64-81`), que arma un array a mano
y lo valida contra los ids reales antes de emitir SQL. Verificado contra la
base real (`psql`, read-only):
```
users:  1 store_owner@demo.com | 2 customer@demo.com | 3 admin@demo.com
shops:  owner_id=1 en las 12 filas (sin excepción)
```
Es decir, **el único dueño real de las 12 tiendas es el usuario 1**. Un seed
de staff coherente debe asignar como staff a usuarios que **no** sean ya
dueños de la tienda en cuestión, para que la fila tenga sentido semántico
(nada en el DDL lo impide con un CHECK, pero mezclar `owner_id` con staff de
la misma tienda sería un dato inventado sin justificación). Candidato
razonable: `customer@demo.com` (id 2) y/o `admin@demo.com` (id 3) como staff
de 2-3 tiendas del catálogo de 12, sin tocar `owner_id`.

Ninguna de las dos tablas nuevas necesita `setval` en el bloque de
"Secuencias" (`:410-419`): `become_seller` usa `smallint DEFAULT 1` (como
`settings`, que tampoco está en esa lista) y el pivote de staff no tiene
`id` propio (como `permission_user`, `category_product`, `product_tag`,
tampoco en la lista).

### 5. Blast radius sobre los conteos del seed

Asserts vivos verificados por ubicación exacta:
- `packages/db/src/repositories/categories.integration.test.ts:61,66,114,703`
  — `toBe(83)` (raíces) y `toBe(198)` (total), 3 veces.
- `packages/db/src/repositories/shops.integration.test.ts:51,125,480` —
  `toBe(12)`.
- `packages/db/src/repositories/users.integration.test.ts:366-371` —
  documenta EXPLÍCITAMENTE que los conteos "antes/después" (users 3, shops
  12, products 1200, categories 198) **no se assertan dentro del archivo**,
  sino con un `SELECT count(*)` externo antes/después de `just db-check`
  (comentario propio del repo, no inventado aquí).
- `apps/api/rest/src` — **cero** asserts de conteo del seed (`grep` sin
  resultados): confirma lo que dice `CLAUDE.md`, las 9 suites de Jest
  mockean `@safari/db` y no dependen de Postgres.

Línea base ejecutada en esta exploración (`cd packages/db && npm test`):
```
Test Files  10 passed (10)
     Tests  210 passed (210)
```
CA-5 exige no bajar de esa cifra tras `just db-reset` con el DDL nuevo.

### 6. Costo de re-introspección

`packages/db/prisma/schema.prisma` tiene hoy **319 líneas / 15 modelos**
(confirmado por `grep -n "^model"`, 15 coincidencias, y `wc -l` = 319).
`prisma db pull` pisa los renombres manuales
(`packages/db/README.md:97-104`). Lo que hay que reaplicar tras el pull,
verificado en el propio archivo:
- El bloque de cabecera (`schema.prisma:1-29`) explicando qué CHECK/índices
  Prisma no modela — **Prisma lo borra siempre** en un `db pull`.
- `previewFeatures = ["partialIndexes"]` (`:33-35`) — sin él, el índice
  parcial de `products` se trataría como total y `prisma validate` marcaría
  drift.
- `datasource db { provider = "postgresql" }` **sin `url`** (`:37-39`) — la
  introspección normalmente escribe `url = env("DATABASE_URL")`; hay que
  quitarlo de nuevo.
- Nombres de modelo PascalCase + `@@map("tabla_snake")` en los 15 modelos
  existentes (p. ej. `model Setting { ... @@map("settings") }`,
  `:41-49`) — la introspección los regenera como el nombre crudo de la
  tabla.
- Campos camelCase + `@map("columna_snake")` en cada campo no trivial (p.
  ej. `ownerId BigInt @map("owner_id")`, `Shop`, `:75`).
- `User.email` **sin** `@unique` (`schema.prisma:236`, comentario
  `:20-23`) — la introspección podría intentar inferir unicidad distinto;
  hay que confirmar que se mantiene así porque la unicidad real vive en
  `users_email_lower_idx`, un índice de expresión que Prisma no ve.

Los 2 modelos nuevos (`ShopStaff`/pivote, `BecomeSeller`/singleton — nombres
tentativos, ver sección de naming) se añaden siguiendo exactamente la forma
de `PermissionUser` (`schema.prisma:278-289`) y `Setting`
(`schema.prisma:41-49`) respectivamente.

### 7. Naming

**Nota sobre la US**: pide revisar "la tabla de nomenclatura" de
`db/README.md` — leído completo, **ese archivo no contiene ninguna tabla de
nomenclatura**; las convenciones (inglés, snake_case en SQL, `_id` en FKs,
`bigserial` para PK simples, `smallint` para singleton) se infieren
directamente de `db/schema.sql`, no de una tabla documentada aparte. Es una
discrepancia menor entre la prosa de la US y el estado real de los docs —
no bloquea, pero la propuesta no debe prometer citar una tabla que no
existe.

Propuesta de nombres, consistente con el precedente del propio archivo:
- **Pivote staff↔tienda**: `shop_staff` (columnas `shop_id`, `user_id`,
  `created_at`; PK compuesta `(shop_id, user_id)` o `(user_id, shop_id)` —
  cualquier orden es válido en Postgres para una PK compuesta, se recomienda
  `(user_id, shop_id)` para replicar el orden textual de `permission_user
  (user_id, permission_id)`). Modelo Prisma: `ShopStaff`, `@@map("shop_staff")`.
  Alternativa descartada: `staff_shop` — menos consistente con
  `category_product`/`product_tag`, donde el segundo miembro es el
  "calificador" de la consulta más frecuente (aquí, `GetStaffsDto.shop_id`
  es el filtro principal, así que `shop_id` primero en el nombre de tabla
  es más legible: `shop_staff`).
- **Singleton become-seller**: `become_seller` (snake_case directo del
  nombre de dominio, igual que `become-seller.json` → `become_seller`).
  Modelo Prisma: `BecomeSeller`, `@@map("become_seller")`. CHECK de fila
  única: `become_seller_fila_unica CHECK (id = 1)` (mismo patrón textual que
  `settings_fila_unica`, `db/schema.sql:79`).

## Approaches

1. **Pivote bare + singleton de 2 columnas jsonb (recomendado)**
   - `shop_staff (user_id, shop_id, created_at)`, PK compuesta, FKs CASCADE,
     sin rol.
   - `become_seller (id smallint PK DEFAULT 1, page_options jsonb,
     commissions jsonb, language text DEFAULT 'es', created_at, updated_at)`.
   - Pros: no inventa columnas que ningún consumidor pide; preserva el
     contrato HTTP real (incluido `commissions`) sin una tercera tabla;
     sigue el precedente `permission_user`/`settings` al pie de la letra.
   - Cons: el nombre de columna `page_options` dentro de una tabla que
     también tiene `commissions` puede leerse raro sin el comentario de
     cabecera que lo explique (mitigable con un buen comentario SQL, como ya
     hace el resto del archivo).
   - Effort: Low.

2. **Pivote con columna `role` + singleton de 1 columna jsonb (literal a la
   prosa de la US)**
   - `shop_staff (user_id, shop_id, role, created_at)`.
   - `become_seller (id, page_options jsonb, ...)` con `commissions` anidado
     a mano dentro del jsonb `page_options` en el momento de sembrar (el
     nombre de columna miente sobre su contenido real).
   - Pros: calca literalmente el texto de CA-1/CA-2 de la US sin
     cuestionarlo.
   - Cons: `role` es una columna especulativa sin consumidor verificado (va
     contra la regla de simplicidad y contra CA-1 de US-42, que no declara
     rol en ningún DTO); forzar `commissions` dentro de `page_options` para
     mantener "una sola columna" complica el mapper de US-44 sin ganar nada
     a cambio.
   - Effort: Low, pero con deuda oculta (columna sin uso + nombre engañoso).

## Recommendation

Approach 1. La evidencia de código (DTOs, formularios, tabla de listado,
respuesta real de `become-seller.service.ts`) es consistente y unánime: el
pivote no necesita rol y el singleton necesita dos colecciones, no una. La
prosa de la US (CA-1/CA-2) se ajusta en la propuesta citando esta
exploración — el repo declara explícitamente que el código gana sobre la
prosa cuando divergen (regla de este phase).

## Risks

- **Discrepancia CA-2 vs. JSON real de `become-seller`**: si la propuesta
  copia literalmente "un jsonb `page_options`" sin resolver el hallazgo de
  `commissions`, la US-44 posterior no podrá cumplir su CA-1 (byte-exact)
  sin un segundo `db-reset` — contradice la decisión 2 del épico ("todo el
  DDL en US-41, un solo reset"). Mitigación: decidir esto en `sdd-propose`,
  no dejarlo para US-44.
- **`GetStaffsDto`/`UserPaginator` implica que el repositorio de US-42 debe
  hacer JOIN `shop_staff → users`** para devolver `User[]`, no filas de
  pivote — el DDL de esta US debe dejar el índice `shop_staff` sobre
  `shop_id` (la consulta más frecuente) sin asumir cómo se filtra
  `my-staffs` (hoy filtra por el permiso global `staff`, no por el pivote —
  `apps/api/rest/src/users/users.service.ts:267-269`); si US-42 decide
  cambiarlo, puede necesitar un índice sobre `user_id` también. No bloquea
  el DDL (ambos índices son baratos de añadir de una vez), pero la
  propuesta debería considerar indexar ambos lados del pivote, no solo
  `shop_id`, dado el coste marginal.
- **`MyStaffsController` es hoy `ADMIN_ONLY`** (`apps/api/rest/src/users/
  users.controller.ts:121-129`), no "acotado al usuario autenticado" como
  sugiere la prosa de US-42 CA-3 (`docs/product/40-identidad-extendida-
  postgres/42-staffs-postgres.md:58-60`). Es una discrepancia de US-42, no
  de esta US — se deja anotada aquí porque apareció durante la
  investigación de los consumidores y afecta si el pivote necesita
  filtrarse por "usuario actual" o solo por `shop_id` vía query param.
- **Re-introspección de 15 modelos existentes** es un paso manual propenso a
  error humano (olvidar reaplicar un `@map` o el preview feature) — mitigado
  por el checklist ya citado en la sección 6 y por el DoD de la US que pide
  clasificar el diff completo (cosmético vs. semántico).
- **Seed de staff inventado**: al no existir mock, cualquier elección de
  usuarios/tiendas es arbitraria. Verificado que los 3 usuarios y las 12
  tiendas (todas con `owner_id = 1`) permiten una asignación coherente sin
  contradecir la propiedad, pero la propuesta debe declarar explícitamente
  qué filas se siembran y por qué (aunque sea "arbitrario pero coherente").

## Ready for Proposal

Sí. La evidencia es suficiente y consistente para decidir forma del DDL,
naming y estrategia de seed sin bloquear en el dueño — el único punto que
`sdd-propose` debe declarar explícitamente (no silenciar) es la
discrepancia de la sección 3 (`become-seller` con dos columnas jsonb en vez
de una), citando esta exploración como evidencia.
