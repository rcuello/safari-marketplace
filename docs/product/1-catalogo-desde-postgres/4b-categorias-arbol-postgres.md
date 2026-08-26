# US-4b — El árbol de categorías desde Postgres

> `categories` deja el mock JSON y pasa a Postgres, reconstruyendo el árbol a
> profundidad arbitraria (hoy 3 niveles reales, no 2). Se partió de **US-4a**
> (`types`/`tags`/`manufacturers`/`shops`) por tener riesgo de diseño propio:
> ver `./4-migrar-catalogos-apoyo.md`.

**Épico:** [Épico 1](./README.md)
**Fecha:** 2026-08-26
**Status:** Implementada
**Depende de:** US-4a
**LOC est.:** ~571 (2 PRs encadenados: ~379 / ~192)

## Historia
**Como** estudiante, **quiero** que el árbol de categorías (raíces, hijas y
nietas) salga de la base en vez del JSON estático, **para** que la navegación
por vertical (`daily-needs`, `grocery`, …) sea fiel a los datos reales,
incluidas las 6 nietas que el `include` de un solo nivel perdía en silencio.

## Contexto

- `packages/db/src/repositories/categories.repository.ts` ya existía, pero su
  `CATEGORY_INCLUDE` traía `children` con un `include` de un solo nivel: las 6
  nietas del seed (165-168, 169-170) nunca llegaban al payload. El comentario
  de cabecera decía "2 niveles reales" — la causa raíz del bug, no un
  detalle cosmético.
- El mock revela **cuatro** proyecciones de nodo, no dos (ver `design.md`):
  el top-level uniforme (16 claves), el top-level de `gadget`/`medicine` (13
  claves, V-2), el descendiente (16 claves, con `products_count`) y el
  ascendente (14 claves, cadena completa). Reproducirlas todas exige tres
  tipos públicos que no puedan ciclar por construcción (Decisión B) y cuatro
  mappers (Decisión F).
- `parent='all'` no es hipotético: la tienda lo manda cuando el `type` activo
  tiene `layoutType: 'minimal'`, y `daily-needs` es el único type con ese
  layout — la misma vertical que contiene las 6 nietas.

## Scope
**Incluye:** listado (`GET /api/categories`) con `parent`/`search`
(`type.slug:<v>`, `name:<v>`) → árbol de profundidad arbitraria; detalle
(`GET /api/categories/:param`) por id o por slug; 404 de dominio para
`:param` inexistente; 503/500 con `isPrismaConnectionError`.
**NO incluye:** `types`/`tags`/`manufacturers`/`shops` (US-4a) · `authors` ·
endpoints de escritura del admin (`POST`/`PUT`/`DELETE /categories` siguen en
mock) · población de `category_product` · cambios de frontend
(`apps/shop/**`, `apps/admin/**`) · `ExceptionFilter` global.

## Criterios de aceptación

### CA-1 — Paridad de contrato (mock vs. Postgres)
`GET /api/categories` responde con el mismo envoltorio, los mismos ids en el
mismo orden y el mismo key-set (16 claves uniformes, incluidas las 21 raíces
de `gadget`/`medicine` que el mock sirve con 13 — divergencia declarada D-5),
salvo las divergencias documentadas en `design.md` (V-1, V-2, V-3, V-6, V-8).

### CA-2 — El árbol sobrevive el round trip a profundidad 3
La raíz `124` trae `163` en `children`, y `163` (anidado dentro de `124`)
trae `169` y `170` en su propio `children`, cada uno con `icon`/`image`/
`slug` propios y 16 claves. `JSON.stringify` del árbol completo no lanza.

### CA-4 — La tienda navega la vertical con `parent=all`
`GET /en/daily-needs` (la única página con `layoutType: 'minimal'`, la que
manda `parent=all`) responde 200 y renderiza el nombre de una categoría
anidada.

## Escenarios Gherkin
```gherkin
Feature: Árbol de categorías desde Postgres
  Scenario: CA-2 — la cadena de nietos sobrevive el round trip
    Given la base sembrada con just db-up
    When pido GET /api/categories?limit=1000&parent=all&search=type.slug:daily-needs
    Then la raíz 124 trae 163 en children
    And 163 (anidado dentro de 124) trae 169 y 170 en su propio children
    And JSON.stringify del árbol completo no lanza TypeError
```

## Archivos creados / modificados
| Archivo | Cambio |
|---------|--------|
| `packages/db/src/repositories/categories.repository.ts` | **Reescrito** — `CATEGORY_INCLUDE` sin `children`; `_assembleTree` + `descend`/`ascend`/`_immediate`; `CategoryAncestor`/`CategoryDescendant`/`CategoryTreeNode`; `ListCategoriesInput.rootsOnly`+`name`; `findCategoryByIdOrSlug` |
| `packages/db/src/repositories/categories.integration.test.ts` | **Creado** — 13 tests: conteos, profundidad 3, aciclidad, cadena ascendente, `typeSlug`+paginación, `name`, id≡slug, `getCategoryTree` |
| `packages/db/index.ts` | bloque `categories`: exporta los 3 tipos nuevos + `findCategoryByIdOrSlug`; quita `CategoryWithChildren`/`findCategoryBySlug` |
| `db/schema.sql` | comentario de `categories` corregido (198 = 83+109+6, no "2 niveles reales") |
| `apps/api/rest/src/categories/categories.service.ts` | `getCategories`/`getCategory` → `async` sobre `@safari/db`; `parseCategorySearch`; `toCategoryDto`/`toAncestorDto`/`toDescendantDto`/`toEmbeddedType`/`toParentEDto`; `try/catch` 503/500 |

## Definición de Done

- [x] `git grep -n "CategoryWithChildren\|findCategoryBySlug"` antes de
  borrarlos: solo aparecían en `packages/db/index.ts` (el barrel) y en su
  propia definición — ningún consumidor externo.
  ```
  packages/db/index.ts:27:  CategoryWithChildren,
  packages/db/index.ts:31:  findCategoryBySlug,
  packages/db/src/repositories/categories.repository.ts (definiciones propias)
  ```

- [x] `just db-check` en verde, con la suite nueva de 13 tests (profundidad 3
  incluida).
  ```
  Test Files  6 passed (6)
       Tests  48 passed (48)
  ```

- [x] `just db-build` en verde (bloqueante: `dist/` gitignored, Nest lo
  consume vía `link:`).
  ```
  CJS dist\index.js     95.95 KB
  DTS dist\index.d.ts   943.88 KB
  ```

- [x] CA-1 — `curl` mock-vs-Postgres pegado para `gadget` y `daily-needs`.

  **`gadget`** (`type.slug:gadget`, `parent=null`): `filas: 10 -> 10`,
  `ids iguales: true`, `key-set pg` (16 claves uniformes). Únicas rutas de
  diff: `products_count` (V-2, desaparece del top-level), `type.banners`
  (nunca se emite — Decisión F; refinamiento: el mock SÍ trae `banners` en
  el `type` embebido de `gadget`/`medicine` pero NO en el de `daily-needs`,
  algo que `design.md` no distinguió explícitamente), `type.promotional_sliders`
  (`[]`→`null`, V-3, mismo precedente que `/api/types` de US-4a),
  `deleted_at`/`parent_id` (`undefined`→`null`, V-2).

  **`daily-needs`** (`type.slug:daily-needs`, `parent=all`): `filas: 53 -> 53`,
  `ids iguales: true`. Únicas rutas de diff: `children.N.products_count`
  (V-1, siempre 0) y `children.N.children.N.parent` (V-6: forma **E**
  uniforme en vez del escalar `163` a profundidad 2).

  Ninguna ruta de diff cae fuera de V-1/V-2/V-3/V-6/V-8 — el criterio de
  `design.md` ("cualquier otra ruta es un defecto, no una divergencia") se
  cumple.

- [x] CA-2 — el árbol completo sobrevive anidado.
  ```
  n top-level: 53
  124 -> 163,164
  163 -> 169,170
    nieta 169 brown-eggs | icon null | image? true | claves 16
    nieta 170 white-eggs | icon null | image? true | claves 16
  cadena de 169: 163->124
  JSON.stringify no lanza: true
  ```

- [x] CA-2b — detalle por id y por slug dan lo mismo.
  ```
  id==slug: true
  claves mock: 16 -> pg: 16 | mismo orden: true
  ```

- [x] CA-2c — 404 de dominio + proceso Nest vivo.
  ```
  HTTP/1.1 404 Not Found
  {"statusCode":404,"message":"No existe una categoría `no-existe-xyz`.","error":"Not Found"}
  curl /api/types -> 200
  ```

- [x] 503 con la base caída, y recuperación sin pérdida de datos.
  ```
  curl /api/categories?limit=20&parent=null -> 503
  {"statusCode":503,"message":"No se puede conectar con el servicio. Por favor, intenta más tarde.","error":"Service Unavailable"}
  ```
  Nota (deviation frente a `design.md`): `GET /api/types` también respondió
  503 durante la ventana de caída, no 200. `design.md` asumía `/api/types`
  como sonda de "proceso vivo" porque en el momento de escribirse el diseño
  ese endpoint todavía estaba en el mock; **US-4a ya lo migró a Postgres**
  antes de que este change arrancara, así que ahora depende de la misma base.
  El proceso Nest siguió vivo de todas formas — lo prueba el propio cuerpo
  503 bien formado (no un timeout/`ECONNREFUSED`) — y `GET /api/authors`
  (endpoint puramente mock, sin tocar la base) confirmó 200 durante toda la
  prueba. Tras `just db-up`, `/api/types` volvió a 200 sin pérdida de datos.

- [x] D-3 — los dos comentarios corregidos son verificables.
  ```
  WITH RECURSIVE ... -> nivel 0 | 83, nivel 1 | 109, nivel 2 | 6
  grep "nietas\|nietos": db/schema.sql:134,137 y categories.repository.ts:7
  ```

- [x] CA-4 — la tienda navega el layout `minimal` (`parent=all`).
  ```
  just verify
  OK   API    :9001/api/settings  200  5503B  34ms
  OK   Shop   :3003/en  200  190788B  604ms  cards:30
  OK   Admin  :3002/en/login  200  72821B  71228ms  cards:1

  curl :3003/en/daily-needs | grep -c Dairy      -> 1  (200)
  curl :3003/en/grocery     | grep -c Vegetables -> 1  (200)
  ```

## Notas para el agente ejecutor
- Ejecutado como cadena de 2 PRs stacked-to-main: PR #1
  (`categories.repository.ts` + barrel + comentario de `db/schema.sql` +
  suite de integración, cero cambio de contrato HTTP porque la API seguía en
  mock), PR #2 (`categories.service.ts` + este cierre documental).
- Divergencia adicional no anticipada por `design.md`, descubierta al correr
  CA-1: el `type` embebido en las 21 filas de `gadget`/`medicine` del mock
  SÍ trae `banners` (9 claves), mientras que el de `daily-needs` NO (10
  claves, con `created_at`/`updated_at`). `design.md`'s Decisión F afirmaba
  sin matices que "el mock no lo trae en el `type` embebido". El mapper
  implementado (`toEmbeddedType`, 10 claves, nunca emite `banners`) ya sigue
  la especificación tal cual está escrita — la uniformidad ya ratificada en
  D-5/V-2 cubre este caso sin necesitar una decisión nueva. Se documenta
  aquí para que el hallazgo no se pierda.
- Segunda divergencia no anticipada: `/api/types` dejó de servir como sonda
  de "proceso vivo" para el 503 de la base caída, porque US-4a ya lo migró a
  Postgres antes de que esta US arrancara (ver DoD arriba). No requirió
  cambiar código: solo una sonda alternativa (`/api/authors`) para la
  evidencia.
- Se encontraron y mataron **tres** watchers duplicados de `just api-dev`
  corriendo en paralelo (efecto colateral del entorno de la sesión, no del
  código de esta US) que corrompían `apps/api/rest/dist/` a mitad de build;
  tras matar los tres y reconstruir limpio, un único watcher quedó estable
  para el resto de la evidencia.
