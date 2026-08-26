# Tasks: El árbol de categorías desde Postgres (US-4b)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | PR#1 ~356 · PR#2 ~215 · total ~571 |
| 400-line budget risk | High (whole change) / Low (per PR) |
| Chained PRs recommended | Yes |
| Suggested split | PR #1 (`packages/db` + suite) → PR #2 (Nest service + doc), stacked |
| Delivery strategy | auto |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Árbol de profundidad arbitraria en `packages/db`, cero cambio de contrato HTTP | PR 1 → `main` | Cierra con `just db-check`; suite de integración incluida |
| 2 | `categories.service.ts` sobre `@safari/db`, mappers, evidencia HTTP | PR 2 → rama de PR 1 | Depende de PR 1 fusionado/rebased; cierra con `curl` + `just verify` |

## Phase 1: PR#1 — Ensamblador del árbol (`categories.repository.ts`)

- [x] 1.1 Reescribir el comentario de cabecera de `packages/db/src/repositories/categories.repository.ts:1-6` con el texto de `design.md` (198 = 83+109+6, profundidad 2, la razón del bug viejo).
- [x] 1.2 Eliminar `CategoryWithChildren` (:22-25); añadir `CategoryAncestor`, `CategoryDescendant`, `CategoryTreeNode` (Decisión B) con la asimetría `parent`/`children` documentada en el JSDoc de cada interfaz.
- [x] 1.3 Cambiar `CATEGORY_INCLUDE` (:35-38) de `{ type: true, children: { orderBy } }` a `{ type: true }` — sin `include` anidado.
- [x] 1.4 Implementar `_assembleTree(rows)` privado y síncrono: índices `recs`/`types`/`kids`, `descend()`/`ascend()`/`_immediate()` memoizados, guarda de ciclo por `path: Set<number>` (Decisión A).
- [x] 1.5 Ampliar `ListCategoriesInput` con `rootsOnly?: boolean` (default `true`, Decisión D) y `name?: string` (Decisión G, `contains` + `mode: 'insensitive'`, patrón de `products.repository.ts:179-181`).
- [x] 1.6 Reescribir `listCategories()`: `findMany()` plano (con `where.type.slug`/`where.name` si aplica) → `_assembleTree` → top = raíces o todos según `rootsOnly` → slice de paginación después del ensamblaje.
- [x] 1.7 Reemplazar `findCategoryBySlug` por `findCategoryByIdOrSlug(param)` (Decisión E): una query, un `_assembleTree`, precedencia id-gana-sobre-slug.
- [x] 1.8 Reimplementar `getCategoryTree(typeSlug?)` sobre el ensamblador (~8 LOC); NO tocar el smoke de `products.integration.test.ts:256-261` que la consume.

## Phase 2: PR#1 — Barrel y comentario de `db/schema.sql`

- [x] 2.1 Actualizar `packages/db/index.ts:26-34` (bloque `categories`): exportar `CategoryAncestor`/`CategoryDescendant`/`CategoryTreeNode`/`ListCategoriesInput`, `findCategoryByIdOrSlug`, `getCategoryTree`, `listCategories`; quitar `CategoryWithChildren` y `findCategoryBySlug`. Tocar solo ese bloque — este archivo es la base de rebase con US-4a.
- [x] 2.2 Corregir `db/schema.sql:130-136` (hoy: *"En el mock hay 198 categorías: 83 raíces y 115 hijas (2 niveles reales)"*) con el texto verificado de `design.md` §"Los dos comentarios corregidos": 83+109+6, ids 165-168/169-170, `type_id 7`, sin DDL nuevo.

## Phase 3: PR#1 — Suite de integración y gate

- [x] 3.1 Correr `git grep -n "CategoryWithChildren\|findCategoryBySlug"` y pegar la salida: confirmar que solo aparecían en el barrel y su propia definición antes de borrarlos.
- [x] 3.2 Crear `packages/db/src/repositories/categories.integration.test.ts` con las 11 aserciones de `design.md` §Testing Strategy: conteos `rootsOnly` true/false (83/198), profundidad 3 explícita (`124→[163,164]`, `163→[169,170]`, `169.slug==='brown-eggs'`), 0 bisnietos, cadena ascendente (D-2), `JSON.stringify` sin lanzar (R-1), `typeSlug`+paginación, `name` case-insensitive, `findCategoryByIdOrSlug` id≡slug, nieta por slug, ausente→`null`, `getCategoryTree` (R-4).
- [x] 3.3 Correr `just db-check` y pegar la salida real en verde, incluida la aserción de profundidad 3.
- [x] 3.4 Correr `just db-build` (bloqueante: `dist/` gitignored, Nest lo consume vía `link:`) y pegar la salida — cierra PR#1.

## Phase 4: PR#2 — Línea base del mock (PRIMERA tarea, antes de tocar código)

- [x] 4.1 Con `just api-dev` todavía en mock, capturar los 3 `curl` de `design.md` §Verification Plan Paso 0 en `openspec/changes/2026-08-26-categorias-arbol-postgres/mock-cat-{gadget,daily,dairy2}.json`. Si el servidor no está disponible, usar la réplica `node -e` con `fuse.js` real del mismo paso.

## Phase 5: PR#2 — Servicio de Nest

- [x] 5.1 Reescribir `apps/api/rest/src/categories/categories.service.ts`: `getCategories`/`getCategory` → `async` sobre `@safari/db`; `rootsOnly = (parent === 'null')`; `parseCategorySearch(search)` traduce `type.slug:v`→`typeSlug` y `name:v`→`name`. `create`/`update`/`remove`, `categoriesJson`, `plainToClass`, `fuse` quedan intactos.
- [x] 5.2 Añadir mappers privados de módulo: `toCategoryDto` (16 claves uniformes, sin ramificar por `type_id` — V-2/D-5), `toAncestorDto` (14 claves), `toDescendantDto` (16 claves, sin `type`, `products_count: 0`), `toEmbeddedType` (10 claves).
- [x] 5.3 Envolver `getCategories` con `try/catch` 503/500 (`isPrismaConnectionError`/`getUserFriendlyMessage`, patrón `products.service.ts:197-210`); en `getCategory` el `try` cubre solo la llamada de I/O y el `NotFoundException` queda fuera (patrón `products.service.ts:213-230`).
- [x] 5.4 Correr `just db-build && just build-api` (o reiniciar `just api-dev`) y pegar la salida — sin esto la evidencia HTTP siguiente es inválida.

## Phase 6: PR#2 — Evidencia HTTP

- [x] 6.1 CA-1: `curl` (puerto 9001) `pg-cat-gadget.json`/`pg-cat-daily.json`, diff con `node -e` contra los mock-* de 4.1 excluyendo `created_at`/`updated_at` (V-7); pegar salida confirmando que las únicas diferencias caen en V-1/V-2/V-6/V-8.
- [x] 6.2 CA-2: `node -e` de `design.md` sobre `pg-cat-daily.json` — confirma `124→163,164`, `163→169,170`, 2 nietas con 16 claves, cadena `169→163→124`, `JSON.stringify` no lanza.
- [x] 6.3 CA-2b: `curl /api/categories/dairy-2` y `/124` — mismo JSON; comparar key-set y orden contra `mock-cat-dairy2.json`.
- [x] 6.4 CA-2c: `curl -i /api/categories/no-existe-xyz` → 404; `curl /api/types` → 200 (proceso Nest vivo).
- [x] 6.5 `just db-down`; `curl /api/categories` → 503 con cuerpo legible; `curl /api/types` → 200 (vivo); `just db-up`.
- [x] 6.6 CA-4: `just shop-dev` + `just verify`; `curl /en/daily-needs` (grep `Dairy`) y `/en/grocery` (grep `Vegetables`).
- [x] 6.7 D-3: `docker exec -e PGPASSWORD=safari safari-postgres psql …` con el `WITH RECURSIVE` de `design.md` → `0|83 1|109 2|6`; `grep -n "nietas\|nietos"` en ambos archivos corregidos.

## Phase 7: PR#2 — Documentación de la US

- [x] 7.1 Crear `docs/product/1-catalogo-desde-postgres/4b-categorias-arbol-postgres.md` con CA-1/CA-2/CA-4 y evidencia real pegada (Fases 6). NO tocar `4-migrar-catalogos-apoyo.md` ni el `README.md` del épico (dueños: US-4a).
