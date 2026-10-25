# US-79 — NestJS 11 → 12

> Lleva la API a la última mayor de Nest (12.2.0, publicada a partir del
> 2026-08-27). Va condicionada a DA-2: si la guía de migración trae algo que
> no queremos adoptar, la US se archiva y la API se queda en la 11.

**Épico:** [Épico 75](./README.md)
**Fecha:** 2026-10-24
**Status:** Reemplazada (2026-10-24) por US-88 → US-91. Se detuvo en su
CA-1: Nest 12 obliga a un rediseño (ver «Resultado»).
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

## Resultado — ejecutado el 2026-10-24 (detenida en el CA-1)

### CA-1 — La guía de migración a v12 (Context7, `docs.nestjs.com/migration`)

| Cambio de Nest 12 | ¿Afecta a esta API? | Evidencia |
|---|---|---|
| Los paquetes `@nestjs/*` son **solo ESM** | **Sí**: la API es CommonJS | `npm view @nestjs/core@12.2.0 type` da `module`, y el `exports` no tiene condición `require`. `apps/api/rest/package.json` no declara `"type"` y su `tsconfig.json` usa `"module": "commonjs"` |
| jest solo carga los paquetes de Nest 12 en **Node 24.9 o superior** (si no, `ERR_REQUIRE_ASYNC_MODULE`); la guía recomienda Vitest | **Sí**: 34 suites y 565 tests en jest, y Node 22.14.0 en la máquina | ver la prueba de abajo |
| El CLI y los schematics de la 12 exigen **TypeScript 6** | **Sí** | la API usa TypeScript 5.9.3 (US-77) |
| Ejecutar una app pide Node 20.19+ o 22.12+; `nest generate`/`nest upgrade` piden 22.22.3+, 24.15+ o 26+ | En parte | Node 22.14.0 sirve para ejecutar, pero no para los schematics |
| `nest-cli.json` pasa de `webpack` a `--builder rspack` | No | `nest-cli.json` no usa `webpack` |
| GraphQL `playground` → `graphiql`, NATS v3, Joi 18 en `@nestjs/config` | No | la API REST no usa GraphQL, NATS ni `validationSchema` de Joi |
| Orden de los hooks del ciclo de vida, firmas de pipes y logging estructurado | Por medir | `nest upgrade` lo reporta; queda para US-91 |

### Prueba real (en esta rama, revertida)

Con `@nestjs/common`, `core`, `platform-express` y `testing` en 12.1.3, y el
resto en 11:

```
$ npx jest src/tags
  ● Test suite failed to run
    SyntaxError: Cannot use import statement outside a module
Test Suites: 1 failed, 1 total

$ npx tsc --noEmit -p tsconfig.json
tsc EXIT=0

$ yarn build && node dist/main
Error: Cannot find module '…\node_modules\@nestjs\common\interfaces.js'
```

Se revirtió con `git checkout -- package.json yarn.lock` y `yarn install
--frozen-lockfile`. Después: `@nestjs/core` 11.2.7, `yarn build` bien y `npx
jest` con 34 suites / 565 tests.

### Decisión del dueño (2026-10-24)

El dueño eligió **volver a refinar la subida en varias US**, en lugar de
quedarse en Nest 11 (DA-2 b) o de exigir Node 24.9+ para jest:

| US | Qué |
|---|---|
| [US-88](./88-api-jest-a-vitest.md) | Tests de la API de jest a Vitest, todavía en Nest 11 y CommonJS |
| [US-89](./89-api-typescript-6.md) | TypeScript 6 en la API |
| [US-90](./90-api-commonjs-a-esm.md) | La API de CommonJS a ESM (703 imports relativos en 281 archivos) |
| [US-91](./91-nestjs-12-sobre-esm.md) | NestJS 11 → 12 sobre la API ya en ESM |
