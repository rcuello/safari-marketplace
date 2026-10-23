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
**Status:** ✅ Implementada (2026-10-23)
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

## Evidencia (2026-10-23)

**Línea base y después** (API recién arrancada; el antes, con el servicio
del mock):

```
archivo        antes                                   después
list           200 6143B  ids 10,9,8,7,6,5 total 6     200 7601B  ids 10,9,8,7,6,5 total 6 (CA-2)
search         200 6207B  data 6 total 0 (fallback)    200 1336B  data 1 total 1, id 8 (V-3)
detail         200    1B  vacío                        200  936B  id 10 mack@gmail.com -> jack@gmail.com (V-4)
transfer       404   92B  Cannot POST                  201, tienda 2 con owner jack (V-8; ver CA-5)
vendors        200 16374B data 2 (1,3)                 200 20730B data 8 (1,3,42,45,48,49,51,53) (V-6)
cliente GET /ownership-transfer: 403 antes y después
```

**Seed:**

```
$ node db/generate-seed.mjs
  … · 11 usuarios · … · 10 order_files · 2 withdraws · 6 ownership_transfers

# corrida fallida: previous_owner.email de la fila 10 cambiado a "CUSTOMER@DEMO.COM" (copia de respaldo)
El mock viola 1 restriccion(es) del esquema:
  - ownership_transfers 10.previous_owner: 'CUSTOMER@DEMO.COM' (id 48) choca con el usuario 2 del seed
exit=1
# JSON restaurado desde la copia: git diff vacío; seed.sql intacto (cmp)
```

Cómo se resolvieron los usuarios:

- `resolverUsuarioPorEmail` recibió un tercer parámetro opcional,
  `permisosExtra`, documentado en su contrato. Los 6 owners nuevos entran
  con `customer` y `store_owner`.
- `created_by` se resuelve con la tabla de remapeo de D-4, `REMAPEO_ID_MOCK
  = {6 → 3}`. Un `created_by` sin entrada en la tabla es error.
- Un owner cuyo email ya existe solo se acepta en dos casos: si su id del
  mock está en esa tabla y apunta a ese usuario, o si lo sembró una fila
  anterior del mismo bloque (el 51 aparece en 3 filas).

**CA-1** (`just db-reset` sin errores + `psql`):

```
 users 11 · permission_user 20 (8 previas + 12)
 id | transaction_identifier | previous_owner_id | current_owner_id | created_by | shop_id | status  |       created_at
 10 | 2024-08-03-0001        |                48 |               49 |          3 |         | pending | 2024-08-03 00:00:00+00
  9 | 2024-08-01-0003        |                 3 |               51 |          3 |         | pending | 2024-08-01 00:00:00+00
  8 | 2024-08-01-0002        |                53 |               51 |          3 |         | pending | 2024-08-01 00:00:00+00
  7 | 2024-08-01-0001        |                 3 |               51 |          3 |         | pending | 2024-08-01 00:00:00+00
  6 | 2024-07-25-0001        |                 3 |               45 |          3 |         | pending | 2024-07-25 00:00:00+00
  5 | 2024-07-19-0001        |                 3 |               42 |          3 |         | pending | 2024-07-19 00:00:00+00
 huérfanas: created_by 0 · previous_owner 0 · current_owner 0 · shop 0
 users_id_seq 53 · ownership_transfers_id_seq 10 · json_typeof(balance_info) = object
 42, 45, 48, 49, 51, 53 → customer,store_owner
POST /token jack@gmail.com → 201, permissions=customer,store_owner
```

CA-1 dice «da 200»: `POST /api/token` responde **201**, igual que con
cualquier usuario y que antes de esta US. Es el default de Nest para un
`@Post`, no un cambio.

```
$ npx prisma validate
The schema at prisma\schema.prisma is valid 🚀
$ npx prisma migrate diff --from-config-datasource --to-schema ./prisma/schema.prisma --exit-code
No difference detected.
EXIT=0
```

El modelo `OwnershipTransfer` tiene los 4 `*Info` como `Json? @db.Json` y
tres relaciones con nombre hacia `User`: `OwnershipTransferPreviousOwner`,
`OwnershipTransferCurrentOwner` y `OwnershipTransferCreator`. Sus inversas
son `transfersFrom`, `transfersTo` y `transfersCreated`, y en `Shop` está
`ownershipTransfers`. Los dos CHECK nuevos se añadieron a la cabecera.

**CA-2** (`node`, deep-equal recursivo con orden de claves de la lista contra
la línea base): 44 diferencias, **todas** dentro de V-1, V-2 y V-7, y
ninguna de conjunto u orden de claves:

```
data[0].previous_owner.created_at: "2024-07-26T03:45:11.000000Z" -> "2024-07-26T03:45:11.000Z"   (V-2, ×4 por fila en los owners sembrados)
data[0].created_by: 6 -> 3                                                                        (V-1, en las 6)
data[1].previous_owner.id: 6 -> 3                                                                 (V-1, filas 9, 7, 6 y 5)
data[1].previous_owner.email_verified_at: "2024-05-16T05:13:23.000000Z" -> "2023-11-12T10:59:14.000Z"
data[1].previous_owner.created_at/updated_at: "2024-05-16T05:13:23.000000Z" -> "2026-10-23T19:56:13.797Z"
data[1].previous_owner.profile: null -> {"id":3,"avatar":{…},"contact":"19365141641631",…,"customer_id":3,…}
first_page_url / last_page_url: ".../api/refund-policies?search=undefined&limit=10&page=1" -> ".../api/ownership-transfer?search=undefined&limit=10&page=1"   (V-7)
ids 10,9,8,7,6,5
balance_info texto idéntico (con orden) en las 6: true · payment_info string: true
```

El `previous_owner` de las filas 9, 7, 6 y 5 es ahora el usuario 3 del seed.
Su `name` y su `email` son los del mock (`Jhon Doe`, `admin@demo.com`); su
`email_verified_at`, sus timestamps y su `profile` (no nulo) son los del
seed. Todo eso entra en V-1. El resto es igual, `per_page: "10"` incluido.

**CA-3:**

```
200 GET ownership-transfer?limit=10&search=transaction_identifier:2024-08-01-0002 (admin) → 8 total 1
200 GET ownership-transfer?limit=10 (jack@gmail.com)                                     → 10 total 1
200 GET ownership-transfer?limit=10 (store_owner@demo.com, no participa en ninguna)      → total 0
200 GET ownership-transfer/2024-08-03-0001 (admin)  → 10 mack@gmail.com -> jack@gmail.com
404 GET ownership-transfer/2099-01-01-0001          → No existe una transferencia 2099-01-01-0001.
404 GET ownership-transfer/2024-08-01-0002 (jack)   → no participa en la fila 8
```

El dueño centinela `zz-transfer-owner` está en el integration test y recibe
`{items: [], total: 0}`.

**CA-4:**

```
201 POST ownership-transfer {"shop_id":"2","vendor_id":"49","message":"zz-transfer-curl"} → 21 2026-10-23-0001 pending prev 1 curr 49 by 3
201 POST ownership-transfer {"shop_id":"2","vendor_id":"49"}                              → 22 2026-10-23-0002 pending prev 1 curr 49 by 3
200 PUT ownership-transfer/21 {"status":"rejected"}  → rejected; updated_at 20:11:46.416 → 20:12:19.862
400 PUT ownership-transfer/21 {"status":"Rejected"}  → `ownership_transfers.status` no admite `Rejected` — CHECK ownership_transfers_status_check.
404 PUT ownership-transfer/999999                    → No existe un registro de `ownership_transfers` con id 999999.
403 POST / PUT ownership-transfer/10 / DELETE ownership-transfer/21 (dueño) → No tienes permisos suficientes para esta operación.
200 DELETE ownership-transfer/21 (admin)             → la fila borrada
404 GET ownership-transfer/2026-10-23-0001           → No existe una transferencia 2026-10-23-0001.
```

El integration test fija el reloj en 2030-05-05 y comprueba `-0001` y
`-0002`. También comprueba `SameOwnerError` (409) cuando el vendedor ya es
el dueño, y que una tienda o un vendedor inexistentes dan 400.

**CA-5:**

```
400 POST transfer-shop-ownership vendor_id 2 (sin store_owner) → `ownership_transfers.vendor_id` no admite `2` — CHECK store_owner.
409 POST transfer-shop-ownership vendor_id 1 (ya es el dueño)  → El usuario 1 ya es el dueño de la tienda 2.
404 POST transfer-shop-ownership shop_id 999999                → No existe un registro de `shops` con id 999999.
400 POST transfer-shop-ownership vendor_id "abc"               → `abc` no es un vendor_id.
tras los fallos: shops[2].owner_id=1 · transfers 6 -> 6
201 POST transfer-shop-ownership {"id":49,"name":"jack","shop_id":"2","vendor_id":"49","message":"zz-transfer-curl"}
    → shop 2 Clothing Shop owner_id 49 owner {"id":49,"name":"jack","email":"jack@gmail.com"} claves 16
shops[2].owner_id=49
23|2026-10-23-0001|2|1|49|3|approved|zz-transfer-curl
dueño y cliente POST transfer-shop-ownership → 403 / 403
cliente GET, GET /:id, POST, PUT, DELETE de ownership-transfer → 403 ×5
```

El integration test fuerza los cuatro fallos dentro de la transacción y
comprueba que ni `shops` ni `ownership_transfers` cambiaron; después
transfiere y restaura.

**Estado final de la base:** `UPDATE shops SET owner_id=1, updated_at=<el
original como texto>` y `DELETE` de la fila creada. Quedan 6
transferencias y la tienda 2 con dueño 1 y su `updated_at` original. Las
secuencias quedaron adelantadas por los tests y los `curl`.

**CA-6:**

```
$ just db-check
 Test Files  32 passed (32)
      Tests  396 passed (396)
$ cd apps/api/rest && npx jest
Test Suites: 34 passed, 34 total
Tests:       530 passed, 530 total
$ npx tsc --noEmit -p tsconfig.json   → exit 0
$ just build-api                      → Done in 92.73s.
$ just verify
OK   API    :9001/api/settings  200  5503B  527ms
OK   Shop   :3003/en  200  190788B  826ms  cards:30
OK   Admin  :3002/en/login  200  72821B  101ms  cards:1
GET /shops: 16 claves en las 12 tiendas
$ grep -rn "@db/" apps/api/rest/src/ownership-transfer/   → sin salida, exit=1
```

Antes (US-62): 31 archivos / 390 tests en `db-check` y 33 suites / 524 en
jest. Se suman el integration test (6 casos) y
`ownership-transfer.service.spec.ts` (6 casos).

**Incidencia en la primera corrida.** Encadené `db-check`, `jest`,
`build-api` y `verify` en un solo comando.

- `db-check` dio 4 fallos por **timeout de 5000 ms**, en `slug`,
  `categories` (2) y `order-files`. Ninguno es un archivo de esta US.
- `verify` dio la tienda en 500: el log del shop muestra `ECONNREFUSED`
  contra `:9001`, porque `build-api` reescribe `dist/` y la API en modo
  watch se reinicia.

Después, por separado, `verify` quedó verde y `db-check` dio 396/396 dos
veces seguidas. Lo atribuyo a la carga de la máquina, pero no lo demostré;
queda anotado junto al fallo intermitente de US-60.

**Asserts de conteo que cambiaron (R-3):**
`store-notices.integration.test.ts`, en dos casos:

- `all_vendor va a todos los store_owner` esperaba `[3, 1]`.
- `borra en cascada…` esperaba 2 destinatarios.

Diagnóstico: el test cuenta el seed, no un comportamiento. `all_vendor` va
a todos los `store_owner`, y ahora son 8 a propósito (V-6). Los dos asserts
leen la lista de `store_owner` de la base: el primero exige que sean 8 y
terminen en `[3, 1]`. Los demás asserts de usuarios no cambiaron.

**CA-7 — cierre del épico:**

```
$ cd apps/api/rest/src
$ grep -rlnE "from '@db/|db/pickbazar/|\.json'" --include=*.ts . | grep -v "\.spec\.ts" | sort
./authors/authors.service.ts
./flash-sale/flash-sale.service.ts
./orders/orders.service.ts
./payment/stripe-payment.service.ts
./payment-intent/payment-intent.controller.ts
./payment-intent/payment-intent.service.ts
./payment-method/payment-method.service.ts
$ grep -nE "from '@db/" orders/orders.service.ts
1:import paymentGatewayJson from '@db/payment-gateway.json';
2:import paymentIntentJson from '@db/payment-intent.json';
```

Solo aparecen los mocks permanentes de la decisión 2: `payment-intent/`,
`payment-method/`, `authors/`, `flash-sale/` y `payment/`, más
`orders.service.ts`, que solo importa la pasarela. No hay ningún mock sin
declarar.

**Decisiones de implementación:**

- `POST /ownership-transfer` lee el dueño anterior **dentro** de la
  transacción (`SELECT … FOR UPDATE` sobre la tienda) en vez de con
  `findShopOwnerById` antes. Es el mismo valor, sin la carrera entre leer y
  escribir. Si la tienda no existe da 400; si el vendedor ya es el dueño,
  409 (`SameOwnerError`, que reutiliza el código del conflicto).
- `transaction_identifier`: el siguiente número del día se calcula dentro
  de la transacción. Si dos se adelantan con el mismo, el UNIQUE da P2002 y
  la transacción entera se reintenta (hasta 5 veces).
- `transfer-shop-ownership` también bloquea la tienda con `FOR UPDATE`, así
  que dos transferencias simultáneas de la misma tienda no registran un
  `previous_owner` viejo.
- Un vendedor sin `store_owner` da 400 (`InvalidFieldValueError`); uno
  inexistente, 400 (`InvalidReferenceError`).
- `PUT`/`DELETE` con un id que no es entero positivo dan 404 sin tocar la
  base. Un `shop_id`/`vendor_id` inválido da 400.

**Notas para el reporte:**

- Aprobar una solicitud `pending` por `PUT` **no** mueve la tienda (NO
  incluye): hay que diseñar ese flujo.
- `balance_info` queda `null` en las filas nuevas: no hay tabla de balances
  (decisión 4).
- Los hooks `approve`/`disapprove` del admin siguen sin consumidor.
- `CLAUDE.md` todavía describe la API como híbrida con 24 módulos sobre
  JSON. Con el épico cerrado ese texto quedó viejo, pero es documentación
  del dueño y no la toqué.
