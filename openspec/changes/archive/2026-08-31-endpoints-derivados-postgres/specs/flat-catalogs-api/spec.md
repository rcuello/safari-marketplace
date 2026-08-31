# Delta for Flat Catalogs API

> **Nota de convención — leer antes de archivar.** `openspec-convention.md`
> solo define secciones de delta para `## ADDED/MODIFIED/REMOVED/RENAMED
> Requirements`; no define un mecanismo de merge para prosa de cabecera
> (`Out of Scope`). Este cambio solo toca esa línea de prosa, no un
> `Requirement`. Precedente ya aplicado en este repo:
> `archive/2026-08-28-categorizacion-slugs-catalogo/specs/
> scraper-product-ingestion/spec.md` (US-7), donde `sdd-archive` aplicó el
> reemplazo a mano y lo registró en el archive report. Este delta sigue el
> mismo patrón con la sección no estándar de abajo.

## MODIFIED Out of Scope (no-estándar — ver nota arriba)

Reemplaza la lista completa de `## Out of Scope` de
`openspec/specs/flat-catalogs-api/spec.md`:

> `categories` (US-4b) · `authors`/`top-authors` · endpoints de escritura
> del admin (`POST`/`PUT`/`DELETE` de los 4 catálogos) · `category_product`
> · `apps/shop/**`, `apps/admin/**` · `GET /staffs`, `POST /approve-shop`,
> `POST /disapprove-shop` · `GET /new-shops` y
> `GET /near-by-shop/:lat/:lng`: migrados a Postgres — ver
> `derived-catalog-api` (US-5) · retrofit de `products.service.ts` al
> helper de búsqueda compartido (D-7) · specs de jest para los 4 servicios
> (D-10).

(Previously: la lista excluía también `GET /new-shops` y
`GET /near-by-shop/:lat/:lng` sin distinguirlos de `GET /staffs` — los tres
quedaban en el mismo bloque de "endpoints de tiendas fuera de alcance".
Ahora solo `GET /staffs`, `POST /approve-shop` y `POST /disapprove-shop`
siguen excluidos; los otros dos se migran en `derived-catalog-api`.)
