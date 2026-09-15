# Extended Identity Data Layer Specification

## Purpose

Esta capability entrega la capa tipada de las dos tablas nuevas del esquema
de identidad extendida (US-41): `ShopStaff` y `BecomeSeller`, introspectadas
a `schema.prisma` con renombres manuales, sus tipos `*Record` y mappers, y
sus tests de integración contra el catálogo real. Ningún repositorio de
funciones planas se crea aquí: la capa de datos es solo tipificación y
conversión de boundaries (bigint→number, Prisma.JsonValue→value, etc.).
Los repositorios llegan con US-42 (`shop_staff`) y US-44 (`become_seller`).

## Requirements

### Requirement: Modelos introspectados con los renombres manuales del par nuevo

`packages/db/prisma/schema.prisma` MUST incorporar, vía `prisma db pull`,
los dos modelos nuevos con sus renombres manuales: `ShopStaff` mapeado a
`@@map("shop_staff")` (siguiendo la forma de `PermissionUser`) y
`BecomeSeller` mapeado a `@@map("become_seller")` (siguiendo la forma de
`Setting`). Cada campo no trivial MUST llevar su `@map("columna_snake")`
correspondiente. La re-introspección MUST clasificarse como cosmética
(renombres reaplicados, cabecera reescrita, `previewFeatures`, `datasource`
sin `url`, y estos dos modelos nuevos) o semántica (cualquier cambio de tipo
de campo, `@@map`/`@map` perdido, `@unique` nuevo en `User.email`, o
cualquier modelo distinto de estos dos apareciendo o desapareciendo) en los
15 modelos preexistentes. Dos modelos nuevos MUST considerarse el resultado
esperado, NOT una sorpresa semántica que detenga el trabajo. (CA-4)

#### Scenario: Los dos modelos nuevos existen con sus renombres

- GIVEN `schema.prisma` re-introspeccionado tras el DDL de esta capability
- WHEN se inspeccionan los bloques `model ShopStaff` y `model BecomeSeller`
- THEN cada uno declara `@@map` a su tabla snake_case y cada campo no
  trivial declara su `@map` correspondiente

#### Scenario: El diff de los 15 modelos preexistentes se clasifica antes de continuar

- GIVEN el `git diff` completo de `packages/db/prisma/schema.prisma`
- WHEN se separan sus cambios en cosmético vs. semántico
- THEN los únicos cambios semánticos aceptados son la aparición de
  `ShopStaff` y `BecomeSeller`; cualquier otro cambio semántico se reporta y
  no se aplica sin más revisión

### Requirement: `*Record` y mappers para ambas tablas

`packages/db/src/records.ts` MUST exponer `ShopStaffRecord` y
`BecomeSellerRecord`, junto con sus mappers `_toShopStaffRecord` y
`_toBecomeSellerRecord`, honrando la frontera de serialización del paquete:
todo id `bigint` MUST cruzar como `number` vía `_id()`, todo `Prisma.Decimal`
MUST cruzar como `number` vía `_dec()` (si aplica), y las columnas de fecha
MUST quedar como `Date`, sin serializar a ISO dentro del paquete.
`ShopStaffRecord` MUST exponer `userId`, `shopId` y `createdAt` (sin
`updatedAt`, reflejando que la tabla no la tiene). `BecomeSellerRecord`
MUST exponer `pageOptions`/`commissions` como `Prisma.JsonValue`, más
`language`, `createdAt` y `updatedAt`. (CA-4)

#### Scenario: ShopStaffRecord no declara updatedAt

- GIVEN el tipo `ShopStaffRecord` exportado por `records.ts`
- WHEN se inspeccionan sus campos
- THEN incluye `userId`, `shopId`, `createdAt` y ningún campo `updatedAt`

#### Scenario: Los ids del pivote cruzan como number

- GIVEN una fila `ShopStaff` devuelta por Prisma con `userId`/`shopId` como `BigInt`
- WHEN `_toShopStaffRecord` la convierte
- THEN el `ShopStaffRecord` resultante tiene `typeof userId === "number"` y
  `typeof shopId === "number"`, y `JSON.stringify(...)` no lanza

#### Scenario: BecomeSellerRecord conserva ambas colecciones jsonb sin fusionarlas

- GIVEN la única fila de `become_seller` sembrada
- WHEN `_toBecomeSellerRecord` la convierte
- THEN el `BecomeSellerRecord` resultante expone `pageOptions` y
  `commissions` como valores independientes, ninguno anidado dentro del otro

### Requirement: Exportación por el barrel del paquete

`packages/db/index.ts` MUST re-exportar los tipos `ShopStaffRecord` y
`BecomeSellerRecord` junto al resto de tipos `*Record` del barrel. Esta
capability MUST NOT exportar funciones de repositorio para ninguna de las
dos tablas — ese trabajo pertenece a US-42 (staff) y US-44 (become-seller).
(CA-4)

#### Scenario: Los dos tipos son importables desde el barrel

- GIVEN `packages/db/index.ts` tras esta capability
- WHEN otro paquete importa `{ ShopStaffRecord, BecomeSellerRecord }` desde `@safari/db`
- THEN ambos tipos resuelven sin pasar por rutas internas del paquete

#### Scenario: El barrel no exporta funciones de repositorio nuevas

- GIVEN `packages/db/index.ts` tras esta capability
- WHEN se busca cualquier función exportada de un `shop-staff.repository.ts` o `become-seller.repository.ts`
- THEN no existe ninguna: esos archivos no se crean en esta capability

### Requirement: `just db-check` permanece verde con el par nuevo introspectado

Tras aplicar esta capability, `just db-check` MUST seguir en verde y el
conteo de archivos/tests MUST no bajar respecto a la línea base medida (10
archivos / 210 tests). Los tests de esquema de `shop_staff` y
`become_seller` (PK, FK, CASCADE, CHECK, conteos del seed) MUST vivir en
`packages/db/src/repositories/*.integration.test.ts`, consultando Prisma
directo (mismo patrón que los tests de `permission_user` en
`users.integration.test.ts`), NOT a través de un repositorio de funciones
planas que esta capability no crea. (CA-4, CA-5)

#### Scenario: just db-check sube de línea base con las dos suites nuevas

- GIVEN la línea base de 10 archivos / 210 tests
- WHEN se agregan las suites de esquema de `shop_staff` y `become_seller` y corre `just db-check`
- THEN el comando sale en verde y el conteo de tests es mayor o igual a 210 + los nuevos

## Out of Scope

Repositorios de funciones planas de `shop_staff`/`become_seller` y sus
tests de caso de uso (US-42, US-44) · cualquier servicio, controlador, DTO
o guard de Nest · esta capability cubre únicamente tipos, mappers y barrel.
