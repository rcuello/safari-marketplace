# US-76 — Parches y versiones menores (db, scraper, axios, next-auth)

> Sube todo lo que se puede subir sin cambiar ninguna versión mayor:
> `packages/db` dentro de Prisma 7, el scraper dentro de sus rangos,
> `axios` y `next-auth` 4.24.15. Es la tanda de menor riesgo y deja la línea
> base limpia para el resto del épico.

**Épico:** [Épico 75](./README.md)
**Fecha:** 2026-10-24
**Status:** Implementada (2026-10-24). vitest se queda en 4.1.11 por un
fallo de npm (ver el resultado).
**Depende de:** ninguna
**LOC est.:** ~30 (manifiestos y lockfiles)

## Historia

**Como** dueño del repo, **quiero** los parches y las versiones menores al
día, **para** recibir las correcciones de seguridad sin arriesgar ningún
cambio de API.

## Contexto — verificado (2026-10-24)

| Proyecto | Paquete | Instalado | Destino |
|---|---|---|---|
| `packages/db` | `@prisma/client`, `@prisma/adapter-pg`, `prisma` | 7.10.0 | 7.10.1 |
| `packages/db` | `@biomejs/biome` | 2.5.10 | 2.6.3 |
| `packages/db` | `vitest` | 4.1.11 | 4.1.12 |
| scraper | `Scrapy`, `playwright`, `psycopg[binary]` y 23 transitivas | — | lo que resuelvan los rangos de `requirements.txt` |
| `apps/` | `next-auth` | 4.24.10 | 4.24.15 |
| `apps/` | `axios` | 1.7.7 | 1.20.x |
| `apps/api/rest` | `axios` | 1.19.0 | 1.20.x |
| `apps/api/rest` | `qs` | 6.15.3 | 6.16.x |

`requirements.txt` usa rangos (`scrapy>=2.8`, `playwright>=1.40.0`, …), así
que el scraper se actualiza reinstalando; no hace falta editar el archivo.

## Scope

**Incluye:**

- `packages/db`: subir los paquetes de la tabla dentro de su versión mayor y
  regenerar con `just db-build`;
- el scraper: `pip install --upgrade -r requirements.txt` en su venv y
  `playwright install chromium` si cambia la versión de Playwright;
- `next-auth` 4.24.15 en el shop;
- `axios` en el shop, en admin/rest y en la API, y `qs` en la API, dentro de
  su versión mayor.

**NO incluye:**

- ninguna versión mayor (Prisma 8 es DA-5; `dotenv` 18, `tsup` 9 y
  `vitest` 5 van en una US aparte si se quieren);
- el resto de los 211 paquetes del workspace: entran con la US de su
  framework;
- fijar versiones exactas en `requirements.txt`.

## Criterios de aceptación

### CA-1 — Nada se rompe

`just db-check` (412 tests), `npx jest` de la API (565 tests), `just
db-test`, el lint de `packages/db` y el de la API (sin escribir) dan lo
mismo que la línea base.

### CA-2 — El shop y el admin siguen arriba

`just verify` responde con contenido real. El login con credenciales
funciona en el shop, que es lo que toca `next-auth`. La consola de `/shops`
no muestra avisos nuevos.

### CA-3 — El scraper sigue escribiendo

`just db-test` pasa y `just spiders` lista los 6 spiders.

## Escenarios Gherkin

```gherkin
Feature: Parches sin cambio de comportamiento
  Scenario: CA-1 — la batería no cambia
    Given la línea base de db-check, jest y lint
    When se suben los parches y las menores
    Then las cifras son las mismas
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `packages/db/package.json`, `package-lock.json` | versiones |
| `apps/shop/package.json`, `apps/admin/rest/package.json`, `apps/yarn.lock` | `next-auth`, `axios` |
| `apps/api/rest/package.json`, `apps/api/rest/yarn.lock` | `axios`, `qs` |

## Definición de Done

- [x] Línea base pegada: `just db-check`, `npx jest`, `just db-test`, los dos
      lint.
- [x] Las versiones antes y después, en una tabla.
- [x] CA-1..CA-3 con la salida pegada. CA-3 se cubre por otro camino, porque
      `just db-test` ya estaba roto (ver el desvío).
- [x] Lint sin escribir en 0 en los paquetes tocados, con la salida pegada.
- [x] Status actualizado aquí y en la tabla del épico.

## Resultado — ejecutado el 2026-10-24

### Versiones

| Proyecto | Paquete | Antes | Después |
|---|---|---|---|
| `packages/db` | `@prisma/client`, `@prisma/adapter-pg`, `prisma` | 7.10.0 | 7.10.1 (rango `^7.0.0` → `^7.10.1`) |
| `packages/db` | `@biomejs/biome` | 2.5.10 | 2.6.3 (rango `^2.4.15` → `^2.6.3`) |
| `packages/db` | `vitest` | 4.1.11 | **4.1.11, sin cambios** (ver desvío 2) |
| `apps/api/rest` | `axios` | 1.19.0 | 1.20.0 (rango `^1.2.1` → `^1.20.0`) |
| `apps/api/rest` | `qs` | 6.15.3 | 6.16.1 (rango `^6.11.0` → `^6.16.0`) |
| `apps/` (shop, admin/rest) | `axios` | 1.7.7 | 1.20.0 (exacta) |
| `apps/` (shop) | `next-auth` | 4.24.10 | 4.24.15 (exacta) |
| scraper | `Scrapy` | 2.18.0 | 2.19.0 (trae `aiohttp` 3.14.5 y sus dependencias) |
| scraper | `playwright` | 1.62.0 | 1.64.1 (más Chromium headless shell v1248) |
| scraper | `psycopg`, `psycopg-binary` | 3.3.4 | 3.3.6 |
| scraper | `python-dotenv` | 1.2.3 | 1.2.4 |

Las fechas de publicación de axios 1.20.0 (2026-08-26) y next-auth 4.24.15
(2026-07-20) tienen más de dos semanas.

El lockfile de la API cambia 199 líneas. Además de `axios` y `qs`, recoge
las dependencias transitivas de `@safari/db` (`link:`) que trae Prisma
7.10.1: `@prisma/*` 7.10.1, `mysql2` 3.24.4, `deepmerge-ts` 8.0.2 y otras.

### Línea base y después

| Gate | Antes | Después |
|---|---|---|
| `just db-check` | 32 archivos / 412 tests | 32 archivos / 412 tests |
| `npx jest` (API) | 34 suites / 565 tests | 34 suites / 565 tests |
| `npx eslint "{src,apps,libs,test}/**/*.ts"` (API) | 0 problemas | 0 problemas |
| `npm run lint` (`packages/db`) | 0 (77 archivos) | 0 (78 archivos: Biome 2.6 también revisa `README.md`) |
| `yarn lint` del shop / del admin | — | `✔ No ESLint warnings or errors` / `✔ No ESLint warnings or errors` |
| `just build-api` | — | `Done in 51.52s`, EXIT=0 |
| `just db-test` | **falla**: `relation "productos" does not exist` | falla igual (desvío 1) |
| `just spiders` | 6 spiders | 6 spiders |
| `pip check` | `No broken requirements found.` | `No broken requirements found.` |

```
$ just db-check
 Test Files  32 passed (32)
      Tests  412 passed (412)

$ cd apps/api/rest && npx jest
Test Suites: 34 passed, 34 total
Tests:       565 passed, 565 total

$ just verify
OK   API    :9001/api/settings  200  5503B  559ms
OK   Shop   :3003/en  200  190839B  790ms  cards:30
OK   Admin  :3002/en/login  200  72821B  3016ms  cards:1
```

### CA-2 — El shop y el admin

- **Shop:** `/shops` muestra las 12 tiendas. `GET /api/auth/providers`
  responde 200 con `{}` (sin Google, como dejó US-70) y `/api/auth/session`
  responde 200. El login con `customer@demo.com` envía `POST /api/token` →
  201 y `GET /api/me` → 200, crea la cookie `auth_token`, cierra el modal y
  quita el botón «Join».
- **Consola de `/shops`:** muestra los mismos mensajes que la línea base
  (React DevTools, HMR y dos *issues* de formularios). Al abrir los modales
  aparecen dos avisos, uno de LCP de la imagen del popup y otro de
  `aria-hidden`. Vienen de `next/image` y del diálogo, que no cambian de
  versión en esta US.
- **Admin:** el login con `admin@demo.com` llega al dashboard como «Super
  Admin». Con la herramienta de automatización del navegador, el clic en
  «Login» no envía el formulario, pero `button.click()` desde la página sí:
  `elementFromPoint` confirma que el botón es el elemento visible en ese
  punto. Es un problema de la herramienta, no de la app.

### CA-3 — El scraper escribe en Postgres

Como `just db-test` está roto (desvío 1), se usó un script de humo temporal
que pasa el `PostgresPipeline` real dos veces sobre el mismo item:

```
stats {'insertados': 1, 'actualizados': 1, 'fallidos': 0, 'promociones_descartadas': 0}
filas [(1411, 1400000.0, 1200000.0)]
restos tras limpiar 0
```

El script inserta y después actualiza (upsert por procedencia), deja una
sola fila con el precio nuevo y borra lo que creó (producto, puente,
tienda y marca).

### Desvíos

1. **`just db-test` ya estaba roto.** `services/scraper-worker/test_pipeline.py`
   borra y consulta la tabla `productos`, que ya no existe. Es lo mismo que
   `just db-count` (Épico 5, US-8). No se arregla aquí, porque es otra US.
   CA-3 se cubrió con el humo de arriba.
2. **vitest 4.1.12 no se pudo instalar.** `npm install -D vitest@4.1.12`
   falla con `Cannot read properties of null (reading 'edgesOut')` dentro de
   `@npmcli/arborist` (`#loadPeerSet`), tanto con npm 11.4.2 como con npm
   10.9.2. Pasa lo mismo con `npm update` y con un `npm install` normal tras
   cambiar el rango. Con el rango original, `npm install` funciona. Como es
   un parche, se queda en 4.1.11, sin `--force` ni `--legacy-peer-deps`
   (D-6 del épico).
3. **Biome 2.6 obliga a dos cambios.** `biome migrate --write` actualiza el
   `$schema` de `biome.json` a 2.6.3. Además, Biome ahora formatea Markdown y
   reescribió una cursiva de `packages/db/README.md` (`*dual package
   hazard*` → `_dual package hazard_`), en su propio commit de solo formato.
4. **El scraper solo sube las dependencias directas.** `pip install
   --upgrade -r requirements.txt` no mueve las transitivas que ya cumplen
   (`certifi`, `urllib3`, etc.). No se forzaron.

### Hallazgos que no son de esta US

- En el dashboard del admin, la consola da `Invalid href
  'http://localhost:3003//' passed to next/router`: un enlace a la tienda
  con la barra final duplicada, probablemente por cómo se concatena la URL
  del shop.
- El admin todavía tiene la meta `apple-mobile-web-app-capable` sin la
  estándar; el shop se corrigió en `92a9ee0`.

## Notas para el agente ejecutor

- Biome 2.6 puede traer reglas nuevas. Si `npm run lint` deja de dar 0, los
  hallazgos nuevos se anotan y se decide con el dueño. No se apagan reglas
  para que pase.
- `prisma generate` puede cambiar `generated/`, que está en `.gitignore`: no
  cuenta como diff.
