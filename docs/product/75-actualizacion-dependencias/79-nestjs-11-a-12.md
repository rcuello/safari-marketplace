# US-79 — NestJS 11 → 12

> Lleva la API a la última mayor de Nest (12.2.0, publicada a partir del
> 2026-08-27). Va condicionada a DA-2: si la guía de migración trae algo que
> no queremos adoptar, la US se archiva y la API se queda en la 11.

**Épico:** [Épico 75](./README.md)
**Fecha:** 2026-10-24
**Status:** Listo para ejecución (condicionada a DA-2)
**Depende de:** US-78
**LOC est.:** ~100

## Historia

**Como** mantenedor de la API, **quiero** la última mayor de NestJS,
**para** no acumular otra deuda de versiones.

## Contexto — verificado (2026-10-24)

- `@nestjs/core@12.2.0` pide Node 20 o superior y `reflect-metadata
  ^0.1.12 || ^0.2.0`.
- Las últimas versiones del ecosistema son `@nestjs/config` 12.0.1,
  `@nestjs/jwt` 12.0.3, `@nestjs/swagger` 12.0.4, `@nestjs/mapped-types`
  12.0.0 y `@nestjs/cli` 12.0.10. Antes de subir, hay que comprobar con
  `npm view … peerDependencies` que piden `@nestjs/core ^12`.

## Scope

**Incluye:** `@nestjs/*` a 12.x con sus peers y lo que exija la guía de
migración a v12.

**NO incluye:** cambios que la v12 permita pero no exija.

## Criterios de aceptación

### CA-1 — Decisión documentada

Antes de tocar código, la US resume la guía de migración a v12 en una tabla
con tres columnas: cambio, si afecta a esta API y evidencia (`grep`). Si
algo obliga a un rediseño, se para y se pregunta al dueño (DA-2).

### CA-2 — Misma batería y mismos contratos

`npx jest` en verde con las cifras de US-78. Los `curl` de CA-2 de US-78
dan lo mismo que antes.

## Escenarios Gherkin

```gherkin
Feature: API en NestJS 12
  Scenario: CA-2 — nada visible cambia
    Given la batería y los curl de US-78
    When la API corre en Nest 12
    Then los resultados son idénticos
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `apps/api/rest/package.json`, `yarn.lock` | versiones |
| `apps/api/rest/src/**` | solo lo que exija la migración |

## Definición de Done

- [ ] CA-1: la tabla de la guía, con la evidencia.
- [ ] CA-2 con la salida pegada.
- [ ] Lint sin escribir en 0.
- [ ] Status actualizado aquí y en la tabla del épico.

## Notas para el agente ejecutor

- La v12 es reciente; contrasta la guía con las notas de versión de cada
  paquete usando Context7.
