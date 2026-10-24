# US-67 — El mensaje del 409 por clave única nombra el campo real

> Todo `P2002` de la capa de datos se traduce a `SlugConflictError`, cuyo
> mensaje dice siempre «Ya existe un registro de `X` con el slug `Y`». El 409
> es correcto, pero el texto miente cuando el campo no es un slug: cupones
> (`code`), reseñas (`user_id, product_id, order_id`) y reportes de abuso
> (`user_id, model_type, model_id`). Y en los agregados con slug, `Y` es el
> nombre del campo, no el slug, así que sale «con el slug `slug`».

**Épico:** ninguno (US standalone). Nace de los reportes de US-52 y US-54.
**Fecha:** 2026-10-22
**Status:** ✅ Completada (2026-10-23), opción (c)
**Depende de:** ninguna dura. Toca `packages/db`, que comparte con el Épico
46 (`domain-errors.ts` y varios repositorios), así que **no puede ir en
paralelo** con ninguna US de ese épico (R-2): va entre dos de ellas.
**LOC est.:** ~120

**Es un cambio de mensaje y de estructura, no de comportamiento.** El status
HTTP (409), el `code` interno y las rutas que lo emiten no cambian. Por la
regla de no mezclar refactor y feature, va en un commit propio y sin tocar
ninguna otra cosa.

## Historia

**Como** consumidor de la API (el admin, el shop o quien lea los logs),
**quiero** que un 409 por clave única diga qué campo choca, **para** no
buscar un slug que no existe cuando lo repetido es un código de cupón o una
reseña duplicada.

## Contexto — verificado en código (2026-10-22, `main` en `a4ac611` + US-56 sin commit)

**La clase** (`packages/db/src/domain-errors.ts:120-130`):

```ts
/** El slug calculado ya existe (P2002 — solo alcanzable por carrera). */
export class SlugConflictError extends CatalogWriteError {
  readonly code = CATALOG_ERROR_CODES.SlugConflict;   // 'CATALOG_SLUG_CONFLICT'
  constructor(aggregate: string, slug: string) {
    super(`Ya existe un registro de \`${aggregate}\` con el slug \`${slug}\`.`, aggregate);
```

El JSDoc dice «solo alcanzable por carrera», pero desde el Épico 46 hay
uniques que no son slug y que se violan de forma normal (un código repetido o
una reseña repetida), no por carrera.

**El traductor** (`translateCatalogWriteError`, mismo archivo):

- ante un `P2002`, el segundo argumento es `meta.target.join(', ')` si
  `target` es un array; si no, `context.uniqueField ?? 'slug'`. Es decir:
  **le pasa el nombre del campo, nunca el valor**. Por eso, para un slug,
  el mensaje real es «con el slug `slug`»;
- ante un `P2003` sin `meta.field_name`, usa **ese mismo** `uniqueField` como
  nombre de la FK. Esa doble función es la razón del hack de
  `coupons.repository.ts:127` (`uniqueField: code === 'P2003' ? 'shop_id' :
  'code'`) y de que `categories` y `tags` omitan `uniqueField` a propósito
  (`categories.repository.ts:476-484`).

**Llamadas** (`grep -rn uniqueField packages/db/src/repositories/`, sin
tests):

| Repositorio | `uniqueField` | Qué protege el unique |
|---|---|---|
| `types.repository.ts:105,144,179` | `'slug'` | slug |
| `coupons.repository.ts:127` | `'code'` (o `'shop_id'` si es P2003) | `code` |
| `reviews.repository.ts:134` | `'user_id, product_id, order_id'` | el único de expresión |
| `abusive-reports.repository.ts:122` | `'user_id, model_type, model_id'` | `UNIQUE` de tres columnas |
| `conversations.repository.ts:190` | `'shop_id'` | upsert: el P2002 no llega en la práctica |
| `attributes.repository.ts:186` | `'shop_id'` solo si es P2003 | slug (cae al default `'slug'`) |
| `categories`, `tags`, `products` y el resto (19 repositorios llaman al traductor) | sin `uniqueField` | slug, por el default |

**La nota de US-29** (`docs/product/README.md:282-287`): `products` tiene un
segundo unique (`products_procedencia_key`, el parcial del scraper). Omitir
`uniqueField` ahí haría que un P2002 de procedencia diga `slug`. Esta US no
debe empeorar ese caso; ver CA-3.

**El mapper HTTP** (`apps/api/rest/src/common/errors/domain-error.mapper.ts:81-100`):
tabla cerrada de 5 códigos. `SlugConflict` → `ConflictException(error.message)`.
El cuerpo HTTP lleva solo `{statusCode, message, error}`: **el `code` no sale
de la API**.

**Consumidores del texto o del code:** `grep -rln
"CATALOG_SLUG_CONFLICT\|SlugConflict\|con el slug\|Ya existe un registro"`
en `apps/shop/src` y `apps/admin/rest/src` no devuelve nada. Ningún frontend
lee el mensaje ni el code.

**Tests que mencionan la clase o el code** (`grep` en `packages/db/src` y
`apps/api/rest/src`): **13 archivos y unas 41 referencias**. Son:

- en `packages/db`: `shops`, `coupons`, `reviews` y `abusive-reports`
  `.integration.test.ts`;
- en la API: los specs de `categories`, `manufacturers`, `products`,
  `shops`, `tags`, `coupons`, `reviews`, `reviews/reports` y
  `common/errors/domain-error.mapper`.

**Ninguno asserta el texto** «con el slug»: todos comprueban
`toBeInstanceOf(SlugConflictError)` o `ConflictException`/409. El único que
construye la clase a mano es `domain-error.mapper.spec.ts:76-80`, y le pasa
un **valor** (`'gadget-2'`), no un nombre de campo: refleja la lectura
equivocada del parámetro.

Por otro lado, la cabecera de `domain-errors.ts` dice que su `git diff` «MUST
quedar vacío» (CA-7 de US-27b). Esa regla ya se relajó en `dd98e06`, que
añadió `InvalidFieldValueError`. Esta US vuelve a tocarlo con la misma
justificación: el cambio es genérico y no mete texto de un agregado
concreto.

## Opciones evaluadas

| Opción | Qué es | Tests que cambian | Riesgo |
|---|---|---|---|
| **(a)** Texto condicional | Si el campo es `slug`, mantener «con el slug…»; si no, otro texto | 0 | Mantiene «con el slug `slug`» (el parámetro sigue siendo el campo) y suma una rama |
| **(b)** Clase nueva `UniqueConflictError` con code propio | `SlugConflictError` solo para slug; la nueva para el resto | los 13 archivos que usen el agregado afectado, más el mapper (6.º código), su spec y `isCatalogWriteError` | Amplía el «conjunto cerrado de 5 códigos» por una diferencia que la API no publica |
| **(c)** Misma clase y code, mensaje genérico **(recomendada)** | El parámetro pasa a llamarse `field` y el texto nombra el campo: p. ej. «Ya existe un registro de `coupons` con el mismo `code`.» | 0 de comportamiento; 1 ajuste de argumento en `domain-error.mapper.spec.ts` | Mínimo. El nombre de la clase queda más estrecho que su uso (ver decisiones abiertas) |

**Recomendación: (c).** Arregla el texto en los tres agregados del reporte y
el «slug `slug`» de los demás con un solo cambio en `domain-errors.ts`. No
toca el contrato HTTP: el status y la forma del cuerpo siguen iguales, y el
`code` no se publica. Tampoco rompe ningún test: ninguno asserta el texto.
La (b) compra una distinción que ningún consumidor usa a cambio de tocar 13
archivos de test y la tabla cerrada del mapper.

## Scope

**Incluye:**

- cambiar el mensaje (y el nombre del parámetro) de `SlugConflictError` para
  que nombre el campo o los campos en conflicto;
- actualizar su JSDoc (ya no es «solo alcanzable por carrera»);
- ajustar `domain-error.mapper.spec.ts:76-80` para que pase un nombre de
  campo y asserte el texto nuevo, de modo que el mensaje quede cubierto por
  al menos un test;
- un caso de integración que asserte el texto real de un 409 de un agregado
  sin slug (`coupons` o `reviews`) y uno con slug (`types` o `tags`).

**NO incluye:**

- renombrar la clase o el code (`SlugConflictError`,
  `CATALOG_SLUG_CONFLICT`): sería la opción (b), y queda como decisión
  abierta;
- separar `uniqueField` en dos parámetros (campo único vs. FK) para quitar el
  hack de `coupons.repository.ts:127`. Es la raíz del acoplamiento, pero
  cambia la firma del traductor en 19 repositorios: va al reporte como
  candidata a US aparte;
- pasar `uniqueField` en los repositorios que hoy lo omiten a propósito
  (`categories`, `tags`; ver su comentario);
- el texto del 400 de `InvalidReferenceError`, que tiene su propia lógica;
- cambiar statuses, rutas o frontends.

## Criterios de aceptación

### CA-1 — El texto nombra el campo real

Con la API levantada y los tokens de siempre:

| Llamada | Status | El `message` menciona |
|---|---|---|
| `POST /coupons` con un `code` que ya existe (`4OFF`) | 409 | `code`, y **no** «slug» |
| `POST /reviews` repetido del mismo usuario, producto y orden | 409 | los campos del único de reseñas, y **no** «slug» |
| `POST /abusive_reports` repetido sobre la misma reseña | 409 | `user_id, model_type, model_id`, y **no** «slug» |

### CA-2 — Los agregados con slug siguen diciéndolo bien

Un 409 por slug, provocado en un test de integración o en un spec con el
error construido, menciona `slug` **una sola vez** (no «con el slug
`slug`»).

### CA-3 — Nada cambia de comportamiento

- Los mismos casos siguen dando 409. El cuerpo HTTP conserva la forma
  `{statusCode, message, error: "Conflict"}`.
- `CATALOG_ERROR_CODES` sigue teniendo 5 valores y el mapper la misma tabla.
- En `products`, un P2002 sigue cayendo en la misma rama que hoy (la nota de
  US-29). La US no cambia qué campo se reporta ahí, solo la frase.

### CA-4 — Sin regresión

`just db-check`, `npx jest`, `just build-api` y `just verify` en verde, con
recuentos. Los 13 archivos de test que usan la clase pasan sin cambios,
salvo el ajuste declarado en `domain-error.mapper.spec.ts`.

## Escenarios Gherkin

```gherkin
Feature: Mensaje del 409 por clave unica
  Scenario: CA-1 — un cupon repetido nombra el codigo
    Given el cupon 4OFF del seed
    When el admin hace POST /api/coupons con code 4OFF
    Then la respuesta es 409
    And el message menciona "code" y no menciona "slug"

  Scenario: CA-2 — un slug repetido no dice "slug" dos veces
    Given un SlugConflictError del agregado types sobre el campo slug
    When se mapea a HTTP
    Then el message menciona "slug" una sola vez
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `packages/db/src/domain-errors.ts` | mensaje, nombre del parámetro y JSDoc de `SlugConflictError` |
| `apps/api/rest/src/common/errors/domain-error.mapper.spec.ts` | argumento de campo y assert del texto |
| un `*.integration.test.ts` con agregado sin slug y otro con slug | assert del texto real |
| `packages/db/README.md` | una línea sobre lo que significa el 409 |

## Definición de Done

- [x] Línea base con la API recién arrancada: el `message` de los tres 409
  de CA-1, pegado, con la palabra «slug».
- [x] El cambio en `domain-errors.ts` (`git diff` pegado, corto).
- [x] CA-1 con `curl`, Bearer y status exacto, antes y después.
- [x] CA-2 y CA-3 cubiertos por tests nuevos o ajustados, con su salida.
- [x] CA-4: `just db-check`, `npx jest`, `just build-api` y `just verify` con
  recuentos.
- [x] Filas de prueba borradas tras la evidencia, o `just db-reset`.
- [x] Status actualizado aquí y en el mapa de `docs/product/README.md`.

## Notas para el agente ejecutor

- **Verificar qué trae `meta.target` bajo Prisma 7 + adapter-pg** antes de
  redactar el texto. Si es un array, el traductor ya usa los nombres de
  columna reales y `uniqueField` sobra en el P2002; si no lo es (lo que
  sugieren los 409 de US-52 y US-54), el campo sale de `uniqueField` o del
  default `'slug'`. Pegar el `meta` observado en el reporte.
- **El parámetro es un nombre de campo, no un valor.** El texto debe leerse
  bien con un campo (`code`) y con una lista (`user_id, product_id,
  order_id`). No intentar recuperar el valor repetido: el traductor no lo
  tiene.
- **No reabrir US-29.** En `products` la frase cambia, pero qué campo se
  reporta no. Si el agente ve que un P2002 de `products_procedencia_key`
  diría `slug`, lo anota en el reporte; no lo arregla aquí.
- Mencionar en el reporte, como candidata a US aparte, la separación de
  `uniqueField` en campo único y FK, que eliminaría el hack de
  `coupons.repository.ts:127`.

## Evidencia (2026-10-23)

**Opción aplicada: (c).** Se mantienen la clase y el code
(`SlugConflictError`, `CATALOG_SLUG_CONFLICT`). El parámetro pasa a
llamarse `field` y el mensaje nombra el campo. Con una lista de varias
columnas usa el plural: «con los mismos valores en `a, b, c`».

**`meta` observado bajo Prisma 7 + adapter-pg.** Es un P2002 provocado a
propósito sobre `types_slug_key`:

```
PrismaClientKnownRequestError P2002 {"driverAdapterError":{"name":"DriverAdapterError","cause":{"originalCode":"23505","originalMessage":"duplicate key value violates unique constraint \"types_slug_key\"","kind":"UniqueConstraintViolation","constraint":{"index":"types_slug_key"},"table":"types"}},"modelName":"Type"}
```

`meta.target` **no llega**, así que la rama del array del traductor nunca se
ejecuta: el campo sale de `uniqueField` o del default `'slug'`. El nombre
del constraint sí viene, en `driverAdapterError.cause.constraint.index`, y
podría usarse para reportar el campo real. Queda como candidata a US aparte,
junto a la separación de `uniqueField` de abajo.

**El cambio** (`git diff packages/db/src/domain-errors.ts`):

```diff
-/** El slug calculado ya existe (P2002 — solo alcanzable por carrera). */
+/**
+ * Clave única repetida (P2002). Pese al nombre, no es solo el slug: también
+ * `code` de cupones o los uniques de varias columnas de reseñas y reportes,
+ * que se violan de forma normal, no solo por carrera (US-67). `field` es el
+ * NOMBRE del campo (o la lista `a, b, c`), nunca el valor: el traductor no
+ * lo tiene.
+ */
 export class SlugConflictError extends CatalogWriteError {
   readonly code = CATALOG_ERROR_CODES.SlugConflict;
-  constructor(aggregate: string, slug: string) {
+  constructor(aggregate: string, field: string) {
     super(
-      `Ya existe un registro de \`${aggregate}\` con el slug \`${slug}\`.`,
+      field.includes(',')
+        ? `Ya existe un registro de \`${aggregate}\` con los mismos valores en \`${field}\`.`
+        : `Ya existe un registro de \`${aggregate}\` con el mismo valor en \`${field}\`.`,
       aggregate
     );
```

**CA-1.** Los tres 409 se provocan con filas del seed, sin crear nada: el
cupón `4OFF` (tienda 1, como `store_owner`), la reseña del usuario 2 sobre el
producto 1 sin orden y su reporte sobre la reseña 1.

Antes:

```
POST /coupons      → {"statusCode":409,"message":"Ya existe un registro de `coupons` con el slug `code`.","error":"Conflict"}  HTTP 409
POST /reviews      → {"statusCode":409,"message":"Ya existe un registro de `reviews` con el slug `user_id, product_id, order_id`.","error":"Conflict"}  HTTP 409
POST /abusive_reports → {"statusCode":409,"message":"Ya existe un registro de `abusive_reports` con el slug `user_id, model_type, model_id`.","error":"Conflict"}  HTTP 409
coupons|reviews|abusive_reports → 10|85|3
```

Después:

```
POST /coupons      → {"statusCode":409,"message":"Ya existe un registro de `coupons` con el mismo valor en `code`.","error":"Conflict"}  HTTP 409
POST /reviews      → {"statusCode":409,"message":"Ya existe un registro de `reviews` con los mismos valores en `user_id, product_id, order_id`.","error":"Conflict"}  HTTP 409
POST /abusive_reports → {"statusCode":409,"message":"Ya existe un registro de `abusive_reports` con los mismos valores en `user_id, model_type, model_id`.","error":"Conflict"}  HTTP 409
coupons|reviews|abusive_reports → 10|85|3
```

**CA-2 y CA-3**, con los tests ajustados:

- **`domain-error.mapper.spec.ts`:**
  - El caso existente ahora pasa un nombre de campo (`'slug'`, antes el
    valor `'gadget-2'`).
  - Asserta el cuerpo `{statusCode: 409, message, error: 'Conflict'}` y que
    «slug» sale una sola vez.
  - Hay un caso nuevo de varias columnas, sin «slug».
- **`coupons.integration.test.ts`:** el `4OFF` repetido asserta el texto
  real «…`coupons` con el mismo valor en `code`.».
- **`shops.integration.test.ts`:** el perdedor de la carrera de slug
  asserta «…`shops` con el mismo valor en `slug`.».

```
√ SlugConflict → 409; el mensaje nombra el campo y dice «slug» una sola vez (US-67)
√ SlugConflict de varias columnas → 409 con la lista de campos y sin «slug» (US-67)
✓ coupons.integration.test.ts > createCoupon > código duplicado ⇒ SlugConflictError; tienda inexistente ⇒ InvalidReferenceError
✓ shops.integration.test.ts > 409 de slug duplicado ... > dos createShop concurrentes con el mismo name: uno gana, el otro → SlugConflictError
```

`CATALOG_ERROR_CODES` sigue con 5 valores y el mapper no se tocó. En
`products` no cambia qué campo se reporta: no pasa `uniqueField`
(`products.repository.ts:742,874,900`). Un P2002 de
`products_procedencia_key` seguiría diciendo `slug`, como antes de esta US;
solo cambia la frase. Queda anotado, no se arregla aquí (nota de US-29).

**CA-4:**

```
just db-check                      →  Test Files  32 passed (32) / Tests  410 passed (410)
npx jest                           →  Test Suites: 34 passed, 34 total / Tests: 565 passed, 565 total
npx tsc --noEmit -p tsconfig.json  →  EXIT=0
just build-api                     →  Done in 19.46s.
just verify
OK   API    :9001/api/settings  200  5503B  453ms
OK   Shop   :3003/en  200  190788B  659ms  cards:30
OK   Admin  :3002/en/login  200  72821B  1472ms  cards:1
```

Los recuentos de tests:

- `db-check` sigue en 410: los asserts nuevos van dentro de tests que ya
  existían.
- `jest` pasa de 564 a 565, por el caso nuevo de varias columnas.
- El resto de los 13 archivos de test que usan la clase pasa sin cambios.

**Filas de prueba:** ninguna. Los tres 409 no escriben, y los conteos se
mantuvieron en `10|85|3`. Solo avanzó la secuencia de `coupons`.

**Candidatas a US aparte:**

- separar `uniqueField` en dos parámetros (campo único y FK), lo que quita
  el hack de `coupons.repository.ts:127`;
- derivar el campo de `driverAdapterError.cause.constraint.index`, lo que
  resolvería también el caso de `products_procedencia_key`;
- renombrar la clase y el code (opción (b)).
