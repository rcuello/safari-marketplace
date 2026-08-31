# Proposal: Categorización a slugs del catálogo + filas en `category_product`

> **US-7**, Épico 5 (`docs/product/5-scraper-catalogo-compartido/7-categorizacion-slugs-catalogo.md`).
> Insumo: `explore.md` de esta carpeta. Precedente ya embarcado y heredado:
> `openspec/changes/archive/2026-08-28-pipeline-upsert-products/` (US-6, `design.md`).

## Intent

US-6 dejó los productos scrapeados en `products` **sin ninguna categoría**:
`category_product` sigue como la dejó el seed, "deliberadamente VACÍA"
(`db/seed.sql:1649-1651`, sin un solo `INSERT`). El filtro por categoría ya sale de
Postgres —`apps/api/rest/src/products/products.service.ts:83-84` mapea el token
`categories.slug:<slug>` a `input.categorySlug`, y
`packages/db/src/repositories/products.repository.ts:175-177` lo traduce a
`categories: { some: { category: { slug } } }`— o sea que **devuelve cero por falta de
filas puente, no por falta de endpoint**. Mientras tanto los 6 spiders emiten etiquetas
libres en español (`computadores`, `celulares`, `audio`, …) sin correspondencia con el
catálogo. US-7 cierra ese tramo.

## Scope

### In Scope

| Entrega | Detalle |
|---|---|
| Mapeo raw→slug centralizado | Diccionario en `pipelines.py` para las **9 etiquetas crudas** que llegan a `process_item` (`computadores`, `celulares`, `tablets`, `pantallas`, `impresoras`, `audio`, `consolas`, `perifericos`, `otros`) → slugs del type `gadget` |
| Resolución slug→`category_id` | `SELECT` **read-only**, una vez por corrida en `open_spider`, cacheado, fail-fast si falta un slug — patrón de `SQL_TYPE_ID` (`:83`, `:167-176`), **no** el get-or-create de `_resolver_referencia` (`:192-225`): no se crean categorías |
| `RETURNING` ampliado | `UPSERT_PRODUCT` (`:101-127`) expone el `id` además de `(xmax = 0)`, con el desempaquetado corregido en el mismo commit (`:300`) |
| Insert idempotente en `category_product` | `ON CONFLICT (product_id, category_id) DO NOTHING`, **dentro del `try`** de `process_item` (`:279-306`): preserva la invariante `insertados + actualizados + fallidos == procesados` |
| Fallback logueado | Etiqueta desconocida **y `categoria` ausente/`None`** → `accessories-gfa` |
| Docs de estado | Status de US-7 + fila del épico |

### Out of Scope (vinculante — el "NO incluye" de la US)

Crear categorías nuevas · cambiar el árbol del seed · la lógica de scraping/selectors de
los 6 spiders (incluido reescribir sus `categorizar()`) · el frontend · `db/schema.sql` ·
`db/seed.sql` · `items.py` (el campo `categoria` ya existe en los 6 Items:
`items.py:11,25,34,44,53,64`) · `test_pipeline.py` y el `justfile` (**US-8**) ·
`normalizar_enlace` (D-5 de US-6).

**`just db-test` y `just db-count` seguirán rojos al cerrar esta US**: estado heredado de
US-6, no regresión — los arregla US-8.

## Capabilities

### New Capabilities

- `scraper-product-categorization`: traducción determinista de la etiqueta cruda del
  spider a un slug existente del type `gadget` + materialización idempotente de la
  relación en `category_product`, con slug de resto para lo no mapeable.

### Modified Capabilities

- `scraper-product-ingestion`: se levanta su exclusión explícita de categorización
  (`spec.md:10` y su `Out of Scope`: "Categorías (US-7)"), y la semántica de los
  contadores se extiende: un fallo del insert puente cuenta el item en `fallidos` aunque
  su fila de `products` haya persistido.

## Approach

**Approach 1 de la exploración: mapeo centralizado en `pipelines.py`. Se adopta.**
Evidencia: las 9 etiquetas crudas ya son **consistentes** entre los 6 spiders (mismo
vocabulario, sin sinónimos cruzados; solo Falabella añade `perifericos`) y llegan bajo
una clave uniforme, `datos.get("categoria")`. El diccionario es de 9-10 entradas.

Se descarta el Approach 2 (reescribir `categorizar()` en los 6 spiders): la US prohíbe
tocar su lógica, no resuelve la ambigüedad de `audio` (la repetiría en 6 sitios) y
multiplica por 6 la superficie del diff. Se preserva de US-6 el `try/except
psycopg.Error` con `MENSAJES_CONSTRAINT` vía `e.diag.constraint_name` (`:302-306`).

**Refutación de una premisa del enunciado**: no hay jerarquía que propagar. Las 10
categorías de `gadget` son raíces hoja (`db/seed.sql:71` no incluye `parent_id`; el
`UPDATE` que sí lo fija, `:275-393`, no toca los ids 180/181/182/198-204), confirmado por
`categories.integration.test.ts:101-103` (`expect(rootsOnly.total).toBe(10)`). No hace
falta insertar la categoría padre.

## Mapeo de criterios de aceptación

| CA | Qué lo entrega |
|---|---|
| **CA-1** solo slugs del catálogo | Diccionario cerrado raw→slug resuelto contra `category_id` reales (fail-fast) + fallback a `accessories-gfa` logueado, para etiqueta desconocida y para `categoria` ausente/`None`. Ninguna categoría se crea |
| **CA-2** fila idempotente | `PRIMARY KEY (product_id, category_id)` (`db/schema.sql:308-312`) **es** el índice único que soporta `ON CONFLICT … DO NOTHING`: idempotencia sin lógica extra |
| **CA-3** el filtro devuelve resultados | Las filas caen en la tabla que `products.repository.ts:175-177` ya consulta: verificable por `SELECT` y por `GET /api/products?search=categories.slug:<slug>` |

## Decisiones abiertas — las cierra `design.md`, NO este proposal

1. **Desambiguación de `audio` → `headphone` vs `sound-box`.** Ningún spider distingue
   auriculares de parlantes: la etiqueta cruda es un único bucket (ver
   `tauretcomputadores.py:180-189`, donde ambas familias de keywords devuelven `audio`).
   Sin regla explícita (keywords sobre `nombre`), uno de los dos slugs queda
   **permanentemente vacío** pese a existir en el catálogo.
2. **Aceptar que 3 de 10 slugs quedan sin productos del scraper.** `camera`, `router` y
   `smart-watch` no son alcanzables con el vocabulario actual (los smartwatches de
   `exito.py:239-241` caen en `otros`); distinguirlos exigiría tocar los spiders, fuera
   de scope. Declararlo para que no se lea como CA-1 incumplido.
3. **Cómo ampliar el `RETURNING` de `UPSERT_PRODUCT`.** Hoy es de una sola columna **a
   propósito**: el design de US-6 (`design.md:333-338`) documenta que con dos columnas
   `cur.fetchone()[0]` leería la columna equivocada y **todo item se contaría como
   insertado**. US-7 rompe esa invariante deliberadamente porque necesita el `id` como
   FK: el design debe re-declarar la justificación y fijar el desempaquetado
   (`producto_id, fue_insercion = cur.fetchone()`), no añadir una columna sin más — ese
   desempaquetado posicional es donde US-6 tuvo un bloqueante.

## Affected Areas

| Área | Impacto | Descripción |
|---|---|---|
| `services/scraper-worker/pipelines.py` | Modified | Único archivo de producción: dict raw→slug, caché de `category_id` en `open_spider`, `RETURNING id`, insert en `category_product` |
| `docs/product/5-scraper-catalogo-compartido/7-…md` y `README.md` | Modified | Status de la US y fila del épico |

Todo lo demás queda intacto: ver Out of Scope.

## Risks

| Riesgo | Prob. | Mitigación |
|---|---|---|
| `audio` sin regla → `headphone` o `sound-box` queda vacío para siempre | Alta | Decisión abierta 1; sin cerrarla, `sdd-apply` no debe escribir el `if` |
| `RETURNING` ampliado sin corregir el desempaquetado → `stats` mentiroso (todo "insertado") | Alta | Decisión abierta 3; la evidencia de CA-2 lo detecta: exige `actualizados >= 1` |
| Etiqueta ausente/`None` por un cambio futuro de spider (fallthrough latente, `tauretcomputadores.py:189`) | Media | El fallback a `accessories-gfa` cubre también `None`, no solo etiquetas desconocidas |
| Los datos sintéticos rompen `just db-check` | Media | **Limpieza obligatoria antes del gate**: `shops.integration.test.ts:19` asserta `toBe(12)` y `manufacturers.integration.test.ts:18` `toBe(14)`, y los sintéticos crean ambos. `category_product` no lo asserta ningún test (grep sin resultados) |
| Sin gate automatizado (`db-test` roto hasta US-8) | Media | Script de scratchpad + `db-shell` + `curl`, con salida real pegada |

## LOC forecast y presupuesto de review

`pipelines.py` (308 líneas hoy) crece **~40-60 líneas** — dict + resolución + insert +
`RETURNING`; más ~10 de docs = **~70**. La US estimaba ~200 asumiendo tocar los 6
spiders; el mapeo centralizado lo evita. **PR único, holgado bajo el guard de 400
líneas**: `400-line budget risk: Low`. `ask-on-risk` no debería dispararse por tamaño;
sí podría hacerlo la decisión 1 (política de datos).

## Rollback Plan

- **Código**: `git revert` del commit. El pipeline vuelve al comportamiento de US-6
  (productos sin categoría), el estado embarcado y funcional hoy: no se pierde ninguna
  capacidad previa.
- **Datos**: puramente aditivo sobre una tabla que el seed deja vacía.
  `DELETE FROM category_product;` deja el sistema como lo entrega `just db-up`. Las
  filas puente de los productos de prueba se borran solas al borrar los productos
  (`ON DELETE CASCADE` en ambas FKs, `db/schema.sql:308-312`), así que
  `DELETE FROM products WHERE source_store IS NOT NULL;` basta. En caso extremo,
  `just db-reset`.
- **Sin cambios de esquema, dependencias ni build**: `services/scraper-worker` no
  participa de ningún build; no hay `just db-build` ni `yarn install` que rehacer.

## Dependencies

`just db-up` (Postgres 5433 sembrado) · `just scraper-install` · `DATABASE_URL` en
`services/scraper-worker/.env` · **US-6 embarcada** (`f727794`) · API en el 9001 para la
vía HTTP de CA-3 · **`design.md` con las 3 decisiones abiertas cerradas — bloqueante para
`sdd-apply`**.

## Success Criteria (evidencia de la Definición de Done)

`test_pipeline.py` está fuera de alcance: la corrida sintética sale de un **script
temporal en el scratchpad** que instancia `PostgresPipeline` con un spider falso, sin
salir a internet. Puerto 9001 (el 9000 es Zscaler); `jq` **no está instalado** — usar
`node -e`.

- [ ] **CA-1**: items de las ~9 etiquetas crudas + uno con etiqueta inventada + uno
      **sin** `categoria` → los dos últimos en `accessories-gfa`, con la línea de log
      del fallback pegada. Ninguna categoría nueva: `SELECT count(*) FROM categories`
      idéntico antes y después.
- [ ] **CA-2**: `SELECT c.slug, count(*) FROM category_product cp JOIN categories c ON c.id = cp.category_id GROUP BY 1`
      pegado; reprocesar los mismos items deja los conteos **idénticos** y `stats`
      muestra `actualizados >= 1` (prueba de que el desempaquetado del `RETURNING` es
      correcto).
- [ ] **CA-3**: `GET /api/products?search=categories.slug:<slug>` devuelve los productos
      scrapeados de esa categoría (`curl` + `node -e`). **No existe un query param
      `category=`** — esa forma del enunciado de la US es una simplificación.
- [ ] **Limpieza + gate**: borrar los datos sintéticos (productos, `shops` y
      `manufacturers` de prueba) y luego `just db-check` verde, con salida pegada.
- [ ] Status de US-7 actualizado y su fila del épico marcada.

## Observaciones fuera de alcance (detectadas, NO accionadas)

- La tabla de mapeo de `db/README.md:51-61` **no tiene renglón propio** para 4 de las 9
  etiquetas reales (`tablets`, `impresoras`, `perifericos`, `otros`): caen al resto por
  CA-1. Coincide con el seed; la doc quedaría más clara actualizada. No accionado.
- `tauretcomputadores.py:164-189`: `categorizar()` no tiene `return` final fuera del
  último `if` → `None` implícito si `categoria_destino` no está en `self.CATEGORIAS`
  (`:15-20`). **Inalcanzable hoy**; el fallback del pipeline lo neutraliza sin tocar el
  spider.
