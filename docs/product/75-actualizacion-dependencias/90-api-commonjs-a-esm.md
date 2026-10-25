# US-90 — La API de CommonJS a ESM

> NestJS 12 se publica solo como ESM (`"type": "module"`). Esta US pasa la
> API a ESM todavía en Nest 11, para que el salto de sistema de módulos se
> verifique solo. Es la US más grande del camino a Nest 12, por número de
> archivos.

**Épico:** [Épico 75](./README.md)
**Fecha:** 2026-10-24
**Status:** Listo para ejecución
**Depende de:** US-88 y US-89
**LOC est.:** ~750 (sobre todo mecánico: extensiones `.js` en los imports
relativos)

## Historia

**Como** mantenedor de la API, **quiero** la API en ESM, **para** consumir
Nest 12 de forma nativa y no a través de `require(esm)`.

## Contexto — verificado (2026-10-24)

- **Los paquetes de Nest 12:** `npm view @nestjs/core@12.2.0` da `"type":
  "module"`, un `exports` sin condición `require` y `engines.node: ">=20"`.
  La guía de migración aclara que consumirlos desde CommonJS depende de
  `require(esm)`, que solo funciona sin flag desde Node 20.19 y 22.12.
- **La API hoy:** sin `"type"` en `package.json` (CommonJS) y con `"module":
  "commonjs"` en `tsconfig.json`.
- **Superficie** (`grep` sobre `apps/api/rest/src`, 2026-10-24):

| Qué | Cuenta |
|---|---|
| archivos `.ts` | 366 |
| imports relativos (`from './…'` o `'../…'`), que en ESM necesitan la extensión `.js` | 703, en 281 archivos |
| imports del mock JSON (`@db/*`), que en ESM necesitan `with { type: 'json' }` o una lectura con `fs` | 11 |
| `__dirname` / `__filename` | 3 |
| `require(` / `import x = require` | 0 / 0 |

- **Dependencias CommonJS que la API consume:**
  - `@safari/db`: `packages/db/tsup.config.ts:29` emite solo
    `format: ['cjs']`;
  - `nestjs-stripe` 1.0.0;
  - `class-validator` y `class-transformer`.

  Desde ESM, un paquete CJS se importa por su export por defecto o por los
  nombres que Node detecte. Cada uno hay que comprobarlo.
- **La plantilla de Nest 12 para ESM** (`nest new`): `module` y
  `moduleResolution` `nodenext`, `resolvePackageJsonExports`,
  `isolatedModules`, `target: ES2023` y `rootDir: "."`.

## Decisiones abiertas para el dueño

| # | Tema | Opciones | Propuesta por defecto |
|---|---|---|---|
| DA-1 | El mock JSON (`@db/*`) | **(a)** `import x from '…json' with { type: 'json' }`. **(b)** Leerlo con `fs.readFileSync` + `JSON.parse` | **(a)**, si `nodenext` y el build de Nest lo emiten bien; si no, **(b)** |
| DA-2 | El alias `@db/*` | **(a)** Mantenerlo con `paths` y un resolutor en el build. **(b)** Sustituirlo por `imports` de `package.json` (`#db/*`), nativo en Node | **(b)**: es el mecanismo nativo de ESM y no depende del bundler |
| DA-3 | `@safari/db` | **(a)** Seguir en CJS y consumirlo por interop. **(b)** Que `tsup` emita también ESM (US aparte en `packages/db`) | **(a)** en esta US; **(b)** solo si la interop falla |

## Scope

**Incluye:**

- `"type": "module"` y el `tsconfig` de ESM;
- las extensiones `.js` en los 703 imports relativos (un codemod, revisado);
- los 11 imports JSON, según DA-1, y el alias `@db/*`, según DA-2;
- `__dirname` y `__filename` → `import.meta.dirname` o `fileURLToPath`;
- `nest-cli.json` y los scripts de build y arranque;
- `vitest.config.ts`, si el cambio lo exige.

**NO incluye:** Nest 12 (US-91), ni pasar `packages/db` a ESM (DA-3 b).

## Criterios de aceptación

### CA-1 — Arranca como ESM

`node dist/main.js` arranca con `"type": "module"` (los logs de Nest muestran
«Nest application successfully started»), y `/docs` y `/docs-json` responden.

### CA-2 — Misma batería y mismo contrato

`npx vitest run` mantiene las cifras de US-88. La huella de contrato de
US-78 da idéntica. El frontend en Next 14.2 pasa `just verify` con los mismos
bytes.

### CA-3 — Interop documentada

La US documenta cómo se importa cada dependencia CJS (`@safari/db`,
`nestjs-stripe`, `class-validator`/`class-transformer`), con la evidencia de
que funciona: un test o una ruta que la ejercite.

## Escenarios Gherkin

```gherkin
Feature: API en ESM
  Scenario: CA-2 — el frontend no nota el cambio
    Given la API compilada como ESM
    When se corre just verify con el shop y el admin
    Then los bytes coinciden con los de la API en CommonJS
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `apps/api/rest/package.json` | `"type": "module"`, scripts e `imports` (DA-2) |
| `apps/api/rest/tsconfig*.json`, `nest-cli.json` | configuración ESM |
| `apps/api/rest/src/**/*.ts` | extensiones `.js`, JSON e `import.meta` |
| `apps/api/rest/vitest.config.ts` | si hace falta |
| `justfile` | si cambian `api-dev` o `build-api` |

## Definición de Done

- [ ] DA-1..DA-3 confirmadas.
- [ ] Línea base (vitest, huella de contrato y `just verify`) en CommonJS.
- [ ] CA-1..CA-3 con la salida pegada.
- [ ] El codemod de extensiones en un commit propio, separado de los ajustes
      a mano.
- [ ] Lint sin escribir en 0.
- [ ] Status actualizado aquí y en la tabla del épico.

## Notas para el agente ejecutor

- Lee con Context7 la sección ESM de la guía de migración a Nest 12 y la
  plantilla ESM de `nest new`.
- Si esta US no cabe en una sesión, se para en un punto estable (por
  ejemplo, después del codemod con los tests en verde) y se pregunta si se
  parte.
