# US-14 — Dockerizar la API REST

> Un Dockerfile multi-stage para `apps/api/rest` que construye `packages/db`
> dentro de la imagen y corre `node dist/main`, integrado al compose junto a
> Postgres.

**Épico:** [Épico 13](./README.md)
**Fecha:** 2026-08-25
**Status:** Listo para ejecución
**Depende de:** ninguna
**LOC est.:** ~150

## Historia
**Como** estudiante, **quiero** levantar la API con `docker compose up api`,
**para** tener el backend reproducible sin instalar Node/yarn en el host y
como pieza base del stack completo (US-15) y del despliegue (Épico 16).

## Contexto

- `api/rest` compila con `yarn build` (nest build) y corre con
  `node dist/main`; lee `PORT` del entorno (fallback 5000).
- Depende de `@safari/db` por `link:../../../packages/db`, cuyo `dist/` y
  `generated/` están gitignored: la imagen DEBE construir `packages/db`
  (npm install + prisma generate + tsup) antes del build de Nest.
- Necesita `DATABASE_URL` (desde la migración de `/api/settings`); dentro de
  la red de compose el host es el servicio `postgres` en su puerto interno
  5432, no `localhost:5433`.

## Scope
**Incluye:** Dockerfile multi-stage de la API (contexto de build que abarque
`packages/db`), `.dockerignore`, servicio `api` en el compose (depends_on
postgres healthy, environment con `PORT` y `DATABASE_URL`), y receta
`just`/documentación mínima para levantarla.
**NO incluye:** dockerizar shop/admin (US-15), CI de imágenes, registry/push,
hot-reload dentro del contenedor, tocar el código de la API.

## Criterios de aceptación

### CA-1 — La imagen construye desde cero
`docker build` termina OK en un working tree limpio (sin `dist/` ni
`node_modules` locales previos), demostrando que `packages/db` se construye
dentro.

### CA-2 — La API responde desde el contenedor
Con `docker compose up`, `curl http://localhost:9001/api/settings` responde
200 con el JSON real (que sale de Postgres, no del mock).

### CA-3 — Espera a la base
El servicio `api` arranca después del healthcheck de Postgres; un
`docker compose up` desde cero (volumen borrado) no deja la API caída por
carrera con la base.

### CA-4 — El flujo actual no se rompe
`just db-up` y el desarrollo nativo (`just api-dev`) siguen funcionando igual.

## Escenarios Gherkin
```gherkin
Feature: API en contenedor
  Scenario: CA-2 — settings desde el contenedor
    Given docker compose up con la base sembrada
    When pido GET /api/settings en el puerto publicado
    Then recibo 200 con el payload de settings desde Postgres
```

## Archivos a crear / modificar
| Archivo | Cambio |
|---------|--------|
| `apps/api/rest/Dockerfile` (o raíz, según contexto de build elegido) | multi-stage build |
| `.dockerignore` | excluir node_modules/.next/dist locales |
| `docker-compose.yml` | servicio `api` |
| `justfile` | receta para el stack dockerizado (si el design la define acá y no en US-15) |

## Definición de Done
- [ ] Salida real (resumida) del `docker build` limpio pegada.
- [ ] Salida real del `curl` a `/api/settings` contra el contenedor pegada.
- [ ] Evidencia del CA-3 (up desde volumen borrado) pegada.
- [ ] Salida real de `just verify` (o su equivalente parcial para la API) pegada.
- [ ] Status de esta US actualizado y fila del épico marcada.

## Notas para el agente ejecutor
- El contexto de build debe incluir `packages/db` Y `apps/api/rest`: decidir
  en el design si el contexto es la raíz del repo con `.dockerignore` fuerte
  (recomendación inicial) o un contexto compuesto.
- `db/schema.sql`/seed siguen aplicándose por `just db-migrate` (D-2 del
  épico): la imagen de la API no siembra la base.
