# Proposal: Capa de datos de identidad en `@safari/db`

> **US-21**, Épico 19. Insumo: `explore.md` (esta carpeta), con SQL y `EXPLAIN` reales.
> Precedente de estilo: `archive/2026-09-02-esquema-identidad-postgres/`. Las decisiones
> **(cerradas)** las fijó el dueño del repo tras leer la exploración: no se re-abren en `sdd-design`.

## Intent

US-20 dejó las 6 tablas de identidad en Postgres, sembradas y con la FK de `shops` cerrada,
pero **ninguna vía tipada llega a ellas**: `schema.prisma` sigue con sus 7 modelos de catálogo y
`prisma.user` no existe en el cliente generado. Sin esto, migrar `auth.service.ts` en US-22
sería un rediseño (Prisma crudo dentro de Nest, contra D-1 del épico) en vez de un cambio de
fuente de datos. Esta US entrega una **librería que todavía nadie llama**: modelos por
introspección, records, repositorio de funciones planas y tests. Cero cambios en `apps/`,
cero cambios en la base.

## Scope

### In Scope

| Archivo | Cambio |
|---|---|
| `packages/db/prisma/schema.prisma` | modelos por `prisma db pull` + renombres manuales (PascalCase, camelCase con `@map`, relaciones con nombre) + la relación `Shop.owner`, hoy inexistente (`ownerId BigInt @default(1)` sin `@relation`) |
| `packages/db/src/records.ts` | `UserRecord`, `ProfileRecord`, `PermissionRecord` + mappers `_to*Record`, reutilizando `_id()` sin tocarlo |
| `packages/db/src/repositories/users.repository.ts` | **nuevo**: las 7 funciones de abajo |
| `packages/db/src/repositories/users.integration.test.ts` | **nuevo**: cobertura de las 7 |
| `packages/db/index.ts` | exports, en el orden por dominio ya usado |
| `packages/db/README.md` | el agregado de identidad y la frontera D-2 |

### Out of Scope (vinculante — "NO incluye" de la US)

JWT, hashing y verificación de contraseñas: **`bcryptjs` no entra a `packages/db`** (US-22) ·
repositorios de `password_reset_tokens` y `otp_codes` (US-24) · **cualquier** archivo bajo
`apps/api/rest` · `grantPermission`/`make-admin` (US-25, D-3) · `db/schema.sql` y `db/seed.sql`
(cerrados por US-20) · frontends · scraper.

**Adyacentes detectadas y NO accionadas**: `auth.service.ts:154-156` (`me()` devuelve
`users[0]`, siempre admin) · `products.service.ts` pagina con su `paginate()` propio.

## Capabilities

### New Capabilities

- `identity-data-layer`: acceso tipado a usuarios, perfiles y permisos desde `@safari/db`
  (lecturas, escrituras, listado paginado) con el hash aislado en una única función.

### Modified Capabilities

- None. `identity-schema` no cambia: esta US **cumple** su MUST (`spec.md:38`,
  "todo consumidor MUST comparar `lower(email) = lower($1)`"), no lo altera.

## Approach — decisiones cerradas

**D-1 — `findUserCredentialsByEmail` usa `$queryRaw` con `lower(email) = lower($1)` explícito**,
y es el **único** SQL crudo que introduce esta US; el resto del repositorio queda en Prisma
tipado. Evidencia, no preferencia: normalizar en JS genera `WHERE email = $1`, que **no** usa
`users_email_lower_idx` ni con `enable_seqscan=off`; `mode:'insensitive'` genera `ILIKE`, que
tampoco. Es además correcto **sea cual sea el casing almacenado** — verificado contra
`pg_constraint` que **no hay CHECK constraint** en ninguna tabla de identidad que fuerce
minúsculas: el índice único funcional impide dos filas que difieran solo en casing, pero no
canonicaliza lo que se escribe. El precedente existe (`health.ts:21`, `$queryRaw\`SELECT 1\``):
el "cero `$queryRaw`" que presumía el diseño de US-5 nunca fue literalmente cierto y **ningún
README lo declara política**. *Consecuencia*: esa función mapea su fila a mano, sin los tipos
generados de Prisma — necesita cobertura propia de ese mapeo.
*Recomendación para el diseño (no cerrada)*: las escrituras **pueden** normalizar el email a
minúsculas como defensa en profundidad, pero la corrección ya no depende de ello.

**D-2 — `listUsers` devuelve `{ items, total }`, no el envoltorio de `buildPaginator`.** Es una
**reinterpretación declarada de CA-5**, no una lectura de lo que la US dice: CA-5 pide
literalmente el wrapper. `packages/db/README.md:74` documenta lo contrario como contrato del
paquete ("los repositorios devuelven `{ items, total }` y el caller arma el envoltorio") porque
las claves `*_page_url` dependen de `APP_URL`, que el README declara configuración de la app y
no asunto de la capa de datos; los 7 repositorios existentes siguen esa forma; y
`buildPaginator` tiene **cero call sites de producción** (su única invocación real es
`products.integration.test.ts:97`). Hacer de `listUsers` el único listado asimétrico es la
inconsistencia que muerde tres US después. *Consecuencia*: el servicio de Nest de US-25 llama a
`buildPaginator` con su `baseUrl`, como el README ya documenta para products.

**D-3 — `grantPermission` queda fuera.** CA-4 enumera exactamente tres escrituras y la tabla de
archivos de US-25 ya lista `users.repository.ts` ("lo que falte para las listas por rol y
`make-admin`"): la segunda pasada está planificada, no es un descubrimiento tardío.

## Superficie pública del repositorio (altitud de propuesta)

Diseñada contra lo que US-22 y US-25 consumen de verdad. Ids `number` (vía `_id()`), fechas
`Date`, camelCase.

| Función | Argumentos | Devuelve | CA / consumidor |
|---|---|---|---|
| `findUserCredentialsByEmail` | `email: string` | `UserCredentials \| null` — **la única forma con `passwordHash`**: `{ id, email, passwordHash, isActive }` | CA-2 · login US-22 |
| `findUserById` | `id: number` | `UserRecord \| null` (**sin** `passwordHash`) | CA-2 · detalle US-25 |
| `findUserWithRelations` | `id: number` | `UserWithRelations \| null` = `UserRecord` + `profile`, `permissions[]`, `shops[]` | CA-3 · `/me` US-22, US-25 |
| `listUsers` | `ListUsersInput { page?, limit?, text?, permissionName? }` | `{ items: UserRecord[]; total: number }` (D-2) | CA-5 · 5 de los 7 controladores de US-25 |
| `createUser` | `{ name, email, passwordHash, profile?, permissions? }` | `UserRecord` | CA-4 · registro US-22 |
| `updateUserPasswordHash` | `id: number, passwordHash: string` | `UserRecord \| null` | CA-4 · US-22, US-24 |
| `setUserActive` | `id: number, isActive: boolean` | `UserRecord \| null` | CA-4 · block/unblock US-25 |

**La frontera D-2 del épico en las firmas**: `passwordHash` es **entrada** de dos escrituras y
**salida** de una sola lectura. `UserRecord` no lo declara; se recomienda que `UserCredentials`
viva en `users.repository.ts` y **no** en `records.ts`, para que la frontera de serialización
del paquete ni siquiera nombre el campo.

## CA-1: un criterio de "sin drift" que de verdad mida drift

CA-1 dice "`prisma validate` no acusa drift", y eso **no puede funcionar**: valida la sintaxis
del `.prisma` y hoy pasa en verde con **cero** modelos de identidad. Criterio propuesto —flags
verificados en esta sesión contra Prisma 7.10, que usa `--from-config-datasource`/`--to-schema`
y **no** los `--from-schema-datamodel`/`--to-schema-datasource` de versiones anteriores:

```bash
cd packages/db && npx prisma migrate diff \
  --from-config-datasource --to-schema ./prisma/schema.prisma --exit-code
```

Ejecutado **hoy** (solo lectura) detecta el drift real y sale con **código 2**:

```
[-] Removed tables
  - otp_codes  - password_reset_tokens  - permission_user  - permissions  - profiles  - users
[*] Changed the `shops` table   [-] Removed foreign key on columns (owner_id)
```

La meta es ese mismo comando con **exit 0** ("No difference detected"). `prisma validate` queda
como gate de sintaxis, no como prueba de fidelidad. *Consecuencia que esto cierra*: para llegar
a exit 0 el `db pull` debe traer **las 6** tablas — los **modelos** de
`password_reset_tokens`/`otp_codes` entran; sus **repositorios** siguen siendo US-24.

## Aislamiento de tests (problema de diseño, no nota al pie)

CA-4 exige cobertura de escritura contra la **misma** base sembrada cuyos conteos assertan los
demás tests (`users` 3; `shops` 12, `products` 1200, `categories` 198). Una escritura que deje
filas rompe a sus vecinos. Opciones halladas y su costo — el diseño elige:

| Opción | Costo |
|---|---|
| **Rollback transaccional** | `$transaction` tiene **0 usos** en el paquete y los repositorios usan el singleton `prisma` de módulo: enrutar los tests por una transacción exigiría cambiar firmas de producción. Costo alto por una razón de test |
| **Fixture centinela + limpieza en ambos extremos** | Único precedente real (`products.integration.test.ts:25-31`, con su comentario de por qué también en `beforeAll`). Barato. Costo: los asserts sobre `listUsers().total` pasan a `toBeGreaterThanOrEqual`, no `toBe(3)` |
| **Rango de ids reservado** | Limpieza trivialmente dirigible, pero escribir ids explícitos es un patrón que el paquete no tiene |

Dato que abarata cualquiera: las 4 FK hijas son **`CASCADE`** (verificado en `pg_constraint`),
así que borrar un usuario de prueba limpia su `profile` y sus filas de `permission_user`.
**Contrapartida**: `shops.owner_id` es `RESTRICT` — un usuario de prueba que llegue a poseer una
tienda no se puede borrar.

## Risks

| Riesgo | Prob. | Mitigación |
|---|---|---|
| **R-1**: los renombres manuales (`@map`, nombres de relación) quedan mal; **ningún test ejercita hoy un modelo `User`** porque no existe | Media | La primera señal real es `users.integration.test.ts`: ordenar las tasks para que corra temprano. El gate de drift atrapa los `@map` mal escritos antes |
| **R-2**: `prisma db pull` **pisa** los renombres manuales de los 7 modelos del catálogo | Media | `git diff` del `schema.prisma` revisado entero; el preview `partialIndexes` **no se quita** |
| **R-3**: un test de escritura deja filas y rompe el conteo `users = 3` | Media | Sección de aislamiento; limpieza en `beforeAll` **y** `afterAll` |
| **R-4**: el hash se filtra por una relación anidada o un `select` olvidado | Baja | D-2 en las firmas, `UserCredentials` fuera de `records.ts`, test explícito de CA-6 |
| **R-5**: vitest reporta "0 tests" con la unidad en minúscula | Baja | El recuento pegado solo vale con `cwd` en `C:\...`; `just db-check` re-normaliza (`justfile:325-327`) |

## Rollback Plan

`git checkout packages/db` + `just db-build`. **No hay ningún cambio de base que deshacer**:
esta US no toca `db/schema.sql`, `db/seed.sql` ni ejecuta DDL, así que —a diferencia de US-20,
cuyo rollback exigía un segundo `just db-reset`— revertir es puramente de código. Y como nada
consume aún el repositorio nuevo, el radio de explosión de un revert es cero.

## Dependencies

`just db-up` con la base sembrada por US-20 · `just db-build` (regenera el cliente tras la
introspección) · sin dependencias npm nuevas.

## Success Criteria (1:1 con la DoD de la US)

- [ ] **CA-1** salida pegada de `prisma migrate diff ... --exit-code` con **exit 0**, más
      `prisma validate` en verde.
- [ ] **CA-2/CA-6** salida pegada del test que prueba que el `UserRecord` público no tiene
      ninguna clave con el hash, más `email` inexistente → `null` y `ADMIN@Demo.com` →
      encuentra a `admin@demo.com`.
- [ ] **CA-3** test con perfil + permisos + tiendas del usuario 1 (dueño de las 12).
- [ ] **CA-4** las tres escrituras cubiertas, con la base en el mismo estado antes y después.
- [ ] **CA-5** `listUsers` con búsqueda por nombre/email y filtro por permiso.
- [ ] `just db-check` verde con el recuento pegado — baseline **6 archivos / 57 tests**, debe subir.
- [ ] `just db-build` limpio (tsup emite CJS + `.d.ts`).
- [ ] `packages/db/README.md` actualizado · status de US-21 y fila del épico.

## Hand-off (no accionar aquí)

1. **US-25**: `grantPermission` para `make-admin` (D-3) y `buildPaginator` con su `baseUrl` en
   el servicio de Nest (D-2).
2. **US-22**: la forma del `pivot` Laravel de `/me` (Open Question 4).
3. **Doc drift abierto desde US-20**: `22-login-jwt-postgres.md:122,153` cita
   `apps/api/rest/.env.template`; el real es `.env.example` (`justfile:59`).

## Open Questions (a fijar en `sdd-design`)

1. **¿`ProfileRecord` anidado en `UserRecord` o aparte?** Sin precedente: todos los `*Record`
   son de una tabla. *Recomendación*: `UserRecord` plano + un tipo compuesto aparte.
2. **¿Lector con relaciones: función propia o flag del lector por id?** *Recomendación*:
   funciones separadas con un `include` compartido, calcando `COUNT_PRODUCTS` de
   `shops.repository.ts` — el único precedente parecido.
3. **¿`listUsers` filtra por nombre o por id de permiso?** *Recomendación*: por **nombre**
   (`permissionName`), que es lo que US-25 pasa literalmente (`admin/list` → `super_admin`).
4. **¿El `pivot` Laravel lo arma la capa de datos?** *Recomendación*: **no**. El repositorio
   expone el dato real (`permission_user.created_at`, D-6 de US-20) y el servicio de Nest de
   US-22 arma el `pivot` con el `model_type` constante: la capa de datos no debería cargar
   constantes de un ORM ajeno.
