# US-90 — La API de CommonJS a ESM

> NestJS 12 se publica solo como ESM (`"type": "module"`). Esta US pasa la
> API a ESM todavía en Nest 11, para que el salto de sistema de módulos se
> verifique solo. Es la US más grande del camino a Nest 12, por número de
> archivos.

**Épico:** [Épico 75](./README.md)
**Fecha:** 2026-10-24
**Status:** Detenida en el CA-1 (2026-10-25): el plugin de Swagger de
`@nestjs/swagger` 11.4.7 no emite ESM ejecutable. Hace falta una decisión
del dueño (DA-4, abajo)
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

- [x] DA-1..DA-3 confirmadas (propuestas por defecto aplicadas). DA-4
      abierta.
- [x] Línea base (vitest, huella de contrato) en CommonJS. `just verify`:
      pendiente de la integración (los puertos 3002/3003 los usa US-82).
- [ ] CA-1..CA-3 con la salida pegada. **Bloqueado en el CA-1** (ver
      «Resultado»).
- [x] El codemod de extensiones en un commit propio, separado de los ajustes
      a mano.
- [x] Lint sin escribir en 0.
- [ ] Status actualizado aquí y en la tabla del épico (aquí sí; la tabla del
      épico queda para la integración).

## Notas para el agente ejecutor

- Lee con Context7 la sección ESM de la guía de migración a Nest 12 y la
  plantilla ESM de `nest new`.
- Si esta US no cabe en una sesión, se para en un punto estable (por
  ejemplo, después del codemod con los tests en verde) y se pregunta si se
  parte.

## Resultado — ejecutado el 2026-10-25 (parcial: detenida en el CA-1)

Rama `worktree-agent-a02b26332e663f5f6` (worktree aislado, avanzada con
`git merge --ff-only main` hasta `f88d560`). API compilada (`yarn build` +
`node dist/main.js`) en el puerto 9011 con
`PORT=9011 DATABASE_URL=postgresql://safari:safari@localhost:5433/safari_scraper JWT_SECRET=us90-desechable`,
las mismas variables antes y después.

**Resumen:** la configuración ESM, el codemod y los ajustes a mano están
hechos, y `tsc`, el lint y Vitest (34 / 565) están en verde. Pero
`node dist/main.js` **no arranca**: el plugin de Swagger de `nest-cli.json`
(`@nestjs/swagger` 11.4.7, la última de la línea 11) sigue emitiendo
`require(…)` en los metadatos que inyecta, y en ESM `require` no existe.
Las tres salidas que probé (abajo) fallan o cambian `/docs-json`. Elegir
una cambia el pipeline de build o el orden del épico, así que lo decide el
dueño (DA-4).

### Commits

| Hash | Qué |
|---|---|
| `bc45da1` | Configuración: `package.json` (`type`, `imports`, `start:prod`), `tsconfig.json`, `vitest.config.ts` |
| `45cc384` | Codemod (mecánico, revisado): 703 relativos con `.js`, 412 `src/…` a `#src/….js`, 11 `@db/…` a `#db/…`, en 321 archivos (1126 líneas cambiadas, una por especificador) |
| `d1758c2` | Ajustes a mano: JSON, `import.meta.dirname`, `type CurrentUserPayload`, interop de `bcryptjs`, PayPal y `fuse.js`, y `prettier` sobre 6 imports |

El codemod (`codemod-esm.mjs`, en el scratchpad de la sesión) resuelve cada
especificador contra el disco: `x.ts` → `x.js`, carpeta con `index.ts` →
`x/index.js` (no hubo ninguno), y los `.json` conservan su extensión. Si un
especificador no resuelve, aborta. Salida:
`src { rel: 703, src: 412, db: 11, files: 321 }`. Las cifras cuadran con
las de la US (703) y US-89 (423 = 412 + 11).

### Decisiones

| # | Qué se aplicó |
|---|---|
| DA-1 | **(a), propuesta por defecto aplicada.** `import x from '#db/x.json' with { type: 'json' }` en los 12 imports JSON (11 `@db/*` más `src/db/pickbazar/payment-gateway.json` en `stripe-payment.service.ts`). `tsc` (`nodenext`) los exige (TS1543) y `nest build` los emite tal cual; `dist/db/pickbazar/` trae los 9 JSON importados. En el experimento A (abajo), Node 22.14 los ejecutó: las 4 rutas del mock sin autenticación dieron los mismos bytes y sha que en CommonJS. Las 3 con token de admin dieron 401, porque el login fallaba por `bcryptjs` (corregido después) |
| DA-2 | **(b), propuesta por defecto aplicada, extendida a `src/*`.** `imports` de `package.json`: `"#db/*": {"types": "./src/db/pickbazar/*", "default": "./dist/db/pickbazar/*"}` y `"#src/*": {"types": "./src/*", "default": "./dist/*"}`. Desaparecen los `paths` del `tsconfig`. `types` lo lee `tsc` (resuelve al `.ts` del código fuente); `default` lo lee Node (resuelve al `dist/`). Vitest tiene sus propios alias a `src/`. No vi razón técnica para preferir rutas relativas en `src/*` |
| DA-3 | **(a), propuesta por defecto aplicada.** `@safari/db` sigue CJS. Desde ESM, Node detecta sus 217 exports con nombre (tsup emite la anotación que lee `cjs-module-lexer`), y los 172 nombres que importa `src/` existen (CA-3). La interop funciona |

`tsconfig.json` sigue la plantilla ESM de `nest new` (Context7,
`docs.nestjs.com/migration`) en `module`/`moduleResolution` `nodenext`,
`resolvePackageJsonExports` e `isolatedModules`. Me separé de ella en dos
puntos:

- **`target` sigue en `es2017`, y no en `ES2023`.** Con un `target` ES2022
  o superior, `useDefineForClassFields` pasa a `true`, y cada propiedad
  declarada sin inicializar (todos los DTO y entidades) se vuelve un campo
  propio con valor `undefined`, que pisa lo que asigne una clase base. Eso
  cambia el runtime y no tiene que ver con ESM.
- **`rootDir` sigue en `./src` (en `tsconfig.build.json`), y no en `"."`.**
  Así la salida queda en `dist/main.js`, como pide el CA-1, y el
  `tsBuildInfoFile` de US-89 sigue dentro de `dist/`.

`strict` sigue en `false` (US-89). **`justfile`: sin cambios.** `api-dev`
usa `nest start --watch`, que lanza `node dist/main`, y Node resuelve la
extensión del punto de entrada también en ESM (comprobado: `node dist/main`
llega al mismo error de abajo). `start:prod` pasa a `node dist/main.js`.

### Línea base en CommonJS

```
$ yarn build
$ rimraf dist
$ nest build
Done in 139.59s.            # 332 .js en dist/
$ npx vitest run
 Test Files  34 passed (34)
      Tests  565 passed (565)
$ npx tsc --noEmit -p tsconfig.json
tsc=0
$ node node_modules/eslint/bin/eslint.js "{src,apps,libs,test}/**/*.ts"
eslint=0
$ node dist/main            # log
[InstanceLoader] StripeModule dependencies initialized +50ms
[NestApplication] Nest application successfully started +10ms
Application is running on: http://[::1]:9011/api
```

El lint se corrió con el binario de `eslint` por ruta, porque el guardián
del worktree rechaza un glob detrás de `npx`. Es el mismo binario y el
mismo glob.

La huella de contrato de US-78 en CommonJS sale idéntica, línea a línea, a
la de US-89: `/settings` 5504 `847a1e29cc0ddbd8` … `/docs-json` 184441
`c7269d664b474cce` paths=169, `/docs` 3126 `20f2dfd8e26ac3b3`, y Q10/Q11
con su 500 de antes. Le sumé una huella de las rutas que leen el mock JSON,
la base de DA-1:

```
authors.json                 /authors?limit=3                  200 4436  51fc0583a398d590
flash-sale.json              /flash-sale?limit=2               200 14571 6a8a59dd82b085fb
products-by-flash-sale.json  /products-by-flash-sale?limit=2   200 6064  6a3e1d8b03c33ac7
orders.json                  /orders?limit=2 (admin)           200 35360 c4d1853adc671a42
payment-gateway + methods    /cards (admin)                    200 2     4f53cda18c2baa0c
taxes.json                   /taxes                            200 218   76a39008cdb925a7
payment-intent (+orders)     /payment-intent?tracking_number=… 200 167   d62fc6ef1b179521
```

### Después: lo que está en verde

```
$ npx tsc --noEmit -p tsconfig.json
tsc=0
$ node node_modules/eslint/bin/eslint.js "{src,apps,libs,test}/**/*.ts"
eslint=0
$ npx vitest run
 Test Files  34 passed (34)
      Tests  565 passed (565)
$ yarn build
$ rimraf dist
$ nest build
Done in 74.08s.             # 333 .js (el nuevo es common/fuse.js)
```

El aviso de Vite de US-88 (`ESM syntax in a file loaded as CommonJS
(vitest.config.ts)`) ya no sale. `vitest.config.ts` usa
`import.meta.dirname`.

El primer `tsc` tras el codemod, antes de los ajustes a mano, dio 63 TS1272,
12 TS1543 y 4 TS2351. **No dio ningún TS2307**: los 423 alias resuelven por
`imports`.

### Ajustes a mano y por qué

| Ajuste | Motivo |
|---|---|
| `with { type: 'json' }` en 12 imports | TS1543 con `nodenext`, y Node exige el atributo (DA-1) |
| `import.meta.dirname` en 3 specs | `__dirname` no existe en ESM. Los tests pasaban igual porque Vitest lo inyecta, pero Node no |
| `type CurrentUserPayload` en 19 controladores | TS1272: con `isolatedModules` + `emitDecoratorMetadata`, una interfaz que aparece en una firma decorada se importa con `type`. Solo se tocaron los 19 archivos con el error; los servicios que la importan fuera de un decorador no lo necesitan |
| `bcryptjs` y `@paypal/checkout-server-sdk`: `import x from` en vez de `import * as x` | **Fallaban en runtime y los tests no lo veían.** Desde ESM, el namespace de esos CJS solo trae `default` (bcryptjs) o `core` + `default` (PayPal). En el experimento A, `bcrypt.compare is not a function` daba un 500 en `POST /token`. Vitest no reproduce la interop de Node, porque su runner mezcla las claves. Los tipos aguantan el import por defecto (`tsc` 0) |
| `src/common/fuse.ts` (`createRequire`) para `fuse.js` 6 | TS2351: el paquete es CJS (`module.exports = Fuse`), pero sus tipos declaran `export default Fuse`. En runtime el import por defecto ya da la clase, pero TS lo tipa como `{ default: Fuse }`. El helper toma el valor con `require` y el tipo de la vista CJS (`resolution-mode: 'require'`), sin casts. Lo usan `authors`, `flash-sale` y `notify-logs` |
| `prettier` en 6 imports | El codemod dejó 6 líneas por encima de 80 columnas |

### CA-3 — Interop

Lo comprobé con `node --input-type=module` desde `apps/api/rest` (el
namespace de cada paquete visto desde ESM), más un script que contrasta
cada import con nombre de `src/` contra ese namespace:

```
@safari/db          172 nombres ok      (namespace: 217 claves)
class-transformer     2 nombres ok      (plainToClass, Type)
class-validator       5 nombres ok      (IsString, IsIn, IsBoolean, IsNotEmpty, IsOptional)
nestjs-stripe         2 nombres ok      (namespace: InjectStripe, StripeModule, __esModule, default, stripeToken)
stripe                1 nombre  ok      (default)
uuid, fuse.js, @nestjs/swagger, @nestjs/core, @nestjs/config, @nestjs/mapped-types   ok
bcryptjs                     import * as -> claves [default]        -> corregido a import por defecto
@paypal/checkout-server-sdk  import * as -> claves [core, default]  -> corregido a import por defecto
```

El script también marca como «faltan» nombres de `@nestjs/common`,
`@nestjs/jwt`, `@nestjs/platform-express` y `express`. Son interfaces
(`ExecutionContext`, `CanActivate`, `JwtModuleOptions`,
`NestExpressApplication`, `Request`…), y TS las borra al compilar.

| Dependencia CJS | Cómo se importa | Evidencia |
|---|---|---|
| `@safari/db` | Con nombre (`import { … } from '@safari/db'`) | 172 de 172 nombres presentes. Experimento A: `/settings`, `/products…`, `/shops`, `/categories`, Q1–Q7, Q9 y Q12–Q14, con los mismos bytes y sha que en CJS |
| `nestjs-stripe` | Con nombre (`StripeModule`, `InjectStripe`) | Experimento A: `StripeModule dependencies initialized` y `StripeCoreModule dependencies initialized` en el log |
| `class-validator` / `class-transformer` | Con nombre | Experimento A: `POST /token {}` → 401 87 `9ada84476f484068`, igual que en CJS. Las rutas del mock sin token (usan `plainToClass`) dan los mismos bytes |
| `stripe` | Por defecto (`import Stripe from 'stripe'`) | El namespace trae `default`. Ninguna ruta lo ejerce (el servicio no tiene controlador) |
| `bcryptjs`, PayPal, `fuse.js` | Por defecto, o `createRequire` (fuse) | Ver la tabla de ajustes. El arreglo de `bcryptjs` falta comprobarlo en la app (`POST /token` 201) |

### CA-1 — Bloqueo: el plugin de Swagger

```
$ node dist/main.js
file:///…/apps/api/rest/dist/messages/messages.controller.js:34
    openapi.ApiResponse({ status: 201, type: require("./entities/message.entity", { with: { "resolution-mode": "import" } }).Message }),
                                             ^
ReferenceError: require is not defined in ES module scope, you can use import instead
```

113 de los 333 `.js` de `dist/` tienen ese `require(…)`. Lo inyecta el
plugin de `@nestjs/swagger`: los `type: () => …` de los modelos y los
`ApiResponse` que deduce de los tipos. En la 11.4.7, la detección de ESM
está a medias: el `openapi` lo importa con `createRequire` (`__require`),
pero las referencias a tipos siguen saliendo como `require`.

Probé tres salidas. Ninguna se quedó en la rama:

| Intento | Resultado |
|---|---|
| `"options": { "esmCompatible": true }` en `nest-cli.json` | Emite `type: () => (await import("./x.js")).X` dentro de funciones flecha que no son `async`: `node --check dist/addresses/entities/address.entity.js` → `SyntaxError: Unexpected reserved word` |
| Post-procesar `dist/` (`require(` → `__require(`, que el plugin ya define con `createRequire`) | `ERR_REQUIRE_CYCLE_MODULE: Cannot require() ES Module …/products/entities/product.entity.js in a cycle` (desde `analytics.controller.js`). `require(esm)` no admite ciclos, y las entidades los tienen |
| **(A)** Metadatos en modo `readonly`: `PluginMetadataGenerator` + `ReadonlyVisitor({ esmCompatible: true })` genera `src/metadata.ts` (124 KB, `export default async () => …` con `await import`). Se quita el plugin de `nest-cli.json` y `main.ts` hace `await SwaggerModule.loadPluginMetadata(metadata)` | **Arranca como ESM** (`Nest application successfully started`). Pero el archivo generado no compila tal cual: da TS2339 en `t["./settings/entities/setting.entity.js"].Object` (la interfaz `Maintenance`), y hubo que corregirlo a mano. Además, **`/docs-json` cambia**: pasa de 184441 a 183695 bytes, con las mismas 169 rutas y 38 diferencias en 6 esquemas. Se pierden los `enum` de `permission` en `CreateUserDto`, `UpdateUserDto` y `RegisterDto`, y los de `product_type`/`status` en `Product`, `CreateProductDto` y `UpdateProductDto`, y con ellos su lugar en `required`. Del resto de la huella, 21 de 27 entradas salieron iguales. Las 6 distintas son `/docs-json` y 5 que dependen del login, roto entonces por `bcryptjs` |

**Lo que lo resuelve:** `@nestjs/swagger` 12. Lo inspeccioné con `npm pack`
de la 12.0.4 (`dist/plugin`): detecta ESM por archivo
(`utils/module-format.util.js`, `impliedNodeFormat`) y emite imports
estáticos elevados (`openapi_import_N`), sin `require` ni `await import`.
Por eso la guía dice que `nest-cli.json` es igual en CommonJS y en ESM.
Pero pide `@nestjs/common` y `@nestjs/core` `^12.0.0`, así que no se puede
usar con Nest 11.

### DA-4 — Abierta: cómo destrabar el CA-1

| Opción | Coste |
|---|---|
| **(a)** Verificar el arranque ESM junto con US-91. Esta rama queda como base (configuración, codemod y ajustes, todo en verde), y el CA-1/CA-2 de US-90 se cierra al subir a Nest 12 + `@nestjs/swagger` 12 | Rompe la regla del épico de «un salto, una US» en la verificación, aunque no en el código: los 3 commits ya aíslan el cambio a ESM. **Propuesta por defecto** |
| **(b)** Metadatos `readonly` (experimento A) en Nest 11 | Mete un artefacto generado de 124 KB en el pipeline (un paso previo a `nest build`, del que dependen `tsc` y el lint), pide un arreglo a mano en el archivo generado y deja un `/docs-json` distinto (38 diferencias) que habría que aceptar o corregir en los DTO. Además, US-91 lo desharía |
| **(c)** Quitar el plugin de Swagger | `/docs-json` cambia en masa. Descartable |

### Lo que falta (al resolver DA-4)

- CA-1: `node dist/main.js` con «Nest application successfully started»,
  más `/docs` y `/docs-json`.
- CA-2: la huella de contrato completa comparada contra la de CommonJS, y
  la de las rutas del mock. `just verify` con el frontend queda
  **pendiente de la integración**, porque US-82 usa 3002/3003/9001.
- CA-3: repetir en la app final las evidencias del experimento A, ya con
  `bcryptjs`/PayPal corregidos (`POST /token` 201).

### Lo que US-91 debe saber

- `nest-cli.json` sigue con `"plugins": ["@nestjs/swagger"]` sin opciones.
  Con Swagger 12 debería bastar la detección automática. Hay que comprobar
  que `grep -rE '[^_.]require\("' dist --include=*.js` da 0.
- Vitest no reproduce la interop CJS de Node: los 565 tests pasaban con
  `bcrypt.compare` roto en runtime. La red real de la interop es la huella
  de contrato con la API compilada.
- `isolatedModules` está activo. Una interfaz nueva en una firma decorada
  se importa con `type`.
- Con los `@nestjs/*` 12 hay que repetir la comprobación de los namespaces
  CJS: contrastar cada import con nombre contra lo que Node expone.
