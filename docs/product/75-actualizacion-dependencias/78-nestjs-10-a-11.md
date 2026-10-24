# US-78 — NestJS 10 → 11 (Express 5)

> Sube la API a la última 11.x. Es la mayor con más riesgo de
> comportamiento: `@nestjs/platform-express` 11 corre sobre Express 5, que
> cambia el enrutado y el parser de query strings.

**Épico:** [Épico 75](./README.md)
**Fecha:** 2026-10-24
**Status:** Listo para ejecución
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

- [ ] Línea base de los `curl` de CA-2, tomada en Nest 10.
- [ ] CA-1..CA-3 con la salida pegada.
- [ ] Lint sin escribir en 0.
- [ ] Status actualizado aquí y en la tabla del épico.

## Notas para el agente ejecutor

- Lee con Context7 la guía oficial de migración a v11 y la de Express 5
  antes de tocar código.
- Si el parser simple cambia algún resultado, la salida conservadora es
  volver a `qs` (`'query parser', 'extended'`). Anótalo como decisión en la
  US.
