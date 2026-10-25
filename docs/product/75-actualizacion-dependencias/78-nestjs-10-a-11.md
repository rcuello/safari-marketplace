# US-78 — NestJS 10 → 11 (Express 5)

> Sube la API a la última 11.x. Es la mayor con más riesgo de
> comportamiento: `@nestjs/platform-express` 11 corre sobre Express 5, que
> cambia el enrutado y el parser de query strings.

**Épico:** [Épico 75](./README.md)
**Fecha:** 2026-10-24
**Status:** Implementada (2026-10-24). El CA-3 se cerró al integrar en `main`, junto con US-80.
**Depende de:** US-77
**LOC est.:** ~150

## Historia

**Como** mantenedor de la API, **quiero** NestJS 11, **para** quedar en una
línea vigente sin cambiar lo que ve el frontend.

## Contexto — verificado (2026-10-24)

- `@nestjs/core@11.2.8` pide Node 20 o superior (`engines`).
  `@nestjs/swagger@11` pide `@nestjs/core ^11.0.1`.
- **No hay rutas con comodín** en `apps/api/rest/src`: el `grep` de
  `@(Get|Post|Put|Patch|Delete|All)('…*…')` da 0 resultados. Eso quita el
  cambio más conocido de Express 5.
- `main.ts` usa `app.use(...)` (línea 16), `setGlobalPrefix('api')` (línea
  21) y `ValidationPipe` global (línea 22).
- La API recibe filtros por query string (`search`, `orderBy`, `limit`,
  `page`, …). Express 5 cambia el parser por defecto de `qs` a uno simple, y
  eso puede afectar a parámetros anidados o repetidos.

## Scope

**Incluye:**

- `@nestjs/*` a 11.x, con sus peers;
- lo que exija la guía de migración a v11, incluido Express 5;
- **DA-6**: si el dueño la confirma, `just doctor` exige Node 20 o superior.

**NO incluye:**

- NestJS 12 (US-79);
- reescribir los filtros de query string si Express 5 no los rompe.

## Criterios de aceptación

### CA-1 — Misma batería

`npx jest` en verde con las cifras de US-77.

### CA-2 — Query strings intactos

Hay que medir antes y después, con `curl`, al menos 6 rutas con query
string, incluido un parámetro repetido o anidado si alguno se usa. Una
pista: `grep` de `@Query(` en los controladores. Cada una tiene que dar el
mismo código y el mismo tamaño de cuerpo.

### CA-3 — El frontend sigue funcionando

`just verify` responde, y las rutas de humo del shop y del admin (ver las
notas del épico) funcionan contra la API en Nest 11.

## Escenarios Gherkin

```gherkin
Feature: API en NestJS 11 sobre Express 5
  Scenario: CA-2 — el parser de query strings no cambia el resultado
    Given 6 rutas con query string medidas en Nest 10
    When la API corre en Nest 11
    Then cada ruta devuelve el mismo código y el mismo tamaño
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `apps/api/rest/package.json`, `yarn.lock` | versiones |
| `apps/api/rest/src/main.ts` | si Express 5 exige configurar el parser (`app.set('query parser', 'extended')`) |
| `justfile` | DA-6, si se confirma |

## Definición de Done

- [x] Línea base de los `curl` de CA-2, tomada en Nest 10.
- [x] CA-1 y CA-2 con la salida pegada. CA-3 verificado al integrar (ver CA-3 en el resultado).
- [x] Lint sin escribir en 0.
- [x] Status actualizado aquí. También en la tabla del épico, al integrar.

## Resultado — ejecutado el 2026-10-24

Se ejecutó en un worktree aparte, con la API compilada (`yarn build` y
`node dist/main`) en el puerto 9011 y las mismas variables de entorno antes
y después (`PORT=9011`, `DATABASE_URL` hacia el Postgres de Docker en el
5433, `JWT_SECRET` desechable).

### Versiones

| Paquete | Antes (instalado) | Después | Rango en `package.json` |
|---|---|---|---|
| `@nestjs/common`, `core`, `platform-express`, `testing` | 10.4.22 | 11.2.7 | `11.2.7` (exacta, ver abajo) |
| `@nestjs/swagger` | 7.4.2 | 11.4.7 | `^11.4.7` |
| `@nestjs/config` | 3.3.0 | 4.0.4 | `^4.0.4` |
| `@nestjs/jwt` | 10.2.0 | 11.0.2 | `^11.0.2` |
| `@nestjs/mapped-types` | 2.1.1 | 2.1.1 | `2.1.1` (sin cambio: ya acepta `@nestjs/common ^10 \|\| ^11`) |
| `@nestjs/cli` | 10.4.9 | 11.0.24 | `^11.0.24` |
| `@nestjs/schematics` | 10.2.3 | 11.1.0 | `^11.1.0` |
| `@types/express` | 4.17.25 | 5.0.6 | `^5.0.6` |
| `express` (transitiva, de `platform-express`) | 4.x | 5.2.1 | — |
| `@types/jsonwebtoken` (transitiva, de `@nestjs/jwt`) | 9.0.5 | 9.0.10 | — |

- **`@nestjs/*` del núcleo van exactos en 11.2.7.** La 11.2.8 salió el
  2026-10-23, hace un día, y un `^11.2.7` la resolvería en el próximo
  `yarn install` sin lockfile. La 11.2.7 es del 2026-09-30.
- **Fechas:** todas las versiones adoptadas tienen más de dos semanas. Las
  más recientes, aparte del núcleo, son `@nestjs/swagger` 11.4.7
  (2026-08-17) y `@nestjs/cli` 11.0.24 (2026-07-10).
- **Peers** (`npm view <pkg>@<v> peerDependencies`): swagger 11.4.7 pide
  `@nestjs/core ^11.0.1`; config 4.0.4 y mapped-types 2.1.1 aceptan
  `@nestjs/common ^10 || ^11`; jwt 11.0.2, de `^8` a `^11`. `@nestjs/core`
  11.2.7 pide Node `>= 20` y `@nestjs/cli` 11.0.24, `>= 20.11`.
  schematics 11.1.0 declara `prettier ^3` como peer **opcional**, así que
  el prettier 2 de la API no da aviso (Prettier 3 es de US-81).
- **`@types/express` 5** acompaña al `express` 5.2.1 que trae
  `platform-express`. `main.ts` importa `json`, `Request`, `Response` y
  `NextFunction` de `express`, y con los tipos de la 4 describirían una
  versión que ya no corre.
- **El lockfile queda limpio:** una sola entrada de cada `@nestjs/*`, de
  `express@5.2.1` y de `path-to-regexp@8.4.2`. `yarn install` no muestra
  avisos de peers nuevos. Siguen los tres de `nestjs-stripe` y el de
  `ts-loader`, que ya estaban.
- **`nestjs-stripe` 1.0.0** sigue declarando peers `@nestjs/* ^6 || ^7 ||
  ^8`. Con Nest 11 la API arranca y el log muestra `StripeModule
  dependencies initialized`. Sustituirlo es tema de US-87.

### Lectura previa: guía de migración y Express 5

Se leyeron con Context7 la guía de NestJS (`docs.nestjs.com`: migración,
controladores y middlewares) y la de Express 5 (`expressjs.com/en/guide/
migrating-5`). Se revisó cada punto contra el código:

| Cambio de v11 / Express 5 | En la API | Efecto |
|---|---|---|
| Comodines con nombre (`*splat`), `?` opcional sustituido por llaves, caracteres reservados `()[]?+!` | `grep` de `@(Get\|Post\|Put\|Patch\|Delete\|All\|Controller\|Options\|Head)('…')` con `*?()+![]` sobre `src`: **0**. Sin `forRoutes`. El único `app.use` con ruta es `'/api/messages/seen'`, un prefijo literal | ninguno |
| Parser de query strings por defecto `'simple'` (`node:querystring`) en vez de `'extended'` (`qs`) | 60 usos de `@Query(` en los controladores | **cambia 3 respuestas** (ver CA-2). Se neutraliza |
| `req.body` es `undefined` si no hay parser; `res.status()` solo acepta enteros de 100 a 999 | ni `req.body`, ni `req.query`, ni `res.status` en `src` | ninguno |
| `express.urlencoded` con `extended: false` por defecto | la API no registra `urlencoded` propio | ninguno |
| Orden de los hooks de ciclo de vida por jerarquía | ningún `onModuleInit`, `onModuleDestroy` ni `onApplicationShutdown` en `src` | ninguno |
| `CacheModule` fuera de `@nestjs/common`; cambios de `Reflector` | sin `CacheModule`. `Reflector.getAllAndOverride` en los dos guards: los tests y `/me` con token pasan | ninguno |
| `@nestjs/config` 4 (orden de lectura de la configuración interna frente a `process.env`) | solo `ConfigModule.forRoot()` sin `load` ni validación | ninguno |

### Código

Dos ajustes, en un commit aparte de la subida:

1. **`src/main.ts`:** `NestFactory.create<NestExpressApplication>` y
   `app.set('query parser', 'extended')`. Es la forma que documenta Nest 11
   para volver a `qs`. Express 5.2.1 usa en ese modo
   `qs.parse(str, { allowPrototypes: true })`, las mismas opciones que
   Express 4.
2. **`src/auth/jwt-options.ts`:** `@types/jsonwebtoken` 9.0.10 tipa
   `expiresIn` como `number | StringValue` (el formato de `ms`), y `tsc`
   fallaba con `TS2322: Type 'string' is not assignable to type 'number |
   StringValue'`. El valor de `JWT_EXPIRES_IN` se pasa con el tipo de
   `JwtSignOptions['expiresIn']`. En tiempo de ejecución no cambia nada:
   jsonwebtoken sigue validando el formato al firmar, como antes.

No hizo falta tocar `tsconfig.json`, `nest-cli.json` ni la configuración
de jest.

### CA-1 — Misma batería

```
$ npx jest                     # antes (Nest 10) y después (Nest 11, HEAD)
Test Suites: 34 passed, 34 total
Tests:       565 passed, 565 total

$ npx tsc --noEmit -p tsconfig.json
tsc EXIT=0                     # antes. Después de subir, sin el ajuste:
src/auth/jwt-options.ts(31,20): error TS2322: Type 'string' is not assignable to type 'number | StringValue'.
tsc EXIT=0                     # con el ajuste

$ npx eslint "{src,apps,libs,test}/**/*.ts"
eslint EXIT=0                  # antes y después

$ yarn build
$ rimraf dist
$ nest build
Done in 97.49s.                # EXIT=0
```

### CA-2 — Query strings intactos

El script de huella de US-77 (código, bytes y sha256 de cada cuerpo) se
amplió con 14 peticiones con query string. Hay cuatro con corchetes o
parámetros repetidos, que es donde los dos parsers se separan.

Se midió tres veces: en Nest 10, en Nest 11 con el parser por defecto y en
Nest 11 con `'extended'`.

| Petición | Nest 10 | Nest 11, parser `simple` | Nest 11, `extended` (entregado) |
|---|---|---|---|
| `POST /token` (login) | 201, claves `permissions,role,token` | igual | igual |
| `GET /settings` | 200, 5504 B, `847a1e29…` | idéntica | idéntica |
| `GET /products?limit=5` | 200, 5145 B, `7a88bbce…` | idéntica | idéntica |
| `GET /products?search=name:apple&limit=5` | 200, 5318 B, `9cfa00c4…` | idéntica | idéntica |
| `GET /shops` | 200, 13788 B, `b6764f4a…` | idéntica | idéntica |
| `GET /categories?limit=3` | 200, 4254 B, `cff35456…` | idéntica | idéntica |
| `GET /me` (admin) | 200, 1345 B, `7fb72c0c…` | idéntica | idéntica |
| `POST /token {}` | 401, 87 B, `9ada8447…` | idéntica | idéntica |
| `POST /token` con contraseña mala | 401, 87 B, `9ada8447…` | idéntica | idéntica |
| `POST /messages/seen/999999` cuerpo `1` | 404, 93 B, `0186dfe1…` | idéntica | idéntica |
| `GET /products/999999999999999999999` | 404, 106 B, `9f280308…` | idéntica | idéntica |
| Q1 `/products?search=name:a;status:publish&searchJoin=and&limit=5&page=2` | 200, 5228 B, `78ec6f21…` | idéntica | idéntica |
| Q2 `/products?orderBy=created_at&sortedBy=desc&limit=3` | 200, 3253 B, `9dfb2dc8…` | idéntica | idéntica |
| Q3 `/products?searchJoin=and&with=type;author&search=type.slug:grocery;status:publish&limit=4` | 200, 4296 B, `62d8a6ad…` | idéntica | idéntica |
| Q4 `/shops?search=is_active:1&limit=2&page=1` | 200, 1742 B, `f9f53925…` | idéntica | idéntica |
| Q5 `/categories?parent=null&limit=5&language=en` | 200, 14171 B, `df05df25…` | idéntica | idéntica |
| Q6 `/tags?limit=3&orderBy=name&sortedBy=asc` | 200, 986 B, `c0562be7…` | idéntica | idéntica |
| Q7 `/manufacturers?limit=2&is_approved=true` | 200, 2225 B, `0dc03596…` | idéntica | idéntica |
| Q8 `/users?limit=2&page=1&orderBy=created_at&sortedBy=desc` (admin) | 200, 16025 B, `8ab02df5…` | idéntica | idéntica |
| Q9 `/popular-products?limit=3&language=en` | 200, 2809 B, `f53c43e8…` | idéntica | idéntica |
| Q10 `/products?search=name:apple&search=status:publish&limit=2` (repetido) | 500, 52 B, `fcbda2e2…` | idéntica | idéntica |
| Q11 `/products?search[name]=apple&limit=2` (anidado) | 500, 52 B, `fcbda2e2…` | **200, 2314 B** | 500, 52 B, `fcbda2e2…` |
| Q12 `/products?limit[]=2` (corchetes) | 200, 2316 B, `33d324ce…` | **200, 28938 B** | 200, 2316 B, `33d324ce…` |
| Q13 `/types?orderBy[0][column]=NAME&orderBy[0][order]=ASC` | 200, 6506 B, `d091257f…` | idéntica | idéntica |
| Q14 `/shops?page[x]=2&limit=1` | 200, 1036 B, `8a9f82fe…` | **200, 1149 B** | 200, 1036 B, `8a9f82fe…` |
| `GET /docs` | 200, 3126 B, `20f2dfd8…` | idéntica | idéntica |
| `GET /docs-json` | 200, 178512 B, 169 rutas | 200, 184441 B, 169 rutas | 200, 184441 B, 169 rutas (ver abajo) |

```
$ node api-contract.mjs after-nest11-extended.json   # diff contra before-nest10.json
DIFF GET /docs-json 200 178512 a9e7c906a8b1646c -> 200 184441 c7269d664b474cce
peticiones: 27 distintas: 1
```

**Por qué el parser simple cambia esas tres:** `node:querystring` no
interpreta corchetes. `limit[]` llega como una clave literal `limit[]` y
la API usa el `limit` por defecto (30 productos en vez de 2).
`search[name]` deja de ser un objeto, que hacía fallar `search.split`, y la
búsqueda se ignora. `page[x]` se ignora y la página pasa a ser la 1. Los
parámetros repetidos (Q10) dan un array con los dos parsers, así que no
cambian. Ninguna de las tres es una petición que mande el frontend: sus
`formatSearchParams` arman `search=k:v;k:v` y usan parámetros planos. Pero
D-5 pide que nada cambie, así que se vuelve a `qs`.

**Los errores 401 y 404 mantienen el orden de claves de Nest 10**
(`{message, error, statusCode}`, aceptado en US-77). Los 500 de Q10 y Q11
ya existían en Nest 9 y 10: `parseProductSearch` hace `search.split(';')`
sobre lo que llegue. Ver hallazgos.

**`/docs-json` cambia por `@nestjs/swagger` 11, no por Express.** Mantiene
las 169 rutas y las 254 operaciones. Lo que cambia (comparado contra la
API de Nest 10 que corre en el árbol principal, con el mismo sha
`a9e7c906…`):

- **Las 254 operaciones llevan ahora `tags`** con el nombre del
  controlador. Es la opción `autoTagControllers`, que viene activada por
  defecto, y la UI de `/docs` las agrupa por controlador. Se puede apagar
  con `SwaggerModule.createDocument(app, config, { autoTagControllers:
  false })`.
- **El orden de las claves cambia** (`{type, enum}` en vez de `{enum,
  type}` en 31 parámetros, y el orden de los arrays `required` en 7 DTOs).
  El contenido es el mismo.
- **Tres parámetros se documentan de otra forma.** El `orderBy` de
  `/attributes` y `/types` pasa de dos parámetros `column`/`order`
  aplanados a un array de `$ref` (aparecen los schemas
  `QueryAttributesOrderByOrderByClause` y `QueryTypesOrderByOrderByClause`).
  El `parent` de `/categories` pasa a ser un `allOf` de un schema `Object`
  vacío. `Ai.status` gana su `enum` y `BusinessPurposeItem` pone el
  `required` donde lo pide OpenAPI.
- **El contrato de become-seller no cambia.** Ninguno de los schemas que
  cambian es de los que comprueba `openspec/specs/become-seller-contract-types`.

Nada de eso llega al shop ni al admin: ninguno de los dos lee
`/docs-json` (`grep`: solo aparece en `openspec/`). Por eso **se acepta
sin neutralizar**. Si el dueño prefiere el documento sin `tags`, basta la
opción de arriba; el resto de las diferencias no se puede apagar.

Swagger con Nest 11:

```
GET http://localhost:9011/docs       -> 200, 3126 B (idéntica a Nest 10)
GET http://localhost:9011/docs-json  -> 200, 184441 B, 169 rutas
```

### CA-3 — El frontend sigue funcionando

**Cumple. Verificado al integrar el 2026-10-24.** El worktree no tenía
`.env` ni frontend, así que este CA se verificó en `main`, ya con US-78 y
US-80 integradas: la API en Nest 11.2.7 en el 9001 y el shop y el admin en
Next 14.2.35.

```
$ cd apps/api/rest && yarn install --frozen-lockfile   # nest 11.2.7, uuid 11.1.1
$ just build-api                                       # Done in 74.48s
$ npx jest
Test Suites: 34 passed, 34 total
Tests:       565 passed, 565 total

$ just verify
OK   API    :9001/api/settings  200  5503B  577ms
OK   Shop   :3003/en  200  190630B  742ms  cards:30
OK   Admin  :3002/en/login  200  72685B  80ms  cards:1
```

El shop (190630 B) y el admin (72685 B) dan **los mismos bytes** que midió
US-80 con la API en Nest 10, así que el frontend no ve ningún cambio de la
API.

**Rutas de humo, en un contexto del navegador sin sesión previa:**

| Ruta | Resultado |
|---|---|
| shop `/shops` | 200, 12 enlaces a tiendas |
| shop `/shops/grocery-shop` | 200, 30 `product-card` (ver nota) |
| shop `/products/apples` | 200, `<title>Pickbazar \| Apples</title>` |
| API `products?search=type.slug:grocery;status:publish` | 200, `total` 436 |
| API `products?orderBy=price&sortedBy=asc&limit=3` | 200, 3 de 1199 |
| API `products?limit=10&page=2` | 200, 10 de 1199 |
| admin login (`admin@demo.com`) | crea la cookie `AUTH_CRED` (JWT con `expiresIn`, ver el ajuste de `jwt-options.ts`) |
| admin `/` | «Super Admin», Total Revenue $3,538.01, Total Order 20 |
| admin `/products` | 20 filas; `products?…&orderBy=created_at&sortedBy=desc` y los 4 catálogos de filtros, todos 200 |
| admin `/orders` | 20 filas; `orders?…&orderBy=created_at&sortedBy=desc` 200 |

**Consola del admin:** solo aparecen mensajes que ya existían antes de esta
US (ver US-80). Son el WebSocket de Pusher con `your-pusher-app-key`, el
`Invalid href 'http://localhost:3003//'` y el `expandedRowRender should not
use with nested Table`.

**Notas:**

- El primer `GET /shops/grocery-shop` dio 500. El shop arrancó a la vez que
  la API, y su log muestra `GET http://localhost:9001/api/shops failed after
  3 attempts: ECONNREFUSED`. Con la API arriba, `grocery-shop`, `gadget` y
  `bakery-shop` dan 200. No es una regresión: es el orden de arranque que
  ya avisa `CLAUDE.md` («SIEMPRE la API primero»).
- `search=categories.slug:fruits-vegetables` da `total` 0, pero porque
  `category_product` tiene 0 filas en el seed (`select count(*) from
  category_product` → 0), no por el parser de query strings.

### Decisiones

- **Parser de query strings: `'extended'`** (`app.set('query parser',
  'extended')` en `main.ts`). Con el parser simple de Express 5 cambian 3
  de las 14 peticiones con query string (Q11, Q12 y Q14). Con `'extended'`
  vuelven a ser iguales byte a byte.
- **DA-6: propuesta por defecto (a), con 20.11 en vez de 20.9.** `just
  doctor` marca `VIEJO` si Node es anterior a la 20.11, que es el mínimo
  del `engines` de `@nestjs/cli` 11.0.24. Esta US ya lo exige, y cubre
  también el 20.9 que pedirá Next 16 (US-82). Se mantiene el estilo de la
  receta: informa y no corta la ejecución, igual que con los `.env` y los
  `node_modules` que faltan.

  ```
  $ just doctor | head -1
  node    v22.14.0 OK
  # lógica probada con versiones simuladas: 18.20.4 VIEJO, 20.9.0 VIEJO, 20.11.0 OK, 22.14.0 OK
  ```

- **`/docs-json`:** se aceptan los cambios de `@nestjs/swagger` 11 (ver
  CA-2). **El dueño lo confirmó el 2026-10-24**, con los `tags` por
  controlador incluidos.

### Desvíos

- **`uuid` es una dependencia fantasma de la API.**
  `src/payment/paypal-payment.service.ts` importa `uuid`, pero no está en
  `package.json` ni en `apps/api/rest/yarn.lock`. En el árbol principal se
  resuelve subiendo directorios hasta `apps/node_modules/uuid` (11.1.1, del
  workspace del frontend). En un worktree limpio no lo encuentra:
  `yarn build` y la suite `orders.service.spec.ts` fallan con `TS2307:
  Cannot find module 'uuid'` (33 suites / 538 tests). Para medir se copió
  `uuid` 11.1.1 a `apps/node_modules/` del worktree. Está ignorado por git y
  no se commitea. Con eso, la línea base da 34 suites / 565 tests. Arreglarlo
  no es de esta US (ver hallazgos).
- **`packages/db` necesita `DATABASE_URL` también para construirse.**
  `prisma generate` carga `prisma.config.ts`, que falla con
  `PrismaConfigEnvError` si falta la variable. Se pasó en línea.

### Hallazgos fuera de scope

- **`uuid` sin declarar** (ver desvíos). La API dependía de que el workspace
  del frontend estuviera instalado y siguiera trayendo `uuid`. **Corregido
  el 2026-10-24 por decisión del dueño**, en un commit aparte de esta US
  (`d27d9f6`, «Declara uuid como dependencia de la API»): `"uuid":
  "^11.1.1"`, la misma versión que se usaba. Con eso, `require.resolve('uuid')`
  apunta a `apps/api/rest/node_modules/uuid`. Además, `npx jest` da 34
  suites / 565 tests, `yarn build` termina bien y el lint queda en 0.
- **Nombre duplicado de DTO en Swagger.** Con swagger 11, el arranque
  avisa: `Duplicate DTO detected: "RefundPolicyPaginator" is defined
  multiple times with different schemas … This will throw an error in the
  next major version`. `src/ownership-transfer/dto/get-ownership-transfer.dto.ts:6`
  declara `RefundPolicyPaginator` (copiado de `refund-policies`) para
  `OwnershipTransfer`. **Puede romper el arranque en US-79** (swagger 12):
  conviene renombrarlo allí o antes.
- **500 con `search` repetido o anidado.** `?search=a&search=b` o
  `?search[x]=y` dan 500 (`search.split is not a function`) desde Nest 9.
  No cambia con esta US. Es candidato a una validación de query.

## Notas para el agente ejecutor

- Lee con Context7 la guía oficial de migración a v11 y la de Express 5
  antes de tocar código.
- Si el parser simple cambia algún resultado, la salida conservadora es
  volver a `qs` (`'query parser', 'extended'`). Anótalo como decisión en la
  US.
