# Design: Escrituras y moderación de tiendas (US-30)

> Cierra las **tres preguntas abiertas** de `proposal.md:179-188` y ratifica
> `D30-1..D30-10` con cuatro refinamientos y ninguna revocación. Insumos:
> `proposal.md`, `exploration.md`, los 4 delta-specs, US-30 y `rules.design`
> de `openspec/config.yaml`. Precedente de forma:
> `openspec/changes/archive/2026-09-11-escrituras-productos-postgres/design.md`.
>
> **`D30-1` (REPLACE de `settings` con pérdida declarada) fue RATIFICADA por el
> dueño del repo el 2026-09-11. Este diseño especifica su mecánica; no la
> relitiga.**
>
> **Citas `archivo:línea` re-verificadas con `grep`/lectura el 2026-09-11**, no
> heredadas: `@Body('id')` está en `shops.controller.ts:109` y `:120` (no
> `:108`); `ADMIN_ONLY` en `permissions.decorator.ts:20` y `ADMIN_AND_OWNER`
> en `:21`. `sdd-apply` MUST re-greppear antes de tocar.
>
> Este diseño aporta **cinco hallazgos nuevos verificados** que ninguna fase
> anterior nombró (`nuevo A..E` en § Riesgos): una tienda centinela viva rompe
> **otro archivo** de tests (`users`); una centinela **activa con `location`**
> rompe un tercero (`listShopsNear`); **`POST /staffs` y `PUT /staffs/:id`**
> dejan de **compilar** al migrar `create`/`update`; `PUT {"name": ""}`
> persiste una tienda sin nombre y `{"name": null}` da 500; y las filas de la
> evidencia manual sobreviven al predicado de rollback si no llevan el
> prefijo centinela. El prefijo `zz-shops-` de `D30-7` se refina además por un
> assert de `listShops` (condicional — ver `DD30-6`).
>
> **Ronda correctiva única tras `GATE: FAIL`.** Dos defectos bloqueantes
> confirmados —`PUT /staffs/:id` (`DD30-8`) y un tripwire ciego a las
> centinelas **inactivas**, que son el caso normal de esta US (`DD30-6`)— más
> siete correcciones menores, cerradas en § Correcciones aplicadas.

## Technical Approach

Tres funciones nuevas en `packages/db/src/repositories/shops.repository.ts`
(mismo archivo que las lecturas y que `findOrCreateShopBySlug`, `D-2`), cuatro
métodos de Nest migrados y `getStaffs` desmockeado. La forma es la de US-29 sin
su aparato: input tipado campo a campo, `translateCatalogWriteError` en el
`catch` del repositorio, `toWriteHttpException(error)` como única línea del
`catch` del servicio.

Lo propio de `shops`, y el contenido real de esta US:

| # | Propio de `shops` | Consecuencia |
|---|---|---|
| 1 | **Cero** CHECK y cero `IN` (`db/schema.sql:231-244`) | `DD30-10`: ni una guarda de dominio nueva; el `catch` es **una** llamada |
| 2 | El dueño es una **columna de la propia fila** (`owner_id`), no de otro agregado | `DD30-3`: **una** sonda resuelve 404 y 403; `products` necesitaba dos |
| 3 | `@Body('id')` **sin tipar** en las 2 rutas de moderación | `DD30-3`: la guarda numérica es la diferencia entre 400 y **500** |
| 4 | Sus filas las cuentan **tres** archivos de test distintos | `DD30-6`: el radio de explosión del centinela es mayor de lo que decía `D30-7` |
| 5 | `is_active` es a la vez columna editable y **decisión de moderación** | `DD30-2`: excluirla del input de edición es una regla de seguridad, no de estilo |

## Architecture Decisions

### DD30-1 — `setShopActive(id, isActive)`: **una** función, dos métodos de servicio (cierra la pregunta 1)

`D30-1` de la US nombra `setShopActive`; se **ratifica** con firma
`setShopActive(id: number, isActive: boolean): Promise<ShopRecord>`.

| Opción | Coste | Decisión |
|---|---|---|
| Una función con booleano | 1 `catch`, 1 `include`, **1 sola guarda numérica en el servicio** (`_setActive`; el repositorio no lleva ninguna — `DD30-3`) | **Elegida** |
| `approveShop`/`disapproveShop` hermanas | ~25 líneas duplicadas; el barrel pasa de 3 a 4 funciones (rompe la superficie declarada en `proposal.md:33`); dos rutas que pueden divergir en un fix futuro | Descartada |
| Reusar `updateShop(id, { isActive })` | Exigiría `isActive` en `UpdateShopInput` → **agujero de escalada** (ver `DD30-2`) | **Prohibida** |

`approve`/`disapprove` no son dos operaciones: son **una** operación sobre una
columna booleana. La asimetría vive donde de verdad existe —dos rutas
publicadas— es decir en el servicio: `approveShop(id)`/`disapproveShop(id)`
delegan en un privado `_setActive(rawId, isActive)`. Es también lo que impide
la repetición del defecto de US-29 («una guarda heredada en un camino y no en
el otro»): hay **un solo** camino.

### DD30-2 — `slug`, `ownerId` e `isActive` **no existen** en `UpdateShopInput` (cierra la pregunta 2)

**`slug` no se declara en ninguno de los dos inputs, ni siquiera en
`CreateShopInput`.** Es más fuerte que el `Omit<…,'slug'>` de US-29: allí
`slug` existía en el create porque `product-form.tsx:147` lo envía; aquí
`CreateShopDto` (`create-shop.dto.ts:4-12`) hace `PickType(Shop, ['name',
'address', 'description', 'cover_image', 'logo', 'settings', 'balance'])` —
**`slug` no está en la lista**, así que el admin nunca lo manda. Declararlo
abriría un canal de escritura sin productor. `createShop` lo deriva con
`generateSlug({ name: input.name }, shopSlugs, 'shops')`; `CA-2` («`slug` no
cambia aunque cambie `name`») queda garantizada **estructuralmente**: no hay
clave por la que pudiera cambiar.

`ownerId` e `isActive` sí existen en `CreateShopInput` (obligatorios) y se
excluyen del update **a nivel de tipo**:

```ts
export type UpdateShopInput = Partial<Omit<CreateShopInput, 'ownerId' | 'isActive'>>;
```

- `ownerId`: `D30-3` ratificada — sale siempre del token (nota 2 de la US) y
  aceptarlo abriría la puerta a `transfer-shop-ownership`, fuera de alcance.
- `isActive`: **regla de seguridad, no de estilo.** `PUT /shops/:id` está
  protegido por `ADMIN_AND_OWNER` (`shops.controller.ts:46`,
  `permissions.decorator.ts:21`), que **incluye `store_owner`**. Si `isActive`
  fuera editable por el `PUT`, un `store_owner` haría `PUT /shops/:propio`
  con `is_active: 1` y **se auto-aprobaría**, esquivando el `ADMIN_ONLY`
  (`:20`) de `approve-shop` y vaciando la cola de moderación que esta US
  existe para hacer real.

  **La construcción campo a campo del servicio (`R30-7`) es la ÚNICA defensa
  real; el DTO no defiende nada** (corrección del gate). `main.ts:9` registra
  `new ValidationPipe()` **sin `whitelist`**, así que el pipe no descarta
  propiedades no declaradas, y `@Body()` entrega el objeto crudo: que
  `UpdateShopDto` (`PartialType(CreateShopDto)`) no declare `is_active` es
  documentación de Swagger, **no** un filtro de runtime. Un
  `PUT {"is_active": 1}` llega íntegro al servicio y solo muere ahí, porque
  ninguna línea lo copia al input. Corolario vinculante para `sdd-apply`:
  **cualquier futuro `...dto` hacia `UpdateShopInput` reabre la escalada de
  privilegio**, sin que ningún tipo ni ningún pipe avise.

### DD30-3 — Frontera numérica y semántica de `null`: 404, 403 y 400 sin solaparse (cierra la pregunta 3)

`findShopOwnerById` (`shops.repository.ts:174-178`) devuelve `null` para
**dos** causas: id no entero seguro positivo, y tienda inexistente. Se
consume **tal cual**; la desambiguación vive en el orden del servicio.

| Ruta | Paso previo | `null` significa entonces | Desenlace |
|---|---|---|---|
| `PUT /shops/:id` | `!Number.isSafeInteger(id) \|\| id <= 0` → **404** ya disparó | **solo** «la tienda no existe» | **404** (nunca 403) |
| `PUT /shops/:id` | — (valor no nulo) | el dueño real de la fila | `≠ sub` y no `super_admin` → **403** |
| `approve/disapprove-shop` | guarda de `@Body('id')` → **400** ya disparó | *(no se usa la sonda)* | `P2025` del `update` → **404** |

**Nivel A (servicio), `PUT`**: `!Number.isSafeInteger(id) || id <= 0` → 404.
Precedente literal `products.service.ts:456` y `:568`. `+id` de `"abc"` es
`NaN`; sin esta línea el `NaN` llega a `BigInt(NaN)` → `RangeError` **sin
`.code`** → invisible para los dos traductores → **500**.

**Nivel A (servicio), moderación** — el borde que `shops` tiene y `products`
no. `@Body('id') id` está **sin tipar** (`shops.controller.ts:109`, `:120`):
llega el JSON crudo. La guarda es normativa y va en `_setActive`:

```ts
const parsed = typeof rawId === 'number' || typeof rawId === 'string' ? Number(rawId) : Number.NaN;
if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new BadRequestException(/* … */);
```

- `Number.isSafeInteger`, **nunca `Number.isInteger`**: `Number.isInteger(1e21)`
  es `true`, el valor llega al driver y produce un error de rango **sin
  `.code`** → 500. Es la mitad de `D29-4` que US-29 tuvo que corregir.
- `<= 0` cierra `{"id": 0}` y `{"id": ""}` (ambos dan `Number(...) === 0`).
- El estrechamiento por `typeof` cierra `{"id": true}` → `Number(true) === 1`,
  que sin él **moderaría la tienda 1**; y cierra también `{"id": null}`,
  `{"id": []}` y `{"id": {}}`, porque ninguno es `number` ni `string` y
  `Number(...)` **nunca llega a evaluarse** (no es `<= 0` quien los atrapa —
  corrección del gate). Es una expresión, no un aparato; la alternativa
  (`Number(rawId)` a secas) se declara y se descarta aquí para que nadie la
  reintroduzca por brevedad.
- `Number(id)` se conserva (nota 4 de la US): el admin manda `number`, pero
  `ValidationPipe` corre sin `transform` (`main.ts:9`).

**Nivel A' (repositorio)**: la guarda interna de `findShopOwnerById` se
consume sin tocarla. Tras el nivel A es redundante **y esa redundancia es lo
que colapsa `null` a un único significado** — exactamente el paso que US-29
tuvo que explicitar en `DD29-4`.

**Las tres funciones nuevas NO llevan guarda numérica propia.** Su
precondición documentada es «`id` entero seguro positivo, garantizado por el
llamador», idéntica a la que ya tienen `updateProduct`/`deleteProduct` (que
tampoco la llevan). `D30-9` prohíbe guardas nuevas y el spec sitúa la guarda
«antes de llegar a `@safari/db`». **Corolario para `sdd-tasks`**: el caso «id
no entero» de PR#2 no es un test de vitest —probaría una precondición
indefinida— sino un `it` del spec de jest (PR#4).

### DD30-4 — jsonb: dos niveles de nulidad, uno por capa

El tipo `Prisma.InputJsonValue` **no admite `null`**, pero el tsconfig de la
API no activa `strict`: un `null` del body cruza la frontera sin que el
compilador lo note. Por eso el predicado difiere por capa, y ahí está el 500
que esta tabla cierra.

| Campo | DDL (`schema.sql`) | Predicado en el **servicio** | Predicado en el **repositorio** | Por qué |
|---|---|---|---|---|
| `settings` | `jsonb NOT NULL DEFAULT '{}'` (`:241`) | `dto.settings != null` | `input.settings !== undefined` (**literal del spec**) | `"settings": null` hacia una columna `NOT NULL` → `P2011`, que **ningún traductor reconoce** → 500. En el repositorio el tipo ya lo hace irrepresentable, así que ambos predicados coinciden |
| `address` | `jsonb NOT NULL DEFAULT '{}'` (`:240`) | `dto.address != null` | `input.address !== undefined` | ídem |
| `logo` | `jsonb` nullable (`:238`) | `dto.logo != null` | `input.logo != null` | `D30-2`: precedente exacto de `image` en `categories.repository.ts:467,540` |
| `cover_image` | `jsonb` nullable (`:239`) | `dto.cover_image != null` | `input.coverImage != null` | ídem |
| `description` | `text` nullable (`:235`) | `!== undefined` | `!== undefined` (create: `?? null`) | `null` **sí** es escribible y significa «sin descripción» |

`settings` es **REPLACE completo** (`D30-1`, ratificada): el spread condicional
escribe el objeto entero o no escribe nada. Nunca `{ ...current.settings,
...input.settings }`. La pérdida de `shopMaintenance` en un `PUT` de
`super_admin` es una propiedad declarada del comportamiento nuevo.

Se sigue el precedente de US-29 **sin diverger**: `PUT {"logo": null}` es un
**no-op declarado** (divergencia #2). No se ensancha el tipo con
`Prisma.DbNull`: sería un patrón nuevo en la última US del épico, sin
consumidor que lo pida.

### DD30-5 — `products_count`: el mismo `include: COUNT_PRODUCTS` en las tres escrituras

`D30-4` ratificada. `COUNT_PRODUCTS` (`shops.repository.ts:30-32`) es
module-private y las tres funciones nuevas viven en el **mismo archivo**: se
reutiliza sin exportarlo (precedente `DD29-8`). Las tres cierran igual que
`listShops:60-63` y `findShopBySlug:80`:

```ts
return { ..._toShopRecord(row), productsCount: row._count.products };
```

Así `productsCount` es **siempre** un `number` y el `?? 0` de
`shops.service.ts:61` **nunca se ejerce** en las cuatro rutas de esta US. Sin
el `include`, un `PUT` sobre `grocery-shop` (584 productos) respondería
`products_count: 0`: divergencia silenciosa que un diff de claves no ve —
siguen siendo 16. `createShop` emite `0` porque la tienda es nueva, no por un
fallback (`CA-1`).

**El cuerpo del `PUT` es load-bearing para el admin — medido**:
`useUpdateShopMutation` (`apps/admin/rest/src/data/shop.ts:60-70`) hace
`await router.push(\`/${data?.slug}/edit\`)` en su `onSuccess`, es decir
**navega con el `slug` de la respuesta**. No es un defecto —las 16 claves de
`toShopDto` incluyen `slug`, y `DD30-2` lo mantiene invariante— pero fija una
obligación: la respuesta del `PUT` MUST seguir emitiendo `slug`, y por eso las
tres escrituras devuelven el `ShopRecord` completo en lugar de un acuse. Se
mide igual que el consumidor de `POST /staffs` (`DD30-8`), que resultó no leer
el cuerpo: aquí sí lo lee.

### DD30-6 — Centinela `zz-tiendas-`, no `zz-shops-`: el radio de explosión real (refina `D30-7`)

**Tres hallazgos verificados que el prefijo propuesto no cubre.**

1. **`zz-shops-` rompe un assert de `listShops` — condicionalmente.**
   `shops.integration.test.ts:41` asserta
   `listShops({ name: 'shop' }).total === 7`, con `contains … mode:
   'insensitive'` sobre **`name`** (`shops.repository.ts:43`). La causalidad
   va del **nombre al slug**, no al revés: `createShop` deriva el slug del
   nombre, así que un centinela pensado para el slug `zz-shops-alfa` se
   **llama** `zz-shops-alfa`, y es ese **nombre** el que contiene «shop» →
   `toBe(7)` pasa a 8. **La condición**: `listShops` filtra
   `isActive: input.isActive ?? true` (`:42`), de modo que solo rompe una
   centinela **activa** — y esta US crea sobre todo inactivas. El riesgo es
   condicional, pero el prefijo MUST ser seguro en **ambas** columnas de
   todas formas: **`zz-tiendas-`**. No colisiona con ningún slug de retailer
   del scraper y mantiene la convención `zz-` del épico.
2. **Una tienda centinela viva rompe OTRO archivo, activa o no**:
   `users.integration.test.ts:88` y `:147` assertan
   `user?.shops).toHaveLength(12)` para `store_owner@demo.com` (**usuario 1**,
   `db/seed.sql:53`), dueño hoy de las 12. `USER_RELATIONS`
   (`users.repository.ts:153-157`) incluye `shops: true` **sin `where`**: a
   diferencia del punto 1, aquí **`is_active` no filtra nada** y una
   centinela inactiva de usuario 1 lo rompe igual. Mitigación estructural:
   los centinelas de vitest se crean con **`ownerId: 3`** (`admin@demo.com`,
   `db/seed.sql:51`, dueño de **cero** tiendas hoy). Un fallo de limpieza
   degrada a **un** archivo rojo, no a dos.
   **El escudo `ownerId: 3` es exclusivo de vitest y NO aplica a la evidencia
   manual**: por `D30-3` el `owner_id` sale del token, así que todo `POST
   /shops` con token `store_owner` crea filas de **usuario 1** — justo las que
   rompen `users.integration.test.ts`. Para el `curl` la única protección es
   el prefijo obligatorio + el borrado **antes** de `just db-check` (ver
   abajo).
3. **Una tienda centinela ACTIVA con `settings.location` rompe un tercer
   assert**: `listShopsNear` filtra `where: { isActive: true }`
   (`shops.repository.ts:150`) y `shops.integration.test.ts:68-69` asserta
   `length <= 6`. El `it` que ejercita `settings.location` MUST crear la
   tienda con `isActive: false` **y** borrarla en el mismo `it`.

Esquema, en el mismo archivo:

```ts
const SENTINEL_PREFIX = 'zz-tiendas-';
const cleanupSentinel = () =>
  prisma.shop.deleteMany({ where: { slug: { startsWith: SENTINEL_PREFIX } } });
```

- **`beforeAll(cleanupSentinel)` hay que CREARLO**: `shops.integration.test.ts`
  **no tiene `beforeAll`** hoy (solo el `afterAll` de `:12-14`). Corrige la
  letra de `D30-7`. Cubre la corrida abortada previa.
- **La limpieza se pliega DENTRO del `afterAll` existente**, antes del
  `$disconnect()`. Motivo real (no el rationale invertido que US-29 tuvo que
  corregir): con el default `sequence.hooks: 'stack'` un segundo `afterAll`
  correría en orden **inverso** al de registro —es decir, antes del
  `$disconnect`, y funcionaría—, pero cambiar ese default a `'list'` lo
  dejaría corriendo contra un cliente ya desconectado. **Un solo hook no tiene
  ese modo de fallo.**
- **Los describes de escritura van DESPUÉS** de los de lectura (vitest ejecuta
  los `describe` en orden de archivo), así que el assert de no-regresión de
  `:91-95` corre antes de que exista ningún centinela. **Y cada `it` borra lo
  que crea.**
- **Tripwire dentro del archivo — y NO puede apoyarse en `listShops`**
  (defecto bloqueante del gate). `packages/db/vitest.config.ts`
  (`fileParallelism: false`, ya existente, US-29) serializa **archivos**; no
  hace nada contra una fila que sobreviva a su propio `it` **dentro del mismo
  archivo**. Ese hueco lo cierra un último `it` — pero repetir
  `total === 12` e `items[0].id === 15` **no sirve**: `listShops` filtra
  `isActive: input.isActive ?? true` (`shops.repository.ts:42`) y las 12
  filas del seed están **todas activas** (`SELECT is_active, count(*) FROM
  shops GROUP BY is_active` → `t|12`), así que una centinela **inactiva**
  superviviente deja ambas aserciones en verde. Y la inactiva es el caso
  **normal** aquí: `D30-6` hace nacer inactivas las del `store_owner` y el
  punto 3 de esta decisión **exige** `isActive: false`. El tripwire sería
  ciego justo donde se concentra el riesgo — la misma clase de falso verde
  que `DD30-7` existe para prevenir. **Forma normativa**, independiente del
  filtro de lectura:

  ```ts
  expect(await prisma.shop.count()).toBe(12);                    // sin filtro de is_active
  expect((await listShops({ isActive: false })).total).toBe(0);  // la cola vuelve vacía
  expect((await listShops()).items[0].id).toBe(15);
  ```

  El cierre con `psql` (`slug LIKE 'zz-tiendas-%'` → 0) también lo cazaría,
  pero solo **después** de que la suite ya reportó verde: ese es precisamente
  el modo de fallo.
- **La evidencia HTTP manual usa el MISMO prefijo** (`name:
  "zz-tiendas-prueba"`). Los nombres «Tienda Prueba»/«tienda-prueba» de los
  escenarios del spec son etiquetas ilustrativas: con ellos, el `DELETE …
  WHERE slug LIKE 'zz-%'` del plan de rollback **no los alcanzaría** y el
  siguiente `just db-check` saldría rojo por `total === 12`. Regla vinculante:
  **toda fila creada por verificación —vitest o `curl`— lleva el prefijo**, y
  las filas del `curl` se borran **antes** de correr `just db-check`.

### DD30-7 — Monotonía de `updated_at`: solo entre dos escrituras del mismo reloj (`D30-8` ratificada y endurecida)

Mecanismo **verificado en código**, no inferido: `schema.prisma:81-82` declara
`createdAt`/`updatedAt` con `@default(now())` y **sin `@updatedAt`**, así que
Prisma liga ambos valores como parámetros del `INSERT` desde **Node**
(confirmado con `log:['query']` y documentado en
`categories.integration.test.ts:280-291`), mientras que `prisma.shop.update`
**no toca** la columna y la deja al trigger `shops_updated_at BEFORE UPDATE`
(`db/schema.sql:492`), con el reloj de **Postgres**. En Docker Desktop/Windows
los dos relojes divergen cientos de ms.

**Regla normativa**: ninguna aserción compara un timestamp del camino `create`
con uno del camino `update`. La monotonía se afirma **solo**
`updateShop → updateShop` o `setShopActive → setShopActive` (approve →
disapprove), y con **`toBeGreaterThan` estricto, nunca `toBeGreaterThanOrEqual`**:
con `>=`, el fallo exacto que el test existe para cazar —el trigger sin
disparar, `updated_at` congelado— produce una **igualdad** y el test pasa.

### DD30-8 — `POST /staffs` **y `PUT /staffs/:id`** dejan de compilar: dos stubs propios (hallazgo nuevo)

`StaffsController` reusa **dos** de los métodos que esta US migra, con la
aridad de hoy:

| Call site | Llamada actual | Método migrado | Efecto al añadir el parámetro |
|---|---|---|---|
| `shops.controller.ts:79` | `shopsService.create(createShopDto)` — 1 arg | `create(dto, user)` | **TS2554** |
| `shops.controller.ts:94` | `shopsService.update(+id, updateShopDto)` — 2 args | `update(id, dto, user)` | **TS2554** |

Ambos son un fallo **duro** de `just build-api`: `TS2554` («Expected 3
arguments, but got 2») se emite **independientemente de `strict`**, que no
gobierna la aridad. *(Corrección del gate: la redacción anterior cubría solo
`create` y además especulaba con un `TypeError` en runtime «sin `strict`» —
el build no llega a producir salida.)*

Tres salidas; se elige la tercera, **para los dos**:

| Opción | Consecuencia |
|---|---|
| Pasarles `@CurrentUser()` y delegar | `POST /staffs` **crearía una tienda** y `PUT /staffs/:id` **editaría una tienda de verdad**, ambas rutas declaradas fuera de alcance. Inaceptable |
| `user` opcional en `create`/`update` | Tipo mentiroso y una rama muerta en las dos rutas calientes de la US |
| **Métodos stub propios** `createStaff()` y `updateStaff()` en el servicio, declarados | **Elegida** |

**Divergencia declarada**: `POST /staffs` y `PUT /staffs/:id` pasan de
devolver la fila 0 del mock a un stub explícito. Preservar el cuerpo byte a
byte es **imposible** una vez que `shops.json` sale del servicio (`CA-6`);
lo que el spec exige preservar es el **comportamiento de stub**, y eso se
mantiene: ninguna de las dos escribe nada. **Sin impacto medido en el
admin**: `useAddStaffMutation` declara `onSuccess: () => {…}` **sin
parámetro** (`apps/admin/rest/src/data/staff.ts:37-38`), así que no lee el
cuerpo.

**Genuinamente no afectadas** (verificado): `DELETE /staffs/:id`
(`shops.controller.ts:98-100`) → `remove()`, y `POST /shops/approve` /
`POST /shops/disapprove` (`:61-69`) → `approve()`. **Ninguno de esos dos
métodos se migra en esta US**, así que su firma no cambia y las tres rutas
siguen tal cual, sin tocarlas.

### DD30-9 — `normalizeSlug(input.name)` en `updateShop`: reutilización, no guarda nueva

`updateShop` llama `await normalizeSlug(input.name, 'shops')` **descartando el
resultado**, solo por su efecto lateral, cuando `input.name !== undefined`.
`shops.name` es `text NOT NULL` donde `''` es legal: sin esta línea,
`PUT {"name": ""}` persiste una tienda sin nombre con 200, y `{"name": null}`
llega a Prisma como violación de `NOT NULL` (`P2011`, no traducible) → **500**.

No es una guarda nueva (`D30-9` intacta): es **el mismo call site que ya
existe en 5 de 5 agregados** — `categories.repository.ts:511`,
`manufacturers:191`, `products:763`, `tags:164`, `types:124` — y su error
(`EmptySlugError` → 400) ya pertenece al conjunto cerrado. En `createShop` la
protección es automática: `generateSlug` pasa por `normalizeSlug`
(`slug.ts:82`), que rechaza `''` y cualquier no-string (`slug.ts:46-48`).

### DD30-10 — Cero guardas de dominio: un solo `catch`, sin `uniqueField`

`D30-9` **ratificada sin matices**. `db/schema.sql:231-244` verificado: cero
CHECK, cero `IN`, una FK saliente (`owner_id → users(id) ON DELETE RESTRICT`)
y un `UNIQUE` (`slug`). El `catch` de las tres funciones es **una sola
llamada** — sin `_translateCheckViolation`, que no tiene análogo aquí:

```ts
} catch (error) {
  throw translateCatalogWriteError(error, { aggregate: 'shops', id });
}
```

(`createShop` sin `id`.) **Sin `uniqueField`**, siguiendo la corrección ya
embarcada de `createCategory` (`categories.repository.ts:486-488`): bajo
Prisma 7 + `adapter-pg` un `P2003` llega sin `meta.field_name`, y un
`uniqueField: 'slug'` fijo culparía a `slug` de una FK rota. El coste es que
el mensaje del 400 por `owner_id` dice `shops.desconocida` — divergencia
heredada y ya declarada en US-28.

## Contratos de tipos

```ts
// packages/db/src/repositories/shops.repository.ts  (público)
export interface CreateShopInput {
  name: string;                        // shops.name        text NOT NULL            (schema.sql:233)
  ownerId: number;                     // shops.owner_id    bigint NOT NULL          (:236) — del token (D30-3)
  isActive: boolean;                   // shops.is_active   boolean NOT NULL         (:237) — explícito por rol (D30-6),
                                       //                    NUNCA apoyado en el DEFAULT true
  description?: string | null;         // shops.description text NULL                (:235) — `null` sí escribible
  logo?: Prisma.InputJsonValue;        // shops.logo        jsonb NULL               (:238) — `null` ⇒ ausente (DD30-4)
  coverImage?: Prisma.InputJsonValue;  // shops.cover_image jsonb NULL               (:239) — ídem
  address?: Prisma.InputJsonValue;     // shops.address     jsonb NOT NULL DEFAULT {} (:240)
  settings?: Prisma.InputJsonValue;    // shops.settings    jsonb NOT NULL DEFAULT {} (:241) — REPLACE total (D30-1)
}

/** `slug` no existe en ningún input (DD30-2): la inmutabilidad de CA-2 es
 *  estructural. `ownerId`/`isActive` se excluyen del update por seguridad. */
export type UpdateShopInput = Partial<Omit<CreateShopInput, 'ownerId' | 'isActive'>>;

export async function createShop(input: CreateShopInput): Promise<ShopRecord>;
export async function updateShop(id: number, input: UpdateShopInput): Promise<ShopRecord>;
export async function setShopActive(id: number, isActive: boolean): Promise<ShopRecord>;

// privado (no va al barrel) — mismo patrón que `productSlugs`/`categorySlugs`:
// el nombre de tabla nunca llega a `slug.ts`
const shopSlugs: ExistingSlugLookup;
```

**Ausentes a propósito** (alcance vinculante): `balance`,
`admin_commission_rate`, `categories: number[]`, `slug`, `staffs`,
`notifications`, `distance`/`lat`/`lng`. El input se construye **campo a
campo** en el servicio; **nunca `...body`** (`R30-7`).

**Barrel `packages/db/index.ts`**, orden alfabético dentro de cada bloque de
`shops.repository`: al `export type` → `CreateShopInput`, `ListShopsInput`,
`ShopNearRecord`, `UpdateShopInput`; al `export` → `createShop`,
`findOrCreateShopBySlug`, `findShopBySlug`, `findShopOwnerById`, `listShops`,
`listShopsNear`, `setShopActive`, `updateShop`. **Sin conflicto con US-29**:
ya está archivada y en `main`.

**`create-shop.dto.ts`**: sin cambios de runtime (`main.ts:9` registra
`ValidationPipe` sin `whitelist` ni `transform`). Solo se **documentan** los
campos aceptados y descartados (`balance`, `categories[]`, y `owner_id`/
`is_active` si llegaran) — decisión 15. `ApproveShopDto` queda vestigial y
**no se toca**.

## Secuencias

```
POST /shops                      PUT /shops/:id                    POST /approve-shop | /disapprove-shop
 guard ADMIN_AND_OWNER            guard ADMIN_AND_OWNER             guard ADMIN_ONLY
  └ 401 sin token                  └ 401 / 403 customer, staff       └ 401 / 403 customer, staff, store_owner
  └ 403 customer, staff           ── servicio ──                    ── servicio: _setActive(rawId, flag) ──
 ── servicio ──                   1 !isSafeInteger(id)||id<=0 →404  1 typeof-narrow + Number(rawId)
 1 CreateShopInput campo a campo  2 findShopOwnerById(id)             !isSafeInteger||<=0 → 400  ◄ aquí muere "abc"
    ownerId = user.sub               └ null → 404 (NUNCA 403)       ── repositorio: setShopActive ──
    isActive = permissions              ◄ el paso 1 dejó a `null`   2 prisma.update({data:{isActive}},
      .includes('super_admin')            un único significado           include: COUNT_PRODUCTS)
    jsonb: != null (DD30-4)        3 super_admin? ── sí → salta 4      └ catch → translate (P2025 → 404)
 ── repositorio: createShop ──     4 ownerId !== sub → 403           3 updated_at ← trigger de Postgres
 2 generateSlug(shopSlugs)         5 UpdateShopInput campo a campo
    └ name ''/no-string → 400     ── repositorio: updateShop ──
 3 prisma.create(data,             6 name? → normalizeSlug → 400
     include: COUNT_PRODUCTS)      7 prisma.update(data,
    └ catch → translate                include: COUNT_PRODUCTS)
      P2002→409  P2003→400            └ catch → translate (P2025→404)
      │                                │                                │
      └──────────► servicio: toShopDto(record) — 16 claves ◄────────────┘
                   catch → toWriteHttpException(error)

GET /staffs   guard ADMIN_AND_OWNER (a nivel de clase, :72) →
              return { data: [], ...paginate(0, page, limit, 0, url) }   // sin I/O, sin JSON
```

**Lo normativo del orden**, no lo estético:

1. **La guarda numérica va primero, siempre**: es donde mueren el `NaN` que si
   no llega a `BigInt(NaN)` y el `"abc"` que si no llega al driver — ambos 500
   (`DD30-3`).
2. **404 antes que 403** en el `PUT`, y `null` de la sonda es **404, no 403**,
   porque el paso 1 ya eliminó la otra causa de `null`. No filtra nada:
   `GET /shops/:slug` es `@Public()` (`shops.controller.ts:40-44`).
3. **Una sola sonda**: en `shops` el dueño es columna de la propia fila, así
   que `findShopOwnerById` responde a la vez «¿existe?» y «¿de quién es?». En
   `products` hicieron falta dos porque el dueño vivía en otro agregado.
4. **El short-circuit de `super_admin` salta solo el 403**, nunca el 404: para
   `super_admin` el 404 sale igual del paso 2. **Un rol nunca cambia el status
   de una misma petición.**
5. **El 403 de `staff` sale del guard**, no del servicio (`ADMIN_AND_OWNER` no
   lo incluye). Es una garantía más fuerte que la de `products`
   (`WARNING-1` de US-29) y **no exige ninguna comprobación en el servicio**.

## Traducción de errores

| Origen | Error | Status |
|---|---|---|
| `generateSlug`/`normalizeSlug` con `name` vacío o no-string | `EmptySlugError` | **400** |
| `slug` calculado ya existente (`P2002`, solo por carrera) | `SlugConflictError` | **409** |
| `owner_id` inexistente (`P2003`) | `InvalidReferenceError` (`shops.desconocida`) | **400** |
| Fila inexistente en `update`/`setShopActive` (`P2025`) | `RecordNotFoundError` | **404** |
| `findShopOwnerById` → `null`, o `:id` no entero seguro positivo | *(ninguno — Nest)* `NotFoundException` | **404** |
| `@Body('id')` sin forma entera | *(ninguno — Nest)* `BadRequestException` | **400** |
| Propiedad ajena | *(ninguno — Nest)* `ForbiddenException` | **403** |
| Postgres caído | *(ninguno)* → `isConnectionFailure` | **503** |
| CHECK / `IN` de `shops` | — | **no existen** (`db/schema.sql:231-244`) |

`DependentRowsError` (409) es **inalcanzable**: esta US no borra tiendas.
Símbolos verificados por lectura: `translateCatalogWriteError`
(`domain-errors.ts:135-163`), `toWriteHttpException`
(`domain-error.mapper.ts:146-155`), `mapDomainError` (**`:81-98`**;
re-verificado en la ronda correctiva — `:99` es una línea en blanco, no
cuerpo de la función). El 500 de un error de escritura no traducido está
documentado **en el propio código** en `domain-error.mapper.ts:139-142`.
**`git diff` de `domain-errors.ts` y `common/errors/` MUST quedar vacío.**

## Estrategia de test

| Capa | Qué se prueba | Cómo |
|---|---|---|
| Integración (vitest) | crear con `isActive` por rol, editar, togglear, `slug` invariante, REPLACE de `settings`, no-op de `logo: null`, `productsCount` en las 3 escrituras, 404 de `P2025`, 409 de slug duplicado, 400 de `ownerId` inexistente, monotonía `update→update` | `shops.integration.test.ts` contra Postgres real (`just db-check`) |
| Unidad (jest) | 16 claves en orden, `is_active` por rol, propiedad (404/403/200), `@Body('id')` `"abc"`/`0`/`true` → 400, cada error de dominio → su status, `getStaffs` sin I/O | `shops.service.spec.ts` (hoy **5 `it`**, todos de lectura), `@safari/db` mockeado |
| Manual | secuencia `POST → GET /new-shops → reinicio → approve → PUT propio/ajeno → disapprove`, `near-by-shop` con `location`, key-set de `GET /staffs` antes/después, `D30-1` en `psql` | `curl` + `node -e` (**`jq` no está instalado**) |

- Centinela, propiedad de `ownerId: 3` y tripwire: **`DD30-6`**. Relojes:
  **`DD30-7`**.
- **`productsCount ≠ 0`**: un único `it` hace `updateShop(idDeGadget, {
  description: <su valor actual leído justo antes> })` —escritura
  idempotente— y asserta `44`, el mismo valor que
  `findShopBySlug('gadget')` (`:47-48`). Es la única forma de que vitest cace
  la regresión del `include` con un valor no-cero. **Única mutación sobre el
  seed: `gadget.updated_at`**, columna que ningún test lee. El `it` re-lee y
  asserta que `name`/`slug`/`description`/`isActive` no cambiaron. El id se
  resuelve por slug, nunca hardcodeado.
- `shops.service.spec.ts` amplía su `jest.mock('@safari/db', …)` (`:30-35`)
  con `createShop`, `updateShop`, `setShopActive` y `findShopOwnerById`; las
  clases de error siguen reales vía `jest.requireActual`.
  `toWriteHttpException` **no pasa por ese mock** (import directo de
  `src/common/errors/domain-error.mapper`). Los 5 `it` de lectura no se tocan.
- **`user-dto.mapper.spec.ts` debe re-correrse explícitamente** aunque esta US
  no lo edite: `user-dto.mapper.ts:7` importa `toShopDto` desde
  `src/shops/shops.service`, así que quitar `@db/shops.json` y `plainToClass`
  de ese módulo **cambia su grafo de módulos** (a mejor: el spec deja de
  arrastrar el JSON del mock). El «los 5 `it` de lectura no se tocan» de
  arriba **no** cubre esta suite.
- Cierre obligatorio de toda corrida: `SELECT count(*) FROM shops` → **12**,
  `SELECT count(*) FROM shops WHERE is_active = false` → **0**,
  `items[0].id` → **15**, `SELECT count(*) FROM shops WHERE slug LIKE
  'zz-tiendas-%'` → **0**.

## File Changes

| Archivo | Acción | Descripción |
|---|---|---|
| `packages/db/src/repositories/shops.repository.ts` | Modify | +3 escrituras, +2 inputs, +`shopSlugs`, `COUNT_PRODUCTS` ×3. `listShops`, `findShopBySlug`, `listShopsNear`, `findShopOwnerById` y `findOrCreateShopBySlug` **intactos** |
| `packages/db/src/repositories/shops.integration.test.ts` | Modify | `beforeAll` **nuevo** + limpieza plegada en el `afterAll` de `:12-14`; describes de escritura al final + tripwire **independiente del filtro `isActive`** |
| `packages/db/index.ts` | Modify | 3 funciones + 2 tipos, orden alfabético |
| `apps/api/rest/src/shops/shops.service.ts` | Modify | 4 métodos migrados + `getStaffs` + `createStaff()` y `updateStaff()` (`DD30-8`); fuera `@db/shops.json` (`:21`), `plainToClass` (`:7,30`) y `private shops` (`:95`); stubs declarados en comentario |
| `apps/api/rest/src/shops/shops.controller.ts` | Modify | `@CurrentUser()` en `:30` y `:48`; los call sites de `StaffsController` **`:79` → `createStaff` y `:94` → `updateStaff`** (`DD30-8`). **`@Permissions` sin tocar**; `@Body('id')` de `:109`/`:120` sin tipar (contrato); `:99` (`remove`) y `:62`/`:68` (`approve`) **intactos** |
| `apps/api/rest/src/shops/dto/create-shop.dto.ts` | Modify | Solo comentarios: campos aceptados y descartados |
| `apps/api/rest/src/shops/shops.service.spec.ts` | Modify | Escrituras, propiedad, `is_active` por rol, roles de `CA-5`, frontera numérica |
| `packages/db/vitest.config.ts`, `slug.ts`, `domain-errors.ts`, `common/errors/`, `findOrCreateShopBySlug`, `db/schema.sql`, `apps/{shop,admin}` | **Unchanged** | `D30-9` + decisiones 1 y 14 |

## Divergencias declaradas

| # | Divergencia | Estado |
|---|---|---|
| 1 | `settings` REPLACE borra `shopMaintenance` en un `PUT` de `super_admin` | `D30-1`, **ratificada por el dueño**; la DoD exige la evidencia que la hace visible |
| 2 | `PUT {"logo": null}` / `{"cover_image": null}` son **no-op** | `D30-2`; precedente ya embarcado (`DD29-7`, divergencia #10) |
| 3 | `PUT {"settings": null}` / `{"address": null}` son **no-op** (columnas `NOT NULL`) | Nueva, `DD30-4`; la alternativa era un 500 por `P2011` |
| 4 | Id inexistente en moderación: **500 → 404**; sin forma entera: **500 → 400** | `D30-5`, corrección de comportamiento intencional |
| 5 | `POST /staffs` **y `PUT /staffs/:id`** pasan de devolver la fila 0 del mock a un stub declarado | Nueva, `DD30-8`; sin consumidor del cuerpo (medido en `data/staff.ts:37-38`) |
| 6 | Mensaje del 400 por `owner_id`: `shops.desconocida` | Heredada de US-28 (`P2003` sin `meta.field_name`) |
| 7 | `owner: null` y `orders_count: 0` constantes también en las escrituras | Preexistente (V-4, nota 6 de la US) — **no se rellena** |
| 8 | `created_at`/`updated_at`: 3 decimales vs. 6 del mock | Ya embarcada |
| 9 | `balance`, `admin_commission_rate`, `categories[]`, `owner_id`/`is_active` del body: aceptados y descartados sin 400 | Alcance vinculante (decisión 5) |
| 10 | `CLAUDE.md` dice «4 suites / 65 tests»; hoy hay 9 | Adyacente **mencionado y NO accionado** |

## Riesgos → elemento que los neutraliza

| # | Riesgo | Neutralizado por |
|---|---|---|
| `R30-1` | Centinela superviviente rompe `toBe(12)`/`id 15`/`toBe(7)` | **`DD30-6`**: prefijo `zz-tiendas-`, `beforeAll` nuevo, limpieza en el hook existente, describes al final, y un tripwire **que no pasa por `listShops`** (si no, una centinela inactiva lo deja verde) |
| `R30-2` | Falso verde por comparar dos relojes | **`DD30-7`**: solo `update↔update`, `toBeGreaterThan` estricto |
| `R30-3` | Agujero de autorización | **`DD30-3`** (secuencia 404→403) + **`DD30-2`** (auto-aprobación imposible por tipo) |
| `R30-4` | `products_count: 0` silencioso | **`DD30-5`** + el `it` de `gadget` con valor 44 |
| `R30-5` | `{"id":"abc"}` → 500 | **`DD30-3`**, nivel A de moderación, con `isSafeInteger` y estrechamiento por `typeof` |
| `R30-6` | Pérdida de `shopMaintenance` | `D30-1` ratificada; `DD30-4` la mecaniza y la DoD la expone |
| `R30-7` | Spread del body a Prisma | Contratos campo a campo (`DD30-2`) |
| `R30-8` | Desborde de volumen | Cadena de 4 PRs; corte preacordado: PR#4 → US-30b |
| `R30-9` | `dist/` obsoleto / vitest «0 tests» | Toda verificación abre con `just db-build`; revisar el casing `C:/DevOps/…` |
| **nuevo A** | Tienda centinela —**activa o inactiva**— rompe `users.integration.test.ts:88,147` (`shops: true` sin `where`) | **`DD30-6`** punto 2: `ownerId: 3` en vitest; en el `curl`, prefijo + borrado previo a `db-check` |
| **nuevo B** | Centinela activo con `location` rompe `listShopsNear` (`:68-69`) | **`DD30-6`** punto 3: `isActive: false` + borrado en el mismo `it` |
| **nuevo C** | `POST /staffs` **y `PUT /staffs/:id`** rompen `just build-api` con `TS2554` | **`DD30-8`**: `createStaff()` + `updateStaff()` |
| **nuevo D** | `PUT {"name": ""}` persiste una tienda sin nombre; `{"name": null}` → 500 | **`DD30-9`** |
| **nuevo E** | Filas del `curl` sin prefijo sobreviven al rollback | **`DD30-6`**: prefijo obligatorio también en la evidencia manual |

## Migration / Rollout

Sin migración ni DDL: **esta US no añade ni una columna**. Rollback y cadena de
4 PRs: `proposal.md:146-228`, con dos enmiendas de este diseño: el predicado de
limpieza es `slug LIKE 'zz-tiendas-%'` (no `'zz-shops-%'`), y el caso «id no
entero» se mueve de PR#2 (vitest) a PR#4 (jest), por `DD30-3`. Toda
verificación abre con `just db-build` (`dist/` gitignored) y **reinicia la
API**; `just db-reset` **no** es necesario — si pareciera serlo, se rompió la
decisión 1: parar y preguntar.

**Re-anclaje**: el pronóstico de ~1550 (+200/−350) se mantiene. Los añadidos de
este diseño —`_setActive` privado (~15), `createStaff` **y `updateStaff`**
(~16), `normalizeSlug` en `updateShop` (~3), `ownerId: 3` y el tripwire del
centinela (~28), el `it` de `gadget` (~20)— suman **~82 líneas** (~70 antes de
la ronda correctiva) y caben en la banda alta. El *caveat* vinculante se
mantiene: si `sdd-apply` desborda, el corte es **levantar PR#4
(`shops.service.spec.ts`) a una US-30b**.

## Decisiones ratificadas / refinadas / revocadas

| Decisión | Estado | Motivo (una línea) |
|---|---|---|
| `D30-1` `settings` REPLACE, pérdida declarada | **Ratificada** | Cerrada por el dueño del repo; `DD30-4` solo especifica su mecánica y el borde `null` |
| `D30-2` `logo`/`cover_image` con `!= null` | **Ratificada** | `DD30-4`; precedente de US-29 seguido sin diverger |
| `D30-3` `owner_id` fuera de `UpdateShopInput` | **Ratificada y ampliada** | `DD30-2`: se le suma `isActive`, cuya inclusión sería una escalada de privilegio |
| `D30-4` `COUNT_PRODUCTS` en las 3 escrituras | **Ratificada** | `DD30-5`; el `?? 0` de `shops.service.ts:61` queda inejercido |
| `D30-5` 404 en moderación + guarda numérica | **Ratificada y detallada** | `DD30-3`: `isSafeInteger`, `<= 0` y estrechamiento por `typeof`; 400 y 404 no se solapan |
| `D30-6` `is_active` por rol al crear | **Ratificada** | Una expresión: `user.permissions.includes('super_admin')`; el DEFAULT del DDL nunca se usa |
| `D30-7` centinela por prefijo de slug | **Refinada** | `DD30-6`: `zz-tiendas-` (no `zz-shops-`, que rompe `toBe(7)` si la centinela está activa), `beforeAll` **hay que crearlo**, `ownerId: 3` (solo vitest), tripwire **fuera de `listShops`**, prefijo también en el `curl` |
| `D30-8` monotonía solo del mismo reloj | **Ratificada y endurecida** | `DD30-7`: mecanismo verificado en `schema.prisma:81-82` + `toBeGreaterThan` estricto |
| `D30-9` cero guardas de dominio nuevas | **Ratificada** | `DD30-10`; `DD30-9` reutiliza un call site existente en 5/5 agregados, no crea uno |
| `D30-10` `getStaffs` con `paginate()` | **Ratificada** | `{ data: [], ...paginate(0, page, limit, 0, url) }` reproduce los argumentos de hoy; `per_page` sigue siendo el `limit` crudo |

**Ninguna decisión revocada.**

## Correcciones aplicadas tras `GATE: FAIL`

| # | Defecto | Sev. | Dónde se cerró |
|---|---|---|---|
| D1 | `PUT /staffs/:id` (`shops.controller.ts:94`) llama `update()` con 2 args → `TS2554` al migrarlo; `DD30-8` lo declaraba explícitamente exento («no cambian de firma»), lo cual era **falso** | **Alta** | `DD30-8` reescrita con los **dos** call sites (`:79`, `:94`), `updateStaff()` añadido, y la exención reducida a `remove()`/`approve()`, verificados como no migrados. Tabla de File Changes, divergencia #5 y riesgo `nuevo C` actualizados |
| D2 | El tripwire (`total === 12`, `items[0].id === 15`) pasa por `listShops`, que filtra `isActive ?? true` (`shops.repository.ts:42`) sobre 12 filas del seed todas activas: **una centinela inactiva lo deja verde**, y la inactiva es el caso normal de esta US | **Alta** | `DD30-6`: tripwire normativo con `prisma.shop.count()` **sin filtro** + `listShops({isActive:false}).total === 0`; cierre `psql` ampliado con `is_active = false` → 0 |
| C1 | Hallazgo 5a enunciado como incondicional y con la causalidad invertida | Media | `DD30-6` punto 1: la condición (`isActive`) y el sentido real (el **nombre** arrastra al slug) |
| C2 | `DD30-2` atribuía al DTO una defensa de runtime contra `is_active` | **Media** | `DD30-2`: `main.ts:9` sin `whitelist` ⇒ la construcción campo a campo es la **única** defensa; corolario vinculante para `sdd-apply` |
| C3 | Hallazgo 5b subestimado | Baja | `DD30-6` punto 2: `users.repository.ts:153-157` incluye `shops: true` **sin `where`** ⇒ también rompe con una centinela inactiva |
| C4 | El escudo `ownerId: 3` parecía aplicar a toda la evidencia | Baja | `DD30-6` punto 2: es **solo de vitest**; el `curl` crea filas de usuario 1 por `D30-3` |
| C5 | `{"id": null}` atribuido a `<= 0` | Baja | `DD30-3`: lo cierra el estrechamiento por `typeof`; `Number(...)` no llega a evaluarse |
| C6 | Consumidor del cuerpo del `PUT` no medido | Baja | `DD30-5`: `data/shop.ts:60-70` navega con `data?.slug` — obligación declarada |
| C7 | `user-dto.mapper.spec.ts` fuera del plan de tests | Baja | § Estrategia de test: re-correr explícitamente (`user-dto.mapper.ts:7` importa `toShopDto`) |
| Nits | «cuatro hallazgos» → **cinco**; call site `:79` (no `:78`); coste de `DD30-1` reconciliado con `DD30-3` | — | En sus secciones |
| *(no aceptada)* | El gate propuso `mapDomainError` en `:81-99` | — | Re-verificado: la función cierra en **`:98`**; `:99` es una línea en blanco. Se mantiene `:81-98` |

## Open Questions

Ninguna bloqueante; las tres de `proposal.md:179-188` quedan cerradas en
`DD30-1`, `DD30-2` y `DD30-3`. Quedan dos verificaciones **empíricas** que este
diseño predice y que `sdd-apply`/`sdd-verify` deben pegar como evidencia:

- [ ] Los textos exactos de los mensajes de 400/404/409 (**se observan**,
      precedente `DD-3` de US-27b).
- [ ] Que `GET /staffs?shop_id=9` produzca un diff **vacío** antes/después con
      `node -e`, incluido el tipo de `per_page`.
