# US-86 — Tailwind 3 → 4 en shop y admin

> Sube Tailwind CSS de 3.4.14 a la última 4.x en el shop y el admin. La v4
> cambia la configuración (CSS en lugar de `tailwind.config.js`), el
> pipeline de PostCSS y cómo se cargan los plugins.

**Épico:** [Épico 75](./README.md)
**Fecha:** 2026-10-24
**Status:** Listo para ejecución
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

- [ ] DA-1 y DA-2 confirmadas.
- [ ] CA-1..CA-3 con la evidencia (capturas y tamaños).
- [ ] Status actualizado aquí y en la tabla del épico.

## Notas para el agente ejecutor

- Lee con Context7 la guía oficial *Upgrade guide* de Tailwind v4. Valora
  `npx @tailwindcss/upgrade` y revisa su diff a mano.
