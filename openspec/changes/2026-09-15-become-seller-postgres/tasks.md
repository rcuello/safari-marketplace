# Tasks: US-44 — `become-seller` desde Postgres

## Review Workload Forecast

| Área | Adds | Dels | Total | Base del cálculo |
|---|---|---|---|---|
| `become-seller.repository.ts` (nuevo) | 53 | 0 | 53 | calco `settings.repository.ts` (14 líneas) + `updateBecomeSeller` con spread condicional de 3 columnas + `_isRecordNotFound` (7 líneas, `users.repository.ts:391-397`) + cabecera |
| `packages/db/index.ts` (barrel) | 7 | 0 | 7 | 1 `export type` + 1 `export {2 funciones}`, bloque antes de `categories.repository` (`:59`) |
| `become-seller.integration.test.ts` (extensión) | 69 | 5 | 74 | snapshot en `beforeAll` (10) + `afterAll` `:17-19` ampliado (12 nuevas − 3 viejas) + 3 `describe` nuevos antes del tripwire (~42) + reencuadre de prosa de `:57-62` (5) |
| `become-seller.service.ts` (reescritura completa) | 58 | 33 | 91 | se van `plainToClass`/import JSON/campo privado (33); entran envoltorio D-2, tipo local D-4, guarda `InternalServerErrorException`, `create`/`update`/`findOne`/`remove` |
| `become-seller.service.spec.ts` (nuevo) | 150 | 0 | 150 | calco reducido de `categories.service.spec.ts:66-82` (jest.mock + mocked) + 5 casos de la Testing Strategy del design |
| Correcciones a la US (`44-become-seller-postgres.md`) | 21 | 15 | 36 | las 5 correcciones de `proposal.md:121-143` (CA-1, Gherkin, ruta, tabla de archivos, DoD) |
| Fila del épico (`docs/product/40-.../README.md`) | 2 | 2 | 4 | actualizar status de la fila US-44 |
| **Total ingenuo (bottom-up)** | **~360** | **~55** | **~415** | recalculado desde los archivos reales leídos en esta fase, no copiado del design |

**Ajuste por sesgo del repo**: el precedente más cercano (US-41) aterrizó en
×1.75-4.6 su estimación inicial, pero esa US creaba DDL + generador + 2
archivos de test desde cero (270 líneas de puro boilerplate nuevo). Aquí solo
1 archivo es 100% nuevo con boilerplate pesado (`become-seller.service.spec.ts`)
y la integración se **extiende**, no se crea. El sesgo aplicable es menor,
pero el ingenuo (~415) ya supera el budget de 400 sin aplicar ningún sesgo, y
`become-seller.service.ts` es una reescritura completa (no un parche), lo que
históricamente en este repo sube el conteo real más de lo que el diff
"lógico" sugiere. Coincide en orden de magnitud con el ~465 del design
(diferencia atribuible a que el design no había leído aún los archivos reales
línea por línea). Se mantiene la cifra propia, sin recortarla para caber bajo
400.

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

Se **coincide** con el corte propuesto por el design
(`proposal.md:215-222`, `design.md` Migration/Rollout): la costura natural es
*capa de datos* (repositorio + barrel + integración, ~134 líneas) vs.
*capa Nest* (servicio + spec, ~241 líneas) — cada mitad es entregable y
verificable sola (`just db-check` cierra la primera sin tocar Nest; `npx
jest` + `just build-api` cierra la segunda). Las correcciones de la US
(36-40 líneas) son demasiado pequeñas para una PR propia y viajan con la
segunda mitad, junto a la evidencia final.

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Fase 1 (baseline) + Fase 2 (repositorio+barrel) + Fase 3 (integración D-5) — cierra con `just db-check` en verde | PR 1 | Base = tracker/feature branch o `main` según la estrategia elegida; ~134 líneas; entregable y revertible solo (`git checkout -- packages/db/`) |
| 2 | Fase 4 (servicio D-2/D-4/D-6) + Fase 5 (spec Nest) + Fase 6 (evidencia CA-1/CA-2/CA-4) + Fase 7 (correcciones US) | PR 2 | Base = PR 1 (feature-branch-chain) o `main` tras merge de PR 1 (stacked-to-main); ~281 líneas; depende de que PR 1 ya exista en el barrel |

`ask-on-risk` es la `delivery_strategy` recibida ⇒ el orquestador debe
preguntar al dueño qué `chain_strategy` usar (`stacked-to-main` |
`feature-branch-chain` | `size:exception`) antes de `sdd-apply`.

## Phase 1: Línea base (medir antes de tocar código)

- [ ] 1.1 `curl -s localhost:9001/api/became-seller > antes.json`; medir
  `body.length` (esperado 11 458 B) con `node -e`. Precondición de todo lo
  demás.
- [ ] 1.2 `just db-check`, pegar el conteo real (NO citar 210 sin medir).
  **STOP** si ya está rojo: la deriva es previa a esta US.
- [ ] 1.3 `cd apps/api/rest && npx jest`, pegar el conteo real (NO citar 285
  sin medir).
- [ ] 1.4 `curl -s localhost:9001/api/settings`, confirmar 5503 B
  (`body.length`) como línea base propia, no heredada de `CLAUDE.md`.

## Phase 2: Repositorio + barrel (D-1)

- [ ] 2.1 Crear `packages/db/src/repositories/become-seller.repository.ts`:
  `getBecomeSeller()` — calco `settings.repository.ts:11-14`
  (`findUnique({where:{id:1}})` + `_toBecomeSellerRecord`).
- [ ] 2.2 En el mismo archivo: `UpdateBecomeSellerInput` (3 columnas
  opcionales, `pageOptions`/`commissions` como `Prisma.InputJsonValue`) +
  `updateBecomeSeller(input)` — `prisma.becomeSeller.update({where:{id:1},
  data:{...spreads condicionales, updatedAt: now()}})` en `try/catch` que
  traduce P2025 → `null`; `_isRecordNotFound` privado calco
  `users.repository.ts:391-397`. NUNCA `create`/`upsert` (CA-3).
- [ ] 2.3 `packages/db/index.ts`: insertar `export type {
  UpdateBecomeSellerInput }` + `export { getBecomeSeller, updateBecomeSeller
  }` justo ANTES del bloque `./src/repositories/categories.repository`
  (`:59`), orden alfabético. **Coordinación de rebase**: este archivo es
  superficie compartida con US-42 (`shop_staff`); quien llegue segundo a
  `main` rebasea sobre el otro.
- [ ] 2.4 `just db-build`. Falla ⇒ `git checkout -- packages/db/`.

## Phase 3: Extender la integración (D-5, determinismo)

- [ ] 3.1 En `become-seller.integration.test.ts`, agregar snapshot en
  `beforeAll`: `prisma.becomeSeller.findUniqueOrThrow({where:{id:1}})`
  guardado en `let` de módulo (`pageOptions`, `commissions`, `language`,
  `updatedAt`). No muta nada.
- [ ] 3.2 Ampliar el `afterAll` YA EXISTENTE (`:17-19`) con
  `try { restore } finally { await prisma.$disconnect() }`. NO crear un
  segundo `afterAll` (vitest `sequence.hooks: 'stack'` correría LIFO sobre
  un cliente ya desconectado, precedente `auth-tokens.integration.test.ts:9-11`).
- [ ] 3.3 Agregar `describe` "getBecomeSeller devuelve la fila": `id===1`,
  `pageOptions` 24 claves, `commissions` longitud 2, `language==='en'`, con
  narrowing explícito (`as Record<string, unknown>`/`as unknown[]`, nunca
  `as any`, precedente `:41-42` del propio archivo).
- [ ] 3.4 Agregar `describe` "updateBecomeSeller persiste y fija el reloj":
  `_setNowProvider(() => fija)` → update → `updatedAt.getTime()===fija.getTime()`
  y `> createdAt`; relectura con `getBecomeSeller` confirma el valor nuevo;
  `afterEach(() => _setNowProvider(() => new Date()))` (patrón
  `types.integration.test.ts:93-95`).
- [ ] 3.5 Agregar `describe` "no crea segunda fila (CA-3)":
  `prisma.becomeSeller.count()` sigue en 1 tras el update.
- [ ] 3.6 Los 3 `describe` de 3.3-3.5 van declarados ANTES del `describe`
  "reloj sin ruta de update" (`:57-62`), convención citada literal en
  `shops.integration.test.ts:472-476`.
- [ ] 3.7 Reencuadrar SOLO la prosa (comentario) del `describe` de `:57-62`:
  pasa de "no existe ruta de update" a "tripwire de estado de reposo".
  **La aserción `updatedAt===createdAt` NO se toca.**
- [ ] 3.8 `just db-check`, pegar el conteo real (debe subir sobre la línea
  base de 1.2). Falla ⇒ `git checkout --` del archivo.

## Phase 4: Servicio Nest (D-2, D-4, D-6)

- [ ] 4.1 En `become-seller.service.ts`: quitar `plainToClass`, el import de
  `@db/become-seller.json` y el campo privado `becomeSeller`. `findAll()`
  llama `getBecomeSeller()`; si `null`, `InternalServerErrorException`
  (mensaje calco `settings.service.ts:28-30`, citando `just db-migrate`).
- [ ] 4.2 `findAll()` recompone el envoltorio literal (D-2): `{ page_options:
  { id, page_options: row.pageOptions, language, created_at: row.createdAt,
  updated_at: row.updatedAt }, commissions: row.commissions }`, cerrado con
  `as unknown as BecomeSeller` (precedente `settings.service.ts:39`, NO
  `as any`).
- [ ] 4.3 **Trampa D-4, no compilar en falso**: `CreateBecomeSellerDto` es
  `OmitType` de `BecomeSeller`, que declara `missions` (no `commissions`) y
  anida `page_options` un nivel más (`entities/become-seller.entity.ts:6-10`,
  `dto/create-become-seller.dto.ts:4-7`). Declarar un tipo local que
  describa el body real (`{language?, page_options, commissions}`,
  `apps/admin/rest/src/types/index.ts:2242-2246`) y reinterpretar el
  parámetro con `as unknown as` (mismo recurso de 4.2), con comentario que
  cite ambas fuentes. **NO editar `become-seller.entity.ts`** — mención en
  el reporte final como mejora adyacente no accionada.
- [ ] 4.4 `create(body)` delega en `updateBecomeSeller` con las 3 claves tal
  cual (spread condicional, sin `language` si el body no la trae) y
  devuelve el mismo envoltorio que `findAll()`. `update()` pasa a
  `return this.findAll()`; `findOne`/`remove` conservan sus literales
  actuales — calco exacto `settings.service.ts:49-59` (D-6).
- [ ] 4.5 Confirmar que `become-seller.module.ts`,
  `become-seller.controller.ts`, `dto/`, `entities/` y
  `domain-error.mapper.ts` quedan sin editar.

## Phase 5: Test unitario Nest (jest, nuevo)

- [ ] 5.1 Crear `become-seller.service.spec.ts`: `jest.mock('@safari/db', ()
  => ({...jest.requireActual(...), getBecomeSeller: jest.fn(),
  updateBecomeSeller: jest.fn()}))` + `jest.mocked(fn)`, copia literal del
  patrón de `categories.service.spec.ts:66-82`.
- [ ] 5.2 Caso: `findAll()` con un `BecomeSellerRecord` fijo →
  `Object.keys` top-level `['page_options','commissions']`, `Object.keys`
  del envoltorio `['id','page_options','language','created_at','updated_at']`,
  `page_options.page_options` idéntico por referencia al `pageOptions` del
  record.
- [ ] 5.3 Caso: `findAll()` con `getBecomeSeller` resolviendo `null` →
  `InternalServerErrorException`.
- [ ] 5.4 Caso: `create(body)` delega en `updateBecomeSeller` con las 3
  claves tal cual y devuelve el mismo envoltorio que `findAll()`.
- [ ] 5.5 Caso: `create(body)` con `updateBecomeSeller` resolviendo `null` →
  `InternalServerErrorException`.
- [ ] 5.6 Caso: `create({page_options, commissions})` sin `language` → el
  input pasado a `updateBecomeSeller` NO lleva la clave `language`
  (verifica el spread condicional, no `undefined` explícito).
- [ ] 5.7 `cd apps/api/rest && npx jest`, pegar el conteo real (debe subir
  sobre la línea base de 1.3, suite nueva incluida). `just build-api` en
  verde (compila sin el JSON importado). Falla ⇒
  `git checkout -- apps/api/rest/src/become-seller/`.

## Phase 6: Evidencia de contrato y regresión (CA-1, CA-2, CA-4)

- [ ] 6.1 `curl -s localhost:9001/api/became-seller > despues.json`.
- [ ] 6.2 Script `node -e` (no `jq`, no está instalado) comparando `antes.json`
  vs `despues.json` por los 5 campos de D-3: claves top-level, claves del
  envoltorio, `page_options.page_options` (24 claves) y `commissions`
  deep-equal; `created_at`/`updated_at` del envoltorio EXCLUIDOS y
  declarados aparte. Imprimir ambos tamaños (esperado 11 458 → 11 452 B).
- [ ] 6.3 `curl -X POST` cambiando el título del banner dentro de
  `page_options` + `GET` posterior confirmando el cambio y
  `updated_at` posterior al valor previo (CA-2).
- [ ] 6.4 `just verify`: los 3 servicios responden con contenido real;
  `/api/settings` sigue en 5503 B.
- [ ] 6.5 `git diff --stat`: confirmar que `domain-error.mapper.ts` y
  `settings/` (servicio, repositorio) NO aparecen en el diff (CA-4/CA-7).
- [ ] 6.6 `psql` (`just db-shell`): `SELECT count(*), updated_at = created_at
  FROM become_seller;` tras correr toda la suite de vitest — confirma que la
  restauración de la Fase 3 dejó la fila en reposo.

## Phase 7: Correcciones de la US y del épico

- [ ] 7.1 Aplicar en
  `docs/product/40-identidad-extendida-postgres/44-become-seller-postgres.md`
  las 5 correcciones de `proposal.md:121-143`: (a) CA-1 reescrito con
  equivalencia estructural y bytes acotados; (b) Gherkin de CA-1 sin "cuerpo
  idéntico"; (c) ruta corregida a `/api/became-seller` (pasado); (d) tabla
  de archivos: `become-seller.integration.test.ts` marcado como
  **existente, se extiende**, no nuevo; (e) DoD: "deep-equal + línea de
  bytes que acota la divergencia a los 2 timestamps".
- [ ] 7.2 Marcar la fila de US-44 en
  `docs/product/40-identidad-extendida-postgres/README.md` como completada,
  con referencia al commit.
- [ ] 7.3 Pegar toda la evidencia de la Fase 6 en la sección "Definición de
  Done" del archivo de la US.
