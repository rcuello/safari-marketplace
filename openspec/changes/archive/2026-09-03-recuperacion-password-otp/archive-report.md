# Archive Report: Recuperación de contraseña y OTP contra la base (US-24)

**Change**: `2026-09-03-recuperacion-password-otp`
**Status**: Complete and verified
**Archived to**: `openspec/changes/archive/2026-09-03-recuperacion-password-otp/`
**Date**: 2026-09-03

## Summary

SDD cycle complete for US-24. All 44 implementation tasks verified. Two specs promoted:
- `password-recovery-otp`: New capability (complete spec created)
- `auth-jwt-api`: Modified requirement (narrowing delta applied; 6 of 7 stubs converted to real behavior)

## Specs Promoted

### 1. password-recovery-otp (NEW)

**Location**: `openspec/specs/password-recovery-otp/spec.md`

**Status**: Created as new main spec

**Content**: Complete specification for six real recovery/OTP methods:
- `forgetPassword`: Generate, hash, and persist password reset tokens
- `verifyForgetPasswordToken`: Verify token without consuming
- `resetPassword`: Consume token and update password hash
- `sendOtpCode`: Generate and persist OTP code
- `verifyOtpCode`: Verify OTP without consuming
- `otpLogin`: Resolve identity by phone, consume code, emit JWT

**Key traits preserved**:
- HTTP status: `201 Created` for POST endpoints (confirmed in promoted spec, lines 84, 162, 181)
- Core domain behavior: Domain failures return `{success:false}` body, never raise exceptions
- Out of scope: Real email/SMS delivery, rate limiting, social login
- Verification note: Spec was corrected during `sdd-verify` to replace erroneous "HTTP 200" claims with factual `201 Created` (the Nest `@Post` default). This correction is embedded in the promoted spec.

### 2. auth-jwt-api (MODIFIED)

**Location**: `openspec/specs/auth-jwt-api/spec.md`

**Status**: Narrowing delta applied (destructive change — see caveat below)

**Requirement Modified**: "Los stubs declarados no cambian su comportamiento observable"

#### Text Removed (Old Requirement)

```
`forgetPassword`, `resetPassword`, `verifyForgetPasswordToken`,
`verifyOtpCode`, `sendOtpCode`, `socialLogin` y `otpLogin` MUST seguir
devolviendo exactamente la misma respuesta fija que devuelven hoy, byte a
byte. `POST /api/logout` MUST seguir devolviendo `true` sin invalidar ni
revocar ningún token (D-9: sin refresh tokens ni denylist).

#### Scenario: Un stub declarado no cambia su respuesta

- GIVEN cualquiera de los 7 stubs declarados
- WHEN se invoca su endpoint con cualquier body
- THEN la respuesta es byte-idéntica a la que devuelve el mock de hoy
```

**Reason for Removal**: Six of the seven stubs named (forgetPassword, resetPassword, verifyForgetPasswordToken, verifyOtpCode, sendOtpCode, otpLogin) are no longer stubs after US-24 — they are real implementations. Only `socialLogin` remains a stub (D-11: social login real is out of scope for the current cycle).

#### Text Added (New Requirement)

```
De los 7 stubs originales, esta US-24 convierte 6 en mecanismo real
(`forgetPassword`, `resetPassword`, `verifyForgetPasswordToken`,
`verifyOtpCode`, `sendOtpCode`, `otpLogin` — capability
`password-recovery-otp`). Solo `socialLogin` MUST seguir devolviendo
exactamente la misma respuesta fija que devuelve hoy, byte a byte (D-11 del
épico: social login real queda fuera de alcance). `POST /api/logout` MUST
seguir devolviendo `true` sin invalidar ni revocar ningún token (D-9: sin
refresh tokens ni denylist).

(Previously: los 7 stubs — incluyendo los 6 de recuperación/OTP — debían
devolver la misma respuesta fija byte a byte; US-24 los reemplaza por
comportamiento real y estrecha este requirement a `socialLogin` únicamente.)

#### Scenario: socialLogin sigue siendo un stub declarado

- GIVEN el único stub restante, `socialLogin`
- WHEN se invoca su endpoint con cualquier body
- THEN la respuesta es byte-idéntica a la que devuelve el mock de hoy
```

**Preserved Scenarios**: The `Logout no revoca nada` scenario is preserved verbatim. This scenario documents that `/api/logout` behavior is unchanged across all USs (no revocation, no denylist).

**Impact**: Requirements for the 6 converted stubs are now satisfied by the `password-recovery-otp` capability. The narrowing is semantic and factually accurate: what was "must remain a stub" is now "no longer a stub by design."

### 3. identity-data-layer (UNCHANGED)

**Location**: `openspec/specs/identity-data-layer/spec.md`

**Status**: No modification

**Rationale**: The requirement "Sin dependencia nueva de hashing" (`spec.md:208-218`) is still satisfied. The delta spec delta notes confirm:
- `bcrypt.compare` for token verification lives in the Nest service layer (`apps/api/rest`), not in `packages/db`
- No new dependency on `bcryptjs` in `packages/db/package.json` was introduced
- All 7 public functions of `users.repository.ts` maintain their original signatures and return types

## Verification Evidence (from sdd-verify PASS)

| Checkpoint | Result |
|---|---|
| `just db-check` | 84 tests / 8 files ✅ |
| `just build-api` | Clean compile ✅ |
| Port 9001 released after API shutdown | Confirmed ✅ |
| Seed counts (users/profiles/products/orders) | 3/12/1200/198 unchanged ✅ |
| `@ts-ignore` / `as any` in diff | Zero instances ✅ |
| All 44 tasks marked `[x]` | Confirmed ✅ |

## Archival Checklist

- [x] Main specs updated correctly (password-recovery-otp created, auth-jwt-api narrowed)
- [x] Change folder moved to archive with ISO date prefix (2026-09-03)
- [x] Archive contains all artifacts (proposal, specs, design, tasks, verify-report)
- [x] Archived tasks.md has no unchecked implementation tasks
- [x] Active changes directory no longer contains this change
- [x] No changes to implementation code, db/schema.sql, or docs/ (those were updated during apply phase)

## Destructive Delta Caveat (Per rules.archive)

Per `openspec/config.yaml:rules.archive`: "Warn before merging destructive deltas"

The delta to `auth-jwt-api` removes the original text naming 7 stubs and replaces it with text naming 6 specific implementations + 1 stub. This is **intentionally destructive**: the specification is narrowed to reflect that six methods are no longer stubs. The removed text is:

1. **Direct name removal**: "forgetPassword, resetPassword, verifyForgetPasswordToken, verifyOtpCode, sendOtpCode, socialLogin y otpLogin MUST seguir devolviendo exactamente la misma respuesta fija" → "Solo `socialLogin` MUST seguir devolviendo exactamente la misma respuesta fija"

2. **Scenario reframing**: The "Un stub declarado no cambia su respuesta" scenario, which tested all 7 stubs, is replaced by "socialLogin sigue siendo un stub declarado" to reflect the new reality.

The logout scenario is preserved exactly as it was, ensuring no requirement loss in the narrowed spec.

**Justification**: This narrowing is not a removal of enforced behavior — it is a reclassification. The six methods are now specified in detail in `password-recovery-otp`, and the assertion that "socialLogin remains unchanged" is still verifiable. The old text was inaccurate after US-24 implementation; the new text reflects the real state of the system.

## SDD Cycle Status

All phases complete:
- ✅ sdd-explore: Recorded context and ambiguities
- ✅ sdd-propose: Scope, design strategy, rollback plan
- ✅ sdd-spec: Two delta specs (password-recovery-otp, auth-jwt-api narrowing)
- ✅ sdd-design: Sequence diagrams, architecture decisions, risk mitigation
- ✅ sdd-tasks: 44 implementation tasks (Phases 1-9)
- ✅ sdd-apply: Two chained PRs applied, merged, verified
- ✅ sdd-verify: Independent verification of all DoD scenarios with real evidence
- ✅ sdd-archive: Specs promoted, change folder moved to immutable audit trail

Ready for the next US in the authentication/authorization epic.
