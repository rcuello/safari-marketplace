# Proposal: Escrituras de productos con categorías y tags

> **US-29** del Épico 26, hoja que depende solo de US-27a. Las decisiones 1-15 y
> `D-1..D-6` / `R-1..R-9` del épico son **vinculantes**; las propias usan prefijo
> `D29-N` / `R29-N`. Insumo primario: `exploration.md` de este change, que
> corrigió los drifts de línea de la US — **no citar `products.repository.ts:328`
> ni `:454`**: hoy son `:337` y `:481`. Esta US **no crea piezas compartidas: las
> consume** (`CA-7` de `catalog-write-foundations`).

## Intent

`products.service.ts:156-158` devuelve `this.products[0]` en `create`, `:343-345`
lo mismo en `update` y `:347-349` un string en `remove`. Un dueño de tienda
edita un producto en el panel, ve el toast de "actualizado" y **no cambia
ninguna fila**: la tienda sigue mostrando el JSON de 2021. Es el modo de fallo
silencioso que define al épico, aquí sobre el agregado más visible del repo.

`products` es además el único agregado con **pivotes** (`category_product`,
`product_tag`), hoy vacíos por diseño: el filtro por categoría de la tienda
devuelve cero resultados para cualquier categoría (`db/README.md:37-40`). Esta
US es la primera capaz de poblarlos, y por eso hereda dos obligaciones escritas
de US-28 (§ Success Criteria). Y estrena la propiedad por tienda: en cuanto la
escritura sea real, sin ella un `store_owner` editaría productos ajenos (`R-2`).

## Scope

### In Scope

- `createProduct`/`updateProduct`/`deleteProduct` en
  `packages/db/src/repositories/products.repository.ts` (mismo archivo que las
  lecturas y que `upsertScrapedProduct`, `D-2`), con inputs tipados campo a
  campo, **pre-validación de las 5 expresiones CHECK/`IN`** (`D29-3`) y
  reemplazo de pivotes (`D29-5`), más sus tests de integración con centinela
  propio (`D29-9`).
- `findShopOwnerById` en `shops.repository.ts` (lectura mínima, `D29-1`) y el
  barrel `packages/db/index.ts`.
- Los 3 métodos de `products.service.ts` con la proyección `toProductDto`
  (20 claves, `:116-150`); fuera `@db/products.json` y `plainToClass`.
- `products.controller.ts`: `@CurrentUser()` en las tres rutas (los decoradores
  de permisos **no** cambian). `create-product.dto.ts`:
  `type_id`/`shop_id`/`manufacturer_id` declarados y los campos ignorados
  documentados (decisión 15).
- `products.service.spec.ts`: escrituras, los 5 roles de `CA-5` y los errores
  de `CA-4`.

### Out of Scope (vinculante — "NO incluye" de la US)

- **`variations`/`variation_options`** (`upsert`/`delete`): llegan del formulario
  y **se descartan**; no hay tablas de atributos y **no se crean**.
- **`author_id`, `digital_file`, `height`/`length`/`width`, `in_flash_sale`**:
  sin columna. `in_flash_sale` sigue emitiendo su constante `0` (decisión 5).
- **`related_products`**: la respuesta de escritura son **20 claves, no 21**.
- **Búsqueda**: `listProducts`, `parseProductSearch` e índices trigram
  **intactos** — `CA-1` los usa como verificación, no los modifica.
- **`source_*`/`scraped_at`**: el admin nunca los escribe (quedan `NULL`,
  `schema.sql:381-382`); `upsertScrapedProduct` **no se modifica**.
- **Frontend** (decisión 14): solo un smoke-test en el navegador. Si una
  verificación exigiera tocar un formulario, el contrato se rompió: **parar y
  preguntar**.
- `whitelist`/`transform` en el `ValidationPipe` global (`main.ts:9`, afectaría
  250 rutas); `slug.ts`, `domain-errors.ts`, `common/errors/`, `db/schema.sql`.
- Adyacente detectado y **no accionado**: `CLAUDE.md` dice "4 suites / 65 tests"
  y hoy hay 9 archivos spec (divergencia ya declarada por US-28).

## Capabilities

### New Capabilities

- `product-write-api`: `POST`/`PUT`/`DELETE /products` contra Postgres —
  escalares, pivotes, pre-validación de las 5 reglas CHECK/`IN`, frontera
  numérica de las 3 FK salientes, propiedad por tienda y proyección de 20
  claves. **Capacidad nueva, no una extensión**: las lecturas viven repartidas
  en `product-listing-api` y `product-detail-api`; meter las escrituras en
  cualquiera de las dos sería arbitrario.

### Modified Capabilities

- `category-tree-api`: **MODIFIED** el escenario «CA-3 — los enlaces de producto
  desaparecen», hoy `UNTESTED (verificación diferida a US-29)`
  (`spec.md:239-257`) → `COMPLIANT`, con la evidencia `psql` que solo esta US
  puede producir. **Herencia 1, parte de la DoD, no un follow-up.**
- `product-listing-api`: **MODIFIED** su *Out of Scope* (`spec.md:128-134`), que
  parquea «`category_product` (vacía por diseño del seed)» — deja de ser cierto.
  **Ningún requirement de lectura cambia**: las 20 claves (`:10`), el envoltorio
  de paginación y los filtros se preservan verbatim.
- `catalog-write-foundations`: **ADDED un único escenario** al requirement
  «Contrato dominio → HTTP es un conjunto cerrado de 5 códigos» dejando
  constancia de que la lección de US-28 se aplicó a las **cinco** expresiones de
  `products` (**Herencia 2**), con el desglose de cuál se heredó de
  `upsertScrapedProduct` y cuáles se escribieron nuevas. **Ningún requirement
  MODIFIED, ningún archivo fuente tocado** (`CA-7`).

## Approach — decisiones cerradas

| # | Decisión | Fundamento / alternativas descartadas |
|---|---|---|
| **D29-1** | **La propiedad se comprueba en el servicio de Nest.** `findShopOwnerById(id): Promise<number \| null>` nuevo en `shops.repository.ts` (mínima, solo lectura). `super_admin` **corta en seco sin round-trip**. `create`: valida el `shop_id` del body. `update`/`remove`: cargan el producto primero (**404** si no existe), validan el `shop_id` **ACTUAL** de la fila y, si el body mueve `shop_id`, **también el destino** — ambas tiendas. | Decisión 8 + `D-5` ("el guard no gana consultas") y precedente de `@CurrentUser()` en `users.controller.ts:62`. **Descartado un `OwnershipGuard`**: no puede leer el `shop_id` actual sin consultar la fila — duplicaría la lógica y viola `D-5`. **Descartado el repositorio**: acoplaría `@safari/db` a "usuario actual" (`D-1`). `findShopBySlug` no sirve: resuelve por slug. **`staff` no necesita caso especial**: su `sub` nunca es `owner_id`, cae en el 403 general. 404-antes-de-403 no filtra nada: `GET /products/:slug` es anónimo. |
| **D29-2** | **Funciones nuevas hermanas, no refactor del upsert.** `createProduct`/`updateProduct`/`deleteProduct` conviven con `upsertScrapedProduct` **sin tocarlo** y reutilizan sus piezas: `InvalidSalePriceError`/`MissingPriceError` y, en el `catch`, **primero `translateCatalogWriteError`** (`P2002`/`P2003`/`P2025`; devuelve el error intacto si no lo reconoce) **y luego `_translateCheckViolation`**. Ambos son red de seguridad; el comportamiento observable lo fijan las guardas de `D29-3`. | La US ordena "reutilizar ambos, no reinventarlos". **Descartado generalizarlo con un flag `origin`**: contrato probado que el scraper consume en producción, con un input genuinamente distinto (`source_*` obligatorios, `productType` fijo); tocarlo arriesga una regresión que esta US no verifica. **Descartado duplicarlo**: contradice la instrucción literal. Orden del `catch`: el código Prisma es exacto; el match de CHECK es por substring, va después. |
| **D29-3** | **Las 5 expresiones se pre-validan en el repositorio antes del write**; el CHECK queda **solo** como red de integridad de la base. Se hereda 1 de 5 (`products_rebaja_valida`). **Nuevas**: `products_simple_con_precio` (`simple` sin `price` → `MissingPriceError`), `product_type IN` y `status IN` (whitelist explícita). `products_procedencia_completa` se cumple **por construcción**: los inputs **no declaran** `source_*` a nivel de tipo (`num_nonnulls = 0`); se documenta, sin guarda de runtime. | **Herencia 2 de US-28**: una violación de CHECK no trae código Prisma reconocido → `toWriteHttpException` la degrada a **500** y `CA-4` cae. Precedente exacto del fallo: US-28 (`{"parent":"abc"}` → 500), cazado recién en la corrección del design. Las 5 filas se vuelven 5 tests de integración **y** 5 `curl` de 400. |
| **D29-4** | **La frontera numérica vive en el servicio** (borde HTTP, `D-3` del Épico 19): `type_id`, `shop_id`, `manufacturer_id` y cada id de `categories[]`/`tags[]` pasan por `Number.isInteger`; `price`, `sale_price`, `quantity`, `min_price`, `max_price` por el **criterio** de `parseFiniteNumber` (`:42-45`). Todo fallo → 400 antes de `@safari/db`. La **existencia** de esos ids la valida el repositorio. | `R29-2`: sin la guarda, `type_id: "abc"` → `NaN` → `BigInt(NaN)` lanza `RangeError` **sin `.code`**, invisible para las dos traducciones → 500. Con **tres** FK salientes el riesgo triplica al de `categories`. Nota: `parseFiniteNumber` está tipado `string \| undefined` (nació para el query-string) y el body manda `number` — se reutiliza el **criterio**; el diseño decide si ensancha la firma o añade una hermana. |
| **D29-5** | **Pivotes: reemplazo completo con `deleteMany({}) + create([...])`** anidado en el `update`, igual que `upsertScrapedProduct:393-398`. Semántica explícita: **ausente (`undefined`) = no se toca**; **array vacío = se vacía el set**. | Precedente exacto que la US pide seguir. **Descartado el diff explícito**: sin trigger ni auditoría no aporta nada y añade superficie de bug. **Descartado `set:` de Prisma**: los pivotes son tablas puente **explícitas** con PK compuesta, modeladas como dos relaciones 1:N — `set` no existe ahí. |
| **D29-6** | **Derivaciones.** `simple`: `minPrice = maxPrice = price` (idéntico a `:356-357`). `variable`: se persisten los `min/max` que el admin ya calculó (`calculateMinMaxPrice`) y `price` queda `NULL`. `in_stock`: si no viene y sí `quantity`, `quantity > 0`; si no viene ninguno, la columna toma su `DEFAULT true` (`schema.sql:351`). Se declara. | Decisión 10 + nota de la US. **Descartado recalcular `min/max` para `variable`**: sin tablas de variaciones (fuera de alcance) no hay dato de origen. |
| **D29-7** | **Proyección: una sola llamada con `include: PRODUCT_INCLUDE`**, sin el re-fetch de `categories`. `create`/`update` devuelven el `ProductRecord` con `type` y `shop`; `delete` **captura el record antes de borrar**. Respuesta = `toProductDto` tal cual: 20 claves, sin `related_products`. | `products` no es recursivo: el `include` plano alcanza en una operación. `R29-3`: si se olvida, `toProductDto` revienta con `undefined` al leer `record.type.id` — bug de desarrollo, no un 500 controlado. Decisión 3 + `D-6`. |
| **D29-8** | **`product_type`/`status` fuera del `IN` lanzan `InvalidReferenceError`** con un `field` que documenta que **no** es una FK real. | El conjunto cerrado de 5 códigos no nombra "valor fuera de un `IN`" y ampliarlo está prohibido (`CA-7`). `InvalidReferenceError` ya cubre en `categories` reglas que no son FK (forma, ciclo): generaliza a "argumento inválido" → 400. **A ratificar en `sdd-design`**. |
| **D29-9** | **Centinela por prefijo de slug `zz-products-`**, no por `sourceStore`. La categoría de la prueba de Herencia 1 es **también centinela** (creada vía `POST /categories`), **jamás una del seed**. | `source_store` es `NULL` en todo producto del admin: el `TEST_STORE` actual (`:29-36`) no los alcanza. Y borrar una categoría sembrada para probar el CASCADE rompería `toBe(198)` de `categories.integration.test.ts` (`R-4`). |

## Affected Areas

| Área | Impacto | Cambio |
|---|---|---|
| `packages/db/src/repositories/products.repository.ts` (581 líneas) | Modified | +3 funciones, +2 inputs, `productSlugs`, 5 guardas de CHECK/`IN`, validación de 3 FK + 2 sets de pivote. **`upsertScrapedProduct`, `listProducts` y `findProductBySlug` intactos** |
| `packages/db/src/repositories/shops.repository.ts` (186) | Modified | +`findShopOwnerById` (lectura mínima) |
| `packages/db/src/repositories/products.integration.test.ts` (348) | Modified | Describes de escritura **tras** los de lectura + centinela (`D29-9`) |
| `packages/db/index.ts` | Modified | Barrel: 3 funciones + 2 tipos + `findShopOwnerById`. **Único archivo compartido con US-30**: quien arranque segundo rebasea |
| `apps/api/rest/src/products/products.service.ts` | Modified | 3 métodos migrados, propiedad, frontera numérica; fuera `@db/products.json` (`:22`) y `plainToClass` (`:29`) |
| `apps/api/rest/src/products/products.controller.ts` | Modified | `@CurrentUser()` en 3 rutas. **`@Permissions` sin tocar** |
| `apps/api/rest/src/products/dto/create-product.dto.ts` | Modified | `type_id`/`shop_id`/`manufacturer_id` + campos ignorados documentados |
| `apps/api/rest/src/products/products.service.spec.ts` (628) | Modified | Escrituras, 5 roles de `CA-5`, errores de `CA-4` |
| Contrato HTTP | Modified | `POST`/`PUT`/`DELETE /products` pasan de la fila 0 del mock a 20 claves reales. **`GET` sin cambios byte a byte.** Observable: la tienda muestra lo editado y el filtro por categoría devuelve resultados por primera vez (`R-6`) |
| `slug.ts`, `domain-errors.ts`, `common/errors/`, `db/schema.sql`, `apps/{shop,admin}` | **Unchanged** | `CA-7` + decisiones 1 y 14 |

## Risks

| # | Riesgo | Sev. | Mitigación |
|---|---|---|---|
| **R29-1** | CHECK/`IN` sin pre-validar → **500**; `CA-4` cae en silencio hasta que un test hostil lo dispare. Solo 1 de 5 reglas se hereda. | **Alto** | `D29-3`: 5 guardas → 5 tests de integración → 5 `curl` de 400. Precedente del fallo: US-28. |
| **R29-2** | `NaN` en las 3 FK → `BigInt(NaN)` → `RangeError` sin `.code` → **500**. | **Alto** | `D29-4`: `Number.isInteger` sobre las tres **y** sobre cada id de pivote, antes de construir el input. `curl` con `"abc"` en cada una. |
| **R29-3** | Sin `include: PRODUCT_INCLUDE`, `toProductDto` falla con `undefined` (no es un 500 controlado). | **Alto** | `D29-7` + diff de `Object.keys()` con `node -e` (**`jq` no está instalado**), sin `.sort()`, contra `GET /products/:slug`. |
| **R29-4** (`R-2`) | Agujero de autorización: hoy el `PUT` no hace nada; mañana un `store_owner` edita productos ajenos. | **Alto** | `D29-1`, probado en las **tres** rutas y en **ambos** lados de un `PUT` que mueve `shop_id`. |
| **R29-5** (`R-4`) | `products.integration.test.ts` afirma conteos — `toBe(1199)` (`:177`), `toBe(11)` (`:148`), `toBe(1)` (`:162`) — y una fila `publish`/`visibility_public` olvidada los rompe. | **Alto** | `D29-9`: `cleanup()` por prefijo en `beforeAll` **y plegado dentro del `afterAll` existente** (un segundo `afterAll` correría LIFO contra un cliente ya desconectado). Cierre: `count(*) FROM products` = **1200**. |
| **R29-6** (`R-5`) | El body trae `variation_options.{upsert,delete}`, `author_id`, `digital_file`… Un spread a Prisma → 500 por campo desconocido. | Medio | Inputs tipados **campo a campo** (`D-2`); nunca `...body` hacia el repositorio. Lo descartado se lista en el reporte. |
| **R29-7** | `manufacturer_id` es `SET NULL`, no `CASCADE`: un id inexistente podría pasar como "opcional silencioso" en vez de 400. | Medio | Se valida y prueba **aparte** de `type_id`/`shop_id`. `NULL` explícito sí es válido. |
| **R29-8** (`R-8`) | Desborde de volumen: ~2100 líneas, **techo** del épico, sobre un umbral de partición de ~900. | **Alto** | Cadena de PRs decidida **de entrada** (§ Estimación); corte preacordado: el spec de jest a una **US-29b**. |
| **R29-9** (`R-6`, positivo) | Primeros enlaces reales en `category_product`: el filtro por categoría deja de devolver vacío. | Bajo | **No es regresión**: se declara en el reporte. |
| **R29-10** | Falso negativo por `packages/db/dist` obsoleto (gitignored) o por vitest con "0 tests" si la unidad del cwd va en minúscula en Windows. | Medio | `just db-build` abre toda verificación; revisar el casing `C:/DevOps/...` antes de sospechar de la base. |

## Rollback Plan

1. **Revert puro de código, sin DDL ni migración** (decisión 1 — esta US **no
   añade ni una columna**): `git checkout packages/db apps/api/rest/src/products`
   + `just db-build` + `just build-api`. `dist/` está gitignored y se
   reconstruye. **`just db-reset` NO es necesario**; si pareciera serlo, se
   rompió la decisión 1: parar y preguntar.
2. **Datos que `git` no deshace** — filas de tests y `curl` manuales:
   `DELETE FROM products WHERE slug LIKE 'zz-products-%';` y lo mismo sobre
   `categories`. Los pivotes caen solos: ambas FK de
   `category_product`/`product_tag` son `ON DELETE CASCADE`
   (`schema.sql:425-435`). Cierre correcto = `count(*) FROM products` → **1200**
   y los pivotes de vuelta a su conteo previo, **medido antes de empezar** (no
   asumido en 0: el scraper puede haber dejado filas).
3. **Filas del seed tocadas por error**: no hay backup. Por eso toda evidencia
   manual se hace sobre filas centinela y el producto ajeno del `curl` de `CA-5`
   se usa **solo para leer el 403**, verificando después que no cambió.
4. **Rollback parcial por slice**: revertir el PR de la capa API deja las
   funciones de `packages/db` inertes y el servicio en su stub — el estado exacto
   del PR anterior de la cadena, y es verde.

## Estimación y entrega

Se **ratifica** el re-anclaje por componente del épico (~2100): sale de tamaños
medidos, no de un factor a ciegas, y su desglose coincide con lo que esta
propuesta añade (la frontera numérica de `D29-4`, ~30 líneas, cabe en el margen).

| Componente | Base hoy | Δ | Ancla |
|---|---|---|---|
| `products.repository.ts` | 581 | +450 | 3 escrituras + **5 guardas** + 3 FK + 2 sets de pivote + `productSlugs` |
| `products.integration.test.ts` | 348 | +550 | su homólogo de `categories` cerró en **683** con **una** CHECK y **sin** pivotes |
| `products.service.ts` + controller + DTO | — | +400 | 3 métodos, 20 claves (la proyección más ancha), estreno de la propiedad |
| `products.service.spec.ts` | 628 | +650 | regla de gobierno de US-27b: ~500/agregado, más los 5 roles de `CA-5` |
| `shops.repository.ts` + barrel | — | +50 | |
| **Total** | | **~2100 (±250)** | vs. ~550 originales (**×3,8**) |

- `Estimated changed lines: ~2100 (±250)`
- `400-line budget risk: High` — **excede el presupuesto de PR ×5**
- `Chained PRs recommended: Yes`
- `Decision needed before apply: Yes` (estrategia `ask-on-risk`)

**Cadena propuesta** (forecast autoritativo: `sdd-tasks`) — corte por capa, cada
slice con un runner que lo prueba verde solo:

| PR | Contenido | ~Líneas | Runner |
|---|---|---|---|
| **#1** | `packages/db`: 3 escrituras + inputs + 5 guardas + `findShopOwnerById` + barrel + integración del **camino feliz** (crear, pivotes, `variable`) | ~790 | `just db-check` |
| **#2** | `packages/db`: **batería hostil** de integración (5 reglas, 3 FK, ids no enteros, 404, centinela) | ~330 | `just db-check` |
| **#3** | API: servicio + controller + DTO. **La US es releasable aquí** | ~400 | `just build-api` + secuencia `curl` con reinicio + `just verify` |
| **#4** | `products.service.spec.ts` | ~650 | `npx jest` |

**¿Partir la US?** No por código: es **un solo agregado** y repositorio+servicio
son la misma vertical (ese corte ya se descartó al partir US-27 — dejaría un PR
sin consumidor). El corte limpio si `sdd-apply` desborda es **levantar PR#4 a una
US-29b**, el *caveat* vinculante que dejó el `design.md` de US-28. PR#1 y PR#4
exceden el presupuesto con el exceso concentrado en archivos de test; si se exige
respetarlo, el siguiente corte es partir PR#1 en `create`+`delete` / `update`.

## Dependencies

- **US-27a implementada**: `slug.ts`, `domain-errors.ts`,
  `common/errors/domain-error.mapper.ts`. Se consumen tal cual (`CA-7`).
- **US-28 implementada**: `POST`/`DELETE /categories` es lo que permite crear la
  **categoría centinela** de la prueba de Herencia 1 sin tocar el seed.
- `just db-up` (base sembrada, **sin `db-reset`**) y `just db-build` antes de
  verificar; `just api-dev` arriba para `just build`/`just verify`.
- Rebase sobre `packages/db/index.ts` si US-30 avanza en paralelo.

## Preguntas abiertas para `sdd-design` (no se cierran aquí)

1. **Ratificar o revocar `D29-8`**: `InvalidReferenceError` para
   `product_type`/`status` fuera del `IN`. Es el hueco más genuino del conjunto
   cerrado de 5 códigos y **no puede ampliarse** (`CA-7`). Si se revoca, la única
   salida es un mensaje ad-hoc dentro de uno de los 5.
2. ~~**Mutabilidad de `shop_id` en `UpdateProductInput`.**~~ **CERRADA por
   decisión de producto (2026-09-11, Ronald).** Un producto **sí** puede cambiar
   de tienda: es un caso legítimo. `D29-1` queda **ratificado tal cual** — el
   `PUT` que mueve `shop_id` exige propiedad de **ambas** tiendas (la actual de
   la fila y la de destino), y `CA-5` conserva ese caso de test (403 al mover a
   una tienda ajena). `sdd-design` **no reabre esta decisión**.
3. **Forma del `DELETE` respecto a `updated_at`/`sold_quantity`**: el record
   capturado antes del borrado es el estado pre-borrado; confirmar que eso es lo
   que se proyecta (mismo dilema que `D28-4` resolvió para `categories`).
4. **Short-circuit de `super_admin`**: `D29-1` evita el round-trip a `shops`.
   Confirmar que no se pierde el 400 por `shop_id` inexistente — lo cubre la
   validación de FK del repositorio, pero el orden debe quedar escrito.

## Success Criteria (1:1 con la DoD de US-29)

- [ ] **CA-1** — Secuencia `POST → GET por slug → reinicio de la API → GET` pegada
      con token `store_owner` sobre su tienda; `GET /products?search=name:…` y
      `?search=categories.slug:…` devolviendo el producto; key-set de **20 claves
      en el mismo orden** diffeado con `node -e` contra un producto del seed.
- [ ] **CA-2** — `PUT` pegado: escalares cambiados, pivotes **reemplazados** al
      venir y **intactos** al no venir, `slug` invariante pese a cambiar `name`,
      `slug` presente en la respuesta y `updated_at` avanzado.
- [ ] **CA-3** — `DELETE` pegado con 20 claves; `GET` posterior **404**; `psql`
      de `category_product`/`product_tag` del producto: filas presentes antes,
      **0** después.
- [ ] **CA-4** — `curl` pegados, **ninguno 500**: 400 rebaja inválida, 400
      `simple` sin `price`, 400 `product_type` fuera del `IN`, 400 `status` fuera
      del `IN`, 400 `type_id`/`shop_id`/`manufacturer_id`/categoría/tag
      inexistentes, 400 id **no entero** (`"abc"`) en las tres FK, 404 id
      inexistente en `PUT`/`DELETE`.
- [ ] **CA-5** — `curl` pegados: **403** dueño ajeno (las 3 rutas), **403** `PUT`
      que mueve `shop_id` a una tienda ajena, **200** dueño propio, **200**
      `super_admin`, **403** `staff` (declarado), **401** sin token.
- [ ] **CA-6** — `curl` pegado: `variable` con `price` ausente y `min/max`
      presentes, creado y leído como los 58 del seed; `variations`/
      `variation_options` descartados y **declarados**.
- [ ] **CA-7** — `grep -n "@db/\|plainToClass" products.service.ts` → **0
      líneas**. `just db-check`, `cd apps/api/rest && npx jest`, `just build-api`
      y `just verify` **verdes con recuentos reales**; `psql`:
      `count(*) FROM products` = **1200**, pivotes de vuelta al conteo medido al
      arrancar.
- [ ] **Herencia 1 (US-28)** — `psql` pegado:
      `SELECT count(*) FROM category_product WHERE category_id = :id` → **0**
      tras `DELETE /categories/:id` sobre una **categoría centinela** enlazada a
      un producto creado por esta US. El escenario `UNTESTED` de
      `category-tree-api` pasa a `COMPLIANT`.
- [ ] **Herencia 2 (US-28)** — las 5 expresiones CHECK/`IN` pre-validadas, con la
      tabla de cobertura (1 heredada / 3 nuevas / 1 por construcción) en el
      reporte y el escenario añadido a `catalog-write-foundations`.
- [ ] `git diff --stat` sin cambios en `slug.ts`, `domain-errors.ts`,
      `common/errors/`, `upsertScrapedProduct`, `db/schema.sql`, `apps/shop` ni
      `apps/admin`, o desviación declarada con su motivo.
- [ ] Smoke-test en el navegador declarado: tras el `PUT`, el admin aterriza en
      `/products/{slug}/edit` con los valores guardados — **sin tocar el
      frontend**.
- [ ] Nota de `R-6` (primeros enlaces reales en `category_product`) y
      divergencias declaradas (`in_flash_sale: 0`, `type.logo: null`,
      `created_at`/`updated_at` ya embarcada, conteo obsoleto de suites en
      `CLAUDE.md` mencionado y **no** accionado).
- [ ] Status de US-29 actualizado y fila del épico marcada.
