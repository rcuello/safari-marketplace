# US-42 — `staffs` desde Postgres

> Las 8 rutas de staff dejan de devolver lista vacía y `null`, y pasan a leer
> y escribir el pivote staff↔tienda. No es un módulo mock: son huecos
> declarados dentro de `shops` y `users`, que ya leen Postgres.

**Épico:** [Épico 40](./README.md)
**Fecha:** 2026-09-15
**Status:** Listo para ejecución (bloqueada por US-41)
**Depende de:** [US-41](./41-esquema-identidad-extendida.md)
**LOC est.:** ~1200

## Historia
**Como** dueño de tienda y como admin, **quiero** gestionar el staff de una
tienda de verdad, **para** que el panel deje de mostrar una lista siempre
vacía y los permisos por tienda signifiquen algo.

## Contexto — verificado en código

- **No hay módulo `staffs`.** Las rutas viven repartidas en dos módulos ya
  migrados:
  - `StaffsController` (`apps/api/rest/src/shops/shops.controller.ts:99`) —
    6 rutas, delega en `ShopsService`.
  - `MyStaffsController` (`apps/api/rest/src/users/users.controller.ts:121`)
    y `AllStaffsController` (`:131`) — 1 ruta cada uno, delegan en
    `UsersService`. `all-staffs` está tras `@Permissions(...ADMIN_ONLY)`.
- Hoy: `ShopsService.getStaffs` devuelve `{ data: [], ...paginate(0, page,
  limit, 0, url) }` (`shops.service.ts:220-226`); `createStaff()` y
  `updateStaff()` devuelven `null` (`:359-366`, criterio `DD30-8`).
- Consecuencia de dimensionado: esta US **no** migra un módulo entero, rellena
  huecos en dos servicios vivos. Más barato, pero con más riesgo de regresión
  sobre identidad y catálogo (R-3 del épico).

## Scope

**Incluye:** las 8 rutas de staff leyendo y escribiendo el pivote de US-41; el
repositorio de funciones planas en `packages/db` con sus tests de integración;
la traducción camelCase→snake_case en los servicios de Nest; los tests de Nest
con `@safari/db` mockeado, siguiendo el patrón de las 9 suites existentes.

**NO incluye:** cambiar el contrato HTTP de ninguna de las 8 rutas;
`ownership-transfer`, `become-seller` ni `withdraws`; tocar
`permission_user` ni el sistema de permisos globales; frontend.

## Criterios de aceptación

### CA-1 — Lectura real, contrato intacto
`GET /staffs`, `GET /my-staffs` y `GET /all-staffs` devuelven staff de
Postgres con la misma forma de respuesta y la misma paginación que hoy. La
lista vacía deja de ser un literal: si no hay staff, sale vacía **porque la
consulta no encontró filas**.

### CA-2 — Escritura real
`POST /staffs` asigna un usuario como staff de una tienda y
`DELETE /staffs/:id` lo retira. Dejan de devolver `null`. La asignación
repetida MUST ser idempotente (PK compuesta), no un 500.

### CA-3 — Autorización preservada
**`my-staffs` y `all-staffs` están AMBAS tras `@Permissions(...ADMIN_ONLY)`
a nivel de clase** (`apps/api/rest/src/users/users.controller.ts:120` y
`:130`). Corregido el 2026-09-15: esta CA afirmaba antes que `my-staffs`
estaba «acotada al usuario autenticado», leído de un volcado que cortaba el
decorador. Ningún cambio de guard: los de US-23 se respetan tal cual. Si el
comportamiento correcto fuera acotar `my-staffs` al dueño de la tienda, eso
es un cambio de contrato y **no** entra en esta US: se menciona en el reporte.

### CA-4 — Errores de dominio, nunca crudos de Prisma
Usuario o tienda inexistente responde 404/400 según el precedente de US-25 y
US-30, no un error de Prisma filtrado. Ids fuera del rango `bigint` caen en
las guardas de US-31.

### CA-5 — Reloj explícito
Toda ruta de escritura fija `updatedAt: now()` desde `clock.ts`
(política de US-32). El test del invariante NO detecta una ruta olvidada: la
garantía es el inventario de rutas del repositorio, no la suite.

### CA-6 — Sin regresión
`just db-check`, `npx jest`, `just build-api` y `just verify` verdes con
recuentos. Los conteos del seed intactos.

## Escenarios Gherkin

```gherkin
Feature: Staff de tienda desde Postgres
  Scenario: CA-1 — la lista sale de la base
    Given una tienda con dos staff asignados
    When GET /staffs
    Then devuelve los dos con la paginacion de siempre

  Scenario: CA-2 — asignar staff dos veces es idempotente
    Given un usuario ya asignado como staff de una tienda
    When POST /staffs repite la misma pareja
    Then no se duplica la fila ni responde 500

  Scenario: CA-3 — all-staffs sigue siendo solo de admin
    Given un usuario sin rol de admin
    When GET /all-staffs
    Then responde 403 igual que hoy
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `packages/db/src/repositories/staff.repository.ts` | repositorio nuevo |
| `packages/db/src/repositories/staff.integration.test.ts` | tests de integración |
| `packages/db/index.ts` | barrel |
| `apps/api/rest/src/shops/shops.service.ts` | `getStaffs`/`createStaff`/`updateStaff` reales |
| `apps/api/rest/src/users/users.service.ts` | `getMyStaffs`/`getAllStaffs` reales |
| `apps/api/rest/src/shops/shops.service.spec.ts` | tests con `@safari/db` mockeado |
| `apps/api/rest/src/users/users.service.spec.ts` | ídem |

## Definición de Done

- [ ] `curl` contra las 8 rutas, con la salida pegada, antes y después.
- [ ] `just db-check` y `npx jest` verdes con recuentos.
- [ ] `just build-api` y `just verify` verdes.
- [ ] Inventario de rutas de escritura que fijan `updatedAt` pegado (CA-5).
- [ ] Status de esta US actualizado y su fila marcada en el épico.

## Notas para el agente ejecutor

- **El barrel `packages/db/index.ts` lo comparten las US del épico.** Si otra
  va en paralelo, quien arranque segundo rebasea sobre él.
- Esta US toca `shops.service.ts` y `users.service.ts`, que sostienen catálogo
  y autenticación. Las suites de `shops` y `users` de `apps/api/rest` son la
  red: correrlas antes de empezar para tener la línea base.
- No inventar rutas nuevas. Las 8 existen; esta US las llena.
