# Proposal: Migrar `/api/products` (listado) a Postgres vía `@safari/db`

> US-2, Épico 1. Insumo: `exploration.md` (misma carpeta).

## Intent

`GET /api/products` sirve hoy `src/db/pickbazar/products.json` con filtrado en
memoria (`fuse.js`, `products.service.ts:33`). Debe leer la MISMA tabla
`products` que llena el scraper, preservando el contrato HTTP, para que el
flujo scraper → base → tienda sea demostrable. Precedente: `/api/settings`.

## Scope

### In Scope
- Reescribir `ProductsService.getProducts()` sobre `listProducts()` +
  `buildPaginator()` de `@safari/db` (ambos exportados en `packages/db/index.ts:47-56,17`).
- Parseo de `search=key:value;…` → `ListProductsInput` (`type.slug`→`typeSlug`, etc.).
- Mapper `ProductRecord` → shape del mock.
- CA-5: `try/catch` con `isPrismaConnectionError`/`getUserFriendlyMessage`.
- Cobertura de integración de `shopId`/`manufacturerSlug`/`tagSlug`.

### Out of Scope (vinculante — "NO incluye" de la US)
Detalle por slug (US-3) · catálogos de apoyo (US-4) · `category_product` ·
frontend · `db/schema.sql` · `products-stock`/`draft-products`/`create`/`update`/`remove` ·
`APP_URL` hardcodeado a `:5000` (`common/constants.ts:1`) · bug del mock
`shop_id`+fuzzy · filtro global de excepciones de Nest.

## Capabilities

### New Capabilities
- `product-listing-api`: listado paginado y filtrado de `/api/products` servido desde Postgres.

### Modified Capabilities
- None (`openspec/specs/` está vacío).

## Approach — decisiones

| # | Tema | Decisión |
|---|------|----------|
| 1 | **Proyección de respuesta** | El mock emite **exactamente 20 claves** por producto (verificado: 1200/1200 con idéntico key-set; sin `description`, `categories`, `tags`, `manufacturer`, `gallery`, `created_at`). El mapper emite esas 20 en ese orden; NO se filtra `ProductRecord` completo. |
| 2 | `in_flash_sale` | **No existe columna** en `db/schema.sql`. Se emite constante `0`. Divergencia real: 1 de 1200 productos (lo lee `apps/shop/src/components/products/cards/helium.tsx:36`). Añadir columna sería cambiar el schema → fuera de scope. |
| 3 | `type.logo` | Sin columna (`types.icon` no es lo mismo); en el mock es `null` en 1200/1200 → constante `null`. |
| 4 | `baseUrl` | Reproducir literal `` `${APP_URL}/products?search=${search}&limit=${limit}` `` (incluye el artefacto `search=undefined`). `buildPaginator` ya clona `paginate.ts`, rareza de `prev_page_url` incluida. |
| 5 | **CA-5** | `try/catch` en `getProducts()` → `ServiceUnavailableException` (503) con `getUserFriendlyMessage`. Un `ExceptionFilter` global cambiaría el error de los ~40 endpoints aún en mock: se descarta por transversal. |
| 6 | **Mapper** | Funciones privadas nombradas en `products.service.ts`, sin archivo nuevo. Con 20 claves (no 35) queda holgado; `products.mapper.ts` se decide en US-3. |
| 7 | `author` | Sin columna en schema/entidad/repositorio. **No soportado**, documentado. La tienda de electrónica nunca lo envía. |
| 8 | `orderBy`/`sortedBy`/`date_range`/`language` | El mock los acepta e ignora. Se preserva: aceptar + ignorar. No se implementa ordenación. |
| 9 | Ranking difuso | `ORDER BY id ASC` vs. fuse.js. Aceptado por **R-2**: se preserva el shape, no el orden. |
| 10 | `popular`/`best-selling` | **Diferido a sdd-design** (la US lo enruta ahí). Recomendación: **quedan en mock**. Evidencia: `sold_quantity = 0` en las 15 filas de ambos JSON → la base no tiene señal de ranking que las reproduzca; además emiten un shape distinto (46 claves). `fuse` y `productsJson` permanecen en el archivo porque estos dos métodos los usan (`products.service.ts:96-112`). |

## Affected Areas

| Área | Impacto | Descripción |
|------|---------|-------------|
| `apps/api/rest/src/products/products.service.ts` | Modified | `getProducts()` + parser + mapper |
| `packages/db/src/repositories/products.integration.test.ts` | Modified | filtros sin cobertura |
| `packages/db/src/repositories/products.repository.ts` | Sin cambios | `ListProductsInput` ya cubre todos los filtros reales |

## Risks

| Riesgo | Prob. | Mitigación |
|--------|-------|-----------|
| R-1: shape de paginación rompe scroll infinito | Baja | `buildPaginator` ya es copia literal; curl antes/después |
| Fuga de claves extra de `ProductRecord` | Media | Mapper con literal explícito; diff de key-sets con `jq` |
| R-2: orden distinto en búsqueda | Alta | Aceptado y documentado |
| Presupuesto de 400 líneas | Media | Ver abajo |

**400-line budget risk: Medium.** ~300 LOC estimadas; la proyección de 20
claves (no 35) reduce el mapper. Un solo PR es viable; si al descomponer en
`sdd-tasks` supera 400, cortar los tests de integración a un PR encadenado.

## Rollback Plan

Cambio confinado a un método de un archivo. `git revert` del commit restaura
`getProducts()`. Los imports `productsJson`/`fuse` **no se eliminan** (los usan
`getPopularProducts`/`getBestSellingProducts`), así que el mock sigue cargado
en memoria y el revert no requiere reinstalar nada: solo `just build-api`.
Ningún cambio de esquema, datos ni frontend que deshacer.

## Dependencies

`just db-up` (Postgres sembrado) · `just db-build` (`packages/db/dist` está gitignored) ·
`yarn install` propio en `apps/api/rest` (fuera del workspace, `package.json:31` usa `link:`).

## Success Criteria

- [ ] CA-1: curl mock vs. Postgres con key-set y tipos idénticos; ids de la página 1 coinciden; única divergencia declarada: `in_flash_sale`.
- [ ] CA-2: `search=name:<x>` resuelve por `contains/insensitive` contra Postgres.
- [ ] CA-3: `just verify` con 3 servicios OK y `cards:30`.
- [ ] CA-4: UPDATE en `just db-shell` + curl + revert, sin reiniciar la API.
- [ ] CA-5: con `just db-down`, 503 con cuerpo JSON legible; el proceso Nest sigue vivo.
- [ ] `just db-check` en verde.

> `just verify` solo golpea `/api/settings`; ejercita `/api/products` de forma
> **indirecta** vía el SSR de la home. La evidencia con `curl` directo contra
> `/api/products` es por tanto **obligatoria**, no opcional.
