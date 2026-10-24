# US-70 — El inicio de sesión con Google se deshabilita si no está configurado

> El shop registra `GoogleProvider` de next-auth al cargar `[...nextauth].ts`,
> y `getEnv()` lanza si `GOOGLE_CLIENT_ID` o `GOOGLE_CLIENT_SECRET` están
> vacías. Como la plantilla las trae vacías y `apps/README.md` no pide
> rellenarlas, en todo clon nuevo **toda** la ruta `/api/auth/*` responde 500
> con HTML, y `SessionProvider` la consulta en cada página: la consola del
> navegador arrastra un `CLIENT_FETCH_ERROR` permanente que no tiene que ver
> con Google. Esta US hace que el proveedor sea opcional: sin variables,
> next-auth sigue funcionando, el botón «Login with Google» no se ofrece y la
> consola queda limpia.

**Épico:** ninguno (US standalone). Nace de una observación del dueño sobre
la consola del shop en desarrollo.
**Fecha:** 2026-10-24
**Status:** ✅ Completada (2026-10-24), DA-1..DA-3 en su opción (a)
**Depende de:** ninguna. Solo toca `apps/shop` (dos archivos de código y dos
de documentación): no comparte archivos con ninguna US abierta ni con
`packages/db`, el DDL o la API, así que puede ir en paralelo con cualquier
otra.
**LOC est.:** ~90

## Historia

**Como** quien clona el repo y levanta el shop con la plantilla de `.env`
(o como el dueño, que no tiene credenciales de Google), **quiero** que el
inicio de sesión con Google quede deshabilitado cuando no está configurado,
**para** que next-auth no rompa, el botón no prometa algo que no puede
cumplir y la consola del navegador no muestre errores que no son míos.

## Contexto — verificado en código y en el entorno (2026-10-24, `main` en `3b8fce6`)

**Dónde revienta:**

- `apps/shop/src/pages/api/auth/[...nextauth].ts:8-19`: `NextAuth({...})` se
  evalúa **al cargar el módulo**; en `:15-18` registra
  `GoogleProvider({ clientId: getEnv('GOOGLE_CLIENT_ID'), clientSecret:
  getEnv('GOOGLE_CLIENT_SECRET') })`. Facebook está comentado (`:11-14`).
  `secret: getEnv('SECRET')` en `:24`.
- `apps/shop/src/config/get-env.ts:20-28`: `getEnv` lanza `Cannot find
  environmental variable: X` si el valor es vacío o no existe.
- Como el `throw` ocurre al importar el módulo, **todas** las subrutas de
  `/api/auth/*` fallan, no solo las de Google.
- `apps/shop/.env.template:31-34`: `NEXTAUTH_URL=http://localhost:3000`,
  `SECRET=`, `GOOGLE_CLIENT_ID=`, `GOOGLE_CLIENT_SECRET=`. En el `.env` del
  dueño (gitignored por `apps/shop/.gitignore:28`), `NEXTAUTH_URL` y `SECRET`
  tienen valor y las dos de Google están vacías. `apps/README.md:60-64` pide
  rellenar solo `NEXT_PUBLIC_ADMIN_URL`, `NEXTAUTH_URL` y `SECRET`: nadie que
  siga la guía configura Google, y el `justfile:46-59` (`env`) solo copia la
  plantilla.

**Efecto medido** (servidores del dueño arriba, solo lectura):

```
GET  http://localhost:3003/api/auth/session    → 500  text/html  3672 B   __NEXT_DATA__.err: "Cannot find environmental variable: GOOGLE_CLIENT_ID"
GET  http://localhost:3003/api/auth/providers  → 500  text/html  3672 B   (mismo error)
GET  http://localhost:3003/api/auth/csrf       → 500  text/html
POST http://localhost:3003/api/auth/_log       → 500
```

En el navegador (Chrome DevTools, contexto aislado, `http://localhost:3003/en`):
la página renderiza (30 tarjetas), pero la red muestra `GET /api/auth/session`
500 ×2 y `POST /api/auth/_log` 500 ×2, y la consola:

```
[next-auth][error][CLIENT_FETCH_ERROR] https://next-auth.js.org/errors#client_fetch_error Unexpected token '<', "<!DOCTYPE "... is not valid JSON   ×2
Failed to load resource: the server responded with a status of 500 (Internal Server Error)   ×4
```

Al pulsar «Join» se abre el modal de login con los botones «Login»,
«Login with Google» (habilitado), «Login with Mobile number» y «Register».

**Quién consulta la sesión y qué hace el botón:**

- `apps/shop/src/pages/_app.tsx:46`: `<SessionProvider session={session}>`.
  Nadie rellena `pageProps.session` (no hay `getServerSession` en el shop),
  así que el provider hace `GET /api/auth/session` al montar en cada página
  y al recuperar el foco de la ventana (defaults de next-auth 4). El cliente
  (`apps/node_modules/next-auth/client/_utils.js:66-70`) captura el fallo
  de parseo, registra `CLIENT_FETCH_ERROR` y devuelve `null`; el logger
  proxy reenvía ese error a `POST /api/auth/_log`, que también da 500 (de
  ahí el segundo par de errores).
- `_app.tsx:67` monta `<SocialLogin />`
  (`apps/shop/src/components/auth/social-login.tsx:6-22`): `useSession()` y,
  solo si `session.access_token && session.provider`, llama a `POST
  /social-login-token`. Con la sesión en `null` no hace nada.
- `apps/shop/src/components/auth/login-form.tsx:101-110`: el botón llama a
  `signIn('google')`; se renderiza siempre y solo se deshabilita mientras
  carga el login por email (`isLoading`). Es el **único** uso de
  `signIn`/`GoogleIcon`/`text-login-google` en el shop (`register-form.tsx`
  no tiene botón social).
- El formulario **nunca se renderiza en el servidor**:
  `apps/shop/src/components/ui/modal/managed-modal.tsx:6-8` lo carga con
  `dynamic(..., { ssr: false })` y `apps/shop/src/lib/private-route.tsx:43-53`
  solo lo muestra tras `hasMounted`. Lo que el cliente decida sobre el botón
  no tiene problema de hidratación.
- `apps/shop/src/framework/rest/user.ts:28,405-408`: `useLogout` llama a
  `socialLoginSignOut({ redirect: false })` **sin `await`** y luego al logout
  propio. Leyendo `react/index.js:296-340`, `signOut` pide el CSRF
  (`fetchData` → `null` + `CLIENT_FETCH_ERROR`) y hace `fetch('/signout')`,
  que hoy devuelve HTML y hace fallar `res.json()`: el logout del shop sí se
  completa (no espera la promesa), pero añade un `CLIENT_FETCH_ERROR` y una
  promesa rechazada sin capturar. Deducido del código, no medido en el
  navegador: el ejecutor lo mide en la línea base (CA-5). Lo mismo en
  `framework/graphql/user.ts:13`, variante que no se usa.

**El backend es un stub (D-11):**

- `docs/product/19-autenticacion-autorizacion/README.md:82`, decisión 11:
  «Social login — **Fuera de alcance.** `POST /api/social-login-token` sigue
  siendo un stub declarado: requiere credenciales de proveedores OAuth
  externos, que son una decisión de infraestructura, no de este épico».
- `apps/api/rest/src/auth/auth.controller.ts:35-38`: `@Public()
  @Post('social-login-token')`. `auth.service.ts:306-315`: hace
  `console.log` del body y devuelve siempre `{ token: 'jwt token',
  permissions: ['super_admin', 'customer'], role: 'customer' }`. Medido:
  `POST /api/social-login-token {"provider":"google","access_token":"x"}` →
  **201** con ese cuerpo.
- `openspec/specs/auth-jwt-api/spec.md:164-178`: «Solo `socialLogin` MUST
  seguir devolviendo exactamente la misma respuesta fija que devuelve hoy,
  byte a byte». Implementar el login social real exige cambiar esa spec.
- Consecuencia: **aun con credenciales reales**, tras volver de Google
  `useSocialLogin` (`user.ts:196-221`) guardaría `'jwt token'` como token,
  marcaría `isAuthorized`, y el siguiente `GET /users/me` con ese Bearer
  daría 401. No es una escalada de privilegios (la API nunca acepta ese
  token; los `permissions` falsos ni siquiera se guardan: `useSocialLogin`
  no llama a `setAuthCredentials`), pero sí un callejón sin salida para el
  usuario. Pesa en DA-1.

**next-auth 4.24.10** (`apps/shop/package.json:42`; instalado en
`apps/node_modules/next-auth`, izado por el workspace):

- `core/lib/assert.js:31-33`: `MissingSecret` solo si `!options.secret &&
  NODE_ENV === 'production'`. En desarrollo, `core/lib/utils.js:21-31`
  (`createSecret`) deriva un sha256 de la URL y las opciones. Es decir: hoy
  `SECRET` vacío rompe **solo** porque `getEnv('SECRET')` lanza, no porque
  next-auth lo exija en dev.
- `assert.js:51-75` no comprueba `providers.length`: solo valida
  `credentials`, `email` y Twitter 2.0. **`providers: []` es válido.**
- `core/routes/providers.js`: `/api/auth/providers` hace `reduce` sobre la
  lista; con la lista vacía devuelve `{}`. `/api/auth/session` sin cookie
  devuelve `{}` con 200 y `_log` devuelve `{}` (`core/index.js:276-291`).
- `react/index.js:200-216` (`signIn`): pide `getProviders()`; si es `null`
  (fetch fallido) redirige a `/api/auth/error`; si el proveedor **no está en
  la lista**, redirige a `/api/auth/signin?callbackUrl=…`, la página
  genérica de next-auth, que con la lista vacía sale sin botones. Con
  `providers: []`, un clic en el botón sacaría al usuario del shop a una
  página vacía: ocultar el botón no es cosmético.
- `react/index.js:168-180` exporta `getProviders()`: `fetch` de
  `/api/auth/providers`, `null` si falla.

**Admin:** `apps/admin/rest` no depende de next-auth (`package.json` sin la
dependencia, `src/` sin imports, `.env.template` sin `GOOGLE_CLIENT_*`; solo
`NEXT_PUBLIC_GOOGLE_MAP_API_KEY:21`, que es de mapas). Queda fuera.

## Opciones evaluadas

### Dónde se decide «Google habilitado»

**En el servidor**, en `[...nextauth].ts`: el provider se registra solo si
**las dos** variables tienen valor; si no, la lista queda vacía (válida en
4.24.10, ver arriba) y next-auth sigue sirviendo `session`, `csrf`,
`providers` y `_log`. Es la única opción que elimina el 500: cualquier
decisión solo del lado del cliente dejaría el módulo lanzando al importar.

### Cómo se entera el cliente para no ofrecer el botón

| Opción | Cómo | A favor | En contra |
|---|---|---|---|
| **(a) `getProviders()` de next-auth** | el formulario pide `/api/auth/providers` al montar y renderiza el botón solo si `providers.google` existe | Una sola fuente de verdad: el mismo servidor que registra el provider. Sin variable nueva ni rebuild. El formulario no se renderiza en SSR (`dynamic ssr:false`, `hasMounted`), así que no hay hidratación que cuidar | Una petición más al abrir el modal, a la propia app. El botón aparece cuando llega la respuesta: hay que no renderizarlo hasta saberlo, para que no parpadee |
| (b) `NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED` | flag incrustado en el build | Sin fetch | Duplica la verdad y deriva: flag en `true` con secreto vacío devuelve el 500 o un botón muerto. Cambiarlo exige rebuild (`just build`, que además exige la API arriba y los `dev` parados) |
| (c) un flag en `/api/settings` | el formulario ya usa `useSettings()` | Ya está cargado | Mezcla configuración de infraestructura del shop con settings de negocio en Postgres; la API no sabe qué variables tiene el shop; rompe el contrato byte a byte de `/api/settings` (5503 B) que toda US debe preservar |
| (d) `_app.getInitialProps` o `getServerSideProps` leyendo `process.env` | prop en cada página | Sin fetch extra | Desactiva la optimización estática de todo el shop por un botón: cambio transversal y contrario al prerender por HTTP que usa `just build` |

**Recomendación: servidor decide + (a).** El cliente no inventa nada:
pregunta a next-auth qué proveedores hay. Mientras la respuesta no llega, el
hueco del botón no se renderiza (sin parpadeo); si la petición falla
(`null`), tampoco. Es un cambio de ~15 líneas en `login-form.tsx` y ~10 en
`[...nextauth].ts`.

### Variables a medias

Si solo una de las dos tiene valor, el proveedor **no se registra** (igual
que sin ninguna) y el servidor del shop escribe **una** línea `warn` al
cargar el módulo, nombrando la que falta. No se lanza: un `.env` incompleto
no debe tumbar el login por email.

## Decisiones abiertas para el dueño

| # | Tema | Opciones | Propuesta por defecto |
|---|---|---|---|
| DA-1 | Relación con el stub de la API (D-11) | **(a)** Habilitar solo por variables: con las dos presentes el botón vuelve a comportarse como hoy y termina en el stub; `apps/README.md` lo avisa. **(b)** Ocultar el botón **siempre** hasta que exista el login social real (el provider sigue siendo condicional para quitar el 500): deja código muerto y sin forma de probar la mitad OAuth del flujo. **(c)** Implementar el login social real en esta US | **(a)**. Configurar Google es un acto explícito que nadie hace siguiendo la guía; el README deja claro que hoy acaba en el stub. **(c) no**: es US aparte (ver Notas), porque toca la API, revierte D-11 y la cláusula MUST de `openspec/specs/auth-jwt-api/spec.md:164-178` |
| DA-2 | `SECRET` vacío (hoy también rompe; en el `.env` del dueño tiene valor; en la plantilla está vacío) | **(a)** Fuera de scope: sigue siendo *fail-fast* con `getEnv`, como documenta `apps/README.md:63-64`. **(b)** Tolerarlo en desarrollo (next-auth deriva uno) con un `warn` | **(a)**. Es el secreto que firma la cookie de sesión; en producción next-auth lo exige igualmente, y un clon nuevo ya tiene que rellenarlo según la guía. Si el dueño prefiere (b), es una línea más en `[...nextauth].ts` y entra sin cambiar el resto |
| DA-3 | Ocultar el botón o mostrarlo deshabilitado | **(a)** Ocultarlo. **(b)** Mostrarlo deshabilitado con un texto que explique por qué | **(a)**. Un botón deshabilitado sin explicación es ruido, y explicarlo exige una clave i18n nueva en los 6 locales del shop (`ar de en es he zh`) para un estado que solo verá quien no configuró Google. Coherente con la preferencia de interfaces sobrias |

> **Confirmadas por el dueño (2026-10-24): DA-1 (a), DA-2 (a) y DA-3 (a)**,
> las tres propuestas por defecto.

Las tres tienen propuesta por defecto. Si el dueño las acepta tal cual, la
US se ejecuta sin más; si cambia DA-1 a (b) o DA-3 a (b), los CA-2 y CA-3 se
reescriben antes de empezar.

## Scope

**Incluye:**

- registrar `GoogleProvider` en `[...nextauth].ts` solo si
  `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` tienen valor; si falta una
  sola, un `warn` por arranque en el servidor del shop;
- que el formulario de login consulte los proveedores disponibles y no
  ofrezca el botón de Google cuando el proveedor no está registrado (DA-3);
- comentarios en `apps/shop/.env.template` y un párrafo en `apps/README.md`
  (sección de variables del shop) que digan que Google es opcional y qué
  pasa hoy si se configura (DA-1);
- la evidencia de que la consola queda limpia sin variables y de que, con
  variables, el botón vuelve.

**NO incluye:**

- el login social real en la API (`socialLogin` sigue siendo el stub de
  D-11; la cláusula MUST de `openspec/specs/auth-jwt-api/spec.md:164-178`
  no se toca): candidata a US aparte, ver Notas;
- `SECRET` vacío (DA-2, por defecto fuera);
- Facebook (`[...nextauth].ts:11-14`, comentado) ni ningún proveedor nuevo;
- el admin (`apps/admin/rest` no usa next-auth);
- la variante GraphQL del shop (`framework/graphql/user.ts`);
- `NEXTAUTH_URL=http://localhost:3000` en la plantilla frente al 3003 que
  pide `apps/README.md:63`: deriva conocida, se menciona en el reporte, no se
  corrige aquí;
- el `import Email from 'next-auth/providers/email'` sin uso en
  `apps/shop/src/pages/profile.tsx:9`: inocuo, se menciona, no se toca;
- quitar `SessionProvider` o `<SocialLogin />` de `_app.tsx` cuando no hay
  proveedores: con la lista vacía cuestan una petición JSON de `{}` y
  mantienen el camino listo para cuando se configure Google;
- cambios en `packages/db`, el DDL, la API o los contratos HTTP.

## Criterios de aceptación

### CA-1 — Sin variables, `/api/auth/*` responde JSON y no 500

Con `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` vacías (el `.env` del dueño
tal cual):

| Llamada | Status | Cuerpo |
|---|---|---|
| `GET /api/auth/session` (sin cookie) | 200 `application/json` | `{}` |
| `GET /api/auth/providers` | 200 `application/json` | `{}` |
| `GET /api/auth/csrf` | 200 `application/json` | `{"csrfToken":"…"}` |
| `POST /api/auth/_log` | 200 | `{}` |

Y en el navegador, en la portada (`/en`), en un detalle de producto y tras
abrir el modal de login: **ninguna** petición a `/api/auth/*` con 500 y
**ningún** `[next-auth][error][CLIENT_FETCH_ERROR]` en la consola.

### CA-2 — Sin variables, el botón de Google no se ofrece

- En el modal `LOGIN_VIEW` (botón «Join») el formulario muestra «Login»,
  «Login with Mobile number» y «Register» y **no** muestra «Login with
  Google». Ídem en la pantalla de login de una ruta protegida (por ejemplo
  `/profile` sin sesión, que pasa por `private-route.tsx`).
- El resto no cambia: el login por email con `customer@demo.com` /
  `demodemo` sigue entrando, el modal de OTP sigue abriéndose y el enlace
  «Register» sigue funcionando.
- No queda un hueco ni un parpadeo visible: mientras se resuelve la lista de
  proveedores, el bloque del botón no se renderiza.

### CA-3 — Con las dos variables, el proveedor y el botón vuelven

Con dos valores de relleno pasados **como variables de entorno del proceso**
(sin tocar el `.env`, ver Notas):

- `GET /api/auth/providers` → 200 con
  `{"google":{"id":"google","name":"Google","type":"oauth","signinUrl":"http://localhost:3003/api/auth/signin/google","callbackUrl":"http://localhost:3003/api/auth/callback/google"}}`;
- el modal muestra «Login with Google», y al pulsarlo el navegador sale hacia
  `/api/auth/signin/google` y de ahí a Google, como hoy. **No se completa el
  flujo** (las credenciales son de relleno): basta con ver la redirección.

### CA-4 — Con una sola variable, se deshabilita y avisa

Con solo `GOOGLE_CLIENT_ID` (o solo el secreto) en el proceso: CA-1 y CA-2
se cumplen igual, y la salida del servidor del shop muestra **una** línea de
aviso que nombra la variable que falta, una vez por arranque y no por
petición.

### CA-5 — El logout queda limpio

Con sesión iniciada por email y sin variables, cerrar sesión no produce
ningún `CLIENT_FETCH_ERROR` ni ninguna petición a `/api/auth/*` con 500
(la línea base debe mostrar lo contrario, según el análisis de
`useLogout`; si la línea base no lo muestra, se anota y el CA se da por
cumplido igualmente).

### CA-6 — Documentación

- `apps/shop/.env.template` dice junto a las variables que Google es
  opcional y que, vacías, el botón no se ofrece.
- `apps/README.md` (sección de variables del shop) tiene un párrafo con lo
  mismo y con la consecuencia de DA-1: hoy, configurarlas lleva al stub de
  `social-login-token` (D-11).

### CA-7 — Sin regresión

- `cd apps/shop && npx tsc --noEmit` y `yarn lint` sin errores nuevos
  (comparar con la línea base: el shop no tiene suite de tests).
- `just build-shop` en verde, con la API arriba y `just shop-dev` parado
  (comparten `.next`), coordinado con el dueño.
- Tras relanzar `just shop-dev`, `just verify` con los tres `OK` y
  `cards:30` en el shop.

## Escenarios Gherkin

```gherkin
Feature: El inicio de sesion con Google es opcional
  Scenario: CA-1 — sin variables, next-auth sigue sirviendo la sesion
    Given GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET vacias
    When el navegador pide GET /api/auth/session
    Then la respuesta es 200 application/json con {}
    And la consola no muestra CLIENT_FETCH_ERROR

  Scenario: CA-2 — sin variables, el boton no se ofrece
    Given GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET vacias
    When el usuario abre el modal de login
    Then ve Login, Login with Mobile number y Register
    And no ve Login with Google

  Scenario: CA-3 — con las dos variables, el boton vuelve
    Given GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET con valor en el proceso
    When el usuario abre el modal de login
    Then ve Login with Google
    And GET /api/auth/providers lista el proveedor google

  Scenario: CA-4 — una sola variable deshabilita y avisa
    Given solo GOOGLE_CLIENT_ID con valor
    When arranca el servidor del shop y se pide GET /api/auth/providers
    Then la respuesta es {} y el servidor registra un aviso que nombra GOOGLE_CLIENT_SECRET
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `apps/shop/src/pages/api/auth/[...nextauth].ts` | `providers` construido de forma condicional; `warn` si falta una de las dos variables |
| `apps/shop/src/components/auth/login-form.tsx` | consulta de proveedores al montar; el bloque del botón de Google solo si `google` está en la lista |
| `apps/shop/.env.template` | comentarios: Google opcional; qué pasa vacío y qué pasa configurado (DA-1) |
| `apps/README.md` | párrafo en la sección de variables del shop |
| `apps/shop/src/config/get-env.ts` | **solo si hace falta**: ver Notas; por defecto no se toca |

## Definición de Done

- [x] DA-1, DA-2 y DA-3 confirmadas por el dueño **antes** de tocar código,
  anotadas aquí.
- [x] Línea base pegada: los cuatro `curl` de CA-1 con status, `content-type`
  y tamaño (hoy 500 / `text/html` / 3672 B), la consola del navegador en la
  portada y al abrir el modal (hoy `CLIENT_FETCH_ERROR` ×2 y 500 ×4), y el
  logout de CA-5.
- [x] CA-1 con `curl` y con la consola/red del navegador en los tres puntos
  (portada, detalle, modal).
- [x] CA-2 con snapshot del modal (lista de botones) y login por email
  comprobado.
- [x] CA-3 y CA-4 con variables de proceso, el `curl` a `/providers` y la
  línea de `warn`, **y el servidor del shop relanzado después sin variables**
  (restauración pegada: `/providers` → `{}` de nuevo).
- [x] CA-6: el diff de `.env.template` y `apps/README.md`.
- [x] CA-7: `tsc`, `lint`, `just build-shop` y `just verify` con salida.
- [x] `git status` del `.env` del dueño sin cambios (está gitignored: se
  comprueba con `ls -l --time-style=full-iso apps/shop/.env` antes y
  después, misma marca de tiempo).
- [x] Status actualizado aquí y en el mapa de `docs/product/README.md`.

## Notas para el agente ejecutor

- **No tocar `apps/shop/.env`.** Las variables de relleno de CA-3 y CA-4 van
  en el entorno del proceso: `cd apps/shop && GOOGLE_CLIENT_ID=relleno
  GOOGLE_CLIENT_SECRET=relleno yarn dev:rest` (`dev:rest` es `next dev -p
  3003`, `apps/shop/package.json:8`). `@next/env` carga el `.env` **sin
  pisar** las variables ya presentes en el proceso, así que el valor del
  proceso gana aunque el archivo las tenga vacías. Eso exige **parar y
  relanzar** el `just shop-dev` del dueño, con su visto bueno; al terminar
  se relanza sin variables y se comprueba que `/providers` vuelve a `{}`.
  No levantar una segunda instancia en otro puerto: compartiría `.next` con
  la que ya corre (misma regla que `just build`).
- **El servidor decide, el cliente pregunta.** No introducir una variable
  `NEXT_PUBLIC_*` ni un flag en settings (opciones (b) y (c), descartadas).
  En `login-form.tsx`, `getProviders()` de `next-auth/react` en un
  `useEffect` con estado local basta; no hace falta react-query para esto.
  Renderizar el bloque del botón solo cuando la respuesta trae `google`; si
  la respuesta es `null` (fallo), tratarlo como ausente.
- **`providers: []` es válido en 4.24.10** (`assert.js` no lo rechaza), pero
  comprobarlo igualmente en la línea «después» con `/api/auth/providers` →
  `{}` y `/api/auth/signin` → página sin botones, por si el ejecutor corre
  otra versión izada.
- **Leer `process.env` directamente para las dos variables opcionales.**
  `getEnv` es *fail-fast* a propósito y debe seguir siéndolo para `SECRET`
  (DA-2). No añadir un `getOptionalEnv` por dos lecturas: tres líneas
  parecidas ganan a una abstracción prematura. Si al final hiciera falta
  (por tipado de `EnvVariables`), que sea lo mínimo.
- **El `warn` de variables a medias** va al cargar el módulo (una vez por
  arranque), no dentro de un handler; nombrar la variable que falta, nunca
  imprimir el valor de la que está.
- **No borrar el botón ni sus imports.** Con las variables presentes debe
  volver tal cual (CA-3). `GoogleIcon` y `text-login-google` se quedan.
- **Separar refactor de comportamiento:** esta US es solo comportamiento;
  no aprovechar para reordenar `[...nextauth].ts` (sus comentarios de
  Pickbazar se quedan) ni para quitar los `@ts-ignore` de `social-login.tsx`.
- **Candidata a US aparte, para el reporte: login social real.** Requiere en
  la API validar el `access_token` de Google (tokeninfo/userinfo), resolver
  o crear el usuario por email verificado, emitir el JWT propio y devolver
  los `permissions` reales; revertir D-11 en el README del Épico 19 y la
  cláusula MUST de `openspec/specs/auth-jwt-api/spec.md:164-178`; y decidir
  qué hace `useSocialLogin` con `setAuthCredentials`, que hoy no llama. Es un
  épico pequeño o una US grande, no cabe aquí.
- **Mencionar también en el reporte** la deriva `NEXTAUTH_URL` 3000 vs 3003
  de la plantilla y el import sin uso de `profile.tsx:9`.

## Evidencia (2026-10-24)

**Decisiones:** el dueño aceptó las tres propuestas por defecto: DA-1 (a),
DA-2 (a) y DA-3 (a).

**Implementación:**

- `[...nextauth].ts`: `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` se leen de
  `process.env`. `GoogleProvider` se registra solo si están las dos. Si hay
  solo una, se registra un `console.warn` al cargar el módulo, que nombra la
  que falta. `SECRET` sigue con `getEnv` (DA-2).
- `login-form.tsx`: `getProviders()` se llama en un `useEffect`, y el botón
  se renderiza solo si `providers.google` existe. Mientras tanto, o si la
  consulta falla, no se renderiza.
- `.env.template` y `apps/README.md` explican que Google es opcional y que
  hoy termina en el stub de D-11.

**Línea base** (antes del cambio):

```
GET /api/auth/session   → 500 text/html; charset=utf-8 3672 B
GET /api/auth/providers → 500 text/html; charset=utf-8 3672 B
GET /api/auth/csrf      → 500 text/html; charset=utf-8 3672 B
POST /api/auth/_log     → 500 text/html; charset=utf-8 3672 B
```

En el navegador (Chrome DevTools, contexto aislado):

- **Portada:** `GET /api/auth/session` [500] ×2 y
  `[next-auth][error][CLIENT_FETCH_ERROR] … Unexpected token '<'` ×2, más
  «Failed to load resource … 500» ×4.
- **Modal «Join»:** `["close","Forgot password?","Login","Login with
  Google","Login with Mobile number","Register"]`.
- **Logout (CA-5)**, tras entrar por email:
  - `GET /api/auth/csrf` [500] y `POST /api/auth/signout` [500];
  - `CLIENT_FETCH_ERROR`;
  - `Uncaught (in promise) SyntaxError: Unexpected token '<', "<!DOCTYPE "...
    is not valid JSON`.

  Esto confirma el análisis de `useLogout`.

**CA-1** (sin variables, el `.env` del dueño tal cual):

```
GET /api/auth/session   → {}                    [200 application/json; charset=utf-8 2 B]
GET /api/auth/providers → {}                    [200 application/json; charset=utf-8 2 B]
GET /api/auth/csrf      → {"csrfToken":"…"}     [200 application/json; charset=utf-8 80 B]
POST /api/auth/_log     →                       [200, cuerpo vacío]
```

Matiz: `_log` responde 200 con el cuerpo **vacío**, no `{}` como suponía el
CA. Lo que importa es que deja de dar 500.

En el navegador se recorrieron, en un contexto limpio:

- la portada y el modal;
- el login por email;
- `/en/products/apples`;
- `/en/profile`;
- el logout.

En la red, todo `/api/auth/*` salió 200 o 304: `session`, `providers`,
`csrf` y `POST /api/auth/signout` [200]. En la consola no hubo ningún
`[next-auth][error]` ni el `Uncaught (in promise) SyntaxError`. Los errores
que quedan no son de next-auth: el aviso de `fetchPriority` y los dos
hallazgos de abajo.

**CA-2:**

```
modal «Join» → ["close","Forgot password?","Login","Login with Mobile number","Register"]
/en/profile sin sesión (private-route) → botones ["Forgot password?","Login","Login with Mobile number","Register", …]
login por email customer@demo.com → POST /api/token [201], GET /api/me [200], el modal se cierra
```

**CA-3.** El `shop-dev` del dueño se detuvo con su autorización y se
relanzó con `GOOGLE_CLIENT_ID=relleno-id GOOGLE_CLIENT_SECRET=relleno-secreto
yarn dev:rest`, con las variables solo en el proceso:

```
GET /api/auth/providers → {"google":{"id":"google","name":"Google","type":"oauth","signinUrl":"http://localhost:3003/api/auth/signin/google","callbackUrl":"http://localhost:3003/api/auth/callback/google"}}  [200]
POST /api/auth/signin/google (con csrf) → 302 Location: https://accounts.google.com/o/oauth2/v2/auth?client_id=…&scope=openid%20email%20profile&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A3003%2Fapi%2Fauth%2Fcallback%2Fgoogle&…
modal «Join» → ["close","Forgot password?","Login","Login with Google","Login with Mobile number","Register"]
clic en «Login with Google» → POST /api/auth/signin/google [200] → accounts.google.com/o/oauth2/v2/auth [302] → accounts.google.com/signin/oauth/error?authError=…invalid_client
```

El flujo no se completa porque las credenciales son de relleno: Google
responde `invalid_client`.

**CA-4**, solo con `GOOGLE_CLIENT_ID=relleno-id yarn dev:rest`:

```
{} [200]  /api/auth/session
{} [200]  /api/auth/providers      (×2 cada una)
log del servidor:
[next-auth] Login con Google deshabilitado: falta GOOGLE_CLIENT_SECRET.
líneas de aviso: 1
```

Hay una sola línea tras arrancar y hacer cuatro peticiones, y no imprime
ningún valor. No se probó el caso simétrico (solo el secreto): es la misma
condición `Boolean(id) !== Boolean(secret)`.

**Restauración:** `just shop-dev`, sin variables:

```
{} [200] /api/auth/providers
{} [200] /api/auth/session
.env intacto: -rw-r--r-- 1 DOMAIN+ronald.cuello 4096 1009 2026-08-25 11:24:54.010133500 -0500 apps/shop/.env   (misma marca que antes)
```

**CA-6:** los diffs de `apps/shop/.env.template` (4 líneas de comentario
sobre las variables de Google) y de `apps/README.md` (un párrafo tras el
bloque `env` del shop).

**CA-7:**

```
cd apps/shop && npx tsc --noEmit -p tsconfig.json  →  9 × error TS2786 ('Element'/'Link'/'AnchorLink'/'CopyToClipboard' cannot be used as a JSX component)
   en classic.tsx, modern.tsx, book-details.tsx, details.tsx, terms.tsx, coupon.tsx y privacy.tsx: ninguno en los archivos tocados (previos)
yarn lint  →  ✔ No ESLint warnings or errors
just build-shop (API arriba, shop-dev parado)  →  ✓ Compiled successfully · λ /api/auth/[...nextauth] · Done in 124.44s.  EXIT=0
just verify (tras relanzar shop-dev)
OK   API    :9001/api/settings  200  5503B  561ms
OK   Shop   :3003/en  200  190788B  634ms  cards:30
OK   Admin  :3002/en/login  200  72821B  10804ms  cards:1
```

**Hallazgos fuera de alcance** (vistos al recorrer el shop con sesión; los
puntos 1 y 2 los corrige [US-71](./71-shop-no-expulsa-por-403.md)):

1. **El detalle de producto cierra la sesión de un cliente.** El shop pide
   `GET /api/store-notices?search=shops.slug:apples`, y
   `store-notices.controller.ts:28` lleva `@Permissions(...ADMIN_AND_OWNER)`
   en todo el controlador. Para `customer@demo.com` responde **403**
   (confirmado con `curl`). `http-client.ts:203-208` borra el token ante
   cualquier 401 o 403 y manda a la portada. Resultado: un cliente que abre
   un producto pierde la sesión. Además, el shop usa el slug del
   **producto** como slug de tienda. Candidato a US aparte.
2. **`GET /api/shops/apples` da 404** desde el detalle de producto: la misma
   confusión de slug.
3. Ya anotados en «NO incluye»: `NEXTAUTH_URL=http://localhost:3000` en la
   plantilla frente al 3003, y el `import Email` sin uso en `profile.tsx:9`.
4. Candidata a US aparte: el login social real (ver Notas).
