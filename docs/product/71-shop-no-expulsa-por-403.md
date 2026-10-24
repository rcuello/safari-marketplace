# US-71 — El shop no expulsa al visitante por un 401/403 accesorio

> Al ver un producto o una tienda, el shop pedía los avisos de tienda
> (`GET /api/store-notices`), que la API reserva a admin y dueño. El 401 (sin
> sesión) o el 403 (cliente) caía en el interceptor del cliente HTTP, que ante
> cualquiera de los dos borraba el token y redirigía a la portada. Resultado:
> **un visitante anónimo no podía ver ningún detalle de producto ni ninguna
> tienda**, y un cliente perdía la sesión al abrir un producto. Además, el
> header y la barra de avisos usaban el slug del **producto** como si fuera el
> de una tienda.

**Épico:** ninguno (US standalone). Nace de los hallazgos de
[US-70](./70-login-google-opcional.md) y de la petición del dueño de
corregirlos.
**Fecha:** 2026-10-24
**Status:** ✅ Completada (2026-10-24)
**Depende de:** ninguna. Solo toca `apps/shop`; la API y su guard no cambian.

## Historia

**Como** visitante o cliente del shop, **quiero** poder ver un producto o una
tienda sin que una petición accesoria me saque de la página o me cierre la
sesión, **para** poder comprar.

## Contexto — verificado en código y en el navegador (2026-10-24)

- `apps/shop/src/components/layouts/layout.tsx:18` montaba
  `NoticeHighlightedBar` en **toda** página con `router.query.slug`:
  productos, tiendas, autores, fabricantes…
- `components/store-notice/notice-highlightedBar.tsx` pedía
  `useStoreNotices({ shops: slug })`, es decir,
  `GET /store-notices?search=shops.slug:<slug>`. En un producto ese slug es el
  del producto (`shops.slug:apples`).
- `components/layouts/header.tsx:60` y `header-minimal.tsx:64` pedían
  `useShop({ slug })` en toda página con slug: `GET /api/shops/apples` → 404.
  Solo se usa para el aviso de mantenimiento de la tienda.
- `apps/api/rest/src/store-notices/store-notices.controller.ts:28`:
  `@Permissions(...ADMIN_AND_OWNER)` a nivel de clase. Sin token → **401**;
  `customer@demo.com` → **403**. Es la decisión **R-6** del Épico 46
  (`docs/product/46-api-sin-mocks-json/README.md:281`), que deja ese guard
  intacto a propósito.
- `apps/shop/src/framework/rest/client/http-client.ts:203-208`: ante **401 o
  403** (o el mensaje `PICKBAZAR_ERROR.NOT_AUTHORIZED`), `Cookies.remove(
  AUTH_TOKEN_KEY)` + `Router.replace(Routes.home)`. Viene así del Pickbazar
  original (`aed4d5b`); `54eaa17` lo conservó.

**Medido antes del cambio** (Chrome DevTools, contexto aislado, sin sesión):

```
/en/products/apples         → carga y a los ~6 s redirige a "/"
/en/shops/furniture-shop    → ídem, redirige a "/"
curl anónimo GET /api/store-notices?…shops.slug:apples → 401
curl customer GET /api/store-notices?…shops.slug:apples → 403
curl GET /api/shops/apples → 404
```

Con sesión de cliente, abrir `/en/products/apples` dejaba `GET /api/me` en
401 después del 403, y `/en/profile` volvía a pedir login.

## Decisiones del dueño (2026-10-24)

| # | Tema | Decisión |
|---|---|---|
| D-1 | Qué hace el interceptor ante 401/403 | **Cerrar sesión solo si la petición llevaba token y la API responde 401** (o `NOT_AUTHORIZED`): la sesión caducó o no vale. Un 403 (autenticado sin permiso) o un 401 anónimo solo rechazan la petición |
| D-2 | Dónde se piden la tienda y los avisos | **Solo en `/shops/[slug]/*`**, donde el slug sí es de una tienda (hook `useIsShopPage`, al estilo de `useIsHomePage`) |
| D-3 | Quién lee los avisos de tienda | **Se mantiene R-6.** El shop los pide solo si el usuario está autenticado y es `super_admin` o `store_owner` (`adminAndOwnerOnly`, permisos de la cookie `AUTH_CRED_SHOP`); para clientes y anónimos no se piden y la barra no aparece. La API no cambia |

## Scope

**Incluye:** `http-client.ts` (D-1); `lib/use-is-shop-page.ts` nuevo,
`layout.tsx`, `header.tsx` y `header-minimal.tsx` (D-2);
`notice-highlightedBar.tsx` (D-3).

**NO incluye:**

- cambiar el guard de `store-notices` ni ningún otro (R-6);
- decidir qué avisos debería ver un cliente, si alguno;
- el `import { useShop }` sin uso de `notice-highlightedBar.tsx:2` ni el
  aviso de `fetchPriority` de Next 13.5 + React 18.2;
- la variante GraphQL del shop.

## Criterios de aceptación

- **CA-1:** sin sesión, `/en/products/apples` y `/en/shops/furniture-shop` se
  quedan en su URL; no se pide `store-notices`, y `shops/:slug` solo en la
  tienda y con su slug.
- **CA-2:** con sesión de cliente, abrir un producto y una tienda no cierra la
  sesión ni pide `store-notices`.
- **CA-3:** con sesión de dueño, la página de su tienda pide
  `store-notices?…shops.slug:furniture-shop` y recibe 200.
- **CA-4:** con un token inválido, el 401 sigue borrando el token y llevando a
  la portada.
- **CA-5:** `tsc` sin errores nuevos, `yarn lint`, `just build-shop` y
  `just verify` en verde.

## Evidencia (2026-10-24)

**CA-1** (contexto aislado, sin sesión):

```
/en/products/apples (tras 8 s) → {"url":"/en/products/apples","h1":"Apples"}
  red: session, settings, types, reviews, questions — sin store-notices ni shops/apples
/en/shops/furniture-shop (tras 8 s) → {"url":"/en/shops/furniture-shop","peticiones":["http://localhost:9001/api/shops/furniture-shop"]}
```

**CA-2** (`customer@demo.com`, entra por `/en/profile`):

```
/en/products/apples (tras 8 s)      → {"url":"/en/products/apples","tokenCookie":true,"peticiones":[".../api/me",".../api/me"]}
/en/shops/furniture-shop (tras 8 s) → {"url":"/en/shops/furniture-shop","tokenCookie":true,"peticiones":[".../api/shops/furniture-shop",".../api/me"]}
```

**CA-3** (`store_owner@demo.com`, permisos `["customer","store_owner"]`):

```
GET http://localhost:9001/api/store-notices?searchJoin=and&search=shops.slug:furniture-shop [200]
GET http://localhost:9001/api/shops/furniture-shop [200]
```

**CA-4** (cookie `auth_token=token-invalido` y navegación a
`/en/products/apples`):

```
(tras 8 s) → {"url":"/","tokenCookie":false}
```

**CA-5:**

```
cd apps/shop && npx tsc --noEmit -p tsconfig.json → los mismos 9 × TS2786 previos (ninguno en los archivos tocados)
yarn lint                → ✔ No ESLint warnings or errors
just build-shop          → ✓ Compiled successfully · Done in 117.74s.   (sitemap-0.xml regenerado y devuelto a HEAD)
just verify
OK   API    :9001/api/settings  200  5503B  574ms
OK   Shop   :3003/en  200  190788B  391ms  cards:30
OK   Admin  :3002/en/login  200  72821B  255ms  cards:1
```

**No verificado directamente:** un 403 con sesión sobre otra ruta (ninguna
página del shop lo produce ya). El cambio es la condición del interceptor,
que ya no incluye el 403; CA-2 lo cubre en el caso real que lo disparaba.

**Para el reporte:** si algún día los clientes deben ver avisos de tienda,
hace falta decidir qué avisos son públicos y abrir la lectura en la API: es
un cambio del guard que R-6 dejó cerrado y va en una US aparte.
