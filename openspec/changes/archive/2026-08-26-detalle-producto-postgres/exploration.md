# Exploration: Detalle de producto y relacionados desde Postgres (US-3, Épico 1)

> Fuente: `docs/product/1-catalogo-desde-postgres/3-detalle-producto-postgres.md`
> + `docs/product/1-catalogo-desde-postgres/README.md`. Precedente estudiado en
> profundidad: `openspec/changes/archive/2026-08-25-migrar-api-products-postgres/`
> (US-2) y `openspec/specs/product-listing-api/spec.md`. Toda afirmación
> concreta de este documento fue verificada abriendo el archivo citado o
> ejecutando un comando de solo lectura (`node -e`, `grep`, `git log`) — no se
> arrancó ningún servidor ni se tocó `just db-up`.

## Current State

### 1. El contrato HTTP real (verificado en código, no en la US)

**Un único endpoint sirve detalle + relacionados.** No hay endpoint separado
para "relacionados": `GET /api/products/:slug` devuelve el producto con
`related_products` como campo embebido.

- Controlador: `ProductsController.getProductBySlug` — `@Get(':slug')` →
  `apps/api/rest/src/products/products.controller.ts:33-36`.
- Servicio (mock, hoy): `apps/api/rest/src/products/products.service.ts:210-219`:
  ```ts
  getProductBySlug(slug: string): Product {
    const product = this.products.find((p) => p.slug === slug);
    const related_products = this.products
      .filter((p) => p.type.slug === product.type.slug)
      .slice(0, 20);
    return { ...product, related_products };
  }
  ```
  Es **síncrono** (no hay `async`/`try-catch`) y **no maneja slug inexistente**:
  si `product` es `undefined`, `product.type.slug` lanza `TypeError` sin
  capturar → Nest lo convierte en 500 crudo, no en 404 controlado. Este es
  exactamente el hueco que CA-2 pide cerrar.
- Cliente REST de la tienda (confirmado, no inferido):
  `apps/shop/src/framework/rest/client/index.ts:158-163`:
  ```ts
  get: ({ slug, language }: GetParams) =>
    HttpClient.get<Product>(`${API_ENDPOINTS.PRODUCTS}/${slug}`, {
      language, searchJoin: 'and',
      with: 'categories;shop;type;variations;variations.attribute.values;variation_options;tags',
    }),
  ```
  Se consume desde `useProduct()` (`apps/shop/src/framework/rest/product.ts:118-130`)
  y desde `getStaticProps` en `apps/shop/src/framework/rest/product.ssr.ts:31-59`
  (con `try/catch` → `notFound: true` si el cliente lanza; el shop YA maneja el
  404 del lado cliente, pero solo si la API responde 404 real — hoy con el mock
  un slug inexistente no da 404, da 500, y el `catch` de `getStaticProps` lo
  absorbe igual porque solo mira que la promesa rechace).
  `related_products` se lee del mismo objeto de respuesta, nunca de una llamada
  aparte: `apps/shop/src/pages/products/[slug].tsx:65-68`,
  `apps/shop/src/components/products/details/popup.tsx:22,38-41`,
  `apps/shop/src/types/index.ts:266` (`related_products: Product[]`).
  El `with=...` que manda el cliente **no se lee en ningún lado** del lado
  servidor (ni el controller ni el service lo consultan) — sobrevive porque
  `ValidationPipe` corre sin `whitelist` (mismo hallazgo que dejó documentado
  el design de US-2 para `with=type;author` en el listado).

### 2. El shape real del mock — mucho más simple de lo que sugiere la US

La US pide "inventariar con curl" el shape porque asume objetos embebidos
ricos (`categories`, `tags`, `gallery`, `variations`, `author`,
`manufacturer`…). **Verificado por lectura directa del JSON fuente, no hace
falta curl**: el shape real es idéntico al que ya migró US-2 para el listado.

```
$ node -e "... union de keys de las 1200 filas de products.json ..."
id, name, slug, type, language, translated_languages, product_type, shop,
sale_price, max_price, min_price, image, status, price, quantity, unit, sku,
sold_quantity, in_flash_sale, visibility
```

Esas son las **20 claves**, exactas, en las 1200 filas — el archivo NUNCA tuvo
`categories`, `tags`, `gallery`, `description`, `variations`,
`variation_options`, `author`, `manufacturer`, pese a que
`apps/api/rest/src/products/entities/product.entity.ts:21-58` los declara
todos. `getProductBySlug` hace `{ ...product, related_products }`: el
resultado real, simulado con la misma lógica del service, tiene **21 claves**
(las 20 + `related_products`) — confirmado además por el `verify-report.md`
de US-2 (§9, "regresión"): `200 19722B /api/products/apples → objeto, 21
claves, name=Apples`. Cada elemento de `related_products` tiene, a su vez, las
mismas 20 claves (es `toProductDto`-shaped, no un objeto reducido).

**Consecuencia para el diseño**: `toProductDto()`, la función privada que
US-2 ya escribió en `products.service.ts:131-165` para el listado, alcanza
**sin modificar su forma** para proyectar tanto el producto principal como
cada item de `related_products` — contradice la Decision C del design de
US-2 solo en el detalle: ese documento decía *"`toProductDto` queda
exportable en US-3 sin mover nada"* pero también su propio Riesgo #3 dice
*"toProductDto tal como está no sirve para el detalle sin ampliarlo"*. La
ampliación real medida es mínima: añadir una clave más
(`related_products: record.relatedProducts.map(toProductDto)`), no cambiar
la proyección de 20 claves.

### 3. La regla de "relacionados" del mock — con una trampa no documentada

El contexto de la US dice "documentar la regla de relación (p. ej. mismo
type) en el design", dando a entender que basta con "mismo type, límite N".
**Verificado con simulación exacta del código del mock**: la regla real tiene
dos propiedades adicionales que **no están en `db/schema.sql` ni en el
repositorio actual**:

1. **No excluye el producto consultado.** `this.products.filter(...)` nunca
   quita `product` del resultado. Si el producto consultado cae dentro de los
   primeros 20 de su `type` (por orden del JSON = id ascendente), aparece en
   su propia lista de relacionados.
2. **No filtra por `status`/`visibility`.** Es un slice ciego de los primeros
   20 elementos del type, sin importar si son `draft` o `visibility_private`.
3. **Es determinista por type, no por producto.** Al ser siempre
   "los primeros 20 del type en orden del array", **todos los productos de un
   mismo type devuelven exactamente el mismo array de relacionados**.

Verificado con dos anclas distintas del type `grocery` (436 productos):

```
$ node -e "..."
related para 'apples' (id 1):      [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]
related para 'clementines' (id 6): [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]
¿idénticos?                         true
¿'clementines' se incluye a sí mismo? true
```

**Comparado con lo que YA implementa `packages/db`** (ver §4): la función
`findProductBySlug()` existente hace `id: { not: row.id }` (excluye el
propio producto) y filtra `status: 'publish', visibility: 'visibility_public'`
— ambas reglas están **más cerca de lo "correcto"** que el mock, pero
**divergen del mock** en exactamente los dos ejes de arriba. Con el seed
actual (1200 filas, 1 sola fila `draft` — id 454 — y ninguna
`visibility_private`), el filtro de status solo se nota si algún type-6
"related" cae exactamente en el rango de los primeros 20 productos de ese
type que incluyan el id 454; medido: **no lo hace** (454 no está entre las
primeras 20 filas de type 6 por orden de id). Es decir: con el seed actual el
filtro de status es invisible en la evidencia, pero la exclusión del propio
producto (regla #1) **sí es observable siempre** que el slug consultado esté
entre los primeros 20 de su type — y eso pasa para cualquiera de los
primeros N productos "ancla" de cada type. Este es el punto de decisión más
concreto que debe resolver `design.md`: ¿replicar el mock byte a byte
(incluir el self, no filtrar status) o aceptar y documentar la divergencia
(patrón ya usado en US-2 para `shop_id`/`min_price`)?

## Affected Areas

- `apps/api/rest/src/products/products.controller.ts` — sin cambios
  esperados (ya es `async`, ya tipa `Promise<Product>`, el precedente de US-2
  dejó el controller intacto).
- `apps/api/rest/src/products/products.service.ts` — único archivo de
  producción a tocar. `getProductBySlug` pasa a `async`, consume
  `findProductBySlug()` de `@safari/db`, traduce `null` → `NotFoundException`,
  reutiliza/amplía `toProductDto()`.
- `apps/api/rest/src/products/products.service.spec.ts` — **YA EXISTE** (no
  mencionado en el prompt de esta exploración ni en `CLAUDE.md`, ver
  Hallazgo de documentación abajo). Es jest, mockea `@safari/db`, y cubre
  `getProducts()` de US-2 con 15 tests. US-3 puede — y, dado que el propio
  `verify-report.md` de US-2 señaló "cero cobertura del código nuevo" como
  riesgo arrastrado (V-4/Riesgo #1), probablemente debería — añadir un
  `describe('getProductBySlug', …)` al mismo archivo, mockeando
  `findProductBySlug` en vez de `listProducts`.
- `packages/db/src/repositories/products.repository.ts` — **posiblemente sin
  cambios** (ver Hallazgo mayor abajo): `findProductBySlug()` y el tipo
  `ProductDetail` **ya existen**, desde el commit inicial de `packages/db`
  (`1af514a`, anterior a US-2). Cambia solo si el design decide replicar la
  regla de relacionados del mock byte a byte (self incluido, sin filtro de
  status) — en ese caso sí hay que tocar la función y sus tests.
- `packages/db/src/repositories/products.integration.test.ts` — ya tiene un
  `describe('findProductBySlug', …)` con 2 tests (detalle feliz + slug
  inexistente → `null`). Si el design cambia la regla de relacionados, estos
  tests hay que actualizarlos; si no, quedan intactos.
- `docs/product/1-catalogo-desde-postgres/3-detalle-producto-postgres.md` y
  `README.md` del épico — cierre documental (Status + fila de la tabla),
  igual que hizo US-2.
- `apps/shop/**` — **fuera de alcance** (explícito en el "NO incluye" de la
  US). Ya validé que el shop no necesita cambios de código para consumir el
  endpoint migrado: `useProduct()`/`getStaticProps` ya leen `related_products`
  del mismo payload.

## Datos disponibles en Postgres — inventario clave por clave

`db/schema.sql` (products, types, shops, manufacturers, categories, tags,
category_product, product_tag) + `packages/db/prisma/schema.prisma` (modelo
`Product` con relaciones `type`, `shop`, `manufacturer`, `categories`
(`CategoryProduct[]`), `tags` (`ProductTag[]`)) respaldan **todas** las 20
claves que el mock realmente emite. No hay gap: como el mock nunca pobló
`categories`/`tags`/`gallery`/`description`/`variations` en la práctica, no
hace falta decidir "constante vs. derivado vs. omitir" para ellos — igual que
en US-2, simplemente no se proyectan.

| Clave del mock | Respaldo en Postgres | Nota |
|---|---|---|
| `id..visibility` (19 de las 20) | `products` + `types`/`shops` embebidos | Idéntico a `toProductDto()` de US-2, `products.service.ts:131-165` |
| `in_flash_sale` | Sin columna | Constante `0`, igual que el listado (divergencia #1 ya ratificada en `openspec/specs/product-listing-api/spec.md`) |
| `related_products` | `findProductBySlug()` ya resuelve la consulta | Ver §3 de "Current State" para la divergencia de regla |

`category_product` y `product_tag` siguen vacíos por diseño del seed
(`db/README.md`) — irrelevante aquí porque el mock nunca emitió `categories`/
`tags` en el detalle tampoco.

## Capa de repositorio — lo que ya existe vs. lo que falta (hallazgo mayor)

**`findProductBySlug(slug, relatedLimit = 20)` y el tipo `ProductDetail` ya
existen en `packages/db/src/repositories/products.repository.ts:227-253`**,
exportados desde el barrel (`packages/db/index.ts:41-56`), con test de
integración ya escrito
(`packages/db/src/repositories/products.integration.test.ts:181-199`). Esto
**no** es trabajo de US-2 ni preparación anticipada de este change: pertenece
al commit fundacional `1af514a "Añade la capa de datos en packages/db"`
(anterior a la migración del listado). La tabla "Archivos a crear/modificar"
de la US-3 original está desactualizada en este punto — declara
`packages/db/src/repositories/products.repository.ts` como archivo a
crear/modificar, cuando en realidad **ya está implementado y testeado**, salvo
que el design decida cambiar la regla de relacionados (§3).

```ts
export async function findProductBySlug(
  slug: string, relatedLimit = 20
): Promise<ProductDetail | null> {
  const row = await prisma.product.findUnique({ where: { slug }, include: PRODUCT_INCLUDE });
  if (!row) return null;
  const related = await prisma.product.findMany({
    where: { typeId: row.typeId, id: { not: row.id }, status: 'publish', visibility: 'visibility_public' },
    include: PRODUCT_INCLUDE, orderBy: { id: 'asc' }, take: relatedLimit,
  });
  return { ..._toProductRecord(row), relatedProducts: related.map(_toProductRecord) };
}
```

Es **two-query** (un `findUnique` + un `findMany` separado), no un único
`include` anidado — Prisma no puede expresar "productos del mismo type,
excluyendo el propio" como relación declarada (no existe FK de producto a
producto), así que un enfoque "una sola consulta con include anidado" no es
viable sin SQL crudo. La comparación de enfoques real no está en el
repositorio (ya resuelto ahí) sino en la capa de Nest: ver "Approaches"
abajo.

Lo que **sí falta**, íntegramente en `apps/api/rest/src/products/`:

1. Reemplazar el cuerpo síncrono de `getProductBySlug` por una llamada
   `async` a `findProductBySlug(slug)`.
2. Traducir `null` → `NotFoundException` (CA-2) — patrón que **no existe
   todavía en ningún servicio de la API** (ver siguiente sección).
3. Mapear `ProductDetail` (camelCase) → shape de 21 claves snake_case,
   reutilizando/ampliando `toProductDto()`.
4. Decidir y, si aplica, implementar la regla de relacionados exacta (§3).

## BigInt / Decimal → JSON — precedente exacto

Ya resuelto **en la capa de datos, no en Nest**, y confirmado en dos sitios:

- `packages/db/src/records.ts:34-46` — `_id()` convierte `bigint → number`,
  `_dec()` convierte `Prisma.Decimal → number`, ambos usados por
  `_toProductRecord()` (`products.repository.ts:416-461`) antes de que el
  record salga del paquete. El comentario de cabecera de `records.ts:1-18` lo
  explicita: *"Los repositorios NUNCA devuelven filas crudas de Prisma:
  devuelven estos records, que son JSON-safe por construcción"*.
- El test de integración de US-2 lo verifica en runtime:
  `products.integration.test.ts:44`: `expect(() => JSON.stringify(items)).not.toThrow();`.

**Consecuencia para US-3**: `findProductBySlug()` devuelve un `ProductDetail`
ya JSON-safe (incluidos los `ProductRecord[]` de `relatedProducts`); no hace
falta ningún manejo adicional de BigInt/Decimal en `products.service.ts` —
el mismo patrón que ya usa `toProductDto()` para el listado.

## 404 de dominio — hueco genuino, sin precedente en el repo

Verificado con `grep -rln "NotFoundException" apps/api/rest/src` → **cero
resultados**. Ni `settings.service.ts` (el precedente de migración a
Postgres) ni ningún otro servicio migrado traduce hoy un `null`/ausencia a
404 HTTP. `settings.service.ts:24-31` sí tiene un precedente de "traducir una
ausencia a una excepción", pero lo hace con `InternalServerErrorException`
(500) porque para settings la ausencia es un error de operación (base sin
sembrar), no un 404 de dominio legítimo — no es el patrón a copiar aquí.

`findProductBySlug()` ya devuelve `null` limpiamente para slug inexistente
(contrato ya probado:
`products.integration.test.ts:196-198`, `expect(await
findProductBySlug('no-existe-ni-existira')).toBeNull()`). El trabajo de
US-3 es, por primera vez en este repo, escribir el `if (!detail) throw new
NotFoundException(...)` en el servicio de Nest — sin ExceptionFilter global
(mismo Decision D de US-2: alcance local, no tocar el manejo de errores de
los ~40 endpoints que siguen en mock).

## Estrategia de captura de evidencia (Definición de Done)

El precedente de US-2 dejó un riesgo explícito arrastrado (Riesgo/Hallazgo
V-5 del `verify-report.md`): *"`mock.json`, la línea base del antes, no
quedó versionada ni archivada. Es irrepetible sin revertir el servicio. Para
US-3/US-4: guardar la captura del mock dentro de
`openspec/changes/{change}/` antes de tocar código, o derivar la línea base
del JSON fuente."* Dos rutas viables, no mutuamente excluyentes:

1. **Capturar el mock en vivo, antes de tocar código**: con la API corriendo
   contra el mock (estado actual del repo), `curl -s
   "http://localhost:9001/api/products/apples?with=..." > openspec/changes/detalle-producto-postgres/mock-apples.json`
   y commitear ese archivo (o guardarlo fuera de git, a discreción de la fase
   apply) antes del primer cambio de código.
2. **Derivar la línea base del JSON fuente** (lo que hizo verify de US-2 con
   éxito cuando el artefacto capturado se perdió): simular
   `getProductBySlug('apples')` sobre `apps/api/rest/src/db/pickbazar/products.json`
   con `node -e`, exactamente como se hizo en esta exploración — reproducible
   por cualquiera, no depende de un servidor vivo.

Ambas rutas evitan `jq` (no instalado en este Git Bash, per memoria de
usuario): los diffs de JSON deben hacerse con `node -e` (comparar `Object.keys`,
recorrer y listar diffs campo a campo), tal como hizo el `verify-report.md`
de US-2 en su nota de cierre ("Sustitución de herramienta declarada... con la
misma semántica que `jq -S`").

## Approaches

### 1. Reutilizar `findProductBySlug()` tal cual (recomendado)

`ProductsService.getProductBySlug` llama directo a
`findProductBySlug(slug)` de `@safari/db`, traduce `null → NotFoundException`,
mapea con `toProductDto()` ampliado (+`related_products`).

- **Pros**: repositorio y su test de integración ya existen y pasan; cero
  cambios en `packages/db`; sigue D-1 (cero Prisma en la API) y el patrón de
  US-2 de reutilizar `toProductDto()`; menor superficie de diff (~alcanza el
  LOC estimado de la US, ~200).
  Puede acompañarse de la migración de `relatedLimit` como parámetro fijo o
  configurable — hoy el default `20` ya coincide con el `.slice(0,20)` del
  mock.
- **Contras**: hereda la divergencia de regla de relacionados (self excluido,
  status filtrado) frente al mock (§3) — si el proposal exige paridad byte a
  byte con la evidencia del mock, esta opción NO la da gratis.
- **Effort**: Bajo.

### 2. Ajustar `findProductBySlug()` para replicar la regla del mock exacta

Cambiar la consulta de relacionados para NO excluir el propio producto y NO
filtrar `status`/`visibility` (o exponer ambos comportamientos vía parámetro),
y actualizar los 2 tests de integración existentes que hoy afirman lo
contrario (`products.integration.test.ts:190-193`:
`expect(rel.id).not.toBe(sample.id)`).

- **Pros**: paridad de comportamiento real con el mock, no solo de shape —
  cierra el hueco de CA-3 ("misma regla de relación que use el mock") de
  forma literal.
- **Contras**: toca un archivo que US-2 dejó explícitamente "sin cambios" y
  que hoy tiene comportamiento "más correcto" que el mock (excluir el propio
  producto, no mostrar borradores); reproducir fielmente un bug/simplificación
  del mock (mostrarse a sí mismo como "relacionado") es cuestionable como
  requisito de producto, aunque sea literal como requisito de contrato;
  amplía el diff más allá de `apps/api/rest`.
- **Effort**: Medio (repo + 2 tests + service).

### 3. Aceptar y documentar la divergencia (sin tocar el repositorio)

Igual que la Opción 1 en código, pero el proposal/spec declara explícitamente
la divergencia de la regla de relacionados como "ratificada, no defecto" —
mismo patrón que US-2 usó para `shop_id`+filtro y `min_price`/`max_price`
(`openspec/specs/product-listing-api/spec.md:71-79`).

- **Pros**: mismo código que la Opción 1, pero con la divergencia declarada
  en vez de omitida — evita que se lea como un bug no reportado en el
  `verify-report.md` de esta US.
  compatible con reutilizar el trabajo ya hecho en `packages/db`.
- **Contras**: ninguno técnico; es una decisión editorial/de producto que le
  toca al `proposal.md`, no a esta exploración.
- **Effort**: Bajo (igual que Opción 1, más el texto de la divergencia en el
  spec).

**No existe un fork real "una consulta con include anidado vs. dos
consultas" a nivel de repositorio** — Prisma no puede expresar la relación
"mismo type, excluyendo el propio producto" como include anidado sin SQL
crudo, así que el two-query de `findProductBySlug()` es, de facto, la única
implementación práctica sin introducir raw SQL (fuera de alcance de esta US).

## Recommendation

Opción 1 o 3 (son la misma implementación; difieren solo en si el
proposal/spec documenta la divergencia de la regla de relacionados o la deja
implícita). Recomiendo **Opción 3**: reutilizar `findProductBySlug()` sin
tocarlo, y que el `proposal.md`/`spec.md` declaren explícitamente la
divergencia de §3 (self incluido/excluido, filtro de status) como
"ratificada", igual que hizo US-2 con sus 10 divergencias — evita que
`verify` la descubra como hallazgo no documentado, que fue precisamente el
patrón de riesgo que dejó V-2/V-6 en el `verify-report.md` de US-2. Dejo la
decisión final (Opción 1 vs. 2 vs. 3) al `proposal.md`, tal como pide el
contrato de esta fase.

## Risks

- **La regla de relacionados del mock no es "mismo type, límite 20" a
  secas**: incluye al propio producto y no filtra status/visibility. Si el
  design/spec asumen la lectura ingenua de la US ("documentar la regla de
  relación — p. ej. mismo type"), CA-3 puede darse por cumplido con una
  implementación que en realidad diverge del mock sin que quede declarado.
  Ver §3 y Approaches.
- **`toProductDto()` se reutiliza sin red de seguridad de tipos**: es una
  función privada de `products.service.ts`, no exportada; extenderla para el
  detalle es directo, pero cualquier cambio futuro en el listado (US-2) la
  puede romper en silencio para el detalle también — riesgo ya señalado por
  el propio `verify-report.md` de US-2 (V-4/Riesgo #1) como algo que "US-3 va
  a heredar".
- **CLAUDE.md está desactualizado en un punto concreto**: dice *"`apps/api/rest`
  declara jest en su `package.json` pero no tiene ningún `*.spec.ts`"*. Eso
  ya no es cierto — `apps/api/rest/src/products/products.service.spec.ts`
  existe, con 15 tests jest, añadido en el commit `4158798` ("Cubre con tests
  el listado de productos de la API"), posterior a la redacción de esa
  sección de `CLAUDE.md`. Para el design/tasks de esta US conviene tratar
  `apps/api/rest && npx jest` (o `yarn test`) como un gate real adicional
  disponible, no inexistente. Recomiendo señalar esta discrepancia
  documental al usuario en vez de asumir el texto de `CLAUDE.md` al pie de la
  letra (regla de "el código gana sobre la memoria").
- ~~**`just db-check` es reproduciblemente rojo vía `just` en esta máquina**
  (V-1 del `verify-report.md` de US-2, causa: cwd en minúscula...).~~
  **CORREGIDO EN VERIFY (H-1): esta afirmación era FALSA y se propagó desde
  aquí a `proposal.md`, `design.md`, `tasks.md`, `apply-progress.md` y la DoD
  de la US.** `just db-check` corre limpio (`14 passed (14)`, EXIT=0): la
  receta ya normaliza el cwd con `cd "$(pwd)"` desde el commit `083d8e9`
  (`justfile:333`), que era HEAD cuando se escribió esta exploración. La
  memoria de usuario ya lo decía; no se verificó contra el justfile actual.
  Lección: el código gana sobre la recolección de contexto, también cuando lo
  que se hereda es el reporte de otra US.
- **La captura "antes" del mock no sobrevivió el proceso de US-2** (V-5). Si
  esta US no la fija al inicio (ver "Estrategia de captura de evidencia"),
  el `verify-report.md` de esta US tendrá que reconstruirla desde el JSON
  fuente igual que hizo US-2 — es viable, pero conviene decidirlo antes.
- **El servicio hoy es 100% síncrono y no captura errores**: convertirlo a
  `async` con `try/catch` (para el mismo patrón 503/500 de CA-5 de US-2,
  aunque US-3 no lo pida explícitamente en sus CA) es coherente con D-1/D-2 y
  con lo que ya hace `getProducts()` en el mismo archivo — vale la pena que
  el design decida si CA-5-like error handling aplica también al detalle (la
  US no lo pide como CA, pero dejar el detalle sin manejo de conexión caída
  sería una regresión de robustez frente al listado ya migrado).

## Ready for Proposal

**Sí.** El terreno está más despejado de lo que sugiere el texto de la US: la
capa de repositorio (`findProductBySlug`, tipos, tests de integración) ya
existe y pasa; el shape del mock es el mismo de 20 claves que ya migró US-2
más `related_products`; el patrón BigInt/Decimal ya está resuelto en
`packages/db`. El único punto que el `proposal.md` debe resolver
explícitamente antes de spec/design es la decisión de la regla de
relacionados (§3 / Approaches) — todo lo demás es aplicar, con variaciones
menores, el mismo patrón que US-2 ya validó y verificó.
