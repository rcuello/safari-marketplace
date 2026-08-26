# Apply Progress — migrar-api-products-postgres

**Mode:** Standard (strict_tdd: false, gate: `just db-check`)
**Batch:** 1/1 (single PR, no chaining — forecast Low, 275 líneas cambiadas < 400)

## Entorno verificado antes de tocar código

- `docker ps`: `safari-postgres` Up (healthy) en :5433 — ya estaba levantado.
- `packages/db/dist` ya existía (`index.js`/`index.d.ts`) — no se reconstruyó.
- `apps/api/rest/node_modules` ya existía — no se reinstaló.
- `jq` **no está disponible** en este Git Bash (`where jq` → sin resultados).
  Todas las verificaciones que el design.md especifica con `jq -S` se
  reprodujeron con `node -e` haciendo un sort-deep + `JSON.stringify`
  equivalente (mismo resultado semántico: comparación de key-sets, ids y
  diff completo). Se documenta como sustitución de herramienta, no como
  desviación de criterio.

## Baseline (Phase 1, task 1.5 — ANTES del cambio)

```
$ curl -s "http://localhost:9001/api/products?limit=30&searchJoin=and&with=type;author&search=status:publish;visibility:visibility_public" > mock.json
$ node -e "... total, per_page, data.length, keys ..."
total: 1199 per_page: "30" data.length: 30
first id: 1
keys: [id, name, slug, type, language, translated_languages, product_type,
       shop, sale_price, max_price, min_price, image, status, price,
       quantity, unit, sku, sold_quantity, in_flash_sale, visibility]
```

Capturado ANTES de editar `products.service.ts` (orden de ejecución
respetado).

## Implementación (Phase 2)

`apps/api/rest/src/products/products.service.ts`:
- `parseProductSearch(search)` — función privada a nivel de módulo, trocea
  `search` por `;` y el primer `:`, mapea a `ListProductsInput` según la
  tabla del design; `slug` descartado, claves desconocidas ignoradas.
- `toProductDto(record)` — función privada, literal de 20 claves
  snake_case en el orden del design; `type.logo` e `in_flash_sale`
  constantes; cast `as unknown as Product` (precedente
  `settings.service.ts:39`).
- `getProducts()` ahora `async`. Conserva literal
  `if (!page) page = 1; if (!limit) limit = 30;`. `listProducts()` recibe
  `Number(page) || 1` / `Number(limit) || 30`; `paginate()` y la URL
  reciben `page`/`limit` crudos, sin convertir (split raw-vs-numérico del
  design, Decision A).
- `try/catch` alrededor de `await listProducts(input)`:
  `isPrismaConnectionError(error)` → `ServiceUnavailableException` (503);
  cualquier otro error → `InternalServerErrorException` (500); ambos con
  `getUserFriendlyMessage()` del barrel `@safari/db`.
- El resto del archivo queda intacto: imports de `productsJson` /
  `popularProductsJson` / `bestSellingProductsJson` y la instancia `fuse`
  permanecen (Decision B — `getPopularProducts`/`getBestSellingProducts`/
  `getProductsStock`/`getDraftProducts` siguen usándolos).

Recompilación en watch mode (`just api-dev`, ya corriendo desde el
baseline): `Found 0 errors` en cada guardado; `Nest application
successfully started` tras cada cambio.

## Tests de integración (Phase 3)

`packages/db/src/repositories/products.integration.test.ts`: 3 tests
nuevos bajo `describe('listProducts — filtros adicionales de US-2')`:

1. `shopId` — sobre un shop real del seed: `total > 0`, todo item con ese
   `shopId`.
2. `manufacturerSlug` — fixture única vía `upsertScrapedProduct` con
   `manufacturerId: M_FIX.id` (`price: 100, salePrice: 80`); `M_LIBRE.slug`
   (otro manufacturer del seed, sin productos) → `total === 0`;
   `M_FIX.slug` → `total === 1`, `sourceStore === TEST_STORE`.
3. `tagSlug` — misma fixture con `tagIds: [T_FIX.id]`; `T_LIBRE.slug` →
   `total === 0`; `T_FIX.slug` → `total === 1`.

`M_LIBRE`/`M_FIX`/`T_LIBRE`/`T_FIX` se resuelven en runtime con
`prisma.manufacturer.findMany`/`prisma.tag.findMany` (los dos primeros del
seed, ordenados por `id`) — no se hardcodean ids, siguiendo el patrón de
`findTypeBySlug('gadget')` ya usado en el archivo.

```
$ just db-check
npm run typecheck  → tsc --noEmit: sin errores
npm test           → vitest run
 Test Files  1 passed (1)
      Tests  14 passed (14)
   Duration  5.64s
```

11 tests previos + 3 nuevos = 14/14 en verde.

## Verificación — evidencia real (Phase 4, CA-1..CA-5)

### CA-1 — paridad de contrato (mock.json antes vs pg.json después)

```
$ curl -s "http://localhost:9001/api/products?limit=30&searchJoin=and&with=type;author&search=status:publish;visibility:visibility_public" > pg.json
```

Envoltorio (`del(.data)`, sustituido por `node -e` con destructuring
`{data, ...wrap}`): **IDÉNTICO**
```
total:1199 current_page:1 count:30 last_page:40 firstItem:0 lastItem:29
per_page:"30" first_page_url/last_page_url/next_page_url/prev_page_url
idénticos en mock y pg
```

Key-set (`[.data[]|keys]|unique`, sustituido por `node -e` con
`Object.keys(d).sort()` deduplicado): **IDÉNTICO** — un único conjunto de
20 claves en ambos, mismo orden:
`id,name,slug,type,language,translated_languages,product_type,shop,sale_price,max_price,min_price,image,status,price,quantity,unit,sku,sold_quantity,in_flash_sale,visibility`

Ids de la página 1 (`[.data[].id]`): **IDÉNTICO**, 1..30 sin diff.

Diff completo (`jq -S .`, sustituido por sort-deep + `JSON.stringify`
recursivo por fila): **1 sola fila con diferencia** —
`id 2`: `in_flash_sale` mock=`1` → pg=`0`. Exactamente la divergencia #1
predicha por el design ("no hay columna, 1 fila: id 2, página 1"). Ninguna
otra fila de las 30 difiere.

### CA-2 — cardinalidad de búsqueda por nombre

```
$ curl -s "http://localhost:9001/api/products?limit=30&search=name:apple;status:publish;visibility:visibility_public" | node -e "... total, names ..."
total: 17
names: [Apples, Nims Apple Crisp, Nongmo Simple Apple, Tropicana Apple,
        First Street Apple Pie..., Jessie Lord No Sugar Added Apple Pie...,
        Signature Kitchens 11 inch Apple Pie, First Street Apple Pie... (dup),
        Jessie Lord... (dup), Signature Kitchens 11″ Apple Pie,
        Fresh Apples 2lbs, Organic Green Apples, Fresh Red Apples,
        Red Prince Apples, Fresh Fruit Apples, Apples (dup), Nims Apple Crisp (dup)]
```

`total: 17`, NO 20 — confirma la divergencia #8 (fuse.js matchea 3 filas
extra por fuzziness que `contains` no puede matchear). No se ensanchó el
filtro para "corregir" esto — es el resultado correcto según el design.

### CA-3 — `just verify`

Primera corrida falló por timeout (Next dev compilando la ruta SSR en frío
por primera vez, ~14–47s):
```
OK   API    :9001/api/settings  200  5503B  17ms
FALLA Shop   :3003 ECONNREFUSED
FALLA Admin  :3002 ECONNREFUSED
```

Tras precalentar shop (`curl --max-time 90` → `shop:200 time:14.19s`) y
con admin ya arrancado, segunda corrida en verde:
```
OK   API    :9001/api/settings  200  5503B  209ms
OK   Shop   :3003/en  200  212886B  5619ms  cards:30
OK   Admin  :3002/en/login  200  72821B  615ms  cards:1
```

### CA-4 — origen vivo (sin reiniciar la API)

```
$ docker exec -i safari-postgres psql -U safari -d safari_scraper -c "UPDATE products SET name='CANARIO' WHERE id=1;"
UPDATE 1

$ curl -s ".../api/products?limit=5&search=name:CANARIO;status:publish;visibility:visibility_public"
total: 1  id: 1  name: CANARIO

$ docker exec -i safari-postgres psql -U safari -d safari_scraper -c "UPDATE products SET name='Apples' WHERE id=1;"
UPDATE 1

$ curl -s ".../api/products?limit=5&search=name:CANARIO;..."
total after revert: 0
```

Cambio visible sin reiniciar `just api-dev`; revert confirmado.

### CA-5 — error controlado con Postgres caído

```
$ just db-down
Container safari-postgres  Removed

$ curl -s -o body.json -w '%{http_code}\n' "http://localhost:9001/api/products?$Q"
503

$ cat body.json
{"statusCode":503,"message":"No se puede conectar con el servicio. Por favor, intenta más tarde.","error":"Service Unavailable"}

$ curl -s -o /dev/null -w '%{http_code}\n' http://localhost:9001/api/types
200   ← proceso Nest sigue vivo

$ just db-up
  * esquema y datos de referencia aplicados (idempotente)

$ curl -s -o /dev/null -w '%{http_code}\n' http://localhost:9001/api/products?limit=5
200   ← recuperado sin reiniciar el proceso Nest
```

## Divergencias adicionales medidas (Phase 5, para verify-report)

- **#9 — `shop_id` + otro filtro**: `search=name:apple;shop_id:6` →
  Postgres devuelve **12 filas** (AND real). Nombres: Apples, Nims Apple
  Crisp, Nongmo Simple Apple, Tropicana Apple, First Street Apple Pie...,
  Jessie Lord..., Signature Kitchens 11″ Apple Pie, Fresh Apples 2lbs,
  Organic Green Apples, Fresh Red Apples, Red Prince Apples, Fresh Fruit
  Apples.
  **CORRECCIÓN post-verify (V-2, batch 2 abajo)**: esta sección decía
  originalmente "donde el mock daba 0" — esa cifra estaba MAL. El mock
  daba **20** (idéntico a `name:apple` solo; `shop_id` se descarta en
  silencio). El cambio real es **20 → 12**, no 0 → 12. Ver el detalle
  re-medido en la sección "Batch 2" al final de este documento.
- **#10 — `min_price`/`max_price`**: `search=min_price:50;status:publish;visibility:visibility_public`
  → `total: 195` en Postgres (rango real) donde el mock daba 0. Divergencia
  visible para el usuario según el design (el filtro de precio de la
  tienda hoy vacía la grilla y dejará de hacerlo).

Las 10 divergencias completas (incluida #8) están documentadas en
`design.md` → sección "Divergencias aceptadas"; esta corrida las
re-verificó donde aplicaba comando ejecutable (#1, #8, #9, #10). Las
restantes (#2 a #7) son estructurales/de datos del seed, ya verificadas en
el design contra los archivos fuente, no requieren comando adicional.

## Cierre documental (Phase 6)

- `docs/product/1-catalogo-desde-postgres/2-migrar-api-products-postgres.md`:
  `Status` → "Implementada"; los 5 items de la Definición de Done marcados
  `[x]`.
- `docs/product/1-catalogo-desde-postgres/README.md`: columna `Status`
  añadida a la tabla de sub-historias (no existía); US-2 → "✅ Implementada",
  US-3/US-4 → "Listo para ejecución" (sin cambios de fondo, solo para que la
  tabla quede consistente); `Status` del épico → "En ejecución" (era
  "Refinado"; no "Completado" porque US-3/US-4 siguen pendientes).

## Deviations from Design

**Ninguna funcional.** Una sustitución de herramienta, declarada:
`jq` no está instalado en este entorno Git Bash de Windows; todas las
verificaciones `jq -S` del `design.md`/`tasks.md` se reprodujeron con
`node -e` (sort-deep recursivo + comparación de `JSON.stringify`, o
destructuring + `Object.keys`), produciendo el mismo resultado semántico
que `jq -S` habría dado. No se relajó ningún criterio de comparación.

## Issues Found

- `just verify` falló en su primera corrida por timeout de compilación SSR
  en frío de Next dev (no relacionado con el cambio: ocurre con cualquier
  primera visita a una ruta en modo dev). Se resolvió precalentando la
  ruta con un curl de mayor timeout; la segunda corrida fue verde. No es un
  defecto del código migrado — CA-3 exige la salida de `just verify`, que
  ya está en verde arriba.

## Status (Batch 1)

24/24 tasks completas (Phases 1–6). Listo para `sdd-verify`.

---

# Batch 2 — Follow-up post-verify (V-2, V-3), reapertura autorizada

`sdd-verify` produjo `verify-report.md` con veredicto `PASS_WITH_WARNINGS`
y 4 reservas (V-1..V-4). El coordinador autorizó explícitamente reabrir
`sdd-apply` para dos de ellas: corregir la regresión V-3 y la cifra
incorrecta V-2. V-1 (flakiness de `just db-check` vía `just` vs `npm test`
directo) y V-4 (falta de cobertura del código nuevo de la API, más allá de
lo cubierto en el Ítem 1 de este batch) quedan fuera de esta reapertura —
no se tocan aquí.

## Item 1 — Fix V-3 (regresión: 500 en tokens numéricos malformados)

### Reproducción ANTES del fix

```
$ curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:9001/api/products?search=shop_id:abc"
500
$ curl -s "http://localhost:9001/api/products?search=shop_id:abc"
{"statusCode":500,"message":"Ocurrió un error inesperado. Por favor, contacta al administrador.","error":"Internal Server Error"}

$ curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:9001/api/products?search=min_price:abc"
500

$ curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:9001/api/products?search=shop_id:6"
200

$ curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:9001/api/products?search=min_price:50"
200
```

Causa raíz confirmada: `Number('abc')` es `NaN`; `buildWhere()` en
`products.repository.ts` usa `input.shopId !== undefined` (y lo mismo para
`minPrice`/`maxPrice`), y `NaN !== undefined` es `true` — así que el `NaN`
pasaba el guard y llegaba a Prisma, que lanza al construir el filtro con un
valor no numérico. El `catch` de `getProducts()` capturaba ese error pero
no era `isPrismaConnectionError`, así que caía en la rama 500.

### Fix aplicado

`apps/api/rest/src/products/products.service.ts` — nueva función privada
`parseFiniteNumber(value)`:

```ts
function parseFiniteNumber(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
```

Usada en los tres casos (`shop_id`, `min_price`, `max_price`) de
`parseProductSearch()`: si `parseFiniteNumber` devuelve `undefined`, el
campo correspondiente de `ListProductsInput` **no se asigna** — el token
se ignora, igual que hacía el mock (`parseInt('abc', 10)` → `NaN` →
`if (exactFilters.shop_id)` falsy → filtro descartado en silencio, 200).
No se usó `as any` ni `@ts-ignore`. No se cambió a 400: el contrato a
preservar (CA-1) es que el mock respondía 200.

### Verificación DESPUÉS del fix (API recompilada en watch mode)

```
$ curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:9001/api/products?search=shop_id:abc"
200
$ curl -s "http://localhost:9001/api/products?search=shop_id:abc" | node -e "..."
total: 1199   ← el token se ignora, defaults publish/visibility_public aplican igual

$ curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:9001/api/products?search=min_price:abc"
200
$ curl -s "http://localhost:9001/api/products?search=min_price:abc" | node -e "..."
total: 1199

$ curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:9001/api/products?search=max_price:abc"
200   ← mismo camino de código, verificación extra no pedida explícitamente pero cubierta por el mismo fix

$ curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:9001/api/products?search=shop_id:6"
200
$ curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:9001/api/products?search=min_price:50"
200
```

Los cuatro casos exigidos por el coordinador quedaron en 200; el quinto
(`max_price:abc`) se agregó porque comparte exactamente el mismo código.

### Verificación independiente adicional (no solo lectura del código)

Antes de tocar `design.md`/`spec.md` (Item 2), se hizo `git stash` de
**solo** `products.service.ts` para restaurar el código original del mock,
se esperó a que `nest start --watch` recompilara, y se corrió contra el
mock real (no contra el archivo fuente leído, contra el servidor
corriendo):

```
$ git stash push --message "temp-verify-mock-shop_id-divergence" -- apps/api/rest/src/products/products.service.ts
Saved working directory and index state On main: temp-verify-mock-shop_id-divergence

$ curl -s "http://localhost:9001/api/products?limit=30&search=name:apple;shop_id:6" | node -e "..."
name:apple;shop_id:6 -> total: 20

$ curl -s "http://localhost:9001/api/products?limit=30&search=shop_id:6" | node -e "..."
shop_id:6 alone -> total: 584

$ curl -s "http://localhost:9001/api/products?limit=30&search=name:apple" | node -e "..."
name:apple alone -> total: 20

$ git stash pop
Dropped refs/stash@{0} (...)
```

Confirma exactamente los tres números que reportó el coordinador (20, 584,
20). Tras el `stash pop`, se re-verificó que el fix V-3 seguía activo:

```
$ curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:9001/api/products?search=shop_id:abc"
200
$ curl -s "http://localhost:9001/api/products?limit=30&search=name:apple;shop_id:6" | node -e "..."
pg name:apple;shop_id:6 -> total: 12
```

### Cobertura (V-4, dentro del alcance de este batch solo para el fix de V-3)

**No se agregó un test unitario de `parseProductSearch`/`parseFiniteNumber`.**
Razón explícita: son funciones privadas a nivel de módulo en
`products.service.ts` (Decision C del design: sin archivo de mapper
propio, sin exports). `apps/api/rest` declara `jest` en su
`package.json` pero no tiene ningún `*.spec.ts`; escribir el primero
exigiría además exportar las funciones — revocar Decision C — lo cual el
reopen NO pidió y sería scope creep respecto a los dos ítems autorizados.
La ruta elegida es la que el propio reopen ofrece como válida: **no
fingir cobertura**, y dejar la evidencia curl de arriba (malformado → 200,
antes 500) como la verificación real de la regresión resuelta. Esto deja
V-4 formalmente abierto para US-3/US-4 (que reutilizarán `toProductDto` y
probablemente sí justifiquen un archivo `products.mapper.ts` con specs
propios) — no se cierra aquí.

## Item 2 — Fix V-2 (cifra incorrecta) + adición (divergencia #3 observable)

### Verificación independiente de la cifra V-2

Reutilizando el mismo stash de arriba (código original del mock
restaurado), se midieron los tres valores que dan origen a la corrección:

```
name:apple;shop_id:6  -> mock 20    (NO 0 — la cifra que tenían design.md/apply-progress.md estaba mal)
shop_id:6 solo         -> mock 584
name:apple solo        -> mock 20
name:apple;shop_id:6  -> Postgres 12   (ya medido en Batch 1)
```

Mecanismo (ya descrito correctamente en el design original, no cambia):
`exactFilters.shop_id` sí filtra bien contra `product.shop.id`, pero el
bloque `fuzzyFilters` que corre después **reasigna `data` desde cero**
corriendo `fuse.search()` sobre el índice completo — así que el filtro de
`shop_id` se pierde en silencio. La cifra que estaba mal no era el
mecanismo, era la consecuencia: el resultado no es "0", es "el mismo total
que el otro filtro solo" (20, no 0).

### Archivos corregidos

- `openspec/changes/migrar-api-products-postgres/design.md`:
  - Tabla "Divergencias aceptadas", fila #9: "mock 0 resultados" →
    "el mock descarta `shop_id` en silencio (devuelve lo mismo que el
    otro filtro solo)".
  - Tabla "Parseo `search`", fila `shop_id:v`: actualizada además para
    reflejar el fix V-3 (`parseFiniteNumber`).
  - Sección "Detalle de las divergencias 9 y 10": reescrita con los
    cuatro números medidos (20, 584, 20, 12) y la aclaración "20 → 12, no
    0 → 12".
  - Divergencia #3: aclarado que son 86 filas **totales**, 85
    **observables** vía el endpoint (id 454, type 6, `status:draft`, es
    la única fila de las 86 que Postgres nunca devuelve en una respuesta
    real). Verificado con SQL directo:
    ```sql
    SELECT t.id, count(*) total,
           count(*) FILTER (WHERE status='publish' AND visibility='visibility_public') observable
    FROM products p JOIN types t ON t.id=p.type_id WHERE t.id IN (6,11) GROUP BY t.id;
    --  6 | 55 | 54
    -- 11 | 31 | 31
    SELECT id, status, visibility FROM products WHERE type_id IN (6,11)
      AND NOT (status='publish' AND visibility='visibility_public');
    -- 454 | draft | visibility_public
    ```
- `openspec/changes/migrar-api-products-postgres/specs/product-listing-api/spec.md`:
  - Tabla de divergencias ratificadas (línea ~25): 86 totales / 85
    observables.
  - Párrafo de "Divergencias de búsqueda ratificadas" (línea ~73):
    reescrito con la cifra correcta (20 → 12, no 0 → 12).
  - Escenario Gherkin "Filtros que el mock perdía, aceptados" → renombrado
    "Filtros que el mock perdía o descartaba, aceptados"; el `GIVEN`/`THEN`
    ya no dice "ambos: 0 filas en el mock" (falso para el caso
    `shop_id`) — separa los dos casos con sus cifras reales.
- `openspec/changes/migrar-api-products-postgres/tasks.md`: tarea 5.1
  corregida con nota explícita de la corrección V-2.

### No tocado (confirmado explícitamente fuera de alcance)

`min_price`/`max_price` (mock 0, Postgres 195): el coordinador confirmó
que esa cifra SÍ es correcta y pidió no tocarla. No se modificó.

## Gate re-ejecutado tras el batch 2

```
$ just db-check
npm run typecheck  → tsc --noEmit: sin errores
npm test           → vitest run
 Test Files  1 passed (1)
      Tests  14 passed (14)
   Duration  2.07s
```

Sin cambios de comportamiento en `packages/db` en este batch (el fix vive
enteramente en `apps/api/rest`), así que 14/14 se mantiene igual que en
Batch 1 — se re-corrió de todas formas porque el reopen lo pidió
explícitamente.

## Entorno durante el batch 2

El proceso de `just api-dev` heredado de Batch 1 murió entre sesiones
(notificaciones de background-task `killed` recibidas antes del reopen).
Se relevantó con `just api-dev` (nueva instancia, watch mode) y se esperó
la compilación en frío (~70s) antes de la primera verificación. Postgres
(`safari-postgres`) permaneció Up todo el batch, sin necesidad de
`db-up`/`db-down`.

## Status (Batch 2)

Item 1 (V-3) y Item 2 (V-2 + adición divergencia #3) completos, con
evidencia real pegada arriba. V-1 y el resto de V-4 quedan fuera de esta
reapertura, sin tocar. 30/30 tasks completas (Phases 1–7, ver `tasks.md`).
