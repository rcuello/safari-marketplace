# US-84 — react-query 3 → @tanstack/react-query 5 en el shop

> `react-query` 3.39.3 ya no recibe versiones. Su sucesor es
> `@tanstack/react-query`, cuya última es la 5.104.5. Esta US migra el shop,
> que tiene menos superficie que el admin, y deja el patrón para US-85.

**Épico:** [Épico 75](./README.md)
**Fecha:** 2026-10-24
**Status:** Implementada (2026-10-24)
**Depende de:** US-80 (puede ir antes o después de US-82 y US-83)
**LOC est.:** ~300

## Historia

**Como** mantenedor del shop, **quiero** la capa de datos del cliente en
TanStack Query 5, **para** salir de una librería abandonada.

## Contexto — verificado (2026-10-24)

- 42 archivos de `apps/shop/src` importan de `'react-query'`, todos bajo
  `src/framework/rest/`, con 44 llamadas a `useQuery(`, `useInfiniteQuery(`
  o `useMutation(`. 19 archivos usan `dehydrate`.
- `@tanstack/react-query@5.104.5` pide `react ^18 || ^19`, así que no
  depende de US-83.
- El proveedor está en `apps/shop/src/framework/rest/client/query-provider.tsx`,
  con `QueryClientProvider` y `Hydrate`. El SSR usa `dehydrate` en los
  `getStaticProps`/`getServerSideProps`.
- La variante GraphQL del shop (`src/framework/graphql`) no importa
  `react-query` (0 archivos). Queda fuera (DA-4 del épico).
- 2 archivos (entre el shop y el admin) importan `react-query/devtools`.

## Scope

**Incluye:**

- sustituir `react-query` por `@tanstack/react-query` 5 en
  `apps/shop/src/framework/rest/**` y donde se importe;
- los cambios de API de la v5:
  - la firma de objeto única en `useQuery` y `useMutation`;
  - `Hydrate` → `HydrationBoundary`;
  - `cacheTime` → `gcTime`;
  - `isLoading` → `isPending` donde corresponda;
  - `keepPreviousData` → `placeholderData`;
  - los `onSuccess`/`onError` de `useQuery`, que ya no existen;
- `@tanstack/react-query-devtools` solo si hoy se usan las devtools.

**NO incluye:**

- el admin (US-85);
- cambiar claves de caché, tiempos o la estrategia de SSR más allá de lo
  que exige la v5.

## Criterios de aceptación

### CA-1 — Sin la librería vieja

`grep -r "from 'react-query'" apps/shop/src` da 0. `react-query` sale de
`apps/shop/package.json`.

### CA-2 — Mismo comportamiento

Las rutas de humo funcionan. Ponen a prueba la paginación infinita de
productos, el SSR de una página de tienda (el HTML ya trae los productos:
`just verify` cuenta las `product-cards`), el carrito y el login. La consola
no muestra avisos nuevos.

### CA-3 — Mutaciones

Al menos dos mutaciones se ejercitan de punta a punta: una pregunta o una
reseña, y actualizar el perfil. Cada una invalida su caché y la pantalla se
actualiza sin recargar.

## Escenarios Gherkin

```gherkin
Feature: Shop en TanStack Query 5
  Scenario: CA-2 — el SSR sigue sirviendo productos
    Given el shop migrado
    When se pide una página de tienda sin JavaScript
    Then el HTML trae las product-cards
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `apps/shop/package.json`, `apps/yarn.lock` | dependencia |
| `apps/shop/src/framework/rest/**` | hooks y proveedor |
| `apps/shop/src/pages/**` | `dehydrate`/`HydrationBoundary` en el SSR |

## Definición de Done

- [x] Línea base (`just verify`, consola de las rutas de humo).
- [x] CA-1..CA-3 con la salida pegada (CA-3: el perfil, con la salvedad
      que explica «Resultado»).
- [x] `yarn lint` del shop sin hallazgos nuevos y `tsc --noEmit` sin
      superar su línea base.
- [x] Status actualizado aquí. La tabla del épico la actualiza quien
      integra.

## Notas para el agente ejecutor

- Lee con Context7 la guía oficial *Migrating to TanStack Query v5*. Valora
  el codemod oficial, y revisa su diff a mano.
- R-1: `react-query` lo sigue usando el admin hasta US-85. No lo quites de
  `apps/yarn.lock` a mano.

## Resultado — ejecutado el 2026-10-24

Rama `us-84-tanstack-shop`. El shop deja `react-query` 3.39.3 y pasa a
`@tanstack/react-query` 5.104.1. CA-1 y CA-2 se cumplen. En CA-3 la pregunta
se cumple de punta a punta. El perfil recorre la mutación entera, pero la API
contesta 403 y no guarda nada, igual que con react-query 3 (ver CA-3).

### Versiones

| Paquete | Antes | Después | Publicada |
|---|---|---|---|
| `react-query` | 3.39.3 | sale de `apps/shop/package.json` (sigue en el lockfile por el admin, R-1) | — |
| `@tanstack/react-query` | — | **5.104.1** | 2026-10-02 |
| `@tanstack/react-query-devtools` | — | **5.104.1** (el shop ya usaba `ReactQueryDevtools`) | 2026-10-02 |

Es la última 5.x con más de dos semanas (`npm view @tanstack/react-query time
--json`). La 5.104.2 salió el 2026-10-11, y la 5.104.5 (la que cita la US) el
2026-10-19. Peers (`npm view …@5.104.1 peerDependencies`): `react ^18 || ^19`,
y las devtools piden además `@types/react ^18 || ^19` (hay 18.3.12) y
`@tanstack/react-query ^5.104.1`. Las dos versiones van exactas en el
manifiesto, como el resto del shop. No hizo falta `--force` ni
`--legacy-peer-deps`.

`yarn install` da un aviso nuevo de peer: `@tanstack/query-devtools >
goober@2.1.19 has unmet peer dependency "csstype@^3.0.10"`. No tiene efecto,
porque `apps/node_modules/csstype` está en la 3.2.3 (llega con `@types/react`).
Es la forma en que yarn 1 cuenta los peers transitivos, y no se declaró nada
para callarlo.

### Commits

| Commit | Qué |
|---|---|
| `3760bbc` | `apps/shop/package.json` y `apps/yarn.lock` (2 archivos, +249 −4) |
| `4cb8db1` | La migración del código (50 archivos, +984 −876) |
| (este) | El doc |

### Guías leídas (Context7)

Se leyó *Migrating to TanStack Query v5* (`/tanstack/query`) y *Migrating to
React Query 4* (`/websites/tanstack_query_v4`), porque el salto cruza dos
mayores. Lo que aplica al shop:

- **v4:** el paquete pasa a `@tanstack/react-query` y `react-query/hydration`
  se integra en él; las claves tienen que ser arrays (el shop ya usaba arrays
  en las consultas, pero no en los `invalidateQueries`/`refetchQueries`);
  `undefined` deja de ser un dato válido.
- **v5:** firma de objeto única; `Hydrate` pasa a `HydrationBoundary`;
  `keepPreviousData` pasa a `placeholderData: keepPreviousData`; `isLoading`
  de las mutaciones pasa a `isPending`; `useQuery` pierde `onSuccess`,
  `onError` y `onSettled`; las consultas infinitas exigen `initialPageParam`;
  `cacheTime` pasa a `gcTime`. El shop no usa `cacheTime`, así que esto
  último no aplica.

### El codemod oficial: evaluado y descartado

Se corrieron los codemods que trae el paquete
(`build/codemods/v4/replace-import-specifier`, `v4/key-transformation`,
`v5/remove-overloads`, `rename-hydrate`, `keep-previous-data`, `is-loading` y
`rename-properties`) con `jscodeshift@17.4.0` sobre `src/framework/rest`.
Se revisó el diff a mano (41 archivos) y **se descartó entero**, por cuatro
razones:

1. `remove-overloads` falló con *"An unknown error occurred"* en una docena
   de archivos (`*.ssr.ts`, `become-seller.ts`…), y `keep-previous-data` en
   otros tantos. `replace-import-specifier` dejó un archivo temporal por un
   `EBUSY` de Windows.
2. Donde funcionó, **quitó los genéricos** (`useQuery<Product[], Error>(` →
   `useQuery({`), así que cambiaban los tipos de `data` y `error`.
3. `is-loading` renombró `isLoading` → `isPending` **también en las
   consultas, y en lo que devuelven los hooks del shop** (`return {
   isPending }`). Los componentes leen `isLoading` de esos hooks, así que
   habrían recibido `undefined` sin que `tsc` lo detectara. Y en las consultas
   desactivadas `isPending` se queda en `true`, con lo que habría spinners
   colgados.
4. Reformateó los archivos sin respetar su estilo.

En su lugar se usó un script con la API de compilador de TypeScript. Solo
cambia la forma de las llamadas: conserva los genéricos y el texto de cada
argumento, y aplica primero las ediciones más internas, porque hay
`invalidateQueries` dentro de los `onSuccess`. El resto se hizo a mano.
Después se formateó cada archivo con el prettier del repo (2.4.0 o 3.3.3) que
menos altera su versión de `HEAD`. Los archivos ya venían con formatos
mezclados, y así el diff no trae ruido de formato.

### Cambios de código (`4cb8db1`)

| Cambio | Dónde | Nota |
|---|---|---|
| Imports a `@tanstack/react-query` y `@tanstack/react-query-devtools` | 42 archivos de `src/framework/rest` | Un solo import por archivo (los `*.ssr.ts` traían dos, uno de ellos de `react-query/hydration`) |
| `Hydrate` → `HydrationBoundary` | `client/query-provider.tsx` | `dehydrate` sigue igual en los 19 SSR |
| Firma de objeto | 21 `useQuery`, 20 `useInfiniteQuery`, 39 `useMutation`, 30 `prefetchQuery`, 11 `prefetchInfiniteQuery` y 4 `fetchQuery` (conteo con `git grep` sobre `2d94798`) | Se conservan claves, genéricos y opciones |
| Claves con array | 22 `invalidateQueries`/`refetchQueries` que recibían un string | `invalidateQueries({ queryKey: [API_ENDPOINTS.CARDS] })`. En v3, `'x'` y `['x']` daban el mismo hash, así que el prefijo invalidado no cambia |
| `initialPageParam: undefined` | 31 consultas infinitas (20 hooks y 11 prefetch del SSR) | Es el mismo primer `pageParam` que en v3. El HTML lo serializa igual (`pageParams: [null]`, ver CA-2) |
| `getNextPageParam`: `cond && {...}` → `cond ? {...} : undefined` | las 20 | **Regresión que habría pasado `tsc`:** en v5 `hasNextPage` es `getNextPageParam(...) != null`, y `false` contaría como "hay otra página". v3 excluía `false` a propósito |
| `keepPreviousData: true` → `placeholderData: keepPreviousData` | `product.ts` (preguntas), `review.ts`, `store-notices.ts` | |
| `isLoading` de mutación → `isPending` | 28 en `src/framework/rest` y 8 en componentes | Se escribe `isPending: isLoading` al desestructurar, así los hooks del shop **conservan su contrato** (`{ isLoading }`) y ningún componente cambia de forma. Donde ya había un alias (`isLoading: resetting`), pasa a `isPending: resetting` |
| `isLoading` de consulta | sin cambios | En v5 es `isPending && isFetching`, lo mismo que en v3 (`status: 'loading'`; las desactivadas estaban en `idle`) |
| `onSuccess`/`onError` en `useQuery` | `useUser` (`user.ts`) | Pasan a dos `useEffect`, sobre `data` y sobre `error`, con el mismo cuerpo |
| `onSuccess` en `useQuery` | `useGetPaymentIntent` y `useGetPaymentIntentOriginal` (`order.ts`) | Son consultas `enabled: false` que solo corren con `refetch`. Un efecto sobre `data` no se repetiría si un segundo `refetch` trae el mismo dato (el *structural sharing* conserva la referencia), así que el efecto va dentro de la función que se expone: `await refetch()` y, si `isSuccess`, abre el modal o redirige. Quien llama (`pay-now-button`, `gateway-modal`) ya hace `await getPaymentIntentQuery()` |
| `pageParam` en `useQuery` no infinitas | `settings.ts`, `store-notices.ts` | v5 no lo pasa a esas consultas, y en v3 siempre valía `undefined`. Se quita |
| Casts de las opciones | `question.ts`, `report.ts`, `wishlist.ts`, `order.ts` (descargas), `flash-sales.ts`, `settings.ts`, `store-notices.ts` | v5 tipa `pageParam` como `unknown`, y `Object.assign({}, queryKey[1], pageParam)` daba `{}`. Se usa el patrón que ya había en el repo (`queryKey[1] as XQueryOptions`). Sin `any` ni `@ts-ignore` nuevos |
| Genéricos explícitos | `useTags` y `useRefunds` (`<TagPaginator, Error>`, `<RefundPaginator, Error>`) | Sin genéricos, `initialPageParam: undefined` fijaba `TPageParam = undefined` y `getNextPageParam` no tipaba. Son los mismos tipos que ya devolvía el cliente |

No cambian las claves de caché, los tiempos ni la estrategia de SSR. Los
comentarios que había dentro de las opciones se conservan; el primer pase del
script los perdía y se repusieron (se comparó cada línea de comentario
borrada con las añadidas).

### Línea base (react-query 3.39.3, `main` @ `2d94798`)

```
$ just verify
OK   API    :9001/api/settings  200  5503B  554ms
OK   Shop   :3003/en  200  190630B  1069ms  cards:30
OK   Admin  :3002/en/login  200  72685B  25146ms  cards:1
$ cd apps/shop && yarn lint
✔ No ESLint warnings or errors
$ cd apps/shop && ./node_modules/.bin/tsc --noEmit
9 error TS2786          (los 9 heredados, todos "'Element' cannot be used as a JSX component")
```

### CA-1 — Sin la librería vieja ✅

```
$ grep -r "from 'react-query" apps/shop/src | wc -l
0
$ grep -rn "react-query" apps/shop/src | grep -v "@tanstack/react-query" | wc -l
0
$ grep -c '"react-query"' apps/shop/package.json
0
$ grep -c '^react-query@3.39.3' apps/yarn.lock      # el admin lo sigue usando (R-1)
1
```

### CA-2 — Mismo comportamiento ✅

```
$ just verify      (después)
OK   API    :9001/api/settings  200  5503B  457ms
OK   Shop   :3003/en  200  190927B  97553ms  cards:30
OK   Admin  :3002/en/login  200  72685B  16102ms  cards:1
```

**SSR** (Gherkin: el HTML sin JavaScript trae las product-cards). Se comparó
el `__NEXT_DATA__` de `curl` antes y después:

| Página | HTML (bytes) | `dehydratedState` (chars) | Consultas | `product-card` | `queryHash` y `data` iguales | Resto de `pageProps` igual |
|---|---|---|---|---|---|---|
| `/en` | 190637 → 190934 | 74117 → 74363 | 5 → 5 | 30 → 30 | sí | sí |
| `/en/products/apples` | 110194 → 110285 | 5865 → 5905 | 1 → 1 | 19 → 19 | sí | sí |
| `/en/shops/gadget` | 179035 → 179189 | 37502 → 37605 | 2 → 2 | 30 → 30 | sí | sí |

Los bytes que crecen son metadatos de la v5 en cada consulta: `dehydratedAt`,
y en `state` entran `fetchFailureReason` y `fetchStatus` y salen `isFetching`
e `isPaused`. Los datos son idénticos, y las consultas infinitas siguen
serializando `pageParams: [null]` (en v3, igual).

**Humo en el navegador** (chrome-devtools, contextos aislados nuevos). Aparte
de `[info] React DevTools` y `[log] [HMR] connected`:

| Ruta | react-query 3 (base) | TanStack Query 5 |
|---|---|---|
| `/` + «Load More» | 30 → 60 cards; `[warn]` LCP; `[issue]` form field, autocomplete | 30 → 60 cards; sin avisos nuevos |
| `/shops/gadget` (44 productos) + «Load More» hasta el final | 30 → 44 y **el botón desaparece**; `[warn]` LCP; `[issue]` form field | 30 → 44 y el botón desaparece (prueba de `getNextPageParam`); `[warn]` LCP |
| `/shops` | 12 tiendas; `[issue]` autocomplete, form field | 12 tiendas; `[issue]` autocomplete |
| `/products/apples` + añadir al carrito + abrirlo | «1 Item $1.60»; `[warn]` LCP ×2, width/height; `[issue]` lazy images, form field | igual, más `[warn]` `FocusTrap` al abrir el cajón (ya estaba en la base de US-80 con el carrito abierto) |
| login (`customer@demo.com`) | cookies `auth_token` y `AUTH_CRED_SHOP`, modal cerrado | igual |
| `/checkout` | Contact Number, Billing Address, Your Order con Apples; `[warn]` LCP; `[issue]` form field, label | igual |
| `/profile` | 28 `[warn] Skipped "N" because it is not a valid MIME type / invalid file extension` (react-dropzone) | los mismos 28 |
| admin login + `/` (R-1) | (base de US-80) Pusher, `Invalid href` ×2, `expandedRowRender` | Pusher, `Invalid href 'http://localhost:3003//'` ×2, `expandedRowRender`; 26 filas |

Los `[issue]` de Chrome (form field, autocomplete) salieron menos veces en el
recorrido de después. Son avisos de accesibilidad de Chrome, que los agrupa
por sesión; que salgan menos no es un arreglo.

**Un aviso intermitente, no atribuible a la migración:** en una carga de
`/products/apples` (con sesión y carrito) apareció una vez `Image with src
".../Apples-thumbnail.jpg" has "fill" but is missing "sizes" prop`. Es la
miniatura del carrusel de la galería (`swiper-slide`, `sizes="100vw"`).
`next/image` solo avisa cuando la imagen carga ocupando menos del 60 % del
ancho de la ventana, lo que depende de si swiper ya maquetó la diapositiva. No
se reprodujo en tres cargas más con la v5, ni en tres con la v3 (se volvió a
la v3 con `git stash` sobre el mismo servidor). Queda anotado como ruido de
timing de `next/image` y swiper.

### CA-3 — Mutaciones

**1. Pregunta (`useCreateQuestion`) ✅.** En `/products/apples`, con
`customer@demo.com`: «Ask seller a question», se escribe *«Pregunta de prueba
US-84 (TanStack Query 5)»* y se envía con `button.click()` desde
`evaluate_script`. Antes se marcó la página con `window.__us84 =
'sin-recarga'`.

```
{"header":"Questions and Answers (7)","dialog":false,"sinRecarga":"sin-recarga","navEntries":1,
 "listed":true,"toast":"Successfully submitted the question. Please wait for the seller to respond."}

reqid=228 POST http://localhost:9001/api/questions [201]
reqid=230 GET  http://localhost:9001/api/questions?searchJoin=and&product_id=1&limit=5&page=1&search= [200]
```

El contador pasa de 6 a 7 y la pregunta aparece en la lista sin recargar (la
marca de `window` sigue). Lo hace el `refetchQueries({ queryKey:
[API_ENDPOINTS.PRODUCTS_QUESTIONS] })` del `onSettled`. La consola no muestra
avisos nuevos.

**2. Perfil (`useUpdateUser`): la mutación se ejercita, pero la API no deja
ver un cambio en pantalla.** En `/profile`, el nombre pasa a «Customer US84» y
se pulsa «Save»:

```
reqid=281 PUT http://localhost:9001/api/users/2 [403]
  {"message":"No tienes permisos suficientes para esta operación.","error":"Forbidden","statusCode":403}
reqid=283 GET http://localhost:9001/api/me [304]      <- el onSettled invalida USERS_ME y la consulta se repite
toast: "Something went wrong"                         <- onError
window.__us84 === 'sin-recarga'
```

La mutación hace todo su recorrido en la v5: la petición, el `onError` con
su toast y el `onSettled`, que invalida `USERS_ME` y lanza de nuevo `GET
/api/me` sin recargar. **Se repitió con react-query 3** (`git stash` sobre el
mismo servidor, en otro contexto aislado) y el resultado es idéntico: `PUT
/api/users/2 [403]`, `GET /api/me` y el mismo toast.

No hay cambio visible por dos razones de la API, ninguna de esta US:

- `PUT /api/users/:id` responde 403 a un `customer`: la ruta pide un permiso
  que ese rol no tiene.
- Aunque pasara el guard, `UsersService.update`
  (`apps/api/rest/src/users/users.service.ts:124-137`) **no escribe nada**:
  ignora el DTO y devuelve el usuario tal como está.
- Las otras mutaciones del perfil tampoco sirven para probarlo. `POST
  /api/update-email` no existe en la API, y el contacto pasa por el flujo de
  OTP.

**Reversión de la base:**

```
# la pregunta de prueba se borró por la API, como admin
$ curl -X POST :9001/api/token -d '{"email":"admin@demo.com","password":"demodemo"}'   -> token
$ curl -X DELETE :9001/api/questions/101 -H "authorization: Bearer <token>"            -> DELETE 200
$ psql: select count(*), max(id) from questions      -> 68 | 68   (igual que antes de la prueba)
$ curl ':9001/api/questions?product_id=1&limit=5'     -> total 6

# el perfil no se tocó: users.updated_at y profiles.updated_at de id=2 siguen en
# 2026-10-24 01:32:04.670133+00; name "Customer", bio "", contact 19365141641631
```

La secuencia de `questions` quedó en 101. Es un hueco de id, sin efecto.

### Lint y tipos ✅

```
$ cd apps/shop && yarn lint
✔ No ESLint warnings or errors
$ cd apps/shop && ./node_modules/.bin/tsc --noEmit
9 error TS2786           -> diff contra la salida de la línea base: idéntica, línea a línea
```

### Decisiones que US-85 (admin) puede reutilizar

1. **No usar el codemod.** Por las razones de arriba, sobre todo `is-loading`,
   que rompe sin avisar los hooks que devuelven `isLoading`. El script de AST
   (solo la forma de las llamadas, conservando los genéricos) y la revisión a
   mano dieron un diff limpio.
2. **`getNextPageParam` con `&&`:** el admin tiene que buscar el mismo patrón,
   porque pasa `tsc` y rompe `hasNextPage`.
3. **`isPending: isLoading`** al desestructurar las mutaciones, para no
   cambiar el contrato de los hooks propios.
4. **`initialPageParam: undefined`** para mantener el primer `pageParam` y el
   `dehydratedState` de v3. Si una consulta infinita no tiene genéricos, hay
   que añadirlos.
5. **`onSuccess` de `useQuery` con `enabled: false`:** el efecto va tras el
   `refetch`, no en un `useEffect` sobre `data`.
6. Al formatear, conviene usar el prettier que respete cada archivo. El hook
   PostToolUse formatea con el 2.4.0, y muchos archivos venían con el 3.3.3.
7. Al quitar `react-query` del admin, el lockfile lo soltará solo. Las
   devtools del admin (`admin/rest/src/pages/_app.tsx`) ya tienen
   `@tanstack/react-query-devtools` 5.104.1 en el workspace.

### Desvíos

- Se tocaron 8 componentes fuera de `src/framework/rest/**` y de
  `src/pages/**`, porque usan directamente el resultado de `useMutation` (el
  hook lo devuelve tal cual): `address/delete-view`, `auth/forgot-password`,
  `notifications/header-notification-icon`, `profile/profile-form`,
  `profile/profile-update-email`, `settings/subscribe-to-newsletter`,
  `settings/super-admin-contact-form` y `settings/vendor-contact-form`. En
  cada uno cambia una sola línea (`isLoading` → `isPending: isLoading` o
  `isPending: alias`).
- `src/pages/**` no hizo falta tocarlo: el SSR vive en
  `src/framework/rest/*.ssr.ts`.
- Durante la US, la API de desarrollo (`just api-dev`) dejó de escuchar en el
  9001 tras varias recompilaciones del watcher de Nest (22:01–22:02), sin
  error en el log ni cambios en `apps/api/rest/src` del árbol principal. Se
  reinició, y también el shop, porque el `getStaticPaths` de
  `/shops/[slug]` había quedado con el 500 de `ECONNREFUSED`. No se investigó
  más: es de la API, y en paralelo corría US-88 en otro worktree.
- Al empezar había un `node` ajeno sirviendo `apps/api/rest/dist/main` en el
  9001 (PID 33180, de una sesión anterior). Se terminó para levantar la API
  con `just api-dev`.

### Fuera de scope (siguen, no se tocaron)

- El perfil del shop no puede guardarse: `PUT /api/users/:id` da 403 a un
  `customer`, `UsersService.update` no persiste y `POST /api/update-email` no
  existe. Es de la API (otra US).
- `useUser` y los dos hooks de payment intent tenían efectos que en v3 corrían
  una vez por observador. Se mantuvo esa semántica. Que `useUser` lo usen
  muchos componentes a la vez (y cada uno pueda llamar a `router.reload()`)
  ya pasaba antes.
- El flujo de pago (payment intent) se tipó y se revisó, pero no se recorrió
  en el navegador: el checkout de órdenes es mock en la API.
- Los avisos LCP de `next/image`, `FocusTrap`, los `[issue]` de formulario de
  Chrome, los 28 `Skipped "N"` de react-dropzone en `/profile`, y en el admin
  Pusher, `Invalid href 'http://localhost:3003//'` y `expandedRowRender`.
- `CLAUDE.md` dice que `questions` y `reviews` son JSON mock, pero hoy van a
  Postgres (`questions.service.ts` usa `createQuestion`/`deleteQuestion` de
  `@safari/db`). Conviene corregirlo al integrar.
