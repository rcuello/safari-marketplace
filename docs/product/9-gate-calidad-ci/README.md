# Épico 9 — Gate de calidad y CI

> El repo no tiene ningún gate agregador: el único test automatizado es el de
> integración de `packages/db`, no hay CI, y `apps/api/rest` declara jest sin
> tener un solo spec. Este épico construye el gate local primero y lo sube a
> CI después.

**Fecha:** 2026-08-25
**Status:** Refinado

## Contexto verificado (2026-08-25)

- Tests existentes: **uno** —
  `packages/db/src/repositories/products.integration.test.ts` (vitest,
  requiere Postgres de `just db-up`); envuelto por `just db-check`
  (typecheck + test).
- `apps/api/rest/package.json` declara scripts de jest (`test`, `test:e2e`,
  `test:cov`) pero no existe ningún `*.spec.ts` en `src/` ni carpeta `test/`.
- `services/scraper-worker/test_pipeline.py` existe pero está roto contra el
  esquema actual (lo repara el Épico 5).
- No hay `.github/workflows/` ni ningún otro CI.
- Linters/typecheckers reales: biome + tsc en `packages/db`; eslint declarado
  en `apps/api/rest`; prettier configurado en `apps/`. Nada se ejecuta de
  forma agregada.
- Duplicación rest/graphql: `apps/api/graphql` y `apps/admin/graphql` existen
  completos; el stack documentado y operado es REST (`apps/README.md`). La
  variante GraphQL ni se arranca ni se construye en ninguna receta del
  justfile, pero sí se instala (workspace `admin/*`) y aparece en `clean`.

## Subdivisión en sub-historias

| US | Título | Releasable solo | Depende de | LOC est. |
|----|--------|-----------------|------------|----------|
| [US-10](./10-receta-just-check.md) | Receta `just check` (gate local agregador) | Sí | ninguna | ~120 |
| [US-11](./11-ci-github-actions.md) | CI en GitHub Actions | Sí | US-10 | ~150 |
| [US-12](./12-acotar-variante-graphql.md) | Decidir y acotar la variante GraphQL | Sí | ninguna | ~100 |
| [US-73](./73-auditoria-secretos-dependencias.md) | `just audit`: Gitleaks + OSV-Scanner en Docker, en modo reporte y fuera de `check` | Sí | ninguna dura (toca el justfile: no en paralelo con US-10/US-12) | ~150 |
| [US-74](./74-fronteras-arquitectura-lint.md) | Fronteras de arquitectura como `no-restricted-imports` en los `.eslintrc` existentes | Sí | US-10 | ~80 |

**Orden sugerido:** US-10 → US-11; US-12 en cualquier momento (no comparte
archivos con US-10/11 salvo el justfile — no paralelizar con US-10).

## Refinamiento — Decisiones tomadas

| # | Tema | Decisión |
|---|------|----------|
| 1 | Gate local primero | `just check` se construye y estabiliza en local antes de subir nada a CI (US-11 consume a US-10, no lo reimplementa). |
| 2 | Composición honesta | El gate agrega SOLO lo que existe y pasa; no se declaran pasos aspiracionales (un jest sin specs no entra hasta que tenga specs). |
| 3 | Falla rápida | El gate corta al primer rojo y dice qué paso falló. |

## Visión técnica compartida

### Decisiones de Diseño (D-N)
- **D-1:** Los builds de Next (shop/admin) son lentos (~minutos): el design de
  US-10 decide si entran al gate por defecto o tras un flag (`just check-full`).
- **D-2:** CI necesita Postgres como service container para `db-check` y (tras
  el Épico 5) `db-test`.

### Riesgos (R-N)
- **R-1:** Las dos instalaciones de yarn (~15 min sin caché) pueden hacer el
  CI inviable sin caching agresivo de `node_modules`/yarn cache.
- **R-2:** `packages/db` requiere `prisma generate` + build antes del
  typecheck: el orden de pasos del gate importa y debe documentarse en la
  receta.

## Notas globales para los agentes

- Ningún paso del gate puede depender de servicios levantados a mano; todo lo
  que necesite la base la levanta con `just db-up` o el service container.
- La evidencia de cierre de cada US incluye el gate corriendo en rojo a
  propósito (inyectar un fallo y verificar que corta) además del verde.

## Actualización tras el escaneo de bingo-flow (2026-10-24)

> Sección añadida sin reescribir lo anterior. Corrige el contexto del
> 2026-08-25, suma US-73 y US-74 a la tabla de sub-historias y abre una
> decisión para el dueño. Fuente de la comparación: el proyecto hermano
> `C:\DevOps\MyGitHub\games\bingo-flow`.

### Contexto corregido

El contexto de 2026-08-25 ya no describe el repo:

- La cabecera (líneas 3-5) dice «el único test automatizado es el de
  integración de `packages/db`» y que `apps/api/rest` «declara jest sin
  tener un solo spec».
- «Tests existentes: **uno** — `packages/db/src/repositories/products.integration.test.ts`»
  (líneas 13-16) y «no existe ningún `*.spec.ts` en `src/`» (líneas 17-18).

Conteos medidos el 2026-10-24:

```
cd apps/api/rest && npx jest   →  Test Suites: 34 passed, 34 total / Tests: 565 passed, 565 total
just db-check                  →  Test Files  32 passed (32) / Tests  412 passed (412)
```

Consecuencia para la **decisión 2 («Composición honesta»)**, que dice «un
jest sin specs no entra hasta que tenga specs»: la condición ya se cumplió.
Jest de `apps/api/rest` **sí entra** al gate, junto con `just db-check`. La
decisión no cambia; cambia el hecho al que se aplica. US-10 recoge el ajuste
en su propia sección de actualización.

### Sub-historias nuevas

Las filas de US-73 y US-74 se añadieron a la tabla de «Subdivisión en
sub-historias»:

- **US-73** (`73-auditoria-secretos-dependencias.md`, Status «Listo para
  ejecución — con propuesta por defecto en DA-1..DA-3»): `just audit` corre
  Gitleaks y OSV-Scanner en Docker, solo reporta, no bloquea y no entra en
  `just check`. No tiene dependencia dura, pero toca el `justfile`, así que
  no va en paralelo con US-10 ni con US-12.
- **US-74** (`74-fronteras-arquitectura-lint.md`, Status «Listo para
  ejecución — con propuesta por defecto en DA-1..DA-3; el ejecutor las
  confirma con el dueño»): convierte las fronteras de capas de `CLAUDE.md` en
  `no-restricted-imports` dentro de los `.eslintrc` existentes, sin migrar a
  flat config. Depende de US-10: sin el gate, las reglas no corren en ningún
  lado.

### Orden

> **Confirmado por el dueño (2026-10-24):** se mantiene el orden que el épico ya declara (US-10 → US-11; US-12 en cualquier momento, sin paralelizar con US-10), con US-73 independiente pero sin ir en paralelo con US-10/US-12 y US-74 después de US-10.

El orden que el épico ya declara (línea 40) es: «US-10 → US-11; US-12 en
cualquier momento (no comparte archivos con US-10/11 salvo el justfile — no
paralelizar con US-10)». Se mantiene y se extiende:

- **US-10 → US-11**, sin cambios.
- **US-12** en cualquier momento, sin paralelizar con US-10.
- **US-73** independiente, sin paralelizar con US-10 ni con US-12 (las tres
  tocan el `justfile`).
- **US-74** después de US-10.

Diferencia con la propuesta de este escaneo: la propuesta ponía
US-10 → US-12 → US-11, o sea, US-12 antes de US-11. El épico no fija esa
secuencia; US-12 queda libre respecto de US-11. Si el dueño quiere que US-12
pase antes de US-11 (por ejemplo, para que CI no instale la variante GraphQL),
tiene que decidirlo y anotarlo aquí.

### Decisión abierta para el dueño

**DA-1 — ¿`just check` corta al primer rojo o corre todo y resume al final?**

> **Confirmada por el dueño (2026-10-24):** propuesta por defecto. `check` mantiene la decisión 3 (corta al primer rojo); un reporte agregado, si se quiere, va en una receta aparte.

- Hoy rige la **decisión 3 («Falla rápida»)**: «El gate corta al primer rojo y
  dice qué paso falló». US-10 la refleja en su CA-2.
- bingo-flow hace otra cosa en `scripts/smells.mjs`: corre todas las partes
  aunque una falle, para que un fallo no impida ver los demás reportes
  (líneas 1-3), y al final imprime `FALLA` o `aviso` por parte (líneas 22-26).
  Solo bloquean los ciclos (`smells:circular`) y el `lint`
  (`blocking: true`, líneas 11-12). Knip (`smells:dead`) y jscpd
  (`smells:dup`) solo reportan (`blocking: false`, líneas 9-10). Sale con 1
  solo si falló una parte bloqueante (línea 27).
- **Propuesta por defecto:** mantener la decisión 3 en `just check`. Si se
  quiere un reporte agregado al estilo de `smells.mjs`, que sea una receta
  aparte (como `just audit` de US-73, que ya es solo reporte), no un modo de
  `check`.
