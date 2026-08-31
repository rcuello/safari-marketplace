# Delta for Scraper Product Ingestion

> **Nota de convención — leer antes de archivar.** `openspec-convention.md`
> solo define secciones de delta para `## ADDED/MODIFIED/REMOVED/RENAMED
> Requirements`; no define un mecanismo de merge para prosa de cabecera
> (`Purpose`, `Out of Scope`). Este proposal exige levantar la exclusión de
> categorización tanto en `Purpose` (`spec.md:10`) como en `Out of Scope`
> (`spec.md:135`), que son prosa, no un `Requirement`. Como el convention no
> cubre ese caso, esta delta lo resuelve con la sección no estándar de abajo
> y lo declara explícitamente en el reporte de esta fase — ver
> `risks`/`next_recommended` del envelope de retorno. Propuesta de resolución:
> extender `openspec-convention.md` con `## MODIFIED Purpose` / `## MODIFIED
> Out of Scope` como secciones válidas de reemplazo íntegro de texto, para
> que `sdd-archive` sepa aplicarlas mecánicamente igual que hace con
> `MODIFIED Requirements`. Hasta que exista esa sección formal, `sdd-archive`
> MUST aplicar el reemplazo de abajo a mano al promover este change.

## MODIFIED Purpose (no-estándar — ver nota arriba)

Reemplaza el `Purpose` completo de `openspec/specs/scraper-product-ingestion/spec.md`:

> `PostgresPipeline` ingiere items scrapeados de 6 retailers en el catálogo
> compartido de Postgres (`products`, `shops`, `manufacturers`), identificados
> por procedencia (`source_store`, `source_product_id`) para que re-scrapear
> no duplique filas y queden visibles por los canales del catálogo. Cubre
> idempotencia, descarte/saneo ante datos inválidos, no regresión del seed y
> — desde US-7 — la extensión de `fallidos` cuando el insert puente hacia
> `category_product` (ejecutado en la misma transacción de `process_item`)
> falla. La traducción de la etiqueta cruda a un slug del catálogo y la
> materialización de esa relación viven en `scraper-product-categorization`,
> no aquí. NO cubre spiders ni `normalizar_enlace`.

(Previously: "NO cubre categorización, spiders, ni `normalizar_enlace`.",
sin mención del insert puente ni de la extensión de `fallidos`.)

## MODIFIED Out of Scope (no-estándar — ver nota arriba)

Reemplaza la lista completa de `## Out of Scope`:

> La traducción de etiqueta a slug y la fila de `category_product`
> (capability `scraper-product-categorization`, US-7) · `test_pipeline.py`/
> `justfile` (US-8) · spiders, `items.py`, moneda · `db/schema.sql` ·
> `packages/db` · `normalizar_enlace` (D-5, elevada al dueño del repo).

(Previously: "Categorías (US-7) · `test_pipeline.py`/`justfile` (US-8) ·
spiders, `items.py`, moneda · `db/schema.sql` · `packages/db` ·
`normalizar_enlace` (D-5, elevada al dueño del repo)." — la exclusión era de
"Categorías" en bloque; ahora se acota a la lógica de mapeo y a la fila
puente, ya que la semántica de `fallidos` de este capability sí cambia.)

## MODIFIED Requirements

### Requirement: Captura de violaciones de constraint no anticipadas

Cualquier error de Postgres no cubierto por las precondiciones anteriores
(p. ej. overflow en `price`) MUST capturarse, loguearse, incrementar
`stats["fallidos"]`, y la corrida MUST continuar. Esta captura MUST también
cubrir el fallo del insert puente hacia `category_product`
(`scraper-product-categorization`), que corre dentro de la misma frontera
transaccional (`try`) que el upsert de `products`: si ese insert falla,
MUST contarse en `fallidos` aun cuando la fila de `products` ya haya sido
confirmada por `autocommit`.

(Previously: cubría solo errores de Postgres sobre el propio upsert de
`products`, ilustrado con overflow de `price`; no existía un insert puente
hacia `category_product` porque la categorización no estaba implementada.)

#### Scenario: Un item con datos fuera de rango no aborta la corrida
- WHEN se procesa un item cuyo precio produce overflow numérico
- THEN el item se descarta, el error queda logueado y el siguiente se procesa con éxito

#### Scenario: Fallo del insert puente cuenta en fallidos aunque el producto ya esté persistido
- GIVEN un item cuyo upsert en `products` se confirma correctamente
- WHEN el insert subsiguiente en `category_product` falla
- THEN el item incrementa `stats["fallidos"]`, la fila de `products` permanece persistida, y la corrida continúa con el siguiente item
