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
10 types · 12 shops · 198 categorías · 14 manufacturers · 10 tags · 1200 productos · 5 usuarios · 4 permisos
· 1 become_seller · 3 shop_staff · 19 faqs · 5 terms_and_conditions
· 5 refund_policies · 8 refund_reasons · 1 taxes · 1 shippings
· 8 attributes · 27 attribute_values · 3 store_notices (6 destinatarios,
6 lecturas) · 10 coupons · 10 wishlists · 85 reviews · 3 abusive_reports · 68 questions · 2 conversations · 5 messages
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

**Credencial demo**: los 5 usuarios (los 3 de `users.json` y los 2 que
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
  usuarios con permiso `store_owner` (en el seed, el 1 y el 3, que es
  exactamente el `users[]` del mock tras el remapeo); `specific_*` va a los
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
- **El seed está vencido.** Todos los `expire_at` del mock son anteriores
  a 2025-06, así que las 10 filas salen con `is_valid: false` y las
  páginas `/offers` y `/shops/[slug]/offers` del shop, que filtran en
  cliente por `is_valid`, quedan vacías. Es correcto; renovar las fechas
  sería otra US.
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
  calcula. `unseen` es provisional hasta que exista `messages/seen`: vale
  1 si el último mensaje es de otro usuario.
- **Fechas sin zona.** La conversación 6 trae `"2023-03-21 15:00:08"`. El
  generador la fija en **UTC** (le añade la `Z`). El mock, en cambio, la
  interpretaba con la zona del proceso Node: en un equipo en UTC−5 salía
  `20:00:08Z`. La diferencia son esas 5 horas.
- **Escribir un mensaje** sube `conversations.updated_at` en la misma
  transacción, para que la conversación suba al ordenar por `updated_at`.

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
