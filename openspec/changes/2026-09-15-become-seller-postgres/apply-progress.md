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

## Remaining Tasks (Cut 2 — NOT started)

- [ ] Phase 4 — `become-seller.service.ts` (D-2, D-4, D-6)
- [ ] Phase 5 — `become-seller.service.spec.ts` (nuevo, jest)
- [ ] Phase 6 — Evidencia de contrato y regresión (CA-1, CA-2, CA-4)
- [ ] Phase 7 — Correcciones de la US y del épico

## Workload / PR Boundary

- Mode: chained PR slice (`feature-branch-chain`, resuelto por el dueño a
  partir de `ask-on-risk`)
- Current work unit: **Unit 1** de `tasks.md` ("Fase 1 (baseline) + Fase 2
  (repositorio+barrel) + Fase 3 (integración D-5) — cierra con `just
  db-check` en verde")
- Boundary: este batch empieza en un checkout limpio de
  `us-44-corte-1-repositorio` (sin apply-progress previo) y termina con
  `just db-check` en verde, medido 3 veces. No toca `apps/`.
- Estimated review budget impact: ~130 líneas netas (repositorio nuevo 55 +
  barrel +2 + test extendido ~115 líneas nuevas netas), dentro del ~134
  estimado por `tasks.md` para esta Unit — bajo el budget de 400.

## Status

15/26 tasks complete (Fases 1-3, 15 tareas, de las 26 totales del
`tasks.md`). Ready for Cut 2 (Fases 4-7) — NO iniciado por instrucción
explícita del alcance de este batch.

## Notes for Next Batch (Cut 2)

- El servidor de la API (`just api-dev`) quedó corriendo en segundo plano
  en esta sesión (puerto 9001) para poder medir 1.1/1.4 — puede que ya no
  esté vivo si la sesión terminó; Cut 2 necesita la API arriba para las
  tareas 6.1/6.3/6.4.
- `antes.json` (11 458 B) quedó en el scratchpad de esta sesión, NO en el
  repo — Cut 2 debe volver a capturarlo si lo necesita como archivo, o
  re-correr el `curl` (la cifra ya está documentada arriba y en
  `design.md`).
