# Design: El árbol de categorías desde Postgres

> **US-4b**, Épico 1. Insumos: `proposal.md` (D-1…D-10 **ratificadas**, no se
> reabren) y `openspec/changes/2026-08-26-catalogos-apoyo-postgres/exploration.md`
> §4. Precedentes estructurales:
> `openspec/changes/archive/2026-08-25-migrar-api-products-postgres/design.md`
> (US-2) y `openspec/changes/archive/2026-08-26-detalle-producto-postgres/design.md`
> (US-3). Slice hermano: **US-4a** (`2026-08-26-catalogos-planos-postgres`),
> dueño de `packages/db/index.ts` como base — **este change rebasa sobre él**.
>
> Toda cita `path:line`, todo conteo y todo key-set de este documento se
> verificó abriendo el archivo o corriendo el comando (Postgres real vía
> `docker exec safari-postgres psql`; JSON del mock vía `node -e`). Los dos
> comentarios que hoy dicen "2 niveles reales" son la prueba de por qué no se
> confía en un comentario.

## Technical Approach

Dos archivos de producción, un archivo de test nuevo y dos ediciones menores
(el barrel `packages/db/index.ts` y **un comentario** de `db/schema.sql`):

1. `packages/db/src/repositories/categories.repository.ts` (113 líneas hoy) —
   se **reescribe**: `CATEGORY_INCLUDE` deja de traer `children` por `include`
   (Decisión A); una sola `findMany()` plana trae la tabla completa y un
   ensamblador puro la convierte en árbol de profundidad arbitraria; tres tipos
   públicos nuevos en vez de `CategoryWithChildren`; `findCategoryBySlug` →
   `findCategoryByIdOrSlug`; comentario de cabecera corregido.
2. `apps/api/rest/src/categories/categories.service.ts` (70 líneas hoy) —
   `getCategories`/`getCategory` pasan a `async` sobre `@safari/db`, con tres
   mappers privados (uno por proyección del mock), el `paginate()` local ya
   importado (`categories.service.ts:9`) y el `try/catch` 503/500 de
   `products.service.ts:197-210`.
3. `packages/db/src/repositories/categories.integration.test.ts` — suite nueva,
   patrón de `products.integration.test.ts` (268 líneas).

`categories.controller.ts` **no cambia**: `findAll`/`findOne` (líneas 25-33) no
tipan el retorno, así que Nest resuelve las promesas sin fricción.
`categoriesJson`, `plainToClass` y la instancia `fuse` (líneas 7-16)
**permanecen**: los siguen usando `create`/`update`/`remove` (líneas 22-24,
63-69), que quedan en mock por el "NO incluye". Sin archivo `categories.mapper.ts`
(D-10). Sin cambio de DDL: en `db/schema.sql` solo se reescribe el comentario de
las líneas 133-135.

## Hallazgos de verificación que refinan el proposal

El proposal describe **dos** proyecciones (ascendente / descendente). La
inspección exhaustiva del mock encuentra **cuatro**, y una de ellas es
type-incoherente. Es la base de las Decisiones B y C:

```bash
node -e "const c=require('./apps/api/rest/src/db/pickbazar/categories.json'); ..."
```

| # | Proyección | Ocurrencias | Claves | Notas |
|---|---|---|---|---|
| **A** | Nodo top-level (elemento de `data`) | **177** | **16** — `id,name,slug,icon,image,details,language,translated_languages,parent,type_id,created_at,updated_at,deleted_at,parent_id,type,children` | **NO** trae `products_count`. `parent` = `null` o cadena **D**. `children` = subárbol **B** |
| **A'** | Nodo top-level de `gadget`/`medicine` | **21** | **13** en otro orden — `id,name,slug,language,translated_languages,parent,children,products_count,details,image,icon,type_id,type` | `products_count: null`, sin `created_at`/`updated_at`/`deleted_at`/`parent_id`. Ids `180,181,182,186,187,188,198-212`; `type_id ∈ {9,11}`; todas raíces y todas hoja (`children: []`) |
| **B** | Nodo descendente anidado (hija o nieta) | **121** | **16** — iguales que A salvo: **con** `products_count`, **sin** `type` (`…,deleted_at,products_count,parent_id,children`) | `products_count` real 0-22 (114 de 121 > 0) |
| **D** | Nodo ascendente (`parent` de un nodo top-level) | **121** | **14** — A menos `type` y `children` | Cadena completa: `t169.parent.parent.parent === null`. Profundidad máx. de cadena = **2** |
| **E** | `parent` de un nodo descendente **a profundidad 1** | **115** | **16**, mismo orden que A, con `type: null`, `children: null`, `parent: null` | ver Decisión C |
| — | `parent` de un nodo descendente **a profundidad 2** | **6** | — | es el **número** `163`, no un objeto. Incoherencia del mock (artefacto de eager-loading) |

Es decir: el nodo lógico 169 aparece dos veces en el payload de `parent=all` con
`parent` de tipo distinto — objeto **E** cuando cuelga del top-level `163`,
número `163` cuando cuelga a dos saltos del top-level `124`.

Profundidad real, medida con `WITH RECURSIVE` contra Postgres (no leyendo
`db/seed.sql`):

```
 nivel | count          -- 83 raíces + 109 hijas + 6 nietas = 198
     0 |    83          -- máxima profundidad = 2 saltos; 0 bisnietos
     1 |   109
     2 |     6
```

Y `SELECT count(*) FROM categories c JOIN categories p ON p.id=c.parent_id
WHERE c.type_id <> p.type_id;` → **0**: el `type_id` es uniforme dentro de cada
árbol, así que filtrar por `typeSlug` **nunca** corta una rama. Es la
precondición que hace correcto cargar solo la vertical.

## Architecture Decisions

### Decisión A — el ensamblaje (D-1 traducida a código)

`CATEGORY_INCLUDE` (`categories.repository.ts:35-38`) pasa de
`{ type: true, children: { orderBy } }` a `{ type: true }`. Los `children` ya no
salen de Prisma: salen de un ensamblador puro sobre la lista plana.

```ts
// categories.repository.ts — una sola query tipada, sin CTE, sin include
// anidado. NO hay constante de profundidad en ninguna parte de este
// archivo: un 4º nivel funcionaría sin tocar una línea. Eso es el punto
// (D-1): el bug que este change arregla nació de codificar "2 niveles".
const rows = await prisma.category.findMany({
  where: typeSlug ? { type: { slug: typeSlug } } : {},
  include: CATEGORY_INCLUDE,          // = { type: true }
  orderBy: { id: 'asc' },
});
const nodes = _assembleTree(rows);    // Map<number, CategoryTreeNode>
```

`_assembleTree` es **privada, síncrona y sin `prisma`**: se puede probar sin
base. Tres pasadas, todas O(n):

```ts
function _assembleTree(
  rows: CategoryPayload[]
): Map<number, CategoryTreeNode> {
  // 1. índices planos
  const recs = new Map<number, CategoryRecord>();
  const types = new Map<number, TypeRecord>();
  const kids = new Map<number, number[]>();      // parentId -> ids (id asc)
  for (const row of rows) {
    const rec = _toCategoryRecord(row);
    recs.set(rec.id, rec);
    types.set(rec.id, _toTypeRecord(row.type));
    if (rec.parentId !== null) {
      const bucket = kids.get(rec.parentId);
      if (bucket) bucket.push(rec.id);
      else kids.set(rec.parentId, [rec.id]);
    }
  }

  // 2. memos: cada subárbol y cada cadena se construyen UNA sola vez, así
  //    que el coste total es O(n) aunque la recursión sea por nodo.
  const down = new Map<number, CategoryDescendant>();
  const up = new Map<number, CategoryAncestor | null>();

  const descend = (id: number, path: Set<number>): CategoryDescendant => {
    const memo = down.get(id);
    if (memo) return memo;
    const rec = recs.get(id);
    if (!rec) throw new Error(`categoría ${id} ausente del set cargado`);
    // Guarda de ciclo: el DDL solo prohíbe la autorreferencia
    // (`categories_no_autoreferencia`), NO un ciclo A->B->A. Sin esta
    // guarda una fila corrupta reventaría el proceso Nest con un
    // stack overflow en vez de devolver un árbol truncado.
    if (path.has(id)) {
      return { ...rec, parent: _immediate(rec, recs), children: [] };
    }
    const next = new Set(path).add(id);
    const node: CategoryDescendant = {
      ...rec,
      parent: _immediate(rec, recs),
      children: (kids.get(id) ?? []).map((k) => descend(k, next)),
    };
    down.set(id, node);
    return node;
  };
  // ascend(id) es simétrica: memoiza en `up` y usa la misma guarda.
  ...
}
```

`_immediate(rec, recs)` devuelve `recs.get(rec.parentId) ?? null` — la madre
**plana** (un `CategoryRecord`, sin `parent` ni `children` propios), que es lo
que la Decisión C necesita.

| Opción (exploration §4) | Trade-off | Decisión |
|---|---|---|
| `findMany()` plano + ensamblaje memoizado en memoria | 198 filas (53 la vertical mayor) en memoria; ~55 LOC de ensamblador | **Elegida** (D-1) |
| `include: { children: { include: { children: true } } }` | Re-codifica la constante de profundidad que causó ESTE bug; un 4º nivel se truncaría en silencio otra vez | Descartada |
| `WITH RECURSIVE` vía `$queryRaw` | Segunda estrategia de consulta en el repositorio, sin tipar, sin ganancia a 198 filas | Descartada |

**Por qué el orden sale bien sin `orderBy` en los hijos**: el `findMany` global
ordena `id: 'asc'`, así que cada bucket de `kids` se llena en id ascendente por
construcción. Verificado contra el mock: `124.children` = `[163,164]`,
`163.children` = `[169,170]`.

### Decisión B — tres tipos públicos, aciclidad garantizada por el compilador

`CategoryWithChildren` (`categories.repository.ts:22-25`) se **elimina**
(`git grep`: su único consumidor es `packages/db/index.ts:27`). Lo reemplazan
tres interfaces cuyas formas **no pueden ciclar**, porque ningún tipo tiene a la
vez un campo hacia arriba recursivo y uno hacia abajo recursivo:

```ts
/** Hacia arriba. Sin `children` y sin `type`: no puede volver a bajar. */
export interface CategoryAncestor extends CategoryRecord {
  parent: CategoryAncestor | null;
}

/**
 * Hacia abajo. `parent` es la madre INMEDIATA y PLANA (un CategoryRecord,
 * que no tiene `parent` ni `children`): la recursión solo baja.
 */
export interface CategoryDescendant extends CategoryRecord {
  parent: CategoryRecord | null;
  children: CategoryDescendant[];
}

/** El nodo que el endpoint publica: cadena completa arriba, subárbol abajo. */
export interface CategoryTreeNode extends CategoryRecord {
  type: TypeRecord;
  parent: CategoryAncestor | null;
  children: CategoryDescendant[];
}
```

Esta es la mitigación **por construcción** de R-1: `JSON.stringify` no puede
lanzar `TypeError: Converting circular structure` porque el grafo de tipos es un
DAG dirigido en un solo sentido por rama. La asimetría es deliberada y se
documenta en el código con esta razón exacta. La suite añade además la aserción
de runtime (`expect(() => JSON.stringify(nodes)).not.toThrow()`), que es lo que
`products.integration.test.ts:44` ya hace para productos.

### Decisión C — el `parent` de los descendientes: E uniforme, no el número

El mock emite **E** (objeto de 16 claves con `type`/`children`/`parent` en
`null`) a profundidad 1 y el **número** a profundidad 2. Reproducir ambos exige
un contador de profundidad en el mapper — exactamente la constante que D-1
prohíbe.

| Opción | Trade-off | Decisión |
|---|---|---|
| **E en todos los niveles** | 115 de 121 nodos anidados byte a byte; 6 divergen (objeto en vez del escalar `163`) | **Elegida** — V-6 |
| Fiel: E a nivel 1, número a nivel 2 | Paridad 121/121, pero reintroduce un `depth` en el mapper y una unión `object \| number` en el tipo | Descartada |
| `parent: null` en todos los descendientes | Más simple, pero diverge en 121 nodos y pierde una clave con valor | Descartada |

Consecuencia: **la misma categoría 169 pasa a tener un `parent` coherente** en
las dos posiciones donde aparece. La incoherencia se corrige, no se replica.
Dato de apoyo (re-verificado hoy): `git grep '\.parent\b' -- apps/shop/src` →
**0 resultados**; el único uso en el admin es `category-form.tsx:234`
(`parent: values.parent?.id ?? null`), que es el **payload de escritura** del
formulario, no una lectura del listado. `parent` es paridad de contrato, no un
campo load-bearing.

### Decisión D — `parent` (query) → `rootsOnly` (repositorio)

`GetCategoriesDto.parent` declara `= 'null'` (`get-categories.dto.ts:15`), pero
**ese default nunca se aplica**: `new ValidationPipe()` (`main.ts:9`) corre sin
opciones y por tanto sin `transform`, así que el objeto de query llega crudo
(misma evidencia que la Decision A de US-2). Reproducido simulando el servicio
del mock con su `fuse` real:

```
parent=null  & search=type.slug:gadget       -> 10 filas  (las 10 raíces gadget)
parent=all   & search=type.slug:daily-needs  -> 53 filas  (8 raíces + 45 desc.)
parent=null  & search=type.slug:daily-needs  ->  8 filas
sin `parent`                                 -> 198 filas (¡el default NO aplica!)
```

La traducción string→semántica vive en **el servicio de Nest**, una sola línea,
con el comentario que explica por qué no es `parent !== 'all'`:

```ts
// El mock filtra raíces SOLO cuando el valor es exactamente el string
// 'null' (categories.service.ts:39 previo). Todo lo demás -incluido
// `undefined` (el default del DTO no se aplica: ValidationPipe no
// transforma) y el 'all' que manda la tienda cuando
// type.settings.layoutType === 'minimal'- devuelve la lista plana.
const rootsOnly = parent === 'null';
```

`ListCategoriesInput` gana `rootsOnly?: boolean` (default `true`, que preserva el
comportamiento actual del repositorio para cualquier llamador futuro); el
servicio siempre lo pasa explícito. Con `rootsOnly: false` cambia **solo qué
nodos van al top level**: el set completo ya está cargado y ensamblado, así que
el subárbol y la cadena ascendente de cada nodo son idénticos en los dos modos.

`parent='all'` no es hipotético: `apps/shop/src/framework/rest/home-pages.ssr.ts:118-121`
lo manda cuando `types.find(t => t.slug === pageType)?.settings.layoutType === 'minimal'`,
y `daily-needs` es el único type con ese layout — **la misma vertical que
contiene las 6 nietas** (53 categorías, `type_id 7`). De ahí que el `curl` con
`parent=all` sea obligatorio (R-3).

### Decisión E — `findCategoryByIdOrSlug`: una query, un ensamblador, una forma

```ts
/**
 * Detalle por id O por slug, con la MISMA forma que un elemento del
 * listado. Reproduce la precedencia del mock
 * (`p.id === Number(param) || p.slug === param`,
 * categories.service.ts:58-60): el id gana.
 */
export async function findCategoryByIdOrSlug(
  param: string
): Promise<CategoryTreeNode | null> {
  const nodes = _assembleTree(await _loadFlat());   // 198 filas, 1 query
  const asId = Number(param);
  if (Number.isInteger(asId)) {
    const byId = nodes.get(asId);
    if (byId) return byId;
  }
  for (const node of nodes.values()) {
    if (node.slug === param) return node;
  }
  return null;
}
```

| Opción | Trade-off | Decisión |
|---|---|---|
| Cargar la tabla completa y buscar en el `Map` ya ensamblado | 1 query, 1 camino de código: el detalle **no puede** discrepar del listado en la forma — que es justo la clase de bug que este change arregla | **Elegida** |
| `findFirst` para resolver `typeId` y luego cargar la vertical | 2 queries y una rama más, para ahorrar ~145 filas | Descartada |
| Mantener `findCategoryBySlug` + añadir `findCategoryById` | Dos funciones, dos formas que pueden divergir; el controller acepta ambos en un solo `:param` | Descartada (D-6) |

`findCategoryBySlug` desaparece. `git grep findCategoryBySlug` → dos
resultados: `packages/db/index.ts:31` y su propia definición
(`categories.repository.ts:105`). Ningún test ni servicio la usa: la firma es
libre. `Number('')` = 0 y `Number('0124')` = 124, exactamente como el mock;
`Number('dairy-2')` = `NaN` → `Number.isInteger` falso → rama de slug.

`getCategoryTree(typeSlug?)` **se conserva** (reimplementada sobre el
ensamblador, ~8 LOC): su único consumidor es el bloque de smoke de
`products.integration.test.ts:256-261`, que el proposal declara fuera de
alcance. Sus dos aserciones siguen siendo verdaderas con `CategoryTreeNode`
(`root.parentId === null` y `tree.some(r => r.children.length > 0)`) → R-4
mitigada sin reescribir el test.

### Decisión F — el mapper único de 16 claves (D-5 / V-2) y sus dos hermanos

Tres funciones privadas a nivel de módulo en `categories.service.ts`, ninguna
exportada, ningún archivo nuevo (D-10). El cast `as unknown as Category` va en
**una sola** de las tres —`toCategoryDto`, la que cruza el borde HTTP— porque es
la única cuyo tipo declarado es la entidad de Nest; las otras dos devuelven
literales sin tipo nominal y se consumen desde dentro del mismo módulo.
Precedente idéntico: `settings.service.ts:39` y `toProductDto`.

```ts
function toCategoryDto(node: CategoryTreeNode): Category {
  return {
    id: node.id,
    name: node.name,
    slug: node.slug,
    icon: node.icon,
    image: node.image,
    details: node.details,
    language: node.language,
    translated_languages: ['en'],          // constante: no hay columna (V-3)
    parent: node.parent ? toAncestorDto(node.parent) : null,
    type_id: node.typeId,
    created_at: node.createdAt,
    updated_at: node.updatedAt,
    deleted_at: null,                      // constante: no hay columna (V-3)
    parent_id: node.parentId,
    type: toEmbeddedType(node.type),
    children: node.children.map(toDescendantDto),
  } as unknown as Category;
}
```

Las 21 filas de `gadget`/`medicine` reciben **estas mismas 16 claves** en vez de
sus 13 (**V-2**, decidido por el usuario: uniformidad). El mapper **no se
ramifica por `type_id`**.

| Proyección | Claves, en orden | Diferencias respecto de `toCategoryDto` |
|---|---|---|
| `toAncestorDto(a: CategoryAncestor)` | 14: `id,name,slug,icon,image,details,language,translated_languages,parent,type_id,created_at,updated_at,deleted_at,parent_id` | sin `type`, sin `children`; `parent` recursivo (cadena completa) |
| `toDescendantDto(d: CategoryDescendant)` | 16: …`deleted_at,` **`products_count`**`, parent_id, children` | **sin `type`**; `products_count: 0` (V-1); `parent` = forma **E**; `children` recursivo |
| `toEmbeddedType(t: TypeRecord)` | 10: `id,name,language,translated_languages,settings,slug,icon,promotional_sliders,created_at,updated_at` | `translated_languages: ['en']` y `promotional_sliders: null` constantes; **`banners` NO se emite** aunque la columna existe (el mock no lo trae en el `type` embebido) |

La forma **E** (Decisión C) es el literal de las 16 claves de `toCategoryDto`
sobre el `CategoryRecord` plano, con `parent: null`, `type: null` y
`children: null` — los tres valores verificados en 115/115 nodos del mock.

Duplicación aceptada con US-4a: `toEmbeddedType` proyecta lo mismo que el mapper
de `/api/types` de US-4a. Extraer un helper compartido exige coordinar dos
changes en vuelo (el proposal ya lo cierra en Dependencies) y es refactor
especulativo hasta el tercer consumidor.

### Decisión G — el parseo de `search`, y por qué `name` SÍ se soporta

El mock trocea `search.split(';')` y por cada token hace
`data = fuse.search(value)` — **reasignando `data` desde cero**, así que solo el
**último** token surte efecto, y busca el *valor* difusamente sobre
`['name','type.slug']` sin mirar la clave (`categories.service.ts:31-38`).

Quién manda qué, verificado en el código de los dos frontends:

| Cliente | `search` que emite | `parent` | `limit` |
|---|---|---|---|
| Tienda (`framework/rest/client/index.ts:222-228`) | `type.slug:<v>` (un solo token) | `'null'` o `'all'` (`home-pages.ssr.ts:118-121`) | `1000` (`CATEGORIES_PER_PAGE`) |
| Admin — listado (`pages/categories/index.tsx:27-36`) | `type.slug:<v>`, `name:<v>`, o ambos (`http-client.ts:99-117` descarta valores falsy) | `null` de JS → axios lo omite → `undefined` | `20` |
| Admin — pickers (`category-form.tsx:107-112`, `product-category-input.tsx:30-33`) | `type.slug:<v>` | ausente | `999` |

Mapeo elegido:

| Token | Campo de `ListCategoriesInput` | Nota |
|---|---|---|
| `type.slug:v` | `typeSlug` | igualdad SQL exacta (V-4) |
| `name:v` | `name` → `contains` + `mode: 'insensitive'` | mismo patrón que `products.repository.ts:179-181` |
| cualquier otra clave | — | ignorada, como en US-2 |

**`name` se soporta a propósito**, aunque el "In Scope" del proposal solo nombre
`type.slug`: el admin manda ese token desde su caja de búsqueda hoy y funciona
(difusamente). Ignorarlo dejaría un filtro vivo devolviendo las 198 filas — una
**regresión**, no una divergencia declarable. Cuesta ~6 LOC en el repositorio y
1 línea en el parser. Va anotado en `risks` para que el usuario pueda vetarlo.

Consecuencia declarada (**V-10**): con los dos tokens a la vez el mock aplica
solo `name` (el último gana) y Postgres hace **AND real**. Es la misma familia
que la divergencia 9 de US-2 (`shop_id` + otro filtro): Postgres es más
restrictivo porque cumple el contrato.

Query params aceptados e **ignorados**, igual que hoy: `orderBy`, `sortedBy`,
`searchJoin`, `language`, y el `self` que el admin manda en el picker (ni
siquiera está declarado en el DTO). No se implementa ordenación:
`orderBy: { id: 'asc' }` es el orden del JSON del mock (verificado ascendente).
Nota: ordenar por `created_at` sería inútil de todos modos — las 198 filas
comparten el mismo timestamp (ver V-7).

### Decisión H — paginación y errores: cero invención

Paginación: `paginate()` local (`common/pagination/paginate.ts:4-75`), **no**
`buildPaginator()` de `packages/db` — ratificado en la Decision A de US-2 con la
evidencia del `ValidationPipe`. `limit` llega como **string** y `paginate()` lo
emite tal cual en `per_page`; `buildPaginator` lo tipa `number` y rompería
"mismos tipos" de CA-1. Se conservan **literales**:

```ts
if (!page) page = 1;                                          // línea 27 actual
const url = `/categories?search=${search}&limit=${limit}&parent=${parent}`;
return { data, ...paginate(total, page, limit, data.length, url) };
```

**MUST-NOT**: no añadir `if (!limit) limit = 15`. El mock no lo hace, y añadirlo
cambiaría la respuesta de una request sin `limit` (ver V-9). El troceo de la
página vive en el repositorio, después del ensamblaje, igual que el mock corta
después de filtrar.

Errores: `isPrismaConnectionError` → `ServiceUnavailableException` (503), resto →
`InternalServerErrorException` (500), ambos con `getUserFriendlyMessage`
(`packages/db/src/errors.ts:54` y `:229`). El listado copia el `try/catch` de
`getProducts` (`products.service.ts:197-210`), que envuelve la llamada + el
`map` + el `paginate` porque ahí no hay 404 que proteger. El detalle copia
`getProductBySlug` (`products.service.ts:213-230`): el `try` envuelve **solo** la
llamada de I/O y el `NotFoundException` se lanza **fuera**.

```ts
async getCategory(param: string, _language: string): Promise<Category> {
  let node: CategoryTreeNode | null;
  // El try envuelve SOLO la llamada al repositorio. El 404 de abajo queda
  // fuera a propósito: si se lanzara dentro, este catch lo convertiría en
  // un 500 (patrón de products.service.ts:213-230).
  try {
    node = await findCategoryByIdOrSlug(param);
  } catch (error) {
    if (isPrismaConnectionError(error)) {
      throw new ServiceUnavailableException(getUserFriendlyMessage(error));
    }
    throw new InternalServerErrorException(getUserFriendlyMessage(error));
  }
  if (!node) {
    throw new NotFoundException(`No existe una categoría \`${param}\`.`);
  }
  return toCategoryDto(node);
}
```

Ni `ExceptionFilter` global ni `pingDatabase()` previo (descartados en la
Decision D de US-2, sigue vigente).

## Divergencias aceptadas (actualiza la tabla del proposal)

| # | Divergencia | Alcance | Observabilidad | Motivo |
|---|---|---|---|---|
| V-1 | `products_count` = **0** (mock: 0-22, 114 nodos > 0) | los 121 nodos descendientes | **NINGUNA — corrección al proposal.** El único render, `apps/shop/src/components/ui/category-card.tsx:23-31`, es **rama muerta**: el ternario repite la MISMA condición (`item?.children?.length`) en las dos ramas, así que la de `products_count` es inalcanzable. `git grep products_count -- apps/admin/rest/src` no muestra ninguna columna de categorías | `category_product` vacía por diseño (0 filas) |
| V-2 | Las 21 raíces de `gadget`/`medicine` reciben 16 claves en vez de 13 | 21 de 198 nodos top-level | claves extra (`created_at`,`updated_at`,`deleted_at`,`parent_id`), orden distinto, `products_count` desaparece del top level | D-5, decidido por el usuario: uniformidad sobre ramificar el mapper por `type_id` |
| V-3 | `translated_languages`/`deleted_at`/`promotional_sliders` sin columna | todos los nodos | constantes `['en']`, `null`, `[]`→`null` | precedente US-2 (`in_flash_sale: 0`) |
| V-4 | Búsqueda `typeSlug` exacta vs. `fuse.js` difuso | todo `search` | orden y tolerancia a typos | R-2 del épico, ya aceptado |
| V-5 | Detalle inexistente: **404** en vez de 200 con cuerpo vacío | `/categories/<inexistente>` | `curl -i` | coherencia con `/products/:slug` (US-3) |
| **V-6** | **(nueva)** `parent` de un descendiente a profundidad 2: objeto **E** en vez del número `163` | **6** de 121 nodos anidados | comparando el tipo del valor | Decisión C: replicar el escalar exige un contador de profundidad |
| **V-7** | **(nueva, la más ancha)** `created_at`/`updated_at`: **valor y formato**. Postgres trae el timestamp del seed —`2026-08-25T13:49:30.609Z`, **idéntico en las 198 filas**— vs. las fechas 2021 por fila del mock; y `Date.toJSON()` emite 3 dígitos fraccionarios vs. los 6 de Laravel (`2021-03-08T07:21:31.000000Z`) | 4 claves × 198 nodos, más las copias ascendentes/descendientes y el `type` embebido | valor y string exactos | El `INSERT` del seed no incluye esas columnas (`db/generate-seed.mjs:166`), así que toman el `DEFAULT now()` del DDL. Precedente **ya en producción**: `/api/settings` publica `created_at: 2026-08-25…` desde la migración de settings (verificado hoy en la tabla `settings`). Corregirlo sería sembrar datos, fuera de alcance |
| **V-8** | **(nueva)** `image: []` → `null` | **101** de 198 nodos (mock `[]` = 101 ≡ Postgres `image IS NULL` = 101) | `image` pasa de `[]` a `null` | `db/generate-seed.mjs` guarda `NULL` cuando el mock traía `[]`. Idéntica a la divergencia 2 de US-2 |
| **V-9** | **(nueva)** request **sin `limit`**: el mock devuelve `data: []` (`slice(NaN,NaN)`), Postgres devuelve 15 items | ningún cliente real: tienda 1000, admin 20/999 | `count` 0→15 | mismo criterio que US-2 con `?page=abc`: no se añade una rama para un caso patológico. `per_page: undefined` y `last_page: null` salen idénticos en los dos |
| **V-10** | **(nueva)** `search=type.slug:x;name:y`: el mock aplica **solo `name`** (el último token reasigna `data`), Postgres hace **AND** | el admin cuando usa filtro de type **y** caja de búsqueda a la vez | menos filas en Postgres | familia de la divergencia 9 de US-2: Postgres cumple el contrato, el mock lo pierde |
| V-11 | (heredada) R-1/R-2 del épico: envoltorio de paginación estilo Laravel, ranking difuso | — | — | ya aceptadas |

**Consecuencia operativa de V-7 para CA-1**: el diff de paridad compara
**key-sets, orden de claves y tipos**, y compara **valores** de todo salvo
`created_at`/`updated_at`, que se reportan aparte. Un `diff` crudo de bytes daría
198 líneas de ruido y taparía las divergencias reales.

## Data Flow

    GET /api/categories?limit=1000&parent=all&search=type.slug:daily-needs
        │
        ▼  CategoriesController.findAll  (sin cambios, :25-28)
    CategoriesService.getCategories(query)              ← pasa a async
        │  rootsOnly = (parent === 'null')      → false
        │  parseCategorySearch(search)          → { typeSlug: 'daily-needs' }
        ▼
    listCategories({ typeSlug, rootsOnly, page, limit })   @safari/db
        │  findMany({ where:{type:{slug}}, include:{type:true},
        │             orderBy:{id:'asc'} })  ── Prisma ──→ :5433   53 filas
        │  _assembleTree(rows)  ── O(n), memoizado, sin límite de profundidad
        │      recs / types / kids  →  descend() ↓   ascend() ↑
        │  top = rootsOnly ? raíces : todos      → 53 nodos
        │  { items: top.slice((page-1)*limit, page*limit), total: top.length }
        ▼
    items.map(toCategoryDto)                            ← 16 claves snake_case
        │      · parent   → toAncestorDto   (14 claves, cadena completa)
        │      · children → toDescendantDto (16 claves, recursivo, sin `type`)
        │      · type     → toEmbeddedType  (10 claves)
        ▼
    { data, ...paginate(total, page, limit, data.length, url) }


    GET /api/categories/dairy-2   (o /124)
        │
        ▼  CategoriesController.findOne (sin cambios, :30-33)
    CategoriesService.getCategory(param, language)      ← pasa a async
        ├── try ──→ findCategoryByIdOrSlug(param)   1 query + mismo ensamblador
        │           catch → 503 (conexión) | 500 (resto)
        ├── node === null ──→ NotFoundException (404)   ← FUERA del try
        ▼  toCategoryDto(node)                          ← 16 claves, sin envoltorio

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/db/src/repositories/categories.repository.ts` | Modify (reescritura) | Comentario de cabecera corregido (D-3); `CATEGORY_INCLUDE` → `{ type: true }`; `CategoryWithChildren` → `CategoryAncestor`/`CategoryDescendant`/`CategoryTreeNode`; `_assembleTree` + `descend`/`ascend`/`_immediate`; `ListCategoriesInput.rootsOnly`+`name`; `getCategoryTree` reimplementada; `findCategoryBySlug` → `findCategoryByIdOrSlug` |
| `packages/db/index.ts` | Modify | **rebasa sobre US-4a.** Bloque `categories` (líneas 26-34): exportar los 3 tipos nuevos + `findCategoryByIdOrSlug`; quitar `CategoryWithChildren` y `findCategoryBySlug` |
| `packages/db/src/repositories/categories.integration.test.ts` | **Create** | suite nueva (~95 líneas), patrón de `products.integration.test.ts` |
| `db/schema.sql` líneas **133-135** | Modify | **solo el comentario** (D-3). Sin DDL nuevo → **sin `just db-reset`** |
| `apps/api/rest/src/categories/categories.service.ts` | Modify | `getCategories`/`getCategory` async + `parseCategorySearch` + `toCategoryDto`/`toAncestorDto`/`toDescendantDto`/`toEmbeddedType` + `try/catch` + imports. `create`/`update`/`remove`, `categoriesJson`, `plainToClass` y `fuse` **intactos** |
| `apps/api/rest/src/categories/categories.controller.ts` | Sin cambios | `findAll`/`findOne` (:25-33) no tipan el retorno |
| `apps/api/rest/src/categories/dto/get-categories.dto.ts` | Sin cambios | `parent?: number \| string = 'null'` se conserva **tal cual**, aunque el default no se aplique: quitarlo cambiaría la firma pública del DTO y Swagger sin necesidad |
| `apps/api/rest/src/categories/entities/category.entity.ts` | Sin cambios | ya declara `parent?`, `children?`, `type?` (:9-14); el cast `as unknown as Category` cubre el resto |
| `openspec/changes/2026-08-26-categorias-arbol-postgres/mock-categories-*.json` | Create | 3 líneas base capturadas ANTES de tocar código |
| `docs/product/1-catalogo-desde-postgres/4b-categorias-arbol-postgres.md` | **Create** | documento de US-4b |
| `docs/product/1-catalogo-desde-postgres/4-migrar-catalogos-apoyo.md`, `README.md` del épico | **PROHIBIDO tocar** | los cierra US-4a (frontera documental del proposal) |
| `packages/db/prisma/schema.prisma` | Sin cambios | `parent`/`children` (relación `CategoryTree`) y `parentId` ya están introspectados (:91, :97-98) |

## Interfaces / Contracts — las 16 claves del nodo top-level

Orden verificado idéntico en 177/198 filas del mock (las otras 21 son V-2).

| # | Clave (API) | Origen | Tipo emitido |
|---|---|---|---|
| 1 | `id` | `node.id` (`_id`: BigInt→number) | number |
| 2 | `name` | `node.name` | string |
| 3 | `slug` | `node.slug` | string |
| 4 | `icon` | `node.icon` | string \| null (143 null / 55 no-null, coincide con el mock) |
| 5 | `image` | `node.image` (jsonb tal cual) | object \| null (V-8) |
| 6 | `details` | `node.details` | string \| null (190 null) |
| 7 | `language` | `node.language` | string (`'en'` en 198/198) |
| 8 | `translated_languages` | **constante `['en']`** | string[] |
| 9 | `parent` | `toAncestorDto(node.parent)` \| `null` | object \| null |
| 10 | `type_id` | `node.typeId` | number |
| 11 | `created_at` | `node.createdAt` (`Date`) | string ISO (V-7) |
| 12 | `updated_at` | `node.updatedAt` (`Date`) | string ISO (V-7) |
| 13 | `deleted_at` | **constante `null`** | null |
| 14 | `parent_id` | `node.parentId` | number \| null |
| 15 | `type` | `toEmbeddedType(node.type)` | object (10 claves) |
| 16 | `children` | `node.children.map(toDescendantDto)` | object[] (16 claves cada uno) |

`_id` (`packages/db/src/records.ts:35-39`) deja el record JSON-safe: ni `BigInt`
ni `Decimal` llegan al borde HTTP. `packages/db` compila con `strict: true`
(`packages/db/tsconfig.json`), así que el ensamblador no puede usar `!`
(`biome.json`: `noNonNullAssertion: warn`) — de ahí los `const x = map.get(id);
if (!x) …` explícitos de la Decisión A.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Integración (`packages/db`) | árbol de profundidad 3, conteos, `rootsOnly`, id≡slug, aciclidad | **suite nueva** `categories.integration.test.ts`; gate `just db-check` |
| Unit (`apps/api/rest`) | — | `apps/api/rest` no tiene ningún `*.spec.ts` para categories y `strict_tdd: false`; **no se crea runner nuevo** (fuera del "Incluye"). El servicio se verifica por `curl` |
| E2E manual | CA-1, CA-2, CA-4 | `curl` + `node -e` (`jq` NO instalado) |

### `packages/db/src/repositories/categories.integration.test.ts`

Cabecera con el mismo tono que `products.integration.test.ts:1-7` y **solo
lectura** (no escribe ninguna fila, así que no necesita `afterAll` de limpieza —
sí `prisma.$disconnect()`).

| # | `describe` / `it` | Aserción central |
|---|---|---|
| 1 | `listCategories` · conteos del seed | `rootsOnly: true` → `total === 83`; `rootsOnly: false` → `total === 198` (**la aserción de D-4**) |
| 2 | `listCategories` · **profundidad 3 explícita** | `rootsOnly:false, typeSlug:'daily-needs'` → `total === 53`; el nodo `124` tiene `children` ids `[163,164]`; el `163` **anidado dentro de 124** tiene `children` ids `[169,170]`; el `169` anidado trae `slug === 'brown-eggs'`, `icon` e `image` propios. **Este es el test que habría cazado el bug** |
| 3 | `listCategories` · no hay bisnietos | recorrido recursivo de los 83 subárboles: profundidad máxima **2**, y la suma de nodos únicos visitados = 198 |
| 4 | `listCategories` · cadena ascendente (D-2) | nodo top-level `169`: `parent.id === 163`, `parent.parent.id === 124`, `parent.parent.parent === null`; y `'children' in node.parent === false` (la aciclidad por tipo, comprobada en runtime) |
| 5 | `listCategories` · **aciclidad** (R-1) | `expect(() => JSON.stringify(items)).not.toThrow()` sobre el listado completo sin paginar |
| 6 | `listCategories` · `typeSlug` + paginación | `typeSlug:'gadget'` → `total === 10` con `rootsOnly` en cualquier valor (las 10 son raíces hoja); `page:2, limit:50, rootsOnly:false` sobre `daily-needs` → 3 items y sin ids repetidos con la página 1 |
| 7 | `listCategories` · `name` (Decisión G) | `name:'egg'` case-insensitive → `total > 0` y todo item con `'egg'` en `name.toLowerCase()` |
| 8 | `findCategoryByIdOrSlug` · id ≡ slug | `findCategoryByIdOrSlug('124')` y `('dairy-2')` devuelven el **mismo** `id` y el mismo árbol (`JSON.stringify` de ambos igual) |
| 9 | `findCategoryByIdOrSlug` · nieta por slug | `('brown-eggs')` → `id 169`, `parentId 163`, `parent.parent.id === 124` |
| 10 | `findCategoryByIdOrSlug` · ausente | `('no-existe-ni-existira')` → `null` (es lo que dispara el 404 del servicio) |
| 11 | `getCategoryTree` · compatibilidad (R-4) | 83 raíces, todas con `parentId === null`, y `tree.some(r => r.children.length > 0)` — las mismas dos aserciones que el smoke de `products.integration.test.ts:256-261`, que **no se toca** |

Ningún número mágico sin origen: 198/83/109/6/53/10 salen de la consulta
`WITH RECURSIVE` y del `GROUP BY type_id` pegados arriba en este documento.

## Verification Plan

Precondiciones: `just db-up` (contenedor `safari-postgres` up y healthy, puerto
5433), API en el puerto **9001** (el 9000 lo ocupa Zscaler), `jq` **NO
instalado** → todo diff con `node -e`, `psql` **NO en el PATH** → SQL vía
`docker exec`.

```bash
CH=openspec/changes/2026-08-26-categorias-arbol-postgres

# ── PASO 0: LÍNEA BASE DEL MOCK, antes de tocar una sola línea de código ──
# Requiere `just api-dev` con el servicio todavía en mock.
curl -s "http://localhost:9001/api/categories?limit=1000&parent=null&search=type.slug:gadget"      > $CH/mock-cat-gadget.json
curl -s "http://localhost:9001/api/categories?limit=1000&parent=all&search=type.slug:daily-needs"  > $CH/mock-cat-daily.json
curl -s "http://localhost:9001/api/categories/dairy-2"                                             > $CH/mock-cat-dairy2.json

# Vía 2, SIN servidor (reproducible siempre; usar si el paso 0 se perdió).
# Replica getCategories del mock, incluido su fuse real.
node -e "
const Fuse=require('./apps/api/rest/node_modules/fuse.js');
const cats=require('./apps/api/rest/src/db/pickbazar/categories.json');
const fuse=new Fuse(cats,{keys:['name','type.slug'],threshold:0.3});
const fs=require('fs');
const APP='http://localhost:5000/api';
function pag(t,p,ps,c,u){const tp=Math.ceil(t/ps);if(p<1)p=1;else if(p>tp)p=tp;
 const si=(p-1)*ps;return{total:t,current_page:+p,count:c,last_page:tp,
 firstItem:si,lastItem:Math.min(si+ps-1,t-1),per_page:ps,
 first_page_url:APP+u+'&page=1',last_page_url:APP+u+'&page='+tp,
 next_page_url:tp>p?APP+u+'&page='+(Number(p)+1):null,
 prev_page_url:tp>p?APP+u+'&page='+p:null};}
function get({limit,page,search,parent}){ if(!page)page=1;
 let d=cats; if(search)for(const t of search.split(';')){const [,v]=t.split(':');
   d=fuse.search(v)?.map(({item})=>item);}
 if(parent==='null')d=d.filter(i=>i.parent===null);
 const r=d.slice((page-1)*limit,page*limit);
 const u='/categories?search='+search+'&limit='+limit+'&parent='+parent;
 return {data:r,...pag(d.length,page,limit,r.length,u)};}
fs.writeFileSync('$CH/mock-cat-gadget.json',JSON.stringify(get({limit:1000,page:1,search:'type.slug:gadget',parent:'null'})));
fs.writeFileSync('$CH/mock-cat-daily.json', JSON.stringify(get({limit:1000,page:1,search:'type.slug:daily-needs',parent:'all'})));
fs.writeFileSync('$CH/mock-cat-dairy2.json',JSON.stringify(cats.find(c=>c.id===124||c.slug==='dairy-2')));
"
# Esperado: gadget total 10 · daily total 53 · dairy2 id 124.

# ── PASO 1: gate de la capa de datos ──
just db-check            # typecheck + vitest; la suite nueva incluida
# Inner loop mientras se itera: cd packages/db && npm test -- categories

# ── PASO 2: OBLIGATORIO tras tocar packages/db ──
just db-build            # dist/ esta gitignored y Nest lo consume via `link:`.
                         # Sin este paso la API sigue ejecutando el include
                         # viejo y la evidencia sale mal SIN MOTIVO APARENTE
                         # (leccion del paso 5 de US-3, R-5).
just build-api           # o reiniciar `just api-dev`

# ── CA-1: paridad de contrato (mock vs. Postgres) ──
curl -s "http://localhost:9001/api/categories?limit=1000&parent=null&search=type.slug:gadget"     > $CH/pg-cat-gadget.json
curl -s "http://localhost:9001/api/categories?limit=1000&parent=all&search=type.slug:daily-needs" > $CH/pg-cat-daily.json
node -e "
const fs=require('fs'),d=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const FECHAS=new Set(['created_at','updated_at']);   // V-7: se reportan aparte
function cmp(tag,a,b){
  const ka=Object.keys(a),kb=Object.keys(b);
  const env=k=>JSON.stringify(Object.fromEntries(Object.entries(k).filter(([x])=>x!=='data')));
  console.log(tag,'| envoltorio igual:', env(a)===env(b));
  console.log(tag,'| n:',a.data.length,'->',b.data.length,
              '| ids iguales:', JSON.stringify(a.data.map(x=>x.id))===JSON.stringify(b.data.map(x=>x.id)));
  const sa=[...new Set(a.data.map(x=>JSON.stringify(Object.keys(x))))];
  const sb=[...new Set(b.data.map(x=>JSON.stringify(Object.keys(x))))];
  console.log(tag,'| key-sets mock:',sa.length,'-> pg:',sb.length);
  console.log(tag,'| key-set pg:',sb[0]);
  let dif=0; const walk=(x,y,ruta)=>{
    if(typeof x!=='object'||x===null||typeof y!=='object'||y===null){
      if(JSON.stringify(x)!==JSON.stringify(y)){dif++; if(dif<6)console.log('   dif',ruta,JSON.stringify(x),'->',JSON.stringify(y));}
      return;}
    for(const k of new Set([...Object.keys(x),...Object.keys(y)])){
      if(FECHAS.has(k))continue; walk(x[k],y[k],ruta+'.'+k);}};
  a.data.forEach((x,i)=>walk(x,b.data[i],'#'+i));
  console.log(tag,'| difs de valor (excluyendo fechas V-7):',dif);
}
cmp('gadget', d('$CH/mock-cat-gadget.json'), d('$CH/pg-cat-gadget.json'));
cmp('daily ', d('$CH/mock-cat-daily.json'),  d('$CH/pg-cat-daily.json'));
"
# Esperado: envoltorio igual true · gadget 10->10 · daily 53->53 · ids iguales
# true · key-sets mock 2 -> pg 1 (V-2 en gadget: 13 claves -> 16) · las difs de
# valor deben caer TODAS en V-1 (products_count), V-2, V-6 o V-8 (image [] ->
# null). Cualquier otra ruta es un defecto, no una divergencia.

# ── CA-2: el árbol completo sobrevive anidado (el corazón del change) ──
node -e "
const b=require('./$CH/pg-cat-daily.json');
console.log('n top-level:', b.data.length);
const r124=b.data.find(x=>x.id===124);
const n163=r124.children.find(y=>y.id===163);
console.log('124 ->', r124.children.map(y=>y.id).join(','));
console.log('163 ->', n163.children.map(y=>y.id).join(','));
for(const g of n163.children)
  console.log('  nieta', g.id, g.slug, '| icon', JSON.stringify(g.icon),
              '| image?', g.image!==undefined, '| claves', Object.keys(g).length);
const t169=b.data.find(x=>x.id===169);
console.log('cadena de 169:', (function(){let o=[],p=t169.parent;while(p){o.push(p.id);p=p.parent;}return o.join('->');})());
console.log('JSON.stringify no lanza:', (()=>{try{JSON.stringify(b);return true}catch(e){return e.message}})());
"
# Esperado: 53 · 124 -> 163,164 · 163 -> 169,170 · dos nietas con 16 claves
# cada una · cadena de 169: 163->124 · JSON.stringify no lanza true.

# ── CA-2b: el detalle por id y por slug dan lo MISMO ──
curl -s http://localhost:9001/api/categories/dairy-2 > $CH/pg-cat-dairy2.json
curl -s http://localhost:9001/api/categories/124     > $CH/pg-cat-124.json
node -e "
const fs=require('fs'),d=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const a=d('$CH/pg-cat-dairy2.json'), b=d('$CH/pg-cat-124.json'), m=d('$CH/mock-cat-dairy2.json');
console.log('id==slug:', JSON.stringify(a)===JSON.stringify(b));
console.log('claves mock:', Object.keys(m).length, '-> pg:', Object.keys(a).length,
            '| mismo orden:', JSON.stringify(Object.keys(m))===JSON.stringify(Object.keys(a)));
"

# ── CA-2c: 404 de dominio + el proceso Nest sigue vivo (V-5) ──
curl -i -s http://localhost:9001/api/categories/no-existe-xyz | head -1
curl -s http://localhost:9001/api/categories/no-existe-xyz
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:9001/api/types   # 200

# ── CA-4: la tienda navega (modo DEV, no build: ver nota) ──
# El catch-all `apps/shop/src/pages/[[...pages]].tsx` prerenderiza una ruta
# por type.slug (getStaticPaths, home-pages.ssr.ts:27-42), asi que
# /en/daily-needs es EXACTAMENTE la pagina del layout `minimal` -> la unica
# que manda parent='all' y la unica vertical con nietas. Es la prueba de R-3.
just shop-dev            # en otra terminal
just verify              # los 3 servicios + conteo de product-card
curl -s -w '\n%{http_code}\n' http://localhost:3003/en/daily-needs | grep -c 'Dairy'
curl -s -w '\n%{http_code}\n' http://localhost:3003/en/grocery     | grep -c 'Vegetables'

# ── 503 con la base caída ──
just db-down
curl -s -o /tmp/body.json -w '%{http_code}\n' "http://localhost:9001/api/categories?limit=20&parent=null"
cat /tmp/body.json      # {"statusCode":503,"message":"No se puede conectar…"}
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:9001/api/types   # 200 -> proceso vivo
just db-up

# ── D-3: los dos comentarios dicen la verdad, y la verdad es verificable ──
docker exec -e PGPASSWORD=safari safari-postgres psql -h localhost -U safari \
  -d safari_scraper -c "WITH RECURSIVE d AS (
  SELECT id,parent_id,0 AS nivel FROM categories WHERE parent_id IS NULL
  UNION ALL SELECT c.id,c.parent_id,d.nivel+1 FROM categories c JOIN d ON c.parent_id=d.id)
  SELECT nivel,count(*) FROM d GROUP BY nivel ORDER BY nivel;"
# Esperado: 0|83  1|109  2|6   <- exactamente lo que debe decir el comentario
grep -n "nietas\|nietos" packages/db/src/repositories/categories.repository.ts db/schema.sql
```

**CA-4 en modo dev y no con `just build`**: misma razón que en US-3 — las
páginas de la tienda usan ISR (`getStaticProps` + `revalidate`), así que un
`build` prerenderiza el HTML y una API caída quedaría enmascarada. Con
`just shop-dev` el data fetching corre en cada request, así que un 200 **con el
nombre de una categoría en el HTML** prueba de verdad que el shop habló con la
API contra Postgres.

### Los dos comentarios corregidos (D-3) — texto exacto

`db/schema.sql` líneas 133-135 (hoy: *"En el mock hay 198 categorías: 83 raíces
y 115 hijas (2 niveles reales)."*) →

```sql
-- ---------------------------------------------------------------------
-- categories — taxonomía de navegación, jerárquica por adyacencia.
--
-- 198 categorías en TRES niveles, no dos: 83 raíces + 109 hijas + 6
-- NIETAS. Las nietas son 165,166,167,168 (bajo 164 "Dairy") y 169,170
-- (bajo 163 "Eggs"); 163 y 164 cuelgan de la raíz 124 "Dairy & Eggs",
-- toda la rama en type_id 7 (daily-needs). Profundidad máxima = 2
-- saltos; 0 bisnietos. Medido con WITH RECURSIVE contra esta misma
-- base, no leyendo el seed (el comentario anterior decía "2 niveles
-- reales" y por eso packages/db perdía esas 6 filas — ver US-4b).
-- ON DELETE SET NULL para que borrar una madre no arrastre a las hijas.
-- El CHECK de abajo prohíbe la autorreferencia, pero NO un ciclo
-- A->B->A: quien recorra el árbol necesita su propia guarda.
-- ---------------------------------------------------------------------
```

`packages/db/src/repositories/categories.repository.ts` líneas 1-7 (hoy:
*"jerarquía de 2 niveles por adyacencia: 83 raíces, 115 hijas en el seed"*) →

```ts
/**
 * categories.repository.ts — taxonomía de navegación por adyacencia.
 *
 * 198 categorías en TRES niveles: 83 raíces + 109 hijas + 6 NIETAS
 * (165-168 bajo 164, y 169,170 bajo 163; 163/164 bajo la raíz 124,
 * todo en type_id 7 = daily-needs). Profundidad máxima 2 saltos, 0
 * bisnietos — verificado con WITH RECURSIVE contra la base real.
 *
 * El comentario anterior decía "2 niveles reales" y ese error se
 * materializó en un `include` de un solo nivel que borraba esas 6
 * filas del payload. Por eso el árbol NO se arma con `include`: se
 * arma con _assembleTree() sobre una findMany() plana, que no tiene
 * ninguna constante de profundidad. Si mañana hay un 4º nivel, esto
 * sigue funcionando y ningún comentario se vuelve mentira.
 */
```

## Secuencia de trabajo (orden obligatorio)

1. **Capturar las 3 líneas base del mock** con la API todavía en mock (o la vía
   `node -e` sin servidor). Antes de cualquier edición.
2. `just db-up`.
3. **Rebasar sobre US-4a** si ya cerró: `packages/db/index.ts` es el único
   archivo compartido. Si US-4a no cerró todavía, editar el bloque `categories`
   (líneas 26-34) y nada más, para que el rebase sea trivial.
4. `packages/db`: tipos + `_assembleTree` + las 3 funciones + comentario.
5. `db/schema.sql`: solo el comentario de las líneas 133-135.
6. Suite de integración nueva; `just db-check` en verde.
7. **`just db-build`** (R-5: sin esto la API sigue con el `include` viejo).
8. `apps/api/rest`: mappers + servicio + imports. `just build-api`.
9. CA-1 → CA-2c → 503.
10. `just shop-dev` + `just verify` (CA-4).
11. `docs/product/1-catalogo-desde-postgres/4b-categorias-arbol-postgres.md`.
    **NO tocar `4-migrar-catalogos-apoyo.md` ni el README del épico.**

## Presupuesto de revisión — el diseño SUPERA las 400 líneas

Reestimación por archivo, ya con las formas y los mappers concretos de este
documento (el proposal estimaba ~395 sin conocer las proyecciones **E**, `A'`
del `type` embebido, ni el soporte de `name`):

| Archivo | + | − | Total |
|---|---|---|---|
| `categories.repository.ts` (113 líneas hoy → ~175) | ~150 | ~90 | **~240** |
| `categories.service.ts` (70 líneas hoy → ~180) | ~130 | ~35 | **~165** |
| `categories.integration.test.ts` (nuevo) | ~95 | 0 | **~95** |
| `packages/db/index.ts` | ~4 | ~3 | ~7 |
| `db/schema.sql` (comentario) | ~11 | ~3 | ~14 |
| `docs/product/…/4b-….md` (nuevo) | ~50 | 0 | ~50 |
| | | | **~571** |

**400-line budget risk: High.** La subida frente al proposal viene de tres
sitios concretos, todos descubiertos verificando: (a) el ensamblador con memo +
guarda de ciclo y **tres** tipos públicos en vez de uno (~+60), (b) **cuatro**
proyecciones de mapper en vez de dos, con `toEmbeddedType` incluido (~+45), y
(c) las 5 aserciones extra que las divergencias nuevas V-6…V-10 obligan a cubrir
(~+30).

**Costura obligatoria: 2 PRs encadenados** (la que el proposal ya recomienda),
ambos autónomos, verificables y reversibles por separado:

| PR | Contenido | LOC | Cierra con |
|---|---|---|---|
| **#1** | `categories.repository.ts` + `packages/db/index.ts` + comentario de `db/schema.sql` + suite de integración | **~356** | `just db-check` en verde con la aserción de profundidad 3 y la de aciclidad. **Cero cambios de contrato HTTP**: la API sigue en mock, así que este PR no puede romper la tienda |
| **#2** | `categories.service.ts` + doc de la US | **~215** | `curl` mock-vs-Postgres (CA-1/CA-2), 404, 503 y `just verify` |

PR#2 apunta a la rama de PR#1 (Feature Branch Chain, `sdd-phase-common.md` §E).
`sdd-tasks` debe emitir el desglose con esta costura ya aplicada y
`Decision needed before apply: No` (la costura está decidida aquí).

## Migration / Rollout

Sin migración de datos, sin feature flag, sin cambio de DDL (`db/schema.sql`
solo cambia un comentario → **no hace falta `just db-reset`**).

- **Rollback total**: `git revert` de los commits + `just db-build && just build-api`.
  `categoriesJson`/`plainToClass`/`fuse` nunca se quitaron (los usan
  `create`/`update`/`remove`), así que el revert no reinstala nada.
- **Rollback parcial A** (falla solo el endpoint): revertir PR#2 y dejar PR#1.
  La capa de datos queda correcta, la API vuelve al mock. Ningún consumidor
  externo depende de las firmas (verificado con `git grep`).
- **Rollback parcial B** (falla el ensamblaje): revertir PR#1 completo. Volver a
  `CATEGORY_INCLUDE` con `children` es restaurar la constante y el mapper viejo;
  las 6 nietas vuelven a desaparecer y la divergencia se re-declara.
- **Irreversible**: nada.

## Open Questions

Ninguna bloqueante. Tres puntos que el implementador debe **declarar**, no
resolver:

- **Decisión G** (soporte de `name`) es la única ampliación de alcance frente al
  "In Scope" del proposal, con su justificación arriba. Si el usuario la veta,
  se quita el campo `name` de `ListCategoriesInput` (~−7 LOC) y **V-10 se
  reemplaza** por una divergencia nueva: "la caja de búsqueda del listado de
  categorías del admin deja de filtrar". Es una regresión visible; se recomienda
  no vetarla.
- **V-7** (fechas del seed) es la divergencia más ancha del change y **ya existe
  en producción** vía `/api/settings`. La afirmación de `CLAUDE.md` de que
  `/api/settings` es byte a byte idéntico al mock ("5503 bytes idénticos") no se
  sostiene para `created_at`/`updated_at`; corregir esa frase es de otra US y
  **no se toca aquí**.
- La numeración `4a`/`4b` no está prevista en `docs/product/README.md`; enmendar
  la convención es de **US-4a** (dueña de la tabla del épico).
