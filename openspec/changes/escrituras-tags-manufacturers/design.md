# Design: Escrituras de `tags` y `manufacturers` (US-27b)

> **Este design NO inventa arquitectura.** US-27a ya embarcó el patrón y corre
> en producción; los commits de implementación son **`530e713`** (slug + errores
> de dominio), **`3c59b0d`** (repositorio), **`829f510`** (capa API) y
> **`4304bc5`** (fix `C-1` del 503). `8797caa` es solo el commit de **archivo**
> del change. Aquí el patrón se replica sobre dos agregados más.
> El valor de este documento está en (a) los **call sites exactos**, (b) los
> **puntos donde `tags`/`manufacturers` difieren de `types`** —FK real, sin
> borrado protegido, `is_approved`, campos sin columna— y (c) **pre-emptar las
> trampas** que el gate de US-27a encontró (B1-B7, N1-N10) y los hallazgos
> `C-1`/`S-1` de su verify.
>
> Decisiones vinculantes que este design **no reabre**: épico 26 (1-15,
> `D-1..D-6`), `D27b-1` y `D27b-7` (cerradas), y los 7 requirements de los dos
> delta specs de este change.

## Technical Approach

Tres capas, ninguna nueva. Plantillas literales entre paréntesis:

1. **`packages/db`** (`types.repository.ts:58-182`) — las 6 funciones planas en
   el **mismo archivo** que las lecturas (`D-2`), con inputs camelCase tipados
   campo a campo, `generateSlug(source, xSlugs, aggregate)` en create,
   `normalizeSlug` en update, `updatedAt: now()` explícito y
   `catch (error) { throw translateCatalogWriteError(error, {...}) }`.
2. **`apps/api/rest`** (`types.service.ts:96-161`) — los 6 métodos proyectan el
   DTO campo a campo al input, reutilizan los mappers existentes (`toTagDto` 9
   claves, `toManufacturerDto` 13) y cierran con
   `catch (error) { throw toWriteHttpException(error); }`.
3. **DTOs** (`create-type.dto.ts:18-29`) — declaran los campos que el admin
   envía de verdad (decisión 15) y validan `name`.

**Piezas compartidas consumidas sin una sola edición** (`CA-7`): `slug.ts`,
`domain-errors.ts`, `common/errors/**`. Las firmas se leyeron en el archivo
real; ninguna necesita cambio. Si `sdd-apply` encuentra un caso que fuerce una
edición, **para y pregunta** — rompería US-28/29/30.

## Diferencias reales frente a `types` (lo que un revisor confundiría)

| # | `types` (US-27a) | `tags` / `manufacturers` (US-27b) |
|---|---|---|
| 1 | `deleteType` cuenta dependientes y puede dar **409** | **No hay 409 en ninguna ruta de esta US.** `tags.type_id`/`manufacturers.type_id` son `SET NULL` (`schema.sql:302`, `:288`), `products.manufacturer_id` es `SET NULL` (`:333`) y `product_tag.tag_id` es `CASCADE` **hacia `tags`** (`:433`). Postgres borra las filas pivote; **el repositorio NO borra `product_tag` a mano** (el instinto ingenuo). Único error de borrado: `RecordNotFoundError` → 404 |
| 2 | Sin FK saliente ⇒ `InvalidReference` **inalcanzable** por HTTP | `type_id` es FK real ⇒ **primer productor real de P2003 → 400** (delta `catalog-write-foundations`, `CA-7`) |
| 3 | `settings`/`banners` son `jsonb NOT NULL DEFAULT` | `image` es `jsonb` **nullable** en ambas tablas; `details`/`icon`/`description`/`website` son `text` nullable |
| 4 | Sin coerción de tipos en el mapper | `is_approved` sale como `Number(record.isApproved)` (`manufacturers.service.ts:60`) y **entra** como `Boolean(...)` |
| 5 | `type` embebido: no aplica | Los dos mappers resuelven `type` desde un `Map<number, TypeRecord>` construido con `listTypes()` (`tags.service.ts:47,96`; `manufacturers.service.ts:52,110`) — las escrituras necesitan ese `Map` |
| 6 | `types.integration.test.ts` asserta `toHaveLength(10)`, insensible al orden | `tags.integration.test.ts:19-20` asserta `items[0].id === 62` con `orderBy id desc` ⇒ **cualquier tag centinela vivo pone rojo ese assert** (ver `DD-8`) |

## Architecture Decisions

### DD-1 — Los inputs son campo a campo, con el `slug` fuera del update por tipo

**Choice.** Cuatro interfaces nuevas, ninguna derivada del body:

```ts
// tags.repository.ts
export interface CreateTagInput {
  name: string;
  slug?: string | null;      // fuente del slug si llega no vacío (decisión 4 del épico)
  details?: string | null;
  icon?: string | null;
  image?: Prisma.InputJsonValue;   // sin `| null` — ver DD-5
  typeId?: number | null;          // FK; `null` limpia la referencia
  language?: string;               // ausente ⇒ DEFAULT 'es'
}
// `Partial<>` para que `name` ausente sea legal en PUT (DD-9) y para que el
// tipo diga lo que la regla B-4 exige: TODO campo del update es opcional.
export type UpdateTagInput = Partial<Omit<CreateTagInput, 'slug'>>;

// manufacturers.repository.ts
export interface CreateManufacturerInput {
  name: string;
  slug?: string | null;
  description?: string | null;
  website?: string | null;
  image?: Prisma.InputJsonValue;
  typeId?: number | null;
  isApproved?: boolean;            // ausente ⇒ DEFAULT true
}
export type UpdateManufacturerInput = Partial<
  Omit<CreateManufacturerInput, 'slug'>
>;
```

**Alternativas rechazadas.** Spread del DTO a Prisma (`R-5`/`R27b-5`: `socials`,
`cover_image`, `shop_id` y `language` de manufacturers llegan sin columna ⇒
500); un **camino dedicado** de partial update (un segundo par de funciones o
una rama `if (isPartial)`): innecesario, porque todos los campos salvo `name`
ya son opcionales y el spread condicional **es** el mecanismo de partial
update.

**Rationale — REGLA NORMATIVA (corregida tras el gate, B-4).** El toggle de
aprobación **ES un payload parcial**: `manufacturer-list.tsx:134-142` envía
**5** claves (`{id, name, is_approved, type_id, language}`), no las **10**
editables de `manufacturer-form.tsx:184-218` (añade `slug`, `description`,
`website`, `socials`, `image`, `cover_image`). La versión anterior de este
design decía "envía el registro editable completo", heredado de la US y de
`exploration.md`: era **falso**, y la US ya está corregida. De ahí la regla,
**MUST**, para los 6 métodos:

> **Una clave ausente del DTO NO debe llegar al `data` de
> `prisma.{tag,manufacturer}.update` (ni de `.create`).** Jamás se proyecta
> "ausente → `null`".

Mecanismo: inputs **todos opcionales** + spread condicional
`...(input.x !== undefined && { x: input.x })`, en las **dos** capas (servicio
sobre el DTO, repositorio sobre el input). El spread preserva "ausente"
(columna intacta en update, `DEFAULT` en create) vs "presente con `null`"
(limpia la columna, `DD-5`; el jsonb tipo `image`/`socials` nunca recibe
`null`). Proyectar las 10 columnas sin condición **borraría `description`,
`website` e `image` en cada clic del toggle**: pérdida silenciosa de datos en la
ruta exacta que `CA-2` existe para arreglar.

`Partial<Omit<...,'slug'>>` hace la inmutabilidad del slug **y** la opcionalidad
total del update garantías del **tipo**, no convenciones
(`types.repository.ts:80`). `Prisma` viaja **type-only** desde el
barrel (`packages/db/index.ts:1`); la API nunca importa `@prisma/client`
(`D-1`).

### DD-2 — `type_id`: coerción en el servicio, guarda de dominio en el repositorio, P2003 en el `catch`

**Choice.** Tres capas, cada una con un caso distinto:

| Entrada | Dónde se atrapa | Resultado |
|---|---|---|
| `type_id` ausente | spread condicional del servicio | no viaja al repositorio (no-op) |
| `type_id: null` | pasa tal cual | `typeId: null` → FK vacía (legal, columna nullable) |
| `type_id: "abc"` / `NaN` / no entero | **repositorio**: `if (input.typeId != null && !Number.isInteger(input.typeId)) throw new InvalidReferenceError(aggregate, 'type_id', input.typeId)` | 400 con el campo **correcto**, sin tocar Postgres |
| `type_id: 99999` (bien formado, inexistente) | Postgres → P2003 → `translateCatalogWriteError` | 400 (`InvalidReference`); **el texto del mensaje es empírico** — ver `DD-3` |

El servicio coerciona porque `Manufacturer.type_id` está declarado
`?: string` en la entidad (`manufacturer.entity.ts:16`, inconsistencia
preexistente que **no se corrige aquí**) y `ValidationPipe` corre **sin**
`transform` (`main.ts:9`):
`...(dto.type_id !== undefined && { typeId: dto.type_id === null ? null : Number(dto.type_id) })`.

**Alternativa rechazada:** pre-validar la existencia del `type_id` con un
`prisma.type.count()` antes del INSERT. Daría un mensaje siempre correcto, pero
(a) añade una query por escritura, (b) abre un TOCTOU nuevo, (c) cambia el
productor del 400 y (d) **no está autorizada** por la propuesta, que enmarca el
P2003 como observación empírica (`D27b-8`), no como cambio de código. Si
`sdd-apply` la implementa, está saliéndose del design.

### DD-3 — El mensaje del 400 de `InvalidReference` se **observa**; el único remedio pre-autorizado es el `context` del call site

**Choice.** Los seis call sites pasan
`translateCatalogWriteError(error, { aggregate, id, uniqueField: 'slug' })`,
idéntico a `types.repository.ts:103-106,141-145,176-180` (fidelidad de
plantilla). `sdd-apply` MUST ejecutar `POST /api/tags {"name":"...","type_id":99999}`
y **registrar el mensaje literal** del 400.

**Rationale + remedio.** `domain-errors.ts:150-156` resuelve el campo del P2003
como `meta?.field_name ?? context.uniqueField ?? 'desconocida'`. Si Prisma 7 +
`@prisma/adapter-pg` no trae `field_name`, el mensaje sale
`` `tags.slug` referencia un registro inexistente `` — semánticamente **falso**
(el campo violado es `type_id`). Es el hallazgo `S-1` del verify de US-27a y no
es deducible por lectura (runtime minificado).

Si el mensaje resulta engañoso, el remedio **pre-autorizado y compatible con
`CA-7`** es **omitir `uniqueField` en el `context`** de ese call site: la rama
P2002 ya cae a `'slug'` **hardcodeado** como último recurso
(`domain-errors.ts:146`), así que el conflicto de slug sigue diciendo `slug`, y
la rama P2003 pasa a decir `'desconocida'` — **vago pero nunca falso**. Es un
cambio de **una línea en el repositorio del agregado**, cero bytes en archivos
compartidos. MUST declararse como divergencia. Editar `domain-errors.ts`
**rompe `CA-7`: parar y preguntar**.

**Literales exactos del remedio** (`domain-errors.ts:53-63,140-156`), para que
nadie se sorprenda al leer la evidencia. Omitiendo `uniqueField` del `context`:

```
P2003 →  `tags.desconocida` referencia un registro inexistente.
P2002 →  Ya existe un registro de `tags` con el slug `slug`.
         ← sigue nombrando `slug` por el fallback HARDCODEADO de
           domain-errors.ts:146; omitir `uniqueField` NO lo degrada
```

El constructor de `InvalidReferenceError` solo añade el `` (`valor`) `` final si
se le pasa `value`, y `translateCatalogWriteError` no lo pasa: el mensaje del
P2003 termina en punto, sin el `99999`.

### DD-4 — El mapeador de errores se consume **tal cual**; el `catch` es una línea

**Choice.** `domain-error.mapper.ts` y su spec quedan con `git diff` vacío. Los
6 métodos cierran con `catch (error) { throw toWriteHttpException(error); }`.

**Rationale.** El mapeador ya trae el fix `C-1`: `CONNECTION_FAILURE_CODES`
(`:53-65`) incluye los códigos de socket del driver (`ECONNREFUSED`,
`ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `EHOSTUNREACH`) además de
`P1xxx`/`P2024`, porque con `@prisma/adapter-pg` una base caída **no** llega
como `P1001`. La rama 503 está viva: no hay nada que hacer.
`isPrismaConnectionError` **no** se usa en el camino de escritura (defecto B1:
devuelve `true` para cualquier `PrismaClientKnownRequestError`, P2011 incluido).

**Consecuencia declarada:** los métodos de **lectura** de ambos servicios siguen
con la cadena vieja (`isPrismaConnectionError`) — es el límite de alcance `D-4`
y el hallazgo `S-6`. **No se refactoriza** (~26 sitios, adyacente).

### DD-5 — Nulos: los `text` nullable se limpian con `null`; `image` (jsonb) sigue el precedente de `upsertScrapedProduct`

**Choice.** `details`, `icon`, `description`, `website`, `typeId` aceptan `null`
y **limpian** la columna (verificado en runtime para `types.icon`: hallazgo
`S-2`). `image` se declara `image?: Prisma.InputJsonValue` **sin `| null`**:
`image: null` en el body se trata como **ausente** (no se envía) y la columna
queda intacta.

**Alternativa rechazada:** soportar `image: null` mapeándolo a `Prisma.DbNull`.
Exigiría un import **de valor** del cliente generado y, para llegar a la API,
exportar el namespace `Prisma` como valor desde el barrel (hoy es
`export type`, `index.ts:1`) — superficie pública nueva que heredarían
US-28/29/30 por un caso que ningún formulario del admin ejercita.

**Rationale.** Precedente exacto en el paquete:
`products.repository.ts:166,353` declara `image?: Prisma.InputJsonValue` y
trata la ausencia como "no tocar". Se declara como divergencia (ver tabla).

### DD-6 — `is_approved`: `Boolean()` a la entrada (servicio), `Number()` a la salida (mapper)

**Choice.** El repositorio solo conoce `boolean`. El servicio hace
`...(dto.is_approved !== undefined && { isApproved: Boolean(dto.is_approved) })`
y `toManufacturerDto` sigue emitiendo `Number(record.isApproved)`
(`manufacturers.service.ts:60`, **intacta**).

**Rationale.** Sin `transform` en `ValidationPipe`, un cliente puede mandar
`1`/`0`; Prisma exige un `boolean` real en un campo `Boolean` y un `1` daría
500. La coerción de salida ya es contrato del `GET` (`is_approved: 1|0`) y no
puede moverse al repositorio sin romper `ManufacturerRecord.isApproved:
boolean`. `undefined` NO se coerciona a `false`: se omite, y la columna aplica
`DEFAULT true` en create / queda intacta en update.

**Límite declarado de `Boolean()` (N-2).** `Boolean("false") === true`: sin
`transform`, sin `whitelist` y sin `@IsBoolean()`, la **cadena** `"false"`
aprobaría la marca en silencio. **Decisión: `@IsOptional() @IsBoolean()` sobre
`is_approved` en `CreateManufacturerDto`** ⇒ la cadena da **400**.
`@IsOptional()` es obligatorio: sin él, `POST {"name":"X"}` fallaría (el campo
es legítimamente omitible, `DEFAULT true`) y rompería `CA-1`. `Boolean()` se
conserva en el servicio como red de seguridad de tipos. Ningún `CA` dependía de
esto: el admin siempre manda un booleano real.

### DD-7 — El `type` embebido de la respuesta de escritura: **un** `listTypes()`, secuencial y después de la escritura

**Choice.** Dentro del `try` de cada uno de los 6 métodos:

```ts
const record = await createTag({ ... });      // 1º la escritura
const types = await listTypes();              // 2º el catálogo, una sola vez
return toTagDto(record, new Map(types.map((t) => [t.id, t])));
```

**Alternativa rechazada:** `Promise.all([createTag(...), listTypes()])`, que es
el patrón de las **lecturas** (`tags.service.ts:88`). En paralelo, si la
escritura rechaza con un error de dominio y `listTypes()` rechaza por conexión,
`Promise.all` propaga **el primero que rechace**: un 400 determinista podría
salir como 503 y `CA-4` dejaría de ser reproducible.

**Rationale.** `D-6` prohíbe mappers nuevos y una consulta puntual por id: el
`Map` se construye como ya lo hacen las lecturas. Secuencial garantiza que el
error del `catch` sea el de la escritura y evita la query en el camino de error.
**Riesgo declarado (bajo):** si `listTypes()` falla tras un INSERT exitoso, la
fila existe y el cliente recibe 5xx — misma forma no transaccional que
`findOne` (`tags.service.ts:114-115`), aceptada.

### DD-8 — Tests de integración: centinela por archivo, escrituras **al final del archivo**, limpieza plegada en el `afterAll` existente

**Choice.** Cuatro reglas, todas obligatorias:

1. **Centinela distinto por archivo**: `zz-tags-` y `zz-manu-`. Nunca uno
   compartido. **Motivo corregido (N-4):** un `deleteMany` acotado a
   `prisma.tag` no puede tocar `manufacturers`, así que un prefijo compartido
   *no* pondría rojo el conteo del hermano. La razón real es el **paralelismo
   entre US**: `packages/db` **no tiene `vitest.config.*`** (verificado: solo
   `biome.json`, `tsconfig.json`, `tsup.config.ts`, `prisma.config.ts`), los
   archivos corren en paralelo, y US-28/29/30 añadirán escrituras con esta
   misma plantilla. Un prefijo genérico (`zz-test-`, como sugería la US) invita
   a que dos suites de US distintas se limpien la basura mutuamente a mitad de
   corrida; el prefijo por agregado lo hace **imposible por construcción**.

   **Corolario MUST (B-2): los asserts de la suite son POR FILA, nunca
   globales.** Hay un tercer escritor ya en el repo:
   `products.integration.test.ts:198-237` mantiene viva durante **todo** su
   archivo una fixture creada con
   `upsertScrapedProduct({ …, manufacturerId, tagIds:[…] })`, borrada solo en su
   `afterAll` (`:33-36`) ⇒ mientras corre, `prisma.product.count()` es **1201**
   y `prisma.productTag.count()` es **1**. Por tanto el desenlace se asserta
   acotado —`prisma.productTag.count({ where: { tagId: sentinelId } })` → **0**
   y `(await prisma.product.findUnique({ where: { id: probeId } })).manufacturerId`
   → **null**— y un `productTag.count()` global dentro de la suite es un
   **defecto**: pondría rojo un test ajeno a esta US. Los globales
   (`products` → 1200, `product_tag` → 0) son **solo** del `psql` manual.
   Tranquilizador: esa fixture elige por `orderBy: { id: 'asc' }, take: 2` ⇒ ids
   **1,2** y **53,54**; nunca choca con un centinela (≥ 21 / ≥ 63).
2. `beforeAll(cleanup)` + **cleanup plegado dentro del `afterAll` que ya
   existe**, en `try/finally`:
   `afterAll(async () => { try { await cleanup(); } finally { await prisma.$disconnect(); } })`.
   **No se registra un segundo `afterAll`**: el default de vitest es
   `sequence.hooks: 'stack'` (LIFO), así que un hook añadido aparte correría
   contra un cliente ya desconectado (N5). Patrón real:
   `types.integration.test.ts:23-34`.
3. **Cada test borra lo que crea** (decisión 13 del épico), y los `describe` de
   escritura se **añaden al final del archivo**, después de los de lectura.
   Esto es específico de `tags`: `tags.integration.test.ts:19-20` asserta
   `items[0].id === 62` sobre un `orderBy: { id: 'desc' }` sin filtro, así que
   un tag centinela vivo (id > 62) lo pone rojo. Vitest ejecuta los tests de un
   archivo en orden de declaración, de modo que el orden es la garantía.

   **El orden es invisible ⇒ MUST llevar comentario en el archivo**, encima del
   primer `describe` de escritura (redacción libre, contenido obligatorio): *no
   insertar tests de LECTURA por debajo de esta línea, porque `listTags`
   asserta `items[0].id === 62` sobre `orderBy id desc` sin filtro y cualquier
   centinela vivo lo pone rojo*. Sin él, quien añada una lectura encima del
   bloque rompe `tags.integration.test.ts:19` sin aviso y con un síntoma que no
   apunta a la causa.
4. **Assert de cierre como último `it` del archivo**: `prisma.tag.count()`
   → **10**, `prisma.manufacturer.count()` → **14** (patrón
   `types.integration.test.ts:181-185`). Estos dos conteos **sí** son globales y
   **sí** son seguros: `products.integration.test.ts` no crea ni borra filas de
   `tags` ni de `manufacturers` (solo las lee).

### DD-9 — Los DTOs declaran los campos reales y validan `name` en **dos** capas

**Choice.**

```ts
// create-tag.dto.ts — `type` fuera, `type_id` standalone (D27b-1, cerrada),
// `slug` añadido al PickType. `tag.entity.ts` NO se toca.
export class CreateTagDto extends PickType(Tag, [
  'name', 'slug', 'details', 'image', 'icon', 'language',
]) {
  @IsString() @IsNotEmpty() name: string;
  type_id?: number;
}
```

```ts
// create-manufacturer.dto.ts — deja de omitir name, description, website,
// image, type_id, socials, cover_image y slug. Sigue omitiendo id,
// products_count, type, translated_languages, y AÑADE created_at/updated_at
// a la lista (N-9). `shop_id` se conserva.
export class CreateManufacturerDto extends OmitType(Manufacturer, [
  'id', 'created_at', 'updated_at',
  'products_count', 'type', 'translated_languages',
]) {
  @IsString() @IsNotEmpty() name: string;
  @IsOptional() @IsBoolean() is_approved?: boolean;   // DD-6 / N-2
  shop_id?: string;
}
```

**Nota `created_at`/`updated_at` (N-9).** `Manufacturer extends CoreEntity`
(`core.entity.ts:4-9`) y el `OmitType` actual solo quita `id`, así que el schema
del **request body** documenta dos timestamps que fija el servidor. La decisión
15 del épico enmarca los DTOs como *la documentación Swagger* ⇒ se omiten.
`CreateTagDto` usa `PickType` y no arrastra el problema.

**Capa 1 (DTO).** `@IsString() @IsNotEmpty()` sobre `name` hace que
`POST {}` y `POST {"name":""}` respondan **400 antes de tocar el servicio**.
Hoy ninguno de los dos DTO tiene un solo decorador de class-validator, así que
sin esta capa un `POST {}` llegaría al repositorio con `name: undefined` y
`normalizeSlug` daría 400 o —peor— un error no clasificado daría 503/500. `name`
**ausente** en `PUT` sigue siendo un no-op legal: `PartialType` aplica
`@IsOptional()`, que solo salta la validación con `null`/`undefined`; `""` sigue
dando 400. Precedente literal: `create-type.dto.ts:10-16,27-29`.

**Mecanismo real de `PartialType` (N-1).** La conclusión se mantiene, pero el
mecanismo no es el que se citó: `update-tag.dto.ts:1` y
`update-manufacturer.dto.ts:1` importan `PartialType` de **`@nestjs/swagger`**,
no de `@nestjs/mapped-types`. Deriva los campos de los *model properties* de
Swagger y solo funciona porque `nest-cli.json` activa
`"plugins": ["@nestjs/swagger"]`, que emite `_OPENAPI_METADATA_FACTORY` en el
compilado (comprobado en `dist/tags/entities/tag.entity.js`).

> **Consecuencia normativa:** el plugin de swagger **NO corre bajo `ts-jest`**
> —el bloque `jest` de `apps/api/rest/package.json` tiene `transform:
> { "^.+\\.(t|j)s$": "ts-jest" }` y **ningún `astTransformers`**—, así que
> **ningún spec de jest MUST assertar comportamiento del `ValidationPipe`**.
> La evidencia de `PUT {}` / `POST {}` / `POST {"name":""}` se obtiene por
> `curl` contra un proceso ya compilado con `nest build`, nunca en jest.

**Capa 2 (repositorio).** `updateTag`/`updateManufacturer` MUST llamar a
`normalizeSlug(input.name, aggregate)` **descartando el resultado**, solo por su
efecto lateral `EmptySlugError`, cuando `input.name !== undefined`
(`types.repository.ts:123-125`). Sin ella, un `PUT {"name":""}` corrompería la
fila en silencio: `name` es `text NOT NULL` y `''` es **legal** para Postgres.
Dos capas y no una porque el tsconfig de la API **no activa `strict`** y
`ValidationPipe` no tiene `whitelist` ni `transform`: el tipo del input **no es
una garantía de runtime** (B2/B3).

**Nota sobre `slug` en el PickType/OmitType.** `D27b-1` solo habla de `type_id`,
pero la decisión 4 del épico es vinculante ("sobre el `slug` que envíe el
cliente si lo envía") y los dos formularios lo envían
(`tag-form.tsx`, `manufacturer-form.tsx`). Sin declararlo, el servicio no puede
proyectar `dto.slug` sin error de tipos. Se declara. No contradice `D27b-1`.

### DD-10 — Guarda de id no entero en los 6 métodos con `:id`

`update`/`remove` MUST abrir con
`if (!Number.isInteger(id)) throw new NotFoundException(...)`. Los controladores
pasan `+id` (`tags.controller.ts:43,49`; `manufacturers.controller.ts:58,64`),
así que `PUT /api/tags/abc` llega como `NaN` y `BigInt(NaN)` revienta en 500
dentro del repositorio. Precedente `types.service.ts:126-128`,
`users.service.ts:94,113,142`.

## Data Flow

```
PUT /api/manufacturers/12  {name, is_approved:false, type_id:9, language, socials[]}
  │
  ├─ ValidationPipe (sin whitelist / sin transform)  → 400 si name === ""      [capa 1]
  │
  ▼ manufacturers.controller.ts:58   this.service.update(+id, dto)
  │
  ├─ !Number.isInteger(id) ────────────────────────────────► 404               [DD-10]
  │
  ▼ manufacturers.service.ts  (try)
  │   proyección campo a campo:  name, description, website,
  │     image → as unknown as Prisma.InputJsonValue
  │     is_approved → Boolean(...)            [DD-6]
  │     type_id → Number(...)                 [DD-2]
  │     socials / cover_image / language / shop_id → SE IGNORAN (sin columna)
  │
  ▼ @safari/db  updateManufacturer(id, input)
  │   normalizeSlug(input.name) si name presente ──► EmptySlugError            [capa 2]
  │   !Number.isInteger(typeId)            ──────► InvalidReferenceError       [DD-2]
  │   prisma.manufacturer.update({ ..., updatedAt: now() })   ← sin trigger
  │       └─ catch → translateCatalogWriteError(e,{aggregate,id,uniqueField})
  │              P2002→SlugConflict · P2003→InvalidReference · P2025→RecordNotFound
  ▼
  │  types = await listTypes()   (una vez, después de la escritura)            [DD-7]
  ▼ toManufacturerDto(record, typesById)   → 13 claves, is_approved: 0|1
  │
  └─ catch → toWriteHttpException(e)
         mapDomainError → 400/404/(409 inalcanzable aquí)
         isConnectionFailure → 503     (incluye ECONNREFUSED, fix C-1)
         resto (P2011, …) → 500 literal
```

`DELETE /api/tags/:id` → `prisma.tag.delete` → **Postgres** borra las filas de
`product_tag` por `CASCADE`. El repositorio **no** las toca.

## Divergencias declaradas

| # | Divergencia | Motivo |
|---|---|---|
| V-1 | `socials` y `cover_image` (manufacturers) se **aceptan y se ignoran**; la respuesta emite `[]` y `null` | Sin columna (`schema.sql:281-292`). Decisión 5 del épico |
| V-2 | **`language` de `manufacturers` también se ignora** — la tabla no tiene la columna y `toManufacturerDto:57` emite la constante `'en'`. La lista de la decisión 5 del épico (solo `socials`, `cover_image`) está **incompleta**; se declara, no se acciona. En `tags` sí hay columna `language` y **se persiste** | `schema.sql:281-292` vs `:295-306` |
| V-3 | `shop_id` de `CreateManufacturerDto` se declara y se ignora | Sin columna; `manufacturer-form.tsx` solo lo envía en create |
| V-4 | `products_count` sigue siendo la constante `0` y `translated_languages` `['en']` | Sin columna. `D-6`: los mappers no cambian |
| V-5 | `image: null` **no limpia** la columna (se trata como ausente) | `DD-5` |
| V-6 | La respuesta de escritura **no trae `created_at`/`updated_at`** (9 y 13 claves). `updated_at` se observa por `psql`, nunca por `curl` | Los mappers no los emiten. Divergencia ya embarcada del épico |
| V-7 | El mensaje del 400 de `InvalidReference` puede nombrar `slug` en vez de `type_id` | `S-1` / `DD-3`. Se registra el texto real |
| V-8 | Las **lecturas** de ambos servicios conservan `isPrismaConnectionError` | `D-4` / `S-6`. Adyacente no accionado |
| V-9 | `findOrCreateManufacturerBySlug` queda intacta y **sin ningún call site en TypeScript** (el scraper es Python + `psycopg`), en contra de lo que afirma su comentario de cabecera | Fuera de alcance explícito |
| V-10 | `manufacturer.entity.ts:16` declara `type_id?: string` sobre una columna `bigint`. **No se corrige** | Fuera de la tabla de scope; se coerciona en el servicio (`DD-2`) |
| V-11 | El `UPDATE products SET manufacturer_id` de preparación de `CA-3` dispara el trigger `products_updated_at` (`schema.sql:488`) y bumpea `products.updated_at` de la fila sonda **de forma no restaurable** — y lo hace **dos veces**: en el `UPDATE` del setup y otra vez en el `SET NULL` del `DELETE`, porque ambos son updates de fila. Invisible por HTTP: `products.service.ts` no emite timestamps (grep = 0) | Efecto del setup, aceptado |
| V-12 | **Entrega: 4 commits secuenciales sobre una sola rama, sin ramas apiladas y sin PRs**, push a `main` tras `just verify`. `D27b-9` de la propuesta decía "cadena de 4 PRs"; el usuario eligió después la variante sin PRs. **Esta fila es la decisión de entrega autoritativa** (N-7); la frontera del corte (externo, por agregado) se mantiene sin cambios | Decisión explícita del usuario, posterior a la propuesta |
| V-13 | Se añade `@IsOptional() @IsBoolean()` a `is_approved` y se añaden `created_at`/`updated_at` al `OmitType` de `CreateManufacturerDto`, más allá de lo que enumera la US | `DD-6`/N-2 y `DD-9`/N-9. Ambas dentro del archivo que la US ya manda reescribir (decisión 15) |

## File Changes

> **Esta tabla es la valla de alcance.** `sdd-apply` y `sdd-verify` la tratan
> como cerrada: cualquier archivo fuera de ella con diff es una desviación que
> hay que declarar.

| Archivo | Acción | Descripción |
|---|---|---|
| `packages/db/src/repositories/tags.repository.ts` | Modify | +`createTag`/`updateTag`/`deleteTag`, +`CreateTagInput`/`UpdateTagInput`, +`tagSlugs: ExistingSlugLookup` |
| `packages/db/src/repositories/manufacturers.repository.ts` | Modify | ídem para manufacturers. **`findOrCreateManufacturerBySlug` NO se toca** |
| `packages/db/src/repositories/tags.integration.test.ts` | Modify | +escrituras con centinela `zz-tags-`, cleanup plegado, assert de cierre `count()===10` |
| `packages/db/src/repositories/manufacturers.integration.test.ts` | Modify | ídem con `zz-manu-`, assert de cierre `count()===14` |
| `packages/db/index.ts` | Modify | Barrel: 6 funciones + 4 tipos. **Único archivo compartido con US-28/29/30** — si corren en paralelo, **rebase**, nunca merge a mano |
| `apps/api/rest/src/tags/tags.service.ts` | Modify | `create`/`update`/`remove` migrados; fuera `@db/tags.json`, `Fuse`, `plainToClass`, `private tags` |
| `apps/api/rest/src/manufacturers/manufacturers.service.ts` | Modify | ídem; `Number(record.isApproved)` en `:60` **intacta** |
| `apps/api/rest/src/tags/dto/create-tag.dto.ts` | Modify | `DD-9` |
| `apps/api/rest/src/manufacturers/dto/create-manufacturer.dto.ts` | Modify | `DD-9` |
| `apps/api/rest/src/tags/tags.service.spec.ts` | **Create** | Jest, `@safari/db` mockeado |
| `apps/api/rest/src/manufacturers/manufacturers.service.spec.ts` | **Create** | ídem |
| `packages/db/src/slug.ts`, `.../domain-errors.ts`, `apps/api/rest/src/common/errors/**` | **Unchanged** | `CA-7` — `git diff --stat` vacío |
| `tag.entity.ts`, `manufacturer.entity.ts`, `update-*.dto.ts`, ambos controladores, `db/schema.sql`, `db/seed.sql`, `prisma/schema.prisma`, `packages/db/src/errors.ts`, `apps/{shop,admin}/**` | **Unchanged** | `D27b-1`, `CA-5`, decisiones 1 y 14 |

## Testing Strategy

| Capa | Qué se prueba | Cómo |
|---|---|---|
| Integración (`packages/db`, vitest) | Persistencia real: create + relectura por slug; `slug` inmutable en update con `updatedAt` medido vía `_setNowProvider`; `name` vacío ⇒ `EmptySlugError` con la fila intacta; id inexistente ⇒ `RecordNotFoundError`; `typeId` mal formado ⇒ `InvalidReferenceError`; sufijo de colisión; **desenlace** | Centinela por archivo (`DD-8`). El **desenlace se prueba dentro del test, sin `psql`**: crea un centinela, enlaza una fila sembrada, borra el centinela y asserta el desenlace **por fila, nunca por conteo global** (`productTag.count({ where: { tagId: sentinelId } })` → 0; `product.findUnique({ where: { id: probeId } }).manufacturerId` → null) — ver `DD-8.1`/B-2. **Se auto-restaura**: el valor sembrado ES el estado post-borrado |
| Unidad (`apps/api/rest`, jest) | Proyección campo a campo (nada de `socials`/`cover_image`/`language`/`shop_id` en el input); `Boolean()`/`Number()` de `is_approved`; guarda de id no entero **sin llamar al repositorio**; los 5 códigos de dominio → 400/404; `{code:'P1001'}` → 503; `{code:'P2011'}` → **500, nunca 503** (B1); **key-set idéntico y EN ORDEN** entre `create`/`update`/`remove` y el `GET` por slug (9 y 13, nunca `.sort()`) | `jest.mock('@safari/db', () => ({ ...jest.requireActual(...), createTag: jest.fn(), updateTag: jest.fn(), deleteTag: jest.fn(), findTagBySlug: jest.fn(), listTypes: jest.fn() }))`. **`listTypes` se mockea además de los 4 de `types`** (`DD-7`). Las 5 clases de error y `toWriteHttpException` quedan **reales**. `/// <reference types="jest" />` en la cabecera (el tsconfig fija `types:["node","express","multer"]`). Plantilla: `types.service.spec.ts:1-88` |
| E2E manual (`curl` + `psql`) | Los 7 CA | Ver *Procedimiento de evidencia* |

**Gates y baselines medidos hoy.** `just db-check` → **9 archivos / 111 tests**
(el conteo de **archivos no cambia**: se extienden los dos existentes).
`cd apps/api/rest && npx jest` → **6 suites / 92 tests** → pasa a **8 suites**
al final (2 specs nuevos). `just build-api` limpio. `just verify` verde.
`tags.integration.test.ts:18` `toBe(10)` y
`manufacturers.integration.test.ts:18` `toBe(14)` **deben seguir verdes**.

## Procedimiento de evidencia (y su limpieza)

**Estado sembrado medido hoy (2026-09-10), no asumido:**

```
tags           10 filas, ids 53..62,          tags_id_seq.last_value = 62
manufacturers  14 filas, ids 1..12,18,19,     manufacturers_id_seq.last_value = 20
types          10 filas, ids 1..9,11,         types_id_seq.last_value = 58   ← ¡max(id)=11!
product_tag                                  0 filas
products       1200 filas (ids 1..1259), manufacturer_id IS NOT NULL = 0
```

**Regla de limpieza (B5).** Prohibido `just db-reset` (decisión 1). Prohibido
también deducir el rango de basura con un predicado `id > N`: `types_id_seq`
está en **58** con `max(id) = 11` porque la sesión de US-27a avanzó la secuencia
muy por encima de su valor documentado. La limpieza se hace **por el id exacto
que devolvió la respuesta** (o por `slug LIKE 'zz-…%'` en los tests), y se cierra
comprobando los conteos: `tags` → **10**, `manufacturers` → **14**,
`product_tag` → **0**, `products` → **1200** con `manufacturer_id IS NOT NULL`
→ **0**.

**Estos conteos globales solo son válidos con `just db-check` DETENIDO** (B-2):
mientras la suite de `products` corre, `products` es **1201** y `product_tag`
es **1** por su fixture (`products.integration.test.ts:198-237`). Los asserts
*dentro* de la suite son por fila (`DD-8.1`); los globales viven **solo aquí**.

| CA | Procedimiento | Limpieza |
|---|---|---|
| CA-1 / CA-2 (tags) | `POST /api/tags {"name":"Oferta Verano","type_id":9,"socials":[{"icon":"x","url":"y"}],"cover_image":{"id":1}}` → 201, **9 claves**, sin `socials` ni `cover_image` y **sin error** (escenario ADDED de `spec.md:23-26`, B-3; coste cero: `ValidationPipe` va sin `whitelist`, `main.ts:9`) → `GET /api/tags/oferta-verano` → **matar y relanzar la API** → `GET` de nuevo → `PUT /api/tags/:id {"name":"Oferta de Invierno","slug":"intento-de-cambiar"}` → `slug` sigue `oferta-verano`. `updated_at` **por `psql`** (antes/después), nunca por `curl` (B6, V-6) → `DELETE /api/tags/:id` → 200 con las **mismas 9 claves** → **`GET /api/tags/oferta-verano` → 404** (MUST de `spec.md:58`, N-8) | La secuencia **termina en `DELETE`** ⇒ auto-limpiante |
| CA-1 / CA-2 (manufacturers) | `POST /api/manufacturers {"name":"Marca Prueba","type_id":9,"is_approved":true,"description":"desc-sonda","website":"https://sonda.test","image":{"id":1,"original":"o","thumbnail":"t"},"socials":[{"icon":"x","url":"y"}],"cover_image":{"id":1},"language":"es"}` → 201, **13 claves**, `socials:[]`, `cover_image:null`, `is_approved:1` → reinicio → `GET` → **`PUT` con las 5 claves EXACTAS del toggle** (`{"name":"Marca Prueba","is_approved":false,"type_id":9,"language":"es"}`, `manufacturer-list.tsx:134-142`) → **reinicio en medio** → `GET` → `is_approved:0`. Es la evidencia central de la US. **`psql` justo después del `PUT`**: `description = 'desc-sonda'`, `website` e `image` **intactos** — prueba directa de la regla normativa de `DD-1` (B-4); si el apply proyectase ausente → `null`, aquí saldrían tres `NULL` → `DELETE /api/manufacturers/:id` → 200, 13 claves → **`GET /api/manufacturers/marca-prueba` → 404** (MUST de `spec.md:71`, N-8) | ídem (`DELETE` al final) |
| CA-3 (setup por `psql` — **`D27b-7`, es setup, no comportamiento**) | El seed no enlaza nada. Antes del `DELETE`: `UPDATE products SET manufacturer_id = :marca_prueba WHERE id = 1;` y `INSERT INTO product_tag (product_id, tag_id) VALUES (2, :oferta_verano);`. Tras el `DELETE`: `SELECT count(*) FROM products` → **1200**; `manufacturer_id` de la fila 1 → **NULL**; `count(*) FROM product_tag` → **0** | **Se auto-deshace**: el `SET NULL` y el `CASCADE` restauran exactamente el estado sembrado. Undo explícito solo si la corrida se aborta antes del `DELETE`: `UPDATE products SET manufacturer_id = NULL WHERE id = 1;` · `DELETE FROM product_tag WHERE tag_id = :id;`. Residuo no restaurable: `products.updated_at` de las filas sonda (V-11) |
| CA-4 | `PUT`/`DELETE /api/{tags,manufacturers}/99999` → 404 · `PUT /api/tags/abc` → 404 (`NaN`, sin tocar el repositorio) · `POST {}` → 400 · `POST {"name":""}` → 400 · `POST {"name":"!!!"}` → 400 · `PUT {"name":""}` → 400 (capa 2) · `POST /api/tags {"name":"X","type_id":99999}` → **400 + mensaje literal registrado** (`DD-3`). **Colisión, ejecutada tal como la escribe el escenario** (`spec.md:87-90`, N-3): `POST /api/tags {"name":"Oferta"}` → 201 `slug:"oferta"` (no existe en el seed) y de nuevo `POST /api/tags {"name":"Oferta"}` → 201 **`slug:"oferta-2"`**; el `PUT /api/manufacturers/99999` → 404 del mismo escenario ya está arriba. Adicional en `manufacturers` sobre un slug **sembrado**: `POST /api/manufacturers {"name":"Medicure"}` → 201 `slug:"medicure-2"` (existe `medicure`, id 18). **Cierre de "ni log de stack"** (`spec.md:80`, N-5): sobre el log de la API capturado durante toda la batería, `grep -cE '^\s+at '` → **0** (precedente US-27a: `P2025` hace que el logger de Prisma imprima un code-frame **sin ningún frame JS**, así que el conteo de frames es el discriminador correcto, no la ausencia de texto) | Las tres filas de colisión llevan slug **no centinela** ⇒ `DELETE FROM tags WHERE id IN (:oferta, :oferta_2);` y `DELETE FROM manufacturers WHERE id = :medicure_2;`, **siempre por el id que devolvió la respuesta**, nunca por `id > N` |
| CA-5 | Tokens reales por `POST /api/token`. Las sondas **sin token (401 ×6)** y **`customer` (403 ×6)** no escriben nada (el `PermissionsGuard` corta antes del servicio) ⇒ cualquier id sirve; igual las 3 de `store_owner` sobre `tags`, que son **403** (`ADMIN_ONLY`). **Las 3 de `store_owner` sobre `manufacturers` SÍ escriben desde esta US** (`permissions.decorator.ts:22` `ADMIN_OWNER_AND_STAFF = ['super_admin','store_owner','staff']` cubre `POST` `:30-31`, `PUT` `:52-53`, `DELETE` `:61-62`), así que **MUST correr como secuencia auto-limpiante sobre fila centinela propia** (B-1): `POST /api/manufacturers {"name":"Zz Manu Permisos"}` → **201** → `PUT /api/manufacturers/{id devuelto}` → **200** → `DELETE` del **mismo** id → **200**. **PROHIBIDO** `PUT`/`DELETE` de un id sembrado con ese token: mutaría/destruiría filas del seed sin undo (decisión 1 prohíbe `db-reset`) y pondría rojo `manufacturers.integration.test.ts:18` `toBe(14)`. `git diff` de los dos controladores vacío | **Auto-limpiante como `CA-1`/`CA-2`**: termina en su propio `DELETE`; cierre `count(manufacturers)` → **14**. Si se aborta a media secuencia: `DELETE FROM manufacturers WHERE slug LIKE 'zz-manu-permisos%';` |
| CA-6 | `grep -n "fuse\|@db/"` en los dos servicios → **0 líneas**; conteos de lectura 10 / 14 tras la suite | — |
| CA-7 | `git diff --stat packages/db/src/slug.ts packages/db/src/domain-errors.ts apps/api/rest/src/common/errors/` → **vacío** | — |

Los diffs de key-sets se hacen con `node -e` y **sin `.sort()`** (`jq` no está
instalado en este Git Bash).

## Migration / Rollout — 4 commits

**Sin migración de datos y sin DDL.** Rama `us-27b-escrituras-tags-manufacturers`,
**4 commits secuenciales: no ramas apiladas, no PRs**, push a `main` al final
tras `just verify`. Esto **divergó** de la letra de `D27b-9` ("cadena de 4 PRs")
por decisión posterior del usuario; se declara en `V-12` y es la decisión de
entrega vigente. Lo que `D27b-9` fija y **no** cambia es la **frontera del
corte**: externa, por agregado — cada agregado queda releasable solo y cada
slice lo prueba un runner distinto.

| Commit | Contenido | ~Líneas | Runner que lo prueba verde solo |
|---|---|---|---|
| **#1** | `tags` en `packages/db`: repositorio + integración + barrel | ~327 | `just db-build` → `just db-check` → **9 archivos**, tests > 111. La API no cambia |
| **#2** | `tags` en la API: servicio + DTO + spec | ~467 (+~20 borrados) | `just db-build` (**BLOQUEANTE**) → `npx jest` → **7 suites** → `just build-api` → secuencia `curl` de `tags`. **`tags` releasable aquí** |
| **#3** | `manufacturers` en `packages/db` | ~332 | `just db-build` → `just db-check` → 9 archivos, tests > los de #1 |
| **#4** | `manufacturers` en la API | ~495 (+~25 borrados) | `just db-build` → `npx jest` → **8 suites** → `just build-api` → `curl` (incl. toggle con reinicio) + CA-3/CA-4/CA-5 → `just verify` |

> **Convención de la columna `~Líneas` (N-6):** son **líneas añadidas**, para que
> los commits sumen exactamente los subtotales de la tabla de estimación
> (327+467 = **794** `tags`; 332+495 = **827** `manufacturers`). Los ~45
> borrados (imports de JSON, `Fuse`, `private tags/manufacturers`) van aparte
> porque el presupuesto de revisión de la Sección E cuenta
> `additions + deletions`: el diff real que ve un revisor es ~1666.

**`just db-build` es BLOQUEANTE antes de cualquier comprobación de la API** en
#2 y #4: `packages/db/dist` está gitignored y Nest lo consume vía `link:`; sin
reconstruir, el falso negativo es un `TypeError: createTag is not a function`
(`R27b-7`). El reinicio del proceso de Nest es parte de la secuencia — y hay
precedente de **procesos huérfanos `nest start --watch` re-bindeando el 9001**
(verify de US-27a): comprobar el puerto antes de cada relanzamiento.

**Rollback.** Revert del commit + `just db-build` + `just build-api`. Sin DDL,
sin `db-reset`. Basura que `git` no deshace:
`DELETE FROM tags WHERE slug LIKE 'zz-tags-%';` ·
`DELETE FROM manufacturers WHERE slug LIKE 'zz-manu-%';` · el undo de `CA-3` si
la corrida se abortó. Revertir un commit de la capa API deja las funciones de
`packages/db` inertes y el servicio en su stub: es exactamente el estado del
commit anterior, y es verde.

### Estimación por área (anclada en tamaños medidos de US-27a)

Anclas reales (`git show --numstat 3c59b0d 829f510`): `types.repository.ts`
**+150**, `types.integration.test.ts` **+149/-4**, `packages/db/index.ts`
**+12/-2**, `types.service.ts` **+75/-24**, `create-type.dto.ts` **+30/-1**,
`types.service.spec.ts` **+331**.

| Área | `tags` | `manufacturers` | Ajuste sobre el ancla |
|---|---|---|---|
| Repositorio | ~150 | ~150 | −12 (sin conteo de dependientes) +8 (guarda de `typeId`) +campo extra |
| Test de integración | ~165 | ~170 | −12 (sin 409) +25 (desenlace acotado + guarda de `typeId`) |
| Barrel | ~12 | ~12 | igual |
| Servicio Nest | ~125 | ~135 | +`listTypes()`+`Map` ×3 métodos; manufacturers: 13 claves + 2 coerciones |
| DTO | ~22 | ~30 | 31 de `create-type.dto.ts`; manufacturers +2 (`@IsBoolean`, timestamps omitidos) |
| `*.service.spec.ts` (jest) | ~320 | ~330 | **331 reales**, NO las ~145 que estimó el design de US-27a |
| **Subtotal (añadidas)** | **~794** | **~827** | = #1+#2 y #3+#4 de la tabla de commits |
| *Borradas (aparte)* | *~20* | *~25* | imports de JSON, `Fuse`, arrays en memoria |

`Estimated changed lines: ~1620 añadidas (~1666 con borrados)` ·
`400-line budget risk: High` ·
`Chained slices recommended: Yes` · `Decision needed before apply: No` (ya
resuelta: 4 commits). Queda ~90 líneas por encima del punto central de la
propuesta (~1530) y **dentro** de su banda (±180). El exceso de #2 y #4 sobre
las 400 líneas está concentrado en un **archivo de test nuevo** (~320), el
material de menor coste de revisión.

## Trampas de US-27a pre-emptadas

| Trampa | Dónde queda cerrada |
|---|---|
| **B2/B3** — validación de `name` en dos capas | `DD-9`: capa 1 `@IsString() @IsNotEmpty()` en los dos DTOs ⇒ `POST {}` es 400, **no 503**; capa 2 `normalizeSlug` cuando `name` está presente. `name` **ausente** sigue siendo no-op legal |
| **B4** — paralelismo de archivos de test | `DD-8.1`: no hay `vitest.config.*` (verificado en el listado del directorio) ⇒ centinelas `zz-tags-` / `zz-manu-` (aislamiento frente a US-28/29/30), cada test borra lo que crea, y **todo assert de desenlace es por fila**: el tercer escritor es la fixture de `products.integration.test.ts:198-237`, que mantiene `products` en 1201 y `product_tag` en 1 mientras corre |
| **N5** — orden LIFO de los hooks | `DD-8.2`: cleanup **plegado en el `afterAll` existente** con `try/finally`; no se registra un segundo `afterAll`. Assert de cierre como último `it` del archivo |
| **B5** — evidencia auto-limpiante | *Procedimiento de evidencia*: sin `db-reset`; limpieza **por el id de la respuesta**, jamás por `id > N` (evidencia: `types_id_seq` = 58 con `max(id)` = 11); **las 4 secuencias que escriben (CA-1/CA-2 ×2, CA-4, CA-5) terminan en su propio `DELETE`**; conteos de cierre 10 / 14 / 0 / 1200 con la suite detenida |
| **B6** — `updated_at` | `V-6` + tabla de evidencia: la respuesta tiene 9 y 13 claves **sin timestamps**; la evidencia de `CA-2` es `psql`, nunca `curl`. Consistente con la nota del delta spec |
| **B1 / C-1** — mapeo de errores | `DD-4`: el mapeador se consume **sin una sola edición**; su `CONNECTION_FAILURE_CODES` ya trae los códigos de socket. Si pareciera necesitar un cambio, eso **rompe `CA-7`: parar y reportar** |
| **Estimación del spec de jest** | Tabla de estimación anclada en **331 líneas reales**, no en las ~145 que predijo el design de US-27a |
| **Nuevo, propio de `tags`** | `DD-8.3`: escrituras **al final** del archivo (+ comentario que lo explique), porque `tags.integration.test.ts:19-20` asserta `items[0].id === 62` sobre `orderBy id desc`. `types` no tenía este assert |

## Lo que quedará NO VERIFICADO

- **`SlugConflict` → 409** en los dos agregados: solo alcanzable por una carrera
  de dos `POST` concurrentes con el mismo nombre (`slug.ts:88-96` agota el
  sufijo primero). Igual que en US-27a, se cubre a nivel de spec de jest con un
  fixture, nunca por HTTP.
- **`DependentRows` → 409**: no tiene productor en esta US (`DD` #1 de la tabla
  de diferencias). No se prueba porque no existe.
- **Si Prisma 7 + `adapter-pg` puebla `meta.field_name` en el P2003**: se
  **observará** en `sdd-apply` (`DD-3`), pero el resultado es un dato empírico,
  no una garantía de diseño.
- **`image: null` limpiando la columna**: no soportado por decisión (`DD-5`,
  `V-5`); no se prueba.
- **`socials`/`cover_image`/`language`(manufacturers)/`shop_id` persistidos**:
  no tienen columna; solo se verifica que **no producen error** y que la
  respuesta emite las constantes de la lectura.
- **Escrituras concurrentes**: `updateTag`/`updateManufacturer` no usan
  transacción ni bloqueo optimista. Último escritor gana. Fuera de alcance.
- **`staff` sobre `/api/manufacturers`**: `ADMIN_OWNER_AND_STAFF` le abre la
  ruta, pero no hay relación staff↔tienda en la base (decisión 8, diferida).
  `CA-5` solo pide 401 / `customer` / `store_owner`.

## Open Questions

- [ ] **Ninguna que bloquee.** `D27b-1` y `D27b-7` estaban cerradas y no se
      reabren; los dos únicos huecos de forma que quedaban —el `slug` en los
      DTOs (`DD-9`) y el `null` de `image` (`DD-5`)— se cierran aquí con
      precedente en el propio repo.
- [ ] Concerns **declarados, diseñados a favor de la decisión vigente**: (a) la
      lista de campos sin columna de la decisión 5 del épico omite `language`
      de `manufacturers` (`V-2`); (b) `manufacturer.entity.ts` tipa
      `type_id` como `string` sobre una columna `bigint` (`V-10`).
- [ ] *Resuelto en esta 2ª corrida:* el escenario de colisión de `CA-4` ya se
      ejecuta **literalmente** como lo escribe `spec.md:87-90` (`oferta` →
      `oferta-2`, creando y borrando por el id devuelto), en vez de sustituirlo
      por slugs sembrados. Se acabó la divergencia (N-3).

## Correcciones del gate (2ª corrida)

| Clave | Corrección | Dónde |
|---|---|---|
| **B-1** | Las 3 sondas `store_owner → 200` **escriben de verdad** desde esta US: pasan a secuencia auto-limpiante sobre fila centinela (`POST` → `PUT` del id devuelto → `DELETE` del mismo id); columna *Limpieza* rellena; prohibido tocar un id sembrado con ese token | fila `CA-5` |
| **B-2** | Asserts de desenlace **por fila** en la suite; los conteos globales, solo en el `psql` manual con la suite detenida. Tercer escritor: fixture de `products.integration.test.ts:198-237` | `DD-8.1`, *Testing*, *Limpieza* |
| **B-3** | El `POST /api/tags` de la evidencia ya lleva `socials` y `cover_image` (escenario `spec.md:23-26`) | fila `CA-1`/`CA-2` (tags) |
| **B-4** | Hecho falso corregido (toggle = **5** de **10** claves) y regla **MUST** *clave ausente ⇏ `data` de Prisma*, con prueba `psql` tras el toggle | `DD-1`, fila `CA-1`/`CA-2` (manuf.) |
| **N-1** | `PartialType` es de `@nestjs/swagger` + plugin de `nest-cli.json`, que **no corre bajo `ts-jest`** ⇒ ningún spec de jest asserta el `ValidationPipe` | `DD-9` |
| **N-2** | `Boolean("false") === true` declarado; `@IsOptional() @IsBoolean()` | `DD-6`, `DD-9`, `V-13` |
| **N-3** | Colisión ejecutada literalmente: `oferta` → `oferta-2` | fila `CA-4` |
| **N-4** | Motivo real del centinela por archivo: paralelismo **entre US** (28/29/30) | `DD-8.1` |
| **N-5** | `grep -cE '^\s+at '` → 0 sobre el log | fila `CA-4` |
| **N-6** | `~Líneas` = solo añadidas; commits suman los subtotales (794 / 827); ~45 borrados aparte (~1666 de diff) | *Migration*, *Estimación* |
| **N-7** | 4 commits sin PRs como divergencia autoritativa sobre `D27b-9` | `V-12` |
| **N-8** | `GET → 404` tras el `DELETE` explícito | filas `CA-1`/`CA-2` |
| **N-9** | `created_at`/`updated_at` añadidos al `OmitType` | `DD-9`, `V-13` |
| **DD-3** | Literales del remedio impresos | `DD-3` |
| **DD-8.3** | Comentario obligatorio en el archivo explicando el orden | `DD-8` regla 3 |
| **Cita** | US-27a se implementó en `530e713`, `3c59b0d`, `829f510`, `4304bc5`; `8797caa` solo archiva | cabecera |
