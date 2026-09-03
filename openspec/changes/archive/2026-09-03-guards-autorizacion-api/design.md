# Design: Autorización — guard global y permisos por ruta

> US-23, Épico 19. Insumos: `proposal.md` (D-1..D-10 **cerradas**; las 10 clasificaciones ambiguas
> y R-2 los cerró el dueño del repo — no se reabren), `explore.md` (inventario autoritativo de 250
> rutas) y `specs/auth-jwt-api/spec.md` (contrato JWT de US-22). Formato:
> `archive/2026-09-02-login-jwt-postgres/design.md`. Todo `path:line` se leyó en esta sesión; las
> tres apuestas de framework (orden de guards globales, inyección en `AppModule`, Swagger fuera del
> pipeline) se **verificaron contra el código instalado**.

## Technical Approach

Tres bloques, en este orden vinculante (D-6):

1. **Infraestructura inerte** — `auth/decorators/{public,permissions,current-user}.decorator.ts`
   (el tercero **movido**), `auth/guards/{jwt-auth,permissions}.guard.ts` y
   `scripts/route-audit.mjs`. Nada de esto altera una sola respuesta HTTP: sin `APP_GUARD`
   registrado, `SetMetadata` es metadata muerta y las clases `CanActivate` no las instancia nadie.
2. **Anotación de las 250 rutas** en 45 `*.controller.ts`: `@Permissions()` a **nivel de clase**
   donde el controlador es homogéneo, por handler donde es mixto. Sigue inerte.
3. **Activación** — dos `APP_GUARD` en `app.module.ts`, `JwtModule` exportado desde
   `auth.module.ts`, el filtro de D-8 y `apps/README.md`. Único bloque que cambia comportamiento
   observable, y el que se revierte en una línea.

El orden no es estilístico: invertirlo es R-1 (guard activo con públicas sin anotar → SSR de la
tienda en 401 y diagnóstico a ciegas entre 250 rutas).

## Architecture Decisions

### Decisión A: dos `APP_GUARD` en orden, y la dependencia que Nest no resuelve sola

**Choice**: en `app.module.ts`, `providers` pasa de `[]` a:

```ts
providers: [
  // El ORDEN importa: Nest ejecuta los guards globales secuencialmente y corta en el
  // primero que devuelve false. JwtAuthGuard debe poblar `request.user` ANTES de que
  // PermissionsGuard lo lea. Invertirlos produce 403 (o 401) para todos.
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: PermissionsGuard },
],
```

**Verificación (no supuesto)**: `scanner.js:327` empuja cada `APP_GUARD` a `addGlobalGuard` en el
orden de los providers (`application-config.js:66-68`, `push`); `context-creator.js:6-16` concatena
`[...globales, ...clase, ...handler]`; `guards-consumer.js:8-21` itera con `for...of`, hace `await`
de cada `canActivate` y **retorna en el primer `false`**. Orden de registro = orden de ejecución,
con corto-circuito.

**Dependencia que hay que cablear**: `JwtAuthGuard` inyecta `JwtService` y los `APP_GUARD` se
instancian en el contexto de **`AppModule`**, pero hoy `JwtModule` solo lo importa `AuthModule`
(`auth.module.ts:13`) y **no lo exporta** (`:16`). Sin cambiar eso el arranque muere con *"Nest
can't resolve dependencies of JwtAuthGuard (?, Reflector)"*. Por eso `auth.module.ts` pasa a
`exports: [AuthService, JwtModule]`: `AppModule` ya importa `AuthModule` (`app.module.ts:73`).

**Alternatives considered**:

| Opción | Por qué no |
|---|---|
| `APP_GUARD` dentro de `AuthModule` (evita tocar `app.module.ts`) | Funciona, pero rompe el rollback de una línea: D-6 fija `app.module.ts` como el interruptor único, y ahí lo busca un humano en apuros |
| Guards con `new JwtService(resolveJwtOptions())` a mano, como el decorador | Es la excepción de la Decisión C de US-22, forzada porque `createParamDecorator` **no pasa por DI**. Los guards sí pasan: repetir el workaround donde no hace falta es copiar una limitación |
| `PermissionsGuard` local por ruta (`@UseGuards`) | 117 `@UseGuards` extra, y una ruta con `@Permissions()` y sin `@UseGuards` fallaría **abierta**. Global + metadata ausente = "cualquier autenticado basta" falla cerrada |

**Rationale**: dos guards con una responsabilidad cada uno (¿quién eres? / ¿puedes?) reproducen la
separación 401/403 de D-4 en la estructura del código, y el segundo depende del primero por un solo
campo: `request.user`.

### Decisión B: metadata, claves y resolución por `Reflector`

Dos claves de módulo, exportadas junto a su decorador para que no exista un string suelto:

```ts
// auth/decorators/public.decorator.ts
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

// auth/decorators/permissions.decorator.ts
export const PERMISSIONS_KEY = 'permissions';
export const Permissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

// Mismas combinaciones que hasAccess() ya compara en el admin
// (apps/admin/rest/src/utils/auth-utils.ts:13-18). No se inventan roles: son los 4 de la base.
export const ADMIN_ONLY = ['super_admin'];
export const ADMIN_AND_OWNER = ['super_admin', 'store_owner'];
export const ADMIN_OWNER_AND_STAFF = ['super_admin', 'store_owner', 'staff'];
```

Ambos guards resuelven con `getAllAndOverride(KEY, [ctx.getHandler(), ctx.getClass()])`:
**handler primero, clase después** — el handler gana. Eso habilita la estrategia que reduce el diff
de la fase 2: `@Permissions(...ADMIN_ONLY)` **a nivel de clase** en los controladores homogéneos
(`UsersController` 8 rutas, `StaffsController` 5, `AnalyticsController`, `ImportsController`,
`AiController`, `WithdrawsController`…) y anotación por handler donde el controlador es mixto
(`ProductsController`: GET público, escrituras con permiso). `@Public()` va **siempre a nivel de
handler** salvo en los controladores 100% públicos (`NearByShopController`, `WebHookController`…):
una clase marcada pública por error abre todos sus verbos de golpe.

Los tres sets viven en `permissions.decorator.ts` y no en un archivo propio: hay un solo importador
natural y `auth/permission-sets.ts` sería estructura sin segunda ocurrencia que la justifique.

### Decisión C: `@CurrentUser()` se mueve y conserva su fallback — es lo que hace posible el rollback

**Choice**: el archivo pasa de `auth/` a `auth/decorators/` (D-3: **movido**, no duplicado; un solo
import que actualizar, `auth.controller.ts:3`, 3 usos). Su factory pasa a:

```ts
const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
if (request.user) return request.user;     // camino normal: lo pobló JwtAuthGuard
// Fallback deliberado (D-3): si los APP_GUARD no están registrados —rollback de
// emergencia— este decorador verifica el bearer por su cuenta, y /me,
// change-password y add-points siguen comportándose como en US-22.
const token = extractBearerToken(request); // sin cambios respecto de :37-43
if (!token) throw new UnauthorizedException(INVALID_TOKEN_MESSAGE);
try { return getJwtService().verify<CurrentUserPayload>(token); }
catch { throw new UnauthorizedException(INVALID_TOKEN_MESSAGE); }
```

**Alternatives considered**: reducirlo a `return request.user` (más limpio, pero convierte el
rollback de "quitar 2 providers" en "quitar 2 providers y además restaurar el decorador" —
precisamente el escenario en el que nadie quiere pensar) · dejarlo en `auth/` y crear otro en
`decorators/` (la duplicación que D-3 rechaza) · re-verificar **siempre** (dos `verify` por request
en las 3 rutas que lo usan, sin ganar nada).

El `JwtService` perezoso de `:28-35`, `extractBearerToken` (`:37-43`), `INVALID_TOKEN_MESSAGE`
(`:10`) y `CurrentUserPayload` (`:12-18`) **no cambian**: el diff es la ruta del archivo, el
`if (request.user)` y el comentario de cabecera, que pasa de decir "la protección de rutas es
US-23" a describir el contrato con el guard.

`AuthenticatedRequest` (`Request & { user?: CurrentUserPayload }`) se exporta desde ese mismo
archivo y lo consumen los dos guards y `orders.controller.ts`.

### Decisión D: dónde nace cada código, y por qué un 403 nunca llega a un anónimo

| Situación | Guard | Respuesta | Cuerpo en el cable |
|---|---|---|---|
| Ruta `@Public()` | `JwtAuthGuard` → `true` inmediato, sin mirar el header | 200 | sin cambios |
| Sin header `Authorization` | `JwtAuthGuard` | **401** | `{"statusCode":401,"message":"Token de autenticación ausente o inválido.","error":"Unauthorized"}` |
| Esquema distinto de `Bearer`, token vacío, firma inválida, expirado, malformado | `JwtAuthGuard` | **401** | idéntico byte a byte al anterior |
| Token válido, ruta sin `@Permissions()` | ambos → `true` | 200 | — |
| Token válido, `@Permissions()` con intersección vacía | `PermissionsGuard` | **403** | `{"statusCode":403,"message":"No tienes permisos suficientes para esta operación.","error":"Forbidden"}` |
| `@Permissions()` presente y `request.user` ausente | `PermissionsGuard` | **401** (no 403) | mismo cuerpo que el 401 de arriba |

La última fila es la regla anti-fuga: `PermissionsGuard` **nunca** deduce "no autorizado" de la
ausencia de usuario. Si `request.user` no está —guards mal ordenados, alguien registró solo el
segundo, un `@Public()` combinado con `@Permissions()`— responde 401. Un 403 le confirmaría a un
anónimo que la ruta existe y es privilegiada; el 401 no dice nada que el default no diga ya.
Reutiliza `INVALID_TOKEN_MESSAGE`: no hay un segundo texto de 401 en el repo. El 403 usa
`ForbiddenException(INSUFFICIENT_PERMISSIONS_MESSAGE)`, constante nueva de `permissions.guard.ts`
(único uso). Sin filtro de excepciones propio, ambos cuerpos salen del `createBody` de
`@nestjs/common`, en español como el precedente de US-22.

Consecuencia heredada de US-22 (V-19): ambos frontends tratan *cualquier* 401 como sesión caducada
— el admin borra la cookie y hace `Router.reload()`, la tienda `Router.replace(Routes.home)`. Con
el guard activo hay más 401 posibles que antes; no se toca ningún frontend.

### Decisión E: cero consultas a la base, y dónde va el comentario que exige CA-5

`PermissionsGuard` lee `request.user.permissions` —el array que US-22 firma en el token
(`auth.service.ts:157-161`)— con la **misma semántica any-of** de `hasAccess()`
(`auth-utils.ts:54-64`): `required.some(p => user.permissions.includes(p))`. Ni `@safari/db` ni
Prisma aparecen en los imports de los dos guards (CA-5 se verifica con un `grep` pegado).

El comentario obligatorio va como **docblock inmediatamente encima de `export class
PermissionsGuard`** en `apps/api/rest/src/auth/guards/permissions.guard.ts` — no dentro del
método, no en el decorador: es una propiedad de la clase entera y ahí lo encuentra quien abre el
archivo. Texto:

```ts
/**
 * Resuelve los permisos EXCLUSIVAMENTE desde el payload del JWT (D-5 del épico,
 * CA-5): cero consultas a la base por request.
 *
 * COSTE ACEPTADO: revocar un permiso en Postgres NO afecta a un token ya emitido.
 * El usuario conserva ese permiso hasta que el JWT expira (`JWT_EXPIRES_IN`, 7 días
 * por defecto — jwt-options.ts:31). Revocación inmediata exigiría una denylist con
 * estado en el servidor, que D-9 de US-22 descartó explícitamente.
 */
```

### Decisión F: el procedimiento de anotación y el auditor que se corre ANTES de activar

Mitigar R-1 y R-4 no puede ser "revisar con cuidado": son 250 rutas en 45 archivos y una pública
olvidada es un 401 silencioso que `just verify` no detecta (solo cuenta product-cards del home).

1. **Anotar primero todas las `@Public()`** (64 + los 3 `web-hook` de D-7 = 67 anónimas efectivas),
   controlador por controlador, en el orden de la tabla CA-1 del proposal.
2. **Después las 117 `@Permissions()`** (clase donde sea homogéneo, handler donde sea mixto).
3. **Las 63 autenticadas y las 3 de `profiles` no se tocan**: son el default.
4. **Correr el auditor y exigir salida limpia.** Solo entonces se activa el guard.

`apps/api/rest/scripts/route-audit.mjs` (Node puro — `jq` no está instalado en esta máquina) reusa
el parser que midió las 250: agrupa por bloque `@Controller(prefix) export class X` (soporta varios
por archivo: `shops.controller.ts` declara 7), enumera `@Get/@Post/@Put/@Patch/@Delete` y resuelve
la clasificación **efectiva** de cada ruta mirando los decoradores del handler y luego los de la
clase.

```
node scripts/route-audit.mjs            # tabla METODO /ruta | archivo:linea | public|perm(...)|auth
node scripts/route-audit.mjs --check    # exit 1 si hay diferencia con EXPECTED_PUBLIC
```

`EXPECTED_PUBLIC` es una constante del script: las 67 rutas anónimas del inventario, como strings
`GET /products`. El `--check` diffea **en las dos direcciones** y sale con código 1 en cualquiera:
si *falta* una esperada, R-1 materializado (esa ruta será 401 al activar); si *sobra* una no
esperada, una ruta quedó abierta por error — la dirección peligrosa, porque no rompe nada visible.
El `--check` limpio y la tabla de conteos (`total=250 public=67 perm=117 auth=63 esp=3`) **son la
evidencia de CA-1**, y se pegan antes del commit de activación.

**Departure declarada**: el script no está en la tabla de archivos de la US. Se agrega porque es la
única mitigación mecánica de R-4 y porque deja el inventario reproducible en un comando, en vez de
creerle a un markdown. Precedente: `jwt-options.ts` en US-22, también fuera de la tabla, también
declarado. No se agrega recipe de `just`: una línea de `node` documentada en `apps/README.md`
alcanza.

### Decisión G: D-8 — qué logra el filtro de propiedad y qué no

`GET /orders`: el controlador recibe `@CurrentUser()` y calcula el `customer_id` efectivo:

```ts
@Get()
async getOrders(@Query() query: GetOrdersDto, @CurrentUser() user: CurrentUserPayload) {
  const isAdminLevel = ADMIN_OWNER_AND_STAFF.some((p) => user.permissions.includes(p));
  // D-8: un cliente solo puede pedir SUS pedidos. `customer_id` es opcional en
  // GetOrdersDto (:14) y hoy el borde no lo controlaba.
  return this.ordersService.getOrders(
    isAdminLevel ? query : { ...query, customer_id: user.sub },
  );
}
```

**Lo que logra hoy, sin adornos**: la ruta deja de ser anónima y el `customer_id` queda forzado en
el borde, de modo que cuando US-25 haga real el servicio la restricción ya está puesta.

**Lo que NO logra**: aislamiento de datos punta a punta. `OrdersService.getOrders`
(`orders.service.ts:118-142`) **desestructura `customer_id` y no lo usa nunca** — solo filtra por
`shop_id` (`:133-135`) sobre el array en memoria. Un `customer` autenticado sigue viendo la misma
página de pedidos que vería un admin. Presentar esto como un IDOR cerrado sería falso (R-3);
arreglar el servicio es US-25 y **este diseño no lo toca**.

`GET /refunds`: aquí el filtro **no es cableable** y hay que decirlo. `RefundsController.findAll()`
(`refunds.controller.ts:23-26`) no recibe `@Query()` y `RefundsService.findAll()`
(`refunds.service.ts:11-15`) no acepta argumentos: devuelve `{data: []}` fijo. Forzar un
`customer_id` exigiría un DTO nuevo y cambiar la firma del servicio para que el parámetro quede
ignorado — código muerto especulativo. **Decisión: `/refunds` queda
autenticado (deny-by-default, sin `@Public()`) y el controlador lleva un comentario de una línea:
el filtro de propiedad entra con US-25, cuando exista dónde aplicarlo.** Aplicación parcial y
declarada de D-8: la mitad *observable* (la ruta deja de ser anónima) se cumple en las dos rutas;
la *estructural* solo en `orders`, la única con un campo que sobrescribir.

### Decisión H: D-10 — la creación de pedidos sigue abierta, con su coste anotado

`POST /orders` y `POST /orders/checkout/verify` llevan `@Public()` con el motivo en un comentario
(el checkout de invitado está vivo: `guestCheckout: true` en `settings.json:113`). El riesgo
aceptado (R-2, **ya cerrado**) se anota donde se puede tropezar con él: `OrdersService.create`
(`orders.service.ts:70-115`) **muta `this.orders[0]`**, objeto compartido por todos los requests
hasta que la API reinicia, y con gateway `stripe`/`paypal`/`razorpay` llama a
`processPaymentIntent` (`:106-109`). El rate limiting —su mitigación natural— está fuera de alcance
por el propio "NO incluye" de la US. Consecuencia operativa: el `curl` a `POST /orders` va **al
final** de la evidencia, después de `just verify`, porque contamina el estado en memoria del resto
de las rutas de pedidos; reiniciar la API lo limpia.

### Decisión I: lo que el guard global no cubre (declarado, no descubierto después)

- **`/docs` (Swagger UI y su JSON) sigue abierto**: `SwaggerModule.serveDocuments` registra sus
  handlers directamente en el adaptador HTTP (`swagger-module.js:34-62`, `httpAdapter.get(...)`),
  fuera del pipeline de controladores — los guards globales **no corren** ahí. Verificado en el
  paquete instalado. Cerrarlo es otra US.
- **`web-hook` (3 GET)**: `@Public()` con comentario (D-7 — Stripe/Razorpay/PayPal no traen JWT),
  sin validación de firma: R-6, fuera de alcance, los servicios son stubs.
- **`profiles` (3 rutas)**: sin anotar, caen en 401 (D-9, stubs muertos). Borrarlas excede el
  alcance.

### Decisión J: departures respecto de la tabla de archivos de la US

Tres archivos que la tabla de la US no lista: `auth/auth.module.ts` (Decisión A: sin la
reexportación la API no arranca) · `scripts/route-audit.mjs` (Decisión F) ·
`orders`/`refunds.controller.ts` (D-8, ampliación ya aprobada en el proposal).

## Data Flow

    Request ──→ [APP_GUARD #1  JwtAuthGuard]
                  getAllAndOverride(IS_PUBLIC_KEY, [handler, class])
                    ├ true  ─────────→ pasa SIN mirar el header (una cookie vencida no
                    │                   debe romper el checkout de invitado)
                    └ false → extractBearerToken(request)
                                ├ ausente / esquema != Bearer ─→ 401 INVALID_TOKEN_MESSAGE
                                └ jwtService.verify(token)   ← mismo secreto de US-22
                                    ├ throw ──────────────────→ 401 INVALID_TOKEN_MESSAGE
                                    └ payload → request.user = payload
                            ▼
                [APP_GUARD #2  PermissionsGuard]   (IS_PUBLIC → pasa)
                  getAllAndOverride(PERMISSIONS_KEY, [handler, class])
                    ├ undefined ─────────────────────→ pasa (token válido basta)
                    └ required[] → sin request.user ─→ 401 (nunca 403: anti-fuga, D-4)
                                 → required.some(p => user.permissions.includes(p))
                                     ├ false ────────→ 403 INSUFFICIENT_PERMISSIONS
                                     └ true  ────────→ handler
                            ▼
                Controller ── @CurrentUser() → request.user (sin re-verificar)
                              └ fallback D-3: sin guard, verifica el bearer él mismo

## File Changes

Rutas relativas a `apps/api/rest/`, salvo la última fila.

| Archivo | Acción | Descripción |
|---|---|---|
| `src/auth/decorators/current-user.decorator.ts` | **Move** | desde `auth/current-user.decorator.ts`; `request.user` + fallback (C); exporta `AuthenticatedRequest` |
| `src/auth/decorators/public.decorator.ts` | **Create** | `IS_PUBLIC_KEY` + `@Public()` |
| `src/auth/decorators/permissions.decorator.ts` | **Create** | `PERMISSIONS_KEY`, `@Permissions()` y los 3 sets (B) |
| `src/auth/guards/jwt-auth.guard.ts` | **Create** | `@Public()` vía `Reflector`; verifica el bearer, pobla `request.user`; 401 |
| `src/auth/guards/permissions.guard.ts` | **Create** | any-of sobre `request.user.permissions`; 403; docblock de CA-5 |
| `scripts/route-audit.mjs` | **Create** | auditor de rutas + `--check` (F) |
| `src/auth/auth.controller.ts` | Modify | import de `./decorators/...` (`:3`) + `@Public()` en 10 rutas |
| `src/**/*.controller.ts` (44 restantes) | Modify | anotación de las 250 rutas según el inventario CA-1 |
| `src/orders/orders.controller.ts` | Modify | `@Public()` en `POST /` y `POST checkout/verify` (D-10) + filtro de propiedad en `GET /` (D-8) |
| `src/refunds/refunds.controller.ts` | Modify | autenticada; comentario de por qué el filtro espera a US-25 (G) |
| `src/auth/auth.module.ts` | Modify | `exports: [AuthService, JwtModule]` (A) |
| `src/app.module.ts` | Modify | **último commit**: 2 `APP_GUARD` en orden + imports |
| `apps/README.md` | Modify | postura de seguridad, cómo probar con token, R-2/R-6, `/docs` abierto, el auditor |

## Interfaces / Contracts

Las firmas de los decoradores están en la Decisión B. Lo demás:

```ts
// auth/decorators/current-user.decorator.ts  (sin cambios de tipo respecto de US-22)
export interface CurrentUserPayload { sub: number; email: string; permissions: string[]; iat: number; exp: number; }
export type AuthenticatedRequest = Request & { user?: CurrentUserPayload };
export const INVALID_TOKEN_MESSAGE: string;   // reutilizado por JwtAuthGuard

// auth/guards/*.ts
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly jwtService: JwtService) {}
  canActivate(ctx: ExecutionContext): boolean;   // síncrono: verify(), no verifyAsync()
}
export const INSUFFICIENT_PERMISSIONS_MESSAGE: string;
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean;
}
```

Ninguna firma de servicio cambia: `OrdersController.getOrders` gana un parámetro y `OrdersService`
no se toca.

## Verification Design (mapeo 1:1 con la DoD)

| DoD | Diseño de la evidencia |
|---|---|
| **CA-1** inventario que suma 250 | `node scripts/route-audit.mjs` + `--check` limpio, ambas salidas pegadas: 67 públicas efectivas, 117 con permiso, 63 autenticadas, 3 `profiles` |
| **CA-2** los 4 `curl` | (1) `GET /api/settings` sin token → **200**; (2) `GET /api/users` sin header → **401**; (3) con token de `customer@demo.com` → **403**; (4) con token de `admin@demo.com` → **200**. Tokens de `POST /api/token` con `demodemo`; se pega `curl -i` completo, no solo el código |
| **CA-3** tienda anónima | `just verify` con el conteo de product-cards pegado **y** navegación manual sin sesión: home, listado, detalle, búsqueda, categoría. `curl` no cierra CA-3 (R-1). Barrido extra: los GET públicos sin parámetros que lista el auditor, esperando != 401 |
| **CA-4** admin exige permiso | `GET /api/users` y `GET /api/admin/list` con token de `customer` → 403 (no 200), pegados |
| **CA-5** permisos del token | Docblock presente en `permissions.guard.ts` (Decisión E) + `grep -n "@safari/db\|@prisma/client\|prisma" apps/api/rest/src/auth/guards/*.ts` → 0 resultados, pegado |
| **CA-6** sin regresión | `just build-api` limpio + `curl -s localhost:9001/api/settings \| wc -c` antes y después de la activación (precedente **5503**) |

**Sobre la comparación byte a byte** (advertencia heredada de `CLAUDE.md`): el conteo es necesario
pero **no suficiente**. La divergencia ya embarcada de `created_at`/`updated_at` —el seed no
inserta esas columnas y `Date.toJSON()` emite 3 decimales donde Laravel traía 6— produce timestamps
ISO de la **misma longitud**, así que `wc -c` no la ve. Aquí es tolerable porque los guards no
tocan el cuerpo: la comparación prueba que el guard no interpuso nada, no que el cuerpo sea
idéntico al del mock. Se declara para que `sdd-verify` no lea de más en un "5503 = 5503".

Ninguna verificación toca Postgres ni emite estado nuevo, salvo el `POST /orders` de D-10 (va
último, ver Decisión H).

## PR Slicing (insumo para `sdd-tasks`, `delivery_strategy: ask-on-risk`)

R-5 del proposal ya declara que el diff supera el presupuesto de 400 líneas. Estimación por corte:

| PR | Contenido | ~Líneas | ¿Cambia comportamiento? | Verificación de cierre |
|---|---|---|---|---|
| **#1 Infraestructura** | 2 guards, 2 decoradores, `@CurrentUser()` movido, `route-audit.mjs`, `auth.module.ts` export | ~260 | **No** — nada registrado, metadata sin lector | `just build-api` limpio · `just verify` verde · `grep -rn "APP_GUARD" src` → 0 · auditor corriendo y reportando 250 rutas, 0 anotadas |
| **#2 Anotaciones** | 250 rutas en 45 controladores (`@Public()` + `@Permissions()`) | ~210 | **No** — `SetMetadata` sin guard es inerte | `just build-api` · `--check` limpio · `just verify` verde |
| **#3 Activación** | 2 `APP_GUARD`, D-8 en `orders`/`refunds`, `apps/README.md` | ~90 | **Sí, todo el cambio vive aquí** | DoD completa: 4 `curl`, `just verify`, navegación anónima, 5503 bytes, `just build-api` |

Los tres cortes son **independientemente revisables** y **seguros de mergear por separado**: #1 y #2
porque son demostrablemente inertes (el revisor lo confirma con un `grep` de `APP_GUARD`, no
confiando en la descripción), #3 porque es chico y se revierte quitando dos líneas. El orden es
obligatorio, no una preferencia: #3 antes que #2 es exactamente R-1.

Si el orquestador prefiere menos PRs: fusionar #1 y #2 (~470 líneas, inertes, `size:exception`
defendible) y dejar #3 solo. Lo que **no** se recomienda es un PR único: mezcla ~470 líneas
mecánicas con las ~30 que hay que mirar con lupa.

## Rollback

1. **Emergencia**: borrar los dos `{ provide: APP_GUARD, ... }` de `app.module.ts` +
   `just build-api`. La API vuelve a estar abierta y las 250 anotaciones quedan inertes. `/me`,
   `change-password` y `add-points` **siguen funcionando** porque el fallback de la Decisión C
   verifica el bearer sin guard; `GET /orders` sigue exigiendo token por la misma razón (efecto de
   D-8 que sobrevive al rollback — declarado, no accidental).
2. **Parcial**: ruta pública olvidada → agregarle `@Public()` y volver a correr `--check`.
3. **Completo**: `git revert` del rango, o `git checkout apps/api/rest/src apps/README.md`. Sin
   rollback de datos: no se toca Postgres, `db/`, `packages/db` ni se emiten tokens.

## Traceability

Deny-by-default con `@Public()` (CA-2) → A + B + Data Flow · 401 vs 403 (D-4) → D, con la regla
anti-fuga · permisos del token sin base (D-5/CA-5) → E · catálogo anónimo intacto (CA-3/R-1) → F +
PR slicing · administración con permiso (CA-4) → B · `@CurrentUser()` movido (D-3) → C · propiedad
en `orders`/`refunds` (D-8) → G · invitado y su coste (D-10/R-2) → H · `web-hook`, `profiles`,
`/docs` (D-7/D-9) → I · sin regresión (CA-6) → Verification Design.

## Open Questions

Ninguna. Las 10 clasificaciones y R-2 llegaron cerradas; A-J resuelven lo mecánico y las tres
apuestas de framework se verificaron contra `apps/api/rest/node_modules`.
