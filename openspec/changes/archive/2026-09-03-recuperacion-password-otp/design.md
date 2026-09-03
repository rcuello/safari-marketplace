# Design: Recuperación de contraseña y OTP contra la base

> US-24, Épico 19. Insumos: `proposal.md` (**D1–D6 cerradas, no se reabren**),
> `specs/password-recovery-otp/spec.md`, `specs/auth-jwt-api/spec.md` (delta) y `explore.md`.
> Formato: `archive/2026-09-02-login-jwt-postgres/design.md`. Entrega: **2 PRs encadenados**
> (`chain_strategy: stacked-to-main`). Todo `path:line` se leyó en esta sesión; las apuestas de
> librería se verificaron contra el cliente **generado en `packages/db/generated/`**.

## Technical Approach

Siete archivos, en dos paquetes que se pueden mergear por separado.

**PR#1 (`packages/db`)** — `auth-tokens.repository.ts` (nuevo): ocho funciones planas y dos tipos
portadores de hash (`PasswordResetTokenSecret`, `OtpCodeSecret`) declarados **en el propio
archivo**, no en `records.ts`, por el mismo criterio que `UserCredentials`
(`users.repository.ts:9-11,32-38`). El reloj mockeable (`src/clock.ts:17-19`) queda **entero
dentro del paquete**: la vigencia (`expires_at > now()`) se filtra en SQL, no en Nest. Más su
suite de integración (primer consumidor real de `_setNowProvider`) y los exports de `index.ts`.

**PR#2 (`apps/api/rest`)** — `recovery-options.ts` (nuevo, calca `jwt-options.ts:16-34`), los seis
métodos de `auth.service.ts:241-327` reescritos, `.env.example` y `apps/README.md`. Toda la
criptografía vive aquí: `crypto.randomBytes`/`crypto.randomInt` para el valor en claro,
`bcrypt.hash(x, 10)` y `bcrypt.compare`. `packages/db` **no gana ninguna dependencia**
(`package.json:27-32` — sigue sin `bcryptjs`), que es lo que exige el requirement "Sin dependencia
nueva de hashing" de `identity-data-layer`.

Sin DDL: `db/schema.sql:181-212` y `prisma/schema.prisma:293-319` ya modelan las dos tablas.

## Data Flow

    POST /api/forget-password ─→ AuthService.forgetPassword(ForgetPasswordDto)
      findUserCredentialsByEmail(email)
        ├ null ──────────────────────────→ 200 {success:true,'Password change successful'}   (sin fila, SIN log)
        └ creds → randomBytes(32).hex → bcrypt.hash(·,10) → expiresAt = now + TTL_reset
             └→ createPasswordResetToken({userId, tokenHash, expiresAt})
                  · $transaction[ updateMany(consumedAt:=now WHERE user_id=? AND consumed_at IS NULL),
                                  create(...) ]      ← normalmente deja 1 fila viva (ver V-6)
             └→ logger.warn(advertencia + token en claro)
             └→ 200 {success:true,'Password change successful'}        ← literal idéntico

    POST /api/verify-forget-password-token ─→ findUserCredentialsByEmail → findLivePasswordResetTokens(userId)
      for (row of filas vivas, de la más nueva a la más vieja):  bcrypt.compare(token, row.tokenHash)
        ├ ninguna coincide (incluida la lista vacía) → 200 {success:false,'PICKBAZAR_MESSAGE.INVALID_TOKEN'}   (NO consume)
        └ primera coincidencia → corta el bucle → 200 {success:true, 'Password change successful'}

    POST /api/reset-password ─→ mismo bucle de comparación + creds.isActive
        └ primera coincidencia → consumePasswordResetToken(id) → count
             ├ 0 → 200 {success:false, INVALID_TOKEN}          ← carrera perdida / reintento
             └ 1 → updateUserPasswordHash(userId, bcrypt.hash(password,10)) → success:true

    POST /api/send-otp-code ─→ randomInt(0,1e6) → padStart(6,'0') → bcrypt.hash(·,10)
        └→ createOtpCode({phone, codeHash, expiresAt}) → id
        └→ findUserIdByProfileContact(phone) !== null → is_contact_exist
        └→ logger.warn(advertencia + código) → {message:'success',success:true,id:String(id),
                                                provider:'log',phone_number:<eco>,is_contact_exist}

    POST /api/verify-otp-code ─→ findLiveOtpCodeById(Number(otp_id))
        null | phone≠ | compare(code)=false → 200 {message:INVALID_TOKEN, success:false}   (NO consume)

    POST /api/otp-login ─→ mismas validaciones que verify + findUserIdByProfileContact(phone)
        0 ó >1 perfiles | usuario inactivo | consume→0  ──→ 401 INVALID_CREDENTIALS_MESSAGE
        1 perfil → consumeOtpCode(id)=1 → findUserWithRelations → signAsync({sub,email,permissions})
                 → {token, permissions, role: deriveRole(permissions)}

## Architecture Decisions

### Decisión A: la superficie del repositorio — ocho funciones, dos tipos, un solo `$transaction`

| Función | Firma | Prisma | Frontera transaccional |
|---|---|---|---|
| `createPasswordResetToken` | `(input: CreatePasswordResetTokenInput) => Promise<PasswordResetTokenSecret>` | `$transaction([passwordResetToken.updateMany, passwordResetToken.create])` | **Sí** — la única del paquete |
| `findLivePasswordResetTokens` | `(userId: number) => Promise<PasswordResetTokenSecret[]>` — **N ≥ 0 filas, orden garantizado: la más nueva primero** | `findMany({where:{userId, consumedAt:null, expiresAt:{gt: now()}}, orderBy:{id:'desc'}})` | statement único |
| `consumePasswordResetToken` | `(id: number) => Promise<number>` | `updateMany({where:{id, consumedAt:null}, data:{consumedAt: now()}})` → `.count` | statement único (**es** la garantía) |
| `createOtpCode` | `(input: CreateOtpCodeInput) => Promise<OtpCodeSecret>` | `otpCode.create` | statement único |
| `findLiveOtpCodeById` | `(id: number) => Promise<OtpCodeSecret \| null>` | `findFirst({where:{id, consumedAt:null, expiresAt:{gt: now()}}})` | statement único |
| `consumeOtpCode` | `(id: number) => Promise<number>` | `updateMany({where:{id, consumedAt:null}, data:{consumedAt: now()}})` → `.count` | statement único |
| `purgeExpiredAuthTokens` | `() => Promise<{passwordResetTokens: number; otpCodes: number}>` | dos `deleteMany` con `OR:[{expiresAt:{lt: now()}},{consumedAt:{not:null}}]` | ninguna (tablas independientes, idempotente) |
| `findUserIdByProfileContact` | `(contact: string) => Promise<number \| null>` | `profile.findMany({where:{contact}, select:{userId:true}, take:2})`; `null` si `length !== 1` | statement único |

`bigint` → `number` con el `_id()` de `records.ts:38-40`; las entradas aceptan `number` porque el
cliente generado tipa `userId: bigint | number`
(`generated/prisma/client/models/PasswordResetToken.ts:293-300`, `.../OtpCode.ts:277-284`).
`updateMany`/`deleteMany` devuelven `Prisma.BatchPayload` (`.../PasswordResetToken.ts:769,788`),
que es exactamente `{ count: number }` (`.../internal/prismaNamespace.ts:1966-1968`) — de ahí que
`consume*` devuelva un `number` sin inventarse nada.

`take: 2` en `findUserIdByProfileContact` responde "¿exactamente uno?" sin escanear el resto.
`profiles.contact` no tiene índice (`prisma/schema.prisma:251-264`): con 3 filas da igual, y
crearlo sería tocar `db/schema.sql`, que el "NO incluye" prohíbe.

**El TTL no entra al repositorio**: el caller pasa `expiresAt: Date` ya calculado. Es
configuración de la API (`recovery-options.ts` es su único lector, D4) y el paquete de datos no lee
`process.env` salvo `DATABASE_URL` (`src/client.ts:8`).

### Decisión B: dónde vive la criptografía (y por qué el paquete no la ve)

| Símbolo | Módulo que lo importa | Nunca lo importa |
|---|---|---|
| `crypto.randomBytes` / `crypto.randomInt` (node builtin) | `apps/api/rest/src/auth/auth.service.ts` | `packages/db/**` |
| `bcrypt.hash(·, 10)` / `bcrypt.compare` (`bcryptjs`, ya importado en `auth.service.ts:9`) | `apps/api/rest/src/auth/auth.service.ts` | `packages/db/**` |
| `PasswordResetTokenSecret` / `OtpCodeSecret` (llevan `tokenHash`/`codeHash`, nunca el claro) | `auth-tokens.repository.ts` → `index.ts` → `auth.service.ts` | `packages/db/src/records.ts` |

El valor en claro **existe en tres sitios y ninguno es una tabla ni un tipo de retorno**: la
variable local del método, el argumento de `bcrypt.hash` y el `logger.warn` de D5. Verificación
mecánica en la DoD: `grep -rn "bcrypt" packages/db/src` vacío y las mismas 4 dependencias de hoy.

### Decisión C: invalidar y consumir — `updateMany`, no `update`

**Invalidación** (`createPasswordResetToken`): forma de array de `$transaction`
(`generated/prisma/client/internal/class.ts:185`), que ejecuta los dos statements **en el orden
del array** dentro de una sola transacción y devuelve la tupla tipada, de donde sale la fila
creada.

Rechazado el *nested write* `prisma.user.update({data:{passwordResetTokens:{updateMany:…,
create:…}}})` — que sería la opción "0 usos de `$transaction`" que el paquete presume
(`users.repository.ts:223`): Prisma no documenta el orden relativo entre `updateMany` y `create`
anidados, y si el `create` corriera primero el token recién emitido nacería con `consumed_at`
puesto. Apostar a un orden no especificado para una propiedad de seguridad no es aceptable: se
rompe la racha a propósito y se documenta en la cabecera del archivo. Rechazado también dejar los
dos statements sueltos: falla en la dirección segura, sí, pero el spec pide "**en la misma
operación**" y la forma de array cuesta lo mismo.

**Alcance exacto: atomiza una petición, no serializa dos.** Bajo READ COMMITTED, si dos
`forget-password` del mismo usuario ejecutan su `updateMany` antes de que cualquiera commitee su
`create`, ninguna ve la fila de la otra: las dos invalidan cero filas y las dos insertan →
**dos tokens vivos** (doble clic, dos pestañas, cliente que reintenta). Aceptado como V-6.
Consecuencia de diseño: el consumidor se escribe para **N ≥ 0** filas, no para "como mucho una"
— de ahí el bucle de la Decisión D y el `orderBy:{id:'desc'}` que fija un orden reproducible.

Lo que la invalidación sigue comprando (razón de D1) es **acotar los `bcrypt.compare` por
petición**: sin ella cada `forget-password` acumula una fila viva y `verify`/`reset` harían N
comparaciones de coste 10 en un endpoint sin rate limiting. Con ella N es **pequeño en uso
normal** (1, salvo el empate de V-6) en vez de crecer sin límite, y el bucle solo recorre filas
vivas y no vencidas porque el filtro de vigencia va en el `WHERE`, no en Nest.

**Consumo condicional**: `updateMany({where:{id, consumedAt:null}}) → {count}` compila a un
`UPDATE … WHERE id = $1 AND consumed_at IS NULL`. Bajo READ COMMITTED, dos `reset-password`
concurrentes con el mismo token compiten por el mismo row lock; el segundo espera y, al
desbloquearse, **reevalúa el `WHERE` contra la versión actualizada**, ve `consumed_at` no nulo y
afecta 0 filas. Exactamente uno recibe `count === 1`. Con `find` + `if` + `update` en dos
statements ambos leerían `consumed_at IS NULL` y ambos triunfarían — el fallo que CA-4 nombra.

Rechazado `update({where:{id, consumedAt:null}})`: **es legal** (el `WhereUniqueInput` generado
admite filtros extra, `generated/prisma/client/models/PasswordResetToken.ts:245-253`) y también
sería atómico, pero señaliza "0 filas" **lanzando P2025**, convirtiendo el camino normal ("token
ya consumido", cada reintento honesto de un usuario) en una excepción que habría que atrapar con
`_isRecordNotFound` (`users.repository.ts:300-307`) y que, si escapara,
`withPrismaErrorTranslation` traduciría a **500**.

### Decisión D: los seis métodos, respuesta a respuesta (CA-6)

Regla de oro: **el orden de inserción de claves se copia literal del stub**, porque
`JSON.stringify` serializa en ese orden y CA-6 pide el contrato byte a byte. Los tres de
recuperación construyen `{ success, message }` (`auth.service.ts:246-249,260-263,274-277`);
`verifyOtpCode`, `{ message, success }` (`:308-311`); `sendOtpCode`,
`{ message, success, id, provider, phone_number, is_contact_exist }` (`:319-326`); `otpLogin`,
`{ token, permissions, role }` (`:296-300`).

| Método | Éxito (literal preservado) | Fallo de dominio |
|---|---|---|
| `forgetPassword` | `{success:true, message:'Password change successful'}` | **no existe**: misma respuesta siempre (CA-2) |
| `verifyForgetPasswordToken` | ídem | `{success:false, message:'PICKBAZAR_MESSAGE.INVALID_TOKEN'}` |
| `resetPassword` | ídem | ídem |
| `verifyOtpCode` | `{message:'success', success:true}` | `{message:'PICKBAZAR_MESSAGE.INVALID_TOKEN', success:false}` |
| `sendOtpCode` | `{message:'success', success:true, id:String(row.id), provider:'log', phone_number:<eco>, is_contact_exist:<computado>}` | `phone_number` vacío → mismas 6 claves con `message:'PICKBAZAR_MESSAGE.REQUIRED_INFO_MISSING'`, `success:false`, `id:''`, `is_contact_exist:false` |
| `otpLogin` | `{token, permissions, role}` | **401** `UnauthorizedException(INVALID_CREDENTIALS_MESSAGE)` (`auth.service.ts:44`) |

Los mensajes de éxito **no cambian**: son los del mock, y `changePassword` fijó el precedente de
"éxito con el literal heredado, fallo con clave `PICKBAZAR_MESSAGE.*`"
(`auth.service.ts:221-224,235`). Las claves elegidas existen en **los dos** frontends:
`INVALID_TOKEN` ("Token is not valid") en `apps/shop/public/locales/en/common.json:259` y
`apps/admin/rest/public/locales/en/common.json:212`; `REQUIRED_INFO_MISSING` en `shop/…:433` y
`admin/…:218`. Y se renderizan: la tienda mete `data.message` en el error de formulario del token
(`apps/shop/src/framework/rest/user.ts:498-501`) y en `serverError` del OTP (`:232` en
`useSendOtpCode`, `:262` en `useVerifyOtpCode`). Se descartó `SOMETHING_WENT_WRONG` para el código
equivocado: disfraza de fallo interno un error que el usuario corrige tecleando bien.

**Cómo casan el token `verifyForgetPasswordToken` y `resetPassword` (idéntico en ambos).**
`findLivePasswordResetTokens(userId)` devuelve **N ≥ 0** filas vivas y no vencidas, de la más
nueva a la más vieja. Ambos las recorren con `for…of` secuencial haciendo
`await bcrypt.compare(input.token, row.tokenHash)` y **cortan en la primera coincidencia** (nunca
`Promise.all`: el corte anticipado es lo que acota el coste bcrypt). Si el bucle termina sin
coincidencia — incluido `N === 0` (sin token vivo, ya consumido o vencido) — la respuesta es
`{success:false, message:'PICKBAZAR_MESSAGE.INVALID_TOKEN'}`, sin distinguir la causa (D-4).
Una vuelta en uso normal; dos en el empate de V-6.

Guardas obligatorias antes de cada `bcrypt.compare`: `token`, `code` y `password` vacíos son fallo
de dominio **sin llamar a bcrypt**, porque `bcryptjs` **lanza** con un argumento `undefined`
(verificado en US-22, `archive/2026-09-02-login-jwt-postgres/design.md:157-161`; guarda equivalente
en `auth.service.ts:128-133`). Sin ellas un body vacío sería un 500. `Number(otp_id)` se valida con
`Number.isSafeInteger(·) && > 0` por lo mismo.

`otpLogin` **consume antes de firmar** (si el consumo da 0 no se emite token; al revés, dos
peticiones concurrentes se llevarían dos JWT). `resetPassword` **consume antes de cambiar el
hash**: si el `updateUserPasswordHash` fallara después, el token queda quemado y el usuario pide
otro — falla en la dirección segura.
`withPrismaErrorTranslation` (`auth.service.ts:341-350`) envuelve **cada** llamada a `@safari/db`,
una por una, exactamente como `login`/`changePassword` (`:135-137,153-155,206-208,231-233`).

### Decisión E: CA-2 — qué se iguala y qué no

Se igualan las tres cosas que el spec exige: **cuerpo byte-idéntico** (las dos ramas construyen el
literal desde una única constante `PASSWORD_CHANGE_SUCCESS_MESSAGE`, no desde dos literales que
puedan divergir al editarse), **cero filas** y **cero log**. Ambas ejecutan el mismo
`findUserCredentialsByEmail`, así que la consulta indexada no distingue.

**No se iguala la latencia**, y se declara: la rama del email existente añade un
`bcrypt.hash(·,10)` (~60-100 ms) y un `INSERT`. Rechazado hashear un token descartable en la otra
rama para nivelar: convertiría un endpoint público **sin rate limiting por decisión del "NO
incluye"** en un amplificador de CPU de coste fijo para cualquier basura que le manden. El oráculo
temporal residual es V-3 y va al README junto a R-2.

`forget-password` **no** mira `isActive`: el token de un usuario inactivo es inútil porque
`resetPassword` sí lo comprueba (D6); comprobarlo arriba sería una rama más sin efecto observable.

### Decisión F: `recovery-options.ts` — lectura diferida, memoizada, y default ante valor inválido

```ts
export interface RecoveryOptions { passwordResetTtlMinutes: number; otpCodeTtlMinutes: number; }
let cached: RecoveryOptions | undefined;              // mismo patrón que jwt-options.ts:16
export function resolveRecoveryOptions(): RecoveryOptions {
  if (cached) return cached;
  cached = {
    passwordResetTtlMinutes: readTtlMinutes('PASSWORD_RESET_TTL_MINUTES', 60),
    otpCodeTtlMinutes: readTtlMinutes('OTP_CODE_TTL_MINUTES', 10),
  };
  return cached;
}
function readTtlMinutes(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);                          // Number('10min') = NaN; Number('') = 0
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    new Logger('recovery-options').warn(`${name}="${raw}" no es un entero de minutos válido; se usa ${fallback}.`);
    return fallback;
  }
  return parsed;
}
```

La lectura **debe** ser diferida por el hallazgo de US-22 (`jwt-options.ts:3-15`):
`ConfigModule.forRoot()` puebla `process.env` **después** de evaluar los `require` de los módulos
hijos, así que un `process.env.X` leído al importar `auth.service.ts` sería `undefined`. El primer
`resolveRecoveryOptions()` ocurre dentro de un request, mucho después.

**Valor malformado → default + `warn`, nunca `throw`.** Precisamente porque la lectura es diferida,
un `throw` **no puede** fallar en el arranque: fallaría en el primer `forget-password` y, al no
cubrirlo `withPrismaErrorTranslation`, saldría como 500 de un endpoint público. Un fail-fast que no
es fast es peor que un default seguro. Y a diferencia de `JWT_SECRET` (que sí lanza,
`jwt-options.ts:22-27`), un TTL mal escrito no degrada ninguna garantía criptográfica.

### Decisión G: el log (mecánica de D5, ya cerrada)

`private readonly logger = new Logger(AuthService.name)` — `Logger` se añade al import existente de
`@nestjs/common` (`auth.service.ts:1-7`); cero dependencias nuevas. **Una** llamada `logger.warn`
por emisión, con la advertencia y el secreto en la misma llamada y el formato literal de
`proposal.md:126-131`; `expira` sale como `expiresAt.toISOString()`. Ningún otro `console.log` de
la app se toca.

### Decisión H: el plan de tests de integración

`packages/db/src/repositories/auth-tokens.integration.test.ts`, con `import 'dotenv/config'` al
tope y la estructura de `users.integration.test.ts:17-40`.

**Aislamiento.** Dos centinelas, ninguno toca filas sembradas:

- Usuario centinela creado con `createUser` en dominio `@auth-tokens-integration.test` (RFC 2606).
  Sus tokens caen por `ON DELETE CASCADE` (`db/schema.sql:187-194`, la FK en `:189`), así que la
  limpieza es una sentencia: `prisma.user.deleteMany({where:{email:{endsWith: TEST_DOMAIN}}})`.
- Prefijo de teléfono centinela para `otp_codes` (sin FK): limpieza
  `prisma.otpCode.deleteMany({where:{phone:{startsWith: OTP_TEST_PREFIX}}})`.

`beforeAll(cleanup)` (corrida abortada previa) + `afterAll(cleanup + $disconnect)`. Los conteos de
`identity-data-layer` (3/12/1200/198) **no cambian**: el usuario centinela vive solo durante el
archivo y las dos tablas de tokens no están entre los conteos fijados.

**`_setNowProvider`** — primer consumidor real del repo (`src/clock.ts:11-14`), y la fuente de R-4:

```ts
const REAL_NOW = () => new Date();
afterEach(() => { _setNowProvider(REAL_NOW); });     // restaura aunque el `it` falle a mitad
afterAll(async () => { _setNowProvider(REAL_NOW); await cleanup(); await prisma.$disconnect(); });
```

Se restaura en `afterEach` **y** en `afterAll` (el primero corre aunque el `it` reviente; el
segundo cubre un fallo del propio `afterEach`), nunca dentro del `it`.

| Caso | Assert |
|---|---|
| `createPasswordResetToken` invalida el previo | tras dos llamadas **secuenciales**, la fila 1 queda con `consumedAt` no nulo y `findLivePasswordResetTokens` devuelve 1 fila, la nueva |
| Orden con varias filas vivas (empate de V-6) | con dos filas vivas insertadas a mano para el mismo usuario, `findLivePasswordResetTokens` devuelve **las 2, la de `id` mayor primero** — el contrato del que depende el bucle de la Decisión D |
| Vencimiento | con el reloj en `+TTL+1min`, `findLivePasswordResetTokens` devuelve `[]`; al restaurar, vuelve a devolver 1 |
| Un solo uso / carrera | `consumePasswordResetToken(id)` → `1`, y repetido → `0` |
| Id inexistente | `consumePasswordResetToken(999999)` → `0` |
| OTP vivo/vencido/consumido | `findLiveOtpCodeById` devuelve la fila; `null` con el reloj adelantado; `null` tras `consumeOtpCode` |
| `findUserIdByProfileContact` | `'12365141641631'` → `1`; `'19365141641631'` → `null` (dos perfiles); `'nadie'` → `null` |
| Purga | tras `purgeExpiredAuthTokens()`, los ids vencido y consumido ya no existen y el id vivo sí |
| Fuga de tipos | `Object.keys(secret)` = las 5 claves esperadas; `tokenHash` es el que se pasó |

Los tres casos de `findUserIdByProfileContact` salen del seed verificado: `db/seed.sql:62-64` da
`contact='19365141641631'` a los usuarios **3 y 2** y `'12365141641631'` al **1**,
`store_owner@demo.com` (`db/seed.sql:50-53`). Es la evidencia de D2, no una suposición.

La purga borra **todas** las filas vencidas o consumidas de las dos tablas, no solo las del test:
por eso sus asserts son **por id**, nunca por conteos absolutos. El README la documenta como
mantenimiento manual — esta US no introduce scheduler (fuera de alcance).

## File Changes

| Archivo | PR | Acción | Descripción |
|---|---|---|---|
| `packages/db/src/repositories/auth-tokens.repository.ts` | **#1** | Create | 8 funciones + `PasswordResetTokenSecret`/`OtpCodeSecret` + 2 inputs + `_toPasswordResetTokenSecret`/`_toOtpCodeSecret` locales |
| `packages/db/src/repositories/auth-tokens.integration.test.ts` | **#1** | Create | Decisión H |
| `packages/db/index.ts` | **#1** | Modify | Bloque nuevo **entre la línea 28 y la 29** (`auth-tokens` < `categories` alfabéticamente): `export type {…}` + `export {…}` |
| `apps/api/rest/src/auth/recovery-options.ts` | **#2** | Create | Decisión F (~35 líneas) |
| `apps/api/rest/src/auth/auth.service.ts` | **#2** | Modify | 6 métodos (`:241-327`, salvo `socialLogin` `:280-289`, intacto) + `logger` + imports nuevos |
| `apps/api/rest/.env.example` | **#2** | Modify | `PASSWORD_RESET_TTL_MINUTES=60`, `OTP_CODE_TTL_MINUTES=10` tras el bloque de JWT (`:27-28`) |
| `apps/README.md` | **#2** | Modify | Sección nueva antes de `## Verificación` (`:187`): leer el secreto del log, las 2 variables, purga manual, R-2 y V-3 |

`auth.controller.ts`, `create-auth.dto.ts`, `db/`, `schema.prisma` y los frontends **no se tocan**.

## Interfaces / Contracts

```ts
// packages/db/src/repositories/auth-tokens.repository.ts
export interface PasswordResetTokenSecret {
  id: number; userId: number; tokenHash: string; expiresAt: Date; consumedAt: Date | null;
}
export interface OtpCodeSecret {
  id: number; phone: string; codeHash: string; expiresAt: Date; consumedAt: Date | null;
}
export interface CreatePasswordResetTokenInput { userId: number; tokenHash: string; expiresAt: Date }
export interface CreateOtpCodeInput { phone: string; codeHash: string; expiresAt: Date }

export function createPasswordResetToken(i: CreatePasswordResetTokenInput): Promise<PasswordResetTokenSecret>;
export function findLivePasswordResetTokens(userId: number): Promise<PasswordResetTokenSecret[]>;
//   N >= 0 filas vivas y no vencidas, ORDENADAS de id descendente (la mas nueva primero).
//   El caller compara una por una y corta en la primera coincidencia (V-6).
export function consumePasswordResetToken(id: number): Promise<number>;   // filas afectadas: 0 | 1
export function createOtpCode(i: CreateOtpCodeInput): Promise<OtpCodeSecret>;
export function findLiveOtpCodeById(id: number): Promise<OtpCodeSecret | null>;
export function consumeOtpCode(id: number): Promise<number>;              // filas afectadas: 0 | 1
export function purgeExpiredAuthTokens(): Promise<{ passwordResetTokens: number; otpCodes: number }>;
export function findUserIdByProfileContact(contact: string): Promise<number | null>;

// apps/api/rest/src/auth/recovery-options.ts
export interface RecoveryOptions { passwordResetTtlMinutes: number; otpCodeTtlMinutes: number }
export function resolveRecoveryOptions(): RecoveryOptions;                // memoizada, nunca lanza
```

Las **firmas de los seis métodos de `auth.service.ts` no cambian**: cambia el cuerpo. Ninguna
función existente de `@safari/db` cambia de firma — por eso `identity-data-layer` no se modifica.

## Cadena de PRs

**PR#1 → `main`** (`packages/db`, ~300 líneas). Verificación autónoma: `just db-check`
(`justfile:343-345` = `npm run typecheck` + `npm test`, con el `cd "$(pwd)"` que evita el bug de la
unidad en minúscula). No hay código muerto que rompa nada: todo lo exportado lo **consume su propia
suite**, `purgeExpiredAuthTokens` incluida, y el build de la API es indiferente porque consume
`dist/` por `link:` sin referenciar los símbolos nuevos. Rollback: revertir el commit.

**PR#2 → rama de PR#1** (`apps/api/rest` + docs, ~285 líneas). Verificación: `just build-api` + los
`curl` de la DoD. **Requiere `just db-build` tras mergear PR#1** (`dist/` y `generated/` están
gitignored): sin eso el build falla con TS2305. Única dependencia de orden; va como primera tarea
de PR#2.

## Divergencias declaradas (nuevas, se suman a las del proposal)

| # | Divergencia | Tratamiento |
|---|---|---|
| V-1 | `verifyOtpCode` y los dos de token pasan a devolver `success:false` con `PICKBAZAR_MESSAGE.INVALID_TOKEN`; el mock era `success:true` incondicional | Lo exige el spec; claves ya traducidas en ambos frontends |
| V-2 | Un `send-otp-code` sin `phone_number` devuelve `success:false` en vez del `id:'1'` fijo | El mock ignoraba el input; el shape (6 claves) se preserva |
| V-3 | `forget-password` tarda ~60-100 ms más con un email existente (oráculo temporal) | Declarada (Decisión E), va al README junto a R-2 |
| V-4 | `packages/db` estrena `$transaction` (`users.repository.ts:223` presume "0 usos") | Deliberada (Decisión C), documentada en la cabecera del archivo nuevo. El comentario de `users.repository.ts` no se edita: sigue siendo cierto **de ese archivo** |
| V-5 | Los códigos OTP admiten ceros a la izquierda (`randomInt(0,1e6)` + `padStart(6,'0')`) | Intencional: `randomInt(100000,1e6)` perdería el 10 % del espacio |
| V-6 | **Dos `forget-password` concurrentes del mismo usuario pueden dejar dos tokens vivos** (la transacción atomiza una petición, no serializa dos — Decisión C) | **Declarada y aceptada.** Sin compromiso de seguridad: cada token tiene su hash, el UPDATE condicional mantiene el uso único del que se presente y ambos vencen por TTL. El consumidor está escrito para N ≥ 0 (Decisión D). La DoD, secuencial, **no la cubre**; el test de orden de PR#1 sí fija el contrato del que depende el bucle. Serializarla pediría `FOR UPDATE` o `SERIALIZABLE` con reintento: desproporcionado para un empate benigno entre dos tokens del mismo dueño |

## Testing Strategy

| Capa | Qué se prueba | Cómo |
|---|---|---|
| Integración (PR#1) | Las 8 funciones: invalidación, orden, vencimiento, un solo uso, purga, teléfono ambiguo | vitest contra el Postgres real; `just db-check` con el recuento pegado |
| Build (PR#2) | Firmas y exports | `just build-api` limpio |
| Contrato (PR#2) | CA-1/CA-4/CA-5/CA-6: los seis endpoints, éxito y fallo | `curl -i` con los cuerpos pegados uno junto a otro |
| CA-2 | Respuestas idénticas + ausencia de fila y de log | dos `curl` pegados + `SELECT count(*) FROM password_reset_tokens` antes/después + log pegado |
| JWT (CA-5) | `sub`/`email`/`permissions` reales | `node -e` decodificando el 2º segmento (jq no está instalado en esta máquina) |
| Regresión | Conteos 3/12/1200/198 y resto de la API | `SELECT count(*)` antes/después de `just db-check`; `just verify` |

## Migración / Rollout

No hay migración: cero DDL, cero `db pull`, cero `db-reset`. Único orden obligatorio: `just
db-build` entre PR#1 y PR#2. El rollback del proposal (`proposal.md:173-184`) se mantiene íntegro.

## Open Questions

Ninguna. D1–D6 se heredan cerradas y ninguna resultó inconstruible; las cuatro apuestas de Prisma
(array de `$transaction`, `BatchPayload = {count}`, `extendedWhereUnique`, entradas
`bigint | number`) se verificaron contra el cliente generado.
