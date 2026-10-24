# @safari/db — la capa de datos del catálogo

Paquete **autónomo** (fuera del workspace de yarn de `apps/`) que expone el
acceso a Postgres vía Prisma 7 + `@prisma/adapter-pg`: un cliente singleton
y repositorios de **funciones planas** por agregado.

```bash
cd packages/db
npm install           # dependencias propias (NO forma parte de apps/)
npm run build         # prisma generate + tsup → dist/ (CJS + .d.ts)
npm run typecheck     # tsc --noEmit
npm test              # integración contra el Postgres del docker-compose
npm run dev           # tsup --watch, para iterar
```

`dist/` y `generated/` están gitignored, así que tras clonar hay que
construirlos. El script `prepare` los genera en una instalación **limpia** (y
cuando otro paquete instala este por `file:`), pero **npm se salta los
lifecycle scripts si el árbol de dependencias ya está al día**: en un `npm
install` repetido no pasa nada. El comando fiable es siempre explícito:

```bash
npm run build      # o, desde la raíz del repo:  just db-build
```

Requiere la base corriendo y sembrada: `just db-up` en la raíz del repo.
La conexión sale de `DATABASE_URL` (ver `.env.example`).

## Estructura

```
index.ts                        barrel explícito (el único entry point)
prisma/schema.prisma            introspección de la base, revisada a mano
generated/                      cliente Prisma (gitignored; `npm run generate`)
src/
  client.ts                     singleton lazy de PrismaClient (adapter pg)
  clock.ts                      now() inyectable para tests (alcance de
                                 _setNowProvider documentado en su cabecera,
                                 US-32 CA-3)
  errors.ts                     parseo/clasificación de errores de Prisma
  health.ts                     pingDatabase() para /health endpoints
  pagination.ts                 buildPaginator() — el envoltorio del mock
  records.ts                    frontera de serialización (tipos *Record)
  repositories/
    products.repository.ts      listado con filtros, detalle, upsert scraper
    categories.repository.ts    árbol y listado por type.slug
    types|shops|manufacturers|tags.repository.ts
    settings.repository.ts      la fila única
    products.integration.test.ts
```

## Decisiones

### `Decimal` y `BigInt` nunca cruzan la frontera

Los repositorios no devuelven filas crudas de Prisma sino **records**
(`src/records.ts`) que son JSON-safe por construcción:

- **`numeric(12,2)` (precios) → `number`.** El frontend de Pickbazar espera
  `price: 40.5` como número JSON, igual que lo sirve el mock. Con 12 dígitos
  y 2 decimales un double lo representa sin pérdida práctica. Si algún día
  se necesitara aritmética exacta río abajo, el punto único de cambio es
  `_dec()` en `records.ts` (pasar a `string`).
- **`bigserial` (ids) → `number`.** `JSON.stringify` revienta con BigInt y
  los ids reales están lejos de `MAX_SAFE_INTEGER`.
- Las fechas quedan como `Date`; el framework consumidor las serializa a
  ISO-8601 solo.

### Paginación: el contrato del mock, calcado

`buildPaginator()` reproduce **exactamente** la aritmética y las claves de
`apps/api/rest/src/common/pagination/paginate.ts` (`total`, `current_page`,
`count`, `last_page`, `per_page`, `firstItem`, `lastItem`, `*_page_url`) —
incluida su rareza de que `prev_page_url` apunta a la página actual — para
que la API real pueda sustituir el mock sin cambiar su contrato. Los
repositorios devuelven `{ items, total }` y el caller arma el envoltorio:

```ts
const { items, total } = await listProducts({ typeSlug: 'gadget', page, limit });
return buildPaginator({ data: items, total, page, limit, baseUrl });
```

Offset-based, `limit` default 30, como el mock. Las `*_page_url` son `null`
si no se pasa `baseUrl` (APP_URL es configuración de la app, no de la capa
de datos).

### `db/schema.sql` sigue siendo la verdad — Prisma NO migra

La base la crea y la siembra `just db-migrate` aplicando `db/schema.sql` +
`db/seed.sql`. Este paquete **no tiene `prisma/migrations/` a propósito** y
no debe tenerlo mientras ese flujo exista: dos dueños del DDL es una receta
para drift. El `schema.prisma` es un **espejo introspectado** (`prisma db
pull`), luego revisado a mano (modelos PascalCase, campos camelCase con
`@map`, relaciones con nombre). Si `db/schema.sql` cambia:

```bash
just db-reset                  # re-crea la base con el DDL nuevo
cd packages/db
npx prisma db pull             # OJO: pisa los renombres manuales
# re-aplicar renombres/@map revisando el diff, luego:
npm run generate && npm test
```

No usar `prisma migrate dev` ni `prisma db push` contra esta base.

### Lo que Prisma no modela (y cómo se cubre)

- **El índice único parcial** `products_procedencia_key`
  (`(source_store, source_product_id) WHERE source_store IS NOT NULL`) sí
  quedó en el schema, pero solo gracias al preview feature `partialIndexes`
  que la introspección de Prisma 7 activó. No quitar el preview: sin él
  Prisma trataría el unique como total. `upsertScrapedProduct` opera sobre
  esa clave y está cubierto por el test de integración.
- **Los CHECK constraints** (`products_rebaja_valida`,
  `products_simple_con_precio`, `products_procedencia_completa`, y desde
  US-47 `faqs_faq_type_check` y `terms_and_conditions_type_check`, y desde
  US-48 `refund_policies_target_check` y `refund_policies_status_check`, y
  desde US-49 `taxes_rate_check`, `shippings_amount_check` y
  `shippings_type_check`, y desde US-51 `store_notices_priority_check`,
  `store_notices_type_check` y `store_notices_vigencia_valida`, y desde
  US-52 `coupons_type_check`, `coupons_amount_check`,
  `coupons_minimum_cart_amount_check` y `coupons_vigencia_valida`, y desde
  US-54 `reviews_rating_check`, `reviews_photos_check`, los dos
  `reviews_*_feedbacks_count_check`, `abusive_reports_model_type_check` y
  `abusive_reports_message_check`, y desde US-55 `questions_question_check` y
  los dos `questions_*_feedbacks_count_check`, y desde US-56
  `messages_body_check`, y desde US-57 `order_statuses_serial_check` y
  `order_statuses_color_check`, y desde US-58 los de `orders` (tracking de
  14 dígitos, dinero ≥ 0, los tres enums, direcciones `object|array` y
  `orders_padre_o_hija`) y los de `order_products` (`line_no`,
  `order_quantity`, `unit_price`, `subtotal`)) no existen
  para Prisma. Los repositorios los validan antes de escribir (tipos +
  guard de `salePrice < price`) y traducen la violación que llegue de
  Postgres a errores de dominio: `InvalidSalePriceError`,
  `MissingPriceError`, `IncompleteProvenanceError`. Los CHECK de valor
  simple, que solo restringen un campo a una lista o a un rango, usan la
  clase genérica `InvalidFieldValueError(aggregate, field, value,
  constraint)` de `domain-errors.ts`, con `code = InvalidReference` (400).
  Un agregado nuevo no necesita su propia clase. Las tres de `products` se
  quedan aparte porque sus reglas cruzan varios campos.
- **El índice trgm** `products_nombre_trgm_idx` (expresión) tampoco: la
  búsqueda por nombre usa `contains` + `mode: 'insensitive'`, que Postgres
  resuelve con ese índice.

### Contenido (US-47, Épico 46) — `faqs` y `terms-and-conditions`

`FaqRecord` y `TermsAndConditionsRecord` (`records.ts`), con dos
repositorios de funciones planas calcados de `tags.repository.ts`:

- `faqs.repository.ts`: `listFaqs`, `findFaqById`, `createFaq`, `updateFaq`
  y `deleteFaq`.
- `terms-and-conditions.repository.ts`: `listTermsAndConditions`,
  `findTermsAndConditionsBySlug`, `createTermsAndConditions`,
  `updateTermsAndConditions`, `deleteTermsAndConditions` y
  `setTermsApproval` (la moderación que el mock mutaba en memoria).

Los listados ordenan por `id ASC` (el orden del mock) y filtran con AND:
`shopId`, tipo e `issuedBy` por igualdad exacta, título con `contains`
insensible a mayúsculas, y `isApproved` en los términos.

**Regla propia: tipo y emisor derivados de la tienda.**
`resolveContentIssuer` resuelve el emisor de lo que se crea:

- sin `shopId`, el contenido es `global` y lo emite `GLOBAL_CONTENT_ISSUER`
  (`'Super Admin'`);
- con `shopId`, es `shop` y el emisor es el nombre de esa tienda;
- una tienda inexistente o un id que no sea entero seguro da
  `InvalidReferenceError` (400) antes de escribir.

Así los CHECK `faqs_faq_type_check` y `terms_and_conditions_type_check` no
pueden violarse desde el paquete. El `slug` es inmutable en las
actualizaciones, y `updatedAt` se fija con `now()` de `clock.ts` (US-32).

### Reembolsos (US-48, Épico 46) — `refund-policies` y `refund-reasons`

`RefundPolicyRecord` y `RefundReasonRecord`, con dos repositorios calcados
de `tags.repository.ts`. Los dos ordenan por `id ASC`, toman el slug del
cuerpo si llega no vacío (el admin lo envía) y lo mantienen inmutable en las
actualizaciones.

- `refund-policies.repository.ts`: `listRefundPolicies` (filtra `target` y
  `status` por igualdad y el título con `contains`), `findRefundPolicyBySlug`,
  `createRefundPolicy`, `updateRefundPolicy` y `deleteRefundPolicy`. Los dos
  CHECK de la tabla se validan antes de escribir con
  `InvalidFieldValueError` (ver «Lo que Prisma no modela»). Los valores
  admitidos se exportan como `REFUND_POLICY_TARGETS` y
  `REFUND_POLICY_STATUSES`.
- `refund-reasons.repository.ts`: `listRefundReasons` (filtra por nombre),
  `findRefundReasonBySlug`, `createRefundReason`, `updateRefundReason` y
  `deleteRefundReason`. Los timestamps son contrato, por eso `update` fija
  `updatedAt` con `now()`.

### Configuración fiscal y de envío (US-49, Épico 46) — `taxes` y `shippings`

`TaxRecord` y `ShippingRecord` (con `rate`/`amount` vía `_dec`), y dos
repositorios gemelos. A diferencia del resto, **los listados no paginan**:
`listTaxes`/`listShippings` devuelven un array (`id ASC`, filtro opcional por
nombre), porque eso es lo que el admin espera. Los demás son
`findTaxById`/`findShippingById`, `create*`, `update*` (fija `updatedAt` con
`now()`) y `delete*`. Los CHECK se validan antes de escribir con
`InvalidFieldValueError`: `rate` no finito o negativo, y `amount` o `type`
fuera de su CHECK. Los tipos válidos se exportan como `SHIPPING_TYPES`.

### Atributos (US-50, Épico 46) — `attributes.repository.ts`

`AttributeRecord` (con `values: AttributeValueRecord[]`, en `id ASC`) y
cinco funciones:

- **`listAttributes`** devuelve un array sin paginar en `id DESC`, con filtro
  por `shopId` y por nombre.
- **`findAttributeByIdOrSlug`** busca por id si el parámetro es un entero
  seguro y por slug si no, como hacía el mock.
- **`createAttribute`** es un único nested write (padre y valores), que
  Prisma ejecuta en una sola transacción: una tienda inexistente da
  `InvalidReferenceError` sin dejar valores sueltos. En ese caso el campo se
  nombra `shop_id` a mano, porque en un nested write el adaptador no informa
  del campo de la FK.
- **`updateAttribute`** reconcilia los valores con el body en un
  `$transaction` de array (precedente `auth-tokens.repository.ts`). Un id del
  atributo se actualiza, un id nulo, ausente o no entero se inserta, y un
  valor existente que no aparece en el body se borra. Un id que pertenece a
  **otro** atributo da `InvalidReferenceError` y no se reasigna. El slug del
  atributo y el de cada valor existente son inmutables.
- **`deleteAttribute`** devuelve el atributo con sus valores; Postgres los
  borra en cascada.

Los slugs de los valores nuevos salen de `generateSlug` con un lookup en
memoria (los existentes del atributo más los ya asignados en el lote), así
que el esquema de sufijos (`-2`, `-3`…) es el mismo del resto del paquete y
se calcula antes de la transacción.

### Avisos de tienda (US-51, Épico 46) — `store-notices.repository.ts`

`StoreNoticeRecord` es la fila plana. `StoreNoticeDetailRecord` le añade lo
que la API emite: el `creator` con sus `permissions`, los `recipients`
(usuarios), las `shops` y los `reads` (estado de lectura por usuario). El
orden de cada relación es fijo: destinatarios y lecturas por `userId DESC`,
tiendas por `shopId ASC` y permisos por `permissionId ASC`.

- **`listStoreNotices`** filtra por texto, por usuario destinatario
  (`userId`), por tienda destinataria (`shopId` o `shopSlug`) y acepta
  `orderBy` (`STORE_NOTICE_SORTABLE`) con desempate por `id DESC`.
- **`findStoreNoticeById`**, **`deleteStoreNotice`** (devuelve el detalle;
  los pivotes caen por CASCADE).
- **`createStoreNotice`**: los destinatarios los decide el `type` (ver
  `db/README.md`), y cada usuario destinatario recibe una lectura en
  `false`. Es un único nested write, así que un id de `receivedBy`
  inexistente da `InvalidReferenceError` sin filas sueltas.
- **`updateStoreNotice`**: si llegan `type` o `receivedBy`, reconcilia los
  pivotes en un `$transaction` y conserva la lectura de quien sigue siendo
  destinatario. Fija `updatedBy` y `updatedAt`.
- **`markStoreNoticeRead`**: upsert de la lectura del usuario.

Los tres CHECK de `store_notices` se validan antes de escribir con
`InvalidFieldValueError`. Los valores admitidos se exportan como
`STORE_NOTICE_PRIORITIES` y `STORE_NOTICE_TYPES`.

### Cupones (US-52, Épico 46) — `coupons.repository.ts`

`CouponRecord` es la fila plana: importes como number (`_dec`), `target`
e `isApprove` booleanos e `image` tal cual sale de la columna `json`, con
su orden de claves. **No trae `isValid`**: depende del reloj y lo calcula la
API con `now()`.

- **`listCoupons`**: paginado en `id DESC`; `shopId` y `code` (parcial,
  case-insensitive) se combinan con AND. `{items, total}`.
- **`findCouponByCode`** (exacto, distingue mayúsculas) y
  **`findCouponById`**: `null` si no existe.
- **`createCoupon`**: nace con `isApprove` en `false`. Un `code`
  repetido da `SlugConflictError` (409) y una tienda inexistente
  `InvalidReferenceError` en `shop_id`.
- **`updateCoupon`**: `shopId`/`userId` no cambian; la vigencia se valida
  contra la fila, así que basta con que cambie una fecha. Fija `updatedAt`.
- **`setCouponApproval`** (moderación) y **`deleteCoupon`** (devuelve la
  fila borrada). Id inexistente ⇒ `RecordNotFoundError`.

Los cuatro CHECK se validan antes de escribir con `InvalidFieldValueError`
(`NaN` y fechas inválidas incluidos). Los tipos admitidos se exportan como
`COUPON_TYPES`. `image: null` se trata como ausente (DD-5, como `tags`).

### Lista de deseos (US-53, Épico 46) — `wishlists.repository.ts`

No hay `WishlistRecord`: el pivote no se expone. Las lecturas devuelven
`ProductRecord` con el mismo include (`PRODUCT_INCLUDE`, exportado desde
`products.repository.ts` solo para uso interno del paquete) y el mismo
`_toProductRecord`, así que la API proyecta el contrato de `/products` sin
duplicarlo. Todo va por usuario.

- **`listWishlistProducts(userId, {page, limit})`**: `created_at DESC`,
  desempate `product_id DESC`; `limit` 30 por defecto. `{items, total}`.
- **`isInWishlist`** (booleano) y **`findWishlistProduct`** (el producto o
  `null` si no está en la lista).
- **`addToWishlist`**: idempotente (`skipDuplicates`); devuelve el producto.
- **`removeFromWishlist`**: devuelve el producto; si no estaba,
  `RecordNotFoundError('wishlists', id)`.
- **`toggleWishlist`**: devuelve el estado nuevo (`true` = ahora está).

Un producto inexistente da `RecordNotFoundError('products', id)` en las tres
escrituras.

### Reseñas (US-54, Épico 46) — `reviews.repository.ts`

`ReviewRecord` es la fila plana: `photos` tal cual sale de la columna
`json`, con su orden de claves. Las lecturas devuelven
`ReviewDetailRecord`, que añade el autor (`UserRecord`), el producto
hidratado (`ProductRecord`, con el mismo `PRODUCT_INCLUDE`) y
`abusiveReportsCount`. El conteo sale de **un** `groupBy` sobre
`abusive_reports` por página, no de una consulta por reseña: la tabla es
polimórfica y no hay relación para `_count`.

- **`listReviews`**: paginado en `id DESC` (`limit` 30). Filtra por
  `productId`, `shopId`, `rating` y `typeSlug` (el type del producto),
  combinados con AND.
- **`findReviewById`**: `null` si no existe.
- **`createReview`**: el producto debe existir (`RecordNotFoundError`) y
  `shopId` debe ser su tienda (`InvalidFieldValueError`). Si se repiten
  usuario, producto y orden, da `SlugConflictError` (el único de expresión).
- **`updateReview`**: solo `rating`, `comment` y `photos`; fija `updatedAt`.
- **`deleteReview`**: borra la reseña y sus reportes en un `$transaction`
  y la devuelve.

`rating` (1..5) y `photos` (array) se validan con `InvalidFieldValueError`.

### Reportes de abuso (US-54) — `abusive-reports.repository.ts`

`AbusiveReportRecord` es la fila plana (`modelType` corto) y
`AbusiveReportDetailRecord` le añade el autor.

- **`listAbusiveReports`** (`id DESC`, moderación) y
  **`listAbusiveReportsByUser`** (`created_at DESC`, `/my-reports`).
- **`findAbusiveReportById`**, **`updateAbusiveReport`** (solo
  `message`) y **`deleteAbusiveReport`** (devuelve la fila).
- **`createAbusiveReport`**: valida el objeto con
  **`assertReportableExists`**. Una reseña inexistente da
  `RecordNotFoundError`. `'Question'` y cualquier otro tipo dan
  `InvalidFieldValueError`. Desde US-55, `'Question'` se valida contra
  `questions` y una pregunta inexistente da `RecordNotFoundError`. Un
  reporte repetido da `SlugConflictError`.
- **`rejectAbusiveReports(modelType, modelId)`** (US-65): rechazar es
  borrar **todos** los reportes de un objeto y dejar el objeto intacto, lo
  opuesto de «aceptar», que borra la reseña. Valida el objeto con
  `assertReportableExists` y borra en un solo `deleteMany`; devuelve
  cuántos borró (0 si no tenía). Como la fila desaparece, el UNIQUE deja
  volver a reportarlo.
- **`_countReports(modelType, ids)`** (interno del paquete): el `groupBy`
  que usan reseñas y preguntas para su `abusiveReportsCount`.

`message` vacío se rechaza con `InvalidFieldValueError`. Los tipos
admitidos por el CHECK se exportan como `REPORTABLE_MODEL_TYPES`.

### Preguntas (US-55, Épico 46) — `questions.repository.ts`

`QuestionRecord` es la fila plana (`answer` null = sin responder). Las
lecturas devuelven `QuestionDetailRecord`, con el autor, el producto
hidratado y `abusiveReportsCount`, igual que las reseñas.

- **`listQuestions`**: paginado en `id DESC` (`limit` 10). Filtra por
  `productId`, `shopId`, `question` (parcial, case-insensitive) y
  `typeSlug`, combinados con AND.
- **`listUserQuestions(userId)`**: `created_at DESC, id DESC` (`limit` 8).
- **`findQuestionById`**: `null` si no existe.
- **`createQuestion`**: nace sin respuesta. El producto debe existir y
  `shopId` debe ser su tienda.
- **`answerQuestion`** (responde, y cambia `question` solo si llega) y
  **`updateQuestionText`** (el autor; no toca la respuesta). Las dos fijan
  `updatedAt`.
- **`deleteQuestion`**: borra la pregunta y sus reportes en un
  `$transaction`.

`question` vacía se rechaza con `InvalidFieldValueError`. No hay UNIQUE: un
usuario puede preguntar varias veces sobre el mismo producto.

### Mensajería (US-56, Épico 46) — `conversations.repository.ts`

Un solo repositorio para el agregado. `ConversationRecord` y `MessageRecord`
son las filas planas. Las lecturas devuelven `ConversationDetailRecord`, con
el usuario, la tienda (`ShopRecord`) y `latestMessage` (o `null`), y
`MessageDetailRecord`, que es el mensaje con su conversación embebida.

- **`latestMessage`** sale de **una** consulta `DISTINCT ON
  (conversation_id) … ORDER BY conversation_id, created_at DESC, id DESC`
  (`$queryRaw`) sobre los ids de la página, servida por
  `messages_conversacion_idx`. Se descartó el `include` con `take: 1`
  porque Prisma trae todos los mensajes de la página y recorta en memoria.
- **Visibilidad** (`ConversationViewer = {userId, seeAll}`): con `seeAll`
  se ve todo; si no, las conversaciones propias y las de las tiendas que el
  usuario posee (`shops.owner_id`).
- **`listConversations`**: paginado (`limit` 15), búsqueda por nombre de
  tienda (`shopName`, case-insensitive) y `orderBy` en
  `CONVERSATION_SORTABLE` (`id`, `created_at`, `updated_at`); sin
  `orderBy`, `id ASC`.
- **`findConversationById(id, viewer?)`**: `null` si no existe o no es
  visible.
- **`findOrCreateConversation(userId, shopId)`**: upsert por el par. Una
  tienda inexistente da `InvalidReferenceError`.
- **`listMessages(conversationId, {page, limit, readerId})`**: `id DESC`,
  paginado; una conversación inexistente da `RecordNotFoundError`.
  `readerId` solo trae la lectura de ese usuario a la conversación embebida.
- **`createMessage`**: inserta y fija `conversations.updated_at = now()` en
  un `$transaction`. Un cuerpo vacío da `InvalidFieldValueError`.
- **`markConversationSeen(id, viewer)`** (US-64): upsert de
  `conversation_reads.last_seen_at = now()`; repetirla solo mueve la marca.
  Devuelve la conversación con esa lectura, o `null` si no existe o no es
  visible, sin escribir nada.

`unseen` no vive aquí: depende de quién consulta y lo calcula la API. Lo que
sí trae cada `ConversationDetailRecord` es `lastSeenAt`, la última lectura
de quien consulta (`viewer.userId`, o `readerId` en los mensajes): `null`
si nunca la marcó o si la consulta no tiene lector. Sale de una sola consulta
por página, como `latestMessage`.

### Estados de pedido (US-57, Épico 46) — `order-statuses.repository.ts`

`OrderStatusRecord` es la fila plana (sin `translated_languages`, que emite
la API).

- **`listOrderStatuses`**: paginado (`limit` 30), búsqueda parcial por
  `name` (case-insensitive) y `orderBy` en `ORDER_STATUS_SORTABLE`
  (`name`, `serial`, `createdAt`, `updatedAt`); sin `orderBy`, `serial
  ASC`. Desempate por `id ASC`.
- **`findOrderStatusBySlug`**: `null` si no existe.
- **`createOrderStatus`**: slug por `generateSlug(name)`. Serial o slug
  repetido dan `SlugConflictError`; un serial no entero positivo o un
  color que no sea `#rrggbb` dan `InvalidFieldValueError`.
- **`updateOrderStatus`**: si llega `name`, **recalcula el slug** sin contar
  la propia fila (renombrar al mismo nombre lo conserva). Fija `updatedAt:
  now()`. Inexistente: `RecordNotFoundError`.
- **`deleteOrderStatus`**: devuelve el snapshot previo. Sin dependientes que
  contar: `orders` no tiene FK hacia esta tabla.

### Órdenes (US-58, Épico 46) — `orders.repository.ts`

Solo lectura; las escrituras son de US-59. `OrderRecord` y
`OrderProductRecord` son las filas planas: el dinero sale como `number` y
los snapshots y las direcciones como `Prisma.JsonValue`. Como son columnas
`json`, Prisma devuelve el objeto con las claves en el orden del texto, y
el integration test lo fija para las 76 líneas.

`OrderDetailRecord` es la orden con `lines` (por `lineNo`), `shop` (solo
las hijas, con el `productsCount` de `toShopDto`, vía el `COUNT_PRODUCTS`
de `shops.repository.ts`) y `children` (por `id`, vacío en las hijas).

- **`listOrders`**: paginado (`limit` 15) en `id DESC`. Sin `shopId` ni
  `trackingNumber`, solo padres; con `shopId`, las hijas de esa tienda;
  con `trackingNumber`, la orden exacta (padre o hija). `customerId` filtra
  siempre que llegue; el aislamiento por cliente lo decide la API.
- **`findOrderByIdOrTracking(number | string)`**: un `number` busca por
  `id` y un `string` por `tracking_number`. `null` si no existe; no
  mira de quién es.

Escrituras (US-59). Reciben las cifras ya calculadas por la API: el dinero
como **texto decimal** (`"0.044"`), para que llegue exacto a `numeric` sin
pasar por `float`. El barrel exporta `Decimal` (el de Prisma) para ese
cálculo.

- **`findProductsForOrder(ids)`**: los productos vivos de un carrito, como
  `ProductRecord`; los inexistentes no vienen.
- **`createOrderWithChildren(input)`**: en un `$transaction`, el padre, una
  hija por tienda con sus líneas y el descuento de stock (`updateMany …
  where quantity >= n`). Sin stock: `InsufficientStockError` (código del
  409) y rollback. Fija `createdAt`/`updatedAt` con `now()` y genera los
  `tracking_number` (`YYYYMMDD` UTC + 6 dígitos, hasta 5 intentos).
- **`setOrderStatus(id, {orderStatus?, paymentStatus?})`**: valida contra
  `ORDER_STATUSES`/`PAYMENT_STATUSES` (`InvalidFieldValueError`) y, en un
  padre, propaga a sus hijas. No se llama `updateOrderStatus` porque ese
  nombre ya es del catálogo de estados (US-57).
- **`markOrderPaid(trackingNumber)`**: `order-processing` +
  `payment-success` en la orden y sus hijas.
- **`deleteOrder(id)`**: devuelve el snapshot previo; hijas y líneas por
  CASCADE. Si el `SET NULL` de `reviews.order_id` chocaría con otra
  reseña del autor sin orden, `SlugConflictError` (409) y no borra nada.

### Descargas (US-60, Épico 46) — `order-files.repository.ts`

`OrderFileRecord` es la fila plana; `file` sale de una columna `json` como
`Prisma.JsonValue`, con las claves en el orden del texto. Solo lectura, y
siempre de un cliente: no hay función que liste las descargas de todos.

- **`listOrderFilesByCustomer(customerId, {page, limit})`**: paginado
  (`limit` 30) en `id ASC`.
- **`findFirstOrderFileByDigitalFileId(digitalFileId, customerId)`**: la
  primera por `id` del cliente con ese `digital_file_id` (se repite entre
  filas), o `null`.

### Transferencias de propiedad (US-63, Épico 46) — `ownership-transfers.repository.ts`

`OwnershipTransferRecord` es la fila plana; los `*Info` salen de columnas
`json` como `Prisma.JsonValue`, con las claves en el orden del texto.
`OwnershipTransferDetailRecord` le añade `previousOwner` y `currentOwner`
(`UserRecord` + `profile`). Quién ve qué es regla de la API, que llega aquí
como el filtro `participantId`.

- **`listOwnershipTransfers({transactionIdentifier, shopId, participantId,
  page, limit})`**: paginado (`limit` 10) en `created_at DESC, id DESC`.
  `transactionIdentifier` es exacto; `participantId` deja las filas donde
  ese usuario es el dueño anterior o el nuevo.
- **`findOwnershipTransferByIdentifier(identifier)`**: o `null`.
- **`createOwnershipTransfer({shopId, currentOwnerId, createdById,
  message})`**: solicitud `pending`; el dueño anterior es el de la tienda,
  leído con `FOR UPDATE` en la misma transacción. No toca `shops`.
- **`updateOwnershipTransfer(id, {status, message})`**: `status` fuera de
  `OWNERSHIP_TRANSFER_STATUSES` da `InvalidFieldValueError`; fija
  `updatedAt: now()`. Tampoco toca `shops`.
- **`deleteOwnershipTransfer(id)`**: borra y devuelve la fila.
- **`transferShopOwnership({shopId, vendorId, createdById, message})`**: en
  una `$transaction` bloquea la tienda, valida al vendedor (existe y tiene
  `store_owner`), cambia `shops.owner_id` e inserta la fila `approved`.
  Devuelve `{shop, owner, transfer}`. Tienda inexistente:
  `RecordNotFoundError` (404); vendedor inválido: 400.

`transaction_identifier` es `YYYY-MM-DD-NNNN` (día UTC de `now()`,
secuencial por día) y se calcula dentro de la transacción; si otra se
adelanta con el mismo número, el UNIQUE da P2002 y la transacción se repite
(hasta 5 veces). `SameOwnerError` (409, reutiliza el código del conflicto)
sale cuando el vendedor ya es el dueño.

### Retiros (US-62, Épico 46) — `withdraws.repository.ts`

`WithdrawRecord` es la fila plana (`amount` con `_dec`: `10`, no `"10.00"`);
`WithdrawDetailRecord` le añade su `shop: ShopRecord`. Quién ve qué es regla
de la API, que llega aquí como el filtro `ownerId`.

- **`listWithdraws({shopId, ownerId, status, page, limit})`**: paginado
  (`limit` 10) en `id DESC`.
- **`findWithdrawById(id)`**: con su tienda, o `null`.
- **`createWithdraw({shopId, amount, paymentMethod, details, note})`**: nace
  `pending`. `amount` fuera de `(0, 1e10)` da `InvalidFieldValueError`
  (400) y un `shopId` inexistente, `InvalidReferenceError` (400).
- **`updateWithdrawStatus(id, status)`**: `status` fuera de
  `WITHDRAW_STATUSES` da `InvalidFieldValueError`; fija `updatedAt: now()`.
  Inexistente: `RecordNotFoundError`.
- **`deleteWithdraw(id)`**: borra y devuelve la fila borrada.

### Dashboard (US-61, Épico 46) — `analytics.repository.ts`

Solo lectura y sin tabla propia. Todo en UTC; «ahora» es el `Date` que
recibe `getDashboardAnalytics` (el servicio pasa `now()` de `clock.ts`).
Solo cuentan órdenes padre (`parent_id IS NULL`). Usa `$queryRaw`
parametrizado porque las ventanas son `count(*) FILTER (...)` y el mes UTC
no se expresa con `groupBy`; los importes salen del `numeric` como texto y
se convierten con `Number`.

- **`getDashboardAnalytics(at)`** → `DashboardAnalyticsRecord`:
  - M-1 `totalRevenue`: Σ `total` de padres `order-completed` con
    `created_at <= at`. M-5 `todaysRevenue`: lo mismo en el día UTC de `at`.
  - M-3 `totalShops` = `count(*)` de `shops`; M-4 `totalVendors` = dueños
    distintos.
  - M-6 `totalOrders`: padres con `created_at <= at`.
  - M-7 `newCustomers`: usuarios con `customer` y sin `super_admin` ni
    `store_owner`, creados en `(at - 30d, at]`.
  - M-8 `ordersByStatus.{today, weekly, monthly, yearly}`: conteo por
    `order_status` en el día UTC, `(at - 7d, at]`, el mes UTC y el año UTC.
    Solo trae los estados con órdenes; la API rellena sus 8 claves.
  - M-9 `salesByMonth`: 12 importes (enero en `[0]`) de M-1 por mes del año
    UTC de `at`.
- **`listCategoryWiseProductCounts({limit})`** (M-10): `category_product ⋈
  products ⋈ categories ⋈ shops` por (categoría, tienda), `product_count
  DESC, category_id ASC, shop_id ASC`. Con el seed da `[]`
  (`category_product` está vacía).
- **`listLowStockProducts({limit, shopId})`** (M-11): `ProductRecord[]` con
  `quantity < 10` en `id ASC`.
- **`listTopRatedProducts({limit, shopId})`** (M-12): `TopRatedProductRecord`
  = producto + `totalRating`, `ratingCount` y `actualRating`
  (`round(avg, 2)`), en `actualRating DESC, ratingCount DESC, id ASC`.

`limit` es 10 por defecto en las tres listas; `shopId` filtra por la tienda
del producto.

### Identidad (US-21, Épico 19) — `users.repository.ts`

Mismo agregado por introspección que el catálogo: `users`, `profiles`,
`permissions`, `permission_user` (sembrados por US-20) sirven ahora
`UserRecord`/`ProfileRecord`/`PermissionRecord` y siete funciones planas
en `src/repositories/users.repository.ts`. `PasswordResetToken` y
`OtpCode` entran como **modelos** de `schema.prisma` solo para que el
gate de drift cierre en 0 — sus repositorios llegan en US-24, no aquí.

**La frontera del hash es estructural, no de convención (D-2 del
épico).** `passwordHash` cruza en un único tipo, `UserCredentials`, que
vive en `users.repository.ts` y **no** en `records.ts` — así la frontera
de serialización del paquete ni siquiera nombra el campo. La única
función que lo devuelve es `findUserCredentialsByEmail`; las otras dos
escrituras (`createUser`, `updateUserPasswordHash`) lo reciben ya
hasheado. Hashear y verificar sigue siendo de `apps/api/rest` (US-22):
`bcryptjs` no entra a este paquete.

**Por qué `findUserCredentialsByEmail` usa `$queryRaw`.** `users.email`
no tiene un índice único total: la unicidad case-insensitive vive en
`users_email_lower_idx`, un índice **de expresión** sobre `lower(email)`
que Prisma no modela (como el trgm de `products`). Evidencia contra
Postgres real: ni `mode: 'insensitive'` (genera `ILIKE`) ni normalizar el
email en JS antes de un `equals` plano (genera `email = $1`) usan ese
índice — solo `WHERE lower(email) = lower($1)` explícito lo hace. Es el
único SQL crudo de dominio del paquete (el precedente ya existente es
`health.ts:21`); `${email}` interpola como parámetro del tagged
template, nunca concatenado. Cualquier consumidor nuevo que necesite
comparar por email hereda esta misma regla (`lower(email) = lower($1)`,
`identity-schema/spec.md`).

`listUsers` sigue el contrato del paquete (D-2 del proposal): devuelve
`{ items, total }`, no el envoltorio de `buildPaginator` — el caller
(el servicio de Nest de US-25) arma el envoltorio con su `baseUrl`.
`createUser` traduce el P2002 del email duplicado a `DuplicateEmailError`
(el índice que lo dispara es de expresión, invisible para Prisma, así
que el código crudo no basta); `updateUserPasswordHash`/`setUserActive`
traducen P2025 a `null`.

### Cómo lo consumirá `apps/api/rest` (paso posterior, NO hecho)

`apps/api/rest` tiene su propio `yarn install` fuera del workspace de
`apps/`, así que la vía simple es **dependencia por ruta relativa**:

```jsonc
// apps/api/rest/package.json
"dependencies": { "@safari/db": "file:../../../packages/db" }
```

Queda una sola cosa por resolver: **`DATABASE_URL` debe llegar al `.env` de la
API**.

## Por qué este paquete se construye (y el de referencia no)

`agenthub-platform/packages/db` no tiene build: sus `exports` apuntan al `.ts`
fuente y funciona, porque sus consumidores son apps Next.js, que bundlean con
SWC y transpilan dependencias.

Aquí el consumidor es **NestJS 9, que compila con `tsc` a secas**, y `tsc` no
transpila archivos que resuelve dentro de `node_modules`: los typechequea y los
deja intactos. Sin build, esto pasa:

```
$ tsc            # exit 0, ni una queja
$ node dist/main.js
SyntaxError: Unexpected token 'export'
   at loadESMFromCJS (node:internal/modules/cjs/loader)
```

La brecha es sutil y merece entenderla: **el compilador que typechequea ignora
el campo `exports` y el runtime que ejecuta lo respeta.** El `tsc` de la API no
declara `moduleResolution`, así que usa resolución `node10`, que no lee
`exports`; al no encontrar `main` ni `types` cae a su fallback de directorio,
localiza `index.ts` y typechequea contra el fuente sin protestar. Node, en
cambio, sí resuelve `exports`, carga el `.ts` y revienta.

De ahí tres detalles del `package.json` que no son decorativos:

- **`main` y `types` en el nivel superior**, no solo dentro de `exports`. Con
  resolución `node10` los `exports` se ignoran; sin `main`/`types` la API
  volvería a leer el `.ts` fuente.
- **Solo formato CJS.** El paquete exporta un singleton con estado (el cliente
  de Prisma): emitir CJS y ESM a la vez abre el *dual package hazard*, con dos
  clientes y dos pools de conexiones. Añadir `'esm'` es una línea en
  `tsup.config.ts` si algún día Next.js consume el paquete directamente.
- **`shims: true` en tsup.** El cliente generado por Prisma 7 arranca con
  `globalThis['__dirname'] = path.dirname(fileURLToPath(import.meta.url))`, y
  `import.meta` no existe en CommonJS: esbuild lo sustituye por un objeto vacío
  y `fileURLToPath(undefined)` lanza un `TypeError` **al cargar el módulo**. El
  build sale en verde y el artefacto no arranca. El shim lo resuelve.

El scraper Python (`services/scraper-worker`) **no** consume este paquete:
sigue hablando SQL directo. `upsertScrapedProduct` existe para cuando la
ingesta se mueva a Node, o para herramientas de administración.
