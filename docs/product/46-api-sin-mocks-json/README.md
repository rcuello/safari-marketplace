# Épico 46 — API sin mocks JSON: los 19 controladores restantes desde Postgres

> Los 19 controladores de `apps/api/rest` que todavía leen
> `src/db/pickbazar/*.json` pasan a Postgres, sembrados con los registros de
> esos mismos JSON. Al cerrar, ningún servicio de la API importa un mock JSON
> salvo los 4 declarados permanentes. Cada US trae su DDL, su seed y su
> `db-reset`: se ejecuta de punta a punta sin esperar a una habilitadora.

**Fecha:** 2026-10-20
**Status:** Refinado

## Por qué este épico existe y qué reemplaza

El inventario de [`_backlog/api-mock-restante-dominio-transaccional.md`](../_backlog/api-mock-restante-dominio-transaccional.md)
partió la salida del mock en fases y el dueño congeló la Fase 3 hasta cerrar
la Fase 1. **El 2026-10-20 el dueño cambió ese plan**: un solo épico con todo
lo que aún sirve JSON (decisión 1). Este épico:

- **Absorbe el [Épico 33](../33-contenido-configuracion-postgres/README.md)**
  (Fase 1). Sus 8 módulos son aquí US-47..51. US-34 (la habilitadora con todo
  el DDL) queda **reemplazada**: con la decisión 3 cada US crea sus tablas.
  Su análisis de los JSON sigue siendo válido y se cita desde US-47..51.
- **Absorbe la Fase 3 entera**, incluida la herencia de la Fase 2:
  `withdraws` (US-62) y `ownership-transfer` (US-63, que reemplaza a
  [US-43](../40-identidad-extendida-postgres/43-ownership-transfer-postgres.md)).
- **No toca** el [Épico 40](../40-identidad-extendida-postgres/README.md):
  US-42 (`staffs`) sigue allí. No es un módulo con JSON, sino stubs dentro de
  `shops`/`users`.

Inventario verificado el 2026-10-20 con `grep` sobre los imports de JSON en
`apps/api/rest/src` y conteo de decoradores de ruta por controlador. Lo
completaron 4 auditorías de solo lectura, ruta a ruta y fila a fila, cuyos
hallazgos están volcados en cada US.

## Subdivisión en sub-historias

Orden de ejecución **estrictamente secuencial** (ver R-2): todas tocan
`db/schema.sql`, `db/generate-seed.mjs`, `schema.prisma`, `records.ts` y el
barrel.

| US | Título | Rutas | Tablas nuevas | Depende de | LOC est. | Status |
|----|--------|-------|---------------|------------|----------|--------|
| [US-47](./47-faqs-terms-postgres.md) | `faqs` y `terms-and-conditions` | 12 | `faqs`, `terms_and_conditions` | ninguna | ~1600 | ✅ Implementada (2026-10-20) |
| [US-48](./48-refund-policies-reasons-postgres.md) | `refund-policies` y `refund-reasons` | 10 | `refund_policies`, `refund_reasons` | US-47 | ~1300 | ✅ Implementada (2026-10-21) |
| [US-49](./49-taxes-shippings-postgres.md) | `taxes` y `shippings` | 10 | `taxes`, `shippings` | US-48 | ~1100 | ✅ Implementada (2026-10-21) |
| [US-50](./50-attributes-postgres.md) | `attributes` y sus valores | 5 | `attributes`, `attribute_values` | US-49 | ~1300 | ✅ Implementada (2026-10-21) |
| [US-51](./51-store-notices-postgres.md) | `store-notices` (N:M + lectura) | 5 (+1) | `store_notices` + 3 pivotes | US-50 | ~1900 | ✅ Implementada (2026-10-22) |
| [US-52](./52-coupons-postgres.md) | `coupons` y su verificación | 9 | `coupons` | US-51 | ~1500 | ✅ Implementada (2026-10-22) |
| [US-53](./53-wishlists-postgres.md) | `wishlists` y `my-wishlists` | 12 | `wishlists` | US-52 | ~1300 | ✅ Implementada (2026-10-22) |
| [US-54](./54-reviews-abuse-reports-postgres.md) | `reviews`, `abusive_reports` y `my-reports` | 11 | `reviews`, `abusive_reports` | US-53 | ~2000 | ✅ Implementada (2026-10-22) |
| [US-55](./55-questions-postgres.md) | `questions` y `my-questions` | 10 | `questions` | US-54 | ~1500 | ✅ Implementada (2026-10-22) |
| [US-56](./56-conversations-messages-postgres.md) | `conversations` y `messages` | 5 | `conversations`, `messages` | US-55 | ~1500 | ✅ Implementada (2026-10-22) |
| [US-57](./57-order-statuses-postgres.md) | `order-status` | 5 | `order_statuses` | US-56 | ~900 | ✅ Implementada (2026-10-23) |
| [US-58](./58-orders-lectura-postgres.md) | Órdenes: esquema, seed y lectura | 3 | `orders`, `order_products` | US-57 | ~2200 | ✅ Implementada (2026-10-23) |
| [US-59](./59-orders-escritura-checkout.md) | Órdenes: escritura y `checkout/verify` | 5 | — (única US sin DDL ni `db-reset`) | US-58 | ~1800 | ✅ Implementada (2026-10-23) |
| [US-60](./60-downloads-export-invoice.md) | `downloads`, export e invoice | 4 | `order_files` | US-59 | ~900 | ✅ Implementada (2026-10-23) |
| [US-61](./61-analytics-calculado.md) | `analytics` calculado desde Postgres | 4 | — (sin DDL) | US-60 | ~1100 | |
| [US-62](./62-withdraws-postgres.md) | `withdraws` | 5 (+1) | `withdraws` | US-61 | ~1100 | |
| [US-63](./63-ownership-transfer-postgres.md) | `ownership-transfer` + `transfer-shop-ownership` | 5 (+1) | `ownership_transfers` | US-62 | ~1500 | |

**Total: 17 US, 120 rutas migradas (+3 rutas nuevas que el frontend ya llama
y hoy dan 404), ~24 400 LOC estimadas.** Las cifras son suelo, no techo
(R-1).

Cuadre con las 141 rutas de los 23 controladores con JSON: 141 = 120
migradas + 1 que ya está en Postgres (`GET
/store-notices/getUsersToNotify`, que no se toca) + 20 de los 4 permanentes (`payment-method` 7, `authors` 6, `flash-sale`
6, `payment-intent` 1). Dentro de `orders`, solo la llamada a la pasarela de
`POST /orders/payment` sigue siendo mock declarado (US-59). Cada US recuenta
sus rutas contra el controlador real; no copia esta tabla.

## Refinamiento — Decisiones tomadas

| # | Tema | Decisión |
|---|------|----------|
| 1 | Alcance | **Todo lo que aún sirve JSON, salvo los 4 permanentes.** Decidido por el dueño el 2026-10-20. Revoca el congelamiento de la Fase 3 del 2026-09-14 y absorbe el Épico 33. |
| 2 | Mocks permanentes | **Siguen permanentes** (confirmado el 2026-10-20): `payment-intent`, `payment-method`, `authors`, `flash-sale`, y el servicio `payment/` (Stripe/PayPal). Quedan fuera. Ninguna US los toca. |
| 3 | Reparto del DDL | **Cada US trae su DDL, su bloque del generador, su seed y su `just db-reset`** (decidido por el dueño el 2026-10-20). Sustituye el precedente «todo el DDL en la habilitadora» de los Épicos 19/26/33/40. El coste aceptado es un reset y una re-introspección por US, y ejecución secuencial (R-2). |
| 4 | Exclusión de `db/schema.sql:13-16` | **Se levanta.** La decisión 1 la levanta por escrito para órdenes, reviews y el resto del dominio que este épico migra. Siguen fuera **carritos, direcciones y wallets/balances**: ningún mock JSON los respalda (`addresses` es un stub) y el contrato de `withdraws` no los embebe. US-47 reescribe la cabecera del archivo. |
| 5 | `just db-reset` | **Autorizado para las 17 US de este épico (2026-10-20)**: es la consecuencia directa de la decisión 3, que el dueño eligió sabiendo que cada US lleva su reset. El proyecto no está en producción y `db/schema.sql` es idempotente (`IF NOT EXISTS`). Vale solo para este épico, no se hereda. |
| 6 | Fuente de los registros | **Los JSON del mock son la fuente del seed** (pedido del dueño: «usa los datos de los mocks como registros»). Se preservan los ids. `db/generate-seed.mjs` los lee igual que hoy lee `products.json`. Por eso los JSON **se quedan en disco**: dejan de importarse en los servicios, pero siguen siendo la procedencia del seed. |

## Visión técnica compartida

### Decisiones de diseño (D-N)

**D-1 — Contrato: la forma se preserva, el comportamiento se corrige y se
declara.** Las auditorías demostraron que «byte a byte» y «migrar de verdad»
chocan. Hoy el mock:

- filtra mal: Fuse se queda solo con el último token de `search` y, si la
  página sale vacía, devuelve las primeras N filas con `total: 0`;
- devuelve la fila 0 o un 200 vacío ante ids desconocidos;
- no persiste nada: `POST`/`PUT` devuelven la fila `[0]`;
- no aísla por usuario: cualquier cliente logueado ve las 20 órdenes.

Reproducir eso en SQL sería migrar los bugs. La regla del épico:

- **Se preserva (CA de equivalencia):**
  - el conjunto y el **orden** de claves de cada objeto;
  - los tipos JSON de cada valor: números como números, `0/1` donde el mock
    emite enteros, cadenas como `"0.00"` donde el mock emite cadenas;
  - el orden de las filas;
  - las rarezas del paginador, que ya son precedente embarcado ("Decision A",
    `products.service.ts:270-285`): `per_page` como string cuando llega
    `limit`, `prev_page_url` repitiendo la página actual,
    `APP_URL=http://localhost:5000/api` y la `url` base de cada servicio,
    incluido el literal `search=undefined`.
- **Se corrige y se declara (CA de divergencia):**
  - los filtros se aplican de verdad, con lo que el frontend envía;
  - id o slug desconocido da **404** (precedente `tags.service.ts:108-110`);
  - las escrituras persisten y devuelven la fila real;
  - aislamiento por usuario donde la ruta es «mía» (`my-*`, órdenes de
    cliente);
  - se crean las rutas que el frontend llama y hoy dan 404.

  Cada divergencia va en una tabla «Divergencias declaradas» de su US, con la
  evidencia del antes y del después.

**D-2 — Prueba de equivalencia: línea base capturada del mock, no
recordada.** Antes de tocar el servicio, el agente levanta la API **recién
arrancada**. El mock muta su estado en memoria con cada `POST`, así que un
proceso ya usado contamina la línea base. Con la API así, hace `curl` de cada
`GET` del módulo, con las queries exactas que mandan el shop y el admin, y
guarda los cuerpos en su scratchpad. Al terminar repite los `curl` y compara
con `node -e` (`jq` no está instalado). La comparación es deep-equal
excluyendo solo las claves que la tabla de divergencias de la US nombra.

**D-3 — Timestamps: se siembran los del mock cuando existen.** Hoy el
generador nunca inserta `created_at`/`updated_at`: el helper `ts()` existe en
`db/generate-seed.mjs:48` y nadie lo usa. En este épico **sí se insertan**
cuando el JSON los trae, porque varios módulos los emiten (`refund-reasons`,
`taxes`, `shippings`) y porque en órdenes son dato de negocio.

Cuidado con el formato. `CoreEntity` ya aplica `@Type(() => Date)`, así que
varios mocks **ya emiten hoy 3 decimales** (`.000Z`), no 6, en el objeto de
nivel superior. Los objetos anidados sin `@Type` (por ejemplo `creator` y
`users[]` de `store-notices`) conservan los 6. La divergencia de decimales del
`CLAUDE.md` solo aplica donde la línea base muestre 6. Las
claves que el mock **omite** (`faqs`, `terms`, `refund-policies`, `coupons`,
`attributes` no emiten timestamps) se siguen omitiendo aunque la tabla tenga
la columna.

**D-4 — Identidad referenciada por el mock: se resuelve por email.** Los
mocks apuntan a usuarios que el seed no tiene. Los datos (`node -e`,
2026-10-20):

| id del mock | email | Dónde aparece | Resolución |
|---|---|---|---|
| 6 | `admin@demo.com` | `store-notices`, `orders.customer_id`, `conversations`, `messages`, `ownership-transfer.created_by`/owners | **remapeo a 3** (ya es `admin@demo.com` en el seed) |
| 4 | `customer2@demo.com` | 38 reviews, 14 questions | **se siembra** como usuario nuevo |
| 5 | `customer3@demo.com` | 27 reviews | **se siembra** |
| 42, 45, 48, 49, 51, 53 | `shop@gmail.com`, `demobook@gmail.com`, `mack@gmail.com`, `jack@gmail.com`, `joel@joelmale.com`, `lamp@gmail.com` | `ownership-transfer` | **se siembran** |

La regla, implementada una vez como helper del generador
(`resolverUsuarioPorEmail`) por la primera US que la necesita (US-51) y
extendida por US-54 para sembrar:

- si el email existe en el seed se usa ese id;
- si no existe, se siembra el usuario **con el id del mock**, el nombre del
  snapshot, la contraseña demo compartida (`HASH_DEMO`) y el permiso
  `customer`. Los 6 usuarios de `ownership-transfer` reciben además
  `store_owner`, porque son dueños o receptores de tiendas, y por eso
  `/vendors/list` pasa de 2 a 8 (US-63);
- un email vacío o duplicado detiene la generación.

Nunca se copia un id sin resolver: es la trampa que
`db/generate-seed.mjs:76-81` ya documenta.

Consecuencia que muerde: **`users` pasa de 3 a 5 filas en US-54 y a 11 en
US-63.** Los asserts vivos que cuentan usuarios (R-3) se actualizan en la
misma US que siembra.

**D-5 — Objetos embebidos: snapshot solo donde el dominio es histórico.**

- **Órdenes**: los productos de cada línea y el `customer` son un
  **documento histórico**. Una orden congela lo que se compró, a qué precio y
  a quién. Van como `json` (`order_products.product_snapshot`,
  `orders.customer_snapshot`). Es semántica de negocio, no un atajo.
- **`ownership-transfer.balance_info`**: es la foto del balance en el momento
  de la transferencia, así que va como `json` en `ownership_transfers`. Así
  la US no depende de una tabla de balances, que sigue fuera (decisión 4).
  Esto es distinto de la opción B rechazada el 2026-09-15: aquello era servir
  el campo desde el mock; esto es persistirlo.
- **Reviews, questions y wishlists**: el `product` embebido **no** es
  histórico, es un `with=product`. Se proyecta en vivo con el `toProductDto`
  ya migrado (`products.service.ts`). Divergencia declarada: el conjunto de
  claves pasa del snapshot Laravel de 41-42 claves al contrato de 20 de
  `/products`. El `user` embebido se proyecta desde `users`, en la forma
  mínima que el mock usa.

**Tipo de las columnas JSON: `json`, no `jsonb`, cuando el orden de claves es
contrato.** `jsonb` normaliza el orden de las claves (por longitud y luego
por bytes) y rompería la regla de D-1. Hay mocks que lo demuestran: el
`image` de los cupones 10 y 4 trae `{thumbnail, original, id}`. Por eso
todo snapshot, Attachment o documento que se reemite tal cual (`image`,
`photos`, `file`, `*_snapshot`, `*_info`, direcciones) va en `json`. `jsonb`
queda para lo que se consulta por dentro y no se reemite verbatim, que es el
precedente de `settings.options`.

**D-6 — `translated_languages` y `deleted_at` no son columnas.** Se emiten
como constante desde el servicio (`['en']`, `null`), precedente
`types.service.ts:29,39`. Se borra de verdad: no hay soft delete. La única
columna `text[]` de `translated_languages` sigue siendo la de `products`.

**D-7 — Política de reloj de US-32.** Ninguna tabla nueva lleva trigger.
Cada ruta de `update` fija `updatedAt: now()` desde
`packages/db/src/clock.ts`
(`openspec/specs/data-layer-clock-policy/spec.md`). El test del invariante
no detecta una ruta olvidada: la garantía es el inventario de rutas de cada
US.

**D-8 — Sin import huérfano al cerrar.** Cada US retira el `import` del JSON
de su servicio y de su controlador. Quedan fuera por la decisión 2, y son los únicos imports permitidos al
cierre:

- los módulos `payment-intent/`, `payment-method/`, `authors/`,
  `flash-sale/` y `payment/`;
- los imports de `payment-intent.json` y `payment-gateway.json` dentro de
  `orders/orders.service.ts`, que son la pasarela mock de `POST /orders` y
  `POST /orders/payment`.

La prueba de cierre del épico es un `grep` que solo devuelve esa lista (DoD
de US-63).

**D-9 — Patrón de implementación: el de `tags`, sin genéricos.**

- **Repositorio** de funciones planas en
  `packages/db/src/repositories/<agregado>.repository.ts`
  (`tags.repository.ts`): `list*` devuelve `{items, total}` con
  `Promise.all([findMany, count])`, `find*` devuelve `Record | null`, las
  escrituras pasan por `generateSlug` y `translateCatalogWriteError`.
- **Record** camelCase con su mapper `_to*Record` en `records.ts` (`_id`,
  `_dec`), exportado desde el barrel.
- **Servicio Nest** con su `to*Dto` en el orden de claves del mock y con el
  `paginate()` de Nest pasando el `limit` crudo (`tags.service.ts:59-88`).
  Mapeo de errores: conexión → 503, resto → 500, inexistente → 404,
  escrituras vía `toWriteHttpException`. Guarda `Number.isSafeInteger(id) &&
  id > 0` (US-31).
- **Tests**: spec de Jest con `@safari/db` mockeado (`tags.service.spec.ts`)
  y `*.integration.test.ts` de vitest contra la base sembrada, con
  centinelas `zz-<agregado>-` limpiados en `afterAll`.

No se crea un «repositorio genérico» (D-2 del Épico 26).

### Riesgos (R-N)

**R-1 — El sesgo de estimación está medido y es grande.** El Épico 26
desbordó su estimación ×2.0-×4.6; US-32 ×5. Las cifras de arriba parten de
los reales de US-44 (2 rutas, ~500 LOC) y del Épico 26 (2 agregados, ~1500).
**Partir en PRs** (cadena `corte 1/2`, `corte 2/2`, precedente US-44)
cualquier US que pase de ~1500 líneas reales: corte 1 = DDL + seed + capa de
datos, corte 2 = servicio Nest.

**R-2 — Secuencialidad obligatoria.** La decisión 3 elimina la habilitadora,
pero no elimina los archivos compartidos. Cada US edita `db/schema.sql`,
`db/generate-seed.mjs`, `db/seed.sql`, `schema.prisma` (re-introspección que
**pisa los renombres** de los modelos previos), `records.ts` y
`packages/db/index.ts`. **Nunca dos agentes a la vez.** El orden de la tabla
también respeta las dependencias de datos: US-58 necesita los usuarios y
cupones ya sembrados, US-59 necesita `taxes`/`shippings`/`coupons`, y US-61
necesita órdenes y reviews.

**R-3 — Los conteos del seed son asserts vivos.** Hoy: `shops` 12
(`max(id)=15`), `users` 3, `categories` 198, 1200 productos,
`permission_user` 6, `manufacturers` 14, `tags` 10. US-54 y US-63 cambian
`users` (D-4) y `permission_user`. Esas US actualizan los asserts que fallen
**diagnosticando cada uno**: es un cambio de dato esperado, no un test roto
que se reescribe a ciegas.

**R-4 — La API mock muta en memoria.** `POST /orders`, `POST
/orders/payment`, `approve-coupon`, `approve-terms…` y `wishlists/toggle`
mutan los arrays importados. Una línea base capturada después de una
escritura es falsa: D-2 exige arrancar la API en limpio.

**R-5 — Correcciones de seguridad incluidas a propósito.** `GET /orders`
devuelve todas las órdenes a cualquier cliente logueado y `my-questions` no
filtra por usuario. Arreglarlo es una divergencia de contrato, **intencionada
y declarada** (D-1). No se negocia en la US.

**R-6 — Guards existentes: no se tocan.** Hay dos casos conocidos:

- `store-notices` es `ADMIN_AND_OWNER` aunque el shop lo llama, así que los
  clientes reciben 403.
- `attributes` es `ADMIN_ONLY` aunque el admin lo usa en
  `pages/[shop]/attributes`, así que un `store_owner` recibe 403.

**Excepción declarada:** US-62 (`withdraws`) y US-63 (`ownership-transfer`)
pasan sus rutas de **aprobación y transferencia** de `ADMIN_AND_OWNER` a
`ADMIN_ONLY`. Mientras eran mock no importaba; en cuanto persisten, un dueño
podría aprobarse sus propios retiros o reasignarse tiendas. Es una
corrección de seguridad de la misma clase que R-5. Cada una de las dos US
la justifica en su tabla de divergencias.
Cambiar un guard es una decisión de autorización, no de migración: cada US
lo anota en su reporte y no lo cambia.

**R-7 — `prisma db pull` es lo más frágil de cada US.** Con 17
re-introspecciones seguidas, el riesgo de perder un renombre se multiplica.
Cada US cierra con `prisma validate` + `prisma migrate diff --exit-code` en
`EXIT=0` y con `just db-build` + `npx jest` verdes: el `dist/` construido es
lo que detecta un renombre perdido.

## Protocolo de ejecución de una US de este épico

Toda US de este épico sigue estos pasos. La US solo especifica qué cambia en
cada uno.

1. **Leer**: la US, este README, `CLAUDE.md`, `db/README.md` y
   `packages/db/README.md`. Si la US contradice el código, parar y
   preguntar.
2. **Línea base (D-2)**: `just db-up`, `just api-dev` recién arrancada, los
   `curl` de la sección «Línea base» de la US, y guardar los cuerpos en el
   scratchpad.
3. **DDL** (los pasos 3 a 6 no aplican a US-59 ni a US-61, que no crean
   tablas): añadir las tablas de la US a `db/schema.sql` en el estilo del
   archivo (banner por tabla, `bigserial`, CHECK en línea, FK con índice,
   sin triggers). Ninguna sentencia previa cambia.
4. **Seed**: añadir el bloque al generador **después** de las tablas de las
   que depende, con validación previa (el generador falla con mensaje y no
   escribe SQL inaplicable), ids preservados, `ON CONFLICT DO NOTHING`,
   `setval` de cada secuencia nueva y los conteos nuevos en cabecera y
   consola. Después, `just db-seed-generate`.
5. **`just db-reset`** (autorizado, decisión 5).
6. **Introspección**: `cd packages/db && npx prisma db pull`, re-aplicar los
   renombres de **todos** los modelos (los previos también), nombrar los
   nuevos, conservar el preview `partialIndexes` y añadir las CHECK nuevas a
   la cabecera «lo que Prisma no modela». Cerrar con `npx prisma validate` y
   `npx prisma migrate diff --from-config-datasource --to-schema
   ./prisma/schema.prisma --exit-code` en `EXIT=0`.
7. **Capa de datos**: records, repositorio, barrel e integration test (D-9).
   Después, `just db-build`.
8. **Servicio Nest**: reescribir el servicio contra `@safari/db`, retirar el
   import del JSON (D-8) y escribir el spec de Jest.
9. **Verificar y pegar la salida**:
   - conteos del seed por `psql`, más 0 huérfanas por cada FK nueva;
   - `just db-check`;
   - `cd apps/api/rest && npx jest`;
   - `just build-api`;
   - `just verify` (`/api/settings` en 5503 B);
   - los `curl` de después y la comparación `node -e` contra la línea base,
     más cada divergencia declarada con su evidencia;
   - los `curl` de escritura con Bearer y status exacto.
10. **Documentar**: el modelo nuevo en `db/README.md`, los records en
    `packages/db/README.md`, el Status de la US y su fila en esta tabla.

**Tokens para los `curl`**: `POST /api/token` con `admin@demo.com` /
`demodemo` (super_admin), `store_owner@demo.com` (dueño de las tiendas) o
`customer@demo.com` (cliente). Todo `curl` de una ruta protegida lleva
Bearer y comprueba el status **exacto** (trampa heredada de US-31: un 401
satisface «4xx» sin ejecutar nada).

## Notas globales para los agentes

- 1 US = 1 sesión de agente. Lo que el «NO incluye» excluye no se
  implementa aunque sea adyacente: se menciona en el reporte final.
- Los 9 módulos stub sin JSON (`addresses`, `ai`, `feedbacks`, `imports`,
  `newsletters`, `notify-logs`, `refunds`, `uploads`, `web-hook`) **no son
  de este épico**: no hay mock que quitar.
- **Windows**: vitest da «0 tests» si el cwd tiene la unidad en minúscula
  (`just db-check` lo normaliza). `jq` no existe, así que se usa `node -e`.
- Si una US cambia el conteo de jest o de vitest, se pega el nuevo. El
  número no se copia de `CLAUDE.md`.
