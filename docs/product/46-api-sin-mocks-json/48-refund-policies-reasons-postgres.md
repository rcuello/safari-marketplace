# US-48 — `refund-policies` y `refund-reasons` desde Postgres

> Las 10 rutas de políticas y motivos de reembolso dejan de servir JSON: dos
> tablas planas sembradas con los registros del mock, filtros reales por
> `target`/`status` y escrituras persistentes. `refund-reasons` es el primer
> módulo del épico que **emite timestamps**, así que el seed inserta los del
> mock.

**Épico:** [Épico 46](./README.md)
**Fecha:** 2026-10-20
**Status:** Implementada (2026-10-21, rama `us-48-refund-policies-reasons`)
**Depende de:** [US-47](./47-faqs-terms-postgres.md) (orden secuencial del
épico, R-2: comparten `schema.sql`, el generador, `schema.prisma`,
`records.ts` y el barrel)
**LOC est.:** ~1300

## Historia

**Como** cliente que solicita un reembolso, **como** visitante que lee las
políticas de devolución (`/customer-refund-policies`,
`/vendor-refund-policies`) y **como** admin que las mantiene, **quiero** que
salgan de Postgres filtradas de verdad, **para** que el cliente vea solo las
políticas de cliente y que editar un motivo persista.

## Contexto — verificado en código (2026-10-20)

**Rutas.** Los dos controladores tienen la misma forma:
`apps/api/rest/src/refund-policies/refund-policies.controller.ts` y
`apps/api/rest/src/refund-reasons/refund-reasons.controller.ts`.

- `POST /` (`:22-23`), `PUT /:id` (`:43-44`) y `DELETE /:id` (`:53-54`):
  `@Permissions(...ADMIN_ONLY)`.
- `GET /` (`:28-29`) y `GET /:param` (`:34-35`): `@Public()`.

En total, 10 rutas.

**Qué hace hoy `refund-policies.service.ts`:**

- `findAllRefundPolicies` (`:26-50`): `limit` por defecto 10. Fuse sobre
  `title`, donde cada token de `search` **reemplaza** al anterior (gana el
  último). Si la página sale vacía cae a `slice(0, limit)` con `total =
  data.length` (0). La url es `` `/refund-policies?search=${search}&limit=${limit}` ``.
- `getRefundPolicy` (`:52-54`): busca por **slug**.
- `create`/`update` devuelven `[0]` y `remove` devuelve un string.
- `GetRefundPolicyDto` solo declara `orderBy`, `sortedBy` y `search`.

**Qué hace hoy `refund-reasons.service.ts`:**

- `findAllRefundPolicies` (sí, con ese nombre, `:26-47`): Fuse sobre `name`
  y **sin fallback**, así que una búsqueda sin resultados devuelve `data: []`.
  La url es `/refund-reasons?search=…&limit=…`.
- `getRefundPolicy` (`:49-51`): busca por slug.

**Qué envía el frontend:**

- shop, políticas (`apps/shop/src/framework/rest/client/index.ts:569-584`):
  `searchJoin=and`, `search=target:customer;status:approved` (o `vendor`) y
  `with=shop;refunds` (ignorado). Las páginas usan `limit: LIMIT` = 10
  (`pages/customer-refund-policies.tsx:17-21`,
  `apps/shop/src/lib/constants/index.ts:8`). Hoy el último token es
  `approved`, Fuse sobre `title` no encuentra nada y el fallback sirve **las
  5 políticas mezcladas con `total: 0`**.
- shop, motivos (`client/index.ts:396-402`): `searchJoin=and`, `language`, y
  `search=type.slug:X` **solo** si se pasa `type`. `refund-form.tsx` lo usa
  sin `type`.
- admin: `apps/admin/rest/src/data/refund-policy.ts` y
  `data/refund-reason.ts` (CRUD, `get({slug})`, listado paginado).

**Forma del JSON:**

- `refund-policies.json`: 5 filas, ids 1-5. Claves en orden `id, title,
  slug, target, status, description, language, translated_languages`.
  `target = 'vendor'` solo en el id 1 y `'customer'` en 2-5. `status =
  'approved'` en las 5. Sin timestamps ni `shop_id`.
- `refund-reasons.json`: 8 filas, ids 1-8. Claves en orden `id, name, slug,
  language, created_at, updated_at, deleted_at, translated_languages`.
  Todos los timestamps valen `2023-11-12T10:58:58.000000Z`.
- **Timestamps hoy:** la API los emite como `"2023-11-12T10:58:58.000Z"`
  (3 decimales), porque `CoreEntity` aplica `@Type(() => Date)`
  (`common/entities/core.entity.ts`). **No hay divergencia de decimales en
  este módulo** si el seed inserta la fecha del mock.
- `deleted_at: null` en las 8.

## Línea base (paso 2 del protocolo)

```bash
B=http://localhost:9001/api
curl -s "$B/refund-policies" > rp-default.json
curl -s "$B/refund-policies?searchJoin=and&limit=10&search=target:customer;status:approved" > rp-customer.json
curl -s "$B/refund-policies?searchJoin=and&limit=10&search=target:vendor;status:approved" > rp-vendor.json
curl -s "$B/refund-policies/customer-return-policy" > rp-slug.json
curl -s "$B/refund-reasons" > rr-default.json
curl -s "$B/refund-reasons?searchJoin=and&language=en" > rr-shop.json
curl -s "$B/refund-reasons/damaged-item" > rr-slug.json
```

## Tablas nuevas

| Tabla | Columnas propias | Restricciones |
|---|---|---|
| `refund_policies` | `title text NOT NULL`, `slug text NOT NULL`, `description text NULL`, `target text NOT NULL`, `status text NOT NULL DEFAULT 'pending'`, `shop_id bigint NULL`, `language`, timestamps | `slug` UNIQUE; CHECK `target IN ('vendor','customer')`; CHECK `status IN ('approved','pending')` (el admin conoce los dos: `apps/admin/rest/src/types/index.ts`); FK `shop_id → shops ON DELETE CASCADE` con índice |
| `refund_reasons` | `name text NOT NULL`, `slug text NOT NULL`, `language`, timestamps | `slug` UNIQUE |

Sin triggers (D-7). Sin `deleted_at` ni `translated_languages` (D-6).

## Reglas del seed

1. **`refund_policies`: 5 filas**, ids preservados, `shop_id` NULL.
   `created_at`/`updated_at` quedan con el `DEFAULT now()`: el mock no los
   trae y la salida no los emite.
2. **`refund_reasons`: 8 filas**, ids preservados, **con `created_at` y
   `updated_at` del mock** vía el helper `ts()` de `db/generate-seed.mjs:48`
   (D-3 del épico). Hoy nadie lo usa; esta US es la primera.
3. Validación previa: `target`/`status` dentro del CHECK, y slugs únicos.
   Cualquier problema detiene la generación.
4. `setval` de las 2 secuencias y conteos en la cabecera.

Conteos esperados: `refund_policies` 5 (1 vendor, 4 customer, 5 approved);
`refund_reasons` 8, todas con `created_at = '2023-11-12 10:58:58+00'`.
Conteos previos intactos, incluidos los de US-47 (`faqs` 19,
`terms_and_conditions` 5).

## Rutas — hoy → después

| Método y ruta | Guard | Hoy | Después |
|---|---|---|---|
| `GET /refund-policies` | Public | Fuse sobre el último token; fallback con `total:0` | Filtros AND: `target`, `status` (igualdad), `title` (ILIKE), `shop_id` si llega. Orden `id ASC`, `limit` por defecto 10 |
| `GET /refund-policies/:param` | Public | por slug; 200 vacío | por slug; 404 |
| `POST /refund-policies` | ADMIN_ONLY | `[0]` | inserta (`slug` vía `generateSlug(title)`; `status` del body o `pending`); devuelve la fila |
| `PUT /refund-policies/:id` | ADMIN_ONLY | `[0]` | actualiza `title`, `description`, `target`, `status`, `language`; `updatedAt: now()` |
| `DELETE /refund-policies/:id` | ADMIN_ONLY | string | borra y devuelve la fila |
| `GET /refund-reasons` | Public | Fuse sobre `name`, sin fallback | Filtro `name` (ILIKE). El token `type.slug` se **ignora**: no hay columna `type` y hoy tampoco filtra. Orden `id ASC`, `limit` por defecto 10 |
| `GET /refund-reasons/:param` | Public | por slug | por slug; 404 |
| `POST`/`PUT`/`DELETE /refund-reasons…` | ADMIN_ONLY | `[0]`/string | persisten, igual que arriba |

**Proyección de salida (D-1):**

- `refund-policies`: orden de claves del mock; **no emite** timestamps ni
  `shop_id`.
- `refund-reasons`: emite `created_at`/`updated_at` como ISO de 3 decimales
  (hoy ya salen así), `deleted_at: null` constante **entre** `updated_at` y
  `translated_languages`, y `translated_languages: ['en']`.

## Divergencias declaradas

| # | Dónde | Hoy | Después | Por qué |
|---|---|---|---|---|
| V-1 | `GET /refund-policies?search=target:customer;status:approved` | las 5 políticas, `total: 0` | las 4 de cliente, `total: 4` | D-1: filtro real |
| V-2 | ídem con `target:vendor` | las 5, `total: 0` | solo el id 1, `total: 1` | D-1 |
| V-3 | `:param` inexistente | 200 vacío | 404 | precedente `tags` |
| V-4 | `POST`/`PUT`/`DELETE` | fila 0 o string | fila real | D-1 |
| V-5 | `updated_at` de un motivo tras `PUT` | fijo | `now()` de `clock.ts` | escritura real |

## Scope

**Incluye:**

- el DDL de las 2 tablas;
- los 2 bloques del generador, con timestamps de `refund_reasons`;
- el seed regenerado;
- la re-introspección;
- `RefundPolicyRecord` y `RefundReasonRecord`;
- 2 repositorios con sus integration tests;
- el barrel;
- los 2 servicios de Nest sin import de JSON, con sus specs;
- la documentación.

**NO incluye:**

- el módulo `refunds` (stub sin JSON, fuera del épico);
- la relación política ↔ reembolsos (`with=shop;refunds` se sigue
  ignorando);
- columna `type` en los motivos;
- soft delete;
- cambiar guards;
- frontend.

## Criterios de aceptación

### CA-1 — Esquema

Las 2 tablas están en `db/schema.sql` según la tabla de arriba y ninguna
sentencia previa cambia.

### CA-2 — Seed

Se cumplen los conteos y hay 0 huérfanas en `refund_policies.shop_id`. Los 8
motivos conservan las fechas del mock (consulta `psql`).

### CA-3 — Equivalencia de forma

`GET /refund-policies/customer-return-policy`, `GET
/refund-reasons/damaged-item`, `GET /refund-reasons` y `GET
/refund-reasons?searchJoin=and&language=en` son **deep-equal** a la línea
base, **timestamps incluidos**. `GET /refund-policies` sin parámetros es
deep-equal salvo nada: el mock sin `search` ya devolvía las 5 con `total: 5`.

### CA-4 — Filtros reales

V-1 y V-2 se demuestran con el antes y el después pegados.

### CA-5 — Escrituras

`POST`, `PUT` y `DELETE` en los dos módulos con Bearer de `admin@demo.com` y
status exacto. El `GET` posterior refleja el cambio. `updated_at` de un
motivo editado es posterior a `2023-11-12`.

### CA-6 — Sin import huérfano ni regresión

`grep` sin imports de JSON en los dos módulos. `just db-check`, `npx jest`,
`just build-api` y `just verify` en verde; `/api/settings` en 5503 B.

## Escenarios Gherkin

```gherkin
Feature: Politicas y motivos de reembolso desde Postgres
  Scenario: CA-4 — el cliente ve solo politicas de cliente
    When GET /refund-policies?searchJoin=and&limit=10&search=target:customer;status:approved
    Then data contiene los ids 2, 3, 4 y 5
    And total vale 4

  Scenario: CA-3 — los motivos conservan sus fechas
    Given la linea base de GET /refund-reasons con la API mock
    When se consulta contra Postgres
    Then el JSON es deep-equal, created_at incluido

  Scenario: CA-5 — crear un motivo
    Given un token de admin@demo.com
    When POST /refund-reasons con name "Producto defectuoso"
    Then el status es 201 y la respuesta trae slug "producto-defectuoso"
    And GET /refund-reasons/producto-defectuoso devuelve 200
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---|---|
| `db/schema.sql` | 2 tablas |
| `db/generate-seed.mjs` | 2 bloques; primer uso de `ts()` |
| `db/seed.sql` | regenerado |
| `db/README.md` | modelo de reembolsos |
| `packages/db/prisma/schema.prisma` | 2 modelos + renombres de todos; relación inversa en `Shop` |
| `packages/db/src/records.ts` | 2 records |
| `packages/db/src/repositories/refund-policies.repository.ts` (+ `.integration.test.ts`) | nuevo |
| `packages/db/src/repositories/refund-reasons.repository.ts` (+ `.integration.test.ts`) | nuevo |
| `packages/db/index.ts`, `packages/db/README.md` | exports y documentación |
| `apps/api/rest/src/refund-policies/refund-policies.service.ts` (+ `.spec.ts`) | Postgres |
| `apps/api/rest/src/refund-reasons/refund-reasons.service.ts` (+ `.spec.ts`) | Postgres; se puede renombrar el método `findAllRefundPolicies` a `findAll` si se actualiza el controlador |

## Definición de Done

Seguir el [Protocolo del épico](./README.md#protocolo-de-ejecución-de-una-us-de-este-épico)
y pegar:

- [x] Los 7 cuerpos de la línea base con sus bytes.
- [x] La salida de `node db/generate-seed.mjs` y la de `just db-reset`.
- [x] `psql` con:
  - los conteos;
  - `SELECT min(created_at), max(created_at) FROM refund_reasons`;
  - 0 huérfanas;
  - los conteos previos intactos.
- [x] `prisma validate` y `migrate diff` con `EXIT=0`; `just db-build`.
- [x] `just db-check` y `npx jest` con sus recuentos.
- [x] `just build-api` y `just verify` (5503 B).
- [x] Deep-equal de CA-3 y el antes/después de V-1..V-5.
- [x] Los `curl` de escritura con Bearer.
- [x] `grep` sin imports de JSON.
- [x] Status de la US y fila del épico.

### Evidencia (2026-10-21)

**Línea base** (API recién arrancada, antes de tocar los servicios):

```
rp-customer.json     1889 B  ids=[1,2,3,4,5] total=0 per_page="10"
rp-default.json      1837 B  ids=[1,2,3,4,5] total=5 per_page=10
rp-slug.json          298 B  id=2
rp-vendor.json       1885 B  ids=[1,2,3,4,5] total=0 per_page="10"
rr-default.json      1943 B  ids=[1..8] total=8 per_page=10
rr-shop.json         1943 B  ids=[1..8] total=8 per_page=10
rr-slug.json          196 B  id=3 (created_at "2023-11-12T10:58:58.000Z")
```

**Generador y `just db-reset`:**

```
db/seed.sql generado (622 KB)
  … · 19 faqs · 5 terms_and_conditions (5 duplicados descartados) · 5 refund_policies · 8 refund_reasons
  * esquema y datos de referencia aplicados
```

**`psql`:**

- `refund_policies`: 5 filas (1 vendor, 4 customer, 5 approved) y 0
  huérfanas en `shop_id`.
- `refund_reasons`: 8 filas; `min/max(created_at)` y `min/max(updated_at)`
  valen `2023-11-12 10:58:58+00` en las cuatro.
- Conteos previos intactos: 19 faqs, 5 terms, 10 types, 12 shops, 198
  categories, 14 manufacturers, 10 tags, 1200 products, 3 users, 4
  permissions y 6 permission_user.

**Prisma:** `prisma validate` dice *valid*. `migrate diff --exit-code` da
`EXIT=0`, con los modelos tomados de `db pull --print`. Los CHECK que Prisma
no modela (`refund_policies_target_check` y `refund_policies_status_check`)
quedan listados en la cabecera de `schema.prisma`.

**Suites:**

| Comando | Antes (US-47) | Después |
|---|---|---|
| `just db-check` | 14 archivos / 257 | **16 / 273** (+16) |
| `npx jest` | 12 suites / 316 | **14 / 330** (+14) |

`just build-api`: `Done in 243.09s`.

`just verify`:

```
OK   API    :9001/api/settings  200  5503B
OK   Shop   :3003/en  200  190788B  cards:30
OK   Admin  :3002/en/login  200  72821B  cards:1
```

**CA-3:** comparación byte a byte, que cubre el orden de claves, la
posición de `deleted_at` y los timestamps:

```
rp-default.json    IDENTICO 1837B -> 1837B
rp-slug.json       IDENTICO 298B -> 298B
rr-default.json    IDENTICO 1943B -> 1943B
rr-shop.json       IDENTICO 1943B -> 1943B
rr-slug.json       IDENTICO 196B -> 196B
```

**V-1 / V-2:**

```
rp-customer.json  antes ids=[1,2,3,4,5] total=0 | despues ids=[2,3,4,5] total=4 per_page="10"
rp-vendor.json    antes ids=[1,2,3,4,5] total=0 | despues ids=[1] total=1 per_page="10"
```

Prueba de humo en la tienda real: `/en/customer-refund-policies` muestra las
políticas 2, 3, 4 y 5, y `/en/vendor-refund-policies` solo la 1. Antes de
esta US mostraban las 5 mezcladas.

**CA-5** (Bearer de `admin@demo.com`):

| Petición | Status | Resultado |
|---|---|---|
| `POST /refund-reasons {name:"Producto defectuoso"}` | 201 | `slug:"producto-defectuoso"` |
| `GET /refund-reasons/producto-defectuoso` | 200 | |
| `PUT /refund-reasons/3` | 200 | `updated_at` pasa de `2023-11-12T10:58:58.000Z` a `2026-10-21T14:26:43.741Z` y `created_at` no cambia (V-5) |
| `DELETE /refund-reasons/12` | 200 | devuelve la fila; el `GET` siguiente da 404 |
| `POST /refund-policies` sin `status` | 201 | `status:"pending"` |
| `GET ?search=target:vendor;status:pending` | 200 | `total=1` |
| `PUT /refund-policies/9 {status:"approved"}` | 200 | |
| `PUT /refund-policies/9 {target:"admin"}` | 400 | `CHECK refund_policies_target_check` |
| `DELETE /refund-policies/9` | 200 | |
| `GET /refund-policies/no-existe` | 404 | (V-3) |
| `POST /refund-reasons` sin token | 401 | el guard sigue intacto |

Después se restauró el motivo 3 por `psql` (nombre y `updated_at` del mock).
`GET /refund-reasons` volvió a ser idéntico a la línea base.

**CA-6:** el `grep` no devuelve nada (`exit=1`). `git diff db/schema.sql`
tiene 48 inserciones y 0 eliminaciones.

**Decisión de implementación:** al crear, el slug sale del `slug` del cuerpo
si llega no vacío, y si no, del título o el nombre. El admin envía `slug` en
los dos formularios (`refund-policy-form.tsx:124-140` y
`refund-reason-form.tsx`), y es el mismo criterio que en términos (US-47).

## Notas para el agente ejecutor

- **No asumir 6 decimales.** Este módulo ya emite 3 hoy: la divergencia de
  decimales del `CLAUDE.md` no aplica aquí, y si aparece es un error del
  seed.
- `deleted_at` va en una posición concreta del objeto, entre `updated_at` y
  `translated_languages`. El deep-equal no mira el orden de claves; el
  `Content-Length` sí lo mide. Comparar también los bytes.
- `refund-reasons` sin `search` devuelve hoy las 8 filas en una página
  (`limit` 10): la línea base debe coincidir sin excepciones.
- Que el shop envíe `with=shop;refunds` no obliga a nada: hoy se ignora y
  sigue ignorándose.
