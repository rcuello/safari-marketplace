# Apply Progress: Endpoints de usuarios y staff desde Postgres (US-25)

> PR1 de la cadena `stacked-to-main` (PR1 `packages/db` → PR2 mapper → PR3
> servicio). Rama `pr1/db-users-relations`, base `main`. Este documento
> cubre EXCLUSIVAMENTE la Fase 1 de `tasks.md`. Fases 2-4 quedan intactas
> (`- [ ]`), pendientes de sesiones futuras.

## Alcance ejecutado

Fase 1 completa, tareas 1.1 a 1.9, todas marcadas `[x]` en `tasks.md`.

## Archivos tocados

| Archivo | Acción | Qué |
|---|---|---|
| `packages/db/src/repositories/users.repository.ts` | Modificado | `_usersWhere` extraída (compartida por `listUsers`/`listUsersWithRelations`); `listUsersWithRelations` nueva; `grantPermission` nueva; clase `UnknownPermissionError` nueva (no exportada) |
| `packages/db/index.ts` | Modificado | 2 exports nuevos en orden alfabético case-insensitive: `grantPermission` (tras `findUserWithRelations`) y `listUsersWithRelations` (tras `listUsers`). `UnknownPermissionError` deliberadamente fuera |
| `packages/db/src/repositories/users.integration.test.ts` | Modificado | +7 tests: 3 para `listUsersWithRelations` (relaciones incluidas + filtro, shops de user 1, `staff` total 0) y 4 para `grantPermission` (alta, idempotencia sin fila duplicada, permiso inexistente como error de dominio, `null` con usuario inexistente) |

`packages/db/src/records.ts` — NO tocado; no hizo falta (los tipos de retorno ya existían: `ListUsersInput`, `UserWithRelations`).

Diff real (`git diff --stat -- packages/db`): `3 files changed, 190 insertions(+), 11 deletions(-)` — 201 líneas cambiadas, dentro del presupuesto ~195 LOC estimado en `tasks.md`/`design.md`.

## La open question de diseño — RESUELTA

**Pregunta**: ¿`prisma.permissionUser.upsert({ where: { userId_permissionId: {...} }, update: {} })` funciona sobre la PK compuesta `@@id([userId, permissionId])` (`packages/db/prisma/schema.prisma:286`)?

**Resolución empírica**: SÍ funciona. Se implementó directamente con `upsert` (sin necesidad del fallback `create` + `catch P2002`) y se ejecutó contra Postgres real vía `just db-check`. Evidencia:

- El test "conceder un permiso ya poseído es idempotente" llama `grantPermission(user.id, 'store_owner')` dos veces seguidas contra la base real y pasa sin excepción.
- La aserción `prisma.permissionUser.findMany({ where: { userId: BigInt(user.id) } })` devuelve exactamente **1** fila tras las dos llamadas — cero duplicados.
- El conteo de tests subió de 84 (baseline) a **91** (baseline + 7 nuevos), todos verdes, incluida esta prueba.
- No se activó el fallback `create` + `catch P2002`; el código final usa `upsert` puro (ver `users.repository.ts`, función `grantPermission`).

**Rama tomada**: `upsert({ update: {} })`. Fallback documentado pero no necesario.

## Divergencias respecto al design

Ninguna. Implementación fiel a D-C (`listUsersWithRelations`, un `include`, sin N+1) y D-D (`grantPermission` idempotente vía `upsert`, `UnknownPermissionError` no exportada ni del archivo ni del barrel, sin reglas de autorización — D-1). Se corrigió la premisa falsa de A7 tal como el design ya lo indicaba: NO se usó el patrón `create`/`connect` de `createUser` (no idempotente para un usuario existente), sino `upsert` sobre la PK compuesta.

## Invariantes de test respetados

- Ningún test de esta sesión concede `super_admin` ni `staff` a un usuario `@users-integration.test`. Los tests de `listUsersWithRelations` que filtran por `super_admin`/`staff` solo LEEN (no escriben) sobre los usuarios sembrados 1/2/3.
- Los tests de `grantPermission` usan `store_owner` sobre usuarios centinela nuevos (`Grant-Permission@…`, `Grant-Idempotent@…`, `Grant-Unknown@…`), nunca sobre los 3 usuarios sembrados.
- Casing mezclado solo en la parte local del email (dominio `@users-integration.test` intacto).
- La aserción `not.toContain('$2')` en `listUsersWithRelations` se ancla al usuario 3 (`admin@demo.com`, hash `$2y$…` real sembrado), no a un centinela con `passwordHash: 'hash-de-prueba'`.
- Cleanup sigue siendo `afterAll` sobre `email: { endsWith: TEST_DOMAIN } }`; `permission_user` es `ON DELETE CASCADE` (`db/schema.sql:174-175`), así que los pivotes de los centinelas de `grantPermission` se limpian solos al borrar el usuario.
- Ningún test de esta sesión tocó los usuarios sembrados 1, 2 o 3.

## Evidencia de cierre (real, no "debería funcionar")

### `just db-check` (típecheck + vitest)

```
npm run typecheck
> @safari/db@0.1.0 typecheck
> tsc --noEmit

cd "$(pwd)" && npm test
> @safari/db@0.1.0 test
> vitest run

 RUN  v4.1.11 C:/DevOps/MyGitHub/safari-marketplace/packages/db

 Test Files  8 passed (8)
      Tests  91 passed (91)
   Start at  12:09:34
   Duration  7.83s
```

91/91 verdes, 8 archivos de test — sube desde el baseline de 84 (+7 tests nuevos de esta sesión). Typecheck limpio.

### `just db-build` (prisma generate + tsup)

```
npm run build
> @safari/db@0.1.0 build
> prisma generate && tsup

✔ Generated Prisma Client (7.10.0) to .\generated\prisma\client in 508ms
CLI Building entry: index.ts
CJS dist\index.js     132.38 KB
CJS dist\index.js.map 301.52 KB
CJS ⚡️ Build success in 121ms
DTS ⚡️ Build success in 7013ms
DTS dist\index.d.ts 1.38 MB
```

Verificación adicional de superficie pública en el build real:

```
$ node -e "const db=require('./dist/index.js'); console.log('grantPermission' in db, 'listUsersWithRelations' in db, 'UnknownPermissionError' in db);"
true true false
```

Confirma: los 2 exports nuevos llegan a `dist/`, disponibles para que PR3 los consuma vía `link:`; `UnknownPermissionError` NO se filtra a la superficie pública.

### Lint (biome) — nota, no gate de esta US

`npm run lint` en `packages/db` reporta 17 errores / 1 info, todos de `format`
(diferencias de fin de línea CRLF/LF). **Pre-existentes**: se confirmó
haciendo `git stash` (revirtiendo los 3 archivos de esta sesión) y corriendo
`npm run lint` de nuevo sobre el baseline — mismos 17 errores / 1 info, en
archivos que esta sesión ni siquiera tocó (`products.repository.ts`,
`shops.repository.ts`, `categories.repository.ts`, etc.). No es una
regresión de PR1; `just db-check` (el gate real de esta US, `openspec/config.yaml`
`testing.test_command`) no incluye lint. No se tocó por estar fuera de scope.

## Riesgos / notas para PR2 y PR3

- PR3 depende de que `packages/db/dist/` tenga los 2 exports nuevos — confirmado arriba.
- `grantPermission` NO exporta `UnknownPermissionError`; el consumidor de PR3 (`make-admin`) nunca podrá capturarlo por tipo — solo lo verá como un 500 vía `withPrismaErrorTranslation`, tal como el design (D-D) decidió a propósito.
- Ningún cambio de DDL; `db/schema.sql` intacto.
- `apps/` no fue tocado en absoluto en esta sesión (scope binding respetado).

## Estado

9/9 tareas de Fase 1 completas. Fases 2, 3 y 4 quedan pendientes (`[ ]` en `tasks.md`), sin iniciar. Listo para `sdd-verify` de PR1 o para continuar con PR2.
