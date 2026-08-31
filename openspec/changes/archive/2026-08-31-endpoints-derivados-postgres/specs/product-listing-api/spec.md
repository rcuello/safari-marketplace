# Delta for Product Listing API

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
`openspec/specs/product-listing-api/spec.md`:

> - Detalle por slug (US-3); catálogos de apoyo (US-4).
> - `popular-products`/`best-selling-products`: migrados a Postgres — ver
>   `derived-catalog-api` (US-5).
> - `category_product` (vacía por diseño del seed); `db/schema.sql`; frontend.

(Previously: "`popular-products`/`best-selling-products`: quedan en mock
(Decision B)." — esa exclusión deja de ser cierta; los dos endpoints se
migran en `derived-catalog-api`, capability nueva de esta US.)
