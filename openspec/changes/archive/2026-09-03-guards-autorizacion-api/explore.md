# Exploration: US-23 — Autorización: guard global y permisos por ruta

## Current State

### A. Lo que dejó US-22 en `apps/api/rest/src/auth/`

Contenido real hoy de la carpeta (`ls`): `auth.controller.ts`, `auth.module.ts`,
`auth.service.ts`, `current-user.decorator.ts`, `dto/`, `jwt-options.ts`. **No
existen** `guards/` ni `decorators/` — US-23 los crea desde cero, tal como dice
su propia tabla "Archivos a crear/modificar".

- **JWT wiring** (`auth.module.ts:7-13`): `JwtModule.registerAsync({ useFactory:
  resolveJwtOptions })`, con un comentario explícito de por qué NO es
  `.register({...})` síncrono: `ConfigModule.forRoot()` corre después de que
  Nest evalúe los `require` de los módulos hijos, así que leer
  `process.env.JWT_SECRET` al importar el módulo vería `undefined`.
- **`jwt-options.ts:18-34`** (`resolveJwtOptions()`): único punto de lectura de
  `JWT_SECRET`/`JWT_EXPIRES_IN`, memoizado, lanza si falta el secreto. Es el
  punto de fail-fast que ya construyó US-22.
- **Payload del token** (`current-user.decorator.ts:12-18`,
  `CurrentUserPayload`): `{ sub: number, email: string, permissions: string[],
  iat: number, exp: number }`. Confirmado también en `auth.service.ts:157-161`
  y `:191-195` (`jwtService.signAsync({ sub, email, permissions })` en login y
  en register). **`permissions` viaja como array de strings snake_case**
  (`super_admin`, `store_owner`, `staff`, `customer`), sin objeto `role`
  embebido en el JWT (el campo `role` solo va en el *body* de la respuesta de
  `/api/token`, no dentro del token firmado).
- **`@CurrentUser()`** (`current-user.decorator.ts:55-69`) ya extrae el bearer
  token del header `Authorization`, lo verifica con un `JwtService` de ámbito
  de módulo (construido perezosamente, `getJwtService()` líneas 30-35) y
  devuelve el payload decodificado, o lanza `UnauthorizedException` si falta o
  es inválido. Es exactamente la pieza que un guard necesitaría para poblar
  `request.user` — hoy vive como decorador de parámetro puro, usado a mano en
  3 rutas del `AuthController` (`change-password`, `me`, `add-points`), **sin
  ninguna clase `CanActivate`**. El comentario de cabecera (líneas 45-53) lo
  dice explícito: "sin clase de autorización asociada... la protección de
  rutas es US-23, no este cambio".
- **`app.module.ts:100-101`**: `controllers: [], providers: []` — no hay
  ningún provider global registrado, y por tanto ningún `APP_GUARD`.

**Conteo verificado AHORA (post US-22), no antes:**

```
cd apps/api/rest/src && grep -rn "CanActivate\|AuthGuard\|passport\|APP_GUARD\|@UseGuards" .
```

→ **0 resultados**. Coincide exactamente con el "0 resultados" que la US
atribuye al estado *anterior* a US-22 — confirmado que sigue siendo 0 después
de esa US: `POST /api/register`, `login`, `changePassword`, `me` ya devuelven
401 vía `@CurrentUser()` cuando el token falta o es inválido, pero **ninguna
otra ruta de las 250 tiene ninguna protección**, ni siquiera las de
`/api/users`, `/api/orders`, etc. El diff `git diff da6f9b9 f3d8602 --
apps/api/rest/src/auth/auth.controller.ts` confirma que US-22 no agregó ni
quitó ninguna ruta HTTP, solo cableó `@CurrentUser()` en 3 métodos que ya
existían.

### B. Inventario de rutas (medido, no estimado)

**Metodología**: script Node que parsea cada `*.controller.ts`, agrupa por
bloque `@Controller(prefix) export class X`, y cuenta los decoradores
`@Get/@Post/@Put/@Patch/@Delete` dentro de cada bloque (soporta múltiples
`@Controller()` por archivo, que es un patrón real y frecuente en este repo —
p. ej. `shops.controller.ts` declara 7 clases `@Controller` distintas en un
solo archivo).

```
find apps/api/rest/src -name "*.controller.ts" | wc -l   → 45 archivos
find apps/api/rest/src -name "*.module.ts" | wc -l        → 45 archivos
```

- **Módulos registrados en `AppModule`** (`app.module.ts:49-99`, contados
  directamente del array `imports`): **44** — coincide exacto con lo que cita
  la US y el épico. (El módulo 45 sin registrar es `PaymentModule`
  — sí, no: `PaymentModule` SÍ está en la lista, línea 86; el conteo de 45
  archivos `*.module.ts` incluye `common.module.ts`, que también se importa;
  el `AppModule` mismo no se cuenta a sí mismo, de ahí 44 importados sobre 45
  módulos que existen en el árbol).
- **Rutas HTTP totales**: **250** — medidas dos veces con dos métodos
  distintos (un `grep -rEo` plano de los 5 decoradores, y el parser
  estructural por bloque de clase) y ambos coinciden en 250. **Esto es 1 más
  que el "249" que citan la US y el épico.** Verificado que no lo introduce
  US-22 (el diff de `auth.controller.ts` entre `da6f9b9` y `f3d8602` no agrega
  rutas). No encontré la causa exacta del off-by-one — probablemente un
  conteo manual del epic hecho antes de que existiera este script. Reporto el
  número real medido hoy: **250**, repartidas en **74 pares (prefijo,
  clase `@Controller`)** distintos, y la suma de esos 74 grupos por verbo HTTP
  da exactamente 250 (verificado con el mismo script).
- **`payment` y `web-hook`**: `apps/api/rest/src/payment/payment.module.ts`
  **no tiene ningún controller** — solo expone `StripePaymentService` y
  `PaypalPaymentService` como providers que consume `orders.service.ts`
  (pago embebido en `POST /orders/payment`, ver más abajo). El único
  controlador de pagos-de-terceros real es
  `apps/api/rest/src/web-hook/web-hook.controller.ts:4-19`: 3 rutas `GET`
  (`razorpay`, `stripe`, `paypal`), cada una reenviando a
  `webHookServices.*()`. Esto corrige una premisa implícita de la US/épico:
  no hay un controlador `payment` separado que clasificar; el superficie de
  pago real vive repartida en `orders.controller.ts` (`POST /orders/payment`),
  `payment-intent.controller.ts` (`GET /payment-intent`) y
  `payment-method.controller.ts` (`/cards`, `/save-payment-method`,
  `/set-default-card`).

### La fuente fiable: lo que el shop llama de verdad

Leído completo `apps/shop/src/framework/rest/client/index.ts` (619 líneas) y
`api-endpoints.ts` (71 líneas), más los 15 archivos `*.ssr.ts` de
`apps/shop/src/framework/rest/` que corren en `getStaticProps`/
`getServerSideProps` **sin ningún token** (Next.js SSR/SSG no tiene sesión de
navegador). Confirmado por lectura directa de cada uno — no por nombre de
endpoint — que estas llamadas ocurren de verdad sin autenticación:

| Página / SSR file | Endpoints llamados anónimamente |
|---|---|
| `general.ssr.ts` (home shell) | `SETTINGS`, `TYPES` |
| `home-pages.ssr.ts` | `SETTINGS`, `TYPES`, `PRODUCTS`, `CATEGORIES`, `PRODUCTS_POPULAR`, `BEST_SELLING_PRODUCTS` |
| `product.ssr.ts` (detalle) | `SETTINGS`, `PRODUCTS` (`get` por slug) |
| `search.ssr.ts` | `SETTINGS`, `TYPES`, `CATEGORIES` |
| `shop.ssr.ts` (tienda individual) | `SETTINGS`, `SHOPS` (`get`), `PRODUCTS` |
| `shops-page.ssr.ts` (listado tiendas) | `SETTINGS`, `TYPES`, `SHOPS` |
| `faq-ssr.ts` | `SETTINGS`, `TYPES`, `FAQS` |
| `terms-and-conditions-ssr.ts` | `SETTINGS`, `TYPES`, `TERMS_AND_CONDITIONS` |
| `refund-policies.ssr.ts` | `SETTINGS`, `REFUND_POLICIES` |
| `coupon.ssr.ts` | `SETTINGS`, `TYPES`, `COUPONS` (lista completa) |
| `notify-logs.ssr.ts` | `SETTINGS`, `NOTIFY_LOGS` |
| `become-seller.ts` | `SETTINGS`, `BECAME_SELLER` (get) |
| `order.ssr.ts` | `SETTINGS`, `TYPES` (solo el shell; el detalle del pedido se resuelve client-side) |

**Hallazgo no anticipado por la US**: `coupon.ssr.ts` y `notify-logs.ssr.ts`
prefetchean `COUPONS` y `NOTIFY_LOGS` en `getStaticProps`, **sin ningún
token** — es decir, hay una página pública de cupones y otra de "avisos" que
la US no menciona entre `products/types/categories/tags/manufacturers/shops`.
Ambas deben entrar al inventario de públicas si el diseño quiere preservar
CA-3 (`just verify` no las cuenta como product-cards, pero romperlas rompe la
navegación anónima igual — es exactamente el tipo de sorpresa que R-1 advierte
que hay que buscar por inventario, no por intuición).

`tags` no aparece en ningún `*.ssr.ts` (se consume client-side, vía hook,
probablemente en filtros de la página de categoría) — sigue siendo
anónimo porque nada en su ruta de lectura exige sesión, solo que no es parte
del *prefetch* SSR.

### Tabla de clasificación (74 grupos, suma = 250 rutas)

Clasificación derivada de: (1) qué llama el shop (`client/index.ts` +
`*.ssr.ts`), (2) qué llama el admin (`apps/admin/rest/src/data/client/
api-endpoints.ts`, 104 líneas, leído completo), (3) el propio código del
controller (stubs con `console.log`, sufijos `approve-*`/`disapprove-*`,
rutas `admin/list` etc.). `pub`=pública, `auth`=autenticada (cualquier token
válido), `perm`=permiso admin/store_owner/staff, `esp`=especial,
`?`=ambigua (ver lista de preguntas más abajo).

| Prefijo | Verbos (#) | Clasif. | Evidencia |
|---|---|---|---|
| settings | GET1 / POST1 | GET **pub**, POST **perm** | GET en 6 SSR; POST no lo llama ni shop ni admin (`settings.controller.ts:9-17`) — admin de settings, sin evidencia de uso, tratar como perm por default-deny |
| products | GET2 / POST1,PUT1,DELETE1 | GET **pub**, resto **perm** | `product.ssr.ts`, `home-pages.ssr.ts` |
| popular-products | GET1 | **pub** | `home-pages.ssr.ts:100-104` |
| best-selling-products | GET1 | **pub** | `home-pages.ssr.ts:106-112` |
| products-by-flash-sale | GET1 | **pub** | `client/index.ts:174-182` (getProductsByFlashSale, catálogo) |
| draft-products | GET1 | **perm** | Solo en admin `api-endpoints.ts:77` (`NEW_OR_INACTIVE_PRODUCTS`) |
| products-stock | GET1 | **perm** | Solo admin (`LOW_OR_OUT_OF_STOCK_PRODUCTS`) |
| categories | GET2 / POST1,PUT1,DELETE1 | GET **pub**, resto **perm** | `home-pages.ssr.ts`, `search.ssr.ts` |
| types | GET2 / POST1,PUT1,DELETE1 | GET **pub**, resto **perm** | en casi todos los SSR |
| tags | GET2 / POST1,PUT1,DELETE1 | GET **pub**, resto **perm** | consumido client-side (`tag.ts`), sin gate visible |
| shops | GET2 / POST3,PUT1,DELETE1 | GET **pub**, resto **perm** | `shop.ssr.ts`, `shops-page.ssr.ts`; POST incluye `approve`/`disapprove` |
| staffs | GET2/POST1/PUT1/DELETE1 | **perm** | Sub-controller de `shops.controller.ts:58-86`, gestión de personal de tienda (store_owner) |
| near-by-shop | GET1 | **pub** (confianza media) | `client/index.ts:255-259` (`searchNearShops`), no confirmado en ningún SSR — se llama client-side, plausible en un mapa de localización pre-login |
| new-shops | GET1 | **? ambigua** | Nombre coincide con admin `NEW_OR_INACTIVE_SHOPS` (cola de aprobación), no confirmado en shop |
| disapprove-shop / approve-shop | POST1 c/u | **perm** | Solo admin |
| authors | GET2/POST1/PUT1/DELETE1 | GET **pub**, resto **perm** | `client/index.ts:282-303`, usado solo en demo "book" |
| top-authors | GET1 | **pub** | ídem |
| manufacturers | GET2/POST1/PUT1/DELETE1 | GET **pub**, resto **perm** | `client/index.ts:304-324` |
| top-manufacturers | GET1 | **pub** | ídem |
| faqs | GET2/POST1/PUT1/DELETE1 | GET **pub**, resto **perm** | `faq-ssr.ts` |
| terms-and-conditions | GET2/POST1/PUT1/DELETE1 | GET **pub**, resto **perm** | `terms-and-conditions-ssr.ts` |
| approve-/disapprove-terms-and-conditions | POST1 c/u | **perm** | Solo admin |
| refund-policies | GET2/POST1/PUT1/DELETE1 | GET **pub**, resto **perm** | `refund-policies.ssr.ts` |
| refund-reasons | GET2/POST1/PUT1/DELETE1 | **? ambigua** | 0 resultados de `refundReason.` en `.tsx` del shop pese a existir el método en `client/index.ts:396-403`; ¿reference data pública sin usar aún, o admin-only? |
| flash-sale | GET2/POST1/PUT1/DELETE1 | GET **pub**, resto **perm** | `client/index.ts:541-567` |
| coupons | GET3/POST2/PUT1/DELETE1 | GET **pub** (confirmado SSR), POST `verify` **? ambigua**, resto **perm** | `coupon.ssr.ts` prefetchea la lista anónima; `verify` se llama en checkout — ¿el carrito permite invitado? |
| approve-/disapprove-coupon | POST1 c/u | **perm** | Solo admin |
| notify-logs | GET2/PUT2/DELETE1 | GET **pub** (confirmado SSR), PUT/DELETE (marcar leído) **auth** | `notify-logs.ssr.ts`; `readNotifyLog`/`readAllNotifyLogs` necesitan saber de quién |
| become-seller | GET1/POST1 | GET **pub**, POST **? ambigua** | `become-seller.ts` SSR anónimo para el GET; el POST de solicitud no tiene evidencia de requerir sesión previa |
| order-status | GET2/POST1/PUT1/DELETE1 | GET **pub** (confianza media, reference data), resto **perm** | No confirmado en SSR, pero es lista estática de estados como `categories` |
| web-hook | GET3 | **esp** | Llamado por Stripe/Razorpay/PayPal, no por un usuario — `web-hook.controller.ts:4-19` |
| address | GET2/POST1/PUT1/DELETE1 | **auth** | Direcciones propias del usuario, `USERS_ADDRESS` |
| my-questions | GET2/POST1/PUT1/DELETE1 | **auth** | `MY_QUESTIONS` |
| my-reports | GET1 | **auth** | `MY_REPORTS` |
| my-wishlists | GET2/POST1/PUT1/DELETE1 | **auth** | `USERS_WISHLIST` |
| wishlists | GET3/POST2/PUT1/DELETE1 | **auth** | `WISHLIST` (remove, check, toggle) — acción sobre el wishlist propio |
| cards | GET2/POST1/PUT1/DELETE1 | **auth** | Métodos de pago propios |
| /save-payment-method | POST1 | **auth** | ídem |
| /set-default-card | POST1 | **auth** | ídem |
| downloads | GET1/POST1 | **auth** | Descargas digitales propias del comprador |
| attachments | POST1 | **auth** | Subida de imágenes (reviews, avatar); ningún endpoint anónimo de subida en el shop |
| abusive_reports | GET2/POST1/PUT1/DELETE1 | GET **perm** (moderación admin), POST **auth** (reportar) | Admin tiene `ABUSIVE_REPORTS`/`ABUSIVE_REPORTS_DECLINE`; el shop solo hace `createAbuseReport` (POST) |
| reviews | GET2/POST1/PUT1/DELETE1 | GET **pub**, resto **auth** | Comentario propio del controller (`reviews.controller.ts:20-23`): "todas las reviews aparecen en la página del producto" — se renderiza sin login |
| questions | GET2/POST1/PUT1/DELETE1 | GET **pub**, resto **auth** | Mismo patrón que reviews: preguntas del producto se muestran en la página pública |
| feedbacks | GET2/POST1/PUT1/DELETE1 | POST **auth** (votar útil/no útil requiere identidad), GET **? ambigua** (no confirmado si se usa para render público del conteo) | `FEEDBACK: /feedbacks`, usado en `createFeedback` |
| orders | GET3/POST3/PUT1/DELETE1 | **? ambigua** (ver pregunta 1) | `GET /orders` compartido entre "mis pedidos" (shop) y "todos los pedidos" (admin), sin distinción de ruta |
| order-status (ver arriba) | | | |
| downloads / export-order-url / download-invoice-url | GET1/GET1/POST1 | **perm** (admin exporta/descarga factura de cualquier tienda) | Solo en `api-endpoints.ts` de admin |
| refunds | GET2/POST1/PATCH1/DELETE1 | **? ambigua** (ver pregunta 2) | POST lo llama el shop (`createRefund`); GET también lo llama el shop (`orders.refunds`) pero sin filtro de propietario visible |
| payment-intent | GET1 | **? ambigua** (ver pregunta 3, checkout de invitado) | `client/index.ts:373-394`, ligado a un `tracking_number` de una orden |
| conversations | GET2/POST1 | **auth** | Mensajería comprador↔vendedor |
| messages/conversations | GET1/POST1 | **auth** | Mismo feature de mensajería |
| profiles | POST1/PUT1/DELETE1 | **? ambigua** (baja prioridad) | `createProfile`/`updateProfile` son stubs (`console.log`, no llaman al service) — no hay evidencia de que nadie los llame hoy; 401 por defecto es seguro cualquiera sea la decisión |
| subscribe-to-newsletter | POST1 | **? ambigua** | Suscribirse a newsletter típicamente no exige sesión, pero no hay SSR/hook que lo confirme como anónimo en este repo |
| users | GET2/POST4/PUT1/DELETE1 | **perm** | CRUD completo de usuarios, incluye `make-admin`/`block-user`/`unblock-user` — coincide con la nota de la US ("todo `/api/users`... exige permiso") |
| admin/list, vendors/list, customers/list, my-staffs, all-staffs | GET1 c/u | **perm** | Coincide 1:1 con CA-4 ("todo `/api/*/list`") |
| ai | POST1 | **perm** | `GENERATE_DESCRIPTION`, solo admin |
| imports | POST3 | **perm** | `IMPORT_PRODUCTS/ATTRIBUTES/VARIATION_OPTIONS`, solo admin |
| ownership-transfer | GET2/POST1/PUT1/DELETE1 | **perm** | Transferencia de propiedad de tienda, store_owner/admin |
| withdraws | GET2/POST2/DELETE1 | **perm** | Retiros del vendedor + aprobación admin |
| shippings | GET2/POST1/PUT1/DELETE1 | **? ambigua** (ver pregunta 4) | ¿Tarifa de envío calculada en checkout de invitado, o solo panel admin de tarifas? |
| taxes | GET2/POST1/PUT1/DELETE1 | **? ambigua** (misma pregunta 4) | Igual que shippings |
| store-notices | GET3/POST1/PUT1/DELETE1 | **perm** | `client.storeNotice.all` existe en `client/index.ts` pero `grep` de su uso en `.tsx` del shop da **0 resultados** — código muerto en el frontend público; admin sí lo usa completo |
| notify-logs (getUsersToNotify) | incluido arriba | **perm** | Sub-ruta admin dentro de `store-notices.controller.ts:31-34` en realidad (`getUsersToNotify`), pertenece al feature de staff |
| analytics / category-wise-product / low-stock-products / top-rate-product | GET1 c/u | **perm** | 1:1 con constantes admin (`ANALYTICS`, `CATEGORY_WISE_PRODUCTS`, `LOW_STOCK_PRODUCTS_ANALYTICS`, `TOP_RATED_PRODUCTS`) |
| addresses/register/token/social-login-token/otp-login/send-otp-code/verify-otp-code/forget-password/reset-password/change-password/logout/verify-forget-password-token/me/add-points/contact-us | ver detalle abajo | mixto | `auth.controller.ts`, 14 rutas — ver nota específica |

**Nota sobre `auth.controller.ts` (14 rutas, prefijo vacío)**: `register`,
`token` (login), `social-login-token`, `otp-login`, `send-otp-code`,
`verify-otp-code`, `forget-password`, `reset-password`,
`verify-forget-password-token`, `contact-us` deben ser **`@Public()`** — son
exactamente el flujo que permite obtener un token o recuperar acceso; exigir
uno ya sería circular. `me` y `change-password` y `add-points` **ya
resuelven su propio 401** vía `@CurrentUser()` (no necesitan `@Public()` ni
`@Permissions()`, pero si el guard global se activa sin `@Public()` en ellos,
igual deben quedar accesibles con token — es decir, son "autenticadas", el
guard global las deja pasar con token válido y el decorador ya hace su propio
trabajo). `logout` no valida nada hoy (D-9, sin denylist) — es indiferente
que sea pública o autenticada en términos de comportamiento observable, pero
semánticamente es una acción de sesión: **`auth`**.

## Permission model (C)

- Las 4 filas de `permissions` (`db/schema.sql:163-177`, `db/seed.sql:68-89`):
  `super_admin(1)`, `customer(2)`, `store_owner(3)`, `staff(4)`, vía pivote
  `permission_user` (PK compuesta `user_id, permission_id`). US-22 ya las lee
  con `findUserWithRelations()` y las mete en el JWT como
  `permissions: string[]` (nombres, no ids) — confirmado en
  `auth.service.ts:156,160` y `:190,194`.
- **El modelo cliente-servidor no está alineado hoy**: `hasAccess(allowedRoles,
  userPermissions)` (`apps/admin/rest/src/utils/auth-utils.ts:54-64`) hace un
  `_allowedRoles.find(aRole => _userPermissions.includes(aRole))` — es decir,
  "¿el usuario tiene AL MENOS UNO de los roles permitidos?", sobre el mismo
  array `permissions[]` que ya viaja en el JWT. Este es exactamente el
  contrato que `@Permissions(...allowed)` debe replicar en el guard del
  servidor: mismo array, misma semántica de "any-of", sin inventar nada
  nuevo. `owner.tsx:203,245` usa `adminAndOwnerOnly`/`adminOnly` — listas de
  constantes ya definidas en `auth-utils.ts:13-18`
  (`allowedRoles`, `adminAndOwnerOnly`, `adminOwnerAndStaffOnly`, `adminOnly`,
  `ownerOnly`, `ownerAndStaffOnly`) que son un catálogo de combinaciones
  reutilizable — el guard de US-23 puede tomar prestadas las mismas
  combinaciones en vez de inventar strings sueltos por ruta.
- **La brecha real**: hoy `hasAccess()` solo decide qué se **pinta** en el
  admin (esconder un botón, redirigir una página); un `curl` directo a la API
  con o sin token llega igual a cualquier controller. Nada del lado servidor
  lee `permissions[]` — es la premisa completa de la US.

## Approaches (D)

1. **`CanActivate` a mano con el `JwtService` existente + `Reflector` para
   `@Public()`/`@Permissions()`** (lo que pide la US: `jwt-auth.guard.ts` +
   `permissions.guard.ts`)
   - Pros: reutiliza `resolveJwtOptions()` y la lógica de extracción de
     bearer token que `current-user.decorator.ts` ya probó en producción
     (login, me, change-password de US-22); cero dependencias nuevas; el
     `JwtAuthGuard` puede poblar `request.user` con el mismo payload que
     `@CurrentUser()` ya decodifica, permitiendo que `@CurrentUser()`
     sobreviva casi sin cambios (leer `request.user` en vez de re-verificar
     el token si el guard ya corrió).
   - Cons: hay que escribir a mano el árbol de metadata (`SetMetadata` +
     `Reflector.getAllAndOverride`) que Passport ya trae resuelto.
   - Effort: Low-Medium.

2. **`@nestjs/passport` + `passport-jwt` + `AuthGuard('jwt')`**
   - Pros: es "la forma canónica" en el ecosistema Nest a largo plazo.
   - Cons: sería la SEGUNDA implementación de "verificar un JWT" en el
     repo — la primera (`current-user.decorator.ts`) ya existe y funciona;
     mantener ambas (una para el guard, otra para `@CurrentUser()`) es
     redundancia de mantenimiento sin beneficio, y añade una familia de
     dependencias nueva (`passport`, `passport-jwt`, sus tipos) a un repo que
     ya declinó dependencias pesadas antes (bcryptjs sobre bcrypt nativo, por
     evitar toolchain de C++ en Windows — mismo criterio de "menos
     dependencias" aplica aquí).
   - Effort: Medium (más piezas, mismo resultado funcional).

**Recomendación**: opción 1. Es consistente con lo que US-22 ya construyó
(`JwtService` + verificación manual), no introduce una segunda forma de
validar tokens, y es literalmente lo que pide la tabla "Archivos a crear/
modificar" de la propia US (`jwt-auth.guard.ts`, `permissions.guard.ts`,
`decorators/` con `@Public()`/`@Permissions()`/`@CurrentUser()` — este último
ya existe y puede moverse o quedar donde está).

### `@Permissions()` sin ir a la base (D-5 / CA-5)

El `PermissionsGuard` debe leer `request.user.permissions` (el array ya
decodificado del JWT por el `JwtAuthGuard` que corre antes en la cadena de
guards globales) y comparar contra los permisos exigidos por el decorador,
con la MISMA semántica "any-of" que `hasAccess()` ya usa en los frontends. El
comentario obligatorio que pide CA-5 debe decir, en esencia: *revocar un
permiso en la base no afecta un token ya emitido — el usuario conserva ese
permiso hasta que el JWT expira (`JWT_EXPIRES_IN`, 7 días por defecto,
`jwt-options.ts:31`)*.

### Verificación disponible

- `just verify` (`justfile:182-...`): pega el conteo real de `product-card`
  en las 3 apps vía `http.get` a `/en` (shop), `/en/login` (admin) y
  `/api/settings` (API) — detecta exactamente una regresión de CA-3.
- `just build-api`: compilación limpia de Nest.
- Precedente de comparación byte a byte: `/api/settings` = 5503 bytes
  (establecido en el episodio archivado de US-21/US-22) — debe re-verificarse
  en esta US, no asumirse, porque el guard podría cambiar encabezados de
  respuesta aunque el cuerpo no cambie.

## Preguntas para el usuario (parar y preguntar, por instrucción explícita de la US)

1. **`GET /orders` y `GET /refunds`**: comparten una sola ruta entre "el
   admin ve todos los pedidos/reembolsos" y "el cliente ve los suyos", sin
   ningún filtro de propietario forzado por el servidor (`GetOrdersDto` tiene
   `customer_id` **opcional**). ¿El diseño debe (a) exigir permiso admin para
   listar sin `customer_id`, dejando pasar con token cualquiera si se filtra
   por el propio id, o (b) simplemente marcar la ruta `auth` sin split y
   confiar en que el servicio ya filtra correctamente (no verificado en esta
   exploración — quedaría fuera del alcance de "solo protegerlas" de la US)?
2. **`new-shops`**: ¿es la cola de aprobación del admin (`NEW_OR_INACTIVE_SHOPS`)
   o una sección pública tipo "tiendas nuevas" en el storefront? No hay
   evidencia de uso en `apps/shop`.
3. **`refund-reasons`**: el método existe en el cliente del shop
   (`client/index.ts:396-403`) pero no lo llama ningún componente. ¿Se
   declara pública igual (reference data no usada aún) o se trata como admin?
4. **`shippings` y `taxes` (GET)**: ¿el checkout de invitado (carrito sin
   login) necesita calcular envío/impuestos antes de autenticarse, o el
   storefront siempre exige login antes de llegar al checkout? Cambia si
   estas 2 rutas son públicas o autenticadas.
5. **`coupons` (GET lista) y `POST coupons/verify`**: confirmado que la lista
   se prefetchea anónima en `coupon.ssr.ts`, pero `verify` se invoca desde el
   flujo de carrito — ¿el carrito permite aplicar cupón antes de loguearse?
6. **`payment-intent` y el "tracking-number lookup" de `orders`**: el patrón
   Pickbazar histórico permite a un invitado consultar el estado de su pedido
   con el número de seguimiento, sin sesión. ¿Este repo preserva esa
   posibilidad (rutas públicas con validación por tracking number) o exige
   login para cualquier cosa relacionada a un pedido?
7. **`become-seller` (POST, solicitud)**: ¿requiere ser un `customer`
   autenticado, o un visitante anónimo puede aplicar directamente?
8. **`subscribe-to-newsletter`**: ¿pública (opt-in de marketing, sin sesión)
   o autenticada?
9. **`feedbacks` (GET)**: ¿se usa para renderizar públicamente un conteo de
   "útil/no útil" en reviews/preguntas, o es solo interno?
10. **`profiles` (POST/PUT/DELETE)**: son stubs muertos (`console.log`, no
    llaman al service) — baja prioridad, pero conviene decidir si se
    documentan como "sin uso, 401 por defecto" o se eliminan en otra US.

Ninguna de estas 10 bloquea escribir el inventario base ni el diseño del
guard en sí — bloquean únicamente la clasificación **final** de ~12 de las
250 rutas (menos del 5%). El resto (≈238 rutas) tiene evidencia directa
(SSR anónimo confirmado, o mapeo 1:1 con `api-endpoints.ts` del admin, o
patrón CRUD estándar con sufijos `approve-`/`disapprove-`/`admin/`).

## Recommendation

Instalar el guard en dos capas, siguiendo el propio plan de archivos de la
US: `JwtAuthGuard` (global, `APP_GUARD`, respeta `@Public()` vía
`Reflector`) + `PermissionsGuard` (local por ruta vía `@UseGuards()` o
también global respetando `@Permissions()` ausente = "cualquier autenticado
basta"), ambos construidos a mano sobre el `JwtService` que US-22 ya dejó
funcionando — sin Passport. Orden de trabajo, tal como pide la nota del
agente ejecutor: (1) cerrar las 10 preguntas de arriba con el usuario, (2)
anotar `@Public()`/`@Permissions()` en las 250 rutas según la tabla
resultante, (3) recién ahí activar el guard global, (4) `just verify` +
navegación manual + comparación byte a byte de `/api/settings`.

## Risks

- **Alto — R-1 del épico, directo**: activar el guard global antes de anotar
  TODAS las públicas (incluidas las 2 no obvias que este exploración
  encontró: `coupons` y `notify-logs`, prefetcheadas anónimas en SSR) rompe
  el shop. Mitigado solo si el orden de trabajo de la recomendación se
  respeta.
- **Medio — las 10 preguntas de arriba** no tienen evidencia concluyente en
  el código actual; cualquier respuesta equivocada en ellas es silenciosa
  (no rompe `just verify`, que solo cuenta product-cards) hasta que alguien
  la ejercite manualmente.
- **Bajo — discrepancia de conteo 249 vs 250**: no bloquea nada (el DoD de la
  US acepta "el total real medido en el momento"), pero conviene que
  `sdd-propose` use 250, no 249, para que los números cuadren en la
  Definición de Done.
- **Bajo — `profiles` controller es código muerto** (stubs `console.log`):
  no afecta la clasificación (401 por defecto es seguro), pero vale
  mencionarlo para que no se le dedique tiempo de diseño de más.

## Ready for Proposal

**Parcial.** El inventario está armado con evidencia real y las 250 rutas
tienen clasificación propuesta, pero **10 grupos de rutas (~12 rutas
individuales) requieren una decisión explícita del usuario** antes de que
`sdd-propose` pueda comprometerse a un diseño de `@Public()`/`@Permissions()`
completo, tal como exige la propia nota del agente ejecutor de la US ("si
aparece una ruta cuya clasificación es dudosa, parar y preguntar"). El guard
en sí (arquitectura, dependencias, D-5) no tiene ninguna pregunta pendiente:
esa parte está lista para proponerse ya.
