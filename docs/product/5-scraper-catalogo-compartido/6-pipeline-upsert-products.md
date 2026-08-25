# US-6 — Upsert del pipeline en `products` con procedencia

> Migrar `PostgresPipeline` de la tabla muerta `productos` a la tabla
> `products` del catálogo compartido, con upsert idempotente por procedencia y
> retailers/marcas como `shops`/`manufacturers`.

**Épico:** [Épico 5](./README.md)
**Fecha:** 2026-08-25
**Status:** Listo para ejecución
**Depende de:** ninguna
**LOC est.:** ~250

## Historia
**Como** estudiante que corre un spider, **quiero** que lo scrapeado quede en
la misma tabla `products` que consulta la tienda, **para** que el flujo
scraper → base → tienda deje de ser una promesa de los READMEs y sea
observable en la app.

## Contexto

- `services/scraper-worker/pipelines.py` upserta hoy en `productos`
  (columnas en español: `tienda`, `product_id`, `nombre`, …), tabla que no
  existe en `db/schema.sql`. El pipeline está roto contra la base actual.
- El contrato de destino está escrito: tombstone
  `services/scraper-worker/schema.sql` + `db/README.md` (procedencia
  `source_*`, retailers como shops, marcas como manufacturers).
- El unique parcial `products_procedencia_key (source_store,
  source_product_id) WHERE source_store IS NOT NULL` ya existe para el upsert.

## Scope
**Incluye:** reescritura del mapeo item→fila en `pipelines.py` (upsert en
`products` vía `ON CONFLICT` sobre la procedencia), get-or-create de `shops`
(retailer) y `manufacturers` (marca), generación de slug vía `slugify()` de la
base, manejo de las CHECK constraints (R-1 del épico) y de la colisión de slug
(R-2).
**NO incluye:** categorías/`category_product` (US-7), tocar `test_pipeline.py`
o el justfile (US-8), tocar los spiders, conversión de moneda, cambios a
`db/schema.sql`, re-scrapeos masivos.

## Criterios de aceptación

### CA-1 — Upsert idempotente por procedencia
Un item procesado dos veces (segunda vez con otro precio) produce UNA fila en
`products` con el precio actualizado, identificada por
`(source_store, source_product_id)`.

### CA-2 — Retailer y marca como filas reales
El primer item de un retailer crea su `shop` (y su `manufacturer` si trae
marca); el segundo item reutiliza las mismas filas (sin duplicados).

### CA-3 — Slug estable y único
El mismo item produce siempre el mismo `slug`; dos productos distintos con el
mismo nombre no chocan (política de desambiguación documentada e implementada).

### CA-4 — Las constraints no matan la corrida
Un item que viola una CHECK (p. ej. descuento incoherente o sin precio) se
maneja con la política definida en el design (descarte con log contado en
`stats`), y la corrida continúa.

### CA-5 — Visible en la tienda
Tras insertar items de prueba, `GET /api/products` (si US-2 ya está) o un
`SELECT` vía `just db-shell` muestra las filas con `source_store` poblado,
conviviendo con las 1200 del seed.

## Escenarios Gherkin
```gherkin
Feature: Pipeline del scraper sobre el catálogo compartido
  Scenario: CA-1 — upsert idempotente
    Given la base sembrada con just db-up
    When el pipeline procesa el mismo item dos veces con precios distintos
    Then products tiene UNA fila para esa procedencia con el último precio

  Scenario: CA-4 — item que viola una constraint
    When el pipeline procesa un item con sale_price mayor que price
    Then la fila no se inserta, el descarte queda logueado y la corrida sigue
```

## Archivos a crear / modificar
| Archivo | Cambio |
|---------|--------|
| `services/scraper-worker/pipelines.py` | UPSERT a `products` + get-or-create shops/manufacturers + política de constraints |
| `services/scraper-worker/items.py` | solo si el mapeo exige un campo que hoy no viaja |

## Definición de Done
- [ ] Corrida sintética del pipeline (estilo `test_pipeline.py`, aunque su actualización formal es US-8) con salida real pegada: inserta, actualiza, no duplica.
- [ ] `SELECT source_store, count(*) FROM products GROUP BY 1` vía `just db-shell` pegado, mostrando filas del scraper junto a las `NULL` del seed.
- [ ] Evidencia del CA-4 (item inválido → log + corrida viva) pegada.
- [ ] Status de esta US actualizado y fila del épico marcada.

## Notas para el agente ejecutor
- Leer `db/README.md` completo antes del design: el contrato de adaptación
  (qué crea el scraper y qué no) está ahí, no en el código.
- `just db-test` seguirá rojo hasta US-8: no "arreglarlo" acá recortando su
  alcance; la corrida sintética del DoD puede ser un script temporal en el
  scratchpad.
