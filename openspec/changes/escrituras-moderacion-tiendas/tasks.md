# Tasks: Escrituras y moderación de tiendas (US-30)

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~1550 (+200/−350), re-anchor del diseño tras sumar ~82 líneas de los cinco hallazgos nuevos |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR#1 (`packages/db` camino feliz) → PR#2 (`packages/db` batería hostil) → PR#3 (API, releasable) → PR#4 (`shops.service.spec.ts`) |
| Delivery strategy | ask-on-risk (recibida del orquestador) |
| Chain strategy | **4 slices como UNIDADES DE TRABAJO** — RESUELTA por el usuario (2026-09-11) |

### Decisión del usuario (2026-09-11) — vinculante para `sdd-apply`

Los cuatro cortes se mantienen **como unidades de trabajo con gate propio**, no
necesariamente como PRs separados: un commit por slice sobre una rama de US-30,
cada uno verde con su runner antes de pasar al siguiente. El valor buscado es el
**checkpoint intermedio**, no el review por partes — en US-29 el usuario acabó
mergeando los 8 commits a `main` de una vez, y aun así el corte pagó: PR#4 existió
como fase propia y fue ahí donde apareció el único defecto real de la US
(`manufacturer_id: null` → `Number(null) === 0`).

**NO** se levanta PR#4 a una US-30b de entrada; sigue siendo el corte de
contingencia si `sdd-apply` desborda (parar y preguntar, nunca decidir solo).

> **Nota de resolución de skills:** este repo no tiene `.atl/skill-registry.md`,
> así que el skill `chained-pr` **no es resoluble por registro**. `sdd-apply`
> gestiona git directamente y reporta `skill_resolution` en consecuencia.

```text
Decision needed before apply: RESUELTA (2026-09-11)
Chained PRs recommended: Yes (como unidades de trabajo)
Chain strategy: 4 slices, un commit por slice, rama propia
400-line budget risk: High
```

### Roll-up propio vs. el diseño

| PR | Contenido | ~Líneas | Runner |
|---|---|---|---|
| #1 | `shops.repository.ts` (3 escrituras + `shopSlugs` + `COUNT_PRODUCTS` ×3) + barrel + `shops.integration.test.ts` camino feliz (sentinela `zz-tiendas-`, tripwire, `it` de `gadget`) | ~480 | `just db-check` |
| #2 | `shops.integration.test.ts` batería hostil (404/409/400, REPLACE de `settings`, no-op de `logo`, monotonía `update↔update`) | ~260 | `just db-check` |
| #3 | `shops.service.ts` + `shops.controller.ts` + `create-shop.dto.ts` (incluye `_setActive`, `createStaff`/`updateStaff`) | ~380 | `just build-api` + curl + `just verify` |
| #4 | `shops.service.spec.ts` | ~500 | `cd apps/api/rest && npx jest` |
| — | Margen de redondeo | ~-70 | — |
| **Total** | | **~1550** | |

Coincide con el pronóstico del diseño (~1550, banda `+200/−350`); no se discrepa.
El corte de contingencia pre-acordado si `sdd-apply` desborda sigue siendo
levantar PR#4 a una US-30b (parar y preguntar, no decidir unilateralmente).

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|---|---|---|---|
| 1 | `packages/db` camino feliz: 3 escrituras + barrel + integración feliz con sentinela/tripwire ya montados | PR#1 | Runner: `just db-check`. Base: `main` |
| 2 | `packages/db` batería hostil: 404/409/400, jsonb, monotonía. **NO incluye "id no entero" (va en PR#4)** | PR#2 | Runner: `just db-check`. Base: PR#1 |
| 3 | API: servicio + controller + DTO + los 2 stubs de `DD30-8`. **US releasable aquí** | PR#3 | Runner: `just build-api` + curl + `just verify`. Base: PR#2 |
| 4 | `shops.service.spec.ts`, incluida la frontera numérica de `@Body('id')` | PR#4 | Runner: `npx jest`. Base: PR#3. Candidato a US-30b si desborda |

## Phase 1: `shops` repository — camino feliz (`packages/db`, PR#1)

- [x] 1.1 En `shops.repository.ts`: añadir `shopSlugs: ExistingSlugLookup` module-private (mismo patrón que `productSlugs`/`categorySlugs`, el nombre de tabla nunca llega a `slug.ts`). ~5 líneas.
- [x] 1.2 Añadir tipos `CreateShopInput`/`UpdateShopInput` del contrato del diseño (`slug` no existe en ninguno; `ownerId`/`isActive` fuera de `UpdateShopInput`). ~20 líneas. [DD30-2]
- [x] 1.3 Implementar `createShop(input)`: `generateSlug(shopSlugs, 'shops')`; spreads condicionales por campo (`settings`/`address` con `!== undefined`, `logo`/`coverImage` con `!= null`, `description` con `!== undefined`); `ownerId`/`isActive` fijados tal cual llegan (el rol se decide en el servicio); `prisma.shop.create({..., include: COUNT_PRODUCTS})`; `catch { throw translateCatalogWriteError(error, {aggregate:'shops'}); }`. ~60 líneas. [DD30-4, DD30-5, DD30-10]
- [x] 1.4 Implementar `updateShop(id, input)`: `await normalizeSlug(input.name, 'shops')` descartando el resultado cuando `input.name !== undefined` (reutilización, no guarda nueva); mismos spreads condicionales de 1.3; `prisma.shop.update({..., include: COUNT_PRODUCTS})` sin fijar `updatedAt`; mismo `catch` con `id`. Sin guarda numérica propia (precondición documentada: id entero seguro positivo, garantizada por el llamador). ~50 líneas. [DD30-5, DD30-9, DD30-10]
- [x] 1.5 Implementar `setShopActive(id, isActive)`: `prisma.shop.update({data:{isActive}, include: COUNT_PRODUCTS})`; mismo `catch`. Sin guarda numérica propia (la lleva el servicio, `DD30-3`). ~20 líneas. [DD30-1, DD30-5, DD30-10]
- [x] 1.6 Modificar `packages/db/index.ts`: `CreateShopInput`/`UpdateShopInput` al bloque `export type` y `createShop`/`setShopActive`/`updateShop` al `export`, orden alfabético junto a los símbolos ya existentes. ~10 líneas.
- [x] 1.7 Modificar `shops.integration.test.ts`: **crear** `beforeAll(cleanupSentinel)` (hoy no existe) con `SENTINEL_PREFIX = 'zz-tiendas-'` (no `zz-shops-`); plegar la misma limpieza dentro del `afterAll` existente, antes del `$disconnect()`. ~20 líneas. [DD30-6]
- [x] 1.8 Añadir describes de escritura **después** de los de lectura: crear con `is_active` por rol (`store_owner`→false, `super_admin`→true), editar campo a campo (`name`/`description`/`logo`/`cover_image`/`address`/`settings`), togglear con `setShopActive`, `slug` invariante tras `update`. Cada `it` borra lo que crea. ~120 líneas. [DD30-1, DD30-2, DD30-6]
- [x] 1.9 Añadir tripwire **independiente de `listShops`**: `expect(await prisma.shop.count()).toBe(12)` (sin filtro), `(await listShops({isActive:false})).total === 0`, `(await listShops()).items[0].id === 15`. ~15 líneas. [DD30-6]
- [x] 1.10 Añadir el `it` de `productsCount ≠ 0`: `updateShop(idDeGadget, {description: <valor actual leído antes>})` (escritura idempotente), asserta `productsCount === 44` igual que `findShopBySlug('gadget')`; re-lee y asserta que `name`/`slug`/`description`/`isActive` no cambiaron. Id resuelto por slug, nunca hardcodeado. ~20 líneas. [DD30-5]
- [x] 1.11 Verificar PR#1: `just db-build` → `just db-check` verde. Pegar salida real y confirmar que los conteos de `categories`/`products` (otros archivos) no se movieron.

## Phase 2: Batería hostil de integración (`packages/db`, PR#2)

> **NO incluye el caso "id no entero"**: su precondición documentada es un id
> ya guardado por el llamador; ese `it` vive en PR#4 (jest), sobre
> `@Body('id')` del servicio (`DD30-3`).

- [ ] 2.1 Cubrir 404 de `P2025` en `updateShop`/`setShopActive` con id inexistente (vía sentinela borrada antes de la aserción). [DD30-10]
- [ ] 2.2 Cubrir 409 de slug duplicado (`P2002`, solo por carrera) y 400 de `ownerId` inexistente (`P2003` → `InvalidReferenceError`, mensaje `shops.desconocida`). [DD30-10]
- [ ] 2.3 Cubrir REPLACE completo de `settings` (un segundo `PUT` sin un sub-campo previo lo borra) y no-op de `logo: null`/`cover_image: null`. [DD30-1, DD30-2, DD30-4]
- [ ] 2.4 Cubrir monotonía **solo** `updateShop→updateShop` y `setShopActive→setShopActive` con `toBeGreaterThan` estricto — nunca comparar contra el timestamp del `create`. [DD30-7]
- [ ] 2.5 Verificar PR#2: `just db-check` verde (con PR#1 aplicado). Pegar salida real; `count(*) FROM shops` restituido al valor medido antes de la corrida.

## Phase 3: Capa API — servicio, controller, DTO (`apps/api/rest`, PR#3 — US releasable aquí)

- [ ] 3.1 En `shops.service.ts`: eliminar el import de `@db/shops.json` (`:21`), `plainToClass` (`:7,30`) y el campo `private shops` (`:95`). [CA-6]
- [ ] 3.2 Migrar `create(dto, user)`: `CreateShopInput` campo a campo — `ownerId = user.sub`, `isActive = user.permissions.includes('super_admin')`, jsonb con los spreads de `DD30-4` — **nunca `...dto`**; `createShop(input)`; proyectar `toShopDto` (16 claves); `catch { throw toWriteHttpException(error); }`. ~40 líneas. [DD30-2, DD30-4, DD30-6]
- [ ] 3.3 Migrar `update(id, dto, user)`: `!Number.isSafeInteger(id) || id<=0` → 404 (nivel A, antes del repositorio); `findShopOwnerById(id)` → `null` → 404 (nunca 403); `super_admin` salta el 403; `ownerId !== user.sub` → 403; `UpdateShopInput` campo a campo (**nunca `...dto`**, excluye `slug`/`ownerId`/`isActive`); `updateShop(id, input)`; proyectar; mismo `catch`. ~50 líneas. [DD30-2, DD30-3]
- [ ] 3.4 Implementar `_setActive(rawId, isActive)` privado: `typeof rawId === 'number' || typeof rawId === 'string' ? Number(rawId) : Number.NaN` → `!Number.isSafeInteger(parsed) || parsed <= 0` → 400; `setShopActive(parsed, isActive)`; `catch` (`P2025`→404 vía `toWriteHttpException`). Conectar `approveShop(id) = _setActive(id, true)` / `disapproveShop(id) = _setActive(id, false)`. ~30 líneas. [DD30-1, DD30-3]
- [ ] 3.5 Migrar `getStaffs`: sin lectura de `shops.json`, `return { data: [], ...paginate(0, page, limit, 0, url) }` con el mismo `paginate()` de hoy (nunca `buildPaginator`). ~10 líneas. [DD30-10]
- [ ] 3.6 Declarar los stubs `createStaff()` y `updateStaff()` en `shops.service.ts` (comportamiento de stub preservado, sin `@CurrentUser()` pass-through). ~16 líneas. [DD30-8]
- [ ] 3.7 En `shops.controller.ts`: añadir `@CurrentUser()` en `create` (`:30`) y `update` (`:48`); rewire de `StaffsController` — `:79` (`create`, 1 arg) → `createStaff()`, `:94` (`update`, 2 args) → `updateStaff()`. `@Permissions` sin tocar; `@Body('id')` de `:109`/`:120` sin tipar (contrato); `remove()` (`:99`) y `approve()` (`:62`/`:68`) intactos. ~15 líneas. [DD30-8]
- [ ] 3.8 En `create-shop.dto.ts`: solo comentarios documentando campos aceptados y descartados (`balance`, `categories[]`, `owner_id`/`is_active` si llegaran) — decisión 15, sin efecto de runtime. ~10 líneas.
- [ ] 3.9 Verificar PR#3: `just db-build` → `just build-api` limpio (sin `TS2554`) → `grep -n "@db/\|plainToClass" apps/api/rest/src/shops/shops.service.ts` → 0 líneas → `just api-dev` arriba → secuencia `curl` `POST → GET → PUT` con reinicio real → `just verify` verde.

## Phase 4: `shops.service.spec.ts` (`apps/api/rest`, PR#4)

- [ ] 4.1 Ampliar `jest.mock('@safari/db', ...)` (`:30-35`) con `createShop`, `updateShop`, `setShopActive`, `findShopOwnerById`; clases de error y `toWriteHttpException` reales vía `jest.requireActual`/import directo. Los 5 `it` de lectura no se tocan.
- [ ] 4.2 Cubrir escrituras: proyección de 16 claves en el mismo orden que `getShop`; `is_active` por rol al crear; matriz de propiedad 404/403/200 en `update`.
- [ ] 4.3 Cubrir la frontera numérica de `@Body('id')` en `approve`/`disapprove` (**este es el caso "id no entero" del carry-forward**, no PR#2): `"abc"`, `0`, `true`, `null`, `[]`, `{}` → 400; id inexistente → 404 (`P2025` traducido). [DD30-3]
- [ ] 4.4 Cubrir la matriz de roles de CA-5 en `approve-shop`/`disapprove-shop`: 403 para todo lo que no sea `super_admin` (incluido `store_owner`).
- [ ] 4.5 Cubrir cada clase de error de dominio (`InvalidReferenceError`, `RecordNotFoundError`, `SlugConflictError`) → su status HTTP vía `toWriteHttpException`.
- [ ] 4.6 Verificar PR#4: `cd apps/api/rest && npx jest` verde, con recuentos reales pegados. **Re-correr explícitamente `user-dto.mapper.spec.ts`** aunque esta US no lo edite: `user-dto.mapper.ts:7` importa `toShopDto` desde `shops.service`, así que quitar `@db/shops.json` cambia su grafo de módulos.

## Phase 5: Cierre de la DoD y del épico (evidencia, todo PR)

- [ ] 5.1 Secuencia completa CA-1/CA-3: `POST → GET /new-shops → reinicio → approve-shop (super_admin) → GET /shops → PUT propio (200) → PUT ajeno (403) → disapprove-shop → GET /new-shops`, pegada con status+body; key-set de 16 claves diffeado con `node -e` (`jq` no instalado) contra una tienda del seed.
- [ ] 5.2 CA-2: `curl` de `near-by-shop` — tienda con `settings.location` nuevo aparece en `GET /near-by-shop/:lat/:lng`.
- [ ] 5.3 `D30-1`: evidencia `psql` antes/después sobre un `PUT` de `super_admin` que borra `settings.shopMaintenance` — la pérdida se **demuestra**, no se oculta.
- [ ] 5.4 CA-4: `GET /staffs?shop_id=9` antes/después, diff de key-set y de tipo de `per_page` con `node -e`.
- [ ] 5.5 CA-5: `curl` pegados — 401 sin token, 403 `customer`, 403 `staff`, 200 `store_owner` propio, 200 `super_admin`, 403 `store_owner` en `approve-shop`.
- [ ] 5.6 CA-6 + reporte de stubs: `grep -n "@db/\|plainToClass" shops.service.ts` → 0 líneas; reporte de las 5 rutas que siguen stub (`DELETE /shops/:id`, `shops/approve`, `shops/disapprove`, `staffs` ×3) y los campos ignorados (`balance`, `admin_commission_rate`, `categories[]`, `owner_id`/`is_active` del body).
- [ ] 5.7 Cierre de conteos vía `psql`: `count(*) FROM shops` = **12**, `count(*) FROM shops WHERE is_active = false` = **0**, `items[0].id` = **15**, `count(*) FROM shops WHERE slug LIKE 'zz-tiendas-%'` = **0**. Correr `just db-check`, `cd apps/api/rest && npx jest`, `just build-api`, `just verify`, todos verdes con recuentos.
- [ ] 5.8 **Antes de 5.7**: borrar las filas `curl` de la evidencia manual (`ownerId` de usuario 1, no del escudo `ownerId: 3` de vitest) para que no rompan `users.integration.test.ts:88,147`.
- [ ] 5.9 `git diff --stat` sin cambios en `domain-errors.ts`, `common/errors/`, `slug.ts`, `findOrCreateShopBySlug`, `db/schema.sql`, `apps/shop`, `apps/admin`.
- [ ] 5.10 Actualizar el Status de US-30 (`docs/product/26-escrituras-catalogo-postgres/30-escrituras-moderacion-tiendas.md`), marcar su fila en el README del épico, **declarar el Épico 26 cerrado** (US-27a/27b/28/29/30 implementadas) y añadir el factor de estimación real de esta US a «Sesgo de estimación medido».

## Review Workload Forecast

Estimated changed lines: 1550
400-line budget risk: High
Chained PRs recommended: Yes
Decision needed before apply: Yes

| PR | Contenido | ~Líneas | Runner |
|---|---|---|---|
| #1 | `packages/db`: 3 escrituras + barrel + integración camino feliz (sentinela, tripwire, `it` de `gadget`) | ~480 | `just db-check` |
| #2 | `packages/db`: batería hostil (404/409/400, jsonb, monotonía) | ~260 | `just db-check` |
| #3 | API: servicio + controller + DTO + 2 stubs `DD30-8` | ~380 | `just build-api` + curl + `just verify` |
| #4 | `shops.service.spec.ts` | ~500 | `cd apps/api/rest && npx jest` |
