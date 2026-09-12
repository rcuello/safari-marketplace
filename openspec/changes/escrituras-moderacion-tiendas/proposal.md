# Proposal: Escrituras y moderación de tiendas

> **US-30** del Épico 26, hoja que depende solo de US-27a. **Cierra el épico.**
> Las decisiones 1-15 y `D-1..D-6` / `R-1..R-9` del épico son **vinculantes**;
> las propias usan prefijo `D30-N` / `R30-N`. Insumo primario: el
> `exploration.md` de este change (sin drift respecto a la US). Esta US **no
> crea piezas compartidas: las consume** (`catalog-write-foundations` de
> US-27a; `findShopOwnerById` de US-29).

## Intent

`shops.service.ts:97-99` devuelve `this.shops[0]` en `create`, `:230-232` lo
mismo en `update`. Peor: `approveShop`/`disapproveShop` (`:242-254`) **mutan el
array en memoria** del mock — el admin aprueba una tienda, la ve salir de la
cola de "Inactive shops", reinicia la API y la tienda vuelve. La moderación de
tiendas es hoy una animación. Y arrastra un 500 real: `this.shops.find(...)`
devuelve `undefined` para un id inexistente y `shop.is_active = false` lanza un
`TypeError` sin `try/catch` alrededor. Ningún test lo cubre.

Esta US es además **la más pequeña en guardas de dominio del épico** (`shops`
tiene **cero CHECK y cero `IN`**, `db/schema.sql:231-244`) y la que **migra más
rutas** (4 + `getStaffs` desmockeado). El aparato de cinco guardas de US-29 **no
tiene análogo aquí y no se replica**.

## Scope

### In Scope

- `createShop` / `updateShop` / `setShopActive` en
  `packages/db/src/repositories/shops.repository.ts` (mismo archivo que las
  lecturas y que `findOrCreateShopBySlug`, `D-2`), con inputs tipados campo a
  campo; sus tests de integración con centinela propio (`D30-7`); barrel
  `packages/db/index.ts` (3 funciones + 2 tipos, orden alfabético).
- `POST /shops` con `owner_id` del token e `is_active` por rol (`D30-6`);
  `PUT /shops/:id` con propiedad; `POST /approve-shop` y `POST /disapprove-shop`
  persistiendo `is_active`; los cuatro responden `toShopDto` (16 claves).
  `GET /staffs` sin `shops.json`, conservando key-set y paginador vacío
  (decisión 11, `D30-10`).
- Fuera de `shops.service.ts`: el import de `@db/shops.json` (`:21`) y
  `plainToClass` (`:7,30`). `shops.controller.ts`: `@CurrentUser()` en
  `create`/`update` (los `@Permissions` **no** cambian). `create-shop.dto.ts`:
  campos ignorados documentados (decisión 15).
- `shops.service.spec.ts`: escrituras, propiedad, `is_active` por rol, roles de
  `CA-5`.

### Out of Scope (vinculante — el "NO incluye" de la US)

Las **cinco rutas que siguen siendo stubs** se dejan tal cual y **se declaran;
no se borran: son contrato publicado.**

- **`DELETE /shops/:id`**: sin consumidor en el admin (confirmado: no existe
  `useDeleteShopMutation` ni `shop-delete-view.tsx`) y arrastraría los productos
  de la tienda (`products.shop_id … ON DELETE CASCADE`, `schema.sql:332`).
- **`POST /shops/approve` y `POST /shops/disapprove`** (en `ShopsController`,
  `@Param('id')` sobre una ruta sin `:id` — no puede ligarse nunca): rutas
  publicadas sin consumidor.
- **`POST /staffs`, `PUT /staffs/:id`, `DELETE /staffs/:id`**: sin relación
  staff↔tienda en el DDL.
- **`balance`, `admin_commission_rate`, `categories: number[]`**: sin columna.
  Se aceptan en el DTO donde ya existan y **se descartan al escribir**
  (decisión 5). Sin 400 por campo desconocido (`main.ts:9` no hace `whitelist`).
- **`transfer-shop-ownership` / `ownership-transfer`**: módulo aparte, mock.
- **`findOrCreateShopBySlug`** (del scraper) **no se toca** — ni un renombre.
- **Frontend** (decisión 14): cero líneas en `apps/shop` / `apps/admin`. Si una
  verificación pareciera exigir un cambio de formulario, el contrato se rompió:
  **parar y preguntar**. **DDL** (decisión 1): ni una columna, ni un `db-reset`.
- Adyacentes detectados y **no accionados**: `ApproveShopDto` vestigial (el
  controller lee `@Body('id')` suelto, nunca el DTO); `toShopDto` emite
  `owner: null` y el `POST` podría rellenarlo — **no** (nota 6: rompería la
  simetría listado/detalle); el conteo obsoleto de suites en `CLAUDE.md`.

## Capabilities

### New Capabilities

- `shop-write-api`: `POST`/`PUT /shops` y la cola de moderación
  (`POST /approve-shop`, `POST /disapprove-shop`) contra Postgres — `owner_id`
  del token, `is_active` por rol, propiedad en el `PUT`, jsonb (`address`,
  `settings`, `logo`, `cover_image`), proyección de 16 claves y el corte del
  500. **Capacidad nueva, no una extensión**: las lecturas de `shops` viven
  repartidas entre `flat-catalogs-api` y `derived-catalog-api`; meter las
  escrituras en cualquiera sería arbitrario. Precedente: `product-write-api`.

### Modified Capabilities

- `flat-catalogs-api`: **MODIFIED** su *Out of Scope* (`spec.md:433-439`), que
  parquea literalmente «endpoints de escritura del admin de `shops` (US-30)» y
  «`GET /staffs`, `POST /approve-shop`, `POST /disapprove-shop`» — deja de ser
  cierto. **Ningún requirement de lectura cambia**: las 16 claves, el envoltorio
  de paginación y `search=is_active:1` (`:82-90`) se preservan verbatim.
- `derived-catalog-api`: **MODIFIED** el requirement «`new-shops` — cero es el
  resultado correcto» (`spec.md:68-78`). Su premisa («con las 12 tiendas activas
  del seed, `total: 0` es el esperado») era estructural y pasa a ser
  circunstancial: `CA-1` **exige** que una tienda creada por un `store_owner`
  aparezca ahí. Se conserva el escenario del seed y se **añade** el de la cola
  poblada. Su *Out of Scope* («`getStaffs` · escrituras reales») también cambia.
- `catalog-write-foundations`: **ADDED un único escenario** dejando constancia
  de que el **quinto y último** agregado del épico consumió las fundaciones
  **sin una sola guarda nueva** — `shops` no tiene CHECK ni `IN`, así que
  `P2002`/`P2003`/`P2025` cubren el 100 % de lo alcanzable. **Ningún requirement
  MODIFIED, ningún archivo fuente tocado.**

## Approach — decisiones cerradas

| # | Decisión | Fundamento / alternativas descartadas |
|---|---|---|
| **D30-1** | **`settings` jsonb: REPLACE completo**, con spread condicional (`...(input.settings !== undefined && { settings: input.settings })`). La pérdida se **declara** como divergencia con número propio. | `CA-2` dice literal «jsonb completo», y es el precedente exacto de `products`/`categories` (REPLACE total, nunca merge). **Descartado el MERGE superficial pese a la evidencia real en contra**: `shop-form.tsx:112` usa `shouldUnregister: true` y el bloque `shopMaintenance` (`:586-694`) solo se monta si `!SUPER_ADMIN`, así que un `PUT` de `super_admin` **sí borra** ese campo. Se rechaza igual porque un merge en el servidor es una **regla de negocio nueva no autorizada** por ninguna decisión del épico, y un merge de un nivel dejaría sin proteger las sub-claves de `location`/`socials` — la profundidad sería una segunda decisión arbitraria. Riesgo acotado: quien configura el mantenimiento es el `store_owner`, y él **sí** ve el bloque. La DoD exige la evidencia que **demuestra** la pérdida, no que la esconde. |
| **D30-2** | **`logo`/`cover_image`: se sigue el precedente de US-29 sin divergir.** Spread condicional `...(input.logo != null && { logo: input.logo })`. `PUT {"logo": null}` es un **no-op declarado**. | `Prisma.InputJsonValue` no acepta `null` y ambas son jsonb **nullable sin default** (`schema.sql:238-239`) — idéntico a `image`/`gallery` (`DD29-7`, divergencia #10), ya usado dos veces en `categories.repository.ts:467,540`. **Descartado** ensanchar el tipo con `Prisma.DbNull`: abriría un patrón nuevo en la última US del épico sin consumidor que lo pida (el formulario no ofrece "borrar logo", solo reemplazar). |
| **D30-3** | **`owner_id` no existe en `UpdateShopInput`** — ni como campo ignorado. Un `PUT` que lo traiga **se descarta en silencio**, como `balance`/`categories[]`, sin 400. | Nota 2: `owner_id` sale siempre del token. Coherente con «NO incluye `transfer-shop-ownership`»: aceptarlo aunque fuera ignorable abriría en el tipo una superficie de escritura no pedida que la siguiente US copiaría por inercia. **Descartado el 400 por campo prohibido**: `ValidationPipe` no hace `whitelist` (decisión 5) y un rechazo puntual sería incoherente con los otros tres ignorados. |
| **D30-4** | **Las tres escrituras recalculan `productsCount` con el mismo `include: COUNT_PRODUCTS`** que `listShops`/`findShopBySlug`, y devuelven el `ShopRecord` completo. | **Hallazgo nuevo de la exploración.** `toShopDto` hace `record.productsCount ?? 0` (`shops.service.ts:61`); sin el include, un `PUT` sobre `grocery-shop` (584 productos) respondería `products_count: 0` — divergencia **silenciosa**: el key-set sigue siendo 16 y ningún diff de claves la ve. El repositorio ya documenta la trampa en `findShopBySlug` (`:69-72`). Decisión 3 («la misma proyección que el `GET` por slug») se lee con los mismos **valores**, no solo las mismas claves; coste: una sub-query sobre 12 filas. **Descartado declarar `products_count` no fiable en escritura**: sería la única de las 16 con semántica distinta según el verbo. |
| **D30-5** | **`approve-shop`/`disapprove-shop` con id inexistente → 404** vía `P2025` → `RecordNotFoundError` → `toWriteHttpException`. **Cambio de comportamiento intencional y declarado** (hoy: 500 por `TypeError`). La coerción `Number(id)` se mantiene (nota 4) **pero pasa por `Number.isSafeInteger`** antes de `@safari/db`. | Nota 4 lo exige. El guard numérico no es decorativo: `@Body('id')` **no está tipado** (`:103-123`), así que `{"id":"abc"}` → `NaN` → `BigInt(NaN)` → `RangeError` **sin `.code`** → invisible para los traductores → 500. Es `R29-2`, con el borde más expuesto que en `products`. `findShopOwnerById` ya trae la guarda equivalente (`:174-178`) y **se consume tal cual**. |
| **D30-6** | **`is_active` por rol al crear, ratificado**: `store_owner` → `false`, `super_admin` → `true`, **fijado explícito** en `createShop()`, sin depender del `DEFAULT true` del DDL (`:237`). | Nota 1 lo marca «DECIDIDO en esta US» y la UI ya lo presupone (`getNewShops` filtra `isActive: false` y alimenta "Inactive shops" + `approve-shop-view.tsx`). El `DEFAULT 1` de `owner_id` existe para el scraper (nota 3) y `createShop` tampoco se apoya en él. **Escape hatch que la propia US ofrece**: si el dueño prefiere que todas nazcan activas, es **un cambio de una línea** y se declara — queda escrito aquí para no reabrir el diseño. |
| **D30-7** | **Centinela por prefijo de slug `zz-shops-`**, con `cleanup()` en `beforeAll` **y plegado dentro del `afterAll` existente** (un segundo `afterAll` correría LIFO contra un cliente ya desconectado — lección de `R29-5`). Cada `it` que cree, borra. | `shops.integration.test.ts:19-20` afirma `total === 12` **y** `items[0].id === 15` bajo `orderBy: { id: 'desc' }`: cualquier centinela superviviente toma un id mayor y se convierte en `items[0]`. El assert se repite en `:91-95` y `:32-48` fija `productsCount` absolutos (584/82/188/44). **Ya le pasó a US-29.** `zz-shops-` no puede colisionar con un slug de retailer del scraper. |
| **D30-8** | **Ningún test compara un timestamp del camino `create` con uno del camino `update`.** La monotonía de `updated_at` se afirma **solo** entre dos escrituras del mismo origen: `updateShop → updateShop` o `setShopActive → setShopActive`. | **Trampa que ya mordió dos veces al épico.** `shops` tiene el trigger `shops_updated_at BEFORE UPDATE`: `createShop` resuelve `@default(now())` **en Node** (el modelo no lleva `@updatedAt`), mientras `update`/`approve`/`disapprove` lo reciben del **reloj de Postgres**. La deriva hace la comparación no determinista. US-28 lo documentó (`categories.integration.test.ts:277-289`), el diseño de US-29 no lo heredó y **rompió su PR#1 con un falso verde**. Escrito aquí para que no haya una tercera vez. |
| **D30-9** | **Cero guardas de dominio nuevas.** Ningún código de error, ningún `_translateCheckViolation`, ninguna pre-validación de CHECK. `git diff` de `domain-errors.ts` y `common/errors/` debe quedar **vacío**. | `db/schema.sql:231-244` verificado: **cero CHECK, cero `IN`**, una FK saliente y un `UNIQUE` — solo `P2002`/`P2003`/`P2025` son alcanzables y ya están cubiertos. El aparato de cinco guardas de US-29 **no tiene análogo**; replicarlo por simetría sería inventar riesgo. Refuerzo: el 403 de `staff` sale del **guard** (`ADMIN_AND_OWNER` en `:28,46,52` no lo incluye; `ADMIN_ONLY` en approve/disapprove), **no** del efecto colateral de propiedad que el verify de US-29 marcó como `WARNING-1` — posición más fuerte que en `products`, sin caso especial en el servicio. |
| **D30-10** | **`getStaffs` sin JSON**: `{ data: [], ...paginate(0, page, limit, 0, url) }` con el **mismo** `paginate()` de hoy. No se migra a `buildPaginator`. | Nota 5 + decisión 11 + `R-7`: `buildPaginator` no coerciona y `ValidationPipe` corre sin `transform`, así que `per_page` es hoy un string de facto. Cambiar el helper cambiaría el tipo de una clave del contrato en una ruta que ni siquiera devuelve datos. |

## Affected Areas

| Área | Impacto | Cambio |
|---|---|---|
| `packages/db/src/repositories/shops.repository.ts` (201) | Modified | +3 escrituras, +2 inputs, `COUNT_PRODUCTS` en las tres (`D30-4`). **`listShops`, `findShopBySlug`, `listShopsNear`, `findShopOwnerById` y `findOrCreateShopBySlug` intactos** |
| `packages/db/src/repositories/shops.integration.test.ts` (97) | Modified | Describes de escritura **tras** los de lectura + centinela (`D30-7`) + monotonía correcta (`D30-8`) |
| `packages/db/index.ts` | Modified | Barrel: 3 funciones + 2 tipos. **Sin conflicto con US-29** (archivada y en `main`) |
| `apps/api/rest/src/shops/shops.service.ts` (256) | Modified | 4 métodos migrados + `getStaffs`; propiedad; frontera numérica; fuera `@db/shops.json` (`:21`) y `plainToClass` (`:7,30`); stubs declarados en comentario |
| `apps/api/rest/src/shops/shops.controller.ts` (147) | Modified | `@CurrentUser()` en `create`/`update`. **`@Permissions` sin tocar** |
| `apps/api/rest/src/shops/dto/create-shop.dto.ts` | Modified | Campos ignorados documentados (decisión 15) |
| `apps/api/rest/src/shops/shops.service.spec.ts` (143) | Modified | Escrituras, propiedad, `is_active` por rol, roles de `CA-5` |
| Contrato HTTP | Modified | Las 4 rutas pasan de la fila 0 del mock (o de una mutación en memoria) a 16 claves reales y persistentes. **`GET` sin cambios.** Observable: la moderación sobrevive al reinicio |
| `domain-errors.ts`, `common/errors/`, `slug.ts`, `findOrCreateShopBySlug`, `db/schema.sql`, `apps/{shop,admin}` | **Unchanged** | `D30-9` + decisiones 1 y 14 |

## Risks

| # | Riesgo | Sev. | Mitigación |
|---|---|---|---|
| **R30-1** (`R-4`) | Centinela superviviente rompe `items[0].id === 15`, `toBe(12)` y los 4 `productsCount`. **Ya ocurrió en US-29.** | **Alto** | `D30-7`. Cierre: `count(*) FROM shops` = **12** e `items[0].id` = **15**. |
| **R30-2** | Falso verde por comparar `created_at` (reloj de Node) con `updated_at` (reloj del trigger). **Rompió el PR#1 de US-29.** | **Alto** | `D30-8`, como decisión vinculante y no como nota. |
| **R30-3** (`R-2`) | Agujero de autorización: hoy el `PUT` no hace nada; mañana un `store_owner` edita tiendas ajenas. | **Alto** | Propiedad en el servicio con `findShopOwnerById` (reutilizada, `D-5`), **404 antes de 403**; `curl` de `CA-5` en las 4 rutas. |
| **R30-4** | `products_count: 0` en `PUT`/`approve` para tiendas con productos: divergencia **silenciosa**, invisible a un diff de claves. | **Medio-alto** | `D30-4` + evidencia que compara el **valor**, no solo la clave, contra `GET /shops/:slug`. |
| **R30-5** | `{"id":"abc"}` en approve/disapprove → `RangeError` sin `.code` → **500**, justo el error que esta US viene a cerrar. | **Medio** | `D30-5` + `curl` explícito con `"abc"` esperando 4xx. |
| **R30-6** | `settings` REPLACE borra `shopMaintenance` cuando edita un `super_admin` (`shouldUnregister: true`). | **Medio** | `D30-1`: se acepta y se **declara**; la DoD exige la evidencia que lo hace visible. **RATIFICADO por el dueño del repo el 2026-09-11**, tras presentarle las tres opciones (REPLACE con pérdida declarada / MERGE de primer nivel / REPLACE ahora + MERGE como US aparte) y la consecuencia concreta. `sdd-design` **NO reabre esta decisión**. Matiz registrado al ratificar: no es una regresión respecto de hoy — `update` es hoy un stub que no persiste nada —, sino una propiedad del comportamiento nuevo. Si la evidencia de la DoD la hiciera inaceptable en la práctica, el merge es **otra US**, nunca un parche dentro de US-30. |
| **R30-7** (`R-5`) | El body trae `balance`, `categories[]`, `admin_commission_rate`. Un spread hacia Prisma → 500 por campo desconocido. | Medio | Inputs tipados **campo a campo** (`D-2`); nunca `...body` hacia el repositorio. |
| **R30-8** (`R-8`) | Desborde de volumen: ~1550 líneas sobre un umbral de partición de ~900. | **Alto** | Cadena de PRs decidida **de entrada** (§ Estimación); corte preacordado: el spec de jest a una **US-30b**. |
| **R30-9** | Falso negativo por `packages/db/dist` obsoleto (gitignored) o vitest con "0 tests" si la unidad del cwd va en minúscula en Windows. | Bajo | `just db-build` abre toda verificación; revisar el casing `C:/DevOps/...` antes de sospechar de la base. `jq` **no existe** aquí: diffs de JSON con `node -e`. |

## Rollback Plan

1. **Revert puro de código, sin DDL ni migración** (decisión 1 — esta US no
   añade ni una columna): `git checkout packages/db apps/api/rest/src/shops` +
   `just db-build` + `just build-api`. `dist/` está gitignored y se reconstruye.
   **`just db-reset` NO es necesario**; si pareciera serlo, se rompió la
   decisión 1: parar y preguntar.
2. **Datos que `git` no deshace** — filas de tests y `curl` manuales:
   `DELETE FROM shops WHERE slug LIKE 'zz-shops-%';`. Cierre correcto =
   `count(*) FROM shops` → **12** e `items[0].id` → **15**.
3. **Filas del seed tocadas por error** — riesgo **específico de esta US**:
   approve/disapprove **modifican filas sembradas**, no centinela, y no hay
   backup. Antes de cualquier `curl` de moderación sobre una tienda del seed,
   anotar su `is_active` y restaurarlo (`UPDATE shops SET is_active = true
   WHERE id = N;`); el `PUT` ajeno de `CA-5` se usa **solo para leer el 403**,
   verificando después que no cambió. La secuencia preferida modera la
   **tienda centinela**.
4. **Rollback parcial por slice**: revertir el PR de la capa API deja las
   funciones de `packages/db` inertes y el servicio en su stub — el estado exacto
   del PR anterior de la cadena, y es verde.

## Dependencies

- **US-27a**: `slug.ts`, `domain-errors.ts`,
  `common/errors/domain-error.mapper.ts`. Se consumen **tal cual** (`D30-9`).
- **US-29** (archivada): `findShopOwnerById` (`shops.repository.ts:174-178`) y
  `packages/db/vitest.config.ts` (`fileParallelism: false`, `DD29-10`) ya
  existen — **esta US no los crea**.
- `just db-up` (base sembrada, **sin `db-reset`**; Postgres ya está `Up
  (healthy)` en 5433) y `just db-build` antes de verificar; `just api-dev`
  arriba para `just build` / `just verify`. Puertos: API **9001** (nunca 9000,
  Zscaler), shop 3003, admin 3002.

## Preguntas abiertas para `sdd-design` (no se cierran aquí)

1. **Firma de `setShopActive(id, isActive)`** única vs. `approveShop`/
   `disapproveShop` hermanas. La US nombra `setShopActive`; ratificar o diverger
   con motivo.
2. **`slug` en `updateShop`**: inmutable (decisión 4) — confirmar que el input
   **ni siquiera declara** el campo, en vez de declararlo y descartarlo.
3. **Orden exacto 404-antes-de-403 en el `PUT`**: `findShopOwnerById` devuelve
   `null` tanto para "no existe" como para "id no entero"; fijar qué código sale
   en cada caso (no hay fuga: `GET /shops/:slug` es anónimo).

## Estimación y entrega

Se **ratifica** el re-anclaje por componente del épico (~1550): sale de tamaños
medidos y el desglose propio coincide; las dos correcciones que esta propuesta
añade (`COUNT_PRODUCTS` en escrituras, guarda numérica de `@Body('id')`) son
~30 líneas y caben en el margen. **Calibración**: US-28 estimó ~350 y aterrizó
~1612 (×4,6); US-29, recalibrada a ~2100, aterrizó ~1808 — la recalibración del
épico **sobre-corrigió levemente**, así que ~1550 con banda **asimétrica a la
baja** es el pronóstico honesto.

| Componente | Base hoy | Δ | Ancla |
|---|---|---|---|
| `shops.repository.ts` | 201 | +300 | 3 escrituras + 2 inputs + `COUNT_PRODUCTS` ×3. **Sin CHECK que pre-validar** (`D30-9`) |
| `shops.integration.test.ts` | 97 | +360 | la base más pequeña del paquete; hay que montarle el centinela sin romper `toBe(12)` ni `id 15` |
| `shops.service.ts` + controller + DTO | — | +350 | **4 rutas migradas** + `getStaffs` desmockeado: más superficie de ruta que ninguna otra US del épico |
| `shops.service.spec.ts` | 143 | +500 | regla de gobierno de US-27b: ~500/agregado; hoy es el spec más pequeño de la API |
| barrel | — | +40 | |
| **Total** | | **~1550 (+200 / −350)** | vs. ~400 originales (**×3,9**) |

- `Estimated changed lines: ~1550 (+200 / −350)`
- `400-line budget risk: High` — **excede el presupuesto de PR ×3,9**
- `Chained PRs recommended: Yes`
- `Decision needed before apply: Yes` (estrategia `ask-on-risk`)

**Cadena propuesta** (forecast autoritativo: `sdd-tasks`) — corte por capa, cada
slice con un runner que lo prueba verde solo:

| PR | Contenido | ~Líneas | Runner |
|---|---|---|---|
| **#1** | `packages/db`: 3 escrituras + inputs + `COUNT_PRODUCTS` + barrel + integración del **camino feliz** (crear con `is_active` por rol, editar, togglear) **con el centinela y su `cleanup` ya montados** (`D30-7`) | ~450 | `just db-check` (cierre: `count(*)` = 12, `id 15`) |
| **#2** | `packages/db`: **batería hostil** — 404 de `P2025`, slug duplicado 409, `owner_id` inexistente 400, id no entero, `slug` invariante, REPLACE de `settings` (`D30-1`), no-op de `logo: null` (`D30-2`), monotonía `update→update` (`D30-8`) | ~250 | `just db-check` |
| **#3** | API: servicio + controller + DTO, sin `shops.json` ni `plainToClass`. **La US es releasable aquí** | ~350 | `just build-api` + secuencia `curl` con **reinicio real** + `just verify` |
| **#4** | `shops.service.spec.ts` | ~500 | `npx jest` |

**¿Partir la US?** No por código: es **un solo agregado** y repositorio+servicio
son la misma vertical (ese corte ya se descartó al partir US-27 — dejaría un PR
sin consumidor). El corte limpio si `sdd-apply` desborda es **levantar PR#4 a
una US-30b**, el *caveat* vinculante que dejó el `design.md` de US-28. PR#1 y
PR#4 exceden el presupuesto con el exceso concentrado en archivos de test.

## Success Criteria (1:1 con `CA-1..CA-6` y la DoD de US-30)

- [ ] **CA-1** — *Evidencia*: `curl` + `psql`. Secuencia con token
      `store_owner`: `POST /shops` → `owner_id = sub`, `is_active: 0` →
      `GET /new-shops` la incluye → `GET /shops` no → **reinicio real de la
      API** → sigue ahí. Con `super_admin`: nace `is_active: 1` y sale en
      `GET /shops`. Key-set de **16 claves en el mismo orden**, diffeado con
      `node -e` (**`jq` no está instalado**) contra una tienda del seed;
      `products_count: 0`.
- [ ] **CA-2** — *Evidencia*: `curl` + `psql`. `PUT` con `name`,
      `description`, `logo`, `cover_image`, `address` y `settings`
      actualizados; **`slug` invariante** pese a cambiar `name`; `slug` en la
      respuesta (lo consume `data/shop.ts:60-75`); `updated_at` avanzado
      **comparado contra otro `PUT`, nunca contra el `POST`** (`D30-8`).
      `store_owner` ajeno → **403**, `super_admin` → **200**.
      `GET /near-by-shop/:lat/:lng` mostrando la tienda tras escribirle
      `settings.location`. **`D30-1`**: `psql` antes/después sobre una tienda
      con `shopMaintenance` poblado editada por `super_admin`, mostrando la
      pérdida declarada. **`D30-4`**: `products_count` del `PUT` == el del
      `GET /shops/:slug`, con valor ≠ 0.
- [ ] **CA-3** — *Evidencia*: `curl -w '%{http_code}'` + `psql`.
      `POST /approve-shop {id}` → `is_active = true`; `disapprove-shop` →
      `false`; ambos con **16 claves**, visibles en `GET /shops` /
      `GET /new-shops` y **sobrevivientes al reinicio**. Id inexistente →
      **404, no 500** (`D30-5`); `{"id":"abc"}` → 4xx, **nunca 500**.
      `admin_commission_rate` ignorado y declarado.
- [ ] **CA-4** — *Evidencia*: `curl` + diff con `node -e`.
      `GET /staffs?shop_id=9` **antes y después**, mismo key-set y mismo tipo
      de `per_page` (`D30-10`); `POST/PUT/DELETE /staffs` sin cambio,
      declarados como stubs pendientes de DDL.
- [ ] **CA-5** — *Evidencia*: `curl`. **401** sin token; **403** `customer`;
      **403** `staff` (**por guard**, `D30-9` — asimetría con `products`
      declarada como nota); **200** `store_owner` propio; **200**
      `super_admin`; **403** `store_owner` en `approve-shop`.
- [ ] **CA-6** — *Evidencia*: salida real de los 4 comandos.
      `grep -n "@db/\|plainToClass" apps/api/rest/src/shops/shops.service.ts`
      → **0 líneas**. `just db-check`, `cd apps/api/rest && npx jest`,
      `just build-api` y `just verify` verdes **con recuentos** (baseline
      heredado: 186 tests de `db-check`; 9 suites / 204 de jest). `psql`:
      `count(*) FROM shops` = **12**, `items[0].id` = **15**.
- [ ] `git diff --stat` sin cambios en `domain-errors.ts`, `common/errors/`,
      `slug.ts`, `findOrCreateShopBySlug`, `db/schema.sql`, `apps/shop` ni
      `apps/admin`, o desviación declarada con su motivo.
- [ ] Reporte con **las 5+1 rutas que siguen stub y su motivo** (`DELETE
      /shops/:id`, `shops/approve`, `shops/disapprove`, `staffs` ×3) y **los
      campos ignorados** (`balance`, `admin_commission_rate`, `categories[]`,
      `owner_id` del body); y las **divergencias numeradas**: `D30-1`, `D30-2`,
      `D30-5`, `owner: null`/`orders_count: 0` (V-4) y `created_at`/
      `updated_at` (ya embarcada).
- [ ] **Cierre del épico**: status de US-30 actualizado, fila del Épico 26
      marcada y **el épico declarado cerrado** (US-27a/27b/28/29 ya
      implementadas), con el factor de estimación real de esta US añadido a
      «Sesgo de estimación medido».
