# Apply Progress: El árbol de categorías desde Postgres — US-4b

> Ejecutado en un solo batch, en orden PR #1 → PR #2, sobre 2 ramas
> stacked-to-main (sobre `feat/us-4a-pr3-shops-docs`, ya con US-4a en
> historia). 27/27 tasks de `tasks.md` completadas. Commits locales creados
> por PR (sin push, regla de la sesión).

## Ramas y commits

| PR | Rama | Base | Commit |
|---|---|---|---|
| #1 | `feat/us-4b-pr1-categories-db` | `feat/us-4a-pr3-shops-docs` | `a3033f7` |
| #2 | `feat/us-4b-pr2-categories-api` | PR #1 | `be778be` |

## PR #1 — `categories.repository.ts` + barrel + comentario de `db/schema.sql` + suite (379 insertions/69 deletions)

Tasks 1.1–3.4: todas `[x]`.

- **Ensamblador (Decisión A/B)**: `CATEGORY_INCLUDE` pasa de `{ type: true,
  children: { orderBy } }` a `{ type: true }`; `_assembleTree(rows)` privado
  y síncrono arma el árbol en memoria con `descend()`/`ascend()`/
  `_immediate()` memoizados y guarda de ciclo por `path: Set<number>`.
  `CategoryWithChildren` → `CategoryAncestor`/`CategoryDescendant`/
  `CategoryTreeNode` (aciclidad por construcción del compilador).
- `ListCategoriesInput` gana `rootsOnly?` (default `true`) y `name?`
  (`contains`+`insensitive`). `findCategoryBySlug` → `findCategoryByIdOrSlug`.
  `getCategoryTree` reimplementada sobre el ensamblador (no se tocó el smoke
  de `products.integration.test.ts`).
- `git grep -n "CategoryWithChildren\|findCategoryBySlug"` ANTES de borrarlos:
  ```
  packages/db/index.ts:27:  CategoryWithChildren,
  packages/db/index.ts:31:  findCategoryBySlug,
  ... (resto: definiciones propias en categories.repository.ts)
  ```
  Confirmado: ningún consumidor fuera del barrel y su propia definición.
- `packages/db/index.ts:26-34` (bloque `categories`): exporta los 3 tipos
  nuevos + `findCategoryByIdOrSlug`; quita `CategoryWithChildren`/
  `findCategoryBySlug`. Único bloque tocado (rebase con US-4a trivial).
- `db/schema.sql:130-141`: comentario corregido (198 = 83 raíces + 109 hijas
  + 6 nietas, ids 165-168/169-170, `type_id 7`, profundidad máxima 2, sin
  DDL nuevo).
- **Suite nueva** `categories.integration.test.ts` (13 tests): conteos
  `rootsOnly` true/false (83/198), profundidad 3 explícita (`124→[163,164]`,
  `163→[169,170]`, `169.slug==='brown-eggs'`), 0 bisnietos (recorrido de los
  83 subárboles, 198 nodos únicos visitados), cadena ascendente (D-2),
  aciclidad (`JSON.stringify` no lanza), `typeSlug`+paginación (gadget 10,
  daily-needs página 2/50 → 3 items sin solape), `name` case-insensitive,
  `findCategoryByIdOrSlug` id≡slug, nieta por slug, ausente→`null`,
  `getCategoryTree` (R-4).
  ```
  npm run typecheck → tsc --noEmit (sin errores)
  npm test → Test Files 6 passed (6) · Tests 48 passed (48)
  ```
- **`just db-build`**: verde (`dist/index.js` 95.95 KB, `dist/index.d.ts`
  943.88 KB).

## PR #2 — `categories.service.ts` + doc de la US (441 insertions/44 deletions)

Tasks 4.1–7.1: todas `[x]`.

- **Baseline (Paso 0)**: con `just api-dev` todavía en mock, `curl` de
  gadget/daily-needs/dairy-2 guardados ANTES de tocar `categories.service.ts`:
  gadget total 10, daily-needs total 53, dairy-2 id 124.
- **`categories.service.ts`**: `getCategories`/`getCategory` → `async` sobre
  `@safari/db`; `rootsOnly = (parent === 'null')`; `parseCategorySearch`
  (`type.slug:v`→`typeSlug`, `name:v`→`name`, ambos a la vez = AND real,
  V-10). Cuatro mappers privados de módulo: `toCategoryDto` (16 claves,
  uniforme, sin ramificar por `type_id` — D-5/V-2), `toAncestorDto` (14
  claves, recursivo), `toDescendantDto` (16 claves, sin `type`,
  `products_count: 0`), `toEmbeddedType` (10 claves), `toParentEDto` (forma
  **E** de Decisión C, factorizada como función nombrada). `try/catch`
  503/500 en `getCategories`; en `getCategory` el `try` cubre solo la I/O y
  el 404 queda fuera. `create`/`update`/`remove`, `categoriesJson`,
  `plainToClass`, `fuse` intactos.
- **`just db-build && just build-api`**: verde.
- **Incidente de entorno** (no de código): se encontraron **tres**
  watchers `just api-dev` corriendo en paralelo sobre el mismo directorio
  (efecto colateral de la sesión, PIDs reales via PowerShell:
  15664/30932, 24276/17620, 16992/33780), corrompiendo `dist/` a mitad de
  build (`Cannot find module '...dist\main'`). Se mataron los seis procesos,
  se limpió `dist/` y se relanzó un único `just api-dev`, que quedó estable
  para el resto de la evidencia.

### Evidencia HTTP (Fase 6)

**CA-1 — paridad de contrato** (`node -e`, excluyendo `created_at`/
`updated_at` por V-7):
```
gadget | envoltorio igual: true | n: 10 -> 10 | ids iguales: true
gadget | key-set pg: [id,name,slug,icon,image,details,language,
  translated_languages,parent,type_id,created_at,updated_at,deleted_at,
  parent_id,type,children]  (16 claves uniformes)
gadget | rutas únicas de diff: #N.products_count | #N.type.banners |
  #N.type.promotional_sliders | #N.deleted_at | #N.parent_id
daily  | envoltorio igual: true | n: 53 -> 53 | ids iguales: true
daily  | rutas únicas de diff: #N.children.N.products_count |
  #N.children.N.children.N.parent | #N.children.N.children.N.products_count
```
Todas las rutas caen en V-1 (`products_count`), V-2 (`deleted_at`/
`parent_id`/`products_count` desaparece del top-level), V-3
(`promotional_sliders`), V-6 (`parent` forma E en vez del escalar), o el
refinamiento de Decisión F (`type.banners` nunca se emite — ver "Hallazgos"
abajo). Ninguna ruta es un defecto.

**CA-2 — árbol a profundidad 3**:
```
n top-level: 53
124 -> 163,164
163 -> 169,170
  nieta 169 brown-eggs | icon null | image? true | claves 16
  nieta 170 white-eggs | icon null | image? true | claves 16
cadena de 169: 163->124
JSON.stringify no lanza: true
```

**CA-2b — detalle id≡slug**:
```
id==slug: true
claves mock: 16 -> pg: 16 | mismo orden: true
```

**CA-2c — 404 + proceso vivo**:
```
HTTP/1.1 404 Not Found
{"statusCode":404,"message":"No existe una categoría `no-existe-xyz`.","error":"Not Found"}
curl /api/types -> 200
```

**503 con la base caída**:
```
curl /api/categories?limit=20&parent=null -> 503
{"statusCode":503,"message":"No se puede conectar con el servicio. Por favor, intenta más tarde.","error":"Service Unavailable"}
```
Desviación frente a `design.md`: `curl /api/types` durante la ventana de
caída también dio 503 (no 200) porque US-4a ya lo migró a Postgres antes de
que este change arrancara — `design.md` lo asumía todavía en mock. El
proceso Nest siguió vivo (lo prueba el propio 503 bien formado); se usó
`GET /api/authors` (puramente mock) como sonda alternativa, que dio 200
durante toda la ventana. Tras `just db-up`, `/api/types` volvió a 200 sin
pérdida de datos.

**D-3 — profundidad verificada por SQL**:
```
WITH RECURSIVE ... -> nivel 0 | 83, nivel 1 | 109, nivel 2 | 6
grep "nietas\|nietos": db/schema.sql:134,137 y categories.repository.ts:7
```

**CA-4 — la tienda navega `parent=all`**:
```
just verify
OK   API    :9001/api/settings  200  5503B  34ms
OK   Shop   :3003/en  200  190788B  604ms  cards:30
OK   Admin  :3002/en/login  200  72821B  71228ms  cards:1

curl :3003/en/daily-needs | grep -c Dairy      -> 1  (200)
curl :3003/en/grocery     | grep -c Vegetables -> 1  (200)
```

## Divergencias/hallazgos NO previstos en el design, documentados en el DoD

1. **`type.banners` en el `type` embebido de categorías `gadget`/`medicine`**:
   `design.md` (Decisión F) afirma sin matices que "el mock no lo trae en el
   `type` embebido". Verificado contra `categories.json` crudo: para
   `type_id 9` (gadget) el `type` embebido SÍ trae `banners` (9 claves, sin
   `created_at`/`updated_at`); para `type_id 7` (daily-needs) NO lo trae (10
   claves, con `created_at`/`updated_at`). Es un artefacto de los datos, no
   del código: distintas filas de `categories.json` embeben distintas formas
   del `type`. El mapper implementado (`toEmbeddedType`, 10 claves, nunca
   emite `banners`) ya sigue la especificación tal cual está escrita — la
   uniformidad ya ratificada en D-5/V-2 cubre este caso sin necesitar una
   decisión nueva del usuario.
2. **`/api/types` dejó de ser una sonda válida de "proceso vivo"** para el
   test de 503 con la base caída: US-4a ya lo migró a Postgres antes de que
   esta US arrancara (secuencia de ramas de la sesión), así que ahora
   depende de la misma conexión. No requirió cambiar código de esta US: solo
   una sonda alternativa (`/api/authors`, puramente mock) para la evidencia.
3. **Incidente de entorno**: tres watchers `just api-dev` duplicados
   corrompieron `dist/` a mitad de build (ver PR #2 arriba). Diagnosticado y
   resuelto sin tocar código de producción.

Ninguno de los 3 requirió tocar `db/schema.sql` más allá del comentario ya
planeado, ni el scope declarado fuera de límites (`types`/`tags`/
`manufacturers`/`shops`, `authors`, endpoints de escritura del admin,
`category_product`, frontend).

## Nota de documentación fuera de alcance

`docs/product/1-catalogo-desde-postgres/README.md:34` sigue mostrando la
fila de US-4b con status "Pendiente" — ese archivo es propiedad de US-4a
(instrucción explícita de la sesión: no tocarlo). El link ya apunta al
archivo correcto (`4b-categorias-arbol-postgres.md`); solo falta actualizar
el status/columna, que le corresponde a quien cierre el archivo del épico.

## Estado final

27/27 tasks completadas. Los 2 PRs verificados de punta a punta,
independientemente, en el orden de la cadena. `just db-check` re-verificado
en verde al cierre (48/48 tests). Listo para `sdd-verify`.
