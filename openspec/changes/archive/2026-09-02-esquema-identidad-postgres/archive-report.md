# Archive Report: Esquema de identidad en Postgres (US-20)

**Change**: `2026-09-02-esquema-identidad-postgres`  
**Archived**: 2026-09-02  
**Status**: PASS (verified via real execution)  
**Verification Gate**: `sdd-verify` full pass; `just db-check` 57/57; zero deviations from design

---

## Deliverables vs. Acceptance Criteria

Seis tablas de identidad (`users`, `profiles`, `permissions`, `permission_user`, `password_reset_tokens`, `otp_codes`) con 3 usuarios demo, hashes bcrypt verificables y la FK de `shops.owner_id` cerrada contra `users.id`. El seed es determinista y respeta el orden de FK. Nada consume recuperación/OTP todavía (US-24); nada de aplicación toca las nuevas tablas (US-21/US-22 hereda).

### Criterios de Aceptación — Entregados

**✅ CA-1: Tablas de identidad creadas**

- 6 `CREATE TABLE` (`users`, `profiles`, `permissions`, `permission_user`, `password_reset_tokens`, `otp_codes`) en `db/schema.sql:104-212`, antes de `shops`
- Columnado exacto: `users` con `password_hash text NOT NULL`, `is_active boolean NOT NULL DEFAULT true`, `email_verified_at timestamptz NULL`; sin `wallet`, `address`, `last_order`, `shops`, `shop_id`, `email_verified`
- `is_active` aterriza booleano (convertido del entero `1` por `bool()`)

**Evidence**:
```
Design § File Changes + Decision D + Task 1.1
information_schema.columns (36 filas, 6 tablas): todos los tipos y ausencias verificados
Verify-report § 2 (Estructura del DDL)
```

**✅ CA-2: Tablas de recuperación y OTP creadas, con la nota de "nadie las usa"**

- `password_reset_tokens` con `user_id FK → users(id) ON DELETE CASCADE`
- `otp_codes` sin FK a `users` (excepción justificada: endpoint por teléfono; columna de teléfono no única)
- Ambas cabeceras declaran "sin consumidor hasta US-24" en `db/schema.sql:182,198`

**Evidence**:
```
Design § File Changes + Decision D
db/schema.sql:157-169
Verify-report § 7 (R5) — 0 filas en ambas post-seed
```

**✅ CA-3: La FK de tiendas cierra**

- `shops.owner_id bigint NOT NULL DEFAULT 1 REFERENCES users(id) ON DELETE RESTRICT`
- Cero huérfanos post-`db-reset`, 12 tiendas, todos con `owner_id = 1`

**Evidence**:
```
Design § Decision B/C + Task 1.3
Verify-report § 3 (Acciones de FK) y § 7 (R6-S1) — 0 huerfanas, 12 tiendas
Comportamiento real del RESTRICT: INSERT con owner_id inexistente rechazado
```

**✅ CA-4: Seed con los 3 usuarios y credencial usable**

- 3 usuarios (ids 1/2/3) con `email` y `password_hash`
- `demodemo` literal bcrypt con prefijo `$2b$` y `compareSync('demodemo', hash) = true` en los 3
- 6 filas de `permission_user` en la matriz exacta (1→customer+store_owner, 2→customer, 3→super_admin+customer+store_owner)

**Evidence**:
```
Design § Decision E + Task 2.1-2.2
Verify-report § 8 (Hash bcrypt) — compareSync true x3, false en wrongpass
db/generate-seed.mjs:49-62, HASH_DEMO literal sin dependencias nuevas
```

**✅ CA-5: El orden del seed respeta la FK**

- Identidad (`users` → `profiles` → `permissions` → `permission_user`) insertada antes de `shops` en `db/generate-seed.mjs:200-258`
- Aplicación desde vacío sobre una base desechable sin una sola violación de FK
- Determinismo: dos corridas del generador producen `seed.sql` byte a byte idéntico

**Evidence**:
```
Design § Data Flow + Task 2.4-3.1-3.2
Verify-report § 5 (Determinismo) — cmp limpio tras 2 regeneraciones
Verify-report § 6 (Aplicación desde vacío) — ON_ERROR_STOP=1, exit=0, grep error|violat vacío
git diff --stat db/seed.sql — aditivo, bloques nuevos pre-shops
```

**✅ CA-6: Sin regresión del catálogo**

- `just db-check` verde (6 archivos / 57 tests)
- `products` 1200, `categories` 198, `shops` 12 (`max(id) = 15`)

**Evidence**:
```
Design § Testing Strategy + Task 4.6
Verify-report § 8 — exit 0, 57/57 tests
Verify-report § 7 — conteos exactos 1200/198/12
```

---

## Decisiones de Diseño — Todas aplicadas tal cual

### Decisiones cerradas (Proposal D-1..D-10, adoptadas sin reapertura)

| # | Tema | Decisión aplicada | Verificación |
|---|---|---|---|
| **D-1** | Email case-insensitive | `email text` + `CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email))`, sin `citext` | `db/schema.sql:131`; hand-off a US-21 para `WHERE lower(email) = lower($1)` |
| **D-2** | Alcance documental | Solo `db/README.md`; `apps/README.md` fuera (hand-off a US-22) | `git diff --stat` sin cambios en `apps/README.md` |
| **D-3** | `otp_codes` sin FK | Clave por teléfono en texto plano, sin FK a `users` | `db/schema.sql:200-203` + pg_constraint: 0 FK desde `otp_codes` |
| **D-4** | `profiles` con PK `user_id` | `user_id bigint PRIMARY KEY`, ignorando `profile.id` del JSON | Verify-report § 7 (R3) — 2 usuarios con mismo `profile.id` de origen no colisionan |
| **D-5** | `permission_user.user_id` real | Del `id` iterado, nunca de `pivot.model_id` (6 en admin) | Mutación M-1 del verify-report: `user_id: p.pivot.model_id` → `exit(1)` antes de escribir |
| **D-6** | Pivote con fecha | `permission_user` + `created_at timestamptz NOT NULL DEFAULT now()` | `db/schema.sql:153` |
| **D-7** | Tokens por `user_id` | `password_reset_tokens.user_id FK`, no por email | `db/schema.sql:159` |
| **D-8** | Ubicación e inline | Identidad antes de `shops`, FK inline en `CREATE TABLE shops` | `db/schema.sql:104-212` antes de `:231`, transacción única |
| **D-9** | `staff` sin asignar | Fila en `permissions` (id 4) sin entrada en `permission_user` | Verify-report § 7 — `permissions` 4 filas, 0 asignados a `staff` |
| **D-10** | `just db-reset` autorizado | Con confirmación previa; 0 filas del scraper que perder | Documentado en design.md § Verification Plan § punto 2 |

### Decisiones de diseño (Design A-M, coherentes todas)

| # | Tema | Decisión aplicada | Verificación |
|---|---|---|---|
| **A** | Triggers `updated_at` | Sí en `users`/`profiles`, NO en `permissions` | `db/schema.sql:497-500`; `pg_trigger` en vivo devuelve 5 triggers (exactos), `permissions` sin trigger |
| **B** | FK actions | 4 `CASCADE` (hijas) + `RESTRICT` (shops.owner_id) | `pg_constraint`: 5 FK (`c c c c r`); comportamiento ejercitado (§ 3 verify-report) |
| **C** | `DEFAULT 1` sobrevive | Comentario reescrito entero; load-bearing para `pipelines.py` | `db/schema.sql:223-229`; `pipelines.py:188` sin `owner_id` → aterriza en 1 |
| **D** | Forma DDL / banners | `=====` en `users`, `-----` en las otras; `users_email_lower_idx` pegado a su tabla | `db/schema.sql` lectura completa; estilo verificado |
| **E** | Hash bcrypt literal | Sin dependencias; comando de regeneración en comentario; **no** en tiempo de generación | `db/generate-seed.mjs:49-62`; `grep bcrypt package.json` = vacío en todo el repo |
| **F** | 5 validaciones previas | `exit(1)` antes de escribir; efectivas por mutación | Mutaciones M-1/M-2/M-3 (verify-report § 4): todos abortan pre-writeFileSync |
| **G** | `created_at`/`updated_at` no emitidos | Las filas toman `now()` del `db-up` | Ningún bloque los emite; patrón de 6 bloques existentes |
| **H** | `email_verified_at` con `txt()` | No con `ts()` que devuelve `now()` ante `null` | `db/generate-seed.mjs:214`; `ts()` no invocado en el archivo |
| **I** | `is_active` con `bool()` | Conversión del entero 1 | `db/generate-seed.mjs:214`; verify-report § 7 (R1-S2) — 3 filas `true` |
| **J** | `ON CONFLICT` por PK real | `users(id)`, `profiles(user_id)`, `permissions(id)`, `permission_user(user_id,permission_id)` | `db/generate-seed.mjs:193-258` |
| **K** | `setval` solo para `users`/`permissions` | Excluidas `profiles` (PK prestada), `permission_user` (PK compuesta), tokens/otp (0 filas) | `db/generate-seed.mjs:417` |
| **L** | `pivot.model_type` no persistido | Constante Laravel sin contraparte | No aparece en generador ni DDL |
| **M** | Cabeceras de conteo | Línea `… 3 usuarios · 4 permisos` | `db/generate-seed.mjs:165-167`, `db/README.md:26` |

---

## Deviations from Design

**Cero.** Toda la implementación adhiere al design.md línea por línea. Los parámetros se aplican tal cual.

---

## Verification Evidence (Real Execution)

### Tests

```
$ just db-check
npm run typecheck
> @safari/db@0.1.0 typecheck
> tsc --noEmit

cd "$(pwd)" && npm test
> @safari/db@0.1.0 test
> vitest run

 Test Files  6 passed (6)
      Tests  57 passed (57)
   Start at  10:48:47
   Duration  5.56s
```

Exit 0. **6 archivos / 57 tests**, sin caída respecto a la línea base.

### Spec Compliance

**8 requirements / 12 scenarios** — todos satisfechos:

- R1 (Tablas núcleo): 2 scenarios ✅
- R2 (Email case-insensitive): 1 scenario ✅
- R3 (`profiles` 1:1): 1 scenario ✅
- R4 (Permisos y pivote): 2 scenarios ✅
- R5 (Recuperación/OTP vacías): 1 scenario ✅
- R6 (FK de tiendas): 1 scenario ✅
- R7 (Determinismo): 3 scenarios ✅
- R8 (Sin regresión): 1 scenario ✅

Todos los scenarios cubiertos con `grep -c` exacto en el archivo y verificación real.

### Counts Post-Reset

```
users: 3 (ids 1, 2, 3)
profiles: 3
permissions: 4 (super_admin, customer, store_owner, staff)
permission_user: 6 (pivote real)
password_reset_tokens: 0 (sin consumidor)
otp_codes: 0 (sin consumidor)
shops: 12 (max id 15)
orphan shops: 0
products: 1200
categories: 198
```

### Hash Verification

```
$ cd "$(mktemp -d)" && npm install --no-save bcryptjs && node -e "…"
id=1 prefix=$2b$ compare('demodemo')=true wrongpass=false
id=2 prefix=$2b$ compare('demodemo')=true wrongpass=false
id=3 prefix=$2b$ compare('demodemo')=true wrongpass=false
```

Tres usuarios, prefijo `$2b$`, `compareSync` verdadero en los tres, falso en contraseña equivocada.

### Determinism

```
$ node db/generate-seed.mjs && cp db/seed.sql $SCRATCH/r1.sql
$ node db/generate-seed.mjs && cmp db/seed.sql $SCRATCH/r1.sql && echo OK
R1==R2 OK
```

Byte a byte idéntico en dos corridas.

### FK Behavior (Exercised Real)

```
-- FK muerde:
BEGIN; INSERT INTO shops (name,slug,owner_id) VALUES ('x','x-slug',99);
ERROR: violates foreign key constraint "shops_owner_id_fkey"

-- DEFAULT 1 vive (load-bearing para scraper):
BEGIN; INSERT INTO shops (name,slug) VALUES ('Test','test-slug');
INSERT 0 1  →  owner_id = 1

-- RESTRICT protege usuario 1:
BEGIN; DELETE FROM users WHERE id=1;
ERROR: update or delete on table "users" violates foreign key constraint "shops_owner_id_fkey"

-- CASCADE limpia usuario 2:
BEGIN; DELETE FROM users WHERE id=2; SELECT count(*) FROM profiles WHERE user_id=2;
 count
-------
     0
```

---

## Hand-offs (No accionadas aquí)

1. **US-21**: `WHERE lower(email) = lower($1)` en todo lookup. El índice no se usa con `email = $1` ni con `enable_seqscan=off` — evidencia EXPLAIN en verify-report § 7 (R2-S1).

2. **US-22**: documentar `demodemo` en `apps/README.md` (D-2, decision 7 del épico). Precisión: `22-login-jwt-postgres.md:122,153` cita `.env.template`; el real es `.env.example` (justfile:59). Ojo al matiz: `apps/shop` y `apps/admin/rest` sí usan `.env.template`; la excepción es la API.

3. **US-25**: `staff` (id 4) existe sin asignar. Asignarlo no requiere otro `db-reset`.

4. **Governance — CLAUDE.md drift**: `CLAUDE.md:48,90` culpan a `pipelines.py` de escribir en la tabla legada `productos`. Es falso: `pipelines.py:188-247` ya escribe en `products`/`shops`/`manufacturers`. La verdadera rotura de `just db-test` está en `services/scraper-worker/test_pipeline.py`, que asserta 9 veces contra `productos`. Es **US-6**. Sin tocar en esta US.

---

## Coupling Introduced

**User 1 must always exist.** El scraper (`pipelines.py:188-190`) crea retailers con `INSERT INTO shops (name,slug)` sin `owner_id` — `DEFAULT 1` las asigna a usuario 1. La FK ahora lo exige: borrar usuario 1 está bloqueado por `RESTRICT`. Protegido por: (1) la validación F del generador (verifica que todos los `owner_id` de shops existen), (2) el `RESTRICT` de la FK.

---

## Conscious Debt

**`permissions.updated_at` congelado.** La tabla tiene la columna pero `permissions` no tiene trigger (Decision A). Las filas se insertan una sola vez en el seed y nunca se actualizan — no hay efecto práctico. Documentado en el comentario del DDL.

---

## Specs Promoted to Main Source of Truth

| Domain | Action | Location |
|--------|--------|----------|
| `identity-schema` | NEW (full spec) | `openspec/specs/identity-schema/spec.md` |

**Modified Capabilities**: None. Las specs existentes (`flat-catalogs-api`, `derived-catalog-api`) no se falsean: `owner` se sigue emitiendo `null` (V-4), el contrato HTTP no cambia.

---

## Artifact Inventory

✅ **Archived change** (all source artifacts preserved):
- `explore.md` — discovery session (identidad en el modelo)
- `proposal.md` — user story, scope, approach, decisions cerradas
- `design.md` — technical approach, 13 decisiones, testing strategy
- `specs/identity-schema/spec.md` — full spec (PROMOTED)
- `tasks.md` — 23/23 tasks [x] completed
- `apply-progress.md` — execution journal + all code diffs
- `verify-report.md` — verification with real execution proof
- `archive-report.md` — this file

✅ **Main specs updated** (2026-09-02):
- `openspec/specs/identity-schema/spec.md` (new)

✅ **Previous archives intact** (7 changes prior, 2026-08-25 to 2026-08-31):
- All archives remain untouched

---

## Implementation Results

### Code Delivered

| File | Action | Lines Changed | What |
|------|--------|---|---|
| `db/schema.sql` | Modified | +141, -0 (insertado) | 6 tablas + índice funcional + 3 índices de consulta + 2 triggers; comentarios de alcance y `owner_id` reescritos |
| `db/generate-seed.mjs` | Modified | +127, -0 | `HASH_DEMO`, lectura `users.json`, 5 validaciones previas, 4 bloques emisión, `setval` ampliado, conteos |
| `db/seed.sql` | Regenerated | +51, -0 (aditivo) | Bloques de identidad pre-shops; catálogo intacto |
| `db/README.md` | Modified | +45, -0 | Sección identidad (tablas, matriz de permisos, credencial `demodemo`, por qué `lower(email)`, por qué `otp_codes` sin FK) |
| `docs/product/19-autenticacion-autorizacion/20-esquema-identidad-postgres.md` | Modified | Updated | Status ✅ Implementada, fila con puntero a apply-progress.md |
| `docs/product/19-autenticacion-autorizacion/README.md` | Modified | +1 line | Fila US-20 marcada ✅ Implementada |

**Diff total**: 365 insertions, 20 deletions, 6 archivos modificados. Máximo ~260-300 líneas manuales (schema.sql + generate-seed.mjs), ~51 generadas (seed.sql). Confirmado: alineado con forecast.

### Tests Green

- `just db-check`: **57/57 tests** across 6 test files
- `just build` / `just verify`: inaplicables (cambio confinado a `db/` + docs)

### Gates Verified

- ✅ Base on baseline: `products: 1200, shops: 12, categories: 198`
- ✅ Seed diff: aditivo, bloques nuevos pre-shops
- ✅ No regressions: `just db-check` verde, no caída de tests
- ✅ No new dependencies: `bcrypt*` no entró en `package.json`
- ✅ Determinism: `cmp` limpio tras 2 regeneraciones
- ✅ FK integrity: 0 violaciones en aplicación desde vacío

---

## SDD Cycle Completion

- [x] Exploration (discovery, identidad en el archivo)
- [x] Proposal (scope, approach, 10 decisiones cerradas — all approved)
- [x] Specification (8 requirements, 12 scenarios — identity-schema NEW)
- [x] Design (13 decisiones, testing strategy, migration plan)
- [x] Tasks (23 tasks, all completed in order)
- [x] Implementation (code delivered, no app changes, puro DDL + generador)
- [x] Verification (PASS; real execution proof; mutation testing; FK exercised)
- [x] Archive (spec promoted, audit trail preserved)

**Status**: Cycle closed. Ready for next change (US-21).

---

## Commits

- `7080963`: `db/schema.sql` + `db/README.md`
- `97ca04d`: `db/generate-seed.mjs` + `db/seed.sql` + docs de producto

---

**Archive Report Created**: 2026-09-02  
**SDD Phase**: `sdd-archive` (executor: Claude Code)  
**Verification Closure**: By real execution; all 8 requirements and 12 scenarios verified
