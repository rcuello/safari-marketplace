# US-7 — Categorización a slugs del catálogo + `category_product`

> `categorizar()` de los spiders deja de inventar categorías propias y devuelve
> los slugs del type `gadget` que ya existen en el catálogo; el pipeline crea
> las filas de `category_product`.

**Épico:** [Épico 5](./README.md)
**Fecha:** 2026-08-25
**Status:** Implementada
**Depende de:** US-6
**LOC est.:** ~200

## Historia
**Como** usuario de la tienda, **quiero** que los productos scrapeados tengan
categoría real del catálogo, **para** que el filtro por categoría (que hoy
devuelve cero resultados porque `category_product` está vacía) empiece a
funcionar con los productos del scraper.

## Contexto

- `db/README.md` trae la tabla de mapeo explícita (portátiles→`laptop`,
  celulares→`mobiles`, monitores→`monitor`, gaming→`console`,
  audio→`headphone`/`sound-box`, cámaras→`camera`, redes→`router`,
  relojes→`smart-watch`, resto→`accessories-gfa`): los slugs ya existen en el
  seed bajo el type `gadget`.
- Cada spider tiene su propio `categorizar(nombre, enlace, imagen)` que hoy
  devuelve etiquetas libres en español (`portatiles`, `otros`, …).
- `category_product` está vacía a propósito en el seed; las filas del scraper
  son las primeras reales.

## Scope
**Incluye:** normalizar la salida de `categorizar()` de los 6 spiders a los
slugs del catálogo (o un mapeo central en el pipeline — decidir en el design
cuál de las dos capas traduce), e insertar la fila `category_product`
correspondiente en el upsert del pipeline.
**NO incluye:** crear categorías nuevas en el catálogo, cambiar el árbol de
categorías del seed, tocar la lógica de scraping/selectors de los spiders,
el frontend.

## Criterios de aceptación

### CA-1 — Solo slugs del catálogo
Todo item procesado termina asociado a un slug existente del type `gadget`;
un valor no mapeable cae al slug definido como resto (`accessories-gfa`), nunca
a una categoría inventada.

### CA-2 — Fila en category_product
El upsert de un item crea (idempotentemente) su fila en `category_product`;
reprocesar el item no duplica la relación.

### CA-3 — El filtro por categoría devuelve resultados
Con items de prueba insertados, un `SELECT` por `categories.slug` (o
`GET /api/products?category=...` si el endpoint ya migró con US-2) devuelve
los productos scrapeados de esa categoría.

## Escenarios Gherkin
```gherkin
Feature: Categorización contra el catálogo compartido
  Scenario: CA-1 — etiqueta no mapeable
    When el pipeline procesa un item cuya categoría no matchea ningún slug
    Then el producto queda en accessories-gfa y el fallback queda logueado
```

## Archivos a crear / modificar
| Archivo | Cambio |
|---------|--------|
| `services/scraper-worker/pipelines.py` | resolución slug→category_id + insert idempotente en `category_product` |
| `services/scraper-worker/spiders/*.py` | `categorizar()` alineado al mapeo (si el design lo pone en los spiders) |

## Definición de Done
- [x] Corrida sintética con items de las ~9 categorías del mapeo y salida real pegada.
  ```
  [warning] Item 'Licuadora Oster': categoria 'electrodomesticos' no mapea a un slug conocido, se usa el resto (accessories-gfa)
  [warning] Item 'Item sin categoria': categoria None no mapea a un slug conocido, se usa el resto (accessories-gfa)
  stats finales: {'insertados': 12, 'actualizados': 0, 'fallidos': 0, 'promociones_descartadas': 0}
  ```
- [x] `SELECT c.slug, count(*) FROM category_product cp JOIN categories c ON c.id=cp.category_id GROUP BY 1` pegado.
  ```
        slug       | count
  -----------------+-------
   accessories-gfa |     6
   console         |     1
   headphone       |     1
   laptop          |     1
   mobiles         |     1
   monitor         |     1
   sound-box       |     1
  ```
- [x] Evidencia del CA-2 (reproceso sin duplicados) pegada: reproceso con los mismos
  12 items dio `stats finales: {'insertados': 0, 'actualizados': 12, 'fallidos': 0, ...}`
  y el `GROUP BY` anterior salió idéntico (sin duplicar filas). Prueba adicional de
  saneo (D-9): al renombrar un item de `audio` con etiqueta `sound-box` a un nombre
  con término de audífono, `sound-box` bajó a 0, `headphone` subió a 2 y el total en
  `category_product` se mantuvo en 12 (no 13) — el `DELETE` de saneo quita la fila
  vieja en vez de acumularla.
- [x] Status de esta US actualizado y fila del épico marcada.

Evidencia completa (las 3 corridas, CA-3 por SQL y HTTP, limpieza y `just db-check`)
en `openspec/changes/2026-08-28-categorizacion-slugs-catalogo/apply-progress.md`.

## Notas para el agente ejecutor
- Preferir el mapeo centralizado en el pipeline si los `categorizar()` de los
  6 spiders divergen mucho: un solo punto de verdad, y los spiders quedan
  como productores de etiqueta cruda. Decidirlo explícitamente en el design.
