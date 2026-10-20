# US-59 — Órdenes: escritura real y `checkout/verify` calculado

> Las 5 rutas de escritura de órdenes dejan de mutar `orders[0]` en memoria
> y pasan a escribir en `orders` y `order_products` (creadas en US-58).
> `POST /orders` crea el pedido de verdad: hijas por tienda, totales que
> calcula el servidor con `taxes`, `shippings` y `coupons`, snapshot de los
> productos y descuento de stock. `checkout/verify` calcula lo que hoy
> devuelve en ceros. Solo la llamada a la pasarela externa sigue como mock
> declarado permanente.

**Épico:** [Épico 46](./README.md)
**Fecha:** 2026-10-20
**Status:** Listo para ejecución
**Depende de:** US-58 (tablas y lectura de órdenes). Por datos depende de
US-49 (`taxes`, `shippings`) y US-52 (`coupons`), que van antes.
**LOC est.:** ~1800. Si supera ~1500 líneas reales, se parte (R-1):
**corte 1/2** = `checkout/verify` + `POST /orders`; **corte 2/2** = `PUT`,
`DELETE` y `payment`.

## Historia

**Como** cliente del shop, **quiero** que al pagar se cree mi pedido con mis
productos, sus precios reales, el impuesto y el envío correctos, y que el
stock baje. **Como** admin, **quiero** cambiar el estado de un pedido o
borrarlo y que el cambio se guarde. **Para** que el checkout deje de
devolver siempre la orden 48 y de calcular el impuesto en 0.

## Contexto — verificado en código (2026-10-20)

### Rutas de esta US

Están en `apps/api/rest/src/orders/orders.controller.ts`.

| Ruta | Guard | Qué hace hoy |
|---|---|---|
| `POST /api/orders` | `@Public` (`:41`, comentario D-10: el checkout de invitado es un flujo vivo) | `create` (`orders.service.ts:70-116`). Toma `this.orders[0]` (la orden 48) y **lo muta**: le pone `payment_gateway` (por defecto `CASH_ON_DELIVERY`), `payment_intent = null`, y elige `order_status`/`payment_status` según la pasarela. `CASH_ON_DELIVERY` y `CASH` → `order-processing` + `payment-cash-on-delivery`/`payment-cash`; `FULL_WALLET_PAYMENT` → `order-completed` + `payment-wallet`; cualquier otra → `order-pending` + `payment-pending`. Propaga los estados a las hijas (`processChildrenOrder`, `:272-278`). Para `STRIPE`, `PAYPAL` y `RAZORPAY` adjunta un `payment_intent` de `payment-intent.json` o de una llamada real a la pasarela (`processPaymentIntent`, `:284-334`). **Ignora el body** salvo `payment_gateway`. |
| `PUT /api/orders/:id` | `ADMIN_OWNER_AND_STAFF` (`:73`) | `orders[0]` (`service:206-208`). |
| `DELETE /api/orders/:id` | `ADMIN_OWNER_AND_STAFF` (`:79`) | `"This action removes a #id order"` (`:210-212`). |
| `POST /api/orders/checkout/verify` | `@Public` (`:86`) | Lee **`@Query()`** (`:88`), pero el shop manda **body** (`apps/shop/src/framework/rest/client/index.ts:363-367`). Devuelve la constante `{total_tax:0, shipping_charge:0, unavailable_products:[], wallet_currency:0, wallet_amount:0}` (`service:214-222`). |
| `POST /api/orders/payment` | JWT, `@HttpCode(200)` (`:91-109`) | Busca por `tracking_number` y, según la pasarela, llama `stripePay` o `paypalPay`, que **mutan `orders[0]`** sea cual sea la orden (`service:371-387`): `order-processing` + `payment-success`. `paypalPay` llama además a `paypalService.verifyOrder`, que es una pasarela externa. Devuelve cuerpo vacío. |

### Cómo se usan desde el frontend

- **Shop, verificación**
  (`components/checkout/check-availability-action.tsx:14-30`): `verify({
  amount: total, products: items.map(formatOrderedProduct),
  billing_address, shipping_address })`.
- **Shop, creación** (`components/checkout/place-order-action.tsx:36-112`).
  Calcula los totales en el cliente con la respuesta de `verify` y manda:
  - `products`, `amount: subtotal`, `coupon_id: Number(coupon?.id)`,
    `discount`, `paid_total: total`;
  - `sales_tax: verified_response.total_tax` y `delivery_fee: freeShippings
    ? 0 : verified_response.shipping_charge`;
  - `total`, `delivery_time: delivery_time?.title`, `customer_contact`,
    `customer_name`, `note`, `payment_gateway`, `use_wallet_points`,
    `billing_address`, `shipping_address`.

  Las líneas de producto quedan excluidas si
  `verified_response.unavailable_products` incluye su id (`:58`).
- **Shop, después de crear** (`framework/rest/order.ts:229-250`): usa
  `tracking_number`, `payment_gateway` y **`payment_intent`** de la
  respuesta para redirigir (`payment_intent.payment_intent_info.is_redirect`).
  La clave `payment_intent` es contrato.
- **Admin, cambio de estado** (`pages/orders/[orderId]/index.tsx:76-80`, y
  lo mismo en `pages/[shop]/orders/[orderId]/index.tsx:89-93`):
  `updateOrder({ id, order_status })`. `UpdateOrderDto` es `PartialType` de
  `CreateOrderDto` (`dto/update-order.dto.ts`) y **no declara
  `order_status`**. Hoy pasa igual porque `ValidationPipe` no tiene
  `whitelist` (`main.ts:9`).
- **Admin, creación** (`data/client/order-create.ts`): llama
  `orders/checkout/verify`.

### Evidencia para las reglas de cálculo

Medido con `node -e` sobre `orders.json` y los mocks de configuración:

- **Impuesto.** `taxes.json`: 1 fila, `rate 2`, `on_shipping true`. En las
  **20/20** órdenes, `sales_tax = amount × 0.02` **exacto**, sin aplicar a
  `delivery_fee` y sin redondear (`0.044` para `amount` 2.2). Es decir, el
  mock **no** aplica el impuesto al envío aunque `on_shipping` sea `true`.
- **Envío.** `shippings.json`: 1 fila, `amount 50`, `type fixed`.
  `delivery_fee` vale 50 o 0. Es 0 en 6 órdenes: 4 sin dirección
  (`shipping_address: []`, pedidos digitales: 23, 13, 7 y 5) y 2 con
  dirección (11 y 9, sin explicación en los datos).
- **Total.** `total = amount + sales_tax + delivery_fee − discount` en 20/20.
  `paid_total = total`.
- **Hijas.** Una por tienda. `amount` es la suma de sus líneas; `sales_tax`
  y `delivery_fee` valen 0; `total = amount`. Las mismas líneas que el padre.
- **Stock.** El snapshot de la línea guarda el producto **en el momento de
  la compra**. El producto 2 aparece con `quantity 10, sold_quantity 0` en la
  orden 41, y hoy está en `8 / 2` en `products.json`; el producto 1, en `18
  / 0` en las órdenes 41 y 15, y hoy en `16 / 2`. **Evidencia de que crear
  una orden descuenta `quantity` y suma `sold_quantity`.** El producto 464
  (`sold_quantity -1`) apunta a un reembolso, que queda fuera.
- **Número de seguimiento.** 14 dígitos con prefijo de fecha
  `YYYYMMDD` + 6 dígitos (`20240207303639` es del 2024-02-07, igual que su
  `created_at`). Los 40 del mock cumplen el patrón.
- **Configuración** (`settings` en Postgres; `getSettings()`,
  `packages/db/src/repositories/settings.repository.ts`): `taxClass "1"` y
  `shippingClass "1"` como **strings**, `freeShipping false`,
  `freeShippingAmount 0`, `minimumOrderAmount 0`, `enableCoupons true`.
- `orders.service.ts:8,56,63` lee hoy `settings.json` para
  `paymentGateway`. Tras esta US lo lee de `getSettings()`.
- `products` no tiene CHECK sobre `quantity` (`db/schema.sql`, bloque de
  `products`). El descuento debe protegerse con un `UPDATE … WHERE quantity
  >= n` condicional.
- **Identidad en una ruta `@Public`.** `JwtAuthGuard` deja pasar las rutas
  `@Public` **sin decodificar** el token (`auth/guards/jwt-auth.guard.ts`),
  así que en `POST /orders` el `request.user` no existe aunque el cliente
  esté logueado.

## Línea base (paso 2 del protocolo; API recién arrancada, R-4)

Estas rutas **mutan el estado en memoria**. Se capturan **en este orden**,
cada escritura **después** de las lecturas, y se reinicia la API entre
bloques si hace falta.

```bash
tok() { curl -s -X POST http://localhost:9001/api/token -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"demodemo\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).token'; }
TOKEN_ADMIN=$(tok admin@demo.com); TOKEN_CUSTOMER=$(tok customer@demo.com)
B=$SCRATCH/us59/antes; mkdir -p $B
LINEAS='[{"product_id":1,"order_quantity":1,"unit_price":<precio real del producto 1>,"subtotal":<idem>}]'
DIR='{"zip":"40391","city":"Winchester","state":"KY","country":"United States","street_address":"2148 Straford Park"}'
curl -s -X POST -H 'Content-Type: application/json' http://localhost:9001/api/orders/checkout/verify \
  -d "{\"amount\":10,\"products\":$LINEAS,\"billing_address\":$DIR,\"shipping_address\":$DIR}" > $B/verify.json   # ceros hoy
curl -s -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN_CUSTOMER" http://localhost:9001/api/orders \
  -d "{\"products\":$LINEAS,\"amount\":10,\"payment_gateway\":\"CASH_ON_DELIVERY\",\"customer_contact\":\"+19999999999\",\"customer_name\":\"Customer\",\"delivery_time\":\"Express Delivery\",\"billing_address\":$DIR,\"shipping_address\":$DIR}" > $B/create.json
node -pe 'const o=require(process.argv[1]); [o.id, o.tracking_number, Object.keys(o).length]' $B/create.json   # 48 y su tracking: es la fila 0
curl -s -X PUT -H "Authorization: Bearer $TOKEN_ADMIN" -H 'Content-Type: application/json' -d '{"order_status":"order-completed"}' http://localhost:9001/api/orders/5 | node -pe 'JSON.parse(require("fs").readFileSync(0)).id'   # 48 hoy
curl -s -X DELETE -H "Authorization: Bearer $TOKEN_ADMIN" http://localhost:9001/api/orders/5    # string hoy
```

Los precios reales del producto 1 se leen antes con
`GET /api/products/<slug>`. Así la línea base es reproducible después.

## Tablas nuevas

**Ninguna.** Esta US no toca `db/schema.sql`, el generador ni el seed, así
que **no hace `just db-reset` ni re-introspección**. Es la única US del
épico así, y se dice en el reporte. Si al implementar aparece la necesidad
de una columna, se para y se pregunta: no se altera el esquema de US-58 a
escondidas.

## Reglas de negocio (qué, no cómo)

**R-a — Productos de la orden y disponibilidad.** Cada línea `{product_id,
order_quantity, unit_price, subtotal, variation_option_id?}` se valida
contra la fila viva de `products`. Una línea es **no disponible** si:

- el producto no existe;
- su `status` no es `publish`;
- `in_stock` es `false`;
- o `quantity < order_quantity`.

`checkout/verify` devuelve sus `product_id` en `unavailable_products`.
`POST /orders` con alguna línea no disponible responde **422**, con esa
misma lista en el cuerpo de error.

**R-b — Precio unitario: lo decide el servidor.**

- Producto `simple`: `sale_price ?? price` de la fila viva. Se ignora el
  `unit_price` del cliente.
- Línea con `variation_option_id`: no hay tabla de variaciones, así que se
  acepta el `unit_price` del cliente **solo** si está dentro de `[min_price,
  max_price]` del producto. Si no, la línea es no disponible.
- `subtotal = unit_price × order_quantity`. `amount = Σ subtotal`.

**R-c — Impuesto.** Fila de `taxes` con `id = Number(settings.taxClass)`.
`sales_tax = amount × rate / 100`, en `numeric`, **sin redondear y sin
aplicar a `delivery_fee`**. `on_shipping` se ignora, y es una divergencia
declarada (evidencia: 20/20 órdenes). Si no hay fila, `sales_tax = 0`.

**R-d — Envío.** `delivery_fee = 0` si se cumple cualquiera de estas:

- la orden no trae `shipping_address` o viene vacía (`[]` o `{}`): es un
  pedido digital, como 4 de los 6 casos con 0 del mock;
- `settings.freeShipping` y `amount >= settings.freeShippingAmount`;
- el cupón es de tipo `free_shipping`.

Si no, se usa la fila de `shippings` con `id =
Number(settings.shippingClass)`: `fixed` → `amount` de la fila;
`percentage` → `amount_orden × amount_fila / 100`; `free` → 0. Las órdenes
11 y 9 del mock (con dirección y 0) **no** las explica esta regla: se
declaran como dato histórico, no como un caso a reproducir.

**R-e — Cupón.** Si llega `coupon_id`, se valida con las funciones que US-52
expuso en `@safari/db`: verificar sus nombres reales en
`packages/db/index.ts`. Es válido si:

- existe y `is_approve` es verdadero;
- está vigente (`active_from <= now() < expire_at`, la misma regla que el
  `is_valid` calculado de US-52);
- `amount >= minimum_cart_amount`;
- y, si el cupón tiene `shop_id`, alguna línea es de esa tienda.

Descuento: `fixed` → `min(amount_cupón, amount)`; `percentage` → `amount ×
amount_cupón / 100`; `free_shipping` → `discount 0` y envío 0 (R-d). Un
cupón inválido responde **422**, no se ignora en silencio.

**R-f — Totales.** `total = amount + sales_tax + delivery_fee − discount`, y
`paid_total = total`. Las cifras que manda el cliente (`sales_tax`,
`delivery_fee`, `total`, `paid_total`, `discount`) **se ignoran**: manda el
cálculo del servidor. Si difieren de lo calculado, se registra un `warn` con
ambas cifras y no se falla. Así un desfase de redondeo del frontend no
rompe el checkout.

**R-g — Hijas por tienda.** Las líneas se agrupan por `products.shop_id`.
Cada grupo crea una hija con `parent_id`, su `shop_id`, sus líneas,
`amount = Σ subtotal`, `sales_tax 0`, `delivery_fee 0`, `discount 0` y
`total = amount`, más los mismos `customer_*`, direcciones, estados y
`payment_gateway` que el padre. Las líneas se graban **en el padre y en cada
hija**, igual que en el mock.

**R-h — Pasarela y estados.** Se conserva el `switch` actual
(`service:79-96`), con una excepción: `FULL_WALLET_PAYMENT` responde
**422**, porque los wallets siguen fuera (decisión 4 del épico). Para
`STRIPE`, `PAYPAL` y `RAZORPAY`, `processPaymentIntent` sigue igual: es el
**mock permanente** (decisión 2), lee `payment-intent.json` o llama a la
pasarela. Su resultado se emite en la clave `payment_intent` de la
respuesta y **no se persiste**.

**R-i — Cliente.** `POST /orders` sigue `@Public`. Si llega un `Bearer`
válido, el controlador lo verifica (`JwtService.verify`, sin tocar
`JwtAuthGuard`) y usa:

- `customer_id = sub`;
- `customer_snapshot` = el usuario en la forma de 9 claves del mock
  (`{id, name, email, email_verified_at, created_at, updated_at,
  is_active:<0|1>, shop_id:null, email_verified:<bool>}`).

Sin token, o con un token inválido, la orden se crea como **invitado**:
`customer_id` y `customer_snapshot` quedan en `NULL`. Un token inválido no
devuelve 401, para no romper el checkout de invitado (comentario de
`JwtAuthGuard`).

**R-j — Número de seguimiento.** `YYYYMMDD` (UTC) + 6 dígitos aleatorios.
Si choca con el `UNIQUE`, se reintenta hasta 5 veces y después responde
500.

**R-k — Transacción y stock.** Todo `POST /orders` es **una transacción**:
inserta el padre, las hijas y las líneas, y por cada línea hace `UPDATE
products SET quantity = quantity − n, sold_quantity = sold_quantity + n,
updated_at = now() WHERE id = … AND quantity >= n`. Si una línea no
actualiza ninguna fila (carrera), hay rollback y **409**. `updated_at` de
`products` se fija desde `clock.ts` (D-7).

**R-l — Cambio de estado (`PUT`).** Acepta `order_status` y, opcionalmente,
`payment_status`, validados contra sus enums (400 si no). Si la orden es un
**padre**, el cambio se propaga a sus hijas, la misma semántica que
`processChildrenOrder`. Si es una **hija**, solo cambia ella. `updated_at`
se fija desde `clock.ts`. Devuelve la orden completa, en la forma de
US-58.

**R-m — Borrado (`DELETE`).** Borra la orden. Las hijas y las líneas caen
por `CASCADE`, y `reviews.order_id` pasa a `NULL` por la FK de US-58.
Devuelve el snapshot previo al borrado (precedente `deleteTag`). **No**
repone stock: es una decisión de negocio que se anota en el reporte.

**R-n — Pago (`POST /orders/payment`).**

- Busca por `tracking_number`; si no existe, **404**.
- `STRIPE`: `order-processing` + `payment-success` **en esa orden y sus
  hijas**.
- `PAYPAL`: primero `paypalService.verifyOrder` (pasarela, mock permanente)
  y después lo mismo que `STRIPE`.
- Otras pasarelas: sin cambio.
- Sigue respondiendo **200** con cuerpo vacío.

## Rutas: hoy → después

| Ruta | Hoy | Después |
|---|---|---|
| `POST /orders/checkout/verify` | `@Query`, ceros | **`@Body`**. `{total_tax, shipping_charge, unavailable_products, wallet_currency: 0, wallet_amount: 0}`, calculado con R-a a R-e. Las 5 claves en el mismo orden. |
| `POST /orders` | muta y devuelve la orden 48 | Crea con R-a a R-k. **201**. Devuelve la orden en la forma de US-58 (padre con `children`) **más `payment_intent`** al final. |
| `PUT /orders/:id` | orden 48 | R-l. 404 si no existe; 400 si el id o el estado son inválidos. |
| `DELETE /orders/:id` | string | R-m. 404 si no existe. |
| `POST /orders/payment` | muta la orden 48 | R-n. |

## Divergencias declaradas

| # | Dónde | Antes | Después | Por qué |
|---|---|---|---|---|
| V-1 | `checkout/verify` | ceros, lee query | calculado, lee body | D-1. El shop manda body (`client/index.ts:363-367`) |
| V-2 | `POST /orders` | devuelve la 48 mutada | la orden creada, 201 | D-1 |
| V-3 | totales | los del cliente (no se usaban) | los del servidor (R-f) | Integridad: el precio lo fija la base |
| V-4 | `on_shipping` | `true` en el dato | ignorado | Evidencia 20/20 (R-c) |
| V-5 | `FULL_WALLET_PAYMENT` | `order-completed`, `payment-wallet` | 422 | Wallets fuera (decisión 4) |
| V-6 | stock | no cambia | descuenta `quantity` y suma `sold_quantity` | Evidencia del snapshot (R-k) |
| V-7 | `PUT`/`DELETE` | orden 48 / string | la orden real / su snapshot | D-1 |
| V-8 | `payment` | muta la 48 | muta la orden pedida y sus hijas | Bug de `stripePay`/`paypalPay` |
| V-9 | `UpdateOrderDto` | sin `order_status` | declara `order_status` y `payment_status` opcionales con `@IsIn` | El admin los manda (`pages/orders/[orderId]/index.tsx:77-80`) |

## Scope

**Incluye:**

- Funciones de escritura en `orders.repository.ts`: `createOrderWithChildren`
  (transacción, R-g/R-k), `updateOrderStatus`, `deleteOrder` y
  `markOrderPaid`. También sus tests de integración: transacción, rollback
  por stock, cascada y `SET NULL` en reviews.
- El cálculo de checkout como función pura **en el servicio Nest**
  (`orders-pricing.ts` o similar), testeable sin base.
- Reescribir `create`, `update`, `remove`, `verifyCheckout`, `stripePay` y
  `paypalPay`.
- Leer `paymentGateway` de `getSettings()`.
- Retirar los imports de `orders.json` y `settings.json` de
  `orders.service.ts`.
- Specs de Jest para el cálculo (cada regla R-a a R-f con su caso) y para
  las rutas.

**NO incluye:**

- `payment-intent.json`, `payment-gateway.json`, `StripePaymentService` y
  `PaypalPaymentService`: siguen siendo mock o pasarela real (decisión 2).
  Siguen importados.
- Wallets y `use_wallet_points`: se ignoran y se declara.
- Reponer stock al cancelar o borrar.
- Reembolsos.
- Restringir al `store_owner` a sus tiendas en `PUT`/`DELETE` (R-6, va al
  reporte).
- Variaciones como tabla.
- Notificaciones o emails.
- `downloads`, export e invoice (US-60).
- Frontends.

## Criterios de aceptación

### CA-1 — `checkout/verify` calcula

Con la línea `{product_id:1, order_quantity:2}` y dirección:

- `total_tax = 2 × precio × 0.02` y `shipping_charge = 50`.
- Sin dirección, `shipping_charge = 0`.
- Pidiendo `order_quantity` mayor que el stock, `unavailable_products =
  [1]`.

Las 5 claves van en el orden del contrato (deep-equal de claves con la línea
base).

### CA-2 — `POST /orders` crea un pedido real

Con token de `customer@demo.com`, una orden de 2 productos de **tiendas
distintas**:

- responde 201;
- la respuesta trae un `tracking_number` de 14 dígitos con la fecha de hoy y
  `customer_id: 2`;
- trae **2 hijas** con su `shop_id`;
- cumple `total = amount + sales_tax + delivery_fee − discount`;
- `payment_intent` vale `null` (COD);
- las claves del padre y de las hijas siguen la forma de US-58.

`psql` muestra 3 filas nuevas en `orders` y 4 en `order_products`, y los
dos productos con `quantity −n` y `sold_quantity +n`. `GET /orders` como
ese cliente la lista primero.

### CA-3 — Invitado, cupón y rechazos

- Sin token, la orden se crea con `customer_id: null`.
- Con un cupón vigente de US-52 se aplica el descuento; con uno vencido
  responde **422**.
- Con stock insuficiente responde **422** y la lista de no disponibles.
- `FULL_WALLET_PAYMENT` responde **422**.
- Ningún rechazo deja filas a medias: el `count(*)` de `orders` antes y
  después es igual.

### CA-4 — `PUT`, `DELETE` y `payment`

Con token de admin:

- `PUT /orders/<padre creado>` `{"order_status":"order-completed"}` cambia
  el padre **y sus hijas**, y fija `updated_at`.
- Con un estado fuera del enum responde 400.
- `DELETE` del padre devuelve su snapshot, y el `GET` siguiente da 404.
- `POST /orders/payment` con el `tracking_number` de una orden `STRIPE`
  creada para la prueba responde 200; esa orden (no la 48) queda en
  `payment-success`.
- Sin token, `PUT` responde **401** exacto, y con token de cliente **403**.

### CA-5 — Limpieza y sin regresión

- Las órdenes de prueba se borran y el stock de los productos usados se
  restaura con `psql` al valor sembrado, para que los asserts de catálogo
  sigan verdes.
- `just db-check`, `npx jest`, `just build-api` y `just verify` en verde,
  con los recuentos.
- `grep -n "orders.json\|settings.json" apps/api/rest/src/orders/` no
  devuelve nada.

## Escenarios Gherkin

```gherkin
Feature: Checkout y escritura de ordenes en Postgres
  Scenario: CA-1 — el impuesto y el envio los calcula el servidor
    Given el impuesto global del 2% y el envio fijo de 50
    When se verifica un carrito de 2 unidades del producto 1 con direccion
    Then total_tax es 2 x precio x 0.02
    And shipping_charge es 50

  Scenario: CA-2 — una orden con dos tiendas crea dos hijas
    Given customer@demo.com autenticado
    When crea una orden con productos de las tiendas 6 y 7
    Then la respuesta es 201
    And la orden tiene 2 hijas, una por tienda
    And el stock de ambos productos baja

  Scenario: CA-3 — sin stock no hay orden
    Given un producto con quantity 1
    When se pide una orden con order_quantity 2
    Then la respuesta es 422
    And no se crea ninguna fila en orders

  Scenario: CA-4 — cambiar el estado del padre arrastra a las hijas
    Given una orden padre con una hija
    When el admin hace PUT con order_status "order-completed"
    Then padre e hija quedan en "order-completed"

  Scenario: CA-4/V-8 — el pago marca la orden indicada
    Given una orden STRIPE recien creada
    When se envia POST /api/orders/payment con su tracking_number
    Then esa orden queda en payment-success
    And la orden 48 no cambia
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `packages/db/src/repositories/orders.repository.ts` | `createOrderWithChildren`, `updateOrderStatus`, `deleteOrder`, `markOrderPaid` |
| `packages/db/src/repositories/orders.integration.test.ts` | casos de escritura, rollback, cascada |
| `packages/db/index.ts` | exports nuevos |
| `apps/api/rest/src/orders/orders-pricing.ts` | nuevo: cálculo puro de R-a a R-f |
| `apps/api/rest/src/orders/orders-pricing.spec.ts` | nuevo |
| `apps/api/rest/src/orders/orders.service.ts` | `create`, `update`, `remove`, `verifyCheckout`, `stripePay`/`paypalPay` contra Postgres; `getSettings()`; sin `orders.json` ni `settings.json` |
| `apps/api/rest/src/orders/orders.controller.ts` | `verifyCheckout` con `@Body`; identidad opcional en `POST /orders` (R-i); `@CurrentUser` donde haga falta |
| `apps/api/rest/src/orders/dto/update-order.dto.ts` | `order_status`/`payment_status` opcionales con `@IsIn` (V-9) |
| `apps/api/rest/src/orders/orders.service.spec.ts` | rutas de escritura |
| `db/README.md` | reglas de checkout y de stock |

## Definición de Done

Se sigue el Protocolo del [README del épico](./README.md#protocolo-de-ejecución-de-una-us-de-este-épico),
**sin** los pasos 3 a 6 (no hay DDL ni seed). Se dice explícitamente en el
reporte.

- [ ] Línea base pegada: los ceros de `verify`, la orden 48 devuelta por
  `POST`/`PUT` y el string de `DELETE`.
- [ ] `just db-build` limpio.
- [ ] `just db-check` y `npx jest` en verde, con los recuentos nuevos, que
  incluyen el spec de cálculo con un caso por regla.
- [ ] `just build-api` y `just verify` en verde (`/api/settings` 5503 B).
- [ ] `curl` de CA-1 a CA-4 con status exacto y `psql` de filas y stock
  antes y después.
- [ ] Limpieza de CA-5 pegada: las órdenes de prueba borradas y el stock
  restaurado.
- [ ] `grep` de CA-5.
- [ ] Status actualizado y fila marcada en el épico.

## Notas para el agente ejecutor

- **El cálculo va en una función pura.** `orders-pricing.ts` recibe
  `{lineas, productos, impuesto, envio, settings, cupon, conDireccion}` y
  devuelve `{amount, sales_tax, delivery_fee, discount, total,
  unavailable}`. `verify` y `create` la llaman igual: es lo que garantiza
  que el shop vea en `verify` lo mismo que luego se cobra.
- **Aritmética de dinero:** `Prisma.Decimal` o enteros en milésimas, nunca
  `float` encadenado. `0.044` (2.2 × 0.02) debe salir exacto, como en el
  mock.
- `settings.taxClass` y `shippingClass` son **strings** (`"1"`) en el
  `jsonb` de `settings`: aplicar `Number()`.
- **No tocar `JwtAuthGuard`.** La identidad opcional de R-i se resuelve en
  el handler con el `JwtService` que ya inyecta el módulo de auth. Si
  `OrdersModule` no lo tiene disponible, importarlo, sin cambiar el guard
  global.
- **Limpieza obligatoria.** Las suites de catálogo comprueban `quantity` y
  `sold_quantity` sembrados. Toda orden de prueba se borra y el stock se
  repone con `psql` o en el `afterAll` del integration test.
- `processChildrenOrder` deja de ser necesario sobre el array. Si se
  conserva, debe operar sobre filas, no sobre `this.orders`.
- `payment-intent.json` y `payment-gateway.json` siguen importados en
  `orders.service.ts`, por decisión 2 del épico. El `grep` de cierre de
  US-63 los tiene en su lista de permitidos.
