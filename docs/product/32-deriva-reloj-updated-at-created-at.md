# US-32 — Deriva de reloj entre `created_at` y `updated_at`

> `created_at` lo calcula Prisma en Node (`@default(now())`); `updated_at` lo
> pisa un trigger de Postgres. Son dos relojes distintos, así que una fila puede
> persistir y servirse con `updated_at` **anterior** a `created_at`.

**Épico:** ninguno (US standalone)
**Fecha:** 2026-09-11
**Status:** Implementada y verificada (2026-09-15) — Opción B (retirar los 5
triggers; `updatedAt: now()` desde `packages/db/src/clock.ts` en cada
`update`/`upsert`); ver `openspec/changes/deriva-reloj-timestamps/`.
**Depende de:** ninguna
**LOC est.:** ~80 (requiere `db-reset`, **autorizado 2026-09-14**) — real:
~349 adds / ~123 dels (14 archivos)

> **Prerrequisito de US-34 (decidido 2026-09-14).** Esta US dejó de ser una
> standalone suelta: su elección de fuente de reloj (CA-1) es **insumo del
> DDL** del [Épico 33](./33-contenido-configuracion-postgres/README.md). Las 8
> tablas de entidad que crea US-34 reciben `PUT` reales y tienen que nacer
> bajo una sola política; hoy conviven dos en el repo (trigger en 5 tablas,
> `db/schema.sql:488-500`, y `updatedAt: now()` desde el repositorio en
> `types`/`tags`/`manufacturers`, decisión 9 del Épico 26). Ejecutar US-34
> antes garantizaría que esta US acabe tocando 13 tablas en vez de 5. Ver R-3
> del Épico 33 y la sección P-1 de US-34.
>
> **`just db-reset` autorizado por el dueño (2026-09-14)**, junto con US-34;
> registrado como decisión 6 del Épico 33.

## Historia
**Como** consumidor de la API y como alumno leyendo la base, **quiero** que los
timestamps de una fila sean coherentes entre sí, **para** que `updated_at >=
created_at` se cumpla siempre y los datos no contradigan su propia semántica.

## Contexto

- Hallazgo colateral de US-28 (2026-09-10/11), al diagnosticar un flake de test.
  **No es una regresión de US-28**: la grieta es de diseño y precede al épico 26.
- `packages/db/prisma/schema.prisma` declara `createdAt DateTime @default(now())`
  en todos los modelos (`:45-46`, `:59-60`, `:81-82`, `:100-101`, `:122-123`,
  `:140-141`, …). Prisma resuelve `@default(now())` **del lado del cliente**: el
  valor sale del reloj de Node.
- `db/schema.sql:479-486` define `tocar_updated_at()`, que hace
  `NEW.updated_at = now()` **sin condición**, y `:488-499` lo engancha como
  trigger `BEFORE UPDATE` en **cinco tablas**: `products`, `categories`,
  `shops`, `users`, `profiles`. Ese `now()` es el reloj del **servidor de
  Postgres**, y al ser `BEFORE UPDATE` incondicional **pisa** cualquier valor que
  la aplicación haya enviado.
- Consecuencia: en esas cinco tablas los dos timestamps vienen de relojes
  distintos. Medido durante US-28 en el contenedor de Docker local: deriva de
  **−114 ms a −543 ms** en un sentido, y de **+676 ms** en el otro en una sesión
  posterior. La dirección cambia entre arranques, o sea que es deriva real y
  variable, no un offset fijo.
- Las tablas **sin** trigger (`types`, `tags`, `manufacturers`) fijan
  `updatedAt: now()` explícitamente desde `packages/db/src/clock.ts`
  (`types.repository.ts:136`, `tags.repository.ts:178`,
  `manufacturers.repository.ts:205`). Ahí ambos valores son del reloj de Node y
  son coherentes: **esas tres no están afectadas.**
- Efecto secundario ya conocido: el reloj inyectable de los tests
  (`_setNowProvider`, `packages/db/src/clock.ts:12-14`) **no tiene efecto** sobre
  las columnas gobernadas por el trigger. US-28 tuvo que aseverar monotonía
  contra el reloj de la base en vez de copiar el patrón de reloj fijado de
  `types.integration.test.ts`.

## Scope

**Incluye:** decidir una única fuente de reloj para ambas columnas en las cinco
tablas con trigger y aplicarla; el cambio de DDL correspondiente en
`db/schema.sql`; la re-introspección de Prisma (`prisma db pull` + renombres);
`db-reset`; y un test que fije el invariante `updated_at >= created_at`.

**NO incluye:** tocar `types`/`tags`/`manufacturers` (no están afectadas);
cambiar la semántica de `_setNowProvider` para el resto de la suite; migraciones
incrementales (este repo no las tiene: el camino es `db-reset`); frontend.

## Criterios de aceptación

### CA-1 — Un solo reloj por fila
En `products`, `categories`, `shops`, `users` y `profiles`, `created_at` y
`updated_at` provienen de la misma fuente. Decisión esperada: alinear
`createdAt` a `dbgenerated("now()")` para que ambas salgan de Postgres, pero la
alternativa (quitar el trigger y fijar ambas desde `clock.ts`) es válida si el
refinamiento la justifica — hay que elegir una y declararla.

### CA-2 — El invariante se cumple y está probado
Para una fila recién creada y luego actualizada, `updated_at >= created_at`
siempre. Un test de integración lo fija y falla si se revierte el cambio.

### CA-3 — `_setNowProvider` queda documentado
Se declara explícitamente sobre qué columnas tiene efecto el reloj inyectable y
sobre cuáles no, en la cabecera de `clock.ts` o en `packages/db/README.md`, para
que nadie vuelva a copiar el patrón de reloj fijado donde no aplica.

### CA-4 — Sin regresión
`just db-reset` + `just db-up` reconstruyen la base; `just db-check`,
`npx jest`, `just build-api` y `just verify` verdes con recuentos. Los conteos
del seed (198 categorías / 83 raíces, y los del resto de tablas) intactos.

## Escenarios Gherkin

```gherkin
Feature: Coherencia de timestamps
  Scenario: CA-2 — updated_at nunca es anterior a created_at
    Given una categoria recien creada
    When se actualiza su nombre
    Then updated_at es mayor o igual que created_at
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `db/schema.sql` | fuente de reloj de `created_at` (o retirada del trigger) en las 5 tablas |
| `packages/db/prisma/schema.prisma` | re-introspección tras el cambio de DDL |
| `packages/db/src/clock.ts` | documentar el alcance real de `_setNowProvider` |
| `packages/db/src/repositories/*.integration.test.ts` | test del invariante |

## Definición de Done

- [x] `psql` pegado mostrando `created_at`/`updated_at` de una fila creada y
      actualizada en cada una de las 5 tablas, con `updated_at >= created_at`.
      Evidencia (creada vía `@safari/db` dist, no vía trigger — todas `ok = t`):

      ```
       id  |         created_at         |         updated_at         | ok
      -----+----------------------------+----------------------------+----
       241 | 2026-09-15 13:00:10.006+00 | 2026-09-15 13:00:10.123+00 | t   (categories)
        31 | 2026-09-15 13:00:10.176+00 | 2026-09-15 13:00:10.22+00  | t   (shops)
      1274 | 2026-09-15 13:00:10.259+00 | 2026-09-15 13:00:10.453+00 | t   (products)
        19 | 2026-09-15 13:00:10.505+00 | 2026-09-15 13:00:10.547+00 | t   (users)
      ```

      `profiles` (user_id=19): `created_at = updated_at`
      (`2026-09-15 13:00:10.505+00` ambas) — **esperado**, no hay ruta de
      `UPDATE` sobre `profiles` (sub-decisión b). Filas de evidencia borradas
      tras la verificación (centinelas `zz-verify-*`); conteos del seed
      re-confirmados intactos después del borrado.
- [x] Salida de `just db-reset` + `just db-up` pegada, y conteos del seed
      verificados: `categories` = 198, `categories WHERE parent_id IS NULL` =
      83; `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal;` → 0 filas.
- [x] `just db-check`, `npx jest`, `just build-api`, `just verify` verdes —
      salida real pegada en
      `openspec/changes/deriva-reloj-timestamps/apply-progress.md`
      (`db-check`: typecheck limpio + 210/210 tests; `jest`: 9/9 suites,
      285/285 tests; `build-api`: `nest build` sin errores; `verify`: API
      200/5503B, Shop 200 cards:30, Admin 200 cards:1).
- [x] Decisión de CA-1 declarada con su razonamiento en el reporte: **Opción
      B** (quitar los 5 triggers; `updatedAt: now()` desde `clock.ts` en cada
      ruta de `UPDATE`/`upsert` de la capa de datos), ya cerrada en
      `proposal.md` y ejecutada tal cual en `design.md` D-1/D-2/D-3. Ver
      también el hallazgo D-4 (abajo): con la política de reloj en la capa de
      datos, `findOrCreateShopBySlug` deja de mover `updated_at` en corridas
      repetidas del scraper — y de hecho **nunca lo movió**, porque Prisma no
      emite `UPDATE` para un `upsert` con `update: {}` cuando la fila existe
      (confirmado con `log:['query']`: la segunda llamada solo emite
      `SELECT`s + `COMMIT`, ningún `UPDATE shops`).
- [x] Status de esta US actualizado (arriba).
- [x] **W-1 del `verify-report` cerrado (2026-09-15).** Era la única de las 7
      rutas de la política cuyo `updatedAt: now()` ningún test protegía:
      `updateUserPasswordHash`. Test añadido en
      `users.integration.test.ts` sobre el dominio centinela (nunca el
      usuario 3, cuya credencial `demodemo` sostiene la DoD de US-22).
      **Verificado que detecta la regresión**, no solo que pasa: retirando
      `updatedAt: now()` de `users.repository.ts` la suite baja a
      `1 failed | 24 passed` con `expected 1789485718743 to be
      1789485778747` — exactamente los 60 s del reloj fijado. Línea
      restaurada y suite en 210/210.

## Notas para el agente ejecutor

- **Esta US sí toca DDL**, a diferencia de las del épico 26. El camino es
  `db/schema.sql` → `just db-reset` → `prisma db pull` + renombres. No escribir
  migraciones incrementales ni editar `schema.prisma` a mano para cambiar el
  modelo.
- El impacto real es un artefacto de datos, no una caída: nada se rompe hoy por
  esto. Lo que lo hace digno de ticket es que es invisible desde los tests
  (cada suite compara valores del mismo reloj) y que induce a error a quien
  escriba el siguiente agregado con trigger.
- Antes de elegir la opción de CA-1, comprobar si algún consumidor depende de que
  `created_at` sea del reloj de la aplicación (p. ej. algún test con reloj
  fijado); ahí está el coste real del cambio.
