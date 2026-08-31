# Exploration: US-7 — Categorización a slugs del catálogo + `category_product`

> Fuente: `docs/product/5-scraper-catalogo-compartido/7-categorizacion-slugs-catalogo.md`
> (leída completa) y su épico `docs/product/5-scraper-catalogo-compartido/README.md`.
> Toda cita `path:line` sale de abrir el archivo real; Postgres (5433) estaba
> arriba y se usó solo con `SELECT` (nada escrito).

## Current State

### 1. `pipelines.py` post-US-6 (308 líneas, leído completo)

`services/scraper-worker/pipelines.py` ya tiene el patrón a espejar:
- `SQL_TYPE_ID = "SELECT id FROM types WHERE slug = 'gadget'"` (`:83`), resuelto
  **una sola vez** en `open_spider` (`:167-176`) con fail-fast (`ValueError`) si
  `gadget` no está sembrado.
- `_resolver_referencia(sql, cache, nombre)` (`:192-225`): get-or-create
  cacheado por corrida para `shops`/`manufacturers`. **No aplica tal cual a
  categorías**: es un patrón de *crear si no existe*, y US-7 tiene prohibido
  crear categorías. El precedente correcto a espejar es **`type_id`** (Decisión
  A del design de US-6): resolución **read-only**, una vez, fail-fast.
- `UPSERT_PRODUCT` (`:101-127`) hace `RETURNING (xmax = 0) AS fue_insercion`
  — **una sola columna, a propósito** (ver design US-6, sección "SQL concreto":
  "Añadir el slug exige cambiar las dos cosas a la vez"). **Hallazgo clave**:
  hoy el pipeline **no expone el `id` del producto** tras el upsert, y
  `category_product` lo necesita como FK. `process_item` desempaqueta con
  `cur.fetchone()[0]` (`:300`). US-7 tendrá que ampliar el `RETURNING` a
  `RETURNING id, (xmax = 0) AS fue_insercion` y el desempaquetado a
  `producto_id, fue_insercion = cur.fetchone()`.
- `process_item` (`:227-308`): precondiciones → saneo → construcción de `fila`
  dentro del `try` → upsert → `except psycopg.Error` con
  `MENSAJES_CONSTRAINT` vía `e.diag.constraint_name` (`:302-306`). El insert de
  `category_product` deberá ir **dentro del mismo `try`**, después del upsert
  de `products`, para que un fallo también cuente en `fallidos` (mantiene la
  invariante `insertados+actualizados+fallidos == procesados`).
- Contadores en `self.stats` (`:180-185`): `insertados`, `actualizados`,
  `fallidos`, `promociones_descartadas`. Ninguno cuenta categorización hoy.

### 2. Qué produce `categorizar()` en los 6 spiders — exhaustivo

Todos los `Item` (`items.py:11,25,34,44,53,64`) declaran el mismo campo
`categoria = scrapy.Field()`, así que el pipeline puede leer
`datos.get("categoria")` de forma uniforme sin importar el spider — dato clave
a favor del mapeo centralizado.

| Spider | Función | Líneas | Etiquetas que puede devolver |
|---|---|---|---|
| `alkosto.py` | `categorizar(nombre, enlace, imagen)` | `:99-125` | `celulares`, `pantallas`, `impresoras`, `tablets`, `computadores`, `otros` (catch-all) |
| `compulago.py` | `_categorizar_por_nombre(nombre, enlace)` | `:203-220` | `tablets`, `celulares`, `impresoras`, `pantallas`, `computadores`, `audio`, `consolas`, `otros` (catch-all); además `categoria_fija` viene fijada por URL (`:28-38`, `:183`) para las páginas ya segmentadas |
| `compuworking.py` | `categorizar(nombre, categoria_destino)` | `:135-209` | `computadores`, `otros`, `tablets`, `celulares`, `pantallas`, `audio`, `consolas`, `impresoras`; **tiene fallback exhaustivo** `return 'otros'` al final (`:209`) |
| `exito.py` | `categorizar_estricto(nombre)` | `:127-312` | `computadores`, `celulares`, `tablets`, `pantallas`, `audio`, `consolas`, `impresoras`, `otros`. Puede devolver `None` (línea de electrodomésticos, `:131-133`) — pero el caller (`:109-110`) descarta el item entero (`return None`) antes de que llegue al pipeline, así que `categoria` **nunca** es `None`/ausente en un item que sí llega a `process_item` |
| `falabella.py` | `_reclasificar(nombre, categoria_origen)` | `:483-524` | `otros`, `impresoras`, `tablets`, `celulares`, `consolas`, `computadores`, `pantallas`, `audio`, `perifericos`, y `excluir`. `excluir` también se descarta antes del `item` (`:756-758`), igual que Éxito con `None` |
| `tauretcomputadores.py` | `categorizar(nombre, categoria_destino)` | `:164-189` | `computadores`, `pantallas`, `consolas`, `audio`, `otros`. **Hallazgo menor**: la función NO tiene un `return` final fuera del último `if` (`:176-189`) — si `categoria_destino` no es ninguno de `computadores/portatiles/pantallas/gamers/perifericos`, devuelve `None` implícito. **Hoy es inalcanzable**: `self.CATEGORIAS` (`:15-20`) solo contiene esos 5 valores. Fragilidad latente si se agrega una 6.ª categoría de origen sin tocar `categorizar()`, no un bug activo — se menciona, no se corrige (fuera del scope de spiders) |

**Unión exhaustiva de etiquetas que de verdad llegan a `process_item`** (excluyendo `excluir`/`None`, que se descartan antes de crear el `item`):
`computadores`, `celulares`, `tablets`, `pantallas`, `impresoras`, `audio`, `consolas`, `perifericos`, `otros` — **9 valores**, exactamente lo que la Definición de Done de la US anticipa ("~9 categorías del mapeo").

**Cuánto divergen**: los 6 spiders usan nombres consistentes para el mismo
concepto (`computadores`, `celulares`, `tablets`, `pantallas`, `impresoras`,
`audio`, `consolas`, `otros`); solo Falabella añade `perifericos` como bucket
propio. No hay sinónimos cruzados (p. ej. uno usando `celular` y otro
`telefono` como valor de retorno) — la divergencia está en **cómo deciden**
la etiqueta (keywords de nombre+enlace vs. `categoria_destino` fijado por la
URL de origen), no en el vocabulario de salida.

### 3. Slugs reales del catálogo bajo `type` `gadget`

`db/seed.sql:71` tiene **una única** sentencia `INSERT INTO categories (id,
name, slug, icon, details, image, type_id, language)` — nótese que **no
incluye `parent_id`** en absoluto. Las 10 filas con `type_id = 9` (`gadget`,
confirmado en `db/seed.sql:40`) son:

| id | slug | Etiqueta que el README dice que debería alimentarla |
|---|---|---|
| 180 | `console` (`seed.sql:251`) | gaming / consolas |
| 181 | `laptop` (`:252`) | portátiles |
| 182 | `monitor` (`:253`) | monitores |
| 198 | `accessories-gfa` (`:254`) | periféricos y demás |
| 199 | `camera` (`:255`) | cámaras |
| 200 | `headphone` (`:256`) | audio / parlantes |
| 201 | `mobiles` (`:257`) | celulares |
| 202 | `router` (`:258`) | redes |
| 203 | `smart-watch` (`:259`) | relojes |
| 204 | `sound-box` (`:260`) | audio / parlantes |

`db/README.md:51-61` **coincide exactamente** con estas 10 filas (9 renglones
de tabla, uno de ellos — audio — mapea a 2 slugs = 10 categorías, que es lo
que el README llama "diez categorías" en `:47`). No hay discrepancia entre el
README y el seed.

**Hallazgo — el README no cubre 2 de las 9 etiquetas reales, y 3 de sus 10
slugs son inalcanzables con las etiquetas que los spiders producen hoy:**
- `tablets` (la producen 4 de 6 spiders) y `impresoras`/`perifericos`/`otros`
  **no tienen renglón propio** en la tabla del README. Interpretación
  consistente con CA-1 ("un valor no mapeable cae en `accessories-gfa`"): caen
  al resto. No es una contradicción, pero si el design no lo declara
  explícitamente, alguien puede leerlo como un vacío del README.
- `camera`, `router` y `smart-watch` **nunca van a recibir una fila de
  `category_product` desde el scraper tal como está**: ningún `categorizar()`
  de los 6 spiders devuelve una etiqueta cruda de "cámaras", "redes" ni
  "relojes" — los productos de reloj/smartwatch que sí aparecen (p. ej. la
  lista `es_otro()` de `exito.py:239-241`, que incluye `'smartwatch'`, `'apple
  watch'`, `'reloj inteligente'`) terminan clasificados como `otros` (un
  accesorio genérico), no como una categoría de reloj distinguible por el
  pipeline sin tocar los spiders (fuera de scope). Es una limitación real y
  declarable, no un bug: 7 de 10 slugs sí son alcanzables (`laptop`,
  `mobiles`, `monitor`, `console`, `headphone`, `sound-box`,
  `accessories-gfa`); 3 quedan sin productos del scraper.

**Hallazgo — ambigüedad real en "audio"**: la etiqueta cruda `audio` (la
emiten los 6 spiders, aunque con nombres de función distintos) debe repartirse
entre DOS slugs del catálogo, `headphone` y `sound-box`, y **ningún spider
distingue auriculares de parlantes** al generar la etiqueta — es un único
bucket. El design necesita una regla de desambiguación (p. ej. por keywords en
`nombre`: `parlante|altavoz|bocina|soundbar|subwoofer` → `sound-box`;
`audifono|auricular|headset|earphone|buds` → `headphone`; algo → default), o
aceptar conscientemente que todo `audio` cae a uno solo de los dos slugs. No
es decidible solo con la etiqueta cruda tal como llega hoy.

### 4. DDL de `category_product`

`db/schema.sql:308-312`:
```sql
CREATE TABLE IF NOT EXISTS category_product (
    product_id   bigint  NOT NULL REFERENCES products(id)   ON DELETE CASCADE,
    category_id  bigint  NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (product_id, category_id)
);
```
Sin columnas extra, sin `CHECK`. La PK compuesta **es** el índice único que
soporta `ON CONFLICT (product_id, category_id) DO NOTHING` — upsert idempotente
trivial, cumple CA-2 sin lógica adicional. Índice adicional
`category_product_categoria_idx ON category_product (category_id)`
(`schema.sql:351`) respalda el filtro por categoría en sentido inverso
(categoría → productos). `ON DELETE CASCADE` en ambos lados: si el test
sintético borra los productos de prueba (`DELETE FROM products WHERE
source_store IN (...)`, patrón de US-6), sus filas de `category_product` se
limpian solas — no hace falta un `DELETE` separado.

Confirmado **vacía en el seed**: `db/seed.sql:1650` la comenta como
"`category_product` — deliberadamente VACÍA"; no hay ningún
`INSERT INTO category_product` en el archivo (grep sin resultados).

### 5. Consumo del filtro por categoría (frontend/API)

`apps/api/rest/src/products/products.service.ts:37,83-84`: el parser
`parseProductSearch` reconoce el token `categories.slug:<slug>` dentro del
query param **`search`** (no existe un query param literal `category=`, esa
forma del CA-3/README es una simplificación). Fluye a
`ListProductsInput.categorySlug` (`:84`) →
`packages/db/src/repositories/products.repository.ts:175-177`:
```ts
...(input.categorySlug && {
  categories: { some: { category: { slug: input.categorySlug } } },
}),
```
Esto **ya sale de Postgres** (Prisma, relación `Product.categories:
CategoryProduct[]`, `schema.prisma:183,195-205`) — no del mock JSON. Hoy
devuelve cero resultados **porque `category_product` está vacía**, no porque
el endpoint falte. **CA-3 se puede cerrar por HTTP** una vez existan filas:
`GET /api/products?search=categories.slug:<slug>` (mismo patrón de verificación
que usó US-6 con `manufacturer.slug`, ver
`openspec/changes/archive/2026-08-28-pipeline-upsert-products/design.md:510`).

### 6. Cardinalidad producto↔categoría

`category_product` es N:N por diseño (PK compuesta), pero **el pipeline del
scraper solo tiene una etiqueta cruda por item** (`datos.get("categoria")` es
un valor escalar en los 6 `items.py`, no una lista). Con el mapeo raw→slug
propuesto, cada item resuelve a **como mucho un slug** (salvo la ambigüedad de
`audio`, que se resuelve a exactamente uno de los dos, no a ambos). Por lo
tanto, en la práctica **1 producto scrapeado → 1 fila de `category_product`**,
aunque la tabla admita N:N — no hay necesidad ni fuente de datos para insertar
más de una categoría por producto scrapeado.

**Sobre la jerarquía (padre/hijo) — refutación de la premisa**: no hace falta
insertar también el padre. Las 10 categorías de `gadget` son **raíces sin
hijos**: `db/seed.sql:71` no trae `parent_id` en el `INSERT`, y la única
sentencia que sí fija `parent_id` (`db/seed.sql:275-393`, un `UPDATE ...
FROM (VALUES ...)`) **no incluye ninguno de los ids 180/181/182/198-204**. Lo
confirma también
`packages/db/src/repositories/categories.integration.test.ts:101-103`:
*"typeSlug gadget → total 10 (las 10 raíces hoja)"*, `expect(rootsOnly.total
).toBe(10)`. **Corrección factual al enunciado de la tarea**: la
"profundidad máxima 2" no está en `db/schema.sql` (no hay ningún `CHECK` ni
comentario de profundidad ahí — grep sin resultados) sino que es una propiedad
**empírica del seed**, verificada por
`categories.integration.test.ts:58-77` (`expect(maxDepth).toBe(2)`, sobre
**otros** types, no sobre `gadget`). Para `gadget` específicamente la
profundidad es 0 siempre.

### 7. Riesgo de regresión sobre `just db-check`

Confirmado con grep de los archivos reales:
- `packages/db/src/repositories/shops.integration.test.ts:19` →
  `expect(total).toBe(12)`.
- `packages/db/src/repositories/manufacturers.integration.test.ts:18` →
  `expect(total).toBe(14)`.
- `packages/db/src/repositories/categories.integration.test.ts:29,77,103,110`
  → `toBe(198)` (total plano), `visited.size` `toBe(198)` (árbol completo),
  `toBe(10)` (×2, filtrado por `typeSlug: 'gadget'`). **Ninguno de estos se ve
  afectado por US-7**: US-7 no crea categorías nuevas (solo lee las 10 ya
  sembradas) ni cambia cuántas hay — inserta filas en `category_product`, una
  tabla que **ningún test de `packages/db` cuenta**. Grep de
  `category_product`/`categoryProduct` en `packages/db/src/repositories/*.test.ts`
  no encontró coincidencias. `products.integration.test.ts` tampoco asserta
  sobre `categories`/`category_product` (solo paginación, `toBe(30)`,
  `toHaveLength`).
- El único riesgo real y ya conocido (heredado de US-6, no nuevo de US-7) es
  que el script sintético de verificación cree `shops`/`manufacturers` de
  prueba y haya que limpiarlos (o `just db-reset`) antes de correr
  `just db-check`, exactamente como ya documentó el design de US-6.

## Affected Areas

- `services/scraper-worker/pipelines.py` — único archivo de producción a
  tocar: (a) ampliar `RETURNING` de `UPSERT_PRODUCT` para exponer el `id` del
  producto (hoy solo devuelve `(xmax = 0)`, `:126`); (b) resolver los slugs
  objetivo a `category_id` (read-only, fail-fast, mejor una vez en
  `open_spider` — mismo patrón que `type_id`, no el de
  `_resolver_referencia`, porque **no se crean categorías**); (c) mapear la
  etiqueta cruda (`datos.get("categoria")`) al slug destino; (d) insertar en
  `category_product` con `ON CONFLICT (product_id, category_id) DO NOTHING`
  dentro del mismo `try` de `process_item` (`:279-306`).
- `services/scraper-worker/spiders/*.py` — **no es necesario tocarlos**: las
  9 etiquetas crudas ya son consistentes entre los 6 spiders (mismo
  vocabulario), así que el mapeo centralizado en el pipeline es viable sin
  reescribir `categorizar()`. Ver Approaches.
- `db/README.md` — su tabla de mapeo (`:51-61`) es correcta para las 6
  etiquetas que cubre explícitamente, pero no menciona `tablets`,
  `impresoras`, `perifericos` ni `otros` como filas propias (caen en el
  "resto" por CA-1) — posible mejora adyacente de documentación, no accionada
  aquí (fuera del scope de código).
- **NO afectados** (confirmado, no se tocan): `items.py` (el campo `categoria`
  ya existe en los 6 Items), `db/schema.sql`, `db/seed.sql`, el frontend,
  `test_pipeline.py`/`justfile` (US-8).

## Approaches

1. **Mapeo centralizado en el pipeline (recomendado por la US y confirmado
   por esta exploración)** — un diccionario `RAW_A_SLUG` en `pipelines.py`
   que traduce las 9 etiquetas crudas (más la sub-regla de `audio`) a los
   slugs del catálogo, resuelto contra `category_id` una vez por corrida.
   - Pros: un solo punto de verdad; los spiders no cambian (0 riesgo sobre su
     lógica de scraping, que está fuera de scope); las 9 etiquetas ya son
     consistentes entre spiders, así que el diccionario es pequeño (9-10
     entradas) y no necesita normalización de sinónimos.
   - Cons: la desambiguación de `audio` → `headphone`/`sound-box` exige mirar
     `nombre` además de `categoria`, así que el "mapeo" no es un diccionario
     puro de 1 clave — necesita una función pequeña para ese caso.
   - Effort: Low — cambios acotados a `pipelines.py` (~40-60 líneas
     estimadas: dict + función de resolución + `RETURNING id` + insert).

2. **Reescribir `categorizar()` en los 6 spiders para que devuelvan slugs
   directamente** — cada spider emite ya `laptop`/`mobiles`/etc.
   - Pros: el pipeline no necesita tabla de traducción.
   - Cons: toca 6 archivos con lógica de scraping que la US **prohíbe tocar**
     salvo si el design lo decide explícitamente, y de todos modos no resuelve
     la ambigüedad de audio (seguiría necesitando lógica extra en 6 sitios en
     vez de 1); mayor superficie de diff (~6 archivos) para un PR que debe
     caber en el guard de 400 líneas.
   - Effort: Medium-High — mismo problema resuelto en 6 lugares en vez de uno.

## Recommendation

Mapeo centralizado en `pipelines.py` (Approach 1), confirmando la
recomendación de la US: la unión de etiquetas crudas es pequeña (9 valores),
consistente entre spiders (mismo vocabulario, no sinónimos dispersos) y ya
disponible bajo una única clave de item (`categoria`) en los 6 `Items`. El
único elemento no trivial —la ambigüedad `audio` → `headphone`/`sound-box`—
se resuelve igual de bien (o mejor) centralizado, con una sola función que
mira `nombre`, que repetido en 6 spiders. Seguir el precedente de **Decisión
A** de US-6 (`type_id`: resuelto una vez, fail-fast) para los `category_id`
objetivo, NO el de **Decisión E** (`_resolver_referencia`, get-or-create):
las categorías nunca se crean aquí, así que un `SELECT` de una sola vez por
corrida con fail-fast si falta algún slug esperado es el patrón correcto.

Cambio no trivial que el design debe decidir explícitamente porque no está en
el patrón de US-6: **ampliar el `RETURNING` de `UPSERT_PRODUCT`** para exponer
`id`, y decidir cómo evitar el pitfall documentado en el design de US-6
("añadir una columna exige cambiar las dos cosas a la vez" — el
desempaquetado posicional de `cur.fetchone()`).

## Risks

- **Ambigüedad de `audio`**: sin una regla de desambiguación explícita
  (keywords en `nombre`), todo lo que hoy es la etiqueta cruda `audio` iría a
  un solo slug, dejando el otro (`headphone` o `sound-box`) permanentemente
  vacío pese a existir en el catálogo. Se recomienda decidirlo explícitamente
  en el design, no dejarlo implícito en el orden de un `if`.
- **3 de 10 slugs del catálogo (`camera`, `router`, `smart-watch`) quedarán
  sin productos del scraper** con las etiquetas crudas actuales — no es un
  bug de esta US (tocar los spiders para que distingan cámaras/redes/relojes
  está fuera de scope), pero conviene declararlo en el design para que no se
  lea como un CA-1 incumplido.
- **`RETURNING` de `UPSERT_PRODUCT` debe ampliarse con cuidado**: el design de
  US-6 documentó explícitamente por qué es de una sola columna hoy
  (`design.md:333-338` del change archivado). US-7 rompe esa invariante a
  propósito (necesita el `id`), así que el design debe re-declarar la
  justificación y el desempaquetado nuevo, no limitarse a agregar una
  columna sin más.
- **Fragilidad latente en `tauretcomputadores.py:189`** (fallthrough a `None`
  si `categoria_destino` no es uno de los 5 valores de `self.CATEGORIAS`):
  inalcanzable hoy, no bloquea esta US, pero si el pipeline no maneja
  defensivamente una `categoria` ausente/`None` en `datos.get("categoria")`,
  un cambio futuro en cualquier spider podría colar un item sin categoría
  mapeable de forma silenciosa. Vale la pena que el design incluya un
  fallback explícito a `accessories-gfa` también para `categoria` ausente,
  no solo para etiquetas desconocidas.
- Riesgo heredado de US-6 (no nuevo): el script sintético de verificación
  debe limpiar (`DELETE`/`just db-reset`) antes de `just db-check`, igual que
  documentó el design de US-6.

## Ready for Proposal

Sí. La investigación no encontró bloqueantes: el DDL de `category_product`
soporta upsert idempotente sin cambios de esquema, el endpoint HTTP para CA-3
ya sale de Postgres, y la jerarquía de categorías no aplica a `gadget` (queda
refutada la necesidad de insertar categorías padre). El orquestador debe
avisar al usuario de las dos decisiones abiertas antes de `sdd-propose`/
`sdd-design`: (1) regla de desambiguación de `audio` → `headphone` vs.
`sound-box`, y (2) que 3 de los 10 slugs del catálogo quedarán sin cobertura
del scraper con el vocabulario actual de los spiders (aceptar o pedir un
ajuste, sabiendo que tocar spiders está fuera de scope de esta US).
