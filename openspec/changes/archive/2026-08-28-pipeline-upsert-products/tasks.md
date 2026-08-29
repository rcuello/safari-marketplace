# Tasks: Pipeline upsert en `products` con procedencia (US-6)

## Review Workload Forecast

Estimated changed lines: ~300-330 en `pipelines.py` + ~15 en docs. Delivery strategy: ask-on-risk.

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

**Verificación propia**: `pipelines.py` = 137 líneas (`wc -l`); ~30 intactas
(`parse_numero`, `normalizar_enlace`, `extraer_product_id`, `close_spider`), el
resto se reemplaza y el archivo crece a ~220-240. Consistente con el ~240
"líneas netas" del design (tamaño final, no diff); holgado bajo 400 → PR
único.

## Phase 0: Verificación bloqueante del `ON CONFLICT`

- [x] 0.1 `just db-up`; Postgres listo (`docker compose exec -T postgres pg_isready -U safari -d safari_scraper`)
- [x] 0.2 `db-shell`: `\d products` → `products_procedencia_key (source_store, source_product_id) WHERE source_store IS NOT NULL`
- [x] 0.3 `db-shell`: `INSERT` de prueba con `ON CONFLICT (source_store, source_product_id) WHERE source_store IS NOT NULL DO UPDATE` → sin `42P10`; `DELETE` la fila. Si falla, PARAR

## Phase 1: Helpers y constantes nuevas en `pipelines.py`

- [x] 1.1 `from psycopg.types.json import Jsonb`; `parse_calificacion(valor)`: Decimal 2 decimales, `0 <= v <= 9.99` o `None`
- [x] 1.2 `imagen_jsonb(url)`: `Jsonb({"id": None, "original": url, "thumbnail": url})` o `None`
- [x] 1.3 Constantes `SQL_TYPE_ID`, `SQL_SHOP`/`SQL_MANUFACTURER` (tuplas select/insert)
- [x] 1.4 `_resolver_referencia(sql, cache, nombre)`: get-or-create cacheado por `nombre.strip()`, `None` si vacío
- [x] 1.5 Borrar `UPSERT` (`:47-71`, tabla `productos`); crear `UPSERT_PRODUCT` (SQL del design, `ON CONFLICT` con `WHERE` de la Fase 0, `RETURNING (xmax = 0)` una columna)
- [x] 1.6 `open_spider`: `self.type_id` vía `SQL_TYPE_ID`, `ValueError` fail-fast si `None`; `self.shops`/`self.manufacturers = {}`; 4.º contador `promociones_descartadas`
- [x] 1.7 Docstring de `PostgresPipeline` (`:75-87`): catálogo compartido, no Mongo/`productos`

## Phase 2: Reescritura de `process_item`

- [x] 2.1 Precondiciones (nombre → enlace → `price is None or <= 0`): `warning` + `fallidos` + `return item`
- [x] 2.2 Saneo: `sale_price >= price` → `None`, `warning`, `promociones_descartadas += 1`; el item sigue
- [x] 2.3 Resolver `shop_id`/`manufacturer_id` con `_resolver_referencia`
- [x] 2.4 Construir `fila` (mapeo del design; `image`/`ratings` vía 1.1-1.2); ejecutar `UPSERT_PRODUCT`, `fue_insercion = cur.fetchone()[0]`, sumar `insertados`/`actualizados`
- [x] 2.5 `except psycopg.Error as e`: `e.diag.constraint_name` mapeado (Decisión F), fallback `str(e)`, `fallidos += 1`, sigue la corrida

## Phase 3: Verificación de integración (evidencia de la DoD)

- [x] 3.1 Script sintético en el scratchpad (`test_pipeline.py` no se toca): `SpiderFalso` + items (a)-(h), incluido `precio='0 COP'` (h)
- [x] 3.2 Correr con `DATABASE_URL` del `.env` del scraper; pegar `stats` (`insertados 4, actualizados 1, fallidos 3, promociones_descartadas 1`) y los 4 `warning`
- [x] 3.3 `db-shell`: `SELECT source_store, source_product_id, slug, price, sale_price FROM products WHERE source_store IS NOT NULL ORDER BY id` → CA-1/CA-3
- [x] 3.4 `db-shell`: `count(*)` de `shops`/`manufacturers` de `alkosto`/`acme` → CA-2
- [x] 3.5 `SELECT source_store, count(*) FROM products GROUP BY 1`; `curl :9001/api/products?search=manufacturer.slug:acme&limit=30` (`node -e`, sin `jq`) → CA-5
- [x] 3.6 `just db-check` → sin regresión

## Phase 4: Cierre documental

- [x] 4.1 `docs/product/5-scraper-catalogo-compartido/6-pipeline-upsert-products.md`: `Status:` Implementada, DoD con evidencia (Fase 3)
- [x] 4.2 `docs/product/5-scraper-catalogo-compartido/README.md`: fila US-6 marcada (columna `Status` añadida a la tabla, no existía)

Fuera de alcance: `test_pipeline.py`, `justfile`, spiders, `items.py`,
`db/schema.sql`, `packages/db`, `normalizar_enlace`. `db-test`/`db-count`
seguirán rojos: esperado.
