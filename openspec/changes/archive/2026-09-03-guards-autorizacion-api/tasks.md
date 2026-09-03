# Tasks: Autorización — guard global y permisos por ruta (US-23)

> Nota de entrega: este repo no usa PRs (commits directos a `main`, ver `git log`).
> Los 3 "PR" del `design.md` se ejecutan aquí como **3 batches ordenados** (commits
> secuenciales), no como pull requests. El orden Batch 1 → 2 → 3 es una secuencia
> DURA (R-1): activar `APP_GUARD` antes de que el auditor cierre limpio es un
> defecto del plan, no una variante válida.

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~560 total — Batch 1 ~260, Batch 2 ~210, Batch 3 ~90 |
| 400-line budget risk | High como entrega única; Low por batch individual |
| Chained PRs recommended | Yes (aquí: 3 batches de commits directos a `main`, sin PR) |
| Suggested split | Batch 1 → Batch 2 → Batch 3, en ese orden, cada uno verificado antes del siguiente |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main (adaptado: sin PR/branch, cada batch es un commit directo a `main`, en orden) |

```text
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
```

### Suggested Work Units

| Batch | Goal | ~Líneas | ¿Cambia comportamiento? | Cierra con |
|---|---|---|---|---|
| 1 | Guards + decoradores + `route-audit.mjs`, nada registrado | ~260 | No | `grep -rn "APP_GUARD" apps/api/rest/src` → 0; `just build-api` limpio |
| 2 | 250 rutas anotadas en 45 controllers | ~210 | No | `route-audit.mjs --check` limpio; `grep APP_GUARD` sigue en 0 |
| 3 | 2 `APP_GUARD`, export de `JwtModule`, filtro D-8, `apps/README.md` | ~90 | Sí — único batch observable | DoD completa (Phase 4) |

## Phase 1: Batch 1 — Infraestructura inerte

- [x] 1.1 Crear `auth/decorators/public.decorator.ts` (`IS_PUBLIC_KEY`, `@Public()`) y `auth/decorators/permissions.decorator.ts` (`PERMISSIONS_KEY`, `@Permissions()`, sets `ADMIN_ONLY`/`ADMIN_AND_OWNER`/`ADMIN_OWNER_AND_STAFF`).
- [x] 1.2 Mover `auth/current-user.decorator.ts` → `auth/decorators/current-user.decorator.ts` (D-3): lee `request.user`, conserva el fallback que verifica el bearer si no hay guard; exporta `AuthenticatedRequest`.
- [x] 1.3 Actualizar el único importador, `auth.controller.ts:3` (3 usos), a la nueva ruta.
- [x] 1.4 Crear `auth/guards/jwt-auth.guard.ts`: `Reflector.getAllAndOverride(IS_PUBLIC_KEY, [handler, class])`; sin `@Public()`, verifica bearer y puebla `request.user`; 401 en ausencia/esquema inválido/firma inválida/expirado.
- [x] 1.5 Crear `auth/guards/permissions.guard.ts`: any-of sobre `request.user.permissions`; 403 si intersección vacía; 401 (no 403) si `request.user` está ausente (regla anti-fuga D). Docblock inmediatamente encima de `export class PermissionsGuard` con el coste CA-5 (revocar un permiso no afecta a un token ya emitido hasta que expira `JWT_EXPIRES_IN`).
- [x] 1.6 Crear `apps/api/rest/scripts/route-audit.mjs`: parser por bloque `@Controller`, modo tabla y `--check` contra `EXPECTED_PUBLIC` (67 rutas).
- [x] 1.7 Verificar Batch 1 inerte: `grep -rn "APP_GUARD" apps/api/rest/src` → 0 resultados; `just build-api` limpio; `node scripts/route-audit.mjs` corre y reporta 250 rutas totales, 0 anotadas.

## Phase 2: Batch 2 — Anotación de las 250 rutas (45 controllers)

Grupos por el inventario CA-1 (`proposal.md`); clase donde el controller es homogéneo, handler donde es mixto.

- [x] 2.1 `@Public()` en las 10 rutas de `auth.controller.ts` sin sesión (register, token, social-login-token, otp-login, send/verify-otp-code, forget/reset-password, verify-forget-password-token, contact-us).
- [x] 2.2 `@Public()` en las 22 rutas de catálogo de lectura (products, categories, types, tags, shops, near-by-shop, authors, manufacturers, flash-sale).
- [x] 2.3 `@Public()` en las 15 rutas de contenido/referencia (settings GET, faqs, terms-and-conditions, refund-policies, refund-reasons, order-status, shippings, taxes).
- [x] 2.4 `@Public()` en las 6 rutas GET de UGC (reviews, questions, feedbacks) y las 4 de `coupons`.
- [x] 2.5 `@Public()` en `POST /orders` y `POST /orders/checkout/verify` (D-10) con comentario del motivo (`guestCheckout: true`).
- [x] 2.6 `@Public()` en notify-logs GET (2), became-seller (2), subscribe-to-newsletter (1).
- [x] 2.7 `@Public()` a nivel de clase en las 3 rutas GET de `web-hook.controller.ts` (D-7), con comentario: llamadas de terceros (Stripe/Razorpay/PayPal) sin JWT, sin validación de firma (fuera de alcance).
- [x] 2.8 `@Permissions(...ADMIN_ONLY)` en los controllers homogéneos de plataforma (`UsersController`, `*/list`, `AnalyticsController`, `ImportsController`, `AiController`, taxonomía global, toda aprobación).
- [x] 2.9 `@Permissions(...ADMIN_AND_OWNER)` en controllers de tienda (`StaffsController`, `ShopsController` (escrituras), `OwnershipTransferController`, `WithdrawsController`, `StoreNoticesController`, facturas).
- [x] 2.10 `@Permissions(...ADMIN_OWNER_AND_STAFF)` por handler en escrituras de catálogo/tienda mixtas (`ProductsController` y similares: GET público, escritura con permiso) y gestión de pedidos admin (`orders` PUT/DELETE, `refunds` PATCH/DELETE).
- [x] 2.11 Verificar que `profiles.controller.ts` (3 rutas) queda sin anotar (D-9, stub muerto) — no tocar.
- [x] 2.12 Verificar que las 63 rutas "autenticada" (datos propios, pago propio, escritura UGC, lectura de `orders`/`refunds` propios) quedan sin decorador — default deny-by-default.
- [x] 2.13 Correr `node scripts/route-audit.mjs --check`; exit 0 y tabla `total=250 public=67 perm=117 auth=63 esp=3` pegadas como evidencia de CA-1.
- [x] 2.14 Verificar Batch 2 sigue inerte: `just build-api` limpio; `grep -rn "APP_GUARD" apps/api/rest/src` sigue en 0.

## Phase 3: Batch 3 — Activación (GATE: solo tras 2.13 limpio)

- [x] 3.1 `auth/auth.module.ts`: cambiar `exports: [AuthService]` → `exports: [AuthService, JwtModule]` (Decisión A — sin esto, `AppModule` no resuelve `JwtService` de `JwtAuthGuard` y la API no arranca).
- [x] 3.2 `app.module.ts`: registrar `{ provide: APP_GUARD, useClass: JwtAuthGuard }` y `{ provide: APP_GUARD, useClass: PermissionsGuard }`, en ese orden, con comentario sobre el corto-circuito de Nest. Depende de 3.1 (mismo commit o inmediatamente antes).
- [x] 3.3 `orders.controller.ts`, `GET /orders`: agregar `@CurrentUser()`, calcular `isAdminLevel` con `ADMIN_OWNER_AND_STAFF`, sobreescribir `customer_id` con `user.sub` si no es admin (D-8).
- [x] 3.4 `refunds.controller.ts`: dejar autenticada (sin `@Public()`); agregar comentario de una línea: filtro de propiedad no cableable hoy (`findAll()` no recibe `@Query()`, el servicio no acepta argumentos) — queda para US-25.
- [x] 3.5 Actualizar `apps/README.md`: postura de seguridad, cómo probar con token, caveats R-2 (checkout invitado)/R-6 (webhooks sin firma), `/docs` sigue abierto (Decisión I), uso de `route-audit.mjs`.

## Phase 4: Verificación (evidencia real pegada, obligatoria — `require_evidence: true`)

- [x] 4.1 Pegar salida final de `node scripts/route-audit.mjs --check` post-activación (CA-1).
- [x] 4.2 `curl -i` caso 1: `GET /api/settings` sin token → `200` (pública).
- [x] 4.3 `curl -i` caso 2: `GET /api/users` sin `Authorization` → `401` (protegida sin token).
- [x] 4.4 `curl -i` caso 3: `GET /api/users` con token `customer@demo.com`/`demodemo` → `403` (permiso insuficiente).
- [x] 4.5 `curl -i` caso 4: `GET /api/users` con token `admin@demo.com`/`demodemo` → `200` (permiso correcto).
- [x] 4.6 CA-4 extra: un `*/list` (`GET /api/admin/list` — `/api/products/list` no existe como ruta, `products` usa slug) con token `customer` → `403`, pegado.
- [x] 4.7 `grep -n "@safari/db\|@prisma/client\|prisma" apps/api/rest/src/auth/guards/*.ts` → 0 resultados; confirmar docblock de coste presente en `permissions.guard.ts` (CA-5).
- [x] 4.8 `just verify` verde, salida con conteo de product-cards pegada (CA-3, parcial).
- [x] 4.9 Navegación anónima manual en navegador real: home, listado, detalle de producto, búsqueda, categoría — sin `401`. Cerrada por el orquestador (herramienta de navegador). Ver §CA-3 en `apply-progress.md` y `evidence-anon-storefront.png`.
- [x] 4.10 `just build-api` limpio, salida pegada (CA-6).
- [x] 4.11 Comparación byte a byte: antes/después de activar guard, contra precedente **5503**. Doble caveat: (a) el conteo NO detecta la divergencia ya embarcada `created_at`/`updated_at` (documentada en `CLAUDE.md`); (b) medido en bytes exactos (`Buffer.length`) da **5504**, no 5503 — `just verify` reporta 5503 porque su recipe mide `body.length` de un string acumulado por concatenación de chunks (cuenta unidades UTF-16, no bytes: `©` de "Copyright © REDQ." pesa 2 bytes UTF-8 pero 1 unidad UTF-16). Confirmado que el guard no introduce el desfase: con `APP_GUARD` comentado un momento en el mismo proceso, el conteo de bytes exacto siguió en 5504.
- [x] 4.12 `curl` a `POST /orders` (D-10) al FINAL, después de 4.8, porque muta estado en memoria compartido (`this.orders[0]`) y contamina el resto de las pruebas de `orders`.
- [x] 4.13 Declarar caveat: `/docs` (Swagger UI + JSON) sigue abierto tras la activación — `SwaggerModule` registra handlers en el adaptador HTTP fuera del pipeline de controllers (Decisión I) — no es defecto, fuera de alcance. Verificado: `GET /docs` y `GET /docs-json` → `200` sin token.
- [x] 4.14 Actualizar status de US-23 y la fila del épico en `docs/product/19-autenticacion-autorizacion/`.
