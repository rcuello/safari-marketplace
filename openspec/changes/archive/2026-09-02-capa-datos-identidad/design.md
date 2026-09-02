# Design: Capa de datos de identidad en `@safari/db`

> US-21, Épico 19. Insumos: `proposal.md` y `explore.md`. Formato:
> `archive/2026-09-02-esquema-identidad-postgres/design.md` (US-20). **D-1, D-2 y D-3 del
> proposal son cerradas**: se arrastran tal cual. Todo comando, tipo de columna y código de
> salida citado abajo se ejecutó en esta sesión contra `safari-postgres` (`:5433`) en modo
> lectura, o sale del archivo citado.

## Technical Approach

Cuatro archivos y ni una línea fuera de `packages/db`, en este orden:

1. **`prisma/schema.prisma`** — `prisma db pull` + re-aplicación de renombres (Decision A). El
   criterio de éxito no es `prisma validate` sino `migrate diff --exit-code` en **0**
   (Decision B). Los 6 modelos entran; solo 4 tienen repositorio.
2. **`src/records.ts`** — `UserRecord`, `ProfileRecord`, `PermissionRecord` planos + sus tres
   mappers `_to*Record`, reutilizando `_id()` sin tocarlo (Decision D).
3. **`src/repositories/users.repository.ts`** — las 7 funciones del proposal: seis en Prisma
   tipado y una en `$queryRaw` (D-1). Los tipos compuestos y el error de dominio viven aquí, no
   en `records.ts`, calcando `ProductDetail`/`InvalidSalePriceError`.
4. **`src/repositories/users.integration.test.ts`** — fixture centinela con limpieza en ambos
   extremos (Decision C) y el test de mapeo que D-1 exige por saltarse los tipos generados.

Cierran `index.ts` y `README.md`. **Nadie llama todavía a este repositorio**: el radio de
explosión es el propio paquete.

## Data Flow

    US-22 login ──→ findUserCredentialsByEmail ─ $queryRaw lower(email)=lower($1)
                                                 → users_email_lower_idx
                                                 (ÚNICA salida de passwordHash)

    US-22 /me ─┬→ findUserWithRelations ─┐
    US-25 :id ─┘                         ├ Prisma tipado (USER_RELATIONS:
    US-25 listas → listUsers ────────────┤   profile · permissions[] · shops[])
    US-22 registro → createUser ─────────┤
    US-22/24 → updateUserPasswordHash ───┤
    US-25 block → setUserActive ─────────┘
                     └→ _toUserRecord()  ← choke point: aquí muere el hash
                          └→ UserRecord (camelCase, JSON-safe)
                               └→ Nest: snake_case + `pivot` (D-3 del épico)

El trigger `users_updated_at` (US-20, Decision A) mueve `updated_at` en cada `UPDATE`: el
repositorio **no** escribe `updatedAt` y el modelo no lleva `@updatedAt`.

## Architecture Decisions

### Decision A: el `db pull` se revisa con `git diff` entero, y los renombres están enumerados

**Choice**: `npx prisma db pull` sobre el archivo committeado y luego re-aplicar, guiándose por
el `git diff`, la lista completa de abajo. El archivo tiene hoy **9 modelos** (no 7: los 7
agregados más los pivotes `CategoryProduct` y `ProductTag`) y **24 líneas de cabecera** que
documentan lo que Prisma no modela.

| Qué debe sobrevivir al pull | Detalle |
|---|---|
| Cabecera de 24 líneas (`:1-24`) | se conserva y **se extiende**: `users_email_lower_idx` es el tercer índice de expresión que Prisma no modela |
| `previewFeatures = ["partialIndexes"]`, `output`, provider `prisma-client` | bloque `generator` (`:26-30`) |
| `datasource db` **sin `url`** (la resuelve `prisma.config.ts`, `:32-34`) | si el pull inyecta `url = env("DATABASE_URL")`, se quita |
| 9 nombres de modelo PascalCase + sus `@@map` | `Setting`…`ProductTag` |
| ~50 campos camelCase con `@map` | timestamps en 7 modelos; `ownerId`/`isActive`/`coverImage` (Shop); `parentId`/`typeId` (Category); `typeId`/`isApproved` (Manufacturer); `typeId` (Tag); las 21 de `Product`; `productId`/`categoryId`/`tagId` (pivotes) |
| `@relation("CategoryTree")` — la única relación nombrada | `Category.parent`/`children` |
| `@@unique`/`@@index` con `where: raw(...)` (índices parciales) y los 7 `map:` de índices | `Product`, `Category` |

**Renombres nuevos** (los 6 modelos): `users`→`User` (`password_hash`→`passwordHash`,
`is_active`→`isActive`, `email_verified_at`→`emailVerifiedAt`, + timestamps) ·
`profiles`→`Profile` (`user_id`→`userId`, que además es el `@id`) · `permissions`→`Permission`
(`guard_name`→`guardName`) · `permission_user`→`PermissionUser` (`userId`/`permissionId`,
`@@id([userId, permissionId])`) · `password_reset_tokens`→`PasswordResetToken` ·
`otp_codes`→`OtpCode`. Y `Shop` gana la relación que hoy no existe:
`owner User @relation(fields: [ownerId], references: [id], onDelete: Restrict, onUpdate: NoAction)`
— `Restrict` por la FK real (US-20 Decision B) y `onUpdate: NoAction` porque el DDL no declara
`ON UPDATE`, igual que las 11 FK existentes.

**Alternatives considered**: escribir los 6 modelos a mano sin `db pull` (lo prohíbe la nota de
la US); confiar en que la re-introspección preserve los renombres sola.

**Rationale**: `packages/db/README.md:98` deja escrito "**OJO: pisa los renombres manuales**" y
R-2 lo eleva a riesgo. El diseño no depende de qué haga exactamente esta versión de Prisma: la
lista de arriba convierte "revisar el diff" en checklist. Apply revisa
`git diff packages/db/prisma/schema.prisma` **completo**, no `--stat`.

**Consequences**: `users_email_lower_idx` (índice único **de expresión**) no aparecerá en el
schema — Prisma no puede representarlo, igual que `products_nombre_trgm_idx`. Consecuencia
directa: `User.email` **no** lleva `@unique`, y por eso el P2002 de email duplicado necesita
traducción propia (Decision H).

### Decision B: el gate de drift, con exit 0 ya demostrado sobre los modelos propuestos

**Choice**: el criterio de CA-1 es

```bash
cd packages/db && npx prisma migrate diff \
  --from-config-datasource --to-schema ./prisma/schema.prisma --exit-code   # meta: exit 0
```

`prisma validate` queda como gate de **sintaxis**, no de fidelidad.

**Alternatives considered**: `prisma validate` a secas (la letra de CA-1); un segundo
`db pull --print` comparado a mano; los flags `--from-schema-datamodel`/`--to-schema-datasource`
(no existen en Prisma 7.10).

**Rationale**: verificado hoy — con el schema actual el comando sale con **exit 2** y lista las
6 tablas ausentes más 5 FK (`profiles.user_id`, las dos de `permission_user`,
`password_reset_tokens.user_id`, `shops.owner_id`), mientras `prisma validate` sale **en verde**
sobre ese mismo archivo sin un solo modelo de identidad. Y **evidencia dura, no proyección**: en
esta sesión se escribió en el scratchpad una copia del schema con los 6 modelos y `Shop.owner`
tal como los describe Decision A, y `migrate diff` contra ella devolvió **`No difference
detected` / EXIT=0** (`prisma validate`, verde). La forma propuesta alcanza el objetivo, y
`migrate diff` **no ve** los índices de expresión (ni el trgm ni `users_email_lower_idx`): no
modelarlos no produce drift. Apply no lo descubre por ensayo y error.

**Consequences**: entran los 6 modelos, `PasswordResetToken` y `OtpCode` incluidos, ambos con un
comentario de dos líneas —*"modelo presente para que el gate de drift cierre; su repositorio
llega en US-24"*— sin el cual el siguiente lector asume un olvido. `PasswordResetToken` obliga
además a la inversa `User.passwordResetTokens`, con el mismo comentario.

### Decision C: aislamiento de tests por fixture centinela con dominio `.test`, y las escrituras NUNCA tocan a los 3 sembrados

**Choice**: un centinela en el **dominio del email** y limpieza en ambos extremos:

```ts
const TEST_DOMAIN = '@users-integration.test';   // RFC 2606: nunca será un usuario real
const cleanup = () => prisma.user.deleteMany({ where: { email: { endsWith: TEST_DOMAIN } } });
beforeAll(cleanup);                              // corrida abortada previa
afterAll(async () => { await cleanup(); await prisma.$disconnect(); });
```

Las tres escrituras operan **exclusivamente** sobre usuarios de ese dominio, con ids
autogenerados. Los asserts de `listUsers().total` sin filtro usan `toBeGreaterThanOrEqual(3)`;
los conteos exactos se obtienen filtrando por el centinela (`text: 'users-integration'`).
**Trampa a evitar**: la columna `email` es `text` y `endsWith` genera un `LIKE`
case-**sensitive**, así que el casing mezclado que exige el test de CA-2 (Decision H) va en la
**parte local**, nunca en el dominio (`Create-User@users-integration.test`); si no, la limpieza
no encuentra su propia fila.

**Alternatives considered**: (a) rollback transaccional; (b) rango de ids reservado; (c) escribir
sobre los 3 sembrados y restaurar el valor anterior.

**Rationale**: `$transaction` tiene **0 usos** en el paquete y los repositorios cierran sobre el
singleton `prisma` de módulo (`src/client.ts:39`, un Proxy global): enrutar los tests por una
transacción exigiría meter un parámetro de cliente en firmas de producción — coste alto por una
razón de test. (b) no tiene precedente: ningún repositorio escribe ids explícitos. (c) es la
peligrosa: `updateUserPasswordHash(3, …)` **destruiría la credencial `demodemo`** (decisión 7 del
épico, de la que depende la DoD de US-22) y un `setUserActive(3, false)` sin restaurar deja el
panel de admin inaccesible sin `just db-reset`. El precedente real es
`products.integration.test.ts:23-36` (centinela `TEST_STORE` + limpieza en `beforeAll` **y**
`afterAll`, con su comentario de por qué). **Y el centinela no puede colisionar** —lo concreto
que el proposal dejó abierto—: los 3 emails sembrados terminan en `@demo.com`, así que
`endsWith('@users-integration.test')` **no puede seleccionar ni una fila del seed**; la limpieza
es incapaz de borrar datos sembrados por construcción, no por cuidado, y `.test` es TLD
reservado.

**Paralelismo, leído de la configuración y no supuesto**: **no hay `vitest.config.ts`** (ni en
`packages/db` ni en la raíz), así que rigen los defaults de vitest 4.1.11 — `fileParallelism`
**`true`**, `pool` **`forks`** (leídos del bundle: `fileParallelism ??= … mode !== "benchmark"`,
`pool ??= "forks"`). Los 7 archivos corren en **procesos paralelos**, cada uno con su singleton.
(i) El archivo nuevo escribe `users` **mientras** los otros 6 leen, y ninguno de los 6 consulta
`users` ni directa ni indirectamente (`shops` se lee por `slug`/`name`/`settings`, nunca por
`owner_id`) → interferencia nula. (ii) Los `it()` de un mismo archivo son secuenciales
(`sequence.concurrent` es `false` y no se usa `it.concurrent`) → fixture determinista. Dos
corridas **simultáneas** de la suite sí colisionarían, igual que hoy con `TEST_STORE`: la postura
no cambia y se declara en el comentario del archivo.

**Consequences**: el usuario de prueba **nunca** recibe una tienda. `shops.owner_id` es
`RESTRICT`: un usuario de prueba que llegue a poseer una tienda no se puede borrar y el
`afterAll` fallaría dejando basura permanente. Las 4 FK hijas son `CASCADE` (verificado en
`\d users`), así que borrar el usuario de prueba se lleva su `profile` y sus filas de
`permission_user` sin listarlas.

### Decision D: records planos en `records.ts`; el compuesto vive en el repositorio (Open Question 1)

**Choice**: tres `interface` planas de una tabla cada una en `records.ts` —`UserRecord`
(**sin** `passwordHash`), `ProfileRecord`, `PermissionRecord`— y el compuesto
`UserWithRelations extends UserRecord { profile; permissions[]; shops[] }` declarado en
`users.repository.ts`.

**Alternatives considered**: `UserRecord` con `profile?`/`permissions?`/`shops?` opcionales (lo
que sugería el explore), o `ProfileRecord` anidado siempre.

**Rationale**: hay precedente, y son dos: `ProductDetail extends ProductRecord`
(`products.repository.ts:102`) y `ShopNearRecord extends ShopRecord` (`shops.repository.ts:83`),
ambos **fuera** de `records.ts`. La regla implícita: una tabla → un record en `records.ts`; una
composición → un tipo en el repositorio que la produce. Lo que `/me` publica (US-22 CA-4) trae
`profile`, `permissions[]` y `shops[]` siempre; un `profile?` opcional obligaría al servicio de
Nest a un `??` que no distingue "no lo pedí" de "no tiene perfil", mientras
`profile: ProfileRecord | null` es ausencia real.

**Consequences**: `ProfileRecord` se clave por `userId` (la tabla no tiene `id` propio, US-20
D-4). El mock publicaba `profile.id` y `profile.customer_id`, que no existen: US-22 puede emitir
`customer_id` desde `userId` y debe declarar `id` como divergencia — **hand-off**. `_id()` se
reutiliza para `User.id`, `Permission.id` y `Profile.userId`.

### Decision E: `findUserWithRelations` es función propia con un `include` compartido (Open Question 2)

**Choice**: dos funciones —`findUserById` (escalares) y `findUserWithRelations`— y una constante
`USER_RELATIONS` a nivel de módulo con el `include`, más `Prisma.UserGetPayload<{include: typeof
USER_RELATIONS}>` como tipo de fila.

**Alternatives considered**: una sola función con un flag `{ withRelations: true }`.

**Rationale**: es el patrón de `COUNT_PRODUCTS` (`shops.repository.ts:30-32`, compartido entre
`listShops` y `findShopBySlug`, **funciones separadas**) y de `PRODUCT_INCLUDE`
(`products.repository.ts:43-53`). **Ningún repositorio toma un flag de include hoy**:
`applyStorefrontDefaults` es de *filtro*, no de forma del resultado. Un flag que cambia el tipo
de retorno exige overloads o una unión que el llamador debe estrechar: coste de tipos por seis
líneas. Y los consumidores difieren — US-25 CA-3 quiere las relaciones, US-22 resuelve el `sub`
del token sin ellas.

**Consequences**: `USER_RELATIONS` = `{ profile: true, permissions: { include: { permission:
true } }, shops: true }`. `permissions` sale del pivote explícito, así que el mapper desdobla
`row.permissions.map((link) => _toPermissionRecord(link.permission))` — el mismo desdoblamiento
que `_toProductRecord` hace con `categories`/`tags` (`products.repository.ts:514-515`).

### Decision F: `listUsers` filtra por **nombre** de permiso (Open Question 3)

**Choice**: `ListUsersInput { page?, limit?, text?, permissionName? }`, con
`where.permissions = { some: { permission: { name: input.permissionName } } }`.

**Alternatives considered**: `permissionId?: number`; ambos.

**Rationale**: los 5 controladores de US-25 que comparten este listado (`admin/list`,
`vendors/list`, `customers/list`, `my-staffs`, `all-staffs`) discriminan por los cuatro valores
snake_case (`super_admin`, `customer`, `store_owner`, `staff`) que la decisión 4 del épico fija
como contrato y que `hasAccess()` compara en los dos frontends. Los ids (1..4) son artefactos
del seed —`bigserial` emitido con `ON CONFLICT (id) DO NOTHING`—: estables *hoy*, contrato de
nadie. Pasar nombres evita un mapa nombre→id en el servicio de Nest.

**Consequences**: el filtro entra por el índice inverso del pivote
(`permission_user_permiso_idx`, sembrado por US-20 para esto). `text` filtra
`OR: [name contains insensitive, email contains insensitive]` —forma unánime del paquete
(`shops.repository.ts:43`, `products.repository.ts:208`)— y **no** usa `users_email_lower_idx`:
ese índice sirve a la igualdad exacta de D-1, no a `ILIKE '%…%'`. Orden `id: 'asc'`, `limit`
default 30.

### Decision G: el `pivot` Laravel lo arma el servicio de Nest; el dato que necesita ya está (Open Question 4)

**Choice**: `PermissionRecord` = las 5 columnas de `permissions` (`id`, `name`, `guardName`,
`createdAt`, `updatedAt`). La capa de datos **no** arma el `pivot` y **no** expone
`permission_user.created_at`.

**Alternatives considered**: (a) el repositorio devuelve el `pivot` completo con el
`model_type` constante; (b) `UserPermissionRecord = PermissionRecord & { assignedAt: Date }`,
como recomendaba el proposal.

**Rationale**: la traducción de forma vive en el servicio de Nest (`settings.service.ts`, D-3 del
épico), así que (a) se descarta: la capa de datos no debe cargar
`"Marvel\\Database\\Models\\User"`. Y (b) **la evidencia la vuelve innecesaria**: el `pivot` real
del mock (`users.json`) tiene exactamente tres claves —`model_id`, `permission_id`,
`model_type`— y **ninguna es una fecha**. Con `UserWithRelations` el servicio ya tiene `user.id`
y `permission.id`, así que arma
`pivot: { model_id: user.id, permission_id: p.id, model_type: <constante> }` **sin una segunda
consulta**. `assignedAt` sería una abstracción no ganada: cero consumidores.

**Consequences**: divergencia declarada con la recomendación del proposal (que sugería exponer
`permission_user.created_at`); el motivo es dato observado, no preferencia. Si alguna vez hace
falta, `assignedAt` se añade al mapper en una línea: el `include` ya trae la fila del pivote.

### Decision H: `DuplicateEmailError` traducido del P2002; P2025 → `null`; el email se guarda tal cual

**Choice**: `createUser` envuelve el `create` en un `try/catch` que traduce **P2002** al error de
dominio exportado `DuplicateEmailError` y re-lanza lo demás;
`updateUserPasswordHash`/`setUserActive` traducen **P2025** a `null`. Los emails se persisten
**verbatim**, sin `toLowerCase()`.

**Alternatives considered**: (a) dejar subir el P2002 crudo y que Nest lo clasifique con
`isPrismaConstraintError`; (b) un `findUserCredentialsByEmail` previo como pre-chequeo;
(c) normalizar el email en escritura (lo que D-1 dejaba abierto).

**Rationale**: el patrón de errores de dominio de `products.repository.ts:419-466` existe para
**restricciones que Prisma no modela**, y este es ese caso: la unicidad de email vive en un
índice **de expresión** ausente del schema (Decision A). Verificado que identidad tiene **cero**
CHECK constraints, así que `InvalidSalePriceError` no tiene análogo — pero
`_translateCheckViolation` sí lo tiene **como forma** (catch-and-translate). (a) deja al llamador
un P2002 cuyo `meta.target` nombra un índice que el schema no declara, indistinguible de otra
violación de unicidad, y US-22 CA-3 pide un error de negocio explícito "no un 500 de Prisma".
(b) es TOCTOU y **arrastraría la única función que devuelve el hash a un camino de escritura**,
ensanchando la frontera D-2. (c) sobra: el `lower()` de D-1 está en los dos lados de la
comparación, y normalizar reescribiría en silencio un campo que el contrato HTTP devuelve.

**Composición con `errors.ts`**: no se solapa. `isPrismaConstraintError` agrupa P2002/P2003/P2025
sin distinguirlos, así que el repositorio comprueba el `code` directamente (como
`_translateCheckViolation` husmea el mensaje); `parsePrismaError`/`getUserFriendlyMessage` siguen
siendo el camino del servicio de Nest para todo lo demás.

**Consequences**: el test de CA-2 crea la fixture con la parte local **en mayúsculas mezcladas**
(`Create-User@users-integration.test`) y la busca en minúsculas — eso es lo que hace la prueba
discriminante: con los 3 emails sembrados ya en minúscula, buscar `ADMIN@Demo.com` solo prueba
el `lower()` del **argumento**; una fila almacenada en mayúsculas prueba también el de la
**columna**. El nested write de `createUser` (usuario + perfil + permisos) es atómico por
construcción —Prisma envuelve los nested writes en una transacción—, así que CA-4 no necesita
`$transaction` y el paquete mantiene sus 0 usos.

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/db/prisma/schema.prisma` | Modify | `db pull` + Decision A: 6 modelos nuevos, `Shop.owner`, cabecera extendida. Gate: `migrate diff` exit 0 |
| `packages/db/src/records.ts` | Modify | 3 `interface` + 3 mappers al final de sus secciones; `_id`/`_dec` **sin tocar** |
| `packages/db/src/repositories/users.repository.ts` | **Create** | 7 funciones, `USER_RELATIONS`, 4 tipos, `DuplicateEmailError` |
| `packages/db/src/repositories/users.integration.test.ts` | **Create** | Decision C + CA-2..CA-6 |
| `packages/db/index.ts` | Modify | bloque `users` **después** de `types.repository`: biome ordena por especificador y `npm run lint` falla si no |
| `packages/db/README.md` | Modify | sección de identidad tras "Lo que Prisma no modela": el agregado, la frontera D-2, por qué hay un `$queryRaw` y el tercer índice no modelado |
| `docs/product/19-.../{21-….md, README.md}` | Modify | status de la US y fila del épico |
| `apps/**`, `db/**`, `services/**`, `packages/db/package.json` | **Sin cambios** | el "NO incluye"; **cero dependencias nuevas** |

## Interfaces / Contracts

`users.repository.ts` — nombres, tipos y ubicación exactos:

```ts
// Tipos (este archivo, NO records.ts — la frontera de serialización no nombra el hash)
export interface UserCredentials { id: number; email: string; passwordHash: string; isActive: boolean }
export interface UserWithRelations extends UserRecord {
  profile: ProfileRecord | null; permissions: PermissionRecord[]; shops: ShopRecord[];
}
export interface ListUsersInput { page?: number; limit?: number; text?: string; permissionName?: string }
export interface CreateUserInput {
  name: string; email: string; passwordHash: string;
  isActive?: boolean; emailVerifiedAt?: Date | null;
  profile?: { avatar?; bio?; socials?; contact?; notifications? };  // jsonb -> InputJsonValue
  permissionNames?: string[];   // `connect: { name }` — permissions.name es UNIQUE
}
export class DuplicateEmailError extends Error { readonly code = 'USER_DUPLICATE_EMAIL' }

// Funciones
findUserCredentialsByEmail(email: string):            Promise<UserCredentials | null>  // la ÚNICA con hash
findUserById(id: number):                             Promise<UserRecord | null>
findUserWithRelations(id: number):                    Promise<UserWithRelations | null>
listUsers(input?: ListUsersInput):                    Promise<{ items: UserRecord[]; total: number }>
createUser(input: CreateUserInput):                   Promise<UserRecord>              // lanza DuplicateEmailError
updateUserPasswordHash(id: number, passwordHash: string): Promise<UserRecord | null>
setUserActive(id: number, isActive: boolean):         Promise<UserRecord | null>
```

`records.ts` añade, en la convención del archivo (tipos públicos sin prefijo, mappers con `_`):
`UserRecord { id, name, email, isActive, emailVerifiedAt: Date | null, createdAt, updatedAt }`
—**siete claves, ninguna es el hash**—, `ProfileRecord { userId, avatar, bio, socials, contact,
notifications, createdAt, updatedAt }` y `PermissionRecord { id, name, guardName, createdAt,
updatedAt }`, con `_toUserRecord(row: User)`, `_toProfileRecord`, `_toPermissionRecord`. Los
`bigint` salientes pasan por **`_id()`** (`records.ts:35-39`, `Number(value)` con overload para
`bigint | null`): única conversión de BigInt del paquete, no se inventa otra. Los `number`
entrantes se pasan tal cual a los campos `BigInt` de Prisma, como ya hace
`products.repository.ts:207` con `shopId`.

`index.ts` exporta los 3 `*Record` (en el bloque de `./src/records`), los 4 tipos y las 7
funciones + `DuplicateEmailError`. **No** exporta: los mappers `_to*` (ninguno se exporta hoy),
el tipo de fila cruda del `$queryRaw`, ni nada de `PasswordResetToken`/`OtpCode`.

### La consulta cruda (D-1), escrita

```ts
interface UserCredentialsRow {                        // fila cruda, snake_case, NO exportada
  id: bigint; email: string; password_hash: string; is_active: boolean;
}

export async function findUserCredentialsByEmail(email: string): Promise<UserCredentials | null> {
  // El ÚNICO SQL crudo de dominio del paquete (precedente: health.ts:21): ninguna API
  // tipada de Prisma genera `lower(col) = lower($1)`, y sin esa forma el planner no usa
  // users_email_lower_idx (EXPLAIN en explore.md). `${email}` es parámetro del tagged
  // template -> $1, NO concatenación: prohibido $queryRawUnsafe.
  const rows = await prisma.$queryRaw<UserCredentialsRow[]>`
    SELECT id, email, password_hash, is_active
      FROM users
     WHERE lower(email) = lower(${email})
     LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return { id: _id(row.id), email: row.email,
           passwordHash: row.password_hash, isActive: row.is_active };
}
```

**Tipos de la fila, verificados con una sonda real** (script de scratchpad contra `dist/`, un
`SELECT` de solo lectura por el mismo adapter): `id` llega como **`bigint`**, `is_active` como
`boolean`, `password_hash` como `string`, y `JSON.stringify(row)` **lanza** "Do not know how to
serialize a BigInt". `_id()` no es cosmético y la fila cruda **no es JSON-safe** — de ahí que el
mapeo a mano necesite su propio test (consecuencia de D-1). La misma sonda confirmó que
`'ADMIN@Demo.com'` devuelve la fila de `admin@demo.com`.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Schema | CA-1 | `migrate diff … --exit-code` = 0 + `prisma validate` (no es un test de vitest) |
| Lectura | CA-2, CA-3, CA-5 | Credenciales de `admin@demo.com` con casing mezclado; email inexistente → `null`; `findUserWithRelations(1)` → perfil + 2 permisos + **12** tiendas (verificado: el usuario 1 las posee todas); `listUsers({ permissionName: 'super_admin' })` → solo el usuario 3; `text` por nombre y por email |
| Mapeo crudo | consecuencia de D-1 | `typeof creds.id === 'number'`, `JSON.stringify` sin lanzar, las 4 claves camelCase |
| Frontera del hash | CA-6 | `Object.keys(user)` sin `passwordHash` **y** `not.toContain('$2')` sobre el JSON de `findUserById`, `findUserWithRelations` y `listUsers` — el prefijo bcrypt atrapa la fuga por relación anidada (R-4) que un `Object.keys` de primer nivel no vería |
| Escritura | CA-4 | Fixture centinela (Decision C): `createUser` con perfil + `['customer']`; repetirlo con otro casing → `DuplicateEmailError`; `updateUserPasswordHash` cambia el hash que ve `findUserCredentialsByEmail`; `setUserActive` false→true; los tres con id `999999` → `null` |
| No regresión | DoD | Los conteos de los otros 6 archivos no se mueven: nadie lee `users` |

## Verification Plan

Orden obligatorio; `cwd` con la unidad en **mayúscula** (ver R-5).

```bash
just db-up                                       # baseline de hoy: 6 archivos / 57 tests

# 1. CA-1 — tras el db pull y los renombres
cd packages/db
git diff prisma/schema.prisma                    # revisión COMPLETA (Decision A / R-2)
npx prisma validate                              # sintaxis
npx prisma migrate diff --from-config-datasource --to-schema ./prisma/schema.prisma --exit-code
echo "EXIT=$?"                                   # ← DEBE ser 0; hoy es 2
npm run generate                                 # el cliente gana prisma.user (hoy no existe)

# 2. Cierre — desde la raíz del repo
just db-build                                    # tsup: CJS + .d.ts sin errores
just db-check                                    # typecheck + vitest (`cd "$(pwd)"` normaliza la unidad)
#   ← pegar "Test Files N passed / Tests M passed" con N=7 y M>57. Si dice
#     "0 tests", es el casing del cwd (memoria), no la base.
grep -n "bcrypt" packages/db/package.json || echo "sin bcrypt: OK"   # D-2 del épico
docker exec safari-postgres psql -U safari -d safari_scraper -c \
  "SELECT (SELECT count(*) FROM users) u, (SELECT count(*) FROM profiles) p,
          (SELECT count(*) FROM permission_user) pu, (SELECT count(*) FROM shops) s;"
#   ← 3 | 3 | 6 | 12 ANTES y DESPUÉS de la suite (CA-4: la base queda igual)
```

DoD: el exit 0 del paso 1 cierra CA-1; el bloque de vitest, CA-2..CA-6 y el recuento;
`just db-build`, el build; el `grep`, la frontera. `npm run lint` no está en `db-check`:
correrlo aparte por el orden de exports de `index.ts`.

## Migration / Rollout

Ninguna: no hay DDL, datos, feature flag ni consumidor — `apps/api/rest` no importa nada de esto
hasta US-22.

**Rollback**: `git checkout packages/db` + `just db-build`. **No hay ningún cambio de base que
deshacer** —a diferencia de US-20, que exigía un segundo `just db-reset`. Si el revert ocurre
tras correr los tests, comprobar que no quedó ninguna fila del dominio centinela
(`SELECT count(*) FROM users WHERE email LIKE '%@users-integration.test'` → 0).

## Risks

| Riesgo | Prob. | Mitigación |
|---|---|---|
| **R-1**: los renombres/`@map` quedan mal; **ningún test ejercita hoy un modelo `User`** | Media | El gate de drift atrapa los `@map` mal escritos antes de compilar nada (y el exit 0 ya se demostró sobre la forma propuesta); la primera señal del cliente generado es `users.integration.test.ts`: ordenar las tasks para que corra temprano |
| **R-2**: `db pull` pisa los renombres de los 9 modelos del catálogo | Media | Decision A: checklist + `git diff` **entero**; `partialIndexes` no se quita; el `datasource` sigue sin `url` |
| **R-3**: una escritura deja filas y rompe el conteo `users = 3` | Media | Decision C + el `SELECT` de conteos antes/después |
| **R-4**: el hash se filtra por una relación anidada o un `select` olvidado | Baja | Frontera en las firmas (D-2), `UserCredentials` fuera de `records.ts`, assert `not.toContain('$2')` sobre el JSON completo |
| **R-5**: vitest reporta "0 tests" con la unidad en minúscula | Baja | El recuento pegado solo vale con `cwd` en `C:\…`; `just db-check` re-normaliza (`justfile:325-333`) |
| **R-6**: alguien "arregla" `PasswordResetToken`/`OtpCode` creyendo que les falta repositorio | Baja | Comentario declarado en ambos modelos (Decision B) |

## Hand-off (no accionar aquí)

1. **US-22**: el `pivot` se arma en el servicio con el `model_type` constante (Decision G);
   `profile` no tiene `id` ni `customer_id` propios — declarar la divergencia de key-set.
2. **US-25**: `grantPermission` para `make-admin` (D-3) y `buildPaginator` con su `baseUrl`
   (D-2: sigue sin consumidor de producción).
3. **Doc drift abierto desde US-20**: `22-login-jwt-postgres.md:122,153` cita
   `apps/api/rest/.env.template`; el real es `.env.example` (`justfile:59`).

## Open Questions

Ninguna. Las 4 del proposal quedan cerradas: records planos + compuesto en el repositorio (D) ·
función propia con `include` compartido (E) · filtro por `permissionName` (F) · el `pivot` lo arma
Nest, sin `assignedAt` (G) — esta última **contradice** la recomendación del proposal, porque el
`pivot` real del mock no lleva ninguna fecha.
