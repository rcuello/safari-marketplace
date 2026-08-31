# Proposal: Endpoints derivados del catálogo desde Postgres

> **US-5**, Épico 1. Insumo: `explore.md` (esta carpeta). Precedentes:
> `archive/2026-08-25-migrar-api-products-postgres/` (US-2, tabla de divergencias),
> `archive/2026-08-26-detalle-producto-postgres/` (US-3, 404 de dominio),
> `archive/2026-08-26-catalogos-planos-postgres/` (US-4a, mappers + `paginate()`).
> Las dos decisiones de las "Notas" de la US (ranking; los dos bugs se corrigen) están
> **cerradas por el dueño del repo** y no se re-abren.

## Intent

Tras US-2/3/4a/4b, `products.service.ts` y `shops.service.ts` quedaron híbridos: listado y
detalle salen de Postgres, pero 6 métodos siguen sirviendo JSON de 2021. El bloqueante no es
el código sino el **dato**: `ratings > 0` en 0 filas y `sold_quantity > 0` en 2 de 1200, así
que no hay criterio por el que ordenar "popular" ni "más vendido". Esta US siembra ese dato
y cierra la migración del catálogo de lectura.

## Scope

### In Scope

| Endpoint (ruta real) | Envoltorio | Origen nuevo |
|---|---|---|
| `GET /api/popular-products` | array plano | `listProducts({ orderBy: 'ratings' })` |
| `GET /api/best-selling-products` | array plano | `listProducts({ orderBy: 'soldQuantity' })` |
| `GET /api/products-stock` | `{data, ...paginate()}` | `listProducts({ maxQuantity: 9 })` |
| `GET /api/draft-products` | `{data, ...paginate()}` | `listProducts({ status: 'draft' })` |
| `GET /api/new-shops` | `{data, ...paginate()}` | `listShops({ isActive: false })` |
| `GET /api/near-by-shop/:lat/:lng` | array plano | `listShopsNear(lat, lng)` (nueva) |

Más: enriquecer `db/generate-seed.mjs` + regenerar `db/seed.sql`; extender
`ListProductsInput` (orden, `maxQuantity`, desactivar el default de status/visibility);
tests de integración; retirar los imports de mock huérfanos.

### Out of Scope (vinculante — "NO incluye" de la US)

`getStaffs` (no hay tabla de usuarios) · escrituras reales (por eso `productsJson`/
`shopsJson` **no** se borran) · tablas nuevas · `db/schema.sql` y `schema.prisma` (las 3
columnas destino ya existen) · árbol de categorías · `apps/shop/**`, `apps/admin/**` · los
~30 servicios 100% mock · `CLAUDE.md`.

**Adyacentes detectadas y NO accionadas**: `shop_id` es parámetro muerto en los DTO de
popular/best-selling y sigue muerto (cablearlo sería un tercer cambio de comportamiento no
decidido) · `CLAUDE.md` afirma que `apps/api/rest` no tiene ningún `*.spec.ts`, pero
`apps/api/rest/src/products/products.service.spec.ts` existe y ningún target de `just` lo corre.

## Capabilities

### New Capabilities

- `derived-catalog-api`: los 6 endpoints derivados (destacados, inventario, borradores,
  tiendas nuevas y cercanas) servidos desde Postgres, con su ranking sembrado.

### Modified Capabilities

- `product-listing-api`: su *Out of Scope* declara "`popular-products`/`best-selling-products`:
  quedan en mock (Decision B)" (`spec.md:131`). Deja de ser cierto.
- `flat-catalogs-api`: su *Out of Scope* excluye `GET /new-shops` y `GET /near-by-shop/:lat/:lng`
  (`spec.md:215-216`). Dejan de estar excluidos.

## Approach — decisiones

| # | Tema | Decisión |
|---|------|----------|
| **D-1** | **Ranking** (cerrado) | `popular` → `ratings DESC`; `best-selling` → `soldQuantity DESC`. **Añadido por diseño**: desempate `id ASC` — con 1194 filas empatadas en `0.00`, sin él la cola del top-N es no determinista y la paginación inestable. Orden tipado (`orderBy?: 'id' \| 'ratings' \| 'soldQuantity'`), no string libre. |
| **D-2** | **Mapeo del seed** | `popular-products.json` aporta `ratings` (5.00, 4.67, 4.67, 3.33, 1.67, 1.00 en 6 de sus 10 ids) y `total_reviews`; `best-selling-products.json` aporta `total_sales` → **`sold_quantity`**. `orders_count` se descarta: sin columna destino, y `ratings` ya cubre "popular". `total_reviews` **hay que añadirlo al INSERT**: hoy no se emite (`generate-seed.mjs:229-231`) aunque la columna existe. Fusión **por campo**, no por fila (el id 888 está en ambos JSON). |
| **D-3** | **Proyección de products** | Se reutiliza `toProductDto` (20 claves, `products.service.ts:133-167`); no se construye un mapper de 46. La tarjeta de la tienda (`apps/shop/src/components/products/cards/helium.tsx:26-40`) consume 11 claves, todas dentro de las 20. |
| **D-4** | **`type_slug`** (cerrado) | `listProducts({ typeSlug, orderBy })`: filtra DENTRO del ranking en vez de descartarlo y hacer `fuse` sobre el catálogo entero. |
| **D-5** | **`near-by-shop`: mapper propio de 14 claves con `distance` calculada** | `near-shop.json` no tiene el key-set de `shops.json`: le faltan `orders_count`, `products_count`, `owner` y **añade `distance`**. `apps/shop/src/components/ui/cards/near-shop.tsx:38-41` **renderiza** `shop.distance.toFixed(2)` → la clave es obligatoria. Los 6 valores del mock (5.47 … 20.89) **ya vienen ordenados ascendentemente**: el orden `2,6,1,5,4,3` no es arbitrario, es distancia creciente desde un origen perdido. Haversine en JS (km) sobre las candidatas con `settings->'location'` con `lat`/`lng` numéricos — 6 de 12 filas, sin SQL raw ni PostGIS. Mapper `toNearShopDto`, no `toShopDto`. |
| **D-6** | **`products-stock`/`draft-products` NO heredan el default** | `buildWhere` fuerza `status:'publish'` y `visibility:'visibility_public'` (`products.repository.ts:167-169`); el mock no filtra por status aquí. Hoy coincide por casualidad (el único draft, id 454, tiene `quantity 30`), pero un borrador con stock bajo desaparecería en silencio del inventario. El input debe permitir desactivar el default explícitamente. |
| **D-7** | **`new-shops` es solo cableado** | `ListShopsInput.isActive` ya existe (`shops.repository.ts:11-20`). Seguirá devolviendo `total: 0` porque las 12 filas están activas: **eso es correcto**, no un fallo. Cero código nuevo en el repositorio. |
| **D-8** | **`limit` ausente** | El mock hace `slice(0, undefined)` → lista completa: **10** en popular, **5** en best-selling. Se reproduce ese conteo como default por endpoint. |
| **D-9** | **Errores y parseo** | Patrón de US-3/4a: `try` solo alrededor del I/O, `isPrismaConnectionError` → 503, resto → 500; `parseSearch` compartido para `products-stock`/`draft-products`. |

## Divergencias declaradas

**De comportamiento** (deliberadas, no efectos colaterales):

| # | Cambio |
|---|---|
| B-1 | `near-by-shop` deja de devolver 6 tiendas fijas ignorando `lat`/`lng`; filtra y ordena por cercanía real. Nunca más de 6 filas (solo 6 tienen coordenadas). |
| B-2 | `type_slug` filtra dentro del ranking (D-4). |
| B-3 | **Los ids visibles dejan de ser la lista curada.** `popular` top-10 = `4,1,3,2,5,25` + 4 filas cualesquiera empatadas en `0.00` por `id ASC`; los curados `888/972/973/976` caen porque su `ratings` en el mock **es 0**. `best-selling` top-5 = `888 (4)`, luego `1` y `2` (ya traían `sold_quantity: 2` de `products.json`) por encima de tres curados con `total_sales: 1`. Es el objetivo de la US, no una regresión. |

**De forma**: **S-1** popular/best-selling pasan de **46 claves** por fila a las **20** de
`toProductDto` (mismo criterio que US-2/4a: se declara, no se compensa inventando datos) ·
**S-2** `in_flash_sale` sigue siendo la constante `0` que ya emite `toProductDto`
(`products.service.ts:162`), divergencia embarcada en US-2 · **S-3** `created_at`/`updated_at`
con el `now()` del último `db-up` y 3 decimales en vez de 6 — aceptada por CA-4 y por
precedente; solo `near-by-shop` emite esas claves.

## Affected Areas

| Área | Impacto | Descripción |
|------|---------|-------------|
| `db/generate-seed.mjs` | Modified | mapa `id → {ratings, total_reviews, sold_quantity}` + `total_reviews` en el INSERT (D-2) |
| `db/seed.sql` | **Regenerado** | artefacto, nunca a mano (`db/README.md:20`); **1200 filas de `products` cambian** (R-1) |
| `packages/db/src/repositories/products.repository.ts` | Modified | `orderBy` tipado (D-1), `maxQuantity`, desactivar el default (D-6) |
| `packages/db/src/repositories/shops.repository.ts` | **New fn** | `listShopsNear(lat, lng)` + haversine (D-5) |
| `packages/db/src/repositories/{products,shops}.integration.test.ts` | Modified | orden, `maxQuantity`, sin-default, cercanía, descarte de tiendas sin coordenadas |
| `apps/api/rest/src/products/products.service.ts` | Modified | 4 métodos; retirar `popularProductsJson`/`bestSellingProductsJson` (y `Fuse` si ninguna rama lo conserva) |
| `apps/api/rest/src/shops/shops.service.ts` | Modified | 2 métodos; retirar `nearShopJson`, la const `nearShops` y la propiedad muerta `private nearShops` |
| `*.controller.ts` (products, shops) | Sin cambios | mismas rutas y DTOs; `NearByShopController` conserva `:lat/:lng` (`shops.controller.ts:108-116`) |
| `docs/product/1-catalogo-desde-postgres/{5-…md, README.md}` | Modified | status de la US y fila del épico |

## Risks

| Riesgo | Prob. | Mitigación |
|--------|-------|-----------|
| **R-1**: el `seed.sql` regenerado produce un diff mecánico de **~1200 líneas** que desborda por sí solo el presupuesto de 400 | **Alta** | Es un artefacto generado y así lo declara `db/README.md`. Se propone excluirlo del cómputo (se revisa `generate-seed.mjs`, no su salida) y aislarlo en su propio commit. **Decisión del usuario antes de `sdd-apply`** (`ask-on-risk`) |
| **R-2**: el seed altera conteos/ids que assertan los tests | Media | Solo se toca el INSERT de `products`. Verificar: `shops` `total === 12` e `items[0].id === 15` (`listShops` ordena `id:'desc'`), `categories === 198`, `products === 1200` |
| **R-3**: `just db-reset` (obligatorio: el DDL es `IF NOT EXISTS`, no actualiza filas) **borra el volumen** y con él las filas scrapeadas locales | Media | Paso anunciado en tasks; los datos del scraper son reproducibles con `just scrape` |
| **R-4**: `just db-build` olvidado tras tocar `packages/db` (`dist/` gitignored, Nest lo consume vía `link:`) | Media | Paso bloqueante antes de cualquier `curl` (lección de US-3) |
| **R-5**: `products.service.spec.ts` existe y **ningún target de `just` lo corre** | Media | Añadir `yarn test` dentro de `apps/api/rest` a la DoD |
| **R-6**: `near-by-shop` cambia el orden observable (B-1) | Baja | No hay snapshots de frontend; se verifica con `just verify` + la página de búsqueda de tiendas |

## LOC forecast

`generate-seed.mjs` ~35 · `products.repository.ts` ~30 · `shops.repository.ts` ~45 · 2
suites ~90 · `products.service.ts` ~110 · `shops.service.ts` ~85 · docs ~10 → **~405
revisables**, más ~1200 generadas en `db/seed.sql`.

**400-line budget risk: High.** La estimación de la US (~250) no contaba `listShopsNear` +
haversine + el mapper de 14 claves (D-5) ni los tests. **Cadena recomendada de 2 PRs**:
**#1** seed + `products.repository` + suite + los 4 métodos de products (CA-1, CA-2) ≈ 265
(+1200 generadas); **#2** `listShopsNear` + suite + los 2 métodos de shops + cierre
documental (CA-3) ≈ 150. `sdd-tasks` debe emitir las líneas guard con estos números.

## Rollback Plan

- **Código**: `git revert` del slice. El revert de PR #1 restaura `popularProductsJson`/
  `bestSellingProductsJson` y el de PR #2 `nearShopJson` (van en el mismo commit que su
  borrado). Después: `just db-build && just build-api`.
- **`packages/db`**: los cambios son aditivos y opcionales (`orderBy?`, `maxQuantity?`, la
  nueva `listShopsNear`) → revertirlos no rompe a otros consumidores. `just db-build` después.
- **Datos** (la parte no trivial): revertir `generate-seed.mjs` + `seed.sql` **no deshace la
  base local**. Volver atrás exige `just db-reset` (recrea el volumen y reaplica
  `schema.sql` + `seed.sql`), **no** `just db-migrate` — el DDL es idempotente pero no
  actualiza filas. Sin `db-reset` la base conserva el ranking sembrado mientras el código ya
  no lo usa: inconsistente pero inofensivo (`ratings`/`sold_quantity` solo se leen).
- **Sin cambios de esquema ni de frontend que deshacer.**

## Dependencies

`just db-up` · `just db-reset` tras regenerar el seed · `just db-build` (obligatorio: se
tocan 2 archivos de `packages/db`) · `yarn install` propio en `apps/api/rest` · US-2 y US-4a
embarcadas (aportan `toProductDto`, `toShopDto`, `paginate()`, `parseSearch`).

## Success Criteria

- [ ] **CA-1** `SELECT count(*) FILTER (WHERE ratings > 0)` ≥ 6 y `FILTER (WHERE
      sold_quantity > 0)` ≥ 6 pegado desde `docker exec … psql`; `curl` de los dos endpoints
      devolviendo los ids de B-3 en ese orden exacto, con `?limit=3` y `?type_slug=` probados.
- [ ] **CA-2** `products-stock` → `total: 11`, ids `2,190,1014,1015,1017,1018,1021,1022,1023,
      1024,1028`; `draft-products` → `total: 1`, id `454`; envoltorio de paginación idéntico.
- [ ] **CA-3** `new-shops` → `total: 0`, `data: []` (D-7); `near-by-shop/:lat/:lng` con dos
      pares de coordenadas distintos devolviendo **órdenes distintos**, key-set de **14
      claves** con `distance` numérica ascendente, y ninguna tienda sin coordenadas presente.
- [ ] **CA-4** diff de key-sets mock-vs-Postgres con `node -e` (`jq` no está instalado)
      pegado para los 6 endpoints; solo aparecen S-1/S-2/S-3 y B-1/B-2/B-3.
- [ ] **CA-5** `just db-check` verde con las suites nuevas · `just build-api` verde ·
      `yarn test` en `apps/api/rest` verde (R-5) · `just verify` verde · `git grep` sin
      imports huérfanos de los 3 JSON.
- [ ] Status de US-5 actualizado y fila del épico marcada.

## Open Questions

1. **Bloqueante antes de `sdd-apply`** (`ask-on-risk`): ¿se acepta la cadena de 2 PRs y la
   exclusión de `db/seed.sql` (~1200 líneas generadas) del presupuesto de review? (R-1)
2. No bloqueante: D-8 fija el default de `limit` en 10 (popular) y 5 (best-selling) para
   preservar el conteo del mock. Un default único sería más coherente pero cambiaría el
   número de filas de `best-selling-products`.
