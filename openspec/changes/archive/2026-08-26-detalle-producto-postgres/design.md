# Design: Detalle de producto y relacionados desde Postgres

> US-3, Épico 1. Insumos: `proposal.md` (D-1..D-6 **ratificadas**, no se
> reabren), `specs/product-detail-api/spec.md`, `exploration.md`.
> Precedente estructural: `openspec/changes/archive/2026-08-25-migrar-api-products-postgres/design.md`.
> Toda cita `path:line` está verificada abriendo el archivo.

## Technical Approach

Dos archivos de producción, un cambio cada uno:

1. `packages/db/src/repositories/products.repository.ts:237-247` — el `where`
   de la consulta de relacionados pierde tres condiciones (D-1/D-2). Sin
   parámetros nuevos, sin función nueva.
2. `apps/api/rest/src/products/products.service.ts:210-219` — el cuerpo
   síncrono sobre `productsJson` pasa a `async` sobre `findProductBySlug()`,
   con `NotFoundException` (D-4) y el mismo `try/catch` 503/500 de
   `getProducts()` (D-5).

`toProductDto()` (`products.service.ts:131-165`) **no se modifica**: proyecta
las mismas 20 claves para el raíz y para cada relacionado. No se crea
`products.mapper.ts` (D-6), ni DTO de error, ni `ExceptionFilter` (D-4). El
controller (`products.controller.ts:33-36`) ya es `async` y tipa
`Promise<Product>`: cero cambios. `productsJson` y `fuse` siguen importados
(los usan `getPopularProducts`/`getBestSellingProducts`).

## Architecture Decisions

### Decisión A: el `where` de relacionados, antes y después

`ProductDetail` (`products.repository.ts:102-105`) no cambia de forma, **pero
su comentario sí**: hoy dice *"excluyendo el propio"* (línea 103) y eso pasa a
ser falso. Actualizarlo es parte del cambio.

```ts
// ANTES (products.repository.ts:237-247)
where: {
  typeId: row.typeId,
  id: { not: row.id },              // ← se borra
  status: 'publish',                // ← se borra
  visibility: 'visibility_public',  // ← se borra
},
include: PRODUCT_INCLUDE, orderBy: { id: 'asc' }, take: relatedLimit,

// DESPUÉS — con el comentario obligatorio (mitigación de R-1)
const related = await prisma.product.findMany({
  // D-1 (US-3, ratificada): paridad byte a byte con el mock, que hacía
  // `products.filter(p => p.type.slug === product.type.slug).slice(0,20)`.
  // NO es un bug ni un olvido: el filtro por `status`/`visibility` y la
  // exclusión del propio producto (`id: { not: row.id }`) se ELIMINARON a
  // propósito. Ver openspec/specs/product-detail-api/spec.md antes de
  // "arreglarlo".
  where: { typeId: row.typeId },
  include: PRODUCT_INCLUDE,
  orderBy: { id: 'asc' },
  take: relatedLimit,
});
```

`relatedLimit = 20` (firma `products.repository.ts:227-230`) y
`orderBy: { id: 'asc' }` se conservan: ya reproducen el `.slice(0, 20)` sobre
un JSON en orden de id ascendente. La firma pública no cambia, así que el
barrel (`packages/db/index.ts:43,50`) tampoco.

**Alternativas descartadas** (cerradas en D-2, se listan para el lector
futuro): flag `{ excludeSelf, onlyPublic }` — configurabilidad especulativa
con un solo llamador; segunda función `findProductBySlugForDetail()` — deja
muerta la primera. `git grep findProductBySlug` (re-verificado hoy): solo
`packages/db/index.ts:50`, `products.repository.ts:227` y su test.

### Decisión B: el `NotFoundException` se lanza FUERA del `try` — no se re-lanza desde el `catch`

Es la parte más sutil del cambio. El `try` envuelve **exclusivamente** la
llamada de I/O; la traducción `null → 404` ocurre después, ya fuera:

```ts
async getProductBySlug(slug: string): Promise<Product> {
  let detail: ProductDetail | null;

  // El try envuelve SOLO la llamada al repositorio (mismo criterio que
  // getProducts(), líneas 194-207). El 404 de abajo queda fuera a
  // propósito: si se lanzara dentro, este catch lo convertiría en un 500.
  try {
    detail = await findProductBySlug(slug);
  } catch (error) {
    if (isPrismaConnectionError(error)) {
      throw new ServiceUnavailableException(getUserFriendlyMessage(error));
    }
    throw new InternalServerErrorException(getUserFriendlyMessage(error));
  }

  if (!detail) {
    throw new NotFoundException(`No existe un producto con slug \`${slug}\`.`);
  }

  return {
    ...toProductDto(detail),
    related_products: detail.relatedProducts.map(toProductDto),
  } as unknown as Product;
}
```

| Opción | Trade-off | Decisión |
|---|---|---|
| `throw` fuera del `try` (arriba) | El mapeo final también queda fuera: un fallo del mapper daría el 500 pelado de Nest en vez del mensaje amigable | **Elegida** |
| `throw` dentro + `if (error instanceof HttpException) throw error` en el `catch` | Funciona, pero añade una rama de "des-envolver lo que yo mismo lancé": la solución lista, no la obvia | Descartada |
| `try` que envuelve todo el método sin guarda | **Bug**: convierte el 404 en 500 y viola D-5 | Prohibida |

El riesgo residual de la opción elegida es nulo en la práctica:
`toProductDto()` es total sobre `ProductRecord` (solo lee campos ya
JSON-safe por `_id`/`_dec`, `packages/db/src/records.ts:34-46`).
`apps/api/rest/tsconfig.json` no activa `strict`, así que `let detail:
ProductDetail | null;` sin inicializar no genera fricción de tipos.

Imports a añadir en `products.service.ts:1-13`: `NotFoundException` de
`@nestjs/common`; `findProductBySlug` y `type ProductDetail` de `@safari/db`
(`isPrismaConnectionError`, `getUserFriendlyMessage`, `ServiceUnavailableException`,
`InternalServerErrorException` ya están importados).

### Decisión C: `related_products` es la clave 21 del raíz y solo del raíz

`toProductDto(detail)` proyecta las 20 claves y **descarta**
`relatedProducts` (no está en el literal de las líneas 132-164), así que el
spread no lo filtra por accidente: la única vía por la que aparece es la
línea explícita. Como el spread emite primero las 20 claves en su orden y
`related_products` se escribe después, queda en **posición 21**, exactamente
como el `{ ...product, related_products }` del mock
(`products.service.ts:215-218` previo).

Cada elemento de `related_products` sale de `toProductDto` sobre un
`ProductRecord` plano: **20 claves, sin `related_products` propio**, sin
recursión y sin riesgo de anidamiento infinito.

**Traducción camelCase→snake_case que el detalle añade sobre el listado:
ninguna, salvo `relatedProducts → related_products`.** Verificado contra el
mapper real: las 20 claves ya las traduce `toProductDto()` y el shape del
detalle del mock es idéntico al del listado (`exploration.md` §2). La entidad
ya declara el campo opcional (`entities/product.entity.ts:35`,
`related_products?: Product[]`), así que el `as unknown as Product` es el
mismo cast-precedente de `settings.service.ts:39` y `toProductDto`.

## Data Flow

    GET /api/products/apples?with=…&language=en   (query ignorada, igual que hoy)
        │
        ▼  ProductsController.getProductBySlug   (sin cambios, :33-36)
    ProductsService.getProductBySlug(slug)       ← pasa a async
        │
        ├── try ──→ findProductBySlug(slug)  @safari/db ──→ Prisma ──→ :5433
        │             · findUnique({ slug })                 → row | null
        │             · findMany({ typeId }) id asc, take 20 → related[]
        │           catch → 503 (conexión) | 500 (resto)
        │
        ├── detail === null ──→ NotFoundException (404)   ← fuera del try
        │
        ▼  { ...toProductDto(detail),                       20 claves
             related_products: relatedProducts.map(toProductDto) }  ← clave 21

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/db/src/repositories/products.repository.ts` | Modify | `where` de relacionados = `{ typeId }` + comentario que cita D-1 (líneas 237-247); comentario de `ProductDetail.relatedProducts` (línea 103) deja de decir "excluyendo el propio" |
| `packages/db/src/repositories/products.integration.test.ts` | Modify | `describe('findProductBySlug')` (181-199): aserciones de D-3 |
| `apps/api/rest/src/products/products.service.ts` | Modify | `getProductBySlug` async (210-219) + imports; resto del archivo intacto |
| `apps/api/rest/src/products/products.service.spec.ts` | Modify | `findProductBySlug: jest.fn()` en el factory del mock (33-39) + `describe('getProductBySlug')` nuevo |
| `apps/api/rest/src/products/products.controller.ts` | Sin cambios | ya `async` / `Promise<Product>` |
| `openspec/changes/detalle-producto-postgres/mock-apples.json` | Create | línea base del mock, capturada ANTES de tocar código (mitiga R-3/V-5) |
| `docs/product/1-catalogo-desde-postgres/3-detalle-producto-postgres.md` | Modify | campo **Status** |
| `docs/product/1-catalogo-desde-postgres/README.md` | Modify | fila de US-3 en la tabla |

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Integración (`packages/db`) | regla D-1 en la consulta real | reescritura de `products.integration.test.ts:181-195` |
| Unit (`apps/api/rest`, jest) | proyección 21/20, 404, 503/500 | `describe('getProductBySlug')` mockeando `findProductBySlug` |
| E2E manual | CA-1..CA-4 | `curl` + `node -e` (jq NO instalado) |

### Integración — D-3: la aserción de exclusión se ELIMINA, no se relaja

`products.integration.test.ts:192` (`expect(rel.id).not.toBe(sample.id)`) se
**borra**. Reemplazo dentro del mismo `it` (que pasa a titularse *"…related
del mismo type, INCLUYENDO el propio producto (D-1)"*):

```ts
const ids = detail?.relatedProducts.map((r) => r.id) ?? [];
expect(ids.length).toBeGreaterThan(0);
expect(ids.length).toBeLessThanOrEqual(20);
expect(ids).toContain(sample.id);                      // D-1: auto-inclusión
expect([...ids].sort((a, b) => a - b)).toEqual(ids);    // orden ascendente
for (const rel of detail?.relatedProducts ?? []) {
  expect(rel.type.slug).toBe(sample.type.slug);
}
```

`sample` es `(await listProducts({ limit: 1 })).items[0]` = id 1 (`apples`,
type `grocery`), que siempre cae entre los 20 primeros de su type: la
auto-inclusión es determinista, no depende del seed cambiando. El segundo
`it` (slug inexistente → `null`, líneas 196-198) **no se toca**.

### Unit jest — 7 tests nuevos, mismo estilo que los 13 existentes

Se reutiliza la infraestructura ya presente: `EXPECTED_KEYS`
(spec:96-117), `makeProductRecord()` (spec:122-200) y el patrón
`jest.mock('@safari/db', …jest.requireActual…)` (spec:33-39), al que se le
añade `findProductBySlug: jest.fn()` junto a `listProducts`. Se añaden
`const EXPECTED_DETAIL_KEYS = [...EXPECTED_KEYS, 'related_products'];` y un
`makeProductDetail(overrides)` que envuelve `makeProductRecord()` con
`relatedProducts`. Reutilizar `EXPECTED_KEYS` es la mitigación de R-2: si
alguien cambia la proyección del listado, revientan los tests de ambos
métodos en el mismo archivo.

| # | Test | Aserción central |
|---|---|---|
| 1 | 21 claves exactas, en orden, con `related_products` al final | `Object.keys(result)` → `EXPECTED_DETAIL_KEYS` |
| 2 | cada relacionado trae 20 claves y **ningún** `related_products` propio | `Object.keys(rel)` → `EXPECTED_KEYS`; `'related_products' in rel` → `false` |
| 3 | pasa el slug crudo al repositorio | `toHaveBeenCalledWith('apples')`, `toHaveBeenCalledTimes(1)` |
| 4 | `relatedProducts: []` → `related_products: []` y sigue con 21 claves | no lanza; array vacío |
| 5 | `null` → `NotFoundException` 404, mensaje español con el slug | `instanceof NotFoundException`, `getStatus() === 404`, y **`not.toBeInstanceOf(InternalServerErrorException)`** (D-5: no se lo traga el catch) |
| 6 | error de conexión → 503 | copia literal de spec:381-401 |
| 7 | otro error → 500 | copia literal de spec:403-417 |

## Verification Plan

~~Comandos ajustados a esta máquina: **`just db-check` es rojo reproducible**
(cwd con unidad en minúscula → vitest reporta "0 tests").~~
**CORREGIDO EN VERIFY (H-1): premisa falsa heredada de `exploration.md`.**
`just db-check` corre limpio (`14 passed (14)`, EXIT=0) — `justfile:333` ya
normaliza el cwd con `cd "$(pwd)"` desde `083d8e9`. Úsalo como gate oficial
de `packages/db`. Los runners por paquete siguen siendo útiles como inner
loop, y `cd apps/api/rest && npx jest` sigue siendo obligatorio porque no
existe receta `just` para el gate de la API.

```bash
# --- PASO 0: línea base del mock, ANTES de tocar una sola línea de código ---
CH=openspec/changes/detalle-producto-postgres
curl -s "http://localhost:9001/api/products/apples?language=en&searchJoin=and&with=categories;shop;type" > $CH/mock-apples.json
# Vía 2, sin servidor (reproducible siempre; usar si el paso de arriba se perdió):
node -e "const p=require('./apps/api/rest/src/db/pickbazar/products.json');const x=p.find(q=>q.slug==='apples');const r=p.filter(q=>q.type.slug===x.type.slug).slice(0,20);require('fs').writeFileSync('$CH/mock-apples.json',JSON.stringify({...x,related_products:r},null,2))"

# --- Gates por paquete (tras el cambio) ---
cd packages/db  && npm run typecheck && npm test    # requiere `just db-up`
cd apps/api/rest && npx jest                        # 13 tests previos + 7 nuevos

# --- CA-1: paridad de contrato, 21 claves raíz / 20 por relacionado ---
curl -s "http://localhost:9001/api/products/apples" > $CH/pg-apples.json
node -e "
const fs=require('fs'),d=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const a=d('$CH/mock-apples.json'), b=d('$CH/pg-apples.json');
const ka=Object.keys(a), kb=Object.keys(b);
console.log('raiz:', ka.length, '->', kb.length, '| mismo orden:', JSON.stringify(ka)===JSON.stringify(kb));
console.log('faltan:', ka.filter(k=>!kb.includes(k)), '| sobran:', kb.filter(k=>!ka.includes(k)));
const rel=b.related_products;
console.log('related n:', rel.length, '| ids pg:', rel.map(r=>r.id).join(','));
console.log('             ids mock:', a.related_products.map(r=>r.id).join(','));
console.log('items con shape malo:', rel.filter(r=>Object.keys(r).length!==20||'related_products' in r).length);
console.log('claves de related[0]:', JSON.stringify(Object.keys(rel[0])));
"
# Esperado: raiz 21->21 true; faltan [] sobran []; ids identicos 1..20; malo 0.
# Divergencia heredada del listado, NO regresion: in_flash_sale siempre 0.

# --- CA-2: 404 de dominio + proceso vivo ---
curl -i -s http://localhost:9001/api/products/no-existe-xyz | head -1
curl -s http://localhost:9001/api/products/no-existe-xyz    # {"statusCode":404,...,"error":"Not Found"}
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:9001/api/types   # 200

# --- CA-3: D-1 observable en la respuesta real ---
node -e "const b=require('./$CH/pg-apples.json');console.log('self incluido:', b.related_products.some(r=>r.id===b.id));"

# --- CA-4: la página del shop en 200 (ver nota de abajo) ---
just shop-dev   # en otra terminal, modo DEV
curl -s -w '\n%{http_code}\n' http://localhost:3003/en/products/apples | grep -c 'Apples'
```

**CA-4 — por qué en modo dev y no con build de producción.** La página usa
`getStaticProps` + `getStaticPaths` con `revalidate: 60`
(`apps/shop/src/framework/rest/product.ssr.ts:15-59`), es decir **ISR, no SSR
puro**. En un `just build` la página se prerenderiza en tiempo de build y una
API caída quedaría enmascarada por el HTML cacheado; además `fallback:
'blocking'` + `revalidate` puede servir una versión vieja. Con `just
shop-dev`, `getStaticProps` corre **en cada request**, así que el 200 prueba
de verdad que el shop habló con la API contra Postgres. El `notFound: true`
del `catch` (`product.ssr.ts:54-58`) es lo que se vería si la llamada
fallara: por eso la evidencia debe comprobar `200` **y** que el HTML contiene
`Apples`, no solo el código.

## Secuencia de trabajo (orden obligatorio)

1. **Capturar la línea base del mock** (`$CH/mock-apples.json`) con la API
   todavía en mock. Antes de cualquier edición.
2. `just db-up` (Postgres sembrado).
3. `packages/db`: `where` + los dos comentarios + test de integración.
4. `cd packages/db && npm run typecheck && npm test` (verde con las
   aserciones nuevas).
5. **`just db-build`** — obligatorio: `packages/db/dist/` está gitignored y
   Nest consume el paquete vía `link:`. **Sin este paso la API sigue
   ejecutando el `where` viejo** y la evidencia de CA-1/CA-3 sale mal sin
   motivo aparente. No hace falta re-`yarn install` en `apps/api/rest`: el
   symlink ya apunta a la carpeta reconstruida.
6. `apps/api/rest`: servicio + imports; luego los 7 tests jest.
7. `cd apps/api/rest && npx jest`.
8. `just build-api` (o reiniciar `just api-dev`) y ejecutar CA-1 → CA-3.
9. `just shop-dev` y ejecutar CA-4.
10. Cierre documental (Status de la US + fila del épico).

## Migration / Rollout

Sin migración de datos, sin feature flag, sin cambio de esquema. Rollback:
`git revert` del commit + `just db-build && just build-api`. Rollback parcial
de la regla de relacionados: reponer las tres condiciones del `where` sin
tocar Nest.

## Open Questions

Ninguna. D-1..D-6 están ratificadas en `proposal.md` y este documento solo
las traduce a código.
