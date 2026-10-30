# US-86 — Tailwind 3 → 4 en shop y admin

> Sube Tailwind CSS de 3.4.14 a la última 4.x en el shop y el admin. La v4
> cambia la configuración (CSS en lugar de `tailwind.config.js`), el
> pipeline de PostCSS y cómo se cargan los plugins.

**Épico:** [Épico 75](./README.md)
**Fecha:** 2026-10-24
**Status:** Implementada (2026-10-30)
**Depende de:** US-82
**LOC est.:** ~300

## Historia

**Como** mantenedor del frontend, **quiero** Tailwind 4, **para** no quedar
atado a una mayor que deja de evolucionar.

## Contexto — verificado (2026-10-24)

- `apps/shop/tailwind.config.js` tiene 173 líneas y usa los plugins
  `@tailwindcss/typography` y `@tailwindcss/forms`. El
  `apps/admin/rest/tailwind.config.js` usa esos dos más `tailwindcss-rtl`
  (línea 142).
- Tailwind 4 trae variantes `rtl:` y `ltr:` propias. Hay que medir si el
  admin usa utilidades de `tailwindcss-rtl` que no tengan equivalente (R-5
  del épico).

## Decisiones abiertas para el dueño

| # | Tema | Opciones | Propuesta por defecto |
|---|---|---|---|
| DA-1 | Configuración | **(a)** Pasar el tema a CSS (`@theme`), que es el camino de la v4. **(b)** Mantener `tailwind.config.js` con `@config` | **(b)** en esta US, para que el diff sea revisable; **(a)** después, si se quiere |
| DA-2 | `tailwindcss-rtl` | **(a)** Sustituirlo por las variantes nativas. **(b)** Mantenerlo si tiene versión compatible | Se decide con el inventario de CA-1 |

## Scope

**Incluye:** `tailwindcss` 4 con su integración de PostCSS
(`@tailwindcss/postcss`), los plugins de `typography` y `forms` en versiones
compatibles, y DA-1 y DA-2.

**NO incluye:** rediseñar la UI ni cambiar los tokens de color. Los dos
fuera de alcance, como pide `ui-sober-anti-slop` en las preferencias del
dueño.

## Criterios de aceptación

### CA-1 — Inventario

Antes de subir, la US tiene que listar las utilidades de `tailwindcss-rtl`
que usa el admin (con `grep` y su cuenta) y los cambios de nombre de
utilidades de la v4 que aparecen en el código. Ejemplos de esos cambios:
`shadow-sm` → `shadow-xs` y `ring` → `ring-3`.

### CA-2 — Sin regresión visual

Hay que comparar capturas antes y después de las rutas de humo, a 1280 px
y a 400 px de ancho. No puede haber diferencias más allá de las anotadas
como esperadas.

### CA-3 — Build

`just build` termina sin errores y el CSS generado no crece más de un 10 %.
Si crece más, hay que justificarlo.

## Escenarios Gherkin

```gherkin
Feature: Tailwind 4
  Scenario: CA-2 — la tienda se ve igual
    Given las capturas de las rutas de humo en Tailwind 3
    When el shop corre en Tailwind 4
    Then las capturas coinciden salvo las diferencias anotadas
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `apps/shop/tailwind.config.js`, `apps/admin/rest/tailwind.config.js` | según DA-1 |
| `apps/*/postcss.config.js` | `@tailwindcss/postcss` |
| `apps/*/src/**/*.css` | `@import "tailwindcss"` y `@config` |
| `apps/*/src/**` | renombres de utilidades |

## Definición de Done

- [x] DA-1 y DA-2 confirmadas.
- [x] CA-1..CA-3 con la evidencia (capturas y tamaños).
- [x] Status actualizado aquí y en la tabla del épico.

## Notas para el agente ejecutor

- Lee con Context7 la guía oficial *Upgrade guide* de Tailwind v4. Valora
  `npx @tailwindcss/upgrade` y revisa su diff a mano.

## Resultado — ejecutado el 2026-10-30

Rama `us-86-tailwind-4`, desde `main` @ `2991492`. El shop y admin/rest
quedan en **Tailwind 4.3.3**, con la config en JS cargada con `@config`
(DA-1 b) y sin `tailwindcss-rtl` (DA-2 a). Las 22 capturas de humo
coinciden con las de la v3 salvo ruido anotado (CA-2), y el CSS crece un
8,3 % en el shop y un 5,9 % en el admin (CA-3).

### Versiones

Última versión con más de dos semanas publicada (`npm view <pkg> time
--json`; corte: 2026-10-16), exacta como el resto de los manifiestos.

| Paquete | Antes | Después | Publicada | Dónde |
|---|---|---|---|---|
| `tailwindcss` | 3.4.14 | **4.3.3** | 2026-07-16 | shop, admin/rest |
| `@tailwindcss/postcss` | — | **4.3.3** | 2026-07-16 | shop, admin/rest |
| `@tailwindcss/forms` | 0.5.9 | **0.5.11** | 2025-12-17 | shop, admin/rest |
| `@tailwindcss/typography` | 0.5.15 | **0.5.20** | 2026-06-08 | shop, admin/rest |
| `autoprefixer` | 10.4.20 | sale | — | shop, admin/rest (la v4 añade los prefijos) |
| `tailwindcss-rtl` | 0.9.0 | sale | — | admin/rest |

admin/graphql se queda en Tailwind 3.4.14 con `tailwindcss-rtl` (decisión
del dueño): yarn le anida su copia, y la raíz de `apps/node_modules` tiene la
4.3.3. `prettier-plugin-tailwindcss` 0.5.6 no se tocó: ningún
`prettier.config.js` lo carga en `plugins`, así que no hace nada.

### Guía leída (Context7) y `@tailwindcss/upgrade`

*Upgrade guide* de `/tailwindlabs/tailwindcss.com`: `@tailwindcss/postcss`,
`@config` (sin `corePlugins`, `safelist` ni `separator`), utilidades
renombradas y retiradas, y cambios de preflight (borde `currentcolor`, anillo
de 1px y `currentcolor`, placeholder, cursor de los botones).

`npx @tailwindcss/upgrade@4.3.3` se probó en el shop y **se descartó**:

1. Con los colores definidos como función se paraba (`color.replace is not
   a function`). Eso se resolvió con el commit preparatorio `83aa194`.
2. Después pasó el tema a `@theme` (DA-1 a) y borró `tailwind.config.js`,
   con variables que se referencian a sí mismas
   (`--color-accent: rgba(var(--color-accent), 1)`).
3. Renombró **valores de JS**, no solo clases: `variant: 'outline'` →
   `'outline-solid'` y `variant === 'shadow'` → `'shadow-sm'`, lo que rompía
   las variantes de `Button` y del acordeón.
4. Su `yarn add` falló en el hook de husky y dejó en
   `admin/rest/node_modules/react-datepicker/node_modules/@floating-ui/react-dom/node_modules/`
   una copia de React 18.2.0 que el lockfile no pide. `yarn install
   --check-files` no la quitaba, y `/coupons/create` moría con
   `Cannot read properties of null (reading 'useState')`. Se borró esa
   carpeta concreta con permiso del dueño; yarn no la vuelve a crear.

En su lugar se escribió un codemod que solo toca literales de clases
(strings de `.ts`/`.tsx` y líneas `@apply`). Los restos que dejaba (literales
con apóstrofos de JSX) se corrigieron a mano.

### DA-1 y DA-2

- **DA-1 (b):** `tailwind.config.js` sigue siendo la fuente del tema y
  `main.css` lo carga con `@config '../../../tailwind.config.js'`.
  `withOpacity()` devuelve `rgba(var(--x), <alpha-value>)` en vez de una
  función; las variables CSS siguen en formato `r, g, b`.
- **DA-2 (a):** `tailwindcss-rtl` no carga en la v4 (hace
  `require('tailwindcss/lib/util/escapeClassName')`, que no existe en el
  paquete). `ms-/me-/ps-/pe-/start-/end-`, `text-start/end`, `border-s/e`
  y `rounded-s/e` son nativas y lógicas.

### CA-1 — Inventario ✅

`tailwindcss-rtl` en el admin (`main` @ `2991492`). Las nativas de la v4
cubren todo salvo:

| Clase del plugin | Usos | En la v4 |
|---|---|---|
| `space-s-*` | 27 | `space-x-*` (la v4 ya usa `margin-inline-*`) |
| `rounded-te*` / `rounded-be*` | 6 | `rounded-se*` / `rounded-ee*` |
| `origin-top-end` | 4 | `ltr:origin-top-right rtl:origin-top-left` |

Renombres y utilidades retiradas en el código:

| v3 | v4 | Shop | Admin |
|---|---|---|---|
| `outline-none` | `outline-hidden` | 58 | 148 |
| `shadow-sm` | `shadow-xs` | 20 | 13 |
| `*-opacity-N` | `color/N` | 78 | 54 |
| `flex-shrink*` / `flex-grow*` | `shrink*` / `grow*` | 9 | 29 |
| `max-w-screen-*` | `max-w-(--breakpoint-*)` | 16 | 0 |
| `blur-sm` | `blur-xs` | 2 | 0 |
| `rounded-sm` | `rounded-xs` | 1 | 0 |
| `overflow-ellipsis` | `text-ellipsis` | 0 | 1 |
| `rtl:space-x-reverse`, `rtl:divide-x-reverse` | se quitan (`space-x`/`divide-x` son lógicos) | 59 | 19 |

**No se renombran** `shadow`, `rounded`, `blur`, `backdrop-blur` ni
`drop-shadow` sueltos: compilados con la 4.3.3 y esta config dan el mismo
valor que en la v3 (`rounded` = 5px por el `DEFAULT` de la config). `ring`
suelto no aparece como clase en ninguna de las dos apps.

### Cambios para que nada se vea distinto

Las capturas sacaron cambios de comportamiento de la v4 que la guía no
cubre del todo. Cada uno se corrigió para que se vea como en la v3:

| Causa | Síntoma | Arreglo |
|---|---|---|
| `custom-plugins.css` en `layer(base)` (lo que proponía la herramienta) | `rc-table` pintaba los bordes rojos de su CSS de demo; la tabla de pedidos pasó de 1923 a 3590 px | Importarlo sin capa, como el CSS de terceros |
| `@import url(...)` de Google Fonts dentro de una capa | Aviso del optimizador: las fuentes no cargaban | Subirlos a `main.css`, antes de todo |
| Interlineado de `text-*` como razón sin unidades | Filas de tabla más bajas (`text-[13px]` heredaba 18,57px y no 20px) | Escala `fontSize` de la v3 en la config |
| Paleta por defecto en OKLCH | El rojo de "Out Of Stock" y similares | Paleta 3.4.14 en hex (`apps/tailwind-v3-colors.js`, generada desde su `colors.js`) |
| Preflight: borde, anillo, placeholder, cursor | — (prevención) | Bloque de compatibilidad en `main.css` con los valores que emitía la 3.4.14 |
| `space-*` va en `:where()` y pone el margen en el hijo anterior | Submenú del admin +8px; "Pages" +16px por lado; título de preguntas −4px; paginación descuadrada | `-mt-2`, quitar el `mx-*` muerto, `mb-2 lg:mb-1`, regla de la v3 en `.rc-pagination` |
| La escala de espaciado admite cualquier valor | `lg:w-76` activaba una barra lateral de 304px en lugar de 288; contadores e iconos cambiaban | Quitar las 27 clases que en la v3 no generaban nada (decisión del dueño) |
| Utilidades de `display` ordenadas alfabéticamente | `hidden` perdía contra la raíz `inline-flex` de `Button`: aparecía el buscador en móvil | `max-lg:hidden` / `max-sm:hidden` (7 sitios) y `!flex` (1) |
| Otro orden para `h-9 h-10` | Botón "Join" del shop 4px más alto | Quitar el `h-10` (solo en el shop: en el admin ya ganaba el mismo) |

### CA-2 — Sin regresión visual ✅

Builds de producción (`next start`) del shop y el admin, con la API en
9001. Capturas a página completa con Playwright (venv del scraper), con
animaciones congeladas, a 1280 y 400 px. Rutas: shop `/`, `/shops`,
`/shops/gadget` y `/products/apples`; admin `/login`, `/`, `/products`,
`/orders`, `/coupons/create` y `/products` con `dir="rtl"` forzado (`/ar`
no está activo en este entorno). La comparación es píxel a píxel en el
navegador (umbral 24 en la suma de los canales RGB).

Ruido medido entre dos tandas de la v3 sin cambios: 0 % en todas las rutas
salvo la fecha del datepicker de `/coupons/create`, la gráfica de la home
del admin y el popup promocional del shop, que sale a destiempo.

Comparación final, v3 (`main`) contra v4 (`4005a10`):

| Captura | 1280 px | 400 px | Nota |
|---|---|---|---|
| shop `/` | 0 % | 0 % | |
| shop `/shops` | 0 % | 0 % | |
| shop `/shops/gadget` | 0,68 % | 0 % | esperada: "Add" se pinta con antialiasing subpíxel (mismo glifo y color `#333`) |
| shop `/products/apples` | 0 % | 0 % | |
| admin `/login` | 0 % | 0 % | |
| admin `/` | 0,18 % | 0,29 % | ruido: gráfica (filas 1428–1717 / 2160–2449) |
| admin `/products` | 0 % | 0 % | |
| admin `/products` RTL | 0,06 % | 0 % | ruido: la barra de OverlayScrollbars aún visible al cambiar `dir` |
| admin `/orders` | 0 % | 0 % | |
| admin `/coupons/create` | 0,05 % | 0,15 % | ruido: fecha del datepicker (mismas filas que entre dos tandas v3) |

Sin errores de consola en ninguna ruta. Los `Invalid href
'http://localhost:3003//'` y los 404 de recursos ya salían con la v3.

### CA-3 — Build ✅

`just build` termina sin errores (exit 0). CSS de producción
(`.next/static/css`):

| | v3 | v4 | Cambio |
|---|---|---|---|
| Shop, chunk de Tailwind | 197 582 B | 214 043 B (gzip 33 710) | +8,3 % |
| Shop, total | 293 659 B | 310 750 B | +5,8 % |
| Admin, chunk de Tailwind | 171 785 B | 181 871 B (gzip 28 480) | +5,9 % |
| Admin, total | 535 545 B | 545 897 B | +1,9 % |

Antes de fijar la paleta hex, el chunk del shop crecía un 11,1 %. La parte
fija de la v4 son unos 15 KB: `@property`, la capa `properties`, los
fallbacks `@supports (color: color-mix…)` y las variables de tema.

El único aviso del optimizador (admin) es
`:is(.\[\&button\]\:top-0\.5)button`. Viene de una clase mal escrita que ya
existía (`[&button]:top-0.5`); en la v3 generaba la misma regla inválida,
pero sin aviso.

### Otras verificaciones

```
just verify
OK   API    :9001/api/settings  200  5503B
OK   Shop   :3003/en  200  192827B  cards:30
OK   Admin  :3002/en/login  200  73158B  cards:1
```

- Lint (`yarn lint` en shop y admin): 0 problemas.
- `tsc --noEmit -p tsconfig.json --types node,google.maps`: shop 0
  errores; admin 1, el heredado `back-to-top.tsx(41,10)`.
- Clases que la v3 emitía y la v4 no, sobre el mismo código: solo los
  renombres previstos y subcadenas que la v3 recogía de más (`contents` de
  un comentario, `left-36` de `rtl:left-36`…). Apareció un caso real,
  `bg-opacity-[.15]` con valor arbitrario en `orders/status-color.tsx`, que
  pasó a `/15`.

### Commits

| Commit | Contenido |
|---|---|
| `83aa194` | `withOpacity` con `<alpha-value>` (preparatorio; con la 3.4.14 el CSS solo cambia `rgb(var(--x))` por `rgba(var(--x), 1)`) |
| `3e4819a` | Dependencias, PostCSS, `@config`, compatibilidad con la v3, paleta y escala de texto, `@reference` en los CSS modules |
| `b5109bb` | Renombres del codemod (228 archivos) |
| `4005a10` | Ajustes de la tabla anterior (25 archivos, con sus renombres) |

### Riesgo residual (para el dueño)

Las capturas cubren 11 rutas. Los cambios de comportamiento de arriba
pueden aparecer en otras pantallas:

- **Hijos con margen propio dentro de un `space-*`.** La v3 los pisaba y la
  v4 los respeta. Un barrido aproximado encuentra 36 candidatos (muchos son
  nietos, no hijos): en el shop, `checkout/*/verified-item-list`,
  `dashboard/sidebar`, `products/cards/radon`, `products/details/*`,
  `questions/*`, `reviews/review-card`, `rating-progress-bar` y
  `checkout/{index,guest}`; en el admin, `verified-item-list`,
  `flash-sale-form`, `openAI.modal`, `question-list`, `reviews/*` y
  `verify-license`. Se arreglan como los de la tabla cuando se vean.
- **Componentes con raíz `inline-*` que reciben `hidden`, `flex` o
  `grid`.** Se revisaron `Button`, `LinkButton`, `Badge`, `Avatar`, `Logo`,
  `Link`, `Spinner`, `Counter` y `JoinButton`. Puede haber otros.
- **Navegadores:** la v4 necesita Safari 16.4, Chrome 111 o Firefox 128 como
  mínimo (`@property`, `color-mix()`, cascade layers).
- **`hover:`** solo se aplica en dispositivos con `hover` (en táctiles ya no
  se queda pegado).

### Fuera de alcance (siguen, no se tocaron)

- `tailwind-merge` 2.5.4 conoce las clases de la v3: `twMerge` no resuelve
  conflictos de clases nuevas como `outline-hidden`. La 3.x es la de
  Tailwind 4.
- En el admin, `ReactToastify.css` se importa antes que `main.css` y el
  `@import` de las fuentes queda a mitad del chunk, así que el navegador lo
  ignora. Ya pasaba con la v3.
- En el shop, `space-s-2` (`review-card`), `rounded-be` (`coupon`) y
  `origin-top-end` (`ui/menu`): son clases de `tailwindcss-rtl`, plugin que
  el shop nunca tuvo, así que no hacían nada y siguen sin hacerlo.
- Pasar el tema a `@theme` (DA-1 a), cuando se quiera.
- admin/graphql en Tailwind 3.
