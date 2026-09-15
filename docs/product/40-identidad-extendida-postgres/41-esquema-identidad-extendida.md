# US-41 — Esquema y capa de datos de identidad extendida

> Crear en `db/schema.sql` la relación staff↔tienda y el singleton de
> `become-seller`, sembrarlas y exponerlas en `@safari/db` como modelos
> introspectados y `*Record`. Todo el DDL del épico va aquí: un solo
> `just db-reset`.

**Épico:** [Épico 40](./README.md)
**Fecha:** 2026-09-15
**Status:** Hecho — ejecutada en dos cortes (`5af81ad` + capa de datos/tests),
Definición de Done cerrada con evidencia real abajo
**Depende de:** ninguna
**LOC est.:** ~700

## Historia
**Como** agente que va a migrar `staffs` y `become-seller` desde el mock,
**quiero** que sus tablas, su seed y sus tipos existan y estén verificados,
**para** que las US consumidoras no tengan que tocar DDL ni pedir otro
`db-reset`.

## Contexto

- El épico se quedó con **dos** dominios que necesitan tabla, no cuatro:
  `withdraws` y `ownership-transfer` cuelgan de `balance` (ver
  [US-43](./43-ownership-transfer-postgres.md) y R-1 del épico).
- `settings` ya existe como singleton (`db/schema.sql`, `id smallint PRIMARY
  KEY DEFAULT 1` + `CONSTRAINT settings_fila_unica CHECK (id = 1)`) y es el
  patrón a copiar para `become-seller`. **No** meter `page_options` dentro de
  `settings.options`: la respuesta de `/api/settings` está congelada byte a
  byte (5503 B) y crecería.
- `staffs` no tiene JSON en `src/db/pickbazar/`: hoy `ShopsService.getStaffs`
  devuelve `{ data: [], ...paginate(0, …) }` (`shops.service.ts:220-226`).
  El seed de staff, por tanto, **no** se copia de un mock: se inventa
  coherente con los 3 usuarios y 12 tiendas ya sembrados.
- `become-seller.json` sí existe y tiene **dos** claves de nivel superior,
  no una: `page_options` (banner, `defaultCommissionRate`, textos) y
  `commissions` (array de niveles de comisión con `id`, `level`, `sub_level`,
  `description`). Ambas las sirve `become-seller.service.ts` verbatim.
  Es contenido de página, no una entidad transaccional.
  **Corregido el 2026-09-15**: las versiones previas de esta US y de US-44
  decían «un único objeto con `page_options`». Era falso —se redactó leyendo
  el JSON truncado— y una sola columna `page_options` habría perdido
  `commissions` en silencio.

## Scope

**Incluye:** el DDL de las dos tablas en `db/schema.sql`; su seed en
`db/seed.sql` (vía `generate-seed.mjs` donde aplique); `just db-reset`; la
re-introspección de Prisma (`prisma db pull` + renombres); los `*Record` y
mappers en `packages/db/src/records.ts`; la exportación por el barrel
`packages/db/index.ts`; y tests de integración del esquema (FKs, CHECK,
cascadas, conteos del seed).

**NO incluye:** repositorios de funciones planas ni sus tests de caso de uso
(van en US-42 y US-44); ningún servicio ni controlador de Nest; ninguna tabla
de `balance`/`withdraws`/`ownership_transfers`; levantar la exclusión de
`db/schema.sql:13-16`; frontend.

## Criterios de aceptación

### CA-1 — Pivote staff↔tienda, **sin columna de rol**
Existe una tabla que relaciona `users` y `shops` en N:M, con PK compuesta y
FKs `ON DELETE CASCADE`, siguiendo el patrón de `permission_user`
(`db/schema.sql:173-178`). Un usuario MUST poder ser staff de varias tiendas y
una tienda MUST poder tener varios staff. La tabla NO sustituye a
`permission_user`: aquel es global al usuario, éste es por tienda.

> **Titulaba «con rol» hasta el 2026-09-15; se implementó sin rol.** No es un
> recorte silencioso: ningún consumidor pide rol hoy, y se verificó uno a uno
> —`GetStaffsDto` devuelve `UserPaginator` (usuarios, no filas del pivote);
> el `AddStaffInput` del admin es `{email, password, name, shop_id}`;
> `StaffList` pinta solo name/email/is_active; y `users` no tiene columna
> `shop_id` pese a que el mock la trae—. Una columna sin consumidor es una
> abstracción no ganada. Añadir el rol más adelante es un requisito nuevo, no
> un arreglo, y cuesta otro `db-reset`. Razonado en `proposal.md` y fijado en
> `specs/extended-identity-schema/spec.md`.

### CA-2 — Singleton de `become-seller`
Existe una tabla singleton con el mismo patrón de `settings` (PK `DEFAULT 1`
+ CHECK de fila única) y **dos columnas `jsonb`: `page_options` y
`commissions`**, una por cada clave de nivel superior del JSON. Su seed
reproduce `apps/api/rest/src/db/pickbazar/become-seller.json` **sin pérdida
de ninguna de las dos**: US-44 debe poder emitir la respuesta byte a byte sin
pedir otro `db-reset`, lo que contradiría la decisión 2 del épico.

### CA-3 — Sin trigger de `updated_at`
Ninguna de las tablas nuevas lleva trigger. La política de reloj es la de
US-32: `updatedAt: now()` desde `packages/db/src/clock.ts` en cada ruta de
escritura, especificada en
`openspec/specs/data-layer-clock-policy/spec.md`. El comentario de política
de `db/schema.sql:540-550` no se toca ni se le añaden triggers.

### CA-4 — Capa de datos tipada
`packages/db` expone los `*Record` de ambas tablas por el barrel, con la
frontera de serialización del repo (`BigInt → number` con `_id()`,
`Decimal → number` con `_dec()`, fechas como `Date`). `just db-check` verde.

### CA-5 — Sin regresión del seed
Tras `just db-reset`, los conteos vivos siguen intactos: 198 categorías /
83 raíces, 12 tiendas, 3 usuarios, 1200 productos. `just db-check` parte de
10 archivos / 210 tests y no baja.

## Escenarios Gherkin

```gherkin
Feature: Esquema de identidad extendida
  Scenario: CA-1 — un usuario es staff de dos tiendas
    Given un usuario y dos tiendas sembradas
    When se le asigna staff en ambas
    Then las dos filas coexisten y ningun unique lo impide

  Scenario: CA-1 — borrar la tienda arrastra sus filas de staff
    Given una tienda con staff asignado
    When se borra la tienda
    Then sus filas del pivote desaparecen y el usuario sigue existiendo

  Scenario: CA-2 — el singleton admite una sola fila
    Given la tabla de become-seller sembrada
    When se intenta insertar una segunda fila
    Then la CHECK de fila unica lo rechaza
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `db/schema.sql` | DDL de las 2 tablas + sus índices de FK |
| `db/seed.sql` | seed de ambas |
| `db/generate-seed.mjs` | generación del singleton desde `become-seller.json` |
| `db/README.md` | el modelo nuevo documentado |
| `packages/db/prisma/schema.prisma` | re-introspección + renombres |
| `packages/db/src/records.ts` | `*Record` y mappers |
| `packages/db/index.ts` | barrel |
| `packages/db/src/repositories/*.integration.test.ts` | tests de esquema |

## Definición de Done

- [x] Autorización de `just db-reset` concedida por el dueño y citada aquí.
      Concedida el 2026-09-15, registrada en la decisión 3 del Épico 40 y en
      `openspec/changes/esquema-identidad-extendida/design.md` (sección
      "Migration / Rollout").
- [x] Salida de `just db-reset` pegada, con los conteos del seed verificados.

  ```
  $ just db-reset
  docker compose down -v
  ...
  just db-up
  ... Container safari-postgres  Started
  esperando a Postgres. listo
  ... psql schema.sql (ON_ERROR_STOP=1) ...
  ... psql seed.sql (ON_ERROR_STOP=1) ...
    * esquema y datos de referencia aplicados
  ```

  ```sql
         tabla       | count
  -------------------+-------
   categories        |   198
   categories_raices |    83
   shops             |    12
   users             |     3
   products          |  1200
   shop_staff        |     3
   become_seller     |     1
  ```

  Pares de `shop_staff`: `(2,1)`, `(2,2)`, `(3,1)`, ninguno con `user_id=1`.
  `become_seller`: `id=1`, `jsonb_array_length(commissions)=2`.
  `SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal` → `0`.

- [x] `psql` mostrando las cascadas de CA-1 y el rechazo de la segunda fila
      de CA-2.

  ```sql
  -- Cascada de tienda (fixture desechable, ROLLBACK al final)
          momento         | pivote
  ------------------------+--------
   antes de borrar tienda |      1
           momento          | pivote
  --------------------------+--------
   despues de borrar tienda |      0
        chequeo       | existe
  --------------------+--------
   usuario sigue vivo |      1

  -- Cascada de usuario (fixture desechable, ROLLBACK al final)
           momento         | pivote
  -------------------------+--------
   antes de borrar usuario |      1
            momento          | pivote
  ---------------------------+--------
   despues de borrar usuario |      0
        chequeo      | existe
  -------------------+--------
   tienda sigue viva |      1

  -- Rechazo de la CHECK de fila única
  INSERT INTO become_seller (id, page_options, commissions)
  VALUES (2, '{}'::jsonb, '[]'::jsonb);
  ERROR:  new row for relation "become_seller" violates check constraint
  "become_seller_fila_unica"
  ```

- [x] `git diff packages/db/prisma/schema.prisma` clasificado: cosmético
      (renombres re-aplicados) vs semántico. Un diff semántico inesperado
      para y se reporta.
      Clasificado en `openspec/changes/esquema-identidad-extendida/apply-progress.md`
      (sección "Phase 4 — re-introspection classification"): únicamente
      cosmético (realineado de columnas, cabecera/banner perdidos y
      reaplicados, `onDelete: Restrict` de `Shop.owner` omitido por ser el
      default de Prisma — verificado que Postgres sigue en `RESTRICT` vía
      `pg_constraint.confdeltype`, `map` de `otp_codes_phone_idx` omitido por
      coincidir con el nombre por defecto) + los 2 modelos nuevos y 2
      back-relations esperados. Ningún diff semántico inesperado. Diff final
      reaplicado: 32 líneas.
- [x] `just db-check` verde con el recuento, sin bajar de 210.

  ```
  $ just db-check
  npm run typecheck
  > tsc --noEmit
  (sin errores)

  npm test
  > vitest run
   Test Files  12 passed (12)
        Tests  225 passed (225)
  ```

- [x] `cd apps/api/rest && npx jest` verde (no debería tocarlo: mockea
      `@safari/db`).

  ```
  Test Suites: 9 passed, 9 total
  Tests:       285 passed, 285 total
  ```

  Sin cambio respecto a la línea base (285): confirma que mockear
  `@safari/db` aísla la capa de datos como se esperaba.

- [x] Status de esta US actualizado y su fila marcada en el épico.

## Notas para el agente ejecutor

- **`just db-reset` AUTORIZADO por el dueño el 2026-09-15**, renovando la del
  2026-09-14 que cubría por nombre solo US-32 y US-34 (decisión 6 del Épico
  33) y que este repo declara no heredable (decisión 1 del Épico 26). La
  autorización cubre **esta US**, que es la única del Épico 40 que toca DDL.
  Un DDL, un reset, por US.
- El reset va **después** de escribir el DDL de las dos tablas, no antes:
  correrlo con el `schema.sql` sin tocar reconstruye lo mismo que ya hay.
- **Esta US toca DDL.** El camino es `db/schema.sql` → `just db-reset` →
  `prisma db pull` + renombres. No escribir migraciones incrementales ni
  editar `schema.prisma` a mano para cambiar el modelo.
- `prisma db pull` **pisa los renombres** (`packages/db/README.md:97`):
  revisar el diff de los 15 modelos existentes, no solo los 2 nuevos.
- Aplican las guardas de id fuera del rango `bigint` de US-31 a todo lo nuevo.
- El seed de staff se inventa (no hay mock): que sea coherente con los 3
  usuarios y 12 tiendas sembrados y que no altere sus conteos.
