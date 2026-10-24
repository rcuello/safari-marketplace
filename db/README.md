# db/ — el catálogo compartido

Una sola base para dos consumidores: el **scraper escribe** productos y la
**tienda Next.js los consulta**, desde las mismas tablas.

| Archivo | Qué es |
|---|---|
| [`schema.sql`](schema.sql) | El DDL, con las decisiones de modelado comentadas |
| [`seed.sql`](seed.sql) | **Generado.** Los datos reales de la aplicación |
| [`generate-seed.mjs`](generate-seed.mjs) | Produce `seed.sql` desde los JSON del mock |

```bash
just db-up              # levanta Postgres, aplica esquema y seed
just db-seed-generate   # regenera seed.sql desde los JSON
just db-shell           # sesión psql
```

## De dónde salen los datos

`seed.sql` no se escribe a mano: sale de `apps/api/rest/src/db/pickbazar/*.json`,
que es el mock que la API sirve hoy. El generador valida antes de emitir, así
que si el mock violara alguna restricción del esquema falla en vez de producir
SQL inaplicable.

```
10 types · 12 shops · 198 categorías · 14 manufacturers · 10 tags · 1200 productos · 11 usuarios · 4 permisos
· 1 become_seller · 3 shop_staff · 19 faqs · 5 terms_and_conditions
· 5 refund_policies · 8 refund_reasons · 1 taxes · 1 shippings
· 8 attributes · 27 attribute_values · 3 store_notices (6 destinatarios,
6 lecturas) · 10 coupons · 10 wishlists · 85 reviews · 3 abusive_reports · 68 questions · 2 conversations · 5 messages
· 10 order_statuses · 40 orders (20 padres + 20 hijas) · 76 order_products
· 10 order_files · 2 withdraws · 6 ownership_transfers
```

**Los ids del mock se preservan** para no romper las relaciones, y al final se
adelantan las secuencias. Dos cosas que el generador resuelve y conviene saber:

- **Tres shops se reconstruyen.** 190 productos referencian `shop_id` 12, 14 y
  15, que no existen en `shops.json`. Con claves foráneas reales esas filas
  serían imposibles. La identidad sí está disponible porque cada producto
  embebe su objeto `shop`, así que se recuperan de ahí en lugar de descartar
  190 productos o inventar tiendas de relleno.
- **`category_product` queda vacía a propósito.** Ninguno de los 1200 productos
  del mock trae categorías, aunque la entidad las declara y el buscador filtra
  por `categories.slug`. En la app original, hoy, buscar por categoría devuelve
  cero resultados. No se inventan enlaces.

## Identidad: usuarios, perfiles y permisos

Desde US-20, `users.json` (el mismo mock) siembra 6 tablas: `users`, `profiles`
(1:1), `permissions`, el pivote `permission_user`, y `password_reset_tokens` /
`otp_codes` (vacías, sin consumidor todavía). El login del mock sigue
aceptando cualquier contraseña hasta US-22 — este dato solo queda sembrado y
disponible.

**Credencial demo**: los 11 usuarios (los 3 de `users.json` y los 8 que
siembra el helper de identidad, ver más abajo) comparten la contraseña `demodemo`,
guardada como hash bcrypt (costo 10). El literal vive en
`generate-seed.mjs` como constante `HASH_DEMO`, con el comando de
regeneración en un comentario junto a ella — nunca se hashea en tiempo de
generación, porque el salt aleatorio de bcrypt rompería el determinismo del
seed.

**Matriz de permisos** (`guard_name = 'api'`, 4 filas: `super_admin`,
`customer`, `store_owner`, `staff`):

| Usuario | id | Permisos |
|---|---|---|
| `admin@demo.com` | 3 | `super_admin` + `customer` + `store_owner` |
| `store_owner@demo.com` | 1 | `customer` + `store_owner` |
| `customer@demo.com` | 2 | `customer` |
| — | 4 | `staff` existe en el catálogo, sin asignar hasta US-25 |

**Por qué `lower(email)` y no `citext`**: el índice único vive sobre
`lower(email)`, no sobre la columna `email` (que sigue siendo `text` plano).
Consistente con `products_nombre_trgm_idx`, que ya indexa `lower(name)`, y
sin introducir el primer `CREATE EXTENSION` del DDL versionado. La
consecuencia práctica: **todo lookup por email debe escribirse
`WHERE lower(email) = lower($1)`**, o Postgres no usa el índice — un
`WHERE email = $1` hace table scan igual de correcto pero sin aprovecharlo.

**Por qué `otp_codes` no tiene FK a `users`**: se clave por `phone` en texto
plano porque `POST /api/send-otp-code` recibe un teléfono, no un id de
usuario, y no existe una columna de teléfono única en `users`/`profiles`
(solo `profile.contact`, texto libre). Es la única tabla de identidad que se
aparta del estilo FK-everywhere del resto del archivo.

Ninguna de las 6 tablas tiene consumidor en código de aplicación todavía:
el login sigue siendo mock (US-22) y recuperación/OTP no tienen endpoint
real (US-24).

## Identidad extendida: staff por tienda y "vender con nosotros"

Desde US-41, dos tablas más, ninguna con trigger de `updated_at` (misma
política que el resto del archivo desde US-32):

- **`shop_staff`** — pivote puro `user_id`/`shop_id`, calco de
  `permission_user`. PK compuesta, ambas FK `ON DELETE CASCADE`. **Sin
  columna de rol, a propósito**: ningún consumidor real la pide hoy
  (`StaffsController.getStaffs` devuelve `UserPaginator`, no filas de
  pivote; `AddStaffInput` del admin es `{email, password, name, shop_id}`
  sin rol). Solo `created_at`: un pivote se crea o se borra, nunca se
  actualiza. Sembrado con 3 filas deterministas — `(2,1)`, `(2,2)`, `(3,1)`
  — inventadas (no hay mock de staff), excluyendo siempre al usuario 1
  (dueño de las 12 tiendas).
- **`become_seller`** — singleton calco de `settings`: `id smallint
  DEFAULT 1` + `CHECK become_seller_fila_unica`. Dos columnas `jsonb`
  hermanas, no una: `page_options` (el objeto INTERNO de
  `become-seller.json`, 24 claves — NO el envoltorio con forma de
  `settings` que trae el mock, cuyos `id`/`language`/`created_at`/
  `updated_at` son estas mismas columnas) y `commissions` (el array
  completo de 2 tiers). Fundirlas en una sola columna perdería
  `commissions` en silencio.

## Contenido: FAQ y términos y condiciones

Desde US-47 (primera US del
[Épico 46](../docs/product/46-api-sin-mocks-json/README.md), que levanta la
exclusión transaccional de la cabecera de `schema.sql`), dos tablas con la
misma forma: contenido **global** (emitido por el super admin, `shop_id`
NULL) o **de una tienda**.

- **`faqs`** — 19 filas de `faqs.json`. `faq_type ∈ {global, shop}` (CHECK).
  `issued_by` es **texto**, no FK: es el nombre del emisor («Super Admin» o
  el de la tienda), que es lo que la tienda filtra por igualdad exacta.
  **`shop_id` se deriva en el generador**: el mock no trae la clave, solo
  `issued_by`; las 14 FAQ de tienda casan exactamente con las tiendas 1-7 por
  nombre (dos cada una). Un nombre que no case detiene la generación.
  Varios slugs terminan en `?` y se siembran tal cual (la FAQ se edita por id).
- **`terms_and_conditions`** — **5 filas de 10**. El mock trae los ids
  `8,9,10,11,12,1,2,3,4,5` y los 1-5 son copias exactas de 8-12; con `slug`
  UNIQUE se conserva la **primera aparición en el orden del archivo** (8-12),
  que es la que `GET /:slug` devolvía. Una repetición con contenido distinto
  detiene la generación. `is_approved` es boolean (el mock trae `1`); la
  proyección a entero `1/0` del contrato vive en el servicio de Nest.

En las dos, `shop_id → shops ON DELETE CASCADE` (el contenido de una tienda
borrada no tiene a quién pertenecer) y `user_id → users ON DELETE SET NULL`
(el autor se puede borrar sin perder el contenido). Al **crear**, el tipo y
el emisor no los elige quien escribe: los deriva el repositorio de `shop_id`
(`resolveContentIssuer`), para que una FAQ de tienda no quede invisible en
su propia página.

## Reembolsos: políticas y motivos

Desde US-48, las dos listas de contenido que rodean el reembolso. No son el
reembolso en sí: el módulo `refunds` de la API es un stub sin JSON.

- **`refund_policies`** — 5 filas de `refund-policies.json`: 1 de vendedor y
  4 de cliente, las 5 `approved`. Tiene dos CHECK: `target ∈ {vendor,
  customer}`, que es lo que filtran `/customer-refund-policies` y
  `/vendor-refund-policies`, y `status ∈ {approved, pending}`, la cola de
  moderación que conoce el admin. `status` vale por defecto `pending`.
  `shop_id` es opcional (CASCADE) y el seed lo deja NULL.
- **`refund_reasons`** — 8 filas, plana. Es **la primera tabla cuyo contrato
  emite `created_at`/`updated_at`**, así que el seed inserta las fechas del
  mock (`2023-11-12T10:58:58Z`) con el helper `ts()` y no usa el `DEFAULT
  now()`. Sin eso, cada `db-reset` cambiaría la respuesta de `GET
  /refund-reasons`.

## Configuración fiscal y de envío: `taxes` y `shippings`

Desde US-49, una fila cada una, la clase «Global» con **id 1**, sembrada con
las fechas del mock (en `taxes`, `created_at` y `updated_at` son distintos).

- **La relación con `settings` es blanda.** `settings.options.taxClass` y
  `shippingClass` guardan `"1"` como texto dentro del `jsonb`, sin FK. Por eso
  los ids 1 se preservan, y por eso estas tablas no tocan el contrato
  congelado de `/api/settings` (5504 B).
- **`numeric` sin escala** en `rate` y `amount`: vuelven como `2` y `50`, no
  como `2.00`, que es lo que el contrato emite. CHECK `rate >= 0`, `amount >=
  0` y `type ∈ {fixed, percentage, free}`.
- **No se paginan**: el admin de `/settings` pide `limit=999` y espera un
  array para poblar el selector de clase.

Son la configuración que el checkout real (US-59) leerá para calcular
impuesto y envío.

## Atributos de producto: `attributes` y `attribute_values`

Desde US-50, el primer agregado padre-hijo del Épico 46: 8 atributos y 27
valores de `attributes.json`. Son el catálogo sobre el que se construirán
las variaciones de producto, que todavía no se persisten (épico aparte).

- **`attributes`**: `shop_id NOT NULL → shops ON DELETE CASCADE`, porque un
  atributo es de su tienda, igual que `products.shop_id`. `slug` es UNIQUE
  global. Tres slugs del mock llevan mayúsculas (`color-OMG`, `size-zLh`,
  `color-A6u`) y se siembran tal cual. Los que se crean desde el admin salen
  normalizados. No tiene `type_id`: el mock trae `type` todo `null`.
- **`attribute_values`**: `attribute_id → attributes ON DELETE CASCADE`.
  `slug` es único **dentro** del atributo (`UNIQUE (attribute_id, slug)`),
  no globalmente. No lleva `shop_id`: lo hereda del padre. El generador toma
  el `attribute_id` del padre que recorre y se detiene si el campo del hijo
  no coincide.
- **Dos órdenes que son contrato**: los atributos van en `id DESC` y los
  valores en `id ASC` dentro de cada padre.

## Identidad referenciada por los mocks: se resuelve por email

Desde US-51, el generador tiene un helper, `resolverUsuarioPorEmail`, que
usan todos los mocks que apuntan a un usuario (D-4 del Épico 46). Esos mocks
traen ids del Laravel original que el seed no tiene: el `6` es
`admin@demo.com`, que aquí es el **3**. El helper recibe cualquier objeto con
`email` y devuelve el id **del seed**, nunca el del snapshot. Un email que no
casa detiene la generación sin escribir `seed.sql`. Es la misma trampa que
ya documentaba `permission_user` (`pivot.model_id = 6`).

**Desde US-54 el helper también siembra.** Si el email no existe, crea el
usuario con el id, `name`, `is_active` y timestamps del snapshot, la
contraseña demo y el permiso `customer`, sin perfil. Los snapshots
siguientes con ese email ya lo remapean. Así entran **4
`customer2@demo.com`** y **5 `customer3@demo.com`**, autores de 65 de las
85 reseñas. La generación falla si el snapshot no trae email, si su id no es
válido o si su id ya es de **otro** email:

```
  - reviews 85.user: 'customer2@demo.com' trae el id 3, que ya es de 'admin@demo.com'
```

Quedan 5 usuarios y 8 filas en `permission_user`. Por eso `GET /users` y
`getUsersToNotify` pasan de 3 a 5.

Desde US-63 el helper acepta permisos extra para los usuarios que siembra.
Los 6 owners de `ownership-transfer.json` (42 `shop@gmail.com`, 45
`demobook@gmail.com`, 48 `mack@gmail.com`, 49 `jack@gmail.com`, 51
`joel@joelmale.com` y 53 `lamp@gmail.com`) entran con `customer` y
`store_owner`: en el mock son dueños de tienda. Quedan **11 usuarios** y
**20 filas** en `permission_user`, y `/vendors/list` pasa de 2 a 8. Un
owner cuyo email ya existe en el seed solo se acepta si su id del mock está
en la tabla de remapeo de D-4 (`6 → 3`); si no, la generación falla:

```
  - ownership_transfers 10.previous_owner: 'CUSTOMER@DEMO.COM' (id 48) choca con el usuario 2 del seed
```

## Avisos de tienda: `store_notices` y sus tres pivotes

Desde US-51, los avisos que el super admin (o un dueño, para su tienda)
publica en la barra superior del panel.

- **`store_notices`**: 3 filas, las tres creadas por el admin (`created_by`
  6 → 3 por email). Lleva tres CHECK: `priority ∈ {high, medium, low}`,
  `type ∈ {all_vendor, specific_vendor, all_shop, specific_shop}` y la
  vigencia `effective_from <= expired_at`. `created_by` es `RESTRICT`: un
  aviso que otros ya leyeron no se queda sin autor. `updated_by` es `SET
  NULL`. `effective_from`/`expired_at` se siembran como los literales del
  mock, sin zona, que Postgres toma en UTC (la zona de la imagen).
- **`store_notice_user`** (6 filas) y **`store_notice_shop`** (0): los
  destinatarios. El `type` decide cuáles: `all_vendor` va a todos los
  usuarios con permiso `store_owner` (en el seed eran el 1 y el 3, que es
  exactamente el `users[]` del mock tras el remapeo; desde US-63 son 8); `specific_*` va a los
  ids que se envían; `all_shop` va a todas las tiendas.
- **`store_notice_read`** (6 filas, 3 leídas): si cada usuario leyó el
  aviso. El `is_read` que emite la API es el de **quien consulta**, no uno
  global. Lo marca la ruta `POST /store-notices/read`.

Los tres pivotes son puros (PK compuesta, FK en CASCADE, solo `created_at`),
calco de `permission_user`.

## Cupones: `coupons`

Desde US-52, primera tabla del dominio transaccional. 10 filas del mock,
ids 10→1: tienda 1 → 6, tienda 2 → 2, tienda 3 → 2; las 10 aprobadas y
una (`4OFF`) con `target`.

- **`is_valid` no es columna.** La API lo calcula en cada lectura:
  vigente ⇔ `active_from <= now() < expire_at`, con el reloj de
  `packages/db/src/clock.ts`. `POST /coupons/verify` exige además
  `is_approve` y `sub_total >= minimum_cart_amount`.
- **El seed desplaza la vigencia +5 años** (US-68, decisión del dueño). Los
  `expire_at` del mock son anteriores a 2025-06, así que sembrados tal cual
  las 10 filas salían con `is_valid: false` y `/offers` quedaba vacía. El
  generador suma `DESPLAZAMIENTO_CUPONES_ANIOS` (5) a `active_from` y
  `expire_at`, y conserva duración, ids y orden. Quedan vigentes hasta el
  2029-03-28 (`4OFF`, el primero en vencer). La constante es fija para que
  `seed.sql` sea determinista: si el generador avisa de que alguno ya no
  está vigente, hay que subirla.
- **`image` es `json`, no `jsonb`** (D-5 del Épico 46): dos filas traen
  `{thumbnail, original, id}` y `jsonb` reordenaría las claves. Por eso el
  generador la emite con `jsonTal()` (`::json`), no con `json()`, que
  castea a `jsonb` antes de llegar a la columna.
- **CHECK**: `type ∈ {fixed, percentage, free_shipping}`, `amount >= 0`,
  `minimum_cart_amount >= 0` y `expire_at > active_from`. `code` es
  UNIQUE.
- **FK**: `shop_id` en CASCADE (como `products.shop_id`; `NULL` = cupón
  global de super_admin) y `user_id` en SET NULL. `orders.coupon_id`
  todavía no existe (US-58).

## Lista de deseos: `wishlists`

Desde US-53, un pivote puro usuario ↔ producto: PK `(user_id, product_id)`,
las dos FK en CASCADE (un favorito no sobrevive a su usuario ni a su
producto) y solo `created_at`, que ordena la lista (más reciente primero).
Calco de `permission_user`/`product_tag`.

- **Dueño elegido del seed.** `wishlists.json` trae 10 productos sin dueño
  (no hay `user_id` ni pivote). El generador se los da a
  `customer@demo.com` (id 2), el único cliente, resuelto por email (D-4).
  El admin y el dueño de tienda empiezan con la lista vacía.
- **Orden determinista.** La fila *i* del archivo recibe `2024-01-01 +
  (10 − i)` minutos, así `ORDER BY created_at DESC` reproduce el orden del
  mock: 945, 941, 755, 569, 400, 313, 155, 111, 110, 104.
- El generador valida que cada producto exista y que no haya pares
  repetidos.

## Reseñas y reportes de abuso: `reviews` y `abusive_reports`

Desde US-54. **`reviews`**: 85 filas, ids 85→1. Por autor: 2 → 20, 4 → 38,
5 → 27. Por rating: 12/4/12/10/47. La tienda 6 tiene 49.

- **CASCADE en `user_id`, `shop_id` y `product_id`**: la reseña es
  contenido de su autor sobre un producto de una tienda. `shop_id` debe ser
  la tienda del producto; el generador y la API lo validan.
- **`order_id` y `variation_option_id` sin FK**: `orders` llega en US-58 y
  no hay tabla de variaciones. En el seed son `null`.
- **Una reseña por compra.** El índice único de expresión
  `reviews_autor_producto_orden_key (user_id, product_id, COALESCE(order_id,
  0))` admite una reseña sin orden por producto y una por cada orden.
  Prisma no lo modela y `migrate diff` no lo acusa como drift, igual que
  `users_email_lower_idx`.
- **`photos` es `json`, no `jsonb`** (D-5), con `CHECK (json_typeof(photos)
  = 'array')`. `rating` va de 1 a 5.
- **Los contadores de feedback son columnas** (112/13 en la reseña 2): no hay
  filas de votos que los respalden y `feedbacks` es un stub fuera del épico.

**`abusive_reports`**: 3 filas, todas del cliente (2), sobre las reseñas 1,
21 y 78. Es **polimórfica** (`model_type` + `model_id`, sin FK): el
repositorio valida que el objeto exista. `model_type` guarda el nombre
corto (`'Review'`, y `'Question'` desde US-55). El generador normaliza el
FQCN de Laravel (`MarvelDatabaseModelsReview`) y la API lo vuelve a
emitir así. Hay un reporte por usuario y objeto, y borrar una reseña borra
sus reportes en la misma transacción.

## Preguntas sobre productos: `questions`

Desde US-55. 68 filas, ids 68→1. Por autor: 2 → 54 y 4 → 14 (el 4,
`customer2@demo.com`, lo siembra el bloque de reseñas, así que aquí el
helper solo remapea; si tuviera que sembrar, la generación para). El
producto 1 tiene 6 y la tienda 6, 39.

- **CASCADE en las tres FK**, por el mismo criterio que `reviews`, y
  `shop_id` debe ser la tienda del producto.
- **Sin UNIQUE (user, product)**: el mock trae 20 pares repetidos legítimos.
- **`answer` NULL = sin responder.** Una pregunta nueva nace así; en el seed
  las 68 tienen respuesta.
- **Búsqueda**: índice trigram `questions_question_trgm_idx` sobre
  `lower(question)`, como `products_nombre_trgm_idx`. El `ILIKE` que genera
  Prisma con `contains` + `insensitive` **no** lo usa (`EXPLAIN`: `Seq
  Scan`, también con `enable_seqscan=off`); `lower(question) LIKE` sí. Con
  68 filas no importa; es el mismo caso que el índice de productos.
- **Reportable**: `abusive_reports` admite `model_type = 'Question'` y borrar
  una pregunta borra sus reportes en la misma transacción.

## Mensajería cliente ↔ tienda: `conversations` y `messages`

Desde US-56. Un solo agregado: la conversación de un usuario con una tienda
y sus mensajes.

- **`conversations`**: 2 filas, las dos del admin (el 6 del mock es
  `admin@demo.com`, aquí el 3): la 1 con la tienda 7 y la 6 con la tienda 2.
  `UNIQUE (user_id, shop_id)`: una conversación por par, y el `POST` la
  reutiliza.
- **`messages`**: 5 filas, todas de la conversación 1. El autor 6 del mock
  se resuelve por el `user` de la conversación embebida (→ 3); el 1 ya
  existía. `CHECK (length(btrim(body)) > 0)`.
- **CASCADE en todas las FK** (usuario, tienda, conversación).
- **`latest_message` y `unseen` no son columnas.** El mock los traía
  incoherentes: el `latest_message` de la 1 decía el mensaje 2 con el texto
  del 5, y el de la 6 apuntaba a un mensaje que no existe. La API los
  calcula. `unseen` depende de quién consulta (ver abajo).
- **Estado de lectura: `conversation_reads`** (US-64). Una fila por
  (conversación, usuario) con `last_seen_at`, la última vez que ese
  participante la leyó (`POST /messages/seen/:id`); calco de
  `store_notice_read`. Va por participante porque cliente y tienda tienen
  cada uno su «sin leer». Arranca vacía: el mock no trae lecturas. Para
  quien consulta, `unseen` vale 0 si no hay mensajes, si el último es suyo o
  si su `last_seen_at` es igual o posterior al `created_at` de ese mensaje;
  1 en cualquier otro caso. Con el seed queda como antes: el admin ve 0 en
  las dos conversaciones y el dueño de la tienda 7, 1 en la 1.
- **Fechas sin zona.** La conversación 6 trae `"2023-03-21 15:00:08"`. El
  generador la fija en **UTC** (le añade la `Z`). El mock, en cambio, la
  interpretaba con la zona del proceso Node: en un equipo en UTC−5 salía
  `20:00:08Z`. La diferencia son esas 5 horas.
- **Escribir un mensaje** sube `conversations.updated_at` en la misma
  transacción, para que la conversación suba al ordenar por `updated_at`.

## Catálogo de estados de pedido: `order_statuses`

Desde US-57. 10 filas con los ids, los seriales y las fechas del mock.

- **`serial`** es la posición en el flujo: `UNIQUE` y `CHECK (serial >
  0)`. La lista se ordena por él, no por `id`: el 7 «Delivered» lleva el
  serial 11 y va al final (el serial 7 no existe).
- **`slug`** es `UNIQUE` y se regenera al renombrar (a diferencia de
  `tags`, donde es inmutable).
- **`color`** con `CHECK (color ~ '^#[0-9a-fA-F]{6}$')`.
- **No es el vocabulario de `orders.order_status`.** Las órdenes usan el
  enum `OrderStatusType` de la API (`order-pending`, `order-completed`…);
  este catálogo usa otros slugs (`order-received`, `delivered`…). No hay
  FK entre las dos, y borrar un estado no afecta a ninguna orden.
- `translated_languages` no es columna: la API lo emite como `['en']`.

## Órdenes: `orders` y `order_products`

Desde US-58. Es el núcleo transaccional.

- **Padre e hija en la misma tabla**, como en Pickbazar. El padre agrupa la
  compra y no tiene tienda; cada hija es la parte de una tienda.
  `CHECK orders_padre_o_hija`: sin `parent_id` ⇔ sin `shop_id`. El seed
  trae 20 padres con 1 hija cada uno (ids 5..49) y `parent_id` en
  `CASCADE`: borrar el padre arrastra las hijas.
- **Snapshots en `json`, no en `jsonb`.** `customer_snapshot` (el
  `customer` embebido, verbatim: la orden 41 conserva `id: 6` aunque su
  `customer_id` sea 3) y `order_products.product_snapshot` (el producto en
  el momento de la compra, sin su `pivot`). `jsonb` reordena las claves y
  el contrato emite las 43 del producto y las 9 del cliente en el orden del
  mock. Las direcciones también son `json`: en 8 órdenes son `[]`
  (pedidos digitales).
- **Dinero en `numeric` sin escala**: el mock trae 3 decimales (`sales_tax
  0.044`, `total 52.244`). `cancelled_*` son `numeric(12,2)` porque el
  contrato los emite como string `"0.00"`.
- **Estados**: `order_status`, `payment_status` y `payment_gateway` llevan
  CHECK con los enums de la API (`orders/entities/order.entity.ts`), no el
  catálogo `order_statuses`.
- **`order_products`**: PK `(order_id, line_no)`, con `line_no` = posición en
  el `products[]` del mock. `variation_option_id` sin FK (no hay tabla de
  variaciones).
- **FK y borrados**: cliente `SET NULL` (la orden es histórica, y `NULL` es
  también el invitado); tienda `RESTRICT` (no hay `deleteShop`); cupón
  `SET NULL`; producto de una línea `SET NULL`, para que `DELETE
  /products/:id` siga funcionando con productos vendidos.
- **`reviews.order_id` ya tiene FK** (`reviews_order_id_fkey`, `SET NULL`).
  Se añade con un bloque `DO $$ … IF NOT EXISTS` después de `CREATE TABLE
  orders`, para no tocar el `CREATE TABLE reviews` y que el archivo siga
  siendo idempotente. Ojo: si el autor ya tiene una reseña **sin orden** del
  mismo producto, borrar la orden falla, porque el `SET NULL` choca con
  `reviews_autor_producto_orden_key`. Desde US-59, `DELETE /orders/:id`
  responde **409** en ese caso y no borra nada (ni la orden ni la reseña).

### Checkout y stock (US-59)

Sin cambios de esquema: `POST /orders` y `checkout/verify` escriben y leen
estas mismas tablas.

- **El precio lo fija la base.** `simple`: `sale_price ?? price` de la fila
  viva; con variación (no hay tabla de variaciones), el `unit_price` del
  cliente solo si cae en `[min_price, max_price]`. Una línea es no
  disponible si el producto no existe, no está en `publish`, tiene
  `in_stock = false` o le falta stock.
- **Impuesto**: la fila de `taxes` con `id = settings.taxClass` (texto en el
  `jsonb`). `sales_tax = amount × rate / 100`, sin redondear y **sin**
  aplicarlo al envío aunque `on_shipping` sea `true`: así está en las 20
  órdenes del mock.
- **Envío**: la fila de `shippings` con `id = settings.shippingClass`
  (`fixed`, `percentage` o `free`), o 0 si no hay dirección (`[]`/`{}`,
  pedido digital), si aplica `freeShipping` por umbral o si el cupón es
  `free_shipping`.
- **Cupón**: aprobado, vigente (`active_from <= now() < expire_at`), sobre
  su `minimum_cart_amount` y, si es de una tienda, con alguna línea de ella.
  `fixed` descuenta hasta el `amount`; `percentage`, el porcentaje.
- **Hijas**: una por tienda (`products.shop_id`), con sus líneas, `amount`
  = suma de sus líneas y `sales_tax`, `delivery_fee` y `discount` en 0.
  Las líneas van en el padre **y** en su hija, como en el mock.
- **Stock**: en la misma transacción que la orden, `UPDATE products SET
  quantity = quantity − n, sold_quantity = sold_quantity + n WHERE quantity
  >= n`. Si otra compra se adelantó, rollback y 409. El snapshot de la línea
  guarda el producto **antes** del descuento. Borrar o cancelar una orden
  **no** repone stock.
- **Número de seguimiento**: `YYYYMMDD` (UTC) + 6 dígitos al azar, único;
  hasta 5 intentos.

## Descargas digitales: `order_files`

Desde US-60. 10 filas con los ids y las fechas del mock, todas de
`customer@demo.com` (2) y sin orden.

- Una fila es el derecho de un cliente a descargar un archivo comprado. La
  API solo le muestra las suyas, también al admin.
- **`digital_file_id` no es UNIQUE**: el mock repite el 42 (filas 4, 5, 9 y
  10) y el 2 (filas 2 y 8). La descarga toma la primera por `id`. No hay
  tabla `digital_files`: ningún mock la respalda.
- **`file` en `json`, no en `jsonb`**: es el snapshot del archivo con su
  `fileable` (un producto o una variación), y el orden de sus claves es
  contrato. Sus fechas anidadas conservan los 6 decimales del mock.
- FK: el cliente es `CASCADE` (la descarga es suya); la orden, `SET NULL`.
- Esta US no crea filas al completar una orden: eso queda fuera.

## Retiros de tienda: `withdraws`

Desde US-62. 2 filas con los ids y las fechas del mock, las dos de la tienda
3 (Bags Shop): la 1 `approved` (300) y la 2 `pending` (10).

- Un retiro es lo que una tienda pide cobrar. El super admin ve todos y les
  cambia el estado; el dueño solo ve y pide los de sus tiendas, y solo borra
  los `pending`.
- **`status` en minúscula**: `pending`, `approved`, `on_hold`, `rejected`
  o `processing` (CHECK). Es el vocabulario del dato y del admin, no el
  TitleCase del enum de la entidad Nest. El generador falla con `'Pending'`.
- `amount` es `numeric(12,2)` con `CHECK (amount > 0)`.
- **Sin balance**: no hay tabla de balances, así que aprobar no descuenta
  nada (decisión 4 del épico).
- Sin `deleted_at`: se borra de verdad. La tienda es `CASCADE`.

## Transferencias de propiedad: `ownership_transfers`

Desde US-63. 6 solicitudes `pending` con los ids del mock (5-10), sin tienda
(`shop_id` NULL: el mock no lo trae) y creadas por el admin (`created_by`
6 → 3 por la tabla de D-4).

- **Owners**: `previous_owner_id` es el 3 en 4 filas y el 48 y el 53 en una
  cada uno; `current_owner_id` es el 51 en 3 filas y el 49, el 45 y el 42 en
  una cada uno. Los 6 que no son el admin se siembran (ver Identidad).
- **`balance_info` es una foto histórica** (D-5): no se proyecta de ninguna
  tabla ni se valida su `shop_id: 22`. Va en `json`, no en `jsonb`, igual
  que los otros `*_info`, porque el orden de sus claves es contrato.
  `payment_info` sigue siendo un string dentro.
- **Timestamps derivados**: el mock no los trae; el seed los toma del
  `transaction_identifier` (`YYYY-MM-DD-NNNN` → ese día a las 00:00 UTC), y
  la API no los emite.
- `status` en minúscula: `pending`, `processing`, `approved` o `rejected`
  (CHECK). `CHECK (previous_owner_id <> current_owner_id)`.
- FK: los tres usuarios son `RESTRICT` (el historial no se pierde); la
  tienda, `SET NULL`.
- `POST /transfer-shop-ownership` es la única escritura sobre
  `shops.owner_id`: en una transacción cambia el dueño e inserta la fila
  `approved`. Aprobar una solicitud por `PUT` no mueve la tienda.

## Cómo se adapta el scraper

**El seed contiene solo datos de la aplicación.** El scraper no aporta filas
aquí: es él quien debe encajar en esta taxonomía.

El type `gadget` ya trae diez categorías que cubren lo que los spiders
recolectan. El método `categorizar()` de cada spider debe devolver **estos
slugs**, no inventar los suyos:

| Lo que produce el spider | Categoría que ya existe |
|---|---|
| portátiles | `laptop` |
| celulares | `mobiles` |
| monitores | `monitor` |
| gaming / consolas | `console` |
| audio / parlantes | `headphone`, `sound-box` |
| cámaras | `camera` |
| redes | `router` |
| relojes | `smart-watch` |
| periféricos y demás | `accessories-gfa` |

Lo que el scraper **sí** crea en tiempo de ejecución, porque es genuinamente
suyo y no existe en la app:

- **Los retailers como `shops`** (Alkosto, Éxito, Falabella, CompuLago,
  CompuWorking, Tauret). Ninguno es un shop de Pickbazar.
- **Las marcas como `manufacturers`**. Las 14 del mock son casi todas
  editoriales de libros; no hay ni una marca de tecnología real.
- **Las filas de `category_product`**, que la app dejó vacías.

## Decisión pendiente: la moneda

`settings.options.currency` es **`USD` con 2 decimales**, tal como lo trae la
app. Los precios que scrapea el worker son **pesos colombianos sin decimales**.

Pickbazar asume una única moneda para todo el marketplace, así que hay tres
salidas y ninguna es gratis:

1. **Cambiar el setting a `COP` / `es-CO` / 0 decimales.** Lo más simple, pero
   los 1200 productos del mock (con precios de 2 a 421 USD) quedarían
   mostrándose como si fueran pesos.
2. **Convertir los precios scrapeados a USD** al guardarlos. Coherente con el
   mock, pero introduce una tasa de cambio que hay que mantener.
3. **Moneda por producto.** Lo correcto de verdad, pero se desvía del modelo de
   Pickbazar y obliga a tocar el formateo en el frontend.

Es una decisión de producto, no técnica.
