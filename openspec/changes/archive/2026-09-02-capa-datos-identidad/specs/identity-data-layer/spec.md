# Identity Data Layer Specification

## Purpose

`schema.prisma` sigue con los 9 modelos del catálogo; `prisma.user` no
existe en el cliente generado aunque US-20 ya sembró `users`/`profiles`/
`permissions`/`permission_user` en Postgres. Esta capability entrega la vía
tipada: modelos por introspección, `UserRecord`/`ProfileRecord`/
`PermissionRecord`, `users.repository.ts` (funciones planas) y sus tests de
integración, con la misma forma que ya sirve `shops`/`products`/`settings`.
El hash de contraseña nunca sale de una única función dedicada (D-2 del
Épico 19). Nadie la consume todavía: hashing, JWT y `apps/api/rest` quedan
fuera (US-22/US-24).

## Requirements

### Requirement: Modelos de identidad por introspección con un gate de drift real

El sistema MUST incorporar a `schema.prisma`, vía `prisma db pull`, los 6
modelos de identidad (`User`, `Profile`, `Permission`, el pivote
`permission_user`, `PasswordResetToken`, `OtpCode`) con renombres manuales
—PascalCase de modelo, camelCase de campo con `@map`, relaciones con
nombre— y la relación `Shop.owner` cerrada. El preview `partialIndexes`
MUST permanecer. El gate de "sin drift" MUST ser `npx prisma migrate diff
--from-config-datasource --to-schema ./prisma/schema.prisma --exit-code`,
NOT `prisma validate` a secas: este último ya pasa en verde hoy con cero
modelos de identidad, así que no puede, por construcción, detectar drift.

#### Scenario: El gate de drift sale en verde tras la introspección

- GIVEN `schema.prisma` con los 6 modelos de identidad y sus renombres aplicados
- WHEN corre `npx prisma migrate diff --from-config-datasource --to-schema ./prisma/schema.prisma --exit-code`
- THEN el comando sale con código 0 ("No difference detected"), donde hoy sale con código 2 listando las 6 tablas y la FK de `shops` faltantes

#### Scenario: partialIndexes sobrevive y el catálogo no sufre drift propio

- GIVEN el `schema.prisma` re-introspeccionado
- WHEN corre `prisma validate` y se revisa el diff completo de los 9 modelos de catálogo preexistentes
- THEN `prisma validate` pasa en verde, el preview `partialIndexes` sigue declarado, y ningún `@map`/nombre de relación de catálogo cambió

### Requirement: Lectura de credenciales aislada e insensible a mayúsculas

El sistema MUST exponer `findUserCredentialsByEmail(email)` como la
**única** función que devuelve `passwordHash`. MUST implementarla con
`$queryRaw` comparando `lower(email) = lower($1)` explícito — la única
forma, de las evaluadas contra Postgres real, que usa
`users_email_lower_idx` (ni `mode: 'insensitive'` de Prisma —`ILIKE`— ni
normalizar en JS antes de un `equals` plano —`email = $1`— lo usan).

#### Scenario: Un email con mayúsculas encuentra al usuario

- GIVEN el usuario sembrado `admin@demo.com`
- WHEN se llama `findUserCredentialsByEmail('ADMIN@Demo.com')`
- THEN devuelve las credenciales de `admin@demo.com`

#### Scenario: Un email inexistente devuelve null

- GIVEN ningún usuario con ese email
- WHEN se llama `findUserCredentialsByEmail('nadie@demo.com')`
- THEN devuelve `null`

#### Scenario: La consulta es elegible para el índice funcional

> Redacción en términos de **elegibilidad**, no de elección del planner. Con
> 3 filas en 1 página (`relpages=1`, `reltuples=3`) el planner prefiere
> `Seq Scan` (coste 1.04) sobre `Index Scan` (coste 8.15), y hace bien. Un
> THEN que exigiera `Index Scan` sin más dependería de cuándo corrió el
> autovacuum: las escrituras de esta misma suite disparan el autoanalyze que
> lo falsifica. `enable_seqscan = off` mide la propiedad que de verdad
> importa — que la forma de la consulta pueda usar el índice — y esa sí es
> estable.

- GIVEN la base con `users_email_lower_idx` creado (US-20)
- WHEN se ejecuta `EXPLAIN` con `enable_seqscan = off` sobre la consulta que emite `findUserCredentialsByEmail`
- THEN el plan reporta `Index Scan using users_email_lower_idx`
- AND con la misma penalización, `email = $1` y `mode: 'insensitive'` (`ILIKE`) siguen en `Seq Scan`, confirmando que solo la forma `lower(email) = lower($1)` es elegible

### Requirement: Lectura del usuario completo con sus relaciones

El sistema MUST exponer una función que, dado un `id`, devuelva el usuario
con su perfil, sus permisos y las tiendas de las que es dueño — el shape
que `/me` (US-22) y el detalle de usuario (US-25) publican. MUST devolver
`null` si el id no existe.

#### Scenario: El usuario 1 trae perfil, permisos y sus tiendas

- GIVEN el usuario 1 (dueño de las 12 tiendas sembradas)
- WHEN se pide el usuario 1 con relaciones
- THEN el resultado incluye su `profile`, su(s) `permissions[]` y las 12 `shops`

### Requirement: Las tres escrituras de identidad de esta US

El sistema MUST exponer exactamente tres escrituras: crear usuario (con
perfil y permisos iniciales), actualizar el hash de contraseña, y
activar/desactivar (`isActive`). `grantPermission` (asignar un permiso a un
usuario existente, p. ej. `make-admin`) MUST NOT formar parte de esta
capability — es de US-25 (D-3), que ya declara que volverá a tocar este
mismo archivo.

#### Scenario: Crear usuario con perfil y permiso inicial

- GIVEN un email no usado
- WHEN se llama `createUser` con `name`, `email`, `passwordHash` y un permiso inicial
- THEN el `UserRecord` devuelto existe en `users`, su `profile` en `profiles`, y su permiso en `permission_user`

#### Scenario: Actualizar el hash de contraseña

- GIVEN un usuario existente
- WHEN se llama `updateUserPasswordHash(id, nuevoHash)`
- THEN `findUserCredentialsByEmail` de ese usuario devuelve `passwordHash === nuevoHash`

#### Scenario: Activar y desactivar un usuario

- GIVEN un usuario con `isActive = true`
- WHEN se llama `setUserActive(id, false)` y luego `setUserActive(id, true)`
- THEN cada llamada devuelve el `UserRecord` con el `isActive` correspondiente

### Requirement: Listado paginado — reinterpretación declarada de CA-5

**Reinterpretación declarada (D-2 del proposal), no una lectura literal de
la US**: CA-5 pide el envoltorio de `buildPaginator`; esta capability
adopta en su lugar el contrato de los 7 repositorios existentes,
documentado en `packages/db/README.md:74` (`buildPaginator` tiene cero
consumidores de producción hoy). El sistema MUST exponer `listUsers(input)`
devolviendo `{ items: UserRecord[], total: number }`; el caller (servicio
de Nest de US-25) MUST armar el envoltorio con `buildPaginator`.
`listUsers` MUST soportar filtro por nombre de permiso (`permissionName`) y
búsqueda por nombre o email.

#### Scenario: Filtrar por permiso

- GIVEN usuarios con distintos permisos sembrados
- WHEN se llama `listUsers({ permissionName: 'store_owner' })`
- THEN `items` solo contiene usuarios con ese permiso asignado

#### Scenario: Buscar por nombre o email

- GIVEN el usuario sembrado `admin@demo.com`
- WHEN se llama `listUsers({ text: 'admin' })`
- THEN `items` incluye ese usuario, sin importar si `text` coincide con `name` o con `email`

### Requirement: Cobertura de integración de las tres reglas de la US

`users.integration.test.ts` MUST cubrir, contra la base sembrada, los tres
casos que la US nombra explícitamente: email inexistente, email con
mayúsculas, y ausencia del hash en el `UserRecord` público. Las dos
primeras las cubren los escenarios de "Lectura de credenciales aislada"; la
tercera la cubre "La frontera del hash es estructural" — ninguna vive solo
en esta sección para no duplicar aserciones ya declaradas arriba.

#### Scenario: El archivo de test existe y corre en `just db-check`

- GIVEN `packages/db/src/repositories/users.integration.test.ts`
- WHEN corre `just db-check`
- THEN el archivo se lista entre los ejecutados y el recuento total de tests sube respecto al baseline (6 archivos / 57 tests)

### Requirement: Ningún tipo de retorno del repositorio expone el hash

Ningún **tipo de retorno** de las funciones públicas de
`users.repository.ts` —incluyendo tipos anidados en relaciones— MUST
exponer un campo de hash de contraseña, salvo el tipo dedicado de
credenciales (`UserCredentials`). `UserCredentials` MUST vivir en
`users.repository.ts`, NOT en `records.ts`, para que la frontera de
serialización del paquete ni siquiera nombre el campo. `CreateUserInput`
MAY declarar `passwordHash`: es un tipo de **entrada**, y la escritura del
hash es precisamente lo que US-22 necesita.

> **Alcance de esta garantía.** Es una propiedad de la API del repositorio,
> no una barrera estructural del paquete: `packages/db/index.ts` re-exporta
> `prisma`/`Prisma`/`PrismaClient` desde antes de esta US, y por esa vía los
> tipos generados de Prisma nombran `passwordHash` (52 apariciones en
> `dist/index.d.ts`). Cerrar ese escape hatch exige decidir qué de esos
> exports consume `apps/api/rest`, y eso es asunto de US-22/US-23, no de
> esta capability.

#### Scenario: Ningún tipo de retorno distinto de UserCredentials nombra el hash

- GIVEN los tipos de retorno de las 7 funciones públicas de `users.repository.ts`
- WHEN se inspeccionan sus definiciones en `dist/index.d.ts` (incluida cualquier relación anidada)
- THEN solo `UserCredentials` declara un campo de hash de contraseña, y `UserRecord` no lo lleva

### Requirement: Los tests de escritura no corrompen el estado sembrado compartido

Los tests de integración de escritura MUST dejar la base en el mismo
estado (conteos) en que la encontraron. Tras correr la suite completa, los
conteos que otros tests assertan (`users` 3, `shops` 12, `products` 1200,
`categories` 198) MUST permanecer sin cambios.

#### Scenario: Los conteos no cambian tras la suite completa

- GIVEN `just db-check` corrido de punta a punta, incluyendo los tests nuevos de escritura
- WHEN se cuentan filas de `users`, `shops`, `products` y `categories` al terminar
- THEN los cuatro conteos son idénticos a los de antes de correr la suite (3/12/1200/198)

### Requirement: Los ids de identidad cruzan la frontera como number

Los ids `bigserial` de las tablas de identidad (`users.id`,
`permissions.id`) MUST cruzar la frontera pública del paquete como `number`
de JavaScript, con la misma conversión que ya usan los ids del catálogo —
NUNCA como `string` ni como `bigint` crudo.

#### Scenario: El id de un UserRecord es un number serializable

- GIVEN un `UserRecord` devuelto por cualquier lector
- WHEN se inspecciona `typeof userRecord.id`
- THEN el valor es `"number"`, y `JSON.stringify(userRecord)` no lanza

### Requirement: Sin dependencia nueva de hashing

`packages/db` MUST NOT declarar `bcryptjs` (ni ninguna librería de hashing)
como dependencia. Hashear y verificar contraseñas es responsabilidad de
US-22, fuera de esta capability.

#### Scenario: package.json no declara bcrypt

- GIVEN `packages/db/package.json` tras esta US
- WHEN se inspeccionan `dependencies` y `devDependencies`
- THEN ninguna clave coincide con `bcrypt` ni `bcryptjs`

## Out of Scope

JWT, hashing y verificación de contraseñas · `bcryptjs` (US-22) ·
repositorios de `password_reset_tokens`/`otp_codes` (US-24 — sus
**modelos** Prisma sí entran en esta US para que el gate de drift cierre en
verde; sus repositorios no) · `grantPermission`/asignar `staff` a un
usuario (US-25) · cualquier archivo bajo `apps/api/rest` ·
`db/schema.sql`/`db/seed.sql` (cerrados por US-20 — esta US no ejecuta DDL)
· frontends · armar el envoltorio de `buildPaginator` (D-2: es trabajo del
caller, no de esta capability).
