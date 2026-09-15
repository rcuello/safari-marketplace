# Verification Report: `deriva-reloj-timestamps` (US-32)

**Change**: `deriva-reloj-timestamps`
**US**: US-32 — Un solo reloj para `created_at` y `updated_at`
**Fecha de verificación**: 2026-09-15
**Rama**: `main` (working tree sin commitear)
**Modo**: Standard (`strict_tdd: false`); artefactos en `openspec/` (Engram no conectado)
**Artefactos disponibles**: proposal + specs (2 dominios) + design + tasks + apply-progress → **verificación completa** (completitud + corrección + coherencia)
**Veredicto**: **PASS WITH WARNINGS**

> Esta verificación es independiente: el código y la base viva son la fuente de
> verdad, no `apply-progress.md`. Toda evidencia marcada **REPRODUCIDA** se
> ejecutó en esta sesión; la marcada **HEREDADA** proviene de la fase de apply y
> NO se volvió a correr (se indica el motivo en cada caso).

---

## 1. Completitud de tareas

| Métrica | Valor |
|---|---|
| Tareas marcadas `[x]` | 47 |
| Tareas sin marcar `[ ]` | **0** |
| Tareas revertidas a `[ ]` por esta verificación | **0** |

No se encontró ninguna tarea reclamada como hecha que no lo estuviera. Se
auditaron por muestreo contra el código los anclajes normativos de mayor riesgo
declarados en `design.md`/`tasks.md`, y los dos "trampas" documentadas están
correctamente resueltas:

- Tarea 3.13 — `updatedAt: now()` de `updateProduct` insertado **después** del
  cierre del spread de `tagIds` (`products.repository.ts:858`), fuera del objeto
  anidado `tags:`. `tsc --noEmit` limpio lo confirma.
- Tarea 4.9 — el `describe` de `findOrCreateShopBySlug` está ubicado **después**
  del bloque de monotonía y **antes** del tripwire de
  `shops.integration.test.ts`, tal como exige la colocación normativa.

---

## 2. Veredicto requisito por requisito

Siete requisitos: 6 `ADDED` en `data-layer-clock-policy` + 1 `MODIFIED` en
`category-tree-api`.

| # | Requisito | Spec | CA | Veredicto |
|---|---|---|---|---|
| R1 | Reloj único por fila, sin trigger de base de datos | `data-layer-clock-policy` | CA-1 | **PASS** |
| R2 | Invariante `updated_at >= created_at` | `data-layer-clock-policy` | CA-2 | **PASS** |
| R3 | Inventario exhaustivo de rutas de `UPDATE` | `data-layer-clock-policy` | CA-2 | **PASS** (con W-1) |
| R4 | Excepción de actualización vacía en `findOrCreateShopBySlug` | `data-layer-clock-policy` | CA-1 | **PASS** |
| R5 | `profiles` vincula su primera ruta de update futura | `data-layer-clock-policy` | CA-1 | **PASS** |
| R6 | Alcance documentado de `_setNowProvider` | `data-layer-clock-policy` | CA-3 | **PASS** |
| R7 | Edición y reenraizado sin ciclos, slug inmutable | `category-tree-api` (MODIFIED) | CA-2 | **PASS** |

### R1 — Reloj único por fila, sin trigger de base de datos (CA-1) — PASS

Dos escenarios, ambos con evidencia de runtime.

*Escenario «Una fila creada y actualizada usa un solo reloj»* — **cubierto y
verde**:

- `packages/db/prisma/schema.prisma` conserva `@default(now())` en `createdAt` y
  `updatedAt` de los 15 modelos (23 pares inspeccionados, líneas 45-315). No hay
  `dbgenerated`, no hay `@updatedAt`. Prisma liga ambos valores como parámetros
  del `INSERT` desde el reloj de Node. **REPRODUCIDO** (`grep` sobre el archivo,
  `git status --porcelain packages/db/prisma/schema.prisma` vacío).
- Las 4 pruebas de integración nuevas (`categories`, `products`, `shops`,
  `users`) fijan `_setNowProvider(future)` y aseveran
  `updated.updatedAt.getTime() === future.getTime()`. Esa igualdad EXACTA solo
  es posible si el valor sale de `clock.ts` en Node: un reloj de Postgres nunca
  devolvería el sentinel `Date.now() + 60_000`. **REPRODUCIDO** (209/209 verde).
- Evidencia directa del reloj único en una fila creada esta sesión: `users`
  id 50 y su `profiles` anidado comparten `created_at` **al milisegundo**
  (`2026-09-15 13:25:54.366+00` en ambas filas y en ambas columnas del perfil),
  lo que solo ocurre si un único valor de Node se ligó a todo el `INSERT`
  anidado.

*Escenario «No hay trigger `BEFORE UPDATE` sobre estas cinco tablas»* —
**cubierto y verde**:

```
$ docker exec safari-postgres psql -U safari -d safari_scraper \
    -c "SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE NOT tgisinternal;"
 tgname | tgrelid
--------+---------
(0 rows)

$ ... -c "SELECT proname FROM pg_proc WHERE proname = 'tocar_updated_at';"
 proname
---------
(0 rows)
```
**REPRODUCIDO**. No solo no hay trigger sobre las 5 tablas: no hay **ningún**
trigger de usuario en toda la base, y la función `tocar_updated_at()` tampoco
existe ya. El DDL correspondiente (`db/schema.sql:477-487`) sustituyó la función
y los 5 `CREATE OR REPLACE TRIGGER` por el comentario de política D-1, cuyo
texto se verificó íntegro contra el diff.

### R2 — Invariante `updated_at >= created_at` (CA-2) — PASS

*Escenario «El invariante se cumple tras un update»* — **cubierto y verde**.

Evidencia **REPRODUCIDA** en esta sesión. Se creó una fila por tabla vía el
`dist/` de `@safari/db` (las mismas funciones de repositorio que usa la app:
`createCategory`/`updateCategory`, `createShop`/`updateShop`,
`createProduct`/`updateProduct`, `createUser`/`setUserActive`, más el `create`
anidado de `profile`), con ~25 ms de separación entre create y update:

```
   tabla    |  id  |         created_at         |         updated_at         | ok | avanzo
------------+------+----------------------------+----------------------------+----+--------
 categories |  298 | 2026-09-15 13:25:53.9+00   | 2026-09-15 13:25:54.005+00 | t  | t
 shops      |   63 | 2026-09-15 13:25:54.062+00 | 2026-09-15 13:25:54.122+00 | t  | t
 products   | 1304 | 2026-09-15 13:25:54.171+00 | 2026-09-15 13:25:54.306+00 | t  | t
 users      |   50 | 2026-09-15 13:25:54.366+00 | 2026-09-15 13:25:54.417+00 | t  | t
 profiles   |   50 | 2026-09-15 13:25:54.366+00 | 2026-09-15 13:25:54.366+00 | t  | f
(5 rows)
```

`ok = updated_at >= created_at`; `avanzo = updated_at > created_at`. Las cinco
tablas cumplen el invariante. `profiles` muestra `avanzo = f` (igualdad exacta)
porque no existe ruta de `UPDATE` — resultado declarado de antemano, ver R5.

Barrido sobre el universo completo de filas, no solo las de prueba:

```
     t      | violaciones | total
------------+-------------+-------
 categories |           0 |   198
 products   |           0 |  1200
 shops      |           0 |    12
 users      |           0 |     3
 profiles   |           0 |     3
```
Cero filas con `updated_at < created_at` en las 1416 filas de las 5 tablas.

Las 4 pruebas de integración nuevas aseveran además `updatedAt >= createdAt`
explícitamente (aserción `(b)` en cada una).

**Limpieza verificada**: las filas de evidencia (ids 298/63/1304/50) se
borraron y los conteos del seed volvieron a su línea base — ver §3, ítem 1.

### R3 — Inventario exhaustivo de rutas de `UPDATE` (CA-2) — PASS (ver W-1)

La propia spec exige que este requisito se verifique por **revisión exhaustiva
de código**, no por el test del invariante. Se hizo de forma independiente.

`grep -rn "\.update(\|\.upsert(\|\.updateMany(" packages/db/src --include=*.ts`
(excluyendo tests) → 16 call sites. Clasificación completa:

| Call site | Tabla | Estado |
|---|---|---|
| `products.repository.ts:381` (rama `update` del upsert del scraper) | `products` | `updatedAt: now()` ✔ (`:406`) |
| `products.repository.ts:818` (`updateProduct`) | `products` | `updatedAt: now()` ✔ (`:858`) |
| `categories.repository.ts:535` (`updateCategory`) | `categories` | `updatedAt: now()` ✔ (`:545`) |
| `shops.repository.ts:314` (`updateShop`) | `shops` | `updatedAt: now()` ✔ (`:325`) |
| `shops.repository.ts:346` (`setShopActive`) | `shops` | `updatedAt: now()` ✔ (`:348`) |
| `users.repository.ts:329` (`updateUserPasswordHash`) | `users` | `updatedAt: now()` ✔ (`:331`) |
| `users.repository.ts:346` (`setUserActive`) | `users` | `updatedAt: now()` ✔ (`:348`) |
| `shops.repository.ts:192` (`findOrCreateShopBySlug`) | `shops` | **exención declarada** (R4) |
| `users.repository.ts:382` (`permissionUser.upsert`) | `permission_user` | **fuera de alcance**: la tabla NO tiene columna `updated_at` (`db/schema.sql:173-178`) |
| `manufacturers.repository.ts:80,209`, `tags.repository.ts:183`, `types.repository.ts:128` | `manufacturers`/`tags`/`types` | fuera de alcance (no-goal de la US); ya fijaban `updatedAt: now()` desde antes |
| `auth-tokens.repository.ts:130,169,205` | `password_reset_tokens`/`otp_codes` | fuera de alcance (sin `updated_at`; usan `consumedAt`) |

Los **siete** call sites normativos existen, están exactamente en las líneas que
la spec cita tras el refresco R-5 (`products:381,818`, `categories:535`,
`shops:314,346`, `users:329,346`) y **todos** fijan `updatedAt: now()` desde
`clock.ts`. Los cuatro repositorios importan `now` desde `../clock`. No se
encontró ninguna ruta de `UPDATE` omitida sobre las 4 tablas.

*Escenario «Una ruta olvidada no la detecta el test del invariante»* — es un
escenario de razonamiento (describe por qué el test NO basta), no un
comportamiento ejecutable. Se honra por construcción: las 4 pruebas nuevas
añaden la aserción `(a)` de igualdad exacta contra el reloj fijado, que SÍ falla
si se borra un `updatedAt: now()`. El hallazgo R-1 del gate re-run es la prueba
empírica de que el mecanismo funciona: la línea del scraper no tenía test y su
borrado dejaba 208/208 en verde; con el test nuevo, ya no.

**W-1 (WARNING, no viola la spec)**: `updateUserPasswordHash`
(`users.repository.ts:329`) sigue **sin test que asevere `updatedAt`**. Los dos
`it` que la ejercitan (`users.integration.test.ts:230,245`) solo comprueban el
hash y el `null` de P2025. Borrar su `updatedAt: now()` dejaría los 209 tests en
verde — exactamente la misma clase de agujero que R-1 corrigió para
`upsertScrapedProduct`, y que la propia spec describe en su segundo escenario.
No es incumplimiento (la spec delega la garantía en la revisión de código, que
aquí pasa), pero es una asimetría contra el precedente que el mismo change
sentó. Las otras seis rutas SÍ están protegidas: cuatro por las pruebas de reloj
fijado, y `setShopActive` por el test de monotonía estricta
`setShopActive → setShopActive` (`shops.integration.test.ts:430`), donde una
igualdad haría fallar el `toBeGreaterThan`.

### R4 — Excepción de actualización vacía en `findOrCreateShopBySlug` — PASS

*Escenario «Correr el scraper dos veces no toca `updated_at`»* — **cubierto y
verde** (`shops.integration.test.ts`, describe «findOrCreateShopBySlug —
excepción de update vacío (D-4 de US-32)»; asevera
`segundo.updatedAt.getTime() === primero.updatedAt.getTime()`). Parte de los
209/209 **REPRODUCIDOS**.

Código: `update: {}` se mantiene vacío (`shops.repository.ts:209`), sin
`updatedAt: now()`, tal como manda el requisito.

**Texto corregido (F-2) — verificado exacto.** Se leyó el comentario de
`shops.repository.ts:199-208` y el párrafo de la spec (`:81-92`). Ambos dicen
ahora que la promesa «no se pisa nada si ya existe» **ya era cierta antes del
change**, porque Prisma no emite ningún `UPDATE` para un `update: {}` sobre una
fila existente (verificado con `log:['query']`, hallazgo D-4) y por tanto el
trigger nunca llegaba a dispararse en esa ruta; el `update: {}` se conserva
vacío para no aplicar mecánicamente la regla «todo `update` fija `updatedAt`» a
una llamada que no actualiza nada. **El texto es fiel al hallazgo D-4 registrado
en `apply-progress.md`** (trazas SQL de ambas llamadas: la segunda solo emite
`SELECT`s + `COMMIT`). Decisión no reabierta, como se indicó.

Salvedad menor (S-2, ya aceptada en `design.md`): el test asevera un
**resultado** (`updatedAt` sin moverse), no el **mecanismo** (ausencia de
`UPDATE`). El mecanismo está probado solo por la traza `log:['query']` de la
fase de apply, que es evidencia **HEREDADA**.

### R5 — `profiles` vincula su primera ruta de update futura — PASS

*Escenario «`profiles` sin update conserva `updated_at = created_at`»* —
**cubierto y verde**, **REPRODUCIDO**: la fila `profiles` del usuario 50 creada
en esta sesión muestra `created_at = updated_at = 2026-09-15 13:25:54.366+00`
(ver tabla de R2), y el barrido completo da 0 violaciones sobre las 3 filas de
`profiles`. Confirmado además que **NO se creó ninguna función `updateProfile`**:
no existe ningún `prisma.profile.update` en `packages/db/src` (el único acceso de
escritura es el `create` anidado de `users.repository.ts:293-295`). El requisito
prohíbe expresamente crearla y la prohibición se respetó.

*Escenario «La primera función de update que se cree hereda la política»* — es
**prospectivo y no ejecutable hoy**. No se marca `UNTESTED` crítico porque
describe trabajo futuro, no comportamiento presente. Su vinculación está
materializada por escrito en dos sitios verificados:
- `packages/db/src/clock.ts:14-15`: «`profiles` no tiene hoy ruta de `UPDATE`; la
  PRIMERA que se cree debe fijar `updatedAt: now()` igual que las demás.»
- `db/schema.sql:486-487`: «NO re-añadir triggers: toda tabla nueva hereda esta
  política y cada `update`/`upsert` fija `updatedAt: now()`.»

Este segundo anclaje es el que hereda US-34 (8 tablas de entidad nuevas), que es
la razón por la que US-32 se volvió su prerrequisito.

### R6 — Alcance documentado de `_setNowProvider` (CA-3) — PASS

Dos escenarios, ambos con cobertura de runtime.

*Escenario «`_setNowProvider` mockea `updated_at` de las cinco tablas»* —
**cubierto y verde**: aserción `(a)` (`updatedAt === future`) en las 4 pruebas
nuevas de `categories`, `products`, `shops` y `users`. La quinta tabla,
`profiles`, queda cubierta por la regla prospectiva de R5 (no hay ruta que
mockear hoy).

*Escenario «`_setNowProvider` no afecta `created_at`»* — **cubierto y verde**:
aserción `(c)` (`createdAt.getTime() < future.getTime()`) en las mismas 4
pruebas. Es la prueba positiva del no-goal declarado.

Documentación verificada en el código, no solo reclamada:
- `packages/db/src/clock.ts:1-23` — cabecera reescrita con el texto D-5 completo:
  enumera lo que `_setNowProvider` **sí** gobierna (`updated_at` de `types`,
  `tags`, `manufacturers`, `products`, `categories`, `shops`, `users`;
  `consumedAt` de `password_reset_tokens`/`otp_codes`; `scrapedAt` de
  `products`; la regla futura de `profiles`) y lo que **no** (`created_at` de
  ninguna tabla, con el razonamiento de por qué es un no-goal deliberado y no un
  descuido).
- `packages/db/README.md:37-39` — puntero añadido; el README sigue siendo índice
  y `clock.ts` la fuente de verdad, tal como pedía la tarea 5.2.

La spec admite «en la cabecera de `clock.ts` **o** en `README.md`»; se hizo en
ambos, con la jerarquía correcta.

### R7 — `category-tree-api`: edición y reenraizado, `updated_at` avanza (CA-2) — PASS

Requisito `MODIFIED`. Dos comprobaciones distintas:

**(a) Higiene del delta para el merge de archivo.** Se comparó el bloque
`MODIFIED` contra el requisito original en
`openspec/specs/category-tree-api/spec.md:198-218`. El delta contiene el
requisito **completo**, con los **dos** escenarios preservados verbatim
(«renombrar no cambia el slug» y «mover una categoría a otra madre válida»).
Cumple la convención OpenSpec de que un `MODIFIED` reemplaza el bloque entero.
El archivado puede fusionarlo sin pérdida.

**(b) Corrección del texto nuevo.** El texto reemplazado decía que la columna la
fija «un trigger de base de datos … verificación por monotonía contra el reloj
de la base, nunca por igualdad contra un reloj fijado en el test». Tras retirar
el trigger eso es falso, y el nuevo texto («la fija el repositorio
(`updatedAt: now()` desde `packages/db/src/clock.ts`) … por monotonía **o** por
igualdad contra el reloj de aplicación fijado en el test») es exacto. El bloque
`(Previously: …)` conserva la traza de auditoría.

**(c) Cobertura de los escenarios.** *«Renombrar no cambia el slug y `updated_at`
posterior al valor previo»* — verde por dos vías complementarias en
`categories.integration.test.ts`: el test nuevo de reloj fijado (igualdad contra
`future`, la vía que el requisito acaba de habilitar) y el test de monotonía con
`toBeGreaterThan` **estricto** entre dos `PUT` sucesivos, que sigue aseverando
`slug` invariante. *«Mover una categoría a otra madre válida»* — cubierto por los
tests preexistentes de reenraizado, sin cambios en este change.

**Salvedad (S-4)**: la verificación es de capa de repositorio + unitaria de
servicio (`categories.service.spec.ts`, parte de las 9 suites verdes). **No hay
ninguna prueba HTTP real de `PUT /categories/:id`** en el repo (no existe suite
e2e; `config.yaml` declara `layers.e2e: false`). Es el estado preexistente, no
una regresión introducida por este change, pero el requisito está redactado
sobre el verbo HTTP y su evidencia se detiene una capa por debajo.

---

## 3. Definición de Done (US-32) — ítem por ítem

Separando explícitamente lo reproducido de lo heredado, como exige
`rules.verify.require_evidence: true`.

### Ítem 1 — `psql` de una fila creada-y-actualizada en cada una de las 5 tablas — **REPRODUCIDO** ✅

Reproducido íntegramente en esta sesión (tabla en R2). Las filas se crearon vía
`@safari/db` y se comprobaron con `psql` contra el contenedor vivo. Las 5 tablas
dan `ok = t`.

**Cómo se evidenció `profiles`** (el punto que se pidió no aceptar inventado):
`profiles` **no tiene ruta de `UPDATE`** — verificado por grep (no existe
`prisma.profile.update` en todo `packages/db/src`) y por el propio requisito R5,
que prohíbe crearla. La fila se creó mediante el `create` anidado de `createUser`
y se leyó tal cual; `updated_at = created_at` al milisegundo. Es decir: **no se
fabricó un update artificial para `profiles`**, se documentó la igualdad como el
resultado esperado declarado de antemano (sub-decisión b). Es el mismo criterio
que usó la fase de apply, y es honesto: satisface el invariante por ausencia de
update, no por diseño de una función nueva.

**Limpieza verificada** (obligatoria por el encargo):

```
BEGIN / DELETE 1 (products) / DELETE 1 (shops) / DELETE 1 (categories)
DELETE 1 (profiles) / DELETE 0 (permission_user) / DELETE 1 (users) / COMMIT

 categories | raices | shops | users | products | profiles
------------+--------+-------+-------+----------+----------
        198 |     83 |    12 |     3 |     1200 |        3
```
Conteos idénticos a la línea base previa. Además, 0 filas con prefijo `zz-` en
`categories`/`shops`/`users`, lo que confirma que también la limpieza de la fase
de apply fue completa.

### Ítem 2 — `just db-reset` + `just db-up` y conteos del seed — **MIXTO: salida HEREDADA, estado REPRODUCIDO** ⚠️

- **HEREDADO**: la salida de consola de `just db-reset`/`just db-up` (tarea 2.1).
  No se re-ejecutó: el encargo prohíbe expresamente correr `db-reset`/`db-up` y
  cualquier comando que arranque, pare o recree el contenedor.
- **REPRODUCIDO**: el **estado resultante**, que es lo que el ítem realmente
  garantiza. Contenedor `safari-postgres` «Up 9 hours (healthy)», y contra él:

```
 categories | raices | shops | users | products | profiles | types | tags | manufacturers
------------+--------+-------+-------+----------+----------+-------+------+---------------
        198 |     83 |    12 |     3 |     1200 |        3 |    10 |   10 |            14

 SELECT tgname FROM pg_trigger WHERE NOT tgisinternal;  -> (0 rows)
 SELECT proname FROM pg_proc WHERE proname='tocar_updated_at'; -> (0 rows)
```

198 categorías / 83 raíces confirmados, resto de conteos intactos, 0 triggers.
El objetivo verificable del ítem se cumple; solo la transcripción del comando es
heredada.

### Ítem 3 — `db-check` / `jest` / `build-api` / `verify` verdes con recuentos — **PARCIALMENTE REPRODUCIDO** ⚠️

| Comando | Estado | Resultado |
|---|---|---|
| `just db-check` (= `npm run typecheck && npm test` en `packages/db`) | **REPRODUCIDO** | typecheck limpio (0 errores); **10 archivos / 209 tests, 209 passed**, 26.26 s |
| `cd apps/api/rest && npx jest` | **REPRODUCIDO** | **9 suites / 285 tests, todos passed**, 85.26 s |
| `just build-api` | **HEREDADO** | `nest build` limpio (apply-progress §6.3). No reproducido: el comando borra `apps/api/rest/dist` (`rimraf`), fuera del conjunto de solo-lectura autorizado |
| `just verify` | **HEREDADO** | API 200/5503B, Shop 200 cards:30, Admin 200 cards:1 (apply-progress §6.4). No reproducido: requiere levantar los tres servidores de desarrollo |

Salida reproducida de `db-check`:
```
> @safari/db@0.1.0 typecheck
> tsc --noEmit
(sin errores)

> @safari/db@0.1.0 test
> vitest run
 Test Files  10 passed (10)
      Tests  209 passed (209)
   Duration  26.26s
```

Salida reproducida de `jest`:
```
PASS src/common/errors/domain-error.mapper.spec.ts
PASS src/users/user-dto.mapper.spec.ts
PASS src/types/types.service.spec.ts
PASS src/tags/tags.service.spec.ts
PASS src/manufacturers/manufacturers.service.spec.ts
PASS src/categories/categories.service.spec.ts
PASS src/shops/shops.service.spec.ts
PASS src/products/products.service.spec.ts
PASS src/users/users.service.spec.ts

Test Suites: 9 passed, 9 total
Tests:       285 passed, 285 total
Time:        85.262 s
```

El radio de impacto cero sobre la API queda confirmado de forma independiente:
285/285 idéntico a la línea base de `CLAUDE.md`, y el change no altera ninguna
firma pública de `@safari/db` (solo añade una clave interna al `data` de Prisma),
por lo que la no-reproducción de `build-api` es de riesgo bajo — pero **no se
declara pasada**.

**Desviación de recuento detectada**: la DoD de la US cita «208/208 tests» para
`db-check`. El número real hoy es **209/209** (el test R-1 del gate re-run añadió
el 209.º). Ver W-2.

### Ítem 4 — Decisión de CA-1 declarada con su razonamiento — **REPRODUCIDO** ✅

La decisión está declarada y es coherente en las cuatro capas donde debía
estarlo. **Opción B**: retirar los 5 triggers y fijar `updatedAt: now()` desde
`clock.ts` en cada ruta de `UPDATE`/`upsert` de la capa de datos.

- Declarada en la DoD de la US con su razonamiento y con el hallazgo D-4 anexo.
- Cerrada en `proposal.md`, ejecutada en `design.md` D-1/D-2/D-3.
- Materializada en el DDL: `db/schema.sql:477-487` lleva el razonamiento
  (deriva de hasta ±676 ms y de signo variable) y la prohibición vinculante de
  re-añadir triggers.
- Materializada en el código: 7 call sites + la exención documentada.

La US permitía la alternativa (`createdAt` a `dbgenerated("now()")`) siempre que
se eligiera una y se declarara. Se eligió y se declaró.

### Ítem 5 — Status de la US actualizado — **REPRODUCIDO** ✅

`docs/product/32-deriva-reloj-updated-at-created-at.md:9-11`:
«Status: Implementada y verificada (2026-09-15) — Opción B (retirar los 5
triggers; `updatedAt: now()` desde `packages/db/src/clock.ts` en cada
`update`/`upsert`); ver `openspec/changes/deriva-reloj-timestamps/`.»
Los 5 ítems de la checklist de DoD están marcados `[x]` con evidencia inline.

---

## 4. Coherencia con el diseño

| Decisión de diseño | Estado |
|---|---|
| D-1 — comentario de política reemplaza función + 5 triggers en `db/schema.sql` | ✅ texto exacto; `:477-487` |
| D-2 — `updatedAt: now()` en cada ruta de `UPDATE` de las 4 tablas | ✅ 7/7 call sites |
| D-3 — no tocar `scalars` ni la rama `create:` del upsert del scraper | ✅ el diff solo añade una línea a `update:` |
| D-4 — exención de `findOrCreateShopBySlug` + confirmación con `log:['query']` | ✅ pregunta abierta resuelta; texto corregido por F-2 |
| D-5 — cabecera de alcance en `clock.ts` | ✅ |
| D-6 — inventario de JSDoc obsoletos | ⚠️ incompleto en origen: omitió `deleteProduct` (corregido como F-1) y los comentarios de `tags`/`manufacturers` (corregidos como R-3). Ambos ya resueltos |
| Regla del repo: `schema.prisma` se re-introspecciona, nunca se edita a mano | ✅ `git status --porcelain packages/db/prisma/schema.prisma` vacío — el archivo quedó byte a byte igual, confirmando que el diff de `prisma db pull` era 100 % cosmético y se revirtió con `git checkout --` |
| Regla del repo: `db/schema.sql` es fuente de verdad del DDL | ✅ el cambio entró por ahí, sin migraciones incrementales |
| Alcance «NO incluye»: no tocar `types`/`tags`/`manufacturers` | ✅ respetado — los cambios en `tags`/`manufacturers` son **solo comentarios JSDoc** (R-3), sin una línea de comportamiento |

La evidencia del `prisma db pull` (tarea 2.6) es **HEREDADA**: el diff crudo
vive en el scratchpad de la sesión anterior, no en el repo. Lo que sí se
reprodujo —y es el aserto verificable que importa— es que el archivo final está
limpio y conserva los 23 pares `@default(now())`, `previewFeatures` y los
`@map`/`@@map`.

---

## 5. Hallazgos

### CRITICAL

Ninguno.

### WARNING

- **W-1 — `updateUserPasswordHash` sin test que proteja su `updatedAt`.**
  (Detalle en R3.) Borrar `updatedAt: now()` de `users.repository.ts:331` dejaría
  209/209 en verde. No incumple la spec (que delega esta garantía en la revisión
  de código, la cual pasa), pero es la misma clase de agujero que el propio
  change corrigió para el scraper vía R-1, dejada sin cerrar en una de las siete
  rutas. **Coste de cierre: ~15 líneas**, copiando el patrón de las otras cuatro.
  Recomendación: cerrarlo antes de archivar, o registrarlo como deuda explícita.
- **W-2 — Cifras desactualizadas en la DoD de la US.** Dos números en
  `docs/product/32-deriva-reloj-updated-at-created-at.md` quedaron congelados en
  el estado previo al gate re-run:
  - línea 143: «208/208 tests» → el real es **209/209**;
  - líneas 13-14: «real: ~254 adds / ~110 dels (11 archivos)» → el working tree
    real es **349 adds / 123 dels en 14 archivos versionados**.
  No afecta al comportamiento, pero contradice la regla del repo de cerrar la DoD
  con salida real. No se corrigió aquí: el encargo restringe mis escrituras a
  este reporte.
- **W-3 — El presupuesto de revisión se superó (observación de proceso).** El
  forecast de `tasks.md` predijo ~241 líneas y clasificó el riesgo como
  `400-line budget risk: Low`. Medido ahora:
  - solo código (`db/` + `packages/`): **13 archivos, 307 adds / 115 dels = 422
    líneas cambiadas** — por encima del presupuesto de 400;
  - incluyendo el doc de la US: 14 archivos, 349 / 123 = **472**.
  El exceso proviene casi entero de los tests (353 de las 422 líneas de código) y
  de las correcciones del gate re-run, que el forecast no podía anticipar. La
  conclusión de no dividir en PRs encadenados sigue siendo defendible —DDL, repos
  y tests son interdependientes y partirlos rompería la atomicidad— pero el
  forecast subestimó en ~75 % y su etiqueta `Low` no se sostuvo. Insumo para
  calibrar `sdd-tasks` en cambios con mucha reescritura de comentarios.

### SUGGESTION

- **S-1 — `packages/db/dist/` está desfasado respecto al código fuente.**
  `dist/index.js` es de las 07:52; las últimas ediciones de fuente
  (`shops.repository.ts`, 08:16) son de las correcciones F-1/F-2/R-3, que son
  **solo comentarios**, así que el comportamiento del `dist` es idéntico. `dist/`
  está gitignored, de modo que no afecta al commit. Aun así, quien re-corra
  `just build-api` o `just verify` debería hacer `just db-build` antes, por
  higiene.
- **S-2 — El test de D-4 asevera resultado, no mecanismo.** Pasaría igual si
  Prisma emitiese un `UPDATE` que casualmente no moviera la columna. El mecanismo
  (ausencia de `UPDATE`) solo está probado por la traza `log:['query']` de la fase
  de apply, que es evidencia heredada y no regresiva. `design.md` ya declaró
  aceptable esta limitación.
- **S-3 — Deuda cruzada ya señalada, fuera de alcance.**
  `docs/product/33-contenido-configuracion-postgres/34-esquema-capa-datos-contenido.md:238-241`
  sigue documentando los triggers retirados. Pertenece al doc de planificación de
  US-34 y allí ya está auto-señalado. **El autor de US-34 debe verlo antes de
  ejecutar esa US**, porque US-32 es su prerrequisito precisamente por la
  política de reloj que sus 8 tablas nuevas heredan.
- **S-4 — Sin cobertura HTTP de `PUT /categories/:id`.** (Detalle en R7.) El
  requisito `MODIFIED` está redactado sobre el verbo HTTP; la evidencia llega
  hasta el repositorio y la unitaria de servicio. Estado preexistente del repo
  (`layers.e2e: false`), no una regresión de este change.

---

## 6. Veredicto final

### **PASS WITH WARNINGS**

Los 7 requisitos pasan. Los 12 escenarios Gherkin tienen cobertura: 10 con test
que pasó en runtime y reproducido en esta sesión, 1 prospectivo por diseño
(«la primera función de update de `profiles` hereda la política», vinculado por
escrito en `clock.ts` y `db/schema.sql`) y 1 de razonamiento («una ruta olvidada
no la detecta el test del invariante», honrado por construcción con la aserción
de igualdad exacta). Los 4 criterios de aceptación de la US se cumplen: CA-1
decidido y ejecutado, CA-2 probado e invariante verificado sobre las 1416 filas
reales, CA-3 documentado en `clock.ts` + `README.md` y probado por la aserción
`(c)`, CA-4 sin regresión en las dos suites reproducidas.

Las dos revisiones adversariales previas hicieron su trabajo: los defectos que
encontraron (F-1, F-2, R-1, R-3, R-5) están efectivamente corregidos en el
árbol, y verifiqué el texto de las correcciones —no solo su existencia— contra
el hallazgo D-4 que las motivó.

### ¿Listo para archivar?

**Sí, condicionado a que el dueño acepte explícitamente dos cosas:**

1. **Que `just build-api` y `just verify` queden como evidencia heredada.** No se
   reprodujeron en esta pasada (fuera del conjunto de comandos seguros
   autorizado). La regla del repo es que la DoD se cierra con salida real
   pegada, y esa salida existe —en `apply-progress.md`, de la fase de apply—,
   pero **no es de esta verificación**. Dado que ninguna firma pública cambió y
   las 9 suites de la API dan 285/285 reproducidos, el riesgo es bajo; aun así,
   quien quiera una DoD de cierre íntegra debería re-correr ambos (levantando
   antes los tres servidores y haciendo `just db-build`).
2. **Que W-2 se corrija antes del archivado.** El archivo es traza de auditoría
   inmutable; dejar «208/208» y «11 archivos» congelaría dos cifras falsas en el
   registro permanente. Es una edición de dos líneas en el doc de la US.

**W-1 no bloquea el archivado** desde la letra de la spec, pero recomiendo
cerrarlo antes: es ~15 líneas y evita que la séptima ruta quede como el único
punto sin red de regresión de toda la política.

No se revirtió ninguna tarea a `[ ]`, no se modificó `openspec/specs/`, no se
corrigió ningún defecto (verificación y reparación son fases separadas) y no se
ejecutó ningún comando destructivo: el contenedor `safari-postgres` quedó en el
mismo estado en que se encontró, con los conteos del seed intactos.
