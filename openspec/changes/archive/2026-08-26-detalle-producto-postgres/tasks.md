# Tasks: Detalle de producto y relacionados desde Postgres (US-3)

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~150 (servicio ~45, repositorio ~-6, test integración ~+8/-3, spec jest ~+80, docs ~10) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | PR único |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|---|---|---|---|
| 1 | Todo el cambio (repositorio + servicio + tests + docs) | PR único | ~150 líneas, muy por debajo del budget de 400; no se justifica trocearlo |

## Phase 1: Baseline (ANTES de tocar código)

- [x] 1.1 Capturar `$CH/mock-apples.json` con la API aún en mock (paso 0 obligatorio del design, mitiga R-3):
  `CH=openspec/changes/detalle-producto-postgres`
  `curl -s "http://localhost:9001/api/products/apples?language=en&searchJoin=and&with=categories;shop;type" > $CH/mock-apples.json`
  Fallback sin servidor: `node -e "..."` (design.md, Verification Plan, vía 2)
  — API no estaba levantada en 9001; se usó el fallback vía 2. 21 claves raíz, 20 related con 20 claves c/u.
- [x] 1.2 `just db-up` (Postgres sembrado) — contenedor ya estaba `Up (healthy)`; se reaplicó schema+seed sin error.

## Phase 2: `packages/db` — regla de relacionados (D-1/D-2/D-3)

- [x] 2.1 `products.repository.ts:237-247`: `where` → `{ typeId: row.typeId }` (borrar `id: { not: row.id }`, `status`, `visibility`) + comentario citando D-1 (design.md Decisión A)
- [x] 2.2 `products.repository.ts:103`: actualizar comentario de `ProductDetail.relatedProducts` (deja de decir "excluyendo el propio")
- [x] 2.3 `products.integration.test.ts:181-195` (D-3): borrar `expect(rel.id).not.toBe(sample.id)` (línea 192); añadir `ids.toContain(sample.id)`, orden ascendente, `length<=20`, `rel.type.slug === sample.type.slug`; renombrar el `it` a "…related del mismo type, INCLUYENDO el propio producto (D-1)"; el `it` de slug inexistente (196-198) no se toca
- [x] 2.4 Evidencia (CA-3, regla en la consulta): `cd packages/db && npm run typecheck && npm test` — typecheck limpio; 14/14 tests en verde.

## Phase 3: Rebuild obligatorio (bloqueante — orden del design, paso 5)

- [x] 3.1 `just db-build` — sin este paso `packages/db/dist/` (gitignored, consumido por Nest vía `link:`) sigue con el `where` viejo y CA-1/CA-3 fallan sin motivo aparente. Build en verde (prisma generate + tsup).

## Phase 4: `apps/api/rest/src/products/products.service.ts`

- [x] 4.1 Imports (líneas 1-13): añadir `NotFoundException` de `@nestjs/common`; `findProductBySlug` y `type ProductDetail` de `@safari/db`
- [x] 4.2 `getProductBySlug` (líneas 210-219) → `async`: `try` envuelve SOLO `await findProductBySlug(slug)` (503/500 igual que `getProducts()`); `if (!detail) throw new NotFoundException(...)` FUERA del try (Decisión B, nunca dentro); return `{ ...toProductDto(detail), related_products: detail.relatedProducts.map(toProductDto) } as unknown as Product` (clave 21, Decisión C); `toProductDto()` no se modifica

## Phase 5: Tests jest — `products.service.spec.ts`

- [x] 5.1 Factory `jest.mock('@safari/db', …)`: añadir `findProductBySlug: jest.fn()`
- [x] 5.2 `EXPECTED_DETAIL_KEYS = [...EXPECTED_KEYS, 'related_products']` + `makeProductDetail(overrides)` envolviendo `makeProductRecord()`
- [x] 5.3 Test 1 (CA-1): 21 claves exactas y en orden — `Object.keys(result)` === `EXPECTED_DETAIL_KEYS`
- [x] 5.4 Test 2 (CA-1): cada relacionado trae 20 claves y ningún `related_products` propio
- [x] 5.5 Test 3: pasa el slug crudo al repositorio — `toHaveBeenCalledWith('apples')`, `toHaveBeenCalledTimes(1)`
- [x] 5.6 Test 4 (CA-1): `relatedProducts: []` → `related_products: []`, sigue con 21 claves
- [x] 5.7 Test 5 (CA-2): `null` → `NotFoundException` 404, mensaje español con el slug, `not.toBeInstanceOf(InternalServerErrorException)` (D-5: no envuelto por el catch)
- [x] 5.8 Test 6 (D-5, sin CA): error de conexión → 503 (copia patrón de spec.ts:381-401)
- [x] 5.9 Test 7 (D-5, sin CA): otro error → 500 (copia patrón de spec.ts:403-417)
- [x] 5.10 Evidencia: `cd apps/api/rest && npx jest` — 13 tests previos + 7 nuevos en verde (20/20 total).

## Phase 6: Verificación E2E — CA-1, CA-2, CA-3

- [x] 6.1 `just build-api` (o reiniciar `just api-dev`) — se levantó `just api-dev` en background (puerto 9001, contra Postgres 5433). `just build-api` no se ejecutó por separado porque `api-dev` ya sirve la versión actual del código.
- [x] 6.2 CA-1: `curl -s "http://localhost:9001/api/products/apples" > $CH/pg-apples.json`; diff con `node -e` contra `$CH/mock-apples.json` — raíz 21->21, mismo orden true, faltan/sobran [], related 20/20 mismos ids 1..20, 0 items con shape malo.
- [x] 6.3 CA-2: 404 con `{"statusCode":404,"message":"No existe un producto con slug \`no-existe-xyz\`.","error":"Not Found"}`; `GET /api/types` sigue en 200 después (proceso vivo).
- [x] 6.4 CA-3: `self incluido: true`.

## Phase 7: Verificación E2E — CA-4 (shop)

- [x] 7.1 `just shop-dev` (otra terminal, modo dev — ISR corre por request); `curl -s -w '\n%{http_code}\n' http://localhost:3003/en/products/apples | grep -c 'Apples'` → 200 y HTML contiene "Apples" (grep -c → 1). Primer request tardó ~90s en compilar la ruta `/products/[slug]` (2467 módulos); requests posteriores respondieron en segundos.

## Phase 8: Cierre documental (DoD)

- [x] 8.1 `docs/product/1-catalogo-desde-postgres/3-detalle-producto-postgres.md`: campo **Status** → "Implementada"; marcar los 5 ítems de la Definición de Done con la evidencia de las Phases 1-7
- [x] 8.2 `docs/product/1-catalogo-desde-postgres/README.md`: fila de US-3 en la tabla → "✅ Implementada"

## Phase 9: Correcciones post-verify (H-1, H-2, H-3)

Los tres WARNING del `verify-report.md` eran de prosa, no de código. Aprobados
por el usuario y aplicados por el orquestador:

- [x] 9.1 H-3: `specs/product-detail-api/spec.md` — el requirement decía como MUST
  absoluto "incluyendo el producto consultado". Reformulado a "sin excluir el
  producto consultado", con el dato medido: la auto-inclusión ocurre solo si el id
  cae entre los 20 primeros de su `type` (195/1200 productos, 16,25 %). Es la frase
  que se fusiona en `openspec/specs/` al archivar.
- [x] 9.2 H-2: `products.repository.ts:223-226` — el JSDoc de `findProductBySlug`
  seguía diciendo "mismo type, visibles"; la task 2.2 solo había corregido la
  línea 103. Actualizado (era el vector exacto de R-1).
- [x] 9.3 H-1: la DoD de la US cerraba el ítem de `just db-check` con una
  justificación FALSA (supuesto rojo por casing del cwd). El gate corre limpio
  desde `083d8e9` (`justfile:333` normaliza con `cd "$(pwd)"`). Sustituida por la
  salida real, y la premisa purgada de `exploration.md` (su origen), `proposal.md`
  (R-4 retirado), `design.md` y `apply-progress.md`.
