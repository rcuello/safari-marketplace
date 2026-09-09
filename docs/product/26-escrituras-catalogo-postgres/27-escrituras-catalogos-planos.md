# US-27 — Escrituras de catálogos planos: `types`, `tags`, `manufacturers`

> Los tres catálogos sin jerarquía ni pivotes dejan de devolver `this.X[0]`
> en `create`/`update`/`remove` y pasan a persistir en sus tablas. Es la
> primera US del épico y la que introduce las dos piezas compartidas: el
> helper de slug en `packages/db` y la traducción de errores de dominio a
> HTTP en la API.

**Épico:** [Épico 26](./README.md)
**Fecha:** 2026-09-09
**Status:** Listo para ejecución
**Depende de:** ninguna
**LOC est.:** ~500

## Historia
**Como** administrador del marketplace, **quiero** que crear, editar y borrar
una vertical, un tag o una marca cambie filas en la base, **para** que el
panel deje de ser una maqueta en la que "guardar" no guarda.

## Contexto

- `types.service.ts:92-94` (`create` → `this.types[0]`), `:104-106`
  (`update`, ídem), `:108-110` (`remove` → string). Además `:96-102`
  (`findAll`/`findOne`) son restos del scaffold que **ningún controlador
  invoca** (`types.controller.ts` llama a `getTypes`/`getTypeBySlug`).
- `tags.service.ts:67-72`: `create` fabrica `id: this.tags.length + 1` y
  devuelve el DTO sin guardarlo; `:131-137` `update`/`remove` stubs.
- `manufacturers.service.ts:76-78` `create` stub; `:171-178` `update`
  **muta el array en memoria** (`manufacturer.is_approved = …`) — el toggle
  de aprobación de `manufacturer-list.tsx:125-158` "funciona" hasta el
  reinicio; `:180-182` `remove` devuelve `This action removes a #id product`
  (sic).
- Los tres servicios importan todavía `@db/*.json` y construyen un `Fuse`
  que nadie usa (`types.service.ts:19-29`, `tags.service.ts:22-33`,
  `manufacturers.service.ts:8-38`).
- Campos que el admin envía de verdad: `group-form.tsx:312-338` (types:
  `name`, `icon`, `banners[]`, `promotional_sliders[]`, `settings{isHome,
  layoutType, productCard}`, `language`); `tag-form.tsx:162-190` (`name`,
  `details`, `image`, `icon`, `type_id`, `language`);
  `manufacturer-form.tsx:79-86` (`name`, `description`, `website`,
  `socials[]`, `image`, `cover_image`, `is_approved`, tipo) y
  `manufacturer-list.tsx:138` (`{ id, is_approved }` desde la lista).
- DTOs que no describen eso: `create-type.dto.ts:1` (clase vacía),
  `create-manufacturer.dto.ts:4-18` (omite `name`, `website`, `image`…).
  El body llega entero porque `ValidationPipe` no hace whitelist
  (`main.ts:9`).
- Columnas: `types` (`db/schema.sql:90-101`: `name`, `slug`, `icon`,
  `settings jsonb`, `banners jsonb`, `language`), `tags` (`:295-306`:
  `type_id … ON DELETE SET NULL`), `manufacturers` (`:281-292`:
  `is_approved boolean NOT NULL DEFAULT true`, `type_id … SET NULL`). Sin
  columna para `promotional_sliders`, `socials`, `cover_image`.
- **Sin trigger de `updated_at`** en las tres tablas (`schema.sql:488-500`).
- Repositorios actuales: `types.repository.ts` (32 líneas),
  `tags.repository.ts` (53), `manufacturers.repository.ts` (71) — solo
  lecturas más `findOrCreateManufacturerBySlug` para el scraper.
- Permisos ya aplicados: `ADMIN_ONLY` en types/tags
  (`types.controller.ts:22-50`, `tags.controller.ts:22-50`),
  `ADMIN_OWNER_AND_STAFF` en manufacturers
  (`manufacturers.controller.ts:30-65`). No cambian.

## Scope

**Incluye:** `createType`/`updateType`/`deleteType`, `createTag`/
`updateTag`/`deleteTag`, `createManufacturer`/`updateManufacturer`/
`deleteManufacturer` en `@safari/db` con tests de integración; el helper de
slug compartido (D-3) con sus tests; la traducción de errores de dominio →
HTTP (D-4); los 9 métodos de servicio migrados; el borrado protegido de
`types` (decisión 7); `updatedAt` explícito en update (decisión 9);
corrección de `CreateTypeDto`/`CreateManufacturerDto` para declarar los
campos reales (decisión 15); eliminación de los imports de JSON y `fuse.js`
y de `findAll`/`findOne` muertos en `types.service.ts`.

**NO incluye:** `categories` (US-28), `products` (US-29), `shops` (US-30);
persistir `promotional_sliders`, `socials` o `cover_image` (sin columna,
decisión 5); triggers de `updated_at` (DDL); refactorizar los métodos de
lectura al nuevo mapeo de errores; `top-manufacturers`; cambios en el
frontend.

## Criterios de aceptación

### CA-1 — Crear persiste y responde con la proyección del `GET`
`POST /types`, `POST /tags` y `POST /manufacturers` con el payload que envía
el formulario del admin crean una fila; la respuesta tiene **el mismo
conjunto y orden de claves** que `GET /{recurso}/{slug}` (9, 9 y 13 claves),
y ese `GET` devuelve la fila **tras reiniciar la API**.

### CA-2 — Editar persiste y no cambia el slug
`PUT /{recurso}/:id` actualiza los campos con columna, deja `slug` intacto
aunque cambie `name`, y `updated_at` avanza (fijado por el repositorio). El
toggle `is_approved` de marcas sobrevive al reinicio.

### CA-3 — Borrar: permitido en tags y marcas, protegido en types
`DELETE /tags/:id` y `DELETE /manufacturers/:id` borran la fila; los
productos que apuntaban a la marca quedan con `manufacturer_id = NULL` y los
enlaces `product_tag` desaparecen (verificable por `psql`). `DELETE
/types/:id` responde **409** si la vertical tiene categorías o productos y
borra solo cuando no tiene ninguno. El `GET` posterior a un borrado es 404.

### CA-4 — Errores de dominio, nunca 500
`PUT`/`DELETE` con id inexistente → 404. `name` vacío o que slugifica a
vacío → 400. `type_id` inexistente en tag/marca → 400. Slug que colisiona →
sufijo `-2`, `-3`… (no error). Nada de esto produce un 500 ni un log de
stack.

### CA-5 — Permisos intactos
Sin token → 401. Token `customer` → 403 en las 9 rutas. `store_owner` → 403
en types/tags, 200 en manufacturers (como hoy).

### CA-6 — Sin mock huérfano ni regresión
Los tres servicios ya no importan `@db/*.json` ni `fuse.js`;
`findAll`/`findOne` de `types.service.ts` desaparecen. `just db-check`,
`npx jest`, `just build-api` y `just verify` verdes; los conteos de lectura
(`types` 10, `tags` 10, `manufacturers` 14) no cambian tras la corrida de
tests.

## Escenarios Gherkin

```gherkin
Feature: Escrituras de catalogos planos
  Scenario: CA-1 — la marca creada sobrevive al reinicio
    Given un token super_admin
    When se hace POST /manufacturers con name "Marca Prueba"
    And se reinicia la API
    Then GET /manufacturers/marca-prueba devuelve 200 con 13 claves
    And name es "Marca Prueba"

  Scenario: CA-2 — renombrar no cambia el slug
    Given un tag con slug "oferta-verano"
    When se hace PUT /tags/:id con name "Oferta de invierno"
    Then la respuesta trae slug "oferta-verano"
    And name "Oferta de invierno"

  Scenario: CA-3 — borrar una vertical con productos esta protegido
    Given el type "gadget" con productos en la base
    When se hace DELETE /types/9
    Then la respuesta es 409
    And SELECT count(*) FROM products WHERE type_id = 9 no cambia

  Scenario: CA-4 — colision de slug
    Given un type con slug "gadget"
    When se hace POST /types con name "Gadget"
    Then la respuesta es 201 con slug "gadget-2"
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `packages/db/src/slug.ts` | **Crear** — helper de slug (misma regla que `slugify()` SQL) + resolución de colisión por tabla |
| `packages/db/src/slug.test.ts` | **Crear** — tildes, vacío, colisión |
| `packages/db/src/repositories/types.repository.ts` | `createType`/`updateType`/`deleteType` (borrado protegido) |
| `packages/db/src/repositories/tags.repository.ts` | `createTag`/`updateTag`/`deleteTag` |
| `packages/db/src/repositories/manufacturers.repository.ts` | `createManufacturer`/`updateManufacturer`/`deleteManufacturer` |
| `packages/db/src/repositories/{types,tags,manufacturers}.integration.test.ts` | escrituras con centinela y limpieza |
| `packages/db/src/errors.ts` o nuevo módulo | errores de dominio comunes (`NotFound`, `DependentRows`, `EmptySlug`) |
| `packages/db/index.ts` | exportar lo anterior |
| `apps/api/rest/src/common/errors/…` | **Crear** — errores de dominio → 400/404/409, 503 conexión |
| `apps/api/rest/src/types/types.service.ts` | migrar 3 métodos; quitar JSON, `Fuse`, `findAll`/`findOne` |
| `apps/api/rest/src/tags/tags.service.ts` | migrar 3 métodos; quitar JSON y `Fuse` |
| `apps/api/rest/src/manufacturers/manufacturers.service.ts` | migrar 3 métodos; quitar JSON y `Fuse` |
| `apps/api/rest/src/types/dto/create-type.dto.ts`, `manufacturers/dto/create-manufacturer.dto.ts` | declarar los campos reales |
| `apps/api/rest/src/{types,tags,manufacturers}/*.service.spec.ts` | **Crear** — jest mockeando `@safari/db` |

## Definición de Done

- [ ] Secuencia `POST → GET → reinicio → GET → PUT → GET → DELETE → GET 404`
      pegada para los tres recursos, con comparación de key-sets
      (`POST` vs `GET`, sin `.sort()`).
- [ ] `curl` de CA-3 pegado: 409 en `DELETE /types/9` + `psql` con el conteo
      de productos antes/después; 200 en el borrado de un type sin
      dependientes creado en la misma sesión.
- [ ] `curl` de CA-4 pegado: 404, 400 (nombre vacío), 400 (`type_id`
      inexistente), sufijo de colisión.
- [ ] `curl` de CA-5 pegado: 401, 403 `customer`, 403/200 `store_owner`.
- [ ] `grep -n "fuse\|@db/" ` sobre los tres servicios devuelve 0 líneas.
- [ ] `just db-check` verde con recuento (hoy 91 tests; pegar el nuevo).
- [ ] `cd apps/api/rest && npx jest` verde con recuento (hoy 4 suites).
- [ ] `just build-api` limpio y `just verify` verde.
- [ ] Divergencias declaradas en el reporte: campos ignorados
      (`promotional_sliders`, `socials`, `cover_image`) y cualquier otra.
- [ ] Status de esta US actualizado y fila del épico marcada.

## Notas para el agente ejecutor

- **El helper de slug tiene que coincidir con `slugify()` de la base**
  (`db/schema.sql:39-61`: quita tildes con una tabla fija, `lower`,
  `[^a-z0-9]+` → `-`, colapsa guiones, `trim`). Opción más segura: pedirle
  el slug a Postgres (`SELECT slugify($1)`) y resolver la colisión con un
  `SELECT slug FROM {tabla} WHERE slug LIKE base || '%'`. Decidirlo en el
  design y dejar un test que compare con la función SQL para tres nombres
  con tildes.
- Los tests de integración escriben en la misma base que
  `types.integration.test.ts:…` asserta con `toBe(10)`. Usar un prefijo
  centinela en `name`/`slug` (`zz-test-…`) y `beforeAll(cleanup)` +
  `afterAll(cleanup)`, como `users.integration.test.ts:35-40`.
- `updateManufacturer` debe aceptar el payload mínimo de la lista
  (`{ is_approved }`) y el completo del formulario. `is_approved` llega
  booleano y la lectura lo emite como `Number(record.isApproved)`
  (`manufacturers.service.ts:60`): mantener esa proyección.
- `manufacturers.type`: el formulario envía el tipo; la columna es
  `type_id`. El mapper resuelve `type` embebido con `listTypes()` en
  memoria, igual que `getManufactures` (`:99-111`). No cambiar eso.
- `types.settings` y `types.banners` son `jsonb NOT NULL DEFAULT` — si el
  admin no los envía, no mandar `null`: omitir la clave para que aplique el
  default.
- Los `try/catch` de `isPrismaConnectionError` repetidos en cada método de
  lectura **no se refactorizan aquí**; el nuevo mapeo de errores se usa solo
  en los métodos de escritura. Mencionar el refactor como mejora adyacente.
