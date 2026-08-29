# Verification Report — US-6 · Pipeline upsert en `products` con procedencia

**Change**: `2026-08-26-pipeline-upsert-products` — archivado como
`2026-08-28-pipeline-upsert-products` (la fase de archive usó la fecha ISO
real del cierre). Las citas de salida de comandos más abajo conservan el
nombre original con el que se ejecutaron: son evidencia y no se reescriben.
**Spec**: `specs/scraper-product-ingestion/spec.md` (9 requisitos RFC 2119, 11 escenarios)
**Modo**: Standard (`strict_tdd: false`) · Store: openspec
**Fecha de verificación**: 2026-08-28
**Veredicto**: **PASS WITH WARNINGS**

La verificación NO se apoyó únicamente en la evidencia del apply: se
re-ejecutó el pipeline contra Postgres real con un script propio
(`verify_us6_independiente.py`, scratchpad) que reproduce los 8 items del
apply y **añade 4 casos nuevos** para cubrir los tres escenarios que el apply
declaró honestamente como «solo código». Se re-verificó CA-5 por HTTP con
`just api-dev` levantada por esta fase, y se restauró la base a su línea base
(0 / 1200 / 12 / 14) antes de cerrar.

## Completeness

| Métrica | Valor |
|---|---|
| Tareas totales | 23 |
| Tareas completas (`[x]`) | 23 |
| Tareas incompletas | 0 |
| Tareas marcadas sin cambio real en el árbol | 0 (ver «Trazabilidad tareas → árbol») |

## Build & Tests Execution

**Gate de regresión del repo — `just db-check`**: ✅ Passed

```text
> @safari/db@0.1.0 typecheck
> tsc --noEmit
...
 Test Files  6 passed (6)
      Tests  48 passed (48)
   Start at  18:21:43
   Duration  8.11s (transform 1.94s, setup 0ms, import 11.04s, tests 7.83s, environment 2ms)
```

**Corrida de integración independiente** (12 items: los 8 del apply + i/j/k/l
nuevos), `services/scraper-worker/.venv/Scripts/python.exe`: ✅ Passed (`EXIT=0`)

```text
== Unit: parse_calificacion ==
  OK   parse_calificacion(4.5) -> Decimal('4.50') (esperado Decimal('4.50'))
  OK   parse_calificacion(None) -> None (esperado None)
  OK   parse_calificacion('45') -> None (esperado None)
  OK   parse_calificacion(9.995) -> None (esperado None)
  OK   parse_calificacion(-1) -> None (esperado None)
  OK   parse_calificacion(nan) -> None (esperado None)
  OK   parse_calificacion('no-numero') -> None (esperado None)

Seed antes de la corrida (source_store IS NULL): 1200
  [info]    Conectado a Postgres; spider: verify-us6

== Corrida: items (a)-(l) ==
  [warning] Item 'Producto Test E': promocion (120000) >= precio (100000), se descarta la promocion
  [warning] Item 'Producto Test F' sin precio valido descartado (precio='N/D', tienda=Compulago)
  [warning] Item 'Producto Test G' sin enlace descartado (tienda=Exito)
  [warning] Item 'Producto Test H' sin precio valido descartado (precio='0 COP', tienda=Compuworking)
  [warning] Item sin nombre descartado (tienda=Alkosto)
  [error]   Error guardando 'Producto Test K': numeric field overflow
DETAIL:  A field with precision 12, scale 2 must round to an absolute value less than 10^10.
  [info]    Postgres resumen: {'insertados': 6, 'actualizados': 1, 'fallidos': 5, 'promociones_descartadas': 1}

STATS: {'insertados': 6, 'actualizados': 1, 'fallidos': 5, 'promociones_descartadas': 1}
OK: esperado {'insertados': 6, 'actualizados': 1, 'fallidos': 5, 'promociones_descartadas': 1}

Slug tras (a): producto-test-a-alkosto
Slug tras (b) [update]: producto-test-a-alkosto
OK: el slug no cambio al actualizar

Seed despues (source_store IS NULL): 1200 (OK sin regresion)

== Fail-fast: taxonomia base ausente ==
  OK   ValueError: No existe el type 'gadget' en la base: el catalogo no esta sembrado.
Corre `just db-up` (o `just db-reset` si la base quedo a medias).
  stats inicializado (items procesables): False

RESULTADO GLOBAL: TODO OK
```

Invariante de la Decisión H comprobada sobre 12 items:
`insertados(6) + actualizados(1) + fallidos(5) = 12`; `promociones_descartadas(1)`
ortogonal. Consistente con el 4/1/3/1 de 8 items del apply (los 4 items nuevos
aportan +2 insertados y +2 fallidos).

**Estado final de la base tras la corrida (antes de limpiar)**:

```text
 source_store | source_product_id |           slug            |   price    | sale_price | manufacturer_id | shop_id |              img              | ratings
--------------+-------------------+---------------------------+------------+------------+-----------------+---------+-------------------------------+---------
 Alkosto      | 1001              | producto-test-a-alkosto   | 1199900.00 |            |              22 |      20 | https://img.example.com/a.jpg |    4.50
 Alkosto      | 1002              | producto-test-c-alkosto   |  500000.00 |            |              22 |      20 |                               |    0.00
 Falabella    | 2001              | producto-test-a-falabella | 1300000.00 |            |              22 |      21 |                               |    0.00
 Alkosto      | 1003              | producto-test-e-alkosto   |  100000.00 |            |              22 |      20 |                               |    0.00
 Alkosto      | 1005              | producto-test-j-alkosto   |  700000.00 |            |                 |      20 |                               |    0.00
 Alkosto      | 1007              | producto-test-l-alkosto   |  900000.00 |            |              22 |      20 |                               |    0.00
(6 rows)

 source_store | count
--------------+-------
              |  1200
 Alkosto      |     5
 Falabella    |     1

 shops_alkosto | shops_falabella | manu_acme | seed_rows
---------------+-----------------+-----------+-----------
             1 |               1 |         1 |      1200
```

**CA-5 por HTTP** (API levantada por esta fase en el 9001;
`Nest application successfully started` / `Application is running on: http://[::1]:9001/api`):

```text
$ curl -s "http://localhost:9001/api/products?search=manufacturer.slug:acme&limit=30"
filas: 5
[["producto-test-a-alkosto",1199900,"Alkosto",null],["producto-test-c-alkosto",500000,"Alkosto",null],
 ["producto-test-a-falabella",1300000,"Falabella",null],["producto-test-e-alkosto",100000,"Alkosto",null],
 ["producto-test-l-alkosto",900000,"Alkosto",null]]

$ curl "http://localhost:9001/api/products/producto-test-a-alkosto"   -> HTTP 200
{"slug":"producto-test-a-alkosto","name":"Producto Test A","price":1199900,"shop":"Alkosto"}

$ curl "http://localhost:9001/api/products/producto-test-j-alkosto"   -> HTTP 200
{"slug":"producto-test-j-alkosto","price":700000}
```

**Limpieza y restauración de la línea base** (obligatoria: los tests de
integración afirman `shops == 12` y `manufacturers == 14`):

```text
DELETE 6      -- products WHERE source_store IS NOT NULL
DELETE 2      -- shops (alkosto, falabella)
DELETE 1      -- manufacturers (acme)

 scraper_rows | total_products | shops | manufacturers
--------------+----------------+-------+---------------
            0 |           1200 |    12 |            14
```

`just db-check` se corrió **después** de la limpieza: verde. La API arrancada
por esta fase fue detenida (`taskkill` del PID 53608; `curl` posterior sin
respuesta). Árbol de trabajo sin cambios introducidos por la verificación
(`git status` idéntico al de entrada).

**Estado esperado, NO regresión** — `just db-test` y `just db-count` siguen
rojos (US-8), y fallan **antes** de tocar la base (el `DELETE FROM productos`
de `test_pipeline.py:83` revienta primero, así que no ensucian el catálogo):

```text
psycopg.errors.UndefinedTable: relation "productos" does not exist
LINE 1: DELETE FROM productos WHERE tienda IN ('Alkosto','Exito')
error: recipe `db-test` failed on line 301 with exit code 1

ERROR:  relation "productos" does not exist   (db-count)
```

**Coverage**: ➖ no aplica (el proyecto no mide cobertura; `coverage_threshold: 0`).

## Spec Compliance Matrix

| # | Requisito | Escenario | Evidencia de ejecución | Resultado |
|---|---|---|---|---|
| 1 | Upsert idempotente por procedencia | Reprocesar el mismo item actualiza en vez de duplicar | items (a)+(b): UNA fila `1001` con `price = 1199900.00`; `insertados` +1 y `actualizados` +1 | ✅ COMPLIANT |
| 2 | Slug estable/único | Homónimos de tiendas distintas conviven | (a) vs (d): `producto-test-a-alkosto` / `producto-test-a-falabella` | ✅ COMPLIANT |
| 2 | Slug estable/único | El slug no cambia al re-scrapear | slug idéntico antes y después del `DO UPDATE` (leído de la base en ambos momentos) | ✅ COMPLIANT |
| 3 | Get-or-create cacheado | La segunda aparición de la tienda no duplica | 5 items de Alkosto/ACME → `shops.alkosto = 1`, `manufacturers.acme = 1` | ✅ COMPLIANT |
| 3 | Get-or-create cacheado | Item sin marca → `manufacturer_id = NULL` | item (j) `producto-test-j-alkosto` con `manufacturer_id` vacío en el `SELECT`, y detalle HTTP 200 | ✅ COMPLIANT (nuevo en verify) |
| 4 | Descarte por datos insuficientes | Precio `"N/D"` se descarta | item (f): warning + `fallidos`; sin fila | ✅ COMPLIANT |
| 4 | Descarte por datos insuficientes | Precio `"0 COP"` se descarta | item (h): warning + `fallidos`; sin fila con `price = 0` | ✅ COMPLIANT |
| 4 | Descarte por datos insuficientes | Item sin enlace se descarta | item (g): warning + `fallidos` | ✅ COMPLIANT |
| 4 | Descarte por datos insuficientes | (implícito) nombre vacío | item (i): `Item sin nombre descartado (tienda=Alkosto)` + `fallidos` | ✅ COMPLIANT (nuevo en verify) |
| 5 | Saneo de promoción incoherente | Promoción inválida no tumba el producto | item (e): fila con `sale_price` NULL, `promociones_descartadas = 1`, `fallidos` sin subir | ✅ COMPLIANT |
| 6 | Captura de violaciones no anticipadas | Item fuera de rango no aborta la corrida | item (k) `numeric field overflow` logueado + `fallidos`; item (l) posterior **insertado** | ✅ COMPLIANT (nuevo en verify) |
| 7 | Fail-fast si falta la taxonomía | Base sin sembrar aborta antes del primer item | `SQL_TYPE_ID` apuntado a un slug inexistente → `ValueError` accionable, `self.stats` nunca se crea (0 items procesables) | ⚠️ PARTIAL (ver W-1) |
| 8 | Visibilidad en la tienda | Fila visible por SQL y por HTTP | `GROUP BY source_store` + listado filtrado por `manufacturer.slug:acme` (5 filas) + detalle `HTTP 200` | ✅ COMPLIANT |
| 9 | No regresión sobre el seed | El seed queda intacto tras una corrida | `source_store IS NULL` = 1200 antes y después; `db-check` 48/48 tras la limpieza | ✅ COMPLIANT |

**Compliance summary**: 13/14 escenarios ✅ COMPLIANT · 1 ⚠️ PARTIAL · 0 ❌.
Los 9 requisitos están satisfechos por código **y** evidencia de ejecución
(el 7 con la salvedad W-1). Ningún requisito queda «solo código»: los tres
que el apply declaró así (nombre vacío, marca ausente, violación no
anticipada) se ejecutaron en esta fase.

## Criterios de aceptación de la US

| CA | Enunciado | Evidencia | Resultado |
|---|---|---|---|
| CA-1 | Upsert idempotente por procedencia | (a)+(b) → una fila `1001` con el segundo precio; `actualizados = 1` | ✅ |
| CA-2 | Retailer y marca como filas reales, sin duplicar | `shops.alkosto = 1`, `shops.falabella = 1`, `manufacturers.acme = 1` con 6 items de esas tiendas/marca | ✅ |
| CA-3 | Slug estable y único | mismo item → mismo slug (verificado antes/después del update); homónimos en tiendas distintas → slugs distintos; residual (homónimos en la MISMA tienda → `products_slug_key` → `fallidos`) documentado en la spec y mapeado en `MENSAJES_CONSTRAINT` | ✅ |
| CA-4 | Las constraints no matan la corrida | 5 descartes (4 precondiciones + 1 error de Postgres) con log, contador y corrida viva; el item (l) posterior al error se insertó | ✅ |
| CA-5 | Visible en la tienda | SQL (`GROUP BY`) + HTTP (listado filtrado y dos detalles 200) | ✅ |

### Definición de Done (`docs/product/.../6-pipeline-upsert-products.md`)

| Punto de la DoD | Estado |
|---|---|
| Corrida sintética con salida real pegada (inserta / actualiza / no duplica) | ✅ pegada en la US; re-ejecutada y confirmada en esta fase |
| `SELECT source_store, count(*)` pegado, filas del scraper junto al seed | ✅ |
| Evidencia de CA-4 (item inválido → log + corrida viva) | ✅ en la US; ⚠️ el argumento «los items posteriores se procesaron con éxito» no era demostrable con los 8 items originales (ver W-2). Ahora sí lo es con el (k)→(l) de esta fase |
| Status de la US actualizado y fila del épico marcada | ✅ `Status: Implementada`; columna `Status` añadida al README del épico con `✅ Implementada` en US-6 |
| Datos sintéticos borrados, seed intacto | ✅ verificado dos veces (línea base 0/1200/12/14) |

## Trazabilidad tareas → árbol

Las 23 tareas `[x]` corresponden a cambios reales, no a checkboxes marcados.
`git diff --numstat`:

```text
72	5	docs/product/5-scraper-catalogo-compartido/6-pipeline-upsert-products.md
5	5	docs/product/5-scraper-catalogo-compartido/README.md
223	52	services/scraper-worker/pipelines.py
```

| Tareas | Verificación en el árbol |
|---|---|
| 0.1-0.3 | Gate histórico (no re-ejecutable). **Evidencia superior disponible**: la corrida de esta fase insertó y actualizó por `ON CONFLICT (…) WHERE source_store IS NOT NULL` sin `42P10`, que es exactamente lo que el gate iba a demostrar |
| 1.1 | `parse_calificacion` `pipelines.py:40-53` + `from psycopg.types.json import Jsonb` `:8`; unit checks verdes arriba |
| 1.2 | `imagen_jsonb` `:59-62`; `image->>'original'` poblado en la fila (a) |
| 1.3 | `SQL_TYPE_ID` `:83`, `SQL_SHOP` `:88-92`, `SQL_MANUFACTURER` `:94-98` (tuplas select/insert, sin f-strings de tabla) |
| 1.4 | `_resolver_referencia` `:192-225` (cache por `nombre.strip()`, `None` si vacío, SELECT de respaldo) |
| 1.5 | `UPSERT` viejo (tabla `productos`) eliminado — confirmado en el diff; `UPSERT_PRODUCT` `:101-127` con `RETURNING (xmax = 0)` de UNA columna |
| 1.6 | `open_spider` `:155-186`: `self.type_id` + `ValueError` fail-fast + `self.shops`/`self.manufacturers` + 4.º contador |
| 1.7 | Docstring `:142-153`: catálogo compartido; sin menciones a Mongo ni a `productos` |
| 2.1 | Precondiciones `:233-260` en el orden nombre → enlace → precio, cada una con `warning` + `fallidos` + `return item` |
| 2.2 | Saneo `:262-271` (`>=` → `None`, `promociones_descartadas`) |
| 2.3-2.4 | `fila` + `_resolver_referencia` + `cur.fetchone()[0]` `:279-301` |
| 2.5 | `except psycopg.Error` `:302-306` con `e.diag.constraint_name` y `MENSAJES_CONSTRAINT` `:133-138` |
| 3.1-3.6 | Evidencia en `apply-progress.md`, **re-ejecutada y ampliada** en esta fase |
| 4.1-4.2 | Los dos docs modificados en el diff (77 y 10 líneas) |

**Consistencia numérica del apply** (auditoría de honestidad): las cifras
declaradas cuadran con el árbol — archivo final **308 líneas** (`wc -l` = 308),
diff **+223/-52** (`git diff --numstat` idéntico), origen 137 líneas
(`git show HEAD` = 137). La autocorrección de la cifra 247→308 está declarada
en el propio documento. Las tres correcciones post-revisión están presentes en
el código verificado (construcción de `fila` dentro del `try` `:279-296`,
`RuntimeError` legible `:216-222`, guarda `is_finite()` `:47-50`). El
`shops_id_seq.last_value` corrobora la historia declarada: valía 17 tras la
primera corrida, 19 tras la re-verificación del orquestador, y 21 tras la mía
(dos `shops` por corrida) — coherente, sin filas fantasma.

## Scope

Solo tres archivos modificados, exactamente los previstos:

```text
 M docs/product/5-scraper-catalogo-compartido/6-pipeline-upsert-products.md
 M docs/product/5-scraper-catalogo-compartido/README.md
 M services/scraper-worker/pipelines.py
?? openspec/changes/2026-08-26-pipeline-upsert-products/
```

Intactos, como exige el «NO incluye» de la US: `test_pipeline.py`, `justfile`,
los 6 spiders, `items.py`, `db/schema.sql`, `db/seed.sql`, `packages/db`,
`apps/**` (`git status --porcelain` sobre esas rutas no devuelve nada salvo
`pipelines.py`). `normalizar_enlace` es **byte a byte idéntico** al de `HEAD`
(divergencia D-5 respetada, no «arreglada de paso»).

## Coherence (Design)

| Decisión | ¿Seguida? | Nota |
|---|---|---|
| A — `type_id` por slug en `open_spider`, fail-fast | ✅ | `SELECT id FROM types WHERE slug = 'gadget'`; mensaje literal del design |
| B — promoción incoherente → `sale_price = NULL`, contador propio | ✅ | Evidenciado en (e) |
| C — «sin precio» = `None` **o `<= 0`** | ✅ | Evidenciado en (f) y (h) |
| D — `slugify(nombre \|\| ' ' \|\| tienda)`, fuera del `DO UPDATE` | ✅ | Slug inalterado tras el update |
| E — get-or-create cacheado por corrida, clave = nombre crudo | ✅ | Sin duplicados; `manufacturer_id` NULL sin marca |
| F — precondiciones en Python + backstop de Postgres | ✅ | Overflow real capturado con `str(e)` (constraint `None`) |
| G — `autocommit`, sin transacción por item | ✅ | `psycopg.connect(dsn, autocommit=True)` `:165` |
| H — 4 contadores, invariante exhaustiva | ⚠️ | Se cumple para `psycopg.Error`; una ruta no-psycopg escapa (ver W-3) |
| Mapeo item→columna | ✅ | `price = min_price = max_price`; `ratings` con `COALESCE` solo en INSERT; `image` con `COALESCE` en el UPDATE |

Sin deviaciones de fondo respecto del design. Las dos notas del apply
(gate con `BEGIN`/`ROLLBACK`; columna `Status` creada en el README del épico)
son procedimentales y están declaradas.

## Issues Found

**CRITICAL**: Ninguno.

**WARNING**

- **W-1 — El fail-fast se probó con un stub del `SELECT`, no con una base sin
  sembrar.** Apunté `SQL_TYPE_ID` a `slug = 'gadget-inexistente'` para forzar
  `fetchone() is None`: eso ejercita la rama exacta del fail-fast y prueba el
  mensaje accionable, pero **no** el caso «la tabla `types` no existe», que
  —como ya declaró el apply— sale como `UndefinedTable` crudo, sin el mensaje
  de remediación. Escenario marcado PARTIAL por eso, no por un defecto de
  comportamiento. Coste de cerrarlo del todo: una base desechable sin seed.
- **W-2 — Una frase de la evidencia del apply (y de la DoD de la US) no estaba
  respaldada por su propia corrida.** «Los items posteriores de cada lote se
  procesaron con éxito — prueba de que la corrida siguió viva»: en el lote
  (a)-(h) los descartes (f), (g) y (h) son los **tres últimos** items, así que
  ningún item exitoso los sigue. La afirmación era cierta pero no demostrada
  por esa salida. Queda **subsanada** por esta fase: el item (k) (error de
  Postgres) va seguido del (l), que se insertó. Recomendación: si se archiva la
  US tal cual, ajustar esa frase o citar la evidencia (k)→(l).
- **W-3 — `_resolver_referencia` puede lanzar `RuntimeError`, que NO es
  `psycopg.Error` y por tanto escapa del `try` de `process_item`.** La
  corrección #1 del apply movió la construcción de `fila` dentro del `try`, lo
  que cubre los fallos *de psycopg*; pero el `RuntimeError` explícito de
  `:220-222` (los tres intentos de resolver la referencia sin fila) aborta la
  corrida sin incrementar `fallidos`, rompiendo la invariante de la Decisión H
  en ese camino. **Probabilidad práctica ~nula** (exige que un tercero borre la
  fila entre el INSERT y el SELECT de respaldo) y es un fallo *ruidoso*, no
  silencioso — por eso es WARNING y no CRITICAL. Es una costura del diseño
  «fallar legible», no una regresión.

**SUGGESTION**

- La evidencia de CA-2 en `apply-progress.md` y en la DoD está transcrita como
  comentarios SQL (`-- 1`), no como salida literal de `psql`. Se re-verificó
  aquí con salida real y coincide; para futuras US conviene pegar la tabla de
  `psql` tal cual, como sí se hizo con el resto.
- El listado `GET /api/products` devuelve `manufacturer: null` en el payload
  aunque la fila tenga `manufacturer_id` (el filtro `manufacturer.slug:` sí
  funciona: la marca se usa para filtrar pero no se serializa en la lista). No
  es de esta US —ninguna capa de API se tocó— pero es dato útil para US-7.

**Menores confirmados como «siguen siendo lo que dicen ser»** (declarados y
deliberadamente no accionados; no son hallazgos nuevos): asimetría
`price`/`sale_price` (un `promocion = "0 COP"` daría `sale_price = 0.00`;
inalcanzable hoy) · `self.stats` inexistente si Scrapy llama a `close_spider`
tras el fail-fast (confirmado empíricamente: `stats inicializado: False`) ·
`return item` en vez de `raise DropItem` · `shops.integration.test.ts:17-19`
(`toBe(12)`) y `manufacturers.integration.test.ts:18` (`toBe(14)`) ponen rojo
el gate del repo ante cualquier corrida real de spider — decisión de US-8/US-10,
verificada en esta fase por la vía dura: hubo que limpiar `shops` y
`manufacturers` antes de que `db-check` volviera a pasar.

## Riesgos operativos vigentes

1. **El gate verde del repo es frágil ante el propio scraper** (hallazgo
   sistémico ya elevado): correr un spider real deja filas en `shops`/
   `manufacturers` y `just db-check` se pone rojo. No bloquea esta US, pero
   convierte «corre un spider» en una acción que rompe el CI local hasta
   US-8/US-10.
2. **D-5 (`normalizar_enlace` conserva el query string)** sigue vigente y sin
   corregir, por decisión explícita: en tiendas reales con parámetros volátiles,
   CA-1 puede romperse aunque toda la evidencia sintética pase. Está declarado
   en el design (Open Question #2) y elevado al dueño del repo.
3. `just db-test` / `just db-count` seguirán rojos hasta US-8 (verificado: fallan
   antes de tocar la base, así que no contaminan el catálogo).

## Verdict

**PASS WITH WARNINGS** — los 9 requisitos de la spec y los 5 criterios de
aceptación están satisfechos con evidencia de ejecución real; las 23 tareas
corresponden a cambios reales; el scope se respetó sin excesos; el gate de
regresión queda verde y la base restaurada a su línea base. Las tres
advertencias (fail-fast probado con stub, una frase de evidencia del apply que
su propia corrida no demostraba, y una ruta `RuntimeError` que escapa del
contador `fallidos`) son de precisión y de costura, no de comportamiento: no
bloquean el archivado.
