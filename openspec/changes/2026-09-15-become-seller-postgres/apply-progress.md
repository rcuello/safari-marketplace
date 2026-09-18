# Apply Progress: US-44 — `become-seller` desde Postgres

**Change**: `2026-09-15-become-seller-postgres`
**Branch**: `us-44-corte-1-repositorio` (feature-branch-chain, PR 1 de 2)
**Mode**: Standard (strict_tdd: false)
**Cut**: 1 of 2 — Phases 1-3 only (data layer). Phases 4-7 (Nest service,
unit spec, contract evidence, US/epic doc corrections) are Cut 2, out of
scope for this batch and NOT started.

## Measured Baselines (Phase 1, measured — not cited)

| # | Comando | Resultado medido |
|---|---|---|
| 1.1 | `curl -s localhost:9001/api/became-seller` → `antes.json` | 11 458 B en disco, `body.length` (JS, UTF-16) = **11 456** — coincide exacto con lo declarado en `design.md` |
| 1.2 | `just db-check` (ANTES de extender el test, ya con el repositorio+barrel de la Fase 2 compilando) | **12 test files / 225 tests**, verde. No estaba rojo — no hay deriva previa |
| 1.3 | `cd apps/api/rest && npx jest` | **9 suites / 285 tests**, verde. Coincide exacto con la cifra citada (pero no medida) en `CLAUDE.md` |
| 1.4 | `curl -s localhost:9001/api/settings` | 5504 B en disco, `body.length` = **5503** — coincide exacto con `CLAUDE.md` |

**Nota de orden**: 1.1 y 1.4 corrieron antes de tocar ningún código. 1.2 corrió
después de crear `become-seller.repository.ts` y de editar el barrel (Fase 2),
no antes — desviación de la secuencia estricta del tasks.md. No afecta la
validez de la cifra: la Fase 2 no agrega ni quita tests, solo código de
producción, así que 225 es la cifra real "antes de la Fase 3", que es lo que
importa para medir el delta.

## Completed Tasks

### Phase 1 — Baseline
- [x] 1.1, 1.2, 1.3, 1.4 — ver tabla arriba.

### Phase 2 — Repositorio + barrel (D-1)
- [x] 2.1 `getBecomeSeller()` — calco `settings.repository.ts:11-14`.
- [x] 2.2 `UpdateBecomeSellerInput` + `updateBecomeSeller()` — `update({where:{id:1}})`
  con spread condicional de 3 columnas + `updatedAt: now()`; `try/catch`
  traduce P2025 → `null` vía `_isRecordNotFound` local (calco
  `users.repository.ts:391-397`). Nunca `create`/`upsert`.
- [x] 2.3 Barrel `packages/db/index.ts`: `export type { UpdateBecomeSellerInput }`
  + `export { getBecomeSeller, updateBecomeSeller }`, insertado justo antes
  del bloque de `categories.repository`.
- [x] 2.4 `just db-build` — verde (Prisma Client + tsup, DTS incluido).

### Phase 3 — Extensión de la integración (D-5)
- [x] 3.1 Snapshot en `beforeAll` (`pageOptions`/`commissions`/`language`/`updatedAt`).
- [x] 3.2 `afterAll` YA EXISTENTE ampliado con `try { _restoreSeedRow() } finally { $disconnect() }`.
  **Sigue habiendo un solo `afterAll` en el archivo.**
- [x] 3.3 `describe` "getBecomeSeller devuelve la fila".
- [x] 3.4 `describe` "updateBecomeSeller persiste y fija el reloj".
- [x] 3.5 `describe` "updateBecomeSeller no crea una segunda fila (CA-3)".
- [x] 3.6 Los 3 `describe` de escritura declarados ANTES del tripwire.
- [x] 3.7 Prosa del tripwire reencuadrada; aserción `updatedAt === createdAt`
  intacta.
- [x] 3.8 `just db-check` verde — ver "Post-change" abajo.

## Deviation Found and Fixed (important — read before Cut 2)

**`design.md` D-5 y el tasks.md, tomados literalmente, no se sostienen.**
La instrucción decía: restaurar la fila SOLO dentro del `afterAll` YA
EXISTENTE, y declarar los `describe` de escritura ANTES del tripwire.
Implementado tal cual, el tripwire **falló**:

```
FAIL src/repositories/become-seller.integration.test.ts >
  reloj en reposo: updatedAt === createdAt (data-layer-clock-policy, tripwire) >
  la fila queda restaurada por el afterAll tras cualquier escritura de la suite
AssertionError: expected 1789707339789 to be 1789494060858
```

**Por qué**: `afterAll` corre UNA sola vez, al final de TODO el archivo —
después de que el tripwire (que vive a mitad de archivo, según 3.6) ya
ejecutó. Ningún orden de `describe` cambia eso: el `afterAll` del archivo
completo siempre corre después del último `it`, tripwire incluido. Con
restauración solo ahí, el tripwire ve la fila todavía mutada por el
`describe` de "fija el reloj" que corrió antes que él en la misma
ejecución.

**Precedente real que sí funciona** (`shops.integration.test.ts`): sus
`describe` de escritura limpian su propio centinela AL FINAL DE CADA `it`
(`await prisma.shop.delete(...)`), así el tripwire ve estado limpio sin
depender del `afterAll` de cierre. `become_seller` no puede crear un
centinela (la fila es única, CHECK), pero el principio — "el describe de
escritura deja limpio antes de que el archivo siga" — es el mismo.

**Fix aplicado**: se factorizó `_restoreSeedRow()` (la misma lógica de
restauración, sin duplicarla) y se llama desde DOS sitios:
1. El `afterEach` de cada uno de los 2 `describe` de escritura (3.4 y 3.5) —
   deja la fila en reposo INMEDIATAMENTE después de cada `it`, antes de que
   el tripwire corra.
2. El `afterAll` YA EXISTENTE (sigue siendo el único de todo el archivo) —
   red de seguridad si una corrida aborta a mitad de un `it`, antes de que
   llegue a su propio `afterEach` (el escenario "corrida abortada" que el
   propio `design.md` ya anticipaba en su Rationale, solo que asumía que el
   `afterAll` solo ya cubría el caso normal — no lo cubre).

Esto **no** viola la restricción "no crear un segundo `afterAll`": el
conteo de hooks `afterAll` en el archivo sigue siendo 1. `afterEach` es un
hook distinto, sin el problema de `sequence.hooks: 'stack'` que motivaba la
restricción (ese problema es específico de dos `afterAll` compitiendo por
desconectar/usar el mismo cliente al cierre del archivo).

## Second Finding (informational, no acción tomada — para Cut 2 / Fase 6)

Tras restaurar `updatedAt` tomando el valor `Date` que Prisma ya había
convertido a JS (milisegundos, sin microsegundos) y escribirlo de vuelta,
la comparación **SQL cruda** `updated_at = created_at` en `psql` da `f`
(false):

```
 count
-------
     1
(1 row)

 en_reposo |         updated_at         |          created_at
-----------+----------------------------+-------------------------------
 f         | 2026-09-15 17:41:00.858+00 | 2026-09-15 17:41:00.858127+00
```

`created_at` conserva los microsegundos originales del `now()` de Postgres
(nunca pasó por un `Date` de JS); `updated_at`, al haber sido reescrito con
un `Date` de JS (resolución de milisegundos), los pierde. El tripwire de
**vitest** sigue en VERDE porque compara con `.getTime()` (resolución de
milisegundos, ambos lados coinciden). Es la MISMA clase de divergencia que
`CLAUDE.md` ya declara "ya embarcada" para `/api/settings` — no es una
regresión introducida aquí, es inherente a restaurar un timestamp vía un
`Date` de JS. **No se tocó nada por esto** (fuera de alcance de esta Fase);
se deja documentado porque el plan de evidencia de la Fase 6 (US-44, Cut 2)
incluye un `SELECT` de `psql` (tarea 6.6) que, si se escribe como
`updated_at = created_at` crudo, dará `f` incluso en verde real — debe
comparar igual que el tripwire (redondeado a milisegundo) o usar
`date_trunc('millisecond', ...)`.

## Files Changed

| File | Action | Lines | What Was Done |
|------|--------|-------|----------------|
| `packages/db/src/repositories/become-seller.repository.ts` | Created | 55 | `getBecomeSeller`, `updateBecomeSeller`, `UpdateBecomeSellerInput`, `_isRecordNotFound` privado |
| `packages/db/index.ts` | Modified | +2 | `export type { UpdateBecomeSellerInput }` + `export { getBecomeSeller, updateBecomeSeller }`, antes del bloque de `categories.repository` |
| `packages/db/src/repositories/become-seller.integration.test.ts` | Modified | 87 → 202 | snapshot `beforeAll`, `_restoreSeedRow()` factorizada, `afterAll` ampliado (sigue siendo 1 solo), 2 `describe` de escritura + 1 de lectura nuevos (con `afterEach` de restauración en los de escritura), prosa del tripwire reencuadrada (aserción intacta) |
| `openspec/changes/2026-09-15-become-seller-postgres/tasks.md` | Modified | — | Fases 1-3 marcadas `[x]`, nota de la desviación de 3.2 |

## Post-change Verification

`just db-build`: verde (Prisma Client 7.10.0 + tsup, CJS + DTS).

`just db-check` — **corrida 1** (primera tras la extensión):
```
Test Files  12 passed (12)
     Tests  228 passed (228)
```

`just db-check` — **corrida 2** (idempotencia):
```
Test Files  12 passed (12)
     Tests  228 passed (228)
```

`just db-check` — **corrida 3** (idempotencia, confirmación):
```
Test Files  12 passed (12)
     Tests  228 passed (228)
```

Delta sobre la línea base de 1.2: **225 → 228 tests** (+3, los 3 `describe`
nuevos de la Fase 3). 12 archivos de test en ambos casos (no se creó
ningún archivo nuevo de test, solo se extendió el existente).

## Issues Found

1. Ver "Deviation Found and Fixed" arriba — el mecanismo de restauración de
   `design.md`/`tasks.md`, tomado literalmente, no hace pasar el tripwire.
   Corregido con `_restoreSeedRow()` llamada también desde `afterEach`.
2. Ver "Second Finding" arriba — precisión de submilisegundo perdida al
   restaurar `updatedAt` vía `Date` de JS; relevante para el script de
   evidencia de la Fase 6 (Cut 2), no accionado en este corte.

## Cut 2 — Phases 4-7 (Nest service, unit spec, contract evidence, doc corrections)

**Branch**: `us-44-corte-2-servicio` (sobre `us-44-corte-1-repositorio`,
commit `9feaf04`).

### Completed Tasks (Cut 2)

#### Phase 4 — Servicio Nest (D-2, D-4, D-6)
- [x] 4.1-4.5 `become-seller.service.ts` reescrito: se fue `plainToClass` +
  import del JSON + campo privado. `findAll()`/`create()` comparten una
  única guarda+envoltorio (`_toEnvelope`, private): mismo mensaje que
  `settings.service.ts:28-30` si `getBecomeSeller()`/`updateBecomeSeller()`
  devuelven `null`. El envoltorio es el literal de orden fijo de D-2,
  cerrado con `as unknown as BecomeSeller` (precedente
  `settings.service.ts:39`). La trampa D-4 se resolvió con un tipo local
  `BecomeSellerWriteBody` (`{ language?, page_options: Prisma.InputJsonValue,
  commissions: Prisma.InputJsonValue }`, tipo importado de `@safari/db`
  igual que `manufacturers.service.ts:188/239`) y
  `createBecomeSellerDto as unknown as BecomeSellerWriteBody`, con
  comentario que cita `apps/admin/rest/src/types/index.ts:2242-2246` y
  `entities/become-seller.entity.ts:6-10`. **No se editó la entidad.**
  `update()` pasa a `return this.findAll()`; `findOne`/`remove` conservan
  sus literales — calco `settings.service.ts:49-59`.
  `become-seller.module.ts`, `become-seller.controller.ts`, `dto/`,
  `entities/` y `domain-error.mapper.ts` quedaron sin editar (confirmado
  con `git diff` vacío, ver Phase 6).

#### Phase 5 — Test unitario Nest (jest, nuevo)
- [x] 5.1-5.7 `become-seller.service.spec.ts` creado, calco del arnés de
  `categories.service.spec.ts:66-82` (`jest.mock('@safari/db', ...)` +
  `jest.requireActual` + `jest.mocked(fn)` por función). 5 casos: (a)
  `findAll()` recompone el envoltorio — `Object.keys` top-level y del
  envoltorio, `page_options.page_options` idéntico por referencia; (b)
  `findAll()` con `getBecomeSeller` → `null` → `InternalServerErrorException`;
  (c) `create(body)` delega en `updateBecomeSeller` con las 3 claves tal
  cual y devuelve el mismo envoltorio; (d) `create(body)` con
  `updateBecomeSeller` → `null` → `InternalServerErrorException`; (e)
  `create({page_options, commissions})` sin `language` → el input al
  repositorio no lleva esa clave (spread condicional, no `undefined`
  explícito).
  `npx jest src/become-seller`: **5/5 verde** en aislado.
  `npx jest` completo (`apps/api/rest`): **10 suites / 290 tests**, verde.
  Línea base de Cut 1 (Fase 1, tarea 1.3): 9 suites / 285 tests. Delta: +1
  suite, +5 tests — exactamente la suite nueva, sin regresión en las
  otras 9.
  `just build-api`: verde (`nest build`, `Done in 97.39s`) — compila sin el
  JSON importado.

#### Phase 6 — Evidencia de contrato y regresión (CA-1, CA-2, CA-4)

**Desviación de método, documentada**: la API (`just api-dev`) ya estaba
arriba en el puerto 9001 desde una sesión previa, en modo watch
(`start:dev`). Al escribir `become-seller.service.ts` (Fase 4), el proceso
recompiló en caliente y empezó a servir Postgres de inmediato — no fue
posible re-capturar el `antes.json` (mock JSON) vía `curl` contra el
código viejo, porque el código viejo ya no estaba corriendo. Se resolvió
leyendo el mock **on disk**
(`apps/api/rest/src/db/pickbazar/become-seller.json`) y comprimiéndolo con
`JSON.stringify(JSON.parse(...))` — es exactamente lo que
`plainToClass` + el serializador de Nest producían antes (mismas claves,
mismos valores, solo sin la indentación del archivo fuente): el resultado
midió **11 458 B**, idéntico al valor medido por `curl` real en Cut 1
(tarea 1.1) y al declarado en `design.md`. Es la lectura correcta de la
frase de `design.md`/CA-1 «mock, on disk» — no era el archivo de
scratchpad de la sesión anterior (que además ya no existía), sino el JSON
fuente comprimido.

- [x] 6.1 `curl -s localhost:9001/api/became-seller > despues.json`
  (scratchpad) — **11 452 B**.
- [x] 6.2 Script `node -e` (`ca1-compare.js`, scratchpad) comparando
  `antes.json` (mock, on disk, comprimido) vs `despues.json` por los 5
  campos de D-3. Salida real:

  ```
  --- Bytes (UTF-8, en disco) ---
  antes.json  : 11458 B
  despues.json: 11452 B
  delta       : -6 B

  --- D-3: equivalencia estructural acotada a 5 campos ---
  1. Claves top-level (orden): [ 'page_options', 'commissions' ] => OK
  2. Claves del envoltorio (orden): [ 'id', 'page_options', 'language', 'created_at', 'updated_at' ] => OK
  3. id: 1 | language: "en" => OK (deep-equal)
  4. page_options.page_options (24 claves) => OK (deep-equal)
  5. commissions (array de 2 tiers) => OK (deep-equal)

  --- Excluidos del deep-equal: created_at/updated_at del envoltorio (divergencia acotada) ---
  antes.page_options.created_at  : 2024-06-06T10:30:48.000000Z (27 car.)
  despues.page_options.created_at: 2026-09-15T17:41:00.858Z (24 car.)
  antes.page_options.updated_at  : 2024-06-12T11:31:46.000000Z (27 car.)
  despues.page_options.updated_at: 2026-09-15T17:41:00.858Z (24 car.)
  Causa doble: (a) VALOR -- db/seed.sql:33 no inserta created_at/updated_at, toman DEFAULT now() del ultimo db-up, no las fechas 2024 del mock;
               (b) FORMATO -- Date.toJSON() emite 24 caracteres (.fffZ) donde el mock trae 27 (.ffffffZ).

  CA-1: VERDE
  ```

- [x] 6.3 `POST /api/became-seller` cambiando `sellingStepsTitle` dentro de
  `page_options` (body con los 24 campos internos + `commissions` +
  `language` tal como los devolvía el `GET`) → `HTTP 201`, respuesta con
  el título cambiado. `GET` posterior confirma el mismo título y
  `updated_at` posterior (`2026-09-15T17:41:00.858Z` →
  `2026-09-18T05:20:57.821Z`). **Después de capturar la evidencia, la fila
  se restauró** vía `psql` (`UPDATE become_seller SET page_options = ...,
  commissions = ..., language = ..., updated_at = created_at WHERE id =
  1`, usando el `despues.json` pre-mutación como fuente) — así el
  tripwire de reposo de Cut 1 sigue viendo la fila sin mutar.
- [x] 6.4 `just verify` — requirió levantar `shop-dev`/`admin-dev` en
  segundo plano (no estaban arriba). Salida real:
  ```
  OK   API    :9001/api/settings  200  5503B  57ms
  OK   Shop   :3003/en  200  190788B  851ms  cards:30
  OK   Admin  :3002/en/login  200  72821B  2122ms  cards:1
  ```
- [x] 6.5 `git diff --stat` (post Fase 4-7):
  ```
  apps/api/rest/src/become-seller/become-seller.service.ts     | 89 ++++++++++++++++++----
  openspec/changes/2026-09-15-become-seller-postgres/tasks.md  | 22 +++---
  2 files changed, 87 insertions(+), 24 deletions(-)
  ```
  (más `become-seller.service.spec.ts`, nuevo, sin diff previo, y los 2
  docs de la Fase 7). `git diff` de `domain-error.mapper.ts` y de
  `become-seller.module.ts` — **ambos vacíos**, confirmado con
  `git diff -- <archivo>` sin salida.
- [x] 6.6 **Corrección respecto al tasks.md literal** (ver "Second Finding"
  de Cut 1): el `SELECT count(*), updated_at = created_at` crudo se
  reemplazó por una comparación a **resolución de milisegundo**
  (`date_trunc('milliseconds', ...)`) para no leer un falso rojo. Resultado
  real, tras la restauración de 6.3 (que se hizo con SQL directo, no vía
  `Date` de JS, así que aquí coincidieron hasta el microsegundo):
  ```
   count
  -------
       1
  (1 row)

   en_reposo |          updated_at           |          created_at
  -----------+-------------------------------+-------------------------------
   t         | 2026-09-15 17:41:00.858127+00 | 2026-09-15 17:41:00.858127+00
  (1 row)
  ```

`just db-check` post-evidencia (2 corridas, tras la mutación+restauración
de 6.3): **12 archivos / 228 tests**, verde ambas veces — sin regresión
sobre el cierre de Cut 1.

#### Phase 7 — Correcciones de la US y del épico
- [x] 7.1 Las 5 correcciones de `proposal.md:121-143` aplicadas en
  `docs/product/40-identidad-extendida-postgres/44-become-seller-postgres.md`:
  CA-1 reescrito con equivalencia estructural + bytes acotados; Gherkin
  sin «cuerpo idéntico»; ruta aclarada a `/api/became-seller` (pasado,
  `@Public()`, sin guard); tabla de archivos con
  `become-seller.integration.test.ts` marcado **existente, se extiende**;
  DoD reescrito a «deep-equal + línea de bytes que acota la divergencia a
  los 2 timestamps».
- [x] 7.2 Fila de US-44 marcada `✅ Implementada` en
  `docs/product/40-identidad-extendida-postgres/README.md`, con
  referencia a la rama `us-44-corte-2-servicio` (no hay commit todavía —
  el orquestador lo crea después de este batch).
- [x] 7.3 Toda la evidencia de la Fase 6 pegada en la sección "Definición
  de Done" del archivo de la US (bytes, deep-equal, CA-2, jest,
  build-api, verify, git diff --stat, db-check, psql).

### Deviation Found and Fixed (Cut 2)

**El método de captura de `antes.json` del tasks.md (6.1, vía `curl` contra
el código viejo) no era ejecutable en este batch**: el proceso de
`api-dev` en watch mode ya había recompilado con el servicio nuevo antes de
que se pudiera capturar. Se usó en su lugar el mock **on disk**
(`become-seller.json`, comprimido con `JSON.stringify(JSON.parse(...))`),
que es bit-a-bit lo que el código viejo servía (verificado: mismo tamaño,
11 458 B, que el medido por Cut 1 con `curl` real). No es una desviación
del contrato de evidencia — el propio `design.md` la nombra así («mock, on
disk») — solo del *mecanismo* (lectura de archivo en vez de `curl` en
vivo), forzado por el estado del proceso, no por elección.

### Files Changed (Cut 2)

| File | Action | What Was Done |
|------|--------|----------------|
| `apps/api/rest/src/become-seller/become-seller.service.ts` | Modified | Reescritura completa: Postgres vía `@safari/db`, envoltorio D-2, tipo local D-4, guarda compartida `_toEnvelope`, métodos muertos calco `settings.service.ts` (D-6) |
| `apps/api/rest/src/become-seller/become-seller.service.spec.ts` | Created | 5 casos jest, `@safari/db` mockeado, calco `categories.service.spec.ts:66-82` |
| `docs/product/40-identidad-extendida-postgres/44-become-seller-postgres.md` | Modified | Las 5 correcciones de `proposal.md` + status + evidencia de la Fase 6 pegada en la DoD |
| `docs/product/40-identidad-extendida-postgres/README.md` | Modified | Fila de US-44 marcada completada |
| `openspec/changes/2026-09-15-become-seller-postgres/tasks.md` | Modified | Fases 4-7 marcadas `[x]` (37/37 tareas del archivo completo) |

**No tocados** (confirmado con `git diff` vacío): `domain-error.mapper.ts`,
`settings/`, `become-seller.module.ts`, `become-seller.controller.ts`,
`entities/`, `dto/`, `packages/db/` (Cut 1 ya cerrado, no se re-tocó).

### Issues Found (Cut 2)

1. `updateBecomeSeller`'s `Prisma.InputJsonValue` type forced the local
   `BecomeSellerWriteBody` type (D-4) to type `page_options`/`commissions`
   as `Prisma.InputJsonValue` too (imported from `@safari/db`, precedent
   `manufacturers.service.ts:188/239`) instead of a hand-rolled
   `Record<string, unknown>` — the hand-rolled version didn't satisfy
   `updateBecomeSeller`'s parameter type. Not a design deviation, just a
   type-level detail the design didn't spell out.
2. See "Deviation Found and Fixed (Cut 2)" above — the `antes.json`
   capture mechanism (file read vs. live `curl`), forced by the API
   process already running in watch mode.
3. `just verify` needed `shop-dev`/`admin-dev` started in the background
   (neither was up at the start of this batch) — not a code issue, just a
   precondition the tasks.md assumed was already met.

## Workload / PR Boundary (Cut 2)

- Mode: chained PR slice (`feature-branch-chain`), Unit 2 of `tasks.md`.
- Current work unit: **Unit 2** — Phase 4 (service) + Phase 5 (spec) +
  Phase 6 (evidence) + Phase 7 (US corrections).
- Boundary: this batch starts on `us-44-corte-2-servicio` (branched from
  `us-44-corte-1-repositorio`, commit `9feaf04`) and ends with all of
  Phase 4-7 green and evidence pasted into the US doc. Rollback:
  `git checkout -- apps/api/rest/src/become-seller/` +
  `git checkout -- docs/product/40-identidad-extendida-postgres/`.
- Estimated review budget impact: net diff for
  `become-seller.service.ts` (+89/-... per `git diff --stat` above) +
  `become-seller.service.spec.ts` (new, ~185 lines) + 2 doc files — inside
  the ~281 lines forecast by `tasks.md` for this Unit.

## Status (cumulative)

37/37 tasks complete (Fases 1-7 del `tasks.md` completo). Ready for
`sdd-verify`.
