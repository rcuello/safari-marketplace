# Tasks: Escrituras de productos con categorías y tags (US-29)

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~2340 (design's re-anchored ceiling), roll-up abajo confirma el número |
| 400-line budget risk | High — PR#1, PR#3 y PR#4 individualmente superan el presupuesto |
| Chained PRs recommended | Yes |
| Suggested split | PR#1 (`packages/db` camino feliz) → PR#2 (`packages/db` batería hostil) → PR#3 (API, US releasable aquí) → PR#4 (`products.service.spec.ts`) |
| Delivery strategy | ask-on-risk (recibida del orquestador) |
| Chain strategy | **stacked-to-main** — RESUELTA por el usuario (2026-09-11) |

```text
Decision needed before apply: RESUELTA (2026-09-11)
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
```

### Decisiones del usuario (2026-09-11) — vinculantes para `sdd-apply`

1. **Entrega: cadena de 4 PRs**, con los cortes de la tabla de slices tal cual.
   **NO** se levanta PR#4 a una US-29b de entrada; sigue siendo el corte de
   contingencia pre-acordado si `sdd-apply` desborda (task 4.5: parar y
   preguntar, nunca decidir unilateralmente).
2. **Estrategia de rama: `stacked-to-main`.** Cada PR apunta al branch del PR
   anterior, en secuencia (`main` → PR#1 → PR#2 → PR#3 → PR#4).
3. **`packages/db/vitest.config.ts` (DD29-10) queda EN ALCANCE** pese a no
   figurar en la tabla «Archivos a crear/modificar» de US-29. Ratificado
   explícitamente tras declararse la desviación (task 1.10). El reporte final
   debe declararla igualmente como superficie añadida.

> **Nota de resolución de skills:** este repo no tiene `.atl/skill-registry.md`,
> así que el skill `chained-pr` (`gentle-ai-chained-pr`) **no es resoluble por
> registro**. `sdd-apply` debe gestionar la cadena con `git`/`gh` directamente y
> reportar `skill_resolution` en consecuencia, no inventar una ruta de skill.

### Roll-up propio vs. el diseño

| Slice | Componente | ~Líneas |
|---|---|---|
| PR#1 | `products.repository.ts` (3 escrituras, `_assert*` numéricos/ref, `_assertPivotIdsExist`, derivaciones, DD29-1 sobre las 3 clases) | ~490 |
| PR#1 | `shops.repository.ts` (`findShopOwnerById`) + `products.repository.ts` (`findProductShopId`) | ~20 |
| PR#1 | `index.ts` (barrel) | ~15 |
| PR#1 | `products.integration.test.ts` — camino feliz (crear simple/variable, pivotes 3 estados, slug invariante, delete+snapshot) | ~330 |
| PR#1 | `vitest.config.ts` (DD29-10, **superficie nueva**) | ~8 |
| PR#2 | `products.integration.test.ts` — batería hostil (5 guardas, 3 FK + 2 pivotes inexistentes, no-enteros/no-finitos, 404, centinela) | ~330 |
| PR#3 | `products.service.ts` (3 métodos, propiedad, `Number()`) | ~180 |
| PR#3 | `products.controller.ts` (`@CurrentUser()` ×3) | ~15 |
| PR#3 | `create-product.dto.ts` (`manufacturer_id` + doc) | ~15 |
| PR#4 | `products.service.spec.ts` | ~650 |
| — | Margen de citas/ajustes finos no listados arriba (redondeo del propio diseño) | ~287 |
| **Total** | | **~2340** |

Coincide con el pronóstico del diseño (~2340); no se discrepa. La banda original
de la propuesta (~2100 ±250 ⇒ techo 2350) queda al límite — igual que advierte
el design. Si `sdd-apply` desborda, el corte preacordado es **levantar PR#4 a
una US-29b**.

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|---|---|---|---|
| 1 | `packages/db` camino feliz: 3 escrituras + `findShopOwnerById`/`findProductShopId` + barrel + `vitest.config.ts` + integración feliz | PR#1 | Runner: `just db-check`. Base: `main` |
| 2 | `packages/db` batería hostil: las 5 guardas, 3 FK + 2 pivotes, ids no enteros/no finitos, 404 | PR#2 | Runner: `just db-check`. Base: PR#1 (US es indivisible por agregado) |
| 3 | API: servicio + controller + DTO. **US releasable aquí** | PR#3 | Runner: `just build-api` + curl + `just verify`. Base: PR#2 |
| 4 | `products.service.spec.ts` | PR#4 | Runner: `cd apps/api/rest && npx jest`. Base: PR#3. Candidato a US-29b si desborda |

## Phase 1: `products` repository — camino feliz (`packages/db`, PR#1)

- [x] 1.1 En `packages/db/src/repositories/products.repository.ts` (581 líneas hoy): cambiar `super(...)` de `InvalidSalePriceError`/`MissingPriceError`/`IncompleteProvenanceError` (`:446,456,466`) para extender `CatalogWriteError` con `code = CATALOG_ERROR_CODES.InvalidReference` y `super(<mismo mensaje>, 'products')` (constructor `(message, aggregate)`). NO tocar `upsertScrapedProduct`. [DD29-1]
- [x] 1.2 Añadir en el mismo archivo: `productSlugs: ExistingSlugLookup` local (nunca filtra el nombre de tabla a `slug.ts`); `_assertIntegerRef(value, field)` (B1, sin `<= 0`, calcado de `categories.repository.ts:328-331`); `_assertFiniteNumber(value, field)` (B2, incluye el borde `numeric(12,2)`, `|v| >= 1e10` → 400); `_assertIntegerCount(value, field)` (B3, `quantity`); `_assertProductType(value)` / `_assertStatus(value)` (`InvalidReferenceError`, DD29-2); `_assertPriceRules(productType, price, salePrice)` con el disyunto `price != null` (DD29-9, guarda heredada **adaptada**, no literal). [DD29-2, DD29-3, DD29-9]
- [x] 1.3 Añadir `_assertPivotIdsExist(categoryIds?, tagIds?)`: sonda `count` normativa por tabla (`prisma.category.count`/`prisma.tag.count`), lanza `InvalidReferenceError('products', 'categories[]'|'tags[]', …)` si `found !== uniqIds.length`. No delegar en el `P2003` del `create` anidado. [DD29-6]
- [x] 1.4 Implementar `createProduct(input)`: orden normativo — `_assertIntegerRef` (typeId, shopId, manufacturerId, cada id de `categoryIds[]`/`tagIds[]`) → `_assertFiniteNumber` ×4 (price/salePrice/minPrice/maxPrice) → `_assertIntegerCount(quantity)` → `_assertProductType`/`_assertStatus` → `_assertPriceRules` sobre el tipo efectivo → `_assertPivotIdsExist` (2 `count`) → derivaciones DD29-7 (`simple`: min/max = price; `variable`: min/max del input, price NULL; `inStock` = `quantity>0` si falta; spread condicional `image`/`gallery` con `!= null`) → `generateSlug({name,slug}, productSlugs, 'products')` → `prisma.product.create({..., categories:{create: uniq(categoryIds).map(...)}, tags:{create: uniq(tagIds).map(...)}}, include: PRODUCT_INCLUDE)` → `catch { throw _translateCheckViolation(translateCatalogWriteError(error,{aggregate:'products', id})); }` (orden normativo: Prisma-code primero, substring-CHECK después, **sin `uniqueField`**) → `_toProductRecord`; `null` → `InvalidReferenceError`. [DD29-3, DD29-6, DD29-7, DD29-8]
- [x] 1.5 Implementar `updateProduct(id, input)`: `current = findUnique + PRODUCT_INCLUDE` → `null` → `RecordNotFoundError` (404); si `input.name !== undefined` llamar `normalizeSlug(input.name,'products')` **descartando el resultado** (solo su efecto lateral `EmptySlugError`); `slug` inmutable a nivel de tipo (`UpdateProductInput = Partial<Omit<CreateProductInput,'slug'>>`); estado efectivo con `effectiveX = input.X !== undefined ? input.X : current.X` (**nunca `??`**, DD29-7); mismas guardas 1.4 sobre el efectivo; pivotes con spread condicional `deleteMany({}) + create([...])` **solo si `input.categoryIds`/`tagIds !== undefined`** (`uniq()` deduplica); `prisma.product.update` **sin fijar `updatedAt`** (trigger lo hace); mismo `catch`. [DD29-3, DD29-6, DD29-7]
- [x] 1.6 Implementar `deleteProduct(id)`: `findUnique + PRODUCT_INCLUDE` → `null` → `RecordNotFoundError`; capturar el snapshot **antes** del `prisma.product.delete` (mismo `catch`); devolver el snapshot pre-borrado tal cual (categories/tags reflejan los enlaces que tenía, ya caídos por CASCADE en la base — divergencia #1, sin consumidor). [DD29-5]
- [x] 1.7 Añadir `findProductShopId(id): Promise<number|null>` en `products.repository.ts` (`select:{shopId:true}`, ~10 líneas, nunca lanza). [DD29-4]
- [x] 1.8 Añadir `findShopOwnerById(id): Promise<number|null>` en `shops.repository.ts` (`select:{ownerId:true}`); `null` si no existe **o** si `id` no es entero seguro positivo; nunca lanza. [DD29-3 nivel A', DD29-4]
- [x] 1.9 Modificar `packages/db/index.ts` (156 líneas hoy): añadir `CreateProductInput`/`UpdateProductInput` al bloque `export type` y `createProduct`/`updateProduct`/`deleteProduct`/`findProductShopId`/`findShopOwnerById` al `export`, orden alfabético. **Único archivo compartido con US-30**: rebasear si arrancó primero.
- [x] 1.10 **Crear** `packages/db/vitest.config.ts` con `test: { fileParallelism: false }` (~8 líneas). Superficie nueva NO listada en la tabla «Archivos a crear/modificar» de US-29 — **ratificada en alcance por el usuario el 2026-09-11**; declararla igualmente como desviación en el reporte final. [DD29-10]
- [x] 1.11 Modificar `packages/db/src/repositories/products.integration.test.ts` (348 líneas hoy): centinela `SENTINEL_PREFIX = 'zz-products-'` plegado dentro del `beforeAll`/`afterAll` **existentes** (nunca un segundo `afterAll` — LIFO contra cliente desconectado); `describe`s de escritura **después** de los de lectura. Cubrir camino feliz: crear `simple` (min/max derivados = price), crear `variable` (price NULL, min/max del input), pivotes en los 3 estados (ausente/vacío/con ids), slug invariante en update, `updatedAt` monótono (`toBeGreaterThanOrEqual`, nunca igualdad pinneada), `delete` devuelve snapshot pre-borrado. [DD29-9, DD29-10]
- [x] 1.12 Verificar PR#1: `just db-build` (bloqueante, `dist/` gitignored) → `just db-check` verde. Pegar salida real y confirmar que los conteos existentes de `categories.integration.test.ts`/`shops.integration.test.ts` (198/83/584/82/188/44) no se movieron.

## Phase 2: Batería hostil de integración (`packages/db`, PR#2)

- [x] 2.1 Cubrir las 5 guardas CHECK/`IN` como violaciones HTTP-equivalentes vía repositorio (todas sobre filas centinela): `sale_price >= price` → `InvalidSalePriceError`; `simple` sin `price` → `MissingPriceError`; `product_type` fuera de `IN` → `InvalidReferenceError`; `status` fuera de `IN` → `InvalidReferenceError`; `products_procedencia_completa` documentada como inalcanzable por construcción (sin test de runtime, el input no declara `source_*`). [DD29-1, DD29-2, Herencia 2]
- [x] 2.2 Cubrir las 3 FK salientes (`type_id`/`shop_id`/`manufacturer_id`) inexistentes → `InvalidReferenceError` (400, vía `P2003`/`translateCatalogWriteError`), y los 2 pivotes (`categoryIds`/`tagIds`) con un id inexistente → `InvalidReferenceError` vía `_assertPivotIdsExist` (no vía `P2003`). [DD29-4, DD29-6]
- [x] 2.3 Cubrir la frontera numérica no entera/no finita: `type_id`/`shop_id`/`manufacturer_id`/ids de pivote no enteros (`"abc"`, `1e21`) → `InvalidReferenceError`; `price`/`sale_price`/`min_price`/`max_price` no finitos (`"abc"`, `NaN`, `1e300` fuera de `numeric(12,2)`) → `InvalidReferenceError`; `quantity` no entero → `InvalidReferenceError`. Ninguno produce 500. [DD29-3]
- [x] 2.4 Cubrir 404: `updateProduct`/`deleteProduct` con id inexistente → `RecordNotFoundError`. Cubrir duplicados en `categoryIds`/`tagIds` (`uniq()` evita el `P2002` espurio). [DD29-6, Herencia 2]
- [x] 2.5 Verificar PR#2: `just db-check` verde (con PR#1 ya aplicado). Pegar salida real, incluidos los conteos de cierre: `count(*) FROM products` restituido al valor medido antes de la corrida.

## Phase 3: Capa API — servicio, controller, DTO (`apps/api/rest`, PR#3 — US releasable aquí)

- [x] 3.1 Modificar `apps/api/rest/src/products/dto/create-product.dto.ts` (21 líneas hoy): añadir **solo** `manufacturer_id?: number` standalone (`type_id`/`shop_id` ya existen porque `Product` los declara y `OmitType` no los excluye) + documentar en comentario los campos que se aceptan y descartan (`variations`, `variation_options`, `author_id`, `digital_file`, `height`/`length`/`width`, `in_flash_sale`). Sin efecto de runtime (`main.ts:9` no tiene `transform`/`whitelist`). [Contratos de tipos, hueco H2 del design]
- [x] 3.2 Modificar `apps/api/rest/src/products/products.service.ts` (350 líneas hoy): migrar `create` (hoy `this.products[0]`, `:154-158`): construir `CreateProductInput` campo a campo con `Number(...)` en las 3 FK y `Array.isArray()` para `categoryIds`/`tagIds` (nunca `...body`); secuencia de propiedad — `shopId = Number(dto.shop_id)` → si `super_admin` saltar la sonda → `findShopOwnerById(shopId)` → `≠ sub` → 403, `null` → sigue (400 lo produce el repositorio); llamar `createProduct(input)`; proyectar `toProductDto(record)` (20 claves); `catch { throw toWriteHttpException(error); }`. [DD29-4, DD29-8]
- [x] 3.3 Migrar `update(id, dto)` (hoy `:343-345`): `!Number.isSafeInteger(id) || id<=0` → 404 antes de tocar el repositorio (nivel A); `findProductShopId(id)` → `null` → 404; propiedad sobre el `shop_id` **actual** (403 si `≠ sub`, salvo `super_admin`); si el body mueve `shop_id`, propiedad también del **destino** (`findShopOwnerById` del nuevo shopId, 403 si ajeno); construir `UpdateProductInput` campo a campo; `updateProduct(id, input)`; proyectar; mismo `catch`. Orden: 404 antes que 403, tienda actual antes que la de destino. [DD29-4]
- [x] 3.4 Migrar `remove(id)` (hoy `:347-349`, string): mismo guard de id (404), `findProductShopId` (404), propiedad sobre la actual (403), `deleteProduct(id)`, proyectar el snapshot, mismo `catch`. [DD29-4, DD29-5]
- [x] 3.5 Eliminar de `products.service.ts`: import de `@db/products.json` (`:22`) y de `plainToClass` (`:7`,`:29`) y el campo `private products` (`:154`). No tocar `listProducts`/`findProductBySlug`/`toProductDto`/`parseProductSearch` (ya migrados). [CA-7]
- [x] 3.6 Modificar `apps/api/rest/src/products/products.controller.ts` (98 líneas hoy): añadir `@CurrentUser()` en las 3 rutas de escritura (`:31`,`:49`,`:55` aprox.). **No tocar** los decoradores `@Permissions`/`ADMIN_OWNER_AND_STAFF`.
- [x] 3.7 Verificar PR#3: `just db-build` (bloqueante) → `just build-api` limpio → `grep -n "@db/\|plainToClass" apps/api/rest/src/products/products.service.ts` → 0 líneas → `just api-dev` arriba → secuencia `curl` `POST → GET por slug → reinicio de la API → GET por categoría → PUT → GET → DELETE → GET 404` con token `store_owner` → diff de `Object.keys()` (`node -e`, sin `.sort()`, `jq` no instalado) contra un producto del seed → `just verify` verde.

## Phase 4: `products.service.spec.ts` (`apps/api/rest`, PR#4)

- [x] 4.1 Modificar `apps/api/rest/src/products/products.service.spec.ts` (628 líneas hoy, 20 `it` de lectura intactos): ampliar `jest.mock('@safari/db', ...)` (`:36-43`) con `createProduct`, `updateProduct`, `deleteProduct`, `findProductShopId`, `findShopOwnerById`; clases de error y `toWriteHttpException` reales vía `jest.requireActual`/import directo.
- [x] 4.2 Cubrir `create`/`update`/`remove`: proyección de 20 claves en el mismo orden que `getProduct`; `Number()` de las 3 FK desde body string; id `NaN`/no-entero-seguro/`<=0` → 404 sin llamar al repositorio (nivel A); `parent`/`shop_id` `null` explícito manejado sin `Number(null)===0` (paralelo a DD28-10). **Hallazgo real, corregido (autorizado, PR#3 fix — ver apply-progress.md § GATE RESUELTO):** `manufacturer_id: null` explícito llegaba como `Number(null) === 0` en vez de `null` (R29-7), en `create()` y `update()` de `products.service.ts`. Fix de 2 líneas por sitio aplicado (fuera de `products.service.spec.ts`, en un commit separado). El test que lo detectó ahora pasa en verde.
- [x] 4.3 Cubrir los 5 roles de CA-5 en las 3 rutas: `store_owner` dueño → 200; `store_owner` ajeno → 403; `super_admin` → 200 sin sondear `findShopOwnerById` (short-circuit); `staff` → 403; sin token → 401 (a nivel de guard, declarado). Cubrir el caso `PUT` que mueve `shop_id` a tienda ajena → 403 (ambos lados de la propiedad).
- [x] 4.4 Cubrir cada clase de error de dominio (`InvalidSalePriceError`, `MissingPriceError`, `InvalidReferenceError`, `RecordNotFoundError`, `SlugConflictError`) → su status HTTP vía `toWriteHttpException`.
- [x] 4.5 Verificar PR#4: `cd apps/api/rest && npx jest` verde. **Verde tras el fix autorizado**: 9 suites / 204 tests, todos en verde (conteo real, no el "4 suites / 65 tests" obsoleto de `CLAUDE.md`, sin corregirlo). `just build-api` limpio tras el fix. El archivo de tests no desbordó el forecast (~650): +387 líneas reales.

## Phase 5: Cierre de la DoD (evidencia, todo PR)

- [ ] 5.1 CA-1/CA-2/CA-3: secuencia completa `POST → GET → reinicio → GET por categoría → PUT → GET → DELETE → GET 404` con token `store_owner`, pegada con status+body; key-set de 20 claves diffeado contra un producto del seed.
- [ ] 5.2 CA-4: `curl` pegados, ninguno 500 — 400 rebaja inválida, 400 `simple` sin `price`, 400 `product_type` fuera de `IN`, 400 `status` fuera de `IN`, 400 FK/pivote inexistente (×5), 400 id no entero en las 3 FK, 404 id inexistente en `PUT`/`DELETE`.
- [ ] 5.3 CA-5: `curl` pegados — 403 dueño ajeno (3 rutas), 403 `PUT` que mueve `shop_id` a tienda ajena, 200 dueño propio, 200 `super_admin`, 403 `staff`, 401 sin token.
- [ ] 5.4 CA-6: `curl` pegado — `variable` con `price` ausente y `min/max` presentes, creado y leído como los 58 del seed; `variations`/`variation_options` descartados y declarados en el reporte.
- [ ] 5.5 Herencia 1 (US-28): `psql` (`just db-shell`) — crear categoría **centinela** (nunca del seed) → `POST /products` enlazándola → `DELETE /categories/:id` → `SELECT count(*) FROM category_product WHERE category_id = :id` → **0**. Cierre: borrar producto y categoría centinela, `count(*) FROM categories` = 198. El escenario `UNTESTED` de `category-tree-api` pasa a `COMPLIANT`.
- [ ] 5.6 Herencia 2 (US-28): tabla de cobertura de las 5 guardas (1 heredada-adaptada / 3 nuevas / 1 por construcción, sin guarda de runtime) pegada en el reporte, y el escenario añadido a `catalog-write-foundations`.
- [ ] 5.7 `grep -n "@db/\|plainToClass" apps/api/rest/src/products/products.service.ts` → 0 líneas; `git diff --stat` sin cambios en `slug.ts`, `domain-errors.ts`, `common/errors/`, `db/schema.sql`, `apps/shop`, `apps/admin`, ni en el cuerpo de `upsertScrapedProduct`.
- [ ] 5.8 Cierre de conteos vía `psql`: `SELECT count(*) FROM products` = **1200**; `category_product`/`product_tag` de vuelta al conteo medido **antes** de empezar (no asumido en 0).
- [ ] 5.9 Smoke-test en el navegador declarado (sin tocar el frontend): tras el `PUT`, el admin aterriza en `/products/{slug}/edit` con los valores guardados.
- [ ] 5.10 Actualizar el Status de US-29 (`docs/product/26-escrituras-catalogo-postgres/29-escrituras-productos-postgres.md`) y marcar su fila en el README del épico.

## Review Workload Forecast

Estimated changed lines: 2340
400-line budget risk: High
Chained PRs recommended: Yes
Decision needed before apply: Yes

| PR | Contenido | ~Líneas | Runner |
|---|---|---|---|
| #1 | `packages/db`: 3 escrituras + guardas + `findShopOwnerById`/`findProductShopId` + barrel + `vitest.config.ts` + integración camino feliz | ~863 | `just db-check` |
| #2 | `packages/db`: batería hostil de integración (5 guardas, 3 FK + 2 pivotes, no-enteros/no-finitos, 404) | ~330 | `just db-check` |
| #3 | API: servicio + controller + DTO. **US releasable aquí** | ~210 | `just build-api` + curl + `just verify` |
| #4 | `products.service.spec.ts` | ~650 | `cd apps/api/rest && npx jest` |
| — | Margen de redondeo/ajustes finos del diseño | ~287 | — |
