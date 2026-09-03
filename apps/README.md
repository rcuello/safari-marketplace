# apps/ — Arranque local (stack REST)

Guía verificada en Windows 11 + Node 22.14 + yarn 1.22.22 (2026-08-24).

## Arquitectura

| Servicio | Carpeta | Stack | Puerto |
|---|---|---|---|
| API mock | `api/rest` | NestJS 9 | `9001` |
| Tienda | `shop` | Next.js 13.5 (pages router) | `3003` |
| Admin | `admin/rest` | Next.js 13.5 (pages router) | `3002` |

`shop` y `admin/rest` consumen la API vía `NEXT_PUBLIC_REST_API_ENDPOINT`.
Existe además una variante GraphQL (`api/graphql` + `dev:gql`) que depende de
codegen con `graphql-let`; no es necesaria para el stack REST.

## Atajo: `just`

Hay un [`justfile`](../justfile) en la raíz que envuelve todo lo de esta guía.
Si tienes [just](https://just.systems) instalado (`winget install Casey.Just`,
`brew install just`), el camino corto es:

```bash
just              # lista todas las tareas
just doctor       # comprueba que no falte nada en tu equipo
just setup        # .env + las dos instalaciones de dependencias
just api-dev      # terminal 1
just shop-dev     # terminal 2
just admin-dev    # terminal 3
just verify       # comprueba que los tres responden con datos reales
```

El resto de este documento explica qué hace cada paso por dentro, y sigue siendo
válido si prefieres no instalar `just`.

## Requisitos

- **Node 20 o 22** (probado en 22.14).
- **yarn 1** — el repo usa `workspaces` + el campo `resolutions`, que son de yarn
  clásico. `npm install` falla por peer-deps estrictos en este árbol.
  ```bash
  npm i -g yarn      # deja yarn 1.22.x
  ```

## Puesta en marcha

### 1. Variables de entorno

Los `.env` están en `.gitignore`; hay que crearlos desde las plantillas:

```bash
cd apps
cp shop/.env.template      shop/.env
cp admin/rest/.env.template admin/rest/.env
cp api/rest/.env.example    api/rest/.env
```

Luego ajusta el **puerto de la API** (ver *Puerto 9000 ocupado* abajo) y, en
`shop/.env`, estos tres valores que vienen como placeholder:

```env
NEXT_PUBLIC_ADMIN_URL="http://localhost:3002"
NEXTAUTH_URL=http://localhost:3003
SECRET=<cualquier-cadena-para-desarrollo>
```

### 2. Instalar dependencias

Son **dos instalaciones separadas**: `api/rest` no forma parte del workspace de
`apps/`.

```bash
cd apps          && yarn install    # shop + admin/rest + admin/graphql (~11 min)
cd apps/api/rest && yarn install    # API NestJS (~4 min)
```

### 3. Levantar los tres servicios

Cada uno en su propia terminal:

```bash
cd apps/api/rest   && yarn start:dev   # API   -> http://localhost:9001/api
cd apps/shop       && yarn dev:rest    # Shop  -> http://localhost:3003
cd apps/admin/rest && yarn dev         # Admin -> http://localhost:3002
```

Arranca **siempre la API primero**: los frontends hacen SSR y consultan la API
en el primer request.

> La API tarda ~2 min en el primer arranque (compilación TS de ~40 módulos).
> Next.js compila cada ruta bajo demanda: el primer `GET /` del shop puede
> tardar 60-90 s. No es un cuelgue.

### 4. Credenciales

`login`, `register`, `/me` y `change-password` son reales (US-22): la contraseña
se verifica contra el hash bcrypt de Postgres y el token es un JWT firmado.
**La única contraseña válida es `demodemo`** (la del seed, `db/seed.sql:50-54`);
cualquier otra contraseña memorizada de antes deja de servir.

| Email | Rol |
|---|---|
| `admin@demo.com` | `super_admin` |
| `store_owner@demo.com` | `store_owner` |
| `customer@demo.com` | `customer` |

> `vendor@demo.com` **no existe** en la base sembrada — es un resto de la
> documentación del mock. Usa `store_owner@demo.com` para el rol `store_owner`.

**Variables nuevas en `apps/api/rest/.env`** (`JWT_SECRET`, `JWT_EXPIRES_IN`):
`just setup`/`just env` las generan solas en un `.env` nuevo (copiado de
`.env.example`). Si tu `.env` es **anterior a esta US**, la línea `JWT_SECRET=`
no existe y `just setup` no la crea sola (mismo criterio que con
`DATABASE_URL`: no se pisa un `.env` existente). Agrégala a mano una vez:

```bash
printf '\nJWT_SECRET=%s\nJWT_EXPIRES_IN=7d\n' "$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" >> apps/api/rest/.env
```

Sin `JWT_SECRET` (o vacío) la API falla al arrancar con un mensaje claro — no
levanta un servidor firmando tokens con un secreto por defecto. Rotar
`JWT_SECRET` invalida todas las cookies vivas (R-7): esperado, sin mitigación
en esta US.

## Autorización (US-23): guard global + permisos por ruta

Desde US-23 la API exige JWT del lado del servidor: dos guards globales
(`APP_GUARD` en `api/rest/src/app.module.ts`) corren antes de cada
controller. **Deny-by-default**: una ruta sin `@Public()` exige un bearer
token válido; una ruta con `@Permissions(...)` exige además que el token
traiga alguno de esos permisos (semántica *any-of*, igual que `hasAccess()`
del admin).

| Situación | Respuesta |
|---|---|
| Ruta pública (catálogo, contenido, `web-hook`) | `200`, sin token |
| Ruta protegida sin `Authorization` | `401` |
| Token válido, permiso insuficiente | `403` |
| Token válido, permiso suficiente (o ruta sin `@Permissions()`) | `200` |

### Probar con token

```bash
# 1. Login → token JWT (mismo endpoint y credenciales de US-22, "Credenciales" arriba)
TOKEN=$(curl -s -X POST http://localhost:9001/api/token \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@demo.com","password":"demodemo"}' \
  | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).token))")

# 2. Ruta protegida con permiso (admin@demo.com trae super_admin)
curl -i http://localhost:9001/api/users -H "Authorization: Bearer $TOKEN"

# 3. Sin token → 401
curl -i http://localhost:9001/api/users

# 4. Con token de customer@demo.com (permiso insuficiente) → 403
```

### Auditor de rutas

`node apps/api/rest/scripts/route-audit.mjs` lista las 250 rutas y su
clasificación efectiva (`public` / `perm(...)` / `auth`); `--check` valida
que el set de rutas públicas coincida con el inventario esperado (exit 1 si
no) — es la forma reproducible de confirmar que ninguna ruta pública quedó
sin anotar antes de tocar los guards.

### Caveats declarados (no son defectos a arreglar aquí)

- **Checkout de invitado vivo (R-2)**: `POST /api/orders` y
  `POST /api/orders/checkout/verify` quedan `@Public()` a propósito
  (`guestCheckout: true`). `OrdersService.create` muta un objeto compartido
  en memoria (`this.orders[0]`); no hay rate limiting (fuera de alcance de
  esta US).
- **Webhooks sin validación de firma (R-6)**: las 3 GET de
  `web-hook.controller.ts` (Stripe/Razorpay/PayPal) son `@Public()` porque
  las llamadas de terceros no traen JWT; no verifican firma — son stubs.
- **`/docs` (Swagger) sigue abierto**: `SwaggerModule` registra sus handlers
  directo en el adaptador HTTP, fuera del pipeline de controllers, así que
  los guards globales no corren ahí. Cerrarlo es otra US.
- **`GET /orders` y `GET /refunds` no aíslan datos de punta a punta todavía**:
  `GET /orders` fuerza `customer_id` al `sub` del token en el borde
  (`orders.controller.ts`), pero `OrdersService.getOrders` hoy ignora ese
  campo y solo filtra por `shop_id`. `GET /refunds` queda autenticado sin
  filtro cableable (`RefundsService.findAll()` no acepta argumentos). Ambos
  quedan para US-25, cuando el servicio deje de ser un mock en memoria.

## Verificación

```bash
curl http://localhost:9001/api/settings      # 200, ~5.5 KB JSON
curl http://localhost:9001/api/products      # 200, catálogo
open  http://localhost:9001/docs             # Swagger (sigue abierto, ver arriba)
```

- `http://localhost:3003/en` → home con 30 product cards.
- `http://localhost:3002/en/login` → login (form precargado) → dashboard con
  métricas (`/api/analytics`).

Build de producción:

```bash
cd apps/shop       && yarn build:rest && yarn start   # next start -> :3000
cd apps/admin/rest && yarn build      && yarn start   # next start -> :3002
```

> Detén los `next dev` antes de compilar: comparten el directorio `.next`.

## Problemas conocidos

### Puerto 9000 ocupado

Las plantillas apuntan a `9000`. En equipos corporativos con **Zscaler**, el
proceso `ZSATunnel` ya escucha en ese puerto: Nest falla con
`EADDRINUSE :::9000` y los frontends reciben respuestas vacías que cuelgan.

Comprobación:

```bash
netstat -ano | findstr ":9000"
```

Con `just` esto se diagnostica y se corrige en dos comandos:

```bash
just check-ports              # dice qué proceso ocupa cada puerto
just API_PORT=9001 set-api-port   # sincroniza los tres .env de una vez
```

A mano, hay que cambiarlo en **tres** sitios, y deben coincidir:

```env
apps/api/rest/.env      PORT=9001
apps/shop/.env          NEXT_PUBLIC_REST_API_ENDPOINT="http://localhost:9001/api"
apps/admin/rest/.env    NEXT_PUBLIC_REST_API_ENDPOINT="http://localhost:9001/api"
```

(`admin/rest/.env` deriva `NEXT_PUBLIC_BROADCAST_AUTH_URL` del endpoint, así que
se actualiza solo.)

### `TS2688: Cannot find type definition file for 'minimatch'`

`api/rest` vive dentro del árbol de `apps/`, así que TypeScript sube directorios
y auto-incluye los `@types` hoisteados del workspace del frontend — entre ellos
stubs de deprecación sin `index.d.ts`. El error rompe el emit y Nest arranca sin
llegar a `listen`.

Resuelto acotando los tipos automáticos en `api/rest/tsconfig.json`:

```json
"types": ["node", "express", "multer"]
```

`express` y `multer` son necesarios: `uploads.controller.ts` usa el namespace
global `Express.Multer.File`.

### Warnings esperados en consola

Ruido cosmético, no fallos: `fetchPriority` (desajuste Next 13 / React 18.3) y
`apple-mobile-web-app-capable` deprecado.

## Notas para el despliegue en nube

- Los tres servicios son **stateless**: la API sirve JSON estático desde
  `api/rest/src/db/pickbazar/`. No hay base de datos que aprovisionar.
- `api/rest` lee `PORT` del entorno (fallback `5000`), lo que encaja con
  App Service / Cloud Run / Heroku sin cambios.
- Las `NEXT_PUBLIC_*` se inlinean **en build time**: hay que fijarlas antes de
  `next build`, no en el arranque del contenedor.
- `next.config.js` tiene una allowlist de `images.domains`. Cualquier host nuevo
  de imágenes debe añadirse ahí o `next/image` fallará en producción.
- Con `APPLICATION_MODE=production` el build ignora errores de TypeScript y
  ESLint (ver `next.config.js`). Útil para desplegar, pero conviene que los
  estudiantes sepan que ese interruptor existe.
- `apps/deployment/` trae los scripts `zx` originales de Pickbazar para VM con
  Nginx; son una referencia, no el camino recomendado si se despliega con
  contenedores.
