# US-89 — TypeScript 6 en la API

> El CLI y los schematics de NestJS 12 exigen TypeScript 6. Esta US sube la
> API de TypeScript 5.9.3 a 6.x, todavía en CommonJS y en Nest 11, para que
> el cambio de compilador no se mezcle con el de ESM (US-90).

**Épico:** [Épico 75](./README.md)
**Fecha:** 2026-10-24
**Status:** Implementada (2026-10-25)
**Depende de:** US-88 (Vitest; ts-jest declara `typescript >=4.3 <7` y deja
de importar)
**LOC est.:** ~80

## Historia

**Como** mantenedor de la API, **quiero** TypeScript 6, **para** cumplir el
requisito del CLI de Nest 12 sin tocar todavía el sistema de módulos.

## Contexto — verificado (2026-10-24)

- **Versiones:** la última es `typescript@6.0.3`, publicada el 2026-04-16.
  La API declara `^5.9.3` (US-77).
- **Lo que pide Nest 12:** según la guía de migración, `nest upgrade` sube
  TypeScript a v6 y revisa `tsconfig.json` y `tsconfig.build.json` en busca
  de opciones que TypeScript 6 ya no admite, «como un `moduleResolution`
  legacy o un `rootDir` que falta».
- **El `tsconfig.json` de la API hoy:**
  - `"module": "commonjs"`, sin `moduleResolution` (cae en el legacy
    `node10`);
  - `"target": "es2017"`, `baseUrl: "./"`, `paths` para `@db/*` y
    `types: ["node", "express", "multer"]`;
  - sin `rootDir`.
- **`typescript-eslint`** está en 5.62 (US-81 lo sube a la 8) y puede no
  soportar TypeScript 6.

## Scope

**Incluye:**

- `typescript` 6.x;
- los ajustes de `tsconfig.json` y `tsconfig.build.json` que TypeScript 6
  exija (`moduleResolution`, `rootDir`, `baseUrl`/`paths` si están
  obsoletos), con la menor diferencia posible y sin cambiar a ESM;
- lo que haga falta en `src/` para compilar sin errores, sin `as any` ni
  `@ts-ignore`.

**NO incluye:** ESM (US-90), Nest 12 (US-91) ni las reglas de lint (US-81).

## Criterios de aceptación

### CA-1 — Compila sin avisos de obsolescencia

`npx tsc --noEmit -p tsconfig.json` y `yarn build` dan 0 errores y ningún
aviso de opción obsoleta.

### CA-2 — Misma batería y mismo contrato

`npx vitest run` mantiene las cifras de US-88. La huella de contrato de
US-78 (27 peticiones, con la API levantada) da idéntica.

### CA-3 — El lint sigue corriendo

El lint sin escribir sigue en 0. Si `typescript-eslint` 5.62 no admite
TypeScript 6, la US se detiene y pregunta si adelanta US-81.

## Escenarios Gherkin

```gherkin
Feature: API en TypeScript 6
  Scenario: CA-2 — nada visible cambia
    Given la huella de contrato tomada en TypeScript 5.9
    When la API compila con TypeScript 6
    Then las 27 respuestas son idénticas
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `apps/api/rest/package.json`, `yarn.lock` | `typescript` |
| `apps/api/rest/tsconfig.json`, `tsconfig.build.json` | lo que exija TypeScript 6 |
| `apps/api/rest/src/**` | solo errores nuevos de tipos |

## Definición de Done

- [x] Línea base (tsc, build, vitest y huella de contrato) en TypeScript 5.9.
- [x] CA-1..CA-3 con la salida pegada.
- [ ] Status actualizado aquí y en la tabla del épico (aquí sí; la tabla del
  épico la actualiza quien integra).

## Notas para el agente ejecutor

- Lee con Context7 las notas de versión de TypeScript 6.0 (opciones
  retiradas y cambios de valores por defecto) antes de tocar el
  `tsconfig`.
- La huella de contrato no está en el repo (US-78 la dejó en un directorio
  temporal). Si no la tienes, reescríbela a partir de la tabla de CA-2 de
  US-78.

## Resultado — ejecutado el 2026-10-25

Rama `worktree-agent-a97d998fc4de08f04` (worktree aislado, sobre `main` en
`e2be4f3`). API compilada (`yarn build` + `node dist/main`) en el puerto
9011 con `PORT=9011 DATABASE_URL=postgresql://safari:safari@localhost:5433/safari_scraper JWT_SECRET=us89-desechable`,
las mismas variables antes y después. Ningún cambio en `src/`.

### Versiones

| Paquete | Antes | Después |
|---|---|---|
| `typescript` (devDependency de la API) | `^5.9.3` (5.9.3) | `^6.0.3` (6.0.3, publicada el 2026-04-16) |
| `typescript` anidado de `@nestjs/cli` 11.0.24 | 5.9.3 | 5.9.3 (sin cambio; ver abajo) |

`@nestjs/cli` trae su propio `typescript@5.9.3` como dependencia, pero su
`TypeScriptBinaryLoader` resuelve `typescript` desde `process.cwd()` primero,
así que `nest build` compila con el 6.0.3 del proyecto (lo confirma el
`TS5011` de abajo, que solo existe en TS 6). `typescript-eslint@8.71.1`
declara `typescript >=4.8.4 <6.1.0` y `unplugin-swc@2.0.0` no declara
`typescript`: ninguno obligó a subir nada más. `yarn install
--frozen-lockfile` posterior: `success Already up-to-date`. En `yarn.lock`,
además de `typescript`, yarn reordenó el bloque de `globals@^17.13.0`
(misma versión y hash; solo cambia de sitio).

### Lectura previa: notas de versión de TypeScript 6.0 (Context7, `microsoft/typescript-website`)

Lo que afecta a este `tsconfig`:

- **`baseUrl` obsoleto** (TS5101) y deja de ser raíz de búsqueda de
  módulos. La API lo usaba justamente como raíz: los imports
  `from 'src/…'` aparecen en casi todos los módulos de `src/` (423
  imports `src/…` o `@db/…` en 176 archivos).
- **`moduleResolution node10` obsoleto** (TS5107). La API no lo declaraba:
  en TS 6, con `module: commonjs` y sin `moduleResolution`, el valor por
  defecto pasa a ser **`bundler`** en modo CJS (traza:
  `Module resolution kind is not specified, using 'Bundler'.` /
  `Resolving in CJS mode with conditions 'require', 'types'.`), así que no
  hay aviso ni hay que escribir nada.
- **`rootDir` pasa a ser por defecto el directorio del `tsconfig`** en vez
  de inferirse.
- **`strict` pasa a `true` por defecto** (también
  `noUncheckedSideEffectImports`; `target` y `module` por defecto cambian,
  pero la API los declara).
- `types` ya no incluye todo `@types/*`: la API ya fija
  `["node", "express", "multer"]`, sin cambio.
- `esModuleInterop`/`allowSyntheticDefaultImports` ya no admiten `false`:
  la API ya los tenía en `true`.

### Cambios del tsconfig y su motivo

```diff
 // tsconfig.json
     "target": "es2017",
+    "strict": false,
     "sourceMap": true,
     "outDir": "./dist",
-    "baseUrl": "./",
     "paths": {
-      "@db/*": ["./src/db/pickbazar/*"]
+      "@db/*": ["./src/db/pickbazar/*"],
+      "src/*": ["./src/*"]
     },

 // tsconfig.build.json
   "extends": "./tsconfig.json",
+  "compilerOptions": {
+    "rootDir": "./src",
+    "tsBuildInfoFile": "./dist/tsconfig.build.tsbuildinfo"
+  },
   "exclude": ["node_modules", "test", "dist", "**/*spec.ts", "vitest.config.ts"]
```

| Cambio | Motivo |
|---|---|
| Quitar `baseUrl` | TS5101: obsoleto en 6.0, deja de funcionar en 7.0 |
| `"src/*": ["./src/*"]` | Reemplaza a `baseUrl` como raíz de los imports `src/…`, que era su único uso real. Más estrecho que el comodín `"*": ["./*"]` que sugieren las notas: solo `src/` dependía de `baseUrl` (`tsc` da 0 errores con esto). El hook de alias de `nest build` (`tsconfig-paths`, con `baseUrl = './'` por defecto) sigue reescribiendo `src/…` a rutas relativas en `dist/` |
| `"strict": false` | Conserva el valor por defecto de TS 5.9. Sin esto, `tsc` da 777 errores nuevos (703 `TS2564`, 25 `TS2322`, 18 `TS18048`…), que no son de TS 6 sino de activar `strict`: queda fuera de scope |
| `rootDir: "./src"` en `tsconfig.build.json` | TS5011: sin él la salida va a `dist/src/main.js` y `node dist/main` no arranca. En `tsconfig.json` no se puede poner: incluye `vitest.config.ts`, que está fuera de `src/` |
| `tsBuildInfoFile` dentro de `dist/` | Con `rootDir` fijado, TS 6 escribe el `.tsbuildinfo` en `apps/api/rest/` en vez de en `dist/`. Como `prebuild` es `rimraf dist` e `incremental` está en `true`, el **segundo** `yarn build` encontraba un buildinfo al día y **no emitía nada** (`dist` vacío, comprobado). Devolverlo a `dist/` restablece el comportamiento de TS 5.9 |

No se declaró `moduleResolution`: el valor por defecto de TS 6 para
CommonJS (`bundler` con la condición `require`) es el que corresponde y no
genera aviso; escribirlo sería una línea sin efecto.

### Línea base en TypeScript 5.9.3

```
$ npx tsc -v
Version 5.9.3
$ npx tsc --noEmit -p tsconfig.json
tsc exit=0
$ yarn build
$ rimraf dist
$ nest build
Done in 48.27s.
-rw-r--r-- 1 ... 1220 Oct 25 00:18 dist/main.js
$ npx vitest run
 Test Files  34 passed (34)
      Tests  565 passed (565)
$ npx eslint "{src,apps,libs,test}/**/*.ts"
eslint exit=0
```

La huella de contrato de la línea base está en el CA-2 (es idéntica a la de
después).

### Primer intento en TS 6.0.3 con el tsconfig sin tocar

```
$ npx tsc --noEmit -p tsconfig.json
tsconfig.json(14,5): error TS5101: Option 'baseUrl' is deprecated and will stop functioning in TypeScript 7.0. Specify compilerOption '"ignoreDeprecations": "6.0"' to silence this error.
  Visit https://aka.ms/ts6 for migration information.

# sin baseUrl y con la ruta src/*, antes de fijar strict (recuento por código):
    703 TS2564   25 TS2322   18 TS18048   10 TS2366   9 TS2345   4 TS7006
      2 TS2532    2 TS2769    2 TS7023    1 TS1239   1 TS7016

# con strict: false, sin rootDir en el build:
$ yarn build
error TS5011: The common source directory of 'tsconfig.build.json' is './src'. The 'rootDir' setting must be explicitly set to this or another path to adjust your output's file layout.
  Visit https://aka.ms/ts6 for migration information.
Found 1 error(s).
$ ls dist/src/main.js
dist/src/main.js

# con rootDir pero sin tsBuildInfoFile, segundo build seguido:
$ yarn build
$ rimraf dist
$ nest build
Done in 12.62s.
ls: cannot access 'dist': No such file or directory
```

No se usó `ignoreDeprecations`.

### CA-1 — Compila sin avisos de obsolescencia ✅

```
$ npx tsc -v
Version 6.0.3
$ npx tsc --noEmit -p tsconfig.json
tsc exit=0
$ npx tsc --noEmit -p tsconfig.build.json
tsc build-config exit=0
$ yarn build          # dos veces seguidas, para descartar el problema del buildinfo
$ rimraf dist
$ nest build
Done in 127.09s.
1006                  # archivos en dist/
$ rimraf dist
$ nest build
Done in 20.24s.
1006
-rw-r--r-- 1 ... 1220 Oct 25 00:30 dist/main.js
-rw-r--r-- 1 ... 958609 Oct 25 00:30 dist/tsconfig.build.tsbuildinfo
```

Ningún aviso de opción obsoleta en `tsc` ni en `nest build`.

**La salida compilada es idéntica a la de TS 5.9.** `diff -rq` del `dist/`
de la línea base contra el `dist/` en TS 6: los 332 `.js` y todos los
`.js.map` y `.d.ts` son iguales byte a byte; solo difiere
`tsconfig.build.tsbuildinfo` (estado interno del compilador):

```
$ diff -rq dist-ts59 dist
Files dist-ts59/tsconfig.build.tsbuildinfo and dist/tsconfig.build.tsbuildinfo differ
```

### CA-2 — Misma batería y mismo contrato ✅

```
$ npx vitest run
 Test Files  34 passed (34)
      Tests  565 passed (565)
   Duration  61.25s (transform 40.59s, setup 0ms, import 244.17s, tests 3.15s, environment 14ms)
```

Igual que US-88 (34 / 565). `unplugin-swc` no usa el compilador de TS
(SWC transpila por su cuenta), así que la red de tipos es el `tsc --noEmit`
del CA-1.

Huella de contrato de US-78 (27 entradas, API compilada en el 9011),
tomada en TS 5.9 y en TS 6. Las dos salidas son iguales línea a línea:

```
POST /token (login)                                  201  permissions,role,token
GET /settings                                        200 5504 847a1e29cc0ddbd8
GET /products?limit=5                                200 5145 7a88bbcec44e6117
GET /products?search=name:apple                      200 5318 9cfa00c450d6bda3
GET /shops                                           200 13788 b6764f4ab1085929
GET /categories?limit=3                              200 4254 cff354564b37c17d
GET /me                                              200 1345 7fb72c0c5dff5174
POST /token {} (validación)                          401 87 9ada84476f484068
POST /token mala contraseña                          401 87 9ada84476f484068
POST /messages/seen/999999 cuerpo 1                  404 93 0186dfe12a50b34e
GET /products/999999999999999999999 (fuera de rango) 404 106 9f2803081745e97c
Q1 products search compuesto + searchJoin + page     200 5228 78ec6f210cae2f6f
Q2 products orderBy/sortedBy                         200 3253 9dfb2dc861237d0d
Q3 products type.slug (como el shop)                 200 4296 62d8a6ad320bb5e8
Q4 shops is_active + page                            200 1742 f9f53925d7b41108
Q5 categories parent=null                            200 14171 df05df25408c0ed9
Q6 tags orderBy                                      200 986 c0562be7599a95d8
Q7 manufacturers limit                               200 2225 0dc03596031edab1
Q8 users (admin) page/limit                          200 16025 8ab02df5ed6fd759
Q9 popular-products                                  200 2809 f53c43e855d5e035
Q10 search repetido (array)                          500 52 fcbda2e2660dbbff
Q11 search anidado search[name]                      500 52 fcbda2e2660dbbff
Q12 limit con corchetes limit[]                      200 2316 33d324ceecb915d3
Q13 types orderBy anidado                            200 6506 d091257f3ca3af6c
Q14 page anidado shops                               200 1036 8a9f82fe0fe36c73
GET /docs-json                                       200 184441 c7269d664b474cce paths=169
GET /docs                                            200 3126 20f2dfd8e26ac3b3

$ node -e "<diff de contract-ts59.json contra contract-ts6.json, clave a clave>"
entradas 27 27 diferencias 0
```

El plugin de Swagger de `nest-cli.json` sigue funcionando: `/docs-json` da
las mismas 169 rutas y el mismo sha. Los 500 de Q10/Q11 ya estaban así en
la línea base (vienen de US-78).

### CA-3 — El lint sigue corriendo ✅

```
$ npx eslint "{src,apps,libs,test}/**/*.ts"
eslint exit=0
```

El lint usa tipos (`parserOptions.project: 'tsconfig.json'`), así que
`typescript-estree` 8.71.1 parsea con TS 6.0.3, y no emitió el aviso de
versión no soportada. `prettier --check` de `tsconfig.json`,
`tsconfig.build.json` y `package.json`: sin cambios de formato.

### Desvíos

- **El contexto de la US estaba desfasado en dos puntos:** `typescript-eslint`
  ya no está en 5.62 (US-81 lo subió a 8.71.1, que admite TS 6.0), así que
  el CA-3 no tuvo que preguntar nada; y en TS 6 el `moduleResolution`
  implícito de CommonJS ya no es `node10` sino `bundler`, así que no hizo
  falta declararlo.
- **Dos ajustes que la US no anticipaba:** `strict: false` (un cambio de
  valor por defecto, no una obsolescencia) y `tsBuildInfoFile` (efecto
  colateral de fijar `rootDir`: sin él, el segundo `yarn build` no emite
  nada).
- La rama del worktree nacía en `2d94798`, por detrás de `main`; se avanzó
  con `git merge --ff-only main` (`e2be4f3`) antes de empezar.

### Lo que hereda US-90 (ESM)

- `moduleResolution` sigue implícito (`bundler` en modo CJS). Al pasar a
  ESM, las notas de TS 6 recomiendan `module`/`moduleResolution`
  `nodenext`; eso es de US-90.
- Los imports `src/…` y `@db/…` se resuelven por `paths` y en runtime los
  reescribe el hook de alias de `nest build` a rutas relativas en `dist/`.
  En ESM las rutas relativas necesitan extensión `.js`: US-90 decide si los
  convierte a relativos o a `imports` de `package.json` (`#src/*`).
- `rootDir: "./src"` y `tsBuildInfoFile` viven en `tsconfig.build.json`; si
  US-90 reorganiza los `tsconfig`, el `.tsbuildinfo` tiene que quedar dentro
  de lo que borra `prebuild` (o quitar `incremental`).
- `strict: false` está explícito: activarlo es una decisión aparte (777
  errores hoy), no parte de US-90.
