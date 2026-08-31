# Épico 5 — Scraper al catálogo compartido

> El pipeline del scraper quedó a mitad de la migración: escribe en una tabla
> `productos` que ya no existe. Este épico lo lleva a la tabla `products` del
> catálogo compartido, que es el diseño declarado (y todavía no implementado)
> del repo.

**Fecha:** 2026-08-25
**Status:** Refinado

## Contexto verificado (2026-08-25)

- `services/scraper-worker/schema.sql` es un **tombstone**: declara que el
  scraper no tiene esquema propio y debe escribir en `products` con
  `source_store`/`source_product_id`/`source_url` (índice único parcial para
  upsert idempotente).
- **Pero `pipelines.py` no fue migrado**: su `UPSERT` apunta a
  `INSERT INTO productos (tienda, product_id, nombre, ...)` — una tabla que no
  existe en `db/schema.sql` ni en el seed. Cualquier `just scrape <spider>` o
  `just db-test` falla hoy contra la base con UndefinedTable.
- `just db-count` (justfile:296) también consulta `FROM productos`.
- `test_pipeline.py` prueba el pipeline viejo (columnas en español).
- `db/README.md` define el contrato de adaptación: los retailers se crean como
  `shops`, las marcas como `manufacturers`, `categorizar()` debe devolver los
  slugs del type `gadget` ya existentes, y las filas de `category_product` las
  crea el scraper.
- Decisión de producto **pendiente** (no bloquea este épico, sí la
  presentación de precios): la moneda COP vs USD —
  [`_backlog/moneda-cop-vs-usd.md`](../_backlog/moneda-cop-vs-usd.md).

## Subdivisión en sub-historias

| US | Título | Releasable solo | Depende de | LOC est. | Status |
|----|--------|-----------------|------------|----------|--------|
| [US-6](./6-pipeline-upsert-products.md) | Upsert del pipeline en `products` con procedencia | Sí | ninguna | ~250 | ✅ Implementada |
| [US-7](./7-categorizacion-slugs-catalogo.md) | Categorización a slugs del catálogo + `category_product` | Sí | US-6 | ~200 | ✅ Implementada |
| [US-8](./8-realinear-harness-scraper.md) | Realinear el harness del scraper (`db-test`, `db-count`) | Sí | US-6 | ~150 | |

**Orden sugerido:** US-6 → (US-7 ∥ US-8 con cuidado: US-8 toca
`test_pipeline.py` y US-7 puede tocar el pipeline — no correr dos agentes a la
vez sobre `pipelines.py`).

## Refinamiento — Decisiones tomadas

| # | Tema | Decisión |
|---|------|----------|
| 1 | Dónde escribe el scraper | En `products` del catálogo compartido. Sin tabla propia. Es el diseño ya declarado por el tombstone y `db/README.md`; este épico lo implementa, no lo re-discute. |
| 2 | Identidad | Upsert por `(source_store, source_product_id)` usando el índice único parcial `products_procedencia_key`. |
| 3 | Slug | Generado con la función SQL `slugify()` de la base (no en Python): mismo producto → mismo slug siempre. |
| 4 | Moneda | Los precios se guardan como los entrega el retailer (COP). La decisión de presentación queda en `_backlog/moneda-cop-vs-usd.md`. |

## Visión técnica compartida

### Decisiones de Diseño (D-N)
- **D-1:** Los retailers se resuelven/crean como `shops` y las marcas como
  `manufacturers` al vuelo (get-or-create idempotente), cacheados por corrida.
- **D-2:** El pipeline sigue siendo el único punto de conversión texto→número
  (`parse_numero`); el esquema relacional es el contrato que lo exige.

### Riesgos (R-N)
- **R-1:** `products` tiene CHECK constraints (`products_rebaja_valida`,
  `products_simple_con_precio`, `products_procedencia_completa`): un item
  scrapeado con `sale_price >= price` o sin precio debe manejarse ANTES del
  INSERT o la fila se rechaza. Definir la política (descartar con log vs
  ajustar) en el design de US-6.
- **R-2:** Colisión de slug entre retailers (mismo nombre de producto en dos
  tiendas). `slugify()` es determinista pero el unique de `slug` es global:
  el design de US-6 debe decidir el sufijo de desambiguación.

## Notas globales para los agentes

- `just db-up` + `just db-test` es el ciclo de verificación local; ninguno
  requiere salir a internet.
- No tocar `db/schema.sql`: si el pipeline parece necesitar un cambio de
  esquema, PARAR y reportarlo (el esquema es la fuente de verdad y tiene
  dueño de diseño propio).
