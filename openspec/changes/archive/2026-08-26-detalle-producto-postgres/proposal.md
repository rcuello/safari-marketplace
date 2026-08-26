# Proposal: Detalle de producto y relacionados desde Postgres

> US-3, Épico 1. Insumo: `exploration.md` (misma carpeta).
> Precedente estructural: `openspec/changes/archive/2026-08-25-migrar-api-products-postgres/`.

## Intent

US-2 dejó el listado leyendo Postgres, pero `GET /api/products/:slug` sigue
sirviendo `products.json` (`apps/api/rest/src/products/products.service.ts:210-219`).
Un producto scrapeado aparece en el listado pero **no es navegable en su propia
URL**: el detalle solo conoce los 1200 productos del mock. Además el método es
síncrono y no maneja el slug ausente — `product.type.slug` sobre `undefined`
lanza `TypeError` y Nest devuelve 500 crudo, nunca 404.

## Scope

### In Scope
- `ProductsService.getProductBySlug` → `async`, sobre `findProductBySlug()` de
  `@safari/db` (ya exportado, `packages/db/index.ts:50`).
- `related_products` en la proyección: `toProductDto()` (`products.service.ts:131-165`)
  se reutiliza tal cual para el producto principal y para cada relacionado;
  se añade **una** clave (21 en total).
- `null` → `NotFoundException` (CA-2) + `try/catch` 503/500 igual que
  `getProducts()` (paridad de robustez con el listado ya migrado).
- Ajustar `findProductBySlug()` a la regla de relacionados del mock (ver abajo)
  y actualizar su test de integración.
- Tests jest de `getProductBySlug` en `products.service.spec.ts` (ya existe: 13
  tests, commit `4158798`; `CLAUDE.md` está desactualizado al decir que
  `apps/api/rest` no tiene `*.spec.ts`).
- Cierre documental de la US y fila del épico.

### Out of Scope (vinculante — "NO incluye" de la US)
Reviews / questions / wishlist · listado (US-2) · catálogos de apoyo (US-4) ·
cambios de frontend (`apps/shop/**` ya lee `related_products` del mismo payload:
`apps/shop/src/pages/products/[slug].tsx:65-68`) · `ExceptionFilter` global ·
`db/schema.sql` · `getPopularProducts`/`getBestSellingProducts` (siguen en mock).
Nada de esto se toca aunque sea adyacente y barato.

## Capabilities

### New Capabilities
- `product-detail-api`: `GET /api/products/:slug` desde Postgres — proyección de
  21 claves, regla de relacionados y 404 de dominio.

### Modified Capabilities
- None. La proyección de 20 claves de `product-listing-api` no cambia; el
  detalle la reutiliza sin alterarla.

## Approach — decisiones

| # | Tema | Decisión |
|---|------|----------|
| **D-1** | **Regla de relacionados** | **Replicar el mock exacto**: mismo `type_id`, `ORDER BY id ASC`, `LIMIT 20`, **incluyendo el producto consultado** y **sin filtro de `status`/`visibility`**. Decidido por el usuario tras ver la divergencia: en esta US CA-1 (paridad de contrato) gana sobre la corrección de UX. |
| **D-2** | **Cómo cambiar el repositorio** | Cambiar **el comportamiento de `findProductBySlug()` sin añadir parámetros**: borrar `id: { not: row.id }` y `status`/`visibility` de `products.repository.ts:237-247`. Verificado con `git grep findProductBySlug`: los únicos consumidores son el barrel (`index.ts:50`) y su propio test — **nadie depende del comportamiento actual**. Un flag `{ excludeSelf, onlyPublic }` sería configurabilidad especulativa sin un segundo llamador; una segunda función dejaría muerta la primera. `relatedLimit = 20` se conserva (ya coincide con `.slice(0, 20)` del mock). |
| **D-3** | **El test que hoy afirma lo contrario** | `products.integration.test.ts:191` (`expect(rel.id).not.toBe(sample.id)`) **no se reescribe para ponerlo en verde**: es un cambio de contrato deliberado y aprobado, así que el test pasa a afirmar el contrato equivocado y **se actualiza como parte del change**. Nuevas aserciones: `relatedProducts.map(r => r.id)` **contiene** `sample.id`; ids en orden ascendente; `length <= 20`; todos con `rel.type.slug === sample.type.slug`. Se **elimina** la aserción de exclusión, no se relaja. |
| **D-4** | **404** | `throw new NotFoundException('No existe un producto con slug \`<slug>\`.')` — cuerpo por defecto de Nest: `{"statusCode":404,"message":"...","error":"Not Found"}`. Sin DTO de error propio ni filtro global (mismo criterio local que Decision D de US-2). Mensaje en español, precedente de `settings.service.ts:28`. **Es el primer 404 de dominio del repo** (`git grep NotFoundException apps/api/rest/src` → 0): establece el patrón que copiarán US-4 y siguientes. |
| **D-5** | **Errores de conexión** | `try/catch` con `isPrismaConnectionError`/`getUserFriendlyMessage` → 503/500, idéntico a `getProducts()` (`products.service.ts:200-207`). La US no lo pide como CA, pero omitirlo sería una regresión de robustez frente al listado. El `NotFoundException` se relanza sin envolver. |
| **D-6** | **Mapper** | Sigue como función privada en `products.service.ts`; no se crea `products.mapper.ts` (US-2 lo dejó abierto: con 21 claves sigue sin justificarse el archivo). |

### Consecuencias aceptadas de D-1 (declaradas, no defectos)

| Consecuencia | Observabilidad con el seed actual | Trade-off |
|---|---|---|
| El producto consultado aparece dentro de su propio `related_products` | **Siempre observable** si el slug está entre los 20 primeros de su type | Es lo que hace el mock hoy; el shop ya lo renderiza así |
| Productos `draft`/no públicos pueden salir en `related_products` | **Latente, no observable hoy**: la única fila no-`publish` es `id 454` (`type furniture`) y no cae entre los 20 primeros de su type (ids 412-431); `visibility_private` = 0 filas | Riesgo diferido, no exposición real |

Ambas se revierten con un follow-up trivial (restaurar las tres condiciones del
`where`) si una US posterior prioriza la corrección sobre la paridad.

## Estrategia de paridad de contrato

La línea base del mock para el **detalle** no se preservó (V-5 del
`verify-report.md` de US-2). Doble vía, en este orden:

1. **Capturar antes de tocar código**: con la API todavía en mock,
   `curl -s "http://localhost:9001/api/products/apples?with=..." > openspec/changes/detalle-producto-postgres/mock-apples.json`.
2. **Derivar del JSON fuente** (reproducible sin servidor, y ya validado en la
   exploración): simular `getProductBySlug` sobre
   `apps/api/rest/src/db/pickbazar/products.json`.

**`jq` NO está instalado en este Git Bash**: todo diff de JSON se hace con
`node -e` (comparar `Object.keys` y recorrer campo a campo), como hizo el
`verify-report.md` de US-2.

## Affected Areas

| Área | Impacto | Descripción |
|------|---------|-------------|
| `apps/api/rest/src/products/products.service.ts` | Modified | `getProductBySlug` async + 404 + `related_products` en la proyección |
| `packages/db/src/repositories/products.repository.ts` | Modified | `findProductBySlug`: regla de relacionados = mock (D-2) |
| `packages/db/src/repositories/products.integration.test.ts` | Modified | aserciones invertidas por D-3 |
| `apps/api/rest/src/products/products.service.spec.ts` | Modified | `describe('getProductBySlug')` nuevo |
| `apps/api/rest/src/products/products.controller.ts` | Sin cambios | ya es `async` y tipa `Promise<Product>` |
| `apps/shop/**` | Sin cambios | fuera de alcance y sin necesidad técnica |

## Risks

| Riesgo | Prob. | Mitigación |
|--------|-------|-----------|
| R-1: D-2 degrada el repositorio a una regla "peor" y una US futura la reintroduce sin darse cuenta | Media | Comentario en el `where` citando esta decisión + spec que la declara ratificada |
| R-2: `toProductDto()` es privada y sin red de tipos; un cambio futuro del listado rompe el detalle en silencio | Media | Los tests jest de ambos métodos viven en el mismo archivo y comparten la aserción de key-set |
| R-3: la línea base del mock se vuelve a perder | Media | Vía 2 (derivación desde el JSON) no depende de ningún artefacto capturado |
| ~~R-4: `just db-check` es rojo reproducible en esta máquina~~ **RETIRADO en verify (H-1): premisa falsa heredada de `exploration.md`.** `just db-check` corre limpio (`14 passed`, EXIT=0); `justfile:333` normaliza el cwd desde `083d8e9` | — | El gate oficial SÍ se usa. `cd apps/api/rest && npx jest` sigue siendo el gate de la API (no hay receta `just` para él) |

**400-line budget risk: Low.** ~150 líneas cambiadas: servicio ~45, repositorio
~-6, test de integración ~+8/-3, spec jest ~+80, docs ~10. La US estimaba ~200
LOC asumiendo escribir el repositorio; ya existe. Un solo PR es holgado.

## Rollback Plan

`git revert` del commit único: restaura el cuerpo síncrono de
`getProductBySlug` y el `where` original de `findProductBySlug`. `productsJson`
y `fuse` **no se eliminan** (los siguen usando `getPopularProducts`/
`getBestSellingProducts`), así que el mock permanece cargado y el revert solo
necesita `just db-build && just build-api`. Sin cambios de esquema, datos ni
frontend que deshacer. Si solo falla la regla de relacionados, el rollback
parcial es reponer las tres condiciones del `where` (D-2) sin tocar Nest.

## Dependencies

`just db-up` (Postgres sembrado) · `just db-build` (`packages/db/dist` está
gitignored y el cambio de repositorio obliga a rebuild) · `yarn install` propio
en `apps/api/rest` (fuera del workspace, consume `@safari/db` vía `link:`).

## Success Criteria

- [ ] CA-1: `curl` mock vs. Postgres para el mismo slug — 21 claves idénticas en
      el objeto raíz, 20 en cada relacionado, mismos ids en `related_products`
      (diff con `node -e`, no `jq`).
- [ ] CA-2: `curl -i /api/products/no-existe-xyz` → `404` con
      `{"statusCode":404,"message":...,"error":"Not Found"}`; el proceso sigue vivo.
- [ ] CA-3: `related_products` proviene de Postgres y cumple D-1 (incluye el
      propio producto, sin filtro de status), declarado en el spec.
- [ ] CA-4: `/products/{slug}` de la tienda responde 200 con la API contra Postgres.
- [ ] `cd packages/db && npm test` en verde (con la aserción de D-3 actualizada).
- [ ] `cd apps/api/rest && npx jest` en verde.
- [ ] Status de la US y fila del épico actualizados.

## Open Questions

Ninguna. La única decisión abierta que dejó la exploración (regla de
relacionados) la resolvió el usuario en D-1; D-2 y D-3 se derivan de ella con
verificación en código.
