# Proposal: Recuperación de contraseña y OTP contra la base

> **US-24**, Épico 19. Insumo: `explore.md` (esta carpeta), cuyos hallazgos se toman como
> verificados. Precedente de estilo: `archive/2026-09-03-guards-autorizacion-api/` y
> `archive/2026-09-02-login-jwt-postgres/`. Las **5 decisiones abiertas** que dejó la exploración
> quedan **cerradas aquí** (D1–D5): `sdd-design` no las reabre.

## Intent

Seis métodos de `auth.service.ts` (`:241-327`) son stubs: los de recuperación hacen `console.log`
y devuelven `{success:true, message:'Password change successful'}` **pase lo que pase**;
`sendOtpCode` devuelve un `phone_number: '+919494949494'` hardcodeado que ignora el input;
`otpLogin` devuelve el literal `'jwt token'` con `permissions: ['super_admin','customer']`
inventados — **hoy cualquiera obtiene un "token" de super admin por OTP**. Las tablas y sus
modelos Prisma ya existen (US-20/21) y las seis rutas ya son `@Public()` (US-23): **no hay bloqueo
de esquema ni de guard**. Esta US convierte los seis stubs en mecanismo real.

## Scope

### In Scope

| Archivo | Cambio |
|---|---|
| `packages/db/src/repositories/auth-tokens.repository.ts` | **nuevo**: crear / buscar / consumir / purgar tokens y códigos + `findUserIdByProfileContact` |
| `packages/db/src/repositories/auth-tokens.integration.test.ts` | **nuevo**: vencimiento (`_setNowProvider`), consumo, un solo uso, purga |
| `packages/db/index.ts` | exports nuevos (bloque alfabético, como `users.repository`) |
| `apps/api/rest/src/auth/recovery-options.ts` | **nuevo**: único lector de los dos TTL (calca `jwt-options.ts`) |
| `apps/api/rest/src/auth/auth.service.ts` | los 6 métodos contra la base; generación, hash y log del secreto |
| `apps/api/rest/.env.example` | `PASSWORD_RESET_TTL_MINUTES=60`, `OTP_CODE_TTL_MINUTES=10` |
| `apps/README.md` | cómo leer el token/código del log y qué significan las dos variables |

### Out of Scope (vinculante — "NO incluye" de la US)

Proveedor de correo o SMS · plantillas de mensaje · **rate limiting** · social login (D-11) ·
**cualquier** cambio en `apps/shop` o `apps/admin` · `db/schema.sql`, `db/seed.sql`,
`schema.prisma` (ya modelan todo) · `auth.controller.ts` y `create-auth.dto.ts` (CA-6 exige
preservarlos) · tests jest en `apps/api/rest`.

**Adyacentes detectadas y NO accionadas**: `class-validator` en los DTO de este módulo ·
`RegisterDto`/`Permission` (deuda declarada de US-25) · normalizar `console.log` a un logger en
toda la app (D5 lo limita a los seis métodos) · **rate limiting**: `forget-password` y
`send-otp-code` quedan sin límite de intentos — vector de enumeración/DoS barato, **conocido,
declarado y deliberadamente no atendido**; se menciona en el reporte, no se acciona.

## Capabilities

### New Capabilities

- `password-recovery-otp`: generación, persistencia hasheada, verificación, expiración, consumo
  de un solo uso y purga de tokens de recuperación y códigos OTP — repositorio en `packages/db`
  y los seis endpoints públicos, preservando el contrato HTTP del mock.

### Modified Capabilities

- `auth-jwt-api`: el requirement *"Los stubs declarados no cambian su comportamiento observable"*
  se **estrecha**: de sus 7 stubs, 6 dejan de serlo aquí; solo `socialLogin` (D-11) sigue siendo
  stub. El escenario de `logout` se conserva íntegro.
- `identity-data-layer`: **no cambia**. Ninguna de sus 7 funciones cambia de firma y su
  requirement *"Sin dependencia nueva de hashing"* se respeta (ver D1).

## Approach — decisiones cerradas

**D1 — Lookup por `user_id` + `bcrypt.compare`, con invalidación del token previo (opción (c)).**
`token` es una sola columna `text UNIQUE` y bcrypt es salado: `WHERE token = $1` nunca encuentra
la fila rehasheando. Como `VerifyForgetPasswordDto` y `ResetPasswordDto` **traen `email`**, se
resuelve `user_id` con `findUserCredentialsByEmail` (único lector de email insensible a mayúsculas
que ya existe; además devuelve el `isActive` que hace falta) y se compara contra las filas vivas
de ese usuario por el índice `password_reset_tokens_user_idx`. **Cada `forget-password` invalida
(`consumed_at = now()`) los tokens vivos previos de ese usuario en la misma transacción** ⇒ la
comparación es siempre contra **una fila como máximo**. Rechazadas: **(b) sha256** — la nota del
agente ejecutor pide "el mismo `bcryptjs` de US-22", y un segundo primitivo de hash para una sola
columna no compra nada teniendo el `email` siempre disponible; **(a) sin invalidación** — N filas
vivas ⇒ N `bcrypt.compare` de coste 10 por request en un endpoint que a propósito no tiene rate
limiting: un DoS autoinfligido.
El `bcrypt.compare` vive en **el servicio de Nest, no en `packages/db`**: el spec vigente de
`identity-data-layer` prohíbe que el paquete declare `bcryptjs`. El repositorio devuelve el hash
en un tipo dedicado (`PasswordResetTokenSecret`, `OtpCodeSecret`) declarado en
`auth-tokens.repository.ts` y **NO en `records.ts`** — mismo criterio que `UserCredentials`. **El
valor en claro se genera en el servicio (`crypto.randomBytes(32).toString('hex')`; OTP de 6
dígitos con `crypto.randomInt`), nunca entra a `packages/db` y solo existe en el log.** El
`UNIQUE` no se toca: dos hashes bcrypt no colisionan y un P2002 sería anomalía real → 500 vía
`withPrismaErrorTranslation`. `consume*` es un UPDATE condicional
(`WHERE id = ? AND consumed_at IS NULL`) que devuelve filas afectadas: sin eso, dos
`reset-password` simultáneos con el mismo token pasan los dos (CA-4).

**D2 — `otp-login` NO crea usuarios y NO confía en el `email` del body.** Resuelve el usuario por
el teléfono, que es lo único que el OTP demuestra: `findUserIdByProfileContact(phone)` devuelve el
`user_id` **solo si exactamente un `profiles.contact` coincide**; con 0 o >1 coincidencias →
error de negocio. `name`/`email` del `OtpLoginDto` **se siguen ignorando**, ahora por decisión
declarada en comentario: aceptar el `email` como identidad permitiría a cualquiera con un teléfono
propio autenticarse como el dueño de cualquier correo — escalada de privilegios, no una comodidad.
Crear cuenta queda descartado: exigiría inventar un hash de contraseña para una cuenta en la que
nadie puede entrar por contraseña, conceder `customer` (D-6) a un teléfono sin verificar nada más,
y contradice el `otp_codes` **sin FK a `users`** que el DDL declara a propósito. Consecuencia
verificada y aceptada: el seed da `contact = '19365141641631'` a **dos** usuarios (2 y 3) → ese
teléfono es ambiguo → 401; el camino demostrable es `'12365141641631'` → `store_owner@demo.com`.

**D3 — `OtpResponse` honesto, mismas claves/casing/tipos (CA-6).** `id`: el `otp_codes.id` real
emitido como `string` (`String(id)`), igual que el `'1'` del mock. `phone_number`: **eco literal
del input**, nunca el `'+919494949494'` fijo. `provider`: constante **`'log'`** — no hay tabla ni
columna de proveedor ni SMS real (D-12); `'google'` era una mentira que además sugiere un OAuth
inexistente. `is_contact_exist`: **se computa** = `findUserIdByProfileContact(phone) !== null`, o
sea *"existe exactamente un perfil con ese teléfono, luego `otp-login` puede llegar a emitir
token"*. Se computa en vez de constantizarse porque `apps/shop/src/framework/rest/user.ts:240`
**ramifica la UI con ese campo** (`is_contact_exist ? 'OtpForm' : 'RegisterForm'`): informar al
cliente es su única razón de existir. Coste: un scan de `profiles` (3 filas hoy, sin índice). Se
declara que es una superficie de enumeración **por diseño del contrato heredado**, no un descuido
de D-4: quitarla rompería el shop y CA-6.

**D4 — TTL en `.env` con default embebido, un único lector.**
`apps/api/rest/src/auth/recovery-options.ts` calca `resolveJwtOptions()`: lectura **diferida** y
memoizada (`ConfigModule` puebla `process.env` después de evaluar los `require` de los módulos
hijos). `PASSWORD_RESET_TTL_MINUTES` **default 60** (el estándar del "link del correo", con margen
para un flujo manual de `curl`); `OTP_CODE_TTL_MINUTES` **default 10** (los códigos SMS son de
vida corta; 10 tolera copiarlo del log sin volverlo perenne). A diferencia de `JWT_SECRET`, un TTL
ausente **no** hace fallar el arranque: es una preferencia, no un fallo de seguridad.
`.env.example` se actualiza (precedente US-22) y `apps/README.md` las documenta.

**D5 — `Logger` de Nest, `warn`, advertencia pegada al secreto.** Se usa
`new Logger(AuthService.name)` de `@nestjs/common` (**cero dependencias nuevas**) en vez de
`console.log`: el mensaje es una *advertencia* y `console.log` no puede expresar severidad. Es el
paso mínimo; **no se normaliza ningún otro `console.log` de la app**. Formato exacto, una llamada
`logger.warn` por emisión, con la advertencia **en cada emisión** (no una vez al arrancar: quien
encuentre el secreto en el log tiene que ver el aviso al lado):

```
SIN ENVIO REAL — IMPLEMENTACION DE DESARROLLO. No hay proveedor de correo ni SMS
(D-12 del Epico 19). Este secreto viaja SOLO por este log; no despliegues esto.
  flujo=forget-password email=<email> token=<token-en-claro> expira=<ISO-8601>
  flujo=send-otp-code   phone=<phone> code=<codigo>          expira=<ISO-8601> otp_id=<id>
```

**D6 — Postura de errores: los fallos de dominio nunca lanzan, salvo donde el shape lo impide.**
Precedente `changePassword` (`:217-225`) + D-4 del épico. Los cinco métodos que devuelven
`CoreResponse`/`OtpResponse` responden **HTTP 200 con `success:false`**, con claves
`PICKBAZAR_MESSAGE.*` que los frontends ya traducen (`sdd-design` elige las exactas). `otpLogin`
devuelve `AuthResponse`, que **no tiene campo `success`** y no puede señalar el fallo en el body:
**lanza `UnauthorizedException` con el mismo `INVALID_CREDENTIALS_MESSAGE` genérico de `login()`**
(401, D-4) para *todas* las causas — código inválido, vencido, consumido, teléfono ambiguo o sin
perfil, usuario inactivo. `withPrismaErrorTranslation` sigue envolviendo **cada** llamada a
`@safari/db`: la infraestructura (base caída → 503, resto de Prisma → 500) sigue saliendo como
excepción. Un usuario inactivo en `reset-password` recibe el mismo `{success:false}` que un token
inválido.

## Contrato: método por método (CA-6)

| Método | Hoy (baseline literal) | Después (mismas claves, casing y tipos) |
|---|---|---|
| `forgetPassword` | `{success:true, message:'Password change successful'}` | **idéntico siempre** (CA-2: email inexistente ⇒ misma respuesta, nada persistido, nada logueado) |
| `verifyForgetPasswordToken` | `{success:true, message:'Password change successful'}` | `success:true` solo si el token existe para ese email, no venció y no fue consumido; **no consume** |
| `resetPassword` | `{success:true, message:'Password change successful'}` | `updateUserPasswordHash` (bcrypt coste 10) + consume el token; reintento ⇒ `success:false` |
| `verifyOtpCode` | `{message:'success', success:true}` | valida `otp_id` **y** que `phone` coincida; **no consume** (es una comprobación, puede repetirse dentro del TTL) |
| `sendOtpCode` | `{message,success,id:'1',provider:'google',phone_number:'+91…',is_contact_exist:true}` | mismas 6 claves; `id` real, `provider:'log'`, `phone_number` eco, `is_contact_exist` computado (D3) |
| `otpLogin` | `{token:'jwt token', permissions:['super_admin','customer'], role:'customer'}` | **mismo shape**; `token` firmado con `jwtService.signAsync({sub,email,permissions})` igual que `login()`, `permissions` reales del usuario, `role` por `deriveRole()`. **Consume el código.** |

`otpLogin` cambia el **valor**, no la **forma**: es exactamente lo que CA-5 pide ("emite un JWT
real"), no una ruptura de contrato. Divergencias declaradas: (1) `permissions`/`role` dejan de ser
`['super_admin','customer']`/`customer` fijos y pasan a ser los del usuario resuelto —el mock
regalaba super admin a cualquiera—; (2) un teléfono sin perfil único hace que el shop enrute a
`RegisterForm`, cuyo submit termina en 401 porque OTP no crea cuentas (D2).

## Risks

| Riesgo | Sev. | Mitigación |
|---|---|---|
| **R-1**: `otp-login` deja de emitir token para todo teléfono, rompiendo un flujo hoy "funcional" (era falso: emitía super admin a cualquiera) | Media | D2/D3 declarados; DoD exige el `curl` demostrable con `12365141641631` |
| **R-2**: sin rate limiting, `forget-password` y `send-otp-code` son enumeración/DoS barata, y `is_contact_exist` la facilita | Media | **Aceptado y declarado**: el "NO incluye" lo excluye. Se documenta en `apps/README.md` como requisito heredado para el épico que traiga rate limiting |
| **R-3**: un OTP de 6 dígitos hasheado con bcrypt es débil ante fuerza bruta offline | Baja | TTL 10 min + un solo uso; el hash evita que la base sea un volcado de códigos en claro |
| **R-4**: `_setNowProvider` no tiene ningún consumidor de test hoy; mal restaurado contamina la suite | Baja | Restauración obligatoria en `afterEach`/`afterAll`; `just db-check` completo debe seguir verde |
| **R-5**: los tests de escritura tocan `password_reset_tokens`/`otp_codes` de usuarios sembrados | Baja | Regla vigente de `identity-data-layer`: los conteos 3/12/1200/198 no cambian; limpieza explícita en `beforeAll`+`afterAll` |
| **R-6**: el diff supera el presupuesto de 400 líneas | Media | Corte en 2 PRs encadenados (abajo); `sdd-tasks` emite el forecast autoritativo |

## Rollback Plan

1. **Código**: `git checkout packages/db apps/api/rest apps/README.md` + `just db-build` +
   `just build-api`. **No hay cambio de esquema**: ni `db/schema.sql` ni `schema.prisma` se tocan,
   así que no hay migración que deshacer ni `db-reset` obligatorio. Los seis stubs vuelven.
2. **Datos que `git` no deshace** (único caveat real):
   - Las filas escritas en `password_reset_tokens` y `otp_codes` **sobreviven** al revert. Quedan
     **inertes** (sin lector) y contienen hashes bcrypt, no secretos en claro.
     Limpieza: `DELETE FROM password_reset_tokens; DELETE FROM otp_codes;` o `just db-reset`.
   - Un `reset-password` exitoso **ya cambió el hash del usuario**: revertir el código no
     restaura la contraseña anterior. `just db-reset` devuelve los 3 usuarios a `demodemo`.
3. **`.env`**: las dos variables de TTL quedan huérfanas e inertes; borrarlas es cosmético.

## Estimación y entrega

| Área | Líneas aprox. |
|---|---|
| `auth-tokens.repository.ts` (7 funciones + tipos + purga) | ~150 |
| `auth-tokens.integration.test.ts` | ~140 |
| `auth.service.ts` (≈60 borradas + ≈170 nuevas) | ~230 |
| `recovery-options.ts` · `index.ts` · `.env.example` · `apps/README.md` | ~65 |
| **Total** | **~585** |

La US estimaba ~300, que no contempla la suite de integración que su propia tabla de archivos
exige. Con `delivery_strategy: auto-chain`, **se recomienda cadena de 2 PRs** con corte por
paquete (el mismo seam de la tabla de la US): **PR#1 `packages/db`** (repositorio + tests +
exports, ~300 líneas; verificación autónoma `just db-check`; rollback trivial: nadie lo consume) →
**PR#2 `apps/api/rest`** (los 6 métodos + `recovery-options.ts` + docs, ~285 líneas; verificación
`just build-api` + los `curl` de la DoD). `sdd-tasks` emite el forecast autoritativo.

## Dependencies

US-22 mergeada (`bcryptjs`, `jwtService`, `findUserCredentialsByEmail`, `updateUserPasswordHash`,
`deriveRole`) · US-23 mergeada (las 6 rutas ya `@Public()`, **sin acción pendiente**) ·
`just db-up` con la base sembrada · `just db-build` si `packages/db/dist/` no existe.

## Success Criteria (1:1 con la DoD de la US)

- [ ] **CA-1/CA-4** `curl` pegado del flujo completo: forget → token leído del log → verify →
      reset → login con la contraseña nueva; y la vieja ya no sirve.
- [ ] **CA-4** `curl` pegado del reintento con el token ya consumido (falla) y con uno vencido
      (falla), ambos `{success:false}` con **200**, no excepción.
- [ ] **CA-2** las dos respuestas de `forget-password` (email existente vs. inexistente) pegadas
      una junto a otra, **idénticas**, más la prueba de que solo la primera persistió fila.
- [ ] **CA-5** `curl` pegado del flujo OTP: send (con `id` real, `provider:'log'`, `phone_number`
      eco, `is_contact_exist` computado) → verify con código correcto y con uno incorrecto →
      `otp-login` con el JWT **decodificado y pegado**, más el teléfono ambiguo → 401 genérico.
- [ ] **D5** salida real del log pegada, con la advertencia de "sin envío real" junto al secreto.
- [ ] **CA-6** `just build-api` limpio · `just db-check` verde con el recuento pegado · conteos
      3/12/1200/198 sin cambios.
- [ ] `apps/README.md` actualizado · status de US-24 y fila del épico marcadas.
