# Delta for Data Layer Clock Policy

## MODIFIED Requirements

### Requirement: `become_seller` vincula su primera ruta de update a esta política

`become_seller` nace con columna `updated_at`, a diferencia de
`shop_staff`. `updateBecomeSeller()`
(`packages/db/src/repositories/become-seller.repository.ts`, nuevo, US-44)
MUST fijar `updatedAt: now()` desde `packages/db/src/clock.ts` en su
función de escritura, igual que `products`, `categories`, `shops`, `users`
y la vinculación ya declarada para `profiles`. `updateBecomeSeller` MUST
usar `update({ where: { id: 1 }, ... })`, nunca `create`/`upsert` — la fila
fija la garantiza la CHECK `become_seller_fila_unica` (US-41 CA-3).
`become_seller` MUST NOT tener trigger `BEFORE UPDATE` de Postgres
gobernando `updated_at`.
(Previously: la vinculación era condicional a una función de escritura que
todavía no existía — "la PRIMERA que se cree" — y esta requirement solo
prometía el comportamiento futuro. US-44 crea esa función; esta requirement
documenta el hecho ya verificable, no la promesa.)

#### Scenario: `become_seller` recién sembrado, sin ningún `POST` real todavía, conserva `updated_at = created_at`

- GIVEN la fila de `become_seller` recién sembrada o repuesta por
  `just db-up`, sin ninguna llamada real a `updateBecomeSeller` todavía
- WHEN se consulta la fila
- THEN `updated_at` es igual a `created_at`

#### Scenario: `updateBecomeSeller` avanza el reloj (ya no hipotético)

- GIVEN la fila de `become_seller`
- WHEN `updateBecomeSeller(input)` corre
- THEN `updated_at` queda estrictamente después de su valor previo, fijado
  por `now()` de `clock.ts`, no por el reloj de Postgres

#### Scenario: `become_seller` no tiene trigger `BEFORE UPDATE`

- GIVEN el esquema aplicado por `just db-migrate` con `become_seller` creada
- WHEN se inspeccionan sus triggers
- THEN ninguno es `BEFORE UPDATE` sobre `updated_at`

## ADDED Requirements

### Requirement: Los tests de integración de `become_seller` restauran el reloj en el `afterAll` existente, con el tripwire de reposo al final

`db/seed.sql:33-35` hace `INSERT INTO become_seller (id, page_options,
commissions, language) ... ON CONFLICT (id) DO UPDATE SET page_options =
EXCLUDED.page_options, commissions = EXCLUDED.commissions, language =
EXCLUDED.language` — sin incluir `updated_at` (ni `created_at`) en su
`SET`. Por lo tanto `just db-up` MUST NOT considerarse suficiente para
reponer `updated_at` después de que un test llame a `updateBecomeSeller`.

Todo `describe` de escritura que ejerza `updateBecomeSeller`
(`packages/db/src/repositories/become-seller.integration.test.ts`) MUST
restaurar explícitamente `pageOptions`, `commissions` y `updatedAt` (al
valor previo de la fila) dentro del `afterAll` YA EXISTENTE (`:17-19`), en
un bloque `try/finally`. Esta requirement MUST NOT crear un segundo hook
`afterAll`: con el comportamiento por defecto de `sequence.hooks` de
vitest (`stack`), un `afterAll` agregado después correría sobre un cliente
Prisma ya desconectado por el `afterAll` existente
(`prisma.$disconnect()`, `:17-19`).

Los `describe` de escritura nuevos MUST declararse ANTES del `describe`
"reloj sin ruta de update: `updatedAt === createdAt`" (`:57-62`), siguiendo
la convención ya documentada en `shops.integration.test.ts:472-476` ("VA
EL ÚLTIMO A PROPÓSITO ... al añadir un describe de escritura nuevo, va
ANTES de este"): vitest ejecuta los `describe` de un archivo en orden de
declaración, así que solo desde el final el tripwire cubre toda la
batería.

El `describe` de `:57-62` MUST conservarse SIN cambiar su aserción
`updatedAt === createdAt` — no se reescribe la aserción. Se reencuadra
como **tripwire de estado de reposo**: si los `describe` de escritura
restauran `updatedAt` correctamente en su `try/finally`, la fila vuelve a
`updatedAt === createdAt` para cuando este `describe` corre (al final), y
cualquier corrida abortada que dejara deriva sin restaurar lo haría
fallar.

#### Scenario: Restaurar la fila dentro del `afterAll` existente, no en un hook nuevo

- GIVEN un `describe` de escritura que llama `updateBecomeSeller` y muta
  `pageOptions`/`commissions`/`updatedAt`
- WHEN el archivo de test termina
- THEN la restauración ocurre en un `try/finally` dentro del `afterAll` ya
  existente (`:17-19`), no en un segundo hook `afterAll`

#### Scenario: El `describe` de escritura se declara antes del tripwire de reposo

- GIVEN el archivo `become-seller.integration.test.ts` con un `describe`
  de escritura nuevo
- WHEN se ordenan los `describe` del archivo
- THEN el `describe` de escritura queda declarado antes del `describe`
  "reloj sin ruta de update: `updatedAt === createdAt`" (`:57-62`)

#### Scenario: El tripwire de reposo sigue en verde tras una restauración correcta

- GIVEN que un `describe` de escritura restauró `updatedAt` en su
  `try/finally`
- WHEN corre el `describe` de `:57-62`
- THEN `updatedAt === createdAt` sigue siendo cierto, confirmando que no
  quedó deriva sin restaurar

#### Scenario: `just db-up` no repara `updated_at` por sí solo

- GIVEN que el seed usa `ON CONFLICT DO UPDATE` sin incluir `updated_at` en
  su `SET`
- WHEN se corre `just db-up` tras una fila mutada por un test previo que no
  restauró el reloj
- THEN `updated_at` permanece con el valor mutado, no el original del seed
