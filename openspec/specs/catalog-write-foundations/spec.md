# Catalog Write Foundations Specification

## Purpose

Dos piezas compartidas que las escrituras de catálogo necesitan y que
**cuatro US más** (`tags`/`manufacturers` en US-27b, `categories` en US-28,
`products` en US-29, `shops` en US-30) consumirán sin editar: la regla de
generación de slug en servidor y la traducción de errores de dominio a
códigos HTTP. Esta capability se introduce en US-27a y se integra **solo**
con `types` aquí — añadir otro agregado MUST ser un call site, nunca una
edición de estos archivos (D27-13). El mecanismo concreto de cómputo del
slug (TypeScript vs. delegar a Postgres) es una decisión de `sdd-design`
todavía abierta; esta spec describe el comportamiento observable, no la
implementación.

## Requirements

### Requirement: Slug generado en servidor a partir de `slug` o `name` (CA-7)

El sistema MUST generar el slug de un recurso en el servidor: si el cliente
envía un campo `slug` no vacío, se usa ese valor normalizado; si no, se
deriva de `name`. La normalización MUST producir el mismo resultado que la
función `slugify()` de la base (minúsculas, sin tildes, caracteres fuera de
`[a-z0-9]` colapsados a un guion, guiones repetidos colapsados, sin guiones
al inicio/fin). El helper MUST recibir la tabla/agregado como parámetro
(genérico por firma) en vez de tener una variante por catálogo. Esta
Requirement MUST permanecer agnóstica de si la normalización corre en
TypeScript o vía `SELECT slugify($1)` en Postgres.

#### Scenario: Nombre con tildes normaliza igual que la función SQL
- GIVEN los nombres `"Café & Té"`, `"Acción!"`, `"Niño Grande"`
- WHEN se generan sus slugs
- THEN cada resultado es idéntico al que produce `SELECT slugify($1)` sobre
  el mismo texto

#### Scenario: Un `slug` explícito del cliente tiene prioridad sobre `name`
- GIVEN un payload con `name "Vertical X"` y `slug "vertical-custom"`
- WHEN se genera el slug del recurso
- THEN el slug resultante es `"vertical-custom"` normalizado, no derivado de `name`

### Requirement: Colisión de slug resuelve con sufijo numérico incremental (CA-4, CA-7)

Cuando el slug calculado ya existe en la tabla, el sistema MUST anexar un
sufijo numérico incremental (`-2`, `-3`, …) hasta encontrar uno libre, sin
producir un error. La resolución de colisión MUST funcionar igual para
cualquier tabla que use el helper (genérico por firma), consultando solo la
tabla del agregado en cuestión.

#### Scenario: Primera colisión produce el sufijo `-2`
- GIVEN un slug existente `"gadget"` en la tabla `types`
- WHEN se genera el slug para un nuevo `name "Gadget"`
- THEN el resultado es `"gadget-2"`

#### Scenario: Colisiones sucesivas incrementan el sufijo
- GIVEN slugs existentes `"gadget"` y `"gadget-2"` en la misma tabla
- WHEN se genera el slug para otro `name "Gadget"`
- THEN el resultado es `"gadget-3"`

### Requirement: Nombre que slugifica a vacío es un error de dominio (CA-4, CA-7)

Si el `name` (o el `slug` explícito) normaliza a una cadena vacía, el
sistema MUST lanzar el error de dominio `EmptySlug` **antes** de cualquier
escritura, y ninguna fila MUST crearse ni actualizarse.

#### Scenario: `name` compuesto solo por símbolos
- GIVEN un payload con `name "!!!"`
- WHEN se intenta generar su slug
- THEN se lanza `EmptySlug` y no se ejecuta ningún INSERT/UPDATE

### Requirement: Slug inmutable tras la creación (CA-2, CA-7)

Una vez creado un recurso, ninguna operación de actualización MUST
recalcular ni modificar su slug, incluso si `name` cambia en la misma
solicitud.

#### Scenario: Actualizar `name` no toca el slug existente
- GIVEN un recurso con slug `"vertical-prueba"`
- WHEN se actualiza su `name` a un valor distinto
- THEN el slug de la fila permanece `"vertical-prueba"`

### Requirement: Contrato dominio → HTTP es un conjunto cerrado de 5 códigos (CA-4, CA-7)

El mapeador de errores de dominio a HTTP MUST cubrir exactamente estos
cinco códigos, como una tabla `code → status`, nunca como ramas
`if (aggregate === …)` ni wrappers por agregado: `EmptySlug` → 400,
`InvalidReference` → 400, `RecordNotFound` → 404, `DependentRows` → 409,
`SlugConflict` → 409. Ningún error de dominio MUST resultar en 500. Integrar
un agregado nuevo MUST limitarse a invocar el mapeador existente desde su
propio `catch` (un call site), sin tocar el archivo del mapeador ni el de
los errores de dominio.

Una violación de un CHECK constraint de Postgres MUST NOT pertenecer a este
conjunto cerrado: el mapeador solo reconoce los códigos de Prisma
`P2002`/`P2003`/`P2025` y devuelve intacto cualquier otro error, que
degradaría a HTTP 500 si llegara sin traducir. Por tanto, toda regla de
negocio expresada como CHECK en el DDL MUST pre-validarse en código de
aplicación **antes** del write; el CHECK sobrevive solo como red de
integridad de la base, nunca como comportamiento observable de la API.
(Previously: la requirement no distinguía el caso de un error de Postgres
sin código Prisma reconocido — CHECK constraints — de los tres códigos ya
cubiertos.)

#### Scenario: Cada uno de los cinco códigos mapea a su status
- GIVEN una instancia de cada uno de `EmptySlug`, `InvalidReference`,
  `RecordNotFound`, `DependentRows`, `SlugConflict`
- WHEN cada una pasa por el mapeador
- THEN los status resultantes son 400, 400, 404, 409, 409 respectivamente

#### Scenario: `types` solo ejercita tres códigos, pero los cinco están probados
- GIVEN que `types` solo puede producir `EmptySlug`, `RecordNotFound` y
  `DependentRows` por HTTP (no tiene ruta que dispare `InvalidReference` ni
  `SlugConflict`)
- WHEN se revisa la cobertura del spec unitario del mapeador
- THEN los cinco códigos tienen un test directo, sin depender de una ruta HTTP

#### Scenario: Una violación de CHECK no pertenece al conjunto cerrado — lección para `products` (US-29)
- GIVEN el CHECK `categories_no_autoreferencia` (`db/schema.sql:274`) sin
  pre-validación equivalente en código de aplicación
- WHEN una escritura dejara pasar `parent_id = id` hasta Postgres sin
  rechazarla antes
- THEN Postgres rechazaría el `UPDATE` con una violación de CHECK que el
  mapeador no reconoce, y la respuesta degradaría a HTTP 500 en vez de 400
- AND por eso `categories` pre-valida esa regla en código antes del write, y
  cualquier agregado futuro con CHECKs propios (`products` tiene tres) MUST
  hacer lo mismo

#### Scenario: Las cinco expresiones CHECK/`IN` de `products` quedan pre-validadas — cobertura confirmada (CA-7, US-29)
- GIVEN las cinco reglas de `products` (`products_rebaja_valida`,
  `products_simple_con_precio`, `products_procedencia_completa`, el `IN` de
  `product_type`, el `IN` de `status`)
- WHEN `createProduct`/`updateProduct` (`product-write-api`) construyen su
  input antes del write
- THEN 1 de 5 se hereda tal cual de `upsertScrapedProduct`
  (`products_rebaja_valida`), 3 de 5 llevan guarda nueva escrita para el
  input del admin (`products_simple_con_precio`, el `IN` de
  `product_type`, el `IN` de `status`), y 1 de 5
  (`products_procedencia_completa`) se cumple por construcción del tipo,
  sin guarda de runtime
- AND ninguna de las cinco es alcanzable como violación de CHECK sin
  traducir sobre HTTP: cada una responde 400 antes de llegar a Postgres, y
  el conjunto cerrado de 5 códigos no se amplía

#### Scenario: `shops` (US-30) consume las piezas compartidas sin crear ninguna, y el conjunto cerrado no se ensancha
- GIVEN `db/schema.sql:231-244` (`CREATE TABLE shops`), verificado sin
  ningún CHECK ni expresión `IN`, solo una FK saliente (`owner_id`) y un
  `UNIQUE` (`slug`)
- WHEN `createShop`/`updateShop`/`setShopActive` (`shop-write-api`)
  construyen su input y ejecutan el write
- THEN únicamente `P2002` (slug duplicado → 409), `P2003` (`owner_id`
  inexistente → 400) y `P2025` (fila inexistente → 404) son alcanzables —
  ninguna quinta guarda de dominio se escribe para `shops`
- AND el `git diff` de `packages/db/src/domain-errors.ts` y
  `apps/api/rest/src/common/errors/` queda vacío: `shops` es el quinto y
  último agregado del épico en integrarse, y el conjunto cerrado de 5
  códigos sigue siendo exactamente el mismo que dejó `types` en US-27a

### Requirement: Piezas listas para consumo sin reabrir el archivo (CA-7)

El helper de slug y el mapeador de errores MUST exportarse desde
`packages/db` (helper) y desde el módulo de errores de la API (mapeador), y
MUST estar consumidos por al menos un caso real (`types`) en este change.
Sus tests MUST cubrir tildes, nombre que slugifica a vacío y colisión.
Ninguna de las cuatro US siguientes (`tags`/`manufacturers`, `categories`,
`products`, `shops`) MUST necesitar editar la implementación de estas dos
piezas para integrarse — solo añadir su propio call site.

#### Scenario: Un caso real consume ambas piezas sin adaptadores
- GIVEN `createType`/`updateType`/`deleteType` ya implementados
- WHEN se revisa su código
- THEN llaman directamente al helper de slug y al mapeador de errores, sin
  wrappers ni ramas condicionales por agregado

#### Scenario: Agregar un agregado nuevo es un call site, no una edición
- GIVEN una US futura que integra `tags` con estas piezas
- WHEN se compara el `git diff` de `packages/db/src/slug.ts`,
  `packages/db/src/domain-errors.ts` y el mapeador de errores de la API
  antes y después de esa integración
- THEN el diff de esos archivos compartidos está vacío; el cambio vive
  entero en el repositorio/servicio de `tags`

### Requirement: `InvalidReference` observado por primera vez sobre HTTP, piezas compartidas sin cambios (CA-7)

`tags` y `manufacturers` son los primeros agregados de escritura con una FK
saliente real (`type_id → types(id)`); su integración MUST producir el
primer caso real de `InvalidReference` → 400 sobre HTTP. El código y su
traducción ya existían (introducidos en `types`), pero `types` no tiene
ninguna ruta que dispare esta rama — solo estaba probada a nivel de mapper
unitario. La integración de `tags`/`manufacturers` MUST limitarse a invocar
el helper de slug y el mapeador de errores existentes desde el `catch` de
su propio repositorio/servicio (un call site); MUST NOT modificar
`packages/db/src/slug.ts`, `packages/db/src/domain-errors.ts` ni
`apps/api/rest/src/common/errors/`.

#### Scenario: CA-7 — `type_id` inexistente produce el primer 400 real de `InvalidReference` sobre HTTP, y las piezas compartidas quedan intactas
- GIVEN la base sembrada con el catálogo `types`
- WHEN se hace `POST /api/tags` con `type_id 99999`
- THEN la respuesta es 400, nunca 500
- AND `git diff --stat packages/db/src/slug.ts
  packages/db/src/domain-errors.ts apps/api/rest/src/common/errors/` está
  vacío
