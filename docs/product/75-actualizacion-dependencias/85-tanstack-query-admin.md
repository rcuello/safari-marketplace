# US-85 — react-query 3 → @tanstack/react-query 5 en el admin

> Repite en el admin la migración de US-84, siguiendo su patrón. El admin
> tiene casi el triple de llamadas, sobre todo mutaciones de los formularios
> de gestión.

**Épico:** [Épico 75](./README.md)
**Fecha:** 2026-10-24
**Status:** Implementada (2026-10-24)
**Depende de:** US-84
**LOC est.:** ~450

## Historia

**Como** mantenedor del admin, **quiero** el admin en TanStack Query 5,
**para** quitar `react-query` del workspace.

## Contexto — verificado (2026-10-24)

- 38 archivos de `apps/admin/rest/src` importan de `'react-query'` (35 en
  `src/data/`, 2 en `src/components/` y 1 en `src/pages/`), con 119
  llamadas a `useQuery(`, `useInfiniteQuery(` o `useMutation(`.
- Las mutaciones del admin crean, editan y borran productos, tiendas,
  cupones, categorías, etc. Casi todas invalidan una lista y muestran un
  toast.

## Scope

**Incluye:** lo mismo que US-84, aplicado a `apps/admin/rest/src`, y quitar
`react-query` del workspace.

**NO incluye:** admin/graphql (DA-4 del épico), ni cambiar la estrategia de
caché.

## Criterios de aceptación

### CA-1 — Sin la librería vieja

`grep -r "from 'react-query'" apps/admin/rest/src apps/shop/src` da 0, y
`react-query` ya no está en ningún `package.json` de las apps REST.

### CA-2 — CRUD de punta a punta

En el admin, con el usuario `super_admin` del seed, hay que probar cuatro
operaciones: crear, editar y borrar un producto, y editar un cupón. Cada
operación tiene que aparecer en su lista sin recargar. Los datos de prueba
se borran después.

### CA-3 — Humo sin avisos nuevos

Las rutas de humo del admin funcionan y la consola no muestra avisos nuevos.

## Escenarios Gherkin

```gherkin
Feature: Admin en TanStack Query 5
  Scenario: CA-2 — una mutación refresca su lista
    Given el admin migrado
    When el super_admin edita un producto
    Then la lista muestra el cambio sin recargar la página
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `apps/admin/rest/package.json`, `apps/yarn.lock` | dependencia |
| `apps/admin/rest/src/data/**` y donde se importe | hooks y proveedor |

## Definición de Done

- [x] Línea base (consola de las rutas de humo del admin).
- [x] CA-1..CA-3 con la salida pegada (CA-2: editar un producto, con la
      salvedad que explica «Resultado»).
- [x] `yarn lint` del admin sin hallazgos nuevos.
- [x] Status actualizado aquí. La tabla del épico la actualiza quien
      integra.

## Notas para el agente ejecutor

- Reutiliza las decisiones que US-84 anotó. Si alguna no aplica al admin,
  justifícalo.
- Si los 38 archivos no caben en una sesión, se para en un punto estable y
  se pregunta si partir la US (por ejemplo, catálogo por un lado y pedidos y
  usuarios por otro).

## Resultado — ejecutado el 2026-10-24

Rama `us-85-tanstack-admin`. El admin deja `react-query` 3.39.3 y pasa a
`@tanstack/react-query` 5.104.1, la misma versión que el shop (US-84).
`react-query` desaparece del workspace: ya no está en ningún manifiesto
REST ni en `apps/yarn.lock`. CA-1 y CA-3 se cumplen. En CA-2 se cumplen las
cuatro operaciones, pero editar un producto destapó dos fallos previos de la
API y del formulario, que no son de esta US (ver CA-2).

### Versiones

| Paquete | Antes | Después |
|---|---|---|
| `react-query` | 3.39.3 | sale de `apps/admin/rest/package.json` y de `apps/yarn.lock` |
| `@tanstack/react-query` | — | **5.104.1** (exacta, la del shop) |
| `@tanstack/react-query-devtools` | — | **5.104.1** (el admin usa `ReactQueryDevtools` en `_app.tsx`) |

`admin/graphql` no usa `react-query` (0 archivos y 0 menciones en su
`package.json`), así que el lockfile lo soltó por la vía normal: `yarn
install` desde `apps/` (54 s, sin errores, sin `--force`). Además de
`react-query`, salen sus dependencias propias: `big-integer`,
`broadcast-channel`, `detect-node`, `js-sha3`, `match-sorter`, entre otras
(+0 −73 líneas). No entra nada nuevo, porque `@tanstack/*` 5.104.1 ya estaba
por el shop. El único aviso de peers nuevo respecto de `main` es el de
`goober` > `csstype`, que ahora sale también por la rama del admin. Es el
mismo que explicó US-84 y no tiene efecto.

### Commits

| Commit | Qué |
|---|---|
| `4a9fa50` | `apps/admin/rest/package.json` y `apps/yarn.lock` (2 archivos, +3 −73) |
| `4fbaaf0` | La migración del código (139 archivos, +1233 −1039) |
| (este) | El doc |

La migración va en un solo commit porque las dos mitades (los hooks de
`src/data` y los componentes que leen `isPending`) no compilan por separado.

### Guías leídas (Context7)

*Migrating to TanStack Query v5* (`/tanstack/query`) y *Migrating to React
Query 4* (`/websites/tanstack_query_v4`). Se aplica lo mismo que en US-84:
claves en array y paquete nuevo (v4); firma de objeto, `HydrationBoundary`,
`placeholderData: keepPreviousData`, `isPending` en mutaciones, sin
`onSuccess`/`onError` en `useQuery` e `initialPageParam` obligatorio (v5). El
admin no usa `cacheTime`, `useErrorBoundary`, `isPreviousData`, `isIdle`,
`status === 'loading'`, `setQueryData` ni `useIsFetching` (`grep`: 0).

### Las decisiones de US-84, una por una

1. **Sin codemod.** Se reutilizaron los scripts de AST de US-84 con dos
   arreglos que el admin destapó. El primero es que **perdía los
   comentarios** de dentro de las opciones: rearmaba el objeto propiedad a
   propiedad, y en el admin hay 98 `// Always refetch after error or
   success:`. Ahora copia el texto del objeto desde su `{`. Al final se
   comprobó que toda línea de comentario borrada en el diff vuelve a estar
   añadida (`comm` de las dos listas: 0 perdidas). El segundo es que el
   script de consultas infinitas metía `initialPageParam` y reescribía
   `getNextPageParam` en el mismo punto, y si las ediciones se aplicaban en
   otro orden **corrompía el archivo** (salió en `conversations.tsx`). Ahora
   las dos van en una sola edición. Tampoco aceptaba `import type`, que
   ahora pasa con su propio import.
2. **`getNextPageParam`**: las 6 consultas infinitas (`conversations` ×2,
   `faqs`, `flash-sale`, `ownership-transfer`, `store-notice`) usaban `cond
   && {...}` y pasan a `cond ? {...} : undefined`.
3. **`isPending: isLoading`.** En el admin, a diferencia del shop, casi
   todos los hooks devuelven el `useMutation` tal cual, y son los
   componentes los que leen `isLoading`. Fueron **129 sitios en 104
   archivos** (101 componentes y páginas, `become-seller-form` y 2 hooks de
   `src/data`). Se localizaron con los `TS2339 Property 'isLoading' does not
   exist on type 'UseMutationResult…'` de `tsc`, y un script sobre el AST
   reescribió solo ese identificador: `{ isLoading: x }` pasa a `{
   isPending: x }`, `{ isLoading }` a `{ isPending: isLoading }` y
   `m.isLoading` a `m.isPending`. El nombre local no cambia, así que el JSX
   tampoco. En las consultas, `isLoading` no se toca.
4. **`initialPageParam: undefined`** en las 6. Todas traían genéricos
   (`useInfiniteQuery<XPaginator, Error>`), así que no hizo falta añadirlos.
5. **`onSuccess`/`onError` en `useQuery`**: solo los tenía `useMeQuery`
   (`user.ts`). No es una consulta `enabled: false`, así que el patrón que
   aplica es el de `useUser` en US-84: dos `useEffect`, sobre `data` y sobre
   `error`, con el mismo cuerpo. Que lo usen varios componentes a la vez ya
   pasaba en v3, que llamaba al callback una vez por observador.
6. **Formato.** Los 38 archivos que la migración reescribe (`src/data`,
   `_app.tsx` y los dos componentes que importaban `react-query`) se
   formatearon con el prettier (2.4.0 de `apps/` o 3.3.3 del admin) que
   menos altera su versión de `HEAD`. Fueron 29 con el 2.4.0 y 9 con el
   3.3.3. En los 101 componentes con un solo cambio de identificador **no
   se pasó prettier**: el primer pase metía ruido de formato en archivos
   ajenos (`email-update-form` +47 −48, `verify-license`, …), así que se
   restauraron y se reaplicó solo el cambio de `isPending`. El hook
   PostToolUse no intervino, porque no se editó código con Edit/Write.

Además de lo que ya hizo US-84:

- **`pageParam` en consultas no infinitas** (37: las 44 líneas con `queryKey, pageParam` de `main`, menos las 6 infinitas y una comentada): v5 no lo
  pasa, y en v3 siempre valía `undefined`. Se quitó del destructuring y del
  `Object.assign`. Con eso, dos consultas de `store-notice.ts`
  (`getTypeList` y `getUserOrShopList`) pasaban un `{}` a un parámetro `{
  type: string }`. Antes compilaban porque `pageParam` era `any`. Se usó el
  cast `queryKey[1] as { type: string }`, que es el patrón de US-84.
- **`keepPreviousData: false`** en `dashboard.ts` se quita, porque es el
  comportamiento por defecto.
- **Tipos de los `config`** que reciben algunos hooks. `UseQueryOptions` y
  `UseInfiniteQueryOptions` de v5 exigen `queryKey` (y las infinitas también
  `initialPageParam` y `getNextPageParam`), así que `{ enabled: false }` ya
  no tipaba (`store-notices/index.tsx`, `dashboard/shops/store-notices.tsx`).
  Además, `...config` podía pisar el `queryKey` del hook (`TS2783`). Se
  tiparon como `Omit<…, 'queryKey' | 'queryFn' [| 'initialPageParam' |
  'getNextPageParam']>` en `store-notice` (×2), `faqs`, `flash-sale` y
  `ownership-transfer`. El valor que llega es el mismo. Sin `any` ni
  `@ts-ignore` nuevos.

No cambian las claves de caché, los tiempos ni la estrategia de caché.

### Línea base (react-query 3.39.3, `main` @ `f214430`)

La consola se midió con el código y las dependencias de `main` (`git stash`
de la migración y `yarn install --frozen-lockfile` con el lockfile de
`main`), en un contexto aislado nuevo (`us85-base`).

```
$ just verify
OK   API    :9001/api/settings  200  5503B  581ms
OK   Shop   :3003/en  200  190927B  50568ms  cards:30
OK   Admin  :3002/en/login  200  72685B  122ms  cards:1
$ cd apps/admin/rest && yarn lint
✔ No ESLint warnings or errors
$ cd apps/admin/rest && ./node_modules/.bin/tsc --noEmit
error TS2688: Cannot find type definition file for 'minimatch'.
$ cd apps/admin/rest && ./node_modules/.bin/tsc --noEmit --types node,google.maps
src/components/ui/back-to-top/back-to-top.tsx(42,10): error TS2322: …
src/components/ui/date-picker.tsx(75,14): error TS2786: 'DatePicker' cannot be used as a JSX component.
```

**Ojo con `tsc` en el admin:** la línea base sin flags **no revisa el
código**. Muere en el `TS2688` de `minimatch`, el mismo que US-80 arregló en
el shop con `"types"` en su `tsconfig`, y el admin no lo tiene. Así no habría
detectado ni un `isLoading` de mutación. Por eso se midió también con
`--types node,google.maps`, sin tocar el `tsconfig` (fuera de scope). Esos son
los únicos globales que usa el admin (`google-places-autocomplete.tsx`,
`use-location.tsx`). Con esa forma, la línea base es de 2 errores heredados,
y es la que sirvió de red para la migración.

### CA-1 — Sin la librería vieja ✅

```
$ grep -r "from 'react-query" apps/admin/rest/src apps/shop/src | wc -l
0
$ grep -rn "react-query" apps/admin/rest/src | grep -v "@tanstack/react-query" | wc -l
0
$ grep -l '"react-query"' apps/shop/package.json apps/admin/rest/package.json apps/admin/graphql/package.json apps/package.json | wc -l
0
$ grep -c '^react-query@' apps/yarn.lock
0
$ ls apps/node_modules/react-query
ls: cannot access 'apps/node_modules/react-query': No such file or directory
```

### CA-2 — CRUD de punta a punta

Con `admin@demo.com` (`super_admin`) en el contexto aislado `us85-after`.
Antes de cada recorrido se marcó la ventana con `window.__us85` y se navegó
solo en el cliente (enlaces, o `next.router.push` cuando el enlace estaba en
un menú plegado). La marca sigue en pie al final de cada operación y
`performance.getEntriesByType('navigation').length` vale 1, así que no hubo
recargas. Los formularios se enviaron con `button.click()` desde
`evaluate_script`.

| Operación | Petición | Refetch de la lista (lo dispara `invalidateQueries` en `onSettled`) | En la lista, sin recargar |
|---|---|---|---|
| **Crear producto** en `/furniture-shop/products/create` («US85 Producto de prueba», $85, 5 uds.) | `POST /api/products [201]` → id 1413 | `GET /api/products?…shop_id=1…page=1 [200]` | Redirige a la lista. En la página 3 (la API ordena por id e ignora `orderBy=created_at`): `#ID: 1413 US85 Producto de prueba Furniture Simple $85.00 5 Publish` |
| **Editar producto** 971 («PureGrowth Organic Infant Formula», `/medicine/products/…/edit`): precio 45 → 46 | `PUT /api/products/971 [200]`, toast «Successfully updated!» | `GET /api/products/puregrowth-organic-infant-formula [200]` (la clave `products` cubre el detalle); al volver a la lista, `GET /api/products?…shop_id=11… [200]` | `#ID: 971 PureGrowth Organic Infant Formula Medicine Simple $46.00 876 Publish` |
| **Borrar producto** (1414 y 1413, desde el modal «Delete») | `DELETE /api/products/1414 [200]`, `DELETE /api/products/1413 [200]`, toast «Successfully deleted!» ×2 | `GET /api/products?…page=3 [200]` tras cada borrado | Las filas desaparecen: primero queda solo la 1413 y después ninguna con «US85» |
| **Editar cupón** `4OFF` (id 10): importe 4 → 5 | `PUT /api/coupons/10 [200]`, toast «Successfully updated!» | Redirige a `/coupons`: `GET /api/coupons?…page=1 [200]` | `#ID: 10 4OFF $5.00 $160.00 7 months ago in 2 years Approved` |

**La salvedad de editar producto: dos fallos previos, no de la migración.**
La primera edición se intentó sobre el producto de prueba 1413 y no llegó a
ser un `PUT`:

1. **El formulario revienta al enviar:** `TypeError: Cannot read properties
   of undefined (reading 'map')` en `getProductInputValues`
   (`src/components/product/form-utils.ts:258`, `categories.map(...)`, y en
   la línea siguiente `tags.map(...)`). `GET /api/products/:slug` **no
   devuelve `categories` ni `tags`** (`curl`: ninguna de las dos claves está,
   tampoco en un producto del seed como `ash-double-bed`), y el formulario
   las da por arrays. Hay que tocar los dos selectores para que queden
   definidos.
2. **Editar un producto creado desde el admin crea otro.** `product-form.tsx`
   llama a `createProduct` si `initialValues.translated_languages` no incluye
   el idioma actual. El `POST /api/products` guarda `translated_languages =
   ["es"]` (el valor por defecto de la columna) aunque el producto sea `en`,
   así que el «guardar» de la edición mandó otro `POST /api/products [201]`
   (id 1414, «US85 Producto editado») en vez de un `PUT`. Los productos del
   seed traen `["en"]` y sí van por `PUT`.

Ninguno de los dos pasa por react-query: el primero ocurre dentro de una
función pura antes de llamar a `mutate`, y el segundo es la rama `if` del
formulario más el dato que guarda la API. Los dos archivos solo cambian, en
esta US, en el `isPending` de la línea de `useMutation` (`product-form.tsx`:
2 líneas; `form-utils.ts`: sin cambios). **No se reprodujeron con react-query
3.** La conclusión sale del código, no de una segunda corrida. Por eso la
edición se hizo sobre un producto del seed (971), y para que el formulario
enviara se eligió una categoría y una etiqueta y después se quitaron, de modo
que el `PUT` llevara `categories: []` y `tags: []`. Ninguno de los dos se
arregló aquí, porque uno es de la API (fuera de scope) y el otro, del
formulario.

**La base, como estaba.** Antes de empezar se guardó `row_to_json` de
`coupons` id 10 y de `products` id 971, y `count(*), max(id),
max(updated_at)` de `products`. Después:

```
# el PUT del producto 971 cambió price/min_price/max_price (45 -> 46) y updated_at;
# el del cupón 10, amount (4 -> 5) y updated_at. Se devolvieron por SQL:
$ psql: update products set price=45.00, min_price=45.00, max_price=45.00,
          updated_at='2026-10-24 01:32:04.670133+00' where id=971
$ psql: update coupons set amount=4, updated_at='2026-10-24 01:32:04.670133+00' where id=10
$ cmp p971-before.json p971-final.json && echo "971: row_to_json idéntico"
971: row_to_json idéntico
$ cmp coupon10-before.json coupon10-final.json && echo "cupón 10: row_to_json idéntico"
cupón 10: row_to_json idéntico

$ psql: select count(*), max(id), max(updated_at) from products
1200|1259|2026-10-24 01:32:04.670133+00          <- igual que antes
$ psql: select count(*) from products where name like 'US85%'
0                                                 <- 1413 y 1414 borrados desde el admin
$ psql: select count(*) from category_product; select count(*) from product_tag
0 / 0                                             <- los enlaces de 1414 se fueron en cascada
$ psql: select count(*), max(updated_at) from coupons
10|2026-10-24 01:32:04.670133+00
```

La secuencia `products_id_seq` pasó de 1412 a 1414. Es un hueco de id, sin
efecto. (En `furniture-shop` ya había un producto ajeno, `#ID: 1068 TEST`,
de antes de esta US. No se tocó.)

### CA-3 — Humo sin avisos nuevos ✅

```
$ just verify      (después)
OK   API    :9001/api/settings  200  5503B  426ms
OK   Shop   :3003/en  200  190927B  28637ms  cards:30
OK   Admin  :3002/en/login  200  72736B  104ms  cards:1
```

El HTML de `/en/login` crece 51 bytes (72685 → 72736). No se investigó qué
bytes son: el contenido visible es el mismo, y el SSR del admin pinta
`<PageLoader />` mientras carga `useSettingsQuery` (US-80), así que lo más
probable es el marcado del cargador o los chunks referenciados.

Consola, aparte de `[info] React DevTools` y `[log] [HMR] connected`:

| Ruta | react-query 3 (base) | TanStack Query 5 |
|---|---|---|
| `/login` + login | `[issue]` form field; cookie `AUTH_CRED` | `[issue]` form field; cookie `AUTH_CRED` |
| `/` (dashboard) | 22 filas, 8 secciones; Pusher, `Invalid href 'http://localhost:3003//'` ×2, `expandedRowRender`; `[issue]` form field | igual |
| `/products` | 21 filas; Pusher, `Invalid href` ×2; `[issue]` form field, label | igual; además, la página 2 cambia las filas (#1 → #21), que es la prueba de `placeholderData` |
| `/orders` | 21 filas; Pusher, `Invalid href` ×2, `expandedRowRender`; `[issue]` form field | igual |
| `/coupons` | 10 cupones; Pusher, `Invalid href` ×2; `[warn]` width/height ×10 (miniaturas); `[issue]` form field, lazy images | igual |

Durante CA-2, lo único que no estaba en la base es el `TypeError` del
formulario de producto ya explicado. Además salió un `[issue]` *Quirks Mode*
del overlay de errores de Next. Los `404` y `react-i18next:: You will need
to pass in an i18next instance` son de abrir `/products/create`, una ruta
que no existe para `super_admin` (la buena es `/<shop>/products/create`).

### Lint y tipos ✅

```
$ cd apps/admin/rest && yarn lint
✔ No ESLint warnings or errors
$ cd apps/admin/rest && ./node_modules/.bin/tsc --noEmit                         -> idéntica a la base (TS2688)
$ cd apps/admin/rest && ./node_modules/.bin/tsc --noEmit --types node,google.maps -> idéntica a la base (2 errores)
$ cd apps/shop && yarn lint                                                      (R-1, lockfile compartido)
✔ No ESLint warnings or errors
$ cd apps/shop && ./node_modules/.bin/tsc --noEmit
9 error TS2786           -> idéntica, línea a línea, a la salida final de US-84
```

Durante la migración, `tsc --types` pasó de 306 errores (primer pase) a
137, y después a los 2 de la base.

### Desvíos

- **Más archivos que los 38 de la US.** 104 componentes y páginas leen
  `isLoading` del resultado de `useMutation` que devuelve el hook. En cada
  uno cambia un identificador (`isLoading` por `isPending`, conservando el
  nombre local).
- **Doble `yarn install` para la línea base.** El commit de dependencias se
  hizo antes de medir la consola de `main`. Para la base se volvió
  temporalmente al lockfile de `main` y después al de la rama, siempre con
  `--frozen-lockfile`. El árbol quedó en el lockfile de la rama
  (`apps/node_modules/react-query` no existe).
- Al empezar había un `node` ajeno sirviendo `apps/api/rest/dist/main` en el
  9001 (PID 31840). Se terminó para levantar la API con `just api-dev`.

### Fuera de scope (siguen, no se tocaron)

- **`GET /api/products/:slug` no devuelve `categories` ni `tags`**, y el
  formulario de producto del admin revienta al guardar si no se tocan los
  dos selectores (`form-utils.ts:258-259`). Es un contrato de la API (o una
  defensa del formulario). Va para otra US.
- **`POST /api/products` no fija `translated_languages`.** La columna se
  queda en `["es"]`, así que cualquier producto creado desde el admin en `en`
  se «edita» creando otro. Es de la API.
- **La API ignora `orderBy=created_at&sortedBy=desc`** en `/api/products`
  (ordena por id), y los productos nuevos salen al final.
- **El `tsconfig` del admin no tiene `"types"`**, así que su `tsc` sin flags
  no revisa el código (`TS2688`). US-80 lo arregló en el shop. Conviene
  hacer lo mismo en el admin en una US aparte.
- Siguen los avisos de siempre: `Invalid href 'http://localhost:3003//'`,
  `expandedRowRender`, el WebSocket de Pusher, los `[issue]` de formulario y
  los avisos de width/height de las miniaturas de `/coupons`.
- `CLAUDE.md` cuenta `coupons` entre los módulos que sirven JSON mock, pero
  hoy `coupons.service.ts` usa `createCoupon`/`updateCoupon` de
  `@safari/db` y el `PUT` escribe en Postgres. Conviene corregirlo al
  integrar.
