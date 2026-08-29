# Proposal: Upsert del pipeline del scraper en `products` con procedencia

> **US-6**, Épico 5 (`docs/product/5-scraper-catalogo-compartido/6-pipeline-upsert-products.md`).
> Insumo: `explore.md` de esta carpeta. Precedente estructural:
> `openspec/changes/archive/2026-08-26-catalogos-planos-postgres/`. Precedente **de código**:
> `packages/db/src/repositories/products.repository.ts:275-344` y `:401-413`.

## Intent

`PostgresPipeline` escribe en una tabla que no existe: `services/scraper-worker/pipelines.py:47-71` hace `INSERT INTO productos (tienda, product_id, nombre, …) ON CONFLICT (tienda, product_id)`, y `db/schema.sql` no declara ninguna tabla `productos`. Cualquier `just scrape <spider>` real muere con `UndefinedTable` en el primer item y suma a `stats["fallidos"]` (`:133-135`). El flujo scraper → base → tienda que prometen `db/README.md` y el tombstone `services/scraper-worker/schema.sql` no existe en código: es el último eslabón roto, ahora que `apps/api/rest/src/products/products.service.ts:180-236` ya sirve `products` desde Postgres.

## Scope

### In Scope

| Entrega | Detalle |
|---|---|
| `UPSERT` reescrito | `INSERT INTO products … ON CONFLICT (source_store, source_product_id) DO UPDATE`, sobre el índice parcial `products_procedencia_key` (`db/schema.sql:294-296`) |
| Mapeo item→columnas | `nombre`→`name`, `precio`→`price`/`min_price`/`max_price`, `promocion`→`sale_price`, `enlace`→`source_url`, `tienda`→`source_store`, `extraer_product_id(…)`→`source_product_id`, `imagen`→`image` jsonb, `calificacion`→`ratings` |
| Get-or-create `shops` | Retailer → fila en `shops`, idempotente por `slug` (`name`+`slug` bastan; `owner_id` tiene `DEFAULT 1` — `db/schema.sql:114-127`), cacheado por corrida (D-1 del épico) |
| Get-or-create `manufacturers` | Marca → fila, idempotente por `slug` (`db/schema.sql:164-175`), cacheado por corrida |
| Slug vía la base | `SELECT slugify($1)` (`db/schema.sql:47-60`), nunca reimplementado en Python (Decisión 3 del épico) |
| Política ante las 3 CHECK | Validación en Python antes del INSERT + traducción del error de Postgres como backstop; el item inválido se descarta, se loguea, cuenta en `stats`, y la corrida sigue |
| `type_id` resuelto | Columna `NOT NULL` (`db/schema.sql:214`) sin fuente en los items: se resuelve una vez por corrida y se cachea |

### Out of Scope (vinculante — el "NO incluye" de la US)

Categorías / `category_product` (**US-7**) · `test_pipeline.py` y el `justfile` (**US-8**) · los 6 spiders · conversión de moneda (COP se guarda tal cual) · `db/schema.sql` · re-scrapeos masivos · `packages/db` (el pipeline habla SQL directo con `psycopg`).

**`just db-test` y `just db-count` seguirán rojos al cerrar esta US**: estado esperado, no regresión.

**`items.py` NO se toca** — corrige la fila condicional de la tabla de archivos de la US: `process_item` lee con `ItemAdapter(item).asdict()` + `.get()` (`:108-126`), así que un campo ausente ya se tolera. Ningún campo del mapeo exige declararse.

## Capabilities

### New Capabilities

- `scraper-product-ingestion`: ingesta idempotente de productos scrapeados en el catálogo compartido (`products` + `shops` + `manufacturers`), identificados por procedencia, con política declarada de descarte ante las invariantes del esquema.

### Modified Capabilities

- None. `product-listing-api` y `product-detail-api` no cambian de requisito: las filas del scraper entran por las columnas que ya leen.

## Approach

**Approach 1 de la exploración: espejar `products.repository.ts` en Python.** Resuelve el mismo problema, contra las mismas tablas, cubierto por tests de integración reales:

- `upsertScrapedProduct()` (`:275-344`) valida `salePrice >= price` antes de tocar la base (`:278-280`) y hace `upsert` por `sourceStore_sourceProductId` — espejo del `ON CONFLICT`. Aporta dos detalles reutilizables: para un `simple`, `min_price = max_price = price` (`:294-295`), y **el `slug` no se pisa en el `update`** (`:329`), justo lo que CA-3 exige.
- `_translateCheckViolation()` (`:401-413`) traduce los 3 nombres de constraint a errores de dominio; en Python, inspeccionar el mensaje de `psycopg.Error`.
- `findOrCreateShopBySlug()` (`shops.repository.ts:87-103`) y `findOrCreateManufacturerBySlug()` (`manufacturers.repository.ts:56-71`) hacen `upsert` por `slug` con `update: {}`; en SQL, `INSERT … ON CONFLICT (slug) DO NOTHING` + `SELECT` de respaldo.

Se descarta el Approach 2 (CTEs anidados en una sentencia): perdería granularidad sobre *qué* falló — lo que CA-4 pide loguear — y divergiría del patrón de dos pasos auditable en `packages/db`.

Se preserva del código actual: conexión única `autocommit=True` (`:99`), `self.stats` (`:100`), el `try/except psycopg.Error` con `spider.logger.error` (`:133-135`), y `parse_numero()`/`normalizar_enlace()`/`extraer_product_id()` sin cambios de comportamiento.

## Mapeo de criterios de aceptación

| CA | Qué lo entrega |
|---|---|
| **CA-1** upsert idempotente | `ON CONFLICT (source_store, source_product_id) DO UPDATE`; se conserva `RETURNING (xmax = 0)` para distinguir insertados de actualizados |
| **CA-2** retailer y marca reales | Get-or-create por `slug` + caché por corrida: el 2.º item de la misma tienda/marca no vuelve a la base ni duplica |
| **CA-3** slug estable y único | `slugify()` determinista + sufijo de desambiguación (decisión abierta) + el `slug` no se actualiza en el `DO UPDATE` |
| **CA-4** las constraints no matan la corrida | Validación pre-INSERT por constraint + `try/except` que loguea, incrementa `stats` y devuelve el item |
| **CA-5** visible en la tienda | Las filas caen en la tabla que ya lee `products.service.ts:180-236`: verificable por `SELECT` y por HTTP |

## Decisiones abiertas — las cierra `design.md`, NO este proposal

1. **R-1 — política por constraint.** `products_simple_con_precio` (item sin precio: compulago y falabella emiten `'N/D'`, que `parse_numero` vuelve `None`) → ¿descarte del item? `products_rebaja_valida` → ¿descartar el item entero o solo la promoción (`sale_price = NULL`)? El precedente TS **lanza** en vez de sanear, pero allí decide el caller; aquí el caller es el pipeline. `products_procedencia_completa` → declarar el caso `tienda` vacía.
2. **R-2 — sufijo de desambiguación del slug.** Candidato: `slugify(nombre) || '-' || slugify(tienda)`. El design lo fija y justifica que respeta la estabilidad de CA-3 (sin contadores ni estado).
3. **`type_id` — hallazgo nuevo de la exploración.** `NOT NULL REFERENCES types(id)` (`db/schema.sql:214`) y **ningún item lo provee**; ni la US, ni el épico, ni `db/README.md` dicen de dónde sale. Candidato verificado: `db/seed.sql:40` siembra `(9, 'Gadget', 'gadget', …)`. El design debe adoptarlo como decisión propia (`SELECT id FROM types WHERE slug='gadget'`, cacheado) y decidir qué pasa si la fila no existe.

Menores a declarar también en el design: `image` como jsonb `{id: null, original: url, thumbnail: url}` (no string plano); `vendedor` (solo `FalabellaItem`) se ignora — no hay columna equivalente; `descuento` no se persiste (derivable); `source_product_id` cae al enlace normalizado en las tiendas cuya URL no matchea `/product/(\d+)/`.

## Affected Areas

| Área | Impacto | Descripción |
|---|---|---|
| `services/scraper-worker/pipelines.py` | Modified | Único archivo de producción: constante `UPSERT`, helpers de get-or-create/slug/`type_id`, `open_spider` (cachés), `process_item` (mapeo + descarte) |
| `docs/product/5-scraper-catalogo-compartido/6-pipeline-upsert-products.md` | Modified | Status de la US |
| `docs/product/5-scraper-catalogo-compartido/README.md` | Modified | Fila de US-6 del épico |
| `items.py`, `spiders/`, `test_pipeline.py`, `justfile`, `db/schema.sql`, `packages/db` | Sin cambios | Fuera de alcance |

## Risks

| Riesgo | Prob. | Mitigación |
|---|---|---|
| **R-1 del épico**: items sin precio (`'N/D'`) descartados en volumen no trivial (compulago/falabella) | Alta | Política explícita + contador en `stats`; el resumen de `close_spider` lo hace visible |
| **R-2 del épico**: colisión de `slug` (mismo modelo en dos retailers) rompe el `UNIQUE` global | Alta | Sufijo de desambiguación (decisión 2) |
| **`type_id` sin decisión escrita** bloquea el INSERT (`NOT NULL`) | Alta | Decisión 3; sin cerrarla, `sdd-apply` no puede escribir el `INSERT` |
| Sin gate automatizado (`db-test` roto hasta US-8) | Media | Script de scratchpad + `db-shell` + `curl`, con salida pegada literal |
| `source_product_id` = URL normalizada en 5 de 6 tiendas: si la URL cambia, se crea fila nueva en vez de actualizar | Media | Comportamiento **actual** de `extraer_product_id()` (`:40-44`); arreglarlo tocaría spiders (fuera de alcance) |
| Filas de prueba mezcladas con el seed | Baja | `source_store` reconocible; se borran con un `DELETE` acotado |

## LOC forecast y presupuesto de review

`pipelines.py` ~230 líneas (reemplaza ~90) + ~10 de docs = **~240**, coherente con la estimación de la US (~250). **Cabe holgadamente en un PR único** bajo el guard de 400 líneas — a diferencia de US-4a, que necesitó cadena de PRs. Un archivo de producción, sin cambios de esquema, build ni frontend: no se recomienda partirlo. `ask-on-risk` no debería dispararse, salvo que el design decida **sanear** en vez de descartar (cambio de política de datos, no de tamaño).

## Rollback Plan

El change toca **un solo archivo de producción de un servicio que hoy ya está roto**.

- **Código**: `git revert` del commit. El pipeline vuelve a apuntar a `productos`, o sea al estado roto actual: no hay función operativa que perder.
- **Datos**: el cambio es aditivo (`ON CONFLICT` por procedencia nunca toca las 1200 filas del seed, con `source_store IS NULL` y fuera del índice parcial). Limpieza: `DELETE FROM products WHERE source_store IS NOT NULL;` (y las `shops`/`manufacturers` del scraper, identificables por slug). En caso extremo, `just db-reset`.
- **Sin cambios de esquema, dependencias ni build**: no hay `just db-build` ni `yarn install` que rehacer; `services/scraper-worker` no participa de ningún build.

## Dependencies

`just db-up` (Postgres en el 5433, sembrado) · `just scraper-install` (venv con `psycopg`) · `DATABASE_URL` en `services/scraper-worker/.env` · US-2 embarcada (solo para la vía HTTP de CA-5) · **`design.md` con las 3 decisiones abiertas cerradas — bloqueante para `sdd-apply`**.

## Success Criteria (evidencia de la Definición de Done)

`test_pipeline.py` está fuera de alcance: la corrida sintética sale de un **script temporal en el scratchpad** que instancia `PostgresPipeline` con un spider falso y le pasa items a mano, sin salir a internet. Puerto 9001 (el 9000 es Zscaler); `jq` no está instalado — JSON con `node -e`.

- [ ] **CA-1**: mismo item dos veces con precios distintos → UNA fila, precio actualizado, `slug` intacto; `stats` real pegado (`insertados: 1, actualizados: 1`).
- [ ] **CA-2**: 2 items del mismo retailer/marca → 1 fila en `shops` y 1 en `manufacturers`; conteos antes/después pegados.
- [ ] **CA-3**: dos productos con el mismo nombre en tiendas distintas conviven sin violar el `UNIQUE`.
- [ ] **CA-4**: item con `sale_price > price` y item sin precio → descartados con log, `stats["fallidos"] == 2`, la corrida procesa el siguiente.
- [ ] **CA-5**: `SELECT source_store, count(*) FROM products GROUP BY 1` vía `just db-shell` (scraper junto a las `NULL` del seed) **y** `curl -s http://localhost:9001/api/products`.
- [ ] `just db-check` sigue verde (no debe regresionar: no se toca `packages/db`).
- [ ] Status de US-6 actualizado y su fila del épico marcada.

## Observaciones fuera de alcance (detectadas, NO accionadas)

- `extraer_product_id()` (`:40-44`) busca `/product/(\d+)/` (inglés): probablemente solo matchea Falabella; compulago/tauret usan `/producto/`.
- `parse_numero()` (`:23`) borra el `-` con `re.sub(r"[^\d,]", "")`: el `"-11%"` de Éxito (`exito.py:91`) pierde el signo. Inocuo hoy — `descuento` no tiene columna destino.
- **Refutación a la exploración**: afirma que `AlkostoProjectItem` "no declara `promocion`". `services/scraper-worker/items.py:2-12` **sí lo declara** (con `descuento` y `calificacion`); lo que pasa es que `spiders/alkosto.py` nunca los asigna. Mismo efecto, otra causa. Los `Item` que sí carecen de `promocion` son `ComputerworkingItem` y `TouretItem`.
- El error de `open_spider` (`:97`) sugiere el puerto **5432**; `docker-compose.yml` usa el **5433**. Cosmético.
- Marca sin detectar llega como `"GENÉRICA"` (alkosto) y `"GENERICA"` (el resto): `slugify()` colapsa ambas a `generica`; el get-or-create no duplica. No es un bug.
