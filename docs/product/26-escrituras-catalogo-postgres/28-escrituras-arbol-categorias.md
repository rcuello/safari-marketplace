# US-28 — Escrituras del árbol de categorías

> `categories` es el único agregado con jerarquía: crear, mover y borrar una
> categoría toca `parent_id`, la coherencia con `type_id` y, en el borrado,
> a las hijas. Esta US convierte los tres stubs en escrituras reales con las
> guardas que el DDL no puede expresar (ciclos, mismo type que la madre).

**Épico:** [Épico 26](./README.md)
**Fecha:** 2026-09-09
**Status:** Implementada (2026-09-11) — PR#1 `packages/db`, PR#2 `apps/api/rest`,
PR#3 `categories.service.spec.ts`; evidencia en
`openspec/changes/archive/2026-09-10-escrituras-arbol-categorias/apply-progress.md`
**Depende de:** US-27a
**LOC est.:** ~350 · **LOC real:** ~1612 en 3 PRs encadenados (~761 / ~142 / ~709).
La estimación se re-ancló a ~985 en `design.md` a mitad de vuelo: el ×4.6 es
contra el ~350 original, el ×1.64 que cita el archivo es contra el ~985.

## Historia
**Como** administrador del marketplace, **quiero** que la taxonomía de
navegación se edite desde el panel y quede en la base, **para** que las
categorías que el scraper necesita (`db/README.md:90-104`) puedan
mantenerse sin regenerar el seed.

## Contexto

- `categories.service.ts:185-187` (`create` → `this.categories[0]`),
  `:244-246` (`update`), `:248-250` (`remove` → string). El servicio sigue
  importando `categories.json` y construye un `Fuse` sin uso (`:24-34`).
- El formulario envía `language`, `name`, `slug`, `details`, `image`,
  `icon`, `parent` (id o `null`) y `type_id`
  (`apps/admin/rest/src/components/category/category-form.tsx:222-235`);
  en create reutiliza el `slug` inicial si existe (`:239`).
- `CreateCategoryDto` (`create-category.dto.ts:4-12`) pide `type` y
  `parent` como objetos; el admin manda `type_id` y `parent` numérico. El
  body llega entero (`main.ts:9`): el servicio debe leer lo que el admin
  envía, no lo que el DTO declara (decisión 15 del épico).
- DDL: `db/schema.sql:261-275`. `parent_id … ON DELETE SET NULL` (`:268`),
  `type_id … NOT NULL … ON DELETE CASCADE` (`:269`), CHECK
  `categories_no_autoreferencia` (`:274`). El comentario `:258-259` avisa:
  el CHECK **no** impide un ciclo A→B→A; "quien recorra el árbol necesita
  su propia guarda".
- El seed tiene 198 categorías en 3 niveles (83 raíces, 109 hijas, 6
  nietas; `schema.sql:249-256`). `getCategoryTree`
  (`categories.repository.ts:181`) y `listCategories` (`:195`) se probaron
  con esa profundidad (R-9 del épico).
- Lecturas y proyección: `toCategoryDto` (`categories.service.ts:160-179`,
  16 claves con `type` embebido y `children`), `findCategoryByIdOrSlug`
  (`categories.repository.ts:226`).
- `category_product` está vacía por diseño (`db/README.md:37-40`); borrar
  una categoría solo desenlaza (`schema.sql:425-429`, CASCADE en el pivote).
- Permisos ya aplicados: `ADMIN_ONLY` en las tres escrituras
  (`categories.controller.ts:22-54`). No cambian.
- Tests existentes con conteo: `categories.integration.test.ts:29,77`
  (`198`), `:103,110` (`10` raíces del filtro).

## Scope

**Incluye:** `createCategory`/`updateCategory`/`deleteCategory` en
`@safari/db` con validación de madre (existe, mismo `type_id`, sin ciclo,
sin autorreferencia) y tests de integración; los tres métodos del servicio
migrados con la proyección `toCategoryDto`; eliminación del JSON y `Fuse`;
uso del helper de slug y del mapeo de errores de US-27a.

**NO incluye:** `type`/`parent` como objetos anidados en el DTO (se acepta
`type_id`/`parent` como los envía el admin y se corrige el DTO para
declararlo); mover productos entre categorías; `products_count` real
(sigue `0`, V-1 de US-4b); cambios en `getCategoryTree` salvo que R-9
obligue; frontend.

## Criterios de aceptación

### CA-1 — Crear raíz e hija
`POST /categories` sin `parent` crea una raíz; con `parent` crea una hija
cuya madre existe y pertenece al mismo `type_id`. Respuesta con las 16
claves de `toCategoryDto`, `parent` resuelto como en el `GET`. Madre
inexistente o de otro type → 400.

### CA-2 — Editar y mover sin ciclos
`PUT /categories/:id` actualiza campos y permite cambiar `parent`. Se
rechazan con 400: `parent = id` (autorreferencia, coherente con el CHECK) y
cualquier `parent` que sea descendiente de la categoría (ciclo). `slug` no
cambia aunque cambie `name`.

### CA-3 — Borrar re-enraíza a las hijas
`DELETE /categories/:id` borra la fila; sus hijas quedan con `parent_id =
NULL` (por `SET NULL`) y aparecen como raíces en `GET
/categories?parent=null`; los enlaces `category_product` de la borrada
desaparecen. El `GET` posterior es 404. El comportamiento se declara en el
reporte (es lo que el DDL hace; la alternativa —borrar la rama— no se
implementa).

### CA-4 — Profundidad
Crear una hija bajo una nieta (nivel 4) se acepta y `GET /categories` y
`GET /categories/:slug` la devuelven anidada correctamente, **o** se rechaza
con 400 declarado si `getCategoryTree` no soporta esa profundidad. Una de
las dos, verificada, no supuesta.

### CA-5 — Permisos y contrato
`ADMIN_ONLY` intacto (401 sin token, 403 `store_owner`). Los `GET` no
cambian su key-set ni su conteo tras la corrida de tests.

### CA-6 — Sin mock huérfano ni regresión
El servicio no importa `categories.json` ni `fuse.js`. `just db-check`
(incluidos `toBe(198)`), `npx jest`, `just build-api`, `just verify` verdes.

## Escenarios Gherkin

```gherkin
Feature: Escrituras del arbol de categorias
  Scenario: CA-1 — madre de otro type
    Given la categoria 124 "Dairy & Eggs" del type 7
    When se hace POST /categories con parent 124 y type_id 9
    Then la respuesta es 400

  Scenario: CA-2 — ciclo A -> B -> A
    Given una categoria A raiz y su hija B
    When se hace PUT /categories/A con parent B
    Then la respuesta es 400
    And GET /categories/A sigue con parent null

  Scenario: CA-3 — borrar una madre re-enraiza
    Given una categoria M con hijas H1 y H2
    When se hace DELETE /categories/M
    Then GET /categories/H1 devuelve parent null
    And GET /categories/M devuelve 404
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `packages/db/src/repositories/categories.repository.ts` | `createCategory`/`updateCategory`/`deleteCategory`; guarda de ciclo (recorrido ascendente desde el nuevo `parent`) |
| `packages/db/src/repositories/categories.integration.test.ts` | escrituras, ciclo, re-enraizado, profundidad 4 |
| `packages/db/index.ts` | exportar |
| `apps/api/rest/src/categories/categories.service.ts` | migrar 3 métodos; quitar JSON y `Fuse` |
| `apps/api/rest/src/categories/dto/create-category.dto.ts` | declarar `type_id`, `parent` numérico |
| `apps/api/rest/src/categories/categories.service.spec.ts` | **Crear** — jest mockeando `@safari/db` |

## Definición de Done

- [x] Secuencia `POST raíz → POST hija → GET → reinicio → PUT (mover) →
      DELETE madre → GET hija (parent null) → GET madre 404` pegada, con
      key-set de 16 claves comparado contra el `GET` de una categoría del
      seed. (PR#2, `apply-progress.md` Batch 2 — 16 claves, mismo orden, en
      `POST`/`PUT`/`DELETE`.)
- [x] `curl` de los 400 pegados: madre inexistente, madre de otro type,
      autorreferencia, ciclo. (PR#2, más los dos 400 de forma entera
      `type_id`/`parent` añadidos en la ronda de corrección de PR#1/PR#2 —
      ninguno de los ocho `curl` devolvió 500.)
- [x] Evidencia de CA-4 (nivel 4 servido, o 400 declarado) pegada. (PR#1
      integración + PR#2 confirmado por HTTP: bisnieta a profundidad 4
      servida sin 400, `getCategoryTree` sin tocar.)
- [x] `psql` pegado: conteo de `categories` vuelve a 198 tras los tests.
      (198/83 raíces/0 centinelas, confirmado en PR#1, PR#2 y PR#3.)
- [x] `grep -n "fuse\|@db/"` en `categories.service.ts` → 0 líneas de
      **código** (imports/instancias de `Fuse`/`@db/categories.json`,
      capability real de CA-6). **Redacción de este ítem enmendada en PR#3**:
      el grep literal devuelve 1 línea, no 0 — es prosa histórica preexistente
      en el docstring de `parseCategorySearch` (comparaba la búsqueda SQL
      exacta de `@safari/db` contra el `fuse.js` DIFUSO que tenía el mock),
      confirmada idéntica antes y después de esta US
      (`git show us-28-pr1-db-categorias:...categories.service.ts | grep`),
      en una función que la tarea 3.5 prohíbe tocar. CA-6 (sin `import` ni
      instancia de `Fuse`/`@db/categories.json`) está satisfecha; el
      checkbox media un grep literal, no la capability, y se cierra sobre esa
      base — ver `apply-progress.md` Batch 2, "Issues Found".
- [x] `just db-check`, `npx jest`, `just build-api`, `just verify` verdes,
      con recuentos. (`just db-check` 162/162; `npx jest` 9 suites/173 tests,
      +1 suite/+35 tests sobre el baseline 8/138; `just build-api` limpio;
      `just verify` OK en API/Shop/Admin con contenido real.)
- [x] Status de esta US actualizado y fila del épico marcada.

## Notas para el agente ejecutor

- La guarda de ciclo es un recorrido **ascendente** desde el `parent`
  propuesto hasta la raíz comprobando que no se pase por `id`; con
  profundidad máxima real de 2 saltos es barato. Poner un tope defensivo
  (p. ej. 32 saltos) para no colgar si la base ya trajera un ciclo.
- `type_id` de una hija **debe** igualar el de la madre: el árbol se filtra
  por `type.slug` en la tienda (`parseCategorySearch`,
  `categories.service.ts:44-50`); una hija de otro type sería invisible o
  aparecería bajo la vertical equivocada. Es regla de negocio, no del DDL.
- La respuesta de `POST`/`PUT` necesita `type` embebido y `children`:
  reutilizar `findCategoryByIdOrSlug` tras escribir y proyectar con
  `toCategoryDto`, en vez de construir un `CategoryTreeNode` a mano.
- `image` llega como `{thumbnail, original, id}` y la columna es `jsonb`;
  `icon` llega como string (puede ser `''`). No inventar normalización: se
  guarda lo que llega, como hace el seed.
- `translated_languages` se emite constante `['en']` (V-3 de US-4b); el
  admin decide create vs update mirando esa lista
  (`category-form.tsx:236-238`). Comprobar que la constante no rompe el
  flujo de edición del admin en el navegador (es la única verificación de
  UI de esta US y **no** implica cambiar el frontend).
