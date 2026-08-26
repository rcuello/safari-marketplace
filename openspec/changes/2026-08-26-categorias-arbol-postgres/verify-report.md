# Verification Report — US-4b · El árbol de categorías desde Postgres

**Change**: `2026-08-26-categorias-arbol-postgres`
**Spec**: `specs/category-tree-api/spec.md` (10 requirements, 11 scenarios)
**Mode**: Standard (`strict_tdd: false`)
**Fecha de verificación**: 2026-08-26
**Commits verificados**: `a3033f7` (PR#1, `packages/db`) · `be778be` (PR#2, servicio Nest)
**Entorno**: `safari-postgres` healthy (198 categorías / 1200 productos), un único
watcher Nest en `:9001`, shop en `:3003`, admin en `:3002`.

> Toda la evidencia de abajo fue **re-derivada por el verificador**, no copiada
> de `apply-progress.md`. Donde el resultado propio discrepa del reportado por
> el implementador, gana el resultado propio y la discrepancia queda registrada.

---

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 27 |
| Tasks complete | 27 |
| Tasks incomplete | 0 |

```text
$ grep -c '^- \[' tasks.md   -> 27
$ grep -c '^- \[x\]' tasks.md -> 27
$ grep -c '^- \[ \]' tasks.md -> 0
```

---

## Build & Tests Execution

**Type-check `packages/db` + suite de integración**: ✅ Passed

```text
$ just db-check
> @safari/db@0.1.0 typecheck
> tsc --noEmit
(sin errores)

> @safari/db@0.1.0 test
> vitest run
 RUN  v4.1.11 C:/DevOps/MyGitHub/safari-marketplace/packages/db
 Test Files  6 passed (6)
      Tests  48 passed (48)
   Duration  7.36s
```

Ejecutado **dos veces**: al abrir la verificación y como gate de cierre, después
del ciclo `just db-down` / `just db-up` del test de 503. Verde las dos veces.

**Suite específica del change** (13/13): ✅ Passed

```text
$ npx vitest run src/repositories/categories.integration.test.ts --reporter=verbose
 ✓ listCategories — conteos del seed > rootsOnly true (default) → 83 raíces 408ms
 ✓ listCategories — conteos del seed > rootsOnly false → 198 nodos planos (D-4) 47ms
 ✓ listCategories — profundidad 3 explícita > 124 → [163,164] → 163 anidado trae [169,170], 169 anidado trae brown-eggs 30ms
 ✓ listCategories — no hay bisnietos > profundidad máxima 2, y la suma de nodos únicos visitados es 198 22ms
 ✓ listCategories — cadena ascendente (D-2) > 169: parent.id 163, parent.parent.id 124, parent.parent.parent null; ancestros sin children 20ms
 ✓ listCategories — aciclidad (R-1) > JSON.stringify del listado completo sin paginar no lanza 29ms
 ✓ listCategories — typeSlug + paginación > typeSlug gadget → total 10 … 23ms
 ✓ listCategories — typeSlug + paginación > page 2, limit 50, rootsOnly false sobre daily-needs → 3 items sin ids repetidos … 36ms
 ✓ listCategories — name (Decisión G) > name 'egg' case-insensitive … 21ms
 ✓ findCategoryByIdOrSlug > id ≡ slug: 124 y dairy-2 devuelven el mismo id y el mismo árbol 39ms
 ✓ findCategoryByIdOrSlug > nieta por slug: brown-eggs → id 169, parentId 163, parent.parent.id 124 28ms
 ✓ findCategoryByIdOrSlug > ausente → null (dispara el 404 del servicio) 20ms
 ✓ getCategoryTree — compatibilidad (R-4) > 83 raíces, todas con parentId null, y alguna con children.length > 0 19ms
 Test Files  1 passed (1) · Tests  13 passed (13)
```

**Type-check del API Nest**: ✅ Passed

```text
$ cd apps/api/rest && npx tsc --noEmit -p tsconfig.json
tsc exit=0
```

**Smoke de la aplicación completa**: ✅ Passed

```text
$ just verify
OK   API    :9001/api/settings  200  5503B  20ms
OK   Shop   :3003/en  200  190788B  1152ms  cards:30
OK   Admin  :3002/en/login  200  72821B  4422ms  cards:1

$ curl :3003/en/daily-needs  -> HTTP 200 | 212851B | 'Dairy' x1 | 'Eggs' x1
$ curl :3003/en/grocery      -> HTTP 200 | 190814B | 'Vegetables' x1
$ curl :3003/en/gadget       -> HTTP 200 | 211338B | 'Gaming' x1
```

**Coverage**: ➖ No disponible (el proyecto no define umbral; `openspec/config.yaml`
→ `rules.verify.coverage_threshold` no aplica).

---

## Ground truth de la base (medida, no leída del seed)

```text
$ docker exec -e PGPASSWORD=safari safari-postgres psql -h localhost -U safari -d safari_scraper -c \
  "WITH RECURSIVE t AS (SELECT id,parent_id,0 AS nivel FROM categories WHERE parent_id IS NULL
   UNION ALL SELECT c.id,c.parent_id,t.nivel+1 FROM categories c JOIN t ON c.parent_id=t.id)
   SELECT nivel,count(*) FROM t GROUP BY nivel ORDER BY nivel;"
     0 |    83
     1 |   109
     2 |     6
$ SELECT count(*) FROM categories;  -> 198
```

198 = 83 raíces + 109 hijas + 6 nietas; **profundidad máxima 2 saltos, 0 bisnietos**.

```text
$ SELECT c.id,c.name,c.slug,c.parent_id,c.type_id,t.slug FROM categories c JOIN types t ON t.id=c.type_id
  WHERE c.id IN (124,163,164,165,166,167,168,169,170) ORDER BY c.id;
 124 | Dairy & Eggs   | dairy-2      |           |       7 | daily-needs
 163 | Eggs           | eggs         |       124 |       7 | daily-needs
 164 | Dairy          | dairy-3      |       124 |       7 | daily-needs
 165 | Butter         | butter-2     |       164 |       7 | daily-needs
 166 | Cheese         | cheese       |       164 |       7 | daily-needs
 167 | Liquid Milk    | liquid-milk  |       164 |       7 | daily-needs
 168 | Yogurt & Cream | yogurt-cream |       164 |       7 | daily-needs
 169 | Brown Eggs     | brown-eggs   |       163 |       7 | daily-needs
 170 | White Eggs     | white-eggs   |       163 |       7 | daily-needs
(9 rows)
```

---

## Spec Compliance Matrix

| # | Requirement | Scenario | Evidencia ejecutada | Result |
|---|-------------|----------|---------------------|--------|
| 1 | Árbol a profundidad arbitraria (D-1/CA-2) | La cadena de nietos sobrevive el round trip | `categories.integration.test.ts > profundidad 3 explícita` ✔ + `curl parent=all&type.slug:daily-needs` | ✅ COMPLIANT |
| 2 | Cadena ascendente `parent` sin ciclos (D-2) | Serialización segura | `> aciclidad (R-1)` ✔ + `JSON.stringify` sobre las 198 vía HTTP + **ciclo A→B→A inyectado en la BD** | ✅ COMPLIANT |
| 3 | Semántica de `parent` (D-4) | Default — solo raíces | `curl /api/categories?limit=1000` **sin `parent`** → `data: 198` | ❌ **FAILING** |
| 3 | Semántica de `parent` (D-4) | `parent=all` no rompe la home de `daily-needs` | `curl parent=all&search=type.slug:daily-needs` → 53 · `just verify` 200 · `/en/daily-needs` 200 | ✅ COMPLIANT |
| 4 | Filtro `search=type.slug:<slug>` | Filtro por type | `> typeSlug gadget → total 10` ✔ + `curl` → `type_ids: 9` (único) | ✅ COMPLIANT |
| 5 | Detalle por id o slug (D-6) | Mismo resultado por id o por slug | `> id ≡ slug` ✔ + `curl /124` vs `/dairy-2` byte a byte | ✅ COMPLIANT |
| 6 | 404 para categoría inexistente (D-7) | Slug inexistente | `curl -i /no-existe-xyz` → 404 + proceso vivo | ✅ COMPLIANT |
| 7 | Errores de conexión (D-8) | Postgres caído | `just db-down` → 503 en listado **y** detalle; `/api/authors` 200 | ✅ COMPLIANT |
| 8 | Key-set uniforme de 16 claves (D-5) | Las 21 raíces de gadget/medicine ahora con 16 claves | key-set único sobre los 198 top-level; gadget mock 13 → pg 16 | ✅ COMPLIANT |
| 9 | `products_count` constante en 0 (V-1) | products_count siempre 0 | 121 nodos descendientes con `products_count: 0`; **los 198 top-level no llevan la clave** | ⚠️ PARTIAL |
| 10 | Comentarios corregidos (D-3) | El comentario ya no dice "2 niveles reales" | `git grep` + lectura de ambos ficheros + contraste con `WITH RECURSIVE` | ✅ COMPLIANT (redacción distinta a la del scenario) |

**Compliance summary**: 9/11 scenarios ✅ · 1 ❌ FAILING · 1 ⚠️ PARTIAL.

---

## Evidencia por requirement

### 1 · Árbol a profundidad arbitraria (D-1) — ✅

`CATEGORY_INCLUDE` es `{ type: true }` (sin `include` anidado);
`_loadFlat()` hace un único `findMany()` plano y `_assembleTree()` arma el árbol
en memoria con `descend()`/`ascend()` memoizados. **No hay ninguna constante de
profundidad en el archivo.** Verificado leyendo
`packages/db/src/repositories/categories.repository.ts:67-171`.

```text
$ curl "…/api/categories?limit=1000&parent=all&search=type.slug:daily-needs"
top-level: 53
124 slug: dairy-2 | children: 163,164
163 slug: eggs    | children: 169,170
164 slug: dairy-3 | children: 165,166,167,168
  nieto 169 brown-eggs | keys: 16 | children: 0 | parent.id: 163
  nieto 170 white-eggs | keys: 16 | children: 0 | parent.id: 163
  nieto 165 butter-2   | keys: 16 | children: 0 | parent.id: 164
  nieto 166 cheese     | keys: 16 | children: 0 | parent.id: 164
  nieto 167 liquid-milk| keys: 16 | children: 0 | parent.id: 164
  nieto 168 yogurt-cream|keys: 16 | children: 0 | parent.id: 164
profundidad max (desde raices): 2 | bisnietos: 0
```

Las **6 nietas** llegan al payload HTTP con `icon`/`image`/`slug` propios y el
key-set completo. Cero bisnietos. Coincide exactamente con el `WITH RECURSIVE`.

### 2 · Cadena ascendente sin ciclos (D-2) — ✅ (probado con datos cíclicos reales)

```text
169 top-level | parent chain: 163->124 | 124 tiene children? false
169.parent keys: 14 | 169.parent.parent keys: 14
JSON.stringify del payload completo (198 nodos): no lanza
```

`_toCategoryRecord` (`packages/db/src/records.ts:178-192`) proyecta 11 claves
fijas y **no incluye `type` ni `children`**, así que los nodos ascendentes no
pueden reintroducir la rama descendente. Aciclidad garantizada por el compilador
(`CategoryAncestor` no declara `children`).

**Prueba adversarial del guard de ciclo.** El DDL solo bloquea la
autorreferencia (`categories_no_autoreferencia CHECK (parent_id IS DISTINCT FROM id)`),
no un ciclo A→B→A. Se inyectaron dos filas mutuamente referenciadas en la base
real y se limpiaron después:

```text
$ INSERT INTO categories (id,…) VALUES (90001,'Ciclo A','zz-ciclo-a',…,NULL,7,'en'),
                                       (90002,'Ciclo B','zz-ciclo-b',…,90001,7,'en');
  UPDATE categories SET parent_id=90002 WHERE id=90001;
 90002 | zz-ciclo-b |     90001
 90001 | zz-ciclo-a |     90002

$ curl "…/api/categories?limit=1000&parent=all"     HTTP 200 | 287483B | 0.195560s
$ curl "…/api/categories/zz-ciclo-a"                HTTP 200 |   2640B | 0.032844s
$ curl "…/api/categories?limit=1000&parent=null"    HTTP 200 |          0.053942s

=== subarbol de zz-ciclo-a ===
id 90001 (zz-ciclo-a) children:[90002]
  id 90002 (zz-ciclo-b) children:[90001]
    id 90001 (zz-ciclo-a) children:[]        <- truncado por el guard `path`
=== cadena ascendente: 90002->90001->90002 | termina en null: true
=== listado parent=all durante el ciclo: data 200 total 200

--- CLEANUP ---
UPDATE 2 · DELETE 2 · SELECT count(*) FROM categories -> 198 (max id 212)
```

Sin stack overflow, sin cuelgue, sin `TypeError` de estructura circular:
**el guard funciona de verdad**, y devuelve un árbol truncado como documenta el
comentario. La base quedó restaurada a 198 filas.

### 3 · Semántica de `parent` (D-4) — ❌ un scenario falla

```text
$ node -e "…" sobre 4 capturas curl
sin parent   | data: 198 | total: 198 | parent_id null:  83 | no-raiz: 115
parent=null  | data:  83 | total:  83 | parent_id null:  83 | no-raiz: 0
parent=all   | data: 198 | total: 198 | parent_id null:  83 | no-raiz: 115
all+daily    | data:  53 | total:  53 | parent_id null:   8 | no-raiz: 45
```

`parent='null'` → 83 ✅ · `parent='all'` → 198 ✅ · `parent=all` + vertical → 53
con las 6 nietas ✅ · **sin `parent` → 198, no 83** ❌.

El scenario "Default — solo raíces" del spec dice literalmente:
*"GIVEN `GET /api/categories?limit=1000` sin `parent` … THEN `data` tiene 83
elementos"*. La respuesta real trae 198. Ver **CRITICAL C-1** — el defecto está
en el texto del spec, no en el código (diagnóstico completo abajo).

### 4 · Filtro por vertical — ✅

```text
type.slug:gadget                 | n:  10 | type_ids: 9    | (filtro exacto, no fuse)
name:EGG                         | n:   5 | type_ids: 1,7  | todos con 'egg' en el nombre: true
type.slug:daily-needs;name:egg   | n:   4 | type_ids: 7    | todos con 'egg' en el nombre: true
```

El AND real de los dos tokens es la divergencia V-10 ya prevista en `design.md`.

### 5 · Detalle por id o slug (D-6) — ✅

```text
GET /api/categories/124        -> 200
GET /api/categories/dairy-2    -> 200
GET /api/categories/brown-eggs -> 200
GET /api/categories/169        -> 200

124 === dairy-2 (byte a byte): true
brown-eggs === 169: true | id: 169 | parent chain: 163->124
claves mock detalle: 16 [id,name,slug,icon,image,details,language,translated_languages,parent,type_id,created_at,updated_at,deleted_at,parent_id,type,children]
claves pg   detalle: 16 [idem]
mismo orden de claves: true
124.children: 163,164 | 163.children: 169,170
```

El detalle preserva key-set **y orden de claves** del mock, y la nieta 169 es
resoluble por slug con su cadena ascendente completa.

### 6 · 404 (D-7) — ✅

```text
$ curl -i …/api/categories/no-existe-xyz
HTTP/1.1 404 Not Found
{"statusCode":404,"message":"No existe una categoría `no-existe-xyz`.","error":"Not Found"}

Casos borde de :param
0        -> 404
-1       -> 404
1.5      -> 404
99999    -> 404
124abc   -> 404
```

### 7 · Contrato 503/500 (D-8) — ✅ · **el defecto de US-4a NO está presente**

Se auditó explícitamente la frontera del `try/catch`, que en US-4a dejaba una
llamada de I/O fuera:

- `getCategories` (`categories.service.ts:206-219`): `await listCategories(input)`
  está **dentro** del `try`. No hay ninguna otra llamada de I/O en el método.
- `getCategory` (`categories.service.ts:228-239`): `await findCategoryByIdOrSlug(param)`
  está **dentro** del `try`; el `NotFoundException` queda **fuera**, así que el
  404 no se degrada a 500. **Es la única llamada de I/O del método.**

```text
$ just db-down
 Container safari-postgres  Removed

$ curl -i "…/api/categories?limit=20&parent=null"
HTTP/1.1 503 Service Unavailable
{"statusCode":503,"message":"No se puede conectar con el servicio. Por favor, intenta más tarde.","error":"Service Unavailable"}

$ curl -i "…/api/categories/dairy-2"
HTTP/1.1 503 Service Unavailable
{"statusCode":503,"message":"No se puede conectar con el servicio. Por favor, intenta más tarde.","error":"Service Unavailable"}

$ curl -i "…/api/categories/no-existe-xyz"
HTTP/1.1 503 Service Unavailable          <- precedencia correcta: la I/O falla antes del 404

$ curl "…/api/authors"   (sonda mock pura)  HTTP 200   <- proceso Nest vivo

$ just db-up
  * esquema y datos de referencia aplicados
 categories | 198 · products | 1200 · types | 10 · shops | 12 · tags | 10
GET /api/categories?parent=all -> HTTP 200
GET /api/categories/dairy-2    -> HTTP 200
GET /api/types                 -> HTTP 200
```

Ningún dato perdido en el ciclo down/up.

### 8 · Key-set uniforme de 16 claves (D-5) — ✅

```text
=== PG top-level key-sets distintos: 1
  (198 nodos) [id,name,slug,icon,image,details,language,translated_languages,
               parent,type_id,created_at,updated_at,deleted_at,parent_id,type,children]
=== PG descendientes key-sets distintos: 1
  (121 nodos) [id,name,slug,icon,image,details,language,translated_languages,
               parent,type_id,created_at,updated_at,deleted_at,products_count,parent_id,children]

=== contraste con el mock ===
mock gadget top-level key-set : 13 [id,name,slug,language,translated_languages,parent,
                                    children,products_count,details,image,icon,type_id,type]  (10 nodos)
mock daily  top-level key-set : 16 [idéntico al de PG, MISMO ORDEN]                            (53 nodos)
mock daily  descendiente      : 16 [idéntico al de PG, MISMO ORDEN]                            (51 nodos)
```

La uniformidad es real: **un solo key-set** para los 198 top-level, y coincide
en claves y orden con la variante mayoritaria del mock. Las 21 raíces de
`gadget`(9)/`medicine`(11) pasan de 13 a 16 claves — la divergencia aprobada.

### 9 · `products_count` = 0 (V-1) — ⚠️ PARTIAL (redacción del spec)

Los 121 nodos descendientes emiten `products_count: 0`. Pero los **198 nodos
top-level no llevan la clave en absoluto** — igual que el mock en su variante de
16 claves. El scenario dice *"GIVEN cualquier nodo del árbol … THEN el valor es 0"*,
que es literalmente falso para el top-level. El comportamiento es el correcto
(paridad con el mock); la frase del spec es la que sobra-generaliza. Ver **W-4**.

### 10 · Comentarios corregidos (D-3) — ✅ (con matiz de redacción)

```text
$ git grep -n "2 niveles reales\|115 hijas" -- db packages apps
db/seed.sql:66:-- categories — 198 (83 raíces, 115 hijas)
packages/db/src/repositories/categories.repository.ts:9: * El comentario anterior decía "2 niveles reales" y ese error se …
```

Ninguno de los dos ficheros del requirement **afirma** ya "2 niveles reales"
(la única ocurrencia es la cita histórica que explica la causa raíz). Ambos
citan conteos verificados **e ids/nombres/type_id correctos** — contrastados uno
a uno contra la base más arriba: 165-168 bajo 164 "Dairy", 169-170 bajo 163
"Eggs", ambos bajo la raíz 124 "Dairy & Eggs", `type_id 7` = daily-needs,
profundidad máxima 2, 0 bisnietos. **Todos los hechos son ciertos.**

Matiz: el scenario pide *"ambos citan los conteos 198/83/115/6"*; los comentarios
citan **198/83/109/6** (109 = hijas directas). Es aritméticamente equivalente
(115 descendientes = 109 + 6) y **más preciso** que la frase del spec — el propio
spec reconoce que "115 hijas" era la imprecisión original. Se acepta como
COMPLIANT con la observación registrada en **S-2** (queda un tercer fichero,
`db/seed.sql:66`, generado, que sigue diciendo "115 hijas").

---

## Correctness (Static Evidence)

| Aspecto | Status | Notas |
|---------|--------|-------|
| Sin `@ts-ignore` / `@ts-expect-error` / `as any` | ✅ | `git grep` sobre `apps/api/rest/src/categories`, `categories.repository.ts` y la suite → exit 1 (0 coincidencias). El único cast es `as unknown as Category` en `toCategoryDto`, legítimo y documentado (precedente `toProductDto`) |
| Referencias muertas a la API vieja | ✅ | `git grep "CategoryWithChildren\|findCategoryBySlug"` → 0 hits en código; solo docs/specs históricos |
| Controller compatible con `async` | ✅ | `categories.controller.ts:25-33` devuelve la promesa; Nest la resuelve |
| Endpoints de escritura del admin intactos | ✅ | `create`/`update`/`remove` siguen devolviendo `this.categories[0]` del mock |
| `db/schema.sql` sin DDL nuevo | ✅ | Diff de `a3033f7`: −3/+10 líneas, **todas comentario** |
| `packages/db/index.ts` acotado | ✅ | Diff: solo el bloque `categories` (6 líneas) |
| Tests que comprueban en vez de complacer | ✅ | Ver análisis abajo |

### Análisis de la suite (¿tests moldeados para pasar?)

No. La suite ataca la propiedad, no el resultado:

- `profundidad máxima 2, y la suma de nodos únicos visitados es 198` recorre los
  83 subárboles y **derivaría un fallo** ante cualquier nodo perdido o duplicado
  — es exactamente el test que habría cazado el bug del `include` de un nivel.
- `page 2, limit 50 … sin ids repetidos con la página 1` compara conjuntos, no
  longitudes.
- `name 'egg' case-insensitive` valida el predicado sobre **todos** los items,
  no un conteo mágico.
- `id ≡ slug` compara `JSON.stringify` completo, no solo el `id`.

Huecos reales de cobertura (no defectos, pero sí ausencias): **el guard de ciclo
no tiene test** (lo verifiqué a mano inyectando filas), y **no existe suite HTTP
para `apps/api/rest`** — ninguna de las 11 scenarios del spec se ejerce a nivel
de endpoint por un test automatizado; toda la evidencia HTTP es `curl` manual.
Esto es coherente con el estado del repo (US-10 del backlog abre el gate
repo-wide) y con el precedente de US-2/US-3/US-4a.

---

## Coherence (Design)

| Decisión de `design.md` | ¿Seguida? | Notas |
|---|---|---|
| A — ensamblador puro/síncrono con guarda de ciclo | ✅ Sí | `_assembleTree` no toca `prisma`; guarda `path: Set<number>` verificada con datos cíclicos |
| B — 3 tipos públicos acíclicos por construcción | ✅ Sí | `CategoryAncestor`/`CategoryDescendant`/`CategoryTreeNode` |
| C/V-6 — `parent` forma **E** en todos los niveles | ✅ Sí | `toParentEDto`; medido: 6 nodos divergen del escalar del mock |
| D — `rootsOnly = (parent === 'null')` | ✅ Sí | Coincide con `design.md`; **choca con el texto del spec** (C-1) |
| E — `findCategoryByIdOrSlug`, id gana sobre slug | ✅ Sí | Una query, un ensamblador |
| F — 4 mappers, `type` embebido de 10 claves | ⚠️ Parcial | Se cumple la forma; `design.md` afirma sin matices que el mock no embebe `banners` y **eso es falso para 21 filas** (ver W-2) |
| G — `name` en `ListCategoriesInput` | ✅ Sí | `contains` + `mode: 'insensitive'` |
| Tabla de divergencias V-1…V-11 | ⚠️ Parcial | Todas las medidas caen dentro salvo `type.settings` (W-1); pero la tabla **vive solo en `design.md`**, que no se fusiona a `openspec/specs/` (W-3) |

### Auditoría de divergencias — diff exhaustivo de las 198 categorías

Comparación directa de `apps/api/rest/src/db/pickbazar/categories.json` (el mock)
contra `GET /api/categories?limit=1000&parent=all`, emparejando por id,
excluyendo `created_at`/`updated_at` (V-7):

```text
categories.json n: 198  | pg parent=all n: 198
=== rutas de diff sobre las 198 categorias ===
    #.children.N.children.N.parent          x6      -> V-6   declarada
    #.children.N.children.N.products_count  x6      -> V-1   declarada
    #.children.N.image                      x68     -> V-8   declarada (design)
    #.children.N.parent.image               x66     -> V-8   declarada (design)
    #.children.N.products_count             x108    -> V-1   declarada
    #.deleted_at                            x21     -> V-2   declarada
    #.image                                 x101    -> V-8   declarada (design)
    #.parent.image                          x66     -> V-8   declarada (design)
    #.parent_id                             x21     -> V-2   declarada
    #.products_count                        x21     -> V-2   declarada
    #.type.banners                          x21     -> NO DECLARADA en spec  (W-2)
    #.type.promotional_sliders              x133    -> V-3   declarada (design), no en spec (W-3)
    #.type.settings.isHome                  x49     -> NO DECLARADA en ningún artefacto (W-1)
    #.type.settings.productCard             x49     -> NO DECLARADA en ningún artefacto (W-1)
    #.type.settings.authors                 x8      -> NO DECLARADA en ningún artefacto (W-1)
    #.type.settings.bestSelling             x8      -> idem
    #.type.settings.category                x8      -> idem
    #.type.settings.handpickedProducts      x8      -> idem
    #.type.settings.manufactures            x8      -> idem
    #.type.settings.newArrival              x8      -> idem
    #.type.settings.popularProducts         x8      -> idem
```

Desglose de las dos familias no declaradas:

```text
=== type embebido: mock vs PG ===
mock: (177 cats, types 1-8)  [id,name,language,translated_languages,settings,slug,icon,promotional_sliders,created_at,updated_at]
mock: ( 21 cats, types 9/11) [id,name,language,translated_languages,slug,banners,promotional_sliders,settings,icon]
pg  : (198 cats, todos)      [id,name,language,translated_languages,settings,slug,icon,promotional_sliders,created_at,updated_at]

=== type.settings: origen de la deriva ===
type 1 grocery : settings.isHome      mock true  -> pg false    | types.json false
                 settings.productCard mock "neon"-> pg "helium"  | types.json "helium"
type 8 books   : settings.authors/bestSelling/category/handpickedProducts/
                 manufactures/newArrival/popularProducts: ausentes en el mock,
                 presentes en pg                                 | types.json las trae
types 9/11     : sin diferencias de valor (solo reordenación de claves jsonb)
```

**Diagnóstico**: `categories.json` embebe una copia **desactualizada** del `type`;
Postgres sirve la copia canónica de la tabla `types` (sembrada desde
`types.json`). Es decir, PG está *más* correcto que el mock — pero es un cambio
de payload de `/api/categories` que **ningún artefacto declara**.

**Impacto funcional medido: ninguno.** Todos los consumidores de
`type.settings`/`type.banners` en el front leen el `type` de `/api/types` o de
`product.type`, no de `category.type`:

```text
$ git grep -n "type?.settings\|type.settings\|type?.banners\|type.banners" -- apps/shop/src apps/admin/rest/src
apps/shop/src/components/banners/banner.tsx:31          <- type de /api/types
apps/shop/src/components/products/cards/card.tsx:30-31  <- product.type
apps/shop/src/framework/rest/home-pages.ssr.ts:62       <- types de /api/types
apps/shop/src/lib/hooks/use-homepage.ts:16 · use-layout.tsx:12 <- types de /api/types
apps/shop/src/pages/[[...pages]].tsx:52                 <- type de /api/types
```

Y `image: [] → null` (V-8, 101 nodos) es **heredada del seed**, no del mapper:

```text
$ db/generate-seed.mjs:173
  `${json(c.image && !Array.isArray(c.image) ? c.image : null)}, `
$ SELECT image IS NULL, count(*) FROM categories GROUP BY 1;
 f | 97
 t | 101        <- exactamente los 101 nodos que el mock emite como []
```

---

## Scope

Diff completo de la US (`9cd3da9..be778be`):

```text
 apps/api/rest/src/categories/categories.service.ts        | 243 +++++---
 db/schema.sql                                             |  13 +-      (solo comentario)
 docs/product/…/4b-categorias-arbol-postgres.md            | 209 ++++++
 openspec/changes/…/mock-cat-{daily,dairy2,gadget}.json    |   3 +       (evidencia)
 openspec/changes/…/pg-cat-{124,daily,dairy2,gadget}.json  |   4 +       (evidencia)
 openspec/changes/…/tasks.md                               |  54 +--
 packages/db/index.ts                                      |   6 +-
 packages/db/src/repositories/categories.integration.test.ts | 175 +++++
 packages/db/src/repositories/categories.repository.ts     | 226 ++++---
 14 files changed, 820 insertions(+), 113 deletions(-)
```

| Exclusión declarada | ¿Respetada? |
|---|---|
| `types`/`tags`/`manufacturers`/`shops` (US-4a) | ✅ ningún fichero tocado |
| `authors` | ✅ |
| Endpoints de escritura del admin | ✅ `create`/`update`/`remove` siguen en mock |
| `category_product` | ✅ ninguna fila, ningún código |
| Frontend (`apps/shop/**`, `apps/admin/**`) | ✅ 0 ficheros |
| `db/schema.sql` solo el comentario | ✅ verificado en el diff |
| `ExceptionFilter` global | ✅ no tocado |

Commits posteriores de la rama (`f37e415` apply-progress, `2205e70` fila del
épico, `6084b57` correcciones de US-4a) están fuera del alcance de esta
verificación y no invaden el scope de US-4b. Las modificaciones sin commitear
en `CLAUDE.md` y `.claude/skills/` son ajenas al change.

---

## Issues Found

### CRITICAL

**C-1 — El scenario "Default — solo raíces" (D-4) falla contra el código real.**

- **Medido**: `GET /api/categories?limit=1000` sin `parent` devuelve
  `data: 198` / `total: 198`, no 83.
- **Causa**: `categories.service.ts:197` hace `const rootsOnly = parent === 'null'`,
  así que `parent === undefined` ⇒ listado plano.
- **¿Quién tiene razón?** El **código**. Tres pruebas independientes:
  1. El mock previo hacía exactamente lo mismo
     (`git show be778be^:…/categories.service.ts` → `if (parent === 'null') { … }`);
     preservar eso es la regla nº1 del repo (contratos byte a byte).
  2. `GetCategoriesDto.parent` declara `= 'null'` pero `main.ts:9` usa
     `new ValidationPipe()` **sin `transform`**, así que el default nunca se
     aplica — el objeto de query llega crudo.
  3. `design.md` §"Decisión D" lo dice explícitamente y con evidencia:
     *"sin `parent` -> 198 filas (¡el default NO aplica!)"*.
- **Conclusión**: el defecto está en el **texto del delta spec**, que contradice
  a su propio `design.md`. Nadie lo detectó porque no hay test HTTP y el test de
  repositorio ejerce el default de `listCategories` (`rootsOnly ?? true` → 83),
  que el servicio nunca usa: siempre pasa el booleano explícito.
- **Por qué bloquea el archivo**: al archivar, este delta se fusiona en
  `openspec/specs/category-tree-api/spec.md` y quedaría como fuente de verdad un
  **MUST falso** que contradice al código en producción. Es la clase de comentario
  erróneo que esta misma US existió para corregir ("2 niveles reales").
- **Corrección propuesta (una frase, en el spec, NO en el código)**:
  > "Con `parent='null'` el listado MUST devolver solo las 83 raíces. Sin
  > `parent` (el default del DTO no se aplica: `ValidationPipe` corre sin
  > `transform`), con `parent='all'` o con cualquier otro valor, MUST devolver
  > los 198 nodos planos — semántica idéntica a la del mock."
  Y reescribir el scenario "Default — solo raíces" como "`parent=null` — solo
  raíces", con la evidencia ya capturada (83 elementos, todos `parent_id` nulo).

### WARNING

**W-1 — Divergencia NO declarada en ningún artefacto: `category.type.settings`.**
57 de 198 categorías sirven un `settings` distinto al del mock: 49 de type 1
(`isHome: true→false`, `productCard: "neon"→"helium"`) y 8 de type 8 (aparecen 7
claves que el mock no embebía). Postgres sirve la copia canónica de la tabla
`types`; `categories.json` embebía una copia rancia. No figura en V-1…V-11 de
`design.md` ni en el spec. **Sin impacto funcional detectado** (ningún componente
lee `category.type.settings`). Análogo exacto del `tags.image` que levantó la
verificación de US-4a. Debe declararse en el spec antes de archivar.

**W-2 — `type.banners` desaparece del `type` embebido de las 21 categorías de
`gadget`/`medicine`.** `apply-progress.md` lo reporta honestamente como hallazgo
no previsto y lo archiva bajo "D-5/V-2", pero D-5/V-2 acotan explícitamente el
key-set **de la categoría**, no el del `type` embebido. Además, `design.md`
(Decisión F) afirma sin matices que el mock no embebe `banners`, y eso es falso
para 21 filas. Sin impacto funcional (`banner.tsx` y `[[...pages]].tsx` leen el
`type` de `/api/types`). Requiere fila propia en la tabla de divergencias.

**W-3 — El delta spec sub-declara las divergencias que realmente se envían.**
`specs/category-tree-api/spec.md` solo declara D-5 y V-1. Las divergencias
medidas V-3 (`promotional_sliders → null`, 133 nodos), V-6 (`parent` forma E, 6
nodos), V-7 (timestamps), V-8 (`image: [] → null`, 101 nodos), V-9 y V-10 viven
**solo en `design.md`**, que no se fusiona en `openspec/specs/` al archivar. El
precedente de US-4a (`6084b57`) fue exactamente añadir la fila faltante al delta
spec, no al design. Recomendado: replicar en el spec la tabla de divergencias
(o al menos las filas con nodos afectados > 0).

**W-4 — El scenario de V-1 es falso para los nodos top-level.** Dice
"products_count siempre 0 … en cualquier nodo del árbol", pero los 198 top-level
**no llevan la clave** (igual que el mock). Reescribir acotándolo a los nodos
descendientes.

### SUGGESTION

- **S-1 — Código muerto en `categories.service.ts`.** `const fuse = new Fuse(categories, options)`
  (línea 34) y `options` (30-33) ya no se usan: `parseCategorySearch` reemplazó
  la búsqueda difusa. Se construye un índice Fuse sobre 198 categorías en cada
  arranque para nada. `categoriesJson`/`plainToClass`/`categories` sí deben
  quedarse (los usan `create`/`update`/`remove`). `tasks.md:5.1` pedía dejar
  `fuse` "intacto", así que es deliberado — pero merece un borrado o un comentario
  de "se conserva para X".
- **S-2 — Queda un tercer comentario con la cuenta imprecisa**: `db/seed.sql:66`
  dice `-- categories — 198 (83 raíces, 115 hijas)`, generado por
  `db/generate-seed.mjs:161` (`categories.length - raices` etiquetado "hijas").
  Fuera de la letra de D-3, pero es la misma imprecisión que la US corrigió en
  los otros dos ficheros.
- **S-3 — Reordenación de claves jsonb en `image`**: 21 categorías con imagen real
  pasan de `thumbnail,original,id` (mock) a `id,original,thumbnail` (jsonb
  normaliza el orden). Valores idénticos; solo afecta comparaciones byte a byte.
- **S-4 — Orden del listado plano**: `categories.json` no está ordenado por id a
  partir del índice 180; Postgres sí (`orderBy: { id: 'asc' }`). Los 180 primeros
  ids coinciden posición a posición, así que solo cambiaría la página 7 con
  `limit=30`. Ningún cliente real pagina tan hondo (tienda 1000, admin 20/999).
- **S-5 — El guard de ciclo no tiene test.** Lo verifiqué inyectando filas en la
  base; una regresión futura pasaría el gate en verde. Si algún día se exporta
  `_assembleTree`, un test unitario de 10 líneas lo cubriría sin base.
- **S-6 — `ascend()` memoiza una cadena truncada antes de sobrescribirla** cuando
  hay ciclo (`up.set(id, {...rec, parent: null})` en la línea 139 se pisa después
  con la cadena completa). La salida observada es correcta y acíclica; queda como
  nota de mantenimiento.
- **S-7 — No hay cobertura automatizada a nivel HTTP** para `apps/api/rest`.
  Las 11 scenarios se demuestran con `curl` manual. Coherente con el estado del
  repo (US-10 abre el gate repo-wide), pero significa que C-1 podría haberse
  detectado antes con un solo test de endpoint.

---

## Verdict

**FAIL** — el resto del change es sólido, pero un scenario del spec falla contra
el código real y el delta spec sub-declara divergencias que sí se envían;
archivar ahora fijaría un MUST falso como fuente de verdad.

Lectura precisa para el orquestador:

- **La implementación es correcta.** El árbol de profundidad 3 funciona de punta a
  punta (las 6 nietas llegan al HTTP), el guard de ciclo resiste un A→B→A real
  inyectado en la base, el contrato 503/500 es correcto en los dos métodos
  (**el defecto de frontera del `try/catch` de US-4a NO se reprodujo aquí**), el
  404 es de dominio, el key-set es uniforme, el scope está respetado, no hay
  supresiones de tipos y los tests comprueban propiedades en vez de complacer.
  48/48 tests verdes, `tsc` limpio en los dos paquetes, `just verify` en verde y
  la tienda navega `daily-needs`/`grocery`/`gadget` en 200.
- **Lo que falla es documentación de contrato**, y se arregla editando
  `specs/category-tree-api/spec.md` — **no hay que tocar código**. Tocar el código
  para "cumplir" C-1 rompería la paridad con el mock, que es la regla nº1 del repo.
- Tras aplicar C-1 + W-1…W-4 sobre el spec, este change queda listo para
  `sdd-archive` sin ninguna otra acción.
