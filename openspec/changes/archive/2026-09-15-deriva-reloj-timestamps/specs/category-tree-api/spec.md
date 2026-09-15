# Delta for Category Tree API

## MODIFIED Requirements

### Requirement: Edición y reenraizado sin ciclos, slug inmutable (CA-2)

`PUT /categories/:id` MUST actualizar los campos enviados y permitir mover
la categoría cambiando `parent`, respondiendo con la misma proyección de 16
claves que el `GET`. `slug` MUST NOT cambiar aunque cambie `name`.
`updated_at` MUST avanzar respecto al valor previo tras cualquier `PUT`
exitoso — la columna la fija el repositorio (`updatedAt: now()` desde
`packages/db/src/clock.ts`), no un trigger de base de datos, así que su
verificación MUST comparar por monotonía o por igualdad contra el reloj de
aplicación fijado en el test, nunca contra el reloj del servidor de
Postgres.
(Previously: "la columna la fija un trigger de base de datos, no el
repositorio, así que su verificación MUST comparar por monotonía contra el
reloj de la base, nunca por igualdad contra un reloj fijado en el test" —
dejó de ser cierto tras retirar el trigger `BEFORE UPDATE` de `categories`,
ver `data-layer-clock-policy`.)

#### Scenario: CA-2 — renombrar no cambia el slug

- GIVEN una categoría con slug `"lacteos-prueba"`
- WHEN `PUT /categories/:id` con un `name` distinto
- THEN la respuesta trae `slug "lacteos-prueba"` y `updated_at` posterior al
  valor previo

#### Scenario: CA-2 — mover una categoría a otra madre válida

- GIVEN dos categorías raíz `A` y `B` del mismo `type_id`
- WHEN `PUT /categories/A` con `parent: B.id`
- THEN `parent` trae la cadena hasta `B`, y `GET /categories/B` incluye `A`
  en `children`
