# US-81 — ESLint 9 con flat config y Prettier 3 en las tres apps

> Migra el lint del shop, del admin y de la API de ESLint 8 (`.eslintrc`) a
> ESLint 9 con `eslint.config.mjs`, y sube Prettier a la 3. Es requisito de
> Next 16: `eslint-config-next` 16 pide `eslint >=9`.

**Épico:** [Épico 75](./README.md)
**Fecha:** 2026-10-24
**Status:** Implementada (2026-10-24)
**Depende de:** US-80 y US-77 (y US-74, si llega antes; ver R-7)
**LOC est.:** ~250

## Historia

**Como** mantenedor, **quiero** el lint en ESLint 9, **para** poder subir a
Next 16 y dejar de depender de un formato de configuración obsoleto.

## Contexto — verificado (2026-10-24)

| App | Archivo hoy | ESLint | Base |
|---|---|---|---|
| shop | `apps/shop/.eslintrc.json` | 8.53.0 | `next` + `prettier`, `exhaustive-deps: 0` |
| admin/rest | `apps/admin/rest/.eslintrc.json` | 8.53.0 | `next` + `prettier`, `exhaustive-deps: 0`, `no-img-element: off` |
| api/rest | `apps/api/rest/.eslintrc.js` | 8.57.1 | `@typescript-eslint/recommended` 5.62 + `prettier/recommended`, `no-explicit-any: off`, `no-unused-vars` con `^_` |

- La última versión es ESLint 10.13. `eslint-config-next@16` pide `eslint
  >=9`.
- Prettier: el workspace usa la 2.4.0 en la raíz de `apps/` y la API la
  2.8.8. La última es la 3.9.
- El hook `.claude/hooks/post-tool-use/format-edited-file.cjs` usa el
  Prettier de `apps/node_modules` y el de `apps/api/rest/node_modules`. Si
  Prettier 3 cambia el formato por defecto (por ejemplo, `trailingComma`),
  el hook empezará a reescribir archivos al editarlos.

## Decisiones abiertas para el dueño

| # | Tema | Opciones | Propuesta por defecto |
|---|---|---|---|
| DA-1 | ESLint 9 o 10 | **(a)** La última 9.x. **(b)** La 10 | **(a)**, si `eslint-config-next` 14.2 y `typescript-eslint` 8 no soportan la 10. Se decide con `npm view … peerDependencies` |
| DA-2 | Reformateo de Prettier 3 | **(a)** Reformatear todo en un commit aparte de «solo formato», como en US-72. **(b)** Fijar las opciones de la 2 en `.prettierrc` para que no cambie nada | **(a)**: el precedente del repo es un commit de formato separado |

## Scope

**Incluye:**

- `eslint.config.mjs` en las tres apps, con las mismas reglas que hoy;
- `@typescript-eslint` 8 en la API;
- `eslint-config-prettier` y `eslint-plugin-prettier` en versiones
  compatibles;
- Prettier 3, con DA-2;
- los scripts `lint` de las tres apps;
- las reglas de US-74, si ya existen (R-7);
- el `lint_commands` de `openspec/config.yaml` y el paso 5 de
  `docs/product/README.md`, si cambia el comando.

**NO incluye:**

- endurecer reglas (`no-explicit-any`, `exhaustive-deps`): cada una va en
  una US con su línea base;
- Next 16 (US-82).

## Criterios de aceptación

### CA-1 — Mismas reglas

Para cada app, `eslint --print-config` sobre un archivo representativo, antes
y después, muestra las mismas reglas activas con la misma severidad. Las
diferencias se justifican una por una.

### CA-2 — Lint en 0 (o en su línea base)

La API sigue en 0 problemas. El shop y el admin no dan hallazgos nuevos.

### CA-3 — El hook sigue formateando

Editar un archivo de prueba en cada app deja el formato que produce el
Prettier nuevo. La edición se revierte después.

## Escenarios Gherkin

```gherkin
Feature: Lint en ESLint 9
  Scenario: CA-1 — las reglas no cambian al migrar el formato
    Given la configuración resuelta en ESLint 8
    When se migra a eslint.config.mjs
    Then las reglas activas y su severidad son las mismas
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `apps/shop/eslint.config.mjs`, `apps/admin/rest/eslint.config.mjs`, `apps/api/rest/eslint.config.mjs` | nuevos |
| `apps/shop/.eslintrc.json`, `apps/admin/rest/.eslintrc.json`, `apps/api/rest/.eslintrc.js` | se borran |
| `package.json` de las tres apps y sus lockfiles | versiones y scripts |
| `openspec/config.yaml`, `docs/product/README.md` | si cambia el comando de lint |

## Definición de Done

- [x] DA-1 y DA-2 confirmadas y anotadas.
- [x] CA-1: el diff de `--print-config`, pegado.
- [x] CA-2 y CA-3 con la salida pegada.
- [x] El reformateo de Prettier 3, si lo hay, en su propio commit.
- [ ] Status actualizado aquí y en la tabla del épico. Aquí sí; la tabla del
  épico la actualiza quien integra.

## Notas para el agente ejecutor

- `next lint` con flat config en Next 14.2 puede no funcionar. Si es así,
  el script pasa a `eslint .` y la US lo anota (R-3 del épico).

## Resultado — ejecutado el 2026-10-24

Rama `us-81-eslint-9`, desde `main` @ `68b1d08`. Sin push ni merge.

### Versiones

Cada dependencia directa, en la última versión compatible con más de dos
semanas publicada (corte: 2026-10-10). Exactas en shop y admin; con `^` en la
API, con la entrada del `yarn.lock` fijada en esa versión (si no, el `^`
resolvería a una versión más nueva que el corte).

| Paquete | Antes | Después | Dónde |
|---|---|---|---|
| `eslint` | 8.57.1 | 9.39.5 | shop, admin/rest, API (`^`) |
| `eslint-config-next` | 14.2.35 | 15.5.27 (15.5.28 es del 2026-10-14) | shop, admin/rest |
| `@eslint/eslintrc` (FlatCompat) | — | 3.3.7 | shop, admin/rest |
| `eslint-config-prettier` | 9.1.0 / 8.10.2 | 10.1.8 | shop, admin/rest / API (`^`) |
| `typescript-eslint` | `@typescript-eslint/{parser,eslint-plugin}` 5.62.0 | 8.71.1 (8.72.0 es del 2026-10-19) | API (`^`) |
| `eslint-plugin-prettier` | 4.2.5 | 5.5.6 (5.5.7 es del 2026-10-13) | API (`^`) |
| `globals` (sustituye a `env`) | — | 17.13.0 | API (`^`) |
| `prettier` | 2.4.0 (raíz de `apps/`), 3.3.3 (shop y admin), 2.8.8 (API) | 3.9.9 (3.9.10 es del 2026-10-10, justo en el corte) | las tres |

Queda **una sola copia de Prettier** en el workspace `apps/` (3.9.9, en
`apps/node_modules`), porque la raíz, el shop y el admin declaran la misma.
`apps/admin/graphql` sigue en eslint 8.57.1 con `eslint-config-next` 14.2.35
y su `.eslintrc.json` (fuera de alcance, DA-4 del épico). Su `yarn lint`
falla antes de lintar, por un `invariant` de su `next-i18next.config.js` (le
falta una variable de entorno; esa variante no tiene `.env`), y eso no tiene
que ver con ESLint.

### Commits

| Hash | Contenido |
|---|---|
| `e31dcc2` | Dependencias, lockfiles, `eslint.config.mjs` de las tres apps (se borran los `.eslintrc.*` y `.eslintignore`), scripts `lint` y `lint-staged.config.js` |
| `9c8520f` | Hook de formato y comentarios de `openspec/config.yaml` |
| `3096528` | **Solo formato**: Prettier 3.9.9 en 540 archivos (shop 260, admin/rest 279, API 1); +4578 −4162 |
| (este) | Doc de la US |

### Guías leídas (Context7)

- ESLint, guía de migración a flat config: `ignores` sustituye a
  `.eslintignore` (que la flat config no lee), `globals` sustituye a `env`.
- typescript-eslint v8: cambios del `recommended` (`ban-types` se parte en
  tres, `no-var-requires` → `no-require-imports`, sale `no-loss-of-precision`,
  etc.).
- Next.js: `eslint-config-next` 16 exporta flat config nativa; antes de la 16
  se usa `FlatCompat` (el codemod `next-lint-to-eslint-cli` genera eso).
- Prettier 3.0: `trailingComma` pasa a `"all"` por defecto; el binario pasa de
  `bin-prettier.js` a `bin/prettier.cjs`; `--loglevel` pasa a `--log-level`;
  los plugins ya no se cargan solos.

### DA-1 — ESLint 9 (opción a) ✅

`npm view … peerDependencies` (2026-10-24):

```
eslint-config-next@14.2.35   eslint: ^7.23.0 || ^8.0.0
eslint-config-next@15.5.27   eslint: ^7.23.0 || ^8.0.0 || ^9.0.0
eslint-config-next@16.4.0    eslint: >=9.0.0
@next/eslint-plugin-next@15.5.27   dependencies: { fast-glob: 3.3.1 }   (sin peer de next)
typescript-eslint@8.71.1     eslint: ^8.57.0 || ^9.0.0 || ^10.0.0; typescript: >=4.8.4 <6.1.0
eslint-plugin-prettier@5.5.6 eslint: >=8.0.0; prettier: >=3.0.0
```

Ninguna `eslint-config-next` que acepte ESLint 10 sirve con Next 14.2: la 16
es la de Next 16. Por eso va ESLint 9.

**Decisión técnica: `eslint-config-next` 15.5.27 como puente con Next 14.2.**
Sus reglas cargan y no piden Next 15 en runtime: `@next/eslint-plugin-next`
solo depende de `fast-glob`. Una sonda por stdin lo confirma en las dos apps:

```
$ printf '...if (a) { useState(1); } return <img src="x" />...' | ./node_modules/.bin/eslint --stdin --stdin-filename src/pages/zz-probe.tsx
  3:12  error    React Hook "useState" is called conditionally. ...  react-hooks/rules-of-hooks
  4:10  warning  Using `<img>` could result in slower LCP ...          @next/next/no-img-element   (solo shop; en admin está off)
  4:10  warning  img elements must have an alt prop ...                jsx-a11y/alt-text
```

**Aviso:** npm marca `eslint@9.39.5` como «This version is no longer
supported». La 9 ya pasó su fin de soporte tras salir la 10. Es una versión
puente: US-82 debería pasar a ESLint 10 junto con `eslint-config-next` 16.

### DA-2 — Prettier 3 con reformateo en commit aparte (opción a) ✅

Commit `3096528`, solo formato. Alcance: lo mismo que formatea el hook
(shop y admin: `**/*.{ts,tsx,js,jsx,json,css}`; API: `**/*.ts`), con el
`prettier.config.js` / `.prettierrc` y el `.prettierignore` de cada app.

Línea base (antes de tocar nada): el shop y el admin **no estaban en 0 ni con
la 2.4.0** (225 y 221 archivos con diferencias con
`prettier --list-different "src/**/*"`; con la 3.3.3 local, 248 y 272). La API
sí estaba en 0 con la 2.8.8. Por eso el commit de formato es grande en el
frontend: arregla la deuda que ya había y aplica `trailingComma: "all"`.

**Verificación de que el diff es solo formato:** comparé, archivo por
archivo, el AST de `HEAD` con el del árbol de trabajo. Usé typescript-estree
para TS/JS, postcss para CSS y `JSON.parse` para JSON, sin posiciones ni
`raw`. Descarté los nodos `JSXText` de solo espacios con salto de línea (React
los ignora), los `;` sueltos y el tipo de comillas en CSS:

```
$ git diff -w --shortstat
 483 files changed, 2696 insertions(+), 2280 deletions(-)
$ node astcmp.js
archivos: 540  AST idéntico: 539  distintos: 1
  apps/shop/src/components/checkout/item/verified-item-list.tsx
```

En ese archivo, Prettier convierte tres espacios JSX entre `{t(...)}` y un
`<span>` en `{' '}` (por ejemplo, `{t('text-shipping')} <span` →
`{t('text-shipping')}{' '}` + salto de línea + `<span`). React renderiza lo
mismo. No hay cambios de código.

Lo que **no** cambia: `prettier-plugin-tailwindcss` 0.5.6 (shop y admin)
sigue sin usarse. Prettier 3 no carga plugins solos y ningún
`prettier.config.js` lo declara; con la 2.4.0 tampoco se cargaba, porque no
estaba en `apps/node_modules`. Activarlo reordenaría clases de Tailwind, y eso
no es formato neutro. La opción `tailwindConfig` del shop sigue dando el aviso
`Ignored unknown option`, como antes.

### CA-1 — Mismas reglas ✅

`eslint --print-config` antes (eslint 8, `.eslintrc`) y después (eslint 9,
`eslint.config.mjs`). Archivos: `apps/shop/src/pages/_app.tsx`,
`apps/admin/rest/src/pages/index.tsx` y
`apps/api/rest/src/products/products.service.ts`. Comparé la severidad y las
opciones de cada regla activa:

```
===== shop
activas antes=46 despues=46
(sin diferencias)
===== admin
activas antes=45 despues=45
(sin diferencias)
===== api (con la paridad ya fijada en eslint.config.mjs)
activas antes=25 despues=26
SEV  @typescript-eslint/ban-types: 2 -> -
OPTS @typescript-eslint/no-empty-function: [] -> [{"allow":[]}]
SEV  @typescript-eslint/no-empty-interface: 2 -> -
SEV  @typescript-eslint/no-empty-object-type: - -> 2
SEV  @typescript-eslint/no-loss-of-precision: 2 -> -
SEV  @typescript-eslint/no-require-imports: - -> 2
SEV  @typescript-eslint/no-unsafe-function-type: - -> 2
SEV  @typescript-eslint/no-var-requires: 2 -> -
SEV  @typescript-eslint/no-wrapper-object-types: - -> 2
SEV  no-loss-of-precision: 0 -> 2
OPTS prefer-const: [] -> [{"destructuring":"any","ignoreReadBeforeAssign":false}]
```

En el shop y el admin, el parser (`@typescript-eslint/parser` para `.tsx`),
los plugins (`react`, `react-hooks`, `@next/next`, `import`, `jsx-a11y`) y los
`settings` de `import`/`react` son los mismos. Los globals de `browser` y
`node` llegan por FlatCompat.

La API sin ajustes daba 15 diferencias, por el `recommended` de
typescript-eslint 5 → 8. Criterio aplicado, una por una:

| Regla | Qué pasó en la v8 | Tratamiento |
|---|---|---|
| `adjacent-overload-signatures` (error), `no-empty-function` (error), `no-inferrable-types` (error), `no-non-null-assertion` (warn) | Salen del `recommended` (pasan a `stylistic`/`strict`), pero existen | Se restauran con su severidad en `eslint.config.mjs` |
| `ban-types` | Eliminada; la sustituyen `no-empty-object-type`, `no-unsafe-function-type` y `no-wrapper-object-types` | Sucesores oficiales (activos en el `recommended` 8) |
| `no-empty-interface` | Deprecada; la absorbe `no-empty-object-type` | Sucesor oficial |
| `no-var-requires` | Deprecada; la sustituye `no-require-imports` | Sucesor oficial |
| `@typescript-eslint/no-loss-of-precision` | Eliminada: la regla del núcleo ya cubre lo mismo | `no-loss-of-precision` del núcleo, en `error` |
| `no-duplicate-enum-values`, `no-unsafe-declaration-merging`, `no-unused-expressions` | Entraron al `recommended` en la 8 | `off`: activarlas es endurecer (fuera de scope) |
| `no-empty-function`, `prefer-const` (OPTS) | La v9 imprime explícitas las opciones por defecto | Misma semántica |

### CA-2 — Lint en 0 ✅

`next lint` de Next 14.2 no reconoce `eslint.config.mjs`: abre el asistente
de configuración y sale con 1. Se aplicó R-3:

```
$ yarn lint      # shop, con el script todavía en `next lint`
$ next lint
? How would you like to configure ESLint? https://nextjs.org/docs/basic-features/eslint
❯  Strict (recommended)
error Command failed with exit code 1.
```

El script `lint` del shop y del admin pasa a `eslint src`. Es el mismo
conjunto de archivos que lintaba `next lint`: su lista por defecto es `app`,
`pages`, `components`, `lib` y `src`, y en las dos apps solo existe `src/`. El
shop lintó 764 archivos (606 `.tsx`, 158 `.ts`) y el admin 1011 (830 `.tsx`,
181 `.ts`), exactamente los `.ts/.tsx/.js/.jsx` de `src/` menos los ignorados.
La invocación de la DoD (`cd apps/shop && yarn lint`) **no cambia**, así que
`lint_commands` y el paso 5 de `docs/product/README.md` quedan como estaban.
Solo se actualizaron comentarios de `openspec/config.yaml`.

ESLint 9 activa por defecto `reportUnusedDisableDirectives: "warn"` (en la 8
venía apagado). Daba 4 avisos en el shop y 1 en el admin, por directivas
`eslint-disable` que ya no hacen falta. Para no sumar hallazgos ni tocar
código, el `eslint.config.mjs` de esas dos apps lo pone en `off` (limpiarlas
es otra US).

Después del commit de formato:

```
$ cd apps/api/rest && npx eslint "{src,apps,libs,test}/**/*.ts"; echo "api eslint exit $?"
api eslint exit 0
$ cd apps/shop && yarn lint
$ eslint src
Done in 99.48s.
$ cd apps/admin/rest && yarn lint
$ eslint src
Done in 17.07s.
$ prettier --check (las tres apps, mismo alcance que el hook)
All matched files use Prettier code style!   (x3)
```

Antes del commit de formato, el lint de la API daba 1 error
`prettier/prettier` (`withdraws.service.spec.ts:209`, formato de Prettier 3),
que es justo lo que arregla `3096528`.

Resto de gates tras el reformateo; dan lo mismo que la línea base:

```
$ cd apps/api/rest && npx vitest run
 Test Files  34 passed (34)
      Tests  565 passed (565)
$ npx tsc --noEmit -p tsconfig.json; echo "tsc-api exit $?"
tsc-api exit 0
$ cd apps/shop && ./node_modules/.bin/tsc --noEmit | grep "error TS" | ... | uniq -c
      9 TS2786
$ cd apps/admin/rest && ../../node_modules/.bin/tsc --noEmit --types node,google.maps | grep "error TS"
src/components/ui/back-to-top/back-to-top.tsx(41,10): error TS2322: ...   (era la línea 42: el reformateo quitó una)
src/components/ui/date-picker.tsx(75,14): error TS2786: 'DatePicker' cannot be used as a JSX component.
$ just build-api
$ nest build
Done in 110.47s.
$ just verify
OK   API    :9001/api/settings  200  5503B  689ms
OK   Shop   :3003/en  200  190927B  926ms  cards:30
OK   Admin  :3002/en/login  200  72736B  14708ms  cards:1
```

Son los mismos bytes y las mismas tarjetas que el cierre de US-85.

### CA-3 — El hook sigue formateando ✅

Con Prettier 3 el hook dejaba de formatear **en silencio**, porque no
encontraba `bin-prettier.js` y salía sin hacer nada. Ajuste mínimo en
`9c8520f`: el binario pasa a `bin/prettier.cjs` (en los dos destinos) y
`--loglevel` pasa a `--log-level`. No hizo falta nada más: el hook invoca el
CLI, no la API async de Prettier.

Prueba: escribí (Write) el mismo archivo mal formateado,
`src/zz-hook-probe.ts`, en cada app:

```
export function probe(primerArgumentoLargo:number,segundoArgumentoLargo:number,tercero:string){return {a:"x",b:[primerArgumentoLargo,segundoArgumentoLargo],c:tercero}}
```

El hook respondió «El hook de formato reescribió apps/shop/src/zz-hook-probe.ts
con prettier (508 ms)» (admin 435 ms, API 664 ms), y el resultado fue el mismo
en las tres:

```
export function probe(
  primerArgumentoLargo: number,
  segundoArgumentoLargo: number,
  tercero: string,
) {
  return {
    a: 'x',
    b: [primerArgumentoLargo, segundoArgumentoLargo],
    c: tercero,
  };
}
```

La coma tras `tercero: string` es `trailingComma: "all"` de Prettier 3: en el
shop y el admin, la 2.4.0 no la ponía. `prettier --check` sobre los tres
archivos: «All matched files use Prettier code style!». Después borré los
tres archivos (`git status` limpio).

### Desvíos

- **`lint-staged.config.js` del shop**: invocaba `next lint --fix --file …`
  y pasa a `eslint --fix …`. Está inactivo (el `pre-commit` de `.husky` tiene
  `npx lint-staged` comentado y no hay `core.hooksPath`), pero así no queda
  roto.
- **API ya levantada**: el puerto 9001 lo ocupaba, desde antes de esta
  sesión, una API (`node … apps/api/rest/dist/main`, PID 32992) que no
  levanté yo, así que no la cerré. `just verify` usó esa instancia; el diff
  de la rama no toca código de runtime de la API (solo un `.spec.ts`
  reformateado y dependencias de lint). Los puertos 3002 y 3003 quedaron
  libres al cerrar el shop y el admin.

### Fuera de scope (siguen, no se tocaron)

- Endurecer reglas: `no-explicit-any`, `exhaustive-deps`, las tres reglas
  nuevas del `recommended` 8 que quedaron en `off`, y
  `reportUnusedDisableDirectives` (5 directivas sin uso entre shop y admin).
- `prettier-plugin-tailwindcss`: declarado y sin usar (ver DA-2).
- `apps/admin/graphql`: sigue en ESLint 8.
- Para US-82: pasar a `eslint-config-next` 16 con su export flat nativo
  (`eslint-config-next/core-web-vitals` o el `index`; quitar `FlatCompat` y
  `@eslint/eslintrc`) y subir a ESLint 10, que la 16 admite (`>=9.0.0`). La 9
  está fuera de soporte. Hay que repetir el CA-1 de esta US contra la
  config nueva.
