# Scraper Product Categorization Specification

## Purpose

Traduce la etiqueta cruda de los 6 spiders (`datos.get("categoria")`) a un
slug existente del type `gadget` y materializa la relación idempotente en
`category_product`, dentro del mismo `process_item` del upsert de `products`
(`scraper-product-ingestion`). Cubre: mapeo a slug, desambiguación de `audio`,
fallback al resto, fail-fast, unicidad por producto entre corridas y filtro
por categoría. NO cubre: crear categorías, el árbol del seed,
scraping/selectors, `items.py`, el frontend, ni el upsert de `products`.

## Requirements

### Requirement: Todo item se resuelve a un slug existente, nunca a uno inventado

El sistema MUST asociar cada item a un `slug` ya existente en `categories`
bajo el type `gadget`, y MUST NOT crear una categoría nueva (etiqueta
reconocida, resto o fallback).

#### Scenario: Etiqueta reconocida resuelve al slug mapeado, sin crear categorías
- GIVEN items con `categoria="computadores"` y `categoria="tablets"` (resto)
- WHEN el pipeline los procesa
- THEN quedan en `laptop` y `accessories-gfa`; `SELECT count(*) FROM categories` no cambia

### Requirement: Fallback exhaustivo a `accessories-gfa` para valores no mapeables

Para una `categoria` fuera del mapa cerrado (y distinta de `audio`), o
ausente, `None`, vacía o de solo espacios, el sistema MUST resolverla a
`accessories-gfa` y MUST loguear un warning con el valor crudo recibido.

#### Scenario: Etiqueta desconocida, ausente, `None`, vacía o de solo-espacios cae al resto con warning
- WHEN se procesan 5 items con, respectivamente, `categoria="electrodomesticos"`, clave ausente, `None`, `""` y `"  "`
- THEN los 5 quedan en `accessories-gfa`, cada uno con su propio warning nombrando el valor recibido

### Requirement: Desambiguación de `audio` por palabras clave del nombre

Para `categoria="audio"`, el sistema MUST resolver a `headphone` si el
`nombre` normalizado (sin tildes, minúsculas) contiene un término de la lista
cerrada de audífonos; si no, MUST resolver a `sound-box`. MUST NOT loguear
warning: `audio` es una etiqueta mapeada, no desconocida.

#### Scenario: El nombre decide entre headphone y sound-box
- GIVEN dos items con `categoria="audio"`: uno `nombre="Audífonos Sony WH-1000XM5"`, otro `nombre="Parlante Bluetooth JBL Charge 5"`
- THEN el primero queda en `headphone` (acento normalizado) y el segundo en `sound-box`, ninguno con warning

### Requirement: Fila idempotente en `category_product`

Tras un upsert exitoso de `products`, el sistema MUST insertar la fila
`(product_id, category_id)` si no existe. Reprocesar el item MUST NOT
duplicarla.

#### Scenario: Reprocesar el mismo item no duplica la fila puente
- GIVEN un item ya procesado con su fila en `category_product`
- WHEN se reprocesa sin cambios
- THEN sigue habiendo una sola fila para ese par, sin error de constraint, y `actualizados` sube

### Requirement: Un producto conserva una única categoría vigente entre corridas

Si el `nombre` cambia entre corridas y la etiqueta resuelve a otro slug, el
sistema MUST dejar al producto en UN solo slug vigente: la fila anterior
MUST eliminarse en la misma operación que crea la nueva.

#### Scenario: Cambio de nombre entre corridas mueve la categoría sin duplicarla
- GIVEN un producto ya categorizado en `sound-box` (nombre sin término de audífono)
- WHEN se reprocesa el mismo producto (misma procedencia) con el nombre cambiado a uno con término de audífono
- THEN el producto queda solo en `headphone`; la fila en `sound-box` ya no existe
- AND el total de filas en `category_product` para ese producto sigue en 1, no 2

### Requirement: Arranque fail-fast si falta un slug de categoría esperado

Al abrir el spider, el sistema MUST resolver el `category_id` de los slugs
esperados (`type_id` de `gadget`). Si falta alguno, MUST abortar antes del
primer item, nombrando los faltantes, sin crearlos.

#### Scenario: Slug de categoría faltante aborta antes del primer item
- GIVEN una base cuyo `categories` no tiene uno de los slugs destino esperados
- WHEN se abre el spider
- THEN el pipeline lanza un error accionable que nombra el slug faltante y no procesa ningún item

### Requirement: Un fallo del insert puente cuenta en `fallidos` y la corrida continúa

Si el insert en `category_product` falla, el sistema MUST capturarlo,
loguearlo, sumar `fallidos`, y continuar. Con `autocommit`, `products` ya
está confirmado; el producto MAY quedar sin categoría hasta un re-scrapeo.

#### Scenario: Fallo del insert puente no aborta la corrida y un re-scrape lo repara
- GIVEN un item cuyo upsert en `products` se confirma correctamente
- WHEN el insert subsiguiente en `category_product` falla
- THEN el item suma `fallidos`, `products` queda persistido sin categoría, sigue el siguiente item, y un re-scrape posterior sin el error crea la fila pendiente sin duplicar `products`

### Requirement: El filtro por categoría devuelve los productos categorizados

Las filas de `category_product` MUST ser consultables por `SELECT` (join con
`categories`) y por el endpoint HTTP existente vía `categories.slug:<slug>`
en `search`. MUST NOT requerir un query param `category=`.

#### Scenario: Filtro por slug devuelve resultados por SQL y por HTTP
- GIVEN productos scrapeados ya categorizados en `laptop`
- WHEN se ejecuta el `SELECT` con join a `category_product`/`categories` y `GET /api/products?search=categories.slug:laptop`
- THEN ambos canales devuelven los mismos productos

### Requirement: No regresión sobre el catálogo de categorías y el seed

El sistema MUST NOT alterar el conteo de `categories` (198) ni el de
`products` sembrados (`source_store IS NULL`, 1200).

#### Scenario: El catálogo de categorías y el seed quedan intactos
- GIVEN la base sembrada (198 categorías, 1200 productos con `source_store IS NULL`)
- WHEN el pipeline procesa cualquier cantidad de items
- THEN ambos conteos siguen iguales

## Known Limitations (declaradas, no compensadas)

- `camera`, `router`, `smart-watch`: sin productos, por vocabulario de origen,
  no por incumplimiento de CA-1.
- Webcam de Falabella bajo la URL "Computadores": hereda `laptop` en vez de
  `accessories-gfa` (mala clasificación que nace en el spider).
- `KEYWORDS_AUDIFONO` es un subconjunto elegido, no la unión del vocabulario
  de audífono; audio profesional cae al default `sound-box`.

## Out of Scope

Crear categorías · el árbol del seed · scraping/selectors de los 6 spiders
(incluidos `categorizar()`) · `items.py` · el frontend · `db/schema.sql` ·
`db/seed.sql` · `test_pipeline.py`/`justfile` (US-8) · `normalizar_enlace`
(D-5 de US-6) · el upsert de `products` (`scraper-product-ingestion`).
