# US-10 — Receta `just check` (gate local agregador)

> Un solo comando local que corre todo lo verificable del monorepo y corta al
> primer rojo: el gate de cierre que las US de este backlog citan en su DoD.

**Épico:** [Épico 9](./README.md)
**Fecha:** 2026-08-25
**Status:** Listo para ejecución
**Depende de:** ninguna
**LOC est.:** ~120

## Historia
**Como** agente que cierra una US, **quiero** un `just check` que agregue
lint, typecheck, tests y builds existentes, **para** verificar el repo entero
con un comando y evidencia única en vez de recordar N comandos por paquete.

## Contexto

- Piezas verificables que existen HOY: `packages/db` (`npm run lint` biome,
  `npm run typecheck`, `npm test` vitest — requiere Postgres), builds de
  `apps/api/rest` (`yarn build`), `apps/shop` (`yarn build:rest`) y
  `apps/admin/rest` (`yarn build`), y `apps/api/rest` `yarn lint` (eslint).
- Piezas que NO existen y no deben fingirse: tests de la API (jest sin
  specs), tests del scraper en verde (rotos hasta el Épico 5), tests de
  frontend.

## Scope
**Incluye:** receta(s) `check` en el justfile (grupo `verify`), composición
decidida y documentada en la propia receta (qué corre, en qué orden, qué
requiere `db-up`), corte al primer rojo, y actualización del comentario de
cabecera del justfile y de `CLAUDE.md` (sección Comandos) con el gate nuevo.
**NO incluye:** escribir tests nuevos, CI (US-11), arreglar rojos
preexistentes que el gate destape (se reportan; si son triviales, fix aparte),
hooks de git.

## Criterios de aceptación

### CA-1 — Verde de punta a punta
En un working tree limpio con la base arriba, `just check` sale 0 e imprime un
resumen por paso.

### CA-2 — Corta al primer rojo
Con un error inyectado (p. ej. un type error temporal en `packages/db/src`),
`just check` sale ≠0 en ese paso, sin ejecutar los siguientes, y el paso
culpable es identificable en la salida. El error inyectado se revierte.

### CA-3 — Composición honesta y documentada
La receta lista en comentarios qué corre y qué queda fuera y por qué (jest sin
specs, scraper hasta Épico 5). Nada aspiracional dentro del gate.

### CA-4 — Precondiciones explícitas
Si la base no está arriba y un paso la necesita, el gate lo dice claro
(mensaje accionable tipo "corre just db-up"), no un stacktrace de conexión.

## Escenarios Gherkin
```gherkin
Feature: Gate local agregador
  Scenario: CA-2 — corte al primer rojo
    Given un type error inyectado en packages/db
    When corro just check
    Then el gate sale distinto de 0 en el paso de typecheck
    And los pasos posteriores no se ejecutan
```

## Archivos a crear / modificar
| Archivo | Cambio |
|---------|--------|
| `justfile` | receta `check` (+ variante `check-full` si el design separa los builds lentos) |
| `CLAUDE.md` | sección Comandos: el gate nuevo |

## Definición de Done
- [ ] Salida real de `just check` verde pegada (completa, con el resumen por paso).
- [ ] Salida real del CA-2 (rojo inyectado + corte) pegada, y el revert mostrado.
- [ ] Salida real de `just --list` mostrando la receta en su grupo.
- [ ] Status de esta US actualizado y fila del épico marcada.

## Notas para el agente ejecutor
- Medir y anotar en la receta la duración aproximada de cada paso: la decisión
  D-1 del épico (builds dentro o en `check-full`) se toma con números, no a ojo.
- `packages/db` necesita `prisma generate`/build antes del typecheck (R-2 del
  épico): respetar el orden.
