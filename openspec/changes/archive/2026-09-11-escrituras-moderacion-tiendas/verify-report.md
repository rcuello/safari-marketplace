# Verification Report: Escrituras y moderación de tiendas (US-30)

> Fase `sdd-verify` ejecutada el 2026-09-11 sobre la rama
> `us-30-escrituras-moderacion-tiendas` (5 commits sobre `main`:
> `bd93185`, `cc8392f`, `50fede4`, `c401f2e`, `1aff521`; nada pusheado).
> **Toda la evidencia de este reporte fue producida por el verificador**, no
> copiada de `apply-progress.md`: los tres gates se re-corrieron, la matriz
> HTTP se rehízo contra un proceso `node dist/main` recién compilado, y la
> base se dejó restituida al baseline. Modo: `openspec`. Engram NO conectado
> — ninguna herramienta de Engram fue invocada.

**Veredicto: PASS WITH WARNINGS.** Cero defectos de código. Cuatro
advertencias, ninguna bloqueante: una de higiene de tests que degrada
silenciosamente una salvaguarda del diseño, una de proceso sobre el
presupuesto de revisión, y dos de exactitud documental.

---

## 1. Gates re-corridos por el verificador

Todos con salida real pegada. Ninguna cifra es heredada de `apply-progress.md`.

### `just db-build` (previo obligatorio — `dist/` está gitignored)

```
✔ Generated Prisma Client (7.10.0) to .\generated\prisma\client in 269ms
CJS dist\index.js     165.26 KB
CJS ⚡️ Build success in 90ms
DTS ⚡️ Build success in 6115ms
DTS dist\index.d.ts 1.40 MB
```

### `just db-check` (`rules.verify.test_command`)

```
> @safari/db@0.1.0 typecheck
> tsc --noEmit

 RUN  v4.1.11 C:/DevOps/MyGitHub/safari-marketplace/packages/db

 Test Files  10 passed (10)
      Tests  199 passed (199)
   Start at  22:27:35
   Duration  17.27s (transform 642ms, setup 0ms, import 3.72s, tests 7.04s)
```

Confirma el 199/199 declarado. `tsc --noEmit` limpio.

### `cd apps/api/rest && npx jest`

```
PASS src/shops/shops.service.spec.ts (27.346 s)
PASS src/users/user-dto.mapper.spec.ts (30.196 s)
PASS src/tags/tags.service.spec.ts (31.637 s)
PASS src/types/types.service.spec.ts (31.798 s)
PASS src/common/errors/domain-error.mapper.spec.ts (31.844 s)
PASS src/categories/categories.service.spec.ts (33.029 s)
PASS src/products/products.service.spec.ts (33.036 s)
PASS src/manufacturers/manufacturers.service.spec.ts (34.112 s)
PASS src/users/users.service.spec.ts (34.407 s)

Test Suites: 9 passed, 9 total
Tests:       239 passed, 239 total
Time:        40.666 s
```

Confirma el 239/239. `user-dto.mapper.spec.ts` verde (su grafo de módulos
cambió al quitar `@db/shops.json` de `shops.service.ts`).

### `just build-api`

```
yarn build
$ rimraf dist
$ nest build
Done in 40.19s.
```

Sin `TS2554`: los dos call sites de `StaffsController` (`DD30-8`) compilan.

### `just build` (`rules.verify.build_command`) — **hueco declarado por `sdd-apply`, cerrado aquí**

Corrido con la API arriba (la tienda prerenderiza por HTTP contra `:9001`) y
sin ningún `dev` en marcha. Exit code **0**. Cola de la salida:

```
+ First Load JS shared by all                         225 kB
  ├ chunks/framework-209d228742ce58bd.js              45.4 kB
  ├ chunks/main-f2f5686d13eeb0ad.js                   33.8 kB
  ├ chunks/pages/_app-8374d79f13339294.js             115 kB
  ├ chunks/webpack-4cec00be5f762e93.js                5 kB
  └ css/02f083bfc903d25c.css                          26.7 kB

Done in 160.85s.
[exited with code 0]
```

Ambas mitades produjeron artefacto fresco:

```
apps/shop/.next/BUILD_ID        2026-09-11 22:45:48
apps/admin/rest/.next/BUILD_ID  2026-09-11 22:49:16
```

### `just verify` — **hueco declarado por `sdd-apply`, cerrado aquí**

Levantados los tres servicios (API desde `dist/`, shop y admin en modo
producción sobre el build recién hecho):

```
OK   API    :9001/api/settings  200  5503B  346ms
OK   Shop   :3003/en  200  191804B  2623ms  cards:30
OK   Admin  :3002/en/login  200  83057B  1074ms  cards:1
```

Los `5503B` de `/api/settings` coinciden con el contrato preservado desde
US-4a. La tienda renderiza 30 product-cards reales; el admin sirve el login.

**Los tres servicios fueron detenidos al cierre** (puertos 3002/3003/9001
verificados libres con `netstat`).

---

## 2. Matriz de cumplimiento por criterio de aceptación

| CA | Requirement (`specs/shop-write-api/spec.md`) | Veredicto | Base de la evidencia |
|---|---|---|---|
| CA-1 | Creación con `owner_id` del token e `is_active` por rol | **COMPLIANT** | HTTP propio + reinicio real de proceso + vitest + jest |
| CA-2 | Edición con propiedad, slug inmutable, REPLACE de `settings` | **COMPLIANT** | HTTP propio + `psql` antes/después + vitest + jest |
| CA-3 | Aprobar/desactivar persisten; 500 → 404/400 | **COMPLIANT** | 12 sondas HTTP de borde + reinicio real + `psql` |
| CA-4 | `GET /staffs` sin JSON, mismo contrato | **COMPLIANT** | HTTP propio + verificación del lado «antes» en el JSON del mock |
| CA-5 | Matriz de roles (401/403/200) | **COMPLIANT** | 6 sondas HTTP propias + lectura de `PermissionsGuard` (caso `staff`) |
| CA-6 | Sin mock huérfano ni regresión | **COMPLIANT** | `grep` + `git diff` + conteos `psql` restituidos |
| D30-4 | `products_count` recalculado en toda escritura | **COMPLIANT** | **Evidencia nueva de esta fase** — ver § 2.7 |
| D30-9 | Cero guardas de dominio nuevas | **COMPLIANT** | `git diff` vacío en `domain-errors.ts` y `common/errors/` |

### 2.1 CA-1 — Creación con `owner_id` del token e `is_active` por rol

Sondas propias contra proceso fresco. **El `POST` llevó deliberadamente
`owner_id: 3` e `is_active: true` inyectados en el body** — un caso que
`sdd-apply` solo cubrió en jest y sobre el camino de `PUT`, nunca sobre el
`POST` por HTTP:

```
POST /shops (store_owner) {"name":"zz-tiendas-vfy-owner","owner_id":3,"is_active":true,...}
 -> id 165  owner_id 1  is_active 0  slug zz-tiendas-vfy-owner  products_count 0  nclaves 16

POST /shops (super_admin) {"name":"zz-tiendas-vfy-admin"}
 -> id 166  owner_id 3  is_active 1  slug zz-tiendas-vfy-admin

GET /new-shops  (antes) -> total 0  ids []
GET /new-shops  (después) -> total 1  ids [165]  is_active [0]
GET /shops?search=name:zz-tiendas-vfy-owner  -> total 0   (inactiva: no aparece)
GET /shops?search=name:zz-tiendas-vfy-admin  -> total 1   (activa: sí aparece)
```

`owner_id` del body **ignorado** (respondió 1, el `sub` del token, no el 3
inyectado); `is_active` del body **ignorado** (respondió 0 pese al `true`
inyectado). 16 claves y `products_count: 0` en la respuesta de creación.

**Supervivencia a un reinicio REAL del proceso**, no a un `nodemon`:

```
PID viejo de la API: 61696 -> Stop-Process -Force -> puerto 9001 libre
PID nuevo de la API: 51108  (distinto)

GET /shops/zz-tiendas-vfy-owner -> id 165  is_active 1  (aprobada antes del reinicio)
```

El escenario delta de `derived-catalog-api` («la cola se puebla tras una
creación de `store_owner`») queda probado en la misma corrida: `total` subió
exactamente en 1 sin código nuevo en esa capability.

### 2.2 CA-2 — Edición con propiedad, slug inmutable, REPLACE de `settings`

```
PUT /shops/166 (store_owner user 1, tienda de owner 3)
 -> 403 {"statusCode":403,"message":"No tienes permisos sobre la tienda 166.","error":"Forbidden"}
PUT /shops/166 (super_admin, misma tienda)      -> 200
PUT /shops/999999 (super_admin, id inexistente) -> 404   (404 antes que 403: el rol no cambia el status)
PUT /shops/abc    (super_admin, id no entero)   -> 404
```

Slug invariante tras renombrar:

```
PUT /shops/165 {"name":"zz-tiendas-vfy-owner-RENOMBRADA","logo":null}
 -> name  zz-tiendas-vfy-owner-RENOMBRADA
    slug  zz-tiendas-vfy-owner      (sin cambio)
```

**`D30-1` — la pérdida de `shopMaintenance` se DEMUESTRA, no se oculta.**
Leída directamente de la columna de Postgres, no de la respuesta HTTP:

```
-- antes (la tienda se creó con shopMaintenance poblado)
SELECT settings FROM shops WHERE id=165;
 {"contact": "555-AAA", "shopMaintenance": {"isUnderMaintenance": true}}

-- PUT de super_admin con settings SIN shopMaintenance -> 200
PUT /shops/165 {"settings":{"contact":"555-BBB"}}

-- después
SELECT settings FROM shops WHERE id=165;
 {"contact": "555-BBB"}
```

`shopMaintenance` **desaparece de la fila**. Es exactamente la pérdida que
`D30-1` ratificó y que la DoD exigía hacer visible. La evidencia la expone,
no la esquiva: se observa en `psql`, sobre la fila real, no en un `toEqual`
de la respuesta. **Open item 3: CONFIRMADO.**

`near-by-shop` con `location` nuevo:

```
PUT /shops/166 {"settings":{"location":{"lat":38.9,"lng":-77.02,...}}} -> 200
GET /near-by-shop/38.9/-77.02
 -> 166:zz-tiendas-vfy-admin:0 | 6:grocery-shop:0.371... | 1:furniture-shop:324.42...
```

*Matiz de evidencia*: mi sonda HTTP de `logo: null` corrió sobre una tienda
cuyo `logo` ya era `null`, así que no distingue no-op de escritura. El caso
fuerte sí está cubierto en vitest
(`shops.integration.test.ts:360`, con `logo`/`coverImage` poblados y un
tercer campo del mismo `PUT` que sí escribe). No es un hueco.

### 2.3 CA-3 — Moderación persistente y corrección 500 → 404/400

`approve-shop` con `admin_commission_rate: 42` en el body (aceptado e
ignorado, sin 400): `is_active 1`, 16 claves. Tras el reinicio real de
proceso: sigue en 1. `disapprove-shop`: la fila vuelve a `f` en `psql`.

**Batería completa de bordes — 12 llamadas, CERO respuestas 500:**

```
approve-shop {"id":99999}  -> 404  "No existe un registro de `shops` con id 99999."
approve-shop {"id":"abc"}  -> 400  "El id de la tienda debe ser un entero positivo, recibido: \"abc\"."
approve-shop {"id":true}   -> 400  "... recibido: true."
approve-shop {"id":0}      -> 400  "... recibido: 0."
approve-shop {"id":null}   -> 400  "... recibido: null."
approve-shop {"id":[]}     -> 400  "... recibido: []."
approve-shop {"id":{}}     -> 400  "... recibido: {}."
approve-shop {"id":1e21}   -> 400  "... recibido: 1e+21."

disapprove-shop {"id":99999} -> 404
disapprove-shop {"id":"abc"} -> 400
disapprove-shop {"id":true}  -> 400
disapprove-shop {"id":0}     -> 400
```

**`{"id":true}` NO moderó la tienda 1 — comprobado más fuerte que en
`apply-progress.md`.** Aquel solo releyó `is_active`; aquí se compara
también `updated_at`, que el trigger `shops_updated_at` movería ante
*cualquier* `UPDATE`:

```
-- antes de las 12 sondas
 id | slug           | is_active | updated_at
  1 | furniture-shop | t         | 2026-09-02 15:33:36.102816+00

-- después de las 12 sondas
  1 | furniture-shop | t         | 2026-09-02 15:33:36.102816+00
```

`updated_at` inalterado ⇒ no hubo `UPDATE` alguno sobre la fila 1. El
estrechamiento por `typeof` de `DD30-3` funciona: `Number(true) === 1` nunca
llega a evaluarse. `1e21` confirma además que la guarda usa
`Number.isSafeInteger` y no `Number.isInteger`.

### 2.4 CA-4 — `GET /staffs` sin JSON, mismo contrato

```
GET /staffs?shop_id=9&limit=15
keys: data,total,current_page,count,last_page,firstItem,lastItem,per_page,
      first_page_url,last_page_url,next_page_url,prev_page_url
nkeys 12 | data [] | per_page "15" typeof string
```

**El lado «antes» se verificó de forma independiente**, no por lectura del
código como hizo `sdd-apply`. Se inspeccionó el JSON del mock:

```
shops en el JSON: 9
ids: 11,9,7,6,5,4,3,2,1
staffs no vacios: []
sin clave staffs: [11,9,7,6,5,4,3,2,1]
```

El código anterior era
`this.shops.find(p => p.id === Number(shop_id))?.staffs ?? []`. Para
**cualquier** `shop_id` —presente en el JSON, ausente de él (12/14/15), o no
enviado— el resultado era `[]`, y los cuatro argumentos de `paginate()` eran
`(0, page, limit, 0)` con la misma `url`. El código nuevo pasa
`paginate(0, page, limit, 0, url)` literalmente. Observacionalmente
idénticos en todo el dominio de entrada. `per_page` sigue siendo el `limit`
crudo (`string`), sin coerción.

> **Corrección factual (no defecto):** tanto el «Contexto» de la US como
> `apply-progress.md` § 5.3 afirman que «`shops.json` trae `staffs: []` en
> las 9 tiendas». La clave **no existe** en ninguna de las 9 entradas; quien
> produce el `[]` es el `?? []`. La conclusión (contrato preservado) es
> correcta; el mecanismo descrito, no.

### 2.5 CA-5 — Matriz de permisos

Reproducida por HTTP:

```
POST /shops   sin token           -> 401
POST /shops   customer            -> 403  "No tienes permisos suficientes para esta operación."
POST /shops   store_owner propio  -> 201  (id 165)
POST /shops   super_admin         -> 201  (id 166)
PUT  /shops/:id store_owner dueño -> 200
PUT  /shops/:id super_admin       -> 200
approve-shop  store_owner         -> 403
approve-shop  customer            -> 403
```

**El caso `staff`: NO se reprodujo, y fue una decisión deliberada.** No
existe cuenta demo con permiso `staff` y esta fase no muta la base para
fabricar una. En su lugar se resolvió por lectura de código, que en este
caso es una prueba más fuerte que una sonda:

- `permissions.decorator.ts:21` → `ADMIN_AND_OWNER = ['super_admin', 'store_owner']`.
  `staff` no está en la lista. `permissions.decorator.ts:20` →
  `ADMIN_ONLY = ['super_admin']`.
- `PermissionsGuard.canActivate` es una intersección de conjuntos pura:
  `required.some(p => request.user.permissions.includes(p))`, **sin ninguna
  rama por rol**. No hay línea que trate `staff` distinto de `customer`.
- El 403 de `customer` **sí** se observó empíricamente, y recorre
  exactamente esa misma línea.

Por tanto `staff`-solo → 403 en `POST`/`PUT /shops` es una consecuencia
estructural del mismo código path ya ejercitado, no una inferencia sobre
código no probado.

**Open item 4 — juicio sobre la mutación manual de `permission_user`: NO
debilita la evidencia de CA-5.** Tres razones:

1. La reversión es exacta, verificada por el verificador de forma
   independiente contra `db/seed.sql:81-88`. La base tiene 6 filas y son
   fila-por-fila las 6 del seed:
   ```
    user_id |    name        (seed: (3,1)(3,2)(3,3)(2,2)(1,2)(1,3))
          1 | customer
          1 | store_owner
          2 | customer
          3 | super_admin
          3 | customer
          3 | store_owner
   ```
   Cero rastro del `(2,4)` temporal.
2. La garantía no dependía de esa sonda: es estructural (punto anterior).
   La mutación añadió confirmación empírica redundante, no la sustentó.
3. El riesgo real de una concesión de permisos es dejarla puesta; no se
   dejó.

**Open item 2 — task 4.4: CONFIRMADO, el razonamiento es correcto y la
matriz SÍ está cubierta por la evidencia HTTP.** Verificado en el código:

```ts
disapproveShop(id: unknown): Promise<Shop> { return this._setActive(id, false); }
approveShop(id: unknown):    Promise<Shop> { return this._setActive(id, true); }
```

Ninguno de los dos recibe `user` ni rol. El 403 lo emite
`@Permissions(...ADMIN_ONLY)` a nivel de clase sobre
`ApproveShopController`/`DisapproveShopController`
(`shops.controller.ts:114`, `:125`), fuera del alcance de un spec unitario
del servicio. Un test en `shops.service.spec.ts` tendría que inventarse un
parámetro que el método no acepta — sería un test que no prueba nada.
Marcar `[x]` con nota fue la conducta correcta: ni fabricar cobertura falsa
ni dejar la tarea muda. La matriz queda cubierta por HTTP (403 `store_owner`
y 403 `customer` sobre `approve-shop`, arriba).

### 2.6 CA-6 — Sin mock huérfano ni regresión

```
grep -n "@db/\|plainToClass" apps/api/rest/src/shops/shops.service.ts
(sin salida — exit code 1)
```

Conteos tras todas las corridas (`db-check`, jest, build, matriz HTTP) y
tras la limpieza de las 2 filas centinela creadas por esta fase:

```
shops=12   inactive=0   zz=0   users=3   products=1200   categories=198
permission_user=6        max_active_id=15
```

Baseline restituido exactamente. `items[0].id` sigue siendo 15.

Además, `git diff main...HEAD -- packages/db/src/repositories/shops.repository.ts`
no tiene **ni una línea borrada**: `listShops`, `findShopBySlug`,
`listShopsNear`, `findShopOwnerById` y `findOrCreateShopBySlug` (el camino
del scraper) están intactos por construcción del diff. Las lecturas
confirmadas en vivo:

```
GET /shops?search=is_active:1&limit=30 -> total 12 | primer id 15 | 12 claves envoltorio | 16 claves shop | per_page "30"
GET /new-shops (baseline)              -> total 0  | data []
```

### 2.7 D30-4 / `DD30-5` — `products_count` nunca por el `?? 0`

**Aquí esta fase cerró un hueco de evidencia real que `sdd-apply` no vio.**

El problema: toda la evidencia HTTP de `apply-progress.md` (slices 3 y 5)
corrió `PUT` sobre tiendas **recién creadas y vacías**, donde
`products_count` vale `0` tanto si el `include: COUNT_PRODUCTS` está como si
se cayó al `?? 0` de `shops.service.ts:65`. Y el spec de jest tampoco lo
caza: su `makeShopRecord` fija `productsCount: 0` (`shops.service.spec.ts:86`),
única aparición del símbolo en todo el archivo. La regresión de `DD30-5`
era, por HTTP, indistinguible de lo correcto en toda la evidencia entregada.

Sonda propia sobre `gadget` (id 9, 44 productos publicados), con el **mismo
`name`** para que la única mutación sea `updated_at`:

```
GET /shops/gadget -> id 9  name "Gadget"  slug gadget  products_count 44  is_active 1

PUT /shops/9 (store_owner dueño) {"name":"Gadget"} -> HTTP 200
  products_count = 44   slug = gadget   name = "Gadget"   is_active = 1
  claves (orden): id,owner_id,name,slug,description,cover_image,logo,is_active,
                  address,settings,notifications,created_at,updated_at,
                  orders_count,products_count,owner
  n claves: 16
```

El escenario del spec («`products_count` de un `PUT` coincide con el del
`GET`, nunca `0`») queda probado **sobre HTTP**, no solo en vitest. Verdicto:
COMPLIANT.

*Cobertura residual, declarada:* el mismo assert sobre
`approve-shop`/`disapprove-shop` con una tienda de `products_count ≠ 0` no
existe en ninguna capa. El código path es idéntico (`setShopActive` usa el
mismo `include: COUNT_PRODUCTS`, verificado por lectura) y el propio
escenario del spec solo nombra el `PUT`. Se reporta como nota, no como hueco.

### 2.8 `DD30-2` — Defensa contra la escalada de privilegio

Verificado **en el código primero**, como exigía el encargo:

- `main.ts:9` → `app.useGlobalPipes(new ValidationPipe());` — **sin
  `whitelist`, sin `transform`**. Confirmado por lectura. El DTO no filtra
  nada en runtime.
- `ShopsService.update` construye `UpdateShopInput` campo a campo con seis
  spreads condicionales (`name`, `description`, `logo`, `cover_image`,
  `address`, `settings`). **No existe ninguna línea que lea `is_active`,
  `owner_id` o `slug` del body.** Es, literalmente, la única defensa.
- `UpdateShopInput = Partial<Omit<CreateShopInput,'ownerId'|'isActive'>>`
  refuerza a nivel de tipo, pero es defensa de compilación, no de runtime.

Y verificado **en vivo**, con un body hostil que lleva las cinco cosas a la vez:

```
PUT /shops/9 (token store_owner, tienda propia)
{"name":"Gadget","is_active":false,"owner_id":3,"slug":"gadget-secuestrado",
 "balance":{"total":999},"admin_commission_rate":50,"categories":[1,2]}
 -> HTTP 200 (16 claves, products_count 44)

-- fila real en Postgres tras el intento
 id | slug   | name   | owner_id | is_active
  9 | gadget | Gadget |        1 | t
```

`is_active` sigue `t`, `owner_id` sigue 1, `slug` sigue `gadget`. Los tres
campos fuera de alcance (`balance`, `admin_commission_rate`, `categories`)
se aceptaron y descartaron sin 400, como declara el Out of Scope.

La cola de moderación no es esquivable por `PUT`. `ADMIN_ONLY` de
`approve-shop` se sostiene.

### 2.9 Las dos trampas del diseño

**`DD30-7` (relojes distintos) — LIMPIA.** Los dos `it` de monotonía
(`shops.integration.test.ts:397` y `:414`) comparan
`updateShop → updateShop` y `setShopActive → setShopActive`, ambos con
`toBeGreaterThan` estricto. Ninguna aserción del archivo compara un
timestamp del camino `create` con uno del camino `update`. La trampa —
`createdAt`/`updatedAt` ligados desde Node en el `INSERT` frente al trigger
de Postgres en el `UPDATE`— no se pisó.

**`DD30-6` (tripwire ciego a `listShops`) — el tripwire es correcto, pero
está MAL COLOCADO.** Ver WARNING W1 en § 4.

### 2.10 `DD30-8` — Los dos call sites de `TS2554`

Corregidos con stubs declarados, **no** con un pass-through de
`@CurrentUser()`:

```ts
// shops.controller.ts:90   (antes: shopsService.create(createShopDto))
create(@Body() createShopDto: CreateShopDto) { return this.shopsService.createStaff(); }
// shops.controller.ts:105  (antes: shopsService.update(+id, updateShopDto))
update(@Param('id') id: string, @Body() updateShopDto: UpdateShopDto) { return this.shopsService.updateStaff(); }
```

Ambos métodos son de aridad cero y devuelven `null`. No hay forma de que
`/staffs` cree ni edite una tienda. Comprobado por HTTP sobre las **seis**
rutas stub — ninguna escribió nada:

```
POST   /staffs           -> 201 (cuerpo vacío)
PUT    /staffs/1         -> 200 (cuerpo vacío)
DELETE /staffs/1         -> 200 "This action removes a #1 shop"
DELETE /shops/9          -> 200 "This action removes a #9 shop"
POST   /shops/approve    -> 201 "This action removes a #NaN shop"
POST   /shops/disapprove -> 201 "This action removes a #NaN shop"

-- tras las seis llamadas
shops=12   zz=0   shop9_active=true
```

El `#NaN` de `/shops/approve` es el `@Param('id')` no ligable preexistente
del scaffold: sigue exactamente igual, como exige el Out of Scope.

---

## 3. Cumplimiento de alcance

| Comprobación | Resultado |
|---|---|
| `slug.ts`, `domain-errors.ts`, `common/errors/`, `db/schema.sql`, `apps/shop`, `apps/admin`, `vitest.config.ts`, `prisma/` | `git diff --stat main...HEAD` **vacío** (exit 0, sin salida) |
| DDL / migraciones / `seed.sql` | `git diff --name-only` sin coincidencias: **cero cambios de esquema** |
| Lecturas de `shops.repository.ts` | **cero líneas borradas** en el archivo ⇒ las 5 funciones preexistentes intactas |
| `findOrCreateShopBySlug` (scraper) | sin una sola línea `+`/`-` |
| Las 5 rutas stub | siguen stub, verificado por HTTP (§ 2.10) |
| `balance` / `admin_commission_rate` / `categories[]` | aceptados y descartados sin 400; no persisten (§ 2.8) |
| Archivos tocados | 18: **7 de código** (los 7 de «File Changes» del diseño) + 11 de docs/openspec. Ninguno fuera de alcance |

Medición exacta del diff (`git diff --numstat main...HEAD`):

```
   13      0  apps/api/rest/src/shops/dto/create-shop.dto.ts
   17      6  apps/api/rest/src/shops/shops.controller.ts
  583      3  apps/api/rest/src/shops/shops.service.spec.ts
  169     30  apps/api/rest/src/shops/shops.service.ts
    5      0  packages/db/index.ts
  336      2  packages/db/src/repositories/shops.integration.test.ts
  142      0  packages/db/src/repositories/shops.repository.ts
  --------------------------------------------------------------
  CÓDIGO   +1265 / -41 = 1306 líneas cambiadas
  TOTAL    +4512 / -61 = 4573 líneas cambiadas (18 archivos)
```

---

## 4. Hallazgos

### CRITICAL

**Ninguno.** Cero defectos de código. Las 41 tareas de `tasks.md` están
marcadas (`- [x]` ×41, `- [ ]` ×0) y ninguna es una marca vacía: cada una
tiene contraparte verificable en el diff o en la evidencia.

### WARNING

**W1 — El tripwire de `DD30-6` ya no es el último `it` del archivo; guarda
solo 3 de los 7 describes de escritura.**

El tripwire en sí está bien construido y esquiva correctamente la trampa que
el diseño identificó (no pasa por `listShops`):

```ts
expect(await prisma.shop.count()).toBe(12);                   // sin filtro de is_active
expect((await listShops({ isActive: false })).total).toBe(0);
expect((await listShops()).items[0].id).toBe(15);
```

Pero `DD30-6` era explícito sobre su ubicación: «Ese hueco lo cierra un
**último** `it`», porque `fileParallelism: false` serializa *archivos* y no
hace nada contra una fila que sobreviva a su propio `it` **dentro** del
mismo archivo. Orden real del archivo hoy:

```
135  describe  escritura (PR#1)          <- cubierto por el tripwire
220  describe  TRIPWIRE
234  describe  productsCount (gadget)     <- NO cubierto
259  describe  404 de P2025 (PR#2)        <- NO cubierto
287  describe  409 / 400 owner_id (PR#2)  <- NO cubierto
329  describe  REPLACE settings / logo    <- NO cubierto
388  describe  monotonía updated_at       <- NO cubierto
```

PR#2 apiló cuatro describes **después** del tripwire, degradándolo en
silencio. Una fila centinela que escapara de la batería hostil (el `it` de
carrera de slug, el más propenso: crea dos filas concurrentes y borra una
sola) no sería cazada dentro del archivo.

Mitigaciones vigentes que impiden que esto sea un defecto real hoy:
`afterAll(cleanupSentinel)` borra por prefijo, el escudo `ownerId: 3`
impide que una superviviente rompa `users.integration.test.ts`, y el cierre
con `psql` (`zz-%` → 0) lo cazaría a posteriori. De hecho la suite está
verde y el baseline se verificó restituido en esta misma fase.

**Impacto:** salvaguarda diseñada, degradada. No bloquea el archivado.
**Acción sugerida (del equipo, no del arquitecto):** mover el bloque
`describe('tripwire…')` al final del archivo, o duplicarlo allí, antes de
que una US futura apile un sexto describe.

**W2 — El desborde de PR#4 se midió DESPUÉS de terminar el slice, no antes;
la decisión de no parar se tomó sobre trabajo ya consumado.**

Números reales, medidos por el verificador:

| | Pronóstico | Real | Desvío |
|---|---|---|---|
| PR#4 (`shops.service.spec.ts`) | ~500 | **586** (+583/−3) | +17 % sobre su propio pronóstico; **+46 % sobre el presupuesto de 400** de `sdd-phase-common.md` §E |
| Agregado 4 slices | ~1550 (banda +200/−350) | **1306** | **−16 %**, dentro de la banda |

`tasks.md` fijaba el corte de contingencia («levantar PR#4 a una US-30b»)
con una instrucción literal: *«parar y preguntar, nunca decidir solo»*.

Lo que ocurrió: `sdd-apply` terminó el slice, lo puso verde, **entonces**
hizo la cuenta, documentó el desvío con honestidad, argumentó tres razones
para no escalar (agregado bajo pronóstico; archivo único de solo-adición;
precedente del repo — `products.service.spec.ts` tiene 1015 líneas) y señaló
el punto exacto de rollback.

**Juicio: el resultado es defendible; el proceso, no del todo.** El
desenlace es correcto —partir en dos una batería de escenarios relacionados
de un solo archivo de test no mejora ninguna revisión, y el agregado quedó
249 líneas por debajo— y la transparencia fue ejemplar: el número se expone
para auditoría en vez de enterrarse. Pero medir al final convierte «parar y
preguntar» en un imposible: cuando existía el dato, ya no quedaba decisión
que tomar. La lectura de «desborde» como agregado (que no desbordó) es
razonable pero no es la única, y elegirla unilateralmente es justo lo que la
instrucción prohibía.

**Impacto:** de proceso, no de producto. No bloquea el archivado.
**Acción sugerida:** el chequeo pronóstico-vs-real debe hacerse a mitad del
slice, no al cerrarlo. Corrección hacia adelante, no retrabajo de esta US.

**W3 — Dos inexactitudes en el README del épico, dentro de la sección de
sesgo de estimación.**

Lo que **sí** verifiqué como correcto:

| Dato del README | Verificación |
|---|---|
| `real ~1301 código` | Real 1306 (+1265/−41). Δ=5 líneas, dentro del `~`. **Exacto** |
| factor `×3,3` | 1306/400 = 3,27 → ×3,3. **Exacto** |
| mediana 4 US `×3,0` | factores 2,0 · 2,6 · 3,3 · 4,6 → (2,6+3,3)/2 = 2,95. **Exacto** |
| media `×3,1` | (2,0+2,6+4,6+3,3)/4 = 3,125. **Exacto** |
| Status épico «Cerrado» y fila US-30 «Implementada» | **Correctos** |

Lo que **no** cuadra:

1. `~4056 con artefactos SDD` — el diff real es **4573** (+4512/−61, 18
   archivos). La cifra 4056 se midió en `apply-progress.md` §5.7 *antes* del
   commit final `1aff521`, que añadió sus propios cambios de docs, `tasks.md`
   y `apply-progress.md`. Subestima en ~517 líneas.
2. «*aterriza dentro de la misma banda (~1470–2109)*» — **1301 (ni 1306)
   está dentro de 1470–2109**; queda por debajo del piso. La frase que la
   sigue («la única de las cuatro US cuyo real quedó bajo su propio
   pronóstico re-anclado») es correcta y contradice a la anterior. La prosa
   circundante sigue diciendo «las **tres** US aterrizaron entre ~1470 y
   ~2109», que era cierto antes de añadir US-30.

**Impacto:** documental. No afecta ningún factor de estimación —el `×3,3`,
la mediana y la media son correctos— ni el cierre del épico. Es la
observación cualitativa la que está mal redactada.
**Acción sugerida:** `sdd-archive` puede corregir las dos frases al mover la
carpeta; no amerita un commit propio.

**W4 — Tensión entre el texto del spec y la divergencia declarada para
`/staffs`.**

`specs/shop-write-api/spec.md` dice: «`POST`/`PUT`/`DELETE /staffs` MUST
mantener su comportamiento de stub **sin cambios**». El cuerpo de
`POST /staffs` y `PUT /staffs/:id` **sí** cambió: de `this.shops[0]` (una
tienda completa del mock) a vacío (`null`). `design.md` lo declara como
divergencia #5, argumenta que preservarlo byte a byte es imposible una vez
que `shops.json` sale del servicio (CA-6) y mide que ningún consumidor lee
el cuerpo (`data/staff.ts:37-38`, `onSuccess: () => {}` sin parámetro).

El diseño gana: el requirement quiere preservar el *comportamiento de stub*
(no escribir nada), y eso se cumple íntegro. Pero si el spec se mergea
verbatim a `openspec/specs/`, quedará afirmando algo literalmente falso
sobre el estado del código.

**Acción sugerida:** al mergear el delta, `sdd-archive` debería matizar ese
«sin cambios» a «sin escribir nada (el cuerpo cambia — divergencia
declarada #5)».

### SUGGESTION

- **`just build` ensucia el árbol.** El `postbuild:rest` de `apps/shop`
  (next-sitemap) reescribe `apps/shop/public/sitemap-0.xml`, que es un
  archivo **trackeado** (269 inserciones / 266 borrados por los `lastmod`).
  Es comportamiento preexistente del repo, ajeno a US-30. El verificador lo
  revirtió (`git checkout --`) y el árbol quedó limpio. Merece saberse antes
  de convertir `just build` en un gate de CI.
- **`staffs: []` vs. clave ausente** en el «Contexto» de la US y en
  `apply-progress.md` §5.3 — ver § 2.4. Cosmético.
- **`CLAUDE.md` sigue diciendo «4 suites / 65 tests»**; hoy son 9 suites /
  239 tests. Ya declarado como divergencia #10 del diseño, adyacente y
  deliberadamente no accionado. Se menciona, no se acciona.

---

## 5. Resolución de los cinco open items del encargo

| # | Item | Veredicto |
|---|---|---|
| 1 | `just verify` no se corrió en ningún slice | **Hueco legítimamente declarado, y ahora CERRADO por esta fase.** La exclusión era defendible: US-30 no toca `apps/shop` ni `apps/admin` (diff vacío, verificado), así que `just verify` no podía detectar ninguna regresión suya; y declararlo en vez de fabricarlo es la conducta correcta. Pero era, aun así, un gate de la DoD sin correr. El verificador levantó los tres servicios y lo corrió: **verde** (§ 1). También corrió `just build`, el `build_command` de `rules.verify`: **exit 0**. Ya no queda gate pendiente |
| 2 | Task 4.4 marcada `[x]` con nota en vez de test | **CONFIRMADO.** `approveShop(id: unknown)`/`disapproveShop(id: unknown)` no reciben `user`; el 403 sale de `@Permissions(...ADMIN_ONLY)` a nivel de clase. Un unit test del servicio no puede observarlo sin inventar un parámetro inexistente. Y la matriz **sí** está cubierta por la evidencia HTTP de Phase 5 y por la mía (§ 2.5) |
| 3 | `D30-1` ratificada: exige *demostrar* la pérdida | **DEMOSTRADA, no ocultada.** Reproducida por el verificador leyendo la columna `settings` en `psql` antes y después: `shopMaintenance` desaparece de la fila real (§ 2.2). Además el `it` de vitest la asserta con `not.toHaveProperty`, no la evita |
| 4 | Mutación manual de `permission_user` para el caso `staff` | **NO debilita CA-5.** Reversión exacta verificada contra `db/seed.sql:81-88` (6 filas, fila por fila). Y la garantía no dependía de esa sonda: `PermissionsGuard` es una intersección de conjuntos sin ramas por rol, y el 403 de `customer` —observado— recorre la misma línea (§ 2.5) |
| 5 | PR#4 +583 vs ~500, sin parar y preguntar | **Resultado correcto, proceso mejorable.** Ver WARNING W2. No bloquea |

---

## 6. Veredicto final

**PASS WITH WARNINGS.**

**US-30 puede archivarse y el Épico 26 puede declararse cerrado.**

Fundamento:

1. **Los seis CA están COMPLIANT** con evidencia de ejecución real, no
   estática. Ningún escenario del spec quedó `UNTESTED`.
2. **Los tres gates de código se reprodujeron íntegros** por el verificador
   —199/199, 239/239, `build-api` limpio— y **los dos gates que faltaban se
   corrieron y salieron verdes**: `just build` (exit 0) y `just verify` (los
   tres servicios con contenido real). La DoD ya no tiene casillas cerradas
   por declaración.
3. **Las dos trampas del diseño no se pisaron**: ningún test compara relojes
   distintos (`DD30-7`), y el tripwire no pasa por `listShops` (`DD30-6`) —
   aunque su ubicación se degradó (W1).
4. **La defensa contra la escalada de privilegio está verificada en el
   código y en vivo**: con `main.ts:9` sin `whitelist`, la construcción campo
   a campo es la única barrera, y un `PUT` hostil con `is_active`,
   `owner_id` y `slug` inyectados dejó la fila intacta.
5. **La corrección 500 → 404/400 está probada en las 12 combinaciones**, y
   el caso `{"id":true}` se descartó con una prueba más estricta que la del
   apply: `updated_at` inalterado demuestra que no hubo `UPDATE` alguno.
6. **El alcance se respetó sin una sola fuga**: diff vacío en los ocho
   caminos prohibidos, cero DDL, cero líneas borradas en el repositorio de
   lecturas, las 5 rutas stub verificadas mudas por HTTP.
7. **La base quedó en baseline exacto** y el árbol de trabajo limpio.

Las cuatro advertencias son de higiene de tests (W1), de proceso (W2) y
documentales (W3, W4). Ninguna describe un defecto de comportamiento y
ninguna justifica retener el archivado. **W1 y W4 conviene resolverlas en el
propio `sdd-archive`** (mover el tripwire al final del archivo; matizar el
«sin cambios» de `/staffs` al mergear el delta). W3 es una corrección de dos
frases en el README del épico. W2 no admite retrabajo: es una lección para
la próxima cadena de slices.

**Próxima fase recomendada: `sdd-archive`.**

---

## 7. Estado del entorno al cierre

```
git status --short   -> (vacío, árbol limpio)
puertos 9001/3002/3003 -> sin LISTENING (los tres servicios detenidos)

shops=12   inactive=0   zz=0   users=3   products=1200   categories=198
permission_user=6   max_active_id=15
```

Filas creadas por esta verificación (`zz-tiendas-vfy-owner` id 165,
`zz-tiendas-vfy-admin` id 166): **borradas**. Ninguna mutación persistente
sobre el seed salvo `updated_at` de `gadget` (columna que ningún test lee;
mutación ya prevista y aceptada por `DD30-5`). `apps/shop/public/sitemap-0.xml`,
reescrito por el `postbuild` de `just build`, **revertido**.
