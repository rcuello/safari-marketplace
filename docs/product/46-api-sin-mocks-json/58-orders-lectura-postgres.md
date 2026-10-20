# US-58 — Órdenes: esquema, seed y lectura desde Postgres

> Las 3 rutas de lectura de órdenes dejan de servir `orders.json`. Leen dos
> tablas nuevas (`orders` y `order_products`) sembradas con sus 40 órdenes
> (20 padres + 20 hijas) y 76 líneas. Es la US que crea el núcleo
> transaccional. Además cierra un agujero de seguridad vivo: hoy
> **cualquier cliente logueado ve las 20 órdenes de todos**.

**Épico:** [Épico 46](./README.md)
**Fecha:** 2026-10-20
**Status:** Listo para ejecución
**Depende de:** US-57 por orden (R-2). Por datos depende de **US-52**
(`coupons`, destino de la FK `orders.coupon_id`) y de **US-54** (`reviews`,
cuya FK `order_id` cierra esta US). Las dos están antes en la secuencia.
**LOC est.:** ~2200. Por R-1 del épico, partir en **corte 1/2** (DDL + seed
+ capa de datos) y **corte 2/2** (servicio Nest).

## Historia

**Como** cliente del shop, **quiero** ver solo mis pedidos reales, con sus
productos tal como los compré. **Como** dueño o admin, **quiero** listar
los pedidos de una tienda y buscarlos por número de seguimiento. **Para**
que la lista y el detalle de pedidos dejen de ser un JSON fijo que todos
ven igual.

## Contexto — verificado en código (2026-10-20)

### Rutas de esta US

Están en `apps/api/rest/src/orders/orders.controller.ts`.

| Ruta | Guard | Qué hace hoy |
|---|---|---|
| `GET /api/orders` | JWT (sin decorador) | El controlador ya sustituye `customer_id` por `user.sub` si el usuario **no** tiene `super_admin`, `store_owner` ni `staff` (`:47-61`, comentario D-8). Pero **`getOrders` ignora `customer_id`, `tracking_number` y `search`** (`orders.service.ts:118-142`). Solo filtra `shop_id`, con `p?.shop?.id === Number(shop_id)`, y `shop` es `null` o no existe en los 20 padres: **cualquier `shop_id` devuelve 0 filas**. Por defecto `page` 1 y `limit` 15; recorta en orden del archivo; la url es `/orders?search=${search}&limit=${limit}`. |
| `GET /api/orders/:id` | JWT | `getOrderByIdOrTrackingNumber(Number(id))` (`service:144-155`): `o.id === Number(id) \|\| o.tracking_number === id.toString()`, **y si no encuentra, devuelve `orders[0]`**. No mira de quién es la orden. |
| `GET /api/orders/tracking-number/:tracking_id` | JWT | El mismo método de servicio (`controller:68-71`). |

Las otras 14 rutas del controlador **no** son de esta US. `POST /orders`,
`PUT`, `DELETE`, `checkout/verify` y `payment` son de US-59; `order-status`
es de US-57; `downloads`, `export-order-url` y `download-invoice-url` son
de US-60.

### Consumidores

- **Shop** (`framework/rest/client/index.ts:334-343`):
  - `orders.all` hace `GET /orders` con `with=refund`. Lo usa `useOrders`
    (`framework/rest/order.ts:31`, `useInfiniteQuery`) desde
    `pages/orders/index.tsx:32`.
  - `orders.get(tracking_number)` hace **`GET /orders/{tracking_number}`**
    con `with=refund;reviews`. Es decir, el shop pide el detalle **por
    número de seguimiento a través de `:id`**. Por eso `:id` debe aceptar las
    dos formas.
- **Admin** (`data/client/order.ts`):
  - `paginated` manda `search=tracking_number:<texto>` vía
    `formatSearchParams`, más `limit:20`, `page`, `orderBy` y `sortedBy`
    (`pages/orders/index.tsx:52-59`, `pages/orders/transaction.tsx:52-59`).
  - En contexto de tienda añade `shop_id` (`pages/[shop]/orders/index.tsx:47-55`).
  - `get({id})` hace `GET /orders/:id`.
  - `useOrdersQuery` es `useQuery` y lee `data.data`
    (`data/order.ts:18-37`).

### Mock `orders.json`

Medido con `node -e`:

- **20 padres**, ids `48, 41, 39 … 5` (impares dispersos, orden **id
  DESC**), y cada uno con **exactamente 1 hija** en `children[]` (ids `49,
  42 … 6`, `parent_id` = id del padre).
  - Los 40 ids son únicos, `max(id)` es 49, y los 40 `tracking_number` son
    únicos, de 14 dígitos.
  - `shop_id` es `null` en los padres. En las hijas va a las tiendas 6, 1,
    3, 4, 7 y 11, todas sembradas.
- **Claves de un padre**, en orden: `id, tracking_number, customer_id,
  customer_contact, customer_name, amount, sales_tax, paid_total, total,
  note, cancelled_amount, cancelled_tax, cancelled_delivery_fee, language,
  coupon_id, parent_id, shop_id, discount, payment_gateway,
  altered_payment_gateway, shipping_address, billing_address,
  logistics_provider, delivery_fee, delivery_time, order_status,
  payment_status, created_at, customer, products, children`. **No hay
  `updated_at`.**
- **Claves presentes de forma irregular.** Solo el padre 48 trae además
  `shop: null` y `wallet_point: null`. Solo la hija 49 trae `shop` (13
  claves: `id, owner_id, name, slug, description, cover_image, logo,
  is_active, address, settings, notifications, created_at, updated_at`).
  El resto de hijas no tiene `shop` ni `children`.
- **Dinero.**
  - `amount`, `sales_tax`, `paid_total`, `total`, `discount` y
    `delivery_fee` son números, algunos con **3 decimales** (`sales_tax
    0.044`, `total 52.244`).
  - `cancelled_amount`, `cancelled_tax` y `cancelled_delivery_fee` son
    **strings** `"0.00"`.
  - En las 20 órdenes se cumple `total = amount + sales_tax + delivery_fee
    − discount`. `discount` vale 0 y `coupon_id` es `null` en todas.
- **Direcciones.** `shipping_address` y `billing_address` son un objeto
  `{zip, city, state, country, street_address}`. En **8 de las 40 órdenes**
  (padres 23, 13, 7 y 5 con sus hijas) son **`[]`**: pedidos digitales sin
  envío.
- **Estados.**
  - `order_status` ∈ {`order-completed`, `order-processing`,
    `order-pending`, `order-at-local-facility`}.
  - `payment_status` ∈ {`payment-cash-on-delivery`, `payment-cash`,
    `payment-success`, `payment-pending`}.
  - `payment_gateway` ∈ {`CASH_ON_DELIVERY` 13, `CASH` 1,
    `FULL_WALLET_PAYMENT` 1, `STRIPE` 5}.
  - Todos salen de los enums de `orders/entities/order.entity.ts:10-41`,
    **no** de `order-statuses.json`.
  - La hija puede diferir del padre: 39, 35 y la 21, que está en
    `order-at-local-facility`.
- **`customer`** es igual en las 40 órdenes en cuanto a forma (9 claves):
  `{id, name, email, email_verified_at, created_at, updated_at,
  is_active:1, shop_id:null, email_verified:false}`.
  - `customer_id` ∈ {2, 6}. Solo la **orden 41** (y su hija) es del 6,
    `"Jhon Doe" / admin@demo.com`, que en el seed es el **usuario 3**.
- **`products[]`**: 38 líneas en los padres y otras 38 en las hijas (las
  mismas, en el mismo orden), es decir **76 líneas** con 31 productos
  distintos, **todos sembrados**.
  - Ninguna orden repite un producto.
  - Cada línea tiene **45 claves**: un snapshot Laravel de 43 claves, más
    `pivot` y `variation_options`, en ese orden y con `pivot` justo antes
    de `variation_options`.
  - El snapshot **no** coincide con la fila viva. Por ejemplo, el producto
    2 aparece con `quantity 10, sold_quantity 0` en la orden 41, mientras
    `products.json` dice `8 / 2`. Trae además claves sin columna
    (`height`, `blocked_dates`, `my_review`, `variation_options`…).
- **`pivot`**: `{order_id, product_id, order_quantity:"1"` (**string**),
  `unit_price, subtotal` (números), `variation_option_id, created_at,
  updated_at}`.
  - `variation_option_id` ∈ {311, 422, 426, 384, null}. No existe tabla de
    variaciones.
- **Serialización actual.**
  - `plainToClass(Order, …)` convierte solo el `created_at` de **primer
    nivel**, porque `CoreEntity` tiene `@Type(() => Date)`
    (`common/entities/core.entity.ts`). El padre emite `.000Z` (3
    decimales).
  - `children`, `products`, `pivot` y `customer` no tienen `@Type`: sus
    fechas salen **tal cual, con 6 decimales**.
  - Esto se confirma en la línea base.

### Esquema y datos vivos relevantes

- `products` permite borrado real (`deleteProduct`,
  `packages/db/src/repositories/products.repository.ts:884`): una FK
  `RESTRICT` desde las líneas **rompería** el `DELETE /products/:id` del
  admin para cualquier producto vendido.
- `packages/db` **no** tiene `deleteShop` ni `deleteUser`.
- `toShopDto` (`apps/api/rest/src/shops/shops.service.ts:49-68`) emite 16
  claves. Las 13 primeras coinciden **en orden** con el `shop` de la hija 49,
  y añade `orders_count`, `products_count` y `owner`.
- `reviews.order_id` existe desde US-54 como `bigint` nullable **sin FK**
  (pendiente explícito de esa US, y en las 85 filas es `null`). Esta US
  cierra esa FK.

## Línea base (paso 2 del protocolo; API recién arrancada, R-4)

**Crítico:** `POST /orders` y `POST /orders/payment` **mutan `orders[0]` en
memoria** (`orders.service.ts:70-116,371-387`). La línea base se captura
**antes de cualquier escritura**. Si hay duda, reiniciar la API.

```bash
tok() { curl -s -X POST http://localhost:9001/api/token -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"demodemo\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).token'; }
TOKEN_ADMIN=$(tok admin@demo.com); TOKEN_CUSTOMER=$(tok customer@demo.com); TOKEN_OWNER=$(tok store_owner@demo.com)
B=$SCRATCH/us58/antes; mkdir -p $B
curl -s -H "Authorization: Bearer $TOKEN_ADMIN"    "http://localhost:9001/api/orders?limit=20&page=1" > $B/admin-lista.json
curl -s -H "Authorization: Bearer $TOKEN_ADMIN"    "http://localhost:9001/api/orders?limit=20&page=1&shop_id=7" > $B/admin-shop7.json
curl -s -H "Authorization: Bearer $TOKEN_ADMIN"    "http://localhost:9001/api/orders?searchJoin=and&limit=20&search=tracking_number:20240207303639" > $B/admin-tracking.json
curl -s -H "Authorization: Bearer $TOKEN_CUSTOMER" "http://localhost:9001/api/orders?with=refund" > $B/customer-lista.json
curl -s -H "Authorization: Bearer $TOKEN_ADMIN"    "http://localhost:9001/api/orders/48" > $B/orden-48.json
curl -s -H "Authorization: Bearer $TOKEN_CUSTOMER" "http://localhost:9001/api/orders/20240207303639?with=refund;reviews" > $B/orden-48-por-tracking.json
curl -s -H "Authorization: Bearer $TOKEN_ADMIN"    "http://localhost:9001/api/orders/tracking-number/20231105635099" > $B/orden-41-tracking.json
curl -s -H "Authorization: Bearer $TOKEN_ADMIN"    "http://localhost:9001/api/orders/999999" | node -pe 'JSON.parse(require("fs").readFileSync(0)).id'   # 48 hoy (fila 0)
node -pe 'const d=require(process.argv[1]); [d.total, d.data.length, new Set(d.data.map(o=>o.customer_id))]' $B/customer-lista.json   # 20 y {2,6} hoy: la fuga
```

## Tablas nuevas (paso 3)

> Los snapshots van en **`json`**, no en `jsonb`. `jsonb` reordena las
> claves (más corta primero, luego por bytes) y destruiría el orden de las
> 43 claves del producto y de las 9 del cliente. Esto es D-1. `json`
> conserva el texto tal cual y Prisma lo modela igual (`Json`).

**`orders`**. Padres e hijas comparten tabla: es el modelo de Pickbazar, y
el contrato embebe hijas con la misma forma.

| Columna | Tipo / restricción | Nota |
|---|---|---|
| `id` | `bigserial PRIMARY KEY` | ids del mock preservados |
| `tracking_number` | `text NOT NULL UNIQUE CHECK (tracking_number ~ '^[0-9]{14}$')` | los 40 cumplen |
| `parent_id` | `bigint NULL REFERENCES orders(id) ON DELETE CASCADE` | borrar el padre arrastra las hijas |
| `customer_id` | `bigint NULL REFERENCES users(id) ON DELETE SET NULL` | NULL para invitado (`guestCheckout`, US-59); `SET NULL` porque la orden es histórica |
| `customer_contact`, `customer_name` | `text` | `customer_name` puede ser NULL |
| `customer_snapshot` | `json NULL` | el `customer` embebido, **verbatim** (D-5) |
| `shop_id` | `bigint NULL REFERENCES shops(id) ON DELETE RESTRICT` | NULL en padres. No hay `deleteShop`, así que `RESTRICT` no rompe nada vivo y protege el histórico |
| `amount`, `sales_tax`, `paid_total`, `total`, `discount`, `delivery_fee` | `numeric NOT NULL DEFAULT 0`, **sin escala fija** | hay valores con 3 decimales; CHECK `>= 0` en cada uno |
| `cancelled_amount`, `cancelled_tax`, `cancelled_delivery_fee` | `numeric(12,2) NOT NULL DEFAULT 0` | se emiten como string con 2 decimales |
| `note`, `altered_payment_gateway`, `logistics_provider`, `delivery_time` | `text NULL` | |
| `language` | `text NOT NULL DEFAULT 'es'` | seed: `'en'` |
| `coupon_id` | `bigint NULL REFERENCES coupons(id) ON DELETE SET NULL` | `coupons` existe desde US-52 |
| `payment_gateway` | `text NOT NULL CHECK (payment_gateway IN ('STRIPE','CASH_ON_DELIVERY','CASH','FULL_WALLET_PAYMENT','PAYPAL','RAZORPAY'))` | enum `PaymentGatewayType` |
| `order_status` | `text NOT NULL CHECK (order_status IN (…los 8 valores distintos de OrderStatusType…))` | sin FK a `order_statuses` (vocabulario distinto, ver US-57) |
| `payment_status` | `text NOT NULL CHECK (payment_status IN (…los 9 valores de PaymentStatusType…))` | |
| `shipping_address`, `billing_address` | `json NULL CHECK (… IS NULL OR json_typeof(…) IN ('object','array'))` | admite el `[]` del mock |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | sembrado del mock |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | no se emite (el mock no lo trae) |

CHECK de forma: `CHECK ((parent_id IS NULL AND shop_id IS NULL) OR
(parent_id IS NOT NULL AND shop_id IS NOT NULL))`. Un padre agrupa y una
hija pertenece a una tienda. Las 40 filas lo cumplen. Índices en
`parent_id`, `customer_id`, `shop_id` y `coupon_id`.

**`order_products`**:

| Columna | Tipo / restricción | Nota |
|---|---|---|
| `order_id` | `bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE` | |
| `line_no` | `smallint NOT NULL CHECK (line_no > 0)` | conserva el orden de las líneas |
| `product_id` | `bigint NULL REFERENCES products(id) ON DELETE SET NULL` | `SET NULL`: borrar un producto no debe fallar ni borrar histórico |
| `variation_option_id` | `bigint NULL` | sin FK: no hay tabla de variaciones |
| `order_quantity` | `integer NOT NULL CHECK (order_quantity > 0)` | se emite como string |
| `unit_price`, `subtotal` | `numeric NOT NULL CHECK (>= 0)` | |
| `product_snapshot` | `json NOT NULL` | las 43 claves previas a `pivot` **más** `variation_options`, verbatim |
| `created_at`, `updated_at` | `timestamptz NOT NULL DEFAULT now()` | sembrados desde `pivot` |

PK `(order_id, line_no)`, más `UNIQUE (order_id, product_id,
variation_option_id)` (ninguna orden del mock repite producto). Índice en
`product_id`.

**FK pendiente de US-54: `reviews.order_id → orders`.** Va **después** del
`CREATE TABLE orders`, en un bloque idempotente:

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reviews_order_id_fkey') THEN
    ALTER TABLE reviews ADD CONSTRAINT reviews_order_id_fkey
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
  END IF;
END $$;
```

Por qué así:

1. **No se edita el `CREATE TABLE reviews`.** Mover `reviews` debajo de
   `orders` o meterle la FK cambiaría una sentencia previa, y CA-2 del
   protocolo lo prohíbe.
2. `db-up` re-aplica `schema.sql` sobre un volumen existente
   (`justfile:270-295`): un `ALTER` desnudo fallaría la segunda vez, y el
   `DO … IF NOT EXISTS` lo hace idempotente igual que los `IF NOT EXISTS`
   del archivo.
3. `ON DELETE SET NULL`: una review sobrevive a que se borre su orden.

Antes de escribirlo hay que confirmar el nombre real de la columna y de una
FK previa (`\d reviews`). Si US-54 la nombró distinto, se ajusta el bloque,
sin tocar US-54.

## Reglas del seed (paso 4)

- El bloque va **después** de `users`, `shops`, `products`, `coupons` y
  `reviews`.
- **Aplanado.** Cada padre se emite y después su hija. Total: **40 filas en
  `orders`**. Las líneas del padre y las de la hija se emiten por separado:
  **76 filas en `order_products`**, con `line_no` = posición 1-based en su
  `products[]`.
- **Cliente** (D-4, helper `resolverUsuarioPorEmail`, de US-51/US-54): se
  resuelve por `customer.email`. `customer@demo.com` → 2;
  `admin@demo.com` → **3**, para la orden 41 y su hija. El `customer`
  embebido va **verbatim** a `customer_snapshot` (conserva `id: 6`).
- **Snapshot de línea**: el objeto del producto **sin `pivot`**, conservando
  el orden de claves (`JSON.stringify` del objeto con `pivot` eliminado →
  `'…'::json`). Las columnas salen de `pivot`; `order_quantity` va con
  `Number()`.
- **Dinero.** Los literales numéricos se emiten tal cual, sin redondear.
  `cancelled_*` pasan de `"0.00"` a `0.00`.
- **Direcciones**: el valor tal cual, sea `[]` u objeto, como `'…'::json`.
- **Timestamps**: `orders.created_at` del mock (D-3); `updated_at` =
  `created_at`. Las líneas usan `pivot.created_at` y `pivot.updated_at`.
- **Validación previa** (si falla, la generación se detiene):
  - `tracking_number` único y de 14 dígitos;
  - cada `product_id` existe en el seed;
  - cada `shop_id` de hija existe;
  - `total = amount + sales_tax + delivery_fee − discount` con tolerancia
    `1e-9`;
  - todos los estados y pasarelas están en su enum;
  - ninguna hija tiene `children`.
- `setval('orders_id_seq', 49)`.

**Conteos esperados:**

- `orders` 40: 20 con `parent_id IS NULL` y 20 hijas.
- `order_products` 76.
- `orders WHERE customer_id = 3` → 2.
- `order_products WHERE variation_option_id IS NOT NULL` → 12: las 6 del
  mock, duplicadas en padre e hija (medido con `node -e`).
- `orders WHERE shop_id = 7` → 6.

Conteos previos intactos (en particular, 1200 productos).

## Rutas: hoy → después

| Ruta | Hoy | Después |
|---|---|---|
| `GET /orders` | ignora `customer_id`/`search`; `shop_id` → 0 filas; fuga entre clientes | **Sin `shop_id`**: solo padres (`parent_id IS NULL`), `ORDER BY id DESC`. **Con `shop_id`**: hijas de esa tienda. **`search=tracking_number:X`**: coincidencia exacta sobre padres e hijas. **Aislamiento**: si el controlador puso `customer_id` (usuario sin `super_admin`/`store_owner`/`staff`), filtra `customer_id = sub`. Misma url, default `limit` 15, `paginate()` de Nest con el `limit` crudo. |
| `GET /orders/:id` | id o tracking; inexistente → orden 48 | `:id` es **id numérico** (`Number.isSafeInteger`) **o** `tracking_number` de 14 dígitos (lo que pide el shop). Inexistente → **404**. Cliente sin rol de tienda y orden ajena → **404**, no 403, para no revelar existencia. Devuelve la orden con `children` si es padre. |
| `GET /orders/tracking-number/:tracking_id` | lo mismo | Solo por `tracking_number`, con las mismas reglas de 404 y aislamiento. |

**Forma de cada orden (D-1).**

- **Padre**: las 31 claves del mock en su orden, **sin `shop` ni
  `wallet_point`**. `customer` = `customer_snapshot`, verbatim.
- **Hija**: las mismas claves hasta `products`, más `shop` proyectado con
  `toShopDto`, **sin `children`**.
- **`products`**: cada línea es el snapshot con `pivot` reinsertado **justo
  antes de `variation_options`**, para recuperar la posición original:
  - `pivot.order_id` = id de la orden que lo contiene;
  - `pivot.order_quantity` = `String(n)`;
  - `unit_price` y `subtotal` como números;
  - `pivot.created_at` y `pivot.updated_at` como ISO.
- **Tipos**: el dinero sale con `_dec()` → `number`; `cancelled_*` con
  `.toFixed(2)` → string; `coupon_id` y `parent_id` son número o `null`.
- **`translated_languages`**: el mock no lo trae en órdenes y **no se
  emite**.

## Divergencias declaradas

| # | Dónde | Antes | Después | Por qué |
|---|---|---|---|---|
| V-1 | `GET /orders` como cliente | 20 órdenes de los clientes 2 y 6 | solo las del cliente: 19 para `customer@demo.com` | **Corrección de seguridad (R-5)**, no negociable |
| V-2 | `GET /orders?shop_id=X` | 0 filas siempre | las hijas de la tienda X (shop 7: 6 hijas) | Filtro real (D-1) |
| V-3 | `search=tracking_number:X` | ignorado (las 20) | la orden exacta | Filtro real |
| V-4 | `GET /orders/:id` inexistente u orden ajena | 200 con la orden 48 | 404 | D-1 y R-5 |
| V-5 | `customer_id` de la orden 41 y su hija | `6` | `3` | D-4. `customer.id` sigue en 6 (snapshot histórico) |
| V-6 | padre 48 | trae `shop: null` y `wallet_point: null` | no trae ninguna de las dos (regla única para los padres) | Claves irregulares en el mock: solo 1 de 20 las tiene |
| V-7 | hijas ≠ 49 | sin `shop` | `shop` con 16 claves de `toShopDto` | Regla única para las hijas |
| V-8 | hija 49 `shop` | 13 claves Laravel | las mismas 13 en el mismo orden + `orders_count`, `products_count`, `owner` | Proyección en vivo (D-5) |
| V-9 | `created_at` de hijas, `pivot.*_at` | 6 decimales (no pasan por `@Type`) | 3 decimales (`Date.toJSON`) | Divergencia conocida de `CLAUDE.md`. El padre ya emitía 3 |
| V-10 | `shop.created_at`/`updated_at` de la hija 49 | fecha del mock | fecha del seed de `shops` | Proyección en vivo |

Lo que **no** debe divergir y CA-2 comprueba:

- el snapshot de producto, con sus 45 claves en orden;
- el `customer`;
- las direcciones, incluidos los `[]`;
- el dinero, incluidos los 3 decimales;
- `order_quantity` como string;
- el orden `id DESC`;
- el paginador.

## Scope

**Incluye:**

- DDL de `orders` y `order_products`, y el bloque idempotente de la FK
  `reviews.order_id`.
- Levantar en la cabecera de `db/schema.sql` la mención a «órdenes», si
  US-47 no lo dejó ya escrito. Hay que comprobarlo y no duplicarlo.
- Bloque del generador y seed; `just db-reset`; re-introspección: `Order`
  con autorrelación `parent`/`children`, `OrderProduct` e inversas en
  `User`, `Shop`, `Product`, `Coupon` y `Review`.
- `OrderRecord` y `OrderProductRecord`, más `orders.repository.ts`
  (`listOrders`, `findOrderByIdOrTracking`) y su integration test.
- En `OrdersService`: reescribir `getOrders` y `getOrderByIdOrTrackingNumber`
  contra `@safari/db` y añadir el chequeo de dueño en el detalle (los dos
  `GET` reciben `@CurrentUser()`). Spec de Jest.

**NO incluye:**

- `POST /orders`, `PUT`, `DELETE`, `checkout/verify` ni `payment`: son de
  US-59, igual que la lógica de `create` y de `stripePay`/`paypalPay`. Hasta
  entonces **siguen operando sobre el array del JSON**, que se mantiene
  importado solo para ellos. Se documenta en el reporte.
- `downloads`, export e invoice (US-60).
- Restringir al `store_owner` a sus propias tiendas: hoy ve todo y el
  controlador no lo filtra. Es una decisión de autorización (R-6): va al
  reporte.
- `with=refund;reviews`: el shop lo manda y hoy se ignora; seguirá
  ignorándose, porque `refunds` es un stub fuera del épico.
- `orders_count` real en `toShopDto`.
- Variaciones de producto.
- Frontends.

## Criterios de aceptación

### CA-1 — Seed y esquema

`psql` tras `just db-reset` muestra:

- los conteos de arriba;
- 0 huérfanas en `orders.parent_id`, `customer_id`, `shop_id` y
  `coupon_id`, y en `order_products.order_id` y `product_id`;
- la CHECK padre/hija rechazando un padre con `shop_id`;
- un `[]` aceptado en `shipping_address`;
- `\d reviews` con `reviews_order_id_fkey`.

Aplicar `db/schema.sql` **dos veces** seguidas (`just db-migrate` ×2) no
falla, lo que prueba el bloque idempotente. `prisma validate` y
`migrate diff --exit-code` dan `EXIT=0`.

### CA-2 — Lectura con la forma preservada

Deep-equal con token de **admin** entre la línea base y el después para:

- `GET /orders?limit=20&page=1`;
- `GET /orders/48`;
- `GET /orders/tracking-number/20231105635099`.

Se excluyen **solo** las claves de V-5 a V-10. Además, una comprobación
aparte demuestra que, en las 76 líneas, el orden de claves del snapshot de
producto es idéntico al del mock.

### CA-3 — Aislamiento (R-5)

- Con token de `customer@demo.com`, `GET /orders` da `total` 19, y todas
  las órdenes tienen `customer_id` 2.
- Con ese mismo token, `GET /orders/41` y `GET
  /orders/20231105635099` (de `admin@demo.com`) dan **404**.
- Con token de admin, las dos dan 200.

### CA-4 — Filtros reales

- `GET /orders?shop_id=7` como admin devuelve las hijas de la tienda 7, y
  todas tienen `parent_id` distinto de `null`.
- `search=tracking_number:20240207303639` devuelve exactamente la orden 48.
- `GET /orders/999999` da **404**.
- `GET /orders/abc` da **400**.

### CA-5 — Sin regresión

- `just db-check`, `npx jest`, `just build-api` y `just verify` en verde,
  con los recuentos.
- `DELETE /products/:id` de un producto que aparece en una orden sigue
  respondiendo 200 y deja `order_products.product_id` en NULL: hay que
  crear un producto de prueba, meterlo en una línea de prueba y borrarlo.
- Las suites de reviews de US-54 siguen en verde con la FK nueva.

## Escenarios Gherkin

```gherkin
Feature: Lectura de ordenes desde Postgres
  Scenario: CA-3 — un cliente solo ve sus ordenes
    Given customer@demo.com autenticado
    When pide GET /api/orders
    Then todas las ordenes tienen customer_id 2
    And el total es 19

  Scenario: CA-3 — detalle de orden ajena
    Given customer@demo.com autenticado
    When pide GET /api/orders/41
    Then la respuesta es 404

  Scenario: CA-2 — el shop pide el detalle por numero de seguimiento
    Given el admin autenticado
    When pide GET /api/orders/20240207303639
    Then recibe la orden 48 con su hija 49 en children
    And cada producto conserva sus 45 claves en el orden original

  Scenario: CA-4 — filtro por tienda
    Given el admin autenticado
    When pide GET /api/orders?shop_id=7
    Then todas las ordenes devueltas son hijas de la tienda 7

  Scenario: CA-1 — el esquema es idempotente con la FK diferida
    Given la base recreada
    When se aplica db/schema.sql por segunda vez
    Then no hay error y reviews_order_id_fkey existe una sola vez
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `db/schema.sql` | `orders`, `order_products`, bloque `DO $$` de `reviews_order_id_fkey`; cabecera si hace falta |
| `db/generate-seed.mjs` | aplanado padre/hija, snapshots `json`, resolución de cliente por email, validaciones, `setval` |
| `db/seed.sql` | regenerado |
| `packages/db/prisma/schema.prisma` | `Order` (autorrelación), `OrderProduct`, inversas; renombres previos re-aplicados; cabecera con las CHECK nuevas |
| `packages/db/src/records.ts` | `OrderRecord`, `OrderProductRecord` (snapshots como `unknown`/`Prisma.JsonValue`) |
| `packages/db/src/repositories/orders.repository.ts` | nuevo: `listOrders({page, limit, customerId?, shopId?, trackingNumber?})`, `findOrderByIdOrTracking` |
| `packages/db/src/repositories/orders.integration.test.ts` | nuevo |
| `packages/db/index.ts` | barrel |
| `apps/api/rest/src/orders/orders.service.ts` | `getOrders` y `getOrderByIdOrTrackingNumber` contra Postgres; `toOrderDto` |
| `apps/api/rest/src/orders/orders.controller.ts` | `@CurrentUser()` en los dos `GET` de detalle |
| `apps/api/rest/src/orders/orders.service.spec.ts` | nuevo (lectura) |
| `db/README.md`, `packages/db/README.md` | modelo transaccional: padre/hija, snapshots, por qué `json` y no `jsonb` |

## Definición de Done

Se sigue el Protocolo del [README del épico](./README.md#protocolo-de-ejecución-de-una-us-de-este-épico).

- [ ] Línea base pegada, incluida la evidencia de la fuga (`customer-lista`
  con `customer_id` {2, 6}) y de la fila 0 ante un id inexistente.
- [ ] Generador con los conteos; `just db-reset` limpio; `psql` de CA-1; dos
  `just db-migrate` seguidos sin error.
- [ ] `prisma validate` + `migrate diff --exit-code` → `EXIT=0`;
  `just db-build` limpio.
- [ ] `just db-check` y `npx jest` en verde con los recuentos nuevos.
- [ ] `just build-api` y `just verify` en verde (`/api/settings` 5503 B).
- [ ] Deep-equal de CA-2 con la lista de exclusiones y la comprobación del
  orden de claves de los 76 snapshots.
- [ ] `curl` de CA-3 y CA-4 con status exacto.
- [ ] Prueba de CA-5 del borrado de producto con `SET NULL`, con limpieza
  posterior.
- [ ] Status actualizado y fila marcada en el épico. Si se partió, el reporte
  indica qué entró en cada corte.

## Notas para el agente ejecutor

- **`json`, no `jsonb`, para los snapshots y las direcciones.** Es la única
  forma de conservar el orden de claves sin añadir columnas de «orden».
  Prisma devuelve el valor parseado; `JSON.stringify` del objeto devuelto
  conserva el orden de inserción, que es el del texto. Un test de
  integración debe fijarlo.
- **`:id` acepta dos formas.** Si `/^[0-9]{14}$/` → `tracking_number`; si
  no, `Number.isSafeInteger(Number(id)) && id > 0` → `id`; si tampoco, 400.
  Ningún id real tiene 14 dígitos (`max` 49 y secuencia `bigserial`); la
  regla queda documentada con su riesgo teórico.
- **El controlador ya calcula el aislamiento** (`orders.controller.ts:52-60`).
  El servicio solo tiene que **obedecer** `customer_id`. Para el detalle,
  pasar `user` y comparar `order.customerId` con `user.sub` si no hay rol de
  tienda.
- **`POST /orders` y `payment` siguen con el JSON hasta US-59.** No borrar
  todavía `ordersJson` de `orders.service.ts`; sí dejar comentado por qué
  sigue, con referencia a US-59.
- `discount` y `coupon_id` valen 0/`null` en todo el mock: la FK a
  `coupons` existe pero no se ejercita con datos sembrados. Probarla en el
  integration test con una orden centinela `zz-orders-`.
- Los conteos de esta US (40 / 76 / 12 / 6 / 19) se midieron con `node -e`
  sobre el JSON el 2026-10-20. Los asserts de los tests los toman de la
  base sembrada, no de aquí.
