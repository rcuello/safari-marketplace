# Design: Categorización a slugs del catálogo + filas en `category_product`

> **US-7**, Épico 5 (`docs/product/5-scraper-catalogo-compartido/7-categorizacion-slugs-catalogo.md`).
> Insumos: `proposal.md` y `explore.md` de esta carpeta. Precedente **embarcado**
> (US-6, `f727794`): `../archive/2026-08-28-pipeline-upsert-products/design.md`
> — sus Decisiones A-H y divergencias D-1..D-6 son contexto heredado, no se
> re-deciden aquí.
> **Toda cita `path:line`, columna, slug y símbolo sale de abrir el archivo real.**
> `pipelines.py` se leyó íntegro (308 líneas). Postgres (5433) estaba arriba y se
> usó **solo con `SELECT`**: los ids de las 10 categorías `gadget`, `shops = 12`,
> `manufacturers = 14` y `slug = ANY(%s)` se verificaron contra la base real.
> Las decisiones **B** y **C** las cerró el usuario. La **E** la cierra este design.

## Technical Approach

`services/scraper-worker/pipelines.py` es de nuevo el **único** archivo de
producción. Se añaden: un normalizador de texto, el mapa `RAW_A_SLUG`, la
desambiguación de `audio`, la caché `self.categorias` (`open_spider`) y el
insert puente dentro del `try` de `process_item`. Se **modifican** dos líneas
existentes: el `RETURNING` de `UPSERT_PRODUCT` (`:126`) y su desempaquetado
(`:300`).

Intactos: `parse_numero` (`:21-30`), `parse_calificacion` (`:40-53`),
`imagen_jsonb` (`:59-62`), `normalizar_enlace` (`:65-70`, D-5 de US-6),
`extraer_product_id` (`:73-77`), `_resolver_referencia` (`:192-225`), las
precondiciones y saneos (`:229-273`), el `except psycopg.Error` con
`MENSAJES_CONSTRAINT` (`:302-306`) y `close_spider` (`:188-190`).

Approach 1 del explore (mapeo centralizado), confirmado por la evidencia: las 9
etiquetas crudas (**8 alcanzables hoy**, ver Decisión A) son consistentes entre
los 6 spiders y llegan bajo una clave uniforme, `datos.get("categoria")`
(`items.py:11,25,34,44,53,64`).

## Architecture Decisions

### Decisión A — Mapa `RAW_A_SLUG` centralizado, cerrado y completo

**Elección**: un dict de módulo con las **8 etiquetas deterministas** + una rama
aparte para `audio` (Decisión B). La unión exhaustiva se verificó con un grep de
los `return`/`resultado =` de los 6 spiders: `otros` (15), `computadores` (10),
`tablets`/`pantallas`/`celulares`/`audio` (6 c/u), `impresoras`/`consolas` (5
c/u), `perifericos` (1, solo Falabella — **y neutralizada por su override**,
abajo) y `excluir` (1, descartada antes de crear el item).

| Etiqueta cruda | Slug destino | Id | Origen de la decisión |
|---|---|---|---|
| `computadores` | `laptop` | 181 | `db/README.md:53` (portátiles → `laptop`) |
| `celulares` | `mobiles` | 201 | `db/README.md:54` |
| `pantallas` | `monitor` | 182 | `db/README.md:55` (monitores → `monitor`) |
| `consolas` | `console` | 180 | `db/README.md:56` (gaming/consolas) |
| `audio` | `headphone` (200) \| `sound-box` (204) | | **Decisión B** (no es entrada del dict) |
| `tablets` | `accessories-gfa` | 198 | **resto** — el catálogo no tiene slug de tablet y crear categorías está prohibido |
| `impresoras` | `accessories-gfa` | 198 | **resto** — sin renglón propio en `db/README.md:51-61` |
| `perifericos` | `accessories-gfa` | 198 | `db/README.md:61`; **inalcanzable hoy** (ver abajo) — se mantiene por exhaustividad |
| `otros` | `accessories-gfa` | 198 | **resto**, por definición |
| *desconocida / ausente / `None` / vacía* | `accessories-gfa` | 198 | fallback logueado (CA-1, Gherkin) |

**Los 4 que caen al resto se declaran explícitamente** porque el README no les
da renglón: `tablets`, `impresoras`, `perifericos`, `otros`. Alternativa
rechazada para `tablets`: mandarla a `mobiles`. Se descarta porque `mobiles` es
"Mobiles" (`db/seed.sql:257`), la vertical de teléfonos: inflarla con tablets
mentiría en el filtro que CA-3 debe hacer creíble. `accessories-gfa` es
impreciso pero honesto, y es lo que CA-1 llama "el slug definido como resto".

**`perifericos` NUNCA llega al pipeline** — corrección a explore y proposal, que
la cuentan como 9.ª etiqueta viva. Falabella es su único emisor (`:508-509`),
pero `:516-522` sobrescribe el resultado con `categoria_origen` si no está en
`_CATEGORIAS_PERMITIDAS[origen]`, y **ninguno de los 7 conjuntos contiene
`'perifericos'`** (`:53-61`); como las 11 URLs (`:39-51`) solo usan esos 7
orígenes, `permitidas` siempre es truthy y el override siempre dispara. La fila
se conserva —el mapa debe ser exhaustivo y cuesta cero— pero es **defensa
muerta**. Tiene consecuencia real en la Decisión C.

La columna "Id" es informativa: **el pipeline resuelve por slug, no por id**
(como la Decisión A de US-6 con `gadget`).

### Decisión B — `audio`: una sola lista de keywords (lado audífono) y `sound-box` por defecto

**Cerrada por el usuario** (keywords sobre `nombre`); aquí se fija la forma
mínima y el default. **Elección**: una **única** lista `KEYWORDS_AUDIFONO`; si
el nombre normalizado contiene un término → `headphone`; **en cualquier otro
caso → `sound-box`**. No se codifica la lista del lado parlante.

| Opción | Trade-off | Decisión |
|---|---|---|
| Una lista + default `sound-box` | Regla de 2 líneas, un vocabulario | **Elegida** |
| Dos listas + default | La de parlantes sería **código muerto** | Descartada |
| Default `headphone` | Contradice el vocabulario residual (abajo) | Descartada |
| Sin keywords | Deja un slug vacío para siempre | Descartada (riesgo del proposal) |

**Por qué el default es `sound-box`, con evidencia**: los términos de audio de
los spiders que **no** son de audífono son mayoría y son de equipo de sonido —
`falabella.py:365-452` (`_AUDIO`, 88 líneas: `home theater`, `equipo de
sonido`, `minicomponente`, `tocadiscos`, `radio portatil`, `torre de sonido`,
`partybox`…) y `exito.py:194-213` (`es_audio()`: `bafle `, `karaoke `,
`microfono `, `xboom `…). Lo que se escapa de una lista de audífonos es,
empíricamente, un parlante; con el default al revés, cada `partybox` o
`tocadiscos` entraría como audífono.

**Divergencia declarada del default**: `falabella.py:395-451` son ~35 entradas
de **micrófonos, grabadoras, mezcladoras, walkie-talkies y radios**, y
`exito.py:207,213` añaden `microfono ` y `karaoke `: todo eso se archivará como
`sound-box`. Impreciso y aceptado — no hay slug de audio profesional, crearlo
está prohibido y `accessories-gfa` sería igual de inexacto.

**Vocabulario de `KEYWORDS_AUDIFONO`** — no se inventa, pero **NO es la unión**
de los vocabularios de audio de los spiders: es un **subconjunto elegido** de
`tauretcomputadores.py:183-186`, `falabella.py:369-388,418,422`,
`exito.py:196-211` y `compulago.py:216`, en **raíces singulares sin acento** (la
raíz cubre plural y tilde por subcadena):

```
genéricas:  audifono · auricular · diadema · headset · headphone ·
            earphone · earbud · buds
modelos:    airpods · air pods · jabra · soundpeats · powerbeats ·
            beats studio · beats fit · beats flex · sony wh · sony wf ·
            jbl tune · jbl live · jbl free · jbl reflect · jbl endurance ·
            jbl vibe · jbl wave · wave beam 2 · bose quietcomfort ·
            bose sport · earfun · soundgear frames
```

`audifono` cubre `audifonos`/`audífono`/`audífonos`; `auricular`, `auriculares`;
`buds`, `earbuds`/`galaxy buds`/`freebuds`/`linkbuds`.

**Exclusiones deliberadas** — marcas que fabrican las dos cosas: `beats `
genérico (Beats Pill es parlante), `marshall `, `soundcore`, `sony xb` y
`jbl grip` (parlante portátil), todas en `exito.py:202,205-206`. Incluirlas
mandaría parlantes a `headphone`: falso positivo peor que el residual.
**Consecuencia aceptada**: un `"Beats Solo 4"` sin palabra genérica en el título
cae a `sound-box`. Mismo residual, otra vía: `compuworking.py:191-192` devuelve
`audio` para **todo** su bucket de URL sin mirar el nombre, y su extractor de
marca (`:241`) reconoce `SENNHEISER`/`SKULLCANDY`/`PLANTRONICS`. Acotar ese
vocabulario es de la US que toque spiders, no de ésta.

**Robustez a acentos y plurales**: la comparación pasa por `normalizar_texto()`
(NFKD + descarte de combining marks + `lower()`) — **stdlib, sin dependencia
nueva**. Hace falta: `tauretcomputadores.py:183` emite `'audífono'` con tilde y
el resto sin ella; sin normalizar, "Audífonos Sony WH-1000XM5" caería a
`sound-box`.

El mismo normalizador se aplica a la **etiqueta cruda** antes del `dict.get`.
Hoy las 9 son ASCII en minúscula (verificado): es defensa barata, no necesidad
— neutraliza un futuro `'Periféricos'` sin tocar el mapa.

### Decisión C — `camera`, `router` y `smart-watch` quedan sin cobertura: se acepta y se declara

**Cerrada por el usuario.** 7 de los 10 slugs de `gadget` reciben filas del
scraper (`laptop`, `mobiles`, `monitor`, `console`, `headphone`, `sound-box`,
`accessories-gfa`); 3 no.

**No es un CA-1 incumplido**: CA-1 exige que todo item termine en un slug
**existente**, no que los 10 se llenen. La causa es el vocabulario crudo de los
spiders, que **no distingue** esas tres familias:

- **`smart-watch`**: `exito.py:239-241` mete `'smartwatch '`, `'apple watch'`,
  `'reloj inteligente'`, `'amazfit'`, `'mi band'` dentro de `es_otro()` →
  `otros` → `accessories-gfa`.
- **`router`**: mismo mecanismo — `exito.py:246` reconoce `'router '` y
  `'extensor wifi'`, pero también dentro de `es_otro()`. No es que nadie los
  vea: es que nadie los distingue al etiquetar.
- **`camera`**: igual en Éxito (`:247`, `'camara de seguridad'` → `otros`). En
  Falabella es **peor y hay que decirlo**: `'webcam '`/`'camara web'` (`:456`)
  dan `perifericos`, que el override de `:516-522` convierte en
  `categoria_origen` — una *"Cámara Web Logitech C920"* recogida bajo la URL de
  Computadores termina etiquetada `computadores` y **este pipeline la archiva en
  `laptop`**, no en `accessories-gfa`. Mala clasificación visible en la tienda;
  nace en el spider (fuera de scope) y aquí se **declara**, no se compensa con
  reglas por nombre que CA-1 no pide.

Reclasificarlos exigiría **tocar los spiders**, que el "NO incluye" prohíbe.
US candidata, no accionada aquí.

### Decisión D — `category_id`: `SELECT` read-only, una vez, cacheado, fail-fast

**Elección**: espeja la **Decisión A de US-6** (`type_id`, `pipelines.py:83`,
`:167-176`), **no** la Decisión E (`_resolver_referencia`, `:192-225`): aquí
está **prohibido crear categorías**. Una sola query en `open_spider`, tras
resolver `self.type_id`, que guarda los ids de los **7 slugs destino** en
`self.categorias: dict[str, int]`.

| Opción | Trade-off | Decisión |
|---|---|---|
| `SELECT` de los 7 en `open_spider` + fail-fast | 1 query; falla antes del primer request | **Elegida** |
| Resolver por item | N queries para 7 constantes; N logs que ocultan la causa | Descartada |
| Get-or-create (`_resolver_referencia`) | Crearía categorías: viola CA-1 | Descartada |
| Resolver los 10 de `gadget` | Abortaría por slugs que nunca se escriben (Decisión C) | Descartada |

**Si falta un slug**: se cierra la conexión y se lanza `ValueError` **nombrando
los faltantes**, como el de `gadget` (`:172-175`); el crawl no arranca. La
alternativa sería un `KeyError` por item y una corrida entera de productos sin
categoría — el estado que US-7 viene a cerrar.

**Se filtra por `type_id = self.type_id`, no solo por slug**: `categories.slug`
es `UNIQUE` global (`db/schema.sql:147`), pero atar la búsqueda al type ya
resuelto documenta el contrato y evita colar un homónimo de otra vertical.

### Decisión E — `RETURNING id, (xmax = 0) AS fue_insercion` + desempaquetado **exhaustivo**

La decisión que el proposal dejó abierta (`:96-102`) y que cierra este design.
US-7 **rompe a propósito** la invariante documentada en
`archive/2026-08-28-pipeline-upsert-products/design.md:333-338` (`RETURNING` de
una sola columna: con dos, `cur.fetchone()[0]` leería la columna equivocada y
**todo item se contaría como insertado**, dejando CA-1/CA-2 indemostrables — fue
un bloqueante real de US-6). Se rompe porque `category_product.product_id` es
`NOT NULL REFERENCES products(id)` (`db/schema.sql:309`) y hoy el pipeline **no
expone** el id tras el upsert.

**Las dos mitades, declaradas juntas** — es un cambio atómico, no dos:

```sql
RETURNING id, (xmax = 0) AS fue_insercion      -- pipelines.py:126 (era: solo la 2.ª)
```
```python
producto_id, fue_insercion = cur.fetchone()    # pipelines.py:300 (era: cur.fetchone()[0])
```

**(a) Por qué tupla y no `[0]`/`[1]`**: es lo que **elimina la clase de bug**,
no el orden. El unpacking es exhaustivo — añadir una tercera columna sin tocar
esta línea lanza `ValueError: too many values to unpack` en el **primer** item;
la indexación posicional degrada en silencio, que es lo que ocurrió en US-6.
Todo `RETURNING` futuro debe conservar esta forma.

**(b) Por qué `id` primero**: se evaluó dejar `fue_insercion` en la posición 0
para que un revert parcial a `cur.fetchone()[0]` siguiera leyendo bien. Se
descarta: ese revert deja `producto_id` sin definir y el puente muere con
`NameError` **fuera** del `except psycopg.Error` (`:302`) → la corrida se cae en
el acto con **cualquiera** de los dos órdenes. Como la seguridad la da (a), el
orden se elige por legibilidad: primero la identidad, después el veredicto sobre
ella — el orden en que `process_item` los usa y el que el proposal anticipa
(`:101`).

**(c) Cómo lo detecta la evidencia**: el **reproceso**. La 2.ª corrida debe
imprimir `insertados: 0, actualizados: 12`; si alguien lee `id` como veredicto
(bigint, siempre truthy), saldría `insertados: 12, actualizados: 0` con los
conteos de `category_product` **idénticos** — contradicción en la misma
pantalla. Por eso la DoD exige `actualizados >= 1` **y** el `GROUP BY`.

### Decisión F — El insert puente va **dentro del mismo `try`**, después del upsert

**Elección**: el `DELETE` de saneo y el `INSERT INTO category_product` se
ejecutan en el mismo bloque `with self.conn.cursor() as cur:` (`:298-300`),
justo tras el `fetchone()` del upsert, y **dentro del `try`** abierto en `:279`.

**Rationale**: la misma regla que pone el get-or-create de
`shops`/`manufacturers` dentro del `try` (comentario de `:275-278`): *todo lo
que habla con Postgres cuenta en `fallidos`*. Si el puente escapara, una
violación de FK rompería `process_item` hacia arriba y con ella la invariante de
la Decisión H de US-6 (`insertados + actualizados + fallidos == procesados`).

**La resolución del slug (Python puro) va FUERA del `try`**, junto a los saneos
(`:262-271`): no puede lanzar `psycopg.Error`. La frontera del `try` sigue
significando "aquí empieza la base".

**Consecuencia declarada (D-7)**: con `autocommit=True` el producto ya está
confirmado cuando el puente falla, así que ese item suma en `fallidos` **con su
fila persistida** — la extensión semántica que el proposal anuncia (`:57`).

### Decisión G — `stats`: se conservan los **4** contadores; no se añade ninguno

**Elección**: `insertados`, `actualizados`, `fallidos`,
`promociones_descartadas` (`:180-185`) se mantienen tal cual. **No** se añade un
contador de fallbacks de categoría.

**Rationale**: los cuatro son de dos clases y la categorización no crea una
tercera. Los tres primeros son **exhaustivos del destino del item** y la
invariante los cubre sin cambios (Decisión F). `promociones_descartadas` existe
porque esa política **no deja rastro en los datos** (un `sale_price` saneado a
`NULL` es indistinguible de un producto sin promoción); el fallback de categoría
**sí** lo deja: el `warning` que nombra la etiqueta cruda —lo exige el Gherkin
de CA-1— más la fila en `category_product`. Un quinto contador ampliaría el
`stats` que `close_spider` imprime (`:190`) y que **US-8** tendrá que assertar:
coste en una US ajena por una señal que ya existe. Follow-up anotado, no
accionado: en una corrida de miles de items, `categorias_sin_mapeo` ahorraría
grepear el log.

## SQL concreto

DDL verificado en `db/schema.sql:308-312` (sin columnas extra, sin `CHECK`) y
`:351` (`category_product_categoria_idx`). La **PK compuesta es** el índice
único que soporta el `ON CONFLICT`: no hace falta índice nuevo.

```sql
-- 1. category_id de los 7 slugs destino (una vez por corrida, en open_spider,
--    después de resolver self.type_id). Read-only: NO crea categorías.
SELECT slug, id FROM categories WHERE type_id = %s AND slug = ANY(%s)
```

Verificado contra la base real: con `type_id = 9` devuelve `{console: 180,
laptop: 181, monitor: 182, accessories-gfa: 198, headphone: 200, mobiles: 201,
sound-box: 204}`. `= ANY(%s)` con una `list` de Python funciona en psycopg 3
(se adapta a array) — probado, no supuesto.

```sql
-- 2. saneo: quita la categoría anterior si el item cambió de etiqueta (D-9).
--    Va ANTES del insert y en la misma frontera del try.
DELETE FROM category_product
 WHERE product_id = %(producto_id)s AND category_id <> %(category_id)s

-- 3. fila puente, idempotente (CA-2)
INSERT INTO category_product (product_id, category_id)
VALUES (%(producto_id)s, %(category_id)s)
ON CONFLICT (product_id, category_id) DO NOTHING
```

**A diferencia del `ON CONFLICT` de `products`, este NO lleva `WHERE`**: aquel
infiere un índice **parcial** (`products_procedencia_key`, corrección #1 de
US-6) y por eso repite el predicado; éste infiere una PK total, y añadirle un
`WHERE` sería un error.

**Riesgo del `DELETE`, declarado**: es deliberadamente **agresivo** — borra
*toda* categoría del producto distinta de la calculada, no solo la que dejó una
corrida anterior. Correcto **hoy** por dos hechos verificados: el scraper es el
único escritor de `category_product` (el seed la deja vacía, 0 filas medidas) y
su mapeo es 1:1 (D-9). **Deja de serlo** si el admin, un seed nuevo o una US
posterior asignan varias categorías a un producto: el scraper se las llevaría en
la siguiente corrida. Se acota al `product_id` en curso, nunca a un rango, y
quien introduzca ese escenario debe revisar esta línea. Alternativa rechazada:
filtrar por los 7 ids del scraper — no evita el problema y oculta la intención.

## Estructura de `pipelines.py` tras el change

| Símbolo | Estado | Qué es |
|---|---|---|
| `import unicodedata` | **nuevo** | stdlib; `requirements.txt` no cambia |
| `normalizar_texto(valor)` | **nuevo** (~4 líneas) | `str(valor or "")` → NFKD → sin combining marks → `.lower().strip()`. **`str()` y `.strip()` no son cosméticos**: sin `strip`, `' otros '` cae al fallback; sin `str`, una `categoria` no-`str` lanzaría `TypeError` **fuera** del `try` (Decisión F) y tumbaría la corrida |
| `RAW_A_SLUG` | **nuevo** (dict de 8 entradas) | Decisión A; `audio` NO es entrada (rama propia) |
| `SLUG_RESTO = "accessories-gfa"`; `SLUGS_CATEGORIA: list[str]` (los 7) | **nuevos** | fallback y lista a resolver. **`list`, no `set` ni `tuple`**: psycopg 3 adapta `list` a array (lo que `= ANY(%s)` exige, probado); el `set` no se adapta y la `tuple` va como *record* |
| `KEYWORDS_AUDIFONO`, `slug_de_etiqueta(categoria, nombre)` | **nuevos** (~10 líneas) | Decisión B; devuelve `None` si la etiqueta no está en el mapa — el caller hace el fallback y lo loguea |
| `SQL_CATEGORIA_IDS`, `DELETE_CATEGORY_PRODUCT`, `INSERT_CATEGORY_PRODUCT` | **nuevas** | SQL de arriba |
| `UPSERT_PRODUCT` `:126` | **1 línea modificada** | `RETURNING id, (xmax = 0) AS fue_insercion` |
| `open_spider` `:155-186` | **ampliado** (~10 líneas) | + `self.categorias`, fail-fast por slugs faltantes |
| `process_item` `:227-308` | **ampliado** (~14 líneas) | slug + warning de fallback (fuera del `try`); `producto_id, fue_insercion = cur.fetchone()`, el `DELETE` de saneo y el puente (dentro) |
| Docstring de la clase `:142-153` | **ampliado** | menciona `category_product` y la resolución read-only |
| Todo lo demás | **intacto** | ver Technical Approach |

**~60 líneas netas** + ~10 de docs. `400-line budget risk: Low`; PR único.

## Data Flow

    item ──ItemAdapter().asdict()──▶ process_item
        ├─ precondiciones (nombre/enlace/price)  ──falla──▶ warning + fallidos ─▶ return
        ├─ saneo sale_price >= price             ──▶ warning + promociones_descartadas
        ├─ slug_de_etiqueta(categoria, nombre)   ──None──▶ warning + SLUG_RESTO
        │     └─ 'audio' ─▶ KEYWORDS_AUDIFONO ? headphone : sound-box
        ▼  try:                     (self.categorias resuelto en open_spider)
    INSERT INTO products … ON CONFLICT … DO UPDATE
        │  RETURNING id, (xmax = 0) ← producto_id, fue_insercion = cur.fetchone()
        ├─▶ insertados | actualizados
        ▼
    DELETE FROM category_product WHERE product_id = producto_id
                                   AND category_id <> categorias[slug]   (D-9)
    INSERT INTO category_product … ON CONFLICT DO NOTHING
        └─ psycopg.Error (de las tres) ─▶ diag.constraint_name → fallidos

    ──▶ products.repository.ts:175-177 ──▶ GET /api/products?search=categories.slug:<slug>

## File Changes

| File | Action | Description |
|---|---|---|
| `services/scraper-worker/pipelines.py` | Modify | Único archivo de producción (tabla de arriba). ~60 líneas netas |
| `docs/product/5-scraper-catalogo-compartido/7-categorizacion-slugs-catalogo.md` | Modify | `Status:` de la US (`:9`) |
| `docs/product/5-scraper-catalogo-compartido/README.md` | Modify | fila de US-7 (`:36`) → ✅ Implementada |

Sin cambios: `spiders/**`, `items.py`, `test_pipeline.py`, `justfile`,
`db/schema.sql`, `db/seed.sql`, `requirements.txt`, `packages/db`, `apps/**`.

## Divergencias y limitaciones declaradas (no son bugs; no se corrigen aquí)

- **D-7 — `fallidos` puede contar un producto que SÍ está en la base.** Con
  `autocommit=True`, si el puente falla el `products` ya está confirmado. Se
  acepta para preservar la invariante (Decisión F); rechazado envolver el par en
  `with self.conn.transaction()`, que reintroduce el *cache poisoning* que la
  Decisión G de US-6 evita. **El hueco es autorreparable**: la corrida siguiente
  vuelve por el item, el upsert lo cuenta en `actualizados` y el puente se
  reintenta — ningún producto queda sin categoría de forma permanente.
- **D-8 — la desambiguación de `audio` solo mira el bucket `audio`.** Un
  `'headset gamer'` (`falabella.py:458`) recogido bajo la URL de Audio conserva
  la etiqueta `audio` (el override de `:516-522` no lo saca de ahí) y la
  Decisión B lo manda a `headphone`: correcto. Bajo otra URL hereda el
  `categoria_origen` de esa URL. Lo que el pipeline **no** hace es reclasificar
  por nombre etiquetas ajenas a `audio`.
- **D-9 — 1 producto → 1 fila, garantizado por el `DELETE` de saneo.** El
  puente es 1:1 (`categoria` es escalar en los 6 Items) y **no se propaga ningún
  padre**: las 10 categorías `gadget` son raíces hoja (`parent_id IS NULL` en
  las 10, verificado; `categories.integration.test.ts:101-103`). Pero *entre
  corridas* la etiqueta puede cambiar —el upsert actualiza `name`
  (`pipelines.py:116`) y tanto la Decisión B como `_reclasificar` dependen del
  nombre— y `DO NOTHING` no borra la fila vieja: el producto quedaría en **dos**
  categorías, saldría en los dos filtros de la tienda y cada re-scrapeo
  acumularía más. Lo cierra el `DELETE … WHERE category_id <> %s`.
- **Heredadas y vigentes**: D-1..D-6 de US-6, en particular **D-5**
  (`normalizar_enlace` conserva el query string) — fuera de scope.
- `db/README.md:51-61` sigue sin renglón para `tablets`/`impresoras`/
  `perifericos`/`otros`. No accionado.

## Testing Strategy y Verification Plan (evidencia real de la DoD)

| Layer | Qué se prueba | Cómo |
|---|---|---|
| Unit | `slug_de_etiqueta` (9 etiquetas, audio×2, desconocida, `None`) | en el script, antes de tocar la base |
| Integración | CA-1, CA-2, CA-3 | script de scratchpad contra Postgres real |
| Regresión | `packages/db` | `just db-check` verde **tras la limpieza** |

`test_pipeline.py` es **US-8**: no se toca. El script vive en el scratchpad y
copia el `SpiderFalso` del design de US-6 (`name`, `settings` dict con
`DATABASE_URL`, `logger = self` con `info`/`warning`/`error`).

**Items sintéticos (12)** — todos con `tienda='Alkosto'`, `marca='ACME'`,
`precio` válido y `enlace` único. Ninguno ejercita las precondiciones ni el
saneo de US-6: ya están probados y aquí solo añadirían ruido a `fallidos`.

| # | `categoria` | `nombre` (relevante) | Slug esperado |
|---|---|---|---|
| 1 | `computadores` | — | `laptop` |
| 2 | `celulares` | — | `mobiles` |
| 3 | `pantallas` | — | `monitor` |
| 4 | `consolas` | — | `console` |
| 5 | `audio` | `Parlante Bluetooth JBL Charge 5` | `sound-box` |
| 6 | `audio` | `Audífonos Sony WH-1000XM5` | `headphone` (**prueba de acento**) |
| 7-10 | `tablets`, `impresoras`, `perifericos`†, `otros` | — | `accessories-gfa` (×4) |
| 11 | `electrodomesticos` (inventada) | — | `accessories-gfa` + **warning** |
| 12 | *clave ausente* | — | `accessories-gfa` + **warning** |

† `perifericos` no la produce ningún spider hoy (Decisión A): se incluye para
probar la rama del mapa, no un caso real.

Esperado: 1.ª corrida `insertados: 12, actualizados: 0, fallidos: 0`; 2.ª
`insertados: 0, actualizados: 12` (Decisión E). `GROUP BY`: `accessories-gfa 6`
y 1 en cada uno de `laptop`, `mobiles`, `monitor`, `console`, `sound-box`,
`headphone` = 12, **idéntico en las dos corridas**.

Prerrequisitos: `just db-up`, `just scraper-install`. `psql` no está en el PATH
→ `docker compose exec`; `jq` **no está instalado** → `node -e`; API en el
**9001** (el 9000 es Zscaler); Postgres en el **5433**.

```bash
export SCRATCH="<carpeta de scratchpad de la sesión>"   # sin export, el node -e
                                                        # del paso 4 lee undefined

# 0. línea base (CA-1: no se crea ninguna categoría)
docker compose exec -T postgres psql -U safari -d safari_scraper -c \
 "SELECT count(*) FROM categories"     # esperado: 198 (medido hoy)

# 1. corrida sintética
DATABASE_URL="postgresql://safari:safari@localhost:5433/safari_scraper" \
  services/scraper-worker/.venv/Scripts/python "$SCRATCH/verificar_us7.py"
# CA-1: pegar los 2 warnings de fallback (items 11 y 12) y el stats final

# 2. CA-2 — conteo por slug (lo pide literalmente la DoD)
docker compose exec -T postgres psql -U safari -d safari_scraper -c \
 "SELECT c.slug, count(*) FROM category_product cp
    JOIN categories c ON c.id = cp.category_id GROUP BY 1 ORDER BY 1"

# 3. CA-2 — reproceso: mismo script otra vez. El GROUP BY del paso 2 sale
#    IDÉNTICO y el stats muestra `actualizados: 12` (>= 1). Repetir el count
#    del paso 0: sigue en 198.

# 3-bis. D-9 — reproceso CON EL NOMBRE CAMBIADO: 3.ª corrida en la que el item
#    5 pasa de "Parlante Bluetooth JBL Charge 5" a "Audifonos JBL Tune 520BT"
#    (mismo enlace → mismo source_product_id → misma fila). Repetir el GROUP BY:
#    sound-box baja a 0 y headphone sube a 2. TOTAL sigue en 12, no 13: prueba
#    de que el DELETE de saneo quitó la fila vieja en vez de acumularla.

# 4. CA-3 — por SQL y por HTTP (con `just api-dev`). NO existe `category=`
docker compose exec -T postgres psql -U safari -d safari_scraper -c \
 "SELECT p.name, c.slug FROM products p
    JOIN category_product cp ON cp.product_id = p.id
    JOIN categories c ON c.id = cp.category_id
   WHERE p.source_store IS NOT NULL ORDER BY c.slug"
curl -s "http://localhost:9001/api/products?search=categories.slug:laptop&limit=30" > "$SCRATCH/cat.json"
node -e "const d=require(process.env.SCRATCH+'/cat.json').data; console.log(d.length, d.map(p=>p.slug))"
# Las 1.200 filas del seed NO tienen categorías (category_product: 0 filas,
# medido), así que el resultado son exactamente los scrapeados.

# 5. LIMPIEZA OBLIGATORIA antes del gate (los sintéticos crean shop y marca)
docker compose exec -T postgres psql -U safari -d safari_scraper -c \
 "DELETE FROM products WHERE source_store IS NOT NULL;
  DELETE FROM shops WHERE slug = 'alkosto';
  DELETE FROM manufacturers WHERE slug = 'acme';
  SELECT (SELECT count(*) FROM shops) AS shops,
         (SELECT count(*) FROM manufacturers) AS manufacturers,
         (SELECT count(*) FROM category_product) AS puente"
# esperado: 12 | 14 | 0   ← shops.integration.test.ts:19 asserta toBe(12);
# manufacturers.integration.test.ts:18, toBe(14). A `category_product` no la
# asserta nadie, y su ON DELETE CASCADE (db/schema.sql:309-310) la vacía sola
# al borrar los productos: por eso no lleva DELETE propio.
# El SELECT final es VERIFICACIÓN, no adorno: los dos DELETE asumen que los 12
# items llevan tienda='Alkosto'. Si a alguno se le olvida, pipelines.py:230 cae
# a `spider.name` y crea un segundo shop que sobrevive a la limpieza — el 12|14
# lo delata ANTES de que falle db-check. No convertirlo en un DELETE ciego.

# 6. no regresión
just db-check      # debe quedar verde, con salida pegada
```

`just db-test` y `just db-count` **seguirán rojos** (apuntan a `productos`,
`justfile:296,301`): estado heredado de US-6, lo arregla **US-8**.

## Migration / Rollout

Sin migración, sin cambio de esquema, sin dependencias nuevas (`unicodedata` es
stdlib) y sin build. Rollback: `git revert` — el pipeline vuelve al estado
embarcado de US-6 (productos sin categoría), funcional. Datos: aditivo sobre una
tabla que el seed deja vacía; `DELETE FROM category_product;` la devuelve a como
la entrega `just db-up`, o `just db-reset` en el extremo.

## Open Questions

Ninguna bloquea la implementación. Las decisiones 1 y 2 del proposal las cerró
el usuario (B y C); la 3, este design (E): `sdd-apply` puede escribir el `if` de
`audio`. `Decision needed before apply: No` — PR único de ~70 líneas; el
forecast del guard lo emite `sdd-tasks`.
