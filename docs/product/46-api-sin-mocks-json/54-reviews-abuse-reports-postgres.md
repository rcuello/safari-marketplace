# US-54 — `reviews`, `abusive_reports` y `my-reports` desde Postgres

> Las 5 rutas de reseñas dejan de servir `reviews.json`. Las 5 de reportes
> de abuso dejan de ser stubs de texto. `GET /my-reports` deja de servir
> `reports.json` a cualquiera. Todo pasa a dos tablas sembradas con los 85 y
> 3 registros del mock. Para que las 85 reseñas cierren su FK, el seed gana
> los usuarios 4 y 5.

**Épico:** [Épico 46](./README.md)
**Fecha:** 2026-10-20
**Status:** Implementada (2026-10-22, rama `us-54-reviews-abuse-reports`)
**Depende de:** US-53 (deja `toProductDto` en un mapper compartido y es la anterior en la secuencia, R-2). También necesita el helper `resolverUsuarioPorEmail` que crea US-51.
**LOC est.:** ~2000. Partir en dos PRs si pasa de ~1500 reales (R-1): corte 1 = DDL + seed + capa de datos; corte 2 = servicios Nest.

## Historia

**Como** cliente del shop, **quiero** que mis reseñas y mis reportes de
abuso se guarden de verdad. **Como** admin, **quiero** moderar esos
reportes. Todo **para que** las valoraciones de un producto reflejen lo que
la gente escribió, y no la fila 0 de un JSON.

## Contexto (verificado en código, 2026-10-20)

**`apps/api/rest/src/reviews/reviews.controller.ts`** (`@Controller('reviews')`, `:17`):

| Método y ruta | Guard | Hoy (`reviews.service.ts`) |
|---|---|---|
| `GET /api/reviews` | `@Public` (`:25`) | `page=1`, **`limit=30`** (`:22-24`). `search` se parte por `;`/`:`; la clave se descarta y el valor va a `fuse.search` con **`keys:['product_id']`**, `threshold 0.3` (`:12-16,29-35`). Así, `search=rating:5` busca «5» en *product_id* y no filtra por rating. Después, filtro exacto `product_id` (`:37-39`). Url `/reviews?search=${search}&limit=${limit}` (`:42`). Orden: el del archivo, id DESC |
| `GET /api/reviews/:id` | `@Public` (`:32`) | `find` por id; si no existe, 200 vacío (`:49-51`) |
| `POST /api/reviews` | token (`:39`) | `reviews[0]` (id 85) sin leer el body (`:53-55`) |
| `PUT /api/reviews/:id` | token (`:44`) | `reviews[0]` |
| `DELETE /api/reviews/:id` | token (`:50`) | `reviews[0]` |

`CreateReviewDto` (`dto/create-review.dto.ts`): `{rating, comment, photos?,
product_id, shop_id, order_id, variation_option_id}`. La entidad extiende
`CoreEntity`, así que `created_at`/`updated_at` **ya salen hoy con 3
decimales** (`common/entities/core.entity.ts`). El `user` anidado no, porque
no lleva `@Type`.

**`apps/api/rest/src/reviews/reports.controller.ts`** (`@Controller('abusive_reports')`, `:15`):

- `GET /` (`:20`), `GET /:id` (`:27`), `PUT /:id` (`:40`) y `DELETE /:id`
  (`:47`) son `@Permissions(...ADMIN_ONLY)`.
- `POST /` (`:34`) pide solo token.
- **Las 5 son stubs** que devuelven cadenas (`reports.service.ts:7-25`).
- `CreateReportDto = OmitType(Report, ['id','created_at','updated_at','user'])`,
  o sea `{user_id?, model_id, model_type, message}`.

**`apps/api/rest/src/reports/reports.controller.ts`** (`@Controller('my-reports')`, `:4`):

- `GET /` pide solo token y devuelve `{data: <las 3 filas de reports.json>}`
  **sin paginador y sin filtrar por usuario** (`reports.service.ts:10-14`).
- La entidad `MyReports` extiende `CoreEntity`, así que los timestamps salen
  con 3 decimales.

**Mocks** (medidos con `node -e`):

- **`reviews.json`**: 85 filas, ids 85→1.
  - Claves en orden: `id, order_id, user_id, shop_id, product_id,
    variation_option_id, comment, rating, photos, deleted_at, created_at,
    updated_at, positive_feedbacks_count, negative_feedbacks_count,
    my_feedback, abusive_reports_count, product, user`.
  - `order_id`, `variation_option_id`, `deleted_at` y `my_feedback` son
    `null` en las 85; `abusive_reports_count` vale 0 en las 85.
  - `rating ∈ {1..5}` (1: 12, 2: 4, 3: 12, 4: 10, 5: 47).
  - `photos` es `[]` salvo en el id 1 (una foto `{id, original,
    thumbnail}`).
  - Contadores no nulos: id 2 (112/13) e id 1 (5/2).
  - `user_id`: **2 → 20 filas, 4 → 38, 5 → 27**. Los usuarios 4
    (`customer2@demo.com`) y 5 (`customer3@demo.com`) **no existen en el
    seed**.
  - `shop_id ∈ 1..7`, siempre igual al `shop` del producto.
  - 56 productos distintos, todos en el seed; los ids 1..4 tienen 3 reseñas
    cada uno.
  - Por tienda: shop 6 → 49, shop 5 → 11, el resto 4-6.
  - **0 pares (user, product) repetidos.**
  - `product` embebido: snapshot Laravel de 41 claves, no la forma de
    `/products`. `user` embebido: `{id, name, email, email_verified_at,
    created_at, updated_at, is_active: 1, shop_id: null}`.
- **`reports.json`**: 3 filas, ids 3, 2, 1.
  - Todas `user_id = 2`, `model_type =
    "Marvel\\Database\\Models\\Review"` y `model_id ∈ {1, 21, 78}`; las tres
    reseñas existen.
  - Claves: `id, user_id, model_type, model_id, message, created_at,
    updated_at, user`.

**Consumidores**:

- **Shop**:
  - `framework/rest/client/index.ts:202-221`: `reviews.all` envía
    `searchJoin=and&with=user`, `product_id`, `limit=5`, `page` y
    `search=rating:N`, o `search=` vacío sin rating (`HttpClient.formatSearchParams`
    filtra valores falsy, `http-client.ts:236-244`).
  - `reviews.create`/`update` → `POST`/`PUT /reviews`;
    `components/reviews/review-form.tsx:33-51` envía `product_id`,
    `shop_id`, `order_id`, `variation_option_id` y `my_review.id` al editar.
  - `components/reviews/review-card.tsx:43-57` reporta con `{model_id,
    model_type: 'Review'}` (**nombre corto**).
  - `components/reports/report-view.tsx:38-48` pinta `message` y
    `created_at` de `/my-reports`.
- **Admin**:
  - `data/client/review.ts`: `paginated` envía `with=product;user` y
    `search=type.slug:<x>;shop_id:<n>`; `get` envía
    `with=abusive_reports.user;product;user`.
  - `reportAbuse` → `POST /abusive_reports`; `decline` → `POST
    abusive_reports/reject`, **ruta que no existe** (404).

**Identidad**:

- Helper `resolverUsuarioPorEmail` de `db/generate-seed.mjs` (US-51; D-4
  del épico): hoy **solo remapea**.
- `HASH_DEMO` (`db/generate-seed.mjs:63`) es la contraseña demo compartida.
- `customer` es el permiso id 2.
- Asserts vivos sobre usuarios: `users.integration.test.ts:120-123` exige
  `>= 3` (no se rompe). Los de `super_admin`/`staff` (`:101-105,127-132,151-157`)
  no cambian.

**Precedentes**:

- Propiedad: `products.service.ts:161-180`.
- Mapper compartido de producto: `apps/api/rest/src/products/product-dto.mapper.ts`
  (lo crea US-53).
- `_toProductRecord`: `packages/db/src/repositories/products.repository.ts:1009`.
- Índice de expresión que Prisma no modela y que `migrate diff` tolera:
  `users_email_lower_idx` (`db/schema.sql:132`).

## Línea base (D-2 del épico)

```bash
API=http://localhost:9001/api
tok() { curl -s -X POST $API/token -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"demodemo\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).token'; }
CUST=$(tok customer@demo.com); ADMIN=$(tok admin@demo.com)
curl -s "$API/reviews?searchJoin=and&with=user&product_id=1&limit=5&page=1&search="          > base-reviews-p1.json
curl -s "$API/reviews?searchJoin=and&with=user&product_id=1&limit=5&page=1&search=rating:5"  > base-reviews-p1-r5.json
curl -s "$API/reviews?searchJoin=and&with=product;user&search=shop_id:6"                      > base-reviews-admin-shop6.json
curl -s "$API/reviews"                                                                         > base-reviews-all.json
curl -s "$API/reviews/85"                                                                      > base-review-85.json
curl -s -H "Authorization: Bearer $CUST"  "$API/my-reports?with=user&orderBy=created_at&sortedBy=desc" > base-my-reports-cust.json
curl -s -H "Authorization: Bearer $ADMIN" "$API/abusive_reports"                               > base-abusive.txt
```

## Tablas nuevas

**`reviews`**

| Columna | Tipo y restricción |
|---|---|
| `id` | `bigserial PRIMARY KEY` |
| `order_id` | `bigint NULL`. **Sin FK**: la añade US-58 cuando exista `orders` |
| `user_id` | `bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE` + índice |
| `shop_id` | `bigint NOT NULL REFERENCES shops(id) ON DELETE CASCADE` + índice |
| `product_id` | `bigint NOT NULL REFERENCES products(id) ON DELETE CASCADE` + índice |
| `variation_option_id` | `bigint NULL`. Sin FK: no hay tabla de variaciones |
| `comment` | `text NOT NULL` |
| `rating` | `smallint NOT NULL CHECK (rating BETWEEN 1 AND 5)` |
| `photos` | `json NOT NULL DEFAULT '[]'` con `CHECK (json_typeof(photos) = 'array')`. **`json`, no `jsonb`** (D-5 del épico): el orden de claves de cada Attachment es contrato |
| `positive_feedbacks_count` / `negative_feedbacks_count` | `integer NOT NULL DEFAULT 0 CHECK (>= 0)` |
| `created_at` / `updated_at` | `timestamptz NOT NULL DEFAULT now()` |

Más el índice único `reviews_autor_producto_orden_key ON reviews (user_id,
product_id, COALESCE(order_id, 0))`: una reseña por compra y una sin orden
por producto. Así no rompe el seed (0 duplicados), Prisma no lo modela y se
lista en la cabecera de `schema.prisma`.

**Por qué `CASCADE`**: la reseña es contenido de su autor sobre un producto
de una tienda. Sin cualquiera de los tres no tiene sentido y no hay otro
lector que dependa de ella. Es el mismo criterio que `products.shop_id`. Los
contadores son **columnas**: no hay filas de feedback que los respalden (112
votos sobre 5 usuarios es imposible con un voto por usuario) y `feedbacks`
es un stub fuera del épico.

**`abusive_reports`**

| Columna | Tipo y restricción |
|---|---|
| `id` | `bigserial PRIMARY KEY` |
| `user_id` | `bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE` + índice |
| `model_type` | `text NOT NULL CHECK (model_type IN ('Review','Question'))` |
| `model_id` | `bigint NOT NULL`. Polimórfica, sin FK: el repositorio valida que exista |
| `message` | `text NOT NULL CHECK (length(message) > 0)` |
| `created_at` / `updated_at` | `timestamptz NOT NULL DEFAULT now()` |

Más `UNIQUE (user_id, model_type, model_id)` (un reporte por usuario y
objeto) e índice `(model_type, model_id)` para el conteo.

## Reglas del seed

1. **Usuarios (extensión del helper de US-51, D-4).**
   `resolverUsuarioPorEmail` pasa a **sembrar** cuando el email no existe:
   - inserta el usuario con el **id del mock** y el `name`, `email`,
     `is_active` (1 → `true`), `created_at` y `updated_at` del snapshot,
     con `password_hash = HASH_DEMO`;
   - añade su fila `permission_user` con `customer` (id 2);
   - no crea perfil.

   Las fuentes son los `user` embebidos de `reviews.json`. Resultado:
   usuarios **4 `customer2@demo.com`** y **5 `customer3@demo.com`**. Falla
   si un email del mock está vacío o si su id ya está ocupado por **otro**
   email. El bloque de usuarios sembrados va **después** del de `users` y
   antes de `reviews`, y el `setval('users_id_seq')` existente cubre el
   nuevo máximo.
2. **`reviews`**:
   - las 85 filas con ids, `user_id` (resuelto por el helper), `shop_id`,
     `product_id`, `comment`, `rating`, `photos`, contadores y timestamps
     del mock (D-3);
   - `order_id` y `variation_option_id` copiados (son `null`);
   - validaciones: `product_id` existe; `shop_id` == tienda del producto;
     `rating` entre 1 y 5; ningún par (user, product, order) repetido.
3. **`abusive_reports`**:
   - las 3 filas con ids, `user_id`, `model_id`, `message` y timestamps;
   - `model_type` se normaliza: `"Marvel\\Database\\Models\\Review"` →
     `'Review'`; cualquier otro FQCN hace fallar la generación;
   - validación: la reseña `model_id` existe en el bloque de reviews.
4. `setval` de `reviews_id_seq` y `abusive_reports_id_seq`. Conteos nuevos
   en cabecera y consola.

**Conteos esperados:**

| Tabla | Antes | Después |
|---|---|---|
| `users` | 3 | **5** |
| `permission_user` | 6 | **8** |
| `reviews` | — | **85** (por usuario: 2 → 20, 4 → 38, 5 → 27; por rating 12/4/12/10/47; shop 6 → 49) |
| `abusive_reports` | — | **3** |

El resto de conteos previos sigue intacto (R-3).

## Rutas

| Método y ruta | Guard (no cambia, R-6) | Después |
|---|---|---|
| `GET /reviews` | Public | Filtros reales combinados con AND: `product_id` (query), `rating:N` y `shop_id:N` desde `search`, y `type.slug:<x>` (slug del type del producto). Claves de `search` desconocidas se ignoran. Orden **id DESC**, defaults `page=1`, `limit=30`, mismo `paginate()` y misma url |
| `GET /reviews/:id` | Public | DTO o 404 |
| `POST /reviews` | token | Inserta con `user_id = user.sub`. 400 si `shop_id` ≠ tienda del producto o si `rating` está fuera de rango; 404 si el producto no existe; 409 si ya hay reseña del usuario para ese producto y orden. Devuelve el DTO (201) |
| `PUT /reviews/:id` | token | Solo el autor o `super_admin` (si no, 403). Edita `rating`, `comment` y `photos`, con `updatedAt: now()` |
| `DELETE /reviews/:id` | token | Solo el autor o `super_admin`. Devuelve el DTO borrado |
| `GET /abusive_reports` | ADMIN_ONLY | `{data: [...]}` de todos, id DESC, con el DTO de reporte |
| `GET /abusive_reports/:id` | ADMIN_ONLY | DTO o 404 |
| `POST /abusive_reports` | token | `{model_id, model_type, message}`; `user_id = user.sub`. `model_type` acepta `'Review'` o el FQCN. 404 si la reseña no existe; 409 si ya la reportó. **`'Question'` responde 400** hasta US-55, que crea `questions` |
| `PUT /abusive_reports/:id` | ADMIN_ONLY | Edita `message` |
| `DELETE /abusive_reports/:id` | ADMIN_ONLY | Borra y devuelve el DTO |
| `GET /my-reports` | token | `{data: [...]}` **solo del usuario actual**, `created_at DESC`. Sin paginador, como hoy |

**DTO de reseña** (`toReviewDto`): las 18 claves del mock **en su orden**.

- `deleted_at: null` y `my_feedback: null` son constantes (D-6; `feedbacks`
  es un stub).
- `abusive_reports_count` es el `COUNT` de `abusive_reports` con
  `model_type='Review'` sobre esa reseña.
- `product` sale de `toProductDto`.
- `user` se proyecta desde `users` con `{id, name, email,
  email_verified_at, created_at, updated_at, is_active: 1|0, shop_id: null}`.

**DTO de reporte**: `{id, user_id, model_type, model_id, message,
created_at, updated_at, user}`.

- `model_type` se emite como **FQCN** (`'Marvel\\Database\\Models\\Review'`),
  que es lo que el contrato de `/my-reports` publica hoy.
- `user` sale en la misma forma mínima que en la reseña.

## Divergencias declaradas

| # | Dónde | Hoy | Después | Por qué |
|---|---|---|---|---|
| V-1 | `search=rating:N` | Fuse sobre `product_id` (`rating:5` trae ids 5, 503, 504…) | filtra por `rating = N` | D-1. Es lo que pide el shop |
| V-2 | `product` embebido | snapshot Laravel de 41 claves | las 20 claves de `toProductDto` | D-5 |
| V-3 | `user` embebido | timestamps del mock con 6 decimales | timestamps de `users`: `now()` del último `db-up` para los usuarios 1-3, y los del snapshot (3 decimales) para 4-5 | D-3 / divergencia de reloj conocida |
| V-4 | `abusive_reports_count` de las reseñas 1, 21 y 78 | 0 | **1** | `reports.json` los reporta y el mock no lo contaba: el mock es incoherente consigo mismo |
| V-5 | Escrituras de `/reviews` | `reviews[0]` | fila real, autorización por autor | D-1 |
| V-6 | Las 5 rutas de `abusive_reports` | cadenas de texto | JSON real | D-1. No había contrato que preservar |
| V-7 | `GET /my-reports` | las 3 filas para cualquier usuario | solo las del usuario: el cliente ve las 3 y el admin `{data: []}` | D-1 / R-5 |
| V-8 | Id desconocido | 200 vacío | 404 | precedente `tags` |
| V-9 | `GET /users` y `getUsersToNotify` | 3 usuarios | 5 | efecto de D-4. Se declara, no es un defecto |

## Scope

**Incluye:**

- la extensión del helper de identidad para sembrar usuarios;
- `reviews` y `abusive_reports` con su DDL, sus bloques del generador y el
  seed;
- la re-introspección con los modelos `Review` y `AbusiveReport`;
- `ReviewRecord` y `AbusiveReportRecord`;
- `reviews.repository.ts` y `abusive-reports.repository.ts` con sus
  integration tests;
- reescribir `reviews.service.ts`, `reviews/reports.service.ts` y
  `reports/reports.service.ts` sin imports de JSON, con sus specs.

**NO incluye:**

- `feedbacks` (stub sin JSON, fuera del épico), así que no se vota ni se
  recalculan los contadores;
- `abusive_reports/reject`, que el admin llama y no existe (mencionarlo en
  el reporte);
- el array `abusive_reports` embebido que pide el admin con
  `with=abusive_reports.user` (el mock nunca lo emitió);
- `questions` (US-55) y la FK de `order_id` (US-58);
- recalcular `products.ratings`/`total_reviews` desde las reseñas
  (`toProductDto` no los emite);
- cambiar guards;
- tocar frontends.

## Criterios de aceptación

### CA-1 — Identidad sembrada

- Tras `just db-reset`, `users` tiene 5 filas y `permission_user` 8.
- `POST /api/token` con `customer2@demo.com`/`demodemo` devuelve token con
  `permissions: ['customer']`.
- El generador falla con mensaje si se inyecta un usuario del mock cuyo id
  ya pertenece a otro email.

### CA-2 — Seed de reseñas y reportes

`psql` confirma:

- 85 reseñas con el reparto por usuario, rating y tienda de las Reglas;
- 3 reportes, todos con `model_type = 'Review'`;
- 0 huérfanas por cada FK;
- `count(*)` de reseñas cuyo `shop_id` ≠ `products.shop_id` igual a 0.

### CA-3 — Equivalencia de forma

`GET /reviews?…product_id=1&limit=5&page=1&search=`, comparado con
`base-reviews-p1.json`, es deep-equal salvo `product` (V-2) y los
timestamps de `user` (V-3). Mismas 3 reseñas, mismo orden, mismo paginador
(`per_page:"5"`).

Lo mismo para `GET /reviews/85` y para `GET /my-reports` con el token del
cliente: las 3 filas con `model_type` FQCN y timestamps de la fila
idénticos.

### CA-4 — Filtros reales

- `product_id=1&search=rating:5` devuelve solo las reseñas del producto 1
  con rating 5 (contrastar con `psql`).
- `search=shop_id:6` da `total: 49`.
- Sin parámetros da `total: 85`, primera página de 30 empezando por el id
  85.

### CA-5 — Escrituras de reseñas

| Llamada | Resultado |
|---|---|
| `POST` del cliente sobre un producto sin reseña suya | 201; el `GET` siguiente la incluye |
| repetirlo | 409 |
| con `shop_id` incorrecto | 400 |
| `PUT` de esa reseña con el token de `customer2` | 403 |
| `PUT` del autor | 200 y `updated_at` avanza |
| `DELETE` del admin | 200; el `GET` siguiente da 404 |

### CA-6 — Reportes de abuso

| Llamada | Resultado |
|---|---|
| `POST /abusive_reports {model_id: 85, model_type: 'Review', message}` del cliente | 201 |
| repetirlo | 409 |
| `model_type: 'Question'` | 400 |
| `GET /reviews/85` posterior | `abusive_reports_count: 1` |
| `GET /abusive_reports` con token de cliente | 403 |
| `GET /abusive_reports` con admin | 200 con 4 filas |
| `GET /my-reports` del admin | `{data: []}` |

### CA-7 — Sin import huérfano y sin regresión

`grep -rn "reviews.json\|reports.json" apps/api/rest/src --include=*.ts`
sale vacío.

`just db-check`, `npx jest`, `just build-api` y `just verify` en verde, con
recuentos. Cualquier assert que cambie por los 2 usuarios nuevos se
diagnostica y se justifica en el reporte (R-3).

## Escenarios Gherkin

```gherkin
Feature: Resenas y reportes de abuso desde Postgres
  Scenario: CA-1 — los autores del mock existen
    Given reviews.json con 65 resenas de los usuarios 4 y 5
    When se regenera el seed y se recrea la base
    Then users tiene 5 filas y customer2@demo.com puede iniciar sesion

  Scenario: CA-4 — el filtro de rating filtra por rating
    Given 47 resenas con rating 5
    When GET /api/reviews?search=rating:5&limit=100
    Then total es 47 y ninguna resena tiene rating distinto de 5

  Scenario: CA-5 — solo el autor edita su resena
    Given una resena creada por customer@demo.com
    When customer2@demo.com hace PUT sobre ella
    Then la respuesta es 403

  Scenario: CA-6 — un reporte cuenta en la resena
    Given la resena 85 sin reportes
    When el cliente la reporta
    Then GET /api/reviews/85 devuelve abusive_reports_count 1
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---|---|
| `db/schema.sql` | `reviews`, `abusive_reports`, índice único de expresión y sus banners |
| `db/generate-seed.mjs` | helper que siembra usuarios; bloques de usuarios sembrados, `reviews` y `abusive_reports`; validaciones; `setval`; conteos |
| `db/seed.sql` | regenerado |
| `db/README.md` | identidad sembrada (D-4), modelo de reseñas y reportes |
| `packages/db/prisma/schema.prisma` | `Review`, `AbusiveReport` + inversas en `User`/`Shop`/`Product`; CHECK e índice de expresión en la cabecera |
| `packages/db/src/records.ts` | `ReviewRecord`, `AbusiveReportRecord` + mappers |
| `packages/db/src/repositories/reviews.repository.ts` + `.integration.test.ts` | nuevos |
| `packages/db/src/repositories/abusive-reports.repository.ts` + `.integration.test.ts` | nuevos |
| `packages/db/index.ts`, `packages/db/README.md` | barrel y documentación |
| `apps/api/rest/src/reviews/reviews.service.ts` + `.spec.ts` | reescrito y nuevo |
| `apps/api/rest/src/reviews/reports.service.ts` + `.spec.ts` | reescrito y nuevo |
| `apps/api/rest/src/reviews/*.controller.ts` | `@CurrentUser()` en las escrituras |
| `apps/api/rest/src/reports/reports.service.ts` + `.spec.ts`, `reports.controller.ts` | filtrado por usuario |

## Definición de Done

Sigue el **Protocolo de ejecución** del README del épico. Lo específico:

- [x] Precondición pegada: `product-dto.mapper.ts` existe (US-53) y
  `resolverUsuarioPorEmail` existe (US-51).
- [x] Línea base: los 7 cuerpos.
- [x] `just db-seed-generate` con los conteos, más el fallo pegado de CA-1
  (id ocupado por otro email), restaurado después.
- [x] `just db-reset` y `psql` con los conteos de las Reglas y las
  consultas de CA-2.
- [x] `prisma validate` y `migrate diff --exit-code` en `EXIT=0` (el índice
  de expresión no debe acusar drift; si lo hace, documentar cómo lo resolvió
  `users_email_lower_idx`). Después, `just db-build`.
- [x] CA-3: `node -e` con deep-equal y la lista de claves excluidas.
- [x] CA-4 a CA-6: `curl` con Bearer y status exacto.
- [x] CA-7: `grep` vacío y los 4 comandos en verde con recuentos.
- [x] Status actualizado aquí y en el épico.

## Evidencia (2026-10-22)

**Dos commits (R-1).** Sin contar `seed.sql`, la US mide unas 2 050 líneas,
así que va partida. El corte 1 (`d12e4fa`, unas 1 130) trae el DDL, el seed
y la capa de datos. El corte 2 (unas 925) trae los servicios, controladores
y specs de Nest.

**Precondición:** `apps/api/rest/src/products/product-dto.mapper.ts` existe
(US-53) y `resolverUsuarioPorEmail` está en `db/generate-seed.mjs:284`
(US-51).

**Línea base**, con la API recién arrancada sobre `main` (`0cd1e64`):

```
    37 base-abusive.txt               ("this route returns all abusive report")
  1200 base-my-reports-cust.json      (3 filas, model_type FQCN)
  2620 base-review-85.json            (18 claves)
 33192 base-reviews-admin-shop6.json  (total 13: Fuse busca "6" en product_id)
 70100 base-reviews-all.json          (total 85, per_page 30)
  8934 base-reviews-p1.json           (40, 21, 1; per_page "5")
   316 base-reviews-p1-r5.json        (total 0: rating:5 busca "5" en product_id)
```

**Seed.** `just db-seed-generate` termina con `… · 5 usuarios · … · 10
wishlists · 85 reviews · 3 abusive_reports`. Si a `customer2` se le inyecta
el id 3 (y el JSON se restaura después, sin diff):

```
El mock viola 1 restriccion(es) del esquema:
  - reviews 85.user: 'customer2@demo.com' trae el id 3, que ya es de 'admin@demo.com'
EXIT=1
```

**CA-1 y CA-2** (`just db-reset` + `psql`):

| Medida | Valor |
|---|---|
| `users` / `permission_user` | 5 / 8 |
| Sembrados | 4 `customer2@demo.com` y 5 `customer3@demo.com`, con `customer` y el `created_at` del snapshot |
| `reviews` por usuario | 2 → 20, 4 → 38, 5 → 27 |
| `reviews` por rating | 12 / 4 / 12 / 10 / 47 |
| `reviews` de la tienda 6 | 49 |
| `abusive_reports` | 3, todos `model_type = 'Review'` |
| Huérfanas (user, shop, product, report.user, report.model_id) | 0 / 0 / 0 / 0 / 0 |
| `shop_id` ≠ `products.shop_id` | 0 |
| `photos` de la reseña 1 | `[{"id":1689,"original":…,"thumbnail":…}]` (orden del mock) |
| Conteos previos | products 1200 · shops 12 · coupons 10 · wishlists 10 · store_notices 3 · faqs 19 |

`POST /api/token` con `customer2@demo.com`/`demodemo` devuelve un token con
`permissions: ["customer"]`.

**Prisma.** `validate` correcto y `migrate diff --exit-code` con `EXIT=0`
(`No difference detected`). El índice de expresión no acusa drift, igual que
`users_email_lower_idx`. `just db-build` limpio.

**CA-3** (`node`, deep-equal con orden de claves):

```
new-reviews-p1.json: 3 filas (40,21,1); excluido: product (V-2), user.created_at/updated_at (V-3)
  paginador idéntico, per_page = "5"
  fila 21: abusive_reports_count 0 vs 1   ← V-4
  fila 1:  abusive_reports_count 0 vs 1   ← V-4
new-review-85.json: deep-equal; excluido: product (V-2), user.created_at/updated_at (V-3)
new-my-reports-cust.json: 3 filas (3,2,1), deep-equal; excluido: user.created_at/updated_at (V-3)
```

Las dos únicas diferencias fuera de las exclusiones son V-4: las reseñas 21 y
1 tienen un reporte en `reports.json` y el mock no lo contaba. Los
timestamps de cada reseña y de cada reporte son idénticos.

**CA-4:**

| Query | Resultado |
|---|---|
| `product_id=1&search=rating:5` | `total 2`: 40 y 21, igual que en `psql` |
| `search=shop_id:6` | `total 49`, todas de la tienda 6 (antes 13) |
| sin parámetros | `total 85`, `count 30`, empieza en el 85 |
| `search=rating:5&limit=100` | `total 47`, todas con rating 5 |
| `search=rating` (token sin `:`) | `total 85`: se ignora |
| `GET /reviews/999999` | 404 |

**CA-5** (el cliente sobre el producto 21, que no tenía reseña suya):

| Llamada | Status | Resultado |
|---|---|---|
| `POST` | 201 | id 98, `user_id 2`, `shop_id 4`, 18 claves; el `GET ?product_id=21` la incluye |
| repetirlo | 409 | |
| `shop_id` 999 / `rating` 7 / producto 999999 / sin token | 400 / 400 / 404 / 401 | |
| `PUT` con el token de `customer2` | 403 | |
| `PUT` del autor | 200 | `psql`: rating 4 → 2; `updated_at` 02:35:16.161 → 02:35:23.307 |
| `DELETE` del admin → `GET` | 200 → 404 | |

**CA-6:**

| Llamada | Status | Resultado |
|---|---|---|
| `POST /abusive_reports {85, 'Review'}` del cliente | 201 | `model_type` FQCN, `user_id 2` |
| repetirlo / `'Question'` / reseña 999999 | 409 / 400 / 404 | |
| `GET /reviews/85` | 200 | `abusive_reports_count: 1` |
| `GET /abusive_reports` cliente / admin | 403 / 200 | admin: 4 filas (`12,3,2,1`) |
| `GET` y `PUT /abusive_reports/12` (admin) | 200 / 200 | mensaje editado |
| `GET /my-reports` admin / cliente | 200 / 200 | `{data: []}` / 4 filas |
| `DELETE /abusive_reports/12` → `GET` | 200 → 404 | `/reviews/85` vuelve a `abusive_reports_count: 0` |
| `POST /abusive_reports/reject` | 404 | la ruta no existe (fuera de alcance) |

Al final hay 85 reseñas, 3 reportes y 0 centinelas.

**CA-7:**

- El `grep` no devuelve nada (`exit=1`).
- `just db-check`: 24 archivos y 337 tests (antes 22/325; +12). Ningún
  assert sobre usuarios cambió con los 2 nuevos: `users.integration.test.ts`
  exige `>= 3`.
- `npx jest`: 24 suites y 431 tests (antes 21/407; +24).
- `just build-api`: `Done in 70.23s`, y `tsc --noEmit` en 0.
- `just verify`: API `5503B`, Shop `cards:30`, Admin `cards:1`.
  `/products/apples` (con reseñas) responde 200.

**Decisiones que no estaban escritas en la US:**

- **Borrar una reseña borra sus reportes** en el mismo `$transaction`. La
  relación es polimórfica, así que la base no lo hace sola, y un reporte
  sobre una reseña que no existe no tiene a dónde apuntar.
- **`assertReportableExists` vive en el repositorio**, no en el servicio. La
  nota pedía aislarla para que US-55 la cambie en una línea, y así queda. El
  servicio solo normaliza el FQCN y valida el `model_id`.
- **Los índices de `user_id`** quedan cubiertos por la izquierda del único
  de expresión (`reviews`) y del `UNIQUE (user_id, model_type, model_id)`
  (`abusive_reports`). No se crearon aparte.

**Fuera de alcance, para el reporte:**

- `POST abusive_reports/reject` (el "decline" del admin) sigue dando 404.
- Los 409 dicen "…con el slug `user_id, product_id, order_id`": es el texto
  común de `SlugConflictError`, el mismo caso que en US-52.

## Notas para el agente ejecutor

- **Orden en el generador**: usuarios del mock → `permission_user` de los
  nuevos → `reviews` → `abusive_reports`. Como `reviews` referencia
  usuarios y productos, va después de ambos.
- **El `search` llega como string `rating:5;shop_id:6`**. Reutilizar
  `parseSearch` de `apps/api/rest/src/common/search/` si cubre el formato,
  como `tags.service.ts`. Un token sin `:` se ignora (hoy da 500).
- `abusive_reports_count` se calcula en la consulta con `_count` o con una
  subconsulta agrupada, nunca con una consulta por reseña (N+1).
- `is_active` del `user` embebido sale como **número** (`1`/`0`). El
  `toUserDto` de `users/user-dto.mapper.ts` emite otra forma: no
  reutilizarlo aquí.
- US-55 añadirá `'Question'` a la validación de `POST /abusive_reports`.
  Dejar esa rama aislada en el servicio (una función
  `assertReportableExists(modelType, id)`) para que el cambio de US-55 sea
  de una línea.
- Tras la evidencia de escritura, borrar las filas centinela (las creadas
  en los `curl`) o recrear con `just db-reset`. Las suites de integración
  cuentan sobre el seed.
