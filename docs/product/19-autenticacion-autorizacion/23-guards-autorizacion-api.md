# US-23 — Autorización: guard global y permisos por ruta

> Hoy las 249 rutas de la API están abiertas: el token viaja en cada request y
> nadie lo lee. Esta US instala un guard JWT global con `@Public()` explícito
> y un decorador de permisos para lo que solo debería poder tocar un admin o
> un dueño de tienda.

**Épico:** [Épico 19](./README.md)
**Fecha:** 2026-08-31
**Status:** ✅ Implementada
**Depende de:** US-22
**LOC est.:** ~400

## Historia
**Como** dueño del marketplace, **quiero** que la API rechace por sí misma lo
que un usuario no puede hacer, **para** que la autorización deje de ser una
sugerencia del frontend que cualquiera puede saltarse con `curl`.

## Contexto

- `grep -rn "CanActivate|AuthGuard|passport|JwtService|bcrypt"` sobre
  `apps/api/rest/src` devuelve **0 resultados** antes de US-22. La API expone
  **249 rutas** en 44 módulos, todas anónimas.
- La autorización existe hoy **solo en el cliente**: `hasAccess(allowedRoles,
  permissions)` decide qué se pinta en el admin
  (`apps/admin/rest/src/components/auth/login-form.tsx:47`,
  `dashboard/owner.tsx:203`). Un `curl` directo a la API ignora todo eso.
- **La tienda llama a la API sin token durante el SSR**: `/api/settings` es la
  primera llamada de cada render, y el catálogo (`products`, `types`,
  `categories`, `tags`, `manufacturers`, `shops`) se sirve a visitantes
  anónimos. Cerrarlas rompe la tienda entera (R-1 del épico).
- `just verify` comprueba que los 3 frontends responden **con contenido real**
  (cuenta product-cards), así que detecta exactamente ese fallo.
- US-22 dejó el JWT firmado y verificable, con `permissions` en el payload.

## Scope

**Incluye:** el inventario de rutas públicas vs. protegidas; el guard JWT
global registrado en `app.module.ts`; el decorador `@Public()` aplicado a lo
que hoy es anónimo; el decorador `@Permissions()` con su guard, aplicado a las
rutas de escritura y de administración; y la documentación de la postura de
seguridad.

**NO incluye:** migrar los endpoints de `/api/users` a Postgres (US-25 — aquí
solo se protegen, sigan sirviendo mock o no), recuperación de contraseña y OTP
(US-24), rate limiting, CORS, ni ningún cambio en shop o admin.

## Criterios de aceptación

### CA-1 — Inventario explícito antes del guard
Existe una lista razonada —en el código o en el design— de qué rutas son
públicas y por qué. No se activa el guard global sin ella.

### CA-2 — Deny by default
El guard JWT es global. Una ruta sin `@Public()` y sin token devuelve **401**.
Con token válido pero permisos insuficientes, **403** (D-4 del épico).

### CA-3 — La tienda sigue funcionando anónima
Un visitante sin sesión navega el catálogo completo: home, listado, detalle de
producto, búsqueda y categorías. `just verify` sigue contando product-cards
reales.

### CA-4 — Las rutas de administración exigen permiso
Las rutas de escritura y las de administración (crear/actualizar/borrar
productos, tiendas, categorías, tipos, cupones, taxes, y todo `/api/users` y
`/api/*/list`) exigen el permiso correspondiente. Un token de `customer`
recibe **403**, no 200.

### CA-5 — Los permisos salen del token
El guard resuelve los permisos desde el payload del JWT, sin consultar la base
en cada request (D-5 del épico). El coste —revocar un permiso no surte efecto
hasta que el token expira— queda declarado en un comentario del guard.

### CA-6 — Sin regresión
`just build-api` limpio, `just verify` verde y los endpoints públicos
responden byte a byte lo mismo que antes del guard.

## Escenarios Gherkin

```gherkin
Feature: Autorizacion en la API
  Scenario: CA-2 — ruta protegida sin token
    When se hace GET /api/users sin cabecera Authorization
    Then la respuesta es 401

  Scenario: CA-2 — token valido sin permisos
    Given un token de un usuario con permiso customer
    When se hace GET /api/users con ese token
    Then la respuesta es 403

  Scenario: CA-3 — el catalogo sigue siendo publico
    Given ninguna sesion iniciada
    When se consultan settings, products, types y categories
    Then todas responden 200 con contenido
    And la tienda renderiza product-cards reales

  Scenario: CA-4 — escritura reservada al admin
    Given un token de un usuario con permiso super_admin
    When se hace una escritura sobre el catalogo
    Then no se rechaza por falta de permisos
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `apps/api/rest/src/auth/guards/jwt-auth.guard.ts` | nuevo: guard global, respeta `@Public()` |
| `apps/api/rest/src/auth/guards/permissions.guard.ts` | nuevo: valida `@Permissions()` contra el payload |
| `apps/api/rest/src/auth/decorators/` | nuevo: `@Public()`, `@Permissions()`, `@CurrentUser()` |
| `apps/api/rest/src/app.module.ts` | registrar ambos guards como globales (`APP_GUARD`) |
| `apps/api/rest/src/**/*.controller.ts` | anotar rutas públicas y rutas con permiso |
| `apps/README.md` | documentar la postura de seguridad y cómo probar con token |

## Definición de Done

- [x] Inventario pegado: total de rutas, cuántas públicas, cuántas protegidas,
      cuántas con permiso exigido. Los números suman 250 (conteo real medido
      con `route-audit.mjs --check`: `total=250 public=67 perm=117 auth=63
      esp=3`).
- [x] `curl` pegado de los 4 casos: pública sin token (200), protegida sin
      token (401), protegida con token insuficiente (403), protegida con token
      correcto (200). Ver evidencia en
      `openspec/changes/archive/2026-09-03-guards-autorizacion-api/apply-progress.md`.
- [x] `just verify` verde con la salida pegada (product-cards contadas: shop
      30, admin 1).
- [x] Navegación anónima verificada en el navegador: home, listado, detalle,
      búsqueda y categoría. Cerrada por el orquestador (herramienta de
      navegador): las 5 rutas sin sesión, y de las 30 peticiones a la API
      capturadas en el recorrido, **todas 200 o 304 — cero 401, cero 403**.
      Detalle en la sección §CA-3 de `apply-progress.md`.
- [x] Comparación de `/api/settings` antes y después del guard: **idéntica**.
      El precedente "5503" no son bytes sino unidades UTF-16 (así lo mide la
      receta de `just verify`, que concatena chunks en un string); el cuerpo
      tiene un solo carácter no-ASCII (`©`), de ahí 5504 bytes UTF-8 frente a
      5503 unidades UTF-16. Medido en la misma unidad que el precedente, da
      **5503 antes y 5503 después** — no hay desfase. Confirmado además
      idéntico con el guard activo e inactivo en el mismo proceso.
- [x] `just build-api` limpio.
- [x] Status de esta US actualizado y fila del épico marcada.

## Notas para el agente ejecutor

- **R-1 es el riesgo real de este épico.** El orden correcto es: inventariar
  primero, anotar `@Public()` después, activar el guard global al final. Al
  revés se rompe la tienda y el diagnóstico se vuelve un juego de adivinanzas
  entre 249 rutas.
- Para construir el inventario, la fuente fiable es **lo que el shop llama de
  verdad**: `apps/shop/src/framework/rest/client/index.ts` agrupa los
  endpoints que consume. No deducirlo solo de los nombres de los controladores.
- Los endpoints de pagos y webhooks (`payment`, `web-hook`) tienen su propio
  criterio: un webhook lo llama un tercero, no un usuario con JWT. Declarar
  explícitamente qué se hace con ellos en vez de dejarlos caer en el default.
- **La mayoría de las escrituras siguen siendo stubs del mock** (no persisten
  nada). Protegerlas igualmente es correcto y barato; lo que no se debe hacer
  es implementarlas de paso.
- No inventar un sistema de roles nuevo. Los permisos son los 4 que ya existen
  en la base: `super_admin`, `store_owner`, `staff`, `customer`.
- Si al anotar aparece una ruta cuya clasificación es dudosa (ni claramente
  pública ni claramente de admin), **parar y preguntar**. Es exactamente el
  caso del punto 7 del flujo de ejecución.
