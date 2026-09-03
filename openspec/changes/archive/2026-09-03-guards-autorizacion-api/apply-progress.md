# Apply Progress: Autorización — guard global y permisos por ruta (US-23)

> **Estado final: 40/40 tareas.** Este archivo es un registro POR SESIÓN, no
> un resumen vivo: los encabezados y el "Resumen" de más abajo describen cada
> sesión tal como terminó, y por eso la sesión 2 sigue diciendo "13/14 · 4.9
> pendiente". Esa tarea la cerró después el orquestador — ver **§CA-3** al
> final — y el auditor se endureció tras `sdd-verify` — ver **§H-1/H-2**.
> Se conserva el texto original de cada sesión en vez de reescribirlo, para
> que el registro no mienta sobre lo que sabía cada agente en su momento.

> Sesión 1 (`sdd-apply`): **Fases 1 y 2 (Batch 1 + Batch 2) únicamente**, por
> STOP BOUNDARY del prompt de esa sesión.
>
> Sesión 2 (`sdd-apply`, esta): **Fase 3 completa (activación) + las tareas
> de línea de comandos de la Fase 4**. La única tarea de Fase 4 NO ejecutada
> es **4.9** (navegación anónima manual en navegador real) — reservada al
> orquestador, que tiene herramienta de navegador; explícitamente fuera del
> alcance de este agente por instrucción del prompt.

## Resumen

- **Fase 1 (infraestructura inerte)**: 7/7 tareas completas (sesión 1).
- **Fase 2 (anotación de las 250 rutas)**: 14/14 tareas completas (sesión 1).
- **Fase 3 (activación)**: 5/5 tareas completas (sesión 2).
- **Fase 4 (verificación)**: 13/14 tareas completas (sesión 2); **4.9
  pendiente**, reservada al orquestador.

## Fase 1 — Batch 1: Infraestructura inerte

| Tarea | Estado | Detalle |
|---|---|---|
| 1.1 | [x] | `auth/decorators/public.decorator.ts` (`IS_PUBLIC_KEY`, `@Public()`) y `auth/decorators/permissions.decorator.ts` (`PERMISSIONS_KEY`, `@Permissions()`, `ADMIN_ONLY`/`ADMIN_AND_OWNER`/`ADMIN_OWNER_AND_STAFF`) creados. |
| 1.2 | [x] | `auth/current-user.decorator.ts` **movido** (no duplicado) a `auth/decorators/current-user.decorator.ts`. Camino normal: `request.user`. Fallback D-3 intacto: si `request.user` no está, verifica el bearer por su cuenta (mismo `JwtService` perezoso, mismo `extractBearerToken`, mismo `INVALID_TOKEN_MESSAGE`). Exporta `AuthenticatedRequest`. |
| 1.3 | [x] | Único importador (`auth.controller.ts:3`, 3 usos: `me`, `change-password`, `add-points`) actualizado a la nueva ruta. Verificado con `grep -rn "current-user.decorator" apps/api/rest/src` → un solo importador. |
| 1.4 | [x] | `auth/guards/jwt-auth.guard.ts`: `Reflector.getAllAndOverride(IS_PUBLIC_KEY, [handler, class])`; pasa si `@Public()`; si no, extrae y verifica el bearer, puebla `request.user`, 401 (`INVALID_TOKEN_MESSAGE`) en ausencia/esquema inválido/firma inválida/expirado. |
| 1.5 | [x] | `auth/guards/permissions.guard.ts`: any-of sobre `request.user.permissions`; 403 (`INSUFFICIENT_PERMISSIONS_MESSAGE`) si intersección vacía; **401, no 403**, si `request.user` está ausente (regla anti-fuga D). Docblock inmediatamente encima de `export class PermissionsGuard` con el coste CA-5. |
| 1.6 | [x] | `apps/api/rest/scripts/route-audit.mjs` creado: parser Node puro por bloque `@Controller`, modo tabla y `--check` bidireccional contra `EXPECTED_PUBLIC` (67 rutas: 64 del inventario + 3 `web-hook`). Reporta rutas faltantes (romperían el storefront) y sobrantes (hueco silencioso) por separado, más el conteo total. |
| 1.7 | [x] | Verificado: `grep -rn "APP_GUARD" apps/api/rest/src` → 0 resultados (incluidos comentarios — se reescribieron para no contener el literal); `just build-api` limpio; `node scripts/route-audit.mjs` corrió reportando `total=250 public=0 perm=0 auth=247 esp=3` antes de anotar nada. |

### Nota sobre el `grep` de `APP_GUARD` en comentarios

El primer borrador de `jwt-auth.guard.ts` y `current-user.decorator.ts`
mencionaba `APP_GUARD` en prosa explicativa (comentarios), lo que hacía que
`grep -rn "APP_GUARD" apps/api/rest/src` devolviera resultados aunque el guard
no estuviera registrado como provider. Se reescribieron esos comentarios para
describir el mecanismo sin usar el literal, preservando el significado. Esto
es una precaución adicional del STOP BOUNDARY del prompt, más estricta que el
requisito funcional real (que solo exige que no haya un provider `APP_GUARD`
registrado).

## Fase 2 — Batch 2: Anotación de las 250 rutas (45 controllers)

| Tarea | Estado | Detalle |
|---|---|---|
| 2.1 | [x] | `auth.controller.ts`: `@Public()` en 10 rutas (register, token, social-login-token, otp-login, send-otp-code, verify-otp-code, forget-password, reset-password, verify-forget-password-token, contact-us). `me`, `change-password`, `add-points`, `logout` quedan sin anotar (auth). |
| 2.2 | [x] | 22 rutas de catálogo de lectura anotadas `@Public()` a nivel de handler (mixto) o clase (homogéneo): `products` (2), `popular-products`/`best-selling-products` (clase), `categories` (2), `types` (2), `tags` (2), `shops` (2), `near-by-shop` (clase), `authors` (2) + `top-authors` (clase), `manufacturers` (2) + `top-manufacturers` (clase), `flash-sale` (2) + `products-by-flash-sale` (clase). |
| 2.3 | [x] | 15 rutas de contenido/referencia: `settings` GET, `faqs` (2), `terms-and-conditions` (2), `refund-policies` (2), `refund-reasons` (2), `order-status` (2, en `orders.controller.ts`), `shippings` (2), `taxes` (2) — todas `@Public()` a nivel de handler (controladores mixtos). |
| 2.4 | [x] | 6 GET de UGC (`reviews` 2, `questions` 2, `feedbacks` 2) + 4 de `coupons` (GET, GET `:param`, GET `:id/verify`, POST `verify`) anotadas `@Public()`. Escrituras de `reviews`/`questions`/`feedbacks` (POST/PUT/DELETE) quedan sin anotar (auth). |
| 2.5 | [x] | `POST /orders` y `POST /orders/checkout/verify` → `@Public()` con comentario D-10 (`guestCheckout: true`, checkout de invitado vivo). |
| 2.6 | [x] | `notify-logs` GET (2) → `@Public()` handler-level (PUT/PUT/DELETE quedan auth); `became-seller` → `@Public()` clase (2 rutas); `subscribe-to-newsletter` → `@Public()` clase (1 ruta). |
| 2.7 | [x] | `web-hook.controller.ts` → `@Public()` a nivel de clase (3 GET: razorpay, stripe, paypal) con comentario D-7 (terceros sin JWT, sin validación de firma, R-6 fuera de alcance). |
| 2.8 | [x] | `@Permissions(...ADMIN_ONLY)`: `UsersController` (8), los 5 `*/list` (`admin/list`, `vendors/list`, `my-staffs`, `all-staffs`, `customers/list`), `AnalyticsController` + 3 clases hermanas (4), `ImportsController` (3), `AiController` (1), `AttributesController` (5, taxonomía global — ninguna de sus rutas está en el inventario de catálogo público), taxonomía global mixta (`categories`, `types`, `tags`, `faqs`, `terms-and-conditions`, `refund-policies`, `refund-reasons`, `order-status`, `shippings`, `taxes`, `settings` POST) y toda aprobación (`draft-products`, `products-stock`, `approve-`/`disapprove-coupon`, `approve-`/`disapprove-shop` + `shops/approve`+`shops/disapprove` handler-level, `approve-`/`disapprove-terms-and-conditions`, `new-shops`, `abusive_reports` GET/GET/PUT/DELETE). |
| 2.9 | [x] | `@Permissions(...ADMIN_AND_OWNER)`: `StaffsController` (5), `ShopsController` escrituras (create/update/remove, handler-level), `OwnershipTransferController` (5), `WithdrawsController` (5), `StoreNoticesController` (6), facturas (`export-order-url`, `download-invoice-url`). |
| 2.10 | [x] | `@Permissions(...ADMIN_OWNER_AND_STAFF)` por handler: `ProductsController` (create/update/remove), `AuthorsController`, `ManufacturersController`, `FlashSaleController`, `CouponsController` (create/update/remove), `orders` PUT/DELETE, `refunds` PATCH/DELETE. |
| 2.11 | [x] | Verificado: `ProfilesController` (`users.controller.ts`, 3 rutas: POST/PUT/DELETE) queda sin ningún decorador — cae en `special` en el auditor (hardcode por nombre de clase, D-9). No se tocó el archivo salvo para agregar el import/decorador de `UsersController` (clase distinta en el mismo archivo). |
| 2.12 | [x] | Verificado (por inspección + auditor): las 63 rutas "autenticada" no llevan decorador — `auth` (4: me/change-password/add-points/logout), `address` (5), `my-questions` (5), `my-wishlists` (5), `wishlists` (7), `my-reports` (1), `downloads` (2), `conversations` (3), `messages` (2), `attachments` (1), `cards` (5) + `save-payment-method` (1) + `set-default-card` (1) + `payment-intent` (1), `reviews`/`questions`/`feedbacks` escritura (9), `abusive_reports` POST (1), `notify-logs` PUT/PUT/DELETE (3), `orders` GET×3 + POST `/payment` (4), `refunds` POST/GET/GET (3). |
| 2.13 | [x] | `node scripts/route-audit.mjs --check` → exit 0, tabla `total=250 public=67 perm=117 auth=63 esp=3` (evidencia pegada abajo). |
| 2.14 | [x] | `just build-api` limpio y `grep -rn "APP_GUARD" apps/api/rest/src` → 0 resultados (evidencia pegada abajo). |

## Evidencia real — Sesión 1 (Definición de Done de Fases 1 y 2)

### 1. `just build-api`

```
$ just build-api
yarn build
yarn run v1.22.22
$ rimraf dist
$ nest build
(node:37700) [DEP0053] DeprecationWarning: The `util.isObject` API is deprecated. Please use `arg !== null && typeof arg === "object"` instead.
(Use `node --trace-deprecation ...` to show where the warning was created)
Done in 80.58s.
```

### 2. `node apps/api/rest/scripts/route-audit.mjs --check`

```
$ node apps/api/rest/scripts/route-audit.mjs --check
total=250 public=67 perm=117 auth=63 esp=3
[route-audit] --check OK: el set de rutas públicas coincide con EXPECTED_PUBLIC.
```

Exit code: `0`.

Reconciliación con `proposal.md` (CA-1): pública=64 + especial-webhook=3 →
`public=67` efectivo · con permiso=117 → `perm=117` · autenticada=63 →
`auth=63` · especial (solo `profiles`, los 3 `web-hook` ya cuentan como
`public`) → `esp=3`. **64+63+117+6 = 250** (proposal) ⇔ **67+117+63+3 = 250**
(auditor, con los 3 `web-hook` reclasificados dentro de `public` porque
llevan `@Public()` efectivo). Sin discrepancias.

### 3. `grep -rn "APP_GUARD" apps/api/rest/src`

```
$ grep -rn "APP_GUARD" apps/api/rest/src
(0 resultados)
```

Confirmado también por segunda vía (`grep` con código de salida 1 = sin
coincidencias).

## Archivos creados

| Archivo | Descripción |
|---|---|
| `apps/api/rest/src/auth/decorators/public.decorator.ts` | `IS_PUBLIC_KEY`, `@Public()` |
| `apps/api/rest/src/auth/decorators/permissions.decorator.ts` | `PERMISSIONS_KEY`, `@Permissions()`, `ADMIN_ONLY`/`ADMIN_AND_OWNER`/`ADMIN_OWNER_AND_STAFF` |
| `apps/api/rest/src/auth/decorators/current-user.decorator.ts` | Movido desde `auth/current-user.decorator.ts`; lee `request.user`, fallback D-3 intacto |
| `apps/api/rest/src/auth/guards/jwt-auth.guard.ts` | Guard global (inerte hasta Fase 3) |
| `apps/api/rest/src/auth/guards/permissions.guard.ts` | Guard global (inerte hasta Fase 3) |
| `apps/api/rest/scripts/route-audit.mjs` | Auditor de rutas, Node puro |

## Archivos eliminados

| Archivo | Motivo |
|---|---|
| `apps/api/rest/src/auth/current-user.decorator.ts` | Movido a `auth/decorators/` (D-3: mover, no duplicar) |

## Archivos modificados (Fase 2 — anotación)

`auth.controller.ts` · `products/products.controller.ts` ·
`categories/categories.controller.ts` · `types/types.controller.ts` ·
`tags/tags.controller.ts` · `shops/shops.controller.ts` ·
`authors/authors.controller.ts` · `manufacturers/manufacturers.controller.ts` ·
`flash-sale/flash-sale.controller.ts` · `settings/settings.controller.ts` ·
`faqs/faqs.controller.ts` ·
`terms-and-conditions/terms-and-conditions.controller.ts` ·
`refund-policies/refund-policies.controller.ts` ·
`refund-reasons/refund-reasons.controller.ts` ·
`shippings/shippings.controller.ts` · `taxes/taxes.controller.ts` ·
`reviews/reviews.controller.ts` · `questions/questions.controller.ts` ·
`feedbacks/feedbacks.controller.ts` · `coupons/coupons.controller.ts` ·
`orders/orders.controller.ts` · `refunds/refunds.controller.ts` ·
`notify-logs/notify-logs.controller.ts` ·
`become-seller/become-seller.controller.ts` ·
`newsletters/newsletters.controller.ts` · `web-hook/web-hook.controller.ts` ·
`users/users.controller.ts` · `analytics/analytics.controller.ts` ·
`imports/imports.controller.ts` · `ai/ai.controller.ts` ·
`attributes/attributes.controller.ts` · `reviews/reports.controller.ts`
(`abusive_reports`) · `ownership-transfer/ownership-transfer.controller.ts` ·
`withdraws/withdraws.controller.ts` ·
`store-notices/store-notices.controller.ts`.

Controladores que se dejaron **sin tocar** a propósito (100% del bucket
"autenticada", ningún `@Public()`/`@Permissions()` que agregar):
`addresses/addresses.controller.ts`, `conversations/conversations.controller.ts`,
`messages/messages.controller.ts`, `questions/my-questions.controller.ts`,
`wishlists/my-wishlists.controller.ts`, `wishlists/wishlists.controller.ts`,
`reports/reports.controller.ts` (`my-reports`),
`payment-method/payment-method.controller.ts`,
`payment-intent/payment-intent.controller.ts`,
`uploads/uploads.controller.ts`.

## Deviations from Design

Ninguna deviation de fondo. Dos precisiones registradas:

1. **Comentarios sin el literal `APP_GUARD`** (ver nota arriba) — más
   estricto que el diseño, no lo contradice.
2. **`AttributesController`**: el diseño no lo menciona por nombre; se
   determinó por reconciliación aritmética contra el total de "51 escrituras
   de catálogo y contenido" del proposal (ver razonamiento: sin `attributes`
   la suma da 46, con sus 5 rutas da 51) que sus 5 rutas van íntegras a
   `@Permissions(...ADMIN_ONLY)` como taxonomía global — ninguna de sus rutas
   aparece en el inventario de catálogo público (CA-1). Documentado con un
   comentario en el propio archivo.

## Issues Found

Ninguno. El auditor cuadró exactamente contra `EXPECTED_PUBLIC` (67 rutas)
en el primer `--check` tras completar la Fase 2, sin iteración de
correcciones — validación cruzada de que la reconciliación aritmética hecha
antes de anotar (proposal.md CA-1 ⇔ design.md Decisión B/F) era correcta.

## STOP BOUNDARY — confirmado respetado (Sesión 1)

- `apps/api/rest/src/app.module.ts`: **sin tocar** (`providers: []` sigue
  vacío).
- `apps/api/rest/src/auth/auth.module.ts`: **sin tocar** (`exports:
  [AuthService]` sigue igual — el cambio a `[AuthService, JwtModule]` es la
  tarea 3.1, fuera de esta sesión).
- `apps/api/rest/src/orders/orders.controller.ts`: el filtro de propiedad
  D-8 en `GET /orders` (tarea 3.3) **no se aplicó** — solo se anotaron
  `@Public()`/`@Permissions()` (Fase 2, dentro de alcance).
- `apps/README.md`: **sin tocar**.
- `grep -rn "APP_GUARD" apps/api/rest/src` → 0 resultados (evidencia arriba).

> Los cuatro puntos de arriba describen el estado AL CIERRE de la Sesión 1.
> La Sesión 2 (más abajo) es la que específicamente tenía el mandato de
> cruzar ese boundary, en orden y con el gate `--check` limpio como
> precondición verificada de nuevo antes de tocar nada.

## Fase 3 — Batch 3: Activación (Sesión 2)

**Gate previo (R-1), verificado ANTES de tocar `app.module.ts`/`auth.module.ts`:**

```
$ node apps/api/rest/scripts/route-audit.mjs --check
total=250 public=67 perm=117 auth=63 esp=3
[route-audit] --check OK: el set de rutas públicas coincide con EXPECTED_PUBLIC.
EXIT=0

$ grep -rn "APP_GUARD" apps/api/rest/src
(0 resultados, exit 1)
```

Gate limpio confirmado — se procedió con la activación.

| Tarea | Estado | Detalle |
|---|---|---|
| 3.1 | [x] | `auth/auth.module.ts`: `exports: [AuthService]` → `exports: [AuthService, JwtModule]`, con comentario explicando que `AppModule` instancia los `APP_GUARD` y `JwtAuthGuard` inyecta `JwtService`. |
| 3.2 | [x] | `app.module.ts`: import de `APP_GUARD` (`@nestjs/core`), `JwtAuthGuard` y `PermissionsGuard`; `providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: PermissionsGuard }]`, en ese orden, con comentario sobre el corto-circuito de Nest (Decisión A). |
| 3.3 | [x] | `orders.controller.ts`, `GET /orders`: agregado `@CurrentUser() user: CurrentUserPayload`; `isAdminLevel = ADMIN_OWNER_AND_STAFF.some(...)`; `customer_id` se sobreescribe con `user.sub` si no es admin-level (D-8). Import de `CurrentUser`/`CurrentUserPayload` desde `auth/decorators/current-user.decorator.ts`. |
| 3.4 | [x] | `refunds.controller.ts`: **ya llevaba el comentario D-8/Decisión G** desde la Fase 2 (se agregó junto con el `@Permissions()` de PATCH/DELETE, adelantado a su tarea formal) — verificado por inspección, sin cambios adicionales necesarios. Queda autenticado, sin `@Public()`. |
| 3.5 | [x] | `apps/README.md`: nueva sección "Autorización (US-23): guard global + permisos por ruta" — tabla de respuestas por situación, cómo obtener un token real y probar 3 casos con `curl`, mención del auditor de rutas, y los 4 caveats declarados (R-2 checkout invitado, R-6 webhooks sin firma, `/docs` abierto, `GET /orders`/`GET /refunds` sin aislamiento punta a punta). |

### Build inmediatamente después de activar (confirma que 3.1 resuelve la dependencia)

```
$ just build-api
yarn build
yarn run v1.22.22
$ rimraf dist
$ nest build
Done in 72.70s.
```

### Arranque real de la API con los dos `APP_GUARD` activos

```
[Nest] ... [NestApplication] Nest application successfully started +12ms
Application is running on: http://[::1]:9001/api
```

Sin el export de `JwtModule` (tarea 3.1) esto falla en el arranque con "Nest
can't resolve dependencies of JwtAuthGuard (?, Reflector)" — el arranque
limpio confirma que la Decisión A quedó bien cableada.

## Evidencia real — Sesión 2 (Fase 4, Definición de Done post-activación)

Entorno: `just db-up` (Postgres 5433) + API en `9001` (`yarn start:dev`) +
shop en `3003` + admin en `3002`, arrancados en ese orden.

### 4.1 — `route-audit.mjs --check` post-activación

```
$ node apps/api/rest/scripts/route-audit.mjs --check
total=250 public=67 perm=117 auth=63 esp=3
[route-audit] --check OK: el set de rutas públicas coincide con EXPECTED_PUBLIC.
```

### 4.2–4.5 — Los 4 casos de `curl`

**Caso 1 — pública sin token → 200** (`GET /api/settings`):

```
$ curl -s -o /dev/null -w "STATUS=%{http_code}\n" http://localhost:9001/api/settings
STATUS=200
```

Body (snippet): `{"id":1,"options":{"seo":{"ogImage":null,...`

**Caso 2 — protegida sin token → 401** (`GET /api/users`):

```
$ curl -i -s http://localhost:9001/api/users
HTTP/1.1 401 Unauthorized
Content-Type: application/json; charset=utf-8
Content-Length: 98

{"statusCode":401,"message":"Token de autenticación ausente o inválido.","error":"Unauthorized"}
```

**Caso 3 — token `customer@demo.com`/`demodemo`, permiso insuficiente → 403** (`GET /api/users`):

```
$ curl -i -s http://localhost:9001/api/users -H "Authorization: Bearer $CUSTOMER_TOKEN"
HTTP/1.1 403 Forbidden
Content-Type: application/json; charset=utf-8
Content-Length: 103

{"statusCode":403,"message":"No tienes permisos suficientes para esta operación.","error":"Forbidden"}
```

(`$CUSTOMER_TOKEN` minteado vía `POST /api/token` real, `{"email":"customer@demo.com","password":"demodemo"}` → `permissions:["customer"]`.)

**Caso 4 — token `admin@demo.com`/`demodemo`, permiso correcto → 200** (`GET /api/users`):

```
$ curl -i -s http://localhost:9001/api/users -H "Authorization: Bearer $ADMIN_TOKEN"
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Content-Length: 42585

{"data":[{"is_active":1,"id":3,"name":"Jhon Doe","email":"admin@demo.com",...
```

(`$ADMIN_TOKEN` minteado igual vía `POST /api/token` con `admin@demo.com`/`demodemo` → `super_admin`.)

### 4.6 — CA-4 extra: `*/list` con token `customer`

`GET /api/products/list` no es una ruta real (`products/:slug` la interpreta
como slug `list` → 404, evidencia de que no hay que confiar en el ejemplo
literal del prompt sin verificarlo contra el auditor). Se usó una ruta real
del bucket `*/list` (`route-audit.mjs` sin `--check` lista `/admin/list`,
`/vendors/list`, `/customers/list`, las tres `perm(...ADMIN_ONLY)`):

```
$ curl -i -s http://localhost:9001/api/admin/list -H "Authorization: Bearer $CUSTOMER_TOKEN"
HTTP/1.1 403 Forbidden
Content-Length: 103

{"statusCode":403,"message":"No tienes permisos suficientes para esta operación.","error":"Forbidden"}
```

### 4.7 — CA-5: guards sin acceso a base

```
$ grep -n "@safari/db\|@prisma/client\|prisma" apps/api/rest/src/auth/guards/*.ts
(0 resultados)
```

Docblock de coste (revocar un permiso no afecta a un token ya emitido hasta
que expira) confirmado presente inmediatamente encima de `export class
PermissionsGuard` en `permissions.guard.ts` (ver Fase 1, tarea 1.5).

### 4.8 — `just verify`

```
$ just verify
OK   API    :9001/api/settings  200  5503B  94ms
OK   Shop   :3003/en  200  190788B  79504ms  cards:30
OK   Admin  :3002/en/login  200  72821B  18579ms  cards:1
```

Exit 0. Shop cuenta **30 product-cards reales** en el home; admin renderiza
el login (1 `cards:` match es el propio formulario, no product-cards — el
recipe cuenta cualquier `product-card` en el HTML sin distinguir contexto,
comportamiento heredado, sin cambios de esta sesión).

### 4.9 — Navegación anónima manual (CA-3)

**NO ejecutada en esta sesión.** El prompt reserva explícitamente esta
verificación al orquestador (tiene herramienta de navegador); `sdd-apply` no
debe simularla ni marcarla. Checkbox de `tasks.md` queda `[ ]`.

### 4.10 — `just build-api` (post-activación, con guard restaurado tras el experimento de 4.11)

```
$ just build-api
yarn build
yarn run v1.22.22
$ rimraf dist
$ nest build
Done in 82.73s.
```

### 4.11 — Comparación byte a byte de `/api/settings`

Medición con precisión de bytes (`Buffer.concat(chunks).length`, no
`wc -c` de Git Bash ni `body.length` de un string JS):

```
$ curl -s http://localhost:9001/api/settings | node -e "..."
bytes= 5504
```

Precedente documentado (US-22 / `CLAUDE.md`): **5503 bytes**. Hay un
desfase de **1 byte** entre el precedente y esta medición. Investigado en
esta sesión con dos comprobaciones:

1. **El guard no lo causa.** Se comentó temporalmente el array `providers`
   de `app.module.ts` (quitando los dos `APP_GUARD`), se reconstruyó y
   recargó la API (`start:dev` en watch), y se volvió a medir contra los
   MISMOS datos de Postgres: **5504 bytes también sin guard**. Se restauró
   el array inmediatamente después (`git diff` confirma que `app.module.ts`
   quedó con los dos `APP_GUARD`, ver evidencia de 4.1/4.10 y el `grep`
   de `APP_GUARD` más abajo). Conclusión: el guard no toca el cuerpo de
   `/api/settings` — la Decisión A/B no introduce lógica en el pipeline de
   `SettingsController.findAll()`, solo metadata de decorador.
2. **La causa real es de qué mide `just verify`.** Su recipe (`justfile`)
   acumula el body con `body += c` sobre chunks `Buffer` (coerción
   implícita a string) y reporta `body.length`, que en JS es el número de
   **unidades UTF-16**, no de bytes. `/api/settings` contiene
   `"Copyright © REDQ. All rights reserved worldwide."` — el carácter `©`
   (U+00A9) pesa **2 bytes** en UTF-8 pero cuenta como **1** unidad UTF-16.
   Por eso `just verify` (evidencia de 4.8) reportó `5503B` para el MISMO
   response que `Buffer.length` mide en `5504`. Ambos números son
   correctos para lo que miden; no son la misma unidad.

**Caveat heredado (declarado en `design.md`/`CLAUDE.md`, no descubierto
ahora):** ninguna de las dos mediciones detecta la divergencia ya embarcada
`created_at`/`updated_at` (el seed no inserta esas columnas — las toma de
`now()` en cada `db-up` — y `Date.toJSON()` emite 3 decimales donde Laravel
traía 6); el string ISO resultante tiene longitud fija (24 caracteres,
`YYYY-MM-DDTHH:mm:ss.sssZ`) sea cual sea el valor, así que no mueve el
conteo. Verificado por inspección del body completo pegado más abajo.

Body completo post-activación (para que quede trazable qué se contó):

```json
{"id":1,"options":{"seo":{...},"logo":{...},...},"language":"en","created_at":"2026-09-02T15:33:36.102Z","updated_at":"2026-09-02T15:33:36.102Z"}
```

**Interpretación honesta**: "5503 = 5503" NO aplica aquí — hay un desfase de
1 byte respecto del precedente escrito, pero está explicado y aislado de la
activación del guard (mismo desfase con y sin `APP_GUARD`, en el mismo
proceso, contra los mismos datos). No se afirma que el guard preserve el
contrato byte a byte contra el precedente exacto de US-22; se afirma que el
guard no MUEVE el byte count, con evidencia directa de un experimento
controlado.

### 4.12 — `POST /orders` (D-10), al final

```
$ curl -i -s -X POST http://localhost:9001/api/orders -H "Content-Type: application/json" -d '{...}'
HTTP/1.1 201 Created
Content-Length: 21095

{"id":48,"tracking_number":"20240207303639","customer_id":2,...}
```

201 sin `Authorization` — el checkout de invitado sigue vivo tras la
activación del guard (D-10, `@Public()` en `POST /orders`).

### 4.13 — Caveat `/docs` (Decisión I)

```
$ curl -s -o /dev/null -w "STATUS=%{http_code}\n" http://localhost:9001/docs
STATUS=200
$ curl -s -o /dev/null -w "STATUS=%{http_code}\n" http://localhost:9001/docs-json
STATUS=200
```

Confirmado: `/docs` (Swagger UI) y `/docs-json` siguen abiertos sin token.
`SwaggerModule.serveDocuments` registra sus handlers directo en el adaptador
HTTP, fuera del pipeline de controllers — los `APP_GUARD` globales no corren
ahí. Declarado como conocido, no como defecto de esta sesión (cerrarlo es
otra US).

### Spot-checks adicionales (D-9, D-7)

```
$ curl -i -s -X POST http://localhost:9001/api/profiles -H "Content-Type: application/json" -d '{}'
HTTP/1.1 401 Unauthorized
{"statusCode":401,"message":"Token de autenticación ausente o inválido.","error":"Unauthorized"}

$ curl -i -s http://localhost:9001/api/web-hook/stripe
HTTP/1.1 200 OK
this action is for stripe pay
```

`profiles` (D-9, stub muerto sin anotar) cae en el deny-by-default → 401,
como predice el diseño. `web-hook/stripe` (D-7, `@Public()` a nivel de
clase) sigue respondiendo sin token, sin firma — declarado, no defecto.

### 4.14 — Status de la US y fila del épico

Actualizados en esta sesión:
- `docs/product/19-autenticacion-autorizacion/23-guards-autorizacion-api.md`:
  `Status` pasa a "Implementada — pendiente verificación manual de
  navegación anónima (CA-3, reservada al orquestador con herramienta de
  navegador)"; DoD con 6/7 ítems marcados (todo salvo la navegación
  manual).
- `docs/product/19-autenticacion-autorizacion/README.md`: fila de US-23 en
  la tabla de sub-historias actualizada al mismo status.

## Archivos modificados (Fase 3 — activación)

| Archivo | Acción | Qué cambió |
|---|---|---|
| `apps/api/rest/src/auth/auth.module.ts` | Modify | `exports: [AuthService]` → `exports: [AuthService, JwtModule]` (Decisión A) |
| `apps/api/rest/src/app.module.ts` | Modify | import de `APP_GUARD`, `JwtAuthGuard`, `PermissionsGuard`; `providers` con los dos `APP_GUARD` en orden |
| `apps/api/rest/src/orders/orders.controller.ts` | Modify | `GET /orders` gana `@CurrentUser()` y el filtro D-8 (`customer_id` forzado si no es admin-level) |
| `apps/api/rest/src/refunds/refunds.controller.ts` | Verificado, sin cambio nuevo | El comentario D-8/Decisión G ya estaba desde la Fase 2 |
| `apps/README.md` | Modify | Nueva sección de postura de seguridad + cómo probar con token + caveats |
| `docs/product/19-autenticacion-autorizacion/23-guards-autorizacion-api.md` | Modify | Status + DoD |
| `docs/product/19-autenticacion-autorizacion/README.md` | Modify | Fila de US-23 |

## Deviations from Design (Sesión 2)

Ninguna deviation de fondo respecto de `design.md`. Una precisión:

1. **Tarea 3.4 llegó ya cumplida** desde la Fase 2 (sesión 1): el comentario
   D-8/Decisión G en `refunds.controller.ts` se escribió junto con el
   `@Permissions(...ADMIN_OWNER_AND_STAFF)` de PATCH/DELETE (tarea 2.10),
   adelantado a su numeración formal. Se verificó por inspección directa del
   archivo antes de tocar nada; no fue necesario ningún cambio adicional.
2. **El ejemplo `GET /api/products/list` de la tarea 4.6 del prompt no es
   una ruta real** (colisiona con `products/:slug`, produce 404). Se
   sustituyó por `GET /api/admin/list`, una ruta real del bucket `*/list`
   confirmada contra `route-audit.mjs`, preservando la intención de CA-4
   (customer → 403 en una ruta `*/list`).

## Issues Found (Sesión 2)

Uno, resuelto dentro del alcance de esta sesión (no requirió tocar código de
producto, solo el entorno):

- **Puerto 9001 ya ocupado** al iniciar la sesión, por un proceso `node.exe`
  huérfano de una sesión anterior (API vieja, sin los guards activados).
  Se identificó con `just check-ports`, se confirmó vía `tasklist` que era
  un proceso Node aislado (no Zscaler) y se terminó con `taskkill` antes de
  levantar la API nueva. Documentado aquí porque no es un fallo de la
  guardia — es higiene de entorno entre sesiones.

## STOP BOUNDARY del prompt de esta sesión — confirmado respetado

- **NO se ejecutó la navegación anónima manual en navegador** (4.9):
  checkbox queda `[ ]`, sin marcarla y sin afirmarla en ningún resumen.
- **NO se tocó** `apps/shop`, `apps/admin`, `db/seed.sql`, rate limiting,
  CORS, cierre de `/docs`, ni `OrdersService.getOrders`/
  `RefundsService.findAll` (D-8 se aplicó solo en el borde del controller,
  como especifica el diseño).
- **NO se hizo** `git commit`, `git push`, ni se crearon branches.
- Los mock writes se dejaron como stubs — no se implementó ninguno.

## Remaining Tasks

Ninguna. 4.9 (navegación anónima manual) la cerró el orquestador después de
esta sesión — ver §CA-3 al final de este archivo.

## Status

> **Nota de reconciliación (orquestador):** lo que sigue describe el estado al
> cierre de la sesión 2 de apply, cuando faltaba 4.9. Estado final tras §CA-3:
> **40/40**. Se conserva el texto original en vez de reescribirlo, porque este
> archivo es registro de sesiones, no un resumen vivo.

**39/40 tareas completas al cierre de la sesión 2** (Fases 1–4: 7+14+5+13 = 39;
faltaba solo 4.9, reservada al orquestador). Build limpio, guard activo y verificado con los 4
casos de `curl`, `route-audit.mjs --check` limpio post-activación,
`just verify` verde con conteos reales, `/api/settings` estable (mismo byte
count con y sin guard, desfase de 1 byte contra el precedente explicado y
aislado del guard), `POST /orders` sigue abierto, `/docs` sigue abierto
(declarado), spot-checks de `profiles` (401) y `web-hook` (200) conformes al
diseño. Listo para `sdd-verify`, con la salvedad explícita de que CA-3
(navegación manual) queda pendiente de una sesión con herramienta de
navegador.

---

### §CA-3 — Navegación anónima en un navegador real (tarea 4.9)

Cerrada por el orquestador, que sí tiene herramienta de navegador. Servicios:
API en 9001 con los dos `APP_GUARD` activos, shop en 3003. Sin sesión en
ningún momento (contexto de navegador limpio, sin cookies ni token).

Las cinco rutas que exige CA-3, todas anónimas:

| Ruta | URL | Resultado |
|---|---|---|
| Home | `/` | **30 product-cards** reales con precios, descuentos e imágenes; sidebar con las 10 categorías |
| Detalle | `/products/apples` | carga con datos reales — título `Pickbazar \| Apples` |
| Búsqueda | `/grocery/search?text=chicken` | encuentra "Chicken"; árbol de categorías renderizado |
| Categoría | `/grocery/search?category=fruits-vegetables` | render correcto, `Showing 0 - 0 of 0 products` (ver nota) |
| Listado | `/shops` | **12 tiendas** con enlace a su ficha |

**Evidencia decisiva (red):** de las **30 peticiones** a `localhost:9001`
capturadas durante el recorrido, **todas devolvieron 200 o 304. Cero 401,
cero 403.** El guard no bloquea nada en la ruta anónima. Esto es más fuerte
que la ausencia de mensajes de error en pantalla: prueba que ninguna llamada
fue rechazada, aunque el frontend la tragara en silencio.

**Nota sobre la categoría vacía — NO es una regresión del guard.** La misma
URL que pidió el navegador, ejecutada con `curl` **sin token**, responde
`200` con `data.length=0`:

```
GET /api/products?...search=type.slug:grocery;categories.slug:fruits-vegetables;...
  -> status=200 data.length=0 total=0
GET /api/products?limit=5   (sin filtro)
  -> data.length=5
```

La API autoriza; es el filtrado del mock el que no encuentra coincidencias
para esa forma de query. Comportamiento preexistente, fuera del alcance de
US-23.

**Consola:** 18 mensajes `error`/`warn`, **ninguno de autorización**. Son
ruido preexistente de Pickbazar: el warning de React por `fetchPriority`, los
avisos de LCP de `next/image`, la deprecación de `apple-mobile-web-app-capable`
y un `CLIENT_FETCH_ERROR` de `next-auth` por un `500` en
`localhost:3003/api/auth/session`. Ese último es una ruta API **de la propia
tienda** (puerto 3003), no de la API Nest: `git status` confirma que
`apps/shop` y `apps/admin` están intactos en este cambio, así que no puede
originarse aquí.

Captura: `openspec/changes/archive/2026-09-03-guards-autorizacion-api/evidence-anon-storefront.png`
— la rejilla de productos de la home anónima: Apples `$1.60` (rebajado de
`$2.00`), Baby Spinach `$0.60`, Blueberries `$3.00`, Brussels Sprout al 40%,
Celery Stick al 17%, con imágenes reales y el sidebar de categorías. El header
muestra **"Join" / "Become a Seller"**, que es la prueba visual de que no hay
sesión iniciada.

> Una primera versión de esta captura mostraba el modal de newsletter tapando
> la home y no acreditaba ni una product-card — lo señaló `sdd-verify` (H-4) y
> se rehízo. Se deja anotado porque una captura que no prueba lo que dice
> probar es peor que no tenerla.

---

### §H-1/H-2 — Endurecimiento del auditor tras `sdd-verify` (orquestador)

`sdd-verify` sometió `route-audit.mjs` a mutación y encontró que cubría menos
de lo que su docblock prometía. Aprobado por el usuario endurecerlo antes de
archivar, por ser artefacto propio de US-23 y porque CA-1 exige que el
inventario sea **verificable**, no solo declarado.

**Lo que fallaba:**

- **H-1** — el `--check` solo diffeaba el set público. Borrar un
  `@Permissions()` de clase de `UsersController` —8 rutas que pasaban a
  "cualquier logueado basta"— no alteraba ese set: **exit 0**.
- **H-2** — el parser solo miraba la línea inmediatamente anterior al
  decorador HTTP. Un `@Public()` colocado en otro punto del bloque era
  **efectivo en runtime pero invisible al auditor**, es decir un falso verde
  en la dirección peligrosa, justo lo contrario de lo que afirmaba el
  docblock.

**Lo que se cambió** (`apps/api/rest/scripts/route-audit.mjs`):

1. `EXPECTED_PERM` (117 rutas, tomadas del estado ya verificado en runtime),
   más `EXPECTED_SPECIAL_COUNT` y `EXPECTED_TOTAL`. El `--check` ahora diffea
   en las dos direcciones **también** el bucket `perm`, y asevera especiales
   y total.
2. `decoratorBlockAbove()`: sube por todo el bloque de decoradores saltando
   comentarios y líneas en blanco, con balance de paréntesis para decoradores
   multilínea. La posición del `@Public()` dentro del bloque deja de importar.
3. **Invariante de atribución**: cada `@Public(`/`@Permissions(` presente en
   un `*.controller.ts` tiene que quedar atribuido a una clase o a un
   handler. Si el parser no lo ve, **falla** en vez de dar verde. Es la
   defensa de fondo contra H-2: cubre también las formas de escribir la
   anotación que nadie anticipó.
4. `ROUTE_AUDIT_SRC` permite auditar un árbol copiado (lo necesita el test).

**Nuevo: `apps/api/rest/scripts/route-audit.test.mjs`** — test de mutación.
Rompe el árbol a propósito sobre una copia desechable y exige el exit code
correcto en cada caso. Un auditor solo sirve si falla cuando debe; que dé
verde sobre el árbol bueno no prueba nada.

```
$ node scripts/route-audit.test.mjs
PASS  (exit 0, esperado 0)  árbol intacto → exit 0
PASS  (exit 1, esperado 1)  H-1: se borra el @Permissions() de clase de UsersController (8 rutas se aflojan a "cualquier logueado")
PASS  (exit 1, esperado 1)  falta una pública esperada: se borra el @Public() de GET /settings
PASS  (exit 1, esperado 1)  sobra una pública: se anota @Public() en una ruta de admin
PASS  (exit 0, esperado 0)  H-2: @Public() no adyacente (separado por otro decorador) sigue siendo visible
PASS  (exit 1, esperado 1)  H-2: una anotación que el parser NO puede atribuir hace fallar el check (no verde silencioso)

6/6 OK — el auditor falla cuando debe fallar.
```

```
$ node scripts/route-audit.mjs --check
total=250 public=67 perm=117 auth=63 esp=3
[route-audit] --check OK: públicas, con permiso, especiales y total coinciden
con la línea base; todas las anotaciones fueron atribuidas.

$ just build-api
Done in 134.04s.        # limpio
```

**No cambió ninguna clasificación de ruta**: los conteos son idénticos a los
de la activación (250 / 67 / 117 / 63 / 3). Esto endurece el control, no
altera la postura de seguridad embarcada.
