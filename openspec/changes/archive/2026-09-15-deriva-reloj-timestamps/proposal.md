# Proposal: US-32 — Un solo reloj para `created_at` y `updated_at`

## Intent

En `products`, `categories`, `shops`, `users` y `profiles`, `created_at` lo
calcula Prisma en Node (`@default(now())`) y `updated_at` lo pisa el trigger
`BEFORE UPDATE` incondicional de `db/schema.sql:488-500` con el reloj del
servidor de Postgres. La deriva medida va de −543 ms a +676 ms y cambia de
signo entre arranques: una fila puede servirse con `updated_at` **anterior** a
`created_at`. No rompe nada hoy, pero es invisible desde los tests y un mal
patrón a copiar.

Es además **prerrequisito duro de US-34** (R-3 del Épico 33): las 12 tablas
nuevas reciben `PUT` reales y deben nacer bajo una sola política de reloj.

## Decisión de CA-1 — se adopta la Opción B

**Política declarada: `updated_at` lo fija la capa de datos desde
`packages/db/src/clock.ts`; Postgres no tiene triggers de timestamp.** Se
retiran los 5 `CREATE TRIGGER` y cada `update` de repositorio fija
`updatedAt: now()`, con el patrón ya probado en `types.repository.ts:136`,
`tags.repository.ts:190` y `manufacturers.repository.ts:217`.

Razones (concurro con la exploración):

1. **Converge el repo en UNA política.** Hoy conviven dos (trigger en 5
   tablas; repositorio en 3, decisión 9 del Épico 26). Con B, las 3 + 5
   actuales y las 8 tablas de entidad de US-34 quedan bajo la misma regla.
2. **Cero mantenimiento nuevo en Prisma.** `prisma db pull` nunca modeló el
   trigger, así que su ausencia **no cambia `schema.prisma` en absoluto**.
3. **Recupera `_setNowProvider`** sobre `updated_at` de 5 tablas más.

**Opción A rechazada** (`createdAt` a `@default(dbgenerated("now()"))` para que
ambas salgan de Postgres): la introspección mapea `DEFAULT now()` a
`@default(now())`, no a `dbgenerated`, así que exige **reanotar a mano las 5 —
luego 13 — tablas después de cada `prisma db pull`**, un paso de disciplina
nuevo y no documentado en `packages/db/README.md:94-100`. Además entrenchea el
trigger (de 5 a 13 tablas) sin eliminar la segunda política, y deja ambas
columnas fuera del alcance de `clock.ts`. `@updatedAt` de Prisma tampoco es
opción: con el trigger vivo queda pisado, y sin trigger usa el reloj del motor
en vez de `clock.ts`, perdiendo mockability.

### Sub-decisiones

| # | Tema | Decisión | Razón |
|---|------|----------|-------|
| a | `tocar_updated_at()` (`db/schema.sql:480-486`) | **Se borra el SQL ejecutable**; queda un comentario de 3-4 líneas con la política, apuntando a `clock.ts` | El fichero es material didáctico leído de arriba abajo: borrar sin rastro invita a re-añadir un trigger en la próxima tabla. SQL comentado "por si acaso" es la peor forma de tombstone; el precedente de `services/scraper-worker/schema.sql` es un fichero-lápida completo, aquí basta la nota de política |
| b | `profiles` sin `update` propio | **No se crea ninguna función nueva.** `profiles` no tiene ruta de actualización en todo `packages/db` (verificado: solo el `create` anidado de `users.repository.ts:292-294` y un `findMany` en `auth-tokens.repository.ts:258`). Ambas columnas nacen del mismo `@default(now())` de Node en ese create y, sin `UPDATE`, la fila conserva `updated_at = created_at`: el invariante se cumple. La política documentada obliga a la **primera** ruta de update futura a fijar `updatedAt: now()` | Un `updateProfile` sin llamador sería código muerto y expansión de scope. El trigger de `profiles` es, de hecho, código muerto hoy |
| c | `createdAt` explícito desde `clock.ts` en `create()` | **NO — no-goal deliberado** | Con la Opción B ambas columnas ya salen del reloj de Node: **CA-1 queda satisfecho sin esto**. Ni `types`/`tags`/`manufacturers` lo hacen, así que añadirlo solo en estas 5 crearía una asimetría nueva. Queda como candidato a ticket aparte |

## Scope

### In Scope

- `db/schema.sql`: retirar la función y los 5 triggers; dejar el comentario de política.
- `packages/db`: `updatedAt: now()` en las 7 rutas de `UPDATE` reales (ver tabla).
- Re-introspección (`prisma db pull` + renombres) y `just db-reset` — se espera **diff vacío** en `schema.prisma`; verificarlo es parte de la evidencia.
- CA-3: documentar el alcance real de `_setNowProvider` en la cabecera de `clock.ts` (y la línea de `packages/db/README.md:37`).
- CA-2: test de integración del invariante `updated_at >= created_at` sobre fila creada-y-actualizada en `categories`, `products`, `shops` y `users`.
- Reescribir los tres comentarios obsoletos (`categories.integration.test.ts:279-289`, `products.integration.test.ts:518-539`, `shops.integration.test.ts:375-380`). **No es drive-by**: documentan la restricción "nunca create-vs-update" que este cambio elimina; dejarlos sería publicar documentación falsa junto al test que la contradice.

### Out of Scope (no-goals explícitos)

- Tocar `types`/`tags`/`manufacturers` (no están afectadas; su patrón es el que se adopta).
- Cambiar la semántica de `_setNowProvider` para el resto de la suite.
- Migraciones incrementales (este repo no las tiene: el camino es `db-reset`).
- Frontend, y cualquier servicio de Nest (son passthrough puro: radio de impacto cero).
- Fijar `createdAt` desde `clock.ts` (sub-decisión c).
- Crear `updateProfile` (sub-decisión b).

## Capabilities

### New Capabilities
- `data-layer-clock-policy`: una sola fuente de reloj por fila en la capa de datos; invariante `updated_at >= created_at`; alcance declarado de `_setNowProvider`; regla vinculante para tablas nuevas (US-34).

### Modified Capabilities
- `category-tree-api`: el requisito de `PUT /categories/:id` (`spec.md:203-206`) afirma que `updated_at` "la fija un trigger de base de datos, no el repositorio" y que su verificación debe comparar contra el reloj de la base. Deja de ser cierto; el delta MUST reescribir ese bloque completo conservando sus escenarios.
- `flat-catalogs-api:377` ("ninguna tabla tiene trigger") sigue siendo cierto y **no** necesita delta.

## Affected Areas

| Área | Impacto | Descripción |
|------|---------|-------------|
| `db/schema.sql:480-500` | Removed | Función + 5 triggers fuera; comentario de política en su lugar |
| `packages/db/src/repositories/products.repository.ts:381,817` | Modified | Rama `update` del upsert del scraper + `updateProduct` |
| `packages/db/src/repositories/categories.repository.ts:534` | Modified | `updateCategory` |
| `packages/db/src/repositories/shops.repository.ts:302,333` | Modified | `updateShop`, `setShopActive` |
| `packages/db/src/repositories/shops.repository.ts:191` | Modified (nota) | `findOrCreateShopBySlug` usa `update: {}`; se deja no-op. Cambio de comportamiento a declarar: hoy el trigger bumpea `updated_at` en cada corrida del scraper aunque no cambie nada — con B deja de hacerlo, que es lo que su propio comentario ya promete |
| `packages/db/src/repositories/users.repository.ts:328,345` | Modified | `updateUserPasswordHash`, `setUserActive` |
| `packages/db/src/clock.ts:1-7` | Modified | Cabecera CA-3: afecta `updated_at` de 8 tablas y `consumedAt` de `password_reset_tokens`/`otp_codes`; **no** afecta `created_at` de ninguna |
| `packages/db/prisma/schema.prisma` | Sin cambio esperado | La re-introspección debe dar diff vacío |
| `{categories,products,shops,users}.integration.test.ts` | Modified | Test del invariante + reescritura de comentarios |

## Risks

| Riesgo | Prob. | Mitigación |
|--------|-------|------------|
| Ruta de `UPDATE` olvidada → `updated_at` congelado en silencio | Media | El inventario de arriba sale de `grep` sobre `.update(`/`.upsert(` en los 4 repositorios; el test del invariante no lo detecta (igualdad pasa `>=`), así que la revisión es por inventario, no por test |
| `just db-reset` es destructivo | Baja | Autorizado por el dueño (2026-09-14, decisión 6 del Épico 33); base no productiva, reconstruible desde `schema.sql` + `seed.sql` |
| Re-introspección grande: `prisma db pull` pisa renombres manuales de los 8 modelos | Media | Revisar el diff completo, no solo las 5 tablas (`packages/db/README.md:94-100`) |
| LOC real por encima de la estimación | Alta | La US estima ~80 LOC; con 7 call sites, 4 tests nuevos, la cabecera de CA-3 y la reescritura de tres comentarios largos, la previsión realista es **~150-200 LOC**. Se declara aquí para el forecast de carga de revisión |

## Rollback Plan

1. `git revert` del commit (o `git checkout -- db/schema.sql packages/db/`), en este orden: primero el DDL, luego `packages/db`. No hay artefactos generados versionados (`dist/`, `generated/` están gitignored).
2. `just db-reset` + `just db-up` — reaplica el `schema.sql` revertido, con los 5 triggers de vuelta.
3. `cd packages/db && npx prisma db pull` → confirmar diff vacío; `npm run generate`; `just db-build`.
4. Confirmar base sana: `SELECT count(*) FROM categories` = **198** y raíces (`parent_id IS NULL`) = **83**; `just db-check` verde; `just verify` con los 3 servicios sirviendo contenido real.

No hay datos que perder: el seed es determinista.

## Dependencies

- Autorización de `just db-reset` (concedida 2026-09-14).
- Bloquea a **US-34**, que hereda esta decisión como insumo de su DDL.

## Success Criteria

- [ ] CA-1: los 5 triggers fuera de `db/schema.sql`; política declarada en el comentario y en `clock.ts`.
- [ ] CA-2: test de integración que falla si se revierte el cambio, verde en `just db-check`.
- [ ] CA-3: alcance de `_setNowProvider` documentado (columnas que afecta y que no).
- [ ] CA-4: salida real pegada de `just db-reset` + `just db-up` con conteos del seed (198/83), `just db-check`, `cd apps/api/rest && npx jest`, `just build-api`, `just verify`.
- [ ] `psql` pegado con `created_at`/`updated_at` de una fila creada-y-actualizada en las 5 tablas. Para `profiles` se espera `updated_at = created_at` (no hay ruta de update): eso satisface el invariante y así se declara de antemano.
- [ ] `prisma db pull` con diff vacío en `schema.prisma`.
