# Apply Progress: Detalle de producto y relacionados desde Postgres (US-3)

> Ejecutado en un solo batch (sin apply-progress previo). 26/26 tasks en
> `tasks.md` completadas, en el orden obligatorio del `design.md`. Sin
> commit ni push (regla de la sesión): el árbol de trabajo queda sin
> confirmar para revisión del usuario.

## Estado por task

### Phase 1 — Baseline (antes de tocar código)
- [x] 1.1 — API no estaba levantada en 9001 (`curl … 000`, `docker ps` solo
  mostraba Postgres). Se usó el fallback "vía 2" del design (`node -e` sobre
  `apps/api/rest/src/db/pickbazar/products.json`) para generar
  `$CH/mock-apples.json`. Resultado: 21 claves raíz, 20 `related_products`
  con 20 claves cada uno.
- [x] 1.2 — `just db-up`: el contenedor `safari-postgres` ya estaba
  `Up (healthy)`; se reaplicó `db/schema.sql` + `db/seed.sql` sin error
  (`* esquema y datos de referencia aplicados`).

### Phase 2 — `packages/db`: regla de relacionados (D-1/D-2/D-3)
- [x] 2.1 — `products.repository.ts:237-247`: `where` reducido a
  `{ typeId: row.typeId }`, con el comentario que cita D-1 (texto idéntico
  al del design).
- [x] 2.2 — `products.repository.ts:103`: comentario de
  `ProductDetail.relatedProducts` actualizado (ya no dice "excluyendo el
  propio").
- [x] 2.3 — `products.integration.test.ts:181-195`: se borró
  `expect(rel.id).not.toBe(sample.id)`; añadidas las aserciones de D-3
  (`toContain(sample.id)`, orden ascendente, `length<=20`, mismo
  `type.slug`); `it` renombrado a "…related del mismo type, INCLUYENDO el
  propio producto (D-1)". El `it` de slug inexistente (196-198 original) no
  se tocó.
- [x] 2.4 — Evidencia:

```
$ cd packages/db && npm run typecheck && npm test
> @safari/db@0.1.0 typecheck
> tsc --noEmit
(sin salida — 0 errores)

> @safari/db@0.1.0 test
> vitest run
 RUN  v4.1.11 C:/DevOps/MyGitHub/safari-marketplace/packages/db
 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  08:36:59
   Duration  6.50s
```

### Phase 3 — Rebuild obligatorio (bloqueante)
- [x] 3.1 — `just db-build`:

```
npm run build
> @safari/db@0.1.0 build
> prisma generate && tsup
✔ Generated Prisma Client (7.10.0) to .\generated\prisma\client in 740ms
CJS dist\index.js     92.89 KB
CJS dist\index.js.map 200.43 KB
CJS ⚡️ Build success in 284ms
DTS ⚡️ Build success in 8435ms
DTS dist\index.d.ts 941.07 KB
```

### Phase 4 — `apps/api/rest/src/products/products.service.ts`
- [x] 4.1 — Imports añadidos: `NotFoundException` (`@nestjs/common`);
  `findProductBySlug`, `type ProductDetail` (`@safari/db`).
- [x] 4.2 — `getProductBySlug` reescrito como `async` siguiendo literalmente
  la Decisión B del design: el `try` envuelve solo `await
  findProductBySlug(slug)` (503/500 vía `isPrismaConnectionError`/
  `getUserFriendlyMessage`, mismo patrón que `getProducts()`); el
  `NotFoundException` se lanza DESPUÉS del try/catch, fuera de él; el
  `return` usa `{ ...toProductDto(detail), related_products:
  detail.relatedProducts.map(toProductDto) } as unknown as Product`.
  `toProductDto()` no se tocó.

### Phase 5 — Tests jest (`products.service.spec.ts`)
- [x] 5.1 — `findProductBySlug: jest.fn()` añadido al factory
  `jest.mock('@safari/db', …)`.
- [x] 5.2 — `EXPECTED_DETAIL_KEYS = [...EXPECTED_KEYS, 'related_products']` +
  `makeProductDetail(overrides)` (envuelve `makeProductRecord()` con
  `relatedProducts: []` por defecto).
- [x] 5.3–5.9 — 7 tests nuevos en `describe('ProductsService.getProductBySlug
  (Postgres vía @safari/db, US-3)', …)`: 21 claves en orden; 20 claves por
  relacionado sin `related_products` propio; slug crudo pasado al
  repositorio; `relatedProducts: []` → `related_products: []`; 404 vía
  `NotFoundException` con el slug en el mensaje y `not.toBeInstanceOf(
  InternalServerErrorException)`; 503 por error de conexión; 500 por
  cualquier otro error (estos dos últimos, copia literal del patrón de
  `getProducts()`, sin CA propio — D-5).
- [x] 5.10 — Evidencia:

```
$ cd apps/api/rest && npx jest
PASS src/products/products.service.spec.ts (37.106 s)
  ProductsService.getProducts (Postgres vía @safari/db, US-2)
    ✓ 13 tests (los ya existentes, sin cambios de comportamiento)
  ProductsService.getProductBySlug (Postgres vía @safari/db, US-3)
    ✓ emite exactamente las 21 claves del detalle (20 del listado + related_products), en orden (1 ms)
    ✓ cada relacionado trae las 20 claves del listado y ningún related_products propio (1 ms)
    ✓ pasa el slug crudo al repositorio
    ✓ relatedProducts: [] → related_products: [] y sigue con las 21 claves (1 ms)
    ✓ slug inexistente (null) → NotFoundException 404 con el slug en el mensaje, no envuelto por el catch (D-5) (1 ms)
    ✓ error de conexión de Prisma → 503 con mensaje amigable
    ✓ cualquier otro error → 500 con mensaje amigable, sin crashear el proceso (1 ms)

Test Suites: 1 passed, 1 total
Tests:       20 passed, 20 total
```

### Phase 6 — Verificación E2E: CA-1, CA-2, CA-3
- [x] 6.1 — `just api-dev` levantado en background (PORT=9001, contra
  Postgres 5433). `just build-api` no se corrió aparte porque `api-dev`
  (watch mode, 0 errores de compilación) ya sirve el código actual.
- [x] 6.2 — CA-1:

```
$ curl -s "http://localhost:9001/api/products/apples" > $CH/pg-apples.json
$ node -e "…diff…"
raiz: 21 -> 21 | mismo orden: true
faltan: [] | sobran: []
related n: 20 | ids pg: 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20
             ids mock: 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20
items con shape malo: 0
claves de related[0]: ["id","name","slug","type","language","translated_languages",
  "product_type","shop","sale_price","max_price","min_price","image","status",
  "price","quantity","unit","sku","sold_quantity","in_flash_sale","visibility"]
```

- [x] 6.3 — CA-2:

```
$ curl -i -s http://localhost:9001/api/products/no-existe-xyz | head -1
HTTP/1.1 404 Not Found
$ curl -s http://localhost:9001/api/products/no-existe-xyz
{"statusCode":404,"message":"No existe un producto con slug `no-existe-xyz`.","error":"Not Found"}
$ curl -s -o /dev/null -w '%{http_code}\n' http://localhost:9001/api/types
200
```

- [x] 6.4 — CA-3:

```
$ node -e "const b=require('./$CH/pg-apples.json');console.log('self incluido:', b.related_products.some(r=>r.id===b.id));"
self incluido: true
```

### Phase 7 — Verificación E2E: CA-4 (shop)
- [x] 7.1 — `just shop-dev` levantado en background (puerto 3003, modo dev).
  Primer request a `/en/products/apples` disparó la compilación de la ruta
  `/products/[slug]` (89.5 s, 2467 módulos, log de Next.js: `✓ Compiled
  /products/[slug] in 89.5s`); esa primera petición se cortó por el timeout
  de la herramienta, pero no representa un fallo del endpoint — es el costo
  de compilación en frío de Next dev. Repetido después de la compilación:

```
$ curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3003/en/products/apples
200
$ curl -s http://localhost:3003/en/products/apples | grep -c 'Apples'
1
```

### Phase 8 — Cierre documental (DoD)
- [x] 8.1 — `3-detalle-producto-postgres.md`: `Status` → "Implementada"; los
  5 ítems de la Definición de Done marcados `[x]` con la evidencia de arriba
  (incluyendo la nota sobre `just db-check` — ver "Desviaciones" abajo).
- [x] 8.2 — `README.md` del épico: fila de US-3 → "✅ Implementada".

## Archivos modificados

| Archivo | Acción | Qué se hizo |
|---|---|---|
| `packages/db/src/repositories/products.repository.ts` | Modificado | `where` de relacionados reducido a `{ typeId }` + comentario D-1; comentario de `ProductDetail.relatedProducts` actualizado |
| `packages/db/src/repositories/products.integration.test.ts` | Modificado | Aserción de exclusión eliminada (D-3); nuevas aserciones de auto-inclusión, orden, límite y `type.slug`; `it` renombrado |
| `apps/api/rest/src/products/products.service.ts` | Modificado | Imports (`NotFoundException`, `findProductBySlug`, `ProductDetail`); `getProductBySlug` reescrito como `async` (Decisiones B y C del design) |
| `apps/api/rest/src/products/products.service.spec.ts` | Modificado | `findProductBySlug: jest.fn()` en el factory; `EXPECTED_DETAIL_KEYS`, `makeProductDetail()`; 7 tests nuevos |
| `docs/product/1-catalogo-desde-postgres/3-detalle-producto-postgres.md` | Modificado | `Status` → "Implementada"; DoD marcada con evidencia |
| `docs/product/1-catalogo-desde-postgres/README.md` | Modificado | Fila de US-3 → "✅ Implementada" |
| `openspec/changes/detalle-producto-postgres/mock-apples.json` | Creado | Línea base del mock (fallback vía 2, API no estaba levantada) |
| `openspec/changes/detalle-producto-postgres/pg-apples.json` | Creado (evidencia, no en la tabla del design) | Respuesta real de Postgres para `apples`, usada en el diff de CA-1 |
| `apps/api/rest/src/products/products.controller.ts` | Sin cambios | Ya era `async` / `Promise<Product>`, confirmado por lectura |

## Desviaciones del design

- **`just db-check` no se ejecutó tal cual.** Se usó el sustituto que
  `design.md`/`tasks.md` documentaban: `cd packages/db && npm run typecheck &&
  npm test`, con salida real pegada arriba (14/14 tests).
  **CORREGIDO EN VERIFY (H-1): el motivo alegado era falso.** No hay tal
  rojo reproducible — `just db-check` corre limpio (`14 passed (14)`,
  EXIT=0) porque `justfile:333` ya normaliza el cwd desde `083d8e9`. La
  premisa venía heredada de `exploration.md` y nadie la comprobó. El gate
  real se ejecutó después, en verify, y la DoD de la US ya cita su salida.
- **`just build-api` no se corrió como paso independiente.** Se usó `just
  api-dev` (watch mode) directamente, que compiló con 0 errores y sirvió el
  código actual; es funcionalmente equivalente para la evidencia de CA-1/
  CA-2/CA-3 y evita un ciclo build+start adicional. `tasks.md` 6.1 lo
  contempla como alternativa ("o reiniciar `just api-dev`").
- **`pg-apples.json` no estaba en la tabla "File Changes" del design.** Es
  evidencia pura (salida del `curl` de CA-1, no código de producción); se
  dejó en el directorio del change junto a `mock-apples.json` para que el
  diff sea reproducible por un humano sin volver a levantar la API.
- Ningún otro apartado del código se desvió del design: el `where`, el
  `try/catch`, el punto donde se lanza `NotFoundException`, y la forma del
  objeto de retorno coinciden literalmente con las Decisiones A/B/C.

## Lo que falta verificar por un humano

Todo lo pedido por `tasks.md` se ejecutó y quedó con evidencia real arriba.
No hay tasks bloqueadas. Para una segunda verificación independiente:

```bash
# Reproducir de cero (con los servidores ya detenidos):
just db-up
cd packages/db && npm run typecheck && npm test
just db-build
cd apps/api/rest && npx jest
just api-dev            # terminal 1
CH=openspec/changes/detalle-producto-postgres
curl -s "http://localhost:9001/api/products/apples" > $CH/pg-apples.json
node -e "const fs=require('fs'),d=p=>JSON.parse(fs.readFileSync(p,'utf8'));const a=d('$CH/mock-apples.json'),b=d('$CH/pg-apples.json');console.log(JSON.stringify(Object.keys(a))===JSON.stringify(Object.keys(b)));"
curl -i -s http://localhost:9001/api/products/no-existe-xyz
just shop-dev            # terminal 2
curl -s -w '\n%{http_code}\n' http://localhost:3003/en/products/apples | grep -c 'Apples'
```

Nota operativa: los servidores (`api-dev`, `shop-dev`) que usé para esta
verificación corrían en procesos en background de esta sesión de agente y
se terminan al cerrar la sesión — no quedan corriendo para el usuario.

## Bloque de estado

26/26 tasks completas. Listo para `sdd-verify`.
