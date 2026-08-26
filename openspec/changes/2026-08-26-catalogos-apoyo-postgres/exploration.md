# Exploration: Migrar catálogos de apoyo (types, categories, tags, manufacturers, shops) a Postgres

> US-4, Épico 1 (`docs/product/1-catalogo-desde-postgres/4-migrar-catalogos-apoyo.md`).
> Toda cita `path:line` fue verificada abriendo el archivo o corriendo el
> comando citado (Postgres real vía `docker exec safari-postgres psql`, no
> solo lectura de `db/seed.sql`).

## Current State

### 1. Precedente a imitar (2 cambios archivados + `/api/settings`)

- `openspec/changes/archive/2026-08-25-migrar-api-products-postgres/` (US-2) y
  `openspec/changes/archive/2026-08-26-detalle-producto-postgres/` (US-3) son
  el patrón establecido. Puntos que esta US debe copiar:
  - **Traducción camelCase→snake_case vive en el servicio de Nest**, nunca en
    `@safari/db` ni en el repositorio (`settings.service.ts:33-39`,
    `products.service.ts` `toProductDto`). El repositorio devuelve records
    camelCase; el cast final es `as unknown as {Entity}` porque la entidad
    Nest declara más campos de los que el mock emite.
  - **Paginación**: se reutiliza `paginate()` local
    (`apps/api/rest/src/common/pagination/paginate.ts:4-75`), NO
    `buildPaginator()` de `packages/db/src/pagination.ts` — decisión
    ratificada en US-2 (`design.md` Decision A) porque `ValidationPipe` no
    transforma (`main.ts:9`), así que `limit` llega como string y
    `buildPaginator` lo tiparía distinto, rompiendo CA-1 ("mismos tipos").
    Aplica igual a `categories`/`tags`/`manufacturers`/`shops` (los 4
    paginados) en esta US.
  - **Errores**: `try/catch` que envuelve SOLO la llamada de I/O;
    `isPrismaConnectionError` → 503, resto → 500 (`getUserFriendlyMessage`,
    ambos exportados del barrel `packages/db/index.ts`). `NotFoundException`
    (404) se lanza FUERA del `try` cuando el repo devuelve `null` (detalle
    por slug) — patrón de `products.service.ts` `getProductBySlug` (US-3
    design.md Decision B).
  - **Tests de integración** viven en `packages/db/src/repositories/*.integration.test.ts`
    (hoy solo `products.integration.test.ts`, 268 líneas); es el único gate
    automatizado del repo (`just db-check`). Los 5 catálogos de esta US NO
    tienen test de integración propio todavía.
  - **Evidencia de paridad**: `curl` mock ANTES / Postgres DESPUÉS. Como
    ambos no pueden convivir en el mismo puerto, US-3 capturó la línea base
    del mock en un archivo (`mock-apples.json`) ANTES de tocar código, y
    documentó una vía alternativa reproducible sin servidor
    (`node -e` leyendo el JSON directo, `design.md:239-240` de US-3) —
    recomendado para esta US también, x5 catálogos. `jq` NO está instalado en
    Git Bash (confirmado en memoria de usuario): toda comparación usa
    `node -e`, igual que hizo US-3.
  - **Divergencias se declaran, no se "arreglan"**: US-2 documentó 10
    divergencias aceptadas (constantes por columna faltante, orden de claves
    en jsonb, bugs del mock que Postgres no reproduce). Este patrón aplica
    directo a los gaps de `manufacturers`/`shops` descritos abajo (§7).

### 2. Comportamiento actual del mock, por catálogo

Todos los controllers están en `apps/api/rest/src/{catalogo}/{catalogo}.controller.ts`
y sirven desde `apps/api/rest/src/{catalogo}/{catalogo}.service.ts`, que
importan `@db/{catalogo}.json` (alias a `apps/api/rest/src/db/pickbazar/`).

| Catálogo | Filas mock | Envoltorio | Query real de la tienda | Detalle por slug |
|---|---|---|---|---|
| `types` | 10 | **Array plano**, sin paginar (`types.controller.ts:25-28`, `GetTypesDto` NO extiende `PaginationArgs` — `get-types.dto.ts:3-8`) | `client.types.all(params)` sin filtro (`apps/shop/src/framework/rest/client/index.ts:239-240`) | Sí, `/types/:slug` (`groups-menu.tsx` navegación) |
| `categories` | 198 | `{data, ...paginate(...)}` (`categories.service.ts:49-54`) | `search=type.slug:<slug>` cuando hay filtro por vertical (`client/index.ts:222-229`); default `parent='null'` en el DTO (`get-categories.dto.ts:15`) → solo raíces si el caller no manda `parent` | Sí, `/categories/:param` acepta id o slug (`categories.service.ts:57-61`) |
| `tags` | 10 | `{data, ...paginate(...)}` (`tags.service.ts:54-58`) | `search=type.slug:<slug>` (`client/index.ts:230-236`) — **pero el `fuse` de tags solo indexa `['name']`** (`tags.service.ts:13-16`), NO `type.slug`: el filtro por type que la tienda manda hoy no filtra nada en el mock (`fuse.search({$and:[{'type.slug':v}]})` sobre un índice que no tiene esa clave) | Sí, `/tags/:param` (id o slug) |
| `manufacturers` | 14 | `{data, ...paginate(...)}` (`manufacturers.service.ts:53-56`), default `limit=30` si no llega | `useManufacturers({...})` sin filtro por type visto en `manufacturers-grid.tsx`/`manufacturer-filter-view.tsx` | Sí, `/manufacturers/:slug`; además `GET /top-manufacturers` (`manufacturers.controller.ts:58-67`, `getTopManufactures` = `manufacturers.slice(0, limit)`) |
| `shops` | 9 (+3 reconstruidos en el seed) | `{data, ...paginate(...)}` (`shops.service.ts:50-54`); default `search=is_active:1` que manda el cliente (`client/index.ts:244-250`) | `is_active` es el único filtro real (`get-shops.dto.ts:14`) | Sí, `/shops/:slug`. **Fuera de "listado + detalle"**: `POST /shops`, `PUT /shops/:id`, `/staffs`, `/approve-shop`, `/disapprove-shop`, `/near-by-shop/:lat/:lng`, `/new-shops` (`shops.controller.ts` — 5 controllers en el mismo archivo) |

`GET /near-by-shop/:lat/:lng` usa `near-shop.json` (6 filas, no `shops.json`)
y SÍ se consume en la tienda (`apps/shop/src/pages/shops/search.tsx`,
`framework/rest/shop.ts:74-90`) — pero no tiene columnas de geolocalización en
`db/schema.sql` (`shops` no tiene lat/lng) y el "Incluye" de la US es
"listado (y detalle por slug)". **Queda fuera de scope de esta US**, igual
que `authors`, y debe declararse explícitamente (como US-2 hizo con
`popular-products`/`best-selling-products`).

### 3. Capa de datos actual (`packages/db`)

Los 5 repositorios YA EXISTEN y YA ESTÁN exportados en el barrel
(`packages/db/index.ts:29-66`): `listTypes`/`findTypeBySlug`,
`getCategoryTree`/`listCategories`/`findCategoryBySlug`,
`listTags`/`findTagBySlug`, `listManufacturers`/`findManufacturerBySlug`/
`findOrCreateManufacturerBySlug`, `listShops`/`findShopBySlug`/
`findOrCreateShopBySlug`. **No falta ninguna función de listado/detalle** —
el contexto de la US ("consultas faltantes" en la tabla de archivos) es
optimista: el trabajo real no es escribir repositorios nuevos sino (a)
mapear camelCase→snake_case en 5 servicios de Nest, (b) **reconstruir los
objetos anidados que el mock embebe y que las tablas no tienen como columna**
(ver §7), y (c) escribir los tests de integración que hoy no existen.

Ningún repositorio tiene test de integración propio (`packages/db/src/repositories/`
solo tiene `products.integration.test.ts`, 268 líneas — el patrón a copiar
para los 5 nuevos `describe()`, ya sea en archivos separados o añadidos al
mismo, decisión de diseño pendiente).

### 4. El árbol de categorías — riesgo confirmado, MÁS SERIO de lo documentado

`packages/db/src/repositories/categories.repository.ts:1-7` documenta
"jerarquía de 2 niveles por adyacencia: 83 raíces, 115 hijas" y
`db/schema.sql:133-135` dice lo mismo ("2 niveles reales"). **Ambos
comentarios son incorrectos**: verificado contra Postgres real
(`docker exec safari-postgres psql`, 26-ago-2026):

```
types                 |    10
categories            |   198
categories_root       |    83
categories_child      |   115
categories_grandchild |     6      ← existe un 3er nivel
tags                  |    10
manufacturers         |    14
shops                 |    12
shops_reconstructed   |     3
```

Los 6 nietos son ids `165,166,167,168` (hijas de `164`) y `169,170` (hijas de
`163`), y `163`/`164` son a su vez hijas de la raíz `124` (`db/seed.sql:359-390`,
bloque `UPDATE categories AS c SET parent_id = v.parent_id`). El mock
**sí** los nidifica a 3 niveles — verificado leyendo `categories.json`
directo: `byId.get(124).children` = `[163,164]`, y `163.children` (el objeto
embebido dentro de `124.children`) = `[169,170]` con sus propios `image`,
`products_count`, etc.

**Consecuencia concreta**: `CATEGORY_INCLUDE` en
`categories.repository.ts:35-38` (`{ type: true, children: { orderBy } }`)
solo trae UN nivel de hijas vía Prisma `include`. Con los datos reales, la
raíz 124 se serializaría con `children: [163, 164]` pero SIN los nietos
165-170 embebidos dentro de esos hijos — el mock sí los trae. Esto rompe
CA-2 ("misma estructura padre-hijos que el mock") para esa rama concreta (6
de 198 categorías, ~3% de las filas, pero el criterio de aceptación no
admite excepciones parciales sin declararlas).

**Opciones para el design (no se resuelven aquí)**:
1. **Nested include de 2 niveles fijo** (`children: { include: { children: true } }`)
   — dado que el depth máximo verificado es 2 saltos (root→child→grandchild,
   nunca más), esto es suficiente y barato; NO requiere CTE recursiva. Riesgo:
   frágil si el seed algún día crece a 4 niveles (no lo hace hoy — verificado
   con cálculo de profundidad sobre las 115 relaciones del seed: max = 2).
2. **CTE recursiva** (`WITH RECURSIVE`) fuera de Prisma, vía `$queryRaw` —
   generaliza a N niveles pero es más código y se aparta del patrón "cero
   `@prisma/client` directo en la API" (D-1 del épico se refiere a la API, no
   al repositorio, así que un raw query en `packages/db` no lo viola, pero sí
   añade una segunda estrategia de consulta al repo, más difícil de
   testear/mantener que un include tipado).
3. **Un query + ensamblaje en memoria**: traer las 198 filas con `findMany()`
   sin `include`, y construir el árbol completo en JS agrupando por
   `parentId`. Generaliza a N niveles, una sola query, sin CTE — probablemente
   la opción con mejor relación esfuerzo/generalidad dado que 198 filas caben
   enteras en memoria sin problema y ya es lo que hace `getCategoryTree`
   conceptualmente (trae todo, no pagina el árbol — comentario línea 57-59).

Además, el mock devuelve el back-reference `parent` en cada hijo (no solo
`children` en el padre) — hoy `CategoryRecord`/`_toCategoryRecord` no lo
incluye; el shape final debe decidir si lo reproduce (el `Category` entity
del REST sí lo declara: `apps/api/rest/src/categories/entities/category.entity.ts:9`,
`parent?: Category`).

### 5. Delta de shops — confirmado

`db/README.md` no tiene una sección con encabezado "shops" grande, pero
`db/seed.sql:45-63` lo documenta inline: 9 shops de `shops.json` + 3
reconstruidos desde el objeto `shop` embebido en productos que referencian
`shop_id` 12, 14, 15 (`noaw`, `tetetetet`, `launchidea` — nombres reales del
mock, no inventados). Confirmado en Postgres real: `shops = 12`,
`shops_reconstructed = 3` (columna `description LIKE 'Reconstruido%'`, que es
como el script los marca: `db/generate-seed.mjs:46-61`).

### 6. Superficie de consumo frontend

- **Tienda** (`apps/shop`, REST — confirmado el REST es el que se usa, no
  GraphQL, por `CLAUDE.md`): `framework/rest/category.ts`, `type.ts` (vía
  `groups-menu.tsx` — menú de navegación), `manufacturer.ts` (grid +
  filtro de búsqueda), `tag.ts` (filtro de búsqueda), `shop.ts` (páginas de
  tienda + near-shop). Todos usan los hooks REST, no los GraphQL
  (`framework/graphql/*` existe pero no es el árbol activo).
- **Admin** (`apps/admin/rest`): también consume los 5 endpoints de listado
  (`data/client/{category,type,tag,manufacturer,shop}.ts`) para las
  pantallas de gestión — mismo contrato GET, ningún shape adicional. Los
  endpoints de escritura (create/update/delete) que también viven ahí
  **siguen en mock**, confirmando el "NO incluye" de la US.
- Campos "load-bearing" concretos: `groups-menu.tsx` lee `type.settings`
  (layout del menú); `manufacturers-grid.tsx`/`manufacturer-filter-view.tsx`
  leen `name`/`slug`/`image`; `tag-filter-view.tsx` lee `name`/`slug`.
  Ninguno de los componentes de la tienda revisados lee `products_count`,
  `socials`, `owner`, `orders_count` de manufacturers/shops — son campos que
  el mock emite pero que la UI activa no consume (reduce el riesgo de
  omitirlos, no lo elimina: el admin puede leerlos en otras vistas no
  revisadas aquí).

### 7. Campos del mock sin columna en el esquema — gap nuevo, no mencionado en la US

Comparando `manufacturers.json[0]`/`shops.json[0]` reales contra
`ManufacturerRecord`/`ShopRecord` (`packages/db/src/records.ts:72-125`):

| Catálogo | Campos que el mock emite y el record NO tiene | Nota |
|---|---|---|
| `manufacturers` | `products_count`, `socials[]`, `cover_image` (columna no existe; solo `image`) | Precedente: US-2 aceptó constantes (`in_flash_sale: 0`) o `null` para columnas ausentes — aplica igual aquí, a decidir en design |
| `shops` | `owner` (objeto `User` completo anidado), `orders_count`, `notifications` | `owner_id` SÍ existe como escalar (`ShopRecord.ownerId`) pero NO hay tabla `users` en scope (`db/schema.sql:111-112`: "la tabla `users` está fuera de alcance") — `owner` como objeto no es reconstruible sin inventar datos |
| `tags` | `type` (objeto anidado `{id,name,slug,logo}`) — el record solo tiene `typeId` escalar | Reconstruible: `findTypeBySlug`/lookup por id ya existe en `types.repository.ts` |
| `categories` | `type` (igual que tags, pero el repositorio YA lo resuelve vía `include: { type: true }`) | Ya cubierto |

Esto no bloquea la US pero es trabajo real no contado en el "Archivos a
crear/modificar" de la US (que solo lista servicios + repositorios "faltantes").
Cada gap necesita una decisión declarada (constante/`null`/omitir la clave),
igual que las 10 divergencias que US-2 documentó — no "arreglarse"
inventando columnas nuevas (fuera de `db/schema.sql` como fuente de verdad).

## Affected Areas

- `apps/api/rest/src/types/types.service.ts` (75 líneas) — reescribir sobre
  `listTypes`/`findTypeBySlug`; sin paginación (contrato ya es array plano).
- `apps/api/rest/src/categories/categories.service.ts` (71 líneas) —
  reescribir sobre `listCategories`/`getCategoryTree`/`findCategoryBySlug`;
  requiere la decisión de árbol de §4 antes de escribir código.
- `apps/api/rest/src/tags/tags.service.ts` (73 líneas) — reescribir sobre
  `listTags`/`findTagBySlug`; requiere embeber `type` (lookup extra).
- `apps/api/rest/src/manufacturers/manufacturers.service.ts` (84 líneas) —
  reescribir sobre `listManufacturers`/`findManufacturerBySlug`; requiere
  decisión sobre `products_count`/`socials`/`cover_image` (§7); `top-manufacturers`
  puede reusar `listManufacturers` con `limit`.
- `apps/api/rest/src/shops/shops.service.ts` (131 líneas, 5 `@Controller()`
  en el mismo archivo) — solo `getShops`/`getShop` migran (listado +
  detalle); `staffs`/`approve`/`disapprove`/`near-by-shop`/`new-shops` quedan
  en mock, declarado explícitamente.
- `packages/db/src/repositories/categories.repository.ts` — cambio de
  `CATEGORY_INCLUDE` (opción 1, 2 o 3 de §4) + corrección del comentario de
  cabecera ("2 niveles" → 3) + corrección del comentario homólogo en
  `db/schema.sql:133-135`.
- `packages/db/src/repositories/*.integration.test.ts` — 5 suites nuevas
  (una por catálogo), patrón `products.integration.test.ts`.
- `docs/product/1-catalogo-desde-postgres/4-migrar-catalogos-apoyo.md` +
  `README.md` del épico — cierre documental (Status + fila de la tabla).

## Approaches

1. **Una sola US/change, las 5 catálogos juntos** (lo que pide el documento
   original de la US).
   - Pros: un solo ciclo de propose/design/tasks/apply/verify; refleja la
     historia tal como está escrita.
   - Cons: LOC real estimado (ver §"Size reality check" abajo) supera
     claramente los ~350 estimados y el guard de 400 líneas de revisión
     (`sdd-phase-common.md` §E) casi con certeza se dispara; mezcla un riesgo
     de diseño real y nuevo (árbol de 3 niveles, no documentado hasta esta
     exploración) con 4 catálogos de wiring relativamente mecánico, lo que
     complica tanto la revisión como el rollback parcial.
   - Effort: High (una sola sesión, con riesgo de no cerrarla).

2. **Split en 2: catálogos planos (types+tags+manufacturers+shops) y
   categories aparte** — la costura que la propia US sugiere ("si en el
   design supera con claridad una sesión, PARAR y proponer partirla, p. ej.
   categories aparte").
   - Pros: los 4 catálogos planos comparten un patrón idéntico (paginar +
     mapear + lookup opcional de `type`) y no tocan `packages/db` más que
     para agregar tests — se pueden verificar y mergear rápido, con su propio
     `curl` mock-vs-Postgres. `categories` queda sola con el único cambio de
     repositorio real (la corrección del árbol) y su propio test de
     integración enfocado en profundidad 3, sin competir por atención con 4
     catálogos triviales. Cada slice es releasable por separado (la tienda
     puede navegar por `type`/`tag`/`manufacturer`/`shop` desde Postgres
     aunque `categories` siga en mock, y viceversa).
   - Cons: dos ciclos SDD completos en vez de uno; hay que decidir el nombre/
     numeración de la segunda US-standalone o sub-US del épico (afecta
     `docs/product/README.md` numeración global).
   - Effort: Medium por slice.

3. **Split en 3**: categories aparte (igual que 2), shops aparte (por los
   gaps de §7 y los 5 controllers en el mismo archivo), y
   types+tags+manufacturers juntos (los 3 catálogos genuinamente triviales:
   sin controllers extra, sin campos huérfanos salvo el lookup de `type` en
   tags).
   - Pros: cada slice es aún más angosto y fácil de revisar; aísla el
     "trabajo de decisión" (qué hacer con `owner`/`socials`/`products_count`)
     en su propio slice en vez de mezclarlo con el trabajo mecánico de
     `types`.
   - Cons: 3 ciclos SDD completos es más overhead de proceso que valor
     entregado — `shops` no es tan grande por sí sola como para justificar un
     tercer ciclo completo; el split 2 ya aísla el riesgo real (`categories`).
   - Effort: Medium-Low por slice, pero Alto en overhead de coordinación.

## Size reality check (obligatorio por la nota de la US)

Estimado por catálogo, basado en los tamaños de archivo actuales y el patrón
de US-2/US-3 (que promediaron ~15-20 líneas de servicio por cada función
migrada, más ~10-15 líneas de test de integración por caso):

| Catálogo | Servicio Nest | Repo (`packages/db`) | Test integración | Total est. |
|---|---|---|---|---|
| `types` | ~30 (sin pag., trivial) | 0 (ya cubierto) | ~20 | ~50 |
| `tags` | ~45 (+ lookup de `type`) | 0 | ~25 | ~70 |
| `manufacturers` | ~55 (+ decisión §7 + `top-manufacturers`) | 0 | ~25 | ~80 |
| `shops` | ~60 (+ decisión §7, solo 2 de 5 controllers) | 0 | ~25 | ~85 |
| `categories` | ~50 | **~40-60** (cambio de `CATEGORY_INCLUDE` + comentarios en 2 archivos) | ~35 (caso de profundidad 3 explícito) | ~140 |
| **Total** | | | | **~425** |

Más el cierre documental (2 archivos) y el diff no-código (comentarios de
`db/schema.sql`, `docs/product/`). **~425 LOC estimadas, ya por encima de las
~350 de la US y del guard de 400 líneas de revisión del pipeline SDD.**

**Recomendación**: PARAR y proponer partir, tal como la propia nota de la US
anticipa. La costura recomendada es la **Approach 2** (categories aparte de
los 4 catálogos planos): no comparten archivos de servicio (D-1 del épico ya
lo señala: "US-3 y US-4 no comparten archivos... verificar antes de
paralelizar" — aquí aplica el mismo razonamiento *dentro* de US-4), y
`categories` es el único slice que toca `packages/db` con un cambio de
comportamiento real (no solo wiring), lo cual justifica que tenga su propio
ciclo de verify/evidencia sin competir por presupuesto de revisión con los
otros 4.

## Recommendation

Partir US-4 en dos changes/sub-historias antes de `sdd-propose`:

- **A — catálogos planos**: `types`, `tags`, `manufacturers`, `shops`
  (listado + detalle por slug únicamente; `staffs`/`near-by-shop`/
  `new-shops`/`approve`/`disapprove` de shops quedan en mock, declarado).
  ~285 LOC estimadas.
- **B — categories**: árbol completo (3 niveles reales, no 2), filtro por
  `type.slug`, back-reference `parent`, corrección de los dos comentarios de
  documentación que hoy dicen "2 niveles". Depende conceptualmente de A solo
  como precedente de patrón, no de archivos compartidos — puede ir en
  paralelo o después, a discreción del usuario. ~140 LOC estimadas.

Ambas heredan el `change_name` base; se necesita que el usuario confirme el
split (y los nombres/slugs) antes de `sdd-propose`, porque cambia la
numeración de `docs/product/` (¿siguen siendo "US-4" con una nota de split, o
se abre una US-4b/US-19 nueva? — decisión de producto, no técnica, fuera de
lo que este agente puede resolver solo).

## Verification Path (para la(s) US resultante(s))

Precondiciones confirmadas en esta máquina:
- `safari-postgres` container: **up y healthy** (`docker ps`, puerto 5433).
- Conteos verificados en vivo (no solo `db/seed.sql`): ver tabla de §4.
- `psql` NO está instalado en el PATH de Git Bash; usar
  `docker exec -e PGPASSWORD=safari safari-postgres psql -h localhost -U safari -d safari_scraper -c "..."`
  para cualquier verificación SQL futura.
- `jq` NO está instalado (memoria de usuario) — usar `node -e` para todo diff
  de JSON, como hizo US-3 (`design.md:248-259` de esa US es una plantilla
  reusable).
- Puerto 9000 ocupado por Zscaler; la API real está en 9001 (`just api-dev`).
- Comandos reales: `just db-up` (ya aplicado), `just db-build` (obligatorio
  tras tocar `packages/db` — `dist/` está gitignored y Nest lo consume vía
  `link:`, lección explícita de US-3 paso 5), `just db-check` (gate de
  `packages/db`), `just verify` (3 servicios + conteo de `product-card`, no
  cubre estos 5 endpoints directamente), `just build-api`.
- Captura de línea base del mock: como en US-3, ambas vías — `curl` contra la
  API en modo mock ANTES de tocar código, y alternativa sin servidor
  (`node -e` leyendo `apps/api/rest/src/db/pickbazar/{catalogo}.json`
  directo) para reproducibilidad si se perdió el paso 0.

## Risks

- **R-A (alto, nuevo — no estaba en el épico ni en la US)**: el árbol de
  categorías tiene 3 niveles reales, no 2 como documentan
  `categories.repository.ts:1-7` y `db/schema.sql:133-135`. Un `include` de
  un solo nivel (lo que el repositorio hace hoy) sub-representa 6 categorías.
  Debe resolverse en el design de la sub-historia de `categories` antes de
  escribir el servicio de Nest.
- **R-B (medio)**: `manufacturers`/`shops` emiten en el mock campos sin
  columna equivalente (`products_count`, `socials`, `cover_image` en
  manufacturers; `owner`, `orders_count`, `notifications` en shops). CA-1
  exige "mismas claves" — cada campo huérfano necesita una decisión explícita
  (constante/`null`/omitir), documentada como divergencia aceptada, siguiendo
  el precedente de la tabla de 10 divergencias de US-2.
- **R-C (medio)**: el mock de `tags` hoy no filtra por `type.slug` (el `fuse`
  de `tags.service.ts` solo indexa `name`). Si Postgres SÍ implementa el
  filtro (porque `ListTagsInput` ya
  soporta `typeSlug`), el comportamiento cambiará de "el filtro no hace nada"
  a "el filtro sí filtra" — es una divergencia visible para el usuario, igual
  que las divergencias 9/10 de US-2 (mock pierde filtros que Postgres sí
  aplica). Debe declararse, no "corregirse en el mock" (fuera de scope).
- **R-D (bajo)**: tamaño combinado (~425 LOC estimadas) supera el guard de
  400 líneas de revisión del pipeline SDD si se ejecuta como una sola US —
  ver recomendación de split arriba.
- **R-E (heredado, ya aceptado por el épico)**: R-1/R-2 del épico
  (`docs/product/1-catalogo-desde-postgres/README.md:56-62`) aplican igual
  a la paginación y a la búsqueda de estos 5 catálogos.

## Ready for Proposal

**No, condicionalmente.** El contenido técnico está completamente explorado
y verificado (contratos, conteos reales, patrón a imitar, gap del árbol de
categorías). Lo que falta antes de `sdd-propose` es una decisión de alcance
que **no es técnica**: confirmar con el usuario si se parte US-4 en 2 (A:
catálogos planos, B: categories) como recomienda este documento, y si el
split se refleja en `docs/product/` como dos sub-US nuevas o como una nota
de split dentro de la US-4 existente. El orquestador debe preguntar esto
antes de continuar a `sdd-propose` (política `ask-on-risk` — este es
exactamente el tipo de riesgo que la califica: el propio texto de la US pide
parar si el tamaño supera una sesión, y la evidencia de esta exploración
confirma que sí la supera, con un motivo nuevo — el árbol de 3 niveles — que
ni la US ni el repositorio documentaban correctamente).
