# US-88 — Tests de la API: de jest a Vitest

> NestJS 12 se publica solo como ESM, y jest no puede cargarlo en Node 22
> (US-79). Esta US migra la batería de la API a Vitest **sin cambiar nada
> más**: la API sigue en Nest 11 y en CommonJS. Es el primer paso del camino
> a Nest 12 y deja la API con el mismo runner que `packages/db`.

**Épico:** [Épico 75](./README.md)
**Fecha:** 2026-10-24
**Status:** Implementada (2026-10-24)
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

- [x] DA-1 y DA-2 confirmadas (propuesta por defecto aplicada: (a) y (a)).
- [x] Línea base en jest (`npx jest`: 34 / 565), pegada.
- [x] CA-1..CA-3 con la salida pegada.
- [x] Lint sin escribir en 0.
- [ ] Status actualizado aquí y en la tabla del épico (aquí sí; la tabla del épico la actualiza quien integra).

## Notas para el agente ejecutor

- Lee con Context7 la receta de Vitest de la documentación de Nest y la guía
  *Migrating from Jest* de Vitest.
- La semántica de `vi.mock` (hoisting, `vi.hoisted`, factorías asíncronas)
  difiere de la de `jest.mock` en detalles. Revisa los 31 `jest.mock` uno a
  uno; no los cambies a ciegas con `sed`.
- `CLAUDE.md` cita `cd apps/api/rest && npx jest`. Es del dueño: no lo
  edites; propón el texto en el reporte.

## Resultado — ejecutado el 2026-10-24

Se ejecutó en un worktree aislado (rama `worktree-agent-a00ca6d61ed82f443`,
base `2d94798`), con Node 22.14.0. La API sigue en NestJS 11.2.7,
TypeScript 5.9.3 y CommonJS.

### Decisiones

| # | Decisión | Evidencia |
|---|---|---|
| DA-1 | **(a) `unplugin-swc`**, la propuesta por defecto | La receta de Vitest de Nest (Context7, `docs.nestjs.com` recipes/swc) usa `swc.vite({ module: { type: 'es6' } })`, `globals: true` y alias para los paths de TypeScript. SWC toma `experimentalDecorators`/`emitDecoratorMetadata` del `tsconfig.json`. La única suite con `Test.createTestingModule` pasa |
| DA-2 | **(a) `globals: true`**, la propuesta por defecto | En cada spec, `/// <reference types="jest" />` pasa a `/// <reference types="vitest/globals" />`. `tsconfig.json` no se toca: sigue fijando `types: ["node","express","multer"]` |

### Versiones

La regla: la última estable que lleve más de dos semanas publicada. El corte
es el 2026-10-10.

| Paquete | Versión | Publicada | Motivo |
|---|---|---|---|
| `vitest` | **4.1.11** (exacta) | 2026-08-18 | La 4.1.12 salió el 2026-10-15, hace menos de dos semanas. Por qué no la 5.0.3: ver «Desvíos» |
| `@vitest/coverage-v8` | **4.1.11** (exacta) | 2026-08-18 | Es peer de `vitest` y tiene que coincidir con él; lo usa `test:cov` |
| `unplugin-swc` | **2.0.0** (exacta) | 2026-09-21 | Peer `@swc/core ^1.2.108`; engines `^20.19.0 \|\| >=22.12.0` |
| `@swc/core` | **1.16.13** (exacta) | 2026-09-30 | De la 1.16.14 a la 1.16.20 salieron después del corte. El peer `@swc/helpers` es opcional |
| `vite` (transitiva) | 8.3.5 | 2026-10-21 | La trae `vitest` (`^6 \|\| ^7 \|\| ^8`). No se fijó: ver «Hallazgos» |

Se quitaron `jest` 29.7.0, `ts-jest` 29.4.14 y `@types/jest` ^29.5.14, junto
con el bloque `jest` del `package.json`. `yarn add` no dio avisos de peers
nuevos: solo salieron los que ya daba `@safari/db > prisma >
@prisma/studio-core`. El bug de npm de US-76 (`edgesOut`) no aplica, porque
la API usa yarn.

### Cambios

- `apps/api/rest/vitest.config.ts` (nuevo). Lleva SWC, `globals: true`,
  `include: ['src/**/*.spec.ts']` y entorno `node`. Los alias son los del
  `moduleNameMapper` de jest: `@db/*` → `src/db/pickbazar/*` y `src/*` →
  `src/*`. La cobertura v8 va a `./coverage`, donde la dejaba jest.
- `package.json`:
  - `test` = `vitest run`;
  - `test:watch` = `vitest`;
  - `test:cov` = `vitest run --coverage`;
  - `test:debug` = `vitest --inspect-brk --no-file-parallelism`;
  - se borró `test:e2e`, que apuntaba a `./test/jest-e2e.json`. Ni ese
    archivo ni la carpeta `test/` existen, y jest ya no está instalado.
- `tsconfig.build.json` ahora excluye `vitest.config.ts`. Sin esa
  exclusión, `nest build` compilaba ese archivo de la raíz y la salida se
  movía a `dist/src/main.js`, así que `start:prod` (`node dist/main`) ya no
  encontraba el punto de entrada:

  ```
  $ yarn build && ls dist
  src  tsconfig.build.tsbuildinfo  vitest.config.d.ts  vitest.config.js  vitest.config.js.map
  ls: cannot access 'dist/main.js': No such file or directory
  ```

- Los 34 specs se migraron con un script de reemplazos exactos que cuenta
  cada patrón por archivo. Los totales coinciden con el inventario:

  ```
  TOTAL {"ref":34,"refComment":34,"mock":31,"requireActual":31,"fn":165,"mocked":164,"resetAllMocks":26,"spyOn":2}
  ```

  `jest.fn`, `jest.mocked`, `jest.spyOn` y `jest.resetAllMocks` pasan a
  `vi.*`. Cada `jest.mock('@safari/db', () => ({ ...jest.requireActual(...),
  … }))` pasa a `vi.mock('@safari/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@safari/db')>()), … }))`. Además,
  se corrigieron a mano 7 comentarios que nombraban APIs de jest.

#### Los 31 `vi.mock`, uno a uno

Se imprimió el cuerpo de las 31 factorías sin los comentarios ni las líneas
`nombre: jest.fn(),`. En las 31 solo queda el `requireActual` del barrel:

```
== tags\tags.service.spec.ts (8 lineas)
jest.mock('@safari/db', () => ({
  ...jest.requireActual<typeof import('@safari/db')>('@safari/db'),
}));
```

Ninguna factoría usa variables externas. Por eso el hoisting de `vi.mock` no
cambia nada y no hace falta `vi.hoisted`. El único cambio es que
`importOriginal` es asíncrono, y por eso las factorías pasan a `async`.

La guía *Migrating from Jest* señala una diferencia de semántica, y se
revisó. En Vitest, `mockReset` devuelve la implementación original; en jest
deja una función que devuelve `undefined`. Los `vi.fn()` de las factorías no
tienen implementación, así que el resultado no cambia. Los dos `vi.spyOn`
se crean dentro de cada test con `mockResolvedValue`, y sus suites pasan
igual.

### Línea base (jest, antes de migrar)

```
$ cd apps/api/rest && npx jest
Test Suites: 34 passed, 34 total
Tests:       565 passed, 565 total
Snapshots:   0 total
Time:        300.091 s
Ran all test suites.
$ npx tsc --noEmit -p tsconfig.json
tsc EXIT=0
$ npx eslint "{src,apps,libs,test}/**/*.ts"
eslint EXIT=0
$ yarn build
$ rimraf dist
$ nest build
Done in 122.13s.
build EXIT=0
```

### CA-1: misma batería, mismo resultado ✅

```
$ cd apps/api/rest && npx vitest run
 RUN  v4.1.11 C:/DevOps/MyGitHub/safari-marketplace/.claude/worktrees/agent-a00ca6d61ed82f443/apps/api/rest

 Test Files  34 passed (34)
      Tests  565 passed (565)
   Start at  21:34:32
   Duration  103.33s (transform 52.45s, setup 0ms, import 329.19s, tests 3.71s, environment 18ms)
```

Son 565 tests en 34 archivos, los mismos que en jest: no falta ni sobra
ninguno. La batería baja de 300 s a unos 103 s, porque SWC no comprueba
tipos y ts-jest sí. `yarn test:cov` también funciona:

```
      Coverage enabled with v8
 Test Files  34 passed (34)
      Tests  565 passed (565)
 % Coverage report from v8
All files          |   44.91 |    70.98 |    40.3 |   44.24 |
```

### CA-2: los tests siguen detectando fallos ✅

**Fallo 1, una regla de servicio.** En `TagsService.update`
(`src/tags/tags.service.ts:173`) se cambió la guarda `id <= 0` por `id < 0`:

```
$ npx vitest run src/tags
     × id cero → 404 sin llamar al repositorio (`!Number.isSafeInteger(id) || id <= 0`) 17ms
 FAIL  src/tags/tags.service.spec.ts > TagsService.update (US-27b) > id cero → 404 sin llamar al repositorio (`!Number.isSafeInteger(id) || id <= 0`)
AssertionError: expected InternalServerErrorException: Ocurrió un … { …(3) } to be an instance of NotFoundException
 Test Files  1 failed (1)
      Tests  1 failed | 30 passed (31)
```

Falla justo el test de ese caso. Tras revertir con `git checkout --
src/tags/tags.service.ts` queda `Tests  31 passed (31)`.

Antes se había probado cambiar el `NotFoundException` por
`BadRequestException`. Fallaron los 4 tests esperados, pero con un
`ReferenceError`, porque esa clase no se importa en el servicio. Se
descartó: no era una regla rota de forma limpia.

**Fallo 2, un mock.** Se borró el `vi.mock('@safari/db', …)` de
`src/tags/tags.service.spec.ts` (11 líneas):

```
$ npx vitest run src/tags
      1       Tests  31 failed (31)
      1  Test Files  1 failed (1)
      1 TypeError: listTypesMock.mockReset is not a function
```

Sin el mock, `vi.mocked(listTypes)` es la función real, y el `beforeEach`
falla en los 31 tests. Tras revertir con `git checkout --
src/tags/tags.service.spec.ts` queda `Tests  31 passed (31)`.

### CA-3: nada más cambia ✅

```
$ git diff --name-only 2d94798 | grep -v "\.spec\.ts$"
apps/api/rest/package.json
apps/api/rest/tsconfig.build.json
apps/api/rest/vitest.config.ts
apps/api/rest/yarn.lock
openspec/config.yaml
$ npx tsc --noEmit -p tsconfig.json
tsc EXIT=0
$ npx eslint "{src,apps,libs,test}/**/*.ts" vitest.config.ts
eslint EXIT=0
$ yarn build
$ nest build
Done in 37.96s.
build EXIT=0
$ ls dist/main.js
dist/main.js
```

Fuera de los specs solo cambian los archivos que permite el CA-3, más este
doc. No hizo falta tocar `docs/product/README.md`: no nombra `npx jest`, y
su DoD pide el lint y los builds, no el comando de tests.
`openspec/config.yaml` sí lo nombraba, en cuatro sitios, y se actualizó.

### Desvíos

- **Vitest 4.1.11 en lugar de 5.0.3.** La última estable con más de dos
  semanas es la 5.0.3, del 2026-09-30, pero hay dos problemas:
  - declara el peer `@types/node: "^22.0.0 || >=24.0.0"`, y la API declara
    `@types/node ^20.19.43`;
  - pasa `vite` de dependencia a peer.

  Usarla obligaba a subir `@types/node`, que está fuera del scope, y a
  declarar `vite` a mano. La 4.1.11 cumple los peers (`^20 || ^22 ||
  >=24`), es la misma mayor que ya usa `packages/db` (`^4.1.7`) y es la
  última 4.x con más de dos semanas. Si el dueño quiere Vitest 5, puede
  subirse junto con `@types/node` 22 en US-89 o US-90.
- **Se borró `test:e2e` y se adaptó `test:debug`** (ver «Cambios»). El
  scope nombraba solo `test`, `test:watch` y `test:cov`, pero estos dos
  llamaban a un binario que ya no está.
- **Cambia `tsconfig.build.json`**, para que `dist/main.js` siga donde
  estaba. El CA-3 lo permite (`tsconfig*.json`).

### Hallazgos

1. **El runner ya no dispara la red de tipos de los specs.** ts-jest
   comprobaba tipos, así que un error de tipo tumbaba la suite. SWC solo
   transpila, y esbuild (la opción DA-1 b) también. Se probó renombrando
   `commissions` a `missions` en `BecomeSeller`
   (`entities/become-seller.entity.ts:139`), y después se revirtió:

   ```
   $ npx vitest run src/become-seller
    Test Files  1 passed (1)
         Tests  9 passed (9)
   $ npx tsc --noEmit -p tsconfig.json
   tsc EXIT=2
   src/become-seller/become-seller.service.spec.ts(91,7): error TS2322: Type 'true' is not assignable to type 'KeyDrift<BecomeSeller, "page_options" | "commissions">'.
   src/become-seller/become-seller.service.spec.ts(174,19): error TS2551: Property 'commissions' does not exist on type 'BecomeSeller'. Did you mean 'missions'?
   src/become-seller/become-seller.service.ts(127,7): error TS2561: Object literal may only specify known properties, but 'commissions' does not exist in type 'BecomeSeller'. Did you mean to write 'missions'?
   ```

   La red sigue existiendo, porque `tsconfig.json` incluye los specs y
   `tsc --noEmit` ya está en la DoD. Lo que cambia es que ahora depende de
   ese comando. La spec viva `openspec/specs/become-seller-contract-types/spec.md:108`
   todavía dice «THEN `npx jest` falla con un error real de TypeScript».
   **Decisión para el dueño:**
   - **(a)** aceptar `tsc --noEmit` como gate de esa red y corregir la spec
     viva, por SDD o al integrar;
   - **(b)** activar `test.typecheck` de Vitest en una US aparte.

   Ya se corrigió el comentario de `become-seller.service.spec.ts`, que
   atribuía la red a ts-jest, y `openspec/config.yaml` ya lo explica.
2. **Vite da un aviso al cargar la config:** `ESM syntax in a file loaded as
   CommonJS (vitest.config.ts:1:1)`, pensando en un futuro `configLoader:
   'native'`. Hoy no afecta, y desaparece en US-90, cuando la API pase a
   `"type": "module"`. El archivo se dejó como `.ts` porque es el nombre que
   pide el CA-3.
3. **`vite` 8.3.5 tiene 3 días.** La regla de las dos semanas se aplicó a
   las dependencias directas. `vite` es transitiva: la resolvió el rango de
   `vitest` y quedó en el `yarn.lock`. Para aplicar la regla también a las
   transitivas habría que fijarla con `resolutions`, y no se hizo.
4. Estos docs vigentes todavía nombran `npx jest`:
   - `CLAUDE.md`;
   - el README del Épico 75, en la fila de la línea base;
   - `docs/product/9-gate-calidad-ci/10-receta-just-check.md`;
   - la spec viva del hallazgo 1.

   Los docs de las US ya cerradas son históricos y no se tocaron.
