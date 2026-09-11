# Exploration: Escrituras de productos con categorías y tags (US-29)

> Change: `escrituras-productos-postgres`. Cuarta US del Épico 26; depende de
> US-27a (implementada) y hereda dos obligaciones explícitas de US-28
> (implementada). Todo lo citado abajo se verificó contra el código real al
> momento de escribir (2026-09-11); las citas del propio documento de la US
> (fecha 2026-09-09) se contrastaron línea por línea y las desviaciones se
> marcan **DRIFT**.

## 1. Estado actual verificado

### 1.1 Los tres stubs de escritura

`apps/api/rest/src/products/products.service.ts`:

- `create()` → `return this.products[0];` — **líneas 156-158**, no 154-158
  como cita la US (`29-...md:22`). **DRIFT de 2 líneas** (el archivo creció
  con las funciones auxiliares de lectura de US-2/US-5; no afecta al
  contenido, solo al número de línea).
- `update()` → `return this.products[0];` — líneas 343-345, **coincide
  exacto** con la US.
- `remove()` → `return \`This action removes a #${id} product\`;` — líneas
  347-349, **coincide exacto**.
- Import `productsJson from '@db/products.json'` — línea 22, **coincide
  exacto**.
- `plainToClass(Product, productsJson)` — línea 29, **coincide exacto**.
- Comentario que declara el propósito único del import (líneas 26-28):
  **coincide exacto**.

`apps/api/rest/src/products/products.controller.ts`: las tres rutas de
escritura llevan `@Permissions(...ADMIN_OWNER_AND_STAFF)` en líneas 29, 47 y
53 — **coincide con la US** (cita "29,47,53"). Ninguna pasa `@CurrentUser()`
hoy; los tres métodos del servicio (`create`, `update`, `remove`) son
síncronos y no reciben el DTO tipado por completo en el caso de `update`
(recibe `+id` convertido en el controlador, patrón ya usado en `categories`).

`apps/api/rest/src/products/dto/create-product.dto.ts` (4-21):
`OmitType(Product, [...])` con `categories: number[]` y `tags: number[]`
standalone — **coincide exacto** con la US. `UpdateProductDto` es
`PartialType(CreateProductDto)` (update-product.dto.ts:1-4) — coincide.
Ninguno de los dos declara `type_id`, `shop_id`, `manufacturer_id` como
propiedades explícitas (vienen solo porque `Product` entity los declara vía
`OmitType`, sin excluirlos) — la US pide "declarar type_id/shop_id/
manufacturer_id... como opcionales documentados" (tabla de archivos), que
hoy no existe: es trabajo real de esta US, no ya hecho.

### 1.2 `main.ts` y el `ValidationPipe`

`apps/api/rest/src/main.ts:9` registra `new ValidationPipe()` sin
`transform` ni `whitelist` — confirmado, sin cambios desde el épico. El body
llega entero y sin coerción: `type_id`/`shop_id`/`manufacturer_id`/
`categories[]`/`tags[]` como los mande el cliente, strings incluidos si el
form los serializa así.

### 1.3 Precedente de escritura — `upsertScrapedProduct`

`packages/db/src/repositories/products.repository.ts`:

- La función pública empieza en **línea 337** (`export async function
  upsertScrapedProduct(`), no 328 como cita la US. El bloque de comentario
  que la precede empieza en 324. **DRIFT de +9/+13 líneas.**
- Valida `salePrice < price` **antes** del write en líneas 340-342
  (`if (input.salePrice != null && input.salePrice >= input.price) throw new
  InvalidSalePriceError(...)`) — la US cita ":331-333", drift de ~9 líneas,
  contenido idéntico.
- El `slug` no se toca en `update` (comentario línea 391) — la US cita
  ":382", drift de 9 líneas, contenido idéntico.
- Reemplazo completo de pivotes cuando vienen (`categories`/`tags` con
  `deleteMany({}) + create(...)`) — líneas 393-398, la US cita ":383-388",
  mismo drift.
- `_translateCheckViolation` — la función está en **línea 481**, no 454
  como cita la US. **DRIFT de 27 líneas** (el archivo ganó comentarios
  extensos en la sección de mapeo interno tras el cierre de US-27b,
  commit `cc5d72e`). El contenido de la función (tabla `message.includes(...)`)
  es idéntico a lo que la US describe.
- **Cobertura real de CHECKs por `upsertScrapedProduct` — el punto más
  importante para CA-4** (ver §2.2 abajo): solo pre-valida
  `products_rebaja_valida`. Las otras cuatro reglas (`products_simple_con_precio`,
  `products_procedencia_completa`, el `IN` de `product_type`, el `IN` de
  `status`) están cubiertas **por construcción del input del scraper**
  (`price: number` obligatorio, `productType: 'simple'` fijo,
  `sourceStore`/`sourceProductId` obligatorios ambos), no por una guarda
  explícita reusable. El input del admin **no** tiene esas garantías de
  tipo — el DTO no fuerza `price` cuando `product_type` es `'simple'`, ni
  restringe `product_type`/`status` a los valores del `IN`.

### 1.4 `shops.repository.ts` y la propiedad

- `ShopRecord.ownerId: number` existe (`packages/db/src/records.ts:80`,
  `_toShopRecord` en línea ~208 lo puebla con `_id(row.ownerId)`).
- `shops.service.ts:48` (`owner_id: record.ownerId,` dentro de `toShopDto`)
  — **coincide exacto** con la cita de la US.
- **No existe ninguna función que resuelva el `ownerId` de una tienda por
  `id` numérico.** El barrel (`packages/db/index.ts:107-112`) solo exporta
  `findOrCreateShopBySlug`, `findShopBySlug`, `listShops`, `listShopsNear`.
  `findShopBySlug` resuelve por `slug`, no por `id`. La US asume que "ya
  existe `ownerId`" (cierto, en el `ShopRecord`) pero **no** que ya exista
  una consulta por id — eso es trabajo nuevo, exactamente como advierte la
  tabla de archivos ("consulta mínima de propiedad si no la aporta
  `findShopBySlug`/`ShopRecord.ownerId`"). Confirmado: hace falta.

### 1.5 DDL — `db/schema.sql`

Todas las citas de la US sobre el DDL se verificaron **exactas, sin drift**
(el DDL no cambia entre US, es la fuente de verdad fija):

- Tabla `products`: líneas 324-405.
- `product_type ... CHECK (product_type IN ('simple','variable'))`: línea
  335-336.
- `status ... CHECK (status IN ('publish','draft'))`: línea 359-360.
- `products_rebaja_valida`: líneas 392-394.
- `products_simple_con_precio`: líneas 396-399.
- `products_procedencia_completa`: líneas 401-404.
- `category_product`/`product_tag`: líneas 425-435.
- `type_id`/`shop_id` `NOT NULL ... ON DELETE CASCADE`: líneas 331-332.
- `manufacturer_id ... ON DELETE SET NULL`: línea 333.
- `products_procedencia_key` (índice único parcial): líneas 411-413 — es
  el que, según el `README.md` del épico, **invalida el remedio S-1 de
  US-27a** para `products` (no aplica el mismo patrón de slug-lookup sin
  matices; el unique parcial de procedencia es un caso aparte que no
  interfiere con la unicidad de `slug`, pero el diseño debe declarar por
  qué no lo toca).

### 1.6 Admin — lo que el formulario envía

`apps/admin/rest/src/components/product/form-utils.ts`,
`getProductInputValues()`: **líneas 226-335**, no 226-340 como cita la US
(drift de 5 líneas, irrelevante). Confirmado el contenido: `type_id`,
`shop_id` (vía `simpleValues` — no desestructurado, así que viaja tal
cual), `product_type`, `categories: number[]`, `tags: number[]`,
`manufacturer_id`, `author_id`, `image`, `gallery`, `is_digital`,
`in_flash_sale`, `variations: []` (siempre vacío, hardcodeado, línea 274),
`variation_options: {upsert, delete}` (líneas 275-331), y para `variable`,
`calculateMinMaxPrice(variation_options)` (línea 333, definición en línea
79). `height/length/width`/`digital_file` viajan dentro de `simpleValues`
sin tratamiento especial. **No hay `sale_price`/`quantity`/`unit`/`sku`/
`status`/`visibility`/`is_taxable`/`is_external`/`external_product_url`
desestructurados** — viajan intactos dentro de `simpleValues` (el spread
`...simpleValues` al inicio del objeto de retorno).

`apps/admin/rest/src/data/product.ts`: `useUpdateProductMutation` redirige a
`` `${generateRedirectUrl}/${data?.slug}/edit` `` — **línea 57, coincide
exacto** con la cita de la US. `useCreateProductMutation` redirige a la
lista (líneas 22-26, sin usar el body). `useDeleteProductMutation` no lee
el body (líneas 76-90).

### 1.7 Piezas compartidas de US-27a/27b/28 — confirmadas, sin tocar

- `packages/db/src/slug.ts`: `generateSlug(source, findExistingWithPrefix,
  aggregate)` y `normalizeSlug(text, aggregate)` — firma genérica, delega en
  `SELECT slugify($1)`. Ningún nombre de tabla vive en este archivo (D27-13).
  Patrón de consumo: cada repositorio define su propio
  `ExistingSlugLookup` local (p. ej. `categorySlugs` en
  `categories.repository.ts`) — `products.repository.ts` deberá definir el
  suyo (`productSlugs`).
- `packages/db/src/domain-errors.ts`: conjunto cerrado de 5 códigos
  (`EmptySlugError`, `InvalidReferenceError`, `RecordNotFoundError`,
  `DependentRowsError`, `SlugConflictError`) + `translateCatalogWriteError`
  (líneas 135-163, no 454 como en la nota de la US-28 — esa cita ya estaba
  mal en el propio archivo, apunta a `products.repository.ts:454-466`,
  que hoy tampoco coincide por el mismo drift de §1.3).
- `apps/api/rest/src/common/errors/domain-error.mapper.ts`: `toWriteHttpException`
  (línea 146) es el único punto de traducción a `HttpException`; ya cubre
  errores de conexión (líneas 43-67) y el mapeo de los 5 códigos. **US-29
  MUST limitarse a `catch (error) { throw toWriteHttpException(error); }`**
  en el servicio, sin tocar este archivo.
- `apps/api/rest/src/auth/decorators/current-user.decorator.ts`:
  `CurrentUserPayload` = `{ sub: number; email: string; permissions:
  string[]; iat; exp }`. Precedente de uso real:
  `apps/api/rest/src/users/users.controller.ts` (`banUser`, `@CurrentUser()
  currentUser: CurrentUserPayload` junto a `@Body('id')`) — primer y único
  precedente de consumo en un controller, útil como plantilla de wiring
  para `products.controller.ts`.

### 1.8 Tests existentes — línea base real

- `packages/db/src/repositories/products.integration.test.ts`: **348
  líneas** (coincide con la base de 348 citada en el README del épico).
  Limpieza actual por `sourceStore: TEST_STORE` (`beforeAll`/`afterAll`,
  líneas 29-36) — **este patrón NO sirve para productos creados por el
  admin**, porque `source_store` es siempre `NULL` en esos productos (DDL
  comentario líneas 381-382). La nueva batería de escritura del admin
  necesita su propio centinela por **prefijo de slug** (`zz-products-`,
  mismo patrón que `categories`/`types`), no reutilizar `TEST_STORE`.
- `apps/api/rest/src/products/products.service.spec.ts`: 628 líneas, 22
  `it`, todos de lectura (`getProducts`/`getProductBySlug`), mockea
  `listProducts`/`findProductBySlug` (líneas 36-43) — coincide con la US.
- **`CLAUDE.md` dice "4 suites / 65 tests"; hoy hay 9 archivos
  `*.spec.ts`** en `apps/api/rest/src` (`categories`, `manufacturers`,
  `products`, `shops`, `tags`, `types`, `users`, `user-dto.mapper`,
  `domain-error.mapper`) — la misma divergencia #9 que US-28 ya declaró
  "mencionada y NO accionada"; se repite aquí solo como dato de superficie
  de verificación (§7), no se toca `CLAUDE.md` (fuera de alcance).

## 2. Las dos herencias de US-28

### 2.1 Herencia 1 — el escenario `UNTESTED` de `category_product`

**Dónde está escrita la obligación**:
`openspec/specs/category-tree-api/spec.md`, requirement «Borrado re-enraíza
a las hijas y devuelve el snapshot pre-borrado (CA-3)», escenario «CA-3 —
los enlaces de producto desaparecen — **UNTESTED (verificación diferida a
US-29)**» (líneas 239-257 del spec). El texto es explícito: *"US-29 hereda
explícitamente la obligación de cerrar este escenario como parte de su
propia Definición de Done, la primera vez que exista una ruta de escritura
real para `category_product`."* La propia US-29 (`29-...md:186-203`) lo
repite en "Notas para el agente ejecutor" como Herencia 1.

**Qué lo cierra**: la US-29 debe, dentro de su propia DoD:
1. Crear un producto con `categories: [id]` vía `POST /products` (usando el
   `createProduct` nuevo, que debe escribir en `category_product`).
2. `DELETE /categories/:id` sobre esa categoría.
3. `psql`: `SELECT count(*) FROM category_product WHERE category_id = :id`
   → debe ser `0`.

El mecanismo que lo produce ya existe y no requiere código nuevo en
`categories`: `category_product.category_id REFERENCES categories(id) ON
DELETE CASCADE` (`db/schema.sql:427`) — el `CASCADE` ya está en el DDL desde
el Épico 1; lo único que faltaba era una fila real en la tabla puente, y
esa fila solo puede existir una vez que `createProduct` la escriba.

**Evidencia que cierra la obligación**: el `psql` de arriba, pegado en el
reporte de cierre de esta US, más el `SELECT count(*) FROM category_product
WHERE product_id = :id` = 0 tras el `DELETE /products/:id` (la mitad de
producto de CA-3, que la US-29 también debe demostrar por sí misma, no solo
la mitad heredada de categoría).

### 2.2 Herencia 2 — el CHECK que no está en el conjunto cerrado

**Dónde está escrita la obligación**:
`openspec/specs/catalog-write-foundations/spec.md`, requirement «Contrato
dominio → HTTP es un conjunto cerrado de 5 códigos», escenario «Una
violación de CHECK no pertenece al conjunto cerrado — lección para
`products` (US-29)» (líneas 116-126). El texto: *"cualquier agregado futuro
con CHECKs propios (`products` tiene tres) MUST hacer lo mismo"* (pre-validar
en código de aplicación).

**Por qué pesa triple aquí**: `products` tiene, en total, **cinco**
expresiones que Postgres rechazaría con un error sin código Prisma
reconocido si llegan hasta el `INSERT`/`UPDATE` sin pre-validar:

| # | Expresión | ¿La cubre `upsertScrapedProduct` hoy? | ¿Por qué (no)? |
|---|---|---|---|
| 1 | `products_rebaja_valida` (`sale_price < price`) | **Sí, con guarda explícita** (líneas 340-342) | `if (salePrice >= price) throw InvalidSalePriceError` — **reusable tal cual** para el admin |
| 2 | `products_simple_con_precio` (`product_type <> 'simple' OR price IS NOT NULL`) | **No, por construcción del input** | El scraper siempre manda `productType: 'simple'` fijo y `price: number` obligatorio en el tipo — nunca puede violarlo. El admin sí puede mandar `product_type: 'simple'` sin `price` (el DTO no lo impide) — **hay que escribir la guarda desde cero** |
| 3 | `products_procedencia_completa` (`num_nonnulls(source_store, source_product_id) IN (0,2)`) | **No, por construcción del input** | El scraper siempre manda ambos campos; el admin nunca manda ninguno (ambos `NULL`, que es `0` → cumple el `IN (0,2)` trivialmente). **No hace falta guarda nueva**: el input de `CreateProductInput`/`UpdateProductInput` del admin simplemente no debe incluir `sourceStore`/`sourceProductId`, y el CHECK se satisface por construcción — pero si un día alguien añadiera esos campos al input del admin sin guarda, volvería a ser alcanzable |
| 4 | `product_type IN ('simple','variable')` | **No, por construcción del input** | El scraper fija el literal `'simple'`. El admin manda lo que el formulario envíe (`product_type?.value`, `form-utils.ts:257`) — un valor arbitrario del cliente. **Hace falta guarda nueva** (whitelist de dos valores, 400 si no calza) |
| 5 | `status IN ('publish','draft')` | **No, por construcción del input** | Mismo caso: el admin manda `status` tal cual del form. **Hace falta guarda nueva** |

**Conclusión operativa para el diseño**: de las 5 reglas, **solo 1 de 5**
(`products_rebaja_valida`) se hereda con guarda reusable de
`upsertScrapedProduct`; **3 de 5** (`products_simple_con_precio`,
`product_type IN`, `status IN`) necesitan guardas nuevas específicas del
input del admin; **1 de 5** (`products_procedencia_completa`) se satisface
por construcción si el input del admin nunca incluye `source_*`, sin
necesitar guarda de runtime (pero si se decide defender explícitamente, es
barato: un `assert` de que el input no trae esos campos, o simplemente no
tipar la posibilidad). CA-4 («nunca 500») **no se cierra** con solo
reusar `upsertScrapedProduct`: faltan 3 guardas nuevas como mínimo. También
falta pre-validar los 3 FK salientes (`type_id`, `shop_id`,
`manufacturer_id`) y los 2 ids de pivote (`categories[]`, `tags[]`) contra
`P2003`/existencia — `upsertScrapedProduct` delega esas comprobaciones al
`catch` + `_translateCheckViolation`, que **no** traduce `P2003` (esa
traducción vive en `translateCatalogWriteError`, la pieza de US-27a, no en
`_translateCheckViolation` del scraper). El diseño debe decidir si
`createProduct`/`updateProduct` usan `translateCatalogWriteError`
(catálogo genérico) en vez de (o adicional a) `_translateCheckViolation`
(específico de `products`) — ver Opción B en §3.2.

## 3. Opciones de enfoque comparadas

### 3.1 Dónde vive la comprobación de propiedad por tienda

| Opción | Descripción | Pros | Contras |
|---|---|---|---|
| **A. Servicio de Nest (recomendada)** | `ProductsService.create/update/remove` reciben `CurrentUserPayload`, resuelven el `shop_id` efectivo (del body en create, o el actual de la fila en update/remove) y llaman a una función de `@safari/db` que resuelve `ownerId` por `shop_id`, comparando contra `sub` | Coincide con D-5 del épico ("la propiedad es una consulta del servicio, el guard no gana consultas"); mismo patrón que ya usa `users.controller.ts` con `@CurrentUser()`; testeable en jest mockeando la consulta de propiedad | Un round-trip extra a la base por escritura (aceptable, ya hay 1-3 consultas en `upsertScrapedProduct`) |
| B. Guard dedicado (`OwnershipGuard`) | Un `CanActivate` que lea `request.params`/`request.body` y compare contra la tienda | Centraliza la lógica si más agregados la necesitaran (`shops` en US-30) | Viola D-5 explícitamente (la decisión ya fue tomada en el épico: "el guard no gana consultas a la base"); un guard no puede leer el `shop_id` ACTUAL en `update`/`remove` sin consultar la fila primero — necesitaría la misma lógica de servicio de todas formas, duplicada |
| C. Repositorio (`createProduct` lanza si no es dueño) | El repositorio de `@safari/db` recibe el `sub` y hace la comprobación internamente | Un solo lugar para `products` y `shops` (US-30) | Acopla `@safari/db` (capa de datos pura) a la noción de "usuario actual"/autorización, que hoy es 100% responsabilidad de la API (D-1: Nest consume repositorios, la API no expone Prisma; pero la inversa — repos conociendo auth — rompe la separación de capas que el resto del repo mantiene) |

**Recomendación**: Opción A. Es la que el propio épico ya decidió (decisión
8, D-5) y la única consistente con el precedente de `users.controller.ts`.
La función de `@safari/db` que resuelve `ownerId` por `shop_id` debe ser
mínima y de solo lectura (`{ id: number } → number | null`), viviendo en
`shops.repository.ts` como plantea la tabla de archivos de la US.

### 3.2 Cuánto de `upsertScrapedProduct` extraer/compartir vs. duplicar

| Opción | Descripción | Pros | Contras |
|---|---|---|---|
| **A. Funciones nuevas y separadas, reusando solo los errores de dominio y `_translateCheckViolation` (recomendada)** | `createProduct`/`updateProduct`/`deleteProduct` como funciones públicas nuevas en el mismo archivo, con su propia validación de las 5 reglas (§2.2), llamando a `_translateCheckViolation` en el `catch` como backstop y, además, a `translateCatalogWriteError` para los `P2002`/`P2003`/`P2025` que sí puede producir un `INSERT`/`UPDATE`/`DELETE` de admin (slug duplicado por carrera, FK inexistente, id inexistente) | Sigue D-2 del épico (mismo archivo del agregado, funciones planas); no reinventa el backstop de CHECK; el input del admin (`CreateProductInput`) es genuinamente distinto del scraper (`categories[]`/`tags[]` por id en vez de reemplazo posicional, sin `source_*`, con slug generado por `generateSlug` en vez de recibido) | Cierto volumen de código nuevo (ya presupuestado en el re-anclaje del README: +450 líneas en el repositorio) |
| B. Refactor de `upsertScrapedProduct` para que sirva a ambos casos | Generalizar la función existente con un flag `origin: 'scraper' \| 'admin'` | Menos superficie total de código | Viola el espíritu de "un call site, no una edición" que rige las piezas compartidas del épico; `upsertScrapedProduct` es un contrato ya probado (91+ tests de `packages/db`) que el scraper consume en producción — tocarlo arriesga una regresión en un flujo que esta US no debe verificar; el propio README del épico ya advierte que el input del scraper "recorta diseño, no volumen" y que el unique parcial de procedencia **invalida** copiar el remedio a ciegas |
| C. Duplicar `upsertScrapedProduct` entero sin tocarlo, ignorando el backstop existente | Copiar y pegar sin reusar nada | Cero riesgo de romper el scraper | Duplica exactamente la lógica que `_translateCheckViolation` ya resuelve; contradice literalmente la instrucción de la US ("reutilizar ambos, no reinventarlos") |

**Recomendación**: Opción A. `createProduct`/`updateProduct`/`deleteProduct`
son funciones nuevas, hermanas de `upsertScrapedProduct` en el mismo
archivo, que llaman a `_translateCheckViolation` (backstop de CHECK) **y**
a `translateCatalogWriteError` (backstop de `P2002`/`P2003`/`P2025`) en el
mismo `catch` — el orden importa: primero `translateCatalogWriteError`
(que devuelve el error intacto si no reconoce el código), y sobre lo que
quede, `_translateCheckViolation` (que también devuelve intacto si no
matchea). El diseño debe fijar el orden exacto y probarlo con un CHECK real
(mismo patrón que DD28-3 hizo para `categories_no_autoreferencia`).

### 3.3 Reemplazo de pivotes (`categories`/`tags`)

| Opción | Descripción | Pros | Contras |
|---|---|---|---|
| **A. `deleteMany({}) + create([...])` dentro del mismo `update`, como ya hace `upsertScrapedProduct` (recomendada)** | Reemplazo completo del set, solo si el campo llega en el input (`categoryIds !== undefined`) | Cero código nuevo de patrón — literalmente la misma sintaxis que ya está probada en producción (líneas 393-398 del repositorio); Prisma lo resuelve en una sola operación anidada dentro del `update` | Ninguno relevante — es el precedente exacto que la US pide seguir |
| B. Diff explícito (comparar set actual vs. nuevo, solo insertar/borrar la diferencia) | Menos filas de churn en la tabla pivote | Sin ganancia observable (no hay trigger ni auditoría sobre esas filas); más código, más superficie de bug | Rechazada: no aporta nada sobre A para este caso |
| C. Prisma `set` (relación many-to-many nativa) | Usar la sintaxis `set: [...]` de Prisma para relaciones | Una línea menos por campo | **No aplica**: `category_product`/`product_tag` son tablas puente **explícitas** con clave compuesta (no una relación m:n implícita de Prisma) — el schema de Prisma las modela como dos relaciones 1:N (`ProductCategory`/`ProductTag`), no como un `many-to-many` directo, así que `set` no está disponible en este modelo (confirmado por el propio patrón ya usado en `upsertScrapedProduct`, que usa `create`/`deleteMany`, no `set`) |

**Recomendación**: Opción A, sin variación sobre el precedente.

### 3.4 Derivación de `min_price`/`max_price` e `in_stock`

| Opción | Descripción | Pros | Contras |
|---|---|---|---|
| **A. Regla explícita en el repositorio, tal como la US la fija (recomendada)** | `simple`: `minPrice = maxPrice = price` (mismo criterio que `upsertScrapedProduct:356-357`); `variable`: usa el `min_price`/`max_price` que el admin ya calculó (`calculateMinMaxPrice`, `form-utils.ts:79-98`) y envía en el body. `in_stock = quantity > 0` si no viene explícito en el input | Ya está decidido por la US y por la decisión 10 del épico; consistente con el seed (58 productos `variable` reales) | Ninguno — es la única opción compatible con el CHECK `products_simple_con_precio` y con lo que el admin realmente envía |
| B. Recalcular `min_price`/`max_price` en el backend también para `variable` | El repositorio ignora lo que manda el admin y deriva de alguna otra fuente | Ninguno: no hay tabla de variaciones persistida (fuera de alcance, decisión del épico) | Inviable: no hay datos de origen en el backend para recalcular sin las tablas de atributos, que están explícitamente fuera de alcance |

**Recomendación**: Opción A, sin alternativa real disponible.

## 4. Riesgos

Los tres que la US-29 nombra explícitamente (R-2, R-5, R-6 del épico),
carried forward, más los que esta exploración añade:

- **R-2 (alto, del épico) — agujero de autorización.** Sin la comprobación
  de propiedad, un `store_owner` puede hoy editar/crear/borrar productos de
  cualquier tienda. Mitigación: decisión 8 + D-5 (§3.1, Opción A). Debe
  probarse en las tres rutas (`create`/`update`/`remove`), y en `update`
  con **ambos** lados de un cambio de `shop_id` (nota del agente ejecutor
  en la US: verificar propiedad de la tienda origen Y destino).
- **R-5 (medio, del épico) — spread del body a Prisma.** El payload del
  admin trae `variation_options.{upsert,delete}`, `author_id`,
  `digital_file`, `height/length/width`, `in_flash_sale` — ninguno con
  columna. Mitigación: `CreateProductInput`/`UpdateProductInput` tipados
  campo a campo en el servicio (D-2), nunca `...body` hacia el repositorio.
- **R-6 (bajo, positivo, del épico) — primeros enlaces reales en
  `category_product`.** Confirmado en §1.5/§2.1: la tabla está vacía a
  propósito hoy; esta US es la primera que puede poblarla. Se debe declarar
  en el reporte, no es regresión.
- **R-CRÍTICO-A (nuevo, alto) — CHECK sin pre-validar degrada a 500.**
  Detallado en §2.2: 3 de 5 reglas necesitan guarda nueva (no reusable de
  `upsertScrapedProduct`). Si el diseño omite alguna, CA-4 falla en
  silencio hasta que un hostile test la dispare — precedente exacto:
  US-28 tuvo el mismo defecto (`{"parent":"abc"}` → 500) detectado recién en
  la ronda de corrección del `sdd-design`. Mitigación: tabla de 5 filas de
  §2.2 debe convertirse en 5 pruebas de integración explícitas, cada una
  con su `curl` de 400 en la DoD.
- **R-CRÍTICO-B (nuevo, alto) — el `curl` de CA-4 debe cubrir también el
  `NaN` de `type_id`/`shop_id`/`manufacturer_id`.** Mismo patrón que DD28-3
  descubrió para `parent` en `categories`: si el servicio hace
  `Number(createProductDto.type_id)` sin guarda de `Number.isInteger`, un
  `type_id: "abc"` produce `NaN`, que cruza hasta
  `prisma.product.create({ data: { typeId: NaN } })` y `BigInt(NaN)` lanza
  un `RangeError` sin `.code` — invisible para `translateCatalogWriteError`
  y para `_translateCheckViolation` → 500. Con **tres** FK salientes
  (`type_id`, `shop_id`, `manufacturer_id`), el riesgo es mayor que en
  `categories` (que solo tenía `type_id`/`parent`): el diseño debe fijar el
  orden de guardas para las tres, no solo una.
- **R-CRÍTICO-C (nuevo, alto) — la proyección de 20 claves es la más
  ancha del épico y la única con objetos anidados (`type`, `shop`)
  reconstruidos desde el `record` recién escrito.** `toProductDto` necesita
  `record.type`/`record.shop` completos (`ProductRecord.type: TypeRecord`,
  `.shop: ShopRecord`) — el `create`/`update`/`delete` del repositorio
  **deben** devolver el `ProductRecord` con esas relaciones incluidas
  (mismo `PRODUCT_INCLUDE` que ya usa `listProducts`/`findProductBySlug`),
  no un `Prisma.Product` plano. Si el diseño olvida el `include` en el
  `create`/`update`/`delete` nuevos, el mapeo falla en tiempo de ejecución
  con un error de propiedad `undefined`, no un 500 controlado — es un bug
  de desarrollo, no un CHECK, pero merece una prueba de contrato explícita
  (comparar `Object.keys()` contra `GET /products/:slug`).
- **R-MEDIO-A (nuevo) — el `manufacturer_id` es `SET NULL`, no
  `CASCADE`.** A diferencia de `type_id`/`shop_id` (ambos `CASCADE`), un
  `manufacturer_id` inexistente en el `POST`/`PUT` debe producir 400
  (`InvalidReferenceError` vía `P2003`), no comportarse como opcional
  silencioso. Debe declararse y probarse aparte de `type_id`/`shop_id`.
- **R-MEDIO-B (nuevo) — el índice único parcial de procedencia
  (`products_procedencia_key`) convive con el `slug UNIQUE` general.**
  Un producto creado por el admin con el mismo `name` que uno ya scrapeado
  puede colisionar de slug (resuelto por sufijo, §3 de
  `catalog-write-foundations`) — sin relación con la clave de procedencia.
  Ningún caso cruza ambos índices; se declara para que el diseño no
  invente una guarda innecesaria contra `products_procedencia_key` desde el
  lado del admin (el admin nunca escribe `source_*`, así que ese índice
  parcial ni siquiera se evalúa para sus filas — `WHERE source_store IS NOT
  NULL`).
- **R-BAJO — sesgo de estimación del épico (R-8 del épico).** ~2100 líneas
  recalibradas para esta US, techo del épico. El propio README exige
  arrancar con una cadena de PRs por capa (datos → API → spec de jest) y
  advierte que el corte natural si desborda es levantar el spec de jest a
  una US-29b. `sdd-tasks` debe pronosticar explícitamente el riesgo de
  desbordar el presupuesto de 400 líneas por PR (Sección E del protocolo
  compartido).

## 5. Frontera de alcance (lo que el "NO incluye" prohíbe)

Lista concreta para que ninguna fase posterior derive hacia esto:

- **NO** persistir `variations`/`variation_options` — no hay tablas de
  atributos; el admin los envía (`upsert`/`delete`) pero se descartan y se
  declaran en el reporte.
- **NO** persistir `author_id` — sin columna en `products`.
- **NO** persistir `digital_file` — sin columna.
- **NO** persistir `height`/`length`/`width` — sin columnas.
- **NO** persistir `in_flash_sale` — sin columna (decisión 5 del épico); la
  respuesta sigue emitiendo la constante `0` que ya emite `toProductDto`.
- **NO** crear tablas de atributos.
- **NO** tocar `related_products` más allá de lo que ya calcula
  `findProductBySlug` — la respuesta de `POST`/`PUT`/`DELETE` **no** incluye
  `related_products` (solo 20 claves, no 21).
- **NO** tocar la búsqueda (`listProducts`, `parseProductSearch`, índices
  trigram) — CA-1 la usa como verificación de que el producto aparece, pero
  ningún código de `listProducts` se modifica.
- **NO** escribir `source_store`/`source_product_id`/`source_url`/
  `scraped_at` desde el admin — esos campos permanecen `NULL` para
  productos creados por el admin, por diseño (comentario `schema.sql:381-382`).
- **NO** tocar `apps/shop/**` ni `apps/admin/**` — solo verificación de UI
  ("comprobar en el navegador"), sin cambiar código de frontend.
- **NO** activar `whitelist`/`transform` en el `ValidationPipe` global de
  `main.ts` — decisión 5 del épico, afectaría 250 rutas.
- **NO** tocar `packages/db/src/slug.ts`, `domain-errors.ts`,
  `apps/api/rest/src/common/errors/domain-error.mapper.ts` — piezas
  compartidas, solo consumidas (CA-7 del épico, heredado).

## 6. Lagunas / preguntas abiertas para la fase de propuesta

1. **¿La función de propiedad por `shop_id` vive en `shops.repository.ts`
   como `findShopOwnerById(id): Promise<number | null>` o se reutiliza un
   `findShopById` más completo que devuelva `ShopRecord`?** La US solo
   pide "consulta mínima"; una función mínima (solo `ownerId`) es más
   barata pero introduce una segunda forma de leer una tienda por id junto
   a `findShopBySlug`. Recomendación tentativa: mínima, con nombre que dilo
   explícitamente (`findShopOwnerById`), documentando por qué no reusa
   `findShopBySlug` (no resuelve por id numérico).
2. **¿`update`/`remove` deben rechazar con 404 o 403 primero cuando el `id`
   de producto no existe Y el usuario no es dueño de ninguna tienda?** La
   US fija el orden implícitamente (comprobar propiedad leyendo el
   `shop_id` ACTUAL del producto), lo que exige cargar el producto **antes**
   de decidir 403 vs. 404 — el diseño debe fijar el orden exacto (¿404 si
   el producto no existe, antes de evaluar permisos? ¿o 403 primero si el
   token no tiene ningún rol de tienda?). Precedente de `categories`
   (`_loadNode` antes de cualquier guarda de negocio) sugiere: existencia
   primero (404), propiedad después (403).
3. **¿El error de `product_type`/`status` fuera del `IN` usa
   `InvalidReferenceError` (reutilizando el código existente con un
   `field` discriminante, como hizo `categories` para sus 7 reglas) o
   amerita un mensaje ad-hoc dentro del conjunto cerrado?** Recomendación:
   reusar `InvalidReferenceError` con `field: 'product_type'`/`field:
   'status'` es semánticamente forzado (no es una referencia a otro
   agregado); puede ser más honesto reusar `EmptySlugError`... tampoco
   encaja. Este es el hueco más genuino del "conjunto cerrado de 5
   códigos": ninguno de los 5 nombra literalmente "valor fuera de un `IN`".
   La opción más consistente con el precedente (`InvalidReferenceError`
   generaliza a "argumento inválido", no solo "FK inexistente" — ver su uso
   ya no-FK en `categories` regla 1/2/5/6, que son formas/ciclos, no FKs)
   es **reusar `InvalidReferenceError`** con un `field` que documente que
   no es una FK real. Debe ratificarse en `sdd-design`, no asumirse aquí.
4. **¿`createProduct` re-lee el producto tras el `INSERT` (patrón
   `_loadNode` de `categories`) o el `create`/`update` de Prisma con
   `include: PRODUCT_INCLUDE` ya trae todo lo necesario en una sola
   operación?** A diferencia de `categories` (que necesita reensamblar el
   árbol completo), `products` no tiene una estructura recursiva — el
   `include` plano (`PRODUCT_INCLUDE`) alcanza en una sola llamada. Parece
   NO necesitar el patrón de re-fetch de `categories`; a confirmar en
   diseño.
5. **¿Qué pasa si `manufacturer_id` llega pero el `type_id`/`shop_id`
   fallan simultáneamente — se reporta el primer error encontrado o se
   listan todos?** Precedente (`categories`, `types`, `tags`): siempre
   short-circuit al primer error. Se asume el mismo criterio salvo
   objeción en diseño.
6. **¿La comprobación de propiedad debe aplicarse también cuando el token
   es `super_admin` pero el `shop_id` no existe?** (orden: ¿propiedad
   primero o existencia de la tienda primero?). La US dice "super_admin →
   200 en cualquiera", lo que implica que para `super_admin` no hace falta
   ni siquiera resolver `ownerId` — atajo de rendimiento a confirmar en
   diseño (evitar el round-trip a `shops` para `super_admin`).

## 7. Superficie de verificación

Comandos exactos disponibles hoy, con los hechos de entorno conocidos:

```bash
# Postgres (5433) y capa de datos
just db-up                          # Postgres 16 en Docker; aplica schema.sql + seed.sql
just db-build                       # packages/db: npm install + prisma generate + tsup -> dist/
just db-check                       # vitest de integración en packages/db (requiere db-up)
just db-shell                       # psql interactivo — para las evidencias de category_product/product_tag

# API (9001) — LEVANTAR SIEMPRE DESPUÉS de db-up
just api-dev                        # NestJS, http://localhost:9001/api (Swagger /docs)
cd apps/api/rest && npx jest        # 9 suites hoy (no 4 como dice CLAUDE.md — divergencia ya declarada por US-28)
just build-api                      # compila la API a dist/

# Frontends y smoke general
just shop-dev                       # 3003 (SSR contra la API — API debe estar arriba)
just admin-dev                      # 3002
just verify                         # los 3 servicios responden con contenido real
just build                          # shop + admin (requiere API arriba; detener los `dev` antes)

# curl de evidencia (ejemplos, ajustar token/ids reales)
curl -s -X POST http://localhost:9001/api/products -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{...}'
curl -s http://localhost:9001/api/products/<slug>
curl -s -X PUT http://localhost:9001/api/products/<id> -H "Authorization: Bearer $TOKEN" -d '{...}'
curl -s -X DELETE http://localhost:9001/api/products/<id> -H "Authorization: Bearer $TOKEN"
```

Hechos de entorno que ya mordieron a US previas de este épico y aplican
igual aquí:

- **Postgres en 5433**, no 5432 — cualquier `psql`/conexión directa debe
  usar ese puerto (`docker-compose.yml`).
- **API en 9001**, no 9000 — Zscaler ocupa el 9000 en equipos corporativos
  y devuelve 200 vacío, no un error obvio (memoria del usuario:
  `zscaler-occupies-port-9000.md`).
- **`jq` no está instalado en Git Bash** — cualquier diff de JSON de
  evidencia (p. ej. comparar key-sets de 20 claves) debe hacerse con
  `node -e '...'`, no con `jq` (memoria del usuario:
  `jq-no-instalado-en-git-bash.md`).
- **vitest reporta "0 tests" si la letra de unidad del cwd está en
  minúscula en Windows** — verificar el casing de la ruta
  (`C:/DevOps/...` vs `c:/DevOps/...`) antes de sospechar de la base de
  datos si `just db-check` da 0 tests (memoria del usuario:
  `vitest-falla-con-unidad-en-minuscula.md`).
- **`just db-reset` NO es necesario** para esta US (decisión 1 del épico,
  ninguna columna nueva) — si algún paso pareciera exigirlo, es señal de
  que se violó el alcance: parar y preguntar.
- **`SELECT count(*) FROM products`** debe volver a **1200** tras la
  batería de tests (CA-7); `category_product`/`product_tag` deben volver a
  **0 filas** (o al número que el scraper haya dejado, medido antes/después)
  — el centinela por prefijo de slug (§1.8) es lo que garantiza esto.
- El **inner loop** recomendado por capa (`config.yaml`): `cd packages/db
  && npm test` para la capa de datos sola, sin pasar por `just db-check`
  completo en cada iteración.

---

## Ready for Proposal

**Sí.** El estado actual está verificado línea por línea (con los drifts
documentados en §1, todos menores salvo el de `_translateCheckViolation`
que sí importa para citar bien en el diseño), las dos herencias de US-28
están mapeadas con su evidencia de cierre exacta, las cuatro decisiones de
enfoque abiertas tienen recomendación razonada, y los riesgos críticos
(cobertura real de CHECKs, frontera BigInt en las tres FK salientes,
contrato de 20 claves) están identificados **antes** de que `sdd-design`
tenga que descubrirlos en una ronda de corrección, como pasó en US-28. La
fase de propuesta puede fijar alcance y DoD sobre esta base sin re-explorar
el código.
