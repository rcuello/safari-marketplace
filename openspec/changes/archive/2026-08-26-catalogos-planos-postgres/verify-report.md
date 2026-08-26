# Verification Report — US-4a

**Change**: `2026-08-26-catalogos-planos-postgres`
**Spec**: `specs/flat-catalogs-api/spec.md`
**Mode**: Standard (`strict_tdd: false`)
**Fecha**: 2026-08-26
**Persistencia**: openspec-only (`artifact_store_mode: openspec`)
**Verificado sobre**: `417251b` → `bd803f8` → `9cd3da9` (HEAD de la sesión:
`2205e70`, rama de US-4b apilada encima; el binario que responde en el 9001
contiene ambas US)

> Toda la evidencia de este reporte fue **re-derivada de cero** por el
> verificador contra el proceso Nest en el 9001 y contra Postgres en el 5433.
> Ningún dato se copió de `apply-progress.md`. Donde el resultado fresco
> coincide con el del implementador, se dice; donde no, gana el fresco.

---

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 45 |
| Tasks complete | 45 |
| Tasks incomplete | 0 |

```text
$ grep -c '^- \[' tasks.md ; grep -c '^- \[x\]' tasks.md ; grep -c '^- \[ \]' tasks.md
total: 45  hechas: 45  pendientes: 0
```

Las 45 se comprobaron contra el código y contra respuestas HTTP reales, no
contra la casilla marcada.

---

## Build & Tests Execution

**Tests**: ✅ 48 passed / 0 failed / 0 skipped

```text
$ just db-check
npm run typecheck
> @safari/db@0.1.0 typecheck
> tsc --noEmit

cd "$(pwd)" && npm test
> @safari/db@0.1.0 test
> vitest run

 RUN  v4.1.11 C:/DevOps/MyGitHub/safari-marketplace/packages/db

 Test Files  6 passed (6)
      Tests  48 passed (48)
   Start at  13:45:51
   Duration  18.93s
```

Los 6 archivos incluyen las 4 suites nuevas de esta US
(`types`/`tags`/`manufacturers`/`shops`.integration.test.ts) más
`products` (US-2/US-3) y `categories` (US-4b, apilada encima).

**Type-check de la API**: ✅ Passed

```text
$ cd apps/api/rest && npx tsc --noEmit -p tsconfig.json
EXIT=0
```

**Build**: ➖ **No ejecutado — omitido a propósito, con razón.**
`rules.verify.build_command` es `just build`, que compila `apps/shop` +
`apps/admin`. Dos hechos lo desaconsejan aquí:

1. US-4a **no toca una sola línea de frontend** (ver tabla de scope abajo),
   así que su valor probatorio para este change es nulo.
2. Los dev servers de shop (3003) y admin (3002) están levantados y
   comparten `.next` con el build de producción; `CLAUDE.md` lo advierte
   explícitamente ("detener los `dev` antes: comparten `.next`"). La
   verificación es de solo lectura y no debe tumbar el entorno.

Se sustituyó por el gate de compilación que **sí** cubre el código tocado
(`tsc --noEmit` sobre `apps/api/rest`, arriba, verde) más el arranque real
del proceso Nest sirviendo los endpoints migrados.

**`just verify`**: ✅

```text
$ just verify
OK   API    :9001/api/settings  200  5503B  151ms
OK   Shop   :3003/en  200  190788B  5924ms  cards:30
OK   Admin  :3002/en/login  200  72821B  5909ms  cards:1
```

**Coverage**: ➖ No configurado (`coverage_threshold: 0`, `coverage_command: ""`).

---

## Línea base independiente (no se confió en los `mock-*.json` del implementador)

Los `mock-*.json` del change se capturaron del API antes de editar. Para no
darlos por buenos, la línea base se **re-derivó del mock crudo en disco**
(`apps/api/rest/src/db/pickbazar/*.json`):

```text
RAW MOCK types: rows=10 keys=9 ids=[1,2,3,4,5,6,7,8,9,11]
   keys: id,name,language,translated_languages,slug,banners,promotional_sliders,settings,icon
RAW MOCK tags: rows=10 keys=9 ids=[62,61,60,59,58,57,56,55,54,53]
   keys: id,name,language,translated_languages,slug,details,image,icon,type
RAW MOCK manufacturers: rows=14 keys=13 ids=[1,2,3,4,5,6,7,8,9,10,11,12,18,19]
   keys: id,name,slug,language,translated_languages,products_count,is_approved,description,website,socials,image,cover_image,type
RAW MOCK shops: rows=9 keys=16 ids=[11,9,7,6,5,4,3,2,1]
   keys: id,owner_id,name,slug,description,cover_image,logo,is_active,address,settings,notifications,created_at,updated_at,orders_count,products_count,owner
```

Confirma los 4 key-sets del spec (9/9/13/16) y, de paso, **valida la
Decisión D**: el mock emitía `tags` y `shops` en id **descendente**.

Las respuestas frescas del 9001 salieron byte a byte del mismo tamaño que
los `pg-*.json` del implementador (6506 / 2350 / 10930 / 8649 / 13639 B),
o sea que su evidencia es reproducible.

### Diff key-set + valores (orden de claves de jsonb normalizado)

```text
===== TYPES =====
filas mock=10 pg=10
claves mock=9 pg=9 | mismo orden: true
faltan en pg: [] | sobran en pg: []
filas pg con key-set/orden distinto a la 1a: 0
ids mock=[1,2,3,4,5,6,7,8,9,11]
ids pg  =[1,2,3,4,5,6,7,8,9,11]
campos con valor distinto:
   promotional_sliders: 8 filas -> ids [1,3,4,5,6,8,9,11]     (V-8, ratificada)
   translated_languages: 1 filas -> ids [8]                    (V-9, ratificada)

===== TAGS =====
filas mock=10 pg=10
claves mock=9 pg=9 | mismo orden: true
faltan en pg: [] | sobran en pg: []
ids mock=[62,61,60,59,58,57,56,55,54,53]
ids pg  =[62,61,60,59,58,57,56,55,54,53]
campos con valor distinto:
   image: 10 filas -> ids [62,61,60,59,58,57,56,55,54,53]      <<< NO RATIFICADA (W-1)

===== MANUFACTURERS =====
filas mock=14 pg=14
claves mock=13 pg=13 | mismo orden: true
faltan en pg: [] | sobran en pg: []
ids mock=[1,2,3,4,5,6,7,8,9,10,11,12,18,19]
ids pg  =[1,2,3,4,5,6,7,8,9,10,11,12,18,19]
campos con valor distinto:
   products_count: 14 filas    (V-1, ratificada)
   socials: 13 filas           (V-2, ratificada)
   cover_image: 14 filas       (V-3, ratificada)

===== SHOPS =====
filas mock=9 pg=12
claves mock=16 pg=16 | mismo orden: true
faltan en pg: [] | sobran en pg: []
ids mock=[11,9,7,6,5,4,3,2,1]
ids pg  =[15,14,12,11,9,7,6,5,4,3,2,1]
campos con valor distinto:
   created_at: 9 filas   (V-7, ratificada)
   updated_at: 9 filas   (V-7, ratificada)
   orders_count: 6 filas (V-5, ratificada; 3 ya eran 0 en el mock)
   owner: 9 filas        (V-4, ratificada)
   products_count: 1 fila -> id [4] makeup-shop 81->82   (declarada en el spec, 8/9)
```

`language` (manufacturers, V-10), `notifications` (shops, V-6) e
`is_active`/`is_approved` (V-11) **no aparecen** en el diff: los valores
constantes coinciden con lo que el mock ya emitía.

### Auditoría de tipos JSON por clave

```text
TYPES:  promotional_sliders  array -> null    (V-8)
TAGS:   image                array -> null    <<< NO RATIFICADA (W-1)
MANUF:  cover_image          object -> null   (V-3)
SHOPS:  owner                object -> null   (V-4)
(el resto de las 47 claves conserva el tipo exacto del mock)

Claves con tipo mixto entre filas: MANUFACTURERS description/website,
SHOPS description/cover_image — también mixtas en el mock (columnas nullable).
```

---

## Spec Compliance Matrix

| # | Requirement | Scenario | Evidencia | Result |
|---|---|---|---|---|
| R-1 | Envoltorio por catálogo | `types` sin envoltorio | `curl` → `TYPES es array: true len: 10 tiene data/total/per_page: false` | ✅ COMPLIANT |
| R-1 | Envoltorio por catálogo | `tags`/`manufacturers`/`shops` con paginación | `manufacturers?limit=30` → `per_page="30" (typeof string)`, 12 claves de envoltorio | ✅ COMPLIANT |
| R-2 | Key-set snake_case (9/9/13/16) | Key-set idéntico salvo divergencias declaradas | key-sets 9/9/13/16, mismo orden, 0 filas con key-set distinto — **pero** `tags.image` diverge sin estar en la tabla | ⚠️ PARTIAL (W-1) |
| R-3 | Filtro `search=name:` (D-5) | Las 4 cajas del admin siguen filtrando | 4/4 filtran, case-insensitive verificado (`GADGET`→Gadget, `SHOP`→7 shops) | ✅ COMPLIANT |
| R-4 | `search=is_active:1` (V-15) | `is_active` deja de ser difuso | `is_active:1`→total 12; `is_active:0`→total 0 (filtro exacto por columna) | ✅ COMPLIANT |
| R-5 | `type` anidado (D-6) | `type` embebido con 4 claves | `["id","name","slug","logo"]`, uniforme en 10/10 tags, `logo:null` | ✅ COMPLIANT |
| R-6 | `GET /top-manufacturers` | Mismos ids que el `slice` del mock | array plano, 13 claves/fila, `top-man == manufacturers.slice(0,10)` exacto | ✅ COMPLIANT |
| R-7 | `shops.products_count` calculado (D-4) | Coincide con el mock en 8 de 9 | 8/9; único desvío `makeup-shop` 81→82; recuento SQL independiente lo confirma | ✅ COMPLIANT |
| R-8 | `manufacturers.products_count` = 0 (V-1) | Siempre cero | 14/14 filas en listado y detalle | ✅ COMPLIANT |
| R-9 | Delta de `shops` — 12 filas (CA-3) | 9 slugs del mock + 3 reconstruidos | `psql` → 12 filas, `recon=t` en 15/14/12 | ✅ COMPLIANT |
| R-10 | Detalle por slug y 404 (V-16) | Detalle igual al listado | 4/4 catálogos: `identico=true`, claves 9/9/13/16 | ✅ COMPLIANT |
| R-10 | Detalle por slug y 404 (V-16) | 404 para slug inexistente | 5/5 → 404 con `{statusCode,message,error}`; `/tags/62` → 404 (D-8) | ✅ COMPLIANT |
| R-11 | Errores de conexión (D-3) | Postgres caído | 7/7 endpoints → 503 con mensaje legible; proceso vivo | ⚠️ PARTIAL (W-2) |
| R-12 | Bugs del mock NO reproducidos (V-12..V-14) | Paginación del mock no sobrevive | V-12 `type.slug` filtra; V-13 `total`/`per_page` reales; V-14 sin `limit` → 12 filas | ✅ COMPLIANT |

**Compliance summary**: 12/14 escenarios COMPLIANT, 2 PARTIAL, 0 FAILING, 0 UNTESTED.

### Evidencia por escenario

**R-1 / R-6 — envoltorios**

```text
TYPES es array: true len: 10 tiene data/total/per_page: false
tags envelope: total=10 count=10 current=1 last=1 per_page="100" (typeof string) data.len=10
manufacturers envelope: total=14 count=14 current=1 last=1 per_page="30" (typeof string) data.len=14
shops envelope: total=12 count=12 current=1 last=1 per_page="30" (typeof string) data.len=12
TOP-MAN es array: true len: 10 keys por fila: 13
top-man ids: [1,2,3,4,5,6,7,8,9,10]
manufacturers.slice(0,10) ids: [1,2,3,4,5,6,7,8,9,10]
top-man == slice(0,10) exacto: true
mock slice(0,10) ids: [1,2,3,4,5,6,7,8,9,10]
```

**R-3 / R-4 / R-12 — filtros**

```text
=== search=name (D-5) ===
types?search=name:gadget      -> 1 filas: ["Gadget"]
types?search=name:GADGET      -> 1 filas: ["Gadget"]
tags?search=name:baby&limit=100 -> total=2 names=["Baby Growth","Baby Milk"]
manufacturers?search=name:publication&limit=30 -> total=9
shops?search=name:gadget&limit=30 -> total=1 names=["Gadget"]
shops?search=name:SHOP&limit=30 -> total=7 names=["Books Shop","Grocery Shop","Bakery Shop","Makeup Shop","Bags Shop","Clothing Shop","Furniture Shop"]
=== V-15 is_active ===
shops?search=is_active:1&limit=30 -> total=12
shops?search=is_active:0&limit=30 -> total=0 names=[]
=== V-12 type.slug filtra de verdad ===
tags?search=type.slug:medicine&limit=100 -> total=10
tags?search=type.slug:grocery&limit=100 -> total=0
manufacturers?search=type.slug:books&limit=30 -> total=9
=== V-13/V-14 paginacion ===
tags?limit=3 -> total=10 count=3 per_page="3" last_page=4 data.len=3 ids=[62,61,60]
shops (sin limit) -> total=12 data.len=12
```

Paginación en páginas interiores y final (no la pedía el spec, se comprobó
igual porque es donde el `slice`→`skip/take` suele romperse):

```text
tags?limit=3&page=2 -> total=10 count=3 current=2 last=4 firstItem=3 lastItem=9 ids=[59,58,57]
tags?limit=3&page=4 -> total=10 count=1 current=4 last=4 firstItem=9 lastItem=9 ids=[53]
manufacturers?limit=5&page=3 -> total=14 count=4 current=3 last=3 ids=[11,12,18,19]
shops?limit=5&page=2 -> total=12 count=5 current=2 last=3 ids=[7,6,5,4,3]
shops?limit=5&page=3 -> total=12 count=2 current=3 last=3 ids=[2,1]
```

Búsquedas sin resultado y tokens desconocidos (no revientan):

```text
types?search=name:zzzz -> []
tags/shops/manufacturers ?search=name:zzzz -> total=0 data.len=0
shops?search=foo:bar&limit=30 -> HTTP 200 total=12
```

**R-7 / R-9 — `products_count` y delta de shops**

```text
$ node -e '... comparar mock vs pg ...'
products_count coincide en 8/9 shops del mock
  DIVERGE: makeup-shop(id 4): mock=81 pg=82
suma pg (12 filas) = 1199

$ docker exec -e PGPASSWORD=safari safari-postgres psql -h localhost -U safari \
    -d safari_scraper -c "SELECT s.id, s.slug, COUNT(p.id) AS cnt FROM shops s
    LEFT JOIN products p ON p.shop_id=s.id AND p.status='publish'
    AND p.visibility='visibility_public' GROUP BY s.id, s.slug ORDER BY s.id DESC;"
 id |      slug      | cnt
----+----------------+-----
 15 | tetetetet      |   1
 14 | launchidea     |   1
 12 | noaw           | 188
 11 | medicine       |  26
  9 | gadget         |  44
  7 | books-shop     |  67
  6 | grocery-shop   | 584
  5 | bakery-shop    |  72
  4 | makeup-shop    |  82
  3 | bags-shop      |  15
  2 | clothing-shop  |  64
  1 | furniture-shop |  55
(12 rows)
```

El recuento SQL independiente reproduce **exactamente** los
`products_count` que emite la API — el `_count` filtrado de Prisma no
está contando de más ni de menos.

```text
$ docker exec ... -c "SELECT id, slug, COALESCE(description LIKE 'Reconstruido%', false) AS recon FROM shops ORDER BY id DESC;"
 id |      slug      | recon
----+----------------+-------
 15 | tetetetet      | t
 14 | launchidea     | t
 12 | noaw           | t
 11 | medicine       | f
  9 | gadget         | f
  7 | books-shop     | f
  6 | grocery-shop   | f
  5 | bakery-shop    | f
  4 | makeup-shop    | f
  3 | bags-shop      | f
  2 | clothing-shop  | f
  1 | furniture-shop | f
(12 rows)
```

> Nota: `apply-progress.md` reporta `recon` en blanco para `medicine`
> (`LIKE` sobre `description NULL` da NULL). Se re-corrió con
> `COALESCE(..., false)` para que la evidencia sea inequívoca: `medicine`
> **no** es reconstruida. Mismo hecho, evidencia más limpia.

**R-10 — detalle por slug y 404**

```text
types/gadget:                          claves detalle=9  listado=9  | mismo orden=true | identico=true
tags/baby-milk:                        claves detalle=9  listado=9  | mismo orden=true | identico=true
manufacturers/too-cool-publication:    claves detalle=13 listado=13 | mismo orden=true | identico=true
shops/gadget:                          claves detalle=16 listado=16 | mismo orden=true | identico=true
shops/gadget products_count = 44 | claves = 16

types/no-existe-xyz         -> {"statusCode":404,"message":"No existe un type con slug `no-existe-xyz`.","error":"Not Found"} [HTTP 404]
tags/no-existe-xyz          -> {"statusCode":404,"message":"No existe un tag con slug `no-existe-xyz`.","error":"Not Found"} [HTTP 404]
tags/62                     -> {"statusCode":404,"message":"No existe un tag con slug `62`.","error":"Not Found"} [HTTP 404]
manufacturers/no-existe-xyz -> {"statusCode":404,"message":"No existe una marca con slug `no-existe-xyz`.","error":"Not Found"} [HTTP 404]
shops/no-existe-xyz         -> {"statusCode":404,"message":"No existe una tienda con slug `no-existe-xyz`.","error":"Not Found"} [HTTP 404]
```

**R-11 — Postgres caído** (ejecutado y revertido; `docker compose down` no
lleva `-v`, el volumen sobrevive, y `db/seed.sql` es idempotente: 7 INSERT,
7 `ON CONFLICT`)

```text
$ just db-down
 Container safari-postgres  Stopped / Removing / Removed

types             -> {"statusCode":503,"message":"No se puede conectar con el servicio. Por favor, intenta más tarde.","error":"Service Unavailable"} [HTTP 503]
tags              -> ... [HTTP 503]
manufacturers     -> ... [HTTP 503]
shops             -> ... [HTTP 503]
top-manufacturers -> ... [HTTP 503]
types/gadget      -> ... [HTTP 503]
shops/gadget      -> ... [HTTP 503]
settings          -> {"statusCode":500,"message":"Internal server error"} [HTTP 500]   <- US-1, fuera de alcance

$ netstat -ano | grep LISTENING | grep :9001
  TCP    0.0.0.0:9001  LISTENING  37720        <- el proceso Nest sigue vivo
```

Entorno restaurado y comprobado idéntico al estado inicial:

```text
$ just db-up
  * esquema y datos de referencia aplicados

types -> HTTP 200 6506B | tags -> 200 2350B | manufacturers -> 200 10930B
shops -> 200 13639B | top-manufacturers -> 200 8649B | settings -> 200
shops/gadget created_at/updated_at -> 2026-08-25T13:49:30.609Z 2026-08-25T13:49:30.609Z
                                      | products_count: 44 | claves: 16
 shops | types | tags | manuf | prods | cats
    12 |    10 |   10 |    14 |  1200 |  198
```

Los `created_at`/`updated_at` son los mismos de antes del ciclo: el
verificador **no** alteró los datos.

---

## Las dos regresiones que el design marcó como fáciles de romper en silencio

| Regresión | Guardia en código | Guardia en test | Comprobación fresca | Veredicto |
|---|---|---|---|---|
| `findShopBySlug` pierde el `_count` filtrado → `/shops/:slug` cae a 15 claves | `shops.repository.ts` — `COUNT_PRODUCTS` compartido por `listShops` **y** `findShopBySlug`, con comentario explicando el porqué | `shops.integration.test.ts` → `findShopBySlug('gadget').productsCount === 44` | `curl /api/shops/gadget` → **16 claves**, `products_count: 44`, objeto idéntico al del listado | ✅ No ocurre |
| `tags`/`shops` ordenando `id: 'asc'` en vez de `desc` | `orderBy: { id: 'desc' }` en ambos repos, comentado (Decisión D) | `tags` → `items[0].id===62 && último===53`; `shops` → `items[0].id===15` | ids pg `tags`=[62..53] y `shops`=[15,14,12,11,9,7,6,5,4,3,2,1]; el mock crudo confirma que emitía desc | ✅ No ocurre |

---

## Correctness (evidencia estática)

| Requirement | Status | Notas |
|---|---|---|
| `parse-search.ts` (D-5, Decisión A) | ✅ Implementado | 18 líneas, `split(';')` + primer `:`, "última repetición gana" igual que el mock; ignora tokens desconocidos (verificado con `search=foo:bar` → 200) |
| Mappers por servicio (Decisión B) | ✅ Implementado | `toTypeDto`/`toTagDto`/`toManufacturerDto`/`toShopDto` a nivel de módulo, no exportados, key-set literal en el orden del mock |
| `paginate()` local, no `buildPaginator` (Decisión C) | ✅ Implementado | `import { paginate } from '.../common/pagination/paginate'` en tags/manufacturers/shops; `types` sin envoltorio |
| Inputs con `name?`, no `search` genérico (Decisión H) | ✅ Implementado | `ListTypesInput`/`ListTagsInput`/`ListManufacturersInput`/`ListShopsInput` ganan `name?: string`; `contains` + `mode: 'insensitive'` |
| Supresiones de tipos | ✅ Ninguna | `grep` de `@ts-ignore`/`@ts-expect-error`/`as any`/`: any`/`eslint-disable` sobre las líneas **añadidas** del diff → 0 coincidencias. Los `as unknown as {Entity}` son la decisión deliberada del design (precedente `toProductDto`), no supresiones |
| Tests que aserten de verdad | ✅ Sí | Las 4 suites nuevas asertan valores concretos derivados del seed (ids 62/53, 15, totales 10/14/12, `productsCount` 584/82/188/44, filtros → 2/9/7/0), no `toBeDefined()` ni tautologías. Un cambio de orden, de filtro o del `_count` las pone en rojo |
| `console.log` de depuración eliminados | ✅ Sí | `tags.service.ts:38` y `manufacturers.service.ts:43` del código viejo ya no existen |
| URLs de paginación preservadas | ✅ Sí | `/tags?limit=`, `/manufacturers?search=&limit=`, `/shops?search=&limit=` idénticas a las del mock (comparado contra `8afa763`) |

---

## Coherence (design.md)

| Decisión | ¿Seguida? | Notas |
|---|---|---|
| A — `parse-search.ts` helper plano | ✅ Sí | |
| B — mappers privados con key-set literal | ✅ Sí | |
| C — `paginate()` local, `types` sin envoltorio | ✅ Sí | |
| D — `orderBy: id desc` en `tags` y `shops` | ✅ Sí | Confirmada además contra el mock crudo |
| E — `_count` filtrado en `listShops` **y** `findShopBySlug` | ✅ Sí | Recuento SQL independiente lo valida fila a fila |
| F — `type` anidado vía `listTypes()` indexado en memoria | ✅ Sí | `Map<number, TypeRecord>`, `type: null` si `typeId` es `null` (V-23, 0 filas afectadas hoy) |
| G — `try/catch` solo alrededor del I/O; 404 fuera | ⚠️ Parcial | Se cumple en los 4 listados y en `getTypeBySlug`/`getShop`. **No** en `tags.service.ts:125` ni `manufacturers.service.ts:164` — ver W-2 |
| H — inputs con `name?` | ✅ Sí | |
| V-19 `GetTypesDto.text` deja de filtrar | ✅ Como se aceptó | `types?text=gadget` → 10 filas (sin filtrar), HTTP 200 |
| V-20 `/top-manufacturers` ignora `search` | ✅ Como se aceptó | `top-manufacturers?search=type.slug:books` → ids [1..10] |
| V-21 `/tags/:id` numérico → 404 | ✅ Como se aceptó | `/tags/62` → 404 |
| V-22 `manufacturers` ignora `shop_id` | ✅ Como se aceptó | `search=shop_id:1` → total 14 |
| V-24 `count > per_page` sin `limit` | ✅ Inobservable | `/tags` sin `limit` → `total=10 count=10 per_page=10` |
| D-10 sin specs de jest para los 4 servicios | ✅ Respetada | Ver S-1 sobre el riesgo residual |

---

## Scope

**Cero violaciones.** El diff completo `8afa763..9cd3da9` toca 31 archivos:
5 de `apps/api/rest/src` (`parse-search.ts` + los 4 servicios), 11 de
`packages/db` (4 repos, 4 tests, `index.ts`, `records.ts`), 3 de
`docs/product/` y 12 artefactos de `openspec/changes/`.

```text
$ git diff --name-only 8afa763 9cd3da9 | grep -E "controller|apps/shop|apps/admin|schema.sql|schema.prisma|categor|author"
(vacío)
```

Ni un controlador, ni frontend, ni `db/schema.sql`, ni
`packages/db/prisma/schema.prisma`, ni `categories`, ni `authors`. El único
cambio en `packages/db/index.ts` es **una línea añadida en la 66**, fuera
de la región 26-34 reservada para US-4b:

```text
+export type { ListTypesInput } from './src/repositories/types.repository';
```

Los endpoints declarados fuera de alcance siguen sirviendo del mock, sin
regresión:

```text
new-shops?limit=10         -> HTTP 200 328B
staffs?shop_id=1&limit=10  -> HTTP 200 288B
near-by-shop/1.0/1.0       -> HTTP 200 7842B
categories?limit=10        -> HTTP 200 14539B
authors?limit=5            -> HTTP 200 7100B
top-authors?limit=5        -> HTTP 200 6660B
products?limit=2           -> HTTP 200 2314B
```

En `shops.service.ts` solo `getShops` y `getShop` cambiaron;
`getNewShops`/`getStaffs`/`getNearByShop`/`approveShop`/`disapproveShop`/
`update`/`remove`/`create` conservan `shopsJson`/`nearShopJson`/`fuse`.

**CA-4 — la tienda navega completa** (smoke real sobre el 3003):

```text
shop /en                   -> HTTP 200 190795B  product-card:1
shop /en/gadget            -> HTTP 200 211338B  product-card:1
shop /en/shops             -> HTTP 200 111496B
shop /en/shops/gadget      -> HTTP 200 179141B  product-card:1
shop /en/shops/grocery-shop-> HTTP 200 182562B  product-card:1

/en/shops menciona: gadget ✓ grocery-shop ✓ makeup-shop ✓ noaw ✓ launchidea ✓ tetetetet ✓
```

Las 3 tiendas reconstruidas se renderizan en el listado público.

---

## Issues Found

**CRITICAL**: Ninguno.

**WARNING**:

- **W-1 — `tags.image` diverge `[]` → `null` en 10/10 filas y NO está en la
  tabla de divergencias ratificadas del spec.** El escenario "Key-set
  idéntico salvo divergencias declaradas" exige que "los únicos valores
  distintos son los de la tabla de divergencias"; `image` no aparece en
  V-1…V-11. Causa raíz confirmada: `db/generate-seed.mjs:212` normaliza a
  `NULL` cualquier `image` que venga como array
  (`json(g.image && !Array.isArray(g.image) ? g.image : null)`), decisión
  previa a esta US; la columna es genuinamente NULL en Postgres:

  ```text
  $ docker exec ... -c "SELECT id, slug, image IS NULL AS image_null FROM tags ORDER BY id DESC;"
   62 | shake               | t
   61 | plant-based-protein | t
   ... (10/10 con image_null = t)

  mock image values: [[],[],[],[],[],[],[],[],[],[]]
  pg   image values: [null,null,null,null,null,null,null,null,null,null]
  ```

  Impacto funcional **no encontrado**: el admin lee `values?.image?.thumbnail`
  con optional chaining (`apps/admin/rest/src/components/tag/tag-form.tsx:169-171`)
  y los componentes de tags del shop no leen `image`. El implementador lo
  detectó y lo dejó anotado en `apply-progress.md` y en el DoD, pero **no
  llegó al spec**. Es una brecha de documentación del contrato, no un
  defecto de mapeo. Remedio antes de archivar: añadir una fila V-25 a la
  tabla de divergencias del spec (`db/generate-seed.mjs` está fuera de
  alcance de US-4a; arreglar el generador sería otra US).

- **W-2 — `listTypes()` del camino de detalle queda FUERA del `try/catch`,
  contra la Decisión G.** En `apps/api/rest/src/tags/tags.service.ts:125` y
  `apps/api/rest/src/manufacturers/manufacturers.service.ts:164`:

  ```ts
  if (!record) {
    throw new NotFoundException(...);
  }

  const types = await listTypes();   // <- sin try/catch
  ```

  Si Postgres cae **entre** `findXBySlug` y `listTypes`, la respuesta es el
  500 crudo de Nest (`{"statusCode":500,"message":"Internal server error"}`)
  en vez del 503/500 con `getUserFriendlyMessage()` que exige la
  Requirement "Errores de conexión a Postgres". Ventana estrecha e
  inobservable en el corte completo que probé (la primera llamada revienta
  dentro del try y devuelve 503 correctamente), pero es una desviación real
  de la decisión de diseño y un agujero de contrato bajo carrera.
  `/shops/:slug` y `/types/:slug` no lo tienen (no llaman a `listTypes`).

**SUGGESTION**:

- **S-1 — nada automatizado guarda la capa de mappers HTTP.** `just db-check`
  cubre los repositorios; los key-sets (9/9/13/16), el envoltorio, el 404 y
  el 503 solo tienen evidencia manual de `curl`. Es exactamente lo que D-10
  difirió a propósito y la DoD no lo pide, así que no es un incumplimiento;
  pero significa que una caída de `/shops/:slug` de 16 a 15 claves pasaría
  el gate de tests. Las dos regresiones marcadas por el design **sí** están
  cubiertas a nivel de repositorio, que es donde se originarían. Candidato
  natural para el Épico 9 (gate de calidad).
- **S-2 — `/api/settings` responde 500 crudo con la base caída**, no 503 con
  mensaje legible. Código de US-1, explícitamente fuera de alcance aquí;
  reproducido y confirmado. Merece una entrada de backlog para uniformar el
  patrón `isPrismaConnectionError` en `settings.service.ts`.
- **S-3 — la carpeta del change no tiene `state.yaml`**, que
  `openspec-convention.md` asigna al orquestador. No es responsabilidad del
  implementador ni bloquea nada; se anota para que el archivado no lo eche
  en falta.

---

## Verdict

**PASS WITH WARNINGS**

Las 13 requirements del spec están implementadas y verificadas con salida
real: 12/14 escenarios COMPLIANT, 2 PARTIAL, 0 FAILING, 0 UNTESTED. Las 45
tareas están hechas de verdad, el scope se respetó sin una sola violación,
no hay supresiones de tipos, los tests nuevos asertan comportamiento real y
las dos regresiones que el design marcó como fáciles de romper en silencio
**no ocurrieron**. Quedan dos avisos que no invalidan la migración pero
deberían resolverse antes de archivar: ratificar `tags.image` como
divergencia V-25 en el spec (W-1) y meter el `listTypes()` de los dos
caminos de detalle dentro del `try/catch` de la Decisión G (W-2).
