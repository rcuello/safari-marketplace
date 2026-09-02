# Verification Report: `capa-datos-identidad` (US-21, Épico 19)

**Change**: `capa-datos-identidad`
**Version**: N/A (specs sin versionar; `openspec/config.yaml` schema `spec-driven`)
**Mode**: Standard (`strict_tdd: false`)
**Artifact store**: `openspec` (Engram NO conectado — ningún `mem_*` invocado)
**Skill registry**: `skill_resolution: none` (`.atl/skill-registry.md` no existe)
**Fecha**: 2026-09-02
**Pase**: adversarial, contexto fresco. Todo lo de abajo se re-ejecutó en esta
sesión; `apply-progress.md` se trató como *reclamo*, no como evidencia.

---

## Veredicto

**PASS WITH WARNINGS.** La Definición de Done de US-21 (6 casillas) está
cerrada con salida real de comandos. Cero defectos de implementación. Cinco
avisos, cuatro de ellos de *redacción de spec / documentación* y uno de
*cobertura de test*: la rama `name` de la búsqueda de `listUsers` nunca se
ejercita, y el escenario del `EXPLAIN` no es reproducible hoy tal como está
escrito.

Conteos verificados con `grep -c`: **10 requirements / 16 scenarios** en
`specs/identity-data-layer/spec.md` — coincide con el orquestador.

**Discrepancias con la verificación independiente del orquestador**: ninguna.
Los seis resultados que pedía reproducir salieron idénticos (scope, `migrate
diff` EXIT=0, `102 0` en el numstat, 7 archivos / 73 tests, conteos sembrados,
sin `bcrypt`). Los hallazgos nuevos son de las comprobaciones que el
orquestador NO hizo (W-1, W-2, W-3, W-4 y S-11).

---

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 25 |
| Tasks complete | 25 (`[x]`) |
| Tasks incomplete | 0 |
| Tasks con reclamo verificado por resultado | 23 |
| Tasks con reclamo de *proceso* no verificable post-hoc | 2 (1.1 `db pull`, 3.2 corrida intermedia) |

Las dos tasks de proceso no son falsables después del hecho (no se puede
distinguir un `db pull` de un modelo escrito a mano si el resultado es
idéntico). Su **resultado** sí está verificado, y con corroboración fuerte:
los nombres de índice del schema coinciden uno a uno con los reales de la
base (`otp_codes_phone_idx`, `password_reset_tokens_user_idx`,
`permission_user_permiso_idx`, `permissions_name_key`,
`password_reset_tokens_token_key`), y `users_email_lower_idx` está
correctamente **ausente** del schema y documentado en la cabecera. Eso es lo
que produce una introspección, no una transcripción a mano.

---

## Build & Tests Execution

### `just build` — **INAPLICABLE** (no "omitido")

`rules.verify.build_command` es `just build`, que compila los frontends
Next.js (`apps/shop` + `apps/admin`). Este cambio no toca ni un archivo bajo
`apps/`: los gates de compilación pertinentes son `tsc --noEmit` (dentro de
`just db-check`) y `just db-build` (tsup). Correr `just build` no habría
podido fallar por causa de este cambio ni pasar por mérito suyo.

### `just db-build` (tsup) — ✅ Passed

```text
$ just db-build
Loaded Prisma config from prisma.config.ts.
Prisma schema loaded from prisma\schema.prisma.
✔ Generated Prisma Client (7.10.0) to .\generated\prisma\client in 420ms
CLI Building entry: index.ts
CLI tsup v8.5.1
CJS dist\index.js     127.63 KB
CJS dist\index.js.map 285.53 KB
CJS ⚡️ Build success in 243ms
DTS ⚡️ Build success in 11395ms
DTS dist\index.d.ts 1.37 MB
```

### `just db-check` (typecheck + vitest) — ✅ 73 passed / 0 failed / 0 skipped

```text
$ pwd
/c/DevOps/MyGitHub/safari-marketplace      # unidad en mayúscula vía `cd "$(pwd)"` del justfile
$ just db-check
npm run typecheck
> tsc --noEmit                              # sin salida = limpio
cd "$(pwd)" && npm test
> vitest run
 RUN  v4.1.11 C:/DevOps/MyGitHub/safari-marketplace/packages/db
 Test Files  7 passed (7)
      Tests  73 passed (73)
   Duration  7.87s
```

Baseline declarado 6 archivos / 57 tests → **7 / 73**. La aritmética cierra:
73 − 16 = 57, y los 6 archivos de test preexistentes están **sin modificar**
(`git status --porcelain -- packages/db/src/repositories/` solo lista los 2
archivos nuevos de `users`).

### Corrida verbose del archivo nuevo — 16/16

```text
$ npx vitest run src/repositories/users.integration.test.ts --reporter=verbose
 ✓ findUserCredentialsByEmail > encuentra a admin@demo.com con casing mezclado (usa lower() en ambos lados) 11ms
 ✓ findUserCredentialsByEmail > devuelve null si el email no existe 4ms
 ✓ findUserCredentialsByEmail > el mapeo a mano produce una fila JSON-safe con las 4 claves camelCase 6ms
 ✓ findUserById > el UserRecord público no expone el hash 20ms
 ✓ findUserById > devuelve null si el id no existe 4ms
 ✓ findUserWithRelations > el usuario 1 trae perfil, sus 2 permisos y las 12 tiendas de las que es dueño 43ms
 ✓ findUserWithRelations > devuelve null si el id no existe 6ms
 ✓ listUsers > filtra por permissionName: solo admin tiene super_admin 19ms
 ✓ listUsers > busca por texto en name o email 10ms
 ✓ listUsers > sin filtro trae al menos los 3 usuarios sembrados 9ms
 ✓ escrituras de identidad (CA-4) > createUser crea usuario + perfil + permiso inicial 46ms
 ✓ escrituras de identidad (CA-4) > createUser repetido con otro casing del mismo email lanza DuplicateEmailError 22ms
 ✓ escrituras de identidad (CA-4) > updateUserPasswordHash cambia el hash que ve findUserCredentialsByEmail 16ms
 ✓ escrituras de identidad (CA-4) > updateUserPasswordHash(999999, …) devuelve null (P2025) 6ms
 ✓ escrituras de identidad (CA-4) > setUserActive activa y desactiva 14ms
 ✓ escrituras de identidad (CA-4) > setUserActive(999999, …) devuelve null (P2025) 5ms
 Test Files  1 passed (1)
      Tests  16 passed (16)
```

### Gate de drift (CA-1) — ✅ EXIT=0, con el código de salida real

El `EXIT=$?` de `apply-progress.md` venía detrás de un pipe (mediría `tail`).
Re-ejecutado sin pipe:

```text
$ npx prisma migrate diff --from-config-datasource --to-schema ./prisma/schema.prisma --exit-code > /tmp/mdiff.txt 2>&1; echo "REAL_EXIT=$?"
REAL_EXIT=0
$ cat /tmp/mdiff.txt
Loaded Prisma config from prisma.config.ts.
No difference detected.

$ npx prisma validate
The schema at prisma\schema.prisma is valid 🚀
```

### `npm run lint` (biome) — ❌ 16 errores, **todos `format`, baseline pre-existente confirmado**

```text
$ npm run lint            # biome check .
Checked 27 files in 93ms. No fixes applied.
Found 16 errors.

$ npm run lint | grep -oE "^[..]+\.(ts|json|md|js) [a-z/]+ " | sort | uniq -c
  1 src\repositories\users.repository.ts format          <- NUEVO
  1 src\repositories\users.integration.test.ts format    <- NUEVO
  1 src\repositories\types.repository.ts format
  1 src\repositories\types.integration.test.ts format
  ... (12 más, todas `format`, una por archivo)
  1 src\records.ts format
  1 index.ts format
```

**16 errores = 16 archivos × 1 error `format` cada uno; 0 de lógica, 0 de orden
de exports.** Sin usar `git stash` (prohibido: no puedo modificar el árbol),
la causa raíz quedó probada por tres vías:

1. `biome.json` declara `"formatter": { "lineEnding": "lf" }`; el árbol en
   Windows tiene CRLF por `core.autocrlf` (`git diff` lo avisa: *"LF will be
   replaced by CRLF"*). Medido: `index.ts` 92 CRLF / 92 LF,
   `src/records.ts` 303/303, `users.repository.ts` 307/307,
   `users.integration.test.ts` 198/198 — y `tags.repository.ts`, **sin
   modificar por este cambio**, 53/53 con su mismo error `format`.
2. El blob committeado (`git show HEAD:packages/db/index.ts`, 0 CRLF) pasado a
   `biome check --stdin-file-path=index.ts` sale **byte a byte idéntico**
   (`diff` vacío): el contenido en LF ya es biome-clean.
3. El contenido del working copy comparado con lo que biome propone:
   `identical after stripping CR: true`. **Biome solo quiere borrar `␍`** — no
   reordena una sola línea, lo que confirma que el bloque `users` de
   `index.ts:77-92` ya está en el orden que biome exige.

Baseline **14** (16 archivos − los 2 nuevos) verificado por construcción:
cada archivo aporta exactamente 1 error y los 14 restantes son preexistentes.
Los 2 nuevos son puro CRLF. **La desviación (b) del apply agent es correcta.**

**Coverage**: ➖ no disponible (`coverage_command: ""`, `coverage_threshold: 0`).

---

## Spec Compliance Matrix — `identity-data-layer` (10 req / 16 scen)

| # | Requirement | Scenario | Evidencia | Result |
|---|---|---|---|---|
| R1-S1 | Modelos por introspección + gate de drift real | El gate de drift sale en verde | `migrate diff … --exit-code` → `No difference detected` / **REAL_EXIT=0** | ✅ COMPLIANT |
| R1-S2 | idem | `partialIndexes` sobrevive, catálogo sin drift propio | `prisma validate` verde; `previewFeatures = ["partialIndexes"]` en `schema.prisma:34`; `git diff --numstat` = **`102 0`** (cero borrados); 15 modelos (9 catálogo + 6 identidad); `@map`/`@@map` 54 → **81**; `datasource db` sin `url` (`:37-39`) | ✅ COMPLIANT |
| R2-S3 | Credenciales aisladas e insensibles a mayúsculas | Email con mayúsculas encuentra al usuario | `users.integration.test.ts > findUserCredentialsByEmail > …casing mezclado` ✓ | ✅ COMPLIANT |
| R2-S4 | idem | Email inexistente → `null` | `…> devuelve null si el email no existe` ✓ | ✅ COMPLIANT |
| R2-S5 | idem | El plan de consulta usa el índice funcional | `EXPLAIN` real hoy → **`Seq Scan`**, no `Index Scan` (ver **W-1**). Elegibilidad del índice sí probada con `enable_seqscan=off` | ⚠️ PARTIAL |
| R3-S6 | Usuario completo con relaciones | Usuario 1 trae perfil, permisos y 12 tiendas | `…> el usuario 1 trae perfil, sus 2 permisos y las 12 tiendas` ✓ + cruce en base: user 1 tiene `customer` + `store_owner`, 12 shops | ✅ COMPLIANT |
| R4-S7 | Las tres escrituras | Crear usuario con perfil y permiso inicial | `…> createUser crea usuario + perfil + permiso inicial` ✓ | ✅ COMPLIANT |
| R4-S8 | idem | Actualizar el hash de contraseña | `…> updateUserPasswordHash cambia el hash que ve findUserCredentialsByEmail` ✓ | ✅ COMPLIANT |
| R4-S9 | idem | Activar y desactivar | `…> setUserActive activa y desactiva` ✓ | ✅ COMPLIANT |
| R5-S10 | `listUsers` — reinterpretación de CA-5 | Filtrar por permiso | `…> filtra por permissionName: solo admin tiene super_admin` ✓ (`total === 1`) | ✅ COMPLIANT |
| R5-S11 | idem | Buscar por nombre **o** email | El test solo assertá la rama **email**; la rama `name` del `OR` no se ejercita (ver **W-5**) | ⚠️ PARTIAL |
| R6-S12 | Cobertura de integración de la US | El archivo existe y corre en `just db-check` | 7 archivos / 73 tests vs baseline 6 / 57; el archivo aparece en la corrida verbose | ✅ COMPLIANT |
| R7-S13 | La frontera del hash es estructural | Ningún export público salvo `UserCredentials` nombra el hash | Records limpios (verificado en `dist/index.d.ts`), pero `CreateUserInput.passwordHash` y el re-export de `Prisma`/`PrismaClient` lo nombran (ver **W-2**/**W-3**) | ⚠️ PARTIAL |
| R8-S14 | Las escrituras no corrompen el estado sembrado | Los conteos no cambian tras la suite | `3 / 3 / 6 / 12 / 1200 / 198` antes **y** después de mi propia corrida completa; 0 filas del dominio centinela | ✅ COMPLIANT |
| R9-S15 | Los ids cruzan como `number` | El id de un `UserRecord` es un number serializable | `…> el mapeo a mano produce una fila JSON-safe con las 4 claves camelCase` ✓ (`typeof id === 'number'` + `JSON.stringify` no lanza) | ✅ COMPLIANT |
| R10-S16 | Sin dependencia nueva de hashing | `package.json` no declara bcrypt | `deps` = `@prisma/adapter-pg`, `@prisma/client`, `dotenv`, `prisma`; `devDeps` = `@biomejs/biome`, `tsup`, `typescript`, `vitest`; filtro `/bcrypt/i` → `[]`. `package.json` **sin modificar** en `git status` | ✅ COMPLIANT |

**Compliance summary**: **13/16 COMPLIANT, 3/16 PARTIAL, 0 FAILING, 0 UNTESTED.**

R1-S1, R1-S2 y R10-S16 no tienen test de vitest por diseño (`design.md`
*Testing Strategy* los asigna a `migrate diff`/`validate` y a inspección de
`package.json`); `rules.verify.require_evidence: true` se satisface con la
salida real de comando pegada arriba.

---

## Criterios de aceptación de la US

| CA | Verdict | Evidencia / nota |
|---|---|---|
| CA-1 — Modelos introspeccionados, no escritos a mano | ✅ | `migrate diff` EXIT=0 + `validate` verde. La US pedía literalmente "`prisma validate` no acusa drift"; la spec elevó el gate (Decision B) porque `validate` ya salía verde con cero modelos de identidad. **Se corrieron los dos.** |
| CA-2 — Lectura de credenciales aislada | ✅ | `findUserCredentialsByEmail` es la única firma que devuelve `passwordHash`; `UserRecord` (7 claves) no lo lleva; casing mezclado ✓ |
| CA-3 — Lectura del usuario completo | ✅ | `findUserWithRelations(1)` → perfil + 2 permisos + 12 tiendas ✓ |
| CA-4 — Escrituras de identidad | ✅ | Las 3 exactas, con `999999 → null` y `DuplicateEmailError`; base intacta |
| CA-5 — Listado paginado | ⚠️ | **Reinterpretación declarada** (proposal D-2:68-76 + spec R5): devuelve `{ items, total }`, NO el envoltorio de `buildPaginator`. Filtro y búsqueda presentes; la rama `name` de la búsqueda sin test (W-5). El texto de CA-5 en la US **no se anotó** (W-4b) |
| CA-6 — Cobertura de integración | ✅ | Los 3 casos que la US nombra: email inexistente → `null`; email con mayúsculas; `UserRecord` público sin el hash |

### Definición de Done (las 6 casillas de `21-capa-datos-identidad.md:109-118`)

| Casilla | Verdict | Prueba re-ejecutada por mí |
|---|---|---|
| `just db-check` verde con recuento pegado (debe subir de 6/57) | ✅ | **7 archivos / 73 tests** |
| `prisma validate` sin drift, salida pegada | ✅ | `valid 🚀` + `migrate diff` `REAL_EXIT=0` |
| `just db-build` limpio (CJS + `.d.ts`) | ✅ | CJS 127.63 KB, DTS 1.37 MB, `Build success` ×2 |
| Salida del test que demuestra que el `UserRecord` público no expone el hash | ✅ | `findUserById > el UserRecord público no expone el hash` ✓; corroborado en `dist/index.d.ts:27448-27456` (7 claves, ninguna es el hash) |
| `packages/db/README.md` actualizado | ✅ | +39 líneas: agregado, frontera D-2, por qué el `$queryRaw`, índice no modelado, y —lo que pedía el carry-forward— **la regla que los callers heredan**: *"Cualquier consumidor nuevo que necesite comparar por email hereda esta misma regla (`lower(email) = lower($1)`)"* |
| Status de la US actualizado y fila del épico marcada | ✅ | `21-…md:9` → `✅ Implementada`; `README.md:57` fila US-21 → `✅ Implementada` |

**La DoD de US-21 está cerrada.**

---

## Correctness (evidencia estática de las comprobaciones profundas)

| Comprobación pedida | Resultado |
|---|---|
| ¿El `$queryRaw` está parametrizado (tagged template, no concatenación)? | ✅ `users.repository.ts:107-112` — tagged template con `lower(${email})`; `$queryRawUnsafe` **no aparece** en el paquete |
| ¿Compara sobre `lower(email) = lower($1)`? | ✅ literal, `:110` |
| ¿Se aplica `_id()` al `BigInt` de la fila cruda? | ✅ `:116` `id: _id(row.id)`. Probado en runtime: `typeof creds.id === 'number'` y `JSON.stringify(creds)` no lanza |
| ¿`_id()` se reutilizó sin tocarlo? | ✅ `records.ts:37-42` sin cambios en el diff; solo 3 call sites nuevos |
| ¿`DuplicateEmailError` sale del camino P2002? | ✅ `:251-258` — `code === 'P2002'` → `throw new DuplicateEmailError(input.email)`; todo lo demás se re-lanza. Verificado en runtime por el test de duplicado |
| ¿Compone con `formatPrismaError`/`parsePrismaError` sin puentearlos? | ✅ en la intención: solo intercepta P2002/P2025 y re-lanza el resto, así que `parsePrismaError`/`getUserFriendlyMessage` siguen siendo el camino del servicio de Nest para lo demás. No los invoca — Decision H lo justifica: `errors.ts:83-87` agrupa P2002/P2003/P2025 sin distinguirlos. Ver **S-2** |
| ¿`UserCredentials` vive en `users.repository.ts` y no en `records.ts`? | ✅ `users.repository.ts:33-38`; `records.ts` no la nombra |
| ¿`findUserWithRelations` trae las 3 relaciones sin N+1? | ✅ un solo `prisma.user.findUnique({ include: USER_RELATIONS })` (`:153-156`); cero bucles/`await` por fila (`grep` de `for (`/`forEach`/`.map(async` → sin resultados). Nota: no capturé el conteo de sentencias SQL — `pg_stat_statements` está *available* pero no instalado y habilitarlo exige `shared_preload_libraries` + reinicio del contenedor, fuera de una verificación de solo lectura |
| ¿`USER_RELATIONS` es compartido como pedía el diseño? | ✅ constante de módulo `:139-143` con `satisfies Prisma.UserInclude`, más `Prisma.UserGetPayload<{include: typeof USER_RELATIONS}>` `:145-147` |
| ¿`listUsers` devuelve `{ items, total }` y no el wrapper? | ✅ `:185-214`; `buildPaginator` no se importa en el archivo |
| ¿Filtra por **nombre** de permiso (Decision F)? | ✅ `:192-194` `permissions: { some: { permission: { name: input.permissionName } } }` |
| ¿La búsqueda cubre nombre **y** email? | ✅ en el código (`:195-200`, `OR` sobre `name` y `email`); ⚠️ solo la rama email tiene test (W-5) |
| ¿El dominio de fixture es reservado y el casing mezclado está en la parte **local**? | ✅ `TEST_DOMAIN = '@users-integration.test'` (`:31`, TLD reservado RFC 2606); los 4 emails de prueba son `Create-User@…`, `Duplicate-User@…`, `Password-User@…`, `Active-User@…` — mayúsculas **solo** antes de la `@`, así que el `LIKE` case-sensitive de `endsWith` sí encuentra sus propias filas |
| ¿Limpieza en `beforeAll` **y** `afterAll`? | ✅ `:36` y `:37-40` |
| **¿Alguna escritura puede alcanzar un id sembrado (1, 2, 3)?** | ✅ **No, por construcción.** Las 3 escrituras solo reciben `user.id` devuelto por un `createUser` del dominio centinela, o el literal `999999`. `grep` de las llamadas: `updateUserPasswordHash(user.id, …)`, `updateUserPasswordHash(999999, …)`, `setUserActive(user.id, …)`, `setUserActive(999999, …)`. Ningún literal 1/2/3 en un camino de escritura (el `3` y el `1` solo aparecen en `findUserById(3)` y `findUserWithRelations(1)`, lecturas) |
| **¿La credencial `demodemo` de la que depende US-22 sobrevivió?** | ✅ los 3 usuarios sembrados siguen con hash bcrypt intacto: `1 store_owner@demo.com $2b$10$ t`, `2 customer@demo.com $2b$10$ t`, `3 admin@demo.com $2b$10$ t` |
| ¿Disciplina de out-of-scope? | ✅ `grantPermission` no existe (única mención: un comentario en `:217` que lo remite a US-25). No hay repositorio de `password_reset_tokens` ni de `otp_codes` (`ls src/repositories/` = 15 archivos, ninguno de ellos); `PasswordResetToken`/`OtpCode` **no se referencian en `src/` ni en `index.ts`** — solo existen como modelos en `schema.prisma:291-319`, cada uno con su comentario de por qué. Cero cambios bajo `apps/`, `db/`, `services/`; `package.json` sin tocar |
| ¿Scope del árbol de trabajo? | ✅ idéntico al del orquestador: 6 modificados / 3 no rastreados, `252 insertions, 9 deletions` |

---

## Coherence (Design) — decisiones A–H

| Decisión | ¿Seguida? | Nota |
|---|---|---|
| **A** — `db pull` + renombres enumerados, revisión del `git diff` entero | ✅ | Diff **puro aditivo** (`102 0`): ni un renombre de catálogo perdido. Los 9 modelos de catálogo, `@relation("CategoryTree")`, los `@@unique`/`@@index` con `where: raw(...)` y los `map:` siguen intactos. `Shop` gana exactamente la línea prevista (`:84`, `onDelete: Restrict, onUpdate: NoAction`). Cabecera extendida de 24 → 29 líneas con `users_email_lower_idx` y la razón de que `User.email` no lleve `@unique` (`:20-24`) |
| **B** — el gate es `migrate diff --exit-code`, no `validate` a secas | ✅ | Ambos corridos; EXIT=0 real. `PasswordResetToken`/`OtpCode` presentes con su comentario `///` de dos líneas (`:291-292`, `:307-308`) y la inversa `User.passwordResetTokens` (`:245`) |
| **C** — fixture centinela `.test`, limpieza en ambos extremos, jamás los 3 sembrados | ✅ | Ver la tabla de arriba. El casing mezclado quedó en la parte local, tal como el diseño se autocorrigió |
| **D** — records planos en `records.ts`, compuesto en el repositorio | ✅ | `UserRecord`/`ProfileRecord`/`PermissionRecord` en `records.ts`; `UserWithRelations extends UserRecord` en `users.repository.ts:40-44`. `ProfileRecord` clavado por `userId` |
| **E** — `findUserWithRelations` propia + `USER_RELATIONS` compartido | ✅ | Dos funciones separadas, cero flags de include; el desdoblamiento del pivote es `row.permissions.map((link) => _toPermissionRecord(link.permission))` (`:167-169`) |
| **F** — `listUsers` filtra por **nombre** de permiso | ✅ | `permissionName`; orden `id: 'asc'`; `limit` default 30 (`:189-190`) |
| **G** — el `pivot` lo arma Nest; `PermissionRecord` son las 5 columnas | ✅ | `PermissionRecord` = `id`, `name`, `guardName`, `createdAt`, `updatedAt`. Ni `assignedAt` ni `permission_user.created_at` se exponen |
| **H** — P2002 → `DuplicateEmailError`; P2025 → `null`; email verbatim | ✅ | `:250-260`, `:277-280`, `:295-297`. Ningún `toLowerCase()` en escritura. El nested write de `createUser` es atómico por construcción: `$transaction` sigue con **0 usos** en el paquete |

**Deriva de diseño: ninguna.** Las dos desviaciones que el apply agent declaró
se verificaron y son correctas (ver W-1 para la única matización).

### Las dos desviaciones declaradas por el apply agent

| Desviación | Verdict |
|---|---|
| (a) Se retiró el assert in-file de conteos antes/después porque los `it()` corren antes del `afterAll`; la prueba se movió a un `SELECT` externo | ✅ **Correcta y necesaria.** Reproduje el razonamiento: durante la corrida hay 4 filas centinela vivas, así que un `expect(count).toBe(3)` a mitad del archivo falla por construcción. La nota está escrita en el propio test (`:193-198`) y en `tasks.md:48`. La prueba externa la re-ejecuté yo: 3/3/6/12/1200/198 antes y después, 0 filas centinela residuales |
| (b) `npm run lint` rojo por baseline CRLF pre-existente: 14 antes, 16 después, todas `format` | ✅ **Correcta.** Verificada por tres vías sin `git stash` (ver la sección de lint). Ni un error de lógica ni de orden de exports |

---

## Issues Found

### CRITICAL
**Ninguno.**

### WARNING

**W-1 — El escenario R2-S5 ("el plan usa el índice funcional") NO es
reproducible tal como está escrito. Causa raíz identificada: estadísticas del
planner, no la forma de la query.**

El escenario exige *"el plan reporta `Index Scan using users_email_lower_idx`,
no `Seq Scan`"*. Hoy, contra la base sembrada:

```text
$ EXPLAIN SELECT id, email, password_hash, is_active FROM users
   WHERE lower(email) = lower('ADMIN@Demo.com') LIMIT 1;
 Limit  (cost=0.00..1.04 rows=1 width=88)
   ->  Seq Scan on users  (cost=0.00..1.04 rows=1 width=88)
         Filter: (lower(email) = 'admin@demo.com'::text)
```

Causa raíz (medida, no supuesta):

```text
$ SELECT c.relname, c.relpages, c.reltuples, s.last_autoanalyze FROM pg_class c
    LEFT JOIN pg_stat_user_tables s ON s.relname = c.relname WHERE c.relname = 'users';
 users | 1 | 3 | 2026-09-02 18:33:19.659144+00
```

Con `relpages=1`/`reltuples=3` el seq scan cuesta **1.04** y el index scan
**8.15**: el planner elige bien. El autoanalyze de las 18:33 lo disparó el
propio churn de escritura de la suite nueva — el test que valida CA-4 es lo que
falsifica el escenario del `EXPLAIN`. `explore.md:68-79` observó un seq scan de
coste **16.50** (tabla sin analizar), y por eso allí el index scan (8.17) ganaba.

**La reclamación sustantiva del diseño sigue en pie, y la probé:**

```text
$ SET enable_seqscan = off; EXPLAIN SELECT id, email, password_hash, is_active FROM users
    WHERE lower(email) = lower('ADMIN@Demo.com') LIMIT 1;
 ->  Index Scan using users_email_lower_idx on users  (cost=0.13..8.15 rows=1 width=88)
       Index Cond: (lower(email) = 'admin@demo.com'::text)

$ SET enable_seqscan = off; EXPLAIN … WHERE email ILIKE 'ADMIN@Demo.com' …
 ->  Seq Scan on users  (cost=10000000000.00..…)   Filter: (email ~~* 'ADMIN@Demo.com')
$ SET enable_seqscan = off; EXPLAIN … WHERE email = 'admin@demo.com' …
 ->  Seq Scan on users  (cost=10000000000.00..…)   Filter: (email = 'admin@demo.com')
```

Solo la forma `lower(email) = lower($1)` es **elegible** para
`users_email_lower_idx`; `ILIKE` y el `equals` plano siguen en seq scan incluso
con el seq scan penalizado a 10^10. La elección de D-1 es correcta; lo que está
mal es la **redacción del escenario**, que ata un MUST a una decisión de coste
del planner sobre una tabla de 3 filas. Al promover la spec, reescribir el THEN
como *"con `enable_seqscan = off` el plan reporta `Index Scan using
users_email_lower_idx`; `email = $1` y `email ILIKE $1` no lo logran ni así"*.
No hay test automatizado que cubra este escenario (ni el diseño le asignaba
uno). Sin impacto funcional: la corrección de la búsqueda la cubren R2-S3/S4,
ambos en verde.

**W-2 — `CreateUserInput.passwordHash` falsifica la letra de R7-S13.**
`dist/index.d.ts:27892-27908` (y `users.repository.ts:57-73`): `CreateUserInput`
es público (`index.ts:78`) y declara `passwordHash: string`. El escenario dice
*"solo `UserCredentials` declara un campo de hash de contraseña"*. Es una
**entrada**, y `design.md:318-323` la especifica exactamente así, igual que la
cabecera del repositorio (*"`passwordHash` es entrada de dos escrituras y
salida de UNA sola lectura"*). **Defecto de redacción de la spec, no de
implementación**: el escenario debería decir "ningún tipo de **retorno**".

**W-3 — El título de R7 ("La frontera del hash es estructural, no de
convención") está sobre-declarado.** `index.ts:1-2` (pre-existente, **sin
tocar** por este cambio) re-exporta `Prisma`, `PrismaClient` y el singleton
`prisma`. Consecuencia medida: `grep -c passwordHash dist/index.d.ts` = **52**,
todas dentro del namespace generado de Prisma (`Prisma.UserCreateInput`,
`Prisma.UserSelect`, `UserWhereInput`, payloads de modelo…). Un consumidor de
`@safari/db` puede escribir
`prisma.user.findFirst({ select: { passwordHash: true } })` sin salirse de la
superficie pública. Lo que sí es estructural, y lo verifiqué en el `.d.ts`
construido (la frontera real que ve un consumidor):

- `UserRecord` — 7 claves, ninguna es el hash (`:27448-27456`)
- `ProfileRecord` (`:27461`), `PermissionRecord` (`:27471`), `UserWithRelations` (`:27877`) — limpios
- `UserCredentials` (`:27871-27876`) — el único tipo de **retorno** con `passwordHash`

Es decir: estructural sobre la **API del repositorio**, convención respecto del
escape hatch de Prisma. La fuga es pre-existente y cerrarla (dejar de exportar
`Prisma`/`PrismaClient`/`prisma`) rompería a `apps/api/rest`: **no es trabajo
de esta US**. Registrar como decisión del épico, no como defecto de US-21.

**W-4 — El delta de `identity-schema` es exacto en lo que cita, pero su texto
de reemplazo importa una frase que contradice la spec que edita.**

Lo que el delta afirma reemplazar es **correcto**: el `## Out of Scope` del
`openspec/specs/identity-schema/spec.md` promovido empieza literalmente por
``` `packages/db`/Prisma (US-21) ``` — sin distinguir modelos de repositorios,
tal como el delta dice. Ese es el punto que este cambio falsifica, y lo
falsifica de verdad. **La reclamación del delta es precisa.**

El problema está en el texto nuevo: termina con
*"`db/schema.sql`/`db/seed.sql` (cerrados por US-20 — **esta US no ejecuta
DDL**)"*, que es una frase de US-21 copiada del `Out of Scope` de
`identity-data-layer`. Pegada en `identity-schema` —la spec de **US-20**—
declararía fuera de alcance precisamente el DDL y el seed que son sus propios
requirements (`### Requirement: Tablas núcleo de identidad con sus
restricciones`, `### Requirement: El seed es determinista y respeta la FK al
aplicar`). Y "esta US" ahí se lee como US-20, no US-21. **Acción para
`sdd-archive`**: al aplicar el delta a mano, eliminar esa última cláusula y
sustituir "esta US" por el slug explícito.

**W-4b — El texto de CA-5 en la US no se anotó con la reinterpretación.**
`21-capa-datos-identidad.md:66-69` sigue diciendo *"`listUsers` devuelve el
envoltorio de paginación estándar de la casa (`buildPaginator`)"* mientras la
función embarcada devuelve `{ items, total }`. La reinterpretación está bien
declarada en `proposal.md:68-76` y en la spec R5, y ninguna casilla de la DoD
la reclama falsamente — pero quien lea la US aislada concluirá que CA-5 no se
cumplió. Añadir una línea de anotación en la US (una frase, sin cambiar el CA).

**W-5 — La rama `name` de la búsqueda de `listUsers` no tiene assert (R5-S11
PARTIAL).** `users.integration.test.ts:106-109`:

```ts
const byEmail = await listUsers({ text: 'admin' });
expect(byEmail.items.some((u) => u.email === 'admin@demo.com')).toBe(true);
```

El escenario pide *"`items` incluye ese usuario, **sin importar si `text`
coincide con `name` o con `email`**"*. `'admin'` solo coincide con el email: el
`name` del usuario 3 es `Jhon Doe`. La rama `{ name: { contains … } }` del `OR`
(`users.repository.ts:197`) **nunca se ejecuta con un assert detrás** — una
regresión que borrara esa rama dejaría la suite en verde. Falta un caso, del
tamaño de dos líneas, p. ej. `listUsers({ text: 'Jhon' })` → incluye
`admin@demo.com` (o `text: 'Store'` → `store_owner@demo.com`). Es el único
hueco de cobertura real que encontré. No bloquea la DoD (CA-6 nombra tres
casos, y los tres están cubiertos), pero sí bloquea el "16/16 compliant".

### SUGGESTION

- **S-1** — La spec dice "los **7** modelos del catálogo" (`Purpose`, y el
  escenario R1-S2: *"el diff completo de los 7 modelos de catálogo
  preexistentes"*). Son **9**: los 7 agregados más los pivotes
  `CategoryProduct` y `ProductTag`. `design.md:51-53` ya lo corrigió
  explícitamente ("El archivo tiene hoy **9 modelos** (no 7…)"). Corregir el
  número al promover la spec; no afecta la verificación (revisé los 9).
- **S-2** — El husmeo de códigos P2002/P2025 está inline y duplicado
  (`users.repository.ts:251-256` y `:300-307`), y son las **únicas** dos
  apariciones de `code === 'P…'` en `src/repositories/`. Decision H lo
  justifica (`errors.ts:83-87` agrupa P2002/P2003/P2025 sin distinguirlos), y
  la regla de "abstracción ganada" dice esperar. Cuando US-24/US-25 necesiten
  la misma traducción será el momento de un `isPrismaErrorCode(e, 'P2002')` en
  `errors.ts`. Mencionado, no accionado.
- **S-3** — No pude capturar el conteo de sentencias SQL de
  `findUserWithRelations` (`pg_stat_statements` está *available* pero no
  instalado; habilitarlo exige `shared_preload_libraries` + reinicio del
  contenedor). El veredicto de "sin N+1" es estructural: un `findUnique`, un
  `include` compartido, cero bucles por fila. Prisma sin el preview
  `relationJoins` emite un número **constante** de sentencias para esa forma
  (independiente del número de filas), que es lo que "sin N+1" significa aquí.

---

## Carry-forward — cada punto re-verificado, no re-citado

1. **La restricción `lower(email)` que los callers heredan: ✅ documentada.**
   `packages/db/README.md` (bloque nuevo): *"Cualquier consumidor nuevo que
   necesite comparar por email hereda esta misma regla (`lower(email) =
   lower($1)`, `identity-schema/spec.md`)"*. Va acompañada de la evidencia de
   qué formas **no** usan el índice — y W-1 matiza esa evidencia: la afirmación
   correcta es *elegibilidad* del índice, no que el planner lo elija sobre 3
   filas.
2. **`grantPermission` → US-25: ✅ sigue fuera.** Cero implementación; única
   mención, un comentario de rumbo en `users.repository.ts:217`. Ningún tipo ni
   export lo insinúa.
3. **El armado del `pivot` → servicio de Nest de US-22: ✅ sigue fuera, y el
   dato de Decision G se confirma con una precisión.** Medido sobre
   `apps/api/rest/src/db/pickbazar/users.json`: **12 objetos `pivot`**, con
   **dos** key-sets distintos:
   - `model_id, model_type, permission_id` → **3 claves, ninguna es fecha**.
     Es el pivote de **permisos**, el que Decision G describe. Muestra:
     `{"model_id":6,"permission_id":1,"model_type":"Marvel\\Database\\Models\\User"}`.
     **Decision G es exacta.**
   - `created_at, order_id, order_quantity, product_id, subtotal, unit_price,
     updated_at, variation_option_id` → 8 claves, dos de ellas fechas. Es el
     pivote de **order-product**, ajeno a `permissions[]` y a esta US.
   La precisión importa para US-22: si alguien re-verifica "el `pivot` de
   `users.json` no lleva fechas" con un grep amplio, encontrará el de órdenes y
   creerá que Decision G se equivocó. No se equivoca — hay que mirar
   `permissions[].pivot`. `PermissionRecord` sigue con sus 5 columnas y sin
   `assignedAt`.
4. **Doc drift `.env.template` → `.env.example`: ✅ sigue abierto y sin
   accionar (correcto — es de US-22).** `22-login-jwt-postgres.md:122` y `:153`
   citan `apps/api/rest/.env.template`. El real es `.env.example`:
   `justfile:59` → `crear apps/api/rest/.env.example apps/api/rest/.env`, y
   `ls apps/api/rest/.env*` → `.env`, `.env.example`. **No existe ningún
   `.env.template` en `apps/api/rest`** (los de `apps/shop` y
   `apps/admin/rest` sí se llaman `.env.template`, de ahí la confusión).

---

## Verdict

**PASS WITH WARNINGS**

La Definición de Done de US-21 está **cerrada**: las 6 casillas tienen salida
real de comando detrás, re-ejecutada en contexto fresco. Cero defectos de
implementación, cero deriva de diseño, disciplina de alcance impecable (nada
bajo `apps/`, `db/`, `services/`; `package.json` intacto; sin `grantPermission`
ni repositorios de US-24). 13 de 16 escenarios COMPLIANT con test o comando en
verde.

Lo que impide un PASS limpio son cinco avisos, ninguno bloqueante para
archivar y ninguno de código: **W-5** es el único hueco de cobertura real (dos
líneas de test para la rama `name` de la búsqueda); **W-1**, **W-2** y **S-1**
son redacciones de spec que la realidad matiza y que conviene corregir *antes*
de promover `identity-data-layer` a `openspec/specs/`; **W-4** es una cláusula
del delta que `sdd-archive` debe recortar al aplicarlo a mano, o dejará la spec
de US-20 declarando fuera de alcance su propio DDL; **W-3** documenta un
escape hatch pre-existente de Prisma que esta US no introdujo y no le toca
cerrar.
