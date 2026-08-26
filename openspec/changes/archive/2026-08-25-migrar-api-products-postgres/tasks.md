# Tasks: Migrar `/api/products` (listado) a Postgres vía `@safari/db`

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~190–230 (service ~125; tests ~75; docs ~10) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|---|---|---|---|
| 1 | Todo el cambio (service + tests + docs) | PR único | Slice natural si crece: Phase 3 (tests) aparte |

## Phase 1: Precondiciones y baseline

- [x] 1.1 `just db-up` — contenedor `safari-postgres` ya estaba Up (healthy) en :5433
- [x] 1.2 `just db-build` (dist gitignored) — `packages/db/dist` ya existía (index.js/index.d.ts), no se reconstruyó
- [x] 1.3 `yarn install` en `apps/api/rest` si falta — `node_modules` ya presente, no hizo falta
- [x] 1.4 API sobre el mock: `just api-dev` — levantada en background, `Application is running on: http://[::1]:9001/api`
- [x] 1.5 Baseline ANTES del cambio (irrepetible después sin stash): capturado en `mock.json` (repo root) — `total:1199 per_page:"30" data.length:30`, 20 claves en el orden esperado. NOTA: `jq` no está disponible en este Git Bash; CA-1 se verificó con `node -e` en vez de `jq -S` (mismo resultado semántico, ver Phase 4)

## Phase 2: Implementación — `apps/api/rest/src/products/products.service.ts`

- [x] 2.1 `parseProductSearch(search)`: función privada; trocea por `;` y primer `:`; aplica la tabla `search`→`ListProductsInput` del design; descarta `slug`; ignora el resto sin error
- [x] 2.2 `toProductDto(record)`: función privada, literal de 20 claves snake_case, orden del design; `type.logo`/`in_flash_sale` constantes; cast a `Product`
- [x] 2.3 `getProducts()` async: conservar literal `if (!page) page = 1; if (!limit) limit = 30;`; a `listProducts()` valores numéricos (`Number(page) || 1`, `Number(limit) || 30`); a `paginate()` y la URL valores crudos, sin convertir
- [x] 2.4 Try/catch en `await listProducts(input)`: conexión caída → 503 `ServiceUnavailableException`; resto → 500 `InternalServerErrorException`; ambos con `getUserFriendlyMessage` del barrel `packages/db/index.ts`

## Phase 3: Tests de integración — `packages/db/src/repositories/products.integration.test.ts`

- [x] 3.1 Test `shopId`: `listProducts({ shopId })` sobre un shop del seed → `total>0`, todo item con ese `shopId`
- [x] 3.2 Test `manufacturerSlug`: fixture `upsertScrapedProduct({ manufacturerId: M_FIX.id, price>0, salePrice<price })`; `M_LIBRE.slug`→`total===0`; `M_FIX.slug`→`total===1`, `sourceStore===TEST_STORE`
- [x] 3.3 Test `tagSlug`: misma fixture, `tagIds: [T_FIX.id]`; `T_LIBRE.slug`→`total===0`; `T_FIX.slug`→`total===1`
- [x] 3.4 `just db-check` en verde — 14/14 tests pasan (11 previos + 3 nuevos)

## Phase 4: Verificación — evidencia de la DoD (CA-1..CA-5)

- [x] 4.1 Levantar la API sobre Postgres (`just build-api`/`just api-dev`), capturar `pg.json` con la query de 1.5 — hecho con `just api-dev` (watch mode recompiló solo)
- [x] 4.2 CA-1: diffs (envoltorio, key-set, ids, completo — `jq` no disponible, sustituido por `node -e` con la misma semántica); único diff esperado: id 2 `in_flash_sale` 1→0 — CONFIRMADO
- [x] 4.3 CA-2: `curl search=name:apple;status:publish;visibility:visibility_public` → `total:17`, no 20 (divergencia #8) — CONFIRMADO
- [x] 4.4 CA-3: `just verify` → 3 servicios OK, cards:30 — CONFIRMADO (primera corrida falló por timeout de compilación SSR en frío de Next dev; segunda corrida en verde)
- [x] 4.5 CA-4: `docker exec ... psql UPDATE...name='CANARIO'` → curl sin reiniciar → revertir — CONFIRMADO
- [x] 4.6 CA-5: `just db-down` → curl 503 + body legible; `/api/types` en 200 (proceso vivo); `just db-up` — CONFIRMADO

## Phase 5: Divergencias — evidencia para `verify-report.md`

- [x] 5.1 `curl search=name:apple;shop_id:6` → 12 filas en Postgres (divergencia #9) — CONFIRMADO. CORRECCIÓN post-verify (V-2): el mock daba **20**, no 0 (`shop_id` se descarta en silencio, resultado idéntico a `name:apple` solo); el cambio real es 20→12, no 0→12. Ver `apply-progress.md` batch 2
- [x] 5.2 `curl search=min_price:50;status:publish;visibility:visibility_public` → `total:195` (divergencia #10, visible) — CONFIRMADO
- [x] 5.3 Consolidar para `sdd-verify` las 10 divergencias de `design.md` (incluida #8) — ver evidencia en `apply-progress.md`

## Phase 6: Cierre documental (DoD punto 5)

- [x] 6.1 `docs/product/1-catalogo-desde-postgres/2-migrar-api-products-postgres.md`: campo Status → "Implementada", DoD (5 items) marcada
- [x] 6.2 `docs/product/1-catalogo-desde-postgres/README.md`: fila de US-2 marcada "✅ Implementada" (columna Status añadida a la tabla); Status del épico → "En ejecución"

## Phase 7: Batch de seguimiento post-verify (V-2, V-3) — reapertura autorizada

- [x] 7.1 Fix V-3 (regresión): `parseFiniteNumber()` en `products.service.ts` — un token `shop_id`/`min_price`/`max_price` con valor no numérico se ignora (`Number.isFinite`) en vez de colar `NaN` hasta Prisma; ya no produce 500. Verificado: `shop_id:abc`/`min_price:abc`/`max_price:abc` → 200 (antes 500); `shop_id:6`/`min_price:50` siguen en 200
- [x] 7.2 Cobertura de V-3: no se agregó test unitario de `parseProductSearch` (función privada de módulo, `apps/api/rest` sin runner con specs — restructurarla para exportarla revocaría la Decision C sin que el reopen lo pida). Se registra como evidencia curl pegada en `apply-progress.md`, sin fingir cobertura automatizada
- [x] 7.3 Fix V-2 (cifra incorrecta): corregidas todas las menciones de "mock 0 filas" para `shop_id`+otro filtro en `design.md` (tabla de divergencias, sección "Parseo search", detalle #9), `specs/product-listing-api/spec.md` (tabla, párrafo de divergencias, escenario Gherkin) y `tasks.md` (5.1) → cifra real: mock **20**, Postgres **12**
- [x] 7.4 Adición V-2: divergencia #3 aclarada como 86 filas totales / **85 observables** vía el endpoint (id 454, type 6, `status:draft`, es la única no observable) en `design.md` y `spec.md`
- [x] 7.5 `just db-check` re-ejecutado tras el fix — verde
- [x] 7.6 Batch registrado en `apply-progress.md` (mergeado con el contenido previo, no sobrescrito) y `state.yaml` actualizado
