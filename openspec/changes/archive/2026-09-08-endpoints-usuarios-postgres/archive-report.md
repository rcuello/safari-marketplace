# Archive Report — endpoints-usuarios-postgres

**Change**: `endpoints-usuarios-postgres` (US-25, historia de cierre del Épico 19)  
**Archived**: 2026-09-08  
**Final Verdict**: **PASS WITH WARNINGS**

---

## Executive Summary

La migración de los 7 grupos de endpoints de `users.controller.ts` desde mock (`users.json`) a PostgreSQL (`@safari/db`) ha sido completada, verificada y archivada. Los seis criterios de aceptación de US-25 se cumplen contra Postgres y la API reales; los 39/39 tasks están marcados `[x]` completos; los tres gates aplicables (tests, build de la API, check de la base de datos) están verdes. La cadena de tres PRs (PR1 base de datos, PR2 refactor de mapper, PR3 migración del servicio) se entregó completa en una rama `pr3/users-postgres` sobre `main`. **El Épico 19 de autenticación y autorización cierra con este change.**

Dos hallazgos documentados permanecen abiertos y deben ser rastreados por separado:

1. **WARNING-1**: `just build` falla, pero la causa es ajena a este change (tiendas con `settings: {}` que hacen crash al prerender `/shops/[slug]`). Es deuda repo-level, no regresión. El build específico de la API (`just build-api`) está limpio.
2. **WARNING-2/3**: La rama "último `super_admin`" solo tiene cobertura unitaria (porque hoy el único `super_admin` es el mismo admin que ejecuta la prueba), y el spec de CA-1 sobreafirmó sobre `next_page_url`/`prev_page_url` siendo siempre strings (corrección ya aplicada antes de merge).

---

## Change Archived

**From**: `openspec/changes/endpoints-usuarios-postgres/`  
**To**: `openspec/changes/archive/2026-09-08-endpoints-usuarios-postgres/`

**Specs Synced**:
- `openspec/specs/user-management-api/spec.md` — **CREATED** (NEW capability)
- `openspec/specs/identity-data-layer/spec.md` — **MODIFIED** (ADDED 2 requirements, MODIFIED 1)
- `openspec/specs/authorization-guards-api/spec.md` — **MODIFIED** (MODIFIED 2 requirements)
- `openspec/specs/auth-jwt-api/spec.md` — **UNTOUCHED** (refactor puro, cero cambio observable)

### Verification Evidence

| Aspect | Result |
|--------|--------|
| Task Completion Gate | ✅ All 39 implementation tasks `[x]` complete, 0 unchecked |
| Final Verdict | ⚠️ **PASS WITH WARNINGS** (per sdd-verify) |
| CA-1: Listado paginado desde Postgres | ✅ Confirmed — envoltorio completo, 3 usuarios reales, filtro por `text` insensible a mayúsculas |
| CA-2: Listas por rol con cifras reales | ✅ Confirmed — 1/2/3/0/0 (no 1/1/1 como el texto de US), `profile`/`permissions[]` presentes |
| CA-3: Detalle con 15 claves, sin hash | ✅ Confirmed — key-set idéntico a `/me`, 404 ante id inexistente/no numérico, hash ausente |
| CA-4: Bloqueo/desbloqueo + guardas | ✅ Confirmed — `is_active` persiste sin invertir, `make-admin` concede permiso, auto-bloqueo → 409, último admin → 409 |
| CA-5: Módulo exige permiso admin | ✅ Confirmed — 16/16 rutas: 401 sin token, 403 con `customer` |
| CA-6: Contratos preservados, sin mock huérfano | ✅ Confirmed — `getUsersNotify` sigue sirviendo a `store-notices`, cero imports de `users.json` |
| `just db-check` | ✅ 91/91 tests (8 archivos), typecheck limpio |
| `npx jest` (apps/api/rest) | ✅ 4 suites / 65 tests |
| `just build-api` | ✅ Compilación limpia, dist generado |
| `just build` (full) | ❌ Falla, causa **preexistente ajena al diff** (settings vacío en tiendas) |
| Diff scope | ✅ 5 commits con 472(+)/208(−) en `users.service.ts`+`users.controller.ts`, 493 líneas de test nuevo, 191 líneas de mock borradas |
| Scope compliance | ✅ Cero cambios en `db/`, cero DDL, cero frontend, `DeleteProfiles` bug intacto como especifica |

---

## Specs Synced: Detalles de Merge

### 1. user-management-api (CREATED)

**Action**: Crear archivo completo desde delta (new capability).

**Merge Details**:
- Full spec con 6 Requirements (Listado paginado, Listas por rol, Detalle, Bloqueo/promoción, Creación/stubs, Permisos requeridos)
- 7 Scenarios (Given/When/Then por requirement)
- Corrección aplicada: CA-1 aclarando que `next_page_url`/`prev_page_url` son `null` cuando no existen (no siempre strings)
- Out of Scope boundary: perfiles avanzados, wallets, ordenes, refund, `become-seller`, corregir `DELETE /profiles/:id`

**File**: `openspec/specs/user-management-api/spec.md` (full content)

### 2. identity-data-layer (MODIFIED)

**Actions**:
1. **ADDED** requirement: "Listado paginado con relaciones para los listados de administración"
   - `listUsersWithRelations(input)` con filtro `permissionName`/`text`, relaciones (`profile`, `permissions[]`) incluidas
   - Scenarios: filtro por permiso trae relaciones; permiso sin titulares → `{items: [], total: 0}`

2. **ADDED** requirement: "Concesión de permiso idempotente"
   - `grantPermission(userId, permissionName)` con `upsert` sobre clave compuesta
   - `UnknownPermissionError` para permiso fuera de catálogo (no error crudo de Prisma)
   - Scenarios: concesión nueva; idempotencia sin fila duplicada; permiso inexistente → error de dominio

3. **MODIFIED** requirement: "Las tres escrituras..." → "Las cuatro escrituras de identidad de esta capability"
   - Nueva descripción incluyendo `grantPermission` (la cuarta)
   - Nuevo scenario "Conceder un permiso es la cuarta escritura" validando inventario de 4 exports

4. **Updated** Out of Scope: removida la cláusula `grantPermission`/asignar `staff` (ahora está IN SCOPE)

**Files Modified**: `openspec/specs/identity-data-layer/spec.md` (3 requirements nuevas insertadas, 1 requirement reemplazada, boundary actualizado)

### 3. authorization-guards-api (MODIFIED)

**Actions**:
1. **MODIFIED** requirement: "Las 250 rutas se clasifican en cuatro buckets verificables"
   - Tabla actualizada: "Con permiso" 117 → 120; "Especial" 6 → 3
   - Descripción aclarada: `profiles` ahora llevan `@Permissions(...ADMIN_ONLY)`, salen de "Especial" entran en "Con permiso"
   - New scenario: "profiles con token customer ya no entra, solo con permiso admin" (observación de la migración)

2. **MODIFIED** requirement: "Las rutas de administración exigen el permiso equivalente"
   - Actualizada descripción: "120 rutas Con permiso (`/api/users`, `/api/profiles`, todo `*/list`...)"
   - Conteo de rutas ajustado a 120 (antes 117)
   - (Scenarios idénticos, solo el requisito de descripción cambió)

**Files Modified**: `openspec/specs/authorization-guards-api/spec.md` (2 requirements reemplazadas, descripción y tablas actualizadas)

### 4. auth-jwt-api (UNTOUCHED)

Per la nota en el delta: el refactor de mappers de `auth.service.ts` a `user-dto.mapper.ts` es **puro**, sin cambio de contrato observable. `/me` sigue publicando el mismo shape. Cero modificaciones a `openspec/specs/auth-jwt-api/spec.md`.

---

## Archive Contents ✅

Preservados en `openspec/changes/archive/2026-09-08-endpoints-usuarios-postgres/`:

- `proposal.md` ✅ (scope, enfoque de tres PRs, dependencias, plan de rollback)
- `exploration.md` ✅ (baseline, preguntas abiertas de diseño)
- `design.md` ✅ (arquitectura de migración: repositories planas, helpers de paginación, guardas de dominio D-A/B/C/.../G)
- `specs/user-management-api/spec.md` ✅ (6 requirements + scenarios + out-of-scope)
- `specs/identity-data-layer/spec.md` ✅ (delta: 2 ADDED + 1 MODIFIED requirements)
- `specs/authorization-guards-api/spec.md` ✅ (delta: 2 MODIFIED requirements)
- `tasks.md` ✅ (39/39 tasks complete: Phase 1 PR1 base datos, Phase 2 PR2 mapper refactor, Phase 3 PR3 migración servicio, Phase 4 DoD + cierre Épico 19)
- `verify-report.md` ✅ (evidencia exhaustiva: curl real, HTTP vivo, 6 CA confirmados, 6 puntos de riesgo independientemente verificados, §10 hallazgos WARNING-1/2/3)
- `apply-progress.md` ✅ (work log de las 3 PRs, outputs reales de comandos, evidencia de cada fase)
- `state.yaml` ✅ (DAG state, timestamps, progression)
- `archive-report.md` ✅ (este archivo)

---

## Outstanding Items Carried Forward

Estos son reales, fuera del alcance de US-25, y deben ser rastreados por separado:

### 1. WARNING-1 — `just build` falla por datos de tiendas preexistentes

**Issue**: `just build` (full Next.js + API build) falla con código 1 al prerendizar `/shops/[slug]` para `launchidea`, `noaw`, `tetetetet`.

**Root Cause**: Las 3 tiendas tienen `settings: {}` vacío en Postgres (fila con objeto vacío, no NULL). Cuando shop.controller.ts intenta acceder `settings.socials`, obtiene `undefined`; luego `.length` throws `TypeError: Cannot read properties of undefined (reading 'length')`.

**Why Not This Change**: Los tres eslabones están fuera del diff:
- `apps/shop/` (no modificado)
- `shops.service.ts` (no modificado, no genera las filas vacías)
- `db/seed.sql` (no modificado, las 12 tiendas incluyen las 3 con settings vacío desde US-20)

**Impact**: `just build-api` está limpio (✅); solo `just build` falla. Es la primera vez en la historia SDD que `just build` se ejecuta en verify (los 9 cambios archivados lo declaran "no ejecutado").

**Recommendation (governance)**: 
- Abrir una US en el épico de tiendas/catálogo: "Tolerar `settings` vacío o NULL en el prerender de `/shops/[slug]`"
- Decidir si `rules.verify.build_command` debe seguir siendo `just build` cuando produce este estado tras 10 cambios sin pasar.

### 2. WARNING-2 — Última rama `super_admin` sin cobertura HTTP

**Issue**: La guarda "el único `super_admin` no puede ser bloqueado" (CA-4, scenario 2) tiene cobertura solo via unit test, no via HTTP.

**Why**: Con el seed actual, el único `super_admin` es `admin@demo.com`, el mismo usuario que autentifica la suite de curl. Auto-bloqueo y última-admin son observables como la misma condición HTTP → 409. El unit test (`users.service.spec.ts:317,340`) incluye contraejemplo con >1 admin, pero curl no lo prueba.

**Already Declared**: En `tasks.md` 4.5 y la DoD de US-25.

**Impact**: **Baja**. La lógica está correcta y testeable (está en el test), pero un futuro cambio de seed que agregue otro `super_admin` podría revelar un bug que HTTP no detectó.

**Recommendation**: Considerarlo KNOWN, no bloquea merge. Si US-26 agrega staff real o más admins al seed, re-verificar este scenario HTTP.

### 3. WARNING-3 (CORRECTED) — Spec sobreafirmó sobre `*_page_url`

**Issue Original**: `specs/user-management-api/spec.md:14-18` decía "las 4 `*_page_url` son strings, nunca `null`".

**Reality**: Con una sola página (seed de 3 usuarios), `next_page_url` y `prev_page_url` son `null`, exactamente como el mock y como D-B del design documenta.

**Action Taken**: Texto corregido en el delta antes de merge a main specs:
```
Cambio: "... son strings y nunca `null`" →
Nuevo:  "... son strings cuando existe página siguiente/anterior respectivamente, y `null` en caso contrario ..."
```

**Verification**: Corrección ya aplicada en `openspec/specs/user-management-api/spec.md` creado en esta sesión de archive.

---

## Cierre de Épico 19 — Autenticación y Autorización

**Épico 19 Status**: ✅ **Completado**

Cambios que cierran el épico:
Las seis, con la fecha real de su carpeta en `openspec/changes/archive/`:

- **US-20** (2026-09-02, `esquema-identidad-postgres`): esquema de identidad y seed de `users`/`profiles`/`permissions` — ✅ Archivada
- **US-21** (2026-09-02, `capa-datos-identidad`): `users.repository.ts` en `@safari/db`, la base sobre la que se apoya esta US — ✅ Archivada
- **US-22** (2026-09-02, `login-jwt-postgres`): login, registro y `/me` reales con JWT — ✅ Archivada
- **US-23** (2026-09-03, `guards-autorizacion-api`): guard global deny-by-default, 117 rutas con `@Permissions()` en su momento (hoy 120 tras esta US) — ✅ Archivada
- **US-24** (2026-09-03, `recuperacion-password-otp`): tokens de recuperación y códigos OTP persistidos — ✅ Archivada
- **US-25** (2026-09-08, `endpoints-usuarios-postgres`): endpoints de usuarios y staff desde Postgres, cierre del épico — ✅ **ESTA SESIÓN**

**Deliverables Totales del Épico**:
1. Modelo de identidad completo (usuarios, perfiles, permisos, reset tokens, OTP)
2. Autenticación JWT con payload de permisos
3. Guard global en 250 rutas (64 públicas, 63 autenticadas, 120 con permiso, 3 especiales)
4. 7 endpoints de gestión de usuarios desde Postgres con auto-bloqueo
5. 5 listas de administración filtradas por rol

**Documentación del Épico**: `docs/product/19-autenticacion-autorizacion/README.md` marca status `Completado`.

---

## Aceptadas y Documentadas Divergencias

Estas son comportamientos correctos, no defectos. Documentadas en specs para downstream (US-26+, frontends):

| # | Divergencia | Mock | Postgres | Status |
|---|---|---|---|---|
| V-1 | `created_at`/`updated_at` 3 vs. 6 decimales | 6 decimales | `now()`, última sesión, 3 decimales | ✅ Ratificada, aceptada |
| V-2 | Normalización a 15 claves en `/me` y users/:id | 15 claves | 15 claves (ID como number) | ✅ Ratificada, aceptada |
| V-3 | Usuario 1 con 12 tiendas (shops) | 9 en mock | 12 reales de seed | ✅ Ratificada (seed correcto), aceptada |
| V-4 | Orden de usuarios `[1,2,3]` | fuse ranking | `id ASC` | ✅ Ratificada, aceptada |
| V-5 | Búsqueda `contains` insensible a mayúsculas | fuse fuzzy | `lower(name) LIKE lower(text)` | ✅ Ratificada (mejor), aceptada |
| V-6 | `?page=abc` coerciona a `current_page:1` | paginate() calcula | `Math.ceil(undefined)` = `NaN` → clamp | ✅ Ratificada (borde), aceptada |
| V-7 | `my-staffs` ≡ `all-staffs` (alias sin scoping tienda) | schema no modela staff↔tienda | sin scoping | ✅ Ratificada (limitación de schema), aceptada |
| V-8 | `POST /users` ignora `permission`/`profile`/`address` | creado con `customer` fijo | DTO especificado así | ✅ Ratificada, aceptada |
| V-9 | `/api/users/abc` → 404 no 500 (id no numérico) | guardias en controller | guarda `Number.isInteger` | ✅ Ratificada (mejora), aceptada |
| V-10 | Bordes de `limit`/`page` negativos devuelven 200, no 5xx | edge case permitido | pagination.ts clamps | ✅ Ratificada (no crash), aceptada |

**Impact Summary**: Ninguna divergencia bloquea observaciones del usuario final. Todas están declaradas en specs y ratificadas en la prueba real.

---

## Presupuesto de Revisión — Análisis Final

| Slice | `git diff --shortstat` | Evaluación |
|---|---|---|
| PR1 `71ea86f` (packages/db) | 11 files, +1843 / −11 | ~199 líneas código (+test). ✅ LOW risk, gate limpio |
| PR2 `b46aff5` (mapper refactor) | 5 files, +333 / −85 | ~285 líneas. ✅ LOW risk, refactor puro |
| PR3 `9b71021` (migration) | 5 files, +954 / −208 | **~965 líneas total**, 281(+)/191(−) producción + 493 test nuevo. ⚠️ HIGH risk, supera 400 presupuesto |
| Fase 4 `5af928c` (closure) | 5 files, +251 / −26 | 0 código (docs + artefactos SDD) |

**PR3 Analysis (Governance Call)**:

- **Es defendible embarcado así.** De ~965 líneas, 493 son spec de test nuevo (cobertura que faltaba desde US-20), 191 son mock borradas. El código de producción neto es ~281 líneas en `users.service.ts`, una estructura muy repetitiva (5 wrappers de 3 líneas, 5 guardias idénticas, `withPrismaErrorTranslation` calcado de precedentes). No es 965 líneas de novedad conceptual.

- **El split 3a/3b (reads/writes) habría sido peor.** `_listByPermission` y las guardias comparten el mismo archivo, mismo `withPrismaErrorTranslation`, mismo spec. Partirlo dejaría 3a con file a medio migrar y spec que no puede pasar solito. Viola "cada slice con inicio claro, fin claro y verificación autónoma".

- **Incumplimiento de proceso registrado.** Task 3.17 se marcó `[x]` con justificación "el orquestador resolvió PR3 ONLY", lo que **explica** pero no **autoriza** la excepción de 400 líneas. Lo correcto era pedir `size:exception` explícito. Hoy (sesión de archive) no se puede retroactivamente reabrir y partir.

- **Recomendación (tuya de gobernanza)**: Aceptar PR3 como `size:exception` documentado — reabrirlo para partirlo ahora costaría rebase de cadena y produciría 2 PRs peores. **Cierre del hueco de proceso**: que `sdd-apply` no pueda marcar task 3.17 sin `size:exception` registrado explícitamente (hoy solo vive en texto de task, no en metadato).

---

## Source of Truth Updated

Las cuatro specs ahora son el contrato autorizado para:

| Spec | Contenido | Uso Downstream |
|---|---|---|
| `openspec/specs/user-management-api/spec.md` | 6 requirements, 7 scenarios, 6 claves de CA | Implementación + testing de `/api/users/*`, `profiles` |
| `openspec/specs/identity-data-layer/spec.md` | 4 requirements (lectura + 2 nuevas reads + 4 writes), 13 scenarios | `@safari/db` API contract para aplicaciones backend (US-26+) |
| `openspec/specs/authorization-guards-api/spec.md` | 5 requirements, 120 rutas con permiso, 4 buckets | Guard global en apps/api/rest; reuso en US-26+ |
| `openspec/specs/auth-jwt-api/spec.md` | 3 requirements (token gen, payload, expiry) | JWT generation sin cambios (US-22 live) |

---

## SDD Cycle Complete

✅ **Proposed** → ✅ **Explored** → ✅ **Designed** → ✅ **Specified** → ✅ **Tasked** → ✅ **Applied** (3 PRs) → ✅ **Verified** (PASS WITH WARNINGS) → ✅ **Archived**

El change está completamente planeado, implementado, verificado y ahora read-only en el audit trail. Listo para el siguiente cambio o para que se resuelva la deuda abierta WARNING-1 (tiendas con settings vacío).

---

## Risks Carrying Forward

1. **`just build` fails repo-level (WARNING-1)**: La precompilación de Next.js espera `settings.socials` presente en todas las tiendas. Decir al equipo: antes de cualquier PR que toque tiendas o el seed, verificar que `just build` pase. O abrir US de tiendas para tolerar `settings` vacío.

2. **Última `super_admin` sin HTTP coverage (WARNING-2)**: Unidad testeable pero HTTP no lo ejercita con el seed actual. Si US-26 expande staff real o agrega admin al seed, re-verificar que la guarda siga funcionando.

3. **Presupuesto de revisión excedido sin explícito `size:exception` (process gap)**: Cerrar el hueco permitiendo que 3.17 solo se marque `[x]` si hay `size:exception` registrado.

4. **Obsolete configuration**: `CLAUDE.md:58-59` y `openspec/config.yaml:28,33` declaran que `apps/api/rest` tiene cero `*.spec.ts`. Ahora tiene 4 suites / 65 tests. No crítico, pero stale.

---

**Archived by**: sdd-archive (executor)  
**Date**: 2026-09-08  
**Skill Resolution**: paths-injected (SKILL.md paths received from orchestrator)
