# Extended Identity Schema Specification

## Purpose

Esta capability extiende el esquema de identidad de US-20 con dos tablas nuevas:
`shop_staff` (pivote sin rol entre tienda y usuario) y `become_seller` (singleton
de configuración con dos columnas `jsonb`). Ambas se integran en el reloj común de
la capa de datos (US-32) sin triggers de Postgres. La tabla `shop_staff` permite
asignar usuarios como staff de tiendas específicas, respetando la topología de
dueño único por tienda. La tabla `become_seller` centraliza la configuración
pública de "vender con nosotros": opciones de página y estructura de comisiones.

## Requirements

### Requirement: Pivote `shop_staff` bare, sin columna de rol

El sistema MUST definir `shop_staff` con PK compuesta `(user_id, shop_id)`,
ambas columnas `bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE` /
`REFERENCES shops(id) ON DELETE CASCADE`, y `created_at timestamptz NOT NULL
DEFAULT now()`. La tabla MUST NOT tener columna `updated_at`: es un pivote
puro que se crea o se borra, nunca se actualiza (mismo patrón que
`permission_user`, `category_product`, `product_tag`), por lo que queda
fuera de la superficie de `data-layer-clock-policy`. El sistema MUST crear
`shop_staff_tienda_idx ON shop_staff (shop_id)`, espejo de
`permission_user_permiso_idx` (`db/schema.sql:530`), para el filtro real de
`GetStaffsDto`.

La tabla MUST NOT tener columna de rol. Es una decisión deliberada, no una
omisión: ningún consumidor real la pide — `GetStaffsDto` solo declara
`page/limit/orderBy/sortedBy/shop_id`, `StaffsController.getStaffs`
devuelve `UserPaginator` (usuarios, no filas de pivote), `AddStaffInput` del
admin es `{email, password, name, shop_id}` sin rol, `StaffList` solo pinta
`name/email/is_active`, y `users` no tiene columna `shop_id` propia. Añadir
`role` sería especulativo. Una columna de rol futura MUST tratarse como un
requirement nuevo, NOT como corrección de esta capability. (CA-1; diverge
deliberadamente del título "con rol" de CA-1 — el código gana sobre la
prosa, ver `exploration.md` sección 2)

#### Scenario: Un usuario es staff de dos tiendas

- GIVEN un usuario y dos tiendas sembradas
- WHEN se le asigna staff en ambas
- THEN las dos filas de `shop_staff` coexisten y ningún unique lo impide

#### Scenario: La tabla no expone ninguna columna de rol

- GIVEN `shop_staff` recién creada
- WHEN se inspecciona su catálogo (`\d shop_staff`)
- THEN sus únicas columnas son `user_id`, `shop_id`, `created_at`

### Requirement: Idempotencia de la asignación staff↔tienda

Asignar el mismo par `(user_id, shop_id)` dos veces MUST NOT crear una fila
duplicada ni lanzar un error. La PK compuesta MUST ser la garantía
estructural; el patrón de escritura recomendado es el mismo `upsert({
update: {} })` que usa `grantPermission` sobre `permission_user`.

#### Scenario: Asignar el mismo par dos veces no duplica

- GIVEN un usuario ya asignado como staff de una tienda
- WHEN se repite la misma asignación `(user_id, shop_id)`
- THEN `shop_staff` sigue teniendo una única fila para ese par y la segunda
  operación no falla

### Requirement: Cascadas del pivote staff↔tienda

Borrar una tienda MUST eliminar sus filas de `shop_staff` y MUST NOT
eliminar a los usuarios asignados. Borrar un usuario MUST eliminar sus
filas de `shop_staff` y MUST NOT eliminar las tiendas donde era staff.
(CA-1)

#### Scenario: Borrar la tienda arrastra sus filas de staff

- GIVEN una tienda con staff asignado
- WHEN se borra la tienda
- THEN sus filas del pivote desaparecen y el usuario sigue existiendo

#### Scenario: Borrar el usuario arrastra sus filas de staff sin tocar la tienda

- GIVEN un usuario asignado como staff de una tienda
- WHEN se borra el usuario
- THEN sus filas del pivote desaparecen y la tienda sigue existiendo

### Requirement: Singleton `become_seller` con dos columnas jsonb

El sistema MUST definir `become_seller` con `id smallint PRIMARY KEY DEFAULT
1` y una CHECK nombrada `become_seller_fila_unica CHECK (id = 1)`, calco de
`settings_fila_unica`. La tabla MUST tener **dos** columnas `jsonb`,
`page_options` y `commissions`, una por cada clave de nivel superior de
`apps/api/rest/src/db/pickbazar/become-seller.json`. Una sola columna MUST
NOT usarse: perdería `commissions` en silencio y US-44 no podría satisfacer
su contrato byte a byte sin un segundo `just db-reset`, prohibido por la
decisión 2 del épico. `page_options` MUST almacenar el contenido interno
(`data.page_options.page_options`, no el objeto envoltorio con forma de
`settings`); el envoltorio `{id, page_options, language, created_at,
updated_at}` se recompone en tiempo de servicio (US-44), fuera de esta
capability. (CA-2)

#### Scenario: El singleton admite una sola fila

- GIVEN la tabla de `become_seller` sembrada
- WHEN se intenta insertar una segunda fila
- THEN la CHECK de fila única lo rechaza

#### Scenario: Las dos columnas conservan ambas claves del JSON de origen

- GIVEN el seed aplicado desde `become-seller.json`
- WHEN se consulta la única fila de `become_seller`
- THEN `page_options` contiene el objeto anidado del mock y `commissions`
  contiene el array completo de 2 tiers, sin pérdida de ninguna clave

### Requirement: Sin trigger de `updated_at` en las tablas nuevas

Ninguna de las dos tablas nuevas MUST tener un trigger `BEFORE UPDATE` de
Postgres. El comentario de política de `db/schema.sql:540-550` MUST
permanecer sin modificar y MUST NOT ganar entradas nuevas para estas tablas.
(CA-3)

#### Scenario: Ninguna de las dos tablas tiene trigger

- GIVEN el esquema aplicado por `just db-migrate`
- WHEN se inspeccionan los triggers de `shop_staff` y `become_seller`
- THEN ninguna tiene un trigger `BEFORE UPDATE`

### Requirement: Seed determinista de staff sin regresión de conteos vivos

El seed de `shop_staff` MUST insertar exactamente 3 filas —
`(user_id=2, shop_id=1)`, `(user_id=2, shop_id=2)`, `(user_id=3, shop_id=1)`
— y MUST NOT asignar al usuario 1, dueño de las 12 tiendas sembradas. La
cifra fija MUST permitir que los count-asserts posteriores (US-42) sean
predecibles. Tras `just db-reset`, los conteos vivos existentes MUST
permanecer intactos: 198 categorías / 83 raíces, 12 tiendas, 3 usuarios,
1200 productos. (CA-5)

#### Scenario: El seed inserta exactamente 3 filas de staff

- GIVEN `db/seed.sql` aplicado de punta a punta
- WHEN se cuentan las filas de `shop_staff`
- THEN el resultado es 3 y ninguna referencia al `user_id` 1

#### Scenario: Los conteos vivos no cambian

- GIVEN `just db-reset` corrido con el DDL de esta capability
- WHEN se cuentan filas de `categories`, `shops`, `users` y `products`
- THEN los resultados son 198 (83 raíces), 12, 3 y 1200 respectivamente

## Out of Scope

Repositorios de funciones planas de `shop_staff` (US-42) · cualquier servicio,
controlador, DTO o guard de Nest · frontends · esta capability cubre
únicamente DDL y seed.
