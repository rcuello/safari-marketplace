# Apply Progress: Categorización a slugs del catálogo + `category_product` (US-7)

**Change**: `2026-08-28-categorizacion-slugs-catalogo`
**Mode**: Standard (strict_tdd: false)
**Status**: 21/21 tasks complete. Ready for verify.

## Completed Tasks

### Phase 1: Fundamentos en `pipelines.py`
- [x] 1.1 `import unicodedata`; `normalizar_texto(valor)` (NFKD sin combining marks, `.lower().strip()`), añadido antes de `normalizar_enlace`.
- [x] 1.2 `RAW_A_SLUG` (8 entradas), `SLUG_RESTO`, `SLUGS_CATEGORIA` (`list[str]`, 7 slugs), junto a `SQL_TYPE_ID`.
- [x] 1.3 `KEYWORDS_AUDIFONO` (30 términos, con las exclusiones deliberadas del design) + `slug_de_etiqueta(categoria, nombre)`.
- [x] 1.4 `SQL_CATEGORIA_IDS`, `DELETE_CATEGORY_PRODUCT`, `INSERT_CATEGORY_PRODUCT` (SQL literal del design, verbatim).
- [x] 1.5 `open_spider`: tras `self.type_id`, `self.categorias = dict(cur.fetchall())` vía `SQL_CATEGORIA_IDS`; fail-fast (`ValueError`, cierra conexión) nombrando faltantes.
- [x] 1.6 Docstring de `PostgresPipeline` ampliado: menciona `category_product` y la resolución read-only.

### Phase 2: Puente hacia `category_product` en `process_item`
- [x] 2.1 `UPSERT_PRODUCT` → `RETURNING id, (xmax = 0) AS fue_insercion`; desempaquetado → `producto_id, fue_insercion = cur.fetchone()` (cambio atómico, verificado con el reproceso).
- [x] 2.2 Fuera del `try`, junto a los saneos: `slug = slug_de_etiqueta(...)`; si `None`, `warning` con el valor crudo y `slug = SLUG_RESTO`.
- [x] 2.3 Dentro del mismo `try`/cursor, tras `producto_id`: `DELETE_CATEGORY_PRODUCT` seguido de `INSERT_CATEGORY_PRODUCT`.
- [x] 2.4 Confirmado: el `except psycopg.Error` existente ya cubre el puente; `MENSAJES_CONSTRAINT` no se tocó.

### Phase 3: Verificación de integración (evidencia DoD)
- [x] 3.1 Script sintético en scratchpad: `SpiderFalso` (con `warning` añadido) + 12 items.
- [x] 3.2 Corrida 1: `stats` e insercion.
- [x] 3.3 CA-2: `GROUP BY` por slug.
- [x] 3.4 Corrida 2 (reproceso): `GROUP BY` idéntico, `actualizados: 12`.
- [x] 3.5 Paso 3-bis (D-9): renombrado del item 5, `sound-box`→0, `headphone`→2, total 12.
- [x] 3.6 CA-3: SQL + HTTP.
- [x] 3.7 No regresión: `categories` = 198 en las 3 corridas.

### Phase 4: Limpieza y cierre documental
- [x] 4.1 Limpieza de sintéticos + `SELECT` de verificación.
- [x] 4.2 `just db-check` verde.
- [x] 4.3 `docs/product/.../7-categorizacion-slugs-catalogo.md`: `Status` → Implementada, DoD con evidencia.
- [x] 4.4 `docs/product/.../README.md`: fila US-7 → ✅ Implementada.

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `services/scraper-worker/pipelines.py` | Modified | +169/-2 líneas (`git diff --stat`). Añadidos: `normalizar_texto`, `RAW_A_SLUG`, `SLUG_RESTO`, `SLUGS_CATEGORIA`, `KEYWORDS_AUDIFONO`, `slug_de_etiqueta`, `SQL_CATEGORIA_IDS`, `DELETE_CATEGORY_PRODUCT`, `INSERT_CATEGORY_PRODUCT`, resolución de `self.categorias` fail-fast en `open_spider`, resolución de slug + insert puente (DELETE saneo + INSERT idempotente) en `process_item`. Modificados: `RETURNING` de `UPSERT_PRODUCT` (2 columnas) y su desempaquetado. |
| `docs/product/5-scraper-catalogo-compartido/7-categorizacion-slugs-catalogo.md` | Modified | `Status:` → Implementada; DoD marcada `[x]` con evidencia real pegada. |
| `docs/product/5-scraper-catalogo-compartido/README.md` | Modified | Fila US-7 → ✅ Implementada. |
| `openspec/changes/2026-08-28-categorizacion-slugs-catalogo/tasks.md` | Modified | 21/21 tareas marcadas `[x]`. |

`wc -l pipelines.py` tras el cambio: 475 (era 308). `git diff --stat`: 169 insertions(+), 2 deletions(-) — bien dentro del `400-line budget: Low` del forecast (el estimado del tasks.md era ~75-90; el real es mayor por comentarios en el estilo denso ya existente del archivo, no por lógica extra).

## Deviations from Design

Una precisión de implementación, no un desvío del SQL/estructura que pide el design:

- **Orden del incremento de `stats["insertados"/"actualizados"]` respecto al puente.** El diagrama de Data Flow del design muestra el incremento inmediatamente después de `fetchone()`, antes del `DELETE`/`INSERT` del puente. Implementé el incremento **después** de que las tres sentencias (`UPSERT_PRODUCT`, `DELETE_CATEGORY_PRODUCT`, `INSERT_CATEGORY_PRODUCT`) se ejecuten sin excepción, todas dentro del mismo `with self.conn.cursor()`. Razón: si el incremento fuera inmediato y el puente fallara después, el item contaría en `insertados`/`actualizados` **y** en `fallidos` a la vez, rompiendo la invariante `insertados + actualizados + fallidos == procesados` que la Decisión G y D-7 del propio design dicen preservar ("se acepta para preservar la invariante"). Con el orden implementado, cualquier excepción de las tres sentencias salta al `except` sin pasar por el incremento, y el item cuenta exactamente una vez (en `fallidos`), igual que en el pipeline pre-US-7. No se pudo probar el camino de fallo del puente con datos sintéticos (exigiría forzar una violación de FK/constraint deliberada, fuera del alcance de la evidencia pedida), así que esta decisión queda declarada aquí para que `sdd-verify` la revise contra el design si lo considera necesario.

Ningún otro desvío: el SQL, los nombres de símbolos, los 8 slugs de `RAW_A_SLUG`, el vocabulario de `KEYWORDS_AUDIFONO`, la ubicación del `DELETE` antes del `INSERT`, y la frontera del `try` siguen el design al pie de la letra.

## Issues Found

- **Puerto 9001 tuvo un proceso `node.exe` (PID 61728) escuchando al empezar la verificación**, pese a que el contexto de la sesión indicaba "puerto 9001 libre, `just api-dev` NO está corriendo". Respondió correctamente a una consulta de prueba, pero se cayó (`Connection refused`) segundos después sin que yo lo tocara — no era un proceso mío, probablemente un remanente de otra sesión que terminó por su cuenta. Levanté `just api-dev` yo mismo (como indicaban las instrucciones), esperé la compilación (~70s en modo watch) y usé ese proceso (PID 21256) para el CA-3 HTTP. Lo apagué con `taskkill /F /PID 21256` al terminar; verificado con `netstat` que el puerto quedó libre (solo conexiones en `TIME_WAIT`, no un listener). No debería haber interferencia con otros agentes, pero se reporta por la discrepancia con el estado inicial declarado.
- Dos `curl` intermedios contra el 9001 fallaron con `Connection refused` (exit 7) mientras Nest seguía recompilando en modo watch; reintentos inmediatos funcionaron. No se investigó más a fondo por ser transitorio y no bloquear la evidencia.

## Evidence (real command output)

### 0. Línea base (antes de tocar nada)
```
$ SELECT count(*) FROM categories;      -> 198
$ SELECT count(*) FROM shops;           -> 12
$ SELECT count(*) FROM manufacturers;   -> 14
$ SELECT count(*) FROM category_product;-> 0
$ SELECT count(*) FROM products WHERE source_store IS NOT NULL; -> 0
```
Ids de los 7 slugs destino verificados contra la base real (coincide con el design):
`{accessories-gfa: 198, console: 180, headphone: 200, laptop: 181, mobiles: 201, monitor: 182, sound-box: 204}` bajo `type_id = 9` (`gadget`).

### 1. Corrida 1 (12 items sintéticos)
```
  [info] Conectado a Postgres; spider: prueba-us7

category_id cacheados: {'console': 180, 'laptop': 181, 'monitor': 182, 'accessories-gfa': 198, 'headphone': 200, 'mobiles': 201, 'sound-box': 204}

  [warning] Item 'Licuadora Oster': categoria 'electrodomesticos' no mapea a un slug conocido, se usa el resto (accessories-gfa)
  [warning] Item 'Item sin categoria': categoria None no mapea a un slug conocido, se usa el resto (accessories-gfa)
  [info] Postgres resumen: {'insertados': 12, 'actualizados': 0, 'fallidos': 0, 'promociones_descartadas': 0}

stats finales: {'insertados': 12, 'actualizados': 0, 'fallidos': 0, 'promociones_descartadas': 0}
```

### 2. CA-2 — GROUP BY por slug (tras corrida 1)
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
(7 rows)
```

### 3. CA-2 — reproceso (corrida 2, mismos 12 items, sin cambios)
```
  [warning] Item 'Licuadora Oster': categoria 'electrodomesticos' no mapea a un slug conocido, se usa el resto (accessories-gfa)
  [warning] Item 'Item sin categoria': categoria None no mapea a un slug conocido, se usa el resto (accessories-gfa)
  [info] Postgres resumen: {'insertados': 0, 'actualizados': 12, 'fallidos': 0, 'promociones_descartadas': 0}
```
`GROUP BY` idéntico al de la corrida 1 (7 filas, mismos conteos). `SELECT count(*) FROM categories` sigue en 198.

### 3-bis. D-9 — reproceso con el item 5 renombrado
Item 5: `"Parlante Bluetooth JBL Charge 5"` → `"Audifonos JBL Tune 520BT"` (misma `enlace`, mismo `source_product_id`).
```
  [info] Postgres resumen: {'insertados': 0, 'actualizados': 12, 'fallidos': 0, 'promociones_descartadas': 0}
```
```
      slug       | count
-----------------+-------
 accessories-gfa |     6
 console         |     1
 headphone       |     2
 laptop          |     1
 mobiles         |     1
 monitor         |     1
(6 rows)

 total_puente
--------------
           12
```
`sound-box` desapareció (0 filas), `headphone` subió de 1 a 2, total en `category_product` se mantuvo en 12 (no 13) — el `DELETE` de saneo (D-9) funciona: quita la fila vieja en la misma operación que crea la nueva.

### 4. CA-3 — SQL
```
           name            |      slug
---------------------------+-----------------
 Item sin categoria        | accessories-gfa
 Tablet Samsung Tab A9     | accessories-gfa
 Impresora HP LaserJet     | accessories-gfa
 Mouse Logitech M170       | accessories-gfa
 Cargador generico 65W     | accessories-gfa
 Licuadora Oster           | accessories-gfa
 Consola PlayStation 5     | console
 Audifonos JBL Tune 520BT  | headphone
 Audífonos Sony WH-1000XM5 | headphone
 Laptop Lenovo IdeaPad     | laptop
 Celular Samsung A55       | mobiles
 Monitor LG 27 pulgadas    | monitor
(12 rows)
```

### 4. CA-3 — HTTP
```
$ curl -s "http://localhost:9001/api/products?search=categories.slug:laptop&limit=30" -o cat.json
$ node -e "const d=require(process.env.SCRATCH+'/cat.json').data; console.log(d.length, JSON.stringify(d.map(p=>({name:p.name, slug:p.slug}))))"
1 [{"name":"Laptop Lenovo IdeaPad","slug":"laptop-lenovo-ideapad-alkosto"}]
```
Coincide con el `SELECT` (1 producto en `laptop`).

### 5. Limpieza
```
DELETE 12   -- products WHERE source_store IS NOT NULL
DELETE 1    -- shops WHERE slug = 'alkosto'
DELETE 1    -- manufacturers WHERE slug = 'acme'

 shops | manufacturers | puente
-------+---------------+--------
    12 |            14 |      0
```

### 6. No regresión — `just db-check`
```
> @safari/db@0.1.0 typecheck
> tsc --noEmit
(sin errores)

> @safari/db@0.1.0 test
> vitest run

 Test Files  6 passed (6)
      Tests  48 passed (48)
   Start at  09:48:33
   Duration  10.32s
```

## Remaining Tasks
Ninguna. 21/21 completas.

## Workload / PR Boundary
- Mode: single PR
- Current work unit: US-7 completa (Fases 1-4)
- Boundary: change completo, autocontenido, verificado end-to-end
- Estimated review budget impact: 171 líneas (`+169/-2`) en `pipelines.py` + 2 archivos de docs con cambios triviales. Bien por debajo del budget de 400 líneas.

## Revisión independiente post-apply (gatekeeper del orquestador)

Un revisor de contexto fresco auditó la implementación contra el design y las
dos specs. **Veredicto: APROBADO CON CORRECCIONES — ningún defecto bloqueante.**

Verificaciones independientes destacadas: los 7 ids de categoría cacheados
coinciden **exactamente** con los de la base (y su orden es el natural por id,
no un dict tecleado a mano); `cat.json` del scratchpad es una respuesta real de
la API (`id:1292`, `shop.id:22 Alkosto`, `type.id:9`); la cronología de los
archivos es coherente (script 09:41 → `cat.json` 09:47 → `db-check` 09:48 →
este reporte 09:50). **Sin señales de salida inventada.** Confirmó también que
el change borra **solo 2 líneas** en todo `pipelines.py` — las dos previstas por
la Decisión E — lo que prueba que `parse_numero`, `normalizar_enlace`,
`extraer_product_id` y `_resolver_referencia` quedaron intactos.

### La desviación del Data Flow: confirmada como correcta

El revisor validó que mover el incremento de `insertados`/`actualizados` a
después del puente **no rompe D-7: lo implementa**. Con el orden del diagrama
del design (`design.md:348`), un fallo del puente sumaría en `insertados` **y**
en `fallidos`, y D-7 ("suma en `fallidos` con su fila ya persistida") sería
falso. El Data Flow del design era internamente contradictorio con su propia
Decisión F y con D-7; la desviación resuelve la contradicción a favor de las
decisiones.

### Corrección aplicada por el orquestador

> **Contabilidad rectificada (W-2 del verify)**: las cifras `+169/-2` que este
> reporte declaraba para `pipelines.py` quedaron obsoletas al aplicarse las
> correcciones post-revisión. El diffstat real y final es **`+180/-5`**
> (`git diff --numstat`); el change completo son 3 archivos, **211
> inserciones / 11 borrados**. Reconcilia así: −2 de la Decisión E, −3/+11 de
> la corrección del comentario de la invariante, y −0/+... de la reubicación
> del comentario de `SQL_SHOP`. Sigue muy por debajo del guard de 400.

| # | Archivo | Corrección |
|---|---------|-----------|
| 1 | `pipelines.py` | El comentario de la frontera del `try` afirmaba que la invariante `insertados + actualizados + fallidos == procesados` se cumple sin matices. Es falso para una ruta: `_resolver_referencia` levanta `RuntimeError`, que **no** es `psycopg.Error` y escapa. Comentario reescrito para declarar el hueco en vez de sobrevender. **No se amplió el `except`**: el fallo es inalcanzable en la práctica y ruidoso, no silencioso, y ampliarlo cambiaría comportamiento de US-6 recién auditado. Es el W-3 que el verify de US-6 ya dejó registrado. |

### Menores NO accionados (elevados al dueño del repo)

- **`earfun` y `jabra` son falsos positivos del mismo tipo que las exclusiones
  deliberadas.** Probado por ejecución: `('audio','EarFun UBOOM Parlante
  Bluetooth')` y `('audio','Jabra Speak 750 Altavoz de conferencia')` →
  `headphone`. Ambas son marcas duales (earbuds **y** parlantes), justo el
  criterio por el que el design excluyó `marshall `, `soundcore` y `beats `
  genérico. **El código NO se desvía**: replica la lista del design término por
  término. Es una inconsistencia del **design**, heredada fielmente. No se
  corrige aquí porque quitar `jabra` mandaría los Jabra Elite (earbuds, mucho
  más frecuentes en estos retailers que un speakerphone de conferencia) a
  `sound-box`: es un intercambio de falsos positivos por falsos negativos, y
  esa es una decisión de producto.
- **Ventana destroy-then-fail no prevista por el design**: con `autocommit`, si
  el `DELETE` del puente tiene éxito y el `INSERT` falla, el producto queda sin
  ninguna fila puente **habiendo perdido la que tenía**. Riesgo práctico bajo
  (el `INSERT` solo puede fallar por FK/PK, ambas imposibles con un
  `producto_id` recién devuelto y un `category_id` validado en `open_spider`).
  Declarar junto a D-7 al archivar; no cambiar código.
- **Desplazamiento semántico de `insertados`/`actualizados`**: tras la
  desviación ya no cuentan "filas escritas en `products`" sino "items ingeridos
  por completo". **US-8 va a assertar sobre ese `stats`**, así que debe subir a
  la spec o al design al archivar, no quedarse solo aquí.

### Cobertura declarada con honestidad

**Código + evidencia**: slug existente sin crear categorías · desambiguación de
`audio` · fila idempotente · única categoría vigente (D-9) · filtro por SQL y
HTTP · no regresión (198 categorías / 1200 del seed).

**Evidencia parcial**: el fallback exhaustivo (el script ejercita 2 de las 5
variantes que la spec nombra; el revisor cubrió las otras 3 offline con el
intérprete del venv, sin tocar la base: `None`, `''`, `'   '` y hasta un
`int` → todas al fallback).

**Solo código, sin evidencia de ejecución**: fail-fast por slug faltante
(exigiría borrar una categoría) · fallo del insert puente contando en
`fallidos` (exigiría forzar una violación de FK). Declarados, no dados por
verificados.

### Segunda corrección (hallazgo del `sdd-verify`)

El `sdd-verify` encontró un defecto que ni el apply ni el revisor vieron: el
comentario `# Tuplas (select, insert) para el get-or-create de
_resolver_referencia…` documentaba `SQL_SHOP`, pero el apply insertó
`KEYWORDS_AUDIFONO` entre el comentario y su código, dejándolo encabezando el
bloque equivocado y a `SQL_SHOP` sin comentario. **Corregido**: el comentario
volvió sobre `SQL_SHOP`. Cosmético, sin cambio de comportamiento —
reconfirmado re-ejecutando el script sintético (`insertados: 12`, idéntico) y
`just db-check` (48/48), con la base restaurada a
`1200 / 0 / 12 / 14 / 0 / 198`.

## Status
21/21 tasks complete + las dos correcciones post-revisión aplicadas y
re-verificadas. Ready for archive.
