# Apply Progress: Capa de datos de identidad en `@safari/db` (US-21)

> Lote único (`size:exception`, `delivery_strategy` resuelto por el dueño del
> repo). Las 25 tasks de `tasks.md`, en las 7 fases, quedan `[x]` en este lote.
> No se creó ningún commit — el árbol de trabajo queda para revisión del dueño
> del repo, con los tres cortes sugeridos anotados al final.

## Fase 1 — Esquema: introspección y gate de drift (CA-1)

**1.1–1.3 — `prisma db pull` + renombres + revisión completa del diff**

Antes del pull, el `schema.prisma` committeado coincidía byte a byte con el
baseline guardado en el scratchpad (217 líneas, 54 `@map`/`@@map`,
verificado con `diff`).

```
$ npx prisma db pull
✔ Introspected 15 models and wrote them into prisma\schema.prisma in 544ms
[WARNING] Los 9 modelos de catálogo recuperaron sus @map/@@map de la versión
anterior automáticamente (Prisma los reconoció al re-introspeccionar). Las
6 tablas de identidad entraron SIN renombrar (users, profiles, permissions,
permission_user, password_reset_tokens, otp_codes en snake_case).
```

Reaplicados a mano los 6 modelos de identidad y `Shop.owner`, exactamente
como los enumera Decision A del `design.md` (verificados contra `\d users`,
`\d profiles`, `\d permissions`, `\d permission_user`,
`\d password_reset_tokens`, `\d otp_codes` y `pg_constraint` para la FK de
`shops.owner_id`, que es `ON DELETE RESTRICT`).

`git diff packages/db/prisma/schema.prisma` completo — **cero renombres
perdidos** en los 9 modelos de catálogo. El diff es PURO ADITIVO:

```
$ git diff --stat packages/db/prisma/schema.prisma
 packages/db/prisma/schema.prisma | 102 +++++++++++++++++++++++++++++++++++++++
 1 file changed, 102 insertions(+)
```

Único cambio dentro de un modelo preexistente: una línea nueva en `Shop`
(`owner User @relation(...)`), cero líneas tocadas. La cabecera de 24 líneas
se conservó y se extendió con la mención de `users_email_lower_idx` (tercer
índice de expresión que Prisma no modela). `partialIndexes` y el
`datasource db` sin `url` sobreviven intactos.

**Ningún renombre manual se perdió** — la lista completa de Decision A
(9 modelos, ~50 campos `@map`, la relación nombrada `CategoryTree`, los
`@@unique`/`@@index` con `where: raw(...)`) está presente sin cambios.

**1.4 — `prisma validate`**

```
$ npx prisma validate
The schema at prisma\schema.prisma is valid 🚀
```

**1.5 — El gate de drift real, en 0**

```
$ npx prisma migrate diff --from-config-datasource --to-schema ./prisma/schema.prisma --exit-code
No difference detected.
EXIT=0
```

(Hoy, antes de esta US, este mismo comando salía con `EXIT=2` listando las 6
tablas y la FK de `shops` ausentes — verificado en `design.md`/`proposal.md`.)

**1.6 — `npm run generate`**

```
$ npm run generate
✔ Generated Prisma Client (7.10.0) to .\generated\prisma\client in 318ms
```

Confirmado `prisma.user` en el cliente generado (`models/User.ts`, junto a
`Profile.ts`, `Permission.ts`, `PermissionUser.ts`, `PasswordResetToken.ts`,
`OtpCode.ts`).

## Fase 2 — Records y lecturas (CA-2, CA-3, CA-5)

- `src/records.ts`: `UserRecord` (7 claves, ninguna es el hash),
  `ProfileRecord`, `PermissionRecord` + `_toUserRecord`, `_toProfileRecord`,
  `_toPermissionRecord`, reutilizando `_id()` sin tocarlo.
- `src/repositories/users.repository.ts` (nuevo): `UserCredentials`,
  `findUserCredentialsByEmail` vía `$queryRaw` con
  `lower(email) = lower(${email})` — único SQL crudo de dominio del paquete.
- Mismo archivo: `USER_RELATIONS` (`profile`, `permissions.include.permission`,
  `shops`), `UserWithRelations`, `findUserById`, `findUserWithRelations`.
- Mismo archivo: `ListUsersInput`, `listUsers` (`permissionName` vía el
  pivote, `text` con `OR` sobre `name`/`email`).

`npm run typecheck` verde tras cada bloque (evidencia consolidada en la
Fase 6).

## Fase 3 — Señal temprana: test de lecturas (R-1)

`users.integration.test.ts` creado con los escenarios de lectura del spec.
Corrido antes de escribir las escrituras:

```
Test Files  1 passed (1)
     Tests  7 passed (7)   [escenarios de lectura únicamente, corrida intermedia]
```

Sin sorpresas en los renombres/`@map` — el riesgo R-1 no se materializó.

## Fase 4 — Escrituras y aislamiento (CA-4) — unidad única

- `createUser` (nested write: usuario + perfil + permisos por `connect`,
  atómico por construcción — Prisma envuelve los nested writes en una
  transacción, el paquete mantiene sus 0 usos de `$transaction`). Traduce
  P2002 → `DuplicateEmailError`.
- `updateUserPasswordHash`, `setUserActive` — ambos traducen P2025 → `null`.
- `users.integration.test.ts`: fixture centinela `TEST_DOMAIN =
  '@users-integration.test'`, limpieza en `beforeAll` **y** `afterAll`. El
  casing mezclado de las pruebas va en la parte LOCAL del email
  (`Create-User@users-integration.test`, `Duplicate-User@...`, etc.), nunca
  en el dominio — la limpieza por `endsWith` es case-sensitive.

Corrida completa del archivo (lecturas + escrituras), reporter verbose:

```
$ npx vitest run src/repositories/users.integration.test.ts --reporter=verbose
 ✓ findUserCredentialsByEmail > encuentra a admin@demo.com con casing mezclado (usa lower() en ambos lados) 9ms
 ✓ findUserCredentialsByEmail > devuelve null si el email no existe 3ms
 ✓ findUserCredentialsByEmail > el mapeo a mano produce una fila JSON-safe con las 4 claves camelCase 5ms
 ✓ findUserById > el UserRecord público no expone el hash 19ms
 ✓ findUserById > devuelve null si el id no existe 4ms
 ✓ findUserWithRelations > el usuario 1 trae perfil, sus 2 permisos y las 12 tiendas de las que es dueño 52ms
 ✓ findUserWithRelations > devuelve null si el id no existe 5ms
 ✓ listUsers > filtra por permissionName: solo admin tiene super_admin 20ms
 ✓ listUsers > busca por texto en name o email 9ms
 ✓ listUsers > sin filtro trae al menos los 3 usuarios sembrados 5ms
 ✓ escrituras de identidad (CA-4) > createUser crea usuario + perfil + permiso inicial 43ms
 ✓ escrituras de identidad (CA-4) > createUser repetido con otro casing del mismo email lanza DuplicateEmailError 24ms
 ✓ escrituras de identidad (CA-4) > updateUserPasswordHash cambia el hash que ve findUserCredentialsByEmail 16ms
 ✓ escrituras de identidad (CA-4) > updateUserPasswordHash(999999, …) devuelve null (P2025) 5ms
 ✓ escrituras de identidad (CA-4) > setUserActive activa y desactiva 52ms
 ✓ escrituras de identidad (CA-4) > setUserActive(999999, …) devuelve null (P2025) 12ms

 Test Files  1 passed (1)
      Tests  16 passed (16)
```

(Los `prisma:error` que Prisma imprime a `stdout` para P2002/P2025 son
esperados: el repositorio los captura y traduce — no son fallos de test.)

**Nota de diseño (desviación menor, documentada):** el proposal original
sugería un test in-file de "conteos antes/después" dentro de
`users.integration.test.ts`. Se retiró: dentro del mismo archivo los `it()`
corren ANTES del `afterAll` de limpieza, así que un `expect(users).toBe(3)`
ejecutado a mitad de la suite falla necesariamente (falló en la primera
corrida: `expected 7 to be 3`, con las filas centinela todavía vivas). La
prueba real de que la suite completa no corrompe el estado sembrado es el
`SELECT count(*)` externo antes/después de `just db-check` — exactamente lo
que pide el `Verification Plan` del `design.md` y el CA-4 del proposal. Ver
Fase 6.

## Fase 5 — Wiring y guardas negativas

`packages/db/index.ts`: bloque `users` agregado **después** de
`types.repository` (orden por especificador, como exige biome) —
`UserRecord`/`ProfileRecord`/`PermissionRecord` en el bloque de
`./src/records`; `CreateUserInput`/`ListUsersInput`/`UserCredentials`/
`UserWithRelations` y las 7 funciones + `DuplicateEmailError` en el bloque
de `users.repository`. No se exportan los mappers `_to*`, la fila cruda del
`$queryRaw`, ni nada de `PasswordResetToken`/`OtpCode`.

```
$ grep -n "bcrypt" packages/db/package.json || echo "sin bcrypt: OK"
sin bcrypt: OK

$ git status --short | grep -E "^\s*[MADRU?]+\s+(apps/|db/)" || echo "sin cambios en apps/ ni db/"
sin cambios en apps/ ni db/
```

## Fase 6 — Verificación de cierre

**6.1 — `just db-build`**

```
$ just db-build
...
✔ Generated Prisma Client (7.10.0) to .\generated\prisma\client in 411ms
CJS dist\index.js     127.63 KB
CJS dist\index.js.map 285.53 KB
CJS ⚡️ Build success in 167ms
DTS ⚡️ Build success in 7076ms
DTS dist\index.d.ts 1.37 MB
```

Limpio: CJS + `.d.ts` sin errores.

**6.2 — `npm run lint`** (deviación documentada, no de código)

`npm run lint` (biome) **ya fallaba antes de esta US** con 14 errores, todos
del mismo tipo: `format` — el repo tiene `core.autocrlf` activo en Windows y
biome exige LF. Verificado con `git stash` (revirtiendo temporalmente todos
los cambios de este apply) que el baseline pre-existente era 14 errores; con
los 2 archivos nuevos de esta US el conteo sube a 16, mismo tipo de error
(CRLF), cero errores nuevos de lógica o de orden de exports. Se inspeccionó
el diff que el formateador de biome propone para `index.ts`: **solo elimina
`␍`** (retorno de carro), no reordena ni una línea — confirma que el bloque
`users` que agregué después de `types.repository` ya está en el orden
correcto (alfabético case-insensitive, igual que el patrón existente de
`products`: `createUser, DuplicateEmailError, findUserById,
findUserCredentialsByEmail, findUserWithRelations, listUsers, setUserActive,
updateUserPasswordHash`). Arreglar el CRLF de todo el repo está fuera del
alcance de esta US (tocaría archivos no listados en el scope).

**6.3 — `just db-check` con `cwd` en mayúscula**

```
$ pwd
/c/DevOps/MyGitHub/safari-marketplace
$ just db-check
npm run typecheck
> tsc --noEmit
cd "$(pwd)" && npm test
> vitest run

 Test Files  7 passed (7)
      Tests  73 passed (73)
   Start at  13:29:28
   Duration  6.13s
```

**Baseline 6 archivos / 57 tests → 7 archivos / 73 tests** (+16 tests,
coincide con las 16 del archivo nuevo).

**6.4 — Conteos antes/después de 6.3**

```
Antes (antes de tocar el schema):
 u | p | pu | s  | prod | cat
---+---+----+----+------+-----
 3 | 3 |  6 | 12 | 1200 | 198

Antes de 6.3 (tras el schema+repositorio, antes de correr la suite):
 u | p | pu | s
---+---+----+----
 3 | 3 |  6 | 12

Después de 6.3 (tras correr just db-check completo, incluidas las escrituras):
 u | p | pu | s  | prod | cat
---+---+----+----+------+-----
 3 | 3 |  6 | 12 | 1200 | 198
```

Idénticos en los tres momentos — CA-4 cerrado: la fixture centinela no dejó
basura y no tocó los 3 usuarios sembrados.

## Fase 7 — Documentación y cierre

- `packages/db/README.md`: nueva sección "Identidad (US-21, Épico 19) —
  `users.repository.ts`" tras "Lo que Prisma no modela" — el agregado, la
  frontera D-2, por qué el `$queryRaw` (con la evidencia de qué formas NO
  usan el índice), y el índice de expresión no modelado.
- `docs/product/19-autenticacion-autorizacion/21-capa-datos-identidad.md`:
  `Status` → `✅ Implementada`, Definición de Done con las 6 casillas
  marcadas y remitidas a este archivo.
- `docs/product/19-autenticacion-autorizacion/README.md`: fila de US-21 →
  `✅ Implementada`.

### Reporte final — hand-offs, sin accionar

- `grantPermission` (asignar `staff`/`make-admin` a un usuario existente) es
  de **US-25** (D-3 del épico); no se tocó `users.repository.ts` en esa
  dirección.
- El `pivot` Laravel-shaped que `/me` publica (US-22) lo arma el servicio de
  Nest con `model_type` constante (Decision G, `design.md`) — el `pivot`
  real de `users.json` tiene exactamente 3 claves (`model_id`,
  `permission_id`, `model_type`), ninguna es fecha, así que no hace falta
  exponer `assignedAt`.
- Doc drift heredado de US-20: `22-login-jwt-postgres.md:122,153` cita
  `apps/api/rest/.env.template`; el archivo real es `.env.example`
  (`justfile:59`). No se tocó — es de otra US.
- `sdd-archive` deberá aplicar a mano el delta de la spec `identity-data-layer`
  (no se archivó en este apply — es fase de verificación/archivo, no de
  implementación).

## Evidencia de las negativas (D-2 del épico)

```
$ grep -n "bcrypt" packages/db/package.json || echo "sin bcrypt: OK"
sin bcrypt: OK
```

`UserRecord` (7 claves) no incluye `passwordHash` — verificado por
`findUserById`, `findUserWithRelations` (incluida la relación anidada
`permissions[]`/`shops[]`) y `listUsers`, los tres con
`expect(JSON.stringify(...)).not.toContain('$2')` (prefijo bcrypt) además del
`Object.keys(...).not.toContain('passwordHash')` de primer nivel. Ver Fase 4.

## Estado final del árbol de trabajo

```
$ git status --short
 M docs/product/19-autenticacion-autorizacion/21-capa-datos-identidad.md
 M docs/product/19-autenticacion-autorizacion/README.md
 M packages/db/README.md
 M packages/db/index.ts
 M packages/db/prisma/schema.prisma
 M packages/db/src/records.ts
?? openspec/changes/capa-datos-identidad/   (tasks.md + este archivo)
?? packages/db/src/repositories/users.integration.test.ts
?? packages/db/src/repositories/users.repository.ts

$ git diff --stat
 21-capa-datos-identidad.md    |  18 ++--
 README.md                     |   2 +-
 packages/db/README.md         |  39 ++++++++
 packages/db/index.ts          |  19 ++++
 packages/db/prisma/schema.prisma | 102 +++++++++++++++++++++
 packages/db/src/records.ts    |  81 ++++++++++++++++
 6 files changed, 252 insertions(+), 9 deletions(-)
```

Sin cambios bajo `apps/`, `db/`, ni `services/`. Sin dependencias nuevas en
`packages/db/package.json`.

## Cortes de commit sugeridos (no ejecutados — el dueño del repo commitea)

1. **Commit 1 — Esquema**: `packages/db/prisma/schema.prisma` +
   `generated/`/`dist/` regenerados. Evidencia: Fase 1 completa (drift exit 0).
2. **Commit 2 — Records + lecturas + test temprano**: `src/records.ts` (los
   3 records/mappers nuevos), `src/repositories/users.repository.ts`
   (lecturas: `findUserCredentialsByEmail`, `findUserById`,
   `findUserWithRelations`, `listUsers`), y la porción de lectura de
   `users.integration.test.ts`.
3. **Commit 3 — Escrituras + wiring + cierre**: las 3 escrituras del
   repositorio, la porción de escritura del test, `index.ts`, `README.md` y
   el status de la US/épico.

## Estado

**25/25 tasks completas** (7/7 fases). `just db-check`: **7 archivos / 73
tests**, en verde. `just db-build`: limpio. Gate de drift: `EXIT=0`. Conteos
sembrados intactos antes/después. Listo para `sdd-verify`.
