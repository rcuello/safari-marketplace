# US-49 — `taxes` y `shippings` desde Postgres

> Las 10 rutas de clases de impuesto y de envío dejan de servir JSON: dos
> tablas planas de una fila cada una, sembradas con el registro del mock y
> con sus timestamps. Es la configuración que el checkout real de US-59 leerá
> para calcular impuesto y envío.

**Épico:** [Épico 46](./README.md)
**Fecha:** 2026-10-20
**Status:** Listo para ejecución
**Depende de:** [US-48](./48-refund-policies-reasons-postgres.md) (orden
secuencial del épico, R-2)
**LOC est.:** ~1100

## Historia

**Como** admin que configura impuestos y envíos (`/taxes`, `/shippings`,
`/settings`), **quiero** que esas clases vivan en Postgres, **para** que
crearlas y editarlas persista y que el checkout pueda calcular con ellas.

## Contexto — verificado en código (2026-10-20)

**Rutas.** `apps/api/rest/src/taxes/taxes.controller.ts` y
`apps/api/rest/src/shippings/shippings.controller.ts` tienen la misma forma:

- `POST /` (`:22-23`): `@Permissions(...ADMIN_ONLY)`.
- `GET /` (`:29-30`) y `GET /:id` (`:35-36`): `@Public()`. Un comentario en
  `taxes` dice que el carrito anónimo los necesita.
- `PUT /:id` y `DELETE /:id` (`taxes :41-48`, `shippings :41-51`):
  `ADMIN_ONLY`.

En total, 10 rutas.

**Qué hacen hoy los servicios:**

- `taxes.service.ts`: `findAll()` devuelve **el array completo, sin
  paginar** e ignora `GetTaxesDto`. `findOne` busca por id (200 vacío si no
  existe). `create`/`update` devuelven `[0]` y `remove` un string.
- `shippings.service.ts`: tiene el mismo patrón (`getShippings({})`).

**Qué envía el admin:**

- `pages/taxes/index.tsx:22-26` llama `useTaxesQuery({name, orderBy,
  sortedBy})`, que va a `taxClient.all`. Este envía `searchJoin=and` y
  `search=name:<término>`, y espera un **array**
  (`apps/admin/rest/src/data/client/tax.ts`).
- `pages/settings/index.tsx:17-22` pide `useTaxesQuery({limit: 999})` y
  `useShippingClassesQuery()` para poblar los selectores de clase.
- Los formularios envían el objeto entero: `TaxInput {name, rate,
  is_global, country, state, zip, city, priority, on_shipping}` y
  `ShippingInput {name, amount, is_global, type}`
  (`apps/admin/rest/src/types/index.ts:1237-1262`).
- El shop **no** llama a estas rutas. Su checkout usa
  `orders/checkout/verify`, que hoy devuelve `total_tax: 0` fijo (US-59).

**Relación con `/api/settings`.** `settings.service.ts` no consulta ni
`taxes` ni `shippings`. La relación es una referencia blanda dentro del
JSON: `settings.options.taxClass = "1"` y `shippingClass = "1"`
(`apps/api/rest/src/db/pickbazar/settings.json:61,66`). **Los ids 1 deben
preservarse** para que los selectores del admin resuelvan. Migrar estas
tablas **no cambia** `/api/settings` (5503 B), y esta US lo prueba (R-5 del
antiguo Épico 33).

**Forma del JSON** (`node -e`):

- `taxes.json`, 1 fila, en este orden peculiar:
  `{"id":1,"country":null,"state":null,"zip":null,"city":null,"rate":2,"name":"Global","is_global":true,"priority":null,"on_shipping":true,"created_at":"2021-03-25T13:26:57.000000Z","updated_at":"2021-03-25T16:07:18.000000Z"}`.
- `shippings.json`, 1 fila:
  `{"id":1,"name":"Global","amount":50,"is_global":true,"type":"fixed","created_at":"2021-03-25T13:27:49.000000Z","updated_at":"2021-03-25T13:27:49.000000Z"}`.
- **La API ya emite hoy 3 decimales** (`.000Z`) por el `@Type(() => Date)`
  de `CoreEntity`. En `taxes`, además, `created_at ≠ updated_at`.
- `ShippingType` admite `fixed | percentage | free`
  (`shippings/entities/shipping.entity.ts`).

## Línea base (paso 2 del protocolo)

```bash
B=http://localhost:9001/api
curl -s "$B/taxes" > taxes.json
curl -s "$B/taxes?limit=999" > taxes-settings.json
curl -s "$B/taxes/1" > tax-1.json
curl -s "$B/shippings" > shippings.json
curl -s "$B/shippings/1" > shipping-1.json
curl -s -D - -o settings.json "$B/settings" | grep -i content-length
```

## Tablas nuevas

| Tabla | Columnas propias | Restricciones |
|---|---|---|
| `taxes` | `name text NOT NULL`, `rate numeric NOT NULL`, `is_global boolean NOT NULL DEFAULT true`, `country text NULL`, `state text NULL`, `zip text NULL`, `city text NULL`, `priority integer NULL`, `on_shipping boolean NOT NULL DEFAULT true`, timestamps | CHECK `rate >= 0` |
| `shippings` | `name text NOT NULL`, `amount numeric NOT NULL`, `is_global boolean NOT NULL DEFAULT true`, `type text NOT NULL`, timestamps | CHECK `type IN ('fixed','percentage','free')`; CHECK `amount >= 0` |

`numeric` sin escala, para que `2` y `50` vuelvan como `2` y `50` vía
`_dec()` y no como `2.00`. Sin FK, sin triggers (D-7). Sin `language`:
ninguno de los dos mocks lo trae.

## Reglas del seed

1. `taxes`: 1 fila, `id = 1`, con `created_at`/`updated_at` del mock vía
   `ts()` (D-3).
2. `shippings`: 1 fila, `id = 1`, con sus timestamps.
3. Validación previa: `type` dentro del CHECK, y `rate`/`amount` numéricos.
4. `setval` de las 2 secuencias, para que el próximo `POST` cree el id 2.

Conteos esperados: `taxes` 1, `shippings` 1, más los previos intactos
(incluidos los de US-47/48).

## Rutas — hoy → después

| Método y ruta | Guard | Hoy | Después |
|---|---|---|---|
| `GET /taxes` | Public | array completo, query ignorada | **array completo sin paginar** (como hoy); si llega `search=name:X`, filtra `name` ILIKE. Orden `id ASC` |
| `GET /taxes/:id` | Public | por id; 200 vacío | por id; 404 si no existe o no es entero seguro |
| `POST /taxes` | ADMIN_ONLY | `[0]` | inserta y devuelve la fila; `rate` validado como número ≥ 0 (400 si no) |
| `PUT /taxes/:id` | ADMIN_ONLY | `[0]` | actualiza los campos enviados; `updatedAt: now()`; 404 |
| `DELETE /taxes/:id` | ADMIN_ONLY | string | borra y devuelve la fila; 404 |
| `GET /shippings` | Public | array completo | igual que `taxes`: array, filtro opcional `name` |
| `GET /shippings/:id` | Public | por id | por id; 404 |
| `POST`/`PUT`/`DELETE /shippings…` | ADMIN_ONLY | `[0]`/string | persisten; `type` validado contra el CHECK (400) |

**Proyección (D-1):** orden de claves **exacto** del mock (en `taxes`:
`id, country, state, zip, city, rate, name, is_global, priority,
on_shipping, created_at, updated_at`). `rate`/`amount` salen como número
JSON. Timestamps ISO de 3 decimales.

## Divergencias declaradas

| # | Dónde | Hoy | Después | Por qué |
|---|---|---|---|---|
| V-1 | `GET /taxes?search=name:X` (página `/taxes` del admin) | ignora el filtro | filtra por nombre | D-1 |
| V-2 | `:id` inexistente | 200 vacío | 404 | precedente `tags` |
| V-3 | escrituras | fila 0 o string | fila real | D-1 |

No hay ninguna otra: las dos lecturas sin filtro deben ser **byte a byte**
idénticas a la línea base.

## Scope

**Incluye:**

- el DDL de las 2 tablas;
- los 2 bloques del generador con timestamps;
- el seed regenerado;
- la re-introspección;
- `TaxRecord` y `ShippingRecord`;
- 2 repositorios con sus integration tests;
- el barrel;
- los 2 servicios de Nest sin import de JSON, con sus specs;
- la documentación.

**NO incluye:**

- usar estas tablas en `checkout/verify` (US-59);
- paginar las respuestas;
- FK desde `settings.options` (es `jsonb`);
- tocar `settings` o `/api/settings`;
- cambiar guards;
- frontend.

## Criterios de aceptación

### CA-1 — Esquema

Las 2 tablas están en `db/schema.sql` según la tabla de arriba y no cambia
nada más.

### CA-2 — Seed

1 + 1 filas, ids 1, con las fechas del mock (`psql`). Después del `setval`,
`nextval` daría 2.

### CA-3 — Byte a byte

`GET /taxes`, `GET /taxes/1`, `GET /shippings` y `GET /shippings/1` son
**byte a byte** iguales a la línea base. Se compara el tamaño en bytes y el
deep-equal, timestamps incluidos.

### CA-4 — `/api/settings` intacto

`curl -D -` de `/api/settings` sigue dando `Content-Length` 5504 (5503
caracteres en `just verify`) y su cuerpo es deep-equal a la línea base.

### CA-5 — Escrituras

`POST /taxes` con `{name:"IVA", rate:19, is_global:true, on_shipping:false}`
→ 201 con `id` 2; `GET /taxes` devuelve 2 elementos. `PUT` cambia `rate`.
`DELETE` borra. Un `rate` no numérico da 400. Lo mismo para `shippings` con
`type` inválido → 400. Todo con Bearer de `admin@demo.com` y status exacto.
Después de la evidencia, `just db-reset` o borrado de las filas de prueba.

### CA-6 — Sin import huérfano ni regresión

`grep` sin imports de JSON. `just db-check`, `npx jest`, `just build-api` y
`just verify` en verde.

## Escenarios Gherkin

```gherkin
Feature: Impuestos y envios desde Postgres
  Scenario: CA-3 — la clase de impuesto global no cambia
    Given la linea base de GET /taxes con la API mock
    When se consulta GET /taxes contra Postgres
    Then el cuerpo es byte a byte identico, created_at y updated_at incluidos

  Scenario: CA-4 — settings no se entera
    When GET /api/settings
    Then el Content-Length sigue siendo 5504

  Scenario: CA-5 — tipo de envio invalido
    Given un token de admin@demo.com
    When POST /shippings con type "gratis"
    Then el status es 400
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---|---|
| `db/schema.sql` | 2 tablas |
| `db/generate-seed.mjs`, `db/seed.sql` | 2 bloques con `ts()`; regenerado |
| `db/README.md` | configuración fiscal y de envío; relación blanda con `settings.options` |
| `packages/db/prisma/schema.prisma` | 2 modelos + renombres de todos |
| `packages/db/src/records.ts` | `TaxRecord`, `ShippingRecord` (`_dec` en `rate`/`amount`) |
| `packages/db/src/repositories/taxes.repository.ts`, `shippings.repository.ts` (+ integration tests) | nuevos |
| `packages/db/index.ts`, `packages/db/README.md` | exports y documentación |
| `apps/api/rest/src/taxes/taxes.service.ts` (+ `.spec.ts`) | Postgres |
| `apps/api/rest/src/shippings/shippings.service.ts` (+ `.spec.ts`) | Postgres |

## Definición de Done

Seguir el [Protocolo del épico](./README.md#protocolo-de-ejecución-de-una-us-de-este-épico)
y pegar:

- [ ] Línea base (6 `curl`) con sus bytes.
- [ ] Salida de `node db/generate-seed.mjs` y de `just db-reset`.
- [ ] `psql` con las 2 filas, sus timestamps y los conteos previos.
- [ ] `prisma validate` y `migrate diff` con `EXIT=0`; `just db-build`.
- [ ] `just db-check` y `npx jest` con sus recuentos.
- [ ] `just build-api` y `just verify`.
- [ ] La comparación byte a byte de CA-3 y la de CA-4.
- [ ] Los `curl` de CA-5.
- [ ] `grep` sin imports de JSON.
- [ ] Status de la US y fila del épico.

## Notas para el agente ejecutor

- **El orden de claves de `taxes` es el mayor riesgo de CA-3**: el `toTaxDto`
  se escribe en ese orden a mano, no se deriva del record.
- `_dec()` sobre un `numeric` sin escala devuelve `2`, no `2.00`. Si
  aparece `2.00`, la columna se declaró con escala.
- El admin de `/settings` pide `limit=999` y espera un array. Paginar aquí
  rompería la pantalla.
- Que `settings.options.taxClass` sea el string `"1"` no se toca: es parte
  del contrato congelado de `/api/settings`.
