## Exploration: Guardas de id fuera del rango `bigint` (US-31)

### Current State

**1. Los seis guards declarados por la US — confirmados vigentes, líneas exactas**

Se releyó cada archivo directamente (no de memoria). Las seis líneas que cita
la US siguen siendo correctas en `main` a fecha 2026-09-14, pese a que US-29 y
US-30 se mergearon después de escribirse la US:

| Archivo | Línea | Código |
|---|---|---|
| `apps/api/rest/src/types/types.service.ts` | 126 | `if (!Number.isInteger(id)) {` (dentro de `update`) |
| `apps/api/rest/src/types/types.service.ts` | 151 | `if (!Number.isInteger(id)) {` (dentro de `remove`) |
| `apps/api/rest/src/tags/tags.service.ts` | 170 | `if (!Number.isInteger(id)) {` (dentro de `update`) |
| `apps/api/rest/src/tags/tags.service.ts` | 200 | `if (!Number.isInteger(id)) {` (dentro de `remove`) |
| `apps/api/rest/src/manufacturers/manufacturers.service.ts` | 218 | `if (!Number.isInteger(id)) {` (dentro de `update`) |
| `apps/api/rest/src/manufacturers/manufacturers.service.ts` | 254 | `if (!Number.isInteger(id)) {` (dentro de `remove`) |

Los seis guards lanzan `NotFoundException` (404) si pasan `!Number.isInteger(id)`,
pero como `Number.isInteger(1e21) === true`, un id en notación exponencial o
mayor a `2^53` los atraviesa. Verificado también que ni `types.repository.ts`
(`updateType`/`deleteType`, líneas 119-147/158) ni las de `tags`/`manufacturers`
repiten un guard de id a nivel de repositorio para el PK: el `id` llega directo
a `prisma.type.update({ where: { id } })`, así que si el guard del servicio no
ataja, no hay una segunda barrera antes del driver.

**2. El precedente ya embarcado (`categories`, US-28) — patrón exacto a copiar**

`apps/api/rest/src/categories/categories.service.ts:298` (`update`) y `:336`
(`remove`):

```ts
if (!Number.isSafeInteger(id) || id <= 0) {
  throw new NotFoundException(`No existe una categoría con id ${id}.`);
}
```

El comentario de cabecera (líneas 275-293) documenta el "por qué" con precisión
forense: `+id` da `NaN` desde el controlador si la ruta recibe algo no numérico
(precedente `types.service.ts:119-128`); y el `GATE: FAIL` posterior a PR#2
encontró que `PUT /api/categories/1e21` con `+id` evaluando a `1e21` pasaba
`Number.isInteger` y llegaba al repositorio, que revienta en 500 al intentar
`BigInt`/coerción fuera del rango de `bigint` de Postgres. `id <= 0` se
justifica porque "ningún id real del catálogo es `<= 0` (serial arrancando en
1)": rechazarlo con 404 evita un round trip inútil al repositorio.

En la capa de datos, `packages/db/src/repositories/categories.repository.ts:328-332`
(`_assertIntegerRef`) usa el mismo criterio para las FK (`type_id`/`parent`),
pero **sin** la cláusula `<= 0` — el comentario de cabecera (líneas 298-327)
explica por qué: un `type_id`/`parent` no positivo SÍ es representable como
`bigint` sin que el driver reviente, y ya resuelve en 400 correcto más abajo
(`_assertParentEdge` / `P2003`), así que añadir `<= 0` ahí sería una regla de
negocio nueva no autorizada por la tabla cerrada del design. Éste es el
matiz que la US pide replicar: el `id <= 0` es del **guard de la ruta`
`:id`** (nivel servicio), no del **guard de la FK** (nivel repositorio).

**3. `shops` — YA CUBIERTO por US-30, mergeada el mismo día que se escribió esta US**

La nota "Pendiente de verificar en refinamiento" de la US quedó obsoleta: entre
el 2026-09-11 (fecha de la US) y hoy, US-30 ("Migra la capa API de tiendas a
escrituras reales sobre Postgres") aterrizó el mismo patrón en `shops`:

- `apps/api/rest/src/shops/shops.service.ts:285` (método `update`, ruta
  `PUT /shops/:id`):
  ```ts
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new NotFoundException(`No existe una tienda con id ${id}.`);
  }
  ```
- `apps/api/rest/src/shops/shops.service.ts:373` (método privado `_setActive`,
  invocado por `approveShop`/`disapproveShop`):
  ```ts
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new BadRequestException(...);
  }
  ```
  El comentario de cabecera (líneas 356-366) cita explícitamente
  `Number.isSafeInteger (nunca Number.isInteger, que deja pasar 1e21 hasta el
  driver)` — es decir, US-30 ya conocía y corrigió este exacto defecto para
  `shops`, en paralelo a esta US.

Verificación de las cuatro rutas que la US-31 pide revisar
(`apps/api/rest/src/shops/shops.controller.ts`):

| Ruta | Handler → método de servicio | ¿Toca Postgres con el id crudo? | Estado |
|---|---|---|---|
| `PUT /shops/:id` | `update()` → `ShopsService.update(+id, ...)` | Sí (`updateShop(id, ...)`) | Guardado (línea 285) |
| `DELETE /shops/:id` | `remove()` → `ShopsService.remove(id)` | **No** — `remove()` (línea 331-333) es un stub literal (`return \`This action removes a #${id} shop\`;`), no llama al repositorio | No expuesto (no hay escritura real) |
| `POST /shops/approve`, `POST /shops/disapprove` | `ShopsController.approveShop/disapproveShop` → `ShopsService.approve(+id)` | **No** — `approve()` (línea 327-329) es también un stub sin I/O (y, aparte, `disapproveShop` del controlador llama por error a `approve()`, no a `disapproveShop()` — bug preexistente de US-30/copy-paste, **fuera de scope** de esta US, se menciona solo como hallazgo adyacente) | No expuesto |
| `POST /approve-shop`, `POST /disapprove-shop` (`@Body('id')`, controllers dedicados `ApproveShopController`/`DisapproveShopController`) | `ShopsService.approveShop(id)`/`disapproveShop(id)` → `_setActive` | Sí (`setShopActive(parsed, isActive)`) | Guardado (línea 373) |

**Recomendación sobre `shops`: NO entra en scope de esta US.** Las dos únicas
rutas de `shops` que hoy escriben en Postgres con un id numérico
(`PUT /shops/:id` y `POST /approve-shop`/`POST /disapprove-shop`) ya tienen el
guard `!Number.isSafeInteger(id) || id <= 0` desde US-30 (commit `50fede4`,
2026-09-11). `DELETE /shops/:id` y `POST /shops/approve`/`disapprove` son
stubs sin escritura real: no hay 500 posible porque no hay llamada al driver.
No hay nada que alinear aquí — a diferencia de `types`/`tags`/`manufacturers`,
que sí siguen con `Number.isInteger` sin corregir.

**3-bis. `users.service.ts` — HALLAZGO NO NOMBRADO POR LA US: mismo defecto, cinco guards, código en producción**

La US no menciona `users` en ningún punto (ni siquiera como "pendiente de
verificar", a diferencia de `shops`). Un barrido amplio (no limitado a los
directorios que la US nombra) encontró que `apps/api/rest/src/users/users.service.ts`
tiene **cinco** guards `!Number.isInteger(id)`, todos con el mismo defecto de
clase y todos protegiendo una llamada real a Postgres:

| Línea | Método | Ruta HTTP | Llamada real tras el guard | ¿Llega al driver con el id crudo? |
|---|---|---|---|---|
| `users.service.ts:94` | `findOne(id)` | `GET /users/:id` (`users.controller.ts:39-42`, `+id`) | `findUserWithRelations(id)` vía `withPrismaErrorTranslation` | **Sí** — `prisma.user.findUnique({ where: { id } })` (`users.repository.ts:167-170`), sin guard propio |
| `users.service.ts:113` | `update(id, dto)` | `PUT /users/:id` (`users.controller.ts:44-47`, `+id`) | `findUserWithRelations(id)` — el método está marcado "Stub declarado (A11)" porque **no persiste** ningún campo del DTO, pero SÍ ejecuta esa lectura real antes de devolver el DTO | **Sí** — mismo `findUnique` de arriba. El "stub" es solo respecto a la escritura; la lectura con el id crudo sí llega al driver |
| `users.service.ts:142` | `makeAdmin(userId)` | `POST /make-admin` (`@Body('user_id') userId: string`) | `grantPermission(id, 'super_admin')` | **Sí** — `grantPermission` (`users.repository.ts:367-388`) hace `prisma.user.findUnique({ where: { id: userId } })` con el id crudo antes de conceder el permiso |
| `users.service.ts:165` | `banUser(id, user)` | `POST /block-user` (`@Body('id') id: number`, controlador hace `+id`) | `findUserWithRelations(id)` y, si pasa las reglas de negocio, `setUserActive(id, false)` | **Sí** — ambas funciones (`users.repository.ts:167-170` y `:340-354`) usan `prisma.user.findUnique`/`.update({ where: { id } })` sin guard propio |
| `users.service.ts:211` | `activeUser(id)` | `POST /unblock-user` (`@Body('id') id: number`, controlador hace `+id`) | `findUserWithRelations(id)` y `setUserActive(id, true)` | **Sí** — igual que arriba |

Se confirmó leyendo `packages/db/src/repositories/users.repository.ts` que
ninguna de `findUserWithRelations` (líneas 164-173), `setUserActive` (líneas
340-354) ni `grantPermission` (líneas 367-388) tiene una barrera propia de
tipo `Number.isSafeInteger`/`isInteger` — el `id` recibido del servicio pasa
directo a `prisma.user.findUnique`/`.update({ where: { id } })`. Si el guard
del servicio se bypasea (`id = 1e21`), el error del driver (mismo
`invalid input syntax for type bigint` / `value out of range`) no pasa por
`translateCatalogWriteError` (ese traductor es privado de los 5 agregados de
catálogo) sino por el wrapper local `withPrismaErrorTranslation`
(`users.service.ts:307-316`), que solo distingue `isPrismaConnectionError` de
"cualquier otra cosa" y cae igual a `InternalServerErrorException` — mismo
resultado final: **500**, por un camino de traducción de error distinto pero
con el mismo desenlace.

También se confirmó que `remove(id)` (`users.service.ts:127-129`) es un stub
puro sin guard y sin I/O (`return \`This action removes a #${id} user\`;`) —
no expuesto, igual que los stubs de `shops`. Las rutas `DELETE /users/:id` y
`DELETE /profiles/:id` cuelgan de este método y no llegan al driver.

Cobertura de test actual (`apps/api/rest/src/users/users.service.spec.ts`,
mismo arnés `jest.mock('@safari/db', ...)` que los otros cuatro agregados):
solo se prueba el caso `NaN` para `findOne` (línea 231-239), `banUser` (línea
375-379) y `makeAdmin` (línea 391-396); el guard de `activeUser` (línea 211)
no tiene ningún test dedicado al valor inválido (solo "id inexistente", que
ejercita el 404 del `record` nulo, no el guard `Number.isInteger`); y el guard
de `update` (línea 113) **no tiene ningún test** — ni siquiera el caso `NaN`
(sus dos únicos `it` cubren "devuelve el usuario actual" e "id inexistente").
Es decir, el hueco de red de regresión aquí es más amplio que en
`types`/`tags`/`manufacturers`: ninguno de los cinco guards tiene hoy un test
que falle si se reemplaza `Number.isSafeInteger` por `Number.isInteger` (ni
siquiera lo tienen para `Number.isInteger` mismo en el caso de `update`).

**Decisión de scope para `users` — dos lecturas, recomendación explícita:**

- **Lectura A — entra en esta US.** CA-1 dice, en términos generales, "Ningún
  id fuera de rango produce 500", y la Historia (`Como consumidor de la API,
  quiero que un id numérico malformado o desmesurado devuelva un 4xx...`) no
  restringe el defecto a un aggregate de catálogo — es la misma clase de bug,
  con la misma causa raíz (`Number.isInteger(1e21) === true`), reproducible
  hoy en 5 sitios de un módulo ya migrado a Postgres. Dejarlo fuera deja
  `GET/PUT /users/:id`, `POST /block-user`, `POST /unblock-user` y
  `POST /make-admin` con el mismo 500 que esta US existe para eliminar.
- **Lectura B — sale a una US aparte.** El "Incluye" de la US, su tabla
  "Archivos a crear / modificar", sus escenarios Gherkin y el checklist de
  `curl` de la Definición de Done nombran EXCLUSIVAMENTE `types`/`tags`/
  `manufacturers` (+ `shops` como pregunta explícita a resolver). `users` no
  aparece ni una vez, ni siquiera como duda — es un módulo distinto (rutas
  `admin-only`, semántica de bloqueo/desbloqueo/promoción a admin, un
  wrapper de error propio `withPrismaErrorTranslation` en vez de
  `toWriteHttpException`), con su propio archivo de test. Regla del repo:
  "lo que el NO incluye de una US excluye no se implementa aunque sea
  adyacente y fácil" (`docs/product/README.md`) — aquí ni siquiera hay un
  "NO incluye" explícito porque quien escribió la US no llegó a ver `users`;
  tratarlo como cubierto por omisión sería expandir el scope sin
  autorización, no seguirlo. Costo de incluirlo: 5 guards a alinear (vs. 6
  ya presupuestados) + tests nuevos para 5 sitios (hoy sin red de regresión
  alguna, ni siquiera del caso `NaN` en `update`) — un incremento aproximado
  de +60/+90 LOC sobre el ~120 LOC ya estimado, y una superficie de revisión
  adicional (rutas admin-only de gestión de usuarios) que no estaba en el
  radar de nadie al planear esta US.
- **Recomendación: Lectura B — `users` sale a una US standalone aparte,
  simétrica a esta.** Es un defecto real y vivo en `main` (mismo nivel de
  urgencia que motivó priorizar esta US-31 sobre US-32), pero mezclarlo aquí
  violaría "1 US = 1 sesión de agente" y duplicaría de facto el blast radius
  de esta PR (dos módulos, dos archivos de test, dos superficies de permisos)
  sin que las CA/Gherkin/DoD actuales de la US lo contemplen. La forma
  correcta de tratarlo, siguiendo el patrón ya usado para `shops` en el
  refinamiento de esta misma US, es abrir una US standalone nueva (mismo
  patrón exacto de `categories`/esta US, ~60-90 LOC) inmediatamente después
  de ésta — no dejarlo caer al backlog sin prioridad. Esta es una decisión
  que corresponde elevar al usuario/orquestador, no decidirla por omisión.

**4. Barrido EXHAUSTIVO de `Number.isInteger`/`Number.isSafeInteger` — las tres superficies (`apps/api/rest/src/`, `packages/db/src/`, `services/`)**

Comando corrido (sin restringir a los directorios que la US nombra):

```
grep -rn "Number.isInteger" apps/api/rest/src/ packages/db/src/ services/
```

`services/scraper-worker/` no tiene ninguna ocurrencia propia: los únicos
matches caen dentro de `services/scraper-worker/.venv/Lib/site-packages/
playwright/...` — bundles de terceros (el driver de Playwright), no código del
proyecto. **Barrido exhaustivo, sin más hallazgos fuera de las tablas de abajo.**

Ocurrencias reales en código propio (excluidas líneas que son solo comentario),
28 en total — 20 en la capa de servicio de la API, 8 en repositorios de
`packages/db`:

*Capa de servicio (`apps/api/rest/src/`):*

```
auth.service.ts:329         !Number.isSafeInteger(otpId) || otpId <= 0 — ya seguro (US recuperacion-password-otp)
auth.service.ts:384         !Number.isSafeInteger(otpId) || otpId <= 0 — ya seguro (US recuperacion-password-otp)
recovery-options.ts:39      !Number.isSafeInteger(parsed) || parsed <= 0 — ya seguro (misma US)
categories.service.ts:298   !Number.isSafeInteger(id) || id <= 0   — ya corregido (US-28)
categories.service.ts:336   !Number.isSafeInteger(id) || id <= 0   — ya corregido (US-28)
products.service.ts:456     !Number.isSafeInteger(id) || id <= 0   — ya seguro (US-29)
products.service.ts:568     !Number.isSafeInteger(id) || id <= 0   — ya seguro (US-29)
manufacturers.service.ts:218 !Number.isInteger(id)                 — EXPUESTO, nombrado por la US, sin corregir
manufacturers.service.ts:254 !Number.isInteger(id)                 — EXPUESTO, nombrado por la US, sin corregir
shops.service.ts:285        !Number.isSafeInteger(id) || id <= 0   — ya corregido (US-30)
shops.service.ts:373        !Number.isSafeInteger(parsed) || parsed <= 0 — ya corregido (US-30)
tags.service.ts:170         !Number.isInteger(id)                  — EXPUESTO, nombrado por la US, sin corregir
tags.service.ts:200         !Number.isInteger(id)                  — EXPUESTO, nombrado por la US, sin corregir
types.service.ts:126        !Number.isInteger(id)                  — EXPUESTO, nombrado por la US, sin corregir
types.service.ts:151        !Number.isInteger(id)                  — EXPUESTO, nombrado por la US, sin corregir
users.service.ts:94         !Number.isInteger(id)  (findOne)        — EXPUESTO, NO nombrado por la US (ver 3-bis)
users.service.ts:113        !Number.isInteger(id)  (update)         — EXPUESTO, NO nombrado por la US (ver 3-bis)
users.service.ts:142        !Number.isInteger(id)  (makeAdmin)      — EXPUESTO, NO nombrado por la US (ver 3-bis)
users.service.ts:165        !Number.isInteger(id)  (banUser)        — EXPUESTO, NO nombrado por la US (ver 3-bis)
users.service.ts:211        !Number.isInteger(id)  (activeUser)     — EXPUESTO, NO nombrado por la US (ver 3-bis)
```

*Capa de repositorio (`packages/db/src/repositories/`):*

```
categories.repository.ts:248   Number.isInteger(asId)                — lectura, NO expuesto al driver
categories.repository.ts:329   !Number.isSafeInteger(value)          — ya corregido (US-28, _assertIntegerRef)
manufacturers.repository.ts:139 !Number.isInteger(typeId)            — EXPUESTO, sin corregir
products.repository.ts:486     !Number.isSafeInteger(value)          — ya corregido (_assertIntegerRef local, DD29-3)
products.repository.ts:511     !Number.isInteger(value)              — NO es un id/FK (ver abajo)
products.repository.ts:909     Number.isSafeInteger(id)              — ya seguro
shops.repository.ts:177        !Number.isSafeInteger(id) || id <= 0  — ya seguro (US-30)
tags.repository.ts:115         !Number.isInteger(typeId)             — EXPUESTO, sin corregir
```

Resumen de la clasificación (28 ocurrencias): **13 ya corregidas o ya seguras**
(auth×2, recovery-options, categories×2, products×2, shops×2 en servicio +
categories.repository `_assertIntegerRef`, products.repository
`_assertIntegerRef` y `:909`, shops.repository); **8 expuestas y sin corregir,
nombradas por la US** (types×2, tags×2, manufacturers×2 en servicio +
manufacturers.repository/tags.repository `_assertValidTypeId`, contados en el
punto 4 de detalle); **5 expuestas y sin corregir, NO nombradas por la US**
(los cinco guards de `users.service.ts`, sección 3-bis); **1 no expuesta pese a
usar `Number.isInteger`** (`categories.repository.ts:248`, lookup en memoria);
**1 de otra familia de overflow, fuera de scope** (`products.repository.ts:511`,
columna `integer`, no `bigint`).

Detalle de cada ocurrencia de repositorio:

- **`categories.repository.ts:248`** (`findCategoryByIdOrSlug`, ruta de
  lectura `GET /categories/:param`): `const asId = Number(param); if
  (Number.isInteger(asId)) { const byId = nodes.get(asId); ... }`. `nodes` es
  un `Map` en memoria construido por `_assembleTree(await _loadFlat())` — el
  árbol completo ya está cargado antes de esta comprobación. Un `param` como
  `"1e21"` da `asId = 1e21`, `Number.isInteger(1e21) === true`, pero
  `nodes.get(1e21)` es un simple lookup de `Map` que devuelve `undefined` (no
  hay ninguna clave con ese valor) — **no llega a Prisma, no hay riesgo de
  500 aquí**. No requiere alineación por este defecto (aunque técnicamente use
  `Number.isInteger`, no está en la ruta al driver).

- **`manufacturers.repository.ts:139`** (`_assertValidTypeId`, compartida por
  `createManufacturer`/`updateManufacturer`): valida el FK `typeId` (columna
  `manufacturers.type_id bigint REFERENCES types(id)`, `db/schema.sql:288`).
  Expuesto a entrada de usuario: `manufacturers.service.ts` coerciona
  `typeId: Number(createManufactureDto.type_id)` / `Number(updateManufacturesDto.type_id)`
  (líneas 190-195, 236-241) antes de pasarlo al repositorio. Un
  `{"type_id": "1e21"}` pasa `Number.isInteger` y llega a
  `prisma.manufacturer.create/update({ data: { typeId: 1e21 } })` — mismo
  defecto de clase (columna `bigint`), **EXPUESTO, sin corregir**.

- **`tags.repository.ts:115`** (`_assertValidTypeId`, compartida por
  `createTag`/`updateTag`): idéntico patrón sobre `tags.type_id bigint`
  (`db/schema.sql:302`); `tags.service.ts` coerciona igual
  (`typeId: Number(createTagDto.type_id)`, líneas 147-150 / 184-187).
  **EXPUESTO, sin corregir.**

- **`products.repository.ts:511`** (`_assertIntegerCount`, valida
  `quantity`): la columna `products.quantity` es `integer` (`int4`,
  `db/schema.sql:350`), **no `bigint`** — es una familia de overflow distinta
  (rango `±2^31`, no `±2^63`) y no es un id/FK. El título y el scope de la US
  ("Guardas de id fuera del rango `bigint`") no la nombra ni la cubre; se
  menciona aquí como hallazgo adyacente, **fuera de scope**, no se toca.

- **`products.repository.ts:486` (`_assertIntegerRef`) y `:909`**, y
  **`shops.repository.ts:177`**: ya usan `Number.isSafeInteger` (con o sin
  `<= 0` según el mismo criterio de `categories`) — no requieren cambio.

**5. La cadena de error — por qué degrada a 500 literal**

Camino confirmado, archivo por archivo, para un id fuera de rango que
atraviesa el guard del servicio (p. ej. `types.service.ts:126` con
`id = 1e21`):

1. `updateType(1e21, input)` (`packages/db/src/repositories/types.repository.ts:119-147`)
   llama `prisma.type.update({ where: { id: 1e21 }, ... })` sin ningún guard
   propio sobre `id`.
2. El driver (`@prisma/adapter-pg`) intenta convertir `1e21` a `bigint` de
   Postgres y lanza (según el caso) `invalid input syntax for type bigint` o
   `Value out of range for the type bigint` — un error de Postgres sin el
   `.code` reconocible de Prisma (`P2002`/`P2003`/`P2025`).
3. El `catch` de `updateType` llama
   `translateCatalogWriteError(error, { aggregate: 'types', id, uniqueField: 'slug' })`
   (`packages/db/src/domain-errors.ts:135-163`). Esta función SOLO traduce
   `P2002`→`SlugConflictError`, `P2003`→`InvalidReferenceError`,
   `P2025`→`RecordNotFoundError`; "cualquier otra cosa vuelve intacta" (línea
   132-133, 162) — el error del driver sale sin cambios.
4. `TypesService.update` recibe ese error intacto y llama
   `toWriteHttpException(error)` (`apps/api/rest/src/common/errors/domain-error.mapper.ts`).
   `mapDomainError` (líneas 82-98) verifica `isCatalogWriteError` por `.code`
   contra el conjunto cerrado de 5 valores de `CATALOG_ERROR_CODES`
   (`packages/db/src/domain-errors.ts:16-22`) — el error del driver no
   coincide, devuelve `null`. `isConnectionFailure` (líneas 108-127) tampoco
   coincide (no es un código/patrón de conexión). Cae al último tramo:
   `return new InternalServerErrorException(UNEXPECTED_ERROR_MESSAGE)` — el
   500 literal fijo (`domain-error.mapper.ts`, función `toWriteHttpException`,
   rama final).

Esto confirma por qué **CA-7 de US-27a prohíbe tocar este mapper**: es un
punto de traducción genérico y deliberadamente ciego a bigint — el arreglo
correcto vive en el guard de entrada (servicio), no en el mapper.

**6. Superficie de test existente**

Los cinco `*.service.spec.ts` ya existen en `apps/api/rest/src/`:
`types/types.service.spec.ts`, `tags/tags.service.spec.ts`,
`manufacturers/manufacturers.service.spec.ts`, `shops/shops.service.spec.ts`,
`categories/categories.service.spec.ts`. Todos mockean `@safari/db` así
(patrón idéntico en los cinco):

```ts
jest.mock('@safari/db', () => ({
  ...jest.requireActual<typeof import('@safari/db')>('@safari/db'),
  createXxx: jest.fn(),
  updateXxx: jest.fn(),
  deleteXxx: jest.fn(),
  // ...
}));
```

Es decir: se dejan REALES las clases de error de dominio y el mapper, y se
mockea SOLO el acceso a datos (`createXxx`/`updateXxx`/`deleteXxx`/finders).

El patrón de regresión (CA-4) que la US pide replicar ya existe en
`categories.service.spec.ts:383-397` (`describe('CategoriesService.update
(US-28)')`):

```ts
it.each([
  ['NaN', NaN],
  ['cero', 0],
  ['negativo', -5],
  ['fuera del rango seguro de bigint (1e21)', 1e21],
])('id %s → 404 sin llamar al repositorio (`!Number.isSafeInteger(id) || id <= 0`)', async (_label, id) => {
  expect.assertions(3);
  try {
    await service.update(id, updateDto({ name: 'x' }));
  } catch (error) {
    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).getStatus()).toBe(404);
    expect(updateCategoryMock).not.toHaveBeenCalled();
  }
});
```

(Existe una tabla equivalente para `remove`, líneas ~568-579, no transcrita
aquí por brevedad — mismo patrón.)

Por contraste, `types.service.spec.ts:197-206`, `tags.service.spec.ts` (línea
~337) y `manufacturers.service.spec.ts` (línea ~334) hoy **solo prueban el
caso `NaN`**, con un único `it(...)` (no `it.each`), y NINGUNO incluye el caso
`1e21`. Esto confirma exactamente el hueco de CA-4 que la US quiere cerrar:
hoy, si alguien revirtiera `!Number.isSafeInteger(id) || id <= 0` a
`!Number.isInteger(id)` en `types`/`tags`/`manufacturers`, ningún test
existente lo detectaría (el caso `NaN` sigue pasando con `Number.isInteger`
también). El patrón a copiar es literalmente el bloque `it.each` de arriba,
adaptado al mock de cada agregado (`updateTypeMock`, `updateTagMock`,
`updateManufacturerMock`, y sus equivalentes de `remove`).

Comando real para correr esta suite (no envuelto por `just`, confirmado en
`openspec/config.yaml`):
```
cd apps/api/rest && npx jest
```
Requiere `just db-build` antes (para que `@safari/db` resuelva contra
`packages/db/dist`, según `transformIgnorePatterns` de su `package.json`).

**7. El detalle de `id <= 0`**

Barrido de `db/seed.sql` para las cuatro tablas de esta US (`types`, `tags`,
`manufacturers`, y `shops` de referencia porque ya lleva el guard): todos los
`INSERT INTO {types,shops,manufacturers,tags} (id, ...) VALUES (...)`
arrancan en `id = 1` (la columna es `bigserial PRIMARY KEY`, `db/schema.sql:91,232,282,296`).
No se encontró ninguna fila con `id = 0` ni negativo en ninguna de las cuatro
tablas. Ningún servicio del área (`types`/`tags`/`manufacturers`/`shops`)
trata `id === 0` como un valor especial (no es análogo al `parent === null`
de `categories`, que sí tiene semántica de "raíz"). Conclusión: aplicar
`id <= 0` en bloque a los seis guards es seguro — no hay ninguna ruta hoy que
dependa de un id `0` o negativo siendo válido.

### Affected Areas

- `apps/api/rest/src/types/types.service.ts:126,151` — guards a alinear
  (`update`, `remove`).
- `apps/api/rest/src/tags/tags.service.ts:170,200` — guards a alinear
  (`update`, `remove`).
- `apps/api/rest/src/manufacturers/manufacturers.service.ts:218,254` —
  guards a alinear (`update`, `remove`).
- `apps/api/rest/src/types/types.service.spec.ts` — reemplazar el `it` único
  de `NaN` (líneas ~197-206 y ~252 area de `remove`) por `it.each` con
  `NaN`/`0`/`-5`/`1e21`, calcado de `categories.service.spec.ts:383-397`.
- `apps/api/rest/src/tags/tags.service.spec.ts` — mismo tratamiento (líneas
  ~337 y ~443).
- `apps/api/rest/src/manufacturers/manufacturers.service.spec.ts` — mismo
  tratamiento (líneas ~334 y ~487).
- `packages/db/src/repositories/manufacturers.repository.ts:139` —
  `_assertValidTypeId`: alinear `!Number.isInteger` → `!Number.isSafeInteger`
  (sin `<= 0`, mismo criterio que `categories.repository.ts:329` y
  `products.repository.ts:486` para FKs).
- `packages/db/src/repositories/tags.repository.ts:115` — mismo tratamiento.
- **NO tocar en esta US**: `apps/api/rest/src/shops/shops.service.ts` (ya
  corregido por US-30); `apps/api/rest/src/categories/categories.service.ts`
  (ya corregido por US-28); `apps/api/rest/src/common/errors/domain-error.mapper.ts`
  (CA-7, contrato); `packages/db/src/domain-errors.ts` (conjunto cerrado de
  códigos); `packages/db/src/repositories/products.repository.ts:511`
  (`_assertIntegerCount`, otra familia de overflow, no bigint/id).
- **Pendiente de decisión del usuario/orquestador — NO se toca en esta US
  salvo indicación explícita**: `apps/api/rest/src/users/users.service.ts:94,113,142,165,211`
  (cinco guards `!Number.isInteger(id)`, todos expuestos, ver sección 3-bis) y
  su `apps/api/rest/src/users/users.service.spec.ts` (red de regresión
  igualmente ausente). Recomendación: US standalone aparte, no incluirlo aquí
  por defecto.

### Approaches

1. **Copiar el patrón exacto de `categories` a los seis guards + alinear las
   dos FK de `packages/db`** — único enfoque considerado; la US es explícita
   en que "el arreglo ya está escrito... copiar el patrón de `categories`, no
   inventar otro". No hay opciones alternativas de diseño que valga la pena
   comparar: esto es una corrección mecánica de un patrón ya validado en
   producción (`categories`, `shops`).
   - Pros: cero riesgo de diseño nuevo; consistencia total entre los cinco
     agregados de escritura; ya hay tests de referencia que calcar.
   - Cons: ninguno relevante — es LOC bajo (~120 est.) y mecánico.
   - Effort: Low.

### Recommendation

Aplicar exactamente el patrón de `categories.service.ts:298,336` a los seis
guards de `types`/`tags`/`manufacturers` (`!Number.isSafeInteger(id) || id <=
0`), alinear los dos `_assertValidTypeId` de `packages/db`
(`manufacturers.repository.ts:139`, `tags.repository.ts:115`) a
`Number.isSafeInteger` (sin `<= 0`, igual que las FK de `categories` y
`products`), y añadir la red de regresión `it.each` (`NaN`/`0`/`-5`/`1e21`)
calcada de `categories.service.spec.ts:383-397` en los tres `*.service.spec.ts`
afectados. `shops` y `categories` no requieren ningún cambio: ya tienen el
guard. No tocar `translateCatalogWriteError`, el mapper de errores, DDL ni
`products.repository.ts:511` (`quantity`, otra familia de overflow).

**`users.service.ts` — recomendación separada, decisión pendiente del
usuario/orquestador**: NO incluirlo en el scope de esta US por defecto (ver
las dos lecturas y el costo estimado en la sección 3-bis); abrir una US
standalone nueva, simétrica a ésta, para los cinco guards de `users`. Si el
usuario decide explícitamente absorberlo aquí, el trabajo es mecánicamente
idéntico (mismo patrón `!Number.isSafeInteger(id) || id <= 0`, aplicado a las
líneas 94/113/142/165/211, más la red de regresión `it.each` en
`users.service.spec.ts` — hoy sin ningún caso más allá de `NaN`, y sin ninguno
en el guard de `update`), pero el LOC estimado de la US pasaría de ~120 a
~180-210 y el checklist de la Definición de Done (curl, CA, Gherkin) tendría
que reescribirse para cubrir `GET/PUT /users/:id`, `POST /block-user`,
`POST /unblock-user` y `POST /make-admin`.

### Risks

- **`users.service.ts` — defecto real fuera del scope literal de la US**: cinco
  guards `!Number.isInteger(id)` (líneas 94, 113, 142, 165, 211), todos
  expuestos a un 500 con `id = 1e21` vía rutas ya migradas a Postgres
  (`GET/PUT /users/:id`, `POST /block-user`, `POST /unblock-user`,
  `POST /make-admin`). Recomendación: US standalone aparte (ver sección
  3-bis y Recommendation) — riesgo si el orquestador/usuario no decide
  explícitamente qué hacer con este hallazgo antes de `sdd-propose`, porque
  cerrar esta US "como si el defecto ya no existiera en la API" sería
  engañoso: el defecto persiste, solo que en un módulo distinto.
- **Hallazgo adyacente, fuera de scope**: `ShopsController.disapproveShop`
  (`shops.controller.ts:77-79`) llama por error a `this.shopsService.approve(+id)`
  en vez de `disapproveShop`/`approve(false)` — parece un bug de copy-paste de
  US-30. No se toca en esta US (no está en su "Incluye"); se deja anotado
  para que quien la reporte decida si abre una US aparte.
- **Reproducción en vivo pendiente**: no se levantó la API en esta fase
  (regla de la exploración). Los `curl` de la Definición de Done deben
  correrse en `apply`/`verify`, no se puede confirmar el status HTTP exacto
  hasta entonces — el razonamiento de arriba está fundamentado en el código,
  no en una respuesta observada.
- **`it.each` con `1e21` en TypeScript**: verificar en `apply` que el tipo del
  parámetro de test (`number`) acepta el literal sin fricción de tipos — ya
  probado sin problemas en `categories.service.spec.ts:387`, así que el
  riesgo es bajo.

### Ready for Proposal

Sí, con una decisión de scope pendiente para el orquestador/usuario antes de
`sdd-propose`. La exploración confirma con evidencia de código: (a) los seis
guards nombrados por la US siguen intactos y vulnerables en las líneas
exactas que cita; (b) el patrón de `categories` es replicable sin ambigüedad;
(c) `shops` ya no requiere trabajo (lo resolvió US-30 después de escrita la
US); (d) el barrido EXHAUSTIVO de las tres superficies (`apps/api/rest/src/`,
`packages/db/src/`, `services/`) encontró 28 ocurrencias totales de
`Number.isInteger`/`Number.isSafeInteger` en código propio, de las cuales 13 ya
están corregidas o ya eran seguras, 8 están expuestas y nombradas por la US (los seis guards +
las dos FK de `packages/db`), 1 no está expuesta pese a usar `Number.isInteger`
(`categories.repository.ts:248`), 1 es de otra familia de overflow fuera de
scope (`products.repository.ts:511`) y **5 están expuestas y NO nombradas por
la US** (los cinco guards de `users.service.ts`) — sin más hallazgos fuera de
estas 28; (e) `id <= 0` es seguro de aplicar en bloque (ningún id real es 0 o
negativo en el seed).

> Nota del orquestador (gate, 2026-09-14): el conteo original de esta sección
> decía 23 y clasificaba 8 como "ya corregidas". El recuento verificado es 28
> y 13: faltaban `auth.service.ts:329,384`, `recovery-options.ts:39` y
> `products.service.ts:456,568`, todas ya usando `Number.isSafeInteger`. La
> corrección no altera el scope: los buckets de trabajo (8 expuestas nombradas,
> 5 de `users`, 1 no expuesta, 1 de otra familia) se verificaron exactos.

El orquestador debe elevar al usuario la decisión sobre `users` (sección
3-bis / Recommendation) antes de pasar a `sdd-propose`: si la respuesta es
"no, US aparte" (recomendación de esta exploración), el orquestador puede
proceder con el scope ajustado ya descrito (shops removido, dos guards de FK
en `packages/db` añadidos, `users` fuera); si la respuesta es "sí, inclúyelo
aquí", el proposal debe ampliar el "Incluye"/CA/Gherkin/DoD de la US para
cubrir explícitamente los cinco guards y rutas de `users` antes de continuar.
