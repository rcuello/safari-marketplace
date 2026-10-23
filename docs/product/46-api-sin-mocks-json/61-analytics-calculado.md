# US-61 — `analytics` calculado desde Postgres

> Las 4 rutas del dashboard del admin (`analytics`, `category-wise-product`,
> `low-stock-products` y `top-rate-product`) dejan de devolver 4 JSON fijos y
> se **calculan** con consultas sobre `orders`, `products`, `reviews`,
> `shops` y `users`. La forma del JSON se conserva exacta: claves, orden y
> tipos. Los valores cambian, y cada cambio se declara. No crea tablas.

**Épico:** [Épico 46](./README.md)
**Fecha:** 2026-10-20
**Status:** ✅ Implementada (2026-10-23)
**Depende de:** [US-60](./60-downloads-export-invoice.md). Es secuencial por
archivos compartidos (R-2). Por datos depende de US-58 (`orders`), US-54
(`reviews`) y el catálogo ya migrado.
**LOC est.:** ~1100

## Historia

**Como** super admin, **quiero** que el dashboard muestre ingresos, órdenes
por estado, productos con poco stock y productos mejor valorados
**calculados desde la base**, **para que** cambien cuando cambian las
órdenes y las reviews, y no sean una foto fija de la demo de Pickbazar.

## Contexto — verificado en código (2026-10-20)

**Controladores** (`apps/api/rest/src/analytics/analytics.controller.ts`):
cuatro clases, todas con `@Permissions(...ADMIN_ONLY)`
(`ADMIN_ONLY = ['super_admin']`, `auth/decorators/permissions.decorator.ts:20`)
y un único `@Get()` **sin parámetros**:

| Clase | Prefijo | Líneas |
|---|---|---|
| `AnalyticsController` | `analytics` | `:5-14` |
| `CategoryWiseProductController` | `category-wise-product` | `:16-25` |
| `LowStockProductsController` | `low-stock-products` | `:27-36` |
| `TopRateProductController` | `top-rate-product` | `:38-47` |

**Servicio** (`analytics/analytics.service.ts`): importa 4 JSON (`:2-5`), los
pasa por `plainToClass` (`:12-21`) y los devuelve tal cual (`:30-44`).
Ningún método recibe argumentos.

**Consumidor:** `apps/admin/rest/src/components/dashboard/admin.tsx`.

- `useAnalyticsQuery()` (`:60`) lee `totalRevenue`, `todaysRevenue`, los 4
  `*TotalOrderByStatus` y `totalYearSaleByMonth[].total`. Este último lo
  formatea con `toFixed(2)` (`:125-129`), así que **es un importe, no un
  conteo**.
- `useTopRatedProductsQuery`, `useLowProductStockQuery` y
  `useProductByCategoryQuery` envían `limit: 10, language` (`:99`, `:105`,
  `:114`). `lowStock` y `topRated` añaden `searchJoin`, `with` y
  `search=shop_id:…` (`apps/admin/rest/src/data/client/product.ts:54-63`,
  `:172-178`). **Hoy la API ignora todo eso.**
- `components/dashboard/owner.tsx` también llama `useAnalyticsQuery`, pero
  la ruta es `ADMIN_ONLY` y el dueño recibe 403. No se toca (R-6 del épico).

**Mock y su relación con los datos** (recalculado con `node -e` sobre los
JSON el 2026-10-20):

`analytics.json` es un objeto con 12 claves, en este orden:

```
totalRevenue, totalRefunds, totalShops, totalVendors, todaysRevenue,
totalOrders, newCustomers, todayTotalOrderByStatus, weeklyTotalOrderByStatus,
monthlyTotalOrderByStatus, yearlyTotalOrderByStatus, totalYearSaleByMonth
```

- Cada `*TotalOrderByStatus` tiene 8 claves: `pending, processing,
  complete, cancelled, refunded, failed, localFacility, outForDelivery`.
- `totalYearSaleByMonth` son 12 objetos `{total, month}`, de `January` a
  `December`.

Sus valores **no se pueden derivar** de `orders.json` ni del seed:

| Campo | Mock | Calculado con la definición de esta US (seed actual) |
|---|---|---|
| `totalRevenue` | 1818.8 | **3538.01** (Σ `total` de las 13 órdenes padre `order-completed`) |
| `totalRefunds` | 0 | 0 (no hay tabla de reembolsos: `refunds` es stub) |
| `totalShops` | 14 | **12** (`shops` del seed) |
| `totalVendors` | 11 | **1** (distintos `shops.owner_id`: todas son del usuario 1) |
| `todaysRevenue` | 0 | 0 (no hay órdenes hoy) |
| `totalOrders` | 14 | **20** (órdenes padre) |
| `newCustomers` | 10 | depende de los `created_at` sembrados (ver M-7) |
| `yearlyTotalOrderByStatus` | complete 14, processing 4, pending 1, outForDelivery 1 | **todo 0** en 2026 (las órdenes son de 2023-04, 2023-10/11 y 2024-02) |
| `totalYearSaleByMonth` | ene-ago no nulos | **los 12 en 0** en 2026 |

Hermanos del objeto principal:

- **`category-wise-product.json`**: 10 filas
  `{category_id, category_name, shop_name, product_count}`, por ejemplo
  `7 Snacks · Grocery Shop · 73`. **`category_product` está vacía a
  propósito** (`db/generate-seed.mjs:447-457`: ningún producto del mock
  trae categorías), así que calculado da `[]` hasta que el scraper o el
  admin enlacen productos.
- **`low-stock-products.json`**: 9 productos (ids 1014, 1015, 1017, 1018,
  1021, 1022, 1023, 1024 y 1028, todos de la tienda 9). Cada uno tiene 45
  claves de producto Laravel con `type` (10 claves) y `shop` (13) embebidos.
  `quantity < 10` sobre `products.json` da **11**: incluye además 2
  (qty 8) y 190 (qty 0), ambos de la tienda 6. El mock no es reproducible
  con una regla única.
- **`top-rate-product.json`**: 10 filas de 15 claves
  `{id, name, slug, regular_price, sale_price, min_price, max_price,
  product_type, description, type_id, type_slug, total_rating,
  rating_count, actual_rating, image}`.
  - Sus `total_rating`/`rating_count`/`actual_rating` **coinciden** con
    `reviews.json`: Σ rating, número de reviews y media, que es 5 en las 10.
  - El orden no sale de ninguna regla: los ids son 4, 7, 8, 12, 16, 17, 20,
    492, 19 y 468.
  - Ordenando por media DESC, número DESC e id ASC sale 4, 7, 8, 12, 16,
    17, 19, 20, 21, 24.

Los mocks no traen `created_at` de nivel superior, salvo low-stock, cuyo
`Product extends CoreEntity` ya emite hoy 3 decimales.

## Línea base (paso 2 del Protocolo del épico)

```bash
API=http://localhost:9001/api
ADMIN=$(curl -s -X POST $API/token -H 'content-type: application/json' \
  -d '{"email":"admin@demo.com","password":"demodemo"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
OWNER=$(curl -s -X POST $API/token -H 'content-type: application/json' \
  -d '{"email":"store_owner@demo.com","password":"demodemo"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
for r in analytics "category-wise-product?limit=10&language=en" \
         "low-stock-products?searchJoin=and&with=type;shop&limit=10&language=en" \
         "top-rate-product?searchJoin=and&limit=10&language=en"; do
  f=base-$(echo "$r" | cut -d'?' -f1).txt
  curl -s -w '\n%{http_code}\n' -H "Authorization: Bearer $ADMIN" "$API/$r" > "$f"
done
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $OWNER" $API/analytics   # 403 hoy y después
```

## Tablas nuevas

**Ninguna.** No hay seed nuevo, no hay `db-reset` y no hay re-introspección.
Pasos 3-6 del Protocolo: **no aplican**. Hay que declararlo en el reporte,
no saltarlo en silencio.

## Definición de cada métrica (contrato de valores)

Todas en **UTC**. «Ahora» es siempre `now()` de `packages/db/src/clock.ts`,
para que `_setNowProvider` lo fije en los tests. Solo cuentan **órdenes
padre** (`parent_id IS NULL`), porque los hijos duplican el importe por
tienda (US-58).

| # | Campo | Definición |
|---|---|---|
| M-1 | `totalRevenue` | Σ `orders.total` de padres con `order_status = 'order-completed'` y `created_at <= now` |
| M-2 | `totalRefunds` | constante `0`. No hay tabla de reembolsos; se declara |
| M-3 | `totalShops` | `count(*)` de `shops` |
| M-4 | `totalVendors` | `count(DISTINCT shops.owner_id)` |
| M-5 | `todaysRevenue` | M-1 restringido al día calendario UTC de `now` |
| M-6 | `totalOrders` | `count(*)` de padres con `created_at <= now` |
| M-7 | `newCustomers` | usuarios con permiso `customer` y **sin** `super_admin` ni `store_owner`, con `users.created_at` en los últimos 30 días (`(now - 30d, now]`) |
| M-8 | `*TotalOrderByStatus` | conteo de padres por `order_status`. Ventanas: **today** = día calendario UTC; **weekly** = `(now - 7d, now]`; **monthly** = mes calendario UTC hasta `now`; **yearly** = año calendario UTC hasta `now`. Mapeo de clave → estado: `pending→order-pending`, `processing→order-processing`, `complete→order-completed`, `cancelled→order-cancelled`, `refunded→order-refunded`, `failed→order-failed`, `localFacility→order-at-local-facility`, `outForDelivery→order-out-for-delivery`. Siempre las 8 claves, con 0 si no hay órdenes |
| M-9 | `totalYearSaleByMonth` | 12 objetos `{total, month}` de enero a diciembre del año UTC de `now`; `total` = M-1 restringido a ese mes. Los meses futuros quedan en 0 |
| M-10 | `category-wise-product` | `category_product ⋈ products ⋈ categories ⋈ shops`, agrupado por `(category, shop)`, `product_count = count(*)`, `ORDER BY product_count DESC, category_id ASC`, `LIMIT limit` (query `limit`, default 10) |
| M-11 | `low-stock-products` | `products.quantity < 10`, `ORDER BY id ASC`, `LIMIT limit` (default 10). Con `search=shop_id:N` (parseado con `parseSearch`), filtra por tienda |
| M-12 | `top-rate-product` | productos con al menos una review; `total_rating = Σ rating`, `rating_count = count`, `actual_rating = round(avg(rating), 2)` como número. `ORDER BY actual_rating DESC, rating_count DESC, id ASC`, `LIMIT limit` (default 10). Con `search=shop_id:N`, filtra por la tienda del producto |

Formato numérico: el SQL suma `numeric` y el servicio emite `Number(...)`.
Por ejemplo, 3538.01 sale como `3538.01`, no `"3538.010"`.

## Forma de cada respuesta (se preserva)

- **`analytics`**: las 12 claves en el orden del mock, las 8 subclaves de
  cada estado en su orden y los 12 meses en inglés.
- **`category-wise-product`**: array de `{category_id, category_name,
  shop_name, product_count}`.
- **`low-stock-products`**: array de productos con **las 45 claves y su
  orden** del mock.
  - Las claves con columna en `products` salen de ella.
  - Los booleanos que el mock emite como entero salen como `0/1`:
    `in_stock`, `is_taxable`, `is_digital`, `is_external`.
  - Las claves **sin columna** salen con valor neutro constante:
    `in_flash_sale: 0`, `shipping_class_id: null`, `height/width/length:
    null`, `video: []`, `deleted_at: null`, `author_id: null`,
    `external_product_button_text: null`, `blocked_dates: []`,
    `rating_count: []`, `my_review: null`, `in_wishlist: false`.
  - `type` se proyecta con el DTO de types ya migrado y `shop` con
    `toShopDto` (`shops/shops.service.ts:49-68`), ambos recortados a las
    claves y el orden del mock (10 y 13).
- **`top-rate-product`**: array de las 15 claves en orden. `regular_price`
  es `products.price` y `type_slug` es `types.slug`.

## Divergencias declaradas (D-1 del épico)

| # | Qué cambia | Evidencia |
|---|---|---|
| V-1 | **Todos los valores de `analytics`** pasan a calcularse (tabla «Mock vs calculado»). La forma es idéntica | deep-equal de **claves y tipos** (no de valores) entre línea base y después, más la tabla de valores pegada |
| V-2 | `category-wise-product` devuelve `[]` con el seed actual | cuerpo `[]` pegado más el `psql` de `SELECT count(*) FROM category_product` = 0 |
| V-3 | `low-stock-products` devuelve 10 productos (2, 190, 1014, 1015, 1017, 1018, 1021, 1022, 1023, 1024) en vez de los 9 del mock. Además: `created_at`/`updated_at` del seed (`now()`), los neutros de las claves sin columna y `type`/`shop` proyectados | lista de ids antes y después; deep-equal de claves/orden |
| V-4 | `top-rate-product`: ids 4, 7, 8, 12, 16, 17, 19, 20, 21, 24 en vez de 4, 7, 8, 12, 16, 17, 20, 492, 19, 468 | lista antes y después |
| V-5 | `limit` y `search=shop_id:N` empiezan a aplicarse en las 3 listas | `curl` con `limit=3` (3 filas) y con `search=shop_id:9` en low-stock (solo de la tienda 9) |
| V-6 | Con la API real, el dashboard de 2026 muestra **0** en today/weekly/monthly/yearly y en los 12 meses, porque las órdenes de la demo son de 2023-2024. Es correcto, no un fallo | `curl` de después pegado |

## Scope

**Incluye:**
- las 4 rutas calculadas;
- el repositorio de solo lectura
  `packages/db/src/repositories/analytics.repository.ts`
  (`getDashboardAnalytics(now)`, `listCategoryWiseProductCounts`,
  `listLowStockProducts`, `listTopRatedProducts`) con su
  `*.integration.test.ts` sobre el seed y con reloj fijo;
- los records nuevos que haga falta;
- el barrel;
- `analytics.service.ts` sin imports de JSON (D-8);
- el spec de Jest;
- `packages/db/README.md`.

**NO incluye:**
- `category-wise-product-sale`, que el admin llama
  (`data/client/product.ts:142`) y da 404: no se crea;
- un snapshot o una tabla de analytics;
- caché o vistas materializadas;
- tablas de reembolsos (M-2 queda en 0);
- abrir la ruta al `store_owner` (R-6);
- `popular-products` y `best-selling-products` (ya migrados en el Épico 1);
- borrar los 4 JSON del disco (D-8: siguen como referencia);
- frontend.

## Criterios de aceptación

### CA-1 — Forma idéntica en las 4 rutas
Para cada ruta, el conjunto, el orden y el tipo JSON de cada clave
coinciden con la línea base. Los objetos anidados se recorren
recursivamente y se toma el primer elemento de cada array. Se comprueba
con `node -e`.

### CA-2 — Valores de `analytics` con reloj fijo
Un integration test fija `now = 2023-10-25T20:00:00Z` con `_setNowProvider`
y obtiene exactamente estos valores, calculados el 2026-10-20 sobre las 20
órdenes padre de `orders.json`:

- `totalOrders`: 16 (padres con `created_at <= now`).
- `totalRevenue`: 3473.22.
- `todaysRevenue`: 2305.32 (las 6 completadas del 2023-10-25).
- `todayTotalOrderByStatus` y `weeklyTotalOrderByStatus`: `complete: 6` y
  el resto 0.
- `monthlyTotalOrderByStatus`: `pending: 1, processing: 3, complete: 7`.
- `yearlyTotalOrderByStatus`: `pending: 1, processing: 3, complete: 12`.
- `totalYearSaleByMonth`: April 984.3, October 2488.92, el resto 0.
- `totalShops`: 12 y `totalVendors`: 1.

Si US-58 o US-59 cambiaron el estado o el `total` de alguna orden sembrada,
recalcular con `node -e` y pegar las cifras nuevas **con su justificación**,
no ajustarlas para que pase el test.

### CA-3 — `newCustomers` con usuarios centinela
El test crea usuarios `zz-analytics-*` con permiso `customer` y
`created_at` dentro y fuera de los 30 días, y uno con `store_owner`.
Comprueba que solo cuentan los primeros y los limpia en `afterAll`.

### CA-4 — Listas calculadas
- `low-stock-products?limit=10` da los 10 ids de V-3, en ese orden.
- `top-rate-product?limit=10` da los 10 ids de V-4, con `total_rating`,
  `rating_count` y `actual_rating` iguales al cálculo sobre `reviews`.
- `category-wise-product` devuelve `[]` con el seed. Un integration test
  con 2 productos centinela enlazados a una categoría devuelve una fila con
  `product_count: 2` y limpia después.

### CA-5 — Autorización intacta
Admin recibe 200 en las 4 rutas. `store_owner@demo.com` recibe 403 en las
4, igual que hoy.

### CA-6 — Sin regresión
Verdes con recuento pegado: `just db-check`, `npx jest`, `just build-api` y
`just verify`. `grep -n "@db/" apps/api/rest/src/analytics/analytics.service.ts`
no devuelve nada.

## Escenarios Gherkin

```gherkin
Feature: Dashboard del admin calculado desde Postgres
  Scenario: CA-2 — ingresos del dia con reloj fijo
    Given el seed de ordenes y el reloj fijo en 2023-10-25T20:00:00Z
    When se calcula el analytics del dashboard
    Then todaysRevenue es 2305.32
    And todayTotalOrderByStatus.complete es 6

  Scenario: CA-2 — anio sin ordenes
    Given el reloj fijo en 2026-10-20T12:00:00Z
    When se calcula el analytics
    Then yearlyTotalOrderByStatus vale 0 en sus 8 claves
    And totalYearSaleByMonth tiene 12 meses con total 0

  Scenario: CA-1 — la forma no cambia
    When admin hace GET /api/analytics
    Then las 12 claves salen en el mismo orden que el mock
    And cada valor tiene el mismo tipo JSON

  Scenario: CA-4 — poco stock respeta el limite
    When admin hace GET /api/low-stock-products?limit=3
    Then recibe los productos 2, 190 y 1014

  Scenario: CA-5 — el duenio no ve el dashboard global
    When store_owner hace GET /api/analytics
    Then el status es 403
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---|---|
| `packages/db/src/repositories/analytics.repository.ts` | nuevo: las 4 consultas (Prisma `groupBy`/`aggregate` o `$queryRaw` tipado; elegir y justificar) |
| `packages/db/src/repositories/analytics.integration.test.ts` | nuevo: CA-2, CA-3 y CA-4 con reloj fijo y centinelas |
| `packages/db/src/records.ts` | records de las filas agregadas, si hacen falta |
| `packages/db/index.ts` | exports |
| `apps/api/rest/src/analytics/analytics.service.ts` | calcula; proyecta la forma; fuera los 4 imports de JSON |
| `apps/api/rest/src/analytics/analytics.controller.ts` | `@Query()` en las 3 listas (`limit`, `search`) |
| `apps/api/rest/src/analytics/analytics.service.spec.ts` | nuevo: forma, mapeo de estados y errores (503/500) |
| `packages/db/README.md` | repositorio de analytics y sus definiciones M-1..M-12 |

## Definición de Done

Protocolo del [README del épico](./README.md), pasos 1, 2 y 7-10. Los pasos
3-6 no aplican: declararlo.

- [ ] La línea base (4 cuerpos + el 403 del dueño) y su repetición después.
- [ ] La comparación `node -e` de CA-1 (claves, orden y tipos) en las 4
      rutas.
- [ ] La tabla «Mock vs calculado» rellenada con los valores **reales** de
      después (V-1).
- [ ] `just db-check` verde, con los tests nuevos de CA-2..CA-4 en el
      recuento.
- [ ] `cd apps/api/rest && npx jest`, `just build-api` y `just verify`
      verdes.
- [ ] Los `curl` de V-5 y CA-5 con status exacto.
- [ ] Status y fila del épico actualizados.

## Notas para el agente ejecutor

- **Nombres de columnas de `orders`.** Esta US asume `orders.parent_id`,
  `orders.total`, `orders.order_status` y `orders.created_at`, tal como los
  dejó US-58. Verificarlos en `db/schema.sql` antes de escribir SQL; si
  difieren, usar los reales y anotarlo.
- **No ajustar las definiciones para acercarse al mock.** El mock no es
  reproducible (V-1..V-4). El contrato son las definiciones M-1..M-12. Si
  una parece equivocada, parar y preguntar; no inventar otra.
- **Determinismo.** Ningún test depende de la fecha real. Fijar el reloj
  con `_setNowProvider` y restaurarlo en `afterEach`.
- **`created_at` de los usuarios.** El seed de los usuarios 1-3 usa
  `now()` del `db-reset`, así que en la base local cuentan como «nuevos»
  durante 30 días: M-7 no se prueba con el seed, sino con centinelas
  (CA-3).
- **Zona horaria.** Se eligió UTC por determinismo (el contenedor corre en
  UTC). Si el dueño quiere `America/Bogota`, es un cambio de definición
  aparte y no se adelanta aquí.

## Evidencia (2026-10-23)

**Pasos 3-6 del Protocolo: no aplican.** Esta US no crea tablas, no siembra
nada, no hace `db-reset` y no re-introspecciona. Los nombres de columnas de
`orders` (`parent_id`, `total`, `order_status`, `created_at`) son los que
asume la US.

**Línea base y después** (API recién arrancada sobre `main` `9678bc1` para
el antes; tras el cambio para el después):

```
ruta                    antes          después        dueño (antes/después)
analytics               200   1080B    200   1078B    403 / 403
category-wise-product   200    928B    200      3B    403 / 403
low-stock-products      200  39672B    200  24996B    403 / 403
top-rate-product        200   7111B    200   4700B    403 / 403
```

**CA-1** (`node` sobre los cuerpos: claves, orden y tipo JSON, recursivo,
primer elemento de cada array):

```
analytics: forma idéntica
top-rate-product: forma idéntica
category-wise-product: len 10 -> 0          (V-2: no hay primer elemento que comparar)
low-stock-products, mismo producto (1014) antes y después:
  1014.image: claves [thumbnail,original,id,file_name] -> [id,original,file_name,thumbnail]
  1014.manufacturer_id: number -> null
  1014.shop.cover_image / shop.logo: mismo reorden que image
  1014.shop.address: [country,city,state,zip,street_address] -> [zip,city,state,country,street_address]
  1014.shop.settings: [notifications,contact,website,location,socials] -> [contact,socials,website,location,notifications]
claves top-level (45, en orden) iguales en los 10 productos: true
```

Las 45 claves, las 10 de `type` y las 13 de `shop` salen en el orden del
mock. Las dos diferencias que quedan son **heredadas del catálogo**, no de
esta US:

- `image`, `logo`, `cover_image`, `address` y `settings` son columnas
  `jsonb` (`pg_typeof` = `jsonb`), que reordenan las claves. Los tipos de
  cada clave anidada coinciden.
- `manufacturer_id` sale `null` porque el seed no enlaza fabricantes a
  productos: `SELECT count(manufacturer_id) FROM products` = 0 de 1200.

`type.promotional_sliders` sale `[]` (el tipo del mock), no el `null` que
emite `toTypeDto` de `/api/types`: la US pide proyectar con el DTO de types
y a la vez conservar el tipo (CA-1); se priorizó CA-1.

**V-1 — Mock vs calculado** (después, con el reloj real del 2026-10-23):

| Campo | Mock | Calculado |
|---|---|---|
| `totalRevenue` | 1818.8 | 3538.01 |
| `totalRefunds` | 0 | 0 |
| `totalShops` | 14 | 12 |
| `totalVendors` | 11 | 1 |
| `todaysRevenue` | 0 | 0 |
| `totalOrders` | 14 | 20 |
| `newCustomers` | 10 | 1 (`customer@demo.com`, creado por el `db-reset` de hoy) |
| `today/weekly/monthly/yearlyTotalOrderByStatus` | ver mock | las 8 claves en 0 (V-6) |
| `totalYearSaleByMonth` | ene-ago no nulos | los 12 en 0 (V-6) |

**V-2:** `category-wise-product` → `[]`; `SELECT count(*) FROM
category_product` = 0.

**V-3 / V-4:**

```
low-stock antes   1014,1015,1017,1018,1021,1022,1023,1024,1028
low-stock después 2,190,1014,1015,1017,1018,1021,1022,1023,1024
top-rate antes    4,7,8,12,16,17,20,492,19,468
top-rate después  4,7,8,12,16,17,19,20,21,24
top-rate (id:Σ/n/media) 4:15/3/5 7:15/3/5 8:15/3/5 12:10/2/5 16:10/2/5 17:10/2/5 19:10/2/5 20:5/1/5 21:5/1/5 24:5/1/5
```

**V-5** (admin):

```
low-stock-products?limit=3                     → 200 ids=2,190,1014
low-stock-products?search=shop_id:9&limit=50   → 200 ids=1014,1015,1017,1018,1021,1022,1023,1024,1028
top-rate-product?limit=3                       → 200 ids=4,7,8
top-rate-product?search=shop_id:6              → 200 ids=4,7,8,12,16,17,19,20,1,3
category-wise-product?limit=3                  → 200 []
```

Un `limit` que no sea entero positivo cae al default 10; un `shop_id` no
entero se ignora (spec de Jest).

**CA-2 / CA-3 / CA-4** (`analytics.integration.test.ts`, 6 casos). Las
cifras de CA-2 se recalcularon con `psql` sobre la base actual antes de
escribir el test y coinciden con las de la US, sin ajustes:

```
total_orders 16 · revenue 3473.22 · today 2305.32
order-completed m 7 y 12 w 6 · order-pending m 1 y 1 · order-processing m 3 y 3
meses: 04 984.3 · 10 2488.92 · shops 12 · vendors 1
```

- 2026-10-20T12:00:00Z: las 4 ventanas vacías y los 12 meses en 0.
- CA-3: 6 centinelas `zz-analytics-*` con `now` = 2031-01-15 (lejos del
  `created_at` del seed): cuentan 2 (a 1 y a 29 días); no cuentan el de 31
  días, el del futuro, el `store_owner` ni el `super_admin`.
- CA-4: low-stock y top-rated con limit y tienda; agregados de top-rated
  contra `prisma.review.groupBy`; `category-wise` con una categoría
  centinela y 2 productos centinela da `product_count: 2`.
- Centinelas limpios al terminar: `users 0 · products 0 · categories 0 ·
  category_product 0`.

**CA-5:** las 4 rutas, 200 al admin y 403 a `store_owner@demo.com` (tabla
de arriba).

**CA-6:**

```
$ just db-check
 Test Files  30 passed (30)
      Tests  386 passed (386)
$ cd apps/api/rest && npx jest
Test Suites: 32 passed, 32 total
Tests:       516 passed, 516 total
$ npx tsc --noEmit -p tsconfig.json   → exit 0
$ just build-api                      → Done in 106.20s.
$ just verify
OK   API    :9001/api/settings  200  5503B  557ms
OK   Shop   :3003/en  200  190788B  251ms  cards:30
OK   Admin  :3002/en/login  200  72821B  49ms  cards:1
$ grep -n "@db/" apps/api/rest/src/analytics/analytics.service.ts
(sin salida, exit=1)
```

Antes: 29 archivos / 380 tests y 31 suites / 509. Se suman el integration
test (6 casos) y `analytics.service.spec.ts` (7 casos).

**Decisiones de implementación:**

- `$queryRaw` parametrizado para los agregados (ventanas `FILTER` y mes
  UTC); Prisma con `PRODUCT_INCLUDE` para los productos.
- M-10 desempata además por `shop_id ASC` (la misma categoría en dos
  tiendas con el mismo conteo).
- Los records del dashboard viven en `analytics.repository.ts`, como
  `OrderDetailRecord` en `orders.repository.ts`: `TopRatedProductRecord`
  depende de `ProductRecord`, que no está en `records.ts`.
- El servicio declara sus DTO de retorno (`AnalyticsDto`,
  `CategoryWiseProductDto`, `TopRateProductDto`): el build de Nest emite
  declaraciones y no admite tipos inferidos que nombran el runtime de
  Prisma (TS2742). Las entidades de `analytics/entities/` no encajan con la
  forma real y no se usan.

**Notas para el reporte:**

- `category-wise-product-sale` sigue en 404 (NO incluye).
- `owner.tsx` sigue recibiendo 403 (R-6).
- `isPrismaConnectionError` clasifica cualquier
  `PrismaClientKnownRequestError` como error de conexión (503). Es el helper
  existente; no se tocó.
