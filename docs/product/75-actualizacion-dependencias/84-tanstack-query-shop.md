# US-84 — react-query 3 → @tanstack/react-query 5 en el shop

> `react-query` 3.39.3 ya no recibe versiones. Su sucesor es
> `@tanstack/react-query`, cuya última es la 5.104.5. Esta US migra el shop,
> que tiene menos superficie que el admin, y deja el patrón para US-85.

**Épico:** [Épico 75](./README.md)
**Fecha:** 2026-10-24
**Status:** Listo para ejecución
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

- [ ] Línea base (`just verify`, consola de las rutas de humo).
- [ ] CA-1..CA-3 con la salida pegada.
- [ ] `yarn lint` del shop sin hallazgos nuevos y `tsc --noEmit` sin
      superar su línea base.
- [ ] Status actualizado aquí y en la tabla del épico.

## Notas para el agente ejecutor

- Lee con Context7 la guía oficial *Migrating to TanStack Query v5*. Valora
  el codemod oficial, y revisa su diff a mano.
- R-1: `react-query` lo sigue usando el admin hasta US-85. No lo quites de
  `apps/yarn.lock` a mano.
