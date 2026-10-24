# US-65 — `POST /abusive_reports/reject`: rechazar los reportes de una reseña

> En el detalle de una reseña reportada, el admin tiene dos botones.
> «Aceptar» borra la reseña y ya funciona. «Rechazar» llama a
> `POST /api/abusive_reports/reject`, una ruta que no existe y da 404: el
> moderador no puede descartar un reporte infundado. Esta US crea la ruta.

**Épico:** ninguno (US standalone). Nace del «NO incluye» de
[US-54](./46-api-sin-mocks-json/54-reviews-abuse-reports-postgres.md).
**Fecha:** 2026-10-22
**Status:** ✅ Implementada (2026-10-23)
**Depende de:** US-54 (crea `abusive_reports` y su repositorio) y US-55 (deja
`assertReportableExists` con las ramas `Review` y `Question`). Comparte con el
Épico 46 `packages/db/index.ts` y el módulo `reviews`, así que **no puede ir en
paralelo** con ninguna US de ese épico (R-2).
**LOC est.:** ~300

## Historia

**Como** administrador que modera reseñas, **quiero** rechazar los reportes de
abuso de una reseña que no infringe nada, **para** que deje de figurar como
reportada sin tener que borrarla.

## Contexto — verificado en código (2026-10-22)

**El admin** (`apps/admin/rest/src`):

- `data/client/api-endpoints.ts:54`: `ABUSIVE_REPORTS_DECLINE: 'abusive_reports/reject'`.
- `data/client/review.ts:12-15,24-26`: `decline(data)` hace `POST
  abusive_reports/reject` con un cuerpo `{ model_id: number, model_type:
  string }`.
- `components/reviews/review-details.tsx:77-82`: el botón «Decline» abre el
  modal con `{ model_id: id, model_type: abusive_reports?.[0]?.model_type }`.
  `id` es el **id de la reseña**, no el de un reporte.
- `components/reviews/decline-report-confirmation.tsx:17-21`: confirma,
  llama a la mutación, cierra el modal y navega a `/reviews`.
- `data/review.ts:26-39` (`useDeclineReviewMutation`) **ignora el cuerpo de la
  respuesta**: con cualquier 2xx muestra `successfully-decline` y vuelve a
  pedir la lista de reseñas.
- Textos (`public/locales/en/common.json:177,369-372`):
  - aceptar: «Are you sure you want to accept this request? **It will delete
    the review.**»;
  - rechazar: «Are you sure you want to decline this request?».
- El botón vecino, «Accept» (`components/reviews/acccpt-report-confirmation.tsx:17-22`),
  llama a `DELETE /reviews/:id`. Esa ruta ya existe desde US-54 y también
  borra los reportes de la reseña.
- **Solo las reseñas tienen este flujo.** En `components/question` no hay
  botones de aceptar ni rechazar reportes: el modal `DECLINE_ABUSE_REPORT` solo
  se abre desde `review-details.tsx`.

**Hueco de contrato heredado de US-54.** El admin pide la reseña con
`with=abusive_reports.user;product;user` y toma `model_type` del primer
elemento de `abusive_reports`. La API **no emite ese array**: US-54 lo dejó en
su «NO incluye», y el DTO trae solo `abusive_reports_count`
(`apps/api/rest/src/reviews/review-dto.mapper.ts`). Por eso hoy
`model_type` llega **`undefined`**, `JSON.stringify` lo omite y el cuerpo que
recibe la API es solo `{"model_id": <id de la reseña>}`. Por la misma razón, la
tabla de reportes del detalle (`review-details.tsx:270`, `data={abusive_reports}`)
sale vacía.

**La API** (`apps/api/rest/src/reviews/reports.controller.ts`):

- `@Controller('abusive_reports')` (`:19`). `GET`, `GET :id`, `PUT :id` y
  `DELETE :id` llevan `@Permissions(...ADMIN_ONLY)` (`:24-55`); el `POST` (`:38`)
  pide solo token.
- No hay `@Post('reject')`, así que `POST /api/abusive_reports/reject` da 404
  (medido en US-54, CA-6).
- `packages/db/src/repositories/abusive-reports.repository.ts` exporta
  `assertReportableExists(modelType, modelId)` (`:85`, con las ramas `Review` y
  `Question`) y `REPORTABLE_MODEL_TYPES` (`:28`). No hay una función que borre
  todos los reportes de un objeto.

## Decisión de modelo

**Rechazar = borrar los reportes del objeto y dejar el objeto intacto.**

- Es lo opuesto exacto de «Aceptar»: aquel borra la reseña con sus reportes,
  y este conserva la reseña y descarta sus reportes.
- `abusive_reports` no tiene columna de estado (`db/schema.sql`), así que
  borrar es lo único que no exige DDL.
- Tras rechazar, `abusive_reports_count` de la reseña vuelve a `0` y deja de
  figurar como reportada.

**Decisiones del dueño** (no se deducen del código; la US propone un valor por
defecto y el ejecutor lo aplica salvo indicación en contra):

| # | Pregunta | Propuesta por defecto |
|---|---|---|
| DD-1 | ¿Borrar los reportes o marcarlos como rechazados (columna `status` y, si hace falta, quién y cuándo)? | **Borrar.** Marcar exige DDL y un criterio de visibilidad que hoy no pide nadie. |
| DD-2 | ¿Un reportante puede volver a reportar algo que ya se rechazó? | **Sí.** Al borrarse la fila, el `UNIQUE (user_id, model_type, model_id)` ya no lo impide. Con DD-1 = marcar, la respuesta cambia. |
| DD-3 | ¿Se emite el array `abusive_reports` en el detalle de la reseña, para que el admin pinte la tabla y mande `model_type`? | **No en esta US.** Es contrato de `GET /reviews/:id`. Se propone como US aparte. |

## Contrato de la ruta

`POST /api/abusive_reports/reject`, con `@Permissions(...ADMIN_ONLY)`, como el
resto de la moderación (R-6).

- **Cuerpo:** `{ model_id, model_type? }`.
  - `model_id` es obligatorio y debe ser un entero positivo seguro.
  - `model_type` acepta el nombre corto (`Review`, `Question`) o el FQCN,
    normalizado con `toShortModelType` (US-54). **Si falta, vale `Review`**,
    porque es lo que llega hoy desde el admin (ver el hueco de contrato).
- **Efecto:** comprueba que el objeto exista (`assertReportableExists`) y
  borra todos sus reportes en una sola sentencia.
- **Respuesta:** `201`, el default de Nest para un `@Post`, igual que el resto
  de la API. El cuerpo es `{ model_type: <FQCN>, model_id, deleted: <n> }`.
  El admin lo ignora, pero sirve como evidencia.
- **Idempotente:** rechazar un objeto que existe y no tiene reportes responde
  `201` con `deleted: 0`.

## Scope

**Incluye:**

- una función en `abusive-reports.repository.ts` que borre los reportes de
  un objeto y devuelva cuántos borró, con su caso en el integration test;
- la ruta `@Post('reject')` en `AbusiveReportsController`, con su método de
  servicio y sus casos en `reports.service.spec.ts`;
- `deleted` y `model_type` en la respuesta.

**NO incluye:**

- emitir `abusive_reports` en `GET /reviews/:id` (DD-3);
- una columna de estado o un historial de moderación (DD-1);
- avisar al reportante o al autor;
- botones de moderación para preguntas en el admin;
- cambiar los guards del resto de rutas de `abusive_reports` (R-6);
- tocar frontends.

## Criterios de aceptación

### CA-1 — Rechazar lo que manda el admin hoy

Con el token del admin, la reseña 1 tiene 1 reporte en el seed (el 3 del
cliente):

| Paso | Resultado |
|---|---|
| `GET /reviews/1` | `abusive_reports_count: 1` |
| `POST /abusive_reports/reject {"model_id":1}` (sin `model_type`) | **201**, `{model_type:"Marvel\\Database\\Models\\Review", model_id:1, deleted:1}` |
| `GET /reviews/1` | `abusive_reports_count: 0`; la reseña sigue existiendo (200) |
| `psql`: reportes de `('Review', 1)` | 0; los de las reseñas 21 y 78 siguen intactos |

### CA-2 — `model_type` explícito, preguntas e idempotencia

- `{"model_id":21,"model_type":"Review"}` y el FQCN equivalente dan 201.
- Con un reporte de prueba sobre la pregunta 68, `{"model_id":68,
  "model_type":"Question"}` da 201 con `deleted: 1`.
- Repetir el rechazo de la reseña 1 da 201 con `deleted: 0`.

### CA-3 — Errores y permisos

| Llamada | Status |
|---|---|
| `{"model_id":999999}` (reseña inexistente) | 404 |
| `{"model_id":"abc"}` o sin `model_id` | 400 |
| `{"model_id":1,"model_type":"Product"}` | 400 |
| con el token de `customer@demo.com` | 403 |
| sin token | 401 |

En los cuatro casos de error no se borra ninguna fila.

### CA-4 — Sin regresión

- `POST /abusive_reports` (crear), `GET`, `PUT` y `DELETE /abusive_reports/:id`
  responden igual que tras US-55.
- `just db-check`, `npx jest`, `just build-api` y `just verify` en verde, con
  los recuentos; `/api/settings` sigue en 5503 B.

## Escenarios Gherkin

```gherkin
Feature: Rechazar reportes de abuso
  Scenario: CA-1 — el admin rechaza los reportes de una resena
    Given la resena 1 con un reporte de abuso
    When el admin hace POST /api/abusive_reports/reject con model_id 1
    Then la respuesta es 201 con deleted 1
    And GET /api/reviews/1 devuelve abusive_reports_count 0

  Scenario: CA-2 — rechazar dos veces no falla
    Given la resena 1 sin reportes
    When el admin vuelve a rechazarla
    Then la respuesta es 201 con deleted 0

  Scenario: CA-3 — un cliente no modera
    Given customer@demo.com autenticado
    When hace POST /api/abusive_reports/reject con model_id 1
    Then la respuesta es 403
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `packages/db/src/repositories/abusive-reports.repository.ts` | borrar los reportes de un objeto y devolver el conteo |
| `packages/db/src/repositories/abusive-reports.integration.test.ts` | casos nuevos |
| `packages/db/index.ts`, `packages/db/README.md` | barrel y documentación |
| `apps/api/rest/src/reviews/reports.controller.ts` | `@Post('reject')` con `ADMIN_ONLY` |
| `apps/api/rest/src/reviews/reports.service.ts` + `.spec.ts` | método `reject` y sus casos |
| `apps/api/rest/src/reviews/dto/` | DTO del cuerpo si hace falta |

## Definición de Done

- [ ] Línea base con la API recién arrancada: `POST /abusive_reports/reject`
  da 404 y `GET /reviews/1` trae `abusive_reports_count: 1`.
- [ ] Las decisiones DD-1 a DD-3 registradas: la propuesta por defecto o lo
  que haya dicho el dueño.
- [ ] CA-1 a CA-3 con `curl`, Bearer (admin y cliente) y status exacto, más
  `psql` antes y después de cada rechazo.
- [ ] Restauración del reposo tras la evidencia: `just db-reset`, porque los
  reportes del seed se borran en CA-1 y CA-2.
- [ ] CA-4: `just db-check`, `npx jest`, `just build-api` y `just verify` con
  recuentos.
- [ ] Status actualizado aquí y en el mapa de `docs/product/README.md`.

## Notas para el agente ejecutor

- **`model_id` es el id de la reseña**, no el de un reporte: rechazar actúa
  sobre todos los reportes de ese objeto.
- **No exigir `model_type`.** Hoy llega `undefined` porque la API no emite
  `abusive_reports` en el detalle (DD-3). Si se exigiera, el botón del admin
  daría 400 siempre.
- **Orden de rutas:** `@Post('reject')` no choca con `@Post()`, porque tienen
  distinto número de segmentos, y no hay ningún `@Post(':id')`. Aun así,
  declararlo antes de las rutas parametrizadas es la convención del repo
  (`store-notices`, `getUsersToNotify`).
- **El borrado es una sola sentencia** (`deleteMany` por `model_type` +
  `model_id`) después de `assertReportableExists`, que da el 404 de un objeto
  inexistente. No hace falta transacción.
- Las suites de integración cuentan sobre el seed: si el test borra reportes
  sembrados, debe recrearlos en `afterAll`, o trabajar sobre reportes
  centinela creados por el propio test.
- Mencionar DD-3 en el reporte: sin el array `abusive_reports`, la tabla de
  reportes del detalle sigue vacía en el admin.

## Evidencia (2026-10-23)

**Decisiones DD-1 a DD-3:** se aplicaron las propuestas por defecto. El
dueño no indicó otra cosa.

- **DD-1 — borrar:** rechazar borra los reportes; no se añade columna de
  estado.
- **DD-2 — sí:** se puede volver a reportar. El integration test lo
  comprueba: tras rechazar, el mismo usuario reporta otra vez la misma
  reseña sin 409.
- **DD-3 — no:** el array `abusive_reports` no se emite en `GET
  /reviews/:id`.

**Línea base** (API recién arrancada sobre `main` `8206642`):

```
base GET /reviews/1 → abusive_reports_count 1 200
base POST /abusive_reports/reject → {"statusCode":404,"message":"Cannot POST /api/abusive_reports/reject","error":"Not Found"} 404
base list 200 1183B · base get-3 200 381B · base my-reports 200 1183B
```

**CA-1** (token del admin; `psql` sobre `abusive_reports` como `id:tipo/objeto`):

```
psql antes: 1:Review/78 2:Review/21 3:Review/1
GET /reviews/1 → abusive_reports_count 1 · status 200
POST reject {"model_id":1} → {"model_type":"Marvel\\Database\\Models\\Review","model_id":1,"deleted":1} 201
GET /reviews/1 → abusive_reports_count 0 · status 200
psql después: 1:Review/78 2:Review/21
```

**CA-2:**

```
POST reject {"model_id":21,"model_type":"Review"}                     → {…"model_id":21,"deleted":1} 201
POST reject {"model_id":78,"model_type":"Marvel\\Database\\Models\\Review"} → {…"model_id":78,"deleted":1} 201
POST /abusive_reports (cliente, pregunta 68) → 201 · psql: 1:Review/78 24:Question/68
POST reject {"model_id":68,"model_type":"Question"} → {"model_type":"Marvel\\Database\\Models\\Question","model_id":68,"deleted":1} 201
POST reject {"model_id":1} otra vez → {…"model_id":1,"deleted":0} 201
```

El primer intento con el FQCN dio 400 (`Bad escaped character in JSON`):
el `\\` se perdió en el escapado de bash. Con el cuerpo en un archivo dio
201. El fallo era del `curl`, no de la API.

**CA-3** (antes de los errores había un reporte nuevo del cliente sobre la
reseña 1; `psql: 1:Review/78 25:Review/1`):

```
{"model_id":999999}                   → 404 No existe un registro de `reviews` con id 999999.
{"model_id":"abc"}                    → 400 `model_id` no admite `abc`.
{} (sin model_id)                     → 400 `model_id` no admite `undefined`.
{"model_id":1,"model_type":"Product"} → 400 `model_type` no admite `Product`.
cliente {"model_id":1}                → 403 No tienes permisos suficientes para esta operación.
sin token                             → 401 Token de autenticación ausente o inválido.
psql después de los errores: 1:Review/78 25:Review/1   (no se borró nada)
```

**Restauración del reposo:** `just db-reset` →
`1:Review/78 2:Review/21 3:Review/1`.

**CA-4:**

```
after GET /reviews/1 → abusive_reports_count 1 200
list:       idéntico a la línea base: true OK
get-3:      idéntico a la línea base: true OK
my-reports: idéntico a la línea base: true OK
POST /abusive_reports → 201 id 4
PUT /abusive_reports/4 → 200 · cliente PUT → 403
DELETE /abusive_reports/4 → 200 · otra vez → 404
(se restauró setval('abusive_reports_id_seq', 3); quedan los reportes 1, 2 y 3)
```

```
$ just db-check
 Test Files  32 passed (32)
      Tests  402 passed (402)
$ cd apps/api/rest && npx jest
Test Suites: 34 passed, 34 total
Tests:       539 passed, 539 total
$ npx tsc --noEmit -p tsconfig.json   → exit 0
$ just build-api                      → Done in 17.39s.
$ just verify
OK   API    :9001/api/settings  200  5503B  551ms
OK   Shop   :3003/en  200  190788B  362ms  cards:30
OK   Admin  :3002/en/login  200  72821B  36ms  cards:1
```

Antes (US-64): 399 tests en `db-check` y 533 en jest. Se suman 3 casos en
`abusive-reports.integration.test.ts` y 6 en `reports.service.spec.ts`
(4 `it` más 2 filas extra del `it.each`).

`just build-api` se corrió con la API detenida, y después se volvió a
arrancar. Así se evita que el watch quede caído por el `dist/` vacío
(incidencia de US-63 y US-64).

**Decisiones de implementación:**

- El integration test trabaja sobre reportes centinela del admin en la
  reseña 2 y la pregunta 67, que no tienen reportes sembrados. Los 3 del
  seed no se tocan. Se usa la 67 y no la 68 porque un caso previo de US-55
  deja un reporte del admin sobre la 68 hasta el `afterAll`.
- `model_type` ausente o `null` vale `Review`. Un string que no es
  reportable da 400. `model_id` admite número o string numérico, como el
  resto de las rutas.
- La ruta se declara antes de `GET :id`, por la convención del repo.

**Notas para el reporte:** sigue abierto DD-3. Sin el array
`abusive_reports` en `GET /reviews/:id`, la tabla de reportes del detalle
del admin sale vacía y el botón manda solo `model_id` (por eso `Review` es
el default).
