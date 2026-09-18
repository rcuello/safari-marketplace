# US-44 — `become-seller` desde Postgres

> Las 2 rutas de la página de «hazte vendedor» dejan de servir JSON estático y
> leen el singleton de US-41. Es la US más barata del épico: contenido de
> página, sin relaciones.

**Épico:** [Épico 40](./README.md)
**Fecha:** 2026-09-15
**Status:** Completada (2026-09-18)
**Depende de:** [US-41](./41-esquema-identidad-extendida.md)
**LOC est.:** ~500

## Historia
**Como** visitante del shop y como admin, **quiero** que la página de «hazte
vendedor» y su formulario salgan de la base, **para** que editarlos no exija
tocar un JSON del repo y desplegar.

## Contexto — verificado en código

- Solo **2 rutas** (`apps/api/rest/src/become-seller/become-seller.controller.ts`).
  Es el módulo más pequeño de los que quedan mock con consumidor. El
  endpoint real es `POST|GET /api/became-seller` (**pasado**, no
  «become-seller»; `become-seller.controller.ts:9`), `@Public()` a nivel de
  clase (`:8`), sin guard de admin — el archivo se llama `become-seller`,
  la ruta HTTP se llama `became-seller`.
- `apps/api/rest/src/db/pickbazar/become-seller.json` tiene **dos** claves de
  nivel superior (corregido el 2026-09-15; antes esta US decía «un solo
  objeto», leído de un volcado truncado):
  - `page_options` — banner, `defaultCommissionRate`,
    `defaultCommissionDetails`, textos de la landing.
  - `commissions` — array de niveles de comisión (`id`, `level`, `sub_level`,
    `description`).
  `become-seller.service.ts` sirve ambas verbatim, así que **CA-1 no se puede
  cumplir si US-41 solo persiste `page_options`**. US-41 CA-2 ya crea las dos
  columnas `jsonb`.
  Es **contenido de página**, no una entidad transaccional — por eso US-41 le
  da una tabla singleton y no una colección.
- **No va dentro de `settings`.** Aunque el inventario lo listaba como
  «candidato a fila en `settings`», la respuesta de `/api/settings` está
  congelada byte a byte (5503 B) y meter `page_options` ahí la haría crecer.
  US-41 crea una tabla propia con el mismo patrón (`id smallint PRIMARY KEY
  DEFAULT 1` + CHECK de fila única).
- Consumidores reales verificados en el shop:
  `components/become-seller/index.tsx`,
  `components/become-seller/templates/user-story/customer-stories.tsx`,
  y los dos headers (`layouts/header.tsx`, `layouts/header-minimal.tsx`).
  En el admin: `data/become-seller.ts` y su entrada de menú.

## Scope

**Incluye:** las 2 rutas leyendo y escribiendo el singleton de US-41; el
repositorio de funciones planas y sus tests; la traducción
camelCase→snake_case en el servicio de Nest; tests de Nest con `@safari/db`
mockeado.

**NO incluye:** cambiar el contrato HTTP; rediseñar el contenido de la página;
`staffs`, `ownership-transfer` ni `withdraws`; tocar `settings`; frontend.

## Criterios de aceptación

### CA-1 — Lectura desde Postgres, equivalencia estructural acotada
`GET /api/became-seller` devuelve un cuerpo cuyo JSON **parseado** es
profundamente igual (deep-equal) al que hoy sirve `become-seller.json`:
mismas claves y valores en `page_options` y `commissions`. Se acepta una
única divergencia, declarada y acotada a `created_at`/`updated_at` del
envoltorio, con **causa doble**:

- **Valor**: `db/seed.sql:33` no inserta esas dos columnas, así que toman su
  `DEFAULT now()` — la fecha del último `just db-up`, no las fechas de 2024
  que trae el mock.
- **Formato**: `Date.toJSON()` emite 24 caracteres donde el mock trae 27
  (3 decimales de segundo contra 6).

El cuerpo mide por eso 11 452 B frente a 11 458 B (−6 B = 3 caracteres × 2
campos). Mismo precedente ya embarcado en `/api/settings`. El orden de claves
dentro de los `jsonb` no forma parte del contrato. La comparación se hace con
evidencia (`node -e`), no a ojo.

### CA-2 — Escritura real
La ruta de escritura actualiza el singleton y el `GET` siguiente refleja el
cambio. `updatedAt: now()` se fija desde `clock.ts` (política de US-32).

### CA-3 — El singleton sigue siendo único
Ninguna ruta puede crear una segunda fila: la CHECK de US-41 lo impide y el
servicio no lo intenta.

### CA-4 — Sin regresión
`just db-check`, `npx jest`, `just build-api` y `just verify` verdes con
recuentos. `/api/settings` sigue midiendo 5503 B: esta US no lo toca.

## Escenarios Gherkin

```gherkin
Feature: Pagina de hazte vendedor desde Postgres
  Scenario: CA-1 — la respuesta no cambia al migrar
    Given el singleton sembrado desde become-seller.json
    When GET de la ruta /api/became-seller
    Then el JSON parseado es profundamente igual al que servia el JSON estatico
    And la unica diferencia de bytes son los 6 de los decimales de
      created_at/updated_at del envoltorio

  Scenario: CA-2 — editar el banner persiste
    Given el singleton en base
    When se actualiza el titulo del banner
    Then el GET siguiente lo devuelve cambiado
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `packages/db/src/repositories/become-seller.repository.ts` | repositorio nuevo |
| `packages/db/src/repositories/become-seller.integration.test.ts` | **existente (US-41), se extiende** — no es un archivo nuevo |
| `packages/db/index.ts` | barrel |
| `apps/api/rest/src/become-seller/become-seller.service.ts` | lee y escribe Postgres |
| `apps/api/rest/src/become-seller/become-seller.service.spec.ts` | tests con `@safari/db` mockeado |

## Definición de Done

- [x] Deep-equal del cuerpo (5 campos acotados) + línea de bytes que acota
  la divergencia a los 2 timestamps del envoltorio, pegada (CA-1).
- [x] `curl` de la escritura y del `GET` posterior, pegados (CA-2).
- [x] `just db-check` y `npx jest` verdes con recuentos.
- [x] `just build-api` y `just verify` verdes; `/api/settings` en 5503 B.
- [x] Status de esta US actualizado y su fila marcada en el épico.

### Evidencia (Cut 2, 2026-09-18)

**CA-1 — deep-equal acotado (5 campos) + bytes**

```
--- Bytes (UTF-8, en disco) ---
antes.json  : 11458 B
despues.json: 11452 B
delta       : -6 B

--- D-3: equivalencia estructural acotada a 5 campos ---
1. Claves top-level (orden): [ 'page_options', 'commissions' ] => OK
2. Claves del envoltorio (orden): [ 'id', 'page_options', 'language', 'created_at', 'updated_at' ] => OK
3. id: 1 | language: "en" => OK (deep-equal)
4. page_options.page_options (24 claves) => OK (deep-equal)
5. commissions (array de 2 tiers) => OK (deep-equal)

--- Excluidos del deep-equal: created_at/updated_at del envoltorio (divergencia acotada) ---
antes.page_options.created_at  : 2024-06-06T10:30:48.000000Z (27 car.)
despues.page_options.created_at: 2026-09-15T17:41:00.858Z (24 car.)
antes.page_options.updated_at  : 2024-06-12T11:31:46.000000Z (27 car.)
despues.page_options.updated_at: 2026-09-15T17:41:00.858Z (24 car.)
Causa doble: (a) VALOR -- db/seed.sql:33 no inserta created_at/updated_at, toman DEFAULT now() del ultimo db-up, no las fechas 2024 del mock;
             (b) FORMATO -- Date.toJSON() emite 24 caracteres (.fffZ) donde el mock trae 27 (.ffffffZ).

CA-1: VERDE
```

**CA-2 — escritura real, `POST` + `GET` posterior**

```
POST /api/became-seller  -> HTTP 201
POST response banner title: CA-2 evidence: banner editado
POST response updated_at  : 2026-09-18T05:20:57.821Z

GET /api/became-seller (posterior) -> HTTP 200
GET-after banner title: CA-2 evidence: banner editado
GET-after updated_at  : 2026-09-18T05:20:57.821Z
```

`updated_at` posterior al valor previo (`2026-09-15T17:41:00.858Z` →
`2026-09-18T05:20:57.821Z`). Tras capturar la evidencia, la fila se
restauró vía `psql` (`page_options`/`commissions`/`language` al valor del
seed, `updated_at = created_at`) para dejar la base en el mismo estado de
reposo que exige el tripwire de `become-seller.integration.test.ts`.

**`npx jest` (`apps/api/rest`)**

```
Test Suites: 10 passed, 10 total
Tests:       290 passed, 290 total
```

Línea base de Cut 1: 9 suites / 285 tests. Delta: +1 suite
(`become-seller.service.spec.ts`) / +5 tests.

**`just build-api`**: verde — compila sin el JSON importado (`nest build`,
`Done in 97.39s`).

**`just verify`**

```
OK   API    :9001/api/settings  200  5503B  57ms
OK   Shop   :3003/en  200  190788B  851ms  cards:30
OK   Admin  :3002/en/login  200  72821B  2122ms  cards:1
```

**`git diff --stat`**: `domain-error.mapper.ts` y `become-seller.module.ts`
(y `settings/`) sin ninguna línea modificada — confirmado con `git diff`
vacío para ambos, además del `--stat` general.

**`just db-check` (post-evidencia, 2 corridas)**

```
Test Files  12 passed (12)
     Tests  228 passed (228)
```

**`psql` — reloj en reposo tras la suite (Finding 2 de Cut 1, comparación a
resolución de milisegundo — la cruda `updated_at = created_at` puede leer
`f` por microsegundos sin ser una regresión)**

```
 count
-------
     1
(1 row)

 reposo_crudo | reposo_ms |         updated_at         |          created_at
--------------+-----------+----------------------------+-------------------------------
 f            | t         | 2026-09-15 17:41:00.858+00 | 2026-09-15 17:41:00.858127+00
(1 row)
```

`reposo_crudo` lee `f` y eso **no** es una regresión: el `afterAll` de la suite
de integración repone `updated_at` con un `Date` de JavaScript, que solo llega
al milisegundo, mientras `created_at` conserva los microsegundos originales de
Postgres. Por eso la comprobación válida es `reposo_ms` (`date_trunc('milliseconds', ...)`),
que lee `t`. El tripwire de vitest no se ve afectado porque compara vía
`.getTime()`. Cualquier revisión futura de esta fila debe comparar a resolución
de milisegundo.

## Notas para el agente ejecutor

- **Es la candidata natural para ir primero tras US-41**: 2 rutas, sin
  relaciones, sin guards que preservar. Buena para validar que el DDL de
  US-41 sirve de verdad antes de meterse con `staffs`.
- El barrel `packages/db/index.ts` se comparte con US-42: quien arranque
  segundo rebasea.
- La comparación de CA-1 se hace con `node -e` sobre los dos cuerpos: `jq` no
  está instalado en el Git Bash de esta máquina.
