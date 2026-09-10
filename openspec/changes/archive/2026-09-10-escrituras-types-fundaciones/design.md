# Design: Escrituras de `types` y las piezas compartidas (US-27a)

## Technical Approach

Tres capas, ninguna nueva:

1. **`packages/db`** — dos módulos compartidos (`src/slug.ts`, `src/domain-errors.ts`)
   y tres funciones planas en el repositorio que ya tiene las lecturas
   (`types.repository.ts`, hoy 32 líneas), siguiendo el precedente obligatorio
   `upsertScrapedProduct` (`products.repository.ts:328-397`): validación de dominio
   ANTES de escribir (`:331-333`), `slug` intocable en update (`:382`), y traducción
   de la violación que llegue de Postgres a una clase de error de dominio
   (`_translateCheckViolation`, `:454-466`).
2. **`apps/api/rest/src/common/errors/`** — directorio nuevo (hoy `common/` solo tiene
   `common.module.ts`, `constants.ts`, `dto/`, `entities/`, `pagination/`, `search/`):
   una tabla `code → status` sobre el conjunto cerrado de la decisión 6 del épico.
3. **`types.service.ts`** — los 3 stubs (`:92-94`, `:104-106`, `:108-110`) proyectan el
   DTO campo a campo, llaman al repositorio y devuelven `toTypeDto` (`:39-51`) **tal
   cual**: la traducción camelCase → snake_case sigue viviendo en el servicio de Nest
   (`rules.design`), y no hay mapper nuevo (D-6 / `D27-5`).

Sin DDL: `db/schema.sql` y `db/seed.sql` son solo lectura y no se requiere `db-reset`.
`packages/db/prisma/schema.prisma` **no se toca**: el modelo `Type` (`:51-68`) ya trae
las 9 columnas, `slug @unique`, y `settings Json @default("{}")` / `banners Json
@default("[]")` — exactamente lo que las escrituras necesitan.

## Architecture Decisions

### Decisión 1 — `D27-2`: el slug lo calcula Postgres (Opción B)

**Choice.** `packages/db/src/slug.ts` normaliza con `SELECT slugify($1)` por tagged
template y resuelve la colisión con una segunda consulta tipada sobre la tabla del
agregado. El módulo expone **dos** funciones (ver *Interfaces*): `normalizeSlug(text,
aggregate)` —normaliza y lanza `EmptySlugError`— y `generateSlug(source, lookup,
aggregate)` —normaliza y resuelve colisión—. La separación no es cosmética:
`updateType` necesita la validación
de `name` **sin** recalcular el slug (Decisión 7).

**Rationale.**

- **El SQL crudo por tagged template ya es patrón establecido** en este paquete:
  `health.ts:21` (`$queryRaw\`SELECT 1\``) y `users.repository.ts:118-135`, que lo
  documenta como "el único SQL crudo de dominio" precisamente porque el API tipado no
  podía expresar `lower(email) = lower($1)`. Aquí pasa lo mismo: el API tipado no puede
  expresar `slugify()`. El texto viaja como parámetro `$1` del template, **nunca**
  concatenación; `$queryRawUnsafe` queda prohibido igual que allí (`:116`).
- **Coste real ≈ 0.** El slug es inmutable en update (decisión 4 del épico), así que
  los dos round-trips (`slugify` + colisión) se pagan **una vez por fila creada**, en
  una ruta `ADMIN_ONLY` de un panel de administración. Ninguna ruta de lectura los paga.
- **Mata R-3 de raíz** y no abre el primer caso de regla de negocio duplicada BD/TS del
  repo, coherente con `_translateCheckViolation`, que le pregunta a Postgres en vez de
  reimplementar el CHECK.

**Lo que habría costado la Opción A (TS).** Portar a mano la tabla fija de **48**
caracteres de `unaccent_simple` (`db/schema.sql:39-46` — 24 acentuados + 24 mayúsculas)
y el orden exacto `lower → [^a-z0-9]+ → -{2,} → trim(both '-')` (`:48-61`), con el test
comparativo contra la función SQL igualmente **obligatorio** (así que tampoco se
ahorraba tener Postgres arriba), y una segunda fuente de verdad que nadie recordará
sincronizar si el DDL cambia. Ganaba solo los dos round-trips que acabamos de mostrar
irrelevantes.

**No se usa transacción interactiva.** Combinar `slugify` + `INSERT` en una
`$transaction(async tx => …)` estrenaría en el paquete la forma callback (hoy solo
existe la forma array, `auth-tokens.repository.ts:129`) y no compraría nada: la unicidad
la garantiza el índice `types_slug_key`, no el aislamiento.

**Race y sufijo.** `generateSlug` trae de una sola consulta todos los slugs con el
prefijo calculado y busca el primer hueco **en memoria** (`base`, `base-2`, `base-3`, …),
acotado por `taken.size + 2`: es O(1) consultas, no un bucle de queries. Dos `POST`
concurrentes con el mismo nombre pueden calcular ambos `gadget-2`; uno inserta y el otro
recibe P2002. **El diseño tolera esa violación y la traduce a `SlugConflict` → 409; no la
previene.** Es aceptable porque (a) prevenirla exige lock de tabla o SERIALIZABLE con
reintento para un marketplace didáctico de un solo administrador; (b) 409 es la semántica
correcta y ya está en el conjunto cerrado — esta carrera es, de hecho, la única ruta real
de `SlugConflict` en `types`, no alcanzable de forma determinista por HTTP; (c) no es 500
ni pérdida de datos: el UNIQUE es la autoridad. El requirement "la colisión NUNCA es un
error" queda intacto para el caso determinista, que es el que especifica.

Nota de seguridad del `LIKE`: `startsWith(base)` genera `LIKE 'base%'` y `base` sale de
`slugify()`, o sea `[a-z0-9-]` — nunca contiene `%` ni `_`.

### Decisión 2 — `D27-13`: genéricas por firma, integradas solo con `types`

La tabla **no viaja como string**. `generateSlug` recibe una función de búsqueda; el
nombre de la tabla nunca llega al SQL, así que la inyección es **imposible por
construcción**, no por escapado:

```ts
// packages/db/src/slug.ts
export interface SlugSource { name: string; slug?: string | null }
export type ExistingSlugLookup = (prefix: string) => Promise<string[]>;
```

El call site del agregado (5 líneas, en **su** repositorio, no en el compartido):

```ts
// packages/db/src/repositories/types.repository.ts
const typeSlugs: ExistingSlugLookup = async (prefix) =>
  (await prisma.type.findMany({ where: { slug: { startsWith: prefix } }, select: { slug: true } }))
    .map((r) => r.slug);
```

Se descartó pasar el delegate de Prisma (`prisma.type`) tipado estructuralmente: la firma
genérica de `findMany` hace la asignabilidad frágil y obligaría a un cast en el
compartido. La función es más simple y no pierde tipado.

**Prohibido por construcción**, y `sdd-verify` debe rechazarlo: wrappers o adaptadores por
agregado, y cualquier `if (aggregate === …)` dentro de `slug.ts`, `domain-errors.ts` o
`domain-error.mapper.ts`. Añadir `tags` en US-27b debe ser exactamente: una constante como
la de arriba + un `catch` que llame a `translateCatalogWriteError` (Decisión 3) + un
`catch` que llame al mapeador HTTP. Su CA-7 exige `git diff` vacío en los tres archivos
compartidos.

### Decisión 3 — El contrato dominio → HTTP como tabla exhaustiva, con un solo traductor de Prisma

`packages/db/src/domain-errors.ts` (nuevo; `src/errors.ts`, 242 líneas de helpers de
Prisma que consumen 8 archivos de `src/`, **no se toca** — `D27-3`). Clases con `code` y
`name` propios, como `InvalidSalePriceError` (`products.repository.ts:419-427`), más una
base abstracta y un guard **estructural por `code`** (no `instanceof`: sobrevive a mocks
del barrel y a builds duplicados).

| Código del épico | Clase | `code` | Status | Productor en US-27a |
|---|---|---|---|---|
| `EmptySlug` | `EmptySlugError` | `CATALOG_EMPTY_SLUG` | **400** | `normalizeSlug` (antes de todo INSERT/UPDATE) |
| `InvalidReference` | `InvalidReferenceError` | `CATALOG_INVALID_REFERENCE` | **400** | ninguno — `types` no tiene FK saliente (primer productor: `tags.type_id`, US-27b) |
| `RecordNotFound` | `RecordNotFoundError` | `CATALOG_RECORD_NOT_FOUND` | **404** | `updateType` (P2025), `deleteType` (pre-lectura nula) |
| `DependentRows` | `DependentRowsError` | `CATALOG_DEPENDENT_ROWS` | **409** | `deleteType` |
| `SlugConflict` | `SlugConflictError` | `CATALOG_SLUG_CONFLICT` | **409** | `createType` (P2002 de carrera) |

Prefijo `CATALOG_` + SCREAMING_SNAKE por precedente (`PRODUCT_INVALID_SALE_PRICE`); los
tres errores de dominio ya existentes de `products` **no** están en el conjunto cerrado,
así que el guard los ignora y siguen cayendo a 500 exactamente como hoy (es problema de
US-29).

**Un único lugar que conoce los códigos de Prisma.** `isPrismaConstraintError`
(`errors.ts:83-88`) agrupa P2002/P2003/P2025 en un solo booleano y **no puede
discriminarlos**, así que no sirve. Para no repartir cinco `(error as {code?:string}).code`
por los cinco repositorios futuros, `domain-errors.ts` exporta el traductor:

```ts
export function translateCatalogWriteError(
  error: unknown,
  context: { aggregate: string; id?: number | string; uniqueField?: string }
): unknown;   // P2002 → SlugConflict · P2003 → InvalidReference · P2025 → RecordNotFound
```

Devuelve `unknown` y **el llamador lanza** — misma forma que `_translateCheckViolation`
(`products.repository.ts:454-466`), que también devuelve el error intacto si no reconoce
nada. `types.repository.ts` lo usa así: `catch (error) { throw
translateCatalogWriteError(error, { aggregate: 'types', id, uniqueField: 'slug' }); }`.
US-27b integra `tags` cambiando solo `aggregate` en **su** archivo: el `InvalidReference`
de `tags.type_id` (FK `ON DELETE SET NULL`, `db/schema.sql:302`) estrena su primer
productor real **con `git diff` vacío en el compartido**, que es literalmente la CA-7.

En la API, un único punto de traducción y un único call site por método:

```ts
// apps/api/rest/src/common/errors/domain-error.mapper.ts
export function mapDomainError(error: unknown): HttpException | null;   // tabla code → status
export function toWriteHttpException(error: unknown): HttpException;    // + 503 + 500
```

**La cadena de fallback, corregida.** `toWriteHttpException` **no** puede delegar el 503
en `isPrismaConnectionError`: ese helper devuelve `true` para **cualquier**
`PrismaClientKnownRequestError` (`errors.ts:62`), lo que incluye P2002/P2003/P2011/P2025.
Con él, un `NOT NULL` violado en `slug` (P2011) se reportaría como "servicio no
disponible". `errors.ts` está fuera de alcance (`D27-3`) y **no se modifica**; la
corrección vive dentro del mapeador nuevo, en este orden:

1. `mapDomainError(error)` — conjunto cerrado por `code` → 400/404/409.
2. `isConnectionFailure(error)` — predicado **local y privado** del mapeador:
   `name === 'PrismaClientInitializationError'`, o `code ∈ {P1001, P1002, P1008, P1011,
   P1017, P2024}`, o el `message` contiene `can't reach database server` /
   `connection refused` / `connection timeout` / `econnrefused`. **No** mira
   `PrismaClientKnownRequestError` por nombre → P2002 y compañía **no** entran. → 503 con
   `getUserFriendlyMessage(error)` (que ahí sí clasifica bien).
3. Cualquier otra cosa → **500** con un mensaje **literal** fijo
   (`'Ocurrió un error inesperado. Por favor, contacta al administrador.'`, el mismo texto
   que `getUserFriendlyMessage` da en su rama `default`). **No se llama a
   `getUserFriendlyMessage` aquí**: pasa por `parsePrismaError` →
   `isPrismaConnectionError` (`errors.ts:132`) y para un P2011 devolvería "No se puede
   conectar a la base de datos en localhost:5432" — el mismo defecto que acabamos de
   esquivar.

Con esto la rama 500 **sí** es alcanzable y el spec la prueba con un error de forma
Prisma real (ver *Testing Strategy*), no con `new Error('x')`.

El servicio escribe `catch (error) { throw toWriteHttpException(error); }` — una línea,
idéntica en los cinco agregados.

**Convivencia con los `isPrismaConnectionError` de las lecturas:** medidos hoy, **32
ocurrencias en 8 archivos de `src/`** (24 descontando los `import`; 38 en 11 archivos si
se cuentan los 3 `.spec.ts`). No se tocan (D-4 + alcance del épico). El 503 **no se
pierde** en las escrituras porque vive dentro de `toWriteHttpException`; simplemente deja
de estar copiado a mano. El refactor de las lecturas a esta función —que además
corregiría el mismo sobre-503 en las lecturas— es la mejora adyacente que el reporte debe
mencionar sin accionar.

### Decisión 4 — `deleteType`: dos conteos tipados, sin transacción

Secuencia: `findUnique(id)` → `null` ⇒ `RecordNotFoundError`; luego
`Promise.all([prisma.category.count({where:{typeId}}), prisma.product.count({where:{typeId}})])`;
si **cualquiera** > 0 ⇒ `DependentRowsError('types', { categories, products })` → 409; si no,
`prisma.type.delete` y se devuelve el `TypeRecord` de la pre-lectura.

- **Dos consultas, no una.** `$queryRaw` queda reservado para lo que el API tipado no puede
  expresar (`slugify`, `lower(email)`). Los dos `count()` van en paralelo, dan los dos
  números que el mensaje del 409 necesita, y un raw de snapshot único no compraría atomicidad
  porque el `DELETE` es otra sentencia de todos modos.
- **Sin transacción, y la ventana se declara.** Entre el conteo y el `DELETE` hay un TOCTOU:
  una categoría o producto insertado en esos milisegundos sí caería por CASCADE. Cerrarlo de
  verdad exige `SELECT … FOR UPDATE` sobre la fila de `types` (que sí choca con el `FOR KEY
  SHARE` del INSERT hijo) dentro de la primera transacción interactiva del paquete: patrón
  nuevo, no verificable dentro de esta US y que cuatro US heredarían. Se acepta como riesgo
  **bajo declarado** (dos acciones de admin concurrentes) y se anota en el reporte. La forma
  find-then-delete sin transacción es además el precedente vigente
  (`deleteScrapedProduct`, `products.repository.ts:400-413`).
- El `CASCADE` (`schema.sql:269` y `:331`) permanece como **red de integridad, nunca como
  comportamiento de la API**. Los dos FK `ON DELETE SET NULL` hacia `types` quedan como
  efecto de borde declarado (ver *Divergencias* 8).

### Decisión 5 — `jsonb NOT NULL DEFAULT`: la clave se omite, no se envía `null`

`CreateTypeInput` declara `settings?: Prisma.InputJsonValue` y `banners?:
Prisma.InputJsonValue`, y el `data` de Prisma se arma con el spread condicional que ya usa
`upsertScrapedProduct` (`:353-354`):

```ts
...(input.settings !== undefined && { settings: input.settings }),
...(input.banners  !== undefined && { banners:  input.banners  }),
```

Así la columna no aparece en el INSERT y aplica el `DEFAULT '{}'::jsonb` / `'[]'::jsonb`.
No es solo corrección: Prisma **rechaza en tipos** un `null` sobre un `Json` no nulable, de
modo que la omisión es la única forma tipada. Mismo tratamiento para `icon` (nullable, se
omite si no llega) y `language` (default `'es'`). `group-form.tsx:319` puede mandar
`banners: undefined` cuando no hay banners; `JSON.stringify` borra la clave, así que llega
ausente y el default aplica — el camino previsto.

**Trampa de tipos a documentar en el código:** `CreateTypeDto.settings` es la clase
`TypeSettings` y `banners` es `Banner[]` (`entities/type.entity.ts:9-11`). TypeScript **no**
deriva index signature implícita para clases, así que no son asignables a
`Prisma.InputJsonValue`. El servicio hace un cast explícito y comentado en el borde
(`dto.settings as unknown as Prisma.InputJsonValue`), mismo patrón de frontera que
`toTypeDto` (`types.service.ts:50`). **Prohibido `as any`** — es un cast en la frontera, no
una supresión de error. El tipo `Prisma` llega al servicio desde el propio barrel
(`packages/db/index.ts:1` exporta `export type { Prisma, PrismaClient }`): **no se añade
ningún import de `@prisma/client` en la API**, que D-1 prohíbe.

### Decisión 6 — `updatedAt` explícito, `slug` inmutable, `id` no numérico

- `updateType` fija `updatedAt: now()` desde `src/clock.ts` (mismo import que
  `upsertScrapedProduct`): `tocar_updated_at()` (`schema.sql:480-500`) cubre
  `products/categories/shops/users/profiles` y deja fuera a `types`; añadir el trigger es DDL.
  `createType` **no** fija fechas: las dos columnas tienen `DEFAULT now()`. La divergencia ya
  embarcada (`Date.toJSON()` con 3 decimales frente a los 6 de Laravel) no cambia.
  **El avance de `updated_at` no es observable por HTTP** (`toTypeDto` emite 9 claves sin
  timestamps): su evidencia es `psql`, como fijó la nota de contrato de la delta spec.
- El `slug` se calcula solo en `createType`, a partir del `slug` del cliente si llega no vacío
  y de `name` si no (decisión 4 del épico; `group-form.tsx:246` manda **siempre** `slug`,
  autosugerido por `formatSlug(watch('name'))` en `:241`). `updateType` **ignora** cualquier
  `slug` entrante —lo manda también en update (`:338-341`)— precedente
  `products.repository.ts:382`.
- El controlador pasa `+id` (`types.controller.ts:43,49`): `PUT /api/types/abc` daría `NaN` y
  un `BigInt(NaN)` que revienta en 500. El servicio añade la guarda ya embarcada
  `if (!Number.isInteger(id)) throw new NotFoundException(...)` (precedente exacto:
  `users.service.ts:94,113,142`), 2 líneas que sostienen el "nunca 500" de CA-4.

### Decisión 7 — `name` vacío: dos capas, ninguna de ellas `whitelist`

Hoy **nada** valida `name`: `main.ts:9` es `new ValidationPipe()` sin `whitelist` ni
`transform`, `Type` (`entities/type.entity.ts`) no tiene **ni un** decorador de
class-validator, y `apps/api/rest/tsconfig.json` no activa `strict` ni `strictNullChecks`,
así que un input tipado `{ name: string }` es ficción en compilación. `POST /api/types {}`
llegaría a `slugify(undefined)` —`slugify` es `STRICT` (`db/schema.sql:50`)— y produciría un
error de parámetro de Prisma, no un error de dominio: con la cadena vieja, **503**. La spec y
CA-4 exigen **400** para `POST` y `PUT` con `name` vacío o que slugifica a vacío.

**Capa 1 — DTO (produce el 400 del caso ausente/vacío).** `create-type.dto.ts` declara
`name` con `@IsString() @IsNotEmpty()` (class-validator 0.13.2 ya es dependencia,
`package.json:36`). `ValidationPipe` sin `whitelist` **igual corre los validadores** de los
campos declarados, así que `POST {}` y `POST {"name":""}` responden 400 antes de tocar el
servicio. `UpdateTypeDto` es `PartialType(CreateTypeDto)` de `@nestjs/mapped-types`
(`update-type.dto.ts:4`), cuya implementación (`dist/partial-type.helper.js`) hereda la
metadata de validación y aplica `applyIsOptionalDecorator` a **cada** clave con metadata:
`name` **ausente sigue siendo un no-op legal** en el `PUT` (la semántica `PartialType` no
cambia) y `name: ""` **sí** se valida → 400. Ese es exactamente el comportamiento que pide
B2/el spec.

**Justificación frente a la decisión 5 del épico** ("no hay 400 por campo desconocido;
`whitelist` cambiaría 250 rutas"): un `@IsNotEmpty()` sobre un campo **declarado** y
`whitelist: true` son ortogonales. `whitelist` es una opción **global del pipe** que recorta
o rechaza campos **no declarados** en las ~250 rutas; estos decoradores restringen `name` en
las **dos** rutas de escritura de `types` y solo para un payload que la decisión 6 del épico
ya manda rechazar con 400 ("nombre vacío"). `promotional_sliders` y cualquier otro campo
desconocido siguen entrando sin queja: el pipe **sigue sin** `whitelist`,
`forbidNonWhitelisted` ni `transform`.

**Capa 2 — repositorio (backstop, y la única que cubre `"!!!"`).** `normalizeSlug` valida
**antes de cualquier INSERT/UPDATE**:

- `typeof text !== 'string' || text.trim() === ''` ⇒ `EmptySlugError` **sin** ir a la base.
  Esta guarda de runtime es deliberada aunque el tipo diga `string`: sin `strictNullChecks`
  en la API, `undefined`/`null` cruzan la frontera sin que el compilador lo note. Cubre
  además el hueco de `@IsOptional()`, que **omite** la validación cuando el valor es `null`
  (no solo `undefined`): `PUT {"name": null}` pasa la capa 1 y muere aquí con 400.
- si no, `SELECT slugify($1)`; resultado `''` ⇒ `EmptySlugError`. Es lo único que atrapa
  `"!!!"`.

`createType` lo invoca vía `generateSlug`; `updateType` lo invoca **directamente y descarta
el resultado** cuando `input.name !== undefined` (un round-trip extra por `PUT`, en ruta de
admin), porque el slug es inmutable pero el `name` vacío debe ser 400. Consecuencia
deliberada: `updateType` tiene **dos** productores de error de dominio, `EmptySlugError` y
`RecordNotFoundError`. Las dos capas dan 400; ninguna da 503, y el 400 se mantiene aunque
la herencia de metadata de `PartialType` fallara en una futura versión.

### Decisión 8 — `CreateTypeDto` con `PickType` sobre la entidad

```ts
export class CreateTypeDto extends PickType(Type, [
  'name', 'slug', 'icon', 'banners', 'promotional_sliders', 'settings', 'language',
]) {
  @IsString()
  @IsNotEmpty()
  name: string;          // Decisión 7, capa 1
}
```

Patrón del repo (`create-tag.dto.ts:4-11` usa `PickType(Tag, [...])` de `@nestjs/swagger`, y
el plugin del CLI está activo en `nest-cli.json`). `promotional_sliders` se **declara y se
ignora**: no hay columna (`schema.sql:90-101`), y declararlo documenta que la API lo
**acepta** en vez de rechazarlo. `UpdateTypeDto` **no se toca**: hereda por `PartialType`.

### Decisión 9 — Limpieza de `types.service.ts`

Fuera: `typesJson` (`:19`), `Fuse` (`:20`), `plainToClass` (`:7`, queda huérfano),
`const types` / `options` / `fuse` (`:24-29`), `private types` (`:55`) y los muertos
`findAll`/`findOne` (`:96-102`) — confirmado en `types.controller.ts:18-51` que solo invoca
`create`, `getTypes`, `getTypeBySlug`, `update`, `remove`. Se quedan `parseSearch`,
`GetTypesDto` y `Type`. **`fuse.js` NO sale de `apps/api/rest/package.json`** (`:37`): lo
importan 21 archivos de `src/`, entre ellos `tags.service.ts` y `manufacturers.service.ts`,
que son de US-27b.

## Data Flow

```
POST /api/types      ADMIN_ONLY (types.controller.ts:22-26 — decoradores intactos)
   │ body snake_case (group-form.tsx:242-327)
   ▼
ValidationPipe (main.ts:9, sin whitelist)   name ausente/'' ⇒ 400  [Decisión 7, capa 1]
   ▼
TypesService.create()      proyecta campo a campo (R-5: nunca spread del body)
   │ CreateTypeInput camelCase
   ▼
createType()  @safari/db · types.repository.ts
   ├─ generateSlug({name, slug}, typeSlugs)          src/slug.ts
   │     ├─ normalizeSlug: guarda typeof/trim + SELECT slugify($1)
   │     │     '' ⇒ EmptySlugError                   antes de cualquier INSERT
   │     └─ findMany slug startsWith base            → primer hueco en memoria
   └─ prisma.type.create({...})
         catch ⇒ translateCatalogWriteError(e, {aggregate:'types', uniqueField:'slug'})
                    P2002 ⇒ SlugConflictError · P2003 ⇒ InvalidReferenceError
                    P2025 ⇒ RecordNotFoundError · resto ⇒ el error intacto
   ▼
TypeRecord camelCase (records.ts:63-73)
   ▼
toTypeDto()  types.service.ts:39-51                  el MISMO mapper del GET · 9 claves
   ▼
201 snake_case                catch ⇒ toWriteHttpException()   common/errors/
                                        ├─ code ∈ conjunto cerrado → 400 / 404 / 409
                                        ├─ isConnectionFailure (P1xxx/P2024/init) → 503
                                        └─ resto, P2002/P2011 incluidos → 500 (mensaje fijo)
```

`PUT` recorre el mismo camino salvo que `normalizeSlug` solo **valida** `name` y el `slug`
de la fila no se toca; `DELETE` devuelve el registro borrado por `toTypeDto` (9 claves).

## File Changes

Esta tabla es la **valla de alcance**: lo que no esté aquí es scope creep.

| Archivo | Acción | Descripción |
|---|---|---|
| `packages/db/src/slug.ts` | Create | `normalizeSlug` + `generateSlug` + `SlugSource` + `ExistingSlugLookup`; `SELECT slugify($1)` y sufijo incremental (~65 líneas) |
| `packages/db/src/slug.integration.test.ts` | Create | Tildes contra la función SQL, `slug` explícito, slug vacío, colisión con lookup en memoria (~75) |
| `packages/db/src/domain-errors.ts` | Create | Base abstracta, 5 clases, `CATALOG_ERROR_CODES`, guard estructural, `translateCatalogWriteError` (~95) |
| `packages/db/src/repositories/types.repository.ts` | Modify | `createType`/`updateType`/`deleteType` + los 2 inputs + `typeSlugs` (~115) |
| `packages/db/src/repositories/types.integration.test.ts` | Modify | Escrituras con centinela `zz-types-` + cleanup y conteo dentro del `afterAll` existente (~110) |
| `packages/db/index.ts` | Modify | Barrel: 3 funciones, 2 inputs, `normalizeSlug`/`generateSlug` + tipos, 5 errores + guard + traductor (~16) |
| `apps/api/rest/src/common/errors/domain-error.mapper.ts` | Create | `mapDomainError` (tabla `code → status`) + `isConnectionFailure` privado + `toWriteHttpException` (~70) |
| `apps/api/rest/src/common/errors/domain-error.mapper.spec.ts` | Create | Los 5 códigos + 503 + **500 con error de forma Prisma** (~85) |
| `apps/api/rest/src/types/types.service.ts` | Modify | 3 métodos migrados; fuera JSON, `Fuse`, `plainToClass`, `findAll`/`findOne` (~90 netas) |
| `apps/api/rest/src/types/dto/create-type.dto.ts` | Modify | `PickType(Type, [...7 campos])` + `@IsString() @IsNotEmpty() name` (~14) |
| `apps/api/rest/src/types/types.service.spec.ts` | Create | Jest con `@safari/db` mockeado (~145) |

**No se tocan:** `db/schema.sql`, `db/seed.sql`, `packages/db/prisma/schema.prisma`,
`packages/db/src/errors.ts`, `types.controller.ts`, `update-type.dto.ts`,
`type.entity.ts`, `main.ts`, `products.repository.ts`, `apps/shop/**`, `apps/admin/**`,
`apps/api/rest/package.json`, y todo lo de `tags`/`manufacturers`/`categories`/`products`/`shops`.

## Interfaces / Contracts

```ts
// packages/db/src/slug.ts
export async function normalizeSlug(text: string, aggregate: string): Promise<string>;
export async function generateSlug(
  source: SlugSource,
  findExistingWithPrefix: ExistingSlugLookup,
  aggregate: string
): Promise<string>;

// packages/db/src/domain-errors.ts — las 5 firmas quedan FIJADAS aquí (CA-7 de US-27b)
export const CATALOG_ERROR_CODES = { ... } as const;          // 5 códigos CATALOG_*
export type CatalogErrorCode = (typeof CATALOG_ERROR_CODES)[keyof typeof CATALOG_ERROR_CODES];
export abstract class CatalogWriteError extends Error {
  abstract readonly code: CatalogErrorCode;
  readonly aggregate: string;                                  // 'types' | 'tags' | …
}
export class EmptySlugError       extends CatalogWriteError { constructor(aggregate: string, source: string); }
export class InvalidReferenceError extends CatalogWriteError { constructor(aggregate: string, field: string, value?: string | number | null); }
export class RecordNotFoundError  extends CatalogWriteError { constructor(aggregate: string, id: number | string); }
export class DependentRowsError   extends CatalogWriteError { constructor(aggregate: string, counts: Record<string, number>); }
export class SlugConflictError    extends CatalogWriteError { constructor(aggregate: string, slug: string); }
export function isCatalogWriteError(error: unknown): error is CatalogWriteError;   // guard por `code`
export function translateCatalogWriteError(
  error: unknown,
  context: { aggregate: string; id?: number | string; uniqueField?: string }
): unknown;
```

Ninguna clase lleva texto de `types` en su mensaje: el agregado y el campo son
**parámetros**, y el mensaje se compone con ellos (p. ej. `No existe un registro de
\`${aggregate}\` con id ${id}.`). `InvalidReferenceError` recibe el `field` para que
US-27b pueda decir `type_id` sin editar el archivo; `translateCatalogWriteError` lo saca de
`meta.field_name` cuando P2003 lo trae. Es lo que hace que la CA-7 de US-27b sea
cumplible: el único archivo que conoce códigos de Prisma es el compartido, y está
**cerrado**.

```ts
// packages/db/src/repositories/types.repository.ts
export interface CreateTypeInput {
  name: string;
  slug?: string | null;                 // si llega no vacío, es la fuente del slug
  icon?: string | null;
  settings?: Prisma.InputJsonValue;     // ausente ⇒ DEFAULT '{}'  (nunca null)
  banners?: Prisma.InputJsonValue;      // ausente ⇒ DEFAULT '[]'  (nunca null)
  language?: string;                    // ausente ⇒ DEFAULT 'es'
}
export type UpdateTypeInput = Omit<CreateTypeInput, 'slug'>;  // el slug es inmutable

export function createType(input: CreateTypeInput): Promise<TypeRecord>;
export function updateType(id: number, input: UpdateTypeInput): Promise<TypeRecord>;
export function deleteType(id: number): Promise<TypeRecord>;  // el registro borrado
```

Los tres devuelven el `TypeRecord` que ya existe (`records.ts:63-73`) — sin tipo nuevo, para
que `toTypeDto` los alimente sin cambios. `updateType`/`deleteType` **lanzan**
`RecordNotFoundError` en vez de devolver `null`: así el 404 de `types` viaja por el mapeador
compartido, que es lo que asume el escenario "types solo ejercita tres códigos" de la spec.

Contrato HTTP: `POST` 201, `PUT`/`DELETE` 200, todos con las **9 claves de `toTypeDto` en su
orden** (`id, name, language, translated_languages, slug, banners, promotional_sliders,
settings, icon`) y **sin `updated_at`**. Los `GET` no cambian ni una línea (D-6).

## Testing Strategy

| Capa | Qué se prueba | Cómo |
|---|---|---|
| Integración (`slug.integration.test.ts`) | `"Café & Té"`, `"Acción!"`, `"Niño Grande"` **idénticos** a `SELECT slugify($1)`; **`{name:"Vertical X", slug:"vertical-custom"}` ⇒ `vertical-custom`** (el `slug` del cliente gana); `"!!!"` ⇒ `EmptySlugError`; `""`/`undefined` ⇒ `EmptySlugError` sin ir a la base; `gadget` ⇒ `gadget-2`, y con `gadget` + `gadget-2` ⇒ `gadget-3` | vitest + Postgres real **solo para `slugify()`**; el `ExistingSlugLookup` se inyecta **siempre** como array en memoria. **Este archivo no escribe ni lee la tabla `types`** |
| Integración (`types.integration.test.ts`) | `createType` persiste y devuelve el `Record`; `updateType` cambia `name` y **no** el slug, con `updatedAt` fijado por `_setNowProvider` (restaurado en `afterEach`); `updateType` con `name:""` ⇒ `EmptySlugError` y la fila intacta; `deleteType(9)` ⇒ `DependentRowsError` **y los dos `count()` intactos**; `deleteType` de un centinela sin dependientes ⇒ 1 fila menos; id inexistente ⇒ `RecordNotFoundError`; **`prisma.type.count()` ⇒ 10** al cerrar | Centinela `zz-types-` en `name`/`slug` (`D27-8`); `cleanup = deleteMany({where:{slug:{startsWith:'zz-types-'}}})` en `beforeAll` **y dentro del `afterAll` que ya existe** (`:11-13`), antes del `$disconnect` y en `try/finally` (precedente `users.integration.test.ts:37-42`, que ya compone `cleanup()` + `$disconnect()` en un solo hook) |
| Unit (`domain-error.mapper.spec.ts`) | Los **5** códigos → 400/400/404/409/409; **`{name:'PrismaClientKnownRequestError', code:'P2011'}` → 500** (y assert de caracterización: `isPrismaConnectionError` de `@safari/db` devuelve `true` para ese mismo objeto — es el defecto que el mapeador NO hereda); `{name:'PrismaClientKnownRequestError', code:'P1001'}` y `{name:'PrismaClientInitializationError'}` → 503; `new Error('x')` → 500 | Jest sin `jest.mock`: importa el barrel real, seguro sin `DATABASE_URL` por el Proxy lazy (`client.ts:39-45`). Los errores de Prisma se construyen **estructuralmente** (`name` + `code` + `message`), no con `new PrismaClientKnownRequestError`: D-1 prohíbe importar `@prisma/client` en la API y el predicado es estructural, así que la fixture es fiel |
| Unit (`types.service.spec.ts`) | El input que recibe el repositorio omite `settings`/`banners` ausentes e ignora `promotional_sliders`; `Object.keys()` de `create`/`update`/`remove` **igual** al de `getTypeBySlug` (sin `.sort()`); `EmptySlug`→400, `RecordNotFound`→404, `DependentRows`→409, `{code:'P1001'}`→503, `{code:'P2011'}`→500; `+id` no entero → 404 sin llamar al repositorio | `jest.mock('@safari/db', () => ({...jest.requireActual(...), createType: jest.fn(), …}))`, arnés exacto de `products.service.spec.ts:36-43` |

Los cinco códigos se prueban **directamente en el spec del mapeador**, no por HTTP:
`InvalidReference` no tiene productor en `types` y `SlugConflict` solo aparece en la carrera.
Contadores base que deben seguir verdes: `just db-check` **8 archivos / 91 tests** → 9 / 91+N;
`npx jest` **4 suites / 65 tests** → 6 / 65+N. Ningún test de lectura cambia.

**Aislamiento en la base compartida.** `types.integration.test.ts:18` ya asserta
`toHaveLength(10)` sobre `listTypes()` sin filtro. `packages/db` **no tiene
`vitest.config.*`**, así que los archivos corren en paralelo: cualquier otro archivo que
escriba en `types` haría intermitente ese assert (R-4). Por eso `slug.integration.test.ts`
**no toca la tabla** (lookup en memoria) y `types.integration.test.ts` sigue siendo el único
archivo que escribe en `types` — verificado: los únicos `prisma.type.*` de `packages/db/src`
están en `types.repository.ts:24,30`, ambos de lectura. Regla para US-27b/28/29/30:
**prefijo centinela distinto por archivo** (`zz-tags-`, `zz-manu-`, …), nunca uno común.
Poner el `cleanup` y el conteo de cierre **dentro** del `afterAll` que ya existe evita
depender del orden LIFO de hooks (`sequence.hooks: 'stack'` es el default de vitest): si se
registraran en un `afterAll` aparte y en el orden equivocado, correrían sobre un cliente ya
desconectado.

## Migration / Rollout

Sin migración de datos ni DDL. **Secuencia obligatoria de verificación, en este orden:**

1. `just db-up` (Postgres 16 sembrado, puerto 5433).
2. **`just db-build` — BLOQUEANTE.** `packages/db/dist` está gitignored y Nest consume el
   paquete por `link:` (`apps/api/rest/package.json:32`). Saltarse este paso verifica el
   código viejo: la API arranca en verde con los stubs y el resultado es un **falso
   negativo**. Cualquier reverificación tras editar `packages/db` repite este paso.
3. `just db-check` (typecheck + vitest) — cierra el PR#1 por sí solo.
4. `cd apps/api/rest && npx jest` con recuento.
5. `just api-dev` y la secuencia de la DoD: `POST` → `GET` → **reinicio de la API** → `GET`
   → `PUT` → `GET` → `DELETE` → `GET` 404, con el diff de `Object.keys()` hecho con
   `node -e` (**`jq` no está instalado**) y **sin `.sort()`**. La evidencia de CA-2 para
   `updated_at` es `psql` (`SELECT id, slug, updated_at FROM types WHERE id = :id` antes y
   después del `PUT`), **no `curl`**: la respuesta no lleva timestamps y añadírselos
   rompería la CA-1 de la propia Requirement (nota de contrato de la delta spec).
6. `curl` de CA-3 (409 en `DELETE /api/types/9` + `psql` de los dos conteos antes/después),
   CA-4 (404; 400 con `{}`, con `{"name":""}` y con `{"name":"!!!"}`; 400 en
   `PUT {"name":""}` con `psql` mostrando la fila intacta; `gadget` → `gadget-2`) y CA-5
   (401 / 403 `customer` / 403 `store_owner`).
7. `just build-api` y `just verify`.
8. **Limpieza de datos que `git` no deshace, y que ES autocontenida.** El paso 6 crea una
   fila `name "Gadget"` / `slug "gadget-2"` que **no** empieza por el centinela, y
   `db-up`/`db-migrate` no la borran (`seed.sql` es `ON CONFLICT (id) DO NOTHING`). Sin
   limpiarla, `types` queda en 11 filas y el siguiente `just db-check` rompe el
   `toHaveLength(10)`. La limpieza correcta va **por id**, no por slug:

   ```sql
   -- el seed llega a id 11 (10 filas: los ids 1-9 y 11; seed.sql:31 y :1718)
   DELETE FROM types WHERE id > 11;
   SELECT setval('types_id_seq', 11);   -- opcional: ids reproducibles en la próxima evidencia
   SELECT count(*) FROM types;          -- debe volver a 10
   ```

   Es seguro porque ninguna fila sembrada tiene id > 11 y nada más escribe en `types` (el
   scraper no la toca). **No se requiere `just db-reset`** en ningún punto (decisión 1 del
   épico). Los tests automáticos siguen limpiando por centinela, que es más preciso.

**Entrega — se confirma la cadena de dos PRs** del proposal, con una corrección de tamaño:

- **PR#1 — `packages/db` (~475, ±60; el proposal decía ~395).** `slug.ts`,
  `slug.integration.test.ts`, `domain-errors.ts`, repositorio, tests de integración, barrel.
  **Verificable con `just db-check` solo** y **verde por sí mismo**: la API no se toca y los
  exports son puramente aditivos, así que revertir solo `apps/api/rest` deja exactamente este
  estado. Queda ~19 % por encima del presupuesto de 400 líneas; el corte natural es
  **PR#1a** (`slug.ts` + `domain-errors.ts` + barrel + `slug.integration.test.ts`, ~250) y
  **PR#1b** (repositorio + `types.integration.test.ts`, ~225). Los dos son independientemente
  verificables **precisamente porque `slug.integration.test.ts` ya no escribe en `types`**
  (aislamiento de la sección anterior): PR#1a pasa `just db-check` sin que exista ninguna
  función de escritura. Decisión final de `sdd-tasks` bajo `ask-on-risk`.
- **PR#2 — API (~340).** `common/errors/`, servicio, DTO, spec de jest. Produce los `curl`
  de la DoD, `just build-api` y `just verify`.

`Decision needed before apply: Yes` · `Chained PRs recommended: Yes` ·
`400-line budget risk: High`

## Divergencias y correcciones de hechos

1. **`D27-7` parte de un hecho falso.** `types.integration.test.ts:18` **sí** tiene un assert
   de conteo total: `expect(rows).toHaveLength(10)`. La exploración buscó `toBe(10)` y
   concluyó que no existía. R-4 ya tiene red automática para `types`. El diseño **cumple igual
   el requirement** de la delta spec añadiendo un assert **nuevo y distinto**: un
   `prisma.type.count()` a nivel de tabla al cerrar la suite, independiente de `listTypes` y
   por tanto sensible a basura que un filtro por `name` no vería.
2. **El admin consume `data.slug` del `PUT /types/:id`** (`apps/admin/rest/src/data/type.ts:52-56`
   redirige a `…/${data?.slug}/edit`), no solo el de productos como decía la decisión 3 del
   épico. No cambia nada — `toTypeDto` emite `slug` — pero eleva `D27-5` de conveniencia a
   requisito funcional.
3. **No hay blocker de secuencia.** `db/seed.sql:1718` hace
   `setval('types_id_seq', GREATEST(max(id), 1))` = 11, así que el primer `createType` recibe
   id 12. Sin ese `setval`, el primer INSERT habría chocado con la PK y se habría
   diagnosticado como bug del repositorio.
4. **Desviación de nombre de archivo declarada:** la tabla de la US pide
   `packages/db/src/slug.test.ts`; con la Opción B el test necesita Postgres, así que se llama
   `slug.integration.test.ts`, la convención del paquete para tests que exigen base.
5. **Desviación literal de firma declarada:** la spec de `catalog-write-foundations` y
   `D27-13` dicen que el helper "recibe la tabla/agregado como parámetro". Recibe **una
   función de búsqueda** (`ExistingSlugLookup`) más el `aggregate` como **etiqueta para el
   mensaje de error** — el nombre de la tabla **nunca** llega al SQL. Es estrictamente más
   seguro que pasar un identificador (inyección imposible por construcción) y cumple el
   propósito de la Requirement, "genérico por firma, sin una variante por catálogo". Se
   declara para que una lectura literal de `sdd-verify` no lo marque.
6. **Centinela y limpieza, desviación declarada frente al proposal.** `D27-8` y el plan de
   rollback dicen `zz-test-`; el diseño usa **`zz-types-`** (un prefijo por archivo, para que
   los centinelas de US-27b/28/29/30 no se pisen en paralelo) y, para la limpieza **manual**
   de la DoD, un `DELETE … WHERE id > 11` en vez del `LIKE`, porque la fila `gadget-2` de
   CA-4 no lleva centinela (rollout, paso 8).
7. **`icon` no se puede vaciar por `PUT`.** `group-form.tsx:247` envía `icon:
   values.icon?.value`, o sea `undefined` cuando el admin borra el icono; `JSON.stringify` lo
   elimina y Prisma trata la ausencia como "no tocar". Limpiar un icono es imposible por la
   API sin distinguir ausente de `null`, lo que exigiría cambiar el formulario (decisión 14
   del épico: prohibido). Se declara; no se acciona.
8. **`deleteType` tiene dos efectos de borde no requeridos.** `manufacturers.type_id`
   (`db/schema.sql:288`) y `tags.type_id` (`:302`) son `ON DELETE SET NULL`: un borrado con
   200 deja a esas filas sin `type_id`, en silencio. La spec y la decisión 7 del épico solo
   nombran `categories`/`products`, así que **no** se cuentan para el 409 (hacerlo cambiaría
   el comportamiento especificado), pero son observables por `psql` y afectan dos agregados
   que US-27b está a punto de tomar. Se declara aquí.
9. **Ya embarcadas / sin cambio:** `promotional_sliders` aceptado e ignorado (sin columna);
   `created_at`/`updated_at` con 3 decimales; `translated_languages` constante `['en']` y
   `promotional_sliders: null` en la respuesta (V-8/V-9).
10. **Adyacentes mencionados, no accionados:** refactor de los 32 `isPrismaConnectionError`
   de las lecturas a `toWriteHttpException` (que además corregiría el sobre-503 descrito en
   la Decisión 3); `create-tag.dto.ts:6` declarando `type` en vez de `type_id` (US-27b);
   trigger `updated_at` para `types` (DDL, épico siguiente).

## Correcciones del gate (re-run 2026-09-09)

| # | Resolución |
|---|---|
| **B1** | Decisión 3: cadena reescrita con `isConnectionFailure` **local** al mapeador (init-error, `P1001/P1002/P1008/P1011/P1017/P2024`, patrones de mensaje) que **no** mira `PrismaClientKnownRequestError`; el 500 usa mensaje literal en vez de `getUserFriendlyMessage`, que hereda el mismo defecto. `errors.ts` intacto. El spec asserta 500 con `{name:'PrismaClientKnownRequestError', code:'P2011'}` + assert de caracterización sobre el helper viejo. El Data Flow ya dice "resto, P2002/P2011 incluidos → 500" |
| **B2** | Decisión 7: capa 1 (`@IsNotEmpty()` + `IsOptional` heredado por `PartialType` → `name` ausente sigue siendo no-op legal, `""` = 400) y capa 2 (`updateType` llama a `normalizeSlug` cuando `name` está presente, **antes** del UPDATE; atrapa además `"!!!"` y `null`). `updateType` pasa a tener dos productores: `EmptySlug` y `RecordNotFound` |
| **B3** | Decisión 7 fija los dos guardas de runtime y su ubicación, y justifica los decoradores frente a la decisión 5 del épico (declarado vs. desconocido; 2 rutas vs. ~250; la decisión 6 ya exige 400 por nombre vacío). No se toca `main.ts` ni `type.entity.ts` |
| **B4** | El caso de colisión inyecta el `ExistingSlugLookup` **en memoria**: `slug.integration.test.ts` no escribe ni lee `types`. La premisa "único archivo que toca `types`" vuelve a ser verdadera y está verificada (los únicos `prisma.type.*` del paquete son `types.repository.ts:24,30`, de lectura). Añadida la regla de centinela distinto por archivo |
| **B5** | Paso 8 del rollout: limpieza **por id** (`DELETE FROM types WHERE id > 11` + `count(*)` de comprobación, `setval` opcional), justificada con `seed.sql:31` y `:1718`. Autocontenida y sin `db-reset` |
| **B6** | Absorbido. Decisión 6 y el paso 5 del rollout dicen que la evidencia de CA-2 es `psql`, no `curl`; el contrato HTTP declara "9 claves, **sin `updated_at`**" |
| **B7** | *Interfaces* fija **las cinco** firmas con `aggregate`/`field`/`id` como parámetros (ningún mensaje con texto de `types`) y **adopta** `translateCatalogWriteError(error, {aggregate, id, uniqueField})` como único lugar que conoce códigos de Prisma; `isPrismaConstraintError` se descarta por escrito (agrupa P2002/P2003/P2025, no discrimina) |

No bloqueantes: **N1** snippet resuelto (el tagged template ya no imprime `${source}`
sobre un objeto); **N2** en Divergencias 8; **N3** conteo corregido a 32/8 archivos (24 sin
imports; 38/11 con specs); **N4** 48 caracteres; **N5** `cleanup` + conteo **dentro** del
`afterAll` existente (el orden LIFO deja de ser load-bearing) + prefijos distintos por
archivo; **N6** el escenario del `slug` explícito ya tiene test nombrado; **N7** en
Divergencias 5; **N8** en Divergencias 7; **N9** en Decisión 5 (`Prisma` viaja por
`index.ts:1`); **N10** citas corregidas (`records.ts:63-73`, `db/schema.sql:39-46`).
Presupuesto: el sub-corte PR#1a/PR#1b se mantiene y su independencia depende de B4, ya
resuelto.

## Open Questions

- [ ] Ninguna que bloquee. La única decisión abierta (`D27-2`) queda cerrada en la Decisión 1;
      el TOCTOU de `deleteType`, la carrera del sufijo y los dos `SET NULL` de la
      Divergencia 8 se declaran como riesgos bajos aceptados, no como preguntas.
