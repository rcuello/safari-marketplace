# US-88 — Tests de la API: de jest a Vitest

> NestJS 12 se publica solo como ESM, y jest no puede cargarlo en Node 22
> (US-79). Esta US migra la batería de la API a Vitest **sin cambiar nada
> más**: la API sigue en Nest 11 y en CommonJS. Es el primer paso del camino
> a Nest 12 y deja la API con el mismo runner que `packages/db`.

**Épico:** [Épico 75](./README.md)
**Fecha:** 2026-10-24
**Status:** Listo para ejecución
**Depende de:** US-78
**LOC est.:** ~400 (34 suites, sobre todo cambios mecánicos `jest.*` → `vi.*`)

## Historia

**Como** mantenedor de la API, **quiero** la batería en Vitest, **para**
poder pasar a ESM y a Nest 12 sin perder la red de 565 tests.

## Contexto — verificado (2026-10-24)

- **Por qué esta US (evidencia de US-79):** con `@nestjs/*` 12.1.3 instalados
  de prueba, `npx jest src/tags` falla con `SyntaxError: Cannot use import
  statement outside a module`. La guía oficial de migración a v12 dice que
  jest solo carga los paquetes ESM-only de Nest 12 en **Node 24.9 o
  superior** (si no, `ERR_REQUIRE_ASYNC_MODULE`) y recomienda Vitest, que es
  el runner por defecto de los proyectos ESM de Nest 12.
- **La batería actual:**
  - 34 suites `*.spec.ts` bajo `apps/api/rest/src`, con 565 tests;
  - 31 llamadas a `jest.mock(` y 165 a `jest.fn(`/`jest.spyOn(`;
  - la configuración está en el bloque `jest` de `apps/api/rest/package.json`
    (ts-jest 29.4.14, `moduleNameMapper` para `@db/*` y `src/*`,
    `transformIgnorePatterns` que excluye `packages/db/dist`).
- **El precedente en el repo:** `packages/db` ya usa Vitest
  (`"vitest": "^4.1.7"`, `"test": "vitest run"`). La última es la 4.1.12.
- **Decoradores:** Vitest transpila con esbuild, que **no emite
  `emitDecoratorMetadata`**. Nest resuelve la inyección de dependencias con
  esos metadatos, así que la receta oficial de Nest para Vitest usa SWC
  (`unplugin-swc`). Hay que verificarlo con Context7 antes de elegir.

## Decisiones abiertas para el dueño

| # | Tema | Opciones | Propuesta por defecto |
|---|---|---|---|
| DA-1 | Transformador | **(a)** `unplugin-swc` (la receta de Nest). **(b)** esbuild sin metadatos, con los tests que usen DI resueltos a mano | **(a)**: es lo que documenta Nest y conserva la DI de `Test.createTestingModule` |
| DA-2 | Globals | **(a)** `globals: true`, para que `describe`/`it`/`expect` sigan sin import. **(b)** Imports explícitos de `vitest` en cada suite | **(a)**: el diff queda en `jest.*` → `vi.*`; **(b)** se puede hacer después |

## Scope

**Incluye:**

- `vitest.config.ts` en `apps/api/rest`, con los alias `@db/*` y `src/*`;
- sustituir `jest.mock`/`jest.fn`/`jest.spyOn` y los tipos `jest.Mocked*`
  por sus equivalentes de Vitest;
- los scripts `test`, `test:watch` y `test:cov`;
- quitar `jest`, `ts-jest` y `@types/jest`, y el bloque `jest` del
  `package.json`;
- actualizar la cifra y el comando de tests en `docs/product/README.md` (DoD)
  y en `openspec/config.yaml`, si los nombran.

**NO incluye:**

- ESM, TypeScript 6 ni Nest 12 (US-89, US-90 y US-91);
- reescribir tests o cambiar lo que comprueban: cada test conserva sus
  aserciones;
- E2E con supertest, que hoy no existen.

## Criterios de aceptación

### CA-1 — Misma batería, mismo resultado

`npx vitest run` da **565 tests en verde en 34 archivos**. Si la cuenta no
coincide, la US lista los tests que faltan o sobran y por qué.

### CA-2 — Los tests siguen detectando fallos

Hay que inyectar dos fallos temporales, cada uno con su revert:

- romper una regla de un servicio (por ejemplo, el mensaje de un
  `NotFoundException`);
- romper un mock (por ejemplo, quitar un `vi.mock` de `@safari/db`).

Con cada uno, la suite tiene que fallar en el test esperado.

### CA-3 — Nada más cambia

`git diff` solo toca `*.spec.ts`, `vitest.config.ts`, `package.json`,
`yarn.lock`, `tsconfig*.json` (si hace falta para los tipos de Vitest) y los
docs del comando. `yarn build`, `tsc` y el lint sin escribir siguen en 0.

## Escenarios Gherkin

```gherkin
Feature: Batería de la API en Vitest
  Scenario: CA-1 — la cuenta no cambia
    Given 34 suites y 565 tests en jest
    When se migran a Vitest
    Then vitest run da 565 tests en verde en 34 archivos
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `apps/api/rest/vitest.config.ts` | nuevo |
| `apps/api/rest/src/**/*.spec.ts` | `jest.*` → `vi.*` |
| `apps/api/rest/package.json`, `yarn.lock` | dependencias, scripts y el bloque `jest` |
| `docs/product/README.md`, `openspec/config.yaml` | el comando de tests, si cambia |

## Definición de Done

- [ ] DA-1 y DA-2 confirmadas.
- [ ] Línea base en jest (`npx jest`: 34 / 565), pegada.
- [ ] CA-1..CA-3 con la salida pegada.
- [ ] Lint sin escribir en 0.
- [ ] Status actualizado aquí y en la tabla del épico.

## Notas para el agente ejecutor

- Lee con Context7 la receta de Vitest de la documentación de Nest y la guía
  *Migrating from Jest* de Vitest.
- La semántica de `vi.mock` (hoisting, `vi.hoisted`, factorías asíncronas)
  difiere de la de `jest.mock` en detalles. Revisa los 31 `jest.mock` uno a
  uno; no los cambies a ciegas con `sed`.
- `CLAUDE.md` cita `cd apps/api/rest && npx jest`. Es del dueño: no lo
  edites; propón el texto en el reporte.
