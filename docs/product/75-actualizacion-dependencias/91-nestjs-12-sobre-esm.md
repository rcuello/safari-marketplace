# US-91 — NestJS 11 → 12 sobre la API ya en ESM

> Con la API en Vitest (US-88), TypeScript 6 (US-89) y ESM (US-90), queda la
> subida en sí a NestJS 12. Sustituye a [US-79](./79-nestjs-11-a-12.md), que
> se detuvo en su CA-1 porque Nest 12 obligaba a un rediseño.

**Épico:** [Épico 75](./README.md)
**Fecha:** 2026-10-24
**Status:** Listo para ejecución
**Depende de:** US-90
**LOC est.:** ~120

## Historia

**Como** mantenedor de la API, **quiero** NestJS 12, **para** dejar la API en
la última mayor del framework.

## Contexto — verificado (2026-10-24)

- **La última versión:** `@nestjs/core` 12.2.0, publicada el 2026-10-19. La
  12.1.3 es del 2026-10-12. Hay que aplicar la regla de las dos semanas el
  día de la ejecución.
- **La herramienta:** la guía de migración recomienda `nest upgrade` (del
  CLI 12), que sube todos los `@nestjs/*` a la vez. Con `--dry-run` muestra
  el reporte sin tocar archivos. Además:
  - avisa de cambios de comportamiento que no migra solo: orden de los hooks
    del ciclo de vida, firmas de pipes refinadas y parámetros del logging
    estructurado;
  - ofrece instalar `@nestjs/observe`.
- **Node:** ejecutar una app de Nest 12 pide Node 20.19 o superior (o 22.12
  en la línea 22). `nest generate` y `nest upgrade` (los schematics) piden
  **22.22.3+, 24.15+ o 26+**. La máquina del dueño tiene 22.14.0.
- **Evidencia de US-79:** con `@nestjs/*` 12.1.3 y el resto en 11, `node
  dist/main` muere con `Cannot find module
  …@nestjs/common/interfaces.js`. Algún paquete del ecosistema 11 hace un
  import profundo que el `exports` de la 12 ya no permite. Por eso todos los
  `@nestjs/*` tienen que subir juntos.
- **Swagger 12:** US-78 dejó el aviso `Duplicate DTO detected:
  "RefundPolicyPaginator" … This will throw an error in the next major
  version`. La causa está en
  `src/ownership-transfer/dto/get-ownership-transfer.dto.ts:6`.

## Decisiones abiertas para el dueño

| # | Tema | Opciones | Propuesta por defecto |
|---|---|---|---|
| DA-1 | Versión de Node | **(a)** Exigir Node 22.22.3+ (o 24.15+) en `just doctor`, para que `nest generate` funcione. **(b)** Exigir solo el mínimo para ejecutar (22.12) y documentar que `nest generate` pide más | **(a)**: el repo es didáctico y los estudiantes usan `nest generate` |
| DA-2 | `@nestjs/observe` | **(a)** No instalarlo (`nest upgrade --no-observe`). **(b)** Instalarlo | **(a)**: queda fuera de scope y cabe en el Épico 16 (observabilidad) |

## Scope

**Incluye:**

- `nest upgrade --dry-run` con su reporte pegado; después, la subida de
  todos los `@nestjs/*` a 12.x;
- renombrar el DTO duplicado de `ownership-transfer` si Swagger 12 lo
  convierte en error;
- los cambios de comportamiento que el reporte señale para esta API, cada
  uno con su evidencia;
- DA-1 en `just doctor`.

**NO incluye:** `@nestjs/observe` (DA-2), ni sustituir `nestjs-stripe` (US-87).

## Criterios de aceptación

### CA-1 — Reporte de la migración

La US pega el reporte de `nest upgrade --dry-run` en una tabla con cuatro
columnas: cambio, si afecta a esta API, evidencia (`grep`) y acción.

### CA-2 — Misma batería y mismo contrato

`npx vitest run` mantiene las cifras de US-88. La huella de contrato da
idéntica, o cada diferencia queda justificada y aceptada por el dueño, como
pasó con el orden de las claves en US-77 o con `/docs-json` en US-78.

### CA-3 — El frontend sigue funcionando

`just verify` y las rutas de humo del épico, con el shop y el admin en Next
14.2 o superior.

## Escenarios Gherkin

```gherkin
Feature: API en NestJS 12
  Scenario: CA-2 — nada visible cambia
    Given la batería y la huella de contrato en Nest 11 sobre ESM
    When la API corre en Nest 12
    Then los resultados son idénticos o cada diferencia está aceptada
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `apps/api/rest/package.json`, `yarn.lock` | `@nestjs/*` 12 |
| `apps/api/rest/src/ownership-transfer/dto/get-ownership-transfer.dto.ts` | si Swagger 12 lo exige |
| `apps/api/rest/src/**` | lo que señale el reporte |
| `justfile` | DA-1 |

## Definición de Done

- [ ] DA-1 y DA-2 confirmadas.
- [ ] CA-1..CA-3 con la salida pegada.
- [ ] Lint sin escribir en 0.
- [ ] Status actualizado aquí, en US-79 y en la tabla del épico.

## Notas para el agente ejecutor

- `nest upgrade` instala por defecto. Córrelo primero con `--dry-run` y
  después con `--skip-install`, para revisar el diff antes de instalar.
- Si la máquina no tiene Node 22.22.3+, `nest upgrade` no corre. Sube los
  paquetes a mano siguiendo su reporte y anótalo.
