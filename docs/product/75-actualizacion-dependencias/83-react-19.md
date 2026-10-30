# US-83 — React 19 en shop y admin

> Sube React y react-dom de 18.2.0 a la última 19.x, ya con Next 16, y
> retira el pin de `resolutions` que se puso por el aviso de
> `fetchPriority` (D-3 del épico).

**Épico:** [Épico 75](./README.md)
**Fecha:** 2026-10-24
**Status:** Implementada (2026-10-29)
**Depende de:** US-82
**LOC est.:** ~200

## Historia

**Como** mantenedor del frontend, **quiero** React 19, **para** que las
librerías de UI puedan seguir subiendo de versión.

## Contexto — verificado (2026-10-24)

- `apps/package.json` fija `"react": "18.2.0"` y `"react-dom": "18.2.0"`
  en `resolutions`. Las dos apps los declaran exactos. La última es la
  19.3.1, y `@types/react` va de 18.3.12 a 19.3.0.
- Librerías de UI con versión mayor pendiente que suelen acompañar a React
  19: `@headlessui/react` 1.7.17 → 2.2.10, `framer-motion` 10.16.4 →
  14.6.0, `swiper` 11.1.14 → 14.3.0 y `jotai` 2.10.1 → 3.0.1.
- `next-auth` 4.24.15 acepta React 19 (`react ^17.0.2 || ^18 || ^19`).

## Scope

**Incluye:**

- `react`, `react-dom`, `@types/react` y `@types/react-dom` a 19.x, y el
  pin de `resolutions` actualizado;
- **solo** las librerías que **no** declaren React 19 en sus
  `peerDependencies` o que fallen en el humo, cada una justificada con su
  `npm view … peerDependencies`;
- los ajustes de código que pida React 19 (`ref` como prop, `defaultProps`
  en componentes de función, tipos de `JSX`).

**NO incluye:**

- subir librerías que ya funcionan con React 19 solo porque haya una
  versión nueva;
- react-query (US-84 y US-85) y Stripe (US-87).

## Criterios de aceptación

### CA-1 — Humo sin avisos nuevos

Las rutas de humo del shop y del admin funcionan. La consola no muestra
avisos nuevos (de hidratación, de `ref` o de `defaultProps`).

### CA-2 — Tipos

`tsc --noEmit` del shop y del admin no supera su línea base, medida en
Next 16 con React 18.

### CA-3 — Una sola copia de React

En `apps/node_modules` hay una sola copia de `react` y de `react-dom`, la
19.x. Ninguna dependencia trae otra anidada.

## Escenarios Gherkin

```gherkin
Feature: Frontend en React 19
  Scenario: CA-3 — una sola copia de React
    Given el workspace instalado
    When se buscan react/package.json bajo apps
    Then solo existe la copia de la raíz, en 19.x
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `apps/package.json` | `resolutions` |
| `apps/shop/package.json`, `apps/admin/rest/package.json`, `apps/yarn.lock` | versiones |
| `apps/shop/src/**`, `apps/admin/rest/src/**` | solo lo que exija React 19 |

## Definición de Done

- [x] Línea base en React 18 (consola y `tsc`).
- [x] CA-1..CA-3 con la salida pegada.
- [x] La tabla de librerías que hubo que subir, con su evidencia.
- [x] Status actualizado aquí. La fila del épico la marca el dueño al
      integrar (instrucción de esta ejecución: no se editó el README del
      épico).

## Notas para el agente ejecutor

- Lee con Context7 la guía oficial *React 19 Upgrade Guide*. Si aplica, usa
  los codemods que propone y revisa su diff a mano.

## Resultado — ejecutado el 2026-10-29

Rama `us-83-react-19`, desde `main` @ `5d5b0c3`. Sin push ni merge. El shop y
admin/rest quedan en **React 19.3.1** con Next 16.4.1 y **webpack**: Turbopack
se volvió a probar y se descartó otra vez (ver «Turbopack»). CA-1, CA-2 y CA-3
se cumplen. Next ya no avisa de que React 18 está obsoleto.

### Versiones

Dependencias directas, en la última versión con más de dos semanas publicada
(`npm view <pkg> time --json`; corte: 2026-10-15), exactas como el resto de
los manifiestos. Sin `--force` ni `--legacy-peer-deps`.

| Paquete | Antes | Después | Publicada | Dónde |
|---|---|---|---|---|
| `react` / `react-dom` | 18.2.0 | **19.3.1** | 2026-10-14 | shop, admin/rest |
| `@types/react` | 18.3.12 | **19.3.0** | 2026-09-09 | shop, admin/rest |
| `@types/react-dom` | 18.3.1 | **19.3.0** | 2026-09-09 | shop, admin/rest |
| `resolutions` | `react`, `react-dom` 18.2.0 | `react`, `react-dom` 19.3.1; `@types/react`, `@types/react-dom` 19.3.0 | — | `apps/package.json` |

La 19.3.1 y la 19.2.9 salieron el mismo día (2026-10-14, 15 días antes del
corte de hoy); `latest` apunta a la 19.3.1. `react-dom@19.3.1` pide `react
^19.3.1` y `@types/react-dom@19.3.0` pide `@types/react ^19.3.0`.

**El pin de `resolutions` se queda, actualizado, y suma los tipos.**
admin/graphql (fuera del épico, DA-4) sigue declarando `react` 18.2.0 y
`@types/react` 18.3.12. En el primer `yarn install`, sin los tipos en el pin,
yarn hoisteó el `@types/react` 18.3.12 de admin/graphql a `apps/node_modules`
y dejó **nueve** copias de `@types/react` (18.3.12 en la raíz; 19.3.0
anidada en shop, admin/rest y `@types/react-dom`; 19.2.18 bajo cinco
`@types/*`). Con `@types/react` y `@types/react-dom` en `resolutions` queda
una sola de cada una. El pin de `react`/`react-dom` hace lo mismo que el de
Next en US-80: sin él, el 18.2.0 de admin/graphql sería una segunda copia.

### Guía leída (Context7)

*React 19 Upgrade Guide* (`react.dev/blog/2024/04/25/react-19-upgrade-guide`)
y la referencia de APIs retiradas: salen `propTypes` y `defaultProps` en los
componentes de función (se ignoran en silencio), `findDOMNode`,
`ReactDOM.render`/`hydrate`/`unmountComponentAtNode`, las string refs,
`contextTypes` y `createFactory`. En TypeScript, `useRef` exige argumento, el
`JSX` global pasa a `React.JSX`, las props de `ReactElement` pasan de `any` a
`unknown` y un callback de `ref` ya no puede devolver nada.

**Codemods: no se ejecutaron.** `grep` en el `src/` de las dos apps da 0 usos
de `ReactDOM.render`/`hydrate`, `findDOMNode`, string refs, `propTypes`,
`defaultProps`, `contextTypes`, `react-dom/test-utils` o `useFormState`, que es
todo lo que cubre `react/19/migration-recipe`. Los cambios de tipos (lo que
cubre `types-react-codemod preset-19`) los listó `tsc` uno por uno: 28 errores
en el shop y 11 en el admin, corregidos a mano en `210bf91`. Lo que de verdad
rompió React 19 está en las **librerías** (abajo), y ahí ningún codemod llega.

### Librerías que hubo que subir o sustituir

Criterio: solo las que **no declaran React 19** en sus `peerDependencies` o
**fallan en el humo**. Versión: la última con más de dos semanas de su misma
mayor, si esa mayor ya declara React 19; si no, la primera mayor que lo
declara, en su última versión.

| Librería | Antes | Después | Peer antes → después (`npm view … peerDependencies`) | Motivo | Commit |
|---|---|---|---|---|---|
| `@headlessui/react` | 1.7.17 | **2.2.10** (2026-04-07) | `^16 \|\| ^17 \|\| ^18` → `^18 \|\| ^19 \|\| ^19.0.0-rc` | Peer. Ninguna 1.x declara 19 | `0baa89a` |
| `framer-motion` | 10.16.4 | **11.18.2** (2025-01-20) | `^18.0.0` → `^18.0.0 \|\| ^19.0.0` | Peer. La primera que declara 19 es la 11.13.5 | `0baa89a` |
| `react-datepicker` (admin) | 4.21.0 | **7.6.0** (2025-01-05) | `… \|\| ^18` → `… \|\| ^19` | Peer. La 7.6.0 es la primera que declara 19 y la última 7.x. Trae sus tipos: sale `@types/react-datepicker` 4.19.1 | `0baa89a` |
| `react-select` | 5.8.2 | **5.10.2** (2025-07-11) | `… \|\| ^18.0.0` → `… \|\| ^19.0.0` | Peer | `0baa89a` |
| `react-scroll` | 1.9.0 | **1.9.3** (2025-02-19) | `… \|\| ^18.0.0` → `… \|\| ^19.0.0` | Peer | `0baa89a` |
| `@react-google-maps/api` | 2.20.3 | **2.20.8** (2025-12-16) | `… \|\| ^18` → `… \|\| ^19` | Peer | `0baa89a` |
| `@apollo/client` (shop, variante gql) | 3.11.8 | **3.14.1** (2026-03-12) | `… \|\| >=19.0.0-rc <19.0.0` → `… \|\| >=19.0.0-rc` | Peer (la 3.11 excluía la 19 estable) | `0baa89a` |
| `little-state-machine` (shop) | 4.8.0 | **4.8.1** (2024-12-16) | `… \|\| ^18` → `… \|\| ^19` | Peer | `0baa89a` |
| `react-copy-to-clipboard` (shop) | 5.1.0 | **5.1.1** (2026-03-07) | `^15.3.0 \|\| 16 \|\| 17 \|\| 18` → `>=15.3.0` | Peer | `0baa89a` |
| `@reach/portal` (admin) | 0.16.2 | **sale** | `^16.8.0 \|\| 17.x` (ya no cuadraba con 18); la última, 0.18.0, igual | Ningún archivo lo importa (`grep @reach` en admin/rest y shop: 0) | `0baa89a` |
| `react-toastify` | 9.1.3 | **10.0.6** | `>=16` → `>=18` | **Humo.** Declara 19, pero `ToastContainer` trae sus valores (`position`, `transition`…) en `defaultProps`: con React 19, mostrar un toast lanzaba `Element type is invalid … but got: undefined` y no salía ninguno. La 10.x no usa `defaultProps` y conserva `dist/ReactToastify.css` | `9611007` |
| `react-quill` (admin) | 2.0.0 | **sustituida** por `quill` 1.3.7 + `@types/quill` 1.3.10 y un envoltorio propio | `^16 \|\| ^17 \|\| ^18`; no hay versión nueva | **Humo.** `TypeError: react_dom_1.default.findDOMNode is not a function` al montar el editor del formulario de producto | `9611007` |
| `rc-table` | 7.22.2 | **7.22.2**, con sus valores por defecto en `ui/table.tsx` | `>=16.9.0` (declara 19) | **Humo.** `Table.defaultProps` (`prefixCls`, `rowKey`, `emptyText`) se ignora: las tablas del admin salían sin `.rc-table` y con 194-236 clases `undefined-*` | `210bf91` |

**rc-table: por qué no se subió.** La 7.55.1 (la última 7.x) ya no usa
`defaultProps`, y se probó: las tablas del admin revientan con `React has
detected a change in the order of Hooks called by Cell`, `The final argument
passed to useCallback changed size between renders` y `TypeError:
eventSelector is not a function` (`@rc-component/context`). La causa está en
el código de la app: las columnas llaman a hooks dentro de `render` (por
ejemplo, `usePrice` en `product-list.tsx:171`), y la 7.55 ejecuta ese `render`
dentro de un `useMemo` (`es/Cell/useCellRender.js:20`). Por eso se queda la
7.22.2, y el `Table` de `components/ui/table.tsx` (shop y admin) aplica los
mismos tres valores que traía `Table.defaultProps`, leídos del propio
`RcTable.defaultProps`.

**react-quill: por qué un envoltorio y no `react-quill-new`.** El fork
mantenido (`react-quill-new`, peer `… || ^19`) monta Quill 2 desde su 3.0.0, y
los dos plugins del editor del admin son de Quill 1: `quill-color-picker-enhance`
1.1.5 (su única versión) lleva Quill 1.3.7 empaquetado dentro, y
`react-quill-emoji` 0.1.9 pide `quill ^1.3.5`. Además, Quill 2 cambia el HTML
de las listas que guarda el editor y que luego pinta el shop. Ninguna binding
de React declara React 19 con Quill 1 (`react-quill-new` 3.0.0-3.8.3 usan
todas Quill 2). `components/ui/wysiwyg-editor/quill-editor.tsx` monta Quill
1.3.7 sobre un `ref` y replica lo que el admin usaba de react-quill: el DOM
`div.quill > .ql-toolbar + .ql-container` (el que estiliza
`rich-text-editor.css`), el valor HTML controlado, `onChange(html)`, `onBlur`,
`readOnly` y la instancia de Quill por `ref`. El `ImageHandler` la pedía con
`getEditor()`; ahora la recibe directa, y salen dos `@ts-ignore`.

**No se subieron** (declaran React 19, o no hay versión que lo haga):

| Librería | Peer (`npm view`) | Estado |
|---|---|---|
| `swiper` 11.1.14 | sin peers de React | Funciona (sliders del shop). El crítico de `yarn audit` sigue para US-73 |
| `jotai` 2.10.1 | `react >=17.0.0` | Funciona |
| `next-auth` 4.24.15 | `^17.0.2 \|\| ^18 \|\| ^19` | Funciona |
| `@tanstack/react-query` 5.104.1 | `^18 \|\| ^19` | Funciona |
| `react-i18next` 17.0.16, `overlayscrollbars-react` 0.5.6, `react-use` 17.5.1 | `>= 16.8.0`, `>=16.8.0`, `*` | Funcionan |
| `@stripe/react-stripe-js` 2.8.1 (shop) | `^16.8.0 \|\| ^17.0.0 \|\| ^18.0.0` | **No declara 19**, pero es de US-87 (Stripe), fuera de scope. `yarn install` lo avisa. El checkout llega al formulario; el pago con Stripe no se recorrió (las órdenes son mock en la API) |
| `react-laag` 2.0.5 (admin) | `^16.0.0 \|\| ^17.0.0 \|\| ^18.0.0`, y es la última | Sin versión con 19. Su único importador, `components/common/notification-menu.tsx`, no lo importa nadie (`grep notification-menu`: 0), así que no entra en ningún bundle. No se quitó: no falla |

`yarn install` final: fuera de admin/graphql, los únicos avisos de peers son
`@stripe/react-stripe-js` (react y react-dom) y el de siempre de `goober` >
`csstype`. Los de admin/graphql (sus librerías siguen en React 18) se
mantienen, como en las US anteriores (R-2).

### Commits

| Commit | Qué |
|---|---|
| `046548f` | React 19.3.1 y tipos 19.3.0 en shop y admin; `resolutions`; lockfile |
| `0baa89a` | Las nueve librerías que no declaraban React 19; salen `@reach/portal` y `@types/react-datepicker` |
| `210bf91` | Ajustes de código de React 19 (tipos, `Table` con sus valores por defecto, Headless UI 2) |
| `9611007` | `react-quill` → envoltorio sobre Quill 1.3.7; `react-toastify` 10.0.6 |
| `ef26270` | Turbopack, requisito 1: quita el import de `approveShopWithCommissionSchema` |
| `d733b35` | Turbopack, requisito 2: los `@import` de los dos `main.css` al principio |
| (este) | Doc de la US y `apps/README.md` |

`0baa89a` no compila solo (los tipos de Headless UI 2 se arreglan en
`210bf91`), igual que la pareja dependencias/código de US-84.

### Cambios de código (`210bf91`)

- **Tipos de `@types/react` 19.** `useRef(null)` pasa a
  `useRef<HTMLDivElement>(null)` o `useRef<HTMLElement>(null)` según el
  elemento (5 sitios en el shop); en el admin, `drawer.tsx` deja el `useRef()
  as …` y el editor su `useRef()`. `useActiveScroll` acepta `RefObject<T |
  null>`. `JSX.Element` pasa a `React.JSX.Element` (5 archivos).
  `NextPageWithLayout.getLayout` recibe `ReactElement<P>` (las props de la
  página), y `getGeneralLayout` y el `GetLayout` de fabricantes declaran las
  props que leen. El `Slot` del admin pasa el tipo a `isValidElement<…>`.
- **`react-use` tipa `useIntersection(ref: RefObject<HTMLElement>)`** con la
  semántica de React 18 (`current` anulable), también en su última versión
  (17.6.1). En React 19 ese tipo quiere decir «no nulo», así que en las tres
  llamadas el ref se convierte con `as RefObject<HTMLElement>`. Es la única
  conversión de tipos de la US; no hay `as any` ni `@ts-ignore` nuevos.
- **Headless UI 2.** `Dialog.Overlay` ya no existe y pasa a `DialogBackdrop`
  (en `drawer-portal.tsx` del shop, que no usa nadie). El `onChange` de
  `RadioGroup` recibe el tipo de `value` (`DeliveryTime | null`), así que
  `schedule-grid.tsx` (shop y admin) solo llama a `setSchedule` con un valor.
  El resto de la API v1 que usan las apps (`Dialog.Panel`, `Transition.Child`,
  `RadioGroup.Option`, `Menu`, `Listbox`…) sigue funcionando en la 2.2.

### Línea base (React 18.2.0, `main` @ `5d5b0c3`)

```
$ just verify
OK   API    :9001/api/settings  200  5503B  992ms
OK   Shop   :3003/en  200  191138B  40845ms  cards:30
OK   Admin  :3002/en/login  200  72554B  24924ms  cards:1
$ cd apps/shop && yarn lint            -> $ eslint src   Done in 191.41s.   (0)
$ cd apps/admin/rest && yarn lint      -> $ eslint src   Done in 36.45s.    (0)
$ cd apps/shop && ./node_modules/.bin/tsc --noEmit                                  -> 9 error TS2786 (exit 2)
  classic.tsx, modern.tsx, book-details.tsx, details.tsx, terms.tsx x2, coupon.tsx, privacy.tsx x2
$ cd apps/admin/rest && ./node_modules/.bin/tsc --noEmit --types node,google.maps   -> 2 errores (exit 2)
  src/components/ui/back-to-top/back-to-top.tsx(41,10): error TS2322 ...
  src/components/ui/date-picker.tsx(75,14): error TS2786: 'DatePicker' cannot be used as a JSX component.
$ just build   (API arriba, dev detenidos)  -> exit 0
  ▲ Next.js 16.4.1 (webpack)  ✓ Compiled successfully in 3.7min  ✓ Generating static pages using 11 workers (279/279)   (shop)
  ▲ Next.js 16.4.1 (webpack)  ⚠ Compiled with warnings in 93s     ✓ Generating static pages using 11 workers (77/77)    (admin)
  ⚠ React 18 support is deprecated in Next.js 16 and will be removed in Next.js 17. (x2)
  Attempted import error: 'approveShopWithCommissionSchema' is not exported ... (x2, admin)
  Warning: data for page "/[[...pages]]" (path "/daily-needs") is 189 kB ...  (shop)
  react-i18next:: useTranslation: You will need to pass in an i18next instance ... (x2)
```

`just build` regenera `apps/shop/public/sitemap-0.xml`; se restauró con `git
checkout` tras cada build.

**Consola del navegador.** El MCP de chrome-devtools no conectó en esta sesión
(`CONNECT_TIMEOUT`), así que el humo se hizo con **Playwright para Python**
(el Chromium 156 que ya instala `just scraper-install` en el venv del
scraper), con un script fuera del repo: abre un contexto nuevo por app,
recorre las rutas, cuenta elementos y vuelca `console` y `pageerror` por paso.
Es el mismo script antes y después. No ve los `[issue]` del panel de Chrome
que citaban las US anteriores, porque no son mensajes de consola. Además de
las rutas del épico, recorre `/products/apples/edit` (editor Quill,
`react-select`), `/coupons/create` (`react-datepicker`) y `/logout`, que
dispara un toast.

### CA-1 — Humo sin avisos nuevos ✅

| Ruta | React 18.2.0 (base) | React 19.3.1 (final, webpack en dev) |
|---|---|---|
| shop `/` | 30 cards, 33 imágenes, 0 rotas; `[warn]` LCP | igual |
| shop `/shops` | 12 tiendas, 15 imágenes | igual |
| shop `/shops/gadget` | 30 cards, 35 imágenes; `[warn]` LCP | igual |
| shop `/products/apples` + carrito | «1 Item $1.60», cajón con Checkout; `[warn]` LCP, width/height, `There are no focusable elements inside the <FocusTrap />` | igual, **sin** el aviso de `FocusTrap` (Headless UI 2) |
| shop login (`customer@demo.com`) | cookies `auth_token` y `AUTH_CRED_SHOP`, modal cerrado | igual |
| shop `/checkout` | Contact Number, Billing Address, Your Order con Apples | igual |
| admin login (`admin@demo.com`) | cookie `AUTH_CRED`, redirige a `/` | igual |
| admin `/` | 4 tablas `.rc-table`, 22 filas, 44 imágenes; Pusher, `Invalid href` x2, `expandedRowRender` | igual |
| admin `/products` | 1 tabla, 21 filas, 42 imágenes; Pusher, `Invalid href` x2 | igual |
| admin `/orders` | 1 tabla, 21 filas; Pusher, `Invalid href` x2, `expandedRowRender` | igual |
| admin `/products/apples/edit` | 1 editor `.ql-editor`, 1 `react-select`, nombre «Apples» | igual |
| admin `/coupons/create` | 2 `react-datepicker` | igual |
| admin `/logout` | toast «Logout Successfully.» (`--top-right`) | igual |

En todas las rutas del admin sale además `[HMR] Invalid message:
{"type":"isrManifest",…}` (dev de Next 16), en la base y al final. Recuento por
tipo de mensaje en las dos corridas (base / final): LCP 2/6, width/height 1/1,
`FocusTrap` 1/0, Pusher 6/5, `Invalid href` 12/10, `expandedRowRender` 3/2,
`[HMR] isrManifest` 4/5. Las diferencias de recuento son de tiempo: el popup
promocional del shop aporta su propio aviso LCP cuando llega a abrirse, y en
la base el dashboard del admin se contó en el paso del login porque la
redirección llegó antes. **Ningún tipo de mensaje nuevo**: ni de hidratación,
ni de `ref`, ni de `defaultProps`.

Comprobaciones a mano de lo que cambió de mayor:

```
react-datepicker 7.6.0 (/coupons/create): el calendario abre ("October 2026") y,
  al elegir el día 31, el campo pasa a "October, 31 2026 12:00:00 AM"
Quill (/products/apples/edit): 1 .ql-toolbar, el botón .ql-emoji y 4 selectores
  de color; al teclear, .ql-editor = "<p>Hola React 19</p>"
```

En la terminal de `next dev` desaparece `⚠ React 18 support is deprecated in
Next.js 16` (x2 en la base, 0 al final), y no aparece ningún aviso nuevo.

**Lo que se vio por el camino**, con React 19 y las librerías viejas (antes de
`9611007` y del `Table` de `210bf91`): tablas del admin con 0 `.rc-table` y
194-236 clases `undefined-*`; `findDOMNode is not a function` en el editor;
`Element type is invalid` al mostrar el toast del logout. Son los tres casos de
la tabla de librerías.

```
$ just verify      (final)
OK   API    :9001/api/settings  200  5503B  1590ms
OK   Shop   :3003/en  200  192250B  22832ms  cards:30
OK   Admin  :3002/en/login  200  72554B  155ms  cards:1
```

El HTML del shop crece 1112 caracteres (191138 → 192250). 1109 son un `<link
rel="preload" as="image" imageSrcSet=…>` del logo: React 19 lo emite para las
imágenes con prioridad alta (`next/image` con `priority`). El `<head>` SSR no
cambia: `/en` sigue con `<title>Pickbazar | Grocery</title>`, 10 `og:*` y 21
`data-next-head`; `/en/products/apples`, con «Pickbazar | Apples», 9 y 20. El
login del admin mide lo mismo, 72554 caracteres.

```
$ just build   (final, webpack, API arriba, dev detenidos)  -> exit 0
  ▲ Next.js 16.4.1 (webpack)  ✓ Compiled successfully in 30.7s  ✓ Generating static pages using 11 workers (279/279)   (shop)
  ▲ Next.js 16.4.1 (webpack)  ✓ Compiled successfully in 20.1s  ✓ Generating static pages using 11 workers (77/77)    (admin)
  Warning: data for page "/[[...pages]]" (path "/daily-needs") is 189 kB ...
  react-i18next:: useTranslation: You will need to pass in an i18next instance ... (x2)
```

Frente a la base desaparecen el aviso de React 18 (x2) y, por `ef26270`, el
`Attempted import error` del admin, que pasa de «Compiled with warnings» a
«Compiled successfully». Con `next start` de ese build (puertos 3005 y 3006),
el mismo humo solo trae los mensajes de siempre (Pusher x6, `Invalid href`
x6).

### CA-2 — Tipos ✅

```
$ cd apps/shop && ./node_modules/.bin/tsc --noEmit                                  -> exit 0, 0 errores  (base: 9 TS2786)
$ cd apps/admin/rest && ./node_modules/.bin/tsc --noEmit --types node,google.maps   -> 1 error            (base: 2)
  src/components/ui/back-to-top/back-to-top.tsx(41,10): error TS2322 ...           (el mismo de la base)
$ cd apps/shop && yarn lint          -> $ eslint src   Done in 55.43s.    (0)
$ cd apps/admin/rest && yarn lint    -> $ eslint src   Done in 223.64s.   (0)
```

Los 9 TS2786 del shop y el de `date-picker.tsx` del admin desaparecen solos:
eran choques entre copias de `@types/react` (la de la app y las que traían
`react-scroll`, `react-copy-to-clipboard` y `@types/react-datepicker`). Ahora
hay una sola, y `react-datepicker` 7 trae sus propios tipos. Las 14 reglas del
React Compiler de `react-hooks` 7 y `no-location-assign-relative-destination`
siguen en `off` (fuera de scope).

### CA-3 — Una sola copia de React ✅

```
$ find apps -path '*/node_modules/react/package.json' -not -path 'apps/api/*'
apps/node_modules/react/package.json 19.3.1
$ find apps -path '*/node_modules/react-dom/package.json' -not -path 'apps/api/*'
apps/node_modules/react-dom/package.json 19.3.1
$ find apps -path '*/node_modules/@types/react/package.json' -o -path '*/node_modules/@types/react-dom/package.json'   (sin apps/api)
apps/node_modules/@types/react/package.json 19.3.0
apps/node_modules/@types/react-dom/package.json 19.3.0
```

### Turbopack (decisión del dueño en US-82: reintentarlo aquí)

Con React 19 ya funcionando en webpack, se cumplieron los dos requisitos y se
quitó `--webpack` de `dev`/`build` del admin y de `dev:rest`/`build:rest` del
shop (las variantes `gql` conservan su `webpack()` propio), con `.next/dev`
vacío.

1. **`approveShopWithCommissionSchema` (`ef26270`).** El símbolo nunca existió
   en `shop-validation-schema.ts` (que no cambia desde `aed4d5b`), así que
   `multi-commission.tsx` pasaba `validationSchema={undefined}` y `Form` no
   ponía resolver (`...(!!validationSchema && { resolver })`). El cambio
   mínimo que conserva el comportamiento es quitar el import, su
   `//@ts-ignore` y la prop. **Se queda**, porque es correcto por sí mismo:
   webpack deja de avisar. No se inventó un esquema: el formulario sigue sin
   validar la comisión, como hasta ahora (ver «Para el dueño»).
2. **`@import` de `main.css` (`d733b35`).** Suben al principio en las dos
   apps. Comparación del CSS de producción con webpack, antes y después: de
   los chunks de `.next/static/css` cambia uno por app, y la única diferencia
   es el salto de línea antes del comentario de licencia de Tailwind (`}/*\n!
   tailwindcss` pasa a `}\n/* ! tailwindcss`, +1 byte). Sin comentarios ni
   espacios, los dos chunks son idénticos. **Se queda**: no cambia estilos y
   es lo que piden Turbopack y Tailwind 4.

Resultado con Turbopack:

```
dev    ▲ Next.js 16.4.1 (Turbopack)  ✓ Ready in 5.8s (shop) / 5.0s (admin)
       just verify: OK Shop 194931B cards:30 | OK Admin 75048B cards:1   (el SSR responde)
       navegador, shop: GET /_next/static/chunks/shop_src_components_16-04oldux0-_._.js 404
         "Hydration failed because the server rendered HTML didn't match the client"
         "Module [project]/shop/src/lib/hooks/use-layout.tsx [client] (ecmascript) was instantiated
          because it was required from module .../layouts/layout.tsx ..., but the module factory is not available"
         -> el carrito no abre y /checkout no pinta el formulario
       navegador, admin: "Module [project]/admin/rest/src/components/ui/input.tsx [client] ... but the module
          factory is not available" en /login -> no hay formulario ni login; ninguna ruta pinta
build  ▲ Next.js 16.4.1 (Turbopack)  ✓ Compiled successfully in 101s / 60s; 279/279 y 77/77; exit 0
start  admin (3006): el humo completo, igual que con webpack
       shop (3005):  "Minified React error #418" (hidratación) en /, /products/apples y en el login (x3)
webpack, mismo código y mismo humo con next start (3005/3006): 0 errores
```

El admin ya **compila** con Turbopack (su bloqueo en US-82) y funciona en
producción, pero en `dev` ninguna de las dos apps sirve sus chunks, y el shop
falla en `dev` y en producción, como en US-82, también con React 19. La regla
de la decisión pedía las dos cosas en las dos apps: **se queda webpack**. Se
restauraron los `--webpack` (el cambio de scripts no se commiteó). No se buscó
la causa dentro de Turbopack.

### Desvíos

- **Humo con Playwright, no con chrome-devtools** (el MCP no conectó). La
  hidratación sí quedó probada: es un navegador real, y con él salieron los
  errores de hidratación de Turbopack.
- `resolutions` suma `@types/react` y `@types/react-dom`.
- Se tocaron librerías que la US no listaba: `react-toastify`, `react-quill`
  (sustituida) y `rc-table` (con sus valores por defecto en código), porque
  fallaban en el humo, y nueve más por sus peers. `@reach/portal` y
  `@types/react-datepicker` salen del admin.
- Archivo nuevo: `apps/admin/rest/src/components/ui/wysiwyg-editor/quill-editor.tsx`
  (114 líneas). `quill` y `@types/quill` pasan a ser dependencias directas
  del admin (antes llegaban con `react-quill`).
- `ef26270` y `d733b35` (los requisitos de Turbopack) se quedan aunque
  Turbopack no se adopte: los dos son correctos por sí mismos.
- No apareció el corte de `next dev`/`next build` dirigido a agentes que
  documentó US-82: ningún proceso terminó con ese texto.

### Para el dueño

- **`multi-commission.tsx` no valida la comisión** (ni antes ni ahora). Si se
  quiere validar, el esquema natural es un `yup.number()` requerido
  `when('isCustomCommission', true)`. No se escribió porque cambia el
  comportamiento del flujo de aprobación de tiendas.
- **Los hooks dentro del `render` de las columnas** (`usePrice` y otros)
  bloquean subir `rc-table` a la 7.55. Arreglarlo es sacar esas celdas a
  componentes; es para una US aparte.
- **El envoltorio de Quill es código propio** sobre Quill 1.3.7, que ya no
  tiene mantenimiento. La salida a medio plazo es Quill 2 (`react-quill-new`),
  pero exige sustituir los plugins de emoji y de color y revisar cómo pinta el
  shop las listas que guarda el editor.

### Para US-86 (Tailwind 4) y US-87 (Stripe)

- **US-86:** los `@import` de los dos `main.css` ya están arriba (`d733b35`),
  y el build con Turbopack compila el CSS de las dos apps sin errores de
  Lightning CSS. El CSS sigue pasando por webpack y `postcss.config.js`
  (`tailwindcss`, `autoprefixer`). `rich-text-editor.css` estiliza
  `.react-quill-description .quill …`, clases que conserva el envoltorio de
  Quill. Headless UI ya está en la 2.2, que trae sus propias clases de estado
  (`data-*`) si US-86 quiere usarlas.
- **US-87:** `@stripe/react-stripe-js` 2.8.1 es la única librería directa del
  frontend que **no declara React 19** (peer `^16.8.0 || ^17.0.0 || ^18.0.0`;
  `yarn install` lo avisa), y el pago no se recorrió. La primera versión que
  declara React 19 es la 3.1.1, y la última con más de dos semanas, la 7.0.0
  (`>=16.8.0 <20.0.0`).

### Fuera de alcance (siguen, no se tocaron)

- Los avisos de siempre: admin `Invalid href 'http://localhost:3003//'`,
  `expandedRowRender` y el WebSocket de Pusher; shop, LCP; build, los 189 kB
  de `/daily-needs` y el `NO_I18NEXT_INSTANCE` del prerender.
- `swiper` y su aviso crítico de `yarn audit` (US-73).
- Las 15 reglas de lint en `off` (React Compiler y Next 16).
- `back-to-top.tsx(41,10)` del admin (TS2322 heredado).
- `react-laag` y `notification-menu.tsx`, que nadie usa.
