# US-73 — `just audit`: secretos en el historial y dependencias vulnerables

> Safari no busca secretos filtrados ni dependencias con CVE conocidas. Es un
> monorepo con cuatro gestores de dependencias, código heredado de Pickbazar
> y credenciales de demo por todas partes. Esta US añade una receta
> `just audit` que corre Gitleaks (historial y copia de trabajo) y
> OSV-Scanner (los cuatro lockfiles) en Docker, **solo reportando**: no
> bloquea y no entra en `just check`.

**Épico:** [Épico 9](./README.md)
**Fecha:** 2026-10-24
**Status:** Listo para ejecución — con propuesta por defecto en DA-1..DA-3.
**Depende de:** ninguna dura. Toca el `justfile`, como US-10 y US-12: no va
en paralelo con ellas.
**LOC est.:** ~150 (receta, dos `.toml` y un resumen)

## Historia

**Como** dueño de un repo didáctico que está en GitHub, **quiero** saber si
hay un secreto en el historial de git o una dependencia con una
vulnerabilidad conocida, **para** decidir qué arreglar con datos en vez de
suponer que todo está bien.

## Contexto — verificado (2026-10-24)

**Lockfiles de safari** (rutas comprobadas con `ls`):

| Lockfile | Gestor | Qué cubre |
|---|---|---|
| `apps/yarn.lock` | yarn 1 (workspace de `apps/`) | shop, admin/rest y admin/graphql |
| `apps/api/rest/yarn.lock` | yarn 1 aparte (la API está fuera del workspace) | API NestJS |
| `packages/db/package-lock.json` | npm | `@safari/db` |
| `services/scraper-worker/requirements.txt` | pip | el scraper |

`apps/api/graphql` no tiene lockfile propio.

**Secretos:**

- Los cinco `.env` reales están ignorados por git (ver US-72); las
  plantillas versionadas son `.env.example` y `.env.template`.
- Hay credenciales de demo **a propósito**: `docker-compose.yml`
  (`safari/safari`), el hash bcrypt de `demodemo` del seed
  (`HASH_DEMO`, `db/generate-seed.mjs:87`) y los JSON del mock de
  Pickbazar. Es esperable que Gitleaks marque algunas: cada una se decide
  como excepción fechada o como hallazgo.

**El original de bingo-flow** (`justfile:132-194`, receta `audit`):

- **Imágenes por digest**, con la versión y la fecha en un comentario
  (`:135-142`): `ghcr.io/gitleaks/gitleaks@sha256:…`,
  `ghcr.io/google/osv-scanner@sha256:…`, `semgrep/semgrep@sha256:…`.
- **Los archivos entran al contenedor por `tar` en stdin, no por bind
  mount** (`:147-151`). En Docker Desktop sobre Windows el montaje hacía que
  Semgrep tardara más de 10 minutos y Gitleaks 4 minutos en leer `.git`, y
  con `tar` solo entra lo que lista git.
- **CAs del proxy:** si existe `SSL_CERT_FILE`, se monta en los contenedores
  que salen a la red (`:152-156`). En la máquina del dueño hay Zscaler
  (`CLAUDE.md:165`, el puerto 9000), así que OSV lo necesita para consultar su
  base de datos.
- `export MSYS_NO_PATHCONV=1` (`:157`) evita que Git Bash reescriba las
  rutas `/src` y `/repo` del contenedor como rutas de Windows.
- **Corre todo aunque algo encuentre hallazgos** y solo falla si una
  herramienta no pudo ejecutarse (`:136`). Termina con un resumen
  (`scripts/audit/summary.mjs`) y con un chequeo de que ningún valor de un
  `.env` aparezca en los informes (`scripts/audit/leak-check.mjs`).
- Gitleaks se corre dos veces: sobre el historial (`tar -cf - .git`, `:166-170`)
  y sobre lo no commiteado (`git ls-files -m -o --exclude-standard`,
  `:172-177`).
- **Excepciones con fecha de vencimiento:**
  - `.gitleaks.toml:4-9` usa `[[allowlists]]` con `condition = "AND"` (ruta
    **y** valor), porque una excepción solo por ruta silenciaría cualquier
    secreto real que se escriba después en ese archivo. Cada excepción lleva
    encima «motivo · quién lo decidió · fecha · vence».
  - `osv-scanner.toml:4-11` usa `[[IgnoredVulns]]` con `ignoreUntil` y
    `reason`.

**El `justfile` de safari** usa `set shell := ["bash", "-uc"]` (`:13`) y ya
tiene recetas con shebang `#!/usr/bin/env bash` (`:47`, `:96`), así que el
patrón de bingo se puede copiar sin cambiar de shell. Docker ya está, porque
lo usa Postgres.

## Opciones evaluadas

| Opción | Qué es | A favor | En contra |
|---|---|---|---|
| **(a) Docker, por digest, con `tar` por stdin** | Como bingo | Sin instalar nada en el host; versión fijada; rápido en Windows | Requiere Docker Desktop arriba, que ya lo está para Postgres |
| (b) Binarios locales (`gitleaks.exe`, `osv-scanner.exe`) | Instalación manual o con `winget` | Sin Docker | Una instalación más por máquina, versión no fijada en el repo y otra en CI |
| (c) `yarn audit` / `npm audit` / `pip-audit` | Un auditor por gestor | Nativos | Cuatro herramientas con cuatro formatos de salida y cuatro criterios de severidad. OSV cubre los cuatro lockfiles con un solo formato y una sola base de avisos |

**Recomendación: (a).**

## Decisiones abiertas para el dueño

> **Confirmadas por el dueño (2026-10-24):** DA-1..DA-3 en su propuesta por defecto.

| # | Tema | Opciones | Propuesta por defecto |
|---|---|---|---|
| DA-1 | Semgrep (análisis estático de seguridad) | **(a)** Fuera de esta US. **(b)** Dentro, con `p/typescript`, `p/nestjs` y `p/react` | **(a)**. El código de Pickbazar dará cientos de avisos de estilo de seguridad, y triarlos es una US en sí. Gitleaks y OSV tienen hallazgos binarios (hay o no hay) |
| DA-2 | Variantes GraphQL (`apps/admin/graphql`, `apps/api/graphql`) | **(a)** Se escanean (comparten `apps/yarn.lock` y están en el historial) y sus hallazgos se marcan aparte. **(b)** Se excluyen, alineado con lo que decida US-12 | **(a)** hasta que US-12 decida. Si US-12 las congela o las borra, esta receta se ajusta en ese momento. Excluirlas antes escondería secretos reales del historial |
| DA-3 | ¿Bloquea algo? | **(a)** Nada bloquea: solo falla si una herramienta no pudo ejecutarse, como en bingo. **(b)** Un secreto nuevo en la copia de trabajo bloquea | **(a)**. La primera corrida es la línea base; bloquear se decide con datos, en una US posterior |

## Scope

**Incluye:**

- receta `audit` en el `justfile`, grupo `verify`, que corre:
  - Gitleaks sobre el historial;
  - Gitleaks sobre lo no commiteado;
  - OSV-Scanner sobre los cuatro lockfiles (varios `--lockfile`).

  Usa imágenes por digest, entrada por `tar` en stdin,
  `MSYS_NO_PATHCONV=1` y el `SSL_CERT_FILE` opcional para el proxy;
- `.gitleaks.toml` con `useDefault = true` y las excepciones de la primera
  corrida que sean falsos positivos **demostrados**, en el formato de bingo;
- `osv-scanner.toml`, que nace sin excepciones y explica el formato;
- salida en una carpeta ignorada por git (por ejemplo `.analysis/`, que hay
  que añadir a un `.gitignore`), más un resumen por herramienta en la
  terminal;
- una línea en el comentario de cabecera del `justfile`.

**NO incluye:**

- Semgrep (DA-1);
- arreglar las vulnerabilidades o rotar los secretos que salgan: cada uno es
  una US, o se acepta con su excepción fechada;
- meter `audit` en `just check` (US-10) o en CI (US-11). Que CI lo corra es
  una extensión natural de US-11 una vez exista la línea base;
- `knip`, `madge` o cualquier análisis de código muerto;
- reescribir el historial de git si aparece un secreto: eso es destructivo y
  lo decide el dueño aparte.

## Criterios de aceptación

### CA-1 — Corre de punta a punta

`just audit` termina con las tres ejecuciones hechas (historial, copia de
trabajo y OSV), deja tres JSON en la carpeta de salida e imprime un resumen
con cuántos hallazgos tiene cada una. Sale con 0 aunque haya hallazgos.

### CA-2 — Falla solo si no pudo correr

Con Docker parado, `just audit` sale distinto de 0 y dice qué herramienta no
pudo ejecutarse, sin un stacktrace.

### CA-3 — Los cuatro lockfiles

El JSON de OSV lista paquetes de los cuatro ecosistemas: los dos `yarn.lock`,
el `package-lock.json` y el `requirements.txt`.

### CA-4 — Excepciones honestas

Cada excepción de `.gitleaks.toml` es `condition = "AND"` (ruta y valor) y
lleva «motivo · quién · fecha · vence». Ninguna excepción solo por ruta.

### CA-5 — Los informes no filtran secretos

Ningún valor de los cinco `.env` reales aparece en los JSON de salida:
Gitleaks se corre con `--redact`, y se comprueba con un chequeo como
`leak-check.mjs` de bingo.

## Escenarios Gherkin

```gherkin
Feature: Auditoria de secretos y dependencias
  Scenario: CA-1 — reporta sin bloquear
    Given Docker arriba
    When corro just audit
    Then se generan los informes de Gitleaks y OSV
    And la receta sale con 0 aunque haya hallazgos

  Scenario: CA-2 — una herramienta no corre
    Given Docker parado
    When corro just audit
    Then la receta sale distinto de 0 y nombra la herramienta que fallo
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `justfile` | receta `audit` (grupo `verify`) y línea de cabecera |
| `.gitleaks.toml` | nuevo |
| `osv-scanner.toml` | nuevo |
| `.gitignore` (raíz) o el de la carpeta de salida | ignorar los informes |
| `scripts/audit/*.mjs` | solo si el resumen y el chequeo de fugas no caben en la receta |

## Definición de Done

- [ ] DA-1..DA-3 confirmadas por el dueño y anotadas aquí.
- [ ] Salida real de `just audit` pegada (resumen y conteos por herramienta).
- [ ] CA-2 con Docker parado: salida pegada.
- [ ] CA-3: un extracto del JSON de OSV con un paquete de cada ecosistema.
- [ ] Cada hallazgo de la primera corrida clasificado: falso positivo (va a
  `.gitleaks.toml` con fecha) o hallazgo real (va al reporte como candidato
  a US). **Nunca** se pega un secreto real en este documento.
- [ ] CA-5 con su comprobación pegada.
- [ ] Status actualizado aquí, en la tabla del épico y en el mapa.

## Notas para el agente ejecutor

- **Fija los digest de imágenes publicadas hace al menos 30 días**, con la
  versión y la fecha en el comentario, como `bingo-flow/justfile:137-142`.
  No uses `:latest`.
- **Usa `tar` por stdin, no `-v $(pwd):/src`.** En esta máquina el bind
  mount de Docker Desktop es muy lento sobre `.git` y `node_modules`
  (medido en bingo, `justfile:147-151`).
- **Zscaler:** si OSV falla con un error TLS al consultar
  `api.osv.dev`, es el proxy. Exporta `SSL_CERT_FILE` con el bundle
  corporativo antes de correrlo, como hace bingo (`:152-156`).
- **El historial de safari** tiene 180 commits y un `.git` de 19 MB
  (2026-10-24); `aed4d5b` importó Pickbazar entero. Mide cuánto tarda
  Gitleaks sobre `.git` y anótalo en la receta.
- **Si aparece un secreto real en el historial, PARA.** No lo pegues en
  ningún documento ni en la conversación; dile al dueño en qué archivo y en
  qué commit está, y que la rotación y la reescritura del historial son
  decisiones suyas.
