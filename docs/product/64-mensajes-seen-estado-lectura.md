# US-64 — `POST /messages/seen/:id` y estado de lectura de conversaciones

> El admin marca una conversación como leída llamando a
> `POST /api/messages/seen/:id`, una ruta que no existe y da 404. Sin estado de
> lectura, `unseen` se calcula con una regla provisional (US-56): vale 1 si el
> último mensaje es de otro usuario, aunque ya se haya leído. Esta US crea la
> ruta y guarda la última lectura de cada participante.

**Épico:** ninguno (US standalone). Nace del «NO incluye» de
[US-56](./46-api-sin-mocks-json/56-conversations-messages-postgres.md).
**Fecha:** 2026-10-22
**Status:** Listo para ejecución
**Depende de:** US-56 (crea `conversations`/`messages`, la regla provisional de
`unseen` y el mapper que esta US cambia). Comparte con el Épico 46
`db/schema.sql`, `schema.prisma`, `records.ts` y el barrel, así que **no puede
ir en paralelo** con ninguna US de ese épico (R-2): va entre dos de ellas.
**LOC est.:** ~450

## Historia

**Como** admin o dueño de tienda que conversa con clientes, **quiero** que
abrir una conversación la marque como leída, **para** que el punto de «sin
leer» de la barra superior desaparezca al leerla y vuelva solo cuando llegue
un mensaje nuevo.

## Contexto — verificado en código (2026-10-22)

**Lo que hace hoy el admin** (`apps/admin/rest/src`):

- `data/client/api-endpoints.ts:64`: `MESSAGE_SEEN: '/messages/seen'`.
- `data/client/conversations.ts:43-48`: `messageSeen({ id })` hace `POST
  /messages/seen/${id}` y envía **el id desnudo como cuerpo** (`id`, no
  `{ id }`). El `id` es el **de la conversación**, no el de un mensaje.
- `data/conversations.tsx:174-184` (`useMessageSeen`) **ignora la respuesta**
  y, al terminar, invalida las queries de mensajes y de conversaciones.
- Se llama desde tres sitios, siempre con el id de la conversación y **solo si
  `unseen` es verdadero**:
  - `components/layouts/topbar/message-bar.tsx:134-140` (barra superior);
  - `components/message/views/list-view.tsx:33-40` (lista de conversaciones);
  - `components/message/user-message-index.tsx:84-90` (al abrir el chat).
- `unseen` se consume como booleano (`Boolean(item?.unseen)`) y pinta el
  punto de aviso (`message-bar.tsx:50,82,116,157`).

**Lo que hace hoy la API:**

- `POST /api/messages/seen/:id` da **404**. `MessagesController` está montado
  en `messages/conversations` (`apps/api/rest/src/messages/messages.controller.ts`),
  así que nada atiende `messages/seen`.
- `unseen` se calcula en `apps/api/rest/src/conversations/conversation-dto.mapper.ts`
  (función `unseen`): `1` si el último mensaje es de otro usuario y `0` si es
  de quien consulta o si no hay mensajes. Es la regla provisional que US-56
  declaró y que esta US reemplaza.
- Con el seed en reposo, el admin ve `unseen: 0` en las conversaciones 1 y 6.
  `store_owner@demo.com`, dueño de la tienda 7, ve `unseen: 1` en la 1, porque
  su último mensaje (el 5) es del admin.

**Precedente de estado de lectura por usuario:** `store_notice_read` (US-51):
un pivote `(store_notice_id, user_id)` con PK compuesta y las dos FK en
CASCADE, con un upsert en `markStoreNoticeRead`
(`packages/db/src/repositories/store-notices.repository.ts`).

## Modelo

Tabla nueva **`conversation_reads`**, calco de `store_notice_read`:

- `conversation_id bigint NOT NULL REFERENCES conversations(id) ON DELETE CASCADE`;
- `user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE`;
- `last_seen_at timestamptz NOT NULL`;
- `PRIMARY KEY (conversation_id, user_id)` e índice en `user_id`.

Va por participante y no como columna de `conversations`, porque una
conversación la leen al menos dos personas (el cliente y quien atiende la
tienda), y cada una tiene su propio «sin leer».

**Regla nueva de `unseen`** para quien consulta (`viewer`):

- `0` si no hay mensajes;
- `0` si el último mensaje es suyo;
- `0` si tiene `last_seen_at` y el último mensaje se creó en o antes de esa
  marca;
- `1` en cualquier otro caso.

`last_seen_at` lo fija el repositorio con `now()` de `packages/db/src/clock.ts`
(US-32), el mismo reloj con el que `createMessage` fija `created_at`.

**Seed:** `conversation_reads` arranca **vacía**. El mock no trae estado de
lectura, y con la regla nueva los valores del seed quedan como hoy: el admin
ve `0` en las dos conversaciones y el dueño de la tienda 7, `1` en la 1.

## Scope

**Incluye:**

- el DDL de `conversation_reads` con su banner, la re-introspección (modelo
  `ConversationRead` e inversas en `Conversation` y `User`) y su record si
  hace falta;
- una función en `conversations.repository.ts` que marque la lectura (upsert
  de `last_seen_at = now()`) y la lectura de `last_seen_at` de quien consulta,
  sin N+1 en el listado;
- la ruta `POST /api/messages/seen/:id` en el módulo `messages`, con la misma
  visibilidad que las demás rutas de mensajería (US-56);
- el cambio de la regla de `unseen` en el mapper, tanto en la conversación
  como en la conversación embebida en cada mensaje;
- el integration test y los specs de Jest.

**NO incluye:**

- marcar como leído al enviar un mensaje: el último mensaje pasa a ser propio
  y la regla ya da `0`;
- notificaciones o tiempo real;
- `orders/seen` y `notify-log-seen`, otras rutas «seen» del admin que tampoco
  existen;
- contadores de mensajes sin leer (el admin solo usa un booleano);
- cambiar decoradores de autorización (R-6 del Épico 46);
- tocar frontends.

## Criterios de aceptación

### CA-1 — Esquema

- Tras `just db-reset`, `conversation_reads` existe y está vacía.
- `prisma validate` y `migrate diff --exit-code` dan `EXIT=0`.
- Los conteos del seed no cambian (`conversations` 2, `messages` 5).

### CA-2 — La ruta existe y marca la lectura

- `POST /api/messages/seen/1` con el token de `store_owner@demo.com` responde
  2xx. En `psql` queda una fila `(1, 1)` con `last_seen_at` reciente.
- Repetirla no duplica la fila: actualiza `last_seen_at`.
- Acepta el cuerpo que manda el admin (el id desnudo) y también un cuerpo
  vacío. El id que cuenta es el de la ruta.

### CA-3 — `unseen` usa la lectura

| Paso (token de `store_owner@demo.com`) | `unseen` de la conversación 1 |
|---|---|
| Seed en reposo | `1` |
| Tras `POST /messages/seen/1` | `0` |
| El admin envía un mensaje nuevo a la 1 | `1` |
| Tras otro `POST /messages/seen/1` | `0` |

Se comprueba en `GET /conversations`, `GET /conversations/1` y en el
`conversation` embebido de `GET /messages/conversations/1`. El admin sigue
viendo `0` en todo el recorrido, porque el último mensaje es suyo.

### CA-4 — Visibilidad y errores

- Con el token de `customer@demo.com`, `POST /messages/seen/1` da **404**,
  porque la conversación no es visible para él, y no escribe nada.
- `POST /messages/seen/999` y `POST /messages/seen/abc` dan **404**.
- Sin token da **401**.

### CA-5 — Sin regresión

- `just db-check`, `npx jest`, `just build-api` y `just verify` en verde, con
  los recuentos.
- `/api/settings` sigue en 5503 B.
- La comparación de CA-2 de US-56 (forma de `GET /conversations` y `GET
  /conversations/1` con el admin) sigue en `OK`.

## Escenarios Gherkin

```gherkin
Feature: Estado de lectura de las conversaciones
  Scenario: CA-3 — leer apaga el aviso
    Given la conversacion 1 cuyo ultimo mensaje es del admin
    And store_owner@demo.com la ve con unseen 1
    When store_owner hace POST /api/messages/seen/1
    Then GET /api/conversations/1 devuelve unseen 0

  Scenario: CA-3 — un mensaje nuevo vuelve a encender el aviso
    Given store_owner ya leyo la conversacion 1
    When el admin envia un mensaje a la conversacion 1
    Then store_owner ve unseen 1 en la conversacion 1

  Scenario: CA-4 — no se marca una conversacion ajena
    Given customer@demo.com autenticado
    When hace POST /api/messages/seen/1
    Then la respuesta es 404
    And conversation_reads sigue vacia
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `db/schema.sql` | tabla `conversation_reads`, índice y banner |
| `db/README.md` | estado de lectura en la sección de mensajería |
| `packages/db/prisma/schema.prisma` | modelo `ConversationRead` + inversas |
| `packages/db/src/repositories/conversations.repository.ts` | marcar la lectura; `last_seen_at` de quien consulta |
| `packages/db/src/repositories/conversations.integration.test.ts` | casos de lectura |
| `packages/db/src/records.ts`, `packages/db/index.ts`, `packages/db/README.md` | si cambia el record o el barrel |
| `apps/api/rest/src/messages/*.controller.ts` / `messages.service.ts` | la ruta `seen/:id` |
| `apps/api/rest/src/conversations/conversation-dto.mapper.ts` | la regla nueva de `unseen` |
| specs de `conversations` y `messages` | casos nuevos |

## Definición de Done

- [ ] Línea base con la API recién arrancada: `POST /messages/seen/1` da 404,
  y el `unseen` de la conversación 1 vale `1` para `store_owner` y `0` para
  el admin.
- [ ] `just db-reset` y `psql` con la tabla vacía y los conteos intactos.
- [ ] `npx prisma validate` + `migrate diff --exit-code` → `EXIT=0`, y `just
  db-build`.
- [ ] CA-2 a CA-4 con `curl`, Bearer y status exacto, y la fila de `psql`
  tras cada `seen`.
- [ ] Restauración del reposo tras la evidencia: se borran el mensaje de
  prueba y las filas de `conversation_reads`, y el `updated_at` de la
  conversación 1 vuelve al sembrado. Vale también `just db-reset`.
- [ ] CA-5: `just db-check`, `npx jest`, `just build-api` y `just verify` con
  recuentos, y la comparación de US-56 en `OK`.
- [ ] Status actualizado aquí y en el mapa de `docs/product/README.md`.

## Notas para el agente ejecutor

- **El id es el de la conversación.** El admin nunca manda un id de mensaje a
  esta ruta, aunque el path diga `messages`.
- **El cuerpo es el id desnudo.** `HttpClient.post(url, id)` envía un JSON
  como `"1"` o `1`, no un objeto. No declarar un DTO que lo exija: leer solo
  el `:id` de la ruta.
- **Ruta nueva sin tocar las existentes.** `MessagesController` está en
  `messages/conversations`. Lo más simple es un segundo controlador en
  `messages/seen` dentro del mismo módulo (precedente: `coupons.controller.ts`
  tiene tres). No cambiar el prefijo del existente.
- **La respuesta la ignora el admin.** Devolver la conversación proyectada,
  ya con `unseen: 0`, sirve como evidencia y no rompe nada. Un 201 es el
  default de Nest para un `@Post`, igual que en el resto de la API.
- **Sin N+1.** En el listado, la marca de quien consulta para toda la página
  debe salir de una sola consulta (o de un `include` filtrado por `userId`),
  igual que `latestMessage` en US-56.
- **Comparar marcas con el mismo reloj.** `last_seen_at` y el `created_at` de
  los mensajes nuevos salen ambos de `now()`. Los mensajes del seed son de
  2023, así que cualquier lectura actual los cubre.
- Mencionar en el reporte `orders/seen` y `notify-log-seen`: son otras dos
  rutas «seen» del admin que dan 404 y quedan fuera.
