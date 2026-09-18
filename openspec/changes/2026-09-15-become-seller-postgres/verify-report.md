# Verification Report

**Change**: `2026-09-15-become-seller-postgres` (US-44)
**Branch**: `us-44-corte-2-servicio` (HEAD `c6f5cf7`)
**Mode**: Standard (`strict_tdd: false`)
**Fecha**: 2026-09-18
**Artifact store**: `openspec` (Engram NO conectado — ninguna llamada a herramientas de Engram)

Toda la evidencia de abajo fue **re-derivada por el verificador**, no copiada
del `apply-progress.md`. El `jq` no está instalado: las comparaciones de JSON
se hicieron con `node -e`. La base **no** se reseteó; la fila `become_seller`
quedó byte a byte como se encontró (ver "Estado de la base al cerrar").

---

## Completeness

| Métrica | Valor |
|---|---|
| Tareas totales (`tasks.md`) | 37 |
| Marcadas `[x]` | 37 |
| Verificadas honestas | 36 |
| Marcadas `[x]` con evidencia engañosa | 1 (**6.6**, ver Issues) |
| Tareas de implementación sin hacer | 0 |

---

## Build & Tests Execution

**`just db-check`** (ejecutado por el verificador, DESPUÉS de su propia
escritura+restauración de CA-2/CA-3):

```text
> @safari/db@0.1.0 typecheck
> tsc --noEmit

> @safari/db@0.1.0 test
> vitest run
 RUN  v4.1.11 C:/DevOps/MyGitHub/safari-marketplace/packages/db

 Test Files  12 passed (12)
      Tests  228 passed (228)
   Duration  46.14s
```

**`npx jest src/become-seller`** (`apps/api/rest`, ejecutado por el verificador):

```text
PASS src/become-seller/become-seller.service.spec.ts (17.95 s)
  BecomeSellerService.findAll (US-44)
    √ recompone el envoltorio (D-2): 2 claves top-level, 5 del envoltorio, `page_options.page_options` idéntico por referencia
    √ `getBecomeSeller` resolviendo `null` (base no sembrada) → 500
  BecomeSellerService.create (US-44, D-4)
    √ delega en `updateBecomeSeller` con las 3 claves tal cual y devuelve el mismo envoltorio que `findAll()`
    √ `updateBecomeSeller` resolviendo `null` (base no sembrada) → 500
    √ sin `language` en el body, el input a `updateBecomeSeller` NO lleva esa clave

Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
```

**`npx jest` completo** y **`just build-api`**: re-ejecutados por el
orquestador antes de esta fase — 10 suites / 290 tests, y build verde.

**`just verify`** (ejecutado por el verificador, los 3 servicios arriba):

```text
OK   API    :9001/api/settings  200  5503B  62ms
OK   Shop   :3003/en  200  190788B  955ms  cards:30
OK   Admin  :3002/en/login  200  72821B  179ms  cards:1
```

**Consumidor real de la página** (verificación que ninguna fase previa hizo):

```text
shop /en/become-seller: HTTP 200 bytes=108445 time=27.374s
OK   Start Selling In 4 Simple Steps
OK   Why Sell with PickBazar
OK   Fee and Commission
OK   Level One
OK   Level Two
OK   Frequently Ask Question
```

La página del shop renderiza contenido real de ambas columnas `jsonb`
(`page_options` y los 2 tiers de `commissions`) servidas desde Postgres. El
reordenado de claves del `jsonb` **no** rompe al consumidor.

**Coverage**: ➖ no disponible (`coverage_command: ""` en `openspec/config.yaml`).

---

## CA-1 — Equivalencia estructural (re-derivada, no heredada)

Comparación propia: mock en disco
(`apps/api/rest/src/db/pickbazar/become-seller.json`, minificado con
`JSON.stringify(JSON.parse(...))`) contra `curl -s
localhost:9001/api/became-seller`.

```text
=== BYTES ===
mock file (pretty, on disk)   : 14115
mock minified JSON.stringify  : 11458 | body.length(UTF-16 chars): 11456
live response (curl, on disk) : 11452 | body.length(UTF-16 chars): 11450
delta minified->live          : -6
Content-Length del servidor   : 11452

=== 1. claves top-level (sensible al orden) ===
mock: ["page_options","commissions"]
live: ["page_options","commissions"]           MATCH: true

=== 2. claves del envoltorio (sensible al orden) ===
mock: ["id","page_options","language","created_at","updated_at"]
live: ["id","page_options","language","created_at","updated_at"]   MATCH: true

=== 3. id / language (valor + tipo) ===
mock id: 1 number | live id: 1 number          MATCH: true
mock language: "en" | live: "en"               MATCH: true

=== 4. objeto interno page_options ===
mock inner keys: 24 | live inner keys: 24
claves solo en mock: []  | solo en live: []
inner DEEP-STRICT-EQUAL: true
inner key ORDER identical: false   <-- reordenado jsonb (permitido por la spec)

=== 5. commissions (completo, incl. ids anidados y tipos) ===
mock len: 2 | live len: 2
commissions DEEP-STRICT-EQUAL: true
(ids 79/83 intactos; min_balance 200 number y max_balance "3000" string
 conservan su tipo; los created_at/updated_at INTERNOS de cada tier siguen
 en formato de 6 decimales 2024 — vienen del jsonb, no de una columna)

=== 6. EXCLUIDOS: timestamps del envoltorio ===
mock created_at: "2024-06-06T10:30:48.000000Z" (27 chars)
live created_at: "2026-09-15T17:41:00.858Z"    (24 chars)
mock updated_at: "2024-06-12T11:31:46.000000Z" (27 chars)
live updated_at: "2026-09-15T17:41:00.858Z"    (24 chars)

=== 7. CUERPO ENTERO menos SOLO esos 2 timestamps ===
DEEP-STRICT-EQUAL: true
bytes: mock-stripped 11372 | live-stripped 11372 | delta 0
```

**El acotamiento a 2 campos es real, no una suposición.** El punto 7 es
evidencia que el implementador no produjo: quitando *únicamente*
`page_options.created_at` y `page_options.updated_at`, los dos cuerpos
minificados miden **exactamente lo mismo (11 372 B)**. Los −6 B son
íntegramente de esos 2 campos (27 → 24 caracteres × 2). Ningún otro campo
diverge: ni valores, ni tipos (`number` vs `string` preservados), ni `null`s
(`guidelineItems[4].link` sigue `null`), ni ids anidados dentro de
`commissions`.

**Hallazgo que el implementador no reportó**: el orden de claves DENTRO de los
`jsonb` **sí cambia** (7 de las 24 claves internas reordenadas por Postgres:
`banner`, `sellingStepsItem`, `purposeItems`, `dashboard`, `guidelineItems`,
`sellerOpportunity`, `userStories`; y las 11 claves de cada tier de
`commissions`). El script del implementador solo imprimía `=> OK (deep-equal)`
y nunca mostró esta divergencia. **No es un defecto**: la requirement lo
permite explícitamente («El orden de claves dentro de los `jsonb` MUST NOT
formar parte del contrato») y el escenario «El reordenado de claves jsonb no
rompe el contrato» queda así *demostrado en vivo*, no solo asumido. El orden
top-level y el del envoltorio —lo que sí es contrato— coinciden exacto.

**Veredicto CA-1: ✅ VERDE**, con el bound de 2 campos probado por construcción.

---

## CA-2 — Escritura real (re-derivada en vivo)

Prueba propia del verificador: `POST` con `sellingStepsTitle` cambiado a
`VERIFY-PROBE-US44`, `GET` posterior, y restauración exacta.

```text
--- filas ANTES del POST ---
1
--- POST ---
HTTP 201 size=11438
--- filas DESPUÉS del POST (CA-3) ---
 filas | id |         updated_at         |          created_at           | reloj_avanzo
-------+----+----------------------------+-------------------------------+--------------
     1 |  1 | 2026-09-18 05:41:11.321+00 | 2026-09-15 17:41:00.858127+00 | t

=== CA-2 ===
titulo ANTES (GET)  : "Start Selling In 4 Simple Steps"
titulo en POST resp : "VERIFY-PROBE-US44"
titulo DESPUES (GET): "VERIFY-PROBE-US44"
updated_at antes    : 2026-09-15T17:41:00.858Z
updated_at despues  : 2026-09-18T05:41:11.321Z
updated_at avanzo   : true
created_at inmutable: true (2026-09-15T17:41:00.858Z)
POST resp === GET resp (deep): true
POST envelope keys  : ["id","page_options","language","created_at","updated_at"]
POST top keys       : ["page_options","commissions"]
```

El `POST` devuelve **exactamente el mismo cuerpo** que el `GET` posterior
(igualdad de string, no solo deep-equal), con el mismo envoltorio de 5 claves
en el mismo orden. `created_at` no se toca. `updatedAt` lo fija `now()` de
`clock.ts` (repositorio `:43`), no el reloj de Postgres.

**Veredicto CA-2: ✅ VERDE.**

### Restauración (obligatoria y verificada)

```text
UPDATE 1
 filas |         updated_at         |          created_at           | reposo_ms |             titulo
-------+----------------------------+-------------------------------+-----------+---------------------------------
     1 | 2026-09-15 17:41:00.858+00 | 2026-09-15 17:41:00.858127+00 | t         | Start Selling In 4 Simple Steps

payload original bytes  : 11452
payload restaurado bytes: 11452
IDENTICO byte a byte    : true
```

`just db-check` post-restauración: **12 archivos / 228 tests verdes** (salida
completa arriba). El tripwire de reposo pasa.

---

## CA-3 — El singleton nunca se duplica

**Prueba en vivo**: tras el `POST` de arriba, `count(*) = 1`.

**Prueba estática exhaustiva** — todas las llamadas a `prisma.becomeSeller.*`
en código escrito a mano (`packages/db/src`, `apps/api/rest/src`):

```text
become-seller.integration.test.ts:36   findUniqueOrThrow
become-seller.integration.test.ts:45   update        (restauración)
become-seller.integration.test.ts:66   count
become-seller.integration.test.ts:67   findUniqueOrThrow
become-seller.integration.test.ts:82   findUniqueOrThrow
become-seller.integration.test.ts:149  count
become-seller.integration.test.ts:172  findUniqueOrThrow
become-seller.integration.test.ts:189  findUniqueOrThrow
become-seller.repository.ts:15         findUnique
become-seller.repository.ts:37         update        ({ where: { id: 1 } })
```

Cero `create`/`upsert`/`createMany`/`delete`. Las únicas coincidencias de
`create|upsert` están en comentarios de doc del cliente Prisma generado
(`packages/db/dist/`, `packages/db/generated/`), no en código propio.

**Garantía estructural viva en la base**:

```text
         conname          | pg_get_constraintdef
--------------------------+----------------------
 become_seller_fila_unica | CHECK ((id = 1))
 become_seller_pkey       | PRIMARY KEY (id)
```

El controller expone **solo** `@Post()` y `@Get()`
(`become-seller.controller.ts:13-21`): no hay ninguna otra ruta desde la que
intentar una creación.

**Veredicto CA-3: ✅ VERDE** (vivo + estático + constraint).

---

## CA-4 — Sin regresión

| Gate | Resultado | Quién lo corrió |
|---|---|---|
| `just db-check` | ✅ 12 archivos / 228 tests | verificador (post-escritura propia) |
| `npx jest` (`apps/api/rest`) | ✅ 10 suites / 290 tests | orquestador |
| `npx jest src/become-seller` | ✅ 1 suite / 5 tests | verificador |
| `just build-api` | ✅ verde | orquestador |
| `just verify` | ✅ los 3 servicios | verificador |
| `/api/settings` | ✅ `body.length` = **5503** (5504 B UTF-8) | verificador |
| `git diff 9ac7b4c..HEAD --stat` | ✅ sin `settings/`, sin `domain-error.mapper.ts` | verificador |

**Veredicto CA-4: ✅ VERDE.**

---

## Spec Compliance Matrix

### `become-seller-page-api`

| Requirement | Scenario | Evidencia | Resultado |
|---|---|---|---|
| Lectura con equivalencia estructural (CA-1) | Paridad estructural excluidos los timestamps | `node -e` propio: deep-strict-equal del cuerpo entero menos 2 ts; stripped 11 372 B == 11 372 B | ✅ COMPLIANT (manual, evidencia arriba) |
| " | Divergencia de timestamps de valor, no solo de formato | live `2026-09-15T17:41:00.858Z` (24 car.) vs mock `2024-06-06T10:30:48.000000Z` (27 car.) → difieren valor **y** formato; bytes 11 458 → 11 452 | ✅ COMPLIANT |
| " | El reordenado de claves jsonb no rompe el contrato | 7 claves internas + las 11 de cada tier reordenadas; `deepStrictEqual` true; shop renderiza | ✅ COMPLIANT (demostrado, no asumido) |
| Escritura real (CA-2) | Editar el banner persiste | `POST` 201 → `GET` refleja; `updated_at` avanza | ✅ COMPLIANT |
| " | El cliente admin ya es compatible sin cambiar de verbo | `becomeSellerClient.update` → `HttpClient.post(BECAME_SELLER)`; controller `@Post()` | ✅ COMPLIANT (estático) |
| Singleton nunca se duplica (CA-3) | Un update no crea segunda fila | vitest `become-seller.integration.test.ts:145-150` + `count(*)=1` en vivo + CHECK | ✅ COMPLIANT |
| Contrato HTTP y errores congelados | `git diff` vacío en `domain-error.mapper.ts` | ausente de `git diff 9ac7b4c..HEAD --stat` | ✅ COMPLIANT |
| " | Ruta en pasado, pública, sin guard | `@Public()` + `@Controller('became-seller')`, `:8-9`, sin diff | ✅ COMPLIANT |
| Sin regresión medible (CA-4) | Evidencia de cierre completa | tabla CA-4 arriba | ✅ COMPLIANT |

### `data-layer-clock-policy`

| Requirement | Scenario | Evidencia | Resultado |
|---|---|---|---|
| `become_seller` vincula su primera ruta de update | Recién sembrado conserva `updated_at = created_at` | tripwire `:170-175` verde en las 2 corridas de `db-check` | ⚠️ PARTIAL — verde a resolución de **milisegundo**; la igualdad cruda en SQL es `f` (ver WARNING-1) |
| " | `updateBecomeSeller` avanza el reloj | `:114-137` (`updatedAt === fija`, `> createdAt`, relectura) | ✅ COMPLIANT |
| " | Sin trigger `BEFORE UPDATE` | `:177-185` (`pg_trigger`, count 0) | ✅ COMPLIANT |
| Restauración en el `afterAll` existente, tripwire al final | Restaurar dentro del `afterAll` existente, no en un hook nuevo | El código restaura en 2 `afterEach` (`:115`, `:140`) **y** en el `afterAll` único (`:56`) | ❌ **DIVERGENTE** — ver CRITICAL-1 |
| " | El describe de escritura se declara antes del tripwire | describes en `:100`, `:114`, `:139`; tripwire en `:170` | ✅ COMPLIANT |
| " | El tripwire sigue verde tras una restauración correcta | verde, pero por el `afterEach`, no por el `try/finally` que describe el escenario | ⚠️ PARTIAL — ver CRITICAL-1 |
| " | `just db-up` no repara `updated_at` por sí solo | `db/seed.sql:35` — `ON CONFLICT (id) DO UPDATE SET page_options, commissions, language` (sin `updated_at`) | ⚠️ UNTESTED (solo evidencia estática; nadie lo ejerció) |

### `extended-identity-data-layer`

| Requirement | Scenario | Evidencia | Resultado |
|---|---|---|---|
| Exportación por el barrel | Los dos tipos importables desde el barrel | `packages/db/index.ts:31` (`BecomeSellerRecord`), `:38` (`ShopStaffRecord`); `tsc --noEmit` verde | ⚠️ PARTIAL — `BecomeSellerRecord` se importa en runtime desde `@safari/db` en `become-seller.service.spec.ts:20`; `ShopStaffRecord` solo tiene evidencia estática/typecheck |
| " | Las funciones de `become_seller` importables desde el barrel | `index.ts:59-60`; `become-seller.service.ts:2-7` importa de `@safari/db` y la suite jest lo carga con `jest.requireActual` | ✅ COMPLIANT |
| " | El barrel sigue sin exportar funciones de repositorio de `shop_staff` | grep sobre `index.ts`: única coincidencia `ShopStaffRecord` (tipo) en `:38` | ✅ COMPLIANT |

**Resumen de cumplimiento**: 14 de 19 escenarios ✅ COMPLIANT, 4 ⚠️ PARTIAL,
1 ❌ DIVERGENTE. Ninguno ❌ FAILING.

---

## Correctness (evidencia estática)

| Requirement | Estado | Nota |
|---|---|---|
| Repositorio de 2 funciones planas, ambas `| null` | ✅ Implementado | `become-seller.repository.ts:14,33`; P2025 → `null` vía `_isRecordNotFound` |
| `updatedAt: now()` de `clock.ts` | ✅ Implementado | `:10` import, `:43` uso |
| Envoltorio recompuesto en el servicio, orden fijo | ✅ Implementado | `become-seller.service.ts:85-94` |
| Guarda `InternalServerErrorException` compartida | ✅ Implementado | `_toEnvelope` `:78-83`, calco `settings.service.ts:28-30` |
| Tipo local `BecomeSellerWriteBody` (trampa D-4) | ✅ Implementado | `:24-28`; la entidad declara `missions` y anida `page_options` un nivel más — **confirmado leyendo `entities/become-seller.entity.ts:5-11`**, la trampa era real |
| La entidad NO se edita | ✅ Confirmado | ausente del `git diff` |
| Sin `as any` / `@ts-ignore` | ✅ Confirmado | 0 coincidencias en los 4 archivos tocados (`packages/db` + `apps/api/rest`) |
| Barrel en orden alfabético | ✅ Confirmado | `index.ts:59-60`, entre el bloque `auth-tokens.repository` y el de `categories.repository` |
| Un solo hook `afterAll` | ✅ Confirmado | `grep`: 1 `afterAll` (`:56`), 2 `afterEach` (`:115`, `:140`) |
| Aserción del tripwire intacta | ✅ Confirmado | `git show 9ac7b4c:...` vs actual: `expect(row.updatedAt.getTime()).toBe(row.createdAt.getTime())` idéntica; solo cambiaron títulos y comentario |

---

## Coherence (Design)

| Decisión | ¿Seguida? | Nota |
|---|---|---|
| D-1 repositorio plano, `\| null`, sin errores de dominio | ✅ Sí | |
| D-2 envoltorio con literal de orden fijo en el servicio | ✅ Sí | orden de claves del envoltorio verificado en vivo |
| D-3 CA-1 por equivalencia estructural acotada | ✅ Sí, superada | el verificador probó el bound completo (delta 0 B fuera de los 2 ts) |
| D-4 tipo local, la entidad no se corrige | ✅ Sí | |
| D-5 punto 1 — snapshot en `beforeAll` | ✅ Sí | `:35-41` |
| D-5 punto 2 — restaurar SOLO en el `afterAll` existente | ❌ **No — imposible** | el `afterAll` corre al final del archivo, después del tripwire. Corregido con `afterEach` + `afterAll`. Ver CRITICAL-1 |
| D-5 punto 3 — «los describe de escritura van **al final del archivo, después del tripwire**» | ❌ **No — el propio design se contradice** | esa frase contradice su propia justificación (`shops.integration.test.ts:472-476` dice que el tripwire va ÚLTIMO) y contradice a `tasks.md:114-116` y a la spec, que dicen ANTES. El código hace lo correcto (ANTES) |
| D-6 mapper, módulo y métodos muertos intactos | ✅ Sí | `git diff --stat` lo confirma |

---

## Scope discipline (el «NO incluye» de la US es vinculante)

`git diff 9ac7b4c..HEAD --stat` — 15 archivos, de los cuales **4 son código**:

```text
 apps/api/rest/src/become-seller/become-seller.service.spec.ts    | 172 ++++
 apps/api/rest/src/become-seller/become-seller.service.ts         |  89 +++-
 packages/db/index.ts                                             |   2 +
 packages/db/src/repositories/become-seller.integration.test.ts   | 131 +++-
 packages/db/src/repositories/become-seller.repository.ts         |  60 +++
 docs/product/40-.../44-become-seller-postgres.md                 | 135 +++-
 docs/product/40-.../README.md                                    |   2 +-
 (+ 8 artefactos SDD en openspec/changes/2026-09-15-become-seller-postgres/)
 15 files changed, 2491 insertions(+), 37 deletions(-)
```

| Prohibición | ¿Respetada? |
|---|---|
| No cambiar el contrato HTTP | ✅ controller/módulo/dto/entities sin diff |
| No tocar el frontend | ✅ 0 archivos de `apps/shop` o `apps/admin` |
| `staffs` / `ownership-transfer` / `withdraws` | ✅ 0 archivos |
| No tocar `settings` | ✅ 0 archivos |
| No arreglar la entidad (`missions`) | ✅ sin diff |
| `domain-error.mapper.ts` | ✅ sin diff |

**Disciplina de alcance: ✅ intachable.**

---

## Auditoría de honestidad de las 37 tareas `[x]`

Muestreadas y verificadas contra el código: **36 de 37 honestas**.

| Tarea | Veredicto |
|---|---|
| 1.1 (mock = 11 458 B) | ✅ corroborada — el mock minificado mide exactamente 11 458 B |
| 1.4 (`/api/settings` 5503) | ✅ corroborada — `body.length` = 5503 hoy |
| 2.1-2.4 | ✅ verificadas leyendo el repositorio y el barrel |
| 3.2 | ✅ honesta — la propia tarea documenta la corrección al `afterEach` |
| 3.6 / 3.7 | ✅ verificadas (orden de declaración; aserción idéntica al commit base) |
| 4.1-4.5 | ✅ verificadas (código + `git diff` vacío en módulo/controller/dto/entities) |
| 5.1-5.7 | ✅ verificadas (5 tests corridos por el verificador) |
| 6.1-6.5 | ✅ re-derivadas de forma independiente |
| **6.6** | ⚠️ **evidencia engañosa** — ver WARNING-1 |
| 7.1 | ⚠️ **parcial** — ver WARNING-2 |
| 7.2 / 7.3 | ✅ verificadas (`README.md:30` marcado ✅ Implementada; evidencia pegada en la DoD) |

---

## Issues Found

### CRITICAL

**CRITICAL-1 — La spec `data-layer-clock-policy` describe un mecanismo que el
código no implementa; archivarla tal cual promovería una requirement falsa a
`openspec/specs/`.**

La requirement ADDED dice, literal:

> «Todo `describe` de escritura que ejerza `updateBecomeSeller` MUST restaurar
> explícitamente `pageOptions`, `commissions` y `updatedAt` … **dentro del
> `afterAll` YA EXISTENTE (`:17-19`), en un bloque `try/finally`**.»

y su escenario:

> «THEN la restauración ocurre en un `try/finally` dentro del `afterAll` ya
> existente».

El código restaura en **dos `afterEach`** (`:115`, `:140`) y, adicionalmente,
en el `afterAll` único (`:56`) como red de seguridad. El implementador demostró
—con un rojo real reproducido— que la versión literal de la spec **no puede
funcionar**: un `afterAll` corre una sola vez, al final del archivo, después del
tripwire que vive a mitad de archivo. La decisión de ingeniería es correcta y
está bien documentada; **el defecto es que la spec sigue afirmando lo contrario**.
La invariante que sí se respetó («no crear un segundo `afterAll`») se verificó:
hay exactamente 1.

Además, la spec (y el comentario del código) siguen citando el `describe` por su
nombre viejo, «reloj sin ruta de update», que ya no existe en el archivo (hoy se
llama «reloj en reposo … tripwire»).

**Acción recomendada antes de `sdd-archive`**: actualizar el texto de esa
requirement y sus escenarios para describir `afterEach` (por cada `describe` de
escritura) + `afterAll` (red de seguridad), manteniendo el MUST NOT del segundo
`afterAll`. No requiere tocar código.

**CRITICAL-2 — `design.md` D-5 punto 3 es autocontradictorio y quedó
desalineado con el código.**

Dice que los `describe` de escritura «van **al final del archivo, después del
tripwire de reposo**», e inmediatamente lo justifica con el precedente de
`shops.integration.test.ts:472-476`, que dice justo lo opuesto (el tripwire va
el último). `tasks.md:114-116`, la spec y el código implementan la lectura
correcta (escritura ANTES del tripwire). Es la segunda afirmación segura y
errónea de la fase de diseño en este ciclo. Conviene corregir o anotar el
`design.md` antes de archivarlo como registro histórico.

### WARNING

**WARNING-1 — La evidencia `psql` de la tarea 6.6, pegada en la DoD de la US,
no es reproducible y su rótulo contradice su contenido.**

En `44-become-seller-postgres.md:198-212` el bloque se rotula «comparación a
resolución de milisegundo» pero muestra ambos timestamps con microsegundos
completos (`.858127` en los dos lados) y `en_reposo = t`. Si la consulta
hubiera usado `date_trunc('milliseconds', …)`, las columnas mostradas se verían
`.858`. Estado real medido hoy por el verificador:

```text
 filas |             u              |               c               | reposo_ms | reposo_exacto
-------+----------------------------+-------------------------------+-----------+---------------
     1 | 2026-09-15 17:41:00.858+00 | 2026-09-15 17:41:00.858127+00 | t         | f
```

**Causa mecánica**: `_restoreSeedRow()` se llama **incondicionalmente** también
desde el `afterAll`, así que **toda** corrida de `just db-check` —incluso una
que no mute nada— reescribe `updated_at` con un `Date` de JS y le arranca los
microsegundos de forma permanente. El bloque pegado solo pudo capturarse justo
después de la restauración por SQL directo y **antes** de las «2 corridas de
`db-check` post-evidencia» que el mismo documento reporta más arriba; se
presenta, sin embargo, como el estado «tras la suite». El tripwire de vitest
sigue legítimamente verde (compara `.getTime()`, milisegundos). Riesgo bajo,
pero la evidencia tal como está induce a error a quien la re-ejecute.

**WARNING-2 — La corrección (a) de la Fase 7 quedó a medias: el CA-1 de la US
declara solo la causa de formato, no la causa doble que la spec exige.**

`become-seller-page-api` exige que la divergencia se declare «con causa doble —
no solo de formato»: (a) VALOR (el seed no inserta `created_at`/`updated_at`,
toman `DEFAULT now()`) y (b) FORMATO (24 vs 27 caracteres). El texto de CA-1 en
`44-become-seller-postgres.md:61-70` solo menciona (b). La causa (a) sí aparece
en el bloque de evidencia pegado más abajo (`:137-139`), así que la información
no se perdió, pero el criterio de aceptación en sí quedó incompleto. Corrección
de una frase.

**WARNING-3 — Escenario sin cobertura de ejecución: «`just db-up` no repara
`updated_at` por sí solo».**

Solo hay evidencia estática (`db/seed.sql:35`, verificada por el verificador:
el `ON CONFLICT DO UPDATE SET` lista `page_options`, `commissions` y `language`,
y efectivamente omite `updated_at`). Nadie ejecutó el escenario. Ejercerlo
exigiría mutar la fila y correr `db-up`, lo que no es razonable pedir. Se
documenta como `UNTESTED` deliberado, no como deuda accionable.

**WARNING-4 — `ShopStaffRecord` importable desde el barrel: sin evidencia de
runtime.**

La requirement MODIFIED de `extended-identity-data-layer` cubre los dos tipos.
`BecomeSellerRecord` se importa de verdad desde `@safari/db` en
`become-seller.service.spec.ts:20` (runtime, suite verde). `ShopStaffRecord`
solo tiene el `tsc --noEmit` del `db-check`. Es herencia de US-41, no deuda
introducida aquí.

### SUGGESTION

- **S-1**: `entities/become-seller.entity.ts` sigue declarando `missions`
  (debería ser `commissions`), anida `page_options` un nivel de más y tipa
  `CommissionItem.max_balance` como `number` cuando el dato real es la string
  `"3000"`. **Correctamente NO accionado** — el `NO incluye` de la US lo
  prohíbe. Candidato a US propia.
- **S-2**: `_restoreSeedRow()` podría saltarse la escritura cuando nada mutó
  (comparar con el snapshot antes de escribir); eso evitaría la erosión de
  microsegundos de `updated_at` en cada corrida de `db-check`. Fuera del
  alcance de US-44.
- **S-3**: el comentario del tripwire (`:161-163`) receta
  `UPDATE become_seller SET updated_at = created_at;` como reparación manual;
  funciona, pero el efecto se deshace en la siguiente corrida de `db-check`.
  Merece una línea que lo aclare.

---

## Estado de la base al cerrar

El verificador **escribió** en la fila (`POST` de CA-2/CA-3) y la restauró.
Estado final, idéntico al encontrado al empezar:

```text
 filas |             u              |               c               | reposo_ms |             titulo
-------+----------------------------+-------------------------------+-----------+---------------------------------
     1 | 2026-09-15 17:41:00.858+00 | 2026-09-15 17:41:00.858127+00 | t         | Start Selling In 4 Simple Steps

GET /api/became-seller: HTTP 200 bytes=11452   (byte a byte idéntico al de antes de la prueba)
git status: limpio
```

**No se ejecutó `just db-reset` en ningún momento.**

---

## Verdict

**PASS WITH WARNINGS**

La implementación es correcta, está probada en runtime y respeta el alcance sin
una sola desviación. Los 4 criterios de aceptación cierran en verde con
evidencia re-derivada de forma independiente, y el bound de CA-1 resultó ser
más estrecho de lo que el implementador pudo demostrar (delta de 0 bytes fuera
de los 2 timestamps). Lo que **no** está listo es la documentación SDD: la spec
`data-layer-clock-policy` describe un mecanismo de restauración que el código
deliberadamente no implementa (porque no funciona), y archivarla tal cual
inyectaría una requirement falsa en `openspec/specs/`. Corregir ese texto —más
la frase de CA-1 de la US y el rótulo de la evidencia `psql`— es trabajo de
edición, no de código, y es el único bloqueo real para archivar.
