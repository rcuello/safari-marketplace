# Verification Report

**Change**: `2026-08-28-categorizacion-slugs-catalogo` (US-7)
**Version**: N/A (specs sin versionar)
**Mode**: Standard (`strict_tdd: false`)
**Fecha**: 2026-08-31
**Artefactos leídos**: `proposal.md`, `specs/scraper-product-categorization/spec.md`,
`specs/scraper-product-ingestion/spec.md` (delta), `design.md`, `tasks.md`,
`apply-progress.md`, `docs/product/5-scraper-catalogo-compartido/7-categorizacion-slugs-catalogo.md`,
`services/scraper-worker/pipelines.py`, los 6 spiders (solo lectura).

## Resumen

Las **9 requisitos** de la spec nueva y el **requisito MODIFIED** de la delta de
`scraper-product-ingestion` quedan **satisfechos por código Y evidencia de
ejecución**. Esta fase **cerró los tres huecos que el apply declaró
honestamente** (fallo del insert puente, fail-fast por slug faltante, fallback
exhaustivo): los tres se ejercitaron contra la base real, de forma reversible, y
la base quedó en su línea base exacta.

Se encontró **un defecto nuevo** que ni la auditoría del design ni la revisión
post-apply detectaron: un comentario preexistente quedó huérfano y ahora
documenta el bloque equivocado (W-1). Es cosmético, no funcional.

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 21 |
| Tasks complete | 21 |
| Tasks incomplete | 0 |
| Tareas `[x]` con cambio real verificado en `git diff` | 21 / 21 |

Comprobación tarea por tarea contra `git diff` (no contra el checkbox):

| Tarea | Evidencia en el diff |
|---|---|
| 1.1 | `import unicodedata` (`pipelines.py:3`) + `normalizar_texto` (`:66-74`), entre `imagen_jsonb` y `normalizar_enlace` |
| 1.2 | `RAW_A_SLUG` 8 entradas (`:101-110`), `SLUG_RESTO` (`:112`), `SLUGS_CATEGORIA` `list` de 7 (`:117-125`) |
| 1.3 | `KEYWORDS_AUDIFONO` 30 términos (`:137-168`) + `slug_de_etiqueta` (`:171-183`) |
| 1.4 | `SQL_CATEGORIA_IDS` (`:232`), `DELETE_CATEGORY_PRODUCT` (`:238-241`), `INSERT_CATEGORY_PRODUCT` (`:246-250`) |
| 1.5 | `self.categorias` + rama `faltantes` con `ValueError` y `conn.close()` (`:307-318`) |
| 1.6 | Docstring ampliado (`:277-281`) |
| 2.1 | `RETURNING id, (xmax = 0)` (`:224`) + `producto_id, fue_insercion = cur.fetchone()` (`:462`) |
| 2.2 | Resolución de slug + warning FUERA del `try` (`:417-427`) |
| 2.3 | `DELETE` + `INSERT` dentro del mismo `try`/cursor (`:473-475`) |
| 2.4 | `except psycopg.Error` (`:477-481`) y `MENSAJES_CONSTRAINT` (`:256-261`) sin tocar en el diff |
| 3.1-3.7 | Reproducidas íntegramente por esta fase (ver Evidencia) |
| 4.1 | Limpieza reproducida; base en línea base |
| 4.2 | `just db-check` reproducido, verde |
| 4.3 | `git diff` de la US: `Status: Listo para ejecución` → `Implementada`, 4 ítems de DoD `[ ]`→`[x]` con salida pegada |
| 4.4 | `git diff` del README del épico: fila US-7 → `✅ Implementada` |

## Scope

`git status --short` + `git diff --name-only`: **exactamente 3 archivos**.

```
 M docs/product/5-scraper-catalogo-compartido/7-categorizacion-slugs-catalogo.md
 M docs/product/5-scraper-catalogo-compartido/README.md
 M services/scraper-worker/pipelines.py
?? openspec/changes/2026-08-28-categorizacion-slugs-catalogo/
```

Diff restringido a las rutas que debían quedar intactas → **0 archivos**:

```
$ git diff --name-only -- services/scraper-worker/spiders services/scraper-worker/items.py \
    db/ apps/ packages/ justfile services/scraper-worker/test_pipeline.py .claude/ | wc -l
0
```

Funciones heredadas de US-6, comparadas por hash contra `HEAD`:

```
parse_numero: IDENTICA (e504f8ba)
parse_calificacion: IDENTICA (8baaf450)
imagen_jsonb: IDENTICA (cb8bdb82)
normalizar_enlace: IDENTICA (617f578b)
extraer_product_id: IDENTICA (628bd705)
_resolver_referencia: IDENTICA (a2172007)
```

Scope **limpio**. `normalizar_enlace` y `openspec-convention.md` intactos.

## Build & Tests Execution

**Tests**: ✅ 48 passed / 0 failed (`just db-check`, ejecutado **dos veces**:
antes y después de toda la escritura sintética)

```text
$ just db-check      # corrida final, tras la limpieza
> @safari/db@0.1.0 typecheck
> tsc --noEmit
(sin errores)

> @safari/db@0.1.0 test
> vitest run
 Test Files  6 passed (6)
      Tests  48 passed (48)
   Start at  10:15:30
   Duration  11.53s
```

**Build**: ➖ no ejecutado. El change no toca TypeScript (solo Python + Markdown);
`just build` compila shop+admin, sin relación con el diff. Se registra como
dimensión omitida deliberadamente.

**Coverage**: ➖ no disponible (`coverage_threshold: 0`, `coverage_command: ""`).

**Estado de la base al terminar** (obligatorio por el contrato de sesión):

```text
 products_total | scraped | shops | manufacturers | puente | categories
----------------+---------+-------+---------------+--------+------------
           1200 |       0 |    12 |            14 |      0 |        198
```

Idéntico a la línea base. `SELECT id, name FROM shops ORDER BY id LIMIT 1` →
`1 | Furniture Shop` (el `shops.integration.test.ts` que asserta `items[0].id`
pasa: 48/48 verde tras la limpieza).

## Spec Compliance Matrix — `scraper-product-categorization` (9 requisitos)

Sin suite automatizada para el pipeline (es US-8): el "covering test" es la
ejecución real contra Postgres, que es lo que `rules.verify.require_evidence` y
`testing.test_command` del `config.yaml` establecen como gate de este repo.

| # | Requisito | Scenario | Evidencia ejecutada | Result |
|---|-----------|----------|---------------------|--------|
| R1 | Todo item resuelve a un slug existente, nunca inventado | Etiqueta reconocida + resto, sin crear categorías | `verificar_us7.py` (12 items) + `SELECT count(*) FROM categories` = 198 en las 3 corridas | ✅ COMPLIANT |
| R2 | Fallback exhaustivo a `accessories-gfa` | 5 variantes: desconocida, clave ausente, `None`, `""`, `"   "` | `verify_gaps_us7.py fallback` — **las 5**, cada una con su warning nombrando el valor | ✅ COMPLIANT |
| R3 | Desambiguación de `audio` por keywords | `headphone` vs `sound-box`, sin warning | Corrida 1: items 5 y 6 → `sound-box`/`headphone`, 0 warnings entre los 12 (solo los 2 del fallback) | ✅ COMPLIANT |
| R4 | Fila idempotente en `category_product` | Reprocesar no duplica; `actualizados` sube | Corrida 2: `actualizados: 12`, `GROUP BY` byte a byte idéntico, total puente 12 | ✅ COMPLIANT |
| R5 | Una única categoría vigente entre corridas (D-9) | Cambio de nombre mueve la categoría | Corrida 3-bis: `sound-box` → 0 filas, `headphone` 1→2, total 12 (no 13), y **1 sola fila** para `source_product_id='70005'` | ✅ COMPLIANT |
| R6 | Fail-fast si falta un slug esperado | Aborta antes del primer item, nombrando el faltante | `verify_gaps_us7.py failfast` — `ValueError` con el slug nombrado, `conn.closed = True`, 0 items | ✅ COMPLIANT |
| R7 | Fallo del insert puente cuenta en `fallidos` y la corrida sigue | Fallo + producto persistido + re-scrape repara | `verify_gaps_us7.py puente` — `fallidos: 1`, producto id 1375 vivo, item siguiente OK, re-scrape recrea la fila sin duplicar `products` | ✅ COMPLIANT |
| R8 | El filtro por categoría devuelve los categorizados | SQL y HTTP devuelven lo mismo | `SELECT` con join + `curl :9001/api/products?search=categories.slug:<slug>` para 3 slugs: conteos y nombres idénticos; `category=` confirmado como **ignorado** | ✅ COMPLIANT |
| R9 | No regresión sobre catálogo y seed | 198 categorías / 1200 del seed | Medido tras cada corrida y al cierre | ✅ COMPLIANT |

**Compliance summary**: 9/9 requisitos con evidencia de ejecución (era 6/9 al
cierre del apply; esta fase cerró R2 al 100 %, R6 y R7).

## Spec Compliance Matrix — delta `scraper-product-ingestion`

| Requisito | Scenario | Evidencia ejecutada | Result |
|-----------|----------|---------------------|--------|
| MODIFIED: Captura de violaciones de constraint no anticipadas | Item fuera de rango no aborta la corrida | `overflow_us7.py` — `numeric field overflow`, `fallidos: 1`, el item siguiente entra con `insertados: 1` | ✅ COMPLIANT |
| MODIFIED: (misma) | Fallo del insert puente cuenta en `fallidos` aunque el producto ya esté persistido | `verify_gaps_us7.py puente` — ver R7 | ✅ COMPLIANT |
| MODIFIED Purpose / MODIFIED Out of Scope (secciones no estándar) | — | Prosa; no verificable por ejecución. La delta declara el hueco de convención y la resolución manual para `sdd-archive` | ⚠️ Ver W-8 |

## Criterios de aceptación de la US

| CA | Enunciado | Veredicto |
|----|-----------|-----------|
| CA-1 | Todo item termina en un slug existente del type `gadget`; lo no mapeable cae a `accessories-gfa`, nunca a categoría inventada | ✅ Satisfecho. 17 items sintéticos, 0 categorías creadas (198 constante). Verificado además que `set(RAW_A_SLUG.values()) ∪ {headphone, sound-box} ⊆ SLUGS_CATEGORIA` → `True`: no existe slug alcanzable fuera del cache, luego el `self.categorias[slug]` de `:473` **no puede** lanzar `KeyError` (que escaparía del `except psycopg.Error`) |
| CA-2 | El upsert crea idempotentemente la fila en `category_product`; reprocesar no duplica | ✅ Satisfecho. Corrida 2 y 3-bis: total puente constante en 12 |
| CA-3 | Un `SELECT` por `categories.slug` devuelve los productos scrapeados de esa categoría | ✅ Satisfecho por SQL **y** por HTTP en 3 slugs |

### Definición de Done, punto por punto

| Ítem DoD | Veredicto |
|---|---|
| Corrida sintética con items de las ~9 categorías del mapeo, salida real pegada | ✅ Reproducida literalmente (12 items = 8 etiquetas de `RAW_A_SLUG` + `audio`×2 + desconocida + ausente) |
| `GROUP BY` de `category_product` pegado | ✅ Reproducido idéntico |
| Evidencia de CA-2 (reproceso sin duplicados) + prueba de saneo D-9 | ✅ Reproducida, y **reforzada**: además del total 12, se comprobó que el producto renombrado tiene exactamente 1 fila puente |
| Status de la US y fila del épico actualizados | ✅ Verificado en `git diff` |

## Correctness (evidencia estática adicional)

| Punto | Estado | Nota |
|---|---|---|
| `RAW_A_SLUG` cubre el vocabulario real de los 6 spiders | ✅ Verificado | Las etiquetas que los spiders emiten son exactamente 9: `otros`(13), `computadores`(7), `tablets`(5), `pantallas`(5), `celulares`(5), `audio`(5), `impresoras`(4), `consolas`(4) y `perifericos` (`falabella.py:509`, `tauretcomputadores.py:176`). `GENERICA` es un default de **marca**, no de categoría. `gamers`/`portatiles` de Tauret se normalizan dentro del spider antes de llegar al item. No hay etiqueta cruda sin ruta |
| Normalización de la etiqueta | ✅ Verificado | `'AUDIO'`, `'  audio  '`, `'periféricos'`, `123`, `['otros']` → todos resuelven sin `TypeError` |
| Normalización del nombre (tildes) | ✅ Verificado | `'Audífonos Sony WH-1000XM5'` → `headphone` |
| El puente no toca `MENSAJES_CONSTRAINT` | ✅ Verificado | Sin cambios en el diff; el error del puente cae al `str(e)` genérico, que resultó legible (`violates foreign key constraint ...`) |

## Coherence (Design)

| Decisión | ¿Seguida? | Notas |
|---|---|---|
| A — `RAW_A_SLUG` centralizado y cerrado (8 entradas) | ✅ Sí | Verbatim |
| B — `audio` por keywords, `sound-box` por defecto | ✅ Sí | Lista replicada término por término (30) |
| C — `camera`/`router`/`smart-watch` sin cobertura | ✅ Sí | Decisión cerrada por el usuario; declarada en Known Limitations |
| D — `SELECT` read-only, cacheado, fail-fast | ✅ Sí | Ahora **probado por ejecución**, no solo por lectura |
| E — `RETURNING id, (xmax = 0)` + desempaquetado exhaustivo | ✅ Sí | El test de detección que el propio design propone (reproceso → `actualizados: 12`) sale correcto |
| F — Puente dentro del mismo `try` | ✅ Sí | Probado: la FK violada cae en el `except` y suma `fallidos` |
| G — 4 contadores, ninguno nuevo | ✅ Sí | — |
| Data Flow (orden del incremento de `stats`) | ⚠️ Desviación **justificada** | Confirmo el veredicto de la revisión post-apply, ahora **con evidencia**: en la corrida del puente el item falló y quedó `insertados: 1, actualizados: 0, fallidos: 1` sobre 2 items procesados — el item roto contó **una sola vez**. Con el orden del diagrama habría contado dos veces y `insertados + actualizados + fallidos == procesados` sería falso. La desviación implementa D-7; el diagrama del design es el que estaba en contradicción con sus propias Decisiones F y G |

## Auditoría de honestidad de `apply-progress.md`

Se reprodujo **toda** la evidencia pegada por el apply. Resultado:

| Evidencia del apply | ¿Reproducida? |
|---|---|
| Ids cacheados de los 7 slugs | ✅ Idénticos (`console:180, laptop:181, monitor:182, accessories-gfa:198, headphone:200, mobiles:201, sound-box:204`) |
| Corrida 1: `{insertados: 12, actualizados: 0, fallidos: 0}` + 2 warnings | ✅ Salida byte a byte igual |
| `GROUP BY` de CA-2 (7 filas) | ✅ Idéntico |
| Corrida 2: `{insertados: 0, actualizados: 12}` | ✅ Idéntico |
| 3-bis: `sound-box`→0, `headphone`→2, total 12 | ✅ Idéntico |
| CA-3 SQL (12 filas) y HTTP | ✅ Reproducido (con más slugs) |
| Limpieza `12 | 14 | 0` | ✅ Idéntico |
| `just db-check` 6/48 | ✅ Idéntico |

**No hay salida inventada.** Dos inexactitudes menores, ambas de contabilidad,
no de hechos → ver W-2.

Se confirman también, como pedía el contrato, los **menores ya conocidos** (no
son hallazgos nuevos): `earfun`/`jabra` (W-4), ventana destroy-then-fail (W-3),
desplazamiento semántico de `insertados`/`actualizados` (W-5), `RuntimeError`
fuera del `except` (W-6).

## Evidencia (salida real de comandos)

### E-1. Corrida 1 — 12 items sintéticos

```text
$ DATABASE_URL=... .venv/Scripts/python.exe verificar_us7.py
  [info] Conectado a Postgres; spider: prueba-us7

category_id cacheados: {'console': 180, 'laptop': 181, 'monitor': 182, 'accessories-gfa': 198, 'headphone': 200, 'mobiles': 201, 'sound-box': 204}

  [warning] Item 'Licuadora Oster': categoria 'electrodomesticos' no mapea a un slug conocido, se usa el resto (accessories-gfa)
  [warning] Item 'Item sin categoria': categoria None no mapea a un slug conocido, se usa el resto (accessories-gfa)
  [info] Postgres resumen: {'insertados': 12, 'actualizados': 0, 'fallidos': 0, 'promociones_descartadas': 0}

stats finales: {'insertados': 12, 'actualizados': 0, 'fallidos': 0, 'promociones_descartadas': 0}
```

```text
      slug       | count
-----------------+-------
 accessories-gfa |     6
 console         |     1
 headphone       |     1
 laptop          |     1
 mobiles         |     1
 monitor         |     1
 sound-box       |     1
(7 rows)

 total_puente |  categories  | seed_products
--------------+--------------+---------------
           12 |          198 |          1200
```

### E-2. Corrida 2 — reproceso (R4 / CA-2)

```text
  [info] Postgres resumen: {'insertados': 0, 'actualizados': 12, 'fallidos': 0, 'promociones_descartadas': 0}
stats finales: {'insertados': 0, 'actualizados': 12, 'fallidos': 0, 'promociones_descartadas': 0}
```
`GROUP BY` idéntico al de E-1 (7 filas, mismos conteos); `total_puente` 12; `categories` 198.

### E-3. Corrida 3-bis — D-9 (R5)

```text
stats finales: {'insertados': 0, 'actualizados': 12, 'fallidos': 0, 'promociones_descartadas': 0}

      slug       | count
-----------------+-------
 accessories-gfa |     6
 console         |     1
 headphone       |     2
 laptop          |     1
 mobiles         |     1
 monitor         |     1
(6 rows)

 total_puente | filas_item5
--------------+-------------
           12 |           1
```

`filas_item5` es una comprobación que el apply no hizo: el producto renombrado
(`source_product_id = '70005'`) tiene **exactamente una** fila puente, no dos.

### E-4. HUECO CERRADO 1 — fail-fast por slug faltante (R6)

Método reversible, sin tocar el catálogo: se parchea el módulo para **esperar**
un slug que no existe, en vez de borrar uno real.

```text
$ .venv/Scripts/python.exe verify_gaps_us7.py failfast
SLUGS_CATEGORIA parcheada: ['laptop', 'mobiles', 'monitor', 'console', 'headphone', 'sound-box', 'accessories-gfa', 'slug-que-no-existe-us7']

ValueError levantado por open_spider:
Faltan slugs de categoria en la base: ['slug-que-no-existe-us7']. El catalogo no esta sembrado completo.
Corre `just db-up` (o `just db-reset` si la base quedo a medias).

conexion cerrada: True
items procesados: 0
```

Cumple las tres exigencias del scenario: aborta **antes del primer item**,
**nombra** el faltante, y **no crea** nada (198 categorías intactas).

### E-5. HUECO CERRADO 2 — fallo del insert puente (R7 + delta de ingestion)

Método reversible y sin tocar el catálogo: tras `open_spider` se sustituye en el
cache `self.categorias['laptop']` por un id inexistente, con lo que el
`INSERT INTO category_product` viola la FK real.

```text
$ .venv/Scripts/python.exe verify_gaps_us7.py puente

--- paso 1: corrida sana (crea producto + fila puente) ---
stats: {'insertados': 1, 'actualizados': 0, 'fallidos': 0, 'promociones_descartadas': 0}
producto_id / filas puente tras paso 1: (1375, 1)

--- paso 2: se rompe el category_id cacheado de `laptop` ---
self.categorias['laptop']: 181 -> 999999999 (inexistente)

--- paso 3: reproceso del MISMO item (el puente debe fallar) ---
  [error] Error guardando 'Puente victima': insert or update on table "category_product" violates foreign key constraint "category_product_category_id_fkey"
DETAIL:  Key (category_id)=(999999999) is not present in table "categories".
stats: {'insertados': 1, 'actualizados': 0, 'fallidos': 1, 'promociones_descartadas': 0}
producto persistido / filas puente tras el fallo: (1375, 'Puente victima', 0)

--- paso 4: el SIGUIENTE item se procesa con exito ---
stats: {'insertados': 2, 'actualizados': 0, 'fallidos': 1, 'promociones_descartadas': 0}

--- paso 5: re-scrape con el cache reparado repara la fila ---
stats: {'insertados': 2, 'actualizados': 1, 'fallidos': 1, 'promociones_descartadas': 0}
filas en products para 80011 (no debe duplicar): 1
slugs puente de 80011 tras el re-scrape: [('laptop',)]
```

Se demuestran **cinco** cosas del scenario, todas a la vez:
1. el fallo del puente suma `fallidos` (0 → 1);
2. **no** suma también en `insertados`/`actualizados` — la invariante
   `insertados + actualizados + fallidos == procesados` se sostiene (2+1+1 = 4
   items procesados). Esto valida la desviación del Data Flow **por ejecución**;
3. la fila de `products` (id 1375) **permanece persistida** por `autocommit`;
4. la corrida **continúa**: el item siguiente entra con éxito;
5. un re-scrape posterior sin el error **crea la fila pendiente sin duplicar
   `products`** (1 fila, slug `laptop`).

Y confirma empíricamente el menor conocido de la **ventana destroy-then-fail**:
tras el fallo el producto pasó de 1 fila puente a **0** — perdió la que tenía
(ver W-3).

### E-6. HUECO CERRADO 3 — fallback exhaustivo, las 5 variantes (R2)

```text
$ .venv/Scripts/python.exe verify_gaps_us7.py fallback
  [warning] Item 'V1 etiqueta desconocida': categoria 'electrodomesticos' no mapea a un slug conocido, se usa el resto (accessories-gfa)
  [warning] Item 'V2 clave ausente': categoria None no mapea a un slug conocido, se usa el resto (accessories-gfa)
  [warning] Item 'V3 categoria None': categoria None no mapea a un slug conocido, se usa el resto (accessories-gfa)
  [warning] Item 'V4 categoria vacia': categoria '' no mapea a un slug conocido, se usa el resto (accessories-gfa)
  [warning] Item 'V5 categoria solo espacios': categoria '   ' no mapea a un slug conocido, se usa el resto (accessories-gfa)
stats: {'insertados': 5, 'actualizados': 0, 'fallidos': 0, 'promociones_descartadas': 0}
```
```text
            name            |      slug
----------------------------+-----------------
 V1 etiqueta desconocida    | accessories-gfa
 V2 clave ausente           | accessories-gfa
 V3 categoria None          | accessories-gfa
 V4 categoria vacia         | accessories-gfa
 V5 categoria solo espacios | accessories-gfa
(5 rows)

 categories: 198
```

Las 5 caen al resto, **cada una con su propio warning nombrando el valor
recibido**, como exige el scenario. (El apply solo había ejecutado 2 contra la
base; el revisor cubrió las otras offline. Ahora las 5 están probadas end-to-end.)

### E-7. Overflow (scenario heredado del requisito MODIFIED)

```text
  [error] Error guardando 'Overflow precio': numeric field overflow
DETAIL:  A field with precision 12, scale 2 must round to an absolute value less than 10^10.
stats tras el overflow: {'insertados': 0, 'actualizados': 0, 'fallidos': 1, 'promociones_descartadas': 0}
stats tras el siguiente: {'insertados': 1, 'actualizados': 0, 'fallidos': 1, 'promociones_descartadas': 0}
```

### E-8. CA-3 / R8 — SQL vs HTTP, tres slugs

```text
$ for s in laptop headphone accessories-gfa; do curl -s ".../api/products?search=categories.slug:$s&limit=50" ... done
--- slug: laptop ---
HTTP count: 2
Laptop Lenovo IdeaPad | Puente victima
--- slug: headphone ---
HTTP count: 2
Audifonos JBL Tune 520BT | Audífonos Sony WH-1000XM5
--- slug: accessories-gfa ---
HTTP count: 11
Cargador generico 65W | Impresora HP LaserJet | Item sin categoria | Licuadora Oster | Mouse Logitech M170 | Tablet Samsung Tab A9 | V1 etiqueta desconocida | V2 clave ausente | V3 categoria None | V4 categoria vacia | V5 categoria solo espacios
```
```text
      slug       | count |  string_agg
-----------------+-------+--------------------------------------------------------------
 accessories-gfa |    11 | Cargador generico 65W | Impresora HP LaserJet | Item sin categoria | Licuadora Oster | Mouse Logitech M170 | Tablet Samsung Tab A9 | V1 etiqueta desconocida | V2 clave ausente | V3 categoria None | V4 categoria vacia | V5 categoria solo espacios
 headphone       |     2 | Audifonos JBL Tune 520BT | Audífonos Sony WH-1000XM5
 laptop          |     2 | Laptop Lenovo IdeaPad | Puente victima
```

Los dos canales devuelven **exactamente** el mismo conjunto en los 3 slugs.
Y el `MUST NOT requerir un query param category=` de R8 queda confirmado:

```text
$ curl ".../api/products?category=laptop&limit=50"   -> http=200
con category= devuelve 50 productos (sin filtrar => el param se ignora)
```

### E-9. Desambiguación de `audio` y normalización (offline, sin base)

```text
'audio'          'Audífonos Sony WH-1000XM5'              -> 'headphone'
'AUDIO'          'audifonos genericos'                    -> 'headphone'
'  audio  '      'Parlante JBL Charge 5'                  -> 'sound-box'
'audio'          'Parlante Bluetooth JBL Charge 5'        -> 'sound-box'
'audio'          'EarFun UBOOM Parlante Bluetooth'        -> 'headphone'   <-- W-4
'audio'          'Jabra Speak 750 Altavoz de conferencia' -> 'headphone'   <-- W-4
'audio'          'Marshall Emberton Parlante'             -> 'sound-box'
'audio'          'Soundcore Liberty 4 earbuds'            -> 'headphone'
'PERIFERICOS'    'Mouse'                                  -> 'accessories-gfa'
'periféricos'    'Mouse con tilde'                        -> 'accessories-gfa'
'electrodomesticos' 'Licuadora'                           -> None
None / '' / '   ' / 123 / ['otros']                       -> None

destinos de RAW_A_SLUG subset de SLUGS_CATEGORIA: True
```

### E-10. Limpieza y estado final

```text
 source_store | count
--------------+-------
 Alkosto      |    19
DELETE 19  -- products WHERE source_store IS NOT NULL
DELETE 1   -- shops WHERE slug IN (...)
DELETE 1   -- manufacturers WHERE slug='acme'

 products_total | scraped | shops | manufacturers | puente | categories
----------------+---------+-------+---------------+--------+------------
           1200 |       0 |    12 |            14 |      0 |        198
```

`just api-dev` se levantó para E-8 y **se apagó**: `taskkill` con SUCCESS y
`netstat` sin listener en 9001 (`curl` final → exit 7). Nunca se usó el 9000.

## Issues Found

**CRITICAL**: Ninguno.

**WARNING**:

- **W-1 (NUEVO — no detectado por la auditoría del design ni por la revisión
  post-apply)**: *comentario huérfano en `pipelines.py`*. El bloque preexistente
  de 3 líneas `# Tuplas (select, insert) para el get-or-create de
  _resolver_referencia. / # El slug lo calcula la base (slugify)...`
  (`pipelines.py:127-129`) documentaba `SQL_SHOP`/`SQL_MANUFACTURER`. El apply
  insertó `KEYWORDS_AUDIFONO` **entre ese comentario y el código que describe**,
  sin línea en blanco: hoy ese comentario se lee como cabecera de
  `KEYWORDS_AUDIFONO` (con la que no tiene nada que ver) y `SQL_SHOP`, ahora en
  `:186`, quedó sin comentario. Confirmado en el diff (hunk `@@ -87,0 +130,56 @@`).
  Cosmético, cero impacto funcional, pero engañoso en un archivo cuyo valor
  didáctico está en los comentarios. Arreglo de una línea: mover esas 3 líneas
  justo encima de `SQL_SHOP`.
- **W-2**: *contabilidad desactualizada en `apply-progress.md`*. Declara
  `+169/-2` en `pipelines.py`; el real es **`+180/-5`**. Y la revisión
  post-apply afirma que "el change borra **solo 2 líneas** en todo
  `pipelines.py`", que ya no es cierto. Los números **reconcilian exactamente**:
  la corrección posterior del orquestador (reescritura del comentario de la
  invariante) borró 3 líneas más y añadió 11. No es evidencia inventada —es un
  artefacto escrito antes de la corrección y no re-medido—, pero como
  `apply-progress.md` es parte del audit trail, conviene rectificarlo antes de
  archivar. La conclusión de fondo del revisor (funciones de US-6 intactas) **se
  sostiene**: se verificó por hash.
- **W-3**: *ventana destroy-then-fail, ahora **probada**, no teórica*. E-5 paso 3
  muestra el producto pasando de 1 fila puente a **0**: el `DELETE` de saneo se
  confirma (autocommit) y el `INSERT` falla después. El design no la prevé.
  Riesgo práctico bajo y auto-reparable en el siguiente scrapeo (E-5 paso 5),
  pero debe subir a la spec/design junto a D-7 al archivar, ya no como hipótesis
  sino como comportamiento observado.
- **W-4**: *`earfun` y `jabra` producen falsos positivos hacia `headphone`*
  (E-9). Confirmado como el menor ya conocido: el código replica la lista del
  design término por término; la inconsistencia es del design. Decisión de
  producto, no se acciona aquí.
- **W-5**: *desplazamiento semántico de `insertados`/`actualizados`*: ya no
  cuentan filas escritas en `products` sino items ingeridos por completo (E-5
  paso 3 lo hace visible: el producto 1375 está en la base y no cuenta como
  insertado). **US-8 va a assertar sobre ese `stats`**: debe quedar escrito en la
  spec o el design al archivar, no solo en `apply-progress.md`.
- **W-6**: *`RuntimeError` de `_resolver_referencia` escapa del
  `except psycopg.Error`* (W-3 heredado del verify de US-6). Ya declarado con
  honestidad en el comentario de `:433-440` tras la corrección del orquestador.
  No accionado; correcto no ampliar el `except` en esta US.
- **W-7**: *no queda ninguna prueba automatizada de regresión para este código*.
  Toda la evidencia de esta US son scripts de scratchpad, que desaparecen con la
  sesión. `just db-test` sigue rojo (esperado, US-8). Nada impide que un cambio
  futuro rompa la categorización en silencio hasta que US-8 aterrice. Es la
  deuda de mayor valor que deja el change.
- **W-8**: *la delta de `scraper-product-ingestion` usa secciones no estándar*
  (`## MODIFIED Purpose`, `## MODIFIED Out of Scope`). `openspec-convention.md`
  no las define, así que `sdd-archive` **no puede aplicarlas mecánicamente**: hay
  que hacerlo a mano. La delta lo declara explícitamente; se confirma como
  pendiente real para la fase de archivo.

**SUGGESTION**:

- Al archivar, mover a `Known Limitations` de la spec el hecho —ahora medido— de
  que `category_product` pasa de 0 filas del seed a contener **solo** productos
  scrapeados: por eso el filtro por slug es un test limpio hoy, y dejará de serlo
  cuando alguien categorice el seed.
- `just db-test`/`db-count` siguen rojos: **confirmado como esperado**, no
  regresión (el pipeline nunca dejó de escribir en `products`; lo roto es el
  harness, alcance de US-8).

## Verdict

**PASS WITH WARNINGS**

Los 9 requisitos de `scraper-product-categorization` y el requisito MODIFIED de
`scraper-product-ingestion` están satisfechos por código **y** por evidencia de
ejecución real —incluidos los tres huecos que el apply declaró abiertos, cerrados
en esta fase—; el scope es exacto (3 archivos, ninguna ruta prohibida tocada), las
21 tareas corresponden a cambios reales, y la base quedó en su línea base con
`just db-check` en 48/48. Los warnings son un defecto cosmético nuevo (W-1), una
contabilidad desactualizada en el audit trail (W-2), tres menores ya conocidos que
deben subir de `apply-progress.md` a la spec/design al archivar (W-3, W-5, W-8) y
la deuda de cobertura automatizada que US-8 ya tiene asignada (W-7). Ninguno
bloquea el archivo.
