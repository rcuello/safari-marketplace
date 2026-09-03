# Verification Report — `guards-autorizacion-api` (US-23)

> Fase `sdd-verify`. Postura: **adversarial**. Este informe NO reformula
> `apply-progress.md`: cada afirmación de la columna "re-verificado" salió de un
> comando que corrió en ESTA sesión, contra el código real del árbol de trabajo.
> Lo que no pude reproducir está aislado en la sección "Evidencia aceptada bajo
> confianza".
>
> **Veredicto final: PASS WITH WARNINGS** — los 6 criterios de aceptación se
> cumplen; 8 hallazgos, ninguno crítico, ninguno bloqueante para archivar.

| Campo | Valor |
|---|---|
| Change | `guards-autorizacion-api` |
| Modo | Artefactos completos (proposal + specs + design + tasks) |
| Strict TDD | `false` — no hay runner de tests en `apps/api/rest` (US-10 pendiente) |
| `require_evidence` | `true` — toda la evidencia de abajo es salida real pegada |
| Entorno | Windows 11, Git Bash, Postgres `safari-postgres` 5433 (ya arriba), API 9001, shop 3003, admin 3002 (levantados y **detenidos** por esta sesión) |

---

## 1. Completitud de tareas

| Fase | Tareas | Estado |
|---|---|---|
| 1 — Infraestructura inerte | 7/7 | `[x]` |
| 2 — Anotación de 250 rutas | 14/14 | `[x]` |
| 3 — Activación | 5/5 | `[x]` |
| 4 — Verificación | 14/14 | `[x]` (4.9 cerrada por el orquestador) |
| **Total** | **40/40** | Sin tareas de implementación abiertas |

Ninguna tarea desmarcada. Discrepancia de registro entre artefactos: ver
**H-3**.

---

## 2. Evidencia re-verificada en esta sesión

### 2.1 Los guards existen y hacen lo que la spec dice

Lectura directa de `apps/api/rest/src/auth/guards/*.ts` y
`apps/api/rest/src/auth/decorators/*.ts`:

- `JwtAuthGuard` resuelve `@Public()` con
  `reflector.getAllAndOverride(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()])`
  — **handler y clase**, en ese orden. Conforme.
- Ausencia de header, esquema `!= Bearer`, token vacío, firma inválida y
  expiración van todos a `UnauthorizedException(INVALID_TOKEN_MESSAGE)` → 401.
- `PermissionsGuard` lanza `ForbiddenException` **solo** con `request.user`
  presente e intersección vacía; si `request.user` falta lanza **401**, no 403
  (regla anti-fuga, Decisión D). Conforme al MUST NOT de la spec en las dos
  direcciones.
- Comparación estrictamente sobre `request.user.permissions` con `.some()`
  (any-of). Cero acceso a datos.

Cero referencias a la capa de datos en los guards:

```
$ grep -n "@safari/db\|@prisma/client\|prisma\|PrismaClient" apps/api/rest/src/auth/guards/*.ts
(0 resultados — exit 1)
```

Docblock de coste CA-5: **presente**, inmediatamente encima de
`export class PermissionsGuard` (`permissions.guard.ts:19-27`), con el texto
que exige la Decisión E (revocar un permiso no afecta a un token ya emitido
hasta que expira `JWT_EXPIRES_IN`).

### 2.2 La activación es real

```
$ grep -n "APP_GUARD\|JwtAuthGuard\|PermissionsGuard" apps/api/rest/src/app.module.ts
4:import { APP_GUARD } from '@nestjs/core';
6:import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
7:import { PermissionsGuard } from './auth/guards/permissions.guard';
110:    { provide: APP_GUARD, useClass: JwtAuthGuard },
111:    { provide: APP_GUARD, useClass: PermissionsGuard },
```

Orden correcto (autenticación antes que autorización). `auth.module.ts` exporta
`[AuthService, JwtModule]`. Prueba operativa de que la Decisión A está bien
cableada: la API **arrancó** en esta sesión con los dos guards activos
(`Nest application successfully started`); sin el export de `JwtModule` el
arranque fallaría al resolver `JwtService`.

### 2.3 El inventario cuadra — y una corroboración independiente del auditor

```
$ node apps/api/rest/scripts/route-audit.mjs --check
total=250 public=67 perm=117 auth=63 esp=3
[route-audit] --check OK: el set de rutas públicas coincide con EXPECTED_PUBLIC.
EXIT=0
```

Suma: `67 + 117 + 63 + 3 = 250`. Reconciliación con el proposal
(`64 + 63 + 117 + 6 = 250`, con los 3 `web-hook` reclasificados dentro de
`public` por llevar `@Public()` efectivo): consistente.

**Corroboración que el apply no hizo**: conté las rutas que el propio Nest
registra al arrancar, contra el log del `RouterExplorer` — una fuente
totalmente independiente del parser de texto:

```
$ grep -c "Mapped {" api.log
250
$ grep -o "Mapped {[^}]*}" api.log | sort -u | wc -l
249
```

**250 handlers registrados = 250 rutas del auditor.** El parser estructural no
se comió ni inventó ninguna. La diferencia 250 vs 249 es un handler duplicado
preexistente, no un error del auditor (ver **H-5**).

#### Bidireccionalidad del `--check`: probada, no supuesta

Este auditor es el ÚNICO control mecánico contra R-1, así que lo sometí a
mutación sobre una **copia desechable** del árbol (el repo no se tocó):

| Mutación | Resultado | ¿Detectada? |
|---|---|---|
| Quitar `@Public()` de una ruta esperada pública (`GET /settings`) | `FALTAN 1 ruta(s) pública(s)…` · `EXIT=1` | Sí |
| Agregar `@Public()` a una ruta no esperada (`GET /users`) | `SOBRAN 1 ruta(s) anotadas @Public()…` · `EXIT=1` | Sí |
| Quitar un `@Permissions()` de clase (`UsersController`, 8 rutas) | `total=250 public=67 perm=109 auth=71 esp=3` · `--check OK` · `EXIT=0` | **No** → H-1 |
| `@Public()` presente pero NO en la línea inmediatamente anterior | `total=250 public=67 …` · `--check OK` · `EXIT=0` | **No** → H-2 |

Las dos direcciones que el diseño promete (falta / sobra en el set público)
**sí** funcionan. Las otras dos son huecos del control: ver H-1 y H-2.

### 2.4 `just build-api` limpio

```
$ just build-api
yarn build
yarn run v1.22.22
$ rimraf dist
$ nest build
(node:19988) [DEP0053] DeprecationWarning: The `util.isObject` API is deprecated...
Done in 138.27s.
BUILD_EXIT=0
```

### 2.5 Los 4 casos CA-2 / CA-4, re-corridos contra la API viva

Tokens minteados en esta sesión vía `POST /api/token` real:

```
payload customer: {"sub":2,"email":"customer@demo.com","permissions":["customer"],...}
payload admin:    {"sub":3,"email":"admin@demo.com","permissions":["super_admin","customer","store_owner"],...}
```

| # | Caso | Resultado |
|---|---|---|
| 1 | `GET /api/settings` sin token | **200** |
| 2 | `GET /api/users` sin `Authorization` | **401** — `{"statusCode":401,"message":"Token de autenticación ausente o inválido.","error":"Unauthorized"}` |
| 3 | `GET /api/users` con token `customer` | **403** — `{"statusCode":403,"message":"No tienes permisos suficientes para esta operación.","error":"Forbidden"}` |
| 4 | `GET /api/users` con token `admin` | **200** — `{"data":[{"is_active":1,"id":3,"name":"Jhon Doe",...` |

CA-4 ampliado a las tres rutas `*/list` reales, en las dos direcciones:

```
admin/list         403 (customer)   200 (admin)
vendors/list       403 (customer)   200 (admin)
customers/list     403 (customer)   200 (admin)
```

**Variantes de 401 que el apply no cubrió** (la spec las exige explícitamente:
«ausencia, esquema distinto de `Bearer`, firma inválida o expiración»):

```
sin header                               401
esquema Basic                            401
Bearer vacio                             401
firma alterada                           401
token basura                             401
token expirado (firma valida)            401   <- caso nuevo de esta sesion
```

El token expirado se forjó firmando con el `JWT_SECRET` real del `.env` y
`exp` en el pasado: firma válida, expiración vencida → 401, no 500 ni 403.

### 2.6 Casos declarados: `profiles`, `web-hook`, `/docs`, checkout de invitado

```
POST /api/profiles sin token             401    (D-9: stub sin anotar, deny-by-default)
GET  /api/web-hook/stripe sin token      200    (D-7: @Public() de clase, con comentario)
GET  /docs sin token                     200    (Decision I: fuera del pipeline de controllers)
GET  /docs-json sin token                200
GET  /api/orders sin token               401
GET  /api/refunds sin token              401
POST /api/orders sin token               201    (D-10: checkout de invitado vivo)
POST /api/orders/checkout/verify         201
GET  /api/me con token                   200    (sin regresion de US-22)
```

`web-hook.controller.ts:5` y `orders.controller.ts` llevan el comentario de
justificación exigido; verificado por lectura. `/docs` abierto está declarado
en `design.md` (Decisión I), `tasks.md` 4.13 y `apps/README.md` como
**conocido y fuera de alcance**, no como defecto corregido. Marco correcto.

### 2.7 D-8: qué shippeó de verdad

Prueba directa de que **no hay aislamiento de datos punta a punta** —
`customer` (sub=2) y `admin` piden lo mismo:

```
customer(sub=2) -> total 20 | ids: 48,41,39,37,35 | customer_ids en el resultado: 2,6
admin           -> total 20 | ids: 48,41,39,37,35 | customer_ids en el resultado: 2,6
cuerpos identicos: true
```

El `customer` ve pedidos de `customer_id: 6`. Causa confirmada en fuente:
`OrdersService.getOrders` desestructura `customer_id` y **no lo usa nunca**
(solo filtra por `shop_id`). `RefundsService.findAll()` devuelve `{data: []}`
sin argumentos, y `RefundsController.findAll()` no recibe `@Query()`, así que
el filtro no era cableable.

**No encontré ningún overclaim aquí.** La spec (`spec.md:96-101`), el
`design.md` (Decisión G), `apps/README.md` y `apply-progress.md` dicen todos,
con esas palabras, que el requirement fija el comportamiento **en el borde de
la ruta** y NO afirma aislamiento punta a punta. La evidencia coincide con la
afirmación.

### 2.8 `/api/settings`: el conteo de bytes, resuelto

```
Buffer.length (bytes UTF-8)      = 5504
String.length (unidades UTF-16)  = 5503
no-ASCII: ["©"]  -> delta bytes-utf16 = 1
```

El razonamiento del apply **se sostiene y lo confirmo**: el cuerpo contiene
exactamente un carácter no-ASCII (`©` de "Copyright © REDQ."), que pesa 2 bytes
en UTF-8 y 1 unidad en UTF-16. El recipe de `just verify` acumula chunks con
`body += c` y reporta `body.length` → mide unidades UTF-16.

Consecuencia que conviene decir sin rodeos: **medido en la MISMA unidad que el
precedente, la comparación cierra exacta**. `just verify` reportó `5503B` en
US-22 (pre-guard) y reporta `5503B` hoy (post-guard). No hay desfase; había una
confusión de unidades. El "5504" es el mismo cuerpo medido en bytes reales.

### 2.9 `just verify` verde — reproducido

```
$ just verify
OK   API    :9001/api/settings  200  5503B  64ms
OK   Shop   :3003/en  200  190788B  52974ms  cards:30
OK   Admin  :3002/en/login  200  72821B  43630ms  cards:1
VERIFY_EXIT=0
```

Cifras **idénticas** a las del apply (5503B / 190788B / cards:30 / 72821B /
cards:1) en una sesión distinta y un proceso distinto. Reproducible.

### 2.10 CA-3 sin navegador: SSR anónimo de las 5 rutas

No tengo navegador, pero sí puedo pedir el HTML renderizado en servidor de las
cinco rutas de CA-3 sin cookie ni token, y buscar rastros de rechazo:

| Ruta | bytes | product-cards | `Unauthorized` / `Token de autenticación` en el HTML |
|---|---|---|---|
| `/en` | 190788 | **30** | no |
| `/en/products/apples` | 110313 | 19 | no |
| `/en/shops` | 111487 | 0 (datos client-side) | no |
| `/en/grocery/search?text=chicken` | 127362 | 0 (datos client-side) | no |
| `/en/grocery/search?category=fruits-vegetables` | 127376 | 0 (datos client-side) | no |

(Un primer barrido marcó "401" en `/en`: falso positivo, la única ocurrencia es
el SKU `"sku":"1401"`. `Unauthorized` y `Token de autenticación` no aparecen en
ninguna de las cinco páginas.)

Y por API directa, anónima: `settings`, `products`, `types`, `categories`,
`tags`, `shops`, `products/apples`, `faqs` → **200** todas.

### 2.11 Cumplimiento de alcance

```
$ git status --porcelain | grep -E "apps/shop|apps/admin|db/seed.sql"
NINGUNO (correcto)
```

Y una comprobación más fuerte que el `git status`: filtré del diff de los 45
controllers **toda** línea agregada que no fuera import, decorador, comentario
o llave. Lo único que quedó:

```
+  async getOrders(
+    @Query() query: GetOrdersDto,
+    @CurrentUser() user: CurrentUserPayload,
+  ): Promise<OrderPaginator> {
+    const isAdminLevel = ADMIN_OWNER_AND_STAFF.some((permission) =>
+      user.permissions.includes(permission),
+    );
+    return this.ordersService.getOrders(
+      isAdminLevel ? query : { ...query, customer_id: user.sub },
+    );
```

El **único** cambio de lógica en 250 rutas anotadas es el filtro D-8. Ningún
endpoint de escritura del mock se implementó de paso. Alcance respetado.

---

## 3. Evidencia aceptada bajo confianza (NO re-verificada por mí)

| Afirmación | Origen | Por qué no la reproduje |
|---|---|---|
| Navegación anónima en navegador real: 5 rutas, **30 peticiones a `:9001`, todas 200/304, cero 401/403**; 18 mensajes de consola, ninguno de autorización | `apply-progress.md` §CA-3 (orquestador) | No tengo herramienta de navegador. **No afirmo haberlo rehecho.** |
| Experimento controlado "con `APP_GUARD` comentado, el cuerpo sigue midiendo 5504 bytes" | `apply-progress.md` 4.11 | Exigía mutar `app.module.ts`; el mandato de esta fase prohíbe tocar código. El argumento a priori (un `CanActivate` no puede alterar el cuerpo de una respuesta que autoriza) y §2.8 lo hacen redundante. |
| Que el árbol pre-anotación reportara `total=250 public=0 perm=0 auth=247 esp=3` | `apply-progress.md` 1.7 | Estado histórico, ya no existe en el árbol. |

**Valoración de la evidencia de CA-3.** Es **suficiente**, pero por el trace de
red, no por la captura. La pieza decisiva —30 peticiones, cero 401/403— es
exactamente el tipo de prueba que CA-3 pide y que `curl` no puede dar, porque
demuestra que ninguna llamada fue rechazada aunque el frontend se la tragara en
silencio. En cambio, `evidence-anon-storefront.png` aporta poco por sí sola:
ver **H-4**. Mis §2.9 y §2.10 corroboran el mismo hecho por dos vías
independientes (conteo de product-cards y ausencia de rastros de 401 en el SSR
de las cinco rutas), lo que reduce mucho el peso que hay que poner en un
registro textual no reproducible. Doy **CA-3 por cumplido**.

---

## 4. Matriz de cumplimiento de la spec (6 requirements / 11 escenarios)

| # | Requirement / Scenario | Estado | Evidencia |
|---|---|---|---|
| R1 | Guard global deny-by-default, permisos solo del token | **PASS** | §2.1, §2.2 |
| R1.1 | Ruta protegida sin token → 401 | PASS (runtime) | §2.5 caso 2 |
| R1.2 | Token válido, permiso insuficiente → 403 (no 401) | PASS (runtime) | §2.5 caso 3 |
| R1.3 | La verificación de permiso no toca la base + comentario de coste | PASS (grep + lectura) | §2.1 |
| R2 | Las 250 rutas en 4 buckets verificables | **PASS** | §2.3 |
| R2.1 | El inventario cuadra con el conteo estructural independiente | PASS | §2.3 — auditor 250 ⇔ `RouterExplorer` 250 |
| R2.2 | `web-hook` responde sin token, `profiles` no | PASS (runtime) | §2.6 |
| R3 | El catálogo y el contenido de referencia siguen públicos | **PASS** | §2.9, §2.10 |
| R3.1 | Navegación anónima completa; `just verify` cuenta product-cards | PASS | `cards:30`, 8/8 endpoints públicos en 200 |
| R4 | Orders/refunds — invitado en la creación, propiedad en el listado | **PASS (parcial por diseño)** | §2.6, §2.7 |
| R4.1 | `POST /orders` sin sesión no se rechaza | PASS (runtime) | 201 |
| R4.2 | `customer` no puede pedir pedidos de otro por query | **PASS por inspección — UNTESTED en runtime** | H-6 |
| R4.3 | Un admin conserva el `customer_id` que pida | **PASS por inspección — UNTESTED en runtime** | H-6 |
| R5 | Las rutas de administración exigen el permiso equivalente | **PASS** | §2.5 (4 rutas × 2 tokens) |
| R5.1 | `customer` no lista usuarios; admin sí escribe | PASS (runtime) | 403 vs 200 |
| R6 | El guard se activa sin regresión de contrato | **PASS** | §2.4, §2.8, §2.9 |
| R6.1 | `/api/settings` no cambia de tamaño y `verify` queda verde | PASS | 5503 = 5503 en la misma unidad |

**9 de 11 escenarios verificados en runtime; 2 solo por inspección de fuente**
(R4.2 y R4.3, estructuralmente no observables — H-6).

---

## 5. Veredicto por criterio de aceptación

| CA | Veredicto | Evidencia propia (re-verificada) | Evidencia bajo confianza |
|---|---|---|---|
| **CA-1** — Inventario explícito antes del guard | **Cumplido** | `--check` exit 0, `67+117+63+3=250`; corroborado contra las 250 rutas que Nest registra al arrancar; bidireccionalidad del auditor probada por mutación | — |
| **CA-2** — Deny by default (401 / 403) | **Cumplido** | Los 4 casos + 6 variantes de 401 (incluida expiración, no cubierta por el apply) | — |
| **CA-3** — La tienda sigue funcionando anónima | **Cumplido** | `just verify` verde reproducido (`cards:30`); SSR anónimo de las 5 rutas sin rastro de 401; 8 endpoints públicos en 200 | Trace de navegador: 30 peticiones, cero 401/403 (§CA-3) |
| **CA-4** — Administración exige permiso | **Cumplido** | `/api/users` + 3 rutas `*/list`, cada una con token `customer` (403) y `admin` (200) | — |
| **CA-5** — Los permisos salen del token | **Cumplido** | `grep` de base de datos en los guards → 0; docblock de coste presente y con el texto exigido; lectura de `.some()` sobre `request.user.permissions` | — |
| **CA-6** — Sin regresión | **Cumplido** | `just build-api` exit 0; `just verify` exit 0 con cifras idénticas; `5503 = 5503` en la misma unidad; `/api/me` sigue en 200 | Experimento guard-on/guard-off del apply |

---

## 6. Hallazgos (8) — ordenados por severidad

### H-1 · MEDIA — El `--check` no protege el bucket `perm`: quitar un `@Permissions()` pasa desapercibido

`runCheck()` (`route-audit.mjs:263-298`) compara **únicamente** el set de rutas
públicas. Los conteos se imprimen pero nada los asevera. Verificado por
mutación sobre una copia: al borrar el `@Permissions(...)` de clase de
`UsersController` (8 rutas que pasan de `perm` a `auth`, es decir: cualquier
usuario logueado listaría usuarios):

```
total=250 public=67 perm=109 auth=71 esp=3
[route-audit] --check OK: el set de rutas públicas coincide con EXPECTED_PUBLIC.
EXIT=0
```

`apps/README.md` presenta el auditor como «la forma reproducible de confirmar
que ninguna ruta pública quedó sin anotar», lo cual es literalmente cierto; el
riesgo es que se lea como una red de seguridad de la autorización completa,
cuando cubre una sola de las tres clasificaciones. Sugerencia (no aplicada):
asertar también los conteos `perm`/`auth`, o un `EXPECTED_PERMISSIONS` análogo.

### H-2 · MEDIA — El docblock del auditor promete "ningún falso verde" y sí lo hay

`route-audit.mjs:12-19` afirma que la limitación de adyacencia «no es un bug
silencioso: el `--check` fallaría por "ruta esperada pública, sin anotar", no
por un falso verde». **Empíricamente falso en la dirección peligrosa.** Un
`@Public()` separado del decorador HTTP por otra línea de decorador es
invisible para el parser pero perfectamente efectivo para `Reflector` en
runtime:

```
  @Public()
  @HttpCode(200)
  @Get()
--> total=250 public=67 perm=117 auth=63 esp=3
    [route-audit] --check OK.   EXIT=0
```

En una ruta del bucket `auth` (sin `@Permissions()`) eso es un agujero abierto
con el `--check` en verde. **Hoy no ocurre**: verifiqué que en el árbol real no
hay ninguna ruta con `@Public()` y `@Permissions()` juntos (0 coincidencias) y
el `--check` cierra limpio. Es una debilidad latente del control y una
afirmación inexacta en su propia documentación, no un defecto vivo.

### H-3 · BAJA — Tres artefactos se contradicen sobre el estado de la tarea 4.9 / CA-3

- `tasks.md` 4.9 → `[x]`, cerrada por el orquestador.
- `apply-progress.md` §"Remaining Tasks" → `[ ] 4.9 … reservada al
  orquestador`; §"Status" → «**39/40 tareas completas**». Quedaron sin
  actualizar después de que el propio §CA-3 (más abajo en el mismo archivo)
  cerrara la tarea.
- `docs/product/19-autenticacion-autorizacion/23-guards-autorizacion-api.md` →
  cabecera `Status: ✅ Implementada` y fila del épico igual, pero el 4.º ítem
  de la Definición de Done sigue en `[ ]` y dice «**pendiente**, reservada a
  una sesión con herramienta de navegador (no ejecutada por el agente de
  apply)».

El hecho (CA-3 cerrado con evidencia de navegador) es correcto; lo que está mal
es el registro. La US se declara Implementada con un ítem de su propia DoD
todavía marcado como pendiente. **No lo corregí** (esta fase no edita). Debería
resolverse antes de `sdd-archive`.

### H-4 · BAJA — La captura de CA-3 aporta bastante menos de lo que su nombre sugiere

Abrí `evidence-anon-storefront.png`: muestra el modal "Get 25% Discount"
tapando la home. Se ve la cabecera con "Join" / "Become a Seller", lo que sí
acredita **sesión anónima** — y nada más. **Cero product-cards visibles**, y
ninguna de las otras cuatro rutas (detalle, búsqueda, categoría, listado).

La afirmación de §CA-3 no es falsa: dice explícitamente que la evidencia
decisiva es el trace de red, no la imagen. Pero un lector futuro que abra el
`.png` esperando la prueba de las 5 rutas no la encontrará, y el trace de red
—que es la pieza que sostiene CA-3— quedó solo como prosa, sin artefacto
adjunto (HAR, listado de peticiones). Recomendación: adjuntar el listado de
peticiones o capturas de las 5 rutas sin el modal.

### H-5 · BAJA — Son 250 handlers, pero 249 endpoints distintos

Nest registra 250 handlers y solo 249 rutas únicas:

```
$ grep -o "Mapped {[^}]*}" api.log | sort | uniq -d
Mapped {/api/notify-logs/:id, PUT}
```

`notify-logs.controller.ts` declara dos `@Put(':id')` (líneas 35 y 40); el
segundo queda a la sombra del primero. Ambos están en el bucket `auth`, así que
**no hay divergencia de autorización** y no es un defecto introducido por
US-23 (es una rareza preexistente del mock de Pickbazar). Lo anoto porque todos
los artefactos repiten "250 rutas" y lo exacto es "250 handlers, 249 endpoints
distintos".

### H-6 · BAJA — Dos escenarios de la spec no son observables en runtime

R4.2 («el `customer_id` efectivo es el `sub` del token») y R4.3 («el admin
conserva el `customer_id` que pida») no se pueden observar desde el cable:
`OrdersService.getOrders` ignora el campo, así que las dos ramas del ternario
producen la misma respuesta byte a byte (demostrado en §2.7). Los verifiqué
**solo por inspección de fuente** (`orders.controller.ts`, el filtro está y es
correcto).

Regla de esta fase: un escenario es compliant cuando un test lo cubre en
runtime. Aquí no hay runner para `apps/api/rest` (US-10) y el efecto es
estructuralmente inobservable hasta US-25. La spec declara la limitación con
honestidad, así que **no es un overclaim** — es cobertura ausente, y así queda
registrada.

### H-7 · BAJA — El diagrama de flujo del `design.md` no coincide con el guard

El Data Flow (`design.md:290`) muestra `PermissionsGuard` con `(IS_PUBLIC →
pasa)`. La implementación **no lee `IS_PUBLIC_KEY` en ningún momento**: una
ruta con `@Public()` y `@Permissions()` a la vez recibiría 401 por la regla
anti-fuga, no pasaría. El comportamiento real es el más seguro de los dos y
ninguna ruta combina ambos decoradores (verificado, 0 coincidencias). Es una
inexactitud del diagrama, no un bug.

### H-8 · INFORMATIVO — IDOR residual, fuera del alcance de esta US

`GET /orders/:id` y `GET /orders/tracking-number/:tracking_id` quedan en el
bucket `auth` sin comprobación de propiedad: cualquier usuario autenticado
puede leer el pedido de cualquier otro por id. Es una **mejora** respecto del
estado previo (antes eran anónimas), la spec de US-23 no lo exige y el filtro
de propiedad real es US-25. Lo dejo señalado como insumo para esa historia.

### Overclaims buscados y NO encontrados

Revisé una por una las afirmaciones que el encargo marcaba como sospechosas:

- **D-8 / IDOR**: ningún artefacto afirma aislamiento punta a punta. Spec,
  design (G), README y apply-progress dicen lo contrario, explícitamente.
  Correcto.
- **`/refunds` no admitía el filtro**: cierto, verificado en fuente
  (`findAll()` sin `@Query()`, servicio sin argumentos).
- **5503 vs 5504**: el razonamiento del apply es correcto y lo reproduje. Más
  aún: en la unidad del precedente el número no se movió.
- **`/docs` abierto**: verificado 200, y está enmarcado como declarado y fuera
  de alcance en los cuatro sitios donde aparece. Correcto.
- **CA-3 por el orquestador**: correctamente atribuido, sin que ningún artefacto
  finja que lo cerró el apply.

---

## 7. Estado del entorno al cerrar

```
$ just check-ports
libre    9001
libre    3003
libre    3002

$ docker ps | grep safari-postgres
safari-postgres   Up 24 hours (healthy)
```

Los tres servicios que levanté quedaron detenidos; Postgres (dependencia local
compartida, ya estaba arriba) se dejó en marcha. El árbol de trabajo no se
modificó: las pruebas de mutación del auditor corrieron sobre una copia en el
scratchpad, ya borrada. No se hizo commit ni push.

**Nota para `sdd-archive`**: el árbol de trabajo tiene sin commitear los
cambios de **dos** changes a la vez — el archivado de `login-jwt-postgres`
(US-22) y todo US-23. Conviene separarlos en commits distintos. Además,
`openspec/changes/guards-autorizacion-api/` no tiene `state.yaml`, que la
convención de OpenSpec sí contempla.

---

## 8. Veredicto final

**PASS WITH WARNINGS.**

Los 6 criterios de aceptación se cumplen y 9 de los 11 escenarios de la spec
están verificados en runtime por mí, en esta sesión, con salida real. El
trabajo es sólido y —cosa poco frecuente— la evidencia del apply resultó
*conservadora*: donde había un desfase (los 5503 bytes) lo declaró en vez de
maquillarlo, y donde el logro es parcial (D-8) lo dijo con todas las letras en
los cuatro artefactos. No encontré un solo overclaim.

Los dos hallazgos de severidad media (H-1, H-2) no afectan al código embarcado
—que está correcto y verificado— sino a la **fuerza del control** que lo
protegerá de aquí en adelante: el auditor cubre menos superficie de la que su
documentación promete. Vale la pena cerrarlos antes de que alguien confíe en un
`--check` verde para una anotación futura.

Nada de lo hallado bloquea el archivado. H-3 (los tres artefactos que se
contradicen sobre 4.9) sí debería corregirse primero, por higiene del registro.
