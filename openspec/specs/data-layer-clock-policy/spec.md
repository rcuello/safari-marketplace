# Data Layer Clock Policy Specification

## Purpose

Política de reloj para timestamps en `packages/db`: una sola fuente de
verdad por fila para `created_at`/`updated_at` en `products`, `categories`,
`shops`, `users` y `profiles`, y la regla vinculante que hereda cualquier
tabla de entidad futura (US-34).

## Requirements

### Requirement: Reloj único por fila, sin trigger de base de datos

En `products`, `categories`, `shops`, `users` y `profiles`, `created_at` y
`updated_at` MUST originarse del mismo reloj: el reloj de aplicación de Node
expuesto por `packages/db/src/clock.ts` (`now()`), ya sea vía
`@default(now())` de Prisma en el `INSERT` o vía `updatedAt: now()` explícito
en el `UPDATE`. Ninguna de estas cinco tablas SHALL tener un trigger
`BEFORE UPDATE` de Postgres gobernando `updated_at`. (US-32 CA-1)

#### Scenario: Una fila creada y actualizada usa un solo reloj

- GIVEN una categoría recién creada en `categories`
- WHEN se actualiza su `name` vía `updateCategory`
- THEN tanto `created_at` como `updated_at` provienen del reloj de Node,
  nunca del reloj del servidor de Postgres

#### Scenario: No hay trigger `BEFORE UPDATE` sobre estas cinco tablas

- GIVEN el esquema aplicado por `just db-migrate`
- WHEN se inspeccionan los triggers de `products`, `categories`, `shops`,
  `users` y `profiles`
- THEN ninguno tiene un trigger `BEFORE UPDATE` que escriba `updated_at`

### Requirement: Invariante `updated_at >= created_at`

Para cualquier fila creada y luego actualizada en `products`, `categories`,
`shops` o `users`, `updated_at` MUST ser mayor o igual que `created_at`.
(US-32 CA-2)

#### Scenario: El invariante se cumple tras un update

- GIVEN una categoría recién creada
- WHEN se actualiza su nombre
- THEN `updated_at` es mayor o igual que `created_at`

### Requirement: Inventario exhaustivo de rutas de `UPDATE`

Cada función de repositorio en `packages/db` que emita un `update` de Prisma,
o la rama de actualización de un `upsert`, contra `products`, `categories`,
`shops` o `users` MUST fijar `updatedAt: now()` explícitamente desde
`clock.ts`. Los siete call sites conocidos son: la rama `update` del upsert
del scraper y `updateProduct` en `products.repository.ts:381,818`;
`updateCategory` en `categories.repository.ts:535`; `updateShop` y
`setShopActive` en `shops.repository.ts:314,346`; y
`updateUserPasswordHash` y `setUserActive` en
`users.repository.ts:329,346`.

El test del invariante NO SHALL tratarse como sustituto de esta revisión: una
fila cuyo `updated_at` nunca avanza (ruta olvidada) sigue satisfaciendo
`updated_at >= created_at` por igualdad, así que el inventario MUST
verificarse por revisión exhaustiva de código (p. ej. `grep` sobre
`.update(`/`.upsert(` en los cuatro repositorios), no únicamente por el test
pasando en verde.

#### Scenario: Los siete call sites fijan el reloj explícitamente

- GIVEN los cuatro repositorios (`products`, `categories`, `shops`, `users`)
- WHEN se revisan sus siete rutas de `update`/`upsert` conocidas
- THEN cada una fija `updatedAt: now()` desde `clock.ts`

#### Scenario: Una ruta olvidada no la detecta el test del invariante

- GIVEN una fila cuyo `update` no fija `updatedAt` (hipotético, ruta
  olvidada)
- WHEN se compara `updated_at` contra `created_at`
- THEN la igualdad sigue satisfaciendo `>=`, por lo que el test pasa en
  verde aunque la ruta esté rota — la garantía real depende del inventario,
  no del test

### Requirement: Excepción de actualización vacía en `findOrCreateShopBySlug`

`findOrCreateShopBySlug` (`packages/db/src/repositories/shops.repository.ts:192`,
rama `update: {}`) MUST NOT avanzar `updated_at` cuando la tienda ya existe.
El comentario existente en esa función ("no se pisa nada si ya existe") ya
prometía este comportamiento, y verificado empíricamente con `log:['query']`
(apply-progress.md, hallazgo D-4) la promesa YA era cierta antes de este
change: Prisma no emite ningún `UPDATE` para un `update: {}` cuando la fila
existe (solo relee con `SELECT`s), así que el trigger nunca llegaba a
dispararse en esta ruta. El `update: {}` se conserva vacío para no aplicar
mecánicamente la regla "todo `update` fija `updatedAt`" a una llamada que de
hecho no actualiza nada.

#### Scenario: Correr el scraper dos veces no toca `updated_at`

- GIVEN una tienda ya existente en `shops`
- WHEN el scraper llama `findOrCreateShopBySlug` sobre esa misma tienda por
  segunda vez sin cambios
- THEN `updated_at` permanece idéntico al valor previo a la segunda llamada

### Requirement: `profiles` vincula su primera ruta de update futura a esta política

`profiles` no tiene hoy ninguna función de repositorio que actualice sus
filas (solo el `create` anidado en `users.repository.ts:292-294`). Esta
política MUST vincular la PRIMERA función de repositorio que en el futuro
actualice `profiles` a fijar `updatedAt: now()` desde `clock.ts`, igual que
las otras cuatro tablas. Esta requirement MUST NOT crear ninguna función
`updateProfile` nueva — no existe hoy y crearla sería expandir el alcance de
este change.

#### Scenario: `profiles` sin update conserva `updated_at = created_at`

- GIVEN un perfil recién creado sin ninguna ruta de actualización disponible
- WHEN se consulta la fila en `profiles`
- THEN `updated_at` es igual a `created_at`, lo cual satisface el invariante
  por ausencia de update, no por diseño de una función nueva

#### Scenario: La primera función de update que se cree hereda la política

- GIVEN que en el futuro se cree la primera función de repositorio que
  actualice `profiles`
- WHEN esa función emite su `update` de Prisma
- THEN MUST fijar `updatedAt: now()` desde `clock.ts`, igual que `products`,
  `categories`, `shops` y `users`

### Requirement: Alcance documentado de `_setNowProvider`

El alcance real del reloj inyectable de test (`_setNowProvider` en
`clock.ts`) MUST documentarse en la cabecera de `clock.ts` o en
`packages/db/README.md`. Tras este change, `_setNowProvider` MUST gobernar
`updated_at` de `products`, `categories`, `shops` y `users` (se vuelve
mockeable porque ahora fluye por `clock.ts`, igual que ya ocurre en `types`,
`tags` y `manufacturers`). `_setNowProvider` MUST NOT gobernar `created_at`
de ninguna tabla del repositorio: esa columna permanece en el
`@default(now())` declarativo de Prisma, sin que ningún repositorio la fije
explícitamente — este es el status quo ya vigente en `types`/`tags`/
`manufacturers` y es un no-goal declarado, no un descuido. (US-32 CA-3)

#### Scenario: `_setNowProvider` mockea `updated_at` de las cinco tablas

- GIVEN un test de integración que llama `_setNowProvider(fecha_fija)`
- WHEN se actualiza una fila de `categories`
- THEN `updated_at` refleja la fecha fijada por el test

#### Scenario: `_setNowProvider` no afecta `created_at`

- GIVEN un test de integración que llama `_setNowProvider(fecha_fija)`
- WHEN se crea una fila nueva en `categories`
- THEN `created_at` proviene del reloj real de `@default(now())` de Prisma,
  no de la fecha fijada por el test

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
