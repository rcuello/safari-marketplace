# US-15 — Compose del stack completo con healthchecks

> `docker compose up` levanta Postgres + API + tienda + admin con
> healthchecks y dependencias ordenadas, y `just verify` pasa contra los
> contenedores.

**Épico:** [Épico 13](./README.md)
**Fecha:** 2026-08-25
**Status:** Listo para ejecución
**Depende de:** US-14
**LOC est.:** ~250

## Historia
**Como** profesor que demuestra sistemas distribuidos, **quiero** levantar el
marketplace completo con un comando, **para** enseñar la arquitectura sin
gastar la primera hora de clase en tres terminales y dos instalaciones de
yarn.

## Contexto

- US-14 deja Postgres + API en compose; faltan shop y admin.
- Riesgo central heredado del épico (R-1): las `NEXT_PUBLIC_*` se inlinean en
  build time y el navegador las usa desde el host (`localhost:9001`), pero el
  SSR corre dentro de la red de compose. La imagen de los frontends se
  construye con la URL pública y el SSR debe poder resolverla (extra_hosts,
  o URL interna para SSR si el código lo permite — decidir en el design con
  evidencia del código del framework REST del shop).
- `next build` requiere los `.env` con placeholders resueltos; el patrón está
  en `just env`.

## Scope
**Incluye:** Dockerfiles multi-stage de `apps/shop` y `apps/admin/rest`,
servicios en el compose con healthchecks y `depends_on` correctos, args de
build para las `NEXT_PUBLIC_*`, receta `just` para levantar/bajar el stack
completo, y sección nueva en `apps/README.md` documentando el camino Docker.
**NO incluye:** la variante GraphQL, hot-reload en contenedores, TLS/dominios,
registry/push de imágenes, despliegue remoto (Épico 16).

## Criterios de aceptación

### CA-1 — Un comando, stack completo
Desde un working tree limpio (con imágenes ya construidas), un solo comando
(`docker compose up` o su receta just) deja los 4 servicios corriendo.

### CA-2 — `just verify` contra contenedores
`just verify` pasa: API 200 en `/api/settings`, shop 200 en `/en` con product
cards, admin 200 en `/en/login`.

### CA-3 — Healthchecks honestos
Cada servicio de app tiene healthcheck propio; `docker compose ps` los muestra
healthy, y matar la base pone unhealthy a la API (no silencio).

### CA-4 — Arranque ordenado desde cero
`docker compose down -v && up` (base vacía) termina con el stack sano y la
base sembrada (esquema+seed aplicados por el mecanismo D-2 del épico).

## Escenarios Gherkin
```gherkin
Feature: Stack completo en compose
  Scenario: CA-2 — smoke oficial
    Given el stack levantado con la receta just
    When corro just verify
    Then los tres servicios responden 200 con contenido real
```

## Archivos a crear / modificar
| Archivo | Cambio |
|---------|--------|
| `apps/shop/Dockerfile` | multi-stage con build args NEXT_PUBLIC_* |
| `apps/admin/rest/Dockerfile` | ídem |
| `docker-compose.yml` | servicios shop/admin + healthchecks + orden |
| `justfile` | recetas del stack dockerizado |
| `apps/README.md` | sección del camino Docker |

## Definición de Done
- [ ] Salida real de `docker compose ps` con los 4 servicios healthy pegada.
- [ ] Salida real de `just verify` en verde contra los contenedores pegada.
- [ ] Evidencia del CA-4 (up desde volumen borrado) pegada.
- [ ] Tiempos de build documentados (R-2 del épico).
- [ ] Status de esta US actualizado y fila del épico marcada.

## Notas para el agente ejecutor
- Es la US más pesada del épico por los builds de Next en Docker: si el design
  concluye que shop y admin no caben juntos en una sesión, PARAR y proponer el
  split (shop primero) antes de ejecutar a medias.
- No usar `APPLICATION_MODE=production` para silenciar errores de TS en el
  build sin decirlo: si hace falta, queda documentado en el Dockerfile y en el
  reporte.
