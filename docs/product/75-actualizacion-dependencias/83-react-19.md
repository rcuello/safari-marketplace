# US-83 — React 19 en shop y admin

> Sube React y react-dom de 18.2.0 a la última 19.x, ya con Next 16, y
> retira el pin de `resolutions` que se puso por el aviso de
> `fetchPriority` (D-3 del épico).

**Épico:** [Épico 75](./README.md)
**Fecha:** 2026-10-24
**Status:** Listo para ejecución
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

- [ ] Línea base en React 18 (consola y `tsc`).
- [ ] CA-1..CA-3 con la salida pegada.
- [ ] La tabla de librerías que hubo que subir, con su evidencia.
- [ ] Status actualizado aquí y en la tabla del épico.

## Notas para el agente ejecutor

- Lee con Context7 la guía oficial *React 19 Upgrade Guide*. Si aplica, usa
  los codemods que propone y revisa su diff a mano.
