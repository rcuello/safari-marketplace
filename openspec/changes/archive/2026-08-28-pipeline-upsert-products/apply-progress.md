# Apply Progress: Pipeline upsert en `products` con procedencia (US-6)

Estado: **23/23 tareas completas**. Único archivo de producción tocado:
`services/scraper-worker/pipelines.py` (+200/-47 líneas, dentro del PR único
de ~240-330 líneas del forecast). Docs de cierre: los dos archivos de Fase 4.

## Phase 0: Verificación bloqueante del `ON CONFLICT` — GATE PASADO

- [x] 0.1 `just db-up`; Postgres listo
- [x] 0.2 `\d products` → `products_procedencia_key`
- [x] 0.3 `INSERT` de prueba con `ON CONFLICT (source_store, source_product_id) WHERE source_store IS NOT NULL DO UPDATE` → sin `42P10`

### Evidencia 0.1 — `just db-up`

```
 Container safari-postgres  Started
esperando a Postgres listo
...
  * esquema y datos de referencia aplicados
```

### Evidencia 0.2 — `\d products` (extracto de índices/constraints)

```
Indexes:
    "products_pkey" PRIMARY KEY, btree (id)
    ...
    "products_procedencia_key" UNIQUE, btree (source_store, source_product_id) WHERE source_store IS NOT NULL
    ...
    "products_slug_key" UNIQUE CONSTRAINT, btree (slug)
Check constraints:
    "products_procedencia_completa" CHECK (num_nonnulls(source_store, source_product_id) = ANY (ARRAY[0, 2]))
    "products_rebaja_valida" CHECK (sale_price IS NULL OR price IS NULL OR sale_price < price)
    "products_simple_con_precio" CHECK (product_type <> 'simple'::text OR price IS NOT NULL)
```

### Evidencia 0.3 — INSERT de prueba dentro de una transacción con ROLLBACK

(equivalente al INSERT+DELETE del plan; no deja residuo). Primera pasada
(INSERT puro, sin fila previa):

```
BEGIN
 fue_insercion |  id  |          slug           |  price  
---------------+------+-------------------------+---------
 t             | 1261 | gate-test-producto-gate | 1000.00
(1 row)

INSERT 0 1
```

Segunda pasada, mismo `(source_store, source_product_id)`, dentro de la misma
transacción (dispara la rama `DO UPDATE`):

```
 fue_insercion |  id  |          slug           |  price  
---------------+------+-------------------------+---------
 f             | 1261 | gate-test-producto-gate | 2000.00
(1 row)

INSERT 0 1
ROLLBACK
```

**Sin `42P10` en ninguna de las dos pasadas.** `fue_insercion` alterna `t`/`f`
como se espera de `RETURNING (xmax = 0)`. `ROLLBACK` deshizo ambas filas.
**Gate PASADO — se procedió con Phase 1.**

## Phase 1 y 2: Reescritura de `pipelines.py`

- [x] 1.1-1.7 helpers y constantes (`parse_calificacion`, `imagen_jsonb`,
  `SQL_TYPE_ID`, `SQL_SHOP`, `SQL_MANUFACTURER`, `_resolver_referencia`,
  `UPSERT_PRODUCT`, `open_spider` con fail-fast + 4º contador, docstring)
- [x] 2.1-2.5 `process_item` reescrito: precondiciones → saneo → FKs → upsert
  → `except psycopg.Error` con mapa de constraints

Verificación de sintaxis: `python -c "import py_compile; py_compile.compile('services/scraper-worker/pipelines.py', doraise=True)"` → `OK syntax`.

Archivo final: 290 líneas (vs 137 antes), `+200/-47` en `git diff --stat`.
(Corregido tras la revisión: la cifra original decía "247 líneas", que era el
total del diffstat `200+47`, no el tamaño del archivo. Cifras finales tras las
correcciones de la revisión, más abajo: **308 líneas**, `+223/-52`.)

## Phase 3: Verificación de integración (evidencia de la DoD)

Script sintético `verificar_us6.py` en el scratchpad de la sesión (NO en el
repo), con 8 items (a)-(h) del design (incluido `precio='0 COP'`, el caso h).

### Corrida y `stats`

```
[info]    Conectado a Postgres; spider: prueba-us6

Procesando items sinteticos (a)-(h):
  [warning] Item 'Producto Test E': promocion (120000) >= precio (100000), se descarta la promocion
  [warning] Item 'Producto Test F' sin precio valido descartado (precio='N/D', tienda=Compulago)
  [warning] Item 'Producto Test G' sin enlace descartado (tienda=Exito)
  [warning] Item 'Producto Test H' sin precio valido descartado (precio='0 COP', tienda=Compuworking)
  [info]    Postgres resumen: {'insertados': 4, 'actualizados': 1, 'fallidos': 3, 'promociones_descartadas': 1}

STATS: {'insertados': 4, 'actualizados': 1, 'fallidos': 3, 'promociones_descartadas': 1}
OK: stats coincide con lo esperado {'insertados': 4, 'actualizados': 1, 'fallidos': 3, 'promociones_descartadas': 1}
```

**Coincide exactamente con lo esperado por el design**: `insertados 4,
actualizados 1, fallidos 3, promociones_descartadas 1` (8 items = 4+1+3).
Los 4 `warning` de descarte/saneo están presentes.

**Corrección de honestidad (W-2 de la verificación)**: la redacción original
decía aquí que «los items posteriores de cada lote se procesaron con éxito».
Era cierto pero **no demostrable con esta corrida**: (f), (g) y (h) son los
tres últimos items del lote, así que ningún item exitoso los sigue. La
continuidad de la corrida quedó probada después, en `sdd-verify`, con un par
(k)→(l): un item que provoca `numeric field overflow` seguido de uno sano que
sí se insertó. Ver `verify-report.md`.

### CA-1 / CA-3 — `SELECT` directo

```sql
SELECT source_store, source_product_id, slug, price, sale_price FROM products
WHERE source_store IS NOT NULL ORDER BY id;
```
```
 source_store | source_product_id |           slug            |   price    | sale_price 
--------------+-------------------+---------------------------+------------+------------
 Alkosto      | 1001              | producto-test-a-alkosto   | 1199900.00 |           
 Alkosto      | 1002              | producto-test-c-alkosto   |  500000.00 |           
 Falabella    | 2001              | producto-test-a-falabella | 1300000.00 |           
 Alkosto      | 1003              | producto-test-e-alkosto   |  100000.00 |           
(4 rows)
```
Los items (a)+(b) (mismo `Alkosto`+enlace, reprocesado con otro precio)
colapsaron en UNA fila con `price = 1199900` (el segundo precio, CA-1) y su
`slug` no cambió entre la primera y la segunda pasada. El item (d) (mismo
`nombre` que (a), `tienda='Falabella'`) produjo un slug distinto
(`producto-test-a-falabella`, CA-3).

### CA-2 — retailer y marca sin duplicar

```sql
SELECT count(*) FROM shops WHERE slug='alkosto';        -- 1
SELECT count(*) FROM manufacturers WHERE slug='acme';   -- 1
```
Dos items de Alkosto/ACME ((a)/(b) y (c)) no duplicaron ni `shops` ni
`manufacturers`.

### CA-5 — visible por SQL y por HTTP

```sql
SELECT source_store, count(*) FROM products GROUP BY 1 ORDER BY 1 NULLS FIRST;
```
```
 source_store | count 
--------------+-------
              |  1200
 Alkosto      |     3
 Falabella    |     1
```
1200 filas del seed (`source_store IS NULL`) intactas, junto a las 4 filas
del scraper — no regresión (`SELECT count(*) FROM products WHERE
source_store IS NULL` → `1200`).

Vía HTTP, con `just api-dev` corriendo en el puerto **9001** (log de arranque:
`Nest application successfully started`, `Application is running on:
http://[::1]:9001/api`):

```bash
curl -s "http://localhost:9001/api/products?search=manufacturer.slug:acme&limit=30" -o "$SCRATCH/pg.json"
node -e "const d=require(process.env.SCRATCH+'/pg.json').data; console.log(JSON.stringify(d.map(p=>[p.slug,p.price,p.shop&&p.shop.name])))"
```
```
[["producto-test-a-alkosto",1199900,"Alkosto"],["producto-test-c-alkosto",500000,"Alkosto"],["producto-test-a-falabella",1300000,"Falabella"],["producto-test-e-alkosto",100000,"Alkosto"]]
```
```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" "http://localhost:9001/api/products/producto-test-a-alkosto"
# HTTP 200
```
CA-5 cerrado por las dos vías: SQL y HTTP (listado + detalle 200).

### Limpieza post-verificación

```sql
DELETE FROM products WHERE source_store IN ('Alkosto','Falabella');  -- 4
DELETE FROM shops WHERE slug='alkosto';                               -- 1
DELETE FROM shops WHERE slug='falabella';                             -- 1 (ver nota)
DELETE FROM manufacturers WHERE slug='acme';                          -- 1
```
**Nota de proceso**: la primera pasada de limpieza olvidó el `shop`
`Falabella` creado por el item (d) (`_resolver_referencia` también corre para
`tienda='Falabella'`, no solo `'Alkosto'`). Se detectó porque `just db-check`
falló con `expected 13 to be 12` en `shops.integration.test.ts` (13 shops en
vez de las 12 del seed); se borró la fila sobrante (`id=17, slug=falabella`)
y `db-check` volvió a pasar limpio. Tras la limpieza completa: `products`
con `source_store IS NOT NULL` → 0, `shops`/`slug='alkosto'` → 0,
`manufacturers`/`slug='acme'` → 0.

### No regresión — `just db-check`

```
 Test Files  6 passed (6)
      Tests  48 passed (48)
```

## Phase 4: Cierre documental

- [x] 4.1 `docs/product/5-scraper-catalogo-compartido/6-pipeline-upsert-products.md`:
  `Status:` → `Implementada`; DoD con la evidencia de arriba pegada.
- [x] 4.2 `docs/product/5-scraper-catalogo-compartido/README.md`: la tabla de
  sub-historias no tenía columna `Status` (a diferencia de otros épicos ya
  archivados, p. ej. `1-catalogo-desde-postgres/README.md`); se añadió la
  columna siguiendo esa convención y se marcó US-6 como `✅ Implementada`.
  US-7/US-8 quedan con la celda vacía (no implementadas por esta US).

## Deviations from Design

Ninguna deviación de fondo. Dos notas menores no normativas:

1. El gate 0.3 se verificó con `BEGIN`/`ROLLBACK` en vez de `INSERT` +
   `DELETE` explícito — mismo efecto (no deja residuo), más simple de
   ejecutar dos veces (INSERT puro + UPDATE por conflicto) en una sola
   transacción.
2. La columna `Status` en el README del épico no existía; se creó siguiendo
   el precedente de otro épico ya archivado, en vez de asumir su existencia.

## Issues Found

Ninguno bloqueante. Un olvido de limpieza propio (shop `Falabella` no
borrado en la primera pasada) causó un falso-positivo de regresión en
`db-check`, corregido antes de cerrar la evidencia (ver nota de proceso
arriba) — no era una regresión del código, sino residuo de la propia
verificación.

## Revisión independiente post-apply (gatekeeper del orquestador)

Un revisor de contexto fresco auditó la implementación contra el design y la
spec. **Veredicto: APROBADO CON CORRECCIONES — ningún defecto bloqueante.**
Verificó de forma independiente, entre otras cosas, que el `WHERE` del
`ON CONFLICT` es load-bearing (`EXPLAIN` devuelve
`Conflict Arbiter Indexes: products_procedencia_key`; sin el `WHERE`, error),
que los slugs pegados salen de `slugify()` real, y que
`shops_id_seq.last_value = 17` con `max(id) = 15` corrobora al pie de la letra
la nota del shop `Falabella` borrado.

### Correcciones aplicadas por el orquestador

| # | Archivo | Corrección |
|---|---------|-----------|
| 1 | `pipelines.py` | El get-or-create de `shops`/`manufacturers` quedaba FUERA del `try/except psycopg.Error` (se evaluaba al construir el dict `fila`). Un fallo suyo escapaba de `process_item`, no contaba en `fallidos` y rompía la invariante de la Decisión H. **La construcción de `fila` se movió dentro del `try`.** Cierra la brecha con el requisito «Captura de violaciones no anticipadas». |
| 2 | `pipelines.py` | `cache[nombre] = fila[0]` podía lanzar `TypeError` opaco si el `SELECT` de respaldo tampoco devolvía fila → `RuntimeError` legible. |
| 3 | `pipelines.py` | `parse_calificacion`: `Decimal("NaN").quantize()` NO lanza, pero comparar `NaN` sí → guarda `is_finite()`. Sin ella, un `nan` tumbaba la corrida entera. |
| 4 | este archivo | Cifra de líneas mal leída (247 = total del diffstat, no tamaño del archivo). |

### Re-verificación tras las correcciones (salida real)

Script sintético re-ejecutado íntegro:

```
  [warning] Item 'Producto Test E': promocion (120000) >= precio (100000), se descarta la promocion
  [warning] Item 'Producto Test F' sin precio valido descartado (precio='N/D', tienda=Compulago)
  [warning] Item 'Producto Test G' sin enlace descartado (tienda=Exito)
  [warning] Item 'Producto Test H' sin precio valido descartado (precio='0 COP', tienda=Compuworking)
STATS: {'insertados': 4, 'actualizados': 1, 'fallidos': 3, 'promociones_descartadas': 1}
OK: stats coincide con lo esperado
```

Cifras idénticas a las de la primera corrida: las correcciones no cambian
comportamiento. Limpieza posterior (esta vez incluyendo TODOS los `shops` del
scraper) y estado restaurado al seed:

```
 scraper_rows | total_products | shops | manufacturers 
--------------+----------------+-------+---------------
            0 |           1200 |    12 |            14
```

```
 Test Files  6 passed (6)
      Tests  48 passed (48)
```

### Menores NO accionados (elevados al dueño del repo)

- **Asimetría `price` / `sale_price`**: `price` se guarda con `is None or <= 0`,
  pero una `promocion` de `"0 COP"` daría `sale_price = 0.00` («en oferta a
  gratis»). El revisor verificó que **hoy es inalcanzable** en los 6 spiders.
  No se accionó porque la política de saneo la fija el design, no el apply.
- **Costuras del fail-fast**: si la tabla `types` no existe sale un
  `UndefinedTable` crudo en vez del mensaje accionable, y `self.stats` no está
  asignado si Scrapy llama a `close_spider` tras el fail-fast.
- **`return item` en vez de `raise DropItem`** para descartes: coincide con el
  design, pero desalinea `item_scraped_count` de Scrapy con los `stats` del
  pipeline.
- **Hallazgo sistémico (no es de esta US)**:
  `packages/db/src/repositories/shops.integration.test.ts:17-19` afirma
  `toBe(12)` y `manufacturers.integration.test.ts:18` afirma `toBe(14)`. Como
  el scraper ahora crea filas en esas tablas, **cualquier corrida real de un
  spider pone rojo el único gate verde del repo**. Los tests de `products` usan
  `toBeGreaterThan` y sobreviven. Decisión de US-8/US-10.

### Cobertura declarada con honestidad

Cubiertos por código **y** evidencia: upsert idempotente · slug estable/único ·
get-or-create sin duplicar · descarte por `N/D`/`0 COP`/sin enlace · saneo de
promoción · visibilidad SQL+HTTP · no regresión del seed.

Cubiertos **solo por código, sin evidencia de ejecución**: descarte por nombre
vacío · item sin marca → `manufacturer_id NULL` · captura de violaciones no
anticipadas (ningún item forzó overflow) · fail-fast por falta de `types`
(exigiría una base sin sembrar). No se declaran «verificados».

## Status

**23/23 tareas completas + correcciones de la revisión aplicadas y
re-verificadas. Ready for verify.**
