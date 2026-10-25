# US-89 — TypeScript 6 en la API

> El CLI y los schematics de NestJS 12 exigen TypeScript 6. Esta US sube la
> API de TypeScript 5.9.3 a 6.x, todavía en CommonJS y en Nest 11, para que
> el cambio de compilador no se mezcle con el de ESM (US-90).

**Épico:** [Épico 75](./README.md)
**Fecha:** 2026-10-24
**Status:** Listo para ejecución
**Depende de:** US-88 (Vitest; ts-jest declara `typescript >=4.3 <7` y deja
de importar)
**LOC est.:** ~80

## Historia

**Como** mantenedor de la API, **quiero** TypeScript 6, **para** cumplir el
requisito del CLI de Nest 12 sin tocar todavía el sistema de módulos.

## Contexto — verificado (2026-10-24)

- **Versiones:** la última es `typescript@6.0.3`, publicada el 2026-04-16.
  La API declara `^5.9.3` (US-77).
- **Lo que pide Nest 12:** según la guía de migración, `nest upgrade` sube
  TypeScript a v6 y revisa `tsconfig.json` y `tsconfig.build.json` en busca
  de opciones que TypeScript 6 ya no admite, «como un `moduleResolution`
  legacy o un `rootDir` que falta».
- **El `tsconfig.json` de la API hoy:**
  - `"module": "commonjs"`, sin `moduleResolution` (cae en el legacy
    `node10`);
  - `"target": "es2017"`, `baseUrl: "./"`, `paths` para `@db/*` y
    `types: ["node", "express", "multer"]`;
  - sin `rootDir`.
- **`typescript-eslint`** está en 5.62 (US-81 lo sube a la 8) y puede no
  soportar TypeScript 6.

## Scope

**Incluye:**

- `typescript` 6.x;
- los ajustes de `tsconfig.json` y `tsconfig.build.json` que TypeScript 6
  exija (`moduleResolution`, `rootDir`, `baseUrl`/`paths` si están
  obsoletos), con la menor diferencia posible y sin cambiar a ESM;
- lo que haga falta en `src/` para compilar sin errores, sin `as any` ni
  `@ts-ignore`.

**NO incluye:** ESM (US-90), Nest 12 (US-91) ni las reglas de lint (US-81).

## Criterios de aceptación

### CA-1 — Compila sin avisos de obsolescencia

`npx tsc --noEmit -p tsconfig.json` y `yarn build` dan 0 errores y ningún
aviso de opción obsoleta.

### CA-2 — Misma batería y mismo contrato

`npx vitest run` mantiene las cifras de US-88. La huella de contrato de
US-78 (27 peticiones, con la API levantada) da idéntica.

### CA-3 — El lint sigue corriendo

El lint sin escribir sigue en 0. Si `typescript-eslint` 5.62 no admite
TypeScript 6, la US se detiene y pregunta si adelanta US-81.

## Escenarios Gherkin

```gherkin
Feature: API en TypeScript 6
  Scenario: CA-2 — nada visible cambia
    Given la huella de contrato tomada en TypeScript 5.9
    When la API compila con TypeScript 6
    Then las 27 respuestas son idénticas
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `apps/api/rest/package.json`, `yarn.lock` | `typescript` |
| `apps/api/rest/tsconfig.json`, `tsconfig.build.json` | lo que exija TypeScript 6 |
| `apps/api/rest/src/**` | solo errores nuevos de tipos |

## Definición de Done

- [ ] Línea base (tsc, build, vitest y huella de contrato) en TypeScript 5.9.
- [ ] CA-1..CA-3 con la salida pegada.
- [ ] Status actualizado aquí y en la tabla del épico.

## Notas para el agente ejecutor

- Lee con Context7 las notas de versión de TypeScript 6.0 (opciones
  retiradas y cambios de valores por defecto) antes de tocar el
  `tsconfig`.
- La huella de contrato no está en el repo (US-78 la dejó en un directorio
  temporal). Si no la tienes, reescríbela a partir de la tabla de CA-2 de
  US-78.
