# Delta for data-layer-clock-policy

## ADDED Requirements

### Requirement: `become_seller` vincula su primera ruta de update a esta política

`become_seller` nace con columna `updated_at`, a diferencia de `shop_staff`.
Esta política MUST vincular la PRIMERA función de repositorio que en el
futuro actualice `become_seller` (llega con US-44) a fijar `updatedAt:
now()` desde `packages/db/src/clock.ts`, igual que `products`, `categories`,
`shops`, `users` y la vinculación ya declarada para `profiles`.
`become_seller` MUST NOT tener trigger `BEFORE UPDATE` de Postgres
gobernando `updated_at` (CA-3 de US-41). Esta requirement MUST NOT crear
ninguna función de escritura nueva sobre `become_seller` — esa función no
existe hoy (US-41 solo entrega DDL, seed y capa tipada) y crearla sería
expandir el alcance de esta capability.

#### Scenario: `become_seller` sin ruta de update conserva `updated_at = created_at`

- GIVEN la única fila de `become_seller` recién sembrada, sin ninguna
  función de repositorio que la actualice todavía
- WHEN se consulta la fila
- THEN `updated_at` es igual a `created_at`, lo cual satisface el invariante
  por ausencia de update, no por diseño de una función nueva

#### Scenario: La primera función de update que se cree hereda la política

- GIVEN que en el futuro (US-44) se cree la primera función de repositorio
  que actualice `become_seller`
- WHEN esa función emite su `update` de Prisma
- THEN MUST fijar `updatedAt: now()` desde `clock.ts`, igual que `products`,
  `categories`, `shops`, `users` y `profiles`

#### Scenario: `become_seller` no tiene trigger `BEFORE UPDATE`

- GIVEN el esquema aplicado por `just db-migrate` con `become_seller` creada
- WHEN se inspeccionan sus triggers
- THEN ninguno es `BEFORE UPDATE` sobre `updated_at`

### Requirement: `shop_staff` queda fuera de esta política por construcción

`shop_staff` MUST NOT entrar en el inventario exhaustivo de rutas de
`UPDATE` de esta política: la tabla no tiene columna `updated_at` (solo
`created_at`), por lo que no existe reloj que gobernar. La obligación de
inventario exhaustivo de esta política MUST NOT extenderse a `shop_staff`
mientras la tabla permanezca sin esa columna; añadirle `updated_at` en el
futuro sería un cambio de esquema nuevo que sí activaría esta política, no
una corrección retroactiva de esta requirement.

#### Scenario: `shop_staff` no aparece en el inventario de rutas de update

- GIVEN el inventario exhaustivo de rutas de `UPDATE`/`upsert` que esta
  política exige revisar
- WHEN se lista qué tablas gobierna
- THEN `shop_staff` no aparece, porque no tiene columna `updated_at`
