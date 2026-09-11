# Design: Escrituras de productos con categorías y tags (US-29)

> Cierra las tres preguntas abiertas que `proposal.md:205-222` dejó vivas (la
> #2 la cerró producto el 2026-09-11: `shop_id` **es** mutable) y ratifica
> `D29-1..D29-9` con tres refinamientos y **ninguna revocación**. Insumos:
> `proposal.md`, `exploration.md`, los 4 delta-specs, US-29 y el épico 26.
> Precedente de forma:
> `openspec/changes/archive/2026-09-10-escrituras-arbol-categorias/design.md`.
>
> **Citas `archivo:línea` re-verificadas con `grep` el 2026-09-11**, no
> heredadas: `upsertScrapedProduct` está en `:337` (no `:328`),
> `_translateCheckViolation` en `:481` (no `:454`). `sdd-apply` MUST re-greppear
> igual antes de tocar.
>
> **Ronda correctiva única tras `GATE: FAIL`.** Seis defectos confirmados (2
> altos) más cinco huecos de implementación, cerrados en § Correcciones
> aplicadas. Dos de esas correcciones destaparon un hallazgo **nuevo** que el
> gate no nombró: `shops.integration.test.ts:35-37,48` afirma `productsCount`
> absolutos y **cualquier** fila centinela `publish`/`visibility_public` viva
> los rompe desde otro worker de vitest — ver DD29-10.

## Technical Approach

Tres funciones nuevas en `packages/db/src/repositories/products.repository.ts`
(mismo archivo que las lecturas y que `upsertScrapedProduct`, `D-2`), dos
lecturas mínimas de propiedad, y tres métodos de Nest migrados. La forma
general es la de `categories` (US-28): input tipado campo a campo, guardas de
dominio **antes** del write, `translateCatalogWriteError` en el `catch`,
`toWriteHttpException(error)` como única línea del `catch` del servicio.

Cinco cosas son propias de `products` y son el contenido real de la US:

| # | Propio de `products` | Consecuencia |
|---|---|---|
| 1 | **Cinco** expresiones CHECK/`IN`, de las que solo 1 se hereda (y adaptada) | Tabla de guardas de DD29-2 (Herencia 2) |
| 2 | **Tres** FK salientes, **dos** sets de pivote y **cinco** campos numéricos | Frontera numérica de DD29-3, en dos niveles y dos familias |
| 3 | Es el primer agregado con **propiedad por tienda** | Secuencias de DD29-4, 404-antes-de-403 |
| 4 | Los errores de precio existentes **NO** están en el conjunto cerrado | DD29-1 — el hallazgo que decide si `CA-4` cierra |
| 5 | Sus filas son **contadas por otros archivos de test** en paralelo | DD29-10 — aislamiento del centinela |

## Architecture Decisions

### DD29-1 — Los tres errores de `products` degradan hoy a **500**: hay que darles un `code` del conjunto cerrado

**Hallazgo verificado de punta a punta** (confirmado también por el gate).
`InvalidSalePriceError`, `MissingPriceError` e `IncompleteProvenanceError`
(`products.repository.ts:446,456,466`, literales de `code` en `:447,457,467`)
extienden `Error` con `code` `'PRODUCT_INVALID_SALE_PRICE'` /
`'PRODUCT_MISSING_PRICE'` / `'PRODUCT_INCOMPLETE_PROVENANCE'`.
`isCatalogWriteError` (`domain-errors.ts:112-116`) es un guard **estructural
por `code`** contra los 5 valores de `CATALOG_ERROR_CODES`: ninguno de esos
tres pertenece. Por tanto `mapDomainError` devuelve `null`
(`domain-error.mapper.ts:82`), `isConnectionFailure` también, y
`toWriteHttpException` cae al `InternalServerErrorException` literal
(`:154`) → **HTTP 500**.

Consecuencia: `D29-2`/`D29-3` tal como están escritas —«reutilizar
`InvalidSalePriceError`/`MissingPriceError` y `_translateCheckViolation`»—
producirían **500** en los dos `curl` más citados de `CA-4`, y la red de
seguridad (`_translateCheckViolation`, que devuelve **esas mismas clases**)
sería una red que garantiza el 500 en vez de evitarlo.

**Elección**: las tres clases pasan a extender `CatalogWriteError` con
`code = CATALOG_ERROR_CODES.InvalidReference`. Como `CatalogWriteError` es
**abstracta y su constructor es `(message, aggregate)`**
(`domain-errors.ts:30-38`), cada `super(...)` cambia a
`super(<mismo mensaje>, 'products')`. Se conservan `name`, textos e
`instanceof`. Todo ocurre dentro de `products.repository.ts` — archivo que
esta US ya modifica. `git diff` de `domain-errors.ts`,
`domain-error.mapper.ts` y `slug.ts` sigue **vacío** (`CA-7`), y el cuerpo de
`upsertScrapedProduct` no se toca.

**Riesgo de regresión: nulo, medido.** `ripgrep` repo-wide: los literales solo
existen en `products.repository.ts:447,457,467`; el único import externo es
`products.integration.test.ts:16`, que asserta con `toBeInstanceOf` en `:331`
y sobrevive. El barrel las exporta (`index.ts:96,97,99`) pero ningún servicio
de Nest las importa, y el scraper es Python (psycopg directo).

**Alternativas rechazadas**: (a) no reusarlas y lanzar `InvalidReferenceError`
crudo — contradice la instrucción literal de la US, degrada los mensajes y
**deja el backstop en 500**; (b) un sexto código — prohibido por `CA-7`; (c)
tocar el mapeador — prohibido por `CA-7`.

### DD29-2 — `D29-8` **ratificada**: `product_type`/`status` fuera del `IN` lanzan `InvalidReferenceError` (cierra la pendiente #1)

De los 5 códigos, solo `EmptySlug` e `InvalidReference` mapean a 400.
`EmptySlugError` habla de normalización de slug: forzarlo mentiría. El mensaje
de `InvalidReferenceError` (`domain-errors.ts:60-64`) tiene plantilla fija y el
**único lever es `field`** — precedente literal `DD28-3`, donde `categories` ya
usa esta clase para 5 reglas que **no son FK** (autorreferencia, ciclo, tope de
saltos, type de las hijas). Generaliza a «argumento inválido».

| Regla | `field` (discriminador) | `value` |
|---|---|---|
| `product_type` fuera del `IN` | `` product_type (fuera de IN ('simple','variable')) `` | el valor recibido |
| `status` fuera del `IN` | `` status (fuera de IN ('publish','draft')) `` | el valor recibido |
| Número no finito / fuera de rango (DD29-3) | `` price (no es un número finito) ``, etc. | el valor recibido |

**Divergencia declarada** (idéntica a la #2 de US-28): el sufijo genérico
«referencia un registro inexistente» es impreciso; el token discriminante va
delante y es greppable. Los textos exactos **se observan** en `sdd-apply`.

### DD29-3 — Frontera numérica: dos niveles × dos familias (refina `D29-4`)

`D29-4` tiene **dos mitades** y el borrador anterior de este design solo
especificó una. Aquí se especifican las dos.

**Mitad A — predicado.** `D29-4` dice `Number.isInteger`. **Se refina a
`Number.isSafeInteger`**: el `GATE: FAIL` posterior al PR#2 de US-28 demostró
que `Number.isInteger(1e21)` es `true`, el valor llega a Prisma, el driver
lanza `Value out of range` **sin `.code`** y degrada a 500 (rationale
documentado en `categories.repository.ts:305-317` y
`categories.service.ts:284-292`).

**Mitad B — los cinco campos numéricos que NO son ids.** `proposal.md:100` y
US-29 `:229-231` obligan a aplicar el criterio de `parseFiniteNumber` a
`price`, `sale_price`, `quantity`, `min_price` y `max_price`. Sin esa guarda,
`POST /products {"price":"abc"}` → `Number("abc")` = `NaN` → conversión a
`Decimal` de Prisma sin `.code` → atraviesa los dos traductores → **500**, y
`{"quantity":"1.5"}` igual contra `Int`. Viola `CA-4` y
`specs/product-write-api/spec.md:62-80`.

**`parseFiniteNumber` NO se reutiliza ni se ensancha su firma.** Es un helper
module-private de `products.service.ts:42-45` cuyo contrato documentado es
**descartar en silencio** (`undefined`) para preservar el 200 del mock en el
query-string; es lo contrario del 400 que aquí hace falta, y
`parseProductSearch` está fuera de alcance. Se re-expresa **el criterio** en
dos guardas nuevas del repositorio, hermanas de `_assertIntegerRef`.

| Nivel | Dónde | Qué cubre | Fallo |
|---|---|---|---|
| **A** | `products.service.ts` | el `:id` de la ruta en `update`/`remove`: `!Number.isSafeInteger(id) \|\| id <= 0` | **404** (precedente `categories.service.ts:298`) |
| **A'** | `findShopOwnerById` | su propio argumento: si no es entero seguro **y positivo** devuelve `null`, **nunca lanza** | ninguno (cae al nivel B) |
| **B1** | `_assertIntegerRef(value, field)` | `typeId`, `shopId`, `manufacturerId` y **cada** id de `categoryIds[]`/`tagIds[]` | `InvalidReferenceError` → **400** |
| **B2** | `_assertFiniteNumber(value, field)` | `price`, `salePrice`, `minPrice`, `maxPrice` | `InvalidReferenceError` → **400** |
| **B3** | `_assertIntegerCount(value, field)` | `quantity` | `InvalidReferenceError` → **400** |

**Ids no positivos — regla explícita para los dos niveles** (el gate pidió
cerrarlo): el nivel **A** SÍ lleva `id <= 0` (ningún id real del catálogo es
≤ 0; rechazarlo con 404 ahorra un round trip — precedente
`categories.service.ts:298`). El nivel **B1** NO lo lleva, calcado de
`categories.repository.ts:328-331` y por su rationale documentado (`:319-326`):
un id no positivo **es representable como `bigint`**, no revienta al driver, y
ya resuelve en un 400 correcto vía `P2003`/la sonda de existencia. Añadir
`<= 0` en B1 sería una regla de negocio nueva, no autorizada.

**`_assertFiniteNumber` acota además el rango de `numeric(12,2)`**
(`|v| >= 1e10` → 400): sin esa mitad, `{"price": 1e300}` produce un
`numeric field overflow` de Postgres **sin `.code`** → 500, exactamente la
misma familia de defecto que `Number.isSafeInteger` cierra para los ids. Es
una condición más en la misma guarda, exigida por «nunca 500» (`CA-4`).

El nivel A' existe porque el servicio consulta `shops` **antes** de que corra
el nivel B: sin él, `{"shop_id":"abc"}` → `prisma.shop.findUnique({where:{id:
NaN}})` → `BigInt(NaN)` → `RangeError` sin `.code` → **500**. Es el defecto que
el Data Flow de US-28 documenta para `{"parent":"abc"}`, trasladado a la sonda
de propiedad.

`_assertIntegerRef` se **reescribe local** en `products.repository.ts` (8
líneas, `aggregate: 'products'`): la de `categories` es module-private y
hardcodea su agregado. Duplicación deliberada — `CA-7` prohíbe crear piezas
compartidas nuevas en esta US.

El servicio coerciona con `Number(...)` antes de construir el input (réplica de
`DD28-10`): sin `transform` en el `ValidationPipe` (`main.ts:9`),
`{"type_id":"9"}` llega **string** y sin coerción el nivel B daría un 400 que
culpa a un `type_id` que sí existe.

### DD29-4 — Propiedad por tienda: orden explícito y short-circuit de `super_admin` (cierra la pendiente #4)

`D29-1` **ratificada tal cual**, incluida la mutabilidad de `shop_id`. Dos
lecturas mínimas nuevas, de solo lectura e incapaces de lanzar:

- `findShopOwnerById(id): Promise<number | null>` en `shops.repository.ts`
  (`select: { ownerId: true }`). No existe hoy: el barrel solo exporta
  `findOrCreateShopBySlug`/`findShopBySlug`/`listShops`/`listShopsNear`, y
  `findShopBySlug` resuelve por slug.
- `findProductShopId(id): Promise<number | null>` en
  `products.repository.ts` (`select: { shopId: true }`). **Añadido por este
  design**, no previsto en la propuesta: `update`/`remove` necesitan el
  `shop_id` **actual** antes de escribir, y sin esta lectura el servicio no
  puede distinguir 404 de 403. ~10 líneas.

`super_admin` se detecta con `user.permissions.includes('super_admin')`
(`CurrentUserPayload.permissions`, `current-user.decorator.ts:12-18`); el
short-circuit salta **solo** `findShopOwnerById`, **nunca** el 404.

**Semántica de `null` — la parte que decide si se pierde un 400:**

| Sonda | `null` significa | Desenlace |
|---|---|---|
| `findShopOwnerById(shopId del body)` en `create`/`update` | la tienda destino **no existe** (o el id no es entero seguro positivo) | **NO es 403**: se deja pasar; el write falla con `P2003` → `InvalidReferenceError` → **400**. Idéntico desenlace que para `super_admin`, que nunca sondeó |
| `findShopOwnerById(shopId actual de la fila)` | la tienda desapareció entre dos lecturas (FK `NOT NULL` + `CASCADE`: la fila se está borrando) | **403** conservador: no se puede probar propiedad de una fila que se desvanece |
| `findProductShopId(id)` | el producto no existe | **404**, antes de cualquier evaluación de propiedad |

**El 400 por `shop_id` inexistente no se pierde**: lo produce la validación de
FK del repositorio (`P2003` → `translateCatalogWriteError` → 400), que corre
igual para los dos roles. Un rol nunca cambia el status de una misma petición.
404-antes-de-403 no filtra nada: `GET /products/:slug` es `@Public()`.

### DD29-5 — `deleteProduct` devuelve el snapshot **pre-borrado** (cierra la pendiente #3)

Precedente `DD28-1`, seguido sin divergir. `deleteProduct(id)` hace
`findUnique({ where: { id }, include: PRODUCT_INCLUDE })` **antes** del
`DELETE` — esa misma carga es la comprobación de existencia del
`find-then-delete` — y devuelve ese record; el servicio lo proyecta con
`toProductDto` sin ninguna rama especial.

- `updated_at` y `sold_quantity`: el valor que la fila tenía al capturarla. Un
  `DELETE` **no dispara** el trigger `products_updated_at` (`BEFORE UPDATE`,
  `db/schema.sql:488-489`), así que no hay ningún valor posterior con el que
  divergir: la fila deja de existir.
- `categories`/`tags` del snapshot listan los enlaces que el producto **tenía**;
  en la base ya cayeron por `ON DELETE CASCADE` (`db/schema.sql:425-435`). Es
  la misma divergencia declarada que `children` en `DD28-1`, y es **inocua**:
  `useDeleteProductMutation` (`apps/admin/rest/src/data/product.ts:74-81`)
  declara `onSuccess: () => { toast.success(...) }` (`:79`) **sin parámetro**.
  Contraste: `useUpdateProductMutation` (`:52-58`) sí usa `data?.slug`.
- Si `_toProductRecord` devuelve `null` (type/shop ya en cascada) →
  `RecordNotFoundError` → **404**, no el `InvalidReferenceError` de
  `upsertScrapedProduct:409-412`: allí la fila acababa de escribirse; aquí se
  está borrando sola y 404 es la respuesta honesta.

### DD29-6 — Pivotes: `deleteMany({}) + create([...])`, con deduplicación y **sonda de existencia**

`D29-5` ratificada en su forma (`upsertScrapedProduct:393-398`):

```ts
// create
categories: { create: uniq(input.categoryIds ?? []).map((categoryId) => ({ categoryId })) },
tags:       { create: uniq(input.tagIds ?? []).map((tagId) => ({ tagId })) },

// update — el spread condicional ES la semántica de tres estados
...(input.categoryIds !== undefined && {
  categories: { deleteMany: {}, create: uniq(input.categoryIds).map((categoryId) => ({ categoryId })) },
}),
...(input.tagIds !== undefined && {
  tags: { deleteMany: {}, create: uniq(input.tagIds).map((tagId) => ({ tagId })) },
}),
```

| Estado | Entrada | Efecto |
|---|---|---|
| ausente | `undefined` (la clave no entra en el input) | el pivote **no se toca** |
| vacío | `[]` | `deleteMany({})` + `create: []` → el set **se vacía** |
| con ids | `[3, 7]` | reemplazo completo |

**`undefined` vs `null` vive en el servicio, no en el tipo**: `CreateProductInput`
declara `categoryIds?: number[]` — `null` **no es representable**. El predicado
de inclusión es `Array.isArray(dto.categories)`, no `!== undefined`: así un
`categories: null` del cliente se trata como ausente en vez de reventar en
`null.map(...)`.

`uniq = [...new Set(ids)]`: `categories: [5,5]` violaría la PK compuesta de
`category_product` → `P2002` → `SlugConflictError` → **409** con un mensaje
sobre slugs. Una línea evita ese sinsentido.

**Sonda de existencia de los ids de pivote, normativa** (promovida desde
«Open Question» por el gate): antes del write,

```ts
// una consulta por tabla, no una por id
const found = await prisma.category.count({ where: { id: { in: uniqIds } } });
if (found !== uniqIds.length) throw new InvalidReferenceError('products', 'categories[]', …);
```

**Por qué no se deja al `P2003`**: `specs/product-write-api/spec.md:91-97` exige
**400** para `categories: [999999]`, y no está verificado que un `create`
anidado de Prisma 7 + `adapter-pg` emita `P2003` para la fila pivote (el propio
`createCategory` documenta que un `P2003` llega **sin** `meta.field_name`,
`categories.repository.ts:475-485`). Si no lo emitiera, el spec se incumpliría
con un **500** descubierto en PR#2. Dos `count` cuestan ~25 líneas, dan un
mensaje preciso en vez del `'desconocida'` genérico, y eliminan la apuesta. El
`catch` con `translateCatalogWriteError` permanece como backstop para la
carrera (categoría borrada entre la sonda y el write).

### DD29-7 — Derivaciones sobre el estado efectivo, con `!== undefined` (no `??`)

`D29-6` ratificada y **corregida**. El estado efectivo se calcula con
`effectiveX = input.X !== undefined ? input.X : current.X`, **nunca**
`input.X ?? current.X`.

**Por qué `??` está mal** (defecto D4 del gate): `PUT {"price": null}` sobre un
`simple` → `null ?? current.price` = `current.price` → la guarda pasa → Prisma
escribe `price = NULL` → Postgres dispara `products_simple_con_precio`. DD29-1
lo convierte en 400 y no en 500, pero contradice
`specs/product-write-api/spec.md:69` («MUST rechazar **antes del write**») y la
afirmación de este design de que las 5 expresiones son inalcanzables. `!==
undefined` es además el mismo discriminador que ya usan los pivotes y los
spreads condicionales del `data`.

- `simple`: `minPrice = maxPrice = price`, **derivados, nunca leídos del
  input**. Motivo correcto (el borrador anterior daba uno equivocado): el DDL
  (`schema.sql:340-344`) y `upsertScrapedProduct:356-357` los definen iguales a
  `price` por construcción; leerlos del input dejaría que un `min_price` no
  nulo heredado de una conversión `variable`→`simple` desalineara los tres
  precios sin que ninguna guarda lo vea.
- `variable`: `price` queda `NULL` y se persisten los `min/max` que el admin ya
  calculó (`calculateMinMaxPrice`, `form-utils.ts:79-96`). Sin tablas de
  variaciones (fuera de alcance) no hay dato para recalcular.
- `inStock`: si no viene y sí `quantity` → `quantity > 0`; si no viene ninguno,
  la clave **no se incluye** en el `data` y la columna toma su `DEFAULT true`
  (`db/schema.sql:351`).
- `image` / `gallery` — regla de spread condicional (hueco #5 del gate):
  `...(input.image != null && { image: input.image })`, ídem `gallery`.
  `Prisma.InputJsonValue` **no admite `null`** (para eso existen
  `Prisma.DbNull`/`JsonNull`), `gallery` es `jsonb NOT NULL DEFAULT '[]'`
  (`schema.sql:368`) e `image` es `jsonb` nullable (`:367`). Precedente exacto
  ya embarcado: `createCategory` (`categories.repository.ts:467`, `DD-5` de
  US-27b). **Consecuencia declarada**: un `PUT {"image": null}` es un **no-op**
  — el admin no puede vaciar la imagen por esta ruta. Divergencia #10.
- `updatedAt` **no se fija a mano**: lo pone el trigger `products_updated_at`
  con el reloj de Postgres. Corolario (igual que `DD28-7`): `_setNowProvider`
  no afecta a esta columna — la aserción de `CA-2` es de **monotonía**
  (`toBeGreaterThanOrEqual`), nunca de igualdad.
- `slug`: `generateSlug({name, slug}, productSlugs, 'products')` en `create`;
  en `update` es inmutable **a nivel de tipo**, y si llega `name` se llama
  `normalizeSlug(input.name, 'products')` **descartando el resultado**, solo
  por su efecto lateral `EmptySlugError` → 400 (`products.name` es `text NOT
  NULL` donde `''` es legal). `productSlugs: ExistingSlugLookup` es **local**:
  el nombre de tabla nunca llega a `slug.ts` (`CA-7`).

### DD29-8 — Proyección: una sola operación con `include: PRODUCT_INCLUDE`

`D29-7` ratificada. `PRODUCT_INCLUDE` (`products.repository.ts:44-50`) es
module-private y las tres funciones nuevas viven en el **mismo archivo**: se
reutiliza sin exportarlo. Las tres devuelven `Promise<ProductRecord>` pasando
por `_toProductRecord` (`:521`), que es lo que garantiza que `toProductDto`
(`products.service.ts:116-150`) encuentre `record.type.id` y `record.shop.slug`.
`products` no es recursivo: el `include` plano alcanza en una operación, sin el
re-fetch `_loadNode` que `categories` necesitaba. La respuesta es
`toProductDto` tal cual: **20 claves**, sin `related_products`.

### DD29-9 — Guarda 1 se hereda **adaptada**, no literal

`upsertScrapedProduct:340-342` lee
`input.salePrice != null && input.salePrice >= input.price`, escrito donde
`price: number` es **obligatorio**. En el input del admin `price` es nullable y
un `variable` legítimamente tiene `price === null`: `salePrice >= null`
coerciona a `salePrice >= 0` y produciría un **400 espurio** en todo
`variable` con `sale_price`. El DDL discrepa explícitamente:
`CHECK (sale_price IS NULL OR price IS NULL OR sale_price < price)`
(`db/schema.sql:394`). La guarda del admin MUST llevar el disyunto
`price != null`:

```ts
if (salePrice != null && price != null && salePrice >= price) throw new InvalidSalePriceError(salePrice, price);
```

`upsertScrapedProduct` **no se toca**: allí la forma literal es correcta
porque su tipo garantiza `price: number`.

### DD29-10 — Aislamiento del centinela: `fileParallelism: false` (ratifica y endurece `D29-9`)

**Defecto de alto impacto que el gate destapó.** No existe `vitest.config.*` en
`packages/db` (solo `"test": "vitest run"`, `package.json:12`), así que
`fileParallelism` está **ON**: los archivos de integración corren
concurrentemente contra el **mismo** Postgres, y cualquier fila centinela viva
es visible para todos. Los conteos absolutos afectados, verificados:

| Archivo | Aserción | Qué la rompe |
|---|---|---|
| `categories.integration.test.ts` | `toBe(83)` (`:60`), `toBe(198)` (`:65`), `visited.size` `toBe(198)` (`:113`) | una **categoría** centinela viva, con cualquier prefijo |
| `shops.integration.test.ts` | `productsCount` `toBe(584)`/`toBe(82)`/`toBe(188)` (`:35-37`), `toBe(44)` (`:48`) | un **producto** centinela vivo con `publish`/`visibility_public` en esa tienda (**hallazgo nuevo**: no lo nombró el gate, y es un flake latente que ya existe hoy con `TEST_STORE`) |
| `products.integration.test.ts` | `toBe(1199)` (`:177`), `toBe(11)` + la lista literal de ids (`:148-151`), `toBe(1)` (`:162`,`:247`,`:256`) | un producto centinela vivo — ver abajo |

El razonamiento del borrador anterior («el prefijo nunca colisiona con
`zz-categories-`») era cierto **e irrelevante**: la colisión es de **conteo**,
no de nombre, y el orden dentro de un archivo no gobierna otros archivos.

**Elección: añadir `packages/db/vitest.config.ts` con
`test: { fileParallelism: false }`** (~8 líneas). Serializa los archivos de
integración, que son E/S contra una sola base y no ganan nada corriendo en
paralelo. Cierra las tres filas de la tabla de una vez, **incluido el flake
preexistente de `shops`**, y no exige coordinar prefijos entre archivos.
**Superficie nueva que el alcance no anticipaba: se declara aquí y `sdd-tasks`
debe costearla.**

**Segunda medida, acumulativa**: la suite de vitest **no crea categorías ni
tags**. Enlaza los productos centinela a categorías/tags **sembradas**,
resueltas por slug en el `beforeAll` (patrón `TYPE_A`/`TYPE_B` de
`categories.integration.test.ts:33-37`). Escribir filas en `category_product`
no altera ningún conteo afirmado por nadie, y el `CASCADE` las retira al borrar
el producto. Por eso **la Herencia 1 vive íntegra en la evidencia manual
HTTP + `psql`** (que es lo que la DoD pide: `POST /categories` →
`POST /products` → `DELETE /categories/:id` → `psql`), nunca dentro de vitest,
y **el `cleanup` toca una sola tabla**.

**Alternativas rechazadas**: (a) secuenciar solo esos dos archivos —
`shops.integration.test.ts` demuestra que el acoplamiento no es de dos
archivos; (b) dejar Herencia 1 en vitest con `--no-file-parallelism` por CLI —
no queda versionado y `just db-check` no lo pasaría.

## Contratos de tipos

```ts
// packages/db/src/repositories/products.repository.ts  (público)
export interface CreateProductInput {
  name: string;                     // products.name  text NOT NULL
  slug?: string | null;             // fuente del slug si llega no vacío (product-form.tsx:147)
  description?: string;             // DEFAULT ''
  typeId: number;                   // type_id  bigint NOT NULL  (schema.sql:331)
  shopId: number;                   // shop_id  bigint NOT NULL  (:332)
  manufacturerId?: number | null;   // manufacturer_id  SET NULL (:333) — null explícito es válido
  productType?: string;             // DEFAULT 'simple'; guarda IN (:335-336)
  price?: number | null;            // numeric(12,2) (:345)
  salePrice?: number | null;        // numeric(12,2) (:346)
  minPrice?: number | null;         // derivado, NO leído, si el tipo efectivo es 'simple' (DD29-7)
  maxPrice?: number | null;
  quantity?: number;                // integer NOT NULL DEFAULT 0 (:350)
  inStock?: boolean;                // ausente ⇒ quantity > 0, o DEFAULT true (:351)
  sku?: string | null;
  unit?: string;                    // DEFAULT '1 pc'
  status?: string;                  // DEFAULT 'publish'; guarda IN (:359-360)
  visibility?: string;              // DEFAULT 'visibility_public'; SIN CHECK en el DDL (:361)
  image?: Prisma.InputJsonValue;    // jsonb nullable (:367); `null` ⇒ ausente (DD29-7)
  gallery?: Prisma.InputJsonValue;  // jsonb NOT NULL DEFAULT '[]' (:368)
  isTaxable?: boolean;
  isDigital?: boolean;
  isExternal?: boolean;
  externalProductUrl?: string | null;
  language?: string;                // DEFAULT 'es'
  categoryIds?: number[];           // pivote category_product (:425-429)
  tagIds?: number[];                // pivote product_tag (:431-435)
}

/** `slug` inmutable por tipo (CA-2); `shopId` SÍ mutable (decisión de producto). */
export type UpdateProductInput = Partial<Omit<CreateProductInput, 'slug'>>;

export async function createProduct(input: CreateProductInput): Promise<ProductRecord>;
export async function updateProduct(id: number, input: UpdateProductInput): Promise<ProductRecord>;
export async function deleteProduct(id: number): Promise<ProductRecord>;
export async function findProductShopId(id: number): Promise<number | null>;

// packages/db/src/repositories/shops.repository.ts
/** `ownerId` de una tienda por id. `null` si no existe o si `id` no es entero
 *  seguro positivo. NUNCA lanza (DD29-3, nivel A'). */
export async function findShopOwnerById(id: number): Promise<number | null>;

// privadas (no van al barrel)
const productSlugs: ExistingSlugLookup;
function _assertIntegerRef(value: number | null | undefined, field: string): void;   // B1
function _assertFiniteNumber(value: number | null | undefined, field: string): void; // B2
function _assertIntegerCount(value: number | undefined, field: string): void;        // B3
function _assertProductType(value: string | undefined): void;
function _assertStatus(value: string | undefined): void;
function _assertPriceRules(productType: string, price: number | null, salePrice: number | null): void;
async function _assertPivotIdsExist(categoryIds?: number[], tagIds?: number[]): Promise<void>;
```

**Ausentes a propósito** (`R29-6`, alcance vinculante): `sourceStore`,
`sourceProductId`, `sourceUrl`, `scrapedAt`, `soldQuantity`, `ratings`,
`totalReviews`, `translatedLanguages`, y todo lo que el formulario envía sin
columna (`variations`, `variation_options`, `author_id`, `digital_file`,
`height`/`length`/`width`, `in_flash_sale`). El input se construye **campo a
campo** en el servicio; nunca `...body`.

Barrel `packages/db/index.ts`: `CreateProductInput`/`UpdateProductInput` al
bloque `export type` y `createProduct`/`updateProduct`/`deleteProduct`/
`findProductShopId`/`findShopOwnerById` al `export`, en orden alfabético.
**Único archivo compartido con US-30**: quien arranque segundo rebasea.

**`CreateProductDto` — corrección** (hueco #2 del gate): `type_id` y `shop_id`
**ya existen** en el DTO, porque `Product` los declara
(`entities/product.entity.ts:25,34`) y `OmitType` no los excluye
(`create-product.dto.ts:4-18`). Lo genuinamente ausente es **solo**
`manufacturer_id` (no está en `Product`). El cambio del DTO se reduce a:
`manufacturer_id?: number` standalone + documentar los campos que se aceptan y
descartan. Sin efecto de runtime: `main.ts:9` registra `new ValidationPipe()`
sin `whitelist` ni `transform` — es corrección de Swagger y de tipos.

## Las cinco guardas (Herencia 2)

| # | Regla | DDL | Origen | Error de dominio | HTTP |
|---|---|---|---|---|---|
| 1 | `products_rebaja_valida` (`sale_price < price`) | `schema.sql:393-394` | **Heredada y adaptada** de `upsertScrapedProduct:340-342` — DD29-9 añade el disyunto `price != null` | `InvalidSalePriceError` | 400 |
| 2 | `products_simple_con_precio` | `:398-399` | **Nueva** (el scraper la cumple por tipo: `price: number`) | `MissingPriceError` | 400 |
| 3 | `product_type IN ('simple','variable')` | `:335-336` | **Nueva** (el scraper fija el literal `'simple'`) | `InvalidReferenceError` (DD29-2) | 400 |
| 4 | `status IN ('publish','draft')` | `:359-360` | **Nueva** (el scraper nunca envía `status`) | `InvalidReferenceError` (DD29-2) | 400 |
| 5 | `products_procedencia_completa` | `:403-404` | **Por construcción**: el input del admin no declara `source_*` ⇒ `num_nonnulls = 0` ∈ `(0,2)` | — (sin guarda de runtime) | n/a |

Las filas 1 y 2 **solo cuentan como 400 gracias a DD29-1**. Las 4 guardas
corren sobre el estado **efectivo** (DD29-7), por eso ninguna de las 5
expresiones es alcanzable como violación de CHECK sobre HTTP. `visibility` no
lleva CHECK (`:361`): no se inventa una guarda. El índice único parcial
`products_procedencia_key` (`:411-413`) tiene `WHERE source_store IS NOT NULL`:
**ni se evalúa** para filas del admin — no se defiende contra él.

## Traducción de errores

`catch` de las tres funciones nuevas, en este orden y solo en este:

```ts
} catch (error) {
  // 1º: códigos de Prisma EXACTOS (P2002/P2003/P2025). Devuelve el error
  //     intacto si no reconoce el código (domain-errors.ts:135-163).
  // 2º: match por SUBSTRING del nombre del constraint (products.repository.ts:481).
  throw _translateCheckViolation(
    translateCatalogWriteError(error, { aggregate: 'products', id })
  );
}
```

El orden es normativo: `translateCatalogWriteError` discrimina por `.code`,
exacto y barato; `_translateCheckViolation` hace `message.includes(...)`,
difuso, y podría capturar un `P2003` cuyo texto mencione el constraint. Ambos
son **pass-through** si no reconocen, así que componen sin perder información.
**Sin `uniqueField`** en el contexto, siguiendo la corrección de
`createCategory` (`categories.repository.ts:475-488`): bajo Prisma 7 +
`adapter-pg` un `P2003` llega sin `meta.field_name` y un `uniqueField: 'slug'`
fijo culparía a `slug` de una FK rota.

| Origen | Error | Status |
|---|---|---|
| `normalizeSlug`/`generateSlug` con `name` vacío | `EmptySlugError` | **400** |
| `_assertIntegerRef` (3 FK + ids de pivote) | `InvalidReferenceError` | **400** |
| `_assertFiniteNumber` (`price`, `sale_price`, `min_price`, `max_price`) | `InvalidReferenceError` | **400** |
| `_assertIntegerCount` (`quantity`) | `InvalidReferenceError` | **400** |
| `_assertProductType` / `_assertStatus` | `InvalidReferenceError` | **400** |
| `_assertPivotIdsExist` (categoría/tag inexistente) | `InvalidReferenceError` | **400** |
| `_assertPriceRules` | `InvalidSalePriceError` / `MissingPriceError` | **400** *(gracias a DD29-1)* |
| FK inexistente (`P2003`): `type_id`, `shop_id`, `manufacturer_id` | `InvalidReferenceError` | **400** |
| `findProductShopId` → `null`, `P2025`, snapshot roto | `RecordNotFoundError` | **404** |
| `slug` colisionado por carrera (`P2002`) | `SlugConflictError` | **409** |
| Propiedad ajena | `ForbiddenException` (Nest, no dominio) | **403** |
| Postgres caído | *(ninguno)* | **503** |
| Las 5 expresiones CHECK/`IN` | *(no traducibles)* | ~~500~~ **inalcanzables** |

`DependentRowsError` (409) es **inalcanzable**: ambos pivotes son `ON DELETE
CASCADE` hacia `products`; no hay guarda de dependientes.

## Secuencias

```
POST /products                        PUT /products/:id                    DELETE /products/:id
 guard ADMIN_OWNER_AND_STAFF           guard ADMIN_OWNER_AND_STAFF          guard ADMIN_OWNER_AND_STAFF
  └ 401 sin token / 403 customer        └ 401 / 403                          └ 401 / 403
 ── servicio ──                        ── servicio ──                       ── servicio ──
 1 shopId = Number(dto.shop_id)        1 !isSafeInteger(id)||id<=0 → 404    1 !isSafeInteger(id)||id<=0 → 404
 2 isSuperAdmin?  ── sí → salta 3      2 findProductShopId(id)              2 findProductShopId(id)
 3 findShopOwnerById(shopId)               └ null → 404                         └ null → 404
    ├ ≠ sub          → 403             3 isSuperAdmin? ── sí → salta 4-5     3 isSuperAdmin? ── sí → salta 4
    └ null (no existe) → sigue         4 findShopOwnerById(actual)           4 findShopOwnerById(actual)
 4 CreateProductInput campo a campo         ├ ≠ sub → 403                        ├ ≠ sub → 403
    Number(), Array.isArray()               └ null → 403 (fila en cascada)       └ null → 403
 ── repositorio: createProduct ──      5 body mueve shop_id?               ── repositorio: deleteProduct ──
 5 _assertIntegerRef ×(3 FK + ids)         findShopOwnerById(destino)       5 findUnique + PRODUCT_INCLUDE
   _assertFiniteNumber ×4                  ├ ≠ sub → 403                        └ null → 404  (snapshot)
   _assertIntegerCount (quantity)          └ null → sigue (→400 en 9)       6 prisma.delete  ── CASCADE
    ◄── aquí muere el NaN              6 UpdateProductInput campo a campo        vacía ambos pivotes
 6 _assertProductType / _assertStatus  ── repositorio: updateProduct ──     7 return snapshot PRE-borrado
 7 _assertPriceRules (tipo efectivo)   7 normalizeSlug(name)? → 400
 8 _assertPivotIdsExist (2 count)      8 guardas 5-6 de create (mismas)
 9 generateSlug(productSlugs)          9 current = findUnique → null → 404
10 prisma.create + PRODUCT_INCLUDE    10 efectivo = input !== undefined
    └ catch → translate ×2                  ? input : current
11 _toProductRecord → null?               _assertPriceRules + pivotes
    InvalidReferenceError             11 prisma.update (SIN updatedAt)
                                          pivotes: deleteMany + create
      │                                    │                                    │
      └────────────► servicio: toProductDto(record) — 20 claves ◄───────────────┘
                     catch → toWriteHttpException(error)
```

**Lo normativo del orden**, no lo estético:

1. **404 antes que 403** en `update`/`remove`: la propiedad se evalúa sobre el
   `shop_id` **actual**, que exige tener la fila. No filtra nada
   (`GET /products/:slug` es `@Public()`).
2. **`shop_id` actual antes que el del body**: mover un producto exige propiedad
   de **ambas** tiendas; el orden hace que un no-dueño reciba 403 por su propia
   fila antes de que el destino importe.
3. **El short-circuit de `super_admin` salta solo la sonda de `shops`**, nunca
   el 404 ni las guardas del repositorio (DD29-4).
4. **Toda la frontera numérica antes de cualquier `findUnique`/`create`** que use
   esos valores: es donde mueren el `NaN` que si no llega a `BigInt(NaN)` y el
   `"abc"` que si no llega a `Decimal` — ambos 500.
5. **Guardas de referencia y de pivote antes de `generateSlug`** (precedente
   `DD28-8`): no se consume un slug para una escritura que va a fallar.
6. **Estado efectivo con `!== undefined`, no `??`** (DD29-7).

## Estrategia de test

| Capa | Qué se prueba | Cómo |
|---|---|---|
| Integración (vitest) | crear `simple`/`variable`, pivotes en los 3 estados, slug invariante, las 4 guardas, 3 FK + 2 pivotes inexistentes, **no enteros y no finitos**, 404, snapshot del `delete`, `updatedAt` monótono | `products.integration.test.ts` contra Postgres real (`just db-check`) |
| Unidad (jest) | proyección de 20 claves en orden, `Number()` de las 3 FK, id `NaN` → 404, los 5 roles de `CA-5`, cada error de dominio → su status | `products.service.spec.ts`, `@safari/db` mockeado |
| Manual | secuencia `POST/GET/reinicio/PUT/DELETE`, los `curl` de `CA-4`/`CA-5`/`CA-6`, **Herencia 1 completa**, smoke del admin | `curl` + `node -e` (**`jq` no está instalado**) |

**Aislamiento (DD29-10 + `D29-9`).** `packages/db/vitest.config.ts` con
`fileParallelism: false` **y** un centinela por prefijo de slug
`zz-products-`, que la suite aplica **solo a `products`**:

```ts
const SENTINEL_PREFIX = 'zz-products-';
const cleanupSentinel = () =>
  prisma.product.deleteMany({ where: { slug: { startsWith: SENTINEL_PREFIX } } });
```

- **Una sola tabla**, porque la suite no crea categorías ni tags (DD29-10):
  enlaza a filas **sembradas**, resueltas por slug en el `beforeAll`.
- Se **pliega dentro del `beforeAll` (`:29-31`) y del `afterAll` (`:33-36`)
  EXISTENTES**, junto al `deleteMany({ sourceStore: TEST_STORE })` que ya
  tienen. **Motivo corregido** (defecto D5 del gate): el rationale heredado de
  `proposal.md:130` está **invertido** — con el default `sequence.hooks:
  'stack'` los `afterAll` corren en orden **inverso** al de registro
  (`@vitest/runner`, `chunk-artifact.js:681` y `:2570`), así que un segundo
  `afterAll` correría **antes** del `$disconnect()`, no después. La razón real
  para plegarlo es **no depender de un default configurable**: cambiar
  `sequence.hooks` a `'list'` (una línea del config que esta US **sí** añade)
  invertiría el orden y dejaría la limpieza corriendo contra un cliente ya
  desconectado. Un solo hook no tiene ese modo de fallo.
- `TEST_STORE` (`:23`) **no sirve** para estas filas: `source_store` es `NULL`
  en todo producto del admin (`db/schema.sql:381-382`).
- **Los describes de escritura van DESPUÉS** de los de lectura (vitest ejecuta
  los `describe` en orden de archivo) **y cada `it` borra lo que crea**.
  Rationale completo (hueco #4 del gate): no basta con el caso
  `publish`/`visibility_public` → `toBe(1199)` (`:177`). El test de `:148-151`
  usa `applyStorefrontDefaults: false` y `maxQuantity: 9`, y `quantity` tiene
  `DEFAULT 0`: **cualquier** fila centinela viva —publicada o no— entra en ese
  conteo y además rompe la **lista literal de ids** que asserta a continuación.
  `beforeAll(cleanup)` cubre la corrida abortada previa.
- **Herencia 1 es evidencia manual, no un test de vitest**: `POST /categories`
  (categoría centinela, **jamás una del seed** — borrar una sembrada rompería
  el `toBe(198)` de `categories.integration.test.ts`) → `POST /products` con
  esa categoría → `DELETE /categories/:id` → `psql`
  `SELECT count(*) FROM category_product WHERE category_id = :id` → **0**.
  Cierre obligatorio: borrar también el producto y la categoría centinela y
  comprobar `count(*) FROM categories` = **198**.
- Cierre de la corrida: `SELECT count(*) FROM products` → **1200**;
  `category_product` y `product_tag` de vuelta al conteo **medido antes de
  empezar** (no asumido en 0: el scraper puede haber dejado filas).

`products.service.spec.ts` (**20 `it` hoy**, todos de lectura) amplía su
`jest.mock('@safari/db', ...)` (`:36-43`) con `createProduct`, `updateProduct`,
`deleteProduct`, `findProductShopId` y `findShopOwnerById`; las clases de error
siguen reales vía `jest.requireActual`. `toWriteHttpException` **no pasa por
ese mock**: el servicio lo importa directo de
`src/common/errors/domain-error.mapper`, así que es real sin hacer nada. Los
20 `it` de lectura no se tocan.

## Riesgos → elemento que los neutraliza

| # | Riesgo | Neutralizado por |
|---|---|---|
| `R29-1` | CHECK sin pre-validar → 500 | Las 5 guardas + **DD29-1** (sin ella, las guardas 1 y 2 *eran* el 500) + **DD29-7** (estado efectivo) |
| `R29-2` | `BigInt(NaN)` / `Decimal("abc")` / overflow `numeric` → sin `.code` → 500 | **DD29-3**, dos niveles × tres guardas |
| `R29-3` | `toProductDto` revienta sin `type`/`shop` | **DD29-8**: `PRODUCT_INCLUDE` + `_toProductRecord` |
| `R29-4` | Agujero de autorización | **DD29-4**, secuencias con ambos lados del `PUT` |
| `R29-5` | Conteos del seed rotos, **también desde otro worker** | **DD29-10**: `fileParallelism: false` + centinela de una tabla + describes al final |
| `R29-6` | Spread del body a Prisma | Contratos campo a campo + `Array.isArray` |
| `R29-7` | `manufacturer_id` como opcional silencioso | `_assertIntegerRef` + `P2003`; `null` explícito sí es válido, probado aparte |
| `R29-8` | Desborde de volumen | Cadena de 4 PRs; corte preacordado: PR#4 → US-29b |
| `R29-9` | Primeros enlaces reales en `category_product` | No es regresión; se declara |
| `R29-10` | `dist/` obsoleto / vitest "0 tests" | Toda verificación abre con `just db-build`; revisar el casing `C:/DevOps/…` |
| **nuevo A** | `P2003` no emitido por un `create` anidado de pivote → 500 en vez del 400 del spec | **DD29-6**: sonda `count` normativa, no una apuesta |
| **nuevo B** | Duplicados en `categories[]` → 409 con mensaje de slug | `uniq()` en DD29-6 |
| **nuevo C** | `salePrice >= null` → 400 espurio en todo `variable` con rebaja | **DD29-9** |

## File Changes

| Archivo | Acción | Descripción |
|---|---|---|
| `packages/db/src/repositories/products.repository.ts` | Modify | +3 escrituras, +`findProductShopId`, +2 inputs, `productSlugs`, 4 guardas de CHECK/`IN`, 3 guardas numéricas, sonda de pivotes; **DD29-1** sobre las 3 clases de error (incluye sus `super(...)`). `upsertScrapedProduct`, `listProducts`, `findProductBySlug`, `_toProductRecord`, `PRODUCT_INCLUDE` **intactos** |
| `packages/db/src/repositories/shops.repository.ts` | Modify | +`findShopOwnerById` |
| `packages/db/index.ts` | Modify | 5 funciones + 2 tipos |
| `packages/db/src/repositories/products.integration.test.ts` | Modify | Centinela de una tabla en los hooks existentes + describes de escritura al final |
| `packages/db/vitest.config.ts` | **Create** | `fileParallelism: false` (DD29-10). **Superficie nueva declarada** |
| `apps/api/rest/src/products/products.service.ts` | Modify | 3 métodos migrados, propiedad, `Number()`; fuera `@db/products.json` (`:22`), `plainToClass` (`:7`,`:29`) y `private products` (`:154`) |
| `apps/api/rest/src/products/products.controller.ts` | Modify | `@CurrentUser()` en `:31`, `:49`, `:55`. **`@Permissions` sin tocar** |
| `apps/api/rest/src/products/dto/create-product.dto.ts` | Modify | **Solo** `manufacturer_id?` standalone + campos ignorados documentados (`type_id`/`shop_id` ya existen) |
| `apps/api/rest/src/products/products.service.spec.ts` | Modify | Escrituras, 5 roles, errores |
| `slug.ts`, `domain-errors.ts`, `common/errors/`, `product.entity.ts`, `db/schema.sql`, `apps/{shop,admin}` | **Unchanged** | `CA-7` + decisiones 1 y 14 |

## Divergencias declaradas

| # | Divergencia | Estado |
|---|---|---|
| 1 | `categories`/`tags` del `DELETE` reflejan los enlaces **pre-borrado** | Nueva, DD29-5; sin consumidor (`data/product.ts:74-81`) |
| 2 | Mensajes de 400 con sufijo genérico «referencia un registro inexistente» | Nueva, DD29-2; token discriminante al frente |
| 3 | `code` de las 3 clases de error de `products` pasa a `CATALOG_INVALID_REFERENCE` | Nueva, DD29-1; sin consumidor por `code` (medido) |
| 4 | `min_price`/`max_price` del body **se ignoran** para `simple` | Nueva, DD29-7 |
| 5 | `in_flash_sale: 0` y `type.logo: null` constantes | Preexistente (`products.service.ts:125,147`) |
| 6 | `created_at`/`updated_at`: 3 decimales vs. 6 del mock | Ya embarcada |
| 7 | `variations`/`variation_options`, `author_id`, `digital_file`, `height/length/width` se aceptan y descartan | Alcance vinculante de la US |
| 8 | Primeros enlaces reales en `category_product` | `R-6`, positivo, no regresión |
| 9 | `CLAUDE.md` dice "4 suites / 65 tests"; hoy hay 9 specs | Adyacente **mencionado y NO accionado** |
| 10 | `PUT {"image": null}` es un **no-op**: no se puede vaciar la imagen | Nueva, DD29-7; precedente ya embarcado (`DD-5`, US-27b) |
| 11 | La suite de integración pasa a correr **en serie** | Nueva, DD29-10; coste de tiempo a cambio de determinismo |

## Migration / Rollout

Sin migración ni DDL: **esta US no añade ni una columna**. Rollback y cadena de
4 PRs: `proposal.md:137-193`. Toda verificación abre con `just db-build`
(`dist/` gitignored) y reinicia la API; `just db-reset` **no** es necesario —
si pareciera serlo, se rompió la decisión 1: parar y preguntar.

**Re-anclaje tras la ronda correctiva**. El pronóstico de ~2100 (±250) no
contemplaba:

| Añadido | ~Líneas |
|---|---|
| `findProductShopId` (DD29-4) | 10 |
| `DD29-1` (3 clases + `super`) | 15 |
| `_assertFiniteNumber` + `_assertIntegerCount` + 5 call sites (DD29-3) | 40 |
| `_assertPivotIdsExist` (DD29-6) | 25 |
| `vitest.config.ts` (DD29-10) | 8 |
| `uniq()`, disyunto de DD29-9, `!== undefined` de DD29-7 | 10 |
| Casos de test de todo lo anterior | ~130 |
| **Total** | **~240** |

**~2340**, por encima del borde superior de la banda original (2350 es el
techo: `2100 + 250`). Se declara **al límite**: `sdd-tasks` debe partir de
**~2340**, no de ~2100, y el *caveat* vinculante se mantiene — si `sdd-apply`
desborda, el corte es **levantar PR#4 (`products.service.spec.ts`) a una
US-29b**.

## Decisiones ratificadas / revocadas

| Decisión | Estado | Motivo (una línea) |
|---|---|---|
| `D29-1` propiedad en el servicio, `super_admin` corta en seco | **Ratificada y detallada** | DD29-4 añade `findProductShopId` y la semántica de `null`; el 400 por tienda inexistente no se pierde |
| `D29-2` funciones hermanas, reusar errores y traductores | **Ratificada y corregida** | DD29-1: reusarlas tal cual daba 500; se les da un `code` del conjunto cerrado |
| `D29-3` pre-validar las 5 expresiones | **Ratificada y ampliada** | Guarda 1 **adaptada** (DD29-9) y evaluada sobre el estado efectivo (DD29-7) |
| `D29-4` frontera numérica | **Refinada en sus dos mitades** | DD29-3: `Number.isSafeInteger` (no `isInteger`); **y** las 5 magnitudes numéricas con guarda propia — el criterio de `parseFiniteNumber` se re-expresa, la función **no** se reutiliza ni se ensancha |
| `D29-5` pivotes por `deleteMany({}) + create([...])` | **Ratificada y ampliada** | DD29-6: `uniq()`, sonda de existencia normativa, y dónde se distingue `undefined` de `null` |
| `D29-6` derivaciones de `min/max` e `in_stock` | **Ratificada y corregida** | DD29-7: `!== undefined`, no `??`; `min/max` derivados para `simple`; regla de `image`/`gallery` |
| `D29-7` proyección con `PRODUCT_INCLUDE`, snapshot en `delete` | **Ratificada** | DD29-8 + DD29-5 (precedente `DD28-1` seguido sin divergir) |
| `D29-8` `InvalidReferenceError` para `product_type`/`status` | **Ratificada** | DD29-2: único 400 semánticamente defendible; precedente `DD28-3` |
| `D29-9` centinela `zz-products-` | **Ratificada y endurecida** | DD29-10: el prefijo no basta contra conteos de **otros archivos**; hace falta `fileParallelism: false` |

**Ninguna decisión revocada.**

## Correcciones aplicadas tras `GATE: FAIL`

| # | Defecto | Sev. | Dónde se cerró |
|---|---|---|---|
| D1 | Categorías centinela rompen `categories.integration.test.ts` entre workers (colisión de **conteo**, no de prefijo) | **Alta** | DD29-10: `vitest.config.ts` + la suite no crea categorías/tags + Herencia 1 a evidencia manual. **Hallazgo propio añadido**: `shops.integration.test.ts:35-37,48` sufre lo mismo con productos |
| D2 | Mitad no-entera de `D29-4` omitida ⇒ `{"price":"abc"}` → 500 | **Alta** | DD29-3 mitad B: `_assertFiniteNumber` + `_assertIntegerCount`, en secuencias, tabla de errores y ratificación |
| D3 | Guarda 1 heredada literal: `salePrice >= null` → 400 espurio | Media | DD29-9 + fila 1 de la tabla de guardas («heredada **y adaptada**») |
| D4 | `??` deja pasar un `null` explícito hasta el CHECK | Media | DD29-7: `!== undefined` |
| D5 | Rationale LIFO **invertido** citado como normativo | Baja | § Estrategia de test: mecanismo real (`afterAll` corre en orden inverso) y razón válida (no depender de un default configurable); se marca el origen en `proposal.md:130` |
| D6 | Prosa decía 3 tablas, el snippet limpiaba 2 | Baja | DD29-10: **una** tabla, porque la suite no crea categorías ni tags |
| H1 | Ids no positivos sin regla en el nivel B | — | DD29-3: A sí, B1 no, con el rationale de `categories.repository.ts:319-326` |
| H2 | `type_id`/`shop_id` ya existían en el DTO | — | § Contratos: solo `manufacturer_id` es nuevo |
| H3 | `P2003` de pivote era una Open Question bloqueante | — | DD29-6: sonda `count` normativa, costeada en el re-anclaje |
| H4 | Rationale de `toBe(11)` incompleto | — | § Estrategia de test: `applyStorefrontDefaults:false` + `quantity` DEFAULT 0 + la lista literal de ids |
| H5 | `image`/`gallery` sin regla de nulos | — | DD29-7 + divergencia #10 |
| Nits | 22→**20** `it`; `index.ts:96,97,99`; `mapper:82`/`:154`; `toWriteHttpException` real por import directo; `super(...)` en DD29-1; rationale de `min/max` corregido | — | En sus secciones |

## Open Questions

Ninguna bloqueante; la que lo era (`P2003` de pivote) se cerró por construcción
en DD29-6. Quedan dos verificaciones **empíricas** que este design predice pero
no puede cerrar, y que `sdd-apply`/`sdd-verify` deben pegar como evidencia:

- [ ] Los textos exactos de los mensajes de 400 (**se observan**, precedente
      `DD-3` de US-27b).
- [ ] Que `just db-check` siga verde y en tiempo razonable con
      `fileParallelism: false`, y que los conteos de pivote medidos al arrancar
      se restituyan tras la corrida y tras el smoke del admin.
