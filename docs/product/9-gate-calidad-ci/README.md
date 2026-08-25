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
