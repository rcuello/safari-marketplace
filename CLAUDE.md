# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Proyecto

`safari-marketplace` — monorepo didáctico para enseñar sistemas distribuidos.
Integra una tienda e-commerce (Pickbazar: Next.js + NestJS), una capa de datos
Prisma sobre PostgreSQL y un scraper multi-tienda (Python/Scrapy/Playwright)
que recolecta productos tecnológicos de 6 retailers colombianos. El README
raíz menciona despliegue automatizado con Terraform: **hoy no existe ningún
archivo Terraform en el repo** (es una promesa, no un hecho — ver Épico 16
del backlog).

La prosa del repo (commits, docs, comentarios) va en **español neutral**;
nombres de archivo, slugs, claves de config e identificadores en
inglés/kebab-case.

## Comandos

Todo se orquesta con `just` desde la raíz (`just` a secas lista las tareas;
el detalle de cada paso está en `apps/README.md`).

```bash
# Setup (una vez; ~15 min por las dos instalaciones de yarn)
just doctor            # comprueba node/yarn/python/.env/deps
just setup             # crea los .env desde plantillas + yarn install x2

# Desarrollo (tres terminales; SIEMPRE la API primero — los frontends hacen SSR)
just api-dev           # NestJS  -> http://localhost:9001/api  (Swagger en /docs)
just shop-dev          # tienda  -> http://localhost:3003
just admin-dev         # admin   -> http://localhost:3002
just verify            # los 3 responden con contenido real (cuenta product-cards)
just check-ports       # diagnóstico de puertos ocupados (Zscaler usa el 9000)

# Base de datos (Postgres 16 en Docker, puerto 5433)
just db-up             # levanta el contenedor + aplica db/schema.sql + db/seed.sql
just db-shell          # psql interactivo
just db-reset          # borra el volumen y recrea desde cero
just db-build          # packages/db: npm install + prisma generate + tsup -> dist/
just db-check          # packages/db: typecheck + tests de integración (requiere db-up)

# Scraper (Python 3.11+, venv propio en services/scraper-worker/.venv)
just scraper-install   # venv + requirements + Chromium de Playwright
just spiders           # lista los 6 spiders (alkosto|compulago|compuworking|exito|falabella|tauret)
just scrape <spider>   # corre un spider
just db-test           # prueba el pipeline contra la base sin salir a internet
                       # OJO: HOY ROTO — el pipeline escribe en la tabla `productos`,
                       # que ya no existe en db/schema.sql (ver US-6 del backlog)

# Build de producción
just build             # shop + admin (detener los `dev` antes: comparten .next)
just build-api         # compila la API a dist/
```

No hay gate de tests repo-wide todavía (es US-10 del backlog). El único test
automatizado que existe y pasa es `just db-check` (vitest de integración en
`packages/db`, requiere `just db-up` antes). `apps/api/rest` declara jest en
su `package.json` pero no tiene ningún `*.spec.ts`.

## Arquitectura

```
apps/
├── shop/           Next.js 13.5 (pages router), @pick-bazar/shop, puerto 3003.
│                   Variantes dev:rest (la usada) y dev:gql (requiere codegen graphql-let).
├── admin/rest/     Next.js 13.5, panel de administración, puerto 3002.
├── admin/graphql/  Variante GraphQL del admin (instalada por el workspace, no usada en el stack REST).
├── api/rest/       NestJS 9. API mock: sirve JSON estático desde src/db/pickbazar/,
│                   SALVO /api/settings, que ya sale de Postgres vía @safari/db.
│                   FUERA del workspace de yarn: requiere su propio `yarn install`.
├── api/graphql/    Variante GraphQL de la API (no usada en el stack REST).
└── deployment/     Scripts zx originales de Pickbazar para VM+Nginx (referencia, no el camino).

packages/
└── db/             @safari/db — capa de datos: Prisma 7 + @prisma/adapter-pg.
                    Cliente singleton + repositorios de funciones planas por agregado.
                    Autónomo (npm, NO yarn workspace). Se construye con tsup a dist/
                    (CJS + .d.ts) para que Nest lo consuma vía `link:`. dist/ y
                    generated/ están gitignored: tras clonar, `just db-build`.

db/                 Fuente de verdad del catálogo compartido:
                    schema.sql (DDL comentado) + seed.sql (GENERADO desde los JSON
                    del mock por generate-seed.mjs) + README.md (el modelo).

services/
└── scraper-worker/ Scrapy + Playwright. 6 spiders de retailers colombianos.
                    Migrado de MongoDB a PostgreSQL (psycopg). Su schema.sql es un
                    tombstone: el esquema vive en db/. PENDIENTE: pipelines.py aún
                    upserta en la tabla `productos`, que ya no existe (US-6).

docker-compose.yml  Solo Postgres 16 (safari/safari@localhost:5433/safari_scraper).
justfile            Todas las tareas, en español, agrupadas (setup/dev/build/verify/bd/scraper/limpieza).
```

### Reglas que sostienen el diseño

- **`db/schema.sql` es la fuente de verdad del DDL.** Se aplica con
  `just db-migrate` (idempotente, `IF NOT EXISTS` — NO altera tablas
  existentes; para adoptar un cambio de esquema: `just db-reset`). No hay
  migraciones incrementales.
- **`packages/db/prisma/schema.prisma` NO genera migraciones.** Sale de
  `prisma db pull` contra la base real + renombres manuales. Las CHECK
  constraints y el índice trigram que Prisma no modela se validan en los
  repositorios y se documentan en la cabecera del schema. No quitar el
  preview `partialIndexes` (el unique parcial de procedencia lo necesita).
- **Contratos HTTP preservados byte a byte** al migrar endpoints del mock a
  Postgres. La API publica snake_case (lo que el frontend consume); la capa
  de datos devuelve camelCase; la traducción vive en los servicios de Nest.
  Precedente verificado: `/api/settings` (5503 bytes idénticos).
- **El scraper no tiene esquema propio.** Escribe en la MISMA tabla
  `products` que consulta la tienda; sus filas se distinguen por
  `source_store`/`source_product_id`/`source_url` y un unique parcial que
  permite upsert idempotente. Su `categorizar()` debe devolver los slugs de
  categoría que ya existen en el catálogo (tabla en `db/README.md`), no
  inventar los suyos.
- **Puertos:** API 9001 (el 9000 lo ocupa Zscaler en equipos corporativos),
  shop 3003, admin 3002, Postgres 5433. `just API_PORT=XXXX set-api-port`
  sincroniza los tres `.env` de una vez.

## Flujo spec-driven (SDD)

- `docs/product/` guarda épicos e historias de usuario (en español neutral;
  ver su README para numeración y plantillas) — leer la US objetivo y el
  README de su épico antes de tocar código.
- `openspec/specs/` refleja las specs implementadas por slug;
  `openspec/changes/` guarda propuestas en curso/archivadas.
  `openspec/config.yaml` es la configuración SDD del repo.
- **Store de persistencia: openspec-only.** El MCP de Engram NO está
  conectado en esta máquina; si los archivos de `.claude/skills/_shared/`
  mencionan Engram, esa rama no aplica — todo artefacto SDD vive en
  `openspec/`.
- Los comandos (`/sdd-new`, `/sdd-continue`, `/sdd-status`, …), agentes y
  skills SDD viven versionados en `.claude/` **de este repo** (skills de
  proyecto en `.claude/skills/`; ninguna referencia a `~/.claude/skills/`).
- Una US = una sesión de agente; lo que el "NO incluye" de una US excluye no
  se implementa aunque sea adyacente y fácil — se menciona en el reporte
  final en vez de accionarlo.
- La Definición de Done se cierra con salida real de comandos pegada
  (`just db-check`, `just db-test`, `just verify`, `curl`, builds), nunca
  con "debería funcionar".
