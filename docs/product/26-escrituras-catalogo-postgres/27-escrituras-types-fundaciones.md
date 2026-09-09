# US-27a — Escrituras de `types` y las piezas compartidas

> La vertical (`types`) deja de devolver `this.types[0]` en `create`/`update`/
> `remove` y pasa a persistir en su tabla. Es la primera US del épico y la que
> introduce las **dos piezas que consumen todas las demás**: el helper de slug
> en `packages/db` (D-3) y la traducción de errores de dominio a HTTP en la API
> (D-4). `tags` y `manufacturers` se partieron a **US-27b** (ver
> `./27b-escrituras-tags-manufacturers.md`).

**Épico:** [Épico 26](./README.md)
**Fecha:** 2026-09-09
**Status:** Listo para ejecución
**Depende de:** ninguna
**LOC est.:** ~725

## Historia
**Como** administrador del marketplace, **quiero** que crear, editar y borrar
una vertical cambie filas en la base, **para** que el panel deje de ser una
maqueta en la que "guardar" no guarda — y que las tres US siguientes hereden
el slug y el mapeo de errores ya probados contra un recurso real.

## Contexto

- `types.service.ts:92-94` (`create` → `this.types[0]`), `:104-106`
  (`update`, ídem), `:108-110` (`remove` → string). Además `:96-102`
  (`findAll`/`findOne`) son restos del scaffold que **ningún controlador
  invoca** (`types.controller.ts` llama a `getTypes`/`getTypeBySlug`).
- El servicio importa todavía `@db/types.json` (`:19`) y construye un `Fuse`
  que nadie usa (`:20,29`).
- Campos que el admin envía de verdad: `group-form.tsx:312-338` — `name`,
  `icon`, `banners[]`, `promotional_sliders[]`, `settings{isHome, layoutType,
  productCard}`, `language`, y en creación un `slug` opcional. El DTO que no
  describe eso: `create-type.dto.ts:1` es una **clase vacía**. El body llega
  entero porque `ValidationPipe` no hace whitelist (`main.ts:9`).
- Columnas de `types` (`db/schema.sql:90-101`): `name`, `slug UNIQUE`, `icon`,
  `settings jsonb NOT NULL DEFAULT '{}'`, `banners jsonb NOT NULL DEFAULT
  '[]'`, `language`, `created_at`, `updated_at`. **Sin columna para
  `promotional_sliders`.**
- **Sin trigger de `updated_at`** en `types` (`schema.sql:480-500` cubre
  `products`, `categories`, `shops`, `users`, `profiles`).
- **El borrado arrastra:** `categories.type_id … ON DELETE CASCADE`
  (`schema.sql:269`) y `products.type_id … ON DELETE CASCADE` (`:331`). Un
  `DELETE /types/:id` ingenuo borraría las categorías **y los productos** de
  esa vertical desde un clic en `group-delete-view.tsx`. Es el riesgo R-1 del
  épico, y esta US es la que lo desactiva.
- `types.repository.ts` son 32 líneas: solo `listTypes`/`findTypeBySlug`.
  Ningún `create*`/`update*`/`delete*` de agregados existe en
  `packages/db/index.ts` todavía.
- El precedente de escritura con validación previa y traducción de
  violaciones de CHECK es `upsertScrapedProduct`
  (`products.repository.ts:328-397`, `_translateCheckViolation` en `:454`).
- `apps/api/rest/src/common/` **no tiene hoy un subdirectorio `errors/`**: la
  pieza D-4 es código nuevo, no un refactor.
- Permisos ya aplicados: `ADMIN_ONLY` en `types.controller.ts:22-50`. No
  cambian.
- Baselines medidos: `just db-check` → 8 archivos / 91 tests;
  `cd apps/api/rest && npx jest` → 4 suites / 65 tests.

## Scope

**Incluye:** el helper de slug compartido (D-3) con sus tests; las clases de
error de dominio compartidas en `packages/db`; la traducción de errores de
dominio → HTTP en `apps/api/rest/src/common/errors/` (D-4);
`createType`/`updateType`/`deleteType` en `@safari/db` con tests de
integración; el borrado protegido de `types` (decisión 7); `updatedAt`
explícito en update (decisión 9); los 3 métodos de `types.service.ts`
migrados; corrección de `CreateTypeDto` para declarar los campos reales
(decisión 15); eliminación del import de JSON, de `fuse.js` y de los muertos
`findAll`/`findOne` en `types.service.ts`; el assert de conteo total que hoy
le falta a `types.integration.test.ts`.

**NO incluye:** `tags` ni `manufacturers` (US-27b); `categories` (US-28);
`products` (US-29); `shops` (US-30); persistir `promotional_sliders` (sin
columna, decisión 5); triggers de `updated_at` (es DDL, decisión 1);
refactorizar los métodos de **lectura** al nuevo mapeo de errores (los ~26
sitios de `isPrismaConnectionError` quedan intactos); `create-tag.dto.ts`
(documenta `type` en vez de `type_id`: mismo defecto que la decisión 15, pero
es de US-27b); cambios en el frontend (decisión 14).

## Criterios de aceptación

### CA-1 — Crear persiste y responde con la proyección del `GET`
`POST /types` con el payload que envía `group-form.tsx` crea una fila; la
respuesta tiene **el mismo conjunto y orden de claves** que
`GET /types/{slug}` (9 claves), y ese `GET` devuelve la fila **tras reiniciar
la API**.

### CA-2 — Editar persiste y no cambia el slug
`PUT /types/:id` actualiza los campos con columna, deja `slug` intacto aunque
cambie `name`, y `updated_at` avanza (fijado por el repositorio, no por un
trigger).

### CA-3 — Borrar está protegido
`DELETE /types/:id` responde **409** si la vertical tiene categorías o
productos, y el conteo de ambas tablas **no cambia**. Borra solo cuando no
tiene ninguno; el `GET` posterior a un borrado exitoso es 404.

### CA-4 — Errores de dominio, nunca 500
`PUT`/`DELETE` con id inexistente → 404. `name` vacío o que slugifica a vacío
→ 400. Slug que colisiona → sufijo `-2`, `-3`… (no error). Nada de esto
produce un 500 ni un log de stack.

### CA-5 — Permisos intactos
Sin token → 401. Token `customer` → 403 en las 3 rutas. Token `store_owner` →
403 (como hoy: `ADMIN_ONLY`).

### CA-6 — Sin mock huérfano ni regresión
`types.service.ts` ya no importa `@db/types.json` ni `fuse.js`;
`findAll`/`findOne` desaparecen. `just db-check`, `npx jest`,
`just build-api` y `just verify` verdes; el conteo de lectura de `types`
(10) no cambia tras la corrida de tests — y ahora hay un assert que lo
comprueba.

### CA-7 — Las piezas compartidas quedan listas para US-27b/28/29/30
El helper de slug y el mapeo de errores están exportados y consumidos por al
menos un caso real; sus tests cubren tildes, nombre que slugifica a vacío y
colisión. Ninguna de las tres US siguientes necesita tocar su implementación
para usarlos.

## Escenarios Gherkin

```gherkin
Feature: Escrituras de types y piezas compartidas
  Scenario: CA-1 — la vertical creada sobrevive al reinicio
    Given un token super_admin
    When se hace POST /types con name "Vertical Prueba"
    And se reinicia la API
    Then GET /types/vertical-prueba devuelve 200 con 9 claves
    And name es "Vertical Prueba"

  Scenario: CA-2 — renombrar no cambia el slug
    Given un type con slug "vertical-prueba"
    When se hace PUT /types/:id con name "Vertical Renombrada"
    Then la respuesta trae slug "vertical-prueba"
    And name "Vertical Renombrada"

  Scenario: CA-3 — borrar una vertical con productos esta protegido
    Given el type "gadget" con productos en la base
    When se hace DELETE /types/9
    Then la respuesta es 409
    And SELECT count(*) FROM products WHERE type_id = 9 no cambia
    And SELECT count(*) FROM categories WHERE type_id = 9 no cambia

  Scenario: CA-3 — borrar una vertical sin dependientes si se permite
    Given un type creado en esta sesion, sin categorias ni productos
    When se hace DELETE /types/:id
    Then la respuesta es 200 con la proyeccion de 9 claves
    And el GET posterior es 404

  Scenario: CA-4 — colision de slug
    Given un type con slug "gadget"
    When se hace POST /types con name "Gadget"
    Then la respuesta es 201 con slug "gadget-2"

  Scenario: CA-4 — nombre que slugifica a vacio
    When se hace POST /types con name "!!!"
    Then la respuesta es 400
    And no se crea ninguna fila
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `packages/db/src/slug.ts` | **Crear** — helper de slug (misma regla que `slugify()` SQL) + resolución de colisión por tabla |
| `packages/db/src/slug.test.ts` | **Crear** — tildes, vacío, colisión, y comparación contra la función SQL |
| `packages/db/src/domain-errors.ts` | **Crear** — errores de dominio comunes (`RecordNotFound`, `DependentRows`, `EmptySlug`, FK inválida) |
| `packages/db/src/repositories/types.repository.ts` | `createType`/`updateType`/`deleteType` (borrado protegido) |
| `packages/db/src/repositories/types.integration.test.ts` | escrituras con centinela y limpieza + el assert de conteo que hoy falta |
| `packages/db/index.ts` | exportar lo anterior |
| `apps/api/rest/src/common/errors/…` | **Crear** — errores de dominio → 400/404/409, 503 conexión |
| `apps/api/rest/src/types/types.service.ts` | migrar 3 métodos; quitar JSON, `Fuse`, `findAll`/`findOne` |
| `apps/api/rest/src/types/dto/create-type.dto.ts` | declarar los campos reales |
| `apps/api/rest/src/types/types.service.spec.ts` | **Crear** — jest mockeando `@safari/db` |

## Definición de Done

- [ ] Secuencia `POST → GET → reinicio → GET → PUT → GET → DELETE → GET 404`
      pegada para `types`, con comparación de key-sets (`POST` vs `GET`, 9
      claves, sin `.sort()`).
- [ ] `curl` de CA-3 pegado: 409 en `DELETE /types/9` + `psql` con el conteo
      de productos **y de categorías** antes/después; 200 en el borrado de un
      type sin dependientes creado en la misma sesión.
- [ ] `curl` de CA-4 pegado: 404, 400 (nombre vacío), sufijo de colisión.
- [ ] `curl` de CA-5 pegado: 401, 403 `customer`, 403 `store_owner`.
- [ ] `grep -n "fuse\|@db/" apps/api/rest/src/types/types.service.ts` devuelve
      0 líneas.
- [ ] `just db-check` verde con recuento (base medida: 8 archivos / 91 tests;
      pegar el nuevo).
- [ ] `cd apps/api/rest && npx jest` verde con recuento (base medida: 4
      suites / 65 tests).
- [ ] `just build-api` limpio y `just verify` verde.
- [ ] Divergencias declaradas en el reporte: `promotional_sliders` ignorado
      (sin columna) y cualquier otra.
- [ ] Status de esta US actualizado y fila del épico marcada.

## Notas para el agente ejecutor

- **El helper de slug tiene que coincidir con `slugify()` de la base**
  (`db/schema.sql:39-61`: quita tildes con una tabla fija de 51 caracteres,
  `lower`, `[^a-z0-9]+` → `-`, colapsa guiones, `trim`). Las dos opciones
  —reimplementarla en TypeScript o pedirle el slug a Postgres
  (`SELECT slugify($1)`)— están sopesadas en la exploración del change; la
  **decide el design**, no el ejecutor. La resolución de colisión
  (`SELECT slug FROM types WHERE slug LIKE base || '%'`) hace falta en ambas.
  En cualquier caso: dejar un test que compare con la función SQL para tres
  nombres con tildes.
- **Esta US es la que fija el patrón para tres más.** El helper de slug y el
  mapeo de errores se diseñan pensando en `tags`, `manufacturers`,
  `categories`, `products` y `shops`, no solo en `types`: el helper recibe la
  tabla y el mapeo cubre los tres códigos (400/404/409). Pero **solo se
  integra con `types`** aquí; no se escriben adaptadores para los otros
  agregados por adelantado.
- Los tests de integración escriben en la misma base sembrada donde
  `types.integration.test.ts` asserta contra `'gadget'`. Usar un prefijo
  centinela en `name`/`slug` (`zz-test-…`) y `beforeAll(cleanup)` +
  `afterAll(cleanup)`, como `users.integration.test.ts:32-40`.
- `types.settings` y `types.banners` son `jsonb NOT NULL DEFAULT` — si el
  admin no los envía, no mandar `null`: **omitir la clave** para que aplique
  el default.
- La respuesta de escritura reutiliza `toTypeDto` (`types.service.ts:39-51`,
  9 claves) tal cual; `DELETE` devuelve el registro borrado con la misma
  proyección. No escribir un mapper nuevo (D-6).
- El `updated_at` lo fija el repositorio con `now()` de
  `packages/db/src/clock.ts` (mismo import que `upsertScrapedProduct`): la
  tabla no tiene trigger.
- Los `try/catch` de `isPrismaConnectionError` repetidos en cada método de
  **lectura** no se refactorizan aquí; el nuevo mapeo se usa solo en los
  métodos de escritura. Mencionar el refactor como mejora adyacente.
- `packages/db/dist` está gitignored y la API lo consume vía `link:`:
  **`just db-build` antes de cualquier verificación contra la API**, o se
  verifica el código viejo y el resultado es un falso negativo.
