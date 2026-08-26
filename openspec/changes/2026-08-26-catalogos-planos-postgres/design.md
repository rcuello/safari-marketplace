# Design: Catálogos planos (`types`, `tags`, `manufacturers`, `shops`) desde Postgres

> **US-4a**, Épico 1. Insumos: `proposal.md` (D-1…D-10 y V-1…V-16 **ratificadas**,
> no se reabren), `../2026-08-26-catalogos-apoyo-postgres/exploration.md`.
> Precedentes estructurales: `../archive/2026-08-25-migrar-api-products-postgres/design.md`
> (US-2) y `../archive/2026-08-26-detalle-producto-postgres/design.md` (US-3).
> **Toda cita `path:line` y todo dato numérico de este documento está verificado
> abriendo el archivo o ejecutando `node -e` sobre los JSON del mock.**
> `categories` NO se toca (US-4b, `../2026-08-26-categorias-arbol-postgres/`).

## Technical Approach

Cuatro servicios de Nest pasan de filtrar JSON con `fuse.js` a llamar
`@safari/db` y proyectar el key-set exacto del mock:

| Servicio | Métodos que migran | Métodos que NO se tocan |
|---|---|---|
| `types.service.ts:22,51` | `getTypes`, `getTypeBySlug` | `create`, `findAll`, `findOne`, `update`, `remove` |
| `tags.service.ts:30,61` | `findAll`, `findOne` | `create`, `update`, `remove` |
| `manufacturers.service.ts:32,59,65` | `getManufactures`, `getTopManufactures`, `getManufacturesBySlug` | `create`, `update`, `remove` |
| `shops.service.ts:30,97` | `getShops`, `getShop` | `getNewShops`, `getStaffs`, `getNearByShop`, `approve*`, `disapproveShop`, `update`, `remove`, `create` |

Consecuencia vinculante: los imports de mock (`typesJson`, `tagsJson`,
`manufacturersJson`, `shopsJson`, `nearShopJson`, `plainToClass`, `Fuse`) y las
constantes de módulo **permanecen** en los cuatro archivos — los siguen usando
los métodos de la columna derecha. Ningún controller cambia (Nest resuelve
promesas; `tags.controller.ts:26`, `manufacturers.controller.ts:31,38,63` y
`shops.controller.ts:28,33` ya son `async`, y `types.controller.ts:26,31` no
tipa el retorno).

En `packages/db`: un input nuevo (`ListTypesInput`), un campo opcional en tres
inputs existentes (`name?`), el `orderBy` de dos repositorios, `_count`
filtrado en `shops`, `ShopRecord.productsCount?` y un export en el barrel.
**Cero cambios de esquema, de Prisma schema y de frontend.**

## Architecture Decisions

### Decisión A — `parse-search.ts`: un helper plano, no un parser tipado por catálogo

**Elección**: `apps/api/rest/src/common/search/parse-search.ts`, un único
export.

```ts
/**
 * `search=key:value;key:value` → mapa plano de tokens.
 *
 * Trocea igual que el mock (`split(';')`, luego el primer `:`); no "mejora"
 * el parseo. Cada servicio decide qué claves entiende: lo que no reconoce
 * se ignora sin error, igual que hoy. Última repetición de una clave gana,
 * que es lo que hacía el mock de shops/manufacturers (reasignaba `data`
 * dentro del bucle: `shops.service.ts:38-43`, `manufacturers.service.ts:44-49`).
 */
export function parseSearch(search?: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  if (!search) return tokens;
  for (const token of search.split(';')) {
    const [key, value] = token.split(':');
    if (key && value !== undefined) tokens[key] = value;
  }
  return tokens;
}
```

| Opción | Trade-off | Decisión |
|---|---|---|
| `Record<string,string>` + `switch` por servicio (arriba) | El servicio repite 3-6 líneas de mapeo | **Elegida**: 14 líneas, sin tipo genérico, sin acoplar el helper a 4 inputs distintos de `@safari/db` |
| Un `parse*Search()` tipado por catálogo dentro del helper | El helper importaría `ListTagsInput`/`ListShopsInput`/… → `common/` pasa a depender de la capa de datos | Descartada |
| Copiar el bucle en los 4 servicios | 5.ª y 8.ª ocurrencia del mismo troceo | Descartada (D-7) |

`products.service.ts:73-124` (`parseProductSearch`) **no se retrofitea** (D-7,
fuera de alcance): la duplicación temporal es consciente y va declarada en el
spec. Introducido en **PR #1** (lo consume `types` desde el primer slice).

**Claves que cada servicio reconoce** (el resto se ignora):

| Endpoint | Reconoce | Ignora (declarado) |
|---|---|---|
| `/types` | `name` | `slug`, `orderBy`, `language`, y el query param `text` (V-19) |
| `/tags` | `name`, `type.slug` | `slug`, `hasType`, `language` |
| `/manufacturers` | `name`, `type.slug` | `shop_id` (no hay relación shop↔manufacturer), `is_approved` |
| `/top-manufacturers` | — (solo `limit`) | `type.slug`, que el shop SÍ manda (V-20) |
| `/shops` | `name` | `is_active` (V-15), `type.slug` (la tabla `shops` no tiene type; la key de `fuse` en `shops.service.ts:16` ya era muerta: ninguna fila de `shops.json` trae `type`) |

Emisores verificados: admin `data/client/{type,tag,manufacturer,shop}.ts:8-24`
(`formatSearchParams({name})`, `http-client.ts:99-118`) y shop
`framework/rest/client/index.ts:230-236,244-251,304-319`.

### Decisión B — mappers privados por servicio, con el key-set literal del mock

**Elección**: una función a nivel de módulo por servicio (`toTypeDto`,
`toTagDto`, `toManufacturerDto`, `toShopDto`), literal explícito, `as unknown as
{Entity}` **en el `return` del mapper** (no en el call-site), copiando
`toProductDto` (`products.service.ts:134-168`) y `settings.service.ts:39`.
El cast es obligatorio porque las entidades declaran campos que el mock no
emite (`Shop.staffs/balance/distance/lat/lng`, `shop.entity.ts:10-24`;
`Type.image`, `type.entity.ts:7`; `Tag.parent/products`, `tag.entity.ts:9,14`;
`Manufacturer.type_id`, `manufacturer.entity.ts:16`).

**Alternativa descartada**: `packages/db` devolviendo snake_case, o un
`catalogs.mapper.ts` compartido. Lo primero viola `rules.design`
(«la traducción vive en los servicios de Nest»); lo segundo crea un archivo con
4 funciones que no comparten ni una línea (los key-sets son disjuntos).

Los cuatro key-sets están verificados como **únicos** en las 4 colecciones
(`distinct key-orders = 1` en 10/10/14/9 filas) — ver «Interfaces / Contracts».

### Decisión C — paginación: `paginate()` local, y `types` sin envoltorio

Se ratifica **US-2 Decision A**: `paginate()`
(`common/pagination/paginate.ts:4-75`), nunca `buildPaginator()` de
`packages/db`. Razón vigente y re-verificada: `PaginationArgs`
(`common/dto/pagination-args.dto.ts:1-6`) declara defaults (`limit = 15`) que
**nunca se aplican** porque `ValidationPipe` no transforma → `limit` llega
`string` y `paginate()` lo emite tal cual en `per_page`. Tipar `limit: number`
rompería CA-1 («mismos tipos»).

Reglas por catálogo, copiadas literalmente del mock (el "MUST-KEEP" de US-2):

| Endpoint | Guardas que se conservan literales | `url` (carácter a carácter) | Lo que recibe el repositorio |
|---|---|---|---|
| `/types` | ninguna (`GetTypesDto` NO extiende `PaginationArgs`) | — (array plano, sin envoltorio) | `{ name? }` |
| `/tags` | `if (!page) page = 1;` **y nada más** (`tags.service.ts:31`) | `` `/tags?limit=${limit}` `` — **sin `search`** | `page: Number(page)\|\|1`, `limit: Number(limit)\|\|30` |
| `/manufacturers` | `if (!page) page = 1; if (!limit) limit = 30;` (`:37-38`) | `` `/manufacturers?search=${search}&limit=${limit}` `` | idem |
| `/shops` | `if (!page) page = 1;` **y nada más** (`:31`) | `` `/shops?search=${search}&limit=${limit}` `` | idem |

`page`/`limit` circulan por dos caminos, igual que en US-2: **crudos** hacia
`paginate()` y la plantilla de URL; **numéricos con fallback** hacia el
repositorio (Prisma exige números en `skip`/`take`; `Number('abc')` sería `NaN`
y haría lanzar a Prisma → 500). El artefacto `search=undefined` se reproduce.

**Residual declarado (V-24)**: si un cliente omite `limit` en `/tags` o
`/shops`, `paginate()` usa su default `pageSize = 10` mientras el repositorio
recibe 30 → `count` podría exceder `per_page`. Hoy es **inobservable**: hay 10
tags y 12 shops, y los llamadores reales siempre mandan `limit`
(`tag-filter-view.tsx:64-66` → 100; `pages/shops/index.tsx:18,22` →
`SHOPS_PER_PAGE = 30`, `framework/rest/client/variables.ts:4`;
`manufacturers-grid.tsx:16` → 30; `top-manufacturers-grid.tsx:51-52` → 10). No
se añade una rama para cubrirlo.

### Decisión D — `orderBy` de `tags` y `shops` pasa a `id: 'desc'` (hallazgo nuevo)

**El proposal no cubre el orden de las filas y es observable.** Medido sobre
los JSON del mock (`node -e`, ids en el orden en que el endpoint los emite):

| Catálogo | Orden del mock | `orderBy` actual del repo | Acción |
|---|---|---|---|
| `types` | `1,2,3,4,5,6,7,8,9,11` (**asc**) | `id: 'asc'` (`types.repository.ts:12`) | ninguna |
| `manufacturers` | `1..12,18,19` (**asc**) | `id: 'asc'` (`manufacturers.repository.ts:31`) | ninguna |
| `tags` | `62,61,60,59,58,57,56,55,54,53` (**desc**) | `id: 'asc'` (`tags.repository.ts:31`) | **→ `id: 'desc'`** |
| `shops` | `11,9,7,6,5,4,3,2,1` (**desc**) | `id: 'asc'` (`shops.repository.ts:34`) | **→ `id: 'desc'`** |

| Opción | Trade-off | Decisión |
|---|---|---|
| `orderBy: { id: 'desc' }` en `tags` y `shops` (2 líneas) | Cambia el default del repositorio | **Elegida** |
| Declarar el reorden como divergencia aceptada | Invierte la lista de tags del filtro de búsqueda y la grilla de tiendas; y con `asc` los retailers scrapeados (ids altos) caen al final de la lista — justo lo contrario del objetivo de la US | Descartada |
| Ordenar en el servicio tras el fetch | Imposible: la página se corta en SQL (`skip`/`take`) | Prohibida |

`desc` no es solo paridad: preserva **exactamente** el orden relativo de los 9
shops del mock y deja las 3 filas reconstruidas (ids 12/14/15) y los futuros
retailers **al frente**. El cambio es seguro: `git grep` confirma que
`listTags`/`listShops` no tienen ningún consumidor fuera del barrel
(`packages/db/index.ts:62,65`) — ni el test de integración de productos ni el
scraper los llaman. La paginación sigue siendo estable (id es único).

### Decisión E — `shops.products_count`: `_count` filtrado en el repositorio, una sola query

**Elección**: se calcula en `packages/db`, no en el servicio, y se aplica **en
`listShops` y en `findShopBySlug`**.

```ts
// shops.repository.ts — mismos filtros que el listado público de la tienda.
const PUBLISHED_PRODUCT: Prisma.ProductWhereInput = {
  status: 'publish',
  visibility: 'visibility_public',
};
const COUNT_PRODUCTS = { _count: { select: { products: { where: PUBLISHED_PRODUCT } } } } as const;

const rows = await prisma.shop.findMany({ where, include: COUNT_PRODUCTS, orderBy: { id: 'desc' }, skip, take });
return {
  items: rows.map((row) => ({ ..._toShopRecord(row), productsCount: row._count.products })),
  total,
};
```

- **Sin N+1**: `_count` con `where` es una única sentencia SQL que Prisma
  resuelve con subconsulta correlacionada; no hay una query por shop. Soporte
  verificado en el cliente generado instalado:
  `packages/db/generated/prisma/client/models/Shop.ts:599-622`
  (`ShopCountOutputTypeCountProductsArgs = { where?: Prisma.ProductWhereInput }`)
  → **no requiere preview feature** en Prisma 7. El resultado es `number`, no
  `BigInt`: no hace falta `_id()`.
- **`findShopBySlug` también lo incluye.** Sin esto el detalle emitiría
  `products_count: undefined`, `JSON.stringify` **borraría la clave** y
  `/shops/:slug` bajaría a 15 claves: rotura de contrato. Es el detalle más
  fácil de olvidar de este change.
- `_toShopRecord(row)` **no se modifica**: recibe un objeto más ancho
  (`Shop & { _count }`) y proyecta solo lo que conoce; `productsCount` se añade
  en el spread del repositorio.
- `ShopRecord.productsCount?: number` es **opcional** para que
  `findOrCreateShopBySlug` (scraper, `shops.repository.ts:54-70`) siga
  compilando sin calcular nada. El mapper del servicio usa
  `record.productsCount ?? 0` para ser total.

**Paridad verificada** contra `products.json` (`node -e`, conteo por
`shop.id` con y sin el filtro `publish`/`visibility_public`):

| shop | mock | `COUNT` con filtro | sin filtro | ¿coincide? |
|---|---|---|---|---|
| medicine (11) | 26 | 26 | 26 | sí |
| gadget (9) | 44 | 44 | 44 | sí |
| books-shop (7) | 67 | 67 | 67 | sí |
| grocery-shop (6) | 584 | 584 | 584 | sí |
| bakery-shop (5) | 72 | 72 | 72 | sí |
| **makeup-shop (4)** | **81** | **82** | 82 | **NO — el mock se equivoca** |
| bags-shop (3) | 15 | 15 | 15 | sí |
| clothing-shop (2) | 64 | 64 | 64 | sí |
| **furniture-shop (1)** | 55 | **55** | **56** | sí — **solo con el filtro** |
| noaw (12) | — | 188 | 188 | fila reconstruida |
| launchidea (14) | — | 1 | 1 | fila reconstruida |
| tetetetet (15) | — | 1 | 1 | fila reconstruida |

Dos consecuencias que el implementador **no debe "arreglar"**: (1) el filtro
`status`/`visibility` es obligatorio — sin él `furniture-shop` daría 56 y
divergiría; (2) `makeup-shop` dará **82 donde el mock dice 81** y eso es
correcto: el mock declara un valor inconsistente con sus propios 1200
productos. Se declara en el verify-report, no se compensa con un `-1`.
Comprobación aritmética de cierre: 26+44+67+584+72+82+15+64+55+188+1+1 = **1199**
= total de productos `publish`/`visibility_public` del mock.

### Decisión F — `type` anidado de tags/manufacturers: `listTypes()` en paralelo, indexado en memoria

Ratifica D-6. El mock embebe `type: {id,name,slug,logo}` (**4 claves**,
verificado idéntico en 10/10 tags y 14/14 manufacturers; `logo` es `null` en
24/24). El servicio hace **un** `listTypes()` por request (10 filas) y arma un
`Map<number, TypeRecord>`; `include: { type: true }` queda descartado porque
obligaría a introducir `TagWithType`/`ManufacturerWithType` y a cambiar el tipo
de retorno de 4 funciones del barrel.

Paridad verificada: para las 10 filas de `tags` (todas `type_id = 11`) y las 14
de `manufacturers` (`type_id` 8/9/11), el `id`, `name` y `slug` del type
sembrado coinciden **exactamente** con el objeto embebido en el mock
(`db/seed.sql:399-431` vs. `manufacturers.json`/`tags.json`).

Las dos llamadas van **en el mismo `try`, en paralelo**:

```ts
let result: { items: TagRecord[]; total: number };
let types: TypeRecord[];
try {
  [result, types] = await Promise.all([listTags(input), listTypes()]);
} catch (error) { /* 503 / 500 */ }
const typesById = new Map(types.map((t) => [t.id, t]));
```

`typeId` puede ser `null` (`schema.prisma:132,114`: `typeId BigInt?`) y un tag
scrapeado podría no tenerlo → el mapper emite `type: null` en ese caso (nunca
un objeto a medias). Con el seed actual no ocurre: 24/24 filas tienen `typeId`.

### Decisión G — errores: `try/catch` solo alrededor del I/O; el 404 va fuera

Ratifica D-3 y copia US-3 Decisión B, ahora en 6 métodos. Patrón obligatorio
para los cuatro detalles:

```ts
async getTypeBySlug(slug: string): Promise<Type> {
  let record: TypeRecord | null;
  // El try envuelve SOLO la llamada de I/O. El 404 queda fuera a propósito:
  // dentro, este catch lo convertiría en un 500.
  try {
    record = await findTypeBySlug(slug);
  } catch (error) {
    if (isPrismaConnectionError(error)) throw new ServiceUnavailableException(getUserFriendlyMessage(error));
    throw new InternalServerErrorException(getUserFriendlyMessage(error));
  }
  if (!record) throw new NotFoundException(`No existe un type con slug \`${slug}\`.`);
  return toTypeDto(record);
}
```

Mensajes de 404 (español, con el slug, mismo molde que
`products.service.ts:229`): «No existe un type con slug \`x\`.» / «…un tag con
slug…» / «…una marca con slug…» / «…una tienda con slug…».
Imports a añadir en los 4 servicios desde `@nestjs/common`:
`InternalServerErrorException`, `NotFoundException`,
`ServiceUnavailableException`; y desde `@safari/db`:
`getUserFriendlyMessage`, `isPrismaConnectionError` + las funciones y tipos de
cada catálogo. `apps/api/rest/tsconfig.json` no activa `strict`, así que
`let record: X | null;` sin inicializar no genera fricción.

### Decisión H — los inputs de `packages/db` crecen con `name?`, no con un `search` genérico

`ListTypesInput` es **nuevo** (hoy `listTypes()` no acepta argumentos);
`ListTagsInput`, `ListManufacturersInput` y `ListShopsInput` ganan `name?`.
Copia literal del patrón de `ListProductsInput.name`
(`products.repository.ts:116-117` y `179-181`):

```ts
...(input.name && { name: { contains: input.name, mode: 'insensitive' as const } }),
```

`types.repository.ts` no importa hoy `Prisma`: PR #1 añade
`import type { Prisma } from '../../generated/prisma/client/client';` (misma
ruta que los otros tres repos) y `listTypes(input: ListTypesInput = {})`
mantiene la compatibilidad con el llamador sin argumentos (D-6).
El índice trigram respalda el `contains` solo en `products`; en catálogos de
10-14 filas el seq scan es irrelevante.

## Interfaces / Contracts — los cuatro key-sets, en orden

Orden y cardinalidad verificados con
`node -e "…new Set(a.map(x=>Object.keys(x).join('|')))"` sobre
`apps/api/rest/src/db/pickbazar/*.json`: **un solo key-order por colección**
(10 filas types, 10 tags, 14 manufacturers, 9 shops). El orden se preserva
porque el literal del mapper se escribe en ese orden y `target: es2017` no
define campos de clase.

### `/types` — 9 claves (array plano)

| # | Clave | Origen | Nota |
|---|---|---|---|
| 1 | `id` | `r.id` | |
| 2 | `name` | `r.name` | |
| 3 | `language` | `r.language` | columna real |
| 4 | `translated_languages` | **`['en']`** | V-9 (1 fila diverge: `books` trae `["en","de"]`) |
| 5 | `slug` | `r.slug` | |
| 6 | `banners` | `r.banners` (jsonb) | |
| 7 | `promotional_sliders` | **`null`** | V-8 (ver corrección C-2) |
| 8 | `settings` | `r.settings` (jsonb) | |
| 9 | `icon` | `r.icon` | |

### `/tags` — 9 claves + envoltorio `{data, ...paginate}`

`id`, `name`, `language` (`r.language`), `translated_languages` (**`['en']`**,
V-9: 10/10 coinciden), `slug`, `details` (`r.details`), `image` (`r.image`),
`icon` (`r.icon`), `type` (**anidado de 4 claves**: `{id, name, slug, logo: null}`,
Decisión F).

### `/manufacturers` — 13 claves + envoltorio (y `/top-manufacturers`, array plano con el mismo mapper)

| # | Clave | Origen | Nota |
|---|---|---|---|
| 1-3 | `id`, `name`, `slug` | `r.*` | |
| 4 | `language` | **`'en'`** | V-10 (sin columna; 14/14 coinciden) |
| 5 | `translated_languages` | **`['en']`** | V-9 (14/14 coinciden) |
| 6 | `products_count` | **`0`** | V-1 + corrección C-1 |
| 7 | `is_approved` | **`Number(r.isApproved)`** | V-11 (el mock emite `1`, no `true`) |
| 8 | `description` | `r.description` | |
| 9 | `website` | `r.website` | |
| 10 | `socials` | **`[]`** | V-2 |
| 11 | `image` | `r.image` (jsonb) | |
| 12 | `cover_image` | **`null`** | V-3 (14/14 del mock traen objeto) |
| 13 | `type` | anidado 4 claves | Decisión F |

### `/shops` — 16 claves + envoltorio

| # | Clave | Origen | Nota |
|---|---|---|---|
| 1 | `id` | `r.id` | |
| 2 | `owner_id` | `r.ownerId` | escalar real (1 en las 12 filas) |
| 3-5 | `name`, `slug`, `description` | `r.*` | |
| 6 | `cover_image` | `r.coverImage` (jsonb) | `null` en las 3 reconstruidas |
| 7 | `logo` | `r.logo` (jsonb) | |
| 8 | `is_active` | **`Number(r.isActive)`** | V-11 |
| 9 | `address` | `r.address` (jsonb) | `{}` en las 3 reconstruidas |
| 10 | `settings` | `r.settings` (jsonb) | idem |
| 11 | `notifications` | **`null`** | V-6 (9/9 del mock son `null` → divergencia cero) |
| 12 | `created_at` | `r.createdAt` (`Date`→ISO) | V-7 (ver corrección C-3) |
| 13 | `updated_at` | `r.updatedAt` | V-7 |
| 14 | `orders_count` | **`0`** | V-5 |
| 15 | `products_count` | **`r.productsCount ?? 0`** | D-4 / Decisión E |
| 16 | `owner` | **`null`** | V-4 (nunca un objeto falso) |

### Firmas nuevas / modificadas en `packages/db`

```ts
// types.repository.ts (nuevo input; exportado en index.ts)
export interface ListTypesInput { name?: string }
export async function listTypes(input?: ListTypesInput): Promise<TypeRecord[]>

// tags / manufacturers / shops: un campo nuevo, opcional, en cada input
export interface ListTagsInput { typeSlug?: string; name?: string; page?: number; limit?: number }
export interface ListManufacturersInput { typeSlug?: string; name?: string; page?: number; limit?: number }
export interface ListShopsInput { isActive?: boolean; name?: string; page?: number; limit?: number }

// records.ts — un campo opcional
export interface ShopRecord { /* …12 campos existentes… */ productsCount?: number }
```

`packages/db/index.ts` — **único archivo compartido con US-4b (R-4)**: US-4a
añade `export type { ListTypesInput }` junto al export de funciones de
`types.repository` (**línea 66**); US-4b trabaja en la zona de `categories`
(**líneas 26-34**). **US-4a es la base**: US-4b rebasea sobre ella. No se añade
ninguna maquinaria de coordinación.

## Data Flow

    GET /api/tags?limit=100&searchJoin=and&search=type.slug:medicine
        │
        ▼  TagsController.findAll  (sin cambios, tags.controller.ts:26)
    TagsService.findAll(query)                    ← pasa a async
        │  parseSearch(search) → { 'type.slug': 'medicine' }
        │  → ListTagsInput { typeSlug, name?, page: Number(page)||1, limit: Number(limit)||30 }
        ▼
    try  ──→ Promise.all([ listTags(input), listTypes() ])   @safari/db → Prisma → :5433
        │         { items, total }        TypeRecord[10]
        │    catch → 503 (isPrismaConnectionError) | 500 (resto)
        ▼
    typesById = new Map(types.map(t => [t.id, t]))
    data = items.map(r => toTagDto(r, typesById))   ← 9 claves snake_case
        ▼
    { data, ...paginate(total, page, limit, data.length, `/tags?limit=${limit}`) }

    GET /api/shops/gadget
        └─ try → findShopBySlug(slug)  (con _count filtrado)
             · null → NotFoundException (404)   ← FUERA del try
             · row  → toShopDto(record)          16 claves

## File Changes — por PR (cadena de 3, decisión del usuario)

Cada PR es **independientemente releasable y verificable de punta a punta**
con su propio `curl`. En cadena: PR #1 → rama del tracker; #2 apunta a #1; #3
apunta a #2 (rebasear si GitHub muestra el diff del anterior).

### PR #1 — helper `parse-search` + `types` (~135 líneas)

| File | Action | Description |
|------|--------|-------------|
| `apps/api/rest/src/common/search/parse-search.ts` | **Create** | `parseSearch()`, ~14 líneas (Decisión A) |
| `apps/api/rest/src/types/types.service.ts` | Modify | `getTypes`/`getTypeBySlug` async sobre `listTypes`/`findTypeBySlug` + `toTypeDto` + try/catch + 404. `typesJson`/`fuse`/`plainToClass` se quedan (los usa `create`/`update`) |
| `packages/db/src/repositories/types.repository.ts` | Modify | `ListTypesInput { name? }`, `listTypes(input = {})`, `where` con `contains`/`insensitive`, import de `Prisma` |
| `packages/db/index.ts` | Modify | `export type { ListTypesInput }` (línea 66) — **archivo compartido, R-4** |
| `packages/db/src/repositories/types.integration.test.ts` | **Create** | ~35 líneas |
| `apps/api/rest/src/types/types.controller.ts` | Sin cambios | no tipa el retorno |

**Verificable solo**: `curl /api/types` (10 filas, 9 claves) + `curl
/api/types/gadget` + `curl /api/types/no-existe` (404) + `just db-check`.

### PR #2 — `tags` + `manufacturers` (~250 líneas)

| File | Action | Description |
|------|--------|-------------|
| `apps/api/rest/src/tags/tags.service.ts` | Modify | `findAll`/`findOne` async + `toTagDto` + type anidado (F) + `parseSearch`. `findOne` resuelve **solo por slug** (D-8) → la rama numérica pasa a 404. Se elimina el `console.log(value,'value')` de la línea 38 al reescribirse el bloque |
| `apps/api/rest/src/manufacturers/manufacturers.service.ts` | Modify | `getManufactures`/`getTopManufactures`/`getManufacturesBySlug` async + `toManufacturerDto` + type anidado. Se elimina el `console.log('search', …)` de la línea 43. `getTopManufactures` **ignora `search`** (V-20) |
| `packages/db/src/repositories/tags.repository.ts` | Modify | `name?` + `orderBy: { id: 'desc' }` (D) |
| `packages/db/src/repositories/manufacturers.repository.ts` | Modify | `name?` (el `orderBy` asc se queda) |
| `packages/db/src/repositories/tags.integration.test.ts` | **Create** | ~45 líneas |
| `packages/db/src/repositories/manufacturers.integration.test.ts` | **Create** | ~40 líneas |

### PR #3 — `shops` + cierre documental (~205 líneas)

| File | Action | Description |
|------|--------|-------------|
| `apps/api/rest/src/shops/shops.service.ts` | Modify | **solo** `getShops`/`getShop` + `toShopDto` + `parseSearch`. `getNewShops`/`getStaffs`/`getNearByShop`/`approveShop`/`disapproveShop` intactos → `shopsJson`, `nearShopJson`, `fuse` y `plainToClass` **no se borran** |
| `packages/db/src/repositories/shops.repository.ts` | Modify | `name?` + `orderBy: { id: 'desc' }` (D) + `_count` filtrado en `listShops` **y** en `findShopBySlug` (E) |
| `packages/db/src/records.ts` | Modify | `ShopRecord.productsCount?: number` (E) |
| `packages/db/src/repositories/shops.integration.test.ts` | **Create** | ~45 líneas |
| `docs/product/1-catalogo-desde-postgres/4-migrar-catalogos-apoyo.md` | Modify | reescritura a **US-4a** (título, alcance sin `categories`, CAs, DoD, **Status**, LOC) + nota de split hacia `./4b-categorias-arbol-postgres.md` |
| `docs/product/1-catalogo-desde-postgres/README.md` | Modify | tabla de sub-US (**línea 33**): fila US-4a + fila US-4b nueva; ajustar «Orden sugerido» (línea 35) |
| `docs/product/README.md` | Modify | **línea 196**: `→ US-2, US-3, US-4a, US-4b` |

Sin cambios en `apps/shop/**`, `apps/admin/**`, `db/schema.sql`,
`packages/db/prisma/schema.prisma`, ni en los controllers.
`docs/product/1-catalogo-desde-postgres/4b-categorias-arbol-postgres.md` es de
**US-4b**: no se crea aquí (el enlace de la tabla queda colgando hasta que
aterrice, y la nota de split lo dice). El sufijo `4a`/`4b` es una excepción
aprobada al antipatrón de `docs/product/README.md:183` (que proscribe
decimales, no letras): se documenta como excepción, **no** se reescribe la
convención.

## Correcciones factuales al proposal (decisiones intactas)

No se reabre ninguna decisión; se corrige la **magnitud** declarada de tres
divergencias, medida con `node -e`:

| # | El proposal dice | Medición real | Efecto |
|---|---|---|---|
| **C-1** | V-1: «`manufacturers.products_count` … contar da 0» | Correcto que Postgres da 0 (`products.json` no emite la clave `manufacturer` en ninguna de sus 1200 filas, key-set de 20 claves), **pero el mock emite valores no nulos en 14/14 filas** (8, 11, 13, 13, 7, 7, 3, 3, 3, 19, 20, 5, 13, 12) | La divergencia visible es **14 filas**, no 0. La columna del admin (`components/manufacturer/manufacturer-list.tsx:118-119`) pasará de mostrar 3-20 a mostrar 0 |
| **C-2** | V-8: «7 de 10 types traen 4-5 sliders» | **6** traen 4-5 (`grocery`, `makeup`, `bags`, `clothing`, `furniture`, `medicine`), **2** traen `[]` (`books`, `gadget`) y **2** traen `null` (`bakery`, `daily-needs`) | Constante `null` diverge en **8 de 10** filas (6 con contenido + 2 que cambian `[]`→`null`). Sigue sin lector en el shop |
| **C-3** | V-7: «divergencia de dato, no de shape» | Correcto, y además **es visible al usuario**: `apps/shop/src/components/shops/sidebar.tsx:96` renderiza `dayjs(shop?.created_at).format('YYYY')` → la tienda pasará de «Since 2023» a «Since» el año del `just db-up` | Se declara en el verify-report como cambio observable, no como bug |

## Divergencias nuevas (continúan la numeración del proposal)

| # | Divergencia | Decisión |
|---|---|---|
| **V-17** | Orden de filas de `tags` (mock desc) | **Resuelta por diseño**, no aceptada: `orderBy: { id: 'desc' }` (Decisión D) |
| **V-18** | Orden de filas de `shops` (mock desc) | **Resuelta por diseño**: `orderBy: { id: 'desc' }` (Decisión D) |
| **V-19** | `GetTypesDto.text` (`get-types.dto.ts:5`) deja de filtrar; el mock lo pasaba por `fuse` (`types.service.ts:24-26`) | **Aceptada**: `git grep` no encuentra **ningún** emisor de `text` en shop ni admin (los dos mandan `search=name:`). Cablearlo exigiría decidir la semántica de los `%` que el mock limpia y que `contains` no entiende |
| **V-20** | `/top-manufacturers` sigue ignorando `search=type.slug:` que el shop SÍ manda (`client/index.ts:313-319`), mientras `/manufacturers` empieza a honrarlo (clase V-12) | **Aceptada por paridad**: el mock lo ignora (`manufacturers.service.ts:59-63` solo usa `limit`). Honrarlo cambiaría la grilla del home; es otra US |
| **V-21** | `/tags/:param` con id numérico pasa de 200-con-cuerpo a **404** | Ratifica D-8 + V-16. Verificado que ningún frontend usa la rama de id: el shop no expone `tags.get` (`client/index.ts:230-237`) y el admin usa `crudFactory.get({slug})` (`data/client/curd-factory.ts:18-20`) |
| **V-22** | `manufacturers`: el token `shop_id` que manda el admin (`data/client/manufacturer.ts:24`) se ignora | **Aceptada**: no existe relación shop↔manufacturer en `db/schema.sql`. El mock tampoco filtraba por él (su `fuse` no indexa `shop_id`) |
| **V-23** | `tags`/`manufacturers`: `type: null` si `typeId` es `null` | Camino defensivo para filas scrapeadas; 0 filas afectadas con el seed (24/24 tienen `typeId`) |
| **V-24** | Sin `limit`, `/tags` y `/shops` pueden emitir `count > per_page` | **Aceptada, inobservable** (10 tags / 12 shops; todos los llamadores mandan `limit`) — ver Decisión C |

## Testing Strategy

| Layer | Qué se prueba | Cómo |
|-------|---------------|------|
| Integración (`packages/db`, vitest) | filtros `name`/`typeSlug`, orden, `productsCount`, `findXBySlug` hit/`null`, JSON-safety | **4 archivos nuevos**, uno por catálogo, en `packages/db/src/repositories/` |
| Unit (jest, `apps/api/rest`) | — | **Ninguno** (D-10): los 4 servicios son mappers finos; 4 specs ≈ 200 líneas sin cubrir riesgo nuevo. La DoD no los pide |
| E2E manual | CA-1…CA-4 | `curl` en el 9001 + `node -e` (jq NO instalado) + `just verify` |

**Un archivo por catálogo, no `describe`s dentro de
`products.integration.test.ts` (268 líneas)**: ese archivo llegaría a ~430
líneas mezclando el agregado central con catálogos ajenos; sin
`vitest.config.*` en `packages/db` (verificado: solo `biome.json`,
`tsconfig.json`, `tsup.config.ts`, `prisma.config.ts`) rige `isolate: true`,
así que cada archivo tiene su worker y su `prisma` singleton — el
`afterAll(prisma.$disconnect)` de uno no afecta a los demás. Las 4 suites son
**solo lectura** (no escriben fixtures como `TEST_STORE`), triviales de borrar
en un rollback parcial. El patrón (imports, `afterAll` con
`prisma.$disconnect`, `expect(() => JSON.stringify(items)).not.toThrow()`) se
copia de `products.integration.test.ts:9-45`. Los nombres `*.integration.test.ts`
ya los recoge el `include` por defecto de vitest (`npm test` = `vitest run`).

| Suite (PR) | Aserciones mínimas |
|---|---|
| `types.integration.test.ts` (#1) | `listTypes()` → 10 filas, `id` asc, JSON-safe · `listTypes({name:'gad'})` → 1 fila `gadget` (case-insensitive) · `findTypeBySlug('gadget')` → hit · `findTypeBySlug('no-existe')` → `null` |
| `tags.integration.test.ts` (#2) | `listTags()` → `total` 10 y **primer id 62 / último 53** (orden desc, D) · `listTags({typeSlug:'medicine'})` → 10 · `listTags({typeSlug:'grocery'})` → 0 · `listTags({name:'baby'})` → 2 (`baby-growth`, `baby-milk`) · `findTagBySlug` hit/`null` |
| `manufacturers.integration.test.ts` (#2) | `listManufacturers()` → `total` 14, `id` asc · `{typeSlug:'books'}` → 9 · `{name:'publication'}` → **9** (case-insensitive: 8 «Publication(s)» + «Too cool publication») · `{limit:10}` → 10 items con los ids de `slice(0,10)` (D-9) · `findManufacturerBySlug` hit/`null` |
| `shops.integration.test.ts` (#3) | `listShops()` → `total` **12** y **primer id 15** (desc, D) · las 3 reconstruidas presentes (`noaw`, `launchidea`, `tetetetet`) · `productsCount` de `grocery-shop` = **584**, de `makeup-shop` = **82**, de `noaw` = **188** · `{name:'shop'}` → **7** · `findShopBySlug('gadget').productsCount` = **44** (el detalle también lo trae, E) · `findShopBySlug('no-existe')` → `null` |

## Verification Plan (evidencia real, reutilizable)

Prerrequisitos: `just db-up` (Postgres sembrado y healthy), `just db-build`,
`just build-api` o `just api-dev`. Puerto **9001** (el 9000 es Zscaler).
**`jq` NO está instalado** → todo diff con `node -e`. **`psql` no está en el
PATH** → SQL por `docker exec`.

### Paso 0 — línea base del mock, ANTES de tocar una línea de código

```bash
CH=openspec/changes/2026-08-26-catalogos-planos-postgres
curl -s "http://localhost:9001/api/types"                      > $CH/mock-types.json
curl -s "http://localhost:9001/api/tags?limit=100"             > $CH/mock-tags.json
curl -s "http://localhost:9001/api/manufacturers?limit=30"     > $CH/mock-manufacturers.json
curl -s "http://localhost:9001/api/shops?limit=30"             > $CH/mock-shops.json
curl -s "http://localhost:9001/api/top-manufacturers?limit=10" > $CH/mock-top-manufacturers.json
```

**Vía 2, sin servidor** (obligatoria si el paso 0 se perdió: mock y Postgres no
pueden servir la misma ruta a la vez). Reconstruye **solo las filas**; el
envoltorio se valida contra la tabla de valores esperados de más abajo:

```bash
node -e "
const fs=require('fs'), D='apps/api/rest/src/db/pickbazar/';
const CH='openspec/changes/2026-08-26-catalogos-planos-postgres/';
for (const c of ['types','tags','manufacturers','shops']) {
  const rows=JSON.parse(fs.readFileSync(D+c+'.json','utf8'));
  fs.writeFileSync(CH+'mock-'+c+'.rows.json', JSON.stringify(rows,null,2));
  console.log(c, rows.length, 'filas | claves:', Object.keys(rows[0]).length);
}
"
```

### Paridad de contrato — el diff de key-sets y de filas (plantilla reutilizable)

```bash
# $1 = archivo del mock, $2 = archivo de Postgres, $3 = 'wrap' si trae {data,...}
node -e "
const fs=require('fs'), rd=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const [fa,fb,mode]=process.argv.slice(1);
const A=rd(fa), B=rd(fb);
const ra = mode==='wrap'?A.data:A, rb = mode==='wrap'?B.data:B;
const ka=Object.keys(ra[0]), kb=Object.keys(rb[0]);
console.log('filas:', ra.length, '->', rb.length);
console.log('claves:', ka.length, '->', kb.length, '| mismo orden:', JSON.stringify(ka)===JSON.stringify(kb));
console.log('faltan:', ka.filter(k=>!kb.includes(k)), '| sobran:', kb.filter(k=>!ka.includes(k)));
console.log('key-orders distintos en pg:', new Set(rb.map(r=>Object.keys(r).join('|'))).size);
console.log('ids mock:', ra.map(r=>r.id).join(','));
console.log('ids pg  :', rb.map(r=>r.id).join(','));
if (mode==='wrap') {
  const w=o=>{const {data,...rest}=o; return rest;};
  const wa=w(A), wb=w(B);
  for (const k of Object.keys(wa)) if (JSON.stringify(wa[k])!==JSON.stringify(wb[k]))
    console.log('envoltorio', k+':', JSON.stringify(wa[k]), '->', JSON.stringify(wb[k]), '| tipos', typeof wa[k], typeof wb[k]);
}
const byId=Object.fromEntries(ra.map(r=>[r.id,r]));
for (const r of rb) { const m=byId[r.id]; if (!m) { console.log('FILA NUEVA id', r.id, r.slug); continue; }
  for (const k of ka) if (JSON.stringify(m[k])!==JSON.stringify(r[k]))
    console.log('id',r.id,k+':', JSON.stringify(m[k]), '->', JSON.stringify(r[k]));
}
" "$1" "$2" "$3"
```

Ejecuciones esperadas (tras cada PR, con la API contra Postgres):

```bash
curl -s "http://localhost:9001/api/types"                      > $CH/pg-types.json          # PR #1
curl -s "http://localhost:9001/api/tags?limit=100"             > $CH/pg-tags.json           # PR #2
curl -s "http://localhost:9001/api/manufacturers?limit=30"     > $CH/pg-manufacturers.json  # PR #2
curl -s "http://localhost:9001/api/top-manufacturers?limit=10" > $CH/pg-top-manufacturers.json
curl -s "http://localhost:9001/api/shops?limit=30"             > $CH/pg-shops.json          # PR #3
```

**Valores esperados del envoltorio** (los que hay que ver, no los que "deberían
salir"):

| Endpoint (`limit`) | `total` | `count` | `per_page` | `last_page` | `first_page_url` |
|---|---|---|---|---|---|
| `/tags?limit=100` | 10 | 10 | `"100"` (string) | 1 | `…/api/tags?limit=100&page=1` (**sin `search`**) |
| `/manufacturers?limit=30` | 14 | 14 | `"30"` | 1 | `…/api/manufacturers?search=undefined&limit=30&page=1` |
| `/shops?limit=30` | **12** (mock: 9) | **12** (mock: 9) | `"30"` | 1 | `…/api/shops?search=undefined&limit=30&page=1` |

Divergencias esperadas por endpoint (cualquier otra línea del diff es un bug):
types → V-8/V-9 (`promotional_sliders`, `books.translated_languages`);
tags → V-9 ninguna, V-13 (`total`/`count` reales) ; manufacturers →
V-1/V-2/V-3/V-9/V-10 y `is_approved` intacto (V-11); shops → V-4/V-5/V-6/V-7 +
3 filas nuevas + `products_count` de `makeup-shop` 81→82 (E).

### Delta de filas de `shops` (CA-3) — obligatorio en el verify

```bash
docker exec -e PGPASSWORD=safari safari-postgres psql -h localhost -U safari -d safari_scraper \
  -c "SELECT id, slug, description LIKE 'Reconstruido%' AS recon FROM shops ORDER BY id DESC"
# 12 filas: 15,14,12 con recon=t (noaw/launchidea/tetetetet) + 11,9,7,6,5,4,3,2,1 con recon=f

docker exec -e PGPASSWORD=safari safari-postgres psql -h localhost -U safari -d safari_scraper \
  -c "SELECT s.id, s.slug, count(p.id) FILTER (WHERE p.status='publish' AND p.visibility='visibility_public') AS pc
      FROM shops s LEFT JOIN products p ON p.shop_id = s.id GROUP BY s.id, s.slug ORDER BY s.id DESC"
# Debe coincidir con la tabla de la Decisión E (grocery 584, makeup 82, noaw 188, …; suma 1199)
```

### Detalles por slug, 404 y 503

```bash
for s in types/gadget tags/shake manufacturers/apextech shops/gadget; do
  echo "== $s"; curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:9001/api/$s"; done   # 4x 200
# El detalle debe traer el MISMO objeto que el listado (mismas claves, mismo orden):
curl -s "http://localhost:9001/api/shops/gadget" > $CH/pg-shop-gadget.json
node -e "
const fs=require('fs');const rd=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const l=rd('$CH/pg-shops.json').data.find(r=>r.slug==='gadget');
const d=rd('$CH/pg-shop-gadget.json');
console.log('claves', Object.keys(l).length, Object.keys(d).length, '| idéntico:', JSON.stringify(l)===JSON.stringify(d));
"
for s in types tags manufacturers shops; do curl -s "http://localhost:9001/api/$s/no-existe-xyz"; echo; done
# 4x {"message":"No existe …","error":"Not Found","statusCode":404}
curl -s "http://localhost:9001/api/tags/62"     # V-21: 404 (el mock devolvía el tag)

just db-down
for s in types tags manufacturers shops top-manufacturers; do
  curl -s -o /dev/null -w "$s %{http_code}\n" "http://localhost:9001/api/$s?limit=30"; done   # 5x 503
curl -s "http://localhost:9001/api/shops?limit=30"                    # cuerpo JSON legible
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:9001/api/settings   # 200 → Nest vivo
just db-up
```

### Gates y CA-4

```bash
just db-check      # typecheck + vitest: 14 previos + las suites nuevas del PR
just build-api     # verde
just verify        # 3 servicios, cuenta product-cards
just shop-dev      # en otra terminal (dev, no build: SSR/ISR real)
curl -s http://localhost:3003/en/gadget      | grep -c 'product-card'   # navegación por type
curl -s http://localhost:3003/en/shops       | grep -c 'gadget'         # grid de tiendas
curl -s http://localhost:3003/en/shops/gadget | grep -ci 'products'     # detalle de tienda
```

## Secuencia de trabajo (orden obligatorio, por PR)

1. **Paso 0**: capturar las 5 líneas base del mock. **Antes de cualquier
   edición** — mock y Postgres no pueden servir la misma ruta a la vez.
2. `just db-up`.
3. Editar `packages/db` (repos + `records.ts` + `index.ts` del slice).
4. `just db-check` (typecheck + vitest con la suite nueva) — inner loop:
   `cd packages/db && npm test`.
5. **`just db-build`** — **bloqueante y fácil de olvidar (R-5)**:
   `packages/db/dist/` está gitignored y `apps/api/rest` consume el paquete vía
   `"@safari/db": "link:../../../packages/db"` (`package.json:31`). Sin este
   paso la API ejecuta el `dist` viejo y la evidencia sale mal sin motivo
   aparente (lección de US-3, paso 5). No hace falta re-`yarn install`: el
   symlink ya apunta a la carpeta reconstruida.
6. Editar el/los servicio(s) de Nest del slice + `parse-search.ts` (PR #1).
7. `just build-api` (o reiniciar `just api-dev`) y correr el diff de paridad
   del slice.
8. PR #3 además: `docker exec … psql` del delta 9→12 y de `products_count`.
9. `just verify` + CA-4 en el shop (al cerrar la cadena).
10. Cierre documental (solo PR #3).

## Migration / Rollout y Rollback — por frontera de PR

**Sin migración de datos, sin feature flag, sin cambio de esquema**: los datos
ya están sembrados y los endpoints solo cambian de fuente de lectura. El
rollout es la propia cadena de PRs (cada slice deja la API en un estado
consistente: unos catálogos en Postgres y el resto en mock, sin acoplamiento
entre ellos).

- **PR #1**: `git revert` → `types` vuelve a `typesJson`+`fuse`; el helper
  `parse-search.ts` queda huérfano (o se revierte con él). Luego
  `just db-build && just build-api`.
- **PR #2**: `git revert` → `tags`/`manufacturers` al mock. No afecta a
  `types` (PR #1 sigue en pie) ni a `shops`.
- **PR #3**: `git revert` → `shops` al mock; `ShopRecord.productsCount` y el
  `_count` desaparecen sin romper a nadie (campo opcional, `git grep` confirma
  que solo el barrel y los tests nuevos consumen las 4 `list*`).
- **Rollback parcial por catálogo** dentro de un PR: cada servicio es
  independiente; los imports de mock nunca se quitaron, así que **ningún
  revert reinstala dependencias**.
- **Reversión de `packages/db`**: siempre seguida de `just db-build`.
- **Sin cambios de esquema, de datos ni de frontend que deshacer**: `just
  db-reset` no se necesita en ningún escenario.

## Open Questions

Ninguna bloqueante para el diseño. Dos notas para `sdd-tasks`:

1. La cadena de 3 PRs ya está **decidida por el usuario** (cierra la pregunta 1
   del proposal); `sdd-tasks` debe emitir las líneas guard con los números del
   forecast (~135 / ~250 / ~205; `400-line budget risk: High` para el change
   completo, `Low` por slice) y declarar que **US-4a es la base de
   `packages/db/index.ts`** y US-4b rebasea (R-4).
2. La Decisión D (`orderBy` desc en `tags` y `shops`) es un hallazgo posterior
   al proposal: añade ~2 líneas de producción y 2 aserciones de test al
   forecast de los PRs #2 y #3.
