# US-47 — `faqs` y `terms-and-conditions` desde Postgres

> Las 12 rutas de FAQ y términos y condiciones dejan de servir JSON estático:
> dos tablas nuevas sembradas con los registros del mock, filtros reales y
> escrituras que persisten. Es la primera US del épico, así que además
> reescribe la cabecera de `db/schema.sql` que levanta la exclusión
> transaccional.

**Épico:** [Épico 46](./README.md)
**Fecha:** 2026-10-20
**Status:** Implementada (2026-10-20, rama `us-47-faqs-terms`)
**Depende de:** ninguna
**LOC est.:** ~1600

## Historia

**Como** visitante del shop (`/help`, `/terms`, las páginas de FAQ y
términos de cada tienda) y **como** admin que modera ese contenido,
**quiero** que FAQ y términos salgan de Postgres con filtros que funcionen,
**para** que editarlos persista y que cada tienda vea su contenido y no las
mismas 10 filas que hoy ve todo el mundo.

## Contexto — verificado en código (2026-10-20)

Fuente previa: el análisis de
[US-34](../33-contenido-configuracion-postgres/34-esquema-capa-datos-contenido.md),
re-verificado y corregido donde se indica.

**Rutas.** Las 12 son de `apps/api/rest/src/faqs/faqs.controller.ts` (5) y
de `apps/api/rest/src/terms-and-conditions/terms-and-conditions.controller.ts`
(7). Este segundo archivo tiene 3 controladores: el principal en `:18`,
`disapprove-terms-and-conditions` en `:62-71` y
`approve-terms-and-conditions` en `:73-82`, estos dos con `@Permissions` a
nivel de clase. En los dos módulos los `GET` son `@Public()` y `POST`/`PUT`/
`DELETE` son `@Permissions(...ADMIN_ONLY)`.

**Qué hace hoy `faqs.service.ts`:**

- `findAllFaqs` (`:26-54`): `limit` por defecto 10. `shop_id` filtra
  `Number(p.shop_id)`, pero **ninguna fila del JSON tiene `shop_id`**, así
  que cualquier `shop_id` vacía la lista. `search` se parte por `;` y cada
  token **reemplaza** el resultado anterior con `fuse.search(value)` sobre
  `faq_title`, ignorando la clave: solo gana el último token. Si la página
  sale vacía cae a `this.faqs.slice(0, limit)`, **pero `total` sigue siendo
  `data.length` (0)** (`:45-52`). La url es `` `/faqs?search=${search}&limit=${limit}` `` (`:49`).
- `getFaq` (`:56-58`) busca **por id** (`p.id === Number(param)`). Un id
  desconocido da `undefined`, que Nest serializa como 200 con cuerpo vacío.
- `create` y `update` devuelven `this.faqs[0]`; `remove` devuelve un string
  (`:22-24`, `:60-66`).

**Qué hace hoy `terms-and-conditions.service.ts`:**

- `findAllTermsAndConditions` (`:29-58`) tiene el mismo patrón: desestructura
  `is_approved` y **no filtra por él**, ignora `shop_id`, Fuse va sobre
  `title`, y cae al fallback con `total: 0`.
- `findOne` (`:60-62`) busca **por slug** y devuelve la primera coincidencia
  en el orden del archivo.
- approve/disapprove (`:72-88`) **mutan el objeto en memoria**
  (`is_approved = true|false`, un booleano) y lo devuelven. Un id
  desconocido lanza TypeError, que llega como 500.

**Qué envía el frontend:**

- shop `/help` (`apps/shop/src/pages/help.tsx:15-19`): `faq_type: 'global',
  issued_by: 'Super Admin', limit: 100`. `faqs.all`
  (`apps/shop/src/framework/rest/client/index.ts:508-515`) los mete en
  `search` con `formatSearchParams`, y el hook añade `language`. Resultado:
  `search=faq_type:global;issued_by:Super Admin`.
- shop `/shops/[slug]/faqs` (`pages/shops/[slug]/faqs.tsx:24-31`):
  `faq_type: 'shop', shop_id, issued_by: <nombre de tienda>, limit: 100`.
- shop `/terms` (`pages/terms.tsx:17-22`): `type: 'global', issued_by:
  'Super Admin', is_approved: true, limit: 100`. `formatSearchParams`
  reescribe `type` como `type.slug`
  (`apps/shop/src/framework/rest/client/http-client.ts:235-244`), y el
  cliente añade `searchJoin: 'and'` (`client/index.ts:521-537`). Resultado:
  `search=type.slug:global;issued_by:Super Admin`.
- shop `/shops/[slug]/terms` (`pages/shops/[slug]/terms.tsx:30-38`):
  `shop_id`, `limit: 100`, `is_approved: true`, sin `search`.
- admin, faqs (`apps/admin/rest/src/data/client/faqs.ts:13-35`): `shop_id`
  como query y además dentro de `search=faq_title:…;shop_id:…`. Al crear
  envía `{language, faq_title, faq_description, shop_id}`
  (`components/faqs/faqs-form.tsx:90-109`). **No envía ni `faq_type` ni
  `issued_by`.**
- admin, terms (`data/client/terms-and-condition.ts:16-39`): mismo patrón
  con `title`, más approve/disapprove con `{id}`. Al crear envía `{…,
  slug?, shop_id}` (`components/terms-and-conditions/terms-and-conditions-form.tsx:126-138`).

**Forma del JSON** (`node -e`):

- `faqs.json`: 19 filas, ids 1-19, orden de claves `id, faq_title, slug,
  faq_description, faq_type, issued_by, language, translated_languages`.
  - `faq_type = 'global'` en 1-5 y `'shop'` en 6-19.
  - `issued_by` es «Super Admin» en 1-5 y el **nombre** de una de las tiendas
    1-7 en 6-19, dos FAQ por tienda.
  - Sin `shop_id`, `user_id` ni timestamps.
  - Varios slugs terminan en `?`.
- `terms-and-conditions.json`: 10 filas en el orden de ids `8,9,10,11,12,1,
  2,3,4,5`.
  - Los ids 8-12 son **copias exactas** de 1-5, así que hay 5 slugs
    duplicados.
  - `type: 'global'`, `issued_by: 'Super Admin'`, `is_approved: 1` (entero)
    en las 10.
  - Claves en orden: `id, title, slug, description, type, issued_by,
    is_approved, language, translated_languages`.

Timestamps: `CoreEntity` aplica `@Type(() => Date)`
(`common/entities/core.entity.ts`), pero estos dos mocks no traen
`created_at`/`updated_at`, así que la respuesta **no emite** esas claves.

## Línea base (paso 2 del protocolo)

Con la API recién arrancada (`just api-dev`), guardar en el scratchpad:

```bash
B=http://localhost:9001/api
curl -s "$B/faqs" > faqs-default.json
curl -s "$B/faqs?limit=100&language=en&search=faq_type:global;issued_by:Super%20Admin" > faqs-help.json
curl -s "$B/faqs?limit=100&language=en&shop_id=1&search=faq_type:shop;issued_by:Furniture%20Shop" > faqs-shop1.json
curl -s "$B/faqs/7" > faq-7.json
curl -s "$B/terms-and-conditions" > terms-default.json
curl -s "$B/terms-and-conditions?searchJoin=and&limit=100&is_approved=true&search=type.slug:global;issued_by:Super%20Admin" > terms-global.json
curl -s "$B/terms-and-conditions/privacy-policy" > terms-privacy.json
```

## Tablas nuevas

Mismo estilo del archivo: banner por tabla, `bigserial`, `language text NOT
NULL DEFAULT 'es'`, `created_at`/`updated_at timestamptz NOT NULL DEFAULT
now()`, **sin trigger** (D-7 del épico).

| Tabla | Columnas propias | Restricciones |
|---|---|---|
| `faqs` | `faq_title text NOT NULL`, `slug text NOT NULL`, `faq_description text NOT NULL`, `faq_type text NOT NULL`, `issued_by text NOT NULL`, `shop_id bigint NULL`, `user_id bigint NULL` | `slug` UNIQUE; CHECK `faq_type IN ('global','shop')`; FK `shop_id → shops ON DELETE CASCADE` (el contenido de una tienda borrada no tiene a quién pertenecer); FK `user_id → users ON DELETE SET NULL` (el autor se puede borrar sin borrar la FAQ); índice por cada FK |
| `terms_and_conditions` | `title`, `slug`, `description`, `type`, `issued_by`, `is_approved boolean NOT NULL DEFAULT false`, `shop_id`, `user_id` | Igual que `faqs`, con CHECK `type IN ('global','shop')` |

**Cabecera de `db/schema.sql:13-16` (decisión 4 del épico).** Se reescribe
para decir:

- que la exclusión transaccional **se levanta** por el
  [Épico 46](./README.md) (2026-10-20) y que cada US añade su bloque;
- que siguen fuera de alcance **carritos, direcciones y wallets/balances**;
- que identidad entra desde US-20.

## Reglas del seed

Bloques nuevos en `db/generate-seed.mjs`, después de `shops` y `users`:

1. **`faqs`: 19 filas, ids preservados.**
   - `shop_id` se **deriva** de `issued_by` contra el nombre de las tiendas
     sembradas cuando `faq_type = 'shop'` (las 7 coinciden exactamente con
     las tiendas 1-7). Si un nombre no casa con ninguna tienda, el generador
     **falla**.
   - `user_id` queda NULL.
   - Slugs tal cual, incluidos los que llevan `?`.
2. **`terms_and_conditions`: 5 filas**, deduplicadas por slug conservando la
   **primera aparición en el orden del archivo** (ids 8-12).
   - Si dos filas con el mismo slug difieren en contenido, el generador
     falla.
   - `is_approved` llega como entero; se convierte con `bool()`.
   - `shop_id`/`user_id` quedan NULL.
3. `setval` de las dos secuencias, y conteos nuevos en la cabecera del seed y
   en la consola.

Conteos esperados tras `just db-reset`:

- `faqs` 19: 5 globales con `shop_id` NULL y 14 de tienda con `shop_id ∈
  1..7`, dos por tienda.
- `terms_and_conditions` 5: ids 8-12, `is_approved = true` en todas.
- Conteos previos intactos: 10 types, 12 shops, 198 categorías, 14
  manufacturers, 10 tags, 1200 productos, 3 users, 4 permisos, 6
  `permission_user`.

## Rutas — hoy → después

| Método y ruta | Guard | Hoy | Después |
|---|---|---|---|
| `GET /faqs` | Public | Fuse sobre el último token; fallback con `total:0` | Filtros reales con AND: `shop_id` (query o token), `faq_type`, `issued_by` (igualdad exacta), `faq_title` (ILIKE `%…%`). Orden `id ASC`, `limit` por defecto 10 |
| `GET /faqs/:param` | Public | por id; 200 vacío si no existe | por id; **404** si no existe o no es entero seguro |
| `POST /faqs` | ADMIN_ONLY | `faqs[0]` | inserta. `slug` vía `generateSlug(faq_title)`. Con `shop_id`: `faq_type='shop'` e `issued_by` = nombre de la tienda. Sin él: `'global'` y `'Super Admin'`. `user_id` = usuario del token. Devuelve la fila |
| `PUT /faqs/:id` | ADMIN_ONLY | `faqs[0]` | actualiza `faq_title`, `faq_description` y `language`; `updatedAt: now()`. 404 si no existe |
| `DELETE /faqs/:id` | ADMIN_ONLY | string | borra y devuelve la fila borrada; 404 si no existe |
| `GET /terms-and-conditions` | Public | Fuse; fallback; `is_approved` ignorado | Filtros reales con AND: `shop_id`, `type` (token `type.slug`), `issued_by`, `title` (ILIKE), `is_approved` (`'true'`/`'false'` como query). Orden `id ASC`, `limit` por defecto 10 |
| `GET /terms-and-conditions/:param` | Public | por slug, primera aparición | por slug; 404 si no existe |
| `POST /terms-and-conditions` | ADMIN_ONLY | `[0]` | inserta. Usa el `slug` recibido o lo genera. `type`/`issued_by` derivados igual que en faqs. `is_approved = true`, porque solo el super_admin pasa el guard. Devuelve la fila |
| `PUT /terms-and-conditions/:id` | ADMIN_ONLY | `[0]` | actualiza `title`, `description` y `language` |
| `DELETE /terms-and-conditions/:id` | ADMIN_ONLY | string | borra y devuelve la fila |
| `POST /approve-terms-and-conditions` | ADMIN_ONLY | muta la memoria, emite booleano, 500 si no existe | persiste `is_approved = true` y devuelve la fila; 404 si no existe |
| `POST /disapprove-terms-and-conditions` | ADMIN_ONLY | ídem con `false` | ídem con `false` |

**Proyección de salida (D-1):**

- Orden de claves idéntico al mock.
- Se **omiten** `shop_id`, `user_id`, `created_at` y `updated_at` en ambos
  módulos, igual que el mock.
- `translated_languages: ['en']` constante (D-6).
- `is_approved` se emite como **entero `1`/`0`**: la columna es boolean y el
  servicio la proyecta con `Number(...)`.
- El paginador usa el `paginate()` de Nest con el `limit` crudo y la url
  base del mock.

## Divergencias declaradas

| # | Dónde | Hoy | Después | Por qué |
|---|---|---|---|---|
| V-1 | `GET /faqs` y `GET /terms…` con `search` | primeras N filas sin filtrar y `total: 0` | solo las filas que cumplen el filtro, con `total` real | D-1: los filtros funcionan. Ejemplo: `/help` pasa de 10 filas mezcladas a las **5 globales** |
| V-2 | `GET /faqs?shop_id=N` | primeras 10 de cualquier tipo | las 2 FAQ de la tienda N (con `faq_type:shop`) | `shop_id` derivado en el seed |
| V-3 | `GET /terms-and-conditions` sin filtros | 10 filas, `total: 10` | 5 filas, `total: 5` | deduplicación por slug |
| V-4 | `:param` inexistente | 200 vacío | 404 | precedente `tags.service.ts:108-110` |
| V-5 | `POST`/`PUT` | fila 0 | fila creada/actualizada | D-1 |
| V-6 | `DELETE` | string `"This action removes…"` | la fila borrada (JSON) | D-1 |
| V-7 | approve/disapprove | `is_approved` booleano tras mutar | `is_approved` entero `1`/`0`, igual que en las lecturas | un solo tipo por clave en todo el contrato |

## Scope

**Incluye:**

- el DDL de las 2 tablas y la reescritura de la cabecera de `db/schema.sql`;
- los 2 bloques del generador y el seed regenerado;
- la re-introspección de `schema.prisma`;
- `FaqRecord` y `TermsAndConditionsRecord` con sus mappers;
- 2 repositorios con sus `*.integration.test.ts`;
- el barrel;
- los 2 servicios de Nest reescritos, sin import de JSON, con sus specs de
  Jest;
- la documentación del modelo.

**NO incluye:**

- cambiar guards (R-6 del épico);
- tocar `apps/shop` o `apps/admin`;
- soft delete (`deleted_at`);
- `translated_languages` como columna;
- `orderBy`/`sortedBy` (los DTO los declaran y el mock los ignora; siguen
  ignorados);
- traducciones por `language`: se guarda la columna, pero no hay filas por
  idioma;
- las otras 6 tablas de contenido (US-48..51).

## Criterios de aceptación

### CA-1 — Esquema y cabecera

`db/schema.sql` define `faqs` y `terms_and_conditions` según la tabla de
arriba, con FK indexadas y ninguna sentencia previa modificada. La cabecera
`:13-16` dice lo que pide la decisión 4. `git diff db/schema.sql` muestra
solo la cabecera y adiciones.

### CA-2 — Seed desde los registros del mock

Los conteos de «Reglas del seed» se cumplen y hay 0 filas huérfanas por cada
FK nueva. `terms_and_conditions` contiene el id 10 con slug
`privacy-policy`, y **no** el id 3. El generador falla con un mensaje si un
`issued_by` de tienda no casa con ninguna tienda sembrada (se prueba
alterando un JSON y restaurándolo después).

### CA-3 — Equivalencia de forma

`GET /faqs/7` y `GET /terms-and-conditions/privacy-policy` son **deep-equal**
a la línea base, sin excepciones. Para `GET /faqs` y `GET /terms-and-conditions`
sin parámetros:

- los elementos de `data` son deep-equal elemento a elemento con la línea
  base: los 10 primeros FAQ, y los términos 8-12;
- las claves del paginador coinciden en nombre y orden;
- solo difieren los valores declarados en V-3.

### CA-4 — Filtros reales

- `/help` devuelve los 5 FAQ globales, `total: 5`.
- `GET /faqs?shop_id=1&search=faq_type:shop;issued_by:Furniture%20Shop`
  devuelve los ids 6 y 7.
- `/terms` devuelve 5 filas.
- `is_approved=false` devuelve 0 filas tras el seed y 1 tras un
  disapprove.

### CA-5 — Escrituras persistentes

`POST` → `GET /:param` devuelve lo creado, con `slug` generado y `faq_type`/
`issued_by` derivados del `shop_id`. `PUT` cambia el título y fija
`updated_at` desde `clock.ts`. `DELETE` borra. approve/disapprove persisten
y sobreviven a un reinicio de la API. Un id inexistente da 404. Todo con
Bearer de `admin@demo.com` y status exacto.

### CA-6 — Sin import huérfano y sin regresión

- `grep -n "pickbazar\|@db/" apps/api/rest/src/faqs apps/api/rest/src/terms-and-conditions -r`
  no devuelve imports de JSON.
- `just db-check`, `npx jest`, `just build-api` y `just verify` en verde, con
  los recuentos pegados.
- `/api/settings` sigue en 5503 B.

## Escenarios Gherkin

```gherkin
Feature: FAQ y terminos desde Postgres
  Scenario: CA-2 — los terminos duplicados no rompen el unique de slug
    Given el mock trae 10 terminos con 5 slugs repetidos por copias exactas
    When se regenera el seed y se ejecuta just db-reset
    Then terms_and_conditions tiene 5 filas con ids 8 a 12

  Scenario: CA-3 — el detalle no cambia al migrar
    Given la linea base capturada de GET /faqs/7 con la API mock
    When se consulta GET /faqs/7 contra Postgres
    Then el JSON es deep-equal a la linea base

  Scenario: CA-4 — la pagina de ayuda ve solo las FAQ globales
    When GET /faqs?limit=100&search=faq_type:global;issued_by:Super Admin
    Then data contiene los ids 1 a 5 y total vale 5

  Scenario: CA-5 — moderar un termino persiste
    Given un token de admin@demo.com
    When POST /disapprove-terms-and-conditions con id 10
    Then la respuesta trae is_approved 0
    And tras reiniciar la API GET /terms-and-conditions?is_approved=false devuelve el id 10

  Scenario: CA-5 — id inexistente
    When GET /faqs/999999
    Then el status es 404
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---|---|
| `db/schema.sql` | cabecera `:13-16` + 2 tablas |
| `db/generate-seed.mjs` | lee `faqs.json` y `terms-and-conditions.json`; deriva `shop_id`; deduplica; valida; `setval` |
| `db/seed.sql` | regenerado (artefacto) |
| `db/README.md` | modelo de contenido: FAQ y términos, deduplicación, derivación de `shop_id` |
| `packages/db/prisma/schema.prisma` | 2 modelos por `db pull` + renombres; relaciones inversas en `Shop` y `User` |
| `packages/db/src/records.ts` | `FaqRecord`, `TermsAndConditionsRecord` |
| `packages/db/src/repositories/faqs.repository.ts` | `listFaqs`, `findFaqById`, `createFaq`, `updateFaq`, `deleteFaq` |
| `packages/db/src/repositories/terms-and-conditions.repository.ts` | `list…`, `find…BySlug`, `create…`, `update…`, `delete…`, `setTermsApproval` |
| `packages/db/src/repositories/*.integration.test.ts` | 2 nuevos |
| `packages/db/index.ts` | exports |
| `packages/db/README.md` | records y repositorios nuevos |
| `apps/api/rest/src/faqs/faqs.service.ts` (+ `.spec.ts` nuevo) | Postgres; el controlador inyecta el usuario en `create` |
| `apps/api/rest/src/terms-and-conditions/terms-and-conditions.service.ts` (+ `.spec.ts`) | Postgres |
| `apps/api/rest/src/faqs/faqs.controller.ts`, `terms-and-conditions.controller.ts` | solo `async`/`await` y `@CurrentUser` en `POST`; los guards no cambian |
| `docs/product/46-api-sin-mocks-json/README.md` | Status de la fila |

## Definición de Done

Seguir el [Protocolo del épico](./README.md#protocolo-de-ejecución-de-una-us-de-este-épico)
y pegar:

- [x] Los 7 cuerpos de la línea base, con su tamaño en bytes.
- [x] `node db/generate-seed.mjs`, con los conteos nuevos, y la corrida
      fallida con un `issued_by` alterado (restaurado después).
- [x] `just db-reset` sin errores.
- [x] `psql` con:
  - los conteos de «Reglas del seed»;
  - 0 huérfanas en `faqs.shop_id`, `faqs.user_id`,
    `terms_and_conditions.shop_id` y `terms_and_conditions.user_id`;
  - `SELECT id FROM terms_and_conditions WHERE slug='privacy-policy'` → 10;
  - los conteos previos intactos.
- [x] `npx prisma validate` y `npx prisma migrate diff … --exit-code` con
      `EXIT=0`; `just db-build` limpio.
- [x] `just db-check` con el recuento (sube respecto a la línea base de esta
      US).
- [x] `cd apps/api/rest && npx jest` con el recuento.
- [x] `just build-api` y `just verify` en verde, `/api/settings` en 5503 B.
- [x] Comparación `node -e` de CA-3 y la evidencia de cada divergencia
      V-1..V-7.
- [x] Los `curl` de CA-5, con Bearer y status exacto.
- [x] El `grep` de CA-6 vacío.
- [x] Status de la US y fila del épico actualizados.

### Evidencia (2026-10-20)

**Línea base** (API mock recién arrancada, antes de tocar los servicios):

```
faq-7.json                566 B  id=7 keys=id,faq_title,slug,faq_description,faq_type,issued_by,language,translated_languages
faqs-default.json        6279 B  data:10 ids=1,2,3,4,5,6,7,8,9,10 total=19 per_page=10
faqs-help.json          17026 B  data:19 ids=1..19 total=0 per_page="100"
faqs-shop1.json         17028 B  data:19 ids=1..19 total=0 per_page="100"
terms-default.json       4454 B  data:10 ids=8,9,10,11,12,1,2,3,4,5 total=10 per_page=10
terms-global.json        4525 B  data:10 ids=8,9,10,11,12,1,2,3,4,5 total=0 per_page="100"
terms-privacy.json        371 B  id=10 keys=id,title,slug,description,type,issued_by,is_approved,language,translated_languages
```

**Generador** (corrida buena, y corrida con `issued_by` de la FAQ 6 alterado;
el JSON se restauró con `git checkout` y `seed.sql` no se tocó):

```
db/seed.sql generado (619 KB)
  10 types · 12 shops (3 recuperados) · 198 categorías · 14 manufacturers · 10 tags · 1200 productos · 3 usuarios · 4 permisos · 1 become_seller · 3 shop_staff · 19 faqs · 5 terms_and_conditions (5 duplicados descartados)

El mock viola 1 restriccion(es) del esquema:
  - faqs 6: issued_by 'Tienda Fantasma' no casa con ninguna tienda sembrada
EXIT=1
seed.sql intacto
```

**`psql` tras `just db-reset`:** faqs 19 (5 con `shop_id` NULL y 14 de
tienda, 2 por cada tienda 1..7); terms 5 (ids 8-12, los 5 aprobados,
`privacy-policy` → 10); 0 huérfanas en las 4 FK. Conteos previos intactos:
10 types, 12 shops, 198 categories, 14 manufacturers, 10 tags, 1200 products,
3 users, 4 permissions y 6 permission_user.

**Prisma:** `prisma validate`: *The schema … is valid*; `prisma migrate diff
--exit-code`: *No difference detected*, `EXIT=0`. Los modelos se tomaron de
`prisma db pull --print`, que introspecciona sin sobrescribir los renombres
de los 17 modelos previos, y se renombraron a `Faq` y `TermsAndConditions`.

**Suites:**

| Comando | Línea base | Después |
|---|---|---|
| `just db-check` | 12 archivos / 228 tests | **14 / 257** (+2 archivos, +29 tests) |
| `npx jest` | 10 suites / 294 tests (medido excluyendo los specs nuevos) | **12 / 316** (+2 suites, +22 tests) |

`just build-api`: `Done in 114.38s`.

`just verify`:

```
OK   API    :9001/api/settings  200  5503B  569ms
OK   Shop   :3003/en  200  190788B  1516ms  cards:30
OK   Admin  :3002/en/login  200  72821B  150ms  cards:1
```

**CA-3** (`node -e`, comparación con orden de claves):

```
faq-7.json           IDENTICO 566B -> 566B
terms-privacy.json   IDENTICO 371B -> 371B
faqs-default.json  | elementos de data deep-equal con la base: true (10 de 10) | claves del paginador iguales y en orden: true
   paginador que difiere: ninguno
terms-default.json | elementos de data deep-equal con la base: true (5 de 10) | claves del paginador iguales y en orden: true
   paginador que difiere: total: 10 -> 5 ; count: 10 -> 5 ; lastItem: 9 -> 4      (V-3)
```

**V-1, V-2 y CA-4:**

```
faqs-help.json     antes ids=[1..19] total=0 | despues ids=[1,2,3,4,5] total=5 per_page="100"
faqs-shop1.json    antes ids=[1..19] total=0 | despues ids=[6,7] total=2 per_page="100"
terms-global.json  antes ids=[8,9,10,11,12,1,2,3,4,5] total=0 | despues ids=[8,9,10,11,12] total=5 per_page="100"
```

Prueba de humo en la tienda real (SSR contra la API): `/en/help` muestra las
5 FAQ globales y 0 de las 14 de tienda; `/en/terms` muestra los 5 títulos.

**CA-5** (Bearer de `admin@demo.com`):

| Petición | Status | Resultado |
|---|---|---|
| `POST /faqs` con `shop_id:"2"` | 201 | `faq_type:"shop"`, `issued_by:"Clothing Shop"`; en `psql`: `shop_id=2`, `user_id=3` |
| `GET /faqs/27` | 200 | la fila creada |
| `PUT /faqs/27` | 200 | título nuevo, slug intacto, `updated_at > created_at` |
| `DELETE /faqs/27` | 200 | la fila borrada (V-6) |
| `GET /faqs/27` tras borrar | 404 | |
| `GET /faqs/999999` y `PUT /faqs/999999` | 404 | (V-4) |
| `POST /faqs` sin token | 401 | guard intacto |
| `POST /faqs` con `shop_id:"999999"` | 400 | `faqs.shop_id referencia un registro inexistente` |
| `POST /terms-and-conditions` con slug y `shop_id:"3"` | 201 | `type:"shop"`, `issued_by:"Bags Shop"`, `is_approved:1` |
| `PUT` y `DELETE` del término | 200 y 200 | luego `GET` → 404 |
| `POST /disapprove-terms-and-conditions {id:10}` | 201 | `is_approved:0` (V-7) |
| `POST /approve-terms-and-conditions {id:999999}` | 404 | antes 500 |
| `GET ?is_approved=false` tras reiniciar la API | 200 | `ids=[10] total=1`: sobrevive al reinicio |

Después se re-aprobó el id 10 para devolver el seed a su estado de reposo.

**CA-6:** el `grep` no devuelve nada (`exit=1`). `git diff db/schema.sql`:
66 inserciones y 4 eliminaciones. Las 4 eliminaciones son las líneas de la
cabecera `:13-16`, que se reescriben con el mismo número de líneas; ninguna
sentencia previa cambia.

## Notas para el agente ejecutor

- **Primera US del épico.** No hay un `resolverUsuarioPorEmail` todavía (lo
  crea US-51); aquí no hace falta, porque estos mocks no referencian
  usuarios.
- **El orden importa en la deduplicación**: «primera aparición en el orden
  del archivo», no el id más bajo. Aquí el resultado coincide (8-12), pero el
  generador debe implementar la regla, no el atajo.
- **Las claves que el mock omite no se emiten.** La tentación es emitir
  `shop_id: null`; el mock no trae la clave, así que el DTO no la incluye
  (D-1).
- **`is_approved` como query llega como string** (`'true'`): no hay
  `transform` en el `ValidationPipe` (`main.ts:9`).
- **`issued_by` filtra por igualdad exacta, no por ILIKE**: el shop envía el
  nombre exacto de la tienda.
- Slugs con `?`: el admin edita por id (faqs), así que no llegan a una URL.
  No normalizarlos en el seed.
- El fallback de Fuse con `total:0` es un bug, no un contrato: no
  reproducirlo (V-1).
