# Tasks: Capa de datos de identidad en `@safari/db`

## Review Workload Forecast

Hand-written (records+repo+test+index+README): ~480-560 líneas. Generado
(`schema.prisma`): ~150-180 líneas, revisión humana completa igual (R-2).
Total estimado: ~630-740 líneas.

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

- PR 1 (base main): Fase 1 — introspección + drift exit 0.
- PR 2 (base PR 1): Fases 2-3 — records + lecturas + test temprano.
- PR 3 (base PR 2): Fases 4-7 — escrituras, wiring, verificación, cierre.

Chain strategy pendiente: preguntar (stacked-to-main | feature-branch-chain | size-exception).

## Fase 1: Esquema — introspección y gate de drift (CA-1)

- [x] 1.1 `cd packages/db && npx prisma db pull` sobre `schema.prisma`.
- [x] 1.2 Reaplicar renombres: 6 modelos identidad + `Shop.owner`; preservar catálogo/`partialIndexes`/`datasource` sin `url`.
- [x] 1.3 Diff contra baseline (scratchpad) + `git diff prisma/schema.prisma` completo — cero renombres perdidos (R-2).
- [x] 1.4 `npx prisma validate` — salida verde.
- [x] 1.5 `npx prisma migrate diff --from-config-datasource --to-schema ./prisma/schema.prisma --exit-code`; `echo "EXIT=$?"` — debe ser 0 (hoy 2).
- [x] 1.6 `npm run generate` — el cliente gana `prisma.user`.

## Fase 2: Records y lecturas (CA-2, CA-3, CA-5)

- [x] 2.1 `src/records.ts`: `UserRecord` (sin hash), `ProfileRecord`, `PermissionRecord` + mappers `_to*Record`, con `_id()`.
- [x] 2.2 `src/repositories/users.repository.ts` (crear): `UserCredentials`, `findUserCredentialsByEmail` vía `$queryRaw` `lower(email)=lower($1)`.
- [x] 2.3 Mismo archivo: `USER_RELATIONS`, `UserWithRelations`, `findUserById`, `findUserWithRelations`.
- [x] 2.4 Mismo archivo: `ListUsersInput`, `listUsers` (`permissionName` + `text`).

## Fase 3: Señal temprana — test de lecturas (R-1)

- [x] 3.1 `users.integration.test.ts` (crear): escenarios de lectura del spec (CA-2/CA-3/CA-5).
- [x] 3.2 `cd packages/db && npm test` — pegar salida: corre y pasa, antes de las escrituras.

## Fase 4: Escrituras y aislamiento (CA-4) — unidad única

- [x] 4.1 `users.repository.ts`: `CreateUserInput`, `DuplicateEmailError`, `createUser` (nested write; P2002→error).
- [x] 4.2 Mismo archivo: `updateUserPasswordHash`, `setUserActive` (P2025→`null`).
- [x] 4.3 `users.integration.test.ts`: fixture (`TEST_DOMAIN='@users-integration.test'`, cleanup ambos extremos) + escenarios de escritura CA-4, incluido `999999`→`null`.
- [x] 4.4 Mismo test: conteos `users/shops/products/categories` idénticos antes/después (3/12/1200/198) — verificado con el `SELECT` externo de la Fase 6 (task 6.4), no dentro del archivo (ver nota en el propio test: los `it()` corren antes del `afterAll` de limpieza).

## Fase 5: Wiring y guardas negativas

- [x] 5.1 `index.ts`: bloque `users` tras `types.repository` — Records, tipos, funciones, `DuplicateEmailError`.
- [x] 5.2 `grep -n bcrypt packages/db/package.json` sin match; `git status` sin `apps/api/rest`.

## Fase 6: Verificación de cierre

- [x] 6.1 `just db-build` — tsup (CJS + `.d.ts`) sin errores.
- [x] 6.2 `npm run lint` en `packages/db` — exports ordenados (ver nota de deviación: falla pre-existente por CRLF, no por orden).
- [x] 6.3 `just db-check` con `cwd` en mayúscula (`C:\DevOps\...`; minúscula → "0 tests" falso) — "Test Files 7 passed (7) / Tests 73 passed (73)".
- [x] 6.4 `docker exec safari-postgres psql ...` conteos `users/profiles/permission_user/shops` antes/después de 6.3 — 3/3/6/12 en ambos momentos.

## Fase 7: Documentación y cierre

- [x] 7.1 `packages/db/README.md`: sección identidad — agregado, frontera D-2, por qué el `$queryRaw`, índice no modelado.
- [x] 7.2 Reporte final, sin accionar: `grantPermission` (US-25); `pivot` en Nest (US-22); doc drift `.env.template`→`.env.example`; `sdd-archive` aplica a mano el delta de `identity-schema`.
- [x] 7.3 Última: `Status` en `21-capa-datos-identidad.md` + fila US-21 en README del épico, tras la evidencia de fases 1-6.
