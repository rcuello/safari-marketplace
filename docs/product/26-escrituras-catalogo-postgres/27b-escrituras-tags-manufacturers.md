# US-27b — Escrituras de `tags` y `manufacturers`

> Los dos catálogos planos restantes dejan de devolver `this.X[0]` (o de mutar
> el array en memoria) en `create`/`update`/`remove` y pasan a persistir en sus
> tablas, **consumiendo** el helper de slug y el mapeo de errores que introdujo
> **US-27a** (ver `./27-escrituras-types-fundaciones.md`). No añade piezas
> compartidas nuevas.

**Épico:** [Épico 26](./README.md)
**Fecha:** 2026-09-09
**Status:** Implementada (2026-09-10)
**Depende de:** US-27a
**LOC est.:** ~825 · **LOC real:** ~2109 en 4 commits secuenciales (364 / 620 / 386 / 730)

## Historia
**Como** administrador del marketplace, **quiero** que crear, editar y borrar
un tag o una marca cambie filas en la base, **para** que el toggle de
aprobación de marcas deje de perderse al reiniciar la API y "guardar" un tag
guarde de verdad.

## Contexto

- `tags.service.ts:67-72`: `create` fabrica `id: this.tags.length + 1` y
  devuelve el DTO **sin guardarlo**; `:131-133` `update` → `this.tags[0]`;
  `:135-137` `remove` → string del scaffold.
- `manufacturers.service.ts:76-78` `create` → `this.manufacturers[0]`;
  `:171-178` `update` **muta el array en memoria**
  (`manufacturer.is_approved = …`) — el toggle de aprobación de
  `manufacturer-list.tsx:125-158` "funciona" hasta el reinicio, que es el peor
  modo de fallo del épico: silencioso; `:180-182` `remove` devuelve
  `This action removes a #id product` (sic — dice "product").
- Ambos servicios importan todavía `@db/tags.json` (`:22`) /
  `@db/manufacturers.json` (`:8`) y construyen un `Fuse` que nadie usa
  (`tags.service.ts:24,33`; `manufacturers.service.ts:10,38`).
- Campos que el admin envía de verdad: `tag-form.tsx:162-190` (`name`,
  `slug` opcional, `details`, `image`, `icon`, `type_id`, `language`);
  `manufacturer-form.tsx:184-220` (`name`, `slug` opcional, `description`,
  `website`, `socials[]`, `image`, `cover_image`, `is_approved`, `type_id`,
  `language`, más `shop_id` solo en create).
- **El toggle de aprobación ES un payload parcial** (corregido 2026-09-10, tras
  el gate de diseño): `manufacturer-list.tsx:134-142` envía **5** claves
  (`{id, name, is_approved, type_id, language}`), no las 10 editables que sí
  manda `manufacturer-form.tsx:184-218` (añade `slug`, `description`,
  `website`, `socials`, `image`, `cover_image`). La versión anterior de esta
  nota decía "el registro editable completo" y era **falsa**.
  Consecuencia normativa, y es la que importa: **una clave ausente del DTO NO
  debe llegar al `data` del `update` de Prisma.** Con inputs todos opcionales y
  spread condicional no hace falta un camino dedicado de partial update, pero
  proyectar todas las columnas sin condición y mapear ausente → `null`
  **borraría `description`, `website` e `image` en cada clic del toggle** — la
  regresión silenciosa que esta US existe para cerrar.
- DTO que no describe eso: `create-manufacturer.dto.ts:4-18` omite `name`,
  `description`, `website`, `image`, `type_id`, `socials`, `cover_image`. El
  body llega entero porque `ValidationPipe` no hace whitelist (`main.ts:9`).
  `create-tag.dto.ts` declara `type` (objeto) en vez de `type_id` (la columna
  real): mismo defecto de documentación, **se corrige aquí**.
- Columnas: `tags` (`db/schema.sql:295-306`: `name`, `slug UNIQUE`, `details`,
  `icon`, `image jsonb`, `type_id → types(id) ON DELETE SET NULL`,
  `language`); `manufacturers` (`:281-292`: `name`, `slug UNIQUE`,
  `description`, `website`, `image jsonb`, `type_id → types(id) ON DELETE SET
  NULL`, `is_approved boolean NOT NULL DEFAULT true`). **Sin columna para
  `socials` ni `cover_image`.**
- **Sin trigger de `updated_at`** en ninguna de las dos
  (`schema.sql:480-500`).
- **Los borrados no arrastran**: los dos `type_id` son `SET NULL`, no
  `CASCADE`. Borrar una marca deja `products.manufacturer_id = NULL` (`:333`)
  y borrar un tag desenlaza `product_tag` (`:425-435`). No hace falta borrado
  protegido aquí (a diferencia de `types` en US-27a).
- Repositorios actuales: `tags.repository.ts` (53 líneas),
  `manufacturers.repository.ts` (71) — solo lecturas más
  `findOrCreateManufacturerBySlug` para el scraper, que es un `upsert` por
  slug y **no se toca**.
- `is_approved` llega booleano y la **lectura** lo emite como
  `Number(record.isApproved)` (`manufacturers.service.ts:60`): esa proyección
  se mantiene.
- Permisos ya aplicados: `ADMIN_ONLY` en tags (`tags.controller.ts:22-50`),
  `ADMIN_OWNER_AND_STAFF` en manufacturers
  (`manufacturers.controller.ts:30-65`). No cambian.

## Scope

**Incluye:** `createTag`/`updateTag`/`deleteTag` y
`createManufacturer`/`updateManufacturer`/`deleteManufacturer` en `@safari/db`
con tests de integración; los 6 métodos de servicio migrados; `updatedAt`
explícito en update (decisión 9); corrección de `CreateManufacturerDto` y de
`CreateTagDto` para declarar los campos reales (decisión 15); eliminación de
los imports de JSON y de `fuse.js` en los dos servicios.

**NO incluye:** el helper de slug ni el mapeo de errores de dominio → HTTP
(**los aporta US-27a; aquí solo se consumen tal cual, sin modificarlos**);
`types` (US-27a); `categories` (US-28); `products` (US-29); `shops` (US-30);
persistir `socials` ni `cover_image` (sin columna, decisión 5); triggers de
`updated_at` (es DDL, decisión 1); refactorizar los métodos de **lectura** al
nuevo mapeo de errores; `top-manufacturers`; partial update de
`updateManufacturer`; cambios en el frontend (decisión 14).

## Criterios de aceptación

### CA-1 — Crear persiste y responde con la proyección del `GET`
`POST /tags` y `POST /manufacturers` con el payload que envía el formulario
del admin crean una fila; la respuesta tiene **el mismo conjunto y orden de
claves** que `GET /{recurso}/{slug}` (9 y 13 claves), y ese `GET` devuelve la
fila **tras reiniciar la API**.

### CA-2 — Editar persiste y no cambia el slug
`PUT /{recurso}/:id` actualiza los campos con columna, deja `slug` intacto
aunque cambie `name`, y `updated_at` avanza (fijado por el repositorio). **El
toggle `is_approved` de marcas sobrevive al reinicio** — hoy no.

### CA-3 — Borrar desenlaza, no arrastra
`DELETE /tags/:id` y `DELETE /manufacturers/:id` borran la fila; los productos
que apuntaban a la marca quedan con `manufacturer_id = NULL` y los enlaces
`product_tag` del tag desaparecen (verificable por `psql`), **sin que se borre
ningún producto**. El `GET` posterior a un borrado es 404.

### CA-4 — Errores de dominio, nunca 500
`PUT`/`DELETE` con id inexistente → 404. `name` vacío o que slugifica a vacío
→ 400. `type_id` inexistente → 400. Slug que colisiona → sufijo `-2`, `-3`…
(no error). Nada de esto produce un 500 ni un log de stack.

### CA-5 — Permisos intactos
Sin token → 401. Token `customer` → 403 en las 6 rutas. `store_owner` → 403 en
tags, 200 en manufacturers (como hoy).

### CA-6 — Sin mock huérfano ni regresión
Los dos servicios ya no importan `@db/*.json` ni `fuse.js`. `just db-check`,
`npx jest`, `just build-api` y `just verify` verdes; los conteos de lectura
(`tags` 10, `manufacturers` 14) no cambian tras la corrida de tests.

### CA-7 — Las piezas compartidas se consumieron sin modificarse
`git diff` no muestra cambios en `packages/db/src/slug.ts`,
`packages/db/src/domain-errors.ts` ni `apps/api/rest/src/common/errors/`. Si
alguno necesitó un cambio, se declara en el reporte con su motivo (es la señal
de que US-27a los diseñó demasiado a la medida de `types`).

## Escenarios Gherkin

```gherkin
Feature: Escrituras de tags y manufacturers
  Scenario: CA-1 — la marca creada sobrevive al reinicio
    Given un token super_admin
    When se hace POST /manufacturers con name "Marca Prueba"
    And se reinicia la API
    Then GET /manufacturers/marca-prueba devuelve 200 con 13 claves
    And name es "Marca Prueba"

  Scenario: CA-2 — el toggle de aprobacion sobrevive al reinicio
    Given una marca con is_approved 1
    When se hace PUT /manufacturers/:id con is_approved false
    And se reinicia la API
    Then GET /manufacturers/{slug} devuelve is_approved 0

  Scenario: CA-2 — renombrar no cambia el slug
    Given un tag con slug "oferta-verano"
    When se hace PUT /tags/:id con name "Oferta de invierno"
    Then la respuesta trae slug "oferta-verano"
    And name "Oferta de invierno"

  Scenario: CA-3 — borrar una marca no borra sus productos
    Given una marca con productos asociados
    When se hace DELETE /manufacturers/:id
    Then la respuesta es 200
    And SELECT count(*) FROM products no cambia
    And esos productos quedan con manufacturer_id NULL

  Scenario: CA-4 — type_id inexistente
    When se hace POST /tags con type_id 99999
    Then la respuesta es 400
    And no se crea ninguna fila
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `packages/db/src/repositories/tags.repository.ts` | `createTag`/`updateTag`/`deleteTag` |
| `packages/db/src/repositories/manufacturers.repository.ts` | `createManufacturer`/`updateManufacturer`/`deleteManufacturer` |
| `packages/db/src/repositories/{tags,manufacturers}.integration.test.ts` | escrituras con centinela y limpieza |
| `packages/db/index.ts` | exportar lo anterior (rebase sobre US-27a) |
| `apps/api/rest/src/tags/tags.service.ts` | migrar 3 métodos; quitar JSON y `Fuse` |
| `apps/api/rest/src/manufacturers/manufacturers.service.ts` | migrar 3 métodos; quitar JSON y `Fuse` |
| `apps/api/rest/src/tags/dto/create-tag.dto.ts` | `type_id` en vez de `type` |
| `apps/api/rest/src/manufacturers/dto/create-manufacturer.dto.ts` | declarar los campos reales |
| `apps/api/rest/src/{tags,manufacturers}/*.service.spec.ts` | **Crear** — jest mockeando `@safari/db` |

## Definición de Done

- [x] Secuencia `POST → GET → reinicio → GET → PUT → GET → DELETE → GET 404`
      pegada para los dos recursos, con comparación de key-sets (`POST` vs
      `GET`, 9 y 13 claves, sin `.sort()`).
- [x] `curl` de CA-2 pegado para el toggle `is_approved` **con reinicio de la
      API en medio** (es el fallo silencioso que esta US cierra).
- [x] `curl` de CA-3 pegado + `psql` mostrando `manufacturer_id = NULL` y las
      filas de `product_tag` desaparecidas, con el conteo de `products`
      intacto.
- [x] `curl` de CA-4 pegado: 404, 400 (nombre vacío), 400 (`type_id`
      inexistente), sufijo de colisión.
- [x] `curl` de CA-5 pegado: 401, 403 `customer`, 403 tags / 200 manufacturers
      con `store_owner`.
- [x] `grep -n "fuse\|@db/"` sobre los dos servicios devuelve 0 líneas.
- [x] `git diff --stat` de las piezas compartidas de US-27a: sin cambios
      (CA-7), o desviación declarada.
- [x] `just db-check` verde con recuento (pegar el nuevo; la base la fija
      US-27a al cerrar).
- [x] `cd apps/api/rest && npx jest` verde con recuento.
- [x] `just build-api` limpio y `just verify` verde.
- [x] Divergencias declaradas en el reporte: campos ignorados (`socials`,
      `cover_image`) y cualquier otra.
- [x] Status de esta US actualizado y fila del épico marcada.

## Notas para el agente ejecutor

- **Leer primero el change archivado de US-27a**
  (`openspec/changes/archive/…-escrituras-types-fundaciones/`): su `design.md`
  fija la estrategia de slug y la forma del mapeo de errores. Esta US los
  **consume**; si algo no encaja, se para y se pregunta antes de modificarlos
  (romperlos afectaría también a US-28/29/30).
- `updateManufacturer` recibe payloads **parciales** (el toggle manda 5 de 10
  campos editables — ver Contexto). No hace falta un camino dedicado de partial
  update, pero **toda clave ausente debe quedar fuera del `data` de Prisma**:
  inputs opcionales + spread condicional, nunca ausente → `null`.
- `is_approved` llega booleano al servicio y la proyección de lectura lo emite
  como `Number(record.isApproved)` (`manufacturers.service.ts:60`): coercionar
  en el mapper, no en el repositorio.
- `manufacturers.type`: el formulario envía el tipo, la columna es `type_id`.
  El mapper resuelve el `type` embebido con `listTypes()` en memoria, igual
  que `getManufactures` (`:99-111`) y `tags.service.ts:88`. **No cambiar eso.**
- `findOrCreateManufacturerBySlug` es del scraper y **no se toca**: los
  nuevos `createManufacturer`/`updateManufacturer` son funciones aparte en el
  mismo archivo (D-2).
- Las respuestas de escritura reutilizan `toTagDto` (9 claves) y
  `toManufacturerDto` (13) tal cual; `DELETE` devuelve el registro borrado con
  la misma proyección. No escribir mappers nuevos (D-6).
- Centinela `zz-test-` + `beforeAll(cleanup)`/`afterAll(cleanup)`: las suites
  existentes assertan `toBe(10)` en tags y `toBe(14)` en manufacturers, así
  que basura de una corrida abortada las pone rojas.
- Esta US **rebasa sobre `packages/db/index.ts`** si US-28/29/30 corren en
  paralelo: es el único archivo compartido entre las cuatro.
- `packages/db/dist` está gitignored: **`just db-build` antes de verificar
  contra la API**.
