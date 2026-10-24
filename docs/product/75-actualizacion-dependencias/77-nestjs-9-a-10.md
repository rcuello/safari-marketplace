# US-77 — NestJS 9 → 10 y TypeScript 5 en la API

> Sube la API de NestJS 9.4.3 (sin soporte) a la última 10.x, con los
> paquetes del ecosistema que la acompañan y TypeScript 5.9. Es la primera
> de tres mayores (D-1).

**Épico:** [Épico 75](./README.md)
**Fecha:** 2026-10-24
**Status:** Implementada (2026-10-24)
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

- [x] Línea base: `npx jest`, el lint sin escribir, `just build-api` y los
      cuatro `curl` con código y bytes. Se ampliaron a 12 peticiones, ver
      CA-2.
- [x] CA-1..CA-3 con la salida pegada.
- [x] Lint sin escribir en 0 (`npx eslint "{src,apps,libs,test}/**/*.ts"`).
- [x] Status actualizado aquí y en la tabla del épico.

## Resultado — ejecutado el 2026-10-24

**DA-3 del épico:** se aplicó la propuesta por defecto, TypeScript 5.9.3.

### Versiones

| Paquete | Antes (instalado) | Después | Rango en `package.json` |
|---|---|---|---|
| `@nestjs/common`, `core`, `platform-express`, `testing` | 9.4.3 | 10.4.22 | `^10.4.22` |
| `@nestjs/cli` | 9.5.0 | 10.4.9 | `^10.4.9` |
| `@nestjs/schematics` | 9.2.0 | 10.2.3 | `^10.2.3` |
| `@nestjs/swagger` | 6.3.0 | 7.4.2 | `^7.4.2` |
| `@nestjs/config` | 2.3.4 | 3.3.0 | `^3.3.0` |
| `@nestjs/jwt` | 9.0.0 | 10.2.0 | `^10.2.0` |
| `@nestjs/mapped-types` | 1.1.0 | 2.1.1 | `2.1.1` (exacta, como antes) |
| `typescript` | 4.9.5 | 5.9.3 | `^5.9.3` |
| `jest` | 28.1.3 | 29.7.0 | `29.7.0` (exacta, como antes) |
| `ts-jest` | 28.0.8 | 29.4.14 | `29.4.14` (exacta, ver abajo) |
| `@types/jest` | 28.1.8 | 29.5.14 | `^29.5.14` |
| `@types/node` | 18.19.130 | 20.19.43 | `^20.19.43` |

- **ts-jest va exacto en 29.4.14.** La 29.4.15 salió el 2026-10-15, hace
  menos de dos semanas, y un rango `^29.4.14` la resolvería en el próximo
  `yarn install` sin lockfile.
- **Fechas:** todas las demás versiones tienen más de dos semanas. Las más
  recientes son `@nestjs/core` 10.4.22 (2026-01-10) y `@nestjs/mapped-types`
  2.1.1 (2026-03-31).
- **Código:** no hizo falta tocar `src/`, `tsconfig.json`, `nest-cli.json`
  ni la configuración de jest. Solo cambian `package.json` y `yarn.lock`.
- **`nestjs-stripe` 1.0.0** (publicado en 2022) declara peers `@nestjs/*
  ^6 || ^7 || ^8` y `stripe ^8`. Ya los incumplía con Nest 9, y yarn solo
  avisa. Sigue funcionando: la API arranca y `StripeModule` se resuelve.
  Sustituirlo es tema de US-87.

### CA-1 — Misma batería

```
$ npx jest                     # antes (Nest 9) y después (Nest 10)
Test Suites: 34 passed, 34 total
Tests:       565 passed, 565 total

$ npx tsc --noEmit -p tsconfig.json
tsc EXIT=0

$ npx eslint "{src,apps,libs,test}/**/*.ts"
eslint EXIT=0
```

`@typescript-eslint` 5.62 no muestra ningún aviso de versión no soportada
con TypeScript 5.9.

### CA-2 — Mismos contratos (D-5)

Los cuatro `curl` de la US se ampliaron a 12 peticiones con un script que
guarda, para cada una, el código, los bytes y el sha256 del cuerpo, en Nest
9 y en Nest 10. Las peticiones nuevas son:

- dos errores de login (cuerpo vacío y contraseña mala);
- `POST /messages/seen/999999` con cuerpo desnudo `1`, que comprueba el
  parser no estricto de US-64 en `main.ts`;
- un id fuera del rango bigint;
- `/docs-json`.

| Petición | Nest 9 | Nest 10 |
|---|---|---|
| `POST /token` (login) | 201, claves `permissions,role,token` | igual |
| `GET /settings` | 200, 5504 B, `847a1e29…` | idéntica |
| `GET /products?limit=5` | 200, 5145 B, `7a88bbce…` | idéntica |
| `GET /products?search=name:apple&limit=5` | 200, 5318 B, `9cfa00c4…` | idéntica |
| `GET /shops` | 200, 13788 B, `b6764f4a…` | idéntica |
| `GET /categories?limit=3` | 200, 4254 B, `cff35456…` | idéntica |
| `GET /me` (admin) | 200, 1345 B, `7fb72c0c…` | idéntica |
| `GET /docs-json` | 200, 178512 B, 169 rutas | 200, 178512 B, 169 rutas |
| `POST /token {}` | 401, 87 B | 401, 87 B, **claves en otro orden** |
| `POST /token` con contraseña mala | 401, 87 B | 401, 87 B, **claves en otro orden** |
| `POST /messages/seen/999999` cuerpo `1` | 404, 93 B | 404, 93 B, **claves en otro orden** |
| `GET /products/999999999999999999999` | 404, 106 B | 404, 106 B, **claves en otro orden** |

**Cambio aceptado por el dueño (2026-10-24):** en Nest 10, `HttpException`
arma el cuerpo de error con otro orden de claves. Las claves y los valores
son los mismos:

```
Nest 9 : {"statusCode":404,"message":"No existe un producto con slug `999999999999999999999`.","error":"Not Found"}
Nest 10: {"message":"No existe un producto con slug `999999999999999999999`.","error":"Not Found","statusCode":404}
```

Ningún cliente depende del orden. El shop y el admin leen el error por
nombre (`grep`: 44 × `response?.data.message`, 5 × `response?.data?.message`,
1 × `response.data.message` y 1 × `response?.data.errors`), y jest pasa.
**Las US-78 y US-79 tienen que comparar contra este orden de Nest 10**, no
contra el de Nest 9.

Con la API en Nest 10, el shop y el admin funcionan:

```
$ just verify
OK   API    :9001/api/settings  200  5503B  669ms
OK   Shop   :3003/en  200  190839B  842ms  cards:30
OK   Admin  :3002/en/login  200  72821B  106ms  cards:1
```

- **Shop:** 190839 bytes y 30 tarjetas, lo mismo que en US-76.
- **Login del admin:** con `admin@demo.com` llega al dashboard como «Super
  Admin».
- **`/products` del admin:** 20 filas. Las 9 peticiones a la API responden
  200 o 304. La consola solo muestra el `Invalid href
  'http://localhost:3003//'` que ya se vio en US-76.

### CA-3 — Build y Swagger

```
$ just build-api
$ rimraf dist
$ nest build
Done in 37.63s.          # EXIT=0

$ curl http://localhost:9001/docs        → 200, 3126 B, <title>Swagger UI</title>
$ curl http://localhost:9001/docs-json   → openapi 3.0.0, «Marvel», 169 rutas, 196 schemas
```

## Notas para el agente ejecutor

- Lee la guía oficial de migración a v10 (docs.nestjs.com, sección
  *Migration guide*) con Context7 antes de tocar nada; no la escribas de
  memoria.
- `@typescript-eslint` 5.62 declara soporte hasta TypeScript 5.1 y puede
  avisar con la 5.9. Si es solo un aviso, se anota y lo resuelve US-81. Si
  el lint deja de correr, se para y se pregunta.
