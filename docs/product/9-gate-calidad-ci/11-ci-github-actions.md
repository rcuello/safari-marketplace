# US-11 — CI en GitHub Actions

> Subir el gate local (`just check`) a un workflow de GitHub Actions con
> Postgres como service container, para que cada push a main quede verificado
> sin depender de la máquina de nadie.

**Épico:** [Épico 9](./README.md)
**Fecha:** 2026-08-25
**Status:** Listo para ejecución
**Depende de:** US-10
**LOC est.:** ~150

## Historia
**Como** dueño del repo, **quiero** que cada push/PR corra el mismo gate que
corro en local, **para** que un clon fresco verificable sea una garantía del
repo y no un ritual manual.

## Contexto

- No existe `.github/` en el repo; este workflow es el primero.
- El gate a ejecutar es `just check` (US-10) — el workflow lo invoca, no
  reimplementa sus pasos (si CI necesita desviarse, el desvío se documenta en
  el workflow).
- `just db-up` usa `docker compose`; en Actions el camino natural es un
  service container de `postgres:16-alpine` + aplicar `db/schema.sql` y
  `db/seed.sql` con psql. El design decide entre compose-in-CI o service
  container.
- Instalaciones: dos `yarn install` (~15 min sin caché) + `npm install` de
  `packages/db` + `pip install` del scraper si su harness ya está verde
  (Épico 5). Caching obligatorio (R-1 del épico).

## Scope
**Incluye:** un workflow `ci.yml` (push a main + pull_request) que ejecuta
`just check` con sus precondiciones (Node, yarn, just, Postgres con esquema y
seed aplicados), caching de dependencias, y badge/documentación mínima en el
README raíz.
**NO incluye:** despliegue/CD (Épico 16), matrix de versiones de Node,
publicación de artefactos, escribir tests nuevos, tocar la composición del
gate (eso es US-10).

## Criterios de aceptación

### CA-1 — Workflow verde en un push real
El workflow corre en GitHub sobre un push real y termina verde, ejecutando
`just check`.

### CA-2 — Rojo detectable
Un commit de prueba con un fallo inyectado (en rama, vía PR) pone el workflow
en rojo en el paso correcto. El commit de prueba se descarta (la rama no se
mergea).

### CA-3 — Caché efectiva
La segunda corrida con lockfiles sin cambios restaura las cachés y baja el
tiempo de instalación de forma medible (números de las dos corridas en el
reporte).

### CA-4 — Postgres real, esquema real
El job aplica `db/schema.sql` + `db/seed.sql` al Postgres del CI y el paso
`db-check` corre contra esa base (no mocks, no SQLite).

## Escenarios Gherkin
```gherkin
Feature: CI del monorepo
  Scenario: CA-1 — push verde
    Given el workflow ci.yml en main
    When pusheo un commit que pasa just check en local
    Then el workflow termina verde en GitHub
```

## Archivos a crear / modificar
| Archivo | Cambio |
|---------|--------|
| `.github/workflows/ci.yml` | el workflow |
| `README.md` | badge + una línea de cómo se verifica el repo (cambio mínimo, no reescribir el README) |

## Definición de Done
- [ ] URL/salida de la corrida verde real pegada en el reporte.
- [ ] Evidencia del CA-2 (corrida roja en PR de prueba) pegada.
- [ ] Tiempos de las corridas 1 y 2 (CA-3) pegados.
- [ ] Status de esta US actualizado y fila del épico marcada.

## Notas para el agente ejecutor
- Verificar cómo instalar `just` en el runner (acción oficial o apt) y fijar
  la versión.
- Si `just check` resulta demasiado lento para CI aún con caché, PARAR y
  proponer el recorte en US-10 (composición), no bifurcar el gate en silencio.
