# Tasks: Categorización a slugs del catálogo + `category_product` (US-7)

## Review Workload Forecast

Estimated changed lines: ~75-90 (`pipelines.py` ~65 nuevas + 2 modificadas; docs ~8). Delivery strategy: ask-on-risk.

Decision needed before apply: No
Chained PRs recommended: No
400-line budget risk: Low

**Verificación propia**: `pipelines.py` = 308 líneas (`wc -l`), consistente
con el ~60-70 del design. PR único; sin tarea 0 bloqueante (el `ON CONFLICT`
infiere PK compuesta, validado contra el DDL).

## Phase 1: Fundamentos en `pipelines.py`

- [x] 1.1 `import unicodedata`; `normalizar_texto(valor)`: `str(valor or "")` → NFKD sin combining marks → `.lower().strip()`, junto a `:59-70`.
- [x] 1.2 `RAW_A_SLUG` (8 entradas, Decisión A), `SLUG_RESTO = "accessories-gfa"`, `SLUGS_CATEGORIA: list[str]` (7 slugs, `list` no `set`/`tuple`), junto a `SQL_TYPE_ID` (`:83`).
- [x] 1.3 `KEYWORDS_AUDIFONO` (con las exclusiones deliberadas del design: marcas duales parlante/audífono) + `slug_de_etiqueta(categoria, nombre)`: `"audio"` → keyword sobre `nombre`; si no, `RAW_A_SLUG.get(...)`; `None` si no mapea.
- [x] 1.4 `SQL_CATEGORIA_IDS` (`slug = ANY(%s)`), `DELETE_CATEGORY_PRODUCT`, `INSERT_CATEGORY_PRODUCT` (SQL literal del design).
- [x] 1.5 `open_spider` (`:155-186`): tras `self.type_id`, `self.categorias = dict(cur.fetchall())` vía `SQL_CATEGORIA_IDS`; fail-fast (`ValueError`, cierra conexión) nombrando faltantes.
- [x] 1.6 Docstring de `PostgresPipeline` (`:142-153`): mencionar `category_product`, resolución read-only.

## Phase 2: Puente hacia `category_product` en `process_item`

- [x] 2.1 Misma tarea (Decisión E): `UPSERT_PRODUCT` (`:126`) → `RETURNING id, (xmax = 0) AS fue_insercion`; `:300` → `producto_id, fue_insercion = cur.fetchone()`.
- [x] 2.2 Fuera del `try` (junto a saneos, `:262-273`): `slug = slug_de_etiqueta(...)`; si `None`, `warning` con el valor crudo y `slug = SLUG_RESTO`.
- [x] 2.3 Dentro del MISMO `try`/cursor (`:298-300`), tras `producto_id`: `DELETE_CATEGORY_PRODUCT` seguido de `INSERT_CATEGORY_PRODUCT`, ambos `(producto_id, self.categorias[slug])`.
- [x] 2.4 Confirmar que el `except psycopg.Error` (`:302-306`) ya cubre el puente; no tocar `MENSAJES_CONSTRAINT`.

## Phase 3: Verificación de integración (evidencia DoD)

- [x] 3.1 Script sintético en scratchpad (`test_pipeline.py` fuera de alcance): `SpiderFalso` + 12 items del design (audio×2, `perifericos`, etiqueta inventada, clave ausente).
- [x] 3.2 Corrida 1: pegar `stats` (`insertados: 12, actualizados: 0, fallidos: 0`) y los 2 warnings de fallback.
- [x] 3.3 CA-2: pegar `SELECT c.slug, count(*) FROM category_product cp JOIN categories c ON c.id=cp.category_id GROUP BY 1`.
- [x] 3.4 Corrida 2 (reproceso): `GROUP BY` idéntico, `stats` con `actualizados: 12`.
- [x] 3.5 **Paso 3-bis (D-9)**: renombrar item 5 a "Audifonos JBL Tune 520BT"; `GROUP BY`: `sound-box`→0, `headphone`→2, total 12.
- [x] 3.6 CA-3: `SELECT` join `category_product`/`categories` + `curl :9001/api/products?search=categories.slug:laptop` (`node -e`, sin `jq`).
- [x] 3.7 No regresión: `SELECT count(*) FROM categories` = 198 siempre.

## Phase 4: Limpieza y cierre documental

- [x] 4.1 Limpieza: borrar productos/shop/manufacturer sintéticos + `SELECT` (`shops` 12 / `manufacturers` 14 / `category_product` 0).
- [x] 4.2 `just db-check` verde, salida pegada.
- [x] 4.3 `docs/product/5-scraper-catalogo-compartido/7-categorizacion-slugs-catalogo.md`: `Status:` → Implementada; DoD con evidencia.
- [x] 4.4 `docs/product/5-scraper-catalogo-compartido/README.md:36`: fila US-7 → ✅ Implementada.

Fuera de alcance: categorías nuevas, árbol del seed, spiders, frontend,
`db/schema.sql`, `db/seed.sql`, `items.py`, `test_pipeline.py`/`justfile`
(US-8), `normalizar_enlace`. `db-test`/`db-count` seguirán rojos: esperado.

**Nota pendiente (no es tarea de apply)**: la delta de
`scraper-product-ingestion` reemplaza prosa de cabecera; `openspec-convention.md:65-74`
solo cubre `Requirements`. `sdd-archive` la aplica a mano; extender la
convención es del dueño del repo.
