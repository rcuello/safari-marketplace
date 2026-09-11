# Design: Escrituras del árbol de categorías (US-28)

> Cierra las cuatro **decisiones pendientes** que `proposal.md:187-207` dejó
> abiertas y ratifica `D28-1..D28-9`. Insumos: `proposal.md`,
> `exploration.md`, US-28 y el épico 26. Piezas de US-27a/27b: **se
> consumen, no se tocan** (`CA-7`).
>
> **Sobre las citas `archivo:línea`**: se verificaron contra el código en el
> momento de escribir (las de la US arrastran +10 en
> `categories.repository.ts`). La ronda de corrección posterior a `GATE: FAIL`
> encontró **tres desviaciones de ±1-9 líneas**, ya corregidas abajo; trátalas
> como un recordatorio de que **`sdd-apply` debe re-greppear antes de tocar**,
> no como una garantía de exactitud universal.

## Technical Approach

Tres funciones nuevas en `packages/db/src/repositories/categories.repository.ts`
(mismo archivo que las lecturas, `D-2`) y tres métodos del servicio Nest
migrados. La forma general es la de `types`/`tags`: input tipado campo a
campo, guardas de dominio **antes** del write, `translateCatalogWriteError`
en el `catch`, `toWriteHttpException(error)` como única línea del `catch`
del servicio.

Tres cosas son propias de `categories` y son el contenido real de la US:

| # | Propio de `categories` | Consecuencia |
|---|---|---|
| 1 | Es el único agregado **jerárquico** | Cuatro reglas de la arista madre→hija que el DDL no puede expresar; `InvalidReferenceError` → 400 pre-validado (`D28-1`) |
| 2 | La proyección publicada tiene **16 claves** con `type` embebido y `children` | Las tres escrituras devuelven `CategoryTreeNode`, no un record plano (`D28-4`) |
| 3 | La tabla **sí tiene trigger** `categories_updated_at` (`db/schema.sql:490`) | El repositorio NO fija `updatedAt` a mano (`D28-3`) |

## Architecture Decisions

### DD28-1 — `deleteCategory` devuelve el `CategoryTreeNode` **pre-borrado** (cierra la pendiente #1)

**Elección**: opción (a). `deleteCategory` carga el nodo completo **antes**
del `DELETE` (esa misma carga es la comprobación de existencia del
`find-then-delete`) y devuelve ese snapshot; el servicio lo proyecta con
`toCategoryDto` sin ninguna rama especial.

**Alternativa rechazada**: (b) devolver el `CategoryRecord` plano como
`deleteType` (`types.repository.ts:174`) / `deleteTag`
(`tags.repository.ts:206`). Se rechaza porque `toCategoryDto`
(`categories.service.ts:160-179`) hace `toEmbeddedType(node.type)` sobre un
`TypeRecord` **no nulo**: un record plano obligaría a un segundo mapper
"best-effort" en el servicio con `type: null` y `children: []`, es decir a
romper la decisión 3 del épico (misma proyección que el `GET`) o a duplicar
`toCategoryDto`. La opción (a) cuesta cero código de mapeo.

**Key-set y valores exactos de la respuesta del `DELETE`** — las mismas 16
claves y el mismo orden que el `GET`:

`id, name, slug, icon, image, details, language, translated_languages,
parent, type_id, created_at, updated_at, deleted_at, parent_id, type,
children`

- `parent`: la cadena ascendente completa **tal como estaba** (no `null` si
  la borrada tenía madre). La madre no se toca en el borrado, así que este
  valor sigue siendo verdad después.
- `children`: el subárbol **pre-borrado**, cada hija con
  `parent_id = <id borrado>`. **Divergencia declarada**: en la base esas
  hijas ya están re-enraizadas (`parent_id NULL` por
  `ON DELETE SET NULL`, `db/schema.sql:268`); la respuesta refleja el estado
  anterior al `DELETE`, no el posterior.
- `type`: el objeto de 10 claves de `toEmbeddedType`, intacto.

**Por qué la divergencia es inocua**: el admin **ignora el body del
`DELETE`** — `useDeleteCategoryMutation` (`apps/admin/rest/src/data/category.ts:39-47`)
declara `onSuccess: () => { toast.success(...) }` **sin parámetro**, y solo
invalida la query. Contraste: `useUpdateCategoryMutation` (`:54-60`) sí usa
`data?.slug`. No hay consumidor del cuerpo del `DELETE`.

### DD28-2 — El re-fetch de las tres escrituras vive en el **repositorio**

Las tres funciones devuelven `Promise<CategoryTreeNode>`. `createCategory` y
`updateCategory` re-leen tras escribir; `deleteCategory` lee antes de
borrar. El re-fetch usa un helper privado `_loadNode(id)` =
`_assembleTree(await _loadFlat()).get(id) ?? null`, **no**
`findCategoryByIdOrSlug` (`categories.repository.ts:236`): esa función
resuelve por id **o por slug** y, con un id que ya no existe, caería al
barrido por slug — ambigüedad innecesaria en una ruta que solo conoce ids.

**Alternativa rechazada**: que el servicio llame a `findCategoryByIdOrSlug`
tras la escritura. Añade un round trip desde Nest, obliga a un `if (!node)`
en cada método y saca del repositorio la garantía de no-nulidad.

**Coste declarado**: `_loadNode` carga las 198 filas y ensambla el árbol (un
`findMany`, el mismo coste que un `GET /categories/:id`). Una escritura = 1
`_loadNode` + 1-3 sondas `select {id,parentId,typeId}` + el write.

**Carrera declarada**: si otra sesión borra la fila entre el write y el
re-fetch, `_loadNode` devuelve `null` y se lanza `RecordNotFoundError` →
**404**. Mismo desenlace si el `type` se borra en medio (`_assembleTree`
descarta la fila entera, `categories.repository.ts:97-106`).

### DD28-3 — Contrato de validación de la arista madre→hija (cierra la pendiente #2)

Los cuatro rechazos son `InvalidReferenceError` → **400** (`D28-1`). El
conjunto cerrado de 5 códigos solo ofrece 400 por `EmptySlug` o
`InvalidReference`, y el mensaje de `InvalidReferenceError`
(`domain-errors.ts:60-64`) tiene plantilla fija; el **único lever
disponible** es el argumento `field` — precedente literal
`_assertValidTypeId` (`tags.repository.ts:114-118`, lanza la clase
compartida directamente con un `field` discriminante) y `DD-3` de US-27b
("el mensaje se observa; el único remedio pre-autorizado es el `context`
del call site").

**Alternativa rechazada**: una subclase local de `CatalogWriteError` con
`code = CATALOG_INVALID_REFERENCE` y mensajes a medida. Funcionaría
(`isCatalogWriteError` es un guard **estructural por `code`**,
`domain-errors.ts:112-116`) y no tocaría ningún archivo compartido, pero
abre una segunda jerarquía para el mismo código y hace que el "conjunto
cerrado" parezca abierto.

| # | Regla | Dueño | `field` (discriminador) | `value` | HTTP |
|---|---|---|---|---|---|
| 1 | Forma entera de `type_id` **y de `parent`** | `_assertIntegerRef` | `type_id` / `parent_id` | el valor recibido | 400 |
| 2 | Autorreferencia (`parent === id`) | `_assertParentEdge` | `parent_id (autorreferencia)` | `id` | 400 |
| 3 | La madre existe | `_assertParentEdge` | `parent_id` | `parentId` | 400 |
| 4 | Mismo `type_id` que la madre | `_assertParentEdge` | `parent_id (dentro de type_id N)` | `parentId` | 400 |
| 5 | Sin ciclo | `_assertNoAncestorCycle` | `parent_id (ciclo: la madre propuesta desciende de esta categoría)` | `parentId` | 400 |
| 6 | Cadena > 32 saltos (defensivo) | `_assertNoAncestorCycle` | `parent_id (cadena de ancestros supera 32 saltos)` | `parentId` | 400 |
| 7 | Hijas con otro `type_id` (ver DD28-5) | `_assertChildrenShareType` | `type_id (N hija(s) con otro type_id)` | `typeId` | 400 |

Los mensajes resultantes conservan el sufijo genérico «… referencia un
registro inexistente (`v`).». **Divergencia declarada**: para
autorreferencia y ciclo esa frase es imprecisa; el token discriminante va
delante y es greppable. Los textos exactos **se observan** en `sdd-apply`
(precedente `DD-3`), no se dan por buenos aquí.

#### Regla normativa transversal: la frontera `BigInt` (MUST)

`Category.id`, `Category.parentId` y `Category.typeId` son **`BigInt`** en
`packages/db/prisma/schema.prisma:91,97,98`. La asimetría es la trampa:

- **Entrada** (`where`, `data`): Prisma acepta un `number` y lo coerciona.
  El patrón de la casa lo confirma —`where: { id }` con `id: number` en
  `types.repository.ts:129,159,173` y `tags.repository.ts:170,199,205`—, así
  que las cláusulas `where` de este design **no** llevan `BigInt(...)`.
- **Salida** (todo lo que Prisma devuelve): `row.id`, `row.parentId` y
  `row.typeId` son `bigint`. **Todo valor leído de Prisma MUST pasar por
  `_id()` (`packages/db/src/records.ts:38-42`) antes de cualquier `===`,
  asignación o comparación contra un `number`.** Precedente en el propio
  agregado: `_toCategoryRecord` (`records.ts:219-233`, con
  `_id(row.parentId)` en `:227` y `_id(row.typeId)` en `:228`), invocado
  desde `categories.repository.ts:107`.

Sin esta regla los dos comparadores centrales de la US **fallan en
silencio**, no en voz alta:

| Comparación | Escrita ingenuamente | Qué pasa de verdad |
|---|---|---|
| Regla 5, ciclo (`_assertNoAncestorCycle`) | `cursor === id` con `cursor` recibido de `row.parentId` | `bigint === number` es **siempre `false`**: la guarda de ciclo **nunca dispara**. Además `cursor = row.parentId` es un **error de tipo** contra `cursor: number \| null` (no compila) |
| Regla 4, mismo type (`_assertParentEdge`) | `parent.typeId === effectiveTypeId` | `bigint === number` es **siempre `false`**: **toda** creación con madre daría 400 |

`_assertNoAncestorCycle` importa `_id` de `../records`; el `import` de
`categories.repository.ts:19-25` (hoy `_toCategoryRecord`, `_toTypeRecord`
y dos tipos) gana `_id`. Las sondas que solo comparan existencia
(`if (!row)`) no necesitan conversión, pero convertir siempre es más barato
que razonar caso por caso.

**Una violación de CHECK de Postgres NO es traducible hoy**:
`translateCatalogWriteError` (`domain-errors.ts:135-163`) solo reconoce
`P2002`/`P2003`/`P2025` y devuelve el error intacto en cualquier otro caso;
`toWriteHttpException` (`domain-error.mapper.ts:146-155`) lo degradaría a
**500**. Por eso `categories_no_autoreferencia` (`db/schema.sql:274`) debe
quedar **inalcanzable por construcción**: la regla 2 corre antes del write
en el único camino que puede dispararla (`updateCategory`; en create no hay
`id` todavía). El CHECK sobrevive como red de integridad de la base, nunca
como comportamiento de la API.

### DD28-4 — `_assertNoAncestorCycle`: privada, iterativa, tope de 32 (ratifica `D28-2`)

Enfoque A de `exploration.md:249-267`. **Módulo-privada**, prefijo `_` como
`_assembleTree`/`_loadFlat`/`_immediate`; **no** se exporta del barrel.

```ts
import { _id } from '../records';   // BigInt → number (records.ts:38-42)

const MAX_ANCESTOR_HOPS = 32;

async function _assertNoAncestorCycle(
  id: number,
  startFrom: number | null   // = _id(parent.parentId): la madre ya se sondeó
): Promise<void> {
  let cursor: number | null = startFrom;
  for (let hops = 0; hops < MAX_ANCESTOR_HOPS; hops++) {
    if (cursor === null) return;                 // se alcanzó la raíz: sin ciclo
    if (cursor === id) throw /* regla 5 */;
    const row = await prisma.category.findUnique({
      where: { id: cursor },                     // number: Prisma coerciona a BigInt
      select: { id: true, parentId: true },
    });
    if (!row) return;                            // ancestro desaparecido: cadena rota
    cursor = _id(row.parentId);                  // OBLIGATORIO: row.parentId es bigint
  }
  throw /* regla 6 */;
}
```

> **`_id(row.parentId)` no es cosmético.** Sin él, `cursor = row.parentId`
> no compila (`bigint` contra `number | null`) y, si se "arregla" ensanchando
> el tipo de `cursor`, `cursor === id` pasa a ser `bigint === number` —
> **siempre `false`**, guarda de ciclo muerta y `CA-2` incumplida sin que
> ningún test de tipos lo delate. Ver la regla normativa de DD28-3.

- **Arranca en `_id(parent.parentId)`**, no en `parentId`:
  `_assertParentEdge` ya cargó la fila de la madre y ya descartó la
  autorreferencia. Ahorra un round trip; con la profundidad real (2 saltos,
  `categories.repository.ts:4-7`) son **0-2** consultas, no 32. El `_id()`
  del argumento es tan obligatorio como el del bucle.
- **Fila ausente a mitad del ascenso** ⇒ `return` sin lanzar: la cadena está
  rota por arriba, ningún ciclo puede cerrarse hacia `id` a través de ella.
  La existencia de `parentId` (lo único que se va a escribir) ya se validó, y
  la FK de Postgres es el backstop (`P2003` → `InvalidReferenceError`).
- **Tope alcanzado** ⇒ lanza (regla 6, 400). Solo alcanzable con datos ya
  corruptos o una jerarquía de >32 niveles; negarse a escribir es la salida
  conservadora y **nunca un 500**.
- `select: { id: true, parentId: true }` — dos columnas, índice de PK.

**Testabilidad**: se cubre por integración (la cadena centinela de nivel 4
da un ascenso real multi-salto; A→B→A da un rechazo real). **Ese test A→B→A
es además la única red que atrapa el fallo `bigint === number`**: si falta
`_id()`, la guarda no lanza, el `PUT` devuelve 200 y el test se pone rojo
por «esperaba 400, obtuvo 200» — el compilador solo detecta la mitad del
problema. **No** se añade
test unitario con `prisma` mockeado: el paquete tiene exactamente un test
no-integración (`products.repository.test.ts`, y existe solo porque
`_toProductRecord` es puro); inyectar un callback `loadParent` solo para
mockearlo sería una abstracción no ganada. La rama del tope queda
**declarada como no ejercitada** (requeriría 33 filas o plantar un ciclo con
SQL crudo); `sdd-apply` **MAY** añadirlo con `prisma.$executeRaw`
parametrizado.

### DD28-5 — `type_id` es mutable y la invariante se valida en los **dos** lados de la arista (cierra la pendiente #3)

`UpdateCategoryInput` **incluye** `typeId`. Motivo: el formulario del admin
envía `type_id` en las dos ramas (`category-form.tsx:223-236`, el mismo
objeto `input` alimenta `createCategory` y `updateCategory`); omitirlo del
input haría que "cambiar la vertical" fuese un **no-op silencioso** — el
modo de fallo exacto que este épico existe para matar.

La invariante "una hija tiene el `type_id` de su madre" es **una sola**, y
se valida sobre la **arista efectiva**, no sobre el campo enviado:

- `effectiveTypeId = input.typeId ?? current.typeId`
- `effectiveParentId = input.parentId !== undefined ? input.parentId : current.parentId`
- si `effectiveParentId !== null` ⇒ `_assertParentEdge(effectiveParentId, effectiveTypeId, id)`
  (así, cambiar **solo** `type_id` re-valida la madre existente contra el
  nuevo type).
- si `input.typeId` llega y **difiere** de `current.typeId` ⇒
  `_assertChildrenShareType(id, input.typeId)`: un
  `count({where:{parentId:id, typeId:{not:newTypeId}}})`; `> 0` ⇒ regla 7.

**Alternativas rechazadas**: (a) `typeId` inmutable como `slug` — elimina la
guarda descendente pero devuelve el no-op silencioso; (b) mutable sin guarda
descendente — dejaría hijas de otro type bajo la madre, invisibles en la
tienda (`parseCategorySearch`, `categories.service.ts:44-50`), creadas por
una escritura de esta misma US. Coste de cerrarlo: **un `count`, solo cuando
`type_id` cambia**; añade un `curl` de 400 más a la evidencia.

**Consecuencia observable, declarada explícitamente: `type_id` solo es
mutable de hecho en categorías HOJA.** Como la invariante se cumple, las
hijas de un nodo comparten **siempre** su `type_id` actual; por tanto
`count({where:{parentId:id, typeId:{not:newTypeId}}})` es `> 0` para
**cualquier** cambio de type sobre un nodo **con hijas**, y la regla 7
devuelve 400 **siempre** en ese caso. En una hoja el `count` es `0` y el
cambio pasa.

Es un desenlace defensible —y estrictamente mejor que el no-op silencioso
que DD28-5 existe para matar—, pero es un **compromiso visible para el
usuario**: mover una vertical entera exige, hoy, re-tipar de abajo arriba,
hoja por hoja. Alternativa no elegida: re-tipar la rama en cascada dentro de
la misma escritura (des-acotado, sin `$transaction` por DD28-6, y fuera del
"NO incluye" de la US). Va a la tabla de divergencias (#10) y al smoke-test
del admin.

**No hay riesgo de regresión sobre el seed**: la premisa se verificó con
`node -e` sobre `db/seed.sql` (bloque `INSERT` de `categories` `:119-318`,
jerarquía `FROM (VALUES` `:324-438`) → **198 filas, 83 raíces, 115 filas con
madre y 0 desajustes de `type_id` entre hija y madre**. Por eso re-validar
la arista efectiva en **todo** `PUT` (incluida una edición de solo `name`)
no puede hacer que una fila del seed empiece a devolver 400.

### DD28-6 — Sin `$transaction`; la carrera de re-parentado concurrente se acepta

Sonda de la madre + ascenso + write **no** son atómicos. Precedente exacto:
`deleteType` declara su TOCTOU como riesgo bajo aceptado
(`types.repository.ts:150-157`); `$transaction` se usa **una** vez en todo
el paquete (`auth-tokens.repository.ts:129`) y ninguna escritura de catálogo
lo usa.

**Carrera declarada**: dos `PUT` simultáneos —«mueve A bajo B» y «mueve B
bajo A»— pasan ambos su guarda (al comprobar, ninguno era descendiente del
otro) y producen un ciclo A→B→A que Postgres no puede rechazar. **Impacto
acotado**: la lectura ya tiene guarda de ciclo por `path`
(`categories.repository.ts:131-133`, `:148-151`) y devuelve un árbol
truncado en vez de reventar el proceso Nest; reparación por `UPDATE` manual.
Cerrarlo exigiría `Serializable` o un advisory lock — desproporcionado para
un panel con un administrador en un repo didáctico.

### DD28-7 — `updatedAt` lo pone el trigger (ratifica `D28-3`)

`updateCategory` **no** importa `now` de `../clock` y **no** incluye
`updatedAt` en el `data`, a diferencia de `updateType`
(`types.repository.ts:136`) y `updateTag` (`tags.repository.ts:178`). El
trigger `categories_updated_at BEFORE UPDATE` (`db/schema.sql:490`) ejecuta
`tocar_updated_at()` (`:480-486`) y fija `NEW.updated_at = now()` con el
reloj **de Postgres**.

**Implicación concreta para los tests**: `_setNowProvider`
(`packages/db/src/clock.ts:12-14`) **no tiene efecto** sobre
`categories.updated_at`. El patrón de `types.integration.test.ts` —pinchar
un `future` (`:103-104`) y compararlo **por igualdad** en la aserción
(`:112`, `expect(updated.updatedAt.getTime()).toBe(future.getTime())`)—
**no se puede copiar**. La
aserción correcta es de monotonía contra el reloj de la base:
`expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime())`.
Corolario: el trigger dispara en **todo** `UPDATE`, incluso si ningún valor
cambia.

### DD28-8 — Slug: `generateSlug` en create, `normalizeSlug` desechado en update (ratifica `D28-5`)

- **Create**: `generateSlug({ name: input.name, slug: input.slug }, categorySlugs, 'categories')`,
  con `categorySlugs: ExistingSlugLookup` **local** al repositorio (calcado
  de `typeSlugs`, `types.repository.ts:58-64`). El nombre de tabla nunca
  llega a `slug.ts` (`CA-7`).
- **Update**: `UpdateCategoryInput = Partial<Omit<CreateCategoryInput,'slug'>>`
  — el `slug` no existe **a nivel de tipo**, así que CA-2 ("`slug` no cambia
  aunque cambie `name`") es imposible de violar por descuido. Si llega
  `name`, se llama `await normalizeSlug(input.name, 'categories')` y se
  **descarta el resultado**: solo por su efecto lateral `EmptySlugError` →
  400 (`categories.name` es `text NOT NULL` donde `''` es legal). Precedente:
  `products.repository.ts:391` («El slug NO se toca en update: es la URL
  pública del producto») y `updateType` (`types.repository.ts:123-125`).
- **Orden en create**: guardas de referencia **antes** de `generateSlug`,
  como `createTag` (`tags.repository.ts:122-128`).

### DD28-9 — `CreateCategoryDto`: `type_id`, `parent` y `slug` standalone, sin efecto de runtime

```ts
export class CreateCategoryDto extends PickType(Category, [
  'name', 'details', 'icon', 'image', 'language',
]) {
  type_id: number;          // category-form.tsx:235
  parent?: number | null;   // category-form.tsx:234 (id o null)
  slug?: string;            // el form lo envía; lo consume generateSlug (DD28-8)
}
```

`'type'` y `'parent'` salen del `PickType` porque `Category`
(`entities/category.entity.ts:9,14`) los declara como **objetos** y el admin
manda números. `slug` se añade standalone-opcional (no vía `PickType`)
porque `Category.slug: string` es requerido y Swagger lo documentaría como
obligatorio. `category.entity.ts` **no se toca** (`D28-9`).

**Sin efecto de runtime, confirmado**: `main.ts:9` registra
`new ValidationPipe()` **sin** `transform` ni `whitelist`. Sin `whitelist`
no se filtra ninguna clave; sin decoradores de `class-validator` en estas
tres propiedades no se valida nada; sin `transform` **no hay coerción** (de
ahí DD28-10). Es una corrección de **documentación Swagger** y de tipos de
compilación. Precedente: `shop_id?: string` standalone en
`create-manufacturer.dto.ts:48`. **No** se añade soporte de objetos
anidados (fuera de alcance, vinculante).

### DD28-10 — El servicio coerciona `type_id`/`parent` con `Number(...)`

Réplica obligatoria del hallazgo **W-2** de US-27b (explicación en
`tags.service.ts:118-124`, implementación en `:147-150` para create y
`:184-187` para update): sin `transform`, `{"type_id":"9"}` llega como
**string** y `!Number.isInteger("9")` daría un 400 con el mensaje **falso**
«referencia un registro inexistente (`9`)» para un type que existe.

**Create** — `type_id` es obligatorio, `parent` opcional:

```ts
typeId: Number(createCategoryDto.type_id),
...(createCategoryDto.parent !== undefined && {
  parentId: createCategoryDto.parent === null
    ? null
    : Number(createCategoryDto.parent),
}),
```

**Update** — ambos condicionales, para preservar la semántica `Partial` de
`UpdateCategoryInput` y el `input.typeId ?? current.typeId` de DD28-5 (si
`typeId` se enviara siempre, «no tocar el type» sería indistinguible de
«ponerlo al valor actual» y la regla 7 se evaluaría de más):

```ts
...(updateCategoryDto.type_id !== undefined && {
  typeId: Number(updateCategoryDto.type_id),
}),
...(updateCategoryDto.parent !== undefined && {
  parentId: updateCategoryDto.parent === null
    ? null
    : Number(updateCategoryDto.parent),
}),
```

La rama `=== null` es obligatoria en ambos: `Number(null) === 0`, que
re-enraizaría bajo la categoría 0 en vez de a la raíz. `undefined` **no**
llega al input; `null` sí, y significa «hazla raíz». Guarda de id no entero
(`if (!Number.isInteger(id)) throw new NotFoundException(...)`) en `update`
y `remove`, como `types.service.ts:126-128,151-153`; la guarda equivalente
para el `parent` del body vive en el repositorio (regla 1, ver Data Flow).

## Contrato error → HTTP

| Origen | Error de dominio | Status | Alcanzable desde |
|---|---|---|---|
| `normalizeSlug`/`generateSlug` con `name` vacío | `EmptySlugError` | **400** | POST, PUT |
| Reglas 1-7 de DD28-3 | `InvalidReferenceError` | **400** | POST, PUT |
| FK `type_id` inexistente (`P2003`) | `InvalidReferenceError` | **400** | POST, PUT |
| Fila ausente en `_loadNode` / `current` | `RecordNotFoundError` | **404** | PUT, DELETE |
| `P2025` traducido | `RecordNotFoundError` | **404** | PUT, DELETE |
| `slug` colisionado por carrera (`P2002`) | `SlugConflictError` | **409** | POST |
| — | `DependentRowsError` | 409 | **inalcanzable** (`D28-6`: sin guarda de dependientes) |
| Postgres caído | *(ninguno)* | **503** | las tres |
| CHECK `categories_no_autoreferencia` | *(no traducible)* | ~~500~~ | **inalcanzable por construcción** (DD28-3) |

`git diff` de `domain-errors.ts`, `domain-error.mapper.ts` y `slug.ts`:
**vacío** (`CA-7`).

## Data Flow

```
POST /categories                    PUT /categories/:id                 DELETE /categories/:id
  controller (ADMIN_ONLY)             controller (ADMIN_ONLY)             controller (ADMIN_ONLY)
  service: DTO → CreateCategoryInput  service: guarda id entero            service: guarda id entero
      │  Number(type_id|parent)           │  DTO → UpdateCategoryInput          │
      ▼                                   ▼                                    ▼
  createCategory                      updateCategory                       deleteCategory
   1 _assertIntegerRef                 1 normalizeSlug(name)? → 400         1 _loadNode(id) ─── null → 404
       (typeId, 'type_id')             2 _assertIntegerRef                  2 prisma.delete   (snapshot)
   2 _assertIntegerRef                     (typeId, 'type_id')?                 └─ SET NULL re-enraiza
       (parentId, 'parent_id')         3 _assertIntegerRef                         las hijas (DDL)
       ◄── aquí muere el NaN               (parentId, 'parent_id')?         3 return snapshot
   3 parentId != null?                     ◄── aquí muere el NaN
       _assertParentEdge(              4 current = findUnique(id)
         parentId, typeId, null)           └─ null → 404
         ├ existe? ─── no → 400        5 typeId cambia?
         ├ type ok? ── no → 400            _assertChildrenShareType → 400
         └ (create: sin ciclo)         6 arista efectiva → _assertParentEdge
   4 generateSlug(categorySlugs)          ├ self / no existe / type → 400
   5 prisma.create ── catch →             └ _assertNoAncestorCycle → 400
       translateCatalogWriteError      7 prisma.update (sin updatedAt)
   6 _loadNode(row.id) → 404 si null   8 _loadNode(id) → 404 si null
      │                                   │                                    │
      └──────────────► service: toCategoryDto(node) — 16 claves ◄──────────────┘
                       catch → toWriteHttpException(error)
```

**El orden de los pasos 2-3 (create) y 3-4 (update) es normativo, no
estético.** `_assertIntegerRef(parentId, 'parent_id')` MUST correr **antes**
del dispatch `parentId != null`, porque **`NaN != null` evalúa a `true`**.
Sin esa llamada, la regla 1 de DD28-3 queda prometida en la tabla pero nunca
cableada, y el fallo concreto es un 500:

```
POST /categories {"type_id":9,"parent":"abc"}
  → DD28-10: Number("abc") = NaN
  → NaN != null es TRUE  ⇒ entra en _assertParentEdge(NaN, …)
  → prisma.category.findUnique({ where: { id: NaN } })
  → BigInt(NaN) lanza RangeError, SIN propiedad .code
  → translateCatalogWriteError lo devuelve intacto (domain-errors.ts:135-163)
  → toWriteHttpException cae al literal final          ⇒ HTTP 500
```

Viola la decisión 6 del épico («nunca 500») y dejaría `R28-1` parcialmente
sin mitigar. **La trampa ya está documentada en el repo**:
`types.service.ts:119-121` («sin esta guarda, `BigInt(NaN)` revienta en 500
dentro del repositorio»), que es la razón de la guarda `Number.isInteger(id)`
de `:126-128`. Aquélla cubre el `:id` de la ruta; ésta cubre el `parent` del
**body**, que ningún guard de ruta toca. Evidencia obligatoria: el `curl` de
`{"parent":"abc"}` — con él son **seis** `curl` de 400, no cinco.

## Interfaces / Contracts

```ts
// packages/db/src/repositories/categories.repository.ts  (público)
export interface CreateCategoryInput {
  name: string;
  slug?: string | null;            // gana sobre `name` si llega no vacío
  details?: string | null;
  icon?: string | null;            // el admin manda '' cuando no elige icono
  image?: Prisma.InputJsonValue;   // jsonb; `null` se trata como ausente (DD-5, US-27b)
  parentId?: number | null;        // `null` = raíz
  typeId: number;                  // NOT NULL en el DDL
  language?: string;               // ausente ⇒ DEFAULT 'es'
}

/** `slug` inmutable por tipo (CA-2); `typeId` SÍ mutable (DD28-5). */
export type UpdateCategoryInput = Partial<Omit<CreateCategoryInput, 'slug'>>;

export async function createCategory(input: CreateCategoryInput): Promise<CategoryTreeNode>;
export async function updateCategory(id: number, input: UpdateCategoryInput): Promise<CategoryTreeNode>;
export async function deleteCategory(id: number): Promise<CategoryTreeNode>;

// privadas (no van al barrel)
const categorySlugs: ExistingSlugLookup;
async function _loadNode(id: number): Promise<CategoryTreeNode | null>;
function _assertIntegerRef(value: number | null | undefined, field: string): void;
async function _assertParentEdge(
  parentId: number, effectiveTypeId: number, childId: number | null
): Promise<void>;   // ← LLAMA a _assertNoAncestorCycle cuando childId !== null
async function _assertNoAncestorCycle(id: number, startFrom: number | null): Promise<void>;
async function _assertChildrenShareType(id: number, typeId: number): Promise<void>;
```

**Quién llama a `_assertNoAncestorCycle`** (el Data Flow lo dibuja anidado y
la lista lo declara como par; ambas cosas son ciertas y conviene decirlo sin
ambigüedad): se declara como función **hermana** module-private, pero el
**único** call site es **dentro de `_assertParentEdge`**, al final, y solo
cuando `childId !== null` (es decir, en `updateCategory`; en `createCategory`
`childId` es `null` y no hay ciclo posible). No se invoca desde
`updateCategory` directamente.

**Por qué ahí y no en el nivel de arriba**: `_assertParentEdge` es la única
función que ya tiene en la mano la fila de la madre —y por tanto
`_id(parent.parentId)`, el `startFrom` declarado en DD28-4—. Llamarla desde
`updateCategory` obligaría a devolver esa fila hacia arriba o a re-sondear
la madre, que es exactamente el round trip que DD28-4 ahorra. El orden
interno de `_assertParentEdge` es: regla 2 (autorreferencia, sin E/S) →
regla 3 (existe) → regla 4 (mismo type) → regla 5/6 (ciclo).

Barrel `packages/db/index.ts`: añadir `CreateCategoryInput` /
`UpdateCategoryInput` al bloque `export type` (`:57-62`) y
`createCategory` / `updateCategory` / `deleteCategory` al `export`
(`:63-67`), en orden alfabético. **Único archivo compartido con US-29/30**:
quien arranque segundo rebasea (`R28-9`).

## File Changes

| Archivo | Acción | Descripción |
|---|---|---|
| `packages/db/src/repositories/categories.repository.ts` | Modify | +3 funciones públicas, +2 inputs, `categorySlugs`, 4 helpers privados. `_assembleTree`, `_loadFlat` y las 3 lecturas **intactas** (`D28-7`) |
| `packages/db/src/repositories/categories.integration.test.ts` | Modify | Centinela `zz-categories-` + describes de escritura **al final** |
| `packages/db/index.ts` | Modify | 3 funciones + 2 tipos |
| `apps/api/rest/src/categories/categories.service.ts` | Modify | 3 métodos migrados; fuera `Fuse` (`:24`,`:34`), `@db/categories.json` (`:25`), `plainToClass` (`:7`,`:29`) y el campo `private categories` (`:183`) |
| `apps/api/rest/src/categories/dto/create-category.dto.ts` | Modify | DD28-9 |
| `apps/api/rest/src/categories/categories.service.spec.ts` | **Create** | Jest con `@safari/db` mockeado |
| `slug.ts`, `domain-errors.ts`, `common/errors/`, `category.entity.ts`, controlador, `db/schema.sql`, `apps/{shop,admin}` | **Unchanged** | `CA-7` + decisiones 1 y 14 |

## Testing Strategy

| Capa | Qué se prueba | Cómo |
|---|---|---|
| Integración (vitest) | create raíz/hija, slug inmutable, las 7 reglas de 400, re-enraizado, profundidad 4, `updatedAt` por trigger | `categories.integration.test.ts` contra Postgres real (`just db-check`) |
| Unidad (jest) | Proyección campo a campo, `Number()` de `type_id`/`parent`, id `NaN` → 404, cada error de dominio → su status, `P1001` → 503, `P2011` → 500, contrato de 16 claves | `categories.service.spec.ts` con `@safari/db` mockeado |
| Manual | Secuencia `POST/GET/reinicio/PUT/DELETE` + los **seis** 400 + `CA-5` + smoke del admin | `curl` + `node -e` (jq no está instalado) |

**Los seis `curl` de 400** (eran cinco antes de la ronda de corrección):
madre inexistente (regla 3) · madre de otro type (regla 4) ·
autorreferencia (regla 2) · ciclo A→B→A (regla 5) · `type_id` que rompe a
las hijas (regla 7, DD28-5) · **`{"parent":"abc"}` (regla 1, forma entera)**.
El último es el que separa un 400 de un 500 (ver Data Flow).

**Smoke-test del admin — tres comprobaciones, ninguna toca el frontend**:

1. `translated_languages` constante `['en']` no rompe la rama create/update
   del formulario (`R28-4`, preexistente).
2. **Editar solo el `name` de una categoría del seed no dispara ningún 400.**
   Premisa verificada: `category-form.tsx:172-177` siembra `defaultValues`
   con `{ ...initialValues }`, así que `values.parent?.id` y `values.type?.id`
   (`:234-235`) viajan con los valores **actuales** en toda edición — no hay
   re-enraizado silencioso ni cambio de type implícito, y la regla 7 no se
   evalúa. Sumado a los **0 desajustes de type en las 115 filas con madre**
   del seed (ver DD28-5), una edición ordinaria no puede empezar a fallar.
3. **Cambiar el `type_id` de una categoría CON hijas devuelve 400** y con
   una hoja funciona (divergencia #10).

### Arquitectura del centinela (ratifica `D28-8`)

```ts
const SENTINEL_PREFIX = 'zz-categories-';
const cleanup = () =>
  prisma.category.deleteMany({ where: { slug: { startsWith: SENTINEL_PREFIX } } });

beforeAll(cleanup);                       // corrida abortada previa

afterAll(async () => {                    // el afterAll que YA existe (:17-19)
  try { await cleanup(); } finally { await prisma.$disconnect(); }
});
```

- **Se pliega en el `afterAll` existente** (`categories.integration.test.ts:17-19`),
  **nunca** un segundo `afterAll`: el default `sequence.hooks: 'stack'` de
  vitest lo correría LIFO contra un cliente ya desconectado. Calcado del
  idiom completo de `types.integration.test.ts:21-34` (constante `:21`,
  `cleanup` `:23-24`, `beforeAll(cleanup)` `:26`, `afterAll` `:28-34`).
- **Los describes de escritura van DESPUÉS** de los de lectura: el archivo
  afirma conteos exactos —`83` (`:24`), `198` (`:29`, `:77`), `53` (`:40`),
  `10` (`:103`, `:110`)— y vitest ejecuta los `describe` en orden de archivo.
  Cada `it` borra lo que crea, además de la red del `afterAll`.
- **`deleteMany` por prefijo es seguro con jerarquía**: al borrar una madre
  centinela, `ON DELETE SET NULL` re-enraiza a las hijas centinela, que
  siguen coincidiendo con el prefijo y caen en la misma sentencia. No hay
  orden que respetar.
- **Nombres de fixture**: `${SENTINEL_PREFIX}raiz`, `-hija`, `-nieta`,
  `-bisnieta`, `-mover-a`, `-mover-b`, `-huerfana`; el `name` lleva el mismo
  prefijo para distinguirlos en un `SELECT` manual.
- **Cadena de nivel 4 100 % centinela** (`CA-4`): cuatro filas propias
  (`raiz → hija → nieta → bisnieta`) con el **mismo `type_id`** de una
  vertical existente, **sin colgar de `169`/`170`** — así ningún test
  perturba filas del seed de las que dependen los conteos del propio archivo
  y el `psql` de cierre (`R28-2`, `exploration.md:407-423`). Aserción:
  `findCategoryByIdOrSlug('…-raiz')` trae la bisnieta anidada a 3 niveles, y
  `listCategories({rootsOnly:false})` la trae con `parent.parent.parent.id`
  = el de la raíz.
- **Cómo sobreviven `198`/`83`/`10`/`53`**: los describes de lectura corren
  antes de que exista una fila centinela; `beforeAll(cleanup)` garantiza base
  limpia tras una corrida abortada; ningún test de escritura toca filas sin
  el prefijo; el `afterAll` restituye. Cierre:
  `SELECT count(*) FROM categories` → **198**.

### `categories.service.spec.ts` (nuevo, sigue `types.service.spec.ts`)

`/// <reference types="jest" />` en la cabecera (el `tsconfig` de la API no
trae los globals). `jest.mock('@safari/db', () => ({ ...jest.requireActual('@safari/db'),
createCategory: jest.fn(), updateCategory: jest.fn(), deleteCategory: jest.fn(),
findCategoryByIdOrSlug: jest.fn(), listCategories: jest.fn() }))` — las 5
clases de error y `toWriteHttpException` quedan **reales**. Factory
`makeCategoryNode(overrides)` → `CategoryTreeNode` con `type` embebido, un
`parent` de un nivel y una `children` de un nivel. Describes `create` /
`update` / `remove` con el cuadro de escenarios de
`types.service.spec.ts:89-293`, y un `describe` final que compara
`Object.keys()` de las tres escrituras contra la lectura **en orden, nunca
`.sort()`** (`types.service.spec.ts:295-330`), con las 16 claves.

## Divergencias declaradas

| # | Divergencia | Estado |
|---|---|---|
| 1 | `children` del `DELETE` refleja el estado **pre-borrado** (las hijas ya están re-enraizadas en la base) | Nueva, DD28-1; **autorizada verbatim** por la decisión 3 del épico (el `DELETE` devuelve el registro borrado con la proyección del `GET`), así que no viola el "byte a byte"; sin consumidor (el admin ignora el body, `data/category.ts:39-47`) |
| 2 | Mensajes de los 400 con sufijo genérico «referencia un registro inexistente» | Nueva, DD28-3; token discriminante al frente |
| 3 | Ciclo posible por carrera de dos `PUT` simultáneos | Nueva, DD28-6; lectura degrada a árbol truncado, no a 500 |
| 4 | Rama del tope de 32 saltos sin test | Nueva, DD28-4; defensiva |
| 5 | `products_count` **no aparece** entre las 16 claves top-level de `toCategoryDto`; solo existe —constante `0`— dentro de cada descendiente, en `toDescendantDto` (`categories.service.ts:145`) | Preexistente (V-1, US-4b). Las escrituras heredan la asimetría sin tocarla |
| 6 | `translated_languages` constante `['en']` | Preexistente (`categories.service.ts:169`); smoke-test obligatorio, **sin tocar el frontend** (`R28-4`) |
| 7 | `created_at`/`updated_at`: 3 decimales vs. 6 del mock | Ya embarcada |
| 8 | `image` se guarda tal cual llega (el form manda `{}` si no hay imagen) | `R28-6`, sin normalización |
| 9 | `CLAUDE.md` dice "4 suites / 65 tests"; hoy hay **8** specs y **10** archivos de test en `packages/db` | Adyacente **mencionado y NO accionado** |
| 10 | **`type_id` solo es mutable de hecho en categorías HOJA**: en un nodo con hijas, la regla 7 devuelve 400 siempre (DD28-5) | Nueva, DD28-5. Compromiso visible para el usuario; mejor que el no-op silencioso. Entra en el smoke-test del admin |

## Migration / Rollout

Sin migración de datos ni DDL: **esta US no añade ni una columna**. Cadena
de 3 PRs por capa y plan de rollback: `proposal.md:120-139,162-177`. Toda
verificación abre con `just db-build` (`dist/` gitignored, `R28-8`) y
reinicia la API; `just db-reset` **no** es necesario.

### Re-anclaje de la estimación tras DD28-5 y la ronda de corrección

El `proposal.md` pronosticó **~890 (±150)** *antes* de que este design
añadiera la séptima regla, su guarda y la frontera `BigInt`. Delta medido
sobre aquel pronóstico:

| Añadido por el design | ~Líneas |
|---|---|
| `_assertChildrenShareType` + su `count` (DD28-5) | ~20 |
| Regla 7 en `updateCategory` (rama `typeId` cambia) | ~10 |
| `_id()` en las sondas y el import (DD28-3/DD28-4) | ~5 |
| Caso de integración «regla 7» + caso «hoja sí cambia» | ~35 |
| Caso jest de la regla 7 + del 400 por `parent:"abc"` | ~25 |
| **Total** | **~95** |

**~985, dentro del borde superior de la banda ±150** (`890 + 95 < 1040`),
así que el pronóstico **no se re-emite**: se declara consumido el 63 % del
margen. Dado el historial del épico (US-27a 500 → **1462**; US-27b 825 →
**2109**), esto **eleva `R28-5` de facto** y hace vinculante el *caveat* del
`proposal.md`: si `sdd-apply` desborda de forma material, el corte a
levantar es **PR#3 (`categories.service.spec.ts`) a una US-28b**. `sdd-tasks`
sigue siendo el pronóstico autoritativo y debe partir de **~985**, no de
~890.

## Decisions ratified from proposal

| Decisión | Estado en este design |
|---|---|
| `D28-1` pre-validación en código, CHECK como red | **Ratificada** — DD28-3, ampliada a 7 reglas con dueño y `field` |
| `D28-2` ciclo iterativo, 32 saltos | **Ratificada** (pendiente #4 cerrada a favor del Enfoque A) — DD28-4, con arranque en `parent.parentId` |
| `D28-3` sin `updatedAt` manual | **Ratificada** — DD28-7, con la implicación sobre `_setNowProvider` |
| `D28-4` respuesta por re-fetch + `toCategoryDto` | **Ratificada y precisada** — DD28-2 (`_loadNode`, no `findCategoryByIdOrSlug`); pendiente #1 cerrada en DD28-1 |
| `D28-5` `categorySlugs` local, slug inmutable | **Ratificada** — DD28-8 |
| `D28-6` delete sin guarda de dependientes | **Ratificada** — `DependentRowsError` inalcanzable |
| `D28-7` `getCategoryTree` no se toca | **Ratificada** — ningún hallazgo obliga a cambiarlo; `CA-4` sigue pendiente de confirmación **empírica** |
| `D28-8` centinela `zz-categories-` | **Ratificada y detallada** — Testing Strategy |
| `D28-9` DTO standalone | **Ratificada y ampliada** — DD28-9 añade `slug?: string`, requerido por `D28-5` |
| Pendiente #3 (`type_id` mutable) | **Cerrada** — DD28-5: mutable + guarda descendente |

## Open Questions

Ninguna bloqueante. Dos verificaciones **empíricas** que este design predice
pero no puede cerrar, y que `sdd-apply`/`sdd-verify` deben pegar como
evidencia:

- [ ] `CA-4`: la profundidad 4 se sirve anidada, sin 400 (`D28-7` es una
      conclusión estática sobre `_assembleTree`, `categories.repository.ts:91-171`).
- [ ] Los textos exactos de los 7 mensajes de 400 (**se observan**,
      precedente `DD-3` de US-27b).

## Correcciones aplicadas tras `GATE: FAIL` (solidez interna)

Ronda correctiva única. El gate aprobó los checks 1-4 y 6; falló **solo** el
check 5. Trazabilidad:

| # | Defecto | Sev. | Dónde se cerró |
|---|---|---|---|
| 1 | Frontera `BigInt` ausente: el pseudocódigo del ciclo no compilaba y `bigint === number` dejaba muertas las reglas 4 y 5 | **Alta** | DD28-3 «Regla normativa transversal» + snippet de DD28-4 con `_id(row.parentId)` |
| 2 | Regla 1 prometida para `parent` pero nunca cableada ⇒ 500 con `{"parent":"abc"}` | **Alta** | Data Flow: `_assertIntegerRef(parentId,'parent_id')` en ambas ramas, **antes** del dispatch; sexto `curl` |
| 3 | Comportamiento real de DD28-5 sin declarar (`type_id` mutable solo en hojas) | Media | DD28-5 + divergencia #10 + smoke-test del admin |
| 4 | `R28-5` desactualizado: el pronóstico no contemplaba DD28-5 | Media | «Re-anclaje de la estimación»: ~985, dentro de la banda, margen consumido al 63 % |
| 5 | Citas imprecisas y dos huecos de precisión (llamador de `_assertNoAncestorCycle`, mapeo update de DD28-10) | Baja | DD28-7, DD28-10, Interfaces, divergencia #5, cabecera |
| 6 | Premisa del seed implícita | — | DD28-5 (198/83/115/0 desajustes) y smoke-test (`category-form.tsx:172-177`) |

**Dos revisiones del gate se dejaron intactas por correctas**: el `DELETE`
con snapshot pre-borrado de 16 claves (DD28-1, autorizado por la decisión 3
del épico) y la arquitectura de tests con centinela (DD28-8).

**Una corrección del gate NO se aplicó, por ser incorrecta**: el gate pedía
mover la cita del bloque de coerción de `tags.service.ts` a `:148-151`. La
re-verificación (`grep -n "type_id\|Number("`) sitúa el spread en
**`:147-150`** —`...(createTagDto.type_id !== undefined && {` en `:147`,
`Number(createTagDto.type_id)` en `:149`—, que es lo que el design ya decía.
Lo que sí se corrigió es la otra mitad de esa cita: la explicación W-2 está
en `:118-124`, no en `:116-127`; y se añadió el call site de update
(`:184-187`).
