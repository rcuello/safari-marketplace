# Design: Upsert del pipeline del scraper en `products` con procedencia

> **US-6**, Épico 5 (`docs/product/5-scraper-catalogo-compartido/6-pipeline-upsert-products.md`).
> Insumos: `proposal.md` y `explore.md` de esta carpeta. Precedente estructural:
> `../archive/2026-08-26-catalogos-planos-postgres/design.md`. Precedente **de código**:
> `packages/db/src/repositories/products.repository.ts:275-344` y `:401-413`.
> **Toda cita `path:line`, columna, constraint y símbolo sale de abrir el
> archivo.** Lo que no pudo verificarse contra la base corriendo (Docker caído:
> `psycopg.connect(:5433)` → `ConnectionTimeout`) va como **[verificar en apply]**
> con su comando. Las decisiones A, B y D las cerró el usuario: se documentan con
> rationale y consecuencias, no se re-deciden. La C se cierra aquí.

## Technical Approach

`services/scraper-worker/pipelines.py` es el **único** archivo de producción del
change. Se reemplazan la constante `UPSERT` (`:47-71`) y el cuerpo de
`process_item` (`:107-137`); se añaden helpers de FKs y un fail-fast en
`open_spider`. Intactos: `parse_numero` (`:20-29`), `normalizar_enlace`
(`:32-37`), `extraer_product_id` (`:40-44`), la conexión única
`psycopg.connect(dsn, autocommit=True)` (`:99`), `self.stats` (`:100`),
`close_spider` (`:103-105`) y el `try/except psycopg.Error` con
`spider.logger.error` + contador (`:128-135`).

Approach 1 del explore: espejar `products.repository.ts` en SQL crudo — validar
en Python antes del INSERT con el error de Postgres como backstop; get-or-create
explícito en dos pasos; slug resuelto por la base.

## Architecture Decisions

### Decisión A — `type_id`: resuelto una vez en `open_spider`, fail-fast si falta

**Elección**: `SELECT id FROM types WHERE slug = 'gadget'` en `open_spider`,
guardado en `self.type_id`. Si devuelve `None`, se cierra la conexión y se lanza
`ValueError` con mensaje accionable; la corrida no arranca.

| Opción | Trade-off | Decisión |
|---|---|---|
| `open_spider` + fail-fast | 1 query por corrida; el fallo se ve antes del primer request | **Elegida** |
| Resolver por item / fallar item por item | 1 query extra × N para un valor constante; N logs idénticos que ocultan la causa (base sin sembrar) | Descartada |
| Crear el type si falta | El scraper inventaría una vertical del marketplace; `db/README.md:44`: «el seed contiene solo datos de la aplicación… es él quien debe encajar en esta taxonomía» | Descartada |

**Rationale**: `products.type_id` es `NOT NULL REFERENCES types(id)`
(`db/schema.sql:214`) y **ningún item lo provee** (`items.py:2-69`). `gadget`
está sembrado como `(9, 'Gadget', 'gadget', …)` en `db/seed.sql:40` y
`db/README.md:47-49` lo nombra como el type cuyas diez categorías cubren lo que
recolectan los spiders. Se busca **por slug, no por el id 9**: el id es un dato
del seed, el slug es el contrato.

Mensaje exigido (misma forma que el `ValueError` de `DATABASE_URL`, `:94-98`,
que ya prueba que una excepción en `open_spider` aborta el crawl):

```
No existe el type 'gadget' en la base: el catálogo no está sembrado.
Corre `just db-up` (o `just db-reset` si la base quedó a medias).
```

### Decisión B — `products_rebaja_valida`: se descarta la promoción, no el item

**Elección**: si `sale_price` viene y `sale_price >= price`, el producto se
persiste con `sale_price = NULL`, se loguea el saneo con
`spider.logger.warning` y se cuenta en `stats["promociones_descartadas"]`.
El item **entra** y suma en `insertados`/`actualizados` como cualquier otro.

**Divergencia deliberada con el precedente TS**: `upsertScrapedProduct()` lanza
`InvalidSalePriceError` (`products.repository.ts:278-280`) y no persiste nada.
La razón es **quién es el caller**: en `packages/db` es código de aplicación que
puede decidir (reintentar, propagar un 400); aquí es el propio pipeline, que no
tiene a quién preguntar y cuyo trabajo es no perder catálogo. Nombre, precio de
lista, procedencia e imagen son datos buenos; la promoción incoherente es el
único malo. El contador propio hace la política auditable: `fallidos` sigue
significando «no está en la base»; `promociones_descartadas`, «está, sin
promoción».

**Umbral**: el CHECK es `sale_price < price` **estricto** (`db/schema.sql:276-277`),
así que `sale_price == price` también viola; la condición de saneo es `>=`, igual
que la del precedente (`:278`).

### Decisión C — «sin precio» = `None` **o `<= 0`**: se descarta el item

La decisión que el proposal dejó abierta y que cierra este design.

**Elección**: `price = parse_numero(datos.get("precio"))`; si `price is None or
price <= 0`, el item se descarta antes de tocar la base, se loguea con
`spider.logger.warning` (nombre y tienda) y se cuenta en `stats["fallidos"]`.
La corrida sigue.

| Opción | Trade-off | Decisión |
|---|---|---|
| Descartar el item | Se pierde una fila que no se podría mostrar de todos modos | **Elegida** |
| Insertar con `price = 0` | Inventa un dato: aparecería «gratis» y contaminaría el filtro `min_price`/`max_price` (`products_precio_idx`, `db/schema.sql:339`) | Descartada |
| Insertar como `'variable'` | El CHECK lo permitiría, pero mentiría sobre el producto y el frontend derivaría el precio de variaciones inexistentes | Descartada |

**El caso mayoritario es `0`, no `None`** — y el CHECK no lo atrapa, porque
`0` no es `NULL`. **3 de los 6 spiders emiten `"0 COP"`** cuando no detectan
precio, y `parse_numero("0 COP")` deja `limpio = "0"`, que es truthy y **no**
cae en el `if not limpio` (`:23-25`) → `Decimal("0")`:

| Spider | Origen del `0` |
|---|---|
| alkosto | `limpiar_precio` → `return int(solo_numeros) if solo_numeros else 0` (`:95-97`), formateado en `:86` |
| compuworking | `if not texto: return '0 COP'` (`:211-213`) y el `except ValueError` (`:230`) |
| tauretcomputadores | idéntico (`:190-192`, `:197`) |

Sólo compulago y falabella producen `'N/D'` → `parse_numero` → `None`. Sin la
mitad `<= 0` de la guarda, esos productos entrarían **como gratis**: justo el
resultado que la tabla de arriba dice haber rechazado.

**Rationale**: no hay valor razonable que inventar — es literalmente el
argumento de `MissingPriceError` (`products.repository.ts:376-384`). El descarte
es **visible**: un `warning` por item más el `fallidos` del resumen de
`close_spider` (`:105`).

### Decisión D — Slug: `slugify(nombre || ' ' || tienda)`, calculado dentro del INSERT

**Elección**: el `slug` no se calcula ni se pasa como parámetro: va como
expresión en el `VALUES` del upsert, `slugify(%(nombre)s || ' ' || %(tienda)s)`,
y **no aparece en el `DO UPDATE SET`**.

- **Estable (CA-3)**: `slugify` es `IMMUTABLE STRICT` (`db/schema.sql:47-49`) y
  ambos insumos son campos del item → mismo item, mismo slug, sin contadores,
  sin hash, sin leer el estado de la tabla.
- **Único entre retailers (R-2)**: el mismo modelo en Alkosto y en Falabella
  produce `…-alkosto` y `…-falabella`.
- **No se pisa en el update**: es la URL pública (`db/schema.sql:28`) y el
  precedente lo declara (`products.repository.ts:329`); un cambio de nombre en
  el retailer actualiza `name` y conserva la URL.
- **Se concatena ANTES de slugificar**, no `slugify(nombre) || '-' || slugify(tienda)`:
  `slugify` hace `trim(both '-' …)` y colapsa repeticiones (`db/schema.sql:51-58`),
  así que un nombre que se reduzca a cadena vacía no deja un guion al frente.
  Toda la normalización sigue en SQL (Decisión 3 del épico).

| Opción | Trade-off | Decisión |
|---|---|---|
| `slugify(nombre \|\| ' ' \|\| tienda)` | No cubre dos homónimos **dentro** de la misma tienda | **Elegida** |
| Sufijo con `source_product_id` | Unicidad total, pero en 5 de 6 tiendas ese id es la URL normalizada (`:40-44`) → slugs de 100+ caracteres | Descartada |
| Sufijo `-2`, `-3` (lo que hace el mock: `'tate-lyle-white-sugar-2'`) | Depende del orden de inserción y del estado de la tabla: rompe la estabilidad de CA-3 | Descartada |
| Hash corto de la procedencia | Estable y único, pero opaco para la audiencia didáctica del repo | Descartada |

**Residual declarado**: dos productos distintos homónimos en el mismo retailer
chocan contra el `UNIQUE` de `slug` (`db/schema.sql:211`, `products_slug_key`).
No se compensa: cae en el descarte de la Decisión F (`UniqueViolation` → log +
`fallidos`), sin estado. Sólo afecta a filas **nuevas**: un producto ya conocido
entra por `DO UPDATE`, que no toca el slug.

### Decisión E — Get-or-create con caché por corrida, clave = nombre crudo

**Elección**: dos dicts `self.shops` y `self.manufacturers` (`{nombre: id}`)
vacíos en `open_spider`, poblados on-demand. El slug lo calcula la base dentro
de las dos sentencias (`WHERE slug = slugify(%s)` / `VALUES (%s, slugify(%s))`),
así que la **clave del caché es el nombre crudo `.strip()`**, no el slug.

**Seguro** porque Scrapy corre un proceso por spider (`just scrape` =
`python -m scrapy crawl <spider>`, `justfile:351`) con una única conexión: el
caché nace en `open_spider` y muere con el proceso. Sin TTL que gestionar ni
riesgo de servir el id de una fila borrada entre corridas.

**Consecuencia declarada**: `"GENÉRICA"` (alkosto) y `"GENERICA"` (el resto) son
dos claves distintas que resuelven al **mismo id**, porque `slugify` colapsa
ambas a `generica` (`unaccent_simple`, `db/schema.sql:38-45`): una query extra
la primera vez, cero filas duplicadas. Cachear por slug exigiría un
`SELECT slugify(%s)` previo: más queries, no menos.

`manufacturer_id` es nullable (`db/schema.sql:216`): sin `marca` se pasa `None`
y no se crea nada. `shops.owner_id` tiene `DEFAULT 1` (`:119`) y no hay FK a
`users`, así que `name` + `slug` bastan — igual que `findOrCreateShopBySlug`
(`shops.repository.ts:87-103`) y `findOrCreateManufacturerBySlug`
(`manufacturers.repository.ts:56-71`), que crean con `update: {}`.

### Decisión F — Orden de validación: precondiciones en Python **y** backstop de Postgres

Ambos, no uno u otro — espejo de `products.repository.ts:278-280` (valida antes)
+ `:401-413` (traduce después).

**Antes del INSERT** (en Python, en este orden; cada fallo → `warning` +
`fallidos` + `return item`). Las citas `:NN` sueltas son de `pipelines.py`:

1. `nombre` vacío → `name`/`slug` son `NOT NULL` (`db/schema.sql:210-211`) y
   `slugify(NULL)` devuelve `NULL` por ser `STRICT` (`db/schema.sql:49`).
2. `enlace` vacío → `normalizar_enlace("")` produce `"://"` (urlparse de cadena
   vacía, `:32-37`), un `source_product_id` degenerado que **pasa** el CHECK y
   colapsaría en una sola fila todos los items sin enlace de esa tienda. Ésta
   es la guarda real, no la constraint.
3. `price is None or price <= 0` → Decisión C (el `0` es el caso mayoritario y
   el CHECK **no** lo atrapa).

Luego el saneo de la Decisión B (no descarta).

**`products_procedencia_completa` no puede violarse desde este pipeline** (ver
corrección #3): la protección efectiva es la precondición 2, no el CHECK.

**Backstop** (`except psycopg.Error as e`): se lee `e.diag.constraint_name` —
psycopg **3.3.4** (verificado en el `.venv`) expone diagnósticos estructurados,
así que **no hace falta buscar subcadenas en el mensaje** como hace
`_translateCheckViolation()` (`:401-413`), que en Prisma no tiene ese dato. Con
`constraint_name` a `None` se cae a `str(e)`. Mapa (log en español, un
`fallidos`, la corrida sigue):

| `constraint_name` | Mensaje logueado |
|---|---|
| `products_rebaja_valida` | «promoción ≥ precio pese al saneo previo» (no debería ocurrir: bug) |
| `products_simple_con_precio` | «producto 'simple' sin precio» (no debería ocurrir: bug) |
| `products_procedencia_completa` | «procedencia incompleta» (no debería ocurrir: bug) |
| `products_slug_key` | «slug duplicado: ya existe otro producto con ese nombre en esta tienda» (residual de la Decisión D) |
| cualquier otro / `None` | el `str(e)` tal cual, como hoy (`:134`) |

**La cobertura NO es exhaustiva, y se declara**: `price`/`sale_price` son
`numeric(12,2)` (`db/schema.sql:228-229`, máx. `9 999 999 999,99`) y
`parse_numero` concatena **todos** los dígitos de la cadena (`:23`), así que dos
precios pegados en una misma celda darían 13+ dígitos → `22003 numeric field
overflow`. No se añade una guarda de rango: cae en la fila «cualquier otro» con
el `str(e)` crudo, se cuenta en `fallidos` y la corrida sigue (CA-4 se cumple).
Acotar el precio exigiría decidir un techo de negocio, que no es de esta US.

### Decisión G — `autocommit` se mantiene; **no** hay transacción por item

Se conserva `autocommit=True` (`:99`). Un item descartado tras haber creado su
`shop`/`manufacturer` deja esas filas creadas: es **inocuo** (son idempotentes y
las reutiliza el siguiente item del mismo retailer).

**Por qué se rechaza envolver cada item en `with self.conn.transaction():`**: el
caché guardaría ids de filas que el rollback elimina → *cache poisoning*, y todo
item posterior de ese retailer fallaría por FK contra un `shop_id` inexistente.
Con autocommit el id cacheado es durable por construcción.

### Decisión H — `stats`: cuatro contadores, tres exhaustivos y uno ortogonal

```python
self.stats = {"insertados": 0, "actualizados": 0, "fallidos": 0,
              "promociones_descartadas": 0}
```

`insertados + actualizados + fallidos == items procesados` (invariante).
`promociones_descartadas` es **ortogonal**: productos que SÍ entraron (contados
ya en uno de los dos primeros). Los tres nombres existentes no se renombran
(`:100`, `:132`, `:135`) y `close_spider` los imprime igual (`:105`).

**`RETURNING (xmax = 0) AS fue_insercion`** se conserva **con su única columna**
(`:70`) y con el desempaquetado `cur.fetchone()[0]` (`:131`) — ver la nota del
SQL. Es correcto aquí: la rama `DO UPDATE` siempre devuelve fila (a diferencia de
`DO NOTHING`) y su tuple lleva `xmax` distinto de cero por el bloqueo de la fila
preexistente. Depende de una columna de sistema, así que **CA-1 lo verifica
empíricamente** (hay que ver `insertados: 1, actualizados: 1`). Reemplazo si
fallara: `RETURNING (created_at = updated_at)` — en el INSERT ambos toman el
mismo `now()` (`:271-272`) y en el UPDATE el trigger `products_updated_at`
(`:366-367`) mueve sólo `updated_at`.

## Mapeo item → columna de `products` (completo)

`datos = ItemAdapter(item).asdict()`; todo acceso con `.get()` (los `scrapy.Item`
sólo exponen los campos asignados). **`items.py` NO se toca.**

| Columna (`db/schema.sql`) | Origen | Nota |
|---|---|---|
| `name` `:210` | `datos["nombre"]` | precondición: no vacío |
| `slug` `:211` | `slugify(nombre \|\| ' ' \|\| tienda)` | Decisión D; **no** va en el `DO UPDATE` |
| `description` `:212` | — | `DEFAULT ''`; ningún item trae descripción |
| `type_id` `:214` | `self.type_id` | Decisión A |
| `shop_id` `:215` | get-or-create(`shops`, `tienda`) | Decisión E |
| `manufacturer_id` `:216` | get-or-create(`manufacturers`, `marca`) o `NULL` | nullable |
| `product_type` `:218` | `'simple'` literal | el scraper no produce variables |
| `price` `:228` | `parse_numero(precio)` | precondición: ni `None` ni `<= 0` (Decisión C) |
| `sale_price` `:229` | `parse_numero(promocion)`, saneado a `NULL` si `>= price` | Decisión B |
| `min_price` / `max_price` `:230-231` | **= `price`** | para un `simple` los tres valen lo mismo (`:226-227`; precedente `products.repository.ts:294-295`) |
| `quantity` `:233` | — | `DEFAULT 0`. El scraper no observa stock; ver divergencia D-2 |
| `status` / `visibility` `:242-244` | — | defaults `'publish'` / `'visibility_public'`: **es lo que hace la fila visible** (CA-5) y lo que indexa `products_visibles_idx` (`:332-334`) |
| `image` `:250` | `Jsonb({"id": None, "original": url, "thumbnail": url})`, o `NULL` sin `imagen` | jsonb, no string plano (`:246-249`); `id` va `null` (no hay attachment) y la misma URL en los dos slots: el scraper no genera miniaturas |
| `ratings` `:253` | `parse_calificacion(calificacion)`, sólo en el INSERT | corrección #2; `NOT NULL DEFAULT 0` → `COALESCE(%(ratings)s, 0)`. **No** va en el `DO UPDATE`: un spider que deje de emitir `calificacion` no debe pisar con 0 lo guardado |
| `in_stock`, `sold_quantity`, `sku`, `unit`, `gallery`, `total_reviews`, `is_*`, `external_product_url`, `language`, `translated_languages` `:234-262` | — | defaults del DDL / `NULL` en las nullables; ningún item aporta esos datos |
| `source_store` `:266` | `datos.get("tienda") or spider.name` | preservado de `:113` |
| `source_product_id` `:267` | `extraer_product_id(enlace, enlace_normalized)` | preservado de `:114`; en 5 de 6 tiendas es la URL normalizada (riesgo del proposal, aceptado) |
| `source_url` `:268` | `enlace` crudo | |
| `scraped_at` `:269` | `now()` (SQL) | |
| `created_at` / `updated_at` `:271-272` | defaults + trigger `:366-367` | `created_at` **no** va en el `DO UPDATE` |

**Campos del item sin destino**: `descuento` (derivable de `price`/`sale_price`;
no hay columna) · `vendedor` (sólo `FalabellaItem:67`; `products` no tiene
columna de seller, sólo `shop_id`) · `categoria` (**US-7**, prohibido tocar
`category_product` aquí).

## SQL concreto

Constraints/índices verificados en `db/schema.sql`: `products_procedencia_key`
(`:294-296`), `shops.slug … UNIQUE` (`:117`), `manufacturers.slug … UNIQUE`
(`:167`).

```sql
-- 1. type_id (una vez por corrida, open_spider)
SELECT id FROM types WHERE slug = 'gadget'

-- 2. get-or-create (idéntico para shops y manufacturers; sólo cambia la tabla)
SELECT id FROM shops WHERE slug = slugify(%s)
INSERT INTO shops (name, slug) VALUES (%s, slugify(%s))
    ON CONFLICT (slug) DO NOTHING
    RETURNING id
-- …y para manufacturers, las dos mismas sentencias contra `manufacturers`.
```

Orden: `SELECT` → si no hay fila, `INSERT … DO NOTHING RETURNING id` → si el
`RETURNING` viene vacío (otra corrida la creó entre medias), `SELECT` de
respaldo. El `SELECT` primero evita quemar valores de `bigserial`; las
secuencias ya vienen adelantadas por el seed (`db/seed.sql:1666-1671`): no hay
colisión de PK con las filas sembradas.

```sql
-- 3. UPSERT de products
INSERT INTO products (
    name, slug, type_id, shop_id, manufacturer_id, product_type,
    price, sale_price, min_price, max_price, image, ratings,
    source_store, source_product_id, source_url, scraped_at
) VALUES (
    %(nombre)s,
    slugify(%(nombre)s || ' ' || %(tienda)s),
    %(type_id)s, %(shop_id)s, %(manufacturer_id)s, 'simple',
    %(price)s, %(sale_price)s, %(price)s, %(price)s,
    %(image)s, COALESCE(%(ratings)s, 0),
    %(tienda)s, %(product_id)s, %(enlace)s, now()
)
ON CONFLICT (source_store, source_product_id) WHERE source_store IS NOT NULL
DO UPDATE SET
    name            = EXCLUDED.name,
    shop_id         = EXCLUDED.shop_id,
    manufacturer_id = EXCLUDED.manufacturer_id,
    price           = EXCLUDED.price,
    sale_price      = EXCLUDED.sale_price,
    min_price       = EXCLUDED.min_price,
    max_price       = EXCLUDED.max_price,
    image           = COALESCE(EXCLUDED.image, products.image),
    source_url      = EXCLUDED.source_url,
    scraped_at      = EXCLUDED.scraped_at
RETURNING (xmax = 0) AS fue_insercion
```

**`RETURNING` de UNA sola columna, a propósito**: `process_item` desempaqueta con
`fue_insercion = cur.fetchone()[0]` (`:131`, línea preservada). Con dos columnas
`[0]` sería el `slug` —cadena no vacía, siempre truthy— y **todo item se contaría
como `insertado`**, dejando CA-1 indemostrable. Añadir el slug exige cambiar las
dos cosas a la vez (`RETURNING slug, (xmax = 0)` + `slug, fue_insercion =
cur.fetchone()`).

**`image` con `COALESCE`, no `EXCLUDED.image` a secas**: un re-scrapeo sin imagen
(`falabella.py:696` loguea `'[Falabella] SIN IMAGEN'`; `alkosto.py:62` y
`exito.py:106` asignan `None`) borraría la imagen guardada. Mismo argumento que
en `ratings`, y espeja el precedente, que **omite** `image` del update cuando no
viene (`products.repository.ts:300`).

**Fuera del `DO UPDATE`, a propósito**: `slug` (D), `created_at` (el trigger
sólo mueve `updated_at`), `ratings`, `type_id` y `product_type` (constantes),
`source_store`/`source_product_id` (clave del conflicto) y todo lo que va en
defaults (`status`, `visibility`, `quantity`, `unit`, `description`, `gallery`,
`sku`…): **el pipeline no pisa columnas que no observa** (p. ej. un cambio hecho
desde el admin). `image` sí se actualiza, pero **sólo cuando el item la trae**
(el `COALESCE` de arriba); es la misma regla, no una excepción.

**El `WHERE source_store IS NOT NULL` del `ON CONFLICT` no es decorativo** —
corrección al proposal y al explore, que ambos escriben la sentencia sin él.
`products_procedencia_key` es un índice **parcial** (`db/schema.sql:294-296`) y
Postgres sólo infiere un índice parcial si la sentencia repite su predicado
(`index_predicate` del `conflict_target`). Sin el `WHERE`, el INSERT falla en
tiempo de ejecución con `42P10 — there is no unique or exclusion constraint
matching the ON CONFLICT specification`, para **todos** los items.
**[verificar en apply, primer paso]**: con `just db-up`, un `INSERT` de prueba
en `db-shell` con y sin el `WHERE` decide la forma final antes de escribir el
resto.

## Estructura de `pipelines.py` tras el change

| Símbolo | Estado | Qué es |
|---|---|---|
| `parse_numero` `:20-29`, `normalizar_enlace` `:32-37`, `extraer_product_id` `:40-44`, `close_spider` `:103-105` | **intactos** | `parse_numero` queda como conversor de **precios**; `normalizar_enlace` no se toca pese a D-5 (decisión elevada) |
| `parse_calificacion(valor)` | **nuevo** (~7 líneas) | `Decimal(str(valor)).quantize(Decimal("0.01"))` y **`0 ≤ v <= 9.99`**; `None` fuera de rango o no parseable. La cota es post-`quantize`: `9.995` sin redondear pasaría un `< 10` y Postgres lo guardaría como `10.00` → `22003`, el mismo error que la corrección #2 elimina |
| `imagen_jsonb(url)` | **nuevo** (~4 líneas) | `Jsonb({"id": None, "original": url, "thumbnail": url})` o `None` |
| `UPSERT` `:47-71` | **reemplazada** | pasa a `UPSERT_PRODUCT` (SQL de arriba) |
| `SQL_TYPE_ID`, `SQL_SHOP`, `SQL_MANUFACTURER` | **nuevas** | `SQL_SHOP`/`SQL_MANUFACTURER` son tuplas `(select, insert)` que se pasan al helper: sin f-strings de nombres de tabla |
| `open_spider` `:89-101` | **ampliado** | + `self.type_id` (fail-fast, A) + `self.shops`/`self.manufacturers` vacíos + el 4.º contador |
| `_resolver_referencia(sql, cache, nombre)` | **nuevo** (~14 líneas) | get-or-create cacheado; `None` si el nombre viene vacío |
| `process_item` `:107-137` | **reescrito** | precondiciones → saneo → FKs → upsert → `except` con el mapa de F |
| Import + docstring de la clase `:75-87` | | `from psycopg.types.json import Jsonb`; el docstring hoy describe MongoDB y la tabla `productos` → pasa a describir el catálogo compartido |

## Data Flow

    item (scrapy.Item)  ──ItemAdapter(item).asdict()──▶  process_item
        │
        ├─ precondiciones Python: nombre / enlace / price      ──falla──▶ warning + fallidos ─▶ return item
        ├─ saneo: sale_price >= price → NULL                   ──▶ warning + promociones_descartadas
        │
        ├─ self.shops[tienda]         ─miss─▶ SELECT / INSERT … ON CONFLICT (slug) DO NOTHING
        ├─ self.manufacturers[marca]  ─miss─▶ idem  (None si no hay marca)
        ├─ self.type_id                (resuelto en open_spider)
        ▼
    INSERT INTO products … ON CONFLICT (source_store, source_product_id)
                             WHERE source_store IS NOT NULL DO UPDATE …
        │  RETURNING (xmax = 0)   ← una columna: cur.fetchone()[0] (:131)
        ├─ ok      ─▶ insertados | actualizados
        └─ psycopg.Error ─▶ diag.constraint_name → mensaje → fallidos   (la corrida sigue)

    products (misma tabla)  ──▶ @safari/db ──▶ products.service.ts:180-236 ──▶ GET /api/products

## File Changes

| File | Action | Description |
|---|---|---|
| `services/scraper-worker/pipelines.py` | Modify | Único archivo de producción (tabla de arriba). ~240 líneas netas |
| `docs/product/5-scraper-catalogo-compartido/6-pipeline-upsert-products.md` | Modify | `Status:` de la US |
| `docs/product/5-scraper-catalogo-compartido/README.md` | Modify | fila de US-6 en la tabla de sub-historias (línea 33) |

Sin cambios: `items.py`, `spiders/**`, `test_pipeline.py`, `justfile`,
`db/schema.sql`, `db/seed.sql`, `packages/db`, `apps/**`. **PR único** (~240
líneas, holgado bajo el guard de 400).

## Correcciones factuales a los insumos

| # | Lo que dice el insumo | Realidad verificada | Efecto |
|---|---|---|---|
| **1** | proposal `:18`: `ON CONFLICT (source_store, source_product_id) DO UPDATE` (el explore `:34` **sí** registra el índice con su `WHERE`; no escribe la sentencia) | `products_procedencia_key` es índice **parcial** (`db/schema.sql:294-296`): la inferencia exige repetir el predicado | Se añade `WHERE source_store IS NOT NULL` al `conflict_target`. Sin él **nada** funciona |
| **2** | proposal `:19`: `calificacion`→`ratings` vía el pipeline actual | `parse_numero` borra todo lo que no sea dígito o coma (`:23`), y Éxito emite un **float** `4.5` (`spiders/exito.py:96-102`): `str(4.5)` → `"4.5"` → `"45"` → `Decimal 45`, que en `ratings numeric(3,2)` (máx. 9.99) da `22003 numeric field overflow` y tumbaría el item entero | `ratings` NO pasa por `parse_numero`: helper `parse_calificacion` acotado. `parse_numero` queda intacto para precios |
| **5** | proposal `:87` y explore `:85`: el descarte por falta de precio afecta a compulago/falabella (`'N/D'`) | **3 de 6** spiders emiten `"0 COP"`, que `parse_numero` convierte en `Decimal("0")` — no en `None` — y el CHECK acepta (alkosto `:86,95-97`; compuworking `:211-213,230`; tauret `:190-192,197`) | La guarda es `price is None or price <= 0` (Decisión C). Sin la segunda mitad, esos productos entrarían **como gratis** |
| **3** | proposal `:68`: «`products_procedencia_completa` → declarar el caso `tienda` vacía» | `num_nonnulls` cuenta NULLs, no cadenas vacías (`db/schema.sql:287`), y `source_store` cae a `spider.name` (`:113`): el CHECK es ineficaz aquí | La guarda real es la precondición de `enlace` no vacío (Decisión F) |
| **4** | explore `:21`: «`AlkostoProjectItem` no declara `promocion`» | `items.py:6` **sí** lo declara (ya lo refutó el proposal `:126`) | Ninguno sobre el mapeo: todo se lee con `.get()` |

## Divergencias declaradas (no son bugs; no se «arreglan» aquí)

- **D-1 — `image.id: null`**: las filas del seed traen un id de attachment
  (`"346"`); las del scraper no tienen ninguno.
- **D-2 — `quantity = 0`**: el scraper no observa stock. El type `gadget`
  renderiza con la tarjeta `neon`, cuya rama `Number(quantity) <= 0`
  (`apps/shop/src/components/products/cards/neon.tsx:134`) muestra el badge de
  agotado. **La tarjeta se renderiza igual** → CA-5 se cumple; inventar stock
  sería peor que un badge veraz. Cambiarlo es decisión de producto, como D-3.
- **D-3 — precios en COP** con la tienda configurada en USD: fuera de alcance
  por la Decisión 4 del épico (`db/README.md:72-88`).
- **D-4 — `source_product_id` = URL normalizada** en 5 de 6 tiendas
  (`extraer_product_id:40-44`): si el retailer cambia la URL, el producto entra
  como fila nueva. Arreglarlo tocaría los spiders (fuera de alcance).
- **D-5 — `normalizar_enlace` CONSERVA el query string** (`:35-36`:
  `if partes.query: limpio += f"?{partes.query}"`). Con D-4, cualquier parámetro
  volátil (tracking, sesión) cambia la clave natural entre corridas y produce
  **filas duplicadas**: CA-1 puede romperse en producción aunque el script
  sintético pase, porque sus URLs son fijas. **Limitación conocida, NO corregida
  aquí** (ver Open Questions #2); la corrección sería descartar el query string
  en `extraer_product_id`, conservándolo en `source_url`.
- **D-6 — divergencia con D-2 del épico**
  (`docs/product/5-scraper-catalogo-compartido/README.md:57-58`: «el pipeline
  sigue siendo el único punto de conversión texto→número (`parse_numero`)»). Se
  mantiene el principio —la conversión vive sólo en el pipeline— pero se **añade
  un segundo conversor**, `parse_calificacion`, porque `parse_numero` corrompe
  las calificaciones (corrección #2). Divergencia declarada, no cumplimiento
  literal.

## Testing Strategy y Verification Plan (evidencia real de la DoD)

| Layer | Qué se prueba | Cómo |
|---|---|---|
| Unit | `parse_calificacion` (4.5 → 4.50; `None`; fuera de rango → `None`) | en el script sintético, sin base |
| Integración | CA-1…CA-5 | script de scratchpad contra Postgres real |
| Regresión | `packages/db` intacto | `just db-check` debe seguir verde |

`test_pipeline.py` es **US-8**: no se toca. El script vive en el scratchpad y
copia su `SpiderFalso` (`test_pipeline.py:24-37`: `name`, `settings` como dict
con `DATABASE_URL`, `logger = self` con `info`/`error`), **añadiendo `warning`**
— el pipeline nuevo lo usa y sin ese método el script muere con `AttributeError`:

```python
sys.path.insert(0, ".../services/scraper-worker")
from pipelines import PostgresPipeline
p = PostgresPipeline(); p.open_spider(spider)
for it in items: p.process_item(it, spider)      # dicts planos, no scrapy.Item
p.close_spider(spider); print(p.stats)
```

Items: (a) `Alkosto`/`ACME`, `precio` "1.299.900 COP"; (b) el mismo con
"1.199.900 COP" → CA-1; (c) otro producto de `Alkosto`/`ACME` → CA-2; (d) mismo
`nombre` que (a) con `tienda='Falabella'` → CA-3; (e) `promocion > precio` → B;
(f) `precio='N/D'` → C; (g) sin `enlace` → precondición 2; **(h) `precio='0 COP'`
→ C, la mitad `<= 0` de la guarda** (sin ella entraría como gratis; es el caso de
3 de 6 spiders). Limpieza:
`DELETE FROM products WHERE source_store IN ('Alkosto','Falabella')` (o
`just db-reset`).

Prerrequisitos: `just db-up`, `just scraper-install`. `psql` no está en el PATH
→ `docker compose exec`; `jq` no está instalado → `node -e`; API en el **9001**.

```bash
# 0. [verificar en apply] la corrección #1, antes de escribir el resto
just db-shell   # \d products  → confirmar products_procedencia_key y su WHERE

# 1. corrida sintética (CA-1..CA-4) — SCRATCH = carpeta de scratchpad de la sesión
DATABASE_URL="postgresql://safari:safari@localhost:5433/safari_scraper" \
  services/scraper-worker/.venv/Scripts/python "$SCRATCH/verificar_us6.py"
#   con los items (a)…(h): insertados 4, actualizados 1, fallidos 3,
#   promociones_descartadas 1   (4+1+3 = 8 items procesados)
#   CA-4 exige ver los 3 warnings de descarte ('N/D', sin enlace, '0 COP')

# 2. CA-1 / CA-3 — una fila por procedencia, slug intacto
docker compose exec -T postgres psql -U safari -d safari_scraper -c \
 "SELECT source_store, source_product_id, slug, price, sale_price FROM products
  WHERE source_store IS NOT NULL ORDER BY id"

# 3. CA-2 — retailer y marca creados una sola vez
docker compose exec -T postgres psql -U safari -d safari_scraper -c \
 "SELECT count(*) FROM shops WHERE slug='alkosto'; SELECT count(*) FROM manufacturers WHERE slug='acme'"

# 4. CA-5 — conviven con el seed, y por HTTP (con just api-dev arriba)
docker compose exec -T postgres psql -U safari -d safari_scraper -c \
 "SELECT source_store, count(*) FROM products GROUP BY 1 ORDER BY 1 NULLS FIRST"
# NO paginar a ciegas: listProducts ordena por id asc (products.repository.ts:213)
# y las filas del scraper son las de id MÁS ALTO (secuencias adelantadas,
# db/seed.sql:1666-1671) → la página 1 sólo trae seed. Hay que filtrar; las
# claves que el endpoint entiende de verdad son 'manufacturer.slug' y 'name'
# (parseProductSearch, products.service.ts:89,92):
curl -s "http://localhost:9001/api/products?search=manufacturer.slug:acme&limit=30" > "$SCRATCH/pg.json"
node -e "const d=require(process.env.SCRATCH+'/pg.json').data; console.log(d.map(p=>[p.slug,p.price,p.shop?.name]))"
curl -s "http://localhost:9001/api/products/<slug-del-item-a>"   # detalle exacto, 200 (404 si no entró)

# 5. no regresión
just db-check      # packages/db intacto: debe seguir verde
```

**CA-4 exige pegar las líneas de log**, no sólo el `stats`: los tres `warning` de
descarte y el del saneo de promoción, seguidos de items posteriores procesados
con éxito (prueba de que la corrida siguió viva).

`just db-test` y `just db-count` **seguirán rojos** (apuntan a `productos`,
`justfile:296,301`): estado esperado hasta US-8, no regresión.

## Migration / Rollout

Sin migración de datos, sin cambio de esquema, sin build ni dependencias nuevas
(`psycopg[binary]>=3.1` ya está en `requirements.txt`; instalado 3.3.4).
Rollback: `git revert` del commit (el pipeline vuelve al estado roto actual, sin
función operativa que perder) + `DELETE FROM products WHERE source_store IS NOT NULL;`
y las `shops`/`manufacturers` creadas por el scraper, o `just db-reset`. Las
1200 filas del seed tienen `source_store IS NULL`: quedan fuera del índice
parcial y el `ON CONFLICT` nunca las alcanza.

## Open Questions

Ninguna bloquea la implementación. Tres notas:

1. **Primera tarea obligatoria de apply**: confirmar empíricamente el `WHERE
   source_store IS NOT NULL` del `ON CONFLICT` (corrección #1) con la base
   arriba. Docker estaba caído al escribir este design.
2. **Elevada al dueño del repo, fuera de esta US (D-5)**: `normalizar_enlace`
   conserva el query string y eso puede duplicar filas entre corridas reales
   (CA-1). La corrección es de una línea, pero cambia la clave de upsert de todo
   lo ya escrito. Este design **no** la aplica; queda como US candidata.
3. `Decision needed before apply: No` — un PR único de ~240 líneas; el forecast
   de guard lo emite `sdd-tasks`.
