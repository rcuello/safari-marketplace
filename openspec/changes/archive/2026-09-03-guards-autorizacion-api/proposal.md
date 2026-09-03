# Proposal: Autorización — guard global y permisos por ruta

> **US-23**, Épico 19. Insumo: `explore.md` (esta carpeta), cuyo inventario se toma como
> autoritativo. Precedente: `archive/2026-09-02-login-jwt-postgres/`. Las 10 clasificaciones
> ambiguas que la exploración dejó abiertas las **cerró el dueño del repo** (2026-09-02): quedan
> fijadas abajo y **no se reabren** en `sdd-spec`/`sdd-design`.

## Intent

Las **250** rutas HTTP están abiertas: `grep -rn "CanActivate\|AuthGuard\|passport\|APP_GUARD\|@UseGuards" apps/api/rest/src` sigue dando **0 resultados** tras US-22. El token viaja en cada
request y solo 3 rutas lo leen (`me`, `change-password`, `add-points`, vía `@CurrentUser()`). La
autorización real vive en el cliente (`hasAccess()`): decide qué se *pinta*, y un `curl` la ignora
entera. Esta US invierte el default a **deny-by-default**.

**250, no 249**: total medido hoy con dos métodos independientes (grep de los 5 decoradores y
parser estructural por bloque `@Controller`), re-verificado en esta fase — 250 rutas en 45
archivos `*.controller.ts`. La DoD de la US acepta "el total real medido en el momento".

## Scope

### In Scope

| Archivo | Cambio |
|---|---|
| `auth/guards/jwt-auth.guard.ts` | nuevo: `CanActivate` global, respeta `@Public()` |
| `auth/guards/permissions.guard.ts` | nuevo: valida `@Permissions()` contra `request.user.permissions` |
| `auth/decorators/public.decorator.ts`, `permissions.decorator.ts` | nuevos (`SetMetadata`) |
| `auth/decorators/current-user.decorator.ts` | **movido** desde `auth/`, no duplicado (D-3) |
| `auth/auth.controller.ts` | actualizar import (`:3`) + `@Public()` en sus 10 rutas sin sesión |
| `app.module.ts` | 2 `APP_GUARD` — **último commit** (D-6) |
| `src/**/*.controller.ts` (45) | anotar las 250 rutas según el inventario |
| `orders/orders.controller.ts`, `refunds/refunds.controller.ts` | filtro de propiedad forzado (D-8) |
| `apps/README.md` | postura de seguridad y cómo probar con token |

### Out of Scope (vinculante)

Migrar `/api/users` a Postgres (US-25: aquí **solo** se protegen) · recuperación de contraseña y
OTP (US-24) · rate limiting · CORS · **cualquier** cambio en `apps/shop` o `apps/admin` ·
implementar escrituras que hoy son stubs del mock · borrar el controller `profiles` (D-9) ·
validación de firma de webhooks (D-7) · tests jest.
**Única excepción aprobada**: el filtro de propiedad de `orders`/`refunds` (D-8).

## CA-1 — Inventario de las 250 rutas

| Bucket | # | Grupos |
|---|---|---|
| **Pública** `@Public()` | **64** | 10 de `auth` sin sesión (`register`, `token`, `social-login-token`, `otp-login`, `send`/`verify-otp-code`, `forget`/`reset-password`, `verify-forget-password-token`, `contact-us`) · 22 lecturas de catálogo (`products` 2, `popular-`/`best-selling-`/`products-by-flash-sale`, `categories` 2, `types` 2, `tags` 2, `shops` 2, `near-by-shop`, `authors` 2, `top-authors`, `manufacturers` 2, `top-manufacturers`, `flash-sale` 2) · 15 de contenido/referencia (`settings` GET, `faqs` 2, `terms-and-conditions` 2, `refund-policies` 2, `refund-reasons` 2, `order-status` 2, `shippings` 2, `taxes` 2) · 6 de UGC de lectura (`reviews` 2, `questions` 2, `feedbacks` 2) · 4 de `coupons` (GET, GET `:param`, GET `:id/verify`, POST `verify`) · **2 de creación de pedido (`POST /orders`, `POST /orders/checkout/verify` — D-10)** · 2 `notify-logs` GET · 2 `became-seller` · 1 `subscribe-to-newsletter` |
| **Autenticada** (sin anotación) | **63** | 4 de `auth` (`me`, `change-password`, `add-points`, `logout`) · 31 de datos propios (`address` 5, `my-questions` 5, `my-wishlists` 5, `wishlists` 7, `my-reports`, `downloads` 2, `conversations` 3, `messages` 2, `attachments`) · 8 de pago propio (`cards` 5, `save-payment-method`, `set-default-card`, `payment-intent`) · 13 de escritura UGC (`reviews` 3, `questions` 3, `feedbacks` 3, `abusive_reports` POST, `notify-logs` PUT/PUT/DELETE) · 7 de lectura de pedidos/reembolsos propios (`orders` 4: GET lista, GET `:id`, GET `tracking-number/:id`, POST `/payment`; `refunds` 3) |
| **Con permiso** `@Permissions()` | **117** | 51 escrituras de catálogo y contenido · 15 de moderación/aprobación (`approve-`/`disapprove-*`, `new-shops`, `draft-products`, `products-stock`, `abusive_reports` 4) · 37 de administración (`shops` 3, `staffs` 5, `users` 8, los 5 `*/list`, `ownership-transfer` 5, `withdraws` 5, `store-notices` 6) · 14 de operación admin (`analytics` 4, `imports` 3, `ai`, `export-order-url`, `download-invoice-url`, `orders` PUT/DELETE, `refunds` PATCH/DELETE) |
| **Especial** | **6** | `web-hook` 3 (D-7) · `profiles` 3 (D-9) |
| **Total** | **250** | Superficie anónima efectiva en runtime: **67** (64 + los 3 `web-hook`) |

Los conjuntos de permisos son los **4 que ya existen** (`super_admin`, `store_owner`, `staff`,
`customer`), reusando las combinaciones de `auth-utils.ts:13-18`: `[super_admin]` (plataforma:
`users`, `*/list`, `analytics`, `imports`, `ai`, `settings` POST, taxonomía global, toda
aprobación) · `[super_admin, store_owner]` (tienda: `shops`, `staffs`, `ownership-transfer`,
`withdraws`, `store-notices`, facturas) · `[super_admin, store_owner, staff]` (catálogo de la
tienda y gestión de pedidos). La asignación fina ruta por ruta es trabajo de `sdd-design`.

### Las 10 clasificaciones cerradas por el usuario

| Grupo | Decisión | Razón |
|---|---|---|
| `GET /shippings`, `GET /taxes` | **pub** | Referencia sin PII; romperlas rompe el carrito anónimo |
| `GET /coupons`, `POST /coupons/verify` | **pub** | La lista ya se prefetchea anónima en `coupon.ssr.ts`; `verify` corre en el carrito de invitado |
| `GET /refund-reasons` | **pub** | Referencia de solo lectura, sin PII |
| `POST /became-seller` + su GET | **pub** | Solicitud de quien **aún no** es vendedor; `become-seller.ts` ya prefetchea el GET sin token |
| `POST /subscribe-to-newsletter` | **pub** | Opt-in de marketing anónimo estándar |
| `GET /feedbacks` | **pub** | Solo lectura, sin PII |
| `GET /notify-logs` | **pub** | Prefetch anónimo en `notify-logs.ssr.ts` (hallazgo de la exploración, no nombrado en la US) |
| `GET /payment-intent`, `GET /orders/tracking-number/:id` | **auth** | Exponen datos de pedido; un tracking number adivinable no es una credencial |
| `GET /orders`, `GET /refunds` | **auth + propiedad forzada** | Cierra el listado completo al anónimo (D-8) |
| `new-shops` | **perm** | Cola de aprobación del admin (`NEW_OR_INACTIVE_SHOPS`) |

**Cambio de postura deliberado, no un descuido**: exigir token en el lookup por tracking number
**se aparta del patrón histórico de Pickbazar**, que dejaba a un invitado consultar su pedido sin
sesión. Se elige a conciencia. El apartamiento se limita a la **lectura** de pedidos: crear uno
sigue siendo anónimo (D-10).

## Capabilities

### New Capabilities

- `api-authorization`: postura de autorización de la API REST — guard JWT global
  deny-by-default, `@Public()`, `@Permissions()` resuelto desde el token, semántica 401/403 y el
  inventario de las 250 rutas como contrato verificable.

### Modified Capabilities

- `auth-jwt-api`: `@CurrentUser()` cambia de ubicación y pasa a leer `request.user`; el
  requirement "Ningún guard se introduce en este cambio" no se elimina — se anota su alcance
  histórico (era US-22).

## Approach — decisiones

**D-1 — Guards a mano sobre el `JwtService` de US-22, sin Passport. Confirmo la recomendación de
la exploración.** `resolveJwtOptions()` (`jwt-options.ts:18-34`) y la extracción del bearer ya
están probadas por US-22. `@nestjs/passport` + `passport-jwt` sería una **segunda**
implementación de "verificar un JWT" en el mismo repo, en un paquete que instala fuera del
workspace (`yarn install` propio), y su valor —estrategias OAuth/local— está fuera de alcance
(D-11 del épico). Mismo criterio que la D-6 del épico (bcryptjs sobre bcrypt).

**D-2 — Dos `APP_GUARD` en orden: `JwtAuthGuard` → `PermissionsGuard`.** Nest los ejecuta en
orden de registro; el segundo confía en el `request.user` que pobló el primero. Ambos leen
`Reflector.getAllAndOverride(IS_PUBLIC_KEY, [handler, class])`. Sin `@Permissions()`, un token
válido basta.

**D-3 — `@CurrentUser()` se MUEVE a `auth/decorators/`, no se duplica.** Hay un solo import que
actualizar (`auth.controller.ts:3`); crear otro al lado sería exactamente la duplicación a
evitar. Pasa a leer `request.user` **conservando el fallback** de verificar el bearer por sí
mismo si está ausente: no es redundancia ociosa, es lo que hace que quitar los `APP_GUARD` sea un
rollback de una línea sin romper `/me`.

**D-4 — 401 vs 403 (D-4 del épico).** `JwtAuthGuard`: sin header, esquema no `Bearer`, firma
inválida o expirado → **401** con el mismo `INVALID_TOKEN_MESSAGE` que ya emite `@CurrentUser()`.
`PermissionsGuard`: token válido con intersección vacía → **403**. Nunca 403 por falta de token
ni 401 por falta de permiso.

**D-5 — Permisos solo del token, cero consultas a la base (D-5 del épico / CA-5).** Semántica
**any-of** idéntica a `hasAccess()` (`auth-utils.ts:54-64`), sobre el mismo array `permissions[]`
firmado. Comentario obligatorio en el guard: *revocar un permiso en la base no afecta a un token
ya emitido; el usuario lo conserva hasta que el JWT expira (`JWT_EXPIRES_IN`, 7 días)*.

**D-6 — Orden de trabajo = mitigación de R-1.** (1) inventario → (2) anotar las 250 rutas → (3)
**solo entonces** registrar los `APP_GUARD`, en el último commit. Al revés se rompe la tienda y
el diagnóstico se vuelve adivinanza entre 250 rutas.

**D-7 — `web-hook` (3 GET): `@Public()` con comentario de motivo.** Los llaman Stripe, Razorpay
y PayPal, sin JWT: dejarlos caer en el default sería un 401 silencioso a un tercero. No se añade
validación de firma (fuera de alcance; los servicios son stubs). Corrección de la exploración:
**no existe un controller `payment`** — la superficie de pago vive en `orders.controller.ts`,
`payment-intent.controller.ts` y `payment-method.controller.ts`.

**D-8 — Ampliación de alcance aprobada por el usuario.** El "NO incluye" dice que
`orders`/`refunds` "solo se protegen"; forzar el filtro de propiedad es algo más que proteger. El
usuario vio el trade-off y lo eligió: en `GET /orders` y `GET /refunds`, si el token **no** trae
permiso de nivel admin (`super_admin`, `store_owner`, `staff`), el controller sobreescribe
`customer_id` con el `sub`. Motivo: `customer_id` es opcional (`GetOrdersDto:14`) y hoy cualquiera
lista los pedidos de cualquiera. **Efecto real, sin adornos**: `OrdersService.getOrders`
(`:118-142`) **ignora** `customer_id` (solo filtra por `shop_id`) y `RefundsService.findAll`
(`:11-15`) devuelve `{data: []}` — el beneficio inmediato es que la ruta deja de ser anónima; el
filtro queda cableado en el borde para cuando US-25 haga real el servicio. **No se extiende a
ninguna otra ruta.**

**D-9 — El controller `profiles` (3 rutas) se deja sin anotar a propósito.** Son stubs muertos
(`console.log`, no llaman al service): caen en el deny-by-default y devuelven 401. Se documentan
como código muerto; **borrarlos excedería el alcance de la US**.

**D-10 — `POST /orders` y `POST /orders/checkout/verify` son PÚBLICAS (decisión del usuario,
2026-09-02).** El resto de `orders` queda como se clasificó (`auth`/`perm`), incluidos el lookup
por tracking number y los listados. **Razón**: crear tu propio pedido no expone datos de terceros.
Lo que motiva la postura "los datos de pedido exigen token" es impedir que un extraño **lea**
pedidos ajenos, y eso lo siguen cubriendo el lookup y los listados cerrados; cerrar además la
creación no añadía seguridad y sí rompía un flujo vivo. **El flujo está vivo, verificado**:
`guestCheckout: true` en `apps/api/rest/src/db/pickbazar/settings.json:113` y en `db/seed.sql:23`
· `apps/shop/src/components/auth/login-form.tsx:121` ofrece "continuar como invitado" en el
checkout cuando el flag está activo · `apps/shop/src/config/routes.ts:5` enruta a
`/checkout/guest` · `apps/shop/src/pages/checkout/guest.tsx:48-58` se auto-redirige si el flag se
apaga. Se descartó explícitamente apagar el flag: **no se toca `db/seed.sql` ni ningún archivo de
`apps/shop`**.

## Risks

| Riesgo | Sev. | Mitigación |
|---|---|---|
| **R-1 (épico)**: activar el guard global antes de anotar todas las públicas rompe el SSR de la tienda entera | **Alta** | D-6 (orden vinculante) + `just verify` contando product-cards + navegación anónima manual: CA-3 no se cierra con `curl` |
| **R-2 — aceptado y declarado (ya no es una pregunta)**: por D-10, `POST /orders` público permite crear pedidos anónimos, un vector de spam. El rate limiting —su mitigación natural— está **fuera de alcance por el propio "NO incluye" de la US** | Baja | Aceptado. Verificado que `OrdersService.create` (`:70-115`) **no persiste**: muta `this.orders[0]` en memoria y lo devuelve — nada llega a Postgres y el reinicio lo limpia. Dos efectos reales, menores y declarados: esa mutación es compartida por todos hasta reiniciar, y con gateway `stripe`/`paypal`/`razorpay` dispara `processPaymentIntent`. Se documenta en `apps/README.md` para que el épico que traiga rate limiting lo herede como requisito conocido |
| **R-3**: presentar D-8 como un IDOR cerrado sería falso (el servicio mock ignora el filtro) | Media | Redactado en D-8; `sdd-verify` no debe aceptar evidencia que afirme lo contrario |
| **R-4**: 250 anotaciones a mano en 45 archivos; olvidar una pública es un 401 silencioso que `just verify` no detecta (solo cuenta product-cards del home) | Media | El inventario es el checklist; barrido final con el mismo parser que midió las 250 |
| **R-5**: el diff supera holgadamente el presupuesto de 400 líneas de revisión | Media | `sdd-tasks` debe forecastear y proponer PRs encadenados (`ask-on-risk`); corte natural: guards+decoradores / anotaciones / activación |
| **R-6**: los 3 `web-hook` quedan abiertos sin verificación de firma | Baja | Declarado en D-7 y documentado en `apps/README.md`; los servicios son stubs |

## Rollback Plan

1. **Emergencia (una línea)**: quitar los dos `APP_GUARD` de `app.module.ts` + `just build-api`.
   La API vuelve a estar abierta y las 250 anotaciones quedan **inertes** — `@Public()` y
   `@Permissions()` son `SetMetadata` puro, sin efecto sin guard. El fallback de D-3 mantiene
   `/me`, `change-password` y `add-points` como en US-22.
2. **Parcial**: si una ruta pública quedó sin anotar, añadirle `@Public()`; nada más que revertir.
3. **Completo**: `git revert` del rango de la US (o `git checkout apps/api/rest/src
   apps/README.md`) + `just build-api`.
4. **Datos**: ninguno. No se toca Postgres, `db/schema.sql`, `packages/db`, ni se emiten tokens:
   no hay nada que `git` no deshaga.

## Dependencies

US-22 mergeada (`@nestjs/jwt`, `resolveJwtOptions()`, `permissions[]` en el payload) ·
`just db-up` con la base sembrada · `just db-build` si `packages/db/dist/` no existe · tokens de
los 3 usuarios sembrados (`demodemo`) para los 4 casos de `curl`.

## Success Criteria (1:1 con la DoD)

- [ ] **CA-1** Inventario pegado con los 4 buckets sumando **250**.
- [ ] **CA-2** `curl` de los 4 casos: pública sin token → **200**; protegida sin token → **401**;
      protegida con token de `customer@demo.com` → **403**; con token de `admin@demo.com` → **200**.
- [ ] **CA-3** `just verify` verde con la salida pegada (product-cards) **y** navegación anónima
      en el navegador: home, listado, detalle, búsqueda y categoría.
- [ ] **CA-4** `GET /api/users` y un `*/list` con token de `customer` → 403, no 200.
- [ ] **CA-5** Comentario del coste de D-5 presente en `permissions.guard.ts`; ninguna llamada a
      `@safari/db` ni a Prisma en los dos guards (`grep` pegado).
- [ ] **CA-6** `just build-api` limpio y comparación byte a byte de `/api/settings` antes/después
      (precedente: **5503 bytes**).
- [ ] `apps/README.md` actualizado · status de US-23 y fila del épico marcadas.
