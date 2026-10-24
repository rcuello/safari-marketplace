# US-76 — Parches y versiones menores (db, scraper, axios, next-auth)

> Sube todo lo que se puede subir sin cambiar ninguna versión mayor:
> `packages/db` dentro de Prisma 7, el scraper dentro de sus rangos,
> `axios` y `next-auth` 4.24.15. Es la tanda de menor riesgo y deja la línea
> base limpia para el resto del épico.

**Épico:** [Épico 75](./README.md)
**Fecha:** 2026-10-24
**Status:** Listo para ejecución
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

- [ ] Línea base pegada: `just db-check`, `npx jest`, `just db-test`, los dos
      lint.
- [ ] Las versiones antes y después, en una tabla.
- [ ] CA-1..CA-3 con la salida pegada.
- [ ] Lint sin escribir en 0 en los paquetes tocados, con la salida pegada.
- [ ] Status actualizado aquí y en la tabla del épico.

## Notas para el agente ejecutor

- Biome 2.6 puede traer reglas nuevas. Si `npm run lint` deja de dar 0, los
  hallazgos nuevos se anotan y se decide con el dueño. No se apagan reglas
  para que pase.
- `prisma generate` puede cambiar `generated/`, que está en `.gitignore`: no
  cuenta como diff.
