# US-74 — Fronteras de arquitectura como reglas de lint

> `CLAUDE.md` describe una arquitectura en capas: los frontends hablan con la
> API por HTTP, la API llega a Postgres solo a través de `@safari/db` y solo
> `packages/db` conoce Prisma. Hoy esas reglas se cumplen, pero nada las
> vigila: un `import` equivocado pasaría la revisión sin que nadie lo note.
> Esta US las convierte en `no-restricted-imports` dentro de los `.eslintrc`
> que ya existen, con un mensaje que cita `CLAUDE.md`, sin migrar a flat
> config.

**Épico:** [Épico 9](./README.md)
**Fecha:** 2026-10-24
**Status:** Listo para ejecución — con propuesta por defecto en DA-1..DA-3;
el ejecutor las confirma con el dueño.
**Depende de:** US-10. Las reglas tienen que correr en `just check`; sin el
gate son una sugerencia más del editor.
**LOC est.:** ~80 (tres `.eslintrc` y su documentación)

## Historia

**Como** estudiante o agente que toca el monorepo, **quiero** que el lint me
avise si importo algo que rompe las capas, **para** enterarme al escribir el
`import` y no en una revisión.

## Contexto — verificado (2026-10-24)

**Las reglas de `CLAUDE.md` que se pueden vigilar con lint:**

- «`packages/db` … Cliente singleton + repositorios de funciones planas por
  agregado» y «se construye con tsup a dist/ para que Nest lo consuma vía
  `link:`». La API depende de `"@safari/db": "link:../../../packages/db"`
  (`apps/api/rest/package.json:32`).
- «La API publica snake_case …; la capa de datos devuelve camelCase; la
  traducción vive en los servicios de Nest». Implica que los servicios
  consumen los repositorios de `@safari/db`, no Prisma directo.
- Los frontends (`apps/shop`, `apps/admin/rest`) consumen la API por HTTP
  (`NEXT_PUBLIC_REST_API_ENDPOINT`).

**Estado actual de los imports** (`grep`, 2026-10-24):

| Frontera | Hoy |
|---|---|
| `apps/shop/src` y `apps/admin/rest/src` no importan `@safari/db`, `@prisma/*` ni nada de `packages/db` | **0** violaciones |
| `apps/api/rest/src` no importa `@prisma/*` ni `generated/prisma` | **0** violaciones; 74 archivos importan `@safari/db` |
| `apps/api/rest/src` no añade importaciones del mock JSON de Pickbazar (`@db/*` o `src/db/pickbazar/*`) | **12** importaciones en 7 archivos de producción, más 1 en un spec (`become-seller.service.spec.ts:34`) |

Los 7 archivos que hoy importan el mock son:

- `authors/authors.service.ts`;
- `flash-sale/flash-sale.service.ts`;
- `orders/orders.service.ts`;
- `payment/stripe-payment.service.ts`;
- `payment-intent/payment-intent.controller.ts`;
- `payment-intent/payment-intent.service.ts`;
- `payment-method/payment-method.service.ts`.

Son los mocks permanentes que dejó el Épico 46.

**Ojo con el nombre:** en la API, `@db/*` **no** es `packages/db`. Es el
alias del mock JSON: `apps/api/rest/tsconfig.json:16`
(`"@db/*": ["./src/db/pickbazar/*"]`) y el `moduleNameMapper` de jest en
`apps/api/rest/package.json:78-81`. La regla tiene que explicarlo en su
mensaje.

**La configuración de lint actual:**

| App | Archivo | ESLint | Base |
|---|---|---|---|
| shop | `apps/shop/.eslintrc.json` | 8.53.0 (`package.json:103`) | `next` + `prettier`, `exhaustive-deps: 0` |
| admin/rest | `apps/admin/rest/.eslintrc.json` | 8.53.0 (`package.json:81`) | `next` + `prettier`, `exhaustive-deps: 0`, `no-img-element: off` |
| api/rest | `apps/api/rest/.eslintrc.js` | ^8.22.0 (`package.json:58`) | `@typescript-eslint/recommended` + `prettier/recommended`, `no-explicit-any: off` |

`eslint-config-next` es la 14.0.1 en el shop y en el admin. Las tres usan el
formato legacy (`.eslintrc`), y `no-restricted-imports` funciona igual en
ese formato: no hace falta migrar a flat config.

**El patrón de bingo-flow** (`eslint.config.mjs`):

- Fronteras con `no-restricted-imports` por paquete, con un mensaje que cita
  la regla de `CLAUDE.md` (`:268-290`, por ejemplo «CLAUDE.md: «game-engine
  es puro: sin I/O»…»).
- Línea base (`:175-185`): una regla con hallazgos va en `warn` con su
  cuenta y su fecha hasta la US que la corrija, y una regla limpia va en
  `error`, para que no empiece a fallar sin que se note.
- `reportUnusedDisableDirectives: "error"` (`:40-42`).

**Directivas `eslint-disable` hoy:** 5 en `apps/shop/src`, 1 en
`apps/admin/rest/src` y 0 en `apps/api/rest/src`.

## Decisiones abiertas para el dueño

> **Confirmadas por el dueño (2026-10-24):** DA-1..DA-3 en su propuesta por defecto.

| # | Tema | Opciones | Propuesta por defecto |
|---|---|---|---|
| DA-1 | Frontera del mock JSON en la API (12 importaciones vigentes) | **(a)** `error` para todo `src/`, con un `overrides` que exceptúa los 7 archivos actuales con un comentario fechado: no puede aparecer un octavo. **(b)** `warn` con la cuenta (12) y la fecha, como el patrón de bingo. **(c)** Fuera de esta US | **(a)**. Es un trinquete: el número solo puede bajar. Con (b) un warn nuevo entre 12 no se ve |
| DA-2 | `--report-unused-disable-directives` | **(a)** Activarlo en las tres apps, sabiendo que hoy hay 6 directivas (5 en el shop y 1 en el admin) que pueden salir como no usadas. **(b)** Dejarlo para la US de endurecimiento del lint | **(a)**, si las directivas no usadas son 0 o triviales de quitar; si no, **(b)**. Se decide con la salida real |
| DA-3 | Dónde vive la regla común de los frontends | **(a)** Duplicarla en los dos `.eslintrc.json` (son dos archivos de 6 y 10 líneas). **(b)** Un `.eslintrc` compartido con `extends` relativo | **(a)**. Dos copias no justifican una abstracción, y un `extends` entre apps complica el `root: true` y el `next lint` de cada una |

## Scope

**Incluye:**

- **B-1**, en `apps/shop/.eslintrc.json` y `apps/admin/rest/.eslintrc.json`:
  `no-restricted-imports` en `error` para `@safari/db`, `@prisma/*` y
  cualquier ruta a `packages/db`, con el mensaje «CLAUDE.md: los frontends
  consumen la API por HTTP (`NEXT_PUBLIC_REST_API_ENDPOINT`); la capa de
  datos es de la API»;
- **B-2**, en `apps/api/rest/.eslintrc.js`: `error` para `@prisma/*` y
  `**/generated/prisma/**`, con el mensaje «CLAUDE.md: la API llega a
  Postgres solo por `@safari/db`; Prisma es un detalle de `packages/db`»;
- **B-3**, en `apps/api/rest/.eslintrc.js`: la frontera del mock según DA-1,
  con el mensaje «`@db/*` es el mock JSON de Pickbazar
  (`tsconfig.json:16`), no `packages/db`; el Épico 46 lo retiró salvo en los
  mocks permanentes»;
- DA-2, según la decisión;
- una nota en el `README.md` del Épico 9 y en el comentario de la receta
  `check` (US-10) que diga que el lint vigila estas fronteras.

**NO incluye:**

- migrar a flat config o subir a ESLint 9/10: es un refactor de herramientas
  de tres apps más la variante GraphQL;
- endurecer reglas existentes (`no-explicit-any` en la API,
  `exhaustive-deps` en el frontend): cada una es una US con su línea base;
- arreglar los 20 203 `prettier/prettier: Delete ␍` de la API, que son del
  fin de línea (ver la actualización de US-10 y la DA-2 de US-72);
- `knip` (código muerto) y `madge` (ciclos de imports): candidatas
  posteriores en modo reporte; en una base heredada dan cientos de falsos
  positivos al principio;
- las variantes GraphQL (US-12).

## Criterios de aceptación

### CA-1 — Las fronteras se cumplen hoy

`yarn lint` del shop, `yarn lint` del admin y el lint de la API (sin
`--fix`, ver US-10) no dan ningún hallazgo **nuevo** de
`no-restricted-imports` sobre el código actual. Con DA-1 (a), los 7
archivos del mock quedan exceptuados de forma explícita.

### CA-2 — Una violación se detecta

Con cada una de estas inyecciones temporales, el lint de su app sale
distinto de 0 y muestra el mensaje que cita `CLAUDE.md`:

| Inyección | App |
|---|---|
| `import { prisma } from '@safari/db';` en un componente del shop | shop |
| `import { PrismaClient } from '@prisma/client';` en un servicio de la API | api |
| `import x from '@db/coupons.json';` en un servicio de la API fuera de los 7 | api (B-3) |

Cada inyección se revierte; para eso, usar el `mutate.mjs` que propone
US-10.

### CA-3 — Directivas sin uso (si DA-2 = a)

El lint de cada app informa las directivas `eslint-disable` que no silencian
nada. Las que salgan se quitan o se justifican en la propia línea.

## Escenarios Gherkin

```gherkin
Feature: Fronteras de arquitectura en el lint
  Scenario: CA-2 — un frontend importa la capa de datos
    Given la regla B-1 en apps/shop/.eslintrc.json
    When un componente del shop importa @safari/db
    Then yarn lint falla con un mensaje que cita CLAUDE.md

  Scenario: CA-2 — la API importa Prisma directo
    Given la regla B-2 en apps/api/rest/.eslintrc.js
    When un servicio importa @prisma/client
    Then el lint de la API falla y pide usar @safari/db
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `apps/shop/.eslintrc.json` | B-1 |
| `apps/admin/rest/.eslintrc.json` | B-1 |
| `apps/api/rest/.eslintrc.js` | B-2, B-3 |
| `docs/product/9-gate-calidad-ci/README.md` | nota de las fronteras |

## Definición de Done

- [ ] DA-1..DA-3 confirmadas por el dueño y anotadas aquí.
- [ ] Línea base antes del cambio: la salida de los tres lint (conteos).
- [ ] CA-1: los tres lint después, sin hallazgos nuevos de
  `no-restricted-imports`.
- [ ] CA-2: las tres inyecciones con su salida y su revert pegados.
- [ ] CA-3 si aplica.
- [ ] `just check` (US-10) en verde con las reglas dentro.
- [ ] Status actualizado aquí, en la tabla del épico y en el mapa.

## Notas para el agente ejecutor

- **`next lint` lee el `.eslintrc.json` de cada app;** no hace falta tocar
  `next.config.js`. Comprueba que `next lint` admite
  `--report-unused-disable-directives` en Next 13.5 antes de contar con él;
  si no, pásalo con `eslint` directo o con `reportUnusedDisableDirectives:
  true` en el propio `.eslintrc`.
- **`patterns` con `group`** cubre los comodines (`@prisma/*`,
  `**/packages/db/**`); `paths` no los admite. En ESLint 8, el formato es
  `{ "patterns": [{ "group": [...], "message": "..." }] }`.
- **El lint de la API sin `--fix`** hoy da 21 175 problemas, casi todos por
  CRLF. Para medir CA-1 filtra por `ruleId === "no-restricted-imports"`
  (`npx eslint ... -f json`), no por el total.
- **No mezcles refactor y regla:** si una frontera saliera violada al
  escribirla, la violación va a la línea base de DA-1 o al reporte, no se
  corrige en esta US.
