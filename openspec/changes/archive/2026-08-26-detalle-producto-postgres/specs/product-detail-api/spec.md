# Delta for Product Detail API

> Capacidad nueva (US-3). Solo `ADDED Requirements`. La proyección de 20
> claves vive en `product-listing-api/spec.md`, referenciada.

## ADDED Requirements

### Requirement: Detalle de producto por slug desde Postgres (CA-1, CA-4)

`GET /api/products/:slug` MUST leer de Postgres vía `findProductBySlug()`
(`products.repository.ts:227-253`), no de `products.json`.
`ProductsService.getProductBySlug` (`products.service.ts:210`) MUST ser
`async`. El objeto raíz MUST tener las 20 claves de `product-listing-api`
más `related_products` (21 totales).

#### Scenario: Paridad de contrato para un slug del seed
- GIVEN la base sembrada y el slug `apples`
- WHEN pido `GET /api/products/apples`
- THEN recibo 200 con exactamente 21 claves (las 20 de listado + `related_products`)
- AND un diff `node -e` contra la línea base del mock (`proposal.md`) no
  muestra claves añadidas ni faltantes
- AND cualquier elemento de `related_products` trae las mismas 20 claves de
  un item de `GET /api/products`, sin `related_products` propio

#### Scenario: La página de producto de la tienda renderiza en 200 (CA-4)
- GIVEN el shop (3003) contra la API (9001) ya en Postgres y el slug sembrado
  `apples` (`db/seed.sql:447`); la página delega en
  `apps/shop/src/framework/rest/product.ssr.ts`
- WHEN pido `curl -s -w "%{http_code}" http://localhost:3003/en/products/apples`
- THEN recibo `200` y el HTML trae `Apples`, no el `notFound` que devuelve su
  `catch` (`product.ssr.ts:54-58`) ante un error del cliente

### Requirement: Regla de relacionados — divergencia ratificada del mock (D-1) (CA-3)

`findProductBySlug()` MUST resolver `related_products` con: mismo `type_id`
que el producto consultado, `ORDER BY id ASC`, `LIMIT 20`, **sin excluir el
producto consultado** y **sin filtro de `status`/`visibility`**.

La consulta no aplica auto-exclusión, que no es lo mismo que auto-inclusión
garantizada: el producto sale en su propia lista si —y solo si— su id cae
entre los 20 primeros de su `type`. Medido sobre el catálogo: **195 de 1200
productos (16,25 %)**; los otros 1005 no se auto-incluyen, y eso también es
paridad exacta con el mock.

Es una **divergencia deliberada y aprobada por el usuario**, no un bug: el
repositorio excluía antes el propio producto y filtraba `status`/
`visibility` (`products.repository.ts:237-247` previo); esta regla los
elimina para replicar byte a byte el mock (`products.service.ts:210-219`
previo). En esta US **CA-1 (paridad de contrato) gana sobre la corrección
de UX** — decisión ratificada, no reabrir.

Consecuencias aceptadas (declaradas, no defectos):

| Consecuencia | Observabilidad con el seed actual |
|---|---|
| El producto aparece en su propio `related_products` | Solo si su id está entre los 20 primeros de su `type`: 195/1200 |
| Filas `draft`/no públicas pueden salir en `related_products` | Latente, NO observable hoy: única fila no-`publish` es id 454 (type `furniture`), fuera de los 20 primeros de ese type (412-431); `visibility_private` = 0 filas |

Ambas se revierten reponiendo las tres condiciones del `where` original si
una US futura prioriza corrección de UX sobre paridad de contrato.

#### Scenario: El producto consultado se incluye a sí mismo, sin filtro de status
- GIVEN un slug cuyo id está entre los 20 primeros ids de su `type`
- WHEN pido su detalle
- THEN `related_products` contiene un elemento con el mismo `id` del raíz
- AND el `where` de Prisma solo filtra por `typeId`, sin `status` ni
  `visibility` (test de integración)

### Requirement: 404 de dominio para slug inexistente (CA-2)

Un slug inexistente MUST responder HTTP 404 con el cuerpo por defecto de
Nest — `{"statusCode":404,"message":"...","error":"Not Found"}`, mensaje en
español — vía `throw new NotFoundException(...)`. El proceso MUST NOT
crashear ni responder 500.

#### Scenario: Slug inexistente
- GIVEN la API contra la base sembrada
- WHEN pido `curl -i GET /api/products/no-existe-xyz`
- THEN recibo 404 con `{"statusCode":404,"message":...,"error":"Not Found"}`
- AND `GET /api/types` sigue en 200 después (el proceso sigue vivo)

### Requirement: Errores de conexión a Postgres (D-5)

Si Prisma no puede conectar, el endpoint MUST responder 503 con
`getUserFriendlyMessage()`, igual que `getProducts()`
(`products.service.ts:200-207`); otro error no controlado MUST responder
500 con el mismo helper. El `try/catch` MUST NOT capturar ni re-envolver el
`NotFoundException` anterior.

#### Scenario: Postgres caído
- GIVEN `just db-down`
- WHEN pido `GET /api/products/apples`
- THEN recibo 503 con `{statusCode, message, error}` legibles
- AND, con la base viva, un slug inexistente sigue en 404 pese a compartir el
  mismo `try/catch`

## Out of Scope

Reviews/questions/wishlist · listado (US-2) · catálogos (US-4) · código de
`apps/shop/**` (CA-4 solo observa) · `ExceptionFilter` global ·
`getPopularProducts`/`getBestSellingProducts`.
