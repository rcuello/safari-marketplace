# Proposal: Escrituras de `types` y las piezas compartidas

> **US-27a**, raíz del Épico 26. Re-alcance del 2026-09-09: tras el pronóstico de ~1500
> líneas de este proposal, la US-27 original se partió y `tags`/`manufacturers` pasaron
> a **US-27b** (ignorar sus hallazgos en `exploration.md`). Las decisiones 1-15 y
> D-1..D-6 / R-1..R-9 del épico son **vinculantes**; las propias usan prefijo `D27-N`.

## Intent

Un administrador edita hoy una vertical, ve el toast de éxito y **no cambia ninguna
fila**: `types.service.ts:92-94`, `:104-106` y `:108-110` devuelven `this.types[0]` o un
string del scaffold. Esta US hace real la escritura de `types` y aterriza las **dos
piezas compartidas** que consumen las otras cuatro US (slug D-3, dominio → HTTP D-4).
Se lleva también el riesgo alto del épico: `types.id` es el único `CASCADE` de los
catálogos planos, así que el 409 del borrado protegido (R-1) se prueba aquí.

## Scope

### In Scope

- `createType`/`updateType`/`deleteType` en `@safari/db`, en el repositorio de las
  lecturas (D-2), con tests de integración.
- Helper de slug compartido (D-3) con tests; errores de dominio comunes.
- Traducción dominio → HTTP en `common/errors/` (D-4): directorio inexistente hoy.
- Los 3 métodos de `types.service.ts` migrados; borrado protegido (decisión 7);
  `updatedAt` explícito (decisión 9); `CreateTypeDto` real (decisión 15).
- CA-6: fuera `@db/types.json`, `fuse.js` y los muertos `findAll`/`findOne`.
- CA-7: piezas compartidas listas para US-27b/28/29/30.

### Out of Scope (vinculante — "NO incluye" de la US)

- **`tags` y `manufacturers`: US-27b** (`docs/product/26-escrituras-catalogo-postgres/27b-escrituras-tags-manufacturers.md`).
  Ni una línea en sus repositorios, servicios o DTOs (`create-tag.dto.ts` incluido), ni
  adaptadores anticipados en las piezas compartidas (D27-13).
- `categories` (US-28), `products` (US-29), `shops` (US-30).
- Persistir `promotional_sliders`: **sin columna** (decisión 5) — se ignora y se declara.
- Triggers de `updated_at` y todo cambio a `db/schema.sql`: es DDL (decisión 1).
- Refactor de las **lecturas** al nuevo mapeo: los ~26 sitios de
  `isPrismaConnectionError` en 10 archivos quedan intactos (adyacente).
- Frontend (decisión 14). Si una verificación exigiera tocar un formulario, el contrato
  se rompió: parar y preguntar.

## Capabilities

### New Capabilities

- `catalog-write-foundations`: las dos piezas compartidas — slug en servidor (regla de
  `slugify()`, sufijo incremental en colisión, 400 si slugifica a vacío, inmutable en
  update) y el contrato dominio → HTTP (400/404/409, nunca 500). Única parte de este
  change que **cuatro US más consumen**.

### Modified Capabilities

- `flat-catalogs-api`: **ADDED** los requirements de escritura de `types` (proyección
  idéntica al `GET` por slug, 409 protegido, persistencia tras reinicio) y **MODIFIED**
  su *Out of Scope* (`spec.md:211-214`), que hoy parquea los "endpoints de escritura del
  admin (POST/PUT/DELETE de los 4 catálogos)": queda reducido a **`tags` y
  `manufacturers` (US-27b) y `shops` (US-30)**. **Ningún requirement de lectura cambia**
  (D-6): key-sets 9/9/13, paginación, `type` anidado y el 503 se preservan verbatim.

## Approach — decisiones cerradas

| # | Decisión | Fundamento |
|---|---|---|
| **D27-1** | Delta sobre `flat-catalogs-api` + capability nueva `catalog-write-foundations`. | Slug y errores no son de `types`: los consumen cuatro US más. |
| **D27-2** | **ABIERTA — la ratifica `sdd-design`.** Slug: reimplementar `slugify()` en TS vs. delegar a Postgres (`SELECT slugify($1)`). *Recomendación:* delegar. | La US lo difiere al design. Delegar mata R-3 de raíz (mapa de 51 caracteres de `translate()`, orden de regex) y sigue el principio de `_translateCheckViolation`. Coste: +1 round-trip, mitigable en la misma transacción. La colisión exige una query por tabla en **ambas**: no diferencia. |
| **D27-3** | Errores compartidos en un **nuevo** `packages/db/src/domain-errors.ts`, exportados por el barrel. `src/errors.ts` **no se toca**. | Son 242 líneas de helpers de Prisma que consumen 10 archivos de la API. Patrón: `InvalidSalePriceError` (`products.repository.ts:419`). |
| **D27-4** | Mapeador único en `common/errors/`, invocado **solo** en los `catch` de las 3 escrituras. | Alcance del épico: las lecturas no se refactorizan. Convive con `isPrismaConnectionError` (503). |
| **D27-5** | `POST`/`PUT`/`DELETE` llaman a `toTypeDto` (`:39-51`) **tal cual** (9 claves, mismo orden); `DELETE` devuelve el registro borrado igual proyectado. | Decisión 3 + D-6: ningún mapper nuevo; el `Record` ya lo alimenta. |
| **D27-6** | ~~`updateManufacturer` sin partial update~~ → **diferida a US-27b**. | Hallazgo vigente (`manufacturer-list.tsx:134-142` envía el registro editable completo), ya recogido en las notas de US-27b. Fila conservada por traza. |
| **D27-7** | Se **añade el assert de conteo ausente** a `types.integration.test.ts`. | Hoy no tiene ningún `toBe(N)`, a diferencia de `tags` (`toBe(10)`) y `manufacturers` (`toBe(14)`): es justo el catálogo sin red automática (R-4). Ya está en la tabla de archivos de la US. |
| **D27-8** | Centinela `zz-test-` en `name`/`slug`; `deleteMany({where:{slug:{startsWith}}})` en `beforeAll` **y** `afterAll`. | Decisión 13; precedente `users.integration.test.ts:32-40`. |
| **D27-9** | `deleteType` cuenta `categories.type_id` + `products.type_id` antes de borrar → **409**; el `CASCADE` (`schema.sql:269,331`) queda como red de integridad, no como comportamiento de la API. | Decisión 7 / R-1: el riesgo alto del épico. |
| **D27-10** | `updatedAt: now()` (de `src/clock.ts`) explícito en `updateType`. | Decisión 9: `tocar_updated_at()` (`:480-500`) no cubre `types`; añadirlo es DDL. |
| **D27-11** | Input tipado campo a campo (`CreateTypeInput`/`UpdateTypeInput`), nunca spread del body a Prisma; `settings`/`banners` se **omiten** si no llegan. | D-2 / R-5. Son `jsonb NOT NULL DEFAULT`: mandar `null` fallaría. |
| **D27-12** | DTO corregido solo en `CreateTypeDto` (hoy clase vacía, `create-type.dto.ts:1`), como documentación Swagger. Sin `whitelist`. | Decisión 15 + 5: `whitelist` cambiaría 250 rutas. |
| **D27-13** | **NUEVA — genéricas por firma, integradas solo con `types`.** El helper de slug **recibe la tabla**; el mapeador es una **tabla `code` → status** exhaustiva sobre el conjunto **cerrado** de la decisión 6: `EmptySlug`, `InvalidReference` → 400; `RecordNotFound` → 404; `DependentRows`, `SlugConflict` → 409. Los cinco se declaran y **se testean en el spec del mapeador**, aunque `types` solo ejercite tres por HTTP. **Prohibido**: wrappers, adaptadores o ramas por agregado — añadir `tags` debe ser un **call site**, no una edición. | Resuelve la tensión entre las notas de la US ("se diseñan pensando en cinco agregados… pero solo se integra con `types`") y la CA-7 de US-27b (`git diff` limpio en los compartidos). Una fila de datos con test unitario directo no es generalidad especulativa: es lo que evita que cuatro US reabran el archivo. Si alguna necesitara un código nuevo, la CA-7 ya prevé declararlo como desviación. |

## Affected Areas

| Área | Impacto | Cambio |
|---|---|---|
| `packages/db/src/slug.ts` (+ `slug.test.ts`) | New | Helper + colisión, parametrizado por tabla |
| `packages/db/src/domain-errors.ts` | New | Los 5 errores del conjunto cerrado |
| `packages/db/src/repositories/types.repository.ts` | Modified | +3 funciones (hoy 32 líneas, solo lecturas), validación previa, borrado protegido |
| `.../types.integration.test.ts` | Modified | Escrituras con centinela + assert de conteo |
| `packages/db/index.ts` | Modified | Barrel: 3 funciones + inputs + errores |
| `apps/api/rest/src/common/errors/` | New | Mapeador dominio → 400/404/409 + spec |
| `apps/api/rest/src/types/types.service.ts` | Modified | 3 métodos migrados; fuera JSON, `Fuse`, `findAll`/`findOne` |
| `.../types/dto/create-type.dto.ts` | Modified | Campos reales |
| `.../types/types.service.spec.ts` | New | Jest con `@safari/db` mockeado |
| `db/schema.sql`, `apps/{shop,admin}`, `tags`/`manufacturers` | Unchanged | Solo referencia |

## Risks

| Riesgo | Sev. | Mitigación |
|---|---|---|
| **R-1 (épico)** `CASCADE` de `types.id`: un `DELETE` ingenuo borra categorías **y productos** | **Alto** | D27-9 + test del 409 con una vertical con productos y `psql` de los dos conteos |
| Piezas compartidas a la medida de `types` → las otras cuatro US las editan y rompen la CA-7 de US-27b | **Alto** | D27-13 |
| **R-3** divergencia del slug (tildes, vacío, colisión con seed/scraper) | Medio | D27-2; con la opción TS, el test comparativo contra la función SQL es **obligatorio** |
| **R-4** base sembrada compartida con asserts por conteo · **R-5** campos que ni el DTO ni la tabla conocen → 500 | Medio | D27-8 + D27-7 · D27-11 (el servicio proyecta, no reenvía) |
| Key-set/orden roto si una escritura arma su objeto en vez de llamar al mapper | Medio | D27-5 + diff de `Object.keys()` `POST` vs `GET` con `node -e`, **sin `.sort()`** (`jq` no está instalado) |
| Falso negativo por `dist/` obsoleto (gitignored; la API consume el build) | Medio | `just db-build` abre toda verificación; el reinicio es parte de la secuencia |

## Rollback Plan

1. `git checkout packages/db apps/api/rest/src/{common,types}` + `just db-build` +
   `just build-api`. **Sin DDL ni migración** (decisión 1): nada que deshacer en el
   esquema y `just db-reset` **no** es obligatorio; `dist/` se reconstruye.
2. Datos que `git` no deshace: `DELETE FROM types WHERE slug LIKE 'zz-test-%'`.
3. **Parcial**: revertir solo `apps/api/rest` deja las funciones de `packages/db`
   inertes y la API en los stubs — el estado exacto del PR#1, y es verde.

## Estimación y entrega

| Área | Líneas |
|---|---|
| `slug.ts` + `slug.test.ts` + `domain-errors.ts` | ~165 |
| `types.repository.ts` (3 funciones + inputs) + barrel | ~130 |
| `types.integration.test.ts` | ~100 |
| `common/errors/` (+ spec) + `types.service.ts` + `create-type.dto.ts` | ~185 |
| `types.service.spec.ts` (ancla: `shops.service.spec.ts` = 143 líneas) | ~145 |
| **Total** | **~725 (±120)** |

Coincide con las ~725 de la US re-escrita y queda **bajo el umbral de ~900** (R-8): el
alcance ya no es decisión de producto pendiente. Pero **no cabe en 400 líneas**.

- `Decision needed before apply: Yes`
- `Chained PRs recommended: Yes`
- `400-line budget risk: High`

**Cadena de dos PRs** (forecast autoritativo: `sdd-tasks`); frontera natural, cada
mitad la verifica un runner distinto:

- **PR#1 — `packages/db` (~395)**: `slug.ts`, `domain-errors.ts`, repositorio,
  integración, barrel. **Verificable con `just db-check` solo** (base: 8 archivos /
  91 tests). La API no cambia.
- **PR#2 — API (~330)**: `common/errors/`, servicio, DTO, spec de jest. Produce los
  `curl` de la DoD, `just build-api` y `just verify`.

`ask-on-risk`: el orquestador eleva la llamada tras `sdd-tasks`.

## Dependencies

- `just db-up` y `just db-build` antes de cualquier verificación.
- **Ninguna US previa.** **US-27b/28/29/30 dependen de esta** por el barrel
  `packages/db/index.ts` y las dos piezas compartidas; quien arranque segundo rebasea
  sobre el barrel, único archivo que las cuatro comparten.

## Success Criteria (1:1 con la DoD de US-27a)

- [ ] `POST → GET → **reinicio de la API** → GET → PUT → GET → DELETE → GET 404` pegada
      para `types`, con diff de key-sets `POST` vs `GET` (9 claves, sin `.sort()`).
- [ ] CA-3: **409** en `DELETE /types/9` + `psql` del conteo de **productos y
      categorías** antes/después; **200** borrando un type sin dependientes creado en la
      sesión, y `GET` posterior 404.
- [ ] CA-4: 404 (id inexistente), 400 (nombre vacío / slugifica a vacío), sufijo de
      colisión (`gadget` → `gadget-2`). Ningún 500 ni stack.
- [ ] CA-5: 401, 403 `customer`, 403 `store_owner`; decoradores intactos.
- [ ] `grep -n "fuse\|@db/" apps/api/rest/src/types/types.service.ts` = 0 líneas;
      `findAll`/`findOne` desaparecidos.
- [ ] `just db-check` verde con recuento (**base: 8 archivos / 91 tests**).
- [ ] `cd apps/api/rest && npx jest` verde con recuento (**base: 4 suites / 65 tests**);
      los conteos de lectura no cambian.
- [ ] `just build-api` limpio y `just verify` verde.
- [ ] Divergencias declaradas: `promotional_sliders` ignorado, `created_at`/`updated_at`
      (ya embarcada) y el refactor de `isPrismaConnectionError` como adyacente. **Más la
      constancia de CA-7**: helper y mapeador exportados, consumidos por un caso real,
      con tests de tildes / slug vacío / colisión y los cinco códigos cubiertos.
- [ ] Status de US-27a actualizado y fila del épico marcada.
