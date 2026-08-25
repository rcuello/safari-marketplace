# US-17 — Endpoint de salud y logging con timestamps en la API

> La API expone `/api/health` (liveness) y `/api/health/ready` (readiness con
> ping a Postgres), y sus logs llevan timestamp y nivel: lo mínimo para que un
> healthcheck de compose/nube no mienta y un incidente sea diagnosticable.

**Épico:** [Épico 16](./README.md)
**Fecha:** 2026-08-25
**Status:** Listo para ejecución
**Depende de:** ninguna
**LOC est.:** ~150

## Historia
**Como** operador del stack (compose hoy, nube mañana), **quiero** distinguir
"la API está viva" de "la API puede servir datos", **para** que los
healthchecks reinicien/enruten con criterio y los logs permitan reconstruir
qué pasó y cuándo.

## Contexto

- Hoy no hay endpoint de salud; el healthcheck natural sería `/api/settings`,
  que acopla liveness a Postgres (una base caída haría reiniciar un proceso
  sano).
- `packages/db` tiene `src/health.ts` (verificar qué expone — probablemente
  un ping a la base reutilizable para readiness).
- Los logs de Nest salen sin timestamp configurado; en contenedores, sin
  marca de tiempo por línea un incidente no se puede reconstruir.

## Scope
**Incluye:** módulo de health en `apps/api/rest` con liveness (sin tocar la
base) y readiness (ping real a Postgres vía `@safari/db`), logging de Nest con
timestamp + nivel (logger integrado configurado; sin introducir stack de
observabilidad externo), y actualización del healthcheck del compose (si
US-14/15 ya existen) para usar el endpoint correcto.
**NO incluye:** métricas/Prometheus, tracing, dashboards, alerting, logs de
shop/admin (frontends), rate limiting, autenticación del endpoint.

## Criterios de aceptación

### CA-1 — Liveness sin base
Con Postgres apagado (`just db-down`), `GET /api/health` responde 200 (el
proceso está vivo) mientras `GET /api/health/ready` responde 503 con cuerpo
JSON que nombra la dependencia caída.

### CA-2 — Readiness real
Con la base arriba, `/api/health/ready` responde 200 y su chequeo es un ping
real (verificable apagando la base a mitad de sesión: pasa a 503 sin
reiniciar la API).

### CA-3 — Logs con timestamp y nivel
Cada línea de log de la API lleva timestamp inequívoco y nivel; el arranque y
un request quedan trazados. Evidencia: fragmento real de log pegado.

### CA-4 — Swagger no se rompe
`/docs` sigue sirviendo y el contrato de los endpoints existentes no cambia.

## Escenarios Gherkin
```gherkin
Feature: Salud honesta de la API
  Scenario: CA-1 — base caída
    Given la API corriendo y Postgres apagado
    When pido /api/health y /api/health/ready
    Then health responde 200 y ready responde 503 nombrando a la base
```

## Archivos a crear / modificar
| Archivo | Cambio |
|---------|--------|
| `apps/api/rest/src/health/` (módulo nuevo) | controller + service de liveness/readiness |
| `apps/api/rest/src/main.ts` | logger con timestamp/nivel |
| `packages/db/src/health.ts` | solo si el ping reutilizable falta o no sirve tal cual |
| `docker-compose.yml` | healthcheck de la API apuntando a /api/health (si el servicio ya existe) |

## Definición de Done
- [ ] Salida real de los `curl` del CA-1 (ambos endpoints, base abajo y arriba) pegada.
- [ ] Fragmento real de logs con timestamps pegado.
- [ ] Salida real de `just verify` en verde.
- [ ] Status de esta US actualizado y fila del épico marcada.

## Notas para el agente ejecutor
- Revisar primero `packages/db/src/health.ts`: si ya expone el ping, la US es
  mayormente wiring en Nest.
- No usar `@nestjs/terminus` sin verificar compatibilidad con Nest 9 del
  árbol; si complica, un controller a mano cumple igual el CA.
