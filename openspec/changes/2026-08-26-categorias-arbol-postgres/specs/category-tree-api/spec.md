# Category Tree API Specification

## Purpose

`GET /api/categories` y `GET /api/categories/:param` leen `categories` en
Postgres vía `@safari/db` en vez de `categories.json`, reconstruyendo el
árbol a profundidad arbitraria (hoy 3 niveles reales, no 2) y preservando el
contrato HTTP salvo divergencias declaradas.

## Requirements

### Requirement: Árbol reconstruido a profundidad arbitraria (D-1) (CA-2)

El repositorio MUST traer las 198 filas con un único `findMany()` sin
`include` anidado y ensamblar el árbol en memoria agrupando por `parentId`,
de forma recursiva y sin límite de profundidad fijo.

#### Scenario: La cadena de nietos sobrevive el round trip (CA-2)
- GIVEN la base sembrada con `just db-up`
- WHEN pido el árbol de categorías
- THEN la raíz `124` trae `163` en `children`, y `163` trae `169` y `170` en
  su propio `children`, cada uno con `image`/`icon`/`slug` propios
- AND los conteos son 198 total, 83 raíces, 115 descendientes, 6 nietos

### Requirement: Cadena ascendente `parent` sin ciclos (D-2)

Cada nodo descendiente MUST llevar `parent` con la cadena ascendente
completa (el nodo padre, y el `parent` de ese padre, hasta `null`). Los
nodos ascendentes MUST NOT llevar `children` ni `type` — son una proyección
distinta a los nodos descendientes, para que la estructura no sea circular.

#### Scenario: Serialización segura
- GIVEN el árbol completo reconstruido
- WHEN corro `JSON.stringify(tree)`
- THEN no lanza `TypeError` de estructura circular
- AND `169.parent.parent` es el objeto completo de la raíz `124` con
  `parent: null`, y ese objeto `124` no tiene `children` embebido

### Requirement: Semántica de `parent` — raíces vs. listado plano (D-4)

Solo con `parent='null'` literal el listado MUST devolver las 83 raíces
(cada una con su subárbol anidado). Sin `parent`, con `parent='all'` o con
cualquier otro valor, MUST devolver los 198 nodos planos en el nivel
superior, cada uno con su propio subárbol.

> El default `parent='null'` que declara `GetCategoriesDto` **nunca se
> aplica**: `main.ts:9` instancia `new ValidationPipe()` sin `transform`, así
> que una petición sin `parent` llega con `parent === undefined` y el filtro
> de raíces no dispara. El mock hacía exactamente lo mismo
> (`if (parent === 'null')`, ver `git show be778be^`), así que devolver 198 es
> paridad de contrato, no un defecto. Una versión anterior de esta requirement
> afirmaba 83 para el caso sin `parent`; `sdd-verify` la refutó contra el
> endpoint real y se corrigió aquí.

#### Scenario: `parent=null` — solo raíces
- GIVEN `GET /api/categories?limit=1000&parent=null`
- WHEN el endpoint responde
- THEN `data` tiene 83 elementos, todos con `parent_id` nulo

#### Scenario: Sin `parent` — listado plano de 198
- GIVEN `GET /api/categories?limit=1000` sin el parámetro `parent`
- WHEN el endpoint responde
- THEN `data` tiene 198 elementos, igual que hacía el mock

#### Scenario: `parent=all` no rompe la home de `daily-needs`
- GIVEN `GET /api/categories?parent=all&search=type.slug:daily-needs`
- WHEN el endpoint responde
- THEN `data` trae los 198 nodos planos (filtrados a la vertical si aplica)
- AND `just verify` con el shop en modo `minimal` sigue en 200

### Requirement: Filtro por vertical `search=type.slug:<slug>`

El endpoint MUST aceptar `search=type.slug:<slug>` y traducirlo a un filtro
SQL exacto por `typeId`, reemplazando el `fuse.js` difuso del mock.

#### Scenario: Filtro por type
- GIVEN `search=type.slug:gadget`
- WHEN el endpoint responde
- THEN todas las categorías de `data` pertenecen al type `gadget`

### Requirement: Detalle por id o slug (D-6)

`GET /api/categories/:param` MUST resolver `param` como id numérico o como
slug mediante una única función `findCategoryByIdOrSlug`.

#### Scenario: Mismo resultado por id o por slug
- GIVEN una categoría con id `124` y slug `dairy-2`
- WHEN pido `/api/categories/124` y `/api/categories/dairy-2`
- THEN ambas respuestas son el mismo objeto

### Requirement: 404 para categoría inexistente (D-7)

Un `param` sin coincidencia MUST responder HTTP 404 (`NotFoundException`),
divergiendo del mock (200 con cuerpo vacío) por coherencia con
`product-detail-api`.

#### Scenario: Slug inexistente
- GIVEN la API contra la base sembrada
- WHEN pido `curl -i GET /api/categories/no-existe-xyz`
- THEN recibo 404 y el proceso Nest sigue vivo

### Requirement: Errores de conexión a Postgres (D-8)

Si Prisma no puede conectar, el endpoint MUST responder 503 vía
`getUserFriendlyMessage()` (`isPrismaConnectionError`); cualquier otro error
no controlado MUST responder 500 con el mismo helper.

#### Scenario: Postgres caído
- GIVEN `just db-down`
- WHEN pido `GET /api/categories`
- THEN recibo 503 con `{statusCode, message, error}` legibles

### Requirement: Key-set uniforme de 16 claves — divergencia declarada (D-5)

Todos los nodos top-level MUST emitir el mismo conjunto de 16 claves,
incluidas las 21 raíces de `type_id 9` (gadget) y `type_id 11` (medicine)
que el mock sirve con una variante de 13 claves en otro orden
(`products_count: null`, sin `created_at`/`updated_at`/`deleted_at`/
`parent_id`). Esto diverge deliberadamente del CA-1 literal ("mismas
claves") del épico; se ratifica emitir uniformidad sobre ramificar el
mapper por id.

#### Scenario: Las 21 raíces de gadget/medicine ahora con 16 claves
- GIVEN una raíz de `type_id 9` o `type_id 11` (13 claves en el mock)
- WHEN la sirvo desde Postgres
- THEN trae las mismas 16 claves que cualquier otra raíz, incluidas
  `created_at`, `updated_at`, `deleted_at`, `parent_id`

### Requirement: `products_count` constante en 0 — divergencia declarada (V-1)

`products_count` MUST ser `0` en todo nodo **descendiente** (los que lo
llevan), porque `category_product` está vacía por diseño (fuera de alcance
de este change). Los 198 nodos de nivel superior NO llevan la clave, igual
que el mock.

#### Scenario: products_count siempre 0 en descendientes
- GIVEN un nodo descendiente cualquiera (p. ej. `169`)
- WHEN leo `products_count`
- THEN el valor es `0`, aunque el mock traiga valores 0-22 en descendientes
- AND los nodos de nivel superior no traen la clave, como en el mock

### Requirement: Divergencias del objeto `type` embebido — declaradas

El `type` embebido MUST servirse desde la fila canónica de `types` en
Postgres, no desde la copia que `categories.json` tenía embebida. Estas
diferencias se aceptan y se declaran:

| Campo | Divergencia | Alcance | Ref. |
|---|---|---|---|
| `type.settings` | La copia del mock estaba obsoleta: 49 nodos de `type_id 1` pasan `isHome true→false` y `productCard "neon"→"helium"`; 8 de `type_id 8` ganan 7 claves | 57 de 198 nodos | V-11 |
| `type.banners` | No se emite (el mapper de `type` embebido publica 10 claves fijas); el mock sí lo traía en gadget/medicine | 21 nodos | V-12 |

> Ambas las levantó `sdd-verify`, no el diseño. Sin impacto de consumidor
> medido: toda lectura de `type.settings`/`type.banners` en el frontend viene
> de `/api/types` o de `product.type`, no de `category.type`. Es el análogo
> directo de la V-25 (`tags.image`) de US-4a: dato del seed/canónico, no del
> mapper.

Las divergencias V-3/V-6/V-7/V-8/V-9/V-10 que `design.md` documenta
(`image: []`→`null` en 101 nodos, el `parent` escalar en profundidad 2, las
marcas de tiempo del seed, el `limit` ausente) MUST leerse como parte de
este contrato: `design.md` no se fusiona en `openspec/specs/` al archivar, y
esta referencia es lo que las mantiene alcanzables desde la spec publicada.

### Requirement: Comentarios de documentación corregidos (D-3)

El comentario de cabecera de `categories.repository.ts` y el comentario
homólogo de `db/schema.sql` MUST reflejar los conteos verificados: 198
categorías = 83 raíces + 115 descendientes, de las cuales 6 son nietos
(`165-168` bajo `164`, `169-170` bajo `163`, ambos bajo la raíz `124`,
`type_id 7`), profundidad máxima 2 saltos.

#### Scenario: El comentario ya no dice "2 niveles reales"
- GIVEN `categories.repository.ts:1-7` y `db/schema.sql:130-135`
- WHEN los leo
- THEN ninguno afirma "2 niveles reales" y ambos citan los conteos 198/83/115/6

## Out of Scope

`types`/`tags`/`manufacturers`/`shops` (US-4a, change hermano) · `authors`
(fuera del esquema del catálogo) · endpoints de escritura del admin
(`POST`/`PUT`/`DELETE /categories`, siguen en mock) · población de
`category_product` · cambios de frontend (`apps/shop/**`, `apps/admin/**`) ·
`ExceptionFilter` global.
