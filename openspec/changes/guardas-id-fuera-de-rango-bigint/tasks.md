# Tasks: Guardas de id fuera del rango `bigint` (US-31)

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~290 (≈230 propuesta + ~50 integración FK + ~10 README) |
| 400-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Delivery strategy | ask-on-risk |
| Chain strategy | **stacked-to-main** (resuelto por el usuario, 2026-09-14) |

Decision needed before apply: **No — resuelta**
Chained PRs recommended: Yes
Chain strategy: **stacked-to-main**
400-line budget risk: Medium
PR boundary: **3 PRs encadenados** (Unit 1 → PR1, Unit 2 → PR2, Unit 3 → PR3)
size:exception: **no requerida** (~290 estimadas < 400 de presupuesto)

> Decisión del usuario (Ronald) tras el Review Workload Guard: 3 PRs
> encadenados con `stacked-to-main`. Razón: los tres bloques ya son
> verdes-independientes (DD31-F), y el corte protege del sesgo de estimación
> medido del repo (US-27a estimó ~725 / real ~1470; US-28 ~350 / real ~1612)
> — si PR1 se desborda, PR2 y PR3 no se contaminan.

### Suggested Work Units

| Unit | Goal | Likely PR | LOC | Notes |
|---|---|---|---|---|
| 1 | FK + servicios catálogo + tests unit/integración | PR 1 | ~175-215 | independiente |
| 2 | 5 guardas `users` + tests | PR 2 | ~95 | independiente |
| 3 | Enmienda docs US + README | PR 3 | ~45 | recoge evidencia de PR1/PR2 |

## Phase 1: PR1 — Guardas de FK en `packages/db`

- [x] 1.1 `tags.repository.ts:115` y `manufacturers.repository.ts:139` `_assertValidTypeId`: `isInteger` → `isSafeInteger`, sin `<= 0`; comentario local (DD31-C).
- [x] 1.2 `tags.integration.test.ts` (junto a `:101`) y `manufacturers.integration.test.ts` (junto a `:115`): +2 casos c/u — `typeId: 1e21` (regresión) y `-5` con `not.toContain('-5')` (discriminador `P2003`, DD31-E).
- [x] 1.3 `just db-build` y `just db-check` (requiere `just db-up`) en verde; pegar recuento.

## Phase 2: PR1 — Guardas de ruta del catálogo

- [x] 2.1 `types.service.ts:126,151` y `tags.service.ts:170,200` guard `!Number.isSafeInteger(id) || id <= 0`; doc-comment `update` +2 frases c/u, cross-ref → `categories.service.ts:275-293`; 1 línea en `remove`.
- [x] 2.1b **Obligatoria (gate del orquestador).** Borrar la referencia falsa `precedente exacto users.service.ts:94,113,142` de los doc-comments de `types.service.ts:118-124` y `tags.service.ts:162-168`, y sustituirla por el cross-ref a `categories.service.ts:275-293`. Hoy es doblemente falsa: apunta a líneas que esta misma US modifica, y presenta como precedente la versión rota del predicado. Verificar con `grep -rn "users.service.ts:94" apps/api/rest/src/` → sin resultados.
- [x] 2.2 `manufacturers.service.ts:218,254` ídem (sin cross-ref, no lo cita).
- [x] 2.3 `types.service.spec.ts` (`:200`,`:252`), `tags.service.spec.ts` (`:337`,`:443`), `manufacturers.service.spec.ts` (`:334`,`:487`): `it` de `NaN` → `it.each` de 4 casos (DD31-D), testigo `update`/`delete{Type,Tag,Manufacturer}Mock` respectivo.
- [x] 2.4 `cd apps/api/rest && npx jest` en verde; pegar recuento.

## Phase 3: PR2 — Guardas de `users`

- [ ] 3.1 `users.service.ts:94` (`findOne`) guard + doc-comment nuevo (4-6 líneas, ancla de los 5 guards).
- [ ] 3.2 `:113` (`update`), `:142` (`makeAdmin`, string), `:165` (`banUser`, antes del auto-bloqueo), `:211` (`activeUser`): mismo guard + 1 línea c/u.
- [ ] 3.3 `users.service.spec.ts`: `it.each` (`NaN`/`0`/`-5`/`1e21`) `findOne`/`update`, testigo `findUserWithRelationsMock.not.toHaveBeenCalled()` (no status — DD31-E).
- [ ] 3.4 `it.each` `banUser`/`activeUser`: `findUserWithRelationsMock` y `setUserActiveMock` ambos `not.toHaveBeenCalled()`.
- [ ] 3.5 `it.each` de strings (`'abc'`,`'0'`,`'-5'`,`'1e21'`) `makeAdmin`, testigo `grantPermissionMock.not.toHaveBeenCalled()`.
- [ ] 3.6 `cd apps/api/rest && npx jest` en verde; pegar recuento.

## Phase 4: Verificación viva (CA-1, CA-2, DoD)

- [ ] 4.1 `just db-build` → `just build-api` en verde.
- [ ] 4.2 `curl` con Bearer admin (nunca sin token) a las 11 rutas con `1e21`/`0`/`-1`: status exacto 404, no "4xx" genérico; pegar salida.
- [ ] 4.3 `curl` Bearer admin `POST /api/tags`/`manufacturers` con `type_id -1`/`0`/`1e21`: 400 vía `P2003`; `DELETE /api/types/1e16` (rango válido, inexistente): 404 por fila, nunca 400 (CA-2); pegar salidas.
- [ ] 4.4 `just verify` en verde; pegar salida.

## Phase 5: PR3 — Documentación

- [ ] 5.1 Enmendar `docs/product/31-guardas-id-fuera-de-rango-bigint.md` (DD31-G, sin renumerar CA): blockquote, LOC `~230`, `Incluye`/`NO incluye`, CA-1, Gherkin (+1 escenario `users`), tabla de archivos, DoD con evidencia de Fases 1-4, `Status` → `Implementada`.
- [ ] 5.2 Actualizar `docs/product/README.md` (2-3 líneas: agregados cubiertos + LOC real).
