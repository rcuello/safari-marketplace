# US-10 — Receta `just check` (gate local agregador)

> Un solo comando local que corre todo lo verificable del monorepo y corta al
> primer rojo: el gate de cierre que las US de este backlog citan en su DoD.

**Épico:** [Épico 9](./README.md)
**Fecha:** 2026-08-25
**Status:** Refinado — requiere re-refinamiento (ver Actualización 2026-10-24)
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

## Actualización tras el escaneo de bingo-flow (2026-10-24)

> Sección añadida sin reescribir lo anterior. Recoge lo que cambió desde el
> 2026-08-25 y lo que dejó como exigencia la actualización de US-11. Fuente de
> la comparación: el proyecto hermano `C:\DevOps\MyGitHub\games\bingo-flow`.
> El re-refinamiento decide qué de esto sube a CA y qué queda como nota.
> Antes de esta actualización, el Status era «Listo para ejecución».

### 1. Contexto corregido: jest de la API y `just db-check` entran al gate

El Contexto de esta US dice (líneas 23-24) que entre las piezas que «NO
existen y no deben fingirse» están los «tests de la API (jest sin specs)», y
el CA-3 (líneas 48-49) pide documentar como excluido el «jest sin specs».
Ya no es cierto. Conteos medidos el 2026-10-24:

```
cd apps/api/rest && npx jest   →  Test Suites: 34 passed, 34 total / Tests: 565 passed, 565 total
just db-check                  →  Test Files  32 passed (32) / Tests  412 passed (412)
```

Por la decisión 2 del épico («Composición honesta»), lo que existe y pasa
entra. La composición del **CA-3** pasa a incluir:

- **jest de `apps/api/rest`** (`npx jest`). Mockea `@safari/db`, así que no
  necesita Postgres, pero sí el `dist/` de `packages/db` (`just db-build`
  antes).
- **`just db-check`**, que es `npm run typecheck` + `npm test` de
  `packages/db` (justfile, receta `db-check`) y requiere `just db-up`. Ya
  estaba listado como piezas sueltas en el Contexto (líneas 19-20); la receta
  puede invocar `db-check` en vez de repetirlas.

Lo que sigue fuera, con su motivo: los tests del scraper (rotos hasta el
Épico 5) y los tests de frontend (no existen). El CA-4 (precondiciones) aplica
a `db-check`.

### 2. El lint de la API, sin `--fix`

El Contexto (línea 22) lista «`apps/api/rest` `yarn lint` (eslint)» como
pieza del gate. Pero `apps/api/rest/package.json:16` es
`"lint": "eslint \"{src,apps,libs,test}/**/*.ts\" --fix"` (verificado el
2026-10-24). Con `--fix`, eslint reescribe los archivos que puede corregir y
solo falla por lo que no puede: el gate quedaría en verde sobre un árbol
modificado. US-11 (sección «El `--fix` del lint de la API») deja esta
corrección a cargo de US-10.

- La receta invoca eslint **sin `--fix`**, por ejemplo
  `npx eslint "{src,apps,libs,test}/**/*.ts"` desde `apps/api/rest`.
- Alternativa, a decisión del ejecutor: un script nuevo de solo lectura
  (p. ej. `lint:check`) en `apps/api/rest/package.json`, que la receta llame.
  El script `lint` actual no se cambia.
- Un error de lint pone el gate en rojo.

### 3. Herramienta propuesta para el CA-2: `scripts/sdd/mutate.mjs` de bingo-flow

El **CA-2** (líneas 42-45) pide inyectar un error, ver que el gate corta y
revertir. bingo-flow tiene un script para eso,
`C:\DevOps\MyGitHub\games\bingo-flow\scripts\sdd\mutate.mjs`, escrito tras
cuatro incidentes con scripts ad hoc (líneas 3-5: dos gates en paralelo sobre
el mismo archivo, un `find` que casó un comentario, CRLF y una restauración
cortada a mitad). Lo esencial:

- **Uso** (líneas 8-9): `node scripts/sdd/mutate.mjs <archivo> "<literal>" "<reemplazo>"`
  y `node scripts/sdd/mutate.mjs <archivo> --restore`.
- **El literal tiene que aparecer exactamente una vez** en el original; si no,
  sale con 2 (líneas 54-58).
- **Respaldo fuera del árbol:** en el tmp del sistema, nunca en el repo, y sin
  `git checkout`, `restore` ni `stash` (líneas 11-13). Una mutación a la vez
  por archivo: con otra pendiente, se niega a mutar (líneas 49-52).
- **Restauración comparada por bytes:** copia el respaldo, compara con
  `Buffer.equals` y, si no son idénticos, sale con 3 y conserva el respaldo
  (líneas 35-41).
- **Nombre del tmp:** `join(tmpdir(), "bingo-flow-mutate")` (línea 27). En
  safari hay que cambiarlo (p. ej. `safari-marketplace-mutate`), para que una
  mutación pendiente de un repo no choque con la del otro.

Es una **herramienta propuesta, no un requisito**. Si el ejecutor la adopta,
la copia a safari (p. ej. `scripts/sdd/mutate.mjs`) y la anota en «Archivos a
crear / modificar». Si no, el CA-2 se cumple con cualquier inyección que deje
el revert mostrado en la evidencia, como exige la DoD.

### 4. Decisión abierta: cortar al primer rojo o resumir al final

El README del épico abre la **DA-1**: si `just check` corta al primer rojo
(decisión 3, la que refleja el CA-2) o corre todas las piezas y resume al
final, como `scripts/smells.mjs` de bingo-flow. La propuesta por defecto es
mantener el corte al primer rojo en `check` y, si se quiere un reporte
agregado, hacerlo en una receta aparte. El re-refinamiento de esta US espera
esa respuesta: si cambia, cambian el CA-2 y su escenario Gherkin.
