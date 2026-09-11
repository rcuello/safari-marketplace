# Verification Report — US-28 «Escrituras del árbol de categorías»

**Change**: `2026-09-10-escrituras-arbol-categorias`
**Branch verificada**: `us-28-pr3-jest-categorias` (`ee8f644`, HEAD) — stack de 3 PRs sobre `main`, nada empujado
**Modo**: Standard (`strict_tdd: false`)
**Artifact store**: openspec-only (Engram NO conectado)
**Fecha de verificación**: 2026-09-11
**Método**: adversarial — todo gate re-ejecutado por el verificador, toda salida de esta sección
observada en esta sesión, nada copiado de `apply-progress.md`.

---

## Veredicto

**PASS WITH WARNINGS**

**READY TO ARCHIVE: YES**, condicionado a cuatro correcciones **de documentación**, ninguna de
código (detalle en «Condiciones para el archive»). Cero defectos CRITICAL. El comportamiento
embarcado es correcto en las seis CA; las advertencias son de **cobertura de regresión** y de
**trazabilidad**, no de conducta observable.

---

## Resumen de completitud

| Métrica | Valor |
|---|---|
| Tareas totales | 26 |
| Tareas marcadas `[x]` | 26 |
| Tareas realmente completas al 100% | 23 |
| Tareas `[x]` con salvedad declarada en su propio texto | 3 (4.5 PARCIAL, 4.8 desviación de método, 6.3 enmienda de DoD) |
| Tareas `[x]` con salvedad **no** declarada | 1 (5.3 — ver W-1) |

---

## 1. Gates: observado vs. reclamado

Todo re-ejecutado por el verificador en esta sesión, en este orden.

| Gate | Reclamado en `apply-progress.md` | Observado ahora | ¿Coincide? |
|---|---|---|---|
| `just db-build` | limpio | `Prisma Client 7.10.0` generado; `tsup` CJS 151.60 KB + DTS 1.39 MB, `Build success` | ✅ |
| `just db-check` | 162/162 | **10 test files / 162 tests passed**, `tsc --noEmit` limpio, 10.50s | ✅ exacto |
| `cd apps/api/rest && npx jest` | 9 suites / 173 tests | **9 passed / 9 total · 173 passed / 173 total**, 38.179s | ✅ exacto |
| `just build-api` | limpio | `nest build` → `Done in 41.81s`, 0 errores | ✅ |
| `just verify` | verde en los 3 | `OK API :9001/api/settings 200 5503B` · `OK Shop :3003/en 200 190788B cards:30` · `OK Admin :3002/en/login 200 72821B` | ✅ |
| `psql` conteos | 198 / 83 raíces / 0 centinelas | `198` · `83` · `0` · (`category_product` = `0`, `types` = `10`) | ✅ exacto |
| **`just build`** (build_command **vinculante** de `openspec/config.yaml`) | **nunca ejecutado por `sdd-apply`** (solo `build-api`) | ejecutado aquí: **exit 0**, `Done in 187.94s`, shop + admin compilados | ✅ **evidencia nueva** |

```text
# just db-check
 Test Files  10 passed (10)
      Tests  162 passed (162)
   Duration  10.50s

# cd apps/api/rest && npx jest
Test Suites: 9 passed, 9 total
Tests:       173 passed, 173 total
Time:        38.179 s

# just verify
OK   API    :9001/api/settings  200  5503B  537ms
OK   Shop   :3003/en  200  190788B  58786ms  cards:30
OK   Admin  :3002/en/login  200  72821B  20229ms  cards:1

# psql (solo lectura)
categories                 -> 198
categories parent_id NULL  ->  83
categories slug LIKE 'zz-%'->   0
category_product           ->   0
```

**Discrepancia contra lo reclamado: ninguna.** Los números de `apply-progress.md` son exactos.
El único hueco era de *alcance* de la evidencia, no de veracidad: el `build_command` de
`openspec/config.yaml` es `just build` y la fase de apply solo cerró con `just build-api`.
Subsanado aquí: `just build` pasa.

---

## 2. Veredicto por criterio de aceptación

Todos verificados **en vivo** por el verificador contra la API arrancada desde este árbol
(`PORT=9001 yarn start:dev`), con token `super_admin` real (`POST /api/token`,
`admin@demo.com`), filas centinela `zz-categories-verify-*` creadas y borradas por HTTP.

| CA | Veredicto | Evidencia que lo decide |
|---|---|---|
| **CA-1** — crear raíz e hija | ✅ **SATISFECHO** | `POST` raíz → `201`, `id=336`, `parent_id=null`, 16 claves **en el mismo orden** que `GET /categories/124`. `POST` hija (`parent:336`, `type_id:7`) → `201`, `parent.id=336`, 16 claves en orden. `GET /categories/zz-categories-verify-raiz` → `children=[337]`. Madre inexistente (`999999`) → `400`; madre de otro type (`124` + `type_id 9`) → `400` con `field` = `parent_id (dentro de type_id 9)` |
| **CA-2** — editar y mover sin ciclos, slug inmutable | ✅ **SATISFECHO** | `PUT {name}` → `200`, `slug` sigue `zz-categories-verify-hija` (inmutable), `updated_at` avanza `…30.275Z → …30.394Z`. `PUT {parent:338}` → `200`, `parent.id=338`, `GET 338` lo trae en `children`. Autorreferencia (`parent === id`) → `400 parent_id (autorreferencia)`. Ciclo A→B (1 salto) → `400 parent_id (ciclo…)`. Ciclo A→C (nieta, 2 saltos) → `400`. En los cuatro rechazos la fila queda intacta |
| **CA-3** — borrar re-enraíza | ⚠️ **PARCIAL (aceptado)** | Mitad **re-enraizado, probada en vivo al 100%**: `DELETE /336` → `200` con snapshot `children=[{id:337,parent_id:336}]` (divergencia declarada: refleja el árbol PRE-borrado), 16 claves en orden; `GET /337` → `parent_id:null`, `parent:null`; `GET /categories?parent=null` la incluye (`total` 83→85 con mis 2 centinelas vivos); `GET /336` → **404**. Mitad **`category_product`: NO probada end-to-end** — ver §7 |
| **CA-4** — profundidad 4 | ✅ **SATISFECHO** (rama «servida», no la rama «400 declarado») | Cadena 100% centinela A(339)→B(340)→C(341); `POST` bisnieta bajo la nieta 341 → **`201`, no 400**. `GET /categories/zz-categories-verify-a` anida `A>B>C>D` = `339>340>341>344`. `GET /categories?limit=400` (lista plana) da `parent.parent.parent.id = 339` para la fila 344. `getCategoryTree` sin tocar (0 líneas de diff) |
| **CA-5** — permisos y contrato | ✅ **SATISFECHO** | Matriz completa sobre las **tres** escrituras: `POST`/`PUT`/`DELETE` sin token → **401**; los mismos con token `store_owner` → **403**. `GET /categories/124` público → `200`, **16 claves**, orden `["id","name","slug","icon","image","details","language","translated_languages","parent","type_id","created_at","updated_at","deleted_at","parent_id","type","children"]`. `git diff --stat main HEAD -- categories.controller.ts` → **0 líneas**. Conteos del seed intactos tras toda la corrida (198/83) |
| **CA-6** — sin mock huérfano ni regresión | ✅ **SATISFECHO** (capability) / ⚠️ el grep literal da 1 | `grep -n "import .*[Ff]use\|new Fuse\|categories.json\|plainToClass"` → **0 coincidencias**. El grep literal `"fuse\|@db/"` devuelve **1** línea: `34: * el \`fuse.js\` difuso del mock, V-4)…` — prosa en el docstring de `parseCategorySearch`. Confirmado idéntico en `main` (`git show main:… \| grep` la trae en `:39`, junto a los 3 hits de código que sí desaparecieron). Los 4 gates, verdes (§1) |

### Batería hostil — 40/40 en 4xx, cero 500

Requisito de esta fase: *un solo 500 reprueba*. Resultado: **0 respuestas ≥500**.

```text
OK  POST   {"parent":"abc"}                 -> 400   OK  PUT  {"parent":"abc"}              -> 400
OK  POST   {"type_id":"abc"}                -> 400   OK  PUT  {"type_id":"abc"}             -> 400
OK  POST   {"parent":1e21}                  -> 400   OK  PUT  {"parent":1e21}               -> 400
OK  POST   {"type_id":1e21}                 -> 400   OK  PUT  {"type_id":1e21}              -> 400
OK  POST   {"parent":9223372036854775808}   -> 400   OK  PUT  {"parent":92233720368547758…} -> 400
OK  POST   {"type_id":9223372036854775808}  -> 400   OK  PUT  {"parent":[]}                 -> 400
OK  POST   {"parent":[]}                    -> 400   OK  PUT  autorreferencia               -> 400
OK  POST   {"parent":{}}                    -> 400   OK  PUT  ciclo A->B->A                 -> 400
OK  POST   {"parent":-1}                    -> 400   OK  PUT  ciclo A->C (2 saltos)         -> 400
OK  POST   {"parent":1.5}                   -> 400   OK  PUT  type_id en nodo CON hijas     -> 400
OK  POST   {} (body vacío)                  -> 400   OK  PUT  {"name":""}                   -> 400
OK  POST   {"type_id":7} (sin name)         -> 400   OK  PUT  id de ruta 1e21               -> 404
OK  POST   {"name":"x"} (sin type_id)       -> 400   OK  PUT  id de ruta abc                -> 404
OK  POST   parent inexistente 999999        -> 400   OK  PUT  id de ruta -5                 -> 404
OK  POST   parent de otro type (124+type 9) -> 400   OK  PUT  id de ruta 1.5                -> 404
OK  POST   type_id inexistente 999999       -> 400   OK  PUT  id de ruta 0                  -> 404
                                                     OK  PUT  id de ruta 92233720368547758… -> 404
                                                     OK  PUT  id inexistente 999999         -> 404
OK  DELETE id de ruta 1e21 / abc / -5 / 1.5 / 9223372036854775808 / 999999 -> 404 (x6)

--- 4xx: 40/40; NO-4xx: 0 ---
contraste regla 7 (hoja raíz, type 7 -> 9) -> 200 type_id=9
```

Discriminadores de `field` comprobados uno a uno y **coincidentes con la tabla de 7 reglas del
spec**: `type_id`, `parent_id`, `parent_id (dentro de type_id N)`, `parent_id (autorreferencia)`,
`parent_id (ciclo: la madre propuesta desciende de esta categoría)`,
`type_id (1 hija(s) con otro type_id)`. El `P2003` de `type_id` inexistente cae en
`categories.desconocida`, **nunca en `slug`** — la corrección del finding 1 del gate de PR#1 está
viva en producción, no solo en el test.

### Limpieza

Las 9 filas centinela creadas por esta verificación (336-344) se borraron **por HTTP**, nunca con
`psql` de escritura. Conteo final re-leído: **198 / 83 / 0**. `git status --porcelain` vacío
(salvo un `sitemap-0.xml` que regenera `just build`, revertido — ver S-2).

---

## 3. Veredicto por requirement del spec

### `specs/category-tree-api/spec.md` — 9 ADDED Requirements, 13 escenarios

| # | Requirement | Veredicto | Escenario(s) | Evidencia que lo decide |
|---|---|---|---|---|
| R1 | Creación de raíz e hijas con madre válida (CA-1) | ✅ **SATISFECHO** | «crear raíz» ✅ COMPLIANT · «crear hija bajo madre válida» ✅ COMPLIANT | `POST` en vivo 201 + 16 claves en orden; integración `createCategory — CA-1` (3 `it`); unidad `create` (11 `it`). `slug` lo calcula `generateSlug` (llamada única, `categorySlugs` local, la tabla nunca llega a `slug.ts`) |
| R2 | Edición y reenraizado sin ciclos, slug inmutable (CA-2) | ✅ **SATISFECHO** | «renombrar no cambia slug» ✅ · «mover a otra madre» ✅ | Vivo + integración `updateCategory — CA-2` (4 `it`). `updated_at` por **monotonía contra el reloj de la base** con `toBeGreaterThan` **estricto** (la corrección del finding 2 está aplicada: con `>=` un trigger congelado pasaría) |
| R3 | Borrado re-enraíza y devuelve snapshot pre-borrado (CA-3) | ⚠️ **PARCIAL** | «borrar madre re-enraíza» ✅ COMPLIANT · «los enlaces de producto desaparecen» ❌ **UNTESTED** | Mitad 1 probada en vivo + integración. Mitad 2 solo a nivel DDL (§7) |
| R4 | Las 7 reglas de la arista responden 400, nunca 500 | ✅ **SATISFECHO** | «no entero → 400» ✅ · «madre inexistente/otro type» ✅ · «autorreferencia y ciclo» ✅ · «type_id con hijas vs. hoja» ✅ | 40/40 en vivo; 8 `it` de integración; `_assertIntegerRef` corre **antes** del dispatch `parentId != null` en create y update (leído en el código, probado con `{"parent":"abc"}` → 400 y no 500) |
| R4b | La violación del CHECK `categories_no_autoreferencia` es **inalcanzable** por HTTP | ✅ **SATISFECHO** | (dentro de R4) | La regla 5 se resuelve en `_assertParentEdge` antes del write; `PUT {parent: id}` → 400 con `field` de aplicación, nunca un error de Postgres. CHECK re-confirmado vivo en la base: `CHECK ((parent_id IS DISTINCT FROM id))` |
| R5 | Profundidad 4 servida de extremo a extremo (CA-4) | ✅ **SATISFECHO** — confirmación empírica hecha, la rama «400 declarado» **no** se activa | «nivel 4 anidado, sin 400» ✅ COMPLIANT | 201 + anidación por `GET /:slug` **y** por la lista; integración `CA-4` (1 `it`, cadena 100% centinela, sin tocar 169/170) |
| R6 | Permisos intactos, lecturas sin cambios (CA-5) | ✅ **SATISFECHO** | «401 sin token, 403 store_owner» ✅ COMPLIANT | 6/6 en vivo (las 3 escrituras × 2); controlador con 0 líneas de diff; key-set del `GET` = 16 en el mismo orden |
| R7 | Sin mock huérfano ni regresión de lectura (CA-6) | ✅ **SATISFECHO** | «sin imports huérfanos y conteos intactos» ⚠️ **PARTIAL** (ver W abajo) | 0 imports/instancias. Conteos `198`/`83`/`53`/`10` verdes dentro de `db-check`. El escenario dice literalmente «no hay coincidencias» y hay 1, de prosa preexistente |
| R8 | `MODIFIED Out of Scope` (prosa, precedente `flat-catalogs-api`) | ✅ **APLICABLE** | n/a | `openspec/specs/category-tree-api/spec.md` existe y su `## Out of Scope` actual coincide con el bloque «Previously» del delta. El merge de `sdd-archive` es un reemplazo literal de esa lista |

**Compliance summary `category-tree-api`: 12/13 escenarios COMPLIANT, 1 UNTESTED** (los enlaces de
producto desaparecen — §7).

### `specs/catalog-write-foundations/spec.md` — 1 MODIFIED Requirement

| Requirement | Veredicto | Evidencia |
|---|---|---|
| Contrato dominio → HTTP, conjunto cerrado de 5 códigos | ✅ **SATISFECHO** | Los 5 códigos tienen test **directo** en `domain-error.mapper.spec.ts` (`EmptySlug`, `InvalidReference`, `RecordNotFound`, `DependentRows`, `SlugConflict`), suite verde dentro de los 9/173. `domain-errors.ts` y `domain-error.mapper.ts`: **0 líneas de diff** — `categories` integra invocando el mapeador desde su `catch`, un solo call site por método, exactamente como exige la requirement |
| Escenario «cada código a su status» | ✅ COMPLIANT | `domain-error.mapper.spec.ts:45-77` |
| Escenario «los cinco probados aunque `types` solo ejercite tres» | ✅ COMPLIANT | idem |
| Escenario «violación de CHECK no pertenece al conjunto cerrado — lección para `products`» | ✅ COMPLIANT | Pre-validación de la regla 5 en código confirmada en vivo (400, no 500) y el CHECK sigue en la base como red de integridad |

---

## 4. Veredicto por línea de la Definición de Done (7 líneas)

| # | Línea de la DoD | Veredicto | Nota del verificador |
|---|---|---|---|
| 1 | Secuencia `POST raíz → POST hija → GET → reinicio → PUT → DELETE → GET hija (parent null) → GET madre 404` con key-set de 16 claves | ✅ **CUMPLIDA** | **Re-ejecutada por mí de cero**, incluido el **reinicio real** de la API (proceso matado, puerto verificado libre, proceso nuevo). La hija sobrevivió al reinicio (`GET /337 → 200, parent_id=336`): persistencia real, no memoria. 16 claves y **mismo orden** en `POST` raíz, `POST` hija, `PUT` y `DELETE` |
| 2 | `curl` de los 400 pegados (madre inexistente, otro type, autorreferencia, ciclo) + los dos de forma entera | ✅ **CUMPLIDA Y EXCEDIDA** | Los 4 pedidos + 36 más. **40/40 en 4xx, cero 500** |
| 3 | Evidencia de CA-4 (nivel 4 servido, o 400 declarado) | ✅ **CUMPLIDA** | Rama «servida» confirmada por HTTP en dos endpoints distintos, con cadena 100% centinela |
| 4 | `psql`: `categories` vuelve a 198 tras los tests | ✅ **CUMPLIDA** | 198 / 83 / 0 antes, y 198 / 83 / 0 después de mis 9 filas centinela |
| 5 | `grep -n "fuse\|@db/"` → 0 líneas — **ENMENDADA en PR#3** | ✅ **CUMPLIDA sobre la redacción enmendada** · la enmienda es **LEGÍTIMA** | Ver el juicio explícito abajo |
| 6 | `just db-check`, `npx jest`, `just build-api`, `just verify` verdes con recuentos | ✅ **CUMPLIDA** | Los 4 re-ejecutados, cifras idénticas a las reclamadas. Añadido `just build` (el `build_command` vinculante de la config), exit 0 |
| 7 | Status de la US actualizado y fila del épico marcada | ✅ **CUMPLIDA** | Status: «Hecho (PR#1/PR#2/PR#3…)». Fila del épico: `~350 (real ~1612, 3 PRs) \| **Implementada** (2026-09-11)`. Cabecera del épico actualizada a «quedan US-29, US-30» |

### Juicio explícito sobre la enmienda de la línea 5: **legítima, NO es mover la portería**

Tres razones, en orden de peso:

1. **La capability normativa no se tocó.** La autoridad sobre el *qué* es
   `specs/category-tree-api/spec.md` R7: «`categories.service.ts` MUST NOT importar
   `@db/categories.json` ni `fuse.js`». Eso está satisfecho **al 100%**: verifiqué
   independientemente 0 `import`, 0 `new Fuse`, 0 `plainToClass`, y las tres líneas de código que
   existían en `main` desaparecieron. La enmienda no relaja ni un ápice el requisito; corrige el
   **instrumento de medida**.
2. **El instrumento estaba mal calibrado desde antes de la US.** El `grep` literal ya devolvía ese
   hit en `main` (línea 39, mismo texto). Es decir: la casilla, tal como se redactó, era
   **inalcanzable el día que se escribió**, independientemente de la implementación. Una DoD que
   no puede cerrarse con código correcto es un defecto de la DoD.
3. **Cumplirla al pie de la letra habría exigido violar una regla vinculante.** El hit vive en el
   docstring de `parseCategorySearch`, y la tarea 3.5 (y `D-6`) prohíben explícitamente tocar esa
   función. Entre «incumplir un literal mal calibrado y decirlo» e «infringir el alcance
   vinculante para pintar un check en verde», la primera es la conducta correcta. El agente eligió
   la primera **y la documentó en el sitio, con la prueba `git show`**, en vez de marcar verde en
   silencio. Eso es lo contrario de mover la portería.

**Salvedad de proceso (no bloqueante):** la enmienda la escribió el mismo agente que implementó el
código, y editó el documento de producto (`docs/product/…/28-….md`), que es el contrato. Aunque el
cambio es de redacción y viene con su evidencia, el patrón —autor edita su propio criterio de
aceptación— merece una ratificación explícita del product owner en el archive. Recomiendo
ratificarla, no revertirla.

---

## 5. Auditoría adversarial de `categories.service.spec.ts` (PR#3 — 659 líneas, 35 tests, sin gate previo)

Criterio aplicado: *para cada `it` significativo, ¿qué mutación de la producción lo pondría en
rojo?* Un test que sobrevive a la mutación que dice cubrir es un test decorativo.

### Lo que resiste (y por qué)

| Test | Mutación que lo pone en rojo | Veredicto |
|---|---|---|
| «proyecta el DTO campo a campo… omite ausentes» (`:186`) | Cambiar cualquier spread condicional por asignación incondicional → aparece `details: undefined`/`parentId: NaN` en el input. `toEqual({name,typeId})` + seis `'x' in calledWith === false` lo detectan | ✅ real |
| «`type_id` STRING `"7"` → `typeId: 7`» (`:231`) | Quitar el `Number(...)` → llega `'7'` string → `toHaveBeenCalledWith` falla | ✅ real |
| **«`parent: null` → `parentId: null`, nunca `Number(null) === 0`»** (`:244`, `:405`) | Quitar la rama `=== null` → `Number(null) = 0` → `{parentId: 0}` ≠ `{parentId: null}` → rojo. Usar `dto.parent ?? undefined` → `{}` ≠ `{parentId: null}` → rojo | ✅ **real** |
| **«`PUT {}` no envía `parent`/`type_id`» + «`PUT {name}` deja el input SIN `parentId`»** (`:387`, `:395`) | Proyección incondicional de `parent` → `{parentId: NaN}`; `toHaveBeenCalledWith(124, {})` falla (jest ignora `undefined`, **no** `NaN`) | ✅ **real** |
| «cada spread condicional POR SEPARADO» (`:427`) | Anidar los dos spreads en un solo condicional → uno de los dos casos falla | ✅ real |
| «`slug` NUNCA se proyecta al update» (`:457`) | Añadir el spread de `slug` → `'slug' in calledWith` pasa a `true` | ✅ real |
| `it.each` de id `NaN`/`0`/`-5`/`1e21` → 404 **sin llamar al repositorio** (`:371`, `:552`) | Volver a `!Number.isInteger(id)` → `1e21` y `0` pasan el guard y el mock se llama → `not.toHaveBeenCalled()` falla. `expect.assertions(3)` además caza el «no lanzó» | ✅ **real** — este es el test que ancla la corrección del gate de PR#2 |
| «snapshot pre-borrado sin volver a consultar» (`:598`) | Añadir un re-fetch tras el delete → `findCategoryByIdOrSlugMock`/`listCategoriesMock` dejan de estar en 0 | ✅ real |
| 5 mapeos de error + `P1001`→503 + `P2011`→500 | Cambiar el `catch` por un `throw error` crudo, o mapear `P2011` a 503 | ✅ reales (`toWriteHttpException` y las clases de dominio quedan **sin mockear**, así que se prueba la traducción de verdad) |

**Sobre los mocks:** no son permisivos. 14 de los 35 `it` afirman `toHaveBeenCalledWith` /
`toHaveBeenLastCalledWith` con el objeto **completo**, no con `expect.anything()`. Un argumento
equivocado a `@safari/db` se detecta.

**Sobre el contrato de 16 claves en ORDEN (`:633`):** el idiom de la casa está respetado —
`expect(expectedKeys).toHaveLength(16)` y comparación con `toEqual` sobre el **array** de claves,
que es sensible al orden, **sin `.sort()` en ninguna parte del archivo**. Confirmado por lectura
completa. No es tautológico en el sentido fuerte (detectaría el viejo `remove` que devolvía un
string, o un método que dejara de pasar por `toCategoryDto`), pero sí es **estructuralmente débil**
→ S-1.

### Lo que NO resiste

**W-1 — `DependentRowsError` importado y jamás ejercitado.** La línea 37 lo importa; `grep` en todo
el archivo devuelve esa única línea. La tarea 5.3 dice literalmente «Cover **each of the 5** domain-error
classes → its HTTP status», y `design.md:617-631` prescribe «el cuadro de escenarios de
`types.service.spec.ts:89-293`», que **sí** incluye `DependentRowsError → 409`. Los tres specs
hermanos (`types`, `tags`, `manufacturers`) lo tienen; este no. El import colgante es el delator.

*Por qué NO es CRITICAL:* la requirement normativa de `catalog-write-foundations` exige que los 5
códigos tengan **un test directo, sin depender de una ruta HTTP**, y eso se cumple en
`domain-error.mapper.spec.ts` (verificado: los 5, líneas 45-77, suite verde). Además,
`DependentRowsError` es **inalcanzable** para `categories` sobre HTTP: consulté las constraints
reales de la base y ninguna FK apunta a `categories` con `RESTRICT` —
`categories_parent_id_fkey` es `ON DELETE SET NULL` y `category_product_category_id_fkey` es
`ON DELETE CASCADE`. Es una desviación del patrón de la casa y de la tarea, no un hueco de
capability. **WARNING**, tarea 5.3 al 4/5.

**W-2 — el hueco de cobertura de mayor riesgo está en el repositorio, no en el servicio.** Esta es
mi observación más importante y no aparece en `apply-progress.md`.

La semántica `Partial` está cubierta **a nivel de servicio** (tests reales, ver arriba), pero
**ningún test de ninguna capa cubre la mitad de repositorio**. Concretamente, en
`updateCategory` estas dos líneas no tienen red:

```ts
const effectiveParentId =
  input.parentId !== undefined ? input.parentId : _id(current.parentId);
// ...
...(input.parentId !== undefined && { parentId: input.parentId }),
```

Mutación que **sobrevive a las 162 pruebas de `just db-check`**: cambiar el spread por
`parentId: input.parentId ?? null`. Recorrí los 5 `it` de `updateCategory` y los 8 de las 7 reglas:
todos los que renombran o cambian `type_id` operan sobre **raíces** (`parentId` ya `null`), y los
que mueven pasan `parentId` **explícito**. Ninguno renombra una **hija** ni pasa
`parentId: null` explícito. Resultado: un futuro refactor que re-enraíce en silencio a toda
categoría renombrada pasaría el gate en verde.

*El código de hoy es correcto* — lo probé en vivo, que es justo lo que un test de regresión debe
capturar y no captura:

```text
== PUT rename SIN `parent` en el body ==
  status=200 name=… slug=zz-categories-verify-hija parent_id=336   <- conservado, NO re-enraizado
== PUT parent:null explícito ==
  status=200 parent_id=null parent=null                            <- limpia, como debe
```

**No bloquea el archive** (el comportamiento embarcado es correcto y está probado por mí), pero es
deuda de test que debe quedar registrada: son exactamente dos `it` en
`categories.integration.test.ts`.

---

## 6. Cumplimiento de alcance — el «NO incluye» es vinculante

`git diff --stat main HEAD` toca 15 archivos: 4 de código, 1 de test de API, 1 de test de db, 2 de
docs de producto, 7 de artefactos SDD. Comprobación ruta por ruta:

| Prohibición del «NO incluye» / de las tareas | Comprobación | Resultado |
|---|---|---|
| `type`/`parent` como objetos anidados en el DTO | `create-category.dto.ts`: se **sacan** `'type'`/`'parent'` del `PickType` y se declaran `type_id: number`, `parent?: number \| null`, `slug?: string` planos. `entities/category.entity.ts` → **0 líneas** | ✅ respetado (es exactamente la «corrección del DTO» autorizada) |
| Mover productos entre categorías | `apps/api/rest/src/products` → **0 líneas**; `category_product` → 0 código | ✅ |
| `products_count` real | Sin cambios; sigue constante `0` en `toDescendantDto` (divergencia 5 preexistente) | ✅ |
| Cambios en `getCategoryTree` | `git diff main HEAD -- categories.repository.ts \| grep -c "^-"` → **1**, que es la cabecera `--- a/…`: **cero líneas eliminadas**, el diff es 100% aditivo. `getCategoryTree`, `listCategories`, `findCategoryByIdOrSlug`, `_assembleTree`, `_loadFlat` intactos | ✅ |
| Frontend | `apps/shop` → 0 · `apps/admin` → 0 | ✅ |
| `db/schema.sql` | 0 líneas · `db/seed.sql` 0 · `packages/db/prisma` 0 | ✅ |
| `domain-errors.ts` / el mapeador | `packages/db/src/domain-errors.ts` → 0 · `apps/api/rest/src/common/errors` → 0 | ✅ (la requirement de `catalog-write-foundations` lo exige: un call site, cero cambios en el mapeador) |
| `categories.controller.ts` / permisos | 0 líneas | ✅ |
| `update-category.dto.ts` | 0 líneas | ✅ |
| No tocar `getCategories`/`getCategory`/`toCategoryDto`/`parseCategorySearch` | Las únicas 19 líneas eliminadas del servicio son, una a una, el mock: `plainToClass`, `Fuse`, `categoriesJson`, las constantes `categories`/`options`/`fuse`, el campo `private categories` y los 3 stubs | ✅ |

**Veredicto de alcance: limpio.** Ni una mejora adyacente accionada. `CLAUDE.md` sigue diciendo
«4 suites / 65 tests» (obsoleto: hoy son 9/173) y **no se tocó** — adyacente mencionado, no
accionado, tal como manda la disciplina de alcance.

---

## 7. Veredicto independiente sobre la verificación diferida de CA-3

**Pregunta:** ¿es legítimo cerrar CA-3 con la mitad `category_product` probada solo a nivel DDL, o
debe bloquear el archive?

**Mi veredicto: LEGÍTIMO. NO bloquea el archive.** Coincido con la revisión previa, pero por
razones que verifiqué yo mismo, no por deferencia:

1. **Esta US no escribe una sola línea que toque `category_product`.** El desenlace es 100% DDL
   preexistente. Re-confirmado por mí, solo lectura, contra la base viva:
   `category_product_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE`.
   No hay código nuevo cuya corrección esté en duda: no hay nada que probar de esta US.
2. **La tabla está vacía por diseño** (`db/README.md:37-40`) — lo confirmé: `count(*) = 0`. No
   existe una ruta HTTP que la pueble: `products.service.ts` `create`/`update` siguen siendo stubs
   hasta US-29.
3. **Poblarla habría exigido salir del contrato.** El único camino era un `INSERT` por `psql`, y
   tanto la sesión de apply como **la mía** están limitadas a `psql` de solo lectura. Un agente que
   hubiera escrito igualmente en la base para pintar un check verde habría cometido una infracción
   mayor que la que evita.
4. **La mitad observable de CA-3 —la que sí depende de código nuevo— está probada al 100% y en
   vivo por mí**: el snapshot pre-borrado, el re-enraizado por `SET NULL`, la aparición en
   `?parent=null` y el 404 posterior.

**Pero con una condición de honestidad, que sí es vinculante para el archive:** el escenario
«CA-3 — los enlaces de producto desaparecen» debe quedar marcado **UNTESTED** en la matriz de
cumplimiento del spec archivado, y US-29 debe heredarlo explícitamente como comprobación de
cierre. Archivarlo como COMPLIANT sería falsear el registro. Con esa marca, «verification deferred
to US-29» es una descripción exacta, no una excusa.

---

## 8. Los dos follow-ups: ¿siguen sin implementar? ¿están bien registrados?

| Follow-up | ¿Se coló en este change? | ¿Registrado? |
|---|---|---|
| Ticket de reloj de `categories` (`@default(now())` de Node vs. `dbgenerated("now()")`; `updated_at` puede quedar **anterior** a `created_at`; exige DDL + `db-reset`) | ❌ **NO** — `db/schema.sql` 0 líneas, `packages/db/prisma` 0 líneas, `prisma/schema.prisma` intacto. El test de integración lo esquiva correctamente comparando **UPDATE vs. UPDATE** (mismo reloj, el del trigger), nunca create vs. update | ⚠️ solo en `apply-progress.md` |
| Hueco `Number.isInteger` sin `isSafeInteger` en los guards de id de ruta de `types`/`tags`/`manufacturers` | ❌ **NO** — `grep` confirma `!Number.isInteger(id)` intacto en los 3 servicios (7 call sites). **Reproducido en vivo por mí**: `PUT /api/types/1e21` → **500**, `PUT /api/tags/1e21` → **500**, `PUT /api/manufacturers/1e21` → **500**; contraste `PUT /api/categories/1e21` → **404**. El defecto es real, sigue abierto y está **correctamente fuera** de esta US | ⚠️ solo en `apply-progress.md` |

**W-3 — el registro no es duradero.** Busqué ambos en `docs/product/**` y `openspec/specs/**`:
cero coincidencias de `isSafeInteger`, `dbgenerated`, «clock-drift» o «reloj». Viven únicamente
dentro de `openspec/changes/2026-09-10-escrituras-arbol-categorias/apply-progress.md`, que
`sdd-archive` va a mover a `openspec/changes/archive/`. El archive es traza de auditoría: nadie lo
consulta al planificar el siguiente sprint. El segundo ticket es un **HTTP 500 en vivo sobre código
ya fusionado** (US-27a/27b), no una idea de mejora. Necesita una superficie que se lea:
la sección «deuda declarada» del README del Épico 26, o una US propia.

---

## 9. Desviación de proceso auto-reportada por PR#3 — re-confirmada sin residuo

El agente de PR#3 declaró haber editado brevemente `categories.service.ts` (archivo que tenía
prohibido tocar) para una prueba de mutación, y haberlo revertido antes de correr ningún test.
Comprobación independiente, por hash de blob en todo el stack:

```text
main                       2924fcd58a7c8ccce11db7dc5617282cd7d3e6e3
us-28-pr1-db-categorias    2924fcd58a7c8ccce11db7dc5617282cd7d3e6e3
us-28-pr2-api-categorias   42b6073d4238706c2ce6850753d1ce1320033100
us-28-pr3-jest-categorias  42b6073d4238706c2ce6850753d1ce1320033100   <- idéntico a PR#2
```

`git diff us-28-pr2-api-categorias us-28-pr3-jest-categorias -- …/categories.service.ts` → **0
líneas**. Los 5 archivos que PR#3 toca son el spec nuevo, 2 docs de producto, `apply-progress.md` y
`tasks.md`. `git status --porcelain` vacío, `git stash list` vacío, 8 commits entre `main` y HEAD,
ninguno suelto. **Cero residuo, en ninguna rama del stack.** La divulgación fue honesta y la
reversión, completa.

---

## 10. Coherencia con `design.md`

| Decisión | ¿Seguida? | Nota |
|---|---|---|
| DD28-1 — `deleteCategory` devuelve el nodo **pre-borrado** | ✅ | `_loadNode` antes del `delete`, doble uso (existencia + snapshot). Divergencia declarada visible en vivo: `children[0].parent_id = 336` con la 336 ya borrada |
| DD28-2 — re-fetch en el **repositorio**, vía `_loadNode`, nunca `findCategoryByIdOrSlug` | ✅ | `_assembleTree(await _loadFlat()).get(id)`; el test unitario prueba que el servicio no re-consulta |
| DD28-3 — 7 reglas, `_id()` en toda frontera `bigint` | ✅ | `_id()` presente en `parent.typeId`, `parent.parentId`, `row.parentId`, `current.typeId`, `current.parentId`, `row.id`. Las 7 reglas verificadas en vivo con su `field` |
| DD28-4 — ciclo privado, iterativo, tope 32 | ✅ | `MAX_ANCESTOR_HOPS = 32`, arranque en `_id(parent.parentId)`. La rama del tope queda sin test: **divergencia 4 ya declarada** en el design |
| DD28-5 — `type_id` mutable, invariante en los dos lados | ✅ | Regla 7 en vivo: nodo con hijas → 400; hoja raíz → 200 con `type_id=9` |
| DD28-6 — sin `$transaction`, carrera aceptada | ✅ | Declarado |
| DD28-7 — `updatedAt` por trigger, nunca a mano | ✅ | El `data` del update no fija `updatedAt`; monotonía observada en vivo (+119 ms entre dos writes) |
| DD28-8 — `generateSlug` en create, `normalizeSlug` desechado en update | ✅ | `categorySlugs` local; el resultado de `normalizeSlug` se descarta (solo su `EmptySlugError`) |
| DD28-9 — DTO standalone sin efecto de runtime | ✅ | `ValidationPipe` sin `transform`/`whitelist`: comprobado en vivo, `{"type_id":"7"}` llega string y lo coerciona el servicio |
| DD28-10 — `Number(...)` en el servicio, spreads condicionales separados | ✅ | Probado en unidad y en vivo |
| Testing Strategy — spec de API según `types.service.spec.ts:89-293` | ⚠️ **desviación** | Falta el escenario `DependentRowsError → 409` del cuadro de referencia (W-1) |

---

## 11. Issues Found

### CRITICAL
**Ninguno.**

### WARNING

- **W-1 — Tarea 5.3 al 4/5: `DependentRowsError` importado y nunca probado en
  `categories.service.spec.ts`.** Desvía del cuadro de escenarios que `design.md` prescribe y del
  patrón de los 3 specs hermanos; deja un import colgante. Mitigado porque el conjunto cerrado de 5
  códigos tiene test directo en `domain-error.mapper.spec.ts` y porque el código es inalcanzable
  para `categories` (ninguna FK con `RESTRICT` apunta a la tabla). *Acción sugerida: un `it` de 8
  líneas, o quitar el import y anotar por qué.*
- **W-2 — La semántica `undefined` vs. `null` de `parentId` no tiene red en el repositorio.** La
  mutación `...(input.parentId !== undefined && {parentId})` → `parentId: input.parentId ?? null`
  **sobrevive a las 162 pruebas de `just db-check`**, porque todos los `it` de `updateCategory`
  renombran raíces o mueven con `parentId` explícito. El comportamiento actual es correcto
  (verificado en vivo), pero un refactor futuro re-enraizaría en silencio toda categoría renombrada
  sin poner ningún gate en rojo. *Acción sugerida: dos `it` en `categories.integration.test.ts` —
  renombrar una **hija** y comprobar `parentId` conservado; `updateCategory(id, {parentId: null})`
  y comprobar re-enraizado.*
- **W-3 — Los dos follow-ups solo viven en `apply-progress.md`, que el archive convierte en traza
  de auditoría.** El de `types`/`tags`/`manufacturers` es un **HTTP 500 reproducible hoy en código
  ya fusionado** (lo reproduje en los tres endpoints). *Acción sugerida: llevarlos a la sección
  «deuda declarada» del README del Épico 26 o abrir US propias, **antes** de archivar.*
- **W-4 — Tres tareas marcadas `[x]` cuyo propio texto dice PARCIAL o desviación de método** (4.5
  cascada de `category_product`, 4.8 smoke del admin, 5.3 implícitamente). Un lector del archive que
  solo mire las casillas leerá 26/26 completas. *Acción sugerida: marcar 4.5 y 4.8 como `[~]` en
  `tasks.md` (el símbolo ya se usa en `apply-progress.md`), o dejar el matiz visible en el resumen.*

### SUGGESTION

- **S-1 — El test de las 16 claves es estructuralmente débil.** `create`, `update`, `remove` y
  `getCategory` proyectan el **mismo** nodo con la **misma** función `toCategoryDto`, así que la
  igualdad de claves es cierta por construcción. Detecta que una escritura deje de pasar por el
  proyector (el viejo `remove` devolvía un string), pero no puede detectar deriva de orden entre
  lectura y escritura, porque tal deriva es imposible. El orden **sí** está bien afirmado
  (`toEqual` sobre arrays, sin `.sort()` en todo el archivo). Sin acción; anotarlo para no
  sobrevalorar la señal.
- **S-2 — `just build` ensucia un archivo versionado.** Regenera
  `apps/shop/public/sitemap-0.xml` con timestamps nuevos (269 líneas). Preexistente, ajeno a
  US-28; revertido por mí. Vale un `.gitignore` o un ticket de higiene del repo.
- **S-3 — `updateCategory` valida el slug antes de comprobar la existencia.** `PUT
  /categories/999999 {"name":""}` devuelve 400 (`EmptySlug`) donde 404 sería más informativo.
  Consistente con el precedente `updateType`; cosmético.
- **S-4 — Sobrecosto de estimación, para el registro del épico.** PR#3 pronosticado en ~365 líneas,
  entregado en 659 (+80%); la US completa, ~350 estimadas contra ~1612 reales. Es el tercer
  sobrecosto consecutivo del Épico 26 (US-27a +103%, US-27b +156%). Gobernanza de backlog, no
  defecto: el reparto en 3 PRs mantuvo cada revisión manejable y el escape hatch de US-28b se
  resolvió explícitamente antes de empezar. *Esto es del product owner, no del equipo.*

---

## Condiciones para el archive (las 4, todas de documentación)

1. Marcar el escenario «CA-3 — los enlaces de producto desaparecen» como **UNTESTED / verificación
   diferida a US-29** en el spec que se fusione a `openspec/specs/category-tree-api/spec.md`, y
   heredar la comprobación en US-29. (§7)
2. Llevar los dos follow-ups a una superficie de planificación duradera antes de que
   `apply-progress.md` se archive. (W-3)
3. Ratificación explícita del product owner sobre la enmienda de la línea 5 de la DoD — mi juicio es
   que es legítima y debe ratificarse, no revertirse. (§4)
4. Reflejar en `tasks.md` que 4.5 y 4.8 son parciales/desviadas, y que 5.3 cubre 4 de 5 clases de
   error. (W-4, W-1)

Ninguna exige tocar código, tests ni el comportamiento embarcado. **Las 6 CA están satisfechas
(CA-3 parcial y declarada), los 5 gates reclamados se reprodujeron exactamente, `just build` se
añadió como evidencia nueva, la batería hostil dio 40/40 en 4xx sin un solo 500, el alcance se
respetó sin una sola mejora adyacente accionada y no hay residuo de la desviación de PR#3.**

---

**Evidencia de limpieza final**: `categories` = 198 · raíces = 83 · `slug LIKE 'zz-%'` = 0 ·
`git status --porcelain` vacío · puertos 9001/3003/3002 libres · rama `us-28-pr3-jest-categorias`,
sin commits, merges ni pushes creados por esta fase.
