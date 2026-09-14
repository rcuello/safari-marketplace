# Delta for Flat Catalogs Api

## MODIFIED Requirements

### Requirement: Errores de dominio de `types` nunca producen 500 (CA-4)

`PUT`/`DELETE /api/types/:id` con un id inexistente MUST responder 404.
`POST`/`PUT /api/types` con un `name` vacío o que slugifica a cadena vacía
MUST responder 400, sin crear fila. Un slug que colisiona con uno existente
MUST resolverse con el sufijo incremental de `catalog-write-foundations`
(NUNCA un error). Ningún caso de esta Requirement MUST producir un 500 ni
un log de stack.

El `id` de ruta de `PUT`/`DELETE /api/types/:id` MUST rechazarse con 404
(antes de invocar el repositorio) cuando `!Number.isSafeInteger(id) || id <=
0`: cubre `NaN`, decimales (`1.5`), cero, negativos, y cualquier valor por
encima de `Number.MAX_SAFE_INTEGER` (`1e21`, `9223372036854775808`). Un id
dentro del rango seguro que no exista en la tabla (p. ej. `123456789012345`) MUST
seguir respondiendo 404 por fila inexistente, nunca 400: el corte está
exactamente en `Number.isSafeInteger`, no antes.
(Previously: exigía 404 sin fijar el criterio de validez del id; el guard
usaba `!Number.isInteger(id)`, que deja pasar `1e21` hasta el driver.)

#### Scenario: CA-4 — id inexistente
- GIVEN ningún type con id `99999`
- WHEN se hace `PUT /api/types/99999` o `DELETE /api/types/99999`
- THEN la respuesta es 404, sin stack trace en el log

#### Scenario: CA-4 — nombre que slugifica a vacío
- WHEN se hace `POST /api/types` con `name "!!!"`
- THEN la respuesta es 400
- AND no se crea ninguna fila en `types`

#### Scenario: CA-4 — colisión de slug no es un error
- GIVEN un type con slug `gadget`
- WHEN se hace `POST /api/types` con `name "Gadget"`
- THEN la respuesta es 201 con `slug "gadget-2"`

#### Scenario: CA-4 — id de ruta fuera del rango seguro nunca llega al driver
- GIVEN un id de ruta `1e21`, `9223372036854775808`, `-1`, `0` o `1.5`
- WHEN se hace `PUT /api/types/:id` o `DELETE /api/types/:id` con ese id
- THEN la respuesta es 404 y nunca 500
- AND el repositorio no se invoca

#### Scenario: CA-4 — el límite no se adelanta
- GIVEN un id de ruta `123456789012345` (dentro de `Number.MAX_SAFE_INTEGER`) que no
  existe en la tabla
- WHEN se hace `DELETE /api/types/123456789012345`
- THEN la respuesta es 404 por fila inexistente, nunca 400

#### Scenario: CA-4 — antirregresión del predicado de rango
- GIVEN un id de ruta `1e21`, `0` o `-5` (el caso `NaN` no sirve de testigo:
  pasa tanto con `Number.isSafeInteger` como con `Number.isInteger`)
- WHEN el guard usa `Number.isSafeInteger(id) || id <= 0` en vez de
  `Number.isInteger(id)`
- THEN el test que fija este comportamiento MUST fallar si alguien revierte
  el guard al predicado anterior

### Requirement: Errores de dominio de `tags` y `manufacturers` nunca producen 500 (CA-4)

`PUT`/`DELETE` con id inexistente MUST responder 404. `POST`/`PUT` con
`name` vacío o que slugifica a vacío MUST responder 400 sin crear fila.
`POST`/`PUT` con `type_id` inexistente MUST responder 400
(`InvalidReference`) sin crear fila. Un slug que colisiona MUST resolverse
con el sufijo incremental de `catalog-write-foundations`, nunca un error.
Ningún caso MUST producir 500 ni log de stack.

El `id` de ruta de `PUT`/`DELETE /api/tags/:id` y
`/api/manufacturers/:id` MUST rechazarse con 404 (antes de invocar el
repositorio) cuando `!Number.isSafeInteger(id) || id <= 0`, mismo criterio
que `types`: cubre `NaN`, decimales, cero, negativos y valores por encima de
`Number.MAX_SAFE_INTEGER`. Un id dentro del rango seguro que no exista MUST
seguir respondiendo 404 por fila inexistente, nunca 400.

El `type_id` de body en `POST`/`PUT /api/tags` y `/api/manufacturers` MUST
rechazarse con 400 (`InvalidReference`) cuando `!Number.isSafeInteger(typeId)`
— **sin** la cláusula `<= 0`: un `type_id` cero o negativo es representable
como `bigint` y MUST seguir resolviendo en 400 por la vía existente (`P2003`
→ `InvalidReferenceError`), no por esta guarda. Esta asimetría respecto al
guard de ruta (que sí exige `id > 0`) es deliberada.
(Previously: exigía 404/400 sin fijar el criterio de validez de esos
valores; los guards usaban `!Number.isInteger`, que deja pasar `1e21` hasta
el driver.)

#### Scenario: CA-4 — `type_id` inexistente
- WHEN se hace `POST /api/tags` con `type_id 99999`
- THEN la respuesta es 400
- AND no se crea ninguna fila

#### Scenario: CA-4 — id inexistente y colisión de slug
- GIVEN ningún manufacturer id `99999`, y un tag con slug `"oferta"`
- WHEN `PUT /api/manufacturers/99999` y `POST /api/tags name "Oferta"`
- THEN la primera responde 404 y la segunda 201 con `slug "oferta-2"`

#### Scenario: CA-4 — id de ruta fuera del rango seguro nunca llega al driver
- GIVEN un id de ruta `1e21`, `9223372036854775808`, `-1`, `0` o `1.5`
- WHEN se hace `PUT /api/tags/:id`, `DELETE /api/tags/:id`,
  `PUT /api/manufacturers/:id` o `DELETE /api/manufacturers/:id` con ese id
- THEN la respuesta es 404 y nunca 500
- AND el repositorio no se invoca

#### Scenario: CA-4 — `type_id` fuera del rango seguro de bigint
- WHEN se hace `POST /api/tags` o `POST /api/manufacturers` con
  `type_id 1e21` o `type_id 9223372036854775808`
- THEN la respuesta es 400 y nunca 500
- AND no se crea ninguna fila

#### Scenario: CA-4 — `type_id` negativo o cero sigue siendo 400 por FK, no por la guarda
- WHEN se hace `POST /api/tags` o `POST /api/manufacturers` con
  `type_id -1` o `type_id 0`
- THEN la respuesta es 400, resuelta por el mismo camino que un `type_id`
  inexistente (`P2003` → `InvalidReferenceError`)
- AND no se crea ninguna fila

#### Scenario: CA-4 — el límite no se adelanta
- GIVEN un id de ruta `123456789012345` (dentro de `Number.MAX_SAFE_INTEGER`) que no
  existe en la tabla
- WHEN se hace `DELETE /api/tags/123456789012345` o `DELETE /api/manufacturers/123456789012345`
- THEN la respuesta es 404 por fila inexistente, nunca 400

#### Scenario: CA-4 — antirregresión del predicado de rango
- GIVEN un id de ruta `1e21`, `0` o `-5` (el caso `NaN` no sirve de testigo:
  pasa con ambos predicados)
- WHEN el guard usa `Number.isSafeInteger(id) || id <= 0` en vez de
  `Number.isInteger(id)`
- THEN el test que fija este comportamiento MUST fallar si alguien revierte
  el guard al predicado anterior
