# Exploration: US-30 — Escrituras y moderación de tiendas

> Cuarta y última US del Épico 26. Cierra el épico si su DoD se marca completa.
> Depende de US-27a (implementada); consume una pieza que US-29 dejó lista en
> `shops.repository.ts`. Fuente: `docs/product/26-escrituras-catalogo-postgres/30-escrituras-moderacion-tiendas.md`
> + el `README.md` del épico (leídos completos) + código actual, re-verificado
> línea a línea el 2026-09-11.

## Current State

### 1. Los stubs, verificados sin drift

`apps/api/rest/src/shops/shops.service.ts` (leído completo, 256 líneas):

- `create()` (`:97-99`) → `return this.shops[0]`. `update()` (`:230-232`) →
  ídem. `approve()`/`remove()` (`:234-240`) → devuelven un string del
  scaffold, sin consumidor.
- `disapproveShop()`/`approveShop()` (`:242-254`) mutan el array `this.shops`
  en memoria (`plainToClass(Shop, shopsJson)`, `:30,95`): el cambio se pierde
  al reiniciar. **Bug de 500 confirmado por lectura de código, no inferido**:
  `this.shops.find((s) => s.id === Number(id))` devuelve `undefined` si el id
  no existe, y la línea siguiente (`shop.is_active = false`) lanza
  `TypeError: Cannot set properties of undefined` sin ningún `try/catch`
  alrededor → **500** hoy. Ningún test lo cubre (`shops.service.spec.ts`
  actual, ver abajo, solo prueba `getNewShops`/`getNearByShop`).
- `getStaffs()` (`:174-188`) lee `this.shops.find(...).staffs` del JSON;
  `shops.json` trae `staffs: []` en las 9 tiendas del mock → paginador vacío
  siempre, confirmado por lectura del array esperado.
- Import de `shops.json` en `:21`, `plainToClass` en `:7,30` — ambos a
  eliminar por CA-6.

`apps/api/rest/src/shops/shops.controller.ts` (leído completo, 147 líneas) —
**sin drift respecto al contexto de la US**:

- `POST /shops`, `PUT /shops/:id`, `DELETE /shops/:id` con
  `@Permissions(...ADMIN_AND_OWNER)` (`:28-56`). **Hallazgo verificado no
  nombrado explícitamente por la US**: `ADMIN_AND_OWNER = ['super_admin',
  'store_owner']` (`permissions.decorator.ts:21`) — `staff` **no** aparece.
  A diferencia de `products` (que usa `ADMIN_OWNER_AND_STAFF` y por eso el
  403 de `staff` en US-29 salía "por accidente" del chequeo de propiedad,
  WARNING-1 de su verify-report), en `shops` el 403 de `staff` en
  `POST`/`PUT` sale **directamente del guard**, antes de que exista ningún
  chequeo de propiedad. Es una garantía más fuerte, no una casualidad — ver
  Riesgos.
- `POST /shops/approve` y `POST /shops/disapprove` (`:58-69`, dentro del
  mismo `ShopsController`) usan `@Param('id')` sobre una ruta **sin** `:id`
  en el decorador (`@Post('approve')`) — no puede ligarse nunca. **Ambos
  llaman a `this.shopsService.approve(+id)`** (línea `:62` y `:68`
  idénticas) — ni siquiera hay un método `disapprove()` separado. Coincide
  exacto con el contexto de la US (`:32-34`).
- `StaffsController` (`:72-101`): `POST /staffs` invoca
  `shopsService.create` con un `CreateShopDto` — mismo scaffold roto que la
  US ya documenta.
- `POST /disapprove-shop` / `POST /approve-shop` (`DisapproveShopController`/
  `ApproveShopController`, `:103-123`), `@Body('id')` sin tipar (el
  parámetro `id` no declara tipo — llega como lo mande el body), guard
  `ADMIN_ONLY`. Son las rutas reales que usa el admin
  (`data/client/shop.ts:39-47`, `API_ENDPOINTS.APPROVE_SHOP`/
  `DISAPPROVE_SHOP`).
- `NearByShopController`, `NewShopsController`: ya migrados (US-5), fuera de
  alcance de esta US salvo como consumidores de `toShopDto`.

`packages/db/src/repositories/shops.repository.ts` (leído completo, 201
líneas) — **confirma exactamente lo que el orquestador adelantó**:

- `findShopOwnerById(id): Promise<number | null>` existe en `:174-178` (no
  `:174` a secas, pero la línea de inicio coincide). Firma: recibe `id:
  number`, `NUNCA lanza` (`!Number.isSafeInteger(id) || id <= 0` → `null`
  antes de tocar Prisma — nivel A' de US-29). Devuelve `_id(row.ownerId)` si
  existe, `null` si no. **Reutilizable tal cual para CA-2** de US-30 (un
  `store_owner` que edita su propia tienda usa la misma sonda que ya usa
  `products` para saber a quién pertenece el `shop_id`).
- **Cero funciones de escritura** (`createShop`/`updateShop`/
  `setShopActive` no existen todavía) — el archivo solo tiene
  `listShops`/`findShopBySlug`/`listShopsNear`/`findShopOwnerById`/
  `findOrCreateShopBySlug` (esta última, del scraper, con su propio `upsert`
  idempotente por slug — **no se toca**, CA-7 implícita por analogía con
  `upsertScrapedProduct`).
- `packages/db/index.ts` (grep dirigido): exporta hoy `findShopBySlug`,
  `findShopOwnerById`, `findOrCreateShopBySlug`, `listShops`, `listShopsNear`
  y el tipo `ListShopsInput`/`ShopNearRecord`. Ninguna función de escritura
  ni tipo `CreateShopInput`/`UpdateShopInput` — es exactamente la superficie
  que esta US debe añadir, en orden alfabético (precedente de US-29).

`db/schema.sql:231-244` (`CREATE TABLE shops`) — **confirmado, cero CHECK,
cero `IN`**:

```sql
CREATE TABLE IF NOT EXISTS shops (
    id             bigserial    PRIMARY KEY,
    name           text         NOT NULL,
    slug           text         NOT NULL UNIQUE,
    description    text,
    owner_id       bigint       NOT NULL DEFAULT 1 REFERENCES users(id) ON DELETE RESTRICT,
    is_active      boolean      NOT NULL DEFAULT true,
    logo           jsonb,
    cover_image    jsonb,
    address        jsonb        NOT NULL DEFAULT '{}'::jsonb,
    settings       jsonb        NOT NULL DEFAULT '{}'::jsonb,
    created_at     timestamptz  NOT NULL DEFAULT now(),
    updated_at     timestamptz  NOT NULL DEFAULT now()
);
```

Solo una FK saliente (`owner_id → users(id)`, `ON DELETE RESTRICT`) y un
`UNIQUE` (`slug`). Ningún `IN`, ningún CHECK nombrado. `logo`/`cover_image`
son **jsonb nullable sin default**; `address`/`settings` son **jsonb NOT
NULL DEFAULT '{}'**. `ShopRecord` (`packages/db/src/records.ts:75-94`) ya
tipa `logo`/`coverImage` como `Prisma.JsonValue | null` en lectura — mismo
patrón que `image` de `products` (nullable, sin default), lo que activa la
misma trampa de `Prisma.InputJsonValue` (ver Preguntas abiertas #2). Sí hay
un trigger `shops_updated_at BEFORE UPDATE` (visto en `db/schema.sql`, según
grep del README del épico — confirmado también por el comentario de
`shops.repository.ts` y por la nota de la propia US, `:46-50`).

Errores de Prisma que **sí** pueden dispararse en `shops` (a diferencia de
`products`/`categories`, que tienen 5 y 7 guardas de CHECK respectivamente):
únicamente **`P2002`** (slug duplicado — `SlugConflictError` → 409) y
**`P2003`** (`owner_id` referenciando un usuario inexistente —
`InvalidReferenceError` → 400, aunque en la práctica `owner_id` sale del
`sub` del token, que por construcción es un usuario autenticado válido; el
caso solo es alcanzable si el usuario se borra entre la emisión del JWT y el
`INSERT`, ventana ínfima) y **`P2025`** (fila inexistente en `update`/
`approve`/`disapprove` — `RecordNotFoundError` → 404, cerrando el 500 de
`TypeError` de nota 4). **No hay ninguna quinta guarda de dominio que
pre-validar antes del `INSERT`** — el contraste más fuerte con US-29 (5
expresiones CHECK/`IN`) y con US-28 (7 reglas del árbol).

### 2. `packages/db/vitest.config.ts` — confirmado, protege el centinela de `shops`

Existe (`fileParallelism: false`, 16 líneas, creado por US-29/DD29-10). El
`design.md` de US-29 documenta explícitamente que **`shops.integration.test.ts`
ya sufría el flake de conteo cruzado entre workers** (`productsCount` `toBe(584)/
toBe(82)/toBe(188)` en `:35-37` y `toBe(44)` en `:48`) — el propio US-29 lo
cerró como "hallazgo nuevo, no nombrado por el gate". Con el archivo presente,
US-30 no necesita crear esta protección: solo necesita que su centinela nuevo
(tiendas `zz-shops-...`) no rompa `toBe(12)` / `items[0].id === 15` / los 4
conteos de `productsCount`.

**Trampa 1 confirmada, aún sin resolver**: `shops.integration.test.ts` (leído
completo, 97 líneas) tiene HOY, en modo **solo lectura**:

- `:19-20` — `total` = 12, `items[0].id` = 15 (orden `desc` por id,
  `listShops` en `:52`, `orderBy: { id: 'desc' }`).
- `:32-48` — `productsCount` absolutos: `grocery-shop` 584, `makeup-shop`
  82, `noaw` 188, `gadget` 44 (vía `findShopBySlug`).
- `:91-95` — repetición del assert de `total`/`items[0].id` al final del
  archivo (describe `listShopsNear`, "no-regresión").

Cualquier tienda centinela creada por los tests de escritura de US-30 que
**(a)** no se borre en `afterAll`/`afterEach`, o **(b)** reciba (por
`db-reset` u otra causa) un id mayor a 15 y sobreviva, rompe `items[0].id
=== 15`. Como en US-29, la mitigación es limpieza estricta por prefijo de
slug centinela (`zz-shops-` o similar) en `beforeAll`+cada `it`/`afterAll`,
**no** solo un prefijo de nombre.

### 3. Los dos DTOs y la entidad — confirmados, sin drift

- `create-shop.dto.ts` (4-14): `CreateShopDto extends PickType(Shop, ['name',
  'address', 'description', 'cover_image', 'logo', 'settings', 'balance'])`
  + `categories: number[]` standalone. **`owner_id` no está en el `PickType`**
  (correcto: nunca debe venir del body, nota 2 de la US) pero tampoco hay
  ningún campo `type_id`/`is_active` explícito — el DTO no impone nada sobre
  ellos hoy.
- `update-shop.dto.ts`: `PartialType(CreateShopDto)` — sin cambios propios.
- `Shop` entity (`shop.entity.ts`): declara `balance?: Balance`,
  `distance?/lat?/lng?` (solo emitidos por `toNearShopDto`), `staffs?:
  User[]`. `ShopSettings` solo tipa `socials`/`contact`/`location`/`website`
  — **no** declara `shopMaintenance`/`notifications`/`askForAQuote`, aunque
  el formulario del admin sí los envía dentro de `settings` (ver Preguntas
  abiertas #1); es un tipo laxo del lado de Nest, no whitelist (`main.ts:9`
  sin `ValidationPipe({whitelist:true})`, confirmado por el epic README
  decisión 5), así que no bloquea nada en runtime.
- `ApproveShopDto` (`create-shop.dto.ts:16-19`): `{ id, admin_commission_rate
  }`, **no usado** por el controller (que lee `@Body('id')` suelto) —
  vestigial, coincide con "se ignora y se declara" (CA-3).

### 4. El admin — confirmado, construye `settings` como objeto completo

`components/shop/shop-form.tsx` (leído completo, 758 líneas):

- `onSubmit` (`:190-223`) construye **siempre** un objeto `settings`
  completo: `{ ...values.settings, location: {...omit(location,
  '__typename')}, socials: values.settings.socials?.map(...) ?? [],
  shopMaintenance: values.settings.shopMaintenance }`, y lo manda entero en
  `updateShop({ id, ...values, address: restAddress, settings, balance })`
  o `createShop({ ...values, settings, balance })`. **No hay ningún PATCH
  parcial deliberado**: el formulario reconstruye el objeto completo a partir
  de `defaultValues` (que a su vez vienen de `initialValues` en `:113-134`)
  y de los campos registrados.
- **Matiz que sí importa para un full-REPLACE en el servidor**: el formulario
  usa `shouldUnregister: true` (`:112`) y varias ramas de `settings.*` se
  renderizan **condicionalmente**: el bloque de `shopMaintenance`
  (`:586-694`) solo se monta si `!permissions.includes(SUPER_ADMIN)`; el
  bloque `askForAQuote` (`:695-738`) exige además `!is_active` y
  `options.isMultiCommissionRate`. Con `shouldUnregister: true`, un campo no
  montado **no aparece** en `values` al hacer submit. Consecuencia
  verificada por lectura: **un `super_admin` que edita una tienda con
  `settings.shopMaintenance` ya poblado, mandaría `shopMaintenance:
  undefined`** dentro de su `PUT`, porque ese bloque nunca se monta para su
  rol. Esto es evidencia directa a favor de que el backend **no** puede
  asumir que "lo que no viene, se conserva" simplemente por confiar en que
  el cliente "ya manda todo": el cliente manda todo **lo que tiene montado
  para ese rol**, no necesariamente el objeto íntegro.
- `data/shop.ts` (`useUpdateShopMutation`, `:60-75`): `onSuccess` hace
  `router.push(`/${data?.slug}/edit`)` — depende de que la respuesta del
  `PUT` traiga `slug` (idéntico al patrón de `products` en US-29).
- `data/client/shop.ts`: confirma `crudFactory` genérico para
  create/update/remove (`POST`/`PUT`/`DELETE` estándar sobre
  `API_ENDPOINTS.SHOPS`), más `approve`/`disapprove`/
  `transferShopOwnership` a mano. `transferShopOwnership` **no está en el
  alcance de esta US** (confirmado: la US lo lista explícitamente en "NO
  incluye").
- **Confirmado por grep dirigido**: no existe `shop-delete-view.tsx` ni
  `useDeleteShopMutation` en `components/shop/` (solo
  `staff-delete-view.tsx`, `approve-shop-view.tsx`,
  `disapprove-shop-view.tsx`, `approve-view-form-part/`). Sostiene la
  decisión 7 del épico (`DELETE /shops/:id` sigue stub).

### 5. Autenticación y permisos — piezas confirmadas, listas para reutilizar

- `@CurrentUser()` (`current-user.decorator.ts`) devuelve
  `CurrentUserPayload { sub, email, permissions, iat, exp }`, ya usado en
  `users.controller.ts`. Directamente reutilizable en `create`/`update` de
  `shops.controller.ts` (hoy ninguno de los dos lo recibe).
- `ADMIN_AND_OWNER`/`ADMIN_ONLY` (`permissions.decorator.ts:20-21`) — sin
  cambios necesarios; los decoradores de ruta de la US ya están correctos
  (decisión 8 del épico: "los decoradores de ruta no cambian").

### 6. Baseline de datos (medido hoy, Postgres arriba en 5433)

```
$ docker exec safari-postgres psql -U safari -d safari_scraper -t \
    -c "SELECT count(*) FROM products;" -c "SELECT count(*) FROM category_product;" \
    -c "SELECT count(*) FROM product_tag;" -c "SELECT count(*) FROM categories;" \
    -c "SELECT count(*) FROM tags;" -c "SELECT count(*) FROM shops;" \
    -c "SELECT count(*) FROM users;" -c "SELECT count(*) FROM shops WHERE slug LIKE 'zz-%';"
  1200 | 0 | 0 | 198 | 10 | 12 | 3 | 0
```

Coincide exacto con el baseline que trajo el orquestador. `safari-postgres`
está `Up (healthy)` — `just db-up` **no** hace falta antes de arrancar.

## Lo que US-29 ya construyó y que US-30 consume directamente

| Pieza | Dónde | Cómo la consume US-30 |
|---|---|---|
| `findShopOwnerById(id): Promise<number \| null>` | `shops.repository.ts:174-178` | CA-2 (propiedad en `PUT /shops/:id`): un `store_owner` compara `sub` contra el `ownerId` de la fila que va a editar — **misma función**, sin tocarla |
| `packages/db/vitest.config.ts` (`fileParallelism: false`) | raíz de `packages/db` | Ya protege `shops.integration.test.ts` de colisiones de conteo con otros archivos; US-30 no necesita crearlo, solo respetar su propio centinela |
| `translateCatalogWriteError` + `toWriteHttpException` | `packages/db/src/domain-errors.ts` / `apps/api/rest/src/common/errors/domain-error.mapper.ts` | Reutilizables sin modificar (CA-7 implícita): `P2002→409`, `P2003→400`, `P2025→404` ya cubren el 100% de lo que `shops` puede lanzar, porque no tiene CHECKs propias |
| Patrón `!== undefined` (nunca `??`) para estado efectivo, y spread condicional `...(input.X != null && {X: input.X})` para jsonb nullable | `products.repository.ts` (DD29-7) | Aplica igual a `logo`/`cover_image` (jsonb nullable sin default, idéntico a `image` de products) |
| Patrón de propiedad servicio (no guard) con 404-antes-de-403 | `products.service.ts` (DD29-4) | Referencia de forma para `update()` de shops, aunque más simple (una sola tienda, no un lado "actual" y un lado "destino" — `shop_id` de una tienda no se mueve a otra tienda) |
| `CATALOG_ERROR_CODES`/`isCatalogWriteError`/`mapDomainError` | `domain-errors.ts` / `domain-error.mapper.ts` | Sin cambios; `git diff` de ambos archivos debe seguir vacío |

**Único archivo compartido con US-29** (ya advertido por el `design.md` de
US-29): `packages/db/index.ts`. Si esta US arranca después de que US-29 ya
esté mergeada a `main` (que es el caso: US-29 está archivada), no hay
conflicto — el barrel ya tiene las 5 exportaciones de `products` y las de
`shops` intactas.

## Preguntas abiertas (la US no las cierra)

### 1. `settings` jsonb: ¿REPLACE completo o MERGE superficial?

CA-2 dice literalmente: *"`settings` (jsonb completo, incluida
`location`)"* — el texto de la US ya apunta a REPLACE. Pero la evidencia del
formulario (§ Current State, punto 4) muestra que un `super_admin` que edita
una tienda con `shopMaintenance` poblado enviaría `shopMaintenance:
undefined` en su `PUT` (el bloque no se monta para su rol). Un REPLACE
literal (`settings: input.settings` sin fusionar) **borraría**
`shopMaintenance` de esa tienda en cuanto un `super_admin` la edite por
cualquier motivo (p. ej. solo cambiar el `name`).

| Opción | Cómo | Pros | Contras |
|---|---|---|---|
| **A — REPLACE completo** (lo que dice CA-2 al pie de la letra) | `settings: input.settings` (spread condicional solo si `input.settings !== undefined`, igual que el resto de campos opcionales) | Simple, una línea, sigue el texto exacto de la US, coherente con "jsonb completo" | Un `PUT` de `super_admin` sin `shopMaintenance` montado en su formulario **borra** ese campo de tiendas con mantenimiento programado; mismo riesgo para `askForAQuote` si un `store_owner` con `is_active=true` edita su tienda (el bloque no se monta) |
| **B — MERGE superficial en el servidor** (`{ ...current.settings, ...input.settings }`, un nivel) | El servicio lee la fila actual (ya necesaria para 404/403), y fusiona un nivel antes de escribir | No pierde `shopMaintenance`/`askForAQuote` cuando el rol que edita no los ve | Contradice el texto literal de CA-2 ("jsonb completo"); un merge de un nivel **no** protege sub-claves de `location`/`socials` si el cliente manda un objeto parcial de esas — habría que decidir la profundidad del merge, que ya no es "superficial" |
| **C — REPLACE completo, pero declarar la pérdida como divergencia conocida** | Igual que A, documentando en el reporte final que un `PUT` de un rol que no ve cierto bloque de `settings` lo borra | Mismo texto de CA-2, cero complejidad nueva, precedente de "divergencia declarada" ya usado 11 veces en el épico | Es una regresión de UX real (un `super_admin` podría desactivar sin querer el modo mantenimiento de una tienda), aunque de bajo tráfico (el admin no ofrece un flujo donde eso sea frecuente) |

**Recomendación**: **Opción C** (REPLACE completo, declarado). Es lo que el
CA literal exige, es el precedente exacto de `products`/`categories` (que
también hacen REPLACE total de sus jsonb, nunca merge), y una fusión en el
servidor introduciría una regla de negocio nueva no autorizada por ninguna
decisión del épico (que ya cierra la puerta a "reglas nuevas no
autorizadas" en `R29-x`/decisión 5). El riesgo real es acotado: el único
consumidor del campo desde otro rol es `shopMaintenance` (oculto solo para
`!super_admin`, es decir, un `super_admin` SÍ puede borrarlo sin querer;
pero un `store_owner` — que es quien normalmente configura su propio
mantenimiento — sí lo ve y lo conserva). `sdd-design` debe fijar esto en una
decisión explícita (DD30-x) y `sdd-tasks` debe pedir un `curl` que lo
demuestre en la DoD (editar `name` de una tienda con `shopMaintenance`
poblado y confirmar en `psql` si sobrevive o se vacía, según la opción
elegida).

### 2. `Prisma.InputJsonValue` no acepta `null`; `logo`/`cover_image` son jsonb nullable

Igual que `image`/`gallery` de `products` (DD29-7, "divergencia #10" del
`design.md` de US-29: *"`PUT {"image": null}` es un no-op — el admin no
puede vaciar la imagen por esta ruta"*), `logo` y `cover_image` de `shops`
son `jsonb` **nullable sin default** (`db/schema.sql:238-239`). El mismo
patrón de código ya vive en `createCategory`/`updateCategory`
(`categories.repository.ts:467,540`): `...(input.logo != null && { logo:
input.logo })`.

**Recomendación**: aplicar el mismo patrón, literal, a `logo` y
`cover_image`. Es el precedente ya usado dos veces en el épico (`products`,
`categories`), no una decisión nueva — solo hay que declarar la misma
divergencia ("no se puede vaciar `logo`/`cover_image` con `null`
explícito") en el reporte final de esta US, con su propio número.

### 3. `is_active` por rol al crear — ¿la UI realmente lo presupone?

Confirmado por lectura, no solo por la nota de la US: `getNewShops` (fija
`isActive: false`, `shops.service.ts:141-172`) alimenta la página "Inactive
shops" (`pages/new-shops.tsx`, según referencia de la US;
`approve-shop-view.tsx` existe y es la vista que el admin usa para mover una
tienda de esa lista a activa). El flujo **ya existe y funciona hoy sobre el
mock** (aprobar una tienda del listado de inactivas); lo único que falta es
que la creación real la coloque ahí según el rol de quien la crea, en vez de
nacer siempre `is_active: true` por el `DEFAULT` del DDL.

**Recomendación**: seguir la nota 1 de la US tal cual («DECIDIDO en esta
US» — no es una pregunta abierta en rigor, se incluye aquí solo para dejar
la evidencia de verificación): `store_owner` → `false`, `super_admin` →
`true`, fijado explícito en `createShop()` del repositorio (no depender del
`DEFAULT true` del DDL).

### 4. `staff` en `approve-shop`/`disapprove-shop` y en `POST`/`PUT /shops`

Confirmado (§ Current State, punto 1): a diferencia de `products`
(`WARNING-1` de US-29, donde `staff` recibe 403 por *no ser dueño*, nunca
por una regla de rol explícita, porque el guard de esa ruta es
`ADMIN_OWNER_AND_STAFF`), en `shops` el guard de `POST`/`PUT` ya es
`ADMIN_AND_OWNER` (**sin** `staff`) y el de `approve-shop`/`disapprove-shop`
es `ADMIN_ONLY`. **El 403 de `staff` en las cuatro rutas de esta US sale del
guard, no de una casualidad de datos** — no hay ningún riesgo latente
equivalente al `WARNING-1` de `products` que dependa de que `staff` no
tenga tienda propia. Esta es una respuesta más fuerte y más simple que la de
`products`: no hace falta ninguna comprobación adicional en el servicio para
`staff`, el decorador ya lo resuelve. `sdd-design` no necesita una DD-x para
esto; basta con el `curl` de la DoD que ya pide la US (`403 staff`), y el
reporte final puede declarar la asimetría con `products` como una nota, no
como un hallazgo pendiente.

## Riesgos (rankeados)

1. **ALTO — Trampa 1, `items[0].id === 15`.** Confirmado en
   `shops.integration.test.ts:19-20,91-95`: `total` = 12 y `items[0].id`
   = 15 bajo orden `desc`. Cualquier tienda centinela de US-30 con un id
   mayor a 15 que sobreviva a un test rompe ambos asserts (y los 4 de
   `productsCount`, `:32-48`). **Ya le pasó a US-29** (creó la id 16 y tuvo
   que borrarla). Mitigación: limpieza estricta por prefijo de slug
   centinela en `beforeAll`/cada `it`/`afterAll` — nunca confiar en que "el
   test de arriba ya limpió".

2. **ALTO — Trampa 2, reloj Node vs. Postgres.** `shops` tiene el trigger
   `shops_updated_at BEFORE UPDATE` (documentado en el propio schema y
   corroborado por el patrón idéntico ya vivido en `categories`/`products`).
   `createShop` fijará `created_at`/`updated_at` **en Node** (Prisma resuelve
   `@default(now())` client-side cuando el modelo no tiene `@updatedAt`
   explícito); `updateShop`/`approveShop`/`disapproveShop` recibirán su
   `updated_at` **del trigger**, con el reloj de Postgres. **Comparar un
   timestamp de `create` contra uno de `update`/`approve` para afirmar
   "avanzó" es la aserción que ya rompió US-29 en su PR#1** (falso verde
   corregido después) y que US-28 documentó primero. La única aserción
   válida de monotonía es **entre dos escrituras del mismo tipo** (dos
   `update`, o `create → approve` tratando ambos como "escrituras vía
   trigger" — hay que decidir en el diseño si `approveShop`/`disapproveShop`
   pasan por el mismo trigger que `update`, lo cual es casi seguro ya que
   son un `UPDATE` de la misma fila). Mitigación: en el test de integración,
   comparar `updateShop → updateShop` o `approveShop → disapproveShop`,
   nunca `createShop → *`.

3. **MEDIO-ALTO — `products_count` en la respuesta de `update`/`approve`/
   `disapprove` puede quedar plantado en `0` para tiendas con productos
   reales.** Hallazgo propio de esta exploración, no nombrado explícitamente
   por la US ni por el orquestador. `toShopDto` usa `record.productsCount ??
   0` (`shops.service.ts:61`); `ShopRecord.productsCount` es **opcional**
   porque `findOrCreateShopBySlug` (scraper) no lo calcula. Si
   `updateShop`/`approveShop`/`disapproveShop` en el repositorio hacen un
   `prisma.shop.update(...)` **sin** el mismo `include: COUNT_PRODUCTS` que
   usan `listShops`/`findShopBySlug`, la respuesta de un `PUT` sobre
   "grocery-shop" (584 productos publicados) mostraría `products_count: 0`
   — contradice la Decisión 3 del épico ("misma proyección que el GET por
   slug", que razonablemente incluye los mismos *valores*, no solo las
   mismas *claves*). CA-1 solo exige `products_count: 0` para `create`
   (correcto ahí, la tienda es nueva); CA-2/CA-3 no lo mencionan
   explícitamente, así que es una zona gris que `sdd-design` debe resolver:
   o las tres funciones de escritura recalculan `productsCount` con el mismo
   `COUNT_PRODUCTS` (coste: una sub-query más en cada escritura, tabla
   pequeña — 12 filas — impacto marginal), o se declara explícitamente que
   `products_count` en la respuesta de escritura es siempre `0`/no fiable y
   el admin debe refrescar con un `GET` (paralelo a la divergencia #1 de
   US-29 sobre `categories`/`tags` post-`DELETE`).

4. **MEDIO — `owner_id` inmutable en `PUT`.** La US no lo declara
   explícitamente como CA, pero nota 2 dice *"`owner_id` sale siempre del
   token, nunca del body"* — eso cubre `create`. Para `update`, ¿puede un
   `super_admin` reasignar `owner_id` de una tienda vía `PUT`? El
   `CreateShopDto`/`PickType` no incluye `owner_id`, así que el body nunca
   lo trae — la pregunta es si el repositorio debe aceptarlo como campo
   opcional del input (para una futura `transfer-shop-ownership`, fuera de
   alcance) o ignorarlo por completo si llegara. Recomendación: `owner_id`
   **no** forma parte de `UpdateShopInput` en absoluto (ni siquiera como
   campo ignorado) — es coherente con "NO incluye
   `transfer-shop-ownership`" del scope, y evita abrir una superficie de
   escritura no pedida.

5. **BAJO — colisión de slug con el scraper.** `findOrCreateShopBySlug` (el
   scraper) también genera tiendas por slug; una tienda creada por el admin
   con un `slug`/`name` que coincida con un retailer futuro produciría un
   `P2002` → 409, comportamiento correcto y ya cubierto por
   `translateCatalogWriteError`. Se menciona solo para que el test de
   integración no elija un prefijo de centinela que pudiera parecerse a un
   slug de retailer real (`alkosto`, `exito`, etc. — usar `zz-shops-` es
   seguro, mismo patrón que `zz-products-`/`zz-categories-`).

6. **BAJO — `ApproveShopDto`/`admin_commission_rate` vestigial.** El DTO
   declara el campo pero el controller ni lo usa ni lo tipa
   (`@Body('id') id` suelto). CA-3 ya dice "se ignora y se declara" — no es
   un riesgo de implementación, solo una limpieza cosmética opcional (fuera
   de alcance si no se pide).

## Alcance — límite vinculante (restatement del "NO incluye")

Lo que esta US **NO** implementa, para que ninguna fase posterior lo derive
por cercanía:

- **`DELETE /shops/:id`** — sin consumidor en el admin (confirmado: no
  existe `useDeleteShopMutation` ni `shop-delete-view.tsx`) y arrastraría en
  cascada los productos de la tienda (`products.shop_id ON DELETE CASCADE`,
  `schema.sql:332`). Sigue siendo el string del scaffold, declarado.
- **`POST /shops/approve`, `POST /shops/disapprove`** (dentro de
  `ShopsController`, rutas con `@Param('id')` no ligable) — rutas
  publicadas sin consumidor real; se dejan tal cual, **no se borran**.
- **`POST /staffs`, `PUT /staffs/:id`, `DELETE /staffs/:id`** — sin relación
  staff↔tienda en el DDL (diferido, requiere columna). Solo `GET /staffs`
  se desmockea (decisión 11 del épico), sin cambiar su key-set ni su
  comportamiento observable (paginador vacío).
- **`balance`, `admin_commission_rate`, `categories: number[]`** — sin
  columna; se aceptan en el DTO (donde ya existan) y se descartan al
  escribir, declarados en el reporte final.
- **`transfer-shop-ownership`/`ownership-transfer`** — módulo aparte, mock,
  fuera de esta US por completo.
- **Frontend** (`apps/shop`, `apps/admin`) — cero líneas tocadas. Si alguna
  verificación pareciera exigir un cambio de formulario, es señal de que el
  contrato se rompió: parar y preguntar (regla global del épico).
- **DDL / `db/schema.sql` / `db-reset`** — esta US no añade columnas ni
  toca el esquema (decisión 1 del épico, heredada).

## Superficie de verificación

- **Postgres ya está arriba** (`safari-postgres Up (healthy)`, puerto 5433)
  — no hace falta `just db-up`. Si `packages/db/dist/` no existe o está
  obsoleto, `just db-build` primero (bloqueante, gitignored).
- **Gate de integración**: `just db-check` (vitest de `packages/db`,
  `fileParallelism: false` ya presente — corridas de integración en serie).
  Hoy en verde con 186/186 tests (heredado de US-29); tras US-30 el conteo
  debe subir con los nuevos `it` de `shops.integration.test.ts`.
- **Gate unitario de la API**: `cd apps/api/rest && npx jest` — hoy 9
  suites / 204 tests en verde (heredado de US-29, no las "4 suites / 65
  tests" que `CLAUDE.md` sigue documentando de forma obsoleta — divergencia
  ya declarada por US-29, fuera de alcance corregirla aquí).
- **Build**: `just build-api` (bloqueante — Nest debe compilar limpio tras
  quitar `plainToClass`/`shops.json`). `just build` (shop+admin) no es
  necesario si el diff de `apps/shop`/`apps/admin` queda vacío (mismo
  criterio que aplicó el verify-report de US-29).
- **Smoke de los 3 servicios**: `just verify` (cuenta product-cards reales
  en los 3 puertos: API 9001, shop 3003, admin 3002 — **nunca 9000**,
  ocupado por Zscaler en equipos corporativos).
- **Evidencia HTTP**: `curl` contra `http://localhost:9001/api/...` con
  tokens reales (`POST /api/token`), replicando la secuencia de la DoD:
  `POST /shops` (store_owner) → `GET /new-shops` → reinicio real de la API
  → `approve-shop` (super_admin) → `GET /shops` → `PUT` propio (200) → `PUT`
  ajeno (403) → `disapprove-shop` → `GET /new-shops`.
- **`psql` directo**: `docker exec safari-postgres psql -U safari -d
  safari_scraper -c "..."` para conteos antes/después (`shops` debe volver a
  12, sin filas `zz-%`).
- **Herramientas ausentes, ya documentadas por el epic**: `jq` **no** está
  instalado en Git Bash — cualquier diff de JSON de la evidencia (p. ej.
  comparar key-sets de 16 claves) debe hacerse con `node -e`, nunca con
  `jq`. Precedente: `apply-progress.md`/`verify-report.md` de US-29 lo usan
  así en toda su evidencia.
- **Trampa de casing en Windows**: si `just db-check` reporta "0 tests" sin
  error visible, revisar el casing del cwd (`C:/DevOps/...` vs
  `c:/DevOps/...`) antes de sospechar de la base de datos — vitest en este
  checkout es sensible a esa mayúscula/minúscula (memoria ya registrada del
  usuario).

## Ready for Proposal

**Sí.** El terreno está completamente verificado: la única pieza de datos
que faltaba (`findShopOwnerById`) ya existe y no necesita cambios; el
patrón de traducción de errores, el aislamiento de vitest y el precedente de
forma (repositorio + servicio + proyección + tests) están todos ya
sentados por las tres US previas. Las únicas decisiones de diseño genuinas
que quedan abiertas son las cuatro de la sección "Preguntas abiertas" (con
recomendación ya dada para cada una) más el hallazgo nuevo de
`products_count` en escrituras (riesgo 3) — ninguna es bloqueante para
`sdd-propose`, pero `sdd-design` debe resolverlas con una DD-x explícita
cada una, siguiendo el precedente de rigor de `design.md` de US-29
(DD29-1..DD29-10).

Lo que el orquestador debe decirle al usuario: US-30 es la US más pequeña en
superficie de guardas de dominio del épico (cero CHECK propias) pero la que
migra más rutas (4: `create`/`update`/`approve-shop`/`disapprove-shop`, más
`getStaffs` desmockeado) — la estimación recalibrada de ~1550 líneas
(`README.md` del épico, «Sesgo de estimación medido») es consistente con lo
verificado aquí: no hay guardas que descubran volumen extra a mitad de
implementación (a diferencia de US-28/US-29), así que el riesgo de desborde
por *hallazgos nuevos de dominio* es más bajo que en las dos US anteriores;
el riesgo real está en las dos trampas de test (centinela + reloj) y en la
decisión de `settings`/`products_count`, no en CHECKs sorpresa.
