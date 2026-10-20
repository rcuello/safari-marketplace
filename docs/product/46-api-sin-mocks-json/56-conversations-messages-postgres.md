# US-56 — `conversations` y `messages` desde Postgres

> Las 5 rutas de la mensajería cliente↔tienda del admin dejan de servir
> `conversations.json` y `messages.json`. Pasan a dos tablas sembradas con
> esos registros. `latest_message` y `unseen` se calculan desde los mensajes
> reales, en vez de copiar los literales del mock, que son incoherentes
> entre sí.

**Épico:** [Épico 46](./README.md)
**Fecha:** 2026-10-20
**Status:** Listo para ejecución
**Depende de:** US-55. No hay dependencia de datos con ella. El orden lo
impone R-2 del épico: archivos compartidos y ejecución secuencial.
**LOC est.:** ~1500

## Historia

**Como** administrador o dueño de tienda que conversa con clientes desde el
admin, **quiero** que las conversaciones y sus mensajes vivan en Postgres,
**para** que un mensaje enviado se guarde y aparezca al recargar, en vez de
devolver siempre el mensaje 5 del JSON.

## Contexto — verificado en código (2026-10-20)

**Rutas** (prefijo global `api`, `main.ts:8`). Ninguna lleva `@Public` ni
`@Permissions`, así que basta un token válido (guards globales en
`app.module.ts:110-111`).

| Ruta | Archivo | Qué hace hoy |
|---|---|---|
| `POST /api/conversations` | `conversations/conversations.controller.ts:13-16` | `conversations[0]` (conversación `"1"`), ignora el body (`conversations.service.ts:51-53`). El DTO es `PickType(Conversation, ['shop_id'])`; el admin manda además `via` (`apps/admin/rest/src/data/client/conversations.ts:20-25`) y pasa porque `ValidationPipe` no tiene `whitelist`. |
| `GET /api/conversations` | `:18-23` | Ver detalle abajo. |
| `GET /api/conversations/:param` | `:25-28` (método mal nombrado `getStoreNotice`) | Busca por **`Number(p.latest_message.conversation_id) === Number(param)`** (`service:91-95`), no por `id`. |
| `POST /api/messages/conversations/:id` | `messages/messages.controller.ts:106-109` | **Ignora `:id`** y devuelve `messages[0]` (mensaje 5) (`messages.service.ts:129-131`). DTO `PickType(Message, ['body'])`. |
| `GET /api/messages/conversations/:param` | `:111-114` | **Ignora `:param`** y devuelve `{ data: <los 5 mensajes> }` **sin campos de paginador** (`service:133-138`). |

`GET /api/conversations` hoy (`conversations.service.ts:55-89`):

- `page` vale 1 por defecto; **`limit` no tiene default**, así que sin
  `?limit` el paginador emite `per_page` `undefined`, `last_page` `NaN`
  (serializado como `null`) y la url `/conversations?limit=undefined`.
- `search` se parte en `;` y `:` y alimenta un Fuse `$and` indexado solo en
  `shop.name` (`:41-45`). El admin manda el texto **sin** `clave:`
  (`components/message/user-list.tsx:33-34`), lo que deja `value =
  undefined`.
- `data` **nunca se recorta**, y `paginate` recibe el total sin filtrar
  (`:81-87`).
- La variable `test` es código muerto (`:60`).

**Mocks** (`apps/api/rest/src/db/pickbazar/`, medido con `node -e`):

- **`conversations.json`: 2 filas, `id` `"1"` y `"6"`, sabor GraphQL.**
  - `id`, `user_id` y `shop_id` son **strings**. `unseen` es el número
    `0`.
  - Claves en orden: `user_id, id, shop_id, unseen, created_at,
    updated_at, shop, user, latest_message, __typename`.
  - `user`: `{id:"6", name:"Admin", email:"admin@demo.com", profile:null,
    address:[], wallet:null, is_active:true, __typename:"User"}`.
  - `latest_message`: `{body, conversation_id, created_at, updated_at,
    user_id, id, __typename:"Message"}`, todo string.
  - `shop` trae claves **distintas por fila**:
    - conv 1 (shop 7): `id, name, slug, owner_id, owner, staffs,
      description, logo, cover_image, orders_count, products_count,
      is_active, balance, address, created_at, __typename`;
    - conv 6 (shop 2): `id, owner_id, name, slug, description, cover_image,
      logo, is_active, address, settings, created_at, updated_at,
      orders_count, products_count, owner`.
  - Fechas mezcladas. Conv 1: `created_at` `2021-03-08T10:26:13.000000Z`,
    `updated_at` `2023-03-11T03:17:23.000Z`. Conv 6: `"2023-03-21 15:00:08"`
    y `"2023-03-30 02:59:20"`, sin `T` ni zona.
- **`messages.json`: 5 filas, ids 5→1** (orden descendente).
  - Aquí los ids son **números**: `id, conversation_id: 1` (los 5),
    `user_id` (6 o 1), `body`, `created_at`, `updated_at`, `conversation`.
  - El `conversation` embebido es el mismo en los 5. Sus claves: `id,
    user_id, shop_id, created_at, updated_at, latest_message, unseen, shop,
    user`.
  - Dice `shop_id: 6`, mientras `conversations.json` dice `"7"` para la
    conversación 1.
  - Su `user` es `{id:6, name:"admin", email:"admin@demo.com",
    email_verified_at:null, created_at, updated_at, is_active:1,
    shop_id:null, profile:null}`.
- **Incoherencias del mock** (por qué se calcula en vez de copiar):
  - el `latest_message` de conv 1 dice `{id:"2", body:"New test"}`, pero el
    mensaje 2 es `"hello"` y `"New test"` es el 5;
  - el `latest_message` de conv 6 es `id:"38"`, **un mensaje que no
    existe**: conv 6 no tiene mensajes;
  - `shop_id` es 6 o 7 según el archivo.
- **Identidad.** El usuario 6 **no existe en el seed**. Su email,
  `admin@demo.com`, es el usuario 3 (`db/seed.sql:61-64`, nombre `"Jhon
  Doe"`). El usuario 1 (`store_owner@demo.com`) existe. Las tiendas 7 y 2
  existen.

**Consumidores** (solo el admin; el shop no tiene mensajería):

- `data/client/conversations.ts`: `allConversation`, `getConversion({id})`,
  `getMessage({slug, ...params})`, `messageCreate`, y `messageSeen`, que
  llama a `/messages/seen/:id`.
- `data/conversations.tsx`: `useConversationsQuery` y `useMessagesQuery`
  son **`useInfiniteQuery`** con `getNextPageParam: ({ current_page,
  last_page }) => …` (`:44-45` y `:115-116`). O sea, **el admin espera
  paginador también en mensajes**. Hoy no lo recibe y la paginación
  infinita se queda en la primera página.
- Llamadas reales:
  - `layouts/topbar/message-bar.tsx:37-41`: `{limit:5, sortedBy:'desc',
    orderBy:'updated_at'}`;
  - `message/user-list.tsx:32-38`: `{search, limit:LIMIT,
    sortedBy:'desc', orderBy:'updated_at'}`;
  - `message/user-message-index.tsx:45-48`: `{slug:<id conversación>,
    limit:LIMIT}`.
- Los tipos del admin (`types/index.ts:1147-1170`) declaran `id`,
  `user_id`, `conversation_id` y `latest_message.*` como **`string`**, y
  `shop_id` como `number`.
- **Nadie lee `__typename`.** `grep` en `apps/admin/rest/src`: las únicas
  apariciones lo **quitan** (`omit(…, '__typename')`) en direcciones y
  formularios, nunca en mensajería.
- `unseen` se consume como booleano (`Boolean(item?.unseen)`,
  `message-bar.tsx:50,152`; `views/list-view.tsx:43-48`).
- `latest_message.body` y `created_at` se pintan en la barra superior
  (`message-bar.tsx:180-204`).
- **`POST /messages/seen/:id` no existe en la API** (`api-endpoints.ts:64`):
  hoy da 404.

## Línea base (paso 2 del protocolo; API recién arrancada, R-4)

```bash
# Token de admin (super_admin) y de dueño de tienda
TOKEN_ADMIN=$(curl -s -X POST http://localhost:9001/api/token -H 'Content-Type: application/json' \
  -d '{"email":"admin@demo.com","password":"demodemo"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
TOKEN_OWNER=$(curl -s -X POST http://localhost:9001/api/token -H 'Content-Type: application/json' \
  -d '{"email":"store_owner@demo.com","password":"demodemo"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
B=$SCRATCH/us56/antes; mkdir -p $B
curl -s -H "Authorization: Bearer $TOKEN_ADMIN" "http://localhost:9001/api/conversations?limit=5&sortedBy=desc&orderBy=updated_at" > $B/conv-topbar.json
curl -s -H "Authorization: Bearer $TOKEN_ADMIN" "http://localhost:9001/api/conversations" > $B/conv-sin-query.json
curl -s -H "Authorization: Bearer $TOKEN_ADMIN" "http://localhost:9001/api/conversations/1" > $B/conv-1.json
curl -s -H "Authorization: Bearer $TOKEN_ADMIN" "http://localhost:9001/api/conversations/6" > $B/conv-6.json
curl -s -H "Authorization: Bearer $TOKEN_ADMIN" "http://localhost:9001/api/messages/conversations/1?limit=10" > $B/msg-1.json
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "Authorization: Bearer $TOKEN_ADMIN" http://localhost:9001/api/messages/seen/1   # 404 hoy
```

`/api/token` responde `{ token, permissions, role }`
(`auth/auth.service.ts:114`). `$SCRATCH` es el scratchpad del agente.

## Tablas nuevas (paso 3)

**`conversations`**:

- `id bigserial PRIMARY KEY`.
- `user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE`. Si se
  borra el usuario, sus conversaciones no tienen sentido.
- `shop_id bigint NOT NULL REFERENCES shops(id) ON DELETE CASCADE`. Hoy no
  hay `deleteShop` en `packages/db`, así que no afecta a nada vivo.
- `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz
  NOT NULL DEFAULT now()`.
- `UNIQUE (user_id, shop_id)`: una conversación por par, que es lo que hace
  Pickbazar. El `POST` la reutiliza si existe.
- Índice en `shop_id`. `user_id` ya está cubierto por el unique.

**`messages`**:

- `id bigserial PRIMARY KEY`.
- `conversation_id bigint NOT NULL REFERENCES conversations(id) ON DELETE
  CASCADE`.
- `user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE`.
- `body text NOT NULL CHECK (length(btrim(body)) > 0)`.
- `created_at`, `updated_at` como arriba.
- Índice `(conversation_id, created_at DESC, id DESC)`: sirve para
  `latest_message` y para el listado.

Ninguna tabla lleva trigger (D-7). **No** se añade estado de lectura
(`last_seen_at`): llega con `messages/seen`, que no entra (ver Scope).

## Reglas del seed (paso 4)

- Bloque emitido **después** de `users` y `shops`.
- **Usuarios por email** (D-4), con el helper `resolverUsuarioPorEmail` que
  dejó US-51 en `db/generate-seed.mjs`. Hay que verificar que existe; si no
  existe, es un bloqueo y hay que preguntar:
  - `conversations[].user.email` = `admin@demo.com` → 3;
  - `messages[].user_id`: el 6 se resuelve por el `email` de
    `conversation.user` → 3, y el 1 se valida contra el seed → 1.

  Ningún usuario nuevo se siembra en esta US.
- **`conversations`: 2 filas.**
  - Ids preservados (`"1"` → 1, `"6"` → 6, convertidos a número).
  - `shop_id` desde el `shop_id` de `conversations.json` (7 y 2), no desde
    el embebido de `messages.json`.
  - Timestamps del mock (D-3). Las cadenas `"YYYY-MM-DD HH:mm:ss"` se
    interpretan como **UTC explícito** (añadir `Z` en el generador y
    comentarlo), para no depender de la zona del servidor.
- **`messages`: 5 filas**, ids 1-5, `conversation_id` 1, `body` y
  timestamps del mock.
- Validaciones previas: el usuario y la tienda existen, el
  `conversation_id` existe y no hay dos conversaciones con el mismo `(user,
  shop)`. Si alguna falla, la generación se detiene.
- `setval` de `conversations_id_seq` y `messages_id_seq`.

**Conteos esperados tras `just db-reset`:** `conversations` 2, `messages` 5.
Los conteos previos del épico quedan intactos (en particular `users` sigue
como lo dejó US-54).

## Rutas: hoy → después

| Ruta | Hoy | Después |
|---|---|---|
| `POST /conversations` | fila `"1"` | Upsert por `(user_id = token.sub, shop_id)`: devuelve la existente o la crea. **201**. Si la tienda no existe, 422/404 vía `InvalidReferenceError` (precedente del mapper). |
| `GET /conversations` | total sin filtrar, `last_page` NaN sin `limit` | Paginador real con **`limit` 15 por defecto**, el default de `PaginationArgs` que hoy nunca se aplica. Se respeta `orderBy=updated_at&sortedBy=desc` (lo que manda el admin); sin `orderBy`, el orden es `id ASC` (el del archivo). `search` es texto libre `ILIKE` sobre `shops.name`. Visibilidad: ver abajo. |
| `GET /conversations/:param` | por `latest_message.conversation_id` | **Por `id`**. Si no existe o no es visible para quien pregunta, **404**. |
| `POST /messages/conversations/:id` | `messages[0]`, ignora `:id` | Inserta `{conversation_id: :id, user_id: token.sub, body}` y fija `conversations.updated_at = now()` (`clock.ts`), para que la conversación suba al ordenar por `updated_at`. **201** con el mensaje creado. Si la conversación no es visible, 404; si `body` está vacío, 400. |
| `GET /messages/conversations/:param` | los 5 mensajes, sin paginador | Solo los mensajes de la conversación `:param`, en orden `id DESC` (el del mock), **con paginador** (`limit` 15 por defecto; url `/messages/conversations/:param?limit=…`). Si la conversación no es visible, 404. |

**Visibilidad.** No es un guard: se implementa en el servicio con
`CurrentUserPayload`, y los decoradores no cambian.

- `super_admin` ve todas las conversaciones.
- `store_owner` ve las de las tiendas que posee (`shops.owner_id =
  token.sub`).
- El resto solo ve aquellas donde `user_id = token.sub`.

**Forma de cada respuesta (D-1).**

- **Conversación**, claves en el orden del mock **sin `__typename`**:
  - `user_id`, `id`, `shop_id`, como **strings**, igual que el mock y los
    tipos del admin;
  - `unseen`, **número** `0`/`1`;
  - `created_at`, `updated_at`;
  - `shop`, proyectado con `toShopDto` (`shops/shops.service.ts:49-68`);
  - `user`, en la forma del mock sin `__typename`: `{id:<string>, name,
    email, profile:null, address:[], wallet:null, is_active:<boolean>}`;
  - `latest_message`: `{body, conversation_id, created_at, updated_at,
    user_id, id}`, ids como strings, o `null` si la conversación no tiene
    mensajes.
- **Mensaje**, claves en el orden del mock:
  - `id`, `conversation_id`, `user_id`, como **números**, igual que
    `messages.json`;
  - `body`, `created_at`, `updated_at`;
  - `conversation`, en la forma embebida de `messages.json`: `id, user_id,
    shop_id` **números**, `created_at, updated_at, latest_message, unseen,
    shop, user`, y su `user` en la forma `{id, name, email,
    email_verified_at, created_at, updated_at, is_active:<0|1>,
    shop_id:null, profile:null}`.

**`unseen`, regla provisional y declarada.** Sin `messages/seen` no hay
estado de lectura. Se calcula desde los mensajes: `1` si el autor del
`latest_message` **no** es quien pregunta, `0` si lo es o si no hay
mensajes. Con el token de admin, ambas conversaciones dan `0`, que es el
valor del mock. Cuando llegue `messages/seen`, la regla pasará a basarse en
`last_seen_at`.

## Divergencias declaradas

| # | Dónde | Antes (mock) | Después | Por qué |
|---|---|---|---|---|
| V-1 | `latest_message` de conv 1 | `{id:"2", body:"New test"}` (incoherente: el 2 es `"hello"`) | `{id:"5", body:"New test", …}`, el último mensaje real | Calculado (decisión del épico) |
| V-2 | `latest_message` de conv 6 | `{id:"38", body:"rrerw"}` (mensaje inexistente) | `null` | Conv 6 no tiene mensajes |
| V-3 | `__typename` en conversación, `user`, `latest_message` y `shop` | presente | omitido | Sin consumidor (evidencia arriba). Restos de GraphQL. |
| V-4 | `user.id`, `user_id`, mensaje `user_id`, `conversation.user.id` | `"6"` / `6` | `"3"` / `3` | D-4: el 6 no existe y su email es el 3 |
| V-5 | `user.name` y `conversation.user.name` | `"Admin"` / `"admin"` | `"Jhon Doe"` | Se proyecta desde `users` (seed) |
| V-6 | `shop` embebido | 16 o 15 claves distintas por fila | las 16 claves de `toShopDto`, iguales en todas las filas | Proyección en vivo (D-5) |
| V-7 | `conversation.shop_id` dentro de los mensajes | `6` | `7` | Se lee de la conversación real |
| V-8 | `GET /conversations` sin `limit` | `per_page` undefined, `last_page` null, url `limit=undefined` | `limit` 15 y paginador coherente | Paginador real |
| V-9 | `GET /conversations` con `orderBy=updated_at&sortedBy=desc` | orden del archivo (1, 6) | 6, 1 (conv 6 tiene el `updated_at` más reciente) | Se respeta lo que pide el admin |
| V-10 | `GET /conversations/:param` | por `latest_message.conversation_id`; inexistente → 200 vacío | por `id`; inexistente o ajeno → 404 | D-1 |
| V-11 | `GET /messages/conversations/:param` | `{data:[5]}` de cualquier conversación, sin paginador | solo los de `:param`, con paginador | El admin usa `useInfiniteQuery` y espera `current_page`/`last_page` |
| V-12 | `POST`s | fila 0 | fila creada, persistida, 201 | D-1 |
| V-13 | timestamps de conv 6 | `"2023-03-21 15:00:08"` hoy pasa por `@Type(() => Date)` con la zona del proceso Node | ISO desde `timestamptz` sembrado en UTC | Comparar con la línea base y declarar el desfase horario si aparece |

## Scope

**Incluye:**

- DDL de `conversations` y `messages`, bloque del generador y seed
  regenerado.
- `just db-reset`, re-introspección (modelos `Conversation` y `Message`,
  relaciones inversas en `User` y `Shop`), records y repositorio
  `conversations.repository.ts`, que cubre conversaciones y mensajes por ser
  un mismo agregado, más su `*.integration.test.ts`.
- Los dos servicios Nest reescritos contra `@safari/db`, sin importar los
  JSON, con sus specs de Jest.
- La regla de visibilidad en el servicio.
- La documentación del modelo en `db/README.md`.

**NO incluye:**

- `POST /messages/seen/:id` ni ningún estado de lectura. Es la ruta que el
  admin llama y hoy da 404; se menciona en el reporte como candidata a US
  aparte.
- Notificaciones o tiempo real.
- Cambiar decoradores de autorización (R-6).
- `orders_count` real en `toShopDto` (sigue 0).
- Frontends.
- Que el shop tenga mensajería.

## Criterios de aceptación

### CA-1 — Seed y esquema

Tras `just db-reset`:

- `conversations` tiene 2 filas (ids 1 y 6, `user_id` 3, `shop_id` 7 y 2) y
  `messages` tiene 5 (ids 1-5, `conversation_id` 1, `user_id` ∈ {3, 1}).
- Hay 0 huérfanas por cada FK nueva.
- El unique `(user_id, shop_id)` rechaza un segundo par igual.
- `prisma validate` y `migrate diff --exit-code` dan `EXIT=0`.

### CA-2 — Lectura con la forma preservada

Deep-equal entre línea base y después, con token de admin, de `GET
/conversations?limit=5&sortedBy=desc&orderBy=updated_at` y de `GET
/conversations/1`. Se excluyen **solo** las claves de V-1 a V-9 y V-13; se
comprueban, campo a campo, el orden de claves y los tipos (`id` string,
`unseen` número, etc.).

### CA-3 — Mensajes por conversación y con paginador

- `GET /messages/conversations/1` devuelve los 5 mensajes en orden `id
  DESC`, con `current_page`, `last_page` y `total` = 5.
- `GET /messages/conversations/6` devuelve `data: []` y `total: 0`.
- `GET /messages/conversations/999` devuelve **404**.

### CA-4 — Escrituras reales

- `POST /messages/conversations/1 {"body":"CA-4 evidencia"}` con token de
  admin devuelve **201** con el mensaje creado.
- El `GET` siguiente lo trae primero.
- `GET /conversations/1` muestra `latest_message.body = "CA-4 evidencia"`
  y su `updated_at` cambió.
- `POST /conversations {"shop_id":7}` con token de admin devuelve la
  conversación 1, sin duplicarla.
- Tras la evidencia, las filas de prueba se borran y la conversación 1
  vuelve a su `updated_at` sembrado (estado de reposo para los tests).

### CA-5 — Visibilidad

- Con token de `customer@demo.com` (2), `GET /conversations` devuelve
  `total: 0` y `GET /conversations/1` da **404**.
- Con token de `store_owner@demo.com` (1, dueño de las 12 tiendas), ve las
  2.

### CA-6 — Sin regresión

`just db-check`, `npx jest`, `just build-api` y `just verify` en verde con
recuentos; `/api/settings` sigue en 5503 B. Un `grep -n "@db/"` en
`conversations/` y `messages/` no devuelve nada.

## Escenarios Gherkin

```gherkin
Feature: Mensajeria cliente-tienda desde Postgres
  Scenario: CA-2/V-1 — el ultimo mensaje se calcula
    Given la conversacion 1 con los 5 mensajes sembrados
    When el admin pide GET /api/conversations/1
    Then latest_message.id es "5" y latest_message.body es "New test"

  Scenario: CA-3/V-2 — conversacion sin mensajes
    Given la conversacion 6 sin mensajes
    When el admin pide GET /api/conversations/6
    Then latest_message es null
    And GET /api/messages/conversations/6 devuelve data vacia y total 0

  Scenario: CA-4 — enviar un mensaje persiste
    Given el admin autenticado
    When envia POST /api/messages/conversations/1 con body "hola"
    Then la respuesta es 201
    And el siguiente GET de mensajes lo devuelve primero

  Scenario: CA-5 — un cliente no ve conversaciones ajenas
    Given customer@demo.com autenticado
    When pide GET /api/conversations/1
    Then la respuesta es 404
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `db/schema.sql` | `conversations` y `messages` con FK, unique, índices y banner |
| `db/generate-seed.mjs` | lee `conversations.json` y `messages.json`; resuelve usuarios por email; normaliza fechas sin zona a UTC; valida; `setval` |
| `db/seed.sql` | regenerado |
| `packages/db/prisma/schema.prisma` | `Conversation`, `Message` + inversas en `User` y `Shop`; renombres previos re-aplicados |
| `packages/db/src/records.ts` | `ConversationRecord`, `MessageRecord` |
| `packages/db/src/repositories/conversations.repository.ts` | nuevo: `listConversations` (con visibilidad y `latest_message` por `LATERAL`/`DISTINCT ON` o dos consultas), `findConversationById`, `findOrCreateConversation`, `listMessages`, `createMessage` |
| `packages/db/src/repositories/conversations.integration.test.ts` | nuevo |
| `packages/db/index.ts` | barrel |
| `apps/api/rest/src/conversations/conversations.service.ts` / `.controller.ts` | Postgres; el controlador pasa `@CurrentUser()` |
| `apps/api/rest/src/messages/messages.service.ts` / `.controller.ts` | Postgres; `:id`/`:param` llegan al servicio |
| `apps/api/rest/src/conversations/conversations.service.spec.ts`, `messages/messages.service.spec.ts` | nuevos |
| `db/README.md`, `packages/db/README.md` | modelo y records |

## Definición de Done

Se sigue el Protocolo del [README del épico](./README.md#protocolo-de-ejecución-de-una-us-de-este-épico),
pegando la salida de cada paso.

- [ ] Línea base capturada **antes** del cambio, con los `curl` pegados.
- [ ] `node db/generate-seed.mjs` con los conteos nuevos en consola.
- [ ] `just db-reset` limpio.
- [ ] `psql` con:
  - los conteos 2 y 5;
  - 0 huérfanas en `conversations.user_id`/`shop_id` y
    `messages.conversation_id`/`user_id`;
  - el intento de duplicar `(3, 7)` rechazado por el unique.
- [ ] `npx prisma validate` + `npx prisma migrate diff
  --from-config-datasource --to-schema ./prisma/schema.prisma --exit-code`
  → `EXIT=0`.
- [ ] `just db-build` limpio.
- [ ] `just db-check` y `cd apps/api/rest && npx jest` en verde, con los
  recuentos nuevos pegados.
- [ ] `just build-api` y `just verify` en verde (`/api/settings` 5503 B).
- [ ] Comparación `node -e` entre línea base y después (CA-2), con la lista
  de claves excluidas y el resultado `OK`.
- [ ] `curl` de CA-3, CA-4 y CA-5 con status exacto, y la restauración del
  reposo tras CA-4.
- [ ] Status de esta US actualizado y su fila marcada en el épico.

## Notas para el agente ejecutor

- **`resolverUsuarioPorEmail` debería existir desde US-51.** Si no está, no
  se inventa otro helper: se para y se pregunta, porque eso indica que el
  orden del épico no se respetó.
- Los dos módulos son **un solo agregado** en `packages/db`, con un
  repositorio y un integration test. Los servicios Nest siguen siendo dos,
  porque los controladores existentes no se fusionan.
- `latest_message` por conversación: una sola consulta con `DISTINCT ON
  (conversation_id) … ORDER BY conversation_id, created_at DESC, id DESC`
  (vía `$queryRaw` tipado) o un `include` con `take: 1` de Prisma. Elegir
  la que no haga N+1 sobre la página y explicar la elección.
- `latest_message` del mock trae **todos** sus campos como string
  (`conversation_id`, `user_id`, `id`). Se mantiene así (tipos del admin).
- Ordenar con `updated_at` exige que `POST` de mensaje toque la
  conversación. Es la **única** escritura sobre `conversations` además del
  insert: el inventario de rutas que fijan `updatedAt` (D-7) son estas dos.
- El admin pinta `conversation.shop.logo.original` y `shop.name`
  (`views/list-view.tsx:60-64`), que `toShopDto` emite.
- `messages/seen` aparece en la barra superior del admin
  (`message-bar.tsx:134-135`). Va al reporte como candidata, no se
  implementa.
