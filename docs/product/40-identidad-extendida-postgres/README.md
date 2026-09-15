# Épico 40 — Identidad extendida desde Postgres

> Fase 2 del inventario de mocks: la relación staff↔tienda, las transferencias
> de propiedad y la solicitud de vendedor. Toca `users` y `shops`, que ya están
> migradas, y **no necesita levantar** la exclusión transaccional de
> `db/schema.sql:13-16`.

**Fecha:** 2026-09-15
**Status:** Refinado

Origen: [`_backlog/api-mock-restante-dominio-transaccional.md`](../_backlog/api-mock-restante-dominio-transaccional.md),
Fase 2 de su secuencia propuesta. El dueño la priorizó el 2026-09-15.

## Por qué esta fase y no la 3

La Fase 3 (núcleo transaccional: `orders`, `reviews`, `questions`,
`wishlists`, `coupons`) es el corte grande, pero está **congelada por decisión
del dueño del 2026-09-14**: la exclusión de `db/schema.sql:13-16` —«wallets,
direcciones, órdenes, carritos y reviews»— no se levanta hasta que cierre la
Fase 1 (Épico 33). Esta fase es la única que avanza sin tocar esa decisión:
sus tres dominios cuelgan de `users` y `shops`, ya migradas en el Épico 19.

## Subdivisión en sub-historias

| US | Título | Releasable solo | Depende de | LOC est. |
|----|--------|-----------------|------------|----------|
| US-41 | Esquema y capa de datos de identidad extendida | No (habilitadora) | ninguna | ~1200 |
| US-42 | `staffs` desde Postgres (`/staffs`, `/my-staffs`, `/all-staffs`) | Sí | US-41 | ~1400 |
| US-43 | `ownership-transfer` desde Postgres | Sí | US-41 | ~1300 |
| US-44 | `become-seller` desde Postgres | Sí | US-41 | ~700 |

**Total estimado: ~4600 LOC.** US-42, US-43 y US-44 no dependen entre sí:
tras US-41 admiten agentes en paralelo, con la salvedad del barrel
(`packages/db/index.ts`), que comparten — quien arranque segundo rebasea.

Las cifras parten de los reales del Épico 26 y del 33, no de una intuición
optimista. Aun así son **suelo, no techo**: el Épico 26 desbordó su estimación
original entre ×2.0 y ×4.6, y US-32 (cerrada ayer) desbordó ×5 la suya.

## Refinamiento — Decisiones tomadas

| # | Tema | Decisión |
|---|------|----------|
| 1 | Alcance de `balance`/`withdraws` | **FUERA de este épico.** El inventario los listaba en la Fase 2, pero `withdraws` cuelga de `balance` y *wallets* está nombrado en la exclusión de `db/schema.sql:13`. Migrarlos exigiría levantarla, que es justo lo que la decisión del 2026-09-14 congeló. Se sacan para que este épico no dependa de una decisión pendiente. Ver R-1. |
| 2 | DDL del épico | **Todo en US-41, un solo `just db-reset`.** Precedente de los Épicos 19, 26 y 33: este repo no tiene migraciones incrementales, así que el esquema completo se diseña antes de la primera línea de servicio. |
| 3 | `just db-reset` | **Requiere autorización nueva del dueño.** La del 2026-09-14 cubría explícitamente **solo US-32 y US-34** (decisión 6 del Épico 33); no es heredable, igual que la decisión 1 del Épico 26 declaró no heredable la del 2026-08-31. **US-41 no arranca sin ella.** |
| 4 | Repositorios y tests | Van **con su US consumidora** (US-42..44), no en la habilitadora. Patrón de los Épicos 26 y 33 (P-2 de US-34): baja US-41 a ~1200 LOC y evita el cuello de botella. |
| 5 | Política de reloj | Las tablas nuevas **NO llevan trigger**: `updatedAt: now()` desde `packages/db/src/clock.ts` en cada ruta de escritura. Política fijada por US-32 y especificada en `openspec/specs/data-layer-clock-policy/spec.md`. |
| 6 | Ruta `transfer-shop-ownership` | Se resuelve **dentro de US-43**, no como US aparte. Ver D-3. |

## Visión técnica compartida

### Decisiones de Diseño (D-N)

**D-1 — `staffs` no es un módulo mock: son stubs dentro de módulos ya
migrados.** Verificado: las 6 rutas de `StaffsController` viven en
`apps/api/rest/src/shops/shops.controller.ts:99` y delegan en `ShopsService`
(`createStaff()`/`updateStaff()` sin argumentos); `my-staffs` y `all-staffs`
están en `apps/api/rest/src/users/users.controller.ts:121` y `:131` y delegan
en `UsersService`. Son 8 rutas repartidas en dos módulos que **ya leen
Postgres**. Consecuencia: US-42 no migra un módulo entero, sino que rellena
huecos declarados en dos servicios vivos — más barato que un módulo nuevo,
pero con más riesgo de regresión sobre `users`/`shops`.

**D-2 — La relación staff↔tienda es N:M con rol.** Un usuario puede ser staff
de varias tiendas y una tienda tiene varios staff. Pivote con PK compuesta y
FKs `ON DELETE CASCADE`, patrón de `permission_user`
(`db/schema.sql:173-178`). El `users.permissions` existente **no** lo
sustituye: es global al usuario, no por tienda.

**D-3 — `transfer-shop-ownership` es una ruta que el frontend llama y la API
no tiene.** Verificado: el admin declara
`TRANSFER_SHOP_OWNERSHIP: 'transfer-shop-ownership'` en
`apps/admin/rest/src/data/client/api-endpoints.ts:102`, y no existe ningún
controlador que la sirva. US-43 decide entre crearla o retirar la constante,
con evidencia de si algún componente la consume de verdad. No inventar la
ruta sin comprobar antes que tiene consumidor.

**D-4 — `become-seller` es un singleton de página, no una colección.** Solo 2
rutas. Candidato a fila en `settings` en vez de tabla propia; US-44 lo decide
y lo declara. La opción barata puede ser la correcta aquí.

**D-5 — Contratos HTTP byte a byte.** Igual que en los Épicos 26 y 33: la
respuesta no cambia al pasar del JSON mock a Postgres. La API publica
snake_case; la capa de datos devuelve camelCase; la traducción vive en los
servicios de Nest.

### Riesgos (R-N)

**R-1 — `withdraws` queda huérfano.** Sus 5 rutas
(`apps/api/rest/src/withdraws/`) siguen sirviendo JSON después de este épico,
y el dashboard del admin las consume (`data/withdraw.ts` →
`pages/withdraws/*`, `dashboard/admin.tsx`). No es una regresión —hoy ya es
mock— pero el épico **no** deja «identidad extendida» completa. Cerrarlo
exige la decisión sobre la exclusión de wallets, que hoy está congelada.
La `Balance` del shop es un objeto anidado de la entidad
(`apps/api/rest/src/shops/entities/shop.entity.ts:14,27,33`) sin columna en
la tabla `shops`: verificado.

**R-2 — US-41 es cuello de botella.** Bloquea las tres siguientes. Se la
mantiene en lo mínimo que exige `db-reset` y en lo que las tres comparten:
DDL, seed, `schema.prisma`, `records.ts` y barrel. No toca ningún servicio de
Nest.

**R-3 — Este épico toca `users` y `shops`, que están vivas.** A diferencia
del Épico 33 (puramente aditivo: tablas nuevas), aquí los pivotes apuntan a
dos tablas que sostienen autenticación y catálogo. Es la misma clase de
riesgo que el Épico 33 aisló en su US-39 y por eso la puso sola y al final.
Las guardas de id fuera de rango `bigint` de US-31 y la política de reloj de
US-32 aplican a todo lo nuevo.

**R-4 — Los conteos del seed son asserts vivos.** `shops` 12, `users` 3,
`categories` 198/83 raíces, 1200 productos: varias suites los comprueban.
Cualquier seed nuevo debe dejarlos intactos, y `just db-check` (hoy
10 archivos / 210 tests) es la línea base.

**R-5 — No hay evidencia de runtime.** El inventario de origen se hizo con
`grep` sobre referencias estáticas, con la API y los frontends apagados. Una
página puede existir y estar detrás de un flag de `settings`. Antes de
dimensionar US-42..44, comprobar el alcance real en el navegador.

## Notas globales para los agentes

- Leer, antes de tocar código: la US completa, este README, el `CLAUDE.md` de
  la raíz y `db/README.md` + `packages/db/README.md`.
- **US-41 no arranca sin autorización nueva de `just db-reset`** (decisión 3).
- El DDL vive en `db/schema.sql`; `packages/db/prisma/schema.prisma` se
  regenera con `prisma db pull` + renombres y **nunca** genera migraciones.
- Las tablas nuevas **no llevan trigger de `updated_at`** (decisión 5). El
  test del invariante NO detecta una ruta de `update` olvidada: la garantía
  es el inventario de rutas, no la suite.
- 1 US = 1 sesión de agente. Lo que el «NO incluye» excluye no se implementa
  aunque sea adyacente: se menciona en el reporte.
- La Definición de Done se cierra con salida real de comandos pegada, nunca
  con «debería funcionar».
