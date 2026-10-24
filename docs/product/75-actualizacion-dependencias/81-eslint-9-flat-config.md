# US-81 — ESLint 9 con flat config y Prettier 3 en las tres apps

> Migra el lint del shop, del admin y de la API de ESLint 8 (`.eslintrc`) a
> ESLint 9 con `eslint.config.mjs`, y sube Prettier a la 3. Es requisito de
> Next 16: `eslint-config-next` 16 pide `eslint >=9`.

**Épico:** [Épico 75](./README.md)
**Fecha:** 2026-10-24
**Status:** Listo para ejecución
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

- [ ] DA-1 y DA-2 confirmadas y anotadas.
- [ ] CA-1: el diff de `--print-config`, pegado.
- [ ] CA-2 y CA-3 con la salida pegada.
- [ ] El reformateo de Prettier 3, si lo hay, en su propio commit.
- [ ] Status actualizado aquí y en la tabla del épico.

## Notas para el agente ejecutor

- `next lint` con flat config en Next 14.2 puede no funcionar. Si es así,
  el script pasa a `eslint .` y la US lo anota (R-3 del épico).
