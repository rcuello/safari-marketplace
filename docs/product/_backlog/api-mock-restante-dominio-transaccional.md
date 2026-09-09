# Idea — API mock restante: contenido, staff y dominio transaccional

> Sin decisión de "se hace" todavía. NO es una US ni un épico. Documenta lo
> que el [Épico 26](../26-escrituras-catalogo-postgres/README.md) dejó
> fuera a propósito, con la evidencia de qué frontend llama a cada módulo,
> para que el siguiente corte se decida con datos y no por número de rutas.

**Origen:** refinamiento del Épico 26 (verificado 2026-09-09 con grep y
`node -e` sobre `apps/shop/src`, `apps/admin/rest/src` y
`apps/api/rest/src`; la API y los frontends estaban apagados — la evidencia
es de referencias estáticas, no de tráfico en runtime).

## El problema

De las **250 rutas** de `apps/api/rest/src`, **78** viven en los 9 módulos
que importan `@safari/db`; el resto sirve JSON estático desde
`src/db/pickbazar/*.json`. Ninguno de esos módulos tiene tabla:
`db/schema.sql:13-16` excluye "wallets, direcciones, órdenes, carritos y
reviews" y dice que "el resto del dominio transaccional sigue fuera".
Levantar esa exclusión es una decisión del dueño del repo, no de una US.

## Qué frontend llama a qué (evidencia)

Método: para cada constante de `API_ENDPOINTS`
(`apps/shop/src/framework/rest/client/api-endpoints.ts`,
`apps/admin/rest/src/data/client/api-endpoints.ts`) se buscaron sus
consumidores en la capa de datos, y para cada hook exportado de
`apps/shop/src/framework/rest/*.ts` y `apps/admin/rest/src/data/*.ts`, sus
consumidores en `pages/` y `components/`. Se cruzó con el menú del admin
(`apps/admin/rest/src/settings/site.settings.ts`) y el del shop
(`apps/shop/src/config/site.ts`).

| Módulo API (rutas) | Shop | Admin | Veredicto |
|---|---|---|---|
| `orders` (17) | `framework/rest/order.ts` → `pages/orders/*`, `components/checkout/place-order-action.tsx` | `data/order.ts` → `pages/orders/*`, `components/dashboard/admin.tsx` | Vivo en ambos |
| `wishlists` (12) | `wishlist.ts` → `favorite-button.tsx`, `wishlist-products.tsx` (`pages/wishlists.tsx`) | — | Vivo (shop) |
| `questions` (10) | `product.ts` (`useQuestions`, `useCreateQuestion`), `question.ts` → `product-questions.tsx`, `pages/questions.tsx` | `data/question.ts` → `pages/questions`, `pages/[shop]/questions` | Vivo en ambos |
| `reviews` (10) | `review.ts` → `product-reviews.tsx`, `review-form.tsx`; `abuse-report.tsx` | `data/review.ts` → `pages/reviews/*` | Vivo en ambos |
| `coupons` (9) | `coupon.ts` → `pages/offers.tsx`, `pages/shops/[slug]/offers.tsx`; `settings.ts` (`useVerifyCoupon`) → `checkout/coupon.tsx`; menú `site.ts:111` | `data/coupon.ts` → `pages/coupons/*`, `approve/disapprove-coupon-view.tsx`; menú `site.settings.ts:440-456` | Vivo en ambos |
| `payment-method` (7) | `card.ts` → `my-cards.tsx`, `stripe-*.tsx` (`pages/cards.tsx`) | — | Vivo (shop); depende de Stripe externo |
| `terms-and-conditions` (7) | `terms-and-conditions.ts` → `pages/terms.tsx`, `pages/shops/[slug]/terms.tsx` | `data/terms-and-condition.ts` → `pages/terms-and-conditions/*`, approve/disapprove views; menú `:335-351` | Vivo en ambos |
| `authors` (6) | `author.ts`: `useAuthors` → `authors-grid.tsx` (`pages/authors/*`), menú `site.ts:119`; `useTopAuthors` → `top-authors-grid.tsx` vía `layouts/compact.tsx:77`, condicionado a `layoutSettings.authors.enable` — **`false` en `types.json` para `books`** (único type `compact`) | `data/author.ts` → `pages/authors/*`, `product-author-input.tsx`; menú `:207-211` (los 3 roles) | **Vivo, no es leftover** (UI alcanzable en ambos); valor bajo para un marketplace de tecnología: solo tiene sentido en `books` y `products` no tiene columna `author_id` |
| `flash-sale` (6) | `flash-sales.ts` → `pages/flash-sales/*`; menú `site.ts:117` | `data/flash-sale.ts`, `data/flash-sale-vendor-request.ts` → `pages/flash-sale/*`; menú `:457-478` (3 roles) | **Vivo, no es leftover**; requiere modelo propio (campañas + productos enrolados + solicitudes de vendedor) |
| `store-notices` (6) | `store-notices.ts` → `notice-highlightedBar.tsx` | `data/store-notice.ts` → `pages/store-notices/*`, `topbar/store-notice-bar.tsx` | Vivo en ambos |
| `attributes` (5) | — | `data/attributes.ts` → `pages/attributes/*`, `product-variable-form.tsx` | Vivo (admin); prerrequisito de las variaciones de producto que el Épico 26 no persiste |
| `faqs` (5) | `faqs.ts` → `pages/help.tsx`, `pages/shops/[slug]/faqs.tsx` | `data/faqs.ts` → `pages/faqs/*` | Vivo en ambos |
| `refund-policies` (5) | `refund-policies.ts` → `pages/customer-refund-policies.tsx`, `vendor-refund-policies.tsx` | `data/refund-policy.ts` → `pages/refund-policies/*` | Vivo en ambos |
| `refund-reasons` (5) | `refund.ts` (`useRefundReason`) → `refund-form.tsx` | `data/refund-reason.ts` → `pages/refund-reasons/*`, `pages/refunds/index.tsx` | Vivo en ambos |
| `shippings` (5) | — | `data/shipping.ts` → `pages/shippings/*`, `pages/settings/*` | Vivo (admin) |
| `taxes` (5) | — | `data/tax.ts` → `pages/taxes/*`, `pages/settings/*` | Vivo (admin) |
| `withdraws` (5) | — | `data/withdraw.ts` → `pages/withdraws/*`, `dashboard/admin.tsx` | Vivo (admin); depende de `balance` (sin tabla) |
| `ownership-transfer` (5) | — | `data/ownership-transfer.ts` → `pages/shop-transfer/*`; menú `:141-146` | Vivo (admin), como declaró US-25. **Nota:** el admin también llama `transfer-shop-ownership` (`data/client/shop.ts`), ruta que **no existe** en la API |
| `analytics` (4) | — | `data/dashboard.ts` → `dashboard/admin.tsx`, `dashboard/owner.tsx` | Vivo: es el dashboard raíz del admin |
| `conversations` (3) + `messages` (2) | — | `data/conversations.tsx` → `pages/message/*`, `topbar/message-bar.tsx` | Vivo (admin) |
| `become-seller` (2) | `become-seller.ts` (`getStaticProps`) → `pages/become-seller/index.tsx` | `data/become-seller.ts` → `pages/become-seller`, `become-seller-form.tsx`; menú `:352-356` | Vivo en ambos, como declaró US-25 |
| `payment-intent` (1) | `order.ts` (`useGetPaymentIntent`) → `pay-now-button.tsx`, `gateway-modal.tsx` | — | Vivo (shop); depende de pasarela externa |
| `reports` (1) | `report.ts` (`useMyReports`) → `reports/report-view.tsx` (`pages/reports.tsx`) | — | Vivo (shop) |
| `payment` (0) | — | — | Sin rutas; solo `payment-gateway.json` |

**Módulos mock sin ningún consumidor en los frontends: ninguno** de los 25.
La sospecha de que `authors` y `flash-sale` eran restos de plantilla **no se
confirma**: ambos están en los menús de los dos frontends. Sí hay
**endpoints y hooks individuales sin consumidor** (constantes declaradas y
nunca usadas): shop `UPDATE_CONTACT`, `PRODUCT_FLASH_SALE_INFO`,
`STORE_NOTICES_IS_READ`; admin `ATTRIBUTE_VALUES`, `ORDER_STATUS`,
`PROFILE_UPDATE`, `DOWNLOAD_INVOICE`, `MY_SHOPS`; hooks con 0 consumidores:
`useMostSoldProductByCategoryQuery`, `useOrderSeen`,
`useApproveFlashSaleMutation`, `useDisApproveFlashSaleMutation`,
`useFlashSaleLoadMoreQuery`, `useCreateOwnerTransferMutation`,
`useApproveOwnerTransferMutation`, `useDisApproveOwnerTransferMutation`,
`useDeleteNotifyLogMutation`, `useStoreNoticeTypeQuery`, `useListMutation`,
`useFaqsLoadMoreQuery`, `useReview` (shop), `useSearchNearShops` (shop).

**No verificado:** alcance en runtime (una página puede existir y estar
detrás de un flag de `settings`, como `authors.enable`); qué módulos
funcionan de verdad con el mock (varios devuelven la fila 0 para cualquier
id); los módulos sin JSON que la tabla no lista (`refunds`, `addresses`,
`feedbacks`, `notify-logs`, `newsletters`, `uploads`, `imports`, `ai`,
`web-hook`) son stubs puros y también tienen consumidores, pero no se
cruzaron uno a uno.

## Secuencia propuesta (para cuando haya decisión)

Cada épico siguiente que cree tablas debe seguir el precedente del Épico 19:
**todo su DDL en la primera US, un solo `db-reset`**, y renovar la
autorización del dueño (la de 2026-08-31 se dio para aquel épico).

1. **Contenido y configuración del admin** — `faqs`,
   `terms-and-conditions`, `refund-policies`, `refund-reasons`,
   `shippings`, `taxes`, `store-notices`, `attributes` (+ valores). Ocho
   tablas simples, CRUD sin relaciones complejas salvo `attributes`, todo
   con consumidor en el admin y la mitad también en el shop. Riesgo bajo;
   es el "Épico 27" natural. `attributes` desbloquea además persistir las
   variaciones de producto que el Épico 26 ignora (decisión 10).
2. **Identidad extendida** — relación staff↔tienda (`GET/POST/DELETE
   /staffs`, hoy lista vacía), `become-seller` (un singleton de página,
   candidato a fila en `settings` o tabla propia), `ownership-transfer`
   (+ la ruta `transfer-shop-ownership` que el admin llama y no existe),
   `balance`/`withdraws`. Toca `users`/`shops`: conviene hacerlo junto.
3. **Núcleo transaccional** — `orders` (+ `order-status`, `downloads`,
   export), `reviews`, `questions`, `wishlists`, `coupons`, `refunds`,
   `analytics` (agregados sobre órdenes), `payment-intent`/
   `payment-method` (requieren pasarela externa: misma clase de decisión
   que el social login del Épico 19, decisión 11). Es el corte que
   **confronta la exclusión de `db/schema.sql:13-16`**: necesita que el
   dueño la levante por escrito, como US-20 la levantó solo para
   identidad.
4. **`authors` y `flash-sale`** — vivos pero de valor bajo para el dominio
   del scraper (tecnología, sin autores). Candidatos a quedarse mock de
   forma declarada, o a ir al final.

## Para promoverla a épico

Decisión del dueño sobre (a) si se levanta la exclusión transaccional del
esquema y hasta dónde, y (b) si `authors`/`flash-sale`/`payment-*` se
migran o se declaran mock permanente. Con eso, redactar el épico con la
plantilla del README y la numeración global vigente.
