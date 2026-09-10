# Delta for Catalog Write Foundations

## ADDED Requirements

### Requirement: `InvalidReference` observado por primera vez sobre HTTP, piezas compartidas sin cambios (CA-7)

`tags` y `manufacturers` son los primeros agregados de escritura con una FK
saliente real (`type_id → types(id)`); su integración MUST producir el
primer caso real de `InvalidReference` → 400 sobre HTTP. El código y su
traducción ya existían (introducidos en `types`), pero `types` no tiene
ninguna ruta que dispare esta rama — solo estaba probada a nivel de mapper
unitario. La integración de `tags`/`manufacturers` MUST limitarse a invocar
el helper de slug y el mapeador de errores existentes desde el `catch` de
su propio repositorio/servicio (un call site); MUST NOT modificar
`packages/db/src/slug.ts`, `packages/db/src/domain-errors.ts` ni
`apps/api/rest/src/common/errors/`.

#### Scenario: CA-7 — `type_id` inexistente produce el primer 400 real de `InvalidReference` sobre HTTP, y las piezas compartidas quedan intactas
- GIVEN la base sembrada con el catálogo `types`
- WHEN se hace `POST /api/tags` con `type_id 99999`
- THEN la respuesta es 400, nunca 500
- AND `git diff --stat packages/db/src/slug.ts
  packages/db/src/domain-errors.ts apps/api/rest/src/common/errors/` está
  vacío
