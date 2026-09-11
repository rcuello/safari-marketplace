# Delta for Catalog Write Foundations

## MODIFIED Requirements

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
