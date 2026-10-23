# US-57 — `order-status` desde Postgres

> Las 5 rutas de `order-status` dejan de servir `order-statuses.json` y leen
> una tabla con sus 10 registros. Además se corrige el cableado de `PUT` y
> `DELETE`, que hoy invocan el servicio de **órdenes** en vez del de
> estados.

**Épico:** [Épico 46](./README.md)
**Fecha:** 2026-10-20
**Status:** Implementada (2026-10-23, rama `us-57-order-statuses`)
**Depende de:** US-56. Sin dependencia de datos; el orden lo impone R-2 del
épico (archivos compartidos).
**LOC est.:** ~900

## Historia

**Como** administrador, **quiero** que el catálogo de estados de pedido viva
en la base y se pueda editar de verdad, **para** que crearlo, renombrarlo o
borrarlo persista, y para que `PUT /order-status/:id` deje de devolver una
**orden**.

## Contexto — verificado en código (2026-10-20)

**Rutas.** `@Controller('order-status')` vive en
`apps/api/rest/src/orders/orders.controller.ts:112-145` y comparte
`OrdersService`.

| Ruta | Guard | Qué hace hoy |
|---|---|---|
| `POST /api/order-status` | `ADMIN_ONLY` (`:116`) | `createOrderStatus` → `orderStatus[0]` (`orders.service.ts:224-226`); ignora el body (`CreateOrderStatusDto` = `name, color, serial, language`, `dto/create-order-status.dto.ts`) |
| `GET /api/order-status` | `@Public` (`:122`) | `getOrderStatuses` (`service:157-200`); detalle abajo |
| `GET /api/order-status/:param` | `@Public` (`:128`) | `find(p => p.slug === param)` (`:202-204`); `language` se ignora. Si no encuentra nada, devuelve `undefined`, que llega como 200 con cuerpo vacío |
| `PUT /api/order-status/:id` | `ADMIN_ONLY` (`:134`) | **Bug de cableado**: llama `ordersService.update(+id, UpdateOrderDto)` (`:137`), que devuelve `this.orders[0]`, **la orden 48** (`service:206-208`) |
| `DELETE /api/order-status/:id` | `ADMIN_ONLY` (`:140`) | **Bug de cableado**: llama `ordersService.remove(+id)` → `"This action removes a #id order"` (`:210-212`) |

Detalle de `GET /api/order-status` (`service:157-200`):

- `page` vale 1 por defecto y `limit` 30.
- `search` se parte en `;`/`:`, salta la clave `slug` y pasa a Fuse `$and`
  sobre `keys:['name']` con `threshold 0.3` (`:49-53`).
- El recorte se hace en memoria y la url es
  `/order-status?search=${search}&limit=${limit}`, con el literal
  `search=undefined` cuando no hay búsqueda.
- `orderBy` (enum `CREATED_AT|NAME|UPDATED_AT|SERIAL`,
  `dto/get-order-statuses.dto.ts`) se ignora.
- `updateOrderStatus` (`:228-230`) existe y ningún controlador lo usa.

Otros datos verificados:

- `ValidationPipe` no hace `transform` (`main.ts:9`): la query llega como
  strings y `per_page` se emite como string cuando el cliente envía `limit`.
  Esa rareza se preserva (D-1, precedente `tags.service.ts:83-86`).
- **Mock `order-statuses.json`, 10 filas.** Claves en orden: `id, name, slug,
  serial, color, created_at, updated_at, language, translated_languages`.
  - El archivo está ordenado por `serial`: ids 1-6, 8, 9, 10 y al final el
    **7 «Delivered», que tiene `serial 11`**. El serial 7 no existe.
    Ordenar por `serial` reproduce el archivo; ordenar por `id` no.
  - Los slugs son únicos (`order-received` … `delivered`). Los colores son
    `#23b848` en el id 1 y `#d87b64` en el resto.
  - `created_at` y `updated_at` traen 6 decimales en el JSON, pero
    `CoreEntity` aplica `@Type(() => Date)` (`common/entities/core.entity.ts`),
    así que **hoy ya se emiten con 3** (`.000Z`). El id 1 y el id 7 tienen
    `updated_at ≠ created_at`.
  - `language: "en"` y `translated_languages: ["en"]` en todas las filas.
- **Consumidores: ninguno en runtime.** El shop pinta los estados con una
  constante local (`apps/shop/src/lib/constants/order-status.ts:3`). El admin
  declara `ORDER_STATUS: 'order-status'` (`data/client/api-endpoints.ts:6`),
  pero ningún hook lo usa (lo confirma el inventario del backlog).
  **El módulo se migra por la decisión 1 del épico**: lee JSON. No hay un
  consumidor que lo pida.
- **No hay relación con `orders.order_status`.** Las órdenes usan el enum
  `OrderStatusType` (`order-pending`, `order-processing`,
  `order-completed`… en `orders/entities/order.entity.ts:18-28`), mientras
  este catálogo usa slugs como `order-received` o `delivered`. Solo
  `order-processing` coincide. Por eso US-58 **no** pone una FK de `orders`
  hacia esta tabla, y borrar un estado aquí no afecta a ninguna orden.

## Línea base (paso 2 del protocolo; API recién arrancada, R-4)

```bash
TOKEN_ADMIN=$(curl -s -X POST http://localhost:9001/api/token -H 'Content-Type: application/json' \
  -d '{"email":"admin@demo.com","password":"demodemo"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
B=$SCRATCH/us57/antes; mkdir -p $B
curl -s "http://localhost:9001/api/order-status" > $B/lista.json
curl -s "http://localhost:9001/api/order-status?limit=5&page=2" > $B/lista-p2.json
curl -s "http://localhost:9001/api/order-status/delivered" > $B/delivered.json
curl -s -o $B/inexistente.txt -w '%{http_code}\n' "http://localhost:9001/api/order-status/no-existe"   # 200 vacío hoy
curl -s -X PUT -H "Authorization: Bearer $TOKEN_ADMIN" -H 'Content-Type: application/json' \
  -d '{"name":"x"}' http://localhost:9001/api/order-status/1 | node -pe 'Object.keys(JSON.parse(require("fs").readFileSync(0))).slice(0,3)'
# → [ 'id', 'tracking_number', 'customer_id' ]: es una ORDEN (prueba del bug de cableado)
```

## Tabla nueva (paso 3)

**`order_statuses`**:

- `id bigserial PRIMARY KEY`, `name text NOT NULL`.
- `slug text NOT NULL UNIQUE`, como en el resto del esquema.
- `serial integer NOT NULL UNIQUE CHECK (serial > 0)`. Es la posición en
  el flujo, así que dos estados no pueden compartirla.
- `color text NOT NULL CHECK (color ~ '^#[0-9a-fA-F]{6}$')`. Las 10 filas
  del mock lo cumplen; el generador lo valida.
- `language text NOT NULL DEFAULT 'es'`. El seed copia el `'en'` del mock,
  como el resto del esquema.
- `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz
  NOT NULL DEFAULT now()`.
- Sin FK ni trigger (D-7). `translated_languages` no es columna (D-6).

## Reglas del seed (paso 4)

- **10 filas**, con los ids preservados (1-10) y `created_at`/`updated_at`
  **del mock** (D-3; hay que usar el helper `ts()`, que hoy nadie usa).
- Validación previa: slugs únicos, seriales únicos y colores con el formato
  de la CHECK. Si algo falla, la generación se detiene.
- `setval('order_statuses_id_seq', 10)`.

**Conteo esperado:** `order_statuses` 10. El resto de conteos queda intacto.

## Rutas: hoy → después

| Ruta | Hoy | Después |
|---|---|---|
| `GET /order-status` | Fuse sobre `name`, orden del archivo | `ORDER BY serial ASC, id ASC`. `search=name:<texto>` (o texto libre) filtra con `ILIKE '%texto%'` sobre `name`; `slug:` se ignora como hoy. Mismo default `limit` 30 y misma url. `orderBy=NAME\|SERIAL\|CREATED_AT\|UPDATED_AT` con `sortedBy` se respeta; sin él, el orden es por `serial`. |
| `GET /order-status/:param` | por slug; inexistente → 200 vacío | por slug; inexistente → **404** |
| `POST /order-status` | fila 0 | Inserta `{name, color, serial, language}` con slug generado por `generateSlug(name)`. **201** con la fila. Slug o serial repetido → **409**. Color inválido → **400**. |
| `PUT /order-status/:id` | devuelve la **orden** 48 | Actualiza el **estado** `:id` (campos del DTO; si cambia `name`, se regenera el slug como en `tags`) y fija `updatedAt: now()` desde `clock.ts`. Devuelve la fila. Inexistente → 404; id fuera de rango → 400 (guarda de US-31). |
| `DELETE /order-status/:id` | string de **orden** | Borra el estado y devuelve el snapshot previo al borrado (precedente `deleteTag`, `packages/db/src/repositories/tags.repository.ts:212-227`). Inexistente → 404. |

**Forma (D-1):** las claves van en el orden del mock. `translated_languages`
se emite como la constante `['en']`. `created_at` y `updated_at` son
`Date.toJSON()` (3 decimales, **igual que hoy**).

## Divergencias declaradas

| # | Dónde | Antes | Después | Por qué |
|---|---|---|---|---|
| V-1 | `PUT /order-status/:id` | devuelve la orden 48 | devuelve el estado actualizado | Bug de cableado (`orders.controller.ts:137`) |
| V-2 | `DELETE /order-status/:id` | `"This action removes a #id order"` | snapshot JSON del estado borrado | Bug de cableado (`:143`) |
| V-3 | `GET /order-status/:param` inexistente | 200 vacío | 404 | D-1, precedente `tags` |
| V-4 | `search` | Fuse difuso con `threshold 0.3` | `ILIKE` por subcadena | Filtro real (D-1). Para `search=name:Order`, comparar los dos conjuntos y pegarlos |
| V-5 | `POST` | fila 0 | fila creada, 201 | D-1 |

**Sin divergencia esperada en `GET /order-status` sin query ni en `GET
/order-status/delivered`.** Los timestamps ya se emiten hoy con 3 decimales
y el seed inserta los del mock, así que el deep-equal debe dar **igual sin
excluir ninguna clave**. Si no da igual, hay que diagnosticar antes de
declarar nada.

## Scope

**Incluye:**

- DDL de `order_statuses`, bloque del generador y seed.
- `just db-reset` y re-introspección: modelo `OrderStatus` y renombres
  previos re-aplicados.
- `OrderStatusRecord`, más `order-statuses.repository.ts` y su integration
  test.
- La parte de `OrdersService` que sirve estos estados, movida a un
  **`OrderStatusesService` propio** dentro de `apps/api/rest/src/orders/`.
  Solo así `PUT`/`DELETE` dejan de pasar por el servicio de órdenes.
- Su spec de Jest.
- Retirar de `orders.service.ts` el import de `order-statuses.json` y la
  instancia de Fuse de estados.

**NO incluye:**

- Tocar las rutas de `orders`, `downloads`, `export-order-url` o
  `download-invoice-url`, ni el resto de imports JSON de `orders.service.ts`
  (son US-58, US-59 y US-60).
- Una FK desde `orders.order_status`: son vocabularios distintos.
- Cambiar el enum `OrderStatusType`.
- Frontends.

## Criterios de aceptación

### CA-1 — Seed y esquema

Tras `just db-reset`:

- `order_statuses` tiene 10 filas.
- `SELECT id, serial FROM order_statuses ORDER BY serial` devuelve
  `1..6, 8, 9, 10, 7`, con el 7 en serial 11.
- Los `created_at`/`updated_at` son los del mock: el id 1 tiene
  `updated_at` 2021-03-08T21:34:04Z.
- Las CHECK de `color` y `serial` rechazan un insert inválido (`psql`
  pegado).
- `prisma validate` y `migrate diff --exit-code` dan `EXIT=0`.

### CA-2 — Lectura idéntica

Deep-equal **sin exclusiones** entre la línea base y el después para `GET
/order-status`, `GET /order-status?limit=5&page=2` y `GET
/order-status/delivered`. También se compara el tamaño en bytes.

### CA-3 — Escrituras sobre el agregado correcto

Con token de admin:

- `POST {"name":"CA-3 Estado","color":"#112233","serial":12,"language":"en"}`
  devuelve **201** con `slug: "ca-3-estado"`.
- `PUT /order-status/<id>` `{"name":"CA-3 Editado"}` devuelve el estado
  (no una orden) con el slug nuevo y un `updated_at` posterior.
- `DELETE` devuelve su snapshot, y el `GET` por slug siguiente da 404.
- `POST` con `serial: 1` da **409**.
- Sin token, `POST` da **401** exacto.

### CA-4 — Sin regresión

- `just db-check`, `npx jest`, `just build-api` y `just verify` en verde,
  con los recuentos.
- `grep -n "order-statuses.json" apps/api/rest/src -r` no devuelve nada.
- `GET /orders` sigue respondiendo como antes (esta US no lo toca): se pega
  su status y su `total`.

## Escenarios Gherkin

```gherkin
Feature: Catalogo de estados de pedido desde Postgres
  Scenario: CA-2 — la lista conserva el orden por serial
    Given los 10 estados sembrados
    When se pide GET /api/order-status
    Then el ultimo elemento es "delivered" con serial 11
    And el cuerpo es identico al de la linea base

  Scenario: CA-3/V-1 — editar un estado devuelve un estado
    Given el admin autenticado
    When envia PUT /api/order-status/1 con name "Recibido"
    Then la respuesta tiene la clave "serial" y no tiene "tracking_number"

  Scenario: CA-3 — serial repetido
    Given un estado con serial 1
    When el admin crea otro con serial 1
    Then la respuesta es 409

  Scenario: V-3 — slug inexistente
    When se pide GET /api/order-status/no-existe
    Then la respuesta es 404
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `db/schema.sql` | `order_statuses` con CHECK y banner |
| `db/generate-seed.mjs` | bloque de `order-statuses.json` con timestamps y validación; `setval` |
| `db/seed.sql` | regenerado |
| `packages/db/prisma/schema.prisma` | modelo `OrderStatus`; renombres previos re-aplicados |
| `packages/db/src/records.ts` | `OrderStatusRecord` |
| `packages/db/src/repositories/order-statuses.repository.ts` | nuevo: `listOrderStatuses`, `findOrderStatusBySlug`, `createOrderStatus`, `updateOrderStatus`, `deleteOrderStatus` |
| `packages/db/src/repositories/order-statuses.integration.test.ts` | nuevo |
| `packages/db/index.ts` | barrel |
| `apps/api/rest/src/orders/order-statuses.service.ts` | nuevo, contra `@safari/db` |
| `apps/api/rest/src/orders/order-statuses.service.spec.ts` | nuevo |
| `apps/api/rest/src/orders/orders.controller.ts` | `OrderStatusController` inyecta `OrderStatusesService`; `PUT` usa `UpdateOrderStatusDto` |
| `apps/api/rest/src/orders/orders.module.ts` | provider nuevo |
| `apps/api/rest/src/orders/orders.service.ts` | se retiran `order-statuses.json`, `fuse` de estados, `getOrderStatuses`, `getOrderStatus`, `createOrderStatus`, `updateOrderStatus` |
| `db/README.md`, `packages/db/README.md` | modelo y record |

## Definición de Done

Se sigue el Protocolo del [README del épico](./README.md#protocolo-de-ejecución-de-una-us-de-este-épico).

- [x] Línea base pegada, incluida la prueba del bug de cableado (el `PUT`
  devuelve claves de orden).
- [x] Generador con el conteo nuevo; `just db-reset` limpio; `psql` de CA-1.
- [x] `prisma validate` + `migrate diff --exit-code` → `EXIT=0`;
  `just db-build` limpio.
- [x] `just db-check` y `npx jest` en verde con los recuentos nuevos.
- [x] `just build-api` y `just verify` en verde (`/api/settings` 5503 B).
- [x] Deep-equal de CA-2 **sin exclusiones**, más los bytes antes y
  después.
- [x] `curl` de CA-3 con el status exacto; la fila de prueba queda borrada.
- [x] `grep` de CA-4.
- [x] Status actualizado y fila marcada en el épico.

## Notas para el agente ejecutor

- **Separar el servicio es parte del arreglo, no un refactor de paso**: el
  bug de V-1/V-2 existe porque los dos controladores comparten
  `OrdersService`. Mover las 4 funciones de estados a
  `OrderStatusesService` es el cambio mínimo que lo corrige.
- `UpdateOrderStatusDto` ya existe (`dto/create-order-status.dto.ts:190`);
  el `PUT` debe usarlo en vez de `UpdateOrderDto`.
- `orders.service.ts` sigue importando `orders.json`, `order-files.json`,
  etc. Es esperado: lo retiran US-58, US-59 y US-60.
- Si el deep-equal de CA-2 falla por los timestamps, hay que comprobar que el
  generador insertó los del mock (D-3) antes de declarar una divergencia:
  esta US no debería tener ninguna en la lectura.

## Evidencia (2026-10-23)

**Línea base**, con la API recién arrancada sobre `main` (`87d5b1e`):

```
 2542 lista.json         (10 filas; ids por serial 1..6, 8, 9, 10, 7:11; per_page 30 numérico)
 1460 lista-p2.json      (ids 6, 8, 9, 10, 7; per_page "5" string)
  202 delivered.json
  971 search-order.json  (search=name:Order → Order Received | Order Processing | Order Dispatched)
GET /order-status/no-existe: 200, 0 B
PUT /order-status/1 → [ 'id', 'tracking_number', 'customer_id' ]   ← es una ORDEN
DELETE /order-status/1 → "This action removes a #1 order" 200
GET /orders (admin): 200, total 20, data 15
```

**Seed.** `node db/generate-seed.mjs` termina con `… · 2 conversations · 5
messages · 10 order_statuses`. El generador valida slugs y seriales únicos,
el serial positivo y el color `#rrggbb` antes de emitir.

**CA-1** (`just db-reset` + `psql`):

```
 order_statuses = 10
 string_agg (id:serial ORDER BY serial) = 1:1 2:2 3:3 4:4 5:5 6:6 8:8 9:9 10:10 7:11
 id 1 | created 2021-03-08 21:33:52 | updated 2021-03-08 21:34:04   (UTC)
 id 7 | created 2021-03-13 15:04:26 | updated 2021-03-13 15:09:03
 conversations 2 · messages 5 · coupons 10 · reviews 85 · questions 68 · products 1200 · users 5

INSERT ... color 'rojo'
ERROR:  new row for relation "order_statuses" violates check constraint "order_statuses_color_check"
INSERT ... serial 0
ERROR:  new row for relation "order_statuses" violates check constraint "order_statuses_serial_check"
INSERT ... serial 1
ERROR:  duplicate key value violates unique constraint "order_statuses_serial_key"
```

```
$ npx prisma validate
The schema at prisma\schema.prisma is valid 🚀
$ npx prisma migrate diff --from-config-datasource --to-schema ./prisma/schema.prisma --exit-code
No difference detected.
EXIT=0
```

**CA-2**: deep-equal **sin exclusiones**, medido tras el `db-reset` final.

| Respuesta | Deep-equal | Bytes antes → después |
|---|---|---|
| `GET /order-status` | IGUAL | 2542 → 2542 (idénticos) |
| `GET /order-status?limit=5&page=2` | IGUAL | 1460 → 1460 (idénticos) |
| `GET /order-status/delivered` | IGUAL | 202 → 202 (idénticos) |
| `GET /order-status?search=name:Order` (V-4) | IGUAL | 971 → 971 (idénticos) |

V-4 queda declarada, pero con el seed no se nota: Fuse e `ILIKE` devuelven
los mismos tres estados para `name:Order`.

**CA-3** (token de admin):

| Llamada | Status | Resultado |
|---|---|---|
| `GET /order-status/no-existe` (V-3) | 404 | `No existe un estado de pedido con slug \`no-existe\`.` |
| `POST {"name":"CA-3 Estado","color":"#112233","serial":12,"language":"en"}` | 201 | id 15, `slug: "ca-3-estado"`, 9 claves |
| `PUT /order-status/15 {"name":"CA-3 Editado"}` (V-1) | 200 | `slug: "ca-3-editado"`, `updated_at` 13:46:36.818Z > `created_at` 13:46:34.712Z |
| `GET /order-status/ca-3-editado` · `/ca-3-estado` | 200 · 404 | el slug viejo deja de resolver |
| `DELETE /order-status/15` (V-2) | 200 | snapshot del estado borrado |
| `GET /order-status/ca-3-editado` tras borrar | 404 | |
| `POST` con `serial: 1` | 409 | ver nota sobre el mensaje |
| `POST` con `color: "rojo"` | 400 | `` `order_statuses.color` no admite `rojo` — CHECK order_statuses_color_check. `` |
| `POST` sin token | 401 | `Token de autenticación ausente o inválido.` |
| `PUT`/`DELETE` `999`, `abc`, `1e21` | 404 / 404 | ver nota sobre el id fuera de rango |
| `PUT /order-status/1 {"color":"#23b848"}` | 200 | claves de estado, `tracking_number` ausente |

El id 15 sale de la secuencia, que habían avanzado los inserts rechazados de
CA-1 y el integration test. La fila de prueba quedó borrada, y el `db-reset`
final devolvió la secuencia y el `updated_at` de la fila 1 al sembrado:
`count 10`, `max(updated_at) 2021-03-13 15:09:03+00`.

**CA-4:**

```
$ grep -rn "order-statuses.json" apps/api/rest/src
(sin salida, exit 1)
GET /orders (admin): status 200, total 20, data 15   ← igual que la línea base

$ just db-check
 Test Files  27 passed (27)
      Tests  361 passed (361)
$ cd apps/api/rest && npx jest
Test Suites: 29 passed, 29 total
Tests:       473 passed, 473 total
$ npx tsc --noEmit -p tsconfig.json   → exit 0
$ just build-api                      → Done in 69.05s
$ just verify
OK   API    :9001/api/settings  200  5503B  816ms
OK   Shop   :3003/en  200  190788B  1417ms  cards:30
OK   Admin  :3002/en/login  200  72821B  164ms  cards:1
```

Antes de esta US eran 26 archivos / 354 tests en `db-check` y 28 suites / 462
tests en jest: +1 integration test (7 casos) y +1 spec (11 casos).

**Notas frente al texto de la US:**

- **Slug al renombrar.** La US pedía regenerarlo «como en `tags`», pero
  `updateTag` (y cualquier otro `update*` del paquete) lo trata como
  inmutable. El dueño eligió lo que dice CA-3: el slug se recalcula sin
  contar la propia fila, así que renombrar al mismo nombre lo conserva.
- **Id fuera de rango: 404, no 400.** La tabla de rutas pedía 400 «por la
  guarda de US-31». Esa guarda da **404** para un id de ruta inválido (el
  400 es para FK del cuerpo), y así responden `tags` y `store-notices`. Se
  siguió el precedente.
- **Mensaje del 409 por serial repetido.** Dice «con el slug \`slug\`»:
  Prisma con `adapter-pg` no informa `meta.target`, y
  `translateCatalogWriteError` cae a `slug` por defecto. El status es el
  correcto; el texto es el caso que recoge US-67.
