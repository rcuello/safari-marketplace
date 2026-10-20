# US-60 — `downloads`, export e invoice desde Postgres

> Las descargas digitales del cliente pasan a leerse de una tabla
> `order_files`, sembrada con las 10 filas de `order-files.json` y filtrada
> por el cliente autenticado. Las dos URLs de export e invoice siguen siendo
> constantes, ahora declaradas en el servicio y no leídas de un JSON. Con
> esto, `orders.service.ts` deja de importar mocks.

**Épico:** [Épico 46](./README.md)
**Fecha:** 2026-10-20
**Status:** Listo para ejecución
**Depende de:** [US-59](./59-orders-escritura-checkout.md) (secuencial por
archivos compartidos, R-2 del épico; la FK `order_files.order_id → orders`
exige la tabla `orders` de US-58)
**LOC est.:** ~900

## Historia

**Como** cliente del shop, **quiero** ver solo mis productos digitales
comprados y descargar su archivo, **para que** la página de descargas
muestre datos reales y no los de todos los clientes.

**Como** admin/dueño, **quiero** que export e invoice sigan respondiendo
como hoy, **para que** el panel no se rompa aunque generar archivos reales
quede fuera de alcance.

## Contexto — verificado en código (2026-10-20)

**Controladores** (los tres en `apps/api/rest/src/orders/orders.controller.ts`):

- `OrderFilesController`, `@Controller('downloads')` (`:147-165`). No lleva
  `@Public`, así que pasan los guards globales `JwtAuthGuard` +
  `PermissionsGuard` (`app.module.ts:110-111`) y basta cualquier usuario con
  token.
  - `GET /api/downloads` (`:151-156`) con query `GetOrderFilesDto`
    (`orders/dto/get-downloads.dto.ts`): `orderBy`, `sortedBy` y paginación.
  - `POST /api/downloads/digital_file` (`:158-163`) con
    `@Body('digital_file_id', ParseIntPipe)`. El shop lo envía como **string**
    (`apps/shop/src/framework/rest/client/index.ts:368-372`); `ParseIntPipe`
    lo convierte.
- `OrderExportController`, `@Permissions(...ADMIN_AND_OWNER)` +
  `@Controller('export-order-url')` (`:167-176`): `GET /api/export-order-url`
  con `@Query('shop_id')`.
- `DownloadInvoiceController`, `@Permissions(...ADMIN_AND_OWNER)` +
  `@Controller('download-invoice-url')` (`:178-187`): `POST
  /api/download-invoice-url` con `@Body('shop_id')`.

**Servicio** (`orders/orders.service.ts`):

- Imports de JSON en `:1-3`: `order-export.json`, `order-files.json` y
  `order-invoice.json`. `plainToClass(OrderFiles, …)` en `:55`.
  `OrderFiles extends CoreEntity` (`orders/entities/order.entity.ts:73-80`).
  `CoreEntity` aplica `@Type(() => Date)` a `created_at`/`updated_at`, así
  que el `created_at` de nivel superior **ya sale hoy con 3 decimales**
  (`.000Z`). El `file` anidado no tiene `@Type` y sale tal cual del JSON, con
  6 decimales.
- `getOrderFileItems` (`:232-245`):
  - `limit` por defecto 30; `slice` sobre las 10 filas **sin filtrar por
    cliente**;
  - `url = '/downloads?&limit=${limit}'`;
  - `paginate(orderFiles.length, page, limit, results.length, url)`.

  `page` y `limit` llegan como string porque `ValidationPipe` va sin
  `transform` (`main.ts:9`), así que `per_page` sale como string cuando el
  cliente manda `limit`.
- `getDigitalFileDownloadUrl` (`:247-253`) hace `find` del **primer**
  `digital_file_id` igual y devuelve `item.file.url` como **string desnudo**.
  Si no existe, `item` es `undefined` y lanza TypeError, que llega como 500.
- `exportOrder` (`:255-257`) devuelve `exportOrderJson.url`.
  `downloadInvoiceUrl` (`:259-261`) devuelve `orderInvoiceJson[0].url`. Los
  dos ignoran `shop_id`.

**Mock** (medido con `node -e`):

- `order-files.json` tiene 10 filas, ids 1-10. Claves de nivel superior, en
  orden: `id, purchase_key, digital_file_id, order_id, customer_id,
  created_at, updated_at, file`.
  - `order_id` es `null` en las 10 y `customer_id` vale `2` en las 10
    (`customer@demo.com`, existe en el seed).
  - `purchase_key` es único (16 caracteres).
  - **`digital_file_id` se repite**: `42` en los ids 4, 5, 9 y 10; `2` en
    los ids 2 y 8. Los valores distintos son 76, 2, 56, 42, 23 y 62.
  - `file` es `{id, attachment_id, url, fileable_type, fileable_id,
    created_at, updated_at, fileable}`, polimórfico: id 1 es
    `Marvel\Database\Models\Variation` (fileable de 13 claves, producto
    936); los otros 9 son `…\Product` (33 claves; productos 888, 938, 924,
    905 y 944, todos en el seed).
- `order-export.json`:
  `{"url":"https://pickbazarlaravel.s3.ap-southeast-1.amazonaws.com/100/orders.xlsx"}`.
- `order-invoice.json`:
  `[{"order_id":1,"url":"https://pickbazarlaravel.s3.ap-southeast-1.amazonaws.com/100/invoice-order.pdf"}]`.
  La orden 1 no existe.

**Consumidores:**

- Shop:
  - `framework/rest/order.ts:138` `useDownloadableProducts` (infinite query
    sobre `current_page`/`last_page`), usado en
    `components/products/downloadable-products.tsx:33` con `limit: 10`;
  - `:291-310` `useGenerateDownloadableUrl` (`digital_file_id` string), en
    `downloadable-products.tsx:150`.
- Admin:
  - `data/client/export.ts`: **`GET export-order-url/${shop_id}`** cuando
    hay tienda. Es una ruta con path param que la API **no tiene**: con
    tienda da 404 hoy; sin tienda va a `export-order-url`. Lo usan
    `pages/orders/index.tsx:60` y `pages/orders/transaction.tsx:60`.
  - `data/client/order.ts:28-33` `downloadInvoice` (POST con `order_id`,
    `isRTL`, `language` y traducciones), en `pages/orders/[orderId]/index.tsx:58`.

## Línea base (paso 2 del Protocolo del épico)

API recién arrancada (`just api-dev`), sin ninguna escritura previa:

```bash
API=http://localhost:9001/api
tok() { curl -s -X POST $API/token -H 'content-type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"demodemo\"}" \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).token'; }
CUST=$(tok customer@demo.com); ADMIN=$(tok admin@demo.com); OWNER=$(tok store_owner@demo.com)

curl -s -w '\n%{http_code}\n' -H "Authorization: Bearer $CUST"  "$API/downloads?limit=10"            > base-downloads-cust.txt
curl -s -w '\n%{http_code}\n' -H "Authorization: Bearer $CUST"  "$API/downloads"                     > base-downloads-default.txt
curl -s -w '\n%{http_code}\n' -H "Authorization: Bearer $ADMIN" "$API/downloads?limit=10"            > base-downloads-admin.txt
curl -s -w '\n%{http_code}\n' -X POST -H "Authorization: Bearer $CUST" -H 'content-type: application/json' \
  -d '{"digital_file_id":"42"}' "$API/downloads/digital_file"                                         > base-digital-42.txt
curl -s -w '\n%{http_code}\n' -X POST -H "Authorization: Bearer $CUST" -H 'content-type: application/json' \
  -d '{"digital_file_id":"999"}' "$API/downloads/digital_file"                                        > base-digital-999.txt   # hoy 500
curl -s -w '\n%{http_code}\n' -H "Authorization: Bearer $OWNER" "$API/export-order-url?shop_id=1"     > base-export.txt
curl -s -w '\n%{http_code}\n' -X POST -H "Authorization: Bearer $OWNER" -H 'content-type: application/json' \
  -d '{"shop_id":"1","order_id":"48"}' "$API/download-invoice-url"                                    > base-invoice.txt
```

Guardarlos en el scratchpad de la sesión, no en el repo.

## Tablas nuevas

`order_files`, con banner en el estilo de `db/schema.sql`. Qué se pide, no
cómo:

| Columna | Restricción |
|---|---|
| `id` | `bigserial` PK |
| `purchase_key` | `text NOT NULL UNIQUE` |
| `digital_file_id` | `bigint NOT NULL`, **sin UNIQUE** (el mock lo repite y la búsqueda es «primer match»). Índice propio. |
| `order_id` | `bigint NULL` FK → `orders(id)` `ON DELETE SET NULL`. El mock lo trae `null` en las 10. Índice. |
| `customer_id` | `bigint NOT NULL` FK → `users(id)` `ON DELETE CASCADE` (la descarga pertenece al cliente). Índice. |
| `file` | **`json NOT NULL`, no `jsonb`**: snapshot del archivo con su `fileable` (D-5 del épico; el `file` es parte del documento histórico de la compra). Va en `json` porque `jsonb` reordena las claves (por longitud y luego bytes), y el orden de claves de `file`/`fileable` es parte del contrato (D-1). `json` guarda el texto tal cual. |
| `created_at`, `updated_at` | `timestamptz NOT NULL DEFAULT now()`, sembrados con los del mock (D-3) |

No hay tabla `digital_files` ni FK desde `digital_file_id`: ningún mock la
respalda y la US no la necesita. Sin trigger (D-7).

## Reglas del seed

- Bloque nuevo en `db/generate-seed.mjs`, **después** de `orders` (US-58) y
  `users`. Lee `order-files.json`.
- Ids preservados (1-10) y `created_at`/`updated_at` con el helper `ts()`.
  `file` va verbatim con el helper `json()`.
- Validación previa, con fallo con mensaje y sin escribir `seed.sql`:
  - todo `customer_id` resuelve a un usuario del seed (vía
    `resolverUsuarioPorEmail` si el mock trae email; aquí trae solo el id
    `2`, que ya existe);
  - todo `order_id` no nulo existe entre las órdenes sembradas;
  - `purchase_key` es único.
  - `file` va con `json()` en el generador, que escribe `::jsonb`: para
    esta columna el bloque debe castear a **`::json`**. Si el helper solo
    emite `::jsonb`, añadir uno hermano (`jsonTexto()`) en vez de cambiar el
    existente, que usan las tablas previas.
- `setval` de `order_files_id_seq`, y conteo en la cabecera y en consola.
- **Conteo esperado:** `order_files` 10; `customer_id = 2` en 10;
  `order_id IS NULL` en 10; `count(DISTINCT digital_file_id)` 6.

## Rutas — hoy → después

| Ruta | Guard (no cambia) | Hoy | Después |
|---|---|---|---|
| `GET /api/downloads` | token | las 10 filas para cualquiera, default `limit` 30 | `order_files` **del usuario del token** (`customer_id = user.sub`), `ORDER BY id ASC`, default `limit` 30, mismo `url` literal `/downloads?&limit=${limit}`, `paginate()` de Nest con el `limit` crudo |
| `POST /api/downloads/digital_file` | token | URL del primer `digital_file_id` igual; 500 si no existe | primer `order_files` (`ORDER BY id ASC`) con ese `digital_file_id` **y** `customer_id = user.sub`, y devuelve `file->>'url'` como string desnudo. **404** si no hay ninguno. |
| `GET /api/export-order-url` | `ADMIN_AND_OWNER` | `order-export.json`.url | constante `ORDER_EXPORT_URL` en el servicio, mismo valor |
| `POST /api/download-invoice-url` | `ADMIN_AND_OWNER` | `order-invoice.json[0]`.url | constante `ORDER_INVOICE_URL` en el servicio, mismo valor |

El aislamiento por cliente sigue el patrón ya embarcado en `GET /orders`
(`orders.controller.ts:47-61`, con `@CurrentUser()` y `user.sub`).
**Decisión:** las descargas son siempre del usuario del token, también para
el admin, que no compra. Es lo que pide la página «mis descargas» del shop,
la única que consume la ruta.

## Divergencias declaradas (D-1 del épico)

| # | Qué cambia | Evidencia exigida |
|---|---|---|
| V-1 | `GET /downloads` filtra por cliente: `customer@demo.com` sigue viendo las 10 filas (todas son suyas), pero `admin@demo.com` y `store_owner@demo.com` ven `data: []` y `total: 0` | `base-downloads-admin.txt` vs después; deep-equal de `base-downloads-cust.txt` contra después |
| V-2 | `digital_file` con id inexistente o ajeno da **404** en vez de 500 | `base-digital-999.txt` (500) vs después (404); `curl` con `$ADMIN` y `42` da 404 |
| V-3 | **No es divergencia, es garantía**: `file.*` sale verbatim de la columna `json`, con su orden de claves y valores, incluidos los timestamps anidados con 6 decimales | deep-equal **con orden** de `file` contra la línea base; cualquier diferencia es un defecto (p. ej. haber usado `jsonb` o re-serializar por un objeto intermedio que reordene) |
| V-4 | `created_at`/`updated_at` de nivel superior: mismo valor que el mock (sembrado) y 3 decimales, igual que hoy por `CoreEntity` | debe ser **idéntico** a la línea base; si no, es defecto, no divergencia |

**Mock permanente declarado:** `GET /export-order-url` y `POST
/download-invoice-url` devuelven URLs S3 constantes de la demo de Pickbazar.
No generan archivos. Esta US las mueve del JSON a dos constantes con un
comentario que lo declara. Se suman a la lista de mocks permanentes del
épico (decisión 2) en el reporte final.

## Scope

**Incluye:**
- DDL de `order_files`, bloque del generador y `seed.sql` regenerado;
- `just db-reset` y re-introspección (`OrderFile` en `schema.prisma`);
- `OrderFileRecord` en `records.ts`;
- `packages/db/src/repositories/order-files.repository.ts`
  (`listOrderFilesByCustomer`, `findFirstOrderFileByDigitalFileId`) con su
  `*.integration.test.ts`;
- el barrel;
- las 4 rutas en `orders.service.ts` / `orders.controller.ts`, retirando los
  3 imports de JSON de `:1-3` (D-8);
- tests de Jest;
- `db/README.md` y `packages/db/README.md`.

**NO incluye:**
- generar el Excel o el PDF de verdad;
- la ruta `export-order-url/:shop_id` que el admin llama y da 404: se anota
  en el reporte y **no se crea**, porque su respuesta sería otra URL
  constante y la decisión de exportar de verdad es aparte;
- `POST download/invoice` (`DOWNLOAD_INVOICE`, sin consumidor);
- crear filas de `order_files` al completar una orden (eso es la escritura
  de órdenes, US-59, y no se reabre);
- una tabla `digital_files`;
- `orderBy`/`sortedBy` de `GetOrderFilesDto` (hoy ignorados; siguen
  ignorados);
- frontend.

## Criterios de aceptación

### CA-1 — Seed de `order_files` con conteos exactos
Tras `just db-reset`: 10 filas, ids 1-10, `customer_id = 2` en todas,
`order_id` nulo en todas, 6 `digital_file_id` distintos, 0 huérfanas en
`customer_id` y `order_id`. Los conteos previos del seed quedan intactos.

### CA-2 — `GET /downloads` del cliente es equivalente a hoy
Con el token de `customer@demo.com` y `?limit=10`, el cuerpo es deep-equal
**con orden de claves** al de la línea base, `file` incluido (V-3). Eso
incluye `per_page: "10"` como string, `url` con `/downloads?&limit=10` y el
`created_at` de nivel superior idéntico. Sin `limit`, el default sigue
siendo 30.

### CA-3 — Aislamiento por cliente
Con el token de admin o de dueño, `GET /downloads` devuelve `data: []` y
`total: 0`. Hay un test de Jest que asegura que el repositorio se llama con
el `user.sub` del token y nunca con un `customer_id` de la query.

### CA-4 — `digital_file` resuelve el primer match y da 404 si no hay
`digital_file_id: "42"` con el token del cliente devuelve la `file.url` de
la fila id 4, el primer match por id, como string desnudo. `"999"` da 404.
`"42"` con el token de admin da 404.

### CA-5 — Export e invoice sin JSON
Las dos rutas devuelven exactamente la misma URL que la línea base, con el
mismo status. `grep -n "pickbazar\|@db/" apps/api/rest/src/orders/orders.service.ts`
no devuelve los 3 imports de `:1-3`. Si US-58/59 dejaron otros imports, que
no sean de este alcance, se listan en el reporte.

### CA-6 — Sin regresión
Verdes, con el recuento pegado: `just db-check`,
`cd apps/api/rest && npx jest`, `just build-api` y `just verify`
(`/api/settings` en 5503 B).

## Escenarios Gherkin

```gherkin
Feature: Descargas digitales desde Postgres
  Scenario: CA-2 — el cliente ve sus 10 descargas
    Given el seed de order_files con 10 filas de customer_id 2
    When customer@demo.com hace GET /api/downloads?limit=10
    Then recibe 10 filas en orden de id ascendente
    And per_page es la cadena "10"

  Scenario: CA-3 — otro usuario no ve descargas ajenas
    When admin@demo.com hace GET /api/downloads?limit=10
    Then recibe data vacia y total 0

  Scenario: CA-4 — digital_file_id repetido devuelve el primero
    When customer@demo.com hace POST /api/downloads/digital_file con digital_file_id "42"
    Then recibe la url del archivo de la fila con id 4

  Scenario: CA-4 — digital_file_id inexistente
    When customer@demo.com hace POST /api/downloads/digital_file con digital_file_id "999"
    Then el status es 404

  Scenario: CA-5 — export sigue devolviendo la URL constante
    When store_owner@demo.com hace GET /api/export-order-url?shop_id=1
    Then el cuerpo es la URL orders.xlsx de la linea base
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---|---|
| `db/schema.sql` | tabla `order_files` + índices + banner |
| `db/generate-seed.mjs` | bloque `order_files` tras `orders`; validación; `setval`; conteos |
| `db/seed.sql` | regenerado |
| `packages/db/prisma/schema.prisma` | `OrderFile` por `db pull` + renombres de **todos** los modelos; relación inversa en `User` (y en `Order`) |
| `packages/db/src/records.ts` | `OrderFileRecord` + `_toOrderFileRecord` |
| `packages/db/src/repositories/order-files.repository.ts` | nuevo |
| `packages/db/src/repositories/order-files.integration.test.ts` | nuevo |
| `packages/db/index.ts` | exports |
| `apps/api/rest/src/orders/orders.service.ts` | 4 métodos contra `@safari/db`; constantes de export/invoice; fuera los 3 imports de JSON |
| `apps/api/rest/src/orders/orders.controller.ts` | `@CurrentUser()` en las 2 rutas de `downloads` |
| `apps/api/rest/src/orders/order-files.service.spec.ts` (o el spec de orders que exista) | tests |
| `db/README.md`, `packages/db/README.md` | modelo y record |

## Definición de Done

Seguir los pasos 1-10 del **Protocolo de ejecución** del [README del
épico](./README.md) y pegar:

- [ ] La línea base (los 7 archivos) y su repetición después.
- [ ] `node db/generate-seed.mjs` con los conteos nuevos en consola, y una
      corrida fallida pegada (con `customer_id` alterado a `999` en una copia
      del JSON, restaurada después).
- [ ] `just db-reset` sin errores.
- [ ] `psql` con los conteos de CA-1 y las 0 huérfanas:
  ```sql
  SELECT count(*), count(*) FILTER (WHERE customer_id=2), count(*) FILTER (WHERE order_id IS NULL),
         count(DISTINCT digital_file_id) FROM order_files;
  SELECT count(*) FROM order_files f LEFT JOIN users u ON u.id=f.customer_id WHERE u.id IS NULL;
  ```
- [ ] `npx prisma validate` y `npx prisma migrate diff
      --from-config-datasource --to-schema ./prisma/schema.prisma
      --exit-code` con `EXIT=0`.
- [ ] `just db-build`, `just db-check` (recuento nuevo) y `npx jest`
      (recuento nuevo) verdes.
- [ ] `just build-api` y `just verify` verdes.
- [ ] Comparación `node -e` de CA-2 y las divergencias V-1..V-4 con su
      evidencia.
- [ ] Los `curl` de CA-4 y CA-5 con status exacto.
- [ ] Status de la US y fila del épico actualizados.

## Notas para el agente ejecutor

- **`json`, no `jsonb` (V-3).** `prisma db pull` introspecciona `json` como
  `Json`, igual que `jsonb`. Verificar en `schema.prisma` que la columna
  quedó como `@db.Json` y no se «normalizó» a `JsonB`. El servicio devuelve
  el valor de Prisma tal cual, sin `JSON.parse(JSON.stringify())` intermedio
  ni spread a otro objeto. El resto del repo usa `jsonb` para datos
  consultables (`shops.settings`); aquí el valor es un documento opaco y el
  orden es contrato, por eso la excepción.
- `digital_file_id` llega del shop como string; `ParseIntPipe` ya lo
  convierte. No quitar el pipe, y añadir la guarda `Number.isSafeInteger`
  (US-31) antes de consultar.
- El `url` del paginador conserva el literal `?&limit=` (sic). Es rareza
  preservada (D-1), no un error de esta US.
- Si al ejecutar `orders.service.ts` ya no existe (US-58/59 pudieron partir
  el servicio), aplicar los cambios donde vivan estos 4 métodos y anotarlo.
- `just db-test` está roto desde antes (US-6/US-8); no forma parte de la DoD.
