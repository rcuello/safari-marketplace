# Verification Report — `escrituras-types-fundaciones` (US-27a)

**Fecha:** 2026-09-09
**Rama:** `us-27a/pr2-api` · **HEAD:** `829f510`
**Commits bajo revisión:** `530e713` (PR#1a) · `3c59b0d` (PR#1b) · `829f510` (PR#2)
**Modo de artefactos:** openspec-only (`artifact_store_mode: openspec`; sin Engram)
**Artefactos leídos:** `proposal.md`, `design.md`, `tasks.md`, `apply-progress.md`,
`specs/flat-catalogs-api/spec.md`, `specs/catalog-write-foundations/spec.md`,
`docs/product/26-escrituras-catalogo-postgres/27-escrituras-types-fundaciones.md`,
`openspec/config.yaml`

---

## Veredicto

**PASS WITH FINDINGS**

**`blocking_for_archive`: true**

Los tres gates configurados (`just db-check`, `npx jest`, `just build`) y los
dos adicionales de la DoD (`just build-api`, `just verify`) pasaron con salida
real re-ejecutada por este agente. Las **11 requirements de las dos delta specs
son COMPLIANT** y **CA-1..CA-7 se cumplen**. Sin embargo se encontró **1
hallazgo CRITICAL**: la rama 503 del mapeador —la corrección B1 del gate de
diseño, señalada por el propio épico como el defecto más sutil que este change
debía arreglar— **no funciona contra un fallo de conexión real**. Se comprobó
apagando Postgres: las tres rutas de escritura devuelven **500**, no 503,
mientras la ruta de lectura (que usa la cadena vieja) sí devuelve 503. El test
unitario que "prueba" el 503 usa una fixture sintética que no corresponde a la
forma real del error que emite Prisma 7 + `@prisma/adapter-pg`.

Ninguna requirement de las delta specs queda literalmente violada por ese
hallazgo (un fallo de conexión no es un error de dominio), por lo que el
veredicto no es `FAIL`. Se marca `blocking_for_archive: true` porque el
workflow solo permite archivar sin hallazgos CRITICAL; el orquestador puede
degradar C-1 a WARNING si decide que el par 503/500 ante una caída de la base
queda fuera del alcance de US-27a — pero esa decisión debe ser explícita, no
implícita.

---

## Evidencia de gates (re-ejecutada, nada copiado de `apply-progress.md`)

| Gate | Comando | Baseline previo | Resultado real | Exit |
|---|---|---|---|---|
| Build de `packages/db` (bloqueante) | `just db-build` | — | Prisma Client 7.10.0 generado + tsup CJS/DTS OK | **0** |
| Tests de datos | `just db-check` | 8 archivos / 91 tests | **9 archivos / 111 tests, 9 passed / 111 passed** | **0** |
| Tests de API | `cd apps/api/rest && npx jest` | 4 suites / 65 tests | **6 suites / 91 tests, 6 passed / 91 passed** | **0** |
| Build de API | `just build-api` | — | `nest build` limpio, `Done in 26.09s` | **0** |
| Build de producción (config `rules.verify.build_command`) | `just build` | — | shop + admin compilados, `Done in 106.96s` | **0** |
| Smoke de servicios | `just verify` | — | `OK API :9001/api/settings 200 5503B` · `OK Shop :3003/en 200 191456B cards:30` · `OK Admin :3002/en/login 200 72821B cards:1` | **0** |
| Re-corrida post-limpieza | `just db-check` | — | 9 archivos / 111 tests | **0** |

Los recuentos reportados por el agente de apply (9/111 y 6/91) **se confirman**.

---

## Hallazgos

### CRITICAL

#### C-1 — La rama 503 de `toWriteHttpException` no dispara ante una caída real de Postgres

**Archivo:** `apps/api/rest/src/common/errors/domain-error.mapper.ts:41-48, 50-55, 91-111`
**Test que da falso verde:** `apps/api/rest/src/common/errors/domain-error.mapper.spec.ts:96-118`
**Diseño afectado:** `design.md` Decisión 3 (paso 2) y corrección de gate **B1**; `tasks.md` 3.1

**Qué se hizo.** Se detuvo el contenedor (`docker stop safari-postgres`) y se
llamaron las tres rutas de escritura con token `super_admin`:

```
--- POST /api/types con la base caida (esperado 503)
{"statusCode":500,"message":"Ocurrió un error inesperado. Por favor, contacta al administrador.","error":"Internal Server Error"}  HTTP=500
--- PUT /api/types/35 con la base caida
{"statusCode":500,"message":"Ocurrió un error inesperado. Por favor, contacta al administrador.","error":"Internal Server Error"}  HTTP=500
--- DELETE /api/types/35 con la base caida
{"statusCode":500,"message":"Ocurrió un error inesperado. Por favor, contacta al administrador.","error":"Internal Server Error"}  HTTP=500
```

Contraste con la ruta de **lectura**, que sigue usando la cadena vieja
`isPrismaConnectionError` y en la misma ventana devolvió lo correcto:

```
=== GET /api/types (ruta de LECTURA, cadena vieja) ===
{"statusCode":503,"message":"No se puede conectar con el servicio. Por favor, intenta más tarde.","error":"Service Unavailable"}  HTTP=503
```

**Causa raíz.** Se capturó la forma real del error que emite el stack de este
repo (Prisma 7 + `@prisma/adapter-pg`) con la base caída:

```
constructor: PrismaClientKnownRequestError
name:        PrismaClientKnownRequestError
code:        "ECONNREFUSED"
message:     "\nInvalid `prisma.$queryRaw()` invocation:\n\n\n"
```

`isConnectionFailure` no lo reconoce por ninguna de sus tres vías:

- `name !== 'PrismaClientInitializationError'`;
- `code === 'ECONNREFUSED'` **no está** en `CONNECTION_FAILURE_CODES`
  (`{P1001, P1002, P1008, P1011, P1017, P2024}`);
- el `message` real no contiene ninguno de los cuatro patrones
  (`can't reach database server`, `connection refused`, `connection timeout`,
  `econnrefused`) — el patrón `econnrefused` existe pero solo se compara contra
  el **message**, nunca contra el **code**, que es justamente donde vive.

Cae por tanto a la rama 3 (500 con mensaje literal).

**Por qué importa.**

1. B1 fue una **corrección exigida por el gate de diseño**: `errors.ts:62` marca
   como "conexión" cualquier `PrismaClientKnownRequestError` (sobre-503). El
   mapeador nuevo corrige ese lado —verificado, ver más abajo— pero al hacerlo
   deja el otro lado **completamente muerto**: hoy no existe ningún error real
   en este stack capaz de producir un 503 por las rutas de escritura.
2. El test que respalda la rama 503 pasa porque su fixture
   (`{code:'P1001', message:"Can't reach database server..."}`) no corresponde a
   lo que el runtime produce. El design afirmó por escrito que la fixture
   estructural "es fiel" (*Testing Strategy*); esa premisa queda **refutada
   empíricamente**.
3. La consecuencia operativa es una degradación de diagnóstico: una caída de la
   base se le reporta al admin como "error inesperado, contacta al
   administrador" en vez de "servicio no disponible, intenta más tarde", y la
   **misma request** obtiene 503 si es de lectura y 500 si es de escritura.
4. Cuatro US más (`27b`, `28`, `29`, `30`) van a heredar este mapeador **sin
   poder editarlo** (CA-7). El defecto se multiplica por cinco agregados si no
   se corrige aquí.

**Lo que NO es.** No viola literalmente ninguna requirement: el conjunto cerrado
de 5 códigos de dominio mapea bien (verificado), y "ningún **error de dominio**
resulta en 500" se cumple. Tampoco es una regresión frente al código previo (las
escrituras antiguas eran stubs en memoria que nunca tocaban la base).

**Nota sobre el lado que SÍ funciona.** La mitad "no heredar el sobre-503" está
verificada en runtime por jest: `isPrismaConnectionError({name:'PrismaClient
KnownRequestError', code:'P2011'})` devuelve `true` (assert de caracterización)
y `toWriteHttpException` del mismo objeto devuelve **500** con el mensaje
literal. Esa parte de B1 es correcta.

---

### WARNING

#### W-1 — PR#2 casi duplica el presupuesto de revisión de 400 líneas; el total de la US supera el forecast en +60 %

Medición real (excluyendo `openspec/**`, que son artefactos SDD):

| Commit | Slice | Añadidas | Borradas | **Cambiadas** | Forecast `tasks.md` | Presupuesto 400 |
|---|---|---|---|---|---|---|
| `530e713` | PR#1a | 387 | 0 | **387** | ~245 | dentro |
| `3c59b0d` | PR#1b | 311 | 6 | **317** | ~240 | dentro |
| `829f510` | PR#2 | 733 | 25 | **758** | ~410 | **+89 % por encima** |
| — | **Total US** | **1431** | **31** | **1462** | **~915** | **+60 % sobre el forecast** |

Los números que reportó el agente de apply (387 / 317 / 758) **son exactos**; el
problema no es la medición sino que el corte en tres slices no evitó que PR#2
reventara el presupuesto. El desvío se concentra en dos archivos creados:
`types.service.spec.ts` **331 líneas** (design: ~145) y
`domain-error.mapper.spec.ts` **159** (design: ~85). El total de la US (1462)
cruza con holgura el umbral de ~900 del propio épico. Es carga de revisión, no
un defecto funcional; se registra porque el guard E de
`sdd-phase-common.md` existe precisamente para esto.

#### W-2 — La DoD item 10 no se hizo: la US y la fila del épico siguen en "Listo para ejecución"

`docs/product/26-escrituras-catalogo-postgres/27-escrituras-types-fundaciones.md:12`
sigue diciendo `**Status:** Listo para ejecución`, la fila del épico
(`README.md:150`) sigue igual, y **los 10 checkboxes de la DoD de la US siguen
en `- [ ]`**. `tasks.md` no tiene ninguna tarea que cubra ese ítem, así que no
es una tarea marcada en falso — es un ítem de la DoD sin cerrar.

Atenuante: el precedente del repo pone ese cierre en un commit propio posterior
a la implementación (`5af928c` "Documenta y cierra US-25 y el Epico 19",
separado del commit de archive `ff0c0d4`). Si el orquestador asigna ese paso al
cierre/archive, este WARNING se resuelve ahí; si no, queda pendiente.

#### W-3 — La sesión de apply dejó vivo un supervisor `nest start --watch` que volvió a ocupar el 9001

El brief de este verify afirmaba que 9001 estaba libre. No lo estaba: al iniciar
había un proceso escuchando (PID 32780), hijo de un
`yarn start:dev → nest start --watch` **creado el 2026-09-09 a las 09:50:34** y
todavía vivo a las 16:18. Su hijo se re-creó a las **16:18:56**, justo cuando mi
`just db-build` tocó archivos — es decir, el supervisor siguió re-bindeando el
puerto durante horas.

`apply-progress.md` afirma: *"all confirmed killed before the run ended … Final
`netstat` … returned no `LISTENING` lines"*. Lo más probable es que se matara el
**hijo** y no el supervisor, con lo que el `netstat` final fue verdadero en ese
instante pero el orphan sobrevivió. Lo maté (`taskkill /PID 1320 /T /F`) antes
de verificar.

Además queda **otro orphan más antiguo**: PID **35484**, `nest start --watch`
creado el **2026-09-08 14:14**, sin puerto asignado hoy. **No lo maté** (es
pre-existente, anterior a esta US, y no bloquea nada), pero puede re-bindear el
9001 en cualquier momento en que cambie `src/`. Recomendado:
`taskkill //PID 35484 //T //F`.

---

### SUGGESTION

- **S-1 — `translateCatalogWriteError` usa `uniqueField` como nombre de campo en
  la rama P2003.** `packages/db/src/domain-errors.ts:150-156`: si Prisma no trae
  `meta.field_name`, el mensaje del `InvalidReferenceError` sale como
  `` `tags.slug` referencia un registro inexistente `` porque el fallback es
  `context.uniqueField` (que semánticamente es el campo *único*, no la FK). No
  obliga a US-27b a editar el archivo compartido (solo cambia el `context` del
  call site), así que no compromete CA-7, pero el mensaje será engañoso en el
  primer productor real de `InvalidReference`.
- **S-2 — La divergencia 7 del design es imprecisa.** Verificado en runtime:
  `PUT /api/types/:id {"icon": null}` **sí** limpia el icono (200, columna a
  `NULL`), y `PUT` sin la clave lo deja intacto. O sea: lo imposible no es
  "limpiar el icono por la API", sino "limpiarlo desde `group-form.tsx`", que
  omite la clave. La conclusión de la divergencia (no accionar, es decisión 14
  del épico) sigue siendo correcta; solo la redacción sobre-generaliza.
- **S-3 — El 400 de `EmptySlugError` refleja el texto crudo del cliente.**
  `El texto \`!!!\` de \`types\` normaliza a un slug vacío.` Va JSON-encodeado,
  así que no hay riesgo de inyección en la respuesta, pero si el panel lo
  renderiza como HTML sería un reflejo de input. Muy bajo riesgo; se anota.
- **S-4 — Ruido de log en el 404 de `PUT`.** El P2025 hace que el logger propio
  de Prisma (`client.ts:17-21`, `log: ['error']`, **no tocado por este change**)
  imprima un bloque `prisma:error` con code-frame. Se verificó que **no hay ni
  un solo frame de stack JS** en el log de la API (`grep -cE '^\s+at ' = 0`), así
  que CA-4 se cumple en sentido estricto; es ruido, no un stack.
- **S-5 — `apps/shop/public/sitemap-0.xml` es un artefacto de build versionado.**
  `just build` lo reescribe (273 inserciones / 266 borrados, solo timestamps y
  orden). Pre-existente, ajeno a esta US. Lo restauré con `git checkout --` para
  dejar el árbol limpio.
- **S-6 — Dos cadenas de fallback conviven en `types.service.ts`.**
  `getTypes`/`getTypeBySlug` usan `isPrismaConnectionError`;
  `create`/`update`/`remove` usan `toWriteHttpException`. Es el límite de alcance
  declarado (D-4), ya mencionado por el agente de apply como adyacente no
  accionado. C-1 le da un matiz nuevo: hoy la cadena **vieja** es la que
  clasifica mejor la caída de la base.

---

## Matriz CA (US-27a)

| CA | Veredicto | Evidencia (re-ejecutada) |
|---|---|---|
| **CA-1** — Crear persiste y responde con la proyección del `GET` | **COMPLIANT** | `POST /api/types` → **201**, 9 claves. `Object.keys()` sin `.sort()`: `["id","name","language","translated_languages","slug","banners","promotional_sliders","settings","icon"]` — **idéntico y en el mismo orden** al del `GET /api/types/vertical-prueba`. Se mató el proceso (PID 21072), se confirmó 9001 libre, se levantó uno nuevo (PID 60604) y el `GET` posterior devolvió **200** con la fila y el mismo key-set. `psql`: fila 34 presente con `settings`/`banners`/`icon`/`language` persistidos. |
| **CA-2** — Editar persiste y no cambia el slug | **COMPLIANT** | `PUT /api/types/34 {"name":"Vertical Renombrada","slug":"intento-de-cambiar-slug"}` → **200**, `slug:"vertical-prueba"` (el `slug` entrante se ignora). `psql` antes: `updated_at = 21:23:55.832+00`; después: `21:26:44.292+00`, `updated_at > created_at = t`. Verificado además que `PUT` sí actualiza **todos** los campos con columna (`settings`, `banners`, `language`, `icon`) contra `psql`. |
| **CA-3** — Borrar está protegido | **COMPLIANT** | `DELETE /api/types/9` → **409** `"…tiene filas dependientes (10 categories, 44 products)"`. `psql` antes y después: `products.type_id=9` = **44 → 44**, `categories.type_id=9` = **10 → 10**, `count(types)` sin cambio. **Prueba de que la protección tiene dientes:** `pg_constraint` confirma `categories.type_id → CASCADE`, `products.type_id → CASCADE` (54 filas que el borrado habría destruido) y `manufacturers/tags.type_id → SET NULL`. Borrado sin dependientes (id 34) → **200** con las 9 claves; `GET /api/types/vertical-prueba` posterior → **404**; segundo `DELETE` del mismo id → **404**. |
| **CA-4** — Errores de dominio, nunca 500 | **COMPLIANT** | `PUT /99999` → 404 · `DELETE /99999` → 404 · `PUT /abc` → 404 (`NaN`, sin tocar el repositorio) · `DELETE /abc` → 404 · `POST {}` → 400 · `POST {"name":""}` → 400 · `POST {"name":null}` → 400 · `POST {"name":"!!!"}` → 400 · `PUT {"name":""}` → 400 · `PUT {"name":null}` → 400 (capa 2, tal como predijo B2) · `PUT {"name":"!!!"}` → 400. `psql`: fila 34 intacta tras los 400 y `count(types)` sin filas espurias. Colisión: `POST {"name":"Gadget"}` → **201 `slug:"gadget-2"`**, repetido → **201 `slug:"gadget-3"`**. **0 frames de stack** en el log de la API. |
| **CA-5** — Permisos intactos | **COMPLIANT** | Tokens reales acuñados vía `POST /api/token` (`demodemo`). Sin token: `POST`/`PUT`/`DELETE` → **401/401/401**. `customer@demo.com` → **403/403/403**. `store_owner@demo.com` → **403/403/403**. `types.controller.ts` sin cambios (`git diff` vacío). |
| **CA-6** — Sin mock huérfano ni regresión | **COMPLIANT** | `grep -n "fuse\|@db/" apps/api/rest/src/types/types.service.ts` → **0 líneas** (exit 1). `findAll`/`findOne`/`plainToClass`/`private types` → 0 coincidencias. El controlador solo invoca `create`/`getTypes`/`getTypeBySlug`/`update`/`remove`. Assert nuevo `prisma.type.count() === 10` presente (`types.integration.test.ts:181-185`) y verde. Tras toda la corrida: `SELECT count(*) FROM types` = **10** y `GET /api/types` = **10 ítems** con las 9 claves. `just db-check` re-corrido post-limpieza: 9/111 verde. |
| **CA-7** — Piezas listas para US-27b/28/29/30 | **COMPLIANT** | Lectura de código: `slug.ts`, `domain-errors.ts` y `common/errors/domain-error.mapper.ts` **no contienen ni un literal `'types'`, ni un `switch (aggregate)`, ni un `if (aggregate === …)`** (las únicas apariciones de la palabra son comentarios). `aggregate`/`field`/`id` son parámetros de constructor en las 5 clases; la tabla del mapeador conmuta por `code`, no por agregado; el nombre de tabla **nunca** llega al SQL (`ExistingSlugLookup` es una función construida en el repositorio del agregado). Los 8 símbolos compartidos están exportados desde `packages/db/index.ts` y consumidos por un caso real (`types`). Tests cubren tildes, vacío y colisión. **Salvedad:** C-1 significa que las cuatro US siguientes heredarán un 503 muerto en un archivo que su propia CA-7 les prohíbe editar. |

---

## Compliance por requirement — delta `flat-catalogs-api`

| Requirement / Scenario | Veredicto | Evidencia |
|---|---|---|
| **R1** Escritura de `types` reutiliza la proyección de lectura (CA-1, CA-2) | **COMPLIANT** | Key-set de 9 idéntico y en orden en `POST`/`PUT`/`DELETE` vs `GET` (comparado con `node -e`, sin `.sort()`); `updated_at` avanza en la **columna** (evidencia por `psql`, como fija la nota de contrato); fila sobrevive al reinicio del proceso |
| ↳ Scenario: CA-1 — la vertical creada sobrevive al reinicio | **COMPLIANT** | Proceso 21072 matado, 9001 confirmado libre, proceso 60604 nuevo, `GET` → 200 + 9 claves |
| ↳ Scenario: CA-2 — renombrar persiste y no cambia el slug | **COMPLIANT** | `slug:"vertical-prueba"` + `name:"Vertical Renombrada"`, 9 claves sin `updated_at`, `psql` muestra el avance |
| **R2** Borrado de `types` protegido por dependientes (CA-3) | **COMPLIANT** | 409 + conteos 44/10 intactos; 200 + 404 posterior en el caso sin dependientes |
| ↳ Scenario: CA-3 — vertical con productos protegida | **COMPLIANT** | `DELETE /api/types/9` → 409, `psql` antes/después idéntico |
| ↳ Scenario: CA-3 — vertical sin dependientes se borra | **COMPLIANT** | `DELETE /api/types/34` → 200 (9 claves), `GET` → 404 |
| **R3** Errores de dominio de `types` nunca producen 500 (CA-4) | **COMPLIANT** | 11 casos de error ejercitados: 404/400 según corresponde, 0 respuestas 500, 0 frames de stack |
| ↳ Scenario: CA-4 — id inexistente | **COMPLIANT** | `PUT`/`DELETE /99999` → 404, log sin stack |
| ↳ Scenario: CA-4 — nombre que slugifica a vacío | **COMPLIANT** | `POST {"name":"!!!"}` → 400; `psql` sin fila nueva |
| ↳ Scenario: CA-4 — colisión de slug no es error | **COMPLIANT** | 201 con `slug:"gadget-2"` (y `gadget-3` en la segunda) |
| **R4** Permisos de escritura sin cambios (CA-5) | **COMPLIANT** | Matriz 401/403/403 en las 3 rutas; decoradores intactos |
| ↳ Scenario: CA-5 — matriz de permisos | **COMPLIANT** | 9 llamadas, resultados exactos |
| **R5** Sin mock huérfano ni regresión de lectura (CA-6) | **COMPLIANT** | grep 0 líneas; `findAll`/`findOne` eliminados; conteo 10 estable; assert nuevo presente y verde |
| ↳ Scenario: CA-6 — sin imports huérfanos | **COMPLIANT** | `grep` exit 1 |
| ↳ Scenario: CA-6 — el conteo de lectura no cambia | **COMPLIANT** | `just db-check` 9/111 verde, `count(types)` = 10 |
| **MODIFIED Out of Scope** (reemplazo de prosa de cabecera) | **NOT APPLICABLE en verify** | `openspec/specs/flat-catalogs-api/spec.md` sigue sin tocar (último commit `795fd00`, de US-5), que es lo correcto: el merge de prosa lo aplica `sdd-archive` a mano, con el precedente ya citado en el propio delta |

## Compliance por requirement — delta `catalog-write-foundations`

| Requirement / Scenario | Veredicto | Evidencia |
|---|---|---|
| **CW1** Slug generado en servidor a partir de `slug` o `name` (CA-7) | **COMPLIANT** | `slug.integration.test.ts:33-43` compara los 3 nombres con tildes contra `SELECT slugify($1)` — verde en `just db-check`. Runtime: `POST {"name":"Café & Té"}` (UTF-8 vía `fetch`) → `slug:"cafe-te"`, idéntico a `SELECT slugify('Café & Té')`. Firma genérica: `normalizeSlug(text, aggregate)` / `generateSlug(source, lookup, aggregate)` |
| ↳ Scenario: nombre con tildes normaliza igual que la función SQL | **COMPLIANT** | vitest (3 casos) + comprobación runtime |
| ↳ Scenario: `slug` explícito gana sobre `name` | **COMPLIANT** | `slug.integration.test.ts:70-77`; runtime `POST {"name":"Vertical Prueba","slug":"vertical-prueba"}` |
| **CW2** Colisión resuelve con sufijo numérico incremental (CA-4, CA-7) | **COMPLIANT** | vitest `gadget → gadget-2` y `gadget + gadget-2 → gadget-3` con lookup **en memoria** (cumple B4: el archivo no toca la tabla `types`); runtime idem, 201 en ambos |
| ↳ Scenario: primera colisión → `-2` | **COMPLIANT** | vitest + `curl` 201 `gadget-2` |
| ↳ Scenario: colisiones sucesivas incrementan | **COMPLIANT** | vitest + `curl` 201 `gadget-3` |
| **CW3** Nombre que slugifica a vacío es error de dominio (CA-4, CA-7) | **COMPLIANT** | `slug.integration.test.ts:102-112` prueba que el lookup **no se invoca** (`lookupCalled === false`); `types.integration.test.ts:118-132` prueba fila intacta tras `EmptySlugError`; runtime 400 + `psql` sin fila |
| ↳ Scenario: `name` solo símbolos | **COMPLIANT** | vitest + `POST {"name":"!!!"}` → 400, `count(types)` sin cambio |
| **CW4** Slug inmutable tras la creación (CA-2, CA-7) | **COMPLIANT** | `types.integration.test.ts:97-116`; `UpdateTypeInput = Omit<CreateTypeInput,'slug'>`; runtime: `PUT` con `slug` explícito lo ignora |
| ↳ Scenario: actualizar `name` no toca el slug | **COMPLIANT** | vitest + `curl` |
| **CW5** Contrato dominio → HTTP, conjunto cerrado de 5 códigos (CA-4, CA-7) | **COMPLIANT** | `domain-error.mapper.spec.ts:43-86` prueba **los 5 códigos directamente**: 400/400/404/409/409, verde en jest. La implementación es un `switch` sobre `error.code` (`domain-error.mapper.ts:64-81`), sin ramas por agregado. Ningún error de dominio produce 500 (los 3 alcanzables por HTTP verificados en runtime) |
| ↳ Scenario: cada uno de los 5 códigos mapea a su status | **COMPLIANT** | 5 tests unitarios verdes |
| ↳ Scenario: `types` ejercita 3, pero los 5 están probados | **COMPLIANT** | `InvalidReference` y `SlugConflict` probados directo sin ruta HTTP |
| **CW6** Piezas listas para consumo sin reabrir el archivo (CA-7) | **COMPLIANT (con salvedad C-1)** | 8 símbolos exportados desde `packages/db/index.ts` + `mapDomainError`/`toWriteHttpException` desde el módulo de errores de la API; consumidos por `types` sin wrappers ni ramas condicionales. **Salvedad:** el defecto C-1 vive dentro de una de esas piezas cerradas |
| ↳ Scenario: un caso real consume ambas piezas sin adaptadores | **COMPLIANT** | `types.repository.ts:84-88, 124, 103-106` y `types.service.ts:114, 146, 159` — llamadas directas |
| ↳ Scenario: agregar un agregado nuevo es un call site | **COMPLIANT (juicio de código)** | Ver "CA-7 — análisis de cierre" abajo |

---

## CA-7 — análisis de cierre (juicio de lectura de código, no runtime)

Pregunta: ¿pueden `tags`/`manufacturers` (US-27b) integrarse **sin editar**
`packages/db/src/slug.ts`, `packages/db/src/domain-errors.ts` y
`apps/api/rest/src/common/errors/domain-error.mapper.ts`?

**Sí.** Evidencia concreta:

- **Cero literales del agregado.** `grep` de `'types'`/`"types"`/`aggregate ===`
  /`switch (aggregate` en los tres archivos: solo aparece la palabra dentro de
  comentarios. Los mensajes se componen con `aggregate` y `field` recibidos por
  constructor (`domain-errors.ts:41-104`).
- **La tabla nunca llega al SQL.** `generateSlug` recibe una `ExistingSlugLookup`
  —una función construida en el repositorio del agregado
  (`types.repository.ts:58-64`)—, no un identificador de tabla. Añadir `tags` es
  literalmente copiar esas 5 líneas cambiando `prisma.type` por `prisma.tag`.
- **Un solo lugar conoce códigos de Prisma.** `translateCatalogWriteError` recibe
  `{aggregate, id, uniqueField}` por parámetro; `InvalidReferenceError` ya acepta
  `field`, así que el `type_id` de `tags` (primer productor real de
  `InvalidReference`) no obliga a tocar el archivo.
- **El mapeador HTTP conmuta por `code`.** `mapDomainError` es un `switch` sobre
  las 5 constantes; el guard es estructural (por `code`, no `instanceof`), lo que
  además lo hace sobrevivir a mocks del barrel y a dos copias del build — patrón
  ya ejercitado por `types.service.spec.ts`, que mockea `@safari/db` y aun así
  obtiene 400/404/409 correctos.

**Riesgos residuales para US-27b (no bloquean CA-7):** S-1 (fallback de
`field` en P2003) y C-1 (503 muerto), ambos heredados sin posibilidad de
corregirlos desde el lado de `tags`.

---

## Verificación de tareas (`tasks.md` — 15 tareas, todas marcadas `[x]`)

| Tarea | ¿Ocurrió de verdad? | Comprobación |
|---|---|---|
| 1.1 `slug.ts` | **Sí** | Archivo existe (97 líneas), guard `typeof/trim`, `SELECT slugify($1)` por tagged template, hueco en memoria acotado por `taken.size + 2`, sin `if (aggregate === …)` |
| 1.2 `domain-errors.ts` | **Sí** | 163 líneas: `CATALOG_ERROR_CODES` (5), base abstracta, 5 clases con `aggregate`/`field`/`id` por parámetro, guard estructural por `code`, `translateCatalogWriteError` (P2002/P2003/P2025 → resto intacto). `packages/db/src/errors.ts` **sin tocar** (`git diff` vacío) |
| 1.3 Barrel (slug + errores) | **Sí** | `git diff` de `packages/db/index.ts` muestra los 9 símbolos de errores + `generateSlug`/`normalizeSlug` + tipos |
| 1.4 `slug.integration.test.ts` | **Sí** | 113 líneas; **no lee ni escribe `types`** (verificado: los únicos `prisma.type.*` del paquete están en `types.repository.ts` y en `types.integration.test.ts`) — B4 cumplido |
| 1.5 Verificación PR#1a | **Sí (re-ejecutada)** | `just db-check` verde |
| 2.1 Escrituras del repositorio | **Sí** | `createType`/`updateType`/`deleteType` con spread condicional, `updatedAt: now()` de `clock.ts`, `findUnique` → `RecordNotFoundError`, `Promise.all` de dos `count()`, `catch` con `translateCatalogWriteError` en los tres |
| 2.2 Barrel (escrituras) | **Sí** | `createType`/`updateType`/`deleteType` + `CreateTypeInput`/`UpdateTypeInput` exportados |
| 2.3 `types.integration.test.ts` | **Sí** | Centinela `zz-types-` (distinto de `zz-test-`), `cleanup` en `beforeAll` y **dentro** del `afterAll` existente en `try/finally` antes de `$disconnect`, `_setNowProvider` restaurado en `afterEach`, `deleteType(9)` con los dos conteos, id inexistente, y el assert de cierre `prisma.type.count() === 10` |
| 2.4 Verificación PR#1b | **Sí (re-ejecutada)** | `just db-build` + `just db-check` verdes |
| 3.1 `domain-error.mapper.ts` | **Sí, con el defecto C-1** | Tabla cerrada correcta; `isConnectionFailure` es local y privado y **no** mira `PrismaClientKnownRequestError`; 500 con literal fijo. El conjunto de códigos/patrones **no cubre el error real** (C-1) |
| 3.2 `domain-error.mapper.spec.ts` | **Sí** | Los 5 códigos + 503 (fixtures sintéticas) + 500 con fixture Prisma-shaped + assert de caracterización sobre `isPrismaConnectionError`. Sin `jest.mock`, sin import de `@prisma/client` |
| 4.1 `create-type.dto.ts` | **Sí** | `PickType(Type, [...7])` + `@IsString() @IsNotEmpty() name`. `update-type.dto.ts`, `type.entity.ts` y `main.ts` sin tocar (`git diff` vacío) |
| 4.2 `types.service.ts` | **Sí** | Proyección campo a campo, cast `as unknown as Prisma.InputJsonValue` (**cero `as any`** en el archivo), guard `Number.isInteger`, `catch → toWriteHttpException`, `toTypeDto` reutilizado sin cambios |
| 4.3 `types.service.spec.ts` | **Sí** | Arnés `jest.mock('@safari/db', …)`; compara `Object.keys()` de las 3 escrituras contra `getTypeBySlug` **sin `.sort()`**; `EmptySlug`/`RecordNotFound`/`DependentRows`/`P1001`/`P2011` y `+id` no entero |
| 4.4 / 5.1–5.6 Evidencia E2E | **Sí, re-ejecutada íntegramente** | Toda la secuencia `POST → GET → reinicio → GET → PUT → GET → DELETE → GET 404` rehecha por este agente; limpieza por id y `db-check` posterior verdes |

**Ninguna tarea marcada en falso.** Todas se corresponden con código y con
comportamiento observado.

---

## Coherencia con el diseño (design drift)

| Punto del diseño | Estado |
|---|---|
| Decisión 1 — slug vía `SELECT slugify($1)` (Opción B) | **Implementado**; tagged template, sin `$queryRawUnsafe` |
| Decisión 2 — genéricas por firma, tabla nunca en el SQL | **Implementado y verificado** (ver CA-7) |
| Decisión 3 — tabla cerrada + traductor único de Prisma | **Implementado**; `errors.ts` intacto |
| Decisión 3 / **corrección B1** — cadena `dominio → 503 → 500` | **PARCIAL — C-1.** El lado "no heredar el sobre-503" funciona (probado en jest y por lectura); el lado "el 503 sigue funcionando" **no** funciona contra la caída real |
| Decisión 4 — `deleteType`: dos conteos, sin transacción, TOCTOU declarado | **Implementado**; el TOCTOU es real (secuencia `findUnique` → `count` → `delete` sin `$transaction`, `types.repository.ts:158-182`) y sigue siendo el riesgo bajo declarado |
| Decisión 5 — `jsonb`: omitir la clave, nunca `null` | **Implementado y probado** (`types.integration.test.ts:80-89`: `settings={}`, `banners=[]`, `language='es'` por DEFAULT) |
| Decisión 6 — `updatedAt` explícito, slug inmutable, `+id` no numérico | **Implementado y verificado en runtime** |
| Decisión 7 (B2/B3) — dos capas para `name` vacío | **Implementado y verificado**: capa 1 da 400 en `POST {}` / `{"name":""}`; capa 2 atrapa `"!!!"` y **`null`** (predicción exacta de B2 confirmada en runtime) |
| Decisión 8 — `PickType` sobre la entidad | **Implementado** |
| Decisión 9 — limpieza de `types.service.ts` | **Implementado** (`grep` 0 líneas) |
| B4 — `slug.integration.test.ts` no toca `types` | **Implementado y verificado** |
| B5 — limpieza por id | **Implementado** (usada en esta verificación) |
| B6 / B7 — evidencia de `updated_at` por `psql`; 5 firmas fijadas | **Cumplidos** |
| Divergencia 4 — `slug.test.ts` → `slug.integration.test.ts` | **Real y declarada** |
| Divergencia 5 — helper recibe función, no nombre de tabla | **Real y declarada** |
| *Testing Strategy* — "la fixture estructural es fiel" | **REFUTADA** — ver C-1 |
| Forecast de volumen PR#2 ~410 | **Superado** (758) — ver W-1 |

---

## Divergencias declaradas — comprobación

| Divergencia declarada | ¿Real y vigente? | Evidencia |
|---|---|---|
| `promotional_sliders` aceptado e ignorado (sin columna) | **Sí** | `information_schema.columns` de `types`: 9 columnas, ninguna `promotional_sliders`. `POST` con el campo → 201; la respuesta lo emite como `null` constante; nada se persiste |
| `icon` no se puede vaciar por `PUT` | **Sí, con matiz (S-2)** | `PUT` sin la clave deja `icon` intacto (confirmado). Pero `PUT {"icon":null}` **sí** lo limpia (200, columna `NULL`). La imposibilidad es del formulario, no de la API |
| `manufacturers.type_id`/`tags.type_id` a `NULL` en silencio tras un borrado exitoso | **Sí — probado en vivo** | Se insertó `manufacturers(slug='zz-verify-manu', type_id=36)`; `DELETE /api/types/36` → **200** (no cuenta para el 409) y el manufacturer quedó con `type_id = NULL`. Fila de prueba borrada después |
| Ventana TOCTOU de `deleteType` | **Sí** | Lectura de código: `findUnique` → `Promise.all(count, count)` → `delete`, sin transacción interactiva |
| `created_at`/`updated_at` (3 vs 6 decimales, fechas del `db-up`) | **Sin impacto aquí** | `toTypeDto` no emite timestamps: las 9 claves no incluyen ninguno, así que la divergencia no es observable por este contrato |
| Primer `createType` con id ≠ 12 | **Sí** | `types_id_seq` ya iba avanzada; mi primer `POST` obtuvo id **34**. Ninguna aserción depende de un id concreto |

---

## Disciplina de alcance

`git diff --name-only eb5f222..HEAD` devuelve exactamente **13** archivos: los
**11 de la tabla *File Changes* del diseño** (con `slug.test.ts` →
`slug.integration.test.ts`, divergencia 4 declarada) más `tasks.md` y
`apply-progress.md`, que son artefactos SDD esperados. **Cero scope creep.**

Confirmado intacto (`git diff` vacío en los tres commits):
`packages/db/src/errors.ts` · `db/schema.sql` · `db/seed.sql` ·
`packages/db/prisma/schema.prisma` · `apps/api/rest/src/main.ts` ·
`types.controller.ts` · `entities/type.entity.ts` · `dto/update-type.dto.ts` ·
`apps/api/rest/package.json` · `products.repository.ts` · `apps/shop/**` ·
`apps/admin/**` (0 archivos).

El "NO incluye" de la US se respetó: no hay nada de `tags`, `manufacturers`,
`categories`, `products` ni `shops`; no se refactorizaron los
`isPrismaConnectionError` de las lecturas; no se tocó `create-tag.dto.ts`; no se
añadió trigger de `updated_at`.

---

## NOT VERIFIED

Se declara explícitamente lo que **no** se pudo comprobar. Nada de esto se
infiere como aprobado.

1. **`SlugConflictError` (409 por P2002) en runtime.** Solo alcanzable por una
   carrera de dos `POST` concurrentes con el mismo nombre; no es determinista
   por HTTP. Está probado directamente en el spec unitario del mapeador (400/409
   correctos) y en la traducción P2002 → `SlugConflictError`, pero **el camino
   completo repositorio → HTTP nunca se ejecutó**. El propio diseño lo declara
   así.
2. **`InvalidReferenceError` (400 por P2003) en runtime.** `types` no tiene FK
   saliente; su primer productor real es `tags.type_id` en US-27b. Probado solo
   a nivel unitario.
3. **Comportamiento concurrente del TOCTOU de `deleteType`.** No se intentó
   reproducir la carrera (insertar un producto entre el `count` y el `delete`).
   Se aceptó como riesgo bajo declarado por el diseño; queda sin evidencia
   empírica.
4. **`PUT` con `banners`/`settings` malformados (JSON no objeto/array).** No
   ejercitado; el `ValidationPipe` no valida esos campos y el resultado
   dependería de Prisma. No lo pide ninguna requirement.
5. **Comportamiento del panel de admin real (`group-form.tsx` /
   `group-delete-view.tsx`) contra las nuevas rutas.** Se verificó que
   `just verify` levanta el admin con contenido real y que el contrato de 9
   claves incluye `slug` (que `apps/admin/rest/src/data/type.ts:52-56` consume),
   pero **no se hizo un recorrido de UI** creando/editando/borrando una vertical
   desde el navegador. La US no lo exige (decisión 14 del épico prohíbe tocar el
   frontend).
6. **Cobertura.** `coverage_command` está vacío en `openspec/config.yaml` y
   `coverage_threshold: 0`; no se midió cobertura.
7. **Linter/formatter del paquete.** `npm run lint` (biome) de `packages/db` no
   se corrió por separado; `just db-check` cubre `typecheck` + vitest, no lint.
   No es un gate declarado en `rules.verify`.
8. **`just db-test` (scraper).** Sigue roto por US-6 (tabla `productos`
   inexistente), es ajeno a esta US y no se ejecutó.

---

## Entorno dejado atrás

| Ítem | Estado final |
|---|---|
| Filas en `types` | **10** (limpieza por id: `DELETE FROM types WHERE id > 11` → `DELETE 4`; verificado `SELECT count(*) = 10`). **Nunca se corrió `just db-reset`** |
| `products` / `categories` / `manufacturers` / `tags` | 1200 / 198 / 14 / 10 — sin cambios. `manufacturers` con `type_id IS NULL`: **0** (la fila de prueba `zz-verify-manu` fue borrada) |
| `types_id_seq` | **46** (avanzada por los `POST` de la evidencia; inocua, el `setval` del rollout es opcional) |
| Contenedor `safari-postgres` | **Up (healthy)**, `0.0.0.0:5433->5432/tcp`. Se detuvo y reinició una vez para provocar el 503 real (hallazgo C-1); volvió a `healthy` y el comportamiento normal se confirmó (`GET` 200, `POST` 201) |
| Puerto **9001** | **Libre.** Maté el orphan pre-existente (`nest start --watch`, PID 1320, ver W-3) y después mis dos instancias propias (`node dist/main`, PIDs 21072 y 60604 — la segunda era el reinicio de CA-1) |
| Puerto **3003** (shop) | **Libre.** Levanté `yarn dev:rest` para `just verify` y lo maté (PID raíz 34640) |
| Puerto **3002** (admin) | **Libre.** Levanté `yarn dev` para `just verify` y lo maté (PID raíz 58892) |
| Proceso ajeno restante | **PID 35484** — `nest start --watch` del **2026-09-08 14:14**, sin puerto asignado. Pre-existente y anterior a esta US; **no lo maté**. Puede re-bindear el 9001. Sugerido: `taskkill //PID 35484 //T //F` |
| Árbol de git | **Limpio** (`git status --porcelain` vacío). `just build` regeneró `apps/shop/public/sitemap-0.xml` (artefacto versionado, S-5) y lo restauré con `git checkout --` |
| Archivos escritos por este agente | **Solo** `openspec/changes/escrituras-types-fundaciones/verify-report.md`. No se tocó código, tests, specs, design, tasks, proposal ni `state.yaml`; no se hizo commit, push ni rama |

---

## Recomendación

1. **Resolver C-1 antes de archivar.** El arreglo es local y pequeño: en
   `domain-error.mapper.ts`, comparar también el `code` contra los patrones de
   conexión (o añadir `ECONNREFUSED`/`ETIMEDOUT`/`ENOTFOUND` a
   `CONNECTION_FAILURE_CODES`) y **sustituir la fixture del test de 503 por la
   forma real** capturada aquí (`{name:'PrismaClientKnownRequestError',
   code:'ECONNREFUSED', message:'\\nInvalid \`prisma.$queryRaw()\` invocation:'}`),
   de modo que el test vuelva a ser una red y no un espejismo. **Esto es trabajo
   del equipo que posee el código**, no una decisión de gobierno.
2. **Cerrar W-2** en el commit "Documenta y cierra US-27a", siguiendo el
   precedente `5af928c`.
3. **Decisión de gobierno (tuya):** si se acepta C-1 como deuda declarada en vez
   de arreglarlo, debe quedar escrito como divergencia aceptada en el reporte de
   archive, porque cuatro US más heredarán el mapeador sin poder editarlo.
4. **W-1** no bloquea, pero conviene que el forecast de `sdd-tasks` de US-27b
   cuente los `.spec.ts` con el multiplicador real observado aquí (los specs
   pesaron ~2,2× el estimado).

---

## Adenda del orquestador — C-1 REMEDIADO (2026-09-10)

> Esta sección la añade el orquestador **después** del veredicto del
> verificador. No reescribe nada de lo anterior: el `PASS WITH FINDINGS` y el
> `blocking_for_archive: true` originales quedan tal cual como registro de
> auditoría. Lo que cambia es que el hallazgo que bloqueaba ya está resuelto y
> re-verificado.

**Decisión del usuario:** arreglar C-1 antes de archivar, en vez de aceptarlo
como divergencia declarada. Razón de peso: el mapeador es una de las piezas que
US-27b/28/29/30 heredan **sin poder editar** (CA-7 de US-27b exige `git diff`
limpio sobre él), así que era la última ventana para corregirlo sin multiplicar
la deuda por cuatro.

### El fix

`apps/api/rest/src/common/errors/domain-error.mapper.ts` —
`CONNECTION_FAILURE_CODES` pasa a cubrir dos familias: los códigos de
conexión/arranque de Prisma (`P1xxx`, `P2024`) y los **códigos de socket del
driver** (`ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`,
`EHOSTUNREACH`). El diagnóstico del verificador era exacto: con Prisma 7 +
`@prisma/adapter-pg` el código del driver viaja en `code`, y los patrones solo
se comparaban contra `message`, así que la rama 503 estaba muerta.

`domain-error.mapper.spec.ts` — la fixture sintética se sustituye por la **forma
real capturada apagando el contenedor**, documentada como tal en el test:
`{name:'PrismaClientKnownRequestError', code:'ECONNREFUSED', message:'\nInvalid
\`prisma.$queryRaw()\` invocation:\n\n\n'}`.

Se mantiene intacto lo que B1 arregló: el predicado sigue **sin** mirar
`PrismaClientKnownRequestError` por `name`, que es lo que conserva P2011 (y
cualquier otro error de escritura no traducido) en el 500 literal. Los dos tests
—el de C-1 y el tripwire de B1— pasan juntos, que es la prueba de que el arreglo
no sobre-generalizó la rama 503.

### Evidencia de runtime, no de fixture

Escenario reproducido apagando Postgres de verdad (`docker compose stop
postgres`), con token `super_admin` real minteado contra la API viva:

```
=== BASE CAIDA ===
-- POST (escritura):
{"statusCode":503,"message":"No se puede conectar con el servicio. Por favor, intenta más tarde.","error":"Service Unavailable"}
  status=503
-- PUT (escritura):     status=503
-- DELETE (escritura):  status=503
-- GET (lectura, cadena vieja):  status=503
```

Las tres rutas de escritura coinciden ahora con la de lectura, que es
exactamente la asimetría que C-1 denunciaba. Tras `docker compose start
postgres` y espera a `healthy`:

```
=== RECUPERACION ===
-- GET:     status=200
-- POST:    status=201
-- 404 sigue siendo 404 (no 503):                 status=404
-- 400 sigue siendo 400:                          status=400
-- 409 sigue siendo 409 (borrado protegido):      status=409
```

El 404, el 400 y el 409 intactos prueban que el fix no se comió otras ramas.

### Gates re-ejecutados por el orquestador tras el fix

```
just db-check    ->  9 archivos / 111 tests   EXIT=0
npx jest         ->  6 suites  /  92 tests    EXIT=0   (+1: el test de C-1)
just build-api   ->  Done in 43.91s           EXIT=0
```

### Estado del cierre

- **C-1: RESUELTO Y RE-VERIFICADO.** No es un override del bloqueo: es su
  remediación, con evidencia de runtime nueva.
- **WARNING del ítem 10 de la DoD: CERRADO.** Status de US-27a a
  "Implementada (2026-09-10)", los 10 checkboxes marcados, fila del épico
  actualizada con LOC real y el mapa de `docs/product/README.md` reapuntado a
  las cuatro US que ahora quedan desbloqueadas en paralelo.
- **WARNING de volumen: ACEPTADO Y DECLARADO, no corregido.** US-27a aterrizó
  ~1470 líneas frente a ~725 estimadas. Cruza el umbral de ~900 del propio
  épico, ya después de haber partido US-27 una vez. Es materia de gobernanza
  para el dueño del backlog, no algo que arreglar aquí: la señal para US-27b
  (~825 estimadas) es que probablemente también se pase, y el épico haría bien
  en recalibrar sus estimaciones al alza antes de refinar las tres restantes.
- **WARNING del proceso huérfano: CERRADO** para los procesos de esta sesión;
  9001, 3002 y 3003 confirmados libres. Queda vivo el PID 35484 (un
  `nest start --watch` del 2026-09-08, sin puerto asignado), ajeno a esta US.
- Los 6 SUGGESTION quedan como estaban: registrados, no accionados.

**`blocking_for_archive`: false** — remediado. Procede `sdd-archive`.
