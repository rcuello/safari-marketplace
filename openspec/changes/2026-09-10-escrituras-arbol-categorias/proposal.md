# Proposal: Escrituras del árbol de categorías

> **US-28** del Épico 26, hoja que depende solo de US-27a. Las decisiones 1-15 y
> `D-1..D-6` / `R-1..R-9` del épico son **vinculantes**; las propias usan prefijo
> `D28-N` / `R28-N`. Insumo primario: `exploration.md` de este change (tres drifts
> de línea corregidos allí — **no citar `:181/:195/:226` de la US**). Esta US
> **no crea piezas compartidas: las consume** (`CA-7` de `catalog-write-foundations`).

## Intent

`categories.service.ts:185-187` devuelve `this.categories[0]` en `create`,
`:244-246` lo mismo en `update` y `:248-250` un string en `remove`. Un
administrador edita la taxonomía en el panel, ve el toast de "actualizado" y
**no cambia ninguna fila**. Es el modo de fallo silencioso que define al épico.

`categories` es además el **único agregado con jerarquía**: crear, mover y borrar
tocan `parent_id`, la coherencia con `type_id` y a las hijas. Las guardas que el
DDL **no** puede expresar (ciclo A→B→A, mismo `type` que la madre) son el
contenido real de esta US. Cerrarla permite mantener desde el panel las
categorías que el scraper necesita (`db/README.md:90-104`) sin regenerar el seed.

## Scope

### In Scope

- `createCategory` / `updateCategory` / `deleteCategory` en
  `packages/db/src/repositories/categories.repository.ts` (mismo archivo que las
  lecturas, `D-2`), con inputs tipados campo a campo y validación de madre.
- Guarda de ciclo y de autorreferencia **en código de aplicación** (`D28-1`).
- Tests de integración con centinela propio (`D28-8`), incluida la cadena de
  nivel 4 de `CA-4`.
- Barrel `packages/db/index.ts`: 3 funciones + 2 tipos de input.
- Los 3 métodos de `categories.service.ts` migrados con la proyección
  `toCategoryDto` (16 claves, `:160-179`); fuera `@db/categories.json` y el
  `Fuse` sin uso (`:24-34`).
- `CreateCategoryDto` declarando `type_id` y `parent` numéricos (decisión 15).
- `apps/api/rest/src/categories/categories.service.spec.ts` — **nuevo**.

### Out of Scope (vinculante — "NO incluye" de la US)

- **`type`/`parent` como objetos anidados en el DTO.** Se acepta lo que el admin
  envía de verdad (`category-form.tsx:234-235`: `parent` numérico o `null`,
  `type_id` numérico) y **solo se corrige la declaración**.
- **Mover productos entre categorías** y poblar `category_product` (US-29).
- **`products_count` real**: sigue constante `0` (V-1 de US-4b).
- **Cambios en `getCategoryTree`** — `R-9` no obliga (ver `D28-7`).
- **Frontend** (decisión 14). La única verificación de UI es un smoke-test en el
  navegador, sin editar `apps/admin` (ver `R28-4`).
- Modificar las piezas compartidas de US-27a (`slug.ts`, `domain-errors.ts`,
  `common/errors/`), `db/schema.sql`, controladores y permisos (`CA-5`).
- `types` (US-27a) · `tags`/`manufacturers` (US-27b) · `products` (US-29) ·
  `shops` (US-30). Adyacente no accionado: el conteo obsoleto de suites de jest
  en `CLAUDE.md` ("4 suites / 65 tests"; hoy hay 8 archivos spec).

## Capabilities

### New Capabilities

- **None.** US-28 no introduce capacidades: consume `catalog-write-foundations` y
  extiende `category-tree-api`.

### Modified Capabilities

- `category-tree-api`: **ADDED** los requirements de escritura (creación de raíz
  e hija con madre válida; edición y movimiento sin ciclos; borrado que
  re-enraíza; profundidad arbitraria confirmada en escritura; errores de dominio
  sin 500; permisos sin cambios) y **MODIFIED** su bloque *Out of Scope*
  (`spec.md:178-184`), que hoy parquea "endpoints de escritura del admin
  (`POST`/`PUT`/`DELETE /categories`, siguen en mock)". **Ningún requirement de
  lectura cambia** (`D-6`): key-set de 16 claves (`:113`), `products_count`
  constante (`:129`), divergencias del `type` embebido (`:142`) y el 503 (`:102`)
  se preservan verbatim.
- `catalog-write-foundations`: **ADDED un único escenario** al requirement
  "Contrato dominio → HTTP es un conjunto cerrado de 5 códigos" (`spec.md:81`),
  documentando que **una violación de CHECK de Postgres NO pertenece al conjunto
  cerrado** y por tanto toda regla expresada como CHECK debe pre-validarse en
  código. Es la lección que US-29 necesita (`products` tiene tres CHECKs).
  **Ningún requirement MODIFIED, ningún archivo fuente tocado.**

## Approach — decisiones cerradas

| # | Decisión | Fundamento |
|---|---|---|
| **D28-1** | Las cuatro reglas de la madre (**existe**, **mismo `type_id`**, **no autorreferencia**, **no ciclo**) se validan en el repositorio **antes** del write y lanzan `InvalidReferenceError` → 400. El CHECK `categories_no_autoreferencia` (`db/schema.sql:274`) queda como red de integridad, no como comportamiento de la API. | **Riesgo #1 de la exploración.** `translateCatalogWriteError` (`domain-errors.ts:135-165`) reconoce **solo** `P2002`/`P2003`/`P2025`; una violación de CHECK pasa sin traducir y `toWriteHttpException` la degrada a **HTTP 500**, rompiendo la decisión 6 del épico ("nunca 500") y `CA-2`. El `type_id` de la madre no tiene ni CHECK ni trigger: es regla de negocio pura (la tienda filtra por `type.slug`, `parseCategorySearch`, `categories.service.ts:44-50`). |
| **D28-2** | Guarda de ciclo = **Enfoque A**: recorrido ascendente **iterativo** desde el `parent` propuesto, `findUnique({select:{id,parentId}})` por salto, tope defensivo de **32 saltos**. | Es literalmente lo que prescriben las "Notas para el agente ejecutor" de la US. Profundidad real = 2 saltos, así que son 1-3 round trips, no 32. No reutiliza los internos `_`-privados de `_assembleTree` ni duplica la lectura de 198 filas. Cliente Prisma, **no** CTE recursiva: el único `$queryRaw` del paquete es `slug.ts`, y `category-tree-api` D-1 decidió explícitamente evitar formas de query recursivas. |
| **D28-3** | `updateCategory` **no** fija `updatedAt: now()` a mano, a diferencia de `updateType`/`updateTag`/`updateManufacturer`. | `categories` **sí** tiene trigger (`db/schema.sql:489-490`); la decisión 9 del épico solo cubre las tres tablas sin trigger. Copiar la línea funcionaría pero es ruido inconsistente con su motivo. |
| **D28-4** | Respuesta de `POST`/`PUT` = **re-fetch** con `findCategoryByIdOrSlug` + `toCategoryDto` (16 claves), nunca un `CategoryTreeNode` armado a mano. | Instrucción explícita de la US + decisión 3 y `D-6`. `toCategoryDto` necesita `type` embebido y `children`, que el `CategoryRecord` plano no trae. **La forma de la respuesta de `DELETE` queda abierta — ver *Decisiones pendientes*.** |
| **D28-5** | Slug: `generateSlug({name, slug}, categorySlugs, 'categories')` con un `categorySlugs: ExistingSlugLookup` **local a `categories.repository.ts`**. Inmutable en update: `UpdateCategoryInput` omite `slug` a nivel de tipo y, si llega `name`, se llama `normalizeSlug` solo por su efecto `EmptySlugError`. | Decisión 4 + `CA-7`: el nombre de tabla nunca llega al código compartido. Patrón idéntico a `typeSlugs`/`tagSlugs`. |
| **D28-6** | `deleteCategory` **sin guarda de dependientes ni 409**: `find-then-delete`, `RecordNotFoundError` → 404. El re-enraizado de las hijas lo hace Postgres (`parent_id … ON DELETE SET NULL`, `db/schema.sql:268`) y el desenlace, `category_product` en CASCADE (`:425-429`). Cero código de re-enraizado. | Decisión 7 del épico. `R-1` (los CASCADE que borran productos) **no aplica**: ningún camino desde `categories` alcanza `products` con CASCADE. |
| **D28-7** | **`CA-4` se compromete con la rama "nivel 4 se sirve, sin 400"**; `getCategoryTree`, `listCategories`, `findCategoryByIdOrSlug` y los mappers **no se tocan**. | `_assembleTree` (`categories.repository.ts:91-171`) monta el árbol sobre una `findMany()` **plana**: `descend`/`ascend` recursan sin contador de profundidad ni tope; su guarda por `path` es anti-corrupción, no un límite de negocio. La cabecera del archivo documenta que se reescribió **para eliminar** el techo del `include` anidado. **Es una conclusión estática: `sdd-apply`/`sdd-verify` deben confirmarla empíricamente** (la US exige "verificada, no supuesta"). Si el experimento la desmiente, se vuelve a la rama "400 declarado" y se replantea. |
| **D28-8** | Centinela **`zz-categories-`**; `cleanup()` = `deleteMany({where:{slug:{startsWith}}})` en `beforeAll` **y plegado dentro del `afterAll` existente** (`try { cleanup() } finally { $disconnect() }`), nunca un segundo `afterAll`. Los describes de escritura se **añaden después** de los de lectura. La cadena de nivel 4 es **100 % centinela** (4 filas propias, mismo `type_id`), sin colgar de la semilla `169`/`170`. | Decisión 13 / `R-4`. El archivo es hoy **solo lectura** (cabecera `:1-6`) y afirma conteos exactos: `198` (`:29`, `:77`), `83` (`:24`), `53` (`:40`), `10` (`:103`, `:110`). Un segundo `afterAll` correría LIFO contra un cliente ya desconectado (`sequence.hooks: 'stack'`); precedente literal en `types.integration.test.ts`. |
| **D28-9** | `CreateCategoryDto` declara **`type_id: number` y `parent: number \| null` como propiedades standalone**, quitando `'type'` y `'parent'` del `PickType`. **`category.entity.ts` no se toca.** | Decisión 15: el DTO es la documentación Swagger. Precedente: `D27b-1` y `create-manufacturer.dto.ts:18` (`shop_id?: string` standalone). Tocar la entidad la sacaría de la tabla de archivos de la US y `Category` se reutiliza. Sin `whitelist` (decisión 5). |

## Affected Areas

| Área | Impacto | Cambio |
|---|---|---|
| `packages/db/src/repositories/categories.repository.ts` (249 líneas hoy) | Modified | +3 funciones, +2 inputs, `categorySlugs`, guarda de ciclo/type. **`_assembleTree` y las 3 lecturas intactas** (`D28-7`) |
| `packages/db/src/repositories/categories.integration.test.ts` (175) | Modified | Describes de escritura tras los de lectura + centinela (`D28-8`) |
| `packages/db/index.ts` (151) | Modified | Barrel: 3 funciones + 2 tipos. **Único archivo compartido con US-29/30**: quien arranque segundo rebasea |
| `apps/api/rest/src/categories/categories.service.ts` (251) | Modified | 3 métodos migrados; fuera `Fuse` (`:24`,`:34`) y `@db/categories.json` (`:25`) |
| `apps/api/rest/src/categories/dto/create-category.dto.ts` (12) | Modified | `type_id` / `parent` numéricos (`D28-9`) |
| `apps/api/rest/src/categories/categories.service.spec.ts` | **New** | Jest con `@safari/db` mockeado; contrato de 16 claves sin `.sort()` |
| `slug.ts`, `domain-errors.ts`, `common/errors/`, `category.entity.ts`, controlador, `db/schema.sql`, `apps/{shop,admin}` | **Unchanged** | `CA-7` + decisiones 1 y 14 |

## Risks

| # | Riesgo | Sev. | Mitigación |
|---|---|---|---|
| **R28-1** | Delegar autorreferencia o ciclo al DDL produce un código de error **fuera** del conjunto cerrado de `translateCatalogWriteError` → **HTTP 500**, rompiendo `CA-2` y la decisión 6. | **Alto** | `D28-1`: pre-validación en código. Test de integración **y** `curl` de los cuatro 400 (madre inexistente, madre de otro type, autorreferencia, ciclo). |
| **R28-2** | Romper los asserts por conteo del archivo de integración (`198`/`83`/`53`/`10`): nunca tuvo convención de limpieza. Una corrida abortada deja basura. | **Alto** | `D28-8` replicado literal de `types.integration.test.ts`; `psql` de cierre `SELECT count(*) FROM categories` → **198**. |
| **R28-3** | `CA-4` es hoy una conclusión **estática**. Si la profundidad 4 fallara, cambia la forma de `CA-4` y potencialmente el alcance (`R-9`). | Medio | `D28-7`: test de integración con cadena centinela de 4 niveles **+** `GET /categories` y `GET /categories/:slug` reales. Es evidencia obligatoria de la DoD. |
| **R28-4** | `translated_languages: ['en']` constante: el admin elige create vs update con `initialValues.translated_languages.includes(router.locale!)` (`category-form.tsx:237-240`). En un locale ≠ `en` siempre iría por `createCategory`. | Medio | **Condición preexistente de la lectura ya embarcada** (`categories.service.ts:169`), no la introduce esta US. Acción correcta: smoke-test en el navegador y **declarar** el resultado; si está roto, **parar y preguntar** (decisión 14), no tocar el formulario. |
| **R28-5** | Desborde de volumen (`R-8`: US-27a 500 → 1462; US-27b 825 → 2109 reales). La US estima ~350. | **Alto** | Estimación re-anclada abajo en archivos **medidos** (~890, +154 %). Cadena de PRs decidida **de entrada** (`D28-10`). |
| **R28-6** | El body trae campos sin columna; un spread a Prisma daría 500 (`R-5`). `image` es `jsonb` (`{thumbnail,original,id}`) e `icon` string (puede ser `''`). | Medio | Inputs tipados campo a campo con spreads condicionales; se guarda lo que llega, sin normalizar. Precedentes: `image` en `tags.repository.ts`, `icon` en `types`. |
| **R28-7** | Key-set u orden roto si una escritura arma su objeto en vez de llamar a `toCategoryDto`. | Medio | `D28-4` + diff de `Object.keys()` con `node -e` (**`jq` no está instalado**), sin `.sort()`. |
| **R28-8** | Falso negativo por `packages/db/dist` obsoleto (gitignored). | Medio | `just db-build` abre toda verificación; el reinicio de la API es parte de la secuencia. |
| **R28-9** | Conflicto en `packages/db/index.ts` si US-29/30 corren en paralelo. | Bajo | Rebase, no merge manual (precedente US-4b sobre US-4a). |

## Rollback Plan

1. **Revert puro de código, sin DDL ni migración de datos** (decisión 1 del
   épico — **esta US no añade ni una columna**):
   `git checkout packages/db apps/api/rest/src/categories` + `just db-build` +
   `just build-api`. `packages/db/dist` está gitignored y se reconstruye.
   **`just db-reset` NO es necesario** (y si pareciera serlo, se rompió la
   decisión 1: parar y preguntar).
2. **Datos que `git` no deshace** — basura de tests y de los `curl` manuales:
   `DELETE FROM categories WHERE slug LIKE 'zz-categories-%';`
   Ejecutar **de hijas a raíz** o confiar en `SET NULL`; cierre correcto =
   `SELECT count(*) FROM categories` → **198** y
   `SELECT count(*) FROM categories WHERE parent_id IS NULL` → **83**.
3. **Filas de la semilla movidas o borradas por error**: no hay backup; la
   reparación es `UPDATE categories SET parent_id = <original>` sobre los ids
   afectados (registrarlos antes de cada `curl` destructivo). Por eso `D28-8`
   prohíbe colgar la prueba de `CA-4` de `169`/`170`.
4. **Rollback parcial por slice**: revertir el PR de la capa API deja las
   funciones de `packages/db` inertes y el servicio en su stub — el estado exacto
   del PR anterior de la cadena, y es verde.

## Estimación y entrega

Anclada en tamaños **medidos** de US-27a, no en las estimaciones de su design
(que ya probaron ser bajas: el spec de jest se predijo en ~145 y aterrizó en
**331**).

| Área | ~Líneas | Ancla |
|---|---|---|
| Repositorio (3 funciones + 2 inputs + `categorySlugs` + guardas) | ~195 | +150 de `types`; +45 por guarda de ciclo/type y `parent` |
| Test de integración | ~200 | +153 de `types`; + centinela nuevo, re-enraizado y cadena de nivel 4 |
| Barrel `packages/db/index.ts` | ~12 | +14 de US-27a |
| Servicio de Nest (3 métodos + limpieza de JSON/`Fuse`) | ~120 | 99+37 de `types.service.ts` |
| `create-category.dto.ts` | ~25 | 31 de `create-type.dto.ts` |
| `categories.service.spec.ts` (jest) | ~340 | **331 reales** de `types.service.spec.ts`; 16 claves > 9 |
| **Total** | **~890 (±150)** | vs. **~350** estimadas por la US (**+154 %**) |

- `Estimated changed lines: ~890 (±150)`
- `400-line budget risk: High`
- `Chained PRs recommended: Yes`
- `Decision needed before apply: Yes` (estrategia de entrega `ask-on-risk`)

**Cadena propuesta** (forecast autoritativo: `sdd-tasks`) — corte por capa, con
un runner distinto por slice:

| PR | Contenido | ~Líneas | Runner que lo prueba verde solo |
|---|---|---|---|
| **#1** | `packages/db`: repositorio + guardas + barrel + integración | ~405 | `just db-check` (base hoy: **10 archivos de test**). La API no cambia. |
| **#2** | API: servicio migrado + DTO | ~145 | `just build-api` + secuencia `curl` completa **con reinicio** + `just verify`. **La US es releasable aquí.** |
| **#3** | `categories.service.spec.ts` | ~340 | `npx jest` (base hoy: **8 archivos spec**). |

**¿Partir la US?** ~890 roza el umbral de ~900 del épico sin superarlo, y aquí
hay **un solo agregado**: no existe frontera natural de partición (repositorio y
servicio son la misma vertical; PR#1 solo quedaría sin consumidor, el corte que
el épico descartó al partir US-27). **Recomendación: no partir; cadena de 3 PRs
dentro de una sola US**, con el exceso de PR#1 y PR#3 concentrado en archivos de
test. Si `sdd-apply` desborda materialmente el pronóstico, el corte a levantar es
**PR#3 a una US-28b**, no una repartición del código.

## Dependencies

- **US-27a implementada** (2026-09-10): `slug.ts`, `domain-errors.ts` y
  `common/errors/domain-error.mapper.ts`. Se consumen tal cual (`CA-7`).
- `just db-up` (base sembrada, **sin `db-reset`**) y `just db-build` antes de
  verificar. `just api-dev` arriba para `just build` / `just verify`.
- Rebase sobre `packages/db/index.ts` si US-29/30 avanzan en paralelo.

## Decisiones pendientes para `sdd-design` (no se cierran aquí)

1. **Forma de la respuesta de `DELETE /categories/:id` — prioritaria.** La
   decisión 3 del épico exige la misma proyección de 16 claves que el `GET`,
   pero `findCategoryByIdOrSlug` devolverá `null` una vez borrada la fila. Dos
   salidas viables, ninguna elegida: (a) capturar el `CategoryTreeNode` completo
   **antes** del delete y proyectarlo, aceptando que `children` refleja el estado
   pre-borrado (ya re-enraizado en la base, no en la respuesta); (b) devolver
   solo el `CategoryRecord` plano —como `deleteType`/`deleteTag`— y proyectarlo
   con `parent`/`type`/`children` best-effort. `design.md` debe elegir una
   **explícitamente** y dejar constancia de qué contiene `children` en la
   respuesta.
2. **Mensajes de los cuatro 400.** Con `D28-1` el error lo lanza el repositorio,
   así que el texto es elección de diseño: definir mensajes distinguibles para
   "madre inexistente", "madre de otro type", "autorreferencia" y "ciclo", **sin
   editar `domain-errors.ts`** (`CA-7`).
3. **Alcance del `UpdateCategoryInput`**: si `type_id` es mutable y, en tal caso,
   si debe validarse contra el `type_id` de la madre **y** de las hijas (una hija
   de otro type quedaría invisible en la tienda). La US no lo cubre.
4. **Ratificar o revocar `D28-2`** (Enfoque A vs. `findMany` plana + recorrido en
   memoria). La exploración recomienda A; B no es incorrecto.

## Verification Strategy

Secuencia central: **`POST` raíz → `POST` hija → `GET` → reiniciar la API →
`GET` (la fila sigue) → `PUT` (mover) → `GET` → `DELETE` madre → `GET` hija
(`parent` null) → `GET` madre 404**, con diff de `Object.keys()` (`node -e`, sin
`.sort()`) contra el `GET` de una categoría del seed. El **reinicio** es lo que
distingue una escritura real de la mutación en memoria. Además: los cuatro `curl`
de 400 (`R28-1`), `CA-4` por API y por test (`D28-7`), `CA-5` (401 / 403), y el
smoke-test del formulario del admin (`R28-4`).

Gates de regresión con baselines a medir al arrancar: `just db-check`,
`cd apps/api/rest && npx jest`, `just build-api`, `just verify`. Deben seguir
verdes `toBe(198)` (`:29`, `:77`), `toBe(83)` (`:24`), `toBe(53)` (`:40`) y
`toBe(10)` (`:103`, `:110`).

## Success Criteria (1:1 con la DoD de US-28)

- [ ] Secuencia completa **con reinicio** pegada, con key-set de 16 claves
      comparado contra el `GET` de una categoría del seed.
- [ ] `curl` de los cuatro 400 pegados: madre inexistente, madre de otro type,
      autorreferencia, ciclo. **Ninguno devuelve 500** (`R28-1`).
- [ ] Evidencia de `CA-4` pegada: nivel 4 servido anidado en `GET /categories` y
      `GET /categories/:slug`, **o** el 400 declarado si `D28-7` se desmiente.
- [ ] `CA-3`: hija con `parent_id NULL` visible en `GET /categories?parent=null`
      y `category_product` de la borrada desaparecida.
- [ ] `psql` pegado: `count(*) FROM categories` → **198** tras los tests.
- [ ] `grep -n "fuse\|@db/"` en `categories.service.ts` → **0 líneas**.
- [ ] `just db-check`, `npx jest`, `just build-api` y `just verify` verdes con
      recuentos reales (no los obsoletos de `CLAUDE.md`).
- [ ] `git diff --stat` sin cambios en `slug.ts`, `domain-errors.ts`,
      `common/errors/` ni `db/schema.sql`, o desviación declarada con su motivo.
- [ ] Resultado del smoke-test de `translated_languages` (`R28-4`) declarado,
      sea correcto o roto, **sin tocar el frontend**.
- [ ] Divergencias declaradas: `products_count` = 0; `translated_languages` =
      `['en']`; `created_at`/`updated_at` (ya embarcada); conteo obsoleto de
      suites en `CLAUDE.md` mencionado y **no** accionado.
- [ ] Status de US-28 actualizado y fila del épico marcada.
