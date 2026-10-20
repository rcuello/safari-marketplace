# US-55 — `questions` y `my-questions` desde Postgres

> Las 10 rutas de preguntas sobre productos dejan de servir `questions.json`
> y pasan a una tabla `questions` sembrada con sus 68 registros. La búsqueda
> por texto deja de devolver siempre vacío, el admin puede responder de
> verdad, y `my-questions` deja de mostrar las preguntas de todos.

**Épico:** [Épico 46](./README.md)
**Fecha:** 2026-10-20
**Status:** Listo para ejecución
**Depende de:** US-54 (siembra el usuario 4, autor de 14 preguntas, y crea `abusive_reports`; secuencialidad R-2)
**LOC est.:** ~1500

## Historia

**Como** cliente del shop, **quiero** preguntar sobre un producto y ver solo
mis preguntas en «Mis preguntas». **Como** dueño de tienda, **quiero**
responderlas desde el admin. Todo **para que** la sección de preguntas sea
una conversación real y no 68 filas fijas.

## Contexto (verificado en código, 2026-10-20)

**`apps/api/rest/src/questions/questions.controller.ts`** (`@Controller('questions')`, `:17`):

| Método y ruta | Guard | Hoy (`questions.service.ts`) |
|---|---|---|
| `GET /api/questions` | `@Public` (`:23`) | `page=1`, **`limit=10`** (`:29-30`). Fuse con **`keys: []`** (`:12-16`): **cualquier `search` no vacío da `data: []`** (`:35-41`). Después, filtro exacto `product_id` (`:43-45`). Url `/questions?search=${search}&answer=${answer}&limit=${limit}` (`:48`). Orden: id DESC (el del archivo) |
| `GET /api/questions/:id` | `@Public` (`:29`) | `find` por id; si no existe, 200 vacío (`:55-57`) |
| `POST /api/questions` | token (`:35`) | `question[0]` (id 68) (`:59-61`) |
| `PUT /api/questions/:id` | token (`:41`) | `question[0]`: **responder no persiste** (`:63-65`) |
| `DELETE /api/questions/:id` | token (`:50`) | `question[0]` |

**`apps/api/rest/src/questions/my-questions.controller.ts`** (`@Controller('my-questions')`, `:16`). Las 5 rutas piden solo token:

| Método y ruta | Hoy (`my-questions.service.ts`) |
|---|---|
| `GET /api/my-questions` (`:22`) | `page=1`, **`limit=8`** (`:23-24`). Fuse sobre `answer`. **No filtra por usuario: devuelve las 68.** Url fija `/my-questions?with=user&orderBy=created_at&sortedBy=desc` (`:39`) |
| `GET /api/my-questions/:id` (`:27`) | `find` por id, de cualquier dueño (`:47-49`) |
| `POST` / `PUT /:id` / `DELETE /:id` (`:32,38,47`) | `myQuestion[0]` |

DTOs:

- `CreateQuestionDto = OmitType(Question, ['id','product','user','created_at','updated_at'])`.
- `GetQuestionDto` acepta `search`, `answer`, `product_id`, `orderBy` y
  `sortedBy`.
- La entidad extiende `CoreEntity`, así que los timestamps de la fila ya
  salen hoy con 3 decimales. El `user` anidado no.

**El mock** (`questions.json`, medido con `node -e`):

- 68 filas, ids 68→1.
- Claves en orden: `id, user_id, shop_id, product_id, question, answer,
  deleted_at, created_at, updated_at, positive_feedbacks_count,
  negative_feedbacks_count, my_feedback, abusive_reports_count, product,
  user`.
- `answer` no está vacío en ninguna de las 68. `created_at` ≠ `updated_at`
  en las 68. Contadores en 0, `my_feedback` y `deleted_at` en `null`.
- `user_id`: **2 → 54, 4 → 14.** El 4 (`customer2@demo.com`) lo siembra
  US-54.
- `shop_id ∈ 1..7`, siempre igual a la tienda del producto. 44 productos
  distintos, todos en el seed.
- **Hay 20 pares (user, product) repetidos**, legítimos: varias preguntas
  sobre el mismo producto. Por eso **no** puede haber UNIQUE(user,
  product).
- El producto 1 tiene 6 preguntas (ids 34, 33, 32, 31, 26 del usuario 4, y
  la 2 del usuario 2). Las tres que contienen «apple» son 34, 31 y 26.
- `product` embebido: snapshot Laravel de 41 claves.
- `user` embebido: 9 claves, `{id, name, email, email_verified_at,
  created_at, updated_at, is_active: 1, shop_id: null, email_verified:
  false}`. Es una más que en las reseñas.

**Consumidores**:

- **Shop**:
  - `framework/rest/client/index.ts:149-156`: `products.questions` envía
    `searchJoin=and`, `product_id`, `limit=5`, `page` y
    `search=question:<texto>`; sin texto, `search=` vacío
    (`components/questions/product-questions.tsx:31-36`).
  - `createQuestion` → `POST /questions` con `{question, product_id,
    shop_id}` (`types/index.ts:559-563`).
  - `myQuestions.all` → `GET /my-questions` con
    `with=user&orderBy=created_at&sortedBy=desc` (`:184-191`), consumido
    por `components/questions/my-questions.tsx:130`. Es infinito sobre
    `current_page`/`last_page`.
  - `components/questions/question-card.tsx:39` reporta abuso con
    `model_type: 'Question'`.
- **Admin**:
  - `data/client/question.ts`: `paginated` envía `with=product;user` y
    `search=type.slug:<x>;shop_id:<n>`.
  - `data/question.ts:28-40` (`useReplyQuestionMutation`) hace `PUT
    /questions/:id` con `{id, answer}`
    (`components/question/question-reply-view.tsx:38-43`).
  - `useDeleteQuestionMutation` → `DELETE /questions/:id`.

**Heredado de US-54**:

- `abusive_reports` admite `model_type = 'Question'` en su CHECK, pero
  `POST /abusive_reports` responde 400 para ese tipo hasta esta US (función
  `assertReportableExists` del servicio).
- El mapper compartido `apps/api/rest/src/products/product-dto.mapper.ts`
  viene de US-53.
- La proyección mínima de `user` (con `is_active` numérico) se escribió en
  US-54. Reutilizarla y añadir `email_verified`.

**Precedente de propiedad**: `products.service.ts:161-180` usa
`findShopOwnerById`, exportado en `packages/db/index.ts`.

## Línea base (D-2 del épico)

```bash
API=http://localhost:9001/api
tok() { curl -s -X POST $API/token -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"demodemo\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).token'; }
CUST=$(tok customer@demo.com)
curl -s "$API/questions?searchJoin=and&product_id=1&limit=5&page=1&search="               > base-q-p1.json
curl -s "$API/questions?searchJoin=and&product_id=1&limit=5&page=1&search=question:apple"  > base-q-p1-apple.json
curl -s "$API/questions?searchJoin=and&with=product;user&search=shop_id:6"                  > base-q-admin-shop6.json
curl -s "$API/questions/68"                                                                 > base-q-68.json
curl -s -H "Authorization: Bearer $CUST" "$API/my-questions?with=user&orderBy=created_at&sortedBy=desc" > base-myq-cust.json
```

`base-q-p1-apple.json` debe mostrar hoy `data: []`: es la evidencia de V-1.

## Tabla nueva

**`questions`**

| Columna | Tipo y restricción |
|---|---|
| `id` | `bigserial PRIMARY KEY` |
| `user_id` | `bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE` + índice |
| `shop_id` | `bigint NOT NULL REFERENCES shops(id) ON DELETE CASCADE` + índice |
| `product_id` | `bigint NOT NULL REFERENCES products(id) ON DELETE CASCADE` + índice |
| `question` | `text NOT NULL CHECK (length(question) > 0)` |
| `answer` | `text NULL`. Una pregunta nueva nace sin respuesta |
| `positive_feedbacks_count` / `negative_feedbacks_count` | `integer NOT NULL DEFAULT 0 CHECK (>= 0)` |
| `created_at` / `updated_at` | `timestamptz NOT NULL DEFAULT now()` |

`CASCADE` por el mismo criterio que `reviews` (US-54): una pregunta es
contenido de su autor sobre un producto de una tienda. **Sin UNIQUE(user,
product)**: el mock tiene 20 pares repetidos legítimos. Para la búsqueda,
índice trigram `questions_question_trgm_idx ON questions USING gin
(lower(question) gin_trgm_ops)`, siguiendo el precedente de
`products_nombre_trgm_idx`. `pg_trgm` ya lo activa `just db-migrate`.

## Reglas del seed

- **Precondición**: `users` contiene el id 4 con `customer2@demo.com`
  (sembrado por US-54). El helper `resolverUsuarioPorEmail` lo resuelve y
  **no** crea usuarios nuevos: los únicos emails de `questions.json` son
  `customer@demo.com` y `customer2@demo.com`. Si el helper tuviera que
  sembrar aquí, es señal de que US-54 no está aplicada: parar.
- Bloque `questions` después de `products` y `users`:
  - las 68 filas con ids, `user_id`, `shop_id`, `product_id`, `question`,
    `answer`, contadores y `created_at`/`updated_at` del mock (D-3);
  - validaciones: el producto existe; `shop_id` == tienda del producto;
    `question` no vacía.
- `setval('questions_id_seq', …)`.
- **Conteos**: `questions` 68 (usuario 2 → 54, usuario 4 → 14; producto 1
  → 6). `users` sigue en 5 y `permission_user` en 8.

## Rutas

| Método y ruta | Guard (no cambia, R-6) | Después |
|---|---|---|
| `GET /questions` | Public | Filtros reales combinados con AND: `product_id` (query); `question:<texto>` desde `search` (ILIKE `%texto%`, sin distinguir mayúsculas); `shop_id:N`; `type.slug:<x>` (slug del type del producto). Claves desconocidas se ignoran. Orden **id DESC**, defaults `page=1`, `limit=10`, mismo `paginate()` y misma url (incluido `answer=${answer}`) |
| `GET /questions/:id` | Public | DTO o 404 |
| `POST /questions` | token | `{question, product_id, shop_id}`. `user_id = user.sub`, `answer = null`. 404 si el producto no existe; 400 si `shop_id` ≠ tienda del producto o si la pregunta está vacía. DTO (201) |
| `PUT /questions/:id` | token | **Responder.** Solo `super_admin` o el dueño de la tienda de la pregunta (`findShopOwnerById`); si no, 403. Persiste `answer` (y `question` si llega, tipo `ReplyQuestion` del admin) con `updatedAt: now()` |
| `DELETE /questions/:id` | token | El autor, el dueño de la tienda o `super_admin`. Devuelve el DTO borrado |
| `GET /my-questions` | token | Solo las del **usuario actual**, `created_at DESC, id DESC`. Defaults `page=1`, `limit=8`, misma url fija. `search`/`answer` se ignoran |
| `GET /my-questions/:id` | token | La pregunta si es del usuario actual; si no existe o es ajena, 404 |
| `POST /my-questions` | token | Igual que `POST /questions` |
| `PUT /my-questions/:id` | token | El autor edita el texto de su `question` (no el `answer`). Ajena → 404 |
| `DELETE /my-questions/:id` | token | El autor borra la suya. Ajena → 404 |

**DTO** (`toQuestionDto`): las 15 claves del mock **en su orden**.

- `deleted_at: null` y `my_feedback: null` son constantes.
- `abusive_reports_count` es el `COUNT` de `abusive_reports` con
  `model_type = 'Question'`.
- `product` sale de `toProductDto`.
- `user` sale con la proyección mínima de US-54 más `email_verified`
  (`email_verified_at !== null`), en la posición final.

**Reportes de abuso**: `assertReportableExists` (US-54) acepta
`'Question'` validando contra `questions`.

## Divergencias declaradas

| # | Dónde | Hoy | Después | Por qué |
|---|---|---|---|---|
| V-1 | `search=question:<texto>` | siempre `data: []` (Fuse sin claves) | ILIKE sobre el texto | D-1. El buscador del shop funciona |
| V-2 | `GET /my-questions` | las 68 de todos | solo las del usuario: el cliente ve 54 y el admin 0 | D-1 / **R-5, corrección de privacidad** |
| V-3 | `product` embebido | snapshot de 41 claves | las 20 claves de `toProductDto` | D-5 |
| V-4 | `user` embebido | timestamps del mock con 6 decimales | timestamps de `users` | D-3 |
| V-5 | `PUT /questions/:id` | `question[0]`, no persiste | persiste la respuesta, con autorización por tienda | D-1 |
| V-6 | `POST`/`DELETE` de ambos controladores | fila 68 | fila real | D-1 |
| V-7 | Id desconocido o ajeno en `my-questions/:id` | 200 con cualquier pregunta | 404 | D-1 |
| V-8 | `POST /abusive_reports` con `'Question'` | 400 (US-54) | 201 si la pregunta existe | cierra el hueco que dejó US-54 |

## Scope

**Incluye:**

- la tabla `questions` con su índice trigram, el bloque del generador y el
  seed;
- la re-introspección con el modelo `Question` (inversas en `User`, `Shop`
  y `Product`);
- `QuestionRecord` y su mapper;
- `questions.repository.ts` (`listQuestions`, `listUserQuestions`,
  `findQuestionById`, `createQuestion`, `answerQuestion`,
  `updateQuestionText`, `deleteQuestion`) con su integration test;
- reescribir los dos servicios sin el import del JSON, con sus specs;
- habilitar `'Question'` en `POST /abusive_reports`.

**NO incluye:**

- `feedbacks` (stub), así que no se vota;
- que el `staff` de una tienda responda (no hay función de pertenencia
  `shop_staff` exportada; mencionar en el reporte);
- filtrar por respondidas o no respondidas (el parámetro `answer` se sigue
  ignorando);
- `reviews`;
- cambiar guards o tocar frontends.

## Criterios de aceptación

### CA-1 — Precondición y seed

La precondición del usuario 4 está pegada. Tras `just db-reset`:

- `questions` tiene 68 filas con el reparto de las Reglas;
- hay 0 huérfanas por FK;
- `count(*)` de preguntas con `shop_id` ≠ `products.shop_id` es 0;
- `users` sigue en 5.

### CA-2 — Equivalencia de forma

`GET /questions?…product_id=1&limit=5&page=1&search=`, comparado con
`base-q-p1.json`, es deep-equal salvo `product` (V-3) y los timestamps de
`user` (V-4). Mismos 5 ids (34, 33, 32, 31, 26), mismo paginador
(`total: 6`, `per_page:"5"`) y misma url.

Lo mismo para `GET /questions/68`.

### CA-3 — Búsqueda real

- `…product_id=1&search=question:apple` devuelve 34, 31 y 26
  (`total: 3`). La línea base devolvía `[]`.
- `search=shop_id:6` da `total: 39`.

### CA-4 — Responder y moderar

| Llamada | Resultado |
|---|---|
| `PUT /questions/68 {answer}` con el admin | 200; el `GET` siguiente devuelve el nuevo `answer` y `updated_at` posterior |
| lo mismo con `store_owner@demo.com` (dueño de las 12 tiendas) | 200 |
| lo mismo con el cliente | 403 |
| `POST /questions` del cliente | 201 con `answer: null` |
| ese `POST` con un `shop_id` ajeno al producto | 400 |
| `DELETE` de su pregunta por el autor | 200 |

### CA-5 — `my-questions` por usuario

- Con el cliente: `total: 54`, primera página de 8.
- Con `customer2@demo.com`: `total: 14`.
- Con el admin: `total: 0`.
- `GET /my-questions/<id de customer2>` con el cliente da 404.

### CA-6 — Reportes de preguntas

- `POST /abusive_reports {model_id: 68, model_type: 'Question', message}`
  del cliente da 201.
- `GET /questions/68` devuelve `abusive_reports_count: 1`.
- Con `model_id` inexistente da 404.

### CA-7 — Sin import huérfano y sin regresión

`grep -rn "questions.json" apps/api/rest/src --include=*.ts` sale vacío.

`just db-check`, `npx jest`, `just build-api` y `just verify` en verde, con
recuentos.

## Escenarios Gherkin

```gherkin
Feature: Preguntas sobre productos desde Postgres
  Scenario: CA-3 — buscar encuentra preguntas
    Given el producto 1 con 6 preguntas, 3 de ellas sobre "apple"
    When GET /api/questions?product_id=1&search=question:apple
    Then la respuesta trae los ids 34, 31 y 26

  Scenario: CA-4 — el dueno de la tienda responde
    Given la pregunta 68 de una tienda de store_owner@demo.com
    When el dueno hace PUT /api/questions/68 con un answer nuevo
    Then el GET siguiente devuelve ese answer

  Scenario: CA-5 — mis preguntas son solo mias
    Given 54 preguntas de customer@demo.com y 14 de customer2@demo.com
    When customer2 pide GET /api/my-questions
    Then total es 14
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---|---|
| `db/schema.sql` | tabla `questions` + índice trigram + banner |
| `db/generate-seed.mjs` | bloque `questions`, validaciones, `setval` y conteos |
| `db/seed.sql` | regenerado |
| `db/README.md` | modelo de preguntas |
| `packages/db/prisma/schema.prisma` | modelo `Question` + inversas; índice trigram y CHECK en la cabecera |
| `packages/db/src/records.ts` | `QuestionRecord` + mapper |
| `packages/db/src/repositories/questions.repository.ts` + `.integration.test.ts` | nuevos |
| `packages/db/src/repositories/abusive-reports.repository.ts` | validación de existencia para `'Question'` |
| `packages/db/index.ts`, `packages/db/README.md` | barrel y documentación |
| `apps/api/rest/src/questions/questions.service.ts` + `.spec.ts` | reescrito y nuevo |
| `apps/api/rest/src/questions/my-questions.service.ts` + `.spec.ts` | reescrito y nuevo |
| `apps/api/rest/src/questions/*.controller.ts` | `@CurrentUser()` donde aplique |
| `apps/api/rest/src/reviews/reports.service.ts` + su spec | `assertReportableExists` acepta `'Question'` |

## Definición de Done

Sigue el **Protocolo de ejecución** del README del épico. Lo específico:

- [ ] Precondición pegada: `psql -c "SELECT id, email FROM users WHERE id = 4"`
  devuelve `customer2@demo.com`, y existe la tabla `abusive_reports`.
- [ ] Línea base: los 5 cuerpos, con `base-q-p1-apple.json` mostrando
  `data: []`.
- [ ] `just db-reset` y `psql` con los conteos de las Reglas y las
  consultas de CA-1.
- [ ] `prisma validate` y `migrate diff --exit-code` en `EXIT=0`, y
  `just db-build`.
- [ ] CA-2: `node -e` con deep-equal y las claves excluidas.
- [ ] CA-3 a CA-6: `curl` con Bearer (admin, `store_owner`, cliente,
  `customer2`) y status exacto.
- [ ] CA-7: `grep` vacío y los 4 comandos en verde con recuentos.
- [ ] Status actualizado aquí y en el épico.

## Notas para el agente ejecutor

- **Dos defaults distintos a propósito**: `limit=10` en `/questions` y
  `limit=8` en `/my-questions`. No unificarlos: cambiaría el paginador del
  contrato.
- La url de `/questions` interpola `answer`, que casi siempre es
  `undefined`, así que sale el literal `answer=undefined`. Se preserva (D-1,
  rarezas del paginador).
- `email_verified` solo existe en el `user` de las preguntas, no en el de
  las reseñas. Añadirlo como parámetro de la proyección compartida, no como
  una segunda copia.
- El índice trigram necesita `lower(question)` en la consulta para usarse.
  Escribir el `where` del repositorio con `contains` + `mode: 'insensitive'`
  y comprobar con `EXPLAIN` que Prisma genera `ILIKE`. Si no aprovecha el
  índice, no bloquea: son 68 filas. Anotarlo en el reporte.
- Borrar las filas centinela tras la evidencia de escritura, o
  `just db-reset`.
