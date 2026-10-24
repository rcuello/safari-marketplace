# Épico 75 — Actualización de dependencias

> El monorepo corre sobre versiones sin soporte: Next 13.5 en el shop y el
> admin, y NestJS 9 en la API. Este épico las lleva a versiones vigentes por
> tandas, de menor a mayor riesgo. Cada salto mayor va en su propia US, con su
> verificación, para que una regresión apunte a un solo cambio y se revierta
> sola.

**Fecha:** 2026-10-24
**Status:** Refinado. DA-1..DA-6 tienen una propuesta por defecto que el
dueño todavía no confirmó.

## Contexto — verificado (2026-10-24)

Medido con `yarn outdated` (en `apps/` y en `apps/api/rest`), `npm outdated`
(en `packages/db`) y `pip list --outdated` (en el venv del scraper), más
`npm view <paquete> engines peerDependencies` para los requisitos de cada
salto.

| Proyecto | Desactualizados | Con salto mayor | Lo más grave |
|---|---|---|---|
| `apps/` (workspace yarn: shop, admin/rest, admin/graphql) | 211 | 132 | `next` 13.5.6, cuando la última es la 16.4.3 |
| `apps/api/rest` (yarn propio) | 35 | 30 | `@nestjs/*` 9.4.3, cuando la última es la 12.2.0; `typescript` 4.9.5 |
| `packages/db` (npm) | 8 | 5 | Nada grave: Prisma 7.10.0 → 7.10.1 |
| `services/scraper-worker` (pip) | 26 | 2 (`filelock`, `pyee`, ambas transitivas) | Nada grave: todo son versiones menores |

**Las versiones clave hoy:**

| Paquete | Instalado | Última | Línea intermedia |
|---|---|---|---|
| next (shop, admin/rest) | 13.5.6 | 16.4.3 | 14.2.35, 15.5.28 |
| react / react-dom | 18.2.0 (fijado por `resolutions`, ver D-3) | 19.3.1 | — |
| @nestjs/core, common, platform-express, testing | 9.4.3 | 12.2.0 | 10.4.22, 11.2.8 |
| typescript (API) | 4.9.5 | 7.0.2 | 5.9.3, 6.0.3 |
| typescript (shop, admin) | 5.2.2 | 7.0.2 | 5.9.3, 6.0.3 |
| eslint (las tres apps) | 8.53 / 8.57 | 10.13.0 | — |
| react-query | 3.39.3 (sin versiones nuevas) | sucesor: `@tanstack/react-query` 5.104.5 | — |
| tailwindcss | 3.4.14 | 4.3.3 | — |
| stripe (API) | 11.18.0 | 23.0.1 | — |
| @stripe/stripe-js / react-stripe-js (shop) | 2.1.11 / 2.8.1 | 10.1.0 / 7.0.0 | — |
| prisma (packages/db) | 7.10.0 | 7.10.1 (`latest` apunta a 8.0.0-rc.27) | — |

**Lo que piden los saltos** (`npm view`, 2026-10-24):

- **Next 14.2.35:** `react ^18.2.0` y Node 18.17 o superior.
- **Next 15.5 y 16.4:** aceptan `react ^18.2.0 || ^19.0.0`. El Pages Router
  sigue funcionando con React 18, así que React 19 es un paso aparte (D-2).
  Next 16 pide Node 20.9 o superior.
- **`eslint-config-next` 16:** pide `eslint >=9`. Por eso el salto a Next 16
  depende de migrar el lint a flat config (US-81).
- **NestJS 11 y 12:** piden Node 20 o superior. Nest 11 llega con
  `@nestjs/platform-express` sobre Express 5, que cambia la sintaxis de las
  rutas con comodín. **Hoy la API no tiene ninguna** (`grep` de
  `@Get('…*…')` y similares sobre `apps/api/rest/src`: 0 resultados).
- **next-i18next 16:** pide `next >= 14.1` y Node 20 o superior.
- **react-i18next 17:** pide `i18next >= 26.2`.
- **next-auth 4.24.15:** acepta `next` 12 a 16 y `react` 17 a 19. La v5 no
  tiene versión estable (`next: 4.0.0-next.26`), así que se queda en la v4.

**El entorno:** Node 22.14.0 y Python 3.13.5. Los dos cumplen todo lo de
arriba.

**Superficie que tocan las migraciones de API de librería** (`grep`,
2026-10-24):

| Librería | shop | admin/rest | API |
|---|---|---|---|
| `react-query` (archivos que la importan / llamadas a `useQuery`, `useInfiniteQuery` o `useMutation`) | 42 / 44 | 38 / 119 | — |
| `@stripe/*` (archivos) | 8 | 0 | `src/payment/stripe-payment.service.ts` (lee JSON, sin controlador) |
| `next-i18next` / `react-i18next` (archivos) | 271 | 416 | — |
| `tailwind.config.js` con plugins | `typography`, `forms` | `typography`, `forms`, `tailwindcss-rtl` | — |

**Líneas base de verificación** (de las US anteriores):

| Gate | Cifra hoy |
|---|---|
| `cd apps/api/rest && npx jest` | 34 suites / 565 tests |
| `just db-check` | 32 archivos / 412 tests |
| Lint de la API sin escribir (`npx eslint "{src,apps,libs,test}/**/*.ts"`) | 0 problemas |
| `cd packages/db && npm run lint` | 0 problemas |
| `tsc --noEmit` del shop | 9 errores TS2786 heredados |

## Subdivisión en sub-historias

| US | Título | Releasable solo | Depende de | LOC est. |
|----|--------|-----------------|------------|----------|
| [US-76](./76-parches-menores-dependencias.md) | Parches y versiones menores (db, scraper, axios, next-auth) | Sí | ninguna | ~30 (manifiestos y lockfiles) |
| [US-77](./77-nestjs-9-a-10.md) | NestJS 9 → 10 y TypeScript 5 en la API | Sí | ninguna | ~150 |
| [US-78](./78-nestjs-10-a-11.md) | NestJS 10 → 11 (Express 5) | Sí | US-77 | ~150 |
| [US-79](./79-nestjs-11-a-12.md) | NestJS 11 → 12 | Sí | US-78, DA-2 | ~100 |
| [US-80](./80-next-13-a-14.md) | Next 13.5 → 14.2 en shop y admin, con React 18 | Sí | ninguna | ~150 |
| [US-81](./81-eslint-9-flat-config.md) | ESLint 9 con flat config y Prettier 3 en las tres apps | Sí | US-80, US-77 | ~250 |
| [US-82](./82-next-14-a-16.md) | Next 14.2 → 16 en shop y admin, con React 18 | Sí | US-80, US-81 | ~250 |
| [US-83](./83-react-19.md) | React 19 en shop y admin | Sí | US-82 | ~200 |
| [US-84](./84-tanstack-query-shop.md) | react-query 3 → @tanstack/react-query 5 en el shop | Sí | US-80 | ~300 |
| [US-85](./85-tanstack-query-admin.md) | react-query 3 → @tanstack/react-query 5 en el admin | Sí | US-84 | ~450 |
| [US-86](./86-tailwind-4.md) | Tailwind 3 → 4 en shop y admin | Sí | US-82 | ~300 |
| [US-87](./87-stripe-sdks.md) | SDKs de Stripe (servidor y cliente) | Sí | US-78, US-83 | ~150 |

```
Tanda 1 (riesgo bajo)    US-76
Tanda 2 (API)            US-77 → US-78 → US-79
Tanda 3 (frontend base)  US-80 → US-81 → US-82 → US-83
Tanda 4 (librerías)      US-84 → US-85 · US-86 · US-87
```

**Orden recomendado:** US-76 primero. Después, la API (US-77 → US-79) y el
frontend (US-80 → US-83) pueden ir **en paralelo**, porque tienen lockfiles
distintos (`apps/api/rest/yarn.lock` y `apps/yarn.lock`). La excepción es
US-81, que toca el `.eslintrc.js` de la API: va después de US-77 y nunca a la
vez que US-78 o US-79. La tanda 4 va al final, cuando el framework ya está en
la versión de destino.

## Decisiones abiertas para el dueño

| # | Tema | Opciones | Propuesta por defecto |
|---|---|---|---|
| DA-1 | Destino de Next | **(a)** 14.2 y después 16, en dos US. **(b)** Directo a 16. **(c)** Quedarse en 14.2 | **(a)**. Pasar por la 14.2 nos saca primero de una versión sin soporte con el cambio mínimo, y la US de Next 16 parte de una base ya verificada |
| DA-2 | Destino de NestJS | **(a)** 10 → 11 → 12, en tres US. **(b)** Parar en 11 y dejar la 12 en el backlog | **(a)**. Ir de una mayor en una mayor, como piden las guías de migración de Nest. La 12 salió el 2026-08-27; si en US-79 su guía muestra algo que no queremos adoptar, la US se archiva y nos quedamos en la 11 |
| DA-3 | TypeScript | **(a)** El último 5.x (5.9.3) en la API, el shop y el admin. **(b)** TypeScript 6. **(c)** TypeScript 7 (el compilador nuevo) | **(a)**. Las otras dos opciones van en una US aparte cuando `ts-jest`, `typescript-eslint` y Next las declaren compatibles |
| DA-4 | Variantes GraphQL (`apps/admin/graphql`, `apps/api/graphql`) | **(a)** Fuera de este épico; lo decide US-12. **(b)** Actualizarlas junto con las REST | **(a)**. Ojo: `admin/graphql` está en el mismo workspace y los `resolutions` de React le aplican también (R-2) |
| DA-5 | Prisma 8 | **(a)** Fuera hasta que salga estable; US-76 solo sube a 7.10.1. **(b)** Adoptar la RC | **(a)**. `latest` apunta a una RC (`8.0.0-rc.27`) y `just db-build` no tiene por qué cargar con eso |
| DA-6 | Node | **(a)** Exigir Node 20.9 o superior en `just doctor` cuando llegue la primera US que lo pida (US-78 o US-82). **(b)** No tocar `doctor` | **(a)**. Hoy todos usan 22.14, pero un estudiante con Node 18 se enteraría por un error de `engines` y no por el `doctor` |

## Visión técnica compartida

### Decisiones de Diseño (D-N)

- **D-1 — Una mayor por US.** Ninguna US sube dos mayores del mismo
  framework a la vez ni mezcla framework y librería. Si al subir una
  dependencia hace falta otra, va en la misma US solo si es su peer
  obligatorio (por ejemplo, `@nestjs/swagger` con `@nestjs/core`).
- **D-2 — React 19 se separa de Next.** Next 14.2 a 16 aceptan React 18, así
  que el framework se mueve primero y React después (US-83). Así una
  regresión de hidratación o de `ref` no se confunde con una del framework.
- **D-3 — El pin de React 18.2.0 es temporal.** `apps/package.json` fija
  `react` y `react-dom` en 18.2.0 con `resolutions` (commit `f62ded2`) para
  callar el aviso de `fetchPriority` de Next 13.5 con React 18.3. US-80 ya
  puede probar React 18.3 con Next 14.2; US-83 quita el pin o lo cambia a la
  19.
- **D-4 — Primero se mide, después se cambia.** Cada US arranca con una
  línea base de su paquete (tests, lint, build, `just verify`, consola del
  navegador en las rutas de humo) y la DoD compara el después con esa misma
  línea base. Un número que baja o un aviso nuevo es un hallazgo, no ruido.
- **D-5 — Los contratos HTTP no cambian.** Subir Nest o Express no puede
  cambiar el cuerpo ni los códigos de ninguna ruta. La prueba es la batería
  de jest más `just verify`. Si la guía de una mayor anuncia un cambio
  visible (por ejemplo, del parser de query strings), la US lo mide con
  `curl` antes y después.
- **D-6 — Nada de `--force` ni `--legacy-peer-deps` para salir del paso.** Un
  conflicto de peers se resuelve subiendo el paquete que lo provoca, o se
  documenta y se pregunta al dueño.

### Riesgos (R-N)

- **R-1 — El workspace es compartido.** Shop, admin/rest y admin/graphql
  comparten `apps/node_modules`. Subir algo para el shop puede mover también
  al admin: cada US del frontend verifica **las dos** apps.
- **R-2 — admin/graphql viaja de polizón.** Los `resolutions` de React le
  aplican aunque esté fuera del épico (DA-4). Cada US del frontend comprueba
  que `yarn install` termina sin errores; no hace falta que admin/graphql
  compile.
- **R-3 — `next lint` desaparece.** Según las notas de versión de Next 16,
  el comando `next lint` se retira, y `eslint-config-next` 16 pide ESLint 9.
  Por eso US-81 va antes de US-82. La receta `check` de US-10 tiene que
  invocar `eslint` directamente.
- **R-4 — `images.domains` está obsoleto.** Los dos `next.config.js` lo usan.
  Next lo marca como obsoleto a favor de `images.remotePatterns`; US-82 hace
  la conversión si la 16 lo exige o avisa.
- **R-5 — `tailwindcss-rtl` y Tailwind 4.** El admin usa ese plugin.
  Tailwind 4 trae variantes `rtl:`/`ltr:` propias y cambia cómo se cargan los
  plugins. US-86 tiene que medir qué clases del plugin se usan antes de
  decidir cómo sustituirlo.
- **R-6 — Las cifras de este README caducan.** Son del 2026-10-24. Cada US
  vuelve a correr `yarn outdated` o `npm view` para su paquete y fija la
  versión exacta que adopta.
- **R-7 — US-74 puede llegar antes que US-81.** Si US-74 escribe sus reglas
  `no-restricted-imports` en los `.eslintrc` legacy, US-81 tiene que
  migrarlas a flat config sin perder ninguna.

## Notas globales para los agentes

- **Rutas de humo del frontend** (con la API arriba): `/`, `/shops`,
  `/shops/<slug>`, `/products/<slug>`, el carrito, `/checkout` hasta el
  formulario y el login. En el admin: el login y `/` (dashboard), más
  `/products` y `/orders`. Se recorren en el navegador con la consola
  abierta, y la DoD pega los mensajes de consola antes y después.
- **Versión exacta en el manifiesto.** El repo fija versiones exactas en el
  frontend (`"next": "13.5.6"`) y rangos `^` en la API. Cada US respeta el
  estilo del manifiesto que toca.
- **`just build` exige la API arriba** (ver `CLAUDE.md`): la tienda
  prerenderiza por HTTP.
- **Lint sin escribir:** en la API, nunca `yarn lint`, porque lleva `--fix`
  (ver el protocolo en `docs/product/README.md`).
- **Un commit por paso lógico:** primero la subida (manifiesto y lockfile),
  después los ajustes de código que exige. Nunca un refactor oportunista en
  el mismo commit.
- **Lo que no se puede subir se documenta.** Si un paquete no tiene versión
  compatible con el destino, la US lo anota con la evidencia (`npm view …
  peerDependencies`) y sigue sin él, o se detiene y pregunta si bloquea.
