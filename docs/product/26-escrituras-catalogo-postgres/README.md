# Épico 26 — Escrituras del catálogo desde Postgres

> Los seis servicios del catálogo (`products`, `categories`, `tags`, `types`,
> `manufacturers`, `shops`) **leen** de Postgres desde el Épico 1, pero sus
> `create`/`update`/`remove` siguen siendo los stubs del scaffold: devuelven
> `this.X[0]` del JSON y no persisten nada. Hoy un administrador edita un
> producto, ve el toast de "actualizado" y no cambió ninguna fila. Este épico
> convierte esas escrituras en reales sobre las **tablas que ya existen**, sin
> DDL, sin `db-reset` y sin tocar el contrato que el admin consume.

**Fecha:** 2026-09-09
**Status:** En ejecución (US-27a, US-27b y US-28 implementadas 2026-09-10/11; quedan US-29, US-30)

## Contexto verificado

- **Los stubs.** `apps/api/rest/src/products/products.service.ts:156-158`
  (`create` → `this.products[0]`), `:343-345` (`update`, ídem), `:347-349`
  (`remove` → el string `This action removes a #id product`). Mismo patrón en
  `categories.service.ts:185-187,244-250`, `types.service.ts:92-94,104-110`,
  `tags.service.ts:67-72` (fabrica un `id: tags.length + 1` y devuelve el DTO
  sin guardarlo), `:131-137`, `manufacturers.service.ts:76-78,171-182` y
  `shops.service.ts:97-99,230-254`. El comentario de
  `products.service.ts:26-28` lo declara: el JSON "solo sostiene los stubs de
  escritura".
- **Dos escrituras "funcionan" hasta el reinicio.**
  `manufacturers.service.ts:171-178` (`update`) y
  `shops.service.ts:242-254` (`disapproveShop`/`approveShop`) mutan el array
  en memoria del mock. El toggle `is_approved` de la lista de marcas del
  admin (`apps/admin/rest/src/components/manufacturer/manufacturer-list.tsx:125-158`)
  y la cola de aprobación de tiendas
  (`apps/admin/rest/src/components/shop/approve-shop-view.tsx`) parecen
  funcionar y pierden el cambio al reiniciar la API.
- **Las tablas existen y tienen los índices y CHECKs que las escrituras
  necesitan.** `db/schema.sql:90-101` (`types`), `:231-244` (`shops`),
  `:261-275` (`categories`, con `parent_id … ON DELETE SET NULL` y el CHECK
  `categories_no_autoreferencia`), `:281-292` (`manufacturers`), `:295-306`
  (`tags`), `:324-405` (`products`, CHECKs `products_rebaja_valida`,
  `products_simple_con_precio`, `products_procedencia_completa`) y los
  pivotes `category_product`/`product_tag` (`:425-435`). **Ninguna de las
  cinco US de este épico añade una columna.**
- **`@safari/db` ya escribe en `products` y `shops`**, para el scraper:
  `upsertScrapedProduct` (`packages/db/src/repositories/products.repository.ts:328-397`)
  valida los CHECK antes del INSERT (`:331-333`), no toca el `slug` en
  update (`:382`) y reemplaza los pivotes completos; `findOrCreateShopBySlug`
  (`shops.repository.ts:170-186`) y `findOrCreateManufacturerBySlug`
  (`packages/db/index.ts:59`). No hay ni un `create*`/`update*`/`delete*`
  para el admin: `packages/db/index.ts:51-92` exporta solo lecturas de
  `categories`, `tags` y `types`.
- **El admin sí llama a estas rutas.** `apps/admin/rest/src/data/product.ts:17-90`
  (`useCreateProductMutation`/`useUpdateProductMutation`/`useDeleteProductMutation`),
  y los equivalentes en `data/category.ts`, `data/tag.ts`, `data/type.ts`,
  `data/manufacturer.ts`, `data/shop.ts`, todos con formulario y vista de
  borrado en `components/`. El único dato de la respuesta que el admin
  consume es **`data.slug`** tras un `PUT /products/:id`
  (`data/product.ts:57`, redirige a `/products/{slug}/edit`); los
  `*-delete-view.tsx` ignoran el body.
- **El body llega entero.** `apps/api/rest/src/main.ts:9` registra
  `new ValidationPipe()` sin `transform` ni `whitelist`: los DTOs
  (`PickType`/`OmitType` sobre las entidades; `CreateTypeDto` es una clase
  vacía, `create-type.dto.ts:1`; `CreateManufacturerDto` **omite `name`**,
  `create-manufacturer.dto.ts:4-18`) no filtran nada. El conjunto de campos
  real lo define lo que el formulario del admin envía
  (`components/product/form-utils.ts:226-340`,
  `components/category/category-form.tsx:222-235`,
  `components/tag/tag-form.tsx:162-190`,
  `components/group/group-form.tsx:312-338`,
  `components/manufacturer/manufacturer-form.tsx:79-86`,
  `components/shop/shop-form.tsx:191-215`).
- **Las rutas ya están protegidas** (US-23): `POST/PUT/DELETE` de
  `categories`, `tags` y `types` exigen `ADMIN_ONLY`
  (`categories.controller.ts:22-54`, `tags.controller.ts:22-50`,
  `types.controller.ts:22-50`); `products` y `manufacturers`,
  `ADMIN_OWNER_AND_STAFF` (`products.controller.ts:29-57`,
  `manufacturers.controller.ts:30-65`); `shops`, `ADMIN_AND_OWNER`, con
  `approve-shop`/`disapprove-shop` en `ADMIN_ONLY`
  (`shops.controller.ts:28-56,103-123`). El `sub` del token está disponible
  vía `@CurrentUser()` (`apps/api/rest/src/auth/decorators/current-user.decorator.ts`,
  usado en `users.controller.ts:62`). Lo que **no** existe es una
  comprobación de propiedad: un `store_owner` puede hoy enviar un `PUT
  /products/:id` con el `shop_id` de otra tienda.
- **Slug.** La base ya tiene `slugify()` (`db/schema.sql:48-61`), que el
  scraper usa (decisión 3 del Épico 5). `slug` es `UNIQUE` en las seis
  tablas y es la URL pública del producto (`/products/{slug}`).
- **Los borrados del DDL arrastran.** `products.type_id … ON DELETE CASCADE`
  (`db/schema.sql:331`), `products.shop_id … ON DELETE CASCADE` (`:332`),
  `categories.type_id … ON DELETE CASCADE` (`:269`). Un `DELETE /types/:id`
  ingenuo borraría las categorías y **los productos** de esa vertical desde
  un clic en `components/group/group-delete-view.tsx`. En cambio
  `categories.parent_id` y `products.manufacturer_id` son `SET NULL`
  (`:268`, `:333`) y los pivotes solo desenlazan.
- **`updated_at` no se actualiza solo en tres tablas.** Los triggers de
  `db/schema.sql:488-500` cubren `products`, `categories`, `shops`, `users`
  y `profiles`; el comentario de `:494-496` deja fuera a `types`/`tags`
  (`manufacturers` tampoco lo tiene). Hasta ahora no importaba: nadie las
  actualizaba.
- **Datos de partida relevantes.** `products.json` trae 1200 productos, 58
  con `product_type: 'variable'` y **0** con `variations`, `categories` o
  `tags` (medido con `node -e` sobre el JSON); `category_product` está vacía
  a propósito (`db/README.md:37-40`). `shops.json` trae `staffs: []` en las
  9 tiendas: `GET /staffs` devuelve hoy una lista vacía para cualquier
  `shop_id` (`shops.service.ts:174-188`).
- **Lo que este épico hereda como deuda declarada.** US-4a excluyó por
  escrito los "endpoints de escritura del admin"
  (`docs/product/1-catalogo-desde-postgres/4-migrar-catalogos-apoyo.md:36-41`);
  US-5, las "escrituras reales (`create`/`update`/`remove` siguen siendo
  stubs del mock en toda la API)"
  (`5-endpoints-derivados-postgres.md:52-55`). Este es el épico que las
  recoge.

## Cómo se acotó este épico (y qué difiere)

La API tiene **250 rutas**; **78** viven en los 9 módulos que ya importan
`@safari/db` y ~172 siguen sirviendo JSON estático desde 25 módulos
(`orders` 17, `wishlists` 12, `questions` 10, `reviews` 10, `coupons` 9, …).
Un solo épico para todo eso sería inejecutable. Se pesaron tres cortes:

| Corte | Tablas | DDL / `db-reset` | Valor visible | Veredicto |
|---|---|---|---|---|
| **A. Escrituras del catálogo** (este épico) | las 6 ya existen | **No** | El admin persiste lo que guarda; hoy no persiste nada | **Elegido** |
| B. Contenido y configuración (`faqs`, `terms-and-conditions`, `refund-policies`, `refund-reasons`, `shippings`, `taxes`, `attributes`, `store-notices`) | 8 tablas nuevas | Sí (un DDL, un reset) | CRUD del admin sobre textos y tablas de tarifas | Diferido: segundo épico |
| C. Núcleo transaccional (`orders`, `reviews`, `questions`, `wishlists`, `coupons`, `withdraws`, `refunds`, `payment-*`) | ~12 tablas nuevas | Sí, y levanta la exclusión de `db/schema.sql:13-16` | Checkout real | Diferido: exige decisión del dueño sobre la exclusión |

A se elige porque es el **único corte desbloqueado hoy**: no exige DDL ni
`db-reset` (decisión 1), cierra la deuda que el Épico 1 dejó declarada y es,
por línea de código, lo más valioso del repo — el admin entero es hoy una
maqueta de lectura. El inventario completo de los 25 módulos mock, con la
evidencia de qué frontend llama a cada uno y la secuencia propuesta para B y
C, queda en
[`_backlog/api-mock-restante-dominio-transaccional.md`](../_backlog/api-mock-restante-dominio-transaccional.md).
No es producto todavía: no hay decisión de "se hace" sobre la exclusión del
esquema.

**Dentro de A también se difiere**, porque necesita DDL:

- **`GET/POST/DELETE /staffs`** (`shops.controller.ts:72-101`): no hay
  relación staff↔tienda en la base (`users` no tiene `shop_id`; US-25 modeló
  staff solo como permiso). Se conserva el comportamiento observable actual
  (lista vacía) sin leer el JSON; ver decisión 11.
- **`balance`/`admin_commission_rate`** de tiendas, **`variations`/
  `variation_options`/`attributes`** de productos, **`author_id`**,
  `digital_file`, `socials`/`cover_image` de marcas, `promotional_sliders`
  de types, `categories[]` de tiendas: sin columna. Se ignoran en la
  escritura y se declaran (decisión 5), igual que las lecturas ya emiten
  constantes para ellos (V-* de las US del Épico 1).

## Subdivisión en sub-historias

| US | Título | Releasable solo | Depende de | LOC est. | Status |
|----|--------|-----------------|------------|----------|--------|
| [US-27a](./27-escrituras-types-fundaciones.md) | Escrituras de `types` y las piezas compartidas | Sí | ninguna | ~725 (real ~1470) | **Implementada** (2026-09-10) |
| [US-27b](./27b-escrituras-tags-manufacturers.md) | Escrituras de `tags` y `manufacturers` | Sí | US-27a | ~825 (real ~2109) | **Implementada** (2026-09-10) |
| [US-28](./28-escrituras-arbol-categorias.md) | Escrituras del árbol de categorías | Sí | US-27a | ~350 (real ~1612, 3 PRs) | **Implementada** (2026-09-11) |
| [US-29](./29-escrituras-productos-postgres.md) | Escrituras de productos con categorías y tags | Sí | US-27a | ~550 | Listo para ejecución |
| [US-30](./30-escrituras-moderacion-tiendas.md) | Escrituras y moderación de tiendas | Sí | US-27a | ~400 | Listo para ejecución |

**Orden sugerido:** US-27a → (US-27b ∥ US-28 ∥ US-29 ∥ US-30). US-27a
introduce las dos piezas compartidas (el helper de slug en `packages/db` y la
traducción de errores de dominio → HTTP en la API, D-3/D-4) y las prueba
contra un recurso real; las otras cuatro las consumen y no comparten archivos
entre sí **salvo el barrel `packages/db/index.ts`**: quien arranque segundo
rebasea sobre él, igual que US-4b sobre US-4a en el Épico 1.

**Sobre las estimaciones:** incluyen tests de integración y specs de jest.
El precedente cercano es US-25 (estimada ~420, aterrizó ~965 líneas con
tests) y US-4a (~590 reales para 4 catálogos de solo lectura). Esperar entre
+50 % y +100 % sobre lo estimado; si una US supera ~900 líneas reales, es
señal de partirla, no de apretar.

**Partición de US-27 (2026-09-09).** La US-27 original cubría los tres
catálogos planos con ~500 líneas estimadas. La fase de propuesta del SDD la
pronosticó en **~1500 (±200)**: la estimación no contemplaba las tres specs
de jest que su propia tabla de archivos exigía (ancla verificada:
`shops.service.spec.ts` = 143 líneas) ni el volumen real de los tests de
integración. Al superar el umbral de ~900 del párrafo anterior, se partió
según su propia regla. El corte es **vertical, no por capas**: se descartó
"fundaciones vs. servicios" porque habría dejado una US-27a sin consumidor
—`packages/db` escrito y verde, el admin todavía sin persistir nada— y por
tanto no releasable, rompiendo la columna que las cinco filas mantienen en
"Sí". Con el corte vertical, US-27a se lleva además el riesgo alto del épico
(R-1: el 409 del borrado protegido de `types`) y US-27b hereda unas piezas
compartidas ya probadas en producción. Efecto secundario deseable: US-27b
queda como par de US-28/29/30, todas dependiendo solo de US-27a.

**Rutas que este épico migra:** 19 — `POST/PUT/DELETE` de `products`,
`categories`, `tags`, `types` y `manufacturers` (15), `POST/PUT /shops`
(2) y `POST /approve-shop`, `POST /disapprove-shop` (2). **Quedan como
stubs declarados:** `DELETE /shops/:id`, `POST /shops/approve`,
`POST /shops/disapprove` y las 5 rutas de `staffs` (decisiones 7 y 11).

## Refinamiento — Decisiones tomadas

| # | Tema | Decisión |
|---|------|----------|
| 1 | DDL y `just db-reset` | **Este épico no toca `db/schema.sql` ni `db/seed.sql` y no exige ningún `db-reset`.** Es el criterio que lo define: las 6 tablas existen con los CHECKs y FKs necesarios. Todo lo que pediría una columna (staff↔tienda, `balance`, variaciones, autores, triggers de `updated_at` para `types`/`tags`/`manufacturers`) se difiere al épico siguiente, que deberá seguir el precedente del Épico 19 (decisión 2: **un DDL, un reset**) y renovar la autorización del dueño, que en 2026-08-31 se dio para aquel épico. |
| 2 | Alcance exacto | Las escrituras de los 6 agregados con tabla, más las **lecturas residuales** que viven dentro de esos servicios: el `find` por id de `manufacturers.service.ts:172` y `shops.service.ts:243,250`, y `GET /staffs`. Tras el épico, **ningún servicio del catálogo importa `@db/*.json` ni `fuse.js`**. |
| 3 | Contrato de las escrituras | La respuesta de `POST`/`PUT` es **la misma proyección que el `GET` por slug** del agregado (`toProductDto` 20 claves, `toCategoryDto` 16, `toShopDto` 16, `toManufacturerDto` 13, `toTypeDto`/`toTagDto` 9), reutilizando esos mappers (D-6). Lo que hoy devuelven los stubs (la fila 0 del mock) no es contrato: ningún consumidor depende de ese contenido; el único campo que el admin lee es `slug` tras un `PUT /products/:id` (`data/product.ts:57`). `DELETE` devuelve el registro borrado con la misma proyección; el string del scaffold no lo lee nadie. |
| 4 | Slug | Se genera **en el servidor** con la misma regla que `slugify()` de la base (`db/schema.sql:48-61`), sobre el `slug` que envíe el cliente si lo envía (`category-form.tsx:228`) o sobre `name` si no. **Inmutable en update** (es la URL pública; precedente `upsertScrapedProduct`, `products.repository.ts:382`). Colisión → sufijo numérico incremental (`-2`, `-3`, …). `name` que slugifica a vacío → 400. |
| 5 | Campos sin columna | Se **ignoran en la escritura y se declaran** en el reporte de cada US, por agregado: `products`: `author_id`, `variations`, `variation_options`, `digital_file`, `height/length/width`, `in_flash_sale`; `shops`: `balance`, `categories[]`, `admin_commission_rate` del approve; `types`: `promotional_sliders`; `manufacturers`: `socials`, `cover_image`; `tags`/`categories`: `translated_languages`. La respuesta emite para ellos las mismas constantes que ya emiten las lecturas. No hay 400 por campo desconocido: `ValidationPipe` no hace whitelist hoy (`main.ts:9`) y activarlo cambiaría 250 rutas. |
| 6 | Validación y errores | El repositorio valida **antes** del INSERT lo que los CHECK exigen (precedente `upsertScrapedProduct`, `:331-333`) y traduce las violaciones que lleguen de Postgres a errores de dominio (`_translateCheckViolation`, `:454`). El servicio los mapea a HTTP: **400** (CHECK, FK a `type_id`/`parent_id`/`shop_id` inexistente, nombre vacío), **404** (id inexistente en `PUT`/`DELETE`), **409** (slug duplicado tras agotar el sufijo, borrado protegido). Nunca 500 (D-2 del Épico 1). |
| 7 | Borrados | **`DELETE /types/:id` es protegido**: si la vertical tiene categorías o productos, **409**; el `CASCADE` del DDL (`schema.sql:269,331`) queda como red de integridad, no como comportamiento de la API. `categories`: se permite; las hijas pasan a raíz por `SET NULL` (`:268`) y los enlaces `category_product` caen. `tags` y `manufacturers`: se permite (desenlace/`SET NULL`). `products`: se permite (los pivotes caen). **`DELETE /shops/:id` NO se implementa**: no tiene consumidor en el admin (no existe `useDeleteShopMutation` en `data/shop.ts`) y arrastraría los productos de la tienda (`:332`). Queda como stub declarado, igual que `social-login` en el Épico 19. |
| 8 | Propiedad del recurso | Los decoradores de ruta no cambian. En `products` y `shops` el **servicio** comprueba propiedad: un `store_owner` solo escribe sobre tiendas cuyo `owner_id` es el `sub` del token (`shop_id` del producto, `id` de la tienda); `super_admin` sobre cualquiera; fuera de eso, **403**. `staff` no tiene relación con ninguna tienda en la base (diferido), así que **recibe 403 en escrituras de productos** aunque `ADMIN_OWNER_AND_STAFF` le abra la ruta — se declara. El guard sigue resolviendo solo desde el token (D-5 del Épico 19); la propiedad es una consulta del servicio. |
| 9 | `updated_at` | Para `types`, `tags` y `manufacturers` (sin trigger, `schema.sql:488-500`) el repositorio fija `updatedAt: now()` en cada update. Añadir los triggers es DDL y va al lote del épico siguiente. `created_at`/`updated_at` salen con la divergencia ya embarcada (3 decimales, hora real). |
| 10 | Productos `variable` | Se aceptan: se persisten `product_type`, `min_price`/`max_price` (`calculateMinMaxPrice`, `form-utils.ts:333`) y `price` en `NULL` (permitido por `products_simple_con_precio`, `:398-399`). Las variaciones **no se persisten** (no hay tablas de atributos) y se declaran. Es lo que el seed ya hace con sus 58 productos variables. |
| 11 | `staffs` | `GET /staffs` conserva su comportamiento observable (paginador vacío: `shops.json` trae `staffs: []` en 9/9 tiendas) **sin leer el JSON**. `POST /staffs` y `DELETE /staffs/:id` siguen stubs declarados. La relación staff↔tienda exige DDL y se difiere. |
| 12 | Paginación | Este épico no añade listados paginados. Si una US lo necesitara, usa `buildPaginator` de `@safari/db` pasando `limit` **crudo** y `baseUrl` (precedente US-25, `users.service.ts:263-294`), nunca un tercer helper. La trampa está en R-7. |
| 13 | Tests | Cada US añade **tests de integración en `packages/db`** para sus escrituras (limpieza por centinela en `beforeAll`/`afterAll`, precedente `users.integration.test.ts:35-40`) y **specs de jest en la API** mockeando `@safari/db` (precedente `products.service.spec.ts:36-43`). Los asserts por conteo de las suites existentes (`shops` 12, `categories` 198, `manufacturers` 14, `tags` 10) deben seguir verdes: **cada test borra lo que crea**. |
| 14 | Frontend | Ninguna US toca `apps/shop` ni `apps/admin`. Si una verificación exige cambiar un formulario, el contrato se rompió: parar y preguntar. |
| 15 | DTOs | Se corrigen para declarar los campos que el admin envía de verdad (`CreateTypeDto` vacío, `CreateManufacturerDto` sin `name`), porque son la documentación Swagger. Sin activar `whitelist` (decisión 5). |

## Visión técnica compartida

### Decisiones de Diseño (D-N)

- **D-1:** Los servicios de Nest consumen los repositorios de `@safari/db`;
  la API no importa `@prisma/client` directo (hereda la D-1 de los Épicos
  1 y 19).
- **D-2:** Las escrituras viven en el **mismo archivo de repositorio** que
  las lecturas del agregado, como funciones planas `createX`/`updateX`/
  `deleteX` con inputs camelCase tipados (`CreateTypeInput`, …) que
  devuelven el `Record` ya existente. La traducción a snake_case sigue en el
  servicio de Nest (D-3 del Épico 19).
- **D-3:** Un único helper de slug en `packages/db` (introducido por US-27a,
  consumido por las otras cuatro US): misma regla que la función SQL
  `slugify()`, sufijo numérico en colisión. Cinco consumidores justifican la
  abstracción; no se escribe uno por agregado.
- **D-4:** Una única traducción errores de dominio → HTTP en
  `apps/api/rest/src/common/` (introducida por US-27a), que sustituye a los
  `try/catch` duplicados de `isPrismaConnectionError` en cada método. Los
  métodos de lectura existentes **no** se refactorizan en este épico
  (alcance).
- **D-5:** La comprobación de propiedad (decisión 8) es una función del
  servicio que recibe el `CurrentUserPayload` y consulta la tienda; el guard
  no gana consultas a la base.
- **D-6:** Las respuestas de escritura reutilizan los mappers
  `toXDto` ya existentes en cada servicio. Si un mapper necesita un dato que
  el `Record` no trae (p. ej. `type` embebido), se resuelve como ya lo hacen
  las lecturas (`listTypes()` en memoria, `tags.service.ts:88`).

### Riesgos (R-N)

- **R-1 (alto):** los `CASCADE` del DDL. Un `DELETE /types/:id` o
  `DELETE /shops/:id` implementados a ciegas borran productos en cadena.
  Mitigación: decisión 7 (types protegido, shops no implementado) y un test
  de integración que **demuestre** el 409 con una vertical con productos.
- **R-2 (alto):** agujero de autorización al pasar de stub a escritura
  real: hoy `PUT /products/:id` no hace nada, mañana un `store_owner` podría
  editar productos ajenos. Mitigación: decisión 8; la DoD de US-29 y US-30
  exige el `curl` con 403.
- **R-3 (medio):** `slug`. Nombres con tildes, nombres que slugifican a
  vacío, colisión con un slug del seed o del scraper (que también usa
  `slugify()`). Mitigación: decisión 4 y tests del helper con esos tres
  casos.
- **R-4 (medio):** los tests de integración escriben en la **misma base
  sembrada** que los tests de lectura con asserts por conteo. Una corrida
  abortada deja basura y rompe `toBe(12)`. Mitigación: decisión 13
  (centinela + `beforeAll(cleanup)`, como `users.integration.test.ts:38`).
- **R-5 (medio):** los payloads del admin traen campos que ni los DTOs ni
  la base conocen (`variation_options.upsert/delete`, `balance`, …). Si el
  repositorio hace spread del body a Prisma, falla con 500 por campo
  desconocido. Mitigación: los inputs de `@safari/db` son tipados y
  **explícitos** campo a campo (D-2); el servicio proyecta, no reenvía.
- **R-6 (bajo, positivo):** `category_product` está vacía por diseño
  (`db/README.md:37-40`). Los primeros productos creados desde el admin con
  categorías harán que el filtro por categoría de la tienda devuelva
  resultados por primera vez. No es regresión; conviene decirlo en el
  reporte de US-29.
- **R-7 (bajo):** la trampa de paginación. `ValidationPipe` corre sin
  `transform`: `?limit=20` llega como el string `"20"`, `paginate()` de la
  API lo reenvía crudo y así `per_page` es string (contrato de facto).
  `buildPaginator` no coerciona. Solo muerde si una US añade un listado;
  decisión 12.
- **R-8 (medio):** desborde de estimación (US-25: 420 → ~965). **Ya se
  materializó**: la US-27 original se pronosticó en ~1500 frente a ~500
  estimadas y se partió en US-27a/US-27b (ver "Partición de US-27" arriba).
  Cinco US con tests reales suman ~2850 estimadas y pueden pasar de 4000.
  Mitigación: US independientes y releasables; ninguna bloquea a otra salvo
  US-27a. Aplicar el umbral de ~900 al pronóstico de cada `sdd-propose`, no
  solo a las líneas reales al cerrar.
- **R-9 (bajo):** `getCategoryTree` (US-4b) fue verificado con la
  profundidad real del seed (3 niveles). Un admin puede crear un cuarto
  nivel. US-28 debe probarlo o acotar la profundidad con un 400 declarado.

## Notas globales para los agentes

- Arrancar con la base sembrada (`just db-up`) y `packages/db` construido
  (`just db-build` si `dist/` no existe). **No hace falta `just db-reset`
  en ninguna US de este épico**; si una parece necesitarlo, se rompió la
  decisión 1: parar y preguntar.
- Verificación mínima de una escritura: `curl` de `POST` → `GET` por slug
  (misma proyección, mismo número de claves) → **reiniciar la API** → `GET`
  otra vez (la fila sigue) → `PUT` → `GET` → `DELETE` → `GET` **404**. El
  reinicio es lo que distingue una escritura real de la mutación en memoria
  que hoy hacen `manufacturers.update` y `approveShop`.
- Verificación de regresión, siempre: `just db-check` (vitest de
  `packages/db`, 91 tests hoy), `cd apps/api/rest && npx jest` (4 suites,
  mockea `@safari/db`), `just build-api` y `just verify` con los tres
  servicios arriba. No hay runner repo-wide (es US-10).
- El precedente de estilo para repositorio + servicio + proyección está en
  las US-2/3/4a/4b/5 archivadas en `openspec/changes/archive/`; el de
  escritura con validación de CHECK, en `upsertScrapedProduct`.
- Lo que el "NO incluye" de cada US excluye no se implementa aunque quede a
  un import de distancia. Las rutas que quedan stub se **declaran** en el
  reporte con su motivo (DDL pendiente o sin consumidor), no se borran: son
  contrato.
