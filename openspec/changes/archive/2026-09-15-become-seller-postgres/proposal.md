# Proposal: `become-seller` desde Postgres (US-44)

## Intent

La página «hazte vendedor» se sirve hoy desde un literal del repo:
`become-seller.service.ts:8` arma un singleton en memoria con
`plainToClass(BecomeSeller, becomeSellerJson)` y el `POST` de `create()`
(`:14-16`) lo devuelve **sin persistir nada**. Editar un banner o un tier de
comisión exige tocar `apps/api/rest/src/db/pickbazar/become-seller.json` y
desplegar. US-41 ya dejó tabla, seed, modelo Prisma y `BecomeSellerRecord`
(`db/schema.sql:485-493`, `db/seed.sql:33-35`, `packages/db/src/records.ts:187-194`);
falta el tramo que los conecta: repositorio y servicio.

## Scope

### In Scope

1. `packages/db/src/repositories/become-seller.repository.ts` (**nuevo**):
   `getBecomeSeller()` y `updateBecomeSeller(input)`, exportadas por el barrel
   `packages/db/index.ts` junto al tipo de input.
2. `become-seller.service.ts`: `findAll()` lee de Postgres y recompone el
   envoltorio snake_case; `create()` persiste de verdad.
3. **Extender** `packages/db/src/repositories/become-seller.integration.test.ts`
   (ya existe, 87 líneas, 6 `describe`) y crear
   `apps/api/rest/src/become-seller/become-seller.service.spec.ts`.
4. Correcciones al archivo de la US (sección «Correcciones a la US»).

### Out of Scope (vinculante — el «NO incluye» de la US)

- Cambiar el contrato HTTP: rutas, verbos, nombres de clave. El path real es
  `/api/became-seller` (pasado), y así se queda.
- Rediseñar el contenido de la página; cualquier frontend (shop o admin). Los
  dos headers solo enlazan a la ruta (`header.tsx:300`,
  `header-minimal.tsx:239`); no consumen el payload.
- `staffs` (US-42), `ownership-transfer` (US-43, aplazada), `withdraws`.
- Tocar `settings` (servicio, repositorio o su tamaño congelado) y
  `domain-error.mapper.ts` (decisión **e**).
- Reconstruir timestamps de 6 decimales, forzar orden de claves al serializar o
  congelar las fechas del mock en la base: evaluadas y **descartadas por el
  dueño** (decisión **c**).

## Capabilities

### New Capabilities

- `become-seller-page-api`: las 2 rutas de `/api/became-seller` contra Postgres,
  envoltorio recompuesto en el servicio, equivalencia estructural del contrato.

### Modified Capabilities

- `extended-identity-data-layer`: su requirement «El barrel no exporta funciones
  de repositorio nuevas» (`spec.md:78-97`) deja de aplicar a `become_seller`.
- `data-layer-clock-policy`: el escenario «La primera función de update que se
  cree hereda la política» (`spec.md:173-180`) pasa de futuro condicional a
  hecho verificable.

## Approach

### a. Repositorio de dos funciones planas

- `getBecomeSeller(): Promise<BecomeSellerRecord | null>` — calco literal de
  `getSettings()` (`settings.repository.ts:11-14`): `findUnique({ where: { id: 1 } })`
  + `_toBecomeSellerRecord`.
- `updateBecomeSeller(input)` — `prisma.becomeSeller.update({ where: { id: 1 },
  data: { ...input, updatedAt: now() } })`. **Nunca** `create`/`upsert`: la fila
  fija la garantiza el `CHECK become_seller_fila_unica` (CA-3). El modelo Prisma
  no lleva `@updatedAt` (`schema.prisma:341-349`), así que el reloj es explícito,
  como manda US-32 (`clock.ts:5-13`).

### b. El envoltorio se recompone en el servicio

Diseño ya declarado por `db/schema.sql:479-484` («el envoltorio se recompone en
el servicio (US-44)»). El servicio devuelve `{ page_options: { id, page_options,
language, created_at, updated_at }, commissions }`, con la traducción
camelCase→snake_case a mano igual que `settings.service.ts:33-39`. El consumidor
necesita ese anidado exacto
(`apps/shop/src/framework/rest/become-seller.ts:26-34`).

### c. CA-1 se cierra con equivalencia **estructural** — decisión del dueño

La exploración midió el cuerpo reconstruido en **11 452 B** frente a **11 458 B**
del mock (−6 B): `Date.toJSON()` emite 3 decimales de fracción de segundo donde
el JSON de origen Laravel trae 6, en 2 campos del envoltorio. Además, `jsonb` no
preserva el orden de claves (mismo largo, string distinto). El dueño decidió
**aceptar la divergencia**, con el precedente ya embarcado de `/api/settings`
(`CLAUDE.md`). CA-1 se verifica con `JSON.parse` + deep-equal más una línea de
bytes que **declara y acota** la diferencia a esos dos campos. No se escribe
formateador de fechas ni reordenador de claves.

### d. Primera escritura persistente sobre un singleton en este repo

No hay patrón que copiar: `settings.repository.ts` (14 líneas) solo exporta
`getSettings()` y `settings.service.ts:42-51` documenta que sus escrituras
**deliberadamente no persisten**. `become-seller` es el primero que sí lo hace
(CA-2). Se mantiene mínimo: un update sobre una fila fija, sin abstracción
genérica de «singleton» — una sola ocurrencia no la justifica. El `POST` recibe
`{ language?, page_options: <objeto interno de 24 claves>, commissions }`
(`apps/admin/rest/src/types/index.ts:2242-2246`, enviado por
`become-seller-form.tsx:81-95`), que mapea 1:1 a las columnas; el
`ValidationPipe` global es el de por defecto (`main.ts:9`, sin `whitelist`) y el
DTO no tiene decoradores, así que el body llega íntegro. El `POST` responde el
mismo envoltorio que el `GET`, como hoy.

### e. `domain-error.mapper.ts` no se toca — verificado, no heredado

Conjunto **cerrado** de 5 códigos de escritura de catálogo (`EmptySlug`,
`InvalidReference`, `RecordNotFound`, `DependentRows`, `SlugConflict` —
`domain-error.mapper.ts:96-113`), con cabecera que exige `git diff` vacío al
integrar un agregado nuevo (`:1-10`, CA-7). `become_seller` no tiene slug, FK
entrante, filas dependientes ni borrado: ninguno es alcanzable, y el servicio no
llama a `toWriteHttpException`.

### f. Métodos muertos: se sigue el precedente `settings`

`findOne`/`update`/`remove` no están cableados en el controller
(`become-seller.controller.ts:13-21`). Al desaparecer el campo en memoria,
`update()` pasa a `return this.findAll()` y `findOne`/`remove` conservan sus
literales — exactamente `settings.service.ts:49-59`. Borrarlos sería superficie
que la US no pide.

## Correcciones a la US (`docs/product/40-identidad-extendida-postgres/44-become-seller-postgres.md`)

1. **CA-1** — reemplazar el texto actual («el mismo tamaño en bytes») por:
   > `GET /api/became-seller` devuelve un cuerpo cuyo JSON **parseado** es
   > profundamente igual (deep-equal) al que hoy sirve `become-seller.json`:
   > mismas claves y valores en `page_options` y `commissions`. Se acepta una
   > única divergencia, declarada y acotada: `created_at`/`updated_at` del
   > envoltorio salen de columnas `timestamptz` y `Date.toJSON()` emite 3
   > decimales donde el mock trae 6, de modo que el cuerpo mide 11 452 B frente a
   > 11 458 B (−6 B = 3 caracteres × 2 campos). Mismo precedente ya embarcado en
   > `/api/settings`. El orden de claves dentro de los `jsonb` no forma parte del
   > contrato. La comparación se hace con evidencia (`node -e`), no a ojo.
2. **Gherkin de CA-1** — en vez de «el cuerpo es idéntico»: `Then el JSON
   parseado es profundamente igual al que servía el JSON estático` + `And la
   única diferencia de bytes son los 6 de los decimales de
   created_at/updated_at del envoltorio`.
3. **Ruta** — la prosa dice `become-seller`; el endpoint real es
   `/api/became-seller` (`become-seller.controller.ts:9`), ambas rutas `@Public()`
   a nivel de clase (`:8`), sin guard de admin.
4. **Tabla «Archivos a crear / modificar»** — `become-seller.integration.test.ts`
   figura como nuevo y **ya existe** (US-41): se **extiende**.
5. **DoD** — la comparación de bytes pasa a «deep-equal del cuerpo + línea de
   bytes que acota la divergencia a los 2 timestamps».

## Affected Areas

| Área | Impacto | Descripción |
|------|---------|-------------|
| `packages/db/src/repositories/become-seller.repository.ts` | New | 2 funciones planas + tipo de input |
| `packages/db/index.ts` | Modified | barrel (compartido con US-42: quien vaya segundo rebasea) |
| `packages/db/src/repositories/become-seller.integration.test.ts` | Modified | `describe` nuevos; no se reescribe |
| `apps/api/rest/src/become-seller/become-seller.service.ts` | Modified | lee/escribe Postgres; recompone envoltorio |
| `apps/api/rest/src/become-seller/become-seller.service.spec.ts` | New | jest con `@safari/db` mockeado |
| `docs/product/.../44-become-seller-postgres.md` | Modified | correcciones de arriba |
| `domain-error.mapper.ts`, `settings*`, frontend | **Sin tocar** | `git diff` vacío esperado |

## Estrategia de pruebas

- **vitest (`packages/db`)**: extender la suite existente con `getBecomeSeller` y
  `updateBecomeSeller` (persiste, `updatedAt` desde `_setNowProvider`, no crea
  segunda fila). El `describe` de `become-seller.integration.test.ts:57-62`, que
  afirma `updatedAt === createdAt`, deja de ser cierto tras un update: los tests
  nuevos **MUST restaurar la fila** (`pageOptions`, `commissions` y `updatedAt`
  explícito) en `afterAll`, porque el seed la repara con `ON CONFLICT DO UPDATE`
  que **no** toca `updated_at` (`db/seed.sql:35`).
- **jest (`apps/api/rest`)**: `become-seller.service.spec.ts` con el patrón de
  `categories.service.spec.ts:66-82` (`jest.mock` + `jest.requireActual` +
  `jest.mocked(fn)`). Casos: envoltorio snake_case correcto; `null` de la base →
  error explícito (como `settings.service.ts:28-30`); el `POST` delega en
  `updateBecomeSeller` con el body tal cual y devuelve el envoltorio nuevo.

## Plan de evidencia (Definición de Done)

1. `curl -s localhost:9001/api/became-seller` **antes** y **después** a fichero;
   `node -e` con deep-equal de ambos parseados + los dos tamaños (11 458 →
   11 452). `jq` no está instalado en esta máquina.
2. `curl -X POST` cambiando el título del banner + `GET` posterior con el cambio.
3. `just db-check` con conteo (línea base a **re-medir**: 10/210 es cifra de
   US-41, no re-verificada en la exploración).
4. `cd apps/api/rest && npx jest` con conteo (base declarada: 9 suites / 285).
5. `just build-api` y `just verify` verdes; `/api/settings` en 5503 B.
6. `git diff --stat` mostrando `domain-error.mapper.ts` y `settings*` intactos.

## Risks

| Riesgo | Prob. | Mitigación |
|--------|-------|------------|
| El test `updatedAt === createdAt` se rompe al añadir escrituras | **Alta** | Restaurar la fila en `afterAll` y reescribir ese `describe` (delta de `data-layer-clock-policy`) |
| Deriva de estado en la base tras correr la suite | Media | Misma restauración; `just db-up` no repara `updated_at` |
| Conflicto en `packages/db/index.ts` con US-42 | Media | Rebase del que llegue segundo; única superficie compartida |
| Código nuevo asume `/api/become-seller` | Media | Path verificado en 3 puntos; los curls usan el pasado |
| Revisión rechaza la lectura de CA-1 | Baja | Decisión del dueño registrada aquí y en la US |

## Rollback Plan

Sin DDL ni seed: reversible por código, **no** necesita `db-reset` (destructivo,
no autorizado hoy).

1. `git revert` del commit (o `git checkout -- packages/db/ apps/api/rest/src/become-seller/`).
2. `just db-build` (regenera `dist/`, gitignored).
3. Si una prueba manual dejó la fila 1 editada: `just db-up` repone
   `page_options`/`commissions`/`language` desde el seed y `updated_at` se
   devuelve con `UPDATE become_seller SET updated_at = created_at` en
   `just db-shell`.
4. `just db-check` + `npx jest` para confirmar el estado previo.

**Estado conocido-bueno**: 1 fila, `pageOptions` de 24 claves, `commissions` de
longitud 2, `updated_at = created_at`.

## Dependencies

US-41 (entregada: `5af81ad`, `f06f0e3`); Postgres arriba (`just db-up`) y
`just db-build` antes de jest.

## Previsión de tamaño

La US estima ~500 LOC. Reparto esperado: repositorio ~60, barrel ~5, servicio
~70, integración ~120, spec de Nest ~180, correcciones de la US ~20 → **~450
líneas**, con el sesgo histórico del repo al alza en las suites. **Riesgo de
presupuesto de 400 líneas: Medio.** La decisión de partir en PRs corresponde a
`sdd-tasks` (`delivery_strategy: ask-on-risk`); el corte natural sería
*repositorio + integración* / *servicio + spec*.

## Success Criteria

- [ ] CA-1: el `GET` sale de Postgres y su JSON parseado es deep-equal al del mock; la única diferencia de bytes son los 6 declarados.
- [ ] CA-2: el `POST` persiste, el `GET` siguiente lo refleja y `updatedAt` viene de `clock.ts`.
- [ ] CA-3: ninguna ruta crea una segunda fila; la CHECK sigue rechazándola.
- [ ] CA-4: `just db-check`, `npx jest`, `just build-api` y `just verify` verdes con recuentos; `/api/settings` en 5503 B; `git diff` vacío en `domain-error.mapper.ts` y `settings/`.
- [ ] CA-1, su Gherkin y la tabla de archivos, corregidos en el archivo de la US.
