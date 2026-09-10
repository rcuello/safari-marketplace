# Proposal: Escrituras de `tags` y `manufacturers`

> **US-27b** del Épico 26, hoja que depende solo de US-27a. Las decisiones 1-15 y
> `D-1..D-6` / `R-1..R-9` del épico son **vinculantes**; las propias usan prefijo
> `D27b-N` para no confundirse con las `D27-N` archivadas de US-27a
> (`openspec/changes/archive/2026-09-10-escrituras-types-fundaciones/`).
> Insumo primario: `exploration.md` de este change (re-verificado línea a línea,
> cero drift). Esta US **no crea piezas compartidas: las consume**.

## Intent

`manufacturers.service.ts:171-178` **muta el array en memoria del mock**: el toggle de
aprobación de `manufacturer-list.tsx:125-158` muestra el toast, cambia la fila de la
tabla y **pierde el cambio al reiniciar la API**. `tags.service.ts:67-72` fabrica un
`id: this.tags.length + 1`, devuelve el DTO y **nunca lo guarda**. Es el peor modo de
fallo del épico —silencioso, no un error visible— y esta US lo cierra persistiendo en
las tablas `tags` (10 filas) y `manufacturers` (14) que ya existen.

Valor secundario: es el **primer consumidor real** de las piezas de US-27a. `CA-7`
cumplida (`git diff` limpio en los tres archivos compartidos) prueba el patrón para
US-28/29/30; incumplida, es la señal temprana de que se diseñaron a medida de `types`.

## Scope

### In Scope

- `createTag`/`updateTag`/`deleteTag` y `createManufacturer`/`updateManufacturer`/
  `deleteManufacturer` en `@safari/db`, en el mismo archivo que las lecturas (`D-2`),
  con inputs tipados y tests de integración.
- Los 6 métodos de servicio migrados; `updatedAt: now()` explícito (decisión 9).
- `CreateTagDto` y `CreateManufacturerDto` declarando los campos reales (decisión 15).
- Fuera `@db/tags.json`, `@db/manufacturers.json` y los dos `Fuse` sin uso (`CA-6`).
- Primera ejercitación **por HTTP** de `InvalidReference` (400) — ver `R27b-1`.

### Out of Scope (vinculante — "NO incluye" de la US)

- **Modificar las piezas compartidas de US-27a.** `CA-7` las declara consumidas tal
  cual. Si alguna necesitara un cambio: parar y preguntar (rompería US-28/29/30).
- `types` (US-27a) · `categories` (US-28) · `products` (US-29) · `shops` (US-30).
- Persistir `socials` y `cover_image`: **sin columna** (decisión 5) — se ignoran y se
  declaran; la lectura sigue emitiendo `[]` y `null`.
- Triggers de `updated_at` y todo cambio a `db/schema.sql`: es DDL (decisión 1).
- Partial update de `updateManufacturer` · `top-manufacturers` · refactor de las
  **lecturas** al nuevo mapeo (~26 sitios de `isPrismaConnectionError`, adyacente).
- `findOrCreateManufacturerBySlug`: no se toca. Adyacente informativo — **hoy no tiene
  ningún call site en TypeScript** (el scraper es Python + `psycopg`), pese a lo que
  afirma su comentario de cabecera. Se menciona, no se acciona.
- `tag.entity.ts` y `manufacturer.entity.ts` (ver `D27b-1`) · controladores y permisos
  (`CA-5`: intactos) · frontend (decisión 14).

## Capabilities

### New Capabilities

- **None.** US-27b no introduce capacidades: consume `catalog-write-foundations` y
  extiende `flat-catalogs-api`.

### Modified Capabilities

- `flat-catalogs-api`: **ADDED** los requirements de escritura de `tags` y
  `manufacturers` (proyección idéntica al `GET` por slug — 9 y 13 claves, mismo orden;
  persistencia tras reinicio; borrado que desenlaza sin arrastrar; errores de dominio
  sin 500; permisos sin cambios) y **MODIFIED** su *Out of Scope* (`spec.md:319-329`),
  que hoy parquea "`tags`/`manufacturers` (US-27b) y `shops` (US-30)": queda reducido a
  **`shops` (US-30)**. **Ningún requirement de lectura cambia** (`D-6`): key-sets,
  `type` anidado (`:94-104`), `products_count` constante `0` (`:128-138`) y el 503 se
  preservan verbatim.
- `catalog-write-foundations`: **ADDED un único escenario** al requirement "Contrato
  dominio → HTTP es un conjunto cerrado de 5 códigos" (`spec.md:81`), documentando
  `InvalidReference` → **400 observado sobre HTTP por primera vez** (US-27a solo lo
  probó a nivel de mapper; su `archive-report.md:210` lo declara no verificado y nombra
  a `tags.type_id` como primer productor real). **Ningún requirement MODIFIED, ningún
  archivo fuente tocado** — `CA-7` es sobre el `git diff` del código, no sobre la spec.
  Ver `D27b-2`.

## Approach — decisiones cerradas

| # | Decisión | Fundamento |
|---|---|---|
| **D27b-1** | `CreateTagDto` declara **`type_id` como propiedad standalone fuera del `PickType`**, quitando `'type'` de la lista. **`tag.entity.ts` NO se toca.** | `Tag` no tiene `type_id` (solo `type: Type`), a diferencia de `Manufacturer` (`type_id?: string`). Añadirlo a la entidad toca un archivo fuera de la tabla de la US y `Tag` se reusa (incl. `Product`). El patrón standalone ya tiene precedente **en el archivo hermano**: `create-manufacturer.dto.ts:18` (`shop_id?: string`). Cerrado aquí para que `sdd-apply` no improvise. |
| **D27b-2** | Las piezas compartidas se consumen **solo como call sites**: `generateSlug({name, slug}, xSlugs, 'tags'\|'manufacturers')`, `normalizeSlug` en update, `translateCatalogWriteError(e, {aggregate, id, uniqueField:'slug'})`, `toWriteHttpException` en el `catch` del servicio. Cero ediciones en `slug.ts`, `domain-errors.ts`, `common/errors/`. | `CA-7` + `D27-13`. La exploración leyó las tres firmas reales y **no encontró un solo caso que fuerce una edición**: la tabla nunca llega al SQL compartido y el agregado viaja por parámetro. Restricción dura, no aspiración. |
| **D27b-3** | **Sin borrado protegido y sin 409 por dependientes.** `deleteTag`/`deleteManufacturer` borran directo; Postgres desenlaza (`products.manufacturer_id` `SET NULL`, `schema.sql:333`; `product_tag.tag_id` `CASCADE` hacia `tags`, `:431`). El repositorio **no** borra pivotes a mano. Solo `RecordNotFoundError` → 404. | `R-1` del épico (el `CASCADE` que borra productos) **no aplica**: ningún camino de estos dos agregados alcanza `products` con `CASCADE`. Era el riesgo alto de US-27a; aquí no existe. |
| **D27b-4** | Las escrituras llaman a `toTagDto` (9 claves) y `toManufacturerDto` (13) **tal cual**; `DELETE` devuelve el registro borrado igual proyectado. El `type` embebido se resuelve con `listTypes()` en memoria; `is_approved` se coerciona con `Number(record.isApproved)` **en el mapper** (`manufacturers.service.ts:60`), nunca en el repositorio. | Decisión 3 + `D-6`. Ningún mapper nuevo; ambos key-sets y la línea de la coerción confirmados. |
| **D27b-5** | Inputs tipados **campo a campo** (`Create/UpdateTagInput`, `Create/UpdateManufacturerInput`); nunca spread del body a Prisma. `updateManufacturer` **sin partial update**. `updatedAt: now()` explícito en ambos `update*`. | `D-2` / `R-5` (`socials[]`, `shop_id`, `cover_image` llegan y no tienen columna) + decisión 9 (`schema.sql:480-500` no cubre ninguna de las dos tablas) + `D27-6`, diferida aquí y confirmada literal. |
| **D27b-6** | **Centinela distinto por archivo de test**: `zz-tags-` y `zz-manu-`. `deleteMany({where:{slug:{startsWith}}})` en `beforeAll` **y** `afterAll`. Nunca un prefijo compartido. | Decisión 13 / `R-4`, regla heredada de US-27a: con prefijo común, la limpieza de un archivo pondría rojo intermitentemente el assert del otro (`toBe(10)` / `toBe(14)`). |
| **D27b-7** | La evidencia de `CA-3` exige **preparación manual por `psql`** (`UPDATE products SET manufacturer_id=…` e `INSERT INTO product_tag …`), declarada como **setup, no como comportamiento de esta US**, y **deshecha al terminar**. | Medido: `products.manufacturer_id IS NOT NULL` = **0** de 1200 y `product_tag` = **0** filas. "Una marca con productos asociados" **no existe** en el seed y crear esos vínculos por API es scope de US-29. **Es un defecto de la US tal como está escrita**: sin este paso, `CA-3` no se puede demostrar. |
| **D27b-8** | El mensaje del 400 de `InvalidReference` es una **obligación de verificación empírica nombrada**, no un cambio de código. | Ver `R27b-1`: no es deducible leyendo código (runtime de Prisma minificado) ni resoluble sin escribir contra Postgres. |
| **D27b-9** | Entrega en **cadena de 4 PRs, corte externo por agregado** (`tags` de punta a punta, luego `manufacturers`), no por capas. | Ver *Estimación y entrega*: cada agregado queda releasable solo —el criterio con el que el épico partió US-27— y cada slice la prueba un runner distinto. |

## Affected Areas

| Área | Impacto | Cambio |
|---|---|---|
| `packages/db/src/repositories/tags.repository.ts` (53 líneas hoy) | Modified | +3 funciones + 2 inputs + `tagSlugs` |
| `packages/db/src/repositories/manufacturers.repository.ts` (71) | Modified | +3 funciones + 2 inputs + `manufacturerSlugs`; `findOrCreateManufacturerBySlug` intacto |
| `.../{tags,manufacturers}.integration.test.ts` (45 / 49) | Modified | Escrituras con centinela propio (`D27b-6`) |
| `packages/db/index.ts` | Modified | Barrel: 6 funciones + 4 tipos. **Único archivo compartido con US-28/29/30**: quien arranque segundo rebasea |
| `apps/api/rest/src/tags/tags.service.ts` (138) | Modified | 3 métodos migrados; fuera `@db/tags.json` y `Fuse` |
| `apps/api/rest/src/manufacturers/manufacturers.service.ts` (183) | Modified | ídem; `Number(isApproved)` preservado |
| `apps/api/rest/src/tags/dto/create-tag.dto.ts` (11) | Modified | `type_id` standalone (`D27b-1`) |
| `.../manufacturers/dto/create-manufacturer.dto.ts` (19) | Modified | Dejar de omitir `name`, `description`, `website`, `image`, `type_id`, `socials`, `cover_image` |
| `.../{tags,manufacturers}/*.service.spec.ts` | **New** | Jest con `@safari/db` mockeado |
| `slug.ts`, `domain-errors.ts`, `common/errors/`, entidades, controladores, `db/schema.sql`, `apps/{shop,admin}` | **Unchanged** | `CA-7` y decisión 14 |

## Risks

| # | Riesgo | Sev. | Mitigación |
|---|---|---|---|
| **R27b-1** | El 400 de `InvalidReference` puede traer **mensaje engañoso**: la rama P2003 (`domain-errors.ts:150-156`) lee `prismaError.meta?.field_name` y cae a `context.uniqueField`, que es el campo **único** (`slug`), no el de la FK (`type_id`). Heredado como `S-1` del `verify-report.md` de US-27a. | Medio | `POST /api/tags {"type_id":99999}` **real** y observar el mensaje. **No rompe `CA-4`** (sigue 400, nunca 500) ni `CA-7`. Si sale engañoso: se declara como divergencia; no se edita `domain-errors.ts` sin parar y preguntar. |
| **R27b-2** | **Desborde de volumen** (`R-8`, ya materializado en US-27a: ~500 → 915 → **1462**). El error mayor fue el spec de jest: el design predijo ~145 líneas y aterrizó en **331**. | **Alto** | Cadena de 4 PRs decidida **de entrada** (`D27b-9`), no a mitad de `sdd-apply` como en US-27a. Estimación anclada en archivos **medidos**. |
| **R27b-3** | `CA-3` no es demostrable contra el seed (`manufacturer_id` NULL ×1200, `product_tag` vacía). | Medio | `D27b-7`: setup por `psql` declarado y deshecho; conteos verificados después. |
| **R27b-4** | Base sembrada compartida con asserts por conteo (`R-4`): basura de una corrida abortada pone rojo `toBe(10)`/`toBe(14)`. | Medio | `D27b-6`. |
| **R27b-5** | El body trae campos sin columna (`socials[]`, `cover_image`, `shop_id`); un spread a Prisma daría 500 (`R-5`). | Medio | `D27b-5`: inputs explícitos, el servicio proyecta y no reenvía; se declaran ignorados. |
| **R27b-6** | Key-set u orden roto si una escritura arma su objeto en vez de llamar al mapper (`R-3`/decisión 3). | Medio | `D27b-4` + diff de `Object.keys()` con `node -e`, **sin `.sort()`** (`jq` no está instalado). |
| **R27b-7** | Falso negativo por `packages/db/dist` obsoleto (gitignored; la API consume el build). | Medio | `just db-build` abre toda verificación; el reinicio es parte de la secuencia. |
| **R27b-8** | Conflicto en `packages/db/index.ts` si US-28/29/30 corren en paralelo. | Bajo | Único archivo compartido; rebase, no merge manual (precedente US-4b sobre US-4a). |
| — | `R-1` del épico (los `CASCADE` que borran productos) | **No aplica** | `D27b-3`: ambas FK son `SET NULL` y `product_tag.tag_id` cascadea hacia `tags`. **Ningún producto se borra por ningún camino de esta US.** |

## Rollback Plan

1. **Revert puro de código, sin DDL ni migración de datos** (decisión 1):
   `git checkout packages/db apps/api/rest/src/{tags,manufacturers}` + `just db-build`
   + `just build-api`. `packages/db/dist` está gitignored y se reconstruye; el esquema
   no cambió, así que **`just db-reset` no es necesario**.
2. **Datos que `git` no deshace** — basura de tests:
   `DELETE FROM tags WHERE slug LIKE 'zz-tags-%';` ·
   `DELETE FROM manufacturers WHERE slug LIKE 'zz-manu-%';`
3. **Deshacer el setup manual de `D27b-7`** (obligatorio incluso sin revert):
   `DELETE FROM product_tag WHERE tag_id = :probe_tag;` ·
   `UPDATE products SET manufacturer_id = NULL WHERE id = :probe_product;`
   Cierre correcto = `count(*) FROM product_tag` → 0 y
   `count(*) WHERE manufacturer_id IS NOT NULL` → 0 (los valores del seed).
4. **Rollback parcial por slice**: revertir un PR de la capa API deja las funciones de
   `packages/db` inertes y el servicio en su stub — el estado exacto del PR anterior de
   la cadena, y es verde.

## Estimación y entrega

Anclada en los tamaños **medidos hoy** de los archivos reales de US-27a (no en las
estimaciones del design, que ya probaron ser bajas): `types.repository.ts` = 182
líneas (bloque de escritura = **+150** en `3c59b0d`), `types.integration.test.ts`
= **+153**, `types.service.ts` = **+99/-37**, `create-type.dto.ts` = **31**,
`types.service.spec.ts` = **331**.

| Área | `tags` | `manufacturers` | Ancla medida |
|---|---|---|---|
| Repositorio (3 funciones + 2 inputs + lookup) | ~150 | ~150 | +150 de `types.repository.ts`; sin conteo de dependientes (−10), +1 campo (+10) |
| Test de integración | ~140 | ~140 | +153 de `types.integration.test.ts`; sin test del 409, con test de desenlace |
| Barrel `packages/db/index.ts` | ~12 | ~12 | +14 por US-27a para 3 funciones + inputs |
| Servicio de Nest (3 métodos + limpieza) | ~115 | ~125 | 99+37 de `types.service.ts`; `manufacturers` tiene 13 claves y la coerción |
| DTO | ~25 | ~45 | 31 de `create-type.dto.ts`; `CreateManufacturerDto` declara 7 campos |
| `*.service.spec.ts` (jest) | ~300 | ~320 | **331 reales**, no las ~145 estimadas por el design de US-27a |
| **Subtotal por agregado** | **~742** | **~792** | |

- `Estimated changed lines: ~1530 (±180)` — `tags` **~742**, `manufacturers` **~792**.
- `400-line budget risk: High`
- `Chained PRs recommended: Yes`
- `Decision needed before apply: Yes`

**Cadena propuesta (forecast autoritativo: `sdd-tasks`)** — corte externo por agregado,
corte interno por capa; cada slice la prueba **un runner distinto**:

| PR | Contenido | ~Líneas | Runner que lo prueba verde solo |
|---|---|---|---|
| **#1** | `tags` en `packages/db`: repositorio + integración + barrel | ~300 | `just db-check` (base: **9 archivos / 111 tests**). La API no cambia. |
| **#2** | `tags` en la API: servicio + DTO + spec | ~440 | `npx jest` (base: **6 suites / 92 tests**) + `curl` de `tags` + `just build-api`. **`tags` releasable aquí.** |
| **#3** | `manufacturers` en `packages/db` | ~300 | `just db-check` |
| **#4** | `manufacturers` en la API | ~490 | `npx jest` + `curl` (incl. el toggle con reinicio) + `just build-api` + `just verify` |

**Por qué por agregado y no por capas.** El corte alternativo (los dos repositorios,
luego los dos servicios) da ~600 + ~930 y deja un PR#1 **sin consumidor**: `packages/db`
verde y el admin todavía sin persistir nada — exactamente el corte que el épico
descartó al partir US-27 ("habría dejado una US-27a sin consumidor… y por tanto no
releasable"). PR#2 y PR#4 pasan de 400, pero su exceso está concentrado en un **archivo
de test nuevo** (~300 líneas), el material de menor coste de revisión.

**¿Partir la US?** ~1530 supera el umbral de ~900 del épico. **Recomendación: no
partir; cadena de PRs dentro de una sola US.** La partición de US-27 no se hizo solo
por volumen: aisló el riesgo alto (`R-1`) y dejó piezas probadas a su heredera. Aquí no
hay asimetría de riesgo entre `tags` y `manufacturers`, no se construye ninguna pieza
compartida y no hay dependencia entre ambos — partir duplicaría toda la ceremonia SDD
(los artefactos de US-27a sumaron 3030 líneas frente a 1462 de código) sin reducir un
solo riesgo. El propósito de la regla —evitar un monolito irrevisable— lo cumple la
cadena de 4 slices con runner propio. **Caveat duro**: como los dos agregados son
independientes, la frontera de la cadena **ya es** la frontera de partición; si
`sdd-apply` desborda el pronóstico de forma material, los PR #3-#4 se levantan a una
US-27c sin replanificar.

## Dependencies

- **US-27a implementada** (2026-09-10, `8797caa`): helper de slug, errores de dominio y
  el mapeador dominio → HTTP. Se consumen tal cual (`CA-7`).
- `just db-up` (base sembrada, **sin `db-reset`**) y `just db-build` antes de verificar.
- Setup manual de `D27b-7` antes de la evidencia de `CA-3`.

## Verification Strategy

Por recurso: **`POST` → `GET` por slug → reiniciar la API → `GET` → `PUT` → `GET` →
`DELETE` → `GET` 404**, con diff de key-sets `POST` vs `GET` (9 y 13 claves, sin
`.sort()`, con `node -e`). El **reinicio** distingue una escritura real de la mutación
en memoria: el `curl` de `CA-2` con el toggle `is_approved` **y reinicio en medio** es
la evidencia central de esta US.

Además: `CA-3` con `psql` (`manufacturer_id = NULL`, `product_tag` vacía, `count(*)
FROM products` intacto) sobre el setup de `D27b-7`; `CA-4` (404, 400 por nombre vacío,
**400 por `type_id` inexistente con el mensaje observado** — `R27b-1` —, sufijo de
colisión); `CA-5` (401 / 403 `customer` / 403 tags y 200 manufacturers con
`store_owner`); `grep -n "fuse\|@db/"` = 0 en los dos servicios; `git diff --stat`
vacío en las piezas compartidas (`CA-7`).

Gates de regresión con sus **baselines medidos hoy**: `just db-check` (**9 archivos /
111 tests**), `cd apps/api/rest && npx jest` (**6 suites / 92 tests**), `just build-api`
limpio, `just verify` verde. Asserts que deben seguir verdes:
`tags.integration.test.ts:18` `toBe(10)` y `manufacturers.integration.test.ts:18`
`toBe(14)`.

## Success Criteria (1:1 con la DoD de US-27b)

- [ ] Secuencia completa con reinicio pegada para **los dos** recursos, con diff de
      key-sets (9 y 13 claves, sin `.sort()`).
- [ ] `curl` del toggle `is_approved` **con reinicio de la API en medio**.
- [ ] `curl` de `CA-3` + `psql` de `manufacturer_id = NULL`, `product_tag` vacía y
      conteo de `products` intacto; **setup de `D27b-7` declarado y deshecho**.
- [ ] `curl` de `CA-4` (404, 400 nombre vacío, 400 `type_id` inexistente, sufijo) y de
      `CA-5` (401, 403, 403/200).
- [ ] `grep -n "fuse\|@db/"` = 0 en los dos servicios.
- [ ] `git diff --stat` sin cambios en `slug.ts`, `domain-errors.ts` y
      `common/errors/` (**`CA-7`**), o desviación declarada con su motivo.
- [ ] `just db-check`, `npx jest`, `just build-api` y `just verify` verdes con recuento;
      `toBe(10)` y `toBe(14)` intactos.
- [ ] **Resultado empírico de `R27b-1`** registrado: el mensaje real del 400 de
      `type_id` inexistente, sea correcto o engañoso.
- [ ] Divergencias declaradas: `socials` y `cover_image` ignorados; `created_at`/
      `updated_at` (ya embarcada); `findOrCreateManufacturerBySlug` sin call sites en
      TypeScript; el refactor de `isPrismaConnectionError` como adyacente no accionado.
- [ ] Status de US-27b actualizado y fila del épico marcada.
