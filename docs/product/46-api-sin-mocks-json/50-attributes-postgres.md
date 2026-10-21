# US-50 — `attributes` y sus valores desde Postgres

> Las 5 rutas de atributos de producto (color, talla, tipo de archivo…)
> dejan de servir JSON: un agregado padre-hijo (`attributes` +
> `attribute_values`) sembrado con los 8 atributos y 27 valores del mock, con
> FK real a `shops` y escrituras que reconcilian los valores.

**Épico:** [Épico 46](./README.md)
**Fecha:** 2026-10-20
**Status:** Implementada (2026-10-21, rama `us-50-attributes`)
**Depende de:** [US-49](./49-taxes-shippings-postgres.md) (orden
secuencial del épico, R-2)
**LOC est.:** ~1300

## Historia

**Como** admin que define los atributos con los que se construyen las
variaciones de producto, **quiero** que atributos y valores vivan en
Postgres ligados a su tienda, **para** que crearlos y editarlos persista y
que el formulario de producto variable vea los de la tienda correcta.

## Contexto — verificado en código (2026-10-20)

Fuente previa: el análisis de
[US-34](../33-contenido-configuracion-postgres/34-esquema-capa-datos-contenido.md).
Aquí se corrigen dos de sus afirmaciones:

- Hay **3** slugs con mayúsculas (`color-OMG`, `size-zLh`, `color-A6u`), no
  4.
- El admin **no** envía `id` en los valores al crear.

**Rutas.** `apps/api/rest/src/attributes/attributes.controller.ts` declara
`@Permissions(...ADMIN_ONLY)` **a nivel de clase** (`:17-18`): `POST /`
(`:22`), `GET /` (`:27`), `GET /:param` (`:32`), `PUT /:id` (`:37`) y
`DELETE /:id` (`:45`). En total, 5 rutas. Ninguna recibe `@Query`.

**Qué hace hoy `attributes.service.ts`:**

- `findAll()` devuelve **el array completo**, sin paginador ni filtros.
- `findOne(param)` busca `p.id === Number(param) || p.slug === param`, es
  decir, **por id o por slug**. Si no encuentra nada, 200 vacío.
- `create`/`update` devuelven `attributes[0]` y `remove` un string.

**Qué envía el admin:**

- `apps/admin/rest/src/data/client/attribute.ts:16-34`: `all`/`paginated`
  envían `searchJoin=and` y `search=type:…;name:…;shop_id:…` (con
  `formatSearchParams`, que reescribe `type` como `type.slug`), y esperan un
  **array** (`all`).
- Llamadas reales:
  - `pages/attributes/index.tsx:22-26`: sin `shop_id`, todos los atributos;
  - `pages/[shop]/attributes/index.tsx:50-55`: con `shop_id`;
  - `components/product/product-variable-form.tsx:66-69`: con el `shop_id`
    del producto.
- Al crear (`components/attribute/attribute-form.tsx:64-83`) envía
  `{language, name, shop_id: Number, values: [{language, value, meta}],
  slug?}`. **Sin `id` en los valores.**
- Al actualizar (`:87-97`) envía `{id, name, shop_id, values: [{language,
  id: Number(id), value, meta}]}`. Un valor **nuevo** añadido en la edición
  llega con `id: NaN`, que se serializa como `null`.

**Forma del JSON** (`attributes.json`, `node -e`):

- 8 filas en orden **id DESC**: 11, 10, 9, 8, 6, 5, 4, 3.
- Claves en orden: `id, name, shop_id, language, translated_languages,
  slug, type, values`.
- `type` es `{id:null, name:null, slug:null, logo:null}` en las 8.
- `shop_id ∈ {1, 2, 7, 9, 11}`, todos sembrados.
- Sin `created_at`/`updated_at`.
- 27 valores en total (ids 8-36), de 2 a 6 por atributo, en **id ASC dentro
  de cada padre**. Claves `id, value, attribute_id, slug, meta, language,
  translated_languages`.
  - `meta` no es nulo en 17 de ellos (nombres de color, `#hex`, iconos).
  - Los slugs de valor son únicos globalmente.

**Riesgo de autorización (R-6 del épico), sin cambio:** la clase es
`ADMIN_ONLY` aunque `pages/[shop]/attributes` es una pantalla del dueño de
tienda, así que un `store_owner` recibe 403 hoy y lo seguirá recibiendo. Se
anota en el reporte y no se toca.

## Línea base (paso 2 del protocolo)

Con token de `admin@demo.com` (`POST /api/token`):

```bash
B=http://localhost:9001/api; H="Authorization: Bearer $TOKEN"
curl -s -H "$H" "$B/attributes" > attr-all.json
curl -s -H "$H" "$B/attributes?searchJoin=and&search=shop_id:11" > attr-shop11.json
curl -s -H "$H" "$B/attributes/5" > attr-5.json
curl -s -H "$H" "$B/attributes/color-OMG" > attr-slug.json
```

## Tablas nuevas

| Tabla | Columnas propias | Restricciones |
|---|---|---|
| `attributes` | `name text NOT NULL`, `slug text NOT NULL`, `shop_id bigint NOT NULL`, `language`, timestamps | `slug` UNIQUE; FK `shop_id → shops ON DELETE CASCADE` (un atributo es de su tienda, igual que `products.shop_id`) con índice |
| `attribute_values` | `attribute_id bigint NOT NULL`, `value text NOT NULL`, `slug text NOT NULL`, `meta text NULL`, `language`, timestamps | FK `attribute_id → attributes ON DELETE CASCADE` con índice; UNIQUE `(attribute_id, slug)` |

Sin `type_id`: el mock lo trae todo `null`. Sin `shop_id` en los valores:
se deriva del padre. Sin triggers (D-7).

## Reglas del seed

1. `attributes`: 8 filas, ids preservados; `shop_id` validado contra el
   conjunto final de tiendas (las de `shops.json` más las recuperadas).
2. `attribute_values`: 27 filas, ids preservados.
   - `attribute_id` sale **del padre iterado**, no del campo del hijo. Si el
     campo del hijo no coincide con el padre, el generador falla.
   - Slugs tal cual, incluidas las mayúsculas.
3. `setval` de las 2 secuencias.

Conteos esperados: `attributes` 8, `attribute_values` 27 (2 + 3 + 3 + 2 + 4
+ 6 + 4 + 3), 0 huérfanas. Conteos previos intactos.

## Rutas — hoy → después

| Método y ruta | Guard | Hoy | Después |
|---|---|---|---|
| `GET /attributes` | ADMIN_ONLY | array completo | **array sin paginar** (como hoy). Si `search` trae `shop_id:N`, filtra por tienda; si trae `name:X`, ILIKE. El token `type.slug` se **ignora** (no hay `type`). Orden `id DESC`; valores en `id ASC` |
| `GET /attributes/:param` | ADMIN_ONLY | por id o slug; 200 vacío | por id si `param` es entero seguro, si no por slug; 404 |
| `POST /attributes` | ADMIN_ONLY | `[0]` | crea atributo + valores en **una transacción**. `slug` vía `generateSlug(name)`, que añade sufijo si ya existe (hay 3 atributos «Color»), o el `slug` enviado. Slug de cada valor vía `generateSlug(value)` dentro del atributo. 400 si `shop_id` no existe (`InvalidReferenceError`) |
| `PUT /attributes/:id` | ADMIN_ONLY | `[0]` | actualiza `name` y **reconcilia** los valores en una transacción: un `id` que pertenece al atributo se actualiza, un `id` nulo o NaN se inserta, y un valor existente ausente del body se borra. `updatedAt: now()` en el padre y en los valores tocados. 404 si no existe |
| `DELETE /attributes/:id` | ADMIN_ONLY | string | borra (cascada a valores) y devuelve la fila borrada con sus valores; 404 |

**Proyección (D-1):** orden de claves del mock en los dos niveles.
`translated_languages: ['en']` en los dos niveles, `type` constante todo
`null`, y `values[].attribute_id` desde la FK. **No se emiten timestamps**:
el mock no los trae.

## Divergencias declaradas

| # | Dónde | Hoy | Después | Por qué |
|---|---|---|---|---|
| V-1 | `GET /attributes?search=shop_id:N` | los 8 | solo los de la tienda N | D-1. Ejemplo: tienda 11 → ids 10 y 9 |
| V-2 | `:param` inexistente | 200 vacío | 404 | precedente `tags` |
| V-3 | escrituras | fila 0 o string | fila real con valores | D-1 |
| V-4 | slugs de atributos creados | — | en minúscula vía `slugify` | los 3 slugs con mayúsculas del seed se leen tal cual; los nuevos salen normalizados |

## Scope

**Incluye:**

- el DDL de las 2 tablas;
- el bloque del generador;
- el seed regenerado;
- la re-introspección (relación `Attribute.values` e inversa en `Shop`);
- `AttributeRecord` y `AttributeValueRecord`;
- el repositorio con la reconciliación transaccional y su integration test;
- el barrel;
- el servicio de Nest sin import de JSON, con su spec;
- la documentación.

**NO incluye:**

- persistir variaciones de producto sobre estos atributos (épico aparte);
- `type_id`;
- `shop_id` en los valores;
- abrir la ruta a `store_owner` (R-6);
- `IMPORT_ATTRIBUTES` (otro módulo, stub);
- paginar;
- frontend.

## Criterios de aceptación

### CA-1 — Esquema

Las 2 tablas están en `db/schema.sql` con su FK indexada y no cambia nada
previo.

### CA-2 — Seed

8 + 27 filas, 0 huérfanas en `attributes.shop_id` y
`attribute_values.attribute_id`. Una corrida del generador con un
`values[].attribute_id` alterado falla (se restaura después).

### CA-3 — Equivalencia

`GET /attributes`, `GET /attributes/5` y `GET /attributes/color-OMG` son
**byte a byte** iguales a la línea base: mismo orden de atributos y de
valores, mismo orden de claves.

### CA-4 — Filtro por tienda

V-1, con el antes y el después pegados.

### CA-5 — Escrituras transaccionales

- Crear un atributo con 2 valores devuelve 201 con sus ids.
- Un `PUT` que edita uno, añade otro (`id: null`) y omite el tercero deja
  exactamente los esperados, verificado por `psql`.
- Un `POST` con `shop_id` 999 da 400 **sin** dejar filas sueltas.
- `DELETE` borra en cascada.

Todo con Bearer de `admin@demo.com` y status exacto.

### CA-6 — Sin import huérfano ni regresión

`grep` sin imports de JSON. `just db-check`, `npx jest`, `just build-api` y
`just verify` en verde.

## Escenarios Gherkin

```gherkin
Feature: Atributos desde Postgres
  Scenario: CA-3 — el listado no cambia
    Given la linea base de GET /attributes con token de admin
    When se consulta contra Postgres
    Then el cuerpo es byte a byte identico

  Scenario: CA-5 — editar reconcilia los valores
    Given un atributo con valores A, B y C
    When PUT con A editado, B ausente y un valor nuevo D con id null
    Then attribute_values tiene A editado, C y D
    And B ya no existe

  Scenario: CA-5 — tienda inexistente no deja basura
    When POST /attributes con shop_id 999 y dos valores
    Then el status es 400
    And no hay filas nuevas en attributes ni en attribute_values
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---|---|
| `db/schema.sql` | 2 tablas |
| `db/generate-seed.mjs`, `db/seed.sql` | bloque padre-hijo; regenerado |
| `db/README.md` | modelo de atributos |
| `packages/db/prisma/schema.prisma` | 2 modelos + renombres de todos |
| `packages/db/src/records.ts` | 2 records |
| `packages/db/src/repositories/attributes.repository.ts` (+ `.integration.test.ts`) | `listAttributes`, `findAttributeByIdOrSlug`, `createAttribute`, `updateAttribute` (reconciliación en `$transaction`), `deleteAttribute` |
| `packages/db/index.ts`, `packages/db/README.md` | exports y documentación |
| `apps/api/rest/src/attributes/attributes.service.ts` (+ `.spec.ts`) | Postgres |
| `apps/api/rest/src/attributes/attributes.controller.ts` | `@Query()` en `GET /` para recibir `search`; los guards no cambian |

## Definición de Done

Seguir el [Protocolo del épico](./README.md#protocolo-de-ejecución-de-una-us-de-este-épico)
y pegar:

- [x] Línea base (4 `curl` con Bearer) con sus bytes.
- [x] Generador (corrida buena y corrida que falla), y `just db-reset`.
- [x] `psql` con los conteos, 0 huérfanas y los conteos previos.
- [x] `prisma validate` y `migrate diff` con `EXIT=0`; `just db-build`.
- [x] `just db-check` y `npx jest` con sus recuentos.
- [x] `just build-api` y `just verify`.
- [x] Byte a byte de CA-3; antes y después de V-1.
- [x] `curl` y `psql` de CA-5.
- [x] `grep` sin imports de JSON.
- [x] Status de la US y fila del épico.

### Evidencia (2026-10-21)

**Línea base** (API mock recién arrancada, Bearer de `admin@demo.com`; sin
token da 401):

```
attr-5.json           878 B  id=5 slug=language valores=[15,16,17,18,19,20]
attr-all.json        4662 B  ids=[11,10,9,8,6,5,4,3] valores=27
attr-shop11.json     4662 B  ids=[11,10,9,8,6,5,4,3] valores=27   (filtro ignorado)
attr-slug.json        528 B  id=10 slug=color-OMG valores=[32,33,34]
```

**Generador:** la corrida buena da `… · 8 attributes · 27 attribute_values`.
La corrida con `values[0].attribute_id = 999` en el atributo 11 se detiene
con *attribute_values 35: attribute_id 999 no coincide con su padre 11*,
`EXIT=1`, y deja `seed.sql` intacto. El JSON se restauró con `git checkout`.

**`psql` tras `just db-reset`:**

- `attributes` 8 y `attribute_values` 27, repartidos `11:2 · 10:3 · 9:3 ·
  8:2 · 6:4 · 5:6 · 4:4 · 3:3`.
- 0 huérfanas en `attributes.shop_id` y en `attribute_values.attribute_id`.
- Conteos previos intactos: 19 faqs, 5 terms, 5 refund_policies, 8
  refund_reasons, 1 taxes, 1 shippings, 10 types, 12 shops, 198 categories,
  14 manufacturers, 10 tags, 1200 products, 3 users, 4 permissions y 6
  permission_user.

**Prisma:** `prisma validate` dice *valid* y `migrate diff --exit-code` da
`EXIT=0`. La relación `Attribute.values` y su inversa `Shop.attributes`
salen de `db pull --print`.

**Suites:**

| Comando | Antes (US-49) | Después |
|---|---|---|
| `just db-check` | 18 / 283 | **19 / 296** (+13) |
| `npx jest` | 16 / 340 | **17 / 348** (+8) |

Nota: en una de las corridas, `become-seller.integration.test.ts` (US-44,
no tocado) falló por tiempo: tardó 6,5 s con la máquina cargada, frente al
límite de 5 s de vitest. Aislado pasa 9/9, y la corrida completa siguiente
dio 19/296 en verde. No es una regresión de esta US.

`just build-api` y `just verify` en verde: `API 5503B · Shop 190788B
cards:30 · Admin 72821B`.

**CA-3** (byte a byte):

```
attr-all.json    IDENTICO 4662B -> 4662B
attr-5.json      IDENTICO 878B -> 878B
attr-slug.json   IDENTICO 528B -> 528B
```

**V-1** (`search=shop_id:11`): antes devolvía `ids=[11,10,9,8,6,5,4,3]`;
después devuelve `ids=[10,9]`, que es exactamente el subconjunto byte a byte
del mock con `shop_id === 11`.

**CA-5** (Bearer de `admin@demo.com`, payloads con la forma del admin):

| Petición | Status | Resultado |
|---|---|---|
| `POST /attributes` con 2 valores sin `id` | 201 | atributo 28; valores 61 (`madera`) y 62 (`metal`, `meta:"#999"`) |
| `PUT /attributes/28`: edita 61, omite 62, añade `{id:null, value:"Vidrio"}` | 200 | `psql`: quedan `61 Madera clara madera` y `63 Vidrio vidrio`. El 62 ya no existe |
| `PUT /attributes/28` con `values:[{id:8}]` (del atributo 3) | 400 | `psql`: la fila 8 sigue en el atributo 3 con valor `Red` |
| `POST /attributes` con `shop_id:999` y 2 valores | 400 | `` `attributes.shop_id` referencia un registro inexistente ``; filas 9/29 antes y después |
| `DELETE /attributes/28` | 200 | 0 valores restantes del 28 (cascada) |
| `GET /attributes/999999` | 404 | (V-2) |

Al terminar, la base volvió a 8/27 y `GET /attributes` es idéntico a la línea
base.

**Corrección de implementación durante la verificación.** El primer 400 de
`shop_id:999` decía `` `attributes.desconocida` ``. En un nested write, el
adaptador de Postgres no informa del campo (`meta.field_name`) en el P2003.
Como la única FK que puede fallar al crear es `shop_id`, `createAttribute` la
nombra solo para ese código, y un P2002 sigue diciendo `slug`. El test de
integración ahora asevera el texto.

**Incidencia de entorno (sin cambio de código).** Al reiniciar la API, el
`dist/` de `apps/api/rest` quedó incompleto: faltaba `dist/messages`, porque
un `taskkill` lo cortó a mitad de compilación, y el `tsbuildinfo`
incremental lo daba por actualizado. Además, el proceso viejo siguió
respondiendo en el 9001 con el código anterior. Se resolvió matando ese PID,
borrando `dist/` (artefacto ignorado por git) y recompilando.

**CA-6:** el `grep` no devuelve nada (`exit=1`). `git diff db/schema.sql`
tiene 42 inserciones y 0 eliminaciones.

**R-6 sin cambio:** `attributes` sigue siendo `ADMIN_ONLY` a nivel de clase,
así que `pages/[shop]/attributes` (dueño de tienda) sigue recibiendo 403.

## Notas para el agente ejecutor

- **Dos órdenes distintos**: atributos `id DESC`, valores `id ASC`. Con el
  `include` de Prisma se fija el `orderBy` del hijo explícitamente.
- **`id: NaN` del admin llega como `null`** en el JSON del body. La
  reconciliación trata `null`/ausente/no entero como «nuevo». Un `id` que
  existe pero pertenece a **otro** atributo da 400, no se reasigna en
  silencio.
- `GET /:param` acepta id **o** slug. `Number('color-OMG')` es NaN, así que
  primero se prueba el entero seguro y después el slug.
- `generateSlug` ya resuelve colisiones con sufijo. No inventar otro
  esquema de sufijos.
