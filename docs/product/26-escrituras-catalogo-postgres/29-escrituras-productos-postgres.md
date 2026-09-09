# US-29 — Escrituras de productos con categorías y tags

> `POST/PUT/DELETE /products` dejan de devolver la fila 0 del mock y pasan a
> escribir en `products` y sus dos pivotes, con los CHECK validados antes
> del INSERT y una comprobación de propiedad por tienda que hoy no existe.
> Es la US de más valor y más riesgo del épico.

**Épico:** [Épico 26](./README.md)
**Fecha:** 2026-09-09
**Status:** Listo para ejecución
**Depende de:** US-27a
**LOC est.:** ~550

## Historia
**Como** dueño de tienda, **quiero** que crear o editar un producto en el
panel cambie lo que la tienda muestra, **para** que el catálogo deje de
depender de un JSON de 2021 y del scraper como únicas fuentes.

## Contexto

- `products.service.ts:154-158` (`create` → `this.products[0]`), `:343-345`
  (`update`), `:347-349` (`remove` → string). El import de
  `products.json` (`:22`) y `plainToClass` (`:29`) solo sostienen esos
  stubs (comentario `:26-28`).
- `CreateProductDto` (`create-product.dto.ts:4-21`): `OmitType(Product, …)`
  más `categories: number[]` y `tags: number[]`; `UpdateProductDto` es su
  `PartialType`. El body llega entero (`main.ts:9`).
- Lo que el admin envía (`components/product/form-utils.ts:226-340`):
  `name`, `description`, `type_id`, `shop_id`, `product_type`, `price`,
  `sale_price`, `quantity`, `unit`, `sku`, `status`, `visibility`,
  `is_taxable`, `is_digital`, `is_external`, `external_product_url`,
  `image`, `gallery[]`, `categories: number[]`, `tags: number[]`,
  `manufacturer_id`, `author_id`, `in_flash_sale`, `height/length/width`,
  `digital_file`, `variations[]` y `variation_options{upsert, delete}`;
  para `variable`, `min_price`/`max_price` calculados (`:333`).
- Tras `PUT`, el admin redirige a `/products/{data.slug}/edit`
  (`data/product.ts:57`): **la respuesta debe traer `slug`**. Tras `POST`
  redirige a la lista (`:23-26`); tras `DELETE` solo invalida la query.
- DDL: `db/schema.sql:324-405`. `type_id`/`shop_id` `NOT NULL`;
  `manufacturer_id … SET NULL`; CHECKs `products_rebaja_valida` (`:393-394`,
  `sale_price < price`), `products_simple_con_precio` (`:398-399`),
  `products_procedencia_completa` (`:403-404`; los `source_*` quedan `NULL`
  para productos "creados desde el admin", comentario `:381-382`).
  Pivotes `category_product` y `product_tag` (`:425-435`).
- Precedente de escritura: `upsertScrapedProduct`
  (`products.repository.ts:328-397`): valida `salePrice < price` antes de
  tocar la base (`:331-333`), `slug` inmutable en update (`:382`),
  reemplazo completo de pivotes cuando vienen (`:383-388`),
  `_translateCheckViolation` (`:454`). Los errores de dominio ya existen:
  `InvalidSalePriceError`, `MissingPriceError` (`index.ts:72-75`).
- Proyección: `toProductDto` (`products.service.ts:116-150`, 20 claves;
  `in_flash_sale: 0` y `type.logo: null` constantes); detalle con
  `related_products` (`:193-216`).
- Datos: 1200 productos, 58 `variable` con **0** `variations`; **0**
  productos con `categories` o `tags` → `category_product` vacía
  (`db/README.md:37-40`). Los primeros enlaces reales saldrán de esta US
  (R-6).
- Permisos: `ADMIN_OWNER_AND_STAFF` en las tres rutas
  (`products.controller.ts:29,47,53`). `@CurrentUser()` disponible
  (`auth/decorators/current-user.decorator.ts`). **No hay comprobación de
  propiedad**: hoy un `store_owner` puede enviar el `shop_id` de otra
  tienda (decisión 8, R-2).
- `shops.owner_id` existe con FK (`schema.sql:236`); el `sub` del token es
  el `users.id` (US-22). La consulta de propiedad es `shops.owner_id = sub`.
- Spec existente: `products.service.spec.ts` (628 líneas, 22 `it`) cubre
  solo lecturas; mockea `listProducts`/`findProductBySlug` (`:36-43`).

## Scope

**Incluye:** `createProduct`/`updateProduct`/`deleteProduct` en `@safari/db`
(escalares con columna, pivotes `categories`/`tags`, validación de CHECKs
antes del INSERT, slug con el helper de US-27a) y sus tests de integración;
los tres métodos del servicio con proyección `toProductDto`; la
comprobación de propiedad por tienda (D-5); productos `variable` según la
decisión 10; eliminación del import de `products.json`; extensión del spec
de jest.

**NO incluye:** persistir `variations`/`variation_options`, `author_id`,
`digital_file`, `height/length/width`, `in_flash_sale` (sin columna,
decisión 5); tablas de atributos; `related_products` distintos de los que ya
calcula `findProductBySlug`; búsqueda; cambios en `listProducts`; `source_*`
(el admin nunca los escribe); frontend.

## Criterios de aceptación

### CA-1 — Crear un producto simple visible en la tienda
`POST /products` con el payload del formulario (categorías y tags por id)
crea la fila y los enlaces en ambos pivotes. La respuesta tiene las 20
claves de `toProductDto` en el mismo orden que `GET /products/:slug`. Con
`status=publish` y `visibility=visibility_public`, el producto aparece en
`GET /products?search=name:{nombre}` y en
`GET /products?search=categories.slug:{slug}` **tras reiniciar la API**.

### CA-2 — Editar persiste, reemplaza pivotes y conserva el slug
`PUT /products/:id` actualiza escalares, **reemplaza** el conjunto de
categorías/tags si vienen (y no lo toca si no vienen), deja `slug` intacto
aunque cambie `name`, y devuelve `slug` en la respuesta. `updated_at`
avanza (trigger del DDL).

### CA-3 — Borrar
`DELETE /products/:id` borra la fila y sus enlaces; el `GET` posterior es
404; la respuesta es el producto borrado con 20 claves.

### CA-4 — CHECKs traducidos, nunca 500
`sale_price >= price` → 400. `product_type=simple` sin `price` → 400.
`type_id`/`shop_id`/`manufacturer_id`/categoría/tag inexistentes → 400.
Id inexistente en `PUT`/`DELETE` → 404. Ninguno deja un 500.

### CA-5 — Propiedad por tienda
`store_owner` con `shop_id` de una tienda cuyo `owner_id` no es su `sub` →
**403** en las tres rutas; sobre su propia tienda → 200. `super_admin` →
200 en cualquiera. `staff` → 403 declarado (sin relación staff↔tienda,
decisión 8). `customer` → 403 por el guard. Sin token → 401.

### CA-6 — Productos `variable`
Se acepta `product_type=variable` con `price` ausente y `min_price`/
`max_price` presentes; `variations`/`variation_options` se ignoran y el
reporte lo declara. La lectura devuelve el producto como los 58 variables
del seed.

### CA-7 — Sin mock huérfano ni regresión
`products.service.ts` ya no importa `products.json` ni `plainToClass`.
`just db-check`, `npx jest` (incluidos los 22 tests previos), `just
build-api` y `just verify` verdes; `SELECT count(*) FROM products` vuelve a
1200 y `category_product`/`product_tag` a 0 filas tras la corrida de tests
(o al número que el scraper haya dejado, medido antes/después).

## Escenarios Gherkin

```gherkin
Feature: Escrituras de productos
  Scenario: CA-1 — el producto creado aparece filtrado por categoria
    Given un token store_owner dueño de la tienda 9
    When se hace POST /products con shop_id 9, type_id 9, categories [<id de laptop>] y status publish
    And se reinicia la API
    Then GET /products?search=categories.slug:laptop incluye el producto
    And GET /products/<slug> devuelve 20 claves

  Scenario: CA-4 — rebaja invalida
    Given un payload con price 100 y sale_price 100
    When se hace POST /products
    Then la respuesta es 400
    And ninguna fila nueva existe en products

  Scenario: CA-5 — un dueño no edita productos ajenos
    Given un token store_owner cuyo sub no es el owner_id de la tienda 4
    When se hace PUT /products/<id de un producto de la tienda 4>
    Then la respuesta es 403
    And el producto no cambia
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `packages/db/src/repositories/products.repository.ts` | `createProduct`/`updateProduct`/`deleteProduct`; `CreateProductInput`/`UpdateProductInput` explícitos; reutilizar la validación y `_translateCheckViolation` del upsert del scraper |
| `packages/db/src/repositories/shops.repository.ts` | consulta mínima de propiedad si no la aporta `findShopBySlug`/`ShopRecord.ownerId` (ya existe `ownerId`, `shops.service.ts:48`) |
| `packages/db/src/repositories/products.integration.test.ts` | escrituras, pivotes, CHECKs, variable, limpieza |
| `packages/db/index.ts` | exportar |
| `apps/api/rest/src/products/products.service.ts` | migrar 3 métodos; propiedad; quitar `products.json`/`plainToClass` |
| `apps/api/rest/src/products/products.controller.ts` | pasar `@CurrentUser()` a `create`/`update`/`remove` |
| `apps/api/rest/src/products/dto/create-product.dto.ts` | declarar `type_id`, `shop_id`, `manufacturer_id` y los campos ignorados como opcionales documentados |
| `apps/api/rest/src/products/products.service.spec.ts` | casos de escritura, propiedad y errores |

## Definición de Done

- [ ] Secuencia `POST → GET por slug → reinicio → GET por categoría → PUT →
      GET → DELETE → GET 404` pegada con token `store_owner` sobre su
      tienda; key-set de 20 claves comparado contra un producto del seed.
- [ ] `psql` pegado: filas de `category_product`/`product_tag` del producto
      creado, y su ausencia tras el `DELETE`.
- [ ] `curl` de CA-4 pegado: 400 rebaja, 400 simple sin precio, 400 FK
      inexistente, 404 id inexistente.
- [ ] `curl` de CA-5 pegado: 403 dueño ajeno, 200 dueño propio, 200
      `super_admin`, 403 `staff`, 401 sin token.
- [ ] `curl` de CA-6 pegado: `variable` creado y leído; divergencia
      declarada.
- [ ] `grep -n "@db/\|plainToClass" products.service.ts` → 0 líneas.
- [ ] `just db-check`, `npx jest`, `just build-api`, `just verify` verdes,
      con recuentos; conteo de `products` = 1200 tras los tests.
- [ ] Nota en el reporte sobre R-6 (primeros enlaces reales en
      `category_product`).
- [ ] Status de esta US actualizado y fila del épico marcada.

## Notas para el agente ejecutor

- **No hacer spread del body a Prisma.** El payload trae
  `variation_options: {upsert: [], delete: [...]}`, `author_id`,
  `digital_file`… (R-5). El `CreateProductInput` se construye campo a campo
  en el servicio; lo desconocido se descarta y se lista en el reporte.
- Para un `simple`, `min_price`/`max_price` valen lo mismo que `price`
  (comentario `schema.sql:342-344`, y así lo hace `upsertScrapedProduct`
  `:352-353`). Para un `variable`, tomar los `min/max` que envía el admin.
- El precio llega como number del formulario, pero el DTO no lo garantiza:
  aplicar el criterio de `parseFiniteNumber` (`products.service.ts:42-45`)
  antes de pasarlo al repositorio; `NaN` → 400, no un 500 de Prisma.
- La propiedad se comprueba **también en `update`/`remove`** leyendo el
  `shop_id` actual del producto (no el del body): un `PUT` que cambia
  `shop_id` a otra tienda exige propiedad de **ambas**.
- `quantity`/`in_stock`: el admin envía `quantity`; la columna `in_stock`
  no la envía. Regla mínima: `in_stock = quantity > 0` si no viene
  explícito. Declararlo.
- El `GET` de detalle devuelve `related_products` (`:212-215`); la
  respuesta de `POST`/`PUT` no los necesita: 20 claves exactas de
  `toProductDto`, sin `related_products`, y así se declara (el admin no los
  lee).
- Comprobar en el navegador que el admin, tras el `PUT`, aterriza en
  `/products/{slug}/edit` con los valores guardados. Es una verificación
  de UI que no implica cambiar el frontend.
