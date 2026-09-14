# Proposal: Guardas de id fuera del rango `bigint`

> **US-31**, standalone (sin épico). Insumo primario: el `exploration.md` de
> este change. **Decisión de scope ya tomada por el usuario (vinculante):**
> `users` SÍ entra ("Lectura A" de la sección 3-bis). No se re-litiga aquí.

## Intent

`Number.isInteger(1e21) === true`. Trece guardas de id de la API usan ese
predicado, así que un id en notación exponencial o mayor a `2^53` las
atraviesa, llega al driver de Postgres como `bigint` y revienta en un **500
literal**: `translateCatalogWriteError` solo traduce `P2002`/`P2003`/`P2025`
y `withPrismaErrorTranslation` solo distingue errores de conexión — el error
del driver sale intacto por ambos y cae en la rama final del mapper.

`categories` (US-28) y `shops` (US-30) ya tienen el arreglo. Esta US alinea lo
que falta: corrección mecánica de un patrón ya validado, no un diseño nuevo.

## Scope

### In Scope

1. **Seis guardas de servicio del catálogo** — `types.service.ts:126,151`;
   `tags.service.ts:170,200`; `manufacturers.service.ts:218,254`:
   `!Number.isInteger(id)` → `!Number.isSafeInteger(id) || id <= 0`.
2. **Cinco guardas de servicio de `users`** — `users.service.ts:94,113,142,165,211`
   (`findOne`, `update`, `makeAdmin`, `banUser`, `activeUser`): mismo patrón.
3. **Dos guardas de FK en `packages/db`** — `manufacturers.repository.ts:139` y
   `tags.repository.ts:115` (`_assertValidTypeId`): `!Number.isInteger(typeId)`
   → `!Number.isSafeInteger(typeId)`, **sin** `<= 0` (ver D31-2).
4. **Red de regresión (CA-4)** — `it.each` con `NaN`/`0`/`-5`/`1e21` calcado de
   `categories.service.spec.ts:383-397`, en los `*.service.spec.ts` de `types`,
   `tags`, `manufacturers` y `users`.
5. **Enmienda del documento de la US** — `docs/product/31-…md` no nombra `users`
   en ninguna parte: actualizar «Incluye», CA-1, los Gherkin, la tabla de
   archivos, la LOC y la DoD (`curl` + decisión sobre `shops`). Es entregable.

### Out of Scope (vinculante)

- `translateCatalogWriteError`, el conjunto cerrado de códigos de dominio (CA-7
  de US-27a es contrato), `withPrismaErrorTranslation` y
  `domain-error.mapper.ts`. El arreglo vive en el guard de entrada.
- Un `ExceptionFilter` global.
- `categories` (US-28) y `shops` (US-30): ya corregidos, con cita de línea.
- `products.repository.ts:511` (`_assertIntegerCount` sobre `quantity`, columna
  `integer` — otra familia de overflow) y `categories.repository.ts:248` (lookup
  en un `Map` en memoria, no llega al driver).
- DDL y frontend.
- **Nota de seguimiento, no se acciona**: `shops.controller.ts:77-79`
  (`disapproveShop` llama por error a `approve(+id)`). Merece US propia.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `flat-catalogs-api`: los requisitos "Errores de dominio de `types` nunca
  producen 500 (CA-4)" y su gemelo de `tags`/`manufacturers` se extienden a ids
  y `type_id` fuera del rango seguro, no solo a los códigos de dominio.
- `user-management-api`: CA-3 (detalle) y CA-4 (bloqueo/desbloqueo/promoción)
  se extienden al mismo criterio de id.

## Approach

**D31-1 — `Number.isSafeInteger`, no una validación de rango `bigint` real.**
Validar contra `2^63` sería teatro: el valor ya llegó a JS como `number` (el
controlador hace `+id`), y por encima de `2^53` un `number` no tiene identidad
entera fiable — `9223372036854775807` ya se redondea al parsearse. Una cota que
el propio tipo no puede representar no es una cota. `2^53` es la frontera real
por debajo de la cual el id sigue siendo el que el cliente escribió, y la que ya
eligieron `categories`, `shops`, `products` y `auth`.

**D31-2 — Asimetría deliberada: guard de ruta `|| id <= 0`, guard de FK sin él.**
Es el matiz más fácil de romper. El guard de ruta protege el PK de `:id`: ningún
id real es `<= 0` (`bigserial` arrancando en 1; se barrió `db/seed.sql` sin
encontrar filas con 0 o negativo), así que rechazarlo con 404 evita un round
trip inútil. El guard de FK valida `type_id`: un valor no positivo **sí** es
representable como `bigint`, el driver no revienta y ya resuelve correctamente
más abajo vía `P2003` → `InvalidReferenceError` → 400. Añadir `<= 0` ahí sería
una regla de negocio nueva no autorizada. Mismo criterio que
`categories.repository.ts:329` y `products.repository.ts:486`.

**D31-3 — Dos caminos de traducción, un solo arreglo.** El catálogo sale por
`toWriteHttpException` y `users` por el wrapper local
`withPrismaErrorTranslation`. Traductores distintos, mismo punto ciego: ambos
reconocen un conjunto cerrado de errores y degradan "cualquier otra cosa" a 500,
y el error del driver no está en ninguno de los dos conjuntos, por diseño. Por
eso el arreglo es idéntico: no se toca el traductor, se impide que el valor
llegue al driver.

**D31-4 — Status HTTP por ruta: ninguno cambia.** Las once guardas lanzan hoy
`NotFoundException` (verificado leyendo cada `throw`). Se conserva 404 en las
once: solo se amplía *qué valores* caza la guarda, no *qué responde*. Así CA-3
(sin regresión de contrato) es trivialmente cierta, y es lo que fijan los tests.
El 400 de `shops.service.ts:373` no es precedente aplicable: es un id de body de
un módulo que no tocamos.

| Ruta | Guarda | Excepción | Status |
|---|---|---|---|
| `PUT`/`DELETE /api/types/:id` | `types.service.ts:126,151` | `NotFoundException` | 404 |
| `PUT`/`DELETE /api/tags/:id` | `tags.service.ts:170,200` | `NotFoundException` | 404 |
| `PUT`/`DELETE /api/manufacturers/:id` | `manufacturers.service.ts:218,254` | `NotFoundException` | 404 |
| `GET`/`PUT /api/users/:id` | `users.service.ts:94,113` | `NotFoundException` | 404 |
| `POST /api/users/make-admin` (`@Body('user_id')`) | `users.service.ts:142` | `NotFoundException` | 404 |
| `POST /api/users/block-user` (`@Body('id')`) | `users.service.ts:165` | `NotFoundException` | 404 |
| `POST /api/users/unblock-user` (`@Body('id')`) | `users.service.ts:211` | `NotFoundException` | 404 |
| `POST`/`PUT /api/tags`, `/api/manufacturers` (`type_id` de body) | `_assertValidTypeId` | `InvalidReferenceError` → `BadRequestException` | 400 |

## Affected Areas

| Área | Impacto | Descripción |
|------|---------|-------------|
| `apps/api/rest/src/{types,tags,manufacturers}/*.service.ts` | Modified | 6 guardas (~6 líneas + comentario) |
| `apps/api/rest/src/users/users.service.ts` | Modified | 5 guardas (~5 líneas + comentario) |
| `packages/db/src/repositories/{tags,manufacturers}.repository.ts` | Modified | 2 guardas de FK, sin `<= 0` |
| `apps/api/rest/src/{types,tags,manufacturers}/*.service.spec.ts` | Modified | 6 `it` de solo `NaN` → 6 `it.each` de 4 casos |
| `apps/api/rest/src/users/users.service.spec.ts` | Modified | 5 `it.each`; hoy `update` no tiene **ningún** test de id inválido y `activeUser` tampoco |
| `docs/product/31-guardas-id-fuera-de-rango-bigint.md` | Modified | Enmienda por la ampliación a `users` |

**LOC estimada: ~230** (US original ~120). Reparto: producción ~25 (13 guardas +
comentarios); tests catálogo ~75; tests `users` ~85; enmienda de la US ~45. Cabe
en el presupuesto de 400 líneas de revisión con poco margen: si `sdd-tasks` lo ve
apretado, el corte natural es PR1 catálogo + FK, PR2 `users`, PR3 documento.

## Risks

| Riesgo | Prob. | Mitigación |
|---|---|---|
| Alguna ruta depende hoy de aceptar id `0`, negativo o `> 2^53` | Baja | Verificado en el catálogo (seed arranca en 1, ningún servicio trata `0` como especial). Se extiende a `users`: `users.id` es `bigserial`, el id sale del token o de la fila, y `banUser` compara `currentUser.sub === id` — un `sub` nunca es `<= 0` |
| Aplicar `<= 0` por inercia al guard de FK | Media | D31-2 explícito; el test de FK debe seguir esperando 400 vía `P2003` para un `type_id` negativo |
| `it.each` con `1e21` y fricción de tipos en TS | Baja | Ya probado en `categories.service.spec.ts:387` |
| Blast radius: `users` son rutas admin-only | Media | Sin cambio de permisos ni de status; su suite se ejecuta entera |
| El status real solo se confirma en vivo | Media | No se levantó la API en esta fase; **nada de lo anterior es una respuesta observada**. Los `curl` de la DoD son obligatorios en `apply`/`verify` |

## Rollback Plan

El cambio es aditivo en restricción y no toca datos, DDL ni contratos. Revertir
el commit (o los de cada PR de la cadena) devuelve el estado anterior. No hay
migración que deshacer ni artefacto que regenerar más allá de `just db-build`
(por los dos repositorios de `packages/db`). Los bloques 1, 2 y 3 son
independientes: se pueden revertir por separado sin dejar el código
inconsistente.

## Dependencies

- `just db-build` antes de jest (`@safari/db` resuelve contra `packages/db/dist`).
- `just db-up` antes de `just db-check`.
- Ninguna otra US: US-28 y US-30 ya están mergeadas y solo aportan el precedente.

## Success Criteria

- [ ] Las 13 guardas usan `Number.isSafeInteger`; las 11 de ruta con `|| id <= 0`,
      las 2 de FK sin él.
- [ ] CA-1: `1e21`, `9223372036854775808`, `-1`, `0` y `1.5` dan 4xx con cuerpo
      útil en las 11 rutas. Cero 500. `curl` pegados.
- [ ] CA-2: `123456789012345` (dentro de `MAX_SAFE_INTEGER`) sigue dando 404 por fila
      inexistente, no 400. `curl` pegado.
- [ ] CA-4: cada guarda tiene un caso que falla si se revierte a
      `Number.isInteger` (el caso `NaN` **no** sirve: pasa con ambos).
- [ ] `cd apps/api/rest && npx jest` verde con recuento (hoy 4 suites / 65 tests;
      sin receta de `just`, requiere `just db-build`).
- [ ] `just db-check` verde con recuento (requiere `just db-up`).
- [ ] `just build-api` y `just verify` verdes.
- [ ] Decisión sobre `shops` documentada: **no aplica**, US-30 ya lo corrigió
      (`shops.service.ts:285,373`).
- [ ] `docs/product/31-…md` enmendado (Incluye, CA-1, Gherkin, tabla de
      archivos, LOC, DoD) y su Status actualizado.
