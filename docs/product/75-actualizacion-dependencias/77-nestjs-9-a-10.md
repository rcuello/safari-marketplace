# US-77 — NestJS 9 → 10 y TypeScript 5 en la API

> Sube la API de NestJS 9.4.3 (sin soporte) a la última 10.x, con los
> paquetes del ecosistema que la acompañan y TypeScript 5.9. Es la primera
> de tres mayores (D-1).

**Épico:** [Épico 75](./README.md)
**Fecha:** 2026-10-24
**Status:** Listo para ejecución
**Depende de:** ninguna (puede ir en paralelo con US-76 y US-80)
**LOC est.:** ~150

## Historia

**Como** mantenedor de la API, **quiero** salir de NestJS 9, **para**
volver a una línea con parches y poder seguir subiendo de versión.

## Contexto — verificado (2026-10-24)

`apps/api/rest/package.json` hoy:

| Paquete | Declarado | Instalado | Destino |
|---|---|---|---|
| `@nestjs/common`, `core`, `platform-express`, `testing` | `^9.0.11` | 9.4.3 | 10.4.x (10.4.22) |
| `@nestjs/cli`, `@nestjs/schematics` | `^9.0.0` / `^9.0.1` | 9.5.0 / 9.2.0 | 10.x |
| `@nestjs/swagger` | `^6.0.5` | 6.3.0 | 7.x (la que pide `@nestjs/core ^10`) |
| `@nestjs/config` | `^2.2.0` | 2.3.4 | 3.x |
| `@nestjs/jwt` | `^9.0.0` | 9.0.0 | 10.x |
| `@nestjs/mapped-types` | `1.1.0` | 1.1.0 | 2.x |
| `typescript` | `^4.7.4` | 4.9.5 | 5.9.x (DA-3) |
| `jest` / `ts-jest` / `@types/jest` | 28.1.3 / `^28.0.8` / 28 | — | 29.x |
| `@types/node` | `^18.7.6` | 18.19 | 20.x |

- `@nestjs/core@10.4.22` pide `reflect-metadata ^0.1.12 || ^0.2.0` y
  `rxjs ^7.1.0`. Los dos ya se cumplen.
- La configuración de jest está en el bloque `jest` del `package.json`, con
  `moduleNameMapper` y `transformIgnorePatterns` (ver `CLAUDE.md`). ts-jest
  29 la tiene que respetar sin cambios.

## Scope

**Incluye:**

- los paquetes de la tabla y lo mínimo que exijan sus peers (D-1);
- los ajustes de código que pida la guía de migración de Nest 10;
- `tsconfig.json` solo si TypeScript 5 lo exige.

**NO incluye:**

- NestJS 11 (US-78);
- ESLint 9, `typescript-eslint` 8 y Prettier 3 (US-81);
- `stripe` (US-87);
- refactors que la nueva versión permita pero no exija.

## Criterios de aceptación

### CA-1 — Misma batería

`npx jest` da 34 suites y 565 tests en verde. Si hay cambios, son solo los
que exige la migración, cada uno justificado en el reporte.

### CA-2 — Mismos contratos (D-5)

Con la API arriba, `just verify` responde. Además, `curl` a `/api/settings`,
`/api/products?limit=5`, `/api/shops` y `POST /api/token` (login) da el mismo
código y el mismo tamaño de cuerpo que antes.

### CA-3 — Build y Swagger

`just build-api` compila y `/docs` (Swagger) carga.

## Escenarios Gherkin

```gherkin
Feature: API en NestJS 10
  Scenario: CA-2 — contratos intactos
    Given las respuestas de 4 rutas medidas antes de subir
    When la API corre en NestJS 10
    Then cada ruta devuelve el mismo código y el mismo tamaño
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `apps/api/rest/package.json`, `yarn.lock` | versiones |
| `apps/api/rest/src/**` | solo lo que exija la migración |
| `apps/api/rest/tsconfig*.json` | si TypeScript 5 lo exige |

## Definición de Done

- [ ] Línea base: `npx jest`, el lint sin escribir, `just build-api` y los
      cuatro `curl` con código y bytes.
- [ ] CA-1..CA-3 con la salida pegada.
- [ ] Lint sin escribir en 0 (`npx eslint "{src,apps,libs,test}/**/*.ts"`).
- [ ] Status actualizado aquí y en la tabla del épico.

## Notas para el agente ejecutor

- Lee la guía oficial de migración a v10 (docs.nestjs.com, sección
  *Migration guide*) con Context7 antes de tocar nada; no la escribas de
  memoria.
- `@typescript-eslint` 5.62 declara soporte hasta TypeScript 5.1 y puede
  avisar con la 5.9. Si es solo un aviso, se anota y lo resuelve US-81. Si
  el lint deja de correr, se para y se pregunta.
