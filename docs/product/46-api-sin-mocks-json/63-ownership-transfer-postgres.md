# US-63 — `ownership-transfer` y `transfer-shop-ownership` desde Postgres

> Las transferencias de propiedad de tienda pasan a la tabla
> `ownership_transfers`, sembrada con las 6 filas del mock. Su
> `balance_info` se guarda como foto histórica en `jsonb` (D-5 del épico).
> Se siembran los 6 usuarios que el mock referencia y se crea `POST
> /transfer-shop-ownership`, que el admin llama y hoy da 404. Es la última
> US del épico: cierra con el `grep` que demuestra que solo quedan los mocks
> permanentes.

**Épico:** [Épico 46](./README.md)
**Fecha:** 2026-10-20
**Status:** Listo para ejecución
**Depende de:** [US-62](./62-withdraws-postgres.md). La dependencia es por
los archivos compartidos (R-2). En datos necesita el helper
`resolverUsuarioPorEmail` que extendió US-54 (D-4).
**LOC est.:** ~1500
**Reemplaza a:** [US-43](../40-identidad-extendida-postgres/43-ownership-transfer-postgres.md)
(Épico 40). Su análisis del bloqueo por `balance` se conserva allí. Esta US
corrige lo que la auditoría del 2026-10-20 encontró: los owners del mock no
existen en el seed, y `transfer-shop-ownership` **sí** tiene consumidor.

## Historia

**Como** super admin o dueño de tienda, **quiero** ver, consultar y cambiar
el estado de las solicitudes de transferencia de propiedad. **Como** super
admin, **quiero** transferir una tienda a otro vendedor desde el listado de
tiendas. **Para que** las pantallas `shop-transfer/*` y el modal de
transferencia del admin funcionen contra datos reales.

## Contexto — verificado en código (2026-10-20)

**Controlador**
(`apps/api/rest/src/ownership-transfer/ownership-transfer.controller.ts`):
`@Permissions(...ADMIN_AND_OWNER)` y `@Controller('ownership-transfer')`
(`:21-22`).

| Ruta | Líneas | Detalle |
|---|---|---|
| `POST /` | `:26-31` | DTO `CreateOwnershipTransferDto` = `PickType(['status'])` |
| `GET /` | `:33-36` | |
| `GET /:param` | `:38-44` | |
| `PUT /:id` | `:46-53` | `@Param('language')`, siempre `undefined` |
| `DELETE /:id` | `:55-58` | |

**Servicio** (`ownership-transfer.service.ts`, JSON en `:2`):

- `create` y `update` devuelven `[0]` (`:25-27`, `:59-61`).
- `findAll` (`:29-53`):
  - `limit` vale 10 por defecto;
  - Fuse con `keys: ['name']` (`:15-19`), pero **ninguna fila tiene
    `name`**: cualquier `search` deja `data` vacío, y el *fallback* de `:45-47`
    sirve las primeras `limit` filas con `total` 0;
  - la url está **copiada de otro módulo**: `` `/refund-policies?search=${search}&limit=${limit}` `` (`:48`).
- `getOwnershipTransfer` (`:55-57`) busca `p.name === param`, así que
  **siempre** devuelve `undefined`: 200 con cuerpo vacío.
- `remove` (`:63-65`) devuelve un string.

**Mock** (`ownership-transfer.json`, medido con `node -e`): 6 filas, ids
10, 9, 8, 7, 6 y 5 (**id DESC**).

- Claves en orden: `id, transaction_identifier, previous_owner,
  current_owner, message, created_by, status, order_info, balance_info,
  refund_info, withdrawal_info`.
- **No hay `created_at`/`updated_at`, ni `shop`, ni `shop_id`** en el nivel
  superior.

| id | transaction_identifier | previous_owner | current_owner | status |
|---|---|---|---|---|
| 10 | 2024-08-03-0001 | 48 `mack@gmail.com` | 49 `jack@gmail.com` | pending |
| 9 | 2024-08-01-0003 | 6 `admin@demo.com` | 51 `joel@joelmale.com` | pending |
| 8 | 2024-08-01-0002 | 53 `lamp@gmail.com` | 51 | pending |
| 7 | 2024-08-01-0001 | 6 | 51 | pending |
| 6 | 2024-07-25-0001 | 6 | 45 `demobook@gmail.com` | pending |
| 5 | 2024-07-19-0001 | 6 | 42 `shop@gmail.com` | pending |

- `created_by` vale `6` (número) en las 6 filas.
- `message`, `order_info`, `refund_info` y `withdrawal_info` son `null` en
  las 6.
- Los owners son objetos de **10 claves**: `id, name, email,
  email_verified_at (null), created_at, updated_at (ISO, 6 decimales),
  is_active (1), shop_id (null), email_verified (false), profile (null)`.
- `balance_info` es **idéntico en las 6** filas:
  `{id: 24, shop_id: 22, admin_commission_rate: 10, total_earnings: 0,
  withdrawn_amount: 0, current_balance: 0, payment_info: "<JSON como
  string>", created_at: "2024-07-26 03:47:01", updated_at: "2024-08-03
  16:19:21"}`. La tienda 22 no existe en el seed; no importa, porque es foto
  histórica (D-5).
- `OwnershipTransfer extends CoreEntity`
  (`entities/ownership-transfer.entity.ts`), pero el mock no trae
  timestamps de nivel superior, así que hoy no se emiten.

**Usuarios** (D-4 del épico): de los 7 ids, solo el 6 tiene equivalente en
el seed (`admin@demo.com` = usuario 3). Los 6 restantes (42, 45, 48, 49, 51
y 53) tienen emails propios sin colisión y **se siembran**. Hoy `users`
tiene 5 filas (US-54 añadió 4 y 5). Tras esta US tendrá **11**.

**Admin (consumidores):**

- `data/client/ownership-transfer.ts`:
  - `paginated` envía `searchJoin=and`, `shop_id`, paginación y
    `search=transaction_identifier:X`;
  - `get` hace `GET ownership-transfer/${transaction_identifier}` con
    `transaction_identifier`, `language`, `shop_id` y `request_view_type`
    en la query;
  - `update` (crud) hace `PUT ownership-transfer/${id}` con `{status}`;
  - `delete` (crud);
  - `approve`/`disapprove` hacen `POST ownership-transfer`, pero sus hooks
    (`useApprove/DisApproveOwnerTransferMutation`, `data/ownership-transfer.ts:199-230`)
    **no tienen ningún consumidor** (`grep` en `.tsx` vacío).
- Pantallas:
  - `pages/shop-transfer/index.tsx:33` y `pages/shop-transfer/vendor/index.tsx:40`
    (lista, `limit: 10`, `transaction_identifier: searchTerm`);
  - `pages/shop-transfer/vendor/[transaction_identifier]/index.tsx:23`
    (detalle);
  - `components/shop-transfer/templates/header.tsx` (cambio de estado vía
    `useUpdateOwnerTransferMutation`; condiciona botones a
    `balance_info.current_balance` en `:101`);
  - `components/ownership-transfer/ownership-transfer-delete-view.tsx`
    (borrar).
- **Vocabulario de estado**: `pending`, `processing`, `approved` y
  `rejected`, en minúscula (`components/shop-transfer/templates/header.tsx:21-31`).
- **`transfer-shop-ownership`**:
  - el admin la declara en `data/client/api-endpoints.ts:102` y la llama en
    `data/client/shop.ts:48-49` (`transferShopOwnership`) vía
    `useTransferShopOwnershipMutation` (`data/shop.ts:79-92`);
  - el consumidor es `components/shop/transfer-shop-ownership-view.tsx`,
    con payload `{...vendor, shop_id, vendor_id, message}`;
  - el vendedor sale de `useVendorsQuery` → `GET /vendors/list`, que lista
    usuarios con permiso `store_owner` (`users.service.ts:253-254`);
  - en el éxito, el toast lee `shop.owner?.name` de la respuesta;
  - **la API no tiene esa ruta**: 404 hoy.

## Línea base (paso 2 del Protocolo del épico)

```bash
API=http://localhost:9001/api
tok() { curl -s -X POST $API/token -H 'content-type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"demodemo\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).token'; }
ADMIN=$(tok admin@demo.com); OWNER=$(tok store_owner@demo.com); CUST=$(tok customer@demo.com)

curl -s -w '\n%{http_code}\n' -H "Authorization: Bearer $ADMIN" "$API/ownership-transfer?searchJoin=and&limit=10&page=1&language=en" > base-list.txt
curl -s -w '\n%{http_code}\n' -H "Authorization: Bearer $ADMIN" "$API/ownership-transfer?searchJoin=and&limit=10&search=transaction_identifier:2024-08-01-0002" > base-search.txt  # hoy fallback a 6 filas, total 0
curl -s -w '\n%{http_code}\n' -H "Authorization: Bearer $ADMIN" "$API/ownership-transfer/2024-08-03-0001?language=en&request_view_type=detail" > base-detail.txt  # hoy 200 vacío
curl -s -w '\n%{http_code}\n' -X POST -H "Authorization: Bearer $ADMIN" -H 'content-type: application/json' \
  -d '{"shop_id":"2","vendor_id":"3","message":"x"}' "$API/transfer-shop-ownership" > base-transfer.txt                     # hoy 404
curl -s -w '\n%{http_code}\n' -H "Authorization: Bearer $ADMIN" "$API/vendors/list?limit=30" > base-vendors.txt
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $CUST" "$API/ownership-transfer"                            # 403 hoy y después
```

## Tablas nuevas

`ownership_transfers`, con banner que explique D-5 (por qué `balance_info`
es `jsonb`):

| Columna | Restricción |
|---|---|
| `id` | `bigserial` PK |
| `transaction_identifier` | `text NOT NULL UNIQUE` |
| `shop_id` | `bigint NULL` FK → `shops(id)` `ON DELETE SET NULL`. El mock no lo trae, así que el seed pone `NULL` en las 6. Las filas nuevas de `transfer-shop-ownership` sí lo llevan. Índice. |
| `previous_owner_id` | `bigint NOT NULL` FK → `users(id)` `ON DELETE RESTRICT` (el historial no se pierde al borrar un usuario; mismo criterio que `shops.owner_id`). Índice. |
| `current_owner_id` | ídem |
| `created_by` | `bigint NOT NULL` FK → `users(id)` `ON DELETE RESTRICT`. Índice. |
| `message` | `text NULL` |
| `status` | `text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','approved','rejected'))` |
| `order_info`, `refund_info`, `withdrawal_info` | **`json NULL`** (no `jsonb`, misma razón que abajo) |
| `balance_info` | **`json NULL`, no `jsonb`**: foto del balance al crear la transferencia, verbatim. `payment_info` sigue siendo un **string** dentro del documento. Va en `json` porque `jsonb` reordena las claves y el orden de `balance_info` es contrato (D-1); `json` guarda el texto tal cual. |
| `created_at`, `updated_at` | `timestamptz NOT NULL DEFAULT now()`. Se usan en el orden y en la política de reloj, pero **no se emiten** (el mock no los trae, D-3) |

Además, `CHECK (previous_owner_id <> current_owner_id)`. Sin trigger (D-7).
No hay tabla de balances (decisión 4).

## Reglas del seed

1. **Usuarios.** Antes del bloque de transferencias, el generador recorre
   `previous_owner`/`current_owner` de las 6 filas con
   `resolverUsuarioPorEmail`:
   - `admin@demo.com` se resuelve al 3;
   - los otros 6 se siembran con el **id del mock**, el `name`, el `email`,
     `is_active` (`1` → `true`), `email_verified_at` (`null`),
     `created_at`/`updated_at` del snapshot (D-3) y `HASH_DEMO`.

   Permisos: `customer` (regla base de D-4) **más `store_owner`**, porque en
   el dominio del mock son dueños de tienda, y sin ese permiso no aparecen
   en `/vendors/list` ni se les puede transferir una tienda (V-6). Va
   declarado en el banner del bloque.
2. **`created_by`** se resuelve igual: el mock trae el id `6` sin objeto,
   así que se mapea **por la tabla de remapeo de D-4** (6 → 3). Un
   `created_by` sin entrada en esa tabla es error de generación.
3. **Transferencias**: ids preservados (5-10), `shop_id` NULL y
   `balance_info` verbatim con cast **`::json`**. El helper `json()` del
   generador emite `::jsonb`; usar o crear el hermano para `json` que
   introduce US-60, sin cambiar el existente. Los demás `*_info` van `NULL`.
   Sin `created_at` en el mock, el seed **los deriva del
   `transaction_identifier`** (`YYYY-MM-DD-NNNN` → `YYYY-MM-DD` 00:00 UTC),
   para que el orden temporal sea real y no un `now()` idéntico. Va
   declarado en el banner.
4. **Validación previa** (fallo con mensaje y sin escribir):
   - `transaction_identifier` único y con el formato `^\d{4}-\d{2}-\d{2}-\d{4}$`;
   - `status` dentro del CHECK;
   - owners resueltos y distintos entre sí;
   - emails de los usuarios nuevos sin colisión (case-insensitive) con el
     seed.
5. `setval` de `ownership_transfers_id_seq` y de `users_id_seq`
   (`max(id) = 53`). Conteos en cabecera y consola.

**Conteos esperados** (si US-54 dejó otra cifra, pegar la real con su
justificación):

- `users`: 11 (eran 5).
- `permission_user`: el previo más 12 (6 usuarios × 2 permisos).
- `ownership_transfers`: 6, con `created_by = 3` en las 6, `shop_id NULL` en
  las 6 y `status = 'pending'` en las 6.
- `previous_owner_id`: 3 aparece 4 veces; 48 y 53, una vez cada uno.
- `current_owner_id`: 51 aparece 3 veces; 49, 45 y 42, una vez cada uno.

## Rutas — hoy → después

| Ruta | Guard | Hoy | Después |
|---|---|---|---|
| `GET /ownership-transfer` | `ADMIN_AND_OWNER` (no cambia) | Fuse sobre `name` y *fallback* a 6 filas con `total` 0 | `search=transaction_identifier:X` filtra **exacto** (vía `parseSearch`). `shop_id` (query) filtra si viene. `ORDER BY created_at DESC, id DESC` (con el seed sale 10, 9, 8, 7, 6, 5, igual que el mock). `limit` 10 por defecto. Visibilidad: el `super_admin` ve todo; el `store_owner` solo filas donde es `previous_owner_id` o `current_owner_id` |
| `GET /ownership-transfer/:param` | `ADMIN_AND_OWNER` | siempre vacío | busca por **`transaction_identifier`**, como lo llama el admin. 404 si no existe o si no es visible para el dueño |
| `POST /ownership-transfer` | `ADMIN_AND_OWNER` | `[0]` | **solo `super_admin`** (en el método): crea una solicitud `pending` con `shop_id`, `previous_owner_id` (el dueño actual de la tienda, `findShopOwnerById`), `current_owner_id` (`vendor_id` del body), `message`, `created_by = user.sub`, `transaction_identifier` generado `YYYY-MM-DD-NNNN` (secuencial por día, dentro de la transacción) y `balance_info: null` (no hay balance que fotografiar). 201 |
| `PUT /ownership-transfer/:id` | `ADMIN_AND_OWNER` | `[0]` | **solo `super_admin`**: cambia `status` (400 si no está en el CHECK) y `message`, y fija `updatedAt: now()`. **No toca `shops`** (ver NO incluye). 404 si no existe |
| `DELETE /ownership-transfer/:id` | `ADMIN_AND_OWNER` | string | **solo `super_admin`**: borra y devuelve la fila. 404 si no existe |
| `POST /transfer-shop-ownership` **(nueva)** | `ADMIN_ONLY` | 404 | en **una transacción**: valida la tienda (`shop_id`), el vendedor (`vendor_id`, existe y tiene `store_owner`) y que sea distinto del dueño actual; cambia `shops.owner_id`; inserta una fila en `ownership_transfers` con `status = 'approved'`, `previous_owner_id` = dueño anterior y `created_by = user.sub`. Devuelve la **tienda** con `toShopDto` y `owner` poblado con `{id, name, email}` del nuevo dueño, que es lo que el toast lee. 400 si los datos no son válidos, 404 si la tienda no existe y 409 si el vendedor ya es el dueño |

Las escrituras pasan a `ADMIN_ONLY` por el mismo motivo que en US-62:
persistiendo, un dueño podría reasignarse tiendas. Es un endurecimiento
deliberado y declarado (V-5).

**Forma de cada fila** (en el orden del mock):

```
id, transaction_identifier, previous_owner, current_owner, message,
created_by, status, order_info, balance_info, refund_info, withdrawal_info
```

- `previous_owner`/`current_owner` se proyectan desde `users` (y su
  `profile`) en la forma de 10 claves del mock: `is_active` como `1/0`,
  `shop_id: null` y `email_verified = email_verified_at !== null`.
- `created_by` sale **número**.

## Divergencias declaradas (D-1 del épico)

| # | Qué cambia | Evidencia |
|---|---|---|
| V-1 | `created_by` pasa de `6` a `3` y `previous_owner` de las filas 9, 7, 6 y 5 pasa a ser el usuario 3 (`id: 3`, `name: "Jhon Doe"` del seed; en el mock era `Jhon Doe` con id 6). El resto de owners conserva id, nombre y email | deep-equal de `base-list.txt` contra después, excluyendo solo estas claves; listar cada diferencia |
| V-2 | Los timestamps de los owners salen del seed: los sembrados por esta US con el valor del mock y 3 decimales (`Date.toJSON`); el usuario 3, con los suyos | igual que V-1 |
| V-3 | `search=transaction_identifier:X` devuelve la fila exacta con `total: 1` (hoy *fallback* a 6 con `total: 0`) | `base-search.txt` vs después |
| V-4 | `GET /:transaction_identifier` devuelve la fila (hoy 200 vacío) | `base-detail.txt` vs después |
| V-5 | `POST`/`PUT`/`DELETE` pasan a `ADMIN_ONLY`; el dueño recibe 403 | `curl` con `$OWNER` → 403 exacto |
| V-6 | `/vendors/list` crece de 2 a **8** usuarios (1 y 3, más los 6 sembrados), porque los nuevos llevan `store_owner` | `base-vendors.txt` vs después (`total`) |
| V-7 | **Url del paginador: se corrige** el literal copiado `/refund-policies?search=…` a `/ownership-transfer?search=${search}&limit=${limit}`. Es la excepción explícita a la regla de preservar urls (D-1): no es una rareza del paginador, sino un enlace roto que apunta a otro recurso, y el admin sí lo sigue (`next_page_url` alimenta el *load more*) | `first_page_url` antes y después |
| V-8 | `transfer-shop-ownership` existe | `base-transfer.txt` (404) vs después (201/200) |

**Equivalencia exigida (todo lo demás):** orden de filas y de claves, tipos,
`balance_info` deep-equal con orden de claves (incluido `payment_info` como **string**),
`message`/`*_info` `null`, `status`, `transaction_identifier`, el paginador
con `per_page: "10"` string y sin `created_at`/`updated_at` de nivel
superior.

## Scope

**Incluye:**
- los 6 usuarios sembrados y sus 12 `permission_user`, extendiendo el
  generador vía `resolverUsuarioPorEmail`;
- DDL de `ownership_transfers`, bloque del generador y `seed.sql`;
- `just db-reset` y re-introspección (`OwnershipTransfer` con 3 relaciones
  con nombre hacia `User`, más la inversa en `Shop`);
- `OwnershipTransferRecord`;
- `packages/db/src/repositories/ownership-transfers.repository.ts`
  (`listOwnershipTransfers`, `findOwnershipTransferByIdentifier`,
  `createOwnershipTransfer`, `updateOwnershipTransfer`,
  `deleteOwnershipTransfer`, `transferShopOwnership`, este último en una
  `prisma.$transaction`) con su integration test;
- el barrel;
- las 5 rutas y la nueva;
- el servicio sin el import del JSON;
- spec de Jest;
- actualizar los asserts vivos que cuenten `users`, `permission_user` o
  `vendors` (R-3 del épico: diagnosticar cada uno y declararlo);
- `db/README.md`, `packages/db/README.md` y el Status de US-43;
- **la prueba de cierre del épico** (CA-7).

**NO incluye:**
- aplicar el cambio de dueño al aprobar una solicitud `pending` por `PUT`:
  hoy no hay flujo de aprobación con efecto, las 6 filas sembradas no
  tienen `shop_id`, y diseñarlo es una decisión de producto. Se anota;
- una tabla de balances o rellenar `balance_info` en las filas nuevas
  (decisión 4: queda `null`);
- `order_info`/`refund_info`/`withdrawal_info` calculados;
- los hooks `approve`/`disapprove` del admin (sin consumidor);
- notificaciones al vendedor;
- frontend.

## Criterios de aceptación

### CA-1 — Seed de usuarios y transferencias
Tras `just db-reset` se cumplen todos los conteos esperados de las reglas
del seed y hay 0 huérfanas en las 4 FK. Los 6 usuarios nuevos inician
sesión con `demodemo`: `POST /api/token` con `jack@gmail.com` da 200 y
`permissions` contiene `store_owner`.

### CA-2 — Lista equivalente
`GET /ownership-transfer?searchJoin=and&limit=10&page=1&language=en` con
admin es deep-equal a la línea base, salvo V-1, V-2 y V-7. `balance_info`
es deep-equal en las 6 filas.

### CA-3 — Búsqueda, detalle y visibilidad
- La búsqueda por `transaction_identifier` devuelve 1 fila.
- El detalle por `transaction_identifier` devuelve la fila y un
  identificador inexistente da 404.
- Un `store_owner` centinela (`zz-transfer-owner`) que no participa en
  ninguna fila ve `data: []`.
- `jack@gmail.com` ve solo la fila 10.

### CA-4 — Escrituras de la solicitud
Con admin:
- `POST` crea una fila `pending` con un `transaction_identifier` del día.
- Dos `POST` el mismo día dan `-0001` y `-0002`.
- `PUT {status:'rejected'}` persiste y `updated_at` avanza.
- `PUT {status:'Rejected'}` da 400.
- `DELETE` borra y el detalle siguiente da 404.

Con el token del dueño, las tres rutas dan 403.

### CA-5 — `transfer-shop-ownership`
Con admin, `{shop_id: 2, vendor_id: 49, message}`:
- devuelve 200/201 con la tienda y `owner.name = 'jack'`;
- `shops.owner_id` de la tienda 2 pasa a 49;
- se inserta una fila `approved` con `previous_owner_id = 1` y
  `shop_id = 2`.

El integration test fuerza un fallo a mitad (por ejemplo, un
`vendor_id` sin `store_owner`) y comprueba que **ni** `shops` **ni**
`ownership_transfers` cambiaron. Un `vendor_id` igual al dueño da 409.
Después se restaura `owner_id = 1` y se borra la fila creada.

### CA-6 — Sin regresión
Verdes con recuento pegado: `just db-check`, `npx jest`, `just build-api` y
`just verify`. Los asserts de conteo que cambiaron se listan con su causa.
`GET /shops` sigue emitiendo 16 claves por tienda.

### CA-7 — Cierre del épico: solo quedan los mocks permanentes
Pegar la salida de:

```bash
cd apps/api/rest/src
grep -rlnE "from '@db/|db/pickbazar/|\.json'" --include=*.ts . | grep -v "\.spec\.ts" | sort
```

Solo pueden aparecer (decisión 2 del épico):

- archivos de `payment-intent/`, `payment-method/`, `authors/`,
  `flash-sale/` y `payment/`;
- `orders/orders.service.ts`, **solo** por sus imports de
  `payment-intent.json` y `payment-gateway.json`, que son el mock permanente
  de pasarela que US-59 conserva. Para comprobarlo, pegar además
  `grep -nE "from '@db/" orders/orders.service.ts`: no debe listar otro
  JSON. Cualquier
otro archivo es un mock no declarado y bloquea el cierre: se reporta, no se
arregla aquí. Si aparece un `.json` que no es mock (por ejemplo, un
`import` de `package.json`), se justifica en el reporte.

## Escenarios Gherkin

```gherkin
Feature: Transferencias de propiedad de tienda desde Postgres
  Scenario: CA-2 — la lista conserva la foto del balance
    Given el seed con las 6 transferencias del mock
    When admin hace GET /api/ownership-transfer?limit=10
    Then recibe los ids 10, 9, 8, 7, 6 y 5 en ese orden
    And balance_info.payment_info es una cadena

  Scenario: CA-3 — detalle por identificador
    When admin hace GET /api/ownership-transfer/2024-08-03-0001
    Then previous_owner.email es "mack@gmail.com"
    And current_owner.email es "jack@gmail.com"

  Scenario: CA-5 — transferir una tienda es atomico
    Given la tienda 2 cuyo duenio es el usuario 1
    When admin hace POST /api/transfer-shop-ownership con vendor_id 49
    Then la tienda 2 pasa al usuario 49
    And existe una transferencia approved de 1 a 49 para la tienda 2

  Scenario: CA-5 — un vendedor invalido no deja cambios a medias
    When admin transfiere la tienda 2 a un usuario sin store_owner
    Then el status es 400
    And la tienda 2 sigue siendo del usuario 1
    And no se crea ninguna transferencia

  Scenario: CA-4 — el duenio no reasigna tiendas
    When store_owner hace PUT /api/ownership-transfer/10
    Then el status es 403
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---|---|
| `db/schema.sql` | tabla `ownership_transfers` + CHECK + índices + banner |
| `db/generate-seed.mjs` | 6 usuarios + 12 `permission_user` vía helper; bloque de transferencias; validaciones; `setval` de 2 secuencias; conteos |
| `db/seed.sql` | regenerado |
| `packages/db/prisma/schema.prisma` | `OwnershipTransfer` + renombres de todos los modelos; 3 relaciones con nombre en `User`; inversa en `Shop` |
| `packages/db/src/records.ts` | `OwnershipTransferRecord` + mapper |
| `packages/db/src/repositories/ownership-transfers.repository.ts` | nuevo |
| `packages/db/src/repositories/ownership-transfers.integration.test.ts` | nuevo (centinelas `zz-transfer-`; reloj con `_setNowProvider`) |
| `packages/db/index.ts` | exports |
| `apps/api/rest/src/ownership-transfer/ownership-transfer.service.ts` | contra `@safari/db`; fuera el JSON y Fuse |
| `apps/api/rest/src/ownership-transfer/ownership-transfer.controller.ts` | `@CurrentUser()`, `ADMIN_ONLY` en escrituras, controlador nuevo `transfer-shop-ownership` |
| `apps/api/rest/src/ownership-transfer/ownership-transfer.module.ts` | registrar el controlador nuevo |
| `apps/api/rest/src/ownership-transfer/ownership-transfer.service.spec.ts` | nuevo |
| Suites con asserts de conteo de `users`/`permission_user`/`vendors` | actualizar con diagnóstico |
| `db/README.md` (incluida la línea de conteos), `packages/db/README.md` | modelo, usuarios nuevos, record |
| `docs/product/40-identidad-extendida-postgres/43-ownership-transfer-postgres.md` | Status: «Reemplazada, implementada en US-63», si aún no lo dice |

## Definición de Done

Seguir los pasos 1-10 del **Protocolo de ejecución** del [README del
épico](./README.md) y pegar:

- [ ] La línea base (5 cuerpos más el 403) y su repetición después.
- [ ] El generador con los conteos nuevos, y una corrida fallida con un
      owner cuyo email choca con otro del seed en mayúsculas (copia del
      JSON, restaurada después).
- [ ] `just db-reset`.
- [ ] `psql`:
  ```sql
  SELECT count(*) FROM users;  SELECT count(*) FROM permission_user;
  SELECT id, transaction_identifier, previous_owner_id, current_owner_id, created_by, shop_id, status
    FROM ownership_transfers ORDER BY id DESC;
  SELECT count(*) FROM ownership_transfers t LEFT JOIN users u ON u.id=t.created_by WHERE u.id IS NULL;
  ```
- [ ] `prisma validate` y `migrate diff --exit-code` con `EXIT=0`.
- [ ] `just db-build`, `just db-check` y `npx jest` verdes, con recuentos.
- [ ] `just build-api` y `just verify` verdes.
- [ ] La comparación `node -e` de CA-2 y la evidencia de V-1..V-8.
- [ ] Los `curl` de CA-4 y CA-5 con status exacto, y la base restaurada
      al estado del seed.
- [ ] **La salida del `grep` de CA-7.**
- [ ] Status de la US, fila del épico y, si el resto de las US están
      implementadas, el Status del épico a `Completado`.

## Notas para el agente ejecutor

- **`resolverUsuarioPorEmail` ya existe** (US-51 lo creó y US-54 lo
  extendió para sembrar). Usarlo; no escribir otro. Si su firma no permite
  añadir `store_owner`, extenderla con un parámetro de permisos y
  documentarlo en el generador.
- **`balance_info` es histórico, no vivo.** No proyectarlo desde ninguna
  otra tabla ni validar `shop_id: 22` contra `shops`. Es la foto que trajo
  la demo.
- **`json`, no `jsonb`.** Con `json` el orden de claves de `balance_info`
  se conserva, así que el deep-equal de CA-2 es **con orden** también dentro
  de ese objeto; una diferencia es un defecto. Verificar que `schema.prisma`
  quedó con `@db.Json` tras el `db pull` y que el servicio no re-serializa
  el valor por un objeto intermedio.
- **Generar `transaction_identifier` dentro de la transacción**, con
  `SELECT … FOR UPDATE` o reintento ante P2002 sobre el UNIQUE. Dos `POST`
  concurrentes no pueden producir el mismo identificador.
- `transfer-shop-ownership` es la primera escritura de este repo que toca
  `shops.owner_id`. `UpdateShopInput` lo excluye a propósito (DD30-2,
  `shops.repository.ts:252-256`): **no** abrir ese campo en `updateShop`.
  Hacerlo en la función transaccional nueva del repositorio de
  transferencias.
- Si `just db-check` falla por un conteo de usuarios, diagnosticar primero:
  ¿el test cuenta el seed (dato esperado) o un comportamiento (regresión)?
  Solo en el primer caso se actualiza la cifra (R-3 del épico; regla 5 de
  `agent-behaviors`).
