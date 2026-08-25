# Épico 13 — Orquestación local con Docker

> Hoy levantar el entorno son tres terminales (`api-dev`, `shop-dev`,
> `admin-dev`) más el Postgres de Docker. Este épico lleva el stack completo a
> `docker compose up`, que además es el peldaño previo a cualquier despliegue
> en nube (Épico 16).

**Fecha:** 2026-08-25
**Status:** Refinado

## Contexto verificado (2026-08-25)

- `docker-compose.yml` orquesta hoy SOLO Postgres (puerto 5433, healthcheck,
  volumen). Ningún servicio de la app tiene Dockerfile.
- Datos de `apps/README.md` relevantes para contenedores:
  - Los tres servicios son stateless; `api/rest` lee `PORT` del entorno.
  - Las `NEXT_PUBLIC_*` se inlinean **en build time** — hay que fijarlas antes
    de `next build`, no al arrancar el contenedor.
  - `next.config.js` tiene allowlist de `images.domains`.
  - Con `APPLICATION_MODE=production` el build ignora errores de TS/ESLint.
  - `apps/deployment/` trae scripts zx para VM+Nginx: referencia, no el camino.
- `api/rest` está fuera del workspace de yarn (instalación propia) y desde la
  migración de `/api/settings` necesita `DATABASE_URL` y el build de
  `packages/db` (vía `link:`): el Dockerfile de la API debe construir
  `packages/db` dentro de la imagen.

## Subdivisión en sub-historias

| US | Título | Releasable solo | Depende de | LOC est. |
|----|--------|-----------------|------------|----------|
| [US-14](./14-dockerizar-api-rest.md) | Dockerizar la API REST | Sí | ninguna | ~150 |
| [US-15](./15-compose-stack-completo.md) | Compose del stack completo con healthchecks | Sí | US-14 | ~250 |

**Orden sugerido:** US-14 → US-15 (US-15 dockeriza shop/admin dentro de su
propio alcance; si en el design crece de más, partirla antes de ejecutar).

## Refinamiento — Decisiones tomadas

| # | Tema | Decisión |
|---|------|----------|
| 1 | Compose único | Se extiende el `docker-compose.yml` existente (perfiles o servicios nuevos), no se crea un compose paralelo; el flujo `just db-up` actual debe seguir funcionando igual. |
| 2 | Dev nativo se conserva | `just api-dev`/`shop-dev`/`admin-dev` siguen siendo el camino de desarrollo con hot-reload; el compose es para stack completo reproducible, no lo reemplaza. |
| 3 | Puertos | Se respetan los del justfile (API 9001, shop 3003, admin 3002) para que `just verify` sirva de smoke sin cambios. |

## Visión técnica compartida

### Decisiones de Diseño (D-N)
- **D-1:** Imágenes multi-stage (deps → build → runtime) para no embarcar
  node_modules de build.
- **D-2:** El seed/esquema sigue siendo responsabilidad de `just db-migrate`
  (o un init container que ejecute lo mismo) — una sola fuente de verdad.

### Riesgos (R-N)
- **R-1:** `NEXT_PUBLIC_REST_API_ENDPOINT` apunta a `localhost:9001` desde el
  navegador pero la red interna de compose usa nombres de servicio: el build
  de los frontends debe hacerse con la URL pública, y el SSR debe poder
  alcanzar la API — resolver explícitamente en el design de US-15.
- **R-2:** Los builds de Next dentro de Docker sin caché pueden ser muy
  lentos; documentar tiempos y cache mounts.

## Notas globales para los agentes

- `just verify` es el smoke oficial del stack: el compose se considera vivo
  cuando `just verify` pasa contra los contenedores.
- No tocar los `.env` versionados como plantillas; los contenedores reciben
  su config por environment del compose.
