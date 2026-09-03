# US-24 — Recuperación de contraseña y OTP contra la base

> Los cuatro stubs que hoy devuelven `success: true` pase lo que pase
> —olvidé mi contraseña, verificar token, restablecer, y el flujo OTP— pasan a
> persistir tokens y códigos reales con expiración y un solo uso.

**Épico:** [Épico 19](./README.md)
**Fecha:** 2026-08-31
**Status:** ✅ Implementada
**Depende de:** US-22
**LOC est.:** ~300

## Historia
**Como** usuario que olvidó su contraseña, **quiero** un flujo de recuperación
que verifique de verdad un token con vencimiento, **para** que restablecer la
clave sea un mecanismo y no una animación que siempre dice que sí.

## Contexto

- Cuatro métodos de `auth.service.ts` son stubs idénticos: `forgetPassword`,
  `verifyForgetPasswordToken`, `resetPassword`
  (`apps/api/rest/src/auth/auth.service.ts:73-102`)
  hacen `console.log` y devuelven `{success: true, message: 'Password change
  successful'}`. Los de OTP (`sendOtpCode`, `verifyOtpCode`, `otpLogin`)
  devuelven datos inventados, incluido un `phone_number: '+919494949494'`
  hardcodeado.
- **Las tablas ya existen**: US-20 creó `password_reset_tokens` y `otp_codes`
  precisamente para no pagar un segundo `db-reset` (decisión 2 del épico).
- Los DTOs fijan el contrato: `ForgetPasswordDto {email}`,
  `VerifyForgetPasswordDto {email, token}`, `ResetPasswordDto {email, token,
  password}`, `OtpDto {phone_number}`, `VerifyOtpDto {otp_id, code,
  phone_number}`, `OtpLoginDto {otp_id, code, phone_number, name?, email?}`.
  Las respuestas son `CoreResponse {success, message}` y `OtpResponse {id,
  message, success, phone_number, provider, is_contact_exist}`.
- **No hay proveedor de correo ni de SMS, y este épico no lo integra**
  (decisión 12): el token y el código se emiten al log del servidor. Es
  suficiente para un repo didáctico y deja la integración como un cambio
  aislado.
- US-22 dejó `bcryptjs` disponible y el patrón de escritura de contraseñas.

## Scope

**Incluye:** la generación, persistencia, verificación, expiración y consumo
de tokens de recuperación y de códigos OTP; los repositorios correspondientes
en `packages/db`; los seis métodos de `auth.service.ts`; y la emisión al log
con una advertencia clara de que no hay envío real.

**NO incluye:** proveedor de correo o SMS, plantillas de mensaje, rate
limiting, social login (decisión 11), ni cambios en shop o admin.

## Criterios de aceptación

### CA-1 — Token de recuperación persistido
`POST /api/forget-password` con un email existente genera un token, lo
persiste con vencimiento y lo emite al log. La respuesta mantiene el shape
`CoreResponse` de hoy.

### CA-2 — Respuesta indistinguible para email inexistente
Con un email que no existe, la respuesta es **la misma** que con uno que sí
(D-4 del épico: sin enumeración de cuentas). No se persiste nada.

### CA-3 — Verificación real del token
`POST /api/verify-forget-password-token` devuelve `success: true` solo si el
token existe, corresponde a ese email, no ha vencido y no fue consumido. En
cualquier otro caso, `success: false`.

### CA-4 — Restablecer consume el token
`POST /api/reset-password` cambia el hash solo con un token válido, y lo marca
como consumido: reutilizarlo falla. Tras el cambio, la contraseña vieja no
sirve y la nueva permite iniciar sesión.

### CA-5 — OTP persistido y verificable
`POST /api/send-otp-code` genera un código con vencimiento asociado al
teléfono y devuelve el `OtpResponse` con su `id` real.
`POST /api/verify-otp-code` lo valida contra la base; un código equivocado o
vencido devuelve `success: false`. `POST /api/otp-login` emite un JWT real
solo si el código verifica.

### CA-6 — Contrato preservado
Las claves, el casing y los tipos de las seis respuestas no cambian respecto
al mock.

## Escenarios Gherkin

```gherkin
Feature: Recuperacion de contrasena y OTP
  Scenario: CA-2 — email inexistente no se distingue
    When se pide recuperar la contrasena de un email que no existe
    And se pide recuperar la contrasena de admin@demo.com
    Then ambas respuestas son identicas
    And solo se persiste un token para la segunda

  Scenario: CA-3 — token vencido
    Given un token de recuperacion cuyo vencimiento ya paso
    When se verifica ese token
    Then la respuesta trae success false

  Scenario: CA-4 — token de un solo uso
    Given un token de recuperacion valido
    When se restablece la contrasena con ese token
    And se intenta restablecerla otra vez con el mismo token
    Then el segundo intento falla

  Scenario: CA-5 — codigo OTP incorrecto
    Given un codigo OTP emitido para un telefono
    When se verifica con un codigo distinto
    Then la respuesta trae success false
    And no se emite ningun token
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `packages/db/src/repositories/auth-tokens.repository.ts` | nuevo: crear, buscar, consumir y purgar tokens y códigos |
| `packages/db/src/repositories/auth-tokens.integration.test.ts` | nuevo: vencimiento, consumo y un solo uso |
| `packages/db/index.ts` | exports nuevos |
| `apps/api/rest/src/auth/auth.service.ts` | los 6 métodos contra la base |

## Definición de Done

- [x] `curl` pegado del flujo completo: forget → (token leído del log) →
      verify → reset → login con la nueva contraseña. Ver evidencia en
      `openspec/changes/2026-09-03-recuperacion-password-otp/apply-progress.md`.
- [x] `curl` pegado del reintento con el token ya consumido (falla) y con un
      token vencido (falla).
- [x] `curl` pegado de las dos respuestas de CA-2, mostrando que son idénticas.
- [x] `curl` pegado del flujo OTP: send → verify con código correcto y con uno
      incorrecto → `otp-login` devolviendo un JWT verificable.
- [x] `just db-check` verde con los tests nuevos, recuento pegado (84/84,
      8 archivos).
- [x] `just build-api` limpio.
- [x] Status de esta US actualizado y fila del épico marcada.

## Notas para el agente ejecutor

- **El token se guarda hasheado, no en claro.** Una tabla de tokens de
  recuperación legibles es una llave maestra para quien lea la base. El mismo
  `bcryptjs` de US-22 sirve; el token en claro solo existe en el log.
- Para probar el vencimiento sin esperar, `packages/db` ya tiene
  `_setNowProvider`/`now` en `src/clock.ts`. Usarlo en los tests en vez de
  inventar un mock de tiempo propio.
- El log debe decir con todas las letras que **no hay envío real** y que esto
  es una implementación de desarrollo. Un token impreso en consola sin
  advertencia es una trampa para el que despliegue esto algún día.
- `otp-login` puede recibir `name` y `email` opcionales: el mock los ignora.
  Decidir explícitamente si crea usuario cuando el teléfono no existe, y
  declararlo. Si la respuesta es "no", devolver un error de negocio, no un
  usuario fantasma.
- No añadir rate limiting aunque el hueco sea evidente. Se menciona en el
  reporte final; no se acciona.
- Estos endpoints son **públicos** por naturaleza: coordinar con el `@Public()`
  de US-23 si esa US ya está aplicada. Si no lo está, dejar constancia en el
  reporte para que US-23 los incluya en su inventario.
