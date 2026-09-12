# Delta for Derived Catalog API

## MODIFIED Requirements

### Requirement: `new-shops` refleja la cola real de moderación

`new-shops` MUST filtrar por `is_active = false` reutilizando
`ListShopsInput.isActive` (sin código nuevo). Con el seed sin
modificaciones (12 tiendas activas), `total: 0` MUST seguir siendo el
resultado correcto — esa premisa era estructural antes de US-30 y pasa a
ser circunstancial: una vez que `shop-write-api` puede crear tiendas
inactivas (`CA-1`, un `store_owner` crea una tienda que nace con
`is_active = false`), el mismo endpoint MUST reflejarlas sin código nuevo
en `derived-catalog-api`, porque ambos comparten el filtro
`ListShopsInput.isActive`.
(Previously: la premisa era que `total: 0` era el único resultado posible
porque no existía ningún camino de escritura que produjera una tienda
inactiva; US-30 abre ese camino y el requirement deja de asumirlo.)

#### Scenario: Ninguna tienda inactiva en el seed sin escrituras
- GIVEN el seed sembrado sin escrituras adicionales (12/12 activas)
- WHEN pido `GET /api/new-shops`
- THEN recibo `{data: [], total: 0, ...}` — correcto, no un error

#### Scenario: La cola se puebla tras una creación de `store_owner` (CA-1)
- GIVEN un token `store_owner` que acaba de crear una tienda vía
  `POST /shops` de `shop-write-api`
- WHEN pido `GET /api/new-shops`
- THEN la respuesta incluye esa tienda con `is_active` falso, y `total`
  sube en 1 respecto al baseline del seed

## MODIFIED Out of Scope (no-estándar — ver nota abajo)

> **Nota de convención.** `openspec-convention.md` no define un merge para
> prosa de cabecera (`Out of Scope`). Precedente aplicado en `flat-catalogs-
> api` (US-8, US-27a, US-27b): `sdd-archive` reemplaza la lista a mano.

Reemplaza la lista completa de `## Out of Scope` de
`openspec/specs/derived-catalog-api/spec.md`:

> `getStaffs` (sin JSON, contrato preservado — ver `shop-write-api`, US-30)
> · escrituras reales de `shops` (`POST`/`PUT /shops`,
> `approve-shop`/`disapprove-shop`: viven en la capability `shop-write-api`,
> no aquí) · `db/schema.sql`/`schema.prisma` · árbol de categorías ·
> `apps/shop/**`, `apps/admin/**` · `shop_id` en popular/best-selling
> (muerto, sigue muerto) · los ~30 servicios 100% mock.

(Previously: «`getStaffs` · escrituras reales (stubs del mock)». Ambas
premisas asumían que `shops` seguiría siendo un mock permanente; US-30 las
implementa en otra capability, así que aquí se declaran como fuera de
alcance por pertenecer a `shop-write-api`, no por seguir siendo stubs.)
