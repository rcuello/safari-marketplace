# US-62 — `withdraws` desde Postgres

> Las solicitudes de retiro de las tiendas pasan a una tabla `withdraws`,
> sembrada con las 2 filas del mock. Las 5 rutas leen y escriben de verdad,
> y se crea `POST /approve-withdraw`, la ruta que el admin llama y hoy da
> 404. El balance de la tienda **no** se toca: no hay tabla de balances
> (decisión 4 del épico).

**Épico:** [Épico 46](./README.md)
**Fecha:** 2026-10-20
**Status:** Listo para ejecución
**Depende de:** [US-61](./61-analytics-calculado.md). La dependencia es solo
por los archivos compartidos (R-2). En datos solo necesita `shops`, que ya
está migrada.
**LOC est.:** ~1100

## Historia

**Como** dueño de tienda, **quiero** pedir un retiro y ver solo los de mis
tiendas. **Como** super admin, **quiero** ver todos y cambiarles el estado.
**Para que** el flujo de retiros del admin funcione contra datos reales: hoy
la lista sale vacía y aprobar da 404.

## Contexto — verificado en código (2026-10-20)

**Controlador** (`apps/api/rest/src/withdraws/withdraws.controller.ts`):
`@Permissions(...ADMIN_AND_OWNER)` a nivel de clase (`:19`; `ADMIN_AND_OWNER
= ['super_admin','store_owner']`, `permissions.decorator.ts:21`) y
`@Controller('withdraws')` (`:20`).

| Ruta | Línea | Entrada |
|---|---|---|
| `POST /withdraws` | `:24-27` | `CreateWithdrawDto` = `amount, note, details, payment_method, shop_id` (`dto/create-withdraw.dto.ts`) |
| `GET /withdraws` | `:29-32` | `GetWithdrawsDto`: `orderBy, sortedBy, status, shop_id` + paginación |
| `GET /withdraws/:id` | `:34-37` | — |
| `POST /withdraws/:id/approve` | `:38-44` | `ApproveWithdrawDto` = `id, status` |
| `DELETE /withdraws/:id` | `:46-49` | — |

**Servicio** (`withdraws/withdraws.service.ts`, JSON importado en `:6`):

- `create` (`:16-21`) devuelve `{id: length+1, ...dto}` **sin persistir**.
- `getWithdraws` (`:23-48`):
  - `page` vale 1 por defecto, pero **`limit` no tiene default**: sin
    `?limit` da `slice(NaN, NaN)`, así que `data: []`, y `paginate` cae a su
    `pageSize = 10` por defecto;
  - `shop_id` se compara con `===` contra un número, pero el valor llega
    como **string** (`ValidationPipe` sin `transform`, `main.ts:9`), así que
    **nunca coincide** y con `shop_id` la lista siempre sale vacía;
  - el filtro por `status` está comentado (`:34-36`);
  - la url es `/withdraws?limit=${limit}`.
- `findOne` (`:50-52`) devuelve el **string** `This action returns a #id
  withdraw`.
- `update` (`:54-56`) devuelve `withdraws[0]`.
- `remove` (`:58-60`) devuelve un string.

**Entidad** (`withdraws/entities/withdraw.entity.ts`): el enum
`WithdrawStatus` usa TitleCase (`'Approved'`, `'On hold'`…). **Ningún dato
lo usa.**

**Admin (consumidor único):**

- `data/client/withdraw.ts`:
  - `paginated` envía `shop_id` como query **y**
    `search=shop_id:N` (`formatSearchParams`), más `searchJoin=and`;
  - `get` va a `withdraws/${id}`;
  - `approve` hace **`POST approve-withdraw`** (`API_ENDPOINTS.APPROVE_WITHDRAW
    = 'approve-withdraw'`, `data/client/api-endpoints.ts:37`). Esa ruta **no
    existe en la API** (`grep` vacío en `apps/api/rest/src`).
- Payload de aprobación: `{id: string, status}`, con `status` tomado de una
  lista local con ids **en minúscula**: `approved`, `on_hold`, `processing`,
  `pending` y `rejected` (`pages/withdraws/[withdrawId]/index.tsx:20-40`,
  `:74-81`).
- El tipo `ApproveWithdrawInput` está en `types/index.ts:923-926`. El enum
  `WithdrawStatus` del admin (`types/index.ts:61-67`) va en MAYÚSCULAS, pero
  las tablas lo comparan con `status.toUpperCase()`
  (`components/withdraw/withdraw-table.tsx:49`, `withdraw-list.tsx:43`).
  **La minúscula es el vocabulario real del dato.**
- Llamadas de lista:
  - `pages/withdraws/index.tsx:19` (super admin, `limit: 10`);
  - `pages/[shop]/withdraws/index.tsx:40` (`shop_id`, `limit: 10`);
  - `components/dashboard/admin.tsx` (`limit: 10`).
- Creación: `components/withdraw/withdraw-form.tsx`, con `CreateWithdrawInput
  = {amount, shop_id, payment_method?, details?, note?}`
  (`types/index.ts:915-921`).

**Mock** (`withdraws.json`): 2 filas, en orden **id DESC**.

| id | shop_id | amount | payment_method | status | created_at | updated_at |
|---|---|---|---|---|---|---|
| 2 | 3 | 10 | `cash` | `pending` | 2023-11-07T23:13:08 | igual |
| 1 | 3 | 300 | `Bkash` | `approved` | 2023-11-06T17:49:43 | 2023-11-06T17:51:11 |

- Claves en orden: `id, shop_id, amount, payment_method, status, details,
  note, deleted_at, created_at, updated_at, shop`.
- `shop` es un snapshot de 13 claves: `id, owner_id, name, slug,
  description, cover_image, logo, is_active (1), address, settings,
  notifications (null), created_at, updated_at`.
- `shop_id = 3` existe en el seed (Bags Shop, dueño 1).
- `Withdraw extends CoreEntity`, así que `created_at`/`updated_at` ya salen
  hoy con 3 decimales. Los timestamps del `shop` anidado no llevan `@Type` y
  salen como en el JSON.

## Línea base (paso 2 del Protocolo del épico)

```bash
API=http://localhost:9001/api
tok() { curl -s -X POST $API/token -H 'content-type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"demodemo\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).token'; }
ADMIN=$(tok admin@demo.com); OWNER=$(tok store_owner@demo.com); CUST=$(tok customer@demo.com)

curl -s -w '\n%{http_code}\n' -H "Authorization: Bearer $ADMIN" "$API/withdraws?limit=10&page=1"                         > base-list-admin.txt
curl -s -w '\n%{http_code}\n' -H "Authorization: Bearer $ADMIN" "$API/withdraws"                                         > base-list-nolimit.txt   # hoy data []
curl -s -w '\n%{http_code}\n' -H "Authorization: Bearer $OWNER" "$API/withdraws?shop_id=3&searchJoin=and&search=shop_id:3&limit=10" > base-list-shop3.txt  # hoy data []
curl -s -w '\n%{http_code}\n' -H "Authorization: Bearer $ADMIN" "$API/withdraws/1"                                       > base-get-1.txt          # hoy string
curl -s -w '\n%{http_code}\n' -X POST -H "Authorization: Bearer $ADMIN" -H 'content-type: application/json' \
  -d '{"id":"2","status":"approved"}' "$API/approve-withdraw"                                                             > base-approve.txt        # hoy 404
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $CUST" "$API/withdraws?limit=10"                       # 403 hoy y después
```

Capturar **antes de cualquier escritura**. `POST /withdraws/:id/approve`
no muta el mock, pero `approve-withdraw` y `create` tampoco existen o no
persisten, así que el orden de arriba es seguro.

## Tablas nuevas

`withdraws`, con banner en el estilo del archivo:

| Columna | Restricción |
|---|---|
| `id` | `bigserial` PK |
| `shop_id` | `bigint NOT NULL` FK → `shops(id)` `ON DELETE CASCADE` (un retiro no sobrevive a su tienda; mismo criterio que `products.shop_id`). Índice. |
| `amount` | `numeric(12,2) NOT NULL CHECK (amount > 0)` |
| `payment_method` | `text NOT NULL` (el mock trae texto libre: `cash`, `Bkash`) |
| `status` | `text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','on_hold','rejected','processing'))` |
| `details`, `note` | `text NULL` |
| `created_at`, `updated_at` | `timestamptz NOT NULL DEFAULT now()`, sembrados del mock (D-3) |

Sin `deleted_at`: se borra de verdad y se emite `null` constante (D-6). Sin
trigger (D-7). Sin columna de balance.

## Reglas del seed

- Bloque nuevo en `db/generate-seed.mjs`, después de `shops`, leyendo
  `withdraws.json`.
- Ids (1, 2) y timestamps (`ts()`) preservados; `amount` con `num()`.
- Validación previa: `shop_id` existe en el conjunto final de shops;
  `status` está en el CHECK (fallo con mensaje si llega `'Pending'` o
  cualquier valor fuera de la lista); `amount > 0`.
- `setval` de `withdraws_id_seq`, y conteos en la cabecera y en consola.
- **Conteo esperado:** `withdraws` 2; `shop_id = 3` en las 2; 1 `pending` y 1
  `approved`.

## Rutas — hoy → después

| Ruta | Guard (no cambia) | Hoy | Después |
|---|---|---|---|
| `GET /withdraws` | `ADMIN_AND_OWNER` | sin `limit` da `[]`; `shop_id` nunca filtra | `limit` por defecto **10**. Filtros: `shop_id` de la query o `search=shop_id:N` (vía `parseSearch`; si vienen los dos, gana la query) y `status`. Visibilidad: el `super_admin` ve todo; el `store_owner` solo los retiros de **sus** tiendas (`shops.owner_id = user.sub`), y un `shop_id` ajeno da `data: []`. `ORDER BY id DESC`. Mismo `url` literal `/withdraws?limit=${limit}` y `paginate()` con `limit` crudo |
| `GET /withdraws/:id` | `ADMIN_AND_OWNER` | string | la fila (forma de `data[]`). **404** si no existe o si es de una tienda ajena para el dueño |
| `POST /withdraws` | `ADMIN_AND_OWNER` | eco sin persistir | inserta con `status = 'pending'` (el status del body se ignora). El dueño solo puede pedir para una tienda suya (403 si no). `400` si `amount <= 0` o si `shop_id` no existe. Devuelve la fila creada (201) |
| `POST /withdraws/:id/approve` | `ADMIN_AND_OWNER` en clase | `withdraws[0]` | se restringe a **`ADMIN_ONLY`** en el método: cambia `status` al valor del body, fija `updatedAt: now()` y devuelve la fila. `400` si `status` no está en el CHECK; `404` si no existe |
| `POST /approve-withdraw` **(nueva)** | `ADMIN_ONLY` | 404 | mismo comportamiento que la anterior, con `id` y `status` del body (`{id: string, status}`). Vive en un controlador propio, `@Controller('approve-withdraw')`, igual que `approve-coupon` |
| `DELETE /withdraws/:id` | `ADMIN_AND_OWNER` | string | borra de verdad y devuelve la fila borrada. El dueño solo puede borrar retiros `pending` de sus tiendas (403 si no); el super admin, cualquiera. `404` si no existe |

**Por qué `ADMIN_ONLY` en la aprobación.** Hoy la clase deja aprobar al
dueño, pero solo porque la ruta era un eco. Persistiendo, un dueño podría
autoaprobar sus retiros. El admin solo expone la página de aprobación
(`pages/withdraws/[withdrawId]`) en el menú del super admin. Es un **cambio
de guard deliberado y declarado** (V-5), la excepción documentada a R-6 del
épico: R-6 no impide **endurecer** una ruta de escritura nueva de verdad.

## Divergencias declaradas (D-1 del épico)

| # | Qué cambia | Evidencia |
|---|---|---|
| V-1 | `GET /withdraws` sin `limit` devuelve las 2 filas (hoy `[]`), con `per_page: 10` numérico | `base-list-nolimit.txt` vs después |
| V-2 | Con `shop_id=3` el dueño ve las 2 filas (hoy `[]`) | `base-list-shop3.txt` vs después |
| V-3 | `shop` embebido proyectado con `toShopDto` (`shops/shops.service.ts:49-68`) **recortado a sus 13 primeras claves** (mismo conjunto y orden que el snapshot). Cambian los valores que el seed de `shops` ya diverge del mock (`created_at`/`updated_at` de `now()`) | deep-equal de `data[*]` excluyendo `shop.created_at`/`shop.updated_at`; listar cualquier otra diferencia |
| V-4 | `GET /:id` devuelve la fila, no un string. `approve-withdraw` existe | `base-get-1.txt` y `base-approve.txt` vs después |
| V-5 | Aprobar pasa de `ADMIN_AND_OWNER` a `ADMIN_ONLY` | `curl` con `$OWNER` → 403 exacto |

**Equivalencia exigida:** `GET /withdraws?limit=10&page=1` con admin es
deep-equal a `base-list-admin.txt` en todo lo demás. Eso incluye `amount`
numérico (`10`, `300`, no `"10.00"`), `deleted_at: null`, el orden id DESC,
`created_at`/`updated_at` de nivel superior idénticos y `per_page: "10"`
string.

## Scope

**Incluye:**
- DDL de `withdraws`, bloque del generador y `seed.sql`;
- `just db-reset` y re-introspección (`Withdraw`, relación inversa en
  `Shop`);
- `WithdrawRecord`;
- `packages/db/src/repositories/withdraws.repository.ts` (`listWithdraws`,
  `findWithdrawById`, `createWithdraw`, `updateWithdrawStatus`,
  `deleteWithdraw`) con su integration test;
- el barrel;
- las 5 rutas y la nueva `approve-withdraw`;
- `withdraws.service.ts` sin el import del JSON;
- spec de Jest;
- `db/README.md` y `packages/db/README.md`.

**NO incluye:**
- descontar del balance o validar `amount <= current_balance`: no existe
  tabla de balances (decisión 4 del épico). Se anota en el reporte como
  trabajo futuro;
- emitir `balance` en `/shops`;
- el enum TitleCase de la entidad (se deja; anotarlo);
- `orderBy`/`sortedBy` (siguen ignorados: el orden es id DESC);
- notificaciones;
- frontend.

## Criterios de aceptación

### CA-1 — Seed de `withdraws`
Tras `just db-reset`: 2 filas, ids 1 y 2, `shop_id = 3`, estados `approved`
y `pending`, timestamps iguales a los del mock y 0 huérfanas en `shop_id`.
Los conteos previos quedan intactos.

### CA-2 — Lista del admin equivalente
`GET /withdraws?limit=10&page=1` con admin cumple la equivalencia exigida
de arriba, salvo V-3.

### CA-3 — Filtros y visibilidad
- Admin con `search=shop_id:3` ve 2 filas y con `status=pending` 1.
- El dueño (usuario 1) ve 2.
- Un dueño centinela (`zz-withdraws-owner`, creado en el test) con una
  tienda propia ve solo los suyos; con `shop_id=3` recibe `data: []`.

### CA-4 — Escrituras persisten
- `POST /withdraws` del dueño para la tienda 3 devuelve 201, `status:
  'pending'` y aparece en el `GET`.
- `POST /approve-withdraw` `{id, status: 'on_hold'}` con admin lo cambia y
  `updated_at` avanza.
- Con `status: 'Approved'` devuelve 400.
- `DELETE` lo borra y el `GET /:id` siguiente da 404.

### CA-5 — Guards
El cliente recibe 403 en las 6 rutas. El dueño recibe 403 en las dos de
aprobación y al crear para una tienda ajena. El admin recibe 200/201.

### CA-6 — Sin regresión
Verdes con recuento pegado: `just db-check`, `npx jest`, `just build-api` y
`just verify`. `grep -n "@db/" apps/api/rest/src/withdraws/` no devuelve
nada.

## Escenarios Gherkin

```gherkin
Feature: Retiros de tienda desde Postgres
  Scenario: CA-2 — la lista del admin no cambia de forma
    Given el seed con los retiros 1 y 2 de la tienda 3
    When admin hace GET /api/withdraws?limit=10&page=1
    Then recibe los ids 2 y 1 en ese orden
    And amount es numerico y deleted_at es null

  Scenario: CA-3 — el duenio filtra por su tienda
    When store_owner hace GET /api/withdraws?search=shop_id:3&limit=10
    Then recibe 2 retiros

  Scenario: CA-4 — aprobar desde el admin persiste
    When admin hace POST /api/approve-withdraw con id 2 y status "approved"
    Then el GET /api/withdraws/2 devuelve status "approved"

  Scenario: CA-4 — un estado fuera del vocabulario se rechaza
    When admin hace POST /api/approve-withdraw con status "Approved"
    Then el status es 400

  Scenario: CA-5 — el duenio no aprueba
    When store_owner hace POST /api/approve-withdraw
    Then el status es 403
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---|---|
| `db/schema.sql` | tabla `withdraws` + índice + banner |
| `db/generate-seed.mjs` | bloque `withdraws`; validación de `status`/`shop_id`/`amount`; `setval`; conteos |
| `db/seed.sql` | regenerado |
| `packages/db/prisma/schema.prisma` | `Withdraw` + renombres de todos los modelos; inversa en `Shop` |
| `packages/db/src/records.ts` | `WithdrawRecord` + mapper (`_dec` para `amount`) |
| `packages/db/src/repositories/withdraws.repository.ts` | nuevo |
| `packages/db/src/repositories/withdraws.integration.test.ts` | nuevo (reloj con `_setNowProvider`; centinelas `zz-withdraws-`) |
| `packages/db/index.ts` | exports |
| `apps/api/rest/src/withdraws/withdraws.service.ts` | contra `@safari/db`; fuera el JSON |
| `apps/api/rest/src/withdraws/withdraws.controller.ts` | `@CurrentUser()`, `ADMIN_ONLY` en approve, controlador nuevo `approve-withdraw` |
| `apps/api/rest/src/withdraws/withdraws.module.ts` | registrar el controlador nuevo |
| `apps/api/rest/src/withdraws/withdraws.service.spec.ts` | nuevo |
| `db/README.md`, `packages/db/README.md` | modelo y record |

## Definición de Done

Seguir los pasos 1-10 del **Protocolo de ejecución** del [README del
épico](./README.md) y pegar:

- [ ] La línea base (5 cuerpos más el 403) y su repetición después.
- [ ] El generador con los conteos, y una corrida fallida con `status:
      "Pending"` en una copia del JSON (restaurada después).
- [ ] `just db-reset`.
- [ ] `psql` con:
  ```sql
  SELECT id, shop_id, amount, status, created_at, updated_at FROM withdraws ORDER BY id;
  SELECT count(*) FROM withdraws w LEFT JOIN shops s ON s.id=w.shop_id WHERE s.id IS NULL;
  ```
- [ ] `prisma validate` y `migrate diff --exit-code` con `EXIT=0`.
- [ ] `just db-build`, `just db-check` y `npx jest` verdes, con recuentos.
- [ ] `just build-api` y `just verify` verdes.
- [ ] La comparación `node -e` de CA-2 y la evidencia de V-1..V-5.
- [ ] Los `curl` de CA-4 y CA-5 con status exacto. Al final, la base vuelve
      al estado del seed: borrar lo creado y restaurar el `status` de la
      fila 2 a `pending`.
- [ ] Status y fila del épico actualizados.

## Notas para el agente ejecutor

- **Vocabulario.** Se guarda la minúscula del dato (`on_hold` con guion
  bajo, como el admin), no el TitleCase de la entidad Nest. No «normalizar»
  en el servicio: un valor fuera del CHECK es 400.
- **`shop_id` llega como string** en query y body. Coerción con
  `Number()` y guarda `Number.isSafeInteger(x) && x > 0` (US-31). Un valor
  inválido da 400, no lista vacía.
- La propiedad de la tienda se resuelve con `findShopOwnerById`, que ya
  existe en `packages/db/src/repositories/shops.repository.ts:176-180`, ya
  exportada y que nunca lanza. No duplicarla.
- `POST /withdraws/:id/approve` se conserva aunque el admin no lo use: el
  contrato existente no se borra.
- No añadir el débito de balance «porque es fácil»: no hay dónde
  guardarlo. Mencionarlo en el reporte.
