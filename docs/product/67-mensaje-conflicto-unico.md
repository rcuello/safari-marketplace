# US-67 — El mensaje del 409 por clave única nombra el campo real

> Todo `P2002` de la capa de datos se traduce a `SlugConflictError`, cuyo
> mensaje dice siempre «Ya existe un registro de `X` con el slug `Y`». El 409
> es correcto, pero el texto miente cuando el campo no es un slug: cupones
> (`code`), reseñas (`user_id, product_id, order_id`) y reportes de abuso
> (`user_id, model_type, model_id`). Y en los agregados con slug, `Y` es el
> nombre del campo, no el slug, así que sale «con el slug `slug`».

**Épico:** ninguno (US standalone). Nace de los reportes de US-52 y US-54.
**Fecha:** 2026-10-22
**Status:** Listo para ejecución
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

- [ ] Línea base con la API recién arrancada: el `message` de los tres 409
  de CA-1, pegado, con la palabra «slug».
- [ ] El cambio en `domain-errors.ts` (`git diff` pegado, corto).
- [ ] CA-1 con `curl`, Bearer y status exacto, antes y después.
- [ ] CA-2 y CA-3 cubiertos por tests nuevos o ajustados, con su salida.
- [ ] CA-4: `just db-check`, `npx jest`, `just build-api` y `just verify` con
  recuentos.
- [ ] Filas de prueba borradas tras la evidencia, o `just db-reset`.
- [ ] Status actualizado aquí y en el mapa de `docs/product/README.md`.

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
