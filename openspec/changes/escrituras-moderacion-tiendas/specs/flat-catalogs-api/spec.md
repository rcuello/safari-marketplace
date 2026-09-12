# Delta for Flat Catalogs API

## MODIFIED Out of Scope (no-estándar — ver nota abajo)

> **Nota de convención.** `openspec-convention.md` no define un merge para
> prosa de cabecera (`Out of Scope`). Precedente aplicado 3 veces sobre esta
> capability (US-8, US-27a, US-27b): `sdd-archive` reemplaza la lista a mano.

Reemplaza la lista completa de `## Out of Scope` de
`openspec/specs/flat-catalogs-api/spec.md`:

> `categories` (US-4b) · `authors`/`top-authors` · `types` (US-27a),
> `tags`/`manufacturers` (US-27b) y `shops` (US-30) pasan a estar en alcance
> — las escrituras de `shops` viven en la capability `shop-write-api`, no
> aquí · `category_product` · `apps/shop/**`, `apps/admin/**` ·
> `GET /new-shops` y `GET /near-by-shop/:lat/:lng`: migrados a Postgres —
> ver `derived-catalog-api` (US-5) · retrofit de `products.service.ts` al
> helper de búsqueda compartido (D-7) · specs de jest para los 4 servicios
> (D-10).

(Previously: parqueaba «endpoints de escritura del admin de `shops`
(US-30)» y «`GET /staffs`, `POST /approve-shop`, `POST /disapprove-shop`»
como fuera de alcance. Al implementar US-30 esas rutas, la premisa deja de
ser cierta — ninguna de las lecturas de esta capability cambia; el
key-set, el envoltorio de paginación y `search=is_active:1` se preservan
verbatim, como ya declara el `## Requirements` de este spec.)
