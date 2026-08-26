# Proposal: El árbol de categorías desde Postgres

> **US-4b**, Épico 1 — slice de `categories` del split de US-4 aprobado por el usuario.
> Insumo: `openspec/changes/2026-08-26-catalogos-apoyo-postgres/exploration.md` (§4 es
> el núcleo de este change; **no se copia acá**, se referencia por ruta).
> Precedentes estructurales: `openspec/changes/archive/2026-08-25-migrar-api-products-postgres/`
> (US-2) y `openspec/changes/archive/2026-08-26-detalle-producto-postgres/` (US-3).
> Slice hermano en paralelo: **US-4a — catálogos planos** (`types`, `tags`,
> `manufacturers`, `shops`), change `2026-08-26-catalogos-apoyo-postgres`.

## Intent

`GET /api/categories` y `GET /api/categories/:param` sirven hoy
`apps/api/rest/src/db/pickbazar/categories.json` con filtrado difuso en memoria
(`categories.service.ts:11-16`). Es el único catálogo que es un **árbol**, y la
capa de datos lo reconstruye mal: `CATEGORY_INCLUDE`
(`packages/db/src/repositories/categories.repository.ts:35-38`) trae **un solo
nivel** de `children`, porque su comentario de cabecera —y el homólogo de
`db/schema.sql:133`— afirman que la jerarquía tiene "2 niveles reales".

**Los dos comentarios son falsos.** Verificado en vivo contra Postgres
(`docker exec safari-postgres psql`, 26-ago-2026) y contra el JSON del mock:

| Métrica | Valor real |
|---|---|
| Categorías | 198 |
| Raíces (`parent_id IS NULL`) | 83 |
| Descendientes | 115 |
| …de los cuales **nietos** | **6** — `165,166,167,168` bajo `164`; `169,170` bajo `163`; `163`/`164` bajo la raíz `124` ("Dairy & Eggs") |
| Bisnietos | 0 (profundidad máxima = **2 saltos** desde la raíz) |
| Rama afectada | íntegramente `type_id = 7` (`daily-needs`) |

El mock **sí** anida los tres niveles (`byId(124).children[163].children =
[169,170]`, cada uno con su `image`/`products_count`). Con el `include` actual
esos 6 nodos desaparecen del payload → **CA-2 roto**. Este change corrige el
árbol, migra el endpoint y **arregla los dos comentarios equivocados**, que son
la causa raíz del bug.

## Scope

### In Scope

- `categories.repository.ts`: reconstrucción del árbol a **profundidad
  arbitraria** (D-1), back-reference `parent` (D-2), lookup por **id o slug**
  (D-6), corrección del comentario de cabecera con los conteos de arriba.
- `db/schema.sql:130-135`: corrección del mismo comentario ("2 niveles reales"
  → 3 niveles, 6 nietos, ids concretos). Solo comentario: **ninguna columna
  nueva** (`db/schema.sql` es la fuente de verdad del DDL).
- `categories.service.ts`: reescritura sobre `@safari/db` — envoltorio paginado
  estilo Laravel vía el `paginate()` local, filtro `search=type.slug:<slug>`,
  semántica `parent='null'` / `parent=<otro>` (D-4), 404 de dominio, 503/500
  por error de conexión.
- `packages/db/src/repositories/categories.integration.test.ts` — **suite nueva**
  con la aserción de profundidad 3 explícita (el test que habría cazado esto).
- `docs/product/1-catalogo-desde-postgres/4b-categorias-arbol-postgres.md` —
  **el documento de US-4b, y nada más** (ver "Frontera documental").

### Out of Scope (vinculante — "NO incluye" de US-4)

`types` · `tags` · `manufacturers` · `shops` (**US-4a**, change hermano) ·
`authors` (fuera del esquema del catálogo, queda en mock) · endpoints de
escritura del admin (`POST`/`PUT`/`DELETE /categories` siguen devolviendo
`this.categories[0]` del mock, sin tocar) · `category_product` (vacía por
diseño: 0 filas verificadas) · cambios de frontend (`apps/shop/**`,
`apps/admin/**`) · `db/schema.sql` como DDL (solo se edita un comentario) ·
`ExceptionFilter` global · el bloque de smoke de `getCategoryTree` en
`products.integration.test.ts:257-261` (sigue verde con el shape nuevo; no se
mueve). Nada de esto se toca aunque sea adyacente y barato.

## Capabilities

### New Capabilities

- `category-tree-api`: `GET /api/categories` y `GET /api/categories/:param`
  desde Postgres — árbol de profundidad arbitraria, cadena `parent`, filtro por
  vertical y semántica `parent`.

### Modified Capabilities

- None. `product-listing-api` y `product-detail-api` no cambian de requisito;
  este change no toca `products`.

## Approach — decisiones

| # | Tema | Decisión |
|---|------|----------|
| **D-1** | **Estrategia de reconstrucción del árbol** (la decisión central) | **Opción (c) de exploration §4: un `findMany()` plano + ensamblaje en memoria por `parentId`**, recursivo, sin límite de profundidad. Se descarta (a) *nested include* de 2 niveles fijos porque **re-codifica exactamente la suposición de profundidad que produjo este bug**: un 4º nivel volvería a truncarse en silencio. Se descarta (b) `WITH RECURSIVE` vía `$queryRaw` porque introduce una **segunda estrategia de consulta** en el repositorio (sin tipar, más difícil de testear) sin ganancia alguna a 198 filas. (c) mantiene **una sola query tipada de Prisma**, deja el ensamblaje como **función pura testeable sin base**, y `getCategoryTree` ya trae todo sin paginar por diseño (`categories.repository.ts:56-59`). Coste: cargar 198 filas (~53 la vertical más grande) en memoria — irrelevante. |
| **D-2** | **Back-reference `parent`** | **Se reproduce, siguiendo al mock literalmente.** Verificado: el mock emite la **cadena ascendente completa** (`169.parent` = objeto `163`, y `169.parent.parent` = objeto `124` con `parent: null`), y **los nodos ascendentes NO llevan `children` ni `type`** (14 claves). Los descendientes llevan `children` + `products_count` pero **no** `parent` poblado hacia arriba. Por eso **no hay ciclo**: son dos proyecciones distintas (`_toAncestorNode` hacia arriba, `_toDescendantNode` hacia abajo). Poner `parent` y `children` en el mismo nodo produciría una estructura infinita y `JSON.stringify` lanzaría `TypeError: Converting circular structure`. La asimetría es **deliberada y se documenta en el código**. Dato de apoyo: `git grep '\.parent\b' apps/shop/src` → **0 usos**; `parent` es paridad de contrato, no un campo load-bearing de la UI. |
| **D-3** | **Los dos comentarios falsos** | Se corrigen **en este change**, no en un follow-up: son la causa raíz. Texto nuevo en ambos: *198 categorías = 83 raíces + 115 descendientes, de los cuales 6 son nietos (`165-168` bajo `164`, `169-170` bajo `163`, ambos bajo la raíz `124`, `type_id 7`); profundidad máxima 2 saltos, verificada en vivo.* Archivos: `packages/db/src/repositories/categories.repository.ts:1-7` y `db/schema.sql:130-135`. |
| **D-4** | **Semántica de `parent`** (hallazgo **nuevo**, no está en la exploración) | El mock filtra raíces **solo** cuando `parent === 'null'` (`categories.service.ts:39-41`); con cualquier otro valor devuelve la **lista plana de los 198 nodos**, cada uno con su propio subárbol. Y la tienda **sí manda otro valor**: `apps/shop/src/framework/rest/home-pages.ssr.ts:118-121` envía `parent: 'all'` cuando `type.settings.layoutType === 'minimal'` — que es **exactamente `daily-needs`** (`types.json`: el único `minimal`), o sea **la misma vertical que contiene los 6 nietos**. `listCategories()` hoy fuerza `parentId: null` y **no puede expresar `parent='all'`**. Decisión: `ListCategoriesInput` gana `rootsOnly: boolean` (default `true`); con `false` el listado devuelve los 198 nodos planos con subárbol anidado. D-1 lo da gratis: el set completo ya está cargado, cambia solo *qué nodos van al top level*. |
| **D-5** | **Las dos variantes de key-set del mock** | Verificado: los 198 elementos top-level tienen **dos key-sets distintos** — 177 con la variante "completa" de 16 claves, y **21 con una variante de 13 claves** en **otro orden**, con `products_count: null` y **sin** `created_at`/`updated_at`/`deleted_at`/`parent_id`. Los 21 son exactamente las raíces de `type_id 9` (gadget, 10) y `type_id 11` (medicine, 11) — verticales apendadas al mock por otro generador. **Decisión: emitir la variante completa de 16 claves para las 198**, y declarar la divergencia de esas 21 filas. Reproducirla exigiría ramificar el mapper por id, o sea codificar ruido del mock en la capa de Postgres. Precedente directo: las 10 divergencias declaradas de US-2. **Nota de riesgo**: `gadget` es la vertical del proyecto (ver R-2). |
| **D-6** | **Detalle `/:param` (id o slug)** | El controller acepta ambos (`categories.service.ts:57-61`: `p.id === Number(param) || p.slug === param`), pero el repositorio solo tiene `findCategoryBySlug` (`findUnique({where:{slug}})`). Decisión: **`findCategoryByIdOrSlug(param: string)`**, una sola función. `git grep` confirma que los únicos consumidores de las 3 funciones de categories son el barrel (`packages/db/index.ts:31-34`) y el smoke test — **nadie depende de la firma actual** (mismo criterio que D-2 de US-3). Un parámetro extra sería configurabilidad especulativa. |
| **D-7** | **Ausente → 404** | `NotFoundException` (patrón establecido por D-4 de US-3, el primer 404 de dominio del repo), lanzado **fuera** del `try/catch`. Divergencia declarada: el mock devuelve `undefined` → Nest responde **200 con cuerpo vacío**. Se prefiere el 404 por coherencia con `/products/:slug` ya migrado. |
| **D-8** | **Errores de conexión** | `try/catch` que envuelve **solo** la llamada de I/O; `isPrismaConnectionError` → 503, resto → 500, vía `getUserFriendlyMessage` (ambos en el barrel). Idéntico a `products.service.ts:200-207`. |
| **D-9** | **Paginación** | `paginate()` local (`apps/api/rest/src/common/pagination/paginate.ts`), **no** `buildPaginator()` de `packages/db` — ratificado en la Decision A de US-2: `ValidationPipe` no transforma (`main.ts:9`), así que `limit` llega como **string**. `url` literal: `` `/categories?search=${search}&limit=${limit}&parent=${parent}` ``, artefactos `undefined` incluidos. Defaults: `limit=15`, `page=1` (`PaginationArgs`); la tienda manda `limit=1000` (`CATEGORIES_PER_PAGE`), o sea una sola página. |
| **D-10** | **Mapper** | Función privada en `categories.service.ts`, sin archivo `categories.mapper.ts` (mismo criterio que D-6 de US-3). |

### Divergencias aceptadas (declaradas, no defectos)

| # | Divergencia | Observabilidad hoy | Justificación |
|---|---|---|---|
| V-1 | `products_count` = **0** en todos los nodos (el mock trae 0-22 reales en los descendientes) | **Visible**: `apps/shop/src/components/ui/category-card.tsx:29` renderiza `item?.products_count` en `filter-category-grid.tsx` | `category_product` está **vacía por diseño** (0 filas verificadas) y el épico ya la declara fuera de alcance |
| V-2 | Las 21 raíces de `gadget`/`medicine` reciben 16 claves en vez de 13 (D-5) | Claves **extra** (`created_at`, `updated_at`, `deleted_at`, `parent_id`) + orden distinto; `products_count` pasa de `null` a `0` | Ver D-5 |
| V-3 | `translated_languages`, `deleted_at` y `promotional_sliders` (en el `type` embebido) **no tienen columna** | Constantes: `['en']`, `null`, `[]` | Precedente de US-2 (`in_flash_sale: 0`, `type.logo: null`) |
| V-4 | Búsqueda: SQL exacta por `typeSlug` vs. `fuse.js` difuso sobre `['name','type.slug']` con `threshold: 0.3` | Orden y tolerancia a typos cambian | **R-2 del épico**, ya aceptado |
| V-5 | Detalle inexistente: 404 en vez de 200 vacío (D-7) | Visible con `curl -i` | Coherencia con US-3 |

## Estrategia de paridad de contrato

1. **Capturar la línea base ANTES de tocar código** (con la API todavía en mock):
   `curl -s "http://localhost:9001/api/categories?limit=1000&parent=null&search=type.slug:gadget" > mock-categories-gadget.json`,
   más `…&parent=all&search=type.slug:daily-needs` (la vertical de profundidad 3)
   y `curl -s http://localhost:9001/api/categories/dairy-2`.
2. **Vía reproducible sin servidor** (por si se pierde el paso 1): simular
   `getCategories`/`getCategory` sobre `apps/api/rest/src/db/pickbazar/categories.json`
   con `node -e`, como hizo US-3.

**`jq` NO está instalado en este Git Bash**: todo diff de JSON con `node -e`
(comparar `Object.keys` nivel por nivel y recorrer el árbol). `psql` no está en
el PATH: SQL vía
`docker exec -e PGPASSWORD=safari safari-postgres psql -h localhost -U safari -d safari_scraper -c "…"`.

## Frontera documental (change hermano en paralelo)

| Archivo | Dueño |
|---|---|
| `docs/product/1-catalogo-desde-postgres/4b-categorias-arbol-postgres.md` (**nuevo**) | **ESTE change** |
| `docs/product/1-catalogo-desde-postgres/4-migrar-catalogos-apoyo.md` (reescritura a US-4a + nota de split) | **US-4a** — no se toca acá |
| `docs/product/1-catalogo-desde-postgres/README.md` (tabla de sub-US del épico) | **US-4a** — no se toca acá |

`sdd-tasks` y `sdd-apply` **no deben** generar tareas sobre los dos últimos: el
riesgo es una colisión de escritura con el agente de US-4a. Nota menor:
`docs/product/README.md` (numeración) no prevé sufijos de letra (`4a`/`4b`); si
la convención necesita enmienda, es de US-4a (dueña de la tabla del épico).

## Affected Areas

| Área | Impacto | Descripción |
|------|---------|-------------|
| `packages/db/src/repositories/categories.repository.ts` | Modified | D-1 (findMany plano + ensamblaje recursivo), D-2 (`parent`), D-3 (comentario), D-4 (`rootsOnly`), D-6 (`findCategoryByIdOrSlug`) |
| `packages/db/index.ts` | Modified | exportar el tipo de nodo del árbol + `findCategoryByIdOrSlug` |
| `packages/db/src/repositories/categories.integration.test.ts` | **New** | suite nueva, patrón de `products.integration.test.ts` (268 líneas) |
| `db/schema.sql` (líneas 130-135) | Modified | **solo comentario** (D-3). Sin DDL nuevo → sin `just db-reset` |
| `apps/api/rest/src/categories/categories.service.ts` | Modified | `getCategories`/`getCategory` → `async` sobre `@safari/db` + mapper |
| `apps/api/rest/src/categories/categories.controller.ts` | Sin cambios | Nest resuelve las promesas; no tipa el retorno del listado |
| `docs/product/1-catalogo-desde-postgres/4b-…md` | **New** | documento de US-4b |
| `apps/shop/**`, `apps/admin/**`, `packages/db/prisma/schema.prisma` | Sin cambios | fuera de alcance y sin necesidad técnica (`parent_id` ya está introspectado) |

## Risks

| Riesgo | Prob. | Mitigación |
|--------|-------|-----------|
| **R-1**: el ensamblaje en memoria de D-1 introduce un ciclo (`parent` ↔ `children`) y `JSON.stringify` revienta con `TypeError` en runtime, no en compilación | Media | D-2 lo previene por construcción: dos proyecciones separadas y **dos tipos distintos** (el nodo ascendente no tiene `children` en su tipo). Aserción explícita en la suite: `JSON.stringify(tree)` no lanza |
| **R-2**: V-2 (D-5) toca justo `gadget`, la vertical del proyecto; el usuario puede querer las 13 claves exactas ahí | Media | Declarada como divergencia visible **antes** de `sdd-design`. Si se rechaza, la alternativa es ramificar el mapper por `type_id ∈ {9,11}` (~+25 LOC) — decisión de producto, no técnica |
| **R-3**: D-4 (`parent='all'`) es un hallazgo tardío; si se implementa mal, la home de `daily-needs` deja de renderizar categorías | Media | Caso de `curl` obligatorio con `parent=all` en la evidencia, además del `parent=null` |
| **R-4**: `products.integration.test.ts:257-261` usa `getCategoryTree` y podría romperse al cambiar el shape | Baja | `root.children.length > 0` sigue siendo cierto con el nodo recursivo; se verifica corriendo `just db-check`, no se reescribe la aserción |
| **R-5**: `packages/db/dist/` está gitignored y Nest lo consume vía `link:`; olvidar `just db-build` produce un fallo desconcertante | Media | Paso explícito en tasks (lección del paso 5 de US-3) |
| **R-6**: colisión de escritura documental con el agente de US-4a | Baja | Frontera documental explícita arriba |
| **R-7 (heredado)**: R-1/R-2 del épico (shape de paginación estilo Laravel; ranking difuso) | — | Ya aceptados por el épico |

**400-line budget risk: Medium.** Forecast por archivo (`additions + deletions`):

| Archivo | LOC est. |
|---|---|
| `categories.repository.ts` | ~100 (+70 / −30) |
| `packages/db/index.ts` | ~4 |
| `categories.integration.test.ts` (nuevo) | ~90 |
| `categories.service.ts` | ~150 (+110 / −40) |
| `db/schema.sql` (comentario) | ~6 |
| `docs/product/…/4b-….md` (nuevo) | ~45 |
| **Total** | **~395** |

La exploración estimó ~140 LOC para este slice; **la estimación sube** porque
esta propuesta descubrió cuatro cosas que no estaban en §4: la cadena
ascendente de `parent` (D-2), las dos variantes de key-set (D-5),
`parent='all'` (D-4) y el detalle por id-o-slug (D-6). **~395 cabe justo en el
presupuesto pero sin margen.** Costura recomendada a `sdd-tasks` si el
desglose lo supera: **2 PRs encadenados**, ambos autónomos y verificables —
**PR#1** = `packages/db` + comentario de `db/schema.sql` + suite de integración
(cierra con `just db-check` en verde y el árbol ya correcto en la capa de
datos, sin cambiar ningún contrato HTTP); **PR#2** = servicio de Nest + doc de
la US (cierra con el `curl` mock-vs-Postgres y `just verify`).

## Rollback Plan

- **Total**: `git revert` de los commits del change. Ni `productsJson` ni el
  `fuse` de categories se eliminan de `categories.service.ts` — los siguen
  usando `create`/`update`/`remove` (que quedan en mock), así que el mock
  permanece cargado y el revert solo necesita `just db-build && just build-api`.
  No hay cambio de DDL, de datos ni de frontend que deshacer, y `db/schema.sql`
  solo cambió un comentario → **no hace falta `just db-reset`**.
- **Parcial A** (falla solo el endpoint): revertir `categories.service.ts` y
  dejar el repositorio corregido. La capa de datos mejora, la API vuelve al
  mock; ningún consumidor externo depende de las firmas (verificado con
  `git grep`).
- **Parcial B** (falla solo el árbol): con D-1, volver a `CATEGORY_INCLUDE` es
  restaurar una constante y un mapper; los 6 nietos vuelven a desaparecer y la
  divergencia se re-declara en el reporte.
- **Irreversible**: nada.

## Dependencies

- **De US-4a: ninguna dura.** No comparten archivo de servicio, ni de
  repositorio, ni de test. Puede ejecutarse **en paralelo o después**. Único
  acoplamiento: ambos proyectan el objeto `type` embebido a partir de
  `TypeRecord` (US-4a lo hace para `/api/types`, este change para el `type`
  anidado de cada categoría) — **se acepta la duplicación**; extraer un helper
  compartido exige coordinar dos changes en vuelo y es un refactor especulativo
  hasta que exista el tercer consumidor. Ambos tocan
  `docs/product/1-catalogo-desde-postgres/` pero **en archivos distintos**
  (ver Frontera documental).
- **Entorno**: `just db-up` (Postgres 16 sembrado, puerto 5433 — hoy up y
  healthy) · `just db-build` (obligatorio: `packages/db/dist/` está gitignored
  y este change **sí** toca `packages/db`) · `yarn install` propio en
  `apps/api/rest` (fuera del workspace de yarn, consume `@safari/db` vía
  `link:`) · API en el puerto **9001** (el 9000 lo ocupa Zscaler).

## Success Criteria

- [ ] **CA-1** (paridad de contrato): `curl` mock vs. Postgres para
      `?parent=null&search=type.slug:gadget` y `?parent=all&search=type.slug:daily-needs`
      — mismo key-set por nodo, mismos tipos, mismo envoltorio de paginación,
      mismos ids en el mismo orden. Diff con `node -e`, **no** `jq`. Únicas
      divergencias: V-1…V-5, declaradas.
- [ ] **CA-2** (el árbol completo): el payload contiene las 198 categorías y la
      cadena `124 → 163 → {169, 170}` **sobrevive anidada**, con los nietos
      trayendo sus propios `image`/`icon`/`slug`. Verificado por `curl` **y**
      por la suite de integración.
- [ ] **CA-4** (la tienda navega): `just verify` en verde y navegación por una
      categoría respondiendo 200 con la API contra Postgres.
- [ ] `just db-check` en verde, incluyendo la suite nueva de `categories` con:
      profundidad 3 explícita (ids `124/163/169/170`), 198/83/115/6 como
      conteos, `rootsOnly: false` devolviendo 198 nodos top-level,
      `findCategoryByIdOrSlug('124')` ≡ `findCategoryByIdOrSlug('dairy-2')`, y
      `JSON.stringify(tree)` sin `TypeError` (R-1).
- [ ] `curl -i /api/categories/no-existe-xyz` → `404` y el proceso Nest sigue vivo.
- [ ] Con `just db-down`: **503** con cuerpo JSON legible, no 500 crudo.
- [ ] Los comentarios de `categories.repository.ts` y `db/schema.sql` dicen la
      verdad verificable (D-3).
- [ ] `docs/product/1-catalogo-desde-postgres/4b-categorias-arbol-postgres.md`
      creado; **`4-migrar-catalogos-apoyo.md` y el README del épico intactos**
      (los cierra US-4a).

> **CA-3 de US-4 (shops reconstruidos) no aplica a este slice** — es de US-4a.

## Open Questions

Una, para el usuario antes de `sdd-design`: **V-2 / D-5** — ¿se acepta emitir
16 claves uniformes para las 21 raíces de `gadget`/`medicine` (variante del
mock: 13 claves en otro orden), o se prefiere ramificar el mapper para
replicarlas exactas (~+25 LOC)? Recomendación: **aceptar la uniformidad** y
declarar la divergencia; la UI activa lee `name`/`slug`/`image`/`icon`/`children`
y no depende del key-set. Todo lo demás que la exploración dejó abierto queda
resuelto en D-1…D-10.
