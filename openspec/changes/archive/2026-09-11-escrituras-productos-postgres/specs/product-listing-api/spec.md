# Delta for Product Listing API

## MODIFIED Out of Scope (no-estándar — ver nota de convención)

> **Nota de convención.** `openspec-convention.md` no define un merge
> estructurado para prosa de cabecera (`Out of Scope`). Precedente aplicado
> por `sdd-archive` en `escrituras-arbol-categorias` (US-28): reemplaza la
> lista completa a mano, en vez de fusionar por requirement. Este delta es
> deliberadamente mínimo: **ningún requirement de lectura cambia** — las 20
> claves, el envoltorio de paginación y los filtros de este spec se
> preservan verbatim.

Reemplaza la lista completa de `## Out of Scope` de
`openspec/specs/product-listing-api/spec.md`:

> - Detalle por slug (US-3); catálogos de apoyo (US-4).
> - `popular-products`/`best-selling-products`: migrados a Postgres — ver
>   `derived-catalog-api` (US-5).
> - `category_product`: deja de estar vacía por diseño del seed —
>   `product-write-api` (US-29) es la primera ruta capaz de poblarla, y
>   `listProducts` la lee sin cambios de código, como ya hacía; `db/schema.sql`;
>   frontend.

(Previously: parqueaba "`category_product` (vacía por diseño del seed)";
esta capability declara que la tabla deja de estarlo desde
`product-write-api` (US-29), sin que ningún requirement de lectura de este
spec cambie.)
