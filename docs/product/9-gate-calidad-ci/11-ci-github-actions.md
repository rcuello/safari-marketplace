# US-11 — CI en GitHub Actions

> Subir el gate local (`just check`) a un workflow de GitHub Actions con
> Postgres como service container, para que cada push a main quede verificado
> sin depender de la máquina de nadie.

**Épico:** [Épico 9](./README.md)
**Fecha:** 2026-08-25
**Status:** Refinado — requiere re-refinamiento (ver Actualización 2026-10-24)
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

## Actualización tras el escaneo de bingo-flow (2026-10-24)

> Sección añadida sin reescribir lo anterior. Fuente: el workflow de CI del
> proyecto hermano `C:\DevOps\MyGitHub\games\bingo-flow\.github\workflows\ci.yml`
> (US-30 de bingo-flow). Lo que sigue son CA nuevos y notas para el ejecutor;
> el re-refinamiento decide si se quedan como CA o bajan a notas.

### Endurecimiento de CI tomado de bingo-flow

#### CA-5 — Actions fijadas por SHA
Toda `uses:` del workflow apunta a un SHA de commit completo, con el tag
legible en un comentario de la misma línea (p. ej.
`actions/checkout@<sha> # vX.Y.Z`). Un tag es mutable; el SHA no.
Referencia: `ci.yml:5-7` (la justificación) y `ci.yml:26`, `ci.yml:30`,
`ci.yml:32` (checkout, pnpm/action-setup y setup-node fijados así). Aplica
también a la acción con la que se instale `just` (ver la nota original de
"fijar la versión").

#### CA-6 — Permisos mínimos del token
El workflow declara `permissions: contents: read` a nivel de workflow (no por
job), de modo que ningún paso recibe escritura por defecto. Referencia:
`ci.yml:15-16`.

#### CA-7 — Corridas superadas se cancelan
El workflow declara `concurrency` agrupado por ref con
`cancel-in-progress: true`: un push nuevo a la misma rama/PR cancela la corrida
anterior. Referencia: `ci.yml:18-20`. Complementa la R-1 del épico (tiempo de
instalación): no se paga dos veces el `yarn install` de una rama que ya cambió.

#### CA-8 — Lockfiles congelados
Ninguna instalación del CI puede reescribir un lockfile; un `package.json`
desincronizado de su lockfile pone el workflow en rojo. Referencia:
`ci.yml:37-40` (`pnpm install --frozen-lockfile`). En safari son tres
instalaciones, con lockfiles verificados con `ls` el 2026-10-24:

| Directorio | Comando en CI | Lockfile |
|---|---|---|
| `apps/` (workspace de yarn) | `yarn install --frozen-lockfile` | `apps/yarn.lock` |
| `apps/api/rest` (fuera del workspace) | `yarn install --frozen-lockfile` | `apps/api/rest/yarn.lock` |
| `packages/db` (npm, autónomo) | `npm ci` | `packages/db/package-lock.json` |

No hay `yarn.lock` en la raíz del repo. La sección Contexto dice
"`npm install` de `packages/db`": en CI debe ser `npm ci`. Si `just setup` /
`just db-build` usan `yarn install` / `npm install` a secas, el workflow no
puede delegar la instalación en esas recetas sin desviarse, y el desvío se
documenta en el workflow (regla de la sección Contexto).

#### Nota — variables de entorno ficticias para jest
`cd apps/api/rest && npx jest` mockea `@safari/db` (31 archivos de `src/`
contienen `jest.mock('@safari/db'...)`), así que no necesita Postgres, pero en
local hereda `apps/api/rest/.env`, que en el runner no existe. bingo-flow
resolvió lo mismo con valores ficticios en el `env:` del paso de tests
(`ci.yml:44-55`: `DATABASE_URL` y `JWT_SECRET` falsos, con un comentario que
explica por qué ninguno tiene valor real). En safari, las variables que lee
`apps/api/rest/src` (grep de `process.env.` del 2026-10-24) son `JWT_SECRET`,
`JWT_EXPIRES_IN`, `DEFAULT_CURRENCY`, `SHOP_URL`, `PORT`, `STRIPE_API_KEY`,
`PAYPAL_SANDBOX_CLIENT_ID` y `PAYPAL_SANDBOX_CLIENT_SECRET`. El ejecutor
confirma en un clon limpio, sin `.env`, cuáles hacen falta de verdad para que
las 34 suites pasen (565 tests, medido el 2026-10-24), y declara solo esas, con valores evidentemente ficticios y
un comentario como el de bingo. Ningún secreto real entra al workflow.

#### Lo que safari NO copia de bingo-flow
El CI de bingo-flow corre **sin Postgres** (`ci.yml:1-3`: "Sin Postgres:
ninguno de esos pasos lo necesita"). Safari no puede: el **CA-4** de esta US
exige aplicar `db/schema.sql` + `db/seed.sql` al Postgres del CI y correr
`db-check` contra esa base real, y el Contexto ya prevé el service container
de `postgres:16-alpine`. El endurecimiento de arriba se suma al CA-4; no lo
reemplaza. Solo los tests de jest de `apps/api/rest` pueden ir sin base (por
el mock), igual que en bingo.

### El `--fix` del lint de la API

`apps/api/rest/package.json:16` define
`"lint": "eslint \"{src,apps,libs,test}/**/*.ts\" --fix"`. Con `--fix`, eslint
**reescribe** los archivos que puede corregir y solo falla por lo que no
puede: en CI eso convierte un error de formato en verde silencioso sobre un
árbol modificado que nadie commitea.

- **CA-9 — Lint de solo lectura en CI.** El workflow invoca el lint de la API
  sin `--fix` (p. ej. `npx eslint "{src,apps,libs,test}/**/*.ts"`), y un
  error de lint pone el job en rojo.
- Como esta US delega en `just check` (US-10), y US-10 lista
  `apps/api/rest` `yarn lint` entre sus piezas, la receta de US-10 **tampoco**
  debe usar el script `lint` tal cual: tiene que llamar a eslint sin `--fix`
  (o a un script de solo lectura). Esa corrección es de US-10, no de esta US
  (el "NO incluye" excluye tocar la composición del gate); aquí solo se deja
  la exigencia para que el re-refinamiento de US-10 la recoja. Cambiar el
  script `lint` del `package.json` queda fuera del scope de ambas salvo que
  US-10 lo decida.

### Dependencia con US-10

La cabecera declara **Depende de: US-10**, y el endurecimiento no cambia ese
orden: los CA-5 a CA-9 se refieren a cómo se escribe el workflow (pinning,
permisos, concurrencia, instalación, entorno), no a qué corre el gate. US-11
sigue esperando a que `just check` exista y a que su lint corra sin `--fix`.
