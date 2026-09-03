# Delta for Auth Jwt Api

> Texto actual en `openspec/specs/auth-jwt-api/spec.md:159-171`, citado antes
> de editar:
>
> ```
> ### Requirement: Los stubs declarados no cambian su comportamiento observable
>
> `forgetPassword`, `resetPassword`, `verifyForgetPasswordToken`,
> `verifyOtpCode`, `sendOtpCode`, `socialLogin` y `otpLogin` MUST seguir
> devolviendo exactamente la misma respuesta fija que devuelven hoy, byte a
> byte. `POST /api/logout` MUST seguir devolviendo `true` sin invalidar ni
> revocar ningún token (D-9: sin refresh tokens ni denylist).
>
> #### Scenario: Un stub declarado no cambia su respuesta
>
> - GIVEN cualquiera de los 7 stubs declarados
> - WHEN se invoca su endpoint con cualquier body
> - THEN la respuesta es byte-idéntica a la que devuelve el mock de hoy
>
> #### Scenario: Logout no revoca nada
>
> - GIVEN un token válido recién emitido
> - WHEN se hace `POST /api/logout` y luego se reintenta ese mismo token en `GET /api/me`
> - THEN `logout` devuelve `true` y el token sigue siendo válido en `/me`
> ```

## MODIFIED Requirements

### Requirement: Los stubs declarados no cambian su comportamiento observable

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

#### Scenario: Logout no revoca nada

- GIVEN un token válido recién emitido
- WHEN se hace `POST /api/logout` y luego se reintenta ese mismo token en `GET /api/me`
- THEN `logout` devuelve `true` y el token sigue siendo válido en `/me`

## Notas de alcance (no estándar, informativas)

`identity-data-layer` (`openspec/specs/identity-data-layer/spec.md`) NO se
modifica por este change: ninguna de sus 7 funciones públicas cambia de
firma, y su requirement "Sin dependencia nueva de hashing"
(`spec.md:208-218`) se respeta — `bcrypt.compare` para verificar el token de
recuperación vive en el servicio de Nest (`password-recovery-otp`), no en
`packages/db`.
