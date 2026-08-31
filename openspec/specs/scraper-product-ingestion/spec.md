# Scraper Product Ingestion Specification

## Purpose

`PostgresPipeline` ingiere items scrapeados de 6 retailers en el catálogo
compartido de Postgres (`products`, `shops`, `manufacturers`), identificados
por procedencia (`source_store`, `source_product_id`) para que re-scrapear
no duplique filas y queden visibles por los canales del catálogo. Cubre
idempotencia, descarte/saneo ante datos inválidos, no regresión del seed y
— desde US-7 — la extensión de `fallidos` cuando el insert puente hacia
`category_product` (ejecutado bajo el mismo `try` de `process_item`, NO en
una transacción: la conexión es `autocommit`) falla. La traducción de la etiqueta cruda a un slug del catálogo y la
materialización de esa relación viven en `scraper-product-categorization`,
no aquí. NO cubre spiders ni `normalizar_enlace`.

## Requirements

### Requirement: Upsert idempotente por procedencia

El pipeline MUST insertar o actualizar una única fila de `products` por cada
`(source_store, source_product_id)`. Reprocesar el mismo item con otro
precio MUST actualizar la fila existente, no crear una nueva, e incrementar
`insertados` en la primera pasada, `actualizados` en la segunda.

#### Scenario: Reprocesar el mismo item actualiza en vez de duplicar
- GIVEN el pipeline abierto contra la base sembrada, sin fila previa para esa procedencia
- WHEN se procesa un item de Alkosto/ACME con `precio="1.299.900 COP"` y luego el mismo con `"1.199.900 COP"`
- THEN `products` tiene UNA fila con `price = 1.199.900`
- AND `stats["insertados"] == 1` y `stats["actualizados"] == 1`

### Requirement: Slug estable, único entre tiendas y no se pisa al actualizar

El `slug` MUST derivarse determinísticamente de nombre y tienda: mismo item,
mismo slug siempre, sin contadores ni estado externo. Dos productos
homónimos en tiendas distintas MUST convivir sin violar el `UNIQUE` de
`slug`. El `slug` existente MUST NOT cambiar al actualizar la fila.

#### Scenario: Homónimos de tiendas distintas conviven
- GIVEN un producto "X" ya ingerido desde Alkosto
- WHEN se procesa un item con el mismo `nombre` pero `tienda='Falabella'`
- THEN ambas filas se insertan con slugs distintos

#### Scenario: El slug no cambia al re-scrapear
- GIVEN una fila ya ingerida con su slug calculado
- WHEN se reprocesa el mismo item con el precio actualizado
- THEN `price` se actualiza pero `slug` conserva su valor

Residual conocido: dos productos DISTINTOS homónimos en la MISMA tienda
colisionan en el `UNIQUE` de `slug`; se descartan como violación de
constraint no anticipada (ver abajo), sin desambiguación.

### Requirement: Get-or-create de shops y manufacturers cacheado por corrida

El pipeline MUST crear la fila en `shops`/`manufacturers` si no existe, y
reutilizarla en items subsiguientes de la misma tienda/marca en la corrida,
sin duplicar. Un item sin marca MUST persistirse con `manufacturer_id = NULL`.

#### Scenario: La segunda aparición de la tienda no duplica
- GIVEN un item de "Alkosto"/"ACME" ya procesado (creó `shops` y `manufacturers`)
- WHEN se procesa un segundo item también de "Alkosto"/"ACME"
- THEN sigue habiendo 1 fila en `shops` con ese slug y 1 en `manufacturers`

### Requirement: Descarte de items sin datos suficientes para persistir

Un item cuyo precio convertido sea `None` o `<= 0`, o cuyo `nombre`/`enlace`
venga vacío, MUST descartarse antes de persistir: sin fila insertada, con
log y `stats["fallidos"]` incrementado; la corrida MUST continuar. Un
`enlace` vacío degeneraría en una procedencia que colisiona con la de otro
item sin enlace de la misma tienda.

#### Scenario: Precio "N/D" se descarta
- WHEN se procesa un item con `precio="N/D"` (compulago/falabella)
- THEN no se inserta ninguna fila, se loguea un warning y `stats["fallidos"]` sube en 1

#### Scenario: Precio "0 COP" también se descarta, no se guarda como gratis
- WHEN se procesa un item con `precio="0 COP"` (alkosto/compuworking/tauret)
- THEN no se inserta fila con `price = 0`; se descarta igual que el caso `None`

#### Scenario: Item sin enlace se descarta
- WHEN se procesa un item con `precio` válido pero sin `enlace`
- THEN no se inserta ninguna fila y `stats["fallidos"]` sube

### Requirement: Saneo de promoción incoherente sin descartar el producto

Un item con `sale_price >= price` MUST persistirse igualmente, con
`sale_price = NULL`. El saneo MUST loguearse y contarse en
`stats["promociones_descartadas"]`, distinto de `fallidos`.

#### Scenario: Promoción inválida no tumba el producto
- WHEN se procesa un item con `precio=100000` y `promocion=120000`
- THEN la fila se inserta con `sale_price IS NULL`
- AND `stats["promociones_descartadas"] == 1`; `fallidos` no sube

### Requirement: Captura de violaciones de constraint no anticipadas

Cualquier error de Postgres no cubierto por las precondiciones anteriores
(p. ej. overflow en `price`) MUST capturarse, loguearse, incrementar
`stats["fallidos"]`, y la corrida MUST continuar. Esta captura MUST también
cubrir el fallo del insert puente hacia `category_product`
(`scraper-product-categorization`), que corre dentro de la misma frontera
de captura (el `try` de `process_item`) que el upsert de `products` — una
frontera de manejo de errores, NO transaccional: si ese insert falla, MUST
contarse en `fallidos` aun cuando la fila de `products` ya haya sido
confirmada por `autocommit`.

#### Scenario: Un item con datos fuera de rango no aborta la corrida
- WHEN se procesa un item cuyo precio produce overflow numérico
- THEN el item se descarta, el error queda logueado y el siguiente se procesa con éxito

#### Scenario: Fallo del insert puente cuenta en fallidos aunque el producto ya esté persistido
- GIVEN un item cuyo upsert en `products` se confirma correctamente
- WHEN el insert subsiguiente en `category_product` falla
- THEN el item incrementa `stats["fallidos"]`, la fila de `products` permanece persistida, y la corrida continúa con el siguiente item

### Requirement: Arranque fail-fast si falta la taxonomía base

Al abrir el spider, el pipeline MUST resolver el `type` requerido. Si no
existe, MUST abortar ANTES del primer item con mensaje de causa y
remediación — nunca degradar a descarte item por item.

#### Scenario: Base sin sembrar aborta antes del primer item
- GIVEN una base Postgres sin el catálogo de `types` sembrado
- WHEN se abre el spider
- THEN el pipeline lanza un error accionable y no procesa ningún item

### Requirement: Visibilidad de las filas ingeridas en la tienda

Las filas insertadas o actualizadas MUST ser consultables por `SELECT`
directo y por el endpoint HTTP existente de listado/detalle, sin cambios de
capa de datos ni de API.

#### Scenario: Fila visible por SQL y por HTTP
- GIVEN items ya ingeridos por el pipeline
- WHEN se consulta `SELECT source_store, count(*) FROM products GROUP BY 1` y `GET /api/products?search=manufacturer.slug:<marca>`
- THEN las filas del scraper aparecen en ambos canales, junto con las del seed

### Requirement: No regresión sobre las filas sembradas

El pipeline MUST NOT modificar ni eliminar filas sembradas por `just db-up`
(`source_store IS NULL`); su `ON CONFLICT` MUST alcanzar solo filas de
scraper.

#### Scenario: El seed queda intacto tras una corrida
- GIVEN la base recién sembrada (1200 filas con `source_store IS NULL`)
- WHEN el pipeline procesa cualquier cantidad de items
- THEN el conteo de filas con `source_store IS NULL` sigue siendo 1200

## Out of Scope

La traducción de etiqueta a slug y la fila de `category_product`
(capability `scraper-product-categorization`, US-7) · `test_pipeline.py`/
`justfile` (US-8) · spiders, `items.py`, moneda · `db/schema.sql` ·
`packages/db` · `normalizar_enlace` (D-5, elevada al dueño del repo).
