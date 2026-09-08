# Verification Report

**Change**: `endpoints-usuarios-postgres` (US-25, historia de cierre del Épico 19)
**Version**: 3 capabilities delta (`user-management-api`, `identity-data-layer`, `authorization-guards-api`)
**Mode**: Standard (`strict_tdd: false` en `openspec/config.yaml`)
**Rama verificada**: `pr3/users-postgres` @ `5af928c` (4 commits sobre `main`)
**Artifact store**: openspec-only (Engram NO conectado)
**Fecha**: 2026-09-08

> Toda la evidencia de esta sección es salida REAL de comandos ejecutados en
> esta sesión de verify (`rules.verify.require_evidence: true`). Postgres 16
> en Docker (`safari-postgres`, healthy, puerto 5433) con `db/schema.sql` +
> `db/seed.sql` aplicados; API levantada a propósito para la evidencia HTTP y
> apagada al cierre (`just check-ports` → los 3 puertos libres).

---

## Veredicto ejecutivo

**PASS WITH WARNINGS** — los 6 criterios de aceptación de US-25 se cumplen
contra el sistema real. Cero defectos funcionales encontrados. Los tres
warnings son: (1) `just build` falla, por una causa **preexistente y ajena
al diff** (probada, no supuesta); (2) el texto del spec de CA-1 sobreafirma
"las 4 `*_page_url` son strings, nunca `null`", cuando en una sola página
`next`/`prev` son `null` — exactamente como el mock; (3) el presupuesto de
revisión de 400 líneas se superó (~965 líneas en PR3) sin tomar el split
3a/3b que `tasks.md` 3.17 tenía preautorizado.

**Listo para archivar: SÍ**, con la condición de gobernanza del §9 (decidir
si PR3 se parte antes de la revisión humana). Ningún hallazgo bloquea el
merge desde el punto de vista de corrección.

---

## 1. Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 39 (9 + 6 + 17 + 10, cuatro fases) |
| Tasks complete `[x]` | 39 |
| Tasks incomplete | 0 |
| Fases marcadas completas | 4/4 |

Muestreo de cajas `[x]` contra el código (no se aceptó la palabra del apply):

| Tarea | Afirmación | Verificado en | Veredicto |
|---|---|---|---|
| 1.1 | `upsert` sobre PK compuesta funciona (open question) | `users.repository.ts:369-373` usa `upsert({ where: { userId_permissionId }, update: {} })`; test de idempotencia verde | ✅ real |
| 1.5 | exactamente 2 exports nuevos, alfabéticos, `UnknownPermissionError` NO exportado | `packages/db/index.ts:99-115`; `grep UnknownPermissionError index.ts` → sin resultados | ✅ real |
| 2.3 | 4 imports huérfanos borrados, `User` se queda | diff de `auth.service.ts`: `-type PermissionRecord/-type ProfileRecord/-type UserWithRelations/-toShopDto`; `User` sigue en `:44` y se usa en `:450` | ✅ real |
| 3.6 | guarda `Number.isInteger` en 5 métodos | `users.service.ts:94,113,142,165,211` | ✅ real |
| 3.8 | `@CurrentUser()` en `block-user` | `users.controller.ts:59-65` | ✅ real |
| 3.12 | `@Permissions` de clase en `ProfilesController`, `console.log` y bug intactos | `users.controller.ts:77-95` | ✅ real |
| 3.17 | fallback de split evaluado y NO tomado, riesgo reportado | texto presente y honesto; cifras coinciden con `git diff --stat` | ✅ real (ver §9) |
| 4.9 | nota de forward-reference en US-5 sin reescribir su scope | diff de `5-endpoints-derivados-postgres.md`: nota fechada añadida, "NO incluye" original intacto | ✅ real |
| 4.10 | US-25 y Épico 19 cerrados | `README.md` del épico: `Status: Completado`, fila US-25 `✅ Implementada` | ✅ real |

**Ninguna caja marcada de forma optimista.** Las dos desviaciones que el
apply declaró en el propio `tasks.md` (4.9 no reescribe el "NO incluye" de
US-5; 4.5 cubre auto-bloqueo y último-admin con el mismo `curl` porque con
este seed son la misma condición) están declaradas por escrito, no ocultas.

---

## 2. Build & Tests Execution

### 2.1 `just db-check` (test_command de `rules.verify`) — ✅ PASSED

```text
$ just db-check
npm run typecheck
> @safari/db@0.1.0 typecheck
> tsc --noEmit

cd "$(pwd)" && npm test
> @safari/db@0.1.0 test
> vitest run

 RUN  v4.1.11 C:/DevOps/MyGitHub/safari-marketplace/packages/db

 Test Files  8 passed (8)
      Tests  91 passed (91)
   Start at  14:13:06
   Duration  3.93s
```

**91/91 en 8 archivos**, exactamente el número esperado (baseline previa 84 →
+7 tests de `users.integration.test.ts`). Typecheck limpio.

### 2.2 `cd apps/api/rest && npx jest` — ✅ PASSED

```text
PASS src/shops/shops.service.spec.ts (7.885 s)
PASS src/users/user-dto.mapper.spec.ts (7.889 s)
PASS src/products/products.service.spec.ts (8.358 s)
PASS src/users/users.service.spec.ts (8.543 s)

Test Suites: 4 passed, 4 total
Tests:       65 passed, 65 total
Snapshots:   0 total
Time:        12.487 s
```

**4 suites / 65 tests**, el número esperado (baseline 33 → +8 de
`user-dto.mapper.spec.ts` y +24 de `users.service.spec.ts`).

### 2.3 `just build-api` — ✅ PASSED

```text
$ just build-api
yarn build
$ rimraf dist
$ nest build
Done in 20.80s.
```

### 2.4 `just build` (build_command de `rules.verify`) — ❌ EJECUTADO Y FALLA, causa PREEXISTENTE

Se ejecutó de verdad (primera vez en la historia SDD de este repo: los 9
verify-reports archivados lo declaran "no ejecutado / inaplicable").

```text
$ just build
...
> Export encountered errors on following paths:
	/shops/[slug]: /en/shops/launchidea
	/shops/[slug]: /en/shops/noaw
	/shops/[slug]: /en/shops/tetetetet
error Command failed with exit code 1.
error: recipe `build-shop` failed on line 151 with exit code 1
EXIT=1
```

**Causa raíz identificada, y NO es de este cambio.** El prerender de
`/shops/[slug]` revienta con `TypeError: Cannot read properties of undefined
(reading 'length')` para exactamente las 3 tiendas cuyo `settings` sale
vacío de Postgres:

```text
$ curl -s http://localhost:9001/api/shops/launchidea   (idem noaw, tetetetet)
   settings keys:            (objeto vacío {})
   settings.socials: undefined
   address:          {}
```

Las otras 9 tiendas del seed (`medicine`, `gadget`, `books-shop`, …)
prerenderizan bien. La cadena que falla es
`apps/shop` → `/api/shops/:slug` → `shops.service.ts` → filas de `shops` del
seed. **Ninguno de esos tres eslabones aparece en `git diff main..HEAD`**
(los únicos archivos de producción tocados son `auth.service.ts`,
`users.controller.ts`, `users.service.ts`, `user-dto.mapper.ts`,
`users.repository.ts` y `packages/db/index.ts`). Es deuda del Épico de
tiendas/catálogo, no una regresión de US-25.

Registro como **WARNING repo-level, no como fallo del change**. El build que
sí compila el código tocado (`just build-api`) está verde en §2.3.

### 2.5 `just verify` — NO ejecutado (justificado, no se infiere pass)

`just verify` es liveness (cuenta product-cards en los 3 servicios); **no
prueba ningún CA de US-25** y exige levantar shop+admin. El apply lo corrió
en la Fase 4 con los 3 servicios reales (`apply-progress.md:525-548`). Aquí
se sustituyó por evidencia HTTP directa y mucho más fuerte (§4), y además el
`.next` de `apps/shop` quedó con artefactos de build de producción tras
§2.4, lo que forzaría una recompilación completa. **No se declara pass; se
declara omitido.**

### 2.6 Coverage

`coverage_threshold: 0` y `coverage_command: ""` → ➖ no aplicable.

---

## 3. Veredicto por criterio de aceptación

| CA | Enunciado | Veredicto | Evidencia |
|---|---|---|---|
| **CA-1** | Listado paginado desde la base + búsqueda por texto | ✅ **PASS** | §4.1, §4.2 |
| **CA-2** | Las 5 listas por rol filtran por el permiso correcto | ✅ **PASS** (cifras 1/2/3/0/0) | §4.3 |
| **CA-3** | Detalle con perfil/permisos/tiendas; 404 en id inexistente y no numérico | ✅ **PASS** | §4.4 |
| **CA-4** | `block`/`unblock` persisten con efecto real; `make-admin` concede `super_admin` | ✅ **PASS** | §4.5, §4.6 |
| **CA-5** | Todo el módulo exige permiso admin (401 sin token, 403 con `customer`) | ✅ **PASS** (16 rutas, `profiles` incluido) | §4.7 |
| **CA-6** | Contratos preservados; `users.json` + `fuse.js` fuera del servicio | ✅ **PASS** | §4.8, §4.9 |

**6/6 CA cumplidos.** Ver §5 para los 6 puntos de riesgo que el prompt pidió
confirmar de forma independiente: los 6 se confirman.

---

## 4. Evidencia HTTP (API real + Postgres real)

Login: `POST /api/token {admin@demo.com/demodemo}` → `HTTP 201`,
`permissions: ["super_admin","customer","store_owner"]`.

### 4.1 CA-1 — envoltorio de paginación intacto

```text
$ GET /api/users                          HTTP 200
keys: data,total,current_page,count,last_page,firstItem,lastItem,per_page,
      first_page_url,last_page_url,next_page_url,prev_page_url
total=3 count=3 per_page=30 (number) current_page=1 last_page=1 firstItem=0 lastItem=2
ids: 1,2,3   |  claves por ítem: 15
first_page_url = "http://localhost:5000/api/users?limit=30&page=1"

$ GET /api/users?limit=1&page=2           HTTP 200
  per_page       = "1"  (string)     <-- pass-through crudo
  current_page   = 2    (number)     <-- coercionado
  last_page      = 3    (number)
  first_page_url = "http://localhost:5000/api/users?limit=1&page=1" (string)
  last_page_url  = "http://localhost:5000/api/users?limit=1&page=3" (string)
  next_page_url  = "http://localhost:5000/api/users?limit=1&page=3" (string)
  prev_page_url  = "http://localhost:5000/api/users?limit=1&page=2" (string)  <-- apunta a la página ACTUAL (rareza del mock, preservada)
```

Contraste con un call site de `paginate()` que sigue siendo mock, para
probar que el envoltorio de `buildPaginator` es indistinguible:

```text
$ GET /api/tags?limit=2&page=2            HTTP 200
keys: data,total,current_page,count,last_page,firstItem,lastItem,per_page,
      first_page_url,last_page_url,next_page_url,prev_page_url
  per_page       = "2"  (string)
  current_page   = 2    (number)
  prev_page_url  = "http://localhost:5000/api/tags?limit=2&page=2"  <-- misma rareza
```

Mismas 12 claves, mismo orden, mismos tipos. ✅

### 4.2 CA-1 — búsqueda por nombre o email, insensible a mayúsculas

```text
?text=admin              HTTP 200 total=1 ids=3:Jhon Doe/admin@demo.com
?text=ADMIN              HTTP 200 total=1 ids=3:Jhon Doe/admin@demo.com     <-- case-insensitive
?text=customer@demo.com  HTTP 200 total=1 ids=2:Customer/customer@demo.com  <-- filtra por email
?text=Customer           HTTP 200 total=1 ids=2:Customer/customer@demo.com  <-- filtra por nombre
?search=name:Store       HTTP 200 total=1 ids=1:Store Owner/store_owner@demo.com  <-- parseSearch
?text=zzznope            HTTP 200 total=0 ids=
```

### 4.3 CA-2 — las 5 listas por rol, con las cifras REALES del seed

```text
admin/list      HTTP 200 total=1 count=1 current_page=1 last_page=1 firstItem=0  lastItem=0  ids=3
vendors/list    HTTP 200 total=2 count=2 current_page=1 last_page=1 firstItem=0  lastItem=1  ids=1,3
customers/list  HTTP 200 total=3 count=3 current_page=1 last_page=1 firstItem=0  lastItem=2  ids=1,2,3
my-staffs       HTTP 200 total=0 count=0 current_page=0 last_page=0 firstItem=-30 lastItem=-1 ids=
all-staffs      HTTP 200 total=0 count=0 current_page=0 last_page=0 firstItem=-30 lastItem=-1 ids=
```

Control contra la base, para probar que las cifras son el dato y no un fallo
de filtro:

```text
$ psql: select u.id,u.email,string_agg(p.name,',') ...
  1 | store_owner@demo.com | customer,store_owner
  2 | customer@demo.com    | customer
  3 | admin@demo.com       | customer,store_owner,super_admin
```

1 con `super_admin`, 2 con `store_owner`, 3 con `customer`, 0 con `staff`.
**`1/2/3/0/0` es correcto; el "1 por lista" del texto de US-25 (línea 33 y
CA-2) es el error.** El apply ya lo declaró en la DoD y en `design.md`; esta
verificación lo confirma de forma independiente contra el seed.

Cada ítem trae `profile` y `permissions[]` (requisito de la capability, el
admin renderiza avatar + chips):

```text
users            id1 profile=obj perms=2 shops=12 | id2 profile=obj perms=1 shops=0 | id3 profile=obj perms=3 shops=0
admin_list       id3 profile=obj perms=3 shops=0
vendors_list     id1 profile=obj perms=2 shops=12 | id3 profile=obj perms=3 shops=0
customers_list   id1 profile=obj perms=2 shops=12 | id2 profile=obj perms=1 shops=0 | id3 profile=obj perms=3 shops=0
```

### 4.4 CA-3 — detalle, key-set idéntico a `/me`, y los tres 404

```text
GET /api/users/3      HTTP 200
GET /api/me           HTTP 200
GET /api/users/99999  HTTP 404 {"statusCode":404,"message":"No existe un usuario con id 99999.","error":"Not Found"}
GET /api/users/abc    HTTP 404 {"statusCode":404,"message":"No existe un usuario con id NaN.","error":"Not Found"}
GET /api/users/1.5    HTTP 404 {"statusCode":404,"message":"No existe un usuario con id 1.5.","error":"Not Found"}

users/3 keys (15): id,name,email,email_verified_at,created_at,updated_at,is_active,
                   shop_id,email_verified,profile,permissions,wallet,shops,last_order,address
/me     keys (15): id,name,email,email_verified_at,created_at,updated_at,is_active,
                   shop_id,email_verified,profile,permissions,wallet,shops,last_order,address
mismo conjunto Y mismo orden: true

u3.profile keys      = id,avatar,bio,socials,contact,notifications,customer_id,created_at,updated_at
u3.permissions[0]    = id,name,guard_name,created_at,updated_at,pivot
u3.shops.length      = 0   (V-3 declarada: el mock traía 9)
```

`/api/users/abc` era el 500 histórico y ahora es 404 (V-9). ✅

### 4.5 CA-4 — `block-user` / `unblock-user` con efecto real y sin invertir

```text
-- DB antes:                            id 2 | is_active = t
POST /api/users/block-user {id:2}       HTTP 201  is_active en respuesta: 0  (15 claves)
-- DB:                                  id 2 | is_active = f
POST /api/token (customer bloqueado)    HTTP 401                        <-- CA-4 / CA-2 de US-22
POST /api/users/block-user {id:2} (2ª)  HTTP 201  is_active: 0          <-- NO invierte
-- DB:                                  id 2 | is_active = f
POST /api/users/unblock-user {id:2}     HTTP 201  is_active: 1
-- DB:                                  id 2 | is_active = t
POST /api/token (customer)              HTTP 201                        <-- vuelve a entrar
```

Guardas 409 y 404 de escritura:

```text
POST /api/users/block-user {id:3}  (el admin a sí mismo)  HTTP 409 {"message":"No puedes bloquearte a ti mismo."}
POST /api/users/block-user   {id:99999}    HTTP 404
POST /api/users/unblock-user {id:99999}    HTTP 404
POST /api/users/block-user   {id:"abc"}    HTTP 404      <-- no 500
POST /api/users/unblock-user {id:"abc"}    HTTP 404      <-- no 500
POST /api/users/make-admin {user_id:"99999"} HTTP 404
POST /api/users/make-admin {user_id:"abc"}   HTTP 404    <-- no 500
POST /api/users/make-admin {}                HTTP 404    <-- body vacío, no 500
PUT  /api/users/99999                        HTTP 404
```

### 4.6 CA-4 — `make-admin` concede `super_admin`, es idempotente, y D-5 se cumple

```text
-- pivote super_admin del usuario 2, antes:                 0
-- token VIEJO de customer, GET /api/users (antes):         HTTP 403
POST /api/users/make-admin {"user_id":"2"}                  HTTP 201
   permisos en la respuesta: customer,super_admin  (15 claves)
POST /api/users/make-admin {"user_id":"2"}  (2ª vez)        HTTP 201
-- pivote super_admin del usuario 2, después:               1     <-- idempotente, sin fila duplicada
-- D-5: token VIEJO, GET /api/users                         HTTP 403   <-- el permiso NO entra al JWT ya emitido
-- login NUEVO: perms del token = ["customer","super_admin"]
-- GET /api/users con el token NUEVO                        HTTP 200   <-- entra tras re-login
-- estado del seed REVERTIDO (DELETE 1); permisos finales 1|customer,store_owner  2|customer  3|customer,store_owner,super_admin
```

`PermissionsGuard.canActivate` es **síncrono** y `: boolean`, sin ninguna
llamada a `@safari/db` (`permissions.guard.ts:31-58`), y ese archivo NO
aparece en el diff. D-5 confirmado: no se añadió lookup a la base para
disimular el retardo. ✅

### 4.7 CA-5 — 401 sin token / 403 con token `customer`, los 7 grupos

```text
ROUTE                                      NO_TOKEN   CUSTOMER
GET    /users                              401        403
GET    /users/3                            401        403
POST   /users                              401        403
PUT    /users/3                            401        403
DELETE /users/3                            401        403
POST   /users/block-user                   401        403
POST   /users/unblock-user                 401        403
POST   /users/make-admin                   401        403
POST   /profiles                           401        403      <-- el hueco que dejó US-23
PUT    /profiles/3                         401        403      <-- cerrado
DELETE /profiles/3                         401        403      <-- cerrado
GET    /admin/list                         401        403
GET    /vendors/list                       401        403
GET    /customers/list                     401        403
GET    /my-staffs                          401        403
GET    /all-staffs                         401        403
```

16/16 rutas de los 7 grupos. Recuento estructural independiente del
inventario de `authorization-guards-api` (parser propio sobre los
`*.controller.ts`):

```text
rutas HTTP totales:                250
con @Public():                      67   (64 públicas + 3 web-hook del bucket "Especial")
con @Permissions():               120   <-- el delta spec pide exactamente 120 (antes 117)
sin anotar (token válido basta):   63
suma:                             250
```

El delta de `authorization-guards-api` cuadra al número. ✅

### 4.8 CA-6 — `getUsersNotify` / `store-notices` sigue vivo (el riesgo #1 del change)

Nest arrancó sin error de inyección ("Nest application successfully
started"), lo que ya prueba que la segunda instancia de `UsersService` de
`StoreNoticesModule` (`store-notices.module.ts:8`, sin importar
`UsersModule`) sigue resolviéndose — `UsersService` no tiene constructor
(`users.service.ts:39-40`, D-E respetado).

```text
GET /api/store-notices/getUsersToNotify            HTTP 200  array plano, len=3, 15 claves/ítem
GET /api/store-notices/getUsersToNotify?limit=5    HTTP 200  array plano, len=3, 15 claves/ítem
GET /api/store-notices/getUsersToNotify?limit=abc  HTTP 200  array plano, len=3, 15 claves/ítem
GET /api/store-notices/getUsersToNotify?limit=0    HTTP 200  array plano, len=3, 15 claves/ítem
```

Cero 500 en los cuatro bordes. `store-notices/*` no aparece en el diff. ✅

### 4.9 CA-6 — sin mock huérfano

```text
$ grep -rn "users.json|Fuse|fuse.js" apps/api/rest/src/users/
user-dto.mapper.ts:64:  * el mismo orden que publicaba `users.json`.        <-- comentario
users.service.spec.ts:8: * ... deja de leer `users.json` y                  <-- comentario

$ grep -rln "users.json" apps/api/rest/src/
payment-method/payment-method.service.ts   <-- solo un comentario (:157), no un import
users/user-dto.mapper.ts                   <-- comentario
users/users.service.spec.ts                <-- comentario
```

**Cero imports de `users.json` y cero índices de `fuse.js` en todo el
módulo** (ni, de hecho, en toda la API). `fuse.js` sigue en uso en otros 20
servicios mock (`orders`, `tags`, `ownership-transfer`, `store-notices`, …),
fuera del alcance de esta US. El archivo mock
`src/db/pickbazar/users.json` se deja en disco sin borrar — correcto, US-25
no pide eliminarlo.

### 4.10 D-2 — el hash de contraseña no sale por ninguna respuesta

```text
users.json           clean     (GET /api/users)
admin_list.json      clean
vendors_list.json    clean
customers_list.json  clean
u3.json              clean     (GET /api/users/3)
me.json              clean     (GET /api/me)
```

Sonda: literal `password` (case-insensitive), clave `passwordHash`/
`password_hash`, y patrón de hash bcrypt `$2[aby]$`. Control positivo — los
hashes SÍ están en la base:

```text
$ psql: select id, left(password_hash,7) from users order by id;
  1 | $2b$10$
  2 | $2a$10$
  3 | $2a$10$
```

### 4.11 Stubs declarados: siguen siendo stubs (incluido el bug preexistente)

```text
POST /api/users {email nuevo}          HTTP 201  id=74 keys=15 perms=customer profile=null address=[]
POST /api/users {mismo email}          HTTP 409  {"message":"Ya existe un usuario con el email verify-probe-us25@example.com."}
PUT  /api/users/2 {"name":"NOMBRE CAMBIADO"}   HTTP 200  name devuelto: "Customer"
   -- DB: id 2 | name = Customer                        <-- NO persiste (A11)
DELETE /api/users/2                    HTTP 200  "This action removes a #2 user"
   -- DB: count(users where id=2) = 1                   <-- stub inerte
DELETE /api/profiles/2                 HTTP 200  "This action removes a #2 user"   <-- BUG PREEXISTENTE
   -- DB: users=4 (3 seed + sonda), profiles=3          <-- inerte, no borra nada
-- limpieza de la sonda: DELETE 1; estado final users=3, profiles=3, permission_user=6 (seed intacto)
```

El bug de `DELETE /profiles/:id` (llama `usersService.remove(id)`,
`users.controller.ts:92-95`) **sigue presente, documentado en `design.md`
D-G y en el spec, y no corregido** — exactamente como el "NO incluye" exige.

### 4.12 Bordes de `limit`/`page` (V-6, V-10): ningún 5xx

```text
?limit=0    HTTP 200 per_page="0"(string)  current_page=1  total=3 count=3 ids=1,2,3
?limit=-1   HTTP 200 per_page="-1"(string) current_page=-3 total=3 count=1 ids=3
?limit=abc  HTTP 200 per_page="abc"(string) current_page=1 total=3 count=3 ids=1,2,3
?page=abc   HTTP 200 per_page=30(number)   current_page=1  total=3 count=3 ids=1,2,3
?page=999   HTTP 200 per_page=30(number)   current_page=1  total=3 count=0 ids=
```

`current_page=-3` con `?limit=-1` no es una divergencia nueva: `paginate()`
calcula `Math.ceil(3/-1) = -3` y clampa igual (`paginate.ts:13-20` ≡
`pagination.ts:39-44`). Lo único que cambia es el número de filas (1 vs 2),
ya declarado en V-10.

---

## 5. Los 6 puntos de riesgo del prompt, confirmados de forma independiente

| # | Punto | Resultado | Cómo se probó |
|---|---|---|---|
| 1 | `per_page` STRING en las 6 rutas paginadas; `buildPaginator` recibe `baseUrl` → las 4 `*_page_url` son strings | ✅ **CONFIRMADO** | §4.1 en vivo: `per_page="1"`/`"2"`/`"0"`/`"-1"`/`"abc"` string, `30` number sin query — idéntico a `/api/tags` (mock). Con multipágina las 4 URLs son strings. `current_page` siempre number. La revocación de US-2 no se repite. |
| 2 | Las 4 guardas numéricas D-B aguantan en runtime | ✅ **CONFIRMADO** | `/api/users/abc` → 404 (§4.4); `getUsersToNotify?limit=5\|abc\|0` → 200 array plano (§4.8); `make-admin` con `user_id` string `"2"` → 201 (§4.6) y `"abc"`/vacío → 404 (§4.5). Cero 500. |
| 3 | `my-staffs` y `all-staffs` filtran `staff` pero conservan `url` distinta | ✅ **CONFIRMADO** | §4.3: `.../my-staffs/list?limit=30&page=1` vs `.../all-staffs/list?limit=30&page=1`; ambas `total=0` con el clamp `current_page:0/last_page:0/lastItem:-1`. Reforzado por unit test (`users.service.spec.ts:146`). |
| 4 | D-2: ni `password_hash` ni `passwordHash` en ninguna respuesta | ✅ **CONFIRMADO** | §4.10, sobre lista, detalle y `/me`, con control positivo en la base. |
| 5 | `make-admin` no aplica hasta el siguiente login; el guard no consulta la base | ✅ **CONFIRMADO** | §4.6: token viejo 403 / token nuevo 200; `permissions.guard.ts` síncrono, sin imports de `@safari/db`, y **ausente del diff**. |
| 6 | `store-notices` sigue funcionando; `UsersService` sin dependencias de constructor | ✅ **CONFIRMADO** | §4.8: Nest arranca, los 4 bordes de `getUsersToNotify` dan 200 con array plano. `UsersService` no declara constructor. `store-notices/*` sin tocar. |

---

## 6. Spec Compliance Matrix

Runtime = test que corrió y pasó en esta sesión. HTTP = `curl` real de §4.

### `user-management-api`

| Requirement | Scenario | Cobertura | Result |
|---|---|---|---|
| Listado paginado (CA-1) | Envoltorio completo + usuarios reales | `users.service.spec.ts:102` (compara clave a clave y por TIPO contra el `paginate()` REAL) + HTTP §4.1 | ✅ COMPLIANT |
| Listas por rol (CA-2) | Los 5 `total` = 1,2,3,0,0, `profile`/`permissions` presentes, `url` propia | `users.service.spec.ts:135,146,166` + HTTP §4.3 | ✅ COMPLIANT |
| Detalle 15 claves (CA-3) | Key-set idéntico a `/me`, 404, sin hash | `users.service.spec.ts:223,231,238`; `user-dto.mapper.spec.ts:50` + HTTP §4.4, §4.10 | ✅ COMPLIANT |
| Bloqueo/promoción + guardas (CA-4) | Dos bloqueos no reactivan; login 401 | `users.service.spec.ts:264,283` + HTTP §4.5 | ✅ COMPLIANT |
| " | Auto-bloqueo y último `super_admin` → 409 | `users.service.spec.ts:310,317,340` (con contraejemplo de >1 admin) + HTTP §4.5 (auto-bloqueo) | ⚠️ **PARTIAL** — ver WARNING-2 |
| " | `make-admin` concede pero no antes del re-login | `users.service.spec.ts:380` + HTTP §4.6 (ida y vuelta completa) | ✅ COMPLIANT |
| Creación real; update/delete stubs | Crea + 409 duplicado | `users.service.spec.ts:405,429` + HTTP §4.11 | ✅ COMPLIANT |
| " | `PUT` no persiste | `users.service.spec.ts:469` + HTTP §4.11 (comprobado contra la base) | ✅ COMPLIANT |
| Módulo exige permiso admin (CA-5) | `customer` → 403 en `/users` y `/profiles` | HTTP §4.7, 16/16 rutas | ✅ COMPLIANT |
| Contratos preservados (CA-6) | `getUsersNotify` sigue sirviendo a `store-notices` | `users.service.spec.ts:186,197,208` + HTTP §4.8 | ✅ COMPLIANT |

### `identity-data-layer`

| Requirement | Scenario | Cobertura | Result |
|---|---|---|---|
| `listUsersWithRelations` | Filtro por permiso trae relaciones incluidas | `users.integration.test.ts:20,34` (Postgres real) | ✅ COMPLIANT |
| " | Permiso sin titulares → `{items:[],total:0}` | `users.integration.test.ts:43` | ✅ COMPLIANT |
| `grantPermission` idempotente | Concede un permiso nuevo | `users.integration.test.ts:58` | ✅ COMPLIANT |
| " | Repetir no duplica fila en `permission_user` | `users.integration.test.ts:73` + HTTP §4.6 (pivote = 1 tras 2 llamadas) | ✅ COMPLIANT |
| " | Permiso fuera del catálogo → error de dominio | `users.integration.test.ts:95` | ✅ COMPLIANT |
| Cuatro escrituras de la capability | El barrel exporta exactamente 4 | `packages/db/index.ts:99-115` → `createUser`, `grantPermission`, `setUserActive`, `updateUserPasswordHash` | ✅ COMPLIANT |

### `authorization-guards-api`

| Requirement | Scenario | Cobertura | Result |
|---|---|---|---|
| 250 rutas en 4 buckets (120 con permiso, 3 especiales) | El inventario cuadra | Parser estructural §4.7: 250 = 67 `@Public` + 120 `@Permissions` + 63 sin anotar | ✅ COMPLIANT |
| " | Webhook responde sin token, `profiles` no | HTTP §4.7 (`/profiles` → 401 sin token) | ✅ COMPLIANT |
| " | `profiles` con `customer` → 403, con admin no rechazado | HTTP §4.7 y §4.11 | ✅ COMPLIANT |
| 120 rutas admin exigen su permiso | `customer` → 403 | HTTP §4.7 | ✅ COMPLIANT |
| (Nota de alcance) `/me` sin regresión de key-set | §4.4: mismo conjunto Y mismo orden de 15 claves que `/api/users/3`; `just build-api` limpio | ✅ COMPLIANT |

**Compliance summary: 22/23 escenarios COMPLIANT, 1 PARTIAL (declarado en el
propio spec y en `tasks.md` 4.5). 0 FAILING, 0 UNTESTED.**

---

## 7. Coherence (Design)

| Decisión | ¿Seguida? | Notas |
|---|---|---|
| D-A mapper en módulo neutral, refactor puro | ✅ Sí | `user-dto.mapper.ts` nuevo; `auth.service.ts` solo repunta imports y `toMeDto`→`toUserDto`. Los 4 imports huérfanos borrados, `User` conservado. |
| D-B triple camino `page`/`limit` | ✅ Sí | `users.service.ts:271-301`. Confirmado en vivo (§4.1, §4.12) y por el test que compara contra `paginate()` real. |
| D-C `listUsersWithRelations` sin N+1 | ✅ Sí | Un `findMany` + un `count`, `_usersWhere` compartido con `listUsers` (`users.repository.ts:193-263`). |
| D-D `grantPermission` idempotente, `UnknownPermissionError` no exportado | ✅ Sí | `upsert({update:{}})` sobre la PK compuesta; clase no exportada ni del archivo ni del barrel. |
| D-E `UsersService` sin dependencias de constructor | ✅ Sí | Sin constructor; Nest arranca; `store-notices` responde 200. |
| D-F códigos 401/403/404/409/503/500 | ✅ Sí | Los 6 caminos comprobados en §4.5, §4.7 y por unit test (503/500 en `users.service.spec.ts:441,455`). |
| D-G `ProfilesController` anotado, `console.log` y bug intactos | ✅ Sí | §4.7 y §4.11. |
| D-H `make-admin` por `@Body`, sin lookup en el guard | ✅ Sí | `users.controller.ts:70-73`; guard sin cambios. |
| V-1…V-10 (divergencias declaradas) | ✅ Todas observadas tal como se declararon | Ninguna divergencia NO declarada encontrada. |

Divergencias observadas y **ya declaradas** (no se reportan como defectos):
`created_at`/`updated_at` (V-1), normalización a 15 claves (V-2),
`users/3` con `shops: []` (V-3, confirmado: `shops.length=0`), orden
`[1,2,3]` (V-4, confirmado), búsqueda `contains` (V-5), `?page=abc` →
`current_page:1` (V-6), `my-staffs ≡ all-staffs` (V-7), `POST /users`
ignora `permission`/`profile`/`address` (V-8, confirmado: `perms=customer`,
`profile=null`, `address=[]`), `/users/abc` → 404 (V-9), bordes de `limit`
(V-10). Los 17 errores CRLF de biome en `packages/db` son preexistentes y no
forman parte de `just db-check` (§2.1 verde).

---

## 8. Scope compliance

`git diff --name-only main..HEAD` → 20 archivos, ninguno prohibido:

```text
apps/api/rest/src/auth/auth.service.ts
apps/api/rest/src/users/user-dto.mapper.spec.ts
apps/api/rest/src/users/user-dto.mapper.ts
apps/api/rest/src/users/users.controller.ts
apps/api/rest/src/users/users.service.spec.ts
apps/api/rest/src/users/users.service.ts
docs/product/1-catalogo-desde-postgres/5-endpoints-derivados-postgres.md
docs/product/19-autenticacion-autorizacion/25-endpoints-usuarios-postgres.md
docs/product/19-autenticacion-autorizacion/README.md
openspec/changes/endpoints-usuarios-postgres/*  (8 artefactos SDD)
packages/db/index.ts
packages/db/src/repositories/users.integration.test.ts
packages/db/src/repositories/users.repository.ts
```

```text
$ git diff --stat main..HEAD -- db/ services/ apps/shop/ apps/admin/ \
    apps/api/rest/src/store-notices/ packages/db/prisma/ justfile docker-compose.yml
(vacío)
```

| "NO incluye" de US-25 | Verificado |
|---|---|
| perfiles más allá de la tabla `profiles` de US-20 | ✅ los 3 métodos de `ProfilesController` siguen stubs (§4.11) |
| wallets, direcciones, órdenes | ✅ `wallet: null`, `address: []`, `last_order: null` constantes en el mapper |
| `ownership-transfer` | ✅ no aparece en el diff; sigue mock con `fuse.js` |
| `become-seller` | ✅ no aparece en el diff |
| cualquier cambio en el frontend | ✅ `apps/shop/` y `apps/admin/` sin tocar |
| DDL nuevo (`db/schema.sql`) | ✅ `db/` sin tocar; `packages/db/prisma/` sin tocar |
| `store-notices/*` | ✅ sin editar |
| bug de `DELETE /profiles/:id` corregido | ✅ **NO corregido**, presente y documentado (§4.11) |

**Cero scope creep.** El apply respetó incluso lo que estaba "a un import de
distancia".

---

## 9. Presupuesto de revisión — mi opinión

Cifras reales, medidas ahora:

| Slice | `git diff --shortstat` | Código de producción + test |
|---|---|---|
| PR1 `71ea86f` | 11 files, +1843 / −11 | ~199 (`users.repository.ts` +105/−16, `index.ts` +2, `users.integration.test.ts` +94); el resto son los 4 artefactos SDD |
| PR2 `b46aff5` | 5 files, +333 / −85 | ~285 (`user-dto.mapper.ts` +90, `.spec.ts` +120, `auth.service.ts` +5/−70) |
| PR3 `9b71021` | 5 files, +954 / −208 | **~965** (`users.service.ts` 452 con 281+/191−, `users.service.spec.ts` +493, `users.controller.ts` 20) |
| Fase 4 `5af928c` | 5 files, +251 / −26 | 0 (solo docs y artefactos) |

**PR3 supera el presupuesto de 400 líneas por un factor de ~2,4.** Mi
lectura, separando lo que es de gobernanza de lo que es del equipo:

- **Es defendible como está embarcado.** De las ~965 líneas, **493 son el
  spec de test nuevo** y 191 son *borrados* del mock. El código de
  producción neto que un revisor tiene que juzgar es ~281 líneas añadidas en
  un solo archivo, con una estructura muy regular (5 wrappers de 3 líneas
  sobre un helper, 5 guardas `Number.isInteger` idénticas, un
  `withPrismaErrorTranslation` calcado de dos precedentes). No es 965 líneas
  de novedad conceptual.
- **El split 3a/3b (reads/writes) preautorizado en 3.17 habría sido peor
  aquí.** `_listByPermission` (reads) y las guardas de escritura comparten el
  mismo archivo, el mismo `withPrismaErrorTranslation` y el mismo
  `users.service.spec.ts`; partirlo dejaría PR3a con un archivo a medio
  migrar (mitad `fuse.js`, mitad `@safari/db`) y un spec que no puede pasar
  entero. Eso viola el criterio de "cada slice con inicio claro, fin claro y
  verificación autónoma".
- **Lo que sí es un incumplimiento de proceso, y hay que decirlo:** la
  tarea 3.17 se marcó `[x]` con la justificación "el orquestador ya resolvió
  PR3 ONLY". Eso *explica* la decisión pero no la *autoriza* frente al guard
  de 400 líneas, que es una salvaguarda de carga cognitiva del revisor, no
  una preferencia de topología. Lo correcto habría sido pedir un
  `size:exception` explícito.
- **Recomendación (esto es tuyo de gobernanza, no del equipo):** aceptar PR3
  como `size:exception` documentado — reabrirlo para partirlo ahora costaría
  un rebase de la cadena y produciría dos PRs peores. Y cerrar el hueco de
  proceso: que `sdd-apply` no pueda marcar una tarea de tipo 3.17 sin un
  `size:exception` registrado.

---

## 10. Issues Found

### CRITICAL — Ninguno

No se encontró ningún defecto funcional. Ningún CA falla. Ninguna
divergencia no declarada. Ningún 5xx en ningún borde probado.

### WARNING

**WARNING-1 — `just build` (el `build_command` de `rules.verify`) falla, por
causa preexistente y ajena a este cambio.** `just build-shop` revienta
prerenderizando `/shops/[slug]` para `launchidea`, `noaw` y `tetetetet`, las
3 tiendas cuyo `settings` sale `{}` de Postgres →
`settings.socials` es `undefined` → `.length` de `undefined`. Los tres
eslabones de esa cadena (`apps/shop`, `shops.service.ts`, filas de `shops`
del seed) están **fuera del diff**. Es el primer verify del repo que ejecuta
`just build` de verdad (los 9 archivados lo declaran no ejecutado), así que
nunca se había visto verde. Severidad: **media, repo-level**, no bloquea
US-25. *Tuyo de gobernanza: abrir una US en el épico de tiendas/catálogo para
que `/shops/[slug]` tolere `settings` vacío (o que el seed lo rellene), y
decidir si `rules.verify.build_command` debe seguir siendo `just build`
cuando lleva 10 changes sin poder pasar.*

**WARNING-2 — la rama "último `super_admin`" del 409 solo tiene cobertura
unitaria.** Con el seed actual el único `super_admin` es el mismo admin que
ejecuta la prueba, así que auto-bloqueo y último-admin son la misma condición
HTTP observable (§4.5 devuelve el mensaje de auto-bloqueo, que se evalúa
primero en `users.service.ts:169-171`). El contraejemplo con >1 admin existe
como unit test (`users.service.spec.ts:317,340`). **Ya declarado** en
`tasks.md` 4.5, en la DoD de la US y en el spec — no está oculto, y por eso
es WARNING y no CRITICAL. Severidad: **baja**.

**WARNING-3 — el spec de CA-1 sobreafirma sobre las `*_page_url`.**
`specs/user-management-api/spec.md:14-18` dice "las 4 `*_page_url` son
strings, nunca `null`". En vivo, con una sola página `next_page_url` y
`prev_page_url` son `null` (§4.1) — igual que el mock
(`paginate.ts:66-73`: `totalPages > current_page ? url : null`) e igual que
lo que el propio `design.md` D-B documenta para el caso vacío
(`next/prev = null`). **La implementación es correcta; el texto del spec es
el que está mal.** Corregir la redacción antes del merge a
`openspec/specs/` (el `sdd-archive` lo va a copiar tal cual). Severidad:
**baja, documental**.

### SUGGESTION

1. **Comentario obsoleto en `packages/db/src/repositories/users.repository.ts:239`**:
   sigue diciendo `// Escrituras (CA-4) — exactamente tres; grantPermission es de US-25`
   justo encima de un bloque que ahora tiene cuatro, y `grantPermission` ya
   está ahí. El spec MODIFIED dice "exactamente cuatro". Una línea.
2. **`GET /api/users/abc` → `"No existe un usuario con id NaN."`** El mensaje
   filtra el detalle de implementación (`+id` → `NaN`) en vez del valor que
   el cliente envió. Cosmético; no cambia el status code ni el contrato.
3. **Registrar el `size:exception` de PR3** (§9) para que la excepción quede
   auditada en lugar de vivir solo en la prosa de `tasks.md` 3.17.
4. **Mencionados por la US y confirmados sin tocar** (contrato de reporte):
   `become-seller` y `ownership-transfer` siguen 100% mock con `fuse.js` y
   siguen tocando usuarios; son módulos aparte y una futura US.

---

## 11. Estado del entorno al cerrar

- **Seed restaurado a su estado original**: `users=3`, `profiles=3`,
  `permission_user=6`; permisos `1|customer,store_owner`, `2|customer`,
  `3|customer,store_owner,super_admin`; `is_active=t` en los 3. Se
  revirtieron a mano el `super_admin` concedido al usuario 2 (§4.6) y el
  usuario sonda `verify-probe-us25@example.com` (§4.11).
- **Servicios apagados**: `just check-ports` → `libre 9001`, `libre 3003`,
  `libre 3002`.
- **Árbol de git limpio**: `git status --short` vacío. Cero commits, cero
  push, cero código de producción tocado por esta fase. El único archivo
  escrito es este `verify-report.md`.
- Artefactos gitignored regenerados por los gates: `apps/api/rest/dist/`
  (por `just build-api`) y `apps/shop/.next/` (por el `just build` fallido).

---

## Verdict

**PASS WITH WARNINGS**

Los 6 CA de US-25 se cumplen contra Postgres y la API reales; los 3 gates
aplicables al código tocado están verdes (`just db-check` 91/91, `npx jest`
65/65, `just build-api` limpio); los 6 puntos de riesgo señalados —incluido
el `per_page` string que hizo revocar `buildPaginator` en US-2 y la segunda
instancia de `UsersService` de `store-notices`— se confirman en vivo. El
único gate rojo (`just build`) falla por datos de tiendas ajenos al diff, con
causa raíz probada. **Listo para `sdd-archive`**, corrigiendo antes la
redacción de WARNING-3 para no propagar una afirmación falsa a
`openspec/specs/`.
