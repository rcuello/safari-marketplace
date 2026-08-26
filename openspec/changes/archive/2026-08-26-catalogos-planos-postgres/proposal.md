# Proposal: Catálogos planos (`types`, `tags`, `manufacturers`, `shops`) desde Postgres

> **US-4a**, Épico 1. Insumo: `openspec/changes/2026-08-26-catalogos-apoyo-postgres/exploration.md`
> (auditada por el orquestador — no se copia aquí).
> Precedentes estructurales: `openspec/changes/archive/2026-08-25-migrar-api-products-postgres/`
> (US-2, tabla de 10 divergencias aceptadas) y
> `openspec/changes/archive/2026-08-26-detalle-producto-postgres/` (US-3, 404 de dominio).
> `categories` **NO está en este change**: se separó en **US-4b**
> (`openspec/changes/2026-08-26-categorias-arbol-postgres/`, en paralelo) porque
> el árbol tiene 3 niveles reales y era el único riesgo de diseño de la US-4.

## Intent

Los 4 catálogos planos de navegación siguen sirviendo JSON estático
(`types.service.ts:11`, `tags.service.ts:11`, `manufacturers.service.ts:15`,
`shops.service.ts:13`, todos vía `plainToClass` + `fuse.js`). Consecuencia
concreta: los 6 retailers y las marcas que el scraper crea en runtime
(`findOrCreateShopBySlug`, `findOrCreateManufacturerBySlug`) **existen en la
tabla `shops`/`manufacturers` pero son invisibles** en el menú de la tienda, en
el grid de marcas y en los filtros de búsqueda. Migrar estos 4 endpoints cierra
el flujo scraper → base → tienda para la navegación.

## Scope

### In Scope

| Endpoint | Envoltorio | Repositorio |
|---|---|---|
| `GET /api/types` | **array plano** (`GetTypesDto` NO extiende `PaginationArgs`) | `listTypes` |
| `GET /api/types/:slug` | objeto | `findTypeBySlug` |
| `GET /api/tags` | `{data, ...paginate(...)}` | `listTags` |
| `GET /api/tags/:param` | objeto (solo slug — ver D-8) | `findTagBySlug` |
| `GET /api/manufacturers` | `{data, ...paginate(...)}` | `listManufacturers` |
| `GET /api/manufacturers/:slug` | objeto | `findManufacturerBySlug` |
| `GET /api/top-manufacturers` | array plano | `listManufacturers` + `limit` (D-9) |
| `GET /api/shops` | `{data, ...paginate(...)}` | `listShops` |
| `GET /api/shops/:slug` | objeto | `findShopBySlug` |

Más: filtro `name` en los 4 repositorios (D-5), `products_count` calculado en
shops (D-4), 4 suites de integración nuevas, y el cierre documental de US-4a.

### Out of Scope (vinculante — "NO incluye" de la US)

`categories` (**US-4b**) · `authors`/`top-authors` · **todos** los endpoints de
escritura del admin (`POST`/`PUT`/`DELETE` de los 4 catálogos siguen en mock,
con sus stubs intactos) · `category_product` · cambios de frontend
(`apps/shop/**`, `apps/admin/**`) · `db/schema.sql` y `schema.prisma` ·
`GET /staffs`, `POST /approve-shop`, `POST /disapprove-shop`, `GET /new-shops` ·
`GET /near-by-shop/:lat/:lng` (lee `near-shop.json`, **sí** lo consume
`apps/shop/src/pages/shops/search.tsx` vía `framework/rest/shop.ts`, y `shops`
no tiene columnas lat/lng en `db/schema.sql` → queda en mock, mismo criterio que
`popular-products` en US-2) · retrofit de `products.service.ts` al helper de
búsqueda compartido (D-7) · specs de jest para los 4 servicios (D-10).
Nada de esto se toca aunque sea adyacente y barato.

## Capabilities

### New Capabilities

- `flat-catalogs-api`: listado y detalle por slug de `types`, `tags`,
  `manufacturers` y `shops` servidos desde Postgres, con las divergencias
  declaradas de campos huérfanos.

### Modified Capabilities

- None. `product-listing-api` y `product-detail-api` no cambian de requisito;
  `products.service.ts` no se toca (D-7).

## Approach — decisiones

| # | Tema | Decisión |
|---|------|----------|
| **D-1** | **Traducción y proyección** | Mapper privado por servicio (`toTypeDto`, `toTagDto`, …), literal explícito con el key-set del mock, `as unknown as {Entity}`. Patrón literal de `toProductDto` (`products.service.ts:133-167`). El key-set del mock está verificado y es único en las 4 colecciones: **types 9 claves, tags 9, manufacturers 13, shops 16**. |
| **D-2** | **Paginación** | `paginate()` local (`apps/api/rest/src/common/pagination/paginate.ts`), NO `buildPaginator()` — ratificado en US-2 Decision A (`ValidationPipe` no transforma, `limit` llega string). `url` se reproduce literal por catálogo: `/tags?limit=${limit}` (**sin** `search`), `/manufacturers?search=${search}&limit=${limit}`, `/shops?search=${search}&limit=${limit}` (con el artefacto `search=undefined`). |
| **D-3** | **Errores** | `try/catch` alrededor de SOLO la llamada de I/O; `isPrismaConnectionError` → 503, resto → 500. `NotFoundException` FUERA del `try` cuando el repo devuelve `null` (US-3 D-4/D-5). |
| **D-4** | **`shops.products_count`: calculado, no constante** | Único campo huérfano **derivable**: `COUNT(products WHERE shop_id = X AND status='publish' AND visibility='visibility_public')` reproduce el valor del mock en **8 de 9 shops** (verificado sobre `products.json`; `makeup-shop` declara 81 y tiene 82 — inconsistencia del propio mock). Se implementa con `_count` filtrado en `shops.repository.ts` + `productsCount?: number` en `ShopRecord`. Motivo para no usar la constante `0`: `apps/shop/src/components/shops/sidebar.tsx:105` lo **renderiza**, y los 3 shops reconstruidos + los retailers scrapeados obtienen así un conteo real (es el objetivo de la US). |
| **D-5** | **Filtro `name` en los 4 repositorios** | `ListTypesInput` (nuevo), `ListTagsInput`, `ListManufacturersInput`, `ListShopsInput` reciben `name?: string` → `{ contains, mode: 'insensitive' }`, copia literal de `ListProductsInput.name` (`products.repository.ts:117,179-181`). **No es una mejora oportunista**: los 4 buscadores del admin mandan hoy `search=name:<término>` (`pages/groups/index.tsx:26`, `pages/tags/index.tsx:37`, `pages/manufacturers/index.tsx:32`, `pages/shops/index.tsx:25`) y el mock lo implementa con `fuse`. Sin este filtro, migrar **rompe** 4 cajas de búsqueda. Corrige la afirmación del contexto de la US ("consultas faltantes"): no falta ninguna **función**, falta un **campo de input** en 4 inputs. |
| **D-6** | **`type` anidado de tags/manufacturers: se arma en el servicio** | El mock embebe `type: {id,name,slug,logo}` (4 claves, sin `settings`). Se resuelve con **un `listTypes()` extra por request** indexado por id en memoria (10 filas), NO con `include: { type: true }`. Motivo: `include` obligaría a introducir `TagWithType`/`ManufacturerWithType` y cambiar el tipo de retorno de 4 funciones del barrel, cuando la traducción de shape es responsabilidad declarada del servicio de Nest (`openspec/config.yaml` rules.design). `logo: null` constante, igual que `toProductDto`. |
| **D-7** | **Parser de `search` compartido** | `search=key:value;…` se parsea en un helper nuevo `apps/api/rest/src/common/search/parse-search.ts` (~14 líneas) usado por los 4 servicios (5.ª ocurrencia del patrón: ya existe `parseProductSearch` privado en `products.service.ts`). **No se retrofitea `products.service.ts`** — sería refactor fuera de alcance. Se reconoce la duplicación temporal en el spec. |
| **D-8** | **`/tags/:param` resuelve solo por slug** | El mock acepta id o slug (`tags.service.ts:62`). Verificado: **ningún frontend usa la rama de id** — el shop no expone `tags.get` (`framework/rest/client/index.ts:230-237`) y el admin usa `crudFactory.get({slug})` (`data/client/curd-factory.ts:20`). Se usa `findTagBySlug`; la rama numérica pasa a devolver 404. Evita añadir `findTagById` sin llamador. |
| **D-9** | **`GET /top-manufacturers` SÍ entra** | `listManufacturers({ limit })` reproduce `manufacturers.slice(0, limit)` (mismo `ORDER BY id ASC`, mismo default `limit=10`): ~6 líneas y reutiliza el mismo mapper que `/manufacturers`. Dejarlo en mock obligaría a mantener `manufacturersJson` + `fuse` cargados solo para él y dejaría el grid de marcas del home mezclando mock y Postgres. |
| **D-10** | **Sin specs de jest para los 4 servicios** | US-3 añadió `products.service.spec.ts` porque el detalle tenía lógica real (regla de relacionados, 404, mapper de 21 claves). Aquí los 4 servicios son mappers finos; el gate real son los tests de integración de `packages/db` (`just db-check`, el único gate que existe) más la evidencia `curl`. 4 specs ≈ 200 líneas que empujarían el change muy por encima del presupuesto sin cubrir riesgo nuevo. La DoD de la US no los pide. |

## Divergencias aceptadas y declaradas (R-B, R-C)

Precedente: tabla de 10 divergencias de US-2. Cada campo huérfano lleva UNA
decisión; ninguna se "arregla" inventando columnas (`db/schema.sql` es la fuente
de verdad).

| # | Catálogo.campo | Decisión | Justificación / observabilidad |
|---|---|---|---|
| V-1 | `manufacturers.products_count` | **Constante `0`** | **No derivable**: `products.json` no emite la clave `manufacturer` en ninguno de sus 1200 productos (key-set de 20 claves verificado) y el seed no puebla `products.manufacturer_id` → contar da 0 para las 14 marcas. Visible en la columna del admin (`components/manufacturer/manufacturer-list.tsx:118`), no en la tienda. |
| V-2 | `manufacturers.socials` | **Constante `[]`** | Sin columna. Mock: 13 de 14 traen datos reales (Facebook/Instagram/YouTube). Ningún componente activo del shop lo lee. `[]` (no `null`) preserva el tipo array del mock. |
| V-3 | `manufacturers.cover_image` | **Constante `null`** | Sin columna (`manufacturers` solo tiene `image`). Mock: **14 de 14** traen objeto real → es la divergencia más visible de este change. Añadir la columna sería tocar `db/schema.sql` (fuera de alcance). |
| V-4 | `shops.owner` | **Constante `null`** | `owner_id` existe como escalar, pero **no hay tabla `users`** (`db/schema.sql:111-112` lo declara fuera de alcance) y el objeto del mock tiene 10 claves + `profile` anidado. **No es reconstruible sin inventar datos** → `null`, nunca un objeto falso. `owner_id` sí se emite (real). |
| V-5 | `shops.orders_count` | **Constante `0`** | No hay tabla `orders` en el esquema. Mock: valores 0-6. Visible en el admin (`components/shop/shop-list.tsx:145`). |
| V-6 | `shops.notifications` | **Constante `null`** | Sin columna, y el mock trae `null` en **9 de 9** → divergencia **cero**. |
| V-7 | `shops.created_at` / `updated_at` | **Valor real de la fila** | El seed no preserva los timestamps del mock (`generate-seed.mjs:144` omite las columnas → `DEFAULT now()`), así que serán la hora del `db-up`, y el formato ISO de JS (`…Z`) difiere del de Laravel (`…000000Z`). Divergencia de dato, no de shape. Solo `shops` emite estas claves. |
| V-8 | `types.promotional_sliders` | **Constante `null`** | Sin columna. Mock: 7 de 10 types traen 4-5 sliders. **Ningún componente del shop lo lee** (grep: solo `admin/components/group/group-form.tsx`, formulario de escritura, fuera de alcance). |
| V-9 | `translated_languages` (types, tags, manufacturers) | **Constante `["en"]`** | Sin columna en las 3 tablas. Mock: `["en"]` en 10/10 tags y 14/14 manufacturers; **1 de 10** types (`books`) trae `["en","de"]`. Divergencia real: 1 fila. |
| V-10 | `manufacturers.language` | **Constante `'en'`** | `manufacturers` no tiene columna `language` (a diferencia de `types`/`tags`, que sí). Mock: `'en'` en 14/14 → divergencia cero. |
| V-11 | `is_approved` / `is_active` | **`Number(bool)` → `1`/`0`** | El mock emite números; Postgres da `boolean`. CA-1 exige "mismos tipos" → se castea a número. |
| V-12 | **`tags`: el filtro por `type.slug` empieza a funcionar** (R-C) | **Aceptada, no se "arregla el mock"** | El `fuse` de tags indexa solo `['name']` (`tags.service.ts:13-16`), así que `search=type.slug:gadget` que manda el shop (`client/index.ts:230-236` + `formatSearchParams`, que reescribe `type` → `type.slug:`) **hoy no filtra nada**. Con `listTags({ typeSlug })` sí filtra. Cambio de comportamiento visible al usuario en `tag-filter-view.tsx`, de la misma clase que las divergencias 9/10 de US-2. Idéntico en `manufacturers` (el mock hace `fuse.search(value)` con el *valor* del filtro contra los nombres — `manufacturers.service.ts:47`). |
| V-13 | **`tags`: `total`/`count` y paginación del mock son incorrectos** | **No se reproducen** | `tags.service.ts:57` pasa `this.tags.length` como total **y** como count, y nunca hace `slice` por página: con `limit<10` el mock devuelve 10 filas diciendo `per_page: 5`. Postgres devolverá el total filtrado y la página real. Latente hoy (los llamadores usan `limit` 10 o 100 sobre 10 filas). |
| V-14 | **`shops`: `limit` ausente ya no devuelve `[]`** | **No se reproduce** | El mock hace `slice((page-1)*limit)` con `limit` undefined → `slice(NaN, NaN)` → `data: []` con `per_page: 10`. Con Postgres, `Number(limit) \|\| 30` devuelve 12 filas. Bug del mock. |
| V-15 | **`shops`: `is_active` deja de ser un match difuso** | **Aceptada, latente** | El shop manda `search=is_active:1` y el mock lo pasa por `fuse` (keys `['name','type.slug','is_active']`, threshold 0.3). `listShops` filtra `isActive: true` por defecto; el admin **no** manda `is_active` y el mock no filtra → divergencia latente de 0 filas hoy (las 12 del seed están activas; verificado `is_active` = 1 en 9/9 del mock y `DEFAULT true` para los 3 reconstruidos). |
| V-16 | **404 donde el mock devolvía 200 vacío** | **Aceptada e intencional** | Los 4 detalles del mock hacen `.find()` → `undefined` → 200 con cuerpo vacío. Se adopta `NotFoundException` (patrón establecido por US-3 D-4, que declara explícitamente que "US-4 y siguientes" lo copian). |

## Delta de shape de `shops` (CA-3)

El endpoint devolverá **12 filas donde el mock devolvía 9**. Justificación en la
evidencia, con dos comprobaciones obligatorias:

1. `db/seed.sql:45-63` + `generate-seed.mjs:46-61`: 9 de `shops.json` + 3
   reconstruidos desde el objeto `shop` embebido en productos que referencian
   `shop_id` 12/14/15 (`noaw`, `tetetetet`, `launchidea` — nombres reales del
   mock, no inventados), marcados con `description LIKE 'Reconstruido%'`.
2. `docker exec -e PGPASSWORD=safari safari-postgres psql -h localhost -U safari
   -d safari_scraper -c "SELECT id, slug, description LIKE 'Reconstruido%' AS
   recon FROM shops ORDER BY id"` pegado en el verify.

El diff mock-vs-Postgres se declara **aprobado por fila**: 9 slugs idénticos + 3
extra enumerados. `total` pasa de 9 a 12 y `last_page` puede cambiar con
`limit<12`.

## Estrategia de paridad de contrato

Doble vía, en este orden (misma que US-3):

1. **Antes de tocar código**, con la API en mock:
   `curl -s "http://localhost:9001/api/{types,tags,manufacturers,shops}?limit=100"`
   → 4 archivos `mock-*.json` en esta carpeta del change.
2. **Sin servidor** (reproducible si se perdió el paso 1): `node -e` sobre
   `apps/api/rest/src/db/pickbazar/{types,tags,manufacturers,shops}.json`.

**`jq` NO está instalado** en este Git Bash: todo diff con `node -e` (comparar
`Object.keys(...).join()` fila a fila y recorrer campo a campo).
**`psql` no está en el PATH**: SQL vía `docker exec`. Puerto **9001** (el 9000 es
Zscaler).

## Affected Areas

| Área | Impacto | Descripción |
|------|---------|-------------|
| `apps/api/rest/src/types/types.service.ts` | Modified | `getTypes`/`getTypeBySlug` → async sobre `@safari/db` + mapper; sin paginación |
| `apps/api/rest/src/tags/tags.service.ts` | Modified | `findAll`/`findOne` + `type` anidado (D-6) |
| `apps/api/rest/src/manufacturers/manufacturers.service.ts` | Modified | `getManufactures`/`getManufacturesBySlug`/`getTopManufactures` (D-9) |
| `apps/api/rest/src/shops/shops.service.ts` | Modified | **solo** `getShops`/`getShop`; `getNewShops`/`getStaffs`/`getNearByShop`/`approve*` intactos → `shopsJson`/`nearShopJson`/`fuse` **no se borran** |
| `apps/api/rest/src/common/search/parse-search.ts` | **New** | helper de `search=key:value;…` (D-7) |
| `apps/api/rest/src/{types,tags,manufacturers,shops}/*.controller.ts` | Sin cambios | Nest resuelve promesas; los 4 detalles no tipan el retorno |
| `packages/db/src/repositories/types.repository.ts` | Modified | `ListTypesInput { name? }` (D-5) |
| `packages/db/src/repositories/{tags,manufacturers}.repository.ts` | Modified | `name?` en el input (D-5) |
| `packages/db/src/repositories/shops.repository.ts` | Modified | `name?` (D-5) + `_count` filtrado (D-4) |
| `packages/db/src/records.ts` | Modified | `ShopRecord.productsCount?: number` (D-4) |
| `packages/db/index.ts` | Modified | exportar `type ListTypesInput` — **fichero compartido con US-4b** (ver R-4) |
| `packages/db/src/repositories/{types,tags,manufacturers,shops}.integration.test.ts` | **New** | 4 suites (ver abajo) |
| `docs/product/1-catalogo-desde-postgres/4-migrar-catalogos-apoyo.md` | Modified | reescritura a US-4a + nota de split |
| `docs/product/1-catalogo-desde-postgres/README.md` | Modified | tabla de sub-US: fila US-4a + fila US-4b |
| `docs/product/README.md:196` | Modified | mapa del backlog: `US-2, US-3, US-4a, US-4b` |
| `apps/shop/**`, `apps/admin/**`, `db/schema.sql`, `schema.prisma` | Sin cambios | fuera de alcance y sin necesidad técnica |

## Tests de integración — 4 archivos separados

**Decisión: un archivo por catálogo**, no `describe`s añadidos a
`products.integration.test.ts` (268 líneas). Motivos: (a) ese archivo llegaría a
~430 líneas y mezcla el agregado central con catálogos ajenos; (b) vitest corre
sin config propia → `isolate: true` por defecto, así que cada archivo tiene su
propio worker y su propio `prisma` singleton: el `afterAll(prisma.$disconnect)`
de uno no afecta a los demás; (c) las 4 suites son **solo lectura** (no escriben
filas de prueba como `TEST_STORE`), lo que las hace triviales de leer y de
borrar en un rollback parcial.

Cobertura mínima por suite: conteo del seed (types 10, tags 10, manufacturers
14, shops 12), `JSON.stringify` sin BigInt/Decimal sueltos, filtro `name`
(D-5), filtro `typeSlug` (tags/manufacturers), `findXBySlug` con hit y con
`null`, y en shops: `productsCount` (D-4) + las 3 filas reconstruidas.

## Frontera documental (change hermano en paralelo)

| Archivo | Dueño |
|---|---|
| `docs/product/1-catalogo-desde-postgres/4-migrar-catalogos-apoyo.md` → US-4a + nota de split | **ESTE change** |
| `docs/product/1-catalogo-desde-postgres/README.md` (tabla de sub-US, **ambas filas**) | **ESTE change** |
| `docs/product/README.md:196` (mapa del backlog) | **ESTE change** |
| `docs/product/1-catalogo-desde-postgres/4b-categorias-arbol-postgres.md` (nuevo) | **US-4b** — no se toca acá |

La fila de US-4b se escribe aquí apuntando a
`./4b-categorias-arbol-postgres.md` (nombre ya fijado por el proposal hermano,
`openspec/changes/2026-08-26-categorias-arbol-postgres/proposal.md:127`): el
enlace queda colgando hasta que US-4b aterrice, y la nota de split lo explica.
Nota de convención: `docs/product/README.md:182` proscribe las sub-US con
decimales (`1.1-…`) pero no prevé sufijos de letra; se documenta el sufijo `4a`/`4b`
como excepción aprobada por el usuario, **sin** reescribir la convención.

## Risks

| Riesgo | Prob. | Mitigación |
|--------|-------|-----------|
| **R-1**: el presupuesto de 400 líneas se supera incluso partido (ver forecast) | **Alta** | Cadena de 3 PRs por catálogo (abajo). Decisión del usuario requerida antes de `sdd-apply` (`delivery_strategy: ask-on-risk`) |
| **R-2**: D-5 (filtro `name`) y D-4 (`products_count`) contradicen la premisa "`packages/db` no se toca" de la exploración y añaden ~40 LOC + `just db-build` obligatorio | Media | Ambas son **recortables** (ver tabla de recortes); si se recortan, se declara la regresión de las 4 cajas de búsqueda del admin y `products_count: 0` |
| **R-3**: fuga de claves extra del `*Record` en la respuesta | Media | Mapper con literal explícito + diff de key-sets con `node -e` (types 9 / tags 9 / manufacturers 13 / shops 16) |
| **R-4**: **colisión de escritura con US-4b en `packages/db/index.ts`** | Media | Zonas distintas del archivo (línea ~66 vs. ~26-34). Si los dos PRs se apilan, rebasear el segundo; `sdd-tasks` debe declarar la dependencia de orden |
| **R-5**: `just db-build` olvidado tras tocar `packages/db` (`dist/` gitignored, Nest lo consume vía `link:`) | Media | Paso explícito y bloqueante en tasks, antes de cualquier `curl` (lección de US-3 paso 5) |
| **R-6**: R-1/R-2 del épico (shape de paginación, ranking difuso ≠ SQL) | Baja | Ya aceptados por el épico; `paginate()` se reutiliza sin cambios |

## LOC forecast

| Archivo | Líneas cambiadas (est.) |
|---|---|
| `apps/api/rest/src/types/types.service.ts` | ~75 |
| `apps/api/rest/src/tags/tags.service.ts` | ~90 |
| `apps/api/rest/src/manufacturers/manufacturers.service.ts` | ~90 |
| `apps/api/rest/src/shops/shops.service.ts` | ~80 |
| `apps/api/rest/src/common/search/parse-search.ts` (nuevo) | ~14 |
| `packages/db/src/repositories/types.repository.ts` | ~12 |
| `packages/db/src/repositories/tags.repository.ts` | ~5 |
| `packages/db/src/repositories/manufacturers.repository.ts` | ~5 |
| `packages/db/src/repositories/shops.repository.ts` | ~16 |
| `packages/db/src/records.ts` + `packages/db/index.ts` | ~6 |
| 4 × `*.integration.test.ts` (nuevos) | ~160 |
| `docs/product/**` (3 archivos) | ~35 |
| **Total** | **~590** |

**400-line budget risk: High.** El estimado de la exploración (~285) asumía
`packages/db` intacto y ~95 líneas de test; D-4/D-5 y 4 suites reales lo
desbordan. **Este slice NO cabe en un solo PR.**

**Cadena recomendada (3 PRs, corte por catálogo — cada uno releasable y
verificable de punta a punta con su propio `curl`):**

| PR | Contenido | Est. |
|---|---|---|
| #1 | helper `parse-search` + `types` (repo + servicio + suite) | ~135 |
| #2 | `tags` + `manufacturers` (comparten el `type` anidado de D-6 y `top-manufacturers`) | ~250 |
| #3 | `shops` (D-4 `products_count` + evidencia del delta 9→12) + cierre documental | ~205 |

Alternativa si el usuario prefiere 2 PRs: corte por capa (#1 `packages/db` + 4
suites ≈ 200; #2 los 4 servicios + docs ≈ 390) — peor, porque #2 sigue al borde
del guard y no es verificable sin #1.

**Recortes disponibles si se exige un solo PR** (cada uno declara su regresión):
D-5 → −40 LOC, rompe 4 buscadores del admin · D-4 → −25 LOC, `products_count: 0`
visible en la tienda · D-10 ya aplicado (−200) · 4 suites → −160, deja el change
sin gate automatizado (no recomendado).

`sdd-tasks` debe emitir las líneas guard oficiales
(`Decision needed before apply`, `Chained PRs recommended`,
`400-line budget risk`) con estos números.

## Rollback Plan

- **Por PR**: `git revert` del commit del slice. Los servicios de Nest conservan
  sus imports de mock (`typesJson`, `tagsJson`, `manufacturersJson`,
  `shopsJson`, `fuse`) porque los siguen usando `create`/`update`/`remove`,
  `getNewShops`, `getStaffs` y `getNearByShop` → el revert **no** requiere
  reinstalar nada: `just db-build && just build-api`.
- **Rollback parcial por catálogo**: cada servicio es independiente; revertir
  `shops.service.ts` no afecta a `types`/`tags`/`manufacturers`.
- **`packages/db`**: los cambios son aditivos y opcionales
  (`name?`, `productsCount?`) → revertirlos no rompe a ningún otro consumidor
  (`git grep` confirma que solo el barrel y los tests llaman a las 4
  `list*`). Tras cualquier revert de `packages/db`: `just db-build`.
- **Sin cambios de esquema, de datos ni de frontend que deshacer**; no se
  necesita `just db-reset` en ningún escenario.

## Dependencies

`just db-up` (Postgres sembrado y **healthy**) · `just db-build` (obligatorio:
`packages/db/dist` está gitignored y este change toca 5 archivos del paquete) ·
`yarn install` propio en `apps/api/rest` (fuera del workspace, consume
`@safari/db` vía `link:`) · **US-4b es independiente** (no comparte servicios;
único fichero común: `packages/db/index.ts` — R-4).

## Success Criteria

- [ ] **CA-1** `types`: `curl` mock vs. Postgres → 10 filas, array plano (sin
      envoltorio), key-set de 9 claves idéntico; divergencias solo V-8/V-9.
- [ ] **CA-1** `tags`: 10 filas, envoltorio `{data, total, current_page, …}`
      idéntico, key-set de 9 claves, `type` anidado con sus 4 claves;
      divergencias solo V-9/V-12/V-13.
- [ ] **CA-1** `manufacturers`: 14 filas, key-set de 13 claves,
      `/top-manufacturers` con los mismos ids que `slice(0, limit)`;
      divergencias solo V-1/V-2/V-3/V-9/V-10/V-11.
- [ ] **CA-3** `shops`: 12 filas con los 9 slugs del mock + 3 reconstruidos
      enumerados y justificados con salida de `psql` vía `docker exec`;
      key-set de 16 claves; `products_count` real (D-4) con la excepción
      declarada de `makeup-shop`.
- [ ] Los 4 detalles por slug devuelven el mismo objeto que el listado y **404**
      con `{"statusCode":404,...,"error":"Not Found"}` para un slug inexistente.
- [ ] Con `just db-down`: **503** con cuerpo JSON legible en los 4 listados; el
      proceso Nest sigue vivo.
- [ ] **CA-4** `just verify` en verde (3 servicios) + navegación por un `type` y
      una página de `shop` respondiendo 200 en la tienda.
- [ ] `just db-check` en verde con las 4 suites nuevas (salida real pegada).
- [ ] `just build-api` en verde.
- [ ] Status de US-4a actualizado, filas del épico (4a y 4b) y
      `docs/product/README.md:196` al día.

## Open Questions

1. **Bloqueante antes de `sdd-apply`** (política `ask-on-risk`): ¿se acepta la
   cadena de 3 PRs por catálogo, o se aplica alguno de los recortes de D-4/D-5
   para forzar un PR único con regresiones declaradas?
2. No bloqueante: `docs/product/README.md` no contempla sufijos de letra. Se
   documenta `4a`/`4b` como excepción; enmendar la convención sería otra US.
