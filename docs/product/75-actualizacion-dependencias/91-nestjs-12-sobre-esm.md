# US-91 — NestJS 11 → 12 sobre la API ya en ESM

> Con la API en Vitest (US-88), TypeScript 6 (US-89) y ESM (US-90), queda la
> subida en sí a NestJS 12. Sustituye a [US-79](./79-nestjs-11-a-12.md), que
> se detuvo en su CA-1 porque Nest 12 obligaba a un rediseño.

**Épico:** [Épico 75](./README.md)
**Fecha:** 2026-10-24
**Status:** Implementada (2026-10-26) en la ejecución, con dos pendientes:
el CA-3 (`just verify`, de la integración) y DA-3 (el CLI de Nest sigue en
11 porque el CLI 12 no corre en Node 22.14; decide el dueño)
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
| DA-3 | `@nestjs/cli` y `@nestjs/schematics` (abierta en la ejecución, 2026-10-26) | **(a)** Dejarlos en 11 mientras la máquina tenga Node < 22.22.3, y subirlos en una US corta al actualizar Node. **(b)** Actualizar Node a 22.22.3+ (o 24.15+) y subirlos a 12 ya | **(a)**: es lo entregado; la app y la batería no dependen del CLI 12 (ver «Resultado») |

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

- [x] DA-1 y DA-2 confirmadas (propuestas por defecto). DA-3, nueva:
      abierta, con (a) aplicada.
- [ ] CA-1..CA-3 con la salida pegada: CA-1 y CA-2 sí; CA-3 pendiente de
      la integración.
- [x] Lint sin escribir en 0.
- [ ] Status actualizado aquí y en US-79 (sí); la tabla del épico queda
      para la integración.

## Notas para el agente ejecutor

- `nest upgrade` instala por defecto. Córrelo primero con `--dry-run` y
  después con `--skip-install`, para revisar el diff antes de instalar.
- Si la máquina no tiene Node 22.22.3+, `nest upgrade` no corre. Sube los
  paquetes a mano siguiendo su reporte y anótalo.

## Resultado — ejecutado el 2026-10-26

Rama `worktree-agent-a02b26332e663f5f6`, sobre la de US-90 (`0c3d48d`), por
DA-4 (a) de US-90: las dos US se integran juntas. Node 22.14.0, yarn
1.22.22. API compilada (`yarn build` + `node dist/main.js`) en el puerto
9011 con
`PORT=9011 DATABASE_URL=postgresql://safari:safari@localhost:5433/safari_scraper JWT_SECRET=us91-desechable`.
El cierre de US-90 (arranque ESM, interop) está en
[su sección «Cierre»](./90-api-commonjs-a-esm.md).

### Commits

| Hash | Qué |
|---|---|
| `3e56038` | `package.json` + `yarn.lock`: los `@nestjs/*` de ejecución a 12 |
| `5de7fac` | `justfile`: `just doctor` con los requisitos de Node de Nest 12 (DA-1 a) |

Ningún cambio en `src/`: ni la guía ni la batería lo pidieron.

### Versiones (regla de las dos semanas: publicadas antes del 2026-10-12 16:53 UTC)

| Paquete | Antes | Después | Última (fecha) |
|---|---|---|---|
| `@nestjs/common`, `core`, `platform-express`, `testing` | 11.2.7 | **12.1.3** exacta (2026-10-12) | 12.2.0 (2026-10-19) |
| `@nestjs/swagger` | ^11.4.7 | **12.0.2** exacta (2026-09-23) | 12.0.4 (2026-10-24) |
| `@nestjs/config` | ^4.0.4 | ^12.0.1 (2026-09-22) | la misma |
| `@nestjs/jwt` | ^11.0.2 | ^12.0.3 (2026-10-12) | la misma |
| `@nestjs/mapped-types` | 2.1.1 | 12.0.0 exacta (2026-08-27) | la misma |
| `@nestjs/cli` | ^11.0.24 | **sin cambio** (11.0.24) | 12.0.10; dentro del corte, 12.0.8 |
| `@nestjs/schematics` | ^11.1.0 | **sin cambio** (11.1.0) | 12.0.10; dentro del corte, 12.0.7 |

La 12.0.2 de Swagger ya trae la detección de ESM del plugin
(`dist/plugin/utils/module-format.util.js`, comprobado con `npm pack`).
Arrastra `@nestjs/mapped-types` 12.0.0 exacta y `swagger-ui-dist` 5.33.0.
`@nestjs/config` 12 trae `dotenv` 18.0.3 y `dotenv-expand` 13.0.0.

**Peers:** todos los de los `@nestjs/*` se cumplen con lo instalado
(script contra `node_modules`: `typescript` 6.0.3 para Swagger,
`class-validator` 0.13.2 y `class-transformer` 0.5.1 para `common` y
`mapped-types`, `reflect-metadata` 0.1.13, `rxjs` 7). El único peer roto es
el de `nestjs-stripe` 1.0.0 (`@nestjs/common ^6 || ^7 || ^8`, `stripe ^8`),
que ya lo estaba en Nest 11 y es de US-87. Sin `--force`, sin
`--legacy-peer-deps`, sin `--ignore-engines`. `vitest` y `@types/node` no
se tocaron: ningún peer de Nest 12 lo pide.

### Por qué el CLI se queda en 11 (DA-3)

Con los diez paquetes en 12, `yarn install` se niega:

```
error @nestjs/schematics@12.0.10: The engine "node" is incompatible with this module. Expected version "^22.22.3 || ^24.15.0 || >=26.0.0". Got "22.14.0"
error Found incompatible module.
```

(La 12.0.10 llega como dependencia de `@nestjs/cli` 12; la 12.0.7 directa
pide lo mismo, igual que `@angular-devkit/*` 22.2.) Y aunque se forzara, el
CLI 12 **no arranca** en Node 22.14, ni para `--version`:

```
$ npx -y @nestjs/cli@12.0.8 --version
Error [ERR_REQUIRE_CYCLE_MODULE]: Cannot require() ES Module …\node_modules\ora\index.js in a cycle. (from …\node_modules\@angular-devkit\schematics\tasks\package-manager\executor.js)
Node.js v22.14.0
```

Sin CLI no hay `nest build` ni `nest start --watch`, o sea, ni
`just build-api` ni `just api-dev`. Como no se toca la versión de Node,
`@nestjs/cli` 11.0.24 y `@nestjs/schematics` 11.1.0 se quedan. Son
herramientas de desarrollo: compilan con el TypeScript 6.0.3 del proyecto
(US-89) y cargan el plugin de Swagger 12 del proyecto, que es el que emite
el código. La evidencia de US-79 que obligaba a subir «todos juntos» (el
import profundo `@nestjs/common/interfaces.js`) era de ejecución, y en
ejecución no queda nada de Nest 11. Al actualizar Node, subirlos es un
cambio de dos líneas más el lockfile (DA-3).

### CA-1 — Reporte de la migración ✅ (sin `nest upgrade`)

**`nest upgrade --dry-run` no corrió**, por lo mismo: es un comando del
CLI 12, y el CLI 12 no arranca en Node 22.14 (salida de arriba). La tabla
sale de la guía (Context7: `docs.nestjs.com/migration` y
`cli/usages`, sección `nest upgrade`, que lista lo que el comando migra y
lo que reporta) y de `grep` sobre `apps/api/rest/src` (sin `*.spec.ts`).

| Cambio de Nest 12 (guía / `nest upgrade`) | ¿Afecta a esta API? | Evidencia | Acción |
|---|---|---|---|
| Paquetes solo ESM | Ya no | `"type": "module"`, `nodenext` (US-90) | Ninguna |
| Node 20.19+ / 22.12+ para ejecutar; 22.22.3+ / 24.15+ / 26+ para el CLI y los schematics | **Sí** | `node -v` → 22.14.0; salidas de arriba | DA-1 (a) en `just doctor`; CLI en 11 (DA-3) |
| TypeScript 6 (lo piden el CLI 12 y los schematics) | No | `typescript` 6.0.3 (US-89) | Ninguna |
| `engines.node` a `>=20.19.0` si el `package.json` declara uno menor | No | `grep '"engines"' package.json` → 0 | Ninguna |
| Revisión de `tsconfig` (`moduleResolution` heredado, `rootDir`) | No | `nodenext`; `rootDir: "./src"` en `tsconfig.build.json` | Ninguna |
| jest a 30 y aviso de jest con ESM | No | La API usa Vitest (US-88) | Ninguna |
| `nest-cli.json`: `webpack` → `--builder rspack` | No | `grep 'webpack\|builder' nest-cli.json` → 0 | Ninguna |
| GraphQL `playground` → `graphiql`, `graphql-ws` | No | `grep '@nestjs/graphql\|playground'` → 0 | Ninguna |
| `nats` → `@nats-io/*` | No | `grep nats` → 0; sin `@nestjs/microservices` | Ninguna |
| `@nestjs/config`: Joi 18, `validationOptions.libraryOptions` | No | `grep 'validationSchema\|joi'` → 0; solo `ConfigModule.forRoot()` | Ninguna. Con `dotenv` 18, `forRoot` sigue cargando el archivo y respetando lo que ya está en `process.env` (prueba con un archivo de variables desechable fuera del repo: `{"A":"desde-archivo","B":"desde-proceso"}`) |
| `@nestjs/observe` | No (DA-2 a) | — | No se instala |
| Orden de los hooks del ciclo de vida por jerarquía | No | `grep 'onModuleInit\|onApplicationBootstrap\|onModuleDestroy\|beforeApplicationShutdown\|onApplicationShutdown'` → 0 | Ninguna |
| Firmas de pipes refinadas, `ArgumentMetadata<T>` | No | `grep 'PipeTransform\|ArgumentMetadata'` → 0 | Ninguna |
| Logging estructurado (los objetos tras el mensaje van a `params`) | No | 7 usos de `Logger` (`auth.service.ts`, `recovery-options.ts`, `orders.service.ts`), todos con un solo argumento de texto | Ninguna |
| `ValidationPipe`: opción `errorFormat` | No | `main.ts:30` `new ValidationPipe()`; el valor por defecto sigue siendo `'list'` (`validation.pipe.js:38`) | Ninguna |
| Express: cierre ordenado de peticiones en vuelo | No | `grep enableShutdownHooks` → 0 | Ninguna |
| Mapeo de errores del adaptador HTTP reescrito | Podía | Los 401, 404 y 500 de la huella salen con los mismos bytes | Ninguna |
| Swagger 12: el DTO duplicado («will throw an error in the next major») | No | `RefundPolicyPaginator` sigue saliendo como `WARN` al arrancar con 12.0.2 | No se renombra |

### CA-2 — Misma batería y mismo contrato ✅

```
$ npx tsc --noEmit -p tsconfig.json
tsc=0
$ node node_modules/eslint/bin/eslint.js "{src,apps,libs,test}/**/*.ts"
eslint=0
$ npx vitest run
 Test Files  34 passed (34)
      Tests  565 passed (565)
$ yarn build                 # dos veces seguidas
Done in 103.15s.             # 333 .js
Done in 40.97s.              # 333 .js
$ grep -rE '[^_.]require\("' dist --include=*.js | wc -l
0
```

El lint se corrió con el binario de `eslint` por ruta, como en US-90: es
el mismo binario y el mismo glob que `npx eslint`, sin `--fix`.

Huella de contrato contra la de CommonJS (US-89 y US-90), 34 entradas:

```
POST /token (login)                  201 permissions,role,token
GET /settings                        200 5504 847a1e29cc0ddbd8
GET /products?limit=5                200 5145 7a88bbcec44e6117
GET /products?search=name:apple      200 5318 9cfa00c450d6bda3
GET /shops                           200 13788 b6764f4ab1085929
GET /categories?limit=3              200 4254 cff354564b37c17d
GET /me                              200 1345 7fb72c0c5dff5174
POST /token {} (validación)          401 87 9ada84476f484068
POST /token mala contraseña          401 87 9ada84476f484068
POST /messages/seen/999999 cuerpo 1  404 93 0186dfe12a50b34e
GET /products/999999999999999999999  404 106 9f2803081745e97c
Q1 … Q14                             iguales a US-89 (Q10/Q11 con su 500 de siempre)
GET /docs-json                       200 184441 c7269d664b474cce paths=169
GET /docs                            200 3126 20f2dfd8e26ac3b3
M authors … M payment-intent         iguales a US-90 (7 rutas del mock JSON)

entradas 34 34 diferencias 0
```

**`/docs-json` no cambia con Swagger 12**: mismos bytes y mismo sha que
con Swagger 11 en CommonJS. No hay diferencias que aceptar.

### CA-3 — El frontend sigue funcionando: pendiente de la integración

`just verify` y las rutas de humo no se corrieron aquí: 3002/3003/9001 son
del árbol principal (US-82). Quien integre tiene que correr, en el árbol
principal: `cd apps/api/rest && yarn install --frozen-lockfile`,
`just build-api`, `just api-dev` y `just verify`, con el shop y el admin
en Next 14.2 o superior.

### `justfile` (DA-1 a)

`just doctor` (informativo, como antes) distingue tres casos: Node
22.22.3+, 24.15+ o 26+ → `OK`; 20.19+ o 22.12+ → `VIEJO - la API (NestJS
12) arranca, pero el CLI de Nest 12 (nest generate, nest upgrade) pide Node
22.22.3+ o 24.15+`; por debajo → `VIEJO` con los dos mínimos. En esta
máquina da el segundo. Ninguna otra receta cambió: `nest start --watch`
(`just api-dev`) arranca la API ESM en Nest 12 (`Found 0 errors`,
`Nest application successfully started`, `GET /api/settings` 200 5504).

### Riesgos y notas

- **Vitest no ve la interop CJS de Node** (US-90): la red real es la huella
  contra la API compilada. Cualquier dependencia CJS nueva hay que pasarla
  por `check-named-imports.mjs` o por una ruta.
- `nestjs-stripe` 1.0.0 carga `@nestjs/common` 12 por `require(esm)`.
  Funciona (`StripeModule dependencies initialized`), pero es otro motivo
  para US-87.
- La huella se comparó contra los valores documentados de la línea base
  (los JSON de la sesión de US-90 ya no existían). El script reconstruido
  reprodujo cada sha, así que mide lo mismo.

## Decisión del dueño al integrar (2026-10-26)

**DA-3: el CLI se queda en 11.** `@nestjs/cli` 11.0.24 y
`@nestjs/schematics` 11.1.0 no se suben mientras la máquina tenga Node
22.14. Compilan con el TypeScript 6 del proyecto y cargan el plugin de
Swagger 12, así que `just api-dev` y `just build-api` funcionan. Cuando se
actualice Node a 22.22.3+ o 24.15+ (`just doctor` ya avisa), se suben los
dos a 12 y se regenera el lockfile.
