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

| US | Título | Releasable solo | Depende de | LOC est. | Status |
|----|--------|-----------------|------------|----------|--------|
| [US-41](./41-esquema-identidad-extendida.md) | Esquema y capa de datos de identidad extendida | No (habilitadora) | ninguna | ~700 | ✅ Implementada |
| [US-42](./42-staffs-postgres.md) | `staffs` desde Postgres (`/staffs`, `/my-staffs`, `/all-staffs`) | Sí | US-41 | ~1200 | |
| [US-43](./43-ownership-transfer-postgres.md) | `ownership-transfer` desde Postgres | — | — | ~1300 | ⏭️ **Aplazada a la Fase 3** (2026-09-15) |
| [US-44](./44-become-seller-postgres.md) | `become-seller` desde Postgres | Sí | US-41 | ~500 | |

**El épico son tres US, no cuatro.** US-43 salió del alcance el 2026-09-15
(decisión 1b'): se ejecutará en el épico de la Fase 3, no aquí. Alcance total
**~2400 LOC**, de los que US-41 (~700) ya está hecha — quedan **~1700 en
US-42 + US-44**. No dependen entre sí: admiten agentes en paralelo, con la
salvedad del barrel (`packages/db/index.ts`), que comparten — quien arranque
segundo rebasea.

**Orden recomendado:** US-41 → **US-44** → US-42. US-44 son 2 rutas sin
relaciones ni guards: valida que el DDL de US-41 sirve de verdad antes de
meterse con `staffs`, que toca dos servicios vivos.

Las cifras parten de los reales del Épico 26 y del 33, no de una intuición
optimista. Aun así son **suelo, no techo**: el Épico 26 desbordó su estimación
original entre ×2.0 y ×4.6, y US-32 (cerrada ayer) desbordó ×5 la suya.

## Refinamiento — Decisiones tomadas

| # | Tema | Decisión |
|---|------|----------|
| 1 | Alcance de `balance`/`withdraws` | **FUERA de este épico.** El inventario los listaba en la Fase 2, pero `withdraws` cuelga de `balance` y *wallets* está nombrado en la exclusión de `db/schema.sql:13`. Migrarlos exigiría levantarla, que es justo lo que la decisión del 2026-09-14 congeló. Se sacan para que este épico no dependa de una decisión pendiente. Ver R-1. |
| 1b | `ownership-transfer` arrastra `balance` | Hallazgo al redactar US-43 (2026-09-15). Su contrato incluye `balance_info`, y en el mock **no es `null` en ninguna de las 6 filas**: es una fila entera de la tabla wallet (`shop_id`, `admin_commission_rate`, `total_earnings`, `withdrawn_amount`, `current_balance`, `payment_info`). Y el admin lo consume de verdad: `shop-transfer/details.tsx:50-52` parsea su `payment_info` y `templates/header.tsx:134` condiciona UI a `current_balance`. Con el contrato preservado byte a byte no se puede migrar sin esa tabla, y no se puede omitir el campo. La decisión 1 no bastaba: la dependencia de wallet no estaba solo en `withdraws`. |
| 1b' | Qué se hace con US-43 | **APLAZADA a la Fase 3 — opción C, decidida por el dueño el 2026-09-15.** Sale del alcance de este épico. Se descartaron: (A) crear una tabla `balance` mínima, porque revertiría de facto el «todavía no» del 2026-09-14 sin haber cerrado la Fase 1, que era la condición puesta entonces; y (B) servir `balance_info` como mock declarado, porque dejaría una respuesta mitad Postgres mitad mock y rompería la frontera que hoy permite decir con precisión qué endpoint sale de la base. A y B son irreversibles en direcciones opuestas; C no cierra ninguna puerta y deja modelar `balance` con el contexto de órdenes delante. |
| 1c | Sitio de `become-seller` | **Tabla singleton propia, NO fila en `settings`.** El inventario lo listaba como «candidato a fila en `settings`», pero la respuesta de `/api/settings` está congelada byte a byte (5503 B) y `page_options` la haría crecer. Se copia el patrón de `settings` (`id smallint PRIMARY KEY DEFAULT 1` + CHECK de fila única), no su fila. |
| 2 | DDL del épico | **Todo en US-41, un solo `just db-reset`.** Precedente de los Épicos 19, 26 y 33: este repo no tiene migraciones incrementales, así que el esquema completo se diseña antes de la primera línea de servicio. |
| 3 | `just db-reset` | **AUTORIZADO por el dueño el 2026-09-15**, renovando la del 2026-09-14 que cubría explícitamente **solo US-32 y US-34** (decisión 6 del Épico 33) y que no es heredable, igual que la decisión 1 del Épico 26 declaró no heredable la del 2026-08-31. Cubre **US-41**, la única del épico que toca DDL. Un DDL, un reset, por US. **US-41 desbloqueada.** |
| 4 | Repositorios y tests | Van **con su US consumidora** (US-42..44), no en la habilitadora. Patrón de los Épicos 26 y 33 (P-2 de US-34): baja US-41 a ~1200 LOC y evita el cuello de botella. |
| 5 | Política de reloj | Las tablas nuevas **NO llevan trigger**: `updatedAt: now()` desde `packages/db/src/clock.ts` en cada ruta de escritura. Política fijada por US-32 y especificada en `openspec/specs/data-layer-clock-policy/spec.md`. |
| 6 | Ruta `transfer-shop-ownership` | Decía «se resuelve dentro de US-43». **Revisada el 2026-09-15 al aplazar US-43**: el defecto (constante declarada en el admin, ruta inexistente en la API) es independiente de `balance`, así que no debe irse a la Fase 3 con ella. Queda **sin dueño asignado**: candidata a US standalone pequeña, o a resolverse de paso en US-42, que ya toca `shops`. Ver D-3 y R-1. |

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

**D-2 — La relación staff↔tienda es N:M, y el pivote va SIN columna de rol.**
Un usuario puede ser staff de varias tiendas y una tienda tiene varios staff.
Pivote con PK compuesta y FKs `ON DELETE CASCADE`, patrón de `permission_user`
(`db/schema.sql:173-178`). El `users.permissions` existente **no** lo
sustituye: es global al usuario, no por tienda.

Esta D-2 decía «con rol» hasta el 2026-09-15. Al ejecutar US-41 se verificó
que **ningún consumidor lo pide** (`GetStaffsDto` devuelve `UserPaginator`; el
`AddStaffInput` del admin es `{email, password, name, shop_id}`; `StaffList`
pinta solo name/email/is_active; `users` no tiene `shop_id`), así que el
pivote se implementó bare. Añadir el rol es un requisito nuevo y cuesta otro
`db-reset`; no se hereda como supuesto.

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

**R-1 — `balance` bloquea más de lo previsto: dos de los cuatro dominios.**
No solo `withdraws` (5 rutas, consumidas por `data/withdraw.ts` →
`pages/withdraws/*` y `dashboard/admin.tsx`), sino también
`ownership-transfer` (5 rutas), cuyo contrato embebe una fila de balance
completa — ver decisión 1b y [US-43](./43-ownership-transfer-postgres.md).
Verificado: la tabla `shops` **no** tiene columna `balance`; es un objeto
anidado de la entidad
(`apps/api/rest/src/shops/entities/shop.entity.ts:14,27,33`).

Consecuencia honesta, **asumida a propósito** (decisión 1b'): este épico
**no deja «identidad extendida» completa**. Entrega `staffs` y
`become-seller` (10 rutas de 20); las otras 10 —`ownership-transfer` y
`withdraws`— siguen mock hasta que la Fase 3 decida sobre wallets. No es un
descuido ni un recorte por coste: es la opción que no compromete el modelado
de `balance` antes de tener delante órdenes y reembolsos, que son los que dan
forma a `total_earnings` y `withdrawn_amount`.

**Suelto que sobrevive al aplazamiento:** la ruta `transfer-shop-ownership`
(D-3) está declarada en `apps/admin/rest/src/data/client/api-endpoints.ts:102`
y **no existe en la API**. Ese defecto es independiente de `balance` y se
resolvía «dentro de US-43» (decisión 6). Con US-43 fuera del épico, queda
huérfano: o se retira la constante, o se crea la ruta con evidencia de
consumidor — en ambos casos, trabajo pequeño que no tiene por qué esperar a
la Fase 3.

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
