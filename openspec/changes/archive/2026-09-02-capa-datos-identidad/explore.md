# Exploration: US-21 — Capa de datos de identidad en `@safari/db`

## Current State

### Baseline verificado (no asumido)

`prisma validate` contra `packages/db/prisma/schema.prisma` (cwd con unidad
en mayúscula, sin la trampa de memoria):

```
Prisma schema loaded from packages\db\prisma\schema.prisma.
The schema at packages\db\prisma\schema.prisma is valid 🚀
```

`just db-check` real (cwd `C:\DevOps\...`, no `c:\...`):

```
Test Files  6 passed (6)
     Tests  57 passed (57)
```

Confirmado en la base viva (`safari-postgres`, `:5433`): `\d users` /
`\d profiles` / `\d permissions` / `\d permission_user` coinciden columna
por columna con lo que describe `openspec/specs/identity-schema/spec.md` y
con `archive-report.md` de US-20. Counts: `users` 3 (ids 1/2/3,
`store_owner@demo.com`/`customer@demo.com`/`admin@demo.com`, los 3
`is_active = true`), `profiles` 3, `permissions` 4, `permission_user` 6. Las
5 FK reales: `profiles.user_id`/`permission_user.user_id`/
`permission_user.permission_id`/`password_reset_tokens.user_id` en
`CASCADE` (`confdeltype = 'c'`), `shops.owner_id` en `RESTRICT`
(`confdeltype = 'r'`) — exactamente como documenta `design.md` (US-20,
Decision B). Los 3 emails sembrados **ya están en minúscula**
(`email = lower(email)` → `t` en los 3).

`packages/db/prisma/schema.prisma` **no tiene** `User`/`Profile`/
`Permission` todavía — US-20 cambió la base, no este archivo (confirmado
leyendo el archivo completo: 7 modelos, los del catálogo, nada de
identidad). Por eso `prisma.user` **no existe** en el cliente generado hoy
(`generated/prisma/client/client`): cualquier prueba viva contra un modelo
`User` fallará hasta que se re-introspeccione. La introspección y los
renombres manuales son, literalmente, la primera tarea de esta US.

### La pregunta central: cómo consultar `lower(email) = lower($1)` desde Prisma

Evidencia empírica nueva (no solo la heredada de US-20), generada
ejecutando el **mismo query builder de Prisma 7 + `@prisma/adapter-pg`**
que usará `users.repository.ts` — contra un campo existente (`Shop.slug`),
porque `User` aún no existe en el cliente. Se activó `log: ['query']` en un
`PrismaClient` de prueba (bundleado con `tsup --shims`, igual que hace
`tsup.config.ts` del paquete, y ejecutado con el `node_modules` real del
paquete). Tres candidatos, SQL real observado:

```
-- A) where: { slug: { equals: 'GADGET', mode: 'insensitive' } }
SELECT ... FROM "public"."shops" WHERE "public"."shops"."slug" ILIKE $1 LIMIT $2 OFFSET $3

-- B) email.toLowerCase() en JS, luego where: { slug: 'gadget' } (equals plano)
SELECT ... FROM "public"."shops" WHERE ("public"."shops"."slug" = $1 AND 1=1) LIMIT $2 OFFSET $3

-- C) $queryRaw con lower() explícito
SELECT id, slug FROM shops WHERE lower(slug) = lower($1)
```

Y el `EXPLAIN` real contra `users` (Postgres 5433, no un supuesto), que
reproduce **y confirma** la evidencia de US-20 (`verify-report.md` R2-S1):

```sql
EXPLAIN SELECT * FROM users WHERE email = 'admin@demo.com';
 Seq Scan on users  (cost=0.00..16.50 rows=3 width=129)
   Filter: (email = 'admin@demo.com'::text)

SET enable_seqscan=off;
EXPLAIN SELECT * FROM users WHERE email = 'admin@demo.com';
 Seq Scan on users  (cost=10000000000.00..10000000016.50 rows=3 width=129)
   Filter: (email = 'admin@demo.com'::text)

EXPLAIN SELECT * FROM users WHERE lower(email) = lower('admin@demo.com');
 Index Scan using users_email_lower_idx on users  (cost=0.15..8.17 rows=1 width=129)
   Index Cond: (lower(email) = 'admin@demo.com'::text)
```

**Lectura de los tres candidatos, no solo del primero:**

- **Candidato A** (`mode: 'insensitive'`) genera `ILIKE`. `ILIKE` sobre una
  columna `text` plana no puede usar un índice btree sobre `lower(email)`
  (ni ningún btree normal) — es un descarte directo, y además Prisma no
  ofrece ningún operador que genere `lower(columna) = lower($1)` de forma
  nativa: su superficie de filtros es `equals`/`contains`/`mode`, no
  funciones SQL arbitrarias sobre la columna.
- **Candidato B** — este es el hallazgo que **no estaba ya resuelto por
  US-20** y que cambia el marco de la pregunta: normalizar en JS
  (`email.toLowerCase()`) y comparar con `where: { email: lowered }`
  produce exactamente `email = $1` — la MISMA forma que el `EXPLAIN` de
  arriba prueba que **no usa `users_email_lower_idx`**, con o sin
  `enable_seqscan=off`. Es decir: normalizar en JS resuelve la
  *corrección* de la búsqueda (si todo lo que se escribe ya está en
  minúscula, `email = 'admin@demo.com'` encuentra la fila), pero **no
  resuelve el uso del índice**, porque el único índice que existe está
  sobre la expresión `lower(email)`, no sobre la columna `email` — sin
  importar qué valor (mayúscula o minúscula) se compare contra la columna
  cruda, el planner no tiene forma de relacionar `email = $1` con un índice
  cuya clave es `lower(email)`.
- **Candidato C** (`$queryRaw` con `lower()` explícito en ambos lados) es
  la **única** forma, de las tres, que genera literalmente
  `lower(email) = lower($1)` — la única que el `EXPLAIN` de arriba
  demuestra que usa el índice.

**Conclusión de evidencia (no de preferencia):** ninguna API nativa de
Prisma (`equals`, `contains`, `mode: 'insensitive'`, o el propio
`equals` con un valor pre-normalizado en JS) produce la forma de query
`lower(email) = lower($1)`. Esa forma —que `openspec/specs/identity-schema/
spec.md:38` fija como un **MUST** literal ("Todo consumidor MUST comparar
`lower(email) = lower($1)`"), no solo como una recomendación de
performance— solo se logra con SQL crudo (`$queryRaw`/`Prisma.sql`).

**Corrección de precondición para el candidato B ("normalizar en
lectura")**: los 3 emails sembrados ya están en minúscula (verificado
arriba), así que hoy `where: { email: input.email.toLowerCase() }`
encontraría a los 3 usuarios correctamente. Pero nada en el esquema lo
garantiza para el futuro: no hay `CHECK (email = lower(email))` en
`db/schema.sql` (solo el índice único funcional) y CA-4 de esta misma US
pide `createUser` — si ese `createUser` no normaliza también en
**escritura**, un email nuevo con mayúsculas rompería la premisa de B en
silencio (seguiría siendo *único* por el índice funcional, pero un login
posterior con minúsculas no lo encontraría vía `email = $1` si se guardó
con mayúsculas).

### `$queryRaw` — ¿hay una política escrita, o es solo lo que pasó a ocurrir?

Grep sobre `packages/db/src/`: el único `$queryRaw` que existe hoy en todo
el paquete es `packages/db/src/health.ts:21`
(`prisma.$queryRaw\`SELECT 1\``, un ping de salud, no una consulta de
dominio). Ningún repositorio del catálogo usa `$queryRaw`.

Dos diseños archivados **lo mencionan explícitamente como descarte**, pero
en ningún caso como una regla del repositorio — son decisiones puntuales
con una alternativa Prisma-nativa disponible y barata:

- `openspec/changes/archive/2026-08-26-categorias-arbol-postgres/design.md:164`:
  descarta `WITH RECURSIVE` vía `$queryRaw` para el árbol de categorías
  porque "introduce una segunda estrategia de consulta... sin ganancia
  alguna a 198 filas" — la alternativa elegida (`findMany()` plano +
  ensamblaje en memoria) es igual de barata y más simple de testear.
- `openspec/changes/archive/2026-08-31-endpoints-derivados-postgres/design.md:19,104-105`:
  "cero `$queryRaw`" se declara como una propiedad lograda de ESA US
  (haversine en JS sobre 12 shops), y el propio texto lo enmarca como
  "ningún repositorio del paquete usa `$queryRaw`" — una observación
  fáctica del estado en ese momento, no una prohibición declarada.

Búsqueda adicional (`packages/db/README.md`, `db/README.md`): **cero
menciones de `$queryRaw`** en ningún README del paquete o de `db/`. No
existe ningún comentario de cabecera, regla de `openspec/config.yaml` ni
sección de "decisiones de estilo" que prohíba `$queryRaw`. Conclusión:
**no hay política escrita en ningún sitio** — es un patrón que se sostuvo
hasta ahora porque cada caso anterior tenía una alternativa Prisma-nativa
viable. CA-2 de esta US es el primer caso donde, por evidencia dura de
arriba, **no existe** esa alternativa para cumplir el MUST literal de la
spec.

### Prisma 7 + `@prisma/adapter-pg` — no cambia nada de lo anterior

El cliente ya usa el driver adapter (`packages/db/src/client.ts:1,14`:
`new PrismaPg({ connectionString })`). `$queryRaw` sigue disponible y
funciona igual con el adapter (probado empíricamente arriba, candidato C,
contra la base real vía el adapter — no es una suposición de docs). No hay
ninguna feature de Prisma 7 (p. ej. TypedSQL) ya adoptada en el paquete
(`package.json` no declara `--sql` ni ningún generator adicional), así que
introducirla sería una superficie nueva, no una continuación de un patrón
existente.

### La forma de un repositorio existente — dos precedentes leídos completos

**El más simple** (`packages/db/src/repositories/settings.repository.ts`,
12 líneas): una sola función exportada (`getSettings`), sin `input`, sin
paginación. Import del singleton `prisma` desde `../client` y del mapper
`_toSettingRecord` desde `../records`. Comentario de cabecera de 4 líneas
explicando qué es la tabla y por qué importa (primera llamada del SSR).
Ningún manejo de error propio: si `prisma.setting.findUnique` lanza, la
excepción sube tal cual — la traducción a HTTP/mensaje amigable vive en el
servicio de Nest (`getUserFriendlyMessage`, ver abajo), no en el
repositorio.

**El más rico** (`packages/db/src/repositories/shops.repository.ts`, 187
líneas): funciones planas exportadas (`listShops`, `findShopBySlug`,
`listShopsNear`, `findOrCreateShopBySlug`), un `interface ListXInput` por
función de listado con `page`/`limit`/filtros opcionales, un `where:
Prisma.ShopWhereInput` armado con spreads condicionales
(`...(input.name && { name: { contains: input.name, mode: 'insensitive'
as const } } )`), y funciones internas no exportadas con prefijo `_`
(`_parseLocation`, `_haversineKm`) para lógica pura sin Prisma. El listado
devuelve `{ items, total }` — NUNCA el envoltorio de paginación (ver
sección de `buildPaginator` abajo). El export de tipos coexiste con el de
funciones en el mismo archivo (`export interface ListShopsInput`, `export
async function listShops`).

**Traducción de casing**: los repositorios devuelven camelCase (records);
`apps/api/rest` traduce a snake_case en el servicio de Nest — confirmado en
`apps/api/rest/src/products/products.service.ts` (usa `@safari/db` y
mapea manualmente a las 20 claves del contrato HTTP) y documentado como
D-3 del épico.

**Manejo de errores — dos capas distintas, ninguna se solapa:**
1. Errores de dominio para CHECK constraints que Prisma no modela: se
   declaran como clases (`export class InvalidSalePriceError extends
   Error`, `MissingPriceError`, `IncompleteProvenanceError` en
   `products.repository.ts:419-445`) y el propio repositorio las lanza
   ANTES de llamar a Prisma (`products.repository.ts:332`), validando la
   condición en JS. **No aplica a esta US**: verificado con
   `pg_constraint` que `users`/`profiles`/`permissions`/`permission_user`
   tienen **cero** CHECK constraints (`contype='c'` → 0 filas) — a
   diferencia de `products`, no hay ninguna regla de negocio que Prisma no
   modele y que el repositorio deba re-validar en JS.
2. Errores genéricos de Prisma (`packages/db/src/errors.ts`:
   `isPrismaError`/`parsePrismaError`/`getUserFriendlyMessage`/
   `isPrismaConstraintError` para P2002/P2003/P2025): se usan en el
   **servicio de Nest**, no en el repositorio — confirmado
   (`apps/api/rest/src/categories/categories.service.ts:216-234`,
   `manufacturers.service.ts:105-139` los importan y envuelven en
   `ServiceUnavailableException`/`InternalServerErrorException`). El
   repositorio de identidad no necesita re-implementar esto; sí necesita
   decidir si `createUser` con un email duplicado deja subir el P2002 tal
   cual (el índice único funcional SÍ dispara P2002 aunque Prisma no lo
   tenga modelado en el schema, porque P2002 se deriva del código de error
   `23505` que devuelve Postgres, no de que Prisma "conozca" la
   restricción) o si el repositorio hace un `findUserCredentialsByEmail`
   previo para devolver un error de dominio propio antes de escribir.

### `records.ts` — convención exacta

Mappers internos con prefijo `_` (`_toShopRecord`, `_toSettingRecord`...),
tipos públicos sin prefijo (`ShopRecord`, `SettingRecord`...). Dos
conversiones deliberadas y **reutilizables tal cual**, documentadas en la
cabecera del archivo (líneas 1-18):

- `_id(value: bigint): number` — `Number(value)`, con overload para
  `bigint | null`. **Es la única conversión de BigInt que usa el paquete**
  (grep confirma: ningún repositorio hace `Number()` inline, todos pasan
  por `_id`). Los 4 nuevos ids (`users.id`, `permissions.id`) son
  `bigserial` igual que el resto — `_id` se reutiliza sin cambios.
  `permission_user`/`profiles` no tienen `id` propio (PK compuesta o
  prestada), así que no necesitan `_id` para su propia fila, solo para las
  FK que expongan.
- `_dec(value: Prisma.Decimal): number` — no aplica a identidad (ninguna
  columna `numeric`).

Cada `*Record` es una `interface` plana; cada mapper toma la fila cruda de
Prisma (tipo del modelo generado) y devuelve el record. No existe hoy
ningún record con relaciones anidadas (todos los `*Record` actuales son de
una sola tabla) — `UserRecord`-con-perfil-y-permisos de CA-3 sería el
primer record compuesto del paquete.

### `buildPaginator` — firma exacta y, más importante, su USO real hoy

Firma (`packages/db/src/pagination.ts:28-37`):

```ts
export interface BuildPaginatorInput<T> {
  data: T[]; total: number; page: number; limit: number; baseUrl?: string;
}
export function buildPaginator<T>(input: BuildPaginatorInput<T>): Paginator<T>
```

Devuelve `Paginator<T>` con las claves Laravel-shape del mock
(`current_page`, `count`, `last_page`, `firstItem`, `lastItem`, `per_page`,
`first_page_url`/`last_page_url`/`next_page_url`/`prev_page_url`, con la
rareza documentada de que `prev_page_url` apunta a la página ACTUAL).

**Hallazgo central para el diseño de CA-5**: `buildPaginator()` tiene **una
sola invocación en todo el repositorio** —
`packages/db/src/repositories/products.integration.test.ts:97
(const wrapper = buildPaginator({...}))`— y es dentro de un test, para
verificar la aritmética del propio helper contra datos reales. **Ningún
repositorio de producción llama a `buildPaginator`** (grep de
`buildPaginator(` sobre `packages/db/src/repositories/*.ts` → 0
resultados). Todos los `list*` (`listShops`, `listProducts`,
`listManufacturers`, `listTags`) devuelven `{ items, total }` crudo. Y el
propio `packages/db/README.md:74` lo declara como contrato explícito:

> "Los repositorios devuelven `{ items, total }` y el caller arma el
> envoltorio" — con el ejemplo `buildPaginator({ data: items, total, page,
> limit, baseUrl })` invocado por quien LLAMA al repositorio, no por el
> repositorio mismo.

Más aún: **tampoco el consumidor real de hoy usa `buildPaginator`.**
`apps/api/rest/src/products/products.service.ts` (el único servicio de
Nest ya migrado a `@safari/db`, confirmado por sus imports) arma el
envoltorio con su **propio** helper histórico,
`src/common/pagination/paginate.ts` (`import { paginate } from
'src/common/pagination/paginate'`, usado 3 veces en ese archivo), NO con
`buildPaginator` de `@safari/db`. Es decir: `buildPaginator` existe en el
paquete, está documentado como el contrato "de la casa", pero a día de hoy
tiene **cero** consumidores de producción — ni en `packages/db` ni en
`apps/api/rest`.

Esto choca de frente con la letra de **CA-5**: *"`listUsers` devuelve el
envoltorio de paginación estándar de la casa (`buildPaginator`)"* — que
pide que el REPOSITORIO devuelva `Paginator<UserRecord>` ya armado,
mientras el precedente unánime (4 repositorios + el propio README) es que
el repositorio devuelve `{ items, total }` y otro nivel arma el
envoltorio. Ver Open Questions.

No existe ningún "helper de búsqueda compartido": cada repositorio arma su
propio `where: Prisma.XWhereInput` con `contains`/`mode: 'insensitive'`
inline (`shops.repository.ts:43`, `manufacturers.repository.ts:28`,
`products.repository.ts:209`). El "helper de búsqueda compartido" que
US-5 dejó mencionado como trabajo diferido **no se creó** (grep sobre
`packages/db/src/` para `search` como export compartido → nada fuera de
los `input.name`/`input.text` locales a cada archivo).

### Tests de integración — dos patrones, ambos vigentes

**Solo lectura** (`shops.integration.test.ts`, `categories`,
`manufacturers`, `tags`, `types`): un único `afterAll(() =>
prisma.$disconnect())`, sin `beforeAll`, sin escritura. Los asserts fijan
cifras absolutas del seed (`total).toBe(12)`, `items[0].id).toBe(15)`).

**Con escritura** (`products.integration.test.ts`, el ÚNICO precedente de
escritura en el paquete — 517 líneas): usa un **valor centinela**
(`const TEST_STORE = 'TestStore-integration'`) para poder borrar SOLO sus
propias filas. Limpieza en **ambos extremos**, con el comentario explícito
de por qué (líneas 25-31):

```ts
// Limpieza de ENTRADA, no solo de salida: una corrida abortada (Ctrl-C,
// EADDRINUSE, timeout) deja filas de prueba vivas y la siguiente pasada
// cuenta 12 donde asserta 11.
beforeAll(async () => { await prisma.product.deleteMany({ where: { sourceStore: TEST_STORE } }); });
afterAll(async () => {
  await prisma.product.deleteMany({ where: { sourceStore: TEST_STORE } });
  await prisma.$disconnect();
});
```

Los asserts de total que podrían moverse por la fixture usan
`toBeGreaterThan(1000)`/`toBeGreaterThan(0)`, nunca el literal exacto — el
literal exacto (`1200`) no lo asserta ningún test (confirmado también en
el `explore.md` de US-20). **Aplicación directa a CA-6 de esta US**: la
tabla `users` SÍ tiene un conteo exacto que otro test podría necesitar
(`total === 3`), así que un `createUser` de prueba necesita el mismo
patrón de centinela + limpieza en ambos extremos (p. ej. un email con
dominio reservado tipo `+test-integration@`), y cualquier assert sobre
`listUsers().total` que no filtre por ese centinela debe usar
`toBeGreaterThanOrEqual` en vez de `toBe(3)`.

### Cadena de build/consumo — confirmada, no solo leída

`tsup.config.ts`: `format: ['cjs']` a propósito (evitar dual-package
hazard con el singleton de Prisma), `shims: true` **obligatorio** (el
cliente generado por Prisma 7 usa `import.meta.url` en su primera línea
ejecutable; sin el shim, `require()` revienta al cargar — comprobado en
esta misma exploración: el bundle de prueba necesitó `--shims` para correr
bajo `require()`). `external`: `@prisma/client`, `@prisma/adapter-pg`,
`prisma`, `pg`, `dotenv` — el cliente generado (`generated/`) SÍ se
bundlea (no es external), es lo que permite no compilar sus ~17 archivos
por separado. `just db-build` = `npm install && npm run build` (que corre
`prisma generate && tsup`). `just db-check` = `npm run typecheck` +
`cd "$(pwd)" && npm test` — el `cd "$(pwd)"` re-normaliza la letra de
unidad (documentado en `justfile:325-327` con el mecanismo exacto: vitest
cachea módulos ESM por URL, sensible a mayúsculas, y con la unidad en
minúscula termina cargando dos instancias del mismo módulo y fallando con
"0 tests"). Confirmado en esta sesión: correr desde `C:\...` (mayúscula)
sin el `cd "$(pwd)"` ya funciona (57/57), consistente con la nota de
memoria.

### Qué consumirán US-22 y US-25 — leído de las dos US, no inferido

**US-22** (`22-login-jwt-postgres.md`) necesita, contra `@safari/db`:
- Una función de credenciales por email (CA-1: login con email+password;
  CA-2: rechazar `is_active = false`) — el propio épico (D-2) ya nombra la
  función `findUserCredentialsByEmail` como la única que devuelve el hash.
- `createUser` con el permiso inicial `customer` (CA-3: registro).
- Una función para cambiar el hash tras verificar el actual (CA-5).
- Una lectura de "usuario completo" para `/me` (CA-4) que reproduzca el
  shape Laravel de `permissions[]` (`name`, `guard_name`, `pivot`) — el
  `pivot` que hoy trae `model_id`/`permission_id`/`model_type` (constante
  Laravel sin contraparte, ya señalado en el explore de US-20 como
  candidato a fijarse en el servicio de Nest, no en la base).
- **NO** necesita hashing ni verificación (US-22 hace eso con `bcryptjs`,
  fuera de `packages/db` — D-2 del épico, remarcado también en las notas
  de esta US).

**US-25** (`25-endpoints-usuarios-postgres.md`) necesita:
- `listUsers` paginado con búsqueda por nombre/email y filtro por rol, para
  `GET /api/users`, `admin/list`, `vendors/list`, `customers/list`,
  `my-staffs`, `all-staffs` — 5 de los 7 controladores son variaciones del
  mismo `listUsers` con un filtro de permiso distinto.
- Lectura por id con perfil/permisos/tiendas (CA-3), 404 si no existe.
- `is_active` toggle real (`block-user`/`unblock-user`, CA-4).
- **`make-admin`** (CA-4 de US-25): conceder el permiso `super_admin` a un
  usuario — esto es una escritura sobre `permission_user` que **CA-4 de
  ESTA US (US-21) no enumera** (solo lista crear-usuario,
  actualizar-hash, activar/desactivar). Es un hueco real entre lo que
  US-21 promete y lo que US-25 va a necesitar tres US después — ver Open
  Questions.

**El mock actual, leído para no reinventar el shape** (`apps/api/rest/src/
users/entities/user.entity.ts`, `profile.entity.ts`): `User extends
CoreEntity` (`id`, `created_at`, `updated_at`) + `name`, `email`,
`password?`, `profile?: Profile`, `shops?: Shop[]`, `is_active?`,
`permissions?: Permission[]`; `Permission extends CoreEntity` con `name?`,
`guard_name?`, `pivot?: any`. `auth.service.ts:154-156` hoy hace `me() {
return this.users[0]; }` — bug conocido y ya señalado en el explore de
US-20 (siempre devuelve admin, no el usuario del token), que US-22 debe
corregir resolviendo por id real, no por índice fijo.

## Affected Areas

- `packages/db/prisma/schema.prisma` — re-introspección (`prisma db pull`)
  + renombres manuales para `users`/`profiles`/`permissions`/
  `permission_user` (los otros dos, `password_reset_tokens`/`otp_codes`,
  quedan fuera del alcance de esta US salvo que el diseño decida
  introspeccionarlos igual por completitud del `db pull` — no tienen
  repositorio propio hasta US-24) y la relación `Shop.owner` que hoy no
  existe (`ownerId BigInt @default(1)` sin `@relation`).
- `packages/db/src/records.ts` — `UserRecord`, `ProfileRecord`,
  `PermissionRecord` + mappers `_toUserRecord`/`_toProfileRecord`/
  `_toPermissionRecord`. Primer record compuesto del paquete si CA-3 anida
  perfil/permisos/tiendas dentro de `UserRecord`.
- `packages/db/src/repositories/users.repository.ts` — nuevo.
- `packages/db/src/repositories/users.integration.test.ts` — nuevo, con el
  patrón de escritura-con-centinela de `products.integration.test.ts` como
  único precedente real.
- `packages/db/index.ts` — exports nuevos, siguiendo el orden alfabético
  por dominio ya usado.
- `packages/db/README.md` — sección de identidad; potencialmente también
  la sección de paginación (línea 74) si CA-5 cambia el contrato
  documentado ahí.
- **NO afectados** (confirmado, no solo asumido): `apps/api/rest/**`
  (ningún archivo de auth/users se toca), `services/scraper-worker/**`,
  `db/schema.sql`/`db/seed.sql` (ya cerrados por US-20), los frontends.

## Approaches

### A. Cómo cumplir CA-2 (`lower(email) = lower($1)`, el MUST literal de la spec)

1. **`$queryRaw` (o `Prisma.sql` tagged template) para `findUserCredentialsByEmail` y cualquier otro lookup por email.**
   - Pros: es la ÚNICA forma verificada que genera la SQL exacta que la
     spec exige y que usa `users_email_lower_idx`; consistente con el
     único otro uso de SQL crudo del paquete (`health.ts`, aunque ahí es
     trivial); no depende de una precondición de datos (funciona aunque
     alguien inserte un email en mayúsculas mañana).
   - Cons: primera vez que un repositorio de dominio usa SQL crudo (no
     solo el ping de salud); pierde el tipado automático de Prisma (hay
     que tipar el resultado a mano o mapear campo a campo); dos
     "lenguajes de consulta" conviven en el mismo repositorio si el resto
     de `users.repository.ts` usa el query builder normal.
   - Effort: Bajo — la query ya está probada arriba (candidato C) y
     conectada a `users` real solo cambia el nombre de tabla/columnas.

2. **Normalizar en JS (`email.toLowerCase()`) + `where: { email: lowered }` (Prisma `equals` plano).**
   - Pros: cero SQL crudo, mismo estilo que el resto del paquete; ya es
     correcto HOY porque los 3 emails sembrados están en minúscula.
   - Cons: **no usa el índice** (verificado con `EXPLAIN`, mismo resultado
     que `email = $1` sin normalizar — el candidato B de arriba); **no
     cumple la letra de la spec** (`lower(email) = lower($1)` explícito,
     no una normalización previa en la aplicación); depende de una
     precondición no garantizada por el esquema (`createUser` de CA-4
     tendría que normalizar también en escritura, y nada en la base lo
     fuerza si alguien lo olvida).
   - Effort: Bajo, pero resuelve menos de lo que la spec pide.

3. **`mode: 'insensitive'` de Prisma (ILIKE).**
   - Pros: ninguno relevante frente a las otras dos — es Prisma-nativo,
     pero no aporta nada que 2 no dé ya, y es peor en rendimiento (`ILIKE`
     sin índice de expresión coincidente escanea completo igual que un
     `=` sin índice, con el coste extra del pattern-matching).
   - Cons: genera `ILIKE` (verificado), que tampoco usa
     `users_email_lower_idx`; semánticamente es "contiene", no "igual",
     así que además sería una sobre-concesión funcional para un login
     (aceptaría coincidencias parciales si se usa `contains` en vez de
     `equals`, aunque con `equals + mode:'insensitive'` esa fuga concreta
     no aplica).
   - Effort: Bajo. **Descartable**: no gana nada sobre 2 y pierde exactitud
     de intención.

### B. Cómo resolver el contrato de paginación de CA-5

1. **`listUsers` devuelve `{ items, total }` crudo (como los 4 repositorios existentes), y el comentario de CA-5 sobre `buildPaginator` se entiende como "es el envoltorio que el CALLER debe usar", no como una llamada dentro del repositorio.**
   - Pros: cero divergencia del patrón unánime hoy (`listShops`,
     `listProducts`, `listManufacturers`, `listTags`); consistente con
     `packages/db/README.md:74`, que documenta esto como el contrato
     explícito del paquete.
   - Cons: la letra de CA-5 ("`listUsers` devuelve el envoltorio... con
     `buildPaginator`") queda técnicamente incumplida si se lee literal;
     habría que re-redactar o reinterpretar el criterio de aceptación en
     el proposal/design.
   - Effort: Bajo.

2. **`listUsers` sí llama a `buildPaginator` internamente y devuelve `Paginator<UserRecord>`, siendo el primer repositorio en hacerlo.**
   - Pros: cumple la letra literal de CA-5; y es, de hecho, la primera vez
     que `buildPaginator` tiene un consumidor de producción real (hoy
     tiene cero, según la evidencia de arriba) — podría verse como
     "por fin se usa para lo que se escribió".
   - Cons: introduce una inconsistencia nueva entre repositorios del mismo
     paquete (4 devuelven `{items,total}`, 1 devuelve `Paginator<T>`)
     justo cuando `packages/db/README.md` documenta lo contrario como
     regla; y sigue sin resolver que el ÚNICO consumidor de Nest ya
     migrado (`products.service.ts`) usa su propio `paginate()` en vez de
     `buildPaginator` — si `apps/api/rest` en US-25 decide usar
     `buildPaginator` (porque ahora lo trae `listUsers`) mientras
     `products`/`shops`/etc. lo siguen sin usar, el propio paquete queda
     con dos convenciones de paginación conviviendo en producción.
   - Effort: Bajo (mecánicamente trivial), pero es una decisión de
     consistencia, no de dificultad.

## Recommendation

No corresponde fijar un ganador aquí (fase de `sdd-design`), pero la
evidencia deja la decisión barata:

- **(A) la pregunta central**: los tres candidatos están probados con SQL
  real y `EXPLAIN` real, no con suposición. Solo `$queryRaw`
  (opción A.1) cumple el MUST literal de la spec Y usa el índice. La
  opción A.2 (normalizar en JS) es funcionalmente correcta HOY por una
  precondición de datos que nada en el esquema garantiza para mañana, y no
  usa el índice — es la opción de "menor blast radius" solo si se acepta
  relajar la letra de la spec; si se toma, debe ir acompañada de
  normalización también en `createUser` (CA-4) y de una nota explícita de
  que el MUST de la spec queda satisfecho por convención de aplicación, no
  por la forma de la query. No hay "política anti-`$queryRaw`" escrita en
  ningún sitio que bloquee A.1 — los dos precedentes que lo descartaron
  tenían alternativas Prisma-nativas viables; CA-2 no las tiene.
- **(B) el contrato de paginación**: la tensión es real y documentada
  (`README.md:74` contradice la letra de CA-5), no una lectura forzada.
  Cualquiera de las dos opciones es mecánicamente trivial; la que se elija
  determina si se re-redacta CA-5 o se acepta la primera divergencia del
  patrón de 4 repositorios existentes.

## Risks

- **CA-1 ("prisma validate no acusa drift") es más sutil de lo que parece.**
  `prisma validate` valida SINTAXIS del `.prisma`, no compara contra la
  base viva — ya pasa hoy (verificado arriba) aunque el schema no tenga
  las 6 tablas nuevas. El criterio real de "sin drift" tiene que ser: tras
  `db pull` + renombres manuales, un segundo `db pull --print` (o
  comparar el diff) no debería producir cambios adicionales una vez
  aplicados los `@map`/nombres — eso es lo que el diseño/tasks debe
  verificar con evidencia, no `prisma validate` a secas.
- **El hueco de `make-admin` (US-25) no está en la lista de escrituras de CA-4 de esta US.** Si el diseño no decide ahora si `users.repository.ts`
  expone una función genérica de asignación de permisos (o si US-25 la
  añade cuando le toque, como dice su propia fila de "Archivos a
  crear/modificar": *"`packages/db/src/repositories/users.repository.ts`
  | lo que falte para las listas por rol y `make-admin`"*), alguien podría
  asumir que CA-4 ya lo cubre y descubrir el hueco tarde. La propia US-25
  ya anticipa que volverá a tocar este archivo — no es una omisión de
  scope, es una US que se sabe incompleta a propósito y lo dice por
  escrito.
- **Ningún test hoy ejercita un modelo `User` en el cliente Prisma** (no
  existe todavía). La primera vez que `users.integration.test.ts` corra
  contra el cliente re-generado es también la primera vez que se descubre
  si los renombres manuales (`@map`, nombres de relación) quedaron
  correctos — no hay manera de adelantar esa verificación en esta fase de
  exploración de solo lectura.
- **El patrón de limpieza de tests de escritura tiene un precedente único** (`products.integration.test.ts`) y esa tabla no tiene un conteo exacto
  que otros tests reutilicen (`total).toBeGreaterThan(1000)`). `users` SÍ
  lo tiene (`total === 3` es un número que un test de listado querría
  fijar). Si el diseño no reutiliza el patrón de centinela +
  `beforeAll`/`afterAll` con cuidado, un test de `createUser` podría dejar
  filas huérfanas que rompan el conteo de otro test — igual que advierte
  el comentario original de `products.integration.test.ts:25-28`.

## Ready for Proposal

Sí, con dos decisiones explícitas que el proposal/design debe cerrar (no
bloquean redactar el proposal, pero si no se deciden ahí se descubren en
apply): (A) `$queryRaw` vs normalizar-en-JS para `findUserCredentialsByEmail`
— la evidencia empírica ya está, falta la decisión de producto sobre si
relajar la letra de la spec; (B) si `listUsers` devuelve `{items,total}` o
`Paginator<UserRecord>` — también con evidencia suficiente, falta decidir
si se prioriza la letra de CA-5 o la consistencia con los 4 repositorios
existentes y con `README.md:74`.

## Open questions / decisions needed

1. **`$queryRaw` vs. normalizar-en-JS para el lookup de credenciales
   (la pregunta central).** Evidencia: solo `$queryRaw` con
   `lower(email) = lower($1)` usa `users_email_lower_idx` Y cumple el MUST
   literal de la spec; normalizar en JS es correcto hoy por una
   precondición de datos no garantizada por el esquema. **Recomendación**:
   `$queryRaw` (o `Prisma.sql`) para `findUserCredentialsByEmail`
   específicamente — es una única función, aislada, con un contrato
   estrecho (CA-2 ya la separa como "la única que devuelve el hash"), así
   que el costo de introducir SQL crudo se paga una sola vez y en el punto
   exacto donde la spec lo exige. El resto de `users.repository.ts` (que
   no necesita la forma `lower(email)`, p. ej. `findUserById`) puede seguir
   con el query builder normal sin contradicción.

2. **Contrato de paginación de `listUsers` — `{items,total}` vs `Paginator<UserRecord>`.** Evidencia: precedente unánime + `README.md:74`
   documentan `{items,total}` + wrapping externo; CA-5 pide literalmente lo
   contrario; y el único consumidor real de Nest hoy (`products.service.ts`)
   ni siquiera usa `buildPaginator`, usa su propio `paginate()`.
   **Recomendación**: mantener `{items,total}` por consistencia del
   paquete y dejar que el futuro servicio de Nest de US-25 decida si por
   fin adopta `buildPaginator` (sería su primer consumidor real) — pero
   esto es una preferencia de consistencia, no una necesidad técnica; el
   dueño del repo puede preferir que US-21 sea la que finalmente le dé uso
   real a `buildPaginator` devolviendo el wrapper desde el repositorio.

3. **`ProfileRecord` anidado en `UserRecord` vs. función separada.** No
   hay precedente en el paquete (todos los records actuales son de una
   sola tabla). CA-3 pide "el usuario con su perfil, sus permisos y sus
   tiendas" para `/me`; CA-2 pide un `UserRecord` general sin el hash. Si
   `UserRecord` general ya anida `profile`/`permissions`/`shops` como
   opcionales, `findUserById` normal y el lector "completo" de CA-3 podrían
   ser la misma función con un flag, en vez de dos funciones. Sin
   evidencia de cuál prefiere el resto del paquete (no hay ningún caso
   similar), es una decisión de diseño libre.

4. **Lector "con relaciones" — función separada u option flag.** Ligado al
   punto 3. Precedente parcial: `shops.repository.ts` usa un objeto
   `COUNT_PRODUCTS` compartido entre `listShops`/`findShopBySlug` para no
   duplicar el `include`, pero ambas son funciones separadas, no una con
   flag. Aplicar el mismo patrón a identidad (un `include` compartido,
   funciones separadas para "usuario simple" y "usuario con relaciones")
   es lo más parecido a un precedente real.

5. **Filtrar `listUsers` por nombre/id de permiso.** El pivote
   `permission_user` no tiene columna propia además de las 2 FK — filtrar
   "usuarios con el permiso `store_owner`" implica un `where` con
   `permissions: { some: { name: 'store_owner' } }` (relación M:N vía
   Prisma) o un `permission_user: { some: { permission: { name: ... } } }`
   dependiendo de cómo quede modelada la relación tras la introspección.
   No hay urgencia de resolverlo aquí: es mecánico una vez que
   `schema.prisma` tenga los modelos, pero el nombre del filtro
   (`permissionName` vs `permissionId`) debe decidirse pensando en lo que
   US-25 va a pasar literalmente (`admin/list` filtra por nombre
   `super_admin`, no por id).

6. **Cómo expone `PermissionRecord` el `pivot` que `/me` necesita.** El
   `pivot` Laravel trae `model_id`, `permission_id`, `model_type`
   (constante, sin contraparte en este esquema con una sola tabla de
   identidad). `permission_user.created_at` sí existe en la tabla (D-6 de
   US-20) y podría ser la fecha real del `pivot`. Pregunta abierta: ¿el
   repositorio arma el objeto `pivot` completo (incluyendo el
   `model_type` constante) o solo expone `assignedAt` (el dato real,
   `permission_user.created_at`) y el servicio de Nest de US-22 arma el
   `pivot` Laravel completo con el literal hardcodeado? El explore de
   US-20 ya sugirió esto último para `model_type`; aplicarlo también a la
   forma completa del `pivot` mantendría la capa de datos libre de
   constantes de un ORM ajeno (Laravel) que no le pertenecen.
