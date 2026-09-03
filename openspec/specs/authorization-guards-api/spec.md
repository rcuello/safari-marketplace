# Authorization Guards Api Specification

## Purpose

Ninguna de las 250 rutas de la API exige hoy el JWT del lado del servidor:
la autorización vive solo en el cliente (`hasAccess()`), y un `curl` la
ignora. Esta capability instala el guard deny-by-default sobre el JWT de
`auth-jwt-api` (US-22): ruta sin `@Public()` exige token válido, ruta con
`@Permissions()` exige uno de los permisos declarados, resuelto del payload.

## Requirements

### Requirement: Guard global deny-by-default, permisos resueltos solo del token

El sistema MUST registrar un guard `CanActivate` global (`Reflector.
getAllAndOverride`, handler y clase). Ruta sin `@Public()` MUST exigir
bearer token válido; ausencia, esquema distinto de `Bearer`, firma inválida
o expiración MUST devolver `401`. El sistema MUST devolver `403` solo si el
token es válido pero la intersección entre `permissions[]` y lo exigido por
`@Permissions()` está vacía — MUST NOT devolver `403` por falta de token,
ni `401` por falta de permiso con token válido. La comparación MUST leer
solo `request.user.permissions` (semántica **any-of** de `hasAccess()`,
`apps/admin/rest/src/utils/auth-utils.ts:54-64`), MUST NOT consultar
`@safari/db` ni Prisma, y el
guard MUST llevar un comentario declarando el coste: revocar un permiso en
la base no afecta a un token ya emitido hasta que expire
(`JWT_EXPIRES_IN`).

#### Scenario: Ruta protegida sin token

- GIVEN una ruta sin `@Public()` (p. ej. `GET /api/users`)
- WHEN se hace la petición sin cabecera `Authorization`
- THEN la respuesta es `401`

#### Scenario: Token válido, permiso insuficiente

- GIVEN un token con permiso `customer`
- WHEN se hace `GET /api/users` (exige `super_admin`) con ese token
- THEN la respuesta es `403`, no `401`

#### Scenario: La verificación de permiso no toca la base

- GIVEN cualquier ruta con `@Permissions()`
- WHEN se audita el guard con `grep` sobre imports y llamadas
- THEN no hay referencia a `@safari/db` ni a Prisma, y el comentario del coste está presente

### Requirement: Las 250 rutas se clasifican en cuatro buckets verificables

El sistema MUST clasificar las 250 rutas en exactamente cuatro buckets, y
su suma MUST ser 250:

| Bucket | Anotación | # |
|---|---|---|
| Pública | `@Public()` | 64 |
| Autenticada | ninguna (token válido basta) | 63 |
| Con permiso | `@Permissions(...)` | 117 |
| Especial | `web-hook` público + `profiles` sin anotar | 6 |

Los permisos usados MUST ser únicamente los 4 existentes: `super_admin`,
`store_owner`, `staff`, `customer`. Dentro de "Especial": las 3 GET de
`web-hook` (Stripe, Razorpay, PayPal) MUST llevar `@Public()` con comentario
sobre la llamada de terceros sin JWT (firma fuera de alcance, D-7); las 3
`profiles` (stubs muertos) MUST quedar sin anotar, cayendo en el
deny-by-default sin que el sistema elimine el controller.

#### Scenario: El inventario cuadra con las rutas medidas

- GIVEN el parser que cuenta decoradores HTTP por `@Controller`
- WHEN se suman las anotaciones de los cuatro buckets
- THEN el total es 250, igual al conteo estructural independiente

#### Scenario: Un webhook responde sin token, profiles no

- WHEN `GET /api/web-hook/stripe` y `POST /api/profiles` se llaman sin `Authorization`
- THEN el webhook no es `401` y `profiles` sí lo es, por ausencia de anotación

### Requirement: El catálogo y el contenido de referencia permanecen públicos

Las 64 rutas "Pública" (catálogo, contenido de referencia, UGC de lectura,
`coupons`, `notify-logs` GET) MUST permanecer `@Public()`. Un visitante sin
sesión MUST navegar home, listado, detalle, búsqueda y categoría sin `401`.

#### Scenario: Navegación anónima completa

- GIVEN ninguna sesión iniciada
- WHEN se consultan `settings`, `products`, `types` y `categories`
- THEN todas responden `200` con contenido, y `just verify` sigue contando product-cards reales

### Requirement: Orders/refunds — invitado en la creación, propiedad forzada en el listado

`POST /api/orders` y `POST /api/orders/checkout/verify` MUST llevar
`@Public()` (D-10: el checkout de invitado, `guestCheckout: true`, es un
flujo vivo del shop); el resto de `orders` permanece autenticado/con-permiso.
En `GET /api/orders` y `GET /api/refunds`, sin permiso de nivel admin
(`super_admin`, `store_owner`, `staff`) el sistema MUST sobreescribir
`customer_id` con el `sub` del token, ignorando el de la query; con permiso
admin, el `customer_id` de la query MUST respetarse. Este requirement fija
el comportamiento en el borde de la ruta — NO afirma aislamiento de datos
de punta a punta: `OrdersService.getOrders` ignora hoy `customer_id` y
`RefundsService.findAll` devuelve `{data: []}` sin filtrar; queda cableado
para cuando US-25 conecte el servicio real.

#### Scenario: Crear un pedido sin sesión no se rechaza

- GIVEN ninguna sesión iniciada
- WHEN se hace `POST /api/orders`
- THEN la respuesta no es `401` por ausencia de token

#### Scenario: Un customer no puede pedir los pedidos de otro por query

- GIVEN un token `customer` con `sub` distinto de `999`
- WHEN se hace `GET /api/orders?customer_id=999`
- THEN el `customer_id` efectivo es el `sub` del token, no `999`

#### Scenario: Un admin conserva el customer_id que pida

- GIVEN un token `super_admin`
- WHEN se hace `GET /api/orders?customer_id=999`
- THEN el `customer_id` efectivo es `999`, sin sobreescritura

### Requirement: Las rutas de administración exigen el permiso equivalente

Las 117 rutas "Con permiso" (`/api/users`, todo `*/list`, escrituras de
catálogo/tiendas/cupones/taxes, moderación) MUST llevar `@Permissions()`
con el conjunto correspondiente (`[super_admin]`, `[super_admin,
store_owner]` o `[super_admin, store_owner, staff]`, `auth-utils.ts:13-18`).
Un token con únicamente `customer` MUST recibir `403`, nunca `200`.

#### Scenario: customer no lista usuarios, admin sí escribe

- GIVEN un token `customer` y otro `super_admin`
- WHEN el primero hace `GET /api/users` o `*/list`, y el segundo escribe sobre el catálogo
- THEN el primero recibe `403` y el segundo no es rechazado por autorización

### Requirement: El guard se activa sin regresión de contrato

`just build-api` MUST compilar limpio tras registrar los `APP_GUARD`.
`GET /api/settings` MUST responder el mismo cuerpo, byte a byte, antes y
después del guard (precedente: 5503 bytes). `just verify` MUST seguir
verde, contando product-cards reales en los 3 frontends.

#### Scenario: /api/settings no cambia de tamaño y verify queda verde

- GIVEN el guard global activo
- WHEN se compara `GET /api/settings` contra 5503 bytes, y corren `just build-api` y `just verify`
- THEN el tamaño es idéntico y ambos terminan sin error
