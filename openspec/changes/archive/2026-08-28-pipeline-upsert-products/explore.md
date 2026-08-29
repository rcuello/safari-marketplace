# Exploration: US-6 — Upsert del pipeline en `products` con procedencia

## Current State

### El pipeline hoy (roto contra la base actual)

`services/scraper-worker/pipelines.py`:
- `UPSERT` (líneas 47-71) hace `INSERT INTO productos (tienda, product_id, nombre, marca, categoria, precio, promocion, descuento, calificacion, vendedor, imagen, enlace, enlace_normalized) ... ON CONFLICT (tienda, product_id) DO UPDATE ...`. La tabla `productos` **no existe** en `db/schema.sql` — cualquier `process_item` real falla con `UndefinedTable` (confirmado por el README del épico).
- `PostgresPipeline.process_item` (líneas 107-137) arma un dict `fila` desde `ItemAdapter(item).asdict()`, usando `.get()` para cada campo (tolera items que no traen todos los campos), convierte `precio`/`promocion`/`descuento`/`calificacion` con `parse_numero()` (líneas 20-29) y calcula `product_id` con `extraer_product_id()` (líneas 40-44, regex `r"/product/(\d+)/"` sobre `enlace`, con `enlace_normalized` como fallback).
- `parse_numero()` limpia todo lo que no sea dígito o coma (`re.sub(r"[^\d,]", "", str(valor))`) — **también borra el signo `-`**. Éxito emite descuentos como `"-11%"` (línea 91 de `exito.py`); tras `parse_numero` ese descuento pierde el signo.
- `self.stats = {"insertados", "actualizados", "fallidos"}` (línea 100) se incrementa en el `try/except psycopg.Error` de `process_item` (líneas 128-135): un error de Postgres (p. ej. violación de CHECK) se loguea y cuenta en `fallidos`, pero la corrida sigue — ese patrón (try/except alrededor del INSERT, contador en `stats`, log con `spider.logger.error`) es el que hay que preservar para CA-4, apuntando ahora a `products`.
- `open_spider`/`close_spider` abren/cierran una única conexión `psycopg` (`autocommit=True`) por corrida; no hay pool ni cache de shops/manufacturers todavía (a crear para D-1 del épico).

### Qué producen realmente los 6 spiders (`services/scraper-worker/spiders/*.py`)

Todos yield un `scrapy.Item` con, como mínimo, `nombre`, `precio`, `enlace`, `categoria`, `marca`, `tienda`, `imagen`. Campos con soporte desigual:

| Campo | Quién lo puebla | Formato observado |
|---|---|---|
| `precio` | los 6 | texto con miles en `.`, sufijo `" COP"` — p. ej. `"1.299.900 COP"` (alkosto.py:86), `"$ 1.234.567 COP"` (exito.py:125, con `$` y espacio), `"N/D"` cuando no hay precio detectado (compulago.py:200, falabella.py:785 `_fmt`) |
| `promocion` | alkosto **no** (item sin ese campo — `AlkostoProjectItem` no declara `promocion`), exito/compulago/falabella sí, compuworking/tauret no tienen el campo en su `Item` | mismo formato texto que `precio`; `None` si no hay oferta |
| `descuento` | exito (`"-11%"`, con signo negativo — exito.py:91), compulago (`"10%"` sin signo — compulago.py:189), falabella (`"44%"` sin signo, de un badge de UI — falabella.py:741) | alkosto/compuworking/tauret no tienen el campo |
| `calificacion` | **solo exito** (exito.py:96-102, float 0-5) | el resto de `Item`s no declara el campo |
| `vendedor` | **solo Falabella** (`FalabellaItem` es el único con el campo; falabella.py:699-703, default `'Falabella'`) | no existe en ningún otro Item ni tiene columna equivalente en `products` |
| `marca` | los 6, pero el valor "sin marca detectada" difiere: `"GENÉRICA"` (con tilde, alkosto.py:79) vs `"GENERICA"` (sin tilde, compulago.py:182, falabella.py:713, compuworking.py y tauret.py también usan `"GENERICA"`) — tras `slugify()` ambas colapsan al mismo slug `generica`, así que el get-or-create de manufacturers las fusiona en una sola fila sin duplicar (el nombre mostrado dependerá de cuál llegue primero) |
| `enlace` | los 6, URL absoluta del producto en el sitio origen | candidato natural a `source_url` |
| product-id numérico en la URL | **incierto**: `extraer_product_id()` busca literalmente `/product/(\d+)/`. Falabella sí usa rutas `/product/<id>/...` (falabella.py construye `href` con `'https://www.falabella.com.co' + href`, patrón típico `/falabella-co/product/<id>/...`), pero compulago/tauret usan `/producto/` (español, sin la barra final numérica), compuworking usa `/categorias/<id>/...` para listar (no para el detalle del producto), alkosto y éxito no se pudo confirmar el patrón desde el código (URLs las arma el sitio, no el spider). Para los que NO calzan con el regex, `product_id` cae al fallback `enlace_normalized` (la URL sin query, normalizada) — así que hoy el "id de producto" es, de facto, la URL normalizada para la mayoría de las tiendas. |
| `categoria` | los 6 spiders producen slugs **propios** (`'computadores'`, `'celulares'`, `'pantallas'`, `'tablets'`, `'impresoras'`, `'audio'`, `'consolas'`, `'perifericos'`, `'otros'`, `'accesorios_pc'`, `'mouse_teclado'`...) que **NO** coinciden con los slugs reales de `category_product`/`categories` del catálogo (`laptop`, `mobiles`, `monitor`, `console`, `headphone`, `sound-box`, `camera`, `router`, `smart-watch`, `accessories-gfa` — tabla de `db/README.md:53-61`). Este mapeo es US-7, explícitamente fuera de alcance de US-6; el pipeline de US-6 no debe tocar `category_product`. |

### Contrato de destino (`db/schema.sql` + `db/README.md`)

- `products` (schema.sql:207-288): `type_id bigint NOT NULL REFERENCES types(id)`, `shop_id bigint NOT NULL REFERENCES shops(id)`, `manufacturer_id` nullable, `product_type` default `'simple'`, `price`/`sale_price` `numeric(12,2)` nullables a nivel de columna pero con el CHECK `products_simple_con_precio` (`product_type <> 'simple' OR price IS NOT NULL`) — como el scraper solo produce simples, `price` es efectivamente obligatorio. `image jsonb` (README de `db/` confirma que la app espera `{id, original, thumbnail}`, no un string plano). `source_store`/`source_product_id`/`source_url`/`scraped_at` son las columnas de procedencia; el CHECK `products_procedencia_completa` exige que `source_store` y `source_product_id` vayan juntos o ninguno.
- Constraints relevantes para R-1: `products_rebaja_valida` (`sale_price IS NULL OR price IS NULL OR sale_price < price`), `products_simple_con_precio`, `products_procedencia_completa`.
- Índice `products_procedencia_key` (schema.sql:294-296): `UNIQUE (source_store, source_product_id) WHERE source_store IS NOT NULL` — la clave del `ON CONFLICT`.
- `slugify(texto)` (schema.sql:47-60) y `unaccent_simple` (schema.sql:38-45) **sí existen** en la base, `IMMUTABLE STRICT` (entrada `NULL` → `NULL`, sin excepción). Confirmado leyendo el DDL completo.
- `shops` (schema.sql:114-127): `name NOT NULL`, `slug NOT NULL UNIQUE`, `owner_id bigint NOT NULL DEFAULT 1` (no hay FK real a `users`, así que el default sirve para las tiendas creadas por el scraper).
- `manufacturers` (schema.sql:164-175): `name NOT NULL`, `slug NOT NULL UNIQUE`, `type_id` nullable.
- **`type_id` no tiene ninguna fuente en los items del scraper** ni el DDL, ni US-6, ni US-7 dicen explícitamente cómo resolverlo — pero es `NOT NULL` en `products`, así que el INSERT lo necesita SÍ o SÍ para CA-1/CA-2, aunque el mapeo categoría→`category_product` (US-7) sea lo que quede fuera. `db/seed.sql:40` confirma `(9, 'Gadget', 'gadget', ...)` como el `type` de tecnología ya sembrado — es el candidato obvio (`SELECT id FROM types WHERE slug='gadget'`), pero **es una decisión de diseño que el explore no puede cerrar por su cuenta**: no está escrita en ninguna de las dos US ni en `db/README.md`.
- `db/README.md` (completo, 89 líneas): confirma que el scraper crea `shops` (retailers) y `manufacturers` (marcas) en runtime, que `categorizar()` debe devolver los slugs de categoría YA existentes (no inventar los suyos — hoy los spiders NO lo hacen, ver tabla arriba, pero es problema de US-7), y dice explícitamente que la moneda es una decisión de producto pendiente y fuera de alcance técnico.
- `services/scraper-worker/schema.sql` es un tombstone puro (sin DDL): confirma por escrito que el scraper no tiene esquema propio.

### Precedente ya escrito en `packages/db` (patrón a espejar en Python)

`packages/db/src/repositories/products.repository.ts` YA implementa el mismo problema en TypeScript, y es el precedente más fuerte para el design de US-6:
- `upsertScrapedProduct()` (líneas 275-344): valida `salePrice >= price` ANTES de tocar la base (`InvalidSalePriceError`, líneas 278-280) — exactamente la política de "sanear/rechazar antes del INSERT" que R-1 pide decidir. Usa `prisma.product.upsert({ where: { sourceStore_sourceProductId: {...} }, create, update })`, espejo directo de `ON CONFLICT (source_store, source_product_id) DO UPDATE`.
- El slug **no lo genera este repositorio** — lo recibe como `input.slug` ya resuelto por el caller. Esto es coherente con la Decisión #3 del épico ("slug vía `slugify()` de la base, no en Python"): el equivalente Python deberá pedirle el slug a Postgres explícitamente (`SELECT slugify($1)`), no a `prisma` ni reimplementando la función.
- `_translateCheckViolation()` (líneas 401-413) traduce los 3 nombres de constraint (`products_rebaja_valida`, `products_simple_con_precio`, `products_procedencia_completa`) a errores de dominio — mismo criterio de "backstop" (validar antes, pero también capturar el mensaje de Postgres) que el pipeline Python puede replicar con `psycopg.Error` + inspección del mensaje.
- `shops.repository.ts::findOrCreateShopBySlug()` (líneas 87-103) y `manufacturers.repository.ts::findOrCreateManufacturerBySlug()` (líneas 56-71) son el patrón get-or-create exacto que D-1 del épico pide: `upsert` por `slug` con `update: {}` (no pisa nada si ya existe). Columnas mínimas: `shops` exige solo `slug` + `name`; `manufacturers` solo `slug` + `name` (+ `typeId` opcional).
- Ninguno de los tres repositorios genera el slug con lógica JS — confirma que el slugify vive solo en SQL.

### Estado de US-2 (visibilidad HTTP para CA-5)

`apps/api/rest/src/products/products.service.ts::getProducts()`/`getProductBySlug()` (líneas 180-236) **ya salen de Postgres** vía `@safari/db` (`listProducts`, `findProductBySlug` — import línea 8-16), confirmado también por el archivo archivado `openspec/changes/archive/2026-08-25-migrar-api-products-postgres/`. **CA-5 puede verificarse con `curl http://localhost:9001/api/products` además de `just db-shell`** — no hace falta depender solo del `SELECT` directo.

## Affected Areas

- `services/scraper-worker/pipelines.py` — reescritura completa del `UPSERT` y de `process_item`: mapeo item→columnas de `products`, get-or-create de `shops`/`manufacturers` (cacheado por corrida, D-1), llamada a `slugify()` de la base, política de descarte para las 3 CHECK constraints (R-1), y resolución de `type_id` (hallazgo nuevo, ver Risks).
- `services/scraper-worker/items.py` — revisar si algún campo del mapeo objetivo (p. ej. `sale_price`/`promocion` para alkosto/compuworking/tauret, que hoy no declaran ese campo en su `Item`) necesita agregarse al `scrapy.Item` correspondiente; el propio US-6 lo prevé como "solo si el mapeo exige un campo que hoy no viaja".
- NO afectado (confirmado, fuera de alcance): `services/scraper-worker/spiders/*.py`, `test_pipeline.py`, `justfile` (targets `db-test`/`db-count`/`scrape` siguen apuntando a `productos` hasta US-8), `db/schema.sql`, `category_product`.

## Approaches

1. **Espejar `packages/db/products.repository.ts` 1:1 en Python (recomendado)** — mismo orden de validación (checks en Python antes del INSERT, con traducción de errores de Postgres como backstop), mismo cache in-memory de shops/manufacturers por corrida (dict `{slug: id}` poblado con `INSERT ... ON CONFLICT (slug) DO NOTHING RETURNING id` + `SELECT` de respaldo), mismo criterio de "slug lo resuelve la base, no Python".
   - Pros: reutiliza una decisión de diseño ya tomada y probada (tests de integración en `products.integration.test.ts`); reduce el riesgo de re-discutir R-1/R-2 desde cero; consistente con el principio de simplicidad (no inventar un patrón nuevo).
   - Cons: hay que traducir Prisma→SQL crudo a mano (psycopg no tiene upsert declarativo); el cache de shops/manufacturers en memoria de Python debe ser thread/proceso-local (Scrapy es single-process por spider, así que no hay problema de concurrencia real, pero si el design cachea "de más" entre corridas se arriesga a servir un id de shop borrado — mitigar con TTL de una sola corrida, igual que el TS).
   - Effort: Medium (~250 LOC, coincide con la estimación de la US).

2. **UPSERT único con CTEs anidados (`WITH shop AS (...), manufacturer AS (...), prod AS (...) INSERT ...`)** — resolver shop/manufacturer/slug y el upsert de products en una sola sentencia SQL por item, sin cache en Python.
   - Pros: menos estado mutable en Python; una sola ida a la base por item.
   - Cons: dificulta la política de descarte de R-1 (hay que envolver TODO el CTE en el try/except, perdiendo granularidad sobre cuál parte falló); diverge del patrón ya usado en `packages/db` (dos pasos: get-or-create explícito, luego upsert), lo que complica auditar consistencia entre las dos capas de escritura del mismo catálogo.
   - Effort: Medium-High (SQL más difícil de leer/mantener por un estudiante, que es la audiencia declarada del repo).

## Recommendation

Approach 1 (espejar `packages/db`). Es el camino de menor sorpresa: el problema de "get-or-create idempotente + upsert por clave natural + slug resuelto en SQL + CHECKs traducidos a política de descarte" ya está resuelto y probado en TypeScript en el mismo repo, para las mismas tablas. El design de US-6 debe decidir explícitamente, antes de escribir código:

- **Política R-1** (por constraint, no genérica): sin `price` → descartar el item completo (falla `products_simple_con_precio`, no hay valor razonable que inventar); `sale_price >= price` → descartar SOLO la promoción (guardar el item con `sale_price = NULL`) o descartar el item entero — es una decisión de producto menor que el design debe fijar explícitamente citando el precedente de `InvalidSalePriceError` en `packages/db` (que hoy lanza en vez de sanear).
- **Política R-2** (colisión de slug): el índice de `slug` es único global y `slugify()` es determinista sobre el nombre — dos productos de tiendas distintas con el mismo nombre chocan. Sufijo recomendado: `slugify(nombre) || '-' || slugify(tienda)` (estable para CA-3, determinista, no depende de un contador ni de un hash con estado). Alternativa con hash de `source_product_id` es más opaca sin ganar estabilidad.
- **`type_id`**: resolver una sola vez por corrida con `SELECT id FROM types WHERE slug = 'gadget'` (cachear el id, igual que shops/manufacturers) — es un hallazgo de esta exploración, no una decisión ya tomada por el épico ni por ninguna de las dos US; el design de US-6 debe declararlo explícitamente como decisión propia.
- **Mapeo de `image`**: envolver la URL cruda del scraper en `{"id": null, "original": <url>, "thumbnail": <url>}` para respetar la forma que la tienda espera (README de `db/`), no guardar el string plano.
- **Campos sin destino en el schema** (`descuento`, `vendedor`, `calificacion` de los spiders que no son Éxito): `descuento` es derivable de `price`/`sale_price` y no tiene columna propia — no se persiste tal cual; `calificacion` mapea a `ratings` solo si el item la trae (Éxito), default `0` el resto; `vendedor` (solo Falabella) no tiene columna equivalente y el design debe decidir explícitamente ignorarlo (no hay "seller" en `products`, solo `shop_id`).

## Risks

- **R-1 (del épico, confirmado con código real)**: compulago (`_fmt(None)` → `'N/D'`) y falabella (mismo `_fmt`) pueden emitir `precio='N/D'`, que `parse_numero()` convierte a `None` → viola `products_simple_con_precio`. Ítems reales de esos dos spiders pueden disparar este descarte con frecuencia no trivial.
- **R-2 (del épico, confirmado)**: sin sufijo de desambiguación, dos retailers con el mismo nombre de producto (frecuente: mismo modelo de laptop en Alkosto y Falabella) rompen el UNIQUE de `slug` en el segundo INSERT.
- **Hallazgo nuevo — `type_id` sin decisión escrita**: ni la US-6 ni el épico documentan de dónde sale `type_id` para el INSERT (NOT NULL). Debe resolverse en el design antes de escribir código, o el `INSERT` no compila contra el esquema real.
- **Hallazgo nuevo — `extraer_product_id()` no calza con la mayoría de las URLs reales**: el regex `/product/(\d+)/` (inglés, singular) probablemente solo matchea Falabella; el resto cae al fallback de URL normalizada como "id". Esto es el comportamiento ACTUAL (no es responsabilidad de US-6 arreglarlo, ya que no toca spiders), pero el design debe decidir explícitamente si acepta la URL normalizada como `source_product_id` válido para 5 de 6 tiendas, porque de eso depende la estabilidad de la clave de upsert (CA-1) — si la tienda cambia la URL del mismo producto (frecuente en e-commerce con parámetros de tracking), el "mismo producto" dejaría de reconocerse como tal.
- **Pérdida de signo en `parse_numero()`**: el regex `[^\d,]` borra el `-` de `"-11%"` (Éxito). No rompe ninguna constraint (el campo `descuento` no tiene columna destino, ver Recommendation), pero si el design decidiera persistir algo derivado del signo, hoy se pierde.
- **Inconsistencia de marca "sin detectar"** (`"GENÉRICA"` vs `"GENERICA"`): no es un riesgo real gracias a `slugify()` (ambas colapsan a `generica`), pero vale la pena que el design lo mencione explícitamente para que no se lea como bug durante la implementación.
- **`just db-test`/`db-count` seguirán rojos** tras esta US (US-8), como ya advierte la nota del agente ejecutor — no hay que "arreglarlos" recortando el alcance de US-6; la evidencia de la Definición de Done debe salir de un script temporal de scratchpad, no de `test_pipeline.py`.

## Ready for Proposal

Sí, con las decisiones de diseño explícitas pendientes (política R-1 por constraint, sufijo de desambiguación de R-2, y — hallazgo nuevo — la resolución de `type_id`) documentadas como preguntas a cerrar en `design.md`, no en `proposal.md`. El orquestador puede avanzar a `sdd-propose`; el `design.md` posterior debe citar explícitamente el precedente de `packages/db/src/repositories/products.repository.ts` (líneas 275-344) como referencia de la política de validación pre-INSERT + backstop de traducción de errores.
